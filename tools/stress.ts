/**
 * Stress / profiling scenario (multiplayer brief, Part A targets):
 * 4 colonies × N ants (default 400) fighting and foraging across the surface,
 * their 4 nests and 2 caves, plus wild creatures. Prints simulation tick time
 * (average, p95, worst), heap use and snapshot size.
 *
 *   npx vite-node tools/stress.ts -- [antsPerColony=400] [seconds=60] [creatures=100] [species=lasius,formica,solenopsis,atta]
 */
import { EventBus } from '../src/core/events';
import { AS } from '../src/sim/types';
import { createStressWorld } from '../src/dev/stressScene';

const args = process.argv.slice(2).filter((a) => a !== '--');
const per = Number(args[0] ?? 400);
const secs = Number(args[1] ?? 60);
const nCreatures = Number(args[2] ?? 100);
const species = args[3] ? args[3].split(',') : undefined;

const t0 = performance.now();
const w = createStressWorld(new EventBus(), per, nCreatures, species);
const tCreate = performance.now() - t0;

const ants0 = w.s.ants.length;
// per-system timing
const sysMs = new Map<string, number[]>();
for (const sys of w.systems) {
  const fn = sys.fn;
  const arr: number[] = [];
  sysMs.set(sys.name, arr);
  sys.fn = (ww, dt) => {
    const a = performance.now();
    fn(ww, dt);
    arr.push(performance.now() - a);
  };
}
const heap0 = process.memoryUsage().heapUsed;

// warm-up, then measure
for (let i = 0; i < 100; i++) w.step(0.05);
const times: number[] = [];
let heapMax = 0;
const N = secs * 20;
for (let i = 0; i < N; i++) {
  const a = performance.now();
  w.step(0.05);
  w.events.drain();
  times.push(performance.now() - a);
  if (i % 100 === 0) heapMax = Math.max(heapMax, process.memoryUsage().heapUsed);
}
times.sort((x, y) => x - y);
const avg = times.reduce((s, v) => s + v, 0) / times.length;
const p95 = times[Math.floor(times.length * 0.95)];
const worst = times[times.length - 1];
const over50 = times.filter((t) => t > 50).length;
const s0 = performance.now();
const json = JSON.stringify(w.serialize());
const sMs = performance.now() - s0;
const alive = w.s.ants.filter((a) => a.state !== AS.Dead).length;
console.log(`world created in ${tCreate.toFixed(0)} ms; ${ants0} ants at start (${alive} alive at end), ${w.s.creatures.length} creatures, ${w.undergroundSpaces().length} underground areas`);
console.log(`tick: avg ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, worst ${worst.toFixed(2)} ms, ${over50} ticks over 50 ms (of ${N})`);
console.log(`heap: ${(heap0 / 1048576).toFixed(0)} MB after setup, peak ${(heapMax / 1048576).toFixed(0)} MB`);
for (const [name, arr] of sysMs) {
  if (!arr.length) continue;
  const tot = arr.reduce((x, y) => x + y, 0);
  const mx = Math.max(...arr);
  console.log(`  ${name.padEnd(12)} total ${tot.toFixed(0).padStart(6)} ms  per call ${(tot / arr.length).toFixed(2).padStart(6)} ms  worst ${mx.toFixed(1).padStart(6)} ms  calls ${arr.length}`);
}
console.log(`snapshot (JSON): ${(json.length / 1048576).toFixed(2)} MB in ${sMs.toFixed(0)} ms`);
