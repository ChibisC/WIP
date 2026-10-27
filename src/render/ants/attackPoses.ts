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
}

export function neutralPose(out: AttackPose): AttackPose {
  out.fwd = out.pitch = out.yaw = out.roll = out.headPitch = out.headYaw = out.gaster = out.sting = 0;
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
  out.gaster = q < C ? -1.75 * curl - 0.75 * jab : -2.5 * back;
  out.sting = q < C ? 0.4 * curl + 0.6 * jab : back;
  // pivoting round the grip: the body swings well to one side (it reads from above) and tips forward onto
  // the grip, lifting the hind end so the curled gaster clears the ground
  out.yaw = (0.38 * curl + 0.1 * jab) * side * (q < C ? 1 : back);
  out.headYaw = -0.3 * side * curl * (q < C ? 1 : back);
  out.pitch = q < C ? -0.1 * curl - 0.06 * jab : -0.16 * back;
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
