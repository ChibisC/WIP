/**
 * GLSL for the termite rig, injected into MeshPhysicalMaterial / MeshDepthMaterial via onBeforeCompile
 * (see material.ts), so the game's lights, shadows, fog and tone mapping keep working.
 *
 * ONE shared material for every caste: per-caste rig data (bone pivots, leg directions, colours...)
 * lives in a small float texture (one row per caste, see RigCol in rig.ts) addressed by the
 * per-vertex `aCaste` attribute. Per-instance attributes drive animation, tint and glue.
 */
import { AIM, GAIT_DUTY, HEAD_REST_PITCH, HOLD, LUNGE_SNAP, QUEEN_ABD, RigCol } from './rig';

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

const RIG_DEFINES = Object.entries(RigCol)
  .map(([k, v]) => `#define RC_${k} ${v}`)
  .join('\n');

/** v2.1: physogastric queen roll coordinate + crease profile (mirrors the builder; see QUEEN_ABD) */
const QUEEN_GLSL = /* glsl */ `
#define QA_SEGS ${f(QUEEN_ABD.segments)}
#define QA_WARP ${f(QUEEN_ABD.warp)}
#define QA_PERIOD ${f(QUEEN_ABD.wavePeriod)}
#define QA_SKEW ${f(QUEEN_ABD.rollSkew)}
#define QA_RPOW ${f(QUEEN_ABD.rollPow)}
float qW(float u) { return QA_SEGS * (u + QA_WARP * u * u) / (1.0 + QA_WARP); }
// 0 on the full part of a roll .. 1 at the bottom of a crease (none on the front dome or the tip)
float qCrease(float w) {
  float mask = smoothstep(0.55, 0.7, w) * (1.0 - smoothstep(QA_SEGS - 0.75, QA_SEGS - 0.45, w));
  return mask * (1.0 - pow(max(0.0, sin(3.14159265 * pow(fract(w), QA_SKEW))), QA_RPOW));
}
`;

export const NOISE_GLSL = /* glsl */ `
float tHash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec3 tHash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
// cellular noise: (distance to the nearest feature point, that point's random id)
vec2 tCell(vec3 x) {
  vec3 i = floor(x); vec3 fr = fract(x); float d1 = 8.0; float id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int k = -1; k <= 1; k++) {
    vec3 g = vec3(float(k), float(y), float(z)); vec3 o = tHash33(i + g); vec3 r = g + o - fr; float d = dot(r, r);
    if (d < d1) { d1 = d; id = o.x; }
  }
  return vec2(sqrt(d1), id);
}
float tNoise(vec3 x) {
  vec3 i = floor(x); vec3 fr = fract(x); fr = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(mix(tHash3(i), tHash3(i + vec3(1, 0, 0)), fr.x), mix(tHash3(i + vec3(0, 1, 0)), tHash3(i + vec3(1, 1, 0)), fr.x), fr.y),
             mix(mix(tHash3(i + vec3(0, 0, 1)), tHash3(i + vec3(1, 0, 1)), fr.x), mix(tHash3(i + vec3(0, 1, 1)), tHash3(i + vec3(1, 1, 1)), fr.x), fr.y), fr.z);
}
`;

export const TERMITE_VERTEX_PARS = /* glsl */ `
${RIG_DEFINES}
#define AIM_YAW ${f(AIM.yawLimit)}
#define AIM_PMIN ${f(AIM.pitchMin)}
#define AIM_PMAX ${f(AIM.pitchMax)}
#define AIM_BIAS ${f(AIM.pitchBias)}
#define HEAD_REST ${f(HEAD_REST_PITCH)}
#define GAIT_DUTY ${f(GAIT_DUTY)}
#define HOLD_PITCH ${f(HOLD.headPitch)}
#define HOLD_RECOIL ${f(HOLD.recoilPitch)}
#define HOLD_CROUCH ${f(HOLD.crouch)}
#define HOLD_BODY_PITCH ${f(HOLD.bodyPitch)}
#define HOLD_GRIP ${f(HOLD.grip)}
#define HOLD_TUG_YAW ${f(HOLD.tugYaw)}
#define HOLD_TUG_PITCH ${f(HOLD.tugPitch)}
#define HOLD_TUG_PUSH ${f(HOLD.tugPush)}
#define HOLD_TUG_BODY ${f(HOLD.tugBody)}
#define LUNGE_SNAP ${f(LUNGE_SNAP)}
uniform float uTermiteTime;
uniform highp sampler2D uRigTex;
attribute vec4 aRig;   // bone id, bone param (antenna arc length / abdomen t / nasus t), material class, caste row
#define aBone aRig.x
#define aBT aRig.y
#define aMat aRig.z
#define aCaste aRig.w
attribute vec4 aAnim;  // state, phase0 (cycles), rate (cycles/s), stateT (0..1 for one-shots)
attribute vec4 aAnim2; // rampFraction, aimYaw, aimPitch, firing (0/1)
attribute vec4 aLook;  // tan (0 pale .. 1 adult), carry (0 none,1 wood,2 egg), glue (0..1), seed (0..1)
attribute vec4 aBlend; // prevState, blendStartTime, prevStateT, blendDuration
attribute vec3 aTint;  // per-instance colour multiplier for cuticle (team colour / variation)
attribute vec4 aFx;    // v2: acid on this termite (0..1), fizz (0..1), v2.1 queen age + 1 (0 = caste default), unused
varying vec4 vA;       // mat, bone, bt, tan
varying vec4 vFx;
varying vec3 vRestN;
varying vec3 vRestP;
varying vec4 vLook;
varying vec3 vTint;
flat varying float vCaste;

vec4 rigT(int col) { return texelFetch(uRigTex, ivec2(col, int(aCaste + 0.5)), 0); }
vec3 PIV(int i) { return rigT(RC_PIVOT + i).xyz; }

const float TAU = 6.28318530718;
bool isState(float s, float k) { return abs(s - k) < 0.5; }
vec3 rotAxis(vec3 v, vec3 a, float ang) {
  float c = cos(ang), s = sin(ang);
  return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c);
}
${QUEEN_GLSL}

struct Pose {
  vec3 bodyOff;  // translation (mm)
  vec3 bodyRot;  // yaw, pitch, roll
  vec3 head;     // yaw, pitch, push (mm along head forward)
  float mand;    // mandible opening (rad)
  vec3 antL;     // outward yaw, pitch, curvature (rad/mm)
  vec3 antR;
  vec4 abd;      // yaw bend, pitch bend, radial scale, tip squeeze
  vec4 leg;      // protraction, femur levation, tibia flex, tarsus flex (this vertex's leg)
  float bend;    // larva lateral wave amplitude (mm)
  float egg;     // queen egg extrusion 0..1
};

Pose zeroPose() {
  Pose P;
  vec4 po = rigT(RC_POSE); // headRest, mandRest, gape, sickle
  P.bodyOff = vec3(0.0); P.bodyRot = vec3(0.0); P.head = vec3(0.0, po.x, 0.0); P.mand = po.y;
  P.antL = vec3(0.0); P.antR = vec3(0.0); P.abd = vec4(0.0, 0.0, 1.0, 0.0); P.leg = vec4(0.0);
  P.bend = 0.0; P.egg = 0.0;
  return P;
}

Pose mixPose(Pose a, Pose b, float k) {
  Pose P;
  P.bodyOff = mix(a.bodyOff, b.bodyOff, k); P.bodyRot = mix(a.bodyRot, b.bodyRot, k);
  P.head = mix(a.head, b.head, k); P.mand = mix(a.mand, b.mand, k);
  P.antL = mix(a.antL, b.antL, k); P.antR = mix(a.antR, b.antR, k);
  P.abd = mix(a.abd, b.abd, k); P.leg = mix(a.leg, b.leg, k);
  P.bend = mix(a.bend, b.bend, k); P.egg = mix(a.egg, b.egg, k);
  return P;
}

// alternating tripod: L1 R2 L3 (legs 0,4,2) vs R1 L2 R3 (legs 3,1,5)
float tripodOffset(float leg) {
  return (abs(leg - 0.0) < 0.5 || abs(leg - 4.0) < 0.5 || abs(leg - 2.0) < 0.5) ? 0.0 : 0.5;
}

vec4 gaitLeg(float ph, float amp, float lift, float pair) {
  float prot; float lv = 0.0; float tb = 0.0;
  if (ph < GAIT_DUTY) {
    prot = mix(amp, -amp, ph / GAIT_DUTY);
  } else {
    float s = (ph - GAIT_DUTY) / (1.0 - GAIT_DUTY);
    float e = s * s * (3.0 - 2.0 * s);
    prot = mix(-amp, amp, e);
    float hh = sin(3.14159265 * s);
    lv = hh * lift;
    tb = -hh * lift * 0.9;
  }
  float k = pair < 0.5 ? 0.9 : (pair > 1.5 ? 1.1 : 1.0);
  return vec4(prot * k, lv, tb, -lv * 0.35);
}

// ---- v2: grab-and-squirt (mirrored on the CPU by holdPoseCPU() in material.ts; keep in sync) ----
// tug signals of a held victim: x yaw jerk (-1..1), y pitch (-1..1), z pull-back (0..1)
vec3 holdTug(float t) {
  float a = 0.6 * sin(t * 7.3) + 0.4 * sin(t * 12.7 + 1.3);
  float b = 0.6 * sin(t * 9.1 + 0.7) + 0.4 * sin(t * 15.3 + 2.1);
  float c = max(0.0, sin(t * 5.2 + 0.4));
  return vec3(sign(a) * sqrt(abs(a)), b, c * c);
}
// squirt recoil from the nasus: pulses 3 -> 12 Hz with the ramp, a steady tremor at the cap
float holdRecoil(float ramp, float squirting, float seed) {
  float rate = mix(3.0, 12.0, ramp);
  float pulse = pow(max(0.0, sin(TAU * uTermiteTime * rate + seed * 6.0)), 6.0);
  float jitter = 0.5 + 0.5 * sin(uTermiteTime * 95.0 + seed * 13.0);
  return squirting * (pulse * (1.0 - ramp) + ramp * 0.35 * jitter);
}
void holdPose(inout Pose P, float t, float seed, float L, float bh, float hr, float k0, float leg, float pair) {
  float fr = clamp(aAnim2.x, 0.0, 1.0);
  float rc = holdRecoil(fr, aAnim2.w, seed);
  vec3 tg = holdTug(t);
  P.head = vec3(HOLD_TUG_YAW * tg.x + clamp(aAnim2.y, -0.4, 0.4),
                hr + HOLD_PITCH + HOLD_TUG_PITCH * tg.y + HOLD_RECOIL * rc + clamp(aAnim2.z, -0.4, 0.4),
                -HOLD_TUG_PUSH * L * tg.z);
  P.mand = HOLD_GRIP;
  P.bodyOff = vec3(-0.012 * L * tg.z, -HOLD_CROUCH * bh, 0.0);
  P.bodyRot = vec3(HOLD_TUG_BODY * 0.5 * tg.x, HOLD_BODY_PITCH, HOLD_TUG_BODY * 0.4 * tg.y);
  // legs braced wide: front legs reach forward, hind legs push back, knees up; small tugging tremor
  if (leg >= 0.0) {
    float pro = pair < 0.5 ? 0.26 : (pair > 1.5 ? -0.24 : 0.04);
    P.leg = vec4(pro + 0.03 * sin(t * 11.0 + leg * 1.7) * tg.z, 0.16 + 0.02 * sin(t * 13.0 + leg), 0.1, 0.0);
  }
  P.antL = vec3(0.22 + 0.1 * sin(t * 5.1), -0.38 + 0.12 * sin(t * 6.3), k0 * 1.5);
  P.antR = vec3(0.22 + 0.1 * sin(t * 5.6 + 1.1), -0.38 + 0.12 * sin(t * 6.9 + 0.5), k0 * 1.5);
  P.abd = vec4(0.05 * tg.x, 0.03 * tg.y, 1.0 - 0.02 * rc, 0.0);
}

Pose evalPose(float st, float cyc, float T, float leg, float seed) {
  vec4 rA = rigT(RC_RIG_A); vec4 rB = rigT(RC_RIG_B);
  Pose P = zeroPose();
  float L = rA.x; float amp = rA.y; float lift = rB.y; float bh = rB.x;
  float aL = max(rB.z, 0.1);
  float t = uTermiteTime + seed * 37.0;
  float pair = leg >= 0.0 ? mod(leg, 3.0) : 0.0;
  float side = leg < 2.5 ? -1.0 : 1.0;
  float k0 = 0.55 / aL; // gentle downward curve of the antenna
  vec4 po = rigT(RC_POSE); float hr = po.x; float gape = po.z;

  // ---- IDLE (also the base for most states): head raised, antennae forward and sweeping ----
  P.antL = vec3(0.14 + 0.12 * sin(t * 1.7), -0.04 + 0.06 * sin(t * 2.3 + 1.0), k0);
  P.antR = vec3(0.14 + 0.12 * sin(t * 1.9 + 2.1), -0.04 + 0.06 * sin(t * 2.1 + 0.4), k0);
  P.leg = vec4(0.03 * sin(t * 0.9 + leg * 1.7), 0.02 * sin(t * 1.3 + leg), 0.0, 0.0);
  P.abd.z = 1.0 + 0.012 * sin(t * 1.1);
  P.head = vec3(0.06 * sin(t * 0.5), hr + 0.03 * sin(t * 0.8 + 1.0), 0.0);

  if (isState(st, 1.0) || isState(st, 6.0) || isState(st, 17.0)) { // WALK / CHARGE / RUSH
    float charge = isState(st, 6.0) ? 1.0 : 0.0;
    float a = amp * (1.0 + 0.25 * charge);
    float lf = lift * (1.0 + 0.2 * charge);
    if (leg >= 0.0) P.leg = gaitLeg(fract(cyc + tripodOffset(leg)), a, lf, pair);
    float c = TAU * cyc;
    P.bodyRot = vec3(0.04 * sin(c), 0.0, 0.02 * sin(c));
    P.bodyOff.y = -0.005 * L * abs(sin(c));
    P.abd.x = -0.09 * sin(c - 0.9); // abdomen sways side to side, lagging the body
    P.head = vec3(0.04 * sin(c + 0.6), hr - 0.02 - 0.38 * charge, 0.0);
    float tapL = max(0.0, sin(2.0 * c));
    float tapR = max(0.0, sin(2.0 * c + 3.14159));
    P.antL = vec3(0.12 + 0.08 * sin(c * 0.5 + seed * 6.0), -0.05 - 0.2 * tapL * tapL, k0 * 1.2);
    P.antR = vec3(0.12 + 0.08 * sin(c * 0.5 + seed * 6.0 + 1.7), -0.05 - 0.2 * tapR * tapR, k0 * 1.2);
    if (charge > 0.5) {
      P.antL = vec3(0.5, 0.2, k0 * 0.6); P.antR = P.antL;
      P.bodyOff.y -= 0.04 * bh;
    }
    if (isState(st, 17.0)) { // RUSH: head up, mandibles gaping, antennae forward
      P.head.y = hr + 0.16 + 0.03 * sin(c * 2.0);
      P.mand = gape * (0.82 + 0.1 * sin(t * 9.0));
      P.antL = vec3(0.38, 0.12 + 0.12 * tapL, k0 * 0.7); P.antR = vec3(0.38, 0.12 + 0.12 * tapR, k0 * 0.7);
    }
  } else if (isState(st, 2.0)) { // CHEW
    float c = TAU * cyc; float b = 0.5 + 0.5 * sin(c);
    P.head = vec3(0.04 * sin(c * 0.25), -0.38 + 0.08 * b, 0.012 * L * (1.0 - b));
    P.mand = 0.08 + 0.42 * b;
    P.bodyOff.x = -0.01 * L * b; P.bodyRot.y = -0.03;
    P.antL = vec3(0.3 + 0.08 * sin(t * 3.1), -0.4 + 0.1 * sin(t * 4.3), k0 * 1.6);
    P.antR = vec3(0.3 + 0.08 * sin(t * 3.4 + 1.0), -0.4 + 0.1 * sin(t * 4.1 + 2.0), k0 * 1.6);
    if (leg >= 0.0) P.leg = vec4(pair < 0.5 ? 0.12 : (pair > 1.5 ? -0.08 : 0.0), -0.04, 0.0, 0.0);
  } else if (isState(st, 3.0)) { // GROOM / trophallaxis
    float c = TAU * cyc;
    P.head = vec3(0.16 * sin(c * 0.5), -0.1 + 0.12 * sin(c), 0.01 * L * max(0.0, sin(c)));
    P.mand = 0.15 + 0.15 * sin(c * 2.0);
    P.antL = vec3(-0.05 + 0.12 * sin(c + 0.5), -0.15 + 0.12 * sin(c * 1.3), k0 * 1.4);
    P.antR = vec3(-0.05 + 0.12 * sin(c + 2.0), -0.15 + 0.12 * sin(c * 1.3 + 1.0), k0 * 1.4);
    P.bodyRot.y = 0.025 * sin(c);
  } else if (isState(st, 4.0)) { // DIG
    float c = TAU * cyc; float sc = sin(c);
    P.head = vec3(0.05 * sin(c * 0.5), -0.42 + 0.26 * sc, 0.02 * L * max(0.0, sc));
    P.mand = 0.1 + 0.35 * max(0.0, sc);
    P.antL = vec3(0.55, 0.22, k0); P.antR = P.antL;
    if (leg >= 0.0 && pair < 0.5) {
      float ph = c + (side > 0.0 ? 3.14159 : 0.0);
      P.leg = vec4(0.2 + 0.25 * sin(ph), 0.18 * max(0.0, sin(ph)), -0.15 * max(0.0, sin(ph)), 0.0);
    }
    P.bodyRot.y = -0.04 + 0.02 * sc;
  } else if (isState(st, 5.0)) { // FIRE (nasute): planted, head raised and tracking, squirt pulses
    float fr = clamp(aAnim2.x, 0.0, 1.0); float firing = aAnim2.w;
    float rate = mix(3.0, 12.0, fr);
    float pulse = pow(max(0.0, sin(TAU * uTermiteTime * rate + seed * 6.0)), 6.0);
    float jitter = 0.5 + 0.5 * sin(uTermiteTime * 95.0 + seed * 13.0);
    float recoil = firing * (pulse * (1.0 - fr) + fr * 0.35 * jitter);
    P.head = vec3(clamp(aAnim2.y, -AIM_YAW, AIM_YAW), clamp(aAnim2.z, AIM_PMIN, AIM_PMAX) + AIM_BIAS, -0.008 * L * recoil);
    P.bodyOff.y = -0.05 * bh; P.bodyRot.y = 0.035;
    if (leg >= 0.0) P.leg = vec4(pair < 0.5 ? 0.18 : (pair > 1.5 ? -0.18 : 0.0), 0.1, 0.04, 0.0);
    P.antL = vec3(0.42 + 0.12 * sin(t * 2.6), 0.05 + 0.08 * sin(t * 3.3), k0 * 0.8);
    P.antR = vec3(0.42 + 0.12 * sin(t * 2.9 + 1.3), 0.05 + 0.08 * sin(t * 3.1 + 0.7), k0 * 0.8);
    P.abd.z = 1.0 - 0.015 * recoil;
  } else if (isState(st, 7.0)) { // RAM (major)
    float c = TAU * cyc; float lunge = pow(max(0.0, sin(c)), 3.0);
    P.bodyOff.x = 0.07 * L * lunge; P.bodyOff.y = -0.03 * bh;
    P.head = vec3(0.0, -0.28 + 0.4 * lunge, 0.02 * L * lunge);
    P.bodyRot.y = -0.04 + 0.05 * lunge;
    if (leg >= 0.0) P.leg = vec4((pair < 0.5 ? 0.1 : (pair > 1.5 ? -0.22 : -0.05)) * (0.4 + lunge), 0.06, 0.08 * lunge, 0.0);
    P.antL = vec3(0.55, 0.15, k0 * 0.5); P.antR = P.antL;
  } else if (isState(st, 8.0)) { // ALARM (major): vertical head jerking
    float j = sin(TAU * 6.0 * uTermiteTime + seed * 3.0);
    float jerk = sign(j) * sqrt(abs(j));
    P.head = vec3(0.0, hr + 0.05 + 0.22 * jerk, 0.0);
    P.bodyOff.y = 0.006 * L * jerk; P.bodyRot.y = 0.05 * jerk;
    P.antL = vec3(0.4, 0.2 + 0.05 * jerk, k0 * 0.4); P.antR = P.antL;
  } else if (isState(st, 9.0)) { // BITE
    float c = TAU * cyc; float snap = pow(max(0.0, sin(c)), 2.0);
    P.head = vec3(0.0, -0.1 + 0.05 * snap, 0.04 * L * snap);
    P.mand = 0.55 * (1.0 - snap) + 0.02;
    P.bodyOff.x = 0.035 * L * snap;
    P.antL = vec3(0.45, 0.1, k0 * 0.6); P.antR = P.antL;
    if (leg >= 0.0) P.leg = vec4(pair > 1.5 ? -0.12 * snap : 0.06 * snap, 0.0, 0.0, 0.0);
  } else if (isState(st, 10.0)) { // DEATH: legs curl, body deflates, head droops
    float e = smoothstep(0.0, 1.0, clamp(T, 0.0, 1.0));
    P.leg = mix(P.leg, vec4((pair < 0.5 ? -0.25 : (pair > 1.5 ? 0.3 : 0.0)), 0.95, -1.55, -0.7), e);
    P.bodyOff.y = -0.62 * bh * e;
    P.bodyRot = vec3((seed - 0.5) * 0.6 * e, -0.04 * e, (seed - 0.5) * 0.5 * e);
    P.head = vec3((seed - 0.5) * 0.5 * e, mix(hr, -0.44, e), -0.01 * L * e);
    P.abd = vec4(0.0, -0.06 * e, 1.0 - 0.15 * e, 0.0);
    P.antL = vec3(0.3 * (1.0 - e) + 0.05, -0.1 - 0.3 * e, k0 + 2.2 / aL * e);
    P.antR = vec3(0.25 * (1.0 - e) + 0.1, -0.15 - 0.25 * e, k0 + 1.8 / aL * e);
    P.mand = 0.25 * e;
  } else if (isState(st, 11.0)) { // WRIGGLE (larva)
    P.bend = 0.05 * L * (0.6 + 0.4 * sin(t * 0.7));
    if (leg >= 0.0) P.leg = gaitLeg(fract(t * 0.6 + tripodOffset(leg)), 0.15, 0.25, pair);
    P.head = vec3(0.12 * sin(t * 0.9), 0.06 * sin(t * 1.3), 0.0);
    P.abd = vec4(0.12 * sin(t * 1.1 - 1.0), 0.04 * sin(t * 0.8), 1.0 + 0.03 * sin(t * 1.6), 0.0);
  } else if (isState(st, 12.0)) { // SETTLE (maturation)
    float s = clamp(T, 0.0, 1.0); float e = smoothstep(0.0, 1.0, s);
    P.leg = mix(vec4(0.0, 0.8, -1.3, -0.6), P.leg, e);
    P.antL.z = mix(3.0 / aL, k0, e); P.antR.z = P.antL.z;
    P.antL.y = mix(-0.4, P.antL.y, e); P.antR.y = P.antL.y;
    float sh = sin(TAU * 8.0 * uTermiteTime) * (1.0 - s) * (1.0 - s);
    P.bodyRot.z = 0.12 * sh; P.bodyRot.x = 0.05 * sh;
    P.abd.z = 1.0 + 0.04 * (1.0 - s) * sin(TAU * 6.0 * uTermiteTime);
    P.bodyOff.y = -0.3 * bh * (1.0 - e);
  } else if (isState(st, 13.0)) { // QUEEN idle + egg-laying (peristalsis + breathing are in termiteDeform)
    // v2.1: legs splayed and nearly still, each twitching briefly now and then; slow head and antennae
    if (leg >= 0.0) {
      float tw = pow(max(0.0, sin(t * 0.55 + leg * 2.39)), 24.0);
      P.leg = vec4(0.03 * sin(t * 0.6 + leg * 1.1) + 0.12 * tw * sin(t * 11.0 + leg), 0.03 + 0.24 * tw, -0.14 * tw, 0.06 * tw);
    }
    P.head = vec3(0.12 * sin(t * 0.3), 0.05 * sin(t * 0.45) - 0.02, 0.0);
    P.antL = vec3(0.12 + 0.12 * sin(t * 0.5), -0.1 + 0.06 * sin(t * 0.7 + 1.0), k0 * 1.3);
    P.antR = vec3(0.12 + 0.12 * sin(t * 0.55 + 2.1), -0.1 + 0.06 * sin(t * 0.65 + 0.4), k0 * 1.3);
    P.abd.z = 1.0;
    P.egg = clamp(T, 0.0, 1.0);
    P.abd.w = 0.18 * sin(3.14159 * P.egg);
  } else if (isState(st, 15.0)) { // HOLD: grab-and-squirt
    holdPose(P, t, seed, L, bh, hr, k0, leg, pair);
  } else if (isState(st, 14.0)) { // LUNGE: gape -> strike -> snap shut -> blends into HOLD
    float s = clamp(T, 0.0, 1.0);
    float wind = smoothstep(0.0, 0.3, s);
    float strike = smoothstep(0.26, LUNGE_SNAP, s);
    P.mand = mix(po.y, gape, wind);
    P.mand = mix(P.mand, HOLD_GRIP, smoothstep(LUNGE_SNAP - 0.07, LUNGE_SNAP, s));
    P.bodyOff.x = L * (-0.05 * wind * (1.0 - strike) + 0.17 * strike);
    P.bodyOff.y = -0.08 * bh * wind;
    P.head = vec3(0.0, hr + 0.14 * wind * (1.0 - strike) + (HOLD_PITCH * 0.8) * strike, 0.02 * L * strike);
    P.bodyRot.y = 0.05 * wind * (1.0 - strike) - 0.06 * strike;
    if (leg >= 0.0) P.leg = vec4((pair < 0.5 ? 0.3 : (pair > 1.5 ? -0.3 : 0.0)) * strike + (pair > 1.5 ? 0.08 : 0.0) * wind, 0.1 * wind, -0.08 * strike, 0.0);
    P.antL = vec3(0.4, 0.15 * (1.0 - strike) - 0.25 * strike, k0 * 0.7); P.antR = P.antL;
    Pose H = P;
    holdPose(H, t, seed, L, bh, hr, k0, leg, pair);
    P = mixPose(P, H, smoothstep(LUNGE_SNAP, LUNGE_SNAP + 0.16, s));
  } else if (isState(st, 16.0)) { // THREAT: rise on the legs, head up, mandibles gaping ("mute roar")
    float w = sin(t * 1.7);
    P.bodyOff.y = 0.2 * bh; P.bodyRot = vec3(0.06 * sin(t * 0.8), 0.16 + 0.02 * w, 0.0);
    P.head = vec3(0.14 * sin(t * 0.9), hr + 0.95 + 0.06 * sin(t * 2.3), 0.0);
    P.mand = gape * (0.88 + 0.12 * sin(t * 3.1));
    if (leg >= 0.0) P.leg = vec4(pair < 0.5 ? 0.14 : (pair > 1.5 ? -0.1 : 0.0), -0.26, 0.2, 0.0);
    P.antL = vec3(0.65 + 0.15 * sin(t * 2.2), 0.4 + 0.1 * sin(t * 3.0), k0 * 0.5);
    P.antR = vec3(0.65 + 0.15 * sin(t * 2.5 + 1.0), 0.4 + 0.1 * sin(t * 2.7 + 0.4), k0 * 0.5);
    P.abd.y = -0.06;
  } else if (isState(st, 18.0)) { // STRUGGLE: held by an enemy soldier; aAnim2.x = intensity
    float I = clamp(aAnim2.x, 0.0, 1.0);
    vec3 tg = holdTug(t * 1.1 + 2.0);
    if (leg >= 0.0) {
      vec4 fl = vec4(0.5 * sin(t * 14.0 + leg * 1.9), 0.45 + 0.35 * sin(t * 17.0 + leg * 2.3), -0.55 + 0.45 * sin(t * 15.0 + leg * 1.1), 0.3 * sin(t * 19.0 + leg));
      P.leg = mix(P.leg, fl, I);
    }
    P.bodyRot = vec3(0.22 * tg.x, 0.1 * tg.y, 0.32 * sin(t * 6.1)) * I;
    P.bodyOff.y = 0.12 * bh * I;
    P.head = vec3(0.3 * sin(t * 8.3) * I, hr + 0.25 * sin(t * 7.1) * I, 0.0);
    P.mand = po.y + 0.45 * max(0.0, sin(t * 9.0)) * I;
    P.abd.x = 0.25 * sin(t * 5.3) * I; P.abd.y = 0.15 * sin(t * 6.7) * I;
    P.antL = vec3(0.3 + 0.45 * sin(t * 11.0) * I, 0.25 * sin(t * 13.0) * I, k0 + 1.4 / aL * max(0.0, sin(t * 7.0)) * I);
    P.antR = vec3(0.3 + 0.45 * sin(t * 10.3 + 1.0) * I, 0.25 * sin(t * 12.1 + 0.5) * I, k0 + 1.4 / aL * max(0.0, sin(t * 6.4 + 1.0)) * I);
  } else if (isState(st, 19.0)) { // v2.1 ATTEND: beside the queen; aAnim2.y = head yaw toward her (rad)
    float yaw = clamp(aAnim2.y, -0.6, 0.6);
    float gp = fract(t / 7.0); // a ~1.5 s grooming bout every 7 s
    float g = smoothstep(0.0, 0.05, gp) * (1.0 - smoothstep(0.17, 0.23, gp));
    float c = TAU * t * 1.8;
    P.head = vec3(yaw + 0.05 * sin(t * 0.7), hr - 0.14 - 0.24 * g + 0.07 * g * sin(c), 0.014 * L * g * (0.5 + 0.5 * sin(c)));
    P.mand = po.y + 0.22 * g * max(0.0, sin(c * 2.0));
    P.bodyRot.y = -0.03 - 0.03 * g;
    // antennae lowered toward her and tapping constantly, alternating
    float tapL = pow(max(0.0, sin(t * 6.5)), 2.0);
    float tapR = pow(max(0.0, sin(t * 6.5 + 2.2)), 2.0);
    P.antL = vec3(0.18 + 0.08 * sin(t * 1.3), -0.3 - 0.18 * tapL, k0 * 1.6);
    P.antR = vec3(0.18 + 0.08 * sin(t * 1.6 + 1.0), -0.3 - 0.18 * tapR, k0 * 1.6);
    if (leg >= 0.0) P.leg = vec4((pair < 0.5 ? 0.08 : 0.0) + 0.02 * sin(t * 0.8 + leg), -0.03 + 0.04 * g * (pair < 0.5 ? 1.0 : 0.0), 0.0, 0.0);
  }
  return P;
}

void termiteDeform(out vec3 oP, out vec3 oN) {
  vec3 p = position;
  vec3 n = normal;
  float bone = aBone;
  float seed = aLook.w;
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 zA = vec3(0.0, 0.0, 1.0);
  float leg = -1.0; float joint = -1.0;
  if (bone > 6.5 && bone < 30.5) { float b = bone - 7.0; leg = floor(b / 4.0 + 0.01); joint = b - leg * 4.0; }

  float cyc = aAnim.y + uTermiteTime * aAnim.z;
  Pose P = evalPose(aAnim.x, cyc, aAnim.w, leg, seed);
  float k = clamp((uTermiteTime - aBlend.y) / max(aBlend.w, 1e-3), 0.0, 1.0);
  if (k < 0.999) {
    Pose Q = evalPose(aBlend.x, cyc, aBlend.z, leg, seed);
    P = mixPose(Q, P, smoothstep(0.0, 1.0, k));
  }

  // carried items: show only the selected one (others collapse to a point = no fragments)
  if (abs(bone - 31.0) < 0.5) {
    float want = abs(aMat - 6.0) < 0.5 ? 1.0 : (abs(aMat - 11.0) < 0.5 ? 3.0 : 2.0);
    if (abs(aLook.y - want) > 0.5) { oP = PIV(31); oN = n; return; }
  }
  // queen egg emerging from the abdomen tip
  if (abs(bone - 32.0) < 0.5) {
    if (P.egg < 0.02) { oP = PIV(32); oN = n; return; }
    vec3 c = PIV(32);
    float sc = mix(0.5, 1.0, smoothstep(0.0, 0.6, P.egg));
    p = c + (p - c) * sc + vec3(-0.75 * P.egg, -0.15 * P.egg * P.egg, 0.0);
  }

  // ---- legs: FK through coxa (yaw), femur, tibia, tarsus (levation/flex) ----
  if (leg >= 0.0) {
    float side = leg < 2.5 ? -1.0 : 1.0;
    int li = int(leg + 0.5);
    vec3 d = rigT(RC_LEGDIR + li).xyz;
    vec3 ax = normalize(cross(d, up));
    int jn = int(joint + 0.5);
    for (int j = 3; j >= 0; j--) {
      if (j > jn) continue;
      vec3 pv = PIV(7 + li * 4 + j);
      vec3 a = ax; float ang = P.leg.w;
      if (j == 0) { a = up; ang = P.leg.x * side; }
      else if (j == 1) { ang = P.leg.y; }
      else if (j == 2) { ang = P.leg.z; }
      p = pv + rotAxis(p - pv, a, ang);
      n = rotAxis(n, a, ang);
    }
  }

  // ---- mandibles ----
  if (abs(bone - 2.0) < 0.5 || abs(bone - 3.0) < 0.5) {
    float sgn = abs(bone - 2.0) < 0.5 ? 1.0 : -1.0;
    vec3 pv = PIV(int(bone + 0.5));
    vec3 mAx = rigT(RC_MANDAX).xyz; // hinge axis of the LEFT mandible (up for chewing mandibles, oblique for sickles)
    mAx.z *= sgn;                   // mirrored for the right mandible (rotation angle is mirrored too)
    p = pv + rotAxis(p - pv, mAx, P.mand * sgn);
    n = rotAxis(n, mAx, P.mand * sgn);
  }

  // ---- antennae: constant-curvature bend + sweep about the socket ----
  if (abs(bone - 4.0) < 0.5 || abs(bone - 5.0) < 0.5) {
    int ai = abs(bone - 4.0) < 0.5 ? 0 : 1;
    float sideA = ai == 0 ? -1.0 : 1.0;
    vec3 A = ai == 0 ? P.antL : P.antR;
    vec3 b = rigT(RC_ANTBASE + ai).xyz;
    vec3 d = rigT(RC_ANTDIR + ai).xyz;
    float sC = aBT;
    vec3 c0 = b + d * sC;
    vec3 o = p - c0;
    vec3 e2 = normalize(-up + d * dot(up, d));
    vec3 e3 = normalize(cross(d, e2));
    float kap = A.z;
    float ang = kap * sC;
    vec3 cpos = abs(kap) < 1e-4 ? c0 : b + d * (sin(ang) / kap) + e2 * ((1.0 - cos(ang)) / kap);
    p = cpos + rotAxis(o, e3, ang);
    n = rotAxis(n, e3, ang);
    vec3 dH = normalize(vec3(d.x, 0.0, d.z));
    vec3 axp = normalize(cross(dH, up));
    p = b + rotAxis(p - b, axp, A.y); n = rotAxis(n, axp, A.y);
    p = b + rotAxis(p - b, up, A.x * (-sideA)); n = rotAxis(n, up, A.x * (-sideA));
  }

  // ---- head group (head, mandibles, antennae, carried item) ----
  if ((bone > 0.5 && bone < 5.5) || abs(bone - 31.0) < 0.5) {
    vec3 nk = PIV(1);
    p = nk + rotAxis(p - nk, zA, P.head.y); n = rotAxis(n, zA, P.head.y);
    p = nk + rotAxis(p - nk, up, P.head.x); n = rotAxis(n, up, P.head.x);
    vec3 fwd = rotAxis(rotAxis(vec3(1.0, 0.0, 0.0), zA, P.head.y), up, P.head.x);
    p += fwd * P.head.z;
  }

  // ---- abdomen: radial scale (breathing / peristalsis / deflate), then bend ----
  if (abs(bone - 6.0) < 0.5 || abs(bone - 32.0) < 0.5) {
    bool isAbd = abs(bone - 6.0) < 0.5;
    float tt = isAbd ? aBT : 1.0;
    if (isAbd) {
      vec3 abA = rigT(RC_ABD_A).xyz; vec3 abB = rigT(RC_ABD_B).xyz;
      vec3 axA = normalize(abB - abA);
      vec3 proj = abA + axA * dot(p - abA, axA);
      vec3 r = p - proj;
      float sc = P.abd.z;
      bool queen = rigT(RC_RIG_A).z > 0.5;
      if (queen) {
        // v2.1: a slow peristaltic wave rolls front -> back every QA_PERIOD s; as it passes, the rolls narrow
        // and the pleats squeeze (creases deepen), then relax; each roll also breathes gently
        float w = qW(tt);
        float cr = qCrease(w);
        float wc = fract(uTermiteTime / QA_PERIOD + seed) * 1.5 - 0.25;
        float pulse = exp(-pow((tt - wc) / 0.1, 2.0));
        float mask = smoothstep(0.04, 0.14, tt) * (1.0 - smoothstep(0.9, 1.0, tt));
        float pleat = rigT(RC_QUEEN0).w;
        sc *= 1.0 - mask * pulse * (0.035 + 0.6 * pleat * cr);
        sc *= 1.0 + mask * (0.012 * sin(uTermiteTime * 1.4 + seed * 6.0) + 0.008 * sin(uTermiteTime * 2.3 - w * 0.9));
      }
      sc *= 1.0 - P.abd.w * smoothstep(0.78, 1.0, tt);
      if (queen) { p.z *= sc; p.y *= sc; } // about the ground line: the heavy belly stays down
      else p = proj + r * sc;
    }
    vec3 pv = PIV(6);
    p = pv + rotAxis(p - pv, zA, P.abd.y * tt); n = rotAxis(n, zA, P.abd.y * tt);
    p = pv + rotAxis(p - pv, up, P.abd.x * tt); n = rotAxis(n, up, P.abd.x * tt);
  }

  // ---- larva: travelling lateral wave through the whole body ----
  if (P.bend > 0.0) {
    float L = rigT(RC_RIG_A).x;
    float ph = TAU * (p.x / L * 0.9) - uTermiteTime * 2.2 - seed * 5.0;
    p.z += P.bend * sin(ph);
    n = rotAxis(n, up, -atan(P.bend * cos(ph) * TAU * 0.9 / L));
  }

  // ---- whole body ----
  vec3 bp = PIV(0);
  p = bp + rotAxis(p - bp, vec3(1.0, 0.0, 0.0), P.bodyRot.z); n = rotAxis(n, vec3(1.0, 0.0, 0.0), P.bodyRot.z);
  p = bp + rotAxis(p - bp, zA, P.bodyRot.y); n = rotAxis(n, zA, P.bodyRot.y);
  p = bp + rotAxis(p - bp, up, P.bodyRot.x); n = rotAxis(n, up, P.bodyRot.x);
  p += P.bodyOff;
  oP = p;
  oN = normalize(n);
}

void termiteVaryings() {
  float tan_ = isState(aAnim.x, 12.0) ? max(aLook.x, clamp(aAnim.w, 0.0, 1.0)) : aLook.x;
  vA = vec4(aMat, aBone, aBT, tan_);
  vRestN = normal; vRestP = position; vLook = aLook; vTint = aTint; vCaste = aCaste; vFx = aFx;
}
`;

/** replaces <beginnormal_vertex> in MeshPhysicalMaterial */
export const TERMITE_BEGINNORMAL = /* glsl */ `
  vec3 _tP; vec3 objectNormal;
  termiteDeform(_tP, objectNormal);
  termiteVaryings();
  #ifdef GLUE_SHELL
    if (max(aLook.z, aFx.x) < 0.01) { _tP = PIV(0); }
    else { _tP += objectNormal * rigT(RC_RIG_B).w * (0.35 + 0.65 * max(aLook.z, 0.3 * aFx.x)); }
  #endif
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`;
export const TERMITE_BEGIN = /* glsl */ `
  vec3 transformed = _tP;
`;
/** for MeshDepthMaterial (no beginnormal chunk) */
export const TERMITE_BEGIN_DEPTH = /* glsl */ `
  vec3 transformed; vec3 _tN;
  termiteDeform(transformed, _tN);
`;

export const TERMITE_FRAGMENT_PARS = /* glsl */ `
${RIG_DEFINES}
uniform float uTermiteTime;
uniform highp sampler2D uRigTex;
uniform vec3 uPale;
uniform vec3 uGlueColor;
uniform vec3 uAcidColor;
uniform vec3 uAcidHot;
varying vec4 vA;
varying vec4 vFx;
varying vec3 vRestN;
varying vec3 vRestP;
varying vec4 vLook;
varying vec3 vTint;
flat varying float vCaste;
vec4 rigF(int col) { return texelFetch(uRigTex, ivec2(col, int(vCaste + 0.5)), 0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
${NOISE_GLSL}
${QUEEN_GLSL}
// v2.1: bump the shading normal with a height field h given in rest-space mm (surface-gradient bump mapping;
// rest units -> view units via screen derivatives, so it needs no UVs or tangents)
vec3 tBump(vec3 nrm, float h) {
  vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
  float k = length(dpdx) / max(length(dFdx(vRestP)), 1e-6);
  float hx = dFdx(h) * k; float hy = dFdy(h) * k;
  vec3 r1 = cross(dpdy, nrm); vec3 r2 = cross(nrm, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  vec3 n2 = normalize(abs(det) * nrm - grad);
  vec3 V = normalize(vViewPosition);
  float dv = dot(n2, V);
  return dv < 0.08 ? normalize(n2 + V * (0.08 - dv)) : n2; // never tilt past the silhouette
}
`;

/** injected after <emissivemap_fragment>: normal, vViewPosition, roughnessFactor, totalEmissiveRadiance in scope */
export const TERMITE_SURFACE = /* glsl */ `
float tCoat = 0.0;
float tSheen = 0.0;
#ifdef GLUE_SHELL
if (vFx.x > 0.01) {
  // v2: acid droplets beading on the cuticle, a thin wet film, fizzing bubbles (glue strands on top if any)
  float ac = vFx.x; float fz = vFx.y;
  vec2 c1 = tCell(vRestP * 9.0);
  float rad = mix(0.14, 0.42, ac) * (0.6 + 0.4 * c1.y);
  float bead = 1.0 - smoothstep(rad * 0.65, rad, c1.x);
  vec2 c2 = tCell(vRestP * 26.0 + vec3(0.0, uTermiteTime * 0.9, 0.0));
  float blink = step(1.0 - 0.55 * fz, c2.y) * (0.5 + 0.5 * sin(uTermiteTime * 23.0 + c2.y * 60.0));
  float spark = (1.0 - smoothstep(0.03, 0.12, c2.x)) * blink;
  float film = 0.04 + 0.06 * ac;
  float g = vLook.z;
  float n1 = tNoise(vRestP * vec3(3.0, 11.0, 3.0) + vec3(0.0, uTermiteTime * 0.05, 0.0));
  float n2 = tNoise(vRestP * vec3(9.0, 2.5, 7.0) + 3.1);
  float strands = smoothstep(0.55, 0.78, max(n1, n2));
  float aG = g * (0.18 + 0.82 * strands) * 0.8;
  float aA = max(bead * (0.5 + 0.4 * ac), film * ac) + spark * 0.55;
  float a = max(aG, aA);
  if (a < 0.02) discard;
  // glossy domes: bump the normal with the bead height (scale-free: rest units -> view units via derivatives)
  {
    float hgt = bead * sqrt(max(0.0, 1.0 - (c1.x / rad) * (c1.x / rad)));
    vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
    float k = length(dpdx) / max(length(dFdx(vRestP)), 1e-6) * 0.045;
    float hx = dFdx(hgt) * k; float hy = dFdy(hgt) * k;
    vec3 r1 = cross(dpdy, normal); vec3 r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (hx * r1 + hy * r2);
    normal = normalize(abs(det) * normal - grad);
  }
  vec3 acol = mix(uAcidColor, uAcidHot, 0.25 + 0.5 * ac);
  diffuseColor = vec4(mix(acol, uGlueColor, aG / max(a, 1e-3)), a);
  roughnessFactor = 0.04;
  tCoat = 1.0;
  totalEmissiveRadiance += acol * (0.04 + 0.22 * ac * ac) * bead + vec3(1.0, 0.95, 0.8) * spark * 0.6 + uGlueColor * (0.05 + 0.25 * g * g) * strands * step(0.01, g);
} else {
  float g = vLook.z;
  float n1 = tNoise(vRestP * vec3(3.0, 11.0, 3.0) + vec3(0.0, uTermiteTime * 0.05, 0.0));
  float n2 = tNoise(vRestP * vec3(9.0, 2.5, 7.0) + 3.1);
  float strands = smoothstep(0.55, 0.78, max(n1, n2));
  float a = g * (0.18 + 0.82 * strands) * 0.8;
  if (a < 0.02) discard;
  diffuseColor = vec4(uGlueColor, a);
  roughnessFactor = 0.06;
  tCoat = 1.0;
  totalEmissiveRadiance += uGlueColor * (0.05 + 0.25 * g * g) * strands;
}
#else
{
  float m = floor(vA.x + 0.5);
  float bone = vA.y;
  float bt = vA.z;
  vec4 skin = rigF(RC_SKIN); // translucency, gut, headCoat, kind
  vec3 col = diffuseColor.rgb;
  vec3 V = normalize(vViewPosition);
  float ndv = clamp(abs(dot(normal, V)), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.0);
  bool cut = (m < 1.5) || (m > 7.5 && m < 10.5); // cuticle incl. mandibles, nasus, sickles (not leaf)
  float tanK = clamp(vA.w, 0.0, 1.0);
  if (cut) col *= vTint;
  if (cut) col = mix(uPale, col, tanK);
  col *= 0.96 + 0.08 * fract(vLook.w * 7.31); // per-instance subtle variation

  bool abd = abs(bone - 6.0) < 0.5;
  float plateGloss = 0.0;
  if (abd && m < 1.5) {
    // tergites darker toward their rear margin, light translucent bands between segments
    float u = fract(bt * 10.0);
    float dorsal = smoothstep(-0.55, 0.15, vRestN.y);
    vec3 terg = mix(uPale, rigF(RC_TERGITE).rgb * vTint, tanK);
    vec3 inter = mix(uPale, rigF(RC_INTER).rgb * vTint, tanK);
    float band = smoothstep(0.2, 0.92, u);
    col = mix(col, terg * 0.92, band * (0.95 * dorsal + 0.35 * (1.0 - dorsal)));
    float im = max(1.0 - smoothstep(0.0, 0.12, u), smoothstep(0.965, 1.0, u));
    col = mix(col, inter, im * 0.85 * step(0.04, bt));
    // gut contents: soft dark patch seen through the skin
    // blob centred a little behind mid-abdomen, seen best on the back and sides
    vec4 gut = rigF(RC_GUT); // rgb + spread
    float gm = skin.y * exp(-pow((bt - 0.55) / max(gut.w, 0.05), 2.0)) * smoothstep(-0.7, 0.35, vRestN.y);
    gm *= (0.55 + 0.45 * tNoise(vRestP * 3.0 + 1.7)) * mix(0.45, 1.0, ndv); // mottled, paler toward the translucent rim
    col = mix(col, rigF(RC_GUT).rgb, smoothstep(0.05, 0.75, gm) * mix(0.55, 0.92, tanK));
  }
  if (abd && (abs(m - 2.0) < 0.5 || abs(m - 12.0) < 0.5)) {
    // v2.1 physogastric queen: glossy, wet, translucent membrane coloured by age (ivory -> amber -> honey),
    // darker in the creases, faint gut deep inside; small dark tergite bars on top of each roll just behind the
    // crease, smaller paler sternites below, a spiracle dot on each side of each roll
    vec4 q0 = rigF(RC_QUEEN0); // default age, plate frac front, plate frac rear, pleat
    vec4 ai = rigF(RC_ABD_INFO); // xA0, length, half-width, half-height
    float age = vFx.z > 0.5 ? clamp(vFx.z - 1.0, 0.0, 1.0) : q0.x;
    vec3 base = age < 0.5 ? mix(rigF(RC_QIVORY).rgb, rigF(RC_QAMBER).rgb, age * 2.0) : mix(rigF(RC_QAMBER).rgb, rigF(RC_QHONEY).rgb, age * 2.0 - 1.0);
    base = pow(base, vec3(1.35)); // the palette is the colour as seen under bright light: deepen the albedo
    float u = bt;
    float w = qW(u);
    float cr = qCrease(w);
    float kk = floor(w + 0.5);
    float d = w - kk;
    vec2 nyz = normalize(vRestN.yz + vec2(1e-5, 0.0)); // (up, side) direction around the body axis
    float side = abs(nyz.y);
    float mott = tNoise(vRestP * 1.1) * 0.5 + tNoise(vRestP * 2.9) * 0.5;
    col = base * (0.93 + 0.1 * mott);
    col *= mix(vec3(0.9, 0.8, 0.68), vec3(1.04, 1.02, 0.96), rim); // deeper face-on, lighter where the wall thins
    // LOD2 (smooth mesh): draw the pleats as a bump; all LODs: fine wrinkles in the deepest creases
    float rr = ai.z * (1.0 - 0.2 * smoothstep(0.4, 1.0, u));
    float hgt = 0.0;
    if (m > 11.5) hgt -= 0.6 * q0.w * cr * (0.35 + 0.65 * pow(side, 1.4)) * rr;
    float ang = atan(nyz.y, nyz.x);
    hgt += 0.018 * cr * cr * cr * sin(ang * 46.0 + 4.0 * tNoise(vRestP * 3.0)) * smoothstep(0.3, 0.8, side);
    normal = tBump(normal, hgt);
    // creases darker and warmer; faint darker gut deep inside, seen face-on through the wall
    col = mix(col, col * vec3(0.5, 0.36, 0.24), cr * cr * (0.45 + 0.45 * side));
    float gutA = smoothstep(0.08, 0.3, u) * (1.0 - smoothstep(0.7, 0.95, u)) * ndv * ndv * (0.10 + 0.06 * tNoise(vRestP * 0.8 + 2.0));
    col = mix(col, col * vec3(0.55, 0.42, 0.3), gutA);
    // tergite bars on top
    float kn = clamp(kk / (QA_SEGS - 1.0), 0.0, 1.0);
    float hp = mix(q0.y, q0.z, kn) * rr;
    float lat = 1.0 - smoothstep(0.45 * hp, hp, abs(vRestP.z) + 0.15 * hp * (tNoise(vRestP * 9.0) - 0.5));
    float along = (kk > 0.5 && kk < QA_SEGS - 0.5) ? smoothstep(0.0, 0.07, d) * (1.0 - smoothstep(0.2, 0.36, d)) : 0.0;
    along = max(along, smoothstep(0.42, 0.47, w) * (1.0 - smoothstep(0.6, 0.66, w))); // the front roll's own plate
    float plate = along * lat * smoothstep(0.2, 0.5, nyz.x);
    col = mix(col, rigF(RC_TERGITE).rgb * (0.85 + 0.2 * mott), plate * 0.95);
    // sternites below (smaller, paler)
    float sl = 1.0 - smoothstep(0.6 * 0.6 * hp, 0.6 * hp, abs(vRestP.z));
    float salong = (kk > 0.5 && kk < QA_SEGS - 0.5) ? smoothstep(0.05, 0.08, d) * (1.0 - smoothstep(0.15, 0.19, d)) : 0.0;
    float stern = salong * sl * smoothstep(0.5, 0.75, -nyz.x);
    col = mix(col, rigF(RC_INTER).rgb, stern * 0.75);
    // spiracles: one small dark dot on each side of each roll
    float sang = atan(nyz.x, side); // 0 at the side, + above
    float sp = (kk < QA_SEGS - 0.5 && d > 0.0) ? 1.0 - smoothstep(0.5, 1.0, length(vec2((d - 0.3) / 0.035, (sang - 0.2) / 0.055))) : 0.0;
    col = mix(col, vec3(0.13, 0.07, 0.035), sp * 0.7);
    plateGloss = 0.5 * max(plate, stern);
  }
  // v2.1 royals' compound eyes: dark, with a subtle facet texture (tiny lenses)
  if (m > 2.5 && m < 3.5) {
    vec2 fc = tCell(vRestP * 38.0);
    float lens = 1.0 - smoothstep(0.0, 0.5, fc.x);
    col *= 0.8 + 0.5 * lens;
    normal = tBump(normal, 0.004 * lens * lens);
  }
  // soldier head: glossy, lighter and translucent toward the edges and the nasus tip
  if (m > 8.5 && m < 9.5) {
    col = mix(col, mix(uPale, rigF(RC_HEADRIM).rgb, tanK), rim * 0.5);
    if (bt > 0.985) col *= 0.35;
  }
  // worker head: pale Y-shaped epicranial suture
  // v2.2: HEAD1.z = suture contrast (0 none .. 1 full), HEAD1.w = fontanelle radius (either may be set alone)
  if (abs(bone - 1.0) < 0.5 && m < 1.5 && (rigF(RC_HEAD1).z > 0.01 || rigF(RC_HEAD1).w > 0.0)) {
    vec4 h0 = rigF(RC_HEAD0); vec4 h1 = rigF(RC_HEAD1);
    vec2 q = vec2((vRestP.x - h0.x) / h0.w, vRestP.z / h1.x);
    if (h1.z > 0.01) {
      float d = min(sdSeg(q, vec2(-1.0, 0.0), vec2(0.08, 0.0)), min(sdSeg(q, vec2(0.08, 0.0), vec2(0.62, 0.5)), sdSeg(q, vec2(0.08, 0.0), vec2(0.62, -0.5))));
      float line = (1.0 - smoothstep(0.014, 0.035, d)) * smoothstep(0.35, 0.7, vRestN.y);
      col = mix(col, rigF(RC_SUTURE).rgb, line * 0.85 * min(h1.z, 1.0));
    }
    // v2: conspicuous whitish fontanelle on the frons (Rhynchotermes worker)
    if (h1.w > 0.0) {
      vec2 fq = vec2((q.x - 0.16) * 1.2, q.y); // at the fork of the Y suture
      float fo = (1.0 - smoothstep(h1.w * 0.75, h1.w, length(fq))) * smoothstep(0.2, 0.55, vRestN.y);
      col = mix(col, rigF(RC_SUTURE).rgb * 1.04, fo * 0.9);
    }
  }
  // v2: carried leaf-litter fragment: mottled, faint veins
  if (abs(m - 11.0) < 0.5) {
    float v = tNoise(vRestP * 14.0);
    float vein = 1.0 - smoothstep(0.0, 0.06, abs(fract(vRestP.x * 3.2 + vRestP.z * 1.7) - 0.5));
    col *= (0.8 + 0.35 * v) * (1.0 - 0.18 * vein);
  }
  diffuseColor.rgb = col;

  float rgh = 0.5;
  if (m < 0.5) rgh = 0.4;
  else if (m < 1.5) rgh = 0.52;
  else if (m < 2.5) rgh = 0.2; // v2.1: wet, glossy queen membrane
  else if (m < 3.5) rgh = 0.3; // v2.1: faceted eye (lens bumps carry the sparkle)
  else if (m < 4.5) rgh = 0.2;
  else if (m < 5.5) rgh = 0.6;
  else if (m < 6.5) rgh = 0.85;
  else if (m < 7.5) rgh = 0.25;
  else if (m < 8.5) rgh = 0.35;
  else if (m < 9.5) rgh = 0.24;
  else if (m < 10.5) rgh = 0.2;
  else if (m < 11.5) rgh = 0.78;
  else rgh = 0.2; // 12: queen membrane at LOD1/2
  roughnessFactor = mix(rgh, 0.4, plateGloss);
  if (m > 8.5 && m < 9.5) tCoat = skin.z;
  else if (m > 9.5 && m < 10.5) tCoat = 0.95;
  else if (abs(m - 11.0) < 0.5) tCoat = 0.0;
  else if (m > 11.5) tCoat = 0.9;
  else if (m < 0.5 && abs(bone - 1.0) < 0.5) tCoat = skin.z * 0.6;
  else if (m > 2.5 && m < 3.5) tCoat = 0.6;
  else if (m > 6.5 && m < 7.5) tCoat = 0.6;
  else if (m > 1.5 && m < 2.5) tCoat = 0.9;
  else if (abs(bone - 1.0) < 0.5) tCoat = skin.z * 0.5;

  tSheen = (m > 0.5 && m < 1.5) ? 1.0 : 0.0; // waxy satin sheen on soft cuticle only
  // waxy translucent soft tissue: rim glow, light wrap and back-lit transmission
  float tr = ((m > 0.5 && m < 2.5) || (m > 6.5 && m < 7.5) || m > 11.5) ? skin.x : (m > 8.5 && m < 9.5 ? 0.25 : (m > 9.5 && m < 10.5 ? 0.1 : (m > 10.5 ? 0.18 : 0.0)));
  // queens: light scattered through the thick membrane comes out deeper and more saturated
  vec3 sssC = (m > 1.5 && m < 2.5) || m > 11.5 ? col * col * 1.5 : col;
  totalEmissiveRadiance += sssC * tr * (0.22 * rim + 0.02) * (1.0 - plateGloss);
  #if NUM_DIR_LIGHTS > 0
  {
    vec3 Ld = directionalLights[0].direction;
    vec3 Lc = directionalLights[0].color;
    float ndl = dot(normal, Ld);
    float wrap = max(0.0, (ndl + 0.6) / 1.6) - max(0.0, ndl);
    float back = pow(clamp(dot(V, -Ld), 0.0, 1.0), 3.0) * (0.35 + 0.65 * rim);
    totalEmissiveRadiance += sssC * Lc * RECIPROCAL_PI * tr * (0.5 * wrap + 0.9 * back) * (1.0 - plateGloss);
  }
  #endif
}
#endif
`;

/** injected after <lights_physical_fragment>: per-fragment clearcoat */
export const TERMITE_CLEARCOAT = /* glsl */ `
#ifdef USE_CLEARCOAT
  material.clearcoat = tCoat;
  material.clearcoatRoughness = 0.06;
#endif
#ifdef USE_SHEEN
  material.sheenColor *= tSheen;
#endif
`;
