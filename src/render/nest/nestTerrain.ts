import * as THREE from 'three';
import { NEST_CHUNK, NestGrid, SOIL_AIR, SOIL_STONE } from '../../world/nestGrid';
import { addPatch, globalUniforms, NOISE_GLSL, WORLD_POS_PATCH } from '../shaderPatch';
import { valueNoise2 } from '../../core/rng';

/** Vertices per raster cell edge. */
const SUB = 2;

/** Tile type ids written into the per-hex data texture. */
export const HEX_TYPE: Record<string, number> = { none: 0, queen: 1, brood: 2, food: 3, fungus: 4, aphid: 5, thatch: 6, entrance: 7, highway: 8, mound: 9, carton: 10 };

export interface HexVisual {
  type: number;
  level: number;
  /** 6-bit mask of edges that border a different group (outline) */
  edges: number;
  /** 0 none, 1..5 markers I..V, 6 home */
  outline: number;
  /** caste floor tint (brood tiles) */
  tint: THREE.Color;
  /** only planned: drawn as a ghost until a worker builds it */
  planned?: boolean;
  /** pending job on a built tile: 1 upgrade, 2 delete */
  pend?: number;
}

/**
 * The nest seen from above: a chunked heightfield built from a signed
 * distance field of the dug raster. Undug soil is a raised, dark, crumbly
 * plateau; walls slope and round down to a sunken packed-earth floor. Tile
 * floors, group outlines, the placement ghost, dig designation and the warm
 * pooled light are drawn in the floor shader from small data textures.
 */
export class NestTerrain {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  readonly wallH: number;
  private chunks = new Map<number, THREE.Mesh>();
  private sd: Float32Array;
  private soilTex: THREE.DataTexture;
  private soilData: Uint8Array;
  private lightTex: THREE.DataTexture;
  private lightData: Uint8Array;
  private hexTex: THREE.DataTexture;
  private hexData: Uint8Array;
  private tintTex: THREE.DataTexture;
  private tintData: Uint8Array;
  private builtVersion = -1;
  private skirt: THREE.Mesh;
  readonly uniforms = {
    tSoil: { value: null as unknown as THREE.DataTexture },
    tLight: { value: null as unknown as THREE.DataTexture },
    tHex: { value: null as unknown as THREE.DataTexture },
    tTint: { value: null as unknown as THREE.DataTexture },
    uRaster: { value: new THREE.Vector2() },
    uCell: { value: 1 },
    uHexDim: { value: new THREE.Vector2() },
    uHexR: { value: 1 },
    uWallH: { value: 1 },
    uGrid: { value: 0 },
    /** ghost hex: xy centre, z 1 valid / 2 invalid, w 1 visible */
    uGhost: { value: new THREE.Vector4() },
    uGhostCol: { value: new THREE.Color(0.5, 0.9, 0.4) },
    uMarkerCols: { value: Array.from({ length: 7 }, () => new THREE.Color()) },
    uPool: { value: 1 },
    uSelected: { value: new THREE.Vector3(0, 0, 0) },
    /** 1 = a Nasute Termite nest: walls and floor are laminated carton (the model kit's palette);
     *  2 = a Sickle-Jaw Termite nest: dark, damp soil with crumbs and wet patches (the kit's damp-soil look) */
    uCarton: { value: 0 },
  };

  constructor(public grid: NestGrid) {
    const g = grid;
    this.wallH = g.R * 1.25;
    this.sd = new Float32Array(g.w * g.h);
    this.soilData = new Uint8Array(g.w * g.h * 4);
    this.soilTex = new THREE.DataTexture(this.soilData, g.w, g.h, THREE.RGBAFormat);
    this.soilTex.magFilter = this.soilTex.minFilter = THREE.NearestFilter;
    this.lightData = new Uint8Array(g.w * g.h * 4);
    this.lightTex = new THREE.DataTexture(this.lightData, g.w, g.h, THREE.RGBAFormat);
    this.lightTex.magFilter = this.lightTex.minFilter = THREE.LinearFilter;
    this.hexData = new Uint8Array(g.cols * g.rows * 4);
    this.hexTex = new THREE.DataTexture(this.hexData, g.cols, g.rows, THREE.RGBAFormat);
    this.hexTex.magFilter = this.hexTex.minFilter = THREE.NearestFilter;
    this.tintData = new Uint8Array(g.cols * g.rows * 4);
    this.tintTex = new THREE.DataTexture(this.tintData, g.cols, g.rows, THREE.RGBAFormat);
    this.tintTex.magFilter = this.tintTex.minFilter = THREE.NearestFilter;
    for (const t of [this.soilTex, this.lightTex, this.hexTex, this.tintTex]) t.flipY = false;
    const u = this.uniforms;
    u.tSoil.value = this.soilTex;
    u.tLight.value = this.lightTex;
    u.tHex.value = this.hexTex;
    u.tTint.value = this.tintTex;
    u.uRaster.value.set(g.w, g.h);
    u.uCell.value = g.cell;
    u.uHexDim.value.set(g.cols, g.rows);
    u.uHexR.value = g.R;
    u.uWallH.value = this.wallH;

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.25 });
    addPatch(this.material, WORLD_POS_PATCH);
    addPatch(this.material, {
      key: 'nestTop',
      uniforms: { ...u, uTime: globalUniforms.uTime },
      fragmentHeader: FRAG_HEADER,
      fragment: [
        ['#include <color_fragment>', FRAG_COLOR],
        ['#include <normal_fragment_maps>', FRAG_NORMAL],
        ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = surfRough;'],
        ['#include <emissivemap_fragment>', FRAG_EMISSIVE],
      ],
    });
    // Dark ground continuing beyond the nest plane at the soil-top level (a frame around the grid).
    const M = 3000;
    const outer = new THREE.Shape();
    outer.moveTo(-M, -M);
    outer.lineTo(g.widthMm + M, -M);
    outer.lineTo(g.widthMm + M, g.depthMm + M);
    outer.lineTo(-M, g.depthMm + M);
    outer.lineTo(-M, -M);
    const hole = new THREE.Path();
    hole.moveTo(0.5, 0.5);
    hole.lineTo(0.5, g.depthMm - 0.5);
    hole.lineTo(g.widthMm - 0.5, g.depthMm - 0.5);
    hole.lineTo(g.widthMm - 0.5, 0.5);
    hole.lineTo(0.5, 0.5);
    outer.holes.push(hole);
    const skirtGeo = new THREE.ShapeGeometry(outer);
    skirtGeo.rotateX(Math.PI / 2);
    this.skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 1, side: THREE.DoubleSide }));
    this.skirt.position.y = this.wallH - 0.05;
    this.skirt.receiveShadow = true;
    this.group.add(this.skirt);
    this.rebuildAll();
  }

  // ------------------------------------------------------------------ SDF + maps
  private computeSignedDistance(): void {
    const g = this.grid;
    const W = g.w;
    const H = g.h;
    const INF = 1e6;
    const dA = new Float32Array(W * H);
    const dS = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) {
      const air = g.soil[k] === SOIL_AIR;
      dA[k] = air ? INF : 0;
      dS[k] = air ? 0 : INF;
      // grid border counts as soil for air cells
      const x = k % W;
      const y = (k - x) / W;
      if (air && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) dA[k] = 0.5;
    }
    chamfer(dA, W, H);
    chamfer(dS, W, H);
    for (let k = 0; k < W * H; k++) this.sd[k] = g.soil[k] === SOIL_AIR ? dA[k] - 0.5 : -(dS[k] - 0.5);
    // Blur: cell staircases become smooth organic contours.
    const tmp = new Float32Array(W * H);
    for (let pass = 0; pass < 7; pass++) {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let sum = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              const wgt = dx === 0 && dy === 0 ? 2 : 1;
              sum += this.sd[yy * W + xx] * wgt;
              n += wgt;
            }
          tmp[y * W + x] = sum / n;
        }
      this.sd.set(tmp);
    }
  }

  /** Light pools (local + wide openness), wall distance and a smooth stone mask. */
  private updateMaps(): void {
    const g = this.grid;
    const W = g.w;
    const H = g.h;
    const air = new Float32Array(W * H);
    const stone = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) {
      air[k] = g.soil[k] === SOIL_AIR ? 1 : 0;
      stone[k] = g.soil[k] === SOIL_STONE ? 1 : 0;
    }
    const rPool = Math.max(2, Math.round((g.R * 0.9) / g.cell));
    const rWide = Math.max(4, Math.round((g.R * 3.2) / g.cell));
    const pool = boxBlur(air, W, H, rPool, 3);
    const wide = boxBlur(air, W, H, rWide, 2);
    const st = boxBlur(stone, W, H, 1, 1);
    for (let k = 0; k < W * H; k++) {
      const s = g.soil[k];
      const i = k * 4;
      this.soilData[i] = s === SOIL_STONE ? 255 : s * 40;
      this.soilData[i + 1] = g.designated[k] ? 255 : 0;
      this.soilData[i + 2] = 0;
      this.soilData[i + 3] = 255;
      this.lightData[i] = Math.min(255, Math.round(Math.pow(pool[k], 0.8) * 255));
      this.lightData[i + 1] = Math.min(255, Math.round(Math.min(1, wide[k] * 2.2) * 255));
      this.lightData[i + 2] = Math.round((Math.max(-4, Math.min(4, this.sd[k])) / 8 + 0.5) * 255);
      this.lightData[i + 3] = Math.round(st[k] * 255);
    }
    this.soilTex.needsUpdate = true;
    this.lightTex.needsUpdate = true;
    this.updateDesignation();
  }

  /** Dig designation lives in the per-hex texture (alpha bit 0) so it draws as crisp hexes. */
  private updateDesignation(): void {
    const g = this.grid;
    for (let q = 0; q < g.cols * g.rows; q++) {
      const i = q * 4 + 3;
      const v = g.hexDesig[q] && !g.isHexDug(q) ? 1 : 0;
      this.hexData[i] = (this.hexData[i] & ~1) | v;
    }
    this.hexTex.needsUpdate = true;
  }

  /** Per-hex visuals (tile type, level, group outline edges, outline colour, caste tint). */
  setHexes(get: (q: number) => HexVisual | null): void {
    const g = this.grid;
    for (let q = 0; q < g.cols * g.rows; q++) {
      const v = get(q);
      const i = q * 4;
      if (!v) {
        this.hexData[i] = this.hexData[i + 1] = this.hexData[i + 2] = 0;
        this.hexData[i + 3] &= 1; // keep the dig designation bit
        continue;
      }
      // alpha: bit0 dig designation (kept), bit1 planned, bit2 pending upgrade, bit3 pending delete
      this.hexData[i + 3] = (this.hexData[i + 3] & 1) | (v.planned ? 2 : 0) | (v.pend === 1 ? 4 : 0) | (v.pend === 2 ? 8 : 0);
      this.hexData[i] = v.type;
      this.hexData[i + 1] = (Math.max(0, Math.min(3, v.level)) & 3) | ((v.edges & 63) << 2);
      this.hexData[i + 2] = v.outline;
      this.tintData[i] = Math.round(v.tint.r * 255);
      this.tintData[i + 1] = Math.round(v.tint.g * 255);
      this.tintData[i + 2] = Math.round(v.tint.b * 255);
      this.tintData[i + 3] = 255;
    }
    this.hexTex.needsUpdate = true;
    this.tintTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ heights
  private sdAt(px: number, py: number): number {
    const g = this.grid;
    const fx = px / g.cell - 0.5;
    const fy = py / g.cell - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const u = fx - x0;
    const v = fy - y0;
    const s = (x: number, y: number) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? -6 : this.sd[y * g.w + x]);
    return s(x0, y0) * (1 - u) * (1 - v) + s(x0 + 1, y0) * u * (1 - v) + s(x0, y0 + 1) * (1 - u) * v + s(x0 + 1, y0 + 1) * u * v;
  }

  /** Surface height (mm) at a nest-plane point: floor ≈ 0, soil top = wallH, ramps rise to the top. */
  heightAt(px: number, py: number): number {
    const g = this.grid;
    // organic wobble so walls never follow the raster
    const sdv = this.sdAt(px, py) + (valueNoise2(px * 0.11, py * 0.11, 7) - 0.5) * 1.1 + (valueNoise2(px * 0.35, py * 0.35, 3) - 0.5) * 0.35;
    let t = (0.55 - sdv) / 2.8;
    t = Math.max(0, Math.min(1, t));
    t = t * t * (3 - 2 * t);
    const lump = t > 0.6 ? (Math.sin(px * 0.9 + Math.sin(py * 0.7) * 2) * Math.sin(py * 0.83 - px * 0.31) * 0.5 + 0.5) * this.wallH * 0.07 * (t - 0.6) * 2.5 : 0;
    const bump = (1 - t) * (Math.sin(px * 1.7 + py * 0.6) * Math.sin(py * 1.3 - px * 0.4)) * 0.12;
    let h = t * this.wallH + lump + bump;
    // Entrance ramps: a mound of loose soil rising toward the opening above.
    for (const q of g.entrances) {
      const c = g.hexCenter(q);
      const d = Math.hypot(px - c.x, py - c.y) / (g.R * 0.95);
      if (d < 1) {
        const k = 1 - d;
        h = Math.max(h, this.wallH * 0.95 * k * k * (3 - 2 * k));
      }
    }
    return h;
  }

  normalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.grid.cell * 0.6;
    const hx = this.heightAt(px + e, py) - this.heightAt(px - e, py);
    const hz = this.heightAt(px, py + e) - this.heightAt(px, py - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  // ------------------------------------------------------------------ meshing
  private buildChunk(ci: number): void {
    const g = this.grid;
    const cw = Math.ceil(g.w / NEST_CHUNK);
    const cx = ci % cw;
    const cy = Math.floor(ci / cw);
    const x0 = cx * NEST_CHUNK;
    const y0 = cy * NEST_CHUNK;
    if (y0 >= g.h) return;
    const x1 = Math.min(g.w, x0 + NEST_CHUNK);
    const y1 = Math.min(g.h, y0 + NEST_CHUNK);
    const nvx = (x1 - x0) * SUB + 1;
    const nvy = (y1 - y0) * SUB + 1;
    const step = g.cell / SUB;
    let mesh = this.chunks.get(ci);
    if (!mesh) {
      const geo = new THREE.BufferGeometry();
      const n = nvx * nvy;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const idx: number[] = [];
      for (let j = 0; j < nvy - 1; j++)
        for (let i = 0; i < nvx - 1; i++) {
          const a = j * nvx + i;
          idx.push(a, a + nvx, a + 1, a + 1, a + nvx, a + nvx + 1);
        }
      geo.setIndex(idx);
      mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.chunks.set(ci, mesh);
      this.group.add(mesh);
    }
    const geo = mesh.geometry;
    const pos = geo.attributes.position.array as Float32Array;
    const nrm = geo.attributes.normal.array as Float32Array;
    const hs = new Float32Array((nvx + 2) * (nvy + 2));
    for (let j = -1; j <= nvy; j++)
      for (let i = -1; i <= nvx; i++) hs[(j + 1) * (nvx + 2) + (i + 1)] = this.heightAt(x0 * g.cell + i * step, y0 * g.cell + j * step);
    for (let j = 0; j < nvy; j++)
      for (let i = 0; i < nvx; i++) {
        const k = j * nvx + i;
        const hh = hs[(j + 1) * (nvx + 2) + (i + 1)];
        pos[k * 3] = x0 * g.cell + i * step;
        pos[k * 3 + 1] = hh;
        pos[k * 3 + 2] = y0 * g.cell + j * step;
        const hl = hs[(j + 1) * (nvx + 2) + i];
        const hr = hs[(j + 1) * (nvx + 2) + i + 2];
        const hu = hs[j * (nvx + 2) + i + 1];
        const hd = hs[(j + 2) * (nvx + 2) + i + 1];
        const nx = -(hr - hl) / (2 * step);
        const nz = -(hd - hu) / (2 * step);
        const l = Math.hypot(nx, 1, nz);
        nrm[k * 3] = nx / l;
        nrm[k * 3 + 1] = 1 / l;
        nrm[k * 3 + 2] = nz / l;
      }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  rebuildAll(): void {
    this.grid.dirtyAll();
    this.update(true);
  }

  /** Rebuild dirty chunks (cheap when nothing changed). */
  update(force = false): void {
    const g = this.grid;
    if (!force && g.dirty.size === 0) return;
    if (g.version !== this.builtVersion || force) {
      this.computeSignedDistance();
      this.builtVersion = g.version;
    }
    this.updateMaps();
    for (const ci of g.dirty) this.buildChunk(ci);
    g.dirty.clear();
  }

  setShadows(on: boolean): void {
    for (const m of this.chunks.values()) m.castShadow = on;
  }
}

/** Two-pass chamfer distance transform (in cells). */
function chamfer(d: Float32Array, W: number, H: number): void {
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      let v = d[k];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[k - 1] + D1);
      if (y > 0) {
        v = Math.min(v, d[k - W] + D1);
        if (x > 0) v = Math.min(v, d[k - W - 1] + D2);
        if (x < W - 1) v = Math.min(v, d[k - W + 1] + D2);
      }
      d[k] = v;
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const k = y * W + x;
      let v = d[k];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[k + 1] + D1);
      if (y < H - 1) {
        v = Math.min(v, d[k + W] + D1);
        if (x < W - 1) v = Math.min(v, d[k + W + 1] + D2);
        if (x > 0) v = Math.min(v, d[k + W - 1] + D2);
      }
      d[k] = v;
    }
}

/** Separable box blur repeated `passes` times (≈ gaussian). */
function boxBlur(src: Float32Array, W: number, H: number, r: number, passes: number): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(W * H);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[row + x] = acc * inv;
        acc += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc * inv;
        acc += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
  }
  b = a;
  return b;
}

// ====================================================================== GLSL
const FRAG_HEADER = /* glsl */ `
uniform sampler2D tSoil; uniform sampler2D tLight; uniform sampler2D tHex; uniform sampler2D tTint;
uniform vec2 uRaster; uniform float uCell; uniform vec2 uHexDim; uniform float uHexR; uniform float uWallH;
uniform float uGrid; uniform vec4 uGhost; uniform vec3 uGhostCol; uniform vec3 uMarkerCols[7]; uniform float uPool;
uniform vec3 uSelected; uniform float uTime; uniform float uCarton;
${NOISE_GLSL}
vec3 worley(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8.0, d2=8.0; vec2 id=vec2(0);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=vec2(h21(i+g), h21(i+g+19.7));
    float d=length(g+o-f); if(d<d1){d2=d1; d1=d; id=i+g;} else if(d<d2) d2=d; }
  return vec3(d1, d2, h21(id)); }
// nearest flat-top hex centre (odd columns shifted down); returns col,row in zw
vec4 hexOf(vec2 p){
  float R = uHexR; float H = 1.7320508*R; float C = 1.5*R;
  float c0 = floor((p.x - R)/C + 0.5);
  float bd = 1e9; vec4 best = vec4(0.0, 0.0, -1.0, -1.0);
  for (int dc=-1; dc<=1; dc++){
    float cc = c0 + float(dc);
    float odd = mod(cc, 2.0);
    float r0 = floor((p.y - H*0.5 - odd*H*0.5)/H + 0.5);
    for (int dr=-1; dr<=1; dr++){
      float rr = r0 + float(dr);
      vec2 ctr = vec2(R + cc*C, H*0.5 + rr*H + odd*H*0.5);
      float dd = dot(p-ctr, p-ctr);
      if (dd < bd){ bd = dd; best = vec4(ctr, cc, rr); }
    }
  }
  return best;
}
float hexDist(vec2 d){ d = abs(d); return max(d.y, d.x*0.8660254 + d.y*0.5); }
float bitOf(float v, float b){ return mod(floor(v / pow(2.0, b)), 2.0); }
`;

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
vec2 gp = vWP.xz;
vec2 ruv = gp / (uRaster * uCell);
vec4 soilT = texture2D(tSoil, ruv);
vec4 lightT = texture2D(tLight, ruv);
float pool = lightT.r;            // local openness (light pooling)
float wideL = lightT.g;           // wide openness (darkness far from the dug area)
float sdW = (lightT.b - 0.5) * 8.0; // signed distance to the wall (cells, + in air)
float stoneM = smoothstep(0.35, 0.6, lightT.a + (vnoise(gp*0.7)-0.5)*0.3);
float hf = clamp(vWP.y / uWallH, 0.0, 1.2);
float topM = smoothstep(0.82, 0.97, hf);          // flat soil top
float wallM = smoothstep(0.04, 0.5, hf) * (1.0 - topM); // sloped wall
float floorM = 1.0 - smoothstep(0.02, 0.18, hf);
float surfRough = 0.93;
float bumpH = 0.0;

// ---- packed earth floor: warm tan with grain, pebble drifts along wall feet, rootlets, debris
float grain = vnoise(gp*2.6);
vec3 floorC = mix(vec3(0.21,0.155,0.07), vec3(0.32,0.235,0.11), fbm(gp*0.06));
floorC *= 0.86 + 0.24*grain;
floorC = mix(floorC, floorC*0.7, smoothstep(0.5, 0.8, fbm(gp*0.22 + 4.0)));
floorC = mix(floorC, floorC*1.25, smoothstep(0.55, 0.85, fbm(gp*0.035 + 9.0)));
bumpH += grain*0.25;
// pebble drifts: dense near the wall foot, sparse in the open
float edgeK = 1.0 - smoothstep(0.3, 3.5, sdW);
vec3 wp = worley(gp*0.55 + vec2(vnoise(gp*0.3), vnoise(gp*0.3+7.0))*0.8);
float pr = 0.26 + 0.2*h21(vec2(wp.z*31.0));
float pebDens = mix(0.9, 0.22, edgeK);
float isPeb = step(pebDens, wp.z) * smoothstep(pr + 0.05, pr - 0.04, wp.x);
float dome = clamp(1.0 - wp.x/max(pr,0.01), 0.0, 1.0);
vec3 pebC = mix(vec3(0.26,0.30,0.34), vec3(0.17,0.18,0.19), h21(vec2(wp.z*91.0)));
pebC = mix(pebC, vec3(0.34,0.3,0.24), step(0.82, h21(vec2(wp.z*13.0))));
pebC *= 0.5 + 0.65*sqrt(dome);
floorC = mix(floorC, pebC, isPeb);
bumpH += isPeb * sqrt(dome) * 1.4;
// fine sand specks
vec3 ws = worley(gp * 3.1);
floorC = mix(floorC, vec3(0.36,0.29,0.18), step(0.92, ws.z) * smoothstep(0.3, 0.1, ws.x) * 0.35);
// pale rootlets crossing the floor
float rl = abs(fbm(vec2(gp.x*0.03, gp.y*0.027) + 3.3) - 0.5);
floorC = mix(floorC, vec3(0.34,0.26,0.16), smoothstep(0.004, 0.001, rl) * 0.4 * step(0.55, fbm(gp*0.02 + 1.0)));
// baked occlusion at the foot of walls
floorC *= mix(0.45, 1.0, smoothstep(0.0, 3.0, sdW));

// ---- walls: compacted, scraped soil with root ends and embedded stones
vec3 wallC = mix(vec3(0.05,0.045,0.03), vec3(0.09,0.075,0.05), fbm(gp*0.12));
float scrape = vnoise(vec2(gp.x*1.1 + gp.y*0.9, gp.y*1.1 - gp.x*0.7) * 1.3);
wallC *= 0.8 + 0.35*scrape;
float roots = smoothstep(0.012, 0.003, abs(fbm(gp*0.08 + 11.0) - 0.5));
wallC = mix(wallC, vec3(0.24,0.18,0.12), roots*0.6);
bumpH += scrape*0.4 + roots*0.5;

// ---- termite nests: carton (mostly faeces with chewed wood, bound with saliva) — dark, papery,
// layered laminae with fibres; the floor is trodden carton, a little lighter and smoother
if (uCarton > 0.5 && uCarton < 1.5) {
  float cwarp = fbm(gp*0.35)*3.0 + fbm(gp*1.3)*0.6;
  float lam = fract(vWP.y*2.6 + cwarp);
  float ridge = smoothstep(0.0, 0.18, lam) * (1.0 - smoothstep(0.55, 1.0, lam));
  vec3 cc = mix(vec3(0.023,0.012,0.007), vec3(0.044,0.023,0.013), smoothstep(0.25, 0.75, fbm(gp*0.18)));
  cc = mix(cc, vec3(0.105,0.058,0.031), ridge*0.55*smoothstep(0.3, 0.8, fbm(gp*0.9 + 7.0)));
  float fib = smoothstep(0.78, 0.95, vnoise(gp*vec2(9.0, 3.0) + 2.0));
  cc = mix(cc, vec3(0.14,0.078,0.042), fib*0.45);
  wallC = cc * (0.88 + 0.24*vnoise(gp*14.0)) * 1.6;
  bumpH += ridge*0.6 + fib*0.2;
  float lamF = fract(fbm(gp*0.12)*5.0 + fbm(gp*0.9)*0.5);
  float ridgeF = smoothstep(0.0, 0.2, lamF) * (1.0 - smoothstep(0.5, 1.0, lamF));
  vec3 fc = mix(vec3(0.09,0.052,0.03), vec3(0.15,0.095,0.055), fbm(gp*0.08));
  fc = mix(fc, vec3(0.19,0.13,0.075), ridgeF*0.35);
  fc *= 0.86 + 0.24*grain;
  floorC = mix(floorC, fc * mix(0.45, 1.0, smoothstep(0.0, 3.0, sdW)), 0.85);
  bumpH += ridgeF*0.3;
}
// ---- Sickle-Jaw Termite nests: dark, damp soil chambers — crumbly walls, glossy wet patches, a darker
// trodden floor (model kit v2 damp-soil look)
if (uCarton > 1.5) {
  float wet = smoothstep(0.55, 0.8, fbm(gp*0.22 + 3.0));
  vec3 cr = worley(gp*1.8);
  float crumb = smoothstep(0.35, 0.05, cr.x);
  vec3 dc = mix(vec3(0.05,0.034,0.022), vec3(0.095,0.064,0.04), fbm(gp*0.4));
  wallC = dc * (0.78 + 0.45*crumb*(0.6 + 0.4*cr.z)) * (1.0 - 0.35*wet) * 1.6;
  vec3 df = mix(vec3(0.075,0.052,0.033), vec3(0.12,0.085,0.05), fbm(gp*0.07));
  floorC = mix(floorC*0.5, df*(0.82 + 0.36*crumb) * (1.0 - 0.3*wet), 0.75);
  bumpH += crumb*0.55 + vnoise(gp*6.0)*0.15;
  surfRough = mix(surfRough, 0.3, wet*0.75);
}

// ---- soil top: dark crumbly humus with clods; soil type tints; darkness far from light
float st = floor(soilT.r*255.0/40.0 + 0.5);
vec3 topC = vec3(0.055,0.052,0.034);
topC = mix(topC, vec3(0.11,0.065,0.045), step(2.5, st)*step(st, 3.5));   // clay: redder
topC = mix(topC, vec3(0.09,0.085,0.075), step(3.5, st)*step(st, 4.5));   // gravel: greyer
topC = mix(topC, vec3(0.05,0.045,0.032), step(0.5, st)*step(st, 1.5));   // humus: darker
vec3 cl = worley(gp*0.55);
float clod = smoothstep(0.5, 0.05, cl.x);
topC *= 0.7 + 0.5*clod*(0.6 + 0.4*cl.z);
topC *= 0.8 + 0.4*vnoise(gp*3.0);
bumpH += clod*1.2 + vnoise(gp*3.0)*0.3;
// buried stones (undiggable, user note 2026-10-25: "hard to identify rocks that you can't dig"): pale
// cool-grey rock slabs, cracked into plates, with a light rim and a dark gap where they meet the soil, and
// kept readable in the dark far from the dug area — unlike the warm, crumbly, dark soil you can dig
float stoneE = lightT.a + (vnoise(gp*0.9)-0.5)*0.12;
stoneM = smoothstep(0.42, 0.52, stoneE);
vec3 sw = worley(gp*0.42);
// (blue-biased so the nest's warm key light, 0xffc27a, leaves them a neutral stone grey)
vec3 stoneC = mix(vec3(0.30,0.40,0.60), vec3(0.44,0.58,0.84), fbm(gp*0.3)) * (0.85 + 0.25*vnoise(gp*3.5));
float crack = smoothstep(0.07, 0.0, sw.y - sw.x);
stoneC *= 1.0 - crack*0.5;
stoneC += vec3(0.10,0.10,0.10) * smoothstep(0.52, 0.6, stoneE) * (1.0 - smoothstep(0.6, 0.72, stoneE)); // light rim
float stoneGap = smoothstep(0.26, 0.42, stoneE) * (1.0 - stoneM);  // dark seam round the slab
topC = mix(topC * (1.0 - 0.9*stoneGap), stoneC, stoneM);
wallC = mix(wallC, stoneC*0.75, stoneM);
bumpH += stoneM * (1.6 - crack*0.8) - stoneGap*0.6;
surfRough = mix(surfRough, 0.62, stoneM*topM);

vec3 col = floorC * floorM + wallC * wallM + topC * topM;
float covered = floorM + wallM + topM;
col /= max(covered, 1e-3);
// darkness grows away from dug ground (soil top and walls); stones stay readable in it
float darkK = mix(0.12, 1.0, wideL*wideL);
darkK = mix(darkK, max(darkK, 0.62), stoneM * topM);
col *= mix(1.0, darkK, 1.0 - floorM);

// ---- hex tiles on the floor
vec4 hx = hexOf(gp);
vec2 hctr = hx.xy;
vec2 hcr = hx.zw;
float inGrid = step(0.0, hcr.x) * step(0.0, hcr.y) * step(hcr.x, uHexDim.x - 1.0) * step(hcr.y, uHexDim.y - 1.0);
vec2 huv = (hcr + 0.5) / uHexDim;
vec4 hexT = texture2D(tHex, huv) * inGrid;
float htype = floor(hexT.r*255.0 + 0.5);
float hg = floor(hexT.g*255.0 + 0.5);
float hlevel = mod(hg, 4.0);
float hedges = floor(hg / 4.0);
float hout = floor(hexT.b*255.0 + 0.5);
vec2 hl = gp - hctr;
float hd = hexDist(hl);
float apo = uHexR*0.8660254;
float edgeProx = apo - hd;
float tileK = floorM * step(0.5, htype);
if (htype > 0.5) {
  vec3 tc = col;
  vec3 tint = texture2D(tTint, huv).rgb;
  if (htype < 1.5) {
    // queen: pale blue-grey silk mat of fine crossing strands
    vec3 base = vec3(0.28,0.36,0.46);
    float s1 = abs(sin(dot(gp, vec2(0.83, 0.55))*3.1 + fbm(gp*0.4)*6.0));
    float s2 = abs(sin(dot(gp, vec2(-0.42, 0.91))*2.7 + fbm(gp*0.37+5.0)*6.0));
    float s3 = abs(sin(dot(gp, vec2(0.99, -0.12))*3.5 + fbm(gp*0.5+9.0)*5.0));
    float strands = smoothstep(0.93, 1.0, s1) + smoothstep(0.94, 1.0, s2) + smoothstep(0.95, 1.0, s3)*0.7;
    tc = base * (0.6 + 0.3*fbm(gp*0.9)) + vec3(0.62,0.72,0.85)*clamp(strands,0.0,1.0)*0.5;
    tc = mix(col*0.6, tc, 0.85);
    // termites: the royal chamber is a smooth, dense carton cell, not silk
    if (uCarton > 0.5 && uCarton < 1.5) tc = mix(tc, vec3(0.075,0.045,0.026) * (0.8 + 0.4*fbm(gp*0.9)) + vec3(0.03,0.02,0.01)*clamp(strands,0.0,1.0), 0.85);
    // sickle-jaws: a smooth, dense cell of damp soil
    if (uCarton > 1.5) tc = mix(tc, vec3(0.085,0.058,0.036) * (0.8 + 0.4*fbm(gp*0.9)), 0.85);
    surfRough = mix(surfRough, 0.55, tileK);
    bumpH += strands*0.25;
  } else if (htype < 2.5) {
    // brood tile: caste-tinted packed cells with rounded pits
    vec3 cw = worley(gp * (0.9 + 0.1*hlevel));
    float pit = smoothstep(0.62, 0.12, cw.x);
    float rim = smoothstep(0.05, 0.0, cw.y - cw.x);
    tc = tint * (0.55 + 0.35*vnoise(gp*1.7)) * (1.0 - pit*0.45);
    tc += tint * rim * 0.25;
    tc = mix(tc, tc*1.3 + vec3(0.06,0.04,0.0), step(1.5, hlevel) * step(0.92, cw.z) * 0.6); // upgraded: bright flecks
    bumpH += -pit*0.7 + rim*0.3;
    surfRough = mix(surfRough, 0.82, tileK);
  } else if (htype < 3.5) {
    // food store: mossy green bed with honeydew beads
    vec3 base = mix(vec3(0.16,0.24,0.08), vec3(0.28,0.36,0.12), fbm(gp*0.5));
    vec3 mw = worley(gp*1.6);
    tc = base * (0.7 + 0.5*smoothstep(0.6, 0.1, mw.x));
    float bead = step(0.86, mw.z) * smoothstep(0.32, 0.12, mw.x);
    tc = mix(tc, vec3(0.75,0.62,0.25), bead*0.8);
    surfRough = mix(surfRough, mix(0.8, 0.25, bead), tileK);
    bumpH += smoothstep(0.6, 0.1, mw.x)*0.6 + bead*0.5;
  } else if (htype < 4.5) {
    // fungus garden: spongy white-grey comb
    vec3 fw = worley(gp*1.3);
    float hole = smoothstep(0.35, 0.05, fw.x);
    tc = mix(vec3(0.80,0.78,0.71), vec3(0.42,0.40,0.34), hole) * (0.85 + 0.2*vnoise(gp*4.0));
    surfRough = mix(surfRough, 0.95, tileK);
    bumpH += (1.0 - hole)*0.8;
  } else if (htype < 5.5) {
    // root-aphid pasture: dark loam laced with pale roots
    float r1 = smoothstep(0.02, 0.004, abs(fbm(gp*0.25) - 0.5));
    float r2 = smoothstep(0.015, 0.003, abs(fbm(gp*0.33 + 4.0) - 0.5));
    tc = mix(vec3(0.15,0.11,0.07), vec3(0.62,0.55,0.4), clamp(r1 + r2*0.8, 0.0, 1.0));
    bumpH += (r1 + r2)*0.6;
  } else if (htype < 6.5) {
    // thatch: packed needles and plant fibres
    float n1 = smoothstep(0.85, 1.0, abs(sin(dot(gp, vec2(0.7,0.7))*4.0 + fbm(gp*0.6)*8.0)));
    float n2 = smoothstep(0.88, 1.0, abs(sin(dot(gp, vec2(-0.6,0.8))*3.6 + fbm(gp*0.5+3.0)*8.0)));
    tc = mix(vec3(0.24,0.15,0.08), vec3(0.52,0.36,0.18), clamp(n1 + n2, 0.0, 1.0));
    bumpH += (n1 + n2)*0.5;
  } else if (htype < 7.5) {
    // entrance ramp: loose, paler soil lit from above
    tc = mix(col, vec3(0.42,0.34,0.24)*(0.8+0.4*grain), 0.6);
  } else if (htype < 8.5) {
    // highway: smooth, packed, well-trodden earth with faint wear lines along it
    float wear = smoothstep(0.75, 1.0, abs(sin(dot(gp, vec2(0.5, 0.866))*1.6 + fbm(gp*0.2)*2.0)));
    vec3 packed = mix(vec3(0.46,0.36,0.24), vec3(0.58,0.46,0.31), fbm(gp*0.35));
    tc = packed * (0.92 + 0.12*wear) * (0.85 + 0.15*hlevel/3.0);
    surfRough = mix(surfRough, 0.62, tileK);
    bumpH = bumpH*0.25 - wear*0.08;
  } else if (htype < 9.5) {
    // sun-warmed brood mound (fire ants): loose, granular worked soil, warm and dry
    vec3 gr = worley(gp*2.2);
    float clod = smoothstep(0.42, 0.08, gr.x);
    vec3 sandy = mix(vec3(0.50,0.36,0.22), vec3(0.70,0.55,0.36), fbm(gp*0.5));
    tc = mix(sandy*0.78, sandy*1.08, clod) * (0.9 + 0.1*hlevel/3.0);
    surfRough = mix(surfRough, 0.97, tileK);
    bumpH += clod*0.9;
  } else {
    // Termant carton wall: layered papery chewed wood in brown and tan bands (the wall itself is the decor heap)
    float lay = fbm(gp*vec2(0.35, 1.6) + fbm(gp*0.5)*2.0);
    float band = smoothstep(0.4, 0.6, fract(lay*5.0));
    tc = mix(vec3(0.30,0.20,0.11), vec3(0.58,0.44,0.28), band) * (0.85 + 0.2*vnoise(gp*3.0));
    surfRough = mix(surfRough, 0.9, tileK);
    bumpH += band*0.5;
  }
  // soft inner bevel so neighbouring tiles read as separate cells
  tc *= mix(0.72, 1.0, smoothstep(0.0, 0.9, edgeProx));
  float hflags = floor(hexT.a*255.0 + 0.5);
  float planned = mod(floor(hflags / 2.0), 2.0);
  // planned tiles are ghosts: a faint wash of their material and a dashed rim
  col = mix(col, tc, tileK * (planned > 0.5 ? 0.3 : 1.0));
  if (planned > 0.5) {
    float ang2 = atan(hl.y, hl.x);
    float dash = step(0.5, fract(ang2 * 3.0 + uTime * 0.4));
    col = mix(col, vec3(0.95,0.88,0.7), smoothstep(0.45, 0.1, edgeProx) * dash * 0.75 * floorM);
  }
  float pendUp = mod(floor(hflags / 4.0), 2.0);
  float pendDel = mod(floor(hflags / 8.0), 2.0);
  if (pendUp + pendDel > 0.5) {
    float pul = 0.55 + 0.45*sin(uTime*4.0);
    vec3 pc = pendDel > 0.5 ? vec3(0.95,0.25,0.18) : vec3(1.0,0.82,0.3);
    col = mix(col, pc, smoothstep(0.7, 0.15, edgeProx) * pul * 0.85 * floorM);
  }
}
// group outline on edges that border a different group (coloured by marker)
if (hedges > 0.5 && floorM > 0.2) {
  float ang = atan(hl.y, hl.x);
  float sector = mod(floor((ang + 0.5235988) / 1.0471976 + 0.5), 6.0);
  float on = bitOf(hedges, sector);
  float line = on * smoothstep(0.55, 0.15, edgeProx) * floorM;
  vec3 oc = uMarkerCols[int(clamp(hout, 0.0, 6.0))];
  col = mix(col, oc, line*0.85);
}
// grid overlay (placement mode)
if (uGrid > 0.5) {
  col = mix(col, vec3(0.9,0.8,0.55), smoothstep(0.25, 0.0, edgeProx) * 0.35 * floorM);
}
// placement ghost
if (uGhost.w > 0.5) {
  float gd = hexDist(gp - uGhost.xy);
  float inside = step(gd, apo);
  float ring = smoothstep(0.6, 0.0, abs(gd - apo + 0.3));
  float pulse = 0.75 + 0.25*sin(uTime*5.0);
  col = mix(col, uGhostCol, clamp(inside*0.28*pulse + ring*0.9, 0.0, 1.0));
}
// selected tile
if (uSelected.z > 0.5) {
  float sd2 = hexDist(gp - uSelected.xy);
  col = mix(col, vec3(1.0,0.92,0.6), smoothstep(0.5, 0.0, abs(sd2 - apo + 0.35)) * 0.9);
}
// dig designation: marked soil glows amber with a bright hex outline
float desig = mod(floor(hexT.a*255.0 + 0.5), 2.0) * inGrid;
if (desig > 0.5) {
  float pulse = 0.8 + 0.2*sin(uTime*2.5 + hd*0.4);
  float rim = smoothstep(0.9, 0.2, edgeProx);
  col = mix(col, vec3(0.55,0.36,0.14), 0.45*(1.0 - floorM));
  col = mix(col, vec3(1.0,0.72,0.3), rim*0.8*pulse);
}
diffuseColor.rgb = col;
`;

const FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 dHdxy = vec2(dFdx(bumpH), dFdy(bumpH)) * 0.5;
  vec3 vSigmaX = dFdx(-vViewPosition); vec3 vSigmaY = dFdy(-vViewPosition);
  vec3 R1 = cross(vSigmaY, normal); vec3 R2 = cross(normal, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  normal = normalize(abs(fDet) * normal - vGrad);
}
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  // warm light pooling over open dug floor, falling off down tunnels and up the walls
  float spot = 0.65 + 0.7 * smoothstep(0.35, 0.8, fbm(gp*0.012 + 3.0));   // uneven pools, like light through cracks
  float lp = pow(pool, 2.2) * pow(wideL, 1.5) * spot * (floorM + wallM*0.12) * (1.0 - tileK*0.55);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.74, 0.38) * lp * 1.25 * uPool;
  if (desig > 0.5) totalEmissiveRadiance += vec3(1.0,0.6,0.2) * smoothstep(0.9, 0.2, edgeProx) * 0.5;
  if (uGhost.w > 0.5) {
    float gd = hexDist(gp - uGhost.xy);
    totalEmissiveRadiance += uGhostCol * smoothstep(0.6, 0.0, abs(gd - uHexR*0.8660254 + 0.3)) * 0.35;
  }
}
`;
