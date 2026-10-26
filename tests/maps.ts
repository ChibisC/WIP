/**
 * Authored surface maps (docs/maps/design.md): the rasteriser, the terrain built from a map,
 * and the validator's site and connectivity rules, on the small test map and on every
 * playable map. Run: npx vite-node tests/maps.ts
 */
import { MAPS, PLAYABLE_MAPS } from '../src/maps';
import { TEST_POND } from '../src/maps/testPond';
import { Terrain, mapTerrainParams } from '../src/world/terrain';
import { HEX_WALKWAY, HEX_WALL, HEX_WATER, SurfaceLayout } from '../src/world/surfaceLayout';
import { terrainHash, validateMap } from '../src/world/mapValidate';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const t0 = Date.now();

// ---- the test map's terrain
const t = new Terrain(mapTerrainParams(5, 'testPond'));
const L = t.layout!;
check('a map builds a 4 mm terrain with its hex layout', t.res === 4 && !!L && L.hex.R === 8 && t.width === 720, `res ${t.res}, ${L.hex.cols} × ${L.hex.rows} hexes`);
check('no props in the simulation on an authored map (decoration is render-only)', t.props.length === 0);
check('the pond is water and blocks walking', t.isWater(380, 300) && !t.passable(380, 300) && L.typeAt(380, 300) === HEX_WATER);
check('just outside the pond is dry, walkable ground', t.passable(250, 250) && !t.isWater(250, 250));
check('the stone walkway across the pond is walkable over the water', t.passable(370, 356) && t.waterAt(370, 356) > -9999 && L.typeAt(370, 356) === HEX_WALKWAY, `walk ${t.walkHeight(370, 356).toFixed(2)}, water ${t.waterAt(370, 356).toFixed(2)}`);
check('beside the walkway is still water', !t.passable(370, 400) && t.isWater(370, 400));
check('the log is a wall: blocked, never climbed', !t.passable(535, 470) && t.isBlocked(535, 470) && L.typeAt(535, 470) === HEX_WALL && t.walkHeight(535, 470) < 10);
// the waterline is the outline: walk along a line out of the pond and find one switch from water to land
let switches = 0;
let prev = t.passable(380, 300);
for (let x = 380; x >= 200; x -= 1) {
  const p = t.passable(x, 300);
  if (p !== prev) switches++;
  prev = p;
}
check('one clean shoreline crossing from the middle of the pond to the meadow', switches === 1, `${switches} switches`);
const sx = (() => {
  for (let x = 380; x >= 200; x -= 1) if (t.passable(x, 300)) return x;
  return -1;
})();
check('the shoreline ants stop at is the outline (within one height sample)', Math.abs(sx - 272.9) < 5, `land from x = ${sx}`);

// ---- determinism and the layout hash
const t2 = new Terrain(mapTerrainParams(5, 'testPond'));
check('the same seed builds identical movement fields', terrainHash(t) === terrainHash(t2));
const t3 = new Terrain(mapTerrainParams(6, 'testPond'));
check('another seed changes only detail, never the layout', new SurfaceLayout(TEST_POND).hash === L.hash && t3.layout!.hash === L.hash && !t3.passable(380, 300) && t3.passable(370, 356));

// ---- the validator on the test map (4 sites), and that it catches broken maps
const rep = validateMap(TEST_POND, 5, 4);
check('the test map passes the site and connectivity rules', rep.problems.length === 0, rep.problems.slice(0, 4).join('; '));
const wet = { ...TEST_POND, id: 'testPond' as const, sites: TEST_POND.sites.map((s, i) => (i === 0 ? { at: [300, 220] as const, entrances: [[300, 190] as const] } : s)) };
const r2 = validateMap(wet, 5, 4);
check('the validator rejects a site at the pond', r2.problems.some((p) => p.includes('site 0') && p.includes('water')), r2.problems.slice(0, 2).join('; '));
const cut = { ...TEST_POND, id: 'testPond' as const, walls: [...TEST_POND.walls, { kind: 'rock' as const, shape: { poly: [[0, 220], [720, 220], [720, 240], [0, 240]] as const }, height: 30 }] };
const r3 = validateMap(cut, 5, 4);
check('the validator rejects a map whose sites are cut off from each other', r3.problems.some((p) => p.includes('cannot reach')), r3.problems.slice(0, 2).join('; '));

// ---- every playable map
for (const id of PLAYABLE_MAPS) {
  const r = validateMap(MAPS[id]!, 1, 10);
  check(`${id}: site, entrance and connectivity rules (also during floods)`, r.problems.length === 0, r.problems.slice(0, 6).join('; '));
  for (const s of [2, 3, 7]) check(`${id}: seed ${s} builds the same layout`, new Terrain(mapTerrainParams(s, id)).layout!.hash === r.hash);
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all map tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
