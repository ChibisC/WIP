import { World } from './world';
import { Ant, AS, Creature } from './types';
import { casteOf } from './species';
import { BALANCE } from './balance';
import { angleDiff } from './movement';
import { dcos, dsin, datan2, dhypot } from './dmath';

/**
 * Attack slots (fix brief: no spinning). Every target exposes a ring of
 * places to hold on to: an attacking ant takes the nearest free one, goes
 * there and stays; when all are taken it waits outside or picks another
 * target.
 *
 *  - **Ants:** the victim's legs and antennae (`LIMBS`, angles from its
 *    heading at the moment of the grab), stored as a *world* angle so the
 *    grappler does not orbit when the victim turns. 4 slots, 6 on an ant at
 *    least 1.5x the attacker's length, 8 on a queen.
 *  - **Creatures:** slots spread evenly round the body outline, a capsule
 *    (half-length `hl` along its heading, radius `r`), stored as a fraction
 *    `u` of the outline in the creature's frame (ants cling to the body and
 *    turn with it). One slot per `creatureSlotMm` of outline.
 */

export const LIMBS = [0.45, -0.45, 1.25, -1.25, 1.75, -1.75, 2.45, -2.45];

export interface Body {
  /** half the length of the straight middle part (mm) */
  hl: number;
  /** half the body width (mm) */
  r: number;
}

/** The creature's body outline as a capsule; set by the creature module. */
export const bodyHook: { body: (cr: Creature) => Body } = {
  body: (cr) => ({ hl: 0, r: cr.scale * 0.45 }),
};

/** Length of the outline offset `off` mm outside the body. */
export function outlineLen(b: Body, off: number): number {
  return 2 * Math.PI * (b.r + off) + 4 * b.hl;
}

/** Point (body frame: +x forward, +y left) at fraction u of the outline, and the outward normal angle. */
export function outlinePoint(b: Body, off: number, u: number, out: { x: number; y: number; n: number }): void {
  const R = b.r + off;
  const L = 2 * b.hl;
  let s = (((u % 1) + 1) % 1) * outlineLen(b, off);
  if (s < L) {
    out.x = -b.hl + s;
    out.y = R;
    out.n = Math.PI / 2;
    return;
  }
  s -= L;
  if (s < Math.PI * R) {
    const ang = Math.PI / 2 - s / R;
    out.x = b.hl + R * dcos(ang);
    out.y = R * dsin(ang);
    out.n = ang;
    return;
  }
  s -= Math.PI * R;
  if (s < L) {
    out.x = b.hl - s;
    out.y = -R;
    out.n = -Math.PI / 2;
    return;
  }
  s -= L;
  const ang = -Math.PI / 2 - s / R;
  out.x = -b.hl + R * dcos(ang);
  out.y = R * dsin(ang);
  out.n = ang;
}

/** Fraction of the outline nearest to a body-frame point. */
export function outlineU(b: Body, off: number, px: number, py: number): number {
  const R = b.r + off;
  const L = 2 * b.hl;
  const P = outlineLen(b, off);
  const cx = Math.max(-b.hl, Math.min(b.hl, px));
  if (px > -b.hl && px < b.hl) {
    // beside the straight part
    return py >= 0 ? (px + b.hl) / P : (L + Math.PI * R + (b.hl - px)) / P;
  }
  const ang = datan2(py, px - cx);
  if (px >= b.hl) {
    // head cap: angle runs +90° → −90°
    const t = Math.min(Math.PI, Math.max(0, Math.PI / 2 - ang));
    return (L + t * R) / P;
  }
  // tail cap: angle runs −90° → −270°
  let a2 = ang;
  if (a2 > Math.PI / 2) a2 -= Math.PI * 2;
  const t = Math.min(Math.PI, Math.max(0, -Math.PI / 2 - a2));
  return (2 * L + Math.PI * R + t * R) / P;
}

/** World point and outward normal (world angle) of fraction u of a creature's outline. */
export function creatureSlotWorld(cr: Creature, off: number, u: number, out: { x: number; y: number; n: number }): void {
  const b = bodyHook.body(cr);
  outlinePoint(b, off, u, out);
  const c = dcos(cr.h);
  const s = dsin(cr.h);
  const x = out.x;
  const y = out.y;
  out.x = cr.x + x * c - y * s;
  out.y = cr.y + x * s + y * c;
  out.n += cr.h;
}

/** Distance from a world point to the creature's body outline (negative inside). */
export function distToCreatureBody(cr: Creature, x: number, y: number): number {
  const b = bodyHook.body(cr);
  const c = dcos(cr.h);
  const s = dsin(cr.h);
  const dx = x - cr.x;
  const dy = y - cr.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const cx = Math.max(-b.hl, Math.min(b.hl, lx));
  return dhypot(lx - cx, ly) - b.r;
}

/** Number of attack slots round a creature for an attacker standing `off` mm out. */
export function creatureSlotCount(cr: Creature, off: number): number {
  const C = BALANCE.combat;
  return Math.max(C.creatureSlotsMin, Math.min(C.creatureSlotsMax, Math.round(outlineLen(bodyHook.body(cr), off) / C.creatureSlotMm)));
}

/** Attack slots on an ant. */
export function antSlotCount(victim: Ant, attackerLen: number, isQueen: boolean): number {
  const C = BALANCE.combat;
  if (isQueen) return C.queenSlots;
  return casteOf(victim.caste).length >= attackerLen * 1.5 ? C.bigAntSlots : C.antSlots;
}

const tmpP = { x: 0, y: 0, n: 0 };

/**
 * Where on each creature's outline ants already hold on (fractions u), found
 * once per creature per tick and kept up to date as ants latch this tick
 * (big creatures have hundreds of ants round them; scanning them for every
 * attacker every tick was the single biggest cost in the stress scene).
 */

function heldEntry(w: World, cr: Creature): { tick: number; us: number[]; masks: Map<number, number> } {
  const held = w.tickCache.slotHeld;
  let e = held.get(cr.id);
  if (e && e.tick === w.s.tick) return e;
  if (!e) held.set(cr.id, (e = { tick: 0, us: [], masks: new Map() }));
  e.tick = w.s.tick;
  e.us.length = 0;
  e.masks.clear();
  const b = bodyHook.body(cr);
  const us = e.us;
  w.antsNear(cr.space, cr.x, cr.y, b.hl + b.r + 12, (g) => {
    if (g.state === AS.Grapple && g.gKind === 4 && g.gId === cr.id) us.push(g.gSlot);
    return false;
  });
  if (held.size > 512) for (const [id, v] of held) if (v.tick !== w.s.tick) held.delete(id);
  return e;
}

/** Bit k set: slot k of n is held (n ≤ 32). */
function takenMask(w: World, cr: Creature, n: number): number {
  const e = heldEntry(w, cr);
  let m = e.masks.get(n);
  if (m === undefined) {
    m = 0;
    for (const u of e.us) m |= 1 << (((Math.round(u * n - 0.5) % n) + n) % n);
    e.masks.set(n, m);
  }
  return m;
}

/** An ant has just latched onto fraction u of the creature's outline. */
export function claimCreatureSlot(w: World, cr: Creature, u: number): void {
  const e = heldEntry(w, cr);
  e.us.push(u);
  e.masks.clear();
}

/**
 * Reserve the nearest free slot on a creature for ant `a` (standing `off` mm
 * out). Returns the outline fraction, or -1 when every slot is taken.
 */
export function reserveCreatureSlot(w: World, a: Ant, cr: Creature, off: number): number {
  const n = creatureSlotCount(cr, off);
  const b = bodyHook.body(cr);
  const taken = takenMask(w, cr, n);
  if (taken === (n >= 32 ? -1 : (1 << n) - 1)) return -1;
  // the attacker's place on the outline: start there and look both ways
  const c = dcos(cr.h);
  const s = dsin(cr.h);
  const dx = a.x - cr.x;
  const dy = a.y - cr.y;
  const u0 = outlineU(b, off, dx * c + dy * s, -dx * s + dy * c);
  const k0 = Math.floor(u0 * n) % n;
  if (!(taken & (1 << k0))) return (k0 + 0.5) / n;
  for (let step = 1; step < n; step++) {
    const k1 = (k0 + step) % n;
    if (!(taken & (1 << k1))) return (k1 + 0.5) / n;
    const k2 = (k0 - step + n) % n;
    if (!(taken & (1 << k2))) return (k2 + 0.5) / n;
  }
  return -1;
}

/**
 * Reserve a limb on an ant victim for attacker `a`: the free one nearest the
 * side it came from (a little spread out from those already held). Returns the
 * world angle (from the victim to the attacker's place), or NaN when every
 * slot is taken.
 */
export function reserveAntSlot(w: World, a: Ant, o: Ant, isQueen: boolean): number {
  const cap = antSlotCount(o, casteOf(a.caste).length, isQueen);
  const held: number[] = [];
  w.antsNear(o.space, o.x, o.y, casteOf(o.caste).length * 2, (g) => {
    if (g !== a && g.state === AS.Grapple && g.gKind === 3 && g.gId === o.id) held.push(g.gSlot);
    return false;
  });
  if (held.length >= cap) return NaN;
  const approach = datan2(a.y - o.y, a.x - o.x);
  let best = NaN;
  let bestS = -Infinity;
  for (let i = 0; i < Math.max(cap, LIMBS.length); i++) {
    const l = o.h + LIMBS[i % LIMBS.length];
    let minD = Math.PI;
    for (const h of held) minD = Math.min(minD, Math.abs(angleDiff(l, h)));
    if (held.length && minD < 0.35) continue; // that limb is held already
    // the free limb nearest the side we came from (no walking round the victim), a little spread out from the others
    const sc = (held.length ? minD * 0.3 : 0) - Math.abs(angleDiff(l, approach));
    if (sc > bestS) {
      bestS = sc;
      best = l;
    }
  }
  return best;
}

/** Where the ant waits when every slot is taken: just outside the reach, on its own side. */
export function outerRingPoint(a: Ant, tx: number, ty: number, reach: number, out: { x: number; y: number }): void {
  const ang = datan2(a.y - ty, a.x - tx);
  const r = reach + casteOf(a.caste).length * BALANCE.combat.outerRing;
  out.x = tx + dcos(ang) * r;
  out.y = ty + dsin(ang) * r;
}

export const slotTmp = tmpP;
