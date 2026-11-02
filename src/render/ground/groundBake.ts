import * as THREE from 'three';

/**
 * Ground materials, generated procedurally and baked once on the GPU (ground realism, docs/maps/realism.md).
 *
 * Every ground type the maps use is a seamless tile of real ground at its true scale (a tile of loam is 64 mm across,
 * so its crumbs are 1–4 mm and its sand grains under a millimetre — the size an ant sees them). Each is baked into one
 * layer of two texture arrays:
 *   A  RGB albedo (sRGB), A roughness
 *   N  RG tangent normal (0.5 = flat), B height 0..1, A cavity (1 open … 0 deep: the shadow baked into hollows)
 * Colours come from the reference photos sampled in neutral light (docs/maps/realism.md); the patterns are original
 * (the photos are never sampled into a texture). The terrain shader (render/terrainMesh.ts) blends the layers by the
 * map's ground cover, with stochastic tiling so no tile repeats, a wetness layer and the bank faces.
 *
 * Original procedural patterns only. Nothing here touches the simulation.
 */

export const GL = {
  LOAM: 0,
  HUMUS: 1,
  LATERITE: 2,
  MOSS: 3,
  SWARD: 4,
  SAND: 5,
  GRAVEL: 6,
  MUD: 7,
  CLAY: 8,
  BANK_SOIL: 9,
  ROCK: 10,
  TRAIL: 11,
  BANK_SAND: 12,
  BANK_ROOT: 13,
  SAVANNA_SAND: 14,
  DRY_SWARD: 15,
} as const;
export const GL_COUNT = 16;

/** Each layer's tile size (mm) and relief (mm between the lowest and highest baked point: sets the normal strength). */
export const GL_TILE: number[] = [64, 64, 80, 48, 48, 40, 56, 64, 64, 48, 96, 48, 48, 48, 40, 48];
export const GL_RELIEF: number[] = [1.6, 1.4, 1.0, 2.2, 1.6, 0.45, 2.6, 0.5, 0.7, 2.2, 2.0, 0.7, 1.2, 3.0, 0.5, 1.4];

export interface GroundMaps {
  a: THREE.Texture;
  n: THREE.Texture;
  size: number;
}

const VS = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vPx;
uniform vec2 uSize;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vPx = p * uSize;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Pass 1: albedo + roughness (uOut 0) or height (uOut 1) of layer uLayer. */
const FS1 = /* glsl */ `
precision highp float;
in vec2 vPx;
out vec4 outColor;
uniform vec2 uSize;
uniform int uOut;
uniform int uLayer;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h1(float x) { return fract(sin(x * 91.7 + 13.1) * 43758.5453); }

// periodic value noise: n cells per tile (integers → seamless)
float pn(vec2 u, float n, float seed) {
  vec2 q = u * n;
  vec2 i = floor(q); vec2 f = fract(q); f = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, n), i1 = mod(i + 1.0, n);
  float a = h21(i0 + seed * 1.37), b = h21(vec2(i1.x, i0.y) + seed * 1.37);
  float c = h21(vec2(i0.x, i1.y) + seed * 1.37), d = h21(i1 + seed * 1.37);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float pf(vec2 u, float n, int oct, float seed) {
  float s = 0.0, a = 0.5, t = 0.0;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * pn(u, n, seed + float(i) * 7.0); t += a; a *= 0.5; n *= 2.0; }
  return s / t;
}
// periodic Worley: F1, F2 (cell units) and the nearest feature's hash; jitter 0..1
vec4 pw(vec2 u, float n, float seed, float jit) {
  vec2 q = u * n; vec2 i = floor(q);
  float f1 = 9.0, f2 = 9.0, id = 0.0, id2 = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = i + vec2(x, y);
    vec2 m = mod(c, n);
    vec2 o = vec2(h21(m + seed), h21(m + seed + 17.7)) * jit + (1.0 - jit) * 0.5;
    float d = length(c + o - q);
    if (d < f1) { f2 = f1; f1 = d; id2 = id; id = h21(m + seed + 41.3); }
    else if (d < f2) { f2 = d; id2 = h21(m + seed + 41.3); }
  }
  return vec4(f1, f2, id, id2);
}
// a periodic field of short fibres (straw, rootlets): strength 0..1 at u
float fibres(vec2 u, float n, float len, float width, float density, float seed) {
  vec2 q = u * n; vec2 i = floor(q);
  float best = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = i + vec2(x, y);
    vec2 m = mod(c, n);
    if (h21(m + seed + 3.3) > density) continue;
    vec2 p = c + vec2(h21(m + seed), h21(m + seed + 9.1));
    float a = h21(m + seed + 5.5) * 6.2832;
    vec2 d = vec2(cos(a), sin(a));
    vec2 r = q - p;
    float t = clamp(dot(r, d), -len, len);
    // a gentle bend along it
    vec2 off = r - d * t - vec2(-d.y, d.x) * sin(t * 2.0 + h21(m + seed + 1.1) * 6.0) * 0.08;
    float w = width * (1.0 - abs(t) / len * 0.6);
    best = max(best, smoothstep(w, w * 0.3, length(off)));
  }
  return best;
}
vec3 srgb(float r, float g, float b) { return vec3(r, g, b); }

// Every generator returns albedo (sRGB) in rgb, height in a; roughness in gRough.
float gRough;

vec4 loam(vec2 u, bool trail) {
  float hum = pf(u, 5.0, 4, 1.0);
  vec4 cr = pw(u, 22.0, 2.0, 0.9);      // aggregates ~3 mm
  vec4 fg = pw(u, 92.0, 3.0, 1.0);      // grains ~0.7 mm
  vec4 pb = pw(u, 11.0, 4.0, 0.8);      // the odd pebble
  float crumb = smoothstep(0.62, 0.12, cr.x) * (0.55 + 0.45 * cr.z);
  if (trail) crumb *= 0.35;
  float gap = smoothstep(0.06, 0.0, cr.y - cr.x);
  vec3 base = mix(srgb(0.45, 0.35, 0.26), srgb(0.30, 0.235, 0.18), smoothstep(0.42, 0.68, hum));
  if (trail) base = mix(base, srgb(0.49, 0.41, 0.32), 0.55);
  vec3 c = base * (0.86 + 0.24 * cr.z) * (0.9 + 0.2 * crumb);
  c *= 1.0 - gap * 0.35;
  float grain = (fg.z > 0.86 ? 1.0 : 0.0) * smoothstep(0.42, 0.12, fg.x);
  c = mix(c, mix(srgb(0.70, 0.64, 0.55), srgb(0.58, 0.5, 0.42), fg.w), grain * 0.85);
  float peb = (pb.z > 0.93 ? 1.0 : 0.0) * smoothstep(0.30, 0.2, pb.x);
  c = mix(c, mix(srgb(0.55, 0.52, 0.47), srgb(0.62, 0.52, 0.42), pb.w) * (0.8 + 0.3 * pn(u, 160.0, 5.0)), peb);
  float straw = trail ? 0.0 : fibres(u, 9.0, 0.9, 0.035, 0.22, 6.0);
  c = mix(c, srgb(0.66, 0.58, 0.40), straw * 0.75);
  float fine = pn(u, 220.0, 7.0);
  c *= 0.93 + 0.14 * fine;
  gRough = mix(0.93, 0.78, grain + peb * 0.5);
  if (trail) gRough = 0.82;
  float h = crumb * 0.55 + grain * 0.15 + peb * 0.7 + straw * 0.2 + fine * 0.08 + (1.0 - hum) * 0.12;
  return vec4(c, h);
}

vec4 humus(vec2 u) {
  float n = pf(u, 6.0, 4, 11.0);
  vec4 cr = pw(u, 30.0, 12.0, 0.9);
  float crumb = smoothstep(0.6, 0.1, cr.x) * (0.4 + 0.6 * cr.z);
  vec3 c = mix(srgb(0.25, 0.20, 0.155), srgb(0.36, 0.28, 0.21), crumb * 0.8 + n * 0.3);
  float root = fibres(u, 7.0, 1.6, 0.025, 0.45, 13.0);
  c = mix(c, srgb(0.52, 0.42, 0.30), root * 0.7);
  vec4 wb = pw(u, 14.0, 14.0, 1.0);
  float wood = (wb.z > 0.9 ? 1.0 : 0.0) * smoothstep(0.22, 0.12, wb.x);
  c = mix(c, srgb(0.34, 0.20, 0.13), wood);
  float fine = pn(u, 240.0, 15.0);
  c *= 0.9 + 0.2 * fine;
  gRough = 0.95;
  return vec4(c, crumb * 0.6 + root * 0.25 + wood * 0.5 + fine * 0.1 + n * 0.1);
}

vec4 laterite(vec2 u) {
  vec4 pl = pw(u, 6.0, 21.0, 0.85);     // crust plates ~13 mm
  float crack = smoothstep(0.05, 0.0, pl.y - pl.x);
  vec4 cn = pw(u, 40.0, 22.0, 1.0);     // ironstone nodules ~2 mm
  float nod = (cn.z > 0.84 ? 1.0 : 0.0) * smoothstep(0.38, 0.18, cn.x);
  float dust = smoothstep(0.45, 0.7, pf(u, 4.0, 4, 23.0));
  vec3 c = mix(srgb(0.60, 0.385, 0.255), srgb(0.66, 0.47, 0.33), dust) * (0.88 + 0.2 * pl.z);
  c = mix(c, srgb(0.40, 0.21, 0.13), nod);
  c *= 1.0 - crack * 0.4;
  vec4 fg = pw(u, 120.0, 24.0, 1.0);
  float grain = (fg.z > 0.8 ? 1.0 : 0.0) * smoothstep(0.4, 0.15, fg.x);
  c = mix(c, srgb(0.74, 0.58, 0.44), grain * 0.6);
  c *= 0.94 + 0.12 * pn(u, 200.0, 25.0);
  gRough = mix(0.93, 0.7, nod);
  return vec4(c, 0.5 - crack * 0.45 + nod * 0.4 + grain * 0.08 + pl.z * 0.1);
}

vec4 moss(vec2 u) {
  vec4 cu = pw(u, 7.0, 31.0, 0.9);      // cushions ~7 mm
  float dome = 1.0 - smoothstep(0.0, 0.85, cu.x);
  float gap = smoothstep(0.1, 0.0, cu.y - cu.x);
  float leaflets = pn(u, 150.0, 32.0) * 0.6 + pn(u, 300.0, 33.0) * 0.4;
  float dry = smoothstep(0.5, 0.75, pf(u, 3.0, 3, 34.0) * 0.7 + cu.z * 0.3);
  vec3 c = mix(srgb(0.27, 0.35, 0.11), srgb(0.46, 0.47, 0.19), dry);
  c *= 0.62 + 0.38 * dome + 0.3 * (leaflets - 0.5);
  c = mix(c, srgb(0.10, 0.11, 0.05), gap * 0.7);
  vec4 sp = pw(u, 26.0, 35.0, 1.0);
  float cap = (sp.z > 0.965 ? 1.0 : 0.0) * smoothstep(0.2, 0.08, sp.x);
  c = mix(c, srgb(0.45, 0.22, 0.12), cap);
  gRough = 0.82 - 0.1 * leaflets;
  return vec4(c, dome * 0.6 + leaflets * 0.3 - gap * 0.3 + cap * 0.3 + 0.2);
}

vec4 sward(vec2 u, bool dry) {
  // the ground under the grass: soil, a thatch of fallen blades and the odd clover leaflet (living, low contrast)
  vec4 base = loam(u * 1.0, false);
  vec3 c = base.rgb * 0.95;
  float h = base.a * 0.4;
  float thatchD = fibres(u, 16.0, 1.2, 0.05, 0.55, 41.0);
  float thatchG = fibres(u + 0.37, 13.0, 1.0, 0.055, 0.45, 42.0);
  vec3 dryCol = mix(srgb(0.60, 0.53, 0.36), srgb(0.48, 0.42, 0.28), pn(u, 40.0, 43.0));
  vec3 greenCol = dry ? srgb(0.52, 0.48, 0.28) : mix(srgb(0.28, 0.38, 0.13), srgb(0.36, 0.44, 0.17), pn(u, 30.0, 44.0));
  c = mix(c, dryCol, thatchD * 0.85);
  c = mix(c, greenCol, thatchG * 0.9);
  h += thatchD * 0.5 + thatchG * 0.6;
  if (!dry) {
    vec4 cl = pw(u, 9.0, 45.0, 0.9);
    if (cl.z > 0.7) {
      vec2 q = u * 9.0;
      vec2 ce = floor(q) + 0.5;
      float a = atan(q.y - ce.y, q.x - ce.x);
      float r = length(q - ce);
      float tre = 0.18 + 0.06 * cos(a * 3.0 + cl.w * 6.0);
      float leaf = smoothstep(tre, tre - 0.03, r) * smoothstep(0.0, 0.04, r);
      c = mix(c, srgb(0.25, 0.37, 0.12) * (0.9 + 0.2 * cl.w), leaf * 0.8);
      h += leaf * 0.5;
    }
  }
  gRough = 0.86;
  return vec4(c, h);
}

vec4 sand(vec2 u, bool savanna) {
  vec4 g = pw(u, 128.0, 51.0, 1.0);    // grains ~0.3 mm
  vec4 g2 = pw(u, 64.0, 52.0, 1.0);
  float grain = smoothstep(0.62, 0.05, g.x);
  float pick = g.z;
  vec3 c = savanna ? srgb(0.74, 0.60, 0.45) : srgb(0.70, 0.63, 0.50);
  if (pick > 0.9) c = srgb(0.27, 0.25, 0.22);
  else if (pick > 0.78) c = savanna ? srgb(0.70, 0.46, 0.32) : srgb(0.72, 0.58, 0.50);
  else if (pick > 0.55) c = savanna ? srgb(0.82, 0.70, 0.55) : srgb(0.80, 0.75, 0.64);
  c = mix(c * 0.72, c, grain);
  float big = (g2.z > 0.93 ? 1.0 : 0.0) * smoothstep(0.35, 0.15, g2.x);
  c = mix(c, srgb(0.56, 0.52, 0.47), big);
  float warp = pf(u, 3.0, 3, 53.0);
  float rip = sin((u.y * 3.0 + warp * 1.6) * 6.2832) * 0.5 + 0.5;
  c *= 0.93 + 0.1 * rip;
  gRough = (g.w > 0.97 && !savanna) ? 0.35 : 0.92;
  return vec4(c, grain * 0.35 + big * 0.4 + rip * 0.35 + pf(u, 8.0, 3, 54.0) * 0.15);
}

vec4 gravel(vec2 u) {
  vec4 sm = sand(u * 1.0, false);
  vec4 p1 = pw(u, 9.0, 61.0, 0.85);
  vec4 p2 = pw(u, 21.0, 62.0, 0.9);
  float s1 = (p1.z > 0.25 ? 1.0 : 0.0) * smoothstep(0.62, 0.42, p1.x);
  float s2 = (p2.z > 0.45 ? 1.0 : 0.0) * smoothstep(0.55, 0.36, p2.x) * (1.0 - s1);
  float dome1 = sqrt(max(0.0, 1.0 - p1.x * p1.x / 0.38)) * s1;
  float dome2 = sqrt(max(0.0, 1.0 - p2.x * p2.x / 0.3)) * s2;
  vec3 pc1 = mix(mix(srgb(0.55, 0.53, 0.50), srgb(0.66, 0.58, 0.47), p1.w), srgb(0.38, 0.36, 0.34), step(0.8, p1.z) * 0.8);
  vec3 pc2 = mix(srgb(0.62, 0.56, 0.48), srgb(0.48, 0.40, 0.34), p2.w);
  float speck = pn(u, 260.0, 63.0);
  vec3 c = sm.rgb * 0.8;
  c = mix(c, pc1 * (0.85 + 0.25 * dome1) * (0.92 + 0.16 * speck), s1);
  c = mix(c, pc2 * (0.85 + 0.25 * dome2), s2);
  c *= 1.0 - 0.35 * smoothstep(0.6, 0.66, p1.x) * (1.0 - s1) * step(0.25, p1.z);
  gRough = mix(0.92, 0.62 + 0.15 * p1.w, max(s1, s2));
  return vec4(c, max(dome1 * 0.9, dome2 * 0.55) + sm.a * 0.1);
}

vec4 mud(vec2 u) {
  float und = pf(u, 3.0, 4, 71.0);
  vec4 pit = pw(u, 46.0, 72.0, 1.0);
  float pits = (pit.z > 0.7 ? 1.0 : 0.0) * smoothstep(0.3, 0.12, pit.x);
  vec4 ck = pw(u, 4.0, 73.0, 0.9);
  float crack = smoothstep(0.035, 0.0, ck.y - ck.x) * smoothstep(0.55, 0.75, pf(u, 2.0, 2, 74.0));
  vec3 c = mix(srgb(0.29, 0.24, 0.19), srgb(0.38, 0.31, 0.24), und) * (1.0 - pits * 0.35) * (1.0 - crack * 0.35);
  vec4 g = pw(u, 110.0, 75.0, 1.0);
  float grain = (g.z > 0.9 ? 1.0 : 0.0) * smoothstep(0.35, 0.1, g.x);
  c = mix(c, srgb(0.55, 0.5, 0.42), grain * 0.5);
  gRough = 0.32 + 0.25 * smoothstep(0.4, 0.7, pf(u, 5.0, 3, 76.0)) + pits * 0.2;
  return vec4(c, und * 0.6 - pits * 0.35 - crack * 0.4 + grain * 0.1);
}

vec4 clay(vec2 u, bool face) {
  float lam = sin((u.y * 22.0 + pf(u, 4.0, 3, 81.0) * 2.5) * 6.2832) * 0.5 + 0.5;
  float mot = pf(u, 6.0, 4, 82.0);
  vec3 c = srgb(0.48, 0.33, 0.25);
  c = mix(c, srgb(0.62, 0.40, 0.22), smoothstep(0.58, 0.75, mot) * 0.7);
  c = mix(c, srgb(0.50, 0.48, 0.43), smoothstep(0.35, 0.2, mot) * 0.6);
  c *= 0.9 + 0.12 * lam * (face ? 1.0 : 0.4);
  vec4 ck = pw(u, 5.0, 83.0, 0.9);
  float crack = smoothstep(0.03, 0.0, ck.y - ck.x);
  c *= 1.0 - crack * 0.45;
  c *= 0.95 + 0.1 * pn(u, 180.0, 84.0);
  gRough = 0.72 + 0.12 * mot;
  return vec4(c, 0.4 + lam * 0.15 * (face ? 1.0 : 0.3) - crack * 0.5 + mot * 0.15);
}

// bank faces: u across the face (around), v up it (tile repeats every GL_TILE mm vertically)
vec4 bankSoil(vec2 u) {
  // strata: a dark topsoil band near the top of every repeat is not right (repeats); bands vary with height instead
  float band = pf(vec2(0.0, u.y) + vec2(pf(u, 2.0, 2, 91.0) * 0.08, 0.0), 6.0, 4, 92.0);
  vec3 c = mix(srgb(0.36, 0.27, 0.20), srgb(0.52, 0.40, 0.29), smoothstep(0.3, 0.7, band));
  c = mix(c, srgb(0.56, 0.38, 0.24), smoothstep(0.72, 0.85, band) * 0.6);
  // crumbly face: lumps, each lit from above (darker underneath)
  vec4 cr = pw(u * vec2(1.0, 1.0), 16.0, 93.0, 0.9);
  float lump = smoothstep(0.7, 0.15, cr.x);
  c *= 0.84 + 0.26 * lump * (0.6 + 0.4 * cr.z);
  float ledge = smoothstep(0.08, 0.0, abs(fract(u.y * 7.0 + pf(u, 5.0, 2, 94.0) * 0.6) - 0.5) - 0.42);
  c *= 1.0 - ledge * 0.25;
  // pebbles stuck in the face, a shadow under each
  vec4 pb = pw(u, 10.0, 95.0, 0.8);
  float peb = (pb.z > 0.86 ? 1.0 : 0.0) * smoothstep(0.28, 0.18, pb.x);
  vec3 pcol = mix(srgb(0.56, 0.54, 0.50), srgb(0.66, 0.56, 0.44), pb.w);
  c = mix(c, pcol, peb);
  // rootlets hanging down the face
  float root = fibres(u * vec2(1.0, 0.35), 8.0, 1.8, 0.03, 0.35, 96.0);
  c = mix(c, srgb(0.58, 0.47, 0.34), root * 0.7);
  // burrows
  vec4 bu = pw(u, 5.0, 97.0, 0.8);
  float hole = (bu.z > 0.88 ? 1.0 : 0.0) * smoothstep(0.16, 0.1, length((u * 5.0 - floor(u * 5.0) - 0.5) * vec2(1.0, 1.6)));
  c *= 1.0 - hole * 0.75;
  c *= 0.93 + 0.14 * pn(u, 200.0, 98.0);
  gRough = 0.95;
  return vec4(c, lump * 0.5 + peb * 0.8 + root * 0.3 - hole * 0.6 - ledge * 0.2 + 0.2);
}

vec4 rock(vec2 u) {
  float bed = sin((u.y * 9.0 + pf(u, 3.0, 3, 101.0) * 1.8) * 6.2832) * 0.5 + 0.5;
  float n = pf(u, 5.0, 5, 102.0);
  vec3 c = mix(srgb(0.47, 0.45, 0.41), srgb(0.62, 0.59, 0.53), n) * (0.9 + 0.1 * bed);
  vec4 ck = pw(u, 4.0, 103.0, 0.9);
  float crack = smoothstep(0.03, 0.0, ck.y - ck.x);
  c *= 1.0 - crack * 0.55;
  float streak = smoothstep(0.6, 0.85, pf(u * vec2(1.0, 0.15), 8.0, 3, 104.0));
  c *= 1.0 - streak * 0.25;
  float lich = smoothstep(0.66, 0.7, pf(u, 6.0, 4, 105.0));
  c = mix(c, srgb(0.66, 0.69, 0.58), lich * 0.75);
  float lich2 = smoothstep(0.78, 0.8, pf(u + 0.3, 9.0, 3, 106.0));
  c = mix(c, srgb(0.74, 0.52, 0.24), lich2 * 0.6);
  c *= 0.94 + 0.12 * pn(u, 220.0, 107.0);
  gRough = 0.86 - lich * 0.05;
  return vec4(c, n * 0.6 + bed * 0.15 - crack * 0.6 + lich * 0.1);
}

vec4 bankSand(vec2 u) {
  vec4 s = sand(u, false);
  float lam = sin((u.y * 16.0 + pf(u, 3.0, 3, 111.0) * 2.0) * 6.2832) * 0.5 + 0.5;
  vec3 c = s.rgb * (0.86 + 0.18 * lam);
  float slump = smoothstep(0.55, 0.8, pf(u * vec2(1.0, 0.4), 5.0, 3, 112.0));
  c *= 1.0 - slump * 0.12;
  gRough = 0.93;
  return vec4(c, s.a * 0.5 + lam * 0.3 + slump * 0.3);
}

vec4 bankRoot(vec2 u) {
  vec4 so = bankSoil(u);
  vec3 c = so.rgb;
  float h = so.a * 0.4;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float y0 = h1(fk * 3.1 + 1.0);
    float w = 0.035 + 0.04 * h1(fk * 5.3 + 2.0);
    float y = y0 + 0.06 * sin(u.x * 6.2832 * (1.0 + floor(h1(fk + 9.0) * 2.0)) + fk) + 0.02 * sin(u.x * 6.2832 * 3.0 + fk * 2.0);
    float d = abs(fract(u.y - y + 0.5) - 0.5);
    float r = smoothstep(w, w * 0.6, d);
    float round_ = sqrt(max(0.0, 1.0 - (d / w) * (d / w)));
    vec3 bark = mix(srgb(0.40, 0.29, 0.20), srgb(0.30, 0.22, 0.16), pn(u * vec2(1.0, 4.0), 30.0, 120.0 + fk));
    bark *= 0.8 + 0.3 * round_;
    c = mix(c, bark, r);
    h = max(h, r * (0.6 + 0.4 * round_));
  }
  gRough = 0.9;
  return vec4(c, h);
}

void main() {
  vec2 u = vPx / uSize;
  vec4 g;
  if (uLayer == 0) g = loam(u, false);
  else if (uLayer == 1) g = humus(u);
  else if (uLayer == 2) g = laterite(u);
  else if (uLayer == 3) g = moss(u);
  else if (uLayer == 4) g = sward(u, false);
  else if (uLayer == 5) g = sand(u, false);
  else if (uLayer == 6) g = gravel(u);
  else if (uLayer == 7) g = mud(u);
  else if (uLayer == 8) g = clay(u, true);
  else if (uLayer == 9) g = bankSoil(u);
  else if (uLayer == 10) g = rock(u);
  else if (uLayer == 11) g = loam(u, true);
  else if (uLayer == 12) g = bankSand(u);
  else if (uLayer == 13) g = bankRoot(u);
  else if (uLayer == 14) g = sand(u, true);
  else g = sward(u, true);
  if (uOut == 0) outColor = vec4(clamp(g.rgb, 0.0, 1.0), clamp(gRough, 0.05, 1.0));
  else outColor = vec4(clamp(g.a, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

/** Pass 2: normal and cavity from the baked height (layer uLayer of tH). */
const FS2 = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
in vec2 vPx;
out vec4 outColor;
uniform vec2 uSize;
uniform int uLayer;
uniform float uStrength;
uniform sampler2DArray tH;
float H(ivec2 p) {
  ivec2 s = ivec2(uSize);
  p = (p % s + s) % s;
  return texelFetch(tH, ivec3(p, uLayer), 0).r;
}
void main() {
  ivec2 p = ivec2(vPx);
  float hl = H(p - ivec2(1, 0)), hr = H(p + ivec2(1, 0)), hd = H(p - ivec2(0, 1)), hu = H(p + ivec2(0, 1));
  vec3 n = normalize(vec3((hl - hr) * uStrength, (hd - hu) * uStrength, 1.0));
  float h0 = H(p);
  float avg = 0.0;
  for (int k = 0; k < 12; k++) {
    float a = float(k) * 0.5236;
    float r = k % 2 == 0 ? 3.0 : 6.0;
    avg += H(p + ivec2(round(cos(a) * r), round(sin(a) * r)));
  }
  avg /= 12.0;
  float cav = clamp(1.0 - max(0.0, avg - h0) * 2.4, 0.0, 1.0);
  outColor = vec4(n.xy * 0.5 + 0.5, h0, cav);
}`;

let cached: GroundMaps | null = null;

/** Bake the ground layers (once per renderer; `size` 512 on high quality, 256 on low). */
export function bakeGround(r: THREE.WebGLRenderer, size = 512): GroundMaps {
  if (cached && cached.size === size) return cached;
  const opts = (mips: boolean): THREE.RenderTargetOptions => ({
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    generateMipmaps: mips,
    minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter,
    magFilter: mips ? THREE.LinearFilter : THREE.NearestFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
    colorSpace: THREE.NoColorSpace,
  });
  const A = new THREE.WebGLArrayRenderTarget(size, size, GL_COUNT, opts(true));
  const Hh = new THREE.WebGLArrayRenderTarget(size, size, GL_COUNT, opts(false));
  const N = new THREE.WebGLArrayRenderTarget(size, size, GL_COUNT, opts(true));
  const u1 = { uSize: { value: new THREE.Vector2(size, size) }, uOut: { value: 0 }, uLayer: { value: 0 } };
  const m1 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS1, uniforms: u1, depthTest: false, depthWrite: false });
  const u2 = { uSize: u1.uSize, uLayer: { value: 0 }, uStrength: { value: 1 }, tH: { value: Hh.texture } };
  const m2 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS2, uniforms: u2, depthTest: false, depthWrite: false });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const tri = new THREE.Mesh(geo, m1);
  tri.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(tri);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = r.getRenderTarget();
  const prevAuto = r.autoClear;
  r.autoClear = true;
  for (let L = 0; L < GL_COUNT; L++) {
    u1.uLayer.value = L;
    u1.uOut.value = 0;
    r.setRenderTarget(A, L);
    r.render(scene, cam);
    u1.uOut.value = 1;
    r.setRenderTarget(Hh, L);
    r.render(scene, cam);
  }
  tri.material = m2;
  for (let L = 0; L < GL_COUNT; L++) {
    u2.uLayer.value = L;
    // normal strength: relief (mm) over one texel (mm)
    u2.uStrength.value = GL_RELIEF[L] / (GL_TILE[L] / size);
    r.setRenderTarget(N, L);
    r.render(scene, cam);
  }
  r.setRenderTarget(prev);
  r.autoClear = prevAuto;
  m1.dispose();
  m2.dispose();
  geo.dispose();
  Hh.dispose();
  const aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
  A.texture.anisotropy = N.texture.anisotropy = aniso;
  cached = { a: A.texture, n: N.texture, size };
  return cached;
}

/** The baked maps, if baked. */
export function groundMaps(): GroundMaps | null {
  return cached;
}
