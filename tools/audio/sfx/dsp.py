"""Offline DSP for the game's sound effects (audio v3: claude/audio/03-spec-sfx-rework-insect.md).

Small, brittle, insect-scale sounds built from their physics (docs/audio/sound-research.md):
- chitin clicks: an impulse ringing a few narrow, inharmonic modes at 2-12 kHz that die within milliseconds;
- brittle fractures: many tiny clicks in a burst whose resonance falls as the piece breaks down;
- stridulation: a file-and-scraper tooth train (hundreds to thousands of impacts a second) ringing the body;
- friction: stick-slip catches with a faint rub; wet sounds: tiny Minnaert bubbles and resonant squelches.

Everything is mono float64 at SR; recipes compose these and the renderer trims, fades and normalises.
"""
import numpy as np
from scipy import signal

SR = 44100
TAU = 2 * np.pi


class Rng:
    """A seeded random source: one per take, so takes are reproducible."""

    def __init__(self, seed: int):
        self.g = np.random.default_rng(seed)

    def u(self, a=0.0, b=1.0):
        return float(self.g.uniform(a, b))

    def logu(self, a, b):
        return float(np.exp(self.g.uniform(np.log(a), np.log(b))))

    def n(self, s=1.0):
        return float(self.g.normal(0, s))

    def i(self, a, b):
        return int(self.g.integers(a, b + 1))

    def pick(self, xs):
        return xs[int(self.g.integers(0, len(xs)))]

    def chance(self, p):
        return self.g.uniform() < p

    def noise(self, n):
        return self.g.standard_normal(n)


# ------------------------------------------------------------------ buffers


def zeros(sec):
    return np.zeros(int(round(sec * SR)) + 1)


def at(t):
    return int(round(t * SR))


def add(o, x, t, g=1.0):
    """Mix x into o starting at t seconds (clipped to o's length)."""
    i = at(t)
    if i >= len(o) or g == 0:
        return o
    if i < 0:
        x = x[-i:]
        i = 0
    n = min(len(x), len(o) - i)
    o[i:i + n] += g * x[:n]
    return o


def tlin(n):
    return np.arange(n) / SR


def env_ad(n, a, d):
    """Attack (linear) then exponential decay with time constant d (seconds)."""
    t = tlin(n)
    e = np.exp(-np.maximum(0, t - a) / max(d, 1e-5))
    if a > 0:
        e *= np.minimum(1, t / a)
    return e


def env_points(n, pts):
    """Piecewise-linear envelope through (time, level) points."""
    t = tlin(n)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return np.interp(t, xs, ys)


def fade(x, a=0.002, b=0.008):
    """Short fades at both ends so nothing clicks."""
    x = x.copy()
    na = min(len(x), int(a * SR))
    nb = min(len(x), int(b * SR))
    if na > 1:
        x[:na] *= np.sin(np.linspace(0, np.pi / 2, na)) ** 2
    if nb > 1:
        x[-nb:] *= np.cos(np.linspace(0, np.pi / 2, nb)) ** 2
    return x


def norm(x, peak=1.0):
    m = np.max(np.abs(x)) if len(x) else 0
    return x * (peak / m) if m > 0 else x


# ------------------------------------------------------------------ filters


def _sos(kind, f, order=2):
    nyq = SR / 2 * 0.98
    if isinstance(f, (list, tuple)):
        f = [max(10, min(nyq, f[0])), max(11, min(nyq, f[1]))]
        if f[1] <= f[0] * 1.01:
            f[1] = f[0] * 1.02
    else:
        f = max(10, min(nyq, f))
    return signal.butter(order, f, kind, fs=SR, output="sos")


def hp(x, f, order=2):
    return signal.sosfilt(_sos("highpass", f, order), x)


def lp(x, f, order=2):
    return signal.sosfilt(_sos("lowpass", f, order), x)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos("bandpass", [lo, hi], order), x)


def peak(x, f, q):
    """A narrow resonance (constant-peak bandpass)."""
    b, a = signal.iirpeak(min(f, SR / 2 * 0.97), q, fs=SR)
    return signal.lfilter(b, a, x)


def svf_bp(x, f, q):
    """Bandpass with a time-varying centre f (array or scalar), Chamberlin state-variable filter."""
    f = np.broadcast_to(np.asarray(f, dtype=float), x.shape)
    g = 2 * np.sin(np.pi * np.minimum(f, SR / 6) / SR)
    damp = 1.0 / q
    low = band = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        high = x[i] - low - damp * band
        band += g[i] * high
        low += g[i] * band
        out[i] = band
    return out


def onepole_lp(x, f):
    """A gentle one-pole lowpass with a time-varying cutoff (array or scalar)."""
    f = np.broadcast_to(np.asarray(f, dtype=float), x.shape)
    a = np.exp(-TAU * f / SR)
    y = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        y = (1 - a[i]) * x[i] + a[i] * y
        out[i] = y
    return out


def resample(x, ratio):
    """Play `ratio` times faster (higher, shorter); ratio < 1 is lower and longer."""
    if abs(ratio - 1) < 1e-3:
        return x
    n = max(2, int(round(len(x) / ratio)))
    return signal.resample_poly(x, n, len(x)) if len(x) < 200000 else np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)


# ------------------------------------------------------------------ sources


def modes(dur, freqs, decays, amps, phases=None):
    """Sum of exponentially decaying sinusoids (modal synthesis)."""
    t = tlin(int(round(dur * SR)) + 1)
    o = np.zeros_like(t)
    for k, (f, d, a) in enumerate(zip(freqs, decays, amps)):
        if f >= SR / 2 * 0.95:
            continue
        ph = 0.0 if phases is None else phases[k]
        o += a * np.exp(-t / d) * np.sin(TAU * f * t + ph)
    return o


def burst(r: Rng, dur, a=0.0002, d=0.0006):
    """A tiny noise burst: the contact itself."""
    n = int(dur * SR) + 1
    return r.noise(n) * env_ad(n, a, d)


def body_ir(r: Rng, f_lo, f_hi, n=4, dec=(0.002, 0.012), tilt=0.0):
    """The impulse response of a small chitin body: n inharmonic modes in [f_lo, f_hi] (log-spread)."""
    fs = [r.logu(f_lo, f_hi) for _ in range(n)]
    ds = [r.logu(dec[0], dec[1]) for _ in range(n)]
    am = [r.u(0.4, 1.0) * (f / f_lo) ** tilt for f in fs]
    ph = [r.u(0, TAU) for _ in range(n)]
    return modes(max(ds) * 7, fs, ds, am, ph)


def click(r: Rng, f_lo=2500, f_hi=9000, n=4, dec=(0.0015, 0.008), snap=0.5, d=0.0005):
    """A chitin click: a contact burst ringing a few short modes."""
    m = body_ir(r, f_lo, f_hi, n, dec)
    b = hp(burst(r, d * 8, 0.00005, d), f_lo * 0.6)
    o = np.zeros(max(len(m), len(b)))
    o[:len(m)] += norm(m)
    o[:len(b)] += snap * norm(b)
    return o


def impulses(r: Rng, dur, times, amps):
    o = zeros(dur)
    for t, a in zip(times, amps):
        i = at(t)
        if 0 <= i < len(o):
            o[i] += a
    return o


def ring(x, ir):
    """Excite a body with an excitation signal (impulse train, noise) by convolution."""
    return signal.fftconvolve(x, ir)[: len(x) + len(ir) - 1]


def crunch(r: Rng, dur, n, f0, f1, shape=2.2, ring_s=(0.0006, 0.004), amp_decay=0.5, width=1.6):
    """A brittle fracture: n micro-cracks, densest at the start (shape > 1), their resonance falling from f0 to f1."""
    o = zeros(dur + 0.03)
    for _ in range(n):
        t = dur * r.u() ** shape
        fc = f0 * (f1 / f0) ** (t / dur)
        c = click(r, fc / width, fc * width, n=2, dec=ring_s, snap=r.u(0.2, 0.8), d=r.u(0.0002, 0.0008))
        add(o, c, t, np.exp(-t / max(1e-3, amp_decay * dur)) * r.u(0.25, 1.0))
    return o


def train(r: Rng, dur, rate0, rate1=None, jitter=0.06, amp=None, start=0.0):
    """Impact times of a tooth train whose rate sweeps rate0 -> rate1 (per second)."""
    rate1 = rate0 if rate1 is None else rate1
    ts = []
    t = start
    while t < start + dur:
        ts.append(t)
        k = (t - start) / dur
        rt = rate0 + (rate1 - rate0) * k
        t += (1 / rt) * max(0.2, 1 + r.n(jitter))
    return ts


def stridulate(r: Rng, chirps, f_lo=2500, f_hi=9000, dec=(0.0004, 0.0018), gap=(0.03, 0.08), clen=(0.04, 0.1), rate=(700, 1200), sweep=0.25, body_n=3):
    """File-and-scraper stridulation: `chirps` strokes, each a tooth train ringing the same small body."""
    ir = body_ir(r, f_lo, f_hi, body_n, dec)
    ts, am = [], []
    t = 0.004
    for c in range(chirps):
        L = r.u(*clen)
        r0 = r.u(*rate)
        r1 = r0 * (1 + r.u(-sweep, sweep))
        tt = train(r, L, r0, r1, 0.08, start=t)
        for k, x in enumerate(tt):
            u = (x - t) / L
            # each stroke swells and fades (the scraper's pressure), with tooth-to-tooth unevenness
            am.append(np.sin(np.pi * min(1, max(0, u))) ** 0.7 * r.u(0.5, 1.0))
            ts.append(x)
        t += L + r.u(*gap)
    exc = impulses(r, t + 0.02, ts, am)
    return ring(exc, ir)


def friction(r: Rng, dur, catches=250, f_lo=1500, f_hi=7000, dec=(0.0005, 0.003), rub=0.25, pressure=None, body_n=4):
    """Stick-slip friction (legs scraping chitin, dragging): irregular catches plus a faint rub."""
    n = int(dur * SR) + 1
    t = tlin(n)
    if pressure is None:
        # a wandering pressure curve: a few random swells
        k = r.i(2, 5)
        pressure = np.ones(n) * 0.3
        for _ in range(k):
            c = r.u(0, dur)
            w = r.u(0.03, dur * 0.4 + 0.03)
            pressure += r.u(0.4, 1) * np.exp(-((t - c) / w) ** 2)
        pressure = pressure / pressure.max()
    rate = catches * pressure
    p = rate / SR
    hits = r.g.uniform(size=n) < p
    exc = np.where(hits, r.g.uniform(0.2, 1, size=n) * np.sign(r.g.uniform(-1, 1, size=n)), 0.0)
    ir = body_ir(r, f_lo, f_hi, body_n, dec)
    o = ring(exc, ir)[:n]
    o = norm(o)
    rb = bp(r.noise(n), f_lo, f_hi) * pressure
    return o + rub * norm(rb)


def bubble(r: Rng, f, dec, rise=0.12, amp=1.0):
    """A Minnaert bubble: a sine at the bubble's resonance, rising as it decays (van den Doel)."""
    n = int(dec * 6 * SR) + 1
    t = tlin(n)
    # (the rise flattens after a few decay times: a drop's "plink" climbs by a fraction of an octave, not several)
    fr = f * (1 + rise * np.minimum(t / dec, 2.5))
    ph = TAU * np.cumsum(fr) / SR
    e = np.exp(-t / dec) * np.minimum(1, t / 0.0006)
    return amp * np.sin(ph) * e


def bubbles(r: Rng, dur, n, f_lo, f_hi, dec=(0.002, 0.008), rise=(0.05, 0.25), shape=2.0):
    o = zeros(dur + 0.05)
    for _ in range(n):
        t = dur * r.u() ** shape
        f = r.logu(f_lo, f_hi)
        add(o, bubble(r, f, r.u(*dec), r.u(*rise)), t, r.u(0.3, 1))
    return o


def squelch(r: Rng, dur, f0, f1, q=6, amp_d=None):
    """A tiny wet squelch: noise through a resonant band sweeping f0 -> f1."""
    n = int(dur * SR) + 1
    e = env_ad(n, 0.002, amp_d or dur / 3)
    f = np.geomspace(f0, f1, n)
    return svf_bp(r.noise(n) * e, f, q)


def fizz(r: Rng, dur, rate0=900, f_lo=3500, f_hi=12000, hiss=0.3, decay=None):
    """Effervescence: a crackle of micro-bubbles bursting (acid, venom), thinning out over `decay`."""
    n = int(dur * SR) + 1
    t = tlin(n)
    d = decay or dur / 2.5
    rate = rate0 * np.exp(-t / d)
    hits = r.g.uniform(size=n) < rate / SR
    exc = np.where(hits, r.g.uniform(0.1, 1, size=n), 0.0)
    # every bubble rings its own size: the hits are shared among several small bodies, so no one pitch stands out
    grp = r.g.integers(0, 6, size=n)
    o = np.zeros(n)
    for j in range(6):
        ir = body_ir(r, f_lo, f_hi, 2, (0.0002, 0.0009))
        o += ring(np.where(grp == j, exc, 0.0), ir)[:n]
    o = norm(o)
    h = hp(r.noise(n), f_lo) * np.exp(-t / d)
    return o + hiss * norm(h) * 0.6


def hiss(r: Rng, dur, lo, hi, env=None, order=2):
    n = int(dur * SR) + 1
    x = bp(r.noise(n), lo, hi, order)
    if env is not None:
        e = env if isinstance(env, np.ndarray) else env_points(n, env)
        e = np.pad(e[:n], (0, max(0, n - len(e))))
        x *= e
    return x


def swish(r: Rng, dur, f0, f1, q=2.5):
    """Air moved by a fast limb: noise through a quick bandpass sweep (kept small and soft)."""
    n = int(dur * SR) + 1
    e = np.sin(np.pi * np.linspace(0, 1, n)) ** 2
    return svf_bp(r.noise(n) * e, np.geomspace(f0, f1, n), q)


def thud(r: Rng, f, dec, dur=None):
    """A soft body meeting soil: lowpassed noise with a brief, rough low mode (never a clean drum)."""
    dur = dur or dec * 7 + 0.02
    n = int(dur * SR) + 1
    b = lp(r.noise(n) * env_ad(n, 0.0015, dec * 0.5), f * 4, 2)
    body = lp(r.noise(n) * env_ad(n, 0.003, dec), f * 1.7, 4)
    m = modes(dur, [f * r.u(0.94, 1.06), f * r.u(1.4, 1.75)], [min(dec, 0.035), min(dec, 0.035) * 0.5], [1, 0.5])
    return 0.8 * norm(b) + 0.7 * norm(body) + 0.2 * norm(m[:n])


def grains(r: Rng, dur, n, f_lo, f_hi, dec=(0.0005, 0.003), shape=1.0, amp=(0.2, 1.0)):
    """Soil grains, sand, debris: n tiny ticks spread over dur (shape > 1 piles them at the start)."""
    o = zeros(dur + 0.02)
    for _ in range(n):
        t = dur * r.u() ** shape
        f = r.logu(f_lo, f_hi)
        c = click(r, f / 1.3, f * 1.3, n=2, dec=dec, snap=0.6, d=0.0003)
        add(o, c, t, r.u(*amp))
    return o


def creak(r: Rng, dur, rate0, rate1, f_lo, f_hi, dec=(0.004, 0.02), env=None, body_n=5):
    """A stressed joint or root: stick-slip pulses at a slowly changing rate ringing a woody body."""
    ts = train(r, dur, rate0, rate1, 0.12)
    am = [r.u(0.5, 1) for _ in ts]
    exc = impulses(r, dur + 0.05, ts, am)
    o = ring(exc, body_ir(r, f_lo, f_hi, body_n, dec))
    n = len(o)
    if env is not None:
        o *= env_points(n, env)
    return o


def brown(r: Rng, n, k=0.02):
    """Brown noise (integrated white), DC-blocked."""
    x = np.cumsum(r.noise(n)) * k
    return hp(x, 15, 1)


def pink(r: Rng, n):
    """Pink-ish noise (Paul Kellet's filter)."""
    w = r.noise(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return signal.lfilter(b, a, w)


def tone(f, dur, dec=None, harm=(1.0,), vib=0.0, vib_hz=5.0, phase=0.0):
    """A pitched voice (birds, crickets, frogs: the naturally tonal calls); f may be an array (a contour)."""
    if np.ndim(f):
        f = np.asarray(f, dtype=float)
        n = len(f)
    else:
        n = int(dur * SR) + 1
        f = np.full(n, float(f))
    if vib:
        f = f * (1 + vib * np.sin(TAU * vib_hz * tlin(n)))
    ph = TAU * np.cumsum(f) / SR + phase
    o = np.zeros(n)
    for k, a in enumerate(harm):
        o += a * np.sin((k + 1) * ph)
    if dec:
        o *= np.exp(-tlin(n) / dec)
    return o


def seamless(x, xf=1.0):
    """Make a loop: crossfade the last xf seconds into the start (equal power)."""
    m = int(xf * SR)
    if len(x) <= 2 * m:
        return x
    head = x[:m]
    tail = x[-m:]
    w = np.linspace(0, 1, m)
    mixd = tail * np.cos(w * np.pi / 2) + head * np.sin(w * np.pi / 2)
    return np.concatenate([mixd, x[m:-m]])


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)
