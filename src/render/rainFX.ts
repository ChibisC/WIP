import * as THREE from 'three';

/**
 * Falling rain (render only): short pale streaks in a box round what the camera looks at, while a storm or a story
 * level's shower is on (`View.storm`, eased). The streaks are one LineSegments draw; each falls at its own speed, a
 * little slanted by the wind, and starts again at the top when it reaches the ground. The box scales with the camera's
 * distance so the rain reads at every zoom, and it fades with the storm. Nothing in the simulation depends on it.
 */
const N = 1400;

export class RainFX {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private seed: Float32Array;
  private mat: THREE.LineBasicMaterial;

  constructor() {
    this.pos = new Float32Array(N * 6);
    this.seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      // (render only: a fixed hash, not the simulation's RNG)
      const h = (k: number) => {
        const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
        return x - Math.floor(x);
      };
      this.seed.set([h(1), h(2), h(3), 0.75 + h(4) * 0.5], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xc8d2dc, transparent: true, opacity: 0, depthWrite: false, fog: true });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.name = 'rain';
    this.lines.renderOrder = 5;
  }

  /** `level` 0..1 (the eased storm), the point the camera looks at, its distance; `t` the render clock (s). */
  update(level: number, at: THREE.Vector3, dist: number, t: number): void {
    const on = level > 0.03;
    this.lines.visible = on;
    if (!on) return;
    this.mat.opacity = Math.min(0.55, level * 0.6);
    const half = Math.max(60, dist * 0.9);
    const top = Math.max(60, dist * 0.7);
    const len = Math.max(2.5, dist * 0.025);
    const fall = Math.max(120, dist * 1.6); // mm/s at this zoom (reads as rain, not as drifting specks)
    const wind = 0.18;
    for (let i = 0; i < N; i++) {
      const s0 = this.seed[i * 4];
      const s1 = this.seed[i * 4 + 1];
      const s2 = this.seed[i * 4 + 2];
      const sp = this.seed[i * 4 + 3];
      // height in the box: falls and wraps (each streak has its own phase and speed)
      const y = top - ((s2 * top + t * fall * sp) % top);
      const x = at.x + (s0 * 2 - 1) * half + (top - y) * wind;
      const z = at.z + (s1 * 2 - 1) * half;
      const k = i * 6;
      this.pos[k] = x;
      this.pos[k + 1] = at.y + y;
      this.pos[k + 2] = z;
      this.pos[k + 3] = x - len * wind;
      this.pos[k + 4] = at.y + y - len;
      this.pos[k + 5] = z;
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
