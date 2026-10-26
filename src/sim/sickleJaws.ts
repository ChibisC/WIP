import { World } from './world';
import { Ant, AS, Colony, Creature, POSE } from './types';
import { BALANCE, SICKLE } from './balance';
import { casteOf } from './species';
import { creatureHooks, damageAnt, damageCreature, isEnemyAnt } from './combat';
import { distToCreatureBody } from './slots';
import { creatureHeld, isHeld } from './hellAnts';
import { faceToward, steerTo } from './movement';
import { dcos, dhypot, dsin } from './dmath';
import { SICKLE_SOCKET } from './termiteRoyalData';

/**
 * Sickle-Jaw Termites (docs/creatures/rhynchotermes-perarmatus.md; DESIGN "Sickle-Jaw Termites"):
 * the soldier's grab-and-squirt.
 *
 *  Attack → Snap  (the lunge: mandibles gape, strike, snap shut; the grab resolves
 *                  `LUNGE_TICKS` = round(snapAt × lungeSec × 20) = 6 ticks in)
 *         → Hold  (the victim hooked between the crossed mandible tips, pinned in front of
 *                  the soldier and unable to move or fight; the acid ramps 2 → 18 DPS
 *                  over 6 s, pure damage)
 *         → the victim dies: the soldier drops it (a corpse, food for ants) and takes the
 *           next target with the ramp reset; or the soldier dies: the victim is free the
 *           next tick (hellAnts.isHeld). Nothing else ends a hold: no release when hurt,
 *           stunned or ordered, no target switch, no retreat.
 *
 * Grabbable: enemy ants and latchable creatures up to `maxTargetSizeMul` × the soldier's
 * length, never bosses, queens or a termite king, not already held, and not being lunged at
 * by another soldier this tick (the lower id wins: ants update in id order). Anything bigger
 * is bitten every `freeTargetBiteInterval` and squirted with the same ramp while it stays
 * within range; the ramp resets on any tick it is out of range (sickleAttack).
 *
 * State: the target in tgt / tk, the hold in holdId / holdKind (shared with the hell ants),
 * squirt ticks in rampN, the free target's id in rampT, the miss cooldown in snapCd.
 * Deterministic: only + − × ÷ and Math.round on the sim's numbers.
 */
const H = BALANCE.tickHz;
const G = SICKLE.grab;
const A = SICKLE.acid;
/** ticks to reach the acid cap */
export const SICKLE_RAMP_TICKS = A.rampSec * H;
/** the lunge's snap (the grab resolves this many ticks in) */
export const LUNGE_TICKS = Math.round(G.snapAt * G.lungeSec * H);

/** Cumulative acid (HP) after n squirt ticks: the ramp. */
export function sickleRampTotal(n: number): number {
  const s = A.startDps;
  const c = A.capDps;
  const R = SICKLE_RAMP_TICKS;
  if (n <= R) return (s * n + ((c - s) * n * n) / (2 * R)) / H;
  return sickleRampTotal(R) + (c * (n - R)) / H;
}

/**
 * Acid of the next squirt tick when n have landed, in 1/1024 HP steps so the totals are exact
 * (binary fractions add up without drift: a 90 HP victim dies on squirt tick 150, not 151).
 */
export function sickleRampDamage(n: number): number {
  return (Math.round(sickleRampTotal(n + 1) * 1024) - Math.round(sickleRampTotal(n) * 1024)) / 1024;
}

/** Render hint: 0..1 of the way to the acid cap. */
export function sickleRampFraction(a: Ant): number {
  return Math.min(1, (a.rampN ?? 0) / SICKLE_RAMP_TICKS);
}

export function isSickle(a: Ant): boolean {
  return casteOf(a.caste).termite === 'sickle';
}

type Victim = { ant?: Ant; cr?: Creature; x: number; y: number; r: number; space: number; dead: boolean };

function victim(w: World, kind: number, id: number): Victim | null {
  if (kind === 3) {
    const o = w.antById.get(id);
    if (!o) return null;
    return { ant: o, x: o.x, y: o.y, r: casteOf(o.caste).length * 0.45, space: o.space, dead: o.state === AS.Dead };
  }
  if (kind === 4) {
    const cr = w.creatureById.get(id);
    if (!cr) return null;
    return { cr, x: cr.x, y: cr.y, r: creatureHooks.radius(cr), space: cr.space, dead: cr.dead };
  }
  return null;
}

/** From the soldier to the victim's edge (a creature's body outline). */
function edgeDist(a: Ant, v: Victim): number {
  if (v.cr) return distToCreatureBody(v.cr, a.x, a.y);
  return dhypot(v.x - a.x, v.y - a.y) - v.r;
}

// ---- one soldier per victim: who is lunging at whom this tick (ants update in id order; a per-tick cache on the World)
const vkey = (kind: number, id: number) => (kind === 3 ? id : -id);

function lungingMap(w: World): Map<number, number> {
  const L = w.tickCache.lunging;
  if (L.tick !== w.s.tick) {
    L.tick = w.s.tick;
    L.map.clear();
    for (const o of w.s.ants) if (o.state === AS.Snap && o.tgt && isSickle(o)) L.map.set(vkey(o.tk, o.tgt), o.id);
  }
  return L.map;
}

function lungedAtBy(w: World, kind: number, id: number): number {
  return lungingMap(w).get(vkey(kind, id)) ?? 0;
}

/** Can this soldier grab that target (size, kind, free, not lunged at by another soldier)? */
export function grabbable(w: World, a: Ant, kind: number, id: number): boolean {
  const L = casteOf(a.caste).length;
  const by = lungedAtBy(w, kind, id);
  if (by && by !== a.id) return false;
  if (kind === 3) {
    const o = w.antById.get(id);
    if (!o || o.state === AS.Dead || !isEnemyAnt(a, o) || isHeld(w, o)) return false;
    const od = casteOf(o.caste);
    return od.role !== 'queen' && od.role !== 'king' && od.length <= G.maxTargetSizeMul * L;
  }
  if (kind !== 4) return false;
  const cr = w.creatureById.get(id);
  if (!cr || cr.dead || creatureHeld(w, cr)) return false;
  return !cr.data.boss && cr.scale <= G.maxTargetSizeMul * L && creatureHooks.canLatch(cr);
}

/**
 * The soldier in Attack (combat.attackUpdate hands it over after the climbing check): close in;
 * a grabbable target within range → lunge (when the miss cooldown is over); a target too big to
 * grab → bite and squirt it while it is in range.
 */
export function sickleAttack(w: World, a: Ant, c: Colony, dt: number, mul: number): boolean {
  const v = victim(w, a.tk, a.tgt);
  if (!v || v.dead || v.space !== a.space) {
    a.state = AS.Idle;
    a.st = 0;
    a.tgt = 0;
    a.tk = 0;
    return false;
  }
  const cd = casteOf(a.caste);
  const L = cd.length;
  const d = edgeDist(a, v);
  a.pose = POSE.ALARM;
  if (grabbable(w, a, a.tk, a.tgt) && (!c.ai || c.player || mayCommit(w, a))) {
    a.rampT = 0;
    a.rampN = 0;
    if (d <= G.lungeRangeBodyLengths * L) {
      a.v = 0;
      faceToward(a, v.x, v.y, dt);
      if ((a.snapCd ?? 0) > 0) return true;
      // the lunge: mandibles gape and it strikes
      a.state = AS.Snap;
      a.st = 0;
      lungingMap(w).set(vkey(a.tk, a.tgt), a.id);
      return true;
    }
    steerTo(w, a, v.x, v.y, dt, 1.05, BALANCE.combat.turnRate);
    return true;
  }
  // held by someone else, or being lunged at: look for another (the threat scan picks one next tick)
  if (v.ant && (isHeld(w, v.ant) || lungedAtBy(w, 3, v.ant.id))) return dropTarget(a);
  if (v.cr && (creatureHeld(w, v.cr) || lungedAtBy(w, 4, v.cr.id))) return dropTarget(a);
  // too big to grab: bite and squirt it while it stays in range; the ramp resets whenever it is out
  if ((a.rampT ?? 0) !== a.tgt) {
    a.rampT = a.tgt;
    a.rampN = 0;
  }
  // contact range; once squirting it keeps on through small shoves (the same slack as the lunge's snap)
  if (d <= (A.freeTargetRangeBodyLengths + ((a.rampN ?? 0) > 0 ? G.snapSlackBodyLengths : 0)) * L) {
    a.v = 0;
    faceToward(a, v.x, v.y, dt);
    const acid = sickleRampDamage(a.rampN ?? 0) * mul;
    if (v.ant) damageAnt(w, v.ant, acid, 'pure', a);
    else if (v.cr) damageCreature(w, v.cr, acid, 'pure', a);
    a.rampN = (a.rampN ?? 0) + 1;
    a.fire = 1;
    if (a.cd <= 0) {
      a.cd = A.freeTargetBiteInterval;
      if (v.ant && v.ant.state !== AS.Dead) damageAnt(w, v.ant, cd.bite * mul, 'bite', a);
      else if (v.cr && !v.cr.dead) damageCreature(w, v.cr, cd.bite * mul, 'bite', a);
      w.events.emit({ t: 'bite', x: v.x, y: v.y, space: v.space, strength: cd.bite / 10, by: a.caste, on: v.ant ? 'ant' : 'creature' });
    }
    return true;
  }
  a.rampN = 0;
  a.fire = 0;
  steerTo(w, a, v.x, v.y, dt, 1.05, BALANCE.combat.turnRate);
  return true;
}

/**
 * AI colonies (SICKLE.ai): lock attackers down one by one, but commit at most `maxCommitFraction` of
 * the soldiers nearby to holds and keep `reserveSoldiers` free to guard them (those bite and squirt
 * instead, free to turn on whoever attacks a holder).
 */
function mayCommit(w: World, a: Ant): boolean {
  const R = 12 * casteOf(a.caste).length;
  let n = 0;
  let held = 0;
  w.antsNear(a.space, a.x, a.y, R, (o) => {
    if (o.colony !== a.colony || o.state === AS.Dead || !isSickle(o)) return false;
    n++;
    if (o !== a && (o.state === AS.Hold || o.state === AS.Snap)) held++;
    return false;
  });
  const AI = SICKLE.ai;
  const limit = n <= AI.reserveSoldiers ? 1 : Math.min(Math.floor(AI.maxCommitFraction * n), n - AI.reserveSoldiers);
  return held < Math.max(1, limit);
}

function dropTarget(a: Ant): boolean {
  a.state = AS.Idle;
  a.st = 0;
  a.tgt = 0;
  a.tk = 0;
  a.rampT = 0;
  a.rampN = 0;
  return false;
}

/** The lunge (Snap) and the hold (Hold): combat.combatPreempt dispatches here for sickle soldiers. */
export function sickleUpdate(w: World, a: Ant, c: Colony, dt: number, mul: number): boolean {
  const L = casteOf(a.caste).length;
  a.fire = 0;
  if (a.state === AS.Snap) {
    a.v = 0;
    a.pose = POSE.ALARM;
    const v = victim(w, a.tk, a.tgt);
    if (v && !v.dead && v.space === a.space) faceToward(a, v.x, v.y, dt);
    if (a.st * H + 1e-6 < LUNGE_TICKS) return true;
    // the snap: hooked if it is still alive, in reach and free; otherwise the jaws close on nothing
    const free = v && !v.dead && (v.ant ? !isHeld(w, v.ant) : v.cr ? !creatureHeld(w, v.cr) : false);
    if (!v || !free || v.space !== a.space || edgeDist(a, v) > (G.lungeRangeBodyLengths + G.snapSlackBodyLengths) * L) {
      a.snapCd = G.missCooldownSec;
      a.state = AS.Attack;
      a.st = 0;
      w.events.emit({ t: 'grabMiss', x: a.x, y: a.y, space: a.space, soldier: a.id });
      return true;
    }
    if (v.ant) damageAnt(w, v.ant, G.biteDamage * mul, 'bite', a);
    else if (v.cr) damageCreature(w, v.cr, G.biteDamage * mul, 'bite', a);
    if ((v.ant && v.ant.state === AS.Dead) || (v.cr && v.cr.dead)) return dropTarget(a);
    a.holdId = a.tgt;
    a.holdKind = a.tk;
    a.holdT = 0;
    a.rampN = 0;
    a.rampT = 0;
    a.state = AS.Hold;
    a.st = 0;
    if (v.ant) {
      v.ant.heldBy = a.id;
      v.ant.stun = Math.max(v.ant.stun, 0.25);
      v.ant.tgt = 0;
      v.ant.tk = 0;
    } else if (v.cr) {
      v.cr.data.heldBy = a.id;
      v.cr.stun = Math.max(v.cr.stun, 0.25);
    }
    pin(a, v, L);
    w.events.emit({ t: 'grab', x: v.x, y: v.y, space: v.space, soldier: a.id, target: a.holdId });
    sickleAlarm(w, a);
    return true;
  }
  // ---- Hold: planted; the victim pinned in the socket; the acid ramps until one of them dies
  a.v = 0;
  const v = victim(w, a.holdKind ?? 0, a.holdId ?? 0);
  if (!v || v.dead || v.space !== a.space) return endHold(w, a, v);
  pin(a, v, L);
  a.pose = POSE.GRAPPLE;
  const acid = sickleRampDamage(a.rampN ?? 0) * mul;
  a.rampN = (a.rampN ?? 0) + 1;
  a.fire = 1;
  if (v.ant) damageAnt(w, v.ant, acid, 'pure', a);
  else if (v.cr) damageCreature(w, v.cr, acid, 'pure', a);
  return true;
}

/**
 * Pin the victim where the renderer draws it: its front in the crossed mandible tips (the kit's
 * socket, SICKLE_SOCKET), facing the soldier, unable to move or fight (stunned while held).
 */
function pin(a: Ant, v: Victim, L: number): void {
  const k = L / SICKLE.sizeMm.soldier;
  const front = v.ant ? casteOf(v.ant.caste).length * 0.5 : v.r;
  const dist = SICKLE_SOCKET.x * k + front;
  const x = a.x + dcos(a.h) * dist;
  const y = a.y + dsin(a.h) * dist;
  if (v.ant) {
    v.ant.x = x;
    v.ant.y = y;
    v.ant.h = a.h + Math.PI;
    v.ant.v = 0;
    v.ant.stun = Math.max(v.ant.stun, 0.25);
  } else if (v.cr) {
    v.cr.x = x;
    v.cr.y = y;
    v.cr.h = a.h + Math.PI;
    v.cr.v = 0;
    v.cr.stun = Math.max(v.cr.stun, 0.25);
  }
  v.x = x;
  v.y = y;
}

/** The victim died (or is gone): drop it, reset the ramp, free for the next target. */
function endHold(w: World, a: Ant, v: Victim | null): boolean {
  if (v?.ant && v.ant.heldBy === a.id) v.ant.heldBy = 0;
  if (v?.cr && v.cr.data.heldBy === a.id) v.cr.data.heldBy = 0;
  w.events.emit({ t: 'grabRelease', x: v?.x ?? a.x, y: v?.y ?? a.y, space: a.space, soldier: a.id, target: a.holdId ?? 0, reason: 'victimDied' });
  a.holdId = 0;
  a.holdKind = 0;
  a.holdT = 0;
  return dropTarget(a);
}

/** The soldier died holding someone (antAI.killAnt → termites.onTermiteDied): the victim is free next tick. */
export function holderDied(w: World, a: Ant): void {
  if (!a.holdId) return;
  const v = victim(w, a.holdKind ?? 0, a.holdId);
  w.events.emit({ t: 'grabRelease', x: v?.x ?? a.x, y: v?.y ?? a.y, space: a.space, soldier: a.id, target: a.holdId, reason: 'holderDied' });
  a.holdId = 0;
  a.holdKind = 0;
}

/**
 * The alarm (SICKLE.alarm): a termite of the colony attacked, or a soldier grabbing, alerts the
 * colony's termites within `radiusBodyLengths`; idle soldiers rush to it with their mandibles open
 * (termites.termiteTick), the alarming soldier drums. Units on a player's marker keep their orders.
 */
export function sickleAlarm(w: World, a: Ant): void {
  if ((a.alCd ?? 0) > 0) return;
  const k = SICKLE.alarm;
  a.alCd = k.cooldownSec;
  const R = k.radiusBodyLengths * casteOf(a.caste).length;
  const until = w.s.tick + k.alertSec * H;
  w.events.emit({ t: 'headbang', x: a.x, y: a.y, space: a.space });
  w.antsNear(a.space, a.x, a.y, R, (o) => {
    if (o.colony !== a.colony || o.state === AS.Dead || !casteOf(o.caste).termite) return false;
    o.alertUntil = until;
    o.alX = a.x;
    o.alY = a.y;
    return false;
  });
}
