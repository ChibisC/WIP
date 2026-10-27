import * as THREE from 'three';
import { SimEvent } from '../../core/events';

/**
 * Small-scale combat effects for one scene (the surface or one nest), as
 * particles driven by simulation events:
 *  - bite: a few flecks of hemolymph and grit hop off the bitten ant;
 *  - sting: a brief hot flash and two venom droplets;
 *  - acid: a fan of fine formic-acid droplets flying from the shooter's
 *    gaster tip to the target, then a pale mist where it lands;
 *  - fling: a puff of dust where an ant was thrown;
 *  - creatures and bosses: a dust ring for a slam, a drifting cloud of
 *    urticating hairs, a puff where a creature dies, and the telegraph
 *    warnings — red ground circles or cones that fill up during a boss's
 *    wind-up, so you can pull your ants out before it lands.
 * Positions are in mm (sim x, height, sim y). Everything is CPU-integrated in
 * a fixed pool (cheap: a few hundred live particles in a big fight).
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

export class CombatFx {
  readonly group = new THREE.Group();
  private pos = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private alpha = new Float32Array(N);
  private size = new Float32Array(N);
  private life = new Float32Array(N);
  private max = new Float32Array(N);
  private grav = new Float32Array(N);
  private drag = new Float32Array(N);
  private grow = new Float32Array(N);
  private base = new Float32Array(N);
  private next = 0;
  private live = 0;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private pending: Array<{ t: number; x: number; y: number }> = [];
  private tmpC = new THREE.Color();
  private warnings: Warning[] = [];

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uPx: { value: 900 } },
      vertexShader: `attribute float alpha; attribute float size; attribute vec3 color; uniform float uPx;
        varying float vA; varying vec3 vC;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * uPx / -mv.z, alpha > 0.0 ? 1.5 : 0.0, 40.0);
          vA = alpha; vC = color;
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
  }

  private spawn(x: number, h: number, y: number, vx: number, vh: number, vy: number, life: number, color: number, size: number, grav: number, drag = 0, grow = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = h;
    this.pos[i * 3 + 2] = y;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vh;
    this.vel[i * 3 + 2] = vy;
    this.tmpC.setHex(color);
    this.col[i * 3] = this.tmpC.r;
    this.col[i * 3 + 1] = this.tmpC.g;
    this.col[i * 3 + 2] = this.tmpC.b;
    this.life[i] = life;
    this.max[i] = life;
    this.base[i] = size;
    this.size[i] = size;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.grow[i] = grow;
    this.alpha[i] = 1;
  }

  /**
   * Saiy-Ant in its gold surge, running: short gold speed lines streaming back
   * off the hair-lock tips and a faint glint left on the ground by the feet.
   */
  goldStreak(x: number, y: number, heading: number, L: number, heightAt: HeightFn): void {
    const r = Math.random;
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
  emit(e: SimEvent, heightAt: HeightFn): void {
    const r = Math.random;
    switch (e.t) {
      case 'bite': {
        const h = heightAt(e.x, e.y) + 0.6;
        const n = 2 + Math.round(e.strength * 4);
        for (let k = 0; k < n; k++) {
          const a = r() * Math.PI * 2;
          const sp = 6 + r() * 10 * (0.5 + e.strength);
          const grit = r() < 0.45;
          this.spawn(e.x, h, e.y, Math.cos(a) * sp, 8 + r() * 12, Math.sin(a) * sp, 0.35 + r() * 0.3, grit ? 0x6a5236 : 0xd8e0a0, grit ? 0.35 : 0.28 + e.strength * 0.25, 70);
        }
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
        const a = Math.random() * Math.PI * 2;
        this.spawn(p.x, h, p.y, Math.cos(a) * 3, 1 + Math.random() * 2, Math.sin(a) * 3, 0.6 + Math.random() * 0.4, 0xe6eac0, 0.45, -2, 3, 1.4);
      }
      this.pending.splice(i, 1);
    }
    let live = 0;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      live++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      let x = this.pos[i * 3] + this.vel[i * 3] * dt;
      let h = this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt;
      const y = this.pos[i * 3 + 2] + this.vel[i * 3 + 2] * dt;
      const g = heightAt(x, y) + 0.1;
      if (h < g) {
        // land: stick to the ground and fade
        h = g;
        this.vel[i * 3] = 0;
        this.vel[i * 3 + 1] = 0;
        this.vel[i * 3 + 2] = 0;
        x = this.pos[i * 3];
      }
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = h;
      this.pos[i * 3 + 2] = y;
      // puffs (growing particles) stay faint; specks and droplets are solid
      this.alpha[i] = Math.min(1, k * 2.5) * (this.grow[i] > 0 ? 0.28 : 0.95);
      this.size[i] = this.base[i] * (1 + this.grow[i] * (1 - k));
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    this.live = live;
    for (const name of ['position', 'color', 'alpha', 'size']) (this.geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
  }

  get liveCount(): number {
    return this.live;
  }
}
