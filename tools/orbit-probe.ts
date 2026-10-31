/**
 * Orbit probe (user note 2026-10-31, a screenshot: dozens of Black garden ants circling round one Red wood ant in a big
 * spiral while other foes fought nearby): an arena fight where one side outnumbers the other, sampled every second.
 * For the side that outnumbers: how many ants are idle in the fight (waiting on a full foe's ring, or going round), how
 * many of them wait while some foe in sight still has a free slot, the most ants round one foe, and how far out the
 * farthest of them stands (in its body lengths).
 *
 *   npx vite-node tools/orbit-probe.ts -- [seed=4] [secs=20] [mine=lasius_worker:45] [theirs=formica_worker:6,formica_soldier:2]
 */
import { AS } from '../src/sim/types';
import { casteOf } from '../src/sim/species';
import { antSlotCount, antSlotsTaken } from '../src/sim/slots';
import { World } from '../src/sim/world';
import { arenaWorld, spawn } from './fightMotion';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const SEED = Number(argv[0] ?? 4);
const SECS = Number(argv[1] ?? 20);
const MINE = (argv[2] ?? 'lasius_worker:45').split(',').map((s) => s.split(':') as [string, string]);
const THEIRS = (argv[3] ?? 'formica_worker:6,formica_soldier:2').split(',').map((s) => s.split(':') as [string, string]);

export interface OrbitStats {
  /** per sampled second: [waiting, going round, holding, closing in, waiting while a foe had room, most round one foe, farthest waiter (body lengths)] */
  rows: number[][];
  /** waiting ants: mm walked (all systems) over their body lengths, and ant-ticks — their restlessness */
  waitMoveL: number;
  waitTicks: number;
  /** spread of the waiting crowd: sum and count of the waiters' distances from their foe (body lengths) */
  waitDistL: number;
  waitN: number;
  /** ant-seconds spent waiting / going round while some live foe in the fight had a free slot */
  wastedS: number;
  /** total fighting ant-seconds of the big side */
  fightS: number;
}

export function orbit(w: World, secs: number, team = 0): OrbitStats {
  const S: OrbitStats = { rows: [], wastedS: 0, fightS: 0, waitMoveL: 0, waitTicks: 0, waitDistL: 0, waitN: 0 };
  const prev = new Map<number, [number, number]>();
  for (let t = 0; t < secs * 20; t++) {
    prev.clear();
    for (const a of w.s.ants) if (a.state === AS.Attack && (a.waitT ?? 0) > 0) prev.set(a.id, [a.x, a.y]);
    w.step(0.05);
    w.events.drain();
    for (const [id, p] of prev) {
      const a = w.antById.get(id);
      if (!a || a.state !== AS.Attack || (a.waitT ?? 0) <= 0) continue;
      S.waitMoveL += Math.hypot(a.x - p[0], a.y - p[1]) / casteOf(a.caste).length;
      S.waitTicks++;
    }
    const mine = w.s.ants.filter((a) => (a.team ?? a.colony) === team && a.state !== AS.Dead);
    // (foes that can be attacked: not queens or kings)
    const foes = w.s.ants.filter((a) => (a.team ?? a.colony) !== team && a.state !== AS.Dead && w.colony(a.colony)?.queen !== a.id && w.colony(a.colony)?.king !== a.id);
    const room = foes.some((o) => antSlotsTaken(w, o) < antSlotCount(o, 4, false));
    let wait = 0;
    let round = 0;
    let hold = 0;
    let close = 0;
    const per = new Map<number, number>();
    let far = 0;
    for (const a of mine) {
      if (a.state === AS.Grapple) hold++;
      if (a.state !== AS.Attack && a.state !== AS.Grapple && a.state !== AS.Spray) continue;
      S.fightS += 0.05;
      const tid = a.state === AS.Grapple ? a.gId : a.tgt;
      per.set(tid, (per.get(tid) ?? 0) + 1);
      if (a.state !== AS.Attack) continue;
      const idle = (a.waitT ?? 0) > 0 || (a.garT ?? 0) > 0;
      if ((a.waitT ?? 0) > 0) wait++;
      else if ((a.garT ?? 0) > 0) round++;
      else close++;
      if (idle && room) S.wastedS += 0.05;
      if ((a.waitT ?? 0) > 0 && a.tk === 3) {
        const o = w.antById.get(a.tgt);
        if (o) {
          const dl = Math.hypot(o.x - a.x, o.y - a.y) / casteOf(a.caste).length;
          far = Math.max(far, dl);
          S.waitDistL += dl;
          S.waitN++;
        }
      }
    }
    if (t % 20 === 19) S.rows.push([wait, round, hold, close, room ? wait + round : 0, Math.max(0, ...per.values()), far]);
  }
  return S;
}

{
  const { w, cmd } = arenaWorld(SEED);
  for (const [u, n] of MINE) spawn(cmd, 0, 'ant:' + u, Number(n));
  for (const [u, n] of THEIRS) spawn(cmd, 1, 'ant:' + u, Number(n));
  const S = orbit(w, SECS);
  console.log(' s  waiting  round  holding  closing  idle-with-room  most-on-one-foe  farthest-waiter(L)');
  S.rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}  ${r.slice(0, 6).map((v) => String(v).padStart(7)).join('  ')}  ${r[6].toFixed(1).padStart(8)}`));
  console.log(`idle (waiting or going round) while a foe had room: ${S.wastedS.toFixed(0)} of ${S.fightS.toFixed(0)} fighting ant-seconds (${((S.wastedS / Math.max(1e-9, S.fightS)) * 100).toFixed(0)} %)`);
  console.log(`waiting ants walk ${((S.waitMoveL / Math.max(1, S.waitTicks)) * 20 * 100).toFixed(0)} % of a body length a second; they stand on average ${(S.waitDistL / Math.max(1, S.waitN)).toFixed(1)} body lengths from their foe`);
}
