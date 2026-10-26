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
import { HF_FOOD } from '../src/world/surfaceLayout';
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { nestToSurface } from '../src/sim/colony';
import { SURFACE } from '../src/sim/types';
import { runDeterminism } from '../src/dev/determinism';

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

// ---- a world on the test map: colonies on their sites, entrances on the authored hexes, zones used
const setup: GameSetup = {
  seed: 9,
  style: 'meadow',
  width: 100,
  depth: 100,
  map: 'testPond',
  colonies: [
    { species: 'lasius', player: true, ai: false },
    { species: 'formica', player: false, ai: true },
    { species: 'solenopsis', player: false, ai: true },
    { species: 'atta', player: false, ai: true },
  ],
  caves: [{ name: 'Lair', kind: 'lair', food: 20 }],
  food: 1.2,
};
const w = createWorld(setup, new EventBus());
const order = w.terrain.layout!.siteOrder(4, -1, 9);
check('the map sets the world size (setup width/depth are ignored)', w.terrain.width === 720 && w.terrain.depth === 720 && w.terrain.params.map === 'testPond');
check('four colonies stand on the four-colony site set', w.s.colonies.every((c, i) => c.site === order[i]) && new Set(w.s.colonies.map((c) => c.site)).size === 4, `sites ${w.s.colonies.map((c) => c.site).join(',')}`);
const entOk = w.s.colonies.every((c) => {
  const s = w.terrain.layout!.sites[c.site!];
  const q = s.entrances[0];
  const e = c.entrances[0];
  return Math.abs(e.sx - w.terrain.layout!.hex.centerX(q)) < 0.01 && Math.abs(e.sy - w.terrain.layout!.hex.centerY(q)) < 0.01 && w.terrain.passable(e.sx, e.sy);
});
check('each first entrance opens on its site’s authored entrance hex, on dry ground', entOk);
const lair = w.s.caves[0]?.entrances[0];
check('the lair opens in the lair zone', !!lair && Math.hypot(lair.sx - 600, lair.sy - 360) < 40, lair ? `(${lair.sx.toFixed(0)}, ${lair.sy.toFixed(0)})` : 'no cave');
const surfFood = w.s.food.filter((f) => f.space === SURFACE);
const inZone = surfFood.filter((f) => (w.terrain.layout!.flagsAt(f.x, f.y) & HF_FOOD) !== 0).length;
check('most food lies in the food zones, none in water or walls', surfFood.length > 10 && inZone / surfFood.length > 0.5 && surfFood.every((f) => w.terrain.passable(f.x, f.y)), `${inZone} of ${surfFood.length} in zones`);
check('aphids and plants stand on dry ground', w.s.aphids.every((a) => w.terrain.passable(a.x, a.y)) && w.s.plants.every((p) => w.terrain.passable(p.x, p.y)));
// a dug shaft opens on the site (its next authored entrance, else inside the dry area)
{
  const c = w.s.colonies[0];
  const g = w.nest(c.id)!;
  const L2 = w.terrain.layout!;
  const sh = g.shafts[0];
  if (sh !== undefined) {
    const p = g.hexCenter(sh);
    const s = nestToSurface(w, c, p.x, p.y);
    const centre = L2.sites[c.site!].centre;
    const d = Math.hypot(s.x - L2.hex.centerX(centre), s.y - L2.hex.centerY(centre));
    check('a shaft dug later surfaces inside the site’s dry area', d <= 3 * L2.hex.H && w.terrain.passable(s.x, s.y), `${d.toFixed(1)} mm from the centre`);
  }
}
// two runs and a snapshot restore stay identical (the map is rebuilt from its id + seed)
const det = runDeterminism(2400, 200, 1200, setup, false);
check('a map game is deterministic, also after a snapshot restore (2 min)', det.bDiff === -1 && det.cDiff === -1, `bDiff ${det.bDiff}, cDiff ${det.cDiff}, ${det.ants} ants`);

// ---- every playable map
for (const id of PLAYABLE_MAPS) {
  const r = validateMap(MAPS[id]!, 1, 10);
  check(`${id}: site, entrance and connectivity rules (also during floods)`, r.problems.length === 0, r.problems.slice(0, 6).join('; '));
  for (const s of [2, 3, 7]) check(`${id}: seed ${s} builds the same layout`, new Terrain(mapTerrainParams(s, id)).layout!.hash === r.hash);
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all map tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
