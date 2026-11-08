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

/**
 * A generated reader (performance v2): a loop that stores `o[k]` for a hundred different keys k is one megamorphic
 * keyed store per value; a loop generated for the schema stores each field by name, one object at a time — under half
 * the time (800 ants: 3.1 → 1.8 ms on the build machine). Pages that forbid compiling code (a strict CSP) keep the
 * plain loop, which gives the same result. `columnCodegen.on = false` forces the plain loop (tests).
 */
export const columnCodegen = {
  on: (() => {
    try {
      return new Function('return 1')() === 1;
    } catch {
      return false;
    }
  })(),
};
type ReadFn = (out: unknown[], n: number, num: Float64Array, str: Uint16Array, table: string[], nb: number[], sb: number[], absent: number) => void;
const readFns = new Map<string, ReadFn>(); // det-ok: compiled readers for the main thread’s replica, keyed by schema; never simulation state
const sigOf = (keys: readonly string[], kinds: readonly number[]) => keys.map((k, j) => kinds[j] + k).join('\u0001');

function readFn(keys: readonly string[], kinds: readonly number[]): ReadFn | null {
  if (!columnCodegen.on) return null;
  const sig = sigOf(keys, kinds);
  let f = readFns.get(sig);
  if (f) return f;
  const decl: string[] = [];
  const body: string[] = [];
  keys.forEach((k, j) => {
    const q = JSON.stringify(k);
    if (kinds[j] === K_NUM) {
      decl.push(`const b${j} = nb[${j}];`);
      body.push(`if (b${j} >= 0) { const v = num[b${j} + i]; o[${q}] = v === absent ? undefined : v; }`);
    } else if (kinds[j] === K_BOOL) {
      decl.push(`const b${j} = nb[${j}];`);
      body.push(`if (b${j} >= 0) { const v = num[b${j} + i]; o[${q}] = v === absent ? undefined : v === 1; }`);
    } else if (kinds[j] === K_STR) {
      decl.push(`const b${j} = sb[${j}];`);
      body.push(`if (b${j} >= 0) { const v = str[b${j} + i]; o[${q}] = v === 0xffff ? undefined : table[v]; }`);
    }
  });
  try {
    f = new Function('out', 'n', 'num', 'str', 'table', 'nb', 'sb', 'absent', `${decl.join('\n')}\nfor (let i = 0; i < n; i++) { const o = out[i];\n${body.join('\n')}\n}`) as ReadFn;
  } catch {
    columnCodegen.on = false;
    return null;
  }
  readFns.set(sig, f);
  return f;
}

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
  /**
   * Delta frames (performance v2): per key, 1 = no entity's value changed since the last packet (every entity was in
   * it) and the column is not sent — the reader's objects, pooled by id, keep their values. Absent: every column is
   * sent.
   */
  omit?: Uint8Array;
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

  /** this writer's own copy of the last two frames' full columns (the newest is compared with the next) */
  private bufs: Array<{ num: Float64Array; str: Uint16Array }> = [
    { num: new Float64Array(0), str: new Uint16Array(0) },
    { num: new Float64Array(0), str: new Uint16Array(0) },
  ];
  private cur = 0;
  private last: { n: number; nNum: number; nStr: number; nKeys: number } | null = null;

  /**
   * Encode a list. `alloc` supplies the column arrays (the worker passes
   * shared ring buffers when the page is cross-origin isolated). `delta`:
   * when every entity was in the last packet too (some may be gone, the
   * order may differ), the columns in which none changed are left out
   * (`omit`) — about half of them in a big fight (performance v2).
   */
  write(items: readonly object[], skip?: ReadonlySet<string> | null, alloc?: ColumnAlloc, delta = false): ColumnPacket {
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
    // the full columns, in this writer's own arrays
    this.cur ^= 1;
    const B = this.bufs[this.cur];
    if (B.num.length < n * nNum) B.num = new Float64Array(Math.ceil(n * nNum * 1.25) + 64);
    if (B.str.length < n * nStr) B.str = new Uint16Array(Math.ceil(n * nStr * 1.25) + 64);
    const num = B.num;
    const str = B.str;
    const other: Array<[number, number, unknown]> = [];
    const numBase = this.numBase;
    const strBase = this.strBase;
    numBase.length = strBase.length = keys.length;
    let cn = 0;
    let cs = 0;
    // (column by column: a generated row-by-row loop is slower here — its stores are scattered over a hundred columns)
    for (let j = 0; j < keys.length; j++) {
      const k = keys[j];
      const kind = kinds[j];
      numBase[j] = kind === K_NUM || kind === K_BOOL ? cn * n : -1;
      strBase[j] = kind === K_STR ? cs * n : -1;
      if (skip?.has(k)) {
        if (kind === K_NUM || kind === K_BOOL) num.fill(0, cn++ * n, cn * n);
        else if (kind === K_STR) str.fill(0, cs++ * n, cs * n);
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
    // delta: no entity that was not in the last packet (some may be gone, the order may differ) → leave out the
    // columns in which no entity's value changed; the reader's objects (pooled by id) keep theirs
    let omit: Uint8Array | undefined;
    const L = this.last;
    const idCol = this.keyIndex.get('id') ?? -1;
    const prevRow = this.prevRow;
    if (delta && L && idCol >= 0 && L.nNum === nNum && L.nStr === nStr && L.nKeys === keys.length && n > 0) {
      const P = this.bufs[this.cur ^ 1];
      const ib = numBase[idCol];
      const rows = this.rows.length >= n ? this.rows : (this.rows = new Int32Array(Math.ceil(n * 1.5) + 16));
      let known = true;
      for (let i = 0; i < n; i++) {
        const r = prevRow.get(num[ib + i]);
        if (r === undefined) {
          known = false;
          break;
        }
        rows[i] = r;
      }
      if (known) {
        const pn = L.n;
        omit = new Uint8Array(keys.length);
        for (let j = 0; j < keys.length; j++) {
          if (j === idCol) continue;
          const nb = numBase[j];
          const sb = strBase[j];
          let eq = nb >= 0 || sb >= 0;
          if (nb >= 0) {
            const pb = (nb / n) * pn;
            for (let i = 0; i < n; i++) {
              const a = num[nb + i];
              const b = P.num[pb + rows[i]];
              // (NaN equals NaN here: an unchanged NaN need not be sent again)
              if (a !== b && !(a !== a && b !== b)) {
                eq = false;
                break;
              }
            }
          } else if (sb >= 0) {
            const pb = (sb / n) * pn;
            for (let i = 0; i < n; i++)
              if (str[sb + i] !== P.str[pb + rows[i]]) {
                eq = false;
                break;
              }
          }
          if (eq) omit[j] = 1;
        }
      }
    }
    // (the rows of this packet, by id, for the next one)
    prevRow.clear();
    if (delta && idCol >= 0) {
      const ib = numBase[idCol];
      for (let i = 0; i < n; i++) prevRow.set(num[ib + i], i);
    }
    this.last = { n, nNum, nStr, nKeys: keys.length };
    // the columns sent
    let sNum = 0;
    let sStr = 0;
    for (let j = 0; j < keys.length; j++) {
      if (omit?.[j]) continue;
      if (numBase[j] >= 0) sNum++;
      else if (strBase[j] >= 0) sStr++;
    }
    const outNum = alloc ? alloc.num(n * sNum) : new Float64Array(n * sNum);
    const outStr = alloc ? alloc.str(n * sStr) : new Uint16Array(n * sStr);
    let on = 0;
    let os = 0;
    for (let j = 0; j < keys.length; j++) {
      if (omit?.[j]) continue;
      if (numBase[j] >= 0) outNum.set(num.subarray(numBase[j], numBase[j] + n), on++ * n);
      else if (strBase[j] >= 0) outStr.set(str.subarray(strBase[j], strBase[j] + n), os++ * n);
    }
    const newStrings = this.table.slice(this.sentStrings);
    this.sentStrings = this.table.length;
    return { n, keys: keys.slice(), kinds: kinds.slice(), num: outNum, str: outStr, newStrings, other, ...(omit ? { omit } : {}) };
  }
  private numBase: number[] = [];
  private strBase: number[] = [];
  /** the last packet's row of each entity id, and this packet's rows' rows in it (delta frames) */
  private prevRow = new Map<number, number>();
  private rows = new Int32Array(0);
}

/**
 * Something carried over a pooled object's update (game/playout.ts MotionCarry: where it was drawn): `save` before the
 * frame's values overwrite it, `restore` after — every object of the packet is saved first, then all are written,
 * then restored, so the carry keeps one record per row. Only for objects that were already there.
 */
export interface ColumnCarry<T> {
  /** `i`: the object's row in this packet (every object is saved before any is written, then restored) */
  save(o: T, i: number): void;
  restore(o: T, i: number): void;
}

/** Decoder side (one per entity list, on the main thread): a pool of objects keyed by id. */
export class ColumnReader<T extends { id: number }> {
  private table: string[] = [];
  private pool = new Map<number, T>();
  private seen = new Set<number>();
  /** the current list, in simulation order */
  list: T[] = [];

  read(p: ColumnPacket, carry?: ColumnCarry<T> | null): T[] {
    for (const s of p.newStrings) this.table.push(s);
    const n = p.n;
    const keys = p.keys;
    const kinds = p.kinds;
    const omit = p.omit;
    const idCol = keys.indexOf('id');
    if (idCol < 0 && n > 0) throw new Error('columns: entities need an id');
    // column offsets (a left-out column takes no space: its values stay on the objects)
    const numBase = this.numBase;
    const strBase = this.strBase;
    numBase.length = strBase.length = keys.length;
    let cn = 0;
    let cs = 0;
    for (let j = 0; j < keys.length; j++) {
      const sent = !omit || !omit[j];
      numBase[j] = sent && (kinds[j] === K_NUM || kinds[j] === K_BOOL) ? cn++ * n : -1;
      strBase[j] = sent && kinds[j] === K_STR ? cs++ * n : -1;
    }
    const num = p.num;
    const str = p.str;
    const out = this.list;
    out.length = n;
    const seen = this.seen;
    seen.clear();
    if (this.kept.length < n) this.kept = new Uint8Array(Math.ceil(n * 1.5) + 16);
    const kept = this.kept;
    const idBase = numBase[idCol];
    // the objects (pooled by id), and what the carry keeps of them before they change
    for (let i = 0; i < n; i++) {
      const id = num[idBase + i];
      let o = this.pool.get(id);
      kept[i] = o && carry ? 1 : 0;
      if (!o) {
        o = {} as T;
        this.pool.set(id, o);
      } else if (carry) carry.save(o, i);
      seen.add(id);
      out[i] = o;
    }
    // then the values: a loop generated for the schema (named stores), or column by column
    const gen = readFn(keys, kinds);
    if (gen) gen(out, n, num, str, this.table, numBase, strBase, ABSENT);
    for (let j = 0; j < keys.length && !gen; j++) {
      const kind = kinds[j];
      const k = keys[j];
      if (kind === K_NUM) {
        const b = numBase[j];
        if (b < 0) continue;
        for (let i = 0; i < n; i++) {
          const v = num[b + i];
          (out[i] as unknown as Record<string, unknown>)[k] = v === ABSENT ? undefined : v;
        }
      } else if (kind === K_BOOL) {
        const b = numBase[j];
        if (b < 0) continue;
        for (let i = 0; i < n; i++) {
          const v = num[b + i];
          (out[i] as unknown as Record<string, unknown>)[k] = v === ABSENT ? undefined : v === 1;
        }
      } else if (kind === K_STR) {
        const b = strBase[j];
        if (b < 0) continue;
        const table = this.table;
        for (let i = 0; i < n; i++) {
          const v = str[b + i];
          (out[i] as unknown as Record<string, unknown>)[k] = v === 0xffff ? undefined : table[v];
        }
      }
    }
    if (carry) for (let i = 0; i < n; i++) if (kept[i]) carry.restore(out[i], i);
    for (const [i, j, v] of p.other) (out[i] as unknown as Record<string, unknown>)[keys[j]] = v;
    if (this.pool.size > n) for (const id of this.pool.keys()) if (!seen.has(id)) this.pool.delete(id);
    return out;
  }
  private numBase: number[] = [];
  private strBase: number[] = [];
  private kept = new Uint8Array(0);
}

/** Buffers to transfer (zero-copy) when posting a packet; shared ones are not transferred. */
export function columnBuffers(p: ColumnPacket): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const b of [p.num.buffer, p.str.buffer]) if (b instanceof ArrayBuffer && !out.includes(b)) out.push(b);
  return out;
}
