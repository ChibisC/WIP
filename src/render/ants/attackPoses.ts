import * as THREE from 'three';

/**
 * Melee attack animations (render only), shared by every ant and termite.
 *
 * In Empires of the Undergrowth an attack plays once per attack (attack
 * speed = attacks per second) and special attacks reuse the basic attack's
 * animation, so whatever variant plays, the bite lands on the beat. Here each
 * biting unit cycles through three attacks that all last exactly one attack
 * interval and all close the jaws at the same moment, `ATTACK_CONTACT` of the
 * way through, which is the sim tick the damage lands:
 *
 *  0. **Lunge bite** — draw back with the jaws agape, thrust forward, snap.
 *  1. **Rear-up chomp** — rear up on the hind legs (the ants' threat display),
 *     then crash down onto the target and chomp.
 *  2. **Side clamp and tug** — twist and clamp from one side, then pull back
 *     (the tug of war of ants holding a leg); the side alternates.
 *  3. **Grip and sting** (fire ants; see gripSting).
 *
 * Phase q: 0 → `WINDUP` wind-up, → `ATTACK_CONTACT` strike, → 1 recovery; the
 * pose is neutral at q = 0 and q = 1, so cycles chain without a pop.
 */
export const ATTACK_CONTACT = 0.7;
const WINDUP = 0.55;

export interface AttackPose {
  /** forward / back along the body, in body lengths */
  fwd: number;
  /** body pitch (rad, + raises the front; the renderer keeps the hind end on the ground) */
  pitch: number;
  /** body yaw (rad) and roll (rad) */
  yaw: number;
  roll: number;
  /** added head pitch / yaw (rad) */
  headPitch: number;
  headYaw: number;
  /** mandible opening 0..1 (absolute) */
  mand: number;
  /** added gaster pitch (rad, − curls it under) and the sting's extension 0..1 (grip-and-sting) */
  gaster: number;
  sting: number;
  // ---- spec 04 (planted feet): offsets of the body over feet that stay where they are
  /** up and to the right (body lengths), the body's pitch pivot along it (body lengths, + forward) */
  up: number;
  side: number;
  px: number;
  /** stance spread 0..1 (feet set wider: bracing), fore legs raised 0..1, gaster yaw (rad) */
  spread: number;
  front: number;
  gYaw: number;
}

export function neutralPose(out: AttackPose): AttackPose {
  out.fwd = out.pitch = out.yaw = out.roll = out.headPitch = out.headYaw = out.gaster = out.sting = 0;
  out.up = out.side = out.px = out.spread = out.front = out.gYaw = 0;
  out.mand = 0.25;
  return out;
}

const sm = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** fast out, gentle in: the strike */
const strikeEase = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return 1 - (1 - t) * (1 - t) * (1 - t);
};

/**
 * Pose of attack `variant` (0..2) at phase `q` (0..1); `side` ±1 for the side clamp. `bold` (the animation
 * pass): bigger key poses that change the outline seen from above (blind review: lunge and clamp differed by a
 * few pixels); the old motion keeps the small ones.
 */
export function attackPose(variant: number, q: number, side: number, out: AttackPose, bold = false): AttackPose {
  neutralPose(out);
  const C = ATTACK_CONTACT;
  // wind-up amount u (0 → 1), strike s (0 → 1), recovery r (1 → 0)
  const u = sm(q / WINDUP);
  const s = q < WINDUP ? 0 : strikeEase((q - WINDUP) / (C - WINDUP));
  const r = q < C ? 1 : 1 - sm((q - C) / (1 - C));
  // jaws gape through the wind-up, are shut at contact in every variant, then relax back to the rest opening
  out.mand = q < C ? (0.25 + 0.75 * u) * (1 - s) : 0.25 * (1 - r);
  if (variant === 3) return gripSting(q, side, out);
  const v = ((variant % 3) + 3) % 3;
  if (v === 0) {
    // lunge bite
    // (bold: it crouches back further first and lunges further)
    const back = (bold ? -0.12 : -0.06) * u;
    const lunge = bold ? 0.2 : 0.12;
    out.fwd = q < C ? back + (lunge - back) * s : lunge * r;
    out.headPitch = q < C ? 0.18 * u * (1 - s) - 0.3 * s : -0.3 * r;
    out.pitch = q < C ? 0.05 * u * (1 - s) - 0.06 * s : -0.06 * r;
  } else if (v === 1) {
    // rear up, crash down and chomp
    out.pitch = q < C ? 0.38 * u * (1 - s) - 0.1 * s : -0.1 * r;
    out.headPitch = q < C ? 0.25 * u * (1 - s) - 0.35 * s : -0.35 * r;
    out.fwd = q < C ? -0.03 * u * (1 - s) + 0.08 * s : 0.08 * r;
  } else {
    // side clamp, then tug back
    const tw = (bold ? 0.5 : 0.32) * side;
    const ys = bold ? 0.2 : 0.12;
    out.yaw = q < C ? tw * u * (1 - s) - ys * side * s : -ys * side * r;
    out.headYaw = q < C ? (bold ? 0.6 : 0.45) * side * u * (1 - s) - (bold ? 0.22 : 0.15) * side * s : -(bold ? 0.22 : 0.15) * side * r;
    out.roll = q < C ? 0.08 * side * u * (1 - s) : 0;
    // forward on the strike; the tug pulls back through the recovery (peak at 0.85), then settles
    const tug = q < C ? 0 : Math.sin(Math.PI * Math.min(1, (q - C) / (1 - C)));
    out.fwd = q < C ? 0.06 * s : 0.06 * r - (bold ? 0.16 : 0.08) * tug;
    out.headPitch = q < C ? -0.12 * s : -0.12 * r - 0.08 * tug;
  }
  return out;
}

/**
 * 3. **Grip and sting** (fire ants, animation pass): the jaws seize the victim early in the wind-up and hold;
 * the gaster swings forward under the body while the ant pivots round its grip; the sting jabs at contact,
 * then the gaster draws back and the grip relaxes. (Solenopsis workers hold on with the mandibles and sting
 * repeatedly, pivoting round the bite.)
 */
function gripSting(q: number, side: number, out: AttackPose): AttackPose {
  const C = ATTACK_CONTACT;
  const grip = sm(q / 0.22);
  const curl = sm((q - 0.15) / (WINDUP - 0.15));
  const jab = q < WINDUP ? 0 : strikeEase((q - WINDUP) / (C - WINDUP));
  const back = q < C ? 1 : 1 - sm((q - C) / (1 - C));
  // gape, then seize and hold, relaxing in the recovery
  out.mand = q < 0.12 ? 0.25 + 0.75 * sm(q / 0.12) : (1 - grip) * 0.95 + 0.05 + 0.2 * (1 - back);
  // the gaster swings down and on forward under the body (past vertical: blind review — curled only down it
  // could not reach the victim), the sting jabs forward at contact
  out.gaster = q < C ? -1.55 * curl - 0.55 * jab : -2.1 * back;
  out.sting = q < C ? 0.4 * curl + 0.6 * jab : back;
  // pivoting round the grip: the body swings well to one side (it reads from above) and tips forward onto
  // the grip, lifting the hind end so the curled gaster clears the ground
  out.yaw = (0.38 * curl + 0.1 * jab) * side * (q < C ? 1 : back);
  out.headYaw = -0.3 * side * curl * (q < C ? 1 : back);
  out.pitch = q < C ? -0.07 * curl - 0.05 * jab : -0.12 * back;
  out.headPitch = -0.22 * grip * (q < C ? 1 : back);
  out.fwd = 0.04 * grip * (q < C ? 1 : back);
  return out;
}

const tmpAx = new THREE.Vector3();

/**
 * Apply the body part of a pose (weight `w`) to an instance frame: vF / vU / vR
 * (forward, up, right, orthonormal) and the position vP. `L` is the body
 * length (mm); rearing lifts the centre so the hind legs stay on the ground.
 */
export function applyAttackBody(p: AttackPose, w: number, L: number, vF: THREE.Vector3, vU: THREE.Vector3, vR: THREE.Vector3, vP: THREE.Vector3): void {
  if (w <= 0.001) return;
  const yaw = p.yaw * w;
  if (yaw) {
    vF.applyAxisAngle(vU, yaw);
    vR.applyAxisAngle(vU, yaw);
  }
  const pitch = p.pitch * w;
  if (pitch) {
    tmpAx.copy(vR);
    // + pitch raises the front: rotate forward and up about the right axis
    vF.applyAxisAngle(tmpAx, pitch);
    vU.applyAxisAngle(tmpAx, pitch);
  }
  const roll = p.roll * w;
  if (roll) {
    vU.applyAxisAngle(vF, roll);
    vR.crossVectors(vF, vU).normalize();
  }
  vP.addScaledVector(vF, p.fwd * w * L);
  // keep the hind end planted while rearing (and the jaws above ground when crashing down)
  vP.addScaledVector(vU, Math.abs(Math.sin(pitch)) * L * 0.42);
}

// ---------------------------------------------------------------------------------------------------------------
// Spec 04 (docs/realism/combat.md): attacks over planted feet, for the species whose feet the shader plants.
// Every attack has three beats — a readable wind-up, a strike of 2–4 frames that lands on ATTACK_CONTACT (the
// damage tick), and a recovery — and moves the body over feet that stay put: the legs bend and straighten under
// it, brace wider, and only lift to step (never to strike). Jaws, sting and gaster do the attacking.
// ---------------------------------------------------------------------------------------------------------------

/** Attack variants of the planted-feet pass (attackVariant in antMotion.ts picks them per species and cycle). */
export const ATK = { LUNGE: 0, REAR: 1, CLAMP: 2, PIVOT_STING: 3, QUICK_STING: 4, CRUSH: 5, HEAD_SWING: 6, ACID: 7 } as const;

type Key = Partial<Omit<AttackPose, never>>;
const FIELDS = ['fwd', 'pitch', 'yaw', 'roll', 'headPitch', 'headYaw', 'mand', 'gaster', 'sting', 'up', 'side', 'px', 'spread', 'front', 'gYaw'] as const;
const NEUTRAL: AttackPose = neutralPose({} as AttackPose);
const tmpA = {} as AttackPose;
const tmpB = {} as AttackPose;
function keyPose(k: Key, side: number, out: AttackPose): AttackPose {
  for (const f of FIELDS) out[f] = k[f] ?? NEUTRAL[f];
  // keys are written for side +1: yaw, roll, head yaw, sideways shift and gaster yaw mirror
  out.yaw *= side;
  out.roll *= side;
  out.headYaw *= side;
  out.side *= side;
  out.gYaw *= side;
  return out;
}
function mixPose(a: AttackPose, b: AttackPose, t: number, out: AttackPose): AttackPose {
  for (const f of FIELDS) out[f] = a[f] + (b[f] - a[f]) * t;
  return out;
}
/** blend key a → key b by t into out */
function blend(a: Key, b: Key, t: number, side: number, out: AttackPose): AttackPose {
  keyPose(a, side, tmpA);
  keyPose(b, side, tmpB);
  return mixPose(tmpA, tmpB, t, out);
}

// beats (fractions of the attack cycle): the wind-up builds to WIND, holds (a tremble of tension) to STRIKE,
// strikes to the contact, and recovers
const WIND = 0.5;
const STRIKE = 0.62;

// ---- key poses (side +1; body lengths and radians)
const LUNGE_W: Key = { fwd: -0.09, up: -0.03, pitch: 0.13, headPitch: 0.3, mand: 1, gaster: 0.35, spread: 0.25 };
const LUNGE_S: Key = { fwd: 0.13, up: -0.02, pitch: -0.11, px: 0.25, headPitch: -0.34, mand: 0, gaster: 0.1, spread: 0.25 };
const CLAMP_W: Key = { yaw: 0.34, side: 0.035, roll: 0.07, headYaw: 0.5, headPitch: 0.12, mand: 1, fwd: -0.03, spread: 0.25 };
const CLAMP_S: Key = { yaw: -0.14, headYaw: -0.22, fwd: 0.08, headPitch: -0.16, mand: 0, spread: 0.25 };
const CLAMP_T: Key = { yaw: -0.08, fwd: -0.13, pitch: 0.07, headPitch: -0.06, mand: 0.04, spread: 0.4 };
/**
 * Fire ant stinging, after the reference footage (user rating B2): from the flagging stance — legs wide, body
 * raised, gaster up with the sting out — the gaster cocks back, then whips down and forward under the body while
 * the ant rears on its hind legs, head up and jaws agape; it holds the jab a moment, the gaster pumping, and swings
 * back up to the flag.
 */
const FLAG: Key = { up: 0.06, spread: 0.6, gaster: 1.15, sting: 0.75, headPitch: -0.12, mand: 0.6 };
const COCK: Key = { up: 0.045, spread: 0.6, pitch: 0.05, px: -0.2, gaster: 1.45, sting: 0.9, headPitch: -0.05, mand: 0.9 };
const WHIP: Key = { up: 0.12, spread: 0.6, pitch: 0.17, px: -0.3, fwd: 0.03, gaster: -2.7, sting: 1, headPitch: 0.15, mand: 1, front: 0.55 };
/**
 * Formicines (Lasius, Formica; rollout batch 1): biting first, then bending the gaster forward between the legs to
 * spray formic acid from the acidopore at the enemy in front — the body raised on its legs and tipped nose-up so the
 * gaster tip points forward under the head; a quick pump of the gaster is the spray.
 */
const ACID_W: Key = { up: 0.06, pitch: 0.07, px: -0.3, fwd: -0.03, gaster: -2.15, headPitch: 0.12, mand: 0.9, spread: 0.35 };
const ACID_S: Key = { up: 0.07, pitch: 0.09, px: -0.3, fwd: 0.02, gaster: -2.5, headPitch: 0.18, mand: 1, spread: 0.35 };
const COCK_Q: Key = { up: 0.03, spread: 0.4, pitch: 0.03, px: -0.2, gaster: 1.3, sting: 0.8, mand: 0.8 };
const WHIP_Q: Key = { up: 0.09, spread: 0.4, pitch: 0.12, px: -0.3, fwd: 0.03, gaster: -2.4, sting: 1, headPitch: 0.1, mand: 1, front: 0.4 };
const CRUSH_W: Key = { fwd: -0.05, up: -0.06, headPitch: -0.22, mand: 1, gaster: 0.15, spread: 0.4 };
const CRUSH_S: Key = { fwd: 0.1, up: -0.07, pitch: -0.08, px: 0.3, headPitch: -0.42, mand: 0, spread: 0.4 };
// (user rating B6, "glitchy": a smaller, slower sweep of the great head, with a follow-through)
const SWING_W: Key = { yaw: 0.2, headYaw: 0.42, headPitch: -0.12, roll: 0.04, mand: 0.85, up: -0.03, spread: 0.32 };
const SWING_S: Key = { yaw: -0.16, headYaw: -0.32, roll: -0.06, fwd: 0.05, headPitch: -0.2, mand: 0.15, up: -0.03, spread: 0.32 };
const SWING_F: Key = { yaw: -0.2, headYaw: -0.4, roll: -0.05, fwd: 0.03, headPitch: -0.16, mand: 0.25, up: -0.03, spread: 0.32 };

/**
 * Pose of a planted-feet attack at phase q. `holdIn` / `holdOut`: this sting continues a grip held from the
 * last cycle / into the next one (the pivoting sting series), so it starts / ends on the grip, not neutral.
 */
export function attackPoseV2(variant: number, q: number, side: number, out: AttackPose, holdIn = false, holdOut = false): AttackPose {
  const C = ATTACK_CONTACT;
  const u = sm(q / WIND);
  const s = strikeEase((q - STRIKE) / (C - STRIKE));
  const tremble = q > WIND && q < STRIKE ? Math.sin(q * 160) * 0.5 : 0;
  switch (variant) {
    case ATK.LUNGE: {
      // crouch back on bent legs, head up, jaws agape → surge forward and down onto the target, snap → worry
      // it with a short tug and a shake of the head → settle
      if (q < STRIKE) blend({}, LUNGE_W, u, side, out);
      else if (q < C) blend(LUNGE_W, LUNGE_S, s, side, out);
      else {
        const k = (q - C) / (1 - C);
        blend(LUNGE_S, {}, sm((k - 0.35) / 0.65), side, out);
        const tug = Math.sin(Math.PI * Math.min(1, k / 0.45));
        out.fwd -= 0.05 * tug;
        out.headYaw += 0.14 * Math.sin(k * 22) * tug;
      }
      out.headYaw += 0.04 * tremble;
      return out;
    }
    case ATK.CLAMP: {
      // twist over the planted feet to one side, head turned further → swing across and clamp → brace wide and
      // haul back (a tug of war), the legs straining → settle
      if (q < STRIKE) blend({}, CLAMP_W, u, side, out);
      else if (q < C) blend(CLAMP_W, CLAMP_S, s, side, out);
      else {
        const k = (q - C) / (1 - C);
        if (k < 0.5) blend(CLAMP_S, CLAMP_T, sm(k / 0.5), side, out);
        else blend(CLAMP_T, {}, sm((k - 0.5) / 0.5), side, out);
        out.headYaw += 0.05 * Math.sin(k * 30) * (1 - k);
      }
      out.headPitch += 0.03 * tremble;
      return out;
    }
    case ATK.PIVOT_STING: {
      // the sting series: up into the flag (or holding it from the last sting) → cock the gaster back → whip it
      // under and forward, rearing → hold, pumping → back up to the flag (or down to rest after the last)
      const sw = strikeEase((q - 0.6) / (C - 0.6));
      if (q < 0.3) blend(holdIn ? FLAG : {}, FLAG, holdIn ? 1 : sm(q / 0.3), side, out);
      else if (q < 0.6) blend(FLAG, COCK, sm((q - 0.3) / 0.25), side, out);
      else if (q < C) blend(COCK, WHIP, sw, side, out);
      else {
        const k = (q - C) / (1 - C);
        blend(WHIP, holdOut ? FLAG : {}, sm((k - 0.3) / 0.7), side, out);
        out.gaster -= 0.14 * Math.sin(k * 26) * Math.max(0, 1 - k * 3);
      }
      if (q > 0.5 && q < 0.6) out.gaster += 0.05 * Math.sin(q * 160);
      return out;
    }
    case ATK.QUICK_STING: {
      // one sting from rest: the gaster up and cocked, a whip under, back down
      const sw = strikeEase((q - 0.6) / (C - 0.6));
      if (q < 0.6) blend({}, COCK_Q, sm((q - 0.15) / 0.4), side, out);
      else if (q < C) blend(COCK_Q, WHIP_Q, sw, side, out);
      else blend(WHIP_Q, {}, sm(((q - C) / (1 - C) - 0.2) / 0.8), side, out);
      return out;
    }
    case ATK.ACID: {
      // curl the gaster forward under the body, rising nose-up → a sharp pump forward (the spray) → hold, the gaster
      // twitching as it empties → settle
      if (q < 0.6) blend({}, ACID_W, sm(q / 0.5), side, out);
      else if (q < C) blend(ACID_W, ACID_S, strikeEase((q - 0.6) / (C - 0.6)), side, out);
      else {
        const k = (q - C) / (1 - C);
        blend(ACID_S, {}, sm((k - 0.35) / 0.65), side, out);
        out.gaster -= 0.1 * Math.sin(k * 30) * Math.max(0, 1 - k * 3);
      }
      return out;
    }
    case ATK.CRUSH: {
      // the major's crushing bite: sink into a low, wide brace, head lowered, the jaws opening slowly → surge and
      // crunch, feet planted → a shudder as the jaws bear down → settle
      if (q < STRIKE) blend({}, CRUSH_W, sm(q / STRIKE), side, out);
      else if (q < C) blend(CRUSH_W, CRUSH_S, s, side, out);
      else {
        const k = (q - C) / (1 - C);
        blend(CRUSH_S, {}, sm((k - 0.4) / 0.6), side, out);
        out.headPitch += 0.05 * Math.sin(k * 40) * Math.max(0, 1 - k * 2);
        out.up -= 0.008 * Math.sin(k * 40) * Math.max(0, 1 - k * 2);
      }
      out.mand = q < STRIKE ? sm(q / STRIKE) : out.mand;
      return out;
    }
    case ATK.HEAD_SWING: {
      // the major swings its great head sideways into the target, body twisting over braced legs; the head is heavy:
      // a slower sweep (0.52 → contact) that carries on a little past the hit before it settles
      if (q < 0.52) blend({}, SWING_W, sm(q / 0.45), side, out);
      else if (q < C) blend(SWING_W, SWING_S, sm((q - 0.52) / (C - 0.52)), side, out);
      else {
        const k = (q - C) / (1 - C);
        if (k < 0.3) blend(SWING_S, SWING_F, sm(k / 0.3), side, out);
        else blend(SWING_F, {}, sm((k - 0.3) / 0.7), side, out);
      }
      return out;
    }
    default:
      // the old rear-up chomp (not used by the planted-feet species), with the fore legs lifted
      attackPose(variant, q, side, out, true);
      out.front = Math.max(0, out.pitch) / 0.38;
      out.px = -0.3;
      return out;
  }
}
