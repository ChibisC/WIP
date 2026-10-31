import { World } from './world';
import { Ant, AS, Colony, Creature, POSE } from './types';
import { BALANCE } from './balance';
import { casteOf } from './species';
import { applyVenom, biteGap, biteMul, damageCreature, flingAnt } from './combat';
import { steerTo } from './movement';
import { canMount, claimSlot, climbCap, climbDef, colonyOn, fightsFromGround, freeSlot, nearestOnRail, railPoint, slotPoint } from './creatures/climb';
import { datan2, dcos, dhypot, dsin } from './dmath';
import { underOrder } from './markers';
import { killAnt } from './antAI';

/**
 * Mounting large creatures and titans (EotU; combat v2, CHANGE_PLAN §16 step 8; first version §15.2).
 *
 *  Attack → Climb: ph 0  walk to the nearest point of the nearest leg (its mount slot reserved)
 *                  ph 1  up the rail to the mount slot (`climb.up` s from the foot)
 *                  ph 2  ride, biting (`climb.ride` s)
 *                  ph 3  down the rail to the foot (`climb.down` s)
 *         → Attack again on the ground, `climb.cooldown` s before the next climb.
 *
 * Who: ants and termites whose caste may mount this creature (creatures/climb.ts `canMount`: small castes large and
 * huge creatures, large castes only huge ones, some never). How many: the creature's cap (`mount.capLarge` /
 * `capHuge`, fewer where its mount slots run out), and a colony's riders at most `mount.ratio` of its ants fighting
 * that creature (no ground force, no mounting); over the ratio the longest-mounted climb down first
 * (`enforceMountRatio`, every tick). Riders bite only (fire ants also sting): no acid, glue or nasute spray. They
 * climb down when their time is up or the marker orders no attacking / no climbing; they drop off unhurt when the
 * creature dies, die with it when it leaves the map, and a titan's shake-off throws them down (`throwRiders`).
 *
 * From the first step up the rail to the step off at the foot (ph 1–3) the ant is untouchable: nothing damages or
 * targets it (`riding`). The position is the creature's root transform × the rest-pose rail or slot; no
 * pathfinding, separation or flow fields. New riders take the free slot farthest from the taken ones.
 */
const CB = BALANCE.climb;
const pt = { x: 0, y: 0, z: 0, h: 0 }; // det-ok: scratch
const near = { t: 0, d2: 0 }; // det-ok: scratch

/** On a creature (up the leg, riding or coming down): untouchable. */
export function riding(a: Ant): boolean {
  return a.state === AS.Climb && (a.ridePh ?? 0) >= 1;
}

/** May this ant climb at all (not the colony's queen or king; its caste may mount this creature)? */
function climber(w: World, a: Ant, cr: Creature): boolean {
  const c = w.colony(a.colony);
  if (c && (a.id === c.queen || a.id === c.king)) return false;
  return canMount(a, cr);
}

/**
 * An ant attacking (or holding on to) creature `cr` (combat): start climbing it if its caste may mount it, its
 * cooldown is ready, a leg is close, a mount slot is free and its colony keeps the ratio (`mount.ratio` of its ants
 * fighting the creature, this one counted on the ground until it climbs). The ant gets on the nearest leg where it
 * meets it (a spider's long legs anywhere from the foot to the knee). Returns true if it started.
 */
export function tryClimb(w: World, a: Ant, cr: Creature): boolean {
  if ((a.climbCd ?? 0) > 0 || cr.dead || cr.space !== a.space || a.heldBy) return false;
  // a marker's "no climbing" or "no attacking" order: its ants fight creatures from the ground (or not at all)
  const col = w.colony(a.colony);
  if (col && (underOrder(col, a, 'noClimb') || underOrder(col, a, 'noAttack'))) return false;
  const d = climbDef(cr.kind);
  if (!d || climbCap(cr) <= 0 || !climber(w, a, cr)) return false;
  // the ratio: after this one climbs, riders (counting those walking to a leg) ≤ ratio × (riders + ground) — so a
  // ground force stays below
  const on = colonyOn(w, cr, a.colony);
  const ground = Math.max(on.ground, fightsFromGround(a, cr.id) ? 1 : 0);
  if (on.riders + 1 > BALANCE.mount.ratio * (on.riders + ground) + 1e-9) return false;
  const slot = freeSlot(w, cr);
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
  claimSlot(w, cr, slot, a.colony);
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
  if ((a.rsv ?? 0) !== 0) a.rsv = 0;
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
    // it left the map (a mantis flying off): its riders go with it and are lost; else they drop off unhurt
    if (cr.data.gone && (a.ridePh ?? 0) >= 1) {
      stepOff(w, a, null);
      killAnt(w, a);
      return;
    }
    dropOff(w, a, cr);
    return;
  }
  // the marker's "no attacking" / "no climbing" order: climb down (or give up the climb)
  if (underOrder(c, a, 'noAttack') || underOrder(c, a, 'noClimb')) {
    if ((a.ridePh ?? 0) === 0) {
      stepOff(w, a, cr, 0);
      return;
    }
    if ((a.ridePh ?? 0) <= 2) startDown(w, a, cr);
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
    if ((a.rideT ?? 0) >= CB.ride - 1e-9) startDown(w, a, cr);
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

/** Time up, the ratio exceeded, or ordered off: climb down the rail (from wherever it is on it). */
function startDown(w: World, a: Ant, cr: Creature): void {
  const ph = a.ridePh ?? 0;
  if (ph === 3) return;
  // coming down from part-way up: start the way down at the same point of the rail
  a.rideT = ph === 1 ? Math.max(0, 1 - (a.rideT ?? 0)) : 0;
  a.ridePh = 3;
  a.fire = 0;
  w.events.emit({ t: 'climb', x: a.x, y: a.y, space: a.space, phase: 'down', creature: cr.id, by: a.caste });
}

/** Mounted ants only use their basic attack (EotU): a bite; fire ants also sting. No acid, glue or spray. */
function riderAttack(w: World, a: Ant, c: Colony, cr: Creature): void {
  const cd = casteOf(a.caste);
  if (a.cd > 0) return;
  a.cd = biteGap(w, a, c, cd.attackInterval);
  if (cd.bite > 0) {
    damageCreature(w, cr, cd.bite * biteMul(w, a, c) * CB.damageMul, 'bite', a);
    w.events.emit({ t: 'bite', x: a.x, y: a.y, space: a.space, strength: Math.min(1, (cd.bite / 10) * 1.4), by: a.caste, on: 'creature', riding: true });
  }
  if (cd.sting && cd.species === 'solenopsis') {
    applyVenom(w, cr, cd.sting.dps * (a.power || 1), cd.sting.duration, cd.sting.maxStacks * 3);
    a.pose = POSE.STING;
    w.events.emit({ t: 'sting', x: a.x, y: a.y, space: a.space, by: a.caste });
  }
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

/**
 * A titan's shake-off (creatureAI): every ant on it (up a leg, riding or coming down) is thrown to the ground — a
 * knockback flight with the usual landing (stunned, a little hurt) — and must wait its cooldown to climb again.
 */
export function throwRiders(w: World, cr: Creature, power: number): number {
  let n = 0;
  w.antsNear(cr.space, cr.x, cr.y, cr.scale * 1.6 + 40, (a) => {
    if (a.state !== AS.Climb || a.rideId !== cr.id || (a.ridePh ?? 0) < 1) return false;
    stepOff(w, a, cr);
    flingAnt(w, a, cr.x, cr.y, power);
    n++;
    return false;
  });
  return n;
}

/**
 * The ratio (`mount.ratio`, every tick from creatureSystem): per creature and colony, riders (up a leg or riding) at
 * most the ratio of its ants fighting that creature; with too few on the ground the longest-mounted climb down first
 * (ties: the lower id). Ants in id order, so it is the same on every client.
 */
export function enforceMountRatio(w: World): void {
  const R = BALANCE.mount.ratio;
  // per creature: colony, riders, ground (flat), then the riders themselves
  const per = ratioTmp;
  per.clear();
  for (const a of w.s.ants) {
    let id = 0;
    let rider = false;
    if (a.state === AS.Climb) {
      // walking to its leg, up it or riding; one coming down is back with the ground force
      id = a.rideId ?? 0;
      rider = (a.ridePh ?? 0) <= 2;
    } else if (a.state === AS.Attack && a.tk === 4) id = a.tgt;
    else if (a.state === AS.Grapple && a.gKind === 4) id = a.gId;
    if (!id) continue;
    let e = per.get(id);
    if (!e) per.set(id, (e = []));
    let i = 0;
    while (i < e.length && e[i] !== a.colony) i += 3;
    if (i >= e.length) e.push(a.colony, 0, 0);
    e[i + (rider ? 1 : 2)]++;
  }
  for (const [id, e] of per) {
    for (let i = 0; i < e.length; i += 3) {
      const riders = e[i + 1];
      if (riders === 0) continue;
      const allowed = Math.floor(R * (riders + e[i + 2]) + 1e-9);
      if (riders <= allowed) continue;
      const cr = w.creatureById.get(id);
      if (!cr) continue;
      const list = w.s.ants.filter((a) => a.state === AS.Climb && a.rideId === id && a.colony === e[i] && (a.ridePh ?? 0) <= 2);
      // longest on the creature first: riding (up time + seconds ridden), then going up; one still walking to its leg
      // just gives up the climb
      list.sort((p, q) => onTime(q) - onTime(p) || p.id - q.id);
      for (let k = 0; k < riders - allowed && k < list.length; k++) {
        if ((list[k].ridePh ?? 0) === 0) stepOff(w, list[k], cr, CB.cooldown * 0.5);
        else startDown(w, list[k], cr);
      }
    }
  }
}
const ratioTmp = new Map<number, number[]>(); // det-ok: scratch, rebuilt every call from the state (insertion order = ant id order)

/** Seconds an ant has been on the creature (since it got on the leg; −1 still walking to its leg). */
function onTime(a: Ant): number {
  return (a.ridePh ?? 0) === 0 ? -1 : a.st - (a.rideWalk ?? 0);
}

/** Climb cooldown (antSystem, every tick). */
export function climbTick(a: Ant, dt: number): void {
  if ((a.climbCd ?? 0) > 0) a.climbCd = Math.max(0, a.climbCd! - dt);
}
