/**
 * The slow state, sent as a delta (performance pass, CHANGE_PLAN §25): every frame used to structure-clone every
 * colony whole (175 KB of objects in a 10-colony match at 10 minutes, ~1.5 ms to clone in the worker and as much to
 * rebuild on the main thread, every frame, and all of it garbage). Now each colony's fields are fingerprinted and only
 * the fields that changed since the last frame are sent; the replica merges them over what it has (Object.assign),
 * so it ends up exactly where it did before. The same for the caves, aphids and plants.
 *
 * The fingerprint walks the value without allocating (two independent 32-bit hashes, so a collision is not a
 * practical concern). It runs in the worker only and never touches the simulation.
 */
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

let h1 = 0;
let h2 = 0;

function mix(x: number): void {
  h1 = Math.imul(h1 ^ x, 0x9e3779b1);
  h1 ^= h1 >>> 15;
  h2 = Math.imul(h2 + x, 0x85ebca77) ^ (h2 >>> 13);
}

function num(x: number): void {
  f64[0] = x;
  mix(u32[0]);
  mix(u32[1]);
}

function str(s: string): void {
  mix(s.length | 0x40000000);
  for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
}

function walk(v: unknown, depth: number): void {
  if (v === null) return mix(1);
  switch (typeof v) {
    case 'undefined':
      return mix(2);
    case 'number':
      return num(v);
    case 'boolean':
      return mix(v ? 3 : 4);
    case 'string':
      return str(v);
    case 'object':
      break;
    default:
      return mix(5);
  }
  if (depth > 12) return mix(6);
  if (ArrayBuffer.isView(v)) {
    const a = v as unknown as ArrayLike<number>;
    mix(7 + a.length);
    for (let i = 0; i < a.length; i++) num(a[i]);
    return;
  }
  if (Array.isArray(v)) {
    mix(8 + v.length * 16);
    for (let i = 0; i < v.length; i++) walk(v[i], depth + 1);
    return;
  }
  mix(9);
  const o = v as Record<string, unknown>;
  for (const k in o) {
    str(k);
    walk(o[k], depth + 1);
  }
}

/** Fingerprint of a value: [h1, h2]. */
export function fingerprint(v: unknown): number {
  h1 = 0x811c9dc5;
  h2 = 0x1b873593;
  walk(v, 0);
  // (both hashes in one double: 32 + 21 bits, exact)
  return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff);
}

/** Keeps the fingerprints last sent and builds each frame's delta. */
export class SlowDelta {
  /** per colony id: field → fingerprint */
  private colonies = new Map<number, Map<string, number>>();
  private parts = new Map<string, number>();

  /** The colonies' changed fields (a colony seen for the first time goes whole). */
  colonyDelta<C extends { id: number }>(list: readonly C[]): Array<Partial<C> & { id: number }> {
    const out: Array<Partial<C> & { id: number }> = [];
    for (const c of list) {
      let seen = this.colonies.get(c.id);
      const first = !seen;
      if (!seen) {
        seen = new Map();
        this.colonies.set(c.id, seen);
      }
      const d = { id: c.id } as Partial<C> & { id: number };
      const rec = c as unknown as Record<string, unknown>;
      for (const k in rec) {
        const fp = fingerprint(rec[k]);
        if (first || seen.get(k) !== fp) {
          (d as Record<string, unknown>)[k] = rec[k];
          seen.set(k, fp);
        }
      }
      // a field deleted since the last frame goes as undefined (Object.assign then clears it)
      if (!first)
        for (const k of seen.keys())
          if (!(k in rec)) {
            (d as Record<string, unknown>)[k] = undefined;
            seen.delete(k);
          }
      out.push(d);
    }
    return out;
  }

  /** The value if it changed since the last frame, else undefined. */
  part<T>(key: string, v: T): T | undefined {
    const fp = fingerprint(v);
    if (this.parts.get(key) === fp) return undefined;
    this.parts.set(key, fp);
    return v;
  }
}
