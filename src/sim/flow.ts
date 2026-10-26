import { NestGrid } from '../world/nestGrid';
import { Terrain } from '../world/terrain';
import { dhypot } from './dmath';

/**
 * Navigation fields.
 *
 * - **Nest**: shortest-path distance over excavated cells to a set of target
 *   cells, weighted by the colony's tiles (highways fast, chambers slow).
 *   Fields are shared per *destination* (a tile type, the entrances, the dig
 *   frontier, a hex) and cached under a key.
 *
 *   Nest cells only ever change from soil to air while playing, so when the
 *   tunnels grow a field is **extended** from the newly dug cells instead of
 *   being recomputed (performance brief, Part A). Step costs are multiples of
 *   1/32 and distances are stored exactly (float32 holds them without
 *   rounding), so the extended field is bit-identical to a fresh one. A field
 *   is therefore always a pure function of the current state, whatever its
 *   history: a client that rejoins from a snapshot computes the same paths
 *   (multiplayer brief, Part B).
 *
 * - **Surface**: Dijkstra over a coarse passability grid (water, obstacles).
 *   The terrain does not change during play, so surface fields depend only on
 *   their targets.
 */

/** Allocation-free binary min-heap of (cell, priority) with lazy deletion. */
class FlowHeap {
  idx = new Int32Array(4096);
  pri = new Float64Array(4096);
  size = 0;

  clear(): void {
    this.size = 0;
  }

  push(i: number, p: number): void {
    if (this.size === this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2);
      ni.set(this.idx);
      const np = new Float64Array(this.pri.length * 2);
      np.set(this.pri);
      this.idx = ni;
      this.pri = np;
    }
    const a = this.idx;
    const b = this.pri;
    let n = this.size++;
    while (n > 0) {
      const par = (n - 1) >> 1;
      if (b[par] <= p) break;
      a[n] = a[par];
      b[n] = b[par];
      n = par;
    }
    a[n] = i;
    b[n] = p;
  }

  /** Pop the minimum; its priority is left in `top`. */
  top = 0;
  pop(): number {
    const a = this.idx;
    const b = this.pri;
    const ri = a[0];
    this.top = b[0];
    const n0 = --this.size;
    if (n0 > 0) {
      const li = a[n0];
      const lp = b[n0];
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        if (l >= n0) break;
        const r = l + 1;
        const m = r < n0 && b[r] < b[l] ? r : l;
        if (b[m] >= lp) break;
        a[n] = a[m];
        b[n] = b[m];
        n = m;
      }
      a[n] = li;
      b[n] = lp;
    }
    return ri;
  }
}

interface NestField {
  dist: Float32Array;
  /** normalized targets (air cells, sorted, unique) the field was built for */
  targets: Int32Array;
  /** grid.airCount when last brought up to date */
  airSeen: number;
  extra: number;
  costStamp: number;
  /** last use (for evicting the least-recently-used field) */
  used: number;
  /** the target function last given (for the audit) */
  src: () => number[];
}

/** Most nest fields kept per underground map (they are recomputed exactly when needed again). */
const MAX_FIELDS = 64;

export class NestFlow {
  private fields = new Map<string, NestField>();
  private heap = new FlowHeap();
  /** per-cell step cost ×16 (16 = bare floor); null = all floor */
  private cost16: Uint16Array | null = null;
  private costStamp = 0;
  private clock = 0;
  /** profiling: full builds, extensions, cells settled */
  stats = { full: 0, extend: 0, settled: 0 };

  constructor(public grid: NestGrid) {}

  /** Install per-cell costs (rebuilt when the colony's tiles change). Costs are quantized to 1/16 so paths add up exactly. */
  setCosts(cost: Float32Array, stamp: number): void {
    if (stamp === this.costStamp && this.cost16) return;
    const c = this.cost16 && this.cost16.length === cost.length ? this.cost16 : new Uint16Array(cost.length);
    for (let k = 0; k < cost.length; k++) c[k] = Math.max(1, Math.min(64, Math.round(cost[k] * 16)));
    this.cost16 = c;
    this.costStamp = stamp;
  }

  get costVersion(): number {
    return this.costStamp;
  }

  invalidate(prefix?: string): void {
    if (!prefix) this.fields.clear();
    else for (const k of [...this.fields.keys()]) if (k.startsWith(prefix)) this.fields.delete(k);
  }

  /** Number of cached fields (profiling). */
  get size(): number {
    return this.fields.size;
  }

  /**
   * Distance field (in floor cells, weighted) to target cells. `extra` must
   * change whenever the target set can change without any cell being dug
   * (tile or designation changes); digging is tracked by the grid itself.
   */
  field(key: string, targets: () => number[], extra = 0): Float32Array {
    const g = this.grid;
    const f = this.fields.get(key);
    const air = g.airCount;
    this.clock++;
    if (f && f.extra === extra && f.costStamp === this.costStamp) {
      f.used = this.clock;
      f.src = targets;
      if (f.airSeen === air) return f.dist;
      const t = this.normTargets(targets());
      if (sameCells(t, f.targets)) this.extend(f, air);
      else {
        f.targets = t;
        this.build(f, air);
      }
      return f.dist;
    }
    const t = this.normTargets(targets());
    let nf = f;
    if (!nf) {
      if (this.fields.size >= MAX_FIELDS) this.evict();
      nf = { dist: new Float32Array(g.w * g.h), targets: t, airSeen: 0, extra, costStamp: this.costStamp, used: this.clock, src: targets };
      this.fields.set(key, nf);
    }
    nf.targets = t;
    nf.src = targets;
    nf.extra = extra;
    nf.costStamp = this.costStamp;
    nf.used = this.clock;
    this.build(nf, air);
    return nf.dist;
  }

  private evict(): void {
    let oldest = '';
    let ou = Infinity;
    for (const [k, f] of this.fields)
      if (f.used < ou) {
        ou = f.used;
        oldest = k;
      }
    this.fields.delete(oldest);
  }

  private normTargets(raw: number[]): Int32Array {
    const g = this.grid;
    const n = g.w * g.h;
    const out: number[] = [];
    for (const k of raw) if (k >= 0 && k < n && g.isAirIdx(k)) out.push(k);
    out.sort((a, b) => a - b);
    let m = 0;
    for (let i = 0; i < out.length; i++) if (i === 0 || out[i] !== out[i - 1]) out[m++] = out[i];
    return Int32Array.from(out.slice(0, m));
  }

  /** Fresh field from the targets. */
  private build(f: NestField, air: number): void {
    const dist = f.dist;
    dist.fill(Infinity);
    const h = this.heap;
    h.clear();
    for (let i = 0; i < f.targets.length; i++) {
      const k = f.targets[i];
      dist[k] = 0;
      h.push(k, 0);
    }
    f.airSeen = air;
    this.stats.full++;
    this.settle(dist);
  }

  /**
   * Bring a field up to date after cells were dug: each new air cell takes
   * its distance from its neighbours, and improvements spread outwards.
   * Gives exactly the distances a fresh build would.
   */
  private extend(f: NestField, air: number): void {
    const g = this.grid;
    const dist = f.dist;
    const log = g.airLog;
    const W = g.w;
    const n = dist.length;
    const cost = this.cost16;
    const h = this.heap;
    h.clear();
    for (let i = f.airSeen; i < air; i++) {
      const k = log[i];
      const x = k % W;
      const ck = cost ? cost[k] : 16;
      let best = dist[k];
      if (x > 0 && g.isAirIdx(k - 1)) best = Math.min(best, dist[k - 1] + (ck + (cost ? cost[k - 1] : 16)) / 32);
      if (x < W - 1 && g.isAirIdx(k + 1)) best = Math.min(best, dist[k + 1] + (ck + (cost ? cost[k + 1] : 16)) / 32);
      if (k >= W && g.isAirIdx(k - W)) best = Math.min(best, dist[k - W] + (ck + (cost ? cost[k - W] : 16)) / 32);
      if (k + W < n && g.isAirIdx(k + W)) best = Math.min(best, dist[k + W] + (ck + (cost ? cost[k + W] : 16)) / 32);
      if (best < dist[k]) {
        dist[k] = best;
        h.push(k, best);
      }
    }
    f.airSeen = air;
    this.stats.extend++;
    this.settle(dist);
  }

  /** Dijkstra from the heap's contents over air cells. Steps cost the mean of the two cells' costs. */
  private settle(dist: Float32Array): void {
    const g = this.grid;
    const soil = g.soil;
    const cost = this.cost16;
    const h = this.heap;
    const W = g.w;
    const n = dist.length;
    let settled = 0;
    while (h.size) {
      const k = h.pop();
      const d0 = h.top;
      if (d0 > dist[k]) continue; // stale entry
      settled++;
      const x = k % W;
      const ck = cost ? cost[k] : 16;
      // four neighbours, unrolled (no closures: this loop is the hottest in the simulation)
      if (x > 0) {
        const m = k - 1;
        if (soil[m] === 0) {
          const nd = d0 + (ck + (cost ? cost[m] : 16)) / 32;
          if (nd < dist[m]) {
            dist[m] = nd;
            h.push(m, nd);
          }
        }
      }
      if (x < W - 1) {
        const m = k + 1;
        if (soil[m] === 0) {
          const nd = d0 + (ck + (cost ? cost[m] : 16)) / 32;
          if (nd < dist[m]) {
            dist[m] = nd;
            h.push(m, nd);
          }
        }
      }
      if (k >= W) {
        const m = k - W;
        if (soil[m] === 0) {
          const nd = d0 + (ck + (cost ? cost[m] : 16)) / 32;
          if (nd < dist[m]) {
            dist[m] = nd;
            h.push(m, nd);
          }
        }
      }
      if (k + W < n) {
        const m = k + W;
        if (soil[m] === 0) {
          const nd = d0 + (ck + (cost ? cost[m] : 16)) / 32;
          if (nd < dist[m]) {
            dist[m] = nd;
            h.push(m, nd);
          }
        }
      }
    }
    this.stats.settled += settled;
  }

  /**
   * Debug check (determinism test): every cached field that counts as up to
   * date must equal a fresh build. Returns the keys that differ.
   */
  audit(): string[] {
    const bad: string[] = [];
    for (const [key, f] of this.fields) {
      if (f.airSeen !== this.grid.airCount || f.costStamp !== this.costStamp) continue;
      const copy: NestField = { ...f, dist: new Float32Array(f.dist.length), targets: this.normTargets(f.src()) };
      const st = { ...this.stats };
      this.build(copy, this.grid.airCount);
      this.stats = st;
      for (let k = 0; k < copy.dist.length; k++)
        if (copy.dist[k] !== f.dist[k]) {
          bad.push(key);
          break;
        }
    }
    return bad;
  }

  /** Distance (cells) at a position in mm, Infinity if unreachable/solid. */
  distAt(dist: Float32Array, x: number, y: number): number {
    const cell = this.grid.cell;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    if (!this.grid.inside(cx, cy)) return Infinity;
    return dist[cy * this.grid.w + cx];
  }

  /**
   * Next waypoint (mm) descending the field from (x, y). Returns null if
   * already at a target or unreachable.
   */
  next(dist: Float32Array, x: number, y: number, out: { x: number; y: number }): boolean {
    const g = this.grid;
    const NEST_CELL = g.cell;
    let cx = Math.floor(x / NEST_CELL);
    let cy = Math.floor(y / NEST_CELL);
    if (!g.inside(cx, cy)) {
      cx = Math.min(g.w - 1, Math.max(0, cx));
      cy = Math.min(g.h - 1, Math.max(0, cy));
    }
    const W = g.w;
    let k = cy * W + cx;
    if (!g.isAirIdx(k)) {
      // Stuck in soil (just after a cell was filled / numerical drift): find nearest air.
      let best = -1;
      let bd = Infinity;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = cx + dx;
          const yy = cy + dy;
          if (!g.inside(xx, yy)) continue;
          const kk = yy * W + xx;
          if (g.isAirIdx(kk) && dist[kk] < bd) {
            bd = dist[kk];
            best = kk;
          }
        }
      if (best < 0) return false;
      out.x = ((best % W) + 0.5) * NEST_CELL;
      out.y = (Math.floor(best / W) + 0.5) * NEST_CELL;
      return true;
    }
    const d0 = dist[k];
    if (d0 === 0 || d0 === Infinity) return false;
    // Look ahead up to 3 cells along the gradient for smoother paths.
    let tx = cx;
    let ty = cy;
    for (let step = 0; step < 3; step++) {
      let bx = tx;
      let by = ty;
      let bd = dist[ty * W + tx];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = tx + dx;
          const yy = ty + dy;
          if (!g.inside(xx, yy)) continue;
          const kk = yy * W + xx;
          if (!g.isAirIdx(kk)) continue;
          if (dx && dy && (!g.isAir(tx + dx, ty) || !g.isAir(tx, ty + dy))) continue;
          const dd = dist[kk] + (dx && dy ? 0.41 : 0);
          if (dd < bd) {
            bd = dd;
            bx = xx;
            by = yy;
          }
        }
      if (bx === tx && by === ty) break;
      tx = bx;
      ty = by;
      if (dist[ty * W + tx] === 0) break;
    }
    out.x = (tx + 0.5) * NEST_CELL;
    out.y = (ty + 0.5) * NEST_CELL;
    return true;
  }
}

export class SurfaceFlow {
  readonly cell = 8;
  readonly w: number;
  readonly h: number;
  passable: Uint8Array;
  private builtFor = -1;
  private fields = new Map<string, { stamp: number; dist: Float32Array }>();
  private heap = new FlowHeap();

  constructor(public terrain: Terrain) {
    this.w = Math.ceil(terrain.width / this.cell) + 1;
    this.h = Math.ceil(terrain.depth / this.cell) + 1;
    this.passable = new Uint8Array(this.w * this.h);
    this.rebuildPassable();
  }

  rebuildPassable(): void {
    const t = this.terrain;
    const stamp = t.waterVersion * 100000 + t.version;
    if (stamp === this.builtFor) return;
    this.builtFor = stamp;
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const x = Math.min(t.width, i * this.cell);
        const y = Math.min(t.depth, j * this.cell);
        this.passable[j * this.w + i] = t.passable(x, y) ? 1 : 0;
      }
    this.fields.clear();
  }

  /** Dijkstra field to target points (mm). Cached under key with a stamp. */
  field(key: string, stamp: number, targets: Array<{ x: number; y: number }>): Float32Array {
    this.rebuildPassable();
    const f = this.fields.get(key);
    if (f && f.stamp === stamp) return f.dist;
    const dist = f ? f.dist : new Float32Array(this.w * this.h);
    dist.fill(Infinity);
    const heap = this.heap;
    heap.clear();
    for (const p of targets) {
      const i = Math.round(p.x / this.cell);
      const j = Math.round(p.y / this.cell);
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const k = j * this.w + i;
      dist[k] = 0;
      heap.push(k, 0);
    }
    const W = this.w;
    while (heap.size) {
      const k = heap.pop();
      // stale entry. `dist` is Float32 and the heap's priorities Float64: compare at float32 precision, or a live entry
      // whose distance rounded down looks stale, its cell is never expanded and the field gets invisible walls
      // (routes made long detours round them)
      if (Math.fround(heap.top) > dist[k]) continue;
      const d = dist[k];
      const x = k % W;
      const y = (k - x) / W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= this.h) continue;
          const n = yy * W + xx;
          if (!this.passable[n]) continue;
          const nd = d + (dx && dy ? 1.414 : 1);
          if (nd < dist[n]) {
            dist[n] = nd;
            heap.push(n, nd);
          }
        }
    }
    if (f) f.stamp = stamp;
    else this.fields.set(key, { stamp, dist });
    return dist;
  }

  distAt(dist: Float32Array, x: number, y: number): number {
    const i = Math.round(x / this.cell);
    const j = Math.round(y / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return Infinity;
    return dist[j * this.w + i] * this.cell;
  }

  /** Steepest-descent direction (unit vector) at a point; false if none. */
  dir(dist: Float32Array, x: number, y: number, out: { x: number; y: number }): boolean {
    const fi = x / this.cell;
    const fj = y / this.cell;
    const i = Math.round(fi);
    const j = Math.round(fj);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return false;
    const W = this.w;
    const d0 = dist[j * W + i];
    let best = d0;
    let bx = 0;
    let by = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = i + dx;
        const yy = j + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= this.h) continue;
        const dd = dist[yy * W + xx];
        if (dd < best) {
          best = dd;
          bx = dx;
          by = dy;
        }
      }
    if (best === d0 || best === Infinity) return false;
    // aim at the neighbour cell centre from the actual position (smooth heading)
    const tx = (i + bx) * this.cell - x;
    const ty = (j + by) * this.cell - y;
    const l = dhypot(tx, ty) || 1;
    out.x = tx / l;
    out.y = ty / l;
    return true;
  }
}

function sameCells(a: Int32Array, b: Int32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
