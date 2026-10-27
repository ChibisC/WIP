import * as THREE from 'three';
import type { ShaderPatch } from '../shaderPatch';
import { DetailMaps, REGION_MAX } from './detailBake';

/**
 * Shading with a baked detail atlas (detailBake.ts) on a MeshPhysicalMaterial, as a shader patch that
 * composes with the ant animation patch (or any other):
 *   colour  albedo modulation (pits, dust in the hollows, mottling), darker joints and sutures, lighter
 *           mid-segments, worn high points and edges a little lighter, dust on the underside and low parts
 *   relief  a normal from the baked relief (tangent frame from screen-space derivatives of the tile
 *           coordinates) — on the base layer AND the clearcoat, so the lacquer highlight breaks up on the
 *           sculpture instead of sitting on the smooth mesh as one round blob
 *   gloss   roughness from the bake (pits duller, patchy, worn points smoother, dust rough), clearcoat
 *           roughness per region, the coat broken in the pits and under dust
 *   light   baked occlusion per vertex (crevices, joints, under the body) and in the pits; light through thin
 *           cuticle from the sun and from the sky behind the part (legs, antennae, tarsi, mandible tips)
 *
 * The geometry needs `aDet` (see detailBake.ts, antGeometry `detOf` / `bakeOcclusion`):
 *   x  angle around / 2π (fraction) + occlusion level (integer part); −1 − level at a pole
 *   y  mm along the part, z 0..0.998 along it (fraction) + convexity level (integer part), w region + 32 × girth µm
 * Parts without it (aDet.w = 0) are left as they were.
 */

/** Occlusion and convexity are stored as integer levels 0..OCC_LEVELS in aDet.x and aDet.z. */
export const OCC_LEVELS = 30;

const VERT_HEADER = /* glsl */ `
attribute vec4 aDet;
varying vec2 vDetCS;
varying vec4 vDet;
varying vec2 vDetOcc;`;

const VERT = /* glsl */ `
{
  float ax = aDet.x;
  float pole = ax < 0.0 ? 1.0 : 0.0;
  float occQ = ax < 0.0 ? (-ax - 1.0) : floor(ax);
  float th = fract(max(ax, 0.0)) * 6.2831853;
  vDetCS = pole > 0.5 ? vec2(0.0) : vec2(cos(th), sin(th));
  float reg = mod(aDet.w, 32.0);
  // mm along, 0..1 along, girth (mm), region
  vDet = vec4(aDet.y, fract(max(aDet.z, 0.0)) / 0.998, floor(aDet.w / 32.0 + 0.001) / 1000.0, reg);
  // occlusion (1 open … 0 enclosed) and convexity (0 flat … 1 sharp edge)
  vDetOcc = vec2(1.0 - occQ / ${OCC_LEVELS.toFixed(1)}, floor(max(aDet.z, 0.0)) / ${OCC_LEVELS.toFixed(1)});
  if (aDet.w < 0.5) vDetOcc = vec2(1.0, 0.0);
}`;

const FRAG_HEADER = /* glsl */ `
uniform sampler2D uDetA;
uniform sampler2D uDetB;
uniform vec4 uDetRect[${REGION_MAX}];
uniform vec2 uDetTile[${REGION_MAX}];
uniform vec4 uDetShade[${REGION_MAX}];
uniform vec4 uDetShade2[${REGION_MAX}];
uniform vec4 uDetShade3[${REGION_MAX}];
uniform vec4 uDetBands[${REGION_MAX}];
uniform vec4 uDetBand[${REGION_MAX}];
uniform float uDetOn;
uniform vec3 uDustColor;
varying vec2 vDetCS;
varying vec4 vDet;
varying vec2 vDetOcc;
vec4 detA = vec4(0.5, 0.5, 0.5, 0.5);
vec4 detB = vec4(0.5, 0.5, 1.0, 0.0);
float detW = 0.0;          // 0 no detail … 1 full
float detOn = 0.0;         // the part has a region (whatever the distance)
float detDust = 0.0;
float detWear = 0.0;
vec4 detShade = vec4(0.0);
vec4 detShade2 = vec4(0.0);
vec4 detShade3 = vec4(0.0);
float detSeam = 0.0, detMargin = 0.0;   // on a suture, on the pale margin before it
vec2 detGx = vec2(0.0), detGy = vec2(0.0);
void detailSample() {
  int reg = int(vDet.w + 0.5);
  if (uDetOn < 0.5 || reg <= 0 || reg >= ${REGION_MAX}) return;
  detOn = 1.0;
  detShade = uDetShade[reg];
  detShade2 = uDetShade2[reg];
  detShade3 = uDetShade3[reg];
  {
    vec4 bp = uDetBands[reg]; vec4 bl = uDetBand[reg];
    float vn = clamp(vDet.y, 0.0, 1.0);
    for (int i = 0; i < 4; i++) {
      float b = bp[i];
      if (b <= 0.0) continue;
      float d = vn - b;
      detSeam = max(detSeam, 1.0 - smoothstep(bl.x * 0.4, bl.x, abs(d)));
      detMargin = max(detMargin, smoothstep(-bl.w, -bl.w * 0.4, d) * (1.0 - smoothstep(-bl.x, -bl.x * 0.3, d)));
    }
  }
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
}`;

/** Code run just before the lights are evaluated (clearcoat roughness and dust on the coat). */
const PRE_LIGHTS = /* glsl */ `
#ifdef USE_CLEARCOAT
  if (detOn > 0.5) {
    if (detShade2.y > 0.0) material.clearcoatRoughness = clamp(detShade2.y + 0.25 * detDust - 0.08 * detWear, 0.03, 1.0);
    material.clearcoat *= 1.0 - 0.7 * detDust;
  }
#endif
`;

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
      uDetShade3: { value: maps.shade3 },
      uDetBands: { value: maps.bands },
      uDetBand: { value: maps.band },
      uDetOn: { value: 1 },
      // fine dust: dull grey-brown (linear)
      uDustColor: { value: new THREE.Color(0x8a7e6c) },
    },
    vertexHeader: VERT_HEADER,
    vertex: [['#include <uv_vertex>', `#include <uv_vertex>\n${VERT}`]],
    fragmentHeader: FRAG_HEADER,
    fragment: [
      [
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        detailSample();
        if (detOn > 0.5) {
          diffuseColor.rgb *= mix(vec3(1.0), detA.rgb * 2.0, detW);
          float vn = clamp(vDet.y, 0.0, 1.0);
          // dark joints and sutures at the part's ends, lighter toward the middle of the segment
          float jt = 1.0 - smoothstep(0.0, 0.14, min(vn, 1.0 - vn));
          diffuseColor.rgb *= 1.0 - detShade.y * jt * 0.55;
          diffuseColor.rgb *= 1.0 + detShade3.x * (sin(3.14159 * vn) - 0.55) * 0.5;
          // sutures: a dark seam, the thin pale margin of the plate before it
          diffuseColor.rgb *= 1.0 - uDetBand[int(vDet.w + 0.5)].y * detSeam;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + vec3(0.02, 0.012, 0.004), uDetBand[int(vDet.w + 0.5)].z * detMargin);
          // the underside of body parts
          float below = clamp(-vDetCS.y, 0.0, 1.0);
          diffuseColor.rgb *= 1.0 - detShade.z * 0.22 * below;
          // worn high points of the sculpture and convex edges of the part: lighter
          detWear = detShade2.z * clamp(detB.a * detW + vDetOcc.y * 1.2, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + vec3(0.012, 0.010, 0.008), detWear * 0.6);
          // dust: in the hollows, on the underside, in occluded corners
          float hollow = (1.0 - detB.b) * detW;
          detDust = detShade2.w * clamp(hollow * 0.8 + below * 0.45 + (1.0 - vDetOcc.x) * 0.6, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uDustColor * (0.75 + 0.5 * detA.g), detDust * 0.55);
        }`,
      ],
      [
        '#include <metalnessmap_fragment>',
        /* glsl */ `if (detOn > 0.5) roughnessFactor = clamp(roughnessFactor + (detA.a - 0.5) * detW - 0.12 * detWear + 0.35 * detDust, 0.04, 1.0);
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
        #include <clearcoat_normal_fragment_begin>
        #ifdef USE_CLEARCOAT
          // the wax and lacquer follow the sculpture: the coat's highlight breaks up on it
          if (detOn > 0.5) clearcoatNormal = normalize(mix(clearcoatNormal, normal, detShade3.z));
        #endif`,
      ],
      [
        '#include <aomap_fragment>',
        /* glsl */ `if (detOn > 0.5) {
          // the lacquer is broken in the pits (scaled here: the coat is mixed in after this, by material.clearcoat)
          #ifdef USE_CLEARCOAT
            material.clearcoat *= mix(1.0, detShade2.x, (1.0 - detB.b) * detW);
          #endif
          float cav = mix(1.0, detB.b, detW);
          float occ = vDetOcc.x;
          reflectedLight.indirectDiffuse *= cav * occ;
          reflectedLight.indirectSpecular *= mix(1.0, cav, 0.7) * mix(1.0, occ, 0.8);
          reflectedLight.directDiffuse *= mix(1.0, cav, 0.35);
          // light through thin cuticle, thinner toward the tips of thin parts
          float thick = detShade.w * (1.0 + detShade3.y * smoothstep(0.3, 1.0, clamp(vDet.y, 0.0, 1.0))) + 0.5 * detMargin * uDetBand[int(vDet.w + 0.5)].z;
          reflectedLight.indirectDiffuse *= 1.0 - 0.5 * detSeam;
          vec3 Vd = normalize(vViewPosition);
          #if NUM_DIR_LIGHTS > 0
          {
            // from the sun: strongest with the sun behind the part, plus a little wrap round the edge
            vec3 Ld = directionalLights[0].direction;
            float back = pow(clamp(dot(-Vd, Ld) * 0.5 + 0.5, 0.0, 1.0), 4.0);
            float wrap = clamp((dot(normal, Ld) + 0.45) / 1.45, 0.0, 1.0) - clamp(dot(normal, Ld), 0.0, 1.0);
            reflectedLight.directDiffuse += thick * directionalLights[0].color * diffuseColor.rgb * (back * 0.55 + wrap * 0.35);
          }
          #endif
          #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
            // from the sky behind the part
            reflectedLight.indirectDiffuse += thick * 0.35 * diffuseColor.rgb * getIBLIrradiance( -geometryNormal ) * RECIPROCAL_PI * occ;
          #endif
        }
        #include <aomap_fragment>`,
      ],
    ],
    fragmentOpt: [
      ['#include <lights_fragment_begin>', PRE_LIGHTS + '\n#include <lights_fragment_begin>'],
      ['vec3 geometryPosition = - vViewPosition;', PRE_LIGHTS + '\nvec3 geometryPosition = - vViewPosition;'],
    ],
  };
}

/** A geometry with no detail (aDet all zero), so a material with the patch can still draw it. */
export function ensureDetailAttr(g: THREE.BufferGeometry): void {
  if (!g.getAttribute('aDet')) g.setAttribute('aDet', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 4), 4));
}
