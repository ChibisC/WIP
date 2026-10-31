import { World } from '../world';
import { Ant, AS, Creature } from '../types';
import { BALANCE } from '../balance';
import { casteOf } from '../species';
import { datan2, dcos, dhypot, dsin } from '../dmath';
import { CLIMB_DATA } from './climbData';
import { CREATURES } from './kinds';

/**
 * Climbing points, rails, weak points and mount slots of the large creatures and titans (combat v2, CHANGE_PLAN §16
 * steps 8–9; first version §15.2). The data (`climbData.ts`) is authored from the creature models by
 * `tools/climb-data.ts`: a rail per climbable leg from the foot (the climbing point) up to the hip, weak points on the
 * body (neck, thorax–abdomen joint, abdomen, leg bases, segment joints) and mount slots round them on the body
 * surface, spaced so riders never overlap. The simulation only needs the creature's root transform and these
 * rest-pose points: a climbing ant's position is one transform a tick. (The renderer puts it on the animated leg and
 * body instead.)
 *
 * Mounting rules (EotU; `BALANCE.mount`): only ants and termites; small castes mount large and huge creatures, large
 * castes only huge ones (bosses), some castes never; a fixed cap per creature class (fewer where the slots run out);
 * a colony's riders on a creature at most `ratio` of its ants fighting it.
 */

export interface ClimbRail {
  /** the leg in the creature's model ('L1', 'R3', chain legs 's4L') */
  leg: string;
  /** foot, ankle, knee, hip: x y z each, fractions of the length, builder frame (+x forward, +y up, +z left) */
  pts: number[];
}

export interface WeakPoint {
  name: string;
  /** body frame it sits on ('body', or a chain segment 's6') */
  frame: string;
  x: number;
  y: number;
  z: number;
}

export interface RideSlot {
  /** body frame it sits on ('body', or a chain segment 's6') */
  frame: string;
  x: number;
  y: number;
  z: number;
  /** the body surface's normal there (a rider's belly goes against it), in the frame */
  nx: number;
  ny: number;
  nz: number;
  /** the weak point the rider faces (index into `weak`) */
  w: number;
}

export interface ClimbDef {
  rails: ClimbRail[];
  /** rest position of each body frame used by the weak points and slots */
  frames: Record<string, [number, number, number]>;
  weak: WeakPoint[];
  slots: RideSlot[];
}

export function climbDef(kind: string): ClimbDef | undefined {
  return CLIMB_DATA[kind];
}

/** A creature's mount class: 'huge' (bosses), 'large' (other climbable creatures), or null (cannot be mounted). */
export function mountClass(kind: string): 'large' | 'huge' | null {
  if (!CLIMB_DATA[kind]) return null;
  return CREATURES[kind]?.boss ? 'huge' : 'large';
}

/** Most riders at once (0: cannot be mounted): the class cap, or fewer where the authored slots run out. */
export function climbCap(cr: Creature): number {
  const d = CLIMB_DATA[cr.kind];
  if (!d || cr.dead) return 0;
  const M = BALANCE.mount;
  return Math.min(mountClass(cr.kind) === 'huge' ? M.capHuge : M.capLarge, d.slots.length);
}

/** A caste's mount class: small (mounts large and huge creatures), large (huge only) or none. */
export function casteMount(caste: string): 'small' | 'large' | 'none' {
  const cd = casteOf(caste);
  if (cd.role === 'queen' || cd.role === 'king') return 'none';
  if (cd.mount) return cd.mount;
  return cd.length >= BALANCE.mount.largeCasteMm ? 'large' : 'small';
}

/** May this ant mount this creature (by sizes)? */
export function canMount(a: Ant, cr: Creature): boolean {
  const cl = mountClass(cr.kind);
  if (!cl) return false;
  const m = casteMount(a.caste);
  return m === 'small' || (m === 'large' && cl === 'huge');
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
 * Point at progress t (0 foot … 1 mount slot) along rail `rail` to slot `slot`, in world coordinates (x, y on the
 * ground plane, z height), and the heading of travel (up the rail).
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
 * Where on rail `rail` (to slot `slot`) an ant at world (x, y) would get on: the nearest point of the rail seen from
 * above, as progress 0..1 (3D arc length), and its squared ground distance. A spider's long legs are climbed from
 * wherever the ant meets them, not only from the foot.
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

/** World point of a rail's foot (its climbing point). */
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

// ---------------------------------------------------------------- who is on it (per-tick cache)

/** Mounting it (walking to a leg for its slot, up the leg or riding; not coming down): a rider for the ratio. */
function onIt(a: Ant, id: number): boolean {
  return a.state === AS.Climb && a.rideId === id && (a.ridePh ?? 0) <= 2;
}

/** Fighting it from the ground (closing in or holding on). */
export function fightsFromGround(a: Ant, id: number): boolean {
  return (a.state === AS.Attack && a.tk === 4 && a.tgt === id) || (a.state === AS.Grapple && a.gKind === 4 && a.gId === id);
}

type Taken = { tick: number; mask: number; cols: number[] };

/**
 * Mount slots taken on a creature this tick (bit k = slot k; every ant on it or walking to a leg holds its slot), and
 * per colony the riders and the ants fighting it from the ground (`cols`: colony, riders, ground, …). Found once a
 * tick and kept up to date as ants join (ants in id order).
 */
function takenEntry(w: World, cr: Creature): Taken {
  const taken = w.tickCache.rideTaken;
  let e = taken.get(cr.id);
  if (e && e.tick === w.s.tick) return e;
  if (!e) taken.set(cr.id, (e = { tick: 0, mask: 0, cols: [] }));
  e.tick = w.s.tick;
  e.cols.length = 0;
  let m = 0;
  const cols = e.cols;
  w.antsNear(cr.space, cr.x, cr.y, cr.scale * 1.6 + 60, (a: Ant) => {
    if (a.rideId === cr.id && a.state === AS.Climb) m |= 1 << (a.rideSlot ?? 0);
    const r = onIt(a, cr.id);
    const g = !r && fightsFromGround(a, cr.id);
    if (!r && !g) return false;
    let i = 0;
    while (i < cols.length && cols[i] !== a.colony) i += 3;
    if (i >= cols.length) cols.push(a.colony, 0, 0);
    cols[i + (r ? 1 : 2)]++;
    return false;
  });
  e.mask = m;
  if (taken.size > 256) for (const [id, v] of taken) if (v.tick !== w.s.tick) taken.delete(id);
  return e;
}

export function takenSlots(w: World, cr: Creature): number {
  return takenEntry(w, cr).mask;
}

/** Riders and ground attackers of a colony on a creature this tick. */
export function colonyOn(w: World, cr: Creature, colony: number): { riders: number; ground: number } {
  const c = takenEntry(w, cr).cols;
  for (let i = 0; i < c.length; i += 3) if (c[i] === colony) return { riders: c[i + 1], ground: c[i + 2] };
  return { riders: 0, ground: 0 };
}

/** Ant `a` (of its colony) has taken slot `slot`: it leaves the ground force and becomes a rider. */
export function claimSlot(w: World, cr: Creature, slot: number, colony: number): void {
  const e = takenEntry(w, cr);
  e.mask |= 1 << slot;
  const c = e.cols;
  for (let i = 0; i < c.length; i += 3)
    if (c[i] === colony) {
      c[i + 1]++;
      c[i + 2] = Math.max(0, c[i + 2] - 1);
    }
}

/**
 * The free mount slot farthest from the taken ones (rest pose; ties to the lowest index), so riders spread front to
 * back on both sides; −1 when the cap is reached or no slot is free.
 */
export function freeSlot(w: World, cr: Creature): number {
  const cap = climbCap(cr);
  if (cap <= 0) return -1;
  const d = CLIMB_DATA[cr.kind];
  const e = takenEntry(w, cr);
  let n = 0;
  for (let k = 0; k < d.slots.length; k++) if (e.mask & (1 << k)) n++;
  if (n >= cap) return -1;
  let best = -1;
  let bd = -1;
  for (let k = 0; k < d.slots.length; k++) {
    if (e.mask & (1 << k)) continue;
    let near = Infinity;
    if (n > 0) {
      slotLocal(cr, d, k, P);
      for (let j = 0; j < d.slots.length; j++) {
        if (!(e.mask & (1 << j))) continue;
        slotLocal(cr, d, j, Q);
        near = Math.min(near, (P.x - Q.x) * (P.x - Q.x) + (P.y - Q.y) * (P.y - Q.y) + (P.z - Q.z) * (P.z - Q.z));
      }
    }
    if (near > bd + 1e-9) {
      bd = near;
      best = k;
    }
  }
  return best;
}
