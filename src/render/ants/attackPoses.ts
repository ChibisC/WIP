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
export const ATK = { LUNGE: 0, REAR: 1, CLAMP: 2, PIVOT_STING: 3, QUICK_STING: 4, CRUSH: 5, HEAD_SWING: 6, ACID: 7, TAUNT: 8, RAGE: 9, SNAP: 10, IMPALE: 11, CHOMP: 12, SLAM: 13, EXECUTE: 14, EXECUTE_P: 15, LIFT: 16, T_TUG: 17, T_RIP: 18, T_LUNGE: 19, T_JAB: 20, T_CRUSH: 21, T_DOZE: 22, T_TOSS: 23, DRUM: 24, GLUE: 25, S_GRAB: 26, S_HOLD: 27, S_SQUIRT: 28 } as const;

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
 * The leafcutter major's taunt (user 2026-10-31, after EotU; the real Atta threat display): it rears on its hind and
 * middle legs, the fore legs lifted, head thrown up and the great jaws gaping, and stridulates — the gaster pumping
 * up and down fast (the rasp between the postpetiole and the gaster) — the jaws snapping, then settles.
 */
// (user rating A7: the fore legs twitched — held fully up and still, the body no longer bobbing under them)
const TAUNT_K: Key = { up: 0.08, pitch: 0.24, px: -0.32, front: 1, headPitch: 0.42, mand: 1, gaster: 0.55, spread: 0.5 };
/**
 * An army-ant soldier's rage (user 2026-10-31, after EotU): a frenzy at each kill — the sickles snapping open and
 * shut three times, the head tossing side to side, the body jolting forward over braced legs.
 */
const RAGE_K: Key = { up: 0.03, fwd: 0.02, pitch: 0.06, headPitch: 0.2, mand: 1, gaster: 0.3, spread: 0.45 };
/**
 * Hell ants (realism rework, CHANGE_PLAN §22.2): the vertical trap. The jaws cock wide and down, the head low over the
 * prey and trembling with tension; the snap is near-instant (the last 2.5 % of the wind-up), the head jerking up with
 * the recoil; a hit-stop holds the contact a moment; then the prey is lifted against the horn (worker, queen) or the
 * paddle driven down and pulled free (the soldier's impale). Never a sideways swing of the jaws or the head.
 */
// (the clips: with the head lowered the cocked scythes swung into the ground — the head and front rise as the jaws
// cock, so the open jaws sweep just above the ground in front of the prey, and the snap lifts it)
const SNAP_W: Key = { fwd: 0.02, up: 0.03, pitch: 0.1, px: -0.25, headPitch: 0.32, mand: 0.85, gaster: 0.15, spread: 0.3 };
const SNAP_S: Key = { fwd: -0.02, up: 0.035, pitch: 0.13, px: -0.25, headPitch: 0.52, mand: 0, gaster: 0.05, spread: 0.3 };
const SNAP_L: Key = { fwd: -0.04, up: 0.04, pitch: 0.12, px: -0.25, headPitch: 0.44, mand: 0, spread: 0.25 };
const IMPALE_W: Key = { fwd: -0.06, up: 0.06, pitch: 0.22, px: -0.3, headPitch: 0.45, mand: 0.85, gaster: 0.3, spread: 0.4, front: 0.35 };
const IMPALE_S: Key = { fwd: 0.11, up: 0.0, pitch: -0.02, px: 0.25, headPitch: 0.02, mand: 0, gaster: 0.1, spread: 0.4 };
const IMPALE_L: Key = { fwd: -0.03, up: 0.04, pitch: 0.1, headPitch: 0.3, mand: 0.1, spread: 0.3 };
/** fraction of the attack cycle the hell ants' snap freezes on the contact */
export const HIT_STOP = 0.07;
/**
 * Hell ants, user rating 2026-11-02 (H8–H10: "open up more", "open and close when attacking", "3 attack animations, the
 * impale its own finisher"): the chomp — a lunge, the scythes opening and closing on the foe as it goes in — and the
 * slam — rearing on the hind legs with the jaws wide, crashing down and snapping. The finisher (a foe at a quarter of
 * its health): the jaws gape and reach round the neck, a tremble, the snap, and the head torn up and back; the soldier
 * first drives its paddle down onto the foe and holds it.
 */
const CHOMP_W: Key = { fwd: -0.05, up: 0.03, pitch: 0.08, px: -0.25, headPitch: 0.3, mand: 1, gaster: 0.15, spread: 0.3 };
const CHOMP_S: Key = { fwd: 0.11, up: 0.02, pitch: 0.02, px: 0.25, headPitch: 0.18, mand: 0, spread: 0.3 };
const SLAM_W: Key = { fwd: -0.07, up: 0.07, pitch: 0.24, px: -0.3, headPitch: 0.45, mand: 1, gaster: 0.3, spread: 0.45, front: 0.5 };
const SLAM_S: Key = { fwd: 0.1, up: 0.0, pitch: -0.02, px: 0.25, headPitch: 0.22, mand: 0, spread: 0.45 };
const EXEC_W: Key = { fwd: 0.09, up: 0.02, pitch: -0.03, px: 0.25, headPitch: 0.12, mand: 1, gaster: 0.1, spread: 0.35 };
const EXEC_S: Key = { fwd: 0.09, up: 0.02, pitch: -0.03, px: 0.25, headPitch: 0.12, mand: 0, spread: 0.35 };
const EXEC_T: Key = { fwd: -0.04, up: 0.05, pitch: 0.13, px: -0.2, headPitch: 0.58, mand: 0, spread: 0.35 };
/**
 * Nasute termites on the ant pipeline (realism round 3, CHANGE_PLAN §22.7; the user's ratings G7, T1, T4: "dynamic and
 * dramatic but realistic attacks and movement like the ants but realistic to termites"). Termites have no sting and no
 * waist: they fight with the jaws, the head and their weight — workers bite and hang on, wrench and tear, soldiers
 * squirt glue from the nasus and jab with it, majors bulldoze, crush and toss. The feet stay planted (the leg IK).
 *  - T_TUG: lunge and clamp, then haul back twice on braced legs, the body low, the head wrenching side to side.
 *  - T_RIP: clamp, then twist the head hard one way and the other with the whole body rolling into it (tearing).
 *  - T_LUNGE: a quick reared snap, the body thrown forward over the front legs.
 *  - T_JAB (soldier): head down, a fast double peck with the nasus.
 *  - T_CRUSH (major): rear the front up, the heavy head raised, then crash down onto the foe, a hit-stop.
 *  - T_DOZE (major): head low, drive forward hard twice like a bulldozer, the hind legs pushing.
 *  - T_TOSS (major): scoop the head under the foe and flick it up and to the side.
 *  - DRUM (major, the alarm): the body still on planted feet, the head hammering down on the ground and back.
 *  - GLUE (soldier firing): braced and low, the head aimed (game/antViews.ts), each squirt jolting the body back,
 *    the abdomen pumping and the head jerking; between squirts a small sway of the aim.
 */
const TTUG_W: Key = { fwd: -0.06, up: 0.02, pitch: 0.08, px: -0.2, headPitch: 0.25, mand: 1, gaster: 0.1, spread: 0.35 };
const TTUG_S: Key = { fwd: 0.1, up: -0.02, pitch: -0.07, px: 0.25, headPitch: -0.2, mand: 0, spread: 0.35 };
const TTUG_P: Key = { fwd: -0.1, up: -0.035, pitch: 0.05, px: -0.25, headPitch: -0.32, mand: 0, gaster: -0.1, spread: 0.5 };
const TRIP_S: Key = { fwd: 0.08, up: -0.01, pitch: -0.05, px: 0.25, headPitch: -0.18, mand: 0, spread: 0.4 };
const TRIP_T: Key = { fwd: 0.04, up: -0.015, yaw: 0.22, roll: 0.16, side: 0.02, headYaw: 0.6, headPitch: -0.24, mand: 0, spread: 0.45 };
const TLUN_W: Key = { fwd: -0.08, up: 0.05, pitch: 0.2, px: -0.3, headPitch: 0.4, mand: 1, gaster: 0.15, spread: 0.35, front: 0.25 };
const TLUN_S: Key = { fwd: 0.15, up: -0.02, pitch: -0.12, px: 0.3, headPitch: -0.3, mand: 0, spread: 0.35 };
const TJAB_W: Key = { fwd: -0.05, up: 0.02, pitch: 0.06, headPitch: 0.15, mand: 0.4, spread: 0.35 };
const TJAB_S: Key = { fwd: 0.09, up: -0.02, pitch: -0.08, px: 0.25, headPitch: -0.38, mand: 0.1, spread: 0.35 };
const TCR_W: Key = { fwd: -0.08, up: 0.09, pitch: 0.3, px: -0.32, headPitch: 0.5, mand: 0.8, gaster: 0.2, spread: 0.5, front: 0.6 };
const TCR_S: Key = { fwd: 0.12, up: -0.04, pitch: -0.1, px: 0.3, headPitch: -0.45, mand: 0, spread: 0.55 };
const TDZ_W: Key = { fwd: -0.07, up: -0.03, pitch: -0.04, headPitch: -0.42, mand: 0.5, gaster: 0.1, spread: 0.5 };
const TDZ_S: Key = { fwd: 0.16, up: -0.035, pitch: -0.1, px: 0.3, headPitch: -0.5, mand: 0.2, spread: 0.55 };
const TTS_W: Key = { fwd: 0.04, up: -0.03, pitch: -0.08, px: 0.25, headPitch: -0.55, headYaw: -0.15, mand: 0.6, spread: 0.45 };
const TTS_S: Key = { fwd: 0.02, up: 0.05, pitch: 0.15, px: -0.25, headPitch: 0.55, headYaw: 0.45, yaw: 0.12, roll: -0.08, mand: 0.2, spread: 0.45 };
const DRUM_U: Key = { headPitch: 0.15, spread: 0.4, mand: 0.2 };
const DRUM_D: Key = { headPitch: -0.55, up: -0.004, spread: 0.4, mand: 0.2 };
const GLUE_B: Key = { up: -0.015, pitch: -0.03, headPitch: -0.12, gaster: 0.05, spread: 0.5, mand: 0.1 };
const GLUE_K: Key = { fwd: -0.035, up: -0.01, pitch: 0.03, headPitch: 0.05, gaster: 0.3, spread: 0.5, mand: 0.1 };
/**
 * Sickle-jaw soldiers on the ant pipeline (model redo, claude/realism/10-spec §3; spec 09 §2.2): the grab-and-squirt.
 *  - S_GRAB (q = the sim's lunge, 0..LUNGE_SNAP + 0.16; game/antViews.ts): rear back on planted feet with the head
 *    raised and the sickles flung wide, a short tremble, then the lunge — the body thrown forward over the front legs,
 *    the head dropping — the sickles crossing shut on the victim at the snap (0.58), and settling into the hold pose.
 *  - S_HOLD (q runs with the squirts): braced, the victim at the sickle tips; each squirt the snout presses in (the
 *    head dipping forward and down) and the soft abdomen pumps; the sickles stay crossed.
 *  - S_SQUIRT (a foe too big to hook): planted squarely in front of it, the sickles half open, the head jabbing the
 *    snout's tip against its side on each squirt.
 */
// (the snout hangs forward and down at rest, its tip near the ground: holding, the head is raised so the tip lies on the
// victim's back — the victim's front pinned 1.27 soldier-mm ahead, sim/sickleJaws.ts — and each squirt presses it down)
const SGRAB_W: Key = { fwd: -0.09, up: 0.05, pitch: 0.16, px: -0.3, headPitch: 0.45, mand: 1, gaster: 0.12, spread: 0.45 };
const SGRAB_S: Key = { fwd: 0.15, up: -0.01, pitch: -0.08, px: 0.3, headPitch: 0.06, mand: 0, spread: 0.45 };
const SHOLD_B: Key = { fwd: 0.03, up: 0.01, pitch: -0.02, px: 0.2, headPitch: 0.26, mand: 0, gaster: 0.04, spread: 0.5 };
const SHOLD_P: Key = { fwd: 0.055, up: -0.004, pitch: -0.05, px: 0.25, headPitch: 0.1, mand: 0, gaster: 0.22, spread: 0.5 };
const SSQ_B: Key = { fwd: 0.0, up: 0.0, pitch: -0.02, headPitch: 0.3, mand: 0.55, gaster: 0.04, spread: 0.5 };
const SSQ_J: Key = { fwd: 0.07, up: -0.01, pitch: -0.06, px: 0.25, headPitch: 0.12, mand: 0.45, gaster: 0.2, spread: 0.5 };
/** the sim's lunge: the snap at this fraction, the hold pose reached 0.16 later (render/termite/rig.ts LUNGE_SNAP) */
const S_SNAP = 0.58;
// the finisher's lift (user note 2026-11-02 12:39): the foe held up by the neck — head and front raised, braced on the
// hind legs; the jaws part a little, then shear shut with a toss of the head (the cut)
const LIFT_U: Key = { fwd: 0.0, up: 0.06, pitch: 0.16, px: -0.1, headPitch: 0.6, mand: 0, gaster: -0.1, spread: 0.4 };
const LIFT_O: Key = { fwd: 0.01, up: 0.06, pitch: 0.15, px: -0.1, headPitch: 0.5, mand: 0.4, gaster: -0.1, spread: 0.4 };
const LIFT_C: Key = { fwd: -0.03, up: 0.07, pitch: 0.18, px: -0.15, headPitch: 0.78, mand: 0, gaster: -0.15, spread: 0.4 };
const EXECP_D: Key = { fwd: 0.11, up: 0.0, pitch: -0.02, px: 0.25, headPitch: 0.04, mand: 0.85, gaster: 0.1, spread: 0.4 };

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
    case ATK.CHOMP: {
      // jaws wide, then a lunge on which they open and close two and a half times, shut on the contact; settle
      if (q < WIND) blend({}, CHOMP_W, sm(q / WIND), side, out);
      else if (q < C) {
        const k = (q - WIND) / (C - WIND);
        blend(CHOMP_W, CHOMP_S, sm(k), side, out);
        out.mand = 0.5 + 0.5 * Math.cos(k * Math.PI * 5);
        out.headPitch += 0.1 * Math.sin(k * Math.PI * 5);
      } else blend(CHOMP_S, {}, sm((q - C) / (1 - C)), side, out);
      return out;
    }
    case ATK.SLAM: {
      // rear up on the hind legs, the jaws gaping, a moment's hold — crash down and snap, a hit-stop; settle
      if (q < WIND) blend({}, SLAM_W, sm(q / WIND), side, out);
      else if (q < STRIKE) blend(SLAM_W, SLAM_W, 1, side, out);
      else if (q < C) blend(SLAM_W, SLAM_S, strikeEase((q - STRIKE) / (C - STRIKE)), side, out);
      else if (q < C + HIT_STOP) blend(SLAM_S, SLAM_S, 1, side, out);
      else blend(SLAM_S, {}, sm((q - C - HIT_STOP) / (1 - C - HIT_STOP)), side, out);
      if (q > WIND && q < STRIKE) out.headPitch += 0.015 * Math.sin(q * 180);
      return out;
    }
    case ATK.EXECUTE:
    case ATK.EXECUTE_P: {
      const pad = variant === ATK.EXECUTE_P;
      if (pad) {
        // the soldier: rear (0 → 0.3), drive the paddle down and hold the foe (→ 0.5), the jaws reaching round its neck
        if (q < 0.3) blend({}, IMPALE_W, sm(q / 0.3), side, out);
        else if (q < 0.5) blend(IMPALE_W, EXECP_D, strikeEase((q - 0.3) / 0.2), side, out);
        else if (q < C - 0.02) blend(EXECP_D, EXECP_D, 1, side, out);
        else if (q < C) blend(EXECP_D, EXEC_S, (q - (C - 0.02)) / 0.02, side, out);
      } else {
        // reach in, jaws gaping round the neck (→ 0.45), a tremble (→ the contact), the snap
        if (q < 0.45) blend({}, EXEC_W, sm(q / 0.45), side, out);
        else if (q < C - 0.02) blend(EXEC_W, EXEC_W, 1, side, out);
        else if (q < C) blend(EXEC_W, EXEC_S, (q - (C - 0.02)) / 0.02, side, out);
      }
      if (q >= C) {
        // the head torn up and back (→ 0.84), held a beat, then settle
        const k = (q - C) / (1 - C);
        if (k < 0.4) blend(EXEC_S, EXEC_T, strikeEase(k / 0.4), side, out);
        else if (k < 0.6) blend(EXEC_T, EXEC_T, 1, side, out);
        else blend(EXEC_T, {}, sm((k - 0.6) / 0.4), side, out);
      } else if (q > (pad ? 0.5 : 0.45)) {
        out.headPitch += 0.012 * Math.sin(q * 200);
        out.mand = Math.min(1, out.mand + 0.03 * Math.sin(q * 240));
      }
      return out;
    }
    case ATK.T_TUG: {
      // lunge and clamp (→ the contact), then two hard hauls back, the head wrenching
      if (q < WIND) blend({}, TTUG_W, sm(q / WIND), side, out);
      else if (q < C) blend(TTUG_W, TTUG_S, strikeEase((q - WIND) / (C - WIND)), side, out);
      else {
        const k = (q - C) / (1 - C);
        const haul = Math.sin(Math.PI * Math.min(1, k * 2)) ** 2;
        blend(TTUG_S, TTUG_P, haul, side, out);
        out.headYaw += 0.3 * side * Math.sin(k * Math.PI * 4) * (1 - k);
        if (k > 0.5) mixPose(out, NEUTRAL, sm((k - 0.5) / 0.5), out);
      }
      return out;
    }
    case ATK.T_RIP: {
      if (q < WIND) blend({}, TTUG_W, sm(q / WIND), side, out);
      else if (q < C) blend(TTUG_W, TRIP_S, strikeEase((q - WIND) / (C - WIND)), side, out);
      else {
        // the twist: one way hard, back the other way, then let go
        const k = (q - C) / (1 - C);
        const tw = Math.sin(k * Math.PI * 2.4) * (1 - sm((k - 0.6) / 0.4));
        blend(TRIP_S, TRIP_T, Math.abs(tw), tw >= 0 ? side : -side, out);
        if (k > 0.75) mixPose(out, NEUTRAL, sm((k - 0.75) / 0.25), out);
      }
      return out;
    }
    case ATK.T_LUNGE:
    case ATK.T_JAB:
    case ATK.T_CRUSH: {
      const W = variant === ATK.T_LUNGE ? TLUN_W : variant === ATK.T_JAB ? TJAB_W : TCR_W;
      const K = variant === ATK.T_LUNGE ? TLUN_S : variant === ATK.T_JAB ? TJAB_S : TCR_S;
      if (variant === ATK.T_JAB) {
        // two fast pecks: the first at 0.4, the second on the contact
        const p = (x: number) => Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, x))));
        const j = q < 0.4 ? p((q - 0.25) / 0.15) : p((q - (C - 0.12)) / 0.24);
        blend(W, K, j, side, out);
        if (q < 0.2) blend({}, W, sm(q / 0.2), side, out);
        else if (q > 0.88) mixPose(out, NEUTRAL, sm((q - 0.88) / 0.12), out);
        return out;
      }
      if (q < WIND) blend({}, W, sm(q / WIND), side, out);
      else if (q < STRIKE) blend(W, W, 1, side, out);
      else if (q < C) blend(W, K, strikeEase((q - STRIKE) / (C - STRIKE)), side, out);
      else if (variant === ATK.T_CRUSH && q < C + HIT_STOP) blend(K, K, 1, side, out);
      else blend(K, {}, sm((q - C - (variant === ATK.T_CRUSH ? HIT_STOP : 0)) / (1 - C)), side, out);
      if (q > WIND && q < STRIKE) out.headPitch += 0.015 * Math.sin(q * 170);
      return out;
    }
    case ATK.T_DOZE: {
      // head low, two hard shoves forward, the hind legs pushing
      if (q < 0.25) blend({}, TDZ_W, sm(q / 0.25), side, out);
      else {
        const k = (q - 0.25) / 0.75;
        const shove = Math.max(0, Math.sin(Math.PI * ((k * 2) % 1))) ** 1.5;
        blend(TDZ_W, TDZ_S, shove, side, out);
        if (k > 0.85) mixPose(out, NEUTRAL, sm((k - 0.85) / 0.15), out);
      }
      return out;
    }
    case ATK.T_TOSS: {
      if (q < WIND) blend({}, TTS_W, sm(q / WIND), side, out);
      else if (q < C) blend(TTS_W, TTS_S, strikeEase((q - WIND) / (C - WIND)), side, out);
      else blend(TTS_S, {}, sm((q - C) / (1 - C)), side, out);
      return out;
    }
    case ATK.DRUM: {
      // a sharp blow down, a quick rebound (the soldier drumming the alarm on the gallery floor)
      const d = q < 0.35 ? strikeEase(q / 0.35) : 1 - sm((q - 0.35) / 0.65);
      blend(DRUM_U, DRUM_D, d, side, out);
      return out;
    }
    case ATK.GLUE: {
      // q runs with the squirts; between them the aim sways a little
      const kick = q < 0.12 ? strikeEase(q / 0.12) : Math.exp(-(q - 0.12) * 9);
      blend(GLUE_B, GLUE_K, kick, side, out);
      out.headYaw += 0.06 * Math.sin(q * Math.PI * 2) * (1 - kick);
      out.headPitch += -0.06 * kick;
      return out;
    }
    case ATK.S_GRAB: {
      // rear and gape (→ 0.42), the tremble (→ 0.5), the lunge with the sickles snapping shut on the snap, settle into the hold
      if (q < 0.42) blend({}, SGRAB_W, sm(q / 0.42), side, out);
      else if (q < 0.5) {
        blend(SGRAB_W, SGRAB_W, 1, side, out);
        out.headPitch += 0.02 * Math.sin(q * 190);
      } else if (q < S_SNAP) {
        blend(SGRAB_W, SGRAB_S, strikeEase((q - 0.5) / (S_SNAP - 0.5)), side, out);
        out.mand = 1 - sm((q - (S_SNAP - 0.03)) / 0.03);
      } else blend(SGRAB_S, SHOLD_B, sm(Math.min(1, (q - S_SNAP) / 0.16)), side, out);
      return out;
    }
    case ATK.S_HOLD: {
      // each squirt: a quick press of the snout (→ 0.18), easing back; a small shake of the victim between
      const p = q < 0.18 ? strikeEase(q / 0.18) : Math.exp(-(q - 0.18) * 6);
      blend(SHOLD_B, SHOLD_P, p, side, out);
      out.headYaw += 0.05 * Math.sin(q * Math.PI * 4) * (1 - p);
      return out;
    }
    case ATK.S_SQUIRT: {
      const p = q < 0.15 ? strikeEase(q / 0.15) : Math.exp(-(q - 0.15) * 7);
      blend(SSQ_B, SSQ_J, p, side, out);
      out.headYaw += 0.06 * Math.sin(q * Math.PI * 2) * (1 - p);
      return out;
    }
    case ATK.LIFT: {
      // q 0..0.95 over the sim's hold (game/antViews.ts): lift (→ 0.3), hold and shake the foe (→ 0.82), the jaws
      // part (→ 0.9), the shear (→ 0.93: the head comes off when the hold ends, at 0.95)
      if (q < 0.3) blend(EXEC_S, LIFT_U, sm(q / 0.3), side, out);
      else if (q < 0.82) {
        blend(LIFT_U, LIFT_U, 1, side, out);
        const e = sm((q - 0.3) / 0.15) * (1 - sm((q - 0.72) / 0.1));
        out.headYaw += 0.16 * e * Math.sin(q * 70);
        out.yaw += 0.04 * e * Math.sin(q * 70 + 0.6);
        out.roll += 0.03 * e * Math.sin(q * 70 + 1.2);
      } else if (q < 0.9) blend(LIFT_U, LIFT_O, sm((q - 0.82) / 0.08), side, out);
      else if (q < 0.93) blend(LIFT_O, LIFT_C, (q - 0.9) / 0.03, side, out);
      else blend(LIFT_C, LIFT_C, 1, side, out);
      return out;
    }
    case ATK.SNAP:
    case ATK.IMPALE: {
      const imp = variant === ATK.IMPALE;
      const W = imp ? IMPALE_W : SNAP_W;
      const K = imp ? IMPALE_S : SNAP_S;
      const Lf = imp ? IMPALE_L : SNAP_L;
      const fast = C - (imp ? 0.05 : 0.025);
      if (q < fast) blend({}, W, sm(q / WIND), side, out);
      else if (q < C) blend(W, K, imp ? strikeEase((q - fast) / (C - fast)) : (q - fast) / (C - fast), side, out);
      else if (q < C + HIT_STOP) blend(K, K, 1, side, out);
      else {
        const k = (q - C - HIT_STOP) / (1 - C - HIT_STOP);
        if (k < 0.45) blend(K, Lf, sm(k / 0.45), side, out);
        else blend(Lf, {}, sm((k - 0.45) / 0.55), side, out);
      }
      // the tension before the trap fires: a fine tremble of the head and the cocked jaws
      if (q > WIND && q < fast) {
        out.headPitch += 0.012 * Math.sin(q * 190);
        out.mand = Math.min(1, out.mand + 0.03 * Math.sin(q * 230));
      }
      return out;
    }
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
    case ATK.TAUNT: {
      // rise into the display (0 → 0.2), hold it stridulating with the jaws snapping (→ 0.82), settle
      const k = q < 0.2 ? sm(q / 0.2) : q < 0.82 ? 1 : 1 - sm((q - 0.82) / 0.18);
      blend({}, TAUNT_K, k, side, out);
      const hold = q > 0.16 && q < 0.86 ? 1 : 0;
      out.gaster += 0.24 * Math.sin(q * 70) * hold * k;
      out.mand = Math.max(0, out.mand - 0.4 * Math.max(0, Math.sin(q * 28)) * hold);
      out.headYaw += 0.1 * Math.sin(q * 9) * hold * k;
      return out;
    }
    case ATK.RAGE: {
      // three snaps of the sickles with a toss of the head each way, the body jolting, then settle
      const k = q < 0.12 ? sm(q / 0.12) : q < 0.85 ? 1 : 1 - sm((q - 0.85) / 0.15);
      blend({}, RAGE_K, k, side, out);
      const snap = Math.max(0, Math.sin(q * Math.PI * 6));
      out.mand = k * (1 - 0.95 * snap);
      out.headYaw += 0.4 * Math.sin(q * Math.PI * 3) * k;
      out.headPitch -= 0.18 * snap * k;
      out.fwd += 0.03 * snap * k;
      out.roll += 0.05 * Math.sin(q * Math.PI * 3) * k;
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

/**
 * The finisher's foe (user note 2026-11-02 12:39), held up by the neck in the hell ant's jaws, facing it: `k` 0..1
 * through the hold. Its head is lifted to the raised jaws (about a third of the hell ant's length up), the body hanging
 * nose-up behind, the gaster just clear of the ground (a foe much longer than the hell ant is held lower at the head);
 * kicking and twisting, weaker as the hold goes on. Lift in mm (body lengths × mm), angles in rad.
 */
export function execHeld(k: number, Lh: number, Lv: number, t: number, seed: number, out: { lift: number; pitch: number; roll: number; headYaw: number }): void {
  const up = sm(k / 0.3);
  const Hj = 0.36 * Lh;
  // (a foe much bigger than the hell ant still comes up nose-high: at least 0.45 rad, its gaster just clear)
  const sinT = Math.min(Math.sin(0.9), Math.max(Math.sin(0.45), (Hj - 0.05 * Lv) / (0.9 * Lv)));
  out.pitch = Math.asin(sinT) * up;
  out.lift = Math.max(0, Hj - 0.22 * Lv - 0.4 * Lv * sinT, 0.5 * Lv * sinT - 0.19 * Lv) * up;
  const e = (1 - 0.5 * k) * (0.4 + 0.6 * up);
  out.roll = (0.3 * Math.sin(t * 17 + seed * 9) + 0.12 * Math.sin(t * 29 + seed * 3)) * e;
  out.headYaw = 0.25 * Math.sin(t * 13 + seed * 5) * e;
}
