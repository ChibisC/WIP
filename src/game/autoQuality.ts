/**
 * Automatic graphics quality (performance brief, Part A): steps the preset
 * down when frames stay slow, and back up (never above where it started)
 * when they stay fast.
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
    if (this.slowT > 3 && i > 0) {
      view.setQuality(ORDER[i - 1]);
      this.lastChange = `down to ${ORDER[i - 1]} (${this.ema.toFixed(0)} ms frames)`;
      this.slowT = 0;
      this.ema = 14;
    } else if (this.fastT > 12 && i < ORDER.indexOf(this.ceiling)) {
      view.setQuality(ORDER[i + 1]);
      this.lastChange = `up to ${ORDER[i + 1]} (${this.ema.toFixed(0)} ms frames)`;
      this.fastT = 0;
      this.ema = 14;
    }
  }
}
