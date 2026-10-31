/** Library of tools/fight-motion.ts (the fight movement probe): the measurement and its scenes, also used by tests/meleeReach.ts. */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { ARENA } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout } from '../src/sim/arena';
import { Ant, AS, Creature, SURFACE } from '../src/sim/types';
import { casteOf } from '../src/sim/species';
import { applyCommand, Command, CommandBody, quantize } from '../src/sim/commands';
import { World } from '../src/sim/world';
import { CS, spawnCreature } from '../src/sim/creatures/creatureAI';
import { CREATURES } from '../src/sim/creatures/kinds';
import { makeAnt } from '../src/sim/factory';
import { openGround } from './spinScenes';
import { distToCreatureBody } from '../src/sim/slots';


const CSN = Object.fromEntries(Object.entries(CS).map(([k, v]) => [v, k])) as Record<number, string>;
const add = (r: Record<string, number>, k: string, v: number) => (r[k] = (r[k] ?? 0) + v);

/** What an ant is doing in the fight ('' = not fighting). */
function antDoing(a: Ant): string {
  if (a.state === AS.Dead) return '';
  if (a.state === AS.Grapple) return a.gKind === 4 ? 'holding a creature' : 'holding an ant';
  if (a.state === AS.Spray) return 'spraying';
  if (a.state !== AS.Attack) return '';
  if ((a.repT ?? 0) > 0) return 'backing off';
  if ((a.garT ?? 0) > 0) return 'going round';
  if ((a.waitT ?? 0) > 0) return 'waiting for a slot';
  return 'closing in';
}

export interface Motion {
  /** creature: engaged ticks, length-ticks, mm by system/state, walking ticks with holders */
  crTicks: number;
  crLen: number;
  crMove: Record<string, number>;
  crTurn: number;
  crWalkHeld: number;
  /** mm walked in the second before each bite, and the bites */
  biteWalk: number[];
  /** ants: fighting ant-ticks, length-ticks, mm by activity and system */
  antTicks: number;
  antLen: number;
  antMove: Record<string, number>;
  holdEnds: number;
  /** hold endings by the state the ant went to (and whether it recovers: an ended hold) */
  holdEndWhy: Record<string, number>;
  shoveCancels: number;
  /** kill mode */
  diedAt: number;
  antsKilled: number;
  /** creatures' health left at the end (share of their full health) */
  hpLeft: number;
}

export function measure(w: World, secs: number, stopWhenDead = false): Motion {
  const M: Motion = { crTicks: 0, crLen: 0, crMove: {}, crTurn: 0, crWalkHeld: 0, biteWalk: [], antTicks: 0, antLen: 0, antMove: {}, holdEnds: 0, holdEndWhy: {}, shoveCancels: 0, diedAt: -1, antsKilled: 0, hpLeft: 1 };
  const engagedC = new Map<number, string>(); // creature id → its state name at the tick start
  const doing = new Map<number, string>();
  const pos = new Map<number, [number, number, number]>();
  const cpos = new Map<number, [number, number, number]>();
  const held = new Map<number, number>(); // creature id → ants holding it at the tick start
  const recent = new Map<number, number[]>(); // creature id → mm walked each of the last 20 ticks
  const gripping = new Set<number>();
  w.systems = w.systems.map((s) => ({
    ...s,
    fn: (ww: World, dt: number) => {
      pos.clear();
      cpos.clear();
      gripping.clear();
      for (const a of w.s.ants) {
        if (doing.has(a.id)) pos.set(a.id, [a.x, a.y, a.h]);
        if (a.state === AS.Grapple && a.gKind === 4) gripping.add(a.id);
      }
      for (const c of w.s.creatures) cpos.set(c.id, [c.x, c.y, c.h]);
      s.fn(ww, dt);
      for (const a of w.s.ants) {
        const k = doing.get(a.id);
        const p = pos.get(a.id);
        if (!k || !p) continue;
        const m = Math.hypot(a.x - p[0], a.y - p[1]);
        if (m > 1e-9) add(M.antMove, `${k} (${s.name})`, m);
        if (s.name === 'separation' && gripping.has(a.id) && !(a.state === AS.Grapple && a.gKind === 4)) M.shoveCancels++;
      }
      for (const c of w.s.creatures) {
        const p = cpos.get(c.id);
        if (!p) continue;
        const m = Math.hypot(c.x - p[0], c.y - p[1]);
        const r = recent.get(c.id);
        if (r && s.name !== 'separation') r[r.length - 1] += m;
        const k = engagedC.get(c.id);
        if (!k) continue;
        if (m > 1e-9) add(M.crMove, `${k} (${s.name})`, m);
        M.crTurn += Math.abs(Math.atan2(Math.sin(c.h - p[2]), Math.cos(c.h - p[2])));
        if (s.name === 'creatures' && m > 0.02 * c.scale * 0.05 && (held.get(c.id) ?? 0) > 0) M.crWalkHeld++;
      }
    },
  }));
  const kinds = new Set(w.s.creatures.map((c) => c.kind));
  w.events.on('bite', (e) => {
    if (e.on !== 'ant' || !kinds.has(e.by as string)) return;
    let best: Creature | null = null;
    let bd = Infinity;
    for (const c of w.s.creatures) {
      const d = Math.hypot(c.x - e.x, c.y - e.y);
      if (c.kind === e.by && d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) M.biteWalk.push((recent.get(best.id) ?? []).reduce((s, v) => s + v, 0) / best.scale);
  });
  const prevState = new Map<number, [number, number]>();
  const alive = new Set<number>();
  const hp0 = w.s.creatures.reduce((t, c) => t + c.maxHp, 0);
  for (let t = 0; t < secs * 20; t++) {
    doing.clear();
    engagedC.clear();
    held.clear();
    for (const a of w.s.ants) {
      const k = antDoing(a);
      if (k) {
        doing.set(a.id, k);
        M.antTicks++;
        M.antLen += casteOf(a.caste).length;
      }
      if (a.state === AS.Grapple && a.gKind === 4) held.set(a.gId, (held.get(a.gId) ?? 0) + 1);
    }
    for (const c of w.s.creatures) {
      if (c.dead) continue;
      let r = recent.get(c.id);
      if (!r) recent.set(c.id, (r = []));
      r.push(0);
      if (r.length > 20) r.shift();
      let eng = (held.get(c.id) ?? 0) > 0;
      if (!eng)
        w.antsNear(c.space, c.x, c.y, c.scale * 1.5, (a) => {
          if (a.state === AS.Attack && a.tk === 4 && a.tgt === c.id && distToCreatureBody(c, a.x, a.y) < casteOf(a.caste).length * 2) eng = true;
          return eng;
        });
      if (eng) {
        engagedC.set(c.id, CSN[c.state] ?? String(c.state));
        M.crTicks++;
        M.crLen += c.scale;
      }
    }
    for (const a of w.s.ants) if (a.state !== AS.Dead) alive.add(a.id);
    w.step(0.05);
    w.events.drain();
    // holds that ended with the foe alive (a re-grip or a cancel)
    for (const a of w.s.ants) {
      const p = prevState.get(a.id);
      if (p && p[0] === AS.Grapple && a.state !== AS.Grapple && a.state !== AS.Dead && a.state !== AS.Flung) {
        const foeAlive = p[1] > 0 ? (w.antById.get(p[1])?.state ?? AS.Dead) !== AS.Dead : p[1] < 0 ? !(w.creatureById.get(-p[1])?.dead ?? true) : true;
        if (foeAlive) {
          M.holdEnds++;
          add(M.holdEndWhy, `${AS[a.state]}${(a.anc ?? 0) > 0 ? ' (recovering: the foe left reach)' : ''}${(a.stun ?? 0) > 0 ? ' (stunned)' : ''}`, 1);
        }
      }
      prevState.set(a.id, [a.state, a.state === AS.Grapple ? (a.gKind === 4 ? -a.gId : a.gId) : 0]);
    }
    for (const id of alive) {
      const a = w.antById.get(id);
      if (!a || a.state === AS.Dead) {
        M.antsKilled++;
        alive.delete(id);
      }
    }
    if (stopWhenDead && w.s.creatures.length && w.s.creatures.every((c) => c.dead)) {
      M.diedAt = (t + 1) / 20;
      break;
    }
  }
  M.hpLeft = hp0 > 0 ? w.s.creatures.reduce((t, c) => t + (c.dead ? 0 : Math.max(0, c.hp)), 0) / hp0 : 0;
  return M;
}

export function summary(M: Motion): { crBLs: number; crWalkHeldPerS: number; biteWalkMed: number; antBLs: number; holdEndsPerMin: number; cancelsPerMin: number } {
  const crMm = Object.values(M.crMove).reduce((s, v) => s + v, 0);
  const antMm = Object.values(M.antMove).reduce((s, v) => s + v, 0);
  const bw = [...M.biteWalk].sort((a, b) => a - b);
  return {
    crBLs: M.crLen ? (crMm / M.crLen) * 20 * 100 : 0,
    crWalkHeldPerS: M.crTicks ? M.crWalkHeld / (M.crTicks / 20) : 0,
    biteWalkMed: bw.length ? bw[Math.floor(bw.length / 2)] * 100 : 0,
    antBLs: M.antLen ? (antMm / M.antLen) * 20 * 100 : 0,
    holdEndsPerMin: M.antTicks ? M.holdEnds / (M.antTicks / 20 / 60) : 0,
    cancelsPerMin: M.antTicks ? M.shoveCancels / (M.antTicks / 20 / 60) : 0,
  };
}

export function report(name: string, M: Motion, kill = false): void {
  const S = summary(M);
  console.log(`\n== ${name}`);
  if (M.crTicks) {
    const top = Object.entries(M.crMove).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${((v / M.crLen) * 20 * 100).toFixed(1)}`).join(', ');
    const bw = [...M.biteWalk].sort((a, b) => a - b);
    const walked = bw.filter((v) => v > 0.05).length;
    console.log(`  creature engaged ${(M.crTicks / 20).toFixed(1)} s: walks ${S.crBLs.toFixed(1)} % BL/s (${top}); turns ${((M.crTurn / M.crTicks) * 20 * 57.3).toFixed(0)}°/s; walking with ants holding it ${S.crWalkHeldPerS.toFixed(1)} ticks/s`);
    console.log(`  bites on ants ${bw.length}: walked in the second before — median ${S.biteWalkMed.toFixed(0)} % BL, ${walked} of them > 5 % BL`);
  }
  if (M.antTicks) {
    const top = Object.entries(M.antMove).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k} ${((v / M.antLen) * 20 * 100).toFixed(1)}`).join(', ');
    console.log(`  ants fighting ${(M.antTicks / 20).toFixed(0)} ant-s: walk ${S.antBLs.toFixed(1)} % BL/s (${top})`);
    const why = Object.entries(M.holdEndWhy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  holds ended with the foe alive ${S.holdEndsPerMin.toFixed(1)} /ant-min (${why}); cancelled by a creature's shove ${S.cancelsPerMin.toFixed(2)} /ant-min`);
  }
  if (kill) console.log(`  creature ${M.diedAt >= 0 ? `died at ${M.diedAt.toFixed(1)} s` : `still alive, ${(M.hpLeft * 100).toFixed(0)} % health left`}; ants killed ${M.antsKilled}`);
}

// ---------------------------------------------------------------- scenes
export function arenaWorld(seed: number): { w: World; cmd: (b: CommandBody) => void } {
  const L = arenaLayout(ARENA.size, 2);
  const setup: GameSetup = {
    seed, style: 'formicarium', width: ARENA.size, depth: ARENA.size,
    colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })),
    caves: [], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 }, arena: true,
  };
  const w = createWorld(setup, new EventBus());
  let seq = 0;
  const cmd = (b: CommandBody) => applyCommand(w, { ...quantize(b), tick: w.s.tick, player: 0, seq: seq++ } as Command);
  return { w, cmd };
}
export function spawn(cmd: (b: CommandBody) => void, team: number, unit: string, n: number, at?: [number, number]): void {
  for (let k = 0; k < n; k += ARENA.maxPerSpawn) cmd({ type: 'arenaSpawn', team, unit, n: Math.min(ARENA.maxPerSpawn, n - k), level: 1, at: !!at, x: at ? at[0] : 0, y: at ? at[1] : 0 });
}

/** A creature of `kind` and `n` Black garden ants (a quarter soldiers) round it, all after it. */
export function creatureScene(kind: string, seed: number, n = 40, immortal = true): World {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w, Math.max(120, CREATURES[kind].length * 2));
  const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
  if (immortal) cr.hp = cr.maxHp = 1e7;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = cr.scale * 0.9 + 10 + (i % 3) * 5;
    const a = makeAnt(w, 0, i % 4 === 0 ? 'lasius_soldier' : 'lasius_worker', SURFACE, p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, ang + Math.PI);
    a.task = 'guard';
    a.alarm = 1;
    a.tgt = cr.id;
    a.tk = 4;
    a.state = AS.Attack;
    if (immortal) a.hp = a.maxHp = 1e6;
  }
  w.reindex();
  return w;
}

export const KINDS = ['groundBeetle', 'rove', 'lithobius', 'wolfSpider', 'mantis', 'stagBeetle', 'tarantula', 'scolopendra', 'giantMantis', 'hogna'];

