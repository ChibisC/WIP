/**
 * Tick time on the authored maps: a 10-colony AI match (every site used) on each map, run for a
 * few minutes of game time. Prints the average, p95 and worst simulation tick and the ant count.
 *   npx vite-node tools/map-perf.ts -- [seconds=180] [maps=meadowPond,forestFloor,...]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { PLAYABLE_MAPS } from '../src/maps';
import type { MapId } from '../src/maps/types';
import { SpeciesId } from '../src/sim/species';
import { AS } from '../src/sim/types';

const args = (globalThis as unknown as { process: { argv: string[] } }).process.argv.slice(2).filter((a) => a !== '--');
const secs = Number(args[0] ?? 180);
const maps = (args[1] ? args[1].split(',') : PLAYABLE_MAPS) as MapId[];
const SPECIES: SpeciesId[] = ['lasius', 'formica', 'atta', 'solenopsis', 'eciton', 'hell', 'aurimyrmex', 'termant', 'nasutitermes', 'rhynchotermes'];
for (const id of maps) {
  const t0 = performance.now();
  const w = createWorld({ seed: 4, style: 'meadow', width: 100, depth: 100, map: id, colonies: SPECIES.map((species) => ({ species, player: false, ai: true })), food: 1.2, settings: { creatures: 1 } }, new EventBus());
  const tCreate = performance.now() - t0;
  const ticks: number[] = [];
  const n = Math.round(secs * 20);
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    w.step(0.05);
    ticks.push(performance.now() - a);
  }
  const late = ticks.slice(Math.floor(n / 2)).sort((x, y) => x - y);
  const avg = late.reduce((s, x) => s + x, 0) / late.length;
  const ants = w.s.ants.filter((a) => a.state !== AS.Dead).length;
  console.log(`${id}: built in ${(tCreate / 1000).toFixed(1)} s; second half of ${secs} s: tick avg ${avg.toFixed(2)} ms, p95 ${late[Math.floor(late.length * 0.95)].toFixed(2)} ms, worst ${late[late.length - 1].toFixed(1)} ms; ${ants} ants, ${w.s.creatures.length} creatures`);
}
