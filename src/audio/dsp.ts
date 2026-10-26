/**
 * Sample-level DSP for the organic stand-in sounds (Phase 14 audio).
 *
 * Plain math on Float32Arrays, with no Web Audio, so the same code renders
 * takes in the browser and in Node (tools/audio/render-standins.ts, for
 * listening and measuring). The building blocks follow how these sounds
 * are made in nature:
 * - **grains**: a crackle is a stream of tiny impulses (soil grains, dry leaf
 *   fibres breaking), each ringing a short resonance;
 * - **modal resonators**: a struck hard body (chitin, a twig, a seed coat)
 *   rings at a few inharmonic modes that die fast;
 * - **bubbles**: wet sounds are mostly small bubbles. A bubble rings like
 *   a sine whose pitch rises as it closes (Minnaert resonance);
 * - **pulse trains**: stridulation is a scraper crossing the ridges of a
 *   file, one tick per ridge;
 * - **filtered noise**: air (wind, a fast strike), sprays and hiss.
 * Nothing here is a raw oscillator heard as a tone, except the naturally
 * tonal calls (birds, crickets) and the acoustic instruments of the music.
 */

export type Rand = () => number;

/** A small seeded generator (mulberry32), so a take is reproducible from its seed. */
export function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (r: Rand, a: number, b: number) => a + r() * (b - a);

export function buf(sr: number, seconds: number): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

// ---------------------------------------------------------------- filters

/** RBJ biquad, run in place over `x` (coefficients fixed). */
export function biquad(x: Float32Array, sr: number, type: 'lp' | 'hp' | 'bp' | 'peak', f: number, q = 0.707, gainDb = 0): Float32Array {
  const w0 = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'lp') {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = (1 - cw) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cw;
    a2 = 1 - alpha;
  } else if (type === 'hp') {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = (1 + cw) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cw;
    a2 = 1 - alpha;
  } else if (type === 'bp') {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cw;
    a2 = 1 - alpha;
  } else {
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * A;
    b1 = -2 * cw;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cw;
    a2 = 1 - alpha / A;
  }
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  a1 /= a0;
  a2 /= a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

/** One-pole lowpass whose cutoff follows `f(t)` (t in 0..1 over the buffer). */
export function sweepLp(x: Float32Array, sr: number, f: (t: number) => number): Float32Array {
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    const a = 1 - Math.exp((-2 * Math.PI * f(i / x.length)) / sr);
    y += a * (x[i] - y);
    x[i] = y;
  }
  return x;
}

/** A state-variable bandpass whose centre follows `f(t)`. */
export function sweepBp(x: Float32Array, sr: number, f: (t: number) => number, q = 2): Float32Array {
  let low = 0,
    band = 0;
  const damp = 1 / q;
  for (let i = 0; i < x.length; i++) {
    const fc = 2 * Math.sin((Math.PI * Math.min(f(i / x.length), sr * 0.22)) / sr);
    low += fc * band;
    const high = x[i] - low - damp * band;
    band += fc * high;
    x[i] = band;
  }
  return x;
}

// ---------------------------------------------------------------- sources

export function noise(out: Float32Array, r: Rand, amp = 1): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] += (r() * 2 - 1) * amp;
  return out;
}

/** Brown noise (integrated white), for rumble and wind. */
export function brown(out: Float32Array, r: Rand, amp = 1): Float32Array {
  let v = 0;
  for (let i = 0; i < out.length; i++) {
    v = (v + 0.02 * (r() * 2 - 1)) / 1.02;
    out[i] += v * 3.5 * amp;
  }
  return out;
}

/** A struck body: sum of decaying sines at `modes` (Hz) with `decays` (s). Added at sample `at`. */
export function modal(out: Float32Array, sr: number, at: number, amp: number, modes: number[], decays: number[], gains?: number[]): void {
  const longest = Math.max(...decays);
  const n = Math.min(out.length - at, Math.ceil(longest * 6 * sr));
  for (let m = 0; m < modes.length; m++) {
    const w = (2 * Math.PI * modes[m]) / sr;
    const d = Math.exp(-1 / (decays[m] * sr));
    const g = amp * (gains ? gains[m] : 1);
    let e = g;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      out[at + i] += Math.sin(ph) * e;
      ph += w;
      e *= d;
      if (e < 1e-5) break;
    }
  }
}

/**
 * One bubble (the source of most liquid sound): a sine at the bubble's
 * Minnaert frequency, rising a little as the bubble closes, with a fast decay.
 * `rise` is the relative pitch rise per decay time, scaled to the physical
 * range (about 10 % per decay; van den Doel 2005), so a bubble "plinks", never "zips".
 */
export function bubble(out: Float32Array, sr: number, at: number, amp: number, f0: number, decay: number, rise = 0.6): void {
  const k = Math.min(0.25, rise * 0.12);
  const n = Math.min(out.length - at, Math.ceil(decay * 3.5 * sr));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0 * (1 + k * (t / decay));
    ph += (2 * Math.PI * f) / sr;
    const tail = Math.min(1, (n - i) / (sr * decay * 0.5));
    const e = Math.exp(-t / decay) * tail;
    // soft onset so the bubble does not click
    const on = Math.min(1, i / (sr * 0.0006));
    out[at + i] += Math.sin(ph) * e * amp * on;
  }
}

/** A short burst of noise with an attack/decay envelope, added at `at`. */
export function burst(out: Float32Array, sr: number, r: Rand, at: number, amp: number, attack: number, decay: number): void {
  const na = Math.ceil(attack * sr);
  const n = Math.min(out.length - at, na + Math.ceil(decay * 6 * sr));
  for (let i = 0; i < n; i++) {
    const e = i < na ? i / na : Math.exp(-(i - na) / (decay * sr));
    out[at + i] += (r() * 2 - 1) * e * amp;
  }
}

/**
 * A crackle: `count` grains spread over `spread` seconds from `at`, each a
 * tiny click ringing a random resonance between `fLo` and `fHi`. With
 * `fLo`–`fHi` around 1–6 kHz it is dry leaves or soil; lower and longer,
 * twigs and bark.
 */
export function grains(out: Float32Array, sr: number, r: Rand, at: number, opts: { count: number; spread: number; amp: number; fLo: number; fHi: number; ring?: number; shape?: (t: number) => number }): void {
  const ring = opts.ring ?? 0.0025;
  for (let k = 0; k < opts.count; k++) {
    const u = r();
    const t = opts.shape ? opts.shape(u) : u;
    const pos = at + Math.floor(t * opts.spread * sr);
    if (pos >= out.length) continue;
    const a = opts.amp * (0.25 + 0.75 * r() * r()) * (r() < 0.5 ? -1 : 1);
    const f = opts.fLo * Math.pow(opts.fHi / opts.fLo, r());
    modal(out, sr, pos, a, [f, f * range(r, 1.4, 2.3)], [ring * range(r, 0.6, 1.4), ring * 0.5], [1, 0.4]);
    // the impulse itself (the fibre snapping)
    out[pos] += a * 0.6;
  }
}

/**
 * Stridulation: a scraper drawn across a file of ridges. `rate` ticks per
 * second for `dur`, each tick ringing the body at `f` Hz; `amp(t)` shapes the
 * stroke (louder mid-stroke).
 */
export function stridulate(out: Float32Array, sr: number, r: Rand, at: number, opts: { rate: number; dur: number; f: number; amp: number; jitter?: number; ring?: number; amp2?: (t: number) => number }): void {
  const n = Math.floor(opts.rate * opts.dur);
  const ring = opts.ring ?? 0.0012;
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const pos = at + Math.floor(((k + (r() - 0.5) * (opts.jitter ?? 0.3)) / opts.rate) * sr);
    if (pos < 0 || pos >= out.length) continue;
    const env = opts.amp2 ? opts.amp2(t) : Math.sin(Math.PI * t) ** 0.6;
    const f = opts.f * range(r, 0.94, 1.06);
    modal(out, sr, pos, opts.amp * env * range(r, 0.6, 1), [f, f * 1.9, f * 3.1], [ring, ring * 0.6, ring * 0.35], [1, 0.45, 0.2]);
  }
}

/** A Karplus-Strong plucked string (the music's guitar/harp/pizzicato). */
export function pluck(out: Float32Array, sr: number, r: Rand, at: number, f: number, amp: number, decay = 0.996, bright = 0.5): void {
  const N = Math.max(2, Math.round(sr / f));
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = r() * 2 - 1;
  // soften the excitation: less bright = rounder
  for (let p = 0; p < 3 - Math.round(bright * 2); p++) for (let i = 1; i < N; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
  let idx = 0;
  const n = out.length - at;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v = line[idx];
    out[at + i] += v * amp;
    const nv = decay * (0.5 * (v + prev));
    prev = v;
    line[idx] = nv;
    idx = (idx + 1) % N;
    if (i > sr * 0.5 && Math.abs(v) < 1e-4) break;
  }
}

// ---------------------------------------------------------------- shaping

/** Multiply by an attack/decay envelope over the buffer. */
export function envelope(x: Float32Array, sr: number, attack: number, release: number): Float32Array {
  const na = Math.max(1, Math.floor(attack * sr));
  const nr = Math.max(1, Math.floor(release * sr));
  for (let i = 0; i < x.length; i++) {
    let e = 1;
    if (i < na) e = i / na;
    const left = x.length - 1 - i;
    if (left < nr) e *= left / nr;
    x[i] *= e;
  }
  return x;
}

/** Scale so the peak is `peak` (0 dBFS = 1). */
export function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

/** Soft saturation (tape-like), for weight without hard clipping. */
export function soft(x: Float32Array, drive = 1.5): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / k;
  return x;
}

/** Remove DC (so long tails do not thump). */
export function dcBlock(x: Float32Array): Float32Array {
  let px = 0,
    py = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] - px + 0.995 * py;
    px = x[i];
    py = y;
    x[i] = y;
  }
  return x;
}

/** Make a loop seamless: crossfade the last `fade` seconds into the start (equal power) and drop them. */
export function seamless(x: Float32Array, sr: number, fade: number): Float32Array {
  const n = Math.min(Math.floor(fade * sr), Math.floor(x.length / 3));
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = out[i] * Math.sin((t * Math.PI) / 2) + x[x.length - n + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

/** Add `src` into `dst` at sample `at` with gain. */
export function mix(dst: Float32Array, src: Float32Array, at = 0, g = 1): void {
  const n = Math.min(src.length, dst.length - at);
  for (let i = 0; i < n; i++) dst[at + i] += src[i] * g;
}

/** Resample by a pitch factor (>1 higher and shorter), linear interpolation. */
export function repitch(x: Float32Array, k: number): Float32Array {
  const n = Math.max(1, Math.floor(x.length / k));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * k;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? 0) * f;
  }
  return out;
}

/** Downsample by `k` (2 or 4) after a lowpass: for stand-ins with no high content (rumbles, thunder), a quarter of the memory. */
export function decimate(x: Float32Array, sr: number, k: number): Float32Array {
  if (k <= 1) return x;
  const y = x.slice();
  biquad(y, sr, 'lp', (sr / k) * 0.42, 0.707);
  biquad(y, sr, 'lp', (sr / k) * 0.42, 0.707);
  const out = new Float32Array(Math.floor(y.length / k));
  for (let i = 0; i < out.length; i++) out[i] = y[i * k];
  return out;
}
