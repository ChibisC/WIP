/**
 * The nest mesh's signed distance and light map, as plain functions of the soil (action-lag fix, 2026-11-23).
 *
 * Moved out of nestTerrain.ts unchanged — the same loops in the same order, so the same values to the bit — so that
 * one copy of the code runs both on the page (a full rebuild, the golden shots' stepped clock) and in a worker
 * (worker/nestMapsWorker.ts) while play goes on: while ants dig, the soil changes almost every frame, and the whole
 * nest's distance (5–43 ms on the build machine) and light map (10–140 ms) were recomputed on the page each time.
 * No three.js here: the worker loads only this and the grid's soil constants.
 */
import { SOIL_AIR, SOIL_GATE, SOIL_ROCK, SOIL_ROUTE, SOIL_STONE } from '../../world/nestGrid';

/** what the maps are made from */
export interface NestMapsInput {
  W: number;
  H: number;
  /** the grid's hex radius and cell size (mm): the light pools' blur radii */
  R: number;
  cell: number;
  soil: Uint8Array;
  /** sealed cells (drawn as rock whatever is dug there), or null */
  sealed: Uint8Array | null;
}

/** scratch kept between computations (a computation used to allocate three grids of garbage) */
export interface SdScratch {
  dA: Float32Array;
  dS: Float32Array;
  dT: Float32Array;
}

export function sdScratch(n: number, s?: SdScratch | null): SdScratch {
  if (s && s.dA.length === n) return s;
  return { dA: new Float32Array(n), dS: new Float32Array(n), dT: new Float32Array(n) };
}

/** Is cell k dug floor as drawn (dug and not sealed)? */
function airCell(soil: Uint8Array, sealed: Uint8Array | null, k: number): boolean {
  return soil[k] === SOIL_AIR && !(sealed && sealed[k]);
}

/** The signed distance (cells; air positive, soil negative), blurred: written into `sd`. */
export function signedDistance(m: NestMapsInput, sd: Float32Array, scr: SdScratch): void {
  const { W, H, soil, sealed } = m;
  const INF = 1e6;
  const dA = scr.dA;
  const dS = scr.dS;
  for (let k = 0; k < W * H; k++) {
    const air = airCell(soil, sealed, k);
    dA[k] = air ? INF : 0;
    dS[k] = air ? 0 : INF;
    // grid border counts as soil for air cells
    const x = k % W;
    const y = (k - x) / W;
    if (air && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) dA[k] = 0.5;
  }
  chamfer(dA, W, H);
  chamfer(dS, W, H);
  for (let k = 0; k < W * H; k++) sd[k] = airCell(soil, sealed, k) ? dA[k] - 0.5 : -(dS[k] - 0.5);
  // Blur: cell staircases become smooth organic contours. Seven passes of a 3×3 kernel (centre weight 2). The interior
  // cells skip the bounds checks; every cell adds the same values in the same order as the plain loop (borderBlur),
  // so the result is the same to the bit (performance pass, tests/performance.ts) at a fraction of the time.
  let src = sd;
  let dst = scr.dT;
  for (let pass = 0; pass < 7; pass++) {
    for (let y = 0; y < H; y++) {
      if (y === 0 || y === H - 1) {
        for (let x = 0; x < W; x++) dst[y * W + x] = borderBlur(src, W, H, x, y);
        continue;
      }
      dst[y * W] = borderBlur(src, W, H, 0, y);
      for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        let sum = 0;
        sum += src[k - W - 1];
        sum += src[k - W];
        sum += src[k - W + 1];
        sum += src[k - 1];
        sum += src[k] * 2;
        sum += src[k + 1];
        sum += src[k + W - 1];
        sum += src[k + W];
        sum += src[k + W + 1];
        dst[k] = sum / 10;
      }
      dst[y * W + W - 1] = borderBlur(src, W, H, W - 1, y);
    }
    const t = src;
    src = dst;
    dst = t;
  }
  if (src !== sd) sd.set(src);
}

/** Light pools (local + wide openness), wall distance and a smooth stone mask: RGBA bytes into `light`. */
export function lightMap(m: NestMapsInput, sd: Float32Array, light: Uint8Array): void {
  const { W, H, soil, sealed, R, cell } = m;
  const air = new Float32Array(W * H);
  const stone = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const s = sealed && sealed[k] ? SOIL_ROUTE : soil[k];
    air[k] = s === SOIL_AIR ? 1 : 0;
    // (the rock margin and a route's undug soil are drawn as rock slabs, like buried stones but darker)
    stone[k] = s === SOIL_STONE || s === SOIL_ROCK || s === SOIL_ROUTE ? 1 : 0;
  }
  const rPool = Math.max(2, Math.round((R * 0.9) / cell));
  const rWide = Math.max(4, Math.round((R * 3.2) / cell));
  const pool = boxBlur(air, W, H, rPool, 3);
  const wide = boxBlur(air, W, H, rWide, 2);
  const st = boxBlur(stone, W, H, 1, 1);
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    light[i] = Math.min(255, Math.round(Math.pow(pool[k], 0.8) * 255));
    light[i + 1] = Math.min(255, Math.round(Math.min(1, wide[k] * 2.2) * 255));
    light[i + 2] = Math.round((Math.max(-4, Math.min(4, sd[k])) / 8 + 0.5) * 255);
    light[i + 3] = Math.round(st[k] * 255);
  }
}

/** What the worker makes of a job: the signed distance, then the light map from it. */
export function nestMapsCompute(m: NestMapsInput, scr: SdScratch): { sd: Float32Array; light: Uint8Array } {
  const n = m.W * m.H;
  const sd = new Float32Array(n);
  signedDistance(m, sd, scr);
  const light = new Uint8Array(n * 4);
  lightMap(m, sd, light);
  return { sd, light };
}

/** The soil texture's bytes of cell k (R: type, G: dig order); `out` gets them at k·4. Returns whether they changed. */
export function soilBytes(soil: Uint8Array, sealed: Uint8Array | null, designated: ArrayLike<number>, n: number, out: Uint8Array): boolean {
  let changed = false;
  for (let k = 0; k < n; k++) {
    const s = sealed && sealed[k] ? SOIL_ROUTE : soil[k];
    const i = k * 4;
    // (R: soil type × 40; stone 255; rock and undug route soil 250 — the "rock" look, type 6; a gate 200, type 5)
    const r = s === SOIL_STONE ? 255 : s === SOIL_ROCK || s === SOIL_ROUTE ? 250 : s === SOIL_GATE ? 200 : s * 40;
    const gg = designated[k] ? 255 : 0;
    if (out[i] !== r || out[i + 1] !== gg || out[i + 2] !== 0 || out[i + 3] !== 255) {
      out[i] = r;
      out[i + 1] = gg;
      out[i + 2] = 0;
      out[i + 3] = 255;
      changed = true;
    }
  }
  return changed;
}

/** One cell of the signed distance's 3×3 blur, with the grid's edge taken into account (the original loop's body). */
export function borderBlur(sd: Float32Array, W: number, H: number, x: number, y: number): number {
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const wgt = dx === 0 && dy === 0 ? 2 : 1;
      sum += sd[yy * W + xx] * wgt;
      n += wgt;
    }
  return sum / n;
}

/** Two-pass chamfer distance transform (in cells). */
export function chamfer(d: Float32Array, W: number, H: number): void {
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      let v = d[k];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[k - 1] + D1);
      if (y > 0) {
        v = Math.min(v, d[k - W] + D1);
        if (x > 0) v = Math.min(v, d[k - W - 1] + D2);
        if (x < W - 1) v = Math.min(v, d[k - W + 1] + D2);
      }
      d[k] = v;
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const k = y * W + x;
      let v = d[k];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[k + 1] + D1);
      if (y < H - 1) {
        v = Math.min(v, d[k + W] + D1);
        if (x < W - 1) v = Math.min(v, d[k + W + 1] + D2);
        if (x > 0) v = Math.min(v, d[k + W - 1] + D2);
      }
      d[k] = v;
    }
}

/** Separable box blur repeated `passes` times (≈ gaussian). */
export function boxBlur(src: Float32Array, W: number, H: number, r: number, passes: number): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(W * H);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[row + x] = acc * inv;
        acc += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc * inv;
        acc += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
  }
  b = a;
  return b;
}
