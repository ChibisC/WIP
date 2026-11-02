import { fbm2 } from '../core/rng';
import type { EdgeStyle, MapDef, Pt, Ramp, RampStyle } from '../maps/types';
import { LAYERS } from '../sim/balance';
import { dhypot } from '../sim/dmath';
import { shapeBox, shapeDist, smooth01 } from './mapShapes';

/**
 * Layered ground (claude/maps/05-spec-layered-maps.md; docs/maps/layers.md).
 *
 * A map's `layers` raise terraces (and sink hollows) one `LAYERS.step` per level; each layer's outline becomes a steep
 * bank about `LAYERS.bankW` mm wide, its line wandering a few mm so it never looks drawn. `ramps` are the only way
 * between levels: a corridor along a path whose ground rises evenly from the level at its foot to the level at its top,
 * its sides blending into the ground beside it. Everything is plain arithmetic on the map data (the seeded noise of
 * core/rng), so every client builds the same bytes.
 *
 * Banks and the steep sides of ramps block like walls: after every height is final, `cliffs` marks the samples of
 * those bands whose slope is steeper than `LAYERS.maxWalkSlope`; the terrain adds them to its obstacle mask, so
 * movement, the flow fields (and their fine `edges`) and the validator all route round them, up the ramps.
 */

export const EDGE_ID: Record<EdgeStyle, number> = { soilBank: 1, rockLedge: 2, rootWall: 3, sandBank: 4, clayCut: 5 };
export const RAMP_ID: Record<RampStyle, number> = { soilSlope: 1, rootRamp: 2, barkSlab: 3, mossBank: 4, sandSlide: 5, stoneSteps: 6 };
/** ramp-side samples carry this bit in `ramp` (the core carries the bare style id) */
export const RAMP_SIDE = 64;

export interface LayerFields {
  /** the level the ground stands at per sample (layer tops, a ramp's nearer level) */
  level: Int8Array;
  /** height added by the layers and ramps (mm) per sample */
  lift: Float32Array;
  /** 0, or the edge style id of the bank the sample lies in */
  bank: Uint8Array;
  /** 0, or the ramp style id (core), or RAMP_SIDE | style id (its sides) */
  ramp: Uint8Array;
  /** 1 where the ground is too steep to walk (set by `cliffs`) */
  cliff: Uint8Array;
  /** how far up its ramp a core sample is (0 foot … 255 top) */
  rampU: Uint8Array;
}

interface Grid {
  nx: number;
  ny: number;
  res: number;
}

function eachIn(g: Grid, box: { x0: number; y0: number; x1: number; y1: number }, f: (k: number, x: number, y: number) => void): void {
  const i0 = Math.max(0, Math.floor(box.x0 / g.res));
  const i1 = Math.min(g.nx - 1, Math.ceil(box.x1 / g.res));
  const j0 = Math.max(0, Math.floor(box.y0 / g.res));
  const j1 = Math.min(g.ny - 1, Math.ceil(box.y1 / g.res));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * g.nx + i, i * g.res, j * g.res);
}

/** Nearest point on a polyline: distance, arc length to it, and the total length. */
export function nearestOnPath(path: readonly Pt[], x: number, y: number, out: { d: number; s: number; len: number }): void {
  let best = Infinity;
  let bs = 0;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][0];
    const ay = path[i - 1][1];
    const vx = path[i][0] - ax;
    const vy = path[i][1] - ay;
    const l2 = vx * vx + vy * vy;
    const l = Math.sqrt(l2);
    let t = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const d = dhypot(x - (ax + vx * t), y - (ay + vy * t));
    if (d < best) {
      best = d;
      bs = acc + t * l;
    }
    acc += l;
  }
  out.d = best;
  out.s = bs;
  out.len = acc;
}

/** The ramp's rise along its path (u 0..1 → 0..1): mostly even, eased at both ends. */
export function rampEase(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return 0.6 * c + 0.4 * smooth01(c);
}

/** Steepest slope of `rampEase` per unit of u (for the validator): 0.6 + 0.4 × 1.5. */
export const RAMP_EASE_MAX = 1.2;

const np = { d: 0, s: 0, len: 0 }; // det-ok: scratch for nearestOnPath, overwritten before every read

/**
 * Raise the layers and ramps into `heights` (after the map's brushes, before its water basins). Returns the fields the
 * terrain keeps; `cliffs` completes them once the heights are final.
 */
export function applyLayers(map: MapDef, g: Grid, heights: Float32Array, coverW: Uint8Array, cover: Uint8Array): LayerFields {
  const n = g.nx * g.ny;
  const F: LayerFields = { level: new Int8Array(n), lift: new Float32Array(n), bank: new Uint8Array(n), ramp: new Uint8Array(n), cliff: new Uint8Array(n), rampU: new Uint8Array(n) };
  const L = LAYERS;
  const half = L.bankW / 2;
  const seed = hashId(map.id);
  // ---- terraces and hollows, outer first: each blends the ground toward its level across its bank
  for (const layer of map.layers ?? []) {
    const target = layer.level * L.step;
    const edge = EDGE_ID[layer.edge];
    eachIn(g, shapeBox(layer.shape, L.bankW + L.bankJitter + 2), (k, x, y) => {
      const d = shapeDist(layer.shape, x, y) + (fbm2(x / L.jitterScale, y / L.jitterScale, 3, seed) - 0.5) * 2 * L.bankJitter;
      const s = smooth01((half - d) / L.bankW);
      if (s <= 0) return;
      F.lift[k] += (target - F.lift[k]) * s;
      if (s > 0.5) F.level[k] = layer.level;
      if (s < 0.999) F.bank[k] = edge;
      else F.bank[k] = 0;
    });
  }
  // ---- ramps: the only way between levels
  for (const r of map.ramps ?? []) {
    const P = r.path;
    if (P.length < 2) continue;
    const a = sampleAt(g, F.lift, P[0][0], P[0][1]);
    const b = sampleAt(g, F.lift, P[P.length - 1][0], P[P.length - 1][1]);
    const la = levelAt(g, F.level, P[0][0], P[0][1]);
    const lb = levelAt(g, F.level, P[P.length - 1][0], P[P.length - 1][1]);
    const core = r.width / 2;
    const id = RAMP_ID[r.style];
    eachIn(g, shapeBox({ path: P, width: r.width }, L.rampSide + 2), (k, x, y) => {
      nearestOnPath(P, x, y, np);
      if (np.d > core + L.rampSide) return;
      const u = np.len > 0 ? np.s / np.len : 0;
      const hr = a + (b - a) * rampEase(u);
      const wgt = np.d <= core ? 1 : 1 - smooth01((np.d - core) / L.rampSide);
      if (wgt <= 0) return;
      F.lift[k] += (hr - F.lift[k]) * wgt;
      if (np.d <= core) {
        F.ramp[k] = id;
        F.bank[k] = 0;
        F.rampU[k] = Math.round(u * 255);
        F.level[k] = u < 0.5 ? la : lb;
      } else if (!(F.ramp[k] && F.ramp[k] < RAMP_SIDE)) F.ramp[k] = RAMP_SIDE | id;
    });
  }
  // ---- into the ground, and what the ground looks like: bare soil (or sand) on the banks, the ramp's own cover
  for (let k = 0; k < n; k++) {
    heights[k] += F.lift[k];
    const k4 = k * 4;
    const bk = F.bank[k];
    const rp = F.ramp[k] & (RAMP_SIDE - 1);
    if (bk) {
      const sand = bk === EDGE_ID.sandBank;
      paint(coverW, k4, sand ? 2 : 0, 0.85);
      cover[k] = sand ? 2 : 0;
    }
    if (rp) {
      const side = (F.ramp[k] & RAMP_SIDE) !== 0;
      const ch = rp === RAMP_ID.mossBank ? 1 : rp === RAMP_ID.sandSlide ? 2 : 0;
      paint(coverW, k4, ch, side ? 0.45 : 0.8);
      if (!side) cover[k] = ch;
    }
  }
  return F;
}

/** Mark the bank and ramp-side samples too steep to walk (call once the heights are final). */
export function cliffs(F: LayerFields, g: Grid, heights: Float32Array): void {
  const { nx, ny, res } = g;
  const lim = LAYERS.maxWalkSlope;
  F.cliff.fill(0);
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const core = F.ramp[k] !== 0 && F.ramp[k] < RAMP_SIDE;
      if (core || (!F.bank[k] && !F.ramp[k])) continue;
      const gx = (heights[k + 1] - heights[k - 1]) / (2 * res);
      const gy = (heights[k + nx] - heights[k - nx]) / (2 * res);
      if (dhypot(gx, gy) > lim) F.cliff[k] = 1;
    }
}

/** Push a cover channel (0 soil, 1 moss, 2 sand, 3 litter) toward `amt` of the mix. */
function paint(coverW: Uint8Array, k4: number, ch: number, amt: number): void {
  for (let c = 0; c < 4; c++) coverW[k4 + c] = c === ch ? Math.max(coverW[k4 + c], 255 * amt) : coverW[k4 + c] * (1 - amt);
}

function sampleAt(g: Grid, arr: Float32Array, x: number, y: number): number {
  const i = Math.min(g.nx - 1, Math.max(0, Math.round(x / g.res)));
  const j = Math.min(g.ny - 1, Math.max(0, Math.round(y / g.res)));
  return arr[j * g.nx + i];
}

function levelAt(g: Grid, arr: Int8Array, x: number, y: number): number {
  const i = Math.min(g.nx - 1, Math.max(0, Math.round(x / g.res)));
  const j = Math.min(g.ny - 1, Math.max(0, Math.round(y / g.res)));
  return arr[j * g.nx + i];
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 997;
}

/** The levels at a ramp's two ends, read from the layers alone (for the validator and the decor). */
export function rampLevels(F: LayerFields, g: Grid, r: Ramp): [number, number] {
  const P = r.path;
  return [levelAt(g, F.level, P[0][0], P[0][1]), levelAt(g, F.level, P[P.length - 1][0], P[P.length - 1][1])];
}
