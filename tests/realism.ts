/**
 * Realism pass (docs/realism): the stag beetle boss's grab-lift-toss and plough, headless and deterministic.
 *
 *   npx vite-node tests/realism.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { Ant, AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { CS, spawnCreature } from '../src/sim/creatures/creatureAI';
import { STAG } from '../src/sim/balance';
import { hashState } from '../src/sim/snapshot';
import { openGround } from '../tools/spinScenes';

let failed = 0;
const t0 = Date.now();
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}

/** A stag beetle in its grab phase facing a knot of black garden ants. */
function scene(seed = 11) {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w);
  const cr = spawnCreature(w, 'stagBeetle', SURFACE, p.x, p.y);
  cr.h = 0;
  cr.ph = 0;
  // under 75 % health: the 'Grab and toss' phase
  cr.hp = cr.maxHp * 0.6;
  const ants: Ant[] = [];
  for (let i = 0; i < 12; i++) {
    const a = makeAnt(w, 0, 'lasius_worker', SURFACE, p.x + 38 + (i % 4) * 4, p.y - 6 + Math.floor(i / 4) * 5, Math.PI);
    a.hp = a.maxHp = 1e4; // nobody dies, so the clamp and toss can be watched
    ants.push(a);
  }
  w.reindex();
  return { w, cr, ants };
}

{
  const { w, cr, ants } = scene();
  let lifted: Ant[] = [];
  let maxLift = 0;
  let sawLift = false;
  let tossed: Array<{ a: Ant; x0: number; y0: number }> = [];
  for (let t = 0; t < 20 * 12 && !tossed.length; t++) {
    w.step(0.05);
    w.events.drain();
    if (cr.state === CS.Lift) {
      sawLift = true;
      lifted = ants.filter((a) => a.gripCr === cr.id);
      for (const a of lifted) maxLift = Math.max(maxLift, a.fz);
    } else if (sawLift && lifted.length) tossed = lifted.map((a) => ({ a, x0: a.x, y0: a.y }));
  }
  const flungNow = tossed.length > 0 && tossed.every(({ a }) => a.state === AS.Flung && !a.gripCr && a.fz > 0);
  check('stag beetle: after opening its antlers it clamps one or two ants and lifts them', sawLift && lifted.length >= 1 && lifted.length <= STAG.hold, `${lifted.length} held`);
  const L = 100;
  check('stag beetle: the clamped ants rise off the ground between the antler tips', maxLift > L * STAG.liftH * 0.8, `lifted ${maxLift.toFixed(1)} mm`);
  for (let t = 0; t < 10; t++) {
    w.step(0.05);
    w.events.drain();
  }
  const sideways = tossed.every(({ a, x0, y0 }) => Math.abs(a.y - y0) > Math.abs(a.x - x0) * 0.5 && Math.hypot(a.x - x0, a.y - y0) > 3);
  check('stag beetle: then it tosses them aside (flung from up there, mostly to one side)', flungNow && sideways, tossed.map(({ a, x0, y0 }) => `${(a.x - x0).toFixed(1)},${(a.y - y0).toFixed(1)}`).join(' '));
  for (let t = 0; t < 40; t++) {
    w.step(0.05);
    w.events.drain();
  }
  check('stag beetle: the tossed ants land and get up again', tossed.every(({ a }) => a.state !== AS.Flung && a.fz === 0));
}

{
  // the plough: walking at a target through a crowd, the ants in front are pushed aside
  const { w, cr, ants } = scene(13);
  cr.hp = cr.maxHp; // advance phase only (no grabs)
  const far = makeAnt(w, 0, 'lasius_worker', SURFACE, cr.x + 140, cr.y, 0);
  far.hp = far.maxHp = 1e4;
  w.reindex();
  let pushed = 0;
  const start = cr.x;
  for (let t = 0; t < 20 * 8; t++) {
    const before = ants.map((a) => a.y);
    w.step(0.05);
    w.events.drain();
    ants.forEach((a, i) => {
      if (Math.abs(a.y - before[i]) > 0.5) pushed++;
    });
  }
  check('stag beetle: it ploughs through a crowd, shoving the ants in front aside', pushed > 10 && cr.x - start > 10, `${pushed} shoves, moved ${(cr.x - start).toFixed(0)} mm`);
}

{
  // deterministic: the same scene twice gives the same state
  const a = scene(17);
  const b = scene(17);
  for (let t = 0; t < 20 * 6; t++) {
    a.w.step(0.05);
    b.w.step(0.05);
    a.w.events.drain();
    b.w.events.drain();
  }
  check('stag beetle: grab, lift and toss are deterministic', hashState(a.w) === hashState(b.w));
}

console.log(failed ? `\n${failed} realism test(s) FAILED` : `\nall realism tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
