/**
 * The shared hex geometry (world/hexLayout.ts): the nest grid's maths moved there unchanged
 * (checked against the old formulas, copied here), plus rings and disks for the surface maps.
 * Run: npx vite-node tests/hexgrid.ts
 */
import { HexLayout } from '../src/world/hexLayout';
import { NestGrid } from '../src/world/nestGrid';
import { Rng } from '../src/core/rng';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ---- the old NestGrid formulas (before the move), for comparison
function oldNeighbors(g: HexLayout, q: number): number[] {
  const c = q % g.cols;
  const r = Math.floor(q / g.cols);
  if (c & 1) return [g.hexIndex(c + 1, r), g.hexIndex(c + 1, r + 1), g.hexIndex(c, r + 1), g.hexIndex(c - 1, r + 1), g.hexIndex(c - 1, r), g.hexIndex(c, r - 1)];
  return [g.hexIndex(c + 1, r - 1), g.hexIndex(c + 1, r), g.hexIndex(c, r + 1), g.hexIndex(c - 1, r), g.hexIndex(c - 1, r - 1), g.hexIndex(c, r - 1)];
}
function oldHexAt(g: HexLayout, x: number, y: number): number {
  const c0 = Math.round((x - g.R) / g.C);
  let best = -1;
  let bd = Infinity;
  const p = { x: 0, y: 0 };
  for (let c = c0 - 1; c <= c0 + 1; c++) {
    if (c < 0 || c >= g.cols) continue;
    const r0 = Math.round((y - g.H * 0.5 - (c & 1 ? g.H * 0.5 : 0)) / g.H);
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      const q = g.hexIndex(c, r);
      if (q < 0) continue;
      g.hexCenter(q, p);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
  }
  if (best >= 0 && bd > g.R * g.R * 1.05) return -1;
  return best;
}
function oldDistance(g: HexLayout, a: number, b: number): number {
  const cube = (q: number) => {
    const c = q % g.cols;
    const r = Math.floor(q / g.cols);
    const x = c;
    const z = r - (c - (c & 1)) / 2;
    return [x, -x - z, z];
  };
  const [ax, ay, az] = cube(a);
  const [bx, by, bz] = cube(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

const t0 = Date.now();
const nest = new NestGrid({ cols: 34, rows: 30, R: 7.5, seed: 3 });
const surf = HexLayout.covering(1600, 1600, 8);
check('a surface grid covers a 1,600 mm map with R = 8 mm', surf.widthMm >= 1600 && surf.depthMm >= 1600 && surf.widthMm < 1600 + surf.C + 1 && surf.depthMm < 1600 + surf.H + 1, `${surf.cols} × ${surf.rows} = ${surf.count} hexes, ${surf.widthMm.toFixed(0)} × ${surf.depthMm.toFixed(0)} mm`);

for (const [name, g] of [
  ['nest grid', nest],
  ['surface grid', surf],
] as const) {
  let nbOk = true;
  for (let q = 0; q < g.count; q++) {
    const a = g.neighbors(q);
    const b = oldNeighbors(g, q);
    if (a.join() !== b.join()) nbOk = false;
  }
  check(`${name}: neighbours match the old formula for every hex`, nbOk);
  const rng = new Rng(7);
  let atOk = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const x = rng.range(-20, g.widthMm + 20);
    const y = rng.range(-20, g.depthMm + 20);
    if (g.hexAt(x, y) === oldHexAt(g, x, y)) atOk++;
  }
  check(`${name}: hexAt matches the old lookup at ${N} random points`, atOk === N, `${atOk}/${N}`);
  let dOk = true;
  for (let i = 0; i < 5000; i++) {
    const a = rng.int(0, g.count - 1);
    const b = rng.int(0, g.count - 1);
    if (g.hexDistance(a, b) !== oldDistance(g, a, b)) dOk = false;
  }
  check(`${name}: hexDistance matches the old formula`, dOk);
  // rings and disks from an interior hex
  const mid = g.hexIndex(Math.floor(g.cols / 2), Math.floor(g.rows / 2));
  let ringOk = true;
  let det = '';
  for (let k = 0; k <= 6; k++) {
    const ring = g.ring(mid, k);
    const want = k === 0 ? 1 : 6 * k;
    const distinct = new Set(ring).size === ring.length;
    const allAtK = ring.every((h) => g.hexDistance(mid, h) === k);
    if (ring.length !== want || !distinct || !allAtK) {
      ringOk = false;
      det = `k ${k}: ${ring.length} hexes (want ${want}), distinct ${distinct}, all at k ${allAtK}`;
    }
  }
  check(`${name}: ring(k) gives the 6k distinct hexes at distance k`, ringOk, det);
  const disk = g.disk(mid, 4);
  check(`${name}: disk(4) gives 61 distinct hexes within 4 steps`, disk.length === 61 && new Set(disk).size === 61 && disk.every((h) => g.hexDistance(mid, h) <= 4));
  // at the rim: only the hexes inside, and still all at the right distance
  const corner = g.hexIndex(0, 0);
  const rim = g.ring(corner, 3);
  check(`${name}: a ring at the rim keeps only hexes inside, at the right distance`, rim.length > 0 && rim.length < 18 && rim.every((h) => h >= 0 && g.hexDistance(corner, h) === 3), `${rim.length} hexes`);
  // the walk is a closed loop: consecutive ring hexes are neighbours
  const r5 = g.ring(mid, 5);
  let loop = true;
  for (let i = 0; i < r5.length; i++) if (g.hexDistance(r5[i], r5[(i + 1) % r5.length]) !== 1) loop = false;
  check(`${name}: a ring is a closed walk (each hex next to the following one)`, loop);
  // nearestHex: always a hex, and the hex containing the point when there is one
  let nOk = true;
  for (let i = 0; i < 2000; i++) {
    const x = rng.range(-200, g.widthMm + 200);
    const y = rng.range(-200, g.depthMm + 200);
    const n = g.nearestHex(x, y);
    const h = g.hexAt(x, y);
    if (n < 0 || (h >= 0 && n !== h)) nOk = false;
  }
  check(`${name}: nearestHex always finds a hex, the containing one where there is one`, nOk);
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all hex grid tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
