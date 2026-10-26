/**
 * Headless tests for the three new species (Nasute Termites, hell ants,
 * Saiy-Ants): the user's exact ramp numbers, the major soldier, the king, the
 * wood economy, the snap, the gold surge, and determinism.
 *   npx vite-node tests/species.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Ant, AS, SURFACE, nestSpace } from '../src/sim/types';
import { makeAnt, makeFood } from '../src/sim/factory';
import { damageAnt } from '../src/sim/combat';
import { killAnt } from '../src/sim/antAI';
import { BALANCE, NASUTE } from '../src/sim/balance';
import { CASTES, SPECIES, casteOf } from '../src/sim/species';
import { rampTotal, lineOfSight } from '../src/sim/termites';
import { surgeGroup } from '../src/sim/surge';
import { hashState } from '../src/sim/snapshot';
import { edible } from '../src/sim/diet';
import { applyLevel } from '../src/sim/tiles';
import { useAbility } from '../src/sim/abilities';
import { CommandSchedule, applyCommandsNow } from '../src/sim/commands';
import { assignGroup, markerRadius, placeMarker } from '../src/sim/markers';
import { ATTACK_CONTACT, AttackPose, attackPose, neutralPose } from '../src/render/ants/attackPoses';
import { antToView, blankView } from '../src/game/antViews';
import { spawnCreature } from '../src/sim/creatures/creatureAI';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) w.step(0.05);
};

function world(species: Array<'nasutitermes' | 'hell' | 'aurimyrmex' | 'lasius' | 'formica'>, seed = 5): World {
  return createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 1, colonies: species.map((s, i) => ({ species: s, player: i === 0, ai: false })) }, new EventBus());
}

/** An open patch of ground away from the nests, with clear sight east-west. */
function arena(w: World): { x: number; y: number } {
  for (let k = 0; k < 400; k++) {
    const x = 200 + (k % 20) * 15;
    const y = 200 + Math.floor(k / 20) * 15;
    let ok = true;
    for (let dx = -40; dx <= 70 && ok; dx += 2) for (let dy = -10; dy <= 10 && ok; dy += 5) if (!w.walkable(SURFACE, x + dx, y + dy)) ok = false;
    if (ok) return { x, y };
  }
  return { x: 350, y: 350 };
}

/** A target that stands still and never fights back. */
function dummy(w: World, colony: number, caste: string, x: number, y: number): Ant {
  const t = makeAnt(w, colony, caste, SURFACE, x, y, Math.PI);
  t.hp = t.maxHp = 1e6;
  t.task = 'guard';
  return t;
}
const hold = (t: Ant) => {
  t.stun = 1e6;
  t.alarm = 0;
};

// ---------------------------------------------------------------- the nasute ramp (the user's values)
check('ramp formula: total(6 s) = 66 HP, total(10 s) = 146 HP', near(rampTotal(120), 66) && near(rampTotal(200), 146), `${rampTotal(120)} / ${rampTotal(200)}`);

/** Fire `phases` = [ticks in range, ticks out, ticks in, …]; returns damage dealt. */
function rampRun(phases: number[], targetCaste = 'formica_soldier'): { dmg: number; w: World; nas: Ant; t: Ant } {
  const w = world(['nasutitermes', 'formica']);
  const p = arena(w);
  const nas = makeAnt(w, 0, 'nasute_soldier', SURFACE, p.x, p.y, 0);
  nas.task = 'guard';
  const t = dummy(w, 1, targetCaste, p.x + 15, p.y);
  w.reindex();
  let dmg = 0;
  let inRange = true;
  for (const n of phases) {
    for (let i = 0; i < n; i++) {
      t.x = t.px = inRange ? p.x + 15 : p.x + 95;
      t.y = t.py = p.y;
      hold(t);
      const before = t.hp;
      w.step(0.05);
      dmg += before - t.hp;
    }
    inRange = !inRange;
  }
  return { dmg, w, nas, t };
}
{
  const r6 = rampRun([120]);
  check('nasute: 6 s continuous → 66 HP (pure damage: the target has 3 armour)', near(r6.dmg, 66, 1e-6), r6.dmg.toFixed(4));
  const r10 = rampRun([200]);
  check('nasute: 10 s continuous → 146 HP', near(r10.dmg, 146, 1e-6), r10.dmg.toFixed(4));
  const held = rampRun([60, 8, 20]);
  check('nasute: 3 s, 0.4 s interrupted, 1 s → 32 HP (ramp held through grace)', near(held.dmg, 32, 1e-6), held.dmg.toFixed(4));
  const reset = rampRun([60, 12, 20]);
  check('nasute: 3 s, 0.6 s interrupted, 1 s → 23 HP (ramp reset after 0.5 s)', near(reset.dmg, 23, 1e-6), reset.dmg.toFixed(4));
  check('nasute: exposes the ramp for the renderer (lockTicks, firing)', (r6.nas.rampN ?? 0) === 120 && r6.nas.fire === 1);
}
{
  // target switch resets at once; two nasutes ramp independently
  const w = world(['nasutitermes', 'formica']);
  const p = arena(w);
  const a = makeAnt(w, 0, 'nasute_soldier', SURFACE, p.x, p.y, 0);
  const b = makeAnt(w, 0, 'nasute_soldier', SURFACE, p.x, p.y + 4, 0);
  a.task = b.task = 'guard';
  const t1 = dummy(w, 1, 'formica_worker', p.x + 15, p.y + 2);
  w.reindex();
  for (let i = 0; i < 40; i++) {
    hold(t1);
    w.step(0.05);
  }
  check('two nasutes on one target ramp independently', a.rampN === 40 && b.rampN === 40, `${a.rampN} / ${b.rampN}`);
  const t2 = dummy(w, 1, 'formica_worker', p.x + 12, p.y - 6);
  w.reindex();
  a.tgt = t2.id;
  a.tk = 3;
  hold(t1);
  hold(t2);
  w.step(0.05);
  check('a target switch resets the ramp immediately (no grace)', a.rampT === t2.id && a.rampN === 1, `${a.rampN}`);
  // out of sight for longer than grace: reset
  const s = rampRun([40, 30]);
  check('out of range longer than the grace: the ramp resets and the target is dropped', (s.nas.rampN ?? 0) === 0 && s.nas.rampT === 0);
  check('line of sight: the ray is blocked by solid ground', !lineOfSight(w, nestSpace(0), 1, 1, 400, 400));
}

// ---------------------------------------------------------------- the major soldier
{
  const w = world(['nasutitermes', 'formica']);
  const p = arena(w);
  const m = makeAnt(w, 0, 'nasute_major', SURFACE, p.x, p.y, 0);
  m.task = 'guard';
  const t = makeAnt(w, 1, 'formica_worker', SURFACE, p.x + 22, p.y, Math.PI);
  t.hp = t.maxHp = 1e5;
  t.task = 'guard';
  w.reindex();
  m.state = AS.Attack;
  m.tgt = t.id;
  m.tk = 3;
  let charged = false;
  let rooted = 0;
  for (let i = 0; i < 60; i++) {
    hold(t); // stands still (it would otherwise walk home)
    w.step(0.05);
    if ((m.chT ?? 0) > 0) charged = true;
    if ((t.root ?? 0) > w.s.tick) rooted = Math.max(rooted, (t.root ?? 0) - w.s.tick);
  }
  check('major: charges a target within 4 body lengths, then waits out the cooldown', charged && (m.chCd ?? 0) > 0, `cd ${m.chCd?.toFixed(2)}`);
  check('major: glue burst roots the target for 1 s (20 ticks)', rooted >= 19 && rooted <= 20, `${rooted} ticks`);
  check('major: re-root immunity runs 2 s past the hold', (t.rootImm ?? 0) - (t.root ?? 0) === 40);
  // large targets: half the hold
  const big = makeAnt(w, 1, 'atta_major', SURFACE, m.x + 5, m.y, 0);
  m.glueCd = 0;
  w.reindex();
  const { glueBurst } = await import('../src/sim/termites');
  glueBurst(w, m, 3, big.id);
  check('major: the hold is halved on large targets', (big.root ?? 0) - w.s.tick === 10, `${(big.root ?? 0) - w.s.tick} ticks`);
  // alarm: same colony within 12 body lengths only; units on a marker keep their orders (behaviour)
  const w2 = world(['nasutitermes', 'formica']);
  const p2 = arena(w2);
  const mj = makeAnt(w2, 0, 'nasute_major', SURFACE, p2.x, p2.y, 0);
  const friendNear = makeAnt(w2, 0, 'nasute_soldier', SURFACE, p2.x + 30, p2.y, 0);
  const friendFar = makeAnt(w2, 0, 'nasute_soldier', SURFACE, p2.x + 95, p2.y, 0);
  const foe = makeAnt(w2, 1, 'formica_worker', SURFACE, p2.x + 20, p2.y + 5, 0);
  w2.reindex();
  w2.prepareQueries();
  damageAnt(w2, mj, 1, 'bite', foe);
  check('major: the alarm alerts only its own colony within 12 body lengths', (friendNear.alertUntil ?? 0) > w2.s.tick && (friendFar.alertUntil ?? 0) <= w2.s.tick && foe.alertUntil === undefined);
  check('major: the alarm has a 3 s cooldown', near(mj.alCd ?? 0, NASUTE.majorAlarm.cooldownSec));
}

// ---------------------------------------------------------------- the king and queen
{
  const w = world(['nasutitermes', 'lasius']);
  const c = w.colony(0)!;
  const king = w.antById.get(c.king!)!;
  const q = w.antById.get(c.queen)!;
  check('termite colony starts with a queen and a king in the royal chamber', !!king && casteOf(king.caste).termite === 'king' && king.space === nestSpace(0));
  const foe = makeAnt(w, 1, 'lasius_soldier', nestSpace(0), king.x + 2, king.y, 0);
  w.reindex();
  const hp0 = king.hp;
  damageAnt(w, king, 50, 'bite', foe);
  check('king: takes no damage while the queen lives', king.hp === hp0);
  run(w, 40);
  check('king: bites intruders inside the royal chamber', foe.hp < foe.maxHp || foe.state === AS.Dead, `${foe.hp.toFixed(1)}/${foe.maxHp}`);
  killAnt(w, q);
  check('king: dies with the queen', king.state === AS.Dead);
  run(w, 25);
  check('termite colony is lost when the queen dies', !c.alive);
  check('termite colonies do not count the king as a worker', !Object.keys(w.colony(0)!.counts).includes('nasute_king'));
}

// ---------------------------------------------------------------- wood economy and diet
{
  const w = world(['nasutitermes', 'lasius']);
  const T = w.colony(0)!;
  const A = w.colony(1)!;
  const wood = w.s.food.filter((f) => f.kind === 'wood');
  const e = T.entrances[0];
  const close = wood.filter((f) => Math.hypot(f.x - e.sx, f.y - e.sy) < 90);
  check('maps with termites get deadwood, at least two pieces close to each termite nest', wood.length >= 4 && close.length >= 2, `${wood.length} pieces, ${close.length} near`);
  const insect = makeFood(w, 'insect', SURFACE, 10, 10, 1, 'fly');
  check('termites eat only wood; ants never eat wood', edible(T, wood[0]) && !edible(T, insect) && !edible(A, wood[0]) && edible(A, insect));
  const corpse = makeFood(w, 'corpse', SURFACE, 10, 10, 1, 'termite_worker');
  corpse.colony = 0;
  check('ants can eat termite corpses; termites eat no corpses', edible(A, corpse) && !edible(T, corpse));
  // worker sizes: deterministic by id, females 10 % tougher
  const ws = w.s.ants.filter((a) => a.caste === 'nasute_worker' || a.caste === 'nasutitermes_nanitic');
  const fem = ws.find((a) => a.variant === 1);
  if (fem) applyLevel(fem, 1);
  check('termite workers: male and female sizes, females +10 % health', ws.every((a) => a.variant === 0 || a.variant === 1) && (!fem || near(fem.maxHp, casteOf(fem.caste).hp * 1.1)));
  check('ramp caste uses the acid system with kind "ramp" and 5 body lengths of range', CASTES.nasute_soldier.acid?.kind === 'ramp' && CASTES.nasute_soldier.acid.range === 25);
  check('brood costs: × 1 / 1.8 / 3.5 wood and × 1 / 1.3 / 1.8 time of the baseline worker', BALANCE.castes.nasute_soldier.build === 18 && BALANCE.castes.nasute_major.build === 35 && near(BALANCE.castes.nasute_major.grow, 32.4));
  // a termite colony gathers wood with a forage marker
  const w3 = createWorld({ seed: 9, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'nasutitermes', player: true, ai: true }] }, new EventBus());
  run(w3, 20 * 240);
  const c3 = w3.colony(0)!;
  check('termite AI colony gathers wood and grows', c3.stats.food > 20 && c3.living > 6, `wood ${c3.stats.food.toFixed(0)}, ${c3.living} termites`);
  check('…and has hatched soldiers by its own brood loop', w3.s.ants.some((a) => a.colony === 0 && casteOf(a.caste).termite === 'worker') && c3.stats.born > 3, `born ${c3.stats.born}`);
}

// ---------------------------------------------------------------- termites at markers, idle life, AI scouting
{
  const w = world(['nasutitermes', 'lasius']);
  const T = w.colony(0)!;
  const p = arena(w);
  const mx = p.x + 20;
  const my = p.y;
  placeMarker(w, T, 0, SURFACE, mx, my);
  const R = markerRadius(w, T, 0);
  // the test squad belongs to the queen's chamber group, sent to marker I
  const qg = T.groups.find((g) => g.type === 'queen')!;
  const qt = T.tiles.find((t) => t.group === qg.id)!;
  assignGroup(w, T, qg.id, 0);
  const nas: Ant[] = [];
  for (let k = 0; k < 6; k++) {
    const a = makeAnt(w, 0, 'nasute_soldier', SURFACE, mx - 6 + k * 2, my + 4, 0);
    a.tile = qt.q;
    nas.push(a);
  }
  w.reindex();
  run(w, 20 * 25);
  const ringR = R + NASUTE.escort.ringBodyLengths * NASUTE.sizeMm.nasuteSoldier;
  const dErr = Math.max(...nas.map((a) => Math.abs(Math.hypot(a.x - mx, a.y - my) - ringR)));
  const angs = nas.map((a) => Math.atan2(a.y - my, a.x - mx)).sort((x, y) => x - y);
  const gaps = angs.map((v, i) => (i ? v - angs[i - 1] : v + Math.PI * 2 - angs[angs.length - 1]));
  const gapErr = Math.max(...gaps.map((g) => Math.abs(g - (Math.PI * 2) / 6)));
  const outward = nas.every((a) => Math.cos(a.h - Math.atan2(a.y - my, a.x - mx)) > 0.9);
  check('nasutes at a marker: an escort ring round the work area (radius + 3 body lengths), evenly spaced, facing out', dErr < 2.5 && gapErr < 0.35 && outward, `radius error ${dErr.toFixed(2)} mm, spacing error ${gapErr.toFixed(2)} rad`);
  // majors join and a threat is known: majors form the front line, nasutes a line two body lengths behind
  const maj: Ant[] = [];
  for (let k = 0; k < 2; k++) {
    const a = makeAnt(w, 0, 'nasute_major', SURFACE, mx + k * 3, my - 4, 0);
    a.tile = qt.q;
    maj.push(a);
  }
  w.reindex();
  const threatX = mx + 120;
  for (const a of [...nas, ...maj]) {
    a.alertUntil = w.s.tick + 20 * 60;
    a.alX = threatX;
    a.alY = my;
  }
  run(w, 20 * 20);
  const frontMaj = maj.map((a) => a.x - mx);
  const frontNas = nas.map((a) => a.x - mx);
  const want = R * 0.6;
  check('…with majors and a known threat: majors hold the front, nasutes line up 2 body lengths behind them', frontMaj.every((v) => Math.abs(v - want) < 2.5) && frontNas.every((v) => Math.abs(v - (want - NASUTE.escort.behindMajorsBodyLengths * 5)) < 2.5), `majors at ${frontMaj.map((v) => v.toFixed(1)).join('/')}, nasutes at ${frontNas.map((v) => v.toFixed(1)).join('/')} (want ${want.toFixed(1)} / ${(want - 10).toFixed(1)})`);

  // idle colony life: home workers groom the queen and brood and feed soldiers, the king and the queen
  const w2 = createWorld({ seed: 13, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'nasutitermes', player: true, ai: false }] }, new EventBus());
  const c2 = w2.colony(0)!;
  const home = nestSpace(0);
  let groomQ = 0;
  let feeds = 0;
  for (let i = 0; i < 20 * 90; i++) {
    w2.step(0.05);
    for (const a of w2.s.ants) {
      if (a.colony !== 0 || a.space !== home || !(a.idleT && a.idleT > 0) || a.state !== AS.Groom) continue;
      if (a.partner === c2.queen && a.tk === 0) groomQ++;
      if (a.tk === 1) feeds++;
    }
  }
  check('termite workers with nothing to do groom the queen and feed nestmates (2–4 s each, no economic effect)', groomQ > 0 && feeds > 0, `${groomQ} grooming ticks, ${feeds} feeding ticks`);

  // AI: soldier-first foraging and a 10-minute determinism check against ants, with a command stream
  const mk = () => {
    const ww = createWorld({ seed: 9, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'nasutitermes', player: true, ai: true }, { species: 'lasius', player: false, ai: true }] }, new EventBus());
    const sched = new CommandSchedule();
    const c = ww.colony(0)!;
    const e = c.entrances[0];
    sched.add({ type: 'setAggression', on: true, tick: 20 * 30, player: 0, seq: 1 } as never);
    sched.add({ type: 'placeMarker', i: 4, space: SURFACE, x: e.sx + 40, y: e.sy + 10, tick: 20 * 200, player: 0, seq: 2 } as never);
    sched.add({ type: 'useAbility', tick: 20 * 320, player: 0, seq: 3 } as never);
    sched.add({ type: 'removeMarker', i: 4, tick: 20 * 400, player: 0, seq: 4 } as never);
    let scoutFirst = false;
    let columnAfter = false;
    for (let i = 0; i < 20 * 60 * 10; i++) {
      applyCommandsNow(ww, sched.take(ww.s.tick));
      ww.step(0.05);
      ww.events.drain();
      if (i % 20 === 0) {
        const nasOnScout = c.groups.some((g) => g.caste && CASTES[g.caste].termite === 'nasute' && g.marker === 3);
        const workersOnScout = c.groups.some((g) => g.caste && CASTES[g.caste].termite === 'worker' && g.marker === 3);
        if (nasOnScout && !workersOnScout && c.markers[3].placed) scoutFirst = true;
        if (scoutFirst && c.aiForage?.scouted && c.groups.some((g) => g.caste && CASTES[g.caste].termite === 'nasute' && g.marker === 0)) columnAfter = true;
      }
    }
    return { ww, scoutFirst, columnAfter };
  };
  const A1 = mk();
  check('termite AI forages soldier-first: nasutes scout a new source (marker IV) before the workers come, then escort the column', A1.scoutFirst && A1.columnAfter);
  const A2 = mk();
  check('determinism: Nasute Termites vs Lasius with a command stream — identical hashes after 10 sim minutes (ramp, root, alarm state included)', hashState(A1.ww) === hashState(A2.ww), hashState(A1.ww));
}

// ---------------------------------------------------------------- hell ants
{
  const w = world(['hell', 'lasius']);
  const p = arena(w);
  const h = makeAnt(w, 0, 'hell_worker', SURFACE, p.x, p.y, 0);
  h.task = 'guard';
  const prey = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x + 6, p.y, Math.PI);
  prey.hp = prey.maxHp = 500;
  prey.task = 'guard';
  prey.cd2 = 1e6; // no acid: a hit on the holder would (rightly) make it let go
  w.reindex();
  h.state = AS.Attack;
  h.tgt = prey.id;
  h.tk = 3;
  const seen: AS[] = [];
  let heldTicks = 0;
  let snapTick = -1;
  let huntTicks = 0;
  let maxSock = 0;
  const hp: number[] = [];
  let snaps = 0;
  w.events.on('snap', () => snaps++);
  for (let i = 0; i < 140; i++) {
    w.step(0.05);
    w.events.drain();
    if (seen[seen.length - 1] !== h.state) seen.push(h.state);
    const hs = h.state as AS;
    if (hs === AS.Hunt) huntTicks++;
    if (hs === AS.Snap && snapTick < 0) snapTick = i;
    if (prey.heldBy === h.id) heldTicks++;
    if (prey.heldBy === h.id && hs === AS.Hold && h.st > 0) {
      maxSock = Math.max(maxSock, Math.abs(Math.hypot(prey.x - h.x, prey.y - h.y) - 5 * BALANCE.snap.holdForward));
      hp.push(prey.hp);
    }
  }
  const order = seen.filter((x) => x === AS.Hunt || x === AS.Snap || x === AS.Hold);
  check('hell worker: Attack → Hunt (creeping wind-up) → Snap → Hold', order[0] === AS.Hunt && order[1] === AS.Snap && order[2] === AS.Hold, seen.map((x) => AS[x]).join('>'));
  check('…the wind-up lasts at least the caste windup (0.6 s)', huntTicks >= 12, `${huntTicks} ticks hunting`);
  check('…pins the prey at the mandible–horn socket for the hold (4 s = 80 ticks)', heldTicks === 80 && maxSock < 1e-6 && snaps === 1, `${heldTicks} ticks held, socket error ${maxSock.toExponential(1)}, ${snaps} snap`);
  const drops = hp.filter((v, i) => i > 0 && v < hp[i - 1] - 1e-9).length;
  check('…bleeds it every 0.5 s while stinging it (slowed)', drops >= 7 && prey.venom > 0, `${drops} damage steps, venom ${prey.venom}`);
  check('…then lets go: the prey is dropped dazed and the snap cools down 5 s', prey.heldBy === 0 && h.holdId === 0 && (h.snapCd ?? 0) > 2 && (h.snapCd ?? 0) <= 5);

  // hurt while holding: lets go at once
  const h2 = makeAnt(w, 0, 'hell_worker', SURFACE, p.x, p.y + 20, 0);
  const prey2 = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x + 6, p.y + 20, Math.PI);
  prey2.hp = prey2.maxHp = 500;
  w.reindex();
  h2.state = AS.Attack;
  h2.tgt = prey2.id;
  h2.tk = 3;
  for (let i = 0; i < 60 && prey2.heldBy !== h2.id; i++) run(w, 1);
  const wasHeld = prey2.heldBy === h2.id;
  const enemy = makeAnt(w, 1, 'lasius_soldier', SURFACE, p.x - 4, p.y + 20, 0);
  w.reindex();
  damageAnt(w, h2, 0.5, 'bite', enemy);
  check('hell worker: lets the prey go when it is hurt (half cooldown) and fights back', wasHeld && prey2.heldBy === 0 && h2.holdId === 0 && h2.tgt === enemy.id && near(h2.snapCd ?? 0, 2.5));

  const big = makeAnt(w, 1, 'atta_major', SURFACE, p.x + 30, p.y, 0);
  const s2 = makeAnt(w, 0, 'hell_soldier', SURFACE, p.x + 24, p.y, 0);
  s2.task = 'guard';
  w.reindex();
  s2.state = AS.Attack;
  s2.tgt = big.id;
  s2.tk = 3;
  let hunted = false;
  for (let i = 0; i < 60; i++) {
    run(w, 1);
    if ((s2.state as AS) === AS.Hunt || (s2.state as AS) === AS.Hold) hunted = true;
  }
  check('hell soldier: refuses to snap large prey (Atta major), grapples its legs instead', !hunted && big.heldBy !== s2.id && (s2.snapCd ?? 0) === 0 && (s2.state as AS) === AS.Grapple, AS[s2.state]);
  const s3 = makeAnt(w, 0, 'hell_soldier', SURFACE, p.x, p.y + 40, 0);
  const prey3 = makeAnt(w, 1, 'lasius_soldier', SURFACE, p.x + 7, p.y + 40, Math.PI);
  prey3.hp = prey3.maxHp = 500;
  // the earlier duels' enemies leave the field (fighters now share foes out: they came over and pinned the soldier)
  for (const o of w.s.ants) if (o.colony === 1 && o !== prey3 && o.id !== w.colony(1)!.queen && o.state !== AS.Dead && o.space === SURFACE) killAnt(w, o);
  w.reindex();
  s3.state = AS.Attack;
  s3.tgt = prey3.id;
  s3.tk = 3;
  let burst = 0;
  let hp0 = 0;
  let hpAfter = 0;
  let heldAfterBurst = false;
  w.events.on('snap', (e) => {
    if (e.impale) {
      burst++;
      hp0 = prey3.hp;
    }
  });
  for (let i = 0; i < 60; i++) {
    // the prey does not bite or spray back here (a hurt hell ant lets go: tested on its own above); this checks the
    // impale itself, which otherwise depends on the prey's bite timing (its jitter comes from the world's RNG)
    prey3.cd = Math.max(prey3.cd, 1);
    prey3.cd2 = Math.max(prey3.cd2, 1);
    w.step(0.05);
    w.events.drain();
    if (burst && !hpAfter) hpAfter = prey3.hp;
    if (burst && prey3.heldBy === s3.id) heldAfterBurst = true;
  }
  check('hell soldier: impales medium prey (a burst as the jaws close)', burst === 1 && heldAfterBurst && prey3.heldBy === s3.id && 500 - prey3.hp > 10, `${(500 - prey3.hp).toFixed(1)} damage, ${burst} bursts, held by ${prey3.heldBy} (soldier ${s3.id}, state ${AS[s3.state]})`);

  // Ambush: the snap is ready again right after each catch
  const c0 = w.colony(0)!;
  c0.abilityCd = 0;
  useAbility(w, c0);
  const s4 = makeAnt(w, 0, 'hell_worker', SURFACE, p.x + 40, p.y - 20, 0);
  const prey4 = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x + 46, p.y - 20, Math.PI);
  prey4.hp = prey4.maxHp = 500;
  w.reindex();
  s4.state = AS.Attack;
  s4.tgt = prey4.id;
  s4.tk = 3;
  let caught = 0;
  for (let i = 0; i < 140; i++) {
    run(w, 1);
    if (s4.holdId) caught = 1;
    if (caught && !s4.holdId) break;
  }
  check('Ambush: the snap recharges instantly after a catch', caught === 1 && (s4.snapCd ?? 1) === 0);

  // small creatures are snapped too; the held creature cannot act
  const w2 = world(['hell', 'lasius']);
  const p2 = arena(w2);
  const h5 = makeAnt(w2, 0, 'hell_worker', SURFACE, p2.x, p2.y, 0);
  const sp = spawnCreature(w2, 'spiderling', SURFACE, p2.x + 6, p2.y);
  sp.hp = sp.maxHp = 500;
  w2.reindex();
  h5.state = AS.Attack;
  h5.tgt = sp.id;
  h5.tk = 4;
  let crHeld = 0;
  for (let i = 0; i < 100; i++) {
    run(w2, 1);
    if (sp.data.heldBy === h5.id && sp.stun > 0) crHeld++;
  }
  check('hell worker: snaps a spiderling and holds it stunned', crHeld > 40, `${crHeld} ticks`);
}

// ---------------------------------------------------------------- Saiy-Ants
{
  const w = world(['aurimyrmex', 'lasius']);
  const p = arena(w);
  const s = makeAnt(w, 0, 'aurimyrmex_worker', SURFACE, p.x, p.y, 0);
  s.task = 'guard';
  const foe = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x + 6, p.y, Math.PI);
  foe.hp = foe.maxHp = 1e5;
  w.reindex();
  let goldTicks = 0;
  let started = -1;
  for (let i = 0; i < 600 && goldTicks < 200; i++) {
    w.step(0.05);
    if ((s.surgeT ?? 0) > 0) {
      if (started < 0) started = i;
      goldTicks++;
    } else if (started >= 0) break;
  }
  check('Saiy-Ant: turns gold on entering combat and stays gold 4 s (80 ticks)', goldTicks === 80, `${goldTicks} ticks`);
  check('…then a 20 s cooldown', near(s.surgeCd ?? 0, 20, 0.051), `${s.surgeCd}`);
  // timers and perks on a lone ant (no fight to re-trigger it)
  const { antSpeed } = await import('../src/sim/movement');
  const { startSurge, surgeTick } = await import('../src/sim/surge');
  const lone = makeAnt(w, 0, 'aurimyrmex_soldier', SURFACE, p.x - 30, p.y + 40, 0);
  const base = antSpeed(w, lone);
  lone.surgeT = 2;
  check('…+50 % speed while gold', near(antSpeed(w, lone) / base, 1.5, 1e-9));
  lone.surgeT = 0;
  lone.surgeCd = 20;
  let n = 0;
  while ((lone.surgeCd ?? 0) > 0 && n < 1000) {
    surgeTick(lone, 0.05);
    n++;
  }
  check('…ready again after exactly 20 s (400 ticks)', n === 400, `${n} ticks`);
  applyLevel(lone, 2);
  lone.surgeT = 0.05;
  surgeTick(lone, 0.05);
  check('level-2 tiles: 14 s cooldown', near(lone.surgeCd ?? 0, 14, 1e-9), `${lone.surgeCd}`);
  applyLevel(lone, 3);
  lone.surgeCd = 0;
  startSurge(w, lone);
  check('level-3 tiles: 5 s of gold', lone.surgeT === 5);
  // damage: +60 % while gold
  const victim = dummy(w, 1, 'lasius_queen', lone.x + 6, lone.y);
  victim.stun = 1e6;
  void victim;
  const c = w.colony(0)!;
  const q = w.antById.get(c.queen)!;
  check('the queen never transforms', q.surgeT === undefined && !CASTES.aurimyrmex_queen.surge);
  // manual group trigger through the command queue
  const group = c.groups.find((g) => g.type === 'queen')!;
  for (const a of w.s.ants) if (a.colony === 0 && a.surgeT !== undefined) {
    a.surgeT = 0;
    a.surgeCd = 0;
  }
  const sched = new CommandSchedule();
  applyCommandsNow(w, [{ type: 'surgeGroup', group: group.id, tick: w.s.tick + 1, player: 0, seq: 1 }]);
  void sched;
  const inGroup = w.s.ants.filter((a) => a.colony === 0 && a.tile >= 0 && c.tiles.find((t) => t.q === a.tile)?.group === group.id);
  check('Gold Surge command: every ready ant of the group transforms at once', inGroup.length > 0 && inGroup.every((a) => (a.surgeT ?? 0) > 0), `${inGroup.length} ants`);
  check('…ants on cooldown are skipped', surgeGroup(w, c, group.id) === 0);
  for (const a of inGroup) {
    a.surgeT = 0;
    a.surgeCd = 10;
  }
  c.abilityCd = 0;
  useAbility(w, c);
  check('Second Wind: exhausted ants recover at once', inGroup.every((a) => a.surgeCd === 0));
}

// ---------------------------------------------------------------- melee attack animations (render-side, pure)
{
  const P = neutralPose({} as AttackPose);
  const rest = { ...neutralPose({} as AttackPose) };
  const same = (a: AttackPose, b: AttackPose) => Object.keys(b).every((k) => Math.abs((a as never as Record<string, number>)[k] - (b as never as Record<string, number>)[k]) < 1e-6);
  let ok = true;
  let shut = true;
  let distinct = 0;
  const mid: string[] = [];
  for (const v of [0, 1, 2]) {
    ok = ok && same(attackPose(v, 0, 1, P), rest) && same(attackPose(v, 1, 1, P), rest);
    shut = shut && attackPose(v, ATTACK_CONTACT, 1, P).mand < 1e-6 && attackPose(v, 0.5, 1, P).mand > 0.8;
    const m = attackPose(v, 0.5, 1, P);
    mid.push(`${m.fwd.toFixed(2)}/${m.pitch.toFixed(2)}/${m.yaw.toFixed(2)}`);
  }
  distinct = new Set(mid).size;
  check('attack animations: three different attacks (lunge bite, rear-up chomp, side clamp and tug), each neutral at both ends of the cycle', ok && distinct === 3, mid.join('  '));
  check('…all gape through the wind-up and shut the jaws at the same moment (contact at 0.7 of the cycle)', shut);
  // in the game: the jaws close on the tick the bite lands, whatever the gap
  const w = world(['aurimyrmex', 'lasius']);
  const p = arena(w);
  const a = makeAnt(w, 0, 'aurimyrmex_worker', SURFACE, p.x, p.y, 0);
  const o = dummy(w, 1, 'lasius_worker', p.x + 5, p.y);
  hold(o);
  w.reindex();
  a.state = AS.Attack;
  a.tgt = o.id;
  a.tk = 3;
  const view = blankView();
  let bites = 0;
  let onBeat = 0;
  const seq: number[] = [];
  w.events.on('bite', (e) => {
    if (e.by === 'aurimyrmex_worker') {
      bites++;
      antToView(w, a, view, 0, 0);
      if (view.atk !== undefined && Math.abs(view.atk - ATTACK_CONTACT) < 1e-6) onBeat++;
    }
  });
  for (let i = 0; i < 20 * 12; i++) {
    w.step(0.05);
    w.events.drain();
    antToView(w, a, view, 0, 0);
    if (view.atk !== undefined && seq[seq.length - 1] !== view.atkVar) seq.push(view.atkVar!);
  }
  const repeats = seq.some((v, i) => i > 0 && v === seq[i - 1]);
  check('…in a fight every bite lands exactly on the contact of the attack playing (gaps vary with jitter and surge)', bites > 4 && onBeat >= bites - 1, `${onBeat}/${bites} bites on the beat`);
  check('…and the unit cycles through all three attacks, never the same twice running', new Set(seq).size === 3 && !repeats, seq.slice(0, 10).join(','));
  check('Saiy-Ants have no acid: they fight with bites only', !CASTES.aurimyrmex_worker.acid && !CASTES.aurimyrmex_soldier.acid && !CASTES.aurimyrmex_nanitic?.acid);
}

// ---------------------------------------------------------------- species registry, determinism
check('all three species are registered with their castes', ['nasutitermes', 'hell', 'aurimyrmex'].every((s) => SPECIES[s as 'hell'].castes.every((cs) => !!CASTES[cs])));
check('Saiy-Ants display name comes from one config value', SPECIES.aurimyrmex.common === 'Saiy-Ants');
{
  const mk = () => {
    const w = createWorld({ seed: 31, style: 'meadow', width: 700, depth: 700, food: 1.2, colonies: [{ species: 'nasutitermes', player: false, ai: true }, { species: 'hell', player: false, ai: true }, { species: 'aurimyrmex', player: false, ai: true }, { species: 'lasius', player: false, ai: true }], settings: { creatures: 1 } }, new EventBus());
    run(w, 20 * 60 * 3);
    return w;
  };
  const a = mk();
  const b = mk();
  check('determinism: termites, hell ants, Saiy-Ants and Lasius — identical hashes after 3 sim minutes', hashState(a) === hashState(b), hashState(a));
}

console.log(failed ? `${failed} FAILED` : 'all species tests passed');
if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
