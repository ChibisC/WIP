import { audio, playBuffer } from './engine';
import { LoopBed } from './beds';
import { SOUND } from './catalog';
import { rng } from './dsp';
import { SR, flute, handDrum, kalimba, shaker, string } from './standins';

/**
 * Adaptive music (Phase 14 audio): soft, documentary-style, acoustic.
 *
 * With recorded stems (music/explore, battle, boss in public/audio), the
 * three play in sync and crossfade: explore always, battle with the
 * fighting, boss while a boss is near.
 *
 * Without them, a procedural score plays the same roles on acoustic
 * instruments rendered from physical models: plucked strings (harp,
 * guitar, pizzicato), kalimba, a wooden flute, frame drums and a seed
 * shaker. D dorian, 96 BPM, a chord every two bars. Calm when building and
 * exploring; drums, shakers and a string ostinato come in with the
 * fighting; big low drums and tremolo strings swell for a boss. It stays
 * under the nature sounds (music bus, plus ducking for alerts and narration).
 */
const BPM = 96;
const EIGHTH = 60 / BPM / 2;
const BAR = EIGHTH * 8;
// chord roots and tones (MIDI): Dm9, C6/9, G add9, Am7
const CHORDS: Array<{ root: number; tones: number[] }> = [
  { root: 38, tones: [50, 57, 60, 62, 64, 65, 69] },
  { root: 36, tones: [48, 55, 60, 62, 64, 67, 69] },
  { root: 43, tones: [55, 59, 62, 67, 69, 71, 74] },
  { root: 45, tones: [57, 60, 64, 67, 69, 72, 76] },
];
const MELODY = [62, 64, 65, 67, 69, 72, 74, 76];
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type Inst = 'harp' | 'pizz' | 'bass' | 'kalimba' | 'flute' | 'drumLow' | 'drumHigh' | 'drumBig' | 'shaker';

export class Music {
  private stems: LoopBed[] | null = null;
  private notes = new Map<string, AudioBuffer>();
  private next = 0;
  private step = 0;
  private intensity = 0;
  private boss = 0;
  private r = rng(12345);

  /** `intensity` and `boss` are targets (0–1), eased here. */
  update(dt: number, intensity: number, boss: number): void {
    const ctx = audio.ctx;
    if (!ctx) return;
    const up = intensity > this.intensity;
    this.intensity += (intensity - this.intensity) * (1 - Math.exp(-dt / (up ? 1.2 : 7)));
    this.boss += (boss - this.boss) * (1 - Math.exp(-dt / (boss > this.boss ? 1.5 : 5)));
    const files = audio.bank.files(SOUND['music.explore']).length > 0;
    if (files) return this.updateStems();
    this.score(ctx);
  }

  private updateStems(): void {
    if (!this.stems) this.stems = [new LoopBed('music.explore'), new LoopBed('music.battle'), new LoopBed('music.boss')];
    this.stems[0].set(1 - 0.3 * this.intensity, 2);
    this.stems[1].set(Math.max(0.002, this.intensity), 1.5);
    this.stems[2].set(Math.max(0.002, this.boss), 2);
  }

  /** One note of an instrument, rendered once and kept. */
  private note(inst: Inst, m: number): AudioBuffer {
    const key = `${inst}:${m}`;
    let b = this.notes.get(key);
    if (b) return b;
    const r = rng(m * 131 + inst.length * 977);
    const len = inst === 'flute' ? 1.8 : inst === 'bass' ? 2.5 : inst.startsWith('drum') ? 0.8 : inst === 'shaker' ? 0.15 : 3;
    const x = new Float32Array(Math.ceil(SR * len));
    const f = hz(m);
    if (inst === 'harp') string(x, r, 0, f, 0.5, 0.996, 0.35);
    else if (inst === 'pizz') string(x, r, 0, f, 0.6, 0.985, 0.7);
    else if (inst === 'bass') string(x, r, 0, f, 0.7, 0.997, 0.25);
    else if (inst === 'kalimba') kalimba(x, r, 0, f, 0.5);
    else if (inst === 'flute') flute(x, r, 0, f, 1.6, 0.4);
    else if (inst === 'drumLow') handDrum(x, r, 0, 75, 0.7, 0.15);
    else if (inst === 'drumHigh') handDrum(x, r, 0, 190, 0.45, 0.6);
    else if (inst === 'drumBig') handDrum(x, r, 0, 48, 0.9, 0.1);
    else shaker(x, r, 0.002, 0.4, 0.07);
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    if (peak > 0) for (let i = 0; i < x.length; i++) x[i] *= 0.8 / peak;
    b = audio.ctx!.createBuffer(1, x.length, SR);
    b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
    this.notes.set(key, b);
    return b;
  }

  private play(inst: Inst, m: number, at: number, gain: number, pan = 0): void {
    playBuffer(this.note(inst, m), 'music', gain * SOUND['music.explore'].gain, at, pan);
  }

  /** Schedule the next eighth notes, 200 ms ahead. */
  private score(ctx: BaseAudioContext): void {
    const t = ctx.currentTime;
    if (this.next < t - 0.4) this.next = t + 0.1;
    const I = this.intensity;
    const B = this.boss;
    const r = this.r;
    while (this.next < t + 0.2) {
      const at = this.next;
      const i = this.step;
      const bar = Math.floor(i / 8);
      const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
      const beat = i % 8;
      // calm: a harp arpeggio rising through the chord, a bass on the bar, now and then the kalimba or flute
      const calm = 1 - 0.35 * I;
      if (beat % 2 === 0 || r() < 0.25) this.play('harp', chord.tones[(beat / 2 + bar) % chord.tones.length | 0], at, 0.22 * calm * (0.75 + 0.25 * r()), -0.3 + 0.6 * r());
      if (beat === 0) this.play('bass', chord.root + (bar % 2 ? 12 : 0), at, 0.3 * calm);
      if (beat === 3 && r() < 0.35 - 0.2 * I) this.play('kalimba', MELODY[Math.floor(r() * MELODY.length)] + 12, at, 0.16, 0.4 * (r() - 0.5));
      if (beat === 0 && bar % 4 === 1 && r() < 0.5 - 0.4 * I) {
        let m = MELODY[Math.floor(r() * 5)];
        for (let k = 0; k < 3; k++) {
          this.play('flute', m, at + k * EIGHTH * 3, 0.13);
          m = MELODY[Math.max(0, Math.min(MELODY.length - 1, MELODY.indexOf(m) + (r() < 0.5 ? -1 : 1)))];
        }
      }
      // fighting: frame drums, a shaker and a pizzicato ostinato
      if (I > 0.08) {
        if (beat === 0 || beat === 4 || (I > 0.5 && beat === 6)) this.play('drumLow', 0, at, 0.5 * I);
        if (beat === 2 || beat === 6 || (I > 0.6 && beat === 7)) this.play('drumHigh', 0, at, 0.35 * I, 0.2);
        if (I > 0.3) this.play('shaker', 0, at, (beat % 2 ? 0.16 : 0.1) * I, -0.2);
        if (I > 0.25) this.play('pizz', chord.tones[[0, 2, 1, 2][beat % 4]] - (beat % 4 === 0 ? 12 : 0), at, 0.22 * I);
      }
      // a boss: big low drums and tremolo strings on the root
      if (B > 0.1) {
        if (beat === 0 || (beat === 5 && bar % 2 === 1)) this.play('drumBig', 0, at, 0.6 * B);
        if (beat >= 6 && bar % 2 === 1) this.play('drumLow', 0, at + EIGHTH / 2, 0.35 * B);
        this.play('pizz', chord.root + 12, at, 0.12 * B);
        this.play('pizz', chord.root + 12, at + EIGHTH / 2, 0.1 * B);
      }
      this.next += EIGHTH * (beat % 2 === 0 ? 1.03 : 0.97); // a little swing: played, not sequenced
      this.step++;
    }
  }

  /** for tests */
  get state(): { intensity: number; boss: number; bar: number } {
    return { intensity: this.intensity, boss: this.boss, bar: Math.floor(this.step / 8) };
  }
}

export { BAR };
