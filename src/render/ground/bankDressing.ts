import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from '../../world/terrain';
import { RAMP_SIDE } from '../../world/layers';
import type { DecorClump } from '../mapDecor';
import type { GroundFields } from '../terrainMesh';
import { patchDapple } from '../shaderPatch';
import { GL, bakedSurfacePatch } from './surfacePatch';

/**
 * What a cut bank carries (ground realism item 3; render only, deterministic from the terrain): roots coming out of
 * the upper face and hanging down, pebbles set in the face, a spill of crumbs and small stones at the foot (inside the
 * blocked cliff band, so nothing that looks like an obstacle stands on walkable ground), and grass tufts along the
 * lip whose blades lean out over the edge (handed to the Grass mesh as clumps).
 */

function hash2(i: number, j: number, s: number): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A lumpy stone or crumb: a displaced icosahedron, radius ~1, squashed, coloured. */
function lump(seed: number, rough: number, squash: number, col: THREE.Color, detail = 1): THREE.BufferGeometry {
  // shared vertices (smooth normals, no facets)
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = hash2(Math.round(v.x * 50), Math.round(v.y * 50) + Math.round(v.z * 50) * 7, seed);
    const k = 1 + (n - 0.5) * rough;
    p.setXYZ(i, v.x * k, v.y * k * squash, v.z * k);
  }
  g.computeVertexNormals();
  const c = new Float32Array(p.count * 3);
  const cc = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    cc.copy(col).multiplyScalar(0.8 + 0.35 * hash2(i, seed, 77) + (p.getY(i) > 0 ? 0.08 : -0.12));
    c.set([cc.r, cc.g, cc.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g.toNonIndexed();
}

/** A root: a tapering tube along a curve, bark-coloured, lighter at the broken tip. */
function root(pts: THREE.Vector3[], r0: number, seed: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const seg = Math.max(6, Math.round(curve.getLength() * 1.2));
  const g = new THREE.TubeGeometry(curve, seg, 1, 6, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const ring = 7;
  const c = new Float32Array(p.count * 3);
  const base = new THREE.Color().setRGB(0.36 + 0.08 * hash2(seed, 1, 3), 0.27 + 0.05 * hash2(seed, 2, 3), 0.19, THREE.SRGBColorSpace);
  const tip = new THREE.Color().setRGB(0.62, 0.52, 0.40, THREE.SRGBColorSpace);
  const cc = new THREE.Color();
  const ctr = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const s = Math.floor(i / ring) / seg;
    curve.getPointAt(Math.min(1, s), ctr);
    const r = r0 * (1 - 0.65 * s) * (0.9 + 0.2 * hash2(i, seed, 5));
    p.setXYZ(i, ctr.x + n.getX(i) * r, ctr.y + n.getY(i) * r, ctr.z + n.getZ(i) * r);
    cc.copy(base).lerp(tip, Math.max(0, (s - 0.85) / 0.15)).multiplyScalar(0.85 + 0.25 * hash2(i, seed, 9));
    c.set([cc.r, cc.g, cc.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export interface BankDressing {
  meshes: THREE.Mesh[];
  clumps: DecorClump[];
}

export function buildBankDressing(t: Terrain, f: GroundFields): BankDressing {
  const out: BankDressing = { meshes: [], clumps: [] };
  const L = t.layers;
  if (!L) return out;
  const { nx, ny, res } = t;
  const biome = t.map?.biome ?? 'meadow';
  const H = (x: number, y: number) => t.heightAt(Math.min(Math.max(x, 0), t.width), Math.min(Math.max(y, 0), t.depth));
  const geos: THREE.BufferGeometry[] = [];
  // stones take the baked weathered-stone surface (render/ground/surfacePatch.ts); roots and crumbs their colours
  const stoneGeos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const soilCol = new THREE.Color().setRGB(0.42, 0.33, 0.25, THREE.SRGBColorSpace);
  const sandCol = new THREE.Color().setRGB(0.66, 0.58, 0.46, THREE.SRGBColorSpace);
  const clayCol = new THREE.Color().setRGB(0.50, 0.37, 0.28, THREE.SRGBColorSpace);
  const stoneCols = [0x8a857c, 0x9a8a74, 0x6e6a64, 0xa59a88].map((h) => new THREE.Color(h));
  let lips = 0;
  for (let j = 2; j < ny - 2; j++)
    for (let i = 2; i < nx - 2; i++) {
      const k = j * nx + i;
      if (!L.cliff[k]) continue;
      const x = i * res;
      const y = j * res;
      const gx = (H(x + 1, y) - H(x - 1, y)) / 2;
      const gy = (H(x, y + 1) - H(x, y - 1)) / 2;
      const sl = Math.hypot(gx, gy);
      if (sl < 0.5) continue;
      const ox = -gx / sl; // downhill
      const oz = -gy / sl;
      const top = H(x - ox * 8, y - oz * 8);
      const bot = H(x + ox * 8, y + oz * 8);
      if (top - bot < 8) continue;
      const h = H(x, y);
      const fr = (h - bot) / (top - bot);
      let style = L.bank[k];
      const rp = L.ramp[k];
      if (!style && rp & RAMP_SIDE) style = (rp & (RAMP_SIDE - 1)) === 2 ? 3 : (rp & (RAMP_SIDE - 1)) === 5 ? 4 : 1;
      style = style || 1;
      const r1 = hash2(i, j, 11);
      const r2 = hash2(i, j, 12);
      const r3 = hash2(i, j, 13);
      const ang = Math.atan2(ox, oz);
      // ---- roots out of the upper face (soil banks some, root walls many; none from sand, rock or clay)
      const rootP = style === 3 ? 0.22 : style === 1 ? 0.045 : 0;
      if (fr > 0.55 && fr < 0.92 && r1 < rootP) {
        const r0 = (style === 3 ? 0.5 : 0.25) + r2 * (style === 3 ? 0.9 : 0.35);
        const len = 5 + r3 * (style === 3 ? 16 : 10);
        const side = (hash2(i, j, 14) - 0.5) * 0.8;
        const px = -oz;
        const pz = ox;
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s <= 4; s++) {
          const u = s / 4;
          // out of the face, then curling down under its own weight
          const out_ = -1 + u * len * 0.45;
          const drop = u * u * len * 0.8;
          const lat = side * u * len * 0.4;
          pts.push(new THREE.Vector3(x + ox * out_ + px * lat, h - drop + 0.5, y + oz * out_ + pz * lat));
        }
        geos.push(root(pts, r0, i * 7919 + j));
      }
      // ---- pebbles set in the face
      const pebP = style === 2 ? 0 : style === 4 ? 0.05 : 0.06;
      if (fr > 0.1 && fr < 0.85 && r2 < pebP) {
        const r = 0.8 + r3 * 2.0;
        const g = lump(i * 31 + j, 0.35, 0.7, stoneCols[Math.floor(r1 * 97) % stoneCols.length].clone().multiplyScalar(0.9), 1);
        e.set(r1 * 6, r2 * 6, r3 * 6);
        q.setFromEuler(e);
        sc.set(r, r, r * 0.8);
        pos.set(x + ox * r * 0.35, h, y + oz * r * 0.35);
        m.compose(pos, q, sc);
        stoneGeos.push(g.applyMatrix4(m));
      }
      // ---- the spill at the foot: crumbs and a few stones, piled against the face (still in the blocked band)
      if (fr < 0.22 && r3 < (style === 2 ? 0.12 : 0.3)) {
        const n = 1 + Math.floor(r1 * 3);
        for (let s = 0; s < n; s++) {
          const a = hash2(i, j, 20 + s) * 6.283;
          const d = hash2(i, j, 30 + s) * 2.5;
          const r = 0.5 + hash2(i, j, 40 + s) * (style === 2 ? 2.0 : 1.3);
          const cx = x + Math.cos(a) * d - ox * 0.5;
          const cz = y + Math.sin(a) * d - oz * 0.5;
          const stone = style === 2 || hash2(i, j, 50 + s) < 0.15;
          const col = stone ? stoneCols[s % stoneCols.length] : style === 4 ? sandCol : style === 5 ? clayCol : soilCol;
          const g = lump(i * 131 + j * 7 + s, stone ? 0.3 : 0.6, stone ? 0.75 : 0.55, col.clone().multiplyScalar(0.85 + 0.3 * hash2(i, j, 60 + s)), stone ? 1 : 0);
          e.set(0, a, 0);
          q.setFromEuler(e);
          sc.setScalar(r);
          pos.set(cx, H(cx, cz) + r * 0.15, cz);
          m.compose(pos, q, sc);
          (stone ? stoneGeos : geos).push(g.applyMatrix4(m));
        }
      }
      // ---- grass along the lip of soil banks (meadow, garden, riverbank), leaning out over the edge
      if (fr > 0.9 && (style === 1 || style === 3) && biome !== 'savanna' && r1 < 0.16) {
        const back = 2 + r2 * 3;
        out.clumps.push({ x: x - ox * back, z: y - oz * back, s: 0.35 + r3 * 0.35, kind: r3 < 0.25 && biome !== 'forest' ? 'tall' : 'short' });
        lips++;
      }
      void ang;
    }
  // ---- ramps: paving on stone steps (flush with the walk surface, which stays the heightfield), roots along a root
  // ramp's sides and a few worn ones across it
  for (const [ri, r] of (t.map?.ramps ?? []).entries()) {
    if (r.style !== 'stoneSteps' && r.style !== 'rootRamp') continue;
    const P = r.path;
    // points every 2 mm along the path, with the unit direction
    const pts: Array<[number, number, number, number]> = [];
    for (let i = 1; i < P.length; i++) {
      const dx = P[i][0] - P[i - 1][0];
      const dz = P[i][1] - P[i - 1][1];
      const l = Math.hypot(dx, dz);
      for (let s = 0; s < l; s += 2) pts.push([P[i - 1][0] + (dx * s) / l, P[i - 1][1] + (dz * s) / l, dx / l, dz / l]);
    }
    if (r.style === 'stoneSteps') {
      for (let k = 4; k < pts.length - 4; k += 9) {
        const [x, z, ux, uz] = pts[k];
        const across = Math.max(2, Math.round(r.width / 26));
        for (let a = 0; a < across; a++) {
          if (hash2(k, a, ri + 5) < 0.2) continue; // a stone missing here and there
          const off = ((a + 0.5) / across - 0.5) * r.width * 0.9 + (hash2(k, a, ri) - 0.5) * 4;
          const cx = x - uz * off + ux * (hash2(k, a, 7) - 0.5) * 4;
          const cz = z + ux * off + uz * (hash2(k, a, 8) - 0.5) * 4;
          const rad = Math.min(r.width / across, 14) * (0.5 + 0.12 * hash2(k, a, 9));
          // worn, dirty paving: darker than fresh stone, irregular, sunk to its shoulders
          const g = lump(ri * 977 + k * 13 + a, 0.42, 0.12, stoneCols[(k + a) % stoneCols.length].clone().multiplyScalar(0.62 + 0.15 * hash2(k, a, 11)), 2);
          // tilt with the ramp's slope
          const h0 = H(cx - ux * rad, cz - uz * rad);
          const h1 = H(cx + ux * rad, cz + uz * rad);
          const pitch = Math.atan2(h1 - h0, 2 * rad);
          e.set(0, Math.atan2(ux, uz), 0, 'YXZ');
          q.setFromEuler(e);
          const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch);
          q.multiply(tilt);
          sc.set(rad, rad, rad * (0.9 + 0.2 * hash2(k, a, 10)));
          pos.set(cx, H(cx, cz) + 0.25 - rad * 0.12 * 0.55, cz);
          m.compose(pos, q, sc);
          stoneGeos.push(g.applyMatrix4(m));
        }
      }
    } else {
      // roots along both sides, half sunk; two or three worn ones across the walkway, barely proud of it
      for (const side of [-1, 1]) {
        const line: THREE.Vector3[] = [];
        for (let k = 0; k < pts.length; k += 6) {
          const [x, z, ux, uz] = pts[k];
          const off = side * (r.width / 2 - 1 + (hash2(k, side + 2, ri) - 0.5) * 3);
          const cx = x - uz * off;
          const cz = z + ux * off;
          line.push(new THREE.Vector3(cx, H(cx, cz) - 0.3, cz));
        }
        if (line.length >= 3) geos.push(root(line, 2.2 + hash2(ri, side, 3) * 1.2, ri * 31 + side));
      }
      for (let c = 0; c < 3; c++) {
        const k = Math.floor(((c + 0.6) / 3.2) * pts.length);
        const [x, z, ux, uz] = pts[Math.min(pts.length - 1, k)];
        const line: THREE.Vector3[] = [];
        const skew = (hash2(ri, c, 4) - 0.5) * 0.8;
        for (let s = -1; s <= 1; s += 0.5) {
          const off = s * r.width * 0.55;
          const cx = x - uz * off + ux * off * skew;
          const cz = z + ux * off + uz * off * skew;
          line.push(new THREE.Vector3(cx, H(cx, cz) - 0.9, cz));
        }
        geos.push(root(line, 1.2, ri * 57 + c));
      }
    }
  }
  const build = (list: THREE.BufferGeometry[], name: string, stone: boolean) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    patchDapple(mat);
    if (stone) bakedSurfacePatch(mat, { layer: GL.ROCK, relief: 0.8 });
    const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    out.meshes.push(mesh);
  };
  build(geos, 'bankDressing', false);
  build(stoneGeos, 'bankStones', true);
  void lips;
  void f;
  return out;
}
