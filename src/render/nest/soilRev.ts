import type { NestGrid } from '../../world/nestGrid';

/**
 * A counter that moves only when a nest grid's soil does (action-lag fix, 2026-11-23).
 *
 * `NestGrid.version` moves on every change a frame brings — dig progress, dig orders, entrances — and the client's copy
 * bumps it once for every grid update the simulation sends (game/replica.ts), soil or not. Everything drawn from the
 * soil alone (the nest mesh's signed distance and light maps, the minimap's nest picture) recomputed on each of those:
 * the whole nest, 10–58 ms, every frame ants were digging. The soil is compared with a copy when the version moves
 * (a byte compare: a fraction of a millisecond), so no write to it can be missed; the same soil gives the same counter.
 * (The version itself keeps its meaning: the nest's decorations seed their randomness from it.)
 */
interface Rev {
  ver: number;
  rev: number;
  copy: Uint8Array;
}

const revs = new WeakMap<NestGrid, Rev>();

export function soilRev(g: NestGrid): number {
  const soil = g.soil;
  let r = revs.get(g);
  if (!r) {
    revs.set(g, { ver: g.version, rev: 0, copy: soil.slice() });
    return 0;
  }
  if (r.ver === g.version) return r.rev;
  r.ver = g.version;
  if (r.copy.length !== soil.length) {
    r.copy = soil.slice();
    r.rev++;
  } else if (!sameBytes(r.copy, soil)) {
    r.copy.set(soil);
    r.rev++;
  }
  return r.rev;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  const n = a.length;
  // four bytes at a time where both are aligned, the rest one by one
  if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
    const m = n >> 2;
    const a4 = new Uint32Array(a.buffer, a.byteOffset, m);
    const b4 = new Uint32Array(b.buffer, b.byteOffset, m);
    for (let i = 0; i < m; i++) if (a4[i] !== b4[i]) return false;
    for (let i = m << 2; i < n; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
