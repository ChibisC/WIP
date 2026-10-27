import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { AntMorph, PartLook } from './morphs';
import { buildHellAnt } from './hellBuilder';
import { buildHair6 } from './saiyHair';
import { REGION } from '../bake/detailBake';
import { bakeOcclusion } from '../bake/occlusion';
import { buildMandible, fitLen } from '../anatomy/mandible';

/**
 * Procedural anatomical ant builder.
 *
 * Local frame: +x forward (head), +y up, +z right. Ground at y = 0.
 * Every vertex carries `aPart` (joint chain id) so the vertex shader can
 * animate legs, antennae, mandibles, head and gaster per instance.
 */
export const PART = {
  BODY: 0,
  HEAD: 1,
  MAND_L: 2,
  MAND_R: 3,
  SCAPE_L: 4,
  FUNI_L: 5,
  SCAPE_R: 6,
  FUNI_R: 7,
  GASTER: 8,
  WAIST: 9,
  LEG0: 10, // + leg*3 + seg   (leg: 0 L1, 1 R1, 2 L2, 3 R2, 4 L3, 5 R3; seg: 0 coxa+femur, 1 tibia, 2 tarsus)
} as const;

export interface AntRig {
  coxa: THREE.Vector3[];
  /** rest foot points (tarsus tips, on the ground), for the planted-feet IK */
  foot?: THREE.Vector3[];
  /**
   * planted-feet IK (animation pass): each foot's neutral place on the ground (mid-stance, pulled in from the
   * nearly straight rest pose so the leg can reach forward and back), the largest stance half-sweep (mm) and
   * half-turn per stance (rad) every leg can follow
   */
  home?: THREE.Vector3[];
  sweepMax?: number;
  turnMax?: number;
  knee: THREE.Vector3[];
  ankle: THREE.Vector3[];
  axis: THREE.Vector3[];
  neck: THREE.Vector3;
  mandL: THREE.Vector3;
  mandR: THREE.Vector3;
  antL: THREE.Vector3;
  antR: THREE.Vector3;
  elbL: THREE.Vector3;
  elbR: THREE.Vector3;
  gasterPivot: THREE.Vector3;
  waistPivot: THREE.Vector3;
  /** Body length incl. mandibles (mm). */
  length: number;
  /** mm travelled per full gait cycle at amplitude 1. */
  stride: number;
  stance: number;
  /** Max protraction angle (rad). */
  q0: number;
  /** Front of head (mandible tips) x, and gaster tip x — for carry/attach points. */
  headTip: THREE.Vector3;
  gasterTip: THREE.Vector3;
  mouth: THREE.Vector3;
  /** walk-cycle lift / duty overrides (morph `gait`) and the physogastry factor (`gaster.physo`) */
  gaitLift?: number;
  gaitDuty?: number;
  physo?: number;
  /** army-ant porters: where a load slung under the body hangs (between the fore and mid coxae, below them) */
  carryUnder?: THREE.Vector3;
  /** soft abdomen jiggle (Termants: `gaster.soft`) */
  soft?: number;
}

export interface BuiltAnt {
  geometry: THREE.BufferGeometry;
  rig: AntRig;
}

/**
 * Where each vertex of a lofted or tubular piece sits on its surface (realism pass, baked detail):
 * `th` angle around / 2π (−1 at the caps), `s` distance along (mm), `total` length (mm), `circ` mean girth (mm).
 */
export interface GeoMeta {
  th: number[];
  s: number[];
  total: number;
  circ: number;
}

/** `aDet` for a piece (render/bake/detailBake.ts): angle, mm along, 0..1 along, region + 32 × girth in µm. */
export function detOf(meta: GeoMeta, region: number): number[] {
  const out: number[] = [];
  const w = region + 32 * Math.max(1, Math.round(meta.circ * 1000));
  // (0..1 along is stored × .998 so a convexity level can share the float: render/bake/occlusion.ts)
  for (let i = 0; i < meta.th.length; i++) out.push(meta.th[i], meta.s[i], (meta.total > 0 ? meta.s[i] / meta.total : 0) * 0.998, w);
  return out;
}

export class Acc {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  surf: number[] = [];
  part: number[] = [];
  idx: number[] = [];
  /** baked-detail coordinates (4 per vertex; zero where a piece has none) */
  det: number[] = [];
  /** per vertex: 1 = not an occluder for the occlusion bake (hairs) */
  skipOcc: number[] = [];
  /** pieces added while set are not occluders */
  noOcc = false;

  get count(): number {
    return this.pos.length / 3;
  }

  /** Append a piece and compute its smooth normals locally. */
  piece(p: number[], ind: number[], part: number, colFn: (x: number, y: number, z: number) => THREE.Color, look: PartLook, flags = 0, normals?: number[], det?: number[]): void {
    const base = this.count;
    const n = p.length / 3;
    let nr: number[];
    if (normals) nr = normals;
    else {
      nr = new Array(p.length).fill(0);
      for (let i = 0; i < ind.length; i += 3) {
        const a = ind[i] * 3;
        const b = ind[i + 1] * 3;
        const c = ind[i + 2] * 3;
        const ux = p[b] - p[a];
        const uy = p[b + 1] - p[a + 1];
        const uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a];
        const vy = p[c + 1] - p[a + 1];
        const vz = p[c + 2] - p[a + 2];
        const fx = uy * vz - uz * vy;
        const fy = uz * vx - ux * vz;
        const fz = ux * vy - uy * vx;
        for (const k of [a, b, c]) {
          nr[k] += fx;
          nr[k + 1] += fy;
          nr[k + 2] += fz;
        }
      }
      for (let i = 0; i < n; i++) {
        const l = Math.hypot(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]) || 1;
        nr[i * 3] /= l;
        nr[i * 3 + 1] /= l;
        nr[i * 3 + 2] /= l;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      this.pos.push(x, y, z);
      this.nrm.push(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]);
      const c = colFn(x, y, z);
      this.col.push(c.r, c.g, c.b);
      this.surf.push(look.rough, look.coat, look.sheen, flags);
      this.part.push(part);
      if (det && det.length >= (i + 1) * 4) this.det.push(det[i * 4], det[i * 4 + 1], det[i * 4 + 2], det[i * 4 + 3]);
      else this.det.push(0, 0, 0, 0);
      this.skipOcc.push(this.noOcc ? 1 : 0);
    }
    for (const i of ind) this.idx.push(base + i);
  }

  /** Append a piece with its own per-vertex colours (linear RGB, 3 per vertex). */
  pieceCols(p: number[], ind: number[], part: number, cols: number[], look: PartLook, flags = 0, det?: number[]): void {
    const base = this.count;
    const c = new THREE.Color();
    this.piece(p, ind, part, () => c, look, flags, undefined, det);
    for (let i = 0; i < p.length / 3; i++) {
      this.col[(base + i) * 3] = cols[i * 3];
      this.col[(base + i) * 3 + 1] = cols[i * 3 + 1];
      this.col[(base + i) * 3 + 2] = cols[i * 3 + 2];
    }
  }

  /**
   * A hair (seta): a tapered tube along `pts`, flagged so the shader knows how far along it each vertex is
   * (aSurf.w = 8 + fraction: paler, translucent, fading out at the tip) and kept out of the occlusion bake.
   */
  hair(pts: THREE.Vector3[], radii: number[], radial: number, part: number, color: THREE.Color, look: PartLook, xform?: THREE.Matrix4): void {
    const [pp, ii, meta] = tube(pts, radii, radial, false, true);
    const start = this.count;
    this.noOcc = true;
    this.piece(xform ? transformPts(pp, xform) : pp, ii, part, () => color, look, 8);
    this.noOcc = false;
    for (let v = 0; v < meta.s.length; v++) this.surf[(start + v) * 4 + 3] = 8 + Math.min(0.999, meta.total > 0 ? meta.s[v] / meta.total : 0);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 4));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aDet', new THREE.Float32BufferAttribute(this.det, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export interface Ring {
  x: number;
  y: number;
  z?: number;
  rz: number; // half width
  ry: number; // half height
  n?: number; // superellipse exponent (2 = ellipse)
}

/** Loft rings along x into a closed body with pointed caps. */
export function loft(rings: Ring[], radial: number, mod?: (x: number, y: number, z: number, t: number, a: number) => [number, number, number]): [number[], number[], GeoMeta] {
  const p: number[] = [];
  const ind: number[] = [];
  const R = rings.length;
  // where each ring sits along the piece (mm), and the mean girth (Ramanujan's ellipse perimeter)
  const along: number[] = [0];
  for (let r = 1; r < R; r++) along.push(along[r - 1] + Math.hypot(rings[r].x - rings[r - 1].x, rings[r].y - rings[r - 1].y, (rings[r].z ?? 0) - (rings[r - 1].z ?? 0)));
  const total = along[R - 1];
  let girth = 0;
  for (const g of rings) girth += Math.PI * (3 * (g.rz + g.ry) - Math.sqrt((3 * g.rz + g.ry) * (g.rz + 3 * g.ry)));
  const meta: GeoMeta = { th: [], s: [], total, circ: girth / R };
  for (let r = 0; r < R; r++) {
    const g = rings[r];
    const ex = 2 / (g.n ?? 2);
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const y = g.y + Math.sign(sa) * Math.pow(Math.abs(sa), ex) * g.ry;
      const z = (g.z ?? 0) + Math.sign(ca) * Math.pow(Math.abs(ca), ex) * g.rz;
      let v: [number, number, number] = [g.x, y, z];
      if (mod) v = mod(v[0], v[1], v[2], r / (R - 1), a);
      p.push(v[0], v[1], v[2]);
      meta.th.push(i / radial);
      meta.s.push(along[r]);
    }
  }
  for (let r = 0; r < R - 1; r++)
    for (let i = 0; i < radial; i++) {
      const a = r * radial + i;
      const b = r * radial + ((i + 1) % radial);
      const c = (r + 1) * radial + i;
      const d = (r + 1) * radial + ((i + 1) % radial);
      ind.push(a, c, b, b, c, d);
    }
  // caps
  const first = rings[0];
  const last = rings[R - 1];
  const c0 = p.length / 3;
  p.push(first.x - Math.min(first.rz, first.ry) * 0.25, first.y, first.z ?? 0);
  const c1 = p.length / 3;
  p.push(last.x + Math.min(last.rz, last.ry) * 0.25, last.y, last.z ?? 0);
  meta.th.push(-1, -1);
  meta.s.push(0, total);
  for (let i = 0; i < radial; i++) {
    const b = (i + 1) % radial;
    ind.push(c0, i, b);
    ind.push(c1, (R - 1) * radial + b, (R - 1) * radial + i);
  }
  // Rings running toward -x (e.g. the gaster) produce inverted winding; flip it
  // so front faces point outward. Caps likewise sit at the other ends.
  if (last.x < first.x) {
    for (let i = 0; i < ind.length; i += 3) {
      const t = ind[i + 1];
      ind[i + 1] = ind[i + 2];
      ind[i + 2] = t;
    }
    p[c0 * 3] = first.x + Math.min(first.rz, first.ry) * 0.25;
    p[c1 * 3] = last.x - Math.min(last.rz, last.ry) * 0.25;
  }
  return [p, ind, meta];
}

/** Tube along a polyline with per-point radius, parallel-transport frames. */
export function tube(pts: THREE.Vector3[], radii: number[], radial: number, capStart = true, capEnd = true, flatten = 1): [number[], number[], GeoMeta] {
  const p: number[] = [];
  const ind: number[] = [];
  const n = pts.length;
  const along: number[] = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = along[n - 1];
  let girth = 0;
  for (const r of radii) girth += Math.PI * r * (1 + flatten);
  const meta: GeoMeta = { th: [], s: [], total, circ: girth / n };
  const T: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    T.push(b.clone().sub(a).normalize());
  }
  let N = new THREE.Vector3(0, 1, 0);
  if (Math.abs(N.dot(T[0])) > 0.9) N.set(1, 0, 0);
  N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const s = axis.length();
      if (s > 1e-6) {
        const ang = Math.asin(Math.min(1, s));
        N.applyAxisAngle(axis.normalize(), ang);
      }
      N.sub(T[i].clone().multiplyScalar(N.dot(T[i]))).normalize();
    }
    const B = new THREE.Vector3().crossVectors(T[i], N);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const r = radii[i];
      const v = pts[i].clone().addScaledVector(N, Math.cos(a) * r * flatten).addScaledVector(B, Math.sin(a) * r);
      p.push(v.x, v.y, v.z);
      meta.th.push(j / radial);
      meta.s.push(along[i]);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      ind.push(a, b, c, b, d, c);
    }
  if (capStart) {
    const c = p.length / 3;
    const v = pts[0].clone().addScaledVector(T[0], -radii[0] * 0.6);
    p.push(v.x, v.y, v.z);
    meta.th.push(-1);
    meta.s.push(0);
    for (let j = 0; j < radial; j++) ind.push(c, (j + 1) % radial, j);
  }
  if (capEnd) {
    const c = p.length / 3;
    const v = pts[n - 1].clone().addScaledVector(T[n - 1], radii[n - 1] * 0.6);
    p.push(v.x, v.y, v.z);
    meta.th.push(-1);
    meta.s.push(total);
    const o = (n - 1) * radial;
    for (let j = 0; j < radial; j++) ind.push(c, o + j, o + ((j + 1) % radial));
  }
  return [p, ind, meta];
}

export function ellipsoid(c: THREE.Vector3, r: THREE.Vector3, seg: number, rot?: THREE.Quaternion): [number[], number[], GeoMeta] {
  const p: number[] = [];
  const ind: number[] = [];
  const rings = Math.max(3, Math.round(seg / 2));
  const v = new THREE.Vector3();
  // surface coordinates: around the x axis, and the meridian arc from the front pole (an even-spacing approximation)
  const total = Math.PI * (r.x + (r.y + r.z) / 2) / 2;
  const meta: GeoMeta = { th: [], s: [], total, circ: Math.PI * (r.y + r.z) };
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI;
    for (let j = 0; j < seg; j++) {
      const ph = (j / seg) * Math.PI * 2;
      v.set(Math.cos(th) * r.x, Math.sin(th) * Math.cos(ph) * r.y, Math.sin(th) * Math.sin(ph) * r.z);
      if (rot) v.applyQuaternion(rot);
      p.push(c.x + v.x, c.y + v.y, c.z + v.z);
      meta.th.push(j / seg);
      meta.s.push((i / rings) * total);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const cc = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      ind.push(a, cc, b, b, cc, d);
    }
  return [p, ind, meta];
}

/**
 * Planted-feet IK (animation pass): for each leg, pull its foot's neutral place in toward the coxa until the
 * foot can follow a stance sweep of ±`sweepMax` along the body (and a turn of ±`turnMax` round its centre)
 * without the leg running out of reach; the shader steers each foot round its neutral place.
 */
function plantHomes(rig: AntRig): void {
  const sweep = rig.length * 0.16;
  rig.home = [];
  let far = 0;
  for (let li = 0; li < 6; li++) {
    const C = rig.coxa[li];
    const K = rig.knee[li];
    const F = rig.foot![li];
    const r0 = Math.hypot(F.x - C.x, F.z - C.z);
    const ox = (F.x - C.x) / r0;
    const oz = (F.z - C.z) / r0;
    const kx = (K.x - C.x) * ox + (K.z - C.z) * oz;
    const ky = K.y - C.y;
    const fy = F.y - C.y;
    const la = Math.hypot(kx, ky);
    const lb = Math.hypot(r0 - kx, fy - ky);
    const maxH = Math.sqrt(Math.max(0, (la + lb) * (la + lb) * 0.9 - fy * fy));
    const minH = Math.sqrt(Math.max(0, (la - lb) * (la - lb) * 1.6 - fy * fy));
    let k = 0.95;
    for (; k > 0.5; k -= 0.01) {
      const nx = C.x + (F.x - C.x) * k;
      const nz = C.z + (F.z - C.z) * k;
      const a = Math.hypot(nx + sweep - C.x, nz - C.z);
      const b = Math.hypot(nx - sweep - C.x, nz - C.z);
      if (Math.max(a, b) <= maxH && Math.min(a, b) >= minH) break;
    }
    const h = new THREE.Vector3(C.x + (F.x - C.x) * k, F.y, C.z + (F.z - C.z) * k);
    rig.home.push(h);
    far = Math.max(far, Math.hypot(h.x, h.z));
  }
  rig.sweepMax = sweep;
  rig.turnMax = sweep / Math.max(far, 1e-3);
}

/** Flat 2D outline (u forward, v sideways) extruded vertically with thickness profile. */
function blade(outline: Array<[number, number]>, thick: (u: number) => number, droop: (u: number) => number): [number[], number[]] {
  const shapePts = outline.map(([u, v]) => new THREE.Vector2(u, v));
  const tris = THREE.ShapeUtils.triangulateShape(shapePts, []);
  const n = outline.length;
  const p: number[] = [];
  const ind: number[] = [];
  const umax = Math.max(...outline.map((o) => o[0])) || 1;
  for (const [u, v] of outline) {
    const t = thick(u / umax) * 0.5;
    const d = droop(u / umax);
    p.push(u, d + t, v);
  }
  for (const [u, v] of outline) {
    const t = thick(u / umax) * 0.5;
    const d = droop(u / umax);
    p.push(u, d - t, v);
  }
  // Orientation: outline may be clockwise; ensure top faces up.
  const area = outline.reduce((s, [u, v], i) => {
    const [u2, v2] = outline[(i + 1) % n];
    return s + (u * v2 - u2 * v);
  }, 0);
  const flip = area > 0;
  for (const t of tris) {
    if (flip) ind.push(t[0], t[1], t[2]);
    else ind.push(t[0], t[2], t[1]);
    if (flip) ind.push(n + t[0], n + t[2], n + t[1]);
    else ind.push(n + t[0], n + t[1], n + t[2]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (flip) ind.push(i, n + i, j, j, n + i, n + j);
    else ind.push(i, j, n + i, j, n + j, n + i);
  }
  return [p, ind];
}

export function transformPts(p: number[], m: THREE.Matrix4): number[] {
  const v = new THREE.Vector3();
  const out: number[] = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m);
    out[i] = v.x;
    out[i + 1] = v.y;
    out[i + 2] = v.z;
  }
  return out;
}

export const tmpC = new THREE.Color();
export const ss = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type Detail = 0 | 1;

const SETA_LOOK: PartLook = { color: 0, rough: 0.42, coat: 0.12, sheen: 0 };

/**
 * One erect seta (realism pass v2): a thin hair from `base` standing out along `out`, leaning back (and a
 * little to one side) and curving further back along its length, tapering to a fine point; `l` its length.
 */
function seta(acc: Acc, rng: Rng, base: THREE.Vector3, out: THREE.Vector3, l: number, Lm: number, part: number, color: THREE.Color, xform?: THREE.Matrix4, lean?: THREE.Vector3): void {
  const lv = lean ? lean.clone().normalize() : new THREE.Vector3(-1, 0, 0);
  const dir = out.clone().normalize();
  dir.addScaledVector(lv, rng.range(0.45, 1.2));
  dir.z += rng.range(-0.22, 0.22);
  dir.normalize();
  const bend = lv.clone().add(new THREE.Vector3(0, -0.3, rng.range(-0.25, 0.25))).normalize().multiplyScalar(rng.range(0.1, 0.4));
  const r0 = 0.0007 * Lm * rng.range(0.75, 1.2);
  const pts: THREE.Vector3[] = [];
  const rad: number[] = [];
  const N = 5;
  for (let k = 0; k < N; k++) {
    const t = k / (N - 1);
    pts.push(base.clone().addScaledVector(dir, l * t).addScaledVector(bend, l * t * t));
    rad.push(r0 * Math.max(0.06, 1 - 0.94 * Math.pow(t, 0.85)));
  }
  acc.hair(pts, rad, 4, part, color, SETA_LOOK, xform);
}

/** A hair length between len[0] and len[1] (× L), most of them short. */
const setaLen = (rng: Rng, len: [number, number], Lm: number) => (len[0] + (len[1] - len[0]) * Math.pow(rng.next(), 1.7)) * Lm;

/**
 * Erect setae on a lofted piece (LOD0, realism pass): fine tapering hairs standing out of the dorsal half
 * of the surface and the upper flanks, each from a vertex of the loft (`pts`, `radial` vertices a ring).
 */
function setaeOn(acc: Acc, rng: Rng, pts: number[], radial: number, nRings: number, ringY: (r: number) => number, part: number, count: number, len: [number, number], color: number, Lm: number, xform?: THREE.Matrix4): void {
  const col = new THREE.Color(color);
  for (let k = 0; k < count; k++) {
    const r = Math.floor(rng.range(1, nRings - 1));
    const a = rng.range(-0.3, Math.PI + 0.3);
    const j = Math.round((a / (Math.PI * 2)) * radial + radial) % radial;
    const i = (r * radial + j) * 3;
    const base = new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]);
    const out = new THREE.Vector3(0, base.y - ringY(r), base.z).normalize();
    seta(acc, rng, base, out, setaLen(rng, len, Lm), Lm, part, col, xform);
  }
}

/**
 * Build an ant. detail 0 = full (observe camera), 1 = medium.
 */
export function buildAnt(m: AntMorph, detail: Detail, seed = 1): BuiltAnt {
  if ((m as { builder?: string }).builder === 'hell') return buildHellAnt(m, detail, seed);
  const acc = new Acc();
  const rng = new Rng(seed * 101 + m.key.length * 7);
  const Lm = m.L;
  const hi = detail === 0;
  const RAD = hi ? 14 : 8;
  const ringsN = hi ? 16 : 9;
  const look = m.look;

  const solid = (look: PartLook) => () => tmpC.setHex(look.color);
  const grad = (look: PartLook, f: (x: number, y: number, z: number) => number) => (x: number, y: number, z: number) => {
    tmpC.setHex(look.color);
    if (look.color2 !== undefined) tmpC.lerp(new THREE.Color(look.color2), Math.max(0, Math.min(1, f(x, y, z))));
    return tmpC;
  };

  // ---------- layout ----------
  const mL = m.meso.len * Lm;
  const mW = m.meso.width * Lm;
  const mH = m.meso.height * Lm;
  const wL = m.waist.len * Lm;
  const gL = m.gaster.len * Lm;
  const gW = m.gaster.width * Lm;
  const gH = m.gaster.height * Lm;
  const hL = m.head.len * Lm;
  const hW = m.head.width * Lm;
  const hH = m.head.height * Lm;
  const stanceY = m.stance * Lm;
  const mBottom = stanceY; // ventral line of the mesosoma
  const neck = new THREE.Vector3(mL + 0.012 * Lm, mBottom + mH * 0.62, 0);

  // ---------- mesosoma ----------
  {
    const rings: Ring[] = [];
    const N = hi ? 22 : 12;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1); // 0 rear (propodeum) .. 1 front (pronotum)
      let top: number;
      let wid: number;
      if (m.meso.queen) {
        // queen: low propodeum, scutellum plate, big scutum dome, pronotum collar
        top = 0.45 + 0.5 * ss(0.0, 0.25, t) + 0.25 * Math.exp(-((t - 0.55) ** 2) / 0.03) + 0.1 * Math.exp(-((t - 0.3) ** 2) / 0.003) - 0.06 * Math.exp(-((t - 0.38) ** 2) / 0.0015) - 0.35 * ss(0.85, 1.0, t);
        wid = 0.6 + 0.4 * Math.exp(-((t - 0.6) ** 2) / 0.08) - 0.25 * ss(0.85, 1, t);
      } else {
        // worker profile: propodeum hump, metanotal groove, mesonotum, pronotum
        // `meso.smooth` (Saiy-Ants, Camponotus-like): one even arch, no metanotal groove or mesonotal bump
        const sm = (m.meso as { smooth?: boolean }).smooth ? 0 : 1;
        const prop = 0.62 * ss(0.0, 0.2, t);
        const groove = -0.16 * sm * Math.exp(-((t - 0.32) ** 2) / 0.003);
        const meso = 0.12 * sm * Math.exp(-((t - 0.48) ** 2) / 0.01);
        const pro = 0.36 * ss(0.4, 0.72, t) - 0.48 * ss(0.86, 1.0, t);
        top = 0.38 + prop + groove + meso + pro;
        wid = 0.62 + 0.38 * Math.exp(-((t - 0.78) ** 2) / 0.03) - 0.12 * Math.exp(-((t - 0.32) ** 2) / 0.01) - 0.35 * ss(0.9, 1.0, t);
      }
      const close = Math.pow(Math.min(1, t / 0.06), 0.5) * Math.pow(Math.min(1, (1 - t) / 0.05), 0.5);
      const height = mH * top * Math.max(0.12, close);
      // (realism v2: a rounder section — the promesonotum a convex dome, not a box)
      rings.push({ x: t * mL, y: mBottom + height * 0.5, rz: (mW / 2) * wid * Math.max(0.15, close), ry: height * 0.5, n: m.real ? 2.1 : 2.4 });
    }
    const [p, ind, meta] = loft(rings, RAD);
    acc.piece(
      p,
      ind,
      PART.BODY,
      grad(look.meso, (x, y) => (m.key.startsWith('formica') ? ss(0.55, 0.95, (y - mBottom) / mH) * ss(0.45, 0.65, x / mL) * 0.85 : 0)),
      look.meso,
      0,
      undefined,
      detOf(meta, REGION.MESO),
    );
    if (hi && m.setae?.meso) setaeOn(acc, rng, p, RAD, rings.length, (r) => rings[r].y, PART.BODY, m.setae.meso, m.setae.len ?? [0.03, 0.05], m.setae.color, Lm);
    // spines
    const sp = m.meso.spines;
    if (sp) {
      const spine = (x: number, yRel: number, zSide: number, dir: THREE.Vector3, len: number) => {
        if (len <= 0) return;
        for (const s of [-1, 1]) {
          const t = x / mL;
          const ringIdx = Math.round(t * (rings.length - 1));
          const rg = rings[ringIdx];
          const base = new THREE.Vector3(x, rg.y + rg.ry * yRel, s * rg.rz * zSide);
          const d = dir.clone();
          d.z *= s;
          d.normalize();
          const tip = base.clone().addScaledVector(d, len * Lm);
          const mid = base.clone().lerp(tip, 0.5);
          const [pp, ii] = tube([base, mid, tip], [0.022 * Lm, 0.012 * Lm, 0.002 * Lm], hi ? 6 : 4, true, true);
          acc.piece(pp, ii, PART.BODY, solid(look.meso), look.meso);
        }
      };
      spine(mL * 0.86, 0.3, 0.7, new THREE.Vector3(0.45, 0.35, 0.85), sp.pro ?? 0);
      spine(mL * 0.55, 0.8, 0.45, new THREE.Vector3(-0.25, 0.95, 0.35), sp.meso ?? 0);
      spine(mL * 0.1, 0.85, 0.5, new THREE.Vector3(-0.75, 0.6, 0.25), sp.prop ?? 0);
    }
    if (m.wingScars) {
      for (const s of [-1, 1]) {
        const [pp, ii] = ellipsoid(new THREE.Vector3(mL * 0.6, mBottom + mH * 0.62, s * mW * 0.5), new THREE.Vector3(0.025 * Lm, 0.012 * Lm, 0.006 * Lm), hi ? 8 : 6);
        acc.piece(pp, ii, PART.BODY, () => tmpC.setHex(0x1a1410), { color: 0x1a1410, rough: 0.5, coat: 0.2, sheen: 0 });
      }
    }
  }

  // ---------- neck (cervical connection, moves with the head) ----------
  {
    const a = new THREE.Vector3(mL - 0.04 * Lm, mBottom + mH * 0.55, 0);
    const b = neck.clone().add(new THREE.Vector3(0.05 * Lm, -0.005 * Lm, 0));
    const [pp, ii, meta] = tube([a, a.clone().lerp(b, 0.5), b], [mW * 0.22, mW * 0.17, mW * 0.2], hi ? 10 : 6);
    acc.piece(pp, ii, PART.HEAD, () => tmpC.setHex(look.meso.color).multiplyScalar(0.8), look.meso, 0, undefined, detOf(meta, REGION.MESO));
  }

  // ---------- head ----------
  const headRestPitch = -0.12;
  const headM = new THREE.Matrix4().compose(neck, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), headRestPitch), new THREE.Vector3(1, 1, 1));
  const hp = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(headM);
  let socketL = new THREE.Vector3();
  let socketR = new THREE.Vector3();
  let mandPivL = new THREE.Vector3();
  let mandPivR = new THREE.Vector3();
  const headCY = hH * 0.12;
  const headWidthAt = (t: number) => {
    const sh = m.head.shape;
    let w: number;
    if (sh === 'rect' && m.real) w = 0.9 + 0.1 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.6) - 0.11 * ss(0.6, 1, t); // jaws pass: a rounded square, the sides nearly parallel and the front still broad (photo fire_07; review: not an oval narrowing to the jaws)
    else if (sh === 'rect') w = 0.86 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 1.2)) - 0.12 * ss(0.7, 1, t);
    else if (sh === 'square') w = 0.9 + 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.15)) - 0.2 * ss(0.78, 1, t) - 0.12 * ss(0.3, 0, t); // parallel sides, rounded temples and front
    else if (sh === 'round') w = Math.sin(Math.PI * (0.12 + t * 0.8));
    else if (sh === 'tri') w = 1.0 - 0.38 * ss(0.3, 1.0, t) + 0.05 * Math.exp(-((t - 0.3) ** 2) / 0.02);
    else w = 0.98 + 0.08 * Math.exp(-((t - 0.25) ** 2) / 0.02) - 0.3 * ss(0.45, 1.0, t); // heart
    const close = Math.pow(Math.min(1, t / 0.13), 0.32) * Math.pow(Math.min(1, (1 - t) / 0.07), 0.45);
    return w * Math.max(0.12, close);
  };
  {
    const rings: Ring[] = [];
    const N = hi ? 18 : 10;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const w = headWidthAt(t);
      // jaws pass (realism morphs): a domed profile, highest behind the middle and sloping down to the clypeus
      const prof = m.real ? (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.92))) * (m.mandible.type === 'massive' ? 1 - 0.22 * ss(0.62, 1, t) : 1) : 0.85 + 0.15 * Math.sin(Math.PI * t);
      const ht = prof * Math.max(0.15, Math.pow(Math.min(1, t / 0.13), 0.32) * Math.pow(Math.min(1, (1 - t) / 0.07), 0.45));
      const yc = m.real ? headCY - ss(0.55, 1, t) * hH * 0.1 : headCY + (t > 0.8 ? (t - 0.8) * hH * 0.3 : 0);
      rings.push({ x: t * hL, y: yc, rz: (hW / 2) * w, ry: (hH / 2) * ht, n: m.real ? 2.1 : 2.3 });
    }
    const notch = (m.head.notch ?? 0) * hL;
    const [p, ind, meta] = loft(rings, hi ? 22 : RAD, (x, y, z, t) => {
      // heart-shaped posterior notch: midline pushed forward near the back
      let nx = x;
      if (notch > 0) {
        const lat = Math.min(1, Math.abs(z) / (hW * 0.5));
        nx += notch * Math.pow(1 - lat, 2) * Math.pow(1 - t, 3) * 1.6;
      }
      // flatter underside, slight dorsal median groove for heart heads (deeper when `groove` is set)
      let ny = y;
      if (y < headCY) ny = headCY - (headCY - y) * 0.85;
      const gDepth = m.head.groove ?? (notch > 0 ? 0.04 + notch / hL * 0.5 : 0);
      if (gDepth > 0 && y > headCY) ny -= Math.exp(-(z * z) / (hW * hW * 0.006)) * hH * gDepth * (1 - t * 0.7);
      return [nx, ny, z];
    });
    const headCol = grad(look.head, (x, y) => {
      if (m.key.startsWith('formica')) return ss(0.15, 0.95, x / hL) * 0.6 + ss(0.05, -0.4, (y - headCY) / hH) * 0.7;
      if (m.head.frontMix !== undefined) return (m.real ? Math.min(1, ss(0.3, 0.86, x / hL) + 0.35 * ss(0.5, 0.95, x / hL) * ss(0.05, -0.35, (y - headCY) / hH)) : ss(0.55, 1.0, x / hL)) * m.head.frontMix; // (realism: the face darkens gradually into the jaws, the lower front most)
      return ss(0.5, 1.0, x / hL) * 0.5;
    });
    acc.piece(transformPts(p, headM), ind, PART.HEAD, (x, y, z) => {
      // colour fn receives world coords; convert back approx using rest pose
      const lx = x - neck.x;
      const ly = y - neck.y;
      return headCol(lx, ly, z);
    }, look.head, 0, undefined, detOf(meta, REGION.HEAD));
    if (hi && m.setae?.head) setaeOn(acc, rng, p, hi ? 22 : RAD, rings.length, (r) => rings[r].y, PART.HEAD, m.setae.head, m.setae.len ?? [0.03, 0.05], m.setae.color, Lm, headM);

    // clypeus plate (jaws pass, realism morphs: a low plate set into the front of the head, its front margin
    // reaching over the closed jaws' bases, not a raised disc)
    // (spec jaws: a lobe projecting over the closed jaws' bases to just behind their cutting edges, filling the
    // space between them, as in Solenopsis; its size from the jaws' hinge distance `wzSpec`)
    const wzSpec = (hW / 2) * headWidthAt(0.95) * 0.84;
    const clypLobe = m.real && !!m.mandible.spec && m.mandible.type !== 'massive';
    const clypFront = clypLobe ? hL * 0.965 + wzSpec * 0.38 : 0;
    // (a major's massive jaws fill the front: no separate clypeus knob above them — jaws review)
    if (!(m.real && m.mandible.type === 'massive')) {
      const c = clypLobe ? new THREE.Vector3(hL * 0.965 - wzSpec * 0.07, headCY - hH * 0.1, 0) : m.real ? new THREE.Vector3(hL * 0.9, headCY + hH * 0.12, 0) : new THREE.Vector3(hL * 0.93, headCY + hH * 0.18, 0);
      const r = clypLobe ? new THREE.Vector3(wzSpec * 0.45, hH * 0.13, wzSpec * 0.86) : m.real ? new THREE.Vector3(hL * 0.085, hH * 0.11, hW * 0.27) : new THREE.Vector3(hL * 0.1, hH * 0.18, hW * 0.24);
      const [pp, ii] = ellipsoid(c, r, hi ? 16 : 6);
      // (realism: the head's own colour gradient, so a major's face darkens toward the jaws under it too)
      acc.piece(transformPts(pp, headM), ii, PART.HEAD, m.real ? (x, y, z) => headCol(x - neck.x, y - neck.y, z) : solid(look.head), look.head);
    }
    // clypeal carinae: two ridges running forward over the clypeus, ending in teeth on its front edge
    // (realism morphs: none — at game scale their ends read as upright prongs; jaws review)
    if (m.head.carinae && !m.real) {
      for (const s of [-1, 1]) {
        // realism (jaws pass): two low ridges along the clypeus ending in small teeth on its front margin
        // (on the clypeal lobe: low ridges lying on it, ending in small flat teeth on its front margin)
        const a = clypLobe ? new THREE.Vector3(hL * 0.86, headCY + hH * 0.12, s * hW * 0.065) : m.real ? new THREE.Vector3(hL * 0.88, headCY + hH * 0.2, s * hW * 0.07) : new THREE.Vector3(hL * 0.8, headCY + hH * 0.3, s * hW * 0.07);
        const b = clypLobe ? new THREE.Vector3(clypFront - wzSpec * 0.08, headCY - hH * 0.02, s * hW * 0.075) : m.real ? new THREE.Vector3(hL * 1.02, headCY + hH * 0.13, s * hW * 0.08) : new THREE.Vector3(hL * 1.0, headCY + hH * 0.2, s * hW * 0.085);
        const tip = clypLobe ? new THREE.Vector3(clypFront + m.head.carinae * Lm * 0.25, headCY - hH * 0.07, s * hW * 0.08) : new THREE.Vector3((m.real ? hL * 1.02 : hL * 1.0) + m.head.carinae * Lm * (m.real ? 0.15 : 1), headCY + hH * (m.real ? 0.06 : 0.06), s * hW * 0.085);
        const cr = clypLobe ? 0.3 : m.real ? 0.35 : 1;
        const [pp, ii] = tube([a, b, tip], [0.012 * Lm * cr, 0.011 * Lm * cr, 0.002 * Lm], hi ? 6 : 4, true, true);
        acc.piece(transformPts(pp, headM), ii, PART.HEAD, solid(look.head), look.head);
      }
    }
    // occipital spines
    if (m.head.occSpines) {
      for (const s of [-1, 1]) {
        const base = new THREE.Vector3(hL * 0.12, headCY + hH * 0.3, s * hW * 0.32);
        const tip = base.clone().add(new THREE.Vector3(-0.3, 0.6, s * 0.5).normalize().multiplyScalar(m.head.occSpines * Lm));
        const [pp, ii] = tube([base, base.clone().lerp(tip, 0.5), tip], [0.02 * Lm, 0.01 * Lm, 0.001 * Lm], 5);
        acc.piece(transformPts(pp, headM), ii, PART.HEAD, solid(look.head), look.head);
      }
    }
    // compound eyes (faceted in shader via flag 1)
    const eyeT = m.eyes.pos;
    const eyeR = (m.eyes.size * hL) / 2;
    // `eyes.smooth`: a smooth, glossy, near-black eye set flush (faint facets in the shader: flag 3)
    const smoothEye = !!(m.eyes as { smooth?: boolean }).smooth;
    const eyeZ = (hW / 2) * headWidthAt(eyeT) * 0.93 * (smoothEye ? 0.9 : 1);
    if (!m.eyes.none) for (const s of [-1, 1]) {
      const c = new THREE.Vector3(eyeT * hL, headCY + (hH / 2) * m.eyes.height, s * eyeZ);
      const r = m.eyes.single ? new THREE.Vector3(eyeR, eyeR, eyeR * 0.8) : new THREE.Vector3(eyeR * 1.15, eyeR * 0.95, eyeR * (m.real ? 0.78 : 0.6));
      const [pp, ii] = ellipsoid(c, r, hi ? (m.real ? 24 : 18) : 8);
      // realism v2: a bulging, glossy dome (the facets too fine to read except as a faint grain)
      const eyeLook: PartLook = smoothEye ? { color: 0, rough: 0.12, coat: 1, sheen: 0 } : m.real ? { color: 0x0b0806, rough: 0.16, coat: 0.7, sheen: 0 } : { color: 0x0b0806, rough: 0.32, coat: 0.15, sheen: 0 };
      acc.piece(transformPts(pp, headM), ii, PART.HEAD, () => tmpC.setHex(smoothEye ? 0x161c1a : m.eyes.single ? 0x2a1a10 : 0x0d0a08), eyeLook, smoothEye ? 3 : m.eyes.single ? 0 : 1);
    }
    if (m.eyes.ocelli && hi) {
      for (const [ox, oz] of [
        [0.3, 0],
        [0.24, -0.07],
        [0.24, 0.07],
      ]) {
        const c = new THREE.Vector3(hL * ox, headCY + hH * 0.47, hW * oz);
        const [pp, ii] = ellipsoid(c, new THREE.Vector3(0.012 * Lm, 0.008 * Lm, 0.012 * Lm), 8);
        acc.piece(transformPts(pp, headM), ii, PART.HEAD, () => tmpC.setHex(0x120c08), { color: 0, rough: 0.1, coat: 1, sheen: 0 });
      }
    }
    // (realism: near the front, close to the midline just behind the clypeus, as in Solenopsis — photo fire_07)
    socketL = m.real ? hp(hL * 0.88, headCY + hH * 0.27, -hW * 0.16) : hp(hL * 0.74, headCY + hH * 0.32, -hW * 0.17);
    socketR = m.real ? hp(hL * 0.88, headCY + hH * 0.27, hW * 0.16) : hp(hL * 0.74, headCY + hH * 0.32, hW * 0.17);
    mandPivL = hp(hL * 0.95, headCY - hH * 0.22, -hW * 0.26 * headWidthAt(0.95) / Math.max(0.3, headWidthAt(0.95)));
    mandPivR = hp(hL * 0.95, headCY - hH * 0.22, hW * 0.26 * headWidthAt(0.95) / Math.max(0.3, headWidthAt(0.95)));
    if (m.mandible.spec) {
      // jaws pass: hinged at the head's anterolateral corners, just under the front margin
      const wz = (hW / 2) * headWidthAt(0.95) * 0.84;
      // (massive jaws, a fire ant major's: set higher into the face, so their upper side continues the head's
      // front and the closed pair makes its blunt dark muzzle — jaws review)
      const big = m.mandible.type === 'massive';
      mandPivL = hp(hL * (big ? 0.93 : 0.965), headCY - hH * (big ? 0.07 : 0.16), -wz * (big ? 0.92 : 1));
      mandPivR = hp(hL * (big ? 0.93 : 0.965), headCY - hH * (big ? 0.07 : 0.16), wz * (big ? 0.92 : 1));
    }
    // frontal carinae ridges between the sockets (realism morphs: too low to show at this scale)
    if (hi && !m.real) {
      for (const s of [-1, 1]) {
        const a = new THREE.Vector3(hL * (m.real ? 0.66 : 0.55), headCY + hH * (m.real ? 0.36 : 0.42), s * hW * 0.12);
        const b = new THREE.Vector3(hL * 0.85, headCY + hH * (m.real ? 0.3 : 0.33), s * hW * 0.15);
        const fr = m.real ? 0.5 : 1;
        const [pp, ii] = tube([a, a.clone().lerp(b, 0.5), b], [0.008 * Lm * fr, 0.012 * Lm * fr, 0.008 * Lm * fr], 5);
        acc.piece(transformPts(pp, headM), ii, PART.HEAD, solid(look.head), look.head);
      }
    }
    // dark antennal sockets (army-ant majors: the pits round the antenna bases read dark on the pale head)
    if (hi && m.head.sockets) {
      for (const sock of [socketL, socketR]) {
        const [pp, ii] = ellipsoid(sock.clone().add(new THREE.Vector3(-0.012 * hL, 0, 0)), new THREE.Vector3(0.03 * hL, 0.03 * hL, 0.03 * hL), 8);
        acc.piece(pp, ii, PART.HEAD, () => tmpC.setHex(0x2e2418), { color: 0x2e2418, rough: 0.55, coat: 0.08, sheen: 0 });
      }
    }
  }

  // ---------- Saiy-Ants: six hair locks on a scalp cap (part 30) ----------
  const hair6 = (m as { hair6?: unknown }).hair6;
  if (hair6) buildHair6(acc, hair6, look, headM, hL, headCY, hi, rng);

  // ---------- frontal gland pore (Termants: a stubby termite nasus between the antenna bases) ----------
  if (m.head.pore) {
    const pr = m.head.pore;
    const root = new THREE.Vector3(hL * 0.9, headCY + hH * 0.42, 0);
    const dir = new THREE.Vector3(1, pr.up, 0).normalize();
    const len = pr.len * hL;
    const pts: THREE.Vector3[] = [];
    const rad: number[] = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push(root.clone().addScaledVector(dir, len * (t - 0.15)));
      rad.push(pr.r * hL * (1.25 * (1 - t) + 0.22));
    }
    const [pp, ii] = tube(pts, rad, hi ? 10 : 6, true, true);
    acc.piece(transformPts(pp, headM), ii, PART.HEAD, () => tmpC.setHex(look.head.color).lerp(new THREE.Color(look.mandible.color), 0.35), look.head);
    if (hi) {
      // glossy dark tip
      const tip = root.clone().addScaledVector(dir, len * 0.86);
      const [tp, ti] = ellipsoid(tip, new THREE.Vector3(pr.r * hL * 0.18, pr.r * hL * 0.22, pr.r * hL * 0.22), 6);
      acc.piece(transformPts(tp, headM), ti, PART.HEAD, () => tmpC.setHex(0x1c1c1c), { color: 0x1c1c1c, rough: 0.3, coat: 0.6, sheen: 0 });
    }
  }

  // ---------- mandibles ----------
  const mandLen = m.mandible.len * hL;
  const mandTips: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const piv = s < 0 ? mandPivL : mandPivR;
    const part = s < 0 ? PART.MAND_L : PART.MAND_R;
    const inwardToMid = Math.abs(piv.z);
    let pp: number[];
    let ii: number[];
    const mlook = look.mandible;
    if (m.mandible.spec) {
      // jaws pass: the shared parametric generator (render/anatomy/mandible.ts), its length fitted so the
      // closed pair overlaps a little on the midline in front of the clypeus
      const spec = fitLen(m.mandible.spec, inwardToMid * (m.mandible.spec.reach ?? 1.06));
      const mesh = buildMandible(hi ? spec : { ...spec, nu: 14, nv: 5, teeth: spec.teeth.slice(0, 2) }, s as 1 | -1);
      const mm = new THREE.Matrix4().compose(piv, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), headRestPitch), new THREE.Vector3(1, 1, 1));
      for (const pc of mesh.pieces) acc.pieceCols(transformPts(pc.pos, mm), pc.idx, part, pc.col, mlook, 0, detOf(pc.meta, REGION.MANDIBLE));
      mandTips.push(mesh.apex.clone().applyMatrix4(mm));
      continue;
    }
    if (m.mandible.type === 'falcate') {
      // Eciton soldier: long sickle hooks curving inward, tips crossing.
      const pts: THREE.Vector3[] = [];
      const rad: number[] = [];
      const segs = hi ? 14 : 7;
      // `hook` (army ants): the tip curls back inward over the last 38 % (fishhook / ice tongs), the inward curve deepens
      const hk = m.mandible.hook ?? 0;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const jj = Math.max(0, (t - 0.62) / 0.38);
        // Sickle: runs forward almost straight, then hooks sharply inward at the tip.
        const fwd = mandLen * (0.82 * Math.sin(Math.min(t, 0.8) / 0.8 * Math.PI * 0.42) + (t > 0.8 ? (t - 0.8) * 0.4 : 0)) - hk * mandLen * 0.3 * jj * jj;
        const hook = Math.pow(t, 3.2);
        const inn = (-mandLen * 0.06 * Math.sin(t * Math.PI) + hook * (inwardToMid * 1.15 + mandLen * 0.12)) * (1 + hk * 0.55);
        pts.push(new THREE.Vector3(fwd, -t * t * mandLen * 0.04 + Math.sin(t * Math.PI) * mandLen * 0.05, -s * inn));
        rad.push(mandLen * (0.05 * (1 - t) + 0.006));
      }
      [pp, ii] = tube(pts, rad, hi ? 8 : 5, true, true, 0.75);
      if (hi && m.mandible.barb) {
        // a small spur near the point, angled back along the blade, inward and up
        const kb = Math.round(segs * 0.84);
        const pb = pts[kb];
        const db = pts[kb - 2].clone().sub(pb).normalize();
        db.z -= s * 0.9;
        db.y += 0.25;
        db.normalize();
        const [bp, bi] = tube([pb.clone().addScaledVector(db, -mandLen * 0.01), pb.clone().addScaledVector(db, mandLen * 0.07), pb.clone().addScaledVector(db, mandLen * 0.13)], [mandLen * 0.032, mandLen * 0.018, mandLen * 0.003], 5, false, true);
        const off = pp.length / 3;
        pp = pp.concat(bp);
        ii = ii.concat(bi.map((q) => q + off));
      }
    } else {
      const massive = m.mandible.type === 'massive';
      const W = m.mandible.width * mandLen;
      const tipIn = inwardToMid * 1.18;
      const out: Array<[number, number]> = [];
      const N = hi ? 14 : 6;
      // outer margin: base → tip (curving inward)
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const a = t * (Math.PI / 2);
        out.push([Math.sin(a) * mandLen * (massive ? 0.9 : 0.86), (1 - Math.cos(a)) * tipIn * (massive ? 1.05 : 1)]);
      }
      // inner masticatory margin with teeth: tip → base inner corner
      const tipU = out[out.length - 1][0];
      const tipV = out[out.length - 1][1];
      const baseU = mandLen * 0.12;
      const baseV = W * 0.55;
      const teeth = hi ? m.mandible.teeth : Math.max(2, Math.round(m.mandible.teeth / 2));
      const M = teeth * 2;
      for (let i = 1; i <= M; i++) {
        const t = i / M;
        const u = tipU + (baseU - tipU) * t;
        const v = tipV + (baseV - tipV) * t;
        // tooth points stick inward (toward +v direction relative to the edge)
        const tooth = i % 2 === 1 ? 1 : 0;
        const size = (massive ? 0.07 : 0.05) * mandLen * (1 - t * 0.6);
        out.push([u - tooth * size * 0.3, v + tooth * size]);
      }
      out.push([0, W * 0.35]);
      const thick = (u: number) => mandLen * (massive ? 0.22 : 0.13) * (1 - u * 0.55);
      const droop = (u: number) => -u * u * mandLen * (massive ? 0.12 : 0.08);
      [pp, ii] = blade(out, thick, droop);
      // map v → -s*z (inward)
      for (let i = 0; i < pp.length; i += 3) pp[i + 2] = -s * pp[i + 2];
      if (s > 0) {
        // mirrored: flip winding
        for (let i = 0; i < ii.length; i += 3) {
          const t = ii[i + 1];
          ii[i + 1] = ii[i + 2];
          ii[i + 2] = t;
        }
      }
    }
    const mm = new THREE.Matrix4().compose(piv, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), headRestPitch - 0.08), new THREE.Vector3(1, 1, 1));
    const wp = transformPts(pp, mm);
    acc.piece(wp, ii, part, (x, y, z) => {
      tmpC.setHex(mlook.color);
      if (mlook.color2 !== undefined) tmpC.lerp(new THREE.Color(mlook.color2), ss(0.5, 1.0, (x - piv.x) / mandLen));
      else tmpC.lerp(new THREE.Color(0x0a0604), ss(0.6, 1.0, (x - piv.x) / (mandLen * 0.9)) * 0.7);
      return tmpC;
    }, mlook);
    mandTips.push(new THREE.Vector3(wp[wp.length - 3], wp[wp.length - 2], wp[wp.length - 1]));
  }

  // ---------- antennae ----------
  const scapeLen = m.antenna.scape * hL;
  const funLen = m.antenna.funiculus * scapeLen;
  const antThick = m.antenna.thick * Lm;
  const elbows: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const sock = s < 0 ? socketL : socketR;
    // Scape: forward-outward-up; funiculus: forward-outward-down (elbowed).
    const scDir = new THREE.Vector3(0.72, 0.14, 0.68 * s).normalize();
    const elbow = sock.clone().addScaledVector(scDir, scapeLen);
    elbows.push(elbow);
    const scMid = sock.clone().lerp(elbow, 0.5).add(new THREE.Vector3(0, scapeLen * 0.04, 0));
    const [p1, i1, m1] = tube([sock, scMid, elbow], [antThick * 0.8, antThick * 0.95, antThick * 1.15], hi ? 7 : 5, true, true);
    acc.piece(p1, i1, s < 0 ? PART.SCAPE_L : PART.SCAPE_R, grad(look.antenna, () => 0), look.antenna, 0, undefined, detOf(m1, REGION.ANTENNA));
    // funiculus
    const fDir = m.real ? new THREE.Vector3(0.8, -0.45, -0.2 * s).normalize() : new THREE.Vector3(0.86, -0.36, 0.3 * s).normalize();
    const nseg = m.antenna.segments - 1;
    const clubN = m.antenna.club;
    const lens: number[] = [];
    for (let i = 0; i < nseg; i++) {
      let l = 1;
      if (i === 0) l = 1.15; // pedicel
      if (clubN > 0 && i >= nseg - clubN) l = 1.9;
      else if (clubN === 0) l = 1 + 0.25 * (i / nseg);
      if (i === nseg - 1) l *= 1.35;
      lens.push(l);
    }
    const tot = lens.reduce((a, b) => a + b, 0);
    let cur = elbow.clone();
    const funPart = s < 0 ? PART.FUNI_L : PART.FUNI_R;
    const funColor = grad(look.antenna, (x, y, z) => ss(0.3, 1.0, cur.distanceTo(elbow) / funLen));
    // `antenna.smooth`: smooth cylindrical segments (the tube) even at full detail
    if (hi && !(m.antenna as { smooth?: boolean }).smooth) {
      for (let i = 0; i < nseg; i++) {
        const segL = (lens[i] / tot) * funLen;
        // slight downward curl toward the tip
        const d = fDir.clone().add(new THREE.Vector3(0, -0.25 * (i / nseg), 0)).normalize();
        const c = cur.clone().addScaledVector(d, segL * 0.5);
        let r = antThick * (0.62 + 0.3 * (i / nseg)) * (1 + (m.antenna.bead ?? 0) * 0.45 * (i / nseg));
        if (clubN > 0 && i >= nseg - clubN) r = antThick * (1.25 + 0.15 * (i - (nseg - clubN)));
        const col = grad(look.antenna, () => ss(0.2, 1.0, i / nseg))(0, 0, 0).clone();
        if (m.real) {
          // realism v2: each segment a short cylinder widening toward its tip (obconical), close-set
          const nxt = cur.clone().addScaledVector(d, segL);
          const club = clubN > 0 && i >= nseg - clubN;
          const rr = club ? [r * 0.8, r * 0.98, r, r * 0.9] : [r * 0.88, r * 0.95, r, r * 0.97];
          // closed at both ends (an open end would show the background through the joint)
          const [pp, ii, fm] = tube([cur.clone().addScaledVector(d, -segL * 0.06), cur.clone().lerp(nxt, 0.25), cur.clone().lerp(nxt, 0.8), nxt.clone().addScaledVector(d, -segL * 0.02)], rr, 9, true, true);
          acc.piece(pp, ii, funPart, () => col, look.antenna, 0, undefined, detOf(fm, REGION.ANTENNA));
        } else {
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d);
          const [pp, ii] = ellipsoid(c, new THREE.Vector3(segL * 0.62, r, r), 8, q);
          acc.piece(pp, ii, funPart, () => col, look.antenna);
        }
        cur = cur.addScaledVector(d, segL);
      }
    } else {
      const pts: THREE.Vector3[] = [elbow.clone()];
      const rad: number[] = [antThick * 0.8];
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        const d = fDir.clone().add(new THREE.Vector3(0, -0.25 * t, 0)).normalize();
        pts.push(pts[pts.length - 1].clone().addScaledVector(d, funLen / 4));
        rad.push(antThick * (clubN > 0 && t > 0.6 ? 1.6 : 0.8 + 0.3 * t));
      }
      const [pp, ii, fm] = tube(pts, rad, 5, true, true);
      acc.piece(pp, ii, funPart, funColor, look.antenna, 0, undefined, detOf(fm, REGION.ANTENNA));
    }
    void funColor;
  }

  // ---------- waist ----------
  const waistPivot = new THREE.Vector3(0, mBottom + mH * 0.35, 0);
  const gasterFront = new THREE.Vector3(-wL, mBottom + mH * 0.3, 0);
  {
    const wl = look.waist;
    // peduncle
    const wk = m.waist.thick ?? 1;
    const [p0, i0, m0] = tube([waistPivot.clone().add(new THREE.Vector3(0.01 * Lm, 0, 0)), new THREE.Vector3(-wL * 0.35, mBottom + mH * 0.28, 0)], [0.035 * Lm * wk, 0.03 * Lm * wk], hi ? 8 : 6);
    acc.piece(p0, i0, PART.WAIST, solid(wl), wl, 0, undefined, detOf(m0, REGION.WAIST));
    const nodeH = m.waist.nodeH * Lm;
    if (m.waist.nodes === 1) {
      // formicine scale: thin upright plate, top slightly notched (Lasius)
      const c = new THREE.Vector3(-wL * 0.45, mBottom + mH * 0.28 + nodeH * 0.38, 0);
      const [pp, ii] = ellipsoid(c, new THREE.Vector3(0.025 * Lm * Math.max(1, wk * 0.7), nodeH * 0.55, mW * 0.42 * Math.max(1, wk * 0.45)), hi ? 12 : 8, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.18));
      if (m.key.startsWith('lasius'))
        for (let i = 0; i < pp.length; i += 3) {
          const top = pp[i + 1] - c.y;
          if (top > nodeH * 0.4) pp[i + 1] -= Math.exp(-(pp[i + 2] * pp[i + 2]) / (mW * mW * 0.01)) * nodeH * 0.12;
        }
      acc.piece(pp, ii, PART.WAIST, solid(wl), wl);
      const [p2, i2] = tube([new THREE.Vector3(-wL * 0.4, mBottom + mH * 0.26, 0), gasterFront], [0.03 * Lm * wk, 0.035 * Lm * wk], hi ? 8 : 6);
      acc.piece(p2, i2, PART.WAIST, solid(wl), wl);
    } else {
      // myrmicine: petiole node + postpetiole node
      const W = m.waist;
      const c1 = new THREE.Vector3(-wL * 0.32, mBottom + mH * 0.3 + nodeH * 0.3, 0);
      const [pp, ii, pm] = ellipsoid(c1, new THREE.Vector3(wL * (W.crest ? 0.13 : 0.18), nodeH * 0.5, mW * (W.petW ?? 0.28)), hi ? 12 : 8);
      if (W.crest)
        // cuneate node: squeeze the top into a fairly sharp crest
        for (let i = 0; i < pp.length; i += 3) {
          const up = (pp[i + 1] - c1.y) / (nodeH * 0.5);
          if (up > 0) pp[i] = c1.x + (pp[i] - c1.x) * (1 - 0.55 * up * up);
        }
      acc.piece(pp, ii, PART.WAIST, solid(wl), wl, 0, undefined, detOf(pm, REGION.WAIST));
      if (W.subTooth) {
        // small tooth under the front of the petiole, pointing down and forward
        const base = new THREE.Vector3(-wL * 0.24, mBottom + mH * 0.26, 0);
        const tip = base.clone().add(new THREE.Vector3(0.35, -1, 0).normalize().multiplyScalar(W.subTooth * Lm));
        const [pt, it] = tube([base, tip], [0.016 * Lm, 0.002 * Lm], hi ? 5 : 4, true, true);
        acc.piece(pt, it, PART.WAIST, solid(wl), wl);
      }
      const postH = W.postH ?? 0.9;
      const c2 = new THREE.Vector3(-wL * 0.75, mBottom + mH * 0.3 + nodeH * 0.18 * postH, 0);
      const [p2, i2, m2] = ellipsoid(c2, new THREE.Vector3(wL * 0.2, nodeH * 0.5 * postH, mW * (W.postW ?? 0.36)), hi ? 12 : 8);
      acc.piece(p2, i2, PART.WAIST, solid(wl), wl, 0, undefined, detOf(m2, REGION.WAIST));
      const [p3, i3] = tube([new THREE.Vector3(-wL * 0.45, mBottom + mH * 0.26, 0), new THREE.Vector3(-wL * 0.6, mBottom + mH * 0.26, 0)], [0.028 * Lm, 0.028 * Lm], 6);
      acc.piece(p3, i3, PART.WAIST, solid(wl), wl);
    }
  }

  // ---------- gaster ----------
  const gasterPivot = gasterFront.clone();
  let gasterTip = new THREE.Vector3();
  {
    const rings: Ring[] = [];
    const G = m.gaster;
    // plated gasters (`stripes`) get many more rings so narrow membranes survive the per-vertex colour
    // (army-ant queen: `stripeW` stripes need many rings so the narrow membranes survive the per-vertex colour)
    const fine = G.stripes && G.stripeW !== undefined;
    const N = hi ? (fine ? 72 : m.real ? 56 : 22) : fine ? 36 : 12;
    // realism v2: four overlapping tergites — each plate's front tucked under the margin of the one before
    // (the same places as the seams in the baked detail, recipes.ts FIRE_ANT gaster bands)
    const plates = [0.44, 0.63, 0.79, 0.91];
    const gl = look.gaster;
    const bands = G.segs ? Array.from({ length: G.segs - 1 }, (_, q) => 0.1 + (0.85 * (q + 1)) / G.segs!) : [0.27, 0.47, 0.64, 0.79, 0.9];
    const cy = gasterFront.y + gH * 0.08;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      let e = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.03)), 0.62);
      e *= 1 - 0.18 * ss(0.75, 1.0, t);
      let groove = 0;
      if (hi && m.real) {
        for (const b of plates) if (t > b) groove += 0.028 * Math.exp(-(t - b) / 0.03);
      } else if (hi) for (const b of bands) groove += 0.035 * Math.exp(-((t - b) ** 2) / 0.0006);
      const close = Math.pow(Math.min(1, t / 0.07), 0.5);
      const front = 0.32 + 0.68 * close;
      rings.push({ x: -wL - t * gL, y: cy + e * gH * 0.04 - t * t * gH * 0.12, rz: (gW / 2) * e * front * (1 - groove), ry: (gH / 2) * e * front * (1 - groove), n: 2.1 });
    }
    const [p, ind, gmeta] = loft(rings, RAD);
    const gasterCol = G.segs
      ? (x: number, y: number) => {
          // segment bands (`segs`) and hard plate/membrane stripes on the joints (`stripes`, `stripeW`)
          const u = Math.max(0, Math.min(1, (-wL - x) / gL));
          tmpC.setHex(gl.color);
          let band = 0;
          for (const j of bands) band = Math.max(band, Math.exp(-((u - j) ** 2) / 4e-4));
          if (G.stripes && G.stripeW !== undefined) {
            // army-ant queen: plates and pale membranes centred on the segment joints
            const u2 = (u - 0.1) / 0.85;
            const ph = u2 * G.stripes;
            const fr = ph - Math.floor(ph);
            const sw = G.stripeW * 0.5;
            if (u2 > 0 && u2 < 1 && (fr < sw || fr > 1 - sw)) band = Math.max(band, 0.9);
          } else if (G.stripes) {
            // Termant queen: hard tergite stripes
            const ph = u * G.stripes;
            if (ph - Math.floor(ph) < 0.42) band = Math.max(band, 0.85);
          }
          if (gl.color2 !== undefined) tmpC.lerp(new THREE.Color(gl.color2), band * 0.8);
          if (G.gut !== undefined) {
            // dark gut contents showing through low on the underside, strongest 45 % of the way back
            const dy = (y - cy) / (gH * 0.5);
            const gutW = Math.exp(-((u - 0.45) ** 2) / 0.05) * (1 - Math.min(1, Math.abs(dy + 0.25) * 1.1));
            tmpC.lerp(new THREE.Color(G.gut), Math.max(0, gutW) * 0.85 * (1 - band));
          }
          return tmpC;
        }
      : grad(gl, (x) => ss(-wL - gL * 0.25, -wL, x) * 0.8);
    acc.piece(p, ind, PART.GASTER, gasterCol, gl, 0, undefined, detOf(gmeta, REGION.GASTER));
    gasterTip = new THREE.Vector3(-wL - gL, cy - gH * 0.1, 0);
    if (m.gaster.sting) {
      const a = gasterTip.clone().add(new THREE.Vector3(0.01 * Lm, 0, 0));
      const b = gasterTip.clone().add(new THREE.Vector3(-0.06 * Lm, -0.012 * Lm, 0));
      const [pp, ii] = tube([a, b], [0.012 * Lm, 0.001 * Lm], 5);
      // flag 2: the sting slides out of the gaster tip while stinging (vertex shader)
      acc.piece(pp, ii, PART.GASTER, () => tmpC.setHex(0x3a2210), { color: 0, rough: 0.3, coat: 0.5, sheen: 0 }, 2);
    } else if (hi) {
      // acidopore: ring of short hairs (coronula) around a round opening
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const base = gasterTip.clone().add(new THREE.Vector3(0.008 * Lm, Math.sin(a) * 0.015 * Lm, Math.cos(a) * 0.015 * Lm));
        const tip = base.clone().add(new THREE.Vector3(-0.025 * Lm, Math.sin(a) * 0.012 * Lm, Math.cos(a) * 0.012 * Lm));
        const [pp, ii] = tube([base, tip], [0.003 * Lm, 0.0006 * Lm], 3, false, true);
        acc.piece(pp, ii, PART.GASTER, () => tmpC.setHex(0x8a7050), { color: 0, rough: 0.6, coat: 0, sheen: 0 });
      }
    }
    // Erect setae on the gaster and head (LOD0)
    if (hi && m.hair > 0) {
      const n = m.setae?.gaster ?? Math.round(m.hair * 70);
      const hairCol = m.setae?.color ?? 0x6e5c44;
      const hairLen = m.setae?.len ?? [0.022, 0.045];
      const hc = new THREE.Color(hairCol);
      for (let k = 0; k < n; k++) {
        const t = rng.range(0.1, 0.92);
        const ang = m.real ? rng.range(-0.75, Math.PI + 0.75) : rng.range(-0.2, Math.PI + 0.2); // dorsal-ish half (realism v2: round to the sides)
        const ri = Math.round(t * (N - 1));
        const rg = rings[ri];
        const base = new THREE.Vector3(rg.x, rg.y + Math.sin(ang) * rg.ry * 0.97, Math.cos(ang) * rg.rz * 0.97);
        const nrm = new THREE.Vector3(0, Math.sin(ang), Math.cos(ang)).normalize();
        if (m.real) {
          // realism v2: curved, tapered setae of varied length (gaster sides too)
          seta(acc, rng, base, nrm, setaLen(rng, hairLen, Lm), Lm, PART.GASTER, hc);
          continue;
        }
        nrm.x -= 0.35;
        nrm.normalize();
        const len = rng.range(hairLen[0], hairLen[1]) * Lm;
        const tip = base.clone().addScaledVector(nrm, len);
        const [pp, ii] = tube([base, tip], [0.0022 * Lm, 0.0004 * Lm], 3, false, true);
        acc.piece(pp, ii, PART.GASTER, () => tmpC.setHex(hairCol), m.setae ? { color: 0, rough: 0.6, coat: 0.1, sheen: 0.15 } : { color: 0, rough: 0.7, coat: 0, sheen: 0.1 });
      }
    }
  }

  // ---------- legs ----------
  const legFactor = m.legs.hind;
  const coxaX = [mL * 0.8, mL * 0.46, mL * 0.24];
  const rig: AntRig = {
    coxa: [],
    knee: [],
    ankle: [],
    axis: [],
    neck: neck.clone(),
    mandL: mandPivL.clone(),
    mandR: mandPivR.clone(),
    antL: socketL.clone(),
    antR: socketR.clone(),
    elbL: elbows[0].clone(),
    elbR: elbows[1].clone(),
    gasterPivot,
    waistPivot,
    length: 0,
    stride: 0,
    stance: stanceY,
    q0: 0.34,
    headTip: new THREE.Vector3(),
    gasterTip,
    mouth: hp(hL * 1.02, headCY - hH * 0.15, 0),
  };
  // how far each mandible swings open at full gape (the generator's species set their own)
  if (m.mandible.open !== undefined) (rig as AntRig & { mandOpen?: number }).mandOpen = m.mandible.open;
  // front of the hair (Saiy-Ants): pivot for the stretch / flutter in the shader
  const h6 = (m as { hair6?: { spikes: Array<{ at: number[] }> } }).hair6;
  (rig as AntRig & { crest?: THREE.Vector3 }).crest = hp(hL * ((h6?.spikes?.[0]?.at?.[0] ?? 0.1) + 0.5), headCY + (h6?.spikes?.[0]?.at?.[1] ?? 0.3) * hL, 0);
  let reachSum = 0;
  for (let li = 0; li < 6; li++) {
    const pair = Math.floor(li / 2);
    const side = li % 2 === 0 ? -1 : 1;
    const legLen = m.legs.hind * Lm * [0.8, 0.9, 1][pair];
    const cL = legLen * 0.14;
    const tL = legLen * 0.05;
    const fL = legLen * 0.32;
    const tiL = legLen * 0.28;
    const taL = legLen * (m.real ? 0.17 : 0.21);
    const base = new THREE.Vector3(coxaX[pair], mBottom + mH * 0.12, side * mW * 0.28);
    const outward = [0.55, 0.15, -0.35][pair];
    const coxaDir = new THREE.Vector3(outward * 0.6, -0.62, side * 0.62).normalize();
    const coxaEnd = base.clone().addScaledVector(coxaDir, cL);
    const trEnd = coxaEnd.clone().addScaledVector(new THREE.Vector3(outward * 0.4, -0.2, side * 0.9).normalize(), tL);
    // foot rest targets
    let foot: THREE.Vector3;
    if (pair === 0) foot = new THREE.Vector3(coxaX[0] + 0.26 * Lm * legFactor, 0, side * 0.4 * Lm * legFactor);
    else if (pair === 1) foot = new THREE.Vector3(coxaX[1] - 0.03 * Lm, 0, side * 0.56 * Lm * legFactor);
    else foot = new THREE.Vector3(coxaX[2] - 0.42 * Lm * legFactor, 0, side * 0.46 * Lm * legFactor);
    const hdir = foot.clone().sub(trEnd).setY(0).normalize();
    const tarsDir = hdir.clone().multiplyScalar(Math.cos(0.4)).add(new THREE.Vector3(0, -Math.sin(0.4), 0)).normalize();
    // Place the ankle so femur+tibia are ~88% extended along the target direction:
    // keeps knees near the dorsum height like real ants (legs splayed, not arched).
    const ankleY = taL * Math.sin(0.4);
    const d = (fL + tiL) * 0.88;
    const dy = trEnd.y - ankleY;
    const r = Math.sqrt(Math.max(0.0001, d * d - dy * dy));
    const ankle = new THREE.Vector3(trEnd.x + hdir.x * r, ankleY, trEnd.z + hdir.z * r);
    foot = ankle.clone().addScaledVector(tarsDir, taL);
    const e1 = ankle.clone().sub(trEnd).normalize();
    const upv = new THREE.Vector3(0, 1, 0);
    const u = upv.clone().sub(e1.clone().multiplyScalar(upv.dot(e1))).normalize();
    const cosA = (fL * fL + d * d - tiL * tiL) / (2 * fL * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const knee = trEnd.clone().addScaledVector(e1, fL * cosA).addScaledVector(u, fL * sinA);
    const o = foot.clone().sub(base).setY(0).normalize();
    const axis = new THREE.Vector3().crossVectors(o, upv).normalize();
    rig.coxa.push(base.clone());
    (rig.foot ??= []).push(foot.clone());
    rig.knee.push(knee.clone());
    rig.ankle.push(ankle.clone());
    rig.axis.push(axis);
    reachSum += Math.hypot(foot.x - base.x, foot.z - base.z);

    const ll = look.legs;
    const lcol = grad(ll, (x, y) => ss(0.3, 0.0, y / Math.max(0.01, stanceY)) * 0.8);
    const th = m.legs.thick * Lm;
    const pid = PART.LEG0 + li * 3;
    // coxa
    {
      const [pp, ii, cm] = tube([base, base.clone().lerp(coxaEnd, 0.5), coxaEnd], [th * 1.35, th * 1.45, th * 1.15], hi ? 8 : 5);
      acc.piece(pp, ii, pid, lcol, ll, 0, undefined, detOf(cm, REGION.LEG));
    }
    // trochanter
    {
      const [pp, ii] = ellipsoid(coxaEnd.clone().lerp(trEnd, 0.5), new THREE.Vector3(tL * 0.7, th * 1.05, th * 1.05), hi ? 8 : 5, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), trEnd.clone().sub(coxaEnd).normalize()));
      acc.piece(pp, ii, pid, lcol, ll);
    }
    // femur (swollen middle, flattened)
    {
      const pts: THREE.Vector3[] = [];
      const rad: number[] = [];
      const n = hi ? 7 : 4;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push(trEnd.clone().lerp(knee, t));
        // realism v2: a narrow neck at the trochanter, the club, and the knee condyles
        rad.push(m.real && hi ? th * (0.72 + 0.68 * Math.sin(Math.PI * Math.pow(t, 0.8)) - 0.12 * t + 0.14 * ss(0.86, 1, t)) : th * (0.88 + 0.26 * Math.sin(Math.PI * Math.pow(t, 0.8)) - 0.1 * t));
      }
      const [pp, ii, fm] = tube(pts, rad, hi ? 8 : 5, true, true, m.real && hi ? 0.68 : 0.8);
      acc.piece(pp, ii, pid, lcol, ll, 0, undefined, detOf(fm, REGION.LEG));
    }
    // tibia
    {
      const pts: THREE.Vector3[] = [];
      const rad: number[] = [];
      const n = hi ? 6 : 3;
      const nT = m.real && hi ? 8 : n;
      for (let i = 0; i <= nT; i++) {
        const t = i / nT;
        pts.push(knee.clone().lerp(ankle, t));
        // realism v2: thin just below the knee, widening to the apex (where the spur and tarsus attach)
        rad.push(m.real && hi ? th * (0.56 + 0.2 * ss(0.0, 0.2, t) + 0.1 * t + 0.12 * ss(0.84, 1, t)) : th * (0.78 - 0.12 * t + 0.1 * ss(0.85, 1, t)));
      }
      const [pp, ii, tm] = m.real && hi ? tube(pts, rad, 8, true, true, 0.82) : tube(pts, rad, hi ? 7 : 5);
      acc.piece(pp, ii, pid + 1, lcol, ll, 0, undefined, detOf(tm, REGION.LEG));
      if (hi) {
        // apical spur; the fore leg spur is the pectinate strigil (antenna cleaner)
        const sp0 = ankle.clone().lerp(knee, 0.04);
        const spd = ankle.clone().sub(knee).normalize().add(new THREE.Vector3(0, -0.3, 0).add(o.clone().multiplyScalar(-0.4))).normalize();
        const spLen = pair === 0 ? taL * 0.28 : taL * 0.14;
        const [p2, i2] = tube([sp0, sp0.clone().addScaledVector(spd, spLen * 0.5).add(new THREE.Vector3(0, spLen * 0.08, 0)), sp0.clone().addScaledVector(spd, spLen)], [th * 0.35, th * 0.25, th * 0.05], 4, false, true);
        acc.piece(p2, i2, pid + 1, () => tmpC.setHex(ll.color2 ?? ll.color), ll);
        if (pair === 0) {
          for (let k = 0; k < 5; k++) {
            const cpt = sp0.clone().addScaledVector(spd, spLen * (0.25 + k * 0.15));
            const [p3, i3] = tube([cpt, cpt.clone().add(o.clone().multiplyScalar(-th * 0.6)).add(new THREE.Vector3(0, -th * 0.2, 0))], [th * 0.08, th * 0.02], 3, false, true);
            acc.piece(p3, i3, pid + 1, () => tmpC.setHex(ll.color2 ?? ll.color), ll);
          }
        }
      }
    }
    // tarsus: 5 tarsomeres + claws
    {
      const tcol = grad(ll, () => 1);
      if (hi) {
        const shares = [0.4, 0.15, 0.13, 0.12, 0.2];
        let cur = ankle.clone();
        for (let k = 0; k < 5; k++) {
          const segL = taL * shares[k];
          const dir = tarsDir.clone().add(new THREE.Vector3(0, 0.12 * k, 0)).normalize();
          const nxt = cur.clone().addScaledVector(dir, segL);
          const r0 = th * (0.55 - k * 0.05);
          const [pp, ii, tsm] = tube([cur, cur.clone().lerp(nxt, 0.5), nxt], [r0 * 0.75, r0, r0 * 0.85], 6);
          acc.piece(pp, ii, pid + 2, tcol, ll, 0, undefined, detOf(tsm, REGION.TARSUS));
          cur = nxt;
        }
        for (const cs of [-1, 1]) {
          const side2 = new THREE.Vector3().crossVectors(tarsDir, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(cs * th * 0.25);
          const c0 = cur.clone().add(side2);
          const c1 = c0.clone().addScaledVector(tarsDir, th * 0.9).add(new THREE.Vector3(0, -th * 0.2, 0));
          const c2 = c1.clone().add(new THREE.Vector3(0, -th * 0.55, 0)).addScaledVector(tarsDir, -th * 0.1);
          const [pp, ii] = tube([c0, c1, c2], [th * 0.18, th * 0.12, th * 0.02], 4, false, true);
          acc.piece(pp, ii, pid + 2, () => tmpC.setHex(0x1a1008), { color: 0, rough: 0.3, coat: 0.6, sheen: 0 });
        }
      } else {
        const tip = ankle.clone().addScaledVector(tarsDir, taL);
        const [pp, ii, tsm] = tube([ankle, ankle.clone().lerp(tip, 0.5), tip], [th * 0.5, th * 0.42, th * 0.3], 4);
        acc.piece(pp, ii, pid + 2, tcol, ll, 0, undefined, detOf(tsm, REGION.TARSUS));
      }
    }
    // realism v2: a knee joint (the membrane between femur and tibia), and erect setae along femur and tibia
    if (hi && m.real) {
      const kd = knee.clone().sub(trEnd).normalize();
      const [pk, ik] = ellipsoid(knee.clone().addScaledVector(kd, -th * 0.2), new THREE.Vector3(th * 0.45, th * 0.5, th * 0.5), 8, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), kd));
      acc.piece(pk, ik, pid + 1, () => tmpC.setHex(ll.color).multiplyScalar(0.7), ll);
      const hc = new THREE.Color(m.setae?.color ?? 0x7a6448);
      const segs: Array<[THREE.Vector3, THREE.Vector3, number, number]> = [
        [trEnd, knee, pid, 5],
        [knee, ankle, pid + 1, 6],
      ];
      for (const [a0, a1, prt, cnt] of segs) {
        const dl = a1.clone().sub(a0).normalize();
        for (let k = 0; k < cnt; k++) {
          const t = rng.range(0.12, 0.92);
          const b0 = a0.clone().lerp(a1, t);
          const ang = rng.range(0, Math.PI * 2);
          const side1 = new THREE.Vector3().crossVectors(dl, upv).normalize();
          const up1 = new THREE.Vector3().crossVectors(side1, dl).normalize();
          const out = side1.multiplyScalar(Math.cos(ang)).addScaledVector(up1, Math.sin(ang) * 0.7 + 0.3).normalize();
          seta(acc, rng, b0.clone().addScaledVector(out, th * 0.6), out, setaLen(rng, [0.02, 0.05], Lm), Lm, prt, hc, undefined, dl);
        }
      }
    }
    // erect hairs on tibiae (Lasius diagnostic) and scapes
    if (hi && m.hair > 0.4 && !m.real) {
      for (let k = 0; k < 4; k++) {
        const t = 0.2 + k * 0.18;
        const b = knee.clone().lerp(ankle, t);
        const dir = new THREE.Vector3().crossVectors(ankle.clone().sub(knee).normalize(), axis).normalize().multiplyScalar(-1);
        const [pp, ii] = tube([b, b.clone().addScaledVector(dir.add(new THREE.Vector3(0, 0.3, 0)).normalize(), th * 1.4)], [th * 0.1, th * 0.02], 3, false, true);
        acc.piece(pp, ii, pid + 1, () => tmpC.setHex(0x7a6448), ll);
      }
    }
  }

  const geometry = acc.build();
  // realism v2: occlusion in the crevices and joints, worn convex edges (render/bake/occlusion.ts)
  if (hi && m.real) bakeOcclusion(geometry, { radius: 0.06 * Lm, skip: acc.skipOcc });
  // Rig numbers
  const minX = rig.gasterTip.x;
  const maxX = Math.max(mandTips[0].x, mandTips[1].x, neck.x + hL);
  rig.headTip.set(maxX, neck.y, 0);
  rig.length = maxX - minX;
  const reach = reachSum / 6;
  const duty = m.gait?.duty ?? 0.55;
  rig.q0 = 0.34;
  rig.stride = (2 * rig.q0 * reach) / duty;

  // Centre the ant: put the midpoint between gaster tip and head tip at x = 0.
  const cx = (minX + maxX) / 2;
  geometry.translate(-cx, 0, 0);
  const shift = (v: THREE.Vector3) => v.set(v.x - cx, v.y, v.z);
  rig.coxa.forEach(shift);
  rig.foot?.forEach(shift);
  rig.knee.forEach(shift);
  rig.ankle.forEach(shift);
  [rig.neck, rig.mandL, rig.mandR, rig.antL, rig.antR, rig.elbL, rig.elbR, rig.gasterPivot, rig.waistPivot, rig.headTip, rig.gasterTip, rig.mouth, (rig as AntRig & { crest: THREE.Vector3 }).crest].forEach(shift);
  if (rig.foot) plantHomes(rig);
  // army ants: high-stepping gait, the queen's physogastry, and where a porter's load hangs under the body
  if (m.gait) {
    rig.gaitLift = m.gait.lift;
    rig.gaitDuty = m.gait.duty;
  }
  if (m.gaster.physo) rig.physo = m.gaster.physo;
  if (m.gaster.soft) rig.soft = m.gaster.soft;
  rig.carryUnder = new THREE.Vector3((rig.coxa[0].x + rig.coxa[2].x) / 2, Math.min(rig.coxa[0].y, rig.coxa[2].y) - 0.045 * Lm, 0);
  geometry.computeBoundingSphere();
  return { geometry, rig };
}
