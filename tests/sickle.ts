/**
 * Headless tests for the Sickle-Jaw Termites (claude/sickle-jaw-termites/implement-sickle-jaw-termites.md §9):
 * the acid ramp, the grab-and-squirt hold (immobile victim, ends only with a death, freeing by killing
 * the soldier), one soldier per victim, the size limit and the free attack, a missed lunge, the alarm,
 * the king, food, and 10-minute determinism.
 *   npx vite-node tests/sickle.ts
 */
import { EventBus, SimEvent } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Ant, AS, SURFACE, nestSpace } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { damageAnt } from '../src/sim/combat';
import { killAnt } from '../src/sim/antAI';
import { SICKLE } from '../src/sim/balance';
import { CASTES, casteOf } from '../src/sim/species';
import { hashState } from '../src/sim/snapshot';
import { LUNGE_TICKS, sickleRampDamage, sickleRampTotal } from '../src/sim/sickleJaws';
import { assignGroup, placeMarker } from '../src/sim/markers';
import { guardScene } from '../tools/sickleGuardScene';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) w.step(0.05);
};
/** events since the last call (the bus delivers them on drain) */
function events(w: World): SimEvent[] {
  const box = w as unknown as { _ev?: SimEvent[] };
  if (!box._ev) {
    box._ev = [];
    w.events.onAny((e) => box._ev!.push(e));
  }
  w.events.drain();
  const out = box._ev;
  box._ev = [];
  return out;
}
function world(seed = 5, ai = false): World {
  return createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'rhynchotermes', player: true, ai }, { species: 'lasius', player: false, ai }], settings: { creatures: 0 } }, new EventBus());
}
/** An open patch of ground away from the nests. */
function arena(w: World): { x: number; y: number } {
  for (let k = 0; k < 400; k++) {
    const x = 200 + (k % 20) * 15;
    const y = 200 + Math.floor(k / 20) * 15;
    let ok = true;
    for (let dx = -40; dx <= 70 && ok; dx += 2) for (let dy = -10; dy <= 60 && ok; dy += 5) if (!w.walkable(SURFACE, x + dx, y + dy)) ok = false;
    if (ok) return { x, y };
  }
  return { x: 350, y: 350 };
}
/** a target that stands still and never fights back on its own */
function dummy(w: World, colony: number, caste: string, x: number, y: number, hp: number): Ant {
  const t = makeAnt(w, colony, caste, SURFACE, x, y, Math.PI);
  t.hp = t.maxHp = hp;
  t.task = 'guard';
  return t;
}
function soldierAt(w: World, x: number, y: number, tgt: Ant): Ant {
  const s = makeAnt(w, 0, 'rhy_soldier', SURFACE, x, y, 0);
  s.task = 'guard';
  s.state = AS.Attack;
  s.tgt = tgt.id;
  s.tk = 3;
  return s;
}
const L = CASTES.rhy_soldier.length;

// ---------------------------------------------------------------- the ramp
check('ramp: 18 / 60 / 132 HP after 3 / 6 / 10 s of squirting (the user\'s 2 → 18 DPS over 6 s)', sickleRampTotal(60) === 18 && sickleRampTotal(120) === 60 && sickleRampTotal(200) === 132, `${sickleRampTotal(60)} / ${sickleRampTotal(120)} / ${sickleRampTotal(200)}`);
{
  let sum = 0;
  for (let n = 0; n < 200; n++) sum += sickleRampDamage(n);
  check('ramp: the per-tick acid adds up exactly (1/1024 HP steps, no drift)', sum === 132, `${sum}`);
}
check('lunge: the grab resolves 6 ticks in (round(0.58 × 0.55 s × 20))', LUNGE_TICKS === 6);

// ---------------------------------------------------------------- the hold
{
  const w = world();
  const p = arena(w);
  const v = dummy(w, 1, 'lasius_worker', p.x + 6, p.y, 90);
  v.state = AS.Attack; // it would bite if it could
  const s = soldierAt(w, p.x, p.y, v);
  w.reindex();
  let grabTick = -1;
  let deathTick = -1;
  let moved = 0;
  let attacked = false;
  let hpAfterBite = 0;
  let lungeTicks = -1;
  let x0 = 0;
  let y0 = 0;
  for (let t = 0; t < 400 && deathTick < 0; t++) {
    run(w, 1);
    for (const e of events(w)) if (e.t === 'grab' && grabTick < 0) {
      grabTick = t;
      hpAfterBite = v.hp;
      x0 = v.x;
      y0 = v.y;
    }
    if (s.state === AS.Snap && lungeTicks < 0) lungeTicks = t;
    if (grabTick >= 0 && (v.state as AS) !== AS.Dead) {
      moved = Math.max(moved, Math.hypot(v.x - x0, v.y - y0));
      if (v.cd > 0 && v.cd < 0.05) attacked = true;
    }
    if ((v.state as AS) === AS.Dead) deathTick = t;
  }
  check('grab: the soldier lunges and hooks a worker-sized ant (bite 3 on the snap)', grabTick >= 0 && grabTick - lungeTicks === LUNGE_TICKS && hpAfterBite === 87, `lunge ${lungeTicks}, grab ${grabTick}, hp ${hpAfterBite}`);
  check('hold: the victim cannot move or attack while held', moved < 0.01 && !attacked, `moved ${moved.toFixed(3)} mm`);
  check('hold: a 90 HP victim (3 from the bite) dies on squirt tick 150 (7.5 s)', deathTick - grabTick === 150, `${deathTick - grabTick} squirt ticks`);
  run(w, 2);
  check('hold: when the victim dies the soldier drops it, its ramp reset, free for a new target', s.holdId === 0 && s.state !== AS.Hold && (s.rampN ?? 0) === 0 && v.heldBy === 0);
}
{
  // nothing ends a hold but a death: hurt, stunned, ordered elsewhere
  const w = world();
  const p = arena(w);
  const v = dummy(w, 1, 'lasius_worker', p.x + 6, p.y, 1e6);
  const s = soldierAt(w, p.x, p.y, v);
  w.reindex();
  for (let t = 0; t < 40 && v.heldBy !== s.id; t++) run(w, 1);
  const held = v.heldBy === s.id;
  const foe = dummy(w, 1, 'lasius_soldier', p.x - 4, p.y, 50);
  w.reindex();
  damageAnt(w, s, 1, 'bite', foe);
  killAnt(w, foe); // (it would kill the soldier otherwise)
  s.stun = 1;
  const c = w.colony(0)!;
  placeMarker(w, c, 0, SURFACE, p.x + 80, p.y + 40);
  const g = c.groups.find((gr) => gr.caste === 'rhy_soldier');
  if (g) assignGroup(w, c, g.id, 0);
  s.marker = 0;
  s.task = 'marker';
  run(w, 100);
  check('hold: it never lets go when hurt, stunned or ordered away (only a death ends it)', held && v.heldBy === s.id && s.state === AS.Hold && s.holdId === v.id, `state ${AS[s.state]}`);
  const before = s.rampN ?? 0;
  killAnt(w, s);
  run(w, 1);
  check('rescue: killing the soldier frees its victim the next tick', v.heldBy === 0 && v.state !== AS.Dead && before > 0);
}
{
  // one soldier per victim: two soldiers on one target in the same tick → the lower id wins
  const w = world();
  const p = arena(w);
  const v = dummy(w, 1, 'lasius_worker', p.x + 6, p.y, 1e6);
  const v2 = dummy(w, 1, 'lasius_worker', p.x + 6, p.y + 12, 1e6);
  const a = soldierAt(w, p.x, p.y + 2, v);
  const b = soldierAt(w, p.x, p.y - 2, v);
  w.reindex();
  for (let t = 0; t < 120; t++) run(w, 1);
  check('one soldier per victim: the lower id grabs it, the other takes another target', v.heldBy === a.id && v2.heldBy === b.id, `v held by ${v.heldBy} (a ${a.id}), v2 by ${v2.heldBy} (b ${b.id})`);
}
{
  // the size limit and the free attack
  const big = Object.values(CASTES).find((c) => c.species !== 'rhynchotermes' && c.role !== 'queen' && c.role !== 'king' && !c.termite && c.length > SICKLE.grab.maxTargetSizeMul * L)!;
  const w = world();
  const p = arena(w);
  const v = dummy(w, 1, big.id, p.x + 8, p.y, 1e6);
  v.task = 'idle';
  const s = soldierAt(w, p.x, p.y, v);
  w.reindex();
  let grabbed = false;
  let maxRamp = 0;
  for (let t = 0; t < 120; t++) {
    run(w, 1);
    if (v.heldBy === s.id || s.state === AS.Snap) grabbed = true;
    maxRamp = Math.max(maxRamp, s.rampN ?? 0);
    if (v.state !== AS.Idle && v.state !== AS.Attack) v.state = AS.Idle;
  }
  check(`size limit: a ${big.length} mm ${big.id} (over 2 × ${L} mm) is not grabbed; it is bitten and squirted while free`, !grabbed && maxRamp > 20 && v.hp < v.maxHp, `ramp ticks ${maxRamp}`);
  // out of range: the ramp resets
  v.x += 60;
  run(w, 1);
  check('free attack: the ramp resets as soon as the target is out of range', (s.rampN ?? 0) === 0);
  check('free attack: the big target can still move and fight (it is not held)', !v.heldBy && v.stun <= 0, `stun ${v.stun.toFixed(2)}`);
}
{
  // a missed lunge: the target leaves range before the snap
  const w = world();
  const p = arena(w);
  const v = dummy(w, 1, 'lasius_worker', p.x + 6, p.y, 1e6);
  const s = soldierAt(w, p.x, p.y, v);
  w.reindex();
  let missed = false;
  for (let t = 0; t < 30 && !missed; t++) {
    run(w, 1);
    if (s.state === AS.Snap && s.st > 0.1) v.x = p.x + 40; // it slips away mid-lunge
    for (const e of events(w)) if (e.t === 'grabMiss') missed = true;
  }
  check('lunge miss: the target slipped away before the snap → a miss and a 1 s cooldown', missed && !v.heldBy && (s.snapCd ?? 0) > 0.85, `cooldown ${(s.snapCd ?? 0).toFixed(2)}`);
}
{
  // the alarm: only the colony's termites within 12 soldier lengths; markers keep their orders
  const w = world();
  const p = arena(w);
  const near = makeAnt(w, 0, 'rhy_soldier', SURFACE, p.x + 20, p.y + 20, 0);
  const far = makeAnt(w, 0, 'rhy_soldier', SURFACE, p.x + 12 * L + 30, p.y, 0);
  const other = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x + 10, p.y + 30, 0);
  const worker = makeAnt(w, 0, 'rhy_worker', SURFACE, p.x, p.y, 0);
  const foe = dummy(w, 1, 'lasius_soldier', p.x - 3, p.y, 50);
  for (const o of [near, far, other, worker]) o.task = 'guard';
  w.reindex();
  run(w, 1); // (the spatial index is built at the start of a tick)
  damageAnt(w, worker, 0.5, 'bite', foe);
  const now = w.s.tick;
  check('alarm: a termite attacked alerts its colony\'s termites within 12 soldier lengths only', (near.alertUntil ?? 0) > now && (far.alertUntil ?? 0) <= now && (other.alertUntil ?? 0) <= now);
}
{
  // the king: no damage while the queen lives; dies with her
  const w = world();
  const c = w.colony(0)!;
  const k = w.antById.get(c.king!)!;
  const q = w.antById.get(c.queen)!;
  const foe = makeAnt(w, 1, 'lasius_soldier', k.space, k.x + 2, k.y, 0);
  w.reindex();
  const hp0 = k.hp;
  damageAnt(w, k, 50, 'bite', foe);
  const safe = k.hp === hp0;
  killAnt(w, q);
  check('king: a Sickle-Jaw king beside his queen, no damage while she lives, dies with her', casteOf(k.caste).termite === 'king' && casteOf(q.caste).id === 'rhy_queen' && safe && k.state === AS.Dead);
}
{
  // AI: lock attackers down one by one, but at most 60 % of the soldiers in holds, two kept free
  const w = world();
  const p = arena(w);
  const c = w.colony(0)!;
  c.player = false;
  c.ai = true;
  const sols: Ant[] = [];
  for (let k = 0; k < 5; k++) {
    const v = dummy(w, 1, 'lasius_worker', p.x + 7, p.y + k * 9, 1e6);
    sols.push(soldierAt(w, p.x, p.y + k * 9, v));
    dummy(w, 1, 'lasius_worker', p.x - 7, p.y + k * 9, 1e6);
  }
  w.reindex();
  let most = 0;
  for (let t = 0; t < 200; t++) {
    run(w, 1);
    most = Math.max(most, sols.filter((a) => a.state === AS.Hold || a.state === AS.Snap).length);
  }
  check('AI defence: at most 60 % of nearby soldiers in holds, two kept free (they bite and squirt)', most >= 1 && most <= 3, `at most ${most} of 5 holding`);
}
{
  // termites fight and gather like ants (user note 2026-10-25): workers attack enemies, soldiers carry food home
  const w = world();
  const p = arena(w);
  const worker = makeAnt(w, 0, 'rhy_worker', SURFACE, p.x, p.y, 0);
  worker.task = 'guard';
  const foe = dummy(w, 1, 'lasius_worker', p.x + 8, p.y, 1e6);
  w.reindex();
  let attacked = false;
  for (let t = 0; t < 80 && !attacked; t++) {
    run(w, 1);
    if ((worker.state === AS.Attack || worker.state === AS.Grapple) && foe.hp < foe.maxHp) attacked = true;
  }
  check('termite workers attack enemies like ant workers (not only when bitten)', attacked, AS[worker.state]);
  const c = w.colony(0)!;
  const litter = w.s.food.find((f) => f.from === 'litter')!;
  placeMarker(w, c, 0, SURFACE, litter.x, litter.y);
  const qg = c.groups.find((g) => g.type === 'queen')!;
  const qt = c.tiles.find((t) => t.group === qg.id)!;
  assignGroup(w, c, qg.id, 0);
  const sols: Ant[] = [];
  for (let k = 0; k < 3; k++) {
    const a = makeAnt(w, 0, 'rhy_soldier', SURFACE, litter.x + 10 + k * 2, litter.y + 6, 0);
    a.tile = qt.q;
    sols.push(a);
  }
  w.reindex();
  let carried = false;
  for (let t = 0; t < 20 * 60 && !carried; t++) {
    run(w, 1);
    carried = sols.some((a) => a.carry !== 0 && (w.foodById.get(a.carryId)?.from ?? '') === 'litterchip');
  }
  check('termite soldiers gather at a marker like ant soldiers (sickle-jaws chew leaf litter and carry it home)', carried);
}
{
  // the guard line (user notes 2026-10-25): along the route the workers walk, wide, spare soldiers spread along it
  const r = guardScene(24, 30, 19, 75);
  check(
    'guard line: half the sickle-jaws guard and half gather; the guards spread along the whole route, none piled at the entrance',
    r.guards >= 13 && r.gatherers >= 13 && r.atEntrance === 0 && r.arcTo - r.arcFrom > r.trail * 0.6 && r.maxGap < r.trail * 0.2,
    `${r.guards} guards / ${r.gatherers} gathering, ${r.arcFrom.toFixed(0)}–${r.arcTo.toFixed(0)} of ${r.trail.toFixed(0)} mm, gap ${r.maxGap.toFixed(0)} mm`,
  );
  check('guard line: it follows the bends of the route, and the workers walk inside it', r.trail > r.straight + 5 && r.insideFrac > 0.85, `route ${r.trail.toFixed(0)} vs straight ${r.straight.toFixed(0)} mm; ${(100 * r.insideFrac).toFixed(0)} % inside`);
}
{
  // determinism: 10 minutes of sickle-jaws against black garden ants, AI on both sides
  const h = () => {
    const w = world(11, true);
    for (let t = 0; t < 10 * 60 * 20; t++) w.step(0.05);
    return { hash: hashState(w), holds: w.s.ants.filter((a) => a.state === AS.Hold).length, soldiers: w.s.ants.filter((a) => a.caste === 'rhy_soldier' && a.state !== AS.Dead).length };
  };
  const a = h();
  const b = h();
  check('determinism: two 10-minute runs (sickle-jaws vs black garden ants, AI) give the same state hash', a.hash === b.hash, `${a.soldiers} soldiers alive at the end`);
}

console.log(`\n${failed ? failed + ' FAILED' : 'all sickle-jaw tests passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
