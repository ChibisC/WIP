/**
 * Combat v2.1 probe (CHANGE_PLAN §17, "find the causes first"): what moves or turns a unit while it attacks, and why
 * blocked ants shove instead of going round.
 *
 * Every sim system is wrapped (World.systems: colony, ants, creatures, separation, …). Before and after each one the
 * probe records every unit's position and heading, so each tick's movement of an attacking unit is attributed to the
 * system that made it. "Attacking":
 *  - ants: holding a foe (Grapple: on an ant, mutual or not, or planted at a creature), spraying (Spray), a shooter
 *    holding its range (Attack with v = 0 and the acid ready-or-reloading);
 *  - creatures: in an attack state (wind-up, strike, lunge, rear, whip, flick, coil, pounce, leap, display).
 * Movement by separation is further split by what was next to the ant (a fighting ally inside its personal space, an
 * ally closing in, an enemy, a creature body or foot).
 *
 * Shoving: an ant closing in (Attack, not yet holding) is "pressing" while a teammate stands in its forward cone
 * (±45°, within a personal space) and it got no nearer its target that tick. The probe reports how long such presses
 * last before the ant does something else (pauses, flanks, waits, latches), and, for the one-sided beetle scene, how
 * far round the beetle the attackers get.
 *
 *   npx vite-node tools/drift-probe.ts -- [scene=all] [secs=20] [seed=4] [trace=0]
 *   scenes: clash (60 Black garden workers v 60 fire-ant soldiers), formica (Formica workers, mortars and rapid
 *   sprayers v Black garden workers), beetle (30 workers on one ground beetle, all from one side), creatures (a
 *   tarantula, a stag beetle and a wolf spider fighting 40 ants each). trace=1 prints per-tick positions of a few
 *   attackers per phase.
 */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { ARENA, BALANCE } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout } from '../src/sim/arena';
import { Ant, AS, Creature, SURFACE } from '../src/sim/types';
import { casteOf } from '../src/sim/species';
import { applyCommand, Command, CommandBody, quantize } from '../src/sim/commands';
import { World } from '../src/sim/world';
import { CS, spawnCreature } from '../src/sim/creatures/creatureAI';
import { makeAnt } from '../src/sim/factory';
import { openGround } from './spinScenes';
import { bodyHook, distToCreatureBody } from '../src/sim/slots';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const SCENE = argv[0] ?? 'all';
const SECS = Number(argv[1] ?? 20);
const SEED = Number(argv[2] ?? 4);
const TRACE = argv[3] === '1';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const CSN = Object.fromEntries(Object.entries(CS).map(([k, v]) => [v, k])) as Record<number, string>;
const ATTACK_CS = new Set<number>([CS.WindUp, CS.Strike, CS.Pounce, CS.Coil, CS.Whip, CS.Rear, CS.Flick, CS.Leap, CS.Display, CS.Attack]);

/** What kind of attack an ant is in this tick ('' = not attacking). */
function antAttack(w: World, a: Ant): string {
  if (a.state === AS.Grapple) {
    if (a.gKind === 4) return 'hold creature';
    const o = w.antById.get(a.gId);
    const mutual = !!o && o.state === AS.Grapple && o.gKind === 3 && o.gId === a.id;
    return mutual ? 'hold ant (mutual)' : 'hold ant (one-way)';
  }
  if (a.state === AS.Spray) return 'spray';
  const cd = casteOf(a.caste);
  if (a.state === AS.Attack && a.v === 0 && (cd.acid?.kind === 'lob' || cd.acid?.kind === 'rapid')) return 'shooter in range';
  return '';
}

interface Acc {
  ticks: number;
  /** mm moved, by system */
  move: Record<string, number>;
  /** radians turned, by system */
  turn: Record<string, number>;
  /** body lengths (sum of the units' lengths over the ticks, for "% of body length per second") */
  len: number;
}
const newAcc = (): Acc => ({ ticks: 0, move: {}, turn: {}, len: 0 });
const add = (r: Record<string, number>, k: string, v: number) => (r[k] = (r[k] ?? 0) + v);

interface Probe {
  ants: Map<string, Acc>;
  creatures: Map<string, Acc>;
  sepWhy: Record<string, number>;
  /** pressing streaks (ticks) of ants closing in */
  press: number[];
  /** shoving: ticks an ant closing in has a teammate's body against its front (±45°), and all closing-in ticks */
  shove: number;
  closing: number;
  shoveStreaks: number[];
  trace: string[];
}

function instrument(w: World, P: Probe): () => void {
  // per tick: the attack kind of every unit at the tick start
  const kindA = new Map<number, string>();
  const kindC = new Map<number, string>();
  const pos = new Map<number, [number, number, number, number]>();
  const cpos = new Map<number, [number, number, number]>();
  const pressing = new Map<number, number>();
  const shoving = new Map<number, number>();
  const S = BALANCE.separation;
  const rOf = (L: number) => L * S.widthOfLength * S.radiusOfWidth;
  const lastD = new Map<number, number>();
  const snapshot = () => {
    pos.clear();
    for (const a of w.s.ants) if (kindA.has(a.id)) pos.set(a.id, [a.x, a.y, a.h, (a.stp ?? 0) > 0 ? 1 : 0]);
    cpos.clear();
    for (const c of w.s.creatures) if (kindC.has(c.id)) cpos.set(c.id, [c.x, c.y, c.h]);
  };
  const attribute = (sys0: string) => {
    let sys = sys0;
    for (const a of w.s.ants) {
      const k = kindA.get(a.id);
      const p = pos.get(a.id);
      if (!k || !p) continue;
      // (a unit that left its attack during this system is not attacking any more: its moves are not counted)
      if (antAttack(w, a) !== k) {
        kindA.delete(a.id);
        continue;
      }
      // a small planned step back to its hold point (combat v2.1) is counted on its own
      if (sys === 'ants' && (p[3] || (a.stp ?? 0) > 0)) sys = 'ants: planned step';
      const m = Math.hypot(a.x - p[0], a.y - p[1]);
      const t = Math.abs(wrap(a.h - p[2]));
      const acc = P.ants.get(k)!;
      if (m > 1e-9) add(acc.move, sys, m);
      if (t > 1e-9) add(acc.turn, sys, t);
      if (sys === 'separation' && m > 1e-6) add(P.sepWhy, sepCause(w, a), m);
      sys = sys0;
      if (TRACE && P.trace.length < 400 && m > 1e-6 && (a.id % 17 === 0)) P.trace.push(`t${w.s.tick} ant ${a.id} ${k.padEnd(18)} ${sys.padEnd(11)} moved ${m.toFixed(3)} mm (${p[0].toFixed(2)},${p[1].toFixed(2)}) → (${a.x.toFixed(2)},${a.y.toFixed(2)}), turned ${(t * 57.3).toFixed(1)}°`);
    }
    for (const c of w.s.creatures) {
      const k = kindC.get(c.id);
      const p = cpos.get(c.id);
      if (!k || !p) continue;
      const acc = P.creatures.get(k)!;
      const m = Math.hypot(c.x - p[0], c.y - p[1]);
      const t = Math.abs(wrap(c.h - p[2]));
      if (m > 1e-9) add(acc.move, sys, m);
      if (t > 1e-9) add(acc.turn, sys, t);
      if (TRACE && P.trace.length < 400 && (m > 1e-4 || t > 1e-4)) P.trace.push(`t${w.s.tick} creature ${c.kind} ${k.padEnd(18)} ${sys.padEnd(11)} moved ${m.toFixed(3)} mm, turned ${(t * 57.3).toFixed(1)}°`);
    }
  };
  w.systems = w.systems.map((s) => ({
    ...s,
    fn: (ww: World, dt: number) => {
      snapshot();
      s.fn(ww, dt);
      attribute(s.name);
    },
  }));
  // called before each step: who is attacking this tick, and the pressing bookkeeping
  return () => {
    kindA.clear();
    kindC.clear();
    for (const a of w.s.ants) {
      const k = antAttack(w, a);
      if (!k) continue;
      kindA.set(a.id, k);
      if (!P.ants.has(k)) P.ants.set(k, newAcc());
      const acc = P.ants.get(k)!;
      acc.ticks++;
      acc.len += casteOf(a.caste).length;
    }
    for (const c of w.s.creatures) {
      if (c.dead || !ATTACK_CS.has(c.state)) continue;
      const k = `${c.kind} ${CSN[c.state]}`;
      kindC.set(c.id, k);
      if (!P.creatures.has(k)) P.creatures.set(k, newAcc());
      const acc = P.creatures.get(k)!;
      acc.ticks++;
      acc.len += c.scale;
    }
    // pressing: closing in, a teammate in front within a personal space, no nearer than last tick
    for (const a of w.s.ants) {
      const L = casteOf(a.caste).length;
      let d = -1;
      if (a.state === AS.Attack && a.tk === 3) {
        const o = w.antById.get(a.tgt);
        if (o) d = Math.hypot(o.x - a.x, o.y - a.y);
      } else if (a.state === AS.Attack && a.tk === 4) {
        const c = w.creatureById.get(a.tgt);
        if (c) d = distToCreatureBody(c, a.x, a.y);
      }
      const prev = lastD.get(a.id);
      if (d >= 0) lastD.set(a.id, d);
      else lastD.delete(a.id);
      let blocked = false;
      if (d >= 0 && prev !== undefined && d > prev - L * 0.02 && (a.repT ?? 0) === 0 && (a.waitT ?? 0) === 0 && (a.garT ?? 0) === 0) {
        const team = a.team ?? a.colony;
        const ps = BALANCE.combat2.personalSpace * L;
        w.antsNear(a.space, a.x, a.y, ps, (o) => {
          if (o === a || (o.team ?? o.colony) !== team || o.state === AS.Dead) return false;
          const b = Math.atan2(o.y - a.y, o.x - a.x);
          if (Math.abs(wrap(b - a.h)) < Math.PI / 4) blocked = true;
          return blocked;
        });
      }
      // body contact with a teammate in front while closing in (separation then pushes the two apart: a shove)
      let contact = false;
      if (d >= 0 && (a.repT ?? 0) === 0 && (a.waitT ?? 0) === 0 && (a.garT ?? 0) === 0) {
        P.closing++;
        const team = a.team ?? a.colony;
        w.antsNear(a.space, a.x, a.y, L, (o) => {
          if (o === a || (o.team ?? o.colony) !== team || o.state === AS.Dead) return false;
          const dd = Math.hypot(o.x - a.x, o.y - a.y);
          if (dd > (rOf(L) + rOf(casteOf(o.caste).length)) * 1.05) return false;
          if (Math.abs(wrap(Math.atan2(o.y - a.y, o.x - a.x) - a.h)) < Math.PI / 4) contact = true;
          return contact;
        });
      }
      const sn = shoving.get(a.id) ?? 0;
      if (contact) {
        P.shove++;
        shoving.set(a.id, sn + 1);
      } else if (sn) {
        P.shoveStreaks.push(sn);
        shoving.delete(a.id);
      }
      const n = pressing.get(a.id) ?? 0;
      if (blocked) pressing.set(a.id, n + 1);
      else if (n) {
        P.press.push(n);
        pressing.delete(a.id);
      }
    }
  };
}

/** Why separation moved this ant (what is next to it). */
function sepCause(w: World, a: Ant): string {
  const L = casteOf(a.caste).length;
  const team = a.team ?? a.colony;
  const PS = BALANCE.combat2.personalSpace;
  let why = '';
  for (const c of w.s.creatures) {
    if (c.dead || c.space !== a.space) continue;
    const b = bodyHook.body(c);
    if (distToCreatureBody(c, a.x, a.y) < b.r * 0.2 + L * 0.3) return 'creature body or foot';
  }
  w.antsNear(a.space, a.x, a.y, PS * L * 1.2, (o) => {
    if (o === a || o.state === AS.Dead) return false;
    const d = Math.hypot(o.x - a.x, o.y - a.y);
    const Lo = casteOf(o.caste).length;
    const ally = (o.team ?? o.colony) === team;
    if (ally && (o.state === AS.Grapple || o.state === AS.Spray) && d < PS * Math.max(L, Lo)) why = why || 'fighting ally in personal space';
    else if (ally && o.state === AS.Attack && d < (L + Lo) * 0.3) why = 'ally closing in, bodies touching';
    else if (!ally && d < (L + Lo) * 0.25) why = why || 'enemy bodies touching';
    return false;
  });
  return why || 'other (spread over the tick)';
}

function arenaWorld(seed: number): { w: World; cmd: (b: CommandBody) => void } {
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
function spawn(cmd: (b: CommandBody) => void, team: number, unit: string, n: number): void {
  for (let k = 0; k < n; k += ARENA.maxPerSpawn) cmd({ type: 'arenaSpawn', team, unit, n: Math.min(ARENA.maxPerSpawn, n - k), level: 1, at: false, x: 0, y: 0 });
}

function run(name: string, w: World, secs: number, each?: (t: number) => void): Probe {
  const P: Probe = { ants: new Map(), creatures: new Map(), sepWhy: {}, press: [], trace: [], shove: 0, closing: 0, shoveStreaks: [] };
  const before = instrument(w, P);
  // creatures round their bites: where each one is every tick, and the ticks it bit an ant
  const track = new Map<number, Array<[number, number, number, number]>>();
  const bites: Array<[number, number]> = [];
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
    if (best) bites.push([best.id, w.s.tick]);
  });
  for (let t = 0; t < secs * 20; t++) {
    before();
    w.step(0.05);
    for (const c of w.s.creatures) {
      let a = track.get(c.id);
      if (!a) track.set(c.id, (a = []));
      a.push([w.s.tick, c.x, c.y, c.h]);
    }
    w.events.drain();
    each?.(t);
  }
  report(name, P);
  if (bites.length) {
    // movement and turning from 0.3 s before each bite to 0.2 s after (a creature that plants to bite: ~0)
    let mv = 0;
    let tn = 0;
    let n = 0;
    let len = 0;
    for (const [id, tick] of bites) {
      const tr = track.get(id)!;
      const i0 = tr.findIndex((r) => r[0] === tick - 6);
      const i1 = tr.findIndex((r) => r[0] === tick + 4);
      if (i0 < 0 || i1 < 0) continue;
      for (let i = i0 + 1; i <= i1; i++) {
        mv += Math.hypot(tr[i][1] - tr[i - 1][1], tr[i][2] - tr[i - 1][2]);
        tn += Math.abs(wrap(tr[i][3] - tr[i - 1][3]));
      }
      len += w.creatureById.get(id)?.scale ?? 1;
      n++;
    }
    if (n) console.log(`  creature bites on ants: ${n}; from 0.3 s before to 0.2 s after a bite the creature moves ${((mv / len / 0.5) * 100).toFixed(1)} % BL/s and turns ${((tn / n / 0.5) * 57.3).toFixed(0)}°/s`);
  }
  return P;
}

function fmt(acc: Acc): string {
  // % of the unit's body length per second, and degrees per second, by system
  const bl = (mm: number) => ((mm / acc.len) * 20 * 100).toFixed(1);
  const deg = (r: number) => ((r / acc.ticks) * 20 * 57.3).toFixed(0);
  const tm = Object.entries(acc.move).reduce((s, [k, v]) => s + (k.includes('planned') ? 0 : v), 0);
  const tt = Object.values(acc.turn).reduce((s, v) => s + v, 0);
  const parts = Object.entries(acc.move)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} ${bl(v)}`)
    .join(', ');
  const turns = Object.entries(acc.turn)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k} ${deg(v)}`)
    .join(', ');
  return `drifts ${bl(tm)} % BL/s (${parts || 'none'}); turns ${deg(tt)}°/s (${turns || 'none'})`;
}

function report(name: string, P: Probe): void {
  console.log(`\n== ${name}`);
  for (const [k, acc] of [...P.ants].sort((x, y) => y[1].ticks - x[1].ticks)) console.log(`  ant ${k.padEnd(19)} ${String(acc.ticks).padStart(6)} unit-ticks: ${fmt(acc)}`);
  for (const [k, acc] of [...P.creatures].sort((x, y) => y[1].ticks - x[1].ticks)) console.log(`  ${k.padEnd(23)} ${String(acc.ticks).padStart(6)} ticks: ${fmt(acc)}`);
  const sw = Object.values(P.sepWhy).reduce((s, v) => s + v, 0);
  if (sw > 0) console.log(`  separation moved attacking ants (share of the mm): ${Object.entries(P.sepWhy).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${((v / sw) * 100).toFixed(0)} %`).join(', ')}`);
  if (P.press.length) {
    const s = [...P.press].sort((a, b) => a - b);
    const q = (f: number) => (s[Math.min(s.length - 1, Math.floor(s.length * f))] / 20).toFixed(2);
    const long = s.filter((v) => v >= 8).length;
    console.log(`  pressing into a teammate while closing in: ${s.length} streaks, median ${q(0.5)} s, p90 ${q(0.9)} s, longest ${(s[s.length - 1] / 20).toFixed(2)} s; ${long} lasted ≥ 0.4 s (${(s.filter((v) => v >= 8).reduce((a, b) => a + b, 0) / 20).toFixed(1)} ant-seconds)`);
  }
  if (P.closing) {
    const s = [...P.shoveStreaks].sort((a, b) => a - b);
    const q = (f: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] / 20 : 0).toFixed(2);
    console.log(`  closing in with a teammate's body against its front: ${((P.shove / P.closing) * 100).toFixed(0)} % of ${P.closing} closing-in ticks; ${s.length} contacts, median ${q(0.5)} s, p90 ${q(0.9)} s, longest ${s.length ? (s[s.length - 1] / 20).toFixed(2) : 0} s`);
  }
  if (TRACE) for (const l of P.trace.slice(0, 120)) console.log('    ' + l);
}

// ---------------------------------------------------------------- scenes
function clash(): void {
  const { w, cmd } = arenaWorld(SEED);
  spawn(cmd, 0, 'ant:lasius_worker', 60);
  spawn(cmd, 1, 'ant:fire_soldier', 60);
  run('clash: 60 Black garden workers v 60 fire-ant soldiers (arena, charge)', w, SECS);
}
function formica(): void {
  const { w, cmd } = arenaWorld(SEED);
  spawn(cmd, 0, 'ant:formica_worker', 30);
  spawn(cmd, 0, 'ant:formica_mortar', 10);
  spawn(cmd, 0, 'ant:formica_rapid', 10);
  spawn(cmd, 1, 'ant:lasius_worker', 50);
  run('formica: 30 workers + 10 mortars + 10 rapid sprayers v 50 Black garden workers', w, SECS);
}
function beetle(): void {
  const w = createWorld({ seed: SEED, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w);
  const cr: Creature = spawnCreature(w, 'groundBeetle', SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e7;
  const ants: Ant[] = [];
  // all from the west, in a block
  for (let i = 0; i < 30; i++) {
    const a = makeAnt(w, 0, 'lasius_worker', SURFACE, p.x - 34 - (i % 5) * 4, p.y - 10 + Math.floor(i / 5) * 4, 0);
    a.task = 'guard';
    a.alarm = 1;
    a.tgt = cr.id;
    a.tk = 4;
    a.state = AS.Attack;
    ants.push(a);
  }
  w.reindex();
  const side = (t: number) => {
    if (t % 40 !== 39) return;
    const held = ants.filter((a) => a.state === AS.Grapple && a.gId === cr.id);
    const east = held.filter((a) => a.x > cr.x + 1).length;
    const north = held.filter((a) => a.y < cr.y - 1).length;
    const waiting = ants.filter((a) => a.state === AS.Attack).length;
    console.log(`  ${((t + 1) / 20).toFixed(0).padStart(2)} s: ${held.length} holding (${east} on the far, east side; ${north} north, ${held.length - north} south), ${waiting} closing in or waiting`);
  };
  run('beetle: 30 Black garden workers on one ground beetle (16 mm), all from the west; the beetle fights back', w, Math.min(SECS, 12), side);
}
function creatures(): void {
  for (const kind of ['tarantula', 'stagBeetle', 'wolfSpider']) {
    const w = createWorld({ seed: SEED, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
    w.s.creatures.length = 0;
    const p = openGround(w, 160);
    const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
    cr.hp = cr.maxHp = 1e7;
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2;
      const r = cr.scale * 0.9 + 10 + (i % 3) * 5;
      const a = makeAnt(w, 0, i % 4 === 0 ? 'lasius_soldier' : 'lasius_worker', SURFACE, p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, ang + Math.PI);
      a.task = 'guard';
      a.alarm = 1;
      a.tgt = cr.id;
      a.tk = 4;
      a.state = AS.Attack;
    }
    w.reindex();
    run(`creatures: a ${kind} (${cr.scale} mm) fighting 40 Black garden ants`, w, SECS);
    void bodyHook;
  }
}

const SCENES: Record<string, () => void> = { clash, formica, beetle, creatures };
for (const [k, f] of Object.entries(SCENES)) if (SCENE === 'all' || SCENE === k) f();
