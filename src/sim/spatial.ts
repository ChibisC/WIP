/**
 * Uniform-grid spatial hash. Rebuilt every tick (O(n)); queries visit only nearby cells.
 *
 * Items go in as linked lists per cell (each new item at its cell's head). Before the first query after inserts the
 * lists are packed cell by cell into flat arrays, in exactly the order the lists give (the newest first), so a query
 * reads its cells' items from consecutive memory instead of chasing links over the whole array (performance v3: the
 * same items in the same order — the same results — at a fraction of the cache misses in a crowd).
 */
export class SpatialHash {
  readonly cell: number;
  readonly w: number;
  readonly h: number;
  private head: Int32Array;
  private next: Int32Array;
  private items: Int32Array;
  private xs: Float32Array;
  private ys: Float32Array;
  /** a small integer per item (ants: their team) so queries can skip a whole side cheaply */
  private tags: Int32Array;
  count = 0;
  // the packed layout: cell k's items are pItems[start[k] .. start[k + 1]) (with their positions and tags)
  private start: Int32Array;
  private pItems: Int32Array;
  private pXs: Float32Array;
  private pYs: Float32Array;
  private pTags: Int32Array;
  private packed = true;

  constructor(width: number, height: number, cell = 8, capacity = 4096) {
    this.cell = cell;
    this.w = Math.max(1, Math.ceil(width / cell) + 2);
    this.h = Math.max(1, Math.ceil(height / cell) + 2);
    this.head = new Int32Array(this.w * this.h).fill(-1);
    this.next = new Int32Array(capacity);
    this.items = new Int32Array(capacity);
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.tags = new Int32Array(capacity);
    this.start = new Int32Array(this.w * this.h + 1);
    this.pItems = new Int32Array(capacity);
    this.pXs = new Float32Array(capacity);
    this.pYs = new Float32Array(capacity);
    this.pTags = new Int32Array(capacity);
  }

  /** The hash's packed arrays, for a hot loop that walks the cells itself (separation.ts; read only). */
  raw(): { start: Int32Array; items: Int32Array; xs: Float32Array; ys: Float32Array; w: number; h: number; cell: number } {
    if (!this.packed) this.pack();
    return { start: this.start, items: this.pItems, xs: this.pXs, ys: this.pYs, w: this.w, h: this.h, cell: this.cell };
  }

  clear(): void {
    this.head.fill(-1);
    this.count = 0;
    this.packed = false;
  }

  private grow(): void {
    const cap = this.next.length * 2;
    const n = new Int32Array(cap);
    n.set(this.next);
    this.next = n;
    const it = new Int32Array(cap);
    it.set(this.items);
    this.items = it;
    const xs = new Float32Array(cap);
    xs.set(this.xs);
    this.xs = xs;
    const ys = new Float32Array(cap);
    ys.set(this.ys);
    this.ys = ys;
    const tg = new Int32Array(cap);
    tg.set(this.tags);
    this.tags = tg;
    this.pItems = new Int32Array(cap);
    this.pXs = new Float32Array(cap);
    this.pYs = new Float32Array(cap);
    this.pTags = new Int32Array(cap);
  }

  private key(x: number, y: number): number {
    let cx = Math.floor(x / this.cell) + 1;
    let cy = Math.floor(y / this.cell) + 1;
    if (cx < 0) cx = 0;
    else if (cx >= this.w) cx = this.w - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.h) cy = this.h - 1;
    return cy * this.w + cx;
  }

  insert(item: number, x: number, y: number, tag = 0): void {
    if (this.count >= this.next.length) this.grow();
    const k = this.key(x, y);
    const i = this.count++;
    this.items[i] = item;
    this.tags[i] = tag;
    this.xs[i] = x;
    this.ys[i] = y;
    this.next[i] = this.head[k];
    this.head[k] = i;
    this.packed = false;
  }

  /** Lay the lists out cell by cell, each in its list's order (newest first). */
  private pack(): void {
    const head = this.head;
    const next = this.next;
    const start = this.start;
    const pi = this.pItems;
    const px = this.pXs;
    const py = this.pYs;
    const pt = this.pTags;
    let n = 0;
    const cells = this.w * this.h;
    for (let k = 0; k < cells; k++) {
      start[k] = n;
      for (let i = head[k]; i !== -1; i = next[i]) {
        pi[n] = this.items[i];
        px[n] = this.xs[i];
        py[n] = this.ys[i];
        pt[n] = this.tags[i];
        n++;
      }
    }
    start[cells] = n;
    this.packed = true;
  }

  /** Visit items within radius r of (x, y). Return true from cb to stop early. */
  query(x: number, y: number, r: number, cb: (item: number, d2: number) => boolean | void): void {
    if (!this.packed) this.pack();
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const start = this.start;
    const xs = this.pXs;
    const ys = this.pYs;
    const items = this.pItems;
    const w = this.w;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * w + cx;
        for (let i = start[k], e = start[k + 1]; i < e; i++) {
          const dx = xs[i] - x;
          const dy = ys[i] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && cb(items[i], d2)) return;
        }
      }
  }

  /**
   * `query` over a list's entries in `space` (ants: the hash holds their index; one that has left the space since the
   * hash was built is skipped) — the callback gets the entry itself, with no closure in between (the same items in the
   * same order as `query` with that filter).
   */
  queryIn<T extends { space: number }>(list: readonly T[], space: number, x: number, y: number, r: number, cb: (o: T, d2: number) => boolean | void): void {
    if (!this.packed) this.pack();
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const start = this.start;
    const xs = this.pXs;
    const ys = this.pYs;
    const items = this.pItems;
    const w = this.w;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * w + cx;
        for (let i = start[k], e = start[k + 1]; i < e; i++) {
          const dx = xs[i] - x;
          const dy = ys[i] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            const o = list[items[i]];
            if (o && o.space === space && cb(o, d2)) return;
          }
        }
      }
  }

  /** `queryIn`, the callback getting the entry's index in the list. */
  queryIdxIn<T extends { space: number }>(list: readonly T[], space: number, x: number, y: number, r: number, cb: (i: number, d2: number) => boolean | void): void {
    if (!this.packed) this.pack();
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const start = this.start;
    const xs = this.pXs;
    const ys = this.pYs;
    const items = this.pItems;
    const w = this.w;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * w + cx;
        for (let i = start[k], e = start[k + 1]; i < e; i++) {
          const dx = xs[i] - x;
          const dy = ys[i] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            const j = items[i];
            const o = list[j];
            if (o && o.space === space && cb(j, d2)) return;
          }
        }
      }
  }

  /** `queryOthers` over a list's entries in `space` (see `queryIn`). */
  queryOthersIn<T extends { space: number }>(list: readonly T[], space: number, x: number, y: number, r: number, skip: number, cb: (o: T, d2: number) => boolean | void): void {
    if (!this.packed) this.pack();
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const start = this.start;
    const tags = this.pTags;
    const xs = this.pXs;
    const ys = this.pYs;
    const items = this.pItems;
    const w = this.w;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * w + cx;
        for (let i = start[k], e = start[k + 1]; i < e; i++) {
          if (tags[i] !== skip) {
            const dx = xs[i] - x;
            const dy = ys[i] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= r2) {
              const o = list[items[i]];
              if (o && o.space === space && cb(o, d2)) return;
            }
          }
        }
      }
  }

  /** Like `query`, but skips items tagged `skip` before measuring them (ants: your own team). */
  queryOthers(x: number, y: number, r: number, skip: number, cb: (item: number, d2: number) => boolean | void): void {
    if (!this.packed) this.pack();
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const start = this.start;
    const tags = this.pTags;
    const xs = this.pXs;
    const ys = this.pYs;
    const items = this.pItems;
    const w = this.w;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * w + cx;
        for (let i = start[k], e = start[k + 1]; i < e; i++) {
          if (tags[i] !== skip) {
            const dx = xs[i] - x;
            const dy = ys[i] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && cb(items[i], d2)) return;
          }
        }
      }
  }
}
