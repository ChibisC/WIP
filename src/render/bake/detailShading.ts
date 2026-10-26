import * as THREE from 'three';
import type { ShaderPatch } from '../shaderPatch';
import { DetailMaps, REGION_MAX } from './detailBake';

/**
 * Shading with a baked detail atlas (detailBake.ts) on a MeshPhysicalMaterial, as a shader patch that
 * composes with the ant animation patch (or any other): albedo modulation, relief normal (tangent frame
 * from screen-space derivatives of the tile coordinates), roughness offset, cavity occlusion, dark joints,
 * a paler or darker underside, clearcoat broken in the pits, and light shining through thin parts.
 *
 * The geometry needs `aDet` (see detailBake.ts). Parts without it (aDet.w = 0) are left as they were.
 */

const VERT_HEADER = /* glsl */ `
attribute vec4 aDet;
varying vec2 vDetCS;
varying vec4 vDet;`;

const VERT = /* glsl */ `
{
  float th = aDet.x * 6.2831853;
  vDetCS = aDet.x < 0.0 ? vec2(0.0) : vec2(cos(th), sin(th));
  float reg = mod(aDet.w, 32.0);
  // mm along, 0..1 along, girth (mm), region
  vDet = vec4(aDet.y, aDet.z, floor(aDet.w / 32.0 + 0.001) / 1000.0, reg);
}`;

const FRAG_HEADER = /* glsl */ `
uniform sampler2D uDetA;
uniform sampler2D uDetB;
uniform vec4 uDetRect[${REGION_MAX}];
uniform vec2 uDetTile[${REGION_MAX}];
uniform vec4 uDetShade[${REGION_MAX}];
uniform vec4 uDetShade2[${REGION_MAX}];
uniform float uDetOn;
varying vec2 vDetCS;
varying vec4 vDet;
vec4 detA = vec4(0.5, 0.5, 0.5, 0.5);
vec4 detB = vec4(0.5, 0.5, 1.0, 0.0);
float detW = 0.0;          // 0 no detail … 1 full
vec4 detShade = vec4(0.0);
vec4 detShade2 = vec4(0.0);
vec2 detGx = vec2(0.0), detGy = vec2(0.0);
void detailSample() {
  int reg = int(vDet.w + 0.5);
  if (uDetOn < 0.5 || reg <= 0 || reg >= ${REGION_MAX}) return;
  float pole = smoothstep(0.08, 0.3, length(vDetCS));
  if (pole <= 0.0) return;
  vec2 tile = uDetTile[reg];
  // whole tiles around the part (so the seam closes), true scale along it
  float k = max(1.0, floor(vDet.z / tile.x + 0.5));
  vec2 t = vec2(fract(atan(vDetCS.y, vDetCS.x) / 6.2831853) * k, vDet.x / tile.y);
  vec2 gx = dFdx(t), gy = dFdy(t);
  // the angle wraps by k tiles at the seam: undo the jump so the mip level stays right
  gx.x -= k * floor(gx.x / k + 0.5);
  gy.x -= k * floor(gy.x / k + 0.5);
  vec4 rect = uDetRect[reg];
  vec2 sz = vec2(textureSize(uDetA, 0)) * rect.zw;
  float m = max(length(gx * sz), length(gy * sz));
  // past the 16th-of-a-tile mip the gutter would bleed: clamp there and fade the detail out instead of aliasing
  float lim = 16.0;
  float fade = 1.0 - smoothstep(lim, lim * 4.0, m);
  if (m > lim) { gx *= lim / m; gy *= lim / m; }
  vec2 uv = rect.xy + fract(t) * rect.zw;
  detA = textureGrad(uDetA, uv, gx * rect.zw, gy * rect.zw);
  detB = textureGrad(uDetB, uv, gx * rect.zw, gy * rect.zw);
  detW = pole * fade;
  detGx = gx; detGy = gy;
  detShade = uDetShade[reg];
  detShade2 = uDetShade2[reg];
}`;

/** Patch a physical material to use a baked atlas. Apply it after the material's own patches. */
export function detailPatch(maps: DetailMaps): ShaderPatch {
  return {
    key: 'detail',
    uniforms: {
      uDetA: { value: maps.a },
      uDetB: { value: maps.b },
      uDetRect: { value: maps.rects },
      uDetTile: { value: maps.tiles.map(([a, b]) => new THREE.Vector2(a, b)) },
      uDetShade: { value: maps.shade },
      uDetShade2: { value: maps.shade2 },
      uDetOn: { value: 1 },
    },
    vertexHeader: VERT_HEADER,
    vertex: [['#include <uv_vertex>', `#include <uv_vertex>\n${VERT}`]],
    fragmentHeader: FRAG_HEADER,
    fragment: [
      [
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        detailSample();
        if (detW > 0.0) {
          diffuseColor.rgb *= mix(vec3(1.0), detA.rgb * 2.0, detW);
          // dark joints and sutures at the part's ends; the underside of body parts
          float vn = vDet.y;
          float jt = 1.0 - smoothstep(0.0, 0.14, min(vn, 1.0 - vn));
          diffuseColor.rgb *= 1.0 - detShade.y * jt * 0.55;
          diffuseColor.rgb *= 1.0 - detShade.z * 0.22 * clamp(-vDetCS.y, 0.0, 1.0) * detW;
        }`,
      ],
      [
        '#include <metalnessmap_fragment>',
        /* glsl */ `if (detW > 0.0) roughnessFactor = clamp(roughnessFactor + (detA.a - 0.5) * detW, 0.04, 1.0);
        #include <metalnessmap_fragment>`,
      ],
      [
        '#include <clearcoat_normal_fragment_begin>',
        /* glsl */ `if (detW > 0.0) {
          vec3 dN = vec3((detB.rg * 2.0 - 1.0) * detShade.x * detW, 1.0);
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
          vec3 T = q1p * detGx.x + q0p * detGy.x;
          vec3 B = q1p * detGx.y + q0p * detGy.y;
          float dt = max(dot(T, T), dot(B, B));
          float sc = dt == 0.0 ? 0.0 : inversesqrt(dt);
          normal = normalize(T * (dN.x * sc) + B * (dN.y * sc) + normal * dN.z);
        }
        #include <clearcoat_normal_fragment_begin>`,
      ],
      [
        '#include <aomap_fragment>',
        /* glsl */ `if (detW > 0.0) {
          // the lacquer is broken in the pits (scaled here: the coat is mixed in after this, by material.clearcoat)
          #ifdef USE_CLEARCOAT
            material.clearcoat *= mix(1.0, detShade2.x, (1.0 - detB.b) * detW);
          #endif
          float cav = mix(1.0, detB.b, detW);
          reflectedLight.indirectDiffuse *= cav;
          reflectedLight.indirectSpecular *= mix(1.0, cav, 0.7);
          reflectedLight.directDiffuse *= mix(1.0, cav, 0.35);
          #if NUM_DIR_LIGHTS > 0
          {
            // light through thin cuticle: strongest with the sun behind the part, plus a little wrap
            float thick = detShade.w;
            vec3 Ld = directionalLights[0].direction;
            vec3 Vd = normalize(vViewPosition);
            float back = pow(clamp(dot(-Vd, Ld) * 0.5 + 0.5, 0.0, 1.0), 4.0);
            float wrap = clamp((dot(normal, Ld) + 0.45) / 1.45, 0.0, 1.0) - clamp(dot(normal, Ld), 0.0, 1.0);
            reflectedLight.directDiffuse += thick * directionalLights[0].color * diffuseColor.rgb * (back * 0.55 + wrap * 0.35);
          }
          #endif
        }
        #include <aomap_fragment>`,
      ],
    ],
  };
}

/** A geometry with no detail (aDet all zero), so a material with the patch can still draw it. */
export function ensureDetailAttr(g: THREE.BufferGeometry): void {
  if (!g.getAttribute('aDet')) g.setAttribute('aDet', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 4), 4));
}
