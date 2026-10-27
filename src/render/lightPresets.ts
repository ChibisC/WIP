import * as THREE from 'three';
import type { ShaderPatch } from './shaderPatch';

/**
 * Image-based lighting for creatures and ants (realism pass v2, docs/realism).
 *
 * Glossy cuticle only looks like cuticle when it has a world to reflect: a bright sky with clouds or canopy
 * gaps above, a dark green-brown ground below, grass and stems at the horizon. A flat sky gradient plus one
 * hemisphere light gives every glossy part a smooth, even sheen — the plastic look. Each preset renders a
 * small procedural world into a cube map (PMREM-filtered for every roughness), used as the environment of
 * every creature and ant material; the directional sun stays for shadows and the sharp highlight.
 *
 *   sunny     clear sky, a few clouds, bright sun (meadow, riverbank, savanna)
 *   overcast  bright even cloud, soft weak sun (storms)
 *   forest    leaf canopy with bright gaps, trunks, a brown litter floor (forest floor, rainforest)
 *
 * The environment replaces most of the flat hemisphere ambient on those materials (`creatureLightPatch`), so the
 * ambient light now comes from somewhere: brighter from the sky, dark from the ground, broken by the canopy.
 */

export type LightPreset = 'sunny' | 'overcast' | 'forest';

export interface PresetLight {
  /** directional sun: intensity and colour */
  sun: number;
  sunColor: number;
  /** hemisphere light kept on creature materials (0..1 of the scene's) */
  hemiK: number;
  /** environment strength on creature materials */
  env: number;
  /** env glow around the sun (the sharp disk is the directional light) */
  sunGlow: number;
}

export const PRESETS: Record<LightPreset, PresetLight> = {
  sunny: { sun: 3.0, sunColor: 0xfff0dc, hemiK: 0.18, env: 1.0, sunGlow: 1.0 },
  overcast: { sun: 0.9, sunColor: 0xeef0f4, hemiK: 0.15, env: 1.35, sunGlow: 0.15 },
  forest: { sun: 1.8, sunColor: 0xf6eccd, hemiK: 0.2, env: 1.1, sunGlow: 0.5 },
};

/** Which preset a map biome uses (render/mapBiomes BIOME_LIGHT keys). */
export function presetForBiome(biome: string | undefined): LightPreset {
  if (biome === 'forest' || biome === 'rainforest') return 'forest';
  return 'sunny';
}

const ENV_VS = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const ENV_FS = /* glsl */ `
varying vec3 vDir;
uniform int uPreset;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uGlow;
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n3(p); p = p * 2.03 + 3.1; a *= 0.5; } return s; }
float n1(float x){ float i = floor(x), f = fract(x); return mix(h31(vec3(i, 1.7, 3.1)), h31(vec3(i + 1.0, 1.7, 3.1)), f * f * (3.0 - 2.0 * f)); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float az = atan(d.z, d.x);
  vec3 c;
  // ground: litter and soil, lit from above (dark: it is what the underside of a beetle reflects)
  float lit = fbm3(d * 7.0);
  vec3 ground = uPreset == 2 ? mix(vec3(0.030, 0.022, 0.014), vec3(0.075, 0.055, 0.032), lit)
              : (uPreset == 1 ? mix(vec3(0.040, 0.042, 0.032), vec3(0.085, 0.085, 0.065), lit)
                              : mix(vec3(0.050, 0.055, 0.025), vec3(0.130, 0.115, 0.060), lit));
  if (uPreset == 0) {
    // clear sky about a fifth as bright as the sunlit ground (the shadows deep, black cuticle black)
    vec3 zen = vec3(0.07, 0.115, 0.25), hor = vec3(0.36, 0.40, 0.45);
    c = mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.55));
    // fair-weather cumulus
    vec3 q = vec3(d.x, 0.0, d.z) / (max(y, 0.0) + 0.18);
    float cl = smoothstep(0.52, 0.74, fbm3(q * 1.3 + 11.0));
    c = mix(c, vec3(0.78, 0.78, 0.8) * (0.8 + 0.4 * fbm3(q * 4.0)), cl * 0.9 * smoothstep(0.02, 0.12, y));
  } else if (uPreset == 1) {
    // overcast: bright, nearly even, a little brighter overhead, soft cloud bands
    float b = fbm3(vec3(d.x, 0.0, d.z) / (max(y, 0.0) + 0.3) * 1.2);
    c = mix(vec3(0.55, 0.57, 0.60), vec3(0.95, 0.96, 0.99), pow(clamp(y, 0.0, 1.0), 0.5)) * (0.85 + 0.3 * b);
  } else {
    // forest: sky through a leaf canopy — dark leaves with bright gaps, more gaps overhead
    vec3 sky = mix(vec3(0.45, 0.52, 0.55), vec3(0.60, 0.70, 0.78), clamp(y, 0.0, 1.0));
    float leaves = fbm3(d * 9.0) * 0.7 + fbm3(d * 23.0) * 0.3;
    float gap = smoothstep(0.62 - 0.12 * clamp(y, 0.0, 1.0), 0.68 - 0.12 * clamp(y, 0.0, 1.0), leaves);
    vec3 leaf = mix(vec3(0.020, 0.040, 0.012), vec3(0.070, 0.110, 0.030), fbm3(d * 31.0));
    c = mix(leaf, sky * 1.4, gap * smoothstep(0.08, 0.4, y));
    // trunks rising from the floor
    float tr = 0.0;
    for (int k = 0; k < 7; k++) {
      float a0 = float(k) * 0.897 + 0.3;
      float w = 0.05 + 0.04 * h31(vec3(float(k), 2.0, 5.0));
      float da = abs(mod(az - a0 + 3.14159, 6.28318) - 3.14159);
      tr = max(tr, smoothstep(w, w * 0.7, da) * smoothstep(0.75, 0.3, y));
    }
    c = mix(c, vec3(0.035, 0.028, 0.020) * (0.7 + 0.6 * n3(d * 40.0)), tr);
  }
  // grass blades and stems against the horizon (all presets), rising out of the ground
  {
    float blade = n1(az * 70.0) * 0.6 + n1(az * 190.0) * 0.4;
    float top = -0.02 + 0.22 * pow(blade, 2.0);
    float g = smoothstep(top, top - 0.03, y) * step(-0.08, y);
    vec3 grass = uPreset == 1 ? vec3(0.07, 0.085, 0.05) : (uPreset == 2 ? vec3(0.03, 0.05, 0.02) : vec3(0.09, 0.13, 0.04));
    c = mix(c, grass * (0.7 + 0.6 * n1(az * 300.0)), g);
  }
  if (y < -0.08) c = ground;
  else if (y < 0.0) c = mix(c, ground, smoothstep(-0.02, -0.08, y));
  // the sun's glow (the disk itself is the directional light)
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunCol * uGlow * (pow(s, 600.0) * 25.0 + pow(s, 40.0) * 0.6 + pow(s, 6.0) * 0.08);
  gl_FragColor = vec4(c, 1.0);
}`;

const envCache = new Map<string, THREE.Texture>();

/** A preset's PMREM environment (cached per preset and sun direction). */
export function presetEnvironment(renderer: THREE.WebGLRenderer, preset: LightPreset, sunDir: THREE.Vector3): THREE.Texture {
  const key = `${preset}:${sunDir.x.toFixed(2)},${sunDir.y.toFixed(2)},${sunDir.z.toFixed(2)}`;
  const hit = envCache.get(key);
  if (hit) return hit;
  const p = PRESETS[preset];
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: ENV_VS,
    fragmentShader: ENV_FS,
    uniforms: {
      uPreset: { value: preset === 'sunny' ? 0 : preset === 'overcast' ? 1 : 2 },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunCol: { value: new THREE.Color(p.sunColor) },
      uGlow: { value: p.sunGlow },
    },
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 96, 48), mat);
  scene.add(sphere);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0, 0.1, 100, { size: 256 }).texture;
  pmrem.dispose();
  mat.dispose();
  sphere.geometry.dispose();
  envCache.set(key, tex);
  return tex;
}

// ------------------------------------------------------------------ creature materials

/** The current creature lighting: environment, its strength, and how much hemisphere light stays. */
const state = {
  env: null as THREE.Texture | null,
  envIntensity: 1,
  preset: 'sunny' as LightPreset,
};
/** Shared by every creature material (creatureLightPatch). */
export const creatureLightUniforms = {
  uHemiK: { value: 1 },
};
const users = new Set<THREE.MeshStandardMaterial>();

/** Use the creature environment on a material (now and whenever it changes). */
export function useCreatureEnv(m: THREE.MeshStandardMaterial): void {
  users.add(m);
  m.envMap = state.env;
  m.envMapIntensity = state.env ? state.envIntensity : m.envMapIntensity;
}

/** Set the creature lighting (a lab or the game view, when the map or weather changes). */
export function setCreatureLighting(renderer: THREE.WebGLRenderer, preset: LightPreset, sunDir: THREE.Vector3): PresetLight {
  const p = PRESETS[preset];
  state.env = presetEnvironment(renderer, preset, sunDir);
  state.envIntensity = p.env;
  state.preset = preset;
  creatureLightUniforms.uHemiK.value = p.hemiK;
  for (const m of users) {
    const had = !!m.envMap;
    m.envMap = state.env;
    m.envMapIntensity = p.env;
    if (!had) m.needsUpdate = true;
  }
  return p;
}

/** Use any environment for creatures (the nest's warm dim one), with the hemisphere light left as it is. */
export function setCreatureEnvTexture(env: THREE.Texture | null, intensity: number, hemiK = 1): void {
  state.env = env;
  state.envIntensity = intensity;
  creatureLightUniforms.uHemiK.value = hemiK;
  for (const m of users) {
    const had = !!m.envMap;
    m.envMap = env;
    m.envMapIntensity = intensity;
    if (had !== !!env) m.needsUpdate = true;
  }
}

export function creaturePreset(): LightPreset {
  return state.preset;
}

/**
 * Hemisphere (flat ambient) light scaled down on creature materials once they have the environment: works
 * whether or not the dapple patch has already inlined the lights chunk.
 */
export function creatureLightPatch(): ShaderPatch {
  const chunk = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )',
    'UD_HEMI( hemisphereLights[ i ], geometryNormal )',
  );
  return {
    key: 'crlight',
    uniforms: creatureLightUniforms,
    fragmentHeader: 'uniform float uHemiK;\n#define UD_HEMI(l, n) (uHemiK * getHemisphereLightIrradiance(l, n))',
    fragmentOpt: [
      ['#include <lights_fragment_begin>', chunk],
      ['getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )', 'UD_HEMI( hemisphereLights[ i ], geometryNormal )'],
    ],
  };
}
