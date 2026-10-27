import type { AntRig } from './antGeometry';
import type { AntView } from './antRenderer';
import { POSE } from './antMaterial';

/**
 * Ant animation pass (docs/realism/animation.md), render only: the per-ant motion controller for the
 * pilot species. The deterministic sim gives position, heading, state and events; everything here only
 * decides how the body moves between them and never feeds back.
 *
 *  - Smoothness: the body's heading follows the sim's through a critically damped spring with a turn-rate
 *    limit (the head leads the turn); the gait's cadence, stance sweep and turn per stance come from the
 *    smoothed forward speed and turn rate, so the planted feet (vertex shader IK, `uPlant`) move back under
 *    the body exactly as far as it travels — no sliding, and turning in place steps round.
 *  - Body motion: a lean into turns, a pitch on speeding up and slowing down.
 *  - Variety (seeded by the ant's id): stride ±10 %, body size ±5 %, antenna sweep, gait phase, which idle
 *    and when.
 *  - Idles when standing: antenna grooming, leg rubbing, looking round, antennating, small repositioning
 *    steps, and pauses between.
 *  - Hit reactions (two: a recoil and a side flinch) with a brief flash and a 50 ms hit-stop of the ant's
 *    own animation; deaths (onto the back or the side, legs curling over half a second, twitching);
 *    a flung ant tumbles, lands with a bounce and rights itself.
 *  - Secondary motion: the antennae lag and overshoot on spring-damped offsets.
 */

/** Which morphs use the pass (the pilot: the tropical fire ant; the rollout widens this). */
export const ANIM_V2_PREFIXES = ['fire_'];
/** Lab switch: false shows the old motion (before/after clips). */
export const animSettings = { v2: true };
export const animV2 = (morph: string): boolean => animSettings.v2 && ANIM_V2_PREFIXES.some((p) => morph.startsWith(p));

/** Attack variants per species (render/ants/attackPoses.ts): fire ants grip and sting instead of rearing up. */
export function attackVariant(morph: string, v: number): number {
  if (morph.startsWith('fire_')) return [0, 3, 2][((v % 3) + 3) % 3];
  return v;
}

export const IDLE = { GROOM_ANT: 0, GROOM_LEGS: 1, LOOK: 2, ANTENNATE: 3, SHUFFLE: 4 } as const;
const IDLE_W = [0.26, 0.2, 0.2, 0.18, 0.16];
const IDLE_DUR: Array<[number, number]> = [
  [2.4, 3.6],
  [1.8, 2.8],
  [1.6, 2.6],
  [1.2, 2.2],
  [0.7, 1.0],
];

export interface Motion2 {
  seed: number;
  rs: number;
  strideK: number;
  sizeK: number;
  waveK: number;
  init: boolean;
  hb: number;
  hw: number;
  lastHb: number;
  vf: number;
  om: number;
  acc: number;
  Dh: number;
  Ps: number;
  roll: number;
  pitch: number;
  asp: number;
  aspv: number;
  apo: number;
  apov: number;
  idle: number;
  it: number;
  idur: number;
  iwait: number;
  iy: number;
  stillT: number;
  shuf: number;
  hp: number;
  hitT: number;
  hitV: number;
  hitSide: number;
  hitCd: number;
  flash: number;
  flashCd: number;
  deadT: number;
  deadV: number;
  deadS: number;
  spin: number;
  spinRate: number;
  spinAxis: number;
  air: boolean;
  bounceT: number;
  /** after landing: the half turn it came down on, and how long it lies there kicking before rolling upright */
  landK: number;
  rightT: number;
  freeze: number;
}

/** What the controller decides this frame (the renderer turns it into the instance transform and attributes). */
export interface MotionOut {
  /** body heading (sim radians) */
  h: number;
  /** body-frame offsets (mm): forward, right, up */
  fwd: number;
  side: number;
  up: number;
  /** extra yaw, pitch (+ nose up), roll (+ top to the right) */
  yaw: number;
  pitch: number;
  roll: number;
  /** tumbling while flung: about the body's long axis or its side axis */
  spinRoll: number;
  spinPitch: number;
  /** planted feet: stance half-sweep (object mm) and half the turn per stance (rad) */
  Dh: number;
  Ps: number;
  flash: number;
  /** death: leg curl (0..~1.1, the shader's `death`) and the roll onto the back or side */
  deathLeg: number;
  deathRoll: number;
  /** pose to blend to (POSE.*) and antenna offsets */
  pose: number;
  headYaw: number;
  headPitch: number;
  mand: number;
  antPitch: number;
  antSpread: number;
  antAct: number;
  /** animation clock scale (0 during a hit-stop) */
  clock: number;
}

export function newMotionOut(): MotionOut {
  return { h: 0, fwd: 0, side: 0, up: 0, yaw: 0, pitch: 0, roll: 0, spinRoll: 0, spinPitch: 0, Dh: 0, Ps: 0, flash: 0, deathLeg: 0, deathRoll: 0, pose: 0, headYaw: 0, headPitch: 0, mand: 0, antPitch: 0, antSpread: 0, antAct: 0, clock: 1 };
}

const hash01 = (n: number, k: number): number => {
  const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function newMotion(id: number): Motion2 {
  const r = (k: number) => hash01(id, k);
  return {
    seed: r(1),
    rs: (Math.floor(r(2) * 2147483646) + 1) | 0,
    strideK: 0.9 + 0.2 * r(3),
    sizeK: 0.95 + 0.1 * r(4),
    waveK: 0.75 + 0.5 * r(5),
    init: false,
    hb: 0,
    hw: 0,
    lastHb: 0,
    vf: 0,
    om: 0,
    acc: 0,
    Dh: 0,
    Ps: 0,
    roll: 0,
    pitch: 0,
    asp: 0,
    aspv: 0,
    apo: 0,
    apov: 0,
    idle: -1,
    it: 0,
    idur: 0,
    iwait: 0.3 + 1.6 * r(6),
    iy: 0,
    stillT: 0,
    shuf: 0,
    hp: -1,
    hitT: 9,
    hitV: 0,
    hitSide: 1,
    hitCd: 0,
    flash: 0,
    flashCd: 0,
    deadT: -1,
    deadV: r(7) < 0.5 ? 0 : 1,
    deadS: r(8) < 0.5 ? -1 : 1,
    spin: 0,
    spinRate: (10 + 8 * r(9)) * (r(10) < 0.5 ? -1 : 1),
    spinAxis: r(11) < 0.6 ? 0 : 1,
    air: false,
    bounceT: 9,
    landK: 0,
    rightT: 0,
    freeze: 0,
  };
}

/** The ant's own little random sequence (render only; seeded by its id, so clips repeat). */
function rnd(m: Motion2): number {
  let x = m.rs;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  m.rs = x | 0;
  return ((x >>> 0) % 100000) / 100000;
}

const wrap = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const sm = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Hit flinch envelope: a fast jolt, an ease back with a small overshoot, settled by 0.5 s. */
function flinch(t: number): number {
  if (t < 0.06) return t / 0.06;
  if (t < 0.3) return 1 - 1.15 * sm((t - 0.06) / 0.24);
  if (t < 0.5) return -0.15 * (1 - sm((t - 0.3) / 0.2));
  return 0;
}

/** A damped spring step (stable for the frame times used: sub-stepped). */
function spring(x: number, v: number, target: number, hz: number, zeta: number, dt: number): [number, number] {
  const w = Math.PI * 2 * hz;
  const n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v += (w * w * (target - x) - 2 * zeta * w * v) * h;
    x += v * h;
  }
  return [x, v];
}

export interface MotionIn {
  x: number;
  y: number;
  /** interpolated sim heading */
  h: number;
  lastX: number;
  lastY: number;
  dt: number;
  scale: number;
  /** on a creature: its animated leg or back places the ant (heading from the mount) */
  mounted: boolean;
  mountSpeed: number;
  fighting: boolean;
}

/**
 * Advance one ant's controller. `s` is the renderer's per-ant state (phase, amp, pose…), updated in place;
 * `m` the controller's own state; the result goes to `out`.
 */
export function stepMotion(
  s: { phase: number; amp: number; pose: number; poseW: number; pph: number; wave: number; death: number },
  m: Motion2,
  v: AntView,
  rig: AntRig,
  inp: MotionIn,
  out: MotionOut,
): void {
  const dt = inp.dt;
  const L = rig.length * inp.scale;
  // ---- hits: a recoil or a side flinch, a flash, a 50 ms hit-stop of the ant's own clocks
  m.hitCd -= dt;
  m.flashCd -= dt;
  if (v.hp !== undefined) {
    if (m.hp >= 0 && v.hp < m.hp - 1e-6 && !v.dead) {
      if (m.flashCd <= 0) {
        m.flash = 1;
        m.flashCd = 0.45;
      }
      if (m.hitCd <= 0) {
        m.hitT = 0;
        m.hitV = rnd(m) < 0.5 ? 0 : 1;
        m.hitSide = rnd(m) < 0.5 ? -1 : 1;
        m.hitCd = 0.55;
        m.freeze = 0.05;
      }
    }
    m.hp = v.hp;
  }
  // a hit-stop: the ant's own animation clocks pause for a few frames
  const clock = m.freeze > 0 ? 0 : 1;
  m.freeze = Math.max(0, m.freeze - dt);
  const adt = dt * clock;
  out.clock = clock;
  out.fwd = out.side = out.up = out.yaw = out.pitch = out.roll = out.spinRoll = out.spinPitch = 0;
  out.headYaw = out.headPitch = out.antPitch = out.antSpread = out.antAct = 0;
  out.mand = -1;
  out.pose = v.pose;

  // ---- heading: a critically damped spring toward the sim's (plus a repositioning offset), rate-limited
  const target = inp.h + m.shuf;
  if (!m.init) {
    m.init = true;
    m.hb = target;
    m.lastHb = target;
    s.phase = m.seed;
  }
  let dH = wrap(target - m.hb);
  if (Math.abs(dH) > 2.4 || inp.mounted || v.dead) {
    m.hb = target;
    m.hw = 0;
  } else if (dt > 0) {
    const W = 18;
    const n = Math.max(1, Math.ceil(dt * 240));
    const hh = dt / n;
    for (let i = 0; i < n; i++) {
      m.hw += (W * W * dH - 2 * W * m.hw) * hh;
      m.hw = clamp(m.hw, -12, 12);
      m.hb = wrap(m.hb + m.hw * hh);
      dH = wrap(target - m.hb);
    }
  }
  out.h = m.hb;

  // ---- speed along the body and turn rate (smoothed), from what the body actually did this frame
  let fwd = 0;
  const dx = inp.x - inp.lastX;
  const dy = inp.y - inp.lastY;
  if (Math.hypot(dx, dy) < L * 2) fwd = dx * Math.cos(m.hb) + dy * Math.sin(m.hb);
  const vfT = inp.mounted ? inp.mountSpeed : dt > 0 ? fwd / dt : 0;
  const omT = inp.mounted || dt <= 0 ? 0 : wrap(m.hb - m.lastHb) / dt;
  m.lastHb = m.hb;
  const prevVf = m.vf;
  m.vf = damp(m.vf, vfT, 14, dt);
  m.om = damp(m.om, clamp(omT, -14, 14), 14, dt);
  m.acc = damp(m.acc, dt > 0 ? (m.vf - prevVf) / dt : 0, 8, dt);

  // ---- gait: cadence from the travel, the stride a little shorter when slow; the stance sweep and the turn
  // per stance match what the body does, so the planted feet stay put
  // the stride: the most the legs can sweep (rig.sweepMax), a little shorter when slow; the turn per cycle likewise
  const duty = rig.gaitDuty ?? 0.55;
  const ellMax = ((2 * (rig.sweepMax ?? rig.length * 0.16)) / duty) * inp.scale * 0.97;
  const turnCyc = ((2 * (rig.turnMax ?? 0.2)) / duty) * 0.97;
  const vAbs = Math.abs(m.vf);
  const ell = ellMax * m.strideK * 0.92 * clamp(0.55 + 0.45 * (vAbs / (ellMax * 4)), 0.55, 1);
  const lever = rig.length * 0.3 * inp.scale;
  const travel = vAbs + Math.abs(m.om) * lever;
  const moving = !v.dead && travel > L * 0.04;
  // cycles per second: enough that neither the sweep nor the turn per stance goes past the legs' reach
  const cad = moving ? vAbs / ell + Math.abs(m.om) / turnCyc : 0;
  const DhT = cad > 0 ? ((duty * (m.vf / cad)) / 2) / inp.scale : 0;
  const PsT = cad > 0 ? (duty * (m.om / cad)) / 2 : 0;
  // (standing, the last stance is held: the planted feet stay where they are rather than sliding home)
  if (moving) {
    m.Dh = damp(m.Dh, DhT, 30, dt);
    m.Ps = damp(m.Ps, PsT, 30, dt);
  }
  s.phase += cad * adt;
  const ampT = v.dead ? 0 : Math.min(1, cad / 4 + (moving ? 0.45 : 0));
  s.amp = damp(s.amp, ampT, 10, dt);
  out.Dh = m.Dh;
  out.Ps = m.Ps;

  // ---- body: lean into turns, pitch with speeding up / slowing down
  m.roll = damp(m.roll, clamp((m.vf / Math.max(L, 1e-3)) * m.om * 0.01, -0.06, 0.06), 8, dt);
  m.pitch = damp(m.pitch, clamp((-m.acc / Math.max(L, 1e-3)) * 0.004, -0.06, 0.06), 8, dt);
  out.roll += m.roll;
  out.pitch += m.pitch;
  // the head leads the turn
  out.headYaw += clamp(wrap(inp.h - m.hb) * 0.7, -0.45, 0.45);

  m.hitT += dt;
  m.flash = Math.max(0, m.flash - dt * 7);
  out.flash = m.flash;
  if (m.hitT < 0.5 && !v.dead) {
    const e = flinch(m.hitT);
    if (m.hitV === 0) {
      out.fwd -= 0.07 * L * e;
      out.pitch += 0.12 * e;
      out.headPitch += 0.25 * e;
      out.mand = Math.max(out.mand, 0.55 * Math.max(0, e));
    } else {
      out.yaw += 0.25 * m.hitSide * e;
      out.roll += 0.18 * m.hitSide * e;
      out.side -= 0.03 * L * m.hitSide * e;
      out.headYaw -= 0.3 * m.hitSide * e;
    }
    out.antAct = Math.max(out.antAct, 0.8);
  }

  // ---- death: legs curl over half a second with a twitch, the body tips onto its back or its side
  if (v.dead) {
    if (m.deadT < 0) m.deadT = s.death > 0.9 ? 5 : 0;
    m.deadT += dt;
  } else m.deadT = -1;
  if (m.deadT >= 0) {
    const t = m.deadT;
    const tw = t < 2.2 ? 0.14 * Math.sin(t * 31 + m.seed * 6) * Math.exp(-t * 1.6) * (Math.sin(t * 7 + m.seed * 3) > 0.2 ? 1 : 0.25) : 0;
    out.deathLeg = clamp(sm(t / 0.5) + tw, 0, 1.12);
    const R = (m.deadV === 0 ? 2.55 : 1.45) * m.deadS;
    out.deathRoll = R * (sm(t / 0.45) + (t > 0.45 && t < 0.7 ? 0.08 * Math.sin(Math.PI * ((t - 0.45) / 0.25)) : 0));
    s.death = out.deathLeg;
  } else {
    out.deathLeg = 0;
    out.deathRoll = 0;
    s.death = damp(s.death, 0, 6, dt);
  }

  // ---- flung: tumble in the air, land with a bounce, right itself
  const airborne = !!v.flung && v.lift > L * 0.05;
  if (airborne) {
    m.air = true;
    m.spin += m.spinRate * dt;
  } else {
    if (m.air) {
      m.air = false;
      m.bounceT = 0;
      // it comes down on whichever half turn is nearest: on its back or side it lies kicking a moment first
      const half = Math.round(m.spin / Math.PI);
      m.landK = half * Math.PI;
      m.rightT = half % 2 !== 0 ? 0.45 + 0.35 * rnd(m) : 0;
    }
    if (m.rightT > 0) {
      // on its back: the legs flail, then it rolls over (blind review: it landed upright at once)
      m.rightT -= dt;
      m.spin = damp(m.spin, m.landK, 12, dt);
      out.deathLeg = Math.max(out.deathLeg, 0.45 + 0.3 * Math.sin(m.bounceT * 26 + m.seed * 5));
    } else {
      // roll the rest of the way to the nearest upright turn
      const k = Math.round(m.spin / (Math.PI * 2)) * Math.PI * 2;
      m.spin = damp(m.spin, k, 7, dt);
    }
    m.bounceT += dt;
  }
  if (m.spinAxis === 0) out.spinRoll = m.spin;
  else out.spinPitch = m.spin;
  if (m.bounceT < 0.7) out.up += 0.16 * L * Math.abs(Math.sin((Math.PI * m.bounceT) / 0.2)) * Math.exp(-m.bounceT * 4.5);

  // ---- idles when standing still and calm
  const still = !moving && !inp.mounted;
  m.stillT = still ? m.stillT + dt : 0;
  const calm = !v.dead && v.pose === POSE.NONE && !inp.fighting && !v.carrying && !(v.held ?? 0) && v.lift <= 0.01 && v.antennaActivity < 0.9 && !v.rideCr;
  if (!(calm && m.stillT > 0.5)) {
    if (m.idle >= 0) m.iwait = 0.4 + 1.2 * rnd(m);
    m.idle = -1;
    if (!still || !calm) m.shuf = damp(m.shuf, 0, 3, dt);
  } else if (m.idle < 0) {
    m.iwait -= dt;
    if (m.iwait <= 0) {
      let r = rnd(m);
      let k = 0;
      while (k < IDLE_W.length - 1 && r > IDLE_W[k]) r -= IDLE_W[k++];
      m.idle = k;
      m.it = 0;
      m.idur = IDLE_DUR[k][0] + (IDLE_DUR[k][1] - IDLE_DUR[k][0]) * rnd(m);
      m.iy = (0.3 + 0.3 * rnd(m)) * (rnd(m) < 0.5 ? -1 : 1);
      if (k === IDLE.SHUFFLE) m.shuf = clamp(m.shuf + m.iy * 0.8, -0.6, 0.6);
    }
  } else {
    m.it += dt;
    if (m.it >= m.idur) {
      m.idle = -1;
      m.iwait = 0.6 + 2.0 * rnd(m);
    }
  }
  if (m.idle >= 0) {
    const u = m.it / Math.max(0.01, m.idur);
    switch (m.idle) {
      case IDLE.GROOM_ANT:
        out.pose = POSE.GROOM_ANT;
        out.headPitch -= 0.12;
        break;
      case IDLE.GROOM_LEGS:
        out.pose = POSE.GROOM_LEGS;
        break;
      case IDLE.LOOK:
        // look one way, then the other, then back
        out.headYaw += u < 0.38 ? m.iy : u < 0.8 ? -m.iy * 0.85 : 0;
        out.headPitch += 0.08;
        out.antPitch += 0.35;
        out.antAct = Math.max(out.antAct, 0.75);
        break;
      case IDLE.ANTENNATE:
        // reaching toward a neighbour: head turned and down, antennae tapping fast
        out.headYaw += m.iy * 0.7;
        out.headPitch -= 0.15;
        out.antPitch += 0.1;
        out.antAct = 1;
        break;
      case IDLE.SHUFFLE:
        // the heading offset was set at the start: the body steps round to it
        break;
    }
  }

  // ---- antennae: lag and overshoot on springs (turning swings them out, braking dips them)
  [m.asp, m.aspv] = spring(m.asp, m.aspv, clamp(Math.abs(m.om) * 0.05, 0, 0.3), 3.5, 0.3, dt);
  [m.apo, m.apov] = spring(m.apo, m.apov, clamp((-m.acc / Math.max(L, 1e-3)) * 0.01, -0.4, 0.4), 4, 0.3, dt);
  out.antSpread += m.asp;
  out.antPitch += m.apo;
}

/**
 * The vertex shader's planted-foot solve, on the CPU (tests and tools): where leg `li`'s foot (tarsus tip) is in
 * the ant's object space for gait phase, amplitude, stance half-sweep and turn per stance (antMaterial.ts ANIM_BODY
 * with uPlant on, no pose). Mirrors the GLSL step for step.
 */
export function plantedFoot(rig: AntRig, li: number, phase: number, amp: number, Dh: number, Ps: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const gB = li === 1 || li === 2 || li === 5;
  const ph = (((phase + (gB ? 0.5 : 0)) % 1) + 1) % 1;
  const duty = rig.gaitDuty ?? 0.55;
  const lift0 = rig.gaitLift ?? 0.24;
  let pro: number;
  let lift: number;
  if (ph < duty) {
    pro = 1 + (-1 - 1) * (ph / duty);
    lift = 0;
  } else {
    const t = (ph - duty) / (1 - duty);
    pro = -1 + 2 * (0.5 - 0.5 * Math.cos(t * Math.PI));
    lift = Math.sin(t * Math.PI);
  }
  const bob = amp * rig.length * 0.006 * Math.cos(phase * 12.566);
  const C = rig.coxa[li];
  const K = rig.knee[li];
  const F0 = rig.foot![li];
  const NH = rig.home ? rig.home[li] : F0;
  // tg = rotA((N.x, 0, N.z), UP, −pro·Ps) + (pro·Dh, 0, 0); rotA about +y by θ: x' = x cos + z sin, z' = −x sin + z cos
  const th = -pro * Ps;
  const tx = NH.x * Math.cos(th) + NH.z * Math.sin(th) + pro * Dh;
  const tz = -NH.x * Math.sin(th) + NH.z * Math.cos(th);
  const r0x = F0.x - C.x;
  const r0z = F0.z - C.z;
  const r1x = tx - C.x;
  const r1z = tz - C.z;
  const wrapG = (x: number) => x - 6.2831853 * Math.floor((x + 3.14159265) / 6.2831853);
  const yaw = wrapG(Math.atan2(r0z, r0x) - Math.atan2(r1z, r1x));
  const r0l = Math.hypot(r0x, r0z);
  const ox = r0x / r0l;
  const oz = r0z / r0l;
  const kkx = (K.x - C.x) * ox + (K.z - C.z) * oz;
  const kky = K.y - C.y;
  const ffx = r0l;
  const ffy = F0.y - C.y;
  const la = Math.hypot(kkx, kky);
  const lb = Math.hypot(ffx - kkx, ffy - kky);
  const ttx = Math.hypot(r1x, r1z);
  const tty = ffy + lift * lift0 * amp * r0l * 0.75 - bob;
  const Dd = Math.min(Math.max(Math.hypot(ttx, tty), Math.abs(la - lb) + 1e-4), (la + lb) * 0.999);
  const al = Math.acos(Math.max(-1, Math.min(1, (la * la + Dd * Dd - lb * lb) / (2 * la * Dd))));
  const sK = ffx * kky - ffy * kkx >= 0 ? 1 : -1;
  const pA1 = Math.atan2(tty, ttx) + sK * al;
  const K1x = la * Math.cos(pA1);
  const K1y = la * Math.sin(pA1);
  const pB1 = Math.atan2(tty - K1y, ttx - K1x);
  const lft = wrapG(pA1 - Math.atan2(kky, kkx));
  const knee = wrapG(pB1 - Math.atan2(ffy - kky, ffx - kkx) - lft);
  const ankleF = lift * 0.3 * amp;
  // the chain: ankle → knee → lift (about the leg axis at the coxa) → yaw (about up at the coxa)
  const ax = rig.axis[li];
  const P = { x: F0.x, y: F0.y, z: F0.z };
  const rot = (piv: { x: number; y: number; z: number }, a: { x: number; y: number; z: number }, ang: number) => {
    const vx = P.x - piv.x;
    const vy = P.y - piv.y;
    const vz = P.z - piv.z;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const d = a.x * vx + a.y * vy + a.z * vz;
    const cx = a.y * vz - a.z * vy;
    const cy = a.z * vx - a.x * vz;
    const cz = a.x * vy - a.y * vx;
    P.x = piv.x + vx * c + cx * s + a.x * d * (1 - c);
    P.y = piv.y + vy * c + cy * s + a.y * d * (1 - c);
    P.z = piv.z + vz * c + cz * s + a.z * d * (1 - c);
  };
  rot(rig.ankle[li], ax, ankleF);
  rot(K, ax, knee);
  rot(C, ax, lft);
  rot(C, { x: 0, y: 1, z: 0 }, yaw);
  out.x = P.x;
  out.y = P.y + bob;
  out.z = P.z;
  return out;
}
