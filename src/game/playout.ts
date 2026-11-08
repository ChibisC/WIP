/**
 * Smooth motion in worker mode (claude/performance/02-spec-responsiveness-client-visuals.md §2; CHANGE_PLAN §29.2,
 * step 2). Render only: the simulation and its state never see any of this.
 *
 * The worker's frames arrive when they are ready, not on the display's clock — at 20 Hz one tick comes 50 ms ± the
 * worker's own tick time after the last, and two or three come together when the worker is busy. The old
 * interpolation ran α 0 → 1 from each arrival over the average gap, so an early frame jumped the units forward, a late
 * one froze them until it came, and a batch drew its first ticks in one frame: the 20 Hz stepping the spec is about.
 *
 * Now a **playout clock** R (in ticks) runs at the loop's own pace — the ticks the loop asked for plus its accumulator,
 * which is smooth in real time and follows the game speed — a little behind it: L ticks, the furthest the loop's clock
 * has got past the newest tick before the next one arrived (an envelope that rises at once and falls slowly), plus a
 * margin. Each entity is drawn on a **segment** from where it was drawn when the newest frame arrived (R = from) to its
 * position in that frame (R = to, the frame's tick):
 *
 *     drawn = px + (x − px) · α,   α = (R − from) / (to − from)
 *
 * with px set to the drawn position as the frame is read (MotionCarry, through the column reader). The renderers keep
 * their `lerp(px, x, α)`. So nothing jumps when a frame arrives, however many ticks it holds or when it comes; between
 * arrivals the motion is uniform; and when a frame is late the units run on along their segment for up to half a tick
 * (α ≤ 1 + min(0.5, 0.5 / (to − from)), at most 1.5), then the late frame takes over from where they are drawn.
 *
 * - Teleports snap: a space change, or a jump far longer than the last tick's travel.
 * - A frame with no tick (commands applied at once) keeps each segment as it was.
 * - Paused: R glides on to the newest tick and stops there (no extrapolation); resuming re-anchors.
 * - R is pulled toward (loop clock − L) by at most ±10 % of its pace, so the speed of the units never visibly changes;
 *   a gap over 3 ticks (a long hitch, a rejoin's catch-up, a speed change) re-anchors at once instead.
 */

/** the snap distance (mm) on top of a few ticks of the entity's own travel */
const SNAP_MM = 10;
/** the shortest segment (ticks): a frame that arrives when R is nearly at its tick moves R back to this */
export const MIN_SPAN = 0.5;
/** extrapolation past the newest tick (ticks, at most) */
const MAX_AHEAD = 0.5;
/** the latency margin over the envelope (ticks) */
const MARGIN = 0.12;
/** the recent arrivals the envelope is taken over (at 20 Hz, about three seconds) */
const NEEDS = 64;
/** a gap between R and its target over this re-anchors at once (ticks) */
const RESET = 3;
/** R's pace may differ from the loop clock's by this much while it closes a gap */
const PULL = 0.1;

/** What carries a position: the replica's ants, food and creatures (px/py/ph are the previous tick's in the sim). */
export interface Moving {
  x: number;
  y: number;
  px: number;
  py: number;
  h?: number;
  ph?: number;
  space?: number;
}

/** Shortest-arc angle interpolation (as the renderers do it). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Carries an entity's drawn position over a frame's update (columns.ts `ColumnReader.read(…, carry)`): `save` runs
 * on the pooled object before the frame's values overwrite it, `restore` after. One object at a time, so the state is
 * a few scratch numbers.
 */
export class MotionCarry {
  /** 'drawn': px/py/ph become where the entity is drawn at `alpha` (a frame with ticks); 'keep': they stay as they
   *  were (a frame with no tick) */
  mode: 'drawn' | 'keep' = 'drawn';
  alpha = 1;
  /** ticks in the frame (the snap distance grows with it) */
  ran = 1;
  /** test for teleports (off when re-anchoring in place) */
  snap = true;
  /** per row: the drawn x, y, heading; the old x, y; the space; whether it has a heading */
  private rec = new Float64Array(0);
  private hasH = new Uint8Array(0);

  private room(i: number): void {
    if (i < this.hasH.length) return;
    const n = Math.max(64, Math.ceil((i + 1) * 1.5));
    const r = new Float64Array(n * 6);
    r.set(this.rec);
    this.rec = r;
    const h = new Uint8Array(n);
    h.set(this.hasH);
    this.hasH = h;
  }

  save(o: Moving, i = 0): void {
    this.room(i);
    const r = this.rec;
    const k = i * 6;
    r[k + 3] = o.x;
    r[k + 4] = o.y;
    r[k + 5] = o.space ?? 0;
    const hasH = o.ph !== undefined && o.h !== undefined;
    this.hasH[i] = hasH ? 1 : 0;
    if (this.mode === 'keep') {
      r[k] = o.px;
      r[k + 1] = o.py;
      if (hasH) r[k + 2] = o.ph as number;
      return;
    }
    const a = this.alpha;
    r[k] = o.px + (o.x - o.px) * a;
    r[k + 1] = o.py + (o.y - o.py) * a;
    if (hasH) r[k + 2] = lerpAngle(o.ph as number, o.h as number, a);
  }

  restore(o: Moving, i = 0): void {
    const r = this.rec;
    const k = i * 6;
    if ((o.space ?? 0) !== r[k + 5]) return; // changed space: the sim's own px (a snap)
    const sx = r[k];
    const sy = r[k + 1];
    if (this.snap) {
      if (this.mode === 'keep') {
        // (a frame with no tick does not move anything — unless a command placed it: then the sim's px)
        if (Math.abs(o.x - r[k + 3]) + Math.abs(o.y - r[k + 4]) > SNAP_MM) return;
      } else {
        const step = Math.hypot(o.x - o.px, o.y - o.py);
        const jump = Math.hypot(o.x - sx, o.y - sy);
        if (jump > SNAP_MM + 3 * (this.ran + 1) * step) return;
      }
    }
    o.px = sx;
    o.py = sy;
    if (this.hasH[i] && o.ph !== undefined) o.ph = r[k + 2];
  }
}

/** The playout clock (see the file's comment). */
export class Playout {
  /** the render clock (ticks); NaN until the first ticked frame has been drawn from */
  R = NaN;
  /** the segment: R where every entity's px is → the newest frame's tick */
  from = 0;
  to = 0;
  /** how far the loop's clock gets past the newest tick before the next one arrives (ticks; a high percentile) */
  env = 1;
  /** the envelope's percentile of the recent needs */
  static quantile = 0.98;
  private needs = new Float64Array(NEEDS);
  private sorted = new Float64Array(NEEDS);
  private needN = 0;
  /** α of the last render (the drawn positions a frame that arrives now carries) */
  lastAlpha = 1;
  /** the loop's clock at the last render (monotonic: a hit-stop steps it back; R then holds until it catches up) */
  private clock = NaN;
  private lastNow = 0;
  private started = false;
  private wasPaused = false;
  /** a ticked frame has arrived since the last render */
  private fresh = false;
  /** re-anchor every carried entity at α (px := drawn); set by the host */
  reanchor: ((alpha: number) => void) | null = null;

  /** the latency kept behind the loop's clock (ticks) */
  get latency(): number {
    return Math.min(4, Math.max(0.3, this.env + MARGIN));
  }

  /**
   * A frame with ticks arrived (before it is read): `tick` its newest tick, `prevTick` the replica's before it.
   * Returns the α to carry the drawn positions with.
   */
  arrive(tick: number, prevTick: number): number {
    const a = this.started ? this.lastAlpha : 1;
    if (this.started && !this.fresh && Number.isFinite(this.clock) && !this.wasPaused) {
      // the loop's clock had got this far past the newest tick at the last render: R must stay that far behind it
      // (a high percentile of the last few seconds: a rare hitch is not worth a permanent delay — the units stop for
      // it — while a steady need, like frames of two ticks, is covered within a few arrivals)
      const k = this.needN++ % NEEDS;
      this.needs[k] = this.clock - prevTick;
      const n = Math.min(this.needN, NEEDS);
      if (n >= 8) {
        const srt = this.sorted;
        for (let i = 0; i < n; i++) srt[i] = this.needs[i];
        const v = srt.subarray(0, n).sort();
        this.env = v[Math.floor((n - 1) * Playout.quantile)];
      }
    }
    this.fresh = true;
    this.started = true;
    this.to = tick;
    if (!Number.isNaN(this.R)) {
      this.from = this.R;
      if (this.to - this.from < MIN_SPAN) this.R = this.from = this.to - MIN_SPAN;
    }
    // (another frame before the next render starts from the same drawn positions, α 0 on this segment)
    this.lastAlpha = 0;
    return a;
  }

  /**
   * The α for this render. `clock`: the loop's clock (ticks: the ticks asked for plus the accumulator); `now`: ms.
   */
  frame(clock: number, now: number, paused: boolean): number {
    const dtTicks = this.lastNow ? Math.max(0, now - this.lastNow) / 50 : 0;
    this.lastNow = now;
    if (!this.started) {
      this.clock = clock;
      return (this.lastAlpha = 1);
    }
    this.fresh = false;
    const target = clock - this.latency;
    if (Number.isNaN(this.R)) {
      // the first ticked frame: every px is where it was drawn (α 1 of the start), the segment starts here
      this.R = this.from = Math.min(target, this.to - MIN_SPAN);
      this.clock = clock;
    } else if (paused) {
      // glide to the newest tick and stop there
      if (this.R < this.to) this.R = Math.min(this.to, this.R + dtTicks);
      this.wasPaused = true;
    } else {
      if (this.wasPaused || !Number.isFinite(this.clock)) {
        this.wasPaused = false;
        this.clock = clock;
        this.jump(Math.min(target, this.to - MIN_SPAN));
      } else {
        const d = Math.max(0, clock - this.clock);
        this.clock = Math.max(this.clock, clock);
        const err = target - (this.R + d);
        if (err > RESET && this.R < this.to - MIN_SPAN - 0.01) this.jump(Math.min(target, this.to - MIN_SPAN));
        else if (err < -RESET) this.jump(target);
        else {
          // (past the newest tick the units ease off — up to 60 % slower by the extrapolation's end — so a late frame
          // reads as a slow-down rather than a stop)
          const ease = this.R > this.to ? 1 - 0.6 * Math.min(1, (this.R - this.to) / MAX_AHEAD) : 1;
          this.R += d * ease * (1 + Math.max(-1, Math.min(1, err)) * PULL);
        }
        // (no further than the extrapolation goes: a stall holds R there, and the next frame starts from it)
        if (this.R > this.to + MAX_AHEAD) this.R = this.to + MAX_AHEAD;
      }
    }
    const span = Math.max(1e-6, this.to - this.from);
    const a = (this.R - this.from) / span;
    return (this.lastAlpha = Math.max(0, Math.min(1 + Math.min(MAX_AHEAD, MAX_AHEAD / span), a)));
  }

  /** Move R at once, keeping every entity where it is drawn. */
  private jump(r: number): void {
    if (Math.abs(r - this.R) < 1e-3) return;
    const span = Math.max(1e-6, this.to - this.from);
    const a = Math.max(0, Math.min(1 + Math.min(MAX_AHEAD, MAX_AHEAD / span), (this.R - this.from) / span));
    if (a !== 0) this.reanchor?.(a);
    this.R = this.from = r;
    if (this.to - this.from < MIN_SPAN && this.to - this.from >= 0) this.R = this.from = this.to - MIN_SPAN;
  }
}
