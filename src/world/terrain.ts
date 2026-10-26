import { Rng, fbm2 } from '../core/rng';
import { dcos, dexp, dhypot, dhypot3, dpow, dsin, sq } from '../sim/dmath';
import type { MapDef, MapId } from '../maps/types';
import { mapDef } from '../maps';
import { shapeBox, shapeDist, smooth01 } from './mapShapes';
import { SurfaceLayout, surfaceLayout } from './surfaceLayout';

/** Map styles drive generation of relief, ground cover and props. */
export type MapStyle = 'meadow' | 'forest' | 'formicarium' | 'sandy' | 'riverbank';

export type PropKind =
  | 'pebble'
  | 'rock'
  | 'twig'
  | 'leaf'
  | 'needle'
  | 'mushroom'
  | 'grassClump'
  | 'moss'
  | 'acorn'
  | 'log'
  | 'plantStem';

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  rot: number;
  scale: number;
  /** Variant seed for procedural shape. */
  v: number;
  /** Optional second rotation (tilt) for twigs/leaves. */
  tilt?: number;
  /** Length for twigs/logs. */
  len?: number;
  /** Colour tint selector for leaves. */
  hue?: number;
}

export interface SculptOp {
  x: number;
  y: number;
  r: number;
  amount: number;
}

export interface WaterOp {
  x: number;
  y: number;
  r: number;
  level: number;
}

export interface TerrainParams {
  seed: number;
  style: MapStyle;
  width: number; // mm
  depth: number; // mm
  sculpt: SculptOp[];
  water: WaterOp[];
  /** Global flood level (absolute height); -Infinity encoded as -9999. */
  floodLevel: number;
  /** an authored map (docs/maps/design.md); absent for the procedural styles */
  map?: MapId;
}

/**
 * Surface heightfield plus a walk-height overlay (props ants climb over),
 * a water-surface field and an obstacle mask. Deterministically regenerated
 * from TerrainParams so saves stay small.
 */
export class Terrain {
  readonly params: TerrainParams;
  readonly width: number;
  readonly depth: number;
  /** Height sample spacing in mm (4 on authored maps: movement never needed 2). */
  readonly res: number;
  readonly nx: number;
  readonly ny: number;
  heights: Float32Array;
  /** Additional height from props (leaves, twigs, pebbles, rocks). */
  overlay: Float32Array;
  /** Absolute water surface height per sample, or -9999. */
  water: Float32Array;
  /** 1 where ants cannot walk (mushroom stems, plant stems, glass walls). */
  blocked: Uint8Array;
  /** Dominant ground cover: 0 soil, 1 moss/grass, 2 sand, 3 litter */
  cover: Uint8Array;
  /** Continuous cover weights (soil, moss, sand, litter) per sample, 0..255. */
  coverW: Uint8Array;
  props: Prop[] = [];
  /** Incremented whenever heights or water change (render rebuild trigger). */
  version = 0;
  waterVersion = 0;
  /** the authored map and its hex layout (rules, zones, sites), when there is one */
  readonly map: MapDef | null;
  readonly layout: SurfaceLayout | null;

  /** `def` overrides the registered map file (the validator checks edited copies). */
  constructor(params: TerrainParams, def?: MapDef) {
    this.params = params;
    this.width = params.width;
    this.depth = params.depth;
    this.map = params.map ? (def ?? mapDef(params.map)) : null;
    this.layout = this.map ? surfaceLayout(this.map) : null;
    this.res = this.map ? 4 : 2;
    this.nx = Math.floor(this.width / this.res) + 1;
    this.ny = Math.floor(this.depth / this.res) + 1;
    const n = this.nx * this.ny;
    this.heights = new Float32Array(n);
    this.overlay = new Float32Array(n);
    this.water = new Float32Array(n).fill(-9999);
    this.blocked = new Uint8Array(n);
    this.cover = new Uint8Array(n);
    this.coverW = new Uint8Array(n * 4);
    this.generate();
  }

  private generate(): void {
    const p = this.params;
    const rng = new Rng(p.seed * 7919 + 13);
    const { nx, ny, res } = this;
    const s = p.seed % 1000;
    const map = this.map;
    const amp = map ? map.relief.amp : p.style === 'formicarium' ? 3 : p.style === 'sandy' ? 10 : p.style === 'riverbank' ? 16 : 14;
    const rs = map ? map.relief.scale : 160;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = i * res;
        const y = j * res;
        let h = (fbm2(x / rs, y / rs, 4, s) - 0.5) * amp * 2;
        h += (fbm2(x / 40, y / 40, 3, s + 5) - 0.5) * amp * 0.25;
        if (p.style === 'riverbank' && !map) {
          // A shallow channel crossing the map diagonally.
          const d = Math.abs((x - this.width * 0.5) * 0.7 + (y - this.depth * 0.5) * 0.7 - 120 * dsin(x / 240));
          h -= 18 * dexp(-(d * d) / (2 * 70 * 70));
        }
        this.heights[j * nx + i] = h;
        const moist = fbm2(x / 110 + 40, y / 110, 4, s + 9) + (fbm2(x / 22, y / 22, 2, s + 11) - 0.5) * 0.12;
        const sandN = fbm2(x / 140 - 30, y / 140 + 9, 4, s + 21) + (fbm2(x / 18, y / 18, 2, s + 23) - 0.5) * 0.1;
        const litN = fbm2(x / 70 + 7, y / 70 - 3, 3, s + 31);
        let wm = 0;
        let ws = 0;
        let wl = 0;
        const ss = (a: number, b: number, v: number) => {
          const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
          return t * t * (3 - 2 * t);
        };
        if (p.style === 'sandy') {
          ws = ss(0.3, 0.45, sandN) * 0.95;
          wm = ss(0.6, 0.72, moist) * 0.6;
          wl = ss(0.62, 0.75, litN) * 0.3;
        } else if (p.style === 'forest') {
          wl = 0.35 + ss(0.4, 0.6, litN) * 0.6;
          wm = ss(0.5, 0.64, moist) * 0.7;
          ws = ss(0.7, 0.8, sandN) * 0.3;
        } else if (p.style === 'formicarium') {
          ws = 0.35 + ss(0.45, 0.65, sandN) * 0.55;
          wl = ss(0.62, 0.78, litN) * 0.25;
        } else if (map && map.biome === 'meadow') {
          // an authored meadow: grass sward nearly everywhere, bare earth in small patches
          wm = 0.62 + ss(0.3, 0.6, moist) * 0.38;
          ws = ss(0.74, 0.86, sandN) * 0.3;
          wl = ss(0.64, 0.78, litN) * 0.3 * (1 - wm * 0.6);
        } else {
          wm = ss(0.5, 0.66, moist) * 0.95;
          ws = ss(0.66, 0.78, sandN) * 0.6;
          wl = ss(0.55, 0.7, litN) * 0.55 * (1 - wm);
        }
        const wsum = wm + ws + wl;
        const wsoil = Math.max(0.12, 1 - wsum);
        const tot = wsoil + wsum;
        const k4 = (j * nx + i) * 4;
        this.coverW[k4] = (wsoil / tot) * 255;
        this.coverW[k4 + 1] = (wm / tot) * 255;
        this.coverW[k4 + 2] = (ws / tot) * 255;
        this.coverW[k4 + 3] = (wl / tot) * 255;
        let c = 0;
        let best = wsoil;
        if (wm > best) (c = 1), (best = wm);
        if (ws > best) (c = 2), (best = ws);
        if (wl > best) (c = 3), (best = wl);
        this.cover[j * nx + i] = c;
      }
    }
    // Flatten a rim so the playable edge reads cleanly.
    for (const op of p.sculpt) this.applySculpt(op, false);
    if (map) this.shapeMap(map);
    // authored maps have no props in the simulation: their small decoration is render-only
    else this.placeProps(rng);
    this.rebuildOverlay();
    this.rebuildWater();
  }

  /**
   * An authored map's ground: height brushes, then each water body's basin (the bed sinks below
   * the level inside the outline; the bank rises just above it outside), so the waterline is the
   * outline itself; wet, bare ground along the shores.
   */
  private shapeMap(map: MapDef): void {
    const { nx, ny, res } = this;
    const each = (box: { x0: number; y0: number; x1: number; y1: number }, f: (k: number, x: number, y: number) => void) => {
      const i0 = Math.max(0, Math.floor(box.x0 / res));
      const i1 = Math.min(nx - 1, Math.ceil(box.x1 / res));
      const j0 = Math.max(0, Math.floor(box.y0 / res));
      const j1 = Math.min(ny - 1, Math.ceil(box.y1 / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * nx + i, i * res, j * res);
    };
    for (const b of map.brushes)
      each(shapeBox(b.shape, b.falloff), (k, x, y) => {
        const d = shapeDist(b.shape, x, y);
        this.heights[k] += b.amount * (d <= 0 ? 1 : 1 - smooth01(d / b.falloff));
      });
    const BANK = 24;
    // inside any water body (a stream's bank must not dam the pond it flows into)
    const inWater = (x: number, y: number) => {
      for (const o of map.water) if (shapeDist(o.shape, x, y) < 0) return true;
      return false;
    };
    for (const wb of map.water) {
      const bed = wb.bed ?? 30;
      each(shapeBox(wb.shape, BANK), (k, x, y) => {
        const d = shapeDist(wb.shape, x, y);
        if (d < 0) {
          const floor = wb.level - 0.8 - wb.depth * smooth01(-d / bed);
          if (this.heights[k] > floor) this.heights[k] = floor;
        } else if (d < BANK && !inWater(x, y)) {
          // the bank: just above the water at the edge, blending into the land
          const bank = wb.level + 0.7 + d * 0.05;
          const t = smooth01(d / BANK);
          const h = this.heights[k];
          if (h < bank) this.heights[k] = bank + (h - bank) * t * t;
          // wet, bare mud along the shore
          const wet = 1 - smooth01(d / 14);
          if (wet > 0) {
            const k4 = k * 4;
            const keep = 1 - wet * 0.85;
            const soil = this.coverW[k4] + (255 - this.coverW[k4]) * wet * 0.85;
            this.coverW[k4] = soil;
            this.coverW[k4 + 1] *= keep;
            this.coverW[k4 + 2] *= keep;
            this.coverW[k4 + 3] *= keep;
            if (wet > 0.5) this.cover[k] = 0;
          }
        }
      });
    }
  }

  /** Natural-looking prop scatter, deterministic per seed. */
  private placeProps(rng: Rng): void {
    const W = this.width;
    const D = this.depth;
    const style = this.params.style;
    const area = (W * D) / 1e4; // in dm^2 (10 cm x 10 cm squares)
    const add = (kind: PropKind, count: number, f: (p: Prop) => void = () => {}) => {
      for (let i = 0; i < count; i++) {
        const pr: Prop = {
          kind,
          x: rng.range(8, W - 8),
          y: rng.range(8, D - 8),
          rot: rng.range(0, Math.PI * 2),
          scale: 1,
          v: rng.int(0, 1 << 20),
        };
        f(pr);
        this.props.push(pr);
      }
    };
    const dens = style === 'formicarium' ? 0.4 : 1;
    // Pebbles: many small, few large (power-law sizes).
    add('pebble', Math.round(area * 34 * dens), (p) => (p.scale = 0.5 + dpow(rng.next(), 3) * 4.5));
    add('rock', Math.round(area * 0.1 * dens), (p) => (p.scale = rng.range(10, 26)));
    add('twig', Math.round(area * (style === 'forest' ? 1.4 : style === 'sandy' ? 0.2 : 0.55) * dens), (p) => {
      p.scale = rng.range(1.2, 3.4);
      p.len = rng.range(30, 140);
    });
    const leafCount = style === 'forest' ? 6 : style === 'sandy' ? 0.3 : style === 'formicarium' ? 0.6 : 2.2;
    add('leaf', Math.round(area * leafCount), (p) => {
      p.scale = rng.range(18, 46);
      p.hue = rng.next();
      p.tilt = rng.range(-0.15, 0.15);
    });
    if (style === 'forest') add('needle', Math.round(area * 26), (p) => (p.scale = rng.range(14, 26)));
    if (style !== 'sandy') {
      add('mushroom', Math.round(area * (style === 'forest' ? 0.3 : 0.08) * dens), (p) => (p.scale = rng.range(8, 22)));
      add('acorn', Math.round(area * (style === 'forest' ? 0.25 : 0.06) * dens), (p) => (p.scale = rng.range(0.9, 1.2)));
    }
    if (style === 'forest' || style === 'meadow' || style === 'riverbank') {
      add('log', style === 'forest' ? 2 : 1, (p) => {
        p.scale = rng.range(28, 40);
        p.len = rng.range(220, 360);
      });
    }
    // Grass clumps: dense toward edges, sparse in the playable centre.
    if (style !== 'formicarium') {
      const clumps = Math.round(area * (style === 'sandy' ? 0.8 : 3));
      for (let i = 0; i < clumps; i++) {
        let x = rng.range(0, W);
        let y = rng.range(0, D);
        // Bias toward edges.
        if (rng.chance(0.65)) {
          const side = rng.int(0, 3);
          const t = rng.range(0, 1);
          const inset = Math.abs(rng.gauss()) * 45;
          if (side === 0) (x = t * W), (y = inset);
          else if (side === 1) (x = t * W), (y = D - inset);
          else if (side === 2) (x = inset), (y = t * D);
          else (x = W - inset), (y = t * D);
        }
        this.props.push({ kind: 'grassClump', x, y, rot: rng.range(0, 6.28), scale: rng.range(0.6, 1.4), v: rng.int(0, 1 << 20) });
      }
      add('moss', Math.round(area * 0.4), (p) => (p.scale = rng.range(15, 40)));
    }
  }

  /** Bake props into the walk-height overlay and obstacle mask (on an authored map: walkways and walls). */
  rebuildOverlay(): void {
    this.overlay.fill(0);
    this.blocked.fill(0);
    const { nx, ny, res } = this;
    if (this.map) {
      this.mapOverlay(this.map);
      this.version++;
      return;
    }
    const stamp = (cx: number, cy: number, r: number, h: (d: number) => number) => {
      const i0 = Math.max(0, Math.floor((cx - r) / res));
      const i1 = Math.min(nx - 1, Math.ceil((cx + r) / res));
      const j0 = Math.max(0, Math.floor((cy - r) / res));
      const j1 = Math.min(ny - 1, Math.ceil((cy + r) / res));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const d = dhypot(i * res - cx, j * res - cy) / r;
          if (d < 1) {
            const k = j * nx + i;
            const v = h(d);
            if (v > this.overlay[k]) this.overlay[k] = v;
          }
        }
    };
    for (const p of this.props) {
      switch (p.kind) {
        case 'pebble':
          stamp(p.x, p.y, p.scale, (d) => p.scale * 0.7 * Math.sqrt(1 - d * d));
          break;
        case 'rock':
          stamp(p.x, p.y, p.scale * 1.05, (d) => p.scale * 0.55 * dpow(1 - d * d, 0.6));
          break;
        case 'acorn':
          stamp(p.x, p.y, 7 * p.scale, (d) => 9 * p.scale * Math.sqrt(1 - d * d));
          break;
        case 'leaf':
          stamp(p.x, p.y, p.scale * 0.45, () => 0.5);
          break;
        case 'twig':
        case 'log': {
          const len = p.len ?? 50;
          const r = p.scale;
          const dx = dcos(p.rot);
          const dy = dsin(p.rot);
          const steps = Math.ceil(len / res);
          for (let s = 0; s <= steps; s++) {
            const t = s / steps - 0.5;
            stamp(p.x + dx * t * len, p.y + dy * t * len, r * 1.1, (d) => r * 2 * Math.sqrt(Math.max(0, 1 - d * d)));
          }
          break;
        }
        case 'mushroom': {
          const r = p.scale * 0.16;
          const i0 = Math.max(0, Math.floor((p.x - r) / res));
          const i1 = Math.min(nx - 1, Math.ceil((p.x + r) / res));
          const j0 = Math.max(0, Math.floor((p.y - r) / res));
          const j1 = Math.min(ny - 1, Math.ceil((p.y + r) / res));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (dhypot(i * res - p.x, j * res - p.y) < r) this.blocked[j * nx + i] = 1;
          break;
        }
      }
    }
    if (this.params.style === 'formicarium') {
      // Glass walls: a 4 mm blocked rim.
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) if (i < 2 || j < 2 || i > nx - 3 || j > ny - 3) this.blocked[j * nx + i] = 1;
    }
    this.version++;
  }

  /** Walkways: a flat walk surface just above the water along each path. Walls: blocked. */
  private mapOverlay(map: MapDef): void {
    const { nx, ny, res } = this;
    const each = (box: { x0: number; y0: number; x1: number; y1: number }, f: (k: number, x: number, y: number) => void) => {
      const i0 = Math.max(0, Math.floor(box.x0 / res));
      const i1 = Math.min(nx - 1, Math.ceil(box.x1 / res));
      const j0 = Math.max(0, Math.floor(box.y0 / res));
      const j1 = Math.min(ny - 1, Math.ceil(box.y1 / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * nx + i, i * res, j * res);
    };
    for (const wk of map.walkways) {
      // the highest water the path crosses sets its surface
      let level = -9999;
      for (const wb of map.water) level = Math.max(level, wb.level);
      const top = level + 0.6;
      each(shapeBox(wk.shape, 0), (k, x, y) => {
        if (shapeDist(wk.shape, x, y) >= 0) return;
        const lift = top - this.heights[k];
        if (lift > this.overlay[k]) this.overlay[k] = lift;
      });
    }
    for (const wl of map.walls)
      each(shapeBox(wl.shape, 0), (k, x, y) => {
        if (shapeDist(wl.shape, x, y) < 0) this.blocked[k] = 1;
      });
  }

  rebuildWater(): void {
    const { nx, ny, res } = this;
    this.water.fill(-9999);
    if (this.map)
      for (const wb of this.map.water) {
        const box = shapeBox(wb.shape, 0);
        const i0 = Math.max(0, Math.floor(box.x0 / res));
        const i1 = Math.min(nx - 1, Math.ceil(box.x1 / res));
        const j0 = Math.max(0, Math.floor(box.y0 / res));
        const j1 = Math.min(ny - 1, Math.ceil(box.y1 / res));
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const k = j * nx + i;
            if (this.heights[k] < wb.level && shapeDist(wb.shape, i * res, j * res) < 0 && wb.level > this.water[k]) this.water[k] = wb.level;
          }
      }
    const flood = this.params.floodLevel;
    for (let k = 0; k < nx * ny; k++) if (this.heights[k] < flood) this.water[k] = flood;
    for (const w of this.params.water) {
      // Flood-fill from the centre through samples below the water level,
      // limited to a radius, so shorelines follow the terrain contour.
      const ci = Math.round(w.x / res);
      const cj = Math.round(w.y / res);
      const maxR = (w.r * 2.2) / res;
      if (ci < 0 || cj < 0 || ci >= nx || cj >= ny) continue;
      const seen = new Uint8Array(nx * ny);
      const stack = [cj * nx + ci];
      seen[cj * nx + ci] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        const i = k % nx;
        const j = (k - i) / nx;
        if (this.heights[k] >= w.level) continue;
        if (w.level > this.water[k]) this.water[k] = w.level;
        const nb = [k - 1, k + 1, k - nx, k + nx];
        for (const q of nb) {
          if (q < 0 || q >= nx * ny || seen[q]) continue;
          const qi = q % nx;
          const qj = (q - qi) / nx;
          if (Math.abs(qi - i) > 1) continue;
          if (sq(qi - ci) + sq(qj - cj) > maxR * maxR) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    this.waterVersion++;
  }

  /** Dig a basin and fill it: used by map generation for puddles. */
  addPuddle(x: number, y: number, r: number): void {
    const op: SculptOp = { x, y, r: r * 1.25, amount: -3.5 };
    this.params.sculpt.push(op);
    this.applySculpt(op, true);
    const h = this.heightAt(x, y);
    this.params.water.push({ x, y, r, level: h + 2.2 });
    this.rebuildWater();
  }

  applySculpt(op: SculptOp, bump = true): void {
    const { nx, ny, res } = this;
    const i0 = Math.max(0, Math.floor((op.x - op.r) / res));
    const i1 = Math.min(nx - 1, Math.ceil((op.x + op.r) / res));
    const j0 = Math.max(0, Math.floor((op.y - op.r) / res));
    const j1 = Math.min(ny - 1, Math.ceil((op.y + op.r) / res));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = dhypot(i * res - op.x, j * res - op.y) / op.r;
        if (d < 1) {
          const f = 0.5 + 0.5 * dcos(d * Math.PI);
          this.heights[j * nx + i] += op.amount * f;
        }
      }
    if (bump) this.version++;
  }

  sculpt(op: SculptOp): void {
    this.params.sculpt.push(op);
    this.applySculpt(op, true);
    this.rebuildWater();
  }

  addWater(op: WaterOp): void {
    this.params.water.push(op);
    this.rebuildWater();
  }

  setFloodLevel(level: number): void {
    this.params.floodLevel = level;
    this.rebuildWater();
  }

  private sample(arr: Float32Array, x: number, y: number): number {
    const fx = Math.min(Math.max(x / this.res, 0), this.nx - 1.001);
    const fy = Math.min(Math.max(y / this.res, 0), this.ny - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const k = j * this.nx + i;
    const a = arr[k];
    const b = arr[k + 1];
    const c = arr[k + this.nx];
    const d = arr[k + this.nx + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Bare ground height (render terrain). */
  heightAt(x: number, y: number): number {
    return this.sample(this.heights, x, y);
  }

  /** Height ants walk on (ground + props). */
  walkHeight(x: number, y: number): number {
    return this.sample(this.heights, x, y) + this.sample(this.overlay, x, y);
  }

  /** Surface normal of the walk surface (x, y up, z). */
  walkNormal(x: number, y: number, out: { x: number; y: number; z: number }): void {
    const e = this.res;
    const hl = this.walkHeight(x - e, y);
    const hr = this.walkHeight(x + e, y);
    const hd = this.walkHeight(x, y - e);
    const hu = this.walkHeight(x, y + e);
    let nxv = hl - hr;
    let nyv = 2 * e;
    let nzv = hd - hu;
    const l = dhypot3(nxv, nyv, nzv);
    nxv /= l;
    nyv /= l;
    nzv /= l;
    out.x = nxv;
    out.y = nyv;
    out.z = nzv;
  }

  waterAt(x: number, y: number): number {
    const i = Math.round(x / this.res);
    const j = Math.round(y / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -9999;
    return this.water[j * this.nx + i];
  }

  isWater(x: number, y: number): boolean {
    const i = Math.round(x / this.res);
    const j = Math.round(y / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return false;
    const k = j * this.nx + i;
    return this.water[k] > this.heights[k] + this.overlay[k] + 0.3;
  }

  isBlocked(x: number, y: number): boolean {
    const i = Math.round(x / this.res);
    const j = Math.round(y / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return true;
    const k = j * this.nx + i;
    return this.blocked[k] === 1;
  }

  /** Passable for walking creatures. */
  passable(x: number, y: number): boolean {
    return !this.isBlocked(x, y) && !this.isWater(x, y);
  }

  inBounds(x: number, y: number, margin = 0): boolean {
    return x >= margin && y >= margin && x <= this.width - margin && y <= this.depth - margin;
  }
}

export function defaultTerrainParams(seed: number, style: MapStyle, width: number, depth: number): TerrainParams {
  return { seed, style, width, depth, sculpt: [], water: [], floodLevel: -9999 };
}

/** Terrain params for an authored map (its size and borrowed style come from the map file). */
export function mapTerrainParams(seed: number, id: MapId, def: MapDef = mapDef(id)): TerrainParams {
  return { seed, style: def.style, width: def.width, depth: def.depth, sculpt: [], water: [], floodLevel: -9999, map: id };
}
