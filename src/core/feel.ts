/**
 * How the game feels (claude/performance/02-spec-responsiveness-client-visuals.md §1). Client only: nothing here
 * touches the simulation. The F3 overlay and the benchmark (`?bench=1`) read it.
 *
 * - **Input → feedback**: from the input event (its own timestamp, so the time it waited for the page counts) to the
 *   end of the first animation frame that started after it — the frame that draws the reaction (a selection ring, a
 *   marker, a ghost hex, the camera's move). The compositor shows that frame at the next vsync, a few ms later.
 * - **Input → acting**: from the input to the end of the first frame that draws the tick the command acts in (the units
 *   seen to start moving: in worker mode the playout clock's tick, a little behind the newest — game/playout.ts).
 * - **Command latency**: issue → the tick that applies it, in ticks and ms (single-player: the next tick; multiplayer:
 *   the lockstep delay plus the round trip).
 * - **Frame pacing**: the animation frame intervals, their jitter (mean |change| from one interval to the next),
 *   frames over 16.7 and 33 ms, frames that missed at least one vsync (an interval over 1.5 × the display's, estimated
 *   as the 10th percentile of the intervals), and long tasks (main-thread tasks over 50 ms, where the browser reports
 *   them).
 */
import { Stat } from './profiler';

export type InputKind = 'select' | 'order' | 'build' | 'dig' | 'camera' | 'key';
export const INPUT_KINDS: readonly InputKind[] = ['select', 'order', 'build', 'dig', 'camera', 'key'];

interface Waiting {
  kind: InputKind;
  t: number;
}

interface CmdWait {
  kind: InputKind;
  /** the input's time */
  t: number;
  /** issued at (ms) */
  at: number;
  /** the tick the client was on when issuing */
  tick: number;
}

export class Feel {
  readonly feedback: Record<InputKind, Stat> = Object.fromEntries(INPUT_KINDS.map((k) => [k, new Stat(120)])) as Record<InputKind, Stat>;
  readonly acting: Record<InputKind, Stat> = Object.fromEntries(INPUT_KINDS.map((k) => [k, new Stat(120)])) as Record<InputKind, Stat>;
  readonly cmdMs = new Stat(200);
  readonly cmdTicks = new Stat(200);
  readonly interval = new Stat(600);
  readonly jitter = new Stat(600);
  /** frames counted, over 16.7 ms, over 33 ms, missed a vsync */
  frames = 0;
  over16 = 0;
  over33 = 0;
  missed = 0;
  /** long tasks (count, ms) since the last reset; null where the browser does not report them */
  longTasks: { n: number; ms: number } | null = null;
  /** the display's frame interval (ms), estimated */
  vsync = 16.7;
  private waiting: Waiting[] = [];
  private cmds = new Map<number, CmdWait>();
  private applied: Array<{ kind: InputKind; t: number; tick: number }> = [];
  private lastFrame = 0;
  private lastInterval = 0;
  /** the time of the input being handled right now (commands it issues are measured from it) */
  private current: { kind: InputKind; t: number } | null = null;

  constructor() {
    try {
      const po = new PerformanceObserver((list) => {
        if (!this.longTasks) return;
        for (const e of list.getEntries()) {
          this.longTasks.n++;
          this.longTasks.ms += e.duration;
        }
      });
      po.observe({ type: 'longtask', buffered: false } as PerformanceObserverInit);
      this.longTasks = { n: 0, ms: 0 };
    } catch {
      this.longTasks = null;
    }
  }

  /**
   * An input happened (`t`: the event's timeStamp where there is one). At most one is waited on per kind: a drag's
   * stream of moves is measured from its first move until a frame shows it.
   */
  input(kind: InputKind, t = performance.now()): void {
    this.current = { kind, t };
    if (!this.waiting.some((w) => w.kind === kind)) this.waiting.push({ kind, t });
  }

  /** The input's handler is done (commands issued after this are not measured from it). */
  inputDone(): void {
    this.current = null;
  }

  /** A command was issued (`seq`: its sequence number; `tick`: the client's tick now). */
  command(seq: number, kind: InputKind, tick: number): void {
    const now = performance.now();
    const c = this.current;
    this.cmds.set(seq, { kind: c?.kind ?? kind, t: c?.t ?? now, at: now, tick });
    if (this.cmds.size > 64) this.cmds.delete(this.cmds.keys().next().value as number);
  }

  /** The simulation applied (or refused) one of this player's commands; it acts in tick `tick`. */
  ack(seq: number, tick: number): void {
    const c = this.cmds.get(seq);
    if (!c) return;
    this.cmds.delete(seq);
    this.cmdMs.push(performance.now() - c.at);
    this.cmdTicks.push(Math.max(0, tick - c.tick));
    this.applied.push({ kind: c.kind, t: c.t, tick });
    if (this.applied.length > 64) this.applied.shift();
  }

  /** The end of an animation frame (`tick`: the simulation tick drawn, fractional in worker mode). */
  frameEnd(frameStart: number, tick: number): void {
    const now = performance.now();
    // input → feedback: inputs from before this frame started are drawn in it
    if (this.waiting.length) {
      let k = 0;
      for (const w of this.waiting) {
        if (w.t <= frameStart) this.feedback[w.kind].push(now - w.t);
        else this.waiting[k++] = w;
      }
      this.waiting.length = k;
    }
    // input → acting: the tick that applies it has run
    if (this.applied.length) {
      let k = 0;
      for (const a of this.applied) {
        if (tick >= a.tick) this.acting[a.kind].push(now - a.t);
        else this.applied[k++] = a;
      }
      this.applied.length = k;
    }
    // pacing
    if (this.lastFrame) {
      const dt = frameStart - this.lastFrame;
      if (dt > 0 && dt < 1000) {
        this.frames++;
        this.interval.push(dt);
        if (this.lastInterval) this.jitter.push(Math.abs(dt - this.lastInterval));
        this.lastInterval = dt;
        if (dt > 16.7 + 1) this.over16++;
        if (dt > 33.4) this.over33++;
        if (this.frames % 60 === 0) this.vsync = this.estimateVsync();
        if (dt > this.vsync * 1.5) this.missed++;
      }
    }
    this.lastFrame = frameStart;
  }

  /** The display's interval: the 10th percentile of the recent intervals, snapped to a common refresh rate. */
  private estimateVsync(): number {
    const p10 = this.interval.percentile(0.1);
    for (const hz of [240, 165, 144, 120, 90, 75, 60, 50, 30]) {
      const ms = 1000 / hz;
      if (Math.abs(p10 - ms) < ms * 0.12) return ms;
    }
    return p10 || 16.7;
  }

  reset(): void {
    for (const k of INPUT_KINDS) {
      this.feedback[k].reset();
      this.acting[k].reset();
    }
    this.cmdMs.reset();
    this.cmdTicks.reset();
    this.interval.reset();
    this.jitter.reset();
    this.frames = this.over16 = this.over33 = this.missed = 0;
    if (this.longTasks) this.longTasks = { n: 0, ms: 0 };
    this.waiting.length = 0;
    this.applied.length = 0;
    this.cmds.clear();
    this.lastFrame = 0;
    this.lastInterval = 0;
  }

  /** One line per measure, for F3 and the benchmark's report. */
  lines(): string[] {
    const fmt = (s: Stat) => (s.count ? `${s.summary().avg.toFixed(0)}/${s.summary().p95.toFixed(0)}` : '—');
    const fb = INPUT_KINDS.filter((k) => this.feedback[k].count).map((k) => `${k} ${fmt(this.feedback[k])}`);
    const ac = INPUT_KINDS.filter((k) => this.acting[k].count).map((k) => `${k} ${fmt(this.acting[k])}`);
    const iv = this.interval.summary();
    const lt = this.longTasks ? `${this.longTasks.n} long tasks (${this.longTasks.ms.toFixed(0)} ms)` : 'long tasks n/a';
    return [
      `input → feedback ms (avg/p95): ${fb.join('  ') || '—'}`,
      `input → acting ms: ${ac.join('  ') || '—'}  ·  command ${this.cmdTicks.count ? `${this.cmdTicks.summary().avg.toFixed(1)} ticks, ${this.cmdMs.summary().avg.toFixed(0)} ms` : '—'}`,
      `pacing: interval ${iv.avg.toFixed(1)} ms (p95 ${iv.p95.toFixed(1)}), jitter ${this.jitter.count ? this.jitter.summary().avg.toFixed(1) : '—'} ms, display ${this.vsync.toFixed(1)} ms · over 16.7 ms ${pct(this.over16, this.frames)}, over 33 ms ${pct(this.over33, this.frames)}, missed vsync ${pct(this.missed, this.frames)} · ${lt}`,
    ];
  }

  /** The numbers, for the benchmark's results. */
  summary(): FeelSummary {
    const st = (s: Stat) => (s.count ? { avg: +s.summary().avg.toFixed(1), p95: +s.summary().p95.toFixed(1), n: s.count } : null);
    return {
      feedback: Object.fromEntries(INPUT_KINDS.map((k) => [k, st(this.feedback[k])])) as FeelSummary['feedback'],
      acting: Object.fromEntries(INPUT_KINDS.map((k) => [k, st(this.acting[k])])) as FeelSummary['acting'],
      cmdTicks: st(this.cmdTicks),
      cmdMs: st(this.cmdMs),
      interval: st(this.interval),
      jitter: st(this.jitter),
      frames: this.frames,
      over16: this.over16,
      over33: this.over33,
      missed: this.missed,
      vsync: +this.vsync.toFixed(1),
      longTasks: this.longTasks ? { n: this.longTasks.n, ms: Math.round(this.longTasks.ms) } : null,
    };
  }
}

type S = { avg: number; p95: number; n: number } | null;
export interface FeelSummary {
  feedback: Record<InputKind, S>;
  acting: Record<InputKind, S>;
  cmdTicks: S;
  cmdMs: S;
  interval: S;
  jitter: S;
  frames: number;
  over16: number;
  over33: number;
  missed: number;
  vsync: number;
  longTasks: { n: number; ms: number } | null;
}

function pct(n: number, of: number): string {
  return of ? `${((n / of) * 100).toFixed(1)} %` : '—';
}

/** The one feel meter of this page. */
export const feel = new Feel();
