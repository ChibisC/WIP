import { World } from './world';
import { Ant, AS, Colony, Creature, POSE } from './types';
import { BALANCE } from './balance';
import { casteOf } from './species';
import { applyVenom, biteGap, biteMul, damageCreature } from './combat';
import { glueBurst, rampDamage } from './termites';
import { steerTo } from './movement';
import { claimSlot, climbCap, climbDef, freeSlot, nearestOnRail, railPoint, riderUnits, slotPoint } from './creatures/climb';
import { datan2, dcos, dhypot, dsin } from './dmath';
import { underOrder } from './markers';

/**
 * Climbing large creatures and titans (CHANGE_PLAN §15.2).
 *
 *  Attack → Climb: ph 0  walk to the foot of the nearest rail (slot reserved)
 *                  ph 1  up the leg to the riding slot (`climb.up` s)
 *                  ph 2  ride, attacking point-blank (`climb.ride` s)
 *                  ph 3  down the rail to the foot (`climb.down` s)
 *         → Attack again on the ground, `climb.cooldown` s before the next climb.
 *
 * From the first step up the rail to the step off at the foot (ph 1–3) the
 * ant is untouchable: nothing damages or targets it (`riding`). The position
 * is the creature's root transform × the rest-pose rail or slot; no
 * pathfinding, separation or flow fields. If the creature dies, every rider
 * drops off beside it with a short (harmless) tumble. Riding slots go to the
 * lowest free id, ants in id order; each rider takes room on the back by its
 * size class (creatures/climb.ts), so a few soldiers fill what many small
 * workers would.
 */
const CB = BALANCE.climb;
const pt = { x: 0, y: 0, z: 0, h: 0 }; // det-ok: scratch
const near = { t: 0, d2: 0 }; // det-ok: scratch

/** On a creature (up the leg, riding or coming down): untouchable. */
export function riding(a: Ant): boolean {
  return a.state === AS.Climb && (a.ridePh ?? 0) >= 1;
}

/** Castes that climb: everyone but queens and kings. */
function climber(w: World, a: Ant): boolean {
  const cd = casteOf(a.caste);
  if (cd.role === 'queen' || cd.role === 'king') return false;
  return a.id !== w.colony(a.colony)?.queen;
}

/**
 * An ant attacking (or holding on to) creature `cr` (combat): start climbing
 * it if it can be climbed, the ant's cooldown is ready, a leg is close and a
 * riding slot is free. The ant gets on the nearest leg where it meets it (a
 * spider's long legs anywhere from the foot to the knee). Returns true if it
 * started.
 */
export function tryClimb(w: World, a: Ant, cr: Creature): boolean {
  if ((a.climbCd ?? 0) > 0 || cr.dead || cr.space !== a.space || a.heldBy) return false;
  // a marker's "no climbing" order: its ants fight creatures from the ground
  const col = w.colony(a.colony);
  if (col && underOrder(col, a, 'noClimb')) return false;
  const d = climbDef(cr.kind);
  if (!d || climbCap(cr) <= 0 || !climber(w, a)) return false;
  const units = riderUnits(casteOf(a.caste).length);
  const slot = freeSlot(w, cr, units);
  if (slot < 0) return false;
  // the nearest leg, ties to the lowest index
  let best = -1;
  let bd = Infinity;
  let bt = 0;
  for (let i = 0; i < d.rails.length; i++) {
    nearestOnRail(cr, i, slot, a.x, a.y, near);
    if (near.d2 < bd) {
      bd = near.d2;
      best = i;
      bt = near.t;
    }
  }
  const L = casteOf(a.caste).length;
  // close enough to a leg: a few of its own lengths, or on a titan anywhere near its body (it heads for the nearest leg)
  const join = Math.max(CB.joinMinMm, L * CB.joinBodyLengths, cr.scale * CB.joinOfCreature);
  if (best < 0 || bd > join * join) return false;
  claimSlot(w, cr, slot, units);
  a.state = AS.Climb;
  a.st = 0;
  a.rideId = cr.id;
  a.rideRail = best;
  a.rideSlot = slot;
  a.ridePh = 0;
  // where on the leg it gets on (progress 0 foot … 1 slot)
  a.rideT = bt;
  a.rideWalk = 0;
  a.tgt = cr.id;
  a.tk = 4;
  a.gId = 0;
  a.gKind = 0;
  return true;
}

/** Every tick for an ant in AS.Climb (antSystem, before stuns and the rest: a rider stays on). */
export function climbUpdate(w: World, a: Ant, c: Colony, dt: number): void {
  const cr = w.creatureById.get(a.rideId ?? 0);
  if (!cr || cr.space !== a.space || climbDef(cr.kind) === undefined) {
    stepOff(w, a, null);
    return;
  }
  if (cr.dead) {
    dropOff(w, a, cr);
    return;
  }
  const ph = a.ridePh ?? 0;
  const L = casteOf(a.caste).length;
  a.pose = POSE.GRAPPLE;
  if (ph === 0) {
    // walking to the leg
    railPoint(cr, a.rideRail ?? 0, a.rideSlot ?? 0, a.rideT ?? 0, pt);
    const d = dhypot(pt.x - a.x, pt.y - a.y);
    a.pose = POSE.ALARM;
    if (a.stun > 0 || a.pinned > 0) {
      a.v = 0;
    } else if (d > Math.max(0.6, L * 0.4)) steerTo(w, a, pt.x, pt.y, dt, 1.15, BALANCE.combat.turnRate);
    else {
      a.ridePh = 1;
      w.events.emit({ t: 'climb', x: a.x, y: a.y, space: a.space, phase: 'up', creature: cr.id, by: a.caste });
    }
    a.rideWalk = (a.rideWalk ?? 0) + dt;
    // could not get there (the creature kept moving away): give the slot back and fight on the ground
    if ((a.ridePh ?? 0) === 0 && (a.rideWalk ?? 0) > CB.approachMax) stepOff(w, a, cr, CB.cooldown * 0.5);
    return;
  }
  a.v = 0;
  a.stun = 0;
  a.pinned = 0;
  if (ph === 1) {
    a.rideT = (a.rideT ?? 0) + dt / CB.up;
    railPoint(cr, a.rideRail ?? 0, a.rideSlot ?? 0, a.rideT ?? 0, pt);
    place(a, pt);
    if ((a.rideT ?? 0) >= 1 - 1e-9) {
      a.ridePh = 2;
      a.rideT = 0;
      a.cd = Math.min(a.cd, 0.2);
    }
    return;
  }
  if (ph === 2) {
    slotPoint(cr, a.rideSlot ?? 0, pt);
    place(a, pt);
    riderAttack(w, a, c, cr);
    a.rideT = (a.rideT ?? 0) + dt;
    if ((a.rideT ?? 0) >= CB.ride - 1e-9) {
      a.ridePh = 3;
      a.rideT = 0;
      a.fire = 0;
      w.events.emit({ t: 'climb', x: a.x, y: a.y, space: a.space, phase: 'down', creature: cr.id, by: a.caste });
    }
    return;
  }
  // ph 3: back down the rail to the foot
  a.rideT = (a.rideT ?? 0) + dt / CB.down;
  railPoint(cr, a.rideRail ?? 0, a.rideSlot ?? 0, 1 - (a.rideT ?? 0), pt);
  place(a, pt);
  a.h = pt.h + Math.PI; // facing down the leg
  if ((a.rideT ?? 0) >= 1 - 1e-9) stepOff(w, a, cr, CB.cooldown);
}

function place(a: Ant, p: { x: number; y: number; h: number }): void {
  a.x = p.x;
  a.y = p.y;
  a.h = p.h;
}

/** Bites, stings, acid or glue at point-blank on the creature it rides. */
function riderAttack(w: World, a: Ant, c: Colony, cr: Creature): void {
  const cd = casteOf(a.caste);
  const mul = biteMul(w, a, c) * CB.damageMul;
  const acid = cd.acid;
  if (acid?.kind === 'ramp') {
    // nasutes: the glue stream, ramping as usual, from right on top of it
    if ((a.rampT ?? 0) !== cr.id) {
      a.rampT = cr.id;
      a.rampN = 0;
    }
    damageCreature(w, cr, rampDamage(a.rampN ?? 0) * mul, 'pure', a);
    a.rampN = (a.rampN ?? 0) + 1;
    a.fire = 1;
    a.pose = POSE.SPRAY;
    return;
  }
  if (acid && a.cd2 <= 0) {
    // formicines: the acid jet into the joints, no flight time
    damageCreature(w, cr, acid.damage * mul, 'acid', a);
    a.cd2 = acid.cooldown;
    a.pose = POSE.SPRAY;
    w.events.emit({ t: 'acid', x: a.x, y: a.y, tx: cr.x, ty: cr.y, space: a.space });
  }
  if (a.cd > 0) return;
  a.cd = biteGap(w, a, c, cd.attackInterval);
  if (cd.bite > 0) {
    damageCreature(w, cr, cd.bite * mul, 'bite', a);
    w.events.emit({ t: 'bite', x: a.x, y: a.y, space: a.space, strength: Math.min(1, (cd.bite / 10) * 1.4), by: a.caste, on: 'creature', riding: true });
  }
  if (cd.sting) {
    applyVenom(w, cr, cd.sting.dps * (a.power || 1), cd.sting.duration, cd.sting.maxStacks * 3);
    a.pose = POSE.STING;
    w.events.emit({ t: 'sting', x: a.x, y: a.y, space: a.space, by: a.caste });
  }
  if (cd.termite === 'major') glueBurst(w, a, 4, cr.id);
}

/** Off the creature at the foot of the rail (or anywhere, if it is gone): fight on the ground. */
function stepOff(w: World, a: Ant, cr: Creature | null, cooldown = CB.cooldown): void {
  a.rideId = 0;
  a.ridePh = 0;
  a.rideT = 0;
  a.climbCd = cooldown;
  a.fire = 0;
  if (cr && !cr.dead) {
    a.state = AS.Attack;
    a.tgt = cr.id;
    a.tk = 4;
  } else {
    a.state = AS.Idle;
    a.tgt = 0;
    a.tk = 0;
  }
  a.st = 0;
}

/** The creature died: drop off beside it with a short tumble that does not hurt, then carry on. */
function dropOff(w: World, a: Ant, cr: Creature): void {
  const wasUp = (a.ridePh ?? 0) >= 1;
  stepOff(w, a, null);
  if (!wasUp) return;
  const ang = datan2(a.y - cr.y, a.x - cr.x);
  const sp = 22;
  a.fvx = dcos(ang) * sp;
  a.fvy = dsin(ang) * sp;
  a.fvz = 30;
  a.fz = Math.max(0.5, cr.scale * 0.2);
  a.state = AS.Flung;
  a.softLand = true;
  w.events.emit({ t: 'climb', x: a.x, y: a.y, space: a.space, phase: 'drop', creature: cr.id, by: a.caste });
}

/** Climb cooldown (antSystem, every tick). */
export function climbTick(a: Ant, dt: number): void {
  if ((a.climbCd ?? 0) > 0) a.climbCd = Math.max(0, a.climbCd! - dt);
}
