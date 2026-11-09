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

/** Ring size of the bucket queue: one more than the largest step (two cells' costs of at most 64 each). */
const BUCKETS = 129;

/**
 * Bucket queue for full field builds (performance v4): entries at whole-unit distances, a ring of `BUCKETS` growable
 * stacks; every waiting entry is within one step of the one being settled, so the ring never wraps onto itself.
 */
class FlowBuckets {
  items: Int32Array[] = Array.from({ length: BUCKETS }, () => new Int32Array(64));
  count = new Int32Array(BUCKETS);
  pending = 0;

  clear(): void {
    this.count.fill(0);
    this.pending = 0;
  }

  push(k: number, u: number): void {
    const bi = u % BUCKETS;
    let a = this.items[bi];
    const c = this.count[bi];
    if (c === a.length) {
      const na = new Int32Array(a.length * 2);
      na.set(a);
      this.items[bi] = a = na;
    }
    a[c] = k;
    this.count[bi] = c + 1;
    this.pending++;
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
  /** the world tick it was last used in (a field used this tick is in use: not evicted while the cache can grow) */
  usedTick: number;
  /** the target function last given (for the audit) */
  src: () => number[];
}

/** Most nest fields kept per underground map (they are recomputed exactly when needed again). */
const MAX_FIELDS = 64;
/**
 * The cache may grow past MAX_FIELDS while every field in it is in use on the same tick (performance v4: a big nest
 * with a hundred ants resting in it can need ~70 fields at once; at 64 the least-recently-used rule threw out the very
 * fields the next ants needed, and every tick rebuilt 60–70 of them): up to this many bytes of fields, then
 * least-recently-used again. Fields idle for SHRINK_TICKS are dropped back down to MAX_FIELDS. Only speed changes: a
 * field is a pure function of the state.
 */
const MAX_FIELD_BYTES = 32 * 1048576;
const SHRINK_TICKS = 100;

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
      f.usedTick = this.tick;
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
      nf = { dist: new Float32Array(g.w * g.h), targets: t, airSeen: 0, extra, costStamp: this.costStamp, used: this.clock, usedTick: this.tick, src: targets };
      this.fields.set(key, nf);
    }
    nf.targets = t;
    nf.src = targets;
    nf.extra = extra;
    nf.costStamp = this.costStamp;
    nf.used = this.clock;
    nf.usedTick = this.tick;
    this.build(nf, air);
    return nf.dist;
  }

  /** The world's tick (World.step sets it): fields used on it are in use. */
  tick = 0;

  /** Called once a tick (World.step): back down to MAX_FIELDS once the extra fields have been idle a while. */
  newTick(tick: number): void {
    this.tick = tick;
    if (this.fields.size <= MAX_FIELDS || tick % SHRINK_TICKS !== 0) return;
    for (const [k, f] of this.fields) {
      if (this.fields.size <= MAX_FIELDS) break;
      if (tick - f.usedTick > SHRINK_TICKS) this.fields.delete(k);
    }
  }

  /** Make room for one more field: the least recently used one not in use this tick, else (over the byte budget) the least recently used. */
  private evict(): void {
    let oldest = '';
    let ou = Infinity;
    let idle = '';
    let iu = Infinity;
    for (const [k, f] of this.fields) {
      if (f.used < ou) {
        ou = f.used;
        oldest = k;
      }
      if (f.usedTick !== this.tick && f.used < iu) {
        iu = f.used;
        idle = k;
      }
    }
    if (idle) {
      this.fields.delete(idle);
      return;
    }
    // every field is in use this tick: grow, up to the byte budget
    if ((this.fields.size + 1) * this.grid.w * this.grid.h * 4 <= MAX_FIELD_BYTES) return;
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
    const b = this.buckets;
    b.clear();
    for (let i = 0; i < f.targets.length; i++) {
      const k = f.targets[i];
      dist[k] = 0;
      b.push(k, 0);
    }
    f.airSeen = air;
    this.stats.full++;
    this.settleBuckets(dist);
  }

  /** the bucket queue of full builds (performance v4) */
  private buckets = new FlowBuckets();

  /**
   * Dijkstra from targets all at distance 0, on a bucket queue (performance v4, CHANGE_PLAN §34): a step costs
   * (c₁ + c₂) / 32 with the cell costs whole numbers 1–64, so every distance is a whole number of 1/32 units and the
   * entries waiting are never more than one step (≤ 128 units) apart — a ring of 129 buckets keeps them in order with
   * no heap. Shortest distances are unique whatever the order cells are settled in, so the field is identical to the
   * heap's (`settle`), bit for bit.
   */
  private settleBuckets(dist: Float32Array): void {
    const g = this.grid;
    const soil = g.soil;
    const cost = this.cost16;
    const q = this.buckets;
    const W = g.w;
    const n = dist.length;
    let settled = 0;
    let u = 0;
    while (q.pending > 0) {
      const bi = u % BUCKETS;
      let cnt = q.count[bi];
      const items = q.items[bi];
      while (cnt > 0) {
        const k = items[--cnt];
        q.count[bi] = cnt;
        q.pending--;
        if (dist[k] * 32 !== u) continue; // stale entry (a shorter way was found)
        settled++;
        const x = k % W;
        const ck = cost ? cost[k] : 16;
        if (x > 0) {
          const m = k - 1;
          if (soil[m] === 0) {
            const nu = u + ck + (cost ? cost[m] : 16);
            if (nu < dist[m] * 32) {
              dist[m] = nu / 32;
              q.push(m, nu);
            }
          }
        }
        if (x < W - 1) {
          const m = k + 1;
          if (soil[m] === 0) {
            const nu = u + ck + (cost ? cost[m] : 16);
            if (nu < dist[m] * 32) {
              dist[m] = nu / 32;
              q.push(m, nu);
            }
          }
        }
        if (k >= W) {
          const m = k - W;
          if (soil[m] === 0) {
            const nu = u + ck + (cost ? cost[m] : 16);
            if (nu < dist[m] * 32) {
              dist[m] = nu / 32;
              q.push(m, nu);
            }
          }
        }
        if (k + W < n) {
          const m = k + W;
          if (soil[m] === 0) {
            const nu = u + ck + (cost ? cost[m] : 16);
            if (nu < dist[m] * 32) {
              dist[m] = nu / 32;
              q.push(m, nu);
            }
          }
        }
        cnt = q.count[bi];
      }
      u++;
    }
    this.stats.settled += settled;
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

/** Most surface fields kept at once (least recently used dropped; a field rebuilt later is identical). */
export const SURFACE_FIELD_CAP = 64;

export class SurfaceFlow {
  readonly cell = 8;
  readonly w: number;
  readonly h: number;
  passable: Uint8Array;
  /**
   * Steps between neighbouring cells that cross an obstacle finer than a cell (a twig, a pebble between two open
   * cell centres — user 2026-11-01: ants walk round obstacles): per cell, bit 0 east, 1 south, 2 south-east,
   * 3 south-west blocked. Without it a field would lead straight into a thin twig the coarse grid did not see.
   */
  edges: Uint8Array;
  /**
   * Authored maps: no diagonal step between two blocked cells (walls and shores are real edges there),
   * and a target in water starts from the nearest walkable cell. The procedural styles keep the old rule.
   */
  readonly strict: boolean;
  private builtFor = -1;
  private fields = new Map<string, { stamp: number; dist: Float32Array; used: number }>();
  /** (performance v3) a use counter: the least recently used field is the one with the lowest `used` — the order the
   * map kept before by being re-inserted on every look-up, without changing it on every look-up */
  private clock = 0;
  private heap = new FlowHeap();

  constructor(public terrain: Terrain) {
    this.w = Math.ceil(terrain.width / this.cell) + 1;
    this.h = Math.ceil(terrain.depth / this.cell) + 1;
    this.passable = new Uint8Array(this.w * this.h);
    this.edges = new Uint8Array(this.w * this.h);
    this.strict = !!terrain.layout;
    this.rebuildPassable();
  }

  /** Nearest walkable cell to cell (i, j) within r cells (fixed ring order), or −1. */
  private nearestCell(i: number, j: number, r = 12): number {
    for (let k = 0; k <= r; k++)
      for (let dj = -k; dj <= k; dj++)
        for (let di = -k; di <= k; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== k) continue;
          const x = i + di;
          const y = j + dj;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          if (this.passable[y * this.w + x]) return y * this.w + x;
        }
    return -1;
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
    // the steps between cells, sampled on the terrain's own grid along the straight line between the two points
    const C = this.cell;
    const n = Math.max(2, Math.ceil((C * 1.42) / Math.max(1, t.res)));
    const DIRS = [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
    ];
    this.edges.fill(0);
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const x0 = Math.min(t.width, i * C);
        const y0 = Math.min(t.depth, j * C);
        let bits = 0;
        for (let b = 0; b < 4; b++) {
          const ii = i + DIRS[b][0];
          const jj = j + DIRS[b][1];
          if (ii < 0 || jj < 0 || ii >= this.w || jj >= this.h) continue;
          const x1 = Math.min(t.width, ii * C);
          const y1 = Math.min(t.depth, jj * C);
          // (solid obstacles only: where a field's cells cut the corner of a puddle, the trail crosses that water —
          // army ants bridge it — as before)
          for (let s = 1; s < n; s++) {
            const u = s / n;
            if (t.isBlocked(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u)) {
              bits |= 1 << b;
              break;
            }
          }
        }
        this.edges[j * this.w + i] = bits;
      }
    this.fields.clear();
  }

  /** Is the straight way from (x0, y0) to (x1, y1) free of solid obstacles on the terrain's own grid (water as before)? */
  private clearTo(x0: number, y0: number, x1: number, y1: number): boolean {
    const t = this.terrain;
    const n = Math.max(2, Math.ceil(dhypot(x1 - x0, y1 - y0) / Math.max(1, t.res * 0.75)));
    for (let s = 1; s <= n; s++) {
      const u = s / n;
      const x = Math.min(t.width, Math.max(0, x0 + (x1 - x0) * u));
      const y = Math.min(t.depth, Math.max(0, y0 + (y1 - y0) * u));
      if (t.isBlocked(x, y)) return false;
    }
    return true;
  }

  /** May one step from cell (x, y) to its neighbour (x + dx, y + dy), both in the grid? */
  private stepOk(x: number, y: number, dx: number, dy: number): boolean {
    // each step is stored once, from the cell whose neighbour lies east, south, south-east or south-west
    if (dy < 0 || (dy === 0 && dx < 0)) {
      x += dx;
      y += dy;
      dx = -dx;
      dy = -dy;
    }
    const b = dy === 0 ? 0 : dx === 0 ? 1 : dx > 0 ? 2 : 3;
    return (this.edges[y * this.w + x] & (1 << b)) === 0;
  }

  /** Dijkstra field to target points (mm). Cached under key with a stamp. */
  field(key: string, stamp: number, targets: Array<{ x: number; y: number }>): Float32Array {
    this.rebuildPassable();
    const f = this.fields.get(key);
    if (f) {
      f.used = ++this.clock;
      if (f.stamp === stamp) return f.dist;
    }
    const dist = f ? f.dist : new Float32Array(this.w * this.h);
    dist.fill(Infinity);
    const heap = this.heap;
    heap.clear();
    const strict = this.strict;
    for (const p of targets) {
      const i = Math.round(p.x / this.cell);
      const j = Math.round(p.y / this.cell);
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      let k = j * this.w + i;
      if (strict && !this.passable[k]) {
        k = this.nearestCell(i, j);
        if (k < 0) continue;
      }
      dist[k] = 0;
      heap.push(k, 0);
    }
    const W = this.w;
    const P = this.passable;
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
          if (!P[n]) continue;
          // no squeezing diagonally between two blocked cells
          if (strict && dx && dy && (!P[y * W + xx] || !P[yy * W + x])) continue;
          if (!this.stepOk(x, y, dx, dy)) continue;
          const nd = d + (dx && dy ? 1.414 : 1);
          if (nd < dist[n]) {
            dist[n] = nd;
            heap.push(n, nd);
          }
        }
    }
    if (f) f.stamp = stamp;
    else {
      this.fields.set(key, { stamp, dist, used: ++this.clock });
      if (this.fields.size > SURFACE_FIELD_CAP) {
        // the least recently used goes
        let oldest = '';
        let ou = Infinity;
        for (const [k, e] of this.fields)
          if (e.used < ou) {
            ou = e.used;
            oldest = k;
          }
        this.fields.delete(oldest);
      }
    }
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
    // the best neighbour the ant can walk straight to from where it actually is (an obstacle finer than a cell — a
    // twig's end — can lie between it and the cell the field leads to; user 2026-11-01: ants walk round obstacles),
    // else the best one regardless (skirting takes it round)
    let best = d0;
    let bx = 0;
    let by = 0;
    let bestAny = d0;
    let ax = 0;
    let ay = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = i + dx;
        const yy = j + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= this.h) continue;
        if (this.strict && dx && dy && (!this.passable[j * W + xx] || !this.passable[yy * W + i])) continue;
        if (!this.stepOk(i, j, dx, dy)) continue;
        const dd = dist[yy * W + xx];
        if (dd < bestAny) {
          bestAny = dd;
          ax = dx;
          ay = dy;
        }
        if (dd < best && this.clearTo(x, y, (i + dx) * this.cell, (j + dy) * this.cell)) {
          best = dd;
          bx = dx;
          by = dy;
        }
      }
    if (best === d0) {
      best = bestAny;
      bx = ax;
      by = ay;
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
