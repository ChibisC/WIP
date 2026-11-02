import { fbm2 } from '../core/rng';

/**
 * The island's shape in map units (x and y 0..1 of the map's width and height; the map is 1200 × 820 at 1×):
 * the coastline, which region a point belongs to, and the level-node slots of each region. Pure arithmetic on the
 * seeded noise, shared by the hub's painter (ui/islandMap.ts), the campaign data (story/campaign.ts) and the tests.
 *
 * The campaign is planned for up to about 40 levels (user, 2026-11-02): every region holds a fixed set of slots, spread
 * evenly inside it and far enough apart that nodes and their names never overlap once the map is zoomed to them.
 */

export const MAP_W = 1200;
export const MAP_H = 820;
const CX = 0.52;
const CY = 0.52;
/** x is stretched to the map's aspect so the island is round-ish on screen */
const ASPECT = (MAP_H / MAP_W) * 1.45;

export interface RegionGeo {
  id: string;
  at: readonly [number, number];
}

/** The coastline's radius at an angle (in map heights): irregular, with bays. */
export function coastR(a: number): number {
  const n = fbm2(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, 4, 77) - 0.5;
  const bays = Math.sin(a * 3 + 0.7) * 0.025 + Math.sin(a * 7 + 2.1) * 0.012;
  return 0.39 * (1 + n * 0.45 + bays);
}

/** Signed distance inside the coast (> 0 on land), in map heights. */
export function inIsland(x: number, y: number): number {
  const dx = (x - CX) * ASPECT;
  const dy = y - CY;
  return coastR(Math.atan2(dy, dx)) - Math.hypot(dx, dy);
}

/** A point on the coast at an angle (map units). */
export function coastPoint(a: number, off = 0): [number, number] {
  const r = coastR(a) + off;
  return [CX + (Math.cos(a) * r) / ASPECT, CY + Math.sin(a) * r];
}

/** The region a point is in (wavy borders), its distance and the runner-up's (for border shading). */
export function nearestRegion<R extends RegionGeo>(regions: readonly R[], x: number, y: number): { r: R; d: number; d2: number } {
  let best = regions[0];
  let bd = Infinity;
  let second = Infinity;
  for (const r of regions) {
    const j = (fbm2(x * 7 + r.at[0] * 13, y * 7 + r.at[1] * 13, 4, 31) - 0.5) * 0.16;
    const d = Math.hypot((x - r.at[0]) * (MAP_W / MAP_H), y - r.at[1]) + j + (r.id === 'heart' ? 0.05 : 0);
    if (d < bd) {
      second = bd;
      bd = d;
      best = r;
    } else if (d < second) second = d;
  }
  return { r: best, d: bd, d2: second };
}

/** Least distance between level nodes (map heights); about 40 px at 1×, so names fit once zoomed in. */
export const SLOT_SPACING = 0.052;

/**
 * `n` node slots inside a region, spread on a sunflower spiral round its centre and kept on land, in the region, off
 * the coast and apart from each other (deterministic). The first slot is nearest the centre.
 */
export function regionSlots<R extends RegionGeo>(regions: readonly R[], region: R, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const [cx, cy] = region.at;
  for (let k = 0; k < 400 && out.length < n; k++) {
    const a = k * 2.39996323;
    const r = 0.03 * Math.sqrt(k + 0.5);
    const x = cx + (Math.cos(a) * r * MAP_H) / MAP_W;
    const y = cy + Math.sin(a) * r;
    if (inIsland(x, y) < 0.035) continue;
    const nr = nearestRegion(regions, x, y);
    if (nr.r.id !== region.id || nr.d2 - nr.d < 0.025) continue;
    if (out.some(([px, py]) => Math.hypot((px - x) * (MAP_W / MAP_H), py - y) < SLOT_SPACING)) continue;
    out.push([x, y]);
  }
  return out;
}
