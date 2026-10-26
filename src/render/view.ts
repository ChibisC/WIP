import * as THREE from 'three';
import { Input } from '../core/input';
import { Terrain } from '../world/terrain';
import { NestGrid } from '../world/nestGrid';
import { TerrainMesh } from './terrainMesh';
import { Grass } from './grass';
import { MapDecor } from './mapDecor';
import { Props } from './props';
import { Water } from './water';
import { NestTerrain } from './nest/nestTerrain';
import { PostPipeline } from './post';
import { createNestEnvironment, createSurfaceEnvironment, NestLights, SurfaceLights } from './environment';
import { ObserveCameraRig, SurfaceCameraRig } from './cameras';
import { globalUniforms } from './shaderPatch';

export type ViewSpace = 'surface' | 'nest';
export type Quality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  post: boolean;
  ao: boolean;
  bloom: boolean;
  dof: boolean;
  grassDensity: number;
  lodScale: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 1024, post: false, ao: false, bloom: false, dof: false, grassDensity: 0.35, lodScale: 0.55 },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, post: true, ao: false, bloom: true, dof: true, grassDensity: 0.7, lodScale: 0.8 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, post: true, ao: true, bloom: true, dof: true, grassDensity: 1, lodScale: 1 },
};

interface Transition {
  to: ViewSpace;
  t: number;
  swapped: boolean;
  entranceSurface: THREE.Vector3;
  /** entrance ramp in the nest plane (x, z) */
  entranceNest: THREE.Vector2;
  returnDist: number;
}

/** One underground area (a nest or a cave): its own scene, terrain, lights and remembered camera. */
export interface NestStage {
  /** sim space id of the area */
  space: number;
  scene: THREE.Scene;
  terrain: NestTerrain;
  lights: NestLights;
  cam: { x: number; z: number; dist: number; yaw: number; pitch: number } | null;
}

/**
 * Owns the renderer, the surface scene, one stage per colony nest, cameras,
 * post-processing and the nest ↔ surface transition. Game-specific renderers
 * add their objects to `surfaceScene` or a nest stage's scene.
 */
export class GameView {
  renderer: THREE.WebGLRenderer;
  surfaceScene = new THREE.Scene();
  /** every underground area that can be viewed (area tabs 1–6), keyed by space id */
  nestStages = new Map<number, NestStage>();
  /** space id of the area shown in the nest view */
  activeNest = -1;
  private emptyNest = new THREE.Scene();
  surfaceCam: THREE.PerspectiveCamera;
  nestCam: THREE.PerspectiveCamera;
  observeCam: THREE.PerspectiveCamera;
  surfaceRig: SurfaceCameraRig;
  /** the nest is a plane seen from above: same rig type as the surface */
  nestRig: SurfaceCameraRig;
  observeRig: ObserveCameraRig;
  post: PostPipeline;
  space: ViewSpace = 'surface';
  observing = false;
  /** photo mode free camera (Shift+F9): flies anywhere; rigs keep their state underneath */
  freeCam = { on: false, yaw: 0, pitch: -0.5, pos: new THREE.Vector3(), speed: 60 };
  quality: Quality = 'high';
  preset: QualityPreset = QUALITY.high;
  terrain: Terrain | null = null;
  terrainMesh: TerrainMesh | null = null;
  grass: Grass | null = null;
  decor: MapDecor | null = null;
  props: Props | null = null;
  water: Water | null = null;
  surfaceLights: SurfaceLights;
  worldGroup = new THREE.Group();
  private transition: Transition | null = null;
  /** area → area cut: fade to black, swap, fade back */
  private areaFade: { t: number; swapped: boolean; swap: () => void } | null = null;
  private fadeEl: HTMLDivElement;
  time = 0;
  onSpaceChanged: ((s: ViewSpace) => void) | null = null;
  /** Called every frame before rendering with real dt. */
  beforeRender: Array<(dt: number) => void> = [];
  night = false;

  constructor(private canvas: HTMLCanvasElement, private input: Input) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const aspect = window.innerWidth / window.innerHeight;
    this.surfaceCam = new THREE.PerspectiveCamera(38, aspect, 1, 6000);
    this.nestCam = new THREE.PerspectiveCamera(34, aspect, 1, 4000);
    this.observeCam = new THREE.PerspectiveCamera(40, aspect, 0.1, 3000);
    this.surfaceRig = new SurfaceCameraRig(this.surfaceCam);
    this.nestRig = new SurfaceCameraRig(this.nestCam);
    this.observeRig = new ObserveCameraRig(this.observeCam);
    this.post = new PostPipeline(this.renderer);
    this.surfaceLights = createSurfaceEnvironment(this.renderer, this.surfaceScene);
    this.surfaceScene.add(this.worldGroup);
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'view-fade';
    document.getElementById('app')!.appendChild(this.fadeEl);
    window.addEventListener('resize', () => this.resize());
    this.setQuality('high');
    this.resize();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.preset = QUALITY[q];
    const p = this.preset;
    this.renderer.shadowMap.enabled = p.shadows;
    this.surfaceLights.sun.castShadow = p.shadows;
    for (const st of this.nestStages.values()) {
      st.lights.key.castShadow = p.shadows;
      st.terrain.setShadows(p.shadows);
    }
    for (const l of [this.surfaceLights.sun, ...[...this.nestStages.values()].map((st) => st.lights.key)]) {
      if (l.shadow.mapSize.x !== p.shadowSize) {
        l.shadow.mapSize.set(p.shadowSize, p.shadowSize);
        l.shadow.map?.dispose();
        l.shadow.map = null as unknown as THREE.WebGLRenderTarget;
      }
    }
    this.post.enabled = p.post;
    this.post.settings.ao = p.ao;
    this.post.settings.bloom = p.bloom;
    this.post.settings.dof = p.dof;
    this.resize();
    // Materials must recompile for shadow toggles.
    for (const s of [this.surfaceScene, ...[...this.nestStages.values()].map((st) => st.scene)])
      s.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
    if (this.terrain && this.grass) this.rebuildGrass();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    for (const c of [this.surfaceCam, this.nestCam, this.observeCam]) {
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
    this.post.setSize(w, h, pr);
  }

  /** Build the surface world for a terrain. */
  setTerrain(terrain: Terrain): void {
    this.worldGroup.clear();
    this.terrain = terrain;
    this.terrainMesh = new TerrainMesh(terrain);
    this.worldGroup.add(this.terrainMesh.mesh);
    this.props = new Props(terrain);
    this.worldGroup.add(this.props.group);
    this.water = new Water(terrain);
    this.worldGroup.add(this.water.mesh);
    // an authored map: rocks, walkways, lilies, flowers (render only); thinner fog on the big maps
    this.decor = terrain.map ? new MapDecor(terrain) : null;
    if (this.decor) this.worldGroup.add(this.decor.group);
    const fog = this.surfaceScene.fog as THREE.FogExp2 | null;
    if (fog && 'density' in fog && !this.night) fog.density = 0.00055 * Math.min(1, 1000 / Math.max(terrain.width, terrain.depth));
    this.rebuildGrass();
    const r = this.surfaceRig;
    r.heightAt = (x, z) => terrain.walkHeight(Math.min(Math.max(x, 0), terrain.width), Math.min(Math.max(z, 0), terrain.depth));
    r.bounds.min.set(0, 0);
    r.bounds.max.set(terrain.width, terrain.depth);
    r.maxDist = Math.max(terrain.width, terrain.depth) * 1.15;
    r.jumpTo(terrain.width / 2, terrain.depth / 2, Math.min(320, r.maxDist));
    this.captureWaterReflections();
  }

  private rebuildGrass(): void {
    if (!this.terrain) return;
    if (this.grass) {
      this.worldGroup.remove(this.grass.mesh);
      this.grass.mesh.geometry.dispose();
    }
    this.grass = new Grass(this.terrain, this.preset.grassDensity, 320, this.decor?.clumps);
    this.worldGroup.add(this.grass.mesh);
  }

  /** One-off cube snapshot of the surroundings used by water reflections. */
  captureWaterReflections(): void {
    if (!this.terrain || !this.water) return;
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cc = new THREE.CubeCamera(1, 4000, rt);
    const t = this.terrain;
    let wx = t.width / 2;
    let wz = t.depth / 2;
    if (t.params.water.length) {
      wx = t.params.water[0].x;
      wz = t.params.water[0].y;
    }
    cc.position.set(wx, t.heightAt(wx, wz) + 6, wz);
    this.water.mesh.visible = false;
    this.surfaceScene.add(cc);
    cc.update(this.renderer, this.surfaceScene);
    this.surfaceScene.remove(cc);
    this.water.material.envMap = rt.texture;
    this.water.material.needsUpdate = true;
    this.water.rebuild();
    this.water.mesh.visible = true;
    this.water.mesh.visible = this.terrain.water.some((w) => w > -9000);
  }

  /** The nest currently shown (null before any nest exists). */
  get nestStage(): NestStage | null {
    return this.nestStages.get(this.activeNest) ?? null;
  }

  get nestScene(): THREE.Scene {
    return this.nestStage?.scene ?? this.emptyNest;
  }

  get nestTerrain(): NestTerrain | null {
    return this.nestStage?.terrain ?? null;
  }

  /** Build an underground area's top-down map (its own scene, lights and terrain). */
  addNest(space: number, grid: NestGrid): NestStage {
    const scene = new THREE.Scene();
    const lights = createNestEnvironment(this.renderer, scene);
    const terrain = new NestTerrain(grid);
    terrain.setShadows(this.preset.shadows);
    scene.add(terrain.group);
    const W = grid.widthMm;
    const D = grid.depthMm;
    // Low, warm key light raking across the floor so walls throw long shadows.
    const key = lights.key;
    key.castShadow = this.preset.shadows;
    key.shadow.mapSize.set(this.preset.shadowSize, this.preset.shadowSize);
    key.target.position.set(W / 2, 0, D / 2);
    key.position.set(W / 2 - 520, 430, D / 2 - 300);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -W * 0.75;
    sc.right = W * 0.75;
    sc.top = D * 0.75;
    sc.bottom = -D * 0.75;
    sc.updateProjectionMatrix();
    scene.fog = new THREE.FogExp2(0x070504, 0.9 / Math.max(W, D));
    const st: NestStage = { space, scene, terrain, lights, cam: null };
    this.nestStages.set(space, st);
    if (this.activeNest < 0) this.setActiveNest(space);
    return st;
  }

  /** Show another area; the camera remembers where it was in each one. */
  setActiveNest(space: number, focus?: { x: number; z: number }): void {
    const next = this.nestStages.get(space);
    if (!next) return;
    const r = this.nestRig;
    const prev = this.nestStage;
    if (prev && prev !== next) prev.cam = { x: r.goal.x, z: r.goal.z, dist: r.goalDistance, yaw: r.goalYaw, pitch: r.pitchBias };
    this.activeNest = space;
    const g = next.terrain.grid;
    const nt = next.terrain;
    const W = g.widthMm;
    const D = g.depthMm;
    r.heightAt = (x, z) => Math.min(nt.wallH * 0.3, nt.heightAt(Math.min(Math.max(x, 0), W), Math.min(Math.max(z, 0), D)));
    r.bounds.min.set(0, 0);
    r.bounds.max.set(W, D);
    r.minDist = g.R * 2.2;
    r.maxDist = Math.max(W, D) * 1.1;
    if (focus) r.jumpTo(focus.x, focus.z, next.cam?.dist ?? Math.min(g.R * 18, r.maxDist));
    else if (next.cam) {
      r.jumpTo(next.cam.x, next.cam.z, next.cam.dist);
      r.yaw = r.goalYaw = next.cam.yaw;
      r.pitchBias = next.cam.pitch;
    } else r.jumpTo(W / 2, D / 2, Math.min(g.R * 18, r.maxDist));
  }

  /** Start or stop the free camera from wherever the current camera is. */
  setFreeCam(on: boolean): void {
    const cam = this.activeCamera();
    const fc = this.freeCam;
    if (on && !fc.on) {
      fc.pos.copy(cam.position);
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      fc.yaw = Math.atan2(dir.x, dir.z);
      fc.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    }
    fc.on = on;
  }

  private flyFreeCam(cam: THREE.PerspectiveCamera, dt: number, d: { rotDX: number; rotDY: number; panDX: number; panDY: number; wheel: number }): void {
    const fc = this.freeCam;
    const inp = this.input;
    fc.yaw -= (d.rotDX + d.panDX) * 0.004;
    fc.pitch = THREE.MathUtils.clamp(fc.pitch - (d.rotDY + d.panDY) * 0.004, -1.5, 1.5);
    if (d.wheel) fc.speed = THREE.MathUtils.clamp(fc.speed * Math.exp(-d.wheel * 0.15), 5, 600);
    const fwd = new THREE.Vector3(Math.sin(fc.yaw) * Math.cos(fc.pitch), Math.sin(fc.pitch), Math.cos(fc.yaw) * Math.cos(fc.pitch));
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3();
    if (inp.isDown('panUp')) v.add(fwd);
    if (inp.isDown('panDown')) v.sub(fwd);
    if (inp.isDown('panRight')) v.add(right);
    if (inp.isDown('panLeft')) v.sub(right);
    if (inp.isDown('rotateRight')) v.y += 1;
    if (inp.isDown('rotateLeft')) v.y -= 1;
    if (v.lengthSq() > 0) fc.pos.addScaledVector(v.normalize(), fc.speed * dt);
    cam.position.copy(fc.pos);
    cam.lookAt(fc.pos.clone().add(fwd));
    cam.near = 0.3;
    cam.updateProjectionMatrix();
  }

  activeCamera(): THREE.PerspectiveCamera {
    if (this.observing) return this.observeCam;
    return this.space === 'surface' ? this.surfaceCam : this.nestCam;
  }

  activeScene(): THREE.Scene {
    return this.space === 'surface' ? this.surfaceScene : this.nestScene;
  }

  /** Begin the cinematic dive between spaces through a nest entrance. */
  switchSpace(to: ViewSpace, entranceSurface?: THREE.Vector3, entranceNest?: THREE.Vector2): void {
    if (this.transition || to === this.space) return;
    this.observing = false;
    this.transition = {
      to,
      t: 0,
      swapped: false,
      entranceSurface: entranceSurface ?? this.surfaceRig.target.clone(),
      entranceNest: entranceNest ?? new THREE.Vector2(this.nestRig.target.x, this.nestRig.target.z),
      returnDist: to === 'nest' ? this.nestRig.goalDistance : this.surfaceRig.goalDistance,
    };
  }

  get transitioning(): boolean {
    return !!this.transition || !!this.areaFade;
  }

  /**
   * Smooth cut between two underground areas (they are separate maps):
   * a quick fade to black, `swap` changes the shown area, then fade back in.
   */
  fadeCut(swap: () => void): void {
    if (this.areaFade) {
      this.areaFade.swap = swap;
      return;
    }
    this.areaFade = { t: 0, swapped: false, swap };
  }

  private updateAreaFade(dt: number): void {
    const f = this.areaFade!;
    f.t += dt;
    const OUT = 0.2;
    const IN = 0.32;
    if (!f.swapped) {
      this.fadeEl.style.opacity = String(Math.min(1, f.t / OUT));
      if (f.t >= OUT) {
        f.swapped = true;
        f.swap();
        f.t = 0;
      }
    } else {
      this.fadeEl.style.opacity = String(Math.max(0, 1 - f.t / IN));
      if (f.t >= IN) {
        this.fadeEl.style.opacity = '0';
        this.areaFade = null;
      }
    }
  }

  private updateTransition(dt: number): void {
    const tr = this.transition!;
    const D = 1.15;
    tr.t += dt / D;
    const t = Math.min(1, tr.t);
    if (!tr.swapped) {
      const k = t / 0.5;
      const e = k * k;
      if (this.space === 'surface') {
        this.surfaceRig.goal.copy(tr.entranceSurface);
        this.surfaceRig.goalDistance = THREE.MathUtils.lerp(this.surfaceRig.goalDistance, 14, e * 0.25);
      } else {
        this.nestRig.goal.set(tr.entranceNest.x, 0, tr.entranceNest.y);
        this.nestRig.goalDistance = THREE.MathUtils.lerp(this.nestRig.goalDistance, this.nestRig.minDist * 1.2, e * 0.25);
      }
      this.fadeEl.style.opacity = String(Math.min(1, e * 1.1));
      if (t >= 0.5) {
        tr.swapped = true;
        this.space = tr.to;
        if (tr.to === 'nest') {
          // arrive just above the ramp, then pull back
          this.nestRig.jumpTo(tr.entranceNest.x, tr.entranceNest.y, this.nestRig.minDist * 1.3);
          this.nestRig.goalDistance = Math.max(this.nestRig.minDist * 10, Math.min(tr.returnDist, this.nestRig.maxDist * 0.5));
        } else {
          this.surfaceRig.jumpTo(tr.entranceSurface.x, tr.entranceSurface.z, 16);
          this.surfaceRig.goalDistance = Math.max(140, tr.returnDist);
        }
        this.onSpaceChanged?.(this.space);
      }
    } else {
      const k = (t - 0.5) / 0.5;
      this.fadeEl.style.opacity = String(Math.max(0, 1 - k * 1.4));
    }
    if (t >= 1) {
      this.transition = null;
      this.fadeEl.style.opacity = '0';
    }
  }

  /** Ground point under the cursor on the surface (analytic ray march). */
  pickSurface(clientX: number, clientY: number): THREE.Vector3 | null {
    if (!this.terrain) return null;
    const ray = this.rayFrom(clientX, clientY, this.surfaceCam);
    const t = this.terrain;
    const p = new THREE.Vector3();
    let prev = ray.origin.clone();
    const maxT = this.surfaceCam.far;
    let step = Math.max(0.5, this.surfaceRig.distance / 200);
    for (let s = 0; s < maxT; s += step) {
      p.copy(ray.origin).addScaledVector(ray.direction, s);
      const h = t.walkHeight(Math.min(Math.max(p.x, 0), t.width), Math.min(Math.max(p.z, 0), t.depth));
      if (p.y <= h) {
        // refine
        let a = s - step;
        let b = s;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2;
          p.copy(ray.origin).addScaledVector(ray.direction, m);
          const hm = t.walkHeight(Math.min(Math.max(p.x, 0), t.width), Math.min(Math.max(p.z, 0), t.depth));
          if (p.y <= hm) b = m;
          else a = m;
        }
        p.y = t.walkHeight(Math.min(Math.max(p.x, 0), t.width), Math.min(Math.max(p.z, 0), t.depth));
        return p;
      }
      prev = p.clone();
      if (s > 50) step *= 1.02;
    }
    void prev;
    return null;
  }

  /** Point on the nest plane under the cursor (nest mm coords x, y), marching the nest heightfield. */
  pickNest(clientX: number, clientY: number): THREE.Vector2 | null {
    const nt = this.nestTerrain;
    if (!nt) return null;
    const g = nt.grid;
    const ray = this.rayFrom(clientX, clientY, this.nestCam);
    const p = new THREE.Vector3();
    const h = (x: number, z: number) => (x < 0 || z < 0 || x > g.widthMm || z > g.depthMm ? nt.wallH : nt.heightAt(x, z));
    let step = Math.max(0.3, this.nestRig.distance / 300);
    for (let s2 = 0; s2 < this.nestCam.far; s2 += step) {
      p.copy(ray.origin).addScaledVector(ray.direction, s2);
      if (p.y <= h(p.x, p.z)) {
        let a = s2 - step;
        let b = s2;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2;
          p.copy(ray.origin).addScaledVector(ray.direction, m);
          if (p.y <= h(p.x, p.z)) b = m;
          else a = m;
        }
        return new THREE.Vector2(p.x, p.z);
      }
      if (p.y < -5) return null;
      if (s2 > 50) step *= 1.02;
    }
    return null;
  }

  // ------------------------------------------------------------------ previews
  private thumbRT: THREE.WebGLRenderTarget | null = null;
  private thumbBuf: Float32Array | null = null;

  /**
   * Render a scene from a camera into a small 2D canvas (nest-tab previews).
   * Renders without post FX into a float target and tone-maps on readback.
   */
  renderToCanvas(scene: THREE.Scene, cam: THREE.Camera, out: HTMLCanvasElement, exposure = 1.25): void {
    const W = out.width;
    const H = out.height;
    if (!this.thumbRT || this.thumbRT.width !== W || this.thumbRT.height !== H) {
      this.thumbRT?.dispose();
      this.thumbRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: true });
      this.thumbBuf = new Float32Array(W * H * 4);
    }
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.thumbRT);
    this.renderer.render(scene, cam);
    this.renderer.readRenderTargetPixels(this.thumbRT, 0, 0, W, H, this.thumbBuf!);
    this.renderer.setRenderTarget(prev);
    const ctx = out.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const b = this.thumbBuf!;
    const aces = (v: number) => {
      v *= exposure;
      const t = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
      const c = Math.min(1, Math.max(0, t));
      return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
    };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const si = ((H - 1 - y) * W + x) * 4;
        const di = (y * W + x) * 4;
        img.data[di] = aces(b[si]);
        img.data[di + 1] = aces(b[si + 1]);
        img.data[di + 2] = aces(b[si + 2]);
        img.data[di + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
  }

  /** Ground footprint of a space's camera view (4 points, plane coords) for minimap frames. */
  viewFootprint(space: ViewSpace): Array<{ x: number; y: number }> {
    const cam = space === 'surface' ? this.surfaceCam : this.nestCam;
    const rig = space === 'surface' ? this.surfaceRig : this.nestRig;
    const planeY = rig.target.y;
    const out: Array<{ x: number; y: number }> = [];
    const rc = new THREE.Raycaster();
    for (const [nx, ny] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      rc.setFromCamera(new THREE.Vector2(nx, ny), cam);
      const d = rc.ray.direction;
      const o = rc.ray.origin;
      let t = d.y < -1e-4 ? (planeY - o.y) / d.y : rig.distance * 4;
      t = Math.min(t, rig.distance * 4);
      out.push({ x: o.x + d.x * t, y: o.z + d.z * t });
    }
    return out;
  }

  rayFrom(clientX: number, clientY: number, cam: THREE.Camera): THREE.Ray {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, cam);
    return rc.ray;
  }

  frame(dt: number, inputActive = true): void {
    this.time += dt;
    globalUniforms.uTime.value = this.time;
    const d = this.input.consume();
    if (this.transition) this.updateTransition(dt);
    if (this.areaFade) this.updateAreaFade(dt);
    const canControl = inputActive && !this.transition && !this.freeCam.on;
    if (this.observing) this.observeRig.update(dt, this.input, d);
    this.surfaceRig.update(dt, this.input, d, canControl && !this.observing && this.space === 'surface');
    this.nestRig.update(dt, this.input, d, canControl && !this.observing && this.space === 'nest');
    const cam = this.activeCamera();
    if (this.freeCam.on) this.flyFreeCam(cam, dt, d);
    globalUniforms.uCamPos.value.copy(cam.position);
    if (this.observing) globalUniforms.uFocus.value.copy(this.observeRig.smoothSubject);
    else globalUniforms.uFocus.value.copy(this.surfaceRig.target);

    // Shadow frustum follows the view so resolution stays high where we look.
    if (this.space === 'surface') {
      const f = this.observing ? this.observeRig.smoothSubject : this.surfaceRig.target;
      const sun = this.surfaceLights.sun;
      const dist = this.observing ? this.observeRig.distance * 3 : this.surfaceRig.distance;
      const ext = THREE.MathUtils.clamp(dist * 0.9, 40, 600);
      const sc = sun.shadow.camera as THREE.OrthographicCamera;
      if (Math.abs(sc.right - ext) > ext * 0.05) {
        sc.left = -ext;
        sc.right = ext;
        sc.top = ext;
        sc.bottom = -ext;
        sc.updateProjectionMatrix();
      }
      // Snap to shadow texels to avoid shimmering.
      const texel = (ext * 2) / sun.shadow.mapSize.x;
      const fx = Math.round(f.x / texel) * texel;
      const fz = Math.round(f.z / texel) * texel;
      sun.target.position.set(fx, f.y, fz);
      sun.position.set(fx, f.y, fz).addScaledVector(this.surfaceLights.sunDir, 1000);
      this.terrainMesh?.rebuild();
      this.water?.rebuild();
    } else {
      this.nestTerrain?.update();
    }
    for (const f of this.beforeRender) f(dt);

    // Depth of field focus = distance to what we look at.
    const focus = this.observing ? this.observeRig.distance : this.space === 'surface' ? this.surfaceRig.distance : this.nestRig.distance;
    this.post.focusDistance = focus;
    this.post.tilt = this.observing ? 0.15 : this.space === 'surface' ? 0.55 : 0.45;
    this.post.settings.dofStrength = this.observing ? 1.2 : 1;
    this.applyGrade();
    this.post.render(this.activeScene(), cam);
  }

  private applyGrade(): void {
    const g = this.post.settings.grade;
    if (this.space === 'surface') {
      g.exposure = this.night ? 1.25 : 1.0;
      g.saturation = this.night ? 0.7 : 1.08;
      g.contrast = 1.06;
      g.warmth = this.night ? -0.6 : 0.25;
      g.vignette = 0.32;
      g.lift.setRGB(0.008, 0.007, 0.004);
    } else {
      g.exposure = 1.0;
      g.saturation = 1.0;
      g.contrast = 1.14;
      g.warmth = 0.35;
      g.vignette = 0.5;
      g.lift.setRGB(0.006, 0.006, 0.004);
    }
  }
}
