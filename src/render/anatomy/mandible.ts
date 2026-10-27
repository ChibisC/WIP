import * as THREE from 'three';
import type { GeoMeta } from '../ants/antGeometry';

/**
 * Shared parametric mandible generator (jaws pass, docs/realism/jaws.md).
 *
 * A mandible is described the way an entomologist would draw it (each species' numbers are in its
 * docs/creatures/<id>.md "Mandibles" section):
 *  - a centreline from the hinge to the apex, bent by a heading curve (`yaw`, + inward toward the
 *    body's midline) and an elevation curve (`pitch`, + up);
 *  - the top-view outline as distances from that centreline to the outer and the inner (cutting) margins;
 *  - a dorso-ventral thickness profile, the cross-section a superellipse whose inner edge can be sharp
 *    (a wedge) and whose outer edge is rounded — the bevel;
 *  - teeth: triangular points on the inner margin (each sized, leaning toward the apex or the base, sharp
 *    or blunt), and tines: separate blades branching off (a stag beetle's big inner tooth, the fork at
 *    the tip);
 *  - colours darkening toward the apex and on the teeth.
 *
 * The 2D outline is extruded with the thickness profile and bent along the centreline in one go: every
 * cross-section (a ring from the outer margin over the top to the inner margin and back underneath) is
 * placed in the centreline's frame. Units: the hinge (pivot) at the origin, the rest direction +x, +y
 * up; the mandible belongs to body side `side` (+1 = +z), so inward is −side·z.
 */

export type Curve = ReadonlyArray<readonly [number, number]>;

/** Smooth, overshoot-free interpolation through control points [u, value] (u ascending; Fritsch–Butland slopes). */
export function curveAt(c: Curve, u: number): number {
  const n = c.length;
  if (n === 1 || u <= c[0][0]) return c[0][1];
  if (u >= c[n - 1][0]) return c[n - 1][1];
  let i = 0;
  while (u > c[i + 1][0]) i++;
  const d = (k: number) => (c[k + 1][1] - c[k][1]) / (c[k + 1][0] - c[k][0]);
  const m = (k: number) => {
    if (k === 0) return d(0);
    if (k === n - 1) return d(n - 2);
    const a = d(k - 1);
    const b = d(k);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  const h = c[i + 1][0] - c[i][0];
  const t = (u - c[i][0]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * c[i][1] + (t3 - 2 * t2 + t) * h * m(i) + (-2 * t3 + 3 * t2) * c[i + 1][1] + (t3 - t2) * h * m(i + 1);
}

export interface ToothSpec {
  /** where along the blade its point is (0 hinge … 1 apex) */
  u: number;
  /** how far the point stands out of the inner margin (fraction of the mandible length) */
  size: number;
  /** half the length of its base along the margin (fraction of u) */
  base: number;
  /** −1..1: the point leans toward the hinge (−) or the apex (+) */
  lean?: number;
  /** 0 sharp … 1 a rounded crown (worn, milling teeth) */
  blunt?: number;
}

export interface TineSpec {
  /** where it branches off (0..1 along the blade) */
  u: number;
  /** length, base width and base thickness (fractions of the mandible length) */
  len: number;
  width: number;
  thick: number;
  /** its direction against the blade's at u: yaw (+ toward the inner margin), pitch (+ up), and its curl (yaw change over its length) */
  yaw: number;
  pitch: number;
  curl?: number;
  /** where across the blade its root sits: −1 outer margin … +1 inner margin */
  across?: number;
  /** how fast it narrows (1 = linear) */
  taper?: number;
}

export interface MandibleSpec {
  /** hinge → apex along the centreline (model units) */
  len: number;
  /** heading of the centreline along the blade (rad, + inward), control points [u, yaw] */
  yaw: Curve;
  /** elevation of the centreline (rad, + up) */
  pitch: Curve;
  /** top-view outline: distance from the centreline to the outer and to the inner margin (fractions of len) */
  outer: Curve;
  inner: Curve;
  /** dorso-ventral thickness (fraction of len) */
  thick: Curve;
  /** cross-section exponents at the inner (cutting) edge and the outer edge: 1 a wedge, 2 round, > 2 boxy */
  edgeIn: number;
  edgeOut: number;
  /** thickness left at the very edge (fraction of the local thickness): the bevel */
  edgeMin?: number;
  /** the underside is this much flatter than the top (0..1) */
  flatBelow?: number;
  teeth: ToothSpec[];
  tines?: TineSpec[];
  /** colours (sRGB hex): hinge → middle → apex; teeth and tines darken toward their points */
  color: { base: number; mid?: number; tip: number; teeth?: number; dark?: readonly [number, number] };
  /** a rounded heel this long (fraction of len) behind the hinge, where the base sits in the head (0: cut flat) */
  baseRound?: number;
  /** samples along the blade and across each half of the cross-section */
  nu?: number;
  nv?: number;
}

/** One closed piece of the mandible (the blade or a tine): positions, indices, sRGB-linear colours, surface coordinates. */
export interface MandiblePiece {
  pos: number[];
  idx: number[];
  col: number[];
  meta: GeoMeta;
}

export interface MandibleMesh {
  pieces: MandiblePiece[];
  /** the apex of the blade, and every point (blade apex, tooth points, tine tips) */
  apex: THREE.Vector3;
  tips: THREE.Vector3[];
}

interface Frame {
  p: THREE.Vector3;
  T: THREE.Vector3;
  In: THREE.Vector3;
  Up: THREE.Vector3;
}

const TABLE = 200;

/** The centreline: positions and frames at TABLE + 1 even steps of u (unit length; scale by len). */
function centreline(yaw: Curve, pitch: Curve, side: number): Frame[] {
  const out: Frame[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= TABLE; i++) {
    const u = i / TABLE;
    const y = curveAt(yaw, u);
    const pt = curveAt(pitch, u);
    const T = new THREE.Vector3(Math.cos(pt) * Math.cos(y), Math.sin(pt), -side * Math.cos(pt) * Math.sin(y));
    const In = new THREE.Vector3(-Math.sin(y), 0, -side * Math.cos(y));
    const Up = new THREE.Vector3().crossVectors(T, In).multiplyScalar(side).normalize();
    out.push({ p: p.clone(), T, In, Up });
    // integrate with the mid-step heading (one step ahead)
    const um = (i + 0.5) / TABLE;
    const ym = curveAt(yaw, um);
    const pm = curveAt(pitch, um);
    p.x += (Math.cos(pm) * Math.cos(ym)) / TABLE;
    p.y += Math.sin(pm) / TABLE;
    p.z += (-side * Math.cos(pm) * Math.sin(ym)) / TABLE;
  }
  return out;
}

function frameAt(tab: Frame[], u: number, out: Frame): Frame {
  const f = Math.max(0, Math.min(TABLE, u * TABLE));
  const i = Math.min(TABLE - 1, Math.floor(f));
  const t = f - i;
  const a = tab[i];
  const b = tab[i + 1];
  out.p.copy(a.p).lerp(b.p, t);
  out.T.copy(a.T).lerp(b.T, t).normalize();
  out.In.copy(a.In).lerp(b.In, t).normalize();
  out.Up.copy(a.Up).lerp(b.Up, t).normalize();
  return out;
}

/** The inner margin's tooth bump at u (fraction of len) and how much of it is tooth (0..1). */
function teethAt(teeth: ToothSpec[], u: number): [number, number] {
  let add = 0;
  let k = 0;
  for (const t of teeth) {
    const lean = t.lean ?? 0;
    const b0 = t.base * (1 - lean * 0.8);
    const b1 = t.base * (1 + lean * 0.8);
    const d = u - t.u;
    let h = d < 0 ? 1 + d / b0 : 1 - d / b1;
    if (h <= 0) continue;
    // a sharp triangle, or a rounded crown when blunt
    const bl = t.blunt ?? 0;
    h = h * (1 - bl) + (0.5 - 0.5 * Math.cos(Math.PI * h)) * Math.sqrt(h) * bl * 1.15;
    const v = t.size * Math.min(1, h);
    if (v > add) {
      add = v;
      k = Math.min(1, h);
    }
  }
  return [add, k];
}

const _f = { p: new THREE.Vector3(), T: new THREE.Vector3(), In: new THREE.Vector3(), Up: new THREE.Vector3() };
const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** Colour along the mandible (uEff 0 hinge … 1 apex), darker on a tooth (k 0..1). */
function colourAt(spec: MandibleSpec, uEff: number, k: number, out: THREE.Color): THREE.Color {
  const C = spec.color;
  const [d0, d1] = C.dark ?? [0.55, 1.0];
  const s = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  out.setHex(C.base);
  if (C.mid !== undefined) out.lerp(_c2.setHex(C.mid), s(0.05, d0, uEff));
  out.lerp(_c2.setHex(C.tip), s(d0, d1, uEff));
  if (k > 0) out.lerp(_c2.setHex(C.teeth ?? C.tip), Math.min(1, k * 1.2));
  return out;
}

/**
 * Sweep one blade (the main blade, or a tine on its own little centreline): rings across the outline at
 * each sample, bevelled at the edges, closed at both ends; outward-facing.
 */
function sweepBlade(
  frames: Frame[],
  us: number[],
  len: number,
  outer: (u: number) => number,
  inner: (u: number) => [number, number],
  thick: (u: number) => number,
  spec: MandibleSpec,
  colourU: (u: number) => number,
  nv: number,
): MandiblePiece & { tipPts: THREE.Vector3[] } {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const meta: GeoMeta = { th: [], s: [], total: 0, circ: 0 };
  const eMin = spec.edgeMin ?? 0.12;
  const below = 1 - (spec.flatBelow ?? 0.15);
  const M = nv * 2;
  // cosine spacing across: denser at the edges
  const ss: number[] = [];
  for (let j = 0; j < nv; j++) ss.push(-Math.cos((Math.PI * j) / (nv - 1)));
  const prof = (s: number) => {
    const e = s < 0 ? spec.edgeOut : spec.edgeIn;
    const a = Math.min(1, Math.abs(s));
    return Math.max(eMin, Math.pow(Math.max(0, 1 - Math.pow(a, e)), 1 / e));
  };
  let along = 0;
  let girth = 0;
  const prev = new THREE.Vector3();
  const tipPts: THREE.Vector3[] = [];
  let bestTooth = -1;
  let bestK = 0;
  for (let r = 0; r < us.length; r++) {
    const u = us[r];
    const f = frames[r];
    if (r > 0) along += f.p.distanceTo(prev);
    prev.copy(f.p);
    const o = outer(u) * len;
    const [iv, k] = inner(u);
    const i = iv * len;
    const h = thick(u) * len;
    girth += 2 * (o + i) + Math.PI * h * 0.5;
    const cu = colourU(u);
    // top: outer → inner; bottom: inner → outer
    for (let half = 0; half < 2; half++)
      for (let jj = 0; jj < nv; jj++) {
        const j = half === 0 ? jj : nv - 1 - jj;
        const s = ss[j];
        const v = s < 0 ? s * o : s * i;
        const y = (half === 0 ? 0.5 : -0.5 * below) * h * prof(s);
        pos.push(f.p.x + f.In.x * v + f.Up.x * y, f.p.y + f.In.y * v + f.Up.y * y, f.p.z + f.In.z * v + f.Up.z * y);
        // teeth (beyond the plain margin) and the cutting edge darker
        const tk = s > 0 ? k * Math.max(0, (s - 0.4) / 0.6) : 0;
        colourAt(spec, cu, tk, _c);
        col.push(_c.r, _c.g, _c.b);
        meta.th.push((half * nv + jj) / M);
        meta.s.push(along);
      }
    // the most prominent tooth point on this ring
    if (k > bestK + 1e-6 || (k > 0.999 && bestTooth < 0)) {
      bestK = k;
      bestTooth = r;
    }
    if (k > 0.999) {
      const b = (r * M + nv - 1) * 3;
      tipPts.push(new THREE.Vector3(pos[b], pos[b + 1], pos[b + 2]));
    }
  }
  const R = us.length;
  for (let r = 0; r < R - 1; r++)
    for (let j = 0; j < M; j++) {
      const a = r * M + j;
      const b = r * M + ((j + 1) % M);
      const c = a + M;
      const d = b + M;
      idx.push(a, c, b, b, c, d);
    }
  // caps: the hinge end and the apex
  const f0 = frames[0];
  const fN = frames[R - 1];
  const c0 = pos.length / 3;
  pos.push(f0.p.x - f0.T.x * 0.02 * len, f0.p.y - f0.T.y * 0.02 * len, f0.p.z - f0.T.z * 0.02 * len);
  colourAt(spec, colourU(us[0]), 0, _c);
  col.push(_c.r, _c.g, _c.b);
  meta.th.push(-1);
  meta.s.push(0);
  for (let j = 0; j < M; j++) idx.push(c0, (j + 1) % M, j);
  const c1 = pos.length / 3;
  const tipW = Math.max(outer(us[R - 1]), inner(us[R - 1])[0]) * len;
  const apex = new THREE.Vector3().copy(fN.p).addScaledVector(fN.T, tipW * 0.5 + 0.004 * len);
  pos.push(apex.x, apex.y, apex.z);
  colourAt(spec, colourU(us[R - 1]), 0, _c);
  col.push(_c.r, _c.g, _c.b);
  meta.th.push(-1);
  meta.s.push(along);
  const o = (R - 1) * M;
  for (let j = 0; j < M; j++) idx.push(c1, o + j, o + ((j + 1) % M));
  tipPts.unshift(apex);
  meta.total = along;
  meta.circ = girth / R;
  // outward winding: the enclosed volume must come out positive
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0)
    for (let t = 0; t < idx.length; t += 3) {
      const x = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = x;
    }
  return { pos, idx, col, meta, tipPts };
}

/** Build a mandible for body side `side` (+1 = +z). */
export function buildMandible(spec: MandibleSpec, side: 1 | -1): MandibleMesh {
  const len = spec.len;
  const nu = spec.nu ?? 40;
  const nv = spec.nv ?? 9;
  const tab = centreline(spec.yaw, spec.pitch, side);
  // samples along: even, plus every tooth's point and base ends (so the points are sharp)
  const set: number[] = [];
  for (let i = 0; i <= nu; i++) set.push(i / nu);
  for (const t of spec.teeth) {
    const lean = t.lean ?? 0;
    const b0 = t.base * (1 - lean * 0.8);
    const b1 = t.base * (1 + lean * 0.8);
    for (const x of [t.u - b0, t.u - b0 * 0.5, t.u, t.u + b1 * 0.5, t.u + b1]) if (x > 0 && x < 1) set.push(x);
  }
  set.sort((a, b) => a - b);
  const us: number[] = [];
  for (const u of set) if (!us.length || u - us[us.length - 1] > 2e-4) us.push(u);
  // a rounded heel behind the hinge (the condyle seated in the head) instead of a flat cut: the outline and
  // thickness close over a quarter ellipse, the centreline carried straight back
  const rb = spec.baseRound ?? 0;
  if (rb > 0) {
    const nh = 7;
    for (let k = nh; k >= 1; k--) us.unshift(-rb * Math.sin(((Math.PI / 2) * k) / nh));
  }
  const heel = (u: number) => (u >= 0 ? 1 : Math.max(0.06, Math.sqrt(Math.max(0, 1 - (u / rb) ** 2))));
  const f0 = frameAt(tab, 0, { p: new THREE.Vector3(), T: new THREE.Vector3(), In: new THREE.Vector3(), Up: new THREE.Vector3() });
  const frames: Frame[] = us.map((u) => {
    if (u < 0) return { p: f0.p.clone().multiplyScalar(len).addScaledVector(f0.T, u * len), T: f0.T.clone(), In: f0.In.clone(), Up: f0.Up.clone() };
    const f = frameAt(tab, u, _f);
    return { p: f.p.clone().multiplyScalar(len), T: f.T.clone(), In: f.In.clone(), Up: f.Up.clone() };
  });
  const blade = sweepBlade(
    frames,
    us,
    len,
    (u) => curveAt(spec.outer, Math.max(0, u)) * heel(u),
    (u) => {
      if (u < 0) return [curveAt(spec.inner, 0) * heel(u), 0];
      const [add, k] = teethAt(spec.teeth, u);
      return [curveAt(spec.inner, u) + add, k];
    },
    (u) => curveAt(spec.thick, Math.max(0, u)) * Math.pow(heel(u), 0.6),
    spec,
    (u) => Math.max(0, u),
    nv,
  );
  const pieces: MandiblePiece[] = [blade];
  const tips: THREE.Vector3[] = [...blade.tipPts];
  // tines: their own short centrelines, rooted inside the blade
  for (const tn of spec.tines ?? []) {
    const f = frameAt(tab, tn.u, _f);
    const across = tn.across ?? 0.6;
    const off = across >= 0 ? across * (curveAt(spec.inner, tn.u) + teethAt(spec.teeth, tn.u)[0]) : across * curveAt(spec.outer, tn.u);
    const root = f.p.clone().multiplyScalar(len).addScaledVector(f.In, off * len);
    const T0 = f.T.clone();
    const In0 = f.In.clone();
    const Up0 = f.Up.clone();
    const n = 14;
    const tf: Frame[] = [];
    const tus: number[] = [];
    const p = root.clone().addScaledVector(T0, 0);
    const dirAt = (t: number) => {
      const yaw = tn.yaw + (tn.curl ?? 0) * t;
      // turn the blade's tangent toward its inner side (yaw) and up (pitch)
      const d = T0.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(In0, Math.sin(yaw));
      return d.multiplyScalar(Math.cos(tn.pitch)).addScaledVector(Up0, Math.sin(tn.pitch)).normalize();
    };
    // start a little inside the blade so the root is buried
    p.addScaledVector(dirAt(0), -tn.width * len * 0.45);
    const step = (tn.len * len + tn.width * len * 0.45) / n;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const d = dirAt(t);
      // the tine's own frame: inner side = the blade's inner side turned with it, up = perpendicular
      const In = new THREE.Vector3().crossVectors(Up0, d).multiplyScalar(side);
      if (In.dot(In0) < 0) In.negate();
      In.addScaledVector(d, -In.dot(d)).normalize();
      const Up = new THREE.Vector3().crossVectors(d, In).multiplyScalar(side).normalize();
      if (Up.dot(Up0) < 0) Up.negate();
      tf.push({ p: p.clone(), T: d.clone(), In, Up });
      tus.push(t);
      p.addScaledVector(d, step);
    }
    const tp = tn.taper ?? 1;
    const w = (t: number) => (tn.width * 0.5) * Math.max(0.06, Math.pow(1 - t, tp) * (1 - 0.25 * t)) / 1;
    const piece = sweepBlade(
      tf,
      tus,
      len,
      w,
      (t) => [w(t), 0],
      (t) => tn.thick * Math.max(0.12, 1 - 0.75 * t),
      { ...spec, edgeIn: Math.max(1.3, spec.edgeIn), edgeOut: Math.max(1.3, spec.edgeIn) },
      (t) => tn.u + (1 - tn.u) * t,
      Math.max(6, Math.round(nv * 0.7)),
    );
    pieces.push(piece);
    tips.push(piece.tipPts[0]);
  }
  return { pieces, apex: blade.tipPts[0].clone(), tips };
}

/** Where the apex lands (unit length) for a spec: forward (x) and inward (toward the midline). */
export function apexOf(spec: MandibleSpec): { fwd: number; inward: number; up: number } {
  const tab = centreline(spec.yaw, spec.pitch, 1);
  const e = tab[TABLE].p;
  return { fwd: e.x, inward: -e.z, up: e.y };
}

/**
 * The same mandible bent more or less (the heading change along the blade scaled by `k`, its starting angle
 * kept) — used to make a pair close on the midline: see `fitBend`.
 */
export function bent(spec: MandibleSpec, k: number): MandibleSpec {
  const y0 = spec.yaw[0][1];
  return { ...spec, yaw: spec.yaw.map(([u, y]) => [u, y0 + (y - y0) * k] as const) };
}

/** Scale the bend so the apex reaches `inward` (model units) toward the midline: a closed pair meets in front of the head. */
export function fitBend(spec: MandibleSpec, inward: number): MandibleSpec {
  let lo = 0.1;
  let hi = 2.5;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (apexOf(bent(spec, mid)).inward * spec.len < inward) lo = mid;
    else hi = mid;
  }
  return bent(spec, (lo + hi) / 2);
}

/** The same mandible scaled so its apex reaches `inward` (model units) toward the midline (the bend kept). */
export function fitLen(spec: MandibleSpec, inward: number): MandibleSpec {
  const a = apexOf(spec).inward;
  return { ...spec, len: inward / Math.max(0.05, a) };
}

/** Merge a mandible's pieces into flat arrays (for tools and tests). */
export function mergedMandible(m: MandibleMesh): { pos: number[]; idx: number[] } {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const p of m.pieces) {
    const o = pos.length / 3;
    pos.push(...p.pos);
    for (const i of p.idx) idx.push(i + o);
  }
  return { pos, idx };
}
