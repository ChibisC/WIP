/**
 * Shared material + instancing helpers for the termite rig.
 *
 * One body material, one glue-shell material and one depth material serve EVERY caste and LOD:
 * per-caste rig data lives in a small float texture (termiteRigTexture), filled automatically when
 * a caste geometry is built and passed to TermiteInstances.
 *
 *   const geo = buildTermiteGeometry('nasute', 0);
 *   const herd = new TermiteInstances(geo, 512, { glueShell: true });
 *   scene.add(herd.group);
 *   herd.setMatrix(i, m);                 // world transform (include UNITS_PER_MM scale)
 *   herd.setState(i, AnimState.WALK, { rate: gaitRateForSpeed(geo.userData.rig, speedMmS) });
 *   herd.setFire(i, rampFraction, aimYaw, aimPitch, firing);
 *   herd.commit();                        // flags dirty attributes for upload
 *   // every frame: termiteTime.value = clock seconds (one shared uniform)
 */
import {
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  Quaternion,
  MeshPhysicalMaterial,
  NearestFilter,
  RGBADepthPacking,
  RGBAFormat,
  Vector3,
} from 'three';
import { ACID_COLOR, ACID_HOT_COLOR, GLUE_COLOR, PALE } from './castes';
import { AIM, AnimState, AnimStateId, Carry, HOLD, LUNGE_SNAP, RIG_ROWS, RigCol, TermiteRig } from './rig';
import {
  TERMITE_BEGIN,
  TERMITE_BEGINNORMAL,
  TERMITE_BEGIN_DEPTH,
  TERMITE_CLEARCOAT,
  TERMITE_FRAGMENT_PARS,
  TERMITE_SURFACE,
  TERMITE_VERTEX_PARS,
} from './shaders';

/** One global clock for every termite material. Set .value = seconds each frame. */
export const termiteTime = { value: 0 };

/** Shared rig texture: RigCol.COUNT x RIG_ROWS texels, RGBA32F. */
export const termiteRigTexture = new DataTexture(new Float32Array(RigCol.COUNT * RIG_ROWS * 4), RigCol.COUNT, RIG_ROWS, RGBAFormat, FloatType);
termiteRigTexture.magFilter = NearestFilter;
termiteRigTexture.minFilter = NearestFilter;
termiteRigTexture.generateMipmaps = false;
termiteRigTexture.needsUpdate = true;

/** write a caste's rig row into the shared texture (done automatically by TermiteInstances) */
export function registerTermiteRig(rig: TermiteRig) {
  const data = termiteRigTexture.image.data as Float32Array;
  data.set(rig.texRow, rig.row * RigCol.COUNT * 4);
  termiteRigTexture.needsUpdate = true;
}

const sharedUniforms = {
  uTermiteTime: termiteTime,
  uRigTex: { value: termiteRigTexture },
  uPale: { value: new Color(PALE) },
  uGlueColor: { value: new Color(GLUE_COLOR) },
  uAcidColor: { value: new Color(ACID_COLOR) },
  uAcidHot: { value: new Color(ACID_HOT_COLOR) },
};

/**
 * Shader patches in the SAME format as Underground Dominion's material patch helper
 * (applyPatch(material, { key, uniforms, defines, vertexHeader, fragmentHeader, vertex: [[marker, replacement]], fragment: [...] })).
 * Headers are inserted before "void main() {"; markers are replaced in order.
 * In the game, pass these to its own patch helper so they chain with its world-pos / dapple patches.
 */
export interface ShaderPatch {
  key: string;
  uniforms?: Record<string, { value: unknown }>;
  defines?: Record<string, string>;
  vertexHeader?: string;
  fragmentHeader?: string;
  vertex?: [string, string][];
  fragment?: [string, string][];
}

export const termiteBodyPatch = (): ShaderPatch => ({
  key: 'termiteAnim',
  uniforms: sharedUniforms,
  vertexHeader: TERMITE_VERTEX_PARS,
  fragmentHeader: TERMITE_FRAGMENT_PARS,
  vertex: [
    ['#include <beginnormal_vertex>', TERMITE_BEGINNORMAL],
    ['#include <begin_vertex>', TERMITE_BEGIN],
  ],
  fragment: [
    ['#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + TERMITE_SURFACE],
    ['#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + TERMITE_CLEARCOAT],
  ],
});
export const termiteShellPatch = (): ShaderPatch => ({ ...termiteBodyPatch(), key: 'termiteAnim', defines: { GLUE_SHELL: '' } });
export const termiteDepthPatch = (): ShaderPatch => ({
  key: 'termiteAnimDepth',
  uniforms: sharedUniforms,
  vertexHeader: TERMITE_VERTEX_PARS,
  vertex: [['#include <begin_vertex>', TERMITE_BEGIN_DEPTH]],
});

/** standalone copy of the game's patch helper (identical semantics) */
export function applyPatch(material: any, patch: ShaderPatch) {
  const m = material;
  if (!m.__patches) {
    m.__patches = [];
    m.onBeforeCompile = (s: any) => {
      for (const r of m.__patches as ShaderPatch[]) {
        if (r.uniforms) Object.assign(s.uniforms, r.uniforms);
        if (r.defines) s.defines = Object.assign(s.defines || {}, r.defines);
        if (r.vertexHeader) s.vertexShader = s.vertexShader.replace('void main() {', r.vertexHeader + '\nvoid main() {');
        if (r.fragmentHeader) s.fragmentShader = s.fragmentShader.replace('void main() {', r.fragmentHeader + '\nvoid main() {');
        for (const [a, b] of r.vertex ?? []) {
          if (!s.vertexShader.includes(a)) console.warn(`[patch ${r.key}] vertex marker missing: ${a}`);
          s.vertexShader = s.vertexShader.replace(a, b);
        }
        for (const [a, b] of r.fragment ?? []) {
          if (!s.fragmentShader.includes(a)) console.warn(`[patch ${r.key}] fragment marker missing: ${a}`);
          s.fragmentShader = s.fragmentShader.replace(a, b);
        }
      }
    };
  }
  m.__patches = (m.__patches as ShaderPatch[]).filter((x) => x.key !== patch.key);
  m.__patches.push(patch);
  const key = (m.__patches as ShaderPatch[]).map((x) => x.key + (x.defines ? JSON.stringify(x.defines) : '')).join('|');
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
}

let bodyMat: MeshPhysicalMaterial | null = null;
let shellMat: MeshPhysicalMaterial | null = null;
let depthMat: MeshDepthMaterial | null = null;

/** the single shared termite body material (all castes, all LODs); same base settings as the game's ants */
export function getTermiteMaterial(): MeshPhysicalMaterial {
  if (bodyMat) return bodyMat;
  bodyMat = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    sheen: 1,
    sheenRoughness: 0.6,
    sheenColor: new Color(0.16, 0.13, 0.09),
    envMapIntensity: 0.55,
  });
  applyPatch(bodyMat, termiteBodyPatch());
  return bodyMat;
}

/** translucent glue-strand shell, drawn as a second pass with the same geometry + instances */
export function getTermiteGlueShellMaterial(): MeshPhysicalMaterial {
  if (shellMat) return shellMat;
  shellMat = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.06, metalness: 0, clearcoat: 1, transparent: true, depthWrite: false, side: DoubleSide });
  applyPatch(shellMat, termiteShellPatch());
  return shellMat;
}

/** depth material so shadows follow the animated pose */
export function getTermiteDepthMaterial(): MeshDepthMaterial {
  if (depthMat) return depthMat;
  depthMat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  applyPatch(depthMat, termiteDepthPatch());
  return depthMat;
}

// ---------------------------------------------------------------------------
// Instancing
// ---------------------------------------------------------------------------

export interface StateOptions {
  /** cycles per second for cyclic states (walk: gaitRateForSpeed; chew: bites/s; ram ~2; bite ~3) */
  rate?: number;
  /** 0..1 progress for one-shot states (DEATH, SETTLE, QUEEN egg-lay) */
  stateT?: number;
  /** cross-fade duration in seconds (default 0.15) */
  blend?: number;
}

export class TermiteInstances {
  readonly group = new Group();
  readonly mesh: InstancedMesh;
  readonly shell?: InstancedMesh;
  readonly rig: TermiteRig;
  private aAnim: InstancedBufferAttribute;
  private aAnim2: InstancedBufferAttribute;
  private aLook: InstancedBufferAttribute;
  private aBlend: InstancedBufferAttribute;
  private aTint: InstancedBufferAttribute;
  private aFx: InstancedBufferAttribute;

  /**
   * opts.glueShell / opts.fxShell (same thing): draw the second, translucent pass that shows glue strands
   * (setLook glue) and acid droplets + fizz (setFx). Needed on any termite that can be glued or squirted.
   */
  constructor(geometry: BufferGeometry, readonly capacity: number, opts: { glueShell?: boolean; fxShell?: boolean; castShadow?: boolean } = {}) {
    this.rig = geometry.userData.rig as TermiteRig;
    registerTermiteRig(this.rig);
    const geo = geometry.clone(); // instance attributes live on this mesh's own geometry
    geo.userData.rig = this.rig;
    this.aAnim = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aAnim2 = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aLook = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aBlend = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aTint = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.aFx = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (let i = 0; i < capacity; i++) {
      this.aLook.setXYZW(i, 1, Carry.NONE, 0, hash01(i));
      this.aBlend.setXYZW(i, 0, -1e6, 0, 0.15);
    }
    geo.setAttribute('aAnim', this.aAnim);
    geo.setAttribute('aAnim2', this.aAnim2);
    geo.setAttribute('aLook', this.aLook);
    geo.setAttribute('aBlend', this.aBlend);
    geo.setAttribute('aTint', this.aTint);
    geo.setAttribute('aFx', this.aFx);
    this.mesh = new InstancedMesh(geo, getTermiteMaterial(), capacity);
    this.mesh.customDepthMaterial = getTermiteDepthMaterial();
    this.mesh.castShadow = opts.castShadow ?? true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // vertex animation moves geometry outside the rest bounds
    this.group.add(this.mesh);
    if (opts.glueShell || opts.fxShell) {
      this.shell = new InstancedMesh(geo, getTermiteGlueShellMaterial(), capacity);
      this.shell.instanceMatrix = this.mesh.instanceMatrix; // share transforms
      this.shell.frustumCulled = false;
      this.shell.renderOrder = 2;
      this.group.add(this.shell);
    }
    this.count = 0;
  }

  get count() {
    return this.mesh.count;
  }
  set count(n: number) {
    this.mesh.count = n;
    if (this.shell) this.shell.count = n;
  }

  setMatrix(i: number, m: Matrix4) {
    this.mesh.setMatrixAt(i, m);
  }

  /** change animation state with a cross-fade; keeps gait phase continuous */
  setState(i: number, state: AnimStateId, o: StateOptions = {}) {
    const now = termiteTime.value;
    const prev = this.aAnim.getX(i);
    const prevT = this.aAnim.getW(i);
    const rate = o.rate ?? defaultRate(state);
    const cyc = this.aAnim.getY(i) + now * this.aAnim.getZ(i);
    if (prev !== state) this.aBlend.setXYZW(i, prev, now, prevT, o.blend ?? 0.15);
    this.aAnim.setXYZW(i, state, cyc - now * rate, rate, o.stateT ?? 0);
  }

  /** raw animation write: phase0 in cycles (e.g. a per-unit offset), rate in cycles/s, no cross-fade */
  setAnim(i: number, state: AnimStateId, phase0: number, rate: number, stateT = 0) {
    this.aAnim.setXYZW(i, state, phase0, rate, stateT);
    this.aBlend.setXYZW(i, state, -1e6, stateT, 0.15);
  }

  /** change cycle rate only (e.g. speed changed) without a phase jump */
  setRate(i: number, rate: number) {
    const now = termiteTime.value;
    const cyc = this.aAnim.getY(i) + now * this.aAnim.getZ(i);
    this.aAnim.setY(i, cyc - now * rate);
    this.aAnim.setZ(i, rate);
  }

  setStateT(i: number, t: number) {
    this.aAnim.setW(i, t);
  }

  /** nasute FIRE pose inputs: ramp 0..1 (from the sim), aim angles from computeAim(), firing flag */
  setFire(i: number, rampFraction: number, aimYaw: number, aimPitch: number, firing: boolean) {
    this.aAnim2.setXYZW(i, rampFraction, aimYaw, aimPitch, firing ? 1 : 0);
  }

  /**
   * v2 Sickle-Jaw soldier HOLD inputs: ramp 0..1 from the sim, squirting flag, optional small aim offsets (rad)
   * to steer the nasus onto a victim that is larger or smaller than an ant.
   */
  setHold(i: number, rampFraction: number, squirting: boolean, aimYawOffset = 0, aimPitchOffset = 0) {
    this.aAnim2.setXYZW(i, rampFraction, aimYawOffset, aimPitchOffset, squirting ? 1 : 0);
  }

  /** v2: STRUGGLE intensity 0..1 for a termite held by an enemy soldier (fade toward 0 as it dies) */
  setStruggle(i: number, intensity: number) {
    this.aAnim2.setX(i, intensity);
  }

  /**
   * v2: acid droplets on this termite (0..1, visual only) and fizz (0..1); needs fxShell.
   * v2.1: age (queens only): 0 young pale ivory .. 0.5 yellow-amber .. 1 old honey-brown; null = the caste default.
   */
  setFx(i: number, o: { acid?: number; fizz?: number; age?: number | null }) {
    if (o.acid !== undefined) this.aFx.setX(i, o.acid);
    if (o.fizz !== undefined) this.aFx.setY(i, o.fizz);
    if (o.age !== undefined) this.aFx.setZ(i, o.age === null ? 0 : 1 + Math.min(1, Math.max(0, o.age)));
  }

  /** v2.1 ATTEND (king / attendants beside the queen): head yaw toward her (rad, clamped to +-0.6 in the shader) */
  setAttend(i: number, headYawToQueen: number) {
    this.aAnim2.setY(i, headYawToQueen);
  }

  /** tan: 0 pale presoldier/larva .. 1 adult; carry: Carry.*; glue: 0..1 visual glue level; seed 0..1 */
  setLook(i: number, o: { tan?: number; carry?: number; glue?: number; seed?: number }) {
    if (o.tan !== undefined) this.aLook.setX(i, o.tan);
    if (o.carry !== undefined) this.aLook.setY(i, o.carry);
    if (o.glue !== undefined) this.aLook.setZ(i, o.glue);
    if (o.seed !== undefined) this.aLook.setW(i, o.seed);
  }

  /** per-instance colour multiplier for the cuticle (team colours, subtle variation) */
  setTint(i: number, r: number, g: number, b: number) {
    this.aTint.setXYZ(i, r, g, b);
  }

  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aAnim.needsUpdate = true;
    this.aAnim2.needsUpdate = true;
    this.aLook.needsUpdate = true;
    this.aBlend.needsUpdate = true;
    this.aTint.needsUpdate = true;
    this.aFx.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

function defaultRate(state: number) {
  switch (state) {
    case AnimState.CHEW:
      return 1 / 0.3;
    case AnimState.GROOM:
      return 1.2;
    case AnimState.DIG:
      return 1.5;
    case AnimState.RAM:
      return 2;
    case AnimState.BITE:
      return 3;
    case AnimState.STRUGGLE:
      return 1;
    default:
      return 0;
  }
}

function hash01(i: number) {
  let x = (i + 1) * 2654435761;
  x ^= x >>> 13;
  x = Math.imul(x, 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// gameplay-facing helpers
// ---------------------------------------------------------------------------

/** gait cycles per second for a ground speed (mm/s) with no foot slip */
export function gaitRateForSpeed(rig: TermiteRig, speedMmPerSec: number) {
  return speedMmPerSec / rig.strideLength;
}

/** head aim angles toward a target given in the termite's MODEL space (mm) */
export function computeAim(rig: TermiteRig, localTarget: Vector3) {
  const v = localTarget.clone().sub(new Vector3(...rig.neck));
  const yaw = Math.atan2(-v.z, v.x);
  const pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
  return { yaw, pitch };
}

/**
 * Nasus tip in MODEL space for the FIRE pose (the glue stream's start point).
 * Mirrors the shader exactly: head pitch about Z then yaw about Y around the neck pivot,
 * then the FIRE body pose (pitch 0.035 rad about the body pivot, lowered 5% of body height).
 */
export function nasusTipLocal(rig: TermiteRig, aimYaw: number, aimPitch: number, out = new Vector3()) {
  if (!rig.nasusTip) return out.set(0, 0, 0);
  const yaw = Math.max(-AIM.yawLimit, Math.min(AIM.yawLimit, aimYaw));
  const pitch = Math.max(AIM.pitchMin, Math.min(AIM.pitchMax, aimPitch)) + AIM.pitchBias;
  const nk = new Vector3(...rig.neck);
  out.set(...rig.nasusTip).sub(nk);
  out.applyAxisAngle(new Vector3(0, 0, 1), pitch).applyAxisAngle(new Vector3(0, 1, 0), yaw).add(nk);
  const bp = new Vector3(rig.pivots[0], rig.pivots[1], rig.pivots[2]);
  out.sub(bp).applyAxisAngle(new Vector3(0, 0, 1), 0.035).add(bp);
  out.y -= 0.05 * rig.bodyHeight;
  return out;
}

// ---------------------------------------------------------------------------
// v2: Sickle-Jaw grab-and-squirt — CPU mirrors of the shader's LUNGE / HOLD pose.
// They reproduce termiteDeform() exactly for the head group (mandible hinge -> head pitch/yaw/push ->
// body roll/pitch/yaw/offset), so a held victim can be parented to the mandible tips and the acid stream
// can start at the nasus tip. Keep in sync with holdPose()/LUNGE in shaders.ts.
// ---------------------------------------------------------------------------

/** options shared by mandibleSocketLocal / holdNasusTipLocal */
export interface HoldPoseInput {
  /** AnimState.HOLD (default) or AnimState.LUNGE */
  state?: AnimStateId;
  /** LUNGE progress 0..1 (ignored for HOLD) */
  stateT?: number;
  /** termiteTime.value (seconds) */
  time: number;
  /** the soldier instance's seed (setLook seed, 0..1) */
  seed: number;
  ramp?: number;
  squirting?: boolean;
  aimYawOffset?: number;
  aimPitchOffset?: number;
}

interface HeadBody {
  head: [number, number, number]; // yaw, pitch, push (mm)
  mand: number;
  bodyOff: [number, number, number];
  bodyRot: [number, number, number]; // yaw, pitch, roll
}

const TAU = Math.PI * 2;
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, k: number) => a * (1 - k) + b * k;
const texCol = (rig: TermiteRig, col: number) => [0, 1, 2, 3].map((k) => rig.texRow[col * 4 + k]);

/** victim tug signals (same formula as holdTug() in the shader): x yaw jerk, y pitch, z pull-back */
export function holdTug(t: number): [number, number, number] {
  const a = 0.6 * Math.sin(t * 7.3) + 0.4 * Math.sin(t * 12.7 + 1.3);
  const b = 0.6 * Math.sin(t * 9.1 + 0.7) + 0.4 * Math.sin(t * 15.3 + 2.1);
  const c = Math.max(0, Math.sin(t * 5.2 + 0.4));
  return [Math.sign(a) * Math.sqrt(Math.abs(a)), b, c * c];
}

function holdRecoil(time: number, ramp: number, squirting: number, seed: number) {
  const rate = lerp(3, 12, ramp);
  const pulse = Math.pow(Math.max(0, Math.sin(TAU * time * rate + seed * 6)), 6);
  const jitter = 0.5 + 0.5 * Math.sin(time * 95 + seed * 13);
  return squirting * (pulse * (1 - ramp) + ramp * 0.35 * jitter);
}

function holdHeadBody(rig: TermiteRig, o: HoldPoseInput): HeadBody {
  const L = rig.bodyLength;
  const bh = rig.bodyHeight;
  const hr = rig.headRest ?? 0.06;
  const t = o.time + o.seed * 37;
  const fr = Math.min(1, Math.max(0, o.ramp ?? 0));
  const rc = holdRecoil(o.time, fr, o.squirting ? 1 : 0, o.seed);
  const tg = holdTug(t);
  const clampA = (v: number) => Math.max(-0.4, Math.min(0.4, v));
  return {
    head: [HOLD.tugYaw * tg[0] + clampA(o.aimYawOffset ?? 0), hr + HOLD.headPitch + HOLD.tugPitch * tg[1] + HOLD.recoilPitch * rc + clampA(o.aimPitchOffset ?? 0), -HOLD.tugPush * L * tg[2]],
    mand: HOLD.grip,
    bodyOff: [-0.012 * L * tg[2], -HOLD.crouch * bh, 0],
    bodyRot: [HOLD.tugBody * 0.5 * tg[0], HOLD.bodyPitch, HOLD.tugBody * 0.4 * tg[1]],
  };
}

function lungeHeadBody(rig: TermiteRig, o: HoldPoseInput): HeadBody {
  const L = rig.bodyLength;
  const bh = rig.bodyHeight;
  const [hr, mandRest, gape] = texCol(rig, RigCol.POSE);
  const s = Math.min(1, Math.max(0, o.stateT ?? 1));
  const wind = sstep(0, 0.3, s);
  const strike = sstep(0.26, LUNGE_SNAP, s);
  let mand = lerp(mandRest, gape, wind);
  mand = lerp(mand, HOLD.grip, sstep(LUNGE_SNAP - 0.07, LUNGE_SNAP, s));
  const pre: HeadBody = {
    head: [0, hr + 0.14 * wind * (1 - strike) + HOLD.headPitch * 0.8 * strike, 0.02 * L * strike],
    mand,
    bodyOff: [L * (-0.05 * wind * (1 - strike) + 0.17 * strike), -0.08 * bh * wind, 0],
    bodyRot: [0, 0.05 * wind * (1 - strike) - 0.06 * strike, 0],
  };
  const H = holdHeadBody(rig, o);
  const k = sstep(LUNGE_SNAP, LUNGE_SNAP + 0.16, s);
  const mix3 = (a: number[], b: number[]) => a.map((v, i) => lerp(v, b[i], k)) as [number, number, number];
  return { head: mix3(pre.head, H.head), mand: lerp(pre.mand, H.mand, k), bodyOff: mix3(pre.bodyOff, H.bodyOff), bodyRot: mix3(pre.bodyRot, H.bodyRot) };
}

const _X = new Vector3(1, 0, 0);
const _Y = new Vector3(0, 1, 0);
const _Z = new Vector3(0, 0, 1);

/** apply the head-group + body transform of the shader to a rest-space point (isDir: rotate only) */
function headGroupXform(rig: TermiteRig, P: HeadBody, v: Vector3, isDir: boolean, mandSide: 0 | -1 | 1) {
  const piv = (b: number) => new Vector3(rig.pivots[b * 3], rig.pivots[b * 3 + 1], rig.pivots[b * 3 + 2]);
  const rotAbout = (pv: Vector3, axis: Vector3, ang: number) => {
    if (isDir) v.applyAxisAngle(axis, ang);
    else v.sub(pv).applyAxisAngle(axis, ang).add(pv);
  };
  if (mandSide !== 0) {
    const ax = new Vector3(...texCol(rig, RigCol.MANDAX).slice(0, 3));
    const sgn = mandSide < 0 ? 1 : -1;
    ax.z *= sgn; // mirrored hinge for the right mandible (as in the shader)
    rotAbout(piv(mandSide < 0 ? 2 : 3), ax.normalize(), P.mand * sgn);
  }
  const nk = piv(1);
  rotAbout(nk, _Z, P.head[1]);
  rotAbout(nk, _Y, P.head[0]);
  if (!isDir) {
    const fwd = _X.clone().applyAxisAngle(_Z, P.head[1]).applyAxisAngle(_Y, P.head[0]);
    v.addScaledVector(fwd, P.head[2]);
  }
  const bp = piv(0);
  rotAbout(bp, _X, P.bodyRot[2]);
  rotAbout(bp, _Z, P.bodyRot[1]);
  rotAbout(bp, _Y, P.bodyRot[0]);
  if (!isDir) v.add(new Vector3(...P.bodyOff));
  return v;
}

function poseFor(rig: TermiteRig, o: HoldPoseInput) {
  return (o.state ?? AnimState.HOLD) === AnimState.LUNGE ? lungeHeadBody(rig, o) : holdHeadBody(rig, o);
}

/**
 * The grab socket in the soldier's MODEL space (mm) for HOLD (or LUNGE after the snap): position = midpoint of the
 * crossed mandible tips, orientation = the head frame (x forward along the head axis, y head-up, z right).
 * Victim world transform = soldier world * socket * (victim rotation) * translate(-victim grab point); see heldVictimTransform().
 */
export function mandibleSocketLocal(rig: TermiteRig, o: HoldPoseInput, out = new Matrix4()) {
  if (!rig.mandibleTips) return out.identity();
  const P = poseFor(rig, o);
  const a = headGroupXform(rig, P, new Vector3(...rig.mandibleTips[0]), false, -1);
  const b = headGroupXform(rig, P, new Vector3(...rig.mandibleTips[1]), false, 1);
  const pos = a.add(b).multiplyScalar(0.5);
  const fx = headGroupXform(rig, P, new Vector3(1, 0, 0), true, 0).normalize();
  const fy = headGroupXform(rig, P, new Vector3(0, 1, 0), true, 0).normalize();
  const fz = new Vector3().crossVectors(fx, fy).normalize();
  out.makeBasis(fx, fy, fz).setPosition(pos);
  return out;
}

/** nasus tip (acid stream start) in MODEL space for HOLD / LUNGE, mirroring the shader */
export function holdNasusTipLocal(rig: TermiteRig, o: HoldPoseInput, out = new Vector3()) {
  if (!rig.nasusTip) return out.set(0, 0, 0);
  out.set(...rig.nasusTip);
  return headGroupXform(rig, poseFor(rig, o), out, false, 0);
}

/**
 * Pitch offset (rad, pass as aimPitchOffset) that points the nasus AXIS at `target` (soldier MODEL space, mm), so the
 * jet leaves along the tube and lands there. Use a target on the victim's back about 2 mm behind its hooked point.
 */
export function holdAimAt(rig: TermiteRig, o: HoldPoseInput, target: Vector3): number {
  if (!rig.nasusTip || !rig.nasusDir) return 0;
  const P0 = new Vector3(...rig.nasusTip);
  const P1 = P0.clone().addScaledVector(new Vector3(...rig.nasusDir), -0.5);
  const cost = (p: number) => {
    const pose = poseFor(rig, { ...o, aimPitchOffset: p });
    const tip = headGroupXform(rig, pose, P0.clone(), false, 0);
    const d = tip.clone().sub(headGroupXform(rig, pose, P1.clone(), false, 0)).normalize();
    const v = target.clone().sub(tip);
    const along = v.dot(d);
    return v.addScaledVector(d, -along).length() + (along < 0.15 ? 5 + (0.15 - along) : 0);
  };
  let best = 0;
  let bc = Infinity;
  for (let i = 0; i <= 40; i++) {
    const p = -0.4 + (0.8 * i) / 40;
    const c = cost(p);
    if (c < bc) {
      bc = c;
      best = p;
    }
  }
  let lo = Math.max(-0.4, best - 0.02);
  let hi = Math.min(0.4, best + 0.02);
  for (let i = 0; i < 20; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (cost(a) < cost(b)) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
}

/**
 * World transform for a victim held in the socket. victimGrab = the point of the victim that is hooked (its own
 * model space): use a FRONT-LOW point (its mandibles / a front leg near the ground),
 * so its body lies in front of the soldier, under the nasus. victimRot = the victim's orientation relative to the socket
 * frame (default: facing the soldier). The returned quaternion includes the socket's head tilt; for a victim that
 * should stay level, keep only its yaw. Scale is left to the caller.
 */
export function heldVictimTransform(
  soldierWorld: Matrix4,
  rig: TermiteRig,
  o: HoldPoseInput,
  victimGrab: Vector3,
  victimRot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI),
  victimScale = 1,
  level = true,
) {
  const sock = mandibleSocketLocal(rig, o);
  const sockW = new Matrix4().multiplyMatrices(soldierWorld, sock);
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  sockW.decompose(p, q, s);
  if (level) {
    // keep the victim upright: only the yaw of the head frame (incl. the tug's yaw jerks) is applied
    const fwd = new Vector3(1, 0, 0).applyQuaternion(q);
    q.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-fwd.z, fwd.x));
  }
  const rot = q.clone().multiply(victimRot);
  const pos = victimGrab.clone().multiplyScalar(-victimScale * s.x).applyQuaternion(rot).add(p);
  return { position: pos, quaternion: rot };
}

/**
 * Squirt at a target the soldier is NOT holding (big creatures, bosses): play HOLD (planted squirt pose) and pass
 * the returned aim offsets to setHold(); the stream starts at nasusTip. Yaw from the neck toward the target and
 * pitch from holdAimAt(), both clamped to +-0.4 rad like the shader. target is in the soldier's MODEL space (mm).
 */
export function solveFreeSquirt(rig: TermiteRig, o: HoldPoseInput, target: Vector3) {
  const yaw = Math.max(-0.4, Math.min(0.4, computeAim(rig, target).yaw));
  const o2 = { ...o, state: AnimState.HOLD, aimYawOffset: yaw };
  const pitch = holdAimAt(rig, o2, target);
  const tip = holdNasusTipLocal(rig, { ...o2, aimPitchOffset: pitch });
  return { aimYawOffset: yaw, aimPitchOffset: pitch, nasusTip: tip };
}

/**
 * One call per frame per held victim (soldier MODEL space, mm; multiply by the soldier's world matrix for world):
 * places the victim in the mandible socket (level, facing the soldier), tilts the head so the nasus points at the
 * victim's back, and returns the acid stream's start (nasus tip) and end (hit point).
 *   victimGrab   victim-space point that is hooked: front-low (its mandibles / a front leg near the ground)
 *   victimBack   victim-space point the acid hits: the top of its body about 2 mm (0.45 soldier lengths) behind
 *                the hooked point AFTER scaling, i.e. x = victimGrab.x - 2.0 / victimScale (an ant's mesosoma /
 *                petiole), so the jet leaves along the tube and is visible (about 0.6-0.9 mm long)
 *   o.seed       the soldier instance's seed: set it explicitly with setLook({ seed }) from a deterministic
 *                per-entity value and pass the same number here, so the CPU mirror matches the shader
 * Feed aimPitchOffset back into setHold() so the shader uses the same aim. The tug moves the head a little each
 * frame; the stream follows because it is re-solved every frame.
 */
export function solveHoldOnVictim(rig: TermiteRig, o: HoldPoseInput, victimGrab: Vector3, victimBack: Vector3, victimScale = 1, groundY = 0) {
  const I = new Matrix4();
  let aimPitchOffset = o.aimPitchOffset ?? 0;
  // the victim never sinks below the ground the soldier stands on (model y = groundY): if the socket dips lower than
  // the hooked point, the mandible tips simply sit lower on the victim's front
  const place = () => {
    const t = heldVictimTransform(I, rig, { ...o, aimPitchOffset }, victimGrab, undefined, victimScale);
    t.position.y = Math.max(t.position.y, groundY);
    return t;
  };
  let tr = place();
  let hit = victimBack.clone().multiplyScalar(victimScale).applyQuaternion(tr.quaternion).add(tr.position);
  for (let k = 0; k < 3; k++) {
    aimPitchOffset = holdAimAt(rig, o, hit);
    tr = place();
    hit = victimBack.clone().multiplyScalar(victimScale).applyQuaternion(tr.quaternion).add(tr.position);
  }
  const tip = holdNasusTipLocal(rig, { ...o, aimPitchOffset });
  return { aimPitchOffset, victimPosition: tr.position, victimQuaternion: tr.quaternion, nasusTip: tip, hitPoint: hit };
}

/**
 * Struggle motion for a held victim that is NOT a termite (the game's own ants): map these onto the ant renderer
 * (roll/pitch/yaw wobble, legs cycling in the air at legRate with legAmp, mandibles snapping, antennae whipping).
 * Uses the HOLDER's seed so the victim jerks against the soldier's tug.
 */
export function victimStruggle(time: number, holderSeed: number, intensity: number) {
  const t = time + holderSeed * 37;
  const tg = holdTug(t);
  const I = Math.min(1, Math.max(0, intensity));
  return {
    yaw: -0.22 * tg[0] * I,
    pitch: 0.1 * tg[1] * I,
    roll: 0.32 * Math.sin(t * 6.1) * I,
    /** fraction of the victim's own body height to lift it off the ground */
    lift: 0.12 * I,
    legRate: 6 * I,
    legAmp: 1.4 * I,
    mandible: 0.45 * Math.max(0, Math.sin(t * 9)) * I,
    antennaWave: I,
  };
}

/**
 * Pitch offset (rad, pass as aimPitchOffset) that puts the nasus tip `standoff` mm above a victim whose back is at
 * height `victimTopY` in the soldier's MODEL space (mm). Taller victims raise the head, shorter ones lower it.
 * Uses tug-free HOLD pose; clamped to +-0.4 like the shader.
 */
export function holdAimOffset(rig: TermiteRig, victimTopY: number, standoff = 0.18) {
  const want = victimTopY + standoff;
  const tipY = (off: number) => holdNasusTipLocal(rig, { time: 0, seed: 0, ramp: 0, squirting: false, aimPitchOffset: off }).y;
  let lo = -0.4;
  let hi = 0.4;
  if (tipY(lo) > want) return lo;
  if (tipY(hi) < want) return hi;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (tipY(m) < want) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
