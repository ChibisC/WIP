/**
 * Balance check (skill implement-nasute-termites §3): one nasute at full ramp
 * should beat one baseline ant soldier (Lasius) only when it gets about 3 s
 * of uninterrupted fire first. Duels on open ground: the soldier is held in
 * place (stunned, as if glued or blocked) for `head` seconds while the nasute
 * fires, then charges.
 *
 *   npx vite-node tools/nasute-duel.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';

function duel(head: number, dist: number): { win: boolean; t: number; hpLeft: number } {
  const w = createWorld({ seed: 5, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'nasutitermes', player: true, ai: false }, { species: 'lasius', player: false, ai: false }] }, new EventBus());
  let p = { x: 350, y: 350 };
  for (let k = 0; k < 400; k++) {
    const x = 200 + (k % 20) * 15;
    const y = 200 + Math.floor(k / 20) * 15;
    let ok = true;
    for (let dx = -40; dx <= 70 && ok; dx += 2) for (let dy = -10; dy <= 10 && ok; dy += 5) if (!w.walkable(SURFACE, x + dx, y + dy)) ok = false;
    if (ok) {
      p = { x, y };
      break;
    }
  }
  const n = makeAnt(w, 0, 'nasute_soldier', SURFACE, p.x, p.y, 0);
  n.task = 'guard';
  const s = makeAnt(w, 1, 'lasius_soldier', SURFACE, p.x + dist, p.y, Math.PI);
  s.task = 'guard';
  s.cd2 = 1e6; // no acid opener: a fair bite-for-glue duel
  w.reindex();
  n.state = AS.Attack;
  n.tgt = s.id;
  n.tk = 3;
  s.state = AS.Attack;
  s.tgt = n.id;
  s.tk = 3;
  s.stun = head;
  for (let i = 0; i < 20 * 30; i++) {
    w.step(0.05);
    if (n.state === AS.Dead || s.state === AS.Dead) break;
  }
  return { win: s.state === AS.Dead && n.state !== AS.Dead, t: w.s.time, hpLeft: n.state === AS.Dead ? 0 : n.hp };
}

for (const head of [0, 1, 2, 2.5, 3, 3.5, 4]) {
  const r = duel(head, 24);
  console.log(`head start ${head.toFixed(1)} s of uninterrupted fire: nasute ${r.win ? 'WINS' : 'loses'} (${r.t.toFixed(1)} s, nasute hp left ${r.hpLeft.toFixed(1)})`);
}
