/**
 * Calibration (implement-sickle-jaw-termites §3) for the grab-and-squirt:
 *  1. how long a hold takes to kill each common ant caste (bite 3 on the snap, then the ramp);
 *  2. the rescue: a sickle-jaw holds a Black Garden Ant worker and N of its nestmates (who start
 *     `gap` body lengths away when the grab lands) attack the soldier: how often do they free their
 *     friend before it dies?
 *
 *   npx vite-node tools/sickle-calibrate.ts -- [trials=12]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { CASTES } from '../src/sim/species';
import { sickleRampTotal, SICKLE_RAMP_TICKS } from '../src/sim/sickleJaws';
import { SICKLE } from '../src/sim/balance';

const args = process.argv.slice(2).filter((a) => a !== '--');
const trials = Number(args[0] ?? 12);
const H = 20;

// ---- 1. time to kill, by caste (no armour: the acid is pure damage; the bite on the snap is armour-reduced)
console.log('Hold → death (bite on the snap, then the ramp):');
for (const id of ['lasius_worker', 'lasius_soldier', 'formica_worker', 'formica_soldier', 'atta_media', 'solenopsis_worker', 'hell_worker', 'aurimyrmex_worker', 'nasute_worker', 'nasute_soldier']) {
  const cd = CASTES[id];
  if (!cd) continue;
  const bite = Math.max(SICKLE.grab.biteDamage * 0.3, SICKLE.grab.biteDamage - cd.armor);
  let n = 0;
  while (sickleRampTotal(n) < cd.hp - bite && n < 20 * 60) n++;
  const big = cd.length > SICKLE.grab.maxTargetSizeMul * CASTES.rhy_soldier.length;
  console.log(`  ${id.padEnd(18)} ${String(cd.hp).padStart(4)} HP, ${cd.length} mm: ${big ? 'too big to grab' : `dies on squirt tick ${n} (${((n + 6) / H).toFixed(2)} s from the lunge)`}`);
}
console.log(`  (ramp cap after ${SICKLE_RAMP_TICKS / H} s; 90 HP → tick ${(() => { let n = 0; while (sickleRampTotal(n) < 87) n++; return n; })()})`);

// ---- 2. the rescue
function open(w: World): { x: number; y: number } {
  for (let k = 0; k < 400; k++) {
    const x = 200 + (k % 20) * 15;
    const y = 200 + Math.floor(k / 20) * 15;
    let ok = true;
    for (let dx = -40; dx <= 60 && ok; dx += 2) for (let dy = -40; dy <= 60 && ok; dy += 4) if (!w.walkable(SURFACE, x + dx, y + dy)) ok = false;
    if (ok) return { x, y };
  }
  return { x: 350, y: 350 };
}

function rescue(seed: number, friends: number, gap: number): 'freed' | 'died' | 'timeout' {
  const w = createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'rhynchotermes', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  const p = open(w);
  const v = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x + 4.5, p.y, Math.PI);
  v.task = 'guard';
  const s = makeAnt(w, 0, 'rhy_soldier', SURFACE, p.x, p.y, 0);
  s.task = 'guard';
  s.state = AS.Attack;
  s.tgt = v.id;
  s.tk = 3;
  for (let i = 0; i < 40 && s.state !== AS.Hold; i++) w.step(0.05);
  if (s.state !== AS.Hold) return 'timeout';
  const L = CASTES.lasius_worker.length;
  for (let k = 0; k < friends; k++) {
    const ang = Math.PI * 0.5 + (k - (friends - 1) / 2) * 0.9 + (seed % 5) * 0.2;
    const f = makeAnt(w, 1, 'lasius_worker', SURFACE, s.x + Math.cos(ang) * gap * L, s.y + Math.sin(ang) * gap * L, ang + Math.PI);
    f.task = 'guard';
    f.state = AS.Attack;
    f.tgt = s.id;
    f.tk = 3;
  }
  for (let i = 0; i < 20 * 30; i++) {
    w.step(0.05);
    if (v.state === AS.Dead) return 'died';
    if (s.state === AS.Dead) return v.state !== AS.Dead ? 'freed' : 'died';
  }
  return 'timeout';
}

console.log('\nRescue: a sickle-jaw holds a Lasius worker; its nestmates attack the soldier:');
for (const friends of [1, 2, 3]) {
  for (const gap of [1, 3]) {
    let freed = 0;
    let died = 0;
    for (let t = 0; t < trials; t++) {
      const r = rescue(11 + t * 7, friends, gap);
      if (r === 'freed') freed++;
      else if (r === 'died') died++;
    }
    console.log(`  ${friends} friend${friends > 1 ? 's' : ' '} starting ${gap} body length${gap > 1 ? 's' : ' '} away: freed ${freed} / ${trials}, victim died ${died}`);
  }
}
