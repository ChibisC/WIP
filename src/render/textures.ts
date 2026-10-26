import * as THREE from 'three';
import { Rng } from '../core/rng';

/**
 * Procedural texture generation on canvases. All textures are tileable and
 * generated once at startup; nothing is downloaded.
 */

function hashP(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise: tiles every `period` units. */
function pnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const m = (v: number) => ((v % period) + period) % period;
  const a = hashP(m(xi), m(yi), seed);
  const b = hashP(m(xi + 1), m(yi), seed);
  const c = hashP(m(xi), m(yi + 1), seed);
  const d = hashP(m(xi + 1), m(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function pfbm(x: number, y: number, period: number, oct: number, seed: number): number {
  let s = 0;
  let a = 0.5;
  let n = 0;
  let p = period;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * pnoise(x * f, y * f, p, seed + i * 31);
    n += a;
    a *= 0.5;
    f *= 2;
    p *= 2;
  }
  return s / n;
}

/** Periodic Worley distance (F1, F2) in cell units, plus a hash of the nearest feature's cell. */
function pworley(x: number, y: number, period: number, seed: number): [number, number, number] {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const mx = ((cx % period) + period) % period;
      const my = ((cy % period) + period) % period;
      const px = cx + hashP(mx, my, seed);
      const py = cy + hashP(mx, my, seed + 7);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hashP(mx, my, seed + 13);
      } else if (d < f2) f2 = d;
    }
  return [f1, f2, id];
}

export interface TexPair {
  map: THREE.Texture;
  normal: THREE.Texture;
  height: Float32Array;
  size: number;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function finishTex(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Normal map (tangent space) from a tileable height array. */
export function normalFromHeight(h: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy; // canvas y is down; three uses OpenGL convention (+y up in tangent space)
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const k = (y * size + x) * 4;
      img.data[k] = (nx * 0.5 + 0.5) * 255;
      img.data[k + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[k + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return finishTex(c, false);
}

type ColorFn = (x: number, y: number, u: number, v: number) => [number, number, number, number]; // rgb 0..1, height 0..1

function genPair(size: number, fn: ColorFn, normalStrength: number): TexPair {
  // DataTexture (not canvas) so the height can live in alpha without premultiplication loss.
  const data = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b, hh] = fn(x, y, x / size, y / size);
      const k = (y * size + x) * 4;
      data[k] = Math.max(0, Math.min(255, r * 255));
      data[k + 1] = Math.max(0, Math.min(255, g * 255));
      data[k + 2] = Math.max(0, Math.min(255, b * 255));
      data[k + 3] = Math.max(0, Math.min(255, hh * 255));
      height[y * size + x] = hh;
    }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.generateMipmaps = true;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.needsUpdate = true;
  return { map, normal: normalFromHeight(height, size, normalStrength), height, size };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const sat = (v: number) => Math.max(0, Math.min(1, v));
const sstep = (a: number, b: number, v: number) => {
  const t = sat((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Crumbly brown topsoil with grains and tiny pebbles. One tile ≈ 64 mm. */
export function soilTexture(size = 512): TexPair {
  const P = 8;
  return genPair(
    size,
    (x, y, u, v) => {
      const n = pfbm(u * P, v * P, P, 5, 11);
      const fine = pnoise(u * 128, v * 128, 128, 3);
      const crumbs = pfbm(u * 32, v * 32, 32, 3, 5);
      const [f1, f2, gid] = pworley(u * 24, v * 24, 24, 9);
      const grain = sstep(0.3, 0.16, f1) * (gid > 0.8 ? 1 : 0);
      const edge = sstep(0.0, 0.08, f2 - f1);
      const dark = 0.75 + 0.5 * n;
      let r = 0.33 * dark;
      let g = 0.24 * dark;
      let b = 0.16 * dark;
      const cr = sstep(0.55, 0.7, crumbs);
      r = mix(r, 0.22, cr * 0.6);
      g = mix(g, 0.15, cr * 0.6);
      b = mix(b, 0.1, cr * 0.6);
      // pale sand grains / tiny pebbles
      const pc = (gid * 7.31) % 1;
      r = mix(r, 0.36 + pc * 0.16, grain * 0.75);
      g = mix(g, 0.31 + pc * 0.12, grain * 0.75);
      b = mix(b, 0.25 + pc * 0.08, grain * 0.75);
      const fv = 0.88 + fine * 0.24;
      const h = n * 0.35 + crumbs * 0.25 + grain * 0.4 * edge + fine * 0.1;
      return [r * fv, g * fv, b * fv, Math.min(1, h)];
    },
    3.2,
  );
}

/** Green-gold moss and fine grass litter. */
export function mossTexture(size = 512): TexPair {
  const P = 8;
  return genPair(
    size,
    (x, y, u, v) => {
      const n = pfbm(u * P, v * P, P, 4, 21);
      const [f1] = pworley(u * 64, v * 64, 64, 23);
      const tuft = sstep(0.55, 0.0, f1);
      const fine = pnoise(u * 200, v * 200, 200, 25);
      const dry = sstep(0.55, 0.75, pfbm(u * 4, v * 4, 4, 3, 27));
      let r = mix(0.13, 0.3, dry);
      let g = mix(0.22, 0.29, dry);
      let b = mix(0.06, 0.11, dry);
      const k = 0.45 + tuft * 0.7 + n * 0.3;
      r *= k;
      g *= k;
      b *= k;
      const f = 0.85 + fine * 0.3;
      return [r * f, g * f, b * f, Math.min(1, 0.25 + tuft * 0.55 + n * 0.25 + fine * 0.08)];
    },
    4,
  );
}

/** Coarse pale sand. */
export function sandTexture(size = 512): TexPair {
  const P = 8;
  return genPair(
    size,
    (x, y, u, v) => {
      const n = pfbm(u * P, v * P, P, 4, 31);
      const [f1, f2, sid] = pworley(u * 90, v * 90, 90, 33);
      const g1 = sstep(0.45, 0.05, f1);
      const c = sid;
      const ripple = Math.sin((u * 6 + pfbm(u * 2, v * 2, 2, 2, 35) * 2) * Math.PI * 2) * 0.5 + 0.5;
      let r = 0.5 + c * 0.14 - (1 - g1) * 0.14;
      let g = 0.42 + c * 0.11 - (1 - g1) * 0.13;
      let b = 0.31 + c * 0.08 - (1 - g1) * 0.1;
      const dark = c > 0.93 ? 0.45 : 1;
      r *= dark * (0.92 + n * 0.16);
      g *= dark * (0.92 + n * 0.16);
      b *= dark * (0.92 + n * 0.16);
      return [r, g, b, Math.min(1, g1 * 0.45 + n * 0.2 + ripple * 0.1 + (f2 - f1) * 0.08)];
    },
    3,
  );
}

/** Leaf litter: decayed leaf fragments over dark humus. */
export function litterTexture(size = 512): TexPair {
  const P = 8;
  const rng = new Rng(77);
  const frags: Array<[number, number, number, number, number, number]> = [];
  for (let i = 0; i < 48; i++) frags.push([rng.next(), rng.next(), rng.range(0.015, 0.06), rng.range(0, Math.PI), rng.next(), rng.range(0.3, 0.7)]);
  return genPair(
    size,
    (x, y, u, v) => {
      const n = pfbm(u * P, v * P, P, 5, 41);
      let r = 0.13 + n * 0.1;
      let g = 0.09 + n * 0.07;
      let b = 0.055 + n * 0.04;
      let h = n * 0.35;
      for (const [fx, fy, fr, fa, fc, fe] of frags) {
        let dx = u - fx;
        let dy = v - fy;
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const lx = dx * Math.cos(fa) + dy * Math.sin(fa);
        const ly = -dx * Math.sin(fa) + dy * Math.cos(fa);
        const d = Math.hypot(lx / fr, ly / (fr * fe));
        if (d < 1) {
          const vein = Math.abs(ly) < fr * 0.03 ? 0.75 : 1;
          const jag = pnoise(u * 300, v * 300, 300, 43);
          if (d < 0.85 + jag * 0.15) {
            const tone = 0.7 + fc * 0.5;
            r = mix(0.26, 0.42, fc) * tone * vein;
            g = mix(0.17, 0.27, fc) * tone * vein;
            b = mix(0.09, 0.13, fc) * tone * vein;
            h = 0.55 + (1 - d) * 0.2;
          }
        }
      }
      const fine = 0.9 + pnoise(u * 160, v * 160, 160, 45) * 0.2;
      return [r * fine, g * fine, b * fine, h];
    },
    3,
  );
}

/** Bark: vertical fissures with lichen speckles. u runs around, v along the twig. */
export function barkTexture(size = 512): TexPair {
  return genPair(
    size,
    (x, y, u, v) => {
      const warp = pfbm(u * 4, v * 2, 4, 3, 51) * 0.9;
      const ridge = Math.abs(Math.sin((u * 10 + warp) * Math.PI));
      const cross = sstep(0.06, 0.0, Math.abs(pfbm(u * 6, v * 24, 6, 2, 57) - 0.5)) * 0.6;
      const fiss = Math.pow(ridge, 0.35) * (1 - cross);
      const n = pfbm(u * 8, v * 16, 8, 4, 53) * 0.7 + pnoise(u * 64, v * 128, 64, 59) * 0.3;
      let r = 0.27 * (0.6 + fiss * 0.5) * (0.8 + n * 0.4);
      let g = 0.2 * (0.6 + fiss * 0.5) * (0.8 + n * 0.4);
      let b = 0.14 * (0.6 + fiss * 0.5) * (0.8 + n * 0.4);
      const lich = sstep(0.66, 0.72, pfbm(u * 6 + 3, v * 6, 6, 3, 55));
      r = mix(r, 0.52, lich * 0.7);
      g = mix(g, 0.56, lich * 0.7);
      b = mix(b, 0.42, lich * 0.7);
      return [r, g, b, fiss * 0.7 + n * 0.3 + lich * 0.2];
    },
    5,
  );
}

/** Speckled granite/flint-like stone. */
export function stoneTexture(size = 256): TexPair {
  return genPair(
    size,
    (x, y, u, v) => {
      const n = pfbm(u * 4, v * 4, 4, 5, 61);
      const s = pnoise(u * 128, v * 128, 128, 63);
      const [f1, f2] = pworley(u * 10, v * 10, 10, 65);
      const crack = sstep(0.04, 0.0, f2 - f1) * 0.5;
      const base = 0.42 + n * 0.25;
      const sp = s > 0.86 ? 0.12 : s < 0.12 ? -0.1 : 0;
      return [base + sp - crack * 0.2, base * 0.95 + sp - crack * 0.2, base * 0.88 + sp - crack * 0.2, n * 0.6 + s * 0.2 - crack];
    },
    2.5,
  );
}

export interface LeafAtlas {
  map: THREE.Texture;
  normal: THREE.Texture;
  cols: number;
  rows: number;
}

/**
 * Atlas of fallen leaves (oak, beech, maple-ish, decaying), each cell a leaf
 * drawn on a transparent background with midrib and lateral veins.
 * Leaf geometry is cut to the outline so alpha is only a safety margin.
 */
export function leafAtlas(): LeafAtlas {
  const cols = 4;
  const rows = 2;
  const cell = 256;
  const c = document.createElement('canvas');
  c.width = cols * cell;
  c.height = rows * cell;
  const ctx = c.getContext('2d')!;
  const hc = document.createElement('canvas');
  hc.width = c.width;
  hc.height = c.height;
  const hctx = hc.getContext('2d')!;
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, hc.width, hc.height);
  const palettes = [
    ['#7a4a1f', '#a8672a', '#5a3214'],
    ['#9c6b2e', '#c4913f', '#6b4318'],
    ['#6d3b1c', '#8f4f25', '#4a2610'],
    ['#8a7a32', '#b0a04a', '#5e5020'],
    ['#5b3a22', '#7c5432', '#3c2414'],
    ['#a35a24', '#d07a32', '#713b14'],
    ['#7c6a3a', '#a08850', '#544424'],
    ['#4e5a26', '#6f7a36', '#353d18'],
  ];
  const rng = new Rng(901);
  for (let i = 0; i < cols * rows; i++) {
    const ox = (i % cols) * cell;
    const oy = Math.floor(i / cols) * cell;
    const [base, light, dark] = palettes[i];
    ctx.save();
    ctx.translate(ox + cell / 2, oy + cell / 2);
    // Leaf body as an ellipse gradient; outline clipping is done by geometry.
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, cell * 0.55);
    g.addColorStop(0, light);
    g.addColorStop(0.6, base);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.fillRect(-cell / 2, -cell / 2, cell, cell);
    // Blotches of decay
    for (let k = 0; k < 40; k++) {
      ctx.globalAlpha = rng.range(0.05, 0.25);
      ctx.fillStyle = rng.chance(0.5) ? dark : '#2a1a0c';
      ctx.beginPath();
      ctx.ellipse(rng.range(-110, 110), rng.range(-110, 110), rng.range(3, 22), rng.range(3, 14), rng.range(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Veins: midrib along y, laterals angled toward the tip.
    ctx.strokeStyle = 'rgba(40,24,10,0.55)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, cell * 0.48);
    ctx.lineTo(0, -cell * 0.48);
    ctx.stroke();
    hctx.save();
    hctx.translate(ox + cell / 2, oy + cell / 2);
    hctx.strokeStyle = '#d0d0d0';
    hctx.lineWidth = 6;
    hctx.beginPath();
    hctx.moveTo(0, cell * 0.48);
    hctx.lineTo(0, -cell * 0.48);
    hctx.stroke();
    const n = 7 + (i % 3);
    for (let k = 0; k < n; k++) {
      const yv = cell * 0.4 - (k / n) * cell * 0.8;
      for (const side of [-1, 1]) {
        const len = cell * 0.42 * Math.sin(((k + 0.7) / (n + 0.5)) * Math.PI);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(40,24,10,0.4)';
        ctx.beginPath();
        ctx.moveTo(0, yv);
        ctx.quadraticCurveTo(side * len * 0.5, yv - len * 0.25, side * len, yv - len * 0.55);
        ctx.stroke();
        hctx.lineWidth = 3;
        hctx.strokeStyle = '#b0b0b0';
        hctx.beginPath();
        hctx.moveTo(0, yv);
        hctx.quadraticCurveTo(side * len * 0.5, yv - len * 0.25, side * len, yv - len * 0.55);
        hctx.stroke();
        // fine reticulate veins
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = 'rgba(40,24,10,0.18)';
        for (let q = 0; q < 4; q++) {
          const t = (q + 1) / 5;
          ctx.beginPath();
          ctx.moveTo(side * len * t, yv - len * 0.55 * t * t);
          ctx.lineTo(side * len * t + side * 10, yv - len * 0.55 * t * t + 14);
          ctx.stroke();
        }
      }
    }
    hctx.restore();
    ctx.restore();
  }
  const map = finishTex(c, true, false);
  // Height → normal for the atlas.
  const hd = hctx.getImageData(0, 0, hc.width, hc.height).data;
  const W = hc.width;
  const H = hc.height;
  const nc = document.createElement('canvas');
  nc.width = W;
  nc.height = H;
  const nctx = nc.getContext('2d')!;
  const img = nctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const at = (xx: number, yy: number) => hd[(Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))) * 4] / 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * W + x) * 4;
      img.data[k] = (-dx / l) * 127 + 128;
      img.data[k + 1] = (dy / l) * 127 + 128;
      img.data[k + 2] = (1 / l) * 127 + 128;
      img.data[k + 3] = 255;
    }
  nctx.putImageData(img, 0, 0);
  const normal = finishTex(nc, false, false);
  return { map, normal, cols, rows };
}

/** Small tileable noise texture used by shaders (R,G,B,A = independent noises). */
export function noiseTexture(size = 256): THREE.Texture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const k = (y * size + x) * 4;
      data[k] = pfbm(u * 4, v * 4, 4, 4, 71) * 255;
      data[k + 1] = pfbm(u * 8, v * 8, 8, 4, 73) * 255;
      data[k + 2] = pnoise(u * 32, v * 32, 32, 75) * 255;
      data[k + 3] = hashP(x, y, 77) * 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Lazily-created shared texture set. */
let _lib: TextureLibrary | null = null;
export interface TextureLibrary {
  soil: TexPair;
  moss: TexPair;
  sand: TexPair;
  litter: TexPair;
  bark: TexPair;
  stone: TexPair;
  leaves: LeafAtlas;
  noise: THREE.Texture;
}

export function textures(): TextureLibrary {
  if (!_lib) {
    _lib = {
      soil: soilTexture(),
      moss: mossTexture(),
      sand: sandTexture(),
      litter: litterTexture(),
      bark: barkTexture(),
      stone: stoneTexture(),
      leaves: leafAtlas(),
      noise: noiseTexture(),
    };
  }
  return _lib;
}
