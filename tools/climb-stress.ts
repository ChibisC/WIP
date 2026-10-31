/**
 * Climbing stress test (CHANGE_PLAN §15.2, §16): four titans (stag beetle, tarantula, scolopendra, giant mantis) each
 * with a full load of riders (the cap, 12) and 160 ants round each; and (combat v2) a 400 v 400 clash of Lasius and
 * Formica in the middle. Prints the tick time with mounting on, and with mounting turned off (caps 0) for comparison.
 * The combat v2 target: under 15 ms a tick on average.
 *
 *   npx vite-node tools/climb-stress.ts -- [seconds=40] [clash=400]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { BALANCE } from '../src/sim/balance';
import { climbCap } from '../src/sim/creatures/climb';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const secs = Number(argv[0] ?? 40);
const clash = Number(argv[1] ?? 400);
const TITANS = ['stagBeetle', 'tarantula', 'scolopendra', 'giantMantis'];

function run(climb: boolean): { avg: number; p95: number; worst: number; riders: number[]; caps: number[]; ants: number } {
  const M = BALANCE.mount as { capLarge: number; capHuge: number };
  const saved = [M.capLarge, M.capHuge];
  if (!climb) M.capLarge = M.capHuge = 0;
  const w = createWorld({ seed: 11, style: 'meadow', width: 900, depth: 900, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const titans = TITANS.map((k, i) => {
    const x = 250 + (i % 2) * 400;
    const y = 250 + Math.floor(i / 2) * 400;
    const cr = spawnCreature(w, k, SURFACE, x, y);
    cr.hp = cr.maxHp = 1e8;
    return cr;
  });
  // 1,000 ants: 160 of one colony round each titan (more than any cap: the rest fight on the ground), 360 of both foraging
  let n = 0;
  for (const cr of titans) {
    for (let i = 0; i < 160; i++) {
      const a = makeAnt(w, 0, i % 4 === 0 ? 'lasius_soldier' : 'lasius_worker', SURFACE, cr.x + Math.cos(i * 2.4) * (cr.scale * 0.7 + (i % 9) * 3), cr.y + Math.sin(i * 2.4) * (cr.scale * 0.7 + (i % 9) * 3), i);
      a.task = 'guard';
      a.alarm = 1;
      a.tgt = cr.id;
      a.tk = 4;
      a.state = AS.Attack;
      n++;
    }
  }
  // the clash: two armies a little apart in the middle, charging each other
  for (let i = 0; i < clash; i++) {
    for (const col of [0, 1]) {
      const a = makeAnt(w, col, col ? (i % 5 === 0 ? 'formica_soldier' : 'formica_worker') : i % 5 === 0 ? 'lasius_soldier' : 'lasius_worker', SURFACE, 450 + (col ? 30 : -30) + (col ? 1 : -1) * (i % 10) * 4, 300 + Math.floor(i / 10) * 7, col ? Math.PI : 0);
      a.task = 'guard';
      a.alarm = 1;
      a.cd2 = 1e6;
      n++;
    }
  }
  w.reindex();
  const times: number[] = [];
  let maxRiders = titans.map(() => 0);
  for (let t = 0; t < secs * 20; t++) {
    const t0 = performance.now();
    w.step(0.05);
    times.push(performance.now() - t0);
    w.events.drain();
    // keep the ground armies topped up so the titans stay crowded
    if (t % 100 === 0) for (const cr of titans) cr.hp = cr.maxHp;
    maxRiders = titans.map((cr, i) => Math.max(maxRiders[i], cr.climbers ?? 0));
  }
  const caps = titans.map((cr) => climbCap(cr));
  [M.capLarge, M.capHuge] = saved;
  const s = times.slice(40).sort((a, b) => a - b);
  return { avg: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.floor(s.length * 0.95)], worst: s[s.length - 1], riders: maxRiders, caps, ants: n };
}

const on = run(true);
const off = run(false);
console.log(`mounting on : ${on.ants} ants (${clash} v ${clash} clash + 4 × 160 round the titans), riders at most ${on.riders.join(' / ')} of caps ${on.caps.join(' / ')} (${TITANS.join(', ')})`);
console.log(`              tick avg ${on.avg.toFixed(2)} ms, p95 ${on.p95.toFixed(2)} ms, worst ${on.worst.toFixed(1)} ms`);
console.log(`mounting off: tick avg ${off.avg.toFixed(2)} ms, p95 ${off.p95.toFixed(2)} ms, worst ${off.worst.toFixed(1)} ms`);
