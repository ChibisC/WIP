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
import { damageAnt } from '../src/sim/combat';
import { separationSystem } from '../src/sim/separation';
import { antOutlineR, antSlotCount, creatureSlotCount, mutualHold } from '../src/sim/slots';
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

// ---------------------------------------------------------------- step 5: blocked → pause and sidestep
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
    let paused = 0;
    let moved = 0;
    let px = a.x;
    let py = a.y;
    let bitDuring = 0;
    run(w, 4, () => {
      v.stun = 1;
      const hp = v.hp;
      if ((a.repT ?? 0) !== 0) {
        paused++;
        moved += Math.hypot(a.x - px, a.y - py);
        if (v.hp < hp) bitDuring++;
      }
      px = a.x;
      py = a.y;
    });
    check('blocked: an attacker that cannot close in (a rock in the way) pauses instead of shoving', paused >= 0.5 * 20 * 0.9 && bitDuring === 0, `${(paused / 20).toFixed(2)} s paused`);
    check('blocked: it sidesteps round its target while it waits', moved > 1, `${moved.toFixed(2)} mm moved in the pauses`);
  }
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
