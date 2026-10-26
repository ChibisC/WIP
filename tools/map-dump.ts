/**
 * Dump an authored map's layout and movement fields as JSON for the layout sketch
 * (tools/map-sketch.py). Run: npx vite-node tools/map-dump.ts -- <mapId> <out.json>
 */
import { writeFileSync } from 'node:fs';
import { mapDef } from '../src/maps';
import type { MapId } from '../src/maps/types';
import { Terrain, mapTerrainParams } from '../src/world/terrain';

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv.slice(2).filter((a) => a !== '--');
const id = (argv[0] ?? 'meadowPond') as MapId;
const out = argv[1] ?? `${id}.json`;
const def = mapDef(id);
const t = new Terrain(mapTerrainParams(1, id));
const L = t.layout!;
const step = 4;
const nx = Math.floor(t.width / step);
const ny = Math.floor(t.depth / step);
const height: number[] = [];
const kind: number[] = []; // 0 land, 1 water, 2 walkway (walkable over water), 3 blocked
for (let j = 0; j < ny; j++)
  for (let i = 0; i < nx; i++) {
    const x = i * step + step / 2;
    const y = j * step + step / 2;
    height.push(Math.round(t.walkHeight(x, y) * 10) / 10);
    kind.push(t.isBlocked(x, y) ? 3 : t.isWater(x, y) ? 1 : t.waterAt(x, y) > -9999 ? 2 : 0);
  }
writeFileSync(
  out,
  JSON.stringify({
    id,
    name: def.name,
    width: t.width,
    depth: t.depth,
    step,
    nx,
    ny,
    height,
    kind,
    hex: { cols: L.hex.cols, rows: L.hex.rows, R: L.hex.R, H: L.hex.H, C: L.hex.C },
    type: Array.from(L.type),
    flags: Array.from(L.flags),
    flood: Array.from(L.flood),
    sites: L.sites.map((s, i) => ({ i, x: L.hex.centerX(s.centre), y: L.hex.centerY(s.centre), footprint: s.footprint, ring: s.ring, entrances: s.entrances.map((q) => [L.hex.centerX(q), L.hex.centerY(q)]) })),
    zones: def.zones,
    floods: def.floods,
    siteSets: def.siteSets,
    hash: L.hash.toString(16),
  }),
);
console.log(`wrote ${out}`);
