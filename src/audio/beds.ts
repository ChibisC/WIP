import { SOUND } from './catalog';
import { audio } from './engine';

/**
 * Continuous layers (Phase 14 audio).
 * - `LoopBed`: a looping texture (wind, the nest's room tone, rain, a stream)
 *   with a level and a tone control. Recorded loops stream; stand-ins loop a buffer.
 * - `GrainBed`: granular playback of a recorded or stand-in texture. Short
 *   grains are taken from random points of the texture and overlapped, so
 *   the density, brightness and level can follow the game every frame
 *   (hundreds of ants become one rustling swarm; a battle past the voice
 *   limit thickens into one crackling bed).
 */
export class LoopBed {
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private started = false;
  private level = 0;

  constructor(
    private id: string,
    private muffled = false,
  ) {}

  private start(): boolean {
    const ctx = audio.ctx;
    const def = SOUND[this.id];
    if (!ctx || !def) return false;
    const bed = audio.bank.bed(def);
    if (!bed) return false;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.connect(this.gain).connect(audio.input(def.bus, this.muffled));
    if (bed.element) {
      const src = ctx.createMediaElementSource(bed.element);
      src.connect(this.filter);
      void bed.element.play().catch(() => undefined);
    } else if (bed.buffer) {
      const src = ctx.createBufferSource();
      src.buffer = bed.buffer;
      src.loop = true;
      src.connect(this.filter);
      // each bed starts at a different point of its loop, so layers never line up
      src.start(ctx.currentTime, Math.random() * bed.buffer.duration);
    }
    this.started = true;
    return true;
  }

  /** Level 0–1 (times the sound's catalog gain), eased over `ease` seconds; `tone` is a lowpass cutoff (Hz). */
  set(level: number, ease = 0.4, tone = 20000): void {
    if (!this.started) {
      if (level <= 0.001 || !this.start()) return;
    }
    const ctx = audio.ctx!;
    const def = SOUND[this.id];
    const v = Math.max(0, level) * def.gain;
    if (Math.abs(v - this.level) > 0.002) {
      this.gain!.gain.setTargetAtTime(v, ctx.currentTime, ease / 3);
      this.level = v;
    }
    this.filter!.frequency.setTargetAtTime(Math.max(200, tone), ctx.currentTime, ease / 3);
  }
}

export class GrainBed {
  private out: GainNode | null = null;
  private tone: BiquadFilterNode | null = null;
  private next = 0;
  density = 0;
  level = 0;
  /** lowpass cutoff (Hz): brighter when close, duller far away */
  bright = 12000;
  /** grain length (s) */
  grain = 0.09;
  /** playback-rate spread: grains of a lower-pitched creature play slower */
  rate = 1;

  constructor(private id: string) {}

  private init(): boolean {
    const ctx = audio.ctx;
    const def = SOUND[this.id];
    if (!ctx || !def) return false;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = this.bright;
    this.tone.connect(this.out).connect(audio.input(def.bus));
    this.next = ctx.currentTime + 0.05;
    return true;
  }

  /** Schedule grains up to 150 ms ahead; call every frame. */
  update(): void {
    const ctx = audio.ctx;
    if (!ctx) return;
    if (!this.out && (this.level <= 0.001 || !this.init())) return;
    const def = SOUND[this.id];
    const takes = audio.bank.takes(def);
    const t = ctx.currentTime;
    this.out!.gain.setTargetAtTime(this.level * def.gain, t, 0.15);
    this.tone!.frequency.setTargetAtTime(this.bright, t, 0.2);
    if (!takes || !takes.length || this.level <= 0.001 || this.density <= 0.5) {
      this.next = Math.max(this.next, t);
      return;
    }
    if (this.next < t - 0.3) this.next = t;
    const src = takes[0];
    // each grain carries `grain` seconds of texture; overlapping grains keep it continuous
    while (this.next < t + 0.15) {
      const g = ctx.createBufferSource();
      g.buffer = src;
      g.playbackRate.value = this.rate * (0.92 + Math.random() * 0.16);
      const e = ctx.createGain();
      const len = this.grain * (0.7 + Math.random() * 0.6);
      const at = this.next;
      e.gain.setValueAtTime(0, at);
      e.gain.linearRampToValueAtTime(0.7 + Math.random() * 0.6, at + len * 0.3);
      e.gain.linearRampToValueAtTime(0, at + len);
      g.connect(e).connect(this.tone!);
      g.start(at, Math.random() * Math.max(0.01, src.duration - len - 0.01), len + 0.02);
      this.next += 1 / Math.max(1, this.density);
    }
  }
}
