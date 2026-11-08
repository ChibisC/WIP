import { Rand, biquad, buf, burst, dcBlock, envelope, grains, mix, modal, noise, normalize, pluck } from './dsp';

/**
 * The music's acoustic instruments, from physical models (the procedural score in music.ts plays them), and the
 * three musical sounds still made in the game: the victory and defeat stingers and the narration cue. Every sound
 * effect is a file (catalog.ts, tools/audio/sfx).
 */
export const SR = 44100;
const at = (s: number) => Math.floor(s * SR);

/** A kalimba tine: a plucked metal tongue on a wooden box (strongly inharmonic overtones). */
export function kalimba(o: Float32Array, r: Rand, t: number, f: number, amp: number): void {
  modal(o, SR, at(t), amp, [f, f * 2.02, f * 5.4, f * 9.1], [0.9, 0.35, 0.08, 0.03], [1, 0.12, 0.08, 0.03]);
  const b = buf(SR, 0.01);
  noise(b, r);
  biquad(b, SR, 'bp', 2500, 1);
  mix(o, envelope(b, SR, 0.0005, 0.006), at(t), amp * 0.15);
}

/** A hand drum (frame drum / djembe-like): a membrane's inharmonic modes and a slap. */
export function handDrum(o: Float32Array, r: Rand, t: number, f: number, amp: number, slap = 0.3): void {
  const n = at(0.6);
  const modes = [1, 1.59, 2.14, 2.3, 2.65];
  for (let m = 0; m < modes.length; m++) {
    let ph = 0;
    for (let i = 0; i < n && at(t) + i < o.length; i++) {
      const tt = i / SR;
      const fr = f * modes[m] * (1 + 0.15 * Math.exp(-tt / 0.02));
      ph += (2 * Math.PI * fr) / SR;
      o[at(t) + i] += Math.sin(ph) * Math.exp(-tt / (0.18 / (m + 1))) * amp * (m === 0 ? 1 : 0.35 / m);
    }
  }
  const b = buf(SR, 0.03);
  burst(b, SR, r, 0, 1, 0.0005, 0.006);
  biquad(b, SR, 'bp', 1800, 0.8);
  mix(o, b, at(t), amp * slap);
}

/** A shaker: seeds in a gourd, one stroke. */
export function shaker(o: Float32Array, r: Rand, t: number, amp: number, dur = 0.08): void {
  grains(o, SR, r, at(t), { count: 40, spread: dur, amp, fLo: 3500, fHi: 9000, ring: 0.0006, shape: (u) => Math.pow(u, 0.7) });
}

/** A wooden flute note: a breathy tone with a gentle vibrato that settles in. */
export function flute(o: Float32Array, r: Rand, t: number, f: number, dur: number, amp: number): void {
  const n = Math.min(at(dur), o.length - at(t));
  let ph = 0;
  const breath = buf(SR, dur);
  noise(breath, r);
  biquad(breath, SR, 'bp', f * 2, 3);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const vib = 1 + 0.006 * Math.min(1, tt / 0.4) * Math.sin(2 * Math.PI * 5.2 * tt);
    ph += (2 * Math.PI * f * vib) / SR;
    const e = Math.min(1, tt / 0.08) * Math.min(1, (dur - tt) / 0.25);
    o[at(t) + i] += (Math.sin(ph) + 0.18 * Math.sin(2 * ph) + 0.06 * Math.sin(3 * ph)) * e * amp + breath[i] * e * amp * 0.25;
  }
}

/** A plucked string (harp / guitar / pizzicato). */
export function string(o: Float32Array, r: Rand, t: number, f: number, amp: number, decay = 0.996, bright = 0.5): void {
  pluck(o, SR, r, at(t), f, amp, decay, bright);
}

/** Finish a take: no DC, peak-normalised, the silent tail cut off with a 5 ms fade. */
function out(o: Float32Array, peak = 0.9): Float32Array {
  const x = normalize(dcBlock(o), peak);
  const floor = peak * 0.0005;
  let end = x.length;
  while (end > 1 && Math.abs(x[end - 1]) < floor) end--;
  end = Math.min(x.length, end + Math.floor(SR * 0.005));
  const y = x.slice(0, end);
  const f = Math.min(y.length, Math.floor(SR * 0.005));
  for (let i = 0; i < f; i++) y[y.length - 1 - i] *= i / f;
  return y;
}

/** The musical sounds made in the game (catalog `recipe`): one take per call. */
export const MUSIC_RECIPES: Record<string, (r: Rand) => Float32Array> = {
  // the narration cue: two soft kalimba notes
  narrator_cue: (r) => {
    const o = buf(SR, 2);
    kalimba(o, r, 0.002, 293.7, 0.6);
    kalimba(o, r, 0.12, 440, 0.45);
    return out(o, 0.7);
  },
  // the stingers: plucked strings and a hand drum
  victory: (r) => {
    const o = buf(SR, 4);
    const notes = [146.8, 220, 293.7, 370, 440, 587.3];
    notes.forEach((f, i) => string(o, r, 0.02 + i * 0.12, f, 0.5, 0.9985, 0.6));
    handDrum(o, r, 0.02, 90, 0.6);
    handDrum(o, r, 0.62, 110, 0.5);
    kalimba(o, r, 0.74, 587.3, 0.3);
    return out(o, 0.8);
  },
  defeat: (r) => {
    const o = buf(SR, 5);
    const notes = [440, 349.2, 293.7, 220, 146.8];
    notes.forEach((f, i) => string(o, r, 0.02 + i * 0.42, f, 0.45, 0.998, 0.35));
    handDrum(o, r, 1.7, 70, 0.5, 0.1);
    return out(o, 0.75);
  },
};
