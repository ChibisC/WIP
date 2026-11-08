import * as THREE from 'three';
import { SimEvent } from '../../core/events';
import { BALANCE } from '../../sim/balance';

/**
 * The Saiy-Ant Blaster's effects (claude/saiy-ants/09-spec-saiy-blaster.md §4), one per scene, inside CombatFx:
 *  - orbs: a bright core (the only part bright enough to bloom), a coloured shell with swirling crackle, a short
 *    tapering trail and a soft light on the ground under it; white-blue, gold in the gold form;
 *  - the beam: a bright core line, a thicker glow round it rippling and flickering along its length, a charge ball at
 *    the mouth, a burst where it ends, light along the ground; it flashes on and fades off.
 * Both are GPU-instanced and played in closed form from the sim's events (written once, when they happen): an orb from
 * where and when it was fired, at the orb's speed, until the hit or fizzle (it runs on to the point of the hit, then
 * bursts there); a beam from its start until its end event. Nothing is stepped on the CPU per frame but the beams'
 * end sparks, and those only for the few beams alive. Fixed pools: the oldest slot is reused.
 */

const N_ORB = 512;
const N_BEAM = 64;
/** the mouth's height over the ground (mm): the Blaster's head is low (6.6 mm long, the mouth ~0.13 L up) */
const MOUTH_H = 0.85;
/** where an orb aims, over the ground at the target (an ant's middle) */
const AIM_H = 0.7;

export interface Sparker {
  particle(x: number, h: number, y: number, vx: number, vh: number, vy: number, life: number, color: number, size: number, grav: number, drag?: number, grow?: number): void;
  rand(): number;
}

type HeightFn = (x: number, y: number) => number;

// the two looks: white-blue normally, gold in the gold form (core, shell)
const GLSL_COLOURS = `
  vec3 coreOf(float g) { return mix(vec3(0.82, 0.93, 1.0), vec3(1.0, 0.93, 0.72), g); }
  vec3 shellOf(float g) { return mix(vec3(0.3, 0.62, 1.0), vec3(1.0, 0.55, 0.08), g); }
`;

export class BlastFx {
  readonly group = new THREE.Group();
  private clock = 0;
  // ---- orbs: (x0, y0 sim plane, ground at start, ground at the aim) · (vx, vy, flight time to the aim, —) · (t0, life, gold, seed)
  private oP = new Float32Array(N_ORB * 4);
  private oV = new Float32Array(N_ORB * 4);
  private oT = new Float32Array(N_ORB * 4);
  private oNext = 0;
  private oLo = N_ORB;
  private oHi = -1;
  private oGeo = new THREE.InstancedBufferGeometry();
  /** projectile id → slot, while it flies */
  private orbSlot = new Map<number, number>();
  /** bursts waiting for their orb to get there (render time) */
  private bursts: Array<{ at: number; x: number; y: number; gold: boolean; hit: boolean; wall: boolean }> = [];
  // ---- beams: (x0, y0, heading, length) · (t0, end time, ground at the mouth, ground at the end) · (seed, —, —, —)
  private bA = new Float32Array(N_BEAM * 4);
  private bB = new Float32Array(N_BEAM * 4);
  private bNext = 0;
  private bLo = N_BEAM;
  private bHi = -1;
  private bGeo = new THREE.InstancedBufferGeometry();
  /** ant id → slot, while its beam is on */
  private beamSlot = new Map<number, number>();
  /** live beams for the end sparks: slot, next spark time */
  private live: Array<{ slot: number; next: number }> = [];
  private oMat: THREE.ShaderMaterial;
  private bMat: THREE.ShaderMaterial;
  private uni = { uClock: { value: 0 }, uPx: { value: 900 } };
  /** which projectile / ant each slot holds (to forget it when the slot is reused) */
  private orbPid = new Float64Array(N_ORB).fill(-1);
  private beamAnt = new Float64Array(N_BEAM).fill(-1);

  constructor(private sp: Sparker) {
    // (an empty beam slot ended long ago)
    for (let i = 0; i < N_BEAM; i++) this.bB[i * 4 + 1] = -1e9;
    // ---- orb mesh: two quads per orb: 0 the billboard (head and trail), 1 the light on the ground
    {
      const corner: number[] = [];
      const part: number[] = [];
      const idx: number[] = [];
      for (let q = 0; q < 2; q++) {
        const b = q * 4;
        corner.push(-1, -1, 1, -1, 1, 1, -1, 1);
        part.push(q, q, q, q);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      this.oGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
      this.oGeo.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2));
      this.oGeo.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
      this.oGeo.setIndex(idx);
      this.oGeo.setAttribute('iP', new THREE.InstancedBufferAttribute(this.oP, 4).setUsage(THREE.DynamicDrawUsage));
      this.oGeo.setAttribute('iV', new THREE.InstancedBufferAttribute(this.oV, 4).setUsage(THREE.DynamicDrawUsage));
      this.oGeo.setAttribute('iT', new THREE.InstancedBufferAttribute(this.oT, 4).setUsage(THREE.DynamicDrawUsage));
      this.oGeo.instanceCount = N_ORB;
    }
    this.oMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.uni,
      vertexShader: `attribute vec2 corner; attribute float part; attribute vec4 iP; attribute vec4 iV; attribute vec4 iT;
        uniform float uClock; uniform float uPx;
        varying vec2 vL; varying float vTail; varying float vGold; varying float vSeed; varying float vPart; varying float vA;
        void main(){
          float tau = uClock - iT.x;
          vPart = part; vGold = iT.z; vSeed = iT.w;
          if (iT.y <= 0.0 || tau < 0.0 || tau > iT.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float k = clamp(tau / max(iV.z, 1e-3), 0.0, 1.0);
          float g = mix(iP.z, iP.w, k);
          vec3 p = vec3(iP.x + iV.x * tau, g + mix(${MOUTH_H.toFixed(2)}, ${AIM_H.toFixed(2)}, k), iP.y + iV.y * tau);
          // the last 40 ms: a quick shrink as it bursts or fizzles; the first 30 ms: it swells out of the mouth
          vA = clamp((iT.y - tau) / 0.04, 0.0, 1.0) * clamp(tau / 0.03 + 0.35, 0.0, 1.0);
          if (part > 0.5) {
            // the light on the ground: a soft disc under the orb
            float R = 3.2;
            vL = corner;
            vec4 mv = modelViewMatrix * vec4(p.x + corner.x * R, g + 0.12, p.z + corner.y * R, 1.0);
            gl_Position = projectionMatrix * mv;
            return;
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // the trail: back along the screen-space motion, as long as it has flown (up to 60 ms of flight)
          float back = min(tau, 0.06);
          vec4 mt = modelViewMatrix * vec4(p - vec3(iV.x, 0.0, iV.y) * back, 1.0);
          vec2 d = mv.xy - mt.xy;
          float dl = length(d);
          vec2 dir = dl > 1e-5 ? d / dl : vec2(1.0, 0.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          // at least ~6 px in radius, so it reads at the gameplay zoom (the orb is ~1.6 mm across, an ant's head)
          float R = max(0.8, 6.0 * -mv.z / uPx);
          float tail = dl / R;
          vTail = tail;
          vL = vec2(corner.x > 0.0 ? corner.x : corner.x * (1.0 + tail), corner.y);
          mv.xy += dir * vL.x * R + nrm * vL.y * R;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float uClock;
        varying vec2 vL; varying float vTail; varying float vGold; varying float vSeed; varying float vPart; varying float vA;
        ${GLSL_COLOURS}
        void main(){
          vec3 sh = shellOf(vGold);
          if (vPart > 0.5) {
            float r = length(vL);
            float a = (1.0 - smoothstep(0.0, 1.0, r)) * 0.3 * vA;
            if (a < 0.003) discard;
            gl_FragColor = vec4(sh * a, 1.0);
            return;
          }
          float r = length(vL);
          // head: core + shell with swirling crackle
          float core = 1.0 - smoothstep(0.22, 0.48, r);
          float shell = (1.0 - smoothstep(0.35, 1.0, r));
          float ang = atan(vL.y, vL.x);
          float swirl = 0.5 + 0.5 * sin(ang * 5.0 + r * 9.0 - uClock * 34.0 + vSeed * 6.283);
          float crack = pow(0.5 + 0.5 * sin(ang * 11.0 - r * 14.0 + uClock * 51.0 + vSeed * 17.0), 6.0);
          float band = smoothstep(0.3, 0.55, r) * (1.0 - smoothstep(0.75, 1.0, r));
          // the trail: behind the head (x < 0), tapering and fading to its end
          float tr = 0.0;
          if (vL.x < 0.0 && vTail > 0.01) {
            float u = clamp(-vL.x / (1.0 + vTail), 0.0, 1.0);
            float wdt = mix(0.62, 0.08, u);
            tr = (1.0 - smoothstep(wdt * 0.4, wdt, abs(vL.y))) * (1.0 - u) * (1.0 - u);
          }
          vec3 col = coreOf(vGold) * core * 5.0 + sh * (shell * (0.55 + 0.4 * swirl) + band * crack * 1.1) * 0.9 + sh * tr * 0.7 + coreOf(vGold) * tr * tr * 0.5;
          float a = max(max(core, shell), tr) * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * vA, 1.0);
        }`,
    });
    const orbs = new THREE.Mesh(this.oGeo, this.oMat);
    orbs.frustumCulled = false;
    orbs.renderOrder = 13;
    this.group.add(orbs);

    // ---- beam mesh: four quads per beam: 0 the beam (billboarded round its axis), 1 the charge ball at the mouth,
    // 2 the burst at the far end, 3 the light along the ground
    {
      const corner: number[] = [];
      const part: number[] = [];
      const idx: number[] = [];
      for (let q = 0; q < 4; q++) {
        const b = q * 4;
        corner.push(-1, -1, 1, -1, 1, 1, -1, 1);
        part.push(q, q, q, q);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      this.bGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 3), 3));
      this.bGeo.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2));
      this.bGeo.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
      this.bGeo.setIndex(idx);
      this.bGeo.setAttribute('iA', new THREE.InstancedBufferAttribute(this.bA, 4).setUsage(THREE.DynamicDrawUsage));
      this.bGeo.setAttribute('iB', new THREE.InstancedBufferAttribute(this.bB, 4).setUsage(THREE.DynamicDrawUsage));
      this.bGeo.instanceCount = N_BEAM;
    }
    this.bMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.uni,
      vertexShader: `attribute vec2 corner; attribute float part; attribute vec4 iA; attribute vec4 iB;
        uniform float uClock; uniform float uPx;
        varying vec2 vL; varying float vPart; varying float vOn; varying float vLen; varying float vSeed; varying float vAge;
        void main(){
          float tau = uClock - iB.x;
          float off = uClock - iB.y;
          vPart = part; vSeed = fract(iB.x * 7.13 + iA.x * 0.37);
          if (tau < 0.0 || off > 0.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vAge = tau;
          // flash on (a quick overshoot), fade off over 0.2 s
          vOn = (off > 0.0 ? 1.0 - off / 0.2 : 1.0) * (1.0 + 0.9 * exp(-tau * 14.0)) * smoothstep(0.0, 0.05, tau);
          vec2 u = vec2(cos(iA.z), sin(iA.z));
          float len = iA.w;
          vLen = len;
          vec3 A = vec3(iA.x, iB.z + ${MOUTH_H.toFixed(2)}, iA.y);
          vec3 B = vec3(iA.x + u.x * len, iB.w + ${MOUTH_H.toFixed(2)}, iA.y + u.y * len);
          vL = corner;
          if (part > 2.5) {
            // light along the ground: a long soft strip under the beam
            float wd = 3.2;
            vec2 n = vec2(-u.y, u.x);
            float s = (corner.x * 0.5 + 0.5);
            vec3 P = mix(A, B, s) + vec3(u.x, 0.0, u.y) * corner.x * 1.5;
            P.y -= ${MOUTH_H.toFixed(2)} - 0.12;
            P.xz += n * corner.y * wd;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
            return;
          }
          vec4 ma = modelViewMatrix * vec4(A, 1.0);
          vec4 mb = modelViewMatrix * vec4(B, 1.0);
          if (part > 0.5) {
            // a billboard ball: at the mouth (charge) or the far end (burst)
            vec4 mv = part < 1.5 ? ma : mb;
            float R = (part < 1.5 ? 1.25 : 1.9) * max(1.0, 5.0 * -mv.z / uPx / 1.25);
            mv.xy += corner * R;
            gl_Position = projectionMatrix * mv;
            return;
          }
          // the beam strip: across its screen-space axis, at least ~11 px wide (the glow; the core a fifth of it)
          vec2 d = mb.xy - ma.xy;
          float dl = length(d);
          vec2 dir = dl > 1e-5 ? d / dl : vec2(1.0, 0.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float s = corner.x * 0.5 + 0.5;
          vec4 mv = mix(ma, mb, s);
          float W = max(1.0, 5.5 * -mv.z / uPx);
          mv.xy += nrm * corner.y * W;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float uClock;
        varying vec2 vL; varying float vPart; varying float vOn; varying float vLen; varying float vSeed; varying float vAge;
        ${GLSL_COLOURS}
        void main(){
          // (the beam happens only in the gold form)
          vec3 c = coreOf(1.0);
          vec3 sh = shellOf(1.0);
          vec3 col;
          float a;
          if (vPart > 2.5) {
            float s = vL.x * 0.5 + 0.5;
            a = (1.0 - smoothstep(0.0, 1.0, abs(vL.y))) * smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.85, s) * 0.3;
            col = sh * a;
          } else if (vPart > 0.5) {
            float r = length(vL);
            bool mouth = vPart < 1.5;
            float pulse = 0.85 + 0.15 * sin(uClock * (mouth ? 43.0 : 57.0) + vSeed * 9.0);
            float core = 1.0 - smoothstep(0.12, mouth ? 0.36 : 0.3, r);
            float halo = pow(max(0.0, 1.0 - r), mouth ? 2.2 : 3.0);
            float ang = atan(vL.y, vL.x);
            float rays = mouth ? 0.0 : pow(0.5 + 0.5 * sin(ang * 7.0 + uClock * 23.0 + vSeed * 5.0), 8.0) * (1.0 - r);
            col = c * core * 3.2 * pulse + sh * (halo * 0.9 + rays * 0.8) * pulse;
            a = max(core, halo);
          } else {
            float s = vL.x * 0.5 + 0.5;
            float x = s * vLen;
            float y = abs(vL.y);
            // ripples running out along the beam, and a flicker
            float rip = 0.5 + 0.5 * sin(x * 1.9 - uClock * 46.0 + vSeed * 6.0);
            float flick = 0.88 + 0.12 * sin(uClock * 71.0 + vSeed * 13.0) * sin(uClock * 29.0);
            float wcore = 0.1 + 0.03 * rip;
            float core = 1.0 - smoothstep(wcore * 0.5, wcore, y);
            float glow = exp(-y * y / (0.18 + 0.1 * rip)) * (0.55 + 0.25 * rip);
            float ends = smoothstep(0.0, 0.03, s) * (1.0 - smoothstep(0.97, 1.0, s));
            col = (c * core * 4.5 + sh * glow * 1.15) * flick * ends;
            a = max(core, glow) * ends;
          }
          col *= vOn;
          if (a * vOn < 0.003) discard;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const beams = new THREE.Mesh(this.bGeo, this.bMat);
    beams.frustumCulled = false;
    beams.renderOrder = 13;
    this.group.add(beams);
  }

  emit(e: SimEvent, heightAt: HeightFn): void {
    switch (e.t) {
      case 'orb': {
        const B = BALANCE.blaster;
        const i = this.oNext;
        this.oNext = (this.oNext + 1) % N_ORB;
        if (this.orbSlot.get(this.orbPid[i]) === i) this.orbSlot.delete(this.orbPid[i]);
        this.orbPid[i] = e.pid;
        const dx = e.tx - e.x;
        const dy = e.ty - e.y;
        const d = Math.max(0.5, Math.hypot(dx, dy));
        this.oP.set([e.x, e.y, heightAt(e.x, e.y), heightAt(e.tx, e.ty)], i * 4);
        this.oV.set([(dx / d) * B.orbSpeed, (dy / d) * B.orbSpeed, d / B.orbSpeed, 0], i * 4);
        this.oT.set([this.clock, (B.range * B.orbLife) / B.orbSpeed + 0.1, e.gold ? 1 : 0, ((e.pid * 0.618034) % 1) || 0.3], i * 4);
        this.orbSlot.set(e.pid, i);
        this.dirtyOrb(i);
        // a little flash at the mouth as it leaves
        this.sp.particle(e.x, heightAt(e.x, e.y) + MOUTH_H, e.y, 0, 0, 0, 0.09, e.gold ? 0xfff0c0 : 0xe8f4ff, -0.5, 0, 0, 1.6);
        break;
      }
      case 'orbHit':
      case 'orbFizz': {
        const gold = !!e.gold;
        const hit = e.t === 'orbHit';
        const wall = e.t === 'orbFizz' && !!e.wall;
        const i = this.orbSlot.get(e.pid);
        let at = this.clock;
        if (i !== undefined) {
          this.orbSlot.delete(e.pid);
          // the orb runs on to where it hit (or the sim's tick was ahead of it): it bursts when it gets there
          const sp = BALANCE.blaster.orbSpeed;
          const dist = Math.hypot(e.x - this.oP[i * 4], e.y - this.oP[i * 4 + 1]);
          const reach = this.oT[i * 4] + dist / sp;
          at = Math.max(this.clock, Math.min(reach, this.clock + 0.06));
          this.oT[i * 4 + 1] = Math.max(0.001, at - this.oT[i * 4]);
          this.dirtyOrb(i);
        }
        this.bursts.push({ at, x: e.x, y: e.y, gold, hit, wall });
        break;
      }
      case 'beam': {
        const i = this.bNext;
        this.bNext = (this.bNext + 1) % N_BEAM;
        if (this.beamSlot.get(this.beamAnt[i]) === i) this.beamSlot.delete(this.beamAnt[i]);
        this.beamAnt[i] = e.id;
        for (let k = this.live.length - 1; k >= 0; k--) if (this.live[k].slot === i) this.live.splice(k, 1);
        const ex = e.x + Math.cos(e.h) * e.len;
        const ey = e.y + Math.sin(e.h) * e.len;
        this.bA.set([e.x, e.y, e.h, e.len], i * 4);
        this.bB.set([this.clock, 1e9, heightAt(e.x, e.y), heightAt(ex, ey)], i * 4);
        this.beamSlot.set(e.id, i);
        this.live.push({ slot: i, next: this.clock });
        this.dirtyBeam(i);
        break;
      }
      case 'beamEnd': {
        const i = this.beamSlot.get(e.id);
        if (i === undefined) break;
        this.beamSlot.delete(e.id);
        this.bB[i * 4 + 1] = this.clock;
        this.dirtyBeam(i);
        break;
      }
    }
  }

  private dirtyOrb(i: number): void {
    if (i < this.oLo) this.oLo = i;
    if (i > this.oHi) this.oHi = i;
  }

  private dirtyBeam(i: number): void {
    if (i < this.bLo) this.bLo = i;
    if (i > this.bHi) this.bHi = i;
  }

  /** The burst of an orb: on a hit, light, sparks and dust; on a fizzle a soft pop (and grit off a wall). */
  private burst(b: { x: number; y: number; gold: boolean; hit: boolean; wall: boolean }, heightAt: HeightFn): void {
    const r = this.sp.rand;
    const g = heightAt(b.x, b.y);
    const h = g + AIM_H;
    const core = b.gold ? 0xfff2c8 : 0xeef8ff;
    const shell = b.gold ? 0xffb030 : 0x6cb4ff;
    if (b.hit) {
      this.sp.particle(b.x, h, b.y, 0, 0, 0, 0.14, core, -1.3, 0, 0, 2.2);
      this.sp.particle(b.x, h, b.y, 0, 0, 0, 0.22, shell, 1.4, 0, 0, 2.4);
      for (let k = 0; k < 9; k++) {
        const a = r() * Math.PI * 2;
        const v = 14 + r() * 16;
        this.sp.particle(b.x, h, b.y, Math.cos(a) * v, 4 + r() * 10, Math.sin(a) * v, 0.16 + r() * 0.14, k < 3 ? core : shell, 0.18, 50, 2);
      }
      for (let k = 0; k < 4; k++) {
        const a = r() * Math.PI * 2;
        this.sp.particle(b.x + Math.cos(a) * 0.6, g + 0.15, b.y + Math.sin(a) * 0.6, Math.cos(a) * 5, 1.5 + r() * 2, Math.sin(a) * 5, 0.45 + r() * 0.3, k < 2 ? 0xa48c6c : 0x8a7458, 0.4, 5, 2.5, 1.3);
      }
    } else {
      // a soft pop: a puff of the shell colour, a few slow motes
      this.sp.particle(b.x, h, b.y, 0, 0.5, 0, 0.2, shell, 0.7, 0, 0, 2.2);
      for (let k = 0; k < 4; k++) {
        const a = r() * Math.PI * 2;
        this.sp.particle(b.x, h, b.y, Math.cos(a) * 4, 1 + r() * 3, Math.sin(a) * 4, 0.25 + r() * 0.15, core, 0.14, 0, 3);
      }
      if (b.wall)
        for (let k = 0; k < 3; k++) {
          const a = r() * Math.PI * 2;
          this.sp.particle(b.x, g + 0.2, b.y, Math.cos(a) * 4, 2 + r() * 2, Math.sin(a) * 4, 0.4, 0x8a7458, 0.35, 8, 2.5, 1.2);
        }
    }
  }

  update(clock: number, heightAt: HeightFn, pxScale: number): void {
    this.clock = clock;
    this.uni.uClock.value = clock;
    this.uni.uPx.value = pxScale;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (this.bursts[i].at > clock + 1e-4) continue;
      this.burst(this.bursts[i], heightAt);
      this.bursts.splice(i, 1);
    }
    // the far end of each live beam throws sparks and grit (a few a tick; there are few beams)
    const r = this.sp.rand;
    for (let k = this.live.length - 1; k >= 0; k--) {
      const L = this.live[k];
      const i = L.slot;
      if (clock > this.bB[i * 4 + 1] || this.bA[i * 4 + 3] <= 0) {
        this.live.splice(k, 1);
        continue;
      }
      if (clock < L.next) continue;
      L.next = clock + 0.06;
      const h0 = this.bA[i * 4 + 2];
      const ex = this.bA[i * 4] + Math.cos(h0) * this.bA[i * 4 + 3];
      const ey = this.bA[i * 4 + 1] + Math.sin(h0) * this.bA[i * 4 + 3];
      const g = this.bB[i * 4 + 3];
      for (let s = 0; s < 3; s++) {
        const a = h0 + Math.PI + (r() - 0.5) * 2.6;
        const v = 10 + r() * 18;
        this.sp.particle(ex, g + MOUTH_H, ey, Math.cos(a) * v, 4 + r() * 9, Math.sin(a) * v, 0.15 + r() * 0.12, s ? 0xffc040 : 0xfff2c8, 0.16, 50, 2);
      }
      if (r() < 0.5) this.sp.particle(ex, g + 0.15, ey, (r() - 0.5) * 4, 1.5, (r() - 0.5) * 4, 0.5, 0x9a8466, 0.4, 4, 2.5, 1.4);
      // the line along the ground glints where the beam passes over grit
      const t = r();
      const gx = this.bA[i * 4] + Math.cos(h0) * this.bA[i * 4 + 3] * t;
      const gy = this.bA[i * 4 + 1] + Math.sin(h0) * this.bA[i * 4 + 3] * t;
      this.sp.particle(gx, heightAt(gx, gy) + 0.12, gy, 0, 0.4, 0, 0.18, 0xffd060, 0.22, 0, 0, 0.8);
    }
    for (const [lo, hi, geo, names] of [
      [this.oLo, this.oHi, this.oGeo, ['iP', 'iV', 'iT']],
      [this.bLo, this.bHi, this.bGeo, ['iA', 'iB']],
    ] as const) {
      if (hi < lo) continue;
      for (const name of names) {
        const at = geo.attributes[name] as THREE.InstancedBufferAttribute;
        at.clearUpdateRanges();
        at.addUpdateRange(lo * 4, (hi - lo + 1) * 4);
        at.needsUpdate = true;
      }
    }
    this.oLo = N_ORB;
    this.oHi = -1;
    this.bLo = N_BEAM;
    this.bHi = -1;
  }

  /** orbs and beams on screen now (tests, the profiler) */
  get liveOrbs(): number {
    let n = 0;
    for (let i = 0; i < N_ORB; i++) {
      const tau = this.clock - this.oT[i * 4];
      if (this.oT[i * 4 + 1] > 0 && tau >= 0 && tau <= this.oT[i * 4 + 1]) n++;
    }
    return n;
  }
  get liveBeams(): number {
    let n = 0;
    for (let i = 0; i < N_BEAM; i++) if (this.clock - this.bB[i * 4 + 1] <= 0.2) n++;
    return n;
  }
}
