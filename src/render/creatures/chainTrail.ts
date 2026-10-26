/**
 * Chain creatures (caterpillar, centipedes): the body is a chain of joints behind the head that the
 * segments are laid along (render only).
 *
 * It used to be a pure trail of past head positions, with each segment's heading taken from the two
 * nearest trail points. When the creature turned on the spot, was shoved backwards or reversed, the head
 * moved only a hair from the newest trail point, sideways or backwards, so the head segment pointed
 * sideways or straight back: the "dislocated neck" (user report 2026-10-25), and the body could fold onto
 * itself. Now it is follow-the-leader: each joint is pulled to exactly one step behind the one before it,
 * and the bend at each joint is limited, starting from the head's own heading, so the neck always leaves
 * the head straight backwards and the body curves smoothly. Walking forward, it still follows the path
 * the head took.
 */

/** joints kept behind the head (enough for the longest chain plus its tail) */
export const TRAIL_CAP = 40;
/** joint spacing as a fraction of the body length */
export const TRAIL_STEP = 1 / 30;
/** the largest bend between one joint and the next (rad): a full U-turn takes about 10 joints (0.35 L) */
export const TRAIL_MAX_BEND = 0.3;

/** how fast a bent body relaxes back toward straight behind the head (per second) */
export const TRAIL_RELAX = 4;

/**
 * Pull the chain after the head at (hx, hz) with heading h: joints `step` apart, newest first, as
 * (x, z) pairs in `t`; returns the number of joints (TRAIL_CAP once started). A fresh chain (n = 0)
 * is laid out straight behind the head. `relax` (0..1, from the frame time) eases every joint toward
 * the straight body first, so a body bent by a turn on the spot straightens again and stays close to
 * the simulation's straight hitbox.
 */
export function followChain(t: Float32Array, n: number, hx: number, hz: number, h: number, step: number, relax = 0, maxBend = TRAIL_MAX_BEND): number {
  const cap = t.length >> 1;
  // the direction from each joint back to the next one (tail-ward), starting straight behind the head
  let ux = -Math.cos(h);
  let uz = -Math.sin(h);
  if (n === 0) {
    for (let j = 0; j < cap; j++) {
      t[j * 2] = hx + ux * step * (j + 1);
      t[j * 2 + 1] = hz + uz * step * (j + 1);
    }
    return cap;
  }
  if (relax > 0)
    for (let j = 0; j < cap; j++) {
      t[j * 2] += (hx + ux * step * (j + 1) - t[j * 2]) * relax;
      t[j * 2 + 1] += (hz + uz * step * (j + 1) - t[j * 2 + 1]) * relax;
    }
  const cb = Math.cos(maxBend);
  const sb = Math.sin(maxBend);
  let px = hx;
  let pz = hz;
  for (let j = 0; j < cap; j++) {
    let dx = t[j * 2] - px;
    let dz = t[j * 2 + 1] - pz;
    let d = Math.hypot(dx, dz);
    if (d < 1e-6) {
      dx = ux;
      dz = uz;
      d = 1;
    }
    let vx = dx / d;
    let vz = dz / d;
    // limit the bend against the previous direction (rotate toward it by the excess)
    const dot = vx * ux + vz * uz;
    if (dot < cb) {
      const cross = ux * vz - uz * vx;
      const sgn = cross >= 0 ? 1 : -1;
      vx = ux * cb - uz * sb * sgn;
      vz = uz * cb + ux * sb * sgn;
    }
    px += vx * step;
    pz += vz * step;
    t[j * 2] = px;
    t[j * 2 + 1] = pz;
    ux = vx;
    uz = vz;
  }
  return cap;
}

export interface ChainPose {
  /** the creature's sim heading, and the head point the chain starts from (world x, z) */
  h: number;
  hx: number;
  hz: number;
  trail: Float32Array;
  trailN: number;
  trailStep: number;
}

const _seg = { x: 0, z: 0, h: 0 };

/**
 * The point `dist` mm back along the chain (world x, z) and the body's heading there (pointing toward
 * the head). The heading is the chord over one joint spacing, never the gap between the head and a
 * joint a hair behind it; at the head itself it is the sim heading.
 */
export function chainPoint(p: ChainPose, dist: number): { x: number; z: number; h: number } {
  const step = p.trailStep;
  const n = p.trailN;
  const tx = (j: number) => (j <= 0 ? p.hx : p.trail[Math.min(j, n) * 2 - 2]);
  const tz = (j: number) => (j <= 0 ? p.hz : p.trail[Math.min(j, n) * 2 - 1]);
  if (n === 0) {
    _seg.x = p.hx - Math.cos(p.h) * dist;
    _seg.z = p.hz - Math.sin(p.h) * dist;
    _seg.h = p.h;
    return _seg;
  }
  const k = dist / step;
  if (k >= n) {
    // past the last joint: straight on along the last link
    const bx = tx(n);
    const bz = tz(n);
    const hh = Math.atan2(tz(n - 1) - bz, tx(n - 1) - bx);
    const back = dist - n * step;
    _seg.x = bx - Math.cos(hh) * back;
    _seg.z = bz - Math.sin(hh) * back;
    _seg.h = hh;
    return _seg;
  }
  const i = Math.floor(k);
  const f = k - i;
  const ax = tx(i);
  const az = tz(i);
  const bx = tx(i + 1);
  const bz = tz(i + 1);
  _seg.x = ax + (bx - ax) * f;
  _seg.z = az + (bz - az) * f;
  // links are exactly one step long, so the chord is always well defined
  _seg.h = i === 0 && f < 1e-6 ? p.h : Math.atan2(az - bz, ax - bx);
  return _seg;
}
