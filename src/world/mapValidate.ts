import type { MapDef } from '../maps/types';
import { shapeDist } from './mapShapes';
import { HEX_GROUND, HEX_WALL, HEX_WATER, HF_LAIR, HF_SHORE, SurfaceLayout } from './surfaceLayout';
import { Terrain, mapTerrainParams } from './terrain';

/** The hard rules for every site (brief §3; docs/maps/design.md §4). */
export const SITE_RULES = {
  /** footprint + ring height range at hex centres (mm) */
  maxRelief: 6,
  /** hexes from the footprint to any water or shore hex */
  water: 6,
  /** hexes from the footprint to any wall or lair hex */
  wallOrLair: 4,
  /** hexes between site centres */
  between: 12,
};

export interface MapReport {
  problems: string[];
  /** facts worth printing: hex count, hash, per-site distances */
  info: string[];
  hash: number;
}

/** Walkable 8 mm cells (the flow field's resolution) of a terrain, optionally with one flood zone flooded. */
function walkGrid(t: Terrain, def: MapDef, flooded: number): { cw: number; ch: number; ok: Uint8Array } {
  const cell = 8;
  const cw = Math.floor(t.width / cell);
  const ch = Math.floor(t.depth / cell);
  const ok = new Uint8Array(cw * ch);
  const fz = flooded >= 0 ? def.floods[flooded] : null;
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const x = (i + 0.5) * cell;
      const y = (j + 0.5) * cell;
      let w = t.passable(x, y) && t.inBounds(x, y, 2);
      if (w && fz && shapeDist(fz.shape, x, y) < 0 && t.walkHeight(x, y) < fz.level) w = false;
      ok[j * cw + i] = w ? 1 : 0;
    }
  return { cw, ch, ok };
}

/** Cells reachable by land from (x, y), 8-connected without cutting corners. */
function reach(g: { cw: number; ch: number; ok: Uint8Array }, x: number, y: number): Uint8Array {
  const { cw, ch, ok } = g;
  const seen = new Uint8Array(cw * ch);
  const i0 = Math.min(cw - 1, Math.max(0, Math.floor(x / 8)));
  const j0 = Math.min(ch - 1, Math.max(0, Math.floor(y / 8)));
  const s = j0 * cw + i0;
  if (!ok[s]) return seen;
  const stack = [s];
  seen[s] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % cw;
    const j = (k - i) / cw;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cw || nj >= ch) continue;
        const q = nj * cw + ni;
        if (seen[q] || !ok[q]) continue;
        if (di && dj && (!ok[j * cw + ni] || !ok[nj * cw + i])) continue;
        seen[q] = 1;
        stack.push(q);
      }
  }
  return seen;
}

function cellOf(g: { cw: number; ch: number }, x: number, y: number): number {
  return Math.min(g.ch - 1, Math.max(0, Math.floor(y / 8))) * g.cw + Math.min(g.cw - 1, Math.max(0, Math.floor(x / 8)));
}

/** Nearest walkable cell to a point (ring search), or −1. */
function nearestOk(g: { cw: number; ch: number; ok: Uint8Array }, x: number, y: number, maxR = 12): number {
  const i0 = Math.floor(x / 8);
  const j0 = Math.floor(y / 8);
  for (let r = 0; r <= maxR; r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= g.cw || j >= g.ch) continue;
        if (g.ok[j * g.cw + i]) return j * g.cw + i;
      }
  return -1;
}

/**
 * Check a map against the site and connectivity rules on the terrain built from it.
 * `expectSites`: 10 for the playable maps (test maps may have fewer).
 */
export function validateMap(def: MapDef, seed = 1, expectSites = 10): MapReport {
  const problems: string[] = [];
  const info: string[] = [];
  const t = new Terrain(mapTerrainParams(seed, def.id, def), def);
  const L: SurfaceLayout = t.layout!;
  const hx = L.hex;
  info.push(`${def.name}: ${def.width} × ${def.depth} mm, ${hx.cols} × ${hx.rows} = ${hx.count} hexes (R ${def.hexR} mm), layout hash ${L.hash.toString(16)}`);
  if (def.sites.length !== expectSites) problems.push(`${def.sites.length} sites (want ${expectSites})`);
  // site sets name real sites
  for (const n of [2, 3, 4, 10] as const)
    for (const set of def.siteSets[n]) {
      if (n !== 10 && set.length !== n) problems.push(`a ${n}-colony site set has ${set.length} sites`);
      for (const i of set) if (i < 0 || i >= def.sites.length) problems.push(`a ${n}-colony site set names site ${i}`);
    }
  // the hexes that count as water/shore, walls/lairs
  const wet = L.hexesWith(0).filter((q) => L.type[q] === HEX_WATER || (L.flags[q] & HF_SHORE) !== 0);
  const hard = L.hexesWith(0).filter((q) => L.type[q] === HEX_WALL || (L.flags[q] & HF_LAIR) !== 0);
  const minDist = (from: number[], to: number[]) => {
    let m = Infinity;
    for (const a of from) for (const b of to) m = Math.min(m, hx.hexDistance(a, b));
    return m;
  };
  L.sites.forEach((s, i) => {
    const area = [...s.footprint, ...s.ring];
    const bad = area.filter((q) => L.type[q] !== HEX_GROUND);
    if (bad.length) problems.push(`site ${i}: ${bad.length} footprint/ring hexes are not dry ground`);
    const flooded = area.filter((q) => L.flood[q] > 0);
    if (flooded.length) problems.push(`site ${i}: ${flooded.length} footprint/ring hexes in a flood zone`);
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of area) {
      const h = t.walkHeight(hx.centerX(q), hx.centerY(q));
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      if (!t.passable(hx.centerX(q), hx.centerY(q))) problems.push(`site ${i}: hex ${q} is not walkable`);
    }
    if (hi - lo > SITE_RULES.maxRelief) problems.push(`site ${i}: ground varies ${(hi - lo).toFixed(1)} mm (max ${SITE_RULES.maxRelief})`);
    const dw = minDist(s.footprint, wet);
    const dh = minDist(s.footprint, hard);
    if (dw < SITE_RULES.water) problems.push(`site ${i}: ${dw} hexes from water or shore (min ${SITE_RULES.water})`);
    if (dh < SITE_RULES.wallOrLair) problems.push(`site ${i}: ${dh} hexes from a wall or lair (min ${SITE_RULES.wallOrLair})`);
    for (let j = i + 1; j < L.sites.length; j++) {
      const d = hx.hexDistance(s.centre, L.sites[j].centre);
      if (d < SITE_RULES.between) problems.push(`sites ${i} and ${j}: ${d} hexes apart (min ${SITE_RULES.between})`);
    }
    if (s.entrances.length !== 1) problems.push(`site ${i}: ${s.entrances.length} main entrances (1)`);
    if (s.extras.length !== 2) problems.push(`site ${i}: ${s.extras.length} extra entrance spots (2)`);
    for (const e of [...s.entrances, ...s.extras]) {
      if (!area.includes(e)) problems.push(`site ${i}: entrance hex ${e} outside the site's footprint and ring`);
      if (L.type[e] !== HEX_GROUND || L.flags[e] & HF_SHORE) problems.push(`site ${i}: entrance hex ${e} in or next to water`);
      if (L.flood[e]) problems.push(`site ${i}: entrance hex ${e} in a flood zone`);
    }
    info.push(`  site ${i}: hex ${s.centre} (${hx.centerX(s.centre).toFixed(0)}, ${hx.centerY(s.centre).toFixed(0)}), ${dw} hexes to water, ${dh} to a wall or lair, relief ${(hi - lo).toFixed(1)} mm`);
  });
  // land connectivity: every entrance reaches every other site and every food zone, dry and during each flood
  const foodPts = def.zones.filter((z) => z.kind === 'food').map((z) => zoneCentre(z.shape));
  for (let f = -1; f < def.floods.length; f++) {
    const g = walkGrid(t, def, f);
    const when = f < 0 ? '' : ` while flood zone ${f} is flooded`;
    L.sites.forEach((s, i) => {
      const e0 = s.entrances[0];
      const r = reach(g, hx.centerX(e0), hx.centerY(e0));
      if (!r[cellOf(g, hx.centerX(e0), hx.centerY(e0))]) {
        problems.push(`site ${i}: its entrance is not walkable${when}`);
        return;
      }
      L.sites.forEach((o, j) => {
        if (j === i) return;
        const c = nearestOk(g, hx.centerX(o.entrances[0]), hx.centerY(o.entrances[0]));
        if (c < 0 || !r[c]) problems.push(`site ${i} cannot reach site ${j} by land${when}`);
      });
      for (const x of s.extras) {
        const c = cellOf(g, hx.centerX(x), hx.centerY(x));
        if (!r[c]) problems.push(`site ${i}: extra entrance spot ${x} is not reachable by land${when}`);
      }
      foodPts.forEach(([x, y], k) => {
        const c = nearestOk(g, x, y);
        if (c < 0 || !r[c]) problems.push(`site ${i} cannot reach food zone ${k} by land${when}`);
      });
    });
  }
  // determinism: the same seed builds the same terrain
  const t2 = new Terrain(mapTerrainParams(seed, def.id, def), def);
  if (terrainHash(t) !== terrainHash(t2)) problems.push('two builds from the same seed differ');
  return { problems, info, hash: L.hash };
}

function zoneCentre(s: import('../maps/types').Shape): [number, number] {
  if ('circle' in s) return [s.circle[0], s.circle[1]];
  if ('ellipse' in s) return [s.ellipse[0], s.ellipse[1]];
  const pts = 'poly' in s ? s.poly : s.path;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/** FNV-1a over the terrain's movement fields (heights, overlay, water, blocked). */
export function terrainHash(t: Terrain): number {
  let h = 0x811c9dc5;
  for (const a of [new Uint8Array(t.heights.buffer), new Uint8Array(t.overlay.buffer), new Uint8Array(t.water.buffer), t.blocked]) {
    for (let i = 0; i < a.length; i++) {
      h ^= a[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}
