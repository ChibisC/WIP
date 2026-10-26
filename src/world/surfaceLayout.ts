import type { MapDef, ZoneKind } from '../maps/types';
import { HexLayout } from './hexLayout';
import { inShape } from './mapShapes';

/** Hex types (one byte per hex). Movement itself follows the authored shapes in the terrain; these carry the rules. */
export const HEX_GROUND = 0;
export const HEX_WATER = 1;
export const HEX_WALKWAY = 2;
export const HEX_WALL = 3;

/** Hex flags (bit mask). */
export const HF_SHORE = 1 << 0;
export const HF_SITE = 1 << 1;
export const HF_SITE_RING = 1 << 2;
export const HF_ENTRANCE = 1 << 3;
export const HF_LAIR = 1 << 4;
export const HF_FOOD = 1 << 5;
export const HF_APHID = 1 << 6;
export const HF_PLANT = 1 << 7;
export const HF_CREATURE = 1 << 8;
export const HF_NO_SPAWN = 1 << 9;
export const HF_LITTER = 1 << 10;

export const ZONE_FLAG: Record<ZoneKind, number> = {
  food: HF_FOOD,
  aphid: HF_APHID,
  plant: HF_PLANT,
  lair: HF_LAIR,
  creature: HF_CREATURE,
  noSpawn: HF_NO_SPAWN,
  litter: HF_LITTER,
};

/** The dry ring a site keeps round its footprint (hexes). */
export const SITE_RING = 2;

export interface SiteHexes {
  centre: number;
  footprint: number[];
  ring: number[];
  entrances: number[];
  /**
   * Surface spots for up to two extra entrances (docs/maps/design.md; claude/maps/02-spec-nest-entrances):
   * the authored ones, else two dry hexes on the inner edge of the site's ring, about 120° either
   * side of the main entrance.
   */
  extras: number[];
}

/**
 * A map's surface hex layout: one type byte, a flag mask and a flood-zone id per hex, plus the
 * hexes of each site. Built deterministically from the map file (shapes tested at hex centres),
 * so every client gets the same bytes; `hash` (FNV-1a) identifies the result.
 */
export class SurfaceLayout {
  readonly hex: HexLayout;
  readonly type: Uint8Array;
  readonly flags: Uint16Array;
  /** 0 = no flood zone, i + 1 = the map's flood zone i */
  readonly flood: Uint8Array;
  /** −1, or the site whose footprint or ring the hex belongs to */
  readonly site: Int8Array;
  readonly sites: SiteHexes[] = [];
  readonly hash: number;

  constructor(readonly def: MapDef) {
    const hex = HexLayout.covering(def.width, def.depth, def.hexR);
    this.hex = hex;
    const n = hex.count;
    this.type = new Uint8Array(n);
    this.flags = new Uint16Array(n);
    this.flood = new Uint8Array(n);
    this.site = new Int8Array(n).fill(-1);
    for (let q = 0; q < n; q++) {
      const x = hex.centerX(q);
      const y = hex.centerY(q);
      let t = HEX_GROUND;
      for (const wb of def.water) if (inShape(wb.shape, x, y)) t = HEX_WATER;
      for (const w of def.walls) if (inShape(w.shape, x, y)) t = HEX_WALL;
      for (const wk of def.walkways) if (inShape(wk.shape, x, y)) t = HEX_WALKWAY;
      this.type[q] = t;
      let f = 0;
      for (const z of def.zones) if (inShape(z.shape, x, y)) f |= ZONE_FLAG[z.kind];
      this.flags[q] = f;
      for (let i = 0; i < def.floods.length; i++) if (inShape(def.floods[i].shape, x, y)) this.flood[q] = i + 1;
    }
    for (const [q, t] of def.overrides ?? []) if (q >= 0 && q < n) this.type[q] = t;
    // shore: dry land next to water
    for (let q = 0; q < n; q++) {
      if (this.type[q] === HEX_WATER) continue;
      for (let d = 0; d < 6; d++) {
        const nb = hex.neighbor(q, d);
        if (nb >= 0 && this.type[nb] === HEX_WATER) {
          this.flags[q] |= HF_SHORE;
          break;
        }
      }
    }
    // sites
    for (let i = 0; i < def.sites.length; i++) {
      const s = def.sites[i];
      const centre = hex.nearestHex(s.at[0], s.at[1]);
      const fp = s.footprint ?? 1;
      const footprint = hex.disk(centre, fp);
      const ring = hex.disk(centre, fp + SITE_RING).filter((q) => hex.hexDistance(q, centre) > fp);
      const entrances = s.entrances.map((e) => hex.nearestHex(e[0], e[1]));
      for (const q of footprint) {
        this.flags[q] |= HF_SITE;
        this.site[q] = i;
      }
      for (const q of ring) {
        this.flags[q] |= HF_SITE_RING;
        if (this.site[q] < 0) this.site[q] = i;
      }
      for (const q of entrances) this.flags[q] |= HF_ENTRANCE;
      // extra entrance spots: authored ones after the first, else picked on the ring
      let extras = entrances.slice(1, 3);
      const main = entrances.slice(0, 1);
      if (extras.length < 2 && main.length) {
        const cx = hex.centerX(centre);
        const cy = hex.centerY(centre);
        let ux = hex.centerX(main[0]) - cx;
        let uy = hex.centerY(main[0]) - cy;
        const ul = Math.sqrt(ux * ux + uy * uy) || 1;
        ux /= ul;
        uy /= ul;
        const S = Math.sqrt(3) / 2;
        const targets = [
          [ux * -0.5 - uy * S, ux * S + uy * -0.5],
          [ux * -0.5 + uy * S, -ux * S + uy * -0.5],
        ];
        const inner = ring.filter((q) => hex.hexDistance(q, centre) === fp + 1 && this.type[q] === HEX_GROUND && !this.flood[q] && !(this.flags[q] & (HF_ENTRANCE | HF_SHORE)));
        extras = [];
        for (const [tx, ty] of targets) {
          let best = -1;
          let bs = -2;
          for (const q of inner) {
            if (extras.includes(q)) continue;
            const vx = hex.centerX(q) - cx;
            const vy = hex.centerY(q) - cy;
            const vl = Math.sqrt(vx * vx + vy * vy) || 1;
            const sc = (vx * tx + vy * ty) / vl;
            if (sc > bs) (bs = sc), (best = q);
          }
          if (best >= 0) extras.push(best);
        }
      }
      for (const q of extras) this.flags[q] |= HF_ENTRANCE;
      this.sites.push({ centre, footprint, ring, entrances: main, extras });
    }
    this.hash = fnv(this.type, fnv(new Uint8Array(this.flags.buffer), fnv(this.flood)));
  }

  /** Hex type at a point (mm); outside the grid counts as a wall. */
  typeAt(x: number, y: number): number {
    const q = this.hex.hexAt(x, y);
    return q < 0 ? HEX_WALL : this.type[q];
  }

  flagsAt(x: number, y: number): number {
    const q = this.hex.hexAt(x, y);
    return q < 0 ? 0 : this.flags[q];
  }

  /** Hexes carrying all of a flag mask, in index order. */
  hexesWith(mask: number): number[] {
    const out: number[] = [];
    for (let q = 0; q < this.flags.length; q++) if ((this.flags[q] & mask) === mask) out.push(q);
    return out;
  }

  private zoneCache = new Map<number, number[]>();

  /** Dry ground hexes of a zone flag (food, aphid…), cached; empty when the map has no such zone. */
  zoneHexes(flag: number): number[] {
    let z = this.zoneCache.get(flag);
    if (!z) {
      z = this.hexesWith(flag).filter((q) => this.type[q] === HEX_GROUND && !(this.flags[q] & (HF_SITE | HF_SITE_RING)));
      this.zoneCache.set(flag, z);
    }
    return z;
  }

  /**
   * The sites a match uses, in colony order: the map's balanced set for 2–4 colonies (set index
   * `set`, or chosen by the seed), the 10-colony order otherwise (its first n), one site for 1.
   */
  siteOrder(n: number, set: number, seed: number): number[] {
    const d = this.def;
    if (n <= 0 || !d.sites.length) return [];
    const pick = (sets: number[][]) => sets[(set >= 0 ? set : seed) % sets.length];
    if (n === 1) return d.siteSets[2].length ? [pick(d.siteSets[2])[0]] : [0];
    if (n <= 4 && d.siteSets[n as 2 | 3 | 4].length) return pick(d.siteSets[n as 2 | 3 | 4]).slice(0, n);
    const all = d.siteSets[10].length ? pick(d.siteSets[10]) : d.sites.map((_, i) => i);
    return all.slice(0, n);
  }
}

/** FNV-1a over bytes, continuing from h. */
export function fnv(a: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < a.length; i++) {
    h ^= a[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const cache = new Map<string, SurfaceLayout>(); // det-ok: a pure cache of layouts built from immutable map files (same input, same bytes)

/** The layout for a map (built once per map; the map file never changes at run time). */
export function surfaceLayout(def: MapDef): SurfaceLayout {
  let l = cache.get(def.id);
  if (!l || l.def !== def) {
    l = new SurfaceLayout(def);
    cache.set(def.id, l);
  }
  return l;
}
