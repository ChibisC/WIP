import * as THREE from 'three';

/**
 * Macro surface detail, baked once on the GPU into tileable texture atlases (realism pass, part B).
 *
 * Every ant or creature part that opts in carries `aDet` (antGeometry `Acc.piece`, creature part meshes):
 *   x  angle around the part / 2π (−1 at a pole), y  distance along it in tile lengths,
 *   z  0..1 along the part (joint shading), w  region + 32 × (tiles around: an integer, so it wraps).
 * A region is a body part with one kind of surface (head, mesosoma, gaster, legs, elytra…). Its tile is a
 * patch of real cuticle (mm across × mm along) baked seamless in both directions, so a part of any size
 * repeats it at the true scale of the sculpture. What is baked (`DetailMaps`):
 *   A  RGB albedo modulation (0.5 = × 1: pits darker, dust in the hollows, mottling), A roughness offset (0.5 = none)
 *   B  RG tangent-space normal (x around, y along), B cavity (1 open … 0 deep pit), A high points (wear)
 * Shading that depends on where a texel sits on the animal (dark joints, a paler underside, translucent thin
 * parts) is done live in the material from `aDet.z` and the region's settings, not baked.
 *
 * Original procedural patterns only (photos were studied for scale and kind of sculpture, never sampled).
 */

/** Regions (atlas cells). */
export const REGION = {
  NONE: 0,
  HEAD: 1,
  MESO: 2,
  WAIST: 3,
  GASTER: 4,
  LEG: 5,
  TARSUS: 6,
  ANTENNA: 7,
  MANDIBLE: 8,
  // creature parts
  ELYTRA: 9,
  PRONOTUM: 10,
  CR_HEAD: 11,
  CR_MAND: 12,
  CR_LEG: 13,
  CR_UNDER: 14,
  CR_ANT: 15,
} as const;
export const REGION_MAX = 16;

/** One region's cuticle: a seamless tile and what is in it. Lengths in mm. */
export interface Sculpt {
  /** tile size (mm): around × along. The pattern repeats this often. */
  tile: [number, number];
  /** fine irregularity of the surface (height, mm) */
  noise: number;
  /**
   * punctures: count per mm², radius (mm), depth (mm); `pale` lightens the rim (hair sockets); `stub` a short
   * appressed hair lying out of each pit (length in mm, direction along the part ±1, share of pits with one)
   */
  pits?: { n: number; r: number; depth: number; pale?: number; stub?: { len: number; dir: number; share: number } };
  /**
   * parallel ridges: count per mm across, depth (mm), angle (rad, 0 = running along the part), waviness 0..1;
   * `sides` 0..1 keeps them to the lower flanks (the mesopleura; needs the tile to wrap the part once: tile
   * around ≈ its girth)
   */
  striae?: { per: number; depth: number; angle: number; wobble: number; sides?: number };
  /** a net of fine ridges (reticulate/areolate): mesh size (mm), ridge height (mm) */
  reticulum?: { cell: number; depth: number };
  /** granules (shagreened, beaded): spacing (mm), height (mm) */
  granules?: { cell: number; height: number };
  /** roughness offset on the flat and in the hollows (−0.5..0.5; 0 = the part's own roughness) */
  rough: [number, number];
  /** dust in the hollows 0..1 */
  dirt: number;
  /** soft colour mottling 0..1 */
  mottle: number;
  /** darkening in pits and grooves 0..1 */
  cavityDark: number;
  /** broad undulation of the surface ("orange peel"), so highlights are never perfect: cell (mm), height (mm) */
  wave?: { cell: number; amp: number };
  /** patchy roughness (greasier and duller patches) ± this much */
  roughVar?: number;
}

/** How a region is shaded live (not baked). */
export interface RegionShade {
  /** strength of the baked relief 0..2 */
  normal: number;
  /** darkening toward the part's ends (joints, sutures) 0..1 */
  joint: number;
  /** paler/darker underside for lofted body parts (−1..1; + darker below) */
  ventral: number;
  /** translucency of thin parts and soft cuticle 0..1 */
  thick: number;
  /** clearcoat kept in the hollows 0..1 */
  coatInPits: number;
  /** clearcoat roughness (0 = the material's own) */
  coatRough?: number;
  /** worn high points and convex edges: lighter and smoother 0..1 */
  wear?: number;
  /** dust: on the underside, low parts and in the hollows 0..1 */
  dust?: number;
  /** lighter toward the middle of each segment, darker toward its ends (beyond `joint`) 0..1 */
  mid?: number;
  /** thinner (more translucent) toward the far end of the part 0..1 */
  tipThin?: number;
  /** how far the clearcoat follows the relief (1: fully) */
  coatFollow?: number;
  /**
   * sutures and plate margins across the part, at up to four places 0..1 along it: a thin dark seam with a
   * pale, thin (translucent) margin just before it — the overlapping gaster tergites, the promesonotal suture
   */
  bands?: number[];
  /** band look: seam width (0..1 along), seam darkness 0..1, margin paleness 0..1, margin width (0..1 along) */
  band?: [number, number, number, number];
}

export interface DetailRecipe {
  key: string;
  regions: Partial<Record<number, { sculpt: Sculpt; shade: RegionShade; px: [number, number] }>>;
}

export interface DetailMaps {
  key: string;
  a: THREE.Texture;
  b: THREE.Texture;
  /** per region: atlas rect (u0, v0, du, dv) of the tile's interior */
  rects: THREE.Vector4[];
  /** per region: shading (normal, joint, ventral, thick) */
  shade: THREE.Vector4[];
  /** per region: coat in pits, coat roughness, wear, dust */
  shade2: THREE.Vector4[];
  /** per region: mid-segment lightening, tip thinning, coat follows relief, spare */
  shade3: THREE.Vector4[];
  /** per region: band positions along the part (0 = none), and the band look */
  bands: THREE.Vector4[];
  band: THREE.Vector4[];
  /** tile size per region (mm), to turn part sizes into tile counts */
  tiles: Array<[number, number]>;
}

let bakeRenderer: THREE.WebGLRenderer | null = null;
/** 0 low (half-size atlases), 1 full */
let bakeQuality = 1;

/** The renderer that bakes atlases (set once by the view or a lab). */
export function setBakeRenderer(r: THREE.WebGLRenderer | null, quality = 1): void {
  bakeRenderer = r;
  bakeQuality = quality;
}

const cache = new Map<string, DetailMaps>();

/** Gutter around each tile (px): the next repeat of the tile, so filtering and the first mips never bleed. */
const GUTTER = 16;

const BAKE_VS = /* glsl */ `
precision highp float;
precision highp int;
in vec3 position;
out vec2 vPx;
uniform vec2 uSize;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vPx = p * uSize;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BAKE_FS = /* glsl */ `
precision highp float;
in vec2 vPx;
out vec4 outColor;
uniform int uOut;
uniform vec4 uCell[${REGION_MAX}];     // px rect of the whole cell (x, y, w, h) incl. gutter
uniform vec4 uTile[${REGION_MAX}];     // tile mm (around, along), noise, seed
uniform vec4 uPits[${REGION_MAX}];     // n/mm², r, depth, pale
uniform vec4 uStri[${REGION_MAX}];     // per mm, depth, angle, wobble
uniform vec4 uRet[${REGION_MAX}];      // reticulum cell, depth, granule cell, granule height
uniform vec4 uMix[${REGION_MAX}];      // rough flat, rough hollow, dirt, mottle
uniform vec4 uMix2[${REGION_MAX}];     // cavity dark, relief amplitude (mm), patchy roughness, spare
uniform vec4 uWave[${REGION_MAX}];     // undulation cell (mm), height (mm), striae on the flanks only 0..1, spare
uniform vec4 uStub[${REGION_MAX}];     // pit hairs: length (mm), direction ±1, share 0..1, spare
uniform int uCount;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float a = h21(p); return vec2(a, h21(p + a * 17.13)); }

// periodic value noise on a grid of n cells per tile (n integer → seamless)
float pnoise(vec2 q, vec2 n, float seed) {
  vec2 i = floor(q); vec2 f = fract(q); f = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, n), i1 = mod(i + 1.0, n);
  float a = h21(vec2(i0.x, i0.y) + seed), b = h21(vec2(i1.x, i0.y) + seed);
  float c = h21(vec2(i0.x, i1.y) + seed), d = h21(vec2(i1.x, i1.y) + seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// periodic Worley: nearest and second-nearest feature distance (in cells) and the nearest point's hash
vec3 pworley(vec2 q, vec2 n, float seed) {
  vec2 i = floor(q); vec2 f = fract(q);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = mod(i + g, n);
    vec2 o = h22(c + seed);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = h21(c + seed + 3.7); } else if (d < d2) d2 = d;
  }
  return vec3(d1, d2, id);
}

// periodic Worley with the nearest feature's offset (cells) and hash: (d1, id, dx, dy)
vec4 pworley2(vec2 q, vec2 n, float seed) {
  vec2 i = floor(q); vec2 f = fract(q);
  float d1 = 9.0, id = 0.0; vec2 off = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = mod(i + g, n);
    vec2 o = h22(c + seed);
    vec2 r = g + o - f;
    float d = length(r);
    if (d < d1) { d1 = d; id = h21(c + seed + 3.7); off = -r; }
  }
  return vec4(d1, id, off);
}

struct S { float h; float cav; float pale; float mot; float rv; float hair; };

// The relief (mm) at a point of region r, tile coordinates p (mm around, mm along).
S surf(int r, vec2 p) {
  vec4 T = uTile[r]; vec4 P = uPits[r]; vec4 St = uStri[r]; vec4 R = uRet[r]; vec4 M = uMix[r];
  vec2 tile = T.xy; float seed = T.w;
  S s; s.h = 0.0; s.cav = 0.0; s.pale = 0.0; s.mot = 0.0; s.rv = 0.0; s.hair = 0.0;
  vec4 Wv = uWave[r];
  // fine irregularity: two octaves, ~0.02 and ~0.008 mm
  vec2 n1 = max(vec2(1.0), floor(tile / 0.02 + 0.5));
  vec2 n2 = max(vec2(1.0), floor(tile / 0.008 + 0.5));
  s.h += T.z * ((pnoise(p / tile * n1, n1, seed) - 0.5) + 0.5 * (pnoise(p / tile * n2, n2, seed + 9.1) - 0.5));
  // soft mottling (~0.15 mm)
  vec2 nm = max(vec2(1.0), floor(tile / 0.15 + 0.5));
  s.mot = pnoise(p / tile * nm, nm, seed + 31.0) - 0.5;
  // patchy roughness (~0.25 of the tile)
  vec2 nrv = max(vec2(1.0), floor(tile / (tile * 0.22) + 0.5));
  s.rv = pnoise(p / tile * nrv, nrv, seed + 41.0) - 0.5;
  // broad undulation: two octaves, so the highlight wanders and breaks
  if (Wv.x > 0.0) {
    vec2 nw1 = max(vec2(1.0), floor(tile / Wv.x + 0.5));
    vec2 nw2 = max(vec2(1.0), floor(tile / (Wv.x * 0.45) + 0.5));
    s.h += Wv.y * ((pnoise(p / tile * nw1, nw1, seed + 51.0) - 0.5) + 0.45 * (pnoise(p / tile * nw2, nw2, seed + 57.0) - 0.5));
  }
  // striae: ridges at an angle; the period is snapped so the tile stays seamless
  if (St.x > 0.0) {
    vec2 dir = vec2(sin(St.z), cos(St.z)); // 0 rad: lines run along the part (vary around it)
    vec2 nrm = vec2(dir.y, -dir.x);
    // count of ridges across the tile along each axis, rounded to keep it periodic
    float k1 = floor(tile.x * St.x * abs(nrm.x) + 0.5), k2 = floor(tile.y * St.x * abs(nrm.y) + 0.5);
    float phase = (k1 * sign(nrm.x)) * p.x / tile.x + (k2 * sign(nrm.y)) * p.y / tile.y;
    vec2 nw = max(vec2(1.0), floor(tile / 0.12 + 0.5));
    phase += St.w * (pnoise(p / tile * nw, nw, seed + 5.0) - 0.5) * 1.5;
    float ridge = 1.0 - abs(fract(phase) * 2.0 - 1.0);
    ridge = smoothstep(0.0, 1.0, ridge);
    // on the flanks only: the tile wraps the part once (u 0 and .5 are the sides, .25 the top, .75 below)
    float u = fract(p.x / tile.x);
    // the lower flanks: below each side (u 0 and .5), toward the underside (.75)
    float side = smoothstep(0.1, 0.04, min(abs(u - 0.9), abs(u - 0.6)));
    float bandK = mix(1.0, side, Wv.z);
    s.h += St.y * (ridge - 0.5) * bandK;
    s.cav = max(s.cav, smoothstep(0.35, 0.0, ridge) * 0.7 * bandK);
  }
  // reticulum: a net of fine ridges along the cell borders
  if (R.x > 0.0) {
    vec2 nr = max(vec2(1.0), floor(tile / R.x + 0.5));
    vec3 w = pworley(p / tile * nr, nr, seed + 11.0);
    float edge = 1.0 - smoothstep(0.0, 0.16, w.y - w.x);
    s.h += R.y * (edge - 0.3);
    s.cav = max(s.cav, smoothstep(0.25, 0.9, w.x) * 0.45);
  }
  // granules
  if (R.z > 0.0) {
    vec2 ng = max(vec2(1.0), floor(tile / R.z + 0.5));
    vec3 w = pworley(p / tile * ng, ng, seed + 17.0);
    float bump = smoothstep(0.6, 0.0, w.x);
    s.h += R.w * bump;
    s.cav = max(s.cav, smoothstep(0.45, 0.75, w.x) * 0.35);
  }
  // punctures: one possible pit per cell of 1/sqrt(n) mm
  if (P.x > 0.0) {
    float cell = inversesqrt(P.x);
    vec2 np = max(vec2(1.0), floor(tile / cell + 0.5));
    vec4 w = pworley2(p / tile * np, np, seed + 23.0);
    vec2 csz = tile / np;                                 // mm per cell
    float rr = P.y / csz.x * (0.75 + 0.5 * w.y);           // radius in cells
    // a rounded, shallow bowl (foveola) rather than a drilled hole
    float pit = smoothstep(rr, rr * 0.1, w.x);
    pit = pit * pit * (3.0 - 2.0 * pit);
    s.h -= P.z * pit;
    s.cav = max(s.cav, pit * 0.85);
    s.pale = max(s.pale, P.w * smoothstep(rr * 1.7, rr * 1.05, w.x) * (1.0 - pit));
    // the hair lying out of the pit: a tapering streak along the part from the pit's centre
    vec4 Sb = uStub[r];
    if (Sb.x > 0.0 && w.y < Sb.z) {
      vec2 mm = w.zw * csz;                                // from the pit centre (mm)
      float a = (fract(w.y * 7.31) - 0.5) * 0.7;           // a little off the axis
      vec2 dir = vec2(sin(a), cos(a)) * Sb.y;
      float along = dot(mm, dir);
      float acrossD = abs(dot(mm, vec2(dir.y, -dir.x)));
      float len = Sb.x * (0.6 + 0.6 * fract(w.y * 13.7));
      float t01 = along / len;
      float width = P.y * 0.28 * (1.0 - 0.8 * clamp(t01, 0.0, 1.0));
      float hm = step(0.0, t01) * (1.0 - smoothstep(0.85, 1.0, t01)) * smoothstep(width, width * 0.35, acrossD);
      s.hair = max(s.hair, hm);
      s.h += P.z * 0.45 * hm;
      s.cav *= 1.0 - hm;
    }
  }
  return s;
}

void main() {
  // which cell, and where in its tile
  int r = 0; vec4 C = vec4(0.0);
  for (int i = 0; i < ${REGION_MAX}; i++) {
    if (i >= uCount) break;
    vec4 c = uCell[i];
    if (c.z > 0.0 && vPx.x >= c.x && vPx.y >= c.y && vPx.x < c.x + c.z && vPx.y < c.y + c.w) { r = i; C = c; }
  }
  if (C.z <= 0.0) { outColor = uOut == 0 ? vec4(0.5, 0.5, 0.5, 0.5) : vec4(0.5, 0.5, 1.0, 1.0); return; }
  vec2 tile = uTile[r].xy;
  float g = ${GUTTER.toFixed(1)};
  vec2 inner = C.zw - 2.0 * g;
  vec2 t01 = (vPx - C.xy - g) / inner;          // 0..1 over the tile (beyond in the gutter: the next repeat)
  vec2 p = t01 * tile;                          // mm
  S s = surf(r, p);
  vec4 Mx = uMix[r];
  if (uOut == 0) {
    float cav = s.cav;
    float dark = 1.0 - uMix2[r].x * cav;
    vec3 alb = vec3(dark) * (1.0 + Mx.w * s.mot * 0.6) + vec3(0.10, 0.08, 0.05) * s.pale;
    // pit hairs: pale golden
    alb = mix(alb, vec3(1.45, 1.3, 1.0), s.hair * 0.7);
    // dust settles in the hollows: a dull grey-brown that also roughens
    alb = mix(alb, vec3(1.25, 1.12, 0.95), Mx.z * cav * 0.55);
    float rough = mix(Mx.x, Mx.y, cav) + Mx.z * cav * 0.15 + uMix2[r].z * s.rv * 2.0 + 0.1 * s.hair;
    outColor = vec4(clamp(alb * 0.5, 0.0, 1.0), clamp(0.5 + rough, 0.0, 1.0));
  } else {
    // normal from the height's slope over one texel (mm per texel in each direction)
    vec2 e = tile / inner;
    float hx = surf(r, p + vec2(e.x, 0.0)).h - surf(r, p - vec2(e.x, 0.0)).h;
    float hy = surf(r, p + vec2(0.0, e.y)).h - surf(r, p - vec2(0.0, e.y)).h;
    vec3 n = normalize(vec3(-hx / (2.0 * e.x), -hy / (2.0 * e.y), 1.0));
    // high points (worn lighter and smoother): the relief above its mean, against the region's amplitude
    float hn = s.h / max(uMix2[r].y, 1e-6);
    float wear = smoothstep(0.08, 0.4, hn) * (1.0 - s.cav);
    outColor = vec4(n.xy * 0.5 + 0.5, 1.0 - s.cav, clamp(wear, 0.0, 1.0));
  }
}`;

/** Pack the regions into an atlas (shelf packing, widest first) and return each cell's px rect. */
function pack(recipe: DetailRecipe, scale: number): { w: number; h: number; cells: Map<number, [number, number, number, number]> } {
  const items = Object.entries(recipe.regions)
    .map(([k, v]) => ({ r: Number(k), w: Math.max(32, Math.round(v!.px[0] * scale)) + 2 * GUTTER, h: Math.max(32, Math.round(v!.px[1] * scale)) + 2 * GUTTER }))
    .sort((a, b) => b.h - a.h || b.w - a.w);
  const W = Math.min(4096, Math.max(512, 2 ** Math.ceil(Math.log2(Math.sqrt(items.reduce((s, i) => s + i.w * i.h, 0)) * 1.25))));
  const cells = new Map<number, [number, number, number, number]>();
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const it of items) {
    if (x + it.w > W) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    cells.set(it.r, [x, y, it.w, it.h]);
    x += it.w;
    shelf = Math.max(shelf, it.h);
  }
  const H = 2 ** Math.ceil(Math.log2(Math.max(64, y + shelf)));
  return { w: W, h: H, cells };
}

/** Bake (once per key) the atlas for a recipe; null when there is no renderer to bake with. */
export function bakeDetail(recipe: DetailRecipe): DetailMaps | null {
  const hit = cache.get(recipe.key);
  if (hit) return hit;
  const r = bakeRenderer;
  if (!r) return null;
  const scale = bakeQuality >= 1 ? 1 : 0.5;
  const { w, h, cells } = pack(recipe, scale);
  const u = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
  const uniforms = {
    uOut: { value: 0 },
    uSize: { value: new THREE.Vector2(w, h) },
    uCell: { value: u(REGION_MAX) },
    uTile: { value: u(REGION_MAX) },
    uPits: { value: u(REGION_MAX) },
    uStri: { value: u(REGION_MAX) },
    uRet: { value: u(REGION_MAX) },
    uMix: { value: u(REGION_MAX) },
    uMix2: { value: u(REGION_MAX) },
    uWave: { value: u(REGION_MAX) },
    uStub: { value: u(REGION_MAX) },
    uCount: { value: REGION_MAX },
  };
  const rects = u(REGION_MAX);
  const shade = u(REGION_MAX);
  const shade2 = u(REGION_MAX);
  const shade3 = u(REGION_MAX);
  const bands = u(REGION_MAX);
  const band = u(REGION_MAX);
  const tiles: Array<[number, number]> = Array.from({ length: REGION_MAX }, () => [1, 1]);
  for (const [k, v] of Object.entries(recipe.regions)) {
    const i = Number(k);
    const c = cells.get(i)!;
    const s = v!.sculpt;
    uniforms.uCell.value[i].set(c[0], c[1], c[2], c[3]);
    uniforms.uTile.value[i].set(s.tile[0], s.tile[1], s.noise, i * 7.31 + recipe.key.length);
    if (s.pits) uniforms.uPits.value[i].set(s.pits.n, s.pits.r, s.pits.depth, s.pits.pale ?? 0);
    if (s.striae) uniforms.uStri.value[i].set(s.striae.per, s.striae.depth, s.striae.angle, s.striae.wobble);
    uniforms.uRet.value[i].set(s.reticulum?.cell ?? 0, s.reticulum?.depth ?? 0, s.granules?.cell ?? 0, s.granules?.height ?? 0);
    uniforms.uMix.value[i].set(s.rough[0], s.rough[1], s.dirt, s.mottle);
    const amp = s.noise * 0.75 + (s.pits?.depth ?? 0) + (s.striae?.depth ?? 0) * 0.5 + (s.reticulum?.depth ?? 0) * 0.7 + (s.granules?.height ?? 0) + (s.wave?.amp ?? 0) * 0.7;
    uniforms.uMix2.value[i].set(s.cavityDark, Math.max(1e-6, amp), s.roughVar ?? 0, 0);
    uniforms.uWave.value[i].set(s.wave?.cell ?? 0, s.wave?.amp ?? 0, s.striae?.sides ?? 0, 0);
    const st = s.pits?.stub;
    uniforms.uStub.value[i].set(st?.len ?? 0, st?.dir ?? 1, st?.share ?? 0, 0);
    // the tile's interior in atlas uv (y up: the render target's rows grow upward like vPx)
    rects[i].set((c[0] + GUTTER) / w, (c[1] + GUTTER) / h, (c[2] - 2 * GUTTER) / w, (c[3] - 2 * GUTTER) / h);
    shade[i].set(v!.shade.normal, v!.shade.joint, v!.shade.ventral, v!.shade.thick);
    const sh = v!.shade;
    shade2[i].set(sh.coatInPits, sh.coatRough ?? 0, sh.wear ?? 0, sh.dust ?? 0);
    shade3[i].set(sh.mid ?? 0, sh.tipThin ?? 0, sh.coatFollow ?? 0.85, 0);
    const bp = sh.bands ?? [];
    bands[i].set(bp[0] ?? 0, bp[1] ?? 0, bp[2] ?? 0, bp[3] ?? 0);
    band[i].set(...(sh.band ?? [0.012, 0.6, 0.5, 0.05]));
    tiles[i] = [s.tile[0], s.tile[1]];
  }
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BAKE_VS, fragmentShader: BAKE_FS, uniforms, depthTest: false, depthWrite: false });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const tri = new THREE.Mesh(geo, mat);
  tri.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(tri);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = () =>
    new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
  const ta = target();
  const tb = target();
  const prev = r.getRenderTarget();
  const prevAuto = r.autoClear;
  const prevXr = r.xr.enabled;
  r.xr.enabled = false;
  r.autoClear = true;
  uniforms.uOut.value = 0;
  r.setRenderTarget(ta);
  r.render(scene, cam);
  uniforms.uOut.value = 1;
  r.setRenderTarget(tb);
  r.render(scene, cam);
  r.setRenderTarget(prev);
  r.autoClear = prevAuto;
  r.xr.enabled = prevXr;
  mat.dispose();
  geo.dispose();
  ta.texture.anisotropy = tb.texture.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
  const maps: DetailMaps = { key: recipe.key, a: ta.texture, b: tb.texture, rects, shade, shade2, shade3, bands, band, tiles };
  cache.set(recipe.key, maps);
  return maps;
}

/** Bytes of GPU memory the atlases baked so far take (with mips), for the budget in docs/realism. */
export function detailMemory(): number {
  let n = 0;
  for (const m of cache.values()) {
    const img = (m.a as unknown as { image: { width: number; height: number } }).image;
    n += img.width * img.height * 4 * 2 * (4 / 3);
  }
  return n;
}
