/**
 * v2 nest look for the Sickle-Jaw Termites (Rhynchotermes): dark, damp soil chambers with leaf-litter fragments,
 * surface entrances among leaf litter. (Real colonies nest underground or in shallow surface nests, under
 * decaying bark, rotting logs and dung.)
 *
 *  - createDampSoilMaterial() / dampSoilPatch(): world-space procedural soil for chamber walls, floors and brood
 *    tiles: crumbly grains, darker crevices, glossy wet patches, a few pale grit specks. No UVs needed, works on
 *    instanced or plain meshes, chains with the game's world-pos / dapple patches.
 *  - buildLeafLitterGeometry(): scattered torn leaf fragments (curled, with ragged edges) for chamber floors and
 *    nest entrances, one draw call. createLeafLitterMaterial() gives them mottled browns and veins.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshStandardMaterial, Vector3 } from 'three';
import { NOISE_GLSL } from './shaders';
import { applyPatch, ShaderPatch } from './material';
import { LEAF_COLORS } from './castes';

export interface DampSoilOptions {
  /** world units per mm */
  unitsPerMm?: number;
  /** soil grain size in mm */
  grainMm?: number;
  /** 0..1 how much of the surface is glossy-wet */
  wetness?: number;
  bump?: number;
  colors?: [string, string, string];
  doubleSided?: boolean;
}

/** uniforms for dampSoilPatch(): use dampSoilPatch(dampSoilUniforms(opts)) to patch an existing game material */
export function dampSoilUniforms(o: DampSoilOptions = {}) {
  const [c0, c1, c2] = (o.colors ?? ['#1E140C', '#2E2014', '#4A3626']).map((h) => new Color(h));
  return {
    uS0: { value: c0 },
    uS1: { value: c1 },
    uS2: { value: c2 },
    uSScale: { value: 1 / (o.unitsPerMm ?? 1) },
    uSGrain: { value: 1 / (o.grainMm ?? 0.18) },
    uSWet: { value: o.wetness ?? 0.45 },
    uSBump: { value: o.bump ?? 0.8 },
  };
}

export function createDampSoilMaterial(o: DampSoilOptions = {}) {
  const [c0, c1, c2] = (o.colors ?? ['#1E140C', '#2E2014', '#4A3626']).map((h) => new Color(h));
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  if (o.doubleSided) mat.side = DoubleSide;
  const uniforms = {
    uS0: { value: c0 },
    uS1: { value: c1 },
    uS2: { value: c2 },
    uSScale: { value: 1 / (o.unitsPerMm ?? 1) },
    uSGrain: { value: 1 / (o.grainMm ?? 0.18) },
    uSWet: { value: o.wetness ?? 0.45 },
    uSBump: { value: o.bump ?? 0.8 },
  };
  mat.userData.soilUniforms = uniforms;
  applyPatch(mat, dampSoilPatch(uniforms));
  return mat;
}

/** damp-soil shading as a patch in the game's format */
export function dampSoilPatch(uniforms: Record<string, { value: unknown }>): ShaderPatch {
  return {
    key: 'dampSoil',
    uniforms,
    vertexHeader: 'varying vec3 vSoilW;',
    vertex: [
      [
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 sw_ = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            sw_ = instanceMatrix * sw_;
          #endif
          vSoilW = (modelMatrix * sw_).xyz;
        }`,
      ],
    ],
    fragmentHeader: `uniform vec3 uS0; uniform vec3 uS1; uniform vec3 uS2; uniform float uSScale; uniform float uSGrain; uniform float uSWet; uniform float uSBump;
      varying vec3 vSoilW;
      ${NOISE_GLSL}
      float sFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * tNoise(p); p *= 2.03; a *= 0.5; } return s; }`,
    fragment: [
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float soilWet = 0.0;
        {
          vec3 P = vSoilW * uSScale; // mm
          vec2 cl = tCell(P * uSGrain);                // crumbs / soil aggregates
          float crumb = 1.0 - smoothstep(0.15, 0.75, cl.x);
          float big = sFbm(P * 0.12);
          vec3 col = mix(uS0, uS1, smoothstep(0.3, 0.7, big));
          col = mix(col, uS2, crumb * 0.45 * (0.5 + cl.y));
          float crevice = smoothstep(0.55, 0.95, cl.x);
          col *= 1.0 - 0.45 * crevice;
          float grit = step(0.985, tHash3(floor(P * uSGrain * 2.0)));
          col = mix(col, vec3(0.55, 0.5, 0.42), grit * 0.6);
          soilWet = smoothstep(0.62 - 0.35 * uSWet, 0.75 - 0.3 * uSWet, sFbm(P * 0.3 + 11.0)) * (1.0 - crevice * 0.5);
          col *= 1.0 - 0.3 * soilWet; // wet soil is darker
          diffuseColor.rgb *= col;
          roughnessFactor = mix(0.95, 0.28, soilWet);
          float hgt = crumb * 0.7 + sFbm(P * 1.6) * 0.4;
          vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
          float hx = dFdx(hgt); float hy = dFdy(hgt);
          vec3 r1 = cross(dpdy, normal); vec3 r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - grad * uSBump * (1.0 - 0.6 * soilWet));
        }`,
      ],
    ],
  };
}

export interface LeafLitterOptions {
  /** scatter radius (world units) */
  radius: number;
  /** fragment length range (world units) */
  size?: [number, number];
  seed?: number;
  /** vertical offset of the litter layer */
  y?: number;
}

/** scattered torn leaf fragments in a disc (vertex colours + attribute `aLeaf` = (u, v, seed) for veins) */
export function buildLeafLitterGeometry(count: number, o: LeafLitterOptions): BufferGeometry {
  let s = (o.seed ?? 5) * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const [s0, s1] = o.size ?? [0.6, 1.6];
  const pal = LEAF_COLORS.map((h) => new Color(h));
  const pos: number[] = [];
  const col: number[] = [];
  const leaf: number[] = [];
  const idx: number[] = [];
  const NU = 6;
  const NV = 4;
  for (let k = 0; k < count; k++) {
    const r = Math.sqrt(rnd()) * o.radius;
    const a = rnd() * Math.PI * 2;
    const c = new Vector3(Math.cos(a) * r, (o.y ?? 0.01) + k * 0.0004, Math.sin(a) * r);
    const len = s0 + (s1 - s0) * rnd();
    const wid = len * (0.35 + 0.3 * rnd());
    const yaw = rnd() * Math.PI * 2;
    const curl = (rnd() - 0.3) * 0.35 * len;
    const tilt = (rnd() - 0.5) * 0.25;
    const base = new Color().copy(pal[Math.floor(rnd() * pal.length)]).lerp(pal[Math.floor(rnd() * pal.length)], rnd());
    base.multiplyScalar(0.75 + 0.45 * rnd());
    const sd = rnd();
    const b0 = pos.length / 3;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      // ragged leaf outline: half-width varies along the blade, torn ends
      const half = wid * 0.5 * Math.sin(Math.PI * (0.06 + 0.88 * u)) * (0.75 + 0.5 * rnd());
      for (let j = 0; j <= NV; j++) {
        const v = j / NV - 0.5;
        const lx = (u - 0.5) * len;
        const lz = v * 2 * half;
        const ly = curl * (4 * v * v) + tilt * lx + 0.02 * len * Math.sin(u * 7 + sd * 9);
        pos.push(c.x + lx * cy - lz * sy, c.y + Math.max(0, ly), c.z + lx * sy + lz * cy);
        const shade = 0.85 + 0.3 * rnd();
        col.push(base.r * shade, base.g * shade, base.b * shade);
        leaf.push(u, v, sd);
      }
    }
    for (let i = 0; i < NU; i++)
      for (let j = 0; j < NV; j++) {
        const a0 = b0 + i * (NV + 1) + j;
        const a1 = a0 + NV + 1;
        idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1);
      }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('aLeaf', new Float32BufferAttribute(leaf, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** leaf-litter material: vertex colours, midrib + side veins, mottled decay spots, double-sided */
export function createLeafLitterMaterial() {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: DoubleSide });
  applyPatch(mat, {
    key: 'leafLitter',
    vertexHeader: 'attribute vec3 aLeaf; varying vec3 vLeaf;',
    vertex: [['#include <begin_vertex>', '#include <begin_vertex>\nvLeaf = aLeaf;']],
    fragmentHeader: `varying vec3 vLeaf;\n${NOISE_GLSL}`,
    fragment: [
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float mid = 1.0 - smoothstep(0.0, 0.035, abs(vLeaf.y));
          float side = 1.0 - smoothstep(0.0, 0.05, abs(fract(vLeaf.x * 6.0 - abs(vLeaf.y) * 2.5) - 0.5));
          float spots = smoothstep(0.62, 0.8, tNoise(vec3(vLeaf.xy * 9.0, vLeaf.z * 40.0)));
          diffuseColor.rgb *= (1.0 - 0.22 * mid) * (1.0 - 0.12 * side * (1.0 - mid)) * (1.0 - 0.35 * spots);
          diffuseColor.rgb *= 0.85 + 0.3 * tNoise(vec3(vLeaf.xy * 23.0, vLeaf.z * 13.0));
        }`,
      ],
    ],
  } satisfies ShaderPatch);
  return mat;
}
