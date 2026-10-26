import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, fbm2, valueNoise2 } from '../core/rng';
import { Prop, Terrain } from '../world/terrain';
import { patchDapple } from './shaderPatch';
import { textures } from './textures';

/** Displaced, squashed icosphere: pebbles and rocks. */
export function stoneGeometry(seed: number, detail: number, rough: number, squash: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const a = (seed % 97) * 3.1;
  const stretch = 0.75 + valueNoise2(seed, 1) * 0.5;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm2(v.x * 1.6 + a, v.z * 1.6 + v.y * 1.3 - a, 4, seed);
    const facet = Math.floor(valueNoise2(v.x * 2.1 + a, v.y * 2.1 + v.z * 1.7, seed + 3) * 4) / 4;
    const r = 1 + (n - 0.5) * rough + (facet - 0.4) * rough * 0.35;
    v.multiplyScalar(r);
    v.x *= stretch;
    v.y *= squash;
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3; // flat-ish bottom embedded in soil
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Twig/log: a tapered tube along a gently bent path, bark-textured. */
export function branchGeometry(len: number, radius: number, rng: Rng, radial = 10, endCaps = false): THREE.BufferGeometry {
  const segs = Math.max(6, Math.round(len / 6));
  const pts: THREE.Vector3[] = [];
  const bend = rng.range(-0.08, 0.08) * len;
  const bend2 = rng.range(-0.04, 0.04) * len;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3((t - 0.5) * len, Math.sin(t * Math.PI) * bend2 * 0.3, Math.sin(t * Math.PI) * bend + Math.sin(t * 6.2) * bend2));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(segs, false);
  const circ = 2 * Math.PI * radius;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const taper = 1 - 0.35 * t + 0.08 * Math.sin(t * 17 + radius);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const knot = 1 + 0.05 * valueNoise2(t * 30, j * 0.9, 5);
      const r = radius * taper * knot;
      const nx = Math.cos(a) * N.x + Math.sin(a) * B.x;
      const ny = Math.cos(a) * N.y + Math.sin(a) * B.y;
      const nz = Math.cos(a) * N.z + Math.sin(a) * B.z;
      pos.push(c.x + nx * r, c.y + ny * r, c.z + nz * r);
      nrm.push(nx, ny, nz);
      const uRep = Math.max(1, Math.round(circ / 40));
      uv.push((j / radial) * uRep, (t * len) / Math.max(circ / uRep, 1e-3));
      col.push(1, 1, 1);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  if (endCaps) {
    for (const end of [0, 1]) {
      const t = end;
      const c = curve.getPointAt(t);
      const T = curve.getTangentAt(t).multiplyScalar(end === 0 ? -1 : 1);
      const N = frames.normals[end === 0 ? 0 : segs];
      const B = frames.binormals[end === 0 ? 0 : segs];
      const taper = 1 - 0.35 * t;
      const ci = pos.length / 3;
      pos.push(c.x, c.y, c.z);
      nrm.push(T.x, T.y, T.z);
      uv.push(0.5, 0.5);
      col.push(1.9, 1.5, 1.1); // pale heartwood (vertex colour multiplies the bark map)
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const r = radius * taper * 0.97;
        pos.push(c.x + (Math.cos(a) * N.x + Math.sin(a) * B.x) * r, c.y + (Math.cos(a) * N.y + Math.sin(a) * B.y) * r, c.z + (Math.cos(a) * N.z + Math.sin(a) * B.z) * r);
        nrm.push(T.x, T.y, T.z);
        uv.push(0.5 + Math.cos(a) * 0.02, 0.5 + Math.sin(a) * 0.02);
        col.push(1.2, 0.95, 0.75);
      }
      for (let j = 0; j < radial; j++) {
        if (end === 0) idx.push(ci, ci + 2 + j, ci + 1 + j);
        else idx.push(ci, ci + 1 + j, ci + 2 + j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

type LeafShape = 'oak' | 'beech' | 'willow' | 'birch';

function leafWidth(shape: LeafShape, v: number): number {
  const s = Math.sin(Math.PI * Math.pow(v, 0.85));
  switch (shape) {
    case 'oak': {
      const lobes = 0.78 + 0.22 * Math.cos(v * Math.PI * 9);
      return 0.42 * s * lobes;
    }
    case 'beech':
      return 0.36 * s * (1 + 0.03 * Math.sin(v * 70));
    case 'willow':
      return 0.14 * s;
    case 'birch': {
      const tri = v < 0.35 ? v / 0.35 : 1 - (v - 0.35) / 0.65;
      return 0.4 * Math.pow(Math.max(0, tri), 0.8) * (1 + 0.06 * Math.sin(v * 90));
    }
  }
}

/** Fallen leaf: outline-cut grid, curled edges, petiole, atlas UVs. */
export function leafGeometry(size: number, cell: number, cols: number, rows: number, rng: Rng): THREE.BufferGeometry {
  const shapes: LeafShape[] = ['oak', 'beech', 'willow', 'birch'];
  const shape = shapes[cell % 4];
  const nu = 8;
  const nv = 14;
  const curl = rng.range(0.05, 0.35);
  const twist = rng.range(-0.25, 0.25);
  const lift = rng.range(0.0, 0.18);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cu = (cell % cols) / cols;
  const cv = Math.floor(cell / cols) / rows;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const w = leafWidth(shape, v);
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * 2 - 1;
      const x = u * w;
      const z = (v - 0.5);
      // curl edges up, fold along midrib, curl tip
      const y = curl * Math.pow(Math.abs(u), 2) * w * 2 + lift * Math.pow(v, 3) + twist * u * w * (v - 0.5);
      pos.push(x * size, y * size, z * size);
      // Atlas: texture midrib is the vertical centre line of the cell.
      uv.push(cu + (0.5 + x * 1.05) / cols, cv + (1 - (0.02 + v * 0.96)) / rows);
    }
  }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // Petiole: a thin strip extending from the base.
  const base = pos.length / 3;
  const pl = size * 0.12;
  pos.push(-size * 0.008, 0, -size * 0.5, size * 0.008, 0, -size * 0.5, -size * 0.004, size * 0.01, -size * 0.5 - pl, size * 0.004, size * 0.01, -size * 0.5 - pl);
  uv.push(cu + 0.5 / cols, cv + 0.99 / rows, cu + 0.5 / cols, cv + 0.99 / rows, cu + 0.5 / cols, cv + 0.99 / rows, cu + 0.5 / cols, cv + 0.99 / rows);
  idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Mushroom: lathe stem + cap, gills as radial stripes in vertex colour. */
export function mushroomGeometry(size: number, rng: Rng): THREE.BufferGeometry {
  const capR = size * 0.5;
  const stemH = size * rng.range(0.7, 1.1);
  const stemR = size * 0.08;
  const radial = 48;
  const capCol = new THREE.Color().setHSL(rng.range(0.05, 0.1), rng.range(0.35, 0.6), rng.range(0.3, 0.5));
  const capDark = capCol.clone().multiplyScalar(0.55);
  const pale = new THREE.Color(0xe8dcc4);
  const stemPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    stemPts.push(new THREE.Vector2(stemR * (1.25 - 0.35 * t + 0.25 * Math.pow(1 - t, 6)), t * stemH));
  }
  const stem = new THREE.LatheGeometry(stemPts, 20);
  const sc = new Float32Array(stem.attributes.position.count * 3);
  for (let i = 0; i < stem.attributes.position.count; i++) {
    const y = stem.attributes.position.getY(i) / stemH;
    const c = pale.clone().multiplyScalar(0.85 + 0.15 * y);
    sc.set([c.r, c.g, c.b], i * 3);
  }
  stem.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  // Cap profile: from the stem outward under (gills), around the rim, over the dome.
  const capPts: THREE.Vector2[] = [];
  const conv = rng.range(0.35, 0.6);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    capPts.push(new THREE.Vector2(stemR + (capR - stemR) * t, stemH - size * 0.03 + t * t * size * 0.05));
  }
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = t * Math.PI * 0.5;
    capPts.push(new THREE.Vector2(capR * Math.cos(a) * (1 - 0.04 * Math.sin(t * 9)), stemH + size * 0.02 + Math.sin(a) * capR * conv));
  }
  capPts.push(new THREE.Vector2(0.001, stemH + size * 0.02 + capR * conv));
  const cap = new THREE.LatheGeometry(capPts, radial);
  const cc = new Float32Array(cap.attributes.position.count * 3);
  const pp = cap.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i);
    const y = pp.getY(i);
    const z = pp.getZ(i);
    const r = Math.hypot(x, z);
    const under = y < stemH + size * 0.03 && r < capR * 0.98;
    let c: THREE.Color;
    if (under) {
      const ang = Math.atan2(z, x);
      const gill = 0.5 + 0.5 * Math.cos(ang * 90);
      c = pale.clone().multiplyScalar(0.6 + 0.35 * gill);
    } else {
      const k = r / capR;
      c = capDark.clone().lerp(capCol, Math.min(1, k * 1.4));
      c.multiplyScalar(0.9 + 0.2 * valueNoise2(x * 0.6, z * 0.6, 3));
    }
    cc.set([c.r, c.g, c.b], i * 3);
  }
  cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  const g = mergeGeometries([stem.toNonIndexed(), cap.toNonIndexed()]);
  g.computeVertexNormals();
  // Remove uvs mismatch: keep only position/normal/color.
  g.deleteAttribute('uv');
  return g;
}

export function acornGeometry(scale: number): THREE.BufferGeometry {
  const nut: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const a = t * Math.PI;
    nut.push(new THREE.Vector2(Math.sin(a) * 6.2 * (1 - 0.2 * t), -Math.cos(a) * 9 + (t > 0.95 ? 0.6 : 0)));
  }
  const g1 = new THREE.LatheGeometry(nut, 24);
  const cup: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = t * Math.PI * 0.55;
    cup.push(new THREE.Vector2(Math.sin(a) * 7.1 + 0.2, 9 - Math.cos(a) * 4.5));
  }
  const g2 = new THREE.LatheGeometry(cup, 24);
  const p2 = g2.attributes.position;
  for (let i = 0; i < p2.count; i++) {
    const x = p2.getX(i);
    const y = p2.getY(i);
    const z = p2.getZ(i);
    const bump = 1 + 0.06 * Math.sin(Math.atan2(z, x) * 14 + y * 2.5);
    p2.setXYZ(i, x * bump, y, z * bump);
  }
  const colorize = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  };
  const g = mergeGeometries([colorize(g1, new THREE.Color(0x8a5a26)), colorize(g2, new THREE.Color(0x6e5a3a))]);
  g.computeVertexNormals();
  g.scale(scale, scale, scale);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** All static surface props, merged per material. */
export class Props {
  group = new THREE.Group();

  constructor(private terrain: Terrain) {
    const tex = textures();
    const rng = new Rng(terrain.params.seed + 4242);
    const t = terrain;
    const byKind = (k: Prop['kind']) => t.props.filter((p) => p.kind === k && !t.isWater(p.x, p.y));

    // Pebbles: instanced, a few geometry variants.
    const stoneMat = new THREE.MeshStandardMaterial({ map: tex.stone.map, normalMap: tex.stone.normal, roughness: 0.8, metalness: 0, color: 0xffffff });
    patchDapple(stoneMat);
    const pebbles = byKind('pebble');
    const variants = [0, 1, 2, 3].map((i) => stoneGeometry(100 + i, 2, 0.35, 0.62));
    const perVar: Prop[][] = [[], [], [], []];
    pebbles.forEach((p) => perVar[p.v % 4].push(p));
    const tints = [0x9a8f80, 0x7d6e5c, 0xb3a58f, 0x6b6560, 0x8c7a62, 0xa89880];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const col = new THREE.Color();
    perVar.forEach((list, vi) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(variants[vi], stoneMat, list.length);
      list.forEach((p, i) => {
        e.set(rng.range(-0.3, 0.3), p.rot, rng.range(-0.3, 0.3));
        q.setFromEuler(e);
        s.setScalar(p.scale);
        pv.set(p.x, t.heightAt(p.x, p.y) + p.scale * 0.12, p.y);
        m4.compose(pv, q, s);
        im.setMatrixAt(i, m4);
        col.setHex(tints[p.v % tints.length]).multiplyScalar(0.8 + 0.4 * rng.next());
        im.setColorAt(i, col);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
    });

    // Rocks: unique geometry each, merged.
    const rocks = byKind('rock');
    if (rocks.length) {
      const geos = rocks.map((p) => {
        const g = stoneGeometry(p.v, 4, 0.45, 0.58);
        g.scale(p.scale, p.scale, p.scale);
        g.rotateY(p.rot);
        g.translate(p.x, t.heightAt(p.x, p.y) + p.scale * 0.05, p.y);
        const c = new Float32Array(g.attributes.position.count * 3);
        const base = new THREE.Color(tints[p.v % tints.length]);
        for (let i = 0; i < g.attributes.position.count; i++) {
          const y = g.attributes.position.getY(i) - t.heightAt(p.x, p.y);
          const moss = Math.max(0, (g.attributes.normal.getY(i) - 0.6) * 2.5) * fbm2(g.attributes.position.getX(i) * 0.1, g.attributes.position.getZ(i) * 0.1, 3, 5);
          const cc = base.clone().multiplyScalar(0.75 + 0.25 * Math.min(1, y / p.scale));
          cc.lerp(new THREE.Color(0x4d6b2a), Math.min(1, moss * 1.4));
          c.set([cc.r, cc.g, cc.b], i * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        return g;
      });
      const rockMat = new THREE.MeshStandardMaterial({ map: tex.stone.map, normalMap: tex.stone.normal, roughness: 0.85, vertexColors: true });
      patchDapple(rockMat);
      const rm = new THREE.Mesh(mergeGeometries(geos), rockMat);
      rm.castShadow = rm.receiveShadow = true;
      this.group.add(rm);
    }

    // Twigs and logs (bark).
    const barkMat = new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, roughness: 0.9, vertexColors: true, normalScale: new THREE.Vector2(1.5, 1.5) });
    patchDapple(barkMat);
    const branchGeos: THREE.BufferGeometry[] = [];
    for (const p of [...byKind('twig'), ...byKind('log')]) {
      const r = new Rng(p.v);
      const g = branchGeometry(p.len ?? 60, p.scale, r, p.kind === 'log' ? 28 : 9, true);
      // Side twig stubs.
      if (p.kind === 'twig' && r.chance(0.7)) {
        const sub = branchGeometry((p.len ?? 60) * r.range(0.2, 0.45), p.scale * 0.55, r, 7, true);
        sub.translate((p.len ?? 60) * 0.25, 0, 0);
        sub.rotateY(r.range(0.4, 0.9) * r.sign());
        sub.translate(r.range(-0.2, 0.2) * (p.len ?? 60), 0, 0);
        branchGeos.push(this.placeLinear(sub, p, p.scale));
      }
      branchGeos.push(this.placeLinear(g, p, p.scale));
    }
    if (branchGeos.length) {
      const bm = new THREE.Mesh(mergeGeometries(branchGeos), barkMat);
      bm.castShadow = bm.receiveShadow = true;
      this.group.add(bm);
    }

    // Leaves (atlas).
    const leaves = byKind('leaf');
    if (leaves.length) {
      const geos = leaves.map((p) => {
        const r = new Rng(p.v);
        const cell = Math.floor((p.hue ?? 0) * 8) % 8;
        const g = leafGeometry(p.scale, cell, tex.leaves.cols, tex.leaves.rows, r);
        g.rotateX(p.tilt ?? 0);
        g.rotateY(p.rot);
        g.translate(p.x, t.heightAt(p.x, p.y) + 0.25, p.y);
        return g;
      });
      const leafMat = new THREE.MeshStandardMaterial({ map: tex.leaves.map, normalMap: tex.leaves.normal, roughness: 0.72, side: THREE.DoubleSide });
      patchDapple(leafMat);
      const lm = new THREE.Mesh(mergeGeometries(geos), leafMat);
      lm.castShadow = lm.receiveShadow = true;
      this.group.add(lm);
    }

    // Conifer needles.
    const needles = byKind('needle');
    if (needles.length) {
      const geos = needles.map((p) => {
        const g = new THREE.CylinderGeometry(0.35, 0.45, p.scale, 4, 1);
        g.rotateZ(Math.PI / 2 + rng.range(-0.08, 0.08));
        g.rotateY(p.rot);
        g.translate(p.x, t.heightAt(p.x, p.y) + 0.4, p.y);
        const c = new Float32Array(g.attributes.position.count * 3);
        const cc = new THREE.Color().setHSL(rng.range(0.06, 0.09), rng.range(0.4, 0.6), rng.range(0.18, 0.32));
        for (let i = 0; i < g.attributes.position.count; i++) c.set([cc.r, cc.g, cc.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        g.deleteAttribute('uv');
        return g;
      });
      const nm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
      patchDapple(nm);
      const mesh = new THREE.Mesh(mergeGeometries(geos), nm);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Mushrooms and acorns (vertex coloured).
    const vcGeos: THREE.BufferGeometry[] = [];
    for (const p of byKind('mushroom')) {
      const r = new Rng(p.v);
      const n = r.int(1, 3);
      for (let k = 0; k < n; k++) {
        const g = mushroomGeometry(p.scale * (k === 0 ? 1 : r.range(0.4, 0.75)), r);
        g.rotateZ(r.range(-0.12, 0.12));
        g.rotateY(r.range(0, 6.28));
        const ox = k === 0 ? 0 : r.range(-1, 1) * p.scale * 0.6;
        const oz = k === 0 ? 0 : r.range(-1, 1) * p.scale * 0.6;
        g.translate(p.x + ox, t.heightAt(p.x + ox, p.y + oz) - 0.5, p.y + oz);
        vcGeos.push(g);
      }
    }
    for (const p of byKind('acorn')) {
      const g = acornGeometry(p.scale);
      g.rotateY(p.rot);
      g.translate(p.x, t.heightAt(p.x, p.y) + 6 * p.scale, p.y);
      vcGeos.push(g);
    }
    if (vcGeos.length) {
      const mm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
      patchDapple(mm);
      const mesh = new THREE.Mesh(mergeGeometries(vcGeos.map((g) => (g.index ? g.toNonIndexed() : g))), mm);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Orient a branch geometry (built along x) at a prop, following the ground. */
  private placeLinear(g: THREE.BufferGeometry, p: Prop, r: number): THREE.BufferGeometry {
    const len = p.len ?? 60;
    const dx = Math.cos(p.rot);
    const dz = Math.sin(p.rot);
    const h0 = this.terrain.heightAt(p.x - dx * len * 0.5, p.y - dz * len * 0.5);
    const h1 = this.terrain.heightAt(p.x + dx * len * 0.5, p.y + dz * len * 0.5);
    g.rotateZ(Math.atan2(h1 - h0, len));
    g.rotateY(-p.rot);
    g.translate(p.x, (h0 + h1) * 0.5 + r * 0.8, p.y);
    return g;
  }
}
