/**
 * Automatic graphics quality (performance brief, Part A; dynamic resolution since the performance pass): when frames
 * stay slow it lowers the render resolution a step at a time, and only at the floor steps the preset down; when they
 * stay fast, resolution comes back first, then the preset (never above where it started).
 */
import type { GameView, Quality } from '../render/view';
import { TOUCH } from '../core/device';
import { prof } from '../core/profiler';

/**
 * The phone and tablet GPU memory budget (performance pass): the browser shares the device's memory with the page,
 * and an iPhone's Safari drops a WebGL context well before the desktop would. Over it, the preset steps down (render
 * targets and the shadow map shrink); it does not come back up until well under it. MB, estimated (core/profiler.ts).
 */
export const MOBILE_GPU_BUDGET_MB = 600;

const ORDER: Quality[] = ['low', 'medium', 'high'];

export class AutoQuality {
  enabled = false;
  /** the highest preset auto may choose (phones and tablets: Medium, for battery and heat; High stays a manual pick) */
  ceiling: Quality = TOUCH ? 'medium' : 'high';
  private slowT = 0;
  private fastT = 0;
  private ema = 16;
  /** last change, for the debug overlay */
  lastChange = '';

  private memT = 0;

  /**
   * Call every frame with the real frame time (s) and the frame cap in force (0 none). Under a cap the frame time
   * cannot fall below the cap's, so "fast" is judged by the main thread's own time instead.
   */
  update(view: GameView, realDt: number, cap = 0): void {
    if (!this.enabled || realDt <= 0 || realDt > 0.5) return; // ignore tab switches and loading hitches
    const ms = realDt * 1000;
    this.ema = this.ema * 0.9 + ms * 0.1;
    const i = ORDER.indexOf(view.quality);
    // the phone memory budget comes first
    const mem = TOUCH ? prof.gpuMB() : 0;
    this.memT = mem > MOBILE_GPU_BUDGET_MB ? this.memT + realDt : 0;
    if (this.memT > 2 && i > 0) {
      view.setQuality(ORDER[i - 1]);
      this.lastChange = `down to ${ORDER[i - 1]} (GPU memory ${mem.toFixed(0)} MB, over the ${MOBILE_GPU_BUDGET_MB} MB budget)`;
      this.memT = 0;
      return;
    }
    // (frame-time targets: 60 fps, or the cap's rate)
    const target = cap > 0 ? 1000 / cap : 1000 / 60;
    const fast = cap > 0 ? this.ema < target * 1.03 && prof.cpuMs.ema < target * 0.45 : this.ema < target * 0.66;
    if (this.ema > target * 1.08) {
      this.slowT += realDt;
      this.fastT = 0;
    } else if (fast && mem < MOBILE_GPU_BUDGET_MB * 0.75) {
      this.fastT += realDt;
      this.slowT = 0;
    } else {
      this.slowT = 0;
      this.fastT = 0;
    }
    // Dynamic resolution first (performance pass): a slow stretch lowers the render resolution a step (a light sharpening
    // keeps edges crisp) down to the view's floor; only then does the preset step down. Fast again: resolution first.
    if (this.slowT > 1.5 && view.renderScale > view.minRenderScale + 0.01) {
      view.setRenderScale(view.renderScale - 0.1);
      this.lastChange = `resolution down to ${Math.round(view.renderScale * 100)} % (${this.ema.toFixed(0)} ms frames)`;
      this.slowT = 0;
      this.ema = 15;
    } else if (this.slowT > 3 && i > 0) {
      view.setQuality(ORDER[i - 1]);
      this.lastChange = `down to ${ORDER[i - 1]} (${this.ema.toFixed(0)} ms frames)`;
      this.slowT = 0;
      this.ema = 14;
    } else if (this.fastT > 6 && view.renderScale < 0.999) {
      view.setRenderScale(view.renderScale + 0.1);
      this.lastChange = `resolution up to ${Math.round(view.renderScale * 100)} % (${this.ema.toFixed(0)} ms frames)`;
      this.fastT = 0;
      this.ema = 12;
    } else if (this.fastT > 12 && i < ORDER.indexOf(this.ceiling)) {
      view.setQuality(ORDER[i + 1]);
      this.lastChange = `up to ${ORDER[i + 1]} (${this.ema.toFixed(0)} ms frames)`;
      this.fastT = 0;
      this.ema = 14;
    }
  }
}
