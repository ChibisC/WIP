/**
 * Columnar (structure-of-arrays) encoding of entity lists — ants, food,
 * brood, creatures, projectiles — for the per-tick snapshot the simulation
 * worker sends to the main thread (performance brief, Part A).
 *
 * Every numeric field becomes one Float64 column; string fields become
 * Uint16 ids into a string table that only grows; anything else (the rare
 * array or object field) travels as a small side list. The columns are one
 * ArrayBuffer, transferred without copying. The receiving side refills a
 * pool of plain objects keyed by entity id, so renderers and UI code keep
 * reading `a.x`, `a.caste` and so on, with no allocation per frame.
 */

const K_NUM = 0;
const K_STR = 1;
const K_BOOL = 2;
const K_OTHER = 3;

/** NaN payload that marks an absent optional number (`team?`) */
const ABSENT = -1.2345e-300;

export interface ColumnPacket {
  n: number;
  keys: string[];
  kinds: number[];
  /** n × numeric-or-bool keys, column-major */
  num: Float64Array;
  /** n × string keys, column-major */
  str: Uint16Array;
  /** strings added to the table since the last packet */
  newStrings: string[];
  /** other-typed fields: [entity index, key index, value] */
  other: Array<[number, number, unknown]>;
}

/** Where a writer gets its column arrays (default: fresh ones). */
export interface ColumnAlloc {
  num(length: number): Float64Array;
  str(length: number): Uint16Array;
}

/** Encoder side (one per entity list, in the worker). */
export class ColumnWriter {
  private keys: string[] = [];
  private kinds: number[] = [];
  private keyIndex = new Map<string, number>();
  private strings = new Map<string, number>();
  private sentStrings = 0;
  private table: string[] = [];

  /** Learn the fields of the objects (new optional fields are added as they appear). */
  private schema(items: readonly object[]): void {
    for (const it of items) {
      const o = it as Record<string, unknown>;
      for (const k in o) {
        if (this.keyIndex.has(k)) continue;
        const v = o[k];
        if (v === undefined) continue;
        const kind = typeof v === 'number' ? K_NUM : typeof v === 'string' ? K_STR : typeof v === 'boolean' ? K_BOOL : K_OTHER;
        this.keyIndex.set(k, this.keys.length);
        this.keys.push(k);
        this.kinds.push(kind);
      }
    }
  }

  private intern(s: string): number {
    let i = this.strings.get(s);
    if (i === undefined) {
      i = this.table.length;
      this.table.push(s);
      this.strings.set(s, i);
    }
    return i;
  }

  /**
   * Encode a list. `alloc` supplies the column arrays (the worker passes
   * shared ring buffers when the page is cross-origin isolated).
   */
  write(items: readonly object[], skip?: ReadonlySet<string> | null, alloc?: ColumnAlloc): ColumnPacket {
    this.schema(items);
    const n = items.length;
    const keys = this.keys;
    const kinds = this.kinds;
    let nNum = 0;
    let nStr = 0;
    for (let j = 0; j < keys.length; j++) {
      if (kinds[j] === K_NUM || kinds[j] === K_BOOL) nNum++;
      else if (kinds[j] === K_STR) nStr++;
    }
    const num = alloc ? alloc.num(n * nNum) : new Float64Array(n * nNum);
    const str = alloc ? alloc.str(n * nStr) : new Uint16Array(n * nStr);
    const other: Array<[number, number, unknown]> = [];
    let cn = 0;
    let cs = 0;
    for (let j = 0; j < keys.length; j++) {
      const k = keys[j];
      const kind = kinds[j];
      if (skip?.has(k)) {
        if (kind === K_NUM || kind === K_BOOL) cn++;
        else if (kind === K_STR) cs++;
        continue;
      }
      if (kind === K_NUM) {
        const base = cn++ * n;
        for (let i = 0; i < n; i++) {
          const v = (items[i] as Record<string, unknown>)[k];
          num[base + i] = typeof v === 'number' ? v : ABSENT;
        }
      } else if (kind === K_BOOL) {
        const base = cn++ * n;
        for (let i = 0; i < n; i++) {
          const v = (items[i] as Record<string, unknown>)[k];
          num[base + i] = v === undefined ? ABSENT : v ? 1 : 0;
        }
      } else if (kind === K_STR) {
        const base = cs++ * n;
        for (let i = 0; i < n; i++) {
          const v = (items[i] as Record<string, unknown>)[k];
          str[base + i] = typeof v === 'string' ? this.intern(v) : 0xffff;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const v = (items[i] as Record<string, unknown>)[k];
          if (v !== undefined) other.push([i, j, v]);
        }
      }
    }
    const newStrings = this.table.slice(this.sentStrings);
    this.sentStrings = this.table.length;
    return { n, keys: keys.slice(), kinds: kinds.slice(), num, str, newStrings, other };
  }
}

/** Decoder side (one per entity list, on the main thread): a pool of objects keyed by id. */
export class ColumnReader<T extends { id: number }> {
  private table: string[] = [];
  private pool = new Map<number, T>();
  private seen = new Set<number>();
  /** the current list, in simulation order */
  list: T[] = [];

  read(p: ColumnPacket): T[] {
    for (const s of p.newStrings) this.table.push(s);
    const n = p.n;
    const keys = p.keys;
    const kinds = p.kinds;
    const idCol = keys.indexOf('id');
    if (idCol < 0 && n > 0) throw new Error('columns: entities need an id');
    // column offsets
    const numBase: number[] = [];
    const strBase: number[] = [];
    let cn = 0;
    let cs = 0;
    for (let j = 0; j < keys.length; j++) {
      numBase.push(kinds[j] === K_NUM || kinds[j] === K_BOOL ? cn++ * n : -1);
      strBase.push(kinds[j] === K_STR ? cs++ * n : -1);
    }
    const num = p.num;
    const str = p.str;
    const out = this.list;
    out.length = n;
    const seen = this.seen;
    seen.clear();
    const idBase = numBase[idCol];
    for (let i = 0; i < n; i++) {
      const id = num[idBase + i];
      let o = this.pool.get(id);
      if (!o) {
        o = {} as T;
        this.pool.set(id, o);
      }
      seen.add(id);
      const r = o as unknown as Record<string, unknown>;
      for (let j = 0; j < keys.length; j++) {
        const kind = kinds[j];
        if (kind === K_NUM) {
          const v = num[numBase[j] + i];
          r[keys[j]] = v === ABSENT ? undefined : v;
        } else if (kind === K_BOOL) {
          const v = num[numBase[j] + i];
          r[keys[j]] = v === ABSENT ? undefined : v === 1;
        } else if (kind === K_STR) {
          const v = str[strBase[j] + i];
          r[keys[j]] = v === 0xffff ? undefined : this.table[v];
        }
      }
      out[i] = o;
    }
    for (const [i, j, v] of p.other) (out[i] as unknown as Record<string, unknown>)[keys[j]] = v;
    if (this.pool.size > n) for (const id of this.pool.keys()) if (!seen.has(id)) this.pool.delete(id);
    return out;
  }
}

/** Buffers to transfer (zero-copy) when posting a packet; shared ones are not transferred. */
export function columnBuffers(p: ColumnPacket): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const b of [p.num.buffer, p.str.buffer]) if (b instanceof ArrayBuffer && !out.includes(b)) out.push(b);
  return out;
}
