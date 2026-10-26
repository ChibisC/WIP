/**
 * Canonical binary snapshots and state hashes (multiplayer brief, Part B).
 *
 * A snapshot holds everything that carries over between ticks:
 * - SimState: colonies, ants, brood, food, creatures, settings, RNG state…
 * - every underground map (nest grids and caves), as raw typed arrays;
 * - the pheromone fields.
 * Pure caches (flow fields, spatial hashes, hex speeds) are left out and are
 * rebuilt from the state.
 *
 * The encoding is a tagged binary walk of the state tree, in property
 * insertion order. Numbers are written bit-exactly (−0 kept, NaN canonical);
 * strings are interned. The same state always gives the same bytes, so
 * `hashState` (FNV-1a 64 over the bytes) is the desync check. `restoreWorld`
 * rebuilds a running World from the bytes, for reconnects and replays.
 */
import { EventBus } from '../core/events';
import { NestGrid, NestGridSnap } from '../world/nestGrid';
import { World } from './world';
import { registerSystems } from './mapGen';
import { updateFlowCosts } from './colony';
import { SimState } from './types';
import { CASTE_ALIAS } from './species';

const T_UNDEF = 0;
const T_NULL = 1;
const T_FALSE = 2;
const T_TRUE = 3;
const T_INT = 4;
const T_F64 = 5;
const T_STR = 6;
const T_STRREF = 7;
const T_ARR = 8;
const T_OBJ = 9;
const T_U8 = 10;
const T_I8 = 11;
const T_U16 = 12;
const T_I16 = 13;
const T_U32 = 14;
const T_I32 = 15;
const T_F32 = 16;
const T_F64A = 17;

/** Keys that are caches, never part of a snapshot. */
const SKIP_KEYS = new Set(['hexSpeed']); // det-ok: constant table

const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

type Typed = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

class Writer {
  buf = new Uint8Array(1 << 20);
  dv = new DataView(this.buf.buffer);
  n = 0;
  strings = new Map<string, number>();

  need(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + k) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.n));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }

  u8(v: number): void {
    this.need(1);
    this.buf[this.n++] = v;
  }

  u32(v: number): void {
    this.need(4);
    this.dv.setUint32(this.n, v, true);
    this.n += 4;
  }

  f64(v: number): void {
    this.need(8);
    if (v !== v) {
      // canonical quiet NaN
      this.dv.setUint32(this.n, 0, true);
      this.dv.setUint32(this.n + 4, 0x7ff80000, true);
    } else this.dv.setFloat64(this.n, v, true);
    this.n += 8;
  }

  str(s: string): void {
    const ref = this.strings.get(s);
    if (ref !== undefined) {
      this.u8(T_STRREF);
      this.u32(ref);
      return;
    }
    this.strings.set(s, this.strings.size);
    this.u8(T_STR);
    this.u32(s.length);
    this.need(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      this.dv.setUint16(this.n, s.charCodeAt(i), true);
      this.n += 2;
    }
  }

  typed(tag: number, a: Typed): void {
    this.u8(tag);
    this.u32(a.length);
    const bytes = a.byteLength;
    this.need(bytes);
    if (LITTLE || a.BYTES_PER_ELEMENT === 1) {
      this.buf.set(new Uint8Array(a.buffer, a.byteOffset, bytes), this.n);
      if (a instanceof Float32Array || a instanceof Float64Array) this.canonNaN(a, this.n);
      this.n += bytes;
      return;
    }
    // big-endian hosts: write element by element
    const dv = this.dv;
    let o = this.n;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (a instanceof Float32Array) dv.setFloat32(o, v !== v ? NaN : v, true);
      else if (a instanceof Float64Array) dv.setFloat64(o, v, true);
      else if (a instanceof Uint16Array) dv.setUint16(o, v, true);
      else if (a instanceof Int16Array) dv.setInt16(o, v, true);
      else if (a instanceof Uint32Array) dv.setUint32(o, v, true);
      else dv.setInt32(o, v, true);
      o += a.BYTES_PER_ELEMENT;
    }
    this.n = o;
  }

  /** NaN payloads are not portable; write one canonical pattern. */
  private canonNaN(a: Float32Array | Float64Array, at: number): void {
    for (let i = 0; i < a.length; i++) {
      if (a[i] === a[i]) continue;
      const o = at + i * a.BYTES_PER_ELEMENT;
      if (a instanceof Float32Array) this.dv.setUint32(o, 0x7fc00000, true);
      else {
        this.dv.setUint32(o, 0, true);
        this.dv.setUint32(o + 4, 0x7ff80000, true);
      }
    }
  }

  value(v: unknown): void {
    if (v === undefined) return this.u8(T_UNDEF);
    if (v === null) return this.u8(T_NULL);
    switch (typeof v) {
      case 'boolean':
        return this.u8(v ? T_TRUE : T_FALSE);
      case 'number':
        if ((v | 0) === v && !(v === 0 && 1 / v < 0)) {
          this.u8(T_INT);
          this.need(4);
          this.dv.setInt32(this.n, v, true);
          this.n += 4;
        } else {
          this.u8(T_F64);
          this.f64(v);
        }
        return;
      case 'string':
        return this.str(v);
      case 'object':
        break;
      default:
        throw new Error(`snapshot: cannot encode a ${typeof v}`);
    }
    if (Array.isArray(v)) {
      this.u8(T_ARR);
      this.u32(v.length);
      for (let i = 0; i < v.length; i++) this.value(v[i]);
      return;
    }
    if (ArrayBuffer.isView(v)) {
      if (v instanceof Uint8Array) return this.typed(T_U8, v);
      if (v instanceof Int8Array) return this.typed(T_I8, v);
      if (v instanceof Uint16Array) return this.typed(T_U16, v);
      if (v instanceof Int16Array) return this.typed(T_I16, v);
      if (v instanceof Uint32Array) return this.typed(T_U32, v);
      if (v instanceof Int32Array) return this.typed(T_I32, v);
      if (v instanceof Float32Array) return this.typed(T_F32, v);
      if (v instanceof Float64Array) return this.typed(T_F64A, v);
      throw new Error('snapshot: unsupported typed array');
    }
    if (v instanceof Map || v instanceof Set) throw new Error('snapshot: Map/Set in simulation state (use arrays or plain objects)');
    const o = v as Record<string, unknown>;
    let count = 0;
    for (const k in o) if (o[k] !== undefined && !SKIP_KEYS.has(k)) count++;
    this.u8(T_OBJ);
    this.u32(count);
    for (const k in o) {
      const x = o[k];
      if (x === undefined || SKIP_KEYS.has(k)) continue;
      this.str(k);
      this.value(x);
    }
  }
}

class Reader {
  dv: DataView;
  n = 0;
  strings: string[] = [];

  constructor(public buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  u32(): number {
    const v = this.dv.getUint32(this.n, true);
    this.n += 4;
    return v;
  }

  strBody(): string {
    const len = this.u32();
    let s = '';
    for (let i = 0; i < len; i++) {
      s += String.fromCharCode(this.dv.getUint16(this.n, true));
      this.n += 2;
    }
    this.strings.push(s);
    return s;
  }

  key(): string {
    const t = this.buf[this.n++];
    if (t === T_STR) return this.strBody();
    if (t === T_STRREF) return this.strings[this.u32()];
    throw new Error('snapshot: bad key');
  }

  typed<T extends Typed>(Ctor: { new (b: ArrayBuffer): T; BYTES_PER_ELEMENT: number }): T {
    const len = this.u32();
    const bytes = len * Ctor.BYTES_PER_ELEMENT;
    const out = new Ctor(new ArrayBuffer(bytes));
    if (LITTLE || Ctor.BYTES_PER_ELEMENT === 1) new Uint8Array(out.buffer).set(this.buf.subarray(this.n, this.n + bytes));
    else {
      const a = out as unknown as Typed;
      for (let i = 0; i < len; i++) {
        const o = this.n + i * Ctor.BYTES_PER_ELEMENT;
        if (a instanceof Float32Array) a[i] = this.dv.getFloat32(o, true);
        else if (a instanceof Float64Array) a[i] = this.dv.getFloat64(o, true);
        else if (a instanceof Uint16Array) a[i] = this.dv.getUint16(o, true);
        else if (a instanceof Int16Array) a[i] = this.dv.getInt16(o, true);
        else if (a instanceof Uint32Array) a[i] = this.dv.getUint32(o, true);
        else a[i] = this.dv.getInt32(o, true);
      }
    }
    this.n += bytes;
    return out;
  }

  value(): unknown {
    const t = this.buf[this.n++];
    switch (t) {
      case T_UNDEF:
        return undefined;
      case T_NULL:
        return null;
      case T_FALSE:
        return false;
      case T_TRUE:
        return true;
      case T_INT: {
        const v = this.dv.getInt32(this.n, true);
        this.n += 4;
        return v;
      }
      case T_F64: {
        const v = this.dv.getFloat64(this.n, true);
        this.n += 8;
        return v;
      }
      case T_STR:
        return this.strBody();
      case T_STRREF:
        return this.strings[this.u32()];
      case T_ARR: {
        const len = this.u32();
        const out = new Array(len);
        for (let i = 0; i < len; i++) out[i] = this.value();
        return out;
      }
      case T_OBJ: {
        const count = this.u32();
        const o: Record<string, unknown> = {};
        for (let i = 0; i < count; i++) {
          const k = this.key();
          o[k] = this.value();
        }
        return o;
      }
      case T_U8:
        return this.typed(Uint8Array);
      case T_I8:
        return this.typed(Int8Array);
      case T_U16:
        return this.typed(Uint16Array);
      case T_I16:
        return this.typed(Int16Array);
      case T_U32:
        return this.typed(Uint32Array);
      case T_I32:
        return this.typed(Int32Array);
      case T_F32:
        return this.typed(Float32Array);
      case T_F64A:
        return this.typed(Float64Array);
    }
    throw new Error(`snapshot: bad tag ${t} at ${this.n - 1}`);
  }
}

const MAGIC = 0x55445331; // "UDS1"

interface SnapshotRoot {
  /** SimState without the lazily-serialized nest maps */
  s: SimState;
  grids: Array<[number, NestGridSnap]>;
  trail: Float32Array[];
  alarm: Float32Array;
}

/** Canonical binary snapshot of the whole simulation. */
export function encodeState(w: World): Uint8Array {
  w.s.rng = w.rng.state;
  const nests = w.s.nests;
  w.s.nests = {};
  try {
    const grids: Array<[number, NestGridSnap]> = [];
    for (const [space, g] of w.grids) grids.push([space, g.snap()]);
    const root: SnapshotRoot = { s: w.s, grids, trail: w.phero.trail, alarm: w.phero.alarm };
    const wr = new Writer();
    wr.u32(MAGIC);
    wr.value(root);
    return wr.buf.slice(0, wr.n);
  } finally {
    w.s.nests = nests;
  }
}

/** FNV-1a 64-bit over bytes, as 16 hex digits. */
export function fnv1a64(bytes: Uint8Array): string {
  let lo = 0x84222325;
  let hi = 0xcbf29ce4;
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]) >>> 0;
    // h *= 0x100000001b3  (mod 2^64)
    const p = lo * 0x1b3;
    const plo = p >>> 0;
    const carry = Math.floor(p / 4294967296);
    hi = (Math.imul(hi, 0x1b3) + (lo << 8) + carry) >>> 0;
    lo = plo;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/** The desync check: a hash of the canonical snapshot. */
export function hashState(w: World): string {
  return fnv1a64(encodeState(w));
}

/**
 * Old ids in a saved state (CASTE_ALIAS: the army ants' old `eciton_soldier` is the Soldier, `eciton_major`):
 * every string value and object key equal to an old id is renamed, in place, keeping key order.
 */
function renameAliases(v: unknown): void {
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (typeof x === 'string' && x in CASTE_ALIAS) v[i] = CASTE_ALIAS[x];
      else renameAliases(x);
    }
    return;
  }
  const o = v as Record<string, unknown>;
  let rekey = false;
  for (const k of Object.keys(o)) {
    const x = o[k];
    if (typeof x === 'string' && x in CASTE_ALIAS) o[k] = CASTE_ALIAS[x];
    else renameAliases(x);
    if (k in CASTE_ALIAS) rekey = true;
  }
  if (rekey) {
    const entries = Object.entries(o);
    for (const k of Object.keys(o)) delete o[k];
    for (const [k, x] of entries) o[CASTE_ALIAS[k] ?? k] = x;
  }
}

/** Rebuild a running World (systems registered, caches primed) from a snapshot. */
export function restoreWorld(bytes: Uint8Array, events: EventBus): World {
  const r = new Reader(bytes);
  if (r.u32() !== MAGIC) throw new Error('snapshot: not a snapshot');
  const root = r.value() as SnapshotRoot;
  renameAliases(root.s);
  const s = root.s;
  s.nests = {};
  const w = new World(s, events);
  for (const [space, d] of root.grids) w.addGrid(space, NestGrid.fromSnap(d));
  w.phero.ensureColonies(root.trail.length);
  for (let i = 0; i < root.trail.length; i++) w.phero.trail[i].set(root.trail[i]);
  w.phero.alarm.set(root.alarm);
  registerSystems(w);
  for (const c of s.colonies) updateFlowCosts(w, c);
  w.reindex();
  return w;
}
