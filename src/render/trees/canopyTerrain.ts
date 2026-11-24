import * as THREE from 'three';
import { prof } from '../../core/profiler';
import { NestGrid } from '../../world/nestGrid';
import type { HexVisual } from '../nest/nestTerrain';
import type { AreaTerrain } from '../nest/areaTerrain';
import { TK_FLOWER, TK_LEAF, TK_TOP, TK_WOOD } from '../../sim/trees';
import type { CanopyData } from '../../sim/trees';
import { TREES as T } from '../../sim/balance';
import type { World } from '../../sim/world';
import { AS, TREES } from '../../sim/types';
import { buildWood, canopyCover, floorDrop, woodMaterial } from './woodMesh';
import { buildFoliage, FoliageBuild, HAS_BIG, leafMaterials } from './foliage';
import type { TreeMaps } from './barkBake';

/**
 * The trees seen from above, tilted (claude/trees/02-spec-trees-look-and-tiers.md; CHANGE_PLAN §38.2): the crowns as
 * round 3D wood with each species' bark (woodMesh.ts), leaves in clusters with the big ones as platforms
 * (foliage.ts), the trunks rising out of the haze from the ground far below (the view's backdrop).
 *
 * The floor units walk on is the simulation's (sim/treeCrowns.ts `paintCanopy`, `World.treesData`): per fine cell its
 * height over the canopy plane, rounded off toward the edge of each piece's walkable band by the same curve as the
 * drawn wood's flat top (`floorDrop`), lowered on a big leaf by its bend. `floorAt` interpolates it, so an ant stands on
 * the wood it is drawn on, up and down the sloping branches. It implements `AreaTerrain`, so the nest's own `NestView`
 * draws the ants, food, creatures and markers on it.
 */
export class CanopyTerrain implements AreaTerrain {
  group = new THREE.Group();
  /** the tiers' spacing: what the view and the camera treat as the walls' height */
  readonly wallH: number;
  readonly uniforms = {
    uGrid: { value: 0 },
    uGhost: { value: new THREE.Vector4() },
    uGhostCol: { value: new THREE.Color(0.5, 0.9, 0.4) },
    uMarkerCols: { value: Array.from({ length: 7 }, () => new THREE.Color()) },
    uSelected: { value: new THREE.Vector3(0, 0, 0) },
    uCarton: { value: 0 },
    uEntR: { value: 0 },
  };
  /** per fine cell: the walked surface's height (mm; −1 no floor), before a big leaf's bend */
  private floor: Float32Array;
  /** per cell: 1 + the big leaf it lies on (0 none) and how far that leaf bends there at full load (mm) */
  private leafOf: Int16Array;
  private leafK: Float32Array;
  /** per big leaf: its bend now (0…1) */
  private sag: Float32Array;
  private foliage: FoliageBuild;
  readonly sites: THREE.Group = new THREE.Group();
  readonly wood: THREE.Group;
  readonly woodMat: THREE.MeshStandardMaterial;

  constructor(
    public grid: NestGrid,
    private data: CanopyData,
    private height: number,
    maps: TreeMaps,
  ) {
    const t0 = performance.now();
    const g = grid;
    this.wallH = T.tierStep;
    const n = g.w * g.h;
    this.floor = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const h = data.h[k];
      if (h < 0) this.floor[k] = -1;
      else if (data.kind[k] === TK_LEAF) this.floor[k] = h;
      else this.floor[k] = h - floorDrop(data.rad[k], (data.lat[k] / 255) * T.walkShare);
    }
    // the big leaves under the floor: which, and how far each cell of it goes down at full load (the blade's bend,
    // foliage.ts: 0.05 × its length × the square of the way from its stalk)
    this.leafOf = new Int16Array(n);
    this.leafK = new Float32Array(n);
    let li = 0;
    for (const sk of data.skels) {
      if (!HAS_BIG[sk.style]) continue;
      for (const l of sk.leaves) {
        li++;
        const len = l.rx * 2.15;
        const c = Math.cos(l.rot);
        const s = Math.sin(l.rot);
        const px = l.x - c * len * 0.5;
        const py = l.y - s * len * 0.5;
        const m = Math.max(l.rx, l.ry) + g.cell;
        for (let j = Math.max(0, Math.floor((l.y - m) / g.cell)); j <= Math.min(g.h - 1, Math.floor((l.y + m) / g.cell)); j++)
          for (let i = Math.max(0, Math.floor((l.x - m) / g.cell)); i <= Math.min(g.w - 1, Math.floor((l.x + m) / g.cell)); i++) {
            const k = j * g.w + i;
            if (data.kind[k] !== TK_LEAF || Math.abs(data.h[k] - l.z) > 0.01) continue;
            const x = (i + 0.5) * g.cell;
            const y = (j + 0.5) * g.cell;
            const lx = (x - l.x) * c + (y - l.y) * s;
            const ly = -(x - l.x) * s + (y - l.y) * c;
            if ((lx * lx) / (l.rx * l.rx) + (ly * ly) / (l.ry * l.ry) > 1.05) continue;
            const along = Math.max(0, Math.min(1, ((x - px) * c + (y - py) * s) / len));
            this.leafOf[k] = li;
            this.leafK[k] = 0.05 * len * along * along;
          }
      }
    }
    this.sag = new Float32Array(li);
    this.woodMat = woodMaterial(maps);
    const mats = leafMaterials(maps);
    this.foliage = buildFoliage(data, maps, (x, y) => this.rawFloor(x, y), mats);
    this.wood = buildWood(data, this.woodMat, this.foliage.fineTwigs);
    this.coverTex = this.bakeCover(this.foliage.cover);
    this.group.add(this.wood, this.foliage.group, this.sites);
    let tris = 0;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.index) tris += (m.geometry.index.count / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
    });
    prof.note(`canopy: ${this.wood.children.length} wood chunks, ${this.foliage.trees.reduce((a, t) => a + t.near.count, 0)} leaves, ${(tris / 1000).toFixed(0)}k triangles (${(performance.now() - t0).toFixed(0)} ms)`);
  }

  private coverTex: THREE.DataTexture;
  /** per big leaf: the load on it this frame (scratch) */
  private load: Float32Array | null = null;

  /**
   * The plan map of the leaf cover (4 mm a texel): R how thick the leaves are overhead, G the height of their top
   * (−160…160 mm); blurred a little. The wood and the leaves under it are lit greener (woodMesh.ts `coverPatch`).
   */
  private bakeCover(cover: number[]): THREE.DataTexture {
    const g = this.grid;
    const S = 4;
    const W = Math.ceil(g.widthMm / S);
    const H = Math.ceil(g.depthMm / S);
    const dens = new Float32Array(W * H);
    const top = new Float32Array(W * H).fill(-160);
    for (let i = 0; i < cover.length; i += 4) {
      const x = cover[i];
      const y = cover[i + 1];
      const z = cover[i + 2];
      const r = cover[i + 3];
      const i0 = Math.max(0, Math.floor((x - r) / S));
      const i1 = Math.min(W - 1, Math.floor((x + r) / S));
      const j0 = Math.max(0, Math.floor((z - r) / S));
      const j1 = Math.min(H - 1, Math.floor((z + r) / S));
      for (let j = j0; j <= j1; j++)
        for (let ii = i0; ii <= i1; ii++) {
          const k = j * W + ii;
          dens[k] = Math.min(1, dens[k] + 0.3);
          top[k] = Math.max(top[k], y);
        }
    }
    const data = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        let s = 0;
        let n = 0;
        let t = -160;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
            s += dens[jj * W + ii];
            n++;
            t = Math.max(t, top[jj * W + ii]);
          }
        const k = (j * W + i) * 4;
        data[k] = Math.round((s / n) * 255);
        data[k + 1] = Math.round(((Math.min(160, t) + 160) / 320) * 255);
        data[k + 3] = 255;
      }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    canopyCover.tCover.value = tex;
    canopyCover.uCoverSize.value.set(W * S, H * S);
    return tex;
  }

  /** the floor's height at a cell (−1 none), for the leaves' check */
  private rawFloor(x: number, y: number): number {
    const g = this.grid;
    const i = Math.floor(x / g.cell);
    const j = Math.floor(y / g.cell);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return -1;
    return this.data.h[j * g.w + i];
  }

  private cellFloor(k: number): number {
    const f = this.floor[k];
    if (f < 0) return f;
    const l = this.leafOf[k];
    return l ? f - this.sag[l - 1] * this.leafK[k] : f;
  }

  /**
   * The walked surface at a point (mm over the canopy plane): the floor cells round it interpolated (only floor cells
   * count); off the floor the nearest floor within three cells, else the canopy plane (tier 0).
   */
  floorAt(px: number, py: number): number {
    const g = this.grid;
    const fx = px / g.cell - 0.5;
    const fy = py / g.cell - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const u = fx - x0;
    const v = fy - y0;
    let s = 0;
    let wsum = 0;
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const f = this.cellFloor(y * g.w + x);
        if (f < 0) continue;
        const wgt = (dx ? u : 1 - u) * (dy ? v : 1 - v);
        s += f * wgt;
        wsum += wgt;
      }
    if (wsum > 1e-4) return s / wsum;
    const ci = Math.floor(px / g.cell);
    const cj = Math.floor(py / g.cell);
    for (let r = 1; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = ci + dx;
          const y = cj + dy;
          if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
          const f = this.cellFloor(y * g.w + x);
          if (f >= 0) return f;
        }
    return 0;
  }

  /** the drawn surface the camera, the markers and the cursor go by: the walked one */
  heightAt(px: number, py: number): number {
    return this.floorAt(px, py);
  }

  normalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.grid.cell * 0.6;
    const hx = this.floorAt(px + e, py) - this.floorAt(px - e, py);
    const hz = this.floorAt(px, py + e) - this.floorAt(px, py - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  floorNormalAt(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
    return this.normalAt(px, py, out);
  }

  /**
   * Each frame in the trees: the big leaves bend toward the load on them (ants and creatures standing there), the
   * leaves far from the camera are drawn by their coarse twins.
   */
  frame(w: World, cam: THREE.Camera, dt: number): void {
    const big = this.foliage.big;
    if (big && this.sag.length) {
      const load = (this.load ??= new Float32Array(this.sag.length));
      load.fill(0);
      const g = this.grid;
      const add = (x: number, y: number, m: number) => {
        const i = Math.floor(x / g.cell);
        const j = Math.floor(y / g.cell);
        if (i < 0 || j < 0 || i >= g.w || j >= g.h) return;
        const l = this.leafOf[j * g.w + i];
        if (l) load[l - 1] += m;
      };
      for (const a of w.s.ants) if (a.space === TREES && a.state !== AS.Dead && a.state !== AS.Flung) add(a.x, a.y, 1);
      for (const c of w.s.creatures) if (c.space === TREES && !c.dead) add(c.x, c.y, 4 * c.scale);
      const A = big.geometry.getAttribute('aLeafA') as THREE.InstancedBufferAttribute;
      let changed = false;
      const k = Math.min(1, dt * 4);
      for (let i = 0; i < this.sag.length; i++) {
        const want = Math.min(1, load[i] / 6);
        const s = this.sag[i] + (want - this.sag[i]) * k;
        if (Math.abs(s - this.sag[i]) > 1e-4) {
          this.sag[i] = s;
          A.setW(i, s);
          changed = true;
        }
      }
      if (changed) A.needsUpdate = true;
    }
    const cp = cam.position;
    for (const t of this.foliage.trees) {
      const far = cp.distanceTo(t.c) > 560;
      t.near.visible = !far;
      t.far.visible = far;
      if (far) t.far.count = Math.ceil(t.near.count * 0.6);
    }
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
    return 0;
  }
  caughtUp(version: number): boolean {
    void version;
    return true;
  }
  update(force = false, budgetMs = Infinity): void {
    void force;
    void budgetMs;
  }
  rebuildAll(): void {}
  setShadows(on: boolean): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = on;
    });
  }

  /** The canopy's height over the ground (the backdrop's distance; the fall). */
  get groundDrop(): number {
    return this.height;
  }

  /** the floor's kind by cell (the minimap draws the canopy from it) */
  kindAtCell(k: number): number {
    return this.data.h[k] >= 0 ? this.data.kind[k] : 0;
  }
}

export { TK_WOOD, TK_TOP, TK_FLOWER };
