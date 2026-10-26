import { World } from './world';
import { Ant, AS, Colony, Creature, POSE, snapping } from './types';
import { BALANCE } from './balance';
import { casteOf } from './species';
import { damageAnt, damageCreature, applyVenom, creatureHooks } from './combat';
import { faceToward, steerTo } from './movement';
import { dcos, dhypot, dsin } from './dmath';

/**
 * Hell ants (Haidomyrmecinae; docs/creatures/hell-ant.md): the vertical snap.
 *
 *  Attack → Hunt  (creep in at ×0.35 speed, mandibles cocked: the readable wind-up)
 *         → Snap  (the mandibles fly up: `snap.snapTime`, 2 ticks)
 *         → Hold  (prey pinned against the horn — soldiers drive it onto the
 *                  hardened paddle first: a burst — held off the ground at the
 *                  mandible–horn socket, stung and slowed, bled every 0.5 s)
 *         → release (hold time over, prey dead after a short feed, the hell
 *                  ant hurt, stunned, pinned or flung, or the prey's space changed).
 *
 * Only small prey is snapped (ants up to the caste's `snap.maxPreyMass`,
 * creatures up to `BALANCE.snap.preyCreatureLength` mm that can be latched
 * onto, never bosses or queens); anything larger is grappled by the legs with
 * the normal bite and sting. A grappling hell ant whose snap comes ready on
 * small prey lets go and hunts again. No randomness here.
 */
const S = BALANCE.snap;

type Prey = { ant?: Ant; cr?: Creature; x: number; y: number; r: number; space: number; dead: boolean };

function prey(w: World, kind: number, id: number): Prey | null {
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

/** Can this hell ant snap that target now? */
export function snapEligible(w: World, a: Ant, kind: number, id: number): boolean {
  const sn = casteOf(a.caste).snap;
  if (!sn || (a.snapCd ?? 0) > 0 || (a.holdId ?? 0) !== 0 || a.carry !== 0) return false;
  if (kind === 3) {
    const o = w.antById.get(id);
    if (!o || o.state === AS.Dead || isHeld(w, o)) return false;
    const oc = w.colony(o.colony);
    return casteOf(o.caste).mass <= sn.maxPreyMass && o.id !== oc?.queen && casteOf(o.caste).role !== 'king';
  }
  if (kind !== 4) return false;
  const cr = w.creatureById.get(id);
  if (!cr || cr.dead || creatureHeld(w, cr)) return false;
  return cr.scale <= S.preyCreatureLength && !cr.data.boss && creatureHooks.canLatch(cr);
}

/** Attack → Hunt when the prey is close and the snap is ready (called from combat's attackUpdate). */
export function startHunt(w: World, a: Ant, dist: number, r: number): boolean {
  if (dist > r + casteOf(a.caste).length * 0.9) return false;
  if (!snapEligible(w, a, a.tk, a.tgt)) return false;
  a.state = AS.Hunt;
  a.st = 0;
  return true;
}

export const isHellState = snapping;

/** The hunt / snap / hold states (combat.combatPreempt dispatches here). */
export function hellUpdate(w: World, a: Ant, c: Colony, dt: number, biteMul: number): boolean {
  const cd = casteOf(a.caste);
  const sn = cd.snap;
  if (!sn) return back(a);
  const L = cd.length;
  if (a.state === AS.Hunt) {
    const p = prey(w, a.tk, a.tgt);
    if (!p || p.dead || p.space !== a.space || !snapEligible(w, a, a.tk, a.tgt)) return back(a);
    const d = dhypot(p.x - a.x, p.y - a.y);
    if (d > p.r + L * S.huntLeash || a.st > S.huntMax) return back(a);
    a.pose = POSE.ALARM;
    if (d > p.r + L * 0.45) steerTo(w, a, p.x, p.y, dt, S.creep, BALANCE.combat.turnRate);
    else {
      a.v = 0;
      faceToward(a, p.x, p.y, dt);
    }
    if (d <= p.r + L * 0.5 && a.st + 1e-9 >= sn.windup) {
      a.state = AS.Snap;
      a.st = 0;
    }
    return true;
  }
  if (a.state === AS.Snap) {
    a.v = 0;
    a.pose = POSE.ALARM;
    if (a.st + 1e-9 < S.snapTime) return true;
    const p = prey(w, a.tk, a.tgt);
    if (!p || p.dead || p.space !== a.space || dhypot(p.x - a.x, p.y - a.y) > p.r + L * 0.9 || !snapEligible(w, a, a.tk, a.tgt)) {
      // missed: the jaws close on nothing; a short recovery before the next try
      a.snapCd = sn.cooldown * 0.3;
      return back(a);
    }
    // caught: up against the horn
    a.holdId = a.tgt;
    a.holdKind = a.tk;
    a.holdT = sn.hold;
    a.state = AS.Hold;
    a.st = 0;
    if (p.ant) {
      p.ant.heldBy = a.id;
      p.ant.stun = Math.max(p.ant.stun, 0.25);
    } else if (p.cr) {
      p.cr.data.heldBy = a.id;
      p.cr.stun = Math.max(p.cr.stun, 0.25);
    }
    w.events.emit({ t: 'snap', x: p.x, y: p.y, space: p.space, by: a.caste, impale: sn.kind === 'impale' });
    if (sn.kind === 'impale' && sn.burst) {
      if (p.ant) damageAnt(w, p.ant, sn.burst * biteMul, 'bite', a);
      else if (p.cr) damageCreature(w, p.cr, sn.burst * biteMul, 'bite', a);
    }
    a.cd = cd.attackInterval * 0.5;
    return true;
  }
  // ---- Hold
  a.v = 0;
  const p = prey(w, a.holdKind ?? 0, a.holdId ?? 0);
  if (!p || p.space !== a.space) return release(w, a, false);
  // pin the prey at the mandible–horn socket, off the ground, across the jaws
  const fx = a.x + dcos(a.h) * L * S.holdForward;
  const fy = a.y + dsin(a.h) * L * S.holdForward;
  if (p.ant) {
    p.ant.x = fx;
    p.ant.y = fy;
    p.ant.h = a.h + Math.PI / 2;
    p.ant.v = 0;
    if (!p.dead) p.ant.stun = Math.max(p.ant.stun, 0.25);
  } else if (p.cr) {
    p.cr.x = fx;
    p.cr.y = fy;
    p.cr.v = 0;
    if (!p.dead) p.cr.stun = Math.max(p.cr.stun, 0.25);
  }
  if (p.dead) {
    // feed briefly at the horn base, then drop the body (it becomes food as usual)
    a.pose = POSE.TROPH;
    a.holdT = Math.min(a.holdT ?? 0, S.feed) - dt;
    if ((a.holdT ?? 0) <= 1e-9) return release(w, a, true);
    return true;
  }
  a.holdT = (a.holdT ?? 0) - dt;
  // the pin bleeds the prey every 0.5 s
  const every = Math.max(1, Math.round(S.dotEvery * BALANCE.tickHz));
  const k = Math.round(a.st * BALANCE.tickHz);
  if (k > 0 && k % every === 0) {
    const dmg = sn.dps * S.dotEvery * biteMul;
    if (p.ant) damageAnt(w, p.ant, dmg, 'bite', a);
    else if (p.cr) damageCreature(w, p.cr, dmg, 'bite', a);
  }
  // …and the sting paralyses it
  if (a.cd <= 0 && cd.sting) {
    a.cd = cd.attackInterval;
    a.pose = POSE.STING;
    if (p.ant && p.ant.state !== AS.Dead) {
      applyVenom(w, p.ant, cd.sting.dps * (a.power || 1), cd.sting.duration, cd.sting.maxStacks);
      p.ant.slowT = Math.max(p.ant.slowT, S.stingSlow);
    } else if (p.cr && !p.cr.dead) {
      applyVenom(w, p.cr, cd.sting.dps * (a.power || 1), cd.sting.duration, cd.sting.maxStacks * 3);
      p.cr.slowT = Math.max(p.cr.slowT, S.stingSlow);
    }
    w.events.emit({ t: 'sting', x: p.x, y: p.y, space: p.space, by: a.caste });
  } else if (a.pose === POSE.NONE) a.pose = POSE.GRAPPLE;
  if ((a.holdT ?? 0) <= 1e-9) return release(w, a, true);
  return true;
}

function back(a: Ant): boolean {
  a.state = AS.Attack;
  a.st = 0;
  return true;
}

/**
 * Let the prey go: the hold ran out or the prey died (`done`: the snap goes on
 * its full cooldown), or the hell ant was hurt / stunned / pinned / flung (half).
 * The dropped prey is dazed for a moment.
 */
export function release(w: World, a: Ant, done: boolean): boolean {
  const sn = casteOf(a.caste).snap;
  if (a.holdKind === 3) {
    const o = w.antById.get(a.holdId ?? 0);
    if (o && o.heldBy === a.id) {
      o.heldBy = 0;
      if (o.state !== AS.Dead) o.stun = Math.max(o.stun, S.dropStun);
    }
  } else if (a.holdKind === 4) {
    const cr = w.creatureById.get(a.holdId ?? 0);
    if (cr && cr.data.heldBy === a.id) {
      cr.data.heldBy = 0;
      if (!cr.dead) cr.stun = Math.max(cr.stun, S.dropStun);
    }
  }
  a.holdId = 0;
  a.holdKind = 0;
  a.holdT = 0;
  const col = w.colony(a.colony);
  const cool = sn ? (done ? sn.cooldown : sn.cooldown * 0.5) : 0;
  // Ambush (the colony ability): the snap is ready again at once
  a.snapCd = col && (col.abilityT ?? 0) > 0 && col.species === 'hell' ? 0 : cool;
  if (isHellState(a.state)) {
    a.state = AS.Idle;
    a.st = 0;
    a.tgt = 0;
    a.tk = 0;
  }
  return false;
}

/** Every tick (antSystem): the snap cooldown, and dropping a hold the ant can no longer keep. */
export function snapTick(w: World, a: Ant, dt: number): void {
  if ((a.snapCd ?? 0) > 0) a.snapCd = Math.max(0, a.snapCd! - dt);
  // (a sickle-jaw's hold ends only with a death: sickleJaws.ts)
  if ((a.holdId ?? 0) !== 0 && (a.state !== AS.Hold || ((a.stun > 0 || a.pinned > 0) && casteOf(a.caste).termite !== 'sickle'))) release(w, a, false);
}

/** Is this ant in a hell ant's jaws? (clears a stale hold, e.g. its holder died) */
export function isHeld(w: World, a: Ant): boolean {
  if (!a.heldBy) return false;
  const h = w.antById.get(a.heldBy);
  if (!h || h.state !== AS.Hold || h.holdId !== a.id || h.holdKind !== 3) {
    a.heldBy = 0;
    return false;
  }
  return true;
}

export function creatureHeld(w: World, cr: Creature): boolean {
  const id = cr.data.heldBy;
  if (!id) return false;
  const h = w.antById.get(id);
  if (!h || h.state !== AS.Hold || h.holdId !== cr.id || h.holdKind !== 4) {
    cr.data.heldBy = 0;
    return false;
  }
  return true;
}
