import * as THREE from 'three';
import { PrimitiveBatch, Prim, Surface } from './primitives';

/**
 * Posing helpers for procedural creatures (Phase 11). A builder places body
 * parts in a local frame — +x forward, +y up, +z to the side, y = 0 on the
 * ground, units mm — and the rig maps them into the world through the
 * current base (position + heading + tilt). Legs are two-bone chains solved
 * with simple IK toward animated foot targets.
 */

const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _ls = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class V {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
  set(x: number, y: number, z: number): V {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(o: V): V {
    return this.set(o.x, o.y, o.z);
  }
}

const FLASH = new THREE.Color(0.95, 0.3, 0.16);

/**
 * What a builder recorded this frame for climbing ants (render only): each
 * climbable leg's joints (hip, knee, ankle, foot) and named body frames, in
 * world coordinates. A climbing ant is placed on the animated leg, a rider on
 * the animated body (sim/creatures/climb.ts names the legs and frames).
 */
export interface ClimbRec {
  legs: Map<string, Float32Array>;
  frames: Map<string, THREE.Matrix4>;
  /** renderer frame number when recorded */
  frame: number;
}

const _w = new THREE.Vector3();

export class Rig {
  /** world from local */
  readonly base = new THREE.Matrix4();
  /** 0..1: tint every part toward a hurt flash (set per creature) */
  flash = 0;
  private fc = new THREE.Color();
  /** when set, builders record leg joints and body frames here (climbing ants) */
  rec: ClimbRec | null = null;
  constructor(readonly out: PrimitiveBatch) {}

  /** Record a leg's joints (local points; stored in world space). */
  recLeg(name: string, hip: V, knee: V, ankle: V, foot: V): void {
    const r = this.rec;
    if (!r) return;
    let a = r.legs.get(name);
    if (!a) r.legs.set(name, (a = new Float32Array(12)));
    const pts = [hip, knee, ankle, foot];
    for (let i = 0; i < 4; i++) {
      _w.set(pts[i].x, pts[i].y, pts[i].z).applyMatrix4(this.base);
      a[i * 3] = _w.x;
      a[i * 3 + 1] = _w.y;
      a[i * 3 + 2] = _w.z;
    }
  }

  /** Record the current base as a named body frame. */
  recFrame(name: string): void {
    const r = this.rec;
    if (!r) return;
    let m = r.frames.get(name);
    if (!m) r.frames.set(name, (m = new THREE.Matrix4()));
    m.copy(this.base);
  }

  /** Place the local frame: ground point (wx, wy, wz) in world, heading h (sim radians), body pitch/roll. */
  setBase(wx: number, wy: number, wz: number, h: number, pitch = 0, roll = 0): void {
    _e.set(roll, -h, pitch, 'YZX');
    _q.setFromEuler(_e);
    this.base.compose(_p.set(wx, wy, wz), _q, _s.set(1, 1, 1));
  }

  private emit(prim: Prim, local: THREE.Matrix4, color: THREE.ColorRepresentation, surf: Surface): void {
    if (this.sub) {
      _ls.multiplyMatrices(this.sub, local);
      local = _ls;
    }
    _m.multiplyMatrices(this.base, local);
    if (this.flash > 0) {
      this.fc.set(color).lerp(FLASH, this.flash * 0.3);
      this.out.add(prim, _m, this.fc, surf);
    } else this.out.add(prim, _m, color as THREE.Color, surf);
  }

  /**
   * A sub-frame inside the body frame (a head that pitches, with its mandibles and antennae): parts drawn
   * while it is set are placed in it. `null` draws in the body frame again.
   */
  sub: THREE.Matrix4 | null = null;

  /** Height of the ground below local (x, z), in the local frame (feet that follow the terrain). */
  groundAt(x: number, z: number, ground: (x: number, z: number) => number): number {
    _w.set(x, 0, z).applyMatrix4(this.base);
    const gy = ground(_w.x, _w.z);
    // the base's up axis: how far a step along local y moves in world y
    const e = this.base.elements;
    const upY = Math.max(0.3, e[5]);
    return (gy - _w.y) / upY;
  }

  private emitPart(name: string, local: THREE.Matrix4, color: THREE.ColorRepresentation, surf: Surface): void {
    if (this.sub) {
      _ls.multiplyMatrices(this.sub, local);
      local = _ls;
    }
    _m.multiplyMatrices(this.base, local);
    if (this.flash > 0) {
      this.fc.set(color).lerp(FLASH, this.flash * 0.3);
      this.out.addPart(name, _m, this.fc, surf);
    } else this.out.addPart(name, _m, color as THREE.Color, surf);
  }

  /** A sculpted part (primitives.ts registerPart) at (x, y, z), turned by yaw/pitch/roll, scaled by s (local). */
  part(name: string, x: number, y: number, z: number, s: number, color: THREE.ColorRepresentation, surf: Surface, yaw = 0, pitch = 0, roll = 0, sy = s, sz = s): void {
    _e.set(roll, yaw, pitch, 'YZX');
    _q.setFromEuler(_e);
    _l.compose(_p.set(x, y, z), _q, _s.set(s, sy, sz));
    this.emitPart(name, _l, color, surf);
  }

  /** A part placed by a full local matrix. */
  partM(name: string, local: THREE.Matrix4, color: THREE.ColorRepresentation, surf: Surface): void {
    this.emitPart(name, local, color, surf);
  }

  /**
   * A part modelled along +y from 0 to 1, stretched from a to b, with its local +x turned toward `side`
   * (the outer face of a flattened tibia, the comb of an antenna club); rx, rz its thickness scales.
   */
  partFrame(name: string, a: V, b: V, side: V, rx: number, rz: number, color: THREE.ColorRepresentation, surf: Surface): void {
    _d.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = _d.length();
    if (len < 1e-4) return;
    _d.multiplyScalar(1 / len);
    _x.set(side.x, side.y, side.z);
    _x.addScaledVector(_d, -_x.dot(_d));
    if (_x.lengthSq() < 1e-10) _x.set(_d.y, -_d.x, 0);
    _x.normalize();
    _z.crossVectors(_x, _d);
    _l.makeBasis(_x.multiplyScalar(rx), _d.multiplyScalar(len), _z.multiplyScalar(rz));
    _l.setPosition(a.x, a.y, a.z);
    this.emitPart(name, _l, color, surf);
  }

  /**
   * A part modelled along +y from 0 to 1 (a leg segment, an antenna segment) stretched from a to b, `r` its
   * thickness scale; `twist` turns it about its own axis (so a flattened tibia faces outward).
   */
  partSpan(name: string, a: V, b: V, r: number, color: THREE.ColorRepresentation, surf: Surface, twist = 0, rz = r): void {
    _d.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = _d.length();
    if (len < 1e-4) return;
    _d.multiplyScalar(1 / len);
    _q.setFromUnitVectors(UP, _d);
    if (twist) _q.multiply(_qt.setFromAxisAngle(UP, twist));
    _l.compose(_p.set(a.x, a.y, a.z), _q, _s.set(r, len, rz));
    this.emitPart(name, _l, color, surf);
  }

  /** Ellipsoid centred at (x, y, z) with semi-axes (rx, ry, rz), rotated by yaw/pitch/roll (local). */
  ell(x: number, y: number, z: number, rx: number, ry: number, rz: number, color: THREE.ColorRepresentation, surf: Surface, yaw = 0, pitch = 0, roll = 0): void {
    _e.set(roll, yaw, pitch, 'YZX');
    _q.setFromEuler(_e);
    _l.compose(_p.set(x, y, z), _q, _s.set(rx, ry, rz));
    this.emit('ell', _l, color, surf);
  }

  /** Tapered tube from a to b with base radius r (the tip is 0.8 r). */
  tube(a: V, b: V, r: number, color: THREE.ColorRepresentation, surf: Surface): void {
    this.span('tube', a, b, r, color, surf);
  }

  /** Cone from a (base, radius r) to b (point). */
  cone(a: V, b: V, r: number, color: THREE.ColorRepresentation, surf: Surface): void {
    this.span('cone', a, b, r, color, surf);
  }

  private span(prim: Prim, a: V, b: V, r: number, color: THREE.ColorRepresentation, surf: Surface): void {
    _d.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = _d.length();
    if (len < 1e-4) return;
    _d.multiplyScalar(1 / len);
    _q.setFromUnitVectors(UP, _d);
    _l.compose(_p.set(a.x, a.y, a.z), _q, _s.set(r, len, r));
    this.emit(prim, _l, color, surf);
  }
}

const _knee = new V();
const _footEnd = new V();
/** Where the last `limb` actually ended (the foot target clamped to the leg's reach). */
export const limbEnd: Readonly<V> = _footEnd;

/**
 * Two-bone limb from hip to foot: femur l1 then tibia l2, the knee pushed
 * toward `bend` (a local direction, usually up and out). Draws both bones and
 * returns the knee (valid until the next call).
 */
export function limb(rig: Rig, hip: V, foot: V, l1: number, l2: number, r: number, bx: number, by: number, bz: number, color: THREE.ColorRepresentation, surf: Surface, r2 = r * 0.75): V {
  let dx = foot.x - hip.x;
  let dy = foot.y - hip.y;
  let dz = foot.z - hip.z;
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const max = (l1 + l2) * 0.999;
  if (d > max) {
    const k = max / d;
    dx *= k;
    dy *= k;
    dz *= k;
    d = max;
  }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  // bend direction made perpendicular to the hip-foot line
  const dot = bx * ux + by * uy + bz * uz;
  let px = bx - dot * ux;
  let py = by - dot * uy;
  let pz = bz - dot * uz;
  const pl = Math.sqrt(px * px + py * py + pz * pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _knee.set(hip.x + ux * along + px * h, hip.y + uy * along + py * h, hip.z + uz * along + pz * h);
  const footEnd = _footEnd.set(hip.x + dx, hip.y + dy, hip.z + dz);
  rig.tube(hip, _knee, r, color, surf);
  rig.tube(_knee, footEnd, r2, color, surf);
  return _knee;
}

/** Gait offsets (fraction of a cycle) for common leg layouts. */
export function tripod(i: number, side: number): number {
  // L1 R2 L3 together, R1 L2 R3 half a cycle later
  return ((i + (side > 0 ? 1 : 0)) % 2) * 0.5;
}

export function tetrapod(i: number, side: number): number {
  return ((i + (side > 0 ? 1 : 0)) % 2) * 0.5;
}

export function wave(i: number, side: number, step: number): number {
  return (i * step + (side > 0 ? 0.5 : 0)) % 1;
}

/**
 * Foot position for a leg in the walking cycle. Stance: the foot stays on the
 * ground and slides back under the body; swing: it lifts and swings forward.
 */
export function footAt(out: V, restX: number, restZ: number, phase: number, stride: number, lift: number, amp: number, duty = 0.62): V {
  const u = phase - Math.floor(phase);
  let x: number;
  let y = 0;
  if (u < duty) x = restX + stride * amp * (0.5 - u / duty);
  else {
    const s = (u - duty) / (1 - duty);
    x = restX + stride * amp * (-0.5 + s);
    y = lift * amp * Math.sin(Math.PI * s);
  }
  return out.set(x, y, restZ);
}

/** Smooth 0..1 easing. */
export function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export const vtmp = (): V => new V();
