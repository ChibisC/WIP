import * as THREE from 'three';
import type { CrownStyle } from '../../maps/types';

/**
 * Trees v2 (claude/trees/02-spec-trees-look-and-tiers.md §2; CHANGE_PLAN §38.2): each tree species' bark and leaves,
 * generated procedurally and baked once on the GPU like the ground (render/ground/groundBake.ts). Original patterns
 * only — the reference photos (study only) gave the numbers in docs/trees/references.md and nothing else.
 *
 * Bark: one seamless tile per species (u round the branch, v along it), real size `BARK_TILE` mm, in two array
 * textures:
 *   A  RGB albedo (stored as √ of linear, so the darks keep their steps), A roughness
 *   N  RG tangent normal (0.5 flat), B height 0..1, A cavity (1 open … 0 deep: the shadow in the furrows)
 * Leaves: `LEAF_VARIANTS` blades per species (holes, browned edges and outline differ), u across, v base → tip:
 *   A  RGB albedo of the upper side (√ linear), A the blade's outline (alpha)
 *   N  RG normal (midrib and veins), B light let through (veins and thick blades less), A vein mask
 * Nothing here touches the simulation.
 */

/** bark layer of each crown style */
export const BARK_LAYER: Record<CrownStyle, number> = { oak: 0, beech: 1, willow: 2, tropical: 3, acacia: 4, sapling: 1 };
export const BARK_COUNT = 5;
/** each layer's tile (mm, square) and relief (mm: the height that maps to 1.0) */
export const BARK_TILE = [48, 40, 56, 64, 40];
export const BARK_RELIEF = [4.5, 0.6, 4.5, 1.6, 3.2];
/** blade variants a species; layer = species × LEAF_VARIANTS + variant */
export const LEAF_VARIANTS = 4;
export const LEAF_LAYER: Record<CrownStyle, number> = { oak: 0, beech: 1, willow: 2, tropical: 3, acacia: 4, sapling: 1 };

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

const NOISE = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// periodic value noise: period P cells (integers)
float pn(vec2 p, vec2 P, float s) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(mod(i, P) + s);
  float b = hash(mod(i + vec2(1.0, 0.0), P) + s);
  float c = hash(mod(i + vec2(0.0, 1.0), P) + s);
  float d = hash(mod(i + 1.0, P) + s);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pf(vec2 p, vec2 P, int oct, float s) {
  float t = 0.0;
  float a = 0.5;
  float n = 0.0;
  for (int k = 0; k < 6; k++) {
    if (k >= oct) break;
    t += a * pn(p, P, s + float(k) * 7.1);
    n += a;
    a *= 0.5;
    p *= 2.0;
    P *= 2.0;
  }
  return t / n;
}
// periodic Worley: (F1, F2, the nearest feature's hash); rel the offset to the nearest feature (cell units)
vec3 pw(vec2 p, vec2 P, float s, out vec2 rel) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 9.0;
  float f2 = 9.0;
  float id = 0.0;
  rel = vec2(0.0);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 c = mod(i + g, P);
      vec2 o = vec2(hash(c + s), hash(c + s + 17.3));
      vec2 r = g + o - f;
      float d = length(r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash(c + s + 3.7);
        rel = r;
      } else if (d < f2) f2 = d;
    }
  return vec3(f1, f2, id);
}
`;

/**
 * Bark, pass 1: albedo + roughness (uOut 0) or height (uOut 1) of layer uLayer. Each generator returns linear albedo
 * and height in mm; roughness in gRough.
 */
const BARK_FS = /* glsl */ `
precision highp float;
in vec2 vPx;
out vec4 outColor;
uniform vec2 uSize;
uniform int uOut;
uniform int uLayer;
uniform float uRelief;
float gRough = 0.9;
${NOISE}
vec2 warp(vec2 u, vec2 P, float amt, float s) {
  return u + (vec2(pf(u * P, P, 3, s), pf(u * P + 3.1, P, 3, s + 1.0)) - 0.5) * amt;
}

// English oak: thick grey-brown ridges between deep dark fissures that meander down the branch, joining and parting
// (the lines where a noise stretched along the branch crosses its middle), finer fissures on the ridges' faces, a
// crack across now and then; rough grain; red-brown furrow floors
vec4 oak(vec2 u) {
  vec2 q = warp(u, vec2(3.0, 2.0), 0.08, 11.0);
  // (stretched hard along the branch: the fissures run long, joining and parting, rarely closing into loops)
  float n1 = pf(vec2(q.x * 8.0, q.y * 1.0), vec2(8.0, 1.0), 3, 11.0);
  float n2 = pf(vec2(q.x * 18.0, q.y * 3.0), vec2(18.0, 3.0), 2, 12.0);
  float f1 = abs(n1 - 0.5);
  float f2 = abs(n2 - 0.5);
  float main = smoothstep(0.008, 0.06, f1);
  float minor = smoothstep(0.006, 0.035, f2);
  float grain = pf(u * vec2(40.0, 10.0), vec2(40.0, 10.0), 4, 30.0);
  float cv = fract(u.y * 6.0 + n1 * 2.0);
  float crack = smoothstep(0.03, 0.0, abs(cv - 0.5)) * step(0.62, pn(u * vec2(11.0, 6.0), vec2(11.0, 6.0), 41.0));
  float ridge = main * (0.6 + 0.4 * minor) * (1.0 - crack * 0.7);
  float h = main * 2.6 + main * minor * 0.8 + ridge * grain * 0.7;
  vec3 top = mix(vec3(0.075, 0.066, 0.054), vec3(0.16, 0.145, 0.12), grain) * (0.8 + 0.4 * n1);
  vec3 side = vec3(0.04, 0.03, 0.022);
  vec3 deep = vec3(0.018, 0.010, 0.006);
  vec3 col = mix(deep, side, smoothstep(0.0, 0.45, main));
  col = mix(col, top, smoothstep(0.45, 1.0, main) * (0.7 + 0.3 * minor) * (1.0 - crack * 0.6));
  gRough = mix(0.97, 0.86, ridge);
  return vec4(col, h);
}

// European beech: thin, smooth silver-grey bark, softly mottled; fine dashes of lenticels across the branch, faint
// wrinkles round it, now and then a dark scar where a twig fell (the "eye")
vec4 beech(vec2 u) {
  float m = pf(u * vec2(5.0, 3.0), vec2(5.0, 3.0), 4, 50.0);
  float fine = pf(u * 56.0, vec2(56.0), 3, 51.0);
  vec3 c = mix(vec3(0.095, 0.097, 0.092), vec3(0.19, 0.19, 0.18), m) * (0.95 + 0.1 * fine);
  float h = 0.25 + fine * 0.12 + m * 0.08;
  float ring = smoothstep(0.86, 1.0, pn(vec2(u.x * 3.0, u.y * 26.0), vec2(3.0, 26.0), 52.0));
  h -= ring * 0.1;
  c *= 1.0 - ring * 0.1;
  vec2 rel;
  vec3 w = pw(vec2(u.x * 16.0, u.y * 32.0), vec2(16.0, 32.0), 53.0, rel);
  float dash = smoothstep(0.26, 0.12, length(rel * vec2(0.5, 1.9))) * step(0.72, w.z);
  h += dash * 0.08;
  c = mix(c, vec3(0.06, 0.055, 0.048), dash * 0.4);
  // a twig scar: a dark eye with a little moustache of creased bark above it
  vec2 rel2;
  vec3 e = pw(u * vec2(2.0, 1.0), vec2(2.0, 1.0), 54.0, rel2);
  vec2 ep = rel2 * vec2(2.0, 1.0) / vec2(2.0, 1.0);
  float eye = smoothstep(0.075, 0.045, length(ep * vec2(1.0, 1.5))) * step(0.5, e.z);
  float moust = smoothstep(0.012, 0.0, abs(ep.y + 0.07 - abs(ep.x) * 0.45)) * step(abs(ep.x), 0.2) * step(0.5, e.z);
  c = mix(c, vec3(0.03, 0.028, 0.025), max(eye, moust * 0.8));
  h -= eye * 0.25 - moust * 0.05;
  gRough = 0.62 + 0.12 * fine + eye * 0.2;
  return vec4(c, h);
}

// White willow: deep furrows between narrow ridges that interlace — the ridges run together and apart down the branch
// (two families of fissures, lines of a noise stretched hard along the branch); grey-brown ridges, dark furrows
vec4 willow(vec2 u) {
  vec2 q = warp(u, vec2(3.0, 2.0), 0.12, 60.0);
  float n1 = pf(vec2(q.x * 7.0, q.y * 1.0), vec2(7.0, 1.0), 3, 61.0);
  float n2 = pf(vec2(q.x * 7.0 + 0.5, q.y * 1.0), vec2(7.0, 1.0), 3, 65.0);
  float f = min(abs(n1 - 0.5), abs(n2 - 0.5) * 1.5);
  float ridge = smoothstep(0.008, 0.055, f);
  float grain = pf(vec2(u.x * 40.0, u.y * 12.0), vec2(40.0, 12.0), 3, 62.0);
  float h = ridge * (3.0 + 1.1 * grain) + grain * 0.3;
  vec3 c = mix(vec3(0.02, 0.015, 0.01), mix(vec3(0.075, 0.064, 0.05), vec3(0.135, 0.118, 0.094), grain), smoothstep(0.1, 0.9, ridge));
  gRough = 0.94 - 0.06 * ridge;
  return vec4(c, h);
}

// rainforest trees: smooth, pale grey-brown bark, mottled, with lenticels; here and there a flake of the outer bark
// lifting at its edge, paler or greener beneath, a dark rim where it parts
vec4 tropical(vec2 u) {
  float m = pf(u * 4.0, vec2(4.0), 4, 70.0);
  float fine = pf(u * 44.0, vec2(44.0), 3, 71.0);
  vec3 c = mix(vec3(0.085, 0.074, 0.056), vec3(0.17, 0.152, 0.118), m) * (0.95 + 0.1 * fine);
  float h = 0.3 + fine * 0.2;
  vec2 rel;
  vec3 w = pw(warp(u, vec2(6.0), 0.06, 74.0) * vec2(5.0, 4.0), vec2(5.0, 4.0), 72.0, rel);
  float flake = step(0.7, w.z);
  float e = w.y - w.x;
  h += flake * (0.45 + 0.6 * smoothstep(0.0, 0.3, e));
  c = mix(c, mix(vec3(0.22, 0.17, 0.095), vec3(0.14, 0.16, 0.085), fract(w.z * 7.0)), flake * 0.6 * smoothstep(0.06, 0.3, e));
  c = mix(c, vec3(0.04, 0.03, 0.02), flake * (1.0 - smoothstep(0.0, 0.05, e)) * 0.6);
  vec2 rel2;
  vec3 l = pw(vec2(u.x * 18.0, u.y * 24.0), vec2(18.0, 24.0), 73.0, rel2);
  float len = smoothstep(0.22, 0.1, length(rel2 * vec2(0.6, 1.4))) * step(0.6, l.z);
  c = mix(c, vec3(0.3, 0.26, 0.2), len * 0.45);
  h += len * 0.15;
  gRough = 0.72 + 0.12 * fine;
  return vec4(c, h);
}

// umbrella-thorn acacia: rough, dark grey bark in a network of fissures that show the red-brown inner bark
vec4 acacia(vec2 u) {
  vec2 q = warp(u, vec2(4.0), 0.08, 80.0);
  float n1 = pf(vec2(q.x * 8.0, q.y * 4.0), vec2(8.0, 4.0), 3, 81.0);
  float n2 = pf(vec2(q.x * 15.0, q.y * 8.0), vec2(15.0, 8.0), 2, 83.0);
  float f = min(abs(n1 - 0.5), abs(n2 - 0.5) * 1.6);
  float ridge = smoothstep(0.008, 0.05, f);
  float grain = pf(u * 36.0, vec2(36.0), 4, 82.0);
  float h = ridge * (1.9 + 0.8 * n1) + grain * 0.5 * ridge;
  vec3 inner = vec3(0.05, 0.018, 0.007);
  vec3 c = mix(inner, mix(vec3(0.02, 0.016, 0.013), vec3(0.055, 0.046, 0.038), grain), smoothstep(0.2, 1.0, ridge));
  gRough = 0.95;
  return vec4(c, h);
}

void main() {
  vec2 u = vPx / uSize;
  vec4 g;
  if (uLayer == 0) g = oak(u);
  else if (uLayer == 1) g = beech(u);
  else if (uLayer == 2) g = willow(u);
  else if (uLayer == 3) g = tropical(u);
  else g = acacia(u);
  if (uOut == 0) outColor = vec4(sqrt(clamp(g.rgb, 0.0, 1.0)), clamp(gRough, 0.05, 1.0));
  else outColor = vec4(clamp(g.a / uRelief, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

/** Normal + cavity from a baked height (the ground bake's pass 2, for any array). */
const NORMAL_FS = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
in vec2 vPx;
out vec4 outColor;
uniform vec2 uSize;
uniform int uLayer;
uniform float uRelief;
uniform vec2 uTexMm;
uniform sampler2DArray tH;
uniform int uWrap;
float H(ivec2 p) {
  ivec2 s = ivec2(uSize);
  if (uWrap == 1) p = (p % s + s) % s;
  else p = clamp(p, ivec2(0), s - 1);
  return texelFetch(tH, ivec3(p, uLayer), 0).r * uRelief;
}
void main() {
  ivec2 p = ivec2(vPx);
  float hl = H(p - ivec2(1, 0)), hr = H(p + ivec2(1, 0)), hd = H(p - ivec2(0, 1)), hu = H(p + ivec2(0, 1));
  vec3 n = normalize(vec3((hl - hr) / (2.0 * uTexMm.x), (hd - hu) / (2.0 * uTexMm.y), 1.0));
  float h0 = H(p);
  float occ = 0.0;
  for (int k = 0; k < 24; k++) {
    float a = float(k) * 0.2618 + float(k / 8) * 0.13;
    float rmm = k < 8 ? 0.6 : k < 16 ? 1.4 : 3.0;
    vec2 r = rmm / uTexMm;
    float dh = H(p + ivec2(round(cos(a) * r.x), round(sin(a) * r.y))) - h0;
    occ += clamp(dh / rmm, 0.0, 1.0);
  }
  occ /= 24.0;
  outColor = vec4(n.xy * 0.5 + 0.5, h0 / uRelief, clamp(1.0 - occ * 1.5, 0.0, 1.0));
}`;

/**
 * Leaves, pass 1 (uOut 0: albedo + outline; 1: height; 2: light let through + vein mask). u across (−1…1), v from
 * the stalk (0) to the tip (1). Each species: its outline, its venation, its colours; each variant its own holes, browned
 * edges and a slightly different shape.
 */
const LEAF_FS = /* glsl */ `
precision highp float;
in vec2 vPx;
out vec4 outColor;
uniform vec2 uSize;
uniform int uOut;
uniform int uSpecies;
uniform float uVar;
${NOISE}
float sat(float x) { return clamp(x, 0.0, 1.0); }

// half-width of the blade at y (0 stalk … 1 tip), as a share of the texture's half-width
float halfWidth(float y, int sp, float v) {
  if (sp == 0) {
    // oak: obovate, widest beyond the middle, five or six rounded lobes a side with deep sinuses, little ears at the base
    float env = 0.92 * pow(sin(3.14159 * min(1.0, y * 1.02)), 0.6) * (0.62 + 0.38 * y);
    // (3–7 pairs of rounded lobes, the sinuses cut about halfway to the midrib)
    float lob = 0.46 + 0.54 * pow(abs(cos(3.14159 * (y * (5.2 + v * 0.6) + 0.2))), 0.7);
    float ear = smoothstep(0.1, 0.02, y) * 0.25;
    return max(env * lob, ear);
  }
  if (sp == 1) {
    // beech: oval, widest a little below the middle, a gently wavy edge, a short point
    float env = 0.9 * pow(sin(3.14159 * pow(y, 0.82)), 0.78);
    return env * (1.0 + 0.04 * sin(6.2832 * y * (7.0 + v)));
  }
  if (sp == 2) {
    // willow: a long narrow blade tapering to both ends, finely toothed (the blade's narrowness is the geometry's)
    float env = 0.9 * pow(sin(3.14159 * y), 0.85);
    return env * (1.0 - 0.04 * abs(fract(y * 46.0) - 0.5));
  }
  if (sp == 3) {
    // rainforest leaf: broad, ovate, smooth-edged, drawn out into a drip tip
    if (y < 0.84) return 0.92 * pow(sin(3.14159 * min(1.0, (y + 0.02) / 0.9)), 0.62);
    float t = (y - 0.84) / 0.16;
    return mix(0.92 * pow(sin(3.14159 * (0.86 / 0.9)), 0.62), 0.02, pow(t, 0.55));
  }
  return 0.0;
}

// acacia: a twice-divided leaf — a stalk with six pairs of side stalks (pinnae), each set with tiny leaflets in pairs
float acaciaFrond(vec2 p, out float vein) {
  vein = smoothstep(0.03, 0.0, abs(p.x)) * step(0.02, p.y) * step(p.y, 0.98);
  float a = 0.0;
  for (int k = 0; k < 6; k++) {
    float y0 = 0.14 + float(k) * 0.14;
    for (int s = -1; s <= 1; s += 2) {
      vec2 d = normalize(vec2(float(s) * 0.86, 0.5));
      vec2 n = vec2(-d.y, d.x);
      vec2 q = p - vec2(0.0, y0);
      float t = dot(q, d);
      float pr = dot(q, n);
      float tl = 0.62 + 0.3 * sin(3.14159 * (y0 - 0.05));
      if (t < 0.0 || t > tl) continue;
      vein = max(vein, smoothstep(0.018, 0.0, abs(pr)) * 0.8);
      float st = 0.07;
      float j = floor(t / st + 0.5);
      float lt = t - j * st;
      for (int side = -1; side <= 1; side += 2) {
        vec2 lc = vec2(lt, pr - float(side) * 0.04);
        a = max(a, step(length(lc / vec2(0.028, 0.042)), 1.0) * step(0.04, t));
      }
    }
  }
  return max(a, vein > 0.5 ? 1.0 : 0.0);
}

void main() {
  vec2 uv = vPx / uSize;
  vec2 p = vec2(uv.x * 2.0 - 1.0, uv.y);
  int sp = uSpecies;
  float v = uVar;
  float vs = v * 13.0 + float(sp) * 101.0;
  float inside;
  float vein = 0.0;
  if (sp == 4) inside = acaciaFrond(p, vein);
  else {
    float hw = halfWidth(p.y, sp, fract(v * 0.37));
    // the edge, a little ragged at this scale
    float edge = hw - abs(p.x) + (pn(p * vec2(30.0, 60.0), vec2(1e4), vs) - 0.5) * 0.012;
    inside = step(0.0, edge) * step(0.005, p.y) * step(p.y, 0.995);
    // the stalk below the blade
    inside = max(inside, step(abs(p.x), 0.03) * step(p.y, 0.05));
    // midrib and the side veins: pinnate, angled toward the tip (beech straight and parallel, oak to the lobes,
    // rainforest curving toward the edge, willow faint)
    float ax = abs(p.x);
    float mid = smoothstep(0.04, 0.0, ax) * (1.0 - smoothstep(0.85, 1.0, p.y) * 0.5);
    float N = sp == 0 ? 5.2 + fract(v * 0.37) * 0.6 : sp == 1 ? 8.0 : sp == 2 ? 14.0 : 7.0;
    float slope = sp == 0 ? 0.35 : sp == 1 ? 0.55 : sp == 2 ? 0.9 : 0.42;
    float curve = sp == 3 ? 0.55 : 0.0;
    float yy = p.y - slope * ax - curve * ax * ax;
    float sv = smoothstep(0.016, 0.0, abs(fract(yy * N + (sp == 0 ? 0.2 : 0.5)) - 0.5) / N * 6.0) * smoothstep(0.03, 0.08, ax);
    sv *= sp == 2 ? 0.35 : 1.0;
    // the finest veins: a net between the side veins
    vec2 rel;
    vec3 net = pw(p * vec2(26.0, 40.0), vec2(1e4), vs + 5.0, rel);
    float fine = smoothstep(0.06, 0.0, net.y - net.x) * 0.35;
    vein = max(mid, max(sv, fine));
  }
  // holes eaten by caterpillars (from the edge or inside) and a browned edge on some
  float hole = 0.0;
  for (int k = 0; k < 3; k++) {
    float hk = hash(vec2(v * 7.0 + float(k), float(sp)));
    if (hk < 0.45) continue;
    vec2 c = vec2((hash(vec2(hk, 1.0)) - 0.5) * 1.4, 0.2 + 0.6 * hash(vec2(hk, 2.0)));
    float r = 0.05 + 0.08 * hash(vec2(hk, 3.0));
    float wob = (pn((p - c) * 18.0, vec2(1e4), hk * 9.0) - 0.5) * r * 0.8;
    hole = max(hole, step(length((p - c) * vec2(1.0, 1.6)) + wob, r));
  }
  float alpha = inside * (1.0 - hole);
  float hwHere = sp == 4 ? 1.0 : halfWidth(p.y, sp, fract(v * 0.37));
  float toEdge = sp == 4 ? 1.0 : sat((hwHere - abs(p.x)) / max(0.02, hwHere));
  float brown = step(0.5, hash(vec2(v, 9.0 + float(sp)))) * smoothstep(0.14, 0.02, toEdge) * smoothstep(0.35, 0.65, pn(p * vec2(6.0, 9.0), vec2(1e4), vs + 3.0));
  // colours (linear): the upper side's green, the veins a touch lighter, yellower toward the edge, the brown edge
  vec3 g0 = sp == 0 ? vec3(0.035, 0.075, 0.016) : sp == 1 ? vec3(0.05, 0.11, 0.02) : sp == 2 ? vec3(0.06, 0.09, 0.035) : sp == 3 ? vec3(0.025, 0.07, 0.014) : vec3(0.06, 0.08, 0.03);
  float mot = pf(p * vec2(4.0, 6.0), vec2(1e4), 2, vs + 7.0);
  vec3 c = g0 * (0.85 + 0.3 * mot);
  c = mix(c, c * vec3(1.35, 1.3, 0.9), smoothstep(0.35, 0.0, toEdge) * 0.35);
  c = mix(c, c * vec3(1.6, 1.55, 1.1), vein * 0.45);
  c = mix(c, vec3(0.12, 0.055, 0.018), brown * 0.85);
  // height: the side veins sunk in the upper side (the blade puckered between them), the midrib a groove
  float h = 0.5 - vein * 0.25 + (mot - 0.5) * 0.08;
  // light let through: less where the veins are, less in a thick rainforest blade, more in thin willow and beech
  float thick = sp == 3 ? 0.55 : sp == 0 ? 0.7 : sp == 2 ? 0.9 : 0.85;
  float trans = thick * (1.0 - vein * 0.65) * (1.0 - brown * 0.5);
  if (uOut == 0) outColor = vec4(sqrt(clamp(c, 0.0, 1.0)), alpha);
  else if (uOut == 1) outColor = vec4(h, 0.0, 0.0, 1.0);
  else outColor = vec4(trans, vein, 0.0, alpha);
}`;

/** The leaf maps' third array: light through (R) and the vein mask (G), packed into N's B and A. */
const LEAF_PACK_FS = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
in vec2 vPx;
out vec4 outColor;
uniform vec2 uSize;
uniform int uLayer;
uniform sampler2DArray tN;
uniform sampler2DArray tT;
void main() {
  ivec2 p = ivec2(vPx);
  vec4 n = texelFetch(tN, ivec3(p, uLayer), 0);
  vec4 t = texelFetch(tT, ivec3(p, uLayer), 0);
  outColor = vec4(n.xy, t.x, t.y);
}`;

export interface TreeMaps {
  barkA: THREE.Texture;
  barkN: THREE.Texture;
  leafA: THREE.Texture;
  leafN: THREE.Texture;
  barkSize: number;
  leafSize: [number, number];
}

let cached: TreeMaps | null = null;

/** Bake every species' bark and leaves (once per renderer; `size` 512 on high quality, 256 on low). */
export function bakeTreeMaps(r: THREE.WebGLRenderer, size = 512): TreeMaps {
  if (cached && cached.barkSize === size) return cached;
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const tri = new THREE.Mesh(geo);
  tri.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(tri);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = r.getRenderTarget();
  const prevAuto = r.autoClear;
  r.autoClear = true;
  const draw = (mat: THREE.RawShaderMaterial, rt: THREE.WebGLArrayRenderTarget, layer: number) => {
    tri.material = mat;
    r.setRenderTarget(rt, layer);
    r.render(scene, cam);
  };
  // ---- bark
  const bA = new THREE.WebGLArrayRenderTarget(size, size, BARK_COUNT, opts(true));
  const bH = new THREE.WebGLArrayRenderTarget(size, size, BARK_COUNT, opts(false));
  const bN = new THREE.WebGLArrayRenderTarget(size, size, BARK_COUNT, opts(true));
  const u1 = { uSize: { value: new THREE.Vector2(size, size) }, uOut: { value: 0 }, uLayer: { value: 0 }, uRelief: { value: 1 } };
  const m1 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: BARK_FS, uniforms: u1, depthTest: false, depthWrite: false });
  const u2 = { uSize: u1.uSize, uLayer: { value: 0 }, uRelief: { value: 1 }, uTexMm: { value: new THREE.Vector2(0.1, 0.1) }, tH: { value: bH.texture as THREE.Texture }, uWrap: { value: 1 } };
  const m2 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: NORMAL_FS, uniforms: u2, depthTest: false, depthWrite: false });
  for (let L = 0; L < BARK_COUNT; L++) {
    u1.uLayer.value = L;
    u1.uRelief.value = BARK_RELIEF[L];
    u1.uOut.value = 0;
    draw(m1, bA, L);
    u1.uOut.value = 1;
    draw(m1, bH, L);
  }
  for (let L = 0; L < BARK_COUNT; L++) {
    u2.uLayer.value = L;
    u2.uRelief.value = BARK_RELIEF[L];
    u2.uTexMm.value.set(BARK_TILE[L] / size, BARK_TILE[L] / size);
    draw(m2, bN, L);
  }
  // ---- leaves: (species × variants) layers, half as wide as tall
  const lw = size / 4;
  const lh = size / 2;
  const NL = 5 * LEAF_VARIANTS;
  const lA = new THREE.WebGLArrayRenderTarget(lw, lh, NL, { ...opts(true), wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  const lH = new THREE.WebGLArrayRenderTarget(lw, lh, NL, opts(false));
  const lT = new THREE.WebGLArrayRenderTarget(lw, lh, NL, opts(false));
  const lN0 = new THREE.WebGLArrayRenderTarget(lw, lh, NL, opts(false));
  const lN = new THREE.WebGLArrayRenderTarget(lw, lh, NL, { ...opts(true), wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  const u3 = { uSize: { value: new THREE.Vector2(lw, lh) }, uOut: { value: 0 }, uSpecies: { value: 0 }, uVar: { value: 0 } };
  const m3 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: LEAF_FS, uniforms: u3, depthTest: false, depthWrite: false });
  for (let sp = 0; sp < 5; sp++)
    for (let v = 0; v < LEAF_VARIANTS; v++) {
      const L = sp * LEAF_VARIANTS + v;
      u3.uSpecies.value = sp;
      u3.uVar.value = v + 0.31 * sp;
      u3.uOut.value = 0;
      draw(m3, lA, L);
      u3.uOut.value = 1;
      draw(m3, lH, L);
      u3.uOut.value = 2;
      draw(m3, lT, L);
    }
  u2.uSize.value = new THREE.Vector2(lw, lh);
  const u2b = { ...u2, uSize: { value: new THREE.Vector2(lw, lh) }, tH: { value: lH.texture as THREE.Texture }, uWrap: { value: 0 }, uRelief: { value: 0.4 } };
  const m2b = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: NORMAL_FS, uniforms: u2b, depthTest: false, depthWrite: false });
  const u4 = { uSize: u2b.uSize, uLayer: { value: 0 }, tN: { value: lN0.texture as THREE.Texture }, tT: { value: lT.texture as THREE.Texture } };
  const m4 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: LEAF_PACK_FS, uniforms: u4, depthTest: false, depthWrite: false });
  for (let L = 0; L < NL; L++) {
    u2b.uLayer.value = L;
    // (a blade 40 mm long on 256 texels: about 0.16 mm a texel along, 0.12 across for a 30 mm wide one)
    u2b.uTexMm.value.set(30 / lw, 40 / lh);
    draw(m2b, lN0, L);
    u4.uLayer.value = L;
    draw(m4, lN, L);
  }
  r.setRenderTarget(prev);
  r.autoClear = prevAuto;
  for (const m of [m1, m2, m2b, m3, m4]) m.dispose();
  geo.dispose();
  bH.dispose();
  lH.dispose();
  lT.dispose();
  lN0.dispose();
  const aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
  bA.texture.anisotropy = bN.texture.anisotropy = aniso;
  lA.texture.anisotropy = lN.texture.anisotropy = Math.min(4, aniso);
  cached = { barkA: bA.texture, barkN: bN.texture, leafA: lA.texture, leafN: lN.texture, barkSize: size, leafSize: [lw, lh] };
  return cached;
}

/** The baked maps, if baked. */
export function treeMaps(): TreeMaps | null {
  return cached;
}
