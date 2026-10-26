/**
 * Deterministic maths for the simulation (multiplayer brief, Part B).
 *
 * ECMAScript leaves Math.sin, cos, atan2, exp, pow, hypot (and `**`) as
 * "implementation-approximated", so two browsers may disagree in the last bit,
 * and a lockstep simulation would then drift apart. These versions use only
 * the IEEE-754 basic operations (+ − × ÷, sqrt), which every engine rounds
 * exactly the same way, with range reduction and polynomials from FreeBSD/musl
 * (fdlibm). Accuracy is within about 1 ulp of the libm results.
 *
 * Simulation code (src/sim, src/world) must use these instead of Math.*;
 * tools/check-determinism.ts enforces it.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

// ---------------------------------------------------------------- sin / cos

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [-π/4, π/4]; y is the tail of the reduced argument. */
function ksin(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** cos on [-π/4, π/4]. */
function kcos(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const ww = 1 - hz;
  return ww + ((1 - ww - hz) + (z * r - x * y));
}

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;

// Reduced argument: x = n·π/2 + (r0 + r1), |r0| ≤ π/4 (good for |x| < 2^20·π/2).
let r0 = 0; // det-ok: scratch written by reduce() and read straight after
let r1 = 0; // det-ok: scratch
function reduce(x: number): number {
  const fn = Math.round(x * INV_PIO2);
  // two-round Cody–Waite reduction (PIO2_1T ≈ PIO2_2 + PIO2_2T)
  const t = x - fn * PIO2_1;
  let w = fn * PIO2_2;
  let r: number;
  r = t - w;
  w = fn * PIO2_2T - (t - r - w);
  r0 = r - w;
  r1 = r - r0 - w;
  return fn;
}

export function dsin(x: number): number {
  if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
  const ax = x < 0 ? -x : x;
  if (ax < 0.7853981633974483) {
    if (ax < 7.450580596923828e-9) return x;
    return ksin(x, 0);
  }
  const n = reduce(x);
  const q = ((n % 4) + 4) % 4;
  if (q === 0) return ksin(r0, r1);
  if (q === 1) return kcos(r0, r1);
  if (q === 2) return -ksin(r0, r1);
  return -kcos(r0, r1);
}

export function dcos(x: number): number {
  if (!(x === x) || x === Infinity || x === -Infinity) return NaN;
  const ax = x < 0 ? -x : x;
  if (ax < 0.7853981633974483) {
    if (ax < 7.450580596923828e-9) return 1;
    return kcos(x, 0);
  }
  const n = reduce(x);
  const q = ((n % 4) + 4) % 4;
  if (q === 0) return kcos(r0, r1);
  if (q === 1) return -ksin(r0, r1);
  if (q === 2) return -kcos(r0, r1);
  return ksin(r0, r1);
}

// ---------------------------------------------------------------- atan / atan2

const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.11111104054623557880e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.65315727442169155270e-2;
const AT10 = 1.62858201153657823623e-2;

export function datan(x: number): number {
  if (!(x === x)) return NaN;
  const neg = x < 0;
  let ax = neg ? -x : x;
  if (ax >= 7.378697629483821e19) return neg ? -ATANHI[3] - ATANLO[3] : ATANHI[3] + ATANLO[3];
  let id: number;
  if (ax < 0.4375) {
    if (ax < 3.725290298461914e-9) return x;
    id = -1;
    ax = x;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      ax = (2 * ax - 1) / (2 + ax);
    } else {
      id = 1;
      ax = (ax - 1) / (ax + 1);
    }
  } else if (ax < 2.4375) {
    id = 2;
    ax = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3;
    ax = -1 / ax;
  }
  const z = ax * ax;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) return ax - ax * (s1 + s2);
  const r = ATANHI[id] - (ax * (s1 + s2) - ATANLO[id] - ax);
  return neg ? -r : r;
}

const PI_LO = 1.2246467991473531772e-16;

function negSign(v: number): boolean {
  return v < 0 || (v === 0 && 1 / v < 0);
}

export function datan2(y: number, x: number): number {
  if (!(x === x) || !(y === y)) return NaN;
  if (x === 1) return datan(y);
  const m = (negSign(y) ? 1 : 0) | (negSign(x) ? 2 : 0);
  if (y === 0) {
    if (m === 0 || m === 1) return y;
    return m === 2 ? PI : -PI;
  }
  if (x === 0) return m & 1 ? -HALF_PI : HALF_PI;
  if (x === Infinity || x === -Infinity) {
    if (y === Infinity || y === -Infinity) {
      const q = 0.7853981633974483;
      if (m === 0) return q;
      if (m === 1) return -q;
      if (m === 2) return 3 * q;
      return -3 * q;
    }
    if (m === 0) return 0;
    if (m === 1) return -0;
    return m === 2 ? PI : -PI;
  }
  if (y === Infinity || y === -Infinity) return m & 1 ? -HALF_PI : HALF_PI;
  const z = datan(y / x < 0 ? -(y / x) : y / x);
  if (m === 0) return z;
  if (m === 1) return -z;
  if (m === 2) return PI - (z - PI_LO);
  return z - PI_LO - PI;
}

// ---------------------------------------------------------------- hypot

export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function dhypot3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** x² (the `**` operator is implementation-approximated like Math.pow). */
export function sq(x: number): number {
  return x * x;
}

// ---------------------------------------------------------------- exp / log / pow

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

// exact powers of two 2^-1022 … 2^1023, built with exact doublings
const POW2 = new Float64Array(2046);
{
  let v = 1;
  for (let k = 0; k <= 1023; k++) {
    POW2[k + 1022] = v;
    v *= 2;
  }
  v = 1;
  for (let k = 0; k >= -1022; k--) {
    POW2[k + 1022] = v;
    v /= 2;
  }
}

/** y · 2^k, exactly (except when the result is subnormal). */
function scale2(y: number, k: number): number {
  while (k > 1023) {
    y *= POW2[1023 + 1022];
    k -= 1023;
  }
  while (k < -1022) {
    y *= POW2[0];
    k += 1022;
  }
  return y * POW2[k + 1022];
}

export function dexp(x: number): number {
  if (!(x === x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const ax = x < 0 ? -x : x;
  let k = 0;
  let hi = x;
  let lo = 0;
  if (ax > 0.34657359027997264) {
    k = ax < 1.0397207708399179 ? (x < 0 ? -1 : 1) : Math.round(x * INV_LN2);
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) {
    return 1 + x;
  }
  const xx = x * x;
  const c = x - xx * (P1 + xx * (P2 + xx * (P3 + xx * (P4 + xx * P5))));
  const y = 1 + ((x * c) / (2 - c) - lo + hi);
  return k === 0 ? y : scale2(y, k);
}

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

const bits = new DataView(new ArrayBuffer(8));

export function dlog(x: number): number {
  if (!(x === x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  if (x === 1) return 0;
  let k = 0;
  if (x < 2.2250738585072014e-308) {
    k -= 54;
    x *= 18014398509481984; // 2^54
  }
  bits.setFloat64(0, x, true);
  let hx = bits.getUint32(4, true);
  // reduce x into [√2/2, √2]
  hx = (hx + (0x3ff00000 - 0x3fe6a09e)) >>> 0;
  k += (hx >>> 20) - 0x3ff;
  hx = ((hx & 0x000fffff) + 0x3fe6a09e) >>> 0;
  bits.setUint32(4, hx, true);
  const f = bits.getFloat64(0, true) - 1;
  const hfsq = 0.5 * f * f;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  return s * (hfsq + R) + k * LN2_LO - hfsq + f + k * LN2_HI;
}

export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === 3) return x * x * x;
  if (y === 0.5 && x >= 0) return Math.sqrt(x);
  if (y === -1) return 1 / x;
  if (!(x === x) || !(y === y)) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (Math.floor(y) !== y) return NaN;
    const r = dexp(y * dlog(-x));
    return y % 2 === 0 ? r : -r;
  }
  return dexp(y * dlog(x));
}
