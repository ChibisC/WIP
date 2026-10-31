import * as THREE from 'three';
import { PrimitiveBatch } from './primitives';
import { ClimbRec, Rig } from './rig';
import { CLIMB_DATA } from '../../sim/creatures/climbData';
import { BALANCE } from '../../sim/balance';
import type { AntView, MountOut } from '../ants/antRenderer';
import { BUILDERS, CHAINS, CrPose, EXTENT, STRIDE } from './builders';
import { followChain, TRAIL_CAP, TRAIL_RELAX, TRAIL_STEP } from './chainTrail';
import type { Creature } from '../../sim/types';
import { CREATURES } from '../../sim/creatures/kinds';

/**
 * Draws the wild creatures and bosses of one space (the surface or one
 * underground area) from their simulation state (Phase 11). Each creature
 * keeps a little animation state here — gait phase from the distance it
 * walked, a smoothed stride, and for the long-bodied ones (caterpillar,
 * centipedes) a trail of head positions the segments follow — and its kind's
 * builder poses the body parts into the shared instanced primitives.
 */

interface CrAnim {
  phase: number;
  spd: number;
  lastX: number;
  lastZ: number;
  trail: Float32Array;
  trailN: number;
  seen: number;
  /** hit flash: the sim's hit timer last frame, the flash (1 → 0) and a cooldown so steady biting flickers */
  hitT: number;
  flash: number;
  flashCd: number;
}


/** Main colour of each kind, for the far-away blob. */
const BLOB: Record<string, number> = {
  pillbug: 0x5b6068,
  cutworm: 0x8a7a5c,
  groundBeetle: 0x16171a,
  wolfSpider: 0x5b4632,
  lithobius: 0x7a4022,
  rove: 0x141414,
  mantis: 0x6f9a3c,
  antlion: 0x8a7a62,
  spiderling: 0x5b4632,
  stagBeetle: 0x6b2a14,
  tarantula: 0x1c1612,
  scolopendra: 0xc88d2c,
  giantMantis: 0x5f8f2e,
  hogna: 0x5b4632,
};

const BLOB_SURF = { rough: 0.6, gloss: 0.2, pattern: 0, scale: 1 };

const _s = new THREE.Vector3();
const _fx = new THREE.Vector3();
const _fy = new THREE.Vector3();
const _c = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

export type GroundFn = (x: number, z: number) => number;

/** Climb debug overlay colours: rails, climbing points (feet), weak points, free and taken mount slots. */
type Rgb = readonly [number, number, number];
const DBG_RAIL: Rgb = [0.25, 1, 0.5];
const DBG_FOOT: Rgb = [1, 1, 1];
const DBG_WEAK: Rgb = [1, 0.3, 0.9];
const DBG_FREE: Rgb = [0.25, 0.9, 1];
const DBG_TAKEN: Rgb = [1, 0.72, 0.2];

export class CreatureRenderer {
  readonly batch = new PrimitiveBatch();
  readonly group: THREE.Group;
  private rig: Rig;
  private anim = new Map<number, CrAnim>();
  private frame = 0;
  private time = 0;
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  /** projected body length (px) below which a creature is drawn as a simple blob */
  blobPx = 5;
  stats = { drawn: 0, blobs: 0, instances: 0 };
  private pose: CrPose;
  /** climbable creatures: the leg joints and body frames recorded this frame (climbing ants ride on them) */
  private recs = new Map<number, ClimbRec & { full: boolean }>();
  private ground: GroundFn = () => 0;
  /** draw the climb rails and riding slots (debug overlay) */
  climbDebug = false;
  private dbg: THREE.LineSegments | null = null;
  private dbgPos: Float32Array = new Float32Array(0);
  private dbgCol: Float32Array = new Float32Array(0);
  private dbgN = 0;

  constructor(name = 'creatures') {
    this.group = this.batch.group;
    this.group.name = name;
    this.rig = new Rig(this.batch);
    this.pose = {
      L: 1,
      x: 0,
      z: 0,
      h: 0,
      hx: 0,
      hz: 0,
      phase: 0,
      amp: 0,
      t: 0,
      state: 0,
      st: 0,
      dead: false,
      deadT: 0,
      eaten: 0,
      v2: 0,
      hurt: 0,
      data: {},
      trail: new Float32Array(0),
      trailN: 0,
      trailStep: 1,
      ground: () => 0,
    };
  }

  setShadows(on: boolean): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = on;
    });
  }

  /**
   * Pose every creature in `space`. `alpha` interpolates between the last two
   * ticks; `dt` is real frame time (idle motion keeps going while paused,
   * walking only when they move).
   */
  update(creatures: ReadonlyArray<Creature>, space: number, alpha: number, dt: number, ground: GroundFn, camera: THREE.Camera | null, viewportH: number): void {
    this.frame++;
    this.time += dt;
    const b = this.batch;
    b.begin();
    let pxPerMm = 0;
    if (camera) {
      camera.updateMatrixWorld();
      this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.pm);
      const pc = camera as THREE.PerspectiveCamera;
      if (pc.isPerspectiveCamera) pxPerMm = (viewportH * 0.5) / Math.tan(THREE.MathUtils.degToRad(pc.fov) * 0.5);
    }
    const p = this.pose;
    p.ground = ground;
    this.ground = ground;
    p.t = this.time;
    this.dbgN = 0;
    this.stats.drawn = 0;
    this.stats.blobs = 0;
    for (const cr of creatures) {
      if (cr.space !== space) continue;
      const build = BUILDERS[cr.kind];
      if (!build) continue;
      const L = cr.scale || CREATURES[cr.kind]?.length || 10;
      const x = cr.px + (cr.x - cr.px) * alpha;
      const z = cr.py + (cr.y - cr.py) * alpha;
      let dh = cr.h - cr.ph;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const h = cr.ph + dh * alpha;
      const a = this.animOf(cr, x, z, L);
      a.seen = this.frame;
      // gait: phase advances with the distance walked; stride shrinks when it stands
      const moved = Math.hypot(x - a.lastX, z - a.lastZ);
      a.lastX = x;
      a.lastZ = z;
      const spd = dt > 0 ? Math.min(moved / dt, L * 20) : 0;
      a.spd += (spd - a.spd) * Math.min(1, dt * 6);
      const amp = Math.min(1, a.spd / Math.max(0.5, L * 0.6));
      // slow walkers take shorter, quicker steps, so planted feet do not slide
      const strideMm = (STRIDE[cr.kind] ?? 0.4) * L * Math.max(0.35, amp);
      if (moved < L * 2) a.phase += moved / strideMm;
      const chain = CHAINS.has(cr.kind);
      const hx = chain ? x + Math.cos(h) * L * 0.5 : x;
      const hz = chain ? z + Math.sin(h) * L * 0.5 : z;
      if (chain) a.trailN = followChain(a.trail, a.trailN, hx, hz, h, L * TRAIL_STEP, 1 - Math.exp(-dt * TRAIL_RELAX));
      // cull off-screen; far away, a blob is enough
      const y0 = ground(x, z);
      if (camera) {
        this.sphere.center.set(x, y0, z);
        this.sphere.radius = L * (EXTENT[cr.kind] ?? 1.1) * 0.6 + (chain ? L * 0.5 : 0);
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
      }
      const rec = CLIMB_DATA[cr.kind] ? this.recOf(cr.id) : null;
      if (rec) rec.frame = this.frame;
      if (camera && pxPerMm > 0) {
        const d = Math.max(1, camera.position.distanceTo(this.sphere.center));
        if ((L * pxPerMm) / d < this.blobPx) {
          this.rig.rec = rec;
          if (rec) rec.full = false;
          this.blob(cr, x, y0, z, h, L);
          this.rig.rec = null;
          continue;
        }
      }
      p.L = L;
      p.x = x;
      p.z = z;
      p.h = h;
      p.hx = hx;
      p.hz = hz;
      p.phase = a.phase;
      p.amp = amp;
      p.state = cr.state;
      p.st = cr.st;
      p.dead = cr.dead;
      p.deadT = cr.deadT;
      p.eaten = cr.data.eaten ?? 0;
      p.v2 = cr.v2;
      // a bite makes it flash briefly: the sim resets hitT to 4 s on every hit, so a jump means a new one
      const ht = cr.data.hitT ?? 0;
      if (ht > a.hitT + 0.01 && a.flashCd <= 0 && !cr.dead) {
        a.flash = 1;
        a.flashCd = 0.45;
      }
      a.hitT = ht;
      a.flash = Math.max(0, a.flash - dt * 7);
      a.flashCd -= dt;
      p.hurt = a.flash;
      p.data = cr.data;
      p.trail = a.trail;
      p.trailN = a.trailN;
      p.trailStep = L * TRAIL_STEP;
      this.rig.flash = p.hurt;
      this.rig.rec = rec;
      if (rec) rec.full = true;
      build(this.rig, p);
      this.rig.rec = null;
      this.rig.flash = 0;
      if (rec && this.climbDebug) this.debugRails(cr, rec);
      this.stats.drawn++;
    }
    b.end();
    this.stats.instances = b.count;
    this.flushDebug();
    // forget creatures that are gone
    if (this.frame % 60 === 0) {
      for (const [id, a] of this.anim) if (this.frame - a.seen > 120) this.anim.delete(id);
      for (const [id, r] of this.recs) if (this.frame - r.frame > 120) this.recs.delete(id);
    }
  }

  private recOf(id: number): ClimbRec & { full: boolean } {
    let r = this.recs.get(id);
    if (!r) this.recs.set(id, (r = { legs: new Map(), frames: new Map(), frame: 0, full: false }));
    return r;
  }

  /**
   * Place a climbing ant (render only): on the animated leg at its progress up
   * the rail, or on its riding slot on the animated body, slightly above the
   * surface. Falls back to the rest pose for a creature drawn far away as a
   * blob (or off-screen this frame). Returns false if the creature is unknown.
   */
  mountPose(cr: Creature, v: AntView, alpha: number, out: MountOut): boolean {
    const def = CLIMB_DATA[cr.kind];
    if (!def) return false;
    const L = cr.scale || CREATURES[cr.kind]?.length || 10;
    let rec = this.recs.get(cr.id);
    if (!rec || this.frame - rec.frame > 1) {
      // not drawn this frame: the rest pose round its interpolated root
      rec = this.recOf(cr.id);
      const x = cr.px + (cr.x - cr.px) * alpha;
      const z = cr.py + (cr.y - cr.py) * alpha;
      let dh = cr.h - cr.ph;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.rig.rec = rec;
      this.rig.setBase(x, this.ground(x, z), z, cr.ph + dh * alpha);
      this.rig.recFrame('body');
      this.rig.rec = null;
      rec.full = false;
      rec.frame = this.frame;
    }
    const body = rec.frames.get('body') ?? rec.frames.get('s0');
    const ph = v.ridePh ?? 0;
    const slot = def.slots[v.rideSlot ?? 0] ?? def.slots[0];
    const clear = 0.08 + L * 0.006;
    // the riding slot in the world, on its (animated) body frame
    const fm = (rec.full && rec.frames.get(slot.frame)) || body;
    if (!fm) return false;
    const fr = rec.full && rec.frames.has(slot.frame) ? null : def.frames[slot.frame];
    _s.set((slot.x + (fr ? fr[0] : 0)) * L, (slot.y + (fr ? fr[1] : 0)) * L, (slot.z + (fr ? fr[2] : 0)) * L);
    _fx.setFromMatrixColumn(fm, 0).normalize();
    _fy.setFromMatrixColumn(fm, 1).normalize();
    _s.applyMatrix4(fm).addScaledVector(_fy, clear);
    // the slot's surface normal (belly against the body) and its weak point, on the same (animated) frames
    const fmW = (rec.full && rec.frames.get(slot.frame)) || body || fm;
    _n.set(slot.nx ?? 0, slot.ny ?? 1, slot.nz ?? 0).transformDirection(fmW);
    if (ph === 2) {
      // riding (combat v2): at its mount slot, belly to the surface, lifted clear along the normal, head toward the
      // weak point it attacks (along the surface), swaying a little with the body
      const wk = def.weak?.[slot.w ?? -1];
      out.u.copy(_n);
      out.p.copy(_s).addScaledVector(_fy, -clear).addScaledVector(_n, clear);
      if (wk) {
        const wf = (rec.full && rec.frames.get(wk.frame)) || body || fm;
        const wr = rec.full && rec.frames.has(wk.frame) ? null : def.frames[wk.frame];
        _tmp.set((wk.x + (wr ? wr[0] : 0)) * L, (wk.y + (wr ? wr[1] : 0)) * L, (wk.z + (wr ? wr[2] : 0)) * L).applyMatrix4(wf);
        out.f.copy(_tmp).sub(out.p);
      } else out.f.set(0, 0, 0);
      out.f.addScaledVector(_n, -out.f.dot(_n));
      // at its weak point (or straight above it): face the way the body faces
      if (out.f.lengthSq() < (L * 0.01) * (L * 0.01)) out.f.copy(_fx).addScaledVector(_n, -_fx.dot(_n));
      out.f.normalize();
      out.u.applyAxisAngle(out.f, Math.sin(this.time * 2.3 + v.id) * 0.06);
      out.speed = 0;
      return true;
    }
    // climbing: foot → ankle → knee (animated, or rest pose) → over the edge → slot
    const rail = def.rails[v.rideRail ?? 0] ?? def.rails[0];
    const leg = rec.full ? rec.legs.get(rail.leg) : undefined;
    for (let i = 0; i < 3; i++) {
      const pt = _pts[i];
      if (leg) pt.set(leg[(3 - i) * 3], leg[(3 - i) * 3 + 1], leg[(3 - i) * 3 + 2]);
      else if (body) pt.set(rail.pts[i * 3] * L, rail.pts[i * 3 + 1] * L, rail.pts[i * 3 + 2] * L).applyMatrix4(body);
      // on the outside of the leg, not inside it
      pt.addScaledVector(_fy, clear);
    }
    // over the body's edge: above the knee at the slot's height, then across to the slot
    _pts[3].copy(_pts[2]).lerp(_s, 0.35);
    _pts[3].addScaledVector(_fy, Math.max(0, _fy.dot(_tmp.copy(_s).sub(_pts[3]))) * 0.8);
    _pts[4].copy(_s);
    let total = 0;
    for (let i = 0; i < 4; i++) total += _pts[i].distanceTo(_pts[i + 1]);
    // the sim's progress, eased between ticks
    const tick = 1 / BALANCE.tickHz;
    const dur = ph === 1 ? BALANCE.climb.up : BALANCE.climb.down;
    let t = Math.max(0, Math.min(1, (v.rideT ?? 0) - (1 - alpha) * (tick / dur)));
    if (ph === 3) t = 1 - t;
    let want = t * total;
    let k = 3;
    for (let i = 0; i < 4; i++) {
      const seg = _pts[i].distanceTo(_pts[i + 1]);
      if (want <= seg || i === 3) {
        k = i;
        const f = seg > 1e-6 ? Math.min(1, want / seg) : 1;
        out.p.copy(_pts[i]).lerp(_pts[i + 1], f);
        break;
      }
      want -= seg;
    }
    // facing along the leg: up it when climbing, head first down it when coming off
    out.f.copy(_pts[k + 1]).sub(_pts[k]).normalize();
    if (ph === 3) out.f.negate();
    // belly on the leg: the back faces out from the body's middle, and up
    _tmp.copy(out.p).sub(_c.setFromMatrixPosition(rec.full ? fm : (body ?? fm)));
    _tmp.addScaledVector(_fy, -_tmp.dot(_fy)).normalize();
    out.u.copy(_tmp).addScaledVector(_fy, 0.7).normalize();
    out.u.addScaledVector(out.f, -out.u.dot(out.f)).normalize();
    out.speed = total / dur;
    return true;
  }

  /**
   * Debug overlay (F3 / ?climbdebug=1; combat v2): each climbing point (the foot, a white cross), its rail up the
   * animated leg (green), the weak points (magenta diamonds) and the mount slots — free in cyan, taken in amber with a
   * taller mark — each with a tick along its surface normal.
   */
  private debugRails(cr: Creature, rec: ClimbRec): void {
    const def = CLIMB_DATA[cr.kind];
    const L = cr.scale;
    const e = L * 0.015;
    for (const r of def.rails) {
      const a = rec.legs.get(r.leg);
      if (!a) continue;
      for (let j = 3; j > 0; j--) this.dbgLine(a[j * 3], a[j * 3 + 1], a[j * 3 + 2], a[j * 3 - 3], a[j * 3 - 2], a[j * 3 - 1], DBG_RAIL);
      // the climbing point (foot)
      this.dbgLine(a[9] - e, a[10], a[11], a[9] + e, a[10], a[11], DBG_FOOT);
      this.dbgLine(a[9], a[10], a[11] - e, a[9], a[10], a[11] + e, DBG_FOOT);
    }
    for (const wk of def.weak ?? []) {
      const m = rec.frames.get(wk.frame);
      if (!m) continue;
      _s.set(wk.x * L, wk.y * L, wk.z * L).applyMatrix4(m);
      const d = L * 0.02;
      this.dbgLine(_s.x - d, _s.y, _s.z, _s.x, _s.y + d, _s.z, DBG_WEAK);
      this.dbgLine(_s.x, _s.y + d, _s.z, _s.x + d, _s.y, _s.z, DBG_WEAK);
      this.dbgLine(_s.x + d, _s.y, _s.z, _s.x, _s.y - d, _s.z, DBG_WEAK);
      this.dbgLine(_s.x, _s.y - d, _s.z, _s.x - d, _s.y, _s.z, DBG_WEAK);
    }
    const taken = cr.rideMask ?? 0;
    def.slots.forEach((sl, k) => {
      const m = rec.frames.get(sl.frame);
      if (!m) return;
      const on = (taken & (1 << k)) !== 0;
      const c = on ? DBG_TAKEN : DBG_FREE;
      _s.set(sl.x * L, sl.y * L, sl.z * L).applyMatrix4(m);
      _n.set(sl.nx ?? 0, sl.ny ?? 1, sl.nz ?? 0).transformDirection(m);
      this.dbgLine(_s.x - e, _s.y, _s.z, _s.x + e, _s.y, _s.z, c);
      this.dbgLine(_s.x, _s.y, _s.z - e, _s.x, _s.y, _s.z + e, c);
      const h = e * (on ? 4 : 2);
      this.dbgLine(_s.x, _s.y, _s.z, _s.x + _n.x * h, _s.y + _n.y * h, _s.z + _n.z * h, c);
    });
  }

  private dbgLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: Rgb = DBG_RAIL): void {
    if ((this.dbgN + 1) * 6 > this.dbgPos.length) {
      const n = new Float32Array(Math.max(600, this.dbgPos.length * 2));
      n.set(this.dbgPos);
      this.dbgPos = n;
      const c = new Float32Array(n.length);
      c.set(this.dbgCol);
      this.dbgCol = c;
      if (this.dbg) {
        this.dbg.geometry.setAttribute('position', new THREE.BufferAttribute(this.dbgPos, 3));
        this.dbg.geometry.setAttribute('color', new THREE.BufferAttribute(this.dbgCol, 3));
      }
    }
    const o = this.dbgN * 6;
    const p = this.dbgPos;
    p[o] = ax;
    p[o + 1] = ay;
    p[o + 2] = az;
    p[o + 3] = bx;
    p[o + 4] = by;
    p[o + 5] = bz;
    const q = this.dbgCol;
    for (const k of [0, 3]) {
      q[o + k] = color[0];
      q[o + k + 1] = color[1];
      q[o + k + 2] = color[2];
    }
    this.dbgN++;
  }

  private flushDebug(): void {
    if (!this.climbDebug && !this.dbg) return;
    if (!this.dbg) {
      const g = new THREE.BufferGeometry();
      if (!this.dbgPos.length) this.dbgPos = new Float32Array(600);
      if (this.dbgCol.length !== this.dbgPos.length) {
        const c = new Float32Array(this.dbgPos.length);
        c.set(this.dbgCol.subarray(0, Math.min(this.dbgCol.length, c.length)));
        this.dbgCol = c;
      }
      g.setAttribute('position', new THREE.BufferAttribute(this.dbgPos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.dbgCol, 3));
      this.dbg = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
      this.dbg.renderOrder = 999;
      this.dbg.frustumCulled = false;
      this.dbg.name = 'climbDebug';
      this.group.add(this.dbg);
    }
    this.dbg.visible = this.climbDebug;
    const attr = this.dbg.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (attr.array !== this.dbgPos) this.dbg.geometry.setAttribute('position', new THREE.BufferAttribute(this.dbgPos, 3));
    const cattr = this.dbg.geometry.getAttribute('color') as THREE.BufferAttribute;
    if (cattr.array !== this.dbgCol) this.dbg.geometry.setAttribute('color', new THREE.BufferAttribute(this.dbgCol, 3));
    (this.dbg.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.dbg.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.dbg.geometry.setDrawRange(0, this.dbgN * 2);
  }

  /** Tools (creature lab): set a creature's gait phase and smoothed speed. */
  setAnim(id: number, phase: number, spd: number): void {
    const a = this.anim.get(id);
    if (!a) return;
    a.phase = phase;
    a.spd = spd;
  }

  private animOf(cr: Creature, x: number, z: number, L: number): CrAnim {
    let a = this.anim.get(cr.id);
    if (!a || Math.hypot(a.lastX - x, a.lastZ - z) > L * 3) {
      a = { phase: cr.v2 * 4, spd: 0, lastX: x, lastZ: z, trail: a?.trail ?? new Float32Array(TRAIL_CAP * 2), trailN: 0, seen: this.frame, hitT: cr.data.hitT ?? 0, flash: 0, flashCd: 0 };
      this.anim.set(cr.id, a);
    }
    return a;
  }

  private blob(cr: Creature, x: number, y: number, z: number, h: number, L: number): void {
    const r = this.rig;
    r.setBase(x, y, z, h, 0, 0);
    r.recFrame('body');
    const chain = CHAINS.has(cr.kind);
    const k = cr.dead ? 1 - 0.55 * (cr.data.eaten ?? 0) : 1;
    r.ell(0, L * 0.1 * k, 0, L * (chain ? 0.5 : 0.42) * k, L * 0.12 * k, L * (chain ? 0.06 : 0.22) * k, BLOB[cr.kind] ?? 0x444444, BLOB_SURF);
    this.stats.blobs++;
  }
}
