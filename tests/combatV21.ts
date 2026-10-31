/**
 * Tests for combat v2.1 (CHANGE_PLAN §17, project doc claude/combat/03-spec-anchor-and-flow-around.md): anchored attacks
 * (no drift, facing locked from the strike to the end of the recovery, creatures still in their attacks, splash areas
 * fixed at the wind-up) and "back off and go around" instead of shoving (spreading round a creature charged from one
 * side, no ant pushing an anchored teammate, blocked ants backing off at once, small duels, tunnels flowing). Part of
 * `npm test`.
 *
 *   npx vite-node tests/combatV21.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Ant, AS, Creature, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { CS, spawnCreature } from '../src/sim/creatures/creatureAI';
import { ARENA, BALANCE } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout } from '../src/sim/arena';
import { casteOf } from '../src/sim/species';
import { applyCommand, Command, CommandBody, quantize } from '../src/sim/commands';
import { anchored } from '../src/sim/slots';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { openGround, tunnelFlow } from '../tools/spinScenes';
import { duelBattle, duelSample } from '../tools/duelScenes';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const t0 = Date.now();
const C21 = BALANCE.combat21;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function field(seed = 7, species: [string, string] = ['lasius', 'solenopsis']): { w: World; p: { x: number; y: number } } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 0, colonies: [{ species: species[0] as never, player: true, ai: false }, { species: species[1] as never, player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  w.s.food.length = 0;
  w.reindex();
  return { w, p: openGround(w, 160) };
}
function fighter(w: World, col: number, caste: string, x: number, y: number, h = 0): Ant {
  const a = makeAnt(w, col, caste, SURFACE, x, y, h);
  a.task = 'guard';
  a.alarm = 1;
  return a;
}
function arena(seed = 4): { w: World; spawn: (team: number, unit: string, n: number, at?: [number, number]) => void } {
  const L = arenaLayout(ARENA.size, 2);
  const setup: GameSetup = {
    seed, style: 'formicarium', width: ARENA.size, depth: ARENA.size,
    colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })),
    caves: [], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 }, arena: true,
  };
  const w = createWorld(setup, new EventBus());
  let seq = 0;
  const cmd = (b: CommandBody) => applyCommand(w, { ...quantize(b), tick: w.s.tick, player: 0, seq: seq++ } as Command);
  const spawn = (team: number, unit: string, n: number, at?: [number, number]) => {
    for (let k = 0; k < n; k += ARENA.maxPerSpawn) cmd({ type: 'arenaSpawn', team, unit, n: Math.min(ARENA.maxPerSpawn, n - k), level: 1, at: !!at, x: at?.[0] ?? 0, y: at?.[1] ?? 0 });
  };
  return { w, spawn };
}

// ---------------------------------------------------------------- the drift meter
/** What an ant is doing this tick, as an attack ('' = not attacking). */
function antAttack(w: World, a: Ant): string {
  const cd = casteOf(a.caste);
  if (a.state === AS.Grapple) {
    if (a.gKind === 4) return 'planted at a creature';
    const o = w.antById.get(a.gId);
    const mutual = !!o && o.state === AS.Grapple && o.gKind === 3 && o.gId === a.id;
    return (cd.sting ? 'stinging hold' : 'biting hold') + (mutual ? ' (mutual)' : ' (one-way)');
  }
  if (a.state === AS.Spray) return cd.acid?.kind === 'lob' ? 'mortar shot' : cd.acid?.kind === 'rapid' ? 'rapid spray' : 'acid spray';
  if (a.state === AS.Attack && (cd.acid?.kind === 'lob' || cd.acid?.kind === 'rapid') && anchored(a)) return 'shooter holding range';
  return '';
}
/** Creature attack states and planned moves (lunges, pounces, leaps, a catch dragged off): those move on purpose. */
const CR_ATTACK = new Set<number>([CS.WindUp, CS.Attack, CS.Strike, CS.Coil, CS.Whip, CS.Rear, CS.Flick, CS.Display]);
const CR_PLANNED = new Set<number>([CS.Pounce, CS.Leap, CS.Eat]);

interface Meter {
  /** per kind: mm drifted, body-length-ticks, unit-ticks */
  drift: Map<string, { mm: number; len: number; n: number }>;
  /** ticks a holder or sprayer turned outside its wind-up; creature ticks turned in a strike or recovery */
  turnLocked: Map<string, number>;
  /** fastest creature turn in a wind-up (rad/s) */
  windupTurn: number;
  /** mm an anchored ant was moved by the separation (no ant pushes an anchored teammate) */
  sepAnchored: number;
}
const CSN = Object.fromEntries(Object.entries(CS).map(([k, v]) => [v, k])) as Record<number, string>;

/** Wrap every sim system so each tick's movement of an attacking unit is measured (planned steps and lunges apart). */
function meter(w: World): { M: Meter; tick: () => void } {
  const M: Meter = { drift: new Map(), turnLocked: new Map(), windupTurn: 0, sepAnchored: 0 };
  const kindA = new Map<number, string>();
  const kindC = new Map<number, string>();
  const pos = new Map<number, [number, number, number, boolean, number]>();
  const cpos = new Map<number, [number, number, number]>();
  const add = (k: string, mm: number, len: number) => {
    let e = M.drift.get(k);
    if (!e) M.drift.set(k, (e = { mm: 0, len: 0, n: 0 }));
    e.mm += mm;
  };
  w.systems = w.systems.map((s) => ({
    ...s,
    fn: (ww: World, dt: number) => {
      pos.clear();
      for (const a of w.s.ants) if (kindA.has(a.id) || anchored(a)) pos.set(a.id, [a.x, a.y, a.h, (a.stp ?? 0) > 0, a.cd]);
      cpos.clear();
      for (const c of w.s.creatures) if (kindC.has(c.id)) cpos.set(c.id, [c.x, c.y, c.h]);
      const anch = new Set(w.s.ants.filter((a) => anchored(a)).map((a) => a.id));
      s.fn(ww, dt);
      for (const a of w.s.ants) {
        const p = pos.get(a.id);
        if (!p) continue;
        const mm = Math.hypot(a.x - p[0], a.y - p[1]);
        // no ant pushes an anchored teammate (separation; a creature walking into it cancels its attack instead)
        if (s.name === 'separation' && anch.has(a.id) && anchored(a) && mm > 0) M.sepAnchored += mm;
        const k = kindA.get(a.id);
        if (!k || antAttack(w, a) !== k || p[3] || (a.stp ?? 0) > 0) continue;
        add(k, mm, 0);
        // facing: a holder turns only in a bite's wind-up; a sprayer only before its jet
        const turned = Math.abs(wrap(a.h - p[2])) > 1e-9;
        if (turned && s.name === 'ants') {
          const windup = a.state === AS.Spray ? a.st <= (casteOf(a.caste).acid?.kind === 'rapid' ? 0.05 : casteOf(a.caste).acid?.kind === 'lob' ? 0.5 : 0.45) + 0.06 : p[4] <= C21.windupSec + dt + 1e-9; // (the bite timer runs down within this tick)
          if (!windup && !k.startsWith('shooter')) M.turnLocked.set(k, (M.turnLocked.get(k) ?? 0) + 1);
        }
      }
      for (const c of w.s.creatures) {
        const k = kindC.get(c.id);
        const p = cpos.get(c.id);
        if (!k || !p || `${c.kind} ${CSN[c.state]}` !== k) continue;
        add(k, Math.hypot(c.x - p[0], c.y - p[1]), 0);
        const t = Math.abs(wrap(c.h - p[2]));
        if (c.state === CS.WindUp || c.state === CS.Coil) M.windupTurn = Math.max(M.windupTurn, t / dt);
        else if ((c.state === CS.Attack || c.state === CS.Strike || CR_PLANNED.has(c.state)) && t > 1e-9 && c.state !== CS.Eat) M.turnLocked.set(k, (M.turnLocked.get(k) ?? 0) + 1);
      }
    },
  }));
  const tick = () => {
    kindA.clear();
    kindC.clear();
    for (const a of w.s.ants) {
      const k = antAttack(w, a);
      if (!k) continue;
      kindA.set(a.id, k);
      let e = M.drift.get(k);
      if (!e) M.drift.set(k, (e = { mm: 0, len: 0, n: 0 }));
      e.len += casteOf(a.caste).length;
      e.n++;
    }
    for (const c of w.s.creatures) {
      if (c.dead || !CR_ATTACK.has(c.state)) continue;
      const k = `${c.kind} ${CSN[c.state]}`;
      kindC.set(c.id, k);
      let e = M.drift.get(k);
      if (!e) M.drift.set(k, (e = { mm: 0, len: 0, n: 0 }));
      e.len += c.scale;
      e.n++;
    }
  };
  return { M, tick };
}
function runMeter(w: World, secs: number, each?: () => void): Meter {
  const { M, tick } = meter(w);
  for (let t = 0; t < secs * 20; t++) {
    each?.();
    tick();
    w.step(0.05);
    w.events.drain();
  }
  return M;
}
/** % of its body length a second, per attacking unit. */
const pct = (e: { mm: number; len: number }) => (e.len > 0 ? (e.mm / e.len) * 20 * 100 : 0);

// ---------------------------------------------------------------- 1. anchored attacks: < 2 % BL/s, facing locked
{
  const all = new Map<string, { mm: number; len: number; n: number }>();
  const locked = new Map<string, number>();
  let windup = 0;
  let sepAnchored = 0;
  const merge = (M: Meter) => {
    for (const [k, e] of M.drift) {
      const a = all.get(k) ?? { mm: 0, len: 0, n: 0 };
      a.mm += e.mm;
      a.len += e.len;
      a.n += e.n;
      all.set(k, a);
    }
    for (const [k, v] of M.turnLocked) locked.set(k, (locked.get(k) ?? 0) + v);
    windup = Math.max(windup, M.windupTurn);
    sepAnchored += M.sepAnchored;
  };
  // bites and stings, one-way and mutual holds, Black garden ants' acid
  {
    const { w, spawn } = arena(4);
    spawn(0, 'ant:lasius_worker', 60);
    spawn(1, 'ant:fire_soldier', 60);
    merge(runMeter(w, 15));
  }
  // Formica workers' sprays, mortars, rapid sprayers (and shooters holding their range)
  {
    const { w, spawn } = arena(5);
    spawn(0, 'ant:formica_worker', 30);
    spawn(0, 'ant:formica_mortar', 10);
    spawn(0, 'ant:formica_rapid', 10);
    spawn(1, 'ant:lasius_worker', 50);
    merge(runMeter(w, 15));
  }
  // creatures: hunters' bites, the stag beetle's pinch and clamp, the tarantula's lunge, the wolf spider's pounce
  for (const [kind, hpFrac] of [['groundBeetle', 1], ['stagBeetle', 0.6], ['tarantula', 0.9], ['wolfSpider', 1], ['scolopendra', 0.6]] as Array<[string, number]>) {
    const { w, p } = field(9);
    const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
    cr.hp = cr.maxHp * hpFrac;
    cr.maxHp *= 1;
    const keep = cr.hp;
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2;
      const r = cr.scale * 0.9 + 10 + (i % 3) * 5;
      const a = fighter(w, 0, i % 4 === 0 ? 'lasius_soldier' : 'lasius_worker', p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, ang + Math.PI);
      a.tgt = cr.id;
      a.tk = 4;
      a.state = AS.Attack;
    }
    w.reindex();
    merge(runMeter(w, 12, () => (cr.hp = keep)));
  }
  const kinds = [...all.entries()].filter(([, e]) => e.n >= 20).sort((a, b) => b[1].n - a[1].n);
  const worst = kinds.reduce((m, [, e]) => Math.max(m, pct(e)), 0);
  check('anchoring: every attack (holds, stings, sprays, mortars, creature bites, grabs and splash wind-ups) moves under 2 % of a body length a second', worst < 2, kinds.map(([k, e]) => `${k} ${pct(e).toFixed(2)}`).join(', '));
  const antKinds = ['biting hold (one-way)', 'biting hold (mutual)', 'stinging hold (one-way)', 'stinging hold (mutual)', 'acid spray', 'mortar shot', 'rapid spray', 'planted at a creature'];
  check('anchoring: all the ant attacks were seen', antKinds.every((k) => (all.get(k)?.n ?? 0) > 0), antKinds.filter((k) => !all.get(k)).join(', ') || 'all');
  const lockedTotal = [...locked.values()].reduce((a, b) => a + b, 0);
  check('facing: no turning from the strike to the end of the recovery (holds, sprays, creature bites and lunges)', lockedTotal === 0, [...locked.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || 'none');
  check('facing: creatures turn at most crWindupTurn in a wind-up', windup <= C21.crWindupTurn * 1.6 + 1e-6, `${windup.toFixed(2)} rad/s`);
  check('right of way: no ant pushes an anchored teammate (separation moves no anchored ant)', sepAnchored < 1e-6, `${sepAnchored.toFixed(4)} mm`);
}

// ---------------------------------------------------------------- 2. creatures: splash areas fixed at the wind-up
{
  // the stag beetle's clamp and the tarantula's lunge strike where they were telegraphed
  let worst = 0;
  let seen = 0;
  for (const [kind, hpFrac] of [['stagBeetle', 0.6], ['tarantula', 0.9]] as Array<[string, number]>) {
    const { w, p } = field(10);
    const cr: Creature = spawnCreature(w, kind, SURFACE, p.x, p.y);
    cr.hp = cr.maxHp * hpFrac;
    const keep = cr.hp;
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2;
      const a = fighter(w, 0, 'lasius_worker', p.x + Math.cos(ang) * (cr.scale * 0.8 + 8), p.y + Math.sin(ang) * (cr.scale * 0.8 + 8), ang + Math.PI);
      a.tgt = cr.id;
      a.tk = 4;
      a.state = AS.Attack;
    }
    w.reindex();
    let aim: number | null = null;
    w.events.on('telegraph', (e) => {
      if (e.creature === cr.id && aim === null) aim = Math.atan2(e.y - cr.y, e.x - cr.x);
    });
    let prev = cr.state;
    for (let t = 0; t < 20 * 20; t++) {
      cr.hp = keep;
      w.step(0.05);
      w.events.drain();
      // the wind-up ends: the strike goes where it was aimed when the wind-up began
      if (prev === CS.WindUp && cr.state !== CS.WindUp && aim !== null && (cr.data.bw ?? 0) === 0) {
        worst = Math.max(worst, Math.abs(wrap(cr.h - aim)));
        seen++;
      }
      if (cr.state !== CS.WindUp) aim = null;
      prev = cr.state;
    }
  }
  check('splash: the clamp and the lunge strike where they were aimed at the wind-up, not after the swarm', seen >= 2 && worst <= 0.35, `${seen} strikes, worst ${(worst * 57.3).toFixed(0)}° off the telegraph`);
}

// ---------------------------------------------------------------- 3. no shoving: 30 ants charge one beetle from one side
{
  const { w, p } = field(4);
  const cr = spawnCreature(w, 'groundBeetle', SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e7;
  const ants: Ant[] = [];
  for (let i = 0; i < 30; i++) {
    const a = fighter(w, 0, 'lasius_worker', p.x - 34 - (i % 5) * 4, p.y - 10 + Math.floor(i / 5) * 4, 0);
    a.hp = a.maxHp = 1e5;
    a.tgt = cr.id;
    a.tk = 4;
    a.state = AS.Attack;
    ants.push(a);
  }
  w.reindex();
  let sides5 = { n: 0, s: 0 };
  let far10 = 0;
  let closing = 0;
  let contact = 0;
  let longest = 0;
  const streak = new Map<number, number>();
  const S = BALANCE.separation;
  const rOf = (L: number) => L * S.widthOfLength * S.radiusOfWidth;
  const M = runMeter(w, 10, () => {
    // (a passive beetle: it stands and does not bite or shake ants off)
    cr.cd = 99;
    cr.cd2 = 99;
    const t = w.s.tick;
    const held = ants.filter((a) => a.state === AS.Grapple && a.gId === cr.id);
    if (t === 100) sides5 = { n: held.filter((a) => a.y < cr.y - 1).length, s: held.filter((a) => a.y > cr.y + 1).length };
    if (t === 199) far10 = held.filter((a) => a.x > cr.x + 1).length;
    // an ant closing in (not backing off or going round) with a teammate's body against its front
    for (const a of ants) {
      if (a.state !== AS.Attack || (a.repT ?? 0) !== 0 || (a.garT ?? 0) > 0 || (a.waitT ?? 0) > 0) {
        streak.delete(a.id);
        continue;
      }
      closing++;
      let hit = false;
      w.antsNear(a.space, a.x, a.y, 4, (g) => {
        if (g === a || g.colony !== a.colony || g.state === AS.Dead) return false;
        if (Math.hypot(g.x - a.x, g.y - a.y) > (rOf(4) + rOf(casteOf(g.caste).length)) * 1.05) return false;
        if (Math.abs(wrap(Math.atan2(g.y - a.y, g.x - a.x) - a.h)) < Math.PI / 4) hit = true;
        return hit;
      });
      if (hit) {
        contact++;
        streak.set(a.id, (streak.get(a.id) ?? 0) + 1);
        longest = Math.max(longest, streak.get(a.id)!);
      } else streak.delete(a.id);
    }
  });
  check('no shoving: a swarm charging a beetle from one side splits round both sides within a few seconds', sides5.n >= 3 && sides5.s >= 3, `after 5 s: ${sides5.n} holding on the north side, ${sides5.s} on the south (base: 2 and 1)`);
  check('no shoving: … and wraps round to the far side', far10 >= 3, `after 10 s: ${far10} holding on the far (east) side`);
  // (ants still bump into a teammate as they arrive — about 8 % of closing-in ticks, as before v2.1 — but they back off
  // instead of pressing on: on the base the longest press here was 0.65 s)
  check('no shoving: an ant that runs into a teammate in front backs off — no press lasts more than about 0.5 s', longest <= 10 && contact / Math.max(1, closing) < 0.12, `${((contact / Math.max(1, closing)) * 100).toFixed(1)} % of closing-in ticks with a teammate against its front, the longest ${(longest / 20).toFixed(2)} s (base: 8.2 %, 0.65 s)`);
  check('no shoving: no ant pushes an anchored teammate here either', M.sepAnchored < 1e-6, `${M.sepAnchored.toFixed(4)} mm`);
}

// ---------------------------------------------------------------- 4. blocked: back off and go round within ~0.5 s
{
  const { w, p } = field(12);
  // a foe held from the west by one ant; another closes in from straight behind that holder
  const v = fighter(w, 1, 'fire_soldier', p.x, p.y, Math.PI);
  v.hp = v.maxHp = 1e6;
  const L = casteOf('lasius_worker').length;
  const h = fighter(w, 0, 'lasius_worker', p.x - 4.2, p.y, 0);
  h.hp = h.maxHp = 1e6;
  h.tgt = v.id;
  h.tk = 3;
  h.state = AS.Attack;
  const a = fighter(w, 0, 'lasius_worker', p.x - 4.2 - L * 2.2, p.y, 0);
  a.hp = a.maxHp = 1e6;
  a.tgt = v.id;
  a.tk = 3;
  a.state = AS.Attack;
  for (const x of [v, h, a]) x.cd2 = 1e6;
  w.reindex();
  let pressT = -1;
  let reactT = -1;
  let hMoved = 0;
  let hx = 0;
  let hy = 0;
  for (let t = 0; t < 20 * 6; t++) {
    v.stun = 1;
    if ((h.state as AS) === AS.Grapple) {
      hx = h.x;
      hy = h.y;
    }
    w.step(0.05);
    w.events.drain();
    if ((h.state as AS) === AS.Grapple && hx !== 0 && (h.stp ?? 0) === 0) hMoved += Math.hypot(h.x - hx, h.y - hy);
    // pressing: a's teammate inside its personal space, in front of it
    const ahead = Math.hypot(h.x - a.x, h.y - a.y) < BALANCE.combat2.personalSpace * L && Math.abs(wrap(Math.atan2(h.y - a.y, h.x - a.x) - a.h)) <= C21.blockCone;
    if (pressT < 0 && ahead && a.state === AS.Attack) pressT = t;
    if (pressT >= 0 && reactT < 0 && ((a.repT ?? 0) !== 0 || (a.garT ?? 0) > 0 || (a.state as AS) === AS.Grapple)) reactT = t;
  }
  const react = pressT >= 0 && reactT >= 0 ? (reactT - pressT) / 20 : pressT < 0 ? 0 : Infinity;
  check('blocked: an ant behind a teammate backs off or goes round within about 0.5 s', react <= 0.55, pressT < 0 ? 'never pressed (went round at once)' : `${react.toFixed(2)} s after it came up behind`);
  check('blocked: the holder in front is not shoved', hMoved < 0.05, `${hMoved.toFixed(3)} mm`);
  check('blocked: and it gets a slot of its own', (a.state as AS) === AS.Grapple && a.gId === v.id, AS[a.state]);
}

// ---------------------------------------------------------------- 5. small duels on all sides
{
  const r = duelBattle('ant:lasius_worker', 60, 'ant:fire_soldier', 60, 20, 4);
  // (anchored holders are no longer pushed apart, and ants go round full fights instead of standing outside them, so a
  // little less spread than v2's drifting duels at the same overlap: over seeds 3, 4, 7 combat v2 had 20.2 clusters,
  // 31 % small, 14 % overlapping; v2.1 about 14–16, 20–26 %, 13–15 %; the base before v2 8.3 clusters, 24 % overlapping)
  check('duels: a 60 v 60 clash breaks into small, separated fights', r.clusters >= 12 && r.small >= 0.17 && r.overlap <= 0.16, `${r.clusters.toFixed(1)} clusters, ${(r.small * 100).toFixed(0)} % in clusters ≤ 4, ${(r.overlap * 100).toFixed(0)} % overlapping, nn teammate ${r.nnTeam.toFixed(2)} BL (before combat v2: 8.3 clusters, 24 % overlapping)`);
  // six beetles in a group, 45 ants: the ants go round to the far sides and to the other beetles
  const { w, spawn } = arena(6);
  spawn(1, 'cr:groundBeetle', 6, [300, 300]);
  spawn(0, 'ant:lasius_worker', 45);
  let spread = 0;
  let samples = 0;
  let small = 0;
  for (let t = 0; t < 20 * 14; t++) {
    w.step(0.05);
    w.events.drain();
    if (t < 160 || t % 20 !== 19) continue;
    // per beetle with ≥ 3 ants on it: on how many quarters round it are they?
    for (const cr of w.s.creatures) {
      if (cr.dead) continue;
      const on = w.s.ants.filter((a) => a.state === AS.Grapple && a.gKind === 4 && a.gId === cr.id);
      if (on.length < 3) continue;
      const q = new Set(on.map((a) => Math.floor(((Math.atan2(a.y - cr.y, a.x - cr.x) + Math.PI) / (Math.PI / 2)) % 4)));
      spread += q.size;
      samples++;
    }
    small += duelSample(w.s.ants.filter((a) => a.state !== AS.Dead)).small;
  }
  check('six creatures: the ants hold each beetle from all round (quarters occupied, of 4)', samples > 0 && spread / samples >= 2.5, `${(spread / Math.max(1, samples)).toFixed(2)} quarters on average over ${samples} beetle-samples`);
}

// ---------------------------------------------------------------- 6. tunnels: ants queue and take turns, none stuck
{
  const r = tunnelFlow(60, 40, 7);
  check('tunnels: 60 workers leave a crowded chamber through the tunnels (none stuck)', r.out >= 57, `${r.out} out, ${r.meanT.toFixed(1)} s on average`);
}

// ---------------------------------------------------------------- 7. determinism
{
  const play = (restoreAt: number): string => {
    const { w, p } = field(21);
    const cr = spawnCreature(w, 'groundBeetle', SURFACE, p.x + 60, p.y);
    cr.hp = cr.maxHp = 1e6;
    for (let i = 0; i < 30; i++) {
      fighter(w, 0, 'lasius_worker', p.x - 20 + (i % 5) * 3, p.y - 15 + Math.floor(i / 5) * 5, 0);
      fighter(w, 1, 'fire_soldier', p.x + 20 - (i % 5) * 3, p.y - 15 + Math.floor(i / 5) * 5, Math.PI);
    }
    w.reindex();
    let cur = w;
    for (let t = 0; t < 400; t++) {
      if (t === restoreAt) cur = restoreWorld(encodeState(cur), new EventBus());
      cur.step(0.05);
      cur.events.drain();
    }
    return hashState(cur);
  };
  const h1 = play(-1);
  const h2 = play(-1);
  const h3 = play(200);
  check('determinism: the same fight twice gives the same state hash', h1 === h2, h1);
  check('determinism: saved and restored mid-fight (anchors, steps, back-offs, going round) it stays in step', h1 === h3, `${h1} / ${h3}`);
}

console.log(failed ? `\n${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `\nall combat v2.1 tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
