import { Rand, biquad, bubble, brown, buf, burst, dcBlock, envelope, grains, mix, modal, noise, normalize, pluck, range, seamless, soft, stridulate, sweepBp, sweepLp } from './dsp';

/**
 * Organic stand-ins: one recipe per sound in the catalog, used until a real
 * recording is dropped into that sound's file slot. Each call renders one
 * take; different seeds give different takes, the way several recordings of
 * the same action differ. The comments say what physical event each one models.
 *
 * Recipes return mono samples at SR (44.1 kHz); peaks are normalised and the
 * catalog's gain sets the level in the mix.
 */
export const SR = 44100;

type Recipe = (r: Rand) => Float32Array;
const at = (s: number) => Math.floor(s * SR);

// ---------------------------------------------------------------- shared pieces

/** A tarsus tick: the tip of an ant's leg meeting a surface. */
function tick(o: Float32Array, r: Rand, t: number, amp: number, fLo: number, fHi: number, ring = 0.0012): void {
  grains(o, SR, r, at(t), { count: 1 + Math.floor(r() * 2), spread: 0.002, amp, fLo, fHi, ring });
}

/** One tripod of legs landing: three ticks within a few milliseconds. */
function tripod(o: Float32Array, r: Rand, amp: number, fLo: number, fHi: number, ring?: number): void {
  for (let k = 0; k < 3; k++) tick(o, r, 0.003 + k * range(r, 0.002, 0.006), amp * range(r, 0.5, 1), fLo, fHi, ring);
}

/** A soft padded footfall: a pad pressing the ground (lowpassed thump) with a brush of hairs. */
function pad(o: Float32Array, r: Rand, t: number, amp: number, cut: number, decay = 0.022): void {
  const b = buf(SR, decay * 7);
  burst(b, SR, r, 0, 1, 0.003, decay);
  biquad(b, SR, 'lp', cut, 0.7);
  biquad(b, SR, 'lp', cut * 1.3, 0.7);
  mix(o, b, at(t), amp);
  const h = buf(SR, 0.03);
  burst(h, SR, r, 0, 1, 0.004, 0.008);
  biquad(h, SR, 'hp', 5000);
  mix(o, h, at(t), amp * 0.06);
}

/**
 * A thud: a heavy body or object meeting soil. Mostly lowpassed noise (the
 * soil and body moving), with only a brief, rough low mode for weight: a
 * clean low sine would sound like a drum machine.
 */
function thud(o: Float32Array, r: Rand, t: number, amp: number, f: number, decay: number): void {
  const b = buf(SR, decay * 6 + 0.02);
  burst(b, SR, r, 0, 1, 0.002, decay * 0.45);
  biquad(b, SR, 'lp', f * 4, 0.8);
  mix(o, b, at(t), amp * 0.8);
  const body = buf(SR, decay * 6 + 0.02);
  burst(body, SR, r, 0, 1, 0.003, decay);
  biquad(body, SR, 'lp', f * 1.6, 1.2);
  biquad(body, SR, 'lp', f * 2, 0.7);
  mix(o, normalize(body, 1), at(t), amp * 0.7);
  const short = Math.min(decay, 0.035);
  modal(o, SR, at(t), amp * 0.25, [f * range(r, 0.95, 1.05), f * range(r, 1.4, 1.7)], [short, short * 0.5]);
}

/** A knock on wood or packed earth: an impact and a few short, slightly detuned modes. */
function knock(o: Float32Array, r: Rand, t: number, amp: number, f: number, decay = 0.012): void {
  const d = Math.min(decay, 0.018);
  modal(o, SR, at(t), amp, [f * range(r, 0.96, 1.04), f * range(r, 2.5, 2.8), f * range(r, 4.1, 4.6), f * range(r, 6.5, 7.5)], [d, d * 0.55, d * 0.35, d * 0.2], [1, 0.6, 0.35, 0.2]);
  const b = buf(SR, 0.012);
  noise(b, r);
  biquad(b, SR, 'bp', f * 3, 0.7);
  mix(o, envelope(b, SR, 0.0003, 0.008), at(t), amp * 0.8);
}

/**
 * Friction: something dragged. Noise through a slowly wandering band, gated
 * by irregular stick-slip catches: rough and uneven, never a steady buzz.
 */
function scrape(o: Float32Array, r: Rand, t: number, amp: number, dur: number, fLo: number, fHi: number, catches: number): void {
  const b = buf(SR, dur);
  noise(b, r);
  const f0 = range(r, fLo, fHi);
  const f1 = range(r, fLo, fHi);
  sweepBp(b, SR, (u) => f0 + (f1 - f0) * u + Math.sin(u * 17 + f0) * (fHi - fLo) * 0.15, 1.6);
  // stick-slip: random catches that each release a short burst
  const env = new Float32Array(b.length);
  let pos = 0;
  while (pos < env.length) {
    const len = Math.floor(SR * range(r, 0.004, 0.02));
    const a = range(r, 0.3, 1);
    for (let i = 0; i < len && pos + i < env.length; i++) env[pos + i] = Math.max(env[pos + i], a * Math.exp(-i / (len * 0.35)));
    pos += Math.floor(SR / catches * range(r, 0.3, 1.7));
  }
  for (let i = 0; i < b.length; i++) b[i] *= (0.25 + 0.75 * env[i]) * Math.sin((Math.PI * i) / b.length) ** 0.5;
  biquad(b, SR, 'lp', fHi * 1.4, 0.7);
  biquad(b, SR, 'hp', fLo * 0.6, 0.7);
  mix(o, normalize(b, 1), at(t), amp);
}

/** A hard chitin click: a stiff plate struck. Several inharmonic modes that die within a few milliseconds, and a sharp transient. */
function chitin(o: Float32Array, r: Rand, t: number, amp: number, f: number, ring = 0.005): void {
  const d = ring * 0.45;
  modal(o, SR, at(t), amp, [f, f * range(r, 1.5, 1.8), f * range(r, 2.3, 2.7), f * range(r, 3.2, 3.8), f * range(r, 4.6, 5.4)], [d, d * 0.7, d * 0.5, d * 0.35, d * 0.25], [1, 0.75, 0.55, 0.35, 0.2]);
  const b = buf(SR, 0.005);
  noise(b, r);
  biquad(b, SR, 'hp', 2500);
  mix(o, envelope(b, SR, 0.0002, 0.004), at(t), amp * 0.7);
}

/** A wet squelch: a few bubbles and a dull smack (hemolymph, a soft body). */
function squelch(o: Float32Array, r: Rand, t: number, amp: number, fLo = 500, fHi = 1800, n = 4, long = 1): void {
  for (let k = 0; k < n; k++) bubble(o, SR, at(t + range(r, 0, 0.03)), amp * range(r, 0.3, 0.8), range(r, fLo, fHi), range(r, 0.003, 0.01) * long, range(r, 0.3, 1.2));
  const b = buf(SR, 0.06);
  burst(b, SR, r, 0, 1, 0.002, 0.012);
  biquad(b, SR, 'lp', 1200);
  mix(o, b, at(t), amp * 0.4);
}

/** Air moved fast past something: a bandpass sweep of noise (a strike, a toss). */
function swish(o: Float32Array, r: Rand, t: number, amp: number, dur: number, f0: number, f1: number): void {
  const b = buf(SR, dur);
  noise(b, r);
  sweepBp(b, SR, (u) => f0 * Math.pow(f1 / f0, u), 2.5);
  for (let i = 0; i < b.length; i++) b[i] *= Math.sin((Math.PI * i) / b.length) ** 1.5;
  mix(o, b, at(t), amp);
}

/** Stick-slip friction: a pulse train whose rate wanders, ringing a body (a creak, a scrape). */
function creak(o: Float32Array, r: Rand, t: number, amp: number, dur: number, rate0: number, rate1: number, body: number[]): void {
  let s = 0;
  while (s < dur) {
    const u = s / dur;
    const rate = rate0 + (rate1 - rate0) * u + range(r, -0.35, 0.35) * rate0;
    const e = Math.sin(Math.PI * u) ** 0.7;
    modal(o, SR, at(t + s), amp * e * range(r, 0.4, 1), body.map((f) => f * range(r, 0.92, 1.08)), body.map((_, i) => 0.0025 / (i + 1)));
    const nb = buf(SR, 0.004);
    noise(nb, r);
    mix(o, envelope(nb, SR, 0.0002, 0.003), at(t + s), amp * e * 0.3);
    s += 1 / Math.max(5, rate);
  }
}

/** Grains of soil or sand falling and bouncing: dense at first, then thinning. */
function trickle(o: Float32Array, r: Rand, t: number, amp: number, dur: number, count: number, fLo = 2000, fHi = 7000): void {
  grains(o, SR, r, at(t), { count, spread: dur, amp, fLo, fHi, ring: 0.0015, shape: (u) => Math.pow(u, 1.7) });
}

/** Finish a take: no DC, peak-normalised, and the silent tail cut off (below −66 dB of the peak). */
function out(o: Float32Array, peak = 0.9): Float32Array {
  const x = normalize(dcBlock(o), peak);
  const floor = peak * 0.0005;
  let end = x.length;
  while (end > 1 && Math.abs(x[end - 1]) < floor) end--;
  end = Math.min(x.length, end + Math.floor(SR * 0.005));
  const y = x.slice(0, end);
  // a 5 ms fade so the cut never clicks
  const f = Math.min(y.length, Math.floor(SR * 0.005));
  for (let i = 0; i < f; i++) y[y.length - 1 - i] *= i / f;
  return y;
}

/** A seamless loop of `seconds`, built by `fill`. */
function loop(seconds: number, fill: (o: Float32Array) => void, fade = 0.6): Float32Array {
  const o = buf(SR, seconds + fade);
  fill(o);
  return normalize(seamless(dcBlock(o), SR, fade), 0.8);
}

// ---------------------------------------------------------------- recipes

export const RECIPES: Record<string, Recipe> = {
  // ---- ant footsteps, by ground
  step_soil: (r) => {
    const o = buf(SR, 0.04);
    tripod(o, r, 1, 2200, 6500, 0.0012);
    return out(o);
  },
  step_leaf: (r) => {
    const o = buf(SR, 0.05);
    tripod(o, r, 1, 3000, 9000, 0.0009);
    grains(o, SR, r, at(0.004), { count: 3 + Math.floor(r() * 3), spread: 0.02, amp: 0.4, fLo: 4000, fHi: 10000, ring: 0.0006 });
    return out(o);
  },
  step_bark: (r) => {
    const o = buf(SR, 0.05);
    tripod(o, r, 1, 1300, 3200, 0.003);
    return out(o);
  },
  step_stone: (r) => {
    const o = buf(SR, 0.04);
    tripod(o, r, 1, 5000, 11000, 0.0007);
    return out(o);
  },
  step_sand: (r) => {
    const o = buf(SR, 0.05);
    grains(o, SR, r, at(0.002), { count: 8 + Math.floor(r() * 6), spread: 0.02, amp: 0.5, fLo: 5000, fHi: 12000, ring: 0.0004 });
    biquad(o, SR, 'hp', 3000);
    return out(o);
  },
  step_carton: (r) => {
    const o = buf(SR, 0.05);
    tripod(o, r, 1, 1500, 4000, 0.0018);
    biquad(o, SR, 'lp', 5000);
    return out(o);
  },
  step_queen: (r) => {
    const o = buf(SR, 0.12);
    pad(o, r, 0.002, 0.7, 900, 0.02);
    tripod(o, r, 0.6, 1200, 3500, 0.002);
    return out(o);
  },
  /** hundreds of feet: a 4 s loop of tiny ticks on soil and litter */
  swarm_bed: () => {
    const r = rngFor('swarm');
    return loop(4, (o) => {
      grains(o, SR, r, 0, { count: 2600, spread: 4.6, amp: 0.25, fLo: 2200, fHi: 9000, ring: 0.0009 });
      biquad(o, SR, 'hp', 1500);
    });
  },

  // ---- communication
  stridulate: (r) => {
    // a scraper on the gaster crossing the file: a faint, fine rasp in a few strokes
    const o = buf(SR, 0.35);
    const strokes = 2 + Math.floor(r() * 3);
    for (let s = 0; s < strokes; s++) stridulate(o, SR, r, at(0.005 + s * range(r, 0.06, 0.09)), { rate: range(r, 500, 900), dur: range(r, 0.035, 0.06), f: range(r, 6500, 9000), amp: 0.6, ring: 0.0006 });
    return out(o);
  },
  antenna_tap: (r) => {
    const o = buf(SR, 0.08);
    chitin(o, r, 0.002, 0.5, range(r, 6000, 8500), 0.0015);
    chitin(o, r, range(r, 0.025, 0.04), 0.35, range(r, 6000, 8500), 0.0015);
    return out(o, 0.6);
  },

  // ---- digging and carrying
  dig_bite: (r) => {
    // mandibles shear off a pellet of soil: a short crunch over a dull crumble
    const o = buf(SR, 0.14);
    grains(o, SR, r, at(0.003), { count: 10 + Math.floor(r() * 10), spread: 0.04, amp: 0.7, fLo: 900, fHi: 4500, ring: 0.003 });
    const b = buf(SR, 0.1);
    brown(b, r);
    biquad(b, SR, 'lp', 700);
    mix(o, envelope(b, SR, 0.003, 0.08), at(0.004), 0.5);
    trickle(o, r, 0.04, 0.2, 0.08, 6);
    return out(o);
  },
  soil_grains: (r) => {
    const o = buf(SR, 0.7);
    trickle(o, r, 0.005, 0.5, range(r, 0.3, 0.6), 30 + Math.floor(r() * 40));
    return out(o, 0.7);
  },
  pellet_drop: (r) => {
    const o = buf(SR, 0.18);
    thud(o, r, 0.002, 0.6, range(r, 380, 650), 0.012);
    trickle(o, r, 0.008, 0.35, 0.1, 10, 2500, 7000);
    return out(o);
  },
  drag_small: (r) => {
    // a crumb dragged: stick-slip scraping of a light object over soil, with small bumps
    const o = buf(SR, 0.5);
    scrape(o, r, 0.01, 0.5, range(r, 0.3, 0.45), 2500, 5500, 60);
    grains(o, SR, r, at(0.02), { count: 18, spread: 0.4, amp: 0.25, fLo: 2500, fHi: 8000, ring: 0.001 });
    return out(o, 0.7);
  },
  drag_heavy: (r) => {
    const o = buf(SR, 0.8);
    scrape(o, r, 0.01, 0.6, range(r, 0.5, 0.7), 900, 2600, 35);
    for (let k = 0; k < 3; k++) thud(o, r, range(r, 0.05, 0.6), 0.25, range(r, 300, 500), 0.01);
    grains(o, SR, r, at(0.02), { count: 30, spread: 0.65, amp: 0.25, fLo: 1500, fHi: 6000, ring: 0.0015 });
    return out(o, 0.75);
  },
  food_cut: (r) => {
    // shearing soft food: a fibrous crunch with a little moisture
    const o = buf(SR, 0.16);
    grains(o, SR, r, at(0.003), { count: 6 + Math.floor(r() * 6), spread: 0.035, amp: 0.6, fLo: 1500, fHi: 5000, ring: 0.002 });
    squelch(o, r, 0.01, 0.35, 700, 2200, 3);
    return out(o);
  },
  seed_crack: (r) => {
    // a hard seed coat giving way under a major's jaws: a loud crack, then fragments
    const o = buf(SR, 0.2);
    const cracks = 1 + Math.floor(r() * 2);
    for (let k = 0; k < cracks; k++) {
      const t = 0.003 + k * range(r, 0.03, 0.06);
      modal(o, SR, at(t), 0.9, [range(r, 2200, 3600), range(r, 4200, 5600), range(r, 6500, 8000)], [0.004, 0.003, 0.002]);
      const b = buf(SR, 0.01);
      noise(b, r);
      biquad(b, SR, 'hp', 2500);
      mix(o, envelope(b, SR, 0.0002, 0.006), at(t), 0.7);
      grains(o, SR, r, at(t + 0.004), { count: 6, spread: 0.04, amp: 0.3, fLo: 3000, fHi: 8000, ring: 0.001 });
    }
    return out(o);
  },
  leaf_cut: (r) => {
    // a leafcutter scissoring a disc out of a leaf: rapid snips through the lamina, with crinkle;
    // leafcutters stridulate while they cut, which stiffens the mandible (real behaviour)
    const o = buf(SR, 0.45);
    const snips = 3 + Math.floor(r() * 3);
    for (let k = 0; k < snips; k++) {
      const t = 0.005 + k * range(r, 0.05, 0.08);
      swish(o, r, t, 0.35, 0.02, 3500, 7000);
      grains(o, SR, r, at(t), { count: 4, spread: 0.02, amp: 0.4, fLo: 3500, fHi: 9000, ring: 0.0008 });
    }
    stridulate(o, SR, r, at(0.01), { rate: 700, dur: 0.35, f: 7500, amp: 0.12, ring: 0.0005 });
    return out(o);
  },

  // ---- combat
  mandible_click: (r) => {
    const o = buf(SR, 0.04);
    chitin(o, r, 0.001, 0.9, range(r, 3000, 5200), range(r, 0.003, 0.006));
    return out(o);
  },
  mandible_snap: (r) => {
    const o = buf(SR, 0.08);
    chitin(o, r, 0.001, 1, range(r, 1800, 3000), range(r, 0.006, 0.01));
    chitin(o, r, 0.0015, 0.5, range(r, 4000, 6000), 0.003);
    thud(o, r, 0.002, 0.25, range(r, 300, 450), 0.008);
    return out(o);
  },
  chitin_crack: (r) => {
    const o = buf(SR, 0.1);
    grains(o, SR, r, at(0.002), { count: 5 + Math.floor(r() * 5), spread: 0.025, amp: 0.9, fLo: 1500, fHi: 5500, ring: 0.004 });
    return out(o);
  },
  grapple_scuffle: () => {
    const r = rngFor('scuffle');
    return loop(3, (o) => {
      // legs scrabbling, bodies rubbing, the odd click
      for (let k = 0; k < 40; k++) scrape(o, r, range(r, 0, 3.4), 0.2, range(r, 0.03, 0.09), 2500, 6000, 120);
      grains(o, SR, r, 0, { count: 500, spread: 3.5, amp: 0.25, fLo: 2000, fHi: 8000, ring: 0.001 });
      for (let k = 0; k < 18; k++) chitin(o, r, range(r, 0, 3.4), 0.4, range(r, 2500, 5000), 0.004);
    });
  },
  battle_bed: () => {
    const r = rngFor('battle');
    return loop(4, (o) => {
      grains(o, SR, r, 0, { count: 1500, spread: 4.5, amp: 0.3, fLo: 1800, fHi: 8500, ring: 0.0012 });
      for (let k = 0; k < 70; k++) chitin(o, r, range(r, 0, 4.4), range(r, 0.2, 0.6), range(r, 2000, 5500), range(r, 0.003, 0.007));
      for (let k = 0; k < 25; k++) grains(o, SR, r, at(range(r, 0, 4.4)), { count: 6, spread: 0.02, amp: 0.5, fLo: 1500, fHi: 5000, ring: 0.004 });
      for (let k = 0; k < 30; k++) scrape(o, r, range(r, 0, 4.4), 0.15, range(r, 0.04, 0.1), 2500, 6000, 120);
    });
  },
  acid_spray: (r) => {
    // formic acid forced through the acidopore: a fine, wet hiss of droplets
    const d = range(r, 0.22, 0.38);
    const o = buf(SR, d + 0.05);
    const b = buf(SR, d);
    noise(b, r);
    biquad(b, SR, 'hp', 3500);
    biquad(b, SR, 'peak', range(r, 6000, 8000), 1.2, 6);
    // droplet granularity: the hiss flutters
    let g = 1;
    for (let i = 0; i < b.length; i++) {
      if (i % 64 === 0) g = 0.5 + r() * 0.8;
      b[i] *= g;
    }
    envelope(b, SR, 0.008, d * 0.6);
    mix(o, b, 0, 0.6);
    for (let k = 0; k < 25; k++) bubble(o, SR, at(range(r, 0.01, d)), 0.12, range(r, 4000, 9000), 0.002, 0.5);
    return out(o, 0.8);
  },
  acid_splat: (r) => {
    const o = buf(SR, 0.5);
    const b = buf(SR, 0.08);
    burst(b, SR, r, 0, 1, 0.001, 0.015);
    biquad(b, SR, 'lp', 2200);
    mix(o, b, 0, 0.6);
    squelch(o, r, 0.002, 0.6, 800, 2500, 6);
    // a fizz of tiny bubbles as it soaks in
    for (let k = 0; k < 30; k++) bubble(o, SR, at(range(r, 0.03, 0.45)), 0.08 * range(r, 0.3, 1), range(r, 3000, 8000), 0.002, 0.4);
    return out(o, 0.8);
  },
  sting: (r) => {
    // the stinger punching through cuticle: a hard tick and a tiny wet give
    const o = buf(SR, 0.08);
    chitin(o, r, 0.001, 0.7, range(r, 5000, 7500), 0.0025);
    squelch(o, r, 0.004, 0.45, 1400, 3200, 2);
    return out(o);
  },
  sting_fire: (r) => {
    // fire ants: sharper and faster, often twice as the gaster pivots
    const o = buf(SR, 0.08);
    chitin(o, r, 0.001, 0.8, range(r, 7000, 9000), 0.0018);
    squelch(o, r, 0.003, 0.3, 2000, 4000, 1);
    if (r() < 0.6) chitin(o, r, range(r, 0.025, 0.04), 0.5, range(r, 7000, 9000), 0.0015);
    return out(o);
  },
  ant_death: (r) => {
    // a brittle crunch, then the body folding and the legs ticking as they curl
    const o = buf(SR, 0.35);
    grains(o, SR, r, at(0.002), { count: 8 + Math.floor(r() * 6), spread: 0.05, amp: 0.8, fLo: 1500, fHi: 5000, ring: 0.003 });
    pad(o, r, 0.06, 0.35, 700, 0.02);
    for (let k = 0; k < 5; k++) tick(o, r, range(r, 0.09, 0.32), 0.15, 3000, 7000);
    return out(o);
  },
  fling: (r) => {
    const o = buf(SR, 0.35);
    swish(o, r, 0, 0.5, 0.18, 500, 2200);
    thud(o, r, range(r, 0.17, 0.22), 0.6, range(r, 250, 400), 0.015);
    trickle(o, r, 0.2, 0.25, 0.1, 8);
    return out(o);
  },

  // ---- brood and queen
  egg_set: (r) => {
    const o = buf(SR, 0.12);
    squelch(o, r, 0.003, 0.5, 500, 1100, 2, 1.5);
    pad(o, r, 0.002, 0.2, 1200, 0.01);
    return out(o, 0.6);
  },
  larva_hatch: (r) => {
    // the pupal skin splitting: a soft, wet tear and the adult pushing free
    const o = buf(SR, 0.45);
    grains(o, SR, r, at(0.01), { count: 14, spread: 0.18, amp: 0.4, fLo: 800, fHi: 2500, ring: 0.004 });
    squelch(o, r, 0.02, 0.5, 400, 1300, 5);
    squelch(o, r, 0.22, 0.3, 500, 1500, 3);
    return out(o, 0.7);
  },
  queen_lay: (r) => {
    const o = buf(SR, 0.3);
    squelch(o, r, 0.01, 0.6, 350, 900, 4);
    pad(o, r, 0.002, 0.3, 600, 0.03);
    return out(o, 0.7);
  },

  // ---- creatures
  spider_step: (r) => {
    const o = buf(SR, 0.12);
    pad(o, r, 0.002, 1, range(r, 700, 1000), range(r, 0.015, 0.025));
    return out(o);
  },
  spider_pounce: (r) => {
    const o = buf(SR, 0.45);
    scrape(o, r, 0.0, 0.35, 0.08, 2500, 5000, 150);
    swish(o, r, 0.06, 0.6, 0.14, 400, 1800);
    pad(o, r, 0.19, 1, 800, 0.03);
    pad(o, r, 0.21, 0.6, 900, 0.02);
    grains(o, SR, r, at(0.2), { count: 12, spread: 0.08, amp: 0.3, fLo: 2000, fHi: 6000 });
    return out(o);
  },
  spider_fangs: (r) => {
    const o = buf(SR, 0.12);
    chitin(o, r, 0.002, 0.8, range(r, 2500, 3800), 0.004);
    chitin(o, r, range(r, 0.03, 0.05), 0.6, range(r, 2500, 3800), 0.004);
    squelch(o, r, 0.04, 0.3, 900, 2000, 2);
    return out(o);
  },
  beetle_step: (r) => {
    // armoured tarsi on hard ground: a dry clack
    const o = buf(SR, 0.06);
    chitin(o, r, 0.001, 0.8, range(r, 1600, 3200), range(r, 0.005, 0.009));
    tick(o, r, 0.003, 0.3, 3000, 7000);
    return out(o);
  },
  beetle_elytra: (r) => {
    // wing cases snapping open, then the membranous wings unfolding (papery crinkle)
    const o = buf(SR, 0.5);
    chitin(o, r, 0.002, 1, range(r, 1500, 2400), 0.008);
    chitin(o, r, 0.012, 0.8, range(r, 1500, 2400), 0.008);
    grains(o, SR, r, at(0.04), { count: 40, spread: 0.35, amp: 0.3, fLo: 2500, fHi: 8000, ring: 0.0007 });
    return out(o);
  },
  stag_clash: (r) => {
    // two great mandibles meeting: a heavy, ringing clack and a scrape
    const o = buf(SR, 0.35);
    knock(o, r, 0.002, 1, range(r, 800, 1200), 0.018);
    chitin(o, r, 0.003, 0.7, range(r, 2000, 2800), 0.008);
    const b = buf(SR, 0.01);
    noise(b, r);
    mix(o, envelope(b, SR, 0.0002, 0.008), at(0.002), 0.6);
    scrape(o, r, 0.04, 0.4, 0.22, 1200, 3200, 70);
    return out(o);
  },
  centipede_patter: (r) => {
    // dozens of legs landing in a wave down the body
    const o = buf(SR, 0.35);
    const n = 20 + Math.floor(r() * 12);
    for (let k = 0; k < n; k++) tick(o, r, 0.003 + (k / n) * 0.28, 0.6 * Math.sin((Math.PI * k) / n) + 0.15, 2000, 6000, 0.0015);
    return out(o);
  },
  mantis_sway: (r) => {
    const o = buf(SR, 0.7);
    grains(o, SR, r, at(0.02), { count: 18, spread: 0.6, amp: 0.25, fLo: 2500, fHi: 7000, ring: 0.0007, shape: (u) => u });
    swish(o, r, 0.05, 0.1, 0.5, 300, 700);
    return out(o, 0.5);
  },
  mantis_strike: (r) => {
    // the raptorial legs flick out and snap shut, then the grip crunches
    const o = buf(SR, 0.3);
    swish(o, r, 0, 0.7, 0.06, 700, 3500);
    chitin(o, r, 0.055, 1, range(r, 2200, 3200), 0.006);
    grains(o, SR, r, at(0.065), { count: 8, spread: 0.06, amp: 0.4, fLo: 1500, fHi: 5000, ring: 0.003 });
    return out(o);
  },
  pillbug_roll: (r) => {
    // armour plates closing one by one as it rolls up
    const o = buf(SR, 0.3);
    const n = 5 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) chitin(o, r, 0.003 + k * range(r, 0.02, 0.035), 0.7 - k * 0.06, 2200 - k * 120, 0.004);
    return out(o);
  },
  caterpillar_crawl: (r) => {
    const o = buf(SR, 0.4);
    for (let k = 0; k < 4; k++) squelch(o, r, 0.01 + k * 0.08, 0.3, 250, 700, 2);
    grains(o, SR, r, at(0.01), { count: 10, spread: 0.35, amp: 0.1, fLo: 1500, fHi: 4000 });
    return out(o, 0.6);
  },
  antlion_flick: (r) => {
    // an antlion larva flicking sand at prey with its head
    const o = buf(SR, 0.45);
    swish(o, r, 0, 0.25, 0.06, 1500, 4000);
    grains(o, SR, r, at(0.03), { count: 70, spread: 0.35, amp: 0.4, fLo: 4000, fHi: 11000, ring: 0.0005, shape: (u) => Math.pow(u, 1.3) });
    return out(o, 0.8);
  },
  creature_death: (r) => {
    const o = buf(SR, 0.6);
    grains(o, SR, r, at(0.003), { count: 14, spread: 0.08, amp: 0.8, fLo: 900, fHi: 3500, ring: 0.005 });
    thud(o, r, 0.08, 0.8, range(r, 120, 200), 0.05);
    trickle(o, r, 0.12, 0.2, 0.35, 15);
    return out(o);
  },

  // ---- bosses: the same physics, scaled up (heavier, slower, lower), never a roar
  footstep: (r) => {
    const o = buf(SR, 1.1);
    thud(o, r, 0.003, 1, range(r, 45, 65), 0.22);
    grains(o, SR, r, at(0.004), { count: 30, spread: 0.12, amp: 0.4, fLo: 600, fHi: 3000, ring: 0.004 });
    trickle(o, r, 0.08, 0.25, 0.8, 50, 1500, 6000);
    return out(soft(o, 1.4));
  },
  rumble: () => {
    const r = rngFor('rumble');
    return loop(6, (o) => {
      brown(o, r);
      biquad(o, SR, 'lp', 110, 0.8);
      biquad(o, SR, 'lp', 140, 0.6);
    });
  },
  slam: (r) => {
    const o = buf(SR, 2.2);
    thud(o, r, 0.003, 1, range(r, 38, 50), 0.4);
    const c = buf(SR, 0.03);
    noise(c, r);
    biquad(c, SR, 'hp', 1800);
    mix(o, envelope(c, SR, 0.0005, 0.02), at(0.003), 0.7);
    grains(o, SR, r, at(0.005), { count: 60, spread: 0.2, amp: 0.5, fLo: 500, fHi: 3000, ring: 0.005 });
    // the shower of soil coming down after
    trickle(o, r, 0.15, 0.35, 1.8, 160, 1200, 7000);
    return out(soft(o, 1.6));
  },
  windup: (r) => {
    // a heavy joint loading up: a slow creak that tightens, over a rising hiss of breath through spiracles
    const d = range(r, 0.7, 0.9);
    const o = buf(SR, d + 0.1);
    creak(o, r, 0, 0.7, d, 18, 45, [range(r, 350, 500), range(r, 800, 1000), 1700]);
    const h = buf(SR, d);
    noise(h, r);
    biquad(h, SR, 'bp', 2600, 0.8);
    for (let i = 0; i < h.length; i++) h[i] *= (i / h.length) ** 2;
    mix(o, h, 0, 0.25);
    return out(o);
  },
  phase: (r) => {
    // no roar: a big, rough stridulation and a hiss, like a beetle or a hissing cockroach, scaled up
    const o = buf(SR, 1.4);
    stridulate(o, SR, r, at(0.02), { rate: range(r, 70, 110), dur: 1.1, f: range(r, 700, 1100), amp: 0.9, ring: 0.0012, jitter: 0.6 });
    const h = buf(SR, 1.2);
    noise(h, r);
    biquad(h, SR, 'bp', range(r, 2200, 3200), 0.7);
    envelope(h, SR, 0.1, 0.6);
    mix(o, h, at(0.05), 0.6);
    thud(o, r, 0.01, 0.6, 50, 0.3);
    return out(soft(o, 2.2));
  },
  hairs: (r) => {
    // a tarantula brushing urticating hairs off its abdomen with its back legs: dry, quick strokes
    const o = buf(SR, 0.7);
    for (let s = 0; s < 3; s++) {
      const t = 0.01 + s * range(r, 0.16, 0.22);
      grains(o, SR, r, at(t), { count: 60, spread: 0.12, amp: 0.4, fLo: 4000, fHi: 10000, ring: 0.0004 });
      swish(o, r, t, 0.15, 0.12, 2500, 5000);
    }
    return out(o);
  },
  arrive: (r) => {
    const o = buf(SR, 3);
    for (let k = 0; k < 5; k++) thud(o, r, 0.2 + k * range(r, 0.42, 0.52), 0.35 + k * 0.12, range(r, 40, 55), 0.25);
    const b = buf(SR, 3);
    brown(b, r);
    biquad(b, SR, 'lp', 90);
    for (let i = 0; i < b.length; i++) b[i] *= Math.min(1, i / b.length / 0.6) * Math.min(1, (b.length - i) / (SR * 0.6));
    mix(o, b, 0, 0.6);
    return out(soft(o, 1.3));
  },

  // ---- interface: earthy taps and natural chirps
  marker: (r) => {
    // a single, clean cricket-like chirp; the engine pitches it per marker I–V
    const o = buf(SR, 0.12);
    stridulate(o, SR, r, at(0.003), { rate: 260, dur: 0.06, f: 3200, amp: 0.8, ring: 0.004, jitter: 0.05 });
    return out(o, 0.8);
  },
  marker_lift: (r) => {
    const o = buf(SR, 0.06);
    chitin(o, r, 0.002, 0.5, range(r, 2500, 3500), 0.003);
    return out(o, 0.6);
  },
  group_assign: (r) => {
    // a fingertip on a dry leaf
    const o = buf(SR, 0.08);
    knock(o, r, 0.002, 0.5, range(r, 1300, 1700), 0.005);
    grains(o, SR, r, at(0.003), { count: 4, spread: 0.02, amp: 0.25, fLo: 3000, fHi: 8000, ring: 0.0007 });
    return out(o, 0.7);
  },
  tool_dig: (r) => {
    const o = buf(SR, 0.12);
    pad(o, r, 0.002, 0.5, 900, 0.012);
    grains(o, SR, r, at(0.004), { count: 8, spread: 0.06, amp: 0.4, fLo: 1500, fHi: 5000, ring: 0.002 });
    return out(o, 0.7);
  },
  tool_build: (r) => {
    // a knuckle on packed earth, and a puff of soil
    const o = buf(SR, 0.2);
    thud(o, r, 0.002, 0.8, range(r, 220, 320), 0.02);
    const p = buf(SR, 0.12);
    burst(p, SR, r, 0, 1, 0.005, 0.03);
    biquad(p, SR, 'bp', 1800, 0.6);
    mix(o, p, at(0.01), 0.25);
    return out(o, 0.8);
  },
  tool_upgrade: (r) => {
    const o = buf(SR, 0.3);
    thud(o, r, 0.002, 0.6, 260, 0.018);
    thud(o, r, 0.09, 0.7, 340, 0.018);
    trickle(o, r, 0.1, 0.2, 0.15, 10, 2500, 7000);
    return out(o, 0.8);
  },
  tool_delete: (r) => {
    // a clod crumbling apart
    const o = buf(SR, 0.45);
    grains(o, SR, r, at(0.002), { count: 25, spread: 0.12, amp: 0.6, fLo: 900, fHi: 4000, ring: 0.003 });
    trickle(o, r, 0.08, 0.3, 0.3, 30);
    return out(o, 0.8);
  },
  menu_tap: (r) => {
    // a quiet tap on dry wood
    const o = buf(SR, 0.06);
    knock(o, r, 0.001, 0.6, range(r, 650, 900), 0.008);
    return out(o, 0.5);
  },
  alert_queen: (r) => {
    // alarm stridulation over rapid drumming on the chamber wall (as termites and some ants signal)
    const o = buf(SR, 0.9);
    for (let k = 0; k < 9; k++) knock(o, r, 0.01 + k * 0.055 + range(r, -0.004, 0.004), range(r, 0.6, 0.9), range(r, 420, 560), 0.012);
    stridulate(o, SR, r, at(0.02), { rate: 420, dur: 0.6, f: 2600, amp: 0.45, ring: 0.0008, jitter: 0.4 });
    return out(o);
  },
  alert_starving: (r) => {
    const o = buf(SR, 0.9);
    for (const t of [0.01, 0.13, 0.5, 0.62]) knock(o, r, t, 0.7, range(r, 280, 340), 0.016);
    return out(o, 0.7);
  },
  alert_invasion: (r) => {
    const o = buf(SR, 1.0);
    for (let k = 0; k < 14; k++) knock(o, r, 0.01 + k * 0.045 + (k > 6 ? 0.12 : 0) + range(r, -0.003, 0.003), range(r, 0.55, 0.85), range(r, 550, 700), 0.01);
    stridulate(o, SR, r, at(0.05), { rate: 600, dur: 0.25, f: 3400, amp: 0.4, ring: 0.0007, jitter: 0.4 });
    stridulate(o, SR, r, at(0.55), { rate: 600, dur: 0.25, f: 3400, amp: 0.4, ring: 0.0007, jitter: 0.4 });
    return out(o);
  },
  message_good: (r) => {
    // a dry seed pod given two shakes: its seeds rattle against the husk
    const o = buf(SR, 0.45);
    for (const t of [0.005, 0.17]) grains(o, SR, r, at(t), { count: 22, spread: 0.1, amp: 0.5, fLo: 2200, fHi: 5000, ring: 0.004, shape: (u) => Math.sin(u * Math.PI / 2) });
    return out(o, 0.8);
  },
  message_warn: (r) => {
    const o = buf(SR, 0.4);
    knock(o, r, 0.005, 0.8, range(r, 200, 240), 0.016);
    knock(o, r, 0.17, 0.7, range(r, 170, 200), 0.016);
    return out(o, 0.8);
  },

  // ---- narration cue: a soft kalimba note (an acoustic instrument)
  narrator_cue: (r) => {
    const o = buf(SR, 2);
    kalimba(o, r, 0.002, 293.7, 0.6);
    kalimba(o, r, 0.12, 440, 0.45);
    return out(o, 0.7);
  },

  // ---- ambience
  wind_grass: () => {
    const r = rngFor('wind');
    return loop(10, (o) => {
      const w = buf(SR, o.length / SR);
      brown(w, r);
      // gusts: the cutoff and level breathe slowly
      sweepLp(w, SR, (u) => 380 + 300 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 2.3 + 1)) * (0.6 + 0.4 * Math.sin(u * Math.PI * 2 * 0.7)));
      mix(o, w, 0, 1);
      const g = buf(SR, o.length / SR);
      noise(g, r);
      biquad(g, SR, 'bp', 4500, 0.5);
      for (let i = 0; i < g.length; i++) g[i] *= 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((i / g.length) * Math.PI * 2 * 2.3 + 1));
      mix(o, g, 0, 0.05);
    }, 1.5);
  },
  leaves_rustle: () => {
    const r = rngFor('leaves');
    return loop(6, (o) => {
      for (let c = 0; c < 9; c++) grains(o, SR, r, at(range(r, 0, 6)), { count: 60 + Math.floor(r() * 80), spread: range(r, 0.3, 0.9), amp: 0.3, fLo: 2000, fHi: 9000, ring: 0.0007, shape: (u) => Math.sin(u * Math.PI) * 0.5 + u * 0.5 });
      grains(o, SR, r, 0, { count: 300, spread: 6.5, amp: 0.12, fLo: 2500, fHi: 9000, ring: 0.0006 });
    }, 0.8);
  },
  bird: (r) => {
    const o = buf(SR, 2.2);
    birdPhrase(o, r);
    biquad(o, SR, 'hp', 1500);
    return out(o, 0.8);
  },
  cicada: () => {
    const r = rngFor('cicada');
    return loop(8, (o) => {
      // tymbals buckling ~150 times a second, ringing the hollow abdomen near 5 kHz, in long swells
      let t = 0;
      while (t < 8.5) {
        const rate = range(r, 130, 170);
        const swell = 0.5 + 0.5 * Math.sin((t / 8.5) * Math.PI * 2 * 1.5);
        modal(o, SR, at(t), 0.4 * (0.25 + 0.75 * swell), [range(r, 4300, 5600), range(r, 7000, 9000)], [0.0009, 0.0005]);
        const nb = buf(SR, 0.003);
        noise(nb, r);
        biquad(nb, SR, 'bp', 5000, 1.2);
        mix(o, nb, at(t), 0.3 * (0.25 + 0.75 * swell));
        t += 1 / rate;
      }
      biquad(o, SR, 'lp', 9000);
    }, 1);
  },
  cricket: (r) => {
    // a field cricket's chirp: three or four pulses, each a fast stridulation that rings the wing's harp
    const o = buf(SR, 0.25);
    const f = range(r, 4300, 4900);
    const n = 3 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) stridulate(o, SR, r, at(0.003 + k * 0.042), { rate: 2400, dur: 0.018, f, amp: 0.5, ring: 0.004, jitter: 0.05 });
    return out(o, 0.8);
  },
  katydid: (r) => {
    // "ka-ty-did": three rasping groups, high and dry
    const o = buf(SR, 0.7);
    const groups = 2 + Math.floor(r() * 2);
    for (let k = 0; k < groups; k++) stridulate(o, SR, r, at(0.01 + k * 0.18), { rate: 320, dur: 0.11, f: range(r, 8000, 11000), amp: 0.6, ring: 0.0008, jitter: 0.4 });
    return out(o, 0.8);
  },
  fly_pass: (r) => {
    // a fly passing: wingbeats near 200 Hz, rich in harmonics, rising and falling in pitch and level as it passes
    const d = range(r, 1.6, 2.8);
    const o = buf(SR, d);
    const f0 = range(r, 170, 230);
    let t = 0;
    while (t < d) {
      const u = t / d;
      const dop = 1 + 0.06 * Math.cos(u * Math.PI);
      const amp = Math.exp(-(((u - 0.5) * 3.2) ** 2));
      modal(o, SR, at(t), 0.25 * amp, [f0 * dop * 2, f0 * dop * 3, f0 * dop * 5], [0.004, 0.003, 0.002]);
      const b = buf(SR, 0.002);
      noise(b, r);
      mix(o, b, at(t), 0.05 * amp);
      t += 1 / (f0 * dop);
    }
    biquad(o, SR, 'lp', 3500);
    return out(o, 0.7);
  },
  frog: (r) => {
    // a distant frog: a pulsed croak through the vocal sac's formant, repeated
    const o = buf(SR, 1.2);
    const reps = 2 + Math.floor(r() * 2);
    const f = range(r, 1100, 1900);
    for (let k = 0; k < reps; k++) stridulate(o, SR, r, at(0.02 + k * range(r, 0.28, 0.36)), { rate: range(r, 90, 140), dur: range(r, 0.14, 0.2), f, amp: 0.7, ring: 0.006, jitter: 0.1 });
    biquad(o, SR, 'lp', 2600);
    return out(o, 0.7);
  },
  owl: (r) => {
    // a tawny owl far off: breathy, tonal hoots with a waver
    const o = buf(SR, 2.4);
    const f = range(r, 380, 460);
    const hoot = (t: number, d: number, amp: number) => {
      const n = at(d);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        const fr = f * (1 + 0.04 * Math.sin(u * Math.PI) + 0.008 * Math.sin(i / SR * 2 * Math.PI * 6));
        ph += (2 * Math.PI * fr) / SR;
        const e = Math.sin(Math.PI * u) ** 0.8;
        o[at(t) + i] += (Math.sin(ph) + 0.2 * Math.sin(2 * ph)) * e * amp + (r() * 2 - 1) * e * amp * 0.08;
      }
    };
    hoot(0.05, 0.45, 0.7);
    hoot(0.95, 0.18, 0.5);
    hoot(1.25, 0.7, 0.6);
    biquad(o, SR, 'lp', 1800);
    return out(o, 0.6);
  },
  water_stream: () => {
    const r = rngFor('stream');
    return loop(6, (o) => {
      // running water is thousands of small bubbles
      for (let k = 0; k < 2200; k++) bubble(o, SR, at(range(r, 0, 6.5)), range(r, 0.05, 0.3), range(r, 350, 2400), range(r, 0.003, 0.012), range(r, 0.2, 0.9));
      const w = buf(SR, o.length / SR);
      noise(w, r);
      biquad(w, SR, 'lp', 1500);
      mix(o, w, 0, 0.08);
    });
  },
  drip: (r) => {
    const o = buf(SR, 0.5);
    chitin(o, r, 0.002, 0.15, range(r, 3000, 5000), 0.001);
    bubble(o, SR, at(0.004), 0.9, range(r, 700, 1600), range(r, 0.01, 0.025), range(r, 0.8, 1.6));
    return out(o, 0.8);
  },
  sand_hiss: () => {
    const r = rngFor('sand');
    return loop(6, (o) => {
      // wind-blown sand: grains hopping and striking (saltation), very fine and bright
      grains(o, SR, r, 0, { count: 6000, spread: 6.5, amp: 0.15, fLo: 4500, fHi: 12000, ring: 0.0003 });
      const w = buf(SR, o.length / SR);
      brown(w, r);
      biquad(w, SR, 'lp', 400);
      mix(o, w, 0, 0.4);
    });
  },
  rain: () => {
    const r = rngFor('rain');
    return loop(6, (o) => {
      // at ant scale, each raindrop is a heavy impact: a thump on soil, a slap on leaves, sometimes a bubble
      for (let k = 0; k < 70; k++) {
        const t = range(r, 0, 6.4);
        const leafy = r() < 0.5;
        if (leafy) modal(o, SR, at(t), range(r, 0.2, 0.6), [range(r, 600, 1400), range(r, 1800, 3000)], [0.01, 0.005]);
        else thud(o, r, t, range(r, 0.2, 0.5), range(r, 150, 300), 0.012);
        if (r() < 0.4) bubble(o, SR, at(t + 0.004), range(r, 0.1, 0.3), range(r, 800, 2000), 0.015, 1);
      }
      const h = buf(SR, o.length / SR);
      noise(h, r);
      biquad(h, SR, 'bp', 3000, 0.4);
      mix(o, h, 0, 0.05);
    });
  },
  raindrop_big: (r) => {
    const o = buf(SR, 0.6);
    thud(o, r, 0.002, 1, range(r, 120, 200), 0.03);
    grains(o, SR, r, at(0.004), { count: 40, spread: 0.15, amp: 0.4, fLo: 1500, fHi: 7000, ring: 0.001 });
    bubble(o, SR, at(0.01), 0.5, range(r, 600, 1200), 0.04, 1);
    return out(o);
  },
  thunder: (r) => {
    const d = range(r, 4, 7);
    const o = buf(SR, d);
    brown(o, r);
    biquad(o, SR, 'lp', 160, 0.7);
    // a few cracks inside the roll, then the long tail
    const peaks = [0.05, range(r, 0.3, 0.8), range(r, 1, 1.8)];
    for (let i = 0; i < o.length; i++) {
      const t = i / SR;
      let e = 0;
      for (const p of peaks) e = Math.max(e, t < p ? 0 : Math.exp(-(t - p) / (d * 0.3)));
      o[i] *= e * Math.min(1, t / 0.04);
    }
    return out(soft(o, 1.2), 0.9);
  },
  nest_room: () => {
    const r = rngFor('room');
    return loop(8, (o) => {
      brown(o, r);
      biquad(o, SR, 'lp', 160, 0.7);
      grains(o, SR, r, 0, { count: 120, spread: 8.5, amp: 0.05, fLo: 1500, fHi: 5000, ring: 0.002 });
    });
  },
  soil_trickle: (r) => {
    const o = buf(SR, 1.4);
    trickle(o, r, 0.01, 0.4, range(r, 0.6, 1.2), 40 + Math.floor(r() * 50), 1800, 6500);
    return out(o, 0.7);
  },
  root_creak: (r) => {
    const o = buf(SR, 1.6);
    creak(o, r, 0.02, 0.7, range(r, 0.6, 1.4), range(r, 12, 25), range(r, 20, 45), [range(r, 280, 420), range(r, 700, 950), range(r, 1400, 1800)]);
    biquad(o, SR, 'lp', 2500);
    return out(o, 0.7);
  },
  colony_rumble: () => {
    const r = rngFor('colony');
    return loop(6, (o) => {
      brown(o, r);
      biquad(o, SR, 'lp', 130);
      grains(o, SR, r, 0, { count: 900, spread: 6.5, amp: 0.06, fLo: 1500, fHi: 6000, ring: 0.0012 });
    });
  },

  // ---- species not in the game yet (their slots are ready)
  hellant_snap: (r) => {
    // a trap-jaw strike: a loud, woody crack like a twig snapping
    const o = buf(SR, 0.25);
    knock(o, r, 0.001, 1, range(r, 800, 1100), 0.012);
    const c = buf(SR, 0.008);
    noise(c, r);
    mix(o, envelope(c, SR, 0.0001, 0.006), at(0.001), 0.9);
    grains(o, SR, r, at(0.003), { count: 10, spread: 0.03, amp: 0.4, fLo: 1500, fHi: 5000, ring: 0.003 });
    return out(o);
  },
  hellant_impale: (r) => {
    const o = buf(SR, 0.3);
    chitin(o, r, 0.001, 0.6, 2500, 0.004);
    squelch(o, r, 0.006, 0.9, 400, 1400, 6);
    return out(o);
  },
  hellant_struggle: (r) => {
    const o = buf(SR, 0.7);
    for (let k = 0; k < 8; k++) scrape(o, r, range(r, 0, 0.6), 0.3, range(r, 0.04, 0.08), 2500, 5000, 120);
    for (let k = 0; k < 6; k++) tick(o, r, range(r, 0, 0.65), 0.4, 2500, 7000);
    return out(o);
  },
  nasute_move: (r) => {
    const o = buf(SR, 0.2);
    grains(o, SR, r, at(0.003), { count: 10, spread: 0.15, amp: 0.4, fLo: 1500, fHi: 4500, ring: 0.002 });
    biquad(o, SR, 'lp', 5000);
    return out(o, 0.6);
  },
  nasute_glue: () => {
    const r = rngFor('glue');
    return loop(2, (o) => {
      // sticky secretion forced out of the nozzle: wet pops and a tacky crackle (the engine thickens it as damage ramps)
      for (let k = 0; k < 160; k++) bubble(o, SR, at(range(r, 0, 2.4)), range(r, 0.1, 0.4), range(r, 900, 3500), range(r, 0.002, 0.006), range(r, 0.5, 1.5));
      grains(o, SR, r, 0, { count: 200, spread: 2.4, amp: 0.2, fLo: 1500, fHi: 4000, ring: 0.002 });
    }, 0.3);
  },
  termite_headbang: (r) => {
    // soldiers drumming their heads on the gallery wall: a rapid, dull tapping in bursts
    const o = buf(SR, 0.6);
    const n = 6 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) knock(o, r, 0.005 + k * range(r, 0.04, 0.05), range(r, 0.6, 0.9), range(r, 520, 700), 0.008);
    biquad(o, SR, 'lp', 3000);
    return out(o, 0.8);
  },
  saiyant_surge: (r) => {
    // rattled seed pods and a rain stick, swelling, over a soft resonance, ending in a crisp crackle
    const o = buf(SR, 2.4);
    grains(o, SR, r, at(0.02), { count: 900, spread: 2.0, amp: 0.4, fLo: 1500, fHi: 7000, ring: 0.003, shape: (u) => Math.pow(u, 0.55) });
    const hum = buf(SR, 2.1);
    noise(hum, r);
    biquad(hum, SR, 'bp', 220, 18);
    biquad(hum, SR, 'bp', 220, 18);
    for (let i = 0; i < hum.length; i++) hum[i] *= (i / hum.length) ** 1.5;
    mix(o, normalize(hum, 0.4), 0, 1);
    grains(o, SR, r, at(2.05), { count: 50, spread: 0.12, amp: 0.8, fLo: 2000, fHi: 9000, ring: 0.001 });
    return out(o);
  },
  termant_absorb: (r) => {
    // a soft organic gulp: a low wet swallow, a few slow bubbles, a gentle low swell under it
    const o = buf(SR, 0.9);
    squelch(o, r, 0.02, 0.6, 250, 700, 3, 2.5);
    const sw = buf(SR, 0.7);
    noise(sw, r);
    biquad(sw, SR, 'bp', 160, 8);
    biquad(sw, SR, 'lp', 420);
    for (let i = 0; i < sw.length; i++) sw[i] *= Math.sin((Math.PI * i) / sw.length) ** 2;
    mix(o, normalize(sw, 0.35), at(0.05), 1);
    squelch(o, r, 0.38, 0.35, 300, 900, 2, 3);
    return out(o, 0.75);
  },
  termant_caste: (r) => {
    // a richer chord climbing over a hand drum, after the gulp
    const o = buf(SR, 2.1);
    squelch(o, r, 0.01, 0.5, 250, 700, 3, 2.5);
    handDrum(o, r, 0.12, 95, 0.55);
    [196, 246.9, 293.7, 370, 392].forEach((f, i) => kalimba(o, r, 0.18 + i * 0.11, f, 0.32 - i * 0.03));
    string(o, r, 0.2, 98, 0.35, 0.9975, 0.3);
    handDrum(o, r, 0.78, 120, 0.35);
    return out(o, 0.8);
  },
  saiyant_crackle: (r) => {
    const o = buf(SR, 0.4);
    grains(o, SR, r, at(0.003), { count: 60, spread: 0.2, amp: 0.7, fLo: 2000, fHi: 9000, ring: 0.001, shape: (u) => Math.pow(u, 1.5) });
    return out(o);
  },
  // ---- music stingers (acoustic: plucked strings and a hand drum)
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
  cricket_burrow: (r) => {
    // a mole cricket shovelling soil with its forelegs
    const o = buf(SR, 0.5);
    for (let k = 0; k < 3; k++) grains(o, SR, r, at(0.01 + k * 0.14), { count: 20, spread: 0.08, amp: 0.5, fLo: 800, fHi: 3500, ring: 0.003 });
    return out(o);
  },
};

// ---------------------------------------------------------------- music instruments

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

// ---------------------------------------------------------------- helpers

function birdPhrase(o: Float32Array, r: Rand): void {
  // three made-up songbirds: a falling run of whistles, a two-note call, a short trill
  const kind = Math.floor(r() * 3);
  const base = range(r, 2600, 4200);
  const whistle = (t0: number, f0: number, f1: number, d: number, amp: number) => {
    const n = at(d);
    let ph = 0;
    for (let i = 0; i < n && at(t0) + i < o.length; i++) {
      const u = i / n;
      const f = f0 * Math.pow(f1 / f0, u) * (1 + 0.015 * Math.sin(i * 0.004));
      ph += (2 * Math.PI * f) / SR;
      const e = Math.sin(Math.PI * u) ** 0.6;
      o[at(t0) + i] += (Math.sin(ph) + 0.08 * Math.sin(2 * ph)) * e * amp;
    }
  };
  if (kind === 0) {
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) whistle(0.02 + i * 0.11, base * (1 + 0.1 * (n - i)), base * 0.85, 0.075, 0.6);
  } else if (kind === 1) {
    whistle(0.02, base * 1.2, base * 1.26, 0.17, 0.6);
    whistle(0.24, base * 0.92, base * 0.7, 0.23, 0.5);
  } else {
    for (let i = 0; i < 10; i++) whistle(0.02 + i * 0.034 * range(r, 0.9, 1.1), base * 1.18 * range(r, 0.97, 1.03), base * 0.86, 0.026, 0.5 * range(r, 0.6, 1));
  }
}

/** Loops are built once from a fixed seed (they do not need takes). */
function rngFor(name: string): Rand {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

