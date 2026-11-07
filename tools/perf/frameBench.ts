/**
 * The worker → main thread frame's cost (performance v2, CHANGE_PLAN §29): building it in the worker, its size, and
 * reading it into the replica, for the big-fight stress world.
 *
 *   npx vite-node tools/perf/frameBench.ts [antsPerColony=200] [creatures=100] [frames=200]
 */
import { EventBus } from '../../src/core/events';
import { createStressWorld } from '../../src/dev/stressScene';
import { FrameBuilder } from '../../src/worker/frames';
import { Replica } from '../../src/game/replica';
import { encodeState, restoreWorld } from '../../src/sim/snapshot';
import { MotionCarry } from '../../src/game/playout';
import { ColumnReader, ColumnWriter, columnCodegen } from '../../src/sim/columns';

const per = Number(process.argv[2] ?? 200);
const nCr = Number(process.argv[3] ?? 100);
const frames = Number(process.argv[4] ?? 200);
const w = createStressWorld(new EventBus(), per, nCr);
for (let i = 0; i < 60; i++) {
  w.step(0.05);
  w.events.drain();
}
const replicaWorld = restoreWorld(encodeState(w), new EventBus());
const fb = new FrameBuilder(w, true);
const rep = new Replica(replicaWorld);
const carry = new MotionCarry();
let build = 0;
let apply = 0;
let bytes = 0;
let sim = 0;
let colRead = 0;
const readers = [0, 1, 2, 3, 4].map(() => new ColumnReader<{ id: number }>());
for (let f = 0; f < frames; f++) {
  const t0 = performance.now();
  w.step(0.05);
  const evs = w.events.drain() ?? [];
  const t1 = performance.now();
  const { msg } = fb.build(w, 1, Array.isArray(evs) ? evs : [], t1 - t0);
  const t2 = performance.now();
  carry.alpha = 0.5;
  rep.apply(msg, carry);
  const t3 = performance.now();
  // the columns alone, in a second set of readers
  const lists = [msg.ants, msg.food, msg.brood, msg.creatures, msg.projectiles];
  const t4 = performance.now();
  lists.forEach((p, i) => readers[i].read(p));
  colRead += performance.now() - t4;
  sim += t1 - t0;
  build += t2 - t1;
  apply += t3 - t2;
  for (const p of [msg.ants, msg.food, msg.brood, msg.creatures, msg.projectiles]) bytes += p.num.byteLength + p.str.byteLength;
}
// the generated loops against the plain ones, on the same packets, alternating
{
  const gens = [true, false].map(() => ({ w: new ColumnWriter(), r: new ColumnReader<{ id: number }>(), wt: 0, rt: 0 }));
  const can = columnCodegen.on;
  for (let f = 0; f < 120; f++) {
    w.step(0.05);
    w.events.drain();
    gens.forEach((g, k) => {
      columnCodegen.on = can && k === 0;
      const t0 = performance.now();
      const p = g.w.write(w.s.ants, null, undefined, true);
      const t1 = performance.now();
      g.r.read(p);
      const t2 = performance.now();
      if (f >= 20) {
        g.wt += t1 - t0;
        g.rt += t2 - t1;
      }
    });
  }
  columnCodegen.on = can;
  console.log(`ant columns: generated loops write ${(gens[0].wt / 100).toFixed(2)} / read ${(gens[0].rt / 100).toFixed(2)} ms; plain loops write ${(gens[1].wt / 100).toFixed(2)} / read ${(gens[1].rt / 100).toFixed(2)} ms${can ? '' : ' (this runtime cannot compile: both plain)'}`);
}
console.log(`${w.s.ants.length} ants, ${w.s.creatures.length} creatures: sim ${(sim / frames).toFixed(2)} ms a tick; frame build ${(build / frames).toFixed(2)} ms (worker), read ${(apply / frames).toFixed(2)} ms (main thread; the columns alone ${(colRead / frames).toFixed(2)}), entity columns ${(bytes / frames / 1024).toFixed(0)} KB a frame`);
