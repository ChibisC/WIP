/**
 * Fixed-timestep loop: the simulation advances in 1/20 s ticks scaled by game
 * speed, rendering runs every animation frame and receives an interpolation
 * alpha between the previous and current tick.
 */
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

export interface LoopHooks {
  /** run one tick; return false when it cannot run yet (multiplayer: waiting for a player's packets) */
  tick(dt: number): void | boolean;
  frame(alpha: number, realDt: number, simDt: number): void;
}

export class GameLoop {
  speed = 1;
  paused = false;
  private acc = 0;
  private last = 0;
  private running = false;
  private rafId = 0;
  /** Exponential moving average of frame time in ms, for the perf overlay. */
  frameMs = 16;
  tickMs = 0;
  maxTicksPerFrame = 24;

  constructor(private hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const step = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(step);
      this.step(now);
    };
    this.rafId = requestAnimationFrame(step);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Presentation hit-stop: hold the simulation back for a moment (single player only; the sim itself is unchanged). */
  hitStop(sec: number): void {
    this.acc -= sec;
  }

  /** Advance manually (used by tests and by the headless screenshot harness). */
  step(now: number): void {
    let realDt = (now - this.last) / 1000;
    this.last = now;
    if (realDt > 0.25) realDt = 0.25;
    if (realDt < 0) realDt = 0;
    this.frameMs = this.frameMs * 0.92 + realDt * 1000 * 0.08;
    let simDt = 0;
    if (!this.paused) {
      this.acc += realDt * this.speed;
      let n = 0;
      const t0 = performance.now();
      let waiting = false;
      while (this.acc >= TICK_DT && n < this.maxTicksPerFrame) {
        if (this.hooks.tick(TICK_DT) === false) {
          waiting = true;
          break;
        }
        this.acc -= TICK_DT;
        simDt += TICK_DT;
        n++;
      }
      if (waiting) this.acc = Math.min(this.acc, 0.25); // keep up to 250 ms to catch up once it can run
      else if (n >= this.maxTicksPerFrame) this.acc = 0;
      const t1 = performance.now();
      if (n > 0) this.tickMs = this.tickMs * 0.9 + ((t1 - t0) / n) * 0.1;
    }
    this.hooks.frame(this.paused ? 1 : this.acc / TICK_DT, realDt, simDt);
  }

  /** Run n ticks immediately (fast-forward, tests). */
  advance(n: number): void {
    for (let i = 0; i < n; i++) this.hooks.tick(TICK_DT);
  }
}
