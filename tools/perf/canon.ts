/**
 * A canonical hash of the simulation's state (performance v3): what `hashState` covers (the state, the nest grids, the
 * pheromone fields), but with every object's keys sorted, so two builds whose objects merely hold their fields in a
 * different order (one hidden class for every ant) hash the same when their values are the same. Absent and
 * `undefined` fields are alike (the snapshot skips them too). For comparing builds, not for the game.
 */
import type { World } from '../../src/sim/world';

const SKIP = new Set(['hexSpeed']);

class W {
  buf = new Uint8Array(1 << 20);
  dv = new DataView(this.buf.buffer);
  n = 0;
  need(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let m = this.buf.length * 2;
    while (m < this.n + k) m *= 2;
    const b = new Uint8Array(m);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
    this.dv = new DataView(b.buffer);
  }
  u8(v: number): void {
    this.need(1);
    this.buf[this.n++] = v;
  }
  u32(v: number): void {
    this.need(4);
    this.dv.setUint32(this.n, v >>> 0, true);
    this.n += 4;
  }
  f64(v: number): void {
    this.need(8);
    this.dv.setFloat64(this.n, v, true);
    this.n += 8;
  }
  str(s: string): void {
    this.u32(s.length);
    this.need(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      this.dv.setUint16(this.n, s.charCodeAt(i), true);
      this.n += 2;
    }
  }
  value(v: unknown): void {
    if (v === undefined) return this.u8(0);
    if (v === null) return this.u8(1);
    switch (typeof v) {
      case 'boolean':
        return this.u8(v ? 2 : 3);
      case 'number':
        this.u8(4);
        return this.f64(v);
      case 'string':
        this.u8(5);
        return this.str(v);
      case 'object':
        break;
      default:
        throw new Error(`canon: ${typeof v}`);
    }
    if (Array.isArray(v)) {
      this.u8(6);
      this.u32(v.length);
      for (const x of v) this.value(x);
      return;
    }
    if (ArrayBuffer.isView(v)) {
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      this.u8(7);
      this.str(v.constructor.name);
      this.u32(b.length);
      this.need(b.length);
      this.buf.set(b, this.n);
      this.n += b.length;
      return;
    }
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined && !SKIP.has(k))
      .sort();
    this.u8(8);
    this.u32(keys.length);
    for (const k of keys) {
      this.str(k);
      this.value(o[k]);
    }
  }
}

function fnv(bytes: Uint8Array, n: number): string {
  let lo = 0x84222325;
  let hi = 0xcbf29ce4;
  for (let i = 0; i < n; i++) {
    lo = (lo ^ bytes[i]) >>> 0;
    const p = lo * 0x1b3;
    const plo = p >>> 0;
    const carry = Math.floor(p / 4294967296);
    hi = (Math.imul(hi, 0x1b3) + (lo << 8) + carry) >>> 0;
    lo = plo;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/** The canonical hash of `w` (the same parts as the snapshot: state, grids, pheromones; keys sorted). */
export function canonHash(w: World): string {
  w.s.rng = w.rng.state;
  const nests = w.s.nests;
  w.s.nests = {};
  try {
    const grids: Array<[number, unknown]> = [];
    for (const [space, g] of w.grids) grids.push([space, g.snap()]);
    const wr = new W();
    wr.value({ s: w.s, grids, trail: w.phero.trail, alarm: w.phero.alarm });
    return fnv(wr.buf, wr.n);
  } finally {
    w.s.nests = nests;
  }
}
