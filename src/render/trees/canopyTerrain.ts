import * as THREE from 'three';
import { prof } from '../../core/profiler';
import { NEST_CHUNK, NestGrid } from '../../world/nestGrid';
import { addPatch, dapplePatch, globalUniforms, WORLD_POS_PATCH } from '../shaderPatch';
import { boxBlur, borderBlur, chamfer, HexVisual } from '../nest/nestTerrain';
import type { AreaTerrain } from '../nest/areaTerrain';
import { TK_FLOWER, TK_LEAF, TK_TOP, TK_WOOD } from '../../sim/trees';
import { valueNoise2 } from '../../core/rng';

/** Vertices per raster cell edge (the canopy is static and large: one vertex a cell). */
const SUB = 1;

/**
 * The canopy seen from above (claude/trees/01-spec-trees-layer.md §4): the Trees grid's walkable hexes — branches,
 * twigs, leaves, trunk tops — as a chunked heightfield from a signed distance field of the walkable raster, only where
 * a chunk has any; everything else is sky (discarded) and the ground far below shows through the backdrop. Wood is a
 * rounded bark profile with ridges, lichen and moss; leaves are flat, slightly domed platforms with veins and a
 * translucent glow; dappled light drifts over everything; a gentle sway (render only) rocks the leaves.
 * It implements `AreaTerrain`, so the nest's own `NestView` draws the ants, food, creatures and markers on it.
 */
export class CanopyTerrain implements AreaTerrain {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  /** the branch surface's height over the canopy plane (mm) */
  readonly wallH: number;
  readonly uniforms = {
    tData: { value: null as unknown as THREE.DataTexture },
    uRaster: { value: new THREE.Vector2() },
    uCell: { value: 1 },
    uWoodH: { value: 1 },
    uSway: { value: 1 },
    uGrid: { value: 0 },
    uGhost: { value: new THREE.Vector4() },
    uGhostCol: { value: new THREE.Color(0.5, 0.9, 0.4) },
    uMarkerCols: { value: Array.from({ length: 7 }, () => new THREE.Color()) },
    uSelected: { value: new THREE.Vector3(0, 0, 0) },
    uCarton: { value: 0 },
    uEntR: { value: 0 },
  };
  private sd: Float32Array;
  /** per cell: the walkable kind (0 sky, 1 wood, 2 leaf, 3 top, 4 flower) */
  private kindCell: Uint8Array;
  /** per cell: leafiness 0..1 (a blur of the leaf cells: wood blends into leaf where they meet) */
  private leaf: Float32Array<ArrayBufferLike>;
  private data: Uint8Array;
  private dataTex: THREE.DataTexture;
  private chunks = new Map<number, THREE.Mesh>();
  private built = false;
  readonly sites: THREE.Group = new THREE.Group();

  constructor(
    public grid: NestGrid,
    kinds: Uint8Array,
    private height: number,
  ) {
    const g = grid;
    this.wallH = g.R * 1.3;
    const n = g.w * g.h;
    this.sd = new Float32Array(n);
    this.kindCell = new Uint8Array(n);
    this.leaf = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const q = g.cellHex[k];
      this.kindCell[k] = q >= 0 ? kinds[q] : 0;
    }
    this.data = new Uint8Array(n * 4);
    this.dataTex = new THREE.DataTexture(this.data, g.w, g.h, THREE.RGBAFormat);
    this.dataTex.magFilter = this.dataTex.minFilter = THREE.LinearFilter;
    this.dataTex.flipY = false;
    const u = this.uniforms;
    u.tData.value = this.dataTex;
    u.uRaster.value.set(g.w, g.h);
    u.uCell.value = g.cell;
    u.uWoodH.value = this.wallH;
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, envMapIntensity: 0.35, side: THREE.DoubleSide });
    addPatch(this.material, WORLD_POS_PATCH);
    addPatch(this.material, dapplePatch());
    addPatch(this.material, {
      key: 'canopy',
      uniforms: { ...u, uTime: globalUniforms.uTime },
      vertexHeader: `uniform float uTime; uniform float uSway; uniform sampler2D tData; uniform vec2 uRaster; uniform float uCell; varying vec4 vCan;`,
      vertex: [
        [
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec2 _uv = (vec2(position.x, position.z) / uCell + 0.5) / uRaster;
            vCan = texture2D(tData, _uv);
            // the sway (render only): leaves rock a little in the breeze, wood hardly at all
            float _leaf = vCan.g;
            float _sw = (0.35 + 1.1 * _leaf) * uSway;
            transformed.y += sin(uTime * 1.3 + position.x * 0.021 + position.z * 0.017) * _sw * 0.6 + sin(uTime * 0.7 + position.z * 0.031) * _sw * 0.4;
          }`,
        ],
      ],
      // (uTime and the noise come with the dapple patch, applied before this one)
      fragmentHeader: `uniform sampler2D tData; uniform vec2 uRaster; uniform float uCell;
varying vec4 vCan;
float canRough = 0.8; vec3 canEmis = vec3(0.0);
vec3 canopyColor(vec3 wp, float leaf, float sd, float kind, out float rough, out vec3 emis) {
  vec2 p = wp.xz;
  // bark: ridges running along the branch (lines of equal distance from its edge), split by cracks, with plates of
  // lichen on the older wood and moss in the damp middle of the thick branches
  float wob = fbm(p * 0.11) * 5.0;
  float ridge = 0.5 + 0.5 * sin(sd * 4.2 + wob + vnoise(p * 0.6) * 1.5);
  ridge = smoothstep(0.3, 0.8, ridge) * (0.6 + 0.4 * vnoise(p * 0.25 + 3.0));
  float crack = smoothstep(0.64, 0.7, fbm(p * 0.21 + 5.0));
  vec3 bark = mix(vec3(0.13, 0.09, 0.055), vec3(0.30, 0.21, 0.13), ridge);
  bark *= 0.85 + 0.3 * vnoise(p * 1.7);
  bark = mix(bark, vec3(0.07, 0.05, 0.03), crack * 0.85);
  float lichen = smoothstep(0.66, 0.74, fbm(p * 0.07 + 11.0)) * smoothstep(0.35, 0.6, vnoise(p * 0.9));
  bark = mix(bark, vec3(0.5, 0.56, 0.42), lichen * 0.6);
  float moss = smoothstep(0.6, 0.78, fbm(p * 0.1 - 3.0)) * smoothstep(2.5, 5.0, sd);
  bark = mix(bark, vec3(0.16, 0.3, 0.1), moss * 0.6);
  // leaves: blade green mottled by the light, lighter at the rim, a paler midrib-like streak now and then; a soft
  // translucent glow where the sun comes through
  float blade = vnoise(p * 0.045 + 7.0);
  vec3 lf = mix(vec3(0.14, 0.36, 0.09), vec3(0.3, 0.52, 0.13), blade);
  lf = mix(lf, vec3(0.42, 0.56, 0.17), smoothstep(2.2, 0.0, sd) * 0.5);
  float rib = smoothstep(0.08, 0.0, abs(fbm(p * 0.06 + 2.0) - 0.5)) * 0.35;
  lf = mix(lf, vec3(0.5, 0.6, 0.24), rib);
  float flower = step(3.5, kind);
  lf = mix(lf, vec3(0.88, 0.5, 0.6), flower * smoothstep(0.45, 0.6, vnoise(p * 0.5)));
  vec3 c = mix(bark, lf, leaf);
  rough = mix(0.9, 0.6, leaf);
  emis = lf * leaf * 0.025 * (0.6 + 0.4 * vnoise(p * 0.02 + uTime * 0.05));
  return c;
}`,
      fragment: [
        [
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec2 _uv = (vWP.xz / uCell + 0.5) / uRaster;
            vec4 _d = texture2D(tData, _uv);
            float _sd = (_d.r - 0.5) * 16.0;
            if (_sd < -0.45) discard;
            float _rough; vec3 _emis;
            diffuseColor.rgb = canopyColor(vWP, _d.g, _sd, _d.b * 8.0, _rough, _emis);
            // the branch's rounded edge: darker underneath the curve
            diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(-0.4, 2.0, _sd));
            canRough = _rough;
            canEmis = _emis;
          }`,
        ],
        ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = canRough;'],
        ['#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += canEmis;'],
      ],
    });
    this.group.add(this.sites);
    this.rebuildAll();
  }

  // ------------------------------------------------------------------ SDF + data
  private computeSignedDistance(): void {
    const g = this.grid;
    const W = g.w;
    const H = g.h;
    const INF = 1e6;
    const dA = new Float32Array(W * H);
    const dS = new Float32Array(W * H);
    const air = (k: number) => this.kindCell[k] !== 0;
    for (let k = 0; k < W * H; k++) {
      dA[k] = air(k) ? INF : 0;
      dS[k] = air(k) ? 0 : INF;
    }
    chamfer(dA, W, H);
    chamfer(dS, W, H);
    for (let k = 0; k < W * H; k++) this.sd[k] = air(k) ? dA[k] - 0.5 : -(dS[k] - 0.5);
    let src: Float32Array = this.sd;
    let dst: Float32Array = new Float32Array(W * H);
    for (let pass = 0; pass < 4; pass++) {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const k = y * W + x;
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) dst[k] = borderBlur(src, W, H, x, y);
          else dst[k] = (src[k - W - 1] + src[k - W] + src[k - W + 1] + src[k - 1] + src[k] * 2 + src[k + 1] + src[k + W - 1] + src[k + W] + src[k + W + 1]) / 10;
        }
      const t = src;
      src = dst;
      dst = t;
    }
    if (src !== this.sd) this.sd.set(src);
    // leafiness: the leaf cells blurred a little, so wood turns into leaf over a couple of cells
    const lf = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) lf[k] = this.kindCell[k] === TK_LEAF || this.kindCell[k] === TK_FLOWER ? 1 : 0;
    this.leaf = boxBlur(lf, W, H, 1, 2);
    for (let k = 0; k < W * H; k++) {
      const i = k * 4;
      this.data[i] = Math.round((Math.max(-8, Math.min(8, this.sd[k])) / 16 + 0.5) * 255);
      this.data[i + 1] = Math.round(Math.min(1, this.leaf[k]) * 255);
      this.data[i + 2] = Math.round((this.kindCell[k] / 8) * 255);
      this.data[i + 3] = 255;
    }
    this.dataTex.needsUpdate = true;
  }

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

  private leafAt(px: number, py: number): number {
    const g = this.grid;
    const x = Math.min(g.w - 1, Math.max(0, Math.round(px / g.cell - 0.5)));
    const y = Math.min(g.h - 1, Math.max(0, Math.round(py / g.cell - 0.5)));
    return this.leaf[y * g.w + x];
  }

  /**
   * The canopy surface (mm over the canopy plane): wood is a rounded log (a half-ellipse profile over the signed
   * distance), leaves a thin platform slightly domed; outside the walkable set it curls under and is discarded.
   */
  heightAt(px: number, py: number): number {
    const sdv = this.sdAt(px, py) + (valueNoise2(px * 0.13, py * 0.13, 7) - 0.5) * 0.4;
    const leaf = this.leafAt(px, py);
    const R = this.grid.R * 0.75;
    const t = Math.max(0, Math.min(1, (sdv + 0.5) / R));
    const wood = this.wallH * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    // (a leaf lies flush with the wood's top: a thin, slightly domed blade, never a pit in the branch)
    const lf = this.wallH * (0.86 + 0.1 * Math.sqrt(t)) + valueNoise2(px * 0.03, py * 0.03, 3) * 0.8;
    let h = wood * (1 - leaf) + lf * leaf;
    if (sdv < -0.5) h = -1.5 * Math.min(1, (-0.5 - sdv) / 2);
    return h;
  }

  normalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.grid.cell * 0.6;
    const hx = this.heightAt(px + e, py) - this.heightAt(px - e, py);
    const hz = this.heightAt(px, py + e) - this.heightAt(px, py - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  /** The ants walk the top of the branches (the same surface). */
  floorAt(px: number, py: number): number {
    return Math.max(0, this.heightAt(px, py));
  }

  floorNormalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    return this.normalAt(px, py, out);
  }

  // ------------------------------------------------------------------ AreaTerrain (nothing of the nest's here)
  setHexes(get: (q: number) => HexVisual | null): void {
    void get;
  }
  setShut(tops: number[]): void {
    void tops;
  }
  isShut(top: number): boolean {
    void top;
    return false;
  }
  setSealed(hexes: ReadonlySet<number> | null): void {
    void hexes;
  }
  setFog(level: ((q: number) => number) | null): void {
    void level;
  }
  get dirty(): number {
    return this.built ? 0 : 1;
  }
  update(force = false, budgetMs = Infinity): void {
    void budgetMs;
    if (this.built && !force) return;
    this.rebuildAll();
  }
  setShadows(on: boolean): void {
    for (const m of this.chunks.values()) m.castShadow = on;
  }

  // ------------------------------------------------------------------ meshing
  rebuildAll(): void {
    const t0 = performance.now();
    this.computeSignedDistance();
    const g = this.grid;
    const cw = Math.ceil(g.w / NEST_CHUNK);
    const ch = Math.ceil(g.h / NEST_CHUNK);
    let n = 0;
    for (let ci = 0; ci < cw * ch; ci++) if (this.buildChunk(ci)) n++;
    this.built = true;
    prof.note(`canopy mesh: ${n} chunks (${(performance.now() - t0).toFixed(0)} ms)`);
  }

  /** A chunk gets a mesh only when something walkable lies in or near it. */
  private buildChunk(ci: number): boolean {
    const g = this.grid;
    const cw = Math.ceil(g.w / NEST_CHUNK);
    const cx = ci % cw;
    const cy = Math.floor(ci / cw);
    const x0 = cx * NEST_CHUNK;
    const y0 = cy * NEST_CHUNK;
    if (y0 >= g.h) return false;
    const x1 = Math.min(g.w, x0 + NEST_CHUNK);
    const y1 = Math.min(g.h, y0 + NEST_CHUNK);
    let any = false;
    for (let y = Math.max(0, y0 - 2); y < Math.min(g.h, y1 + 2) && !any; y++) for (let x = Math.max(0, x0 - 2); x < Math.min(g.w, x1 + 2); x++) if (this.kindCell[y * g.w + x]) {
      any = true;
      break;
    }
    if (!any) return false;
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
    return true;
  }

  /** The canopy's height over the ground (the backdrop's distance; the fall). */
  get groundDrop(): number {
    return this.height;
  }

  /** kinds by cell (the minimap draws the canopy from it) */
  kindAtCell(k: number): number {
    return this.kindCell[k];
  }
}

export { TK_WOOD, TK_TOP };
