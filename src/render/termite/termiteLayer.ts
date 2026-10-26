import * as THREE from 'three';
import { buildTermiteGeometry } from './build';
import { CASTES, CasteId, WORKER_VARIANT_SCALE } from './castes';
import { getTermiteMaterial, nasusTipLocal, computeAim, termiteTime, TermiteInstances, holdAimAt, holdNasusTipLocal, solveFreeSquirt, HoldPoseInput } from './material';
import { AnimState, TermiteRig } from './rig';
import { ACID_STREAM, AcidFizz, GlueStreams } from './glue';
import { patchDapple } from '../shaderPatch';
import type { AntSpaceAdapter, AntView, MountFn, MountOut } from '../ants/antRenderer';
import { ATTACK_CONTACT, AttackPose, applyAttackBody, attackPose, neutralPose } from '../ants/attackPoses';

/**
 * The termites (Nasute and Sickle-Jaw) in the game's ant renderer (model kit
 * v2.1): one TermiteInstances set per caste and LOD (0/1/2 by projected size),
 * plus a second set with the kit's effects shell for units wearing glue or
 * acid; per-unit gait phase kept here; the nasute glue stream drawn from the
 * exact nasus tip to the target; the sickle-jaw's LUNGE / HOLD with the head
 * aimed at its victim, the acid jet and the fizz; held termites STRUGGLE; the
 * king's ATTEND head aim (queens keep the kit's default age). Fed the same
 * AntViews as the ants; a morph `termite_<kit caste>` comes here.
 */
const casteOf = (morph: string): CasteId | null => {
  const c = morph.startsWith('termite_') ? morph.slice(8) : '';
  return c in CASTES ? (c as CasteId) : null;
};

let dapplePatched = false;

interface Unit {
  /** melee attack: blend weight, last phase, attack, side */
  aw: number;
  aq: number;
  av: number;
  as: number;
  phase: number;
  lastX: number;
  lastY: number;
  nx: number;
  ny: number;
  nz: number;
  seen: number;
  glue: number;
  acid: number;
  /** sickle-jaw squirt aim, re-solved every few frames (the solver searches the head pitch) */
  aimP: number;
  aimY: number;
  aimF: number;
}

const vF = new THREE.Vector3();
const vU = new THREE.Vector3();
const vR = new THREE.Vector3();
const vP = new THREE.Vector3();
const vS = new THREE.Vector3();
const vT = new THREE.Vector3();
const vH = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const invM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const atkP = neutralPose({} as AttackPose);

const mountOut: MountOut = { p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), speed: 0 };
const holdIn: HoldPoseInput = { time: 0, seed: 0 };

export class TermiteLayer {
  /** climbing termites: placed on the creature's animated leg or body (shared with the ant renderer) */
  mount: MountFn | null = null;
  group = new THREE.Group();
  private sets = new Map<string, Array<TermiteInstances | null>>();
  private counts = new Map<string, number[]>();
  private units = new Map<number, Unit>();
  private glue = new GlueStreams(256, { diameter: 0.22, dropletSpeed: 45 });
  private glueN = 0;
  /** sickle-jaw acid jets and the fizz on their targets (visual only) */
  private acid = new GlueStreams(128, { ...ACID_STREAM, diameter: 0.16 });
  private acidN = 0;
  private fizz = new AcidFizz(128);
  private fizzN = 0;
  private frame = 0;
  private clock = 0;
  /** glue on targets (render-only): id → 0..1 */
  glued = new Map<number, number>();

  constructor() {
    if (!dapplePatched) {
      patchDapple(getTermiteMaterial());
      dapplePatched = true;
    }
    this.group.name = 'termites';
    this.group.add(this.glue.mesh, this.acid.mesh, this.fizz.mesh);
  }

  isTermite(morph: string): boolean {
    return casteOf(morph) !== null;
  }

  begin(dt: number): void {
    this.frame++;
    this.clock += dt;
    termiteTime.value = this.clock;
    for (const c of this.counts.values()) c.fill(0);
    this.glueN = 0;
    this.acidN = 0;
    this.fizzN = 0;
  }

  rig(morph: string): TermiteRig {
    return this.inst(casteOf(morph) ?? 'worker', 1).rig;
  }

  /** the instance set for a caste and LOD; `fx`: the one with the glue / acid shell pass */
  private inst(caste: CasteId, lod: number, fx = false): TermiteInstances {
    const key = fx ? caste + ':fx' : caste;
    let s = this.sets.get(key);
    if (!s) {
      s = [null, null, null];
      this.sets.set(key, s);
      this.counts.set(key, [0, 0, 0]);
    }
    let t = s[lod];
    const n = this.counts.get(key)![lod];
    if (!t || n >= t.capacity) {
      const cap = t ? t.capacity * 2 : fx ? 16 : lod === 0 ? 32 : 128;
      const next = new TermiteInstances(buildTermiteGeometry(caste, lod), cap, { castShadow: lod < 2, fxShell: fx });
      if (t) {
        this.group.remove(t.group);
        t.dispose();
      }
      next.count = 0;
      this.group.add(next.group);
      s[lod] = t = next;
    }
    return t;
  }

  add(v: AntView, alpha: number, dt: number, adapter: AntSpaceAdapter, camPos: THREE.Vector3, pxPerMmAt1: number, frustum: THREE.Frustum, sphere: THREE.Sphere): void {
    const caste = casteOf(v.morph);
    if (!caste) return;
    const x = v.px + (v.x - v.px) * alpha;
    const y = v.py + (v.y - v.py) * alpha;
    let dh = v.heading - v.pheading;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    const h = v.pheading + dh * alpha;
    let u = this.units.get(v.id);
    if (!u) {
      u = { phase: (v.id * 0.618) % 1, lastX: x, lastY: y, nx: 0, ny: 1, nz: 0, seen: this.frame, glue: 0, acid: 0, aw: 0, aq: 0, av: 0, as: 1, aimP: 0, aimY: 0, aimF: -99 };
      this.units.set(v.id, u);
    }
    const base = this.inst(caste, 1).rig;
    const scale = (v.scale ?? 1) * (caste === 'worker' ? (v.variant === 1 ? WORKER_VARIANT_SCALE.female : WORKER_VARIANT_SCALE.male) : 1) * (1 + v.sizeVar * 0.05);
    // on a creature: its animated leg or back decides where the termite is (sim/climbing.ts)
    const mounted = !!v.rideCr && !!this.mount && this.mount(v, alpha, mountOut);
    const moved = mounted ? mountOut.speed * dt : Math.hypot(x - u.lastX, y - u.lastY);
    const speed = dt > 0 ? moved / dt : 0;
    u.lastX = x;
    u.lastY = y;
    u.seen = this.frame;
    // world transform: same frame as the ants (+X forward, +Y up, +Z right)
    if (mounted) {
      vP.copy(mountOut.p);
      vU.copy(mountOut.u);
      u.nx = vU.x;
      u.ny = vU.y;
      u.nz = vU.z;
      vF.copy(mountOut.f);
    } else {
      adapter.toWorld(x, y, vP);
      adapter.normal(x, y, vU);
      u.nx = damp(u.nx, vU.x, 10, dt);
      u.ny = damp(u.ny, vU.y, 10, dt);
      u.nz = damp(u.nz, vU.z, 10, dt);
      vU.set(u.nx, u.ny, u.nz).normalize();
      adapter.forward(h, vF);
    }
    vF.addScaledVector(vU, -vF.dot(vU)).normalize();
    vR.crossVectors(vF, vU).normalize();
    vU.crossVectors(vR, vF).normalize();
    if (Math.abs(v.roll) > 0.001) {
      vU.applyAxisAngle(vF, v.roll);
      vR.crossVectors(vF, vU).normalize();
    }
    // melee attack (workers, majors, king): one of the three attacks around the kit's BITE / RAM (attackPoses.ts)
    const fighting = v.atk !== undefined;
    u.aw = damp(u.aw, fighting ? 1 : 0, fighting ? 12 : 6, dt);
    if (fighting) {
      u.aq = v.atk!;
      u.av = v.atkVar ?? 0;
      u.as = v.atkSide ?? 1;
    }
    if (u.aw > 0.001) applyAttackBody(attackPose(u.av, u.aq, u.as, atkP), u.aw, base.bodyLength * scale, vF, vU, vR, vP);
    tmpM.makeBasis(vF, vU, vR);
    tmpQ.setFromRotationMatrix(tmpM);
    vP.addScaledVector(vU, v.lift);
    vS.setScalar(scale);
    tmpM.compose(vP, tmpQ, vS);
    sphere.center.copy(vP);
    sphere.radius = base.bodyLength * scale;
    if (!frustum.intersectsSphere(sphere)) return;
    const dist = Math.max(1e-3, camPos.distanceTo(vP));
    const px = (base.bodyLength * scale * pxPerMmAt1) / dist;
    const lod = px > 70 || v.selected ? 0 : px > 9 ? 1 : 2;
    // glue or acid on it: the set with the effects shell (LOD0/1; too small to see at LOD2)
    const gWant = Math.max(v.glue ?? 0, this.glued.get(v.id) ?? 0);
    u.glue = damp(u.glue, gWant, gWant > u.glue ? 4 : 0.6, dt);
    u.acid = damp(u.acid, v.acid ?? 0, (v.acid ?? 0) > u.acid ? 3 : 0.5, dt); // acid fades out over ~2 s after a release
    const fx = lod < 2 && (u.glue > 0.02 || u.acid > 0.02);
    const inst = this.inst(caste, lod, fx);
    const counts = this.counts.get(fx ? caste + ':fx' : caste)!;
    const i = counts[lod]++;
    inst.count = counts[lod];
    inst.setMatrix(i, tmpM);
    // animation
    const st = v.tState ?? (v.dead ? AnimState.DEATH : speed > 0.3 ? AnimState.WALK : AnimState.IDLE);
    let rate = v.tRate ?? 0;
    if (st === AnimState.WALK || st === AnimState.CHARGE) rate = speed / Math.max(0.1, inst.rig.strideLength * scale);
    u.phase += rate * dt;
    // the kit's bite / ram peaks a quarter of the way through its cycle: land it on the attack's contact
    if (fighting && (st === AnimState.BITE || st === AnimState.RAM)) u.phase = v.atk! - ATTACK_CONTACT + 0.25;
    inst.setAnim(i, st as never, u.phase - termiteTime.value * rate, rate, v.tStateT ?? (v.dead ? 1 : 0));
    // nasute fire: aim the head at the target, glue stream from the nasus tip
    let yaw = 0;
    let pitch = 0;
    if (st === AnimState.FIRE && v.aimX !== undefined && v.aimY !== undefined) {
      adapter.toWorld(v.aimX, v.aimY, vT);
      vT.addScaledVector(vU, 1.2);
      invM.copy(tmpM).invert();
      const local = vT.clone().applyMatrix4(invM);
      const aim = computeAim(inst.rig, local);
      yaw = aim.yaw;
      pitch = aim.pitch;
      if (v.firing && this.glueN < this.glue.capacity) {
        const tip = nasusTipLocal(inst.rig, yaw, pitch).applyMatrix4(tmpM);
        this.glue.set(this.glueN++, tip, vT, v.ramp ?? 0, true, (v.id * 0.618) % 1);
      }
    }
    inst.setFire(i, v.ramp ?? 0, yaw, pitch, !!v.firing);
    // sickle-jaw: LUNGE / HOLD, the head aimed at the victim's back (or a free target), the acid jet and fizz
    const seed = (v.id * 0.37) % 1;
    if ((st === AnimState.HOLD || st === AnimState.LUNGE) && v.aimX !== undefined && v.aimY !== undefined) this.squirt(v, u, inst, i, st, seed, adapter);
    if (st === AnimState.STRUGGLE) inst.setStruggle(i, v.held ?? 0);
    if (fx) inst.setFx(i, { acid: u.acid, fizz: u.acid });
    // the king beside his queen (kit v2.1 ATTEND): head turned toward the nearest point on her
    if (st === AnimState.ATTEND && v.aimX !== undefined && v.aimY !== undefined) {
      adapter.toWorld(v.aimX, v.aimY, vT);
      vT.addScaledVector(vU, 1.2);
      invM.copy(tmpM).invert();
      inst.setAttend(i, computeAim(inst.rig, vT.applyMatrix4(invM)).yaw);
    }
    inst.setLook(i, { tan: v.tan ?? 1, carry: v.tCarry ?? 0, glue: u.glue, seed });
    const tint = 1 + v.colorVar * 0.06;
    inst.setTint(i, tint, tint, tint);
  }

  /**
   * The sickle-jaw's squirt (kit README "Grab-and-squirt wiring"): HOLD / LUNGE with the head pitched so the
   * nasus points at the victim's back (holdAimAt), or a free target's aim (solveFreeSquirt, yaw ±0.4 rad); the
   * acid jet from the exact nasus tip to the hit point, thicker with the ramp; fizz where it lands.
   */
  private squirt(v: AntView, u: Unit, inst: TermiteInstances, i: number, st: number, seed: number, adapter: AntSpaceAdapter): void {
    adapter.toWorld(v.aimX!, v.aimY!, vT);
    vT.addScaledVector(vU, v.aimZ ?? 1);
    invM.copy(tmpM).invert();
    const local = vH.copy(vT).applyMatrix4(invM);
    holdIn.state = st as never;
    holdIn.stateT = v.tStateT ?? 0;
    holdIn.time = termiteTime.value;
    holdIn.seed = seed;
    holdIn.ramp = v.ramp ?? 0;
    holdIn.squirting = !!v.firing;
    holdIn.aimYawOffset = 0;
    holdIn.aimPitchOffset = 0;
    // the solver searches the head pitch: every few frames per soldier is plenty (the tug moves the head a little)
    if (this.frame - u.aimF >= 4) {
      u.aimF = this.frame;
      if (v.holding) {
        u.aimY = 0;
        u.aimP = holdAimAt(inst.rig, holdIn, local);
      } else {
        const f = solveFreeSquirt(inst.rig, holdIn, local);
        u.aimY = f.aimYawOffset;
        u.aimP = f.aimPitchOffset;
      }
    }
    holdIn.aimYawOffset = u.aimY;
    holdIn.aimPitchOffset = u.aimP;
    inst.setHold(i, v.ramp ?? 0, !!v.firing, u.aimY, u.aimP);
    if (!v.firing || st !== AnimState.HOLD) return;
    if (this.acidN < this.acid.capacity) {
      const tip = holdNasusTipLocal(inst.rig, holdIn, vH).applyMatrix4(tmpM);
      this.acid.set(this.acidN++, tip, vT, v.ramp ?? 0, true, seed);
    }
    // fizz: about a quarter of the target's half-length (aimZ ≈ 0.22 of its length)
    if (this.fizzN < this.fizz.capacity) this.fizz.set(this.fizzN++, vT, Math.max(0.25, ((v.aimZ ?? 1) / 0.22) * 0.125), v.ramp ?? 0, seed);
  }

  end(): void {
    for (const [caste, s] of this.sets) {
      const n = this.counts.get(caste)!;
      s.forEach((t, l) => {
        if (!t) return;
        t.count = n[l];
        if (n[l] > 0) t.commit();
      });
    }
    this.glue.count = this.glueN;
    this.glue.commit();
    this.acid.count = this.acidN;
    this.acid.commit();
    this.fizz.count = this.fizzN;
    this.fizz.commit();
    if (this.frame % 120 === 0) for (const [id, u] of this.units) if (this.frame - u.seen > 240) this.units.delete(id);
  }
}
