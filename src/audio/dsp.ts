/**
 * Sample-level DSP for the music's instruments (instruments.ts): plain math on Float32Arrays, no Web Audio.
 * The sound effects are rendered offline instead (tools/audio/sfx, Python), with the same building blocks:
 * modal resonators, grains, plucked strings, filtered noise.
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

// ---------------------------------------------------------------- sources

export function noise(out: Float32Array, r: Rand, amp = 1): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] += (r() * 2 - 1) * amp;
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

/** Add `src` into `dst` at sample `at` with gain. */
export function mix(dst: Float32Array, src: Float32Array, at = 0, g = 1): void {
  const n = Math.min(src.length, dst.length - at);
  for (let i = 0; i < n; i++) dst[at + i] += src[i] * g;
}
