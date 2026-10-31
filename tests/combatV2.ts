/**
 * Tests for combat v2 (CHANGE_PLAN §16, project doc claude/combat/02-spec-combat-v2.md): spread-out readable fights
 * (spacing, stopping at reach, slots by perimeter, overflow, duels, repositioning), small ants under large creatures
 * and their feet, creature threat and aimed splash attacks, and EotU-style mounting. Part of `npm test`.
 *
 *   npx vite-node tests/combatV2.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Ant, AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { BALANCE } from '../src/sim/balance';
import { casteOf } from '../src/sim/species';
import { damageAnt, damageCreature, mountBonus } from '../src/sim/combat';
import { killAnt } from '../src/sim/antAI';
import { climbCap, climbDef } from '../src/sim/creatures/climb';
import { separationSystem } from '../src/sim/separation';
import { antOutlineR, antSlotCount, creatureSlotCount, distToCreatureBody, mutualHold } from '../src/sim/slots';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { openGround } from '../tools/spinScenes';
import { duelBattle } from '../tools/duelScenes';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const t0 = Date.now();
const C2 = BALANCE.combat2;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const distToBody = (cr: Parameters<typeof distToCreatureBody>[0], a: Ant) => distToCreatureBody(cr, a.x, a.y);

/** An open meadow with two enemy colonies (Lasius, fire ants) and no creatures. */
function field(seed = 7, species: [string, string] = ['lasius', 'solenopsis']): { w: World; p: { x: number; y: number } } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 0, colonies: [{ species: species[0] as never, player: true, ai: false }, { species: species[1] as never, player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  w.s.food.length = 0;
  w.reindex();
  return { w, p: openGround(w) };
}
function run(w: World, sec: number, each?: () => void): void {
  for (let t = 0; t < Math.round(sec * 20); t++) {
    each?.();
    w.step(0.05);
    w.events.drain();
  }
}
function fighter(w: World, col: number, caste: string, x: number, y: number, h = 0): Ant {
  const a = makeAnt(w, col, caste, SURFACE, x, y, h);
  a.task = 'guard';
  a.alarm = 1;
  a.cd2 = 1e6; // no acid: melee
  return a;
}
/** Only the separation, run `n` times (no other system moves the ants). */
function separateOnly(w: World, n: number): void {
  for (let i = 0; i < n; i++) {
    w.touch();
    w.prepareQueries();
    separationSystem(w, 0.1);
  }
}

// ---------------------------------------------------------------- step 1: spacing
{
  const { w, p } = field();
  const L = casteOf('lasius_worker').length;
  // two allies both fighting (closing in on different foes far away): a personal space apart
  const f1 = fighter(w, 1, 'fire_soldier', p.x + 60, p.y);
  const f2 = fighter(w, 1, 'fire_soldier', p.x + 60, p.y + 30);
  const a = fighter(w, 0, 'lasius_worker', p.x, p.y);
  const b = fighter(w, 0, 'lasius_worker', p.x + 0.8, p.y + 0.3);
  for (const [x, t] of [[a, f1], [b, f2]] as const) {
    x.state = AS.Attack;
    x.tgt = t.id;
    x.tk = 3;
  }
  // two enemies, each going for someone else, nearly on top of each other: only their bodies' radii
  const e1 = fighter(w, 0, 'lasius_worker', p.x, p.y - 40);
  const e2 = fighter(w, 1, 'fire_soldier', p.x + 0.5, p.y - 40.2);
  e1.state = AS.Attack;
  e1.tgt = f1.id;
  e1.tk = 3;
  e2.state = AS.Attack;
  e2.tgt = a.id;
  e2.tk = 3;
  // two allies holding the same foe stand at its slots: not pushed a personal space apart
  const v = fighter(w, 1, 'fire_soldier', p.x - 40, p.y);
  const g1 = fighter(w, 0, 'lasius_worker', p.x - 40 - 3, p.y + 0.4);
  const g2 = fighter(w, 0, 'lasius_worker', p.x - 40 - 3, p.y - 1.6);
  for (const g of [g1, g2]) {
    g.state = AS.Grapple;
    g.gId = v.id;
    g.gKind = 3;
  }
  w.reindex();
  separateOnly(w, 80);
  const S = BALANCE.separation;
  const rad = (c: string) => casteOf(c).length * S.widthOfLength * S.radiusOfWidth;
  const ab = dist(a, b);
  const ee = dist(e1, e2);
  const gg = dist(g1, g2);
  check('spacing: two fighting allies end at least 0.9 × the personal space apart', ab >= 0.9 * C2.personalSpace * L, `${(ab / L).toFixed(2)} body lengths (personal space ${C2.personalSpace})`);
  check('spacing: two enemies not fighting each other keep only their bodies\' radii (lines can meet)', ee >= 0.9 * (rad('lasius_worker') + rad('fire_soldier')) && ee < 0.6 * C2.personalSpace * L, `${ee.toFixed(2)} mm (radii ${(rad('lasius_worker') + rad('fire_soldier')).toFixed(2)} mm)`);
  check('spacing: allies at the slots of one foe are spaced by the slots, not pushed a personal space apart', gg < 0.9 * C2.personalSpace * L, `${(gg / L).toFixed(2)} body lengths`);
}

// ---------------------------------------------------------------- step 2: stop at reach, head to head
{
  const { w, p } = field();
  const a = fighter(w, 0, 'lasius_worker', p.x - 10, p.y, 0);
  const b = fighter(w, 1, 'fire_soldier', p.x + 10, p.y, Math.PI);
  a.state = AS.Attack;
  a.tgt = b.id;
  a.tk = 3;
  b.state = AS.Attack;
  b.tgt = a.id;
  b.tk = 3;
  a.hp = a.maxHp = b.hp = b.maxHp = 1e6;
  w.reindex();
  let minD = Infinity;
  let mutual = false;
  run(w, 6, () => {
    if (a.state === AS.Grapple && b.state === AS.Grapple && a.gId === b.id && b.gId === a.id) {
      mutual = true;
      minD = Math.min(minD, dist(a, b));
    }
  });
  const D = mutualHold(casteOf(a.caste).length, casteOf(b.caste).length);
  const La = casteOf(a.caste).length;
  const Lb = casteOf(b.caste).length;
  check('stop at reach: two ants going for each other meet and bite head to head', mutual && Math.abs(dist(a, b) - D) < 0.2 * La, `centres ${dist(a, b).toFixed(2)} mm, hold ${D.toFixed(2)} mm`);
  // the bodies (half a length each way) never overlap more than the mandibles (jawOverlap of each)
  check('stop at reach: no body overlap in the grapple, only the mandibles', minD >= (La + Lb) * (0.5 - C2.jawOverlap) - 0.05, `closest ${minD.toFixed(2)} mm; bodies touch at ${((La + Lb) / 2).toFixed(2)} mm`);

  // three attackers on a stunned victim: each holds outside its outline, at its own slot
  const { w: w2, p: q } = field(9);
  const v = fighter(w2, 1, 'formica_worker', q.x, q.y, 0.3);
  v.hp = v.maxHp = 1e6;
  const att: Ant[] = [];
  for (let i = 0; i < 3; i++) {
    const x = fighter(w2, 0, 'lasius_worker', q.x - 12 + i * 3, q.y - 12 + i * 6, 0);
    x.state = AS.Attack;
    x.tgt = v.id;
    x.tk = 3;
    att.push(x);
  }
  w2.reindex();
  run(w2, 6, () => {
    v.stun = 1;
  });
  const holding = att.filter((x) => x.state === AS.Grapple && x.gId === v.id);
  const L = casteOf('lasius_worker').length;
  const outside = holding.every((x) => dist(x, v) >= antOutlineR(v, Math.atan2(x.y - v.y, x.x - v.x)) + L * (C2.frontHalf - C2.jawOverlap) - L * 0.2);
  let pair = Infinity;
  for (let i = 0; i < holding.length; i++) for (let j = i + 1; j < holding.length; j++) pair = Math.min(pair, dist(holding[i], holding[j]));
  check('stop at reach: attackers on one victim hold their front half outside its outline, not on top of it', holding.length >= 2 && outside, `${holding.length} holding`);
  check('stop at reach: attackers round one victim do not overlap each other', pair >= L * 0.5, `closest pair ${(pair / L).toFixed(2)} body lengths`);
}

// ---------------------------------------------------------------- step 3: slots by perimeter
{
  const { w, p } = field();
  const worker = (c: string) => antSlotCount({ caste: c } as Ant, casteOf(c).length, false);
  const ws = ['lasius_worker', 'formica_worker', 'fire_minor', 'atta_media'].map(worker);
  check('slots: a worker ant has room for 2–4 attackers of its own size', ws.every((n) => n >= 2 && n <= 4), ws.join(', '));
  const beetle = spawnCreature(w, 'groundBeetle', SURFACE, p.x, p.y);
  const bs = ['lasius_worker', 'formica_worker', 'lasius_soldier'].map((c) => creatureSlotCount(beetle, casteOf(c).length));
  check('slots: a ground beetle has room for 6–10 attackers round it', bs.every((n) => n >= 6 && n <= 10), bs.join(', '));
  const stag = spawnCreature(w, 'stagBeetle', SURFACE, p.x + 200, p.y);
  check('slots: a 100 mm stag beetle has the cap of slots round it', creatureSlotCount(stag, 4) === C2.slotsMax, `${creatureSlotCount(stag, 4)}`);
  check('slots: a queen keeps room for at least 8', antSlotCount({ caste: 'lasius_queen' } as Ant, 4, true) >= C2.queenSlotsMin);
  check('slots: small ants also get places under a large creature', creatureSlotCount(beetle, 4, true) > 0);
}

// ---------------------------------------------------------------- steps 3–4: reservation, overflow, flanking, waiting
{
  const { w, p } = field(11);
  const v = fighter(w, 1, 'fire_soldier', p.x, p.y, 0);
  v.hp = v.maxHp = 1e6;
  const att: Ant[] = [];
  for (let i = 0; i < 7; i++) {
    const x = fighter(w, 0, 'lasius_worker', p.x - 25 + (i % 4) * 2, p.y - 6 + Math.floor(i / 4) * 5, 0);
    x.state = AS.Attack;
    x.tgt = v.id;
    x.tk = 3;
    att.push(x);
  }
  w.reindex();
  const n = antSlotCount(v, casteOf('lasius_worker').length, false);
  let dup = 0;
  let over = 0;
  let waited = 0;
  run(w, 8, () => {
    v.stun = 1;
    const taken = new Map<number, number>();
    for (const x of att) {
      const on = (x.state === AS.Grapple && x.gId === v.id) || (x.state === AS.Attack && (x.rsv ?? 0) === v.id && x.tgt === v.id);
      if (!on) continue;
      const k = Math.min(n - 1, Math.floor(((((x.gSlot / (Math.PI * 2)) % 1) + 1) % 1) * n));
      taken.set(k, (taken.get(k) ?? 0) + 1);
    }
    for (const c of taken.values()) if (c > 1) dup++;
    if ([...taken.values()].reduce((s, c) => s + c, 0) > n) over++;
    waited = Math.max(waited, att.filter((x) => x.state === AS.Attack && (x.waitT ?? 0) > 0).length);
  });
  const holding = att.filter((x) => x.state === AS.Grapple && x.gId === v.id);
  check('reservation: no two attackers ever hold or head for the same slot', dup === 0 && over === 0, `${dup} clashes, ${over} over the ${n} slots`);
  check('limited attackers: only as many hold the victim as it has slots', holding.length === n, `${holding.length} of ${n}`);
  const angs = holding.map((x) => Math.atan2(x.y - v.y, x.x - v.x)).sort((a, b) => a - b);
  let spread = 0;
  for (let i = 0; i < angs.length; i++) for (let j = i + 1; j < angs.length; j++) spread = Math.max(spread, Math.abs(Math.atan2(Math.sin(angs[j] - angs[i]), Math.cos(angs[j] - angs[i]))));
  check('flanking: attackers coming from one side spread round to slots on the far side', spread > Math.PI / 2, `${((spread * 180) / Math.PI).toFixed(0)}° between the farthest two`);
  const waiting = att.filter((x) => x.state === AS.Attack && (x.waitT ?? 0) > 0);
  const L = casteOf('lasius_worker').length;
  const ringOk = waiting.every((x) => dist(x, v) >= casteOf(v.caste).length * 0.5 + L * (C2.frontHalf - C2.jawOverlap) + C2.personalSpace * L * 0.6);
  check('overflow: the rest wait in a loose ring outside the fight, not piled behind it', waited >= 1 && waiting.length === att.length - holding.length - att.filter((x) => x.state === AS.Dead).length && ringOk, `${waiting.length} waiting`);

  // another foe with room nearby: the extra attackers switch to it instead of waiting
  const { w: w2, p: q } = field(12);
  const v1 = fighter(w2, 1, 'fire_soldier', q.x, q.y, 0);
  const v2 = fighter(w2, 1, 'fire_soldier', q.x + 2, q.y + 14, 0);
  for (const x of [v1, v2]) x.hp = x.maxHp = 1e6;
  const att2: Ant[] = [];
  for (let i = 0; i < 6; i++) {
    const x = fighter(w2, 0, 'lasius_worker', q.x - 20 + (i % 3) * 2, q.y - 4 + Math.floor(i / 3) * 4, 0);
    x.state = AS.Attack;
    x.tgt = v1.id;
    x.tk = 3;
    att2.push(x);
  }
  w2.reindex();
  run(w2, 8, () => {
    v1.stun = v2.stun = 1;
  });
  const on1 = att2.filter((x) => (x.state === AS.Grapple && x.gId === v1.id) || (x.state === AS.Attack && x.tgt === v1.id)).length;
  const on2 = att2.filter((x) => (x.state === AS.Grapple && x.gId === v2.id) || (x.state === AS.Attack && x.tgt === v2.id)).length;
  check('overflow: extra attackers switch to another foe with free slots', on2 >= 2 && on1 <= antSlotCount(v1, casteOf('lasius_worker').length, false), `${on1} on the first, ${on2} on the second`);
}

// ---------------------------------------------------------------- step 4: duels, focus fire, no flicker
{
  const { w, p } = field(13);
  const v = fighter(w, 1, 'fire_soldier', p.x, p.y, 0);
  const a = fighter(w, 0, 'lasius_worker', p.x - 3.2, p.y, 0);
  const far = fighter(w, 1, 'fire_soldier', p.x - 40, p.y, 0);
  a.state = AS.Attack;
  a.tgt = v.id;
  a.tk = 3;
  w.reindex();
  damageAnt(w, a, 0.01, 'bite', far);
  check('no flicker: a bitten ant keeps its own target while that one is in reach', a.tgt === v.id, `target #${a.tgt}`);
  a.x = p.x - 30;
  damageAnt(w, a, 0.01, 'bite', far);
  check('…and turns on the biter when its target is out of reach', a.tgt === far.id, `target #${a.tgt}`);
}
{
  const r = duelBattle('ant:lasius_worker', 60, 'ant:fire_soldier', 60, 20, 4);
  check('duels: a 60 v 60 clash breaks into many small, separated fights', r.clusters >= 12 && r.small >= 0.2, `${r.clusters.toFixed(1)} clusters a sample, ${(r.small * 100).toFixed(0)} % of fighters in clusters of ≤ 4 (base: 8.3, 11 %)`);
  check('duels: few bodies overlap in the clash', r.overlap <= 0.2, `${(r.overlap * 100).toFixed(0)} % (base 24 %)`);
}

// ---------------------------------------------------------------- no snapping: ants walk into place and keep up
{
  const { w, p } = field(15);
  for (let i = 0; i < 30; i++) {
    fighter(w, 0, 'lasius_worker', p.x - 22 + (i % 5) * 3, p.y - 15 + Math.floor(i / 5) * 5, 0);
    fighter(w, 1, 'fire_soldier', p.x + 22 - (i % 5) * 3, p.y - 15 + Math.floor(i / 5) * 5, Math.PI);
  }
  w.reindex();
  const steps: number[] = [];
  let latchJump = 0;
  for (let t = 0; t < 15 * 20; t++) {
    const before = new Map(w.s.ants.map((a) => [a.id, { x: a.x, y: a.y, s: a.state }]));
    w.step(0.05);
    w.events.drain();
    for (const a of w.s.ants) {
      const b = before.get(a.id);
      if (!b || a.state !== AS.Grapple || a.gKind !== 3) continue;
      const v = Math.hypot(a.x - b.x, a.y - b.y) / 0.05 / casteOf(a.caste).speed;
      steps.push(v);
      if (b.s !== AS.Grapple) latchJump = Math.max(latchJump, v);
    }
  }
  steps.sort((x, y) => x - y);
  const p99 = steps[Math.floor(steps.length * 0.99)] ?? 0;
  check('no snapping: an ant latches where it stands (no jump onto its slot)', latchJump <= C2.holdFollow + 0.5, `${latchJump.toFixed(2)} × its walking speed on the latching tick`);
  check('no snapping: holders keep to their hold point at most a brisk walk', p99 <= C2.holdFollow + 0.05, `99th percentile ${p99.toFixed(2)} × walking speed (${steps.length} ticks)`);
}

// ---------------------------------------------------------------- step 5: blocked → back off and go round (v2.1)
{
  const { w } = field(14);
  // a short rock with open ground on both sides: the attacker on one side, its (stunned) target on the other
  let spot: { y: number; x0: number; x1: number } | null = null;
  for (let y = 100; y < 560 && !spot; y += 1)
    for (let x = 100; x < 540 && !spot; x += 0.5) {
      if (w.walkable(SURFACE, x, y)) continue;
      let x1 = x;
      while (x1 < x + 14 && !w.walkable(SURFACE, x1, y)) x1 += 0.5;
      let ok = x1 - x >= 3 && x1 - x <= 12;
      for (let j = 0.5; j <= 12 && ok; j += 0.5) if (!w.walkable(SURFACE, x - j, y) || !w.walkable(SURFACE, x1 + j, y)) ok = false;
      if (ok) spot = { y, x0: x, x1 };
      x = x1;
    }
  if (!spot) check('blocked: a rock to test with', false);
  else {
    const v = fighter(w, 1, 'fire_soldier', spot.x1 + 2, spot.y, 0);
    v.hp = v.maxHp = 1e6;
    const a = fighter(w, 0, 'lasius_worker', spot.x0 - 7, spot.y, 0);
    a.state = AS.Attack;
    a.tgt = v.id;
    a.tk = 3;
    w.reindex();
    // (combat v2.1: blocked, it backs off and goes round instead of the v2 pause and sidestep)
    let backing = 0;
    let moved = 0;
    let round = 0;
    let px = a.x;
    let py = a.y;
    let bitDuring = 0;
    run(w, 4, () => {
      v.stun = 1;
      const hp = v.hp;
      if ((a.repT ?? 0) !== 0) {
        backing++;
        moved += Math.hypot(a.x - px, a.y - py);
        if (v.hp < hp) bitDuring++;
      }
      if ((a.garT ?? 0) > 0) round++;
      px = a.x;
      py = a.y;
    });
    check('blocked: an attacker that cannot close in (a rock in the way) backs off instead of shoving', backing >= BALANCE.combat21.backOffSec * 20 * 0.9 && bitDuring === 0, `${(backing / 20).toFixed(2)} s backing off`);
    check('blocked: it steps back, then goes round', moved > 1 && round > 0, `${moved.toFixed(2)} mm moved backing off, ${(round / 20).toFixed(2)} s going round`);
  }
}

// ---------------------------------------------------------------- step 6: under large creatures, feet push
{
  const { w, p } = field(16);
  const cr = spawnCreature(w, 'groundBeetle', SURFACE, p.x, p.y);
  cr.h = 0;
  cr.hp = cr.maxHp = 1e7;
  cr.stun = 1e9;
  // a small worker right under its belly (its height under the beetle's underside) and a Formica soldier, too tall
  const small = makeAnt(w, 0, 'lasius_worker', SURFACE, p.x - 2.5, p.y, 0);
  const big = makeAnt(w, 0, 'formica_soldier', SURFACE, p.x + 2, p.y + 1, 0);
  for (const a of [small, big]) a.stun = 1e9;
  w.reindex();
  const s0 = { x: small.x, y: small.y };
  separateOnly(w, 40);
  check('under the body: a small ant stands under a large creature\'s belly (only its feet push)', dist(small, s0) < 0.2, `moved ${dist(small, s0).toFixed(2)} mm`);
  check('under the body: an ant too tall for it is pushed out of the body', distToBody(cr, big) >= -0.1, `${distToBody(cr, big).toFixed(2)} mm from the outline`);
  // a foot pushes an ant standing on it aside
  const def = climbDef('groundBeetle')!;
  const fx = cr.x + def.rails[0].pts[0] * cr.scale;
  const fy = cr.y + def.rails[0].pts[2] * cr.scale;
  const onFoot = makeAnt(w, 0, 'lasius_worker', SURFACE, fx + 0.05, fy, 0);
  onFoot.stun = 1e9;
  w.reindex();
  separateOnly(w, 30);
  check('feet: a creature\'s foot pushes an ant standing on it aside', Math.hypot(onFoot.x - fx, onFoot.y - fy) >= Math.max(BALANCE.combat2.footMinMm, cr.scale * BALANCE.combat2.footRadius), `${Math.hypot(onFoot.x - fx, onFoot.y - fy).toFixed(2)} mm from the foot`);
  // attackers small enough to go under get slots under it too
  const { w: w2, p: q } = field(17);
  const b2 = spawnCreature(w2, 'groundBeetle', SURFACE, q.x, q.y);
  b2.hp = b2.maxHp = 1e7;
  const att: Ant[] = [];
  for (let i = 0; i < 24; i++) {
    const a = fighter(w2, 0, 'fire_minor', q.x - 20 + (i % 6) * 3, q.y - 10 + Math.floor(i / 6) * 4, 0);
    a.colony = 0;
    a.state = AS.Attack;
    a.tgt = b2.id;
    a.tk = 4;
    att.push(a);
  }
  w2.reindex();
  run(w2, 10, () => {
    b2.stun = 1;
  });
  const under = att.filter((a) => a.state === AS.Grapple && a.gId === b2.id && a.gSlot >= 1).length;
  check('under the body: small attackers also fight from under a large creature', under > 0, `${under} under its body`);
}

// ---------------------------------------------------------------- step 7: threat and aimed splash attacks
{
  const { w, p } = field(18);
  const cr = spawnCreature(w, 'groundBeetle', SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e6;
  const a = fighter(w, 0, 'lasius_worker', p.x + 9, p.y, Math.PI);
  const b = fighter(w, 0, 'lasius_worker', p.x - 9, p.y, 0);
  for (const x of [a, b]) {
    x.hp = x.maxHp = 1e6;
    x.stun = 1e9;
  }
  w.reindex();
  damageCreature(w, cr, 5, 'bite', a);
  check('threat: a hit adds threat for the biter', (cr.thr ?? []).includes(a.id));
  cr.thr = [a.id, 10, b.id, 12];
  cr.tgt = a.id;
  cr.tk = 3;
  cr.cd = 99;
  run(w, 0.1);
  const kept = cr.tgt === a.id;
  cr.thr = [a.id, 10, b.id, 14];
  run(w, 0.1);
  check('threat: a creature keeps its target unless another has clearly more threat (×1.3)', kept && cr.tgt === b.id, `kept ${kept}, then #${cr.tgt}`);
  const t0 = (cr.thr ?? [])[3] ?? 0;
  run(w, 1);
  const t1 = (cr.thr ?? [])[3] ?? 0;
  check('threat: it fades (10 % a second)', t1 < t0 && t1 > t0 * 0.85, `${t0.toFixed(2)} → ${t1.toFixed(2)}`);
}
{
  // the stag beetle's clamp (a splash in front) is aimed at the thickest crowd: one ant ahead, six back to its left
  const { w, p } = field(19);
  const cr = spawnCreature(w, 'stagBeetle', SURFACE, p.x, p.y);
  cr.h = 0;
  cr.hp = cr.maxHp * 0.6; // phase 1: grab and toss
  cr.cd2 = 0;
  const L = cr.scale;
  const lone = fighter(w, 0, 'lasius_worker', p.x + L * 0.42, p.y, Math.PI);
  const crowdAnts: Ant[] = [];
  for (let i = 0; i < 6; i++) crowdAnts.push(fighter(w, 0, 'lasius_worker', p.x - L * 0.22 + (i % 3) * 4, p.y + L * 0.36 + Math.floor(i / 3) * 4, -Math.PI / 2));
  for (const x of [lone, ...crowdAnts]) {
    x.hp = x.maxHp = 1e6;
    x.stun = 1e9;
  }
  w.reindex();
  let dir: number | undefined;
  w.events.on('telegraph', (e) => {
    if (e.creature === cr.id && e.dir !== undefined && dir === undefined) dir = e.dir;
  });
  for (let t = 0; t < 60 && dir === undefined; t++) {
    w.step(0.05);
    w.events.drain();
  }
  const toCrowd = Math.atan2(crowdAnts[4].y - cr.y, crowdAnts[4].x - cr.x);
  check('splash: the clamp is aimed at the thickest crowd, not at the lone ant ahead', dir !== undefined && Math.abs(Math.atan2(Math.sin(dir - toCrowd), Math.cos(dir - toCrowd))) < 0.7, dir === undefined ? 'no clamp' : `aimed ${((dir * 180) / Math.PI).toFixed(0)}°, crowd at ${((toCrowd * 180) / Math.PI).toFixed(0)}°`);
}
{
  // surrounded and hurt: it backs off
  const { w, p } = field(20);
  const cr = spawnCreature(w, 'groundBeetle', SURFACE, p.x, p.y);
  cr.hp = cr.maxHp * 0.3;
  const L = cr.scale;
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const x = fighter(w, 0, 'fire_minor', p.x + Math.cos(ang) * L * 0.5, p.y + Math.sin(ang) * L * 0.5, ang + Math.PI);
    x.stun = 1e9;
    x.hp = x.maxHp = 1e6;
  }
  // a gap on one side: the crowd's middle is off to the other
  for (let i = 0; i < 4; i++) {
    const x = fighter(w, 0, 'fire_minor', p.x - L * 0.45, p.y + (i - 1.5) * 2, 0);
    x.stun = 1e9;
    x.hp = x.maxHp = 1e6;
  }
  w.reindex();
  let backed = 0;
  run(w, 1, () => {
    if ((cr.data.backT ?? 0) > 0) backed++;
  });
  check('surrounded: a hurt creature backs off from the crowd', backed > 0 && dist(cr, p) >= BALANCE.combat2.backOffLen * L * 0.5, `${(backed / 20).toFixed(2)} s backing, ${dist(cr, p).toFixed(1)} mm`);
}
{
  // a titan with riders telegraphs a shake-off and throws them down
  const { w, p } = field(22);
  const cr = spawnCreature(w, 'stagBeetle', SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e7;
  for (let i = 0; i < 40; i++) {
    const a = fighter(w, 0, 'lasius_soldier', p.x - 70 + (i % 8) * 4, p.y - 20 + Math.floor(i / 8) * 6, 0);
    a.state = AS.Attack;
    a.tgt = cr.id;
    a.tk = 4;
    a.hp = a.maxHp = 1e6;
  }
  w.reindex();
  let shakes = 0;
  let thrown = 0;
  let tele = false;
  w.events.on('telegraph', (e) => {
    if (e.creature === cr.id && cr.data.shake === 1) tele = true;
  });
  for (let t = 0; t < 30 * 20; t++) {
    const riding0 = new Set(w.s.ants.filter((a) => a.state === AS.Climb && (a.ridePh ?? 0) >= 1).map((a) => a.id));
    const sh = cr.data.shake ?? 0;
    w.step(0.05);
    w.events.drain();
    if (sh === 1 && cr.data.shake === 2) {
      shakes++;
      thrown += w.s.ants.filter((a) => riding0.has(a.id) && a.state === AS.Flung).length;
    }
  }
  check('shake-off: a titan with riders telegraphs and throws them down (every ~20 s)', shakes >= 1 && thrown >= 3 && tele, `${shakes} shake-offs, ${thrown} riders thrown`);
}
{
  // a wolf spider drags its catch out of the cluster
  const { w, p } = field(23);
  const cr = spawnCreature(w, 'wolfSpider', SURFACE, p.x - 30, p.y);
  cr.h = 0;
  cr.hp = cr.maxHp = 1e6;
  for (let i = 0; i < 9; i++) {
    const a = fighter(w, 0, 'lasius_worker', p.x + (i % 3) * 3, p.y + (Math.floor(i / 3) - 1) * 3, Math.PI);
    a.hp = a.maxHp = 1e6;
    a.stun = 1e9;
  }
  w.reindex();
  let start: { x: number; y: number } | null = null;
  let dragged = 0;
  run(w, 12, () => {
    if (cr.state === 9 /* CS.Eat */) {
      if (!start) start = { x: cr.x, y: cr.y };
      dragged = Math.max(dragged, dist(cr, start));
    }
  });
  check('wolf spider: it pounces and drags its catch out of the cluster', dragged >= cr.scale, `${dragged.toFixed(1)} mm (its length ${cr.scale} mm)`);
}

// ---------------------------------------------------------------- step 8: mounting
function mountScene(n: number, kind = 'stagBeetle', seed = 24, caste = 'lasius_soldier'): { w: World; ants: Ant[]; cr: ReturnType<typeof spawnCreature> } {
  const { w, p } = field(seed);
  const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e7;
  cr.stun = 1e9;
  const ants: Ant[] = [];
  for (let i = 0; i < n; i++) {
    const a = fighter(w, 0, caste, p.x - 60 + (i % 8) * 4, p.y - 20 + Math.floor(i / 8) * 6, 0);
    a.state = AS.Attack;
    a.tgt = cr.id;
    a.tk = 4;
    a.hp = a.maxHp = 1e6;
    ants.push(a);
  }
  w.reindex();
  return { w, ants, cr };
}
const mounted = (ants: Ant[]) => ants.filter((a) => a.state === AS.Climb && ((a.ridePh ?? 0) === 1 || (a.ridePh ?? 0) === 2));
{
  const { w, ants, cr } = mountScene(10);
  let most = 0;
  let firstUp = -1;
  let firstT = Infinity;
  run(w, 6, () => {
    const m = mounted(ants);
    most = Math.max(most, m.length);
    // the one on the creature longest: it got on the leg first
    for (const a of m) {
      const on = w.s.time - (a.st - (a.rideWalk ?? 0));
      if (on < firstT - 1e-9) {
        firstT = on;
        firstUp = a.id;
      }
    }
  });
  check('ratio: at most 30 % of the ants fighting a creature ride it', most === Math.floor(10 * BALANCE.mount.ratio), `${most} of 10`);
  // two of the ground force die: one rider too many climbs down — the longest-mounted
  const ridersNow = mounted(ants).sort((a, b) => a.id - b.id);
  // (as the rule counts: riders include ants walking to a leg; the ground force is the ants fighting it from the ground)
  const climbing = ants.filter((a) => a.state === AS.Climb && (a.ridePh ?? 0) <= 2).length;
  const ground = ants.filter((a) => a.state === AS.Attack || a.state === AS.Grapple);
  const keep = Math.ceil((climbing - 1) / BALANCE.mount.ratio - climbing - 1e-9);
  for (const a of ground.slice(0, Math.max(0, ground.length - keep))) killAnt(w, a);
  let firstDown = -1;
  run(w, 0.5, () => {
    for (const r of ridersNow) if (firstDown < 0 && (r.ridePh ?? 0) === 3) firstDown = r.id;
  });
  const downs = ridersNow.filter((r) => (r.ridePh ?? 0) === 3 || r.state !== AS.Climb).length;
  // then the whole ground force dies: they all climb down
  for (const a of ants) if (!(a.state === AS.Climb && (a.ridePh ?? 0) >= 1)) killAnt(w, a);
  run(w, 3);
  check('ratio: with no ground force left the riders climb down', mounted(ants).length === 0, `${mounted(ants).length} still mounted`);
  check('ratio: the longest-mounted climbs down first (one too many: just that one)', ridersNow.length > 1 && firstDown === firstUp && downs === 1, `first down #${firstDown}, first on #${firstUp}, ${downs} down`);
  void cr;
}
{
  // caps: a titan 12, a large creature 8 (or fewer where its slots run out)
  const big = mountScene(60);
  let most = 0;
  run(big.w, 10, () => {
    most = Math.max(most, mounted(big.ants).length);
  });
  check('cap: a titan carries at most 12 riders', most === BALANCE.mount.capHuge, `${most}`);
  const mant = mountScene(40, 'mantis', 25, 'lasius_worker');
  let mostM = 0;
  run(mant.w, 10, () => {
    mostM = Math.max(mostM, mounted(mant.ants).length);
  });
  check('cap: a large creature (mantis) carries at most 8', mostM > 0 && mostM <= BALANCE.mount.capLarge, `${mostM}`);
  // riders spread over the body: front to back on both sides
  const slots = climbDef('stagBeetle')!.slots;
  const taken = mounted(big.ants).map((a) => slots[a.rideSlot ?? 0]);
  const xs = taken.map((s) => s.x);
  const zs = taken.map((s) => s.z);
  check('placement: riders spread front to back and on both sides', Math.max(...xs) - Math.min(...xs) > 0.25 && zs.some((z) => z > 0.03) && zs.some((z) => z < -0.03), `x ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}, z ${Math.min(...zs).toFixed(2)}..${Math.max(...zs).toFixed(2)} L`);
  // no two slots closer than the authored spacing
  let close = Infinity;
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) close = Math.min(close, Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y, slots[i].z - slots[j].z) * 100);
  check('placement: mount slots never closer than 1.2 × a rider\'s length', close >= BALANCE.mount.slotGap * BALANCE.mount.refRiderMm - 0.01, `${close.toFixed(2)} mm`);
  check('placement: every mount slot faces a weak point and has a surface normal', slots.every((s) => s.w >= 0 && s.w < climbDef('stagBeetle')!.weak.length && Math.hypot(s.nx, s.ny, s.nz) > 0.99));
}
{
  // the mount bonus: riders ≥ half the cap → +25 % damage from everyone
  const { w, cr } = mountScene(0);
  cr.climbers = 0;
  const h0 = cr.hp;
  damageCreature(w, cr, 100, 'pure', null);
  const plain = h0 - cr.hp;
  cr.climbers = Math.ceil(climbCap(cr) * BALANCE.mount.bonusAt);
  const h1 = cr.hp;
  damageCreature(w, cr, 100, 'pure', null);
  check('mount bonus: with half the cap riding it takes +25 % damage', Math.abs((h1 - cr.hp) / plain - BALANCE.mount.bonusMul) < 1e-9 && mountBonus(cr), `${plain} → ${(h1 - cr.hp).toFixed(1)}`);
}
{
  // riders use their basic attack only: no acid from a Lasius soldier; a fire ant keeps its sting
  const { w, ants, cr } = mountScene(20, 'stagBeetle', 26, 'lasius_soldier');
  for (const a of ants) a.cd2 = 0; // acid ready
  let acidRiding = 0;
  w.events.on('acid', (e) => {
    if (mounted(ants).some((a) => Math.hypot(a.x - e.x, a.y - e.y) < 0.01)) acidRiding++;
  });
  for (let t = 0; t < 10 * 20; t++) {
    w.step(0.05);
    w.events.drain();
  }
  check('basic attack only: riders spray no acid', mounted(ants).length > 0 && acidRiding === 0, `${acidRiding} acid shots from riders`);
  const fire = mountScene(20, 'stagBeetle', 27, 'fire_soldier');
  let stingsRiding = 0;
  fire.w.events.on('sting', (e) => {
    if (mounted(fire.ants).some((a) => Math.hypot(a.x - e.x, a.y - e.y) < 0.01)) stingsRiding++;
  });
  for (let t = 0; t < 10 * 20; t++) {
    fire.w.step(0.05);
    fire.w.events.drain();
  }
  check('basic attack only: fire ants keep their sting while riding', stingsRiding > 0, `${stingsRiding} stings from riders`);
}
{
  // a mantis flying off the map takes its riders with it
  const { w, ants, cr } = mountScene(30, 'mantis', 29, 'lasius_worker');
  cr.stun = 0;
  run(w, 6, () => {
    cr.stun = 1;
  });
  const riders = mounted(ants);
  cr.stun = 0;
  cr.state = 3; // CS.Flee
  cr.st = 7;
  run(w, 0.5);
  check('leaving the map: riders of a creature that leaves die with it', riders.length > 0 && riders.every((a) => a.state === AS.Dead || !w.antById.get(a.id)), `${riders.length} riders`);
}

// ---------------------------------------------------------------- determinism
{
  const play = (restoreAt: number): string => {
    const { w } = field(21);
    const p = openGround(w);
    for (let i = 0; i < 30; i++) {
      const a = fighter(w, 0, 'lasius_worker', p.x - 20 + (i % 5) * 3, p.y - 15 + Math.floor(i / 5) * 5, 0);
      const b = fighter(w, 1, 'fire_soldier', p.x + 20 - (i % 5) * 3, p.y - 15 + Math.floor(i / 5) * 5, Math.PI);
      void a;
      void b;
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
  check('determinism: a world saved and restored mid-fight (reservations, pauses) stays in step', h1 === h3, `${h1} / ${h3}`);
}

console.log(failed ? `\n${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `\nall combat v2 tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
