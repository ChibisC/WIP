/**
 * Tests for the 2026-10-25 bug-fix release (CHANGE_PLAN §15): no spinning in
 * combat, soft separation, climbing large creatures, timed corpses, harvest,
 * still and passive queens, the termite king, eggs pulled from the queen, AI
 * colonies keeping workers home. Part of `npm test`.
 *
 *   npx vite-node tests/combat.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { Ant, AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { BALANCE } from '../src/sim/balance';
import { CASTES } from '../src/sim/species';
import { climbCap, climbRoom, riderUnits } from '../src/sim/creatures/climb';
import { damageAnt } from '../src/sim/combat';
import { killAnt } from '../src/sim/antAI';
import { assignGroup, placeMarker } from '../src/sim/markers';
import { makeFood } from '../src/sim/factory';
import { hashState } from '../src/sim/snapshot';
import { battleStats, beetleRing, openGround, tunnelFlow } from '../tools/spinScenes';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const t0 = Date.now();

// ---------------------------------------------------------------- part 1: spinning, slots, separation
{
  const b = battleStats(50, 25, 7);
  check('spinning: in a 50 v 50 battle almost no ant turns a full circle one way within 3 s', b.spinners <= 3, `${b.spinners} of ${b.fighters}`);
  check('spinning: fighting ants turn slowly on average (was 953°/s)', b.turnRate * 57.3 < 90, `${(b.turnRate * 57.3).toFixed(0)}°/s`);
  check('separation: few ants overlap in the battle (was 17 pairs a sample)', b.overlapPairs < 11, b.overlapPairs.toFixed(1));
  const r = beetleRing(30, 7);
  check('slots: 30 ants on a beetle take its 12 slots and do not spin', r.latched === 12 && r.spinners === 0, `${r.latched} latched, ${r.spinners} spun`);
  check('separation: no two ants on the beetle stacked', r.stacked === 0, `${r.stacked}`);
  const t = tunnelFlow(60, 40, 7);
  check('tunnels: 60 workers squeeze out of a crowded nest', t.out === 60 && t.meanT < 9, `${t.out} out, mean ${t.meanT.toFixed(1)} s`);
}

// ---------------------------------------------------------------- part 2: climbing
function climbScene(kind: string, n: number, seed = 7, caste = 'lasius_worker'): { w: ReturnType<typeof createWorld>; ants: Ant[]; cr: ReturnType<typeof spawnCreature> } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w);
  const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e6;
  const ants: Ant[] = [];
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, 0, caste, SURFACE, p.x - 30 + (i % 6) * 4, p.y - 14 + Math.floor(i / 6) * 6, 0);
    a.task = 'guard';
    a.alarm = 1;
    a.tgt = cr.id;
    a.tk = 4;
    a.state = AS.Attack;
    a.cd2 = 1e6;
    ants.push(a);
  }
  w.reindex();
  return { w, ants, cr };
}

{
  // one ant's cycle: to the leg, up 1.5 s, ride 8 s, down 1.5 s, 6 s on the ground
  // (a stag beetle has room for all; held still so nobody dies and the timings are clean)
  const { w, ants, cr } = climbScene('stagBeetle', 8);
  cr.stun = 1e9;
  let t0 = 0;
  let watch: Ant | null = null;
  const at: Record<string, number> = {};
  let lastPh = -2;
  let hurt = 0;
  let maxRiders = 0;
  for (let t = 0; t < 30 * 20; t++) {
    const before = ants.map((a) => a.hp);
    w.step(0.05);
    w.events.drain();
    ants.forEach((a, i) => {
      if (a.state === AS.Climb && (a.ridePh ?? 0) >= 1 && a.hp < before[i]) hurt += before[i] - a.hp;
    });
    if (!watch) {
      watch = ants.find((a) => a.state === AS.Climb) ?? null;
      if (watch) t0 = watch.rideT ?? 0;
    }
    if (watch) {
      const ph = watch.state === AS.Climb ? watch.ridePh! : -1;
      if (ph !== lastPh) {
        const key = ph === -1 ? (at.down !== undefined ? (at.off === undefined ? 'off' : at.again === undefined && 'never') : 'x') : ph === 0 ? (at.off !== undefined ? 'again' : 'walk') : ['walk', 'up', 'ride', 'down'][ph];
        if (key && at[key] === undefined) at[key] = t / 20;
        lastPh = ph;
      }
    }
    maxRiders = Math.max(maxRiders, cr.climbers ?? 0);
  }
  const up = at.ride - at.up;
  const ride = at.down - at.ride;
  const down = at.off - at.down;
  // up the leg takes 1.5 s from the foot (less when it gets on higher up a long leg)
  check('climbing: up the leg in 1.5 s from where it got on, 8 s riding, 1.5 s down to the foot', Math.abs(up - (1 - t0) * 1.5) < 0.12 && Math.abs(ride - 8) < 0.1 && Math.abs(down - 1.5) < 0.1, `got on at ${t0.toFixed(2)}, up ${up?.toFixed(2)} ride ${ride?.toFixed(2)} down ${down?.toFixed(2)}`);
  check('climbing: then 6 s on the ground before climbing again', at.again !== undefined && at.again - at.off >= 6 - 0.06 && at.again - at.off < 8, `again after ${(at.again - at.off).toFixed(2)} s`);
  check('climbing: riders take no damage from anyone during the climb', hurt === 0, `${hurt}`);
  check('climbing: every ant of a small party gets on a big creature', maxRiders >= 6, `${maxRiders} of 8`);
}

{
  // the cap holds with many ants; the rest fight from the ground
  const { w, ants, cr } = climbScene('stagBeetle', 70);
  let maxRiders = 0;
  let ground = 0;
  for (let t = 0; t < 12 * 20; t++) {
    w.step(0.05);
    w.events.drain();
    maxRiders = Math.max(maxRiders, cr.climbers ?? 0);
    if (t === 12 * 20 - 1) ground = ants.filter((a) => a.state === AS.Grapple || a.state === AS.Attack).length;
  }
  check('climbing: a stag beetle takes at most its cap of riders; the rest fight on the ground', maxRiders === climbCap(cr) && maxRiders >= 24 && ground > 10, `${maxRiders} riding at most of ${climbCap(cr)}, ${ground} on the ground`);
  // direct hits on a rider do nothing; others can't even target it
  const r = ants.find((a) => a.state === AS.Climb && (a.ridePh ?? 0) >= 1);
  if (r) {
    const hp = r.hp;
    damageAnt(w, r, 50, 'bite', null);
    check('climbing: a rider ignores direct damage', r.hp === hp);
  } else check('climbing: a rider ignores direct damage', false, 'no rider');
  // the creature dies: every rider drops off beside it, unhurt, and carries on
  const riders = ants.filter((a) => a.state === AS.Climb && (a.ridePh ?? 0) >= 1);
  const hp0 = riders.map((a) => a.hp);
  // a sliver of health left: the next bite kills it
  cr.hp = 0.001;
  for (let t = 0; t < 3 * 20; t++) {
    w.step(0.05);
    w.events.drain();
  }
  const dropped = riders.filter((a) => a.state !== AS.Climb && (a.rideId ?? 0) === 0);
  check('climbing: when the creature dies every rider drops off and carries on, unhurt', cr.dead && riders.length >= 3 && dropped.length === riders.length && riders.every((a, i) => a.hp >= hp0[i] - 1e-9 || a.state === AS.Dead), `${dropped.length}/${riders.length} dropped, dead ${cr.dead}`);
}

{
  // size classes: bigger ants take more room on a creature's back
  const most = (kind: string, caste: string): number => {
    const { w, cr } = climbScene(kind, 12, 7, caste);
    let m = 0;
    for (let t = 0; t < 10 * 20; t++) {
      w.step(0.05);
      w.events.drain();
      m = Math.max(m, cr.climbers ?? 0);
    }
    return m;
  };
  const units = ['lasius_worker', 'formica_worker', 'formica_soldier', 'atta_major'].map((c) => riderUnits(CASTES[c].length));
  check('size classes: a small worker takes 1 unit of room, a Formica worker 2, a Formica soldier 3, an Atta major 4', units.join() === '1,2,3,4', units.join());
  const beetle = climbScene('groundBeetle', 0).cr;
  const small = most('groundBeetle', 'lasius_worker');
  const mid = most('groundBeetle', 'formica_worker');
  const big = most('groundBeetle', 'formica_soldier');
  const huge = most('groundBeetle', 'atta_major');
  check('climbing: the ground beetle (16 mm) carries at most 3 small workers', small === 3 && climbCap(beetle) === 3, `${small}`);
  check('size classes: a ground beetle (room 3) carries 3 small workers, 1 Formica worker or soldier, and no Atta major', climbRoom(beetle) === 3 && small === 3 && mid === 1 && big === 1 && huge === 0, `room ${climbRoom(beetle)}: ${small} / ${mid} / ${big} / ${huge}`);
}

{
  // determinism: the same climbing fight twice gives the same state
  const hashes: string[] = [];
  for (let k = 0; k < 2; k++) {
    const { w } = climbScene('tarantula', 40, 3);
    for (let t = 0; t < 20 * 20; t++) {
      w.step(0.05);
      w.events.drain();
    }
    hashes.push(hashState(w));
  }
  check('climbing: deterministic (two runs, same state hash)', hashes[0] === hashes[1], hashes.join(' '));
  // riders follow size: the back's area ÷ the room an ant takes (at most maxRiders)
  const caps: Record<string, number> = {};
  for (const k of ['groundBeetle', 'rove', 'wolfSpider', 'cutworm', 'mantis', 'lithobius', 'stagBeetle', 'tarantula', 'hogna', 'giantMantis', 'scolopendra']) caps[k] = climbCap(climbScene(k, 0).cr);
  check('climbing: every large creature and titan can be climbed, riders by size', Object.values(caps).every((n) => n > 0) && caps.groundBeetle <= 3 && caps.wolfSpider <= 3 && caps.mantis > caps.groundBeetle && caps.stagBeetle === BALANCE.climb.maxRiders && caps.cutworm > caps.lithobius, JSON.stringify(caps));
}

// ---------------------------------------------------------------- corpses (timed food) and harvest
function fieldScene(seed = 7): { w: ReturnType<typeof createWorld>; p: { x: number; y: number } } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  w.s.food.length = 0;
  w.reindex();
  return { w, p: openGround(w) };
}
const steps = (w: ReturnType<typeof createWorld>, sec: number) => {
  for (let t = 0; t < Math.round(sec * 20); t++) {
    w.step(0.05);
    w.events.drain();
  }
};
{
  const C = BALANCE.corpse;
  const { w, p } = fieldScene();
  const dead = makeAnt(w, 0, 'lasius_worker', SURFACE, p.x, p.y, 0);
  const friend = makeAnt(w, 0, 'lasius_worker', SURFACE, p.x + 3, p.y, Math.PI);
  friend.task = 'forage';
  w.reindex();
  killAnt(w, dead);
  steps(w, C.antFall + 0.1);
  const f = w.s.food.find((x) => x.kind === 'corpse');
  check('corpses: a dead ant becomes food after it falls over', !!f && f.sinkAt === C.antFood, f ? `sinkAt ${f.sinkAt}` : 'none');
  steps(w, C.antFood - 0.2);
  check('corpses: its own colony does not take it', !!f && !f.heldBy && friend.carry === 0);
  steps(w, 0.4 + C.sink);
  check(`corpses: after ${C.antFood} s it sinks into the ground and is deleted`, !w.s.food.some((x) => x.id === f?.id));
  // an enemy takes one
  const g = fieldScene(3);
  const d2 = makeAnt(g.w, 0, 'lasius_worker', SURFACE, g.p.x, g.p.y, 0);
  const enemy = makeAnt(g.w, 1, 'formica_worker', SURFACE, g.p.x + 4, g.p.y, Math.PI);
  // a forager out at a marker (EotU: foraging is by groups sent to markers)
  const R = g.w.colony(1)!;
  const chamber = R.tiles.find((t) => t.type === 'queen')!;
  enemy.tile = chamber.q;
  enemy.task = 'marker';
  enemy.marker = 0;
  placeMarker(g.w, R, 0, SURFACE, g.p.x, g.p.y);
  assignGroup(g.w, R, chamber.group, 0);
  g.w.reindex();
  killAnt(g.w, d2);
  let took = false;
  for (let t = 0; t < (C.antFall + C.antFood + 2) * 20; t++) {
    g.w.step(0.05);
    g.w.events.drain();
    const cf = g.w.s.food.find((x) => x.kind === 'corpse');
    if (cf && cf.heldBy === enemy.id) took = true;
  }
  check('corpses: an enemy picks the dead ant up as food within the 2 s and carries it off', took);
  // termites last 7 s
  const h = fieldScene(5);
  const tm = makeAnt(h.w, 0, 'nasute_worker', SURFACE, h.p.x, h.p.y, 0);
  h.w.reindex();
  killAnt(h.w, tm);
  steps(h.w, C.antFall + 0.1);
  const tf = h.w.s.food.find((x) => x.kind === 'corpse');
  steps(h.w, C.termiteFood - 0.3);
  const still = !!tf && h.w.s.food.some((x) => x.id === tf.id) && tf.amount > 0;
  steps(h.w, 0.5 + C.sink);
  check(`corpses: a dead termite stays food for ${C.termiteFood} s, then sinks and is gone`, still && !h.w.s.food.some((x) => x.id === tf?.id), `still ${still}`);
}
{
  // harvest: each ant takes its caste's carry × level from a big item; nobody hauls it together
  const take = (level: number): number => {
    const { w, p } = fieldScene(9);
    const big = makeFood(w, 'insect', SURFACE, p.x, p.y, 4);
    big.amount = big.max = 60;
    big.mass = 40;
    const a = makeAnt(w, 0, 'lasius_worker', SURFACE, p.x - 6, p.y, 0);
    a.level = level;
    a.task = 'forage';
    w.reindex();
    for (let t = 0; t < 10 * 20 && a.carry === 0; t++) {
      a.task = 'forage';
      w.step(0.05);
      w.events.drain();
    }
    return a.carryAmt;
  };
  const carry = CASTES.lasius_worker.carry;
  const got = [1, 2, 3].map(take);
  check('harvest: a worker takes its carry × level from a big item (×1, ×1.25, ×1.5)', got.every((g, i) => Math.abs(g - carry * BALANCE.levelCarry[i]) < 1e-6), got.map((g) => g.toFixed(2)).join(' / '));
  const { w, p } = fieldScene(9);
  const crumb = makeFood(w, 'crumb', SURFACE, p.x, p.y, 0.8);
  const a = makeAnt(w, 0, 'lasius_worker', SURFACE, p.x - 6, p.y, 0);
  a.task = 'forage';
  w.reindex();
  for (let t = 0; t < 10 * 20 && a.carry === 0; t++) {
    a.task = 'forage';
    w.step(0.05);
    w.events.drain();
  }
  check('harvest: a small item it can lift is carried whole', a.carryId === crumb.id, `${a.carryId} vs ${crumb.id}`);
  check('harvest: no co-op hauling state is used', !w.s.ants.some((x) => x.state === AS.CoopCarry));
}

// ---------------------------------------------------------------- queens, the termite king, eggs, AI nests
{
  // every queen stays put and never fights back, even with enemies biting her
  const w = createWorld({ seed: 4, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  const c = w.colony(0)!;
  const q = w.antById.get(c.queen)!;
  const x0 = q.x;
  const y0 = q.y;
  const hp0 = q.hp;
  for (let i = 0; i < 4; i++) {
    const e = makeAnt(w, 1, 'lasius_worker', q.space, q.x + 6 + i, q.y + 2, Math.PI);
    e.state = AS.Attack;
    e.tgt = q.id;
    e.tk = 3;
    e.alarm = 1;
  }
  w.reindex();
  let fought = false;
  for (let t = 0; t < 20 * 20; t++) {
    w.step(0.05);
    w.events.drain();
    if (q.state === AS.Attack || q.state === AS.Grapple || q.cd > 0) fought = true;
  }
  check('queens: she never moves and never fights back, she only takes the damage', q.x === x0 && q.y === y0 && !fought && q.hp < hp0, `moved ${Math.hypot(q.x - x0, q.y - y0).toFixed(3)} mm, fought ${fought}, hp ${hp0.toFixed(0)} → ${q.hp.toFixed(0)}`);
}
{
  // the termite king: beside the queen (not on her), never a target; eggs pulled from her abdomen
  const w = createWorld({ seed: 4, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'nasutitermes', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  const c = w.colony(0)!;
  const q = w.antById.get(c.queen)!;
  const k = w.antById.get(c.king!)!;
  const intruder = makeAnt(w, 1, 'lasius_soldier', q.space, k.x + 3, k.y, Math.PI);
  intruder.alarm = 1;
  w.reindex();
  let targeted = false;
  let minGap = Infinity;
  for (let t = 0; t < 30 * 20; t++) {
    w.step(0.05);
    w.events.drain();
    if (intruder.tgt === k.id && (intruder.state === AS.Attack || intruder.state === AS.Grapple)) targeted = true;
    if (t > 100) minGap = Math.min(minGap, Math.hypot(k.x - q.x, k.y - q.y));
  }
  check('termite king: never targeted by intruders (they go for the queen)', !targeted);
  check('termite king: stands beside the queen, a separate body, not inside her', minGap > CASTES.nasute_queen.length * 0.2, `${minGap.toFixed(1)} mm from her`);
}
{
  // eggs: the queen holds them inside; a worker walks to the tip of her abdomen and pulls one out
  const w = createWorld({ seed: 6, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  const c = w.colony(0)!;
  const q = w.antById.get(c.queen)!;
  const L = CASTES[q.caste].length;
  let pulled: { x: number; y: number } | null = null;
  const seenEgg = new Set(w.s.brood.map((b) => b.id));
  for (let t = 0; t < 60 * 20 && !pulled; t++) {
    w.step(0.05);
    w.events.drain();
    for (const b of w.s.brood) {
      if (seenEgg.has(b.id)) continue;
      seenEgg.add(b.id);
      if (b.stage === 0 && b.carrier) pulled = { x: b.x, y: b.y };
    }
  }
  const tipX = q.x - Math.cos(q.h) * L * 0.5;
  const tipY = q.y - Math.sin(q.h) * L * 0.5;
  check('eggs: a worker pulls each egg from the tip of the queen\'s abdomen (no pile beside her)', !!pulled && Math.hypot(pulled.x - tipX, pulled.y - tipY) < L * 0.25 && c.eggs <= BALANCE.eggPileMax, pulled ? `${Math.hypot(pulled.x - tipX, pulled.y - tipY).toFixed(2)} mm from the tip` : 'no egg taken');
}
{
  // AI colonies keep the queen's group and about a third of the workers home on nest jobs
  const w = createWorld({ seed: 7, style: 'meadow', width: 900, depth: 900, colonies: [{ species: 'lasius', player: true, ai: true, popLimit: 300 }], food: 1 }, new EventBus());
  let minHome = 1;
  for (let m = 0; m < 10; m++) {
    for (let t = 0; t < 60 * 20; t++) w.step(0.05);
    w.events.drain();
    if (m < 4) continue;
    const c = w.colony(0)!;
    const workers = w.s.ants.filter((a) => a.colony === 0 && a.state !== AS.Dead && a.id !== c.queen && CASTES[a.caste].role !== 'soldier');
    const home = workers.filter((a) => a.marker < 0).length;
    minHome = Math.min(minHome, home / Math.max(1, workers.length));
  }
  check('AI nests: the queen\'s group and about a third of the workers always stay home', minHome >= 0.25 && minHome <= 0.6, `at least ${(minHome * 100).toFixed(0)} % home (minutes 5–10)`);
}

console.log(`\n${failed ? failed + ' FAILED' : 'all combat tests passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
