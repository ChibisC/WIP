/**
 * The Trees map of every map (and a procedural one): builds the canopy, reports its trunks, climb points, sites, food and
 * walkable hexes, checks that every crown hangs together with its trunk top (sim/trees.ts prunes what does not), that
 * every site and food item is reachable from a trunk top, and that every climb point stands on walkable ground.
 *
 *   npx vite-node tools/trees-check.ts [-- seed]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { PLAYABLE_MAPS } from '../src/maps';
import { TREES } from '../src/sim/types';
import { kindsOf, TK_LEAF, TK_WOOD } from '../src/sim/trees';
import { hexCoreCells } from '../src/sim/colony';

const seed = Number(process.argv.slice(2).filter((a) => a !== '--')[0] ?? 3);
let bad = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const ids = [...PLAYABLE_MAPS, 'procedural'];
for (const id of ids) {
  const t0 = performance.now();
  const w = createWorld(
    {
      seed,
      style: 'meadow',
      width: 800,
      depth: 800,
      food: 1,
      trees: true,
      colonies: [
        { species: 'formica', player: true, ai: false },
        { species: 'lasius', player: false, ai: true },
      ],
      settings: { creatures: 0, titanRaids: false },
      ...(id !== 'procedural' ? { map: id } : {}),
    } as never,
    new EventBus(),
  );
  const d = w.s.trees;
  const g = w.nestOf(TREES);
  const ms = (performance.now() - t0).toFixed(0);
  if (!d || !g) {
    check(`${id}: trees built`, ['formicarium', 'arena'].includes(id) || id.startsWith('test'), `no trees (${ms} ms)`);
    continue;
  }
  const kinds = kindsOf(d);
  let walk = 0;
  let leaf = 0;
  for (let q = 0; q < kinds.length; q++) {
    if (kinds[q]) walk++;
    if (kinds[q] === TK_LEAF) leaf++;
  }
  const climbs = d.trunks.reduce((n, t) => n + t.climbs.length, 0);
  const food = w.s.food.filter((f) => f.space === TREES).length;
  console.log(`${id}: ${d.trunks.length} trees, ${climbs} climb points, ${d.sites.length} sites (${d.sites.map((s) => s.kind).join(', ')}), ${walk} walkable hexes (${leaf} leaf), ${food} food, grid ${g.cols}×${g.rows} (${g.w}×${g.h} cells), built in ${ms} ms`);
  check(`${id}: 4–6 sites`, d.sites.length >= 4 && d.sites.length <= 6, String(d.sites.length));
  check(`${id}: all three site kinds`, ['leaf', 'hollow', 'fork'].every((k) => d.sites.some((s) => s.kind === k)));
  // reachability from the trunk tops (the exit field)
  const flow = w.flowOf(TREES)!;
  const f = flow.field('check-exit', () => g.entrances.flatMap((q) => hexCoreCells(g, q, 0.35)), 1);
  let unreachable = 0;
  for (const s of d.sites) if (flow.distAt(f, s.x, s.y) === Infinity) unreachable++;
  check(`${id}: every site reachable from a trunk top`, unreachable === 0, `${unreachable} not`);
  let foodUnreach = 0;
  for (const fd of w.s.food) if (fd.space === TREES && flow.distAt(f, fd.x, fd.y) === Infinity) foodUnreach++;
  check(`${id}: every food item reachable`, foodUnreach === 0, `${foodUnreach} not`);
  let badClimb = 0;
  for (const t of d.trunks) for (const e of t.climbs) if (!w.walkable(0, e.sx, e.sy)) badClimb++;
  check(`${id}: climb points on walkable ground`, badClimb === 0, `${badClimb} blocked`);
  let topsOk = 0;
  for (const t of d.trunks) if (t.top >= 0 && (kinds[t.top] === 3 || kinds[t.top] === TK_WOOD)) topsOk++;
  check(`${id}: every trunk has a walkable top`, topsOk === d.trunks.length, `${topsOk}/${d.trunks.length}`);
  // the trunks block the ground
  let blocked = 0;
  for (const t of d.trunks) if (!w.terrain.passable(t.x, t.y)) blocked++;
  check(`${id}: trunks block the ground`, blocked === d.trunks.length);
}
console.log(bad ? `${bad} problems` : 'all trees checks passed');
process.exit(bad ? 1 : 0);
