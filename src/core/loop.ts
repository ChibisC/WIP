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
  /** frame cap (performance pass): 0 follows the display; 30 or 60 skips animation frames to hold that rate (battery,
   *  heat on phones). The simulation is unchanged: ticks follow real time either way. */
  frameCap = 0;
  private lastShown = 0;
  /** profiling hooks (game/profiler.ts): the frame starts, the ticks ran (ms), the frame ends */
  onStepStart: ((now: number) => void) | null = null;
  onTicks: ((ms: number) => void) | null = null;
  onStepEnd: (() => void) | null = null;

  constructor(private hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const step = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(step);
      if (this.frameCap > 0) {
        const every = 1000 / this.frameCap;
        // (a 2 ms allowance: a 60 Hz display's frames land at 16.6 ms ± jitter and must not be skipped at a 60 cap)
        if (now - this.lastShown < every - 2) return;
        this.lastShown = now - this.lastShown > every * 3 ? now : this.lastShown + every;
      }
      this.step(now);
    };
    this.rafId = requestAnimationFrame(step);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /**
   * Presentation hit-stop: hold the simulation back for a moment (single player only; the sim itself is unchanged).
   * Performance v5: hit-stops do not add up — one already holding is at most lengthened to `sec`, and another within
   * a quarter of a second of the last is ignored. In a big fight every slam and impale near the camera took its 33–80
   * ms off the clock: more hold than time, so the game fell behind for good (0.05× at 1× in the benchmark).
   */
  hitStop(sec: number, now = performance.now()): void {
    if (now - this.lastHitStop < 250) return;
    this.lastHitStop = now;
    this.acc = Math.min(this.acc, Math.max(this.acc - sec, -sec));
  }

  private lastHitStop = -Infinity;

  /** Advance manually (used by tests and by the headless screenshot harness). */
  step(now: number): void {
    this.onStepStart?.(now);
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
      this.onTicks?.(t1 - t0);
    }
    this.hooks.frame(this.paused ? 1 : this.acc / TICK_DT, realDt, simDt);
    this.onStepEnd?.();
  }

  /** Run n ticks immediately (fast-forward, tests). */
  advance(n: number): void {
    for (let i = 0; i < n; i++) this.hooks.tick(TICK_DT);
  }
}
