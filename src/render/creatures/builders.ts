import * as THREE from 'three';
import { Rig, V, ease, footAt, limb, limbEnd, tetrapod, tripod, wave } from './rig';
import { Surface } from './primitives';
import { chainPoint } from './chainTrail';

/**
 * Procedural creature models and their animation (Phase 11), built from the
 * reference notes in docs/creatures (proportions as fractions of body
 * length L). Each builder places the creature for one frame from its pose.
 *
 * Local frame: +x forward, +y up, +z to the side, y = 0 on the ground, mm.
 */

/** Creature states (mirror of sim/creatures/creatureAI.ts CS; render must not import sim AI). */
export const ST = { Wander: 0, Chase: 1, Attack: 2, Flee: 3, Rolled: 4, Curled: 5, Freeze: 6, Pounce: 7, WindUp: 8, Eat: 9, Display: 10, Lurk: 11, Hide: 12, Coil: 13, Whip: 14, Rear: 15, Flick: 16, Leap: 17, Strike: 18 } as const;

export interface CrPose {
  /** body length (mm) */
  L: number;
  /** world position (x, z) of the body centre and the sim heading */
  x: number;
  z: number;
  h: number;
  /** chains: the head point the trail starts from (world x, z) */
  hx: number;
  hz: number;
  /** gait phase in cycles (distance walked / stride) and stride amplitude 0..1 */
  phase: number;
  amp: number;
  t: number;
  state: number;
  /** seconds in the current state */
  st: number;
  dead: boolean;
  deadT: number;
  eaten: number;
  /** 0..1 random per creature */
  v2: number;
  /** recent hit (0..1) */
  hurt: number;
  /** extra numbers from the simulation (riders, pit, exposed…) */
  data: Record<string, number>;
  /** chains: earlier head positions, newest first, `trailStep` mm apart (world x, z pairs) */
  trail: Float32Array;
  trailN: number;
  trailStep: number;
  ground(x: number, z: number): number;
}

const S = (rough: number, gloss: number, pattern = 0, scale = 1): Surface => ({ rough, gloss, pattern, scale });
const C = (hex: number) => new THREE.Color(hex);
const EYE = C(0x050505);
const EYE_S = S(0.05, 1.4);

const tmpA = new V();
const tmpB = new V();
const tmpC = new V();
const hip = new V();
const foot = new V();
const ankle = new V();

/** Body roll when dead: insects end up on their backs, legs folded. */
function deadRoll(p: CrPose, insect = true): number {
  if (!p.dead) return 0;
  return insect ? Math.PI * ease(p.deadT * 2) : 0;
}

/** Extra base height so a body rolled by `roll` rests on the ground instead of sinking into it. */
function flipLift(roll: number, centreY: number): number {
  return centreY * (1 - Math.cos(roll));
}

/** Carcasses shrink as the ants eat them. */
function shrink(p: CrPose): number {
  return p.dead ? 1 - 0.55 * p.eaten : 1;
}

/** Base frame for a compact body, tilted to the ground under its front and back. */
function placeBody(rig: Rig, p: CrPose, len: number, extraPitch = 0, roll = 0, lift = 0): void {
  const c = Math.cos(p.h);
  const s = Math.sin(p.h);
  const hf = p.ground(p.x + c * len * 0.5, p.z + s * len * 0.5);
  const hb = p.ground(p.x - c * len * 0.5, p.z - s * len * 0.5);
  const pitch = Math.atan2(hf - hb, len) + extraPitch;
  rig.setBase(p.x, (hf + hb) / 2 + lift, p.z, p.h, pitch, roll);
  rig.recFrame('body');
}

/**
 * Jointed walking leg: femur up to the knee, tibia down to the ankle, tarsus
 * along the ground to the foot. A small ball rounds the knee.
 */
function leg3(rig: Rig, hp: V, ft: V, l1: number, l2: number, l3: number, r: number, color: THREE.ColorRepresentation, surf: Surface, kneeColor: THREE.ColorRepresentation = color, kneeK = 0.85, rec?: string): void {
  let dx = ft.x - hp.x;
  let dz = ft.z - hp.z;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl;
  dz /= dl;
  ankle.set(ft.x - dx * l3 * 0.85, ft.y + l3 * 0.5, ft.z - dz * l3 * 0.85);
  const k = limb(rig, hp, ankle, l1, l2, r, dx * 0.35, 1, dz * 0.35, color, surf, r * 0.72);
  rig.ell(k.x, k.y, k.z, r * kneeK, r * kneeK, r * kneeK, kneeColor, surf);
  tmpA.copy(limbEnd);
  if (rec) rig.recLeg(rec, hp, k, tmpA, ft);
  rig.tube(tmpA, ft, r * 0.42, color, surf);
}

/** Length of femur + tibia for a leg whose rest foot is at `ft`, the knee raised by `k` (1 = straight). */
function legLen(hp: V, ft: V, l3: number, k: number): number {
  const d = Math.hypot(ft.x - hp.x, ft.z - hp.z);
  const ax = d - l3 * 0.85;
  const ay = ft.y + l3 * 0.5 - hp.y;
  return Math.hypot(ax, ay) * k;
}

/**
 * Six walking legs (insects). Each pair: [hip x, rest foot x, rest foot reach]
 * as fractions of L. Bones are sized from the rest pose; `k` sets how high the
 * knees stand.
 */
function insectLegs(rig: Rig, p: CrPose, L: number, legs: Array<[number, number, number]>, hipY: number, hipZ: number, r: number, color: THREE.ColorRepresentation, surf: Surface, stride: number, lift: number, k = 1.25): void {
  legs.forEach(([hx, fx, reach], i) => {
    for (const side of [-1, 1]) {
      hip.set(hx * L, hipY, side * hipZ);
      foot.set(fx * L, 0, side * reach * L);
      const l3 = Math.hypot(foot.x - hip.x, foot.z - hip.z) * 0.3;
      const ll = legLen(hip, foot, l3, k);
      if (p.dead) {
        // on its back: legs drawn up over the belly (the ventral side, local -y), twitching less and less
        const tw = Math.sin(p.t * 9 + i * 2 + side) * 0.1 * Math.max(0, 1 - p.deadT / 4);
        foot.set(hx * L * 0.5 + tw * L, hipY - reach * L * 0.5, side * hipZ * 1.8);
      } else footAt(foot, fx * L, side * reach * L, p.phase + tripod(i, side), stride * L, lift * L, p.amp);
      leg3(rig, hip, foot, ll * 0.5, ll * 0.5, l3, r, color, surf, color, 0.85, (side > 0 ? 'L' : 'R') + (i + 1));
    }
  });
}

/** Two-segment antennae from the head, waving gently. */
function antennae(rig: Rig, p: CrPose, x: number, y: number, z: number, len: number, r: number, color: THREE.ColorRepresentation, surf: Surface, spread = 0.5, up = 0.35): void {
  for (const side of [-1, 1]) {
    const wv = Math.sin(p.t * 3 + side * 1.7 + p.v2 * 9) * 0.12;
    tmpA.set(x, y, side * z);
    tmpB.set(x + len * 0.45 * Math.cos(spread + wv), y + len * up * 0.5, side * (z + len * 0.45 * Math.sin(spread + wv)));
    rig.tube(tmpA, tmpB, r, color, surf);
    tmpC.set(tmpB.x + len * 0.55 * Math.cos(spread * 0.6 - wv), tmpB.y + len * up * 0.12, side * (Math.abs(tmpB.z) + len * 0.55 * Math.sin(spread * 0.6 - wv)));
    rig.tube(tmpB, tmpC, r * 0.7, color, surf);
  }
}

// ---------------------------------------------------------------------------
// Pill woodlouse (Armadillidium vulgare): a domed, banded shell over seven
// pairs of short legs; it rolls into a ball when threatened.
// ---------------------------------------------------------------------------

const PB = { plate: C(0x4f545c), edge: C(0x646a72), leg: C(0x6e7076), head: C(0x3e4249) };

export function pillbug(rig: Rig, p: CrPose): void {
  const L = p.L * shrink(p);
  const roll = p.state === ST.Rolled ? ease(p.st * 3) : 0;
  const h = L * 0.3;
  const flip = deadRoll(p) * 0.5;
  placeBody(rig, p, L, 0, flip, flipLift(flip, h * 0.4));
  const shell = S(0.42, 0.4, 1, 8);
  if (roll > 0.97) {
    const r = L * 0.3;
    rig.ell(0, r, 0, r, r, r * 0.98, PB.plate, shell, 0, p.t * 0.2, 0);
    return;
  }
  // the shell morphs from a long dome into the ball
  const rx = L * (0.5 - roll * 0.2);
  const ry = h * 0.72 + roll * (L * 0.3 - h * 0.72);
  const rz = L * (0.27 + roll * 0.02);
  rig.ell(0, ry * 0.52, 0, rx, ry, rz, PB.plate, shell);
  // flared plate edges (epimera) a little lighter, banded the same way
  rig.ell(0, h * 0.2, 0, rx * 0.97, h * 0.3 * (1 - roll), rz * 1.1, PB.edge, S(0.45, 0.4, 1, 8));
  if (roll > 0.4) return;
  rig.ell(rx * 0.92, h * 0.22, 0, L * 0.06, h * 0.32, L * 0.12, PB.head, S(0.5, 0.3));
  antennae(rig, p, rx * 0.98, h * 0.22, L * 0.07, L * 0.22, L * 0.013, PB.leg, S(0.6, 0.1), 0.9, -0.3);
  // tail plates (uropods)
  for (const side of [-1, 1]) {
    tmpA.set(-rx * 0.9, h * 0.15, side * L * 0.05);
    tmpB.set(-rx * 1.05, h * 0.12, side * L * 0.07);
    rig.cone(tmpA, tmpB, L * 0.025, PB.edge, S(0.5, 0.3));
  }
  // seven pairs of short legs in a metachronal wave, mostly hidden under the shell
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) {
      const x = L * (0.32 - i * 0.1);
      hip.set(x, h * 0.18, side * L * 0.12);
      if (p.dead) foot.set(x, h * 0.05, side * L * 0.15);
      else footAt(foot, x, side * L * 0.22, p.phase + wave(i, side, 0.14), L * 0.12, L * 0.05, p.amp, 0.65);
      limb(rig, hip, foot, L * 0.09, L * 0.1, L * 0.013, 0, 1, side * 0.5, PB.leg, S(0.6, 0.15));
    }
  }
}

// ---------------------------------------------------------------------------
// Chains (caterpillar, centipedes): segments follow the creature's own trail
// ---------------------------------------------------------------------------

/** Point `dist` mm back along the chain (world x, z) and the body's heading there (chainTrail.ts). */
const along = (p: CrPose, dist: number) => chainPoint(p, dist);

// Turnip moth caterpillar (Agrotis segetum): greasy grey-brown, thick and smooth.
const CW = { body: C(0x857558), back: C(0x5e5040), side: C(0x9c8c6c), head: C(0x6b4a2a), leg: C(0x9a8a6a) };

export function cutworm(rig: Rig, p: CrPose): void {
  const L = p.L * shrink(p);
  const r = L * 0.085;
  const n = 13;
  const segL = L / n;
  const curl = p.state === ST.Curled ? ease(p.st * 2.5) : 0;
  for (let i = 0; i < n; i++) {
    let wx: number, wz: number, hh: number;
    const s = along(p, i * segL);
    if (curl > 0) {
      // into a C, then a tight ring, round the body centre
      const a = (i / (n - 1) - 0.5) * Math.PI * (1 + curl * 0.75);
      const R = L / (Math.PI * (1 + curl * 0.75));
      wx = s.x * (1 - curl) + (p.x + Math.cos(p.h + a) * R) * curl;
      wz = s.z * (1 - curl) + (p.z + Math.sin(p.h + a) * R) * curl;
      hh = s.h * (1 - curl) + (p.h + a + Math.PI / 2) * curl;
    } else {
      wx = s.x;
      wz = s.z;
      hh = s.h;
    }
    // peristaltic wave: segments lift in turn as it crawls
    const wv = Math.max(0, Math.sin(p.phase * Math.PI * 2 - i * 0.7)) * p.amp;
    const taper = i === 0 ? 0.85 : 1 - 0.18 * Math.max(0, (i - 9) / 3);
    rig.setBase(wx, p.ground(wx, wz) + r * taper * 0.95 + wv * r * 0.3, wz, hh, 0, deadRoll(p) * 0.5);
    rig.recFrame('s' + i);
    if (i === 0) {
      rig.ell(segL * 0.25, 0, 0, segL * 0.7, r * 0.82, r * 0.78, CW.head, S(0.35, 0.5));
      continue;
    }
    rig.ell(0, 0, 0, segL * 0.85, r * taper, r * taper, CW.body, S(0.45, 0.35, 4, 0.7));
    rig.ell(0, r * 0.5 * taper, 0, segL * 0.6, r * 0.5 * taper, r * 0.38 * taper, CW.back, S(0.7, 0.05, 4, 2));
    rig.ell(0, -r * 0.15, 0, segL * 0.7, r * 0.45 * taper, r * 1.02 * taper, CW.side, S(0.7, 0.05, 4, 1.6));
    // three pairs of true legs, four of prolegs and the anal pair
    if (i <= 3 || (i >= 6 && i <= 9) || i === 12) {
      for (const side of [-1, 1]) {
        tmpA.set(0, -r * 0.45, side * r * 0.65);
        tmpB.set(0, -r * 0.98, side * r * 0.85);
        rig.cone(tmpA, tmpB, r * (i <= 3 ? 0.16 : 0.28), CW.leg, S(0.7, 0.05));
        if (rig.rec) {
          // a proleg is a short stub: the rail runs from its tip up the body's flank
          tmpC.set(0, r * 0.2, side * r * 0.95);
          rig.recLeg('s' + i + (side > 0 ? 'L' : 'R'), tmpC, tmpA, tmpB, tmpB);
        }
      }
    }
  }
}

const LI = { body: C(0x7a4022), edge: C(0x5a2e16), leg: C(0xa8683a), head: C(0x6e3a1c) };
const SC = { body: C(0xc88d2c), head: C(0xc0451c), leg: C(0xe2b63c), tip: C(0x111111) };

const _sp = { x: 0, z: 0, h: 0 };
/**
 * Point at arc length `d` along a spiral r = r0 + b·θ with loops `gap` apart
 * (local x, z), and the heading pointing back toward the centre (the head end).
 */
function spiralAt(d: number, r0: number, gap: number): typeof _sp {
  const b = gap / (Math.PI * 2);
  // invert arc length s(θ) ≈ (r0 θ + b θ²/2) for θ (good while r ≫ b)
  const th = b > 1e-6 ? (-r0 + Math.sqrt(r0 * r0 + 2 * b * d)) / b : d / r0;
  const r = r0 + b * th;
  _sp.x = Math.cos(th) * r;
  _sp.z = Math.sin(th) * r;
  // tangent of increasing θ; the body runs from the head (θ = 0) outward, so it faces back along it
  const tx = -Math.sin(th) * r + Math.cos(th) * b;
  const tz = Math.cos(th) * r + Math.sin(th) * b;
  _sp.h = Math.atan2(-tz, -tx);
  return _sp;
}

/** Lithobius (15 pairs) and Scolopendra (21 pairs): a flattened chain of tergites with a leg pair each. */
function centipede(rig: Rig, p: CrPose, pairs: number, big: boolean): void {
  const L = p.L * shrink(p);
  const n = pairs + 1;
  const segL = L / n;
  const wz = L * (big ? 0.055 : 0.05);
  const hy = L * (big ? 0.022 : 0.018);
  const col = big ? SC : LI;
  const coil = p.state === ST.Coil ? ease(p.st * 2) : 0;
  const whip = p.state === ST.Whip ? Math.sin(Math.min(1, p.st * 2) * Math.PI) : 0;
  const lift = L * (big ? 0.035 : 0.03);
  for (let i = 0; i < n; i++) {
    let x: number, z: number, hh: number;
    const s0 = along(p, i * segL);
    if (coil > 0) {
      // coiled round its prey: an Archimedean spiral out from the head, loops side by side
      const sp = spiralAt(i * segL, L * 0.05, wz * 2.3);
      const c = Math.cos(p.h);
      const sn = Math.sin(p.h);
      const cxw = p.hx + c * sp.x - sn * sp.z;
      const czw = p.hz + sn * sp.x + c * sp.z;
      x = s0.x * (1 - coil) + cxw * coil;
      z = s0.z * (1 - coil) + czw * coil;
      hh = s0.h * (1 - coil) + (p.h + sp.h) * coil;
    } else {
      x = s0.x;
      z = s0.z;
      hh = s0.h;
      if (whip > 0 && i > n * 0.5) {
        const k = (i - n * 0.5) / (n * 0.5);
        const off = whip * k * k * L * 0.25;
        x += Math.cos(hh + Math.PI / 2) * off;
        z += Math.sin(hh + Math.PI / 2) * off;
      }
    }
    rig.setBase(x, p.ground(x, z) + lift, z, hh, 0, deadRoll(p) * 0.5);
    rig.recFrame('s' + i);
    if (i === 0) {
      rig.ell(segL * 0.1, 0, 0, segL * 0.7, hy * 1.2, wz * 0.95, col.head, S(0.35, 0.6));
      // forcipules curving under the head
      for (const side of [-1, 1]) {
        tmpA.set(segL * 0.2, -hy * 0.6, side * wz * 0.5);
        tmpB.set(segL * 1.0, -hy * 0.8, side * wz * 0.15);
        rig.cone(tmpA, tmpB, wz * 0.22, big ? SC.tip : LI.edge, S(0.3, 0.7));
      }
      antennae(rig, p, segL * 0.6, 0, wz * 0.4, L * (big ? 0.1 : 0.4), L * 0.006, col.leg, S(0.5, 0.2), 0.55, 0.1);
      continue;
    }
    // Lithobius tergites alternate long and short; Scolopendra's carry a dark rear band
    const long = big ? 1 : i % 2 ? 1 : 0.85;
    rig.ell(0, 0, 0, segL * 0.7 * long, hy, wz * long, i === 1 && big ? SC.head : col.body, big ? S(0.3, 0.7, 6, 1) : S(0.35, 0.6));
    // one pair of legs per segment, longer toward the rear; the last pair trails backward
    const last = i === n - 1;
    const len = L * (big ? 0.07 : 0.11) * (1 + (i / n) * 0.6) * (last ? 1.8 : 1);
    for (const side of [-1, 1]) {
      hip.set(0, -hy * 0.2, side * wz * 0.9);
      if (last) {
        foot.set(-len * 0.9, -hy * 0.6, side * (wz + len * 0.35));
        limb(rig, hip, foot, len * 0.55, len * 0.55, L * 0.006 * (big ? 1.8 : 1), 0, 1, side, col.leg, S(0.4, 0.4));
      } else {
        if (p.dead) foot.set(0, -hy - len * 0.35, side * (wz + len * 0.3));
        else {
          footAt(foot, 0, side * (wz + len * 0.7), p.phase + wave(i, side, 0.09), segL * 1.1, len * 0.18, coil > 0 ? 0 : p.amp, 0.55);
          foot.y -= lift - 0.001;
        }
        const kn = limb(rig, hip, foot, len * 0.55, len * 0.6, L * 0.0045 * (big ? 1.6 : 1), 0, 1, side * 0.4, col.leg, S(0.45, 0.35));
        rig.recLeg('s' + i + (side > 0 ? 'L' : 'R'), hip, kn, limbEnd, limbEnd);
      }
    }
  }
}

export function lithobius(rig: Rig, p: CrPose): void {
  centipede(rig, p, 15, false);
}

export function scolopendra(rig: Rig, p: CrPose): void {
  centipede(rig, p, 21, true);
}

// ---------------------------------------------------------------------------
// Beetles: ground beetle, devil's coach horse, stag beetle
// ---------------------------------------------------------------------------

const GB = { black: C(0x17181d), rim: C(0x2c2042), leg: C(0x1c1c20) };

/** Curved mandible: a thick base and a pointed tip bending inward. */
function mandible(rig: Rig, bx: number, by: number, bz: number, len: number, r: number, open: number, side: number, color: THREE.ColorRepresentation, surf: Surface): void {
  tmpA.set(bx, by, bz);
  tmpB.set(bx + len * 0.55, by - len * 0.03, bz + side * len * (0.12 + open * 0.35));
  rig.tube(tmpA, tmpB, r, color, surf);
  tmpC.set(tmpB.x + len * 0.45, tmpB.y - len * 0.02, tmpB.z - side * len * (0.25 - open * 0.15));
  rig.cone(tmpB, tmpC, r * 0.8, color, surf);
}

export function groundBeetle(rig: Rig, p: CrPose): void {
  const L = p.L * shrink(p);
  const lift = L * 0.13;
  const flip = deadRoll(p);
  placeBody(rig, p, L, 0, flip, flipLift(flip, lift));
  // elytra (.55 L) with striae and a violet rim (Carabus); pronotum and head
  rig.ell(-L * 0.16, lift - L * 0.01, 0, L * 0.29, L * 0.07, L * 0.2, GB.rim, S(0.25, 0.8));
  rig.ell(-L * 0.16, lift, 0, L * 0.285, L * 0.088, L * 0.19, GB.black, S(0.22, 0.9, 3, 1.4));
  rig.ell(L * 0.17, lift + L * 0.005, 0, L * 0.095, L * 0.07, L * 0.15, GB.black, S(0.3, 0.7));
  rig.ell(L * 0.32, lift - L * 0.005, 0, L * 0.08, L * 0.055, L * 0.095, GB.black, S(0.3, 0.7));
  for (const side of [-1, 1]) rig.ell(L * 0.33, lift + L * 0.01, side * L * 0.085, L * 0.025, L * 0.025, L * 0.022, EYE, EYE_S);
  // sickle mandibles, snapping when it attacks
  const open = p.state === ST.Attack || p.state === ST.Chase ? 0.4 + 0.3 * Math.sin(p.t * 14) : 0.1;
  for (const side of [-1, 1]) mandible(rig, L * 0.38, lift - L * 0.02, side * L * 0.045, L * 0.15, L * 0.02, open, side, GB.black, S(0.25, 0.8));
  antennae(rig, p, L * 0.38, lift + L * 0.02, L * 0.06, L * 0.5, L * 0.008, GB.leg, S(0.4, 0.4), 0.45, 0.25);
  insectLegs(
    rig,
    p,
    L,
    [
      [0.18, 0.42, 0.36],
      [0.05, 0.05, 0.44],
      [-0.05, -0.36, 0.42],
    ],
    lift - L * 0.04,
    L * 0.08,
    L * 0.016,
    GB.leg,
    S(0.3, 0.6),
    0.35,
    0.09,
  );
}

const RV = { black: C(0x141414), dull: C(0x1d1c1a) };

export function rove(rig: Rig, p: CrPose): void {
  const L = p.L * shrink(p);
  const lift = L * 0.08;
  const flip = deadRoll(p);
  placeBody(rig, p, L, 0, flip, flipLift(flip, lift));
  const matte = S(0.85, 0.05, 2, 0.6);
  // square head as wide as the pronotum, big curved mandibles
  rig.ell(L * 0.36, lift, 0, L * 0.085, L * 0.045, L * 0.075, RV.black, matte);
  for (const side of [-1, 1]) rig.ell(L * 0.4, lift + L * 0.012, side * L * 0.06, L * 0.015, L * 0.014, L * 0.012, EYE, EYE_S);
  rig.ell(L * 0.22, lift, 0, L * 0.07, L * 0.045, L * 0.068, RV.black, matte);
  // short square elytra over the first abdominal segments
  rig.ell(L * 0.09, lift + L * 0.003, 0, L * 0.075, L * 0.042, L * 0.075, RV.dull, S(0.75, 0.1, 3, 1));
  const open = p.state === ST.Display || p.state === ST.Attack ? 0.7 : 0.15;
  for (const side of [-1, 1]) mandible(rig, L * 0.43, lift - L * 0.01, side * L * 0.035, L * 0.11, L * 0.016, open, side, RV.black, S(0.4, 0.5));
  antennae(rig, p, L * 0.42, lift + L * 0.02, L * 0.05, L * 0.3, L * 0.007, RV.black, matte, 0.5, 0.3);
  // the long flexible abdomen; raised over the back like a scorpion's tail in threat display
  const raise = p.state === ST.Display ? ease(p.st * 3) : 0;
  let ax = L * 0.03;
  let ay = lift;
  let ang = 0;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const segLen = L * 0.075;
    ang += (raise * 0.5 + (1 - raise) * Math.sin(p.t * 2 + i) * 0.025) * (i > 0 ? 1 : 0.3);
    const cx = ax - (Math.cos(ang) * segLen) / 2;
    const cy = ay + (Math.sin(ang) * segLen) / 2;
    ax -= Math.cos(ang) * segLen;
    ay += Math.sin(ang) * segLen;
    const w = L * (0.068 - i * 0.005);
    rig.ell(cx, cy, 0, segLen * 0.95, L * 0.038, w, RV.black, S(0.8, 0.1), 0, ang, 0);
  }
  // tail tip with the stink glands
  for (const side of [-1, 1]) {
    tmpA.set(ax + Math.cos(ang) * L * 0.01, ay, side * L * 0.015);
    tmpB.set(ax - Math.cos(ang) * L * 0.05, ay + Math.sin(ang) * L * 0.05, side * L * 0.025);
    rig.cone(tmpA, tmpB, L * 0.012, RV.black, matte);
  }
  insectLegs(
    rig,
    p,
    L,
    [
      [0.24, 0.42, 0.25],
      [0.15, 0.1, 0.3],
      [0.06, -0.22, 0.28],
    ],
    lift - L * 0.025,
    L * 0.05,
    L * 0.013,
    RV.black,
    matte,
    0.3,
    0.07,
  );
}

const SG = { black: C(0x111112), chestnut: C(0x6b2a14), jaw: C(0x7a3418) };

export function stagBeetle(rig: Rig, p: CrPose): void {
  const L = p.L * shrink(p);
  const rear = p.state === ST.WindUp || p.state === ST.Rear ? ease(p.st * 2) : 0;
  const lift = L * 0.14;
  const flip = deadRoll(p);
  placeBody(rig, p, L, rear * 0.35, flip, flipLift(flip, lift) + rear * L * 0.06);
  // elytra chestnut, high gloss; pronotum and head black satin
  rig.ell(-L * 0.18, lift, 0, L * 0.28, L * 0.11, L * 0.17, SG.chestnut, S(0.15, 1.2));
  rig.ell(L * 0.1, lift + L * 0.01, 0, L * 0.1, L * 0.08, L * 0.15, SG.black, S(0.35, 0.6));
  rig.ell(L * 0.22, lift - L * 0.01, 0, L * 0.06, L * 0.05, L * 0.13, SG.black, S(0.4, 0.5));
  for (const side of [-1, 1]) rig.ell(L * 0.22, lift, side * L * 0.125, L * 0.018, L * 0.018, L * 0.016, EYE, EYE_S);
  // antler mandibles (.35 L), opening wide in the wind-up, clamping in the attack
  const open = rear > 0 ? 0.9 : p.state === ST.Attack ? 0.2 + 0.5 * Math.abs(Math.sin(p.st * 5)) : 0.45;
  for (const side of [-1, 1]) {
    const bx = L * 0.26;
    const bz = side * L * 0.07;
    tmpA.set(bx, lift, bz);
    tmpB.set(bx + L * 0.17, lift + L * 0.04, side * L * (0.1 + open * 0.08));
    rig.tube(tmpA, tmpB, L * 0.026, SG.jaw, S(0.15, 1.1));
    tmpC.set(tmpB.x + L * 0.14, tmpB.y + L * 0.02, tmpB.z - side * L * (0.07 + (1 - open) * 0.05));
    rig.tube(tmpB, tmpC, L * 0.02, SG.jaw, S(0.15, 1.1));
    // inner tooth and forked tip
    tmpA.set((tmpA.x + tmpB.x) / 2, tmpB.y, (tmpA.z + tmpB.z) / 2);
    tmpB.set(tmpA.x + L * 0.01, tmpA.y + L * 0.03, tmpA.z - side * L * 0.03);
    rig.cone(tmpA, tmpB, L * 0.01, SG.jaw, S(0.2, 1));
    tmpA.copy(tmpC);
    tmpB.set(tmpC.x + L * 0.03, tmpC.y + L * 0.025, tmpC.z);
    rig.cone(tmpA, tmpB, L * 0.009, SG.jaw, S(0.2, 1));
  }
  antennae(rig, p, L * 0.26, lift, L * 0.1, L * 0.18, L * 0.008, SG.black, S(0.4, 0.4), 1.0, 0.3);
  insectLegs(
    rig,
    p,
    L,
    [
      [0.12, 0.34, 0.3],
      [-0.02, -0.02, 0.36],
      [-0.12, -0.32, 0.34],
    ],
    lift - L * 0.05,
    L * 0.08,
    L * 0.018,
    SG.black,
    S(0.3, 0.6),
    0.25,
    0.07,
  );
}

// ---------------------------------------------------------------------------
// Spiders: wolf spider, spiderling, Hogna mother, tarantula
// ---------------------------------------------------------------------------

interface SpiderLook {
  body: THREE.Color;
  dark: THREE.Color;
  leg: THREE.Color;
  /** patella colour (the red-knee tarantula's orange knees), null = the leg colour */
  knee: THREE.Color | null;
  hair: Surface;
  /** relative leg lengths I..IV (fractions of L) */
  legs: [number, number, number, number];
  thick: number;
  fangs: THREE.Color;
  bigEyes: boolean;
}

const WOLF: SpiderLook = { body: C(0x5b4632), dark: C(0x2e2318), leg: C(0x6a5440), knee: null, hair: S(0.85, 0.05, 2, 1.5), legs: [1.15, 1.05, 0.95, 1.35], thick: 0.024, fangs: C(0x1a120c), bigEyes: true };
const TARA: SpiderLook = { body: C(0x1c1612), dark: C(0x0d0a08), leg: C(0x1e1814), knee: C(0xc6501e), hair: S(0.95, 0.02, 2, 0.8), legs: [1.05, 0.95, 0.85, 1.1], thick: 0.055, fangs: C(0x050505), bigEyes: false };

const RIDER = C(0x8a7458);

function spider(rig: Rig, p: CrPose, look: SpiderLook, abdomenK = 1): void {
  const L = p.L * shrink(p);
  const rear = p.state === ST.Rear || p.state === ST.WindUp ? ease(p.st * 3) : 0;
  const pounce = p.state === ST.Pounce || p.state === ST.Leap ? Math.sin(Math.min(1, p.st * 2.5) * Math.PI) : 0;
  const lift = L * (0.17 + pounce * 0.15) + rear * L * 0.08 - (p.dead ? L * 0.08 : 0);
  placeBody(rig, p, L, rear * 0.5 + pounce * 0.15, 0, 0);
  // cephalothorax .48 L, abdomen .52 L on a thin pedicel
  const cx = L * 0.22;
  rig.ell(cx, lift, 0, L * 0.24, L * 0.11, L * 0.18, look.body, look.hair);
  rig.ell(cx + L * 0.11, lift + L * 0.045, 0, L * 0.11, L * 0.06, L * 0.1, look.body, look.hair);
  // wolf spiders: a dark band down the carapace
  if (look.bigEyes) rig.ell(cx, lift + L * 0.075, 0, L * 0.2, L * 0.04, L * 0.045, look.dark, look.hair);
  const ab = L * 0.26 * abdomenK;
  rig.ell(-L * 0.26, lift + L * 0.03, 0, ab, L * 0.15 * abdomenK, L * 0.17 * abdomenK, look.body, look.hair, 0, 0.12, 0);
  rig.ell(-L * 0.22, lift + L * 0.13 * abdomenK, 0, ab * 0.6, L * 0.04, L * 0.05, look.dark, look.hair, 0, 0.12, 0);
  // eyes: wolf spiders a row of four small and two very large forward-facing; tarantulas a tight cluster
  const eye = (x: number, y: number, z: number, r: number) => rig.ell(x, y, z, r, r, r, EYE, EYE_S);
  for (const side of [-1, 1]) {
    if (look.bigEyes) {
      eye(cx + L * 0.215, lift + L * 0.08, side * L * 0.035, L * 0.03);
      eye(cx + L * 0.15, lift + L * 0.11, side * L * 0.06, L * 0.022);
      for (const k of [0.015, 0.045]) eye(cx + L * 0.235, lift + L * 0.04, side * L * k, L * 0.01);
    } else {
      eye(cx + L * 0.2, lift + L * 0.1, side * L * 0.02, L * 0.012);
      eye(cx + L * 0.19, lift + L * 0.095, side * L * 0.04, L * 0.01);
    }
  }
  // chelicerae with fangs; pedipalps held in front, moving
  const strike = p.state === ST.Attack || p.state === ST.Eat ? 0.5 + 0.5 * Math.sin(p.t * 12) : 0;
  for (const side of [-1, 1]) {
    rig.ell(cx + L * 0.25, lift - L * 0.025, side * L * 0.04, L * 0.04, L * 0.06, L * 0.035, look.dark, look.hair, 0, -0.5, 0);
    tmpA.set(cx + L * 0.27, lift - L * 0.07, side * L * 0.04);
    tmpB.set(tmpA.x + L * (0.01 + strike * 0.04), tmpA.y - L * 0.04, side * L * 0.02);
    rig.cone(tmpA, tmpB, L * 0.014, look.fangs, S(0.15, 1));
    hip.set(cx + L * 0.2, lift - L * 0.01, side * L * 0.08);
    foot.set(cx + L * (0.38 + 0.03 * Math.sin(p.t * 5 + side)), Math.max(0, lift * 0.25) + rear * L * 0.15, side * L * 0.13);
    limb(rig, hip, foot, L * 0.13, L * 0.13, L * look.thick * 0.8, 0, 1, side * 0.3, look.leg, look.hair);
  }
  // eight legs, alternating tetrapod gait; the front pairs lift high when it rears
  for (let i = 0; i < 4; i++) {
    const len = look.legs[i] * L;
    const ang = [0.95, 0.35, -0.35, -0.9][i]; // splay from sideways: I, II forward, III, IV back
    for (const side of [-1, 1]) {
      hip.set(cx + L * (0.07 - i * 0.045), lift - L * 0.03, side * L * 0.1);
      const reach = len * 0.78;
      const rx = hip.x + Math.sin(ang) * reach;
      const rz = side * (L * 0.1 + Math.cos(ang) * reach);
      foot.set(rx, 0, rz);
      const l3 = len * 0.3;
      const ll = Math.max(legLen(hip, foot, l3, 1.05), len * 0.72);
      if (p.dead) {
        // dead spiders curl their legs in under the body
        foot.set(cx - L * 0.02 * i, lift * 0.3, side * L * 0.14);
      } else {
        footAt(foot, rx, rz, p.phase + tetrapod(i, side), L * 0.35, L * 0.12, p.amp);
        if (rear > 0 && i < 2) {
          foot.x += rear * L * (0.15 - i * 0.08);
          foot.y += rear * L * (0.55 - i * 0.2);
        }
        if (p.state === ST.Flick && i === 3) foot.set(-L * 0.35, lift + L * 0.15 * (0.5 + 0.5 * Math.sin(p.t * 20)), side * L * 0.15);
      }
      leg3(rig, hip, foot, ll * 0.52, ll * 0.48, l3, L * look.thick, look.leg, look.hair, look.knee ?? look.leg, look.knee ? 0.98 : 0.85, (side > 0 ? 'L' : 'R') + (i + 1));
    }
  }
  // Hogna mother: spiderlings riding on her abdomen
  const riders = Math.min(14, p.data.riders ?? 0);
  for (let i = 0; i < riders; i++) {
    const a = i * 2.39996 + p.v2 * 6;
    const rr = Math.sqrt((i + 0.5) / 14) * ab * 0.75;
    const y = lift + L * 0.03 + Math.sqrt(Math.max(0, 1 - (rr / ab) * (rr / ab))) * L * 0.15 * abdomenK;
    rig.ell(-L * 0.26 + Math.cos(a) * rr, y, Math.sin(a) * rr * 0.75, L * 0.04, L * 0.028, L * 0.032, i % 3 ? RIDER : look.dark, look.hair, a);
  }
}

export function wolfSpider(rig: Rig, p: CrPose): void {
  spider(rig, p, WOLF);
}

export function hogna(rig: Rig, p: CrPose): void {
  spider(rig, p, WOLF, 1.15);
}

export function tarantula(rig: Rig, p: CrPose): void {
  spider(rig, p, TARA, 1.08);
}

export function spiderling(rig: Rig, p: CrPose): void {
  spider(rig, p, WOLF);
}

// ---------------------------------------------------------------------------
// Mantids: European mantis and the giant Asian mantis (boss)
// ---------------------------------------------------------------------------

interface MantisLook {
  body: THREE.Color;
  wing: THREE.Color;
  eye: THREE.Color;
  spot: THREE.Color;
  /** the European mantis's black-ringed spot inside the front coxa */
  coxaSpot: boolean;
  heavy: number;
}

const MR: MantisLook = { body: C(0x6f9a3c), wing: C(0x86ad52), eye: C(0x9cbf5a), spot: C(0x111111), coxaSpot: true, heavy: 1 };
const HM: MantisLook = { body: C(0x5f8f2e), wing: C(0x7aa548), eye: C(0x8fb64e), spot: C(0xe9e4c8), coxaSpot: false, heavy: 1.3 };

function mantisBody(rig: Rig, p: CrPose, look: MantisLook): void {
  const L = p.L * shrink(p);
  const sway = p.state === ST.Lurk ? Math.sin(p.t * 1.3 + p.v2 * 7) * 0.06 : 0;
  const strike = p.state === ST.Strike || p.state === ST.Attack ? Math.sin(Math.min(1, p.st * 4) * Math.PI) : 0;
  const lift = L * 0.12;
  const flip = deadRoll(p);
  placeBody(rig, p, L, 0, flip + sway * 0.5, flipLift(flip, lift));
  const satin = S(0.45, 0.35);
  // abdomen under folded wings (.45 L), from the back of the mesothorax
  rig.ell(-L * 0.2, lift + L * 0.02, 0, L * 0.25, L * 0.04 * look.heavy, L * 0.05 * look.heavy, look.body, satin, 0, 0.08, 0);
  rig.ell(-L * 0.17, lift + L * 0.055, 0, L * 0.25, L * 0.012, L * 0.06 * look.heavy, look.wing, S(0.4, 0.3, 5, 1.2), 0, 0.06, 0);
  if (!look.coxaSpot) for (const side of [-1, 1]) rig.ell(-L * 0.05, lift + L * 0.068, side * L * 0.04, L * 0.012, L * 0.004, L * 0.008, look.spot, satin);
  rig.ell(L * 0.03, lift, 0, L * 0.06, L * 0.035 * look.heavy, L * 0.04 * look.heavy, look.body, satin);
  // long slender prothorax (.30 L) rising forward
  const pa = 0.55 + strike * 0.2;
  tmpA.set(L * 0.06, lift + L * 0.01, 0);
  tmpB.set(L * 0.06 + (Math.cos(pa) * L * 0.3) / look.heavy, lift + (Math.sin(pa) * L * 0.3) / look.heavy, 0);
  rig.tube(tmpA, tmpB, L * 0.022 * look.heavy, look.body, satin);
  const nx = tmpB.x;
  const ny = tmpB.y;
  // triangular head swivelling, big eyes at the corners
  const yaw = sway * 3 + Math.sin(p.t * 0.7 + p.v2 * 3) * 0.3;
  rig.ell(nx + L * 0.03, ny + L * 0.02, 0, L * 0.03, L * 0.035, L * 0.055, look.body, satin, yaw, 0.3, 0);
  for (const side of [-1, 1]) rig.ell(nx + L * 0.03 + Math.sin(yaw) * side * -L * 0.05, ny + L * 0.045, side * L * 0.05 * Math.cos(yaw), L * 0.022, L * 0.025, L * 0.02, look.eye, S(0.1, 1.1));
  antennae(rig, p, nx + L * 0.05, ny + L * 0.05, L * 0.02, L * 0.35, L * 0.004, look.body, satin, 0.25, 0.4);
  // raptorial forelegs: coxa down from the front of the prothorax, spined femur, jackknife tibia
  for (const side of [-1, 1]) {
    const bx = L * 0.06 + (Math.cos(pa) * L * 0.22) / look.heavy;
    const by = lift + (Math.sin(pa) * L * 0.22) / look.heavy;
    tmpA.set(bx, by, side * L * 0.025);
    tmpB.set(bx + L * 0.04 + strike * L * 0.06, by - L * 0.13, side * L * 0.04);
    rig.tube(tmpA, tmpB, L * 0.02 * look.heavy, look.body, satin);
    if (look.coxaSpot) rig.ell(tmpB.x - L * 0.005, tmpB.y + L * 0.06, side * L * 0.06, L * 0.012, L * 0.012, L * 0.004, look.spot, satin);
    // femur forward and up; folded when lurking, shooting forward in the strike
    const fa = 1.1 - strike * 1.2;
    const fx = Math.cos(fa);
    const fy = Math.sin(fa);
    tmpC.set(tmpB.x + fx * L * 0.16, tmpB.y + fy * L * 0.16, side * L * 0.045);
    rig.tube(tmpB, tmpC, L * 0.022 * look.heavy, look.body, satin);
    // a row of spines along the femur's inner (lower) edge
    for (let k = 1; k <= 4; k++) {
      const u = k / 5;
      tmpA.set(tmpB.x + fx * L * 0.16 * u + fy * L * 0.015, tmpB.y + fy * L * 0.16 * u - fx * L * 0.015, side * L * 0.045);
      ankle.set(tmpA.x + fy * L * 0.022, tmpA.y - fx * L * 0.022, tmpA.z);
      rig.cone(tmpA, ankle, L * 0.004, look.eye, satin);
    }
    const ta = fa + Math.PI - 0.35 + strike * 2.2;
    tmpA.set(tmpC.x + Math.cos(ta) * L * 0.13, tmpC.y + Math.sin(ta) * L * 0.13, side * L * 0.045);
    rig.tube(tmpC, tmpA, L * 0.012 * look.heavy, look.body, satin);
  }
  // two pairs of long thin walking legs
  insectLegs(
    rig,
    p,
    L,
    [
      [0.02, 0.14, 0.3],
      [-0.03, -0.28, 0.32],
    ],
    lift - L * 0.01,
    L * 0.03,
    L * 0.009 * look.heavy,
    look.body,
    satin,
    0.25,
    0.05,
    1.35,
  );
}

export function mantis(rig: Rig, p: CrPose): void {
  mantisBody(rig, p, MR);
}

export function giantMantis(rig: Rig, p: CrPose): void {
  mantisBody(rig, p, HM);
}

// ---------------------------------------------------------------------------
// Antlion larva in its pit: buried with only the jaws showing, or dug out
// ---------------------------------------------------------------------------

const AL = { body: C(0x6e604c), dark: C(0x4e4234), jaw: C(0x7a3c1e), sand: C(0x8e7252), pit: C(0x8a6c4a) };

export function antlion(rig: Rig, p: CrPose): void {
  const L = p.L * shrink(p);
  const exposed = (p.data.exposed ?? 0) > 0 || p.dead;
  const pit = p.data.pit ?? L * 1.3;
  placeBody(rig, p, L);
  if (!p.dead) {
    // the funnel: a dark rippled hollow inside a ring of thrown-out sand
    rig.ell(0, -L * 0.012, 0, pit, L * 0.02, pit, AL.pit, S(0.95, 0, 7, 1));
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + p.v2;
      const rr = pit * (1.02 + 0.04 * Math.sin(i * 2.3 + p.v2 * 9));
      rig.ell(Math.cos(a) * rr, -L * 0.01, Math.sin(a) * rr, pit * 0.11, L * (0.05 + 0.015 * Math.sin(i * 1.7)), pit * 0.07, AL.sand, S(0.95, 0, 4, 0.8), -a + Math.PI / 2, 0, 0);
    }
  }
  const snap = p.state === ST.Eat ? 0.1 : 0.65 + 0.05 * Math.sin(p.t * 2);
  if (!exposed) {
    // buried in the bottom of the pit: the top of the head and the open jaws
    const hy = -L * 0.01;
    rig.ell(L * 0.02, hy, 0, L * 0.07, L * 0.035, L * 0.08, AL.dark, S(0.8, 0.1, 4, 2));
    for (const side of [-1, 1]) {
      tmpA.set(L * 0.06, hy + L * 0.01, side * L * 0.045);
      tmpB.set(L * 0.22, hy + L * 0.03, side * L * (0.05 + snap * 0.12));
      rig.tube(tmpA, tmpB, L * 0.016, AL.jaw, S(0.35, 0.6));
      tmpC.set(L * 0.32, hy + L * 0.03, side * L * (0.02 + snap * 0.06));
      rig.cone(tmpB, tmpC, L * 0.013, AL.jaw, S(0.35, 0.6));
    }
    return;
  }
  // dug out: plump hairy abdomen, small head and thorax, huge sickle jaws, short legs
  const y = L * 0.11;
  rig.ell(-L * 0.1, y, 0, L * 0.3, L * 0.12, L * 0.26, AL.body, S(0.9, 0.05, 2, 1.2));
  rig.ell(L * 0.18, y + L * 0.01, 0, L * 0.09, L * 0.06, L * 0.1, AL.dark, S(0.85, 0.05, 4, 2));
  rig.ell(L * 0.28, y, 0, L * 0.06, L * 0.035, L * 0.075, AL.dark, S(0.8, 0.1, 4, 2));
  for (const side of [-1, 1]) {
    tmpA.set(L * 0.32, y, side * L * 0.05);
    tmpB.set(L * 0.5, y + L * 0.01, side * L * (0.05 + snap * 0.12));
    rig.tube(tmpA, tmpB, L * 0.018, AL.jaw, S(0.35, 0.6));
    tmpC.set(L * 0.6, y + L * 0.01, side * L * (0.02 + snap * 0.06));
    rig.cone(tmpB, tmpC, L * 0.014, AL.jaw, S(0.35, 0.6));
  }
  for (let i = 0; i < 3; i++)
    for (const side of [-1, 1]) {
      hip.set(L * (0.2 - i * 0.07), y - L * 0.04, side * L * 0.08);
      foot.set(L * (0.25 - i * 0.12), p.dead ? y * 0.4 : 0, side * L * (p.dead ? 0.14 : 0.24));
      limb(rig, hip, foot, L * 0.12, L * 0.12, L * 0.016, 0, 1, side * 0.5, AL.dark, S(0.85, 0.05));
    }
}

export const BUILDERS: Record<string, (rig: Rig, p: CrPose) => void> = {
  pillbug,
  cutworm,
  groundBeetle,
  wolfSpider,
  lithobius,
  rove,
  mantis,
  antlion,
  spiderling,
  stagBeetle,
  tarantula,
  scolopendra,
  giantMantis,
  hogna,
};

/** Stride (mm per gait cycle) as a fraction of body length, per kind. */
export const STRIDE: Record<string, number> = {
  // = the builder's foot stride ÷ the stance fraction of the step, so planted feet keep still
  pillbug: 0.19,
  cutworm: 0.18,
  groundBeetle: 0.56,
  wolfSpider: 0.56,
  lithobius: 0.125,
  rove: 0.48,
  mantis: 0.4,
  antlion: 0.3,
  spiderling: 0.56,
  stagBeetle: 0.4,
  tarantula: 0.56,
  scolopendra: 0.091,
  giantMantis: 0.4,
  hogna: 0.56,
};

/** Kinds whose segments follow their own trail. */
export const CHAINS = new Set(['cutworm', 'lithobius', 'scolopendra']);

/** How far legs, jaws and pits reach beyond the body, as a multiple of L (framing, culling). */
export const EXTENT: Record<string, number> = {
  wolfSpider: 2.4,
  spiderling: 2.4,
  hogna: 2.2,
  tarantula: 2.1,
  mantis: 1.3,
  giantMantis: 1.3,
  antlion: 2.8,
};
