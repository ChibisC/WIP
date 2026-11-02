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
  /** caste texture pressed into a brood tile (render/casteLook CASTE_PATTERNS index) */
  pattern?: number;
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
  /** top hexes of entrances that are plugged or have caved in (a soil cap instead of a ramp; set by the nest view) */
  private shutTops: number[] = [];
  private ramps: Ramp[] = [];
  private rampKey = '';
  private rampT: number[][] | null = null;
  private rampTN = 0;
  private rampE: number[] | null = null;
  private rampEN = 0;
  private rampF: number[][] | null = null;
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
    /** a nest's entrance flower: its centre (xy, mm) and outward direction (zw, unit); uEntR its radius (0: none, a cave) */
    uEnt: { value: new THREE.Vector4() },
    uEntR: { value: 0 },
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
      // alpha: the brood tile's texture number (×16 + 8, read back as floor(a×255 / 16))
      this.tintData[i + 3] = Math.max(0, Math.min(15, v.pattern ?? 0)) * 16 + 8;
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
    // organic wobble so walls never follow the raster (user 2026-11-01: "make walls a little more straighter (not too
    // straight)" — about half the wobble it had: 1.1 and 0.35)
    const sdv = this.sdAt(px, py) + (valueNoise2(px * 0.11, py * 0.11, 7) - 0.5) * 0.6 + (valueNoise2(px * 0.35, py * 0.35, 3) - 0.5) * 0.2;
    let t = (0.55 - sdv) / 2.8;
    t = Math.max(0, Math.min(1, t));
    t = t * t * (3 - 2 * t);
    const lump = t > 0.6 ? (Math.sin(px * 0.9 + Math.sin(py * 0.7) * 2) * Math.sin(py * 0.83 - px * 0.31) * 0.5 + 0.5) * this.wallH * 0.07 * (t - 0.6) * 2.5 : 0;
    const bump = (1 - t) * (Math.sin(px * 1.7 + py * 0.6) * Math.sin(py * 1.3 - px * 0.4)) * 0.12;
    let h = t * this.wallH + lump + bump;
    // Entrances: a ramp of loose soil rising to the opening above — a nest's 7-hex flower as one wide slope up its spine,
    // highest at the top edge; a cave's tunnel as a narrow one. A fallen-in entrance is capped with soil instead.
    for (const r of this.rampList()) {
      if (r.shut) {
        const d = Math.hypot(px - r.cx, py - r.cy) / r.capR;
        if (d < 1) {
          const k = 1 - d;
          h = Math.max(h, this.wallH * Math.min(1, k * 2.2) * (0.97 + 0.03 * Math.sin(px * 1.3 + py)));
        }
        continue;
      }
      h = Math.max(h, this.rampRise(r, px, py));
    }
    return h;
  }

  /** The ramp's height at a point (0 off it): flat across its width, fading at its sides, rising toward the top. */
  private rampRise(r: Ramp, px: number, py: number): number {
    const m = rampAt(r, px, py);
    if (m.d > r.w0 + r.w1) return 0;
    const lat = 1 - smooth01((m.d - r.w0) / r.w1);
    const u = Math.max(0, 1 - m.s / r.len);
    return this.wallH * 0.95 * Math.pow(u, 1.15) * lat;
  }

  /** Entrances the nest view reports as fallen in (their underground ends); re-meshes the ones that changed. */
  setShut(tops: number[]): void {
    const a = [...new Set(tops)].sort((x, y) => x - y);
    if (a.join() === this.shutTops.join()) return;
    const changed = [...a.filter((q) => !this.shutTops.includes(q)), ...this.shutTops.filter((q) => !a.includes(q))];
    this.shutTops = a;
    const g = this.grid;
    for (const top of changed) {
      const ti = g.entrances.indexOf(top);
      const hexes = ti >= 0 ? [...(g.tunnels[ti] ?? []), ...(g.flowers[ti] ?? [])] : [top];
      for (const q of hexes) for (const c of g.hexCells[q] ?? []) g.markDirty(c % g.w, Math.floor(c / g.w));
    }
    this.rampKey = '';
  }

  isShut(top: number): boolean {
    return this.shutTops.includes(top);
  }

  /** Ramp polylines (hex centres from the top down, run on into the floor), rebuilt when the tunnels change. */
  private rampList(): Ramp[] {
    const g = this.grid;
    // cheap check (heightAt runs per vertex and per ant): the replica swaps in new arrays, the sim pushes
    if (this.rampKey === 'ok' && this.rampT === g.tunnels && this.rampTN === g.tunnels.length && this.rampE === g.entrances && this.rampEN === g.entrances.length && this.rampF === g.flowers) return this.ramps;
    this.rampKey = 'ok';
    this.rampT = g.tunnels;
    this.rampTN = g.tunnels.length;
    this.rampE = g.entrances;
    this.rampEN = g.entrances.length;
    this.rampF = g.flowers;
    this.uniforms.uEntR.value = 0;
    this.ramps = g.entrances.map((top, i) => {
      const wide = (g.flowers[i]?.length ?? 0) > 1;
      const hexes = g.tunnels[i]?.length ? g.tunnels[i] : [top];
      const xs: number[] = [];
      const ys: number[] = [];
      for (const q of hexes) {
        const c = g.hexCenter(q);
        xs.push(c.x);
        ys.push(c.y);
      }
      // run on past the bottom hex so the ramp meets the floor smoothly
      const n = xs.length;
      let dx = n > 1 ? xs[n - 1] - xs[n - 2] : 0;
      let dy = n > 1 ? ys[n - 1] - ys[n - 2] : g.R;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const run = g.R * (wide ? 0.9 : n > 1 ? 0.7 : 1.2);
      xs.push(xs[n - 1] + dx * run);
      ys.push(ys[n - 1] + dy * run);
      let len = 0;
      for (let k = 1; k < xs.length; k++) len += Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
      // a flower: flat across its width (the side hexes lie 1.5 R off the spine), the soil walls flaring out beyond; the
      // cap of a fallen-in one covers all seven hexes
      const c = g.hexCenter(top);
      if (wide && i === 0) {
        const ox = xs[0] - c.x;
        const oy = ys[0] - c.y;
        const ol = Math.hypot(ox, oy) || 1;
        this.uniforms.uEnt.value.set(c.x, c.y, ox / ol, oy / ol);
        this.uniforms.uEntR.value = g.R * 2.6;
      }
      return { xs, ys, len, shut: this.shutTops.includes(top), w0: wide ? g.R * 1.75 : g.R * 0.45, w1: wide ? g.R * 0.75 : g.R * 0.55, cx: wide ? c.x : xs[0], cy: wide ? c.y : ys[0], capR: wide ? g.R * 2.75 : g.R * 1.05 };
    });
    return this.ramps;
  }

  normalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.grid.cell * 0.6;
    const hx = this.heightAt(px + e, py) - this.heightAt(px - e, py);
    const hz = this.heightAt(px, py + e) - this.heightAt(px, py - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  /**
   * The floor ants walk on (user 2026-11-01: "for both underground and overground ants should only be flat on the
   * ground and not walk on the walls of underground"): the dug floor's height with the walls left out — the slope up
   * a wall's foot is the wall, not floor — and the entrance ramps, which ants do climb to the surface.
   */
  floorAt(px: number, py: number): number {
    let h = 0;
    for (const r of this.rampList()) {
      if (r.shut) continue;
      h = Math.max(h, this.rampRise(r, px, py));
    }
    return h;
  }

  /** The floor's normal (flat but for the ramps). */
  floorNormalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.grid.cell * 0.6;
    const hx = this.floorAt(px + e, py) - this.floorAt(px - e, py);
    const hz = this.floorAt(px, py + e) - this.floorAt(px, py - e);
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
uniform vec4 uEnt; uniform float uEntR;
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
// a band of half-width w around each half-period of s, smoothed over fs (s's change per pixel)
float bandAt(float s, float w, float fs){ return 1.0 - smoothstep(w - fs, w + fs, abs(fract(s) - 0.5)); }
// Caste textures worked into brood tiles (2026-11-02, user notes: every caste's tile its own colour and texture, and
// "make the textures look more natural realistic and insect like"). The numbering and the shapes mirror
// render/casteLook castePatternAt (the UI swatches); keep the two alike. u: hex-local, hex radius 1; w: the floor in
// hex radii; pw: hex radii per pixel. Returns x: groove (pressed in, darker), y: ridge (raised, lighter).
vec2 castePat(float pid, vec2 u, vec2 w, float pw){
  vec2 r = vec2(0.0);
  if (pid < 0.5) {            // brood pockets: round hollows in the plastered floor, a low rim between them
    vec3 cw = worley(vec2(w.x*2.3 + (vnoise(w*1.7) - 0.5)*0.35, w.y*2.3));
    r = vec2(smoothstep(0.46, 0.2, cw.x), smoothstep(0.08, 0.0, cw.y - cw.x) * 0.5);
  } else if (pid < 1.5) {     // striate: fine raised striations flowing round the tile, as on an ant's cuticle
    float s = dot(w, vec2(0.6, 0.8)) * 4.2 + fbm(w*0.7) * 2.2;
    float fs = pw * 4.2 * 1.5;
    r = vec2(bandAt(s + 0.5, 0.12, fs) * 0.4, bandAt(s, 0.2, fs));
  } else if (pid < 2.5) {     // pellets: packed soil pellets, domed, dark gaps between
    vec3 cw = worley(vec2(w.x*3.1 + (vnoise(w*2.1) - 0.5)*0.3, w.y*3.1));
    r = vec2(smoothstep(0.05, 0.0, cw.y - cw.x) * 0.6, smoothstep(0.58, 0.0, cw.x));
  } else if (pid < 3.5) {     // rugose: wrinkled ridges round the tile's centre
    float s = length(u) * 3.4 + (vnoise(w*2.2) - 0.5)*1.1 + (vnoise(w*5.0) - 0.5)*0.3;
    float fs = pw * 3.4 * 1.5;
    r = vec2(bandAt(s + 0.5, 0.1, fs) * 0.35, bandAt(s, 0.17, fs));
  } else if (pid < 4.5) {     // imbricate scales: each row overlapping the next, dark at the base, light free rims
    vec2 p = vec2(w.x*2.4, w.y*3.0);
    float best = 9.0;
    // the row above lies on top: a point it covers belongs to it, else to its own row
    for (int dr = -1; dr <= 0; dr++) {
      if (best <= 1.0) break;
      float rr = floor(p.y) + float(dr);
      float off = 0.5 * mod(rr, 2.0);
      float k0 = floor(p.x - off + 0.5);
      for (int dk = -1; dk <= 1; dk++) {
        vec2 v = vec2(p.x - (k0 + float(dk) + off), p.y - rr);
        float d = length(vec2(v.x / 0.72, v.y / 1.3));
        if (v.y >= 0.0 && d < 1.0 && d < best) best = d;
      }
    }
    best = min(best, 1.0);
    r = vec2(1.0 - smoothstep(0.0, 0.35, best), smoothstep(0.55, 0.92, best) * (1.0 - smoothstep(0.94, 1.0, best)));
  } else if (pid < 5.5) {     // silk: fine fibres crossing three ways, broken and wandering
    float f = 0.0;
    for (int i = 0; i < 3; i++) {
      float a = 0.4 + float(i)*1.1;
      float s = dot(w, vec2(cos(a), sin(a))) * 3.4 + fbm(vec2(w.x*1.2 + float(i)*3.1, w.y*1.2)) * 2.4;
      f = max(f, bandAt(s, 0.13, pw*3.4*1.5) * smoothstep(0.25, 0.45, vnoise(vec2(w.x*1.4 + float(i)*7.0, w.y*1.4))));
    }
    r = vec2(0.45 * (1.0 - f), f);
  } else if (pid < 6.5) {     // wax comb: six-sided cells, gently warped, thick raised walls, hollow bottoms
    vec2 q = w*2.8 + vec2(vnoise(w*1.8) - 0.5, vnoise(vec2(w.x*1.8 + 5.0, w.y*1.8)) - 0.5) * 0.3;
    vec2 sz = vec2(1.0, 1.7320508);
    vec2 a = mod(q, sz) - sz*0.5;
    vec2 b = mod(q - sz*0.5, sz) - sz*0.5;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 x = abs(g);
    float e = 0.5 - max(x.x*0.5 + x.y*0.8660254, x.x);
    r = vec2(smoothstep(0.12, 0.4, e) * 0.7, 1.0 - smoothstep(0.06, 0.12, e));
  } else if (pid < 7.5) {     // veins: a wing's raised veins and finer cross-veins, membrane cells each a little different
    vec3 a1 = worley(w*1.5);
    vec3 b1 = worley(vec2(w.x*3.6 + 5.0, w.y*3.6));
    float vr = max(1.0 - smoothstep(0.04, 0.085, a1.y - a1.x), (1.0 - smoothstep(0.02, 0.05, b1.y - b1.x)) * 0.6);
    r = vec2((0.25 + (a1.z - 0.5)*0.5) * (1.0 - vr), vr);
  } else if (pid < 8.5) {     // carton: the layered, wavy lamellae of chewed wood and soil termites build with
    float s = fbm(w*0.8) * 5.0 + w.y*1.2 + (vnoise(w*4.0) - 0.5)*0.3;
    r = vec2(bandAt(s + 0.5, 0.1, 0.05) * 0.6, bandAt(s, 0.22, 0.06));
  } else {                    // cocoons: oval capsules lying in staggered rows
    float py = w.y*2.6;
    float row = floor(py);
    float px = w.x*1.5 + 0.5*mod(row, 2.0);
    vec2 f = vec2(fract(px) - 0.5, fract(py) - 0.5);
    float dome = 1.0 - length(vec2(f.x/0.46, f.y/0.36));
    r = vec2(smoothstep(0.08, -0.05, dome) * 0.8, smoothstep(0.0, 0.7, dome));
  }
  return r;
}
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

// ---- packed earth floor (realism pass, 2026-11-02; study notes in docs/realism/underground.md). At the ants' scale
// soil is grains: sand 0.2–0.5 mm (quartz, feldspar, dark minerals, rusty iron-stained grains) set in a brown silt-clay
// matrix, crumbs of a millimetre or two, and the pellets the diggers carry, scattered most along the wall feet. The
// floor is packed and a little smoothed where ants walk; damp patches are darker and less rough. Colours stay
// neutral (the nest's key light is warm).
float grain = vnoise(gp*2.6);
float edgeK = 1.0 - smoothstep(0.3, 3.5, sdW);
vec3 floorC = mix(vec3(0.165,0.13,0.098), vec3(0.265,0.212,0.158), fbm(gp*0.06));
floorC *= 0.9 + 0.16*grain;
floorC = mix(floorC, floorC*0.78, smoothstep(0.5, 0.8, fbm(gp*0.22 + 4.0)));
floorC = mix(floorC, floorC*1.15, smoothstep(0.55, 0.85, fbm(gp*0.035 + 9.0)));
float damp = smoothstep(0.58, 0.84, fbm(gp*0.045 + 13.0));
// (round 4, after the second blind review: no single-colour floors — patches of greyer and of redder soil, and paler,
// smoother paths worn by traffic)
float hueP = fbm(gp*0.022 + 31.0);
floorC = mix(floorC, floorC*vec3(0.92, 0.95, 1.02), smoothstep(0.55, 0.75, hueP));
floorC = mix(floorC, floorC*vec3(1.1, 0.95, 0.85), smoothstep(0.45, 0.25, hueP));
float path = smoothstep(0.035, 0.0, abs(fbm(gp*0.018 + 7.0) - 0.5)) * (1.0 - smoothstep(0.0, 4.0, -sdW + 6.0));
// sand grains (cells 0.28 mm)
vec3 sg = worley(gp*3.6);
float gR = 0.34 + 0.12*h21(vec2(sg.z*17.0));
float gShow = step(0.32, h21(vec2(sg.z*7.0)));
float gIn = smoothstep(gR, gR - 0.1, sg.x) * gShow;
float gDome = clamp(1.0 - sg.x/gR, 0.0, 1.0);
float gk = h21(vec2(sg.z*53.0));
vec3 gC = gk < 0.42 ? vec3(0.44,0.40,0.33) : (gk < 0.62 ? vec3(0.40,0.30,0.24) : (gk < 0.84 ? vec3(0.12,0.105,0.09) : vec3(0.38,0.21,0.11)));
// (worn smooth where ants walk: the open middle of the floor; loose along the walls)
float worn = (1.0 - edgeK) * 0.45 + path*0.4;
floorC = mix(floorC, gC * (0.72 + 0.4*sqrt(gDome)), gIn * (0.6 - 0.25*worn));
bumpH += gIn * sqrt(gDome) * (0.4 - 0.2*worn);
float quartz = gIn * step(gk, 0.42) * smoothstep(0.55, 0.95, gDome);
// crumb structure (~1 mm): dark crevices between the crumbs, softer where trodden
vec3 ag = worley(gp*0.85);
float crev = smoothstep(0.1, 0.0, ag.y - ag.x);
floorC *= 1.0 - crev * (0.22 - 0.12*worn);
bumpH += -crev*0.35 + (1.0 - ag.x)*0.15;
// pebble drifts: dense near the wall foot, sparse in the open
vec3 wp = worley(gp*0.55 + vec2(vnoise(gp*0.3), vnoise(gp*0.3+7.0))*0.8);
float pr = 0.26 + 0.2*h21(vec2(wp.z*31.0));
float pebDens = mix(0.94, 0.3, edgeK);
// (round 3, after a blind review: soil crumbs and a few angular stones, not round blue-grey river pebbles)
float wpx = wp.x + (vnoise(gp*2.4 + wp.z*17.0) - 0.5)*0.14;
float isPeb = step(pebDens, wp.z) * smoothstep(pr + 0.05, pr - 0.04, wpx);
float dome = clamp(1.0 - wpx/max(pr,0.01), 0.0, 1.0);
float pk = h21(vec2(wp.z*13.0));
vec3 pebC = pk < 0.55 ? mix(vec3(0.26,0.205,0.15), vec3(0.19,0.15,0.11), h21(vec2(wp.z*91.0)))
          : (pk < 0.85 ? mix(vec3(0.31,0.30,0.28), vec3(0.22,0.21,0.2), h21(vec2(wp.z*91.0))) : vec3(0.12,0.11,0.1));
pebC *= 0.5 + 0.65*sqrt(dome);
// a pebble's contact shadow on the floor round it
floorC *= 1.0 - 0.35*step(pebDens, wp.z)*smoothstep(pr + 0.16, pr + 0.02, wpx)*(1.0 - isPeb);
floorC = mix(floorC, pebC, isPeb);
bumpH += isPeb * sqrt(dome) * 1.4;
// diggers' pellets (balls of ~160 grains, ~1 mm): scattered on the floor, most along the walls
vec3 pw2 = worley(gp*0.62 + 3.7);
float pelR = 0.22 + 0.08*h21(vec2(pw2.z*5.0));
float isPel = step(mix(0.97, 0.78, edgeK), pw2.z) * (1.0 - isPeb);
float pelIn = isPel * smoothstep(pelR, pelR - 0.05, pw2.x);
float pelDome = clamp(1.0 - pw2.x/pelR, 0.0, 1.0);
vec3 pelC = mix(vec3(0.24,0.19,0.14), vec3(0.32,0.26,0.19), h21(vec2(pw2.z*3.0))) * (0.6 + 0.5*sqrt(pelDome)) * (0.85 + 0.3*vnoise(gp*9.0));
floorC *= 1.0 - 0.3*isPel*smoothstep(pelR + 0.12, pelR, pw2.x)*(1.0 - pelIn);
floorC = mix(floorC, pelC, pelIn);
bumpH += pelIn * sqrt(pelDome) * 1.0;
// pale rootlets crossing the floor
float rl = abs(fbm(vec2(gp.x*0.03, gp.y*0.027) + 3.3) - 0.5);
floorC = mix(floorC, vec3(0.34,0.27,0.19), smoothstep(0.004, 0.001, rl) * 0.4 * step(0.55, fbm(gp*0.02 + 1.0)));
// damp: darker; worn paths a little paler
floorC *= (1.0 - 0.22*damp) * (1.0 + 0.08*path);
// baked occlusion at the foot of walls
floorC *= mix(0.45, 1.0, smoothstep(0.0, 3.0, sdW));
surfRough = mix(0.9, 0.7, damp) - quartz*0.35;

// ---- walls: compacted soil the diggers have scraped smooth, short mandible scrapes, grains and roots in it
vec3 wallC = mix(vec3(0.07,0.057,0.043), vec3(0.12,0.097,0.07), fbm(gp*0.12));
float scrape = vnoise(gp * 1.3);
vec3 wcr = worley(gp*1.1 + 5.0);
wallC *= (0.8 + 0.3*scrape) * (0.85 + 0.25*smoothstep(0.5, 0.1, wcr.x)) * (1.0 - 0.3*smoothstep(0.08, 0.0, wcr.y - wcr.x));
// mandible scrapes: short shallow grooves, a few directions, in patches
float sa = fbm(gp*0.4 + 21.0) * 6.2832;
vec2 sdir = vec2(cos(sa), sin(sa));
float grooves = smoothstep(0.8, 1.0, abs(sin(dot(gp, sdir)*7.0))) * smoothstep(0.45, 0.7, vnoise(gp*1.4 + 2.0));
wallC *= 1.0 - grooves*0.22;
wallC = mix(wallC, gC*0.45, gIn*0.35);
float roots = smoothstep(0.008, 0.002, abs(fbm(gp*0.06 + 11.0) - 0.5)) * step(0.6, fbm(gp*0.03 + 4.0));
wallC = mix(wallC, vec3(0.24,0.18,0.12), roots*0.45);
wallC *= 1.0 - 0.2*damp;
bumpH += scrape*0.4 + roots*0.5 - grooves*0.25;

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
  floorC = mix(floorC, fc * mix(0.45, 1.0, smoothstep(0.0, 3.0, sdW)), 0.78);
  bumpH += ridgeF*0.45 + fib*0.15;
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
  floorC = mix(floorC*0.55, df*(0.82 + 0.36*crumb) * (1.0 - 0.3*wet), 0.6);
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
// (the same grains in it, and the dark gaps between clods)
topC = mix(topC, gC*0.4, gIn*0.3);
topC *= 1.0 - 0.35*smoothstep(0.1, 0.0, cl.y - cl.x);
bumpH += clod*1.2 + vnoise(gp*3.0)*0.3 + gIn*0.2;
// buried stones (undiggable, user note 2026-10-25: "hard to identify rocks that you can't dig"): pale
// cool-grey rock slabs, cracked into plates, with a light rim and a dark gap where they meet the soil, and
// kept readable in the dark far from the dug area — unlike the warm, crumbly, dark soil you can dig
float stoneE = lightT.a + (vnoise(gp*0.9)-0.5)*0.12;
stoneM = smoothstep(0.42, 0.52, stoneE);
vec3 sw = worley(gp*0.42);
// (a little blue-biased so the nest's warm key light, 0xffdcb4, leaves them a neutral stone grey)
vec3 stoneC = mix(vec3(0.33,0.39,0.50), vec3(0.47,0.55,0.70), fbm(gp*0.3)) * (0.85 + 0.25*vnoise(gp*3.5));
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
float darkK = mix(0.17, 1.0, wideL*wideL);
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
float pxU = max(length(fwidth(gp)) / uHexR, 1e-4); // hex radii per pixel (caste textures' smoothing)
float hd = hexDist(hl);
float apo = uHexR*0.8660254;
float edgeProx = apo - hd;
// entrance tunnels colour their ramp too (it rises like a wall toward the hole)
float isEnt = step(6.5, htype) * step(htype, 7.5);
float tileK = max(floorM, isEnt) * step(0.5, htype) * step(htype, 10.5);
if (htype > 0.5 && htype < 10.5) {
  vec3 tc = col;
  vec3 tint = texture2D(tTint, huv).rgb;
  if (htype < 1.5) {
    // queen's chamber (realism pass 2026-11-02: was a blue silk mat): its floor plastered with fine pale silt the
    // workers have smoothed, a few grains showing through, the faint sheen of a much-trodden floor; cool grey so it
    // still reads apart from the other tiles
    float strands = 0.0;
    vec3 silt = mix(vec3(0.30,0.30,0.29), vec3(0.40,0.39,0.36), fbm(gp*0.5)) * (0.9 + 0.12*vnoise(gp*6.0));
    silt = mix(silt, gC*0.9, gIn*0.18);
    float trod = smoothstep(0.3, 0.8, fbm(gp*0.18 + 2.0));
    // (round 3: the floor's grains and crumbs show through the silt — not a smooth slab)
    tc = mix(col, silt, 0.55) * (0.94 + 0.08*trod) * (1.0 - crev*0.12);
    // termites: the royal chamber is a smooth, dense carton cell, not silk
    if (uCarton > 0.5 && uCarton < 1.5) tc = mix(tc, vec3(0.075,0.045,0.026) * (0.8 + 0.4*fbm(gp*0.9)) + vec3(0.03,0.02,0.01)*clamp(strands,0.0,1.0), 0.85);
    // sickle-jaws: a smooth, dense cell of damp soil
    if (uCarton > 1.5) tc = mix(tc, vec3(0.085,0.058,0.036) * (0.8 + 0.4*fbm(gp*0.9)), 0.85);
    surfRough = mix(surfRough, 0.6 - 0.1*trod, tileK);
    bumpH = bumpH*0.75;
  } else if (htype < 2.5) {
    // brood tile: the caste's colour and texture worked into the floor (2026-11-02, user notes: "make every unit tile
    // ... have different colors and textures so they can be identifiable"; then "more natural realistic and insect
    // like ... use more cleaner ones": render/casteLook). A clean colour with real relief — light catches the ridges,
    // the hollows shade — and a waxy sheen on the raised parts; only a trace of the soil's grain under it. The brood
    // itself lies on it (tileDecor).
    float pid = floor(texture2D(tTint, huv).a * 255.0 / 16.0);
    vec2 pr = castePat(pid, hl / uHexR, gp / uHexR, pxU);
    float colL = dot(col, vec3(0.3, 0.5, 0.2));
    vec3 base = tint * 0.5 * (0.92 + 0.08 * clamp(colL / 0.13, 0.4, 1.8));
    tc = mix(col, base, 0.94);
    tc *= (1.0 - pr.x * 0.45) * (1.0 + pr.y * 0.28);
    tc = mix(tc, tc*1.3 + vec3(0.06,0.04,0.0), step(1.5, hlevel) * step(0.93, worley(gp*1.1).z) * 0.5); // upgraded: bright flecks
    bumpH = bumpH*0.2 - pr.x*0.6 + pr.y*0.5;
    surfRough = mix(surfRough, mix(0.72, (pid > 4.5 && pid < 5.5) ? 0.32 : 0.45, pr.y), tileK);
  } else if (htype < 3.5) {
    // food store: a dry, swept store floor stained olive by what is kept on it, honeydew beads catching the light
    // (the stores themselves lie on it, tileDecor)
    vec3 base = mix(vec3(0.17,0.20,0.10), vec3(0.26,0.29,0.14), fbm(gp*0.5));
    base = mix(col, base * (dot(col, vec3(0.33)) / 0.2 * 0.6 + 0.4), 0.55);
    vec3 mw = worley(gp*1.6);
    tc = base * (0.85 + 0.25*smoothstep(0.6, 0.1, mw.x));
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
    // entrance tunnel: loose, paler soil lit from above, worn smooth along the middle where ants walk;
    // a plugged one (outline 1) is fresh dark crumbly soil
    float wornK = smoothstep(apo*0.75, apo*0.2, hd);
    float paleK = smoothstep(apo*1.05, apo*0.45, hd);
    if (uEntR > 0.0) {
      // a nest's wide entrance: one opening, not seven tiles — worn along its middle up the slope, paler loose soil
      // over all of it, fading into the floor round its rim
      vec2 ed = gp - uEnt.xy;
      float er = length(ed);
      float lat = abs(ed.x*uEnt.w - ed.y*uEnt.z);
      wornK = smoothstep(apo*1.7, apo*0.3, lat) * smoothstep(uEntR, uEntR*0.55, er);
      paleK = smoothstep(uEntR*1.1, uEntR*0.55, er);
    }
    // paler loose soil toward the middle, fading into the surrounding floor at the edge
    tc = mix(col, vec3(0.42,0.34,0.24)*(0.8+0.4*grain), 0.6 * paleK);
    tc = mix(tc, vec3(0.50,0.41,0.29)*(0.9+0.2*vnoise(gp*0.6)), wornK*0.35);
    vec3 pw = worley(gp*1.8);
    float pellet = step(0.9, pw.z) * smoothstep(0.3, 0.1, pw.x) * (1.0 - wornK);
    tc = mix(tc, vec3(0.30,0.22,0.15), pellet*0.7);
    bumpH += pellet*0.6 - wornK*0.1;
    if (uEntR > 0.0) {
      // a nest's wide entrance: its top edge, where the floor rises to the surface, fades into darkness
      float upk = clamp(0.5 + dot(gp - uEnt.xy, uEnt.zw) / (uEntR * 1.1), 0.0, 1.0);
      tc *= mix(1.0, 0.28, smoothstep(0.6, 1.0, upk));
    }
    if (hout > 0.5) {
      vec3 cw2 = worley(gp*1.4);
      tc = vec3(0.16,0.11,0.07) * (0.75 + 0.5*smoothstep(0.5, 0.1, cw2.x));
      bumpH += smoothstep(0.5, 0.1, cw2.x)*0.9;
    }
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
  tc *= mix(isEnt > 0.5 ? 1.0 : 0.82, 1.0, smoothstep(0.0, 0.9, edgeProx)); // (a tunnel has no cell edges)
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
  float line = on * smoothstep(0.4, 0.1, edgeProx) * floorM * (0.65 + 0.35*vnoise(gp*1.6));
  vec3 oc = uMarkerCols[int(clamp(hout, 0.0, 6.0))];
  col = mix(col, oc * (0.85 + 0.3*grain), line*0.6);
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
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.84, 0.62) * lp * 1.05 * uPool;
  if (desig > 0.5) totalEmissiveRadiance += vec3(1.0,0.6,0.2) * smoothstep(0.9, 0.2, edgeProx) * 0.5;
  // daylight down an open entrance tunnel: strongest at the top (level 0), cool white
  if (isEnt > 0.5 && hout < 0.5) {
    // soft-edged: a pool of light down the middle of the ramp, not a lit hexagon; across a nest's wide entrance one shaft,
    // brightest at its top edge
    float up = 1.0 - hlevel / 3.0;
    float core = smoothstep(apo * 1.05, apo * 0.25, hd);
    if (uEntR > 0.0) {
      // (the shaft falls across its upper middle; the very top, nearest the surface, stays dark)
      vec2 ed = gp - uEnt.xy;
      float upk = clamp(0.5 + dot(ed, uEnt.zw) / (uEntR * 1.1), 0.0, 1.0);
      up = smoothstep(0.0, 0.55, upk) * (1.0 - smoothstep(0.72, 1.0, upk));
      core = smoothstep(uEntR * 1.08, uEntR * 0.35, length(ed));
    }
    totalEmissiveRadiance += diffuseColor.rgb * vec3(0.78, 0.85, 1.0) * (0.12 + 0.75 * up * up) * core;
  }
  if (uGhost.w > 0.5) {
    float gd = hexDist(gp - uGhost.xy);
    totalEmissiveRadiance += uGhostCol * smoothstep(0.6, 0.0, abs(gd - uHexR*0.8660254 + 0.3)) * 0.35;
  }
}
`;

interface Ramp {
  xs: number[];
  ys: number[];
  len: number;
  shut: boolean;
  /** half-width (mm) of its flat middle, and of the fade at its sides */
  w0: number;
  w1: number;
  /** a fallen-in cap: its centre and radius (mm) */
  cx: number;
  cy: number;
  capR: number;
}

function smooth01(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

const rampTmp = { d: 0, s: 0 };
/** Distance from a point to a ramp's polyline, and how far along it (from the top) the nearest point lies. */
function rampAt(r: Ramp, px: number, py: number): { d: number; s: number } {
  let best = Infinity;
  let bs = 0;
  let acc = 0;
  for (let k = 1; k < r.xs.length; k++) {
    const ax = r.xs[k - 1];
    const ay = r.ys[k - 1];
    const bx = r.xs[k] - ax;
    const by = r.ys[k] - ay;
    const L2 = bx * bx + by * by || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / L2));
    const d = Math.hypot(px - ax - bx * t, py - ay - by * t);
    const L = Math.sqrt(L2);
    if (d < best) {
      best = d;
      bs = acc + t * L;
    }
    acc += L;
  }
  rampTmp.d = best;
  rampTmp.s = bs;
  return rampTmp;
}
