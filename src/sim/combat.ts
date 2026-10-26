import { World } from './world';
import { Ant, AS, Carry, Colony, Creature, POSE, SURFACE, nestSpace } from './types';
import type { Projectile } from './types';
import { casteOf, DamageType, isKing } from './species';
import { angleDiff, antSpeed, faceToward, moveForward, steerTo, turnToward, goHome, goOut } from './movement';
import { bodyHook, claimCreatureSlot, creatureSlotWorld, distToCreatureBody, outerRingPoint, outlineU, reserveAntSlot, reserveCreatureSlot, slotTmp } from './slots';
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
    // Fight back.
    if ('caste' in src) {
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

function findTarget(w: World, a: Ant, c: Colony, r: number): Target | null {
  hasFound = false;
  const hx = dcos(a.h);
  const hy = dsin(a.h);
  const team = a.team ?? a.colony;
  const mine = a.tk === 3 && (a.state === AS.Attack || a.state === AS.Grapple) ? a.tgt : 0;
  const sickle = casteOf(a.caste).termite === 'sickle';
  w.enemiesNear(a.space, team, a.x, a.y, r, (o, d2) => {
    if (!isEnemyAnt(a, o)) return false;
    // a sickle-jaw cannot grab what another already holds: it looks past it (sickleJaws.ts drops such a target)
    if (sickle && o.heldBy) return false;
    // Prefer pinned targets slightly and high-threat ants (tanks draw attacks); otherwise nearest.
    const threat = casteOf(o.caste).threat ?? 0;
    // …and ones roughly ahead, so a fight is not a constant turning about (fix brief: no spinning)
    const ahead = 1.25 - (0.25 * ((o.x - a.x) * hx + (o.y - a.y) * hy)) / Math.max(1e-3, Math.sqrt(d2));
    // …and ones not already taken on by nestmates: the fight spreads along the front (GUARD.crowdPenalty)
    const crowd = 1 + GUARD.crowdPenalty * Math.max(0, attackers(w, o.id, team) - (o.id === mine ? 1 : 0));
    offer(3, o.id, o.x, o.y, (d2 * (o.pinned > 0 ? 0.6 : 1) * ahead * crowd) / (1 + threat));
    return false;
  });
  if (a.space === SURFACE || w.s.creatures.length) {
    const cd = casteOf(a.caste);
    const fighter = cd.role === 'soldier' || cd.role === 'major' || a.task === 'marker' || a.alarm > 0.3;
    const team = a.team ?? a.colony;
    const scan = (cr: Creature, d2: number) => {
      if (cr.space !== a.space || cr.dead || friendlyCreature(w, team, cr)) return false;
      const rel = creatureHooks.relation(cr);
      if (rel === 'ignore') return false;
      if (rel === 'prey' && !(a.task === 'forage' || a.task === 'marker' || fighter)) return false;
      if (rel === 'hostile' && !fighter && d2 > 64) return false;
      offer(4, cr.id, cr.x, cr.y, d2 * (rel === 'prey' ? 1.2 : 0.9));
      return false;
    };
    if (a.space === SURFACE) w.creaturesNear(a.x, a.y, r, scan);
    else for (const cr of w.s.creatures) if (cr.space === a.space && !cr.dead) {
      const d2 = sq(cr.x - a.x) + sq(cr.y - a.y);
      const rr = r + cr.scale * 0.5;
      if (d2 < rr * rr) scan(cr, d2);
    }
  }
  return hasFound ? found : null;
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
  releaseGrapple(w, a);
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
  // ---- melee: take a free attack slot on the target, go there and hold it (slots.ts)
  const C = BALANCE.combat;
  const L = cd.length;
  if (a.tk === 4) {
    const cr = w.creatureById.get(a.tgt)!;
    const off = L * BALANCE.creatureHold.stance;
    const b = bodyHook.body(cr);
    const dBody = distToCreatureBody(cr, a.x, a.y);
    const latchable = creatureHooks.canLatch(cr);
    if (dBody > L * (latchable ? 2.5 : 0.8)) {
      // head for the nearest point of its body, not its middle
      const c0 = dcos(cr.h);
      const s0 = dsin(cr.h);
      const dx = a.x - cr.x;
      const dy = a.y - cr.y;
      creatureSlotWorld(cr, off, outlineU(b, off, dx * c0 + dy * s0, -dx * s0 + dy * c0), slotTmp);
      steerTo(w, a, slotTmp.x, slotTmp.y, dt, 1.15, C.turnRate);
      a.waitT = 0;
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
    const u = reserveCreatureSlot(w, a, cr, off);
    if (u < 0) return waitForSlot(w, a, c, cr.x, cr.y, b.r + b.hl + off, dt);
    if (dBody > L * 0.8) {
      // our slot is free: go to it
      creatureSlotWorld(cr, off, u, slotTmp);
      steerTo(w, a, slotTmp.x, slotTmp.y, dt, 1.0, C.turnRate);
      a.waitT = 0;
      return true;
    }
    a.gSlot = u;
    claimCreatureSlot(w, cr, u);
  } else {
    const reach = t.r + L * 0.45;
    if (d > reach + L * 1.5) {
      steerTo(w, a, t.x, t.y, dt, 1.15, C.turnRate);
      a.waitT = 0;
      return true;
    }
    const o = w.antById.get(a.tgt)!;
    const ang = reserveAntSlot(w, a, o, o.id === w.colony(o.colony)?.queen);
    if (Number.isNaN(ang)) return waitForSlot(w, a, c, t.x, t.y, reach, dt);
    if (d > reach) {
      // close: walk to the free slot itself, not into the crowd at the middle
      const r = (casteOf(o.caste).length + L) * 0.42;
      steerTo(w, a, o.x + dcos(ang) * r, o.y + dsin(ang) * r, dt, 1.0, C.turnRate);
      a.waitT = 0;
      return true;
    }
    a.gSlot = ang;
  }
  a.waitT = 0;
  a.gId = a.tgt;
  a.gKind = a.tk;
  a.state = AS.Grapple;
  a.st = 0;
  return true;
}

/**
 * Every slot on the target is taken: wait in a ring just outside the reach,
 * facing it (backing off without turning round if too close), and after a
 * while look for another target with room (or keep waiting).
 */
function waitForSlot(w: World, a: Ant, c: Colony, tx: number, ty: number, reach: number, dt: number): boolean {
  const L = casteOf(a.caste).length;
  const ringR = reach + L * BALANCE.combat.outerRing;
  const d = dhypot(a.x - tx, a.y - ty);
  if (d < ringR - L * 0.5) {
    const h = a.h;
    a.h = datan2(a.y - ty, a.x - tx);
    moveForward(w, a, antSpeed(w, a) * 0.5, dt);
    a.h = h;
    faceToward(a, tx, ty, dt);
  } else if (d > ringR + L * 0.5) {
    outerRingPoint(a, tx, ty, reach, ringTmp);
    steerTo(w, a, ringTmp.x, ringTmp.y, dt, 0.8, BALANCE.combat.turnRate);
  } else {
    a.v = 0;
    faceToward(a, tx, ty, dt);
  }
  a.waitT = (a.waitT ?? 0) + dt;
  if (a.waitT >= BALANCE.combat.waitRetarget) {
    a.waitT = 0;
    const t = underOrder(c, a, 'noAttack') ? null : findTarget(w, a, c, aggroRadius(w, a, c));
    if (t && (t.id !== a.tgt || t.kind !== a.tk)) {
      a.tgt = t.id;
      a.tk = t.kind;
      a.st = 0;
    }
  }
  return true;
}
const ringTmp = { x: 0, y: 0 }; // det-ok: scratch

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
    const r = (ol + cd.length) * 0.42;
    // Two ants biting each other: neither moves round the other (the old
    // feedback loop span them both); they just hold and face each other.
    const mutual = o.state === AS.Grapple && o.gKind === 3 && o.gId === a.id;
    if (mutual) {
      if (dhypot(o.x - a.x, o.y - a.y) > r * 1.6) return regripAttack(a);
    } else {
      // hold on at the slot: a world angle, so the victim turning does not swing us round it. Close to the slot the
      // pull is gentle, so nestmates holding the foes next to ours can ease us apart (separation.ts) instead of being
      // snapped back on top of each other every tick (user note 2026-10-25: fights too compact)
      const tx = o.x + dcos(a.gSlot) * r;
      const ty = o.y + dsin(a.gSlot) * r;
      const k = Math.min(1, dt * (dhypot(tx - a.x, ty - a.y) > cd.length * GUARD.slotGive ? 10 : 1.5));
      a.x += (tx - a.x) * k;
      a.y += (ty - a.y) * k;
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
  const off = L * H.stance;
  const b = bodyHook.body(cr);
  const c0 = dcos(cr.h);
  const s0 = dsin(cr.h);
  const ex = a.x - cr.x;
  const ey = a.y - cr.y;
  creatureSlotWorld(cr, off, outlineU(b, off, ex * c0 + ey * s0, -ex * s0 + ey * c0), slotTmp);
  const dBody = distToCreatureBody(cr, a.x, a.y);
  // well out of reach: let go and close in again on a free place beside it (attackUpdate reserves one)
  if (dBody > L * H.release) return regripAttack(a);
  if (dBody > L * H.reach) {
    // it has moved a little: step after it, keeping our slot (no bite until we are beside it again)
    steerTo(w, a, slotTmp.x, slotTmp.y, dt, 1.0, BALANCE.combat.turnRate);
    return true;
  }
  if (dBody < off * 0.5) {
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
  faceToward(a, slotTmp.x - dcos(slotTmp.n) * (off + 1), slotTmp.y - dsin(slotTmp.n) * (off + 1), dt);
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
