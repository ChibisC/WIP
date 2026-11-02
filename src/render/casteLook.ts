import * as THREE from 'three';
import { CASTES } from '../sim/species';

/**
 * Each caste's look on its brood tiles and in the UI (user note 2026-11-02: "make every unit tile (both ants and
 * termites and future ones) have different colors and textures so they can be identifiable and different (also their
 * UI color and look for pheromone markers and building so they can be distinct from each other)").
 *
 * A look is a colour from a fixed palette of clearly different earth tones plus a texture worked into the tile. The
 * castes of one species never share a colour or a texture, and no two castes anywhere share both, so a Gene Thief or
 * Termant nest full of stolen castes still tells them apart. Castes without an entry (new species, new castes) are
 * given a free pair the same way, in the order they are defined, so they stay distinct too. Render and UI only.
 */

/**
 * Tile and UI colours (sRGB): earth tones (user note 2026-11-02 12:04: "change their colors to be more earth tone? like
 * around grey, black, brown, sandy, grass green, dead grass, sky blue, and all of the above (earth tone red and purple
 * and orange is fine too)"), spaced so every pair stays clearly apart (ΔE ≥ 24). Replaced the bright palette of 11:04.
 */
export const CASTE_PALETTE = {
  black: 0x34302c,
  grey: 0x908c86,
  slate: 0x52667c,
  brown: 0x7a5232,
  sand: 0xdcc495,
  straw: 0xb09c48,
  grass: 0x6c9a3c,
  moss: 0x485a2c,
  sky: 0x84b0d4,
  red: 0xa8432e,
  orange: 0xcc7a30,
  purple: 0x7a4a72,
} as const;
export type CasteColour = keyof typeof CASTE_PALETTE;

/**
 * Textures worked into the tile, in the order the floor shader numbers them (nestTerrain `castePat`). Natural and
 * insect-made (user note 2026-11-02 11:04: "make the textures look more natural realistic and insect like"): brood
 * pockets, cuticle striations, packed soil pellets, wrinkled (rugose) ridges, overlapping (imbricate) scales, silk
 * fibres, wax comb, a wing-vein network, layered termite carton, rows of cocoons.
 */
export const CASTE_PATTERNS = ['pockets', 'striate', 'pellets', 'rugose', 'scales', 'silk', 'comb', 'veins', 'carton', 'cocoons'] as const;
export type CastePattern = (typeof CASTE_PATTERNS)[number];

const T: Record<string, [CasteColour, CastePattern]> = {
  lasius_worker: ['sand', 'pockets'],
  lasius_soldier: ['black', 'striate'],
  formica_worker: ['red', 'comb'],
  formica_soldier: ['slate', 'scales'],
  formica_mortar: ['straw', 'rugose'],
  formica_rapid: ['sky', 'veins'],
  atta_minim: ['grass', 'pellets'],
  atta_media: ['orange', 'pockets'],
  atta_soldier: ['brown', 'silk'],
  atta_major: ['purple', 'cocoons'],
  fire_minor: ['brown', 'pellets'],
  fire_soldier: ['red', 'scales'],
  fire_major: ['orange', 'veins'],
  eciton_minor: ['moss', 'carton'],
  eciton_submajor: ['straw', 'comb'],
  eciton_media: ['slate', 'striate'],
  eciton_major: ['black', 'silk'],
  plagiaria_worker: ['purple', 'carton'],
  nasute_worker: ['sand', 'carton'],
  nasute_soldier: ['sky', 'pellets'],
  nasute_major: ['orange', 'rugose'],
  rhy_worker: ['grey', 'pockets'],
  rhy_soldier: ['brown', 'striate'],
  hell_worker: ['moss', 'silk'],
  hell_soldier: ['purple', 'scales'],
  aurimyrmex_worker: ['orange', 'carton'],
  aurimyrmex_soldier: ['slate', 'cocoons'],
  termant_worker: ['grey', 'pellets'],
  termant_soldier: ['grass', 'scales'],
};

/** Queens and kings have no brood tiles; their UI look is the royal chamber's pale silt. */
const ROYAL: [CasteColour, CastePattern] = ['grey', 'rugose'];

export interface CasteLook {
  colour: CasteColour;
  pattern: CastePattern;
  /** the floor shader's texture number */
  patternId: number;
  /** sRGB hex, e.g. '#d9a030' */
  css: string;
}

let looks: Map<string, CasteLook> | null = null;

function look(colour: CasteColour, pattern: CastePattern): CasteLook {
  return { colour, pattern, patternId: CASTE_PATTERNS.indexOf(pattern), css: '#' + CASTE_PALETTE[colour].toString(16).padStart(6, '0') };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** True for castes raised on their own brood tiles (not royals, not the queen's nanitic first brood). */
export function hasBroodLook(caste: string): boolean {
  const cd = CASTES[caste];
  return !!cd && cd.role !== 'queen' && cd.role !== 'king' && !cd.nanitic;
}

function build(): Map<string, CasteLook> {
  const m = new Map<string, CasteLook>();
  const used = new Set<string>();
  const bySp = new Map<string, { c: Set<string>; p: Set<string> }>();
  const sp = (s: string) => {
    if (!bySp.has(s)) bySp.set(s, { c: new Set(), p: new Set() });
    return bySp.get(s)!;
  };
  const take = (id: string, c: CasteColour, p: CastePattern) => {
    m.set(id, look(c, p));
    used.add(`${c}|${p}`);
    const s = sp(CASTES[id]?.species ?? '?');
    s.c.add(c);
    s.p.add(p);
  };
  for (const [id, [c, p]] of Object.entries(T)) if (CASTES[id]) take(id, c, p);
  // anything new: the first free pair from a spot set by its name, unlike its own species in colour and texture
  const cols = Object.keys(CASTE_PALETTE) as CasteColour[];
  const n = cols.length * CASTE_PATTERNS.length;
  for (const [id, cd] of Object.entries(CASTES)) {
    if (m.has(id) || !hasBroodLook(id)) continue;
    const s = sp(cd.species);
    const h = hash(id);
    let pick: [CasteColour, CastePattern] | null = null;
    let fallback: [CasteColour, CastePattern] | null = null;
    for (let k = 0; k < n && !pick; k++) {
      const i = (h + k * 37) % n; // 37 is prime to 120: visits every pair
      const c = cols[i % cols.length];
      const p = CASTE_PATTERNS[Math.floor(i / cols.length)];
      if (used.has(`${c}|${p}`)) continue;
      fallback ??= [c, p];
      if (!s.c.has(c) && !s.p.has(p)) pick = [c, p];
    }
    const [c, p] = pick ?? fallback ?? [cols[h % cols.length], CASTE_PATTERNS[h % CASTE_PATTERNS.length]];
    take(id, c, p);
  }
  // nanitics look like the worker they grow into; royals share the royal look
  for (const [id, cd] of Object.entries(CASTES)) {
    if (m.has(id)) continue;
    if (cd.nanitic) {
      const w = Object.keys(CASTES).find((o) => CASTES[o].species === cd.species && hasBroodLook(o) && CASTES[o].role !== 'soldier' && CASTES[o].role !== 'major');
      m.set(id, w && m.get(w) ? m.get(w)! : look(...ROYAL));
    } else m.set(id, look(...ROYAL));
  }
  return m;
}

/** A caste's tile and UI look. Unknown ids get the royal look. */
export function casteLook(caste: string): CasteLook {
  looks ??= build();
  return looks.get(caste) ?? look(...ROYAL);
}

/** Forget the table (tests that add castes at run time). */
export function resetCasteLooks(): void {
  looks = null;
}

/** The caste's colour as a three.js colour (working colour space). */
export function casteColour(caste: string): THREE.Color {
  return new THREE.Color(CASTE_PALETTE[casteLook(caste).colour]);
}

// ---- the textures, as the floor shader draws them (nestTerrain `castePat` mirrors this; keep the two alike)

const fract = (x: number) => x - Math.floor(x);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function h21(x: number, y: number): number {
  let px = fract(x * 123.34);
  let py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy) + (h21(ix + 1, iy) - h21(ix, iy)) * ux;
  const b = h21(ix, iy + 1) + (h21(ix + 1, iy + 1) - h21(ix, iy + 1)) * ux;
  return a + (b - a) * uy;
}
function fbm(x: number, y: number): number {
  let a = 0.5;
  let s = 0;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
/** nearest and second-nearest feature distance, and the nearest cell's random value */
function worley(x: number, y: number): [number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let d1 = 8;
  let d2 = 8;
  let id: [number, number] = [0, 0];
  for (let gy = -1; gy <= 1; gy++)
    for (let gx = -1; gx <= 1; gx++) {
      const ox = h21(ix + gx, iy + gy);
      const oy = h21(ix + gx + 19.7, iy + gy + 19.7);
      const d = Math.hypot(gx + ox - fx, gy + oy - fy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = [ix + gx, iy + gy];
      } else if (d < d2) d2 = d;
    }
  return [d1, d2, h21(id[0], id[1])];
}
/** a band of half-width w round each half period of s, smoothed over fs */
const band = (s: number, w: number, fs: number) => 1 - smooth(w - fs, w + fs, Math.abs(fract(s) - 0.5));

/**
 * One caste texture at a point: u hex-local (hex radius 1), w the floor position in hex radii, pw hex radii per pixel.
 * Returns [groove, ridge] (0–1): pressed-in, darker; raised, lighter.
 */
export function castePatternAt(pid: number, ux: number, uy: number, wx: number, wy: number, pw: number): [number, number] {
  switch (pid) {
    case 0: {
      // brood pockets: round hollows pressed into the plastered floor, a low rim between them
      const [f1, f2] = worley(wx * 2.3 + (vnoise(wx * 1.7, wy * 1.7) - 0.5) * 0.35, wy * 2.3);
      return [smooth(0.46, 0.2, f1), smooth(0.08, 0, f2 - f1) * 0.5];
    }
    case 1: {
      // striate: fine raised striations that flow round the tile, as on an ant's cuticle
      const s = (wx * 0.6 + wy * 0.8) * 4.2 + fbm(wx * 0.7, wy * 0.7) * 2.2;
      const fs = pw * 4.2 * 1.5;
      return [band(s + 0.5, 0.12, fs) * 0.4, band(s, 0.2, fs)];
    }
    case 2: {
      // pellets: packed soil pellets, domed, with dark gaps
      const [f1, f2] = worley(wx * 3.1 + (vnoise(wx * 2.1, wy * 2.1) - 0.5) * 0.3, wy * 3.1);
      return [smooth(0.05, 0, f2 - f1) * 0.6, smooth(0.58, 0, f1)];
    }
    case 3: {
      // rugose: wrinkled ridges round the tile's centre
      const s = Math.hypot(ux, uy) * 3.4 + (vnoise(wx * 2.2, wy * 2.2) - 0.5) * 1.1 + (vnoise(wx * 5, wy * 5) - 0.5) * 0.3;
      const fs = pw * 3.4 * 1.5;
      return [band(s + 0.5, 0.1, fs) * 0.35, band(s, 0.17, fs)];
    }
    case 4: {
      // imbricate scales: rows of rounded scales, each overlapping the row below; dark where one comes out from
      // under the last, a light rim along its free edge
      const px = wx * 2.4;
      const py = wy * 3.0;
      let best = 9;
      for (let r = Math.floor(py) - 1; r <= Math.floor(py) && best > 1; r++) {
        const off = 0.5 * (((r % 2) + 2) % 2);
        const k0 = Math.round(px - off);
        for (let k = k0 - 1; k <= k0 + 1; k++) {
          const vx = px - (k + off);
          const vy = py - r;
          if (vy < 0) continue;
          const d = Math.hypot(vx / 0.72, vy / 1.3);
          if (d < 1 && d < best) best = d;
        }
      }
      if (best > 1) best = 1;
      return [1 - smooth(0, 0.35, best), smooth(0.55, 0.92, best) * (1 - smooth(0.94, 1, best))];
    }
    case 5: {
      // silk: fine fibres crossing in three directions, broken and wandering
      let r = 0;
      for (let i = 0; i < 3; i++) {
        const a = 0.4 + i * 1.1;
        const s = (wx * Math.cos(a) + wy * Math.sin(a)) * 3.4 + fbm(wx * 1.2 + i * 3.1, wy * 1.2) * 2.4;
        r = Math.max(r, band(s, 0.13, pw * 3.4 * 1.5) * smooth(0.25, 0.45, vnoise(wx * 1.4 + i * 7, wy * 1.4)));
      }
      return [0.45 * (1 - r), r];
    }
    case 6: {
      // wax comb: six-sided cells, gently warped, thick raised walls and hollow bottoms
      const qx = wx * 2.8 + (vnoise(wx * 1.8, wy * 1.8) - 0.5) * 0.3;
      const qy = wy * 2.8 + (vnoise(wx * 1.8 + 5, wy * 1.8) - 0.5) * 0.3;
      const sy = 1.7320508;
      const mod = (a: number, m: number) => a - m * Math.floor(a / m);
      const ax = mod(qx, 1) - 0.5;
      const ay = mod(qy, sy) - sy * 0.5;
      const bx = mod(qx - 0.5, 1) - 0.5;
      const by = mod(qy - sy * 0.5, sy) - sy * 0.5;
      const [gx, gy] = ax * ax + ay * ay < bx * bx + by * by ? [ax, ay] : [bx, by];
      const e = 0.5 - Math.max(Math.abs(gx) * 0.5 + Math.abs(gy) * 0.8660254, Math.abs(gx));
      return [smooth(0.12, 0.4, e) * 0.7, 1 - smooth(0.06, 0.12, e)];
    }
    case 7: {
      // veins: a wing's network of raised veins with finer cross-veins, the membrane cells each a little different
      const [a1, a2, az] = worley(wx * 1.5, wy * 1.5);
      const [b1, b2] = worley(wx * 3.6 + 5, wy * 3.6);
      const r = Math.max(1 - smooth(0.04, 0.085, a2 - a1), (1 - smooth(0.02, 0.05, b2 - b1)) * 0.6);
      return [(0.25 + (az - 0.5) * 0.5) * (1 - r), r];
    }
    case 8: {
      // carton: the layered, wavy lamellae of chewed wood and soil a termite builds with
      const s = fbm(wx * 0.8, wy * 0.8) * 5 + wy * 1.2 + (vnoise(wx * 4, wy * 4) - 0.5) * 0.3;
      return [band(s + 0.5, 0.1, 0.05) * 0.6, band(s, 0.22, 0.06)];
    }
    default: {
      // cocoons: oval capsules lying in staggered rows
      const py = wy * 2.6;
      const row = Math.floor(py);
      const px = wx * 1.5 + 0.5 * (((row % 2) + 2) % 2);
      const fx = fract(px) - 0.5;
      const fy = fract(py) - 0.5;
      const dome = 1 - Math.hypot(fx / 0.46, fy / 0.36);
      return [smooth(0.08, -0.05, dome) * 0.8, smooth(0, 0.7, dome)];
    }
  }
}

// ---- UI swatches: a small hex of the tile, its texture drawn by castePatternAt and lit from the upper left

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))))
      .toString(16)
      .padStart(2, '0');
  return '#' + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
}

const swatches = new Map<string, string>();

function hexPoints(c: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => `${(c + Math.cos((Math.PI / 3) * i) * r).toFixed(1)},${(c + Math.sin((Math.PI / 3) * i) * r).toFixed(1)}`).join(' ');
}

/** A hex swatch of the caste's tile as a CSS url() (a canvas image; a plain hex where there is no canvas), single-quoted so it can sit in a double-quoted style attribute. */
export function casteSwatchUrl(caste: string): string {
  const lk = casteLook(caste);
  const key = `${lk.colour}|${lk.pattern}`;
  const have = swatches.get(key);
  if (have) return have;
  let url: string;
  const doc = (globalThis as { document?: Document }).document;
  const cv = doc?.createElement('canvas');
  const g = cv?.getContext?.('2d');
  if (!cv || !g) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><polygon points="${hexPoints(20, 19)}" fill="${lk.css}"/></svg>`;
    url = `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
  } else {
    const N = 64;
    const R = 30;
    cv.width = cv.height = N;
    const img = g.createImageData(N, N);
    const col = CASTE_PALETTE[lk.colour];
    const cr = (col >> 16) & 255;
    const cg = (col >> 8) & 255;
    const cb = col & 255;
    const off = (hash(key) % 1000) / 37;
    const height = (x: number, y: number) => {
      const ux = (x - N / 2) / R;
      const uy = (y - N / 2) / R;
      const [gr, ri] = castePatternAt(lk.patternId, ux, uy, ux + off, uy + off * 0.7, 1 / R);
      return [ri * 0.5 - gr * 0.6, gr, ri];
    };
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5 - N / 2) / R;
        const dy = (y + 0.5 - N / 2) / R;
        // flat-top hex, like the nest's
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        const hd = Math.max(ay, ax * 0.8660254 + ay * 0.5);
        const i = (y * N + x) * 4;
        if (hd > 0.86) continue;
        const [h, gr, ri] = height(x + 0.5, y + 0.5);
        const hx = height(x + 1.5, y + 0.5)[0] - h;
        const hy = height(x + 0.5, y + 1.5)[0] - h;
        const lit = Math.max(0.55, Math.min(1.35, 1 - (hx + hy) * 3.2));
        const k = (1 - gr * 0.45) * (1 + ri * 0.28) * lit * 0.92;
        const rim = hd > 0.8 ? 1.25 : 1;
        img.data[i] = Math.min(255, cr * k * rim);
        img.data[i + 1] = Math.min(255, cg * k * rim);
        img.data[i + 2] = Math.min(255, cb * k * rim);
        img.data[i + 3] = hd > 0.85 ? 170 : 255;
      }
    g.putImageData(img, 0, 0);
    url = `url('${cv.toDataURL()}')`;
  }
  swatches.set(key, url);
  return url;
}

/**
 * The caste's badge for buttons and cards: its tile swatch (colour and texture) with the ant (or termite) on top.
 * `silhouette` is the figure's SVG markup (ui/icons antSilhouette), drawn in `badgeFigure(caste)`.
 */
export function casteBadge(caste: string, silhouette: string, cls = ''): string {
  return `<span class="cbadge${cls ? ' ' + cls : ''}" style="background-image:${casteSwatchUrl(caste)}">${silhouette}</span>`;
}

/** Relative luminance (0–1) of an sRGB colour. */
function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/**
 * The caste's colour where it stands alone on a dark panel (top bar and arena figures, minimap tiles): its colour,
 * lifted a little — dark earth tones (black, moss, slate, purple, brown) lifted more so they still show.
 */
export function casteFigureColour(caste: string): string {
  const css = casteLook(caste).css;
  return shade(css, luma(css) < 0.3 ? 1.45 : 1.18);
}

/** The ant on its badge: dark, like a real ant on its tile; pale on the darkest tiles so it still shows. */
export function badgeFigure(caste: string): string {
  return luma(casteLook(caste).css) < 0.3 ? '#efe4cc' : '#1c130b';
}
