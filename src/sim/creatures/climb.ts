import { World } from '../world';
import { Ant, AS, Creature } from '../types';
import { BALANCE } from '../balance';
import { casteOf } from '../species';
import { datan2, dcos, dhypot, dsin } from '../dmath';
import { CLIMB_DATA } from './climbData';

/**
 * Climb rails and riding slots of the large creatures and titans
 * (CHANGE_PLAN §15.2). The data (`climbData.ts`) is authored from the
 * creature models by `tools/climb-data.ts`: a rail per climbable leg from the
 * foot up to the hip, then on to a riding slot on the back. The simulation
 * only needs the creature's root transform and these rest-pose points: a
 * climbing ant's position is one transform a tick. (The renderer puts it on
 * the animated leg and body instead.)
 */

export interface ClimbRail {
  /** the leg in the creature's model ('L1', 'R3', chain legs 's4L') */
  leg: string;
  /** foot, ankle, knee, hip: x y z each, fractions of the length, builder frame (+x forward, +y up, +z left) */
  pts: number[];
}

export interface RideSlot {
  /** body frame it sits on ('body', or a chain segment 's6') */
  frame: string;
  x: number;
  y: number;
  z: number;
}

export interface ClimbDef {
  rails: ClimbRail[];
  /** area of the back the riders stand on (fraction of length²) */
  area: number;
  /** rest position of each body frame used by the slots */
  frames: Record<string, [number, number, number]>;
  slots: RideSlot[];
}

export function climbDef(kind: string): ClimbDef | undefined {
  return CLIMB_DATA[kind];
}

/** Most ants riding at once (0: not climbable): one per riding slot (tools/climb-data.ts). */
export function climbCap(cr: Creature): number {
  const d = CLIMB_DATA[cr.kind];
  if (!d || cr.dead) return 0;
  return Math.min(BALANCE.climb.maxRiders, d.slots.length);
}

/** Room on the creature's back, in units (its area ÷ `climb.roomUnitMm2`); riders take units by size class. */
export function climbRoom(cr: Creature): number {
  const d = CLIMB_DATA[cr.kind];
  if (!d || cr.dead) return 0;
  return Math.max(1, Math.round((d.area * cr.scale * cr.scale) / BALANCE.climb.roomUnitMm2));
}

/** Units of room a rider of this body length takes (its size class). */
export function riderUnits(length: number): number {
  for (const [max, u] of BALANCE.climb.sizeClasses) if (length <= max) return u;
  return BALANCE.climb.sizeClasses[BALANCE.climb.sizeClasses.length - 1][1];
}

/** Rest-pose point of a slot in the creature's root frame (x forward, y left, z up; mm). */
export function slotLocal(cr: Creature, d: ClimbDef, slot: number, out: { x: number; y: number; z: number }): void {
  const s = d.slots[slot] ?? d.slots[0];
  const f = d.frames[s.frame] ?? [0, 0, 0];
  const L = cr.scale;
  out.x = (f[0] + s.x) * L;
  out.y = (f[2] + s.z) * L;
  out.z = (f[1] + s.y) * L;
}

const P = { x: 0, y: 0, z: 0 }; // det-ok: scratch
const Q = { x: 0, y: 0, z: 0 }; // det-ok: scratch
/** the rail's polyline in the root frame: foot, ankle, knee, slot (x forward, y left, z up; mm) */
const PL = new Float64Array(12); // det-ok: scratch

/** Fill PL with the rail's points (the knee leads over the body's edge to the slot, as the renderer draws it). */
function polyline(cr: Creature, rail: number, slot: number): ClimbDef {
  const d = CLIMB_DATA[cr.kind];
  const L = cr.scale;
  const r = d.rails[rail] ?? d.rails[0];
  for (let i = 0; i < 3; i++) {
    PL[i * 3] = r.pts[i * 3] * L;
    PL[i * 3 + 1] = r.pts[i * 3 + 2] * L;
    PL[i * 3 + 2] = r.pts[i * 3 + 1] * L;
  }
  slotLocal(cr, d, slot, Q);
  PL[9] = Q.x;
  PL[10] = Q.y;
  PL[11] = Q.z;
  return d;
}

function segLen(i: number): number {
  return dhypot(dhypot(PL[i * 3 + 3] - PL[i * 3], PL[i * 3 + 4] - PL[i * 3 + 1]), PL[i * 3 + 5] - PL[i * 3 + 2]);
}

/**
 * Point at progress t (0 foot … 1 riding slot) along rail `rail` to slot
 * `slot`, in world coordinates (x, y on the ground plane, z height), and the
 * heading of travel (up the rail).
 */
export function railPoint(cr: Creature, rail: number, slot: number, t: number, out: { x: number; y: number; z: number; h: number }): void {
  polyline(cr, rail, slot);
  const total = segLen(0) + segLen(1) + segLen(2);
  let want = Math.max(0, Math.min(1, t)) * total;
  let lx = PL[0];
  let ly = PL[1];
  let lz = PL[2];
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < 3; i++) {
    const seg = segLen(i);
    dx = PL[i * 3 + 3] - PL[i * 3];
    dy = PL[i * 3 + 4] - PL[i * 3 + 1];
    if (want <= seg || i === 2) {
      const k = seg > 1e-9 ? Math.min(1, want / seg) : 1;
      lx = PL[i * 3] + dx * k;
      ly = PL[i * 3 + 1] + dy * k;
      lz = PL[i * 3 + 2] + (PL[i * 3 + 5] - PL[i * 3 + 2]) * k;
      break;
    }
    want -= seg;
  }
  toWorld(cr, lx, ly, out);
  out.z = lz;
  const c = dcos(cr.h);
  const s = dsin(cr.h);
  // heading of travel in the world (up the rail)
  const wx = dx * c - dy * s;
  const wy = dx * s + dy * c;
  out.h = wx * wx + wy * wy > 1e-12 ? datan2(wy, wx) : cr.h;
}

/**
 * Where on rail `rail` (to slot `slot`) an ant at world (x, y) would get on:
 * the nearest point of the rail seen from above, as progress 0..1 (3D arc
 * length), and its squared ground distance. A spider's long legs are climbed
 * from wherever the ant meets them, not only from the foot.
 */
export function nearestOnRail(cr: Creature, rail: number, slot: number, x: number, y: number, out: { t: number; d2: number }): void {
  polyline(cr, rail, slot);
  // the point in the root frame
  const c = dcos(cr.h);
  const s = dsin(cr.h);
  const dx0 = x - cr.x;
  const dy0 = y - cr.y;
  const px = dx0 * c + dy0 * s;
  const py = -dx0 * s + dy0 * c;
  const total = segLen(0) + segLen(1) + segLen(2);
  let acc = 0;
  out.d2 = Infinity;
  out.t = 0;
  // only the leg itself (foot → ankle → knee): the last stretch is over the body
  for (let i = 0; i < 2; i++) {
    const ax = PL[i * 3];
    const ay = PL[i * 3 + 1];
    const bx = PL[i * 3 + 3];
    const by = PL[i * 3 + 4];
    const ex = bx - ax;
    const ey = by - ay;
    const e2 = ex * ex + ey * ey;
    const k = e2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / e2)) : 0;
    const qx = ax + ex * k - px;
    const qy = ay + ey * k - py;
    const d2 = qx * qx + qy * qy;
    const seg = segLen(i);
    if (d2 < out.d2) {
      out.d2 = d2;
      out.t = total > 1e-9 ? (acc + seg * k) / total : 0;
    }
    acc += seg;
  }
}

/** World point of a slot (x, y; z height) and the creature's heading. */
export function slotPoint(cr: Creature, slot: number, out: { x: number; y: number; z: number; h: number }): void {
  const d = CLIMB_DATA[cr.kind];
  slotLocal(cr, d, slot, P);
  toWorld(cr, P.x, P.y, out);
  out.z = P.z;
  out.h = cr.h;
}

/** World point of a rail's foot (where an ant starts climbing). */
export function railFoot(cr: Creature, rail: number, out: { x: number; y: number }): void {
  const r = CLIMB_DATA[cr.kind].rails[rail];
  toWorld(cr, r.pts[0] * cr.scale, r.pts[2] * cr.scale, out);
}

function toWorld(cr: Creature, lx: number, ly: number, out: { x: number; y: number }): void {
  const c = dcos(cr.h);
  const s = dsin(cr.h);
  out.x = cr.x + lx * c - ly * s;
  out.y = cr.y + lx * s + ly * c;
}

/**
 * Riding slots taken on each creature this tick (bit k = slot k), found once
 * a tick and kept up to date as ants join (ants in id order: lowest free slot).
 */

function takenEntry(w: World, cr: Creature): { tick: number; mask: number; units: number } {
  const taken = w.tickCache.rideTaken;
  let e = taken.get(cr.id);
  if (e && e.tick === w.s.tick) return e;
  if (!e) taken.set(cr.id, (e = { tick: 0, mask: 0, units: 0 }));
  e.tick = w.s.tick;
  let m = 0;
  let u = 0;
  w.antsNear(cr.space, cr.x, cr.y, cr.scale * 1.6 + 40, (a: Ant) => {
    if (a.rideId === cr.id && a.state === AS.Climb) {
      m |= 1 << (a.rideSlot ?? 0);
      u += riderUnits(casteOf(a.caste).length);
    }
    return false;
  });
  e.mask = m;
  e.units = u;
  if (taken.size > 256) for (const [id, v] of taken) if (v.tick !== w.s.tick) taken.delete(id);
  return e;
}

export function takenSlots(w: World, cr: Creature): number {
  return takenEntry(w, cr).mask;
}

export function claimSlot(w: World, cr: Creature, slot: number, units: number): void {
  const e = takenEntry(w, cr);
  e.mask |= 1 << slot;
  e.units += units;
}

/**
 * Lowest free riding slot on the creature for a rider taking `units` of room,
 * or -1 when its back is full (no slot left, or not enough room for one this big).
 */
export function freeSlot(w: World, cr: Creature, units: number): number {
  const cap = climbCap(cr);
  if (cap <= 0) return -1;
  const e = takenEntry(w, cr);
  if (e.units + units > climbRoom(cr)) return -1;
  const slots = Math.min(cap, CLIMB_DATA[cr.kind].slots.length);
  for (let k = 0; k < slots; k++) if (!(e.mask & (1 << k))) return k;
  return -1;
}
