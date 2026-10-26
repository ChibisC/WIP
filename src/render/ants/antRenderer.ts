import * as THREE from 'three';
import { AntRig, buildAnt } from './antGeometry';
import { createAntMaterials, createAntGlueShell, POSE, TINT_GLSL } from './antMaterial';
import { AttackPose, applyAttackBody, attackPose, neutralPose } from './attackPoses';
import { AntMorph, MORPHS } from './morphs';
import { addPatch, patchDapple } from '../shaderPatch';
import { TermiteLayer } from '../termite/termiteLayer';

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
  /** 0..1 crop fullness: a replete ant's gaster swells */
  crop: number;
  /** render scale multiplier (nanitics are smaller, upgraded ants a little larger) */
  scale?: number;
  /** 0..1 extra scale variation */
  sizeVar: number;
  colorVar: number;
  /** vertical lift (e.g. flung through the air), mm */
  lift: number;
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
  phase: number;
  amp: number;
  wave: number;
  hy: number;
  hp: number;
  mo: number;
  ap: number;
  gp: number;
  cr: number;
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
  /** melee attack: blend weight, last phase, attack, side */
  aw?: number;
  aq?: number;
  av?: number;
  as?: number;
}

const LOD_NAMES = ['lod0', 'lod1', 'imp'] as const;

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

  constructor(public key: string, private group: THREE.Group, impostor: { geo: THREE.BufferGeometry; mat: THREE.Material }, shadows: boolean) {
    this.morph = MORPHS[key];
    const b0 = buildAnt(this.morph, 0, 3);
    const b1 = buildAnt(this.morph, 1, 3);
    this.rig = b1.rig;
    const m0 = createAntMaterials(b0.rig, true);
    const m1 = createAntMaterials(b1.rig, true);
    this.geos = [b0.geometry, b1.geometry, impostor.geo];
    this.mats = [m0.material, m1.material, impostor.mat];
    this.depths = [m0.depth, m1.depth, undefined];
    for (let l = 0; l < 3; l++) this.alloc(l, l === 0 ? 64 : 256, shadows);
  }

  alloc(l: number, cap: number, shadows: boolean): void {
    const old = this.meshes[l];
    if (old) {
      this.group.remove(old);
      old.dispose();
    }
    const geo = this.geos[l].clone();
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
    mesh.frustumCulled = false;
    mesh.castShadow = shadows && l < 2;
    mesh.receiveShadow = l < 2;
    if (this.depths[l]) mesh.customDepthMaterial = this.depths[l];
    mesh.name = `ants:${this.key}:${LOD_NAMES[l]}`;
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
  private shellMat: THREE.MeshStandardMaterial | null = null;

  /** Copy instance `n` of LOD `l` into the glue shell with glue amount `g`. */
  addShell(l: number, n: number, g: number): void {
    let mesh = this.shell[l];
    const k = this.shellN[l];
    if (!mesh || k >= mesh.instanceMatrix.count) {
      const cap = mesh ? mesh.instanceMatrix.count * 2 : 16;
      this.shellMat ??= createAntGlueShell(this.rig);
      const geo = this.geos[l].clone();
      const mk = (size = 4) => new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage);
      const at = { a: mk(), b: mk(), c: mk(), d: mk(), e: mk(), g: mk(1) };
      geo.setAttribute('aA', at.a);
      geo.setAttribute('aB', at.b);
      geo.setAttribute('aC', at.c);
      geo.setAttribute('aD', at.d);
      geo.setAttribute('aE', at.e);
      geo.setAttribute('aGlue', at.g);
      const next = new THREE.InstancedMesh(geo, this.shellMat, cap);
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
    this.shellN[l] = k + 1;
  }

  commitShell(): void {
    for (let l = 0; l < 2; l++) {
      const mesh = this.shell[l];
      if (!mesh) continue;
      mesh.count = this.shellN[l];
      if (!mesh.count) continue;
      const at = this.shellAt[l]!;
      mesh.instanceMatrix.needsUpdate = true;
      for (const attr of [at.a, at.b, at.c, at.d, at.e, at.g]) attr.needsUpdate = true;
    }
  }
}

const tmpShellM = new THREE.Matrix4();
const atkP = neutralPose({} as AttackPose);

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const vF = new THREE.Vector3();
const vU = new THREE.Vector3();
const vR = new THREE.Vector3();
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
export class AntRenderer {
  group = new THREE.Group();
  private buckets = new Map<string, Bucket>();
  private anim = new Map<number, AnimState>();
  private frame = 0;
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
  /** climbing ants: placed on the creature's animated leg or body (set by the session) */
  mount: MountFn | null = null;

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

  rig(morph: string): AntRig {
    return this.bucket(morph).rig;
  }

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      const imp = this.impostorFor(key);
      b = new Bucket(key, this.group, { geo: this.impostorGeo, mat: imp }, this.shadows);
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Render the ant from above into an 8-frame gait atlas used by far LOD quads. */
  private impostorFor(key: string): THREE.MeshStandardMaterial {
    let mat = this.impostorMats.get(key);
    if (mat) return mat;
    const morph = MORPHS[key];
    const built = buildAnt(morph, 1, 3);
    const { material } = createAntMaterials(built.rig, false);
    const cols = 4;
    const rows = 2;
    const cell = 128;
    const rt = new THREE.WebGLRenderTarget(cols * cell, rows * cell, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
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
    mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.35, transparent: false, roughness: 0.6, side: THREE.DoubleSide });
    patchDapple(mat);
    addPatch(mat, {
      key: 'impostor',
      uniforms: { uSpan: { value: span } },
      vertexHeader: 'attribute vec4 aA; attribute vec4 aD; attribute vec4 aE; uniform float uSpan; varying vec2 vGoldI; varying float vTintI;',
      fragmentHeader: 'varying vec2 vGoldI; varying float vTintI;',
      // far away a Saiy-Ant in its gold surge still reads as a gold speck; exhausted ones look dull
      fragment: [
        [
          '#include <map_fragment>',
          `#include <map_fragment>
           diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.78, 0.55, 0.16), vec3(1.0, 0.84, 0.38), dot(diffuseColor.rgb, vec3(0.33)) * 1.6), clamp(vGoldI.x, 0.0, 1.0) * 0.85);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * 0.8, vGoldI.y * 0.5);
           ${TINT_GLSL('vTintI')}`,
        ],
      ],
      vertex: [
        ['#include <begin_vertex>', 'vGoldI = vec2(aE.x, aE.z); vTintI = floor((aD.z + 2.0) / 4.0);\n#include <begin_vertex>'],
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
    return mat;
  }

  /**
   * Update all instance buffers. `views` are ants in the space being rendered.
   * alpha = sim interpolation factor; dt = real frame time (s).
   */
  update(views: AntView[], alpha: number, dt: number, camera: THREE.PerspectiveCamera, adapter: AntSpaceAdapter, viewportH: number): void {
    this.frame++;
    for (const b of this.buckets.values()) {
      b.counts.fill(0);
      b.shellN.fill(0);
    }
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    const pxPerMmAt1 = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const camPos = camera.position;
    const st = this.stats;
    st.drawn = 0;
    st.lod[0] = st.lod[1] = st.lod[2] = 0;
    this.termites?.begin(dt);
    if (this.termites) this.termites.mount = this.mount;

    for (const v of views) {
      if (v.morph.startsWith('termite_')) {
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
      const h = lerpAngle(v.pheading, v.heading, alpha);
      if (!s) {
        s = { phase: Math.random(), amp: 0, wave: Math.random() * 10, hy: 0, hp: 0, mo: 0, ap: 0, gp: 0, cr: 0, pose: 0, poseW: 0, pph: Math.random() * 10, death: v.dead ? 1 : 0, nx: 0, ny: 1, nz: 0, lastX: x, lastY: y, lastH: h, seen: this.frame, roll: 0 };
        this.anim.set(v.id, s);
      }
      // on a creature: its animated leg or back decides where the ant is (and how fast it climbs)
      const mounted = !!v.rideCr && !!this.mount && this.mount(v, alpha, mountOut);
      // Gait: phase advances by distance travelled / stride length, so feet never slide.
      const scale = (1 + v.sizeVar * 0.12) * (v.scale ?? 1);
      const stride = rig.stride * scale;
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
      s.amp = damp(s.amp, wantAmp, 12, dt);
      if (s.amp > 0.02 || travel > 0) s.phase += travel / stride;
      else s.phase += (Math.round(s.phase * 2) / 2 - s.phase) * Math.min(1, dt * 4); // settle feet
      // Head, antennae, mandibles, gaster smoothing
      s.hy = damp(s.hy, v.headYaw, 8, dt);
      s.hp = damp(s.hp, v.headPitch + (v.carrying && !v.carryUnder ? 0.3 : 0), 6, dt);
      const crest = (rig as { crest?: unknown }).crest;
      if (crest) {
        // Saiy-Ants: the low lock reaches the neck, so the head never pitches far enough to push it into the thorax
        s.hp = Math.max(s.hp, -0.3);
        // stiff but springy hair: a 2 Hz damped spring pushed by turning; the tips lag the head
        if (dt > 0) {
          const want = Math.max(-1, Math.min(1, -(dhs / dt) * 0.3));
          const k = 158; // (2π·2 Hz)²
          const ds = Math.min(dt, 1 / 40); // keep the explicit spring stable on slow frames
          s.swv = (s.swv ?? 0) + (k * (want - (s.sw ?? 0)) - 8.8 * (s.swv ?? 0)) * ds;
          s.sw = Math.max(-1.5, Math.min(1.5, (s.sw ?? 0) + s.swv * ds));
        }
      }
      s.mo = damp(s.mo, v.mandible, v.snap ? 60 : v.mandible > s.mo ? 22 : 10, dt);
      s.ap = damp(s.ap, v.antennaPitch, 5, dt);
      s.gp = damp(s.gp, v.gaster, 6, dt);
      s.cr = damp(s.cr, v.crop, 1.5, dt);
      s.wave += dt * (0.5 + v.antennaActivity * 2.5 + s.amp * 0.6) * (v.waveMul ?? 1);
      s.death = damp(s.death, v.dead ? 1 : 0, 4, dt);
      s.roll = damp(s.roll, v.roll, 10, dt);
      // melee attack: this cycle's attack pose (attackPoses.ts), eased in and out of the fight
      const fighting = v.atk !== undefined;
      s.aw = damp(s.aw ?? 0, fighting ? 1 : 0, fighting ? 12 : 6, dt);
      if (fighting) {
        s.aq = v.atk;
        s.av = v.atkVar ?? 0;
        s.as = v.atkSide ?? 1;
      }
      let hy = s.hy;
      let hp = s.hp;
      let mo = s.mo;
      const aw = s.aw ?? 0;
      if (aw > 0.001) {
        attackPose(s.av ?? 0, s.aq ?? 0, s.as ?? 1, atkP);
        hy += atkP.headYaw * aw;
        hp += atkP.headPitch * aw;
        mo += (atkP.mand - mo) * aw;
        if ((rig as { crest?: unknown }).crest) hp = Math.max(hp, -0.3); // Saiy-Ants: the low lock stays clear of the thorax
      }
      if (v.pose !== s.pose) {
        s.poseW = damp(s.poseW, 0, 10, dt);
        if (s.poseW < 0.05) {
          s.pose = v.pose;
          s.pph = 0;
        }
      } else s.poseW = damp(s.poseW, v.pose ? 1 : 0, 6, dt);
      s.pph += dt * (s.pose === POSE.DIG ? 2.6 : s.pose === POSE.GROOM_ANT || s.pose === POSE.GROOM_LEGS ? 1.1 : 1.0);

      // World transform
      if (mounted) {
        vP.copy(mountOut.p);
        vU.copy(mountOut.u);
        s.nx = vU.x;
        s.ny = vU.y;
        s.nz = vU.z;
        vF.copy(mountOut.f);
      } else {
        adapter.toWorld(x, y, vP);
        adapter.normal(x, y, vU);
        s.nx = damp(s.nx, vU.x, 10, dt);
        s.ny = damp(s.ny, vU.y, 10, dt);
        s.nz = damp(s.nz, vU.z, 10, dt);
        vU.set(s.nx, s.ny, s.nz).normalize();
        adapter.forward(h, vF);
      }
      vF.addScaledVector(vU, -vF.dot(vU)).normalize();
      if (v.pitch) vF.applyAxisAngle(vR.crossVectors(vF, vU).normalize(), v.pitch);
      vR.crossVectors(vF, vU).normalize();
      vU.crossVectors(vR, vF).normalize();
      if (s.death > 0.01 || Math.abs(s.roll) > 0.001) {
        // Dead ants tip onto their side/back; stagger rolls.
        const r = s.death * 2.4 + s.roll;
        vU.applyAxisAngle(vF, r);
        vR.crossVectors(vF, vU).normalize();
      }
      if (aw > 0.001) applyAttackBody(atkP, aw, rig.length * scale, vF, vU, vR, vP);
      tmpM.makeBasis(vF, vU, vR);
      tmpQ.setFromRotationMatrix(tmpM);
      vP.addScaledVector(vU, v.lift + s.death * rig.stance * 0.3);
      vS.setScalar(scale);
      tmpM.compose(vP, tmpQ, vS);

      // Cull + LOD by projected size
      sphere.center.copy(vP);
      sphere.radius = rig.length * scale * 0.9;
      if (!frustum.intersectsSphere(sphere)) continue;
      const dist = Math.max(1e-3, camPos.distanceTo(vP));
      const px = (rig.length * scale * pxPerMmAt1) / dist;
      let lod = px > this.lod0Px / this.lodScale ? 0 : px > this.lod1Px / this.lodScale ? 1 : 2;
      if (v.selected && lod === 2) lod = 1;
      if (lod === 2 && px < this.minImpostorPx) {
        // Keep swarms readable when zoomed far out: clamp the on-screen size.
        const boost = Math.min(4, this.minImpostorPx / Math.max(px, 0.5));
        vS.setScalar(scale * boost);
        tmpM.compose(vP, tmpQ, vS);
      }
      let n = b.counts[lod];
      if (n >= b.capacity[lod]) {
        b.alloc(lod, b.capacity[lod] * 2, this.shadows);
      }
      const mesh = b.meshes[lod];
      const at = b.attrs[lod];
      n = b.counts[lod]++;
      mesh.setMatrixAt(n, tmpM);
      at.a.setXYZW(n, s.phase, s.amp, hy, hp);
      at.b.setXYZW(n, mo, v.antennaActivity * 0.3 + (v.antennaPitch > 0.5 ? 0.6 : 0), s.ap, s.wave);
      at.c.setXYZW(n, s.gp, s.cr, s.pose, s.poseW);
      // colour variation −1..1, plus 4 × the Termant tint code (decoded in the shader)
      at.d.setXYZW(n, s.death, v.carrying ? 1 : 0, Math.max(-1, Math.min(1, v.colorVar)) + 4 * (v.tint ?? 0), s.pph);
      at.e.setXYZW(n, v.gold ?? 0, v.goldDir ?? 1, v.exhausted ?? 0, s.sw ?? 0);
      // termite glue clinging to the ant (render only): eases in, wears off slowly; a sickle-jaw's acid uses the
      // same wet shell (the kit's acid and glue colours are nearly the same pale amber)
      const gw = Math.max(v.glue ?? 0, v.acid ?? 0);
      s.gl = damp(s.gl ?? 0, gw, gw > (s.gl ?? 0) ? 4 : 0.6, dt);
      if (s.gl > 0.02 && lod < 2) b.addShell(lod, n, s.gl);
      st.drawn++;
      st.lod[lod]++;
    }
    for (const b of this.buckets.values()) {
      for (let l = 0; l < 3; l++) {
        const mesh = b.meshes[l];
        mesh.count = b.counts[l];
        if (b.counts[l] > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          const at = b.attrs[l];
          at.a.needsUpdate = at.b.needsUpdate = at.c.needsUpdate = at.d.needsUpdate = at.e.needsUpdate = true;
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
    // Forget animation state of ants not seen for a while.
    if (this.frame % 120 === 0) for (const [id, s] of this.anim) if (this.frame - s.seen > 240) this.anim.delete(id);
  }

  /** Approximate world position of an ant's mandible tips (for carried items). */
  mouthWorld(morph: string): THREE.Vector3 {
    if (morph.startsWith('termite_')) return new THREE.Vector3(1.5, 0.8, 0);
    return this.bucket(morph).rig.mouth;
  }
}
