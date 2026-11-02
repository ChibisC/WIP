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

/**
 * Each layer's tile size (mm) and relief (mm: the height that maps to 1.0 in the baked height; the generators work in
 * real millimetres, so a 1 mm crumb is 1 mm tall whatever the tile).
 */
export const GL_TILE: number[] = [64, 64, 80, 48, 56, 40, 64, 64, 64, 56, 96, 56, 48, 64, 40, 56];
export const GL_RELIEF: number[] = [3.0, 2.6, 1.6, 3.2, 2.8, 0.9, 4.5, 1.0, 1.2, 3.2, 3.5, 1.6, 1.4, 4.5, 0.9, 2.8];

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

/**
 * Pass 1: albedo + roughness (uOut 0) or height (uOut 1) of layer uLayer.
 *
 * The building block is `scatter`: a union of lumpy, rotated, flattened ellipsoid caps (crumbs, clods, grains,
 * pebbles) on a periodic jittered grid, several per cell and overlapping, so the ground is a pile of particles of many
 * sizes — not cells. Each particle keeps its own colour (picked from the layer's measured range by its id) and the low
 * ground between particles is the darker matrix. Every generator returns albedo (sRGB) and height in mm; roughness goes
 * in gRough.
 */
const FS1 = /* glsl */ `
precision highp float;
in vec2 vPx;
out vec4 outColor;
uniform vec2 uSize;
uniform int uOut;
uniform int uLayer;
uniform float uTileMm;
uniform float uRelief;

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
// periodic Worley: F1, F2 (cell units) and the nearest feature's hash
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
// a warp (tile units) so lines and outlines wander
vec2 warp(vec2 u, float n, float amt, float seed) {
  return u + (vec2(pf(u, n, 3, seed), pf(u + 0.37, n, 3, seed + 3.0)) - 0.5) * amt;
}

// ---- particles
struct Pt { float h; float id; float d; float r; };
// u tile coords; n cells per tile; per particles per cell (≤3); dens chance each exists; radii in cell units;
// aspMin the flattest outline; lump outline wobble; flat height/radius. Height returned in mm.
Pt scatter(vec2 u, float n, int per, float dens, float rmin, float rmax, float aspMin, float lump, float flt, float seed) {
  vec2 q = u * n; vec2 i = floor(q);
  Pt b; b.h = 0.0; b.id = 0.0; b.d = 9.0; b.r = 0.0;
  float best = -1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = i + vec2(x, y); vec2 m = mod(c, n);
    for (int k = 0; k < 3; k++) {
      if (k >= per) break;
      float s = seed + float(k) * 19.19;
      if (h21(m + s + 3.3) > dens) continue;
      vec2 p = c + vec2(h21(m + s), h21(m + s + 9.1));
      float r = mix(rmin, rmax, pow(h21(m + s + 4.4), 1.6));
      float a = h21(m + s + 5.5) * 6.2832;
      float asp = mix(aspMin, 1.0, h21(m + s + 6.6));
      vec2 d = q - p;
      d = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
      d.y /= asp;
      float ang = atan(d.y, d.x);
      float ph = h21(m + s + 7.7) * 6.2832;
      float wob = sin(ang * 2.0 + ph) * 0.45 + sin(ang * 3.0 + ph * 1.7) * 0.35 + sin(ang * 5.0 + ph * 2.3) * 0.2;
      float dist = length(d) / r * (1.0 + lump * wob);
      if (dist >= 1.0) continue;
      float h = r * flt * pow(1.0 - dist * dist, 0.6) * (0.75 + 0.5 * h21(m + s + 2.2));
      if (h > best) { best = h; b.id = h21(m + s + 41.3); b.d = dist; b.r = r; }
    }
  }
  b.h = max(best, 0.0) * uTileMm / n;
  return b;
}

// a periodic field of short fibres (straw, rootlets, thatch): strength 0..1 at u; out the fibre's hash and its
// position along (−1..1) in gFib
vec2 gFib;
float gFibS;
float gFibSharp = 0.35;
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
    float L = len * (0.6 + 0.4 * h21(m + seed + 8.8));
    float t = clamp(dot(r, d), -L, L);
    vec2 off = r - d * t - vec2(-d.y, d.x) * sin(t * 1.7 + h21(m + seed + 1.1) * 6.0) * 0.12 * L;
    float w = width * (1.0 - abs(t) / L * 0.5) * (0.7 + 0.6 * h21(m + seed + 2.7));
    float v = smoothstep(w, w * gFibSharp, length(off));
    if (v > best) { best = v; gFib = vec2(h21(m + seed + 6.1), t / L); gFibS = clamp(dot(off, vec2(-d.y, d.x)) / w, -1.0, 1.0); }
  }
  return best;
}

float gRough;

// ------------------------------------------------------------------ the layers (sRGB albedo in rgb, height mm in a)

// loam: a pile of crumbs and clods of many sizes over a darker, finer matrix; drier crumbs lighter, the odd quartz
// grain, a rare pebble, a few bits of straw and rootlet (user photos: moist loam (85, 71, 60), crumbs to (122, 104, 89))
vec4 loam(vec2 u, bool trail) {
  float moist = pf(u, 3.0, 4, 1.0);                     // damper and drier patches ~20 mm
  float tone = pf(u, 5.0, 3, 2.0);
  vec3 matrix = mix(vec3(0.26, 0.20, 0.15), vec3(0.20, 0.15, 0.11), smoothstep(0.35, 0.7, moist));
  float hm = pf(u, 40.0, 3, 3.0) * 0.25;
  Pt cl = scatter(u, 6.0, 1, trail ? 0.25 : 0.42, 0.25, 0.55, 0.5, 0.5, 0.58, 11.0);   // clods 3–7 mm
  Pt cr = scatter(u, 18.0, 2, 0.75, 0.22, 0.55, 0.5, 0.4, 0.55, 12.0);                   // crumbs 1–3 mm
  Pt fn = scatter(u, 56.0, 2, 0.7, 0.2, 0.5, 0.6, 0.3, 0.6, 13.0);                       // fine 0.2–0.5 mm
  float h = hm;
  vec3 c = matrix * (0.85 + 0.3 * pn(u, 120.0, 4.0));
  float hc = cl.h + 0.15, hr = cr.h + 0.08, hf = fn.h;
  // dry crumbs are paler (they dry first); colour per particle from the photo range
  vec3 dry = vec3(0.48, 0.40, 0.31), damp = vec3(0.31, 0.24, 0.18);
  if (hf > h) { h = hf; c = mix(damp, dry, fn.id * 0.7) * (0.8 + 0.3 * tone); }
  if (hr > h) { h = hr; c = mix(damp, dry, smoothstep(0.2, 0.9, cr.id + (0.5 - moist) * 0.6)) * (0.85 + 0.25 * tone); }
  if (hc > h) {
    // a clod is itself made of crumbs: its skin follows the crumbs and fines on it, darker in its creases
    float sub = max(cr.h, fn.h * 1.3);
    h = hc + sub * 0.45;
    c = mix(damp * 0.95, dry * 1.03, smoothstep(0.15, 0.95, cl.id + (0.5 - moist) * 0.7));
    c *= (0.78 + 0.3 * smoothstep(0.0, 0.5, sub)) * (0.9 + 0.2 * pn(u, 90.0, 5.0));
  }
  // the particles' own rough skin (no smooth pebble-like tops)
  h += ((pn(u, 90.0, 7.0) - 0.5) * 0.2 + (pn(u, 190.0, 8.0) - 0.5) * 0.12) * smoothstep(0.1, 0.5, h);
  gRough = 0.93;
  // quartz and feldspar grains (pale, a little glossy), rare
  Pt gr = scatter(u, 60.0, 1, 0.07, 0.25, 0.45, 0.6, 0.2, 0.8, 14.0);
  if (gr.h > 0.0 && gr.h + 0.05 > h) { h = gr.h + 0.05; c = mix(vec3(0.66, 0.62, 0.56), vec3(0.70, 0.58, 0.48), gr.id); gRough = 0.55; }
  // a rare pebble
  Pt pb = scatter(u, 4.0, 1, trail ? 0.05 : 0.08, 0.16, 0.28, 0.6, 0.15, 0.5, 15.0);
  if (pb.h > 0.0 && pb.h > h - 0.4) {
    h = max(h, pb.h + 0.2);
    c = mix(vec3(0.44, 0.41, 0.37), vec3(0.52, 0.43, 0.34), pb.id) * (0.8 + 0.3 * pn(u, 200.0, 6.0));
    gRough = 0.66;
  }
  // straw and rootlets
  float st = trail ? 0.0 : fibres(u, 6.0, 0.7, 0.025, 0.18, 16.0);
  if (st > 0.3) { c = mix(c, mix(vec3(0.58, 0.50, 0.36), vec3(0.45, 0.38, 0.28), gFib.x), st * 0.85); h = max(h, 0.5 + st * 0.35); }
  float rl = fibres(u, 9.0, 1.1, 0.012, 0.22, 17.0);
  if (rl > 0.3) { c = mix(c, vec3(0.62, 0.55, 0.45), rl * 0.6); h = max(h, h * 0.6 + rl * 0.3); }
  if (trail) {
    // compacted by traffic: tops crushed flat and paler, the fines packed into the gaps, a polish
    float cap = 0.55 + 0.25 * pf(u, 8.0, 2, 18.0);
    float crushed = smoothstep(cap - 0.2, cap, h);
    h = min(h, cap) * 0.7 + hm;
    c = mix(c, vec3(0.47, 0.39, 0.30) * (0.9 + 0.2 * tone), 0.45 + 0.3 * crushed);
    c = mix(c, vec3(0.40, 0.33, 0.25), 0.25 * (1.0 - smoothstep(0.1, 0.4, h)));
    gRough = 0.82;
  }
  return vec4(c, h);
}

// forest humus: dark crumbly granules (worm casts), black voids, pale rootlets and white fungal threads, the odd
// reddish wood fragment (photo: humus (57, 45, 42), p90 (75, 58, 55))
vec4 humus(vec2 u) {
  float tone = pf(u, 4.0, 3, 21.0);
  vec3 c = vec3(0.15, 0.115, 0.09);
  float h = pf(u, 30.0, 3, 22.0) * 0.2;
  Pt cr = scatter(u, 14.0, 2, 0.8, 0.25, 0.6, 0.55, 0.45, 0.5, 23.0);   // granules 1.5–5 mm
  Pt fn = scatter(u, 44.0, 2, 0.75, 0.2, 0.5, 0.6, 0.35, 0.6, 24.0);
  if (fn.h > h) { h = fn.h; c = mix(vec3(0.20, 0.155, 0.12), vec3(0.30, 0.235, 0.18), fn.id); }
  if (cr.h + 0.1 > h) { h = cr.h + 0.1; c = mix(vec3(0.22, 0.17, 0.13), vec3(0.36, 0.28, 0.21), smoothstep(0.1, 0.95, cr.id)) * (0.85 + 0.3 * tone); }
  c *= 0.9 + 0.2 * pn(u, 160.0, 25.0);
  // woody fragments: slivers
  Pt wd = scatter(u, 7.0, 1, 0.16, 0.16, 0.36, 0.14, 0.1, 0.22, 26.0);
  if (wd.h > 0.0 && wd.h + 0.3 > h) { h = wd.h + 0.3; c = mix(vec3(0.28, 0.19, 0.13), vec3(0.38, 0.29, 0.21), wd.id) * (0.8 + 0.3 * pn(u * vec2(1.0, 6.0), 40.0, 27.0)); }
  float rl = fibres(u, 6.0, 1.3, 0.016, 0.4, 28.0);
  if (rl > 0.2) { c = mix(c, vec3(0.55, 0.44, 0.32), rl * 0.75); h = max(h, h * 0.5 + 0.6 * rl); }
  float hy = fibres(u, 14.0, 0.9, 0.006, 0.25, 29.0);
  c = mix(c, vec3(0.70, 0.68, 0.62), hy * 0.5);
  gRough = 0.95;
  return vec4(c, h);
}

// red laterite: an iron-red crust, low and lumpy, hairline cracks that come and go, loose grit, dark ironstone nodules,
// pale dust in the low spots (photo: (166, 114, 82), p10 (128, 78, 47), p90 (194, 140, 106))
vec4 laterite(vec2 u) {
  vec2 w = warp(u, 4.0, 0.06, 31.0);
  vec4 pl = pw(w, 5.0, 32.0, 0.9);
  float crackOn = smoothstep(0.45, 0.62, pf(u, 3.0, 2, 33.0));
  float crack = smoothstep(0.045, 0.0, pl.y - pl.x) * crackOn;
  float crust = pf(u, 12.0, 4, 34.0);
  vec3 c = mix(vec3(0.56, 0.36, 0.24), vec3(0.66, 0.46, 0.32), smoothstep(0.3, 0.75, crust)) * (0.92 + 0.15 * pl.z);
  float h = crust * 0.6 - crack * 0.5;
  Pt gr = scatter(u, 40.0, 2, 0.45, 0.2, 0.5, 0.55, 0.35, 0.6, 35.0);  // grit 0.4–1 mm
  if (gr.h + 0.15 > h) { h = gr.h + 0.15; c = mix(vec3(0.58, 0.38, 0.25), vec3(0.72, 0.53, 0.38), gr.id); }
  Pt nd = scatter(u, 12.0, 1, 0.22, 0.2, 0.42, 0.7, 0.25, 0.7, 36.0);  // ironstone nodules 1.3–2.8 mm
  gRough = 0.92;
  if (nd.h > 0.0 && nd.h + 0.2 > h) { h = nd.h + 0.2; c = mix(vec3(0.30, 0.18, 0.12), vec3(0.40, 0.25, 0.17), nd.id) * (0.85 + 0.3 * pn(u, 220.0, 37.0)); gRough = 0.62; }
  float dust = smoothstep(0.25, 0.0, h) * smoothstep(0.4, 0.7, pf(u, 6.0, 3, 38.0));
  c = mix(c, vec3(0.74, 0.58, 0.44), dust * 0.6);
  c *= 1.0 - crack * 0.45;
  c *= 0.94 + 0.12 * pn(u, 240.0, 39.0);
  return vec4(c, h);
}

// moss: a carpet of tiny shoots over soft cushions; cushion tops brighter, deep gaps between, some dead brown shoots,
// the odd spore capsule
vec4 moss(vec2 u) {
  vec2 w = warp(u, 3.0, 0.12, 41.0);
  float cush = pf(w, 5.0, 4, 42.0);                     // cushion field (no cells)
  float dome = smoothstep(0.32, 0.72, cush);
  float h = dome * 2.0;
  // shoots: small elongated leaflets, densely packed, tips lighter
  Pt sh = scatter(u, 80.0, 3, 0.95, 0.35, 0.7, 0.3, 0.1, 0.7, 43.0);
  Pt sh2 = scatter(u + 0.013, 46.0, 2, 0.8, 0.3, 0.6, 0.25, 0.1, 0.8, 44.0);
  float leaf = max(sh.h, sh2.h * 1.2);
  h += leaf * (0.4 + 0.6 * dome);
  float dead = smoothstep(0.58, 0.75, pf(u, 4.0, 3, 45.0) + (1.0 - dome) * 0.25);
  vec3 green = mix(vec3(0.22, 0.30, 0.08), vec3(0.42, 0.47, 0.15), smoothstep(0.0, 1.0, sh.id * 0.6 + dome * 0.5));
  vec3 brown = mix(vec3(0.30, 0.24, 0.12), vec3(0.42, 0.35, 0.18), sh.id);
  vec3 c = mix(green, brown, dead * 0.85);
  // tips catch the light: lighter toward the leaflet's top
  float tip = 1.0 - (sh.h > sh2.h ? sh.d : sh2.d);
  c *= 0.7 + 0.45 * tip;
  // deep gaps between cushions: dark, bare soil
  float gap = 1.0 - smoothstep(0.18, 0.4, cush);
  c = mix(c, vec3(0.10, 0.09, 0.05), gap * 0.75);
  h *= 1.0 - gap * 0.6;
  // spore capsules on short setae (red-brown dots)
  Pt cp = scatter(u, 10.0, 1, 0.12, 0.08, 0.13, 0.6, 0.1, 1.2, 46.0);
  if (cp.h > 0.0) { c = mix(vec3(0.42, 0.18, 0.08), vec3(0.55, 0.30, 0.12), cp.id); h = max(h, 2.6 + cp.h); }
  gRough = 0.8 - 0.1 * tip;
  return vec4(c, h);
}

// the ground under a meadow's grass: loam showing through a thatch of fallen blades (flat, 1.5–3 mm wide, 15–35 mm
// long; pale straw to weathered grey-brown, veined along), green blade bases, the odd clover leaf
vec4 sward(vec2 u, bool dry) {
  vec4 base = loam(u, false);
  vec3 c = base.rgb * 0.88;
  float h = base.a * 0.55;
  gFibSharp = 0.8;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float n = 3.0 + fk;
    float th = fibres(u + fk * 0.31, n, 1.0, dry ? 0.045 + fk * 0.008 : 0.055 + fk * 0.01, dry ? 0.5 : 0.55, 51.0 + fk * 3.0);
    if (th < 0.2) continue;
    float lv = 1.0 + fk * 0.5;
    float id = gFib.x;
    vec3 straw = mix(vec3(0.62, 0.55, 0.40), vec3(0.42, 0.39, 0.33), id) * (0.85 + 0.2 * pn(u, 9.0, 57.0 + fk));
    if (dry) straw = mix(vec3(0.72, 0.62, 0.44), vec3(0.58, 0.50, 0.36), id);
    vec3 green = mix(vec3(0.36, 0.42, 0.20), vec3(0.46, 0.49, 0.27), id);
    vec3 bc = (!dry && id > 0.82) ? green : straw;
    // veins along the blade, its edges curled down a little (darker), weathered spots
    float vein = 0.5 + 0.5 * sin(gFibS * 9.0);
    bc *= (0.86 + 0.1 * vein) * (0.8 + 0.2 * (1.0 - gFibS * gFibS));
    bc *= 1.0 - 0.22 * smoothstep(0.62, 0.9, pn(u, 24.0, 52.0 + fk));
    float m = smoothstep(0.2, 0.55, th);
    c = mix(c * (1.0 - 0.25 * m), bc, m);
    h = max(h, lv + th * 0.4);
  }
  gFibSharp = 0.35;
  if (!dry) {
    // a clover leaf (three rounded leaflets ~4 mm), rare
    vec4 cl = pw(u, 3.0, 55.0, 0.8);
    if (cl.z > 0.8) {
      vec2 q = u * 3.0;
      vec2 ce = floor(q) + 0.5 + (vec2(h21(mod(floor(q), 3.0) + 1.3), h21(mod(floor(q), 3.0) + 2.3)) - 0.5) * 0.3;
      float a = atan(q.y - ce.y, q.x - ce.x) + cl.w * 6.28;
      float r = length(q - ce);
      float lobe = abs(cos(a * 1.5));
      float tre = 0.21 * (0.62 + 0.38 * pow(lobe, 0.5));
      float leaf = smoothstep(tre, tre - 0.015, r);
      float midrib = smoothstep(0.03, 0.0, abs(sin(a * 1.5 + 1.5708)) * r * 3.0);
      vec3 lc = vec3(0.23, 0.37, 0.12) * (0.85 + 0.25 * smoothstep(0.04, 0.0, abs(r - tre * 0.55)));
      c = mix(c, lc * (1.0 + 0.2 * midrib), leaf);
      h = max(h, leaf * (2.6 + r * 2.0));
    }
  }
  gRough = 0.82;
  return vec4(c, h);
}

// sand: grains of many minerals — quartz (clear-buff), feldspar (pinkish), dark grains (5–10 %) — with shadows between,
// faint water ripples, a shell fragment now and then (photo dry sand (218, 197, 166), p10 (198, 172, 135))
vec4 sand(vec2 u, bool savanna) {
  float rip = sin((u.y * 4.0 + pf(u, 2.0, 3, 61.0) * 1.8) * 6.2832) * 0.5 + 0.5;
  float h = rip * 0.25 + pf(u, 6.0, 3, 62.0) * 0.12;
  vec3 c = savanna ? vec3(0.58, 0.44, 0.32) : vec3(0.55, 0.49, 0.40);       // the shadowed spaces between grains
  Pt g = scatter(u, 110.0, 2, 0.9, 0.3, 0.6, 0.6, 0.15, 0.7, 63.0);          // 0.2–0.4 mm grains
  Pt g2 = scatter(u, 48.0, 1, 0.45, 0.3, 0.6, 0.6, 0.2, 0.7, 64.0);          // 0.4–0.8 mm
  gRough = 0.9;
  float hg = g.h + h, hg2 = g2.h + h + 0.05;
  float id = g.id;
  if (hg2 > hg) { id = g2.id; hg = hg2; }
  if (hg > h) {
    h = hg;
    vec3 q = savanna ? vec3(0.80, 0.64, 0.47) : vec3(0.78, 0.71, 0.58);
    if (id > 0.93) q = vec3(0.24, 0.22, 0.20);
    else if (id > 0.82) q = savanna ? vec3(0.72, 0.46, 0.30) : vec3(0.74, 0.60, 0.52);
    else if (id > 0.6) q = savanna ? vec3(0.86, 0.74, 0.58) : vec3(0.84, 0.79, 0.69);
    else if (id < 0.06) { q = vec3(0.86, 0.84, 0.78); gRough = 0.45; }
    c = q * (0.88 + 0.2 * pn(u, 300.0, 65.0));
  }
  return vec4(c, h);
}

// gravel: rounded pebbles of mixed rock half-sunk in sand, a dark contact line round each
vec4 gravel(vec2 u) {
  vec4 s = sand(u, false);
  vec3 c = s.rgb * 0.92;
  float h = s.a;
  Pt p1 = scatter(u, 6.0, 1, 0.5, 0.25, 0.5, 0.55, 0.12, 0.55, 71.0);   // 3–5 mm
  Pt p2 = scatter(u, 13.0, 2, 0.45, 0.22, 0.45, 0.5, 0.15, 0.6, 72.0);  // 1–2 mm
  float sink = 0.6;
  float hp2 = p2.h - sink * 0.4, hp1 = p1.h - sink;
  float id = -1.0, dd = 1.0;
  gRough = 0.9;
  if (hp2 > h) { h = hp2; id = p2.id; dd = p2.d; }
  if (hp1 > h) { h = hp1; id = p1.id; dd = p1.d; }
  if (id >= 0.0) {
    vec3 pc = id < 0.3 ? vec3(0.54, 0.52, 0.48) : id < 0.55 ? vec3(0.62, 0.55, 0.45) : id < 0.75 ? vec3(0.46, 0.40, 0.35) : id < 0.9 ? vec3(0.66, 0.62, 0.56) : vec3(0.32, 0.30, 0.28);
    pc *= 0.85 + 0.25 * pn(u, 160.0, 73.0 + id * 10.0);
    pc = mix(pc, pc * 0.75, smoothstep(0.75, 1.0, dd));
    c = pc;
    gRough = 0.62 + 0.12 * id;
  } else {
    // sand right at a pebble's foot is darker (shadow and damp)
    c *= 0.9;
  }
  return vec4(c, h);
}

// mud: smooth and slick, undulating, drop pits and worm casts, smears, a few sand grains on top
vec4 mud(vec2 u) {
  float und = pf(u, 3.0, 4, 81.0);
  float smear = pf(warp(u, 2.0, 0.2, 82.0) * vec2(1.0, 4.0), 4.0, 3, 83.0);
  vec3 c = mix(vec3(0.27, 0.22, 0.17), vec3(0.36, 0.29, 0.22), und * 0.6 + smear * 0.4);
  float h = und * 0.5 + smear * 0.15;
  Pt pit = scatter(u, 9.0, 1, 0.35, 0.12, 0.28, 0.75, 0.1, 0.5, 84.0);
  h -= pit.h * 0.8;
  c *= 1.0 - smoothstep(0.0, 0.2, pit.h) * 0.25;
  Pt wc = scatter(u, 5.0, 2, 0.12, 0.12, 0.25, 0.4, 0.5, 0.7, 85.0);
  if (wc.h > 0.0) { h += wc.h; c = mix(c, vec3(0.33, 0.27, 0.20), 0.6); }
  Pt g = scatter(u, 70.0, 1, 0.04, 0.25, 0.45, 0.6, 0.2, 0.6, 86.0);
  if (g.h > 0.0) { h += g.h * 0.6; c = mix(c, vec3(0.52, 0.47, 0.39), 0.5); }
  gRough = 0.35 + 0.25 * smoothstep(0.35, 0.7, pf(u, 6.0, 3, 87.0));
  return vec4(c, h);
}

// clay (cut faces): fine and smooth, laminations, mottles of grey and orange, a few shrinkage cracks
vec4 clay(vec2 u) {
  vec2 w = warp(u, 3.0, 0.05, 91.0);
  float lam = sin((w.y * 26.0 + pf(u, 3.0, 3, 92.0) * 2.0) * 6.2832) * 0.5 + 0.5;
  float mot = pf(u, 5.0, 4, 93.0);
  vec3 c = vec3(0.50, 0.36, 0.27);
  c = mix(c, vec3(0.62, 0.42, 0.25), smoothstep(0.6, 0.78, mot) * 0.6);
  c = mix(c, vec3(0.52, 0.49, 0.44), smoothstep(0.32, 0.18, mot) * 0.55);
  c *= 0.92 + 0.1 * lam;
  vec4 ck = pw(warp(u, 5.0, 0.08, 94.0), 5.0, 95.0, 0.9);
  float crack = smoothstep(0.018, 0.0, ck.y - ck.x) * smoothstep(0.62, 0.74, pf(u, 3.0, 2, 96.0));
  c *= 1.0 - crack * 0.5;
  float grit = pf(u, 60.0, 3, 98.0);
  c *= 0.93 + 0.12 * pn(u, 200.0, 97.0);
  gRough = 0.68 + 0.14 * mot;
  return vec4(c, 0.3 + lam * 0.04 + grit * 0.12 - crack * 0.35 + pf(u, 6.0, 4, 99.0) * 0.5);
}

// bank faces (u across the face, v up it; the tile repeats every GL_TILE mm up the face): a broken earth face — clods
// standing out over hollows, strata of differing colour and grain whose boundaries wander and step out as small
// ledges, rootlets, pebbles set in the face, burrow holes
vec4 bankSoil(vec2 u) {
  vec2 w = warp(u, 3.0, 0.06, 101.0);
  // the strata: iso-lines of a function of height, wandering a little along the face (all periodic on the tile)
  float sv = pf(vec2(0.5, w.y), 3.0, 4, 102.0) + (pf(w, 2.0, 2, 112.0) - 0.5) * 0.1;
  vec3 c = mix(vec3(0.29, 0.225, 0.17), vec3(0.42, 0.335, 0.25), smoothstep(0.38, 0.5, sv));
  c = mix(c, vec3(0.48, 0.37, 0.27), smoothstep(0.6, 0.66, sv) * 0.6);
  c = mix(c, vec3(0.40, 0.33, 0.26), smoothstep(0.3, 0.26, sv) * 0.5);
  float ledge = smoothstep(0.012, 0.0, abs(sv - 0.5)) + smoothstep(0.012, 0.0, abs(sv - 0.63)) * 0.8 + smoothstep(0.012, 0.0, abs(sv - 0.29)) * 0.6;
  float h = pf(u, 8.0, 4, 104.0) * 0.7 + smoothstep(0.38, 0.5, sv) * 0.6 + smoothstep(0.6, 0.66, sv) * 0.4;
  Pt cl = scatter(u, 7.0, 2, 0.6, 0.3, 0.6, 0.45, 0.45, 0.5, 105.0);
  Pt cr = scatter(u, 20.0, 2, 0.7, 0.25, 0.55, 0.5, 0.4, 0.55, 106.0);
  if (cr.h + 0.25 > h) { h = cr.h + 0.25; c *= 0.88 + 0.25 * cr.id; }
  if (cl.h + 0.35 > h) { h = cl.h + 0.35 + cr.h * 0.3; c *= 0.92 + 0.2 * cl.id; }
  c *= 1.0 - min(1.0, ledge) * 0.35;
  Pt pb = scatter(u, 6.0, 1, 0.16, 0.16, 0.28, 0.6, 0.15, 0.55, 107.0);
  if (pb.h > 0.0 && pb.h + 0.6 > h) { h = pb.h + 0.6; c = mix(vec3(0.46, 0.44, 0.40), vec3(0.55, 0.47, 0.38), pb.id) * (0.85 + 0.25 * pn(u, 160.0, 108.0)); }
  float root = fibres(u, 6.0, 1.2, 0.016, 0.16, 109.0);
  if (root > 0.25) { c = mix(c, mix(vec3(0.54, 0.44, 0.33), vec3(0.40, 0.31, 0.23), gFib.x), root * 0.85); h = max(h, h * 0.7 + root * 0.8); }
  Pt hole = scatter(u, 4.0, 1, 0.2, 0.07, 0.12, 0.7, 0.2, 1.0, 110.0);
  if (hole.h > 0.0) { h -= hole.h * 1.5; c *= 0.3 + 0.5 * hole.d; }
  c *= 0.9 + 0.2 * pn(u, 180.0, 111.0);
  gRough = 0.94;
  return vec4(c, h);
}

// rock: weathered stone — a rough bumpy skin (no plates), bedding, fractures that come and go, crustose lichen
// (grey-green rosettes with paler rims, small orange ones), dirt in the low spots
vec4 rock(vec2 u) {
  vec2 w = warp(u, 2.0, 0.08, 121.0);
  float n = pf(w, 4.0, 5, 122.0);
  float bump = pf(u, 30.0, 3, 123.0);
  float bed = sin((w.y * 7.0 + n * 1.2) * 6.2832) * 0.5 + 0.5;
  vec3 c = mix(vec3(0.44, 0.42, 0.38), vec3(0.60, 0.57, 0.51), smoothstep(0.3, 0.75, n)) * (0.92 + 0.08 * bed);
  c *= 0.88 + 0.24 * bump;
  vec4 ck = pw(warp(u, 3.0, 0.1, 124.0), 3.0, 125.0, 0.9);
  float crack = smoothstep(0.025, 0.0, ck.y - ck.x) * smoothstep(0.45, 0.6, pf(u, 2.0, 2, 126.0));
  float h = n * 2.2 + bump * 0.4 + bed * 0.2 - crack * 0.8;
  float dirt = smoothstep(1.4, 0.8, h);
  c = mix(c, vec3(0.34, 0.28, 0.21), dirt * 0.5);
  c *= 1.0 - crack * 0.55;
  Pt pit = scatter(u, 40.0, 2, 0.5, 0.2, 0.45, 0.6, 0.3, 0.6, 130.0);
  h -= pit.h * 0.6;
  c *= 1.0 - smoothstep(0.0, 0.15, pit.h) * 0.18;
  Pt li = scatter(u, 9.0, 2, 0.2, 0.2, 0.5, 0.6, 0.4, 0.05, 127.0);
  if (li.h > 0.0) { c = mix(c, mix(vec3(0.52, 0.55, 0.46), vec3(0.62, 0.63, 0.54), smoothstep(0.75, 1.0, li.d)) * (0.85 + 0.3 * pn(u, 120.0, 131.0)), 0.55); h += 0.06; }
  Pt lo = scatter(u, 20.0, 1, 0.06, 0.2, 0.4, 0.6, 0.35, 0.05, 128.0);
  if (lo.h > 0.0) { c = mix(c, vec3(0.64, 0.45, 0.22), 0.5); h += 0.04; }
  c *= 0.94 + 0.12 * pn(u, 240.0, 129.0);
  gRough = 0.85;
  return vec4(c, h);
}

vec4 bankSand(vec2 u) {
  vec4 s = sand(u, false);
  vec2 w = warp(u, 3.0, 0.06, 131.0);
  float lam = sin((w.y * 14.0 + pf(u, 3.0, 3, 132.0) * 2.0) * 6.2832) * 0.5 + 0.5;
  vec3 c = s.rgb * (0.86 + 0.18 * lam);
  float slump = smoothstep(0.55, 0.8, pf(u * vec2(1.0, 2.0), 5.0, 3, 133.0));
  c *= 1.0 - slump * 0.12;
  // a pebble band
  float pbBand = smoothstep(0.75, 0.9, pn(vec2(0.5, w.y), 4.0, 134.0));
  Pt pb = scatter(u, 14.0, 1, 0.6 * pbBand, 0.25, 0.45, 0.6, 0.15, 0.55, 135.0);
  float h = s.a * 0.8 + lam * 0.35 + slump * 0.4;
  if (pb.h > 0.0) { h = max(h, pb.h + 0.3); c = mix(vec3(0.52, 0.50, 0.46), vec3(0.62, 0.55, 0.45), pb.id); }
  gRough = 0.92;
  return vec4(c, h);
}

// a root wall: the soil face held by roots — several roots wandering across, bark ridged along them, rootlets
vec4 bankRoot(vec2 u) {
  vec4 so = bankSoil(u);
  vec3 c = so.rgb;
  float h = so.a * 0.6;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float y0 = h1(fk * 3.1 + 1.0);
    float w = 0.025 + 0.045 * h1(fk * 5.3 + 2.0);
    float y = y0 + 0.07 * sin(u.x * 6.2832 * (1.0 + floor(h1(fk + 9.0) * 2.0)) + fk * 2.1) + 0.025 * sin(u.x * 6.2832 * 3.0 + fk * 4.0) + (pf(vec2(u.x, fk * 0.17), 6.0, 2, 141.0 + fk) - 0.5) * 0.05;
    float d = abs(fract(u.y - y + 0.5) - 0.5);
    if (d > w) continue;
    float round_ = sqrt(max(0.0, 1.0 - (d / w) * (d / w)));
    float rh = 1.5 + round_ * w * uTileMm * 0.8;
    if (rh < h) continue;
    float ridge = pn(vec2(u.x * 1.0, (u.y - y) / w * 0.25), 60.0, 142.0 + fk);
    vec3 bark = mix(vec3(0.40, 0.29, 0.20), vec3(0.28, 0.20, 0.14), ridge) * (0.7 + 0.4 * round_);
    c = bark;
    h = rh + ridge * 0.3;
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
  else if (uLayer == 8) g = clay(u);
  else if (uLayer == 9) g = bankSoil(u);
  else if (uLayer == 10) g = rock(u);
  else if (uLayer == 11) g = loam(u, true);
  else if (uLayer == 12) g = bankSand(u);
  else if (uLayer == 13) g = bankRoot(u);
  else if (uLayer == 14) g = sand(u, true);
  else g = sward(u, true);
  if (uOut == 0) outColor = vec4(clamp(g.rgb, 0.0, 1.0), clamp(gRough, 0.05, 1.0));
  else outColor = vec4(clamp(g.a / uRelief, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

/** Pass 2: normal and cavity from the baked height (layer uLayer of tH); heights in mm via uRelief. */
const FS2 = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
in vec2 vPx;
out vec4 outColor;
uniform vec2 uSize;
uniform int uLayer;
uniform float uRelief;
uniform float uTexMm;
uniform sampler2DArray tH;
float H(ivec2 p) {
  ivec2 s = ivec2(uSize);
  p = (p % s + s) % s;
  return texelFetch(tH, ivec3(p, uLayer), 0).r * uRelief;
}
void main() {
  ivec2 p = ivec2(vPx);
  float hl = H(p - ivec2(1, 0)), hr = H(p + ivec2(1, 0)), hd = H(p - ivec2(0, 1)), hu = H(p + ivec2(0, 1));
  vec3 n = normalize(vec3((hl - hr) / (2.0 * uTexMm), (hd - hu) / (2.0 * uTexMm), 1.0));
  float h0 = H(p);
  // cavity: how far the ground around (0.5, 1.2 and 2.5 mm away) stands above this point — the shadow in hollows
  float occ = 0.0;
  for (int k = 0; k < 24; k++) {
    float a = float(k) * 0.2618 + float(k / 8) * 0.13;
    float rmm = k < 8 ? 0.5 : k < 16 ? 1.2 : 2.5;
    float r = rmm / uTexMm;
    float dh = H(p + ivec2(round(cos(a) * r), round(sin(a) * r))) - h0;
    occ += clamp(dh / rmm, 0.0, 1.0);
  }
  occ /= 24.0;
  float cav = clamp(1.0 - occ * 1.4, 0.0, 1.0);
  outColor = vec4(n.xy * 0.5 + 0.5, h0 / uRelief, cav);
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
  const u1 = { uSize: { value: new THREE.Vector2(size, size) }, uOut: { value: 0 }, uLayer: { value: 0 }, uTileMm: { value: 64 }, uRelief: { value: 1 } };
  const m1 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS1, uniforms: u1, depthTest: false, depthWrite: false });
  const u2 = { uSize: u1.uSize, uLayer: { value: 0 }, uRelief: { value: 1 }, uTexMm: { value: 0.125 }, tH: { value: Hh.texture } };
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
    u1.uTileMm.value = GL_TILE[L];
    u1.uRelief.value = GL_RELIEF[L];
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
    u2.uRelief.value = GL_RELIEF[L];
    u2.uTexMm.value = GL_TILE[L] / size;
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
