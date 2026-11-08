import * as THREE from 'three';
import { World } from '../sim/world';
import { TREES, TreesDef } from '../sim/types';
import { TREES as T } from '../sim/balance';
import { climbSeconds } from '../sim/trees';
import { AntView, MountOut } from '../render/ants/antRenderer';

/**
 * Ants on a tree trunk (render only; user 2026-11-08 "use walking animation parallel to the tree"): a climbing ant is
 * drawn through the ant renderer's mount hook — the same one that puts ants on a creature's legs — so its feet stand
 * on the bark, its body lies along the trunk and its legs cycle at the climb's speed. Up it goes head first; down it
 * comes head first too, as ants do. In the ground view it starts on the ground at its climb point, tips up onto the
 * bark over the first few millimetres and climbs out of the ground view's trunk; in the trees view it comes up the
 * outside of the trunk top and tips over the rim onto the wood.
 */

/** the height of the trunk drawn on the ground (`TreeDecor`): a little past the canopy, so a climb ends on bark */
export function trunkDrawHeight(d: TreesDef): number {
  return d.height + 8;
}

/** the drawn trunk's radius `e` mm above its foot (`trunkGeometry`: the foot flares, higher up it narrows to 80 %) */
export function trunkRadiusAt(r: number, e: number, H: number): number {
  const u = Math.max(0, (e + 3) / H);
  const t = Math.min(1, (-0.6 + Math.sqrt(0.36 + 1.6 * u)) / 0.8);
  // (a touch outside the mean radius: the feet stand on the bark's ridges rather than in its grooves)
  return r * (1 - 0.2 * Math.min(1, t * 2.2)) * 1.02;
}

const rad = new THREE.Vector3();
const fH = new THREE.Vector3();
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

function smooth(k: number): number {
  k = Math.max(0, Math.min(1, k));
  return k * k * (3 - 2 * k);
}

/** blend from pose A (pA, fA, uA) to pose B by s and write it, orthonormal, to `out` */
function blend(out: MountOut, fA: THREE.Vector3, uA: THREE.Vector3, fB: THREE.Vector3, uB: THREE.Vector3, s: number): void {
  out.p.lerpVectors(pA, pB, s);
  out.f.lerpVectors(fA, fB, s).normalize();
  out.u.lerpVectors(uA, uB, s);
  out.u.addScaledVector(out.f, -out.f.dot(out.u)).normalize();
}

const fV = new THREE.Vector3();
const uR = new THREE.Vector3();

/**
 * The ground view: the ant on the bark at its climb point. `groundAt` is the view's walk height. Returns false when
 * the view is not a climbing one.
 */
export function trunkMountGround(w: World, v: AntView, groundAt: (x: number, y: number) => number, out: MountOut): boolean {
  const d = w.s.trees;
  if (!d || !v.trunk) return false;
  const t = d.trunks[v.trunk - 1];
  if (!t) return false;
  const H = trunkDrawHeight(d);
  const K = v.trunkK ?? 0;
  const e = K * d.height;
  const a = v.trunkA ?? 0;
  rad.set(Math.cos(a), 0, Math.sin(a));
  const g0 = groundAt(t.x, t.y);
  // on the bark: feet at the trunk's radius at this height, body along the trunk, back outward
  const R = trunkRadiusAt(t.r, e, H);
  pB.set(t.x + rad.x * R, g0 + e, t.y + rad.z * R);
  fV.set(0, v.trunkUp ? 1 : -1, 0);
  uR.copy(rad);
  // the ground end: standing at the climb point (T.climbPoints on the surface lattice, r + 10 out), nose to the trunk
  // going up, away from it coming down
  const cx = t.x + rad.x * (t.r + 10);
  const cy = t.y + rad.z * (t.r + 10);
  pA.set(cx, groundAt(cx, cy), cy);
  fH.copy(rad).multiplyScalar(v.trunkUp ? -1 : 1);
  // the tip-up / tip-down over the first 6 % of the height (about a third of a second)
  const s = smooth(K / 0.06);
  blend(out, fH, Y, fV, uR, s);
  out.speed = d.height / climbSeconds(w);
  return true;
}

/**
 * The trees view: the ant coming up the outside of the trunk top (the canopy's wood disc) and over its rim. Below the
 * canopy it is a speck rising at the rim; the last part of the climb tips it onto the wood.
 */
export function trunkMountCanopy(w: World, v: AntView, out: MountOut): boolean {
  const d = w.s.trees;
  const g = w.nestOf(TREES);
  if (!d || !g || !v.trunk) return false;
  const t = d.trunks[v.trunk - 1];
  if (!t || t.top < 0) return false;
  const K = v.trunkK ?? 0;
  const a = v.trunkA ?? 0;
  rad.set(Math.cos(a), 0, Math.sin(a));
  const c = g.hexCenter(t.top);
  const top = T.hexR * 1.3 + 0.3;
  const Rd = Math.max(t.r, g.R * 1.1);
  // on the trunk's side under the rim: the real height below the canopy's top
  const e = (K - 1) * d.height;
  pB.set(c.x + rad.x * Rd, top + Math.min(0, e), c.y + rad.z * Rd);
  fV.set(0, 1, 0);
  uR.copy(rad);
  // over the rim: on the wood, a body length in from the edge, nose to the trunk's centre
  pA.set(c.x + rad.x * (Rd - 6), top, c.y + rad.z * (Rd - 6));
  fH.copy(rad).multiplyScalar(-1);
  const s = smooth((K - 0.94) / 0.06);
  // (blend goes A → B; here the wood is the end, so from the bark pose to the wood pose)
  out.p.lerpVectors(pB, pA, s);
  out.f.lerpVectors(fV, fH, s).normalize();
  out.u.lerpVectors(uR, Y, s);
  out.u.addScaledVector(out.f, -out.f.dot(out.u)).normalize();
  out.speed = d.height / climbSeconds(w);
  return true;
}
