import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, fbm2, valueNoise2 } from '../core/rng';
import type { Biome, MapDef, Shape } from '../maps/types';
import { shapeDist } from '../world/mapShapes';
import { Terrain } from '../world/terrain';
import { branchGeometry, leafGeometry, mushroomGeometry } from './props';
import { globalUniforms, patchDapple } from './shaderPatch';
import { textures } from './textures';

/**
 * The per-biome part of an authored map's dressing (render only, seeded from the map id): how much
 * grass, litter, twigs, ferns and fungi lie about, and the shapes of the biome's own walls and
 * walkways (giant trunks and buttress roots, mushroom clusters, termite mounds, root mats and
 * leaf rafts), plus the look of its water and light.
 */

export interface BiomeDress {
  /** long-grass clumps per dm² (and how many of them hug the map edges) */
  grass: number;
  edge: number;
  /** grass colour: green meadow or dry savanna */
  dry: boolean;
  /** pebbles per dm² */
  pebbles: number;
  /** wildflower drifts per dm² */
  flowers: number;
  /** fallen leaves per dm², and their size range (mm) */
  leaves: number;
  leafSize: readonly [number, number];
  /** twigs per dm² */
  twigs: number;
  /** small fungus clusters per dm² */
  fungi: number;
  /** fern clumps per dm² */
  ferns: number;
  /** shore reed density (× the meadow's) */
  reeds: number;
}

export const BIOME_DRESS: Record<Biome, BiomeDress> = {
  meadow: { grass: 3.4, edge: 0.5, dry: false, pebbles: 7, flowers: 0.12, leaves: 0.25, leafSize: [18, 40], twigs: 0.08, fungi: 0, ferns: 0, reeds: 1 },
  forest: { grass: 0.45, edge: 0.6, dry: false, pebbles: 4, flowers: 0, leaves: 8, leafSize: [20, 46], twigs: 1.1, fungi: 0.12, ferns: 0.07, reeds: 0.5 },
  riverbank: { grass: 2.4, edge: 0.4, dry: false, pebbles: 9, flowers: 0.05, leaves: 0.8, leafSize: [18, 40], twigs: 0.35, fungi: 0, ferns: 0, reeds: 1.6 },
  rainforest: { grass: 0.15, edge: 0.6, dry: false, pebbles: 2, flowers: 0, leaves: 9, leafSize: [40, 110], twigs: 0.7, fungi: 0.08, ferns: 0.2, reeds: 0.6 },
  savanna: { grass: 2.2, edge: 0.3, dry: true, pebbles: 11, flowers: 0.02, leaves: 0.15, leafSize: [10, 22], twigs: 0.55, fungi: 0, ferns: 0, reeds: 0.4 },
};

/** Day light and air per biome (applied over the default sunny sky; night is left alone). */
export interface BiomeLight {
  sun: number;
  sunColor: number;
  hemi: number;
  hemiSky: number;
  hemiGround: number;
  /** × the map's fog density */
  fog: number;
  fogColor: number;
  dapple: number;
  water: number;
}

export const BIOME_LIGHT: Record<Biome, BiomeLight> = {
  meadow: { sun: 3.1, sunColor: 0xffdb9e, hemi: 0.95, hemiSky: 0xbfd4ff, hemiGround: 0x5a4a2a, fog: 1, fogColor: 0xd9d6c2, dapple: 0.7, water: 0x2a3a34 },
  forest: { sun: 1.7, sunColor: 0xf2e2b0, hemi: 0.8, hemiSky: 0xa9c0a0, hemiGround: 0x3a3020, fog: 1.15, fogColor: 0x8f9a80, dapple: 1.0, water: 0x2c2a1e },
  riverbank: { sun: 3.0, sunColor: 0xfff0d8, hemi: 1.0, hemiSky: 0xc4d8ff, hemiGround: 0x5a5236, fog: 1.1, fogColor: 0xd2d8d0, dapple: 0.6, water: 0x2a3c3c },
  rainforest: { sun: 1.4, sunColor: 0xe8efc8, hemi: 0.85, hemiSky: 0x9ebc98, hemiGround: 0x2e3218, fog: 1.5, fogColor: 0x9aa892, dapple: 1.0, water: 0x2e2c1c },
  savanna: { sun: 3.6, sunColor: 0xffdca0, hemi: 0.9, hemiSky: 0xd6e0f0, hemiGround: 0x8a6a40, fog: 1.3, fogColor: 0xdccdac, dapple: 0.25, water: 0x4a4030 },
};

/** Set a biome's day light on the surface lights and scene (returns nothing; the night look is untouched). */
export function applyBiomeLight(b: BiomeLight, scene: THREE.Scene, sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight, baseFog: number): void {
  sun.intensity = b.sun;
  sun.color.setHex(b.sunColor);
  hemi.intensity = b.hemi;
  hemi.color.setHex(b.hemiSky);
  hemi.groundColor.setHex(b.hemiGround);
  const fog = scene.fog as THREE.FogExp2 | null;
  if (fog && 'density' in fog) {
    fog.density = baseFog * b.fog;
    fog.color.setHex(b.fogColor);
  }
  globalUniforms.uDappleStrength.value = b.dapple;
}

// ---------------------------------------------------------------------------- geometry

function paint(g: THREE.BufferGeometry, c: THREE.Color | ((x: number, y: number, z: number) => THREE.Color)): THREE.BufferGeometry {
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position as THREE.BufferAttribute;
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = typeof c === 'function' ? c(p.getX(i), p.getY(i), p.getZ(i)) : c;
    a.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Polar outline of a closed shape about its centre (star-shaped outlines). */
function polarOf(shape: Shape): { cx: number; cz: number; r: (a: number) => number } | null {
  if ('circle' in shape) return { cx: shape.circle[0], cz: shape.circle[1], r: () => shape.r };
  if (!('poly' in shape)) return null;
  const P = shape.poly;
  let cx = 0;
  let cz = 0;
  for (const p of P) (cx += p[0]), (cz += p[1]);
  cx /= P.length;
  cz /= P.length;
  const N = 72;
  const tab = new Float32Array(N + 1);
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let best = 0;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ex = P[i][0] - P[j][0];
      const ez = P[i][1] - P[j][1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = P[j][0] - cx;
      const wz = P[j][1] - cz;
      const t = (wx * ez - wz * ex) / den;
      const s = (wx * dz - wz * dx) / den;
      if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
    }
    tab[k] = best;
  }
  tab[N] = tab[0];
  return {
    cx,
    cz,
    r: (a) => {
      let u = (a / (Math.PI * 2)) * N;
      u = ((u % N) + N) % N;
      const k = Math.floor(u);
      return tab[k] * (1 - (u - k)) + tab[k + 1] * (u - k);
    },
  };
}

/** A giant tree trunk standing on its outline: flared foot, slight taper, bark grooves; it rises out of view. */
export function trunkGeometry(shape: Shape, height: number, ground: (x: number, z: number) => number, seed: number): THREE.BufferGeometry | null {
  const o = polarOf(shape);
  if (!o) return null;
  const N = 56;
  const K = 14;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const g0 = ground(o.cx, o.cz);
  let circ = 0;
  for (let i = 0; i < N; i++) circ += (o.r((i / N) * Math.PI * 2) * Math.PI * 2) / N;
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    const y = g0 - 3 + height * t * t * 0.4 + height * t * 0.6;
    // the foot flares out to the outline; higher up the trunk narrows to 80 %
    const flare = 1 - 0.2 * Math.min(1, t * 2.2);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const groove = 1 + 0.035 * Math.sin(a * 23 + seed) + 0.02 * valueNoise2(a * 6, t * 9, seed);
      const r = o.r(a) * flare * groove;
      pos.push(o.cx + Math.cos(a) * r, y, o.cz + Math.sin(a) * r);
      uv.push((i / N) * Math.max(1, Math.round(circ / 70)), (y - g0) / 70);
    }
  }
  for (let k = 0; k < K; k++)
    for (let i = 0; i < N; i++) {
      const a = k * (N + 1) + i;
      const b = a + N + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const dark = new THREE.Color(0x4a3d30);
  const mossC = new THREE.Color(0x4f6a2c);
  return paint(g, (x, y, z) => {
    const h = (y - g0) / height;
    const c = dark.clone().multiplyScalar(0.75 + 0.45 * Math.min(1, h * 3));
    const m = Math.max(0, fbm2(x * 0.03, y * 0.02 + z * 0.03, 3, seed + 3) - 0.5) * 2 * (1 - Math.min(1, h * 2.5));
    return c.lerp(mossC, Math.min(0.7, m * 1.4));
  });
}

/** A buttress root: a tall thin fin along its path, highest at the trunk end (the path's first point). */
export function buttressGeometry(shape: Shape, height: number, ground: (x: number, z: number) => number): THREE.BufferGeometry | null {
  if (!('path' in shape)) return null;
  const P = shape.path;
  const w = shape.width;
  const pts: Array<[number, number]> = [];
  for (let s = 0; s + 1 < P.length; s++) {
    const n = Math.max(4, Math.round(Math.hypot(P[s + 1][0] - P[s][0], P[s + 1][1] - P[s][1]) / 10));
    for (let i = 0; i < n; i++) pts.push([P[s][0] + ((P[s + 1][0] - P[s][0]) * i) / n, P[s][1] + ((P[s + 1][1] - P[s][1]) * i) / n]);
  }
  pts.push([P[P.length - 1][0], P[P.length - 1][1]]);
  const M = pts.length;
  // cross-section: left foot, left shoulder, top, right shoulder, right foot
  const prof = [
    [-0.5, 0],
    [-0.42, 0.75],
    [0, 1],
    [0.42, 0.75],
    [0.5, 0],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let len = 0;
  for (let i = 0; i < M; i++) {
    const [x, z] = pts[i];
    const j = Math.min(M - 1, i + 1);
    const k = Math.max(0, i - 1);
    const dx = pts[j][0] - pts[k][0];
    const dz = pts[j][1] - pts[k][1];
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    if (i > 0) len += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    const t = i / (M - 1);
    const h = height * Math.pow(1 - t, 1.25) + 5;
    const hw = (w / 2) * (1 - 0.45 * t);
    const g = ground(x, z) - 1;
    for (const [px, py] of prof) {
      const thin = py > 0.5 ? 0.55 : 1; // a fin: thick foot, narrow crest
      pos.push(x + nx * px * 2 * hw * thin, g + py * h, z + nz * px * 2 * hw * thin);
      uv.push((px + 0.5) * 2, len / 70);
    }
  }
  const S = prof.length;
  for (let i = 0; i + 1 < M; i++)
    for (let k = 0; k + 1 < S; k++) {
      const a = i * S + k;
      const b = a + S;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return paint(g, new THREE.Color(0x56483a));
}

/** A cluster of large mushrooms filling a circle. */
export function mushroomCluster(shape: Shape, height: number, ground: (x: number, z: number) => number, seed: number): THREE.BufferGeometry | null {
  const o = polarOf(shape);
  if (!o) return null;
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = rng.int(5, 9);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * o.r(a) * 0.75;
    const x = o.cx + Math.cos(a) * d;
    const z = o.cz + Math.sin(a) * d;
    const size = height * rng.range(0.45, 0.9) * (i === 0 ? 1.15 : 1);
    const g = mushroomGeometry(size, rng);
    g.rotateZ(rng.range(-0.15, 0.15));
    g.rotateY(rng.range(0, 6.28));
    g.translate(x, ground(x, z) - 0.8, z);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const g = mergeGeometries(parts);
  return g;
}

/** A fern: arching fronds of many narrow paired leaflets, darker at the base, paler at the tips. */
export function fernGeometry(size: number, rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const fronds = rng.int(4, 7);
  const base = new THREE.Color().setHSL(rng.range(0.22, 0.28), rng.range(0.4, 0.55), rng.range(0.12, 0.17));
  const tip = base.clone().lerp(new THREE.Color(0x9aa860), 0.35);
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const L = size * rng.range(0.6, 1.05);
    const arch = rng.range(0.35, 0.55);
    const droop = rng.range(0.15, 0.35);
    const pos: number[] = [];
    const col: number[] = [];
    const seg = 18;
    // the spine rises, arches and droops at the tip
    const spine = (t: number): [number, number] => [t * L, (Math.sin(t * Math.PI * 0.8) * arch - t * t * droop) * L];
    for (let i = 2; i < seg; i++) {
      const t = i / seg;
      const [x, y] = spine(t);
      const [x2, y2] = spine(t + 0.8 / seg);
      const w = L * 0.16 * Math.sin(Math.pow(t, 0.8) * Math.PI) + 0.4;
      const c = base.clone().lerp(tip, t);
      for (const side of [-1, 1]) {
        // a narrow leaflet angled forward and a little down from the spine
        pos.push(x, y, 0, x2, y2, side * 0.25, x + w * 0.45, y - w * 0.22, side * w);
        pos.push(x2, y2, side * 0.25, x2 + w * 0.3, y2 - w * 0.18, side * w * 0.85, x + w * 0.45, y - w * 0.22, side * w);
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.rotateY(yaw);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** A cathedral termite mound: a tall fluted spire on its outline, clay coloured. */
export function moundGeometry(shape: Shape, height: number, ground: (x: number, z: number) => number, seed: number): THREE.BufferGeometry | null {
  const o = polarOf(shape);
  if (!o) return null;
  const N = 40;
  const K = 16;
  const pos: number[] = [];
  const idx: number[] = [];
  const g0 = ground(o.cx, o.cz);
  const spires = 2 + (seed % 3);
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      // fluted: buttress-like ribs, a lumpy surface, a few secondary spires near the top
      const rib = 1 + 0.12 * Math.max(0, Math.sin(a * 5 + seed)) * (1 - t);
      const lump = 1 + 0.08 * (valueNoise2(a * 3 + seed, t * 6, seed) - 0.5);
      const side = Math.pow(1 - t, 0.85) * rib * lump;
      const top = 1 + 0.25 * Math.max(0, Math.cos(a * spires + seed)) * t * t;
      const r = o.r(a) * Math.max(0.04, side);
      pos.push(o.cx + Math.cos(a) * r, g0 - 2 + height * t * top, o.cz + Math.sin(a) * r);
    }
  }
  for (let k = 0; k < K; k++)
    for (let i = 0; i < N; i++) {
      const a = k * (N + 1) + i;
      const b = a + N + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const clay = new THREE.Color(0xa06a3a);
  const pale = new THREE.Color(0xc89a66);
  const out = paint(g, (x, y, z) => {
    const h = Math.max(0, Math.min(1, (y - g0) / height));
    return clay.clone().lerp(pale, h * 0.6).multiplyScalar(0.8 + 0.35 * valueNoise2(x * 0.2, y * 0.25 + z * 0.2, seed + 9));
  });
  // box-projected uvs (soil texture)
  const p = out.attributes.position as THREE.BufferAttribute;
  const uvs = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) uvs.set([(p.getX(i) + p.getZ(i)) / 40, p.getY(i) / 40], i * 2);
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return out;
}

/** Root-mat crossing: tangled roots side by side along the path, their tops at the walk height. */
export function rootMatGeometry(path: readonly (readonly [number, number])[], width: number, top: number, seed: number): THREE.BufferGeometry[] {
  const rng = new Rng(seed);
  const out: THREE.BufferGeometry[] = [];
  const [x0, z0] = path[0];
  const [x1, z1] = path[path.length - 1];
  const L = Math.hypot(x1 - x0, z1 - z0);
  const dx = (x1 - x0) / L;
  const dz = (z1 - z0) / L;
  const n = Math.max(6, Math.round(width / 3.2));
  for (let k = 0; k < n; k++) {
    const off = ((k + 0.5) / n - 0.5) * width * 1.05 + rng.range(-1.5, 1.5);
    const r = rng.range(1.3, 2.6);
    const pts: THREE.Vector3[] = [];
    const ext = rng.range(0.08, 0.2) * L;
    for (let i = 0; i <= 6; i++) {
      const t = -ext / L + (i / 6) * (1 + (2 * ext) / L);
      const wob = Math.sin(t * 9 + k * 1.7) * 2.4 + rng.range(-0.8, 0.8);
      const x = x0 + dx * t * L - dz * (off + wob);
      const z = z0 + dz * t * L + dx * (off + wob);
      pts.push(new THREE.Vector3(x, top - r * 0.85 + Math.sin(t * Math.PI) * 0.6, z));
    }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 8, false);
    const bark = new THREE.Color(0x6a5440).multiplyScalar(rng.range(0.8, 1.15));
    const moss = new THREE.Color(0x4d6a2a);
    out.push(paint(g, (x, y, z) => bark.clone().lerp(moss, Math.max(0, fbm2(x * 0.08, z * 0.08, 2, seed + k) - 0.55) * 1.8)));
  }
  return out;
}

/** A big fallen leaf floating across water as a raft, lying along the path at the walk height. */
export function leafRaft(path: readonly (readonly [number, number])[], width: number, top: number, seed: number): THREE.BufferGeometry {
  const tex = textures();
  const rng = new Rng(seed);
  const [x0, z0] = path[0];
  const [x1, z1] = path[path.length - 1];
  const L = Math.hypot(x1 - x0, z1 - z0);
  const g = leafGeometry(Math.max(L * 1.3, width * 2.6), rng.int(0, 7), tex.leaves.cols, tex.leaves.rows, rng);
  g.rotateY(-Math.atan2(x1 - x0, z1 - z0) + Math.PI);
  g.translate((x0 + x1) / 2, top - 0.2, (z0 + z1) / 2);
  return g;
}

// ---------------------------------------------------------------------------- ground scatter

export interface ScatterCtx {
  map: MapDef;
  terrain: Terrain;
  rng: Rng;
  ground: (x: number, z: number) => number;
  free: (x: number, z: number, margin?: number) => boolean;
  keepClear: (x: number, z: number, ring?: number) => boolean;
}

/** Fallen leaves, twigs, small fungi and ferns for a biome. */
export function litter(ctx: ScatterCtx, d: BiomeDress, group: THREE.Group): void {
  const { terrain: t, rng, ground, free } = ctx;
  const tex = textures();
  const area = (t.width * t.depth) / 1e4;
  const dense = (x: number, z: number) => fbm2(x / 140, z / 140, 3, 31) > 0.42; // patchy, not even
  // fallen leaves
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < area * d.leaves; i++) {
    const x = rng.range(0, t.width);
    const z = rng.range(0, t.depth);
    if (!free(x, z, 4) || (!dense(x, z) && rng.chance(0.6))) continue;
    const g = leafGeometry(rng.range(d.leafSize[0], d.leafSize[1]), rng.int(0, 7), tex.leaves.cols, tex.leaves.rows, rng);
    g.rotateX(rng.range(-0.12, 0.12));
    g.rotateY(rng.range(0, 6.28));
    g.translate(x, ground(x, z) + 0.25 + rng.range(0, 0.4), z);
    leaves.push(g);
  }
  if (leaves.length) {
    const mat = new THREE.MeshStandardMaterial({ map: tex.leaves.map, normalMap: tex.leaves.normal, roughness: 0.72, side: THREE.DoubleSide });
    patchDapple(mat);
    const m = new THREE.Mesh(mergeGeometries(leaves), mat);
    m.receiveShadow = true;
    m.castShadow = true;
    m.name = 'mapLeaves';
    group.add(m);
  }
  // twigs
  const twigs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < area * d.twigs; i++) {
    const x = rng.range(0, t.width);
    const z = rng.range(0, t.depth);
    if (!free(x, z, 6)) continue;
    const r = new Rng(rng.int(0, 1 << 20));
    const len = rng.range(30, 120);
    const rad = rng.range(1.0, 2.6);
    const g = branchGeometry(len, rad, r, 8, true);
    const yaw = rng.range(0, 6.28);
    g.rotateY(yaw);
    g.translate(x, ground(x, z) + rad * 0.8, z);
    twigs.push(g.index ? g.toNonIndexed() : g);
  }
  if (twigs.length) {
    const mat = new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, roughness: 0.9, vertexColors: true });
    patchDapple(mat);
    const m = new THREE.Mesh(mergeGeometries(twigs), mat);
    m.castShadow = m.receiveShadow = true;
    m.name = 'mapTwigs';
    group.add(m);
  }
  // fungi and ferns (vertex coloured)
  const vc: THREE.BufferGeometry[] = [];
  for (let i = 0; i < area * d.fungi; i++) {
    const x = rng.range(0, t.width);
    const z = rng.range(0, t.depth);
    if (!free(x, z, 8) || ctx.keepClear(x, z, 1)) continue;
    const r = new Rng(rng.int(0, 1 << 20));
    for (let k = 0; k < r.int(1, 4); k++) {
      const g = mushroomGeometry(r.range(6, 16), r);
      g.rotateY(r.range(0, 6.28));
      const ox = r.range(-8, 8);
      const oz = r.range(-8, 8);
      g.translate(x + ox, ground(x + ox, z + oz) - 0.4, z + oz);
      vc.push(g.index ? g.toNonIndexed() : g);
    }
  }
  for (let i = 0; i < area * d.ferns; i++) {
    const x = rng.range(0, t.width);
    const z = rng.range(0, t.depth);
    if (!free(x, z, 10) || ctx.keepClear(x, z, 1)) continue;
    const g = fernGeometry(rng.range(60, 150), rng);
    g.translate(x, ground(x, z) - 0.5, z);
    vc.push(g);
  }
  if (vc.length) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    patchDapple(mat);
    const m = new THREE.Mesh(mergeGeometries(vc.map((g) => (g.attributes.uv ? (g.deleteAttribute('uv'), g) : g))), mat);
    m.castShadow = m.receiveShadow = true;
    m.name = 'mapFungiFerns';
    group.add(m);
  }
}

/** True near any water body of the map (for gravel banks). */
export function nearWater(map: MapDef, x: number, z: number, d: number): boolean {
  for (const wb of map.water) if (shapeDist(wb.shape, x, z) < d) return true;
  return false;
}
