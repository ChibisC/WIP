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
    tLeaf: { value: null as unknown as THREE.DataTexture },
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
  private leafData: Uint8Array;
  private leafTex: THREE.DataTexture;
  private chunks = new Map<number, THREE.Mesh>();
  private built = false;
  readonly sites: THREE.Group = new THREE.Group();

  constructor(
    public grid: NestGrid,
    kinds: Uint8Array,
    private height: number,
    /** the leaf blades (ellipses, mm): each leaf cell gets leaf-local coordinates for the midrib and the side veins */
    private leaves: Array<{ at: readonly [number, number]; rx: number; ry: number; rot: number }> = [],
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
    this.leafData = new Uint8Array(n * 4);
    this.leafTex = new THREE.DataTexture(this.leafData, g.w, g.h, THREE.RGBAFormat);
    this.leafTex.magFilter = this.leafTex.minFilter = THREE.LinearFilter;
    this.leafTex.flipY = false;
    const u = this.uniforms;
    u.tData.value = this.dataTex;
    u.tLeaf.value = this.leafTex;
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
      fragmentHeader: `uniform sampler2D tData; uniform sampler2D tLeaf; uniform vec2 uRaster; uniform float uCell;
varying vec4 vCan;
float canRough = 0.8; vec3 canEmis = vec3(0.0);
vec3 canopyColor(vec3 wp, float leaf, float sd, float kind, vec4 lv, out float rough, out vec3 emis) {
  vec2 p = wp.xz;
  // bark: ridges running along the branch (lines of equal distance from its edge), split by cracks, with plates of
  // lichen on the older wood and moss in the damp middle of the thick branches
  // (the ridges follow the edge but wander and break up, and fade to plain bark in the middle of thick wood and on
  // the trunk tops, so a wide stretch does not read as rings)
  float wob = fbm(p * 0.11) * 9.0 + fbm(p * 0.4 + 9.0) * 3.0;
  float ridge = 0.5 + 0.5 * sin(sd * 4.2 + wob);
  ridge = smoothstep(0.3, 0.8, ridge) * (0.5 + 0.5 * vnoise(p * 0.25 + 3.0)) * smoothstep(7.0, 3.0, sd);
  ridge += smoothstep(3.0, 7.0, sd) * (0.15 + 0.35 * fbm(p * 0.3 + 21.0));
  float crack = smoothstep(0.64, 0.7, fbm(p * 0.21 + 5.0));
  vec3 bark = mix(vec3(0.09, 0.06, 0.035), vec3(0.24, 0.165, 0.1), ridge);
  bark *= 0.8 + 0.3 * vnoise(p * 1.7);
  bark = mix(bark, vec3(0.07, 0.05, 0.03), crack * 0.85);
  float lichen = smoothstep(0.66, 0.74, fbm(p * 0.07 + 11.0)) * smoothstep(0.35, 0.6, vnoise(p * 0.9));
  bark = mix(bark, vec3(0.46, 0.52, 0.38), lichen * 0.45);
  float moss = smoothstep(0.6, 0.78, fbm(p * 0.1 - 3.0)) * smoothstep(2.5, 5.0, sd);
  bark = mix(bark, vec3(0.16, 0.3, 0.1), moss * 0.6);
  // leaves: a blade with a midrib down its length (lv.x along, lv.y across, 0..1; lv.z 1 where a blade was found),
  // side veins leaving the midrib at a slant, finer veins between, the cells between them a little paler, the margin
  // yellower; the sun through the blade gives it a faint glow
  float blade = vnoise(p * 0.045 + 7.0);
  vec3 lf = mix(vec3(0.12, 0.3, 0.07), vec3(0.2, 0.42, 0.1), blade);
  float along = lv.x;
  float across = lv.y - 0.5;
  float mid = smoothstep(0.035, 0.012, abs(across)) * lv.z;
  float sideCoord = along * 9.0 + abs(across) * 2.2;
  float side = smoothstep(0.1, 0.03, abs(fract(sideCoord) - 0.5)) * smoothstep(0.02, 0.08, abs(across)) * lv.z;
  float fine = smoothstep(0.07, 0.02, abs(fract(vnoise(p * 0.22 + 4.0) * 6.0) - 0.5)) * 0.35;
  float cells = vnoise(p * 0.5 + 1.0) * 0.14;
  lf *= 1.0 + cells - 0.3 * max(side, fine);
  lf = mix(lf, vec3(0.5, 0.6, 0.22), mid * 0.8);
  lf = mix(lf, vec3(0.34, 0.46, 0.13), smoothstep(2.4, 0.0, sd) * 0.5);
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
            vec4 _lv = texture2D(tLeaf, _uv);
            diffuseColor.rgb = canopyColor(vWP, _d.g, _sd, _d.b * 8.0, _lv, _rough, _emis);
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
    this.bakeLeafUV();
  }

  /** Leaf-local coordinates per cell: for each leaf cell the blade it lies in (the nearest ellipse that holds it). */
  private bakeLeafUV(): void {
    const g = this.grid;
    const W = g.w;
    const H = g.h;
    const L = this.leaves;
    this.leafData.fill(0);
    if (!L.length) {
      this.leafTex.needsUpdate = true;
      return;
    }
    // a coarse bucket grid over the leaves so each cell tests only the blades near it
    const B = 64;
    const bw = Math.ceil(g.widthMm / B) + 1;
    const bh = Math.ceil(g.depthMm / B) + 1;
    const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
    L.forEach((l, i) => {
      const m = Math.max(l.rx, l.ry) + 4;
      for (let by = Math.max(0, Math.floor((l.at[1] - m) / B)); by <= Math.min(bh - 1, Math.floor((l.at[1] + m) / B)); by++)
        for (let bx = Math.max(0, Math.floor((l.at[0] - m) / B)); bx <= Math.min(bw - 1, Math.floor((l.at[0] + m) / B)); bx++) buckets[by * bw + bx].push(i);
    });
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (this.leaf[k] < 0.05) continue;
        const px = (x + 0.5) * g.cell;
        const py = (y + 0.5) * g.cell;
        const bk = buckets[Math.min(bh - 1, Math.floor(py / B)) * bw + Math.min(bw - 1, Math.floor(px / B))];
        let best = -1;
        let bd = Infinity;
        let bu = 0;
        let bv = 0;
        for (const i of bk) {
          const l = L[i];
          const dx = px - l.at[0];
          const dy = py - l.at[1];
          const c = Math.cos(-l.rot);
          const sn = Math.sin(-l.rot);
          const lx = dx * c - dy * sn;
          const ly = dx * sn + dy * c;
          const d = (lx * lx) / (l.rx * l.rx) + (ly * ly) / (l.ry * l.ry);
          if (d < bd) {
            bd = d;
            best = i;
            bu = lx / (l.rx * 2) + 0.5;
            bv = ly / (l.ry * 2) + 0.5;
          }
        }
        if (best < 0 || bd > 1.6) continue;
        const i = k * 4;
        this.leafData[i] = Math.round(Math.min(1, Math.max(0, bu)) * 255);
        this.leafData[i + 1] = Math.round(Math.min(1, Math.max(0, bv)) * 255);
        this.leafData[i + 2] = 255;
        this.leafData[i + 3] = 255;
      }
    this.leafTex.needsUpdate = true;
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
    const sdv = this.sdAt(px, py) + (valueNoise2(px * 0.13, py * 0.13, 7) - 0.5) * 0.3;
    const leaf = this.leafAt(px, py);
    // the walkable top is flat (a creature standing on it, legs wide, stays on the surface — user 2026-11-08: nothing
    // sinks in): the bark rounds off only within about a cell and a half of the edge
    const edge = this.grid.cell * 1.6;
    const t = Math.max(0, Math.min(1, (sdv + 0.5) / edge));
    const round = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    const wood = this.wallH * (0.94 + 0.06 * valueNoise2(px * 0.06, py * 0.06, 5)) * round;
    const lf = this.wallH * (0.9 + 0.04 * valueNoise2(px * 0.03, py * 0.03, 3)) * round;
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
  caughtUp(version: number): boolean {
    void version;
    return this.built;
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
