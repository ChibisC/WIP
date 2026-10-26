import { dcos, dsin, sq } from '../sim/dmath';

export interface HexLayoutParams {
  cols: number;
  rows: number;
  /** hex circumradius in mm */
  R: number;
}

/** Neighbour column/row offsets by direction (NE, SE, S, SW, NW, N), for even and odd columns. */
const NB_EVEN: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
];
const NB_ODD: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
];
/** Edge-midpoint angles by direction (y down the screen). */
const EDGE_ANG = [-Math.PI / 6, Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6, (7 * Math.PI) / 6, -Math.PI / 2];

/**
 * The geometry of a flat-top hex grid with odd columns shifted down ("odd-q"),
 * shared by the underground nests (`NestGrid`) and the surface maps (DESIGN 3.14,
 * docs/maps/design.md §1). Coordinates are mm in a plane: x right, y "down the
 * screen" (world z). Hex index q = r·cols + c. R is the circumradius; columns are
 * C = 1.5·R apart and rows H = √3·R apart.
 *
 * Deterministic: only arithmetic, rounding and `dmath`, so the simulation can use it.
 */
export class HexLayout {
  readonly cols: number;
  readonly rows: number;
  /** hex circumradius, flat-to-flat height, column spacing (mm) */
  readonly R: number;
  readonly H: number;
  readonly C: number;
  /** plane size in mm */
  readonly widthMm: number;
  readonly depthMm: number;

  constructor(p: HexLayoutParams) {
    this.cols = p.cols;
    this.rows = p.rows;
    this.R = p.R;
    this.H = Math.sqrt(3) * p.R;
    this.C = 1.5 * p.R;
    this.widthMm = this.C * (this.cols - 1) + 2 * this.R;
    this.depthMm = this.H * (this.rows + 0.5);
  }

  /** The grid that covers a plane of width × depth mm with hexes of circumradius R. */
  static covering(width: number, depth: number, R: number): HexLayout {
    const C = 1.5 * R;
    const H = Math.sqrt(3) * R;
    return new HexLayout({ cols: Math.max(1, Math.ceil((width - 2 * R) / C) + 1), rows: Math.max(1, Math.ceil(depth / H - 0.5)), R });
  }

  get count(): number {
    return this.cols * this.rows;
  }

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

  /** Hex centre x and y without an object (mm). */
  centerX(q: number): number {
    return this.R + (q % this.cols) * this.C;
  }

  centerY(q: number): number {
    const c = q % this.cols;
    return this.H * 0.5 + Math.floor(q / this.cols) * this.H + (c & 1 ? this.H * 0.5 : 0);
  }

  /** Hex containing a point (mm), or −1 (outside the grid or in a corner gap at its rim). */
  hexAt(x: number, y: number): number {
    const best = this.nearestHex(x, y);
    if (best < 0) return -1;
    if (sq(this.centerX(best) - x) + sq(this.centerY(best) - y) > this.R * this.R * 1.05) return -1;
    return best;
  }

  /** Hex whose centre is nearest a point (mm), clamped to the grid; −1 only for an empty grid. */
  nearestHex(x: number, y: number): number {
    const c0 = Math.round((x - this.R) / this.C);
    let best = -1;
    let bd = Infinity;
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= this.cols) continue;
      const r0 = Math.round((y - this.H * 0.5 - (c & 1 ? this.H * 0.5 : 0)) / this.H);
      for (let r = r0 - 1; r <= r0 + 1; r++) {
        const q = this.hexIndex(c, r);
        if (q < 0) continue;
        const d = sq(this.centerX(q) - x) + sq(this.centerY(q) - y);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
    }
    if (best >= 0) return best;
    // far outside: clamp to the rim
    const c = Math.min(this.cols - 1, Math.max(0, c0));
    const r = Math.min(this.rows - 1, Math.max(0, Math.round((y - this.H * 0.5 - (c & 1 ? this.H * 0.5 : 0)) / this.H)));
    return this.hexIndex(c, r);
  }

  /** Neighbour in direction d (0..5: NE, SE, S, SW, NW, N), or −1 outside. */
  neighbor(q: number, d: number): number {
    const c = q % this.cols;
    const r = Math.floor(q / this.cols);
    const o = (c & 1 ? NB_ODD : NB_EVEN)[d];
    return this.hexIndex(c + o[0], r + o[1]);
  }

  /** Six neighbours (flat-top, odd columns shifted down); −1 when outside. Order: NE, SE, S, SW, NW, N. */
  neighbors(q: number): number[] {
    return [this.neighbor(q, 0), this.neighbor(q, 1), this.neighbor(q, 2), this.neighbor(q, 3), this.neighbor(q, 4), this.neighbor(q, 5)];
  }

  /** Midpoint of the edge shared with neighbour direction d (mm). */
  edgeMid(q: number, d: number, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
    this.hexCenter(q, out);
    const rr = this.H * 0.5;
    out.x += dcos(EDGE_ANG[d]) * rr;
    out.y += dsin(EDGE_ANG[d]) * rr;
    return out;
  }

  /** Hex distance (steps) between two hexes (offset → cube coordinates). */
  hexDistance(a: number, b: number): number {
    const ac = a % this.cols;
    const bc = b % this.cols;
    const ax = ac;
    const az = Math.floor(a / this.cols) - (ac - (ac & 1)) / 2;
    const bx = bc;
    const bz = Math.floor(b / this.cols) - (bc - (bc & 1)) / 2;
    const dx = ax - bx;
    const dz = az - bz;
    return Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dx + dz));
  }

  /**
   * The hexes exactly k steps from q, in a fixed order (k = 0 gives q itself), skipping those
   * outside the grid. Deterministic order: start k steps "SW" of q, then walk the six sides.
   */
  ring(q: number, k: number, out: number[] = []): number[] {
    out.length = 0;
    if (k <= 0) {
      out.push(q);
      return out;
    }
    // walk in cube coordinates so hexes outside the grid do not break the walk
    const c = q % this.cols;
    let x = c;
    let z = Math.floor(q / this.cols) - (c - (c & 1)) / 2;
    // k steps in direction SW (cube: x −1, z +1)
    x -= k;
    z += k;
    // side directions in cube (x, z): NE→? walk order N... chosen so the loop closes
    const DIRS: readonly (readonly [number, number])[] = [
      [0, -1], // N
      [1, -1], // NE
      [1, 0], // SE
      [0, 1], // S
      [-1, 1], // SW
      [-1, 0], // NW
    ];
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i < k; i++) {
        const cc = x;
        const rr = z + (cc - (cc & 1)) / 2;
        const h = this.hexIndex(cc, rr);
        if (h >= 0) out.push(h);
        x += DIRS[s][0];
        z += DIRS[s][1];
      }
    }
    return out;
  }

  /** All hexes within k steps of q (q first, then rings outward), inside the grid. */
  disk(q: number, k: number, out: number[] = []): number[] {
    out.length = 0;
    const tmp: number[] = [];
    for (let i = 0; i <= k; i++) for (const h of this.ring(q, i, tmp)) out.push(h);
    return out;
  }

  /** Is (dx, dy) inside this grid's hexagon centred at the origin. */
  insideHex(dx: number, dy: number, scale = 1): boolean {
    return insideHex(dx, dy, this.R * scale);
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
