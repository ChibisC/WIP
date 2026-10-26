/**
 * Surface pheromone grid. One trail channel per colony (laid by foragers
 * returning with food, evaporates over time) and one shared alarm channel
 * (fast diffusion, fast decay).
 */
import { dpow } from './dmath';
export class Pheromones {
  readonly res = 4; // mm per cell
  readonly w: number;
  readonly h: number;
  trail: Float32Array[] = [];
  alarm: Float32Array;
  private tmp: Float32Array;
  /** bumped when the overlay should refresh */
  version = 0;

  constructor(width: number, depth: number, colonies: number) {
    this.w = Math.ceil(width / this.res) + 1;
    this.h = Math.ceil(depth / this.res) + 1;
    for (let i = 0; i < colonies; i++) this.trail.push(new Float32Array(this.w * this.h));
    this.alarm = new Float32Array(this.w * this.h);
    this.tmp = new Float32Array(this.w * this.h);
  }

  ensureColonies(n: number): void {
    while (this.trail.length < n) this.trail.push(new Float32Array(this.w * this.h));
  }

  private idx(x: number, y: number): number {
    const i = Math.round(x / this.res);
    const j = Math.round(y / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  deposit(colony: number, x: number, y: number, amount: number): void {
    const k = this.idx(x, y);
    if (k < 0) return;
    const t = this.trail[colony];
    t[k] = Math.min(4, t[k] + amount);
  }

  depositAlarm(x: number, y: number, amount: number): void {
    const k = this.idx(x, y);
    if (k < 0) return;
    this.alarm[k] = Math.min(3, this.alarm[k] + amount);
  }

  sample(colony: number, x: number, y: number): number {
    const k = this.idx(x, y);
    return k < 0 ? 0 : this.trail[colony][k];
  }

  sampleAlarm(x: number, y: number): number {
    const k = this.idx(x, y);
    return k < 0 ? 0 : this.alarm[k];
  }

  /** Evaporation + alarm diffusion; called every sim tick (dt = 0.05). The phase comes from the world tick, so a restored snapshot evaporates on the same ticks. */
  update(dt: number, tick: number): void {
    // Trails evaporate a quarter of the map per tick (each cell every 4 ticks), so the work is spread evenly.
    {
      const band = tick & 3;
      const step = dt * 4;
      const trailDecay = dpow(0.5, step / 70); // half-life 70 s
      const k0 = Math.floor((this.h * band) / 4) * this.w;
      const k1 = Math.floor((this.h * (band + 1)) / 4) * this.w;
      for (const t of this.trail)
        for (let k = k0; k < k1; k++) {
          const v = t[k];
          if (v === 0) continue;
          t[k] = v > 0.001 ? v * trailDecay : 0;
        }
    }
    if (tick % 4 === 0) {
      const step = dt * 4;
      // alarm: diffuse + decay (half-life ~3 s)
      const a = this.alarm;
      const W = this.w;
      const d = dpow(0.5, step / 3);
      const tmp = this.tmp;
      for (let j = 1; j < this.h - 1; j++)
        for (let i = 1; i < W - 1; i++) {
          const k = j * W + i;
          const s = a[k] * 0.6 + (a[k - 1] + a[k + 1] + a[k - W] + a[k + W]) * 0.1;
          tmp[k] = s * d < 0.002 ? 0 : s * d;
        }
      a.set(tmp);
      this.version++;
    }
  }

  /** Pack channels for the render overlay: R = trail(colony), G = alarm, B = other colonies' trails. */
  pack(colony: number, out: Uint8Array): void {
    const t = this.trail[colony];
    const a = this.alarm;
    for (let k = 0; k < t.length; k++) {
      let other = 0;
      for (let c = 0; c < this.trail.length; c++) if (c !== colony) other = Math.max(other, this.trail[c][k]);
      out[k * 4] = Math.min(255, (t ? t[k] : 0) * 120);
      out[k * 4 + 1] = Math.min(255, a[k] * 150);
      out[k * 4 + 2] = Math.min(255, other * 90);
      out[k * 4 + 3] = 255;
    }
  }
}
