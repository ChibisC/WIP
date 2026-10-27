import * as THREE from 'three';
import { addPatch, patchDapple, NOISE_GLSL, ShaderPatch, globalUniforms } from '../shaderPatch';
import { AntRig } from './antGeometry';
import { GLUE_COLOR } from '../termite/castes';
import { TERMANT } from '../../sim/balance';
import { bakeDetail } from '../bake/detailBake';
import { detailPatch } from '../bake/detailShading';
import { antRecipe } from '../bake/recipes';
import { creatureLightPatch, useCreatureEnv } from '../lightPresets';

/**
 * GPU skeletal animation for instanced ants.
 *
 * Per-instance attributes (all vec4):
 *   aA: gait phase (cycles), stride amplitude 0..1, head yaw, head pitch
 *   aB: mandible open 0..1, antenna spread -1..1, antenna pitch -1..1, antenna wave phase
 *   aC: gaster pitch (+ raise / − curl under), gaster yaw, pose id, pose weight
 *   aD: death curl 0..1, carry 0..1, colour variation -1..1 (+ 4 × Termant tint code: 1 stolen caste), pose phase
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
uniform vec3 uLegCoxa[6]; uniform vec3 uLegKnee[6]; uniform vec3 uLegAnkle[6]; uniform vec3 uLegAxis[6];
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
`;

const ANIM_BODY = /* glsl */ `
vec3 animP = position;
{
  vec3 N = objectNormal;
  int part = int(aPart + 0.5);
  float phase = aA.x, amp = aA.y, hYaw = aA.z, hPitch = aA.w;
  float mOpen = aB.x, aSpread = aB.y, aPitchI = aB.z, aWave = aB.w;
  float gPitch = aC.x, swell = aC.y; int pose = int(aC.z + 0.5); float poseW = aC.w;
  float death = aD.x, pph = aD.w;
  float goldA = aE.x, exh = aE.z;
  vGold = aE;
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

    if (pose == 1 && pair == 0) {
      // Antenna grooming: the fore leg on the grooming side rises to the head
      // and strokes the antenna through the strigil.
      float gs = fract(pph * 0.25) < 0.5 ? -1.0 : 1.0;
      if (side == gs) {
        float stroke = sin(pph * 6.2831);
        yaw = mix(yaw, side * (1.05 + 0.18 * stroke), poseW);
        lft = mix(lft, 1.05 + 0.2 * stroke, poseW);
        knee = mix(knee, -1.5 + 0.25 * stroke, poseW);
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
    } else if (pose == 4 || pose == 5 || pose == 7) {
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
    // Death: legs fold up against the body.
    float fp = float(pair) - 1.0;
    yaw = mix(yaw, side * (-0.45 * fp), death);
    lft = mix(lft, 1.25, death);
    knee = mix(knee, -2.0, death);
    ankleF = mix(ankleF, 0.9, death);

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
  } else if (part == 8) {
    // The sting slides out of the gaster tip while stinging.
    if (abs(aSurf.w - 2.0) < 0.5 && pose == 4) animP.x -= 0.05 * uGait.w * poseW;
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
    rotP(animP, N, uGasterPivot, RIGHT, -gPitch);
  } else if (part == 9) {
    rotP(animP, N, uWaistPivot, RIGHT, -gPitch * 0.3);
  }
  // Soldier on guard: the whole body pitched up about the hind feet; pothole plug: body lowered onto the ground.
  if (pose == 11) { vec3 piv = (uLegCoxa[4] + uLegCoxa[5]) * 0.5; piv.y = 0.0; rotP(animP, N, piv, RIGHT, 0.26 * poseW); }
  if (pose == 13) animP.y -= poseW * uGait.w * 0.1;
  // Body bob at twice the stride frequency.
  animP.y += amp * uGait.w * 0.006 * cos(phase * 12.566);
  // Gold form: body lowered slightly (a rushing look).
  if (part < 10) animP.y -= goldA * uGait.w * 0.012;
  objectNormal = N;
}
`;

const FRAG_HEADER = /* glsl */ `
varying vec4 vSurf; varying vec3 vLocal; varying float vColorVar; varying float vTint; varying vec4 vGold; uniform float uGoldTime;
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
         roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.4), vGold.z);`,
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
           material.clearcoat = mix(vSurf.y, 0.08, goldM);
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
export function createAntGlueShell(rig: AntRig): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(GLUE_COLOR), roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, depthWrite: false });
  addPatch(mat, { key: 'antAnim', vertexHeader: ANIM_HEADER, vertex: antPatch().vertex, uniforms: rigUniforms(rig) });
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

/** Lab part-mask mode (dev: realism metrics), shared by every ant material. */
export const labMask = { value: 0 };

/**
 * The ant's material (and its shadow depth material). With a morph key that has a baked-detail recipe
 * (render/bake/recipes.ts) the material also gets the species' macro surface detail.
 */
export function createAntMaterials(rig: AntRig, dapple: boolean, morphKey?: string): { material: THREE.MeshPhysicalMaterial; depth: THREE.MeshDepthMaterial } {
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
  return { material, depth };
}
