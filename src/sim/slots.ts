import { antClear, antFitsUnderCreature, antFitsUnderCreatureAt, antHeights, antMostClear, antNeed, stackCap, zoneAt } from './underpass';
import { World } from './world';
import { Ant, AS, Creature } from './types';
import { casteOf } from './species';
import { BALANCE } from './balance';
import { angleDiff } from './movement';
import { dcos, dsin, datan2, dhypot } from './dmath';

/**
 * Attack slots (combat v2, CHANGE_PLAN §16 steps 2–3). Every target has a
 * limited ring of places to fight from, sized by its outline ("only a limited
 * number can fight"): an attacker reserves a free one as it closes in, walks
 * to its hold point and latches there; when all are taken it waits outside,
 * flanks to a free one or picks another foe (combat.ts).
 *
 *  - **Outline.** A victim ant's outline is an ellipse (`combat2.antHalfLen` ×
 *    its length along its heading, `antHalfWidth` × it across); a creature's
 *    is its capsule (`bodyHook`, half-length `hl` along its heading, radius `r`).
 *  - **Hold point.** The attacker stands where its front half (`frontHalf` −
 *    `jawOverlap`, × its length) meets the outline in the slot's direction:
 *    head to the outline, only the mandibles reaching over. No body overlap.
 *  - **How many.** n = clamp(⌊P / (`slotWidth` × La × `slotSpacing`)⌋,
 *    `slotsMin`, `slotsMax`), P the length of the line the attackers' centres
 *    stand on (the outline pushed out by half the attacker's length). A queen
 *    keeps at least `queenSlotsMin`.
 *  - **Ants:** n equal sectors of world angle round the victim's centre (a
 *    victim turning does not swing its attackers round it); an attacker's slot
 *    is the sector's centre angle (`gSlot`).
 *  - **Creatures:** n slots evenly along the outline as fractions u in the
 *    creature's frame (ants cling to the body and turn with it). Ants small
 *    enough to walk under it (combat2.clearance) also have an inner ring under
 *    the body edge, among the legs (u + 1).
 *  - **Reserved on approach.** Ants holding (Grapple) or reserving (Attack with
 *    `rsv` = the target's id) a slot are gathered once a tick per target into
 *    `World.tickCache` and kept up to date as ants reserve this tick (ants in id
 *    order), so two ants never head for the same slot.
 */

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

const C2 = BALANCE.combat2;
const C21 = BALANCE.combat21;
const TAU = Math.PI * 2;

/** Length of the outline offset `off` mm outside the body. */
export function outlineLen(b: Body, off: number): number {
  return 2 * Math.PI * Math.max(0, b.r + off) + 4 * b.hl;
}

/** Point (body frame: +x forward, +y left) at fraction u of the outline, and the outward normal angle. */
export function outlinePoint(b: Body, off: number, u: number, out: { x: number; y: number; n: number }): void {
  const R = Math.max(0, b.r + off);
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
  const ang = -Math.PI / 2 - (R > 0 ? s / R : 0);
  out.x = -b.hl + R * dcos(ang);
  out.y = R * dsin(ang);
  out.n = ang;
}

/** Fraction of the outline nearest to a body-frame point. */
export function outlineU(b: Body, off: number, px: number, py: number): number {
  const R = Math.max(0, b.r + off);
  const L = 2 * b.hl;
  const P = outlineLen(b, off);
  if (P <= 0) return 0;
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

// ---------------------------------------------------------------- hold points

/** How far out from the outline an attacker of length `La` stands: its front half, less its mandibles. */
export function frontOff(La: number): number {
  return La * (C2.frontHalf - C2.jawOverlap);
}

/** Distance from a victim ant's centre to its outline (ellipse) in world direction `ang`. */
export function antOutlineR(o: Ant, ang: number): number {
  const L = casteOf(o.caste).length;
  const A = L * C2.antHalfLen;
  const B = L * C2.antHalfWidth;
  const c = dcos(ang - o.h);
  const s = dsin(ang - o.h);
  return (A * B) / Math.sqrt(B * c * B * c + A * s * A * s);
}

/** Where attacker `a` holds victim ant `o` from world angle `ang` (its centre). */
export function antHoldPoint(a: Ant, o: Ant, ang: number, out: { x: number; y: number }): number {
  const r = antOutlineR(o, ang) + frontOff(casteOf(a.caste).length);
  out.x = o.x + dcos(ang) * r;
  out.y = o.y + dsin(ang) * r;
  return r;
}

/**
 * Centre distance of two ants biting each other head to head: each one's front half to the other's, the mandibles
 * reaching over (`jawOverlap` of each).
 */
export function mutualHold(La: number, Lo: number): number {
  return (La + Lo) * (C2.frontHalf - C2.jawOverlap / 2);
}

/**
 * Can ant `a` walk (and fight) under creature `cr`? Its height (with the margin) is below the clearance under some part
 * of the creature's body — combat v2.2: both from the models (sim/underpass.ts); the under ring's slots are only where
 * it fits (reserveCreatureSlot).
 */
export function fitsUnder(a: Ant, cr: Creature): boolean {
  return antFitsUnderCreature(a, cr);
}

/** The offset (mm, negative: inside) of a creature slot's ring for an attacker of length La: u ≥ 1 is under the body. */
export function creatureSlotOff(cr: Creature, La: number, u: number): number {
  return u >= 1 ? -C2.underInset * bodyHook.body(cr).r : frontOff(La);
}

// ---------------------------------------------------------------- how many

function clampSlots(p: number, La: number): number {
  return Math.max(C2.slotsMin, Math.min(C2.slotsMax, Math.floor(p / (C2.slotWidth * La * C2.slotSpacing) + 1e-9)));
}

/** Perimeter of an ellipse with half-axes A, B (Ramanujan). */
function ellipsePerimeter(A: number, B: number): number {
  return Math.PI * (3 * (A + B) - Math.sqrt((3 * A + B) * (A + 3 * B)));
}

/** The line round an ant of length L that attackers of length La stand on, per attacker length. */
function ringPer(L: number, La: number): number {
  return ellipsePerimeter(L * C2.antHalfLen + La / 2, L * C2.antHalfWidth + La / 2) / La;
}

/**
 * Attack slots on an ant for an attacker of length `attackerLen` (user 2026-11-01: "for minum and sizes similar make it
 * 6 max, worker n others of those sizes are 7+ depending on size"): attackers its own size fit `swarm.small` round an ant
 * of up to `swarm.smallMm`, else `swarm.worker` from `swarm.workerMm` and one more every `swarm.stepMm` longer; bigger
 * attackers fewer, smaller more, as the room on the line they stand on goes (never more than `swarm.small` round a
 * small one).
 */
export function antSlotCount(victim: Ant, attackerLen: number, isQueen: boolean): number {
  const L = casteOf(victim.caste).length;
  const W = C2.swarm;
  const small = L <= W.smallMm;
  const base = small ? W.small : W.worker + Math.floor(Math.max(0, L - W.workerMm) / W.stepMm + 1e-9);
  let n = Math.round((base * ringPer(L, attackerLen)) / ringPer(L, L));
  if (small) n = Math.min(n, W.small);
  n = Math.max(C2.slotsMin, Math.min(C2.slotsMax, n));
  return isQueen ? Math.max(C2.queenSlotsMin, n) : n;
}

/** Attack slots on a creature for an attacker of length `La`: on the ring round it, or (under) the ring under its body. */
export function creatureSlotCount(cr: Creature, La: number, under = false): number {
  const b = bodyHook.body(cr);
  return clampSlots(outlineLen(b, under ? -C2.underInset * b.r : La / 2), La);
}

// ---------------------------------------------------------------- who holds what (per-tick cache)

type Held = { tick: number; v: number[]; ids: number[] };

function entry(map: Map<number, Held>, tick: number, id: number): { e: Held; fresh: boolean } {
  let e = map.get(id);
  if (e && e.tick === tick) return { e, fresh: false };
  if (!e) map.set(id, (e = { tick: 0, v: [], ids: [] }));
  e.tick = tick;
  e.v.length = 0;
  e.ids.length = 0;
  if (map.size > 1024) for (const [k, x] of map) if (x.tick !== tick) map.delete(k);
  return { e, fresh: true };
}

/** Slots held or reserved on creature `cr` this tick (outline fractions; ≥ 1: under the body). */
function creatureHeld(w: World, cr: Creature): Held {
  const { e, fresh } = entry(w.tickCache.slotHeld, w.s.tick, cr.id);
  if (fresh) {
    const b = bodyHook.body(cr);
    w.antsNear(cr.space, cr.x, cr.y, b.hl + b.r + 30, (g) => {
      if ((g.state === AS.Grapple && g.gKind === 4 && g.gId === cr.id) || (g.state === AS.Attack && (g.rsv ?? 0) === cr.id && g.tgt === cr.id && g.tk === 4)) {
        e.v.push(g.gSlot);
        e.ids.push(g.id);
      }
      return false;
    });
  }
  return e;
}

/** Slots held or reserved on ant `o` this tick (world angles). */
function antHeld(w: World, o: Ant): Held {
  const { e, fresh } = entry(w.tickCache.antSlotHeld, w.s.tick, o.id);
  if (fresh) {
    w.antsNear(o.space, o.x, o.y, casteOf(o.caste).length * 1.5 + 16, (g) => {
      if ((g.state === AS.Grapple && g.gKind === 3 && g.gId === o.id) || (g.state === AS.Attack && (g.rsv ?? 0) === o.id && g.tgt === o.id && g.tk === 3)) {
        // (a place under the foe's body, combat v2.2: its angle + UNDER)
        e.v.push(g.gSlot + ((g.gUn ?? 0) > 0 ? UNDER : 0));
        e.ids.push(g.id);
      }
      return false;
    });
  }
  return e;
}

function drop(e: Held, id: number): void {
  const i = e.ids.indexOf(id);
  if (i < 0) return;
  e.ids.splice(i, 1);
  e.v.splice(i, 1);
}

function put(e: Held, id: number, v: number): void {
  drop(e, id);
  e.ids.push(id);
  e.v.push(v);
}

/** How many slots on ant `o` are held or reserved this tick. */
export function antSlotsTaken(w: World, o: Ant): number {
  return antHeld(w, o).v.length;
}

/** Does ant `a` already hold or reserve a slot on target `id` (kind 3 ant, 4 creature)? */
export function holdsSlotOn(a: Ant, id: number, kind: number): boolean {
  return (a.state === AS.Grapple && a.gId === id && a.gKind === kind) || ((a.rsv ?? 0) === id && a.tgt === id && a.tk === kind && a.state === AS.Attack);
}

/** Sector index (of n) of a world angle round an ant. */
function sector(ang: number, n: number): number {
  const f = (((ang / TAU) % 1) + 1) % 1;
  return Math.min(n - 1, Math.floor(f * n));
}

// ---------------------------------------------------------------- combat v2.2: sharing a tall teammate's slot

const SH = [0, 0, 0]; // det-ok: scratch
const SHP = { x: 0, y: 0 }; // det-ok: scratch
/**
 * Two-layer slots (combat v2.2, CHANGE_PLAN §20): may attacker `a` stand at (x, y) under teammate `id` (holding or
 * reserving a slot on the same target), between its legs — `a` fits under the zone of its body over that point, in its
 * pose, and the point is under its body? Then that teammate's slot is not taken for `a` (one sharer per slot).
 */
export function canShare(w: World, a: Ant, id: number, x: number, y: number): boolean {
  if (!BALANCE.underpass.allies) return false;
  const b = w.antById.get(id);
  if (!b || b === a || (b.team ?? b.colony) !== (a.team ?? a.colony) || b.state === AS.Dead) return false;
  const need = antNeed(a);
  if (need > antMostClear(b.caste)) return false;
  antClear(b, SH, (b.fhd ?? 0) > 0);
  if (need > Math.max(SH[0], SH[1], SH[2])) return false;
  const d = antHeights(b.caste);
  const Lb = casteOf(b.caste).length;
  if (need > SH[zoneAt(d, Lb, b.x, b.y, b.h, x, y)]) return false;
  const ly = -(x - b.x) * dsin(b.h) + (y - b.y) * dcos(b.h);
  return Math.abs(ly) <= d.hw * Lb;
}

/** Sector occupancy for attacker `a` on ant `o` (n sectors): a bit per sector it may not take (two-layer: a sector held by
 * one teammate it can stand under is free to it). */
const secN: number[] = []; // det-ok: scratch
const secId: number[] = []; // det-ok: scratch
function antTaken(w: World, a: Ant, o: Ant, e: Held, n: number, share = true): number {
  for (let k = 0; k < n; k++) {
    secN[k] = 0;
    secId[k] = 0;
  }
  for (let i = 0; i < e.ids.length; i++) {
    if (e.ids[i] === a.id || e.v[i] >= UNDER) continue;
    const k = sector(e.v[i], n);
    secN[k]++;
    secId[k] = e.ids[i];
  }
  let taken = 0;
  for (let k = 0; k < n; k++) {
    if (!secN[k]) continue;
    if (secN[k] === 1 && share && mayShare(w, a, secId[k])) {
      antHoldPoint(a, o, ((k + 0.5) / n) * TAU, SHP);
      if (canShare(w, a, secId[k], SHP.x, SHP.y)) continue;
    }
    taken |= 1 << k;
  }
  return taken;
}

/** Is there a sector attacker `a` could take on ant `o` (its own, a free one, one it can share under a teammate, or one
 * under `o` itself)? */
export function antHasRoom(w: World, a: Ant, o: Ant, isQueen: boolean): boolean {
  if (holdsSlotOn(a, o.id, 3)) return true;
  const n = antSlotCount(o, casteOf(a.caste).length, isQueen);
  const e = antHeld(w, o);
  // (as before: fewer holding or closing in on it than it has slots — every entry this tick counted, as antSlotsTaken)
  let ground = 0;
  for (let i = 0; i < e.ids.length; i++) if (e.v[i] < UNDER) ground++;
  if (ground < n) return true;
  // full: a slot it can share under a teammate, or a place under the foe (combat v2.2) — the quick checks first
  let share = false;
  for (let i = 0; i < e.ids.length && !share; i++) if (e.v[i] < UNDER && e.ids[i] !== a.id && mayShare(w, a, e.ids[i])) share = true;
  if (share && (antTaken(w, a, o, e, n, false) & ~antTaken(w, a, o, e, n, true)) !== 0) return true;
  if (!BALANCE.underpass.enemies || antNeed(a) > antMostClear(o.caste)) return false;
  return !Number.isNaN(underSector(w, a, o, e));
}

// ---------------------------------------------------------------- combat v2.2: from beneath a tall enemy ant

/** Held values of slots under an ant foe's body: the world angle + UNDER. */
const UNDER = 100;
const UP2 = { x: 0, y: 0 }; // det-ok: scratch
const UNDER_DIRS = [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, 0, Math.PI];

/** Where attacker `a` stands under ant foe `o` at world angle `ang`: inside its outline, half its half-width out. */
export function antUnderPoint(o: Ant, ang: number, out: { x: number; y: number }): void {
  const r = antHeights(o.caste).hw * casteOf(o.caste).length * 0.5;
  out.x = o.x + dcos(ang) * r;
  out.y = o.y + dsin(ang) * r;
}

/**
 * A free place for `a` under ant foe `o` (enemies under-pass on, `a` short enough for the zone over the place), at most
 * stackCap of them, its sides first: the world angle, or NaN.
 */
function underSector(w: World, a: Ant, o: Ant, e: Held): number {
  if (!BALANCE.underpass.enemies || (o.team ?? o.colony) === (a.team ?? a.colony)) return NaN;
  const need = antNeed(a);
  if (need > antMostClear(o.caste)) return NaN;
  antClear(o, SH, (o.fhd ?? 0) > 0);
  if (need > Math.max(SH[0], SH[1], SH[2])) return NaN;
  let used = 0;
  for (let i = 0; i < e.ids.length; i++) if (e.ids[i] !== a.id && e.v[i] >= UNDER) used++;
  const Lo = casteOf(o.caste).length;
  if (used >= stackCap(casteOf(a.caste).length, Lo)) return NaN;
  const d = antHeights(o.caste);
  for (const rel of UNDER_DIRS) {
    const ang = o.h + rel;
    let clash = false;
    for (let i = 0; i < e.ids.length; i++) if (e.ids[i] !== a.id && e.v[i] >= UNDER && Math.abs(angleDiff(e.v[i] - UNDER, ang)) < 0.3) clash = true;
    if (clash) continue;
    antUnderPoint(o, ang, UP2);
    if (need <= SH[zoneAt(d, Lo, o.x, o.y, o.h, UP2.x, UP2.y)]) return ang;
  }
  return NaN;
}

/**
 * Reserve a slot on an ant victim for attacker `a`: its own if it has one, else the free sector nearest the side it
 * came from. Returns the world angle (the sector's centre), or NaN when every slot is taken.
 */
export function reserveAntSlot(w: World, a: Ant, o: Ant, isQueen: boolean): number {
  const e = antHeld(w, o);
  const n = antSlotCount(o, casteOf(a.caste).length, isQueen);
  const k0 = sector(datan2(a.y - o.y, a.x - o.x), n);
  // its place under the foe (combat v2.2): kept while it still fits there
  if ((a.gUn ?? 0) > 0) {
    if (holdsSlotOn(a, o.id, 3) && e.ids.includes(a.id)) {
      antUnderPoint(o, a.gSlot, UP2);
      antClear(o, SH, (o.fhd ?? 0) > 0);
      if (antNeed(a) <= SH[zoneAt(antHeights(o.caste), casteOf(o.caste).length, o.x, o.y, o.h, UP2.x, UP2.y)]) return a.gSlot;
    }
    a.gUn = 0;
  }
  if (holdsSlotOn(a, o.id, 3) && e.ids.includes(a.id)) {
    // already ours: keep it unless another ant (lower id this tick) sits in the same sector — or the sector we are
    // in now is free (an approaching ant takes the place where it is, rather than walking round to the one it chose)
    const k = sector(a.gSlot, n);
    let clash = false;
    let here = k0 !== k;
    // (combat v2.2: a teammate in our sector we stand under is no clash; one in the sector we are in now that we could
    // stand under leaves it free to us)
    const tk = antTaken(w, a, o, e, n);
    for (let i = 0; i < e.ids.length; i++) {
      if (e.ids[i] === a.id || e.v[i] >= UNDER) continue;
      const ki = sector(e.v[i], n);
      if (e.ids[i] < a.id && ki === k && tk & (1 << k)) clash = true;
      if (ki === k0 && tk & (1 << k0)) here = false;
    }
    if (here && a.state === AS.Attack) {
      const ang = ((k0 + 0.5) / n) * TAU;
      put(e, a.id, ang);
      return ang;
    }
    if (!clash) return a.gSlot;
  }
  const taken = antTaken(w, a, o, e, n);
  if (taken === (n >= 32 ? -1 : (1 << n) - 1)) {
    // every place round it taken: one under it, if it is tall enough over us (combat v2.2)
    const u = underSector(w, a, o, e);
    if (!Number.isNaN(u)) {
      put(e, a.id, u + UNDER);
      a.gUn = 1;
      return u;
    }
    drop(e, a.id);
    return NaN;
  }
  for (let step = 0; step < n; step++) {
    for (const k of step === 0 ? [k0] : [(k0 + step) % n, (k0 - step + n) % n]) {
      if (taken & (1 << k)) continue;
      const ang = ((k + 0.5) / n) * TAU;
      put(e, a.id, ang);
      return ang;
    }
  }
  drop(e, a.id);
  return NaN;
}

/**
 * Which way round ant victim `o` attacker `a` should sidle to reach its slot at world angle `want`: a way that passes
 * no slot held by others (their holders are in the way), the shorter if both are clear. +1 counter-clockwise, −1;
 * 0 when both ways are blocked (the slot cannot be reached: the attacker waits or picks another foe).
 */
export function flankSide(w: World, a: Ant, o: Ant, isQueen: boolean, want: number): number {
  const e = antHeld(w, o);
  const n = antSlotCount(o, casteOf(a.caste).length, isQueen);
  let taken = 0;
  for (let i = 0; i < e.ids.length; i++) if (e.ids[i] !== a.id && e.v[i] < UNDER) taken |= 1 << sector(e.v[i], n);
  const b = datan2(a.y - o.y, a.x - o.x);
  const mine = sector(want, n);
  let best = 0;
  let bestK = Infinity;
  for (const side of [1, -1]) {
    const span = ((((side > 0 ? want - b : b - want) / TAU) % 1) + 1) % 1;
    const steps = Math.max(1, Math.ceil(span * n * 4));
    let crossed = 0;
    let last = -1;
    for (let i = 1; i < steps; i++) {
      const k = sector(b + side * ((span * TAU * i) / steps), n);
      if (k !== last && k !== mine && taken & (1 << k)) crossed++;
      last = k;
    }
    if (crossed > 0) continue;
    if (span < bestK - 1e-9) {
      bestK = span;
      best = side;
    }
  }
  return bestK === Infinity ? 0 : best;
}

/** Slot occupancy for attacker `a` on creature `cr`'s ring `ring` (n slots at offset `off`): a bit per slot it may not take
 * (two-layer, combat v2.2: a ground slot held by one teammate it can stand under is free to it). */
function crTaken(w: World, a: Ant, cr: Creature, e: Held, ring: number, n: number, off: number): number {
  for (let k = 0; k < n; k++) {
    secN[k] = 0;
    secId[k] = 0;
  }
  for (let i = 0; i < e.ids.length; i++) {
    if (e.ids[i] === a.id || (e.v[i] >= 1 ? 1 : 0) !== ring) continue;
    const k = slotIdx(e.v[i], n);
    secN[k]++;
    secId[k] = e.ids[i];
  }
  let taken = 0;
  for (let k = 0; k < n; k++) {
    if (!secN[k]) continue;
    if (secN[k] === 1 && ring === 0 && mayShare(w, a, secId[k])) {
      creatureSlotWorld(cr, off, (k + 0.5) / n, UT);
      if (canShare(w, a, secId[k], UT.x, UT.y)) continue;
    }
    taken |= 1 << k;
  }
  return taken;
}

/** Quick check before working out where a slot is: could `a` stand under holder `id` in any pose at all? */
function mayShare(w: World, a: Ant, id: number): boolean {
  if (!BALANCE.underpass.allies) return false;
  const b = w.antById.get(id);
  return !!b && (b.team ?? b.colony) === (a.team ?? a.colony) && antNeed(a) <= antMostClear(b.caste);
}

/** Index (of n) of a creature slot fraction on its ring. */
function slotIdx(u: number, n: number): number {
  return (((Math.round((u % 1) * n - 0.5) % n) + n) % n);
}

/**
 * Reserve a slot on creature `cr` for attacker `a`: its own if it has one, else the free slot nearest it on the ring
 * round the body, or (an ant that fits under it, when that ring is full) on the ring under the body. Returns the
 * outline fraction (u ≥ 1: under the body), or −1 when every slot it may take is taken.
 */
export function reserveCreatureSlot(w: World, a: Ant, cr: Creature): number {
  const e = creatureHeld(w, cr);
  const La = casteOf(a.caste).length;
  const under = fitsUnder(a, cr);
  const b = bodyHook.body(cr);
  const c = dcos(cr.h);
  const s = dsin(cr.h);
  const dx = a.x - cr.x;
  const dy = a.y - cr.y;
  const px = dx * c + dy * s;
  const py = -dx * s + dy * c;
  if (holdsSlotOn(a, cr.id, 4) && e.ids.includes(a.id) && (a.gSlot < 1 || under)) {
    const ring = a.gSlot >= 1 ? 1 : 0;
    const n = creatureSlotCount(cr, La, ring === 1);
    const k = slotIdx(a.gSlot, n);
    // the slot the ant is beside now, on the same ring
    const offR = ring === 1 ? -C2.underInset * b.r : frontOff(La);
    const kHere = Math.floor(outlineU(b, offR, px, py) * n) % n;
    let clash = false;
    let here = kHere !== k;
    const tk = crTaken(w, a, cr, e, ring, n, offR);
    for (let i = 0; i < e.ids.length; i++) {
      if (e.ids[i] === a.id || (e.v[i] >= 1 ? 1 : 0) !== ring) continue;
      const ki = slotIdx(e.v[i], n);
      if (e.ids[i] < a.id && ki === k && tk & (1 << k)) clash = true;
      if (ki === kHere && tk & (1 << kHere)) here = false;
    }
    // an approaching ant takes the free slot it is beside rather than walking round to the one it chose
    if (here && a.state === AS.Attack) {
      const u = (kHere + 0.5) / n + ring;
      put(e, a.id, u);
      return u;
    }
    if (!clash) return a.gSlot;
  }
  for (let ring = 0; ring < (under ? 2 : 1); ring++) {
    const n = creatureSlotCount(cr, La, ring === 1);
    const off = ring === 1 ? -C2.underInset * b.r : frontOff(La);
    const taken = crTaken(w, a, cr, e, ring, n, off);
    if (taken === (n >= 32 ? -1 : (1 << n) - 1)) continue;
    // the attacker's place on the ring: start there and look both ways
    const k0 = Math.floor(outlineU(b, off, px, py) * n) % n;
    for (let step = 0; step < n; step++) {
      for (const k of step === 0 ? [k0] : [(k0 + step) % n, (k0 - step + n) % n]) {
        if (taken & (1 << k)) continue;
        // under the body: only where it fits (combat v2.2: a low head or abdomen blocks that part)
        if (ring === 1) {
          creatureSlotWorld(cr, off, (k + 0.5) / n, UT);
          if (!antFitsUnderCreatureAt(a, cr, UT.x, UT.y)) continue;
        }
        const u = (k + 0.5) / n + ring;
        put(e, a.id, u);
        return u;
      }
    }
  }
  drop(e, a.id);
  return -1;
}

const UT = { x: 0, y: 0, n: 0 }; // det-ok: scratch

/** Is there a slot ant `a` could take on creature `cr` (round it, or under it if it fits)? */
export function creatureHasRoom(w: World, a: Ant, cr: Creature): boolean {
  const e = creatureHeld(w, cr);
  const La = casteOf(a.caste).length;
  const b = bodyHook.body(cr);
  for (let ring = 0; ring < (fitsUnder(a, cr) ? 2 : 1); ring++) {
    const n = creatureSlotCount(cr, La, ring === 1);
    const taken = crTaken(w, a, cr, e, ring, n, ring === 1 ? -C2.underInset * b.r : frontOff(La));
    if (taken !== (n >= 32 ? -1 : (1 << n) - 1)) return true;
  }
  return false;
}

/** Ant `a` gives up its slot on a target this tick (it is leaving). */
export function releaseSlot(w: World, a: Ant): void {
  const id = a.state === AS.Grapple ? a.gId : (a.rsv ?? 0);
  if (!id) return;
  const kind = a.state === AS.Grapple ? a.gKind : a.tk;
  const map = kind === 4 ? w.tickCache.slotHeld : w.tickCache.antSlotHeld;
  const e = map.get(id);
  if (e && e.tick === w.s.tick) drop(e, a.id);
}

// ---------------------------------------------------------------- combat v2.1: going round to a free slot

/** Slot on target (`kind` 3 ant / 4 creature) that ant `a` was last blocked on (never tried twice in a row), or NaN. */
function blockedSlot(a: Ant, id: number): number {
  return (a.bkI ?? 0) === id ? (a.bkS ?? NaN) : NaN;
}

/**
 * Going round ant victim `o`: is the sector at world angle `ang` free for `a` (nobody else holds or reserves it, and it
 * is not the one `a` was just blocked on)? Returns the sector's centre angle, or NaN.
 */
export function antSectorFreeAt(w: World, a: Ant, o: Ant, isQueen: boolean, ang: number): number {
  const e = antHeld(w, o);
  const n = antSlotCount(o, casteOf(a.caste).length, isQueen);
  const k = sector(ang, n);
  for (let i = 0; i < e.ids.length; i++) if (e.ids[i] !== a.id && e.v[i] < UNDER && sector(e.v[i], n) === k) return NaN;
  const bk = blockedSlot(a, o.id);
  if (!Number.isNaN(bk) && sector(bk, n) === k) return NaN;
  return ((k + 0.5) / n) * TAU;
}

/** Reserve the sector centred at `ang` on ant victim `o` for `a` (after antSectorFreeAt). */
export function takeAntSector(w: World, a: Ant, o: Ant, ang: number): void {
  put(antHeld(w, o), a.id, ang);
}

/**
 * Going round creature `cr` on the ring round its body: is the slot beside the outline fraction `u` free for `a`? Returns
 * the slot's fraction, or −1.
 */
export function creatureSlotFreeAt(w: World, a: Ant, cr: Creature, u: number): number {
  const e = creatureHeld(w, cr);
  const n = creatureSlotCount(cr, casteOf(a.caste).length, false);
  const k = Math.floor((((u % 1) + 1) % 1) * n) % n;
  for (let i = 0; i < e.ids.length; i++) if (e.ids[i] !== a.id && e.v[i] < 1 && slotIdx(e.v[i], n) === k) return -1;
  const bk = blockedSlot(a, cr.id);
  if (!Number.isNaN(bk) && bk < 1 && slotIdx(bk, n) === k) return -1;
  return (k + 0.5) / n;
}

/** Reserve the slot at fraction `u` round creature `cr` for `a` (after creatureSlotFreeAt). */
export function takeCreatureSlot(w: World, a: Ant, cr: Creature, u: number): void {
  put(creatureHeld(w, cr), a.id, u);
}

/**
 * Which way round should `a` go (combat v2.1, "back off and go around")? For each side, the free slots on that half of
 * the ring (outer ring only; not the one it was blocked on) minus `allyWeight` × the teammates already on the way there
 * (closing in or waiting, not holding: within two personal spaces outside the slots, before the nearest free slot).
 * +1 counter-clockwise, −1 clockwise; ties by its id (odd +1), so neighbours split between the two sides. 0 when no
 * side has more free slots than teammates already on the way to them (then it waits, or picks another foe).
 */
export function pickSide(w: World, a: Ant, kind: number, id: number, isQueen: boolean): number {
  const La = casteOf(a.caste).length;
  const team = a.team ?? a.colony;
  let n: number;
  let centre: { x: number; y: number };
  let bearingU: number;
  let free: (k: number) => boolean;
  let angOf: (k: number) => number;
  let rIn = 0;
  let rOut = 0;
  if (kind === 3) {
    const o = w.antById.get(id);
    if (!o) return 0;
    const e = antHeld(w, o);
    n = antSlotCount(o, La, isQueen);
    let taken = 0;
    for (let i = 0; i < e.ids.length; i++) if (e.ids[i] !== a.id && e.v[i] < UNDER) taken |= 1 << sector(e.v[i], n);
    const bk = blockedSlot(a, id);
    if (!Number.isNaN(bk)) taken |= 1 << sector(bk, n);
    free = (k) => !(taken & (1 << k));
    centre = o;
    bearingU = ((((datan2(a.y - o.y, a.x - o.x) / TAU) % 1) + 1) % 1) * n;
    angOf = (k) => ((k + 0.5) / n) * TAU;
    rIn = casteOf(o.caste).length * 0.3 + frontOff(La);
    rOut = rIn + C2.personalSpace * La * 2 + La;
  } else {
    const cr = w.creatureById.get(id);
    if (!cr) return 0;
    const e = creatureHeld(w, cr);
    n = creatureSlotCount(cr, La, false);
    let taken = 0;
    for (let i = 0; i < e.ids.length; i++) if (e.ids[i] !== a.id && e.v[i] < 1) taken |= 1 << slotIdx(e.v[i], n);
    const bk = blockedSlot(a, id);
    if (!Number.isNaN(bk) && bk < 1) taken |= 1 << slotIdx(bk, n);
    free = (k) => !(taken & (1 << k));
    centre = cr;
    const b = bodyHook.body(cr);
    const c = dcos(cr.h);
    const s = dsin(cr.h);
    const dx = a.x - cr.x;
    const dy = a.y - cr.y;
    bearingU = outlineU(b, frontOff(La), dx * c + dy * s, -dx * s + dy * c) * n;
    angOf = (k) => {
      creatureSlotWorld(cr, frontOff(La), (k + 0.5) / n, sideTmp);
      return datan2(sideTmp.y - cr.y, sideTmp.x - cr.x);
    };
    rIn = b.r + frontOff(La);
    rOut = b.hl + b.r + frontOff(La) + C2.personalSpace * La * 2 + La;
  }
  let best = 0;
  let bestScore = -Infinity;
  const half = Math.floor(n / 2);
  const k0 = Math.floor(bearingU) % n;
  const myAng = datan2(a.y - centre.y, a.x - centre.x);
  for (const side of [1, -1]) {
    let nFree = 0;
    let nearest = -1;
    for (let j = 0; j <= half; j++) {
      const k = (((k0 + side * j) % n) + n) % n;
      if (free(k)) {
        nFree++;
        if (nearest < 0) nearest = j;
      }
    }
    if (nFree === 0) continue;
    // teammates on the way to its nearest free slot on this side
    const span = angleDiff(myAng, angOf((((k0 + side * nearest) % n) + n) % n));
    let allies = 0;
    w.antsNear(a.space, centre.x, centre.y, rOut, (g) => {
      if (g === a || (g.team ?? g.colony) !== team || g.state !== AS.Attack) return false;
      const r = dhypot(g.x - centre.x, g.y - centre.y);
      if (r < rIn) return false;
      const ga = angleDiff(myAng, datan2(g.y - centre.y, g.x - centre.x));
      if (side * ga > 0 && Math.abs(ga) <= Math.abs(span) + 0.2) allies++;
      return false;
    });
    const score = nFree - C21.allyWeight * allies;
    // (a side whose free slots the teammates already on the way will take is no way to go: it waits instead)
    if (score <= 1e-9) continue;
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && side === (a.id & 1 ? 1 : -1))) {
      bestScore = score;
      best = side;
    }
  }
  return best;
}
const sideTmp = { x: 0, y: 0, n: 0 }; // det-ok: scratch

/**
 * Combat v2.1 (CHANGE_PLAN §17): is the ant anchored — holding a foe, firing a spray, a shooter holding its range
 * (`anc` refreshed every tick), recovering after an attack, taking a planned small step, holding prey in its jaws?
 * Nothing but knockback, a large creature walking into it, or its own planned moves shifts it; separation treats it as
 * a fixed obstacle.
 */
export function anchored(a: Ant): boolean {
  if ((a.anc ?? 0) > 0 || (a.stp ?? 0) > 0) return true;
  return a.state === AS.Grapple || a.state === AS.Spray || a.state === AS.Hold || a.state === AS.Snap;
}

/** Angle difference helper re-exported for combat (keeps imports in one place). */
export { angleDiff };

export const slotTmp = { x: 0, y: 0, n: 0 };
