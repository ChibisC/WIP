import { MAPS } from '../src/maps';
import { validateMap } from '../src/world/mapValidate';
import { Terrain, mapTerrainParams } from '../src/world/terrain';
for (const id of ['oakWoods', 'floodHill', 'rainforestEdge', 'gardenBelow', 'stonyHollow', 'fireBanks', 'spiderTerrace'] as const) {
  const def = MAPS[id]!;
  const r = validateMap(def, 1, def.sites.length);
  const probs = r.problems.filter((p) => !(id === 'floodHill' && /flood zone/.test(p)));
  const t = new Terrain(mapTerrainParams(1, id));
  const bad = Object.entries(def.story!.points).filter(([, p]) => !t.passable(p[0], p[1]) || !t.inBounds(p[0], p[1], 4));
  const badPath = Object.entries(def.story!.paths).filter(([, P]) => P.some((p) => !t.passable(p[0], p[1])));
  const lv = new Set<number>();
  for (let y = 20; y < def.depth; y += 20) for (let x = 20; x < def.width; x += 20) if (t.passable(x, y)) lv.add(t.levelAt(x, y));
  console.log(id, probs.length ? probs.join(' | ') : 'OK', bad.length ? 'BADPTS ' + bad.map(([k]) => k).join(',') : '', badPath.length ? 'BADPATH ' + badPath.map(([k]) => k).join(',') : '', 'levels', [...lv].sort().join(','));
}
