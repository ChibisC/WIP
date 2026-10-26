/**
 * Shared constants between the geometry builder, the vertex/fragment shaders and game code.
 * Numbers here are injected into the GLSL as #defines (see shaders.ts) so they cannot drift.
 *
 * Shared termite base v2: Nasute Termites (Nasutitermes corniger) + Sickle-Jaw Termites
 * (Rhynchotermes perarmatus). Everything added for v2 is appended (new ids, new rig-texture columns,
 * new rows), so v1 (nasute-only) values and renders are unchanged.
 */

/** Bone ids baked into the `aBone` vertex attribute. */
export const Bone = {
  BODY: 0, // thorax + wing scales; everything follows it
  HEAD: 1, // head capsule, nasus, eyes, ocelli, head setae, labrum
  MAND_L: 2,
  MAND_R: 3,
  ANT_L: 4,
  ANT_R: 5,
  ABDOMEN: 6, // abdomen + its setae
  LEG0: 7, // 7 + leg*4 + joint ; leg 0..5 = L1 L2 L3 R1 R2 R3 ; joint 0 coxa,1 femur,2 tibia,3 tarsus
  CARRY: 31, // item held in the mandibles (wood fragment / egg / leaf fragment), shown by aLook.y
  EGG_LAY: 32, // queen: egg emerging from the abdomen tip
  COUNT: 33,
} as const;

export const legBone = (leg: number, joint: number) => Bone.LEG0 + leg * 4 + joint;
/** 0 L1 (front-left), 1 L2, 2 L3 (hind-left), 3 R1, 4 R2, 5 R3 */
export const legSide = (leg: number) => (leg < 3 ? -1 : 1); // -1 = left (-Z), +1 = right (+Z)

/** Material classes baked into `aMat`. */
export const Mat = {
  HARD: 0, // sclerotised cuticle (soldier head capsule, royals)
  SOFT: 1, // soft translucent cuticle (bodies, legs, larvae)
  MEMBRANE: 2, // queen's stretched intersegmental membrane
  EYE: 3,
  OCELLUS: 4,
  SETA: 5,
  WOOD: 6,
  EGG: 7,
  MANDIBLE: 8,
  NASUS: 9, // soldier head capsule + nasus (glossy, clearcoat)
  SICKLE: 10, // v2: long glossy sickle mandibles (Rhynchotermes soldier)
  LEAF: 11, // v2: carried leaf-litter fragment
  MEMBRANE_LO: 12, // v2.1: queen abdomen at LOD1/2 (crease relief drawn procedurally instead of in the mesh)
} as const;

/** Animation states (aAnim.x). */
export const AnimState = {
  IDLE: 0,
  WALK: 1, // tripod gait; rate = gaitRateForSpeed()
  CHEW: 2, // rate = bites per second (balance: 1 / biteIntervalSec)
  GROOM: 3, // allogrooming / trophallaxis
  DIG: 4,
  FIRE: 5, // nasute: aAnim2 = (rampFraction, aimYaw, aimPitch, firing 0/1)
  CHARGE: 6, // major: head-down fast gait (rate from speed)
  RAM: 7, // major: lunging jab (rate ~2/s)
  ALARM: 8, // soldiers: vertical head jerking / drumming (~6 Hz)
  BITE: 9, // worker last resort / king (rate ~3/s)
  DEATH: 10, // aAnim.w 0..1 over ~1.2 s; stays at 1 for the corpse
  WRIGGLE: 11, // larva on a brood tile
  SETTLE: 12, // maturation: aAnim.w 0..1 over ~0.6 s
  QUEEN: 13, // queen idle + peristalsis; aAnim.w = egg-lay progress 0..1
  // ---- v2 (Sickle-Jaw Termites) ----
  LUNGE: 14, // sickle soldier: gape -> lunge -> snap shut; aAnim.w 0..1 over LUNGE_SEC; ends in the HOLD pose
  HOLD: 15, // sickle soldier grab-and-squirt: aAnim2 = (rampFraction, aimYaw offset, aimPitch offset, squirting 0/1)
  THREAT: 16, // sickle soldier "mute roar": rises on its legs, head up, mandibles gaping
  RUSH: 17, // sickle soldier alarm response: fast gait with mandibles open (rate from speed)
  STRUGGLE: 18, // a termite held by an enemy soldier: legs flail, body twists; aAnim2.x = intensity 0..1
  // ---- v2.1 (royals) ----
  ATTEND: 19, // king (or worker) beside the queen: antennae constantly touching her, occasional grooming bob
} as const;
export type AnimStateId = (typeof AnimState)[keyof typeof AnimState];

export const Carry = { NONE: 0, WOOD: 1, EGG: 2, LEAF: 3 } as const;

/** Head aim limits (radians), shared by shader and nasusTipLocal(). */
export const AIM = { yawLimit: 0.9, pitchMin: -0.5, pitchMax: 0.6, pitchBias: 0.12 };
/** Default head rest pitch (radians, nose up). Per caste: CasteParams.headRest -> RigCol.POSE.x */
export const HEAD_REST_PITCH = 0.06;
/** Gait duty factor. */
export const GAIT_DUTY = 0.55;

/**
 * Grab-and-squirt pose constants (Sickle-Jaw soldier), shared by the shader and the CPU mirrors in
 * material.ts (mandibleSocketLocal, holdNasusTipLocal). Change them only here.
 */
export const HOLD = {
  /** head pitch relative to rest while holding (rad, negative = nose down); per-victim fine aim: holdAimOffset() */
  headPitch: -0.2,
  /** extra nose-down per unit of squirt recoil (rad) */
  recoilPitch: -0.04,
  /** body lowered by this fraction of body height */
  crouch: 0.04,
  /** body pitch (rad, + = front raised: the soldier lifts the victim a little) */
  bodyPitch: 0.03,
  /** mandible opening while gripping (rad): tips still crossed around the victim's limb */
  grip: 0.07,
  /** tug amplitudes: head yaw (rad), head pitch (rad), head push (fraction of body length) */
  tugYaw: 0.1,
  tugPitch: 0.05,
  tugPush: 0.012,
  /** body sway that follows the tug (rad) */
  tugBody: 0.04,
};
/** LUNGE duration in seconds (aAnim.w runs 0 -> 1 over this) */
export const LUNGE_SEC = 0.55;
/** LUNGE: mandibles snap shut at this fraction of the lunge (the moment the sim's grab happens) */
export const LUNGE_SNAP = 0.58;

/** Columns of the shared rig texture (one row per caste, RGBA32F). */
export const RigCol = {
  PIVOT: 0, // 33 columns
  LEGDIR: 33, // 6
  ANTBASE: 39, // 2
  ANTDIR: 41, // 2
  ABD_A: 43,
  ABD_B: 44,
  RIG_A: 45, // bodyLength, gaitAmp, isQueen, isLarva
  RIG_B: 46, // bodyHeight, gaitLift, antennaLength, glueThickness
  SKIN: 47, // translucency, gut, headCoat, kind (0 worker/round, 1 soldier/pear, 2 royal, 3 larva)
  HEAD0: 48, // head centre xyz, half length
  HEAD1: 49, // half width, half height, suture flag, fontanelle radius (fraction of head half-width; 0 = none)
  TERGITE: 50,
  INTER: 51,
  GUT: 52,
  HEADRIM: 53,
  SUTURE: 54,
  ABD_INFO: 55, // abdomen front x, length, half width, half height
  // ---- v2 ----
  POSE: 56, // headRest pitch, mandible rest opening, mandible max gape, sickle flag (1 = long sickle mandibles)
  MANDAX: 57, // mandible hinge axis xyz (rest space; +angle opens), nasus droop flag
  NASUSBASE: 58, // rgb colour at the base of the nasus (darker band), w = nasus start (0..1 of head lathe)
  // ---- v2.1: physogastric queen abdomen ----
  QUEEN0: 59, // default age (0 ivory .. 1 honey), plate half-angle front, plate half-angle rear, pleat depth
  QIVORY: 60, // rgb young-queen colour
  QAMBER: 61, // rgb mid-age colour
  QHONEY: 62, // rgb old-queen colour
  COUNT: 63,
} as const;
/**
 * v2.1: layout of the physogastric queen abdomen, shared by the builder (geometry) and the shader (crease
 * shading, plates, peristalsis). u = 0 at the front of the abdomen .. 1 at the rear tip. The abdomen is split
 * into `segments` rolls; the roll coordinate is w = segments * (u + warp*u^2) / (1 + warp), so the rear rolls
 * are shorter than the bulky front ones. Creases sit at integer w = 1 .. segments-1.
 */
export const QUEEN_ABD = {
  segments: 10,
  warp: 0.3,
  /** u where the rounded front dome (around the back of the thorax) reaches full size */
  frontDome: 0.085,
  /** u where the rounded, slightly pointed rear tip starts */
  rearCap: 0.86,
  /** seconds between peristaltic waves (front -> back) */
  wavePeriod: 4.5,
  /**
   * roll profile across one roll (s = 0 .. 1 between two creases): p = sin(pi * s^rollSkew)^rollPow, crease = 1 - p.
   * rollSkew > 1 puts the fullest part behind the middle, so the rear of each roll drops more steeply and folds
   * over the next one; rollPow < 1 keeps the rolls rounded with narrow creases
   */
  rollSkew: 1.4,
  rollPow: 0.45,
} as const;

/** Rows of the shared rig texture (castes of every species share one texture). */
export const RIG_ROWS = 16;

/** Data the builder bakes per caste geometry (geometry.userData.rig). */
export interface TermiteRig {
  casteId: string;
  row: number;
  lod: number;
  /** RigCol.COUNT * 4 floats — this caste's row of the shared rig texture */
  texRow: Float32Array;
  pivots: Float32Array; // 33*3
  legDir: Float32Array; // 6*3
  antBase: Float32Array; // 2*3
  antDir: Float32Array; // 2*3
  abdA: [number, number, number];
  abdB: [number, number, number];
  bodyLength: number;
  bodyHeight: number;
  antennaLength: number;
  /** body travel per gait cycle at zero slip (mm) */
  strideLength: number;
  gaitAmplitude: number;
  gaitLift: number;
  isQueen: boolean;
  isLarva: boolean;
  /** nasus tip in rest pose (soldiers), model space mm; null otherwise */
  nasusTip: [number, number, number] | null;
  /** nasus tip diameter (mm): glue / acid stream reference thickness */
  nasusTipDiameter: number;
  neck: [number, number, number];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  triangles: number;
  // ---- v2 ----
  /** head rest pitch (rad) baked for this caste */
  headRest?: number;
  /** sickle soldiers: mandible tip positions (rest space, mandibles closed) L, R */
  mandibleTips?: [[number, number, number], [number, number, number]] | null;
  /** sickle soldiers: the grab socket (rest space, mandibles closed) = where the crossed tips meet */
  socket?: [number, number, number] | null;
  /** mandible hinge axis (rest space) */
  mandibleAxis?: [number, number, number];
  /** nasus axis direction at the tip (rest space, unit) */
  nasusDir?: [number, number, number] | null;
}
