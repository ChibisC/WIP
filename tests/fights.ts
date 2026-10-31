/**
 * Headless tests for the fight notes of 2026-10-25 (user): fighters "too compact" (the guard line at markers, a
 * body's room between fighters, foes spread among attackers, creatures kept apart), the "weird glitchy movement"
 * after a fight is won (the alarm rush that lurched four ticks at a time), and the per-marker orders like EotU's
 * (no attacking, no gathering, no climbing: sim, command and wire format).
 *   npx vite-node tests/fights.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Ant, AS, Carry, SURFACE } from '../src/sim/types';
import { antSlotCount } from '../src/sim/slots';
import { ARENA, BALANCE, GUARD } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout } from '../src/sim/arena';
import { STANCE, arenaOf } from '../src/sim/arenaState';
import { Command, CommandBody, applyCommand, decodeCommandLog, encodeCommandLog, quantize } from '../src/sim/commands';
import { casteOf } from '../src/sim/species';
import { creatureHooks } from '../src/sim/combat';
import { assignGroup, placeMarker } from '../src/sim/markers';
import { makeAnt, makeFood } from '../src/sim/factory';
import { hashState } from '../src/sim/snapshot';
import { placeTile, raisesAnts } from '../src/sim/tiles';
import { JOB } from '../src/sim/jobs';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();

function arena(n = 2, seed = 4): { w: World; cmd: (b: CommandBody) => string | null; log: Command[] } {
  const L = arenaLayout(ARENA.size, n);
  const setup: GameSetup = {
    seed,
    style: 'formicarium',
    width: ARENA.size,
    depth: ARENA.size,
    colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })),
    caves: [],
    food: 0,
    aphids: 0,
    plants: 0,
    puddles: 0,
    settings: { creatures: 0 },
    arena: true,
  };
  const w = createWorld(setup, new EventBus());
  let seq = 0;
  const log: Command[] = [];
  const cmd = (b: CommandBody) => {
    const c = { ...quantize(b), tick: w.s.tick, player: 0, seq: seq++ } as Command;
    log.push(c);
    return applyCommand(w, c);
  };
  return { w, cmd, log };
}
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    w.step(0.05);
    w.events.drain();
  }
};
const spawn = (team: number, unit: string, n: number, at: { x: number; y: number } | null = null): CommandBody => ({ type: 'arenaSpawn', team, unit, n, level: 1, at: !!at, x: at?.x ?? 0, y: at?.y ?? 0 });
const units = (w: World, colony: number) => w.s.ants.filter((a) => a.colony === colony && a.state !== AS.Dead && a.id !== w.colony(colony)!.queen && a.id !== w.colony(colony)!.king);
const foesLeft = (w: World, colony: number) => units(w, colony).length + w.s.creatures.filter((c) => !c.dead && c.faction === colony).length;
const median = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1] ?? 0;
function nnBodyLengths(w: World, colony: number): number[] {
  const u = units(w, colony);
  return u.map((a) => Math.min(...u.filter((o) => o !== a).map((o) => Math.hypot(o.x - a.x, o.y - a.y))) / casteOf(a.caste).length);
}

// ---- after the fight: calm (no lurching in the alarm scent, no stop-start, no zigzag)
for (const unit of ['ant:lasius_soldier', 'ant:nasute_soldier', 'ant:rhy_soldier']) {
  const { w, cmd } = arena();
  cmd(spawn(0, unit, 20));
  cmd(spawn(1, 'ant:lasius_worker', 6));
  let t = 0;
  while (foesLeft(w, 1) > 0 && t < 20 * 120) {
    run(w, 1);
    t++;
  }
  const mine = units(w, 0);
  const last = new Map(mine.map((a) => [a.id, { x: a.x, y: a.y, h: a.h, dh: 0, rev: 0, jump: 0 }]));
  for (let k = 0; k < 20 * 12; k++) {
    run(w, 1);
    for (const a of mine) {
      const s = last.get(a.id)!;
      let dh = a.h - s.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      if (Math.abs(dh) > 0.06 && Math.abs(s.dh) > 0.06 && Math.sign(dh) !== Math.sign(s.dh)) s.rev++;
      // one tick's step against the fastest walk (alarm rush ×1.1) plus a separation nudge
      const step = Math.hypot(a.x - s.x, a.y - s.y);
      if (step > casteOf(a.caste).speed * 1.25 * 0.05 + BALANCE.separation.maxPush * 2 + 0.05) s.jump++;
      s.dh = dh;
      s.x = a.x;
      s.y = a.y;
      s.h = a.h;
    }
  }
  const rev = [...last.values()].reduce((x, s) => x + s.rev, 0) / mine.length / 12;
  const jumps = [...last.values()].reduce((x, s) => x + s.jump, 0);
  check(`${unit.slice(4)}: after its foes are dead it walks back calmly — no zigzag, no lurches`, rev < 0.15 && jumps === 0, `${rev.toFixed(2)} heading reversals a second per ant (it was ~1.6), ${jumps} ticks with a jump`);
  const nn = nnBodyLengths(w, 0);
  check(`${unit.slice(4)}: back at its marker it stands in a guard line, a body's room apart`, mine.filter((a) => a.state === AS.Rally).length >= mine.length * 0.8 && median(nn) >= GUARD.spacing * 0.85, `${mine.filter((a) => a.state === AS.Rally).length}/${mine.length} in place, nearest teammate ${median(nn).toFixed(2)} body lengths (median)`);
}

// ---- the guard line: rows across the marker, facing the front
{
  const { w, cmd } = arena();
  const A = arenaOf(w)!;
  cmd({ type: 'arenaStance', team: 0, stance: STANCE.HOLD });
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.HOLD });
  cmd(spawn(0, 'ant:lasius_soldier', 24));
  run(w, 20 * 15);
  const u = units(w, 0);
  const m = w.colony(0)!.markers[0];
  const f = m.face ?? 0;
  // spread along the front against the depth of the formation
  const across = u.map((a) => -(a.x - m.x) * Math.sin(f) + (a.y - m.y) * Math.cos(f));
  const deep = u.map((a) => (a.x - m.x) * Math.cos(f) + (a.y - m.y) * Math.sin(f));
  const wide = Math.max(...across) - Math.min(...across);
  const depth = Math.max(...deep) - Math.min(...deep);
  const toCentre = Math.atan2(A.cy - m.y, A.cx - m.x);
  const facing = u.filter((a) => Math.abs(Math.atan2(Math.sin(a.h - f), Math.cos(a.h - f))) < 0.35).length;
  check('guard line: the team stands in rows across its marker, much wider than deep', wide > depth * 2.5 && u.every((a) => a.state === AS.Rally), `${wide.toFixed(0)} mm wide, ${depth.toFixed(0)} mm deep`);
  check('guard line: it faces the front (the field centre before any foe is seen), every ant the same way', Math.abs(Math.atan2(Math.sin(toCentre - f), Math.cos(toCentre - f))) < 0.1 && facing === u.length, `${facing}/${u.length} facing the front`);
  check('guard line: places a body\'s room apart', Math.min(...nnBodyLengths(w, 0)) >= GUARD.spacing * 0.8, `closest pair ${Math.min(...nnBodyLengths(w, 0)).toFixed(2)} body lengths`);
  // a foe appears off to one side: the line wheels round to face it
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.PASSIVE });
  const side = { x: m.x + Math.cos(f + Math.PI / 2) * 90, y: m.y + Math.sin(f + Math.PI / 2) * 90 };
  cmd(spawn(1, 'ant:lasius_worker', 1, side));
  run(w, 20 * 2);
  const want = Math.atan2(side.y - m.y, side.x - m.x);
  check('guard line: a foe seen near the marker turns the front toward it', Math.abs(Math.atan2(Math.sin(want - (m.face ?? 0)), Math.cos(want - (m.face ?? 0)))) < 0.6, `front ${(m.face ?? 0).toFixed(2)} rad, foe at ${want.toFixed(2)}`);
}

// ---- fights spread out: foes shared out among the attackers, fighters a body apart
{
  const { w, cmd } = arena();
  cmd(spawn(0, 'ant:lasius_soldier', 24));
  cmd(spawn(1, 'ant:lasius_soldier', 24));
  let share = 0;
  let samples = 0;
  let spread = 0;
  let spreadN = 0;
  for (let s = 0; s < 20; s++) {
    run(w, 20);
    for (const col of [0, 1]) {
      const u = units(w, col);
      const fighting = u.filter((a) => a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Spray);
      if (fighting.length < u.length / 2 || u.length < 6) continue;
      const nn = nnBodyLengths(w, col);
      share += nn.filter((d) => d < 0.5).length / u.length;
      samples++;
      const onAnts = fighting.filter((a) => a.tk === 3 && a.tgt);
      if (onAnts.length >= 8) {
        spread += new Set(onAnts.map((a) => a.tgt)).size / onAnts.length;
        spreadN++;
      }
    }
  }
  const overlap = samples ? share / samples : 1;
  const foes = spreadN ? spread / spreadN : 0;
  check('melee: fighters keep apart (few within half a body of a teammate)', overlap < 0.55, `${(overlap * 100).toFixed(0)} % on average while fighting (88 % before the guard line and fight room)`);
  check('melee: the foes are shared out — attackers spread over many enemies, not one heap', foes >= 0.33, `${(foes * 100).toFixed(0)} distinct targets per 100 attackers (27 before)`);
  // (combat v2: slots by the victim's outline; tests/combatV2.ts checks them in detail)
  const nSlots = antSlotCount({ caste: 'lasius_soldier' } as Ant, casteOf('lasius_soldier').length, false);
  check('melee: few holds on one ant (2–4 on one of the same size, by its outline)', nSlots >= 2 && nSlots <= 4, `${nSlots}`);
}

// ---- creatures keep apart too, and still bite their foes
{
  const { w, cmd } = arena();
  const A = arenaOf(w)!;
  cmd({ type: 'arenaStance', team: 0, stance: STANCE.HOLD });
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.HOLD });
  cmd(spawn(0, 'cr:groundBeetle', 4, { x: A.cx - 120, y: A.cy }));
  run(w, 20 * 4);
  const cr = w.s.creatures.filter((c) => !c.dead && c.faction === A.teams[0].colony);
  let worst = Infinity;
  for (let i = 0; i < cr.length; i++)
    for (let j = i + 1; j < cr.length; j++) worst = Math.min(worst, Math.hypot(cr[i].x - cr[j].x, cr[i].y - cr[j].y) / (creatureHooks.radius(cr[i]) + creatureHooks.radius(cr[j])));
  check('creatures: teammates dropped on one spot spread apart (no two bodies on top of each other)', cr.length === 4 && worst >= BALANCE.separation.creatureAllyRoom * 0.85, `closest pair at ${worst.toFixed(2)} × their radii`);
  const { w: w2, cmd: c2 } = arena();
  const A2 = arenaOf(w2)!;
  c2(spawn(0, 'cr:wolfSpider', 1, { x: A2.cx - 20, y: A2.cy }));
  c2(spawn(1, 'cr:groundBeetle', 1, { x: A2.cx + 20, y: A2.cy }));
  let close = Infinity;
  for (let s = 0; s < 10; s++) {
    run(w2, 20);
    const [a, b] = w2.s.creatures.filter((c) => c.faction >= 0);
    if (a && b && !a.dead && !b.dead) close = Math.min(close, Math.hypot(a.x - b.x, a.y - b.y) / (creatureHooks.radius(a) + creatureHooks.radius(b)));
  }
  const hurt = w2.s.creatures.filter((c) => c.faction >= 0 && (c.dead || c.hp < c.maxHp)).length;
  check('creatures: two foes fight body to body without sinking into each other', close >= 0.9 && hurt === 2, `closest at ${close.toFixed(2)} × their radii; ${hurt} of 2 hurt`);
}

// ---- marker orders: no attacking
{
  const { w, cmd } = arena();
  const A = arenaOf(w)!;
  cmd({ type: 'arenaStance', team: 0, stance: STANCE.HOLD });
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.PASSIVE });
  cmd({ type: 'markerOrder', i: 0, order: 'noAttack', on: true });
  cmd(spawn(0, 'ant:lasius_soldier', 12));
  run(w, 20 * 10);
  const m = w.colony(0)!.markers[0];
  cmd(spawn(1, 'ant:lasius_worker', 4, { x: m.x + 6, y: m.y }));
  let engaged = 0;
  for (let k = 0; k < 20 * 6; k++) {
    run(w, 1);
    engaged = Math.max(engaged, units(w, 0).filter((a) => a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Spray).length);
  }
  check('no attacking: the group lets enemies walk among it and goes after none', engaged === 0 && units(w, 1).length === 4, `${engaged} engaged; ${units(w, 1).length} foes left`);
  // bitten, they bite back
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.CHARGE });
  let back = 0;
  for (let k = 0; k < 20 * 8; k++) {
    run(w, 1);
    back = Math.max(back, units(w, 0).filter((a) => a.state === AS.Attack || a.state === AS.Grapple).length);
  }
  check('no attacking: an ant that is bitten still bites back', back > 0, `${back} fighting back at most`);
  cmd({ type: 'markerOrder', i: 0, order: 'noAttack', on: false });
  run(w, 20 * 10);
  check('no attacking, off again: the group fights as before', units(w, 1).length === 0 && !w.colony(0)!.markers[0].noAttack, `${units(w, 1).length} foes left`);
  void A;
}

// ---- marker orders: no climbing
for (const noClimb of [true, false]) {
  const { w, cmd } = arena();
  const A = arenaOf(w)!;
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.PASSIVE });
  if (noClimb) cmd({ type: 'markerOrder', i: 0, order: 'noClimb', on: true });
  cmd(spawn(1, 'cr:stagBeetle', 1, { x: A.cx, y: A.cy }));
  cmd(spawn(0, 'ant:lasius_soldier', 30));
  let riders = 0;
  for (let s = 0; s < 20; s++) {
    run(w, 20);
    riders = Math.max(riders, w.s.ants.filter((a) => (a.ridePh ?? 0) >= 1).length);
  }
  const beetle = w.s.creatures.find((c) => c.faction === A.teams[1].colony)!;
  if (noClimb) check('no climbing: the group fights a titan from the ground, nobody climbs on', riders === 0 && beetle.hp < beetle.maxHp, `${riders} riding; beetle ${beetle.hp.toFixed(0)}/${beetle.maxHp}`);
  else check('no climbing off: the same group swarms up it', riders > 5, `${riders} riding at most`);
}

// ---- marker orders: no gathering (a normal map: workers at a marker with food lying about)
for (const noGather of [true, false]) {
  const w = createWorld({ seed: 11, style: 'meadow', width: 600, depth: 600, colonies: [{ species: 'lasius', player: true, ai: false, startWorkers: 0 }], food: 0, aphids: 0, settings: { creatures: 0 } }, new EventBus());
  const c = w.colony(0)!;
  const e = c.entrances[0];
  const mx = e.sx + 60;
  const my = e.sy;
  for (let i = 0; i < 6; i++) makeFood(w, 'seed', SURFACE, mx + (i % 3) * 4 - 4, my + Math.floor(i / 3) * 4 - 2, 1);
  for (let i = 0; i < 8; i++) makeAnt(w, 0, 'lasius_worker', SURFACE, e.sx + 4 + i, e.sy + 3, 0);
  w.reindex();
  placeMarker(w, c, 1, SURFACE, mx, my);
  if (noGather) applyCommand(w, { type: 'markerOrder', i: 1, order: 'noGather', on: true, tick: w.s.tick, player: 0, seq: 0 } as Command);
  for (const g of c.groups) if (raisesAnts(g)) assignGroup(w, c, g.id, 1);
  for (const a of w.s.ants) if (a.colony === 0 && a.id !== c.queen && a.space === SURFACE) a.marker = 1;
  let carried = 0;
  for (let k = 0; k < 20 * 40; k++) {
    run(w, 1);
    carried = Math.max(carried, w.s.ants.filter((a) => a.colony === 0 && a.carry === Carry.Food).length);
  }
  if (noGather) check('no gathering: the group stands at the marker and picks nothing up', carried === 0 && w.s.ants.filter((a) => a.colony === 0 && a.marker === 1 && a.state === AS.Rally).length >= 4, `${carried} carrying at most; ${w.s.ants.filter((a) => a.colony === 0 && a.marker === 1 && a.state === AS.Rally).length} in the guard line`);
  else check('no gathering off: the same group carries the food home', carried > 0, `${carried} carrying at most`);
}

// ---- eggs: the queen always has one ready, so every empty brood tile gets a worker fetching its egg at once
{
  const w = createWorld({ seed: 6, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false, startWorkers: 0 }], settings: { creatures: 0 } }, new EventBus());
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const q = w.antById.get(c.queen)!;
  c.food = 500;
  // eight brood tiles on dug floor round the chamber, and 14 free home workers
  const taken = new Set(c.tiles.map((t) => t.q));
  let n = 0;
  for (const t of [...c.tiles])
    for (const h of g.neighbors(t.q)) {
      if (n >= 8 || h < 0 || taken.has(h)) continue;
      if (!g.isHexDug(h)) g.completeHex(h);
      placeTile(w, c, 'brood', h, 'lasius_worker', true);
      taken.add(h);
      n++;
    }
  for (let i = 0; i < 14; i++) makeAnt(w, 0, 'lasius_worker', q.space, q.x + 6 + (i % 4), q.y + 4 + Math.floor(i / 4), 0);
  w.reindex();
  let fetching = 0;
  const seen = new Set<number>();
  for (let k = 0; k < 20 * 20; k++) {
    run(w, 1);
    const now = w.s.ants.filter((a) => a.colony === 0 && a.task === 'job' && a.jobK === JOB.Spawn);
    fetching = Math.max(fetching, now.length);
    for (const b of w.s.brood) if (b.colony === 0) seen.add(b.id);
  }
  const filled = c.tiles.filter((t) => t.type === 'brood' && t.brood).length;
  check('eggs: every empty brood tile gets a free worker fetching its egg from the queen at once (not a couple at a time)', n === 8 && fetching >= 7 && filled >= 8, `${n} empty tiles; ${fetching} workers fetching eggs at once (at most eggs on hand + 2 before); ${filled} tiles with brood after 20 s`);
}

// ---- the Home column's orders (user note 2026-10-25: "in nest jobs too")
{
  const w = createWorld({ seed: 6, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false, startWorkers: 0 }, { species: 'formica', player: false, ai: false, startWorkers: 0 }], settings: { creatures: 0 } }, new EventBus());
  const c = w.colony(0)!;
  const q = w.antById.get(c.queen)!;
  const order = (o: 'noAttack' | 'noGather' | 'noClimb', on: boolean, i = -1) => applyCommand(w, { type: 'markerOrder', i, order: o, on, tick: w.s.tick, player: 0, seq: 0 } as Command);
  check('Home orders: set through the same command (marker −1), round the wire format', order('noAttack', true) === null && !!c.homeOrders?.noAttack && JSON.stringify(decodeCommandLog(encodeCommandLog([{ type: 'markerOrder', i: -1, order: 'noGather', on: true, tick: 1, player: 0, seq: 0 } as Command]))[0]) === JSON.stringify({ type: 'markerOrder', i: -1, order: 'noGather', on: true, tick: 1, player: 0, seq: 0 }));
  const homeAnts: number[] = [];
  for (let i = 0; i < 6; i++) homeAnts.push(makeAnt(w, 0, 'lasius_soldier', q.space, q.x + 14 + i, q.y + 6, 0).id);
  const foe = makeAnt(w, 1, 'formica_worker', q.space, q.x + 18, q.y + 9, 0);
  foe.v = 0;
  w.reindex();
  let engaged = 0;
  for (let k = 0; k < 20 * 4; k++) {
    foe.x = q.x + 18;
    foe.y = q.y + 9;
    foe.state = AS.Idle;
    foe.tgt = 0;
    run(w, 1);
    engaged = Math.max(engaged, homeAnts.filter((id) => { const a = w.antById.get(id)!; return a.state === AS.Attack || a.state === AS.Grapple; }).length);
  }
  check('Home "no attacking": home soldiers leave an intruder standing among them alone', engaged === 0, `${engaged} engaged`);
  order('noAttack', false);
  let fought = 0;
  for (let k = 0; k < 20 * 4; k++) {
    run(w, 1);
    fought = Math.max(fought, homeAnts.filter((id) => { const a = w.antById.get(id); return a && (a.state === AS.Attack || a.state === AS.Grapple); }).length);
  }
  check('Home "no attacking" off: they go for it', fought > 0 || foe.state === AS.Dead, `${fought} engaged`);
  // no gathering at home: seeds lying on the nest floor stay there
  order('noGather', true);
  for (let i = 0; i < 4; i++) makeFood(w, 'seed', q.space, q.x + 10 + i * 2, q.y - 8, 1);
  for (let i = 0; i < 6; i++) makeAnt(w, 0, 'lasius_worker', q.space, q.x + 6 + i, q.y - 4, 0);
  w.reindex();
  let hauled = 0;
  for (let k = 0; k < 20 * 20; k++) {
    run(w, 1);
    hauled = Math.max(hauled, w.s.ants.filter((a) => a.colony === 0 && a.carry === Carry.Food).length);
  }
  check('Home "no gathering": nobody carries the food on the nest floor to the stores', hauled === 0, `${hauled} carrying at most`);
  order('noGather', false);
  for (let k = 0; k < 20 * 20; k++) {
    run(w, 1);
    hauled = Math.max(hauled, w.s.ants.filter((a) => a.colony === 0 && a.carry === Carry.Food).length);
  }
  check('Home "no gathering" off: the workers haul it', hauled > 0, `${hauled} carrying at most`);
}

// ---- the order command: wire format, refusals, replay
{
  const { w, cmd, log } = arena();
  check('markerOrder: refused for a bad marker or order', cmd({ type: 'markerOrder', i: 9, order: 'noAttack', on: true }) !== null && cmd({ type: 'markerOrder', i: -2, order: 'noAttack', on: true }) !== null && cmd({ type: 'markerOrder', i: 0, order: 'noFly' as never, on: true }) !== null);
  cmd({ type: 'markerOrder', i: 2, order: 'noGather', on: true });
  cmd({ type: 'markerOrder', i: 4, order: 'noClimb', on: true });
  const back = decodeCommandLog(encodeCommandLog(log)).filter((c) => c.type === 'markerOrder');
  check('markerOrder: survives the wire format', JSON.stringify(back.slice(-2).map((c) => c.type === 'markerOrder' && [c.i, c.order, c.on])) === JSON.stringify([[2, 'noGather', true], [4, 'noClimb', true]]));
  const m = w.colony(0)!.markers;
  check('markerOrder: sets the marker state (saved with the world)', !!m[2].noGather && !!m[4].noClimb && !m[0].noAttack && hashState(w).length > 0);
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all fight tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
