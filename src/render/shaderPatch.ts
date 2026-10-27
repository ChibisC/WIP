import * as THREE from 'three';

/**
 * Composable onBeforeCompile patches. Three only allows a single
 * onBeforeCompile per material, so every effect (dappled light, wind, ant
 * skinning, overlays) registers a patch here and they are applied in order.
 */
export interface ShaderPatch {
  key: string;
  uniforms?: Record<string, THREE.IUniform>;
  vertexHeader?: string;
  fragmentHeader?: string;
  /** [searchString, replacement] pairs; replacement may include the search string. */
  vertex?: Array<[string, string]>;
  fragment?: Array<[string, string]>;
  /** fragment pairs applied only where their search string is present (no warning when it is not) */
  fragmentOpt?: Array<[string, string]>;
  defines?: Record<string, string | number>;
}

/** Uniforms shared by every patched material (updated once per frame). */
export const globalUniforms = {
  uTime: { value: 0 },
  uDappleStrength: { value: 0.7 },
  uDappleScale: { value: 1 / 55 },
  uWind: { value: new THREE.Vector2(1, 0.3) },
  uWindStrength: { value: 1 },
  uFocus: { value: new THREE.Vector3() },
  uCamPos: { value: new THREE.Vector3() },
  uSeeThrough: { value: 1 },
};

type Patched = THREE.Material & { __patches?: ShaderPatch[] };

export function addPatch(mat: THREE.Material, patch: ShaderPatch): void {
  const m = mat as Patched;
  if (!m.__patches) {
    m.__patches = [];
    m.onBeforeCompile = (shader) => {
      for (const p of m.__patches!) {
        if (p.uniforms) Object.assign(shader.uniforms, p.uniforms);
        if (p.defines) {
          shader.defines = shader.defines || {};
          Object.assign(shader.defines, p.defines);
        }
        if (p.vertexHeader) shader.vertexShader = shader.vertexShader.replace('void main() {', p.vertexHeader + '\nvoid main() {');
        if (p.fragmentHeader) shader.fragmentShader = shader.fragmentShader.replace('void main() {', p.fragmentHeader + '\nvoid main() {');
        for (const [a, b] of p.vertex ?? []) {
          if (!shader.vertexShader.includes(a)) console.warn(`[patch ${p.key}] vertex marker missing: ${a}`);
          shader.vertexShader = shader.vertexShader.replace(a, b);
        }
        for (const [a, b] of p.fragment ?? []) {
          if (!shader.fragmentShader.includes(a)) console.warn(`[patch ${p.key}] fragment marker missing: ${a}`);
          shader.fragmentShader = shader.fragmentShader.replace(a, b);
        }
        for (const [a, b] of p.fragmentOpt ?? []) shader.fragmentShader = shader.fragmentShader.replace(a, b);
      }
    };
  }
  m.__patches = m.__patches.filter((p) => p.key !== patch.key);
  m.__patches.push(patch);
  const keys = m.__patches.map((p) => p.key).join('|');
  m.customProgramCacheKey = () => keys;
  m.needsUpdate = true;
}

/** GLSL: world position varying computed after project_vertex (works with instancing). */
export const WORLD_POS_PATCH: ShaderPatch = {
  key: 'worldpos',
  vertexHeader: 'varying vec3 vWP;',
  fragmentHeader: 'varying vec3 vWP;',
  vertex: [
    [
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 _wp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          _wp = instanceMatrix * _wp;
        #endif
        vWP = ( modelMatrix * _wp ).xyz;
      }`,
    ],
  ],
};

export const NOISE_GLSL = /* glsl */ `
#ifndef UD_NOISE
#define UD_NOISE
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y);
}
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=0.5;} return s; }
#endif
`;

/**
 * Dappled canopy light: modulates the sun (directional lights only) with a
 * slowly drifting leaf-shadow pattern evaluated at the world position.
 */
export function dapplePatch(): ShaderPatch {
  const lfb = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= _dapple;',
  );
  return {
    key: 'dapple',
    uniforms: {
      uTime: globalUniforms.uTime,
      uDappleStrength: globalUniforms.uDappleStrength,
      uDappleScale: globalUniforms.uDappleScale,
    },
    fragmentHeader: `uniform float uTime; uniform float uDappleStrength; uniform float uDappleScale;
${NOISE_GLSL}
float dappleAt(vec3 wp){
  vec2 p = wp.xz * uDappleScale;
  vec2 drift = vec2(uTime*0.010, uTime*0.006);
  float a = fbm(p + drift);
  float b = fbm(p*2.7 - drift*1.7 + 3.1);
  float m = smoothstep(0.44, 0.58, a*0.8 + b*0.3);
  return mix(1.0, mix(0.22, 1.2, m), uDappleStrength);
}`,
    fragment: [['#include <lights_fragment_begin>', 'float _dapple = dappleAt(vWP);\n' + lfb]],
  };
}

export function patchDapple(mat: THREE.Material): void {
  addPatch(mat, WORLD_POS_PATCH);
  addPatch(mat, dapplePatch());
}
