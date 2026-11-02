/**
 * Kings (user note 2026-11-02; sim/kings.ts): the Termants' and the termites' kings do no nest duties; each walks round
 * the queen inside her chamber (the queen's tiles) and fights intruders who come in.
 *   npx vite-node tests/kings.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, nestSpace } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { isJobWorker } from '../src/sim/jobs';
import { inRoyalChamber } from '../src/sim/kings';
import { hashState } from '../src/sim/snapshot';
import { datan2, dhypot } from '../src/sim/dmath';
import { SpeciesId } from '../src/sim/species';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();

function world(species: SpeciesId, ai: boolean, seed = 5): World {
  return createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species, player: true, ai, developed: 20, startWorkers: 14 }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
}

for (const species of ['termant', 'nasutitermes', 'rhynchotermes'] as SpeciesId[]) {
  // 1. three minutes of a colony run by the AI (so there are jobs to take): where the king goes and what he does
  const w = world(species, true);
  const c = w.s.colonies[0];
  const king = w.antById.get(c.king!)!;
  const q = w.antById.get(c.queen)!;
  let samples = 0;
  let inChamber = 0;
  let jobs = 0;
  let moving = 0;
  const angles = new Set<number>();
  for (let t = 0; t < 20 * 180; t++) {
    w.step(0.05);
    w.events.drain();
    if (t % 10) continue;
    samples++;
    if (king.space === nestSpace(c.id) && inRoyalChamber(w, c, king.x, king.y)) inChamber++;
    if (king.task === 'job') jobs++;
    if (king.v > 0) moving++;
    // which twelfth of the circle round the queen he is in
    angles.add(Math.floor(((datan2(king.y - q.y, king.x - q.x) - q.h + 4 * Math.PI) % (2 * Math.PI)) / (Math.PI / 6)));
  }
  check(`${species}: the king takes no nest duties (no job, not a job worker)`, jobs === 0 && !isJobWorker(c, king), `${jobs} samples on a job`);
  check(`${species}: the king stays in the queen's chamber`, inChamber >= samples * 0.95, `${inChamber}/${samples} samples inside`);
  check(`${species}: he walks round her (moving part of the time, seen on most sides of her)`, moving > samples * 0.1 && moving < samples * 0.9 && angles.size >= 6, `moving ${((moving / samples) * 100).toFixed(0)} % of the time, ${angles.size}/12 sides`);

  // 2. an intruder in the chamber: the king goes for it
  const w2 = world(species, false, 7);
  const c2 = w2.s.colonies[0];
  const k2 = w2.antById.get(c2.king!)!;
  const q2 = w2.antById.get(c2.queen)!;
  for (let t = 0; t < 20 * 5; t++) w2.step(0.05);
  // keep the colony's other ants out of it: only the king and the intruder
  for (const a of w2.s.ants) if (a.colony === c2.id && a.id !== k2.id && a.id !== q2.id) a.hp = 0, (a.state = AS.Dead);
  w2.reindex();
  const foe = makeAnt(w2, w2.s.colonies[1].id, 'formica_worker', nestSpace(c2.id), k2.x + 4, k2.y + 2, 0);
  foe.task = 'guard';
  w2.reindex();
  const hp0 = foe.hp;
  let near = Infinity;
  for (let t = 0; t < 20 * 15; t++) {
    w2.step(0.05);
    w2.events.drain();
    if (foe.state !== AS.Dead) near = Math.min(near, dhypot(foe.x - k2.x, foe.y - k2.y));
  }
  check(`${species}: an intruder in the chamber is attacked by the king`, foe.state === AS.Dead || foe.hp < hp0, `intruder hp ${hp0.toFixed(0)} → ${Math.max(0, foe.hp).toFixed(0)}, closest ${near.toFixed(1)} mm`);
}

{
  // 3. determinism: the walk is a pure function of the king's id and the tick
  const a = world('termant', true, 9);
  const b = world('termant', true, 9);
  for (let t = 0; t < 20 * 60; t++) {
    a.step(0.05);
    b.step(0.05);
    a.events.drain();
    b.events.drain();
  }
  check('determinism: two runs of a Termant colony give the same state', hashState(a) === hashState(b), hashState(a).slice(0, 16));
}

console.log(failed ? `\n${failed} king test(s) FAILED (${((Date.now() - t0) / 1000).toFixed(1)}s)` : `\nall king tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
