import { Rng, fbm2, valueNoise2 } from '../core/rng';
import { dcos, dhypot, dsin, sq } from '../sim/dmath';

export const NEST_CHUNK = 32;

export const SOIL_AIR = 0;
/** humus: dark, root-filled, soft */
export const SOIL_TOP = 1;
export const SOIL_LOAM = 2;
export const SOIL_CLAY = 3;
export const SOIL_GRAVEL = 4;
export const SOIL_STONE = 255;

/** Excavation work units per hex by soil type (one bite = 1 unit). */
export const HEX_WORK: Record<number, number> = { 1: 10, 2: 14, 3: 20, 4: 26 };

/** Fine raster cells per hex circumradius (keeps the walk raster resolution constant per tile). */
const CELLS_PER_R = 3.5;

export interface NestGridParams {
  cols: number;
  rows: number;
  /** hex circumradius in mm */
  R: number;
  seed: number;
}

/** Raw typed-array state of a nest grid, for binary snapshots (sim/snapshot.ts). */
export interface NestGridSnap extends NestGridParams {
  soil: Uint8Array;
  designated: Uint8Array;
  designatedCount: number;
  hexSoil: Uint8Array;
  hexWork: Float32Array;
  hexTotal: Float32Array;
  hexDesig: Uint8Array;
  hexEntry: Int8Array;
  entrances: number[];
  shafts: number[];
}

export interface NestGridData extends NestGridParams {
  /** dig work per hex when full (older saves rebuild it from the soil) */
  hexTotal?: string;
  soil: string;
  hexSoil: string;
  hexWork: string;
  hexDesig: string;
  hexEntry: string;
  entrances: number[];
  shafts: number[];
}

/** Hex radius for a species: tiles are about three workers wide. */
export function hexRadiusFor(workerLength: number): number {
  return Math.min(11, Math.max(5, workerLength * 1.5));
}

/**
 * The floor plan of one colony's nest: a horizontal plane of soil seen from
 * above, organised as a flat-top honeycomb of hex tiles — the unit of digging
 * and of brood tiles (as in Empires of the Undergrowth). A fine raster mirrors
 * the dug state for rendering, navigation and progressive excavation.
 *
 * Coordinates are mm in the nest plane: x right, y "down the screen" (maps to
 * world z). Entrance hexes hold a ramp up to the surface; shaft sites are
 * hidden spots that become new entrances when dug into.
 */
export class NestGrid {
  readonly cols: number;
  readonly rows: number;
  readonly seed: number;
  /** hex circumradius, flat-to-flat height, column spacing, fine cell size (mm) */
  readonly R: number;
  readonly H: number;
  readonly C: number;
  readonly cell: number;
  /** fine raster size */
  readonly w: number;
  readonly h: number;
  /** plane size in mm */
  readonly widthMm: number;
  readonly depthMm: number;
  /** fine raster: 0 air, 1..4 soil type, 255 stone */
  soil: Uint8Array;
  /** fine raster of designated hexes */
  designated: Uint8Array;
  // ---- hex layer ----
  hexSoil: Uint8Array;
  hexWork: Float32Array;
  hexTotal: Float32Array;
  hexDesig: Uint8Array;
  /** neighbour direction (0..5) digging advances from, −1 none */
  hexEntry: Int8Array;
  /** fine cell indices covered by each hex */
  hexCells: Int32Array[] = [];
  /** fine cell → hex index (−1 outside) */
  cellHex: Int32Array;
  /** entrance ramp hexes (dug) and hidden shaft sites (undug) */
  entrances: number[] = [];
  shafts: number[] = [];
  version = 0;
  dirty = new Set<number>();
  /**
   * Cells dug since the grid was built, in order (cells only ever go from
   * soil to air in play). Flow fields extend themselves from this log.
   */
  airLog = new Int32Array(256);
  airCount = 0;
  /** bumped when designations or hex states change (fields whose targets depend on them) */
  desigVersion = 0;
  /** bumped by every change at all (the simulation worker sends a grid to the renderer when it moves) */
  stateVersion = 0;
  /** designated hexes not yet dug (dig demand) */
  designatedCount = 0;

  constructor(p: NestGridParams) {
    this.cols = p.cols;
    this.rows = p.rows;
    this.seed = p.seed;
    this.R = p.R;
    this.H = Math.sqrt(3) * p.R;
    this.C = 1.5 * p.R;
    this.cell = p.R / CELLS_PER_R;
    this.widthMm = this.C * (this.cols - 1) + 2 * this.R;
    this.depthMm = this.H * (this.rows + 0.5);
    this.w = Math.ceil(this.widthMm / this.cell);
    this.h = Math.ceil(this.depthMm / this.cell);
    const n = this.w * this.h;
    this.soil = new Uint8Array(n);
    this.designated = new Uint8Array(n);
    this.cellHex = new Int32Array(n).fill(-1);
    const nh = this.cols * this.rows;
    this.hexSoil = new Uint8Array(nh);
    this.hexWork = new Float32Array(nh);
    this.hexTotal = new Float32Array(nh);
    this.hexDesig = new Uint8Array(nh);
    this.hexEntry = new Int8Array(nh).fill(-1);
    this.buildRaster();
    this.generate();
  }

  params(): NestGridParams {
    return { cols: this.cols, rows: this.rows, R: this.R, seed: this.seed };
  }

  // ---------------------------------------------------------------- geometry
  hexIndex(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  hexCol(q: number): number {
    return q % this.cols;
  }

  hexRow(q: number): number {
    return Math.floor(q / this.cols);
  }

  /** Hex centre in mm. */
  hexCenter(q: number, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
    const c = q % this.cols;
    const r = Math.floor(q / this.cols);
    out.x = this.R + c * this.C;
    out.y = this.H * 0.5 + r * this.H + (c & 1 ? this.H * 0.5 : 0);
    return out;
  }

  /** Hex containing a point (mm), or −1. */
  hexAt(x: number, y: number): number {
    const c0 = Math.round((x - this.R) / this.C);
    let best = -1;
    let bd = Infinity;
    const p = { x: 0, y: 0 };
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= this.cols) continue;
      const r0 = Math.round((y - this.H * 0.5 - (c & 1 ? this.H * 0.5 : 0)) / this.H);
      for (let r = r0 - 1; r <= r0 + 1; r++) {
        const q = this.hexIndex(c, r);
        if (q < 0) continue;
        this.hexCenter(q, p);
        const d = sq(p.x - x) + sq(p.y - y);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
    }
    if (best >= 0 && bd > this.R * this.R * 1.05) return -1;
    return best;
  }

  /** Six neighbours (flat-top, odd columns shifted down); −1 when outside. Order: NE, SE, S, SW, NW, N. */
  neighbors(q: number): number[] {
    const c = q % this.cols;
    const r = Math.floor(q / this.cols);
    if (c & 1) return [this.hexIndex(c + 1, r), this.hexIndex(c + 1, r + 1), this.hexIndex(c, r + 1), this.hexIndex(c - 1, r + 1), this.hexIndex(c - 1, r), this.hexIndex(c, r - 1)];
    return [this.hexIndex(c + 1, r - 1), this.hexIndex(c + 1, r), this.hexIndex(c, r + 1), this.hexIndex(c - 1, r), this.hexIndex(c - 1, r - 1), this.hexIndex(c, r - 1)];
  }

  /** Midpoint of the edge shared with neighbour direction d (mm). */
  edgeMid(q: number, d: number, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
    this.hexCenter(q, out);
    const ang = [-Math.PI / 6, Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6, (7 * Math.PI) / 6, -Math.PI / 2][d];
    const rr = this.H * 0.5;
    out.x += dcos(ang) * rr;
    out.y += dsin(ang) * rr;
    return out;
  }

  /** Hex distance (steps) between two hexes (offset → cube coordinates). */
  hexDistance(a: number, b: number): number {
    const cube = (q: number) => {
      const c = q % this.cols;
      const r = Math.floor(q / this.cols);
      const x = c;
      const z = r - (c - (c & 1)) / 2;
      return [x, -x - z, z];
    };
    const [ax, ay, az] = cube(a);
    const [bx, by, bz] = cube(b);
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
  }

  /** Is (dx, dy) inside this grid's hexagon centred at the origin. */
  insideHex(dx: number, dy: number, scale = 1): boolean {
    return insideHex(dx, dy, this.R * scale);
  }

  private buildRaster(): void {
    const lists: number[][] = [];
    for (let q = 0; q < this.cols * this.rows; q++) lists.push([]);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const q = this.hexAt((x + 0.5) * this.cell, (y + 0.5) * this.cell);
        if (q >= 0) {
          this.cellHex[y * this.w + x] = q;
          lists[q].push(y * this.w + x);
        }
      }
    this.hexCells = lists.map((l) => Int32Array.from(l));
  }

  /** Patchy soil seen from above: loam with clay lenses, gravel beds, root-rich humus and buried stones. */
  private generate(): void {
    const s = this.seed % 997;
    const rng = new Rng(this.seed * 31 + 7);
    const sc = 1 / this.cell; // noise in mm-space so patterns are scale independent
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const mx = x / sc;
        const my = y / sc;
        let t = SOIL_LOAM;
        if (fbm2(mx / 70, my / 70, 3, s) > 0.6) t = SOIL_CLAY;
        if (fbm2(mx / 55 + 40, my / 55, 3, s + 5) > 0.66) t = SOIL_GRAVEL;
        if (fbm2(mx / 45 - 30, my / 45, 3, s + 9) > 0.64) t = SOIL_TOP;
        this.soil[y * this.w + x] = t;
      }
    const p = { x: 0, y: 0 };
    const counts = [0, 0, 0, 0, 0];
    for (let q = 0; q < this.cols * this.rows; q++) {
      counts.fill(0);
      for (const c of this.hexCells[q]) counts[this.soil[c]]++;
      let t = SOIL_LOAM;
      for (let k = 1; k <= 4; k++) if (counts[k] > counts[t]) t = k;
      // Buried stones: undiggable hexes in loose clusters.
      const stoneN = valueNoise2(this.hexCol(q) * 0.5, this.hexRow(q) * 0.5, s + 77);
      if (stoneN > 0.8 && rng.chance(0.8)) t = SOIL_STONE;
      this.hexSoil[q] = t;
      this.hexTotal[q] = t === SOIL_STONE ? 0 : HEX_WORK[t];
      this.hexWork[q] = this.hexTotal[q];
      if (t === SOIL_STONE) {
        this.hexCenter(q, p);
        const rr = this.R * rng.range(0.75, 1.0);
        for (const c of this.hexCells[q]) {
          const cx = ((c % this.w) + 0.5) * this.cell - p.x;
          const cy = (Math.floor(c / this.w) + 0.5) * this.cell - p.y;
          const n = (valueNoise2(cx * 0.3 + q, cy * 0.3, s) - 0.5) * this.R * 0.4;
          if (dhypot(cx, cy) + n < rr) this.soil[c] = SOIL_STONE;
        }
      }
    }
  }

  /** Clear stone from a hex so it can be dug (used when laying out a starting nest). */
  softenHex(q: number): void {
    if (q < 0 || this.hexSoil[q] !== SOIL_STONE) return;
    this.hexSoil[q] = SOIL_LOAM;
    this.hexTotal[q] = this.hexWork[q] = HEX_WORK[SOIL_LOAM];
    for (const c of this.hexCells[q]) if (this.soil[c] === SOIL_STONE) this.soil[c] = SOIL_LOAM;
    this.version++;
    this.stateVersion++;
    this.desigVersion++;
  }

  // ---------------------------------------------------------------- fine raster API
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  isAir(x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    return this.soil[y * this.w + x] === SOIL_AIR;
  }

  isAirIdx(k: number): boolean {
    return this.soil[k] === SOIL_AIR;
  }

  /** Is the point (mm) on dug floor. */
  isAirAt(x: number, y: number): boolean {
    return this.isAir(Math.floor(x / this.cell), Math.floor(y / this.cell));
  }

  /** Remove soil from a fine cell. */
  carve(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const k = y * this.w + x;
    if (this.soil[k] === SOIL_STONE || this.soil[k] === SOIL_AIR) return;
    this.soil[k] = SOIL_AIR;
    if (this.airCount === this.airLog.length) {
      const nl = new Int32Array(this.airLog.length * 2);
      nl.set(this.airLog);
      this.airLog = nl;
    }
    this.airLog[this.airCount++] = k;
    this.markDirty(x, y);
    this.version++;
    this.stateVersion++;
  }

  countAir(): number {
    let n = 0;
    for (let k = 0; k < this.soil.length; k++) if (this.soil[k] === SOIL_AIR) n++;
    return n;
  }

  markDirty(x: number, y: number): void {
    const cw = Math.ceil(this.w / NEST_CHUNK);
    const cx = Math.floor(x / NEST_CHUNK);
    const cy = Math.floor(y / NEST_CHUNK);
    const r = 6;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const lx = x - (cx + dx) * NEST_CHUNK;
        const ly = y - (cy + dy) * NEST_CHUNK;
        if (lx < -r || ly < -r || lx >= NEST_CHUNK + r || ly >= NEST_CHUNK + r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny * NEST_CHUNK >= this.h) continue;
        this.dirty.add(ny * cw + nx);
      }
  }

  // ---------------------------------------------------------------- hex API
  isHexDug(q: number): boolean {
    return q >= 0 && this.hexSoil[q] === SOIL_AIR;
  }

  isHexDiggable(q: number): boolean {
    return q >= 0 && this.hexSoil[q] !== SOIL_AIR && this.hexSoil[q] !== SOIL_STONE;
  }

  isEntrance(q: number): boolean {
    return this.entrances.includes(q);
  }

  /** Designated, undug and touching a dug hex. */
  isFrontierHex(q: number): boolean {
    if (!this.hexDesig[q] || !this.isHexDiggable(q)) return false;
    for (const n of this.neighbors(q)) if (n >= 0 && this.isHexDug(n)) return true;
    return false;
  }

  designateHex(q: number, on: boolean): void {
    if (!this.isHexDiggable(q)) return;
    const v = on ? 1 : 0;
    if (this.hexDesig[q] === v) return;
    this.hexDesig[q] = v;
    this.designatedCount += on ? 1 : -1;
    this.desigVersion++;
    this.stateVersion++;
    for (const c of this.hexCells[q]) {
      this.designated[c] = v;
      this.markDirty(c % this.w, Math.floor(c / this.w));
    }
  }

  /** Dig progress 0..1 of a hex. */
  hexProgress(q: number): number {
    if (this.isHexDug(q)) return 1;
    const t = this.hexTotal[q];
    return t > 0 ? 1 - this.hexWork[q] / t : 0;
  }

  /**
   * Apply excavation work to a hex from neighbour `from` (hex index). Fine
   * cells are carved progressively from the shared edge inward so the
   * excavation visibly grows. Returns true when the hex is fully dug.
   */
  digHex(q: number, work: number, from: number): boolean {
    if (!this.isHexDiggable(q)) return false;
    if (this.hexEntry[q] < 0) {
      const nb = this.neighbors(q);
      let d = nb.indexOf(from);
      if (d < 0) d = 5;
      this.hexEntry[q] = d;
    }
    this.hexWork[q] = Math.max(0, this.hexWork[q] - work);
    this.stateVersion++;
    const prog = this.hexProgress(q);
    const e = this.edgeMid(q, this.hexEntry[q]);
    const reach = prog * this.H * 1.25 + this.cell * 0.5;
    for (const c of this.hexCells[q]) {
      if (this.soil[c] === SOIL_AIR || this.soil[c] === SOIL_STONE) continue;
      const cx = ((c % this.w) + 0.5) * this.cell;
      const cy = (Math.floor(c / this.w) + 0.5) * this.cell;
      if (dhypot(cx - e.x, cy - e.y) < reach) this.carve(c % this.w, Math.floor(c / this.w));
    }
    if (this.hexWork[q] <= 0) {
      this.completeHex(q);
      return true;
    }
    return false;
  }

  /** Instantly excavate a hex (level setup / sandbox). */
  completeHex(q: number): void {
    if (q < 0 || this.hexSoil[q] === SOIL_STONE) return;
    for (const c of this.hexCells[q]) {
      if (this.soil[c] !== SOIL_STONE) this.carve(c % this.w, Math.floor(c / this.w));
    }
    if (this.hexDesig[q]) {
      this.hexDesig[q] = 0;
      this.designatedCount--;
      for (const c of this.hexCells[q]) this.designated[c] = 0;
    }
    this.hexSoil[q] = SOIL_AIR;
    this.hexWork[q] = 0;
    this.version++;
    this.stateVersion++;
    this.desigVersion++;
  }

  dugHexCount(): number {
    let n = 0;
    for (let q = 0; q < this.hexSoil.length; q++) if (this.hexSoil[q] === SOIL_AIR) n++;
    return n;
  }

  /** Fine air cells of a hex. */
  airCellsOfHex(q: number): number[] {
    const out: number[] = [];
    for (const c of this.hexCells[q]) if (this.soil[c] === SOIL_AIR) out.push(c);
    return out;
  }

  /** Mark every chunk for a rebuild. */
  dirtyAll(): void {
    const cw = Math.ceil(this.w / NEST_CHUNK);
    const ch = Math.ceil(this.h / NEST_CHUNK);
    for (let i = 0; i < cw * ch; i++) this.dirty.add(i);
  }

  // ---------------------------------------------------------------- persistence
  serialize(): NestGridData {
    return {
      ...this.params(),
      soil: toB64(this.soil),
      hexSoil: toB64(this.hexSoil),
      hexWork: toB64(new Uint8Array(this.hexWork.buffer.slice(0))),
      hexDesig: toB64(this.hexDesig),
      hexEntry: toB64(new Uint8Array(this.hexEntry.buffer.slice(0))),
      hexTotal: toB64(new Uint8Array(this.hexTotal.buffer.slice(0))),
      entrances: [...this.entrances],
      shafts: [...this.shafts],
    };
  }

  /** Copy of every mutable field (the raster geometry is rebuilt from the params). */
  snap(): NestGridSnap {
    return {
      ...this.params(),
      soil: this.soil.slice(),
      designated: this.designated.slice(),
      designatedCount: this.designatedCount,
      hexSoil: this.hexSoil.slice(),
      hexWork: this.hexWork.slice(),
      hexTotal: this.hexTotal.slice(),
      hexDesig: this.hexDesig.slice(),
      hexEntry: this.hexEntry.slice(),
      entrances: [...this.entrances],
      shafts: [...this.shafts],
    };
  }

  static fromSnap(d: NestGridSnap): NestGrid {
    const g = new NestGrid(d);
    g.soil.set(d.soil);
    g.designated.set(d.designated);
    g.designatedCount = d.designatedCount;
    g.hexSoil.set(d.hexSoil);
    g.hexWork.set(d.hexWork);
    g.hexTotal.set(d.hexTotal);
    g.hexDesig.set(d.hexDesig);
    g.hexEntry.set(d.hexEntry);
    g.entrances = [...d.entrances];
    g.shafts = [...d.shafts];
    g.version++;
    g.dirtyAll();
    return g;
  }

  static deserialize(d: NestGridData): NestGrid {
    const g = new NestGrid(d);
    g.soil = fromB64(d.soil);
    g.hexSoil = fromB64(d.hexSoil);
    g.hexWork = new Float32Array(fromB64(d.hexWork).buffer);
    g.hexDesig = fromB64(d.hexDesig);
    g.hexEntry = new Int8Array(fromB64(d.hexEntry).buffer);
    if (d.hexTotal) g.hexTotal = new Float32Array(fromB64(d.hexTotal).buffer);
    g.entrances = [...d.entrances];
    g.shafts = [...d.shafts];
    g.designatedCount = 0;
    g.designated.fill(0);
    for (let q = 0; q < g.hexSoil.length; q++)
      if (g.hexDesig[q] && g.hexSoil[q] !== SOIL_AIR) {
        g.designatedCount++;
        for (const c of g.hexCells[q]) g.designated[c] = 1;
      }
    g.version++;
    g.dirtyAll();
    return g;
  }
}

/** Point inside a flat-top hexagon of circumradius R centred at origin. */
export function insideHex(dx: number, dy: number, R: number): boolean {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  const h = (Math.sqrt(3) / 2) * R;
  if (y > h) return false;
  return x <= R - y / Math.sqrt(3);
}

export function toB64(a: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < a.length; i += CH) s += String.fromCharCode.apply(null, Array.from(a.subarray(i, i + CH)));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
