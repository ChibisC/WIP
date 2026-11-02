import * as THREE from 'three';
import type { Terrain } from '../../world/terrain';
import type { GroundFields } from '../terrainMesh';

/**
 * Sculpted bank faces (ground realism, item 3): the steep bands of the layered ground (world/layers.ts cliffs, and the
 * steep sides of ramps) are re-meshed at 1 mm instead of the terrain's 4 mm and sculpted — level strata that step in
 * and out, a crumbling lip that overhangs the face below, lumps and hollows, a spill of crumbs at the foot — so a bank
 * reads as cut earth or rock, not a smooth extrusion. The walk surface is still the simulation's heightfield: only
 * the cliff bands (where nothing walks) are moved, and the patch meets the heightfield mesh exactly along its border
 * (displacement fades to zero there; border heights follow the heightfield's own edges).
 *
 * Deterministic from the terrain (hashed noise on positions), render only.
 */

const S = 4; // fine vertices per terrain sample step (4 mm → 1 mm)

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.floor(x) | 0, 374761393) ^ Math.imul(Math.floor(y) | 0, 668265263) ^ Math.imul(Math.floor(z) | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x: number, y: number, z: number): number {
  return vnoise3(x, y, z) * 0.55 + vnoise3(x * 2.1 + 7, y * 2.1, z * 2.1) * 0.3 + vnoise3(x * 4.3, y * 4.3 + 3, z * 4.3) * 0.15;
}

/** Catmull-Rom height at (x, y) mm from the terrain samples (smooth bank shapes). */
function cubicHeight(t: Terrain, x: number, y: number): number {
  const fx = x / t.res;
  const fy = y / t.res;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = fx - i;
  const v = fy - j;
  const H = (a: number, b: number) => t.heights[Math.min(t.ny - 1, Math.max(0, b)) * t.nx + Math.min(t.nx - 1, Math.max(0, a))];
  const cr = (p0: number, p1: number, p2: number, p3: number, s: number) => 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);
  const row = (b: number) => cr(H(i - 1, b), H(i, b), H(i + 1, b), H(i + 2, b), u);
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), v);
}

/** Style tuning: ledge spacing (mm), ledge depth (mm), crumb (mm), lip overhang (mm). */
const STYLE: Record<number, { sp: number; ledge: number; crumb: number; lip: number }> = {
  1: { sp: 3.4, ledge: 1.3, crumb: 0.9, lip: 2.4 }, // soil bank
  2: { sp: 5.0, ledge: 2.2, crumb: 0.5, lip: 1.6 }, // rock ledge
  3: { sp: 3.6, ledge: 0.9, crumb: 1.0, lip: 2.8 }, // root wall
  4: { sp: 2.4, ledge: 0.45, crumb: 0.45, lip: 0.9 }, // sand bank
  5: { sp: 2.0, ledge: 0.6, crumb: 0.35, lip: 1.2 }, // clay cut
};

export function buildBankSculpt(t: Terrain, f: GroundFields): THREE.BufferGeometry | null {
  if (!t.layers) return null;
  const { nx, ny, res } = t;
  // cells replaced (all four corners in the sculpt mask)
  const cell = new Uint8Array(nx * ny);
  let count = 0;
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      if (f.sculpt[k] && f.sculpt[k + 1] && f.sculpt[k + nx] && f.sculpt[k + nx + 1]) {
        cell[k] = 1;
        count++;
      }
    }
  if (!count) return null;
  const FX = (nx - 1) * S + 1;
  const vid = new Map<number, number>();
  const pos: number[] = [];
  const border: number[] = [];
  // fine vertices of every replaced cell; a vertex on an edge shared with a kept cell is on the border
  const kept = (i: number, j: number) => i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1 || !cell[j * nx + i];
  const vertex = (I: number, J: number): number => {
    const key = J * FX + I;
    let v = vid.get(key);
    if (v !== undefined) return v;
    v = pos.length / 3;
    vid.set(key, v);
    pos.push((I / S) * res, 0, (J / S) * res);
    // border: any of the (up to four) coarse cells touching this fine vertex is kept
    const ci = Math.floor(I / S);
    const cj = Math.floor(J / S);
    const onX = I % S === 0;
    const onY = J % S === 0;
    let b = kept(ci, cj);
    if (onX) b = b || kept(ci - 1, cj);
    if (onY) b = b || kept(ci, cj - 1);
    if (onX && onY) b = b || kept(ci - 1, cj - 1);
    border.push(b ? 1 : 0);
    return v;
  };
  const idx: number[] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      if (!cell[j * nx + i]) continue;
      for (let b = 0; b < S; b++)
        for (let a = 0; a < S; a++) {
          const I = i * S + a;
          const J = j * S + b;
          const v00 = vertex(I, J);
          const v10 = vertex(I + 1, J);
          const v01 = vertex(I, J + 1);
          const v11 = vertex(I + 1, J + 1);
          idx.push(v00, v01, v10, v10, v01, v11);
        }
    }
  const nv = pos.length / 3;
  // distance (fine steps) from the border, over the patch's own vertices: the displacement's weight
  const dist = new Float32Array(nv).fill(99);
  const queue: number[] = [];
  for (let v = 0; v < nv; v++)
    if (border[v]) {
      dist[v] = 0;
      queue.push(v);
    }
  const keyOf = new Int32Array(nv);
  for (const [key, v] of vid) keyOf[v] = key;
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    const key = keyOf[v];
    const I = key % FX;
    const J = (key - I) / FX;
    for (const [dI, dJ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const w = vid.get((J + dJ) * FX + (I + dI));
      if (w === undefined || dist[w] <= dist[v] + 1) continue;
      dist[w] = dist[v] + 1;
      queue.push(w);
    }
  }
  const P = new Float32Array(pos);
  const cover = new Float32Array(nv * 4);
  const g1 = new Float32Array(nv * 4);
  const g2 = new Float32Array(nv * 4);
  const uv = new Float32Array(nv * 2);
  const sampleIdx = (x: number, y: number) => Math.min(ny - 1, Math.max(0, Math.round(y / res))) * nx + Math.min(nx - 1, Math.max(0, Math.round(x / res)));
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3];
    const y = P[v * 3 + 2];
    const lin = t.heightAt(x, y);
    const wgt = Math.min(1, dist[v] / 3);
    const ws = wgt * wgt * (3 - 2 * wgt);
    let h = ws > 0 ? lin + (cubicHeight(t, x, y) - lin) * ws : lin;
    let dx = 0;
    let dz = 0;
    const s = sampleIdx(x, y);
    if (ws > 0) {
      // the slope and which way is down
      const e = 1.0;
      const gx = (cubicHeight(t, x + e, y) - cubicHeight(t, x - e, y)) / (2 * e);
      const gy = (cubicHeight(t, x, y + e) - cubicHeight(t, x, y - e)) / (2 * e);
      const sl = Math.hypot(gx, gy);
      if (sl > 0.25) {
        const ox = -gx / sl;
        const oz = -gy / sl;
        const st = STYLE[f.face[s] || 1] ?? STYLE[1];
        // where on the bank: 0 foot … 1 top (heights 7 mm uphill and downhill)
        const top = cubicHeight(t, x - ox * 7, y - oz * 7);
        const bot = cubicHeight(t, x + ox * 7, y + oz * 7);
        const fr = top - bot > 2 ? Math.min(1, Math.max(0, (h - bot) / (top - bot))) : 0.5;
        const face = Math.min(1, Math.max(0, (sl - 0.5) / 1.0));
        // strata: each level steps out then back (a sawtooth on height, its phase wandering along the face)
        const along = -oz * x + ox * y;
        const ph = h / st.sp + fbm3(along * 0.08, h * 0.05, 3.1) * 1.2;
        const fp = ph - Math.floor(ph);
        const saw = fp < 0.72 ? fp / 0.72 : (1 - fp) / 0.28;
        let out = (saw - 0.5) * st.ledge;
        // lumps and hollows, and broader scallops where bits of the face have slumped away
        out += (fbm3(x * 0.45, h * 0.45, y * 0.45) - 0.5) * 2 * st.crumb;
        out += (fbm3(along * 0.09, h * 0.07, 4.2) - 0.5) * 2.2 * st.crumb;
        // runnels: rain-cut grooves down the face
        const rn = vnoise3(along * 0.22, 1.3, 7.7);
        out -= Math.max(0, (rn - 0.72) / 0.28) * 1.2 * Math.sin(Math.PI * Math.min(1, Math.max(0, fr))) * st.crumb;
        // the lip overhangs the face below; the foot spills out
        const lip = Math.max(0, (fr - 0.78) / 0.22);
        out += lip * lip * st.lip * (0.6 + 0.8 * vnoise3(along * 0.25, 5.3, 1.7));
        const foot = Math.max(0, (0.2 - fr) / 0.2);
        out += foot * 0.6;
        h += foot * foot * 0.5 * vnoise3(x * 0.9, y * 0.9, 9.1) + lip * 0.25;
        const k = out * face * ws;
        dx = ox * k;
        dz = oz * k;
        h += (vnoise3(x * 0.7, h * 0.7, y * 0.7) - 0.5) * 0.35 * face * ws;
      }
    }
    P[v * 3] = x + dx;
    P[v * 3 + 1] = h;
    P[v * 3 + 2] = y + dz;
    uv[v * 2] = x / 70;
    uv[v * 2 + 1] = y / 70;
    const k4 = s * 4;
    cover[v * 4] = t.coverW[k4] / 255;
    cover[v * 4 + 1] = t.coverW[k4 + 1] / 255;
    cover[v * 4 + 2] = t.coverW[k4 + 2] / 255;
    cover[v * 4 + 3] = t.coverW[k4 + 3] / 255;
    g1[v * 4] = f.wet[s];
    g1[v * 4 + 1] = f.ao[s];
    g1[v * 4 + 2] = f.trail[s];
    g1[v * 4 + 3] = f.face[s] / 8;
    g2[v * 4] = f.zone[s];
    g2[v * 4 + 1] = f.gravel[s];
    g2[v * 4 + 2] = f.rim[s];
    g2[v * 4 + 3] = f.spill[s];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('cover', new THREE.BufferAttribute(cover, 4));
  g.setAttribute('g1', new THREE.BufferAttribute(g1, 4));
  g.setAttribute('g2', new THREE.BufferAttribute(g2, 4));
  g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeVertexNormals();
  // the border meets the heightfield mesh: its normals from the heightfield too (no lighting seam)
  const N = g.attributes.normal.array as Float32Array;
  for (let v = 0; v < nv; v++) {
    if (!border[v]) continue;
    const x = P[v * 3];
    const y = P[v * 3 + 2];
    const e = res;
    const nx_ = t.heightAt(x - e, y) - t.heightAt(x + e, y);
    const nz_ = t.heightAt(x, y - e) - t.heightAt(x, y + e);
    const l = Math.hypot(nx_, 2 * e, nz_);
    N[v * 3] = nx_ / l;
    N[v * 3 + 1] = (2 * e) / l;
    N[v * 3 + 2] = nz_ / l;
  }
  g.computeBoundingSphere();
  return g;
}
