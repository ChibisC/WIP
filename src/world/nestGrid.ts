import { Rng, fbm2, valueNoise2 } from '../core/rng';
import { dcos, dhypot, dsin, sq } from '../sim/dmath';
import { HexLayout } from './hexLayout';

export { insideHex } from './hexLayout';

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
  tunnels: number[][];
  spots: number[][];
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
  /** older saves have none: rebuilt from the dug corridor behind each entrance */
  tunnels?: number[][];
  spots?: number[][];
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
 * world z). Each entrance is a short tunnel of hexes rising to a hole in the
 * surface; extra-entrance spots are marked, undug tunnels the player may dig out
 * to open one more entrance (sim/entrances.ts).
 */
export class NestGrid extends HexLayout {
  // the hex geometry (cols, rows, R, H, C, widthMm, depthMm, hexCenter, hexAt, neighbors…) is HexLayout's
  readonly seed: number;
  /** fine raster cell size (mm) */
  readonly cell: number;
  /** fine raster size */
  readonly w: number;
  readonly h: number;
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
  /** the top hex of each entrance tunnel (the ramp under the surface hole) */
  entrances: number[] = [];
  /** entrance tunnels, aligned with `entrances`: hexes from the top down to the nest floor */
  tunnels: number[][] = [];
  /** the top hex of each extra-entrance spot (aligned with `spots`) */
  shafts: number[] = [];
  /** extra-entrance spots: undug tunnels (top first) that open a new entrance once dug out */
  spots: number[][] = [];
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
    super(p);
    this.seed = p.seed;
    this.cell = p.R / CELLS_PER_R;
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

  /** Is q part of an entrance tunnel (its ramp hexes stay clear of tiles)? */
  isEntrance(q: number): boolean {
    return this.tunnelIndex(q) >= 0;
  }

  /** The entrance whose tunnel holds hex q, or −1. */
  tunnelIndex(q: number): number {
    for (let i = 0; i < this.tunnels.length; i++) if (this.tunnels[i].includes(q)) return i;
    return this.entrances.indexOf(q);
  }

  /** The extra-entrance spot holding hex q, or −1. */
  spotIndex(q: number): number {
    for (let i = 0; i < this.spots.length; i++) if (this.spots[i].includes(q)) return i;
    return -1;
  }

  /** Open an entrance whose tunnel (top first) is dug. */
  addEntrance(tunnel: number[]): void {
    this.entrances.push(tunnel[0]);
    this.tunnels.push(tunnel.slice());
    this.version++;
    this.stateVersion++;
    this.desigVersion++;
  }

  /** Mark an undug tunnel (top first) as an extra-entrance spot. */
  addSpot(tunnel: number[]): void {
    this.shafts.push(tunnel[0]);
    this.spots.push(tunnel.slice());
    this.stateVersion++;
    this.desigVersion++;
  }

  removeSpot(i: number): void {
    this.shafts.splice(i, 1);
    this.spots.splice(i, 1);
    this.stateVersion++;
    this.desigVersion++;
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
      tunnels: this.tunnels.map((t) => [...t]),
      spots: this.spots.map((t) => [...t]),
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
      tunnels: this.tunnels.map((t) => [...t]),
      spots: this.spots.map((t) => [...t]),
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
    g.setEntranceLists(d);
    g.version++;
    g.dirtyAll();
    return g;
  }

  /**
   * Entrance and spot lists from saved data. Older saves kept only each entrance's top hex and
   * hidden one-hex shaft sites: the tunnel is rebuilt along the dug corridor behind the top, and
   * each shaft grows into a spot reaching toward the nest's middle (sim/entrances.ts migrateNest
   * then trims the spots to the colony's allowance).
   */
  setEntranceLists(d: { entrances: number[]; shafts: number[]; tunnels?: number[][]; spots?: number[][] }): void {
    this.entrances = [...d.entrances];
    this.shafts = [...d.shafts];
    if (d.tunnels && d.tunnels.length === d.entrances.length) this.tunnels = d.tunnels.map((t) => [...t]);
    else this.tunnels = this.entrances.map((top) => dugCorridor(this, top, TUNNEL_LEN));
    if (d.spots && d.spots.length === d.shafts.length) this.spots = d.spots.map((t) => [...t]);
    else {
      const mid = this.hexIndex(Math.floor(this.cols / 2), Math.floor(this.rows / 2));
      this.spots = this.shafts.map((top) => chainToward(this, top, mid, TUNNEL_LEN));
    }
  }

  static deserialize(d: NestGridData): NestGrid {
    const g = new NestGrid(d);
    g.soil = fromB64(d.soil);
    g.hexSoil = fromB64(d.hexSoil);
    g.hexWork = new Float32Array(fromB64(d.hexWork).buffer);
    g.hexDesig = fromB64(d.hexDesig);
    g.hexEntry = new Int8Array(fromB64(d.hexEntry).buffer);
    if (d.hexTotal) g.hexTotal = new Float32Array(fromB64(d.hexTotal).buffer);
    g.setEntranceLists(d);
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

/** Hexes in a tunnel rebuilt for an older save (ENTRANCE.tunnelLen; kept here so the world layer needs no sim import). */
const TUNNEL_LEN = 3;

/**
 * Up to n hexes from `from` toward `to`, one step at a time to the neighbour nearest `to` (ties: the
 * lower direction), stopping where no neighbour passes `ok` (default: diggable soil) or none is
 * nearer. Starts with `from` itself.
 */
export function chainToward(g: HexLayout & { isHexDiggable(q: number): boolean }, from: number, to: number, n: number, ok: (q: number) => boolean = (q) => g.isHexDiggable(q)): number[] {
  const out = [from];
  let cur = from;
  while (out.length < n) {
    let best = -1;
    let bd = g.hexDistance(cur, to);
    for (const nb of g.neighbors(cur)) {
      if (nb < 0 || out.includes(nb) || !ok(nb)) continue;
      const d = g.hexDistance(nb, to);
      if (d < bd) {
        bd = d;
        best = nb;
      }
    }
    if (best < 0) break;
    out.push(best);
    cur = best;
  }
  return out;
}

/** Up to n dug hexes from `top` along its corridor (the first dug neighbour not yet taken, by direction). */
export function dugCorridor(g: NestGrid, top: number, n: number): number[] {
  const out = [top];
  let cur = top;
  while (out.length < n) {
    const nb = g.neighbors(cur).find((m) => m >= 0 && g.isHexDug(m) && !out.includes(m));
    if (nb === undefined) break;
    out.push(nb);
    cur = nb;
  }
  return out;
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
