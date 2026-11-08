/**
 * Uniform-grid spatial hash with linked-list buckets in flat typed arrays.
 * Rebuilt every tick (O(n)); queries visit only nearby cells.
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
  }

  clear(): void {
    this.head.fill(-1);
    this.count = 0;
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
  }

  /** Visit items within radius r of (x, y). Return true from cb to stop early. */
  query(x: number, y: number, r: number, cb: (item: number, d2: number) => boolean | void): void {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.head[cy * this.w + cx];
        while (i !== -1) {
          const dx = this.xs[i] - x;
          const dy = this.ys[i] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && cb(this.items[i], d2)) return;
          i = this.next[i];
        }
      }
  }

  /**
   * `query` over a list's entries in `space` (ants: the hash holds their index; one that has left the space since the
   * hash was built is skipped) — the callback gets the entry itself, with no closure in between (performance v3: the
   * same items in the same order as `query` with that filter).
   */
  queryIn<T extends { space: number }>(list: readonly T[], space: number, x: number, y: number, r: number, cb: (o: T, d2: number) => boolean | void): void {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const xs = this.xs;
    const ys = this.ys;
    const items = this.items;
    const next = this.next;
    const head = this.head;
    const w = this.w;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = head[cy * w + cx];
        while (i !== -1) {
          const dx = xs[i] - x;
          const dy = ys[i] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            const o = list[items[i]];
            if (o && o.space === space && cb(o, d2)) return;
          }
          i = next[i];
        }
      }
  }

  /** `queryIn`, the callback getting the entry's index in the list. */
  queryIdxIn<T extends { space: number }>(list: readonly T[], space: number, x: number, y: number, r: number, cb: (i: number, d2: number) => boolean | void): void {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const xs = this.xs;
    const ys = this.ys;
    const items = this.items;
    const next = this.next;
    const head = this.head;
    const w = this.w;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = head[cy * w + cx];
        while (i !== -1) {
          const dx = xs[i] - x;
          const dy = ys[i] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            const k = items[i];
            const o = list[k];
            if (o && o.space === space && cb(k, d2)) return;
          }
          i = next[i];
        }
      }
  }

  /** `queryOthers` over a list's entries in `space` (see `queryIn`). */
  queryOthersIn<T extends { space: number }>(list: readonly T[], space: number, x: number, y: number, r: number, skip: number, cb: (o: T, d2: number) => boolean | void): void {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const tags = this.tags;
    const xs = this.xs;
    const ys = this.ys;
    const items = this.items;
    const next = this.next;
    const head = this.head;
    const w = this.w;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = head[cy * w + cx];
        while (i !== -1) {
          if (tags[i] !== skip) {
            const dx = xs[i] - x;
            const dy = ys[i] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= r2) {
              const o = list[items[i]];
              if (o && o.space === space && cb(o, d2)) return;
            }
          }
          i = next[i];
        }
      }
  }

  /** Like `query`, but skips items tagged `skip` before measuring them (ants: your own team). */
  queryOthers(x: number, y: number, r: number, skip: number, cb: (item: number, d2: number) => boolean | void): void {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c) + 1);
    const x1 = Math.min(this.w - 1, Math.floor((x + r) / c) + 1);
    const y0 = Math.max(0, Math.floor((y - r) / c) + 1);
    const y1 = Math.min(this.h - 1, Math.floor((y + r) / c) + 1);
    const r2 = r * r;
    const tags = this.tags;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.head[cy * this.w + cx];
        while (i !== -1) {
          if (tags[i] !== skip) {
            const dx = this.xs[i] - x;
            const dy = this.ys[i] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && cb(this.items[i], d2)) return;
          }
          i = this.next[i];
        }
      }
  }
}
