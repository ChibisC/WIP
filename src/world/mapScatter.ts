import { Rng } from '../core/rng';
import type { Biome, MapDef, Shape } from '../maps/types';
import { shapeDist } from './mapShapes';
import { dcos, dhypot, dpow, dsin } from '../sim/dmath';
import { HF_ENTRANCE, HF_SITE, HF_SITE_RING } from './surfaceLayout';
import type { Terrain } from './terrain';

/**
 * The small obstacles lying about an authored map — pebbles, fungi and fern clumps (no sticks since 2026-11-01) — placed once from the
 * map id, so the simulation and the renderer agree on them (user 2026-11-01: "ants should only be flat on the ground
 * and not … walk over rocks (they walk around it) … this also applies to sticks and other obstacles"). The terrain
 * blocks them (ants and creatures walk round); render/mapDecor.ts and render/mapBiomes.ts draw them. Grass and
 * flowers stay render-only (ants walk through grass; no fallen leaves since 2026-11-01, evening).
 */

/** How much grass, litter, twigs, ferns and fungi a biome has (per dm²). */
export interface BiomeDress {
  /** long-grass clumps per dm² (and how many of them hug the map edges) */
  grass: number;
  edge: number;
  /** grass colour: green meadow or dry savanna */
  dry: boolean;
  /** pebbles per dm² */
  pebbles: number;
  /** wildflower drifts per dm² */
  flowers: number;
  /** twigs per dm² (drawn from the generator and dropped since 2026-11-01, 22:00: no sticks on the ground) */
  twigs: number;
  /** small fungus clusters per dm² */
  fungi: number;
  /** fern clumps per dm² */
  ferns: number;
  /** shore reed density (× the meadow's) */
  reeds: number;
}

export const BIOME_DRESS: Record<Biome, BiomeDress> = {
  meadow: { grass: 3.4, edge: 0.5, dry: false, pebbles: 7, flowers: 0.12, twigs: 0.08, fungi: 0, ferns: 0, reeds: 1 },
  forest: { grass: 0.45, edge: 0.6, dry: false, pebbles: 4, flowers: 0, twigs: 1.1, fungi: 0.12, ferns: 0.07, reeds: 0.5 },
  riverbank: { grass: 2.4, edge: 0.4, dry: false, pebbles: 9, flowers: 0.05, twigs: 0.35, fungi: 0, ferns: 0, reeds: 1.6 },
  rainforest: { grass: 0.15, edge: 0.6, dry: false, pebbles: 2, flowers: 0, twigs: 0.7, fungi: 0.08, ferns: 0.2, reeds: 0.6 },
  savanna: { grass: 2.2, edge: 0.3, dry: true, pebbles: 11, flowers: 0.02, twigs: 0.55, fungi: 0, ferns: 0, reeds: 0.4 },
};

/** One obstacle (map mm; y is the plane's second axis, the renderer's z). */
export interface MapObstacle {
  kind: 'pebble' | 'twig' | 'fungus' | 'fern';
  x: number;
  y: number;
  /** pebble: its scale (≈ radius, mm); twig: its radius; fungus, fern: its size (mm) */
  s: number;
  /** twig: length (mm) and heading (the renderer's rotateY) */
  len?: number;
  yaw?: number;
  /** the seed of its shape (the renderer's own random stream for it) */
  seed: number;
  /** the radius it blocks (mm; a twig: along its length) */
  r: number;
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function nearWater(map: MapDef, x: number, z: number, d: number): boolean {
  for (const wb of map.water) if (shapeDist(wb.shape, x, z) < d) return true;
  return false;
}

/** Polar radius of a shape about its centre (circles and ellipses; others: their box), for scree round the rocks. */
function rough(shape: Shape): { cx: number; cz: number; r: (a: number) => number; rMax: number } | null {
  if ('circle' in shape) return { cx: shape.circle[0], cz: shape.circle[1], r: () => shape.r, rMax: shape.r };
  if ('ellipse' in shape) {
    const { rx, ry } = shape;
    const rot = shape.rot ?? 0;
    return { cx: shape.ellipse[0], cz: shape.ellipse[1], r: (a) => (rx * ry) / dhypot(ry * dcos(a - rot), rx * dsin(a - rot)), rMax: Math.max(rx, ry) };
  }
  if ('poly' in shape) {
    const P = shape.poly;
    let cx = 0;
    let cz = 0;
    for (const p of P) (cx += p[0]), (cz += p[1]);
    cx /= P.length;
    cz /= P.length;
    // the farthest corner: scree is scattered from the outline outward (shapeDist keeps it off the rock)
    let rMax = 0;
    for (const p of P) rMax = Math.max(rMax, dhypot(p[0] - cx, p[1] - cz));
    return { cx, cz, r: () => rMax * 0.6, rMax };
  }
  return null;
}

/**
 * The obstacles of an authored map. `t` must have its walls, walkways and water in place (they decide where nothing
 * goes); the result depends only on the map and the terrain, never on what was placed before it.
 */
export function mapObstacles(t: Terrain, map: MapDef): MapObstacle[] {
  const rng = new Rng(hashStr(map.id) ^ 0x0b57ac1e);
  const d = BIOME_DRESS[map.biome] ?? BIOME_DRESS.meadow;
  const W = t.width;
  const D = t.depth;
  const L = t.layout;
  // nothing within an obstacle's reach of a nest site, its ring or an entrance (they stay open ground)
  const SITE = HF_SITE | HF_ENTRANCE | HF_SITE_RING;
  const keepClear = (x: number, z: number, r: number) => {
    if (!L) return false;
    if (L.flagsAt(x, z) & SITE) return true;
    const rr = r + t.res * 1.5;
    for (let k = 0; k < 8; k++) if (L.flagsAt(x + dcos(k * 0.7854) * rr, z + dsin(k * 0.7854) * rr) & SITE) return true;
    return false;
  };
  // (only the map's own shapes and walls decide: never the water level, which floods change — a game restored
  // mid-flood must place the same obstacles)
  const free = (x: number, z: number, m = 6, r = 4) => {
    if (x < 4 || z < 4 || x > W - 4 || z > D - 4) return false;
    if (t.isBlocked(x, z)) return false;
    for (const wb of map.water) if (shapeDist(wb.shape, x, z) < 10) return false;
    for (const wl of map.walls) if (shapeDist(wl.shape, x, z) < 1) return false;
    for (const wk of map.walkways) if (shapeDist(wk.shape, x, z) < m) return false;
    return !keepClear(x, z, r);
  };
  const out: MapObstacle[] = [];
  const area = (W * D) / 1e4;
  const pebble = (x: number, z: number, sc: number) => out.push({ kind: 'pebble', x, y: z, s: sc, seed: rng.int(0, 1 << 20), r: sc * 1.1 });
  // pebbles: a light scatter, gravel along running water, scree round the rocks
  for (let i = 0; i < area * d.pebbles; i++) {
    const x = rng.range(0, W);
    const z = rng.range(0, D);
    const sc = 0.5 + dpow(rng.next(), 3) * 2.8;
    if (free(x, z, 3, sc * 1.1)) pebble(x, z, sc);
  }
  if (d.reeds > 1)
    for (let i = 0; i < area * 12; i++) {
      const x = rng.range(0, W);
      const z = rng.range(0, D);
      const sc = 0.6 + dpow(rng.next(), 2) * 3.2;
      if (nearWater(map, x, z, 45) && !nearWater(map, x, z, 9) && free(x, z, 3, sc * 1.1)) pebble(x, z, sc);
    }
  for (const wl of map.walls) {
    const o = rough(wl.shape);
    if (!o) continue;
    for (let i = 0; i < o.rMax * 0.5; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = o.r(a) + Math.abs(rng.gauss()) * 10 + 1;
      const x = o.cx + dcos(a) * r;
      const z = o.cz + dsin(a) * r;
      const sc = 0.8 + dpow(rng.next(), 2) * 4;
      if (free(x, z, 3, sc * 1.1)) pebble(x, z, sc);
    }
  }
  // no sticks (user 2026-11-01, 22:00: "remove obstacle sticks on the ground cos they give bugs … not trunks just
  // sticks"): their draws stay, so the fungi and ferns after them lie where they did
  for (let i = 0; i < area * d.twigs; i++) {
    rng.range(0, W);
    rng.range(0, D);
    rng.range(30, 120);
    rng.range(1.0, 2.6);
    rng.range(0, 6.28);
    rng.int(0, 1 << 20);
  }
  // fungi (each cap of a small cluster) and fern clumps (their base)
  for (let i = 0; i < area * d.fungi; i++) {
    const x = rng.range(0, W);
    const z = rng.range(0, D);
    const n = rng.int(1, 3);
    const caps: MapObstacle[] = [];
    for (let k = 0; k < n; k++) {
      const s = rng.range(6, 16);
      caps.push({ kind: 'fungus', x: x + rng.range(-8, 8), y: z + rng.range(-8, 8), s, yaw: rng.range(0, 6.28), seed: rng.int(0, 1 << 20), r: s * 0.3 });
    }
    if (free(x, z, 8, 12)) out.push(...caps.filter((c) => free(c.x, c.y, 8, c.r)));
  }
  for (let i = 0; i < area * d.ferns; i++) {
    const x = rng.range(0, W);
    const z = rng.range(0, D);
    const s = rng.range(60, 150);
    const seed = rng.int(0, 1 << 20);
    if (free(x, z, 10, 10)) out.push({ kind: 'fern', x, y: z, s, seed, r: Math.max(3, s * 0.05) });
  }
  return out;
}

/** The centre line of a twig (as render/props.ts branchGeometry bends it, from the same seed), `n` + 1 points. */
export function twigLine(o: MapObstacle, n: number): Array<[number, number]> {
  const r = new Rng(o.seed);
  const len = o.len ?? 50;
  const bend = r.range(-0.08, 0.08) * len;
  const bend2 = r.range(-0.04, 0.04) * len;
  const c = dcos(o.yaw ?? 0);
  const s = dsin(o.yaw ?? 0);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const lx = (u - 0.5) * len;
    const lz = dsin(u * Math.PI) * bend + dsin(u * 6.2) * bend2;
    // rotateY(yaw): (x, z) → (x cos + z sin, −x sin + z cos)
    pts.push([o.x + lx * c + lz * s, o.y - lx * s + lz * c]);
  }
  return pts;
}
