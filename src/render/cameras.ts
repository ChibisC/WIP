import * as THREE from 'three';
import { Input } from '../core/input';

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

export interface CamInputDelta {
  panDX: number;
  panDY: number;
  rotDX: number;
  rotDY: number;
  wheel: number;
}

/**
 * RTS camera for a horizontal plane (the surface and the nest): orbit around a
 * ground target with pitch that flattens as you zoom in (macro feel) and
 * steepens as you zoom out.
 */
export class SurfaceCameraRig {
  target = new THREE.Vector3();
  goal = new THREE.Vector3();
  distance = 260;
  goalDistance = 260;
  yaw = 0.6;
  goalYaw = 0.6;
  pitchBias = 0;
  minDist = 18;
  maxDist = 900;
  bounds = new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(500, 500));
  heightAt: (x: number, z: number) => number = () => 0;
  shake = 0;

  constructor(public camera: THREE.PerspectiveCamera) {}

  pitch(): number {
    const t = Math.min(1, Math.max(0, (Math.log(this.distance) - Math.log(this.minDist)) / (Math.log(this.maxDist) - Math.log(this.minDist))));
    return THREE.MathUtils.clamp(0.32 + t * 0.78 + this.pitchBias, 0.12, 1.45);
  }

  update(dt: number, input: Input, d: CamInputDelta, active: boolean): void {
    if (active) {
      const panSpeed = this.distance * 1.2;
      let fx = 0;
      let fz = 0;
      if (input.isDown('panUp')) fz -= 1;
      if (input.isDown('panDown')) fz += 1;
      if (input.isDown('panLeft')) fx -= 1;
      if (input.isDown('panRight')) fx += 1;
      // edge scrolling
      const ep = input.edgePan();
      fx += ep.x;
      fz += ep.y;
      if (input.isDown('rotateLeft')) this.goalYaw += dt * 1.6;
      if (input.isDown('rotateRight')) this.goalYaw -= dt * 1.6;
      if (input.isDown('zoomIn')) this.goalDistance *= Math.exp(-dt * 1.5);
      if (input.isDown('zoomOut')) this.goalDistance *= Math.exp(dt * 1.5);
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      // Keyboard pan in camera-relative ground axes.
      this.goal.x += (fx * cy + fz * sy) * panSpeed * dt;
      this.goal.z += (-fx * sy + fz * cy) * panSpeed * dt;
      // Mouse drag pan: drag the ground under the cursor.
      const k = (this.distance / 700) * 1.25;
      this.goal.x += (-d.panDX * cy - d.panDY * sy) * k;
      this.goal.z += (d.panDX * sy - d.panDY * cy) * k;
      this.goalYaw -= d.rotDX * 0.006;
      this.pitchBias = THREE.MathUtils.clamp(this.pitchBias + d.rotDY * 0.004, -0.4, 0.5);
      if (d.wheel) this.goalDistance *= Math.exp(d.wheel * 0.14);
    }
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance, this.minDist, this.maxDist);
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, this.bounds.min.x, this.bounds.max.x);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, this.bounds.min.y, this.bounds.max.y);
    this.goal.y = this.heightAt(this.goal.x, this.goal.z);
    this.target.x = damp(this.target.x, this.goal.x, 10, dt);
    this.target.z = damp(this.target.z, this.goal.z, 10, dt);
    this.target.y = damp(this.target.y, this.goal.y, 6, dt);
    this.distance = damp(this.distance, this.goalDistance, 9, dt);
    this.yaw = damp(this.yaw, this.goalYaw, 10, dt);
    this.apply(dt);
  }

  apply(dt = 0): void {
    const p = this.pitch();
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(p), Math.sin(p), Math.cos(this.yaw) * Math.cos(p)).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(off);
    // Keep above the ground.
    const gh = this.heightAt(this.camera.position.x, this.camera.position.z) + 4;
    if (this.camera.position.y < gh) this.camera.position.y = gh;
    this.camera.lookAt(this.target);
    if (this.shake > 0.01) {
      const s = this.shake * this.distance * 0.006;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 5);
    }
    this.camera.near = Math.max(0.2, this.distance * 0.02);
    this.camera.far = Math.max(4000, this.distance * 20);
    this.camera.updateProjectionMatrix();
  }

  /** Default view distance for this map (reset key). */
  homeDistance = 230;

  /** Reset key: default angle, tilt and zoom, keeping the view centre. */
  resetView(): void {
    this.goalYaw = 0.6;
    this.pitchBias = 0;
    this.goalDistance = this.homeDistance;
  }

  jumpTo(x: number, z: number, dist?: number): void {
    this.goal.set(x, this.heightAt(x, z), z);
    this.target.copy(this.goal);
    if (dist) this.distance = this.goalDistance = dist;
    this.apply();
  }
}

/** Close-up follow camera that orbits a moving subject. */
export class ObserveCameraRig {
  subject = new THREE.Vector3();
  up = new THREE.Vector3(0, 1, 0);
  smoothSubject = new THREE.Vector3();
  distance = 30;
  goalDistance = 30;
  yaw = 0.8;
  pitch = 0.45;
  /** Subject heading (rad) — the camera drifts behind it unless the user orbits. */
  heading = 0;
  autoFollow = true;
  private idle = 0;
  inNest = false;

  constructor(public camera: THREE.PerspectiveCamera) {}

  reset(p: THREE.Vector3, size: number, inNest: boolean): void {
    this.subject.copy(p);
    this.smoothSubject.copy(p);
    this.distance = this.goalDistance = Math.max(10, size * 5);
    this.inNest = inNest;
    this.pitch = inNest ? 0.15 : 0.45;
  }

  update(dt: number, input: Input, d: CamInputDelta): void {
    if (d.rotDX || d.rotDY || d.panDX || d.panDY) this.idle = 0;
    this.idle += dt;
    this.yaw -= (d.rotDX + d.panDX) * 0.006;
    this.pitch = THREE.MathUtils.clamp(this.pitch + (d.rotDY + d.panDY) * 0.004, -0.2, 1.4);
    if (input.isDown('rotateLeft')) this.yaw += dt * 1.4;
    if (input.isDown('rotateRight')) this.yaw -= dt * 1.4;
    if (d.wheel) this.goalDistance *= Math.exp(d.wheel * 0.12);
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance, 4, 400);
    this.distance = damp(this.distance, this.goalDistance, 8, dt);
    if (this.autoFollow && this.idle > 3 && !this.inNest) {
      // Slowly swing behind-and-beside the subject for a documentary angle.
      const want = this.heading + Math.PI * 0.75;
      let dy = ((want - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * (1 - Math.exp(-dt * 0.4));
    }
    this.smoothSubject.lerp(this.subject, 1 - Math.exp(-dt * 8));
    let off: THREE.Vector3;
    if (this.inNest) {
      const y = THREE.MathUtils.clamp(this.yaw, -0.7, 0.7);
      off = new THREE.Vector3(Math.sin(y) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(y) * Math.cos(this.pitch));
    } else off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.position.copy(this.smoothSubject).addScaledVector(off, this.distance);
    this.camera.lookAt(this.smoothSubject);
    this.camera.near = Math.max(0.05, this.distance * 0.02);
    this.camera.far = 3000;
    this.camera.updateProjectionMatrix();
  }
}
