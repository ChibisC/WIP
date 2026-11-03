/**
 * Automatic graphics quality (performance brief, Part A; dynamic resolution since the performance pass): when frames
 * stay slow it lowers the render resolution a step at a time, and only at the floor steps the preset down; when they
 * stay fast, resolution comes back first, then the preset (never above where it started).
 */
import type { GameView, Quality } from '../render/view';
import { TOUCH } from '../core/device';

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

  /** Call every frame with the real frame time (s). */
  update(view: GameView, realDt: number): void {
    if (!this.enabled || realDt <= 0 || realDt > 0.5) return; // ignore tab switches and loading hitches
    const ms = realDt * 1000;
    this.ema = this.ema * 0.9 + ms * 0.1;
    const i = ORDER.indexOf(view.quality);
    if (this.ema > 18) {
      this.slowT += realDt;
      this.fastT = 0;
    } else if (this.ema < 11) {
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
