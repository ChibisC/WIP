/**
 * Scenes for the under-pass checks (combat v2.2, CHANGE_PLAN §20): tests/underpass.ts and tools/underpass-probe.ts.
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { Ant, AS, SURFACE } from '../src/sim/types';
import { World } from '../src/sim/world';
import { makeAnt } from '../src/sim/factory';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { steerAvoid } from '../src/sim/movement';
import { separationSystem } from '../src/sim/separation';
import { casteOf } from '../src/sim/species';
import { antHeights, feetN, footAt, footR } from '../src/sim/underpass';
import { openGround } from './spinScenes';

/**
 * A row of `n` tall ants (`tall` caste) standing side by side across the way, each facing along the row, and one small
 * ant (`small`) walking to a point beyond them the way ants walk (`steerAvoid`: steering round teammates in its way),
 * with separation every tick — only those two systems, so the path is theirs. Returns the path length over the
 * straight distance, the time taken, whether it got there, ticks spent under a tall one, the most it strayed from the
 * straight line (mm), the deepest a foot circle reached into it (mm, > 0 = overlap), and the most a tall one was shoved
 * (mm).
 */
export function walkThrough(species: string, tall: string, small: string, seed = 5, n = 5): { ratio: number; secs: number; footIn: number; arrived: boolean; under: number; dev: number; shove: number } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 0, colonies: [{ species: species as never, player: true, ai: false, startWorkers: 0 }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  w.s.food.length = 0;
  const p = openGround(w, 140);
  const Lt = casteOf(tall).length;
  // a column head to tail across the way (a trail of them); the small one's way runs through the middle one's middle
  const row: Ant[] = [];
  for (let i = 0; i < n; i++) row.push(makeAnt(w, 0, tall, SURFACE, p.x, p.y + (i - (n - 1) / 2) * Lt * 1.05, Math.PI / 2));
  const s = makeAnt(w, 0, small, SURFACE, p.x - 30, p.y, 0);
  for (const a of [...row, s]) a.state = AS.Idle;
  const start = row.map((a) => [a.x, a.y]);
  const tx = p.x + 30;
  const ty = p.y;
  let path = 0;
  let footIn = -Infinity;
  let under = 0;
  let dev = 0;
  let px = s.x;
  let py = s.y;
  let t = 0;
  let arrived = false;
  const F = { x: 0, y: 0 };
  const rs = casteOf(small).length * 0.28 * 0.8 * 0.5;
  for (; t < 20 * 15 && !arrived; t++) {
    w.touch();
    w.prepareQueries();
    steerAvoid(w, s, tx, ty, 0.05);
    // (separation runs every other tick, as in the game)
    if (t % 2 === 1) {
      w.touch();
      w.prepareQueries();
      separationSystem(w, 0.1);
    }
    path += Math.hypot(s.x - px, s.y - py);
    px = s.x;
    py = s.y;
    if ((s.udr ?? 0) > 0) under++;
    dev = Math.max(dev, Math.abs(s.y - ty));
    for (const a of row) {
      const d = antHeights(a.caste);
      for (let k = 0; k < feetN(d); k++) {
        footAt(d, Lt, a.x, a.y, a.h, k, F);
        footIn = Math.max(footIn, footR(Lt) + rs - Math.hypot(s.x - F.x, s.y - F.y));
      }
    }
    arrived = Math.hypot(s.x - tx, s.y - ty) < 1;
  }
  const shove = row.reduce((m, a, i) => Math.max(m, Math.hypot(a.x - start[i][0], a.y - start[i][1])), 0);
  return { ratio: path / 60, secs: t / 20, footIn, arrived, under, dev, shove };
}

export function worldOf(w: World): World {
  return w;
}

/**
 * A mixed group (`squad`: [caste, count] pairs, colony species `species`) round one creature of `kind`, all after it.
 * Returns, per second, how many hold on to it (from beneath a teammate or not), the most at once, how many of the
 * small ones stood under a tall teammate at any moment, and when it died (real health; −1 alive after `secs`).
 */
export function mixedVsCreature(species: string, squad: Array<[string, number]>, kind: string, seed = 4, secs = 40): { mean: number; most: number; underTall: number; diedAt: number; lost: number } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: species as never, player: true, ai: false, startWorkers: 0 }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w, 160);
  const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
  const ants: Ant[] = [];
  let i = 0;
  const total = squad.reduce((t, [, n]) => t + n, 0);
  for (const [caste, n] of squad)
    for (let k = 0; k < n; k++, i++) {
      const ang = (i / total) * Math.PI * 2;
      const r = cr.scale * 0.9 + 12 + (i % 3) * 4;
      const a = makeAnt(w, 0, caste, SURFACE, p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, ang + Math.PI);
      a.task = 'guard';
      a.alarm = 1;
      a.tgt = cr.id;
      a.tk = 4;
      a.state = AS.Attack;
      ants.push(a);
    }
  w.reindex();
  let sum = 0;
  let samples = 0;
  let most = 0;
  let underTall = 0;
  let diedAt = -1;
  for (let t = 0; t < secs * 20; t++) {
    w.step(0.05);
    w.events.drain();
    const held = ants.filter((a) => a.state === AS.Grapple && a.gKind === 4 && a.gId === cr.id).length;
    sum += held;
    samples++;
    most = Math.max(most, held);
    underTall = Math.max(underTall, ants.filter((a) => a.state !== AS.Dead && (a.udr ?? 0) > 0).length);
    if (cr.dead) {
      diedAt = (t + 1) / 20;
      break;
    }
  }
  return { mean: sum / Math.max(1, samples), most, underTall, diedAt, lost: ants.filter((a) => a.state === AS.Dead).length };
}
