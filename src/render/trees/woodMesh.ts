import * as THREE from 'three';
import type { CanopyData } from '../../sim/trees';
import type { CrownSkel, WoodPiece } from '../../sim/treeCrowns';
import { TREES as T } from '../../sim/balance';
import { addPatch, dapplePatch, globalUniforms, WORLD_POS_PATCH } from '../shaderPatch';
import { BARK_COUNT, BARK_LAYER, BARK_TILE, TreeMaps } from './barkBake';
import { shadowOnly } from '../shadowOnly';

/**
 * Trees v2 (CHANGE_PLAN §38.2): the crowns' skeletons (sim/treeCrowns.ts) as round 3D wood.
 *
 * Every piece is a tube along its axis, tapering with its radius, swollen where it leaves its parent; where it is
 * walked its section is flat-topped (a superellipse above, round below) with the top exactly at the floor's height — so
 * feet stand on the drawn wood and never sink — and the floor's rounding at the walkable band's edge is the same curve
 * (`floorDrop`). The trunk rises from the ground far below to its crotch, a round column with a flat, rounded-off top.
 * Bark UVs are in millimetres (round the wood, along it), so each species' baked bark tile (barkBake.ts) keeps its real
 * size on a twig and a trunk alike. Pieces are grouped by tree and 256 mm cell into chunks, each a `THREE.LOD` of two
 * meshes (fine near, coarse far), culled by the frustum like any mesh.
 */

/** traffic on a kind of wood (the worn trails on its top: smoother, lighter) */
const WEAR: Record<string, number> = { trunk: 0, limb: 0.7, branch: 0.4, twig: 0.15, link: 1 };
/** the walked section's superellipse exponent (|a|^P + |b|^P = 1 above the axis: a little fuller than a circle, so the
 * walked band on top stays within a millimetre of flat) */
const P = 2.5;

export interface WoodLod {
  radial: number;
  /** the rings' spacing in a piece's flare (elsewhere a ring at each node: the wood runs straight between them) */
  step: number;
  /** rings rounding a piece's end */
  cap: number;
}
/** near: 14 sides, the end rounded by three rings; far (beyond `WOOD_FAR` mm from the camera): 7 sides, one ring */
export const WOOD_LODS: WoodLod[] = [
  { radial: 14, step: 3.5, cap: 3 },
  { radial: 7, step: 9, cap: 1 },
];
export const WOOD_FAR = 420;

/** How far below the wood's top its surface lies at `u` (the share of the radius out from the axis): the floor's rounding. */
export function floorDrop(r: number, u: number): number {
  const a = Math.min(1, Math.abs(u));
  return r * (1 - Math.pow(1 - Math.pow(a, P), 1 / P));
}

class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  tan: number[] = [];
  bark: number[] = [];
  wood: number[] = [];
  idx: number[] = [];
  get n(): number {
    return this.pos.length / 3;
  }
  vert(p: THREE.Vector3, n: THREE.Vector3, t: THREE.Vector3, u: number, v: number, top: number, r: number, layer: number, wear: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.tan.push(t.x, t.y, t.z);
    this.bark.push(u, v);
    this.wood.push(top, r, layer, wear);
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aTanU', new THREE.Float32BufferAttribute(this.tan, 3));
    g.setAttribute('aBark', new THREE.Float32BufferAttribute(this.bark, 2));
    g.setAttribute('aWood', new THREE.Float32BufferAttribute(this.wood, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** the section at angle φ (0 on top): lateral and vertical offsets (× r) and the outward normal there */
function section(phi: number, flat: boolean, out: number[]): void {
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  if (flat && c > 0) {
    const a = Math.sign(s) * Math.pow(Math.abs(s), 2 / P);
    const b = Math.pow(c, 2 / P);
    // (the normal of |a|^P + |b|^P = 1: (a^(P−1), b^(P−1)))
    const na = Math.sign(a) * Math.pow(Math.abs(a), P - 1);
    const nb = Math.pow(b, P - 1);
    const l = Math.hypot(na, nb) || 1;
    out[0] = a;
    out[1] = b;
    out[2] = na / l;
    out[3] = nb / l;
  } else {
    out[0] = s;
    out[1] = c;
    out[2] = s;
    out[3] = c;
  }
}

const sec = [0, 0, 0, 0];
const vC = new THREE.Vector3();
const vT = new THREE.Vector3();
const vN = new THREE.Vector3();
const vL = new THREE.Vector3();
const vP = new THREE.Vector3();
const vn = new THREE.Vector3();
const vt = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function frame(t: THREE.Vector3): void {
  vN.copy(UP).addScaledVector(t, -t.dot(UP));
  if (vN.lengthSq() < 1e-6) vN.set(1, 0, 0).addScaledVector(t, -t.x);
  vN.normalize();
  vL.crossVectors(t, vN).normalize();
}

/** a stable small hash of a piece (its bark offset) */
function hash01(a: number, b: number): number {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h ^= h >>> 13;
  return ((h >>> 0) % 10007) / 10007;
}

/** a limb's swelling where it comes out of the crotch's bulb: how far along it starts */
interface Collar {
  at: number;
}

interface Ring {
  c: THREE.Vector3;
  t: THREE.Vector3;
  r: number;
  s: number;
  /** a collar's swelling: the section this much wider, and deeper below its middle (its top stays the floor's) */
  f?: number;
}

/** A walked (or round) piece of wood: rings along its axis, a rounded cap at its end (and at its start for a link). */
function tube(g: Geo, p: WoodPiece, layer: number, lod: WoodLod, seed: number, startFlare: boolean, s0 = 0, collar?: Collar): void {
  const nodes = p.nodes;
  if (nodes.length < 2) return;
  const flat = p.walk;
  const wear = flat ? WEAR[p.kind] ?? 0.2 : 0;
  // (the fine twigs and lianas, a few millimetres thick: fewer sides, longer rings)
  const thin = !p.walk && p.nodes[0].r < 4;
  if (thin) lod = { radial: Math.max(4, Math.round(lod.radial * 0.4)), step: lod.step * 2.2, cap: 1 };
  // the axis: the wood's top is the floor (z), so its centre is a radius below it — and lower where it swells
  const r0 = nodes[0].r;
  // (the swelling where it leaves its parent: from its start; a limb's where it comes out of the crotch's bulb)
  const fAt = s0 + (collar?.at ?? 0);
  const flareLen = (collar ? 1.8 : 1.6) * r0;
  const amp = collar ? 0.3 : 0.3;
  const rings: Ring[] = [];
  let s = s0;
  // (a collar swells in over most of a radius before its full width, so it has no step)
  const ramp = collar ? 0.8 * r0 : 0;
  const radiusAt = (r: number, sAlong: number) => {
    if (!startFlare || sAlong < fAt - ramp || sAlong - fAt >= flareLen) return r;
    if (sAlong < fAt) {
      const q = (sAlong - (fAt - ramp)) / ramp;
      return r * (1 + amp * q * q * (3 - 2 * q));
    }
    return r * (1 + amp * Math.pow(1 - (sAlong - fAt) / flareLen, 2));
  };
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    // (between two nodes the wood runs straight and its radius changes evenly: rings there would add nothing but
    // triangles — only the flare at a piece's start, which swells as a curve, is ringed: a quarter of its length or
    // `step` apart, whichever is longer — the curve then misses by under a tenth of a millimetre on a limb of 20)
    const n = startFlare && s + len > fAt - ramp && s - fAt < flareLen ? Math.max(1, Math.ceil(len / Math.max(lod.step, flareLen / 4))) : 1;
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const rb = a.r + (b.r - a.r) * u;
      const rf = radiusAt(rb, s + len * u);
      // (a collar keeps the wood's middle and top and swells its sides and underside; elsewhere the whole section
      // swells, its top kept at the floor)
      const r = collar ? rb : rf;
      const f = collar ? rf / rb : 1;
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u;
      const z = a.z + (b.z - a.z) * u;
      const t = new THREE.Vector3(b.x - a.x, b.z - a.z, b.y - a.y).normalize();
      if (k === 0 && i > 0) {
        const pa = nodes[i - 1];
        t.add(new THREE.Vector3(a.x - pa.x, a.z - pa.z, a.y - pa.y).normalize()).normalize();
      }
      rings.push({ c: new THREE.Vector3(x, flat ? z - r : z, y), t, r, s: s + len * u, f });
    }
    s += len;
  }
  const e = nodes[nodes.length - 1];
  const pe = nodes[nodes.length - 2];
  const te = new THREE.Vector3(e.x - pe.x, e.z - pe.z, e.y - pe.y).normalize();
  rings.push({ c: new THREE.Vector3(e.x, flat ? e.z - e.r : e.z, e.y), t: te, r: e.r, s });
  // the bark: millimetres round the wood (its mean radius) and along it, a random offset a piece
  let rm = 0;
  for (const rg of rings) rm += rg.r;
  rm /= rings.length;
  const circ = 2 * Math.PI * rm;
  const ou = hash01(seed, 1) * 200;
  const ov = hash01(seed, 2) * 200;
  const R = lod.radial;
  const ringVerts = (rg: Ring, scale: number, fwd: number, capN: number) => {
    frame(rg.t);
    const base = g.n;
    for (let j = 0; j <= R; j++) {
      const phi = Math.PI + (2 * Math.PI * j) / R;
      section(phi, flat, sec);
      const fl = rg.f ?? 1;
      const fv = sec[1] < 0 ? fl : 1;
      vP.copy(rg.c).addScaledVector(rg.t, fwd * rg.r).addScaledVector(vL, sec[0] * rg.r * scale * fl).addScaledVector(vN, sec[1] * rg.r * scale * fv);
      vn.copy(vL).multiplyScalar((sec[2] / fl) * (1 - capN)).addScaledVector(vN, (sec[3] / fv) * (1 - capN)).addScaledVector(rg.t, capN).normalize();
      vt.crossVectors(rg.t, vn);
      if (vt.lengthSq() < 1e-8) vt.copy(vL);
      vt.normalize();
      g.vert(vP, vn, vt, (j / R) * circ + ou, rg.s + fwd * rg.r + ov, sec[1] * scale * (1 - capN) + capN * 0.3, rg.r, layer, wear);
    }
    return base;
  };
  // (counter-clockwise seen from outside: the ring runs round with φ, the tube forward along T)
  const strip = (a: number, b: number) => {
    for (let j = 0; j < R; j++) g.idx.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
  };
  let prev = -1;
  for (const rg of rings) {
    const b0 = ringVerts(rg, 1, 0, 0);
    if (prev >= 0) strip(prev, b0);
    prev = b0;
  }
  // the end: a rounded cap (flat-topped like the wood, so the floor's capsule end stays covered)
  const last = rings[rings.length - 1];
  // (three rings near; far away and on the thin twigs one, half way round)
  for (const k of lod.cap >= 3 ? [1, 2, 3] : [2]) {
    const psi = (k / 4) * (Math.PI / 2);
    const f = flat ? Math.pow(Math.sin(psi), 2 / P) : Math.sin(psi);
    const sc = flat ? Math.pow(Math.cos(psi), 2 / P) : Math.cos(psi);
    const b0 = ringVerts(last, sc, f, k / 4);
    strip(prev, b0);
    prev = b0;
  }
  const tip = g.n;
  vP.copy(last.c).addScaledVector(last.t, last.r * 0.98);
  frame(last.t);
  g.vert(vP, last.t, vL, 0, last.s + last.r, 0.3, last.r, layer, wear);
  for (let j = 0; j < R; j++) g.idx.push(prev + j, prev + j + 1, tip);
}

/**
 * The crotch (user 2026-11-24: "make the trunk and the branches blend better"): the trunk's top swells into a rounded
 * bulb — the walked top's dome (`floorDrop` over the crotch's floor) carried on out past the floor to a rim, then
 * curving down and in to the column — and the limbs grow out of it, swollen where they leave it (`tube`'s flare).
 */
export interface CrotchShape {
  x: number;
  y: number;
  topZ: number;
  /** the column's radius under the bulb */
  rCol: number;
  /** the dome's curve: `floorDrop(Rc, ρ / Rc)` below the top (the floor's own over the crotch) */
  Rc: number;
  /** the rim: its radius and height */
  rhoR: number;
  yR: number;
  /** where the bulb leaves the column */
  yB: number;
}

export function crotchShape(sk: CrownSkel): CrotchShape {
  const trunkP = sk.pieces[0];
  const rCol = trunkP.nodes[trunkP.nodes.length - 1].r;
  let rl = 0;
  for (const p of sk.pieces) if (p.kind === 'limb' && p.parent < 0) rl = Math.max(rl, p.nodes[0].r);
  const Rc = sk.topR / T.walkShare;
  // (the rim: out by most of the thickest limb's radius, within the dome's steep part)
  const rhoR = Math.max(rCol * 1.1, Math.min(0.78 * Rc, rCol + 0.6 * rl));
  const yR = sk.topZ - floorDrop(Rc, rhoR / Rc);
  // (the swelling starts well below the thickest limb's underside and is most of the way out by it, so it shows under
  // the limbs as the trunk widening into them)
  const yB = Math.min(yR - 12, sk.topZ - 2.6 * rl - 0.5 * (rhoR - rCol));
  return { x: sk.x, y: sk.y, topZ: sk.topZ, rCol, Rc, rhoR, yR, yB };
}

/** the dome's height at a radius */
export function crotchDomeY(c: CrotchShape, rho: number): number {
  return c.topZ - floorDrop(c.Rc, rho / c.Rc);
}

/** the bulb's widening at q (0 where it leaves the column … 1 the rim): eased in and out (no crease at either end), done
 * by seven tenths of the way */
function bulbE(q: number): number {
  const x = Math.min(1, Math.max(0, q / 0.7));
  return x * x * x * (10 - 15 * x + 6 * x * x);
}

/** the bulb's side at t (0 the column … 1 the rim): radius, height and their rates */
export function crotchSide(c: CrotchShape, t: number, out: number[]): void {
  const e = 1e-3;
  const w = c.rhoR - c.rCol;
  out[0] = c.rCol + w * bulbE(t);
  out[1] = c.yB + (c.yR - c.yB) * t;
  out[2] = (w * (bulbE(Math.min(1, t + e)) - bulbE(Math.max(0, t - e)))) / (Math.min(1, t + e) - Math.max(0, t - e));
  out[3] = c.yR - c.yB;
}

/** the trunk's drawn radius at a height in the bulb (the column's below it) — the climb follows it (game/trunkMount.ts) */
export function crotchRadiusAt(c: CrotchShape, y: number): number {
  if (y <= c.yB) return c.rCol;
  if (y >= c.yR) return c.rhoR;
  return c.rCol + (c.rhoR - c.rCol) * bulbE((y - c.yB) / (c.yR - c.yB));
}

/** The trunk: a round column from the ground far below, swelling at the top into the crotch's bulb (`crotchShape`). */
function trunk(g: Geo, sk: CrownSkel, p: WoodPiece, layer: number, lod: WoodLod, seed: number): void {
  const nodes = p.nodes;
  const R = lod.radial + 4;
  const c = crotchShape(sk);
  const y0 = nodes[0].z;
  const H = c.yB - y0;
  const n = Math.max(4, Math.ceil(H / (lod.step * 3)));
  const circ = 2 * Math.PI * c.rCol;
  const ou = hash01(seed, 3) * 300;
  const rAt = (y: number) => {
    // the nodes' radii along the height (linear between them)
    for (let i = 1; i < nodes.length; i++)
      if (y <= nodes[i].z || i === nodes.length - 1) {
        const a = nodes[i - 1];
        const b = nodes[i];
        const u = Math.min(1, Math.max(0, (y - a.z) / Math.max(1e-6, b.z - a.z)));
        return a.r + (b.r - a.r) * u;
      }
    return c.rCol;
  };
  // a ring of the surface of revolution: radius, height, the profile's outward normal (in ρ, y), the bark's length
  // along it, how much it faces up (moss, the worn top) and its wear
  let prev = -1;
  let len = 0;
  let lastR = -1;
  let lastY = 0;
  const ring = (rho: number, y: number, nr: number, ny: number, up: number, wear: number) => {
    if (lastR >= 0) len += Math.hypot(rho - lastR, y - lastY);
    lastR = rho;
    lastY = y;
    const base = g.n;
    for (let j = 0; j <= R; j++) {
      const phi = (2 * Math.PI * j) / R;
      const cx = Math.cos(phi);
      const sz = Math.sin(phi);
      vn.set(cx * nr, ny, sz * nr).normalize();
      vP.set(c.x + cx * rho, y, c.y + sz * rho);
      vt.set(-sz, 0, cx);
      g.vert(vP, vn, vt, (j / R) * circ + ou, len, up, Math.max(rho, 1), layer, wear);
    }
    if (prev >= 0) for (let j = 0; j < R; j++) g.idx.push(prev + j, base + j, prev + j + 1, prev + j + 1, base + j, base + j + 1);
    prev = base;
  };
  // the column
  for (let k = 0; k <= n; k++) {
    const y = y0 + (H * k) / n;
    const r = k === n ? c.rCol : rAt(y);
    const dr = (rAt(Math.min(c.yB, y + 2)) - rAt(Math.max(y0, y - 2))) / 4;
    ring(r, y, 1, -dr, 0, 0);
  }
  // the bulb's side, up to the rim
  const o = [0, 0, 0, 0];
  const KS = lod.cap >= 3 ? 14 : 6;
  for (let k = 1; k <= KS; k++) {
    crotchSide(c, k / KS, o);
    const l = Math.hypot(o[2], o[3]) || 1;
    // (outward: the tangent (dρ, dy) turned a quarter back)
    ring(o[0], o[1], o[3] / l, -o[2] / l, Math.max(0, -o[2] / l), 0);
  }
  // the dome, in to the middle: the floor's own curve over the walked top (worn like a limb's), carried out to the rim
  const KD = lod.cap >= 3 ? 9 : 4;
  const wearTop = WEAR.limb;
  for (let k = 1; k <= KD; k++) {
    const rho = c.rhoR * (1 - k / KD);
    const y = crotchDomeY(c, rho);
    const e = 0.5;
    const dy = (crotchDomeY(c, rho + e) - crotchDomeY(c, Math.max(0, rho - e))) / (2 * e);
    const l = Math.hypot(dy, 1);
    const w = wearTop * (1 - Math.min(1, Math.max(0, (rho / (c.Rc * T.walkShare) - 0.75) / 0.35)));
    ring(rho, y, -dy / l, 1 / l, 1 / l, w);
  }
}

/** The wood of every crown and bough: chunks of LODs, ready to add to the canopy's group. */
export function buildWood(data: CanopyData, material: THREE.Material, extra: ReadonlyArray<{ piece: WoodPiece; tree: number }> = []): THREE.Group {
  const group = new THREE.Group();
  group.name = 'canopyWood';
  const CELL = 256;
  type Chunk = { key: string; parts: Array<{ p: WoodPiece; sk: CrownSkel | null; seed: number; flare: boolean; s0: number; collar?: Collar }> };
  const chunks = new Map<string, Chunk>();
  const put = (key: string, p: WoodPiece, sk: CrownSkel | null, seed: number, flare: boolean, s0 = 0, collar?: Collar) => {
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { key, parts: [] }));
    c.parts.push({ p, sk, seed, flare, s0, collar });
  };
  data.skels.forEach((sk, ti) => {
    const cr = sk.pieces.length ? crotchShape(sk) : null;
    sk.pieces.forEach((p, pi) => {
      if (p.kind === 'trunk') return put(`t${ti}`, p, sk, ti * 1000 + pi, false);
      const m = p.nodes[Math.floor(p.nodes.length / 2)];
      // a limb from the crotch: its collar where it comes out of the bulb (half a radius inside the rim)
      let collar: Collar | undefined;
      if (cr && p.kind === 'limb' && p.parent < 0) {
        const edge = cr.rhoR - 0.5 * p.nodes[0].r;
        let at = 0;
        for (let i = 1; i < p.nodes.length; i++) {
          const a = p.nodes[i - 1];
          const b = p.nodes[i];
          const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
          const da = Math.hypot(a.x - sk.x, a.y - sk.y);
          const db = Math.hypot(b.x - sk.x, b.y - sk.y);
          if (db >= edge) {
            at += (l * Math.max(0, edge - da)) / Math.max(1e-6, db - da);
            break;
          }
          at += l;
        }
        collar = { at };
      }
      put(`${ti}:${Math.floor(m.x / CELL)}:${Math.floor(m.y / CELL)}`, p, sk, ti * 1000 + pi, true, 0, collar);
    });
  });
  // the fine twigs and lianas (render only, foliage.ts): with their tree's wood near them
  extra.forEach(({ piece, tree }, i) => {
    const m = piece.nodes[Math.floor(piece.nodes.length / 2)];
    put(`${tree}:${Math.floor(m.x / CELL)}:${Math.floor(m.y / CELL)}`, piece, data.skels[tree] ?? null, 50000 + i, false);
  });
  data.links.forEach((p, li) => {
    // (a long bough in pieces of a cell's length, each its own chunk: culled and coarsened like the rest)
    const step = Math.max(2, Math.round(CELL / 16));
    let s0 = 0;
    for (let i = 0; i < p.nodes.length - 1; i += step) {
      const nodes = p.nodes.slice(i, Math.min(p.nodes.length, i + step + 1));
      const m = nodes[Math.floor(nodes.length / 2)];
      // (the bark runs on from piece to piece: the same offsets, the length so far; a piece's end cap lies inside the next)
      put(`l${li}:${Math.floor(m.x / CELL)}:${Math.floor(m.y / CELL)}`, { ...p, nodes }, null, 90000 + li, false, s0);
      for (let k = 1; k < nodes.length; k++) s0 += Math.hypot(nodes[k].x - nodes[k - 1].x, nodes[k].y - nodes[k - 1].y, nodes[k].z - nodes[k - 1].z);
    }
  });
  const layerOf = (sk: CrownSkel | null, p: WoodPiece) => {
    if (sk) return BARK_LAYER[sk.style] ?? 0;
    // a bough between crowns: the bark of the nearer tree at its start
    let best = 0;
    let bd = Infinity;
    for (const s of data.skels) {
      const d = Math.hypot(s.x - p.nodes[0].x, s.y - p.nodes[0].y);
      if (d < bd) {
        bd = d;
        best = BARK_LAYER[s.style] ?? 0;
      }
    }
    return best;
  };
  // (the shadows: every chunk's coarse level, drawn into the shadow maps only — a soft shadow shows no difference
  // between 7 and 14 sides, and the coarse tube lies inside the fine one, so the wood doesn't shadow its own lit side)
  const casters = new THREE.Group();
  casters.name = 'canopyWoodShadow';
  for (const c of chunks.values()) {
    const lod = new THREE.LOD();
    lod.name = 'woodChunk';
    // (a LOD picks its level by its own position's distance from the camera: the chunk sits at its centre, its
    // geometry moved back by as much)
    let centre: THREE.Vector3 | null = null;
    let coarse: THREE.BufferGeometry | null = null;
    WOOD_LODS.forEach((L, li) => {
      const g = new Geo();
      for (const part of c.parts) {
        const layer = layerOf(part.sk, part.p);
        if (part.p.kind === 'trunk' && part.sk) trunk(g, part.sk, part.p, layer, L, part.seed);
        else tube(g, part.p, layer, L, part.seed, part.flare, part.s0, part.collar);
      }
      const geo = g.build();
      if (!geo) return;
      if (!centre) centre = geo.boundingSphere!.center.clone();
      geo.translate(-centre.x, -centre.y, -centre.z);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, material);
      m.castShadow = false;
      m.receiveShadow = true;
      m.userData.noShadow = true;
      lod.addLevel(m, li === 0 ? 0 : WOOD_FAR);
      coarse = geo;
    });
    if (!centre || !coarse) continue;
    lod.position.copy(centre);
    group.add(lod);
    const sh = new THREE.Mesh(coarse, material);
    sh.name = 'woodShadow';
    sh.castShadow = true;
    sh.receiveShadow = false;
    sh.position.copy(centre);
    casters.add(sh);
  }
  shadowOnly(casters);
  group.add(casters);
  return group;
}

/**
 * The haze between the tiers (shared by the wood and the leaves): what lies below the tier in view (`y`, set each
 * frame from the camera's target) fades toward the air's colour, so the depth reads.
 */
export const canopyHaze = {
  uHazeY: { value: 0 },
  uHazeCol: { value: new THREE.Color(0.17, 0.21, 0.18) },
  uHazeK: { value: 0.38 },
};

/**
 * The light under the leaves (shared by the wood and the leaves): a plan map of the leaf cover over the map (R its
 * density, G the height of its top, `canopyTerrain.ts` fills it) tints what lies beneath greener and a little darker —
 * the sun through and between the leaves (their own shadows are the shadow map's).
 */
export const canopyCover = {
  tCover: { value: null as THREE.Texture | null },
  uCoverSize: { value: new THREE.Vector2(1, 1) },
};

export function coverPatch(): import('../shaderPatch').ShaderPatch {
  return {
    key: 'canopyCover',
    uniforms: canopyCover,
    fragmentHeader: 'uniform sampler2D tCover; uniform vec2 uCoverSize;',
    fragment: [
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec4 _cv = texture2D(tCover, vWP.xz / uCoverSize);
          float _top = _cv.g * 320.0 - 160.0;
          float _under = _cv.r * smoothstep(_top - 2.0, _top - 14.0, vWP.y);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.97, 0.7), _under);
        }`,
      ],
    ],
  };
}

export function hazePatch(): import('../shaderPatch').ShaderPatch {
  return {
    key: 'canopyHaze',
    uniforms: canopyHaze,
    fragmentHeader: 'uniform float uHazeY; uniform vec3 uHazeCol; uniform float uHazeK;',
    fragment: [
      [
        '#include <fog_fragment>',
        `{
          float _hz = clamp((uHazeY - vWP.y) / 150.0, 0.0, 1.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeCol, _hz * (0.5 + 0.5 * _hz) * uHazeK);
        }
        #include <fog_fragment>`,
      ],
    ],
  };
}

/**
 * The bark material: the baked species tile by its millimetres, moss on the upper sides and in the furrows of damp
 * wood, lichen crusts on the ridges, the walked tops worn smooth and paler, a knot or a bore hole now and then, the
 * furrows and the undersides shaded; dappled sun.
 */
export function woodMaterial(maps: TreeMaps): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 });
  addPatch(mat, WORLD_POS_PATCH);
  addPatch(mat, dapplePatch());
  // per species: moss, lichen (amounts)
  const moss = [0.35, 0.15, 0.5, 0.5, 0.03];
  const lichen = [0.5, 0.55, 0.35, 0.25, 0.3];
  addPatch(mat, {
    key: 'bark',
    uniforms: {
      tBarkA: { value: maps.barkA },
      tBarkN: { value: maps.barkN },
      uBarkTile: { value: BARK_TILE.slice(0, BARK_COUNT) },
      uMoss: { value: moss },
      uLichen: { value: lichen },
      uTime: globalUniforms.uTime,
    },
    vertexHeader: `attribute vec3 aTanU; attribute vec2 aBark; attribute vec4 aWood; varying vec3 vTanU; varying vec2 vBarkUv; varying vec4 vWood;`,
    vertex: [
      [
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTanU = normalize((modelViewMatrix * vec4(aTanU, 0.0)).xyz);
        vBarkUv = aBark;
        vWood = aWood;`,
      ],
    ],
    fragmentHeader: `precision highp sampler2DArray;
uniform sampler2DArray tBarkA; uniform sampler2DArray tBarkN; uniform float uBarkTile[${BARK_COUNT}];
uniform float uMoss[${BARK_COUNT}]; uniform float uLichen[${BARK_COUNT}];
varying vec3 vTanU; varying vec2 vBarkUv; varying vec4 vWood;
float barkRough = 0.9; vec4 barkN = vec4(0.5, 0.5, 0.5, 1.0); float barkMoss = 0.0; float barkWear = 0.0;`,
    fragment: [
      [
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          int L = int(vWood.z + 0.5);
          float tile = uBarkTile[L];
          vec2 buv = vBarkUv / tile;
          vec4 bA = texture(tBarkA, vec3(buv, vWood.z));
          barkN = texture(tBarkN, vec3(buv, vWood.z));
          vec3 alb = bA.rgb * bA.rgb;
          float rough = bA.a;
          float cav = barkN.a;
          float hgt = barkN.b;
          float up = vWood.x;
          // knots: now and then a dark eye ringed by swollen bark (cells of 70 mm of bark)
          vec2 kc = floor(vBarkUv / 70.0);
          float kh = h21(kc + vWood.z * 7.0);
          vec2 kp = (fract(vBarkUv / 70.0) - vec2(0.3 + 0.4 * h21(kc + 3.1), 0.3 + 0.4 * h21(kc + 5.7))) * 70.0;
          float kd = length(kp * vec2(1.0, 0.55));
          float knot = step(0.78, kh) * smoothstep(5.0, 1.0, kd);
          alb = mix(alb, alb * vec3(0.35, 0.3, 0.28), knot * smoothstep(2.4, 0.6, kd));
          alb = mix(alb, alb * 1.25, knot * smoothstep(1.2, 3.0, kd) * smoothstep(5.0, 3.5, kd));
          // bore holes: tiny dark pits (cells of 22 mm)
          vec2 hc = floor(vBarkUv / 22.0);
          vec2 hp = (fract(vBarkUv / 22.0) - 0.5) * 22.0;
          float hole = step(0.9, h21(hc + 11.0 + vWood.z)) * smoothstep(0.9, 0.5, length(hp));
          alb *= 1.0 - hole * 0.85;
          // moss on the upper sides and in the furrows of the thick, damp wood
          float mn = fbm(vWP.xz * 0.03 + vec2(vWP.y * 0.05, 0.0)) * 0.7 + fbm(vWP.xz * 0.21 + 5.0) * 0.3;
          barkMoss = uMoss[L] * smoothstep(-0.1, 0.55, up) * smoothstep(0.5, 0.66, mn) * (0.35 + 0.65 * (1.0 - cav)) * smoothstep(8.0, 18.0, vWood.y);
          // lichen: pale grey-green crusts on the ridges
          float ln = fbm(vWP.xz * 0.11 + vec2(3.0, vWP.y * 0.09));
          float lich = uLichen[L] * smoothstep(0.66, 0.7, ln) * smoothstep(0.25, 0.65, hgt) * (1.0 - barkMoss);
          // worn smooth where ants walk often: the walked top of the busy wood, lighter and a little polished
          barkWear = vWood.w * smoothstep(0.88, 0.985, up);
          alb = mix(alb, alb * 1.3 + 0.006, barkWear * 0.65);
          rough = mix(rough, 0.5, barkWear * 0.7);
          alb = mix(alb, vec3(0.04, 0.062, 0.014) * (0.7 + 0.6 * vnoise(vWP.xz * 0.9)), barkMoss);
          alb = mix(alb, vec3(0.16, 0.19, 0.14) * (0.85 + 0.3 * vnoise(vWP.xz * 1.3)), lich * 0.85);
          // the furrows' shadow and the undersides
          float ao = mix(0.3, 1.0, cav) * mix(0.5, 1.0, smoothstep(-0.75, 0.25, up));
          diffuseColor.rgb = alb * ao;
          barkRough = mix(mix(rough, 0.97, barkMoss), 0.8, lich * 0.5);
        }`,
      ],
      [
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 nt = vec3(barkN.xy * 2.0 - 1.0, 1.0);
          nt.xy *= (1.0 - barkWear * 0.7) * (1.0 - barkMoss * 0.75);
          vec3 Nn = normal;
          vec3 Tn = normalize(vTanU - Nn * dot(Nn, vTanU));
          vec3 Bn = cross(Nn, Tn);
          normal = normalize(Tn * nt.x + Bn * nt.y + Nn * nt.z);
        }`,
      ],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = barkRough;'],
    ],
  });
  addPatch(mat, coverPatch());
  addPatch(mat, hazePatch());
  return mat;
}
