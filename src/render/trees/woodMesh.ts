import * as THREE from 'three';
import type { CanopyData } from '../../sim/trees';
import type { CrownSkel, WoodPiece } from '../../sim/treeCrowns';
import { TREES as T } from '../../sim/balance';
import { addPatch, dapplePatch, globalUniforms, WORLD_POS_PATCH } from '../shaderPatch';
import { BARK_COUNT, BARK_LAYER, BARK_TILE, TreeMaps } from './barkBake';
import { shadowOnly } from '../shadowOnly';

/**
 * Trees v2 (CHANGE_PLAN §38.2): the crowns' skeletons (sim/treeCrowns.ts) as round 3D wood.
 *
 * Every piece is a tube along its axis, tapering with its radius, swollen where it leaves its parent; where it is
 * walked its section is flat-topped (a superellipse above, round below) with the top exactly at the floor's height — so
 * feet stand on the drawn wood and never sink — and the floor's rounding at the walkable band's edge is the same curve
 * (`floorDrop`). The trunk rises from the ground far below to its crotch, a round column with a flat, rounded-off top.
 * Bark UVs are in millimetres (round the wood, along it), so each species' baked bark tile (barkBake.ts) keeps its real
 * size on a twig and a trunk alike. Pieces are grouped by tree and 256 mm cell into chunks, each a `THREE.LOD` of two
 * meshes (fine near, coarse far), culled by the frustum like any mesh.
 */

/** traffic on a kind of wood (the worn trails on its top: smoother, lighter) */
const WEAR: Record<string, number> = { trunk: 0, limb: 0.7, branch: 0.4, twig: 0.15, link: 1 };
/** the walked section's superellipse exponent (|a|^P + |b|^P = 1 above the axis: a little fuller than a circle, so the
 * walked band on top stays within a millimetre of flat) */
const P = 2.5;

export interface WoodLod {
  radial: number;
  /** the rings' spacing in a piece's flare (elsewhere a ring at each node: the wood runs straight between them) */
  step: number;
  /** rings rounding a piece's end */
  cap: number;
}
/** near: 14 sides, the end rounded by three rings; far (beyond `WOOD_FAR` mm from the camera): 7 sides, one ring */
export const WOOD_LODS: WoodLod[] = [
  { radial: 14, step: 3.5, cap: 3 },
  { radial: 7, step: 9, cap: 1 },
];
export const WOOD_FAR = 420;

/** How far below the wood's top its surface lies at `u` (the share of the radius out from the axis): the floor's rounding. */
export function floorDrop(r: number, u: number): number {
  const a = Math.min(1, Math.abs(u));
  return r * (1 - Math.pow(1 - Math.pow(a, P), 1 / P));
}

class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  tan: number[] = [];
  bark: number[] = [];
  wood: number[] = [];
  idx: number[] = [];
  get n(): number {
    return this.pos.length / 3;
  }
  vert(p: THREE.Vector3, n: THREE.Vector3, t: THREE.Vector3, u: number, v: number, top: number, r: number, layer: number, wear: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.tan.push(t.x, t.y, t.z);
    this.bark.push(u, v);
    this.wood.push(top, r, layer, wear);
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aTanU', new THREE.Float32BufferAttribute(this.tan, 3));
    g.setAttribute('aBark', new THREE.Float32BufferAttribute(this.bark, 2));
    g.setAttribute('aWood', new THREE.Float32BufferAttribute(this.wood, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** the section at angle φ (0 on top): lateral and vertical offsets (× r) and the outward normal there */
function section(phi: number, flat: boolean, out: number[]): void {
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  if (flat && c > 0) {
    const a = Math.sign(s) * Math.pow(Math.abs(s), 2 / P);
    const b = Math.pow(c, 2 / P);
    // (the normal of |a|^P + |b|^P = 1: (a^(P−1), b^(P−1)))
    const na = Math.sign(a) * Math.pow(Math.abs(a), P - 1);
    const nb = Math.pow(b, P - 1);
    const l = Math.hypot(na, nb) || 1;
    out[0] = a;
    out[1] = b;
    out[2] = na / l;
    out[3] = nb / l;
  } else {
    out[0] = s;
    out[1] = c;
    out[2] = s;
    out[3] = c;
  }
}

const sec = [0, 0, 0, 0];
const vC = new THREE.Vector3();
const vT = new THREE.Vector3();
const vN = new THREE.Vector3();
const vL = new THREE.Vector3();
const vP = new THREE.Vector3();
const vn = new THREE.Vector3();
const vt = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function frame(t: THREE.Vector3): void {
  vN.copy(UP).addScaledVector(t, -t.dot(UP));
  if (vN.lengthSq() < 1e-6) vN.set(1, 0, 0).addScaledVector(t, -t.x);
  vN.normalize();
  vL.crossVectors(t, vN).normalize();
}

/** a stable small hash of a piece (its bark offset) */
function hash01(a: number, b: number): number {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h ^= h >>> 13;
  return ((h >>> 0) % 10007) / 10007;
}

interface Ring {
  c: THREE.Vector3;
  t: THREE.Vector3;
  r: number;
  s: number;
}

/** A walked (or round) piece of wood: rings along its axis, a rounded cap at its end (and at its start for a link). */
function tube(g: Geo, p: WoodPiece, layer: number, lod: WoodLod, seed: number, startFlare: boolean, s0 = 0): void {
  const nodes = p.nodes;
  if (nodes.length < 2) return;
  const flat = p.walk;
  const wear = flat ? WEAR[p.kind] ?? 0.2 : 0;
  // (the fine twigs and lianas, a few millimetres thick: fewer sides, longer rings)
  const thin = !p.walk && p.nodes[0].r < 4;
  if (thin) lod = { radial: Math.max(4, Math.round(lod.radial * 0.4)), step: lod.step * 2.2, cap: 1 };
  // the axis: the wood's top is the floor (z), so its centre is a radius below it — and lower where it swells
  const r0 = nodes[0].r;
  const flareLen = 1.6 * r0;
  const rings: Ring[] = [];
  let s = s0;
  const radiusAt = (r: number, sAlong: number) => (startFlare && sAlong - s0 < flareLen ? r * (1 + 0.3 * Math.pow(1 - (sAlong - s0) / flareLen, 2)) : r);
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    // (between two nodes the wood runs straight and its radius changes evenly: rings there would add nothing but
    // triangles — only the flare at a piece's start, which swells as a curve, is ringed: a quarter of its length or
    // `step` apart, whichever is longer — the curve then misses by under a tenth of a millimetre on a limb of 20)
    const n = startFlare && s - s0 < flareLen ? Math.max(1, Math.ceil(len / Math.max(lod.step, flareLen / 4))) : 1;
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const r = radiusAt(a.r + (b.r - a.r) * u, s + len * u);
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u;
      const z = a.z + (b.z - a.z) * u;
      const t = new THREE.Vector3(b.x - a.x, b.z - a.z, b.y - a.y).normalize();
      if (k === 0 && i > 0) {
        const pa = nodes[i - 1];
        t.add(new THREE.Vector3(a.x - pa.x, a.z - pa.z, a.y - pa.y).normalize()).normalize();
      }
      rings.push({ c: new THREE.Vector3(x, flat ? z - r : z, y), t, r, s: s + len * u });
    }
    s += len;
  }
  const e = nodes[nodes.length - 1];
  const pe = nodes[nodes.length - 2];
  const te = new THREE.Vector3(e.x - pe.x, e.z - pe.z, e.y - pe.y).normalize();
  rings.push({ c: new THREE.Vector3(e.x, flat ? e.z - e.r : e.z, e.y), t: te, r: e.r, s });
  // the bark: millimetres round the wood (its mean radius) and along it, a random offset a piece
  let rm = 0;
  for (const rg of rings) rm += rg.r;
  rm /= rings.length;
  const circ = 2 * Math.PI * rm;
  const ou = hash01(seed, 1) * 200;
  const ov = hash01(seed, 2) * 200;
  const R = lod.radial;
  const ringVerts = (rg: Ring, scale: number, fwd: number, capN: number) => {
    frame(rg.t);
    const base = g.n;
    for (let j = 0; j <= R; j++) {
      const phi = Math.PI + (2 * Math.PI * j) / R;
      section(phi, flat, sec);
      vP.copy(rg.c).addScaledVector(rg.t, fwd * rg.r).addScaledVector(vL, sec[0] * rg.r * scale).addScaledVector(vN, sec[1] * rg.r * scale);
      vn.copy(vL).multiplyScalar(sec[2] * (1 - capN)).addScaledVector(vN, sec[3] * (1 - capN)).addScaledVector(rg.t, capN).normalize();
      vt.crossVectors(rg.t, vn);
      if (vt.lengthSq() < 1e-8) vt.copy(vL);
      vt.normalize();
      g.vert(vP, vn, vt, (j / R) * circ + ou, rg.s + fwd * rg.r + ov, sec[1] * scale * (1 - capN) + capN * 0.3, rg.r, layer, wear);
    }
    return base;
  };
  // (counter-clockwise seen from outside: the ring runs round with φ, the tube forward along T)
  const strip = (a: number, b: number) => {
    for (let j = 0; j < R; j++) g.idx.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
  };
  let prev = -1;
  for (const rg of rings) {
    const b0 = ringVerts(rg, 1, 0, 0);
    if (prev >= 0) strip(prev, b0);
    prev = b0;
  }
  // the end: a rounded cap (flat-topped like the wood, so the floor's capsule end stays covered)
  const last = rings[rings.length - 1];
  // (three rings near; far away and on the thin twigs one, half way round)
  for (const k of lod.cap >= 3 ? [1, 2, 3] : [2]) {
    const psi = (k / 4) * (Math.PI / 2);
    const f = flat ? Math.pow(Math.sin(psi), 2 / P) : Math.sin(psi);
    const sc = flat ? Math.pow(Math.cos(psi), 2 / P) : Math.cos(psi);
    const b0 = ringVerts(last, sc, f, k / 4);
    strip(prev, b0);
    prev = b0;
  }
  const tip = g.n;
  vP.copy(last.c).addScaledVector(last.t, last.r * 0.98);
  frame(last.t);
  g.vert(vP, last.t, vL, 0, last.s + last.r, 0.3, last.r, layer, wear);
  for (let j = 0; j < R; j++) g.idx.push(prev + j, prev + j + 1, tip);
}

/** The trunk: a round column from the ground far below to the crotch, its top flat and rounded off like the floor's. */
function trunk(g: Geo, sk: CrownSkel, p: WoodPiece, layer: number, lod: WoodLod, seed: number): void {
  const nodes = p.nodes;
  const R = lod.radial + 4;
  const rTop = nodes[nodes.length - 1].r;
  const Rc = sk.topR / T.walkShare;
  const yEdge = sk.topZ - floorDrop(Rc, rTop / Rc);
  const y0 = nodes[0].z;
  const H = yEdge - y0;
  const n = Math.max(4, Math.ceil(H / (lod.step * 3)));
  const circ = 2 * Math.PI * rTop;
  const ou = hash01(seed, 3) * 300;
  const rAt = (y: number) => {
    // the nodes' radii along the height (linear between them)
    for (let i = 1; i < nodes.length; i++)
      if (y <= nodes[i].z || i === nodes.length - 1) {
        const a = nodes[i - 1];
        const b = nodes[i];
        const u = Math.min(1, Math.max(0, (y - a.z) / Math.max(1e-6, b.z - a.z)));
        return a.r + (b.r - a.r) * u;
      }
    return rTop;
  };
  let prev = -1;
  for (let k = 0; k <= n; k++) {
    const y = y0 + (H * k) / n;
    const r = k === n ? rTop : rAt(y);
    const dr = (rAt(Math.min(yEdge, y + 2)) - rAt(Math.max(y0, y - 2))) / 4;
    const base = g.n;
    for (let j = 0; j <= R; j++) {
      const phi = (2 * Math.PI * j) / R;
      vn.set(Math.cos(phi), -dr, Math.sin(phi)).normalize();
      vP.set(sk.x + Math.cos(phi) * r, y, sk.y + Math.sin(phi) * r);
      vt.set(-Math.sin(phi), 0, Math.cos(phi));
      g.vert(vP, vn, vt, (j / R) * circ + ou, y - y0, 0, r, layer, 0);
    }
    if (prev >= 0) for (let j = 0; j < R; j++) g.idx.push(prev + j, base + j, prev + j + 1, prev + j + 1, base + j, base + j + 1);
    prev = base;
  }
  // the top: rings in to the middle, at the floor's height (the crotch is walked)
  const K = 6;
  for (let k = 1; k <= K; k++) {
    const rho = rTop * (1 - k / K);
    const y = sk.topZ - floorDrop(Rc, rho / Rc);
    const base = g.n;
    // (the slope of the top there: its normal)
    const e = 0.5;
    const dy = (sk.topZ - floorDrop(Rc, (rho + e) / Rc) - (sk.topZ - floorDrop(Rc, Math.max(0, rho - e) / Rc))) / (2 * e);
    for (let j = 0; j <= R; j++) {
      const phi = (2 * Math.PI * j) / R;
      vn.set(-Math.cos(phi) * dy, 1, -Math.sin(phi) * dy).normalize();
      vP.set(sk.x + Math.cos(phi) * rho, y, sk.y + Math.sin(phi) * rho);
      vt.set(-Math.sin(phi), 0, Math.cos(phi));
      // (the top's bark laid flat over it, in plan: no seam of bark converging on the middle)
      vt.set(-1, 0, 0);
      g.vert(vP, vn, vt, -vP.x + ou, vP.z, 1, rTop, layer, 0.5);
    }
    for (let j = 0; j < R; j++) g.idx.push(prev + j, base + j, prev + j + 1, prev + j + 1, base + j, base + j + 1);
    prev = base;
  }
}

/** The wood of every crown and bough: chunks of LODs, ready to add to the canopy's group. */
export function buildWood(data: CanopyData, material: THREE.Material, extra: ReadonlyArray<{ piece: WoodPiece; tree: number }> = []): THREE.Group {
  const group = new THREE.Group();
  group.name = 'canopyWood';
  const CELL = 256;
  type Chunk = { key: string; parts: Array<{ p: WoodPiece; sk: CrownSkel | null; seed: number; flare: boolean; s0: number }> };
  const chunks = new Map<string, Chunk>();
  const put = (key: string, p: WoodPiece, sk: CrownSkel | null, seed: number, flare: boolean, s0 = 0) => {
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { key, parts: [] }));
    c.parts.push({ p, sk, seed, flare, s0 });
  };
  data.skels.forEach((sk, ti) => {
    sk.pieces.forEach((p, pi) => {
      if (p.kind === 'trunk') return put(`t${ti}`, p, sk, ti * 1000 + pi, false);
      const m = p.nodes[Math.floor(p.nodes.length / 2)];
      put(`${ti}:${Math.floor(m.x / CELL)}:${Math.floor(m.y / CELL)}`, p, sk, ti * 1000 + pi, true);
    });
  });
  // the fine twigs and lianas (render only, foliage.ts): with their tree's wood near them
  extra.forEach(({ piece, tree }, i) => {
    const m = piece.nodes[Math.floor(piece.nodes.length / 2)];
    put(`${tree}:${Math.floor(m.x / CELL)}:${Math.floor(m.y / CELL)}`, piece, data.skels[tree] ?? null, 50000 + i, false);
  });
  data.links.forEach((p, li) => {
    // (a long bough in pieces of a cell's length, each its own chunk: culled and coarsened like the rest)
    const step = Math.max(2, Math.round(CELL / 16));
    let s0 = 0;
    for (let i = 0; i < p.nodes.length - 1; i += step) {
      const nodes = p.nodes.slice(i, Math.min(p.nodes.length, i + step + 1));
      const m = nodes[Math.floor(nodes.length / 2)];
      // (the bark runs on from piece to piece: the same offsets, the length so far; a piece's end cap lies inside the next)
      put(`l${li}:${Math.floor(m.x / CELL)}:${Math.floor(m.y / CELL)}`, { ...p, nodes }, null, 90000 + li, false, s0);
      for (let k = 1; k < nodes.length; k++) s0 += Math.hypot(nodes[k].x - nodes[k - 1].x, nodes[k].y - nodes[k - 1].y, nodes[k].z - nodes[k - 1].z);
    }
  });
  const layerOf = (sk: CrownSkel | null, p: WoodPiece) => {
    if (sk) return BARK_LAYER[sk.style] ?? 0;
    // a bough between crowns: the bark of the nearer tree at its start
    let best = 0;
    let bd = Infinity;
    for (const s of data.skels) {
      const d = Math.hypot(s.x - p.nodes[0].x, s.y - p.nodes[0].y);
      if (d < bd) {
        bd = d;
        best = BARK_LAYER[s.style] ?? 0;
      }
    }
    return best;
  };
  // (the shadows: every chunk's coarse level, drawn into the shadow maps only — a soft shadow shows no difference
  // between 7 and 14 sides, and the coarse tube lies inside the fine one, so the wood doesn't shadow its own lit side)
  const casters = new THREE.Group();
  casters.name = 'canopyWoodShadow';
  for (const c of chunks.values()) {
    const lod = new THREE.LOD();
    lod.name = 'woodChunk';
    // (a LOD picks its level by its own position's distance from the camera: the chunk sits at its centre, its
    // geometry moved back by as much)
    let centre: THREE.Vector3 | null = null;
    let coarse: THREE.BufferGeometry | null = null;
    WOOD_LODS.forEach((L, li) => {
      const g = new Geo();
      for (const part of c.parts) {
        const layer = layerOf(part.sk, part.p);
        if (part.p.kind === 'trunk' && part.sk) trunk(g, part.sk, part.p, layer, L, part.seed);
        else tube(g, part.p, layer, L, part.seed, part.flare, part.s0);
      }
      const geo = g.build();
      if (!geo) return;
      if (!centre) centre = geo.boundingSphere!.center.clone();
      geo.translate(-centre.x, -centre.y, -centre.z);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, material);
      m.castShadow = false;
      m.receiveShadow = true;
      m.userData.noShadow = true;
      lod.addLevel(m, li === 0 ? 0 : WOOD_FAR);
      coarse = geo;
    });
    if (!centre || !coarse) continue;
    lod.position.copy(centre);
    group.add(lod);
    const sh = new THREE.Mesh(coarse, material);
    sh.name = 'woodShadow';
    sh.castShadow = true;
    sh.receiveShadow = false;
    sh.position.copy(centre);
    casters.add(sh);
  }
  shadowOnly(casters);
  group.add(casters);
  return group;
}

/**
 * The haze between the tiers (shared by the wood and the leaves): what lies below the tier in view (`y`, set each
 * frame from the camera's target) fades toward the air's colour, so the depth reads.
 */
export const canopyHaze = {
  uHazeY: { value: 0 },
  uHazeCol: { value: new THREE.Color(0.17, 0.21, 0.18) },
  uHazeK: { value: 0.38 },
};

/**
 * The light under the leaves (shared by the wood and the leaves): a plan map of the leaf cover over the map (R its
 * density, G the height of its top, `canopyTerrain.ts` fills it) tints what lies beneath greener and a little darker —
 * the sun through and between the leaves (their own shadows are the shadow map's).
 */
export const canopyCover = {
  tCover: { value: null as THREE.Texture | null },
  uCoverSize: { value: new THREE.Vector2(1, 1) },
};

export function coverPatch(): import('../shaderPatch').ShaderPatch {
  return {
    key: 'canopyCover',
    uniforms: canopyCover,
    fragmentHeader: 'uniform sampler2D tCover; uniform vec2 uCoverSize;',
    fragment: [
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec4 _cv = texture2D(tCover, vWP.xz / uCoverSize);
          float _top = _cv.g * 320.0 - 160.0;
          float _under = _cv.r * smoothstep(_top - 2.0, _top - 14.0, vWP.y);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.97, 0.7), _under);
        }`,
      ],
    ],
  };
}

export function hazePatch(): import('../shaderPatch').ShaderPatch {
  return {
    key: 'canopyHaze',
    uniforms: canopyHaze,
    fragmentHeader: 'uniform float uHazeY; uniform vec3 uHazeCol; uniform float uHazeK;',
    fragment: [
      [
        '#include <fog_fragment>',
        `{
          float _hz = clamp((uHazeY - vWP.y) / 150.0, 0.0, 1.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeCol, _hz * (0.5 + 0.5 * _hz) * uHazeK);
        }
        #include <fog_fragment>`,
      ],
    ],
  };
}

/**
 * The bark material: the baked species tile by its millimetres, moss on the upper sides and in the furrows of damp
 * wood, lichen crusts on the ridges, the walked tops worn smooth and paler, a knot or a bore hole now and then, the
 * furrows and the undersides shaded; dappled sun.
 */
export function woodMaterial(maps: TreeMaps): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 });
  addPatch(mat, WORLD_POS_PATCH);
  addPatch(mat, dapplePatch());
  // per species: moss, lichen (amounts)
  const moss = [0.35, 0.15, 0.5, 0.5, 0.03];
  const lichen = [0.5, 0.55, 0.35, 0.25, 0.3];
  addPatch(mat, {
    key: 'bark',
    uniforms: {
      tBarkA: { value: maps.barkA },
      tBarkN: { value: maps.barkN },
      uBarkTile: { value: BARK_TILE.slice(0, BARK_COUNT) },
      uMoss: { value: moss },
      uLichen: { value: lichen },
      uTime: globalUniforms.uTime,
    },
    vertexHeader: `attribute vec3 aTanU; attribute vec2 aBark; attribute vec4 aWood; varying vec3 vTanU; varying vec2 vBarkUv; varying vec4 vWood;`,
    vertex: [
      [
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vTanU = normalize((modelViewMatrix * vec4(aTanU, 0.0)).xyz);
        vBarkUv = aBark;
        vWood = aWood;`,
      ],
    ],
    fragmentHeader: `precision highp sampler2DArray;
uniform sampler2DArray tBarkA; uniform sampler2DArray tBarkN; uniform float uBarkTile[${BARK_COUNT}];
uniform float uMoss[${BARK_COUNT}]; uniform float uLichen[${BARK_COUNT}];
varying vec3 vTanU; varying vec2 vBarkUv; varying vec4 vWood;
float barkRough = 0.9; vec4 barkN = vec4(0.5, 0.5, 0.5, 1.0); float barkMoss = 0.0; float barkWear = 0.0;`,
    fragment: [
      [
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          int L = int(vWood.z + 0.5);
          float tile = uBarkTile[L];
          vec2 buv = vBarkUv / tile;
          vec4 bA = texture(tBarkA, vec3(buv, vWood.z));
          barkN = texture(tBarkN, vec3(buv, vWood.z));
          vec3 alb = bA.rgb * bA.rgb;
          float rough = bA.a;
          float cav = barkN.a;
          float hgt = barkN.b;
          float up = vWood.x;
          // knots: now and then a dark eye ringed by swollen bark (cells of 70 mm of bark)
          vec2 kc = floor(vBarkUv / 70.0);
          float kh = h21(kc + vWood.z * 7.0);
          vec2 kp = (fract(vBarkUv / 70.0) - vec2(0.3 + 0.4 * h21(kc + 3.1), 0.3 + 0.4 * h21(kc + 5.7))) * 70.0;
          float kd = length(kp * vec2(1.0, 0.55));
          float knot = step(0.78, kh) * smoothstep(5.0, 1.0, kd);
          alb = mix(alb, alb * vec3(0.35, 0.3, 0.28), knot * smoothstep(2.4, 0.6, kd));
          alb = mix(alb, alb * 1.25, knot * smoothstep(1.2, 3.0, kd) * smoothstep(5.0, 3.5, kd));
          // bore holes: tiny dark pits (cells of 22 mm)
          vec2 hc = floor(vBarkUv / 22.0);
          vec2 hp = (fract(vBarkUv / 22.0) - 0.5) * 22.0;
          float hole = step(0.9, h21(hc + 11.0 + vWood.z)) * smoothstep(0.9, 0.5, length(hp));
          alb *= 1.0 - hole * 0.85;
          // moss on the upper sides and in the furrows of the thick, damp wood
          float mn = fbm(vWP.xz * 0.03 + vec2(vWP.y * 0.05, 0.0)) * 0.7 + fbm(vWP.xz * 0.21 + 5.0) * 0.3;
          barkMoss = uMoss[L] * smoothstep(-0.1, 0.55, up) * smoothstep(0.5, 0.66, mn) * (0.35 + 0.65 * (1.0 - cav)) * smoothstep(8.0, 18.0, vWood.y);
          // lichen: pale grey-green crusts on the ridges
          float ln = fbm(vWP.xz * 0.11 + vec2(3.0, vWP.y * 0.09));
          float lich = uLichen[L] * smoothstep(0.66, 0.7, ln) * smoothstep(0.25, 0.65, hgt) * (1.0 - barkMoss);
          // worn smooth where ants walk often: the walked top of the busy wood, lighter and a little polished
          barkWear = vWood.w * smoothstep(0.88, 0.985, up);
          alb = mix(alb, alb * 1.3 + 0.006, barkWear * 0.65);
          rough = mix(rough, 0.5, barkWear * 0.7);
          alb = mix(alb, vec3(0.04, 0.062, 0.014) * (0.7 + 0.6 * vnoise(vWP.xz * 0.9)), barkMoss);
          alb = mix(alb, vec3(0.16, 0.19, 0.14) * (0.85 + 0.3 * vnoise(vWP.xz * 1.3)), lich * 0.85);
          // the furrows' shadow and the undersides
          float ao = mix(0.3, 1.0, cav) * mix(0.5, 1.0, smoothstep(-0.75, 0.25, up));
          diffuseColor.rgb = alb * ao;
          barkRough = mix(mix(rough, 0.97, barkMoss), 0.8, lich * 0.5);
        }`,
      ],
      [
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 nt = vec3(barkN.xy * 2.0 - 1.0, 1.0);
          nt.xy *= (1.0 - barkWear * 0.7) * (1.0 - barkMoss * 0.75);
          vec3 Nn = normal;
          vec3 Tn = normalize(vTanU - Nn * dot(Nn, vTanU));
          vec3 Bn = cross(Nn, Tn);
          normal = normalize(Tn * nt.x + Bn * nt.y + Nn * nt.z);
        }`,
      ],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = barkRough;'],
    ],
  });
  addPatch(mat, coverPatch());
  addPatch(mat, hazePatch());
  return mat;
}
