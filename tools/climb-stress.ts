/**
 * Climbing stress test (CHANGE_PLAN §15.2): four titans (stag beetle,
 * tarantula, scolopendra, giant mantis) each with a full load of riders, and
 * 1,000 ants on the ground (fighting round the titans and foraging). Prints
 * the tick time with climbing on, and with climbing turned off for comparison.
 *
 *   npx vite-node tools/climb-stress.ts -- [seconds=40]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { BALANCE } from '../src/sim/balance';
import { climbCap } from '../src/sim/creatures/climb';

const secs = Number(process.argv.slice(2).filter((a) => a !== '--')[0] ?? 40);
const TITANS = ['stagBeetle', 'tarantula', 'scolopendra', 'giantMantis'];

function run(climb: boolean): { avg: number; p95: number; worst: number; riders: number[]; caps: number[]; ants: number } {
  const saved = BALANCE.climb.maxRiders;
  if (!climb) (BALANCE.climb as { maxRiders: number }).maxRiders = 0;
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
  for (let i = 0; i < 360; i++) {
    const a = makeAnt(w, i % 2, i % 2 ? 'formica_worker' : 'lasius_worker', SURFACE, 120 + (i % 30) * 22, 450 + Math.floor(i / 30) * 9, i);
    a.task = 'forage';
    n++;
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
  (BALANCE.climb as { maxRiders: number }).maxRiders = saved;
  const s = times.slice(40).sort((a, b) => a - b);
  return { avg: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.floor(s.length * 0.95)], worst: s[s.length - 1], riders: maxRiders, caps, ants: n };
}

const on = run(true);
const off = run(false);
console.log(`climbing on : ${on.ants} ants, riders at most ${on.riders.join(' / ')} of caps ${on.caps.join(' / ')} (${TITANS.join(', ')})`);
console.log(`              tick avg ${on.avg.toFixed(2)} ms, p95 ${on.p95.toFixed(2)} ms, worst ${on.worst.toFixed(1)} ms`);
console.log(`climbing off: tick avg ${off.avg.toFixed(2)} ms, p95 ${off.p95.toFixed(2)} ms, worst ${off.worst.toFixed(1)} ms`);
