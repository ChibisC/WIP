/**
 * Carton: the dark, papery, layered nest material of Nasutitermes
 * (mostly faeces with chewed wood, bound with saliva — UF/IFAS, FDACS).
 *
 *  - createCartonMaterial(): world-space procedural MeshStandardMaterial for nest walls, brood tiles,
 *    the royal chamber and gallery tubes. Works on any geometry (no UVs needed), instanced or not.
 *  - buildGalleryTubeGeometry(): covered foraging gallery (~1 soldier body length wide), lumpy, flattened
 *    against the substrate, hollow, with optional broken-open sections.
 */
import { CatmullRomCurve3, Color, DoubleSide, MeshStandardMaterial, TubeGeometry, Vector3, BufferGeometry, Float32BufferAttribute } from 'three';
import { NOISE_GLSL } from './shaders';
import { applyPatch, ShaderPatch } from './material';

export interface CartonOptions {
  /** world units per mm (so layer spacing reads correctly at game scale) */
  unitsPerMm?: number;
  /** layer (lamina) spacing in mm */
  layerMm?: number;
  /** bump strength */
  bump?: number;
  colors?: [string, string, string];
  doubleSided?: boolean;
}

export function createCartonMaterial(o: CartonOptions = {}) {
  const [c0, c1, c2] = (o.colors ?? ['#2A1D14', '#3B2A1E', '#5B4431']).map((h) => new Color(h));
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  if (o.doubleSided) mat.side = DoubleSide;
  const uniforms = {
    uC0: { value: c0 },
    uC1: { value: c1 },
    uC2: { value: c2 },
    uScale: { value: 1 / (o.unitsPerMm ?? 1) },
    uLayer: { value: 1 / (o.layerMm ?? 0.35) },
    uBump: { value: o.bump ?? 0.6 },
  };
  mat.userData.cartonUniforms = uniforms;
  applyPatch(mat, cartonPatch(uniforms));
  return mat;
}

/** carton shading as a patch in the game's format (chains with its world-pos / dapple patches) */
export function cartonPatch(uniforms: Record<string, { value: unknown }>): ShaderPatch {
  return {
    key: 'carton',
    uniforms,
    vertexHeader: 'varying vec3 vCartonW;',
    vertex: [
      [
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 cw_ = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cw_ = instanceMatrix * cw_;
          #endif
          vCartonW = (modelMatrix * cw_).xyz;
        }`,
      ],
    ],
    fragmentHeader: `uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform float uScale; uniform float uLayer; uniform float uBump;
      varying vec3 vCartonW;
      ${NOISE_GLSL}
      float cFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * tNoise(p); p *= 2.07; a *= 0.5; } return s; }`,
    fragment: [
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 P = vCartonW * uScale; // mm
          float warp = cFbm(P * 0.35) * 3.0 + cFbm(P * 1.3) * 0.6;
          float h = P.y * uLayer + warp;
          float lam = fract(h);
          float ridge = smoothstep(0.0, 0.18, lam) * (1.0 - smoothstep(0.55, 1.0, lam));
          float big = cFbm(P * 0.18);
          vec3 col = mix(uC0, uC1, smoothstep(0.25, 0.75, big));
          col = mix(col, uC2, ridge * 0.55 * smoothstep(0.3, 0.8, cFbm(P * 0.9 + 7.0)));
          float fib = smoothstep(0.78, 0.95, tNoise(P * vec3(9.0, 3.0, 9.0) + 2.0));
          col = mix(col, uC2 * 1.35, fib * 0.45);
          float grit = tNoise(P * 14.0);
          col *= 0.88 + 0.24 * grit;
          diffuseColor.rgb *= col;
          roughnessFactor = 0.86 + 0.1 * grit;
          float hgt = ridge * 0.6 + cFbm(P * 2.2) * 0.5 + fib * 0.2;
          vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
          float hx = dFdx(hgt); float hy = dFdy(hgt);
          vec3 r1 = cross(dpdy, normal); vec3 r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2);
          normal = normalize(abs(det) * normal - grad * uBump);
        }`,
      ],
    ],
  };
}

export interface GalleryOptions {
  /** outer radius (world units). Real tubes are ~5 mm wide = 1 soldier body length */
  radius: number;
  tubularSegments?: number;
  radialSegments?: number;
  lumpiness?: number;
  /** 0..1 how much the underside is flattened against the substrate */
  flatten?: number;
  /** ranges of the path parameter (0..1) where the tube is broken open */
  broken?: [number, number][];
  seed?: number;
}

export function buildGalleryTubeGeometry(points: Vector3[], o: GalleryOptions): BufferGeometry {
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const tub = o.tubularSegments ?? Math.max(16, points.length * 12);
  const rad = o.radialSegments ?? 14;
  const tube = new TubeGeometry(curve, tub, o.radius, rad, false);
  const pos = tube.getAttribute('position');
  const nor = tube.getAttribute('normal');
  const lump = (o.lumpiness ?? 0.18) * o.radius;
  const flat = o.flatten ?? 0.6;
  const seed = o.seed ?? 3;
  const v = new Vector3();
  const n = new Vector3();
  const hash = (x: number) => {
    const s = Math.sin(x * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i <= tub; i++) {
    const c = curve.getPointAt(i / tub);
    for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j;
      v.fromBufferAttribute(pos, k);
      n.fromBufferAttribute(nor, k);
      const bumpy = (hash(i * 0.37 + j * 1.91) - 0.5) * lump + Math.sin(i * 0.9 + seed) * lump * 0.4;
      v.addScaledVector(n, bumpy);
      // flatten the underside onto the substrate (below the path centre)
      if (v.y < c.y) v.y = c.y - (c.y - v.y) * (1 - flat);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  tube.computeVertexNormals();
  if (o.broken?.length) {
    const index = tube.getIndex()!;
    const keep: number[] = [];
    for (let f = 0; f < index.count; f += 3) {
      const a = index.getX(f);
      const ring = Math.floor(a / (rad + 1)) / tub;
      const j = a % (rad + 1);
      const topHalf = j > rad * 0.1 && j < rad * 0.9; // keep the floor of a broken tube
      const isBroken = o.broken.some(([t0, t1]) => ring >= t0 && ring <= t1) && topHalf;
      if (!isBroken) keep.push(index.getX(f), index.getX(f + 1), index.getX(f + 2));
    }
    tube.setIndex(keep);
  }
  // plain attributes only (works with any material)
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(Array.from(tube.getAttribute('position').array as Float32Array), 3));
  g.setAttribute('normal', new Float32BufferAttribute(Array.from(tube.getAttribute('normal').array as Float32Array), 3));
  g.setIndex(Array.from(tube.getIndex()!.array as ArrayLike<number>));
  tube.dispose();
  return g;
}
