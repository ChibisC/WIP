import { World } from './world';
import { Ant, AS, Carry, Colony, Creature, POSE, SURFACE, nestSpace } from './types';
import type { Projectile } from './types';
import { casteOf, DamageType, isKing } from './species';
import { angleDiff, antSpeed, faceToward, moveForward, steerTo, turnToward, goHome, goOut } from './movement';
import { antHoldPoint, antSlotCount, antSlotsTaken, bodyHook, creatureHasRoom, creatureSlotOff, creatureSlotWorld, distToCreatureBody, flankSide, frontOff, holdsSlotOn, mutualHold, outlineU, releaseSlot, reserveAntSlot, reserveCreatureSlot, slotTmp } from './slots';
import { killAnt, releaseGrapple } from './antAI';
import { dropCarried, setTask } from './colony';
import { abilityMods } from './abilities';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';
import { BALANCE, GUARD, SICKLE } from './balance';
import { glueBurst, majorAlarm, majorCharge, nasuteAttack, acquireInRange } from './termites';
import { startSurge, surging } from './surge';
import { hellUpdate, isHellState, release, snapEligible, startHunt } from './hellAnts';
import { isSickle, sickleAlarm, sickleAttack, sickleUpdate } from './sickleJaws';
import { riding, tryClimb } from './climbing';
import { climbCap } from './creatures/climb';
import { afterBite, guardRush, hookMul } from './eciton';
import { acidMulOn, glueBurst as termantGlue, termantArmorMul } from './termants';
import { underOrder } from './markers';

/**
 * Swarm combat: target acquisition, grappling (latching onto legs/antennae of
 * ants or around large creatures), spread-eagling, bite/acid/sting damage
 * types, alarm spread, knockback flights.
 */

/** Relation of a creature to ants; set by the creature module. */
export const creatureHooks: {
  relation: (c: Creature) => 'hostile' | 'prey' | 'ignore';
  armor: (c: Creature) => number;
  onDamaged?: (w: World, c: Creature, from: Ant | null, dmg: number) => void;
  onKilled?: (w: World, c: Creature) => void;
  canLatch: (c: Creature) => boolean;
  /** slot radius for grapplers around the creature body */
  radius: (c: Creature) => number;
} = {
  relation: () => 'hostile',
  armor: () => 0,
  canLatch: () => true,
  radius: (c) => c.scale * 0.45,
};

/** Ants of different teams are enemies (allies share a team). */
export function isEnemyAnt(a: Ant, b: Ant): boolean {
  // an ant up on a creature is untouchable (climbing.ts), and a king (termites, Termants) is invulnerable and dies
  // with his queen (user note 2026-10-25): nobody targets either (intruders go for the queen)
  return (a.team ?? a.colony) !== (b.team ?? b.colony) && b.state !== AS.Dead && !riding(b) && !isKing(b.caste);
}

/** A creature fighting for a team (battle arena: its faction is a team's colony) is no enemy of that team's ants. */
export function friendlyCreature(w: World, team: number, cr: Creature): boolean {
  return cr.faction >= 0 && w.teamOf(cr.faction) === team;
}

export function sameTeam(a: Ant, b: Ant): boolean {
  return (a.team ?? a.colony) === (b.team ?? b.colony);
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

export function damageAnt(w: World, t: Ant, amount: number, type: DamageType, src: Ant | Creature | null): void {
  if (t.state === AS.Dead || riding(t)) return;
  const c = w.colony(t.colony);
  if (c && t.id === c.queen && c.invincibleQueen) return;
  const cd = casteOf(t.caste);
  // A king (termites, Termants) takes no damage at all; he dies only with his queen (killAnt).
  if (cd.role === 'king') return;
  let dmg = amount;
  if (type === 'bite') dmg = Math.max(amount * 0.3, amount - cd.armor);
  else if (type === 'acid') dmg = Math.max(amount * 0.75, amount - cd.armor * 0.25);
  if (t.pinned > 0 && type !== 'pure') dmg *= 1.5;
  // Termants: formic acid on a glued target; harder shells from beetle genes
  if (type === 'acid') dmg *= acidMulOn(w, t.glueT);
  if (c && c.genome) dmg *= termantArmorMul(c);
  // a hell ant holding prey lets go when it is hurt (not by the prey's dying struggle); a sickle-jaw never does
  if ((t.holdId ?? 0) !== 0 && cd.termite !== 'sickle' && !(src && 'caste' in src && src.id === t.holdId && t.holdKind === 3)) release(w, t, false);
  if (cd.termite === 'major') majorAlarm(w, t);
  if (cd.termite && cd.species === 'rhynchotermes') sickleAlarm(w, t);
  t.hp -= dmg;
  t.alarm = 1;
  raiseAlarm(w, t);
  if (c && t.id === c.queen && w.s.tick % 10 === 0) w.events.emit({ t: 'queenHurt', colony: c.id });
  if (t.hp <= 0) {
    if (src && 'colony' in src) {
      const kc = w.colony(src.colony);
      if (kc) kc.stats.kills++;
    }
    killAnt(w, t);
  } else if (src && t.state !== AS.Grapple && t.state !== AS.Flung && t.state !== AS.Bridge && t.state !== AS.Plug && (t.xing ?? 0) === 0 && t.state !== AS.Hunt && t.state !== AS.Snap && t.state !== AS.Hold && t.state !== AS.Climb && t.id !== c?.queen && !(cd.acid?.kind === 'ramp' && t.tgt && t.state === AS.Attack) && !('caste' in src && !isEnemyAnt(t, src))) {
    // Fight back (combat v2: an ant busy with its own foe in reach keeps it — no flicker between targets).
    if (t.state === AS.Attack && t.tgt && (t.tk === 3 || t.tk === 4) && targetInReach(w, t)) {
      // keeps its target
    } else if ('caste' in src) {
      t.tgt = src.id;
      t.tk = 3;
    } else {
      t.tgt = src.id;
      t.tk = 4;
    }
    if (t.state !== AS.Attack) {
      if (cd.surge) startSurge(w, t);
      dropCarried(w, t);
      t.state = AS.Attack;
      t.st = 0;
    }
  }
}

/** Is an attacking ant's own target within reach (its hold point no more than `keepTargetReach` of its length off)? */
function targetInReach(w: World, a: Ant): boolean {
  const L = casteOf(a.caste).length;
  const C2 = BALANCE.combat2;
  if (a.tk === 3) {
    const o = w.antById.get(a.tgt);
    if (!o || o.state === AS.Dead || o.space !== a.space) return false;
    return dhypot(o.x - a.x, o.y - a.y) - casteOf(o.caste).length * C2.antHalfLen - frontOff(L) <= L * C2.keepTargetReach;
  }
  const cr = w.creatureById.get(a.tgt);
  if (!cr || cr.dead || cr.space !== a.space) return false;
  return distToCreatureBody(cr, a.x, a.y) - frontOff(L) <= L * C2.keepTargetReach;
}

export function applyVenom(w: World, t: { venom: number; venomT: number; venomDps: number }, dps: number, duration: number, maxStacks: number): void {
  t.venom = Math.min(maxStacks, t.venom + 1);
  t.venomT = duration;
  t.venomDps = Math.max(t.venomDps * 0.9, dps);
}

export function damageCreature(w: World, cr: Creature, amount: number, type: DamageType, src: Ant | null): void {
  if (cr.dead) return;
  const armor = creatureHooks.armor(cr);
  let dmg = amount;
  if (type === 'bite') dmg = Math.max(amount * 0.25, amount - armor);
  else if (type === 'acid') dmg = Math.max(amount * 0.7, amount - armor * 0.25) * acidMulOn(w, cr.glueT);
  // mount bonus (EotU): enough ants on its back and it takes more damage from everyone
  if (mountBonus(cr)) dmg *= BALANCE.mount.bonusMul;
  cr.hp -= dmg;
  creatureHooks.onDamaged?.(w, cr, src, dmg);
  if (cr.hp <= 0) {
    cr.hp = 0;
    cr.dead = true;
    cr.deadT = 0;
    if (src) {
      const kc = w.colony(src.colony);
      if (kc) kc.stats.kills++;
    }
    w.events.emit({ t: 'death', x: cr.x, y: cr.y, space: cr.space, kind: 'creature', id: cr.id, colony: -1, what: cr.kind });
    creatureHooks.onKilled?.(w, cr);
  }
}

/** Does a creature carry enough riders for the mount bonus (`mount.bonusAt` of its cap)? */
export function mountBonus(cr: Creature): boolean {
  const n = cr.climbers ?? 0;
  if (n <= 0) return false;
  const cap = climbCap(cr);
  return cap > 0 && n >= Math.max(1, Math.ceil(cap * BALANCE.mount.bonusAt - 1e-9));
}

/** Alarm: pheromone on the surface; in the nest it spreads ant-to-ant. */
export function raiseAlarm(w: World, a: Ant): void {
  if (a.space === SURFACE) w.phero.depositAlarm(a.x, a.y, 0.8);
  if (w.s.tick % 5 !== a.id % 5) return;
  w.events.emit({ t: 'alarm', x: a.x, y: a.y, space: a.space, colony: a.colony });
  const R = a.space === SURFACE ? 22 : 18;
  w.antsNear(a.space, a.x, a.y, R, (o) => {
    if (o.colony !== a.colony || o.state === AS.Dead) return false;
    if (o.alarm < 0.6) o.alarm = 0.7;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Knockback
// ---------------------------------------------------------------------------

export function flingAnt(w: World, a: Ant, fromX: number, fromY: number, power: number): void {
  if (a.state === AS.Dead || riding(a)) return;
  const c = w.colony(a.colony);
  if (c && a.id === c.queen) return; // the queen is immune to knockback
  if (a.state === AS.Hold && isSickle(a)) return; // a holding sickle-jaw is planted
  dropCarried(w, a);
  releaseGrapple(w, a);
  const ang = datan2(a.y - fromY, a.x - fromX) + w.rng.range(-0.4, 0.4);
  const m = casteOf(a.caste).mass;
  const sp = (power * 40) / Math.sqrt(m + 0.5);
  a.fvx = dcos(ang) * sp;
  a.fvy = dsin(ang) * sp;
  a.fvz = sp * 0.9;
  a.fz = 0.01;
  a.state = AS.Flung;
  a.st = 0;
  w.events.emit({ t: 'fling', x: a.x, y: a.y, space: a.space });
}

export function flungUpdate(w: World, a: Ant, dt: number): void {
  a.fvz -= 400 * dt;
  a.fz += a.fvz * dt;
  const nx = a.x + a.fvx * dt;
  const ny = a.y + a.fvy * dt;
  if (w.walkable(a.space, nx, ny)) {
    a.x = nx;
    a.y = ny;
  } else {
    a.fvx *= -0.3;
    a.fvy *= -0.3;
  }
  a.h += dt * 9;
  a.v = 0;
  if (a.fz <= 0) {
    a.fz = 0;
    a.state = AS.Idle;
    a.st = 0;
    if (a.softLand) {
      // dropped off a dying creature: a short tumble, no harm
      a.softLand = false;
      a.stun = 0.4;
    } else {
      a.stun = 0.9;
      damageAnt(w, a, 1.5, 'bite', null);
    }
  }
}

// ---------------------------------------------------------------------------
// Ant combat behaviour
// ---------------------------------------------------------------------------

function aggroRadius(w: World, a: Ant, c: Colony): number {
  const cd = casteOf(a.caste);
  const fighter = cd.role === 'soldier' || cd.role === 'major';
  let r = a.space === SURFACE ? (fighter ? 34 : 9) : fighter ? 22 : 8;
  if (a.alarm > 0.3) r = Math.max(r, a.space === SURFACE ? 26 : 18);
  if (a.task === 'marker') r = Math.max(r, 30);
  // sickle-jaws guarding a trail are short-ranged: they take on what comes near the column, not what passes by
  if (cd.termite === 'sickle' && a.task === 'marker' && a.state === AS.Rally) r = Math.min(r, SICKLE.escort.aggroBodyLengths * cd.length);
  // army-ant Soldiers at their trail posts rush what comes near the column (eciton.ts)
  if (cd.hook && a.task === 'marker' && a.state === AS.Guard) r = guardRush(a);
  // shooters see (and engage) as far as they can spray
  if (cd.acid && cd.acid.kind !== 'opener' && cd.acid.kind) r = Math.max(r, cd.acid.range * (a.space === SURFACE ? 1 : 0.7));
  if (a.carry !== Carry.None && a.alarm < 0.5) r = Math.min(r, 4);
  // Defend-only stance: outside the home nest, ants engage only when alarmed (attacked or alarm scent).
  if (!c.aggressive && a.alarm < 0.3 && a.space !== nestSpace(c.id)) r = Math.min(r, cd.length * 0.7);
  return r;
}

type Target = { kind: 3 | 4; id: number; x: number; y: number; d2: number };

/** One reusable result (findTarget runs for hundreds of ants a tick; callers read it at once). */
const found: Target = { kind: 3, id: 0, x: 0, y: 0, d2: 0 }; // det-ok: scratch result
let hasFound = false; // det-ok: scratch

/** The best foe with no free slot: taken only when no foe in sight has room (the ant then waits in its ring). */
const full: Target = { kind: 3, id: 0, x: 0, y: 0, d2: 0 }; // det-ok: scratch result
let hasFull = false; // det-ok: scratch

function offerFull(kind: 3 | 4, id: number, x: number, y: number, score: number): void {
  if (hasFull && score >= full.d2) return;
  hasFull = true;
  full.kind = kind;
  full.id = id;
  full.x = x;
  full.y = y;
  full.d2 = score;
}

function offer(kind: 3 | 4, id: number, x: number, y: number, score: number): void {
  if (hasFound && score >= found.d2) return;
  hasFound = true;
  found.kind = kind;
  found.id = id;
  found.x = x;
  found.y = y;
  found.d2 = score;
}

let onTick = -1; // det-ok: derived per-tick cache
let onState: unknown = null; // det-ok: derived per-tick cache
const attackersOn = new Map<number, number>(); // det-ok: derived per-tick cache, rebuilt from SimState

/** How many ants of `team` are going for (or holding) ant `id` this tick. */
function attackers(w: World, id: number, team: number): number {
  if (onTick !== w.s.tick || onState !== w.s) {
    onTick = w.s.tick;
    onState = w.s;
    attackersOn.clear();
    for (const o of w.s.ants) {
      if (o.tk !== 3 || !o.tgt || (o.state !== AS.Attack && o.state !== AS.Grapple)) continue;
      const k = o.tgt * 16 + ((o.team ?? o.colony) & 15);
      attackersOn.set(k, (attackersOn.get(k) ?? 0) + 1);
    }
  }
  return attackersOn.get(id * 16 + (team & 15)) ?? 0;
}

/** Enemy ants in sight this findTarget call (scratch, reused). */
const cand: Ant[] = []; // det-ok: scratch, filled and read within one call
const candD2: number[] = []; // det-ok: scratch

/**
 * Pick a foe (combat v2, CHANGE_PLAN §16 step 4): the nearest, roughly ahead, preferring pinned and high-threat ants
 * and — heavily — ones few nestmates are already on (`combat2.crowdPenalty`), so a clash breaks into duels. A foe with
 * every slot taken (and none of them the ant's) is picked only when no foe in sight has room: the ant waits in its ring. Focus fire (no crowd penalty; a full foe may be
 * picked to wait in its ring) only when the ant's marker sits on the foe or its side outnumbers the foes in sight
 * `focusOutnumber` to 1.
 */
function findTarget(w: World, a: Ant, c: Colony, r: number): Target | null {
  hasFound = false;
  hasFull = false;
  const C2 = BALANCE.combat2;
  const hx = dcos(a.h);
  const hy = dsin(a.h);
  const team = a.team ?? a.colony;
  const mine = a.tk === 3 && (a.state === AS.Attack || a.state === AS.Grapple) ? a.tgt : 0;
  const sickle = casteOf(a.caste).termite === 'sickle';
  const L = casteOf(a.caste).length;
  cand.length = 0;
  candD2.length = 0;
  w.enemiesNear(a.space, team, a.x, a.y, r, (o, d2) => {
    if (!isEnemyAnt(a, o)) return false;
    // a sickle-jaw cannot grab what another already holds: it looks past it (sickleJaws.ts drops such a target)
    if (sickle && o.heldBy) return false;
    cand.push(o);
    candD2.push(d2);
    return false;
  });
  // focus fire: our side outnumbers the foes in sight 4 to 1 (counted until it does), or the marker is on a foe
  let outnumber = false;
  if (cand.length > 0) {
    const need = cand.length * C2.focusOutnumber;
    let allies = 0;
    w.antsNear(a.space, a.x, a.y, r, (o) => {
      if ((o.team ?? o.colony) === team && o.state !== AS.Dead) allies++;
      return allies >= need;
    });
    outnumber = allies >= need;
  }
  const mk = a.task === 'marker' && a.marker >= 0 ? c.markers[a.marker] : undefined;
  const mOn = mk && mk.placed && mk.space === a.space ? mk : undefined;
  for (let i = 0; i < cand.length; i++) {
    const o = cand[i];
    const d2 = candD2[i];
    const focus = outnumber || (!!mOn && sq(mOn.x - o.x) + sq(mOn.y - o.y) <= sq(C2.focusMarkerMm));
    // Prefer pinned targets slightly and high-threat ants (tanks draw attacks); otherwise nearest.
    const threat = casteOf(o.caste).threat ?? 0;
    // …and ones roughly ahead, so a fight is not a constant turning about (fix brief: no spinning)
    const ahead = 1.25 - (0.25 * ((o.x - a.x) * hx + (o.y - a.y) * hy)) / Math.max(1e-3, Math.sqrt(d2));
    // …and ones not already taken on by nestmates: the fight breaks into duels (combat v2)
    const crowd = focus ? 1 : 1 + C2.crowdPenalty * Math.max(0, attackers(w, o.id, team) - (o.id === mine ? 1 : 0));
    const score = (d2 * (o.pinned > 0 ? 0.6 : 1) * ahead * crowd) / (1 + threat);
    // no free slot on it (and none of ours): only if no foe in sight has room (then it waits in this one's ring)
    if (!focus && !holdsSlotOn(a, o.id, 3) && antSlotsTaken(w, o) >= antSlotCount(o, L, o.id === w.colony(o.colony)?.queen)) offerFull(3, o.id, o.x, o.y, score);
    else offer(3, o.id, o.x, o.y, score);
  }
  cand.length = 0;
  candD2.length = 0;
  if (a.space === SURFACE || w.s.creatures.length) {
    const cd = casteOf(a.caste);
    const fighter = cd.role === 'soldier' || cd.role === 'major' || a.task === 'marker' || a.alarm > 0.3;
    const scan = (cr: Creature, d2: number) => {
      if (cr.space !== a.space || cr.dead || friendlyCreature(w, team, cr)) return false;
      const rel = creatureHooks.relation(cr);
      if (rel === 'ignore') return false;
      if (rel === 'prey' && !(a.task === 'forage' || a.task === 'marker' || fighter)) return false;
      if (rel === 'hostile' && !fighter && d2 > 64) return false;
      // every place round it taken (and none of ours, no marker on it): something else first
      const focus = !!mOn && distToCreatureBody(cr, mOn.x, mOn.y) <= C2.focusMarkerMm;
      if (!focus && !holdsSlotOn(a, cr.id, 4) && !creatureHasRoom(w, a, cr)) offerFull(4, cr.id, cr.x, cr.y, d2 * (rel === 'prey' ? 1.2 : 0.9));
      else offer(4, cr.id, cr.x, cr.y, d2 * (rel === 'prey' ? 1.2 : 0.9));
      return false;
    };
    if (a.space === SURFACE) w.creaturesNear(a.x, a.y, r, scan);
    else for (const cr of w.s.creatures) if (cr.space === a.space && !cr.dead) {
      const d2 = sq(cr.x - a.x) + sq(cr.y - a.y);
      const rr = r + cr.scale * 0.5;
      if (d2 < rr * rr) scan(cr, d2);
    }
  }
  return hasFound ? found : hasFull ? full : null;
}

/** Returns true if the ant spent this tick on combat. */
/** Venom damage over time. Returns true if the ant died of it. */
export function venomTick(w: World, a: Ant, dt: number): boolean {
  if (a.venom <= 0) return false;
  a.hp -= a.venomDps * a.venom * dt * 0.35;
  a.venomT -= dt;
  if (a.venomT <= 0) {
    a.venom = 0;
    a.venomDps = 0;
  }
  if (a.hp <= 0) {
    killAnt(w, a);
    return true;
  }
  return false;
}

export function combatPreempt(w: World, a: Ant, c: Colony, dt: number): boolean {
  if (venomTick(w, a, dt)) return true;
  const isQueen = a.id === c.queen;
  if (a.state === AS.Grapple) return grappleUpdate(w, a, c, dt);
  if (a.state === AS.Attack) return attackUpdate(w, a, c, dt);
  if (a.state === AS.Spray) return sprayUpdate(w, a, c, dt);
  if (isHellState(a.state)) return isSickle(a) ? sickleUpdate(w, a, c, dt, biteMul(w, a, c)) : hellUpdate(w, a, c, dt, biteMul(w, a, c));
  const cd0 = casteOf(a.caste);
  // a marker's "no attacking" order: its ants go after nobody (they still bite back when bitten: damageAnt)
  if (underOrder(c, a, 'noAttack')) {
    a.rushT = 0;
    return false;
  }
  // (termite workers fight like ant workers: user note 2026-10-25)
  // Nasutes lock on to the nearest enemy in range and sight (ties: lowest id) and fire the same tick.
  if (cd0.acid?.kind === 'ramp') {
    const t = acquireInRange(w, a, cd0.acid.range);
    if (t) {
      a.tgt = t.id;
      a.tk = t.kind;
      a.state = AS.Attack;
      a.st = 0;
      return attackUpdate(w, a, c, dt);
    }
  }
  // Alarm rush under way (chosen on a scan tick below): walk it tick by tick, as the only movement this tick
  if ((a.rushT ?? 0) > 0) {
    a.rushT! -= dt;
    if (a.alarm > 0.45 && a.carry === Carry.None && a.space === SURFACE && a.task !== 'marker') {
      turnToward(a, a.rushH!, dt, 8);
      moveForward(w, a, antSpeed(w, a) * 1.1, dt);
      a.pose = POSE.ALARM;
      if (w.s.tick % 4 !== a.id % 4) return true;
    } else a.rushT = 0;
  }
  // Threat scan (staggered)
  if (w.s.tick % 4 !== a.id % 4) return false;
  if (isQueen) {
    const t = findTarget(w, a, c, casteOf(a.caste).length * 0.9);
    if (t) {
      a.tgt = t.id;
      a.tk = t.kind;
      a.state = AS.Attack;
      a.st = 0;
      return true;
    }
    return false;
  }
  // Alarm pheromone draws ants toward the fight on the surface.
  if (a.space === SURFACE && a.carry === Carry.None) {
    const al = w.phero.sampleAlarm(a.x, a.y);
    if (al > 0.15) a.alarm = Math.max(a.alarm, Math.min(1, al));
  }
  const r = aggroRadius(w, a, c);
  const t = findTarget(w, a, c, r);
  if (t) {
    if (a.carry !== Carry.None && a.carry !== Carry.Soil) dropCarried(w, a);
    a.tgt = t.id;
    a.tk = t.kind;
    a.state = AS.Attack;
    a.st = 0;
    // Saiy-Ants flash gold as they enter combat; a termite major drums the alarm as it engages
    if (cd0.surge) startSurge(w, a);
    if (cd0.termite === 'major') majorAlarm(w, a);
    return true;
  }
  // Alarmed but no visible target: rush up the alarm scent. The heading is chosen here (every 4th tick) and walked
  // one tick at a time above; it was once a 4-tick step taken on top of the ant's own walk, which made ants that
  // had just won a fight lurch about in the lingering alarm scent (user note 2026-10-25). Ants under a marker hold
  // their marker instead of chasing the scent.
  if (a.alarm > 0.45 && a.space === SURFACE && a.carry === Carry.None && a.task !== 'marker') {
    let best = 0;
    let bh = a.h;
    for (let k = 0; k < 6; k++) {
      const h = (k / 6) * Math.PI * 2;
      const v = w.phero.sampleAlarm(a.x + dcos(h) * 8, a.y + dsin(h) * 8);
      if (v > best) {
        best = v;
        bh = h;
      }
    }
    if (best > 0.1) {
      a.rushH = bh;
      a.rushT = 4 / BALANCE.tickHz;
      turnToward(a, bh, dt, 8);
      moveForward(w, a, antSpeed(w, a) * 1.1, dt);
      a.pose = POSE.ALARM;
      return true;
    }
  }
  a.rushT = 0;
  return false;
}

function targetPos(w: World, a: Ant): { x: number; y: number; r: number; alive: boolean; space: number } | null {
  if (a.tk === 3) {
    const o = w.antById.get(a.tgt);
    if (!o || o.state === AS.Dead) return null;
    return { x: o.x, y: o.y, r: casteOf(o.caste).length * 0.45, alive: true, space: o.space };
  }
  if (a.tk === 4) {
    const cr = w.creatureById.get(a.tgt);
    if (!cr || cr.dead) return null;
    return { x: cr.x, y: cr.y, r: creatureHooks.radius(cr), alive: true, space: cr.space };
  }
  return null;
}

function endCombat(w: World, a: Ant): void {
  releaseSlot(w, a);
  releaseGrapple(w, a);
  clearApproach(a);
  a.state = AS.Idle;
  a.st = 0;
  a.tgt = 0;
  a.tk = 0;
}

function attackUpdate(w: World, a: Ant, c: Colony, dt: number): boolean {
  let t = targetPos(w, a);
  if (!t || t.space !== a.space) {
    // the target died or left: take the next one in sight at once rather than standing idle a tick
    // (not under a "no attacking" order: the fight it was drawn into is over)
    const n = underOrder(c, a, 'noAttack') ? null : findTarget(w, a, c, aggroRadius(w, a, c));
    if (n && !(n.id === a.tgt && n.kind === a.tk)) {
      a.tgt = n.id;
      a.tk = n.kind;
      a.st = 0;
      a.waitT = 0;
      clearApproach(a);
      t = targetPos(w, a);
    }
    if (!t || t.space !== a.space) {
      endCombat(w, a);
      return false;
    }
  }
  const cd = casteOf(a.caste);
  // large creatures and titans: climb up and ride it when the climb is ready, ranged units too (climbing.ts)
  if (a.tk === 4 && tryClimb(w, a, w.creatureById.get(a.tgt)!)) return true;
  if (cd.acid?.kind === 'ramp') return nasuteAttack(w, a, c, dt, biteMul(w, a, c));
  // Sickle-Jaw soldiers: lunge and grab, or bite and squirt what is too big to grab (sickleJaws.ts)
  if (cd.termite === 'sickle') return sickleAttack(w, a, c, dt, biteMul(w, a, c));
  const d = dhypot(t.x - a.x, t.y - a.y);
  if (cd.termite === 'major') majorCharge(a, d - t.r, t.r + cd.length * 0.45);
  // Give up pursuit if it runs far away (not for markers/alarmed soldiers).
  const leash = (cd.role === 'soldier' || cd.role === 'major' ? 90 : 45) + (cd.acid && cd.acid.kind !== 'opener' ? cd.acid.range : 0);
  // (measured from the target's edge: the far side of a titan's legs is no reason to give up)
  const edge = a.tk === 4 ? distToCreatureBody(w.creatureById.get(a.tgt)!, a.x, a.y) : d - t.r;
  if (edge > leash || a.st > 40) {
    endCombat(w, a);
    return false;
  }
  a.pose = POSE.ALARM;
  // hell ants: small prey within reach and the snap ready → stalk it (hellAnts.ts)
  if (cd.snap && startHunt(w, a, d, t.r)) return true;
  const acid = cd.acid;
  const shooter = acid?.kind === 'lob' || acid?.kind === 'rapid';
  const range = acid ? acid.range * abilityMods(c).acidRange * (a.level >= 3 && acid.kind === 'opener' ? BALANCE.perkAcidRange : 1) : 0;
  // Formicines spray acid when ready: workers as they close in (then bite),
  // shooters from range, again and again.
  if (acid && a.cd2 <= 0 && d < range + t.r && (shooter || d > t.r + cd.length * 0.3)) {
    a.state = AS.Spray;
    a.st = 0;
    return true;
  }
  if (shooter) {
    const reachS = t.r + cd.length * 0.45;
    if (d > range * 0.9 + t.r) {
      steerTo(w, a, t.x, t.y, dt, 1.0, 10);
      return true;
    }
    // Too close while reloading: back away to keep the range (shooters are fragile).
    if (d < range * 0.4 && a.pinned <= 0 && !grappledBy(w, a)) {
      const away = datan2(a.y - t.y, a.x - t.x);
      const h = a.h;
      a.h = away;
      moveForward(w, a, antSpeed(w, a) * 0.85, dt);
      a.h = h;
      faceToward(a, t.x, t.y, dt);
      return true;
    }
    // In range: hold the position and reload; nip at anything that climbs on.
    a.v = 0;
    faceToward(a, t.x, t.y, dt);
    if (d < reachS && a.cd <= 0 && a.tk === 3) {
      a.cd = cd.attackInterval;
      const o = w.antById.get(a.tgt);
      if (o) damageAnt(w, o, cd.bite * biteMul(w, a, c), 'bite', a);
    }
    return true;
  }
  // ---- melee (combat v2, CHANGE_PLAN §16 steps 2–5): reserve a free attack slot on the target as we close in, walk
  // to its hold point (our front half on its outline: no body overlap) and latch there; every slot taken: another
  // foe, or wait on a ring a personal space out; blocked on the way: pause and sidestep (slots.ts)
  const C = BALANCE.combat;
  const C2 = BALANCE.combat2;
  const L = cd.length;
  if (a.tk === 4) {
    const cr = w.creatureById.get(a.tgt)!;
    const dBody = distToCreatureBody(cr, a.x, a.y);
    const latchable = creatureHooks.canLatch(cr);
    if (sidestep(w, a, cr.x, cr.y, dt)) return true;
    if (dBody > frontOff(L) + L * (latchable ? 2.5 : 0.8)) {
      // head for the nearest point of its body, not its middle
      if (blocked(w, a, dBody, cr.v > antSpeed(w, a) * 0.25, dt)) return true;
      const b = bodyHook.body(cr);
      const off = frontOff(L);
      const c0 = dcos(cr.h);
      const s0 = dsin(cr.h);
      const dx = a.x - cr.x;
      const dy = a.y - cr.y;
      creatureSlotWorld(cr, off, outlineU(b, off, dx * c0 + dy * s0, -dx * s0 + dy * c0), slotTmp);
      steerTo(w, a, slotTmp.x, slotTmp.y, dt, 1.15, C.turnRate);
      leaveRing(w, a, true);
      return true;
    }
    if (!latchable) {
      // bite without latching (e.g. a rolled-up pill bug); still attack
      a.v = 0;
      faceToward(a, cr.x, cr.y, dt);
      if (a.cd <= 0) {
        a.cd = cd.attackInterval;
        damageCreature(w, cr, cd.bite * biteMul(w, a, c) * 0.5, 'bite', a);
      }
      return true;
    }
    // waiting in the ring: look for a free slot only every `ringCheckSec`
    if ((a.waitT ?? 0) > 0 && !ringCheckDue(a, dt)) return waitForSlot(w, a, c, cr.x, cr.y, dBody, frontOff(L) + C2.personalSpace * L, dt, cr);
    const u = reserveCreatureSlot(w, a, cr);
    if (u < 0) return waitForSlot(w, a, c, cr.x, cr.y, dBody, frontOff(L) + C2.personalSpace * L, dt, cr);
    if ((a.flk ?? 0) !== 0 && (a.rsv !== cr.id || a.gSlot !== u)) a.flk = 0;
    a.rsv = cr.id;
    a.gSlot = u;
    a.waitT = 0;
    const offU = creatureSlotOff(cr, L, u);
    creatureSlotWorld(cr, offU, u % 1, slotTmp);
    // beside our slot at about the hold distance (reserveCreatureSlot moves the slot to where we are when it can)
    const there = dBody <= offU + L * C2.arriveTol * 2 && dBody >= offU - L * (u >= 1 ? 1 : C2.arriveTol * 2) && dhypot(slotTmp.x - a.x, slotTmp.y - a.y) <= L * 0.6;
    if (!there && !approachHold(w, a, cr.x, cr.y, slotTmp.x, slotTmp.y, dt, cr.v > antSpeed(w, a) * 0.25)) return true;
  } else {
    const o = w.antById.get(a.tgt)!;
    const reach = casteOf(o.caste).length * C2.antHalfLen + frontOff(L);
    if (sidestep(w, a, o.x, o.y, dt)) return true;
    if (d > reach + L * 2.5) {
      if (blocked(w, a, d, o.v > antSpeed(w, a) * 0.25, dt)) return true;
      steerTo(w, a, t.x, t.y, dt, 1.15, C.turnRate);
      leaveRing(w, a, true);
      return true;
    }
    if ((a.waitT ?? 0) > 0 && !ringCheckDue(a, dt)) return waitForSlot(w, a, c, t.x, t.y, d - reach, C2.personalSpace * L, dt, null);
    const isQ = o.id === w.colony(o.colony)?.queen;
    const ang = reserveAntSlot(w, a, o, isQ);
    if (Number.isNaN(ang)) return waitForSlot(w, a, c, t.x, t.y, d - reach, C2.personalSpace * L, dt, null);
    // the only free slot is round the far side: a nearer foe with room first (overflow: switch, then flank)
    if (a.rsv !== o.id && Math.abs(angleDiff(ang, datan2(a.y - o.y, a.x - o.x))) > Math.PI / 2) {
      const n = underOrder(c, a, 'noAttack') ? null : findTarget(w, a, c, aggroRadius(w, a, c));
      if (n && !(n.id === a.tgt && n.kind === a.tk)) {
        releaseSlot(w, a);
        a.tgt = n.id;
        a.tk = n.kind;
        a.st = 0;
        clearApproach(a);
        return true;
      }
    }
    // a new slot (or a slot moved): choose the way round afresh
    if ((a.flk ?? 0) !== 0 && (a.rsv !== o.id || Math.abs(angleDiff(ang, a.gSlot)) > 1e-6)) a.flk = 0;
    a.rsv = o.id;
    a.gSlot = ang;
    a.waitT = 0;
    const holdsMe = o.tk === 3 && o.tgt === a.id && (o.state === AS.Attack || o.state === AS.Grapple || o.state === AS.Spray);
    if (holdsMe) {
      // it is coming for us too: meet head to head at reach (front half to front half, only the mandibles over)
      const D = mutualHold(L, casteOf(o.caste).length);
      const dd = Math.max(1e-6, d);
      if (d > D + L * C2.arriveTol) {
        slotTmp.x = o.x + ((a.x - o.x) / dd) * D;
        slotTmp.y = o.y + ((a.y - o.y) / dd) * D;
        if (!approachHold(w, a, o.x, o.y, slotTmp.x, slotTmp.y, dt, o.v > antSpeed(w, a) * 0.25)) return true;
      }
    } else {
      const hr = antHoldPoint(a, o, ang, slotTmp);
      // going round to it: a way past no held slot (their holders are in the way); none → it cannot get there: wait
      if ((a.flk ?? 0) === 0 && Math.abs(angleDiff(ang, datan2(a.y - o.y, a.x - o.x))) > C2.flankStep) {
        const side = flankSide(w, a, o, isQ, ang);
        if (side === 0) {
          releaseSlot(w, a);
          a.rsv = 0;
          return waitForSlot(w, a, c, t.x, t.y, d - reach, C2.personalSpace * L, dt, null);
        }
        a.flk = side;
      }
      // in our slot's sector at about the hold distance: there (the grapple eases us onto the point)
      const inSector = Math.abs(angleDiff(datan2(a.y - o.y, a.x - o.x), ang)) <= Math.PI / antSlotCount(o, L, isQ) && d <= hr + L * C2.arriveTol * 2;
      if (!inSector && !approachHold(w, a, o.x, o.y, slotTmp.x, slotTmp.y, dt, o.v > antSpeed(w, a) * 0.25)) return true;
    }
  }
  // at the hold point: latch on — where it stands, within its slot (no snapping across to the slot's middle)
  if (a.tk === 3) {
    const o = w.antById.get(a.tgt)!;
    const half = (Math.PI / antSlotCount(o, L, o.id === w.colony(o.colony)?.queen)) * 0.9;
    const off = angleDiff(datan2(a.y - o.y, a.x - o.x), a.gSlot);
    a.gSlot += Math.max(-half, Math.min(half, off));
  }
  a.waitT = 0;
  a.rsv = 0;
  a.blkT = 0;
  a.blkD = 0;
  if ((a.flk ?? 0) !== 0) a.flk = 0;
  a.gId = a.tgt;
  a.gKind = a.tk;
  a.state = AS.Grapple;
  a.st = 0;
  return true;
}

/** Forget the approach (reservation, blocked timer, pause): a new target or the fight is over. */
function clearApproach(a: Ant): void {
  if ((a.rsv ?? 0) !== 0) a.rsv = 0;
  if ((a.flk ?? 0) !== 0) a.flk = 0;
  if ((a.blkT ?? 0) !== 0) a.blkT = 0;
  if ((a.blkD ?? 0) !== 0) a.blkD = 0;
  if ((a.repT ?? 0) !== 0) a.repT = 0;
}

/** Far from the target again: give back a reserved slot, stop waiting (`chasing`: keep the blocked timer running). */
function leaveRing(w: World, a: Ant, chasing = false): void {
  if ((a.rsv ?? 0) !== 0) {
    releaseSlot(w, a);
    a.rsv = 0;
  }
  a.waitT = 0;
  if ((a.flk ?? 0) !== 0) a.flk = 0;
  if (chasing) return;
  if ((a.blkT ?? 0) !== 0) a.blkT = 0;
  if ((a.blkD ?? 0) !== 0) a.blkD = 0;
}

/** Waiting in the ring: has another `ringCheckSec` gone by (look for a free slot or another foe now)? */
function ringCheckDue(a: Ant, dt: number): boolean {
  const k = BALANCE.combat2.ringCheckSec;
  const t = a.waitT ?? 0;
  return Math.floor((t + dt) / k + 1e-9) !== Math.floor(t / k + 1e-9);
}

/**
 * Walk to the hold point (cx, cy: the target's centre). A slot more than `flankStep` round the ring is reached by
 * sidling round the ring facing the target (`flankSpeed`), never through it. Returns true when there (within `arriveTol` of the ant's length).
 * Blocked (EotU): no closer by `blockedGain` × its length in `blockedSec` while the target stands (`moving` false) →
 * a pause and a sidestep (`sidestep`).
 */
function approachHold(w: World, a: Ant, cx: number, cy: number, hx: number, hy: number, dt: number, moving: boolean): boolean {
  const C2 = BALANCE.combat2;
  const L = casteOf(a.caste).length;
  const d = dhypot(hx - a.x, hy - a.y);
  if (d <= L * C2.arriveTol) return true;
  if (blocked(w, a, d, moving, dt)) return false;
  const bearing = datan2(a.y - cy, a.x - cx);
  const want = datan2(hy - cy, hx - cx);
  const diff = angleDiff(want, bearing);
  if (Math.abs(diff) > C2.flankStep && moving) {
    // its slot is round the far side of a foe on the move: keep up on our side (no circling a moving foe); flank once
    // it stands
    const r = dhypot(hx - cx, hy - cy) + L * 0.3;
    if ((a.flk ?? 0) !== 0) a.flk = 0;
    steerTo(w, a, cx + dcos(bearing) * r, cy + dsin(bearing) * r, dt, 1.0, BALANCE.combat.turnRate);
  } else if (Math.abs(diff) > C2.flankStep) {
    // flank: sidle round the ring toward the slot, facing the target, a little outside the hold point (never through
    // it). The way round is chosen once (the shorter one; straight across, by the id) and kept, so an ant opposite its
    // slot does not dither between the two ways.
    const rNow = dhypot(a.x - cx, a.y - cy);
    const rWant = dhypot(hx - cx, hy - cy) + L * 0.3;
    // (attackUpdate picks the way past fewer held slots on an ant; turned back if it has just gone past its slot)
    if ((a.flk ?? 0) === 0 || ((a.flk ?? 0) * diff < 0 && Math.abs(diff) < Math.PI * 0.5)) a.flk = Math.abs(diff) > Math.PI * 0.9 ? (a.id & 1 ? 1 : -1) : diff > 0 ? 1 : -1;
    const side = a.flk ?? 1;
    const radial = Math.max(-1, Math.min(1, (rWant - rNow) / L));
    const h = a.h;
    a.h = datan2(dsin(bearing + side * (Math.PI / 2)) + dsin(bearing) * radial, dcos(bearing + side * (Math.PI / 2)) + dcos(bearing) * radial);
    moveForward(w, a, antSpeed(w, a) * C2.flankSpeed, dt);
    a.h = h;
    faceToward(a, cx, cy, dt);
  } else {
    if ((a.flk ?? 0) !== 0) a.flk = 0;
    steerTo(w, a, hx, hy, dt, d > L * 2 ? 1.1 : 0.9, BALANCE.combat.turnRate);
  }
  return false;
}

/**
 * The reposition rule (EotU: a unit that cannot reach its foe briefly stops attacking and moves to a better place): an
 * attacker that has not come `blockedGain` × its length closer (`d`: to its hold point, or to the foe while still far)
 * in `blockedSec`, while the foe stands (`moving` false: a chase is not a block), pauses `pauseMin`..`pauseMax` s and
 * sidesteps (`sidestep`; seeded time and side). Returns true when the pause starts.
 */
function blocked(w: World, a: Ant, d: number, moving: boolean, dt: number): boolean {
  const C2 = BALANCE.combat2;
  const L = casteOf(a.caste).length;
  if (moving || !(a.blkD ?? 0) || d < (a.blkD ?? 0) - L * C2.blockedGain) {
    a.blkD = d;
    a.blkT = 0;
    return false;
  }
  a.blkT = (a.blkT ?? 0) + dt;
  if ((a.blkT ?? 0) < C2.blockedSec) return false;
  const t = w.rng.range(C2.pauseMin, C2.pauseMax);
  a.repT = w.rng.next() < 0.5 ? t : -t;
  a.blkT = 0;
  a.blkD = 0;
  a.v = 0;
  return true;
}

/**
 * Paused after being blocked: no attacking for a moment, sidestepping round the target (cx, cy) at a steady
 * distance, facing it (the side is the sign of `repT`). Returns true while the pause lasts.
 */
function sidestep(w: World, a: Ant, cx: number, cy: number, dt: number): boolean {
  const rep = a.repT ?? 0;
  if (rep === 0) return false;
  const side = rep > 0 ? 1 : -1;
  const left = Math.abs(rep) - dt;
  a.repT = left <= 0 ? 0 : left * side;
  const ang = datan2(a.y - cy, a.x - cx) + side * Math.PI / 2;
  const h = a.h;
  a.h = ang;
  moveForward(w, a, antSpeed(w, a) * BALANCE.combat2.sidestepSpeed, dt);
  a.h = h;
  faceToward(a, cx, cy, dt);
  return true;
}

/**
 * Every slot on the target is taken: wait on a loose ring `ring` mm out (a personal space beyond the slots; for a
 * creature (`cr`) measured from its body, along its outline), facing the fight, backing off without turning round if
 * too close. `gap` is how far out the ant stands now, measured the same way. Every `ringCheckSec` it looks for another
 * foe with a free slot, and attackUpdate retries this one's slots.
 */
function waitForSlot(w: World, a: Ant, c: Colony, tx: number, ty: number, gap: number, ring: number, dt: number, cr: Creature | null): boolean {
  if ((a.rsv ?? 0) !== 0) {
    releaseSlot(w, a);
    a.rsv = 0;
  }
  const L = casteOf(a.caste).length;
  // how far beyond the ring it stands (negative: inside it)
  const off = gap - ring;
  if (off < -L * 0.5) {
    const h = a.h;
    a.h = datan2(a.y - ty, a.x - tx);
    moveForward(w, a, antSpeed(w, a) * 0.5, dt);
    a.h = h;
    faceToward(a, tx, ty, dt);
  } else if (off > L * 0.5) {
    if (cr) {
      const b = bodyHook.body(cr);
      const c0 = dcos(cr.h);
      const s0 = dsin(cr.h);
      const dx = a.x - cr.x;
      const dy = a.y - cr.y;
      creatureSlotWorld(cr, ring, outlineU(b, ring, dx * c0 + dy * s0, -dx * s0 + dy * c0), slotTmp);
    } else {
      const ang = datan2(a.y - ty, a.x - tx);
      const r = dhypot(a.x - tx, a.y - ty) - off;
      slotTmp.x = tx + dcos(ang) * r;
      slotTmp.y = ty + dsin(ang) * r;
    }
    steerTo(w, a, slotTmp.x, slotTmp.y, dt, 0.8, BALANCE.combat.turnRate);
  } else {
    a.v = 0;
    faceToward(a, tx, ty, dt);
  }
  const due = ringCheckDue(a, dt);
  a.waitT = (a.waitT ?? 0) + dt;
  if (due) {
    // a foe with room (findTarget skips full ones unless focus-firing, which may keep this one)
    const t = underOrder(c, a, 'noAttack') ? null : findTarget(w, a, c, aggroRadius(w, a, c));
    if (t && (t.id !== a.tgt || t.kind !== a.tk)) {
      a.tgt = t.id;
      a.tk = t.kind;
      a.st = 0;
      a.waitT = 0;
      clearApproach(a);
    }
  }
  return true;
}

/** Is any enemy holding on to this ant? */
function grappledBy(w: World, a: Ant): boolean {
  let held = false;
  w.antsNear(a.space, a.x, a.y, casteOf(a.caste).length * 1.5, (g) => {
    if (g.state === AS.Grapple && g.gId === a.id) held = true;
    return held;
  });
  return held;
}

export function biteMul(w: World, a: Ant, c: Colony): number {
  return (a.power || 1) * (c.player ? w.s.settings.statMul : w.s.settings.enemyStatMul) * (surging(a) ? BALANCE.surge.damageMul : 1);
}

/** Seconds to the next bite: the caste's interval, a little jitter, faster in the gold surge and the fire-ant frenzy. */
export function biteGap(w: World, a: Ant, c: Colony, interval: number): number {
  return (interval * (0.85 + w.rng.next() * 0.3)) / abilityMods(c).attackRate / (surging(a) ? BALANCE.surge.attackRateMul : 1);
}

function grappleUpdate(w: World, a: Ant, c: Colony, dt: number): boolean {
  const cd = casteOf(a.caste);
  a.pose = POSE.GRAPPLE;
  a.v = 0;
  if (a.gKind === 3) {
    const o = w.antById.get(a.gId);
    if (!o || o.state === AS.Dead || o.space !== a.space) {
      endCombat(w, a);
      return false;
    }
    const ol = casteOf(o.caste).length;
    // Two ants biting each other: neither moves round the other (the old feedback loop span them both); they hold head
    // to head at reach (combat v2: front half to front half, only the mandibles over), each easing half the error.
    const mutual = o.state === AS.Grapple && o.gKind === 3 && o.gId === a.id;
    if (mutual) {
      const D = mutualHold(cd.length, ol);
      const dx = a.x - o.x;
      const dy = a.y - o.y;
      const dd = dhypot(dx, dy);
      if (dd > D * 1.6) return regripAttack(a);
      if (dd > 1e-6 && a.pinned <= 0) {
        const k = Math.max(-antSpeed(w, a) * dt, Math.min(antSpeed(w, a) * dt, (D - dd) * Math.min(1, dt * 4) * 0.5));
        const nx = a.x + (dx / dd) * k;
        const ny = a.y + (dy / dd) * k;
        if (w.walkable(a.space, nx, ny)) {
          a.x = nx;
          a.y = ny;
        }
      }
    } else {
      // hold on at the slot's hold point (a world angle: the victim turning does not swing us round it). Close to it the
      // pull is gentle, so fighting allies near ours can ease us apart (separation.ts) instead of being snapped back on
      // top of each other every tick
      // it steps toward its hold point (its victim may be moving) at most `combat2.holdFollow` × its walking speed:
      // it keeps up and settles into place, it never snaps
      if (o.state === AS.Flung) return regripAttack(a); // knocked flying out of its grip
      antHoldPoint(a, o, a.gSlot, slotTmp);
      const gap = dhypot(slotTmp.x - a.x, slotTmp.y - a.y);
      const k = Math.min(1, dt * (gap > cd.length * GUARD.slotGive ? 10 : 1.5), gap > 1e-9 ? (antSpeed(w, a) * BALANCE.combat2.holdFollow * dt) / gap : 1);
      a.x += (slotTmp.x - a.x) * k;
      a.y += (slotTmp.y - a.y) * k;
    }
    faceToward(a, o.x, o.y, dt);
    // Spread-eagle: grapplers on opposite sides immobilise the victim.
    let opposite = false;
    w.antsNear(o.space, o.x, o.y, ol * 1.4, (g) => {
      if (g === a || g.state !== AS.Grapple || g.gId !== o.id || g.colony !== a.colony) return false;
      if (Math.abs(angleDiff(g.gSlot, a.gSlot)) > 2.0) {
        opposite = true;
        return true;
      }
      return false;
    });
    if (opposite) o.pinned = 0.3;
    // hell ants: the snap is ready again on small prey → let go of the leg and snap
    if (cd.snap && snapEligible(w, a, 3, o.id)) return regrip(w, a);
    if (a.cd <= 0) {
      a.cd = biteGap(w, a, c, cd.attackInterval);
      damageAnt(w, o, cd.bite * biteMul(w, a, c) * hookMul(a, casteOf(o.caste).armor), 'bite', a);
      if (cd.termite === 'major') glueBurst(w, a, 3, o.id);
      // army ants: the Soldier's hook holds the victim; a crowd of them spread-eagles it (eciton.ts)
      if (cd.species === 'eciton' && (o.state as AS) !== AS.Dead) afterBite(w, a, o);
      // Termant soldier: the glue burst from the frontal pore (termants.ts)
      if (cd.glue && (o.state as AS) !== AS.Dead) {
        const g = termantGlue(w, a, o);
        if (g) damageAnt(w, o, g, 'pure', a);
      }
      w.events.emit({ t: 'bite', x: o.x, y: o.y, space: o.space, strength: cd.bite / 10, by: a.caste, on: 'ant', gold: surging(a) || undefined });
      if (cd.sting) {
        applyVenom(w, o, cd.sting.dps * (a.power || 1), cd.sting.duration, cd.sting.maxStacks);
        w.events.emit({ t: 'sting', x: o.x, y: o.y, space: o.space, by: a.caste });
      }
    }
    // stinging ants curl the gaster under while they hold on (no more pivoting round the bite)
    if (cd.sting) a.pose = POSE.STING;
    return true;
  }
  const cr = w.creatureById.get(a.gId);
  if (!cr || cr.dead || cr.space !== a.space) {
    endCombat(w, a);
    return false;
  }
  // large creatures and titans: let go and climb up when the climb is ready (climbing.ts)
  if (tryClimb(w, a, cr)) return true;
  // Planted (user note 2026-10-25): we stand our ground beside the body and never swing round with it.
  // We keep the slot we took (gSlot: it caps how many ants fit round the body) but stand where we are,
  // facing the nearest point of the body and biting while it is in reach; when it has moved off we let go
  // and close in again, and when it turns into us we are pushed back out to our stance.
  const H = BALANCE.creatureHold;
  const L = cd.length;
  // (combat v2: the stance is the hold point — our front half on the outline — or, for a small ant under the body,
  // the ring under its edge among the legs)
  const off = creatureSlotOff(cr, L, a.gSlot);
  const under = a.gSlot >= 1;
  const b = bodyHook.body(cr);
  const c0 = dcos(cr.h);
  const s0 = dsin(cr.h);
  const ex = a.x - cr.x;
  const ey = a.y - cr.y;
  creatureSlotWorld(cr, off, outlineU(b, off, ex * c0 + ey * s0, -ex * s0 + ey * c0), slotTmp);
  const dBody = distToCreatureBody(cr, a.x, a.y);
  // well out of reach: let go and close in again on a free place beside it (attackUpdate reserves one)
  if (dBody - off > L * H.release) return regripAttack(a);
  if (dBody - off > L * H.reach) {
    // it has moved a little: step after it, keeping our slot (no bite until we are beside it again)
    steerTo(w, a, slotTmp.x, slotTmp.y, dt, 1.0, BALANCE.combat.turnRate);
    return true;
  }
  if (!under && dBody < off * 0.5) {
    // the body swung into us: shoved back out to our stance, never round it
    const px = slotTmp.x - a.x;
    const py = slotTmp.y - a.y;
    const d = dhypot(px, py);
    const step = Math.min(d, H.pushMmPerSec * L * dt);
    if (d > 1e-6 && w.walkable(a.space, a.x + (px / d) * step, a.y + (py / d) * step)) {
      a.x += (px / d) * step;
      a.y += (py / d) * step;
    }
  }
  a.v = 0;
  // facing the body: the nearest point of its middle line
  const ax = Math.max(-b.hl, Math.min(b.hl, ex * c0 + ey * s0));
  faceToward(a, cr.x + ax * c0, cr.y + ax * s0, dt);
  if (cd.snap && snapEligible(w, a, 4, cr.id)) return regrip(w, a);
  if (a.cd <= 0) {
    a.cd = biteGap(w, a, c, cd.attackInterval);
    damageCreature(w, cr, cd.bite * biteMul(w, a, c) * hookMul(a, creatureHooks.armor(cr)), 'bite', a);
    if (cd.termite === 'major') glueBurst(w, a, 4, cr.id);
    if (cd.glue && !cr.dead) {
      const g = termantGlue(w, a, cr);
      if (g) damageCreature(w, cr, g, 'pure', a);
    }
    w.events.emit({ t: 'bite', x: a.x, y: a.y, space: a.space, strength: cd.bite / 10, by: a.caste, on: 'creature', gold: surging(a) || undefined });
    if (cd.sting) {
      applyVenom(w, cr, cd.sting.dps * (a.power || 1), cd.sting.duration, cd.sting.maxStacks * 3);
      w.events.emit({ t: 'sting', x: a.x, y: a.y, space: a.space, by: a.caste });
    }
  }
  if (cd.sting) a.pose = POSE.STING;
  return true;
}

/** Lost hold of a mutual grapple (one was knocked away): close in again. */
function regripAttack(a: Ant): boolean {
  a.tgt = a.gId;
  a.tk = a.gKind;
  a.gId = 0;
  a.gKind = 0;
  a.state = AS.Attack;
  a.st = 0;
  return true;
}

/** A grappling hell ant lets go and stalks its prey again for the snap. */
function regrip(w: World, a: Ant): boolean {
  const tgt = a.gId;
  const tk = a.gKind;
  releaseGrapple(w, a);
  a.tgt = tgt;
  a.tk = tk;
  a.state = AS.Hunt;
  a.st = 0;
  return true;
}

function sprayUpdate(w: World, a: Ant, c: Colony, dt: number): boolean {
  const t = targetPos(w, a);
  const cd = casteOf(a.caste);
  if (!t || !cd.acid) {
    endCombat(w, a);
    return false;
  }
  const acid = cd.acid;
  a.v = 0;
  a.pose = POSE.SPRAY;
  faceToward(a, t.x, t.y, dt);
  // wind-up (gaster curling forward) and recovery, by spray kind
  const wind = acid.kind === 'rapid' ? 0.05 : acid.kind === 'lob' ? 0.5 : 0.45;
  const done = acid.kind === 'rapid' ? 0.1 : acid.kind === 'lob' ? 0.85 : 0.9;
  if (a.st >= wind - 1e-6 && a.cd2 <= 0) {
    // Gaster curled forward between the legs: jet (or arcing glob) of formic acid.
    const top = a.level >= 3;
    const dmg = acid.damage * biteMul(w, a, c);
    const sx = a.x + dcos(a.h) * cd.length * 0.3;
    const sy = a.y + dsin(a.h) * cd.length * 0.3;
    if (acid.kind === 'lob') {
      // Mortar: aim where the target will be when the glob lands.
      let tx = t.x;
      let ty = t.y;
      const d0 = dhypot(tx - sx, ty - sy);
      const life = Math.max(0.15, d0 / BALANCE.acidLobSpeed);
      if (a.tk === 3) {
        const o = w.antById.get(a.tgt);
        if (o) {
          tx += ((o.x - o.px) / 0.05) * life * 0.8;
          ty += ((o.y - o.py) / 0.05) * life * 0.8;
        }
      }
      const life2 = Math.max(0.15, dhypot(tx - sx, ty - sy) / BALANCE.acidLobSpeed);
      w.addProjectile({ id: w.nextId(), kind: 'acid', space: a.space, x: sx, y: sy, vx: (tx - sx) / life2, vy: (ty - sy) / life2, t: 0, dmg, colony: a.colony, tgt: a.tgt, tk: a.tk, lob: true, life: life2, splash: top ? BALANCE.perkMortarSplash : 0 });
      w.events.emit({ t: 'acid', x: sx, y: sy, tx, ty, space: a.space, lob: true, splash: top ? BALANCE.perkMortarSplash : 0 });
    } else {
      const ang = datan2(t.y - a.y, t.x - a.x);
      const v = BALANCE.acidJetSpeed;
      w.addProjectile({ id: w.nextId(), kind: 'acid', space: a.space, x: sx, y: sy, vx: dcos(ang) * v, vy: dsin(ang) * v, t: 0, dmg, colony: a.colony, tgt: a.tgt, tk: a.tk, life: (acid.range * 1.3) / v, slow: acid.kind === 'rapid' && top ? BALANCE.perkRapidSlow : 0 });
      w.events.emit({ t: 'acid', x: sx, y: sy, tx: t.x, ty: t.y, space: a.space });
    }
    a.cd2 = acid.cooldown * abilityMods(c).acidCd;
  }
  if (a.st > done) {
    a.state = AS.Attack;
    a.st = 0;
  }
  return true;
}

export function projectileSystem(w: World, dt: number): void {
  const keep = [];
  // distance² from (x, y) to the segment the projectile swept this tick (fast jets must not tunnel)
  const seg2 = (p: Projectile, x0: number, y0: number, x: number, y: number) => {
    const dx = p.x - x0;
    const dy = p.y - y0;
    const L2 = dx * dx + dy * dy;
    const u = L2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2)) : 1;
    return sq(x0 + dx * u - x) + sq(y0 + dy * u - y);
  };
  for (const p of w.s.projectiles) {
    const x0 = p.x;
    const y0 = p.y;
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    let hit = false;
    if (p.kind === 'acid' && p.lob) {
      // A lobbed glob flies over everything and lands at its aimed point.
      if (p.t >= (p.life ?? 0.6)) {
        landAcid(w, p);
        hit = true;
      }
    } else if (p.kind === 'acid') {
      // hit the intended target if within reach, otherwise any enemy on the path
      if (p.tk === 3) {
        const o = w.antById.get(p.tgt);
        if (o && o.state !== AS.Dead && seg2(p, x0, y0, o.x, o.y) < sq(casteOf(o.caste).length * 0.6)) {
          damageAnt(w, o, p.dmg, 'acid', null);
          if (p.slow) o.slowT = Math.max(o.slowT, p.slow);
          hit = true;
        }
      } else if (p.tk === 4) {
        const cr = w.creatureById.get(p.tgt);
        if (cr && !cr.dead && seg2(p, x0, y0, cr.x, cr.y) < sq(creatureHooks.radius(cr) + 1)) {
          damageCreature(w, cr, p.dmg, 'acid', null);
          if (p.slow) cr.slowT = Math.max(cr.slowT, p.slow);
          hit = true;
        }
      }
    }
    if (!hit && p.t < (p.life ?? 0.6)) keep.push(p);
  }
  w.s.projectiles = keep;
}

/** A mortar glob lands: it hits whatever enemy is under it, or splashes everything near (level 3). */
function landAcid(w: World, p: Projectile): void {
  const team = w.teamOf(p.colony);
  const r = p.splash && p.splash > 0 ? p.splash : 0;
  w.events.emit({ t: 'acidHit', x: p.x, y: p.y, space: p.space, splash: r });
  let struck = false;
  w.antsNear(p.space, p.x, p.y, Math.max(r, 6), (o, d2) => {
    if (o.state === AS.Dead || (o.team ?? o.colony) === team) return false;
    const reach = r > 0 ? r : casteOf(o.caste).length * 0.6 + 1;
    if (d2 > reach * reach) return false;
    damageAnt(w, o, p.dmg * (r > 0 && o.id !== p.tgt ? 0.7 : 1), 'acid', null);
    struck = true;
    return r <= 0; // single target without splash
  });
  if (!struck || r > 0) {
    for (const cr of w.s.creatures) {
      if (cr.dead || cr.space !== p.space || friendlyCreature(w, team, cr)) continue;
      const reach = (r > 0 ? r : 1) + creatureHooks.radius(cr);
      if (sq(cr.x - p.x) + sq(cr.y - p.y) < reach * reach) {
        damageCreature(w, cr, p.dmg, 'acid', null);
        if (r <= 0) break;
      }
    }
  }
}

/** Ants in nest invaded by enemies: ensure defenders respond (called per second). */
export function invasionCheck(w: World): void {
  for (const c of w.s.colonies) {
    const list: Array<{ x: number; y: number }> = [];
    c.intruders = list;
    if (!c.alive) continue;
    const space = nestSpace(c.id);
    for (const a of w.s.ants) if (a.space === space && (a.team ?? a.colony) !== c.team && a.state !== AS.Dead) list.push({ x: a.x, y: a.y });
    for (const cr of w.s.creatures) if (cr.space === space && !cr.dead) list.push({ x: cr.x, y: cr.y });
    if (list.length > 0) {
      c.alarmT = 25;
      if (c.player && w.s.tick % 200 === 0) w.events.emit({ t: 'invasion', colony: c.id });
      // Alarm spreads through the nest: ants near the intruders are fully alarmed.
      for (const a of w.s.ants) {
        if (a.space !== space || a.colony !== c.id) continue;
        let near = false;
        for (const p of list) if (sq(p.x - a.x) + sq(p.y - a.y) < 90 * 90) near = true;
        a.alarm = Math.max(a.alarm, near ? 1 : 0.5);
      }
    }
  }
}

export { setTask, goHome, goOut };
