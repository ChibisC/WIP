import * as THREE from 'three';
import { OCC_LEVELS } from './detailShading';

/**
 * Baked ambient occlusion and edge convexity per vertex (realism pass v2), for parts with baked detail:
 * crevices and joints (where the head meets the mesosoma, the leg sockets, between the antler teeth, under
 * the body) are darker for ambient light, and sharp convex edges get the worn, lighter look.
 *
 * Occlusion: around each vertex the hemisphere above its surface is split into bins; a bin is closed when
 * some other point of the model lies in it within `radius` (nearer closes it more). Convexity: whether the
 * surface nearby falls away from the tangent plane. Both are packed into `aDet` (see detailShading.ts).
 * Runs once per model on the CPU with a spatial hash (a few tens of ms for an ant).
 */

/** Hemisphere bins: [cos elevation band low, high, azimuth sectors]. */
const BANDS: Array<[number, number, number]> = [
  [0.22, 0.55, 8],
  [0.55, 0.85, 6],
  [0.85, 1.01, 1],
];

export interface OccOptions {
  /** how far occluders count (model units) */
  radius: number;
  /** per vertex: 1 = not an occluder (hairs) */
  skip?: Uint8Array | number[];
  /** strength 0..1 (default 1) */
  strength?: number;
}

export function bakeOcclusion(g: THREE.BufferGeometry, o: OccOptions): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const det = g.getAttribute('aDet') as THREE.BufferAttribute | undefined;
  if (!det) return;
  const n = pos.count;
  const R = o.radius;
  const R2 = R * R;
  const rc = R * 0.4;
  const strength = o.strength ?? 1;
  const P = pos.array as Float32Array;
  const N = nrm.array as Float32Array;
  const D = det.array as Float32Array;
  // spatial hash of occluders
  const inv = 1 / R;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let i = 0; i < n; i++) {
    if (o.skip && o.skip[i]) continue;
    const k = key(Math.floor(P[i * 3] * inv), Math.floor(P[i * 3 + 1] * inv), Math.floor(P[i * 3 + 2] * inv));
    let c = grid.get(k);
    if (!c) grid.set(k, (c = []));
    c.push(i);
  }
  // bin weights (cosine-weighted solid angle)
  const binW: number[] = [];
  for (const [lo, hi, sec] of BANDS) for (let s = 0; s < sec; s++) binW.push((hi * hi - lo * lo) / sec);
  const wSum = binW.reduce((a, b) => a + b, 0);
  const closed = new Float32Array(binW.length);
  const t = new THREE.Vector3();
  const b = new THREE.Vector3();
  const nv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (D[i * 4 + 3] < 0.5) continue;
    const px = P[i * 3];
    const py = P[i * 3 + 1];
    const pz = P[i * 3 + 2];
    nv.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).normalize();
    // tangent frame
    t.set(Math.abs(nv.y) < 0.9 ? 0 : 1, Math.abs(nv.y) < 0.9 ? 1 : 0, 0).cross(nv).normalize();
    b.crossVectors(nv, t);
    closed.fill(0);
    let cSum = 0;
    let cW = 0;
    const gx = Math.floor(px * inv);
    const gy = Math.floor(py * inv);
    const gz = Math.floor(pz * inv);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const c = grid.get(key(gx + dx, gy + dy, gz + dz));
          if (!c) continue;
          for (const j of c) {
            if (j === i) continue;
            const ex = P[j * 3] - px;
            const ey = P[j * 3 + 1] - py;
            const ez = P[j * 3 + 2] - pz;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 > R2 || d2 < 1e-12) continue;
            const d = Math.sqrt(d2);
            const ln = (ex * nv.x + ey * nv.y + ez * nv.z) / d;
            if (d < rc) {
              const w = 1 - d / rc;
              cSum += ln * w;
              cW += w;
            }
            if (ln < BANDS[0][0] || d < R * 0.03) continue;
            const lt = (ex * t.x + ey * t.y + ez * t.z) / d;
            const lb = (ex * b.x + ey * b.y + ez * b.z) / d;
            const near = Math.sqrt(1 - d / R);
            let bi = 0;
            for (const [lo, hi, sec] of BANDS) {
              if (ln >= lo && ln < hi) {
                const s = sec === 1 ? 0 : Math.floor(((Math.atan2(lb, lt) / (Math.PI * 2) + 1) % 1) * sec) % sec;
                if (near > closed[bi + s]) closed[bi + s] = near;
                break;
              }
              bi += sec;
            }
          }
        }
    let occ = 0;
    for (let k = 0; k < binW.length; k++) occ += closed[k] * binW[k];
    const ao = 1 - strength * Math.min(1, occ / wSum);
    const conv = cW > 0 ? Math.max(0, Math.min(1, (-cSum / cW) * 2.5)) : 0;
    const aoQ = Math.round((1 - ao) * OCC_LEVELS);
    const cvQ = Math.round(conv * OCC_LEVELS);
    const x = D[i * 4];
    const ang = x < 0 ? -1 : x - Math.floor(x);
    D[i * 4] = ang < 0 ? -1 - aoQ : ang + aoQ;
    const z = D[i * 4 + 2];
    D[i * 4 + 2] = (z - Math.floor(z)) + cvQ;
  }
  det.needsUpdate = true;
}
