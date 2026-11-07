/**
 * A loose view test for the units (performance v2, claude/performance/02-spec-responsiveness-client-visuals.md §3):
 * the views leave out ants well out of the camera's view, so the ant renderer spends nothing on them — no view, no
 * animation — and catches each one up in a single step when it comes back (antRenderer.ts `catchUp`). The margin is
 * wide (several body lengths), so an ant is settled before it can be seen; ants in the air or on a creature are always
 * kept (their drawn place is not their plane position).
 */
import * as THREE from 'three';
import { AS, Ant } from '../sim/types';

/** how far outside the view an ant is still animated (mm) */
export const CULL_MARGIN = 40;

const m4 = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const p = new THREE.Vector3();

export class ViewCull {
  private frustum = new THREE.Frustum();
  /** ants left out by the last frame's test (F3) */
  left = 0;

  /** Take the camera's view for this frame. */
  begin(cam: THREE.Camera): void {
    m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(m4);
    this.left = 0;
  }

  /** Is ant `a` (its plane position put in the world by `pos`) near enough the view to animate? */
  keeps(a: Ant, pos: (x: number, y: number, lift: number, out: THREE.Vector3) => unknown): boolean {
    if (a.state === AS.Flung || a.rideId || a.fz > 0) return true;
    pos(a.x, a.y, 0, p);
    sphere.center.copy(p);
    sphere.radius = CULL_MARGIN;
    if (this.frustum.intersectsSphere(sphere)) return true;
    this.left++;
    return false;
  }

  /** The same for a point (corpses, brood). */
  keepsPoint(x: number, y: number, pos: (x: number, y: number, lift: number, out: THREE.Vector3) => unknown): boolean {
    pos(x, y, 0, p);
    sphere.center.copy(p);
    sphere.radius = CULL_MARGIN;
    if (this.frustum.intersectsSphere(sphere)) return true;
    this.left++;
    return false;
  }
}
