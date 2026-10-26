import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, fbm2, valueNoise2 } from '../core/rng';
import type { MapDef, Shape, Wall, WallKind, Walkway } from '../maps/types';
import { shapeBox, shapeDist } from '../world/mapShapes';
import { HF_ENTRANCE, HF_LITTER, HF_CREATURE, HF_SITE, HF_SITE_RING } from '../world/surfaceLayout';
import { Terrain } from '../world/terrain';
import { stoneGeometry } from './props';
import { BIOME_DRESS, BiomeDress, buttressGeometry, leafRaft, litter, moundGeometry, mushroomCluster, nearWater, rootMatGeometry, trunkGeometry } from './mapBiomes';
import { patchDapple } from './shaderPatch';
import { textures } from './textures';

/**
 * Render-only dressing for an authored map (docs/maps/design.md §6): the walls drawn as rocks
 * and logs that fill their outlines, the walkways as stepping stones or floating leaves, lily
 * pads and flowers on still water, and the meadow's grass, reeds, pebbles and wildflowers.
 *
 * Nothing here touches the simulation; placement is seeded from the map id so every player sees
 * the same scene.
 */

/** A grass or reed clump for the Grass mesh. */
export interface DecorClump {
  x: number;
  z: number;
  s: number;
  kind: 'tall' | 'short' | 'reed' | 'dry';
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Polar outline of a shape about its centre: radius as a function of angle (star-shaped outlines). */
function polar(shape: Shape): { cx: number; cz: number; r: (a: number) => number; rMax: number } | null {
  if ('circle' in shape) return { cx: shape.circle[0], cz: shape.circle[1], r: () => shape.r, rMax: shape.r };
  if ('ellipse' in shape) {
    const { rx, ry } = shape;
    const rot = shape.rot ?? 0;
    return { cx: shape.ellipse[0], cz: shape.ellipse[1], r: (a) => (rx * ry) / Math.hypot(ry * Math.cos(a - rot), rx * Math.sin(a - rot)), rMax: Math.max(rx, ry) };
  }
  if ('poly' in shape) {
    const P = shape.poly;
    let cx = 0;
    let cz = 0;
    for (const p of P) (cx += p[0]), (cz += p[1]);
    cx /= P.length;
    cz /= P.length;
    const N = 96;
    const tab = new Float32Array(N + 1);
    let rMax = 0;
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
      rMax = Math.max(rMax, best);
    }
    tab[N] = tab[0];
    return {
      cx,
      cz,
      rMax,
      r: (a) => {
        let u = (a / (Math.PI * 2)) * N;
        u = ((u % N) + N) % N;
        const k = Math.floor(u);
        const f = u - k;
        return tab[k] * (1 - f) + tab[k + 1] * f;
      },
    };
  }
  return null;
}

interface RockLook {
  tint: number;
  moss: number;
  rough: number;
  /** side steepness: higher = flatter top, steeper sides */
  flat: number;
}

const ROCK_LOOK: Partial<Record<WallKind, RockLook>> = {
  rock: { tint: 0x8a8174, moss: 0.9, rough: 0.26, flat: 0.75 },
  stone: { tint: 0xa0968a, moss: 0.5, rough: 0.2, flat: 0.62 },
  termiteMound: { tint: 0xa0703f, moss: 0, rough: 0.16, flat: 0.95 },
  mushrooms: { tint: 0xd9c6a2, moss: 0, rough: 0.1, flat: 0.5 },
  pineCone: { tint: 0x6b4a2c, moss: 0, rough: 0.3, flat: 0.8 },
  buttress: { tint: 0x6a5a48, moss: 0.6, rough: 0.2, flat: 1.2 },
  trunk: { tint: 0x5e4e3e, moss: 0.6, rough: 0.12, flat: 1.4 },
};

/**
 * A boulder whose footprint follows an outline: a displaced sphere stretched so its widest ring
 * matches the outline, its top at `height` above the ground, its foot sunk into the soil.
 * `ground(x, z)` gives the height the foot follows; `base` (if set) is a flat foot height instead.
 */
export function outlineRock(shape: Shape, height: number, seed: number, look: RockLook, ground: (x: number, z: number) => number, base?: number): THREE.BufferGeometry | null {
  const o = polar(shape);
  if (!o) return null;
  const detail = Math.max(4, Math.min(12, Math.round(o.rMax / 7)));
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const sx = (seed % 89) * 1.7;
  const sz = (seed % 53) * 2.3;
  const gMid = base ?? ground(o.cx, o.cz);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm2(v.x * 1.7 + sx, v.z * 1.7 + v.y * 1.3 + sz, 4, seed);
    const facet = Math.floor(valueNoise2(v.x * 2.3 + sx, v.y * 2.3 + v.z * 1.9, seed + 3) * 4) / 4;
    const r = 1 + (n - 0.5) * look.rough + (facet - 0.4) * look.rough * 0.4;
    const a = Math.atan2(v.z, v.x);
    const R = o.r(a);
    const up = v.y >= 0;
    // flatter top, steeper sides: push the horizontal radius out toward the outline higher up
    const hy = Math.abs(v.y);
    const side = up ? Math.pow(Math.max(0, 1 - hy * hy), 0.5 / (1 + look.flat)) : Math.sqrt(Math.max(0, 1 - hy * hy));
    const x = o.cx + Math.cos(a) * side * R * r;
    const z = o.cz + Math.sin(a) * side * R * r;
    const foot = base ?? ground(x, z);
    const y = up ? foot - 1.2 + (gMid + height - foot + 1.2) * Math.pow(hy, 0.9) * r : foot - 1.2 - hy * height * 0.15;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  // vertex colour: tint, darker foot, moss on top, lichen
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const tint = new THREE.Color(look.tint);
  const mossC = new THREE.Color(0x56702c);
  const lichen = new THREE.Color(0xbdb88a);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const ny = nrm.getY(i);
    const rel = Math.max(0, Math.min(1, (y - gMid) / Math.max(1, height)));
    c.copy(tint).multiplyScalar((0.62 + 0.38 * Math.min(1, rel * 2.5)) * (0.88 + 0.24 * valueNoise2(x * 0.08, z * 0.08 + y * 0.05, seed + 7)));
    const m = look.moss * Math.max(0, (ny - 0.45) * 2.2) * Math.max(0, fbm2(x * 0.05, z * 0.05, 3, seed + 5) * 1.8 - 0.55);
    c.lerp(mossC, Math.min(0.9, m));
    if (look.moss > 0 && valueNoise2(x * 0.45, y * 0.45 + z * 0.45, seed + 11) > 0.82) c.lerp(lichen, 0.55);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Box-projected uvs per triangle (by its face normal), so no triangle mixes two projections
  // and smears the texture; the smooth vertex normals are kept.
  const f = g.toNonIndexed();
  const fp = f.attributes.position as THREE.BufferAttribute;
  const fuv = new Float32Array(fp.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const S = 46;
  for (let i = 0; i < fp.count; i += 3) {
    a.fromBufferAttribute(fp, i);
    b.fromBufferAttribute(fp, i + 1);
    c2.fromBufferAttribute(fp, i + 2);
    const n = b.clone().sub(a).cross(c2.clone().sub(a));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const x = fp.getX(i + k);
      const y = fp.getY(i + k);
      const z = fp.getZ(i + k);
      if (ay >= ax && ay >= az) fuv.set([x / S, z / S], (i + k) * 2);
      else if (ax >= az) fuv.set([z / S, y / S], (i + k) * 2);
      else fuv.set([x / S, y / S], (i + k) * 2);
    }
  }
  f.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
  return f;
}

/** A log or trunk lying along a path: bark tube per segment, ends capped. */
function pathLog(shape: Shape, ground: (x: number, z: number) => number, seed: number): THREE.BufferGeometry[] {
  if (!('path' in shape)) return [];
  const out: THREE.BufferGeometry[] = [];
  const r = shape.width / 2;
  const P = shape.path;
  for (let i = 0; i + 1 < P.length; i++) {
    const [x0, z0] = P[i];
    const [x1, z1] = P[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0) + r * 0.6;
    const rng = new Rng(seed + i * 17);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 4; k++) pts.push(new THREE.Vector3((k / 4 - 0.5) * len, 0, Math.sin((k / 4) * Math.PI) * rng.range(-0.04, 0.04) * len));
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len / 8)), r, 20, false);
    const rot = Math.atan2(z1 - z0, x1 - x0);
    const h0 = ground(x0, z0);
    const h1 = ground(x1, z1);
    g.rotateZ(Math.atan2(h1 - h0, len));
    g.rotateY(-rot);
    g.translate((x0 + x1) / 2, (h0 + h1) / 2 + r * 0.72, (z0 + z1) / 2);
    const col = new Float32Array(g.attributes.position.count * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.push(g);
  }
  return out;
}

/** Lily pad: a disc with its notch, the rim turned up a little, veins in vertex colour. */
function lilyPad(r: number, rng: Rng): THREE.BufferGeometry {
  const seg = 28;
  const notch = rng.range(0.22, 0.4);
  const pos: number[] = [0, 0.05 * r, 0];
  const col: number[] = [];
  const base = new THREE.Color().setHSL(rng.range(0.23, 0.29), rng.range(0.55, 0.7), rng.range(0.12, 0.18));
  const rim = rng.chance(0.35) ? new THREE.Color(0x5a2418) : base.clone().multiplyScalar(0.7);
  col.push(base.r * 1.2, base.g * 1.2, base.b * 1.2);
  const idx: number[] = [];
  const rings = 3;
  for (let k = 1; k <= rings; k++) {
    const t = k / rings;
    for (let i = 0; i <= seg; i++) {
      const a = notch / 2 + (i / seg) * (Math.PI * 2 - notch);
      const wob = 1 + 0.03 * Math.sin(a * 5 + r);
      const rr = r * t * wob;
      pos.push(Math.cos(a) * rr, t === 1 ? 0.12 * r * 0.15 : 0, Math.sin(a) * rr);
      const vein = 0.9 + 0.1 * Math.cos(a * 22);
      const c = base.clone().multiplyScalar(vein * (1.15 - 0.2 * t));
      if (k === rings) c.lerp(rim, 0.5);
      col.push(c.r, c.g, c.b);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < seg; i++) idx.push(0, 1 + i + 1, 1 + i);
  for (let k = 0; k < rings - 1; k++)
    for (let i = 0; i < seg; i++) {
      const a = 1 + k * row + i;
      const b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Water-lily flower: two rings of pointed petals round a yellow heart. */
function lilyFlower(size: number, rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const petal = new THREE.Color(rng.chance(0.5) ? 0xf4eee6 : 0xf2c6d0);
  for (const [n, lift, len] of [
    [8, 0.35, 1],
    [7, 0.9, 0.8],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + lift;
      const g = new THREE.BufferGeometry();
      const L = size * len;
      const w = size * 0.22;
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, L * 0.5, L * 0.18, w, L, L * 0.45 * lift, 0, L * 0.5, L * 0.18, -w], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.rotateY(-a);
      const c = petal.clone().multiplyScalar(0.9 + 0.1 * rng.next());
      g.setAttribute('color', new THREE.Float32BufferAttribute([c.r * 0.8, c.g * 0.8, c.b * 0.8, c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b], 3));
      parts.push(g.toNonIndexed());
    }
  }
  const heart = new THREE.SphereGeometry(size * 0.22, 8, 5);
  heart.deleteAttribute('uv');
  const hc = new Float32Array(heart.attributes.position.count * 3);
  for (let i = 0; i < heart.attributes.position.count; i++) hc.set([0.95, 0.75, 0.2], i * 3);
  heart.setAttribute('color', new THREE.BufferAttribute(hc, 3));
  heart.translate(0, size * 0.18, 0);
  parts.push(heart.toNonIndexed());
  const g = mergeGeometries(parts.map((q) => (q.attributes.normal ? q : (q.computeVertexNormals(), q))));
  g.computeVertexNormals();
  return g;
}

/** Meadow flower on a stem: daisy, buttercup or clover head. */
function flower(kind: number, h: number, rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    if (g.attributes.uv) g.deleteAttribute('uv');
    const a = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const stem = new THREE.CylinderGeometry(0.35, 0.55, h, 4, 3);
  const sp = stem.attributes.position as THREE.BufferAttribute;
  const bend = rng.range(-0.12, 0.12) * h;
  for (let i = 0; i < sp.count; i++) {
    const t = sp.getY(i) / h + 0.5;
    sp.setX(i, sp.getX(i) + bend * t * t);
  }
  stem.translate(0, h / 2, 0);
  parts.push(paint(stem, new THREE.Color(0x4d7a2a)));
  const top = new THREE.Vector3(bend, h, 0);
  if (kind === 0) {
    // daisy: white ray petals, yellow disc
    const n = 13;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pg = new THREE.PlaneGeometry(3.2, 0.9);
      pg.rotateX(-Math.PI / 2 + 0.15);
      pg.translate(2.1, 0, 0);
      pg.rotateY(a);
      pg.translate(top.x, top.y, top.z);
      parts.push(paint(pg, new THREE.Color(0xf6f3ea)));
    }
    const d = new THREE.SphereGeometry(1.1, 8, 4);
    d.scale(1, 0.5, 1);
    d.translate(top.x, top.y + 0.2, top.z);
    parts.push(paint(d, new THREE.Color(0xe9b922)));
  } else if (kind === 1) {
    // buttercup: five glossy yellow petals in a cup
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pg = new THREE.CircleGeometry(1.5, 6);
      pg.rotateX(-Math.PI / 2 + 0.75);
      pg.translate(0, 0.9, 1.3);
      pg.rotateY(a);
      pg.translate(top.x, top.y, top.z);
      parts.push(paint(pg, new THREE.Color(0xf2c81c)));
    }
  } else {
    // clover head: a round pink-purple tuft
    const d = new THREE.IcosahedronGeometry(2.1, 1);
    d.translate(top.x, top.y + 1.2, top.z);
    parts.push(paint(d, new THREE.Color().setHSL(rng.range(0.86, 0.93), 0.45, rng.range(0.6, 0.7))));
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

export class MapDecor {
  group = new THREE.Group();
  /** grass, sprout and reed clumps for the Grass mesh */
  clumps: DecorClump[] = [];

  constructor(private terrain: Terrain) {
    const map = terrain.map;
    if (!map) return;
    const rng = new Rng(hashStr(map.id) ^ 0x5eed);
    const tex = textures();
    const ground = (x: number, z: number) => terrain.heightAt(Math.min(Math.max(x, 0), terrain.width), Math.min(Math.max(z, 0), terrain.depth));

    const dress = BIOME_DRESS[map.biome] ?? BIOME_DRESS.meadow;
    this.walls(map, ground, tex);
    this.walkways(map, terrain, tex);
    this.stillWater(map, rng, dress);
    this.meadow(map, rng, ground, tex, dress);
  }

  private walls(map: MapDef, ground: (x: number, z: number) => number, tex: ReturnType<typeof textures>): void {
    const rockGeos: THREE.BufferGeometry[] = [];
    const logGeos: THREE.BufferGeometry[] = [];
    const vcGeos: THREE.BufferGeometry[] = [];
    const moundGeos: THREE.BufferGeometry[] = [];
    map.walls.forEach((w: Wall, i) => {
      if (w.kind === 'buttress') {
        const g = buttressGeometry(w.shape, w.height, ground);
        if (g) logGeos.push(g);
        return;
      }
      if ('path' in w.shape) {
        logGeos.push(...pathLog(w.shape, ground, 900 + i));
        return;
      }
      if (w.kind === 'trunk') {
        const g = trunkGeometry(w.shape, w.height, ground, 1000 + i * 37);
        if (g) logGeos.push(g);
        return;
      }
      if (w.kind === 'mushrooms') {
        const g = mushroomCluster(w.shape, w.height, ground, 1000 + i * 37);
        if (g) vcGeos.push(g);
        return;
      }
      if (w.kind === 'termiteMound') {
        const g = moundGeometry(w.shape, w.height, ground, 1000 + i * 37);
        if (g) moundGeos.push(g);
        return;
      }
      const look = ROCK_LOOK[w.kind] ?? ROCK_LOOK.rock!;
      const g = outlineRock(w.shape, w.height, 1000 + i * 37, look, ground);
      if (g) rockGeos.push(g);
    });
    if (vcGeos.length) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(vcGeos), mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'mapMushrooms';
      this.group.add(m);
    }
    if (moundGeos.length) {
      const mat = new THREE.MeshStandardMaterial({ map: tex.soil.map, normalMap: tex.soil.normal, roughness: 0.95, vertexColors: true });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(moundGeos), mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'mapMounds';
      this.group.add(m);
    }
    if (rockGeos.length) {
      const mat = new THREE.MeshStandardMaterial({ map: tex.stone.map, normalMap: tex.stone.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.88, vertexColors: true });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(rockGeos), mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'mapRocks';
      this.group.add(m);
    }
    if (logGeos.length) {
      const mat = new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, roughness: 0.9, vertexColors: true, normalScale: new THREE.Vector2(1.5, 1.5) });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(logGeos.map(barkReady)), mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'mapLogs';
      this.group.add(m);
    }
  }

  /** Walkways: overlapping flat stones (or a floating leaf) covering the whole path, tops at the walk height. */
  private walkways(map: MapDef, terrain: Terrain, tex: ReturnType<typeof textures>): void {
    const geos: THREE.BufferGeometry[] = [];
    const roots: THREE.BufferGeometry[] = [];
    const leaves: THREE.BufferGeometry[] = [];
    map.walkways.forEach((wk: Walkway, wi) => {
      if (!('path' in wk.shape)) return;
      const P = wk.shape.path;
      const w = wk.shape.width;
      let level = -9999;
      for (const wb of map.water) level = Math.max(level, wb.level);
      const top = level + 0.6;
      if (wk.kind === 'rootMat') {
        roots.push(...rootMatGeometry(P, w, top, 7000 + wi * 131));
        return;
      }
      if (wk.kind === 'leaf') {
        leaves.push(leafRaft(P, w, top, 7000 + wi * 131));
        return;
      }
      const rng = new Rng(7000 + wi * 131);
      for (let s = 0; s + 1 < P.length; s++) {
        const [x0, z0] = P[s];
        const [x1, z1] = P[s + 1];
        const L = Math.hypot(x1 - x0, z1 - z0);
        const dx = (x1 - x0) / L;
        const dz = (z1 - z0) / L;
        const n = Math.max(2, Math.ceil(L / (w * 0.72)));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const j = rng.range(-0.06, 0.06) * w;
          const cx = x0 + dx * (t * L) - dz * j;
          const cz = z0 + dz * (t * L) + dx * j;
          const rx = (L / n) * 0.5 * rng.range(1.3, 1.5);
          const rz = (w / 2) * rng.range(1.15, 1.3);
          // a flat foot at the lowest ground under the stone; land at the ends buries it
          let lo = 9999;
          for (let a = 0; a < 8; a++) lo = Math.min(lo, terrain.heightAt(cx + Math.cos(a) * rx, cz + Math.sin(a) * rz));
          lo = Math.min(lo, top - 3);
          // an irregular flat stone: an ellipse with a lumpy edge
          const rot = Math.atan2(dz, dx) + rng.range(-0.3, 0.3);
          const ph = rng.range(0, 6.28);
          const poly: Array<[number, number]> = [];
          for (let k = 0; k < 14; k++) {
            const a = (k / 14) * Math.PI * 2;
            const wob = 1 + 0.1 * Math.sin(3 * a + ph) + 0.06 * Math.sin(5 * a + ph * 1.7);
            const ex = Math.cos(a) * rx * wob;
            const ez = Math.sin(a) * rz * wob;
            poly.push([cx + ex * Math.cos(rot) - ez * Math.sin(rot), cz + ex * Math.sin(rot) + ez * Math.cos(rot)]);
          }
          const g = outlineRock({ poly }, top + 0.5 - lo, 3000 + wi * 50 + s * 7 + i, { tint: rng.chance(0.5) ? 0x857d72 : 0x7a756d, moss: 0.45, rough: 0.2, flat: 1.7 }, () => lo, lo);
          if (g) geos.push(g);
        }
      }
    });
    if (geos.length) {
      const mat = new THREE.MeshStandardMaterial({ map: tex.stone.map, normalMap: tex.stone.normal, roughness: 0.7, vertexColors: true });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'mapWalkways';
      this.group.add(m);
    }
    if (roots.length) {
      const mat = new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, roughness: 0.85, vertexColors: true });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(roots.map(barkReady)), mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'mapRootMats';
      this.group.add(m);
    }
    if (leaves.length) {
      const mat = new THREE.MeshStandardMaterial({ map: tex.leaves.map, normalMap: tex.leaves.normal, roughness: 0.6, side: THREE.DoubleSide });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(leaves), mat);
      m.castShadow = m.receiveShadow = true;
      m.renderOrder = 3;
      m.name = 'mapLeafRafts';
      this.group.add(m);
    }
  }

  private nearWalkway(map: MapDef, x: number, z: number, m: number): boolean {
    for (const wk of map.walkways) if (shapeDist(wk.shape, x, z) < m) return true;
    return false;
  }

  /** Lily pads and flowers on ponds and pools, reeds along every shore. */
  private stillWater(map: MapDef, rng: Rng, dress: BiomeDress): void {
    const pads: THREE.BufferGeometry[] = [];
    for (const wb of map.water) {
      const box = shapeBox(wb.shape, 0);
      if (wb.kind === 'pond' || wb.kind === 'pool') {
        const area = (box.x1 - box.x0) * (box.y1 - box.y0);
        const clusters = Math.max(2, Math.round(area / 45000));
        const placed: Array<[number, number, number]> = [];
        for (let c = 0; c < clusters; c++) {
          let cx = 0;
          let cz = 0;
          // lilies gather in the shallows: a cluster centre 35–120 mm in from the shore
          for (let k = 0; k < 60; k++) {
            cx = rng.range(box.x0, box.x1);
            cz = rng.range(box.y0, box.y1);
            const d = shapeDist(wb.shape, cx, cz);
            if (d < -35 && d > -120) break;
          }
          const n = rng.int(5, 11);
          for (let i = 0; i < n * 3 && n > 0; i++) {
            const r = rng.range(8, 21);
            const a = rng.range(0, Math.PI * 2);
            const d = Math.sqrt(rng.next()) * 70;
            const x = cx + Math.cos(a) * d;
            const z = cz + Math.sin(a) * d;
            if (shapeDist(wb.shape, x, z) > -(r + 3)) continue;
            if (this.nearWalkway(map, x, z, r + 14)) continue;
            // neighbours may overlap a little (each a hair higher than the last: no flicker)
            if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + r - 0.25 * Math.min(pr, r))) continue;
            placed.push([x, z, r]);
            const g = lilyPad(r, rng);
            g.rotateY(rng.range(0, Math.PI * 2));
            g.translate(x, wb.level + 0.18 + placed.length * 0.012, z);
            pads.push(g);
            if (rng.chance(0.14)) {
              const f = lilyFlower(r * rng.range(0.45, 0.6), rng);
              f.rotateY(rng.range(0, 6.28));
              f.translate(x + rng.range(-0.3, 0.3) * r, wb.level + 0.4, z + rng.range(-0.3, 0.3) * r);
              pads.push(f);
            }
          }
        }
      }
      // reeds in patches along the shore (a few mm into the water to a little up the bank)
      this.shoreReeds(map, wb.shape, Math.min(1.6, (wb.kind === 'stream' ? 0.45 : 0.7) * dress.reeds), rng);
    }
    if (pads.length) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, side: THREE.DoubleSide });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(pads), mat);
      m.receiveShadow = true;
      m.castShadow = true;
      m.renderOrder = 3;
      m.name = 'mapLilies';
      this.group.add(m);
    }
  }

  private keepClear(x: number, z: number, extra = 0): boolean {
    const L = this.terrain.layout;
    if (!L) return false;
    const f = L.flagsAt(x, z);
    if (f & (HF_SITE | HF_ENTRANCE)) return true;
    if (extra > 0 && f & HF_SITE_RING) return true;
    return false;
  }

  private shoreReeds(map: MapDef, shape: Shape, density: number, rng: Rng): void {
    const pts: Array<[number, number, number, number]> = []; // x, z, outward normal x, z
    const walk = (P: readonly (readonly [number, number])[], closed: boolean, offset: number) => {
      const m = closed ? P.length : P.length - 1;
      for (let i = 0; i < m; i++) {
        const [x0, z0] = P[i];
        const [x1, z1] = P[(i + 1) % P.length];
        const L = Math.hypot(x1 - x0, z1 - z0);
        const nx = (z1 - z0) / L;
        const nz = -(x1 - x0) / L;
        for (let s = 0; s < L; s += 7) {
          const t = s / L;
          const x = x0 + (x1 - x0) * t;
          const z = z0 + (z1 - z0) * t;
          if (offset) {
            pts.push([x + nx * offset, z + nz * offset, nx, nz]);
            pts.push([x - nx * offset, z - nz * offset, -nx, -nz]);
          } else pts.push([x, z, nx, nz]);
        }
      }
    };
    if ('poly' in shape) walk(shape.poly, true, 0);
    else if ('path' in shape) walk(shape.path, false, shape.width / 2);
    else return;
    const seed = rng.int(0, 1 << 20);
    for (const [x, z, nx, nz] of pts) {
      // make the normal point out of the water
      const sgn = shapeDist(shape, x + nx * 4, z + nz * 4) > shapeDist(shape, x - nx * 4, z - nz * 4) ? 1 : -1;
      const patch = fbm2(x / 90, z / 90, 3, seed);
      if (patch < 1 - 0.55 * density) continue;
      if (this.nearWalkway(map, x, z, 26)) continue;
      const off = rng.range(-9, 5);
      const rx = x + nx * sgn * off;
      const rz = z + nz * sgn * off;
      if (this.keepClear(rx, rz, 1)) continue;
      if (rng.chance(0.55)) this.clumps.push({ x: rx, z: rz, s: rng.range(0.6, 1.2), kind: 'reed' });
    }
  }

  /** Grass clumps (long grass toward the edges and in the creature and litter zones), pebbles, wildflowers, litter. */
  private meadow(map: MapDef, rng: Rng, ground: (x: number, z: number) => number, tex: ReturnType<typeof textures>, d: BiomeDress): void {
    const t = this.terrain;
    const W = t.width;
    const D = t.depth;
    const L = t.layout;
    const free = (x: number, z: number, m = 6) => {
      if (x < 2 || z < 2 || x > W - 2 || z > D - 2) return false;
      if (t.isWater(x, z) || t.isBlocked(x, z)) return false;
      for (const wb of map.water) if (shapeDist(wb.shape, x, z) < 10) return false;
      for (const wl of map.walls) if (shapeDist(wl.shape, x, z) < 1) return false;
      if (this.nearWalkway(map, x, z, m)) return false;
      return true;
    };
    const area = (W * D) / 1e4;
    // long grass
    const clumps = Math.round(area * d.grass);
    for (let i = 0; i < clumps; i++) {
      let x = rng.range(0, W);
      let z = rng.range(0, D);
      if (rng.chance(d.edge)) {
        const side = rng.int(0, 3);
        const u = rng.range(0, 1);
        const inset = Math.abs(rng.gauss()) * 70;
        if (side === 0) (x = u * W), (z = inset);
        else if (side === 1) (x = u * W), (z = D - inset);
        else if (side === 2) (x = inset), (z = u * D);
        else (x = W - inset), (z = u * D);
      }
      if (!free(x, z, 8) || this.keepClear(x, z, 1)) continue;
      const zone = L ? L.flagsAt(x, z) : 0;
      const tall = zone & (HF_CREATURE | HF_LITTER) || fbm2(x / 160, z / 160, 3, 77) > 0.56;
      this.clumps.push({ x, z, s: rng.range(0.6, 1.4) * (tall ? 1.15 : 0.8), kind: d.dry ? 'dry' : tall || rng.chance(0.45) ? 'tall' : 'short' });
    }
    // grass hugging the rocks' feet
    for (const wl of map.walls) {
      const o = polar(wl.shape);
      if (!o) continue;
      const n = Math.round(o.rMax / 6);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = o.r(a) + rng.range(1, 9);
        const x = o.cx + Math.cos(a) * r;
        const z = o.cz + Math.sin(a) * r;
        if (free(x, z) && !this.keepClear(x, z, 1) && d.grass > 0.5) this.clumps.push({ x, z, s: rng.range(0.4, 0.9), kind: d.dry ? 'dry' : rng.chance(0.5) ? 'tall' : 'short' });
      }
    }

    // pebbles: a light scatter, scree round the rocks, gravel on the shores
    const peb: Array<[number, number, number]> = [];
    for (let i = 0; i < area * d.pebbles; i++) {
      const x = rng.range(0, W);
      const z = rng.range(0, D);
      if (free(x, z, 3)) peb.push([x, z, 0.5 + Math.pow(rng.next(), 3) * 2.8]);
    }
    // gravel banks along running water (riverbank)
    if (d.reeds > 1)
      for (let i = 0; i < area * 12; i++) {
        const x = rng.range(0, W);
        const z = rng.range(0, D);
        if (nearWater(map, x, z, 45) && !nearWater(map, x, z, 9) && free(x, z, 3)) peb.push([x, z, 0.6 + Math.pow(rng.next(), 2) * 3.2]);
      }
    for (const wl of map.walls) {
      const o = polar(wl.shape);
      if (!o) continue;
      for (let i = 0; i < o.rMax * 0.5; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = o.r(a) + Math.abs(rng.gauss()) * 10 + 1;
        const x = o.cx + Math.cos(a) * r;
        const z = o.cz + Math.sin(a) * r;
        if (free(x, z, 3)) peb.push([x, z, 0.8 + Math.pow(rng.next(), 2) * 4]);
      }
    }
    if (peb.length) {
      const stoneMat = new THREE.MeshStandardMaterial({ map: tex.stone.map, normalMap: tex.stone.normal, roughness: 0.8, metalness: 0 });
      patchDapple(stoneMat);
      const variants = [0, 1, 2, 3].map((i) => stoneGeometry(400 + i, 2, 0.35, 0.62));
      const per: Array<Array<[number, number, number]>> = [[], [], [], []];
      peb.forEach((p, i) => per[i % 4].push(p));
      const tints = [0x9a8f80, 0x7d6e5c, 0xb3a58f, 0x6b6560, 0x8c7a62, 0xa89880];
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const s = new THREE.Vector3();
      const pv = new THREE.Vector3();
      const col = new THREE.Color();
      per.forEach((list, vi) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(variants[vi], stoneMat, list.length);
        list.forEach(([x, z, sc], i) => {
          e.set(rng.range(-0.3, 0.3), rng.range(0, 6.28), rng.range(-0.3, 0.3));
          q.setFromEuler(e);
          s.setScalar(sc);
          pv.set(x, ground(x, z) + sc * 0.1, z);
          m4.compose(pv, q, s);
          im.setMatrixAt(i, m4);
          col.setHex(tints[(i + vi) % tints.length]).multiplyScalar(0.8 + 0.4 * rng.next());
          im.setColorAt(i, col);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.name = 'mapPebbles';
        this.group.add(im);
      });
    }

    // wildflowers in drifts
    const fl: THREE.BufferGeometry[] = [];
    const drifts = Math.round(area * d.flowers);
    for (let d = 0; d < drifts; d++) {
      const cx = rng.range(40, W - 40);
      const cz = rng.range(40, D - 40);
      const kind = rng.int(0, 1);
      const n = rng.int(3, 9);
      for (let i = 0; i < n; i++) {
        const x = cx + rng.gauss() * 26;
        const z = cz + rng.gauss() * 26;
        if (!free(x, z, 10) || this.keepClear(x, z, 1)) continue;
        const g = flower(kind, rng.range(26, 62), rng);
        g.rotateY(rng.range(0, 6.28));
        g.translate(x, ground(x, z) - 0.5, z);
        fl.push(g);
      }
    }
    if (fl.length) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(fl), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = 'mapFlowers';
      this.group.add(m);
    }
    // fallen leaves, twigs, fungi and ferns
    litter({ map, terrain: t, rng, ground, free: (x, z, m2 = 6) => free(x, z, m2), keepClear: (x, z, r = 0) => this.keepClear(x, z, r) }, d, this.group);
  }
}

/** Bark meshes merged together need the same attributes: position, normal, uv, colour. */
function barkReady(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) g = g.toNonIndexed();
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
