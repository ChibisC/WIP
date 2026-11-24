import * as THREE from 'three';
import type { CanopyData } from '../../sim/trees';
import type { WoodPiece } from '../../sim/treeCrowns';
import type { CrownStyle } from '../../maps/types';
import { addPatch, dapplePatch, globalUniforms, WORLD_POS_PATCH } from '../shaderPatch';
import { LEAF_LAYER, LEAF_VARIANTS, TreeMaps } from './barkBake';
import { hazePatch } from './woodMesh';

/**
 * Trees v2 (CHANGE_PLAN §38.2): the leaves, render only.
 *
 * - **Small leaves** grow in clusters on fine twigs (render-only wood, `fineTwigs`) sprouting from the sides and tips of
 *   the walked wood — oak in tufts at the twig ends, beech in flat sprays, willow on long hanging strands, the rainforest
 *   trees in rosettes of big blades, acacia in flat sprays of feathery fronds. A leaf whose blade would lie over the
 *   floor (above it, as seen from the sky) is left out: the walkways stay in sight.
 * - **Big leaves** (the species that have them: oak, beech, the rainforest's) are the walkable platforms of the floor
 *   (sim/treeCrowns.ts), drawn flat at their twig's height and bending a little under the units on them (`setLoad`; the
 *   floor follows the bend, canopyTerrain.ts).
 * - Acacia's paired thorns on its twigs, the rainforest's lianas looping down to the trunks.
 * One instanced mesh of leaves per tree (and a coarse twin far away), every blade a bent grid with the species' baked
 * blade (barkBake.ts): waxy upper side, paler matte underside, the sun shining through when it is behind the leaf,
 * swaying in the breeze; alpha-tested shadows (dappled light on the wood and the ants).
 */

/** per species: the small leaves' length and width (mm), how they grow (the fine twigs' pitch, length, leaves on them) */
interface SprayStyle {
  leaf: [number, number];
  pitch: [number, number];
  twig: [number, number];
  /** leaves along a fine twig (every `every` mm) and at its tip */
  every: number;
  tip: number;
  /** leaves' droop (× length) and fold (the V across the midrib) */
  droop: number;
  fold: number;
  /** fine twigs at a spot */
  sprays: number;
}
const SPRAY: Record<CrownStyle, SprayStyle> = {
  oak: { leaf: [30, 19], pitch: [-0.25, 0.3], twig: [18, 32], every: 9, tip: 5, droop: 0.12, fold: 0.08, sprays: 2 },
  beech: { leaf: [26, 16], pitch: [-0.12, 0.12], twig: [26, 44], every: 6.5, tip: 1, droop: 0.06, fold: 0.05, sprays: 2 },
  willow: { leaf: [34, 6], pitch: [-1.35, -0.95], twig: [45, 85], every: 5, tip: 2, droop: 0.2, fold: 0.15, sprays: 3 },
  tropical: { leaf: [48, 23], pitch: [0.0, 0.35], twig: [6, 12], every: 99, tip: 6, droop: 0.18, fold: 0.1, sprays: 1 },
  acacia: { leaf: [26, 18], pitch: [-0.06, 0.06], twig: [14, 26], every: 8, tip: 5, droop: 0.02, fold: 0.0, sprays: 2 },
  sapling: { leaf: [22, 14], pitch: [-0.1, 0.2], twig: [16, 28], every: 7, tip: 2, droop: 0.08, fold: 0.05, sprays: 1 },
};
const HAS_BIG: Record<CrownStyle, boolean> = { oak: true, beech: true, willow: false, tropical: true, acacia: false, sapling: true };

/** a small deterministic random stream (render only: the same leaves every load) */
function rand(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Leaf {
  /** the stalk's end (world: x, height, z) */
  p: THREE.Vector3;
  /** along the blade, across it (unit), its length and width (mm) */
  dir: THREE.Vector3;
  side: THREE.Vector3;
  len: number;
  wid: number;
  layer: number;
  tint: number;
  phase: number;
  droop: number;
  fold: number;
  sway: number;
}

export interface FoliageBuild {
  /** render-only wood: the fine twigs and lianas (drawn by woodMesh with the species' bark) */
  fineTwigs: Array<{ piece: WoodPiece; tree: number }>;
  group: THREE.Group;
  /** the big leaves' mesh (its sag attribute is set by `setLoad`) */
  big: THREE.InstancedMesh | null;
  /** per tree: [near mesh, far mesh, centre] */
  trees: Array<{ near: THREE.InstancedMesh; far: THREE.InstancedMesh; c: THREE.Vector3 }>;
}

/** A blade: a grid across (−½…½) × along (0…1), flat (the shader bends it). */
function bladeGeometry(nx: number, ny: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / ny;
      pos.push(u - 0.5, v, 0);
      uv.push(u, v);
    }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** the blade's bend in the vertex shader (shared by the colour and the shadow materials) */
const BEND = /* glsl */ `
attribute vec4 aLeafA;
attribute vec4 aLeafB;
uniform float uTime;
varying vec2 vLeafUv;
varying vec4 vLeaf;
vec3 leafBend(vec3 p, out vec3 n) {
  float y = p.y;
  float x = p.x;
  float droop = aLeafB.x;
  float fold = aLeafB.y;
  // the breeze: each leaf rocks about its stalk at its own pace
  float sw = aLeafB.z * sin(uTime * (1.4 + aLeafA.z * 0.9) + aLeafA.z * 6.2832) * y;
  // a big leaf bends under what stands on it (aLeafA.w, set per frame)
  float sag = aLeafA.w * 0.05 * y * y;
  float z = -droop * y * y + fold * abs(x) * 2.0 * (1.0 - 0.5 * y) + sw - sag;
  float dzdx = fold * 2.0 * sign(x) * (1.0 - 0.5 * y);
  float dzdy = -2.0 * droop * y - fold * abs(x) + aLeafB.z * sin(uTime * (1.4 + aLeafA.z * 0.9) + aLeafA.z * 6.2832) - aLeafA.w * 0.1 * y;
  n = normalize(vec3(-dzdx, -dzdy, 1.0));
  return vec3(x, y, z);
}`;

/** The leaves' material and its shadow twin. */
export function leafMaterials(maps: TreeMaps): { color: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const color = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  addPatch(color, WORLD_POS_PATCH);
  addPatch(color, dapplePatch());
  const uni = { tLeafA: { value: maps.leafA }, tLeafN: { value: maps.leafN }, uTime: globalUniforms.uTime };
  addPatch(color, {
    key: 'leaf',
    uniforms: uni,
    vertexHeader: BEND,
    vertex: [
      ['#include <beginnormal_vertex>', 'vec3 _ln; vec3 _lp = leafBend(position, _ln);\nvec3 objectNormal = _ln;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif'],
      ['#include <begin_vertex>', 'vec3 transformed = _lp;\nvLeafUv = uv; vLeaf = aLeafA;'],
    ],
    fragmentHeader: `precision highp sampler2DArray;
uniform sampler2DArray tLeafA; uniform sampler2DArray tLeafN;
varying vec2 vLeafUv; varying vec4 vLeaf;
vec4 leafN = vec4(0.5, 0.5, 0.8, 0.0); vec3 leafAlb = vec3(0.0); float leafRough = 0.5;`,
    fragment: [
      [
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec4 la = texture(tLeafA, vec3(vLeafUv, vLeaf.x));
          if (la.a < 0.5) discard;
          leafN = texture(tLeafN, vec3(vLeafUv, vLeaf.x));
          vec3 alb = la.rgb * la.rgb;
          // each leaf its own shade: a little yellower or bluer, lighter or darker
          float t = vLeaf.y;
          alb *= vec3(1.0 + 0.18 * t, 1.0 + 0.06 * t, 1.0 - 0.25 * t) * (0.85 + 0.3 * fract(t * 13.7));
          // the underside: paler and matte (the upper side waxy, a soft sheen)
          if (!gl_FrontFacing) {
            float l = dot(alb, vec3(0.3, 0.6, 0.1));
            alb = mix(alb, vec3(l) * vec3(1.05, 1.15, 0.95), 0.45) * 1.5;
            leafRough = 0.85;
          } else leafRough = mix(0.38, 0.55, leafN.a);
          leafAlb = alb;
          diffuseColor.rgb = alb;
        }`,
      ],
      [
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 nt = vec3(leafN.xy * 2.0 - 1.0, 1.0);
          nt.xy *= 0.8;
          // (the blade's frame from its own derivatives: no tangents on the instances)
          vec3 q0 = dFdx(-vViewPosition);
          vec3 q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vLeafUv);
          vec2 st1 = dFdy(vLeafUv);
          vec3 Nn = normal;
          vec3 q1perp = cross(q1, Nn);
          vec3 q0perp = cross(Nn, q0);
          vec3 Tn = q1perp * st0.x + q0perp * st1.x;
          vec3 Bn = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(Tn, Tn), dot(Bn, Bn));
          float sc = det == 0.0 ? 0.0 : inversesqrt(det);
          normal = normalize(Tn * (nt.x * sc) + Bn * (nt.y * sc) + Nn * nt.z);
        }`,
      ],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = leafRough;'],
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #if NUM_DIR_LIGHTS > 0
        {
          // the sun through the blade when it is behind the leaf: a warm green glow, the veins darker
          float back = max(0.0, -dot(normal, directionalLights[0].direction));
          vec3 through = pow(leafAlb, vec3(0.75)) * vec3(1.4, 1.6, 0.6);
          totalEmissiveRadiance += directionalLights[0].color * through * leafN.b * back * 0.55;
        }
        #endif`,
      ],
    ],
  });
  addPatch(color, hazePatch());
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  addPatch(depth, {
    key: 'leafDepth',
    uniforms: uni,
    vertexHeader: BEND,
    vertex: [['#include <begin_vertex>', 'vec3 _ln; vec3 transformed = leafBend(position, _ln);\nvLeafUv = uv; vLeaf = aLeafA;']],
    fragmentHeader: `precision highp sampler2DArray;
uniform sampler2DArray tLeafA;
varying vec2 vLeafUv; varying vec4 vLeaf;`,
    fragment: [['void main() {', 'void main() {\n  if (texture(tLeafA, vec3(vLeafUv, vLeaf.x)).a < 0.5) discard;']],
  });
  return { color, depth };
}

const tmpM = new THREE.Matrix4();
const tmpZ = new THREE.Vector3();

function instances(leaves: Leaf[], geo: THREE.BufferGeometry, mat: THREE.Material, depth: THREE.Material): THREE.InstancedMesh {
  const n = leaves.length;
  const g = geo.clone();
  const A = new Float32Array(n * 4);
  const B = new Float32Array(n * 4);
  const m = new THREE.InstancedMesh(g, mat, n);
  leaves.forEach((l, i) => {
    tmpZ.crossVectors(l.side, l.dir).normalize();
    tmpM.makeBasis(l.side.clone().multiplyScalar(l.wid), l.dir.clone().multiplyScalar(l.len), tmpZ.multiplyScalar(l.len));
    tmpM.setPosition(l.p);
    m.setMatrixAt(i, tmpM);
    A.set([l.layer, l.tint, l.phase, 0], i * 4);
    B.set([l.droop, l.fold, l.sway, 0], i * 4);
  });
  g.setAttribute('aLeafA', new THREE.InstancedBufferAttribute(A, 4));
  g.setAttribute('aLeafB', new THREE.InstancedBufferAttribute(B, 4));
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  m.castShadow = true;
  m.receiveShadow = true;
  m.customDepthMaterial = depth;
  return m;
}

/**
 * Grow every crown's small leaves, fine twigs, thorns and lianas, and lay its big leaves. `floorZ(x, y)` is the floor's
 * height there (−1 none): a small leaf that would lie over the floor is left out.
 */
export function buildFoliage(data: CanopyData, maps: TreeMaps, floorZ: (x: number, y: number) => number, mats = leafMaterials(maps)): FoliageBuild {
  const group = new THREE.Group();
  group.name = 'canopyLeaves';
  const fineTwigs: Array<{ piece: WoodPiece; tree: number }> = [];
  const trees: FoliageBuild['trees'] = [];
  const near = bladeGeometry(2, 4);
  const far = bladeGeometry(1, 2);
  const bigLeaves: Leaf[] = [];
  const thorns: THREE.Matrix4[] = [];
  data.skels.forEach((sk, ti) => {
    const st = SPRAY[sk.style] ?? SPRAY.oak;
    const R = rand(ti * 7919 + 17);
    const leaves: Leaf[] = [];
    const layer0 = (LEAF_LAYER[sk.style] ?? 0) * LEAF_VARIANTS;
    const covers = (p: THREE.Vector3) => {
      const f = floorZ(p.x, p.z);
      return f >= 0 && p.y > f - 3;
    };
    const addLeaf = (p: THREE.Vector3, dir: THREE.Vector3, scale: number) => {
      const len = st.leaf[0] * scale * (0.85 + 0.3 * R());
      const wid = st.leaf[1] * scale * (0.85 + 0.3 * R());
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      // (a little roll round the blade's length)
      side.applyAxisAngle(dir, (R() - 0.5) * 0.9);
      const mid = p.clone().addScaledVector(dir, len * 0.5);
      const tip = p.clone().addScaledVector(dir, len * 0.95);
      if (covers(mid) || covers(tip) || covers(p)) return;
      leaves.push({ p, dir, side, len, wid, layer: layer0 + Math.floor(R() * LEAF_VARIANTS), tint: R() * 2 - 1, phase: R(), droop: st.droop, fold: st.fold, sway: 0.03 + 0.03 * R() });
    };
    // where sprays grow: the tips of the walked wood and its outer sides
    for (const p of sk.pieces) {
      if (!p.walk) continue;
      const ns = p.nodes;
      const spots: number[] = [];
      if (p.kind === 'twig' || p.kind === 'branch') spots.push(ns.length - 1);
      if (p.kind !== 'limb' || ns.length > 6) for (let k = Math.max(1, Math.floor(ns.length * 0.45)); k < ns.length - 1; k += 3) spots.push(k);
      if (p.kind === 'limb') spots.push(ns.length - 1);
      for (const k of spots) {
        const nd = ns[k];
        const pr = ns[Math.max(0, k - 1)];
        const h = Math.atan2(nd.y - pr.y, nd.x - pr.x);
        const end = k === ns.length - 1;
        for (let sp = 0; sp < st.sprays; sp++) {
          // from the wood's side (or out of its tip), outward, at the species' pitch
          const sideSign = sp % 2 === 0 ? 1 : -1;
          const yaw = end ? h + (R() - 0.5) * 1.6 : h + sideSign * (0.7 + 0.8 * R());
          const pitch = st.pitch[0] + (st.pitch[1] - st.pitch[0]) * R();
          const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
          const base = new THREE.Vector3(nd.x, nd.z - nd.r * 0.55, nd.y);
          if (end) base.add(new THREE.Vector3(Math.cos(h), 0, Math.sin(h)).multiplyScalar(nd.r * 0.7));
          else base.add(new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(nd.r * 0.9));
          const tl = st.twig[0] + (st.twig[1] - st.twig[0]) * R();
          // the fine twig: a few nodes, bending down toward its tip (willow's strands hang)
          const nodes = [];
          const q = base.clone();
          const d = dir.clone();
          const segs = 4;
          for (let s = 0; s <= segs; s++) {
            nodes.push({ x: q.x, y: q.z, z: q.y, r: Math.max(0.5, 1.7 - (1.1 * s) / segs) * (sk.style === 'tropical' ? 1.6 : 1) });
            if (s === segs) break;
            q.addScaledVector(d, tl / segs);
            d.y -= sk.style === 'willow' ? 0.05 : 0.08;
            d.normalize();
          }
          fineTwigs.push({ piece: { kind: 'twig', parent: -1, tree: ti, walk: false, nodes }, tree: ti });
          // leaves along it, alternating, and a cluster at its tip
          const pts = nodes.map((n) => new THREE.Vector3(n.x, n.z, n.y));
          let along = 0;
          const total = tl;
          let alt = 1;
          for (let a = st.every * 0.7; a < total - 2; a += st.every * (0.8 + 0.4 * R())) {
            const f = a / total;
            const i0 = Math.min(segs - 1, Math.floor(f * segs));
            const pp = pts[i0].clone().lerp(pts[i0 + 1], f * segs - i0);
            const td = pts[i0 + 1].clone().sub(pts[i0]).normalize();
            const sd = new THREE.Vector3().crossVectors(td, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(alt);
            alt = -alt;
            const ld = td.clone().multiplyScalar(0.45).add(sd).normalize();
            ld.y += sk.style === 'willow' ? -0.6 : (R() - 0.6) * 0.3;
            ld.normalize();
            addLeaf(pp, ld, 0.9);
            along++;
          }
          const tip = pts[segs];
          const tdir = pts[segs].clone().sub(pts[segs - 1]).normalize();
          for (let c = 0; c < st.tip; c++) {
            const a = (c / Math.max(1, st.tip)) * Math.PI * 2 + R() * 0.5;
            const ld = tdir.clone().multiplyScalar(st.tip > 2 ? 0.55 : 1);
            const sd = new THREE.Vector3().crossVectors(tdir, new THREE.Vector3(0, 1, 0)).normalize();
            const ud = new THREE.Vector3().crossVectors(sd, tdir).normalize();
            if (st.tip > 2) ld.addScaledVector(sd, Math.cos(a) * 0.8).addScaledVector(ud, Math.sin(a) * 0.35 - 0.1);
            ld.normalize();
            addLeaf(tip.clone(), ld, sk.style === 'tropical' ? 1 : 1);
          }
          void along;
        }
      }
      // acacia: pairs of pale thorns along its branches and twigs, pointing out and down
      if (sk.style === 'acacia' && p.kind !== 'limb') {
        for (let k = 1; k < ns.length; k++) {
          const a = ns[k - 1];
          const b = ns[k];
          const h = Math.atan2(b.y - a.y, b.x - a.x);
          for (const sg of [1, -1]) {
            const ang = h + sg * Math.PI * 0.5;
            const len = 3 + 3 * R();
            const dir = new THREE.Vector3(Math.cos(ang), -0.35, Math.sin(ang)).normalize();
            const base = new THREE.Vector3(b.x + Math.cos(ang) * b.r * 0.92, b.z - b.r * 0.45, b.y + Math.sin(ang) * b.r * 0.92);
            const m = new THREE.Matrix4();
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            m.compose(base.addScaledVector(dir, len * 0.5), q, new THREE.Vector3(0.4, len, 0.4));
            thorns.push(m);
          }
        }
      }
    }
    // the rainforest's lianas: from under a limb, a loop down to the trunk and round it down into the haze
    if (sk.style === 'tropical') {
      const tr = sk.pieces[0];
      const rT = tr.nodes[tr.nodes.length - 1].r;
      for (let i = 0, made = 0; i < sk.pieces.length && made < 3; i++) {
        const p = sk.pieces[i];
        if (p.kind !== 'limb' || p.nodes.length < 6) continue;
        made++;
        const a = p.nodes[Math.floor(p.nodes.length * 0.45)];
        const start = new THREE.Vector3(a.x, a.z - a.r * 1.8, a.y);
        const ang = Math.atan2(a.y - sk.y, a.x - sk.x);
        const end = new THREE.Vector3(sk.x + Math.cos(ang) * (rT + 1.5), sk.topZ - 50 - 30 * R(), sk.y + Math.sin(ang) * (rT + 1.5));
        const nodes = [];
        const N = 12;
        for (let k = 0; k <= N; k++) {
          const u = k / N;
          const q = start.clone().lerp(end, u);
          q.y -= Math.sin(Math.PI * u) * (25 + 15 * R());
          nodes.push({ x: q.x, y: q.z, z: q.y, r: 1.8 });
        }
        // round the trunk, down
        for (let k = 1; k <= 16; k++) {
          const a2 = ang + k * 0.55;
          nodes.push({ x: sk.x + Math.cos(a2) * (rT + 1.6), y: sk.y + Math.sin(a2) * (rT + 1.6), z: end.y - k * 7, r: 1.8 });
        }
        fineTwigs.push({ piece: { kind: 'twig', parent: -1, tree: ti, walk: false, nodes }, tree: ti });
      }
    }
    if (HAS_BIG[sk.style])
      for (const l of sk.leaves) {
        const dir = new THREE.Vector3(Math.cos(l.rot), 0, Math.sin(l.rot));
        const side = new THREE.Vector3(-Math.sin(l.rot), 0, Math.cos(l.rot));
        // (the blade a little larger than the walkable ellipse, its stalk at the twig's tip, flat at the floor's height)
        const len = l.rx * 2.15;
        const wid = l.ry * 2.25;
        const p = new THREE.Vector3(l.x, l.z + 0.05, l.y).addScaledVector(dir, -len * 0.5);
        bigLeaves.push({ p, dir, side, len, wid, layer: layer0 + Math.floor(R() * LEAF_VARIANTS), tint: R() * 1.2 - 0.6, phase: R(), droop: 0, fold: 0, sway: 0 });
      }
    if (!leaves.length) return;
    // (a random order, so the coarse twin far away can draw a share of them)
    for (let i = leaves.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [leaves[i], leaves[j]] = [leaves[j], leaves[i]];
    }
    const mn = instances(leaves, near, mats.color, mats.depth);
    const mf = new THREE.InstancedMesh(far.clone(), mats.color, leaves.length);
    mf.instanceMatrix = mn.instanceMatrix;
    mf.geometry.setAttribute('aLeafA', mn.geometry.getAttribute('aLeafA'));
    mf.geometry.setAttribute('aLeafB', mn.geometry.getAttribute('aLeafB'));
    mf.boundingSphere = mn.boundingSphere;
    mf.castShadow = true;
    mf.receiveShadow = true;
    mf.customDepthMaterial = mats.depth;
    mf.visible = false;
    mn.name = mf.name = 'treeLeaves';
    group.add(mn, mf);
    trees.push({ near: mn, far: mf, c: new THREE.Vector3(sk.x, sk.topZ, sk.y) });
  });
  let big: THREE.InstancedMesh | null = null;
  if (bigLeaves.length) {
    big = instances(bigLeaves, bladeGeometry(3, 6), mats.color, mats.depth);
    big.name = 'bigLeaves';
    group.add(big);
  }
  if (thorns.length) {
    const tg = new THREE.ConeGeometry(1, 1, 5);
    const tm = new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.55 });
    const im = new THREE.InstancedMesh(tg, tm, thorns.length);
    thorns.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    im.castShadow = true;
    im.name = 'acaciaThorns';
    group.add(im);
  }
  return { fineTwigs, group, big, trees };
}

export { SPRAY, HAS_BIG };
export type { Leaf };
