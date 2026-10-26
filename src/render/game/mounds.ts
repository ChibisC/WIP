import * as THREE from 'three';
import { World } from '../../sim/world';
import { nestToSurface } from '../../sim/colony';
import { Rng } from '../../core/rng';
import { patchDapple } from '../shaderPatch';
import { InstancedPool } from './instancedPool';
import { crumbGeometry } from './foodModels';
import { SurfaceEntrances } from './entranceModels';

/**
 * Fire ant mounds on the surface (Phase 12). Solenopsis heap the soil they
 * dig into a dome over the nest, with no opening in the middle (their tunnels
 * surface away from it). The dome grows with the colony. It is drawn as a
 * mesh of granular soil, and everything drawn on the surface (ants, food,
 * creatures, effects) adds `height()` so it walks over the dome instead of
 * through it. Render-only: the simulation's terrain is unchanged.
 */

interface Mound {
  colony: number;
  x: number;
  y: number;
  r: number;
  h: number;
  mesh: THREE.Mesh | null;
  /** radius the mesh was built for */
  builtR: number;
}

const RINGS = 14;
const SEG = 40;

export class SurfaceMounds {
  readonly group = new THREE.Group();
  private mounds: Mound[] = [];
  private frame = 0;
  private mat: THREE.MeshStandardMaterial;
  /** loose clods of worked soil scattered over the domes */
  private clods: InstancedPool;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  /** species entrance rims, holes and nest structures (their heights add to the domes') */
  readonly entrances = new SurfaceEntrances();

  constructor() {
    this.group.add(this.entrances.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    patchDapple(this.mat);
    const cm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    patchDapple(cm);
    this.clods = new InstancedPool(crumbGeometry(), cm, this.group, 512);
  }

  /** The dome's (and the entrance rims') height above the terrain at (x, y), mm (0 off any mound). */
  height(x: number, y: number): number {
    return (this.entrances.empty ? 0 : this.entrances.height(x, y)) + this.domeHeight(x, y);
  }

  /** The fire-ant domes alone. */
  private domeHeight(x: number, y: number): number {
    let h = 0;
    for (const m of this.mounds) {
      const dx = x - m.x;
      const dy = y - m.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= m.r * m.r) continue;
      const k = 1 - Math.sqrt(d2) / m.r;
      h += m.h * k * k * (3 - 2 * k);
    }
    return h;
  }

  /** Tilt a surface normal by the dome's slope at (x, y). */
  tilt(x: number, y: number, n: { x: number; y: number; z: number }): void {
    if (!this.mounds.length && this.entrances.empty) return;
    const e = 0.6;
    const gx = (this.height(x + e, y) - this.height(x - e, y)) / (2 * e);
    const gz = (this.height(x, y + e) - this.height(x, y - e)) / (2 * e);
    if (gx === 0 && gz === 0) return;
    n.x -= gx * n.y;
    n.z -= gz * n.y;
    const l = Math.hypot(n.x, n.y, n.z) || 1;
    n.x /= l;
    n.y /= l;
    n.z /= l;
  }

  update(w: World, ground: (x: number, y: number) => number): void {
    this.entrances.update(w, (x, y) => ground(x, y) + this.domeHeight(x, y));
    if (this.frame++ % 30 !== 0) return;
    const seen = new Set<number>();
    for (const c of w.s.colonies) {
      if (c.species !== 'solenopsis' || !c.alive || !w.nest(c.id)) continue;
      const queens = c.tiles.filter((t) => t.type === 'queen');
      if (!queens.length) continue;
      const g = w.nest(c.id)!;
      let nx = 0;
      let ny = 0;
      for (const t of queens) {
        const p = g.hexCenter(t.q);
        nx += p.x / queens.length;
        ny += p.y / queens.length;
      }
      const s = nestToSurface(w, c, nx, ny);
      const r = 15 + Math.min(16, Math.sqrt(Math.max(0, c.living)) * 1.7);
      let m = this.mounds.find((x) => x.colony === c.id);
      if (!m) {
        m = { colony: c.id, x: s.x, y: s.y, r, h: r * 0.3, mesh: null, builtR: 0 };
        this.mounds.push(m);
      }
      m.x = s.x;
      m.y = s.y;
      m.r = r;
      m.h = r * 0.3;
      seen.add(c.id);
      if (Math.abs(m.builtR - r) > 0.8) {
        this.build(m, ground);
        this.scatter(ground);
      }
    }
    for (let i = this.mounds.length - 1; i >= 0; i--) {
      if (seen.has(this.mounds[i].colony)) continue;
      const m = this.mounds[i];
      if (m.mesh) {
        this.group.remove(m.mesh);
        m.mesh.geometry.dispose();
      }
      this.mounds.splice(i, 1);
      this.scatter(ground);
    }
  }

  /** Clods of soil over every dome, denser near the top (where the workers drop them). */
  private scatter(ground: (x: number, y: number) => number): void {
    this.clods.begin();
    for (const m of this.mounds) {
      const rng = new Rng(m.colony * 31 + 5);
      const n = Math.round(60 + m.r * 5);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.pow(rng.next(), 0.7) * m.r * 0.95;
        const x = m.x + Math.cos(a) * d;
        const y = m.y + Math.sin(a) * d;
        const sz = rng.range(0.6, 1.6) * (1 - 0.4 * (d / m.r));
        this.p.set(x, ground(x, y) + this.height(x, y) + sz * 0.15, y);
        this.e.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
        this.q.setFromEuler(this.e);
        this.s.setScalar(sz);
        this.m4.compose(this.p, this.q, this.s);
        this.clods.add(this.m4, this.c.setHSL(0.075, rng.range(0.3, 0.45), rng.range(0.2, 0.36), THREE.SRGBColorSpace));
      }
    }
    this.clods.end();
  }

  /** A disc of rings over the terrain, raised into the dome, with clumpy soil colour. */
  private build(m: Mound, ground: (x: number, y: number) => number): void {
    if (m.mesh) {
      this.group.remove(m.mesh);
      m.mesh.geometry.dispose();
    }
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const rng = new Rng(m.colony * 7919 + 13);
    const c = new THREE.Color();
    for (let ri = 0; ri <= RINGS; ri++) {
      const rr = (ri / RINGS) * m.r * 1.04;
      const n = ri === 0 ? 1 : SEG;
      for (let i = 0; i < n; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const wob = ri === RINGS ? 1 + 0.06 * Math.sin(a * 5 + m.colony) : 1;
        const x = m.x + Math.cos(a) * rr * wob;
        const y = m.y + Math.sin(a) * rr * wob;
        // granular surface: small bumps of worked soil, fading out at the rim; dry and paler on top
        const k = 1 - rr / (m.r * 1.04);
        const bump = (rng.next() - 0.5) * 0.6 * Math.min(1, k * 4);
        pos.push(x, ground(x, y) + this.height(x, y) + bump + 0.05, y);
        const blotch = 0.5 + 0.5 * Math.sin(x * 0.35 + Math.sin(y * 0.27) * 2) * Math.sin(y * 0.31 + Math.sin(x * 0.23) * 2);
        c.setHSL(0.075, 0.38, 0.22 + 0.07 * blotch + 0.08 * k + 0.02 * rng.next(), THREE.SRGBColorSpace);
        col.push(c.r, c.g, c.b);
      }
    }
    // ring 0 is the single apex vertex
    for (let i = 0; i < SEG; i++) idx.push(0, 1 + ((i + 1) % SEG), 1 + i);
    for (let ri = 1; ri < RINGS; ri++) {
      const a0 = 1 + (ri - 1) * SEG;
      const b0 = 1 + ri * SEG;
      for (let i = 0; i < SEG; i++) {
        const a = a0 + i;
        const a1 = a0 + ((i + 1) % SEG);
        const b = b0 + i;
        const b1 = b0 + ((i + 1) % SEG);
        idx.push(a, a1, b, a1, b1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    m.mesh = mesh;
    m.builtR = m.r;
    this.group.add(mesh);
  }
}
