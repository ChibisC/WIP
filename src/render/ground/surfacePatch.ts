import * as THREE from 'three';
import { addPatch, type ShaderPatch } from '../shaderPatch';
import { GL, GL_TILE, groundMaps } from './groundBake';

/**
 * Shared material patches for the things standing on the ground (ground realism item 5; render only):
 *
 *  - `bakedSurfacePatch`: rocks, stones, logs and roots take their surface from the baked ground layers
 *    (render/ground/groundBake.ts) by world-space triplanar projection at true scale — weathered stone with pits,
 *    bedding and lichen; ridged bark — instead of a small repeating canvas texture. The vertex colours (moss on top,
 *    a darker foot, lichen) still tint it. Gloss only where it is real: a rock is matte to satin, wet only near water
 *    (`wetBelow`: up to this many mm above the given water level it is darker and glossier).
 *  - `thinLightPatch`: light through thin leaves, petals and grass blades — when the sun is behind a blade, the blade
 *    glows with its own colour (transmission), as real leaves do against the light.
 */

export interface BakedSurfaceOpts {
  /** the baked layer to project (GL.ROCK, GL.BANK_ROOT, …) */
  layer: number;
  /** relief strength (1 = the layer's own) */
  relief?: number;
  /** keep this much of the material's own colour map (0 = all from the baked layer) */
  keepMap?: number;
  /** water level (mm) below which the surface is wet, and the damp band above it (mm) */
  waterLevel?: number;
  wetBand?: number;
}

export function bakedSurfacePatch(mat: THREE.MeshStandardMaterial, o: BakedSurfaceOpts): void {
  const maps = groundMaps();
  if (!maps) return;
  const p: ShaderPatch = {
    key: 'bakedSurface',
    uniforms: {
      tBA: { value: maps.a },
      tBN: { value: maps.n },
      uBL: { value: o.layer },
      uBInv: { value: 1 / GL_TILE[o.layer] },
      uBRelief: { value: o.relief ?? 1 },
      uBKeep: { value: o.keepMap ?? 0 },
      uBWater: { value: new THREE.Vector2(o.waterLevel ?? -9999, o.wetBand ?? 6) },
    },
    vertexHeader: 'varying vec3 vBN;',
    vertex: [['#include <begin_vertex>', '#include <begin_vertex>\n vBN = normalize(inverseTransformDirection(transformedNormal, viewMatrix));']],
    fragmentHeader: /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tBA, tBN; uniform float uBL, uBInv, uBRelief, uBKeep; uniform vec2 uBWater;
varying vec3 vBN;
struct BS { vec3 alb; float rough; vec3 n; float cav; float wet; };
BS bakedSurface() {
  vec3 N = normalize(vBN);
  vec3 w = pow(abs(N), vec3(4.0)); w /= dot(w, vec3(1.0));
  vec3 P = vWP * uBInv;
  vec2 ux = P.zy, uy = P.xz + 0.37, uz = P.xy + 0.71;
  vec4 Ax = texture(tBA, vec3(ux, uBL)), Ay = texture(tBA, vec3(uy, uBL)), Az = texture(tBA, vec3(uz, uBL));
  vec4 Nx = texture(tBN, vec3(ux, uBL)), Ny = texture(tBN, vec3(uy, uBL)), Nz = texture(tBN, vec3(uz, uBL));
  BS s;
  vec4 A = Ax * w.x + Ay * w.y + Az * w.z;
  s.alb = pow(A.rgb, vec3(2.2));
  s.rough = A.a;
  s.cav = Nx.a * w.x + Ny.a * w.y + Nz.a * w.z;
  // whiteout-style blend of the three tangent normals into world space
  vec2 nx = (Nx.xy * 2.0 - 1.0) * uBRelief, ny = (Ny.xy * 2.0 - 1.0) * uBRelief, nz = (Nz.xy * 2.0 - 1.0) * uBRelief;
  vec3 nW = N + vec3(0.0, nx.y, nx.x) * w.x + vec3(ny.x, 0.0, ny.y) * w.y + vec3(nz.x, nz.y, 0.0) * w.z;
  s.n = normalize(nW);
  float dWater = vWP.y - uBWater.x;
  s.wet = uBWater.x > -9000.0 ? 1.0 - smoothstep(0.0, uBWater.y, dWater) : 0.0;
  return s;
}`,
    fragment: [
      [
        '#include <map_fragment>',
        `#include <map_fragment>
         BS bs = bakedSurface();
         diffuseColor.rgb = mix(bs.alb * 1.6, diffuseColor.rgb, uBKeep) * mix(1.0, bs.cav, 0.6);
         diffuseColor.rgb *= mix(1.0, 0.55, bs.wet);`,
      ],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(bs.rough, 0.2, bs.wet * 0.8);'],
      ['#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize((viewMatrix * vec4(bs.n, 0.0)).xyz);'],
    ],
  };
  addPatch(mat, p);
}

/**
 * Light through thin leaves and petals: the sun behind a blade shows through it in its own colour. `k` the share of
 * the direct light transmitted (0.2–0.45 for leaves, petals more).
 */
export function thinLightPatch(mat: THREE.MeshStandardMaterial, k = 0.35): void {
  // the directional lights' RE_Direct (the sun): from it to the area-light section, unique in the chunk
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const i0 = chunk.indexOf('getDirectionalLightInfo( directionalLight, directLight );');
  const i1 = chunk.indexOf('RE_Direct(', i0);
  const i2 = chunk.indexOf(';', i1) + 1;
  const i3 = chunk.indexOf('NUM_RECT_AREA_LIGHTS', i2);
  if (i0 < 0 || i1 < 0 || i3 < 0) return;
  const call = chunk.slice(i1, i2);
  const tail = chunk.slice(i2, i3);
  addPatch(mat, {
    key: 'thinLight',
    uniforms: { uThin: { value: k } },
    fragmentHeader: 'uniform float uThin;',
    fragmentOpt: [
      [
        call + tail,
        `${call}
         { float bk = max(dot(-geometryNormal, directLight.direction), 0.0);
           float vw = 0.5 + 0.5 * max(dot(geometryViewDir, -directLight.direction), 0.0);
           reflectedLight.directDiffuse += directLight.color * material.diffuseColor * bk * vw * uThin; }` + tail,
      ],
    ],
  });
}

export { GL };
