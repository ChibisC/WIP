import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { fbm2 } from '../core/rng';
import { addPatch, patchDapple } from './shaderPatch';
import { textures } from './textures';
import { bakeRendererNow } from './bake/detailBake';
import { GL, GL_COUNT, GL_RELIEF, GL_TILE, bakeGround } from './ground/groundBake';
import { RAMP_SIDE, nearestOnPath } from '../world/layers';
import { inShape } from '../world/mapShapes';
import { buildBankSculpt } from './ground/bankSculpt';
import { setMapMood } from './mapBiomes';

/** Size of one legacy texture tile in mm (the uv the tangent frame follows). */
const TILE = 70;

/**
 * The surface ground (ground realism, docs/maps/realism.md): a heightfield over the playable area plus a skirt beyond
 * the edges, shaded from the baked ground layers (render/ground/groundBake.ts).
 *
 *  - Which layers: the map's four cover channels (soil, grass/moss, sand, litter) map to real ground types by biome
 *    (garden loam and a grass sward on a meadow, red laterite and dry grass on the savanna, humus and moss in a
 *    forest…), plus gravel on pebbly shelves, wet mud along water, worn compacted soil on ramp walkways and the bank
 *    faces (soil strata, rock ledges, root walls, sand and clay cuts), chosen by steepness and the layer's edge style.
 *  - No repeats: every layer is sampled with stochastic tiling (three randomly offset and rotated samples blended
 *    over a triangle grid, by height), plus two scales of macro colour variation.
 *  - Light: baked cavity shadows in the hollows, height-field ambient occlusion at the foot of banks, a drier lip.
 *  - Wetness: darker and glossier (less rough, flatter bumps) near water, in flood zones while flooded and drying
 *    for minutes after, and a little everywhere after a storm; dew glints on the morning maps.
 *  - Units stay readable (user 2026-11-01, 23:50): ground detail fades toward each layer's mean colour with camera
 *    distance, and the ground's luminance is kept in a band so dark and rust-coloured ants and creatures stand out.
 *
 * Nothing here touches the simulation: everything is read from the terrain (heights, cover, water, layers, flood
 * levels) and time.
 */
/**
 * Performance v3: the heightfield is drawn in square chunks, each a mesh sharing the one set of vertex attributes with
 * its own index and a bounding sphere from its own vertices, so the renderer culls the chunks out of view instead of
 * shading all ~150 000 vertices of the map and its skirt each frame — the same triangles where they are seen (opaque and
 * depth-tested: the draw order between chunks changes nothing drawn).
 */
const TERRAIN_CHUNKS = 5;

/**
 * A heightfield index's triangles binned into `chunks` × `chunks` blocks of quads (the grid is nx × ny vertices; quad
 * (i, j) has corner a = j·nx + i and the triangles (a, c, b), (b, c, d) with b = a + 1, c = a + nx, d = c + 1), each
 * block's triangles in the full index's order. Exported for tests.
 */
export function chunkTriangles(full: ArrayLike<number>, nx: number, ny: number, chunks: number): number[][] {
  const bx = Math.ceil((nx - 1) / chunks);
  const by = Math.ceil((ny - 1) / chunks);
  const lists: number[][] = [];
  for (let t = 0; t < full.length; t += 3) {
    // (the first triangle ends at its start + 1; the second starts at b: the quad's corner is a either way)
    const a = full[t + 2] === full[t] + 1 ? full[t] : full[t] - 1;
    const i = a % nx;
    const j = Math.floor(a / nx);
    const k = Math.min(chunks - 1, Math.floor(j / by)) * chunks + Math.min(chunks - 1, Math.floor(i / bx));
    (lists[k] ??= []).push(full[t], full[t + 1], full[t + 2]);
  }
  return lists;
}

export class TerrainMesh {
  /** the heightfield's chunks ('terrain' group; the bank sculpt is a child too) */
  mesh: THREE.Group;
  private chunks: THREE.Mesh[] = [];
  material: THREE.MeshStandardMaterial;
  /** sculpted bank faces and ramp sides (render/ground/bankSculpt.ts), sharing this material; null when flat */
  sculpt: THREE.Mesh | null = null;
  private geo: THREE.BufferGeometry;
  private step = 4;
  readonly margin: number;
  private nx: number;
  private ny: number;
  private builtVersion = -1;
  /** every channel written once (the water-only path writes two of them) */
  private everBuilt = false;
  /** each vertex's terrain sample and its fade beyond the map's edge (the water-only path) */
  private vSample: Int32Array | null = null;
  private vFade: Float64Array | null = null;
  private builtWater = -1;
  overlayUniforms = {
    uPhero: { value: null as THREE.Texture | null },
    uPheroOn: { value: 0 },
    uPheroColor: { value: new THREE.Color(0.55, 0.9, 1.0) },
    uMapSize: { value: new THREE.Vector2(1, 1) },
    uDesign: { value: null as THREE.Texture | null },
  };
  /** ground look (the map's mood; zone wetness) — updated by `update` */
  groundUniforms = {
    tGA: { value: null as THREE.Texture | null },
    tGN: { value: null as THREE.Texture | null },
    uChan: { value: new THREE.Vector4(GL.LOAM, GL.MOSS, GL.SAND, GL.HUMUS) },
    uInvTile: { value: GL_TILE.map((t) => 1 / t) },
    uZoneWet: { value: new THREE.Vector4(0, 0, 0, 0) },
    uStormWet: { value: 0 },
    uDew: { value: 0 },
    uRelief: { value: GL_RELIEF.slice() },
    /** stochastic-tiling cells per tile, per layer */
    uStoch: { value: GL_RELIEF.map((_, i) => (i === GL.SWARD || i === GL.DRY_SWARD ? 1.1 : i === GL.BANK_ROOT ? 1.4 : 2.6)) },
    uDetailFade: { value: 1 },
    /** 0..1: how much the gameplay-zoom ground calms its ant-sized contrast (user rule: units stay readable) */
    uReadable: { value: 1 },
    /** damp moss on the wet margins of water (0 on sandy and dry biomes) */
    uDampMoss: { value: 1 },
    uBand: { value: new THREE.Vector2(0.05, 0.22) },
    uFaceDefault: { value: GL.BANK_SOIL as number },
  };
  /** wetness left in each flood zone after it drains (0..1) and when it was last flooded (s, performance clock) */
  private zoneWet = [0, 0, 0, 0];
  private stormWet = 0;
  /** a story level's rain shower is falling (set by the session each frame): the ground wets as in a storm */
  raining = false;
  private lastT = 0;

  constructor(private terrain: Terrain, margin = 320) {
    this.margin = margin;
    const W = terrain.width + margin * 2;
    const D = terrain.depth + margin * 2;
    this.nx = Math.ceil(W / this.step) + 1;
    this.ny = Math.ceil(D / this.step) + 1;
    const n = this.nx * this.ny;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const x = -margin + i * this.step;
        const z = -margin + j * this.step;
        const k = j * this.nx + i;
        pos[k * 3] = x;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / TILE;
        uv[k * 2 + 1] = z / TILE;
      }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('cover', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    geo.setAttribute('g1', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    geo.setAttribute('g2', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo = geo;

    const tex = textures();
    const { r, quality } = bakeRendererNow();
    if (r) {
      const gm = bakeGround(r, quality >= 1 ? 512 : 256);
      this.groundUniforms.tGA.value = gm.a;
      this.groundUniforms.tGN.value = gm.n;
    }
    this.setBiome();
    // (normalMap only for the tangent frame: the ground's normals come from the baked layers)
    this.material = new THREE.MeshStandardMaterial({ normalMap: tex.soil.normal, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 });
    this.overlayUniforms.uMapSize.value.set(terrain.width, terrain.depth);
    patchDapple(this.material);
    addPatch(this.material, groundPatch(this.groundUniforms, this.overlayUniforms, tex.noise));
    this.mesh = new THREE.Group();
    this.mesh.name = 'terrain';
    this.rebuild();
  }

  /** The cover channels → ground layers of this map's biome (or procedural style), and its face and value band. */
  private setBiome(): void {
    const t = this.terrain;
    const u = this.groundUniforms;
    const biome = t.map?.biome ?? (t.params.style === 'forest' ? 'forest' : t.params.style === 'sandy' ? 'savanna' : t.params.style === 'riverbank' ? 'riverbank' : t.params.style === 'formicarium' ? 'formicarium' : 'meadow');
    if (biome === 'forest') u.uChan.value.set(GL.LOAM, GL.MOSS, GL.SAND, GL.HUMUS);
    else if (biome === 'rainforest') u.uChan.value.set(GL.HUMUS, GL.MOSS, GL.SAND, GL.HUMUS);
    else if (biome === 'riverbank') u.uChan.value.set(GL.LOAM, GL.SWARD, GL.SAND, GL.HUMUS);
    else if (biome === 'savanna') u.uChan.value.set(GL.LATERITE, GL.DRY_SWARD, GL.SAVANNA_SAND, GL.HUMUS);
    else if (biome === 'formicarium') u.uChan.value.set(GL.TRAIL, GL.MOSS, GL.SAND, GL.HUMUS);
    else u.uChan.value.set(GL.LOAM, GL.SWARD, GL.SAND, GL.HUMUS);
    u.uFaceDefault.value = biome === 'savanna' || biome === 'riverbank' ? GL.BANK_SAND : GL.BANK_SOIL;
    u.uDampMoss.value = biome === 'savanna' || biome === 'formicarium' ? 0 : biome === 'riverbank' ? 0.5 : 1;
    // the story maps' moods (render only): the garden the morning after rain (dew), the riverbank hot and bright
    const id = t.map?.id;
    setMapMood(id);
    u.uDew.value = id === 'gardenBelow' ? 1 : 0;
    this.stormWet = id === 'gardenBelow' ? 0.35 : 0;
  }

  /** Heights for the skirt beyond the playable map. */
  private heightOutside(x: number, z: number): number {
    const t = this.terrain;
    const cx = Math.min(Math.max(x, 0), t.width);
    const cz = Math.min(Math.max(z, 0), t.depth);
    const base = t.heightAt(cx, cz);
    const d = Math.hypot(x - cx, z - cz);
    if (d === 0) return base;
    const rise = (fbm2(x / 200, z / 200, 3, 99) - 0.3) * 30;
    const f = Math.min(1, d / 160);
    return base + rise * f + (this.terrain.params.style === 'formicarium' ? -6 * f : 0);
  }

  /** Wetness, flood and storm drying (render clock): call every frame. */
  private update(): void {
    const now = performance.now() / 1000;
    const dt = this.lastT ? Math.min(0.5, now - this.lastT) : 0;
    this.lastT = now;
    const zf = this.terrain.params.zoneFlood ?? [];
    let flooding = false;
    for (let i = 0; i < 4; i++) {
      const on = (zf[i] ?? -9999) > -9000;
      if (on) {
        this.zoneWet[i] = 1;
        flooding = true;
      } else this.zoneWet[i] = Math.max(0, this.zoneWet[i] - dt / 150); // drains in about 2½ minutes
    }
    const floor = this.terrain.map?.id === 'gardenBelow' ? 0.2 : 0;
    this.stormWet = flooding || this.raining ? Math.min(0.55, this.stormWet + dt * 0.1) : Math.max(floor, this.stormWet - dt / 240);
    this.groundUniforms.uZoneWet.value.set(this.zoneWet[0], this.zoneWet[1], this.zoneWet[2], this.zoneWet[3]);
    this.groundUniforms.uStormWet.value = this.stormWet;
  }

  /** Bring the mesh up to the terrain (heights, water); true when it did work this call. */
  rebuild(): boolean {
    this.update();
    if (this.builtVersion === this.terrain.version && this.builtWater === this.terrain.waterVersion) return false;
    const heightsChanged = this.builtVersion !== this.terrain.version;
    this.builtVersion = this.terrain.version;
    this.builtWater = this.terrain.waterVersion;
    const t = this.terrain;
    const pos = this.geo.attributes.position.array as Float32Array;
    const cover = this.geo.attributes.cover.array as Float32Array;
    const g1 = this.geo.attributes.g1.array as Float32Array;
    const g2 = this.geo.attributes.g2.array as Float32Array;
    const F = groundFields(t);
    // (performance v4: only the water changed — a flood step: only the wet band and the gravel depend on it; those two
    // channels are written, by the same expressions, and only their two attributes go to the GPU)
    if (!heightsChanged && this.everBuilt) {
      // (each vertex's sample and edge fade, as the full pass works them out: they depend on its x, z alone)
      const N = this.nx * this.ny;
      // (each vertex's sample and edge fade, as the full pass worked them out and kept them)
      const vs = this.vSample!;
      const vf = this.vFade!;
      for (let k = 0; k < N; k++) {
        const sI = vs[k];
        const fade = vf[k];
        g1[k * 4] = F.wet[sI] * fade;
        g2[k * 4 + 1] = F.gravel[sI] * fade;
      }
      this.geo.attributes.g1.needsUpdate = true;
      this.geo.attributes.g2.needsUpdate = true;
      return true;
    }
    this.everBuilt = true;
    const N0 = this.nx * this.ny;
    const vSample = (this.vSample ??= new Int32Array(N0));
    const vFade = (this.vFade ??= new Float64Array(N0));
    const biome = t.map?.biome;
    const outsideCover: number[] | null =
      biome === 'savanna' ? [0.35, 0.1, 0.55, 0]
      : biome === 'forest' || biome === 'rainforest' ? [0.2, 0.25, 0, 0.55]
      : t.params.style !== 'formicarium' && t.params.style !== 'sandy' ? [0.25, 0.6, 0, 0.15]
      : null;
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        const x = pos[k * 3];
        const z = pos[k * 3 + 2];
        const inside = x >= 0 && z >= 0 && x <= t.width && z <= t.depth;
        if (heightsChanged) pos[k * 3 + 1] = inside ? t.heightAt(x, z) : this.heightOutside(x, z);
        const ci = Math.round(Math.min(Math.max(x, 0), t.width) / t.res);
        const cj = Math.round(Math.min(Math.max(z, 0), t.depth) / t.res);
        const s = cj * t.nx + ci;
        const k4 = s * 4;
        // beyond the map's edge: the edge's own ground carried outward, turning into the land around over 140 mm (no
        // line along the edge, user 2026-11-02 "i see a cutoff on the map")
        const d = inside ? 0 : Math.hypot(x - Math.min(Math.max(x, 0), t.width), z - Math.min(Math.max(z, 0), t.depth));
        const out = inside ? null : outsideCover;
        const fo = out ? sstep(0, 140, d) : 0;
        for (let c = 0; c < 4; c++) cover[k * 4 + c] = F.cover[k4 + c] + ((out ? out[c] : 0) - F.cover[k4 + c]) * fo;
        const fade = 1 - sstep(0, 60, d);
        // (kept for a water-only change: performance v4)
        vSample[k] = s;
        vFade[k] = fade;
        g1[k * 4] = F.wet[s] * fade;
        g1[k * 4 + 1] = F.ao[s] + (1 - F.ao[s]) * sstep(0, 40, d);
        g1[k * 4 + 2] = F.trail[s] * fade;
        g1[k * 4 + 3] = F.face[s] / 8;
        g2[k * 4] = inside ? F.zone[s] : 0;
        g2[k * 4 + 1] = F.gravel[s] * fade;
        g2[k * 4 + 2] = F.rim[s] * fade;
        g2[k * 4 + 3] = F.spill[s] * fade;
      }
    // (the cover is softened once, in groundFields, so the bank sculpt's border shows exactly the same cover)
    for (const a of ['position', 'cover', 'g1', 'g2']) this.geo.attributes[a].needsUpdate = true;
    if (heightsChanged) {
      this.buildSculpt();
      this.geo.setIndex(this.indexWithHoles(!!this.sculpt));
      this.geo.computeVertexNormals();
      this.geo.computeBoundingSphere();
      this.geo.computeBoundingBox();
      this.buildChunks();
    }
    return true;
  }

  /** (Re)make the chunk meshes from the full index: each chunk the full index's triangles of its block of quads. */
  private buildChunks(): void {
    for (const c of this.chunks) {
      c.removeFromParent();
      // (the vertex attributes are shared: only the chunk's own index leaves the GPU)
      for (const name of Object.keys(c.geometry.attributes)) c.geometry.deleteAttribute(name);
      c.geometry.dispose();
    }
    this.chunks = [];
    const lists = chunkTriangles(this.geo.index!.array as Uint32Array, this.nx, this.ny, TERRAIN_CHUNKS);
    const pos = this.geo.attributes.position.array as Float32Array;
    for (let k = 0; k < lists.length; k++) {
      const l = lists[k];
      if (!l || !l.length) continue;
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(this.geo.attributes)) g.setAttribute(name, this.geo.attributes[name]);
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(l), 1));
      // the chunk's own bounds (computeBoundingSphere would take every vertex of the shared attributes)
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      for (const vi of l) box.expandByPoint(v.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]));
      g.boundingBox = box;
      const sph = new THREE.Sphere();
      box.getBoundingSphere(sph);
      g.boundingSphere = sph;
      const mesh = new THREE.Mesh(g, this.material);
      mesh.receiveShadow = true;
      mesh.name = 'terrain';
      this.chunks.push(mesh);
      this.mesh.add(mesh);
    }
  }

  /** Quads under the sculpted bank faces are left out of the heightfield mesh (the sculpt covers them). */
  private holes: Uint8Array | null = null;

  private indexWithHoles(sculpted: boolean): THREE.BufferAttribute {
    const t = this.terrain;
    const idx: number[] = [];
    const hole = sculpted ? sculptCells(t) : null;
    const off = this.margin / this.step;
    this.holes = null;
    for (let j = 0; j < this.ny - 1; j++)
      for (let i = 0; i < this.nx - 1; i++) {
        // the terrain sample grid lines up with this mesh on authored maps (res 4 = step); a hole is a sculpted quad
        const ti = i - off;
        const tj = j - off;
        if (hole && this.step === t.res && ti >= 0 && tj >= 0 && ti < t.nx - 1 && tj < t.ny - 1 && hole[tj * t.nx + ti]) continue;
        const a = j * this.nx + i;
        const b = a + 1;
        const c = a + this.nx;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    return new THREE.BufferAttribute(new Uint32Array(idx), 1);
  }

  private buildSculpt(): void {
    if (this.sculpt) {
      this.sculpt.geometry.dispose();
      this.sculpt.removeFromParent();
      this.sculpt = null;
    }
    const t = this.terrain;
    if (!t.layers || t.res !== this.step) return;
    const g = buildBankSculpt(t, groundFields(t));
    if (!g) return;
    this.sculpt = new THREE.Mesh(g, this.material);
    this.sculpt.receiveShadow = true;
    this.sculpt.castShadow = true;
    this.sculpt.name = 'bankSculpt';
    this.mesh.add(this.sculpt);
  }
}

// ------------------------------------------------------------------------------------------------ per-sample fields

/** What the shader needs per terrain sample, derived once per terrain (and on water changes). */
export interface GroundFields {
  /** 0..1 wet near water (the mud band and damp margin) */
  wet: Float32Array;
  /** height-field ambient occlusion (1 open … 0 enclosed) */
  ao: Float32Array;
  /** worn compacted ramp walkway 0..1 */
  trail: Float32Array;
  /** bank face style: 0 none, 1 soil bank, 2 rock ledge, 3 root wall, 4 sand bank, 5 clay cut */
  face: Uint8Array;
  /** flood zone + 1 (low ground only), 0 none */
  zone: Uint8Array;
  /** pebbly shelf 0..1 */
  gravel: Float32Array;
  /** the drier, crumbling lip at the top of a bank 0..1, and the spill of crumbs at its foot 0..1 */
  rim: Float32Array;
  spill: Float32Array;
  /** samples that belong to a sculpted bank face (cliff bands and ramp sides, grown by one sample) */
  sculpt: Uint8Array;
  /** the four cover weights 0..1, softened (a small blur): the heightfield mesh and the bank sculpt both read these */
  cover: Float32Array;
}

/**
 * Performance v4: the fields split by what they depend on. Everything but the wet band and the pebbles' dampness comes
 * from the heights and the map alone — kept per terrain version — so a flood step (a water change) recomputes only
 * the wet band and the gravel from the kept parts (the gravel's dry part kept in doubles: the same product as before).
 * The same values as recomputing all of it.
 */
interface StaticFields {
  ao: Float32Array;
  trail: Float32Array;
  face: Uint8Array;
  zone: Uint8Array;
  rim: Float32Array;
  spill: Float32Array;
  sculpt: Uint8Array;
  cover: Float32Array;
  /** the pebbly shelves before the wet band takes some of them (riverbanks, savannas), or null */
  gravelBase: Float64Array | null;
}

const fieldCache = new WeakMap<Terrain, { key: number; f: GroundFields }>();
const staticCache = new WeakMap<Terrain, { version: number; s: StaticFields }>();

const sm = (a: number, b: number, v: number) => {
  const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

function staticFields(t: Terrain): StaticFields {
  const hit = staticCache.get(t);
  if (hit && hit.version === t.version) return hit.s;
  const n = t.nx * t.ny;
  const { nx, ny, res } = t;
  const f = {
    ao: new Float32Array(n).fill(1),
    trail: new Float32Array(n),
    face: new Uint8Array(n),
    zone: new Uint8Array(n),
    rim: new Float32Array(n),
    spill: new Float32Array(n),
    sculpt: new Uint8Array(n),
    cover: softCover(t),
  };
  const m = t.map;
  // ---- flood zones (low ground under each zone's water line)
  if (m)
    m.floods.forEach((fz, zi) => {
      for (let k = 0; k < n; k++) {
        if (f.zone[k] || t.heights[k] > fz.level + 1) continue;
        const i = k % nx;
        const j = (k - i) / nx;
        if (inShape(fz.shape, i * res, j * res)) f.zone[k] = zi + 1;
      }
    });
  // ---- pebbly shelves: riverbanks and savannas, where sand shows (a riverbank's middle shelf most of all)
  const biome = m?.biome;
  let gravelBase: Float64Array | null = null;
  if (biome === 'riverbank' || biome === 'savanna') {
    gravelBase = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const i = k % nx;
      const j = (k - i) / nx;
      const x = i * res;
      const y = j * res;
      const sand = t.coverW[k * 4 + 2] / 255;
      const shelf = t.layers && biome === 'riverbank' && t.layers.level[k] === 1 ? 0.12 : 0;
      const nz = fbm2(x / 70 + 11, y / 70 - 4, 3, 77);
      gravelBase[k] = sm(0.58 - shelf, 0.7 - shelf, nz) * sm(0.1, 0.35, sand + shelf);
    }
  }
  const L = t.layers;
  if (L) {
    // ---- faces: the bank's edge style on its cliff band (grown a sample); ramp sides take their ramp's look
    for (let k = 0; k < n; k++) {
      const rp = L.ramp[k];
      let st = L.bank[k];
      if (!st && rp & RAMP_SIDE) {
        const id = rp & (RAMP_SIDE - 1);
        st = id === 5 ? 4 : id === 2 ? 3 : 1;
      }
      if (L.cliff[k] || st) f.face[k] = st || 1;
    }
    const grown = new Uint8Array(n);
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (!L.cliff[k]) continue;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) grown[k + dj * nx + di] = 1;
      }
    f.sculpt = grown;
    // ---- height-field AO, the lip and the spill (8 directions, 3 distances), near layered ground only (elsewhere the
    // ground is open): they fade out smoothly with the distance (samples) from the nearest bank, cliff or ramp, past
    // the 7-sample reach of the AO, so there is no ring where they stop (user 2026-11-02 "i see a cutoff")
    const near = layeredDistance(L, nx, ny);
    const H = (i: number, j: number) => t.heights[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
    const DIRS = 8;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const band = 1 - sm(7, 12, near[k]);
        if (band <= 0) continue;
        const h0 = H(i, j);
        let occ = 0;
        let sum = 0;
        for (let d = 0; d < DIRS; d++) {
          const a = (d / DIRS) * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          let best = 0;
          for (const r of [2, 4, 7]) {
            const h = H(Math.round(i + ca * r), Math.round(j + sa * r));
            best = Math.max(best, (h - h0) / (r * res));
            if (r === 2) sum += h;
          }
          occ += Math.min(1, Math.max(0, best) * 0.8);
        }
        f.ao[k] = 1 - Math.min(0.55, (occ / DIRS) * 0.9) * band;
        const lap = sum / DIRS - h0;
        // (the lip and the spill belong to the banks: they keep to the old reach, fading over its last samples)
        const lipBand = 1 - sm(4, 8, near[k]);
        f.rim[k] = sm(1.0, 5.0, -lap) * (L.bank[k] || L.cliff[k] ? 1 : 0.6) * lipBand;
        f.spill[k] = sm(1.0, 5.0, lap) * (L.cliff[k] ? 0.4 : 1) * lipBand;
      }
    // ---- ramps: a worn, compacted walkway down the middle where the traffic goes
    for (const r of m?.ramps ?? []) {
      const np = { d: 0, s: 0, len: 0 };
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of r.path) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
      const R = r.width / 2 + 30;
      for (let j = Math.max(0, Math.floor((y0 - R) / res)); j <= Math.min(ny - 1, Math.ceil((y1 + R) / res)); j++)
        for (let i = Math.max(0, Math.floor((x0 - R) / res)); i <= Math.min(nx - 1, Math.ceil((x1 + R) / res)); i++) {
          nearestOnPath(r.path, i * res, j * res, np);
          const lane = 1 - sm(r.width * 0.18, r.width * 0.46, np.d);
          const k = j * nx + i;
          // (the approaches beyond its ends wear too, fading)
          const along = np.s <= 0.5 || np.s >= np.len - 0.5 ? 1 - sm(4, 30, np.d - r.width * 0.2) : 1;
          f.trail[k] = Math.max(f.trail[k], lane * along * (r.style === 'sandSlide' || r.style === 'mossBank' ? 0.6 : 0.9));
        }
    }
  }
  const s: StaticFields = { ...f, gravelBase };
  staticCache.set(t, { version: t.version, s });
  return s;
}

export function groundFields(t: Terrain): GroundFields {
  const key = t.version * 100003 + t.waterVersion;
  const hit = fieldCache.get(t);
  if (hit && hit.key === key) return hit.f;
  const n = t.nx * t.ny;
  const { nx, ny, res } = t;
  const st = staticFields(t);
  const f: GroundFields = {
    wet: new Float32Array(n),
    ao: st.ao,
    trail: st.trail,
    face: st.face,
    zone: st.zone,
    gravel: new Float32Array(n),
    rim: st.rim,
    spill: st.spill,
    sculpt: st.sculpt,
    cover: st.cover,
  };
  // ---- distance to water (chamfer), in mm
  const D = new Float32Array(n).fill(1e9);
  for (let k = 0; k < n; k++) if (t.water[k] > t.heights[k] + t.overlay[k] + 0.2) D[k] = 0;
  chamfer(D, nx, ny);
  for (let k = 0; k < n; k++) {
    const mm = D[k] * res;
    if (mm > 60) continue;
    // a wet band of mud, then damp ground; ground well above the water stays dry
    let w = (1 - sm(2, 14, mm)) + 0.35 * (1 - sm(14, 34, mm)) * sm(2, 14, mm);
    const i = k % nx;
    const j = (k - i) / nx;
    // (the water level nearby: the lowest water within a few samples; banks above it dry out)
    let lvl = -9999;
    for (let r = 1; r <= 10 && lvl < -9000; r += 3)
      for (const [di, dj] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const q = (j + dj) * nx + (i + di);
        if (i + di >= 0 && i + di < nx && j + dj >= 0 && j + dj < ny && t.water[q] > -9000) lvl = Math.max(lvl, t.water[q]);
      }
    if (lvl > -9000) w *= 1 - sm(2.5, 9, t.heights[k] - lvl);
    f.wet[k] = Math.min(1, w);
  }
  // ---- the pebbles: their dry part times the dampness (riverbanks and savannas)
  const gb = st.gravelBase;
  if (gb) for (let k = 0; k < n; k++) f.gravel[k] = gb[k] * (1 - f.wet[k] * 0.5);
  fieldCache.set(t, { key, f });
  return f;
}

/** Distance (samples, chamfer) from the nearest bank, cliff or ramp sample. */
function layeredDistance(L: NonNullable<Terrain['layers']>, nx: number, ny: number): Float32Array {
  const n = nx * ny;
  const D = new Float32Array(n).fill(1e9);
  for (let k = 0; k < n; k++) if (L.bank[k] || L.ramp[k] || L.cliff[k]) D[k] = 0;
  chamfer(D, nx, ny);
  return D;
}

/** Two-pass chamfer distance (1, √2) in place: 0 at the sources. */
function chamfer(D: Float32Array, nx: number, ny: number): void {
  const S2 = Math.SQRT2;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let d = D[k];
      if (i > 0) d = Math.min(d, D[k - 1] + 1);
      if (j > 0) d = Math.min(d, D[k - nx] + 1);
      if (i > 0 && j > 0) d = Math.min(d, D[k - nx - 1] + S2);
      if (i < nx - 1 && j > 0) d = Math.min(d, D[k - nx + 1] + S2);
      D[k] = d;
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let d = D[k];
      if (i < nx - 1) d = Math.min(d, D[k + 1] + 1);
      if (j < ny - 1) d = Math.min(d, D[k + nx] + 1);
      if (i < nx - 1 && j < ny - 1) d = Math.min(d, D[k + nx + 1] + S2);
      if (i > 0 && j < ny - 1) d = Math.min(d, D[k + nx - 1] + S2);
      D[k] = d;
    }
}

/** The cover weights 0..1, softened with a small blur (about 3 mm across, the same in mm on 2 mm and 4 mm samples). */
function softCover(t: Terrain): Float32Array {
  const { nx, ny, res } = t;
  const n = nx * ny;
  let a = new Float32Array(n * 4);
  for (let q = 0; q < n * 4; q++) a[q] = t.coverW[q] / 255;
  let b = new Float32Array(n * 4);
  const passes = Math.max(2, Math.round(2 * (4 / res) * (4 / res)));
  for (let pass = 0; pass < passes; pass++) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const l = i > 0 ? k - 1 : k;
        const r = i < nx - 1 ? k + 1 : k;
        const u = j > 0 ? k - nx : k;
        const d = j < ny - 1 ? k + nx : k;
        for (let c = 0; c < 4; c++) b[k * 4 + c] = (a[k * 4 + c] * 4 + a[l * 4 + c] + a[r * 4 + c] + a[u * 4 + c] + a[d * 4 + c]) / 8;
      }
    [a, b] = [b, a];
  }
  return a;
}

function sstep(a: number, b: number, v: number): number {
  const u = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** Terrain cells (i, j → the quad to i+1, j+1) the bank sculpt replaces. */
export function sculptCells(t: Terrain): Uint8Array | null {
  if (!t.layers) return null;
  const f = groundFields(t);
  const { nx, ny } = t;
  const cells = new Uint8Array(nx * ny);
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      if (f.sculpt[k] && f.sculpt[k + 1] && f.sculpt[k + nx] && f.sculpt[k + nx + 1]) cells[k] = 1;
    }
  return cells;
}

// ------------------------------------------------------------------------------------------------ the shader

function groundPatch(gu: TerrainMesh['groundUniforms'], ou: TerrainMesh['overlayUniforms'], noise: THREE.Texture) {
  return {
    key: 'ground',
    uniforms: { ...gu, ...ou, tNoise: { value: noise } },
    vertexHeader: 'attribute vec4 cover; attribute vec4 g1; attribute vec4 g2; varying vec4 vCover; varying vec4 vG1; varying vec4 vG2; varying vec3 vNW;',
    vertex: [['#include <begin_vertex>', '#include <begin_vertex>\n vCover = cover; vG1 = g1; vG2 = g2; vNW = normalize(normal);']] as Array<[string, string]>,
    fragmentHeader: GROUND_GLSL,
    fragment: [
      ['#include <map_fragment>', '#include <map_fragment>\n GS gs = groundShade(); diffuseColor.rgb *= gs.alb;'],
      ['#include <roughnessmap_fragment>', 'float roughnessFactor = gs.rough;'],
      // dry, porous ground shadows its own grazing sheen (no wet-cobble look); a water film brings it back
      ['#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.specularF90 = mix(0.25, 1.0, gs.wet); material.specularColor *= mix(0.55, 1.0, gs.wet);'],
      ['directLight.color *= _dapple;', 'directLight.color *= _dapple * gs.sunVis;'],
      ['#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gs.nW, 0.0)).xyz);'],
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += gs.glint;
         vec2 puv = vWP.xz / uMapSize;
         if (uPheroOn > 0.5 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) {
           vec4 ph = texture2D(uPhero, puv);
           float trail = smoothstep(0.02, 0.6, ph.r);
           float alarm = smoothstep(0.05, 0.8, ph.g);
           float shimmer = 0.75 + 0.25*sin(uTime*3.0 + vWP.x*0.3 + vWP.z*0.2);
           totalEmissiveRadiance += uPheroColor * trail * 0.9 * shimmer + vec3(1.0,0.25,0.12) * alarm * 0.9;
           totalEmissiveRadiance += vec3(0.95,0.7,0.25) * smoothstep(0.02, 0.5, ph.b) * 0.6;
         }`,
      ],
    ] as Array<[string, string]>,
  };
}

const GROUND_GLSL = /* glsl */ `
precision highp sampler2DArray;
varying vec4 vCover; varying vec4 vG1; varying vec4 vG2; varying vec3 vNW;
uniform sampler2DArray tGA, tGN;
uniform sampler2D tNoise, uPhero, uDesign;
uniform vec4 uChan; uniform float uInvTile[${GL_COUNT}]; uniform float uRelief[${GL_COUNT}]; uniform float uStoch[${GL_COUNT}];
uniform vec4 uZoneWet; uniform float uStormWet, uDew, uDetailFade, uReadable, uDampMoss; uniform vec2 uBand; uniform float uFaceDefault;
uniform float uPheroOn; uniform vec3 uPheroColor; uniform vec2 uMapSize;

struct GS { vec3 alb; float rough; vec3 nW; vec3 glint; float sunVis; float wet; };
struct LS { vec3 alb; float rough; vec2 n; float h; float cav; vec3 mean; vec2 uvD; float aD; };

vec2 gHash(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
vec3 gDecode(vec3 c) { return pow(c, vec3(2.2)); }
vec2 gRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// one layer, sampled with stochastic tiling: three randomly offset and rotated taps over a triangle grid, blended by
// height (the dominant tap's uv and angle are kept for the self-shadow march)
LS gLayer(float L, vec2 uv, vec2 dx, vec2 dy, bool rotate) {
  // the blend cells are larger on fibrous layers (long blades are not cut short where the taps change)
  vec2 q = uv * uStoch[int(L + 0.5)];
  vec2 sk = vec2(q.x - 0.57735027 * q.y, 1.15470054 * q.y);
  vec2 b = floor(sk);
  vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
  vec3 w; vec2 v1, v2, v3;
  if (t.z > 0.0) { w = vec3(t.z, t.y, t.x); v1 = b; v2 = b + vec2(0.0, 1.0); v3 = b + vec2(1.0, 0.0); }
  else { w = vec3(-t.z, 1.0 - t.y, 1.0 - t.x); v1 = b + vec2(1.0); v2 = b + vec2(1.0, 0.0); v3 = b + vec2(0.0, 1.0); }
  vec2 o1 = gHash(v1 + L * 7.1), o2 = gHash(v2 + L * 7.1), o3 = gHash(v3 + L * 7.1);
  // each lattice vertex keeps one angle whichever corner of whichever triangle it is (it took its angle from the
  // corner's slot before, so a tap turned at every triangle edge: the straight seams across the ground, user
  // 2026-11-02 "i see a cutoff on the map")
  float a1 = rotate ? gHash(v1 + L * 7.1 + 19.19).x * 6.2832 : 0.0;
  float a2 = rotate ? gHash(v2 + L * 7.1 + 19.19).x * 6.2832 : 0.0;
  float a3 = rotate ? gHash(v3 + L * 7.1 + 19.19).x * 6.2832 : 0.0;
  vec2 u1 = gRot(uv, a1) + o1, u2 = gRot(uv, a2) + o2, u3 = gRot(uv, a3) + o3;
  vec4 A1 = textureGrad(tGA, vec3(u1, L), gRot(dx, a1), gRot(dy, a1));
  vec4 A2 = textureGrad(tGA, vec3(u2, L), gRot(dx, a2), gRot(dy, a2));
  vec4 A3 = textureGrad(tGA, vec3(u3, L), gRot(dx, a3), gRot(dy, a3));
  vec4 N1 = textureGrad(tGN, vec3(u1, L), gRot(dx, a1), gRot(dy, a1));
  vec4 N2 = textureGrad(tGN, vec3(u2, L), gRot(dx, a2), gRot(dy, a2));
  vec4 N3 = textureGrad(tGN, vec3(u3, L), gRot(dx, a3), gRot(dy, a3));
  vec3 wh = w * (vec3(N1.b, N2.b, N3.b) + 0.35);
  wh = pow(wh, vec3(6.0)); wh /= max(dot(wh, vec3(1.0)), 1e-5);
  LS s;
  s.alb = gDecode(A1.rgb * wh.x + A2.rgb * wh.y + A3.rgb * wh.z);
  s.rough = A1.a * wh.x + A2.a * wh.y + A3.a * wh.z;
  vec2 n1 = gRot(N1.xy * 2.0 - 1.0, -a1), n2 = gRot(N2.xy * 2.0 - 1.0, -a2), n3 = gRot(N3.xy * 2.0 - 1.0, -a3);
  s.n = n1 * wh.x + n2 * wh.y + n3 * wh.z;
  s.h = N1.b * wh.x + N2.b * wh.y + N3.b * wh.z;
  s.cav = N1.a * wh.x + N2.a * wh.y + N3.a * wh.z;
  s.mean = gDecode(textureLod(tGA, vec3(0.5, 0.5, L), 12.0).rgb);
  if (wh.x >= wh.y && wh.x >= wh.z) { s.uvD = u1; s.aD = a1; }
  else if (wh.y >= wh.z) { s.uvD = u2; s.aD = a2; }
  else { s.uvD = u3; s.aD = a3; }
  return s;
}

GS groundShade() {
  vec3 N = normalize(vNW);
  vec3 P = vWP;
  // (derivatives here, outside any branch: the layer taps use explicit gradients)
  vec3 dPx = dFdx(P), dPy = dFdy(P);
  float dCam = distance(cameraPosition, P);
  float fade = smoothstep(140.0, 900.0, dCam) * uDetailFade;
  // gameplay zoom: calm the ant-sized contrast (crumb shadows, dark voids) so units read against the ground
  float read = smoothstep(90.0, 240.0, dCam) * uReadable;
  float wetStatic = vG1.x;
  int zi = int(vG2.x + 0.5) - 1;
  float zoneWet = zi == 0 ? uZoneWet.x : zi == 1 ? uZoneWet.y : zi == 2 ? uZoneWet.z : zi == 3 ? uZoneWet.w : 0.0;
  float wet = max(max(wetStatic, zoneWet), uStormWet * 0.55);

  // ---- the flat ground: the four cover channels, gravel, mud by the water, the worn ramp walkway
  float trail = vG1.z;
  float gravel = vG2.y;
  vec4 cw = vCover * (1.0 - trail) * (1.0 - gravel * 0.8);
  float sandy = cw.z;
  float mud = smoothstep(0.55, 0.95, wetStatic) * (1.0 - sandy * 0.7) * (1.0 - trail);
  cw *= 1.0 - mud;
  // damp moss on the shady wet margin of water (not on sand), where the ground stays wet but not flooded
  // (patchy: moss holds in some places and not others)
  float dampMoss = smoothstep(0.18, 0.4, wetStatic) * (1.0 - smoothstep(0.55, 0.8, wetStatic)) * (1.0 - sandy) * (1.0 - trail) * uDampMoss
                 * smoothstep(0.35, 0.65, texture2D(tNoise, P.xz / 140.0 + 0.23).r);
  cw *= 1.0 - dampMoss * 0.7;
  float W[8]; float Ls[8];
  W[0] = cw.x; Ls[0] = uChan.x; W[1] = cw.y; Ls[1] = uChan.y; W[2] = cw.z; Ls[2] = uChan.z; W[3] = cw.w; Ls[3] = uChan.w;
  W[4] = gravel; Ls[4] = ${GL.GRAVEL}.0; W[5] = mud; Ls[5] = ${GL.MUD}.0; W[6] = trail; Ls[6] = sandy > 0.45 ? uChan.z : ${GL.TRAIL}.0;  // a sand slide wears to packed sand
  W[7] = dampMoss * 0.8; Ls[7] = ${GL.MOSS}.0;
  // ragged transitions: noise moves each layer's edge a few mm (no straight lines along the mesh's triangles)
  vec4 tn = texture2D(tNoise, P.xz / 43.0 + 0.11) - 0.5;
  vec4 tn2 = texture2D(tNoise, P.xz / 17.0 + 0.53) - 0.5;
  for (int i = 0; i < 8; i++) {
    float w = W[i];
    float n = (i == 0 ? tn.r : i == 1 ? tn.g : i == 2 ? tn.b : i == 3 ? tn2.r : i == 4 ? tn2.g : i == 5 ? tn2.b : i == 6 ? tn.r - tn2.g : tn.b + tn2.r);
    W[i] = clamp(w + n * 1.1 * w * (1.0 - w) * 2.0, 0.0, 1.0);
  }
  // the three heaviest layers only (the rest are below the height blend's reach anyway)
  float wa = 0.02, wb = 0.02, wc = 0.02, wd = 0.0; float la = -1.0, lb = -1.0, lc = -1.0; float wmax = 0.0;
  for (int i = 0; i < 8; i++) wmax = max(wmax, W[i]);
  for (int i = 0; i < 8; i++) {
    float w = W[i]; float l = Ls[i];
    if (w > wa) { wd = wc; wc = wb; lc = lb; wb = wa; lb = la; wa = w; la = l; }
    else if (w > wb) { wd = wc; wc = wb; lc = lb; wb = w; lb = l; }
    else if (w > wc) { wd = wc; wc = w; lc = l; }
    else wd = max(wd, w);
  }
  // the third layer fades out as the fourth catches up (no seam where they swap)
  wc *= smoothstep(wd, wd + 0.12, wc);
  vec3 alb = vec3(0.0); vec3 mean = vec3(0.0); float rough = 0.0; vec2 nrm = vec2(0.0); float cav = 0.0; float tot = 0.0;
  LS A, B, C;
  // A layer's pebbles and tufts push through the others by height (score = weight + height), but a layer only just in
  // the top three (its weight near the 0.02 cut) has its height and its share brought down to nothing there: it
  // comes and goes smoothly instead of at a line along the mesh's triangles (user 2026-11-02 "i see a cutoff")
  float ra = smoothstep(0.02, 0.12, wa), rb = smoothstep(0.02, 0.12, wb), rc = smoothstep(0.02, 0.12, wc);
  float sa = -1.0, sb = -1.0, sc_ = -1.0;
  if (la >= 0.0) { float it = uInvTile[int(la)]; A = gLayer(la, P.xz * it, dPx.xz * it, dPy.xz * it, true); sa = wa + A.h * 0.55 * ra; }
  if (lb >= 0.0) { float it = uInvTile[int(lb)]; B = gLayer(lb, P.xz * it, dPx.xz * it, dPy.xz * it, true); sb = wb + B.h * 0.55 * rb; }
  if (lc >= 0.0) { float it = uInvTile[int(lc)]; C = gLayer(lc, P.xz * it, dPx.xz * it, dPy.xz * it, true); sc_ = wc + C.h * 0.55 * rc; }
  float best = max(sa, max(sb, sc_));
  float ka = sa < 0.0 ? 0.0 : max(sa - (best - 0.28), 0.0) * ra;
  float kb = sb < 0.0 ? 0.0 : max(sb - (best - 0.28), 0.0) * rb;
  float kc = sc_ < 0.0 ? 0.0 : max(sc_ - (best - 0.28), 0.0) * rc;
  // bare ground where nothing is laid at all (blended in, not switched)
  float kf = 0.28 * (1.0 - smoothstep(0.02, 0.12, wmax));
  tot = ka + kb + kc + kf;
  float domL = 0.0; vec2 domUv = vec2(0.0); float domA = 0.0; float domH = 0.0;
  if (tot < 1e-4) { alb = vec3(0.12, 0.09, 0.07); mean = alb; rough = 0.9; cav = 1.0; tot = 1.0; }
  else {
    if (kf > 0.0) { alb += vec3(0.12, 0.09, 0.07) * kf; mean += vec3(0.12, 0.09, 0.07) * kf; rough += 0.9 * kf; cav += kf; }
    if (ka > 0.0) { alb += A.alb * ka; mean += A.mean * ka; rough += A.rough * ka; nrm += A.n * ka; cav += A.cav * ka; }
    if (kb > 0.0) { alb += B.alb * kb; mean += B.mean * kb; rough += B.rough * kb; nrm += B.n * kb; cav += B.cav * kb; }
    if (kc > 0.0) { alb += C.alb * kc; mean += C.mean * kc; rough += C.rough * kc; nrm += C.n * kc; cav += C.cav * kc; }
    if (ka >= kb && ka >= kc) { domL = la; domUv = A.uvD; domA = A.aD; domH = A.h; }
    else if (kb >= kc) { domL = lb; domUv = B.uvD; domA = B.aD; domH = B.h; }
    else { domL = lc; domUv = C.uvD; domA = C.aD; domH = C.h; }
  }
  alb /= tot; mean /= tot; rough /= tot; nrm /= tot; cav /= tot;

  // ---- bank faces: steep ground shows the bank's own face, projected across it (strata run level)
  float steep = 1.0 - clamp(N.y, 0.0, 1.0);
  float faceW = smoothstep(0.3, 0.55, steep);
  vec3 nWorld;
  vec3 T0 = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B0 = normalize(cross(T0, N));
  float relief = (1.0 - fade * 0.6) * (1.0 - read * 0.3);
  relief *= 1.0 - wet * 0.45;
  nWorld = normalize(T0 * nrm.x * relief + B0 * nrm.y * relief + N);
  if (faceW > 0.01) {
    // (where two styles meet, the change is moved about by noise, not drawn along the mesh's triangles)
    float style = floor(vG1.w * 8.0 + 0.5 + (tn.a + tn2.a) * 0.45);
    float FL = style < 0.5 ? uFaceDefault : style < 1.5 ? ${GL.BANK_SOIL}.0 : style < 2.5 ? ${GL.ROCK}.0 : style < 3.5 ? ${GL.BANK_ROOT}.0 : style < 4.5 ? ${GL.BANK_SAND}.0 : ${GL.CLAY}.0;
    // projected on the two vertical world planes (fixed axes, so lumps on the face never swirl the strata), blended
    // by which way the face looks
    float it = uInvTile[int(FL)];
    vec3 Bf = normalize(vec3(0.0, 1.0, 0.0) - N * N.y);
    float bx = abs(N.x), bz = abs(N.z);
    float wx = smoothstep(0.38, 0.62, bx / max(bx + bz, 1e-4));
    vec3 fAlb = vec3(0.0), fMean = vec3(0.0), fN = vec3(0.0); float fRough = 0.0, fCav = 0.0;
    if (wx < 0.999) {
      float sg = N.z >= 0.0 ? 1.0 : -1.0;
      LS F = gLayer(FL, vec2(P.x * sg, P.y) * it, vec2(dPx.x * sg, dPx.y) * it, vec2(dPy.x * sg, dPy.y) * it, false);
      vec3 T = normalize(vec3(sg, 0.0, 0.0) - N * N.x * sg);
      float w = 1.0 - wx;
      fAlb += F.alb * w; fMean += F.mean * w; fRough += F.rough * w; fCav += F.cav * w;
      fN += (T * F.n.x + Bf * F.n.y) * w;
    }
    if (wx > 0.001) {
      float sg = N.x >= 0.0 ? -1.0 : 1.0;
      LS F = gLayer(FL, vec2(P.z * sg + 37.0, P.y) * it, vec2(dPx.z * sg, dPx.y) * it, vec2(dPy.z * sg, dPy.y) * it, false);
      vec3 T = normalize(vec3(0.0, 0.0, sg) - N * N.z * sg);
      fAlb += F.alb * wx; fMean += F.mean * wx; fRough += F.rough * wx; fCav += F.cav * wx;
      fN += (T * F.n.x + Bf * F.n.y) * wx;
    }
    alb = mix(alb, fAlb, faceW); mean = mix(mean, fMean, faceW); rough = mix(rough, fRough, faceW); cav = mix(cav, fCav, faceW);
    vec3 nf = normalize(fN * relief + N);
    nWorld = normalize(mix(nWorld, nf, faceW));
  }

  // ---- the sun's light through the ground's own relief: crumbs and pebbles shade the ground beside them (close zoom
  // only; a march toward the sun through the dominant layer's height)
  float sunVis = 1.0;
#if NUM_DIR_LIGHTS > 0
  if (dCam < 220.0 && faceW < 0.5) {
    vec3 sunW = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
    vec2 sxz = sunW.xz;
    float sl = length(sxz);
    if (sl > 0.05 && sunW.y > 0.05) {
      int Li = int(domL + 0.5);
      float it = uInvTile[Li];
      float rel = uRelief[Li];
      vec2 dir = gRot(sxz / sl, domA) * it;     // 1 mm toward the sun, in the tap's uv
      float tanE = sunW.y / sl;
      float h0 = domH * rel;
      float occ = 0.0;
      for (int k = 1; k <= 8; k++) {
        float d = float(k) * float(k) * 0.07;   // 0.07 … 4.5 mm
        float hk = textureLod(tGN, vec3(domUv + dir * d, domL), 0.0).b * rel;
        occ = max(occ, (hk - h0 - d * tanE) / (0.25 + d * 0.3));
      }
      sunVis = 1.0 - clamp(occ, 0.0, 1.0) * (1.0 - smoothstep(120.0, 220.0, dCam)) * (1.0 - wet * 0.3) * (1.0 - smoothstep(0.3, 0.5, faceW));
    }
  }
#endif

  // ---- light baked into the ground: hollows, the foot of banks; the lip drier, crumbs spilled at the foot
  alb *= mix(1.0, cav, 0.75 * (1.0 - read * 0.55));
  // close up, the particles' own contrast a touch stronger (real soil: luminance std/mean 0.5–0.9)
  alb = max(mean + (alb - mean) * (1.0 + 0.15 * (1.0 - read)), alb * 0.5);
  float ao = vG1.y;
  alb *= mix(0.62, 1.0, ao);
  // the lip: flat ground beside it dries first (paler); on the face itself the top band is the dark, root-filled
  // topsoil; crumbs spilled at the foot
  alb *= 1.0 + vG2.z * 0.1 * (1.0 - faceW) - vG2.z * 0.28 * faceW - vG2.w * 0.08;
  // two scales of colour drift (no two patches of ground alike): damper and drier patches, warmer and greyer
  float macro = texture2D(tNoise, P.xz / 900.0).g;
  float macro2 = texture2D(tNoise, P.xz / 260.0 + 0.37).r;
  float macro3 = texture2D(tNoise, P.xz / 95.0 + 0.71).b;
  float drift = 0.86 + macro * 0.22 + (macro2 - 0.5) * 0.14 + (macro3 - 0.5) * 0.08;
  alb *= drift; mean *= drift;
  alb = mix(alb, alb * vec3(1.04, 1.0, 0.94), smoothstep(0.4, 0.7, macro2) * 0.5);
  // seen from far, the ground is a mosaic of damper and drier, barer and leafier patches
  float far_ = smoothstep(300.0, 900.0, dCam);
  alb *= 1.0 + (macro - 0.5) * 0.35 * far_ + (macro2 - 0.5) * 0.2 * far_;
  // detail fades toward the layer's mean with distance; at gameplay zoom the micro-contrast is calmed a little
  alb = mix(alb, mean, fade * 0.5 + read * 0.22);

  // ---- the strand line: where the water last reached, a band of dark organic flecks, grit and dried foam
  float strand = smoothstep(0.38, 0.48, wetStatic) * (1.0 - smoothstep(0.58, 0.7, wetStatic));
  if (strand > 0.01) {
    vec2 sq = P.xz * 1.6;
    vec2 sh = gHash(floor(sq) + 17.0);
    float fl = smoothstep(0.32, 0.12, length(fract(sq) - 0.5 - (sh - 0.5) * 0.5)) * step(0.62, sh.x);
    alb = mix(alb, sh.y > 0.8 ? vec3(0.55, 0.53, 0.48) : vec3(0.035, 0.028, 0.02), fl * strand * (1.0 - fade));
  }

  // ---- wetness: darker, a little more saturated, glossier, its bumps filled in
  float porous = 1.0 - faceW * 0.3;
  float wl = dot(alb, vec3(0.2126, 0.7152, 0.0722));
  alb = mix(alb, mix(vec3(wl), alb, 1.15), wet * 0.6);
  alb *= mix(1.0, 0.56, wet * porous);
  mean *= mix(1.0, 0.56, wet * porous);
  rough = mix(rough, 0.16 + 0.2 * (1.0 - cav), wet * 0.85);
  nWorld = normalize(mix(nWorld, N, wet * 0.35));

  // ---- the value band: the ground's local mean is kept between uBand.x and uBand.y (linear) so dark and rust-coloured
  // units never melt into it; the detail around the mean keeps its contrast, only the deepest voids are lifted
  float lm = dot(mean, vec3(0.2126, 0.7152, 0.0722));
  float k = lm < uBand.x ? uBand.x / max(lm, 1e-4) : lm > uBand.y ? uBand.y / lm : 1.0;
  alb *= mix(1.0, k, 0.85);
  float l = dot(alb, vec3(0.2126, 0.7152, 0.0722));
  if (l < uBand.x * 0.35) alb *= mix(1.0, uBand.x * 0.35 / max(l, 1e-4), 0.6);

  // ---- dew on the morning maps: tiny glints on grass and moss
  vec3 glint = vec3(0.0);
  if (uDew > 0.0) {
    vec2 cell = floor(P.xz * 3.0);
    vec2 hh = gHash(cell + 3.7);
    float grassy = vCover.y * (1.0 - wetStatic) * (1.0 - faceW);
    float dot_ = step(0.985, hh.x) * smoothstep(0.35, 0.0, length(fract(P.xz * 3.0) - 0.5 - (hh - 0.5) * 0.4));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hh.y * 40.0 + dot(cameraPosition, vec3(0.05)));
    glint = vec3(0.9, 0.95, 1.0) * dot_ * tw * grassy * uDew * (1.0 - fade) * 0.35;
    rough = mix(rough, 0.45, grassy * uDew * 0.4);
  }
  GS g;
  g.alb = alb; g.rough = clamp(rough, 0.08, 1.0); g.nW = nWorld; g.glint = glint; g.sunVis = sunVis; g.wet = wet;
  return g;
}
`;
