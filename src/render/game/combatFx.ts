import * as THREE from 'three';
import { hash2 } from '../../core/rng';
import { SimEvent } from '../../core/events';
import { BlastFx, Sparker } from './blastFx';

/**
 * Small-scale combat effects for one scene (the surface or one nest), as
 * particles driven by simulation events:
 *  - bite: a brief warm-white pop at the bite (golden sparks in a Saiy-Ant surge);
 *  - sting: a brief hot flash and two venom droplets;
 *  - acid: a fan of fine formic-acid droplets flying from the shooter's
 *    gaster tip to the target, then a pale mist where it lands;
 *  - fling: a puff of dust where an ant was thrown;
 *  - creatures and bosses: a dust ring for a slam, a drifting cloud of
 *    urticating hairs, a puff where a creature dies, and the telegraph
 *    warnings — red ground circles or cones that fill up during a boss's
 *    wind-up, so you can pull your ants out before it lands.
 * Positions are in mm (sim x, height, sim y), in a fixed pool of points.
 *
 * Performance v2 (claude/performance/02-spec-responsiveness-client-visuals.md §3): every particle is written once,
 * when it is spawned — where, how fast, when, how long — and the vertex shader plays it from t − t0 in closed form:
 * the horizontal motion slows with its drag, x(τ) = x₀ + v·(1 − e^(−dτ))/d; the height falls under its gravity,
 * h(τ) = h₀ + v·τ − ½gτ²; at the time it reaches the ground (worked out at spawn) it stops there and fades. The CPU
 * no longer steps 2048 particles a frame and the GPU gets only the slots spawned since the last frame. The sparks'
 * randomness is a seeded sequence (no Math.random), so the same fight sparks the same way.
 */

const N = 2048;

export type HeightFn = (x: number, y: number) => number;

interface Warning {
  g: THREE.Group;
  fill: THREE.Mesh | null;
  edge: THREE.Mesh;
  t: number;
  dur: number;
  ring: boolean;
}

function warnMat(opacity: number, color = 0xff4a1a): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false });
}

/** A small seeded generator (mulberry32) for the sparks' spread. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first time τ > 0 at which h₀ + v·τ − ½g·τ² comes down to the ground `c` below the start (c = h₀ − ground). */
export function landTime(v: number, g: number, c: number): number {
  if (c <= 0 && v <= 0) return 0;
  const A = -0.5 * g;
  if (Math.abs(A) < 1e-9) return v < 0 ? c / -v : 1e9;
  const disc = v * v - 4 * A * c;
  if (disc < 0) return 1e9;
  const sq = Math.sqrt(disc);
  const r1 = (-v - sq) / (2 * A);
  const r2 = (-v + sq) / (2 * A);
  let t = 1e9;
  if (r1 > 1e-6) t = r1;
  if (r2 > 1e-6 && r2 < t) t = r2;
  return t;
}

/** Where a particle is at τ (the shader's formula, for tests): [x, h, y], or null once it is gone. */
export function particleAt(p0: readonly number[], v0: readonly number[], life: number, grav: number, drag: number, ground: number, tLand: number, tau: number): [number, number, number] | null {
  if (tau < 0 || tau >= life) return null;
  const tm = Math.min(tau, tLand);
  const f = drag > 0 ? (1 - Math.exp(-drag * tm)) / drag : tm;
  const h = tau >= tLand ? ground : p0[1] + v0[1] * tau - 0.5 * grav * tau * tau;
  return [p0[0] + v0[0] * f, h, p0[2] + v0[2] * f];
}

export class CombatFx implements Sparker {
  readonly group = new THREE.Group();
  /** the Saiy-Ant Blaster's orbs and beams (blastFx.ts): instanced, closed form, on this clock */
  readonly blast: BlastFx = new BlastFx(this);
  /** per particle: start position, velocity, colour; (t₀, life, size, growth); (gravity, drag, ground, landing time) */
  private p0 = new Float32Array(N * 3);
  private v0 = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private tl = new Float32Array(N * 4);
  private kin = new Float32Array(N * 4);
  private next = 0;
  /** the effects' clock (s): the simulation's time as the frames go (a paused game holds its sparks) */
  private clock = 0;
  /** the slots spawned since the last upload */
  private dirtyLo = N;
  private dirtyHi = -1;
  private rnd = seeded(0x51ed);
  private hAt: HeightFn | null = null;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private pending: Array<{ t: number; x: number; y: number }> = [];
  private tmpC = new THREE.Color();
  private warnings: Warning[] = [];

  constructor() {
    // (nothing is alive at first: every slot's life is 0)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.p0, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aV0', new THREE.BufferAttribute(this.v0, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aT', new THREE.BufferAttribute(this.tl, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aK', new THREE.BufferAttribute(this.kin, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPx: { value: 900 }, uClock: { value: 0 } },
      vertexShader: `attribute vec3 aV0; attribute vec3 color; attribute vec4 aT; attribute vec4 aK;
        uniform float uPx; uniform float uClock;
        varying float vA; varying vec3 vC;
        void main(){
          vC = color;
          float tau = uClock - aT.x;
          float life = aT.y;
          if (tau < 0.0 || tau >= life) { vA = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          // closed form (combatFx.ts particleAt): drag slows the spread, gravity the height, the ground stops it
          float tm = min(tau, aK.w);
          float f = aK.y > 0.0 ? (1.0 - exp(-aK.y * tm)) / aK.y : tm;
          vec3 p = position;
          p.x += aV0.x * f;
          p.z += aV0.z * f;
          p.y = tau >= aK.w ? aK.z : position.y + aV0.y * tau - 0.5 * aK.x * tau * tau;
          float k = 1.0 - tau / life;
          // puffs (growing particles) stay faint; specks and droplets are solid
          float alpha = min(1.0, k * 2.5) * (aT.w > 0.0 ? 0.28 : 0.95);
          float size = aT.z * (1.0 + aT.w * (1.0 - k));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          // a negative size: a marker that keeps at least 9 px on screen (a bite's pop, readable when zoomed out)
          float mn = size < 0.0 ? 9.0 : 1.5;
          gl_PointSize = clamp(abs(size) * uPx / -mv.z, mn, 40.0);
          vA = alpha;
        }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
    });
    const pts = new THREE.Points(this.geo, this.mat);
    pts.frustumCulled = false;
    pts.renderOrder = 12;
    this.group.add(pts);
    this.group.add(this.blast.group);
  }

  /** A particle for the blast effects (blastFx.ts), and their seeded randomness. */
  particle(x: number, h: number, y: number, vx: number, vh: number, vy: number, life: number, color: number, size: number, grav: number, drag = 0, grow = 0): void {
    this.spawn(x, h, y, vx, vh, vy, life, color, size, grav, drag, grow);
  }
  readonly rand = (): number => this.rnd();

  private spawn(x: number, h: number, y: number, vx: number, vh: number, vy: number, life: number, color: number, size: number, grav: number, drag = 0, grow = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.p0[i * 3] = x;
    this.p0[i * 3 + 1] = h;
    this.p0[i * 3 + 2] = y;
    this.v0[i * 3] = vx;
    this.v0[i * 3 + 1] = vh;
    this.v0[i * 3 + 2] = vy;
    this.tmpC.setHex(color);
    this.col[i * 3] = this.tmpC.r;
    this.col[i * 3 + 1] = this.tmpC.g;
    this.col[i * 3 + 2] = this.tmpC.b;
    this.tl[i * 4] = this.clock;
    this.tl[i * 4 + 1] = life;
    this.tl[i * 4 + 2] = size;
    this.tl[i * 4 + 3] = grow;
    // the ground under where it starts (it moves a few mm at most) and when it gets there
    const ground = (this.hAt ? this.hAt(x, y) : h - 0.1) + 0.1;
    this.kin[i * 4] = grav;
    this.kin[i * 4 + 1] = drag;
    this.kin[i * 4 + 2] = ground;
    this.kin[i * 4 + 3] = landTime(vh, grav, h - ground);
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }

  /**
   * Saiy-Ant in its gold surge, running: short gold speed lines streaming back
   * off the hair-lock tips and a faint glint left on the ground by the feet.
   */
  goldStreak(x: number, y: number, heading: number, L: number, heightAt: HeightFn): void {
    this.hAt = heightAt;
    const r = this.rnd;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const g = heightAt(x, y);
    for (let k = 0; k < 3; k++) {
      // the three top locks: centre and the upper pair
      const side = (k - 1) * 0.12 * L;
      const tx = x + c * L * 0.05 - s * side;
      const ty = y + s * L * 0.05 + c * side;
      this.spawn(tx, g + L * 0.42, ty, -c * L * 4, 0.3, -s * L * 4, 0.16 + r() * 0.06, k === 1 ? 0xfff0b8 : 0xf2c14e, 0.16, 0, 6);
    }
    this.spawn(x - c * L * 0.3, g + 0.1, y - s * L * 0.3, 0, 0, 0, 0.3, 0xf6d870, 0.3 + L * 0.03, 0, 0, 0.8);
  }

  /** React to one simulation event that happened in this scene's space. */
  /** A puff of dust kicked up from the ground (render-only beats: a hell ant's snap), `size` in mm. */
  dust(x: number, y: number, size: number, heightAt: HeightFn): void {
    this.hAt = heightAt;
    const r = this.rnd;
    const h = heightAt(x, y) + 0.15;
    for (let k = 0; k < 7; k++) {
      const a = r() * Math.PI * 2;
      const sp = size * (2 + r() * 3);
      this.spawn(x + Math.cos(a) * size * 0.4, h, y + Math.sin(a) * size * 0.4, Math.cos(a) * sp, size * (1.5 + r() * 2.5), Math.sin(a) * sp, 0.45 + r() * 0.3, k < 2 ? 0xb39a78 : 0x8e7658, size * (0.28 + r() * 0.2), 5, 2.5, 1.3);
    }
  }

  emit(e: SimEvent, heightAt: HeightFn): void {
    this.hAt = heightAt;
    const r = this.rnd;
    switch (e.t) {
      case 'bite': {
        const h = heightAt(e.x, e.y) + 0.6;
        // (user, review 2026-11-07: "remove the dust particles coming out of ants cos its unneeded vfx" — the spray of
        // grit and droplets thrown out of every bite is gone)
        // the pop: a brief warm-white point at the bite that keeps a few pixels when zoomed out, so a fight reads
        // as fight at the default camera distance (blind review: hits were 1–2 px specks there)
        this.spawn(e.x, h + 0.2, e.y, 0, 0, 0, 0.16, 0xfff0c8, -0.45, 0, 0, 1.2);
        // a Saiy-Ant in its gold surge bites with a spray of golden sparks
        if (e.gold)
          for (let k = 0; k < 5; k++) {
            const a = r() * Math.PI * 2;
            this.spawn(e.x, h + 0.3, e.y, Math.cos(a) * 12, 6 + r() * 8, Math.sin(a) * 12, 0.18 + r() * 0.12, k ? 0xffd34a : 0xfff4c0, 0.2, 40);
          }
        break;
      }
      case 'snap': {
        // hell ant: the jaws clap shut against the horn; an impale throws out pale hemolymph
        const h = heightAt(e.x, e.y) + 1.6;
        this.spawn(e.x, h, e.y, 0, 1, 0, 0.12, 0xf3ecd5, e.impale ? 1.6 : 0.9, 0, 0, 3);
        if (e.impale)
          for (let k = 0; k < 10; k++) {
            const a = r() * Math.PI * 2;
            const sp = 5 + r() * 9;
            this.spawn(e.x, h, e.y, Math.cos(a) * sp, 6 + r() * 10, Math.sin(a) * sp, 0.45 + r() * 0.3, 0xe8e2c8, 0.3, 60);
          }
        break;
      }
      case 'glueBurst': {
        // termite major: a gob of sticky defensive secretion splashes the bitten target
        const h = heightAt(e.x, e.y) + 0.8;
        for (let k = 0; k < 9; k++) {
          const a = r() * Math.PI * 2;
          const sp = 2 + r() * 5;
          this.spawn(e.x, h, e.y, Math.cos(a) * sp, 3 + r() * 5, Math.sin(a) * sp, 0.6 + r() * 0.4, k < 3 ? 0xf2ecc8 : 0xd9cf9a, 0.32 + r() * 0.2, 40, 1.5);
        }
        break;
      }
      case 'headbang': {
        // drumming alarm: little puffs of dust from the head striking the ground
        const h = heightAt(e.x, e.y) + 0.2;
        for (let k = 0; k < 8; k++) {
          const a = r() * Math.PI * 2;
          this.spawn(e.x + Math.cos(a) * 1.2, h, e.y + Math.sin(a) * 1.2, Math.cos(a) * 4, 1.5 + r() * 2.5, Math.sin(a) * 4, 0.5 + r() * 0.3, 0x9a8466, 0.45, 6, 2.5, 1.4);
        }
        break;
      }
      case 'surge': {
        // Saiy-Ant gold surge: a burst of gold sparkles rising off the body, and a faint ring of light on the ground
        const h = heightAt(e.x, e.y) + 0.9;
        for (let k = 0; k < 14; k++) {
          const a = r() * Math.PI * 2;
          const sp = 2 + r() * 4;
          this.spawn(e.x + Math.cos(a) * 0.8, h + r() * 1.2, e.y + Math.sin(a) * 0.8, Math.cos(a) * sp, 4 + r() * 6, Math.sin(a) * sp, 0.5 + r() * 0.5, k % 3 === 0 ? 0xfff2b0 : 0xf0c040, 0.22 + r() * 0.16, -4, 2.2);
        }
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          this.spawn(e.x, heightAt(e.x, e.y) + 0.15, e.y, Math.cos(a) * 9, 0, Math.sin(a) * 9, 0.35, 0xf6d870, 0.35, 0, 4);
        }
        break;
      }
      case 'sting': {
        const h = heightAt(e.x, e.y) + 0.8;
        this.spawn(e.x, h, e.y, 0, 2, 0, 0.22, 0xff8a3a, 1.1, 0, 0, 2.5);
        for (let k = 0; k < 2; k++) {
          const a = r() * Math.PI * 2;
          this.spawn(e.x, h, e.y, Math.cos(a) * 5, 6 + r() * 5, Math.sin(a) * 5, 0.4, 0xf2e6a0, 0.25, 60);
        }
        break;
      }
      case 'acid': {
        if (e.lob) {
          // mortar: a glob of acid arcs high over the fight (the landing splash comes with 'acidHit')
          const dx = e.tx - e.x;
          const dy = e.ty - e.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const h0 = heightAt(e.x, e.y) + 1.4;
          const h1 = heightAt(e.tx, e.ty) + 0.6;
          const tFly = Math.max(0.15, d / 70);
          const g = 170;
          for (let k = 0; k < 7; k++) {
            const j = 0.04;
            const vx = (dx / tFly) * (1 + (r() - 0.5) * j);
            const vy = (dy / tFly) * (1 + (r() - 0.5) * j);
            const vh = (h1 - h0) / tFly + g * tFly * 0.5 + (r() - 0.5) * 2;
            this.spawn(e.x + (r() - 0.5) * 0.4, h0, e.y + (r() - 0.5) * 0.4, vx, vh, vy, tFly, k === 0 ? 0xfffbe0 : 0xece6b0, k === 0 ? 0.75 : 0.42 + r() * 0.2, g);
          }
          break;
        }
        // jet of droplets toward the target
        const dx = e.tx - e.x;
        const dy = e.ty - e.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const h0 = heightAt(e.x, e.y) + 1.2;
        const h1 = heightAt(e.tx, e.ty) + 1;
        const tFly = d / 90;
        for (let k = 0; k < 14; k++) {
          const s = 0.85 + r() * 0.3;
          const spread = (r() - 0.5) * 0.22;
          const ca = Math.cos(spread);
          const sa = Math.sin(spread);
          const vx = ((dx * ca - dy * sa) / tFly) * s;
          const vy = ((dx * sa + dy * ca) / tFly) * s;
          const vh = (h1 - h0) / tFly + 30 * tFly * 0.5 * s;
          const delay = k * 0.012;
          this.spawn(e.x - (vx * delay), h0, e.y - (vy * delay), vx, vh, vy, tFly * (1.05 + r() * 0.15), 0xf4f0c8, 0.22 + r() * 0.12, 30);
        }
        this.pending.push({ t: tFly, x: e.tx, y: e.ty });
        break;
      }
      case 'acidHit': {
        // a mortar glob bursts: droplets spray out (wider at level 3 splash) and a pale mist rises
        const h = heightAt(e.x, e.y) + 0.6;
        const n = e.splash > 0 ? 22 : 10;
        const sp = e.splash > 0 ? e.splash * 2.2 : 7;
        for (let k = 0; k < n; k++) {
          const a = r() * Math.PI * 2;
          const v = sp * (0.5 + r() * 0.6);
          this.spawn(e.x, h, e.y, Math.cos(a) * v, 5 + r() * 9, Math.sin(a) * v, 0.35 + r() * 0.3, 0xf0eec0, 0.26 + r() * 0.16, 60);
        }
        for (let k = 0; k < (e.splash > 0 ? 8 : 4); k++) {
          const a = r() * Math.PI * 2;
          this.spawn(e.x + Math.cos(a) * 1.5, h, e.y + Math.sin(a) * 1.5, Math.cos(a) * 3, 1 + r() * 2, Math.sin(a) * 3, 0.7 + r() * 0.5, 0xe6eac0, 0.5, -2, 3, 1.5);
        }
        break;
      }
      case 'hatch': {
        // emergence: the larva bursts into a soft puff as the adult appears
        const h = heightAt(e.x, e.y) + 0.4;
        for (let k = 0; k < 10; k++) {
          const a = r() * Math.PI * 2;
          const sp = 2 + r() * 5;
          this.spawn(e.x, h, e.y, Math.cos(a) * sp, 2 + r() * 4, Math.sin(a) * sp, 0.5 + r() * 0.4, k < 6 ? 0xf6f0e0 : 0xe8dcc0, 0.35 + r() * 0.25, 4, 2.5, 1.2);
        }
        break;
      }
      case 'fling': {
        const h = heightAt(e.x, e.y) + 0.3;
        for (let k = 0; k < 6; k++) {
          const a = r() * Math.PI * 2;
          this.spawn(e.x, h, e.y, Math.cos(a) * 9, 4 + r() * 6, Math.sin(a) * 9, 0.6 + r() * 0.4, 0x8a7458, 0.5, 10, 2.5, 1.3);
        }
        break;
      }
      case 'telegraph':
        this.warn(e.x, e.y, e.radius, e.duration, heightAt, e.dir, e.half);
        break;
      case 'taunt':
        // a leafcutter major's taunt (sim/casteAbilities.ts): a ring across its reach
        this.ring(e.x, e.y, e.radius, heightAt);
        break;
      case 'titanDig': {
        // a titan digging into a nest (sim/creatures/titanDig.ts): soil thrown out behind it at the hole; a burst at the
        // breach; underground, clods bursting from each hex its body breaks
        // (the throw grows as the hole opens — claude/creatures/02-spec §3: past 75 % the soil fountains up out of it)
        const h = heightAt(e.x, e.y) + 0.4;
        const p = e.prog ?? 0;
        const n = e.phase === 'dig' ? Math.round(8 + 10 * p) : e.phase === 'breach' ? 40 : e.phase === 'break' ? 6 : 0;
        for (let k = 0; k < n; k++) {
          const a = r() * Math.PI * 2;
          const sp = e.phase === 'breach' ? 18 + r() * 20 : e.phase === 'dig' ? (7 + r() * 12) * (1 + 0.5 * p) : 5 + r() * 8;
          const col = r() < 0.4 ? 0x6e5a40 : r() < 0.5 ? 0x8a7458 : 0x5a4836;
          this.spawn(e.x + Math.cos(a) * 3, h, e.y + Math.sin(a) * 3, Math.cos(a) * sp, (6 + r() * 12) * (1 + 0.6 * p), Math.sin(a) * sp, 0.6 + r() * 0.6, col, 0.6 + r() * 0.9, 14, 2.4, 1.6);
        }
        if (e.phase === 'dig' && p >= 0.75)
          for (let k = 0; k < 10; k++) {
            const a = r() * Math.PI * 2;
            const sp = 3 + r() * 5;
            this.spawn(e.x + Math.cos(a) * 1.5, h, e.y + Math.sin(a) * 1.5, Math.cos(a) * sp, 26 + r() * 18, Math.sin(a) * sp, 0.8 + r() * 0.6, r() < 0.5 ? 0x5a4836 : 0x7a6448, 0.5 + r() * 0.8, 16, 2.2, 1.6);
          }
        if (e.phase === 'breach') this.ring(e.x, e.y, 18, heightAt);
        break;
      }
      case 'slam': {
        // a ring of dust thrown out across the slam radius, and a flash of the warning colour
        const h = heightAt(e.x, e.y) + 0.4;
        const n = Math.round(24 + e.radius * 0.8);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + r() * 0.2;
          const sp = e.radius * (1.6 + r() * 0.8);
          this.spawn(e.x + Math.cos(a) * 2, h, e.y + Math.sin(a) * 2, Math.cos(a) * sp, 3 + r() * 6, Math.sin(a) * sp, 0.55 + r() * 0.3, r() < 0.5 ? 0x8a7458 : 0xa89070, 0.9 + e.power * 0.8, 8, 3.2, 2.2);
        }
        this.ring(e.x, e.y, e.radius, heightAt);
        break;
      }
      case 'hairs': {
        // urticating hairs: a fine tawny cloud drifting over the area
        const h = heightAt(e.x, e.y) + 1;
        for (let k = 0; k < 60; k++) {
          const a = r() * Math.PI * 2;
          const d = Math.sqrt(r()) * e.radius;
          this.spawn(e.x + Math.cos(a) * d * 0.3, h + r() * 3, e.y + Math.sin(a) * d * 0.3, Math.cos(a) * d * 0.9, 2 + r() * 3, Math.sin(a) * d * 0.9, 1.2 + r() * 1.2, r() < 0.5 ? 0xc9a46a : 0xe0c890, 0.18 + r() * 0.12, 1.5, 1.6);
        }
        break;
      }
      case 'orb':
      case 'orbHit':
      case 'orbFizz':
      case 'beam':
      case 'beamEnd':
        this.blast.emit(e, heightAt);
        break;
      case 'death': {
        if (e.kind !== 'creature') break;
        const h = heightAt(e.x, e.y) + 0.5;
        for (let k = 0; k < 12; k++) {
          const a = r() * Math.PI * 2;
          this.spawn(e.x, h, e.y, Math.cos(a) * 7, 3 + r() * 5, Math.sin(a) * 7, 0.8 + r() * 0.5, 0x8a7458, 0.8, 4, 2.4, 1.6);
        }
        break;
      }
    }
  }

  /** A boss's wind-up: a ground circle (or a cone from x, y toward `dir`) that fills over `duration`. */
  private warn(x: number, y: number, radius: number, duration: number, heightAt: HeightFn, dir?: number, half?: number): void {
    const cone = dir !== undefined && half !== undefined;
    // geometry lies in the x-z plane; a sim angle φ is the geometry angle −φ there
    const start = cone ? -(dir + half) : 0;
    const len = cone ? half * 2 : Math.PI * 2;
    const seg = cone ? 24 : 48;
    const edge = new THREE.Mesh(new THREE.RingGeometry(radius * 0.93, radius, seg, 1, start, len).rotateX(-Math.PI / 2), warnMat(0.75));
    const base = new THREE.Mesh(new THREE.CircleGeometry(radius, seg, start, len).rotateX(-Math.PI / 2), warnMat(0.14));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, seg, start, len).rotateX(-Math.PI / 2), warnMat(0.3));
    const g = new THREE.Group();
    g.add(base, fill, edge);
    g.position.set(x, heightAt(x, y) + 0.5, y);
    g.renderOrder = 11;
    for (const m of [base, fill, edge]) m.renderOrder = 11;
    fill.scale.setScalar(0.001);
    this.group.add(g);
    this.warnings.push({ g, fill, edge, t: 0, dur: Math.max(0.1, duration), ring: false });
  }

  /**
   * A slam's shock wave: a soft band of dust-coloured haze, transparent at both edges, expanding past the
   * radius and fading (blind review: the old hard cream ring read as a selection circle).
   */
  private ring(x: number, y: number, radius: number, heightAt: HeightFn): void {
    const geo = new THREE.RingGeometry(radius * 0.55, radius, 48, 2).rotateX(-Math.PI / 2);
    // three rings of vertices (inner, middle, outer): only the middle one is opaque
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 4);
    const pos = geo.attributes.position;
    const rm = radius * 0.8;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i));
      col.set([0.66, 0.57, 0.44, Math.max(0, 1 - Math.abs(d - rm) / (radius * 0.24))], i * 4);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false });
    const edge = new THREE.Mesh(geo, mat);
    const g = new THREE.Group();
    g.add(edge);
    g.position.set(x, heightAt(x, y) + 0.5, y);
    edge.renderOrder = 11;
    this.group.add(g);
    this.warnings.push({ g, fill: null, edge, t: 0, dur: 0.45, ring: true });
  }

  private updateWarnings(dt: number): void {
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      if (w.ring) {
        w.g.scale.setScalar(0.6 + k * 0.6);
        (w.edge.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - k) * (1 - k);
      } else {
        w.fill!.scale.setScalar(Math.max(0.001, k));
        // the edge pulses faster as the strike comes
        (w.edge.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(w.t * (8 + k * 18));
      }
      if (w.t >= w.dur + (w.ring ? 0 : 0.12)) {
        this.group.remove(w.g);
        w.g.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          }
        });
        this.warnings.splice(i, 1);
      }
    }
  }

  update(dt: number, heightAt: HeightFn, pxScale: number): void {
    this.mat.uniforms.uPx.value = pxScale;
    this.updateWarnings(dt);
    // acid mist where jets land
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t > 0) continue;
      const h = heightAt(p.x, p.y) + 1;
      for (let k = 0; k < 5; k++) {
        // (hashed from the place and the puff, not Math.random: the same splash looks the same every time)
        const sd = Math.floor(p.x * 7.31) ^ Math.floor(p.y * 13.7);
        const a = hash2(sd, k, 41) * Math.PI * 2;
        this.spawn(p.x, h, p.y, Math.cos(a) * 3, 1 + hash2(sd, k, 42) * 2, Math.sin(a) * 3, 0.6 + hash2(sd, k, 43) * 0.4, 0xe6eac0, 0.45, -2, 3, 1.4);
      }
      this.pending.splice(i, 1);
    }
    // (the particles play themselves in the shader: the clock moves on, and only the slots spawned since the last
    // frame go to the GPU)
    this.hAt = heightAt;
    this.clock += dt;
    this.mat.uniforms.uClock.value = this.clock;
    this.blast.update(this.clock, heightAt, pxScale);
    if (this.dirtyHi >= this.dirtyLo) {
      const lo = this.dirtyLo;
      const n = this.dirtyHi - lo + 1;
      for (const name of ['position', 'aV0', 'color', 'aT', 'aK']) {
        const at = this.geo.attributes[name] as THREE.BufferAttribute;
        at.clearUpdateRanges();
        at.addUpdateRange(lo * at.itemSize, n * at.itemSize);
        at.needsUpdate = true;
      }
      this.dirtyLo = N;
      this.dirtyHi = -1;
    }
  }

  get liveCount(): number {
    let n = 0;
    for (let i = 0; i < N; i++) if (this.clock - this.tl[i * 4] < this.tl[i * 4 + 1]) n++;
    return n;
  }
}
