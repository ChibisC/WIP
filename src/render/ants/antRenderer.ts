import * as THREE from 'three';
import { hash2 } from '../../core/rng';
import { prof } from '../../core/profiler';
import { camCuts } from '../cameras';
import { AntRig, buildAnt } from './antGeometry';
import { BODY_TEX, createAntMaterials, createAntGlueShell, LOD_FADE_GLSL, packExhaustedFade, POSE, TINT_GLSL } from './antMaterial';
import { ATK, ATTACK_CONTACT, AttackPose, applyAttackBody, attackPose, attackPoseV2, neutralPose } from './attackPoses';
import { AntMorph, MORPHS } from './morphs';
import { ANIM_SFX, animV2, AtkPlan, attackPlan, Motion2, newMotion, newMotionOut, stepMotion } from './antMotion';
import { addPatch, patchDapple } from '../shaderPatch';
import { TermiteLayer } from '../termite/termiteLayer';
import { NASUTE_ANT_PATH } from './nasuteMorphs';
import { GlueStreams, NASUTE_GLUE } from '../termite/glue';
import { termiteTime } from '../termite/material';
import { BALANCE } from '../../sim/balance';

/**
 * What the renderer needs to know about one ant this frame. Produced from the
 * simulation by the game layer (sim/ never imports render/).
 */
export interface AntView {
  id: number;
  morph: string;
  /** 0 = surface, 1 = the nest being displayed */
  space: number;
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  pheading: number;
  /** Desired visual behaviour */
  pose: number;
  /** Mandible open target 0..1 */
  mandible: number;
  /** -1 low (trail following) .. +1 raised (alarm) */
  antennaPitch: number;
  /** 0 calm .. 1 frantic antenna movement */
  antennaActivity: number;
  /** gaster raise (+) / curl (−) in radians */
  gaster: number;
  headPitch: number;
  /** head yaw toward a target, radians relative to body */
  headYaw: number;
  dead: boolean;
  carrying: boolean;
  /** hit points (render: a drop starts a hit reaction) and whether it is flying through the air after a fling */
  hp?: number;
  flung?: boolean;
  /** 0..1 crop fullness: a replete ant's gaster swells */
  crop: number;
  /** render scale multiplier (nanitics are smaller, upgraded ants a little larger) */
  scale?: number;
  /** 0..1 extra scale variation */
  sizeVar: number;
  colorVar: number;
  /** vertical lift (e.g. flung through the air), mm */
  lift: number;
  /** under a taller unit: the body lowered over its feet by this much (mm; legs bent), head and gaster kept clear */
  crouch?: number;
  /** Additional roll (rad) e.g. stagger */
  roll: number;
  /** body pitch override (rad), e.g. rearing for acid spray */
  pitch: number;
  selected: boolean;
  // ---- species extras (render only)
  /** army ants: antennae sweep this much faster (nearly blind, always feeling the way); a porter's load hangs under the body (no head-down carry) */
  waveMul?: number;
  carryUnder?: boolean;
  /** Saiy-Ants: gold 0..1 (ripple), ripple direction (+1 head first, −1 gaster first), exhausted 0..1 */
  gold?: number;
  goldDir?: number;
  exhausted?: number;
  /** termites: kit AnimState, cycle rate, one-shot progress; nasute ramp/firing and target (plane coords; the king's
   *  ATTEND: the point on his queen he looks at); tan; carried item; worker size */
  tState?: number;
  tRate?: number;
  tStateT?: number;
  ramp?: number;
  firing?: boolean;
  aimX?: number;
  aimY?: number;
  tan?: number;
  tCarry?: number;
  variant?: number;
  /** held by a sickle-jaw soldier: struggle intensity 0..1 (0 = not held); acid on it 0..1; squirt aim height (mm) */
  held?: number;
  acid?: number;
  aimZ?: number;
  /** sickle-jaw soldier: holding its target (HOLD on a victim) rather than squirting a free one */
  holding?: boolean;
  /** hell ants: the jaws snap shut (mandible easing jumps to an instant close) */
  snap?: boolean;
  /** Termants: 0 none, 1 a stolen caste (faint amber) */
  tint?: number;
  /** termite glue on this unit 0..1 (render only, derived from nasute fire and glue-burst roots) */
  glue?: number;
  /** melee attack: phase 0..1 of the attack cycle (jaws close at ATTACK_CONTACT), which attack (0..2), side ±1, cycle length (s) */
  atk?: number;
  atkVar?: number;
  atkSide?: number;
  atkGap?: number;
  /** the attack cycle's count (render: sequences of attacks, e.g. a fire ant's series of pivoting stings) and whether
   *  the render picks the attacks itself (the game) or plays `atkVar`'s (the lab's single-attack clips) */
  atkN?: number;
  atkSeq?: boolean;
  /** caste abilities (sim/casteAbilities.ts): 1 the leafcutter major's taunt display, 2 an army-ant soldier's rage
   *  pulse (played as this attack cycle); the rage glow 0..1 (a red flush); this cycle's bite stings (army ants
   *  sting only every third bite) */
  special?: number;
  /** the hell ants' finisher: held by the neck in this ant's jaws (its id; the renderer puts the neck on the grip) */
  neckBy?: number;
  rageGlow?: number;
  stingNext?: boolean;
  /** fore legs raised 0..1 and the body's pitch pivot along it (fraction of L; − behind the middle): a sprayer
   *  rearing up (user rating F6, as EotU's) */
  front?: number;
  pivX?: number;
  /** dead: what killed it (sim HIT.*: the render picks the death), and a corpse's drying 0..1 (its gloss fades) */
  cause?: number;
  dry?: number;
  /** held in a creature's jaws (its id; 0 = not): drawn at the jaw frame of its animated body when it records one */
  heldCr?: number;
  /** climbing a creature (sim/climbing.ts): its id (0 = on the ground), phase 1 up / 2 riding / 3 down, rail, slot, progress */
  rideCr?: number;
  ridePh?: number;
  rideRail?: number;
  rideSlot?: number;
  rideT?: number;
}

/**
 * Where a climbing ant is this frame (render only): the creature renderer
 * puts it on the animated leg or body. `p` position, `f` forward, `u` up,
 * `speed` mm/s along the leg (drives the gait), all filled by the hook.
 */
export interface MountOut {
  p: THREE.Vector3;
  f: THREE.Vector3;
  u: THREE.Vector3;
  speed: number;
}
export type MountFn = (v: AntView, alpha: number, out: MountOut) => boolean;
const mountOut: MountOut = { p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), speed: 0 };

interface AnimState {
  /** where it was last drawn mounted (held in jaws, riding) and the gap still being eased out after release */
  mx?: number;
  my?: number;
  mz?: number;
  wasMounted?: boolean;
  gx?: number;
  gy?: number;
  gz?: number;
  phase: number;
  amp: number;
  wave: number;
  hy: number;
  hp: number;
  mo: number;
  ap: number;
  gp: number;
  cr: number;
  /** crouch (mm, eased) */
  ck?: number;
  pose: number;
  poseW: number;
  pph: number;
  death: number;
  nx: number;
  ny: number;
  nz: number;
  lastX: number;
  lastY: number;
  lastH: number;
  seen: number;
  roll: number;
  /** Saiy-Ant hair: springy sway (−1..1) and its velocity, driven by turning */
  sw?: number;
  swv?: number;
  /** termite glue on this ant, eased (render only) */
  gl?: number;
  /** animation pass: the pilot species' motion controller (antMotion.ts) */
  m2?: Motion2;
  /** melee attack: blend weight, last phase, attack, side */
  aw?: number;
  aq?: number;
  av?: number;
  as?: number;
  /** spec 04: the grip held from the last sting / into the next, and the pivot round the grip (rad, eased); last phase */
  aqPrev?: number;
  ahi?: boolean;
  aho?: boolean;
  piv?: number;
  /** LOD cross-fade (performance pass): the LOD shown, the one fading out (−1 none), the fade 0..1, last frame drawn */
  lod?: number;
  lodFrom?: number;
  lodT?: number;
  lodSeen?: number;
}

/** LOD cross-fade length (s) and the hysteresis round each switching size (×/÷) */
const LOD_FADE = 0.25;
const LOD_HYST = 1.06;

const LOD_NAMES = ['lod0', 'lod1', 'imp'] as const;

/**
 * One copy of each ant model for every area (performance pass): the built geometry and rig per morph and detail, and
 * the far-LOD impostor atlas per morph. Each area's renderer used to build and bake its own the first time the area
 * was shown — seconds of work at the moment of a switch on a slow machine. Buckets clone the geometry (they add their
 * instance attributes) and make their own materials (their own uniforms), so sharing changes nothing drawn.
 */
const builtCache = new Map<string, ReturnType<typeof buildAnt>>();
function builtAnt(m: AntMorph, detail: 0 | 1): ReturnType<typeof buildAnt> {
  const k = `${m.key}|${detail}`;
  let b = builtCache.get(k);
  if (!b) builtCache.set(k, (b = buildAnt(m, detail, 3)));
  return b;
}
/** baked impostors per WebGL renderer (an atlas lives on one context) */
const impostorCaches = new WeakMap<THREE.WebGLRenderer, Map<string, THREE.MeshStandardMaterial>>();
function impostorCacheOf(r: THREE.WebGLRenderer): Map<string, THREE.MeshStandardMaterial> {
  let m = impostorCaches.get(r);
  if (!m) impostorCaches.set(r, (m = new Map()));
  return m;
}

/**
 * A geometry that shares another's vertex data (the same attribute objects: uploaded once per renderer) and takes its
 * own instance attributes. Every area's renderer used to clone each model's vertices (performance pass, GPU memory).
 */
function sharedGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex(src.index);
  for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.attributes[name]);
  const ma = src.morphAttributes as Record<string, Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>>;
  for (const name of Object.keys(ma)) (g.morphAttributes as typeof ma)[name] = ma[name];
  g.morphTargetsRelative = src.morphTargetsRelative;
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.setDrawRange(src.drawRange.start, src.drawRange.count);
  g.boundingBox = src.boundingBox;
  g.boundingSphere = src.boundingSphere;
  g.userData = src.userData;
  return g;
}

class Bucket {
  meshes: THREE.InstancedMesh[] = [];
  attrs: Array<{ a: THREE.InstancedBufferAttribute; b: THREE.InstancedBufferAttribute; c: THREE.InstancedBufferAttribute; d: THREE.InstancedBufferAttribute; e: THREE.InstancedBufferAttribute }> = [];
  counts = [0, 0, 0];
  capacity = [0, 0, 0];
  rig: AntRig;
  morph: AntMorph;
  geos: THREE.BufferGeometry[] = [];
  mats: THREE.Material[] = [];
  depths: (THREE.Material | undefined)[] = [];
  /** spec 04: each animated LOD's material uniforms and its per-instance body-offset texture */
  unis: Array<Record<string, THREE.IUniform> | undefined> = [];
  bodyTex: Array<THREE.DataTexture | undefined> = [];

  constructor(public key: string, private group: THREE.Group, impostor: { geo: THREE.BufferGeometry; mat: THREE.Material }, shadows: boolean) {
    this.morph = MORPHS[key];
    const b0 = builtAnt(this.morph, 0);
    const b1 = builtAnt(this.morph, 1);
    this.rig = b1.rig;
    const m0 = createAntMaterials(b0.rig, true, key);
    const m1 = createAntMaterials(b1.rig, true, key);
    this.geos = [b0.geometry, b1.geometry, impostor.geo];
    this.mats = [m0.material, m1.material, impostor.mat];
    this.depths = [m0.depth, m1.depth, undefined];
    this.unis = [m0.uniforms, m1.uniforms, undefined];
    for (let l = 0; l < 3; l++) this.alloc(l, l === 0 ? 64 : 256, shadows);
  }

  alloc(l: number, cap: number, shadows: boolean): void {
    const old = this.meshes[l];
    if (old) {
      this.group.remove(old);
      // (the vertices are the model's, shared: only the old instance attributes leave the GPU)
      for (const name of Object.keys(this.geos[l].attributes)) old.geometry.deleteAttribute(name);
      old.geometry.setIndex(null);
      old.geometry.dispose();
      old.dispose();
    }
    const geo = sharedGeometry(this.geos[l]);
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const at = { a: mk(), b: mk(), c: mk(), d: mk(), e: mk() };
    geo.setAttribute('aA', at.a);
    geo.setAttribute('aB', at.b);
    geo.setAttribute('aC', at.c);
    geo.setAttribute('aD', at.d);
    geo.setAttribute('aE', at.e);
    const mesh = new THREE.InstancedMesh(geo, this.mats[l], cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows && l < 2;
    mesh.receiveShadow = l < 2;
    if (this.depths[l]) mesh.customDepthMaterial = this.depths[l];
    mesh.name = `ants:${this.key}:${LOD_NAMES[l]}`;
    const u = this.unis[l];
    if (u) {
      this.bodyTex[l]?.dispose();
      const tex = bodyTexture(cap);
      this.bodyTex[l] = tex;
      u.uBodyTex.value = tex;
    }
    this.meshes[l] = mesh;
    this.attrs[l] = at;
    this.capacity[l] = cap;
    this.group.add(mesh);
  }

  setShadows(on: boolean): void {
    this.meshes.forEach((m, l) => (m.castShadow = on && l < 2));
  }

  // ---- termite glue on ants (render only): a shell pass over LOD0/1 for the glued ones
  shell: Array<THREE.InstancedMesh | null> = [null, null];
  shellAt: Array<{ a: THREE.InstancedBufferAttribute; b: THREE.InstancedBufferAttribute; c: THREE.InstancedBufferAttribute; d: THREE.InstancedBufferAttribute; e: THREE.InstancedBufferAttribute; g: THREE.InstancedBufferAttribute } | null> = [null, null];
  shellN = [0, 0];
  private shellMats: Array<THREE.MeshPhysicalMaterial | null> = [null, null];
  private shellTex: Array<THREE.DataTexture | null> = [null, null];

  /** Copy instance `n` of LOD `l` into the glue shell with glue amount `g`. */
  addShell(l: number, n: number, g: number): void {
    let mesh = this.shell[l];
    const k = this.shellN[l];
    if (!mesh || k >= mesh.instanceMatrix.count) {
      const cap = mesh ? mesh.instanceMatrix.count * 2 : 16;
      const shellMat = (this.shellMats[l] ??= createAntGlueShell(this.rig, this.key));
      const oldTex = this.shellTex[l];
      const tex = bodyTexture(cap);
      if (oldTex) (tex.image.data as Float32Array).set((oldTex.image.data as Float32Array).subarray(0, k * BODY_F));
      oldTex?.dispose();
      this.shellTex[l] = tex;
      const su = shellMat.userData.antUniforms as Record<string, THREE.IUniform>;
      su.uBodyTex.value = tex;
      const geo = sharedGeometry(this.geos[l]);
      const mk = (size = 4) => new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage);
      const at = { a: mk(), b: mk(), c: mk(), d: mk(), e: mk(), g: mk(1) };
      geo.setAttribute('aA', at.a);
      geo.setAttribute('aB', at.b);
      geo.setAttribute('aC', at.c);
      geo.setAttribute('aD', at.d);
      geo.setAttribute('aE', at.e);
      geo.setAttribute('aGlue', at.g);
      const next = new THREE.InstancedMesh(geo, shellMat, cap);
      next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      next.frustumCulled = false;
      next.renderOrder = 2;
      next.name = `ants:${this.key}:glue${l}`;
      if (mesh) {
        // keep what was already written this frame
        for (let i = 0; i < k; i++) {
          const m4 = new THREE.Matrix4();
          mesh.getMatrixAt(i, m4);
          next.setMatrixAt(i, m4);
        }
        const old = this.shellAt[l]!;
        for (const key of ['a', 'b', 'c', 'd', 'e', 'g'] as const) (at[key].array as Float32Array).set((old[key].array as Float32Array).subarray(0, k * at[key].itemSize));
        this.group.remove(mesh);
        // (its vertices are the model's, shared: only its own instance attributes leave the GPU)
        for (const name of Object.keys(this.geos[l].attributes)) mesh.geometry.deleteAttribute(name);
        mesh.geometry.setIndex(null);
        mesh.geometry.dispose();
        mesh.dispose();
      }
      this.group.add(next);
      this.shell[l] = mesh = next;
      this.shellAt[l] = at;
    }
    const src = this.attrs[l];
    const dst = this.shellAt[l]!;
    const m4 = tmpShellM;
    this.meshes[l].getMatrixAt(n, m4);
    mesh.setMatrixAt(k, m4);
    for (const key of ['a', 'b', 'c', 'd', 'e'] as const) dst[key].setXYZW(k, src[key].getX(n), src[key].getY(n), src[key].getZ(n), src[key].getW(n));
    dst.g.setX(k, g);
    const bt = this.bodyTex[l];
    if (bt) (this.shellTex[l]!.image.data as Float32Array).set((bt.image.data as Float32Array).subarray(n * BODY_F, n * BODY_F + BODY_F), k * BODY_F);
    this.shellN[l] = k + 1;
  }

  commitShell(): void {
    for (let l = 0; l < 2; l++) {
      const mesh = this.shell[l];
      if (!mesh) continue;
      mesh.count = this.shellN[l];
      mesh.visible = mesh.count > 0;
      if (!mesh.count) continue;
      const at = this.shellAt[l]!;
      mesh.instanceMatrix.needsUpdate = true;
      for (const attr of [at.a, at.b, at.c, at.d, at.e, at.g]) attr.needsUpdate = true;
      const su = this.shellMats[l]?.userData.antUniforms as Record<string, THREE.IUniform> | undefined;
      if (su) su.uBodyOn.value = this.bodyOn;
      if (this.shellTex[l]) this.shellTex[l]!.needsUpdate = true;
    }
  }

  /** spec 04: whether this species' feet are planted under a moving body (set each frame) */
  bodyOn = 0;

  /** Write instance n's body offset (LOD l): translation (object units), lateral sweep, rotation vector, spread, gaster yaw, sting out, fore legs raised, decapitation. */
  writeBody(l: number, n: number, b: Float32Array): void {
    const t = this.bodyTex[l];
    if (t) (t.image.data as Float32Array).set(b, n * BODY_F);
  }
}

/** floats per instance in the body-offset texture */
const BODY_F = BODY_TEX.texels * 4;
function bodyTexture(cap: number): THREE.DataTexture {
  const rows = Math.max(1, Math.ceil(cap / BODY_TEX.perRow));
  const w = BODY_TEX.perRow * BODY_TEX.texels;
  const tex = new THREE.DataTexture(new Float32Array(w * rows * 4), w, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}
const bodyBuf = new Float32Array(BODY_F);
const zeroBody = new Float32Array(BODY_F);
const qB = new THREE.Quaternion();
const qT = new THREE.Quaternion();
const vT = new THREE.Vector3();
const vPiv = new THREE.Vector3();
const vF0 = new THREE.Vector3();
const vU0 = new THREE.Vector3();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

const tmpShellM = new THREE.Matrix4();
const motionOut = newMotionOut();
const TICK_S = 1 / BALANCE.tickHz;
const atkP = neutralPose({} as AttackPose);
const plan: AtkPlan = { variant: 0, holdIn: false, holdOut: false, piv: 0 };

const tmpM = new THREE.Matrix4();
/** the impostor bakes' shared multisampled target (each morph keeps a single-sample copy of its atlas) */
let bakeTarget: THREE.WebGLRenderTarget | null = null;
/** the far impostor's matrix when its on-screen size is clamped up (LOD cross-fade: the near model keeps tmpM) */
const tmpMb = new THREE.Matrix4();
const vSb = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const vF = new THREE.Vector3();
const vU = new THREE.Vector3();
const vR = new THREE.Vector3();
const vN = new THREE.Vector3();
const vP = new THREE.Vector3();
const vS = new THREE.Vector3();
const frustum = new THREE.Frustum();
const projScreen = new THREE.Matrix4();
const sphere = new THREE.Sphere();

const lerpAngle = (a: number, b: number, t: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/**
 * The drawn heading's last say (performance v2: game/intents.ts — ants turn toward an order on the frame it is given):
 * (ant id, plane x, y, interpolated heading, now ms) → the heading to draw. Null: the simulation's.
 */
export const antHeadingHook: { fn: ((id: number, x: number, y: number, h: number, now: number) => number) | null; active: () => boolean } = { fn: null, active: () => false };

/** Render-side sound hooks (spec 04): set by the game's audio; (ANIM_SFX.*, plane x, y, space, cause of death, morph). */
export const animHooks: {
  emit: ((sfx: number, x: number, y: number, space: number, cause: number, morph: string) => void) | null;
  /** render-only effects at an animation beat: a puff of dust at (x, y) of `size` mm (the hell ants' snap) */
  fx: ((x: number, y: number, space: number, size: number) => void) | null;
} = { emit: null, fx: null };

export interface AntSpaceAdapter {
  /** world position for plane coords */
  toWorld(x: number, y: number, out: THREE.Vector3): void;
  /** surface normal (world) */
  normal(x: number, y: number, out: THREE.Vector3): void;
  /** world forward direction for a heading */
  forward(h: number, out: THREE.Vector3): void;
}

/**
 * Instanced, GPU-animated ant rendering with three LODs:
 *   lod0 full anatomy (close/observe), lod1 medium, imp = top-down impostor.
 */
const _lp = new THREE.Vector3();
/**
 * The lowest point (y, object units) of the jaw tips, the chin, the mouth and the gaster tip once the head is pitched
 * by `hp` about the neck, the gaster by `gp` about its pivot (as the shader does) and the body turned by `q` (before
 * the body's own shift).
 */
function lowestPosed(rig: AntRig, hp: number, gp: number, q: THREE.Quaternion): number {
  return Math.min(lowestHead(rig, hp, q), lowestGaster(rig, gp, q));
}

/** The head's part of `lowestPosed`. */
function lowestHead(rig: AntRig, hp: number, q: THREE.Quaternion): number {
  let low = Infinity;
  const ch = Math.cos(hp);
  const sh = Math.sin(hp);
  for (const p of [rig.jawTip ?? rig.mouth, rig.chin ?? rig.mouth, rig.mouth]) {
    const dx = p.x - rig.neck.x;
    const dy = p.y - rig.neck.y;
    _lp.set(rig.neck.x + dx * ch - dy * sh, rig.neck.y + dx * sh + dy * ch, p.z).applyQuaternion(q);
    low = Math.min(low, _lp.y);
  }
  return low;
}

/**
 * Hell ants (vertical scythes): the lowest point of the left blade (`rig.mandPts`, built closed) opened by `mo` about
 * its hinge, as the shader swings it, then pitched with the head by `hp` and turned by `q`.
 */
function lowestJaw(rig: AntRig, hp: number, mo: number, q: THREE.Quaternion): number {
  const x = rig as AntRig & { mandPts?: THREE.Vector3[]; mandSwing?: number; mandL?: THREE.Vector3 };
  if (!x.mandPts || !x.mandL) return Infinity;
  const a = -mo * (x.mandSwing ?? 0);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ch = Math.cos(hp);
  const sh = Math.sin(hp);
  let low = Infinity;
  for (const p of x.mandPts) {
    const hx = p.x - x.mandL.x;
    const hy = p.y - x.mandL.y;
    const ox = x.mandL.x + hx * ca - hy * sa;
    const oy = x.mandL.y + hx * sa + hy * ca;
    const dx = ox - rig.neck.x;
    const dy = oy - rig.neck.y;
    _lp.set(rig.neck.x + dx * ch - dy * sh, rig.neck.y + dx * sh + dy * ch, p.z).applyQuaternion(q);
    low = Math.min(low, _lp.y);
  }
  return low;
}

/** The gaster's part of `lowestPosed`. */
function lowestGaster(rig: AntRig, gp: number, q: THREE.Quaternion): number {
  const cg = Math.cos(-gp);
  const sg = Math.sin(-gp);
  const g = rig.gasterTip;
  const P = rig.gasterPivot;
  const gx = g.x - P.x;
  const gy = g.y - P.y;
  _lp.set(P.x + gx * cg - gy * sg, P.y + gx * sg + gy * cg, 0).applyQuaternion(q);
  return _lp.y;
}

/** Where an ant's jaws hold its load this frame (world), and its head's forward (AntRenderer.holdOf). */
export interface JawHold {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  frame: number;
}
const _jp = new THREE.Vector3();
const _gt = new THREE.Vector3();
const _ga = new THREE.Vector3();
const _gn = new THREE.Vector3();
const _jf = new THREE.Vector3();

export class AntRenderer {
  group = new THREE.Group();
  private buckets = new Map<string, Bucket>();
  private anim = new Map<number, AnimState>();
  private lastCut = -1;
  private frame = 0;
  /**
   * Carried loads (render only): where each carrying ant's jaws are this frame — the posed head (its pitch and yaw
   * about the neck) on the drawn body — so the food renderer draws the load in the jaws as they move (user 2026-11-01,
   * 21:48: "fix how food is in ant mouths as it looks laggy"; it was drawn at the sim's point ahead of the ant, a tick
   * behind the drawn ant and blind to the head's motion).
   */
  private holds = new Map<number, JawHold>();
  private impostorMats = new Map<string, THREE.MeshStandardMaterial>();
  private impostorGeo: THREE.BufferGeometry;
  shadows = true;
  lodScale = 1;
  /** projected body length (px) thresholds */
  lod0Px = 70;
  lod1Px = 9;
  minImpostorPx = 7;
  stats = { drawn: 0, lod: [0, 0, 0] };
  private renderer: THREE.WebGLRenderer;
  /** Nasute Termites (model kit): views with a `termite_*` morph */
  termites: TermiteLayer | null = null;
  /** the nasute soldiers on the ant pipeline: their glue streams from the nasus tip (realism round 3) */
  private nasGlue: GlueStreams | null = null;
  private nasGlueN = 0;
  /** climbing ants: placed on the creature's animated leg or body (set by the session) */
  mount: MountFn | null = null;
  /** the space these ants are in (for the sound hooks; set by the session) */
  space = 0;

  constructor(renderer: THREE.WebGLRenderer, public name = 'ants') {
    this.renderer = renderer;
    this.group.name = name;
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.impostorGeo = g;
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    this.buckets.forEach((b) => b.setShadows(on));
  }

  /**
   * Build every model in `morphs` now (performance pass, CHANGE_PLAN §25): while loading, or in the background when a
   * new caste appears, instead of at the moment an area is first shown. Empty models are hidden, so this costs no draws.
   */
  prepare(morphs: Iterable<string>): number {
    let n = 0;
    for (const m of morphs) {
      if (m.startsWith('termite_') && !NASUTE_ANT_PATH.has(m)) {
        if (!this.termites) {
          this.termites = new TermiteLayer();
          this.termites.mount = this.mount;
          this.group.add(this.termites.group);
        }
        n += this.termites.prepare(m);
      } else if (MORPHS[m] && !this.buckets.has(m)) {
        this.bucket(m);
        n++;
      }
    }
    return n;
  }

  /** Has this renderer built `morph` yet? */
  has(morph: string): boolean {
    return morph.startsWith('termite_') && !NASUTE_ANT_PATH.has(morph) ? !!this.termites?.has(morph) : this.buckets.has(morph);
  }

  rig(morph: string): AntRig {
    return this.bucket(morph).rig;
  }

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      const t0 = performance.now();
      const imp = this.impostorFor(key);
      b = new Bucket(key, this.group, { geo: this.impostorGeo, mat: imp }, this.shadows);
      this.buckets.set(key, b);
      prof.note(`ant model ${key} built for ${this.name} (${(performance.now() - t0).toFixed(0)} ms)`);
    }
    return b;
  }

  /** Render the ant from above into an 8-frame gait atlas used by far LOD quads. */
  private impostorFor(key: string): THREE.MeshStandardMaterial {
    let mat = this.impostorMats.get(key) ?? impostorCacheOf(this.renderer).get(key);
    if (mat) {
      this.impostorMats.set(key, mat);
      return mat;
    }
    const morph = MORPHS[key];
    const built = builtAnt(morph, 1);
    const { material } = createAntMaterials(built.rig, false, key);
    const cols = 4;
    const rows = 2;
    const cell = 128;
    // (the bake draws into one multisampled target shared by every bake; each morph keeps only the resolved image:
    //  0.5 MB instead of 4.5 MB of samples, colour and depth — performance pass, GPU memory on phones)
    if (!bakeTarget) {
      bakeTarget = new THREE.WebGLRenderTarget(cols * cell, rows * cell, { samples: 4 });
      bakeTarget.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const rt = bakeTarget;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2);
    dl.position.set(0.3, 1, 0.2);
    scene.add(dl);
    const geo = built.geometry.clone();
    const mk = (v: number[]) => new THREE.InstancedBufferAttribute(new Float32Array(v), 4);
    geo.setAttribute('aA', mk([0, 1, 0, 0]));
    geo.setAttribute('aB', mk([0, 0, 0, 0.1]));
    geo.setAttribute('aC', mk([0, 0, 0, 0]));
    geo.setAttribute('aD', mk([0, 0, 0, 0]));
    geo.setAttribute('aE', mk([0, 1, 0, 0]));
    const mesh = new THREE.InstancedMesh(geo, material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.frustumCulled = false;
    scene.add(mesh);
    const span = built.rig.length * 1.6;
    const cam = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.01, span * 10);
    cam.up.set(1, 0, 0);
    cam.position.set(0, span * 3, 0);
    cam.lookAt(0, 0, 0);
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = new THREE.Color();
    r.getClearColor(prevClear);
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    rt.viewport.set(0, 0, cols * cell, rows * cell);
    rt.scissorTest = false;
    r.setRenderTarget(rt);
    r.clear();
    for (let i = 0; i < cols * rows; i++) {
      const cx = (i % cols) * cell;
      const cy = Math.floor(i / cols) * cell;
      (geo.attributes.aA as THREE.InstancedBufferAttribute).setX(0, i / (cols * rows));
      (geo.attributes.aA as THREE.InstancedBufferAttribute).needsUpdate = true;
      rt.viewport.set(cx, cy, cell, cell);
      rt.scissor.set(cx, cy, cell, cell);
      rt.scissorTest = true;
      r.setRenderTarget(rt);
      r.render(scene, cam);
    }
    rt.scissorTest = false;
    rt.viewport.set(0, 0, cols * cell, rows * cell);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    // the resolved atlas copied as it is (same format, a GPU copy) into the morph's own single-sample texture
    const atlas = new THREE.WebGLRenderTarget(cols * cell, rows * cell, { depthBuffer: false, samples: 0 });
    atlas.texture.colorSpace = THREE.SRGBColorSpace;
    r.initRenderTarget(atlas);
    r.copyTextureToTexture(rt.texture, atlas.texture);
    // (the bake's copy of the model leaves the GPU with it)
    geo.dispose();
    mat = new THREE.MeshStandardMaterial({ map: atlas.texture, alphaTest: 0.35, transparent: false, roughness: 0.6, side: THREE.DoubleSide });
    patchDapple(mat);
    addPatch(mat, {
      key: 'impostor',
      uniforms: { uSpan: { value: span } },
      vertexHeader: 'attribute vec4 aA; attribute vec4 aD; attribute vec4 aE; uniform float uSpan; varying vec2 vGoldI; varying float vTintI; varying float vFadeI;',
      fragmentHeader: 'varying vec2 vGoldI; varying float vTintI; varying float vFadeI;',
      // far away a Saiy-Ant in its gold surge still reads as a gold speck; exhausted ones look dull
      fragment: [
        [
          '#include <map_fragment>',
          `#include <map_fragment>
           ${LOD_FADE_GLSL('vFadeI')}
           diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.78, 0.55, 0.16), vec3(1.0, 0.84, 0.38), dot(diffuseColor.rgb, vec3(0.33)) * 1.6), clamp(vGoldI.x, 0.0, 1.0) * 0.85);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * 0.8, vGoldI.y * 0.5);
           ${TINT_GLSL('vTintI')}`,
        ],
      ],
      vertex: [
        ['#include <begin_vertex>', '{ float fe = floor(aE.z / 256.0); vGoldI = vec2(abs(aE.x), mod(aE.z, 256.0) / 255.0); vFadeI = fe < 0.5 ? 0.0 : fe < 256.5 ? fe / 256.0 : (256.0 - fe) / 256.0; }\nvTintI = floor((aD.z + 2.0) / 4.0);\n#include <begin_vertex>'],
        [
          '#include <uv_vertex>',
          `#include <uv_vertex>
           {
             float f = floor(fract(aA.x) * 8.0);
             vec2 cellUv = vec2(mod(f, 4.0), floor(f / 4.0));
             vMapUv = (vec2(1.0 - uv.y, uv.x) + cellUv) / vec2(4.0, 2.0);
           }`,
        ],
        ['#include <begin_vertex>', 'vec3 transformed = position * vec3(uSpan, 1.0, uSpan);'],
      ],
    });
    this.impostorMats.set(key, mat);
    impostorCacheOf(this.renderer).set(key, mat);
    return mat;
  }

  /**
   * Update all instance buffers. `views` are ants in the space being rendered.
   * alpha = sim interpolation factor; dt = real frame time (s).
   */
  update(views: AntView[], alpha: number, frameDt: number, camera: THREE.PerspectiveCamera, adapter: AntSpaceAdapter, viewportH: number): void {
    this.frame++;
    // a camera cut (jumpTo) shows every ant at its LOD at once: nothing to cross-fade from
    const cut = camCuts.n !== this.lastCut;
    this.lastCut = camCuts.n;
    for (const b of this.buckets.values()) {
      b.counts.fill(0);
      b.shellN.fill(0);
      // spec 04: the body-offset texture is read only by the planted-feet species (the lab can switch them back)
      b.bodyOn = animV2(b.key) && b.rig.foot ? 1 : 0;
      for (const u of b.unis) if (u) u.uBodyOn.value = b.bodyOn;
    }
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    const pxPerMmAt1 = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const camPos = camera.position;
    const st = this.stats;
    st.drawn = 0;
    st.lod[0] = st.lod[1] = st.lod[2] = 0;
    this.termites?.begin(frameDt);
    if (this.termites) this.termites.mount = this.mount;
    this.nasGlueN = 0;
    // (the glue's pulses run on the termite clock: the kit layer advances it when there is one)
    if (this.nasGlue && !this.termites) termiteTime.value += frameDt;

    const turnTo = antHeadingHook.fn && antHeadingHook.active() ? antHeadingHook.fn : null;
    const nowMs = turnTo ? performance.now() : 0;
    for (const v of views) {
      // (this ant's time step: the frame's, or the time it missed — below)
      let dt = frameDt;
      if (v.morph.startsWith('termite_') && !NASUTE_ANT_PATH.has(v.morph)) {
        if (!this.termites) {
          this.termites = new TermiteLayer();
          this.termites.mount = this.mount;
          this.group.add(this.termites.group);
          this.termites.begin(dt);
        }
        this.termites.add(v, alpha, dt, adapter, camera.position, pxPerMmAt1, frustum, sphere);
        st.drawn++;
        continue;
      }
      const b = this.bucket(v.morph);
      const rig = b.rig;
      let s = this.anim.get(v.id);
      const x = v.px + (v.x - v.px) * alpha;
      const y = v.py + (v.y - v.py) * alpha;
      const h = turnTo && v.space === 0 ? turnTo(v.id, x, y, lerpAngle(v.pheading, v.heading, alpha), nowMs) : lerpAngle(v.pheading, v.heading, alpha);
      if (!s) {
        // (seeds hashed from the id, not Math.random: the same ant looks the same in every frame it is rebuilt in, every
        // reload and every golden shot — performance v2)
        // (every field in one literal, the optional ones undefined: one hidden class for every ant's state, so the loop's
        // property accesses stay monomorphic — performance v3; they were spread over six)
        s = {
          phase: hash2(v.id, 1, 71),
          amp: 0,
          wave: hash2(v.id, 2, 71) * 10,
          hy: 0,
          hp: 0,
          mo: 0,
          ap: 0,
          gp: 0,
          cr: 0,
          pose: 0,
          poseW: 0,
          pph: hash2(v.id, 3, 71) * 10,
          death: v.dead ? 1 : 0,
          nx: 0,
          ny: 1,
          nz: 0,
          lastX: x,
          lastY: y,
          lastH: h,
          seen: this.frame,
          roll: 0,
          mx: undefined,
          my: undefined,
          mz: undefined,
          wasMounted: undefined,
          gx: undefined,
          gy: undefined,
          gz: undefined,
          ck: undefined,
          sw: undefined,
          swv: undefined,
          gl: undefined,
          m2: undefined,
          aw: undefined,
          aq: undefined,
          av: undefined,
          as: undefined,
          aqPrev: undefined,
          ahi: undefined,
          aho: undefined,
          piv: undefined,
          lod: undefined,
          lodFrom: undefined,
          lodT: undefined,
          lodSeen: undefined,
        };
        this.anim.set(v.id, s);
      }
      // animation pass (render/ants/antMotion.ts): the pilot species' motion controller
      const v2 = animV2(v.morph);
      if (v2 && !s.m2) {
        s.m2 = newMotion(v.id);
        s.wave = s.m2.seed * 10;
        s.pph = s.m2.seed * 7;
      }
      // performance v2: an ant that was not animated for a while (off screen: the views leave out ants well out of
      // view) catches up in one step — its timers and springs run the time it missed (a death that happened off
      // screen is over), its gait keeps its pace and its body takes the heading it has now. None of it was on screen,
      // and the views keep a wide margin, so it is settled before it comes into view.
      const missed = this.frame - s.seen - 1;
      const catchUp = missed > 0;
      if (catchUp) dt = Math.min(1, frameDt * (missed + 1));
      const M = v2 ? motionOut : null;
      // on a creature: its animated leg or back decides where the ant is (and how fast it climbs)
      const mounted = (!!v.rideCr || !!v.heldCr) && !!this.mount && this.mount(v, alpha, mountOut);
      // Gait: phase advances by distance travelled / stride length, so feet never slide.
      const scale = (1 + v.sizeVar * 0.12) * (v.scale ?? 1) * (s.m2 ? s.m2.sizeK : 1);
      const fighting = v.atk !== undefined;
      if (fighting) {
        // (the animation pass runs the attack's phase on between ticks, so the strike is smooth at any frame rate)
        s.aq = M ? ((v.atk ?? 0) + (alpha * TICK_S) / Math.max(0.15, v.atkGap ?? 0.8)) % 1 : v.atk;
        s.as = v.atkSide ?? 1;
        if (M && s.m2) {
          attackPlan(v.morph, v, s.aq ?? 0, s.m2.seed, plan);
          s.av = plan.variant;
          s.ahi = plan.holdIn;
          s.aho = plan.holdOut;
        } else s.av = v.atkVar ?? 0;
      }
      // spec 04: a fire ant stinging its way round its grip — the ground frame turns about the grip point (the jaw
      // tips) and the legs step round (the gait's turn and sideways sweep follow it)
      let gx = x;
      let gy = y;
      let gh = h;
      if (M && s.m2 && s.m2.kbOff > 1e-4) {
        // a heavy hit's knockback (antMotion.ts): the ground frame shoved back, the legs step to catch up
        gx -= Math.cos(h) * s.m2.kbOff;
        gy -= Math.sin(h) * s.m2.kbOff;
      }
      if (M) {
        s.piv = damp(s.piv ?? 0, fighting ? plan.piv : 0, 10, dt);
        if (Math.abs(s.piv) > 1e-4) {
          const d = rig.mouth.x * scale;
          gx += d * (Math.cos(h) - Math.cos(h + s.piv));
          gy += d * (Math.sin(h) - Math.sin(h + s.piv));
          gh = h + s.piv;
        }
      }
      if (M && s.m2) {
        if (catchUp) {
          const m = s.m2;
          m.hb = m.lastHb = gh + m.shuf;
          m.hw = 0;
          s.lastX = gx - Math.cos(gh) * m.vf * dt;
          s.lastY = gy - Math.sin(gh) * m.vf * dt;
        }
        stepMotion(s, s.m2, v, rig, { x: gx, y: gy, h: gh, lastX: s.lastX, lastY: s.lastY, dt, scale, mounted, mountSpeed: mounted ? mountOut.speed : 0, fighting, catchUp }, M);
        s.lastX = gx;
        s.lastY = gy;
        // sound hooks (spec 04): the grip of a sting series, the major's crunch, a landing on the back, righting, a death
        const q0 = s.aqPrev ?? 0;
        const q1 = s.aq ?? 0;
        s.aqPrev = q1;
        let sfx = M.sfx;
        if (fighting && q1 > q0) {
          if (s.av === 3 && !s.ahi && q0 < 0.2 && q1 >= 0.2) sfx = ANIM_SFX.GRIP;
          else if (s.av === 4 && q0 < 0.3 && q1 >= 0.3) sfx = ANIM_SFX.GRIP;
          else if (s.av === 5 && q0 < 0.7 && q1 >= 0.7) sfx = ANIM_SFX.CRUNCH;
          else if ((s.av ?? 0) >= ATK.SNAP && (s.av ?? 0) <= ATK.EXECUTE_P && q0 < ATTACK_CONTACT && q1 >= ATTACK_CONTACT) {
            // hell ants: the trap fires — a click and a puff of dust kicked up under the head (heavier for the slam,
            // the impale and the finisher; the chomp's bites are in the air)
            sfx = ANIM_SFX.SNAP;
            const d = rig.mouth.x * scale;
            const big = s.av === ATK.IMPALE || s.av === ATK.SLAM || s.av === ATK.EXECUTE_P;
            if (s.av !== ATK.CHOMP) animHooks.fx?.(x + Math.cos(h) * d, y + Math.sin(h) * d, this.space, rig.length * scale * (big ? 0.32 : 0.22));
          }
        }
        if (sfx && animHooks.emit) animHooks.emit(sfx, x, y, this.space, v.cause ?? 0, v.morph);
        s.lastH = M.h;
        s.seen = this.frame;
      } else {
        const stride = rig.stride * scale;
        if (catchUp) {
          s.lastX = x;
          s.lastY = y;
          s.lastH = h;
        }
        const moved = mounted ? mountOut.speed * dt : Math.hypot(x - s.lastX, y - s.lastY);
        let dhs = h - s.lastH;
        if (dhs > Math.PI) dhs -= Math.PI * 2;
        else if (dhs < -Math.PI) dhs += Math.PI * 2;
        const dh = Math.abs(dhs);
        const travel = (moved < stride * 2 ? moved : 0) + dh * rig.length * 0.35 * scale;
        s.lastX = x;
        s.lastY = y;
        s.lastH = h;
        s.seen = this.frame;
        const speed = dt > 0 ? travel / dt : 0;
        const wantAmp = v.dead ? 0 : Math.min(1, speed / (stride * 1.2) + (speed > 0.05 ? 0.35 : 0));
        if (!catchUp) s.amp = damp(s.amp, wantAmp, 12, dt);
        if (s.amp > 0.02 || travel > 0) s.phase += travel / stride;
        else s.phase += (Math.round(s.phase * 2) / 2 - s.phase) * Math.min(1, dt * 4); // settle feet
        const crest0 = (rig as { crest?: unknown }).crest;
        if (crest0 && dt > 0) {
          // Saiy-Ants: stiff but springy hair: a 2 Hz damped spring pushed by turning; the tips lag the head
          const want = Math.max(-1, Math.min(1, -(dhs / dt) * 0.3));
          const k = 158; // (2π·2 Hz)²
          const ds = Math.min(dt, 1 / 40); // keep the explicit spring stable on slow frames
          s.swv = (s.swv ?? 0) + (k * (want - (s.sw ?? 0)) - 8.8 * (s.swv ?? 0)) * ds;
          s.sw = Math.max(-1.5, Math.min(1.5, (s.sw ?? 0) + s.swv * ds));
        }
      }
      const clock = M ? M.clock : 1;
      // Head, antennae, mandibles, gaster smoothing
      s.hy = damp(s.hy, v.headYaw + (M ? M.headYaw : 0), 8, dt);
      s.hp = damp(s.hp, v.headPitch + (v.carrying && !v.carryUnder ? 0.3 : 0) + (M ? M.headPitch : 0), 6, dt);
      // Saiy-Ants: the low lock reaches the neck, so the head never pitches far enough to push it into the thorax
      if ((rig as { crest?: unknown }).crest) s.hp = Math.max(s.hp, -0.3);
      const mandT = M && M.mand >= 0 ? Math.max(v.mandible, M.mand) : v.mandible;
      s.mo = damp(s.mo, mandT, v.snap ? 60 : mandT > s.mo ? 22 : 10, dt);
      s.ap = damp(s.ap, v.antennaPitch + (M ? M.antPitch : 0), 5, dt);
      s.gp = damp(s.gp, v.gaster, 6, dt);
      s.cr = damp(s.cr, v.crop, 1.5, dt);
      s.ck = damp(s.ck ?? 0, v.crouch ?? 0, 7, dt);
      const act = M ? Math.max(v.antennaActivity, M.antAct) : v.antennaActivity;
      s.wave += dt * clock * (0.5 + act * 2.5 + s.amp * 0.6) * (v.waveMul ?? 1) * (s.m2 ? s.m2.waveK : 1);
      if (!M) s.death = damp(s.death, v.dead ? 1 : 0, 4, dt);
      s.roll = damp(s.roll, v.roll, 10, dt);
      // melee attack: this cycle's attack pose (attackPoses.ts), eased in and out of the fight
      s.aw = damp(s.aw ?? 0, fighting ? 1 : 0, fighting ? 12 : M ? 9 : 6, dt);
      let hy = s.hy;
      let hp = s.hp;
      let mo = s.mo;
      let gp = s.gp + (M ? M.gaster : 0);
      const aw = s.aw ?? 0;
      let stingW = 0;
      if (aw > 0.001) {
        if (M) attackPoseV2(s.av ?? 0, s.aq ?? 0, s.as ?? 1, atkP, !!s.ahi, !!s.aho);
        else attackPose(s.av ?? 0, s.aq ?? 0, s.as ?? 1, atkP);
        hy += atkP.headYaw * aw;
        hp += atkP.headPitch * aw;
        mo += (atkP.mand - mo) * aw;
        // (planted-feet pass: the attack sets the gaster outright — added to the sim's stinging curl it went too far)
        gp = M ? gp + (atkP.gaster - gp) * aw : gp + atkP.gaster * aw;
        stingW = atkP.sting * aw;
        if ((rig as { crest?: unknown }).crest) hp = Math.max(hp, -0.3); // Saiy-Ants: the low lock stays clear of the thorax
      }
      // poses crossfade: out, then the next one in (the animation pass blends faster: 0.1–0.25 s)
      // (planted-feet pass: in a fight the attack itself curls the gaster and shows the sting; the sim's stinging pose
      // would hold the legs in a fixed stance)
      const wantPose = M ? (fighting && M.pose === POSE.STING ? POSE.NONE : M.pose) : v.pose;
      // (user rating A2: a roughness in the legs between animations — the planted-feet pass now fades a pose's leg
      // angles out and in over about a quarter of a second, not a tenth)
      if (wantPose !== s.pose) {
        s.poseW = damp(s.poseW, 0, M ? 11 : 10, dt);
        if (s.poseW < 0.05) {
          s.pose = wantPose;
          s.pph = M && s.m2 ? s.m2.seed * 3 : 0;
        }
      } else s.poseW = damp(s.poseW, wantPose ? 1 : 0, M ? 7 : 6, dt);
      s.pph += dt * clock * (s.pose === POSE.DIG ? 2.6 : s.pose === POSE.GROOM_ANT || s.pose === POSE.GROOM_LEGS ? 1.1 : 1.0);
      let poseOut = s.pose;
      let poseWOut = s.poseW;
      if (stingW > 0.02 && !M) {
        // grip and sting: the sting slides out as the gaster swings under
        poseOut = POSE.STING;
        poseWOut = stingW;
      }

      // World transform
      if (mounted) {
        vP.copy(mountOut.p);
        vU.copy(mountOut.u);
        s.nx = vU.x;
        s.ny = vU.y;
        s.nz = vU.z;
        vF.copy(mountOut.f);
      } else {
        adapter.toWorld(gx, gy, vP);
        adapter.normal(gx, gy, vU);
        s.nx = damp(s.nx, vU.x, 10, dt);
        s.ny = damp(s.ny, vU.y, 10, dt);
        s.nz = damp(s.nz, vU.z, 10, dt);
        vU.set(s.nx, s.ny, s.nz).normalize();
        adapter.forward(M ? M.h : h, vF);
      }
      vF.addScaledVector(vU, -vF.dot(vU)).normalize();
      // (planted-feet pass: the yaw, pitch and roll of lean, flinch and attack are the body's offset over its feet,
      // below; the ground frame only carries the heading, the ground's slope and a tumble or death roll)
      const pitch = M ? 0 : v.pitch;
      if (pitch) vF.applyAxisAngle(vR.crossVectors(vF, vU).normalize(), pitch);
      vR.crossVectors(vF, vU).normalize();
      vU.crossVectors(vR, vF).normalize();
      if (M) {
        vF0.copy(vF);
        vU0.copy(vU);
        // animation pass: the lean, a flung ant's tumble, the death roll
        if (M.spinPitch) {
          vF.applyAxisAngle(vR, M.spinPitch);
          vU.applyAxisAngle(vR, M.spinPitch);
        }
        const r = M.deathRoll + M.spinRoll;
        if (Math.abs(r) > 1e-4) {
          vU.applyAxisAngle(vF, r);
          vR.crossVectors(vF, vU).normalize();
        }
      } else if (s.death > 0.01 || Math.abs(s.roll) > 0.001) {
        // Dead ants tip onto their side/back; stagger rolls.
        const r = s.death * 2.4 + s.roll;
        vU.applyAxisAngle(vF, r);
        vR.crossVectors(vF, vU).normalize();
      }
      if (aw > 0.001 && !M) applyAttackBody(atkP, aw, rig.length * scale, vF, vU, vR, vP);
      tmpM.makeBasis(vF, vU, vR);
      tmpQ.setFromRotationMatrix(tmpM);
      if (M) {
        // ---- spec 04: the body's offset over its planted feet (object units; the shader solves the legs for it)
        const Lr = rig.length;
        const w = aw > 0.001 ? aw : 0;
        qB.setFromAxisAngle(AX_Y, atkP.yaw * w + M.yaw);
        qB.multiply(qT.setFromAxisAngle(AX_Z, atkP.pitch * w + M.pitch + v.pitch));
        qB.multiply(qT.setFromAxisAngle(AX_X, atkP.roll * w + M.roll + s.roll));
        vT.set(atkP.fwd * w * Lr + M.fwd / scale, atkP.up * w * Lr, atkP.side * w * Lr + M.side / scale);
        // turned about a pivot at the body's height (along the body by the pose's px), not about the ground point
        vPiv.set(atkP.px * w * Lr + (v.pivX ?? 0) * Lr, rig.stance, 0);
        vT.add(vPiv).sub(vPiv.applyQuaternion(qB));
        // (user 2026-11-01: walking and fighting under majors) crouched: the body lowered over its feet, the legs bend;
        // the head and gaster tip up just enough to stay off the ground (below, the body rises for what is left)
        const ck = s.ck ?? 0;
        if (ck > 1e-3) {
          vT.y -= ck / scale;
          const floor = Lr * 0.015 - vT.y;
          // (whichever way of turning lifts it: head up, gaster tip up)
          const hd = lowestHead(rig, hp + 0.05, qB) > lowestHead(rig, hp - 0.05, qB) ? 0.08 : -0.08;
          for (let i = 0; i < 6 && lowestHead(rig, hp, qB) < floor; i++) hp += hd;
          const gd = lowestGaster(rig, gp + 0.05, qB) > lowestGaster(rig, gp - 0.05, qB) ? 0.08 : -0.08;
          for (let i = 0; i < 6 && lowestGaster(rig, gp, qB) < floor; i++) gp += gd;
        }
        // (hell ants, user note 2026-11-02 "make sure animations dont phase through the ground"): the open scythes swing
        // down and forward — the head rises until the lowest point of the posed blades is clear of the ground
        if ((rig as { mandPts?: unknown }).mandPts) for (let i = 0; i < 14 && lowestJaw(rig, hp, mo, qB) + vT.y < Lr * 0.02; i++) hp += 0.05;
        // (user ratings A5, A6, F7, L7, L8: attacks and rears sank the jaws, the head or the gaster into the ground)
        // the lowest of the jaw tips, the chin and the gaster tip as posed — head and gaster turned, the body pitched —
        // stays 1.5 % of the body length above the ground: the body rises over its planted feet, the legs straighten
        vT.y += Math.max(0, Lr * 0.015 - lowestPosed(rig, hp, gp, qB) - vT.y);
        if (qB.w < 0) qB.set(-qB.x, -qB.y, -qB.z, -qB.w);
        const ang = 2 * Math.acos(Math.min(1, qB.w));
        const sh = Math.sin(ang / 2);
        const k = sh > 1e-6 ? ang / sh : 0;
        bodyBuf[0] = vT.x;
        bodyBuf[1] = vT.y;
        bodyBuf[2] = vT.z;
        bodyBuf[3] = M.Dz;
        bodyBuf[4] = qB.x * k;
        bodyBuf[5] = qB.y * k;
        bodyBuf[6] = qB.z * k;
        // (crushed: the feet pushed out a little as it is pressed down)
        bodyBuf[7] = atkP.spread * w + M.squash * 0.35;
        bodyBuf[8] = atkP.gYaw * w;
        bodyBuf[9] = stingW;
        bodyBuf[10] = Math.max(atkP.front * w, v.front ?? 0);
        bodyBuf[11] = M.decap;
        bodyBuf[12] = v.dry ?? 0;
        bodyBuf[13] = M.squash;
        vP.addScaledVector(vF, vT.x * scale).addScaledVector(vU, vT.y * scale).addScaledVector(vR, vT.z * scale);
        tmpQ.multiply(qB);
        // (a dead ant rolled about its long axis through the ground point: lift it so its lowest point — the back
        // or a flank — rests on the ground; blind review: the body sank and only a leg showed)
        // (the same for a flung ant lying on its back after landing, rolled or pitched over)
        const dr = M.deathRoll + M.spinRoll;
        const dp = M.spinPitch;
        let rest = 0;
        if (Math.abs(dr) > 1e-3 || Math.abs(dp) > 1e-3) {
          const top = rig.bodyTop ?? rig.stance * 2.5;
          const mid = (rig.stance + top) / 2;
          const hw = rig.bodyHalfW ?? rig.stance;
          const c = Math.cos(dr);
          const lowR = Math.min(rig.stance * c, top * c, mid * c - hw * Math.abs(Math.sin(dr)));
          const cp = Math.cos(dp);
          const lowP = Math.min(rig.stance * cp, top * cp, mid * cp - rig.length * 0.42 * Math.abs(Math.sin(dp)));
          rest = Math.max(0, -lowR, -lowP) * (1 - M.tumbleC);
        }
        if (M.tumbleC > 1e-3) {
          // in the air the tumble turns about the body's middle: keep that point where it was before the turn
          const cx = (rig.headTip.x + rig.gasterTip.x) / 2;
          const cy = (rig.stance + (rig.bodyTop ?? rig.stance * 2.5)) / 2;
          const k = M.tumbleC * scale;
          vP.addScaledVector(vF0, cx * k).addScaledVector(vU0, cy * k).addScaledVector(vF, -cx * k).addScaledVector(vU, -cy * k);
        }
        // (mounted: the mount point already carries it — a held ant's sim height would lift it twice)
        // (along the ground's normal, not the body's up: a corpse on its back sinking was lifted instead — user rating A9)
        vP.addScaledVector(vN.set(s.nx, s.ny, s.nz).normalize(), (mounted ? 0 : v.lift) + M.up + rest);
      } else vP.addScaledVector(vU, (mounted ? 0 : v.lift) + s.death * rig.stance * 0.3);
      // released from jaws or a back: ease from where it was drawn to the sim's position instead of popping
      if (mounted) {
        s.mx = vP.x;
        s.my = vP.y;
        s.mz = vP.z;
        s.wasMounted = true;
        s.gx = s.gy = s.gz = 0;
      } else {
        if (s.wasMounted) {
          s.wasMounted = false;
          s.gx = (s.mx ?? vP.x) - vP.x;
          s.gy = (s.my ?? vP.y) - vP.y;
          s.gz = (s.mz ?? vP.z) - vP.z;
        }
        if (s.gx || s.gy || s.gz) {
          const k = Math.exp(-dt * 9);
          s.gx = (s.gx ?? 0) * k;
          s.gy = (s.gy ?? 0) * k;
          s.gz = (s.gz ?? 0) * k;
          if (Math.abs(s.gx) + Math.abs(s.gy) + Math.abs(s.gz) < 1e-3) s.gx = s.gy = s.gz = 0;
          vP.x += s.gx;
          vP.y += s.gy;
          vP.z += s.gz;
        }
      }
      vS.setScalar(scale);
      tmpM.compose(vP, tmpQ, vS);
      if (v.carrying && !v.carryUnder && !v.dead) this.recordHold(v.id, rig, hp, hy);
      // the hell ants' finisher (user rating A2: "it just looks like the ant is floating, make it on the neck"): the
      // lifting hell ant records its mandible–horn socket as posed; the foe's neck is put on it (a frame behind at most)
      const sock = (rig as { hold?: THREE.Vector3 }).hold;
      if (v.special === 4 && !v.dead && sock) this.recordHold(v.id, rig, hp, hy, sock);
      // a nasute soldier squirting (the ant pipeline): the glue from its nasus tip to the target
      const nt = (rig as { nasusTip?: THREE.Vector3 }).nasusTip;
      if (nt && v.firing && !v.dead && v.aimX !== undefined && v.aimY !== undefined) {
        if (!this.nasGlue) {
          this.nasGlue = new GlueStreams(64, NASUTE_GLUE);
          this.group.add(this.nasGlue.mesh);
        }
        if (this.nasGlueN < this.nasGlue.capacity) {
          this.recordHold(-v.id, rig, hp, hy, nt);
          const tip = this.holds.get(-v.id)!;
          _gt.set(tip.x, tip.y, tip.z);
          adapter.toWorld(v.aimX, v.aimY, _ga);
          adapter.normal(v.aimX, v.aimY, _gn);
          _ga.addScaledVector(_gn, 1.2);
          this.nasGlue.set(this.nasGlueN++, _gt, _ga, v.ramp ?? 0, true, (v.id * 0.618) % 1);
        }
      }
      if (v.neckBy && !v.dead) {
        const jh = this.holds.get(v.neckBy);
        if (jh && this.frame - jh.frame <= 2) {
          _jp.copy(rig.neck).applyMatrix4(tmpM);
          vP.x += jh.x - _jp.x;
          vP.y += jh.y - _jp.y;
          vP.z += jh.z - _jp.z;
          tmpM.compose(vP, tmpQ, vS);
          // (let go: it eases from here to where the sim has it, as from a creature's jaws)
          s.mx = vP.x;
          s.my = vP.y;
          s.mz = vP.z;
          s.wasMounted = true;
        }
      }

      // Cull + LOD by projected size
      sphere.center.copy(vP);
      sphere.radius = rig.length * scale * 0.9;
      if (!frustum.intersectsSphere(sphere)) continue;
      const dist = Math.max(1e-3, camPos.distanceTo(vP));
      const px = (rig.length * scale * pxPerMmAt1) / dist;
      const T0 = this.lod0Px / this.lodScale;
      const T1 = this.lod1Px / this.lodScale;
      let want = px > T0 ? 0 : px > T1 ? 1 : 2;
      if (v.selected && want === 2) want = 1;
      // LOD cross-fade (performance pass): a change of model dissolves over LOD_FADE seconds (both drawn, each in the
      // other's dithered pixels) instead of popping; a little hysteresis keeps an ant at a switching size from
      // flickering. An ant that just came into view, a camera cut and a new space take the LOD at once, as before.
      if (s.lod === undefined || s.lodSeen !== this.frame - 1 || cut) {
        s.lod = want;
        s.lodFrom = -1;
        s.lodT = 1;
      } else if (want !== s.lod) {
        const edge = want < s.lod ? (s.lod === 2 ? T1 : T0) : s.lod === 0 ? T0 : T1;
        const hold = want < s.lod ? px < edge * LOD_HYST : px > edge / LOD_HYST;
        if (!hold || (v.selected && s.lod === 2)) {
          if (s.lodFrom === want && s.lodT! < 1) {
            s.lodFrom = s.lod;
            s.lodT = 1 - s.lodT!;
          } else {
            s.lodFrom = s.lod;
            s.lodT = 0;
          }
          s.lod = want;
        }
      }
      if (s.lodT! < 1) {
        s.lodT = Math.min(1, s.lodT! + dt / LOD_FADE);
        if (s.lodT >= 1) s.lodFrom = -1;
      }
      s.lodSeen = this.frame;
      const lod = s.lod;
      const glueAt = lod < 2 ? lod : s.lodFrom! >= 0 && s.lodFrom! < 2 ? s.lodFrom! : -1;
      // the shown LOD, then the one fading out (fade: 0 whole; t > 0 the pixels below t; −t the pixels at or above t;
      // packed into aE.z with "exhausted")
      for (let pass = 0; pass < 2; pass++) {
        const l = pass === 0 ? lod : s.lodFrom!;
        if (l < 0) break;
        const fade = s.lodFrom! < 0 ? 0 : pass === 0 ? Math.max(0.002, s.lodT!) : -s.lodT!;
        let m = tmpM;
        if (l === 2 && px < this.minImpostorPx) {
          // Keep swarms readable when zoomed far out: clamp the on-screen size.
          const boost = Math.min(4, this.minImpostorPx / Math.max(px, 0.5));
          vSb.setScalar(scale * boost);
          m = tmpMb.compose(vP, tmpQ, vSb);
        }
        let n = b.counts[l];
        if (n >= b.capacity[l]) {
          b.alloc(l, b.capacity[l] * 2, this.shadows);
        }
        const mesh = b.meshes[l];
        const at = b.attrs[l];
        n = b.counts[l]++;
        mesh.setMatrixAt(n, m);
        if (l < 2 && b.bodyTex[l]) {
          if (M) b.writeBody(l, n, bodyBuf);
          else b.writeBody(l, n, zeroBody);
        }
        at.a.setXYZW(n, s.phase, s.amp, hy, hp);
        at.b.setXYZW(n, mo, act * 0.3 + (v.antennaPitch > 0.5 ? 0.6 : 0) + (M ? M.antSpread : 0), s.ap, s.wave);
        // pose id + 0.99 × its weight; the hit flash
        // (the rage glow rides in the same channel: + 2 × its level 0..10 — user rating E7: a glow in the body, not the
        // whole ant turned red)
        at.c.setXYZW(n, gp, s.cr, poseOut + Math.min(1, Math.max(0, poseWOut)) * 0.99, (M ? M.flash : 0) + 2 * Math.round(Math.min(1, Math.max(0, v.rageGlow ?? 0)) * 10));
        // colour variation −1..1, plus 4 × the Termant tint code (decoded in the shader); the planted feet's stance sweep
        at.d.setXYZW(n, M ? M.deathLeg : s.death, M ? M.Dh : 0, Math.max(-1, Math.min(1, v.colorVar)) + 4 * (v.tint ?? 0), s.pph);
        // gold × ripple direction, the planted feet's turn per stance, exhausted with the LOD fade, hair sway
        at.e.setXYZW(n, (v.gold ?? 0) * ((v.goldDir ?? 1) < 0 ? -1 : 1), M ? M.Ps : 0, packExhaustedFade(v.exhausted ?? 0, fade), s.sw ?? 0);
        // termite glue clinging to the ant (render only), on one of the two while they cross-fade
        if (pass === 0) {
          // eases in, wears off slowly; a sickle-jaw's acid uses the same wet shell (the kit's acid and glue colours
          // are nearly the same pale amber)
          const gw = Math.max(v.glue ?? 0, v.acid ?? 0);
          s.gl = damp(s.gl ?? 0, gw, gw > (s.gl ?? 0) ? 4 : 0.6, dt);
        }
        if (l === glueAt && s.gl! > 0.02) b.addShell(l, n, s.gl!);
      }
      st.drawn++;
      st.lod[lod]++;
    }
    for (const b of this.buckets.values()) {
      for (let l = 0; l < 3; l++) {
        const mesh = b.meshes[l];
        mesh.count = b.counts[l];
        // (an empty model is hidden: the renderer would still bind its program and uniforms every frame)
        mesh.visible = b.counts[l] > 0;
        if (b.counts[l] > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          const at = b.attrs[l];
          at.a.needsUpdate = at.b.needsUpdate = at.c.needsUpdate = at.d.needsUpdate = at.e.needsUpdate = true;
          const bt = b.bodyTex[l];
          if (bt) bt.needsUpdate = true;
          // Only upload the used range.
          for (const attr of [mesh.instanceMatrix, at.a, at.b, at.c, at.d, at.e]) {
            attr.clearUpdateRanges();
            attr.addUpdateRange(0, b.counts[l] * attr.itemSize);
          }
        }
      }
    }
    for (const b of this.buckets.values()) b.commitShell();
    this.termites?.end();
    if (this.nasGlue) {
      this.nasGlue.count = this.nasGlueN;
      this.nasGlue.commit();
    }
    // Forget animation state of ants not seen for a while.
    if (this.frame % 120 === 0) for (const [id, s] of this.anim) if (this.frame - s.seen > 240) this.anim.delete(id);
  }

  /** The jaw hold of `id` drawn this frame (or null: not carrying, or not drawn). */
  holdOf(id: number): JawHold | null {
    const h = this.holds.get(id);
    return h && h.frame === this.frame ? h : null;
  }

  /** The point between the closed jaw tips on the posed head (pitch about the neck, then yaw), in the world (tmpM). */
  private recordHold(id: number, rig: AntRig, hp: number, hy: number, at?: THREE.Vector3): void {
    const jt = rig.jawTip;
    const mx = at ? at.x : jt ? rig.mouth.x + (jt.x - rig.mouth.x) * 0.7 : rig.mouth.x;
    const my = at ? at.y : jt ? (rig.mouth.y + jt.y) / 2 : rig.mouth.y;
    const dx = mx - rig.neck.x;
    const dy = my - rig.neck.y;
    const cp = Math.cos(hp);
    const sp = Math.sin(hp);
    const cy = Math.cos(hy);
    const sy = Math.sin(hy);
    const x1 = dx * cp - dy * sp;
    const y1 = dx * sp + dy * cp;
    _jp.set(rig.neck.x + x1 * cy, rig.neck.y + y1, rig.neck.z - x1 * sy).applyMatrix4(tmpM);
    _jf.set(cp * cy, sp, -cp * sy).transformDirection(tmpM);
    let h = this.holds.get(id);
    if (!h) this.holds.set(id, (h = { x: 0, y: 0, z: 0, fx: 1, fy: 0, fz: 0, frame: 0 }));
    h.x = _jp.x;
    h.y = _jp.y;
    h.z = _jp.z;
    h.fx = _jf.x;
    h.fy = _jf.y;
    h.fz = _jf.z;
    h.frame = this.frame;
    if (this.frame % 240 === 0) for (const [k, o] of this.holds) if (this.frame - o.frame > 60) this.holds.delete(k);
  }

  /** Approximate world position of an ant's mandible tips (for carried items). */
  mouthWorld(morph: string): THREE.Vector3 {
    if (morph.startsWith('termite_') && !NASUTE_ANT_PATH.has(morph)) return new THREE.Vector3(1.5, 0.8, 0);
    return this.bucket(morph).rig.mouth;
  }
}
