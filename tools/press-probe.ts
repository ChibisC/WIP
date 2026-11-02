/**
 * Pressing in and taking turns (user 2026-11-01, evening): a swarm larger than a foe's slots — how many hold, how many
 * press in, how far back, how still, and how often the fighters take turns.
 *
 * (tests/notes1101.ts; from the command line: npx vite-node tools/press-run.ts -- [victimCaste] [attackerCaste] [n] [sec] [seed])
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { Ant, AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { casteOf } from '../src/sim/species';
import { antSlotCount, frontOff } from '../src/sim/slots';
import { BALANCE } from '../src/sim/balance';
import { openGround } from './spinScenes';
import { ARENA } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout } from '../src/sim/arena';
import { Command, CommandBody, applyCommand, quantize } from '../src/sim/commands';

export interface PressStats {
  slots: number;
  holdMean: number;
  pressMean: number;
  turns: number;
  stillShare: number;
  backL: number;
  farShare: number;
  under: number;
  minHold: number;
}

export function pressScene(vc = 'lasius_worker', ac = 'fire_minor', n = 14, sec = 20, seed = 11): PressStats {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'solenopsis', player: false, ai: false }], settings: { creatures: 0 } } as never, new EventBus());
  w.s.creatures.length = 0;
  w.s.food.length = 0;
  w.reindex();
  const p = openGround(w);
  const v = makeAnt(w, 0, vc, SURFACE, p.x, p.y, 0);
  v.hp = v.maxHp = 1e6;
  v.task = 'guard';
  const att: Ant[] = [];
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, 1, ac, SURFACE, p.x - 22 + (i % 4) * 2.2, p.y - 6 + Math.floor(i / 4) * 3, 0);
    a.task = 'guard';
    a.alarm = 1;
    a.cd2 = 1e6;
    a.state = AS.Attack;
    a.tgt = v.id;
    a.tk = 3;
    att.push(a);
  }
  w.reindex();
  const L = casteOf(ac).length;
  const reach = casteOf(vc).length * BALANCE.combat2.antHalfLen + frontOff(L);
  const slots = antSlotCount(v, L, false);
  let hold = 0;
  let press = 0;
  let still = 0;
  let far = 0;
  let back = 0;
  let samples = 0;
  let under = 0;
  let turns = 0;
  let minHold = 99;
  const wasRot = new Map<number, number>();
  const stillFor = new Map<number, number>();
  for (let t = 0; t < sec * 20; t++) {
    v.stun = 1;
    v.cd = 99;
    w.step(0.05);
    w.events.drain();
    for (const a of att) {
      if ((wasRot.get(a.id) ?? 0) === 0 && (a.rotT ?? 0) > 0) turns++;
      wasRot.set(a.id, a.rotT ?? 0);
    }
    if (t < 20 * 4) continue;
    samples++;
    const h = att.filter((a) => a.state === AS.Grapple && a.gId === v.id && (a.gUn ?? 0) === 0).length;
    under += att.filter((a) => a.state === AS.Grapple && a.gId === v.id && (a.gUn ?? 0) > 0).length;
    hold += h;
    minHold = Math.min(minHold, h);
    for (const a of att) {
      if (a.state !== AS.Attack || (a.waitT ?? 0) <= 0) continue;
      press++;
      const d = Math.hypot(a.x - v.x, a.y - v.y) - reach;
      back += d / L;
      if (d > L * 2.5) far++;
      // standing still: hardly moved this tick and not walking
      const s = a.v <= 1e-6 ? (stillFor.get(a.id) ?? 0) + 1 : 0;
      stillFor.set(a.id, s);
      if (s > 10) still++;
    }
  }
  return { slots, holdMean: hold / samples, pressMean: press / samples, turns, stillShare: still / Math.max(1, press), backL: back / Math.max(1, press), farShare: far / Math.max(1, press), under: under / samples, minHold };
}

/**
 * Sharing the swarm out (user 2026-11-01, 21:06: "now too much are surrounding a single ant … selectively swarm enemies
 * depending on how many are already currently swarming the enemy"): the arena, `n` fire minors charging three Lasius
 * workers that stand their ground. Per victim, averaged from `from` s to the end: ants holding it, and all on it
 * (holding, pressing in, closing in).
 */
export function shareScene(n = 30, sec = 14, from = 8, seed = 4): { hold: number[]; on: number[]; emptyAfter4: number } {
  const L = arenaLayout(ARENA.size, 2);
  const setup = { seed, style: 'formicarium', width: ARENA.size, depth: ARENA.size, colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })), caves: [], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 }, arena: true };
  const w = createWorld(setup as never, new EventBus());
  let seq = 0;
  const cmd = (b: CommandBody) => applyCommand(w, { ...quantize(b), tick: w.s.tick, player: 0, seq: seq++ } as Command);
  cmd({ type: 'arenaStance', team: 1, stance: 2 } as CommandBody);
  cmd({ type: 'arenaSpawn', team: 1, unit: 'ant:lasius_worker', n: 3, level: 1, at: true, x: 300, y: 300 } as CommandBody);
  cmd({ type: 'arenaSpawn', team: 0, unit: 'ant:fire_minor', n, level: 1, at: true, x: 260, y: 300 } as CommandBody);
  w.step(0.05);
  w.events.drain();
  const vs = w.s.ants.filter((a) => a.caste === 'lasius_worker');
  for (const v of vs) v.hp = v.maxHp = 1e6;
  const hold = vs.map(() => 0);
  const on = vs.map(() => 0);
  let samples = 0;
  let emptyAfter4 = 0;
  for (let t = 0; t < sec * 20; t++) {
    w.step(0.05);
    w.events.drain();
    if (t < 4 * 20) continue;
    const fm = w.s.ants.filter((a) => a.caste === 'fire_minor' && a.state !== AS.Dead);
    vs.forEach((v, i) => {
      const h = fm.filter((a) => a.state === AS.Grapple && a.gId === v.id).length;
      const o = fm.filter((a) => (a.state === AS.Grapple && a.gId === v.id) || (a.state === AS.Attack && a.tgt === v.id)).length;
      if (h === 0) emptyAfter4++;
      if (t >= from * 20) {
        hold[i] += h;
        on[i] += o;
      }
    });
    if (t >= from * 20) samples++;
  }
  return { hold: hold.map((x) => x / samples), on: on.map((x) => x / samples), emptyAfter4: emptyAfter4 / 20 };
}
