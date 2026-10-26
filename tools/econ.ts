/**
 * Growth harness: one colony on a map, run by the builder brain, for N game
 * minutes. Prints population, food, tiles and dug hexes every minute.
 *   npx vite-node tools/econ.ts -- lasius 30 [seed] [foodMul] [creaturesMul]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { SpeciesId } from '../src/sim/species';
import { AS } from '../src/sim/types';

const args = process.argv.slice(2).filter((a) => a !== '--');
const species = (args[0] ?? 'lasius') as SpeciesId;
const minutes = Number(args[1] ?? 20);
const seed = Number(args[2] ?? 7);
const foodMul = Number(args[3] ?? 1);
const crMul = Number(args[4] ?? 0);
const w = createWorld({ seed, style: 'meadow', width: 900, depth: 900, colonies: [{ species, player: true, ai: true, popLimit: 300 }], food: foodMul, settings: { creatures: crMul } }, new EventBus());
const c = w.s.colonies[0];
const g = w.nest(c.id)!;
const t0 = performance.now();
let lastFood = c.stats.food;
console.log('min  ants  brood  food/cap   income/min  tiles(brood/food/spec)  dug  desig  died/kills  creatures  tasks');
for (let m = 1; m <= minutes; m++) {
  for (let i = 0; i < 1200; i++) w.step(0.05);
  const tasks: Record<string, number> = {};
  for (const a of w.s.ants) if (a.colony === c.id && a.state !== AS.Dead) tasks[a.task] = (tasks[a.task] ?? 0) + 1;
  let dug = 0;
  for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q)) dug++;
  const br = c.tiles.filter((t) => t.type === 'brood').length;
  const fd = c.tiles.filter((t) => t.type === 'food').length;
  const sp = c.tiles.length - br - fd - 7;
  const inc = c.stats.food - lastFood;
  lastFood = c.stats.food;
  const brood = w.s.brood.filter((b) => b.colony === c.id).length;
  console.log(`${String(m).padStart(3)}  ${String(c.living).padStart(4)}  ${String(brood).padStart(5)}  ${c.food.toFixed(0).padStart(4)}/${String(c.foodCap).padEnd(5)} ${inc.toFixed(0).padStart(8)}     ${br}/${fd}/${sp}`.padEnd(64) + `${String(dug).padStart(4)}  ${String(g.designatedCount).padStart(4)}  ${String(c.stats.died).padStart(4)}/${String(c.stats.kills).padEnd(5)} ${w.s.creatures.filter((cr) => !cr.dead).map((cr) => cr.kind.slice(0, 5)).join(',').padEnd(10)}  ${Object.entries(tasks).map(([k, v]) => k + ':' + v).join(' ')}`);
}
console.log(`ran ${minutes} min in ${((performance.now() - t0) / 1000).toFixed(1)} s; food on surface ${w.s.food.filter((f) => f.space === 0 && f.kind !== 'corpse').length}`);
