import * as THREE from 'three';
import { addPatch, patchDapple, NOISE_GLSL, ShaderPatch, globalUniforms } from '../shaderPatch';
import { AntRig } from './antGeometry';
import { GLUE_COLOR } from '../termite/castes';
import { TERMANT } from '../../sim/balance';
import { bakeDetail } from '../bake/detailBake';
import { detailPatch } from '../bake/detailShading';
import { antRecipe } from '../bake/recipes';
import { creatureLightPatch, useCreatureEnv } from '../lightPresets';
import { animV2 } from './antMotion';
import { MORPHS } from './morphs';

/**
 * GPU skeletal animation for instanced ants.
 *
 * Per-instance attributes (all vec4):
 *   aA: gait phase (cycles), stride amplitude 0..1, head yaw, head pitch
 *   aB: mandible open 0..1, antenna spread -1..1, antenna pitch -1..1, antenna wave phase
 *   aC: gaster pitch (+ raise / − curl under), crop swell, pose id + 0.99 × pose weight, hit flash 0..1
 *   aD: death curl 0..1, stance sweep (mm, planted feet), colour variation -1..1 (+ 4 × Termant tint code: 1 stolen caste), pose phase
 *   aE: Saiy-Ants gold 0..1 × ripple direction ±1, turn per stance (rad, planted feet), exhausted 0..1, hair sway
 * Pose ids: 0 none, 1 groom antennae, 2 groom legs, 3 trophallaxis, 4 sting,
 *           5 acid spray, 6 dig, 7 grapple/brace, 8 alarm, 9 carry,
 *           army ants (render-only, chosen in game/antViews.ts from sim state): 10 porter (load under the body),
 *           11 Soldier on guard (fore legs raised, body pitched up), 12 living-bridge link, 13 pothole plug.
 */
export const POSE = { NONE: 0, GROOM_ANT: 1, GROOM_LEGS: 2, TROPH: 3, STING: 4, SPRAY: 5, DIG: 6, GRAPPLE: 7, ALARM: 8, CARRY: 9, PORTER: 10, GUARD: 11, BRIDGE: 12, PLUG: 13 } as const;

/**
 * Termants (render only): a stolen caste's ants are tinted faintly amber (`TERMANT.stolenTint`). `code` is the
 * decoded tint code (0 none, 1 stolen caste).
 */
export function TINT_GLSL(code: string): string {
  const k = TERMANT.stolenTint.toFixed(3);
  return `if (${code} > 0.5 && ${code} < 1.5) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 0.95, 0.7) + vec3(0.05, 0.026, 0.004), ${k});`;
}

const ANIM_HEADER = /* glsl */ `
attribute float aPart;
attribute vec4 aSurf;
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec4 aD;
attribute vec4 aE; // Saiy-Ants: gold 0..1, ripple dir ±1, exhausted 0..1, hair sway −1..1
varying vec4 vGold;
uniform float uMandVert; uniform float uMandSwing; uniform float uMandOpen; uniform vec3 uCrest;
uniform vec3 uLegCoxa[6]; uniform vec3 uLegKnee[6]; uniform vec3 uLegAnkle[6]; uniform vec3 uLegAxis[6]; uniform vec3 uLegFoot[6]; uniform vec3 uLegHome[6];
uniform float uPlant; // animation pass: feet planted by an analytic IK (pilot species)
// spec 04: the body's offset from its ground frame, per instance (3 texels at (id % 128) × 3, id / 128):
//   0: translation (object units), lateral stance sweep · 1: rotation vector, stance spread
//   2: gaster yaw, sting out, fore legs raised, decapitation · 3: corpse drying (gloss fades), crushed flat
// The planted feet are solved in the body frame against targets fixed in the ground frame, so the body lunges,
// rises, leans and twists over feet that stay where they are.
uniform sampler2D uBodyTex; uniform float uBodyOn;
varying float vDry;
uniform float uRealV; // realism morphs (the sting rests retracted)
varying float vHit;
uniform vec3 uNeck; uniform vec3 uMandL; uniform vec3 uMandR; uniform vec3 uAntL; uniform vec3 uAntR;
uniform vec3 uElbL; uniform vec3 uElbR; uniform vec3 uGasterPivot; uniform vec3 uWaistPivot;
uniform vec4 uGait; // q0, lift, duty, body length
uniform float uPhyso; // physogastric gaster (army-ant queen): swell grows it far more than a full crop
uniform float uSoft; // soft termite-like abdomen (Termants): jiggle and sway with the stride
varying vec4 vSurf; varying vec3 vLocal; varying float vColorVar; varying float vTint;
varying float vPartF;
const float APIM = 3.14159265;
vec3 rotA(vec3 v, vec3 a, float ang){ float c=cos(ang), s=sin(ang); return v*c + cross(a,v)*s + a*dot(a,v)*(1.0-c); }
void rotP(inout vec3 p, inout vec3 n, vec3 piv, vec3 a, float ang){ p = piv + rotA(p - piv, a, ang); n = rotA(n, a, ang); }
float wrapA(float x){ return x - 6.2831853 * floor((x + 3.14159265) / 6.2831853); }
`;

const ANIM_BODY = /* glsl */ `
vec3 animP = position;
{
  vec3 N = objectNormal;
  int part = int(aPart + 0.5);
  float phase = aA.x, amp = aA.y, hYaw = aA.z, hPitch = aA.w;
  float mOpen = aB.x, aSpread = aB.y, aPitchI = aB.z, aWave = aB.w;
  // aC.z packs the pose id and its weight (id + 0.99 × weight); aC.w is the hit flash
  float gPitch = aC.x, swell = aC.y; float pzI = floor(aC.z + 0.0005); int pose = int(pzI); float poseW = clamp((aC.z - pzI) / 0.99, 0.0, 1.0);
  float death = aD.x, pph = aD.w;
  vec4 bT0 = vec4(0.0), bT1 = vec4(0.0), bT2 = vec4(0.0), bT3 = vec4(0.0);
  if (uBodyOn > 0.5) {
    ivec2 bc = ivec2((gl_InstanceID % 128) * 4, gl_InstanceID / 128);
    bT0 = texelFetch(uBodyTex, bc, 0);
    bT1 = texelFetch(uBodyTex, bc + ivec2(1, 0), 0);
    bT2 = texelFetch(uBodyTex, bc + ivec2(2, 0), 0);
    bT3 = texelFetch(uBodyTex, bc + ivec2(3, 0), 0);
  }
  vDry = bT3.x;
  float bAng = length(bT1.xyz);
  vec3 bAx = bAng > 1e-5 ? bT1.xyz / bAng : vec3(0.0, 1.0, 0.0);
  // aE.x packs the gold amount and the ripple direction in its sign; aE.y is the turn per stance (planted feet)
  float goldA = abs(aE.x), exh = aE.z;
  vGold = vec4(goldA, aE.x < 0.0 ? -1.0 : 1.0, aE.z, aE.w);
  vHit = aC.w;
  // body bob at twice the stride frequency (the planted feet allow for it)
  float bob = amp * uGait.w * 0.006 * cos(phase * 12.566);
  // spec 04 (planted-feet species): the threat display (alarm: gaster flagged, user rating A11) and the sting
  // (A4) plant the feet wider and lift the body on straightened legs; the feet stay on the ground
  float stanceW = uPlant > 0.5 && pose == 8 ? poseW : 0.0;
  // (crushed: pressed down onto the ground over its planted feet)
  float bodyUp = stanceW * uGait.w * 0.06 - bT3.y * uGait.w * 0.08;
  vec3 UP = vec3(0.0, 1.0, 0.0);
  vec3 RIGHT = vec3(0.0, 0.0, 1.0);
  vSurf = aSurf; vLocal = position / uGait.w; vTint = floor((aD.z + 2.0) / 4.0); vColorVar = aD.z - 4.0 * vTint;
  vPartF = aPart;

  if (part == 30) {
    // Saiy-Ant hair locks: stretch ~30 % backward in gold (never rising), flutter with the stride,
    // droop flatter when exhausted, then follow the head.
    float dx = animP.x - uCrest.x;
    float reach = clamp(-dx / max(uGait.w * 0.08, 1e-4), 0.0, 1.0);
    if (dx < 0.0) animP.x = uCrest.x + dx * (1.0 + 0.3 * goldA);
    float flutter = amp * 0.035 * sin(phase * 12.566 - 1.2) * reach;
    rotP(animP, N, uCrest, RIGHT, exh * 0.1 + flutter);
    rotP(animP, N, uCrest, UP, aE.w * 0.06 * (0.35 + 0.65 * reach)); // sway: the tips lag the turn
    rotP(animP, N, uNeck, RIGHT, hPitch - death * 0.3);
    rotP(animP, N, uNeck, UP, hYaw);
  } else if (part >= 10) {
    int li = (part - 10) / 3;
    int seg = part - 10 - li * 3;
    float side = (li - (li / 2) * 2 == 0) ? -1.0 : 1.0;
    int pair = li / 2;
    bool gB = (li == 1 || li == 2 || li == 5);
    float ph = fract(phase + (gB ? 0.5 : 0.0));
    float duty = uGait.z;
    float pro, lift;
    if (ph < duty) { pro = mix(1.0, -1.0, ph / duty); lift = 0.0; }
    else { float t = (ph - duty) / (1.0 - duty); pro = mix(-1.0, 1.0, 0.5 - 0.5 * cos(t * APIM)); lift = sin(t * APIM); }
    // Hind legs sweep more, front legs less (real ant kinematics).
    float pairAmp = pair == 0 ? 0.85 : (pair == 1 ? 1.0 : 1.1);
    float yaw = pro * uGait.x * amp * side * pairAmp;
    float lft = lift * uGait.y * amp;
    float knee = -lift * 0.42 * amp;
    float ankleF = lift * 0.3 * amp;
    if (uPlant > 0.5) {
      // animation pass: the foot stays where it touched down. Its target on the ground moves back under the body
      // by the stance sweep (aD.y, mm) and round the body's centre by the turn (aE.y, rad) while planted, and
      // swings forward lifted; the leg reaches it by yaw at the coxa and a two-bone solve in its own plane.
      // (spec 04: in the threat display and the sting the feet plant wider and the body rises on them)
      vec3 C = uLegCoxa[li]; vec3 K = uLegKnee[li]; vec3 F0 = uLegFoot[li]; vec3 NH = uLegHome[li];
      float spr = stanceW + bT1.w;
      vec3 tg = rotA(vec3(NH.x * (1.0 + 0.12 * spr), 0.0, NH.z * (1.0 + 0.3 * spr)), UP, -pro * aE.y) + vec3(pro * aD.y, 0.0, pro * bT0.w);
      // the ground point at the foot's rest height, into the body frame (the body moved by bT0/bT1 over it)
      tg = rotA(vec3(tg.x, F0.y, tg.z) - bT0.xyz, bAx, -bAng);
      vec2 r0 = F0.xz - C.xz;
      vec2 r1 = tg.xz - C.xz;
      yaw = wrapA(atan(r0.y, r0.x) - atan(r1.y, r1.x));
      vec2 o = normalize(r0);
      vec2 kk = vec2(dot(K.xz - C.xz, o), K.y - C.y);
      vec2 ff = vec2(length(r0), F0.y - C.y);
      float la = length(kk);
      float lb = length(ff - kk);
      vec2 tt = vec2(length(r1), tg.y - C.y + lift * uGait.y * amp * length(r0) * 0.75 - bob - bodyUp);
      float Dd = clamp(length(tt), abs(la - lb) + 1e-4, (la + lb) * 0.999);
      float al = acos(clamp((la * la + Dd * Dd - lb * lb) / (2.0 * la * Dd), -1.0, 1.0));
      float sK = (ff.x * kk.y - ff.y * kk.x) >= 0.0 ? 1.0 : -1.0;
      float pA1 = atan(tt.y, tt.x) + sK * al;
      vec2 K1 = la * vec2(cos(pA1), sin(pA1));
      float pB1 = atan(tt.y - K1.y, tt.x - K1.x);
      lft = wrapA(pA1 - atan(kk.y, kk.x));
      knee = wrapA(pB1 - atan(ff.y - kk.y, ff.x - kk.x) - lft);
      ankleF = lift * 0.3 * amp;
      // fore legs raised off the ground (rearing, a high sting): up and out, the tibiae angled down and forward
      if (pair == 0 && bT2.z > 0.0) {
        yaw = mix(yaw, side * 0.62, bT2.z);
        lft = mix(lft, 0.78, bT2.z);
        knee = mix(knee, -1.15, bT2.z);
        ankleF = mix(ankleF, 0.45, bT2.z);
      }
    }

    if (pose == 1 && pair == 0) {
      // Antenna grooming: the fore leg on the grooming side rises to the head
      // and strokes the antenna through the strigil.
      float gs = fract(pph * 0.25) < 0.5 ? -1.0 : 1.0;
      if (side == gs) {
        float stroke = sin(pph * 6.2831);
        // (planted-feet species: the leg comes up beside the head, not through it — user rating A1: the femur
        // swung in front of the face; the tibia folds back so the strigil meets the antenna at the side)
        bool pl = uPlant > 0.5;
        yaw = mix(yaw, side * ((pl ? 0.72 : 1.05) + (pl ? 0.1 : 0.18) * stroke), poseW);
        lft = mix(lft, (pl ? 0.9 : 1.05) + (pl ? 0.14 : 0.2) * stroke, poseW);
        knee = mix(knee, (pl ? -1.85 : -1.5) + 0.25 * stroke, poseW);
        ankleF = mix(ankleF, 0.7, poseW);
      } else {
        yaw = mix(yaw, side * 0.15, poseW);
      }
    } else if (pose == 2) {
      float rub = sin(pph * 6.2831);
      if (pair == 2) {
        yaw = mix(yaw, side * (-0.15 + 0.35 * rub), poseW);
        lft = mix(lft, 0.55 + 0.15 * rub * side, poseW);
        knee = mix(knee, -0.5, poseW);
      } else if (pair == 0) {
        yaw = mix(yaw, side * (0.85 + 0.2 * rub * side), poseW);
        lft = mix(lft, 0.85, poseW);
        knee = mix(knee, -1.2, poseW);
      }
    } else if ((pose == 4 || pose == 5 || pose == 7) && uPlant < 0.5) {
      // (planted-feet species: their feet stay planted; the attack moves the body over them)
      float spread = pair == 0 ? 0.3 : (pair == 2 ? -0.3 : 0.0);
      yaw = mix(yaw, side * spread, poseW);
      lft = mix(lft, pose == 5 ? 0.15 : 0.0, poseW);
      knee = mix(knee, pose == 7 ? -0.35 : -0.15, poseW);
    } else if (pose == 6 && pair == 0) {
      float rk = sin(pph * 6.2831 * 1.5 + side * 1.57);
      yaw = mix(yaw, side * (0.45 + 0.35 * rk), poseW);
      lft = mix(lft, 0.45 + 0.4 * max(rk, 0.0), poseW);
      knee = mix(knee, -0.7, poseW);
    } else if (pose == 10 && pair == 0) {
      // Porter: fore legs swing a little further forward and out so the prey slung under the body clears them.
      yaw = mix(yaw, yaw * 0.6 + side * 0.3, poseW);
      lft = mix(lft, lft + 0.12, poseW);
    } else if (pose == 11) {
      // Soldier on guard: fore legs raised and spread, mid legs planted, hind legs back (body pitched up below).
      if (pair == 0) { yaw = mix(yaw, side * 0.65, poseW); lft = mix(lft, 0.55, poseW); knee = mix(knee, -0.95, poseW); }
      else if (pair == 1) { yaw = mix(yaw, side * 0.1, poseW); lft = mix(lft, 0.1, poseW); knee = mix(knee, -0.2, poseW); }
      else { yaw = mix(yaw, side * -0.3, poseW); lft = mix(lft, -0.15, poseW); knee = mix(knee, -0.05, poseW); }
    } else if (pose == 12) {
      // Living-bridge link: every leg stretched out, claws hooked on a neighbour.
      float fw = pair == 0 ? 0.55 : (pair == 1 ? 0.0 : -0.55);
      yaw = mix(yaw, side * fw, poseW); lft = mix(lft, 0.38, poseW); knee = mix(knee, 0.08, poseW); ankleF = mix(ankleF, 0.95, poseW);
    } else if (pose == 13) {
      // Pothole plug: legs splayed flat, body flat on the ground.
      float fw = pair == 0 ? 0.65 : (pair == 1 ? 0.05 : -0.6);
      yaw = mix(yaw, side * fw, poseW); lft = mix(lft, 0.8, poseW); knee = mix(knee, 0.05, poseW); ankleF = mix(ankleF, 0.5, poseW);
    }
    // Death: legs fold up against the body. (Animation pass, pilot species: curled in under the belly, as a dead
    // ant's are — femora down and in, tibiae folded back under — so on its back they curl over it instead of
    // standing up like comb teeth; blind review.)
    float fp = float(pair) - 1.0;
    if (uPlant > 0.5 && bT3.y > 0.0) {
      // crushed (user rating B10: the old flat splay looked unnatural): the legs keep their footing while the body is
      // pressed down onto the ground between them, so they splay and buckle where they stood; a little curl
      yaw = mix(yaw, side * (-0.3 * fp), death);
      lft = mix(lft, -0.6, death);
      knee = mix(knee, -2.35, death);
      ankleF = mix(ankleF, 1.2, death);
    } else if (uPlant > 0.5) {
      yaw = mix(yaw, side * (-0.3 * fp), death);
      lft = mix(lft, -0.6, death);
      knee = mix(knee, -2.35, death);
      ankleF = mix(ankleF, 1.2, death);
    } else {
      yaw = mix(yaw, side * (-0.45 * fp), death);
      lft = mix(lft, 1.25, death);
      knee = mix(knee, -2.0, death);
      ankleF = mix(ankleF, 0.9, death);
    }

    vec3 ax = uLegAxis[li];
    if (seg >= 2) rotP(animP, N, uLegAnkle[li], ax, ankleF);
    if (seg >= 1) rotP(animP, N, uLegKnee[li], ax, knee);
    rotP(animP, N, uLegCoxa[li], ax, lft);
    rotP(animP, N, uLegCoxa[li], UP, yaw);
  } else if (part >= 1 && part <= 7) {
    // Mandibles
    if (uMandVert > 0.5) {
      // Hell ants: both blades hinge at the bottom of the head and swing in the sagittal plane (closed at 0).
      if (part == 2) rotP(animP, N, uMandL, RIGHT, -mOpen * uMandSwing);
      if (part == 3) rotP(animP, N, uMandR, RIGHT, -mOpen * uMandSwing);
    } else {
      if (part == 2) rotP(animP, N, uMandL, UP, mOpen * uMandOpen);
      if (part == 3) rotP(animP, N, uMandR, UP, -mOpen * uMandOpen);
    }
    // Antennae: funiculus at the elbow, then scape at the socket.
    if (part >= 4) {
      bool left = part <= 5;
      float sideS = left ? -1.0 : 1.0;
      float wv = aWave * 6.2831 + (left ? 0.0 : 2.1);
      float sweep = sin(wv) * 0.22;
      float tap = max(0.0, sin(wv * 1.7)) * 0.35;
      float curl = death * 1.2;
      if (part == 5 || part == 7) {
        rotP(animP, N, left ? uElbL : uElbR, RIGHT, -tap + aPitchI * 0.35 - curl - exh * 0.55 + goldA * 0.25);
      }
      vec3 sock = left ? uAntL : uAntR;
      float spreadA = (aSpread * 0.45 + sweep) * (left ? 1.0 : -1.0);
      rotP(animP, N, sock, RIGHT, aPitchI * 0.45 - death * 0.5);
      rotP(animP, N, sock, UP, spreadA);
    }
    // Head yaw/pitch carries mandibles and antennae.
    rotP(animP, N, uNeck, RIGHT, hPitch - death * 0.3);
    rotP(animP, N, uNeck, UP, hYaw);
    if (bT2.w > 0.0) {
      // decapitated (spec 04, a big kill): the head comes away, falls in front of the body and rolls onto its side
      float dk = bT2.w;
      rotP(animP, N, uNeck, vec3(1.0, 0.0, 0.0), 1.3 * dk);
      rotP(animP, N, uNeck, RIGHT, -0.7 * dk);
      animP += vec3(0.22 * uGait.w, -uNeck.y * 0.7, 0.1 * uGait.w) * dk;
    }
  } else if (part == 8) {
    // The sting slides out of the gaster tip while stinging (realism: retracted into the tip otherwise).
    if (abs(aSurf.w - 2.0) < 0.5) {
      // (planted-feet species: the sting shows in the threat display too, as in the reference footage)
      float sOut = max(bT2.y, pose == 4 ? poseW : (pose == 8 && uPlant > 0.5 ? poseW * 0.75 : 0.0));
      animP.x += uRealV * 0.055 * uGait.w * (1.0 - sOut) - 0.05 * uGait.w * sOut;
    }
    // A full crop stretches the gaster (honeydew, liquid food).
    vec3 gd = animP - uGasterPivot;
    animP = uGasterPivot + gd * vec3(1.0 + (0.16 + 0.55 * uPhyso) * swell, 1.0 + (0.3 + 0.5 * uPhyso) * swell, 1.0 + (0.3 + 0.45 * uPhyso) * swell);
    if (uSoft > 0.0) {
      // soft termite-like abdomen: a slight vertical jiggle and lateral sway with each step, growing toward the tip;
      // it deflates a little in death
      float gr = clamp((uGasterPivot.x - animP.x) / max(uGait.w * 0.4, 1e-4), 0.0, 1.0);
      animP.y += uSoft * amp * gr * uGait.w * 0.012 * sin(phase * 12.566 + 1.2);
      animP.z += uSoft * amp * gr * uGait.w * 0.01 * sin(phase * 6.283 + 0.6);
      animP.y = mix(animP.y, uGasterPivot.y + (animP.y - uGasterPivot.y) * 0.85, death);
    }
    // the flagged gaster waves slowly in the threat display (planted-feet species)
    float wave = uPlant > 0.5 && pose == 8 ? poseW * 0.12 * sin(pph * 4.2) : 0.0;
    rotP(animP, N, uGasterPivot, RIGHT, -gPitch - wave);
    // aimed to one side (a sting while pivoting round a grip)
    if (bT2.x != 0.0) rotP(animP, N, uGasterPivot, UP, bT2.x);
  } else if (part == 9) {
    rotP(animP, N, uWaistPivot, RIGHT, -gPitch * 0.3);
    if (bT2.x != 0.0) rotP(animP, N, uWaistPivot, UP, bT2.x * 0.35);
  }
  // Soldier on guard: the whole body pitched up about the hind feet; pothole plug: body lowered onto the ground.
  if (pose == 11) { vec3 piv = (uLegCoxa[4] + uLegCoxa[5]) * 0.5; piv.y = 0.0; rotP(animP, N, piv, RIGHT, 0.26 * poseW); }
  if (pose == 13) animP.y -= poseW * uGait.w * 0.1;
  // Body bob at twice the stride frequency; the lift of the threat display and the sting (feet planted).
  animP.y += bob + bodyUp;
  // crushed flat (spec 04: killed under a big creature's jaws or feet)
  if (bT3.y > 0.0) animP.y *= 1.0 - 0.12 * bT3.y;
  // Gold form: body lowered slightly (a rushing look).
  if (part < 10) animP.y -= goldA * uGait.w * 0.012;
  objectNormal = N;
}
`;

const FRAG_HEADER = /* glsl */ `
varying vec4 vSurf; varying vec3 vLocal; varying float vColorVar; varying float vTint; varying vec4 vGold; uniform float uGoldTime;
varying float vHit;
varying float vDry;
uniform float uReal;
uniform float uMask;
varying float vPartF;
// lab part masks (realism metrics): flat colours per body part
vec3 partMask(){
  int p = int(vPartF + 0.5);
  if (vSurf.w >= 7.5 && vSurf.w < 9.0) return vec3(0.0, 0.0, 0.0);      // setae
  if (abs(vSurf.w - 1.0) < 0.5) return vec3(0.5, 0.5, 0.5);             // eyes
  if (p == 1) return vec3(1.0, 0.0, 0.0);                                 // head
  if (p == 0) return vec3(0.0, 1.0, 0.0);                                 // mesosoma
  if (p == 8) return vec3(0.0, 0.0, 1.0);                                 // gaster
  if (p == 9) return vec3(0.0, 1.0, 1.0);                                 // waist
  if (p >= 10) return vec3(1.0, 1.0, 0.0);                                // legs
  if (p >= 4 && p <= 7) return vec3(1.0, 0.0, 1.0);                       // antennae
  return vec3(1.0, 0.5, 0.0);                                             // mandibles
}
float hairTip(){ float w = vSurf.w; return (w >= 3.5 && w < 7.5) ? fract(w) : 0.0; }
// realism v2 setae (aSurf.w 8 + fraction along the hair), −1 elsewhere
float setaT(){ float w = vSurf.w; return (w >= 7.5 && w < 9.0) ? fract(w) : -1.0; }
// Saiy-Ant gold ripple: head first on, gaster first off; hair leads; never leaks at gold 0
float goldMaskAt(){
  float lx = clamp(vLocal.x, -0.5, 0.5);
  float front = vGold.y > 0.0 ? (0.5 - lx) : (lx + 0.5);
  front -= 0.35 * hairTip();
  return smoothstep(front - 0.1, front + 0.1, vGold.x * 1.22) * step(0.002, vGold.x);
}
${NOISE_GLSL}
vec2 hexCell(vec2 p){ vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5; vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h; return dot(a,a) < dot(b,b) ? a : b; }
`;

export function antPatch(): ShaderPatch {
  return {
    key: 'antAnim',
    vertexHeader: ANIM_HEADER,
    vertex: [
      ['#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( normal );\n' + ANIM_BODY],
      ['#include <begin_vertex>', 'vec3 transformed = animP;'],
    ],
    fragmentHeader: FRAG_HEADER,
    fragment: [
      [
        '#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor.rgb *= 1.0 + vColorVar * 0.14;
         if (uReal > 0.5) {
           // each ant a little different: hue and saturation as well as value
           float lum0 = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
           diffuseColor.rgb = mix(vec3(lum0), diffuseColor.rgb, 1.0 + vColorVar * 0.12);
           diffuseColor.rgb *= vec3(1.0 + vColorVar * 0.035, 1.0, 1.0 - vColorVar * 0.05);
         }
         float sT = setaT();
         if (sT >= 0.0) {
           // setae: paler toward the tip and fading out (dithered: the tip is thinner than a pixel)
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + vec3(0.025, 0.022, 0.018), smoothstep(0.3, 1.0, sT));
           float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
           if (sT > 0.55 && ign < (sT - 0.55) / 0.45 * 0.8) discard;
         }
         ${TINT_GLSL('vTint')}
         // hit flash (animation pass): a quick pale-red flush that reads at a distance
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.3, 0.16), vHit * 0.28);
         float goldM = goldMaskAt();
         {
           // black -> bronze -> metallic gold (darker in linear space than the brief's hexes: the tone mapping lifts gold to cream otherwise)
           vec3 bronze = vec3(0.42, 0.25, 0.09);
           float shimmer = 0.5 + 0.5 * sin(vLocal.x * 70.0 + vLocal.y * 50.0 + vLocal.z * 30.0 + uGoldTime * 2.5);
           vec3 gcol = mix(vec3(0.50, 0.30, 0.05), vec3(0.84, 0.57, 0.15), shimmer * 0.4); // a deeper gold: the game's sun lifted the first values to cream
           gcol = mix(gcol, vec3(0.38, 0.24, 0.06), smoothstep(0.2, -0.6, vLocal.y * 4.0) * 0.6);
           vec3 bc = goldM < 0.5 ? mix(diffuseColor.rgb, bronze, goldM * 2.0) : mix(bronze, gcol, (goldM - 0.5) * 2.0);
           if (abs(vSurf.w - 1.0) > 0.5 && abs(vSurf.w - 3.0) > 0.5) diffuseColor.rgb = bc;
           float ht = hairTip();
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.86, 0.55), goldM * ht * ht * 0.25);
           // queen: faint permanent amber at the tips
           if (vSurf.w >= 5.5 && vSurf.w < 7.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.1, 0.03), ht * ht * ht * 0.12 * (1.0 - goldM));
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.88, 0.86), vGold.z * 0.5);
         }
         float facet = 0.0;
         float bumpH = 0.0;
         if (abs(vSurf.w - 3.0) < 0.5) {
           // smooth glossy eye with a faint facet relief, visible only close up (hell ants, Saiy-Ants)
           vec2 hc = hexCell(vLocal.xy * 420.0);
           facet = smoothstep(0.4, 0.25, length(hc));
           bumpH = facet * 0.06;
         } else if (abs(vSurf.w - 1.0) < 0.5) {
           // Compound eye: hexagonal ommatidia.
           vec2 hc = hexCell(vLocal.xy * 260.0);
           float e = length(hc);
           facet = smoothstep(0.42, 0.2, e);
           // realism v2: each facet a smooth dark dome, the seams only slightly duller
           facet = uReal > 0.5 ? smoothstep(0.5, 0.0, e) : facet;
           diffuseColor.rgb *= uReal > 0.5 ? 0.7 : mix(0.78, 1.0, facet);
           bumpH = facet * (uReal > 0.5 ? 0.0 : 0.6);
         } else if (uReal < 0.5) {
           // Microsculpture/punctation breaks up highlights on rough chitin (realism v2: the baked detail does this).
           bumpH = (vnoise(vLocal.xz * 70.0 + vLocal.y * 20.0) * 0.6 + vnoise(vLocal.xy * 120.0) * 0.4) * vSurf.x;
         }`,
      ],
      [
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = abs(vSurf.w - 1.0) < 0.5 ? (uReal > 0.5 ? 0.14 : mix(0.4, 0.18, facet)) : (abs(vSurf.w - 3.0) < 0.5 ? 0.12 : vSurf.x);
         roughnessFactor = mix(roughnessFactor, 0.22, goldM);
         roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.4), vGold.z);
         // a corpse dries: the gloss fades (spec 04)
         roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.35), vDry);`,
      ],
      ['#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 0.8, goldM);'],
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(normal))), 2.5);
           totalEmissiveRadiance += goldM * vec3(1.0, 0.62, 0.18) * (0.025 + 0.14 * rim);
           float ht = hairTip();
           totalEmissiveRadiance += goldM * ht * ht * vec3(1.0, 0.9, 0.6) * 0.1;
           totalEmissiveRadiance += vHit * vec3(0.55, 0.14, 0.06) * 0.12;
         }`,
      ],
      [
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         {
           vec2 dHdxy = vec2(dFdx(bumpH), dFdy(bumpH)) * (abs(vSurf.w - 1.0) < 0.5 ? 0.07 : 0.02);
           vec3 vSigmaX = dFdx(-vViewPosition); vec3 vSigmaY = dFdy(-vViewPosition);
           vec3 R1 = cross(vSigmaY, normal); vec3 R2 = cross(normal, vSigmaX);
           float fDet = dot(vSigmaX, R1);
           vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
           if (abs(fDet) > 1e-12) normal = normalize(abs(fDet) * normal - vGrad);
         }`,
      ],
      [
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
         #ifdef USE_CLEARCOAT
           material.clearcoat = mix(vSurf.y, 0.08, goldM) * (1.0 - 0.85 * vDry);
           material.clearcoatRoughness = uReal > 0.5 ? 0.14 : 0.18;
         #endif
         #ifdef USE_SHEEN
           material.sheenColor = sheenColor * vSurf.z * (1.0 - goldM);
         #endif`,
      ],
      ['#include <dithering_fragment>', '#include <dithering_fragment>\n if (uMask > 0.5) gl_FragColor = vec4(partMask(), 1.0);'],
      [
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         #if NUM_DIR_LIGHTS > 0
         if (sT >= 0.0) {
           // a seta glows when the sun is behind it
           vec3 Ld = directionalLights[0].direction;
           float back = pow(clamp(dot(-normalize(vViewPosition), Ld) * 0.5 + 0.5, 0.0, 1.0), 3.0);
           reflectedLight.directDiffuse += directionalLights[0].color * diffuseColor.rgb * back * (0.35 + 0.6 * sT);
         }
         #endif`,
      ],
    ],
  };
}

/**
 * Termite glue on an ant (render only): a thin, wet, glossy film of the
 * nasutes' secretion (the kit's glue colour) pushed out along the normals,
 * drawn as a second pass over the same animated geometry. Per-instance
 * `aGlue` 0..1 sets how much of the body it covers: smears and drips first,
 * a full coat when fully glued. (The kit's shell patch is tuned for the
 * termite meshes; on ants its strand noise read as a blocky print.)
 */
export function createAntGlueShell(rig: AntRig, morphKey?: string): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(GLUE_COLOR), roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, depthWrite: false });
  const u = rigUniforms(rig);
  if (morphKey && animV2(morphKey) && rig.foot) u.uPlant.value = 1;
  mat.userData.antUniforms = u;
  addPatch(mat, { key: 'antAnim', vertexHeader: ANIM_HEADER, vertex: antPatch().vertex, uniforms: u });
  addPatch(mat, {
    key: 'antGlue',
    uniforms: { uGlueThick: { value: 0.045 } },
    vertexHeader: 'attribute float aGlue; uniform float uGlueThick; varying float vGlueA; varying vec3 vGlueP;',
    vertex: [['vec3 transformed = animP;', 'vec3 transformed = animP;\n vGlueA = aGlue; vGlueP = position / uGait.w;\n transformed += objectNormal * uGlueThick * (0.4 + 0.6 * aGlue);\n if (aGlue < 0.01) transformed = vec3(0.0);']],
    fragmentHeader: `varying float vGlueA; varying vec3 vGlueP;\n${NOISE_GLSL}`,
    fragment: [
      [
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           // smears and drips (running down the sides), filling in to a full coat as the glue builds up
           float blob = fbm(vGlueP.xz * 9.0 + vGlueP.y * 3.0);
           float drip = vnoise(vec2(vGlueP.x * 14.0 + vGlueP.z * 11.0, vGlueP.y * 5.0));
           float cover = smoothstep(1.05 - vGlueA * 0.9, 1.2 - vGlueA * 0.8, blob * 0.8 + drip * 0.25);
           float a_ = cover * (0.16 + 0.22 * vGlueA);
           if (a_ < 0.02) discard;
           diffuseColor.a = a_;
         }`,
      ],
    ],
  });
  return mat;
}

/** Depth-only variant for shadow maps (same deformation). */
export function antDepthPatch(): ShaderPatch {
  return {
    key: 'antAnimDepth',
    vertexHeader: ANIM_HEADER,
    vertex: [['#include <begin_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n' + ANIM_BODY + '\nvec3 transformed = animP;']],
  };
}

export function rigUniforms(rig: AntRig): Record<string, THREE.IUniform> {
  const x = rig as AntRig & { mandVert?: number; mandSwing?: number; mandOpen?: number; crest?: THREE.Vector3 };
  return {
    uLegCoxa: { value: rig.coxa },
    uLegKnee: { value: rig.knee },
    uLegAnkle: { value: rig.ankle },
    uLegAxis: { value: rig.axis },
    uLegFoot: { value: rig.foot && rig.foot.length === 6 ? rig.foot : rig.ankle },
    uLegHome: { value: rig.home && rig.home.length === 6 ? rig.home : rig.foot && rig.foot.length === 6 ? rig.foot : rig.ankle },
    uPlant: { value: 0 },
    uBodyTex: { value: blankBodyTex },
    uBodyOn: { value: 0 },
    uRealV: { value: 0 },
    uNeck: { value: rig.neck },
    uMandL: { value: rig.mandL },
    uMandR: { value: rig.mandR },
    uAntL: { value: rig.antL },
    uAntR: { value: rig.antR },
    uElbL: { value: rig.elbL },
    uElbR: { value: rig.elbR },
    uGasterPivot: { value: rig.gasterPivot },
    uWaistPivot: { value: rig.waistPivot },
    uGait: { value: new THREE.Vector4(rig.q0, rig.gaitLift ?? 0.24, rig.gaitDuty ?? 0.55, rig.length) },
    uPhyso: { value: rig.physo ?? 0 },
    uSoft: { value: rig.soft ?? 0 },
    uMandVert: { value: x.mandVert ?? 0 },
    uMandSwing: { value: x.mandSwing ?? 0.95 },
    uMandOpen: { value: x.mandOpen ?? 0.95 },
    uCrest: { value: x.crest ?? new THREE.Vector3() },
    uGoldTime: globalUniforms.uTime,
    uReal: { value: 0 },
    uMask: labMask,
  };
}

/** The body-offset texture's layout (spec 04): instances per row and texels per instance. */
export const BODY_TEX = { perRow: 128, texels: 4 } as const;
const blankBodyTex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
blankBodyTex.needsUpdate = true;

/** Lab part-mask mode (dev: realism metrics), shared by every ant material. */
export const labMask = { value: 0 };

/**
 * The ant's material (and its shadow depth material). With a morph key that has a baked-detail recipe
 * (render/bake/recipes.ts) the material also gets the species' macro surface detail.
 */
export function createAntMaterials(rig: AntRig, dapple: boolean, morphKey?: string): { material: THREE.MeshPhysicalMaterial; depth: THREE.MeshDepthMaterial; uniforms: Record<string, THREE.IUniform> } {
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    sheen: 1,
    sheenRoughness: 0.65,
    sheenColor: new THREE.Color(0.32, 0.29, 0.25),
    envMapIntensity: 0.55,
  });
  const uniforms = rigUniforms(rig);
  // animation pass: the pilot species' feet planted by the shader IK
  if (morphKey && animV2(morphKey) && rig.foot) uniforms.uPlant.value = 1;
  if (morphKey && MORPHS[morphKey]?.real) uniforms.uRealV.value = 1;
  const recipe = morphKey ? antRecipe(morphKey) : null;
  if (dapple) patchDapple(material);
  addPatch(material, { ...antPatch(), uniforms });
  const maps = recipe ? bakeDetail(recipe) : null;
  if (maps) {
    addPatch(material, detailPatch(maps));
    // realism v2: the species' look with image-based light (render/lightPresets.ts)
    uniforms.uReal.value = 1;
    addPatch(material, creatureLightPatch());
    useCreatureEnv(material);
  }
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  addPatch(depth, { ...antDepthPatch(), uniforms });
  return { material, depth, uniforms };
}
