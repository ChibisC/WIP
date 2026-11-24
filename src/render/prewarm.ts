import * as THREE from 'three';

/**
 * Warming a scene (performance pass, CHANGE_PLAN §25; claude/performance/01-spec-performance-no-visual-loss.md §2).
 *
 * The first time a material is drawn the browser compiles and links its shaders, and many drivers (and SwiftShader)
 * finish that work only at the first draw; the first time a texture or buffer is drawn it is uploaded; the first shadow
 * pass of a light allocates its shadow map. Done at the moment an area is first shown, that was a frame of seconds on
 * slow machines. `warmScene` does it while loading: every object is drawn once — hidden ones and empty instanced ones
 * too, with one instance — into a small target that is never shown, with the scene's own lights and shadows. Nothing
 * on screen changes: visibility and instance counts are put back.
 */
let target: THREE.WebGLRenderTarget | null = null;

/**
 * A small target made like the one the scene is drawn into in play (render/post.ts: HDR, four samples, a depth texture)
 * — performance v5. A GPU's pipeline for a draw depends on the target's formats and sample count: warming into a
 * different target (one sample, as before) left every pipeline to be built again on the first real frame (8–12 s
 * frames after loading on a Mac); and a program compiled with no target set is the variant for drawing straight to
 * the screen (tone mapped, sRGB), which the game never uses while the post effects are on.
 */
export function sceneTarget(): THREE.WebGLRenderTarget {
  if (!target) {
    target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
    target.depthTexture = new THREE.DepthTexture(64, 64);
    target.depthTexture.type = THREE.UnsignedIntType;
  }
  return target;
}

/**
 * Warm a scene: `toScreen` when the game draws it straight to the canvas (no post effects: Low quality), else into a
 * target like the post pipeline's.
 */
export function warmScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, toScreen = false): number {
  const t0 = performance.now();
  const undo: Array<() => void> = [];
  scene.traverse((o) => {
    if (!o.visible) {
      o.visible = true;
      undo.push(() => (o.visible = false));
    }
    if (o.frustumCulled) {
      o.frustumCulled = false;
      undo.push(() => (o.frustumCulled = true));
    }
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh && im.count === 0) {
      im.count = 1;
      undo.push(() => (im.count = 0));
    }
    // (points and lines with nothing in them: draw one element)
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    // (instanced geometry with no instances — the glue and acid streams: one, so the draw is made — performance v6)
    const ig = g as THREE.InstancedBufferGeometry | undefined;
    if (ig && ig.isInstancedBufferGeometry && ig.instanceCount === 0) {
      ig.instanceCount = 1;
      undo.push(() => (ig.instanceCount = 0));
    }
    if (g && g.drawRange && g.drawRange.count === 0) {
      const c = g.drawRange.count;
      g.drawRange.count = Infinity;
      undo.push(() => (g.drawRange.count = c));
    }
  });
  // (performance v6: every caster's own shadow program drawn — see `shadowTwins`)
  const twins = renderer.shadowMap.enabled ? shadowTwins(scene) : null;
  if (twins) scene.add(twins);
  const prev = renderer.getRenderTarget();
  const prevAuto = renderer.shadowMap.autoUpdate;
  const prevScissor = renderer.getScissorTest();
  renderer.shadowMap.autoUpdate = true;
  renderer.shadowMap.needsUpdate = true;
  try {
    // (the target is set first: the programs compiled are the variants drawn in play)
    renderer.setRenderTarget(toScreen ? null : sceneTarget());
    // (to the screen: one pixel of it, under the loading screen — the draw is what counts, not what it shows)
    if (toScreen) {
      renderer.setScissor(0, 0, 1, 1);
      renderer.setScissorTest(true);
    }
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
  } catch (e) {
    // (warming is an optimisation: whatever failed here is built when it is first drawn, as before)
    console.warn('[prewarm]', e);
  } finally {
    if (toScreen) {
      renderer.setScissorTest(prevScissor);
      renderer.setScissor(0, 0, renderer.domElement.width, renderer.domElement.height);
    }
    renderer.setRenderTarget(prev);
    renderer.shadowMap.autoUpdate = prevAuto;
    if (twins) scene.remove(twins);
    for (let i = undo.length - 1; i >= 0; i--) undo[i]();
  }
  return performance.now() - t0;
}

/**
 * The depth materials the stand-ins and twins below are drawn with, one for each scene and set of settings, kept for
 * the whole game: a program lives while a material that used it does (three releases it when the last one is
 * disposed), and the shadow pass's own shared depth material may never hold these variants itself. One set a scene:
 * a program is chosen with the lights of the scene it is first drawn in (their counts are in its key) and a depth
 * material keeps it after — one shared with an underground area drew the surface's casters with the area's variant.
 */
const depthKit = new Map<string, THREE.MeshDepthMaterial>();
function keptDepth(m: THREE.Material, o: THREE.Object3D, kit: string): THREE.MeshDepthMaterial {
  const mm = m as THREE.MeshStandardMaterial;
  const im = o as THREE.InstancedMesh;
  const key = [kit, m.side, m.shadowSide, !!mm.map, !!mm.alphaMap, m.alphaTest > 0, m.alphaToCoverage, !!mm.displacementMap, !!im.isInstancedMesh, !!im.instanceColor, !!(im as { morphTexture?: unknown }).morphTexture].join();
  let d = depthKit.get(key);
  if (!d) {
    d = new THREE.MeshDepthMaterial();
    depthKit.set(key, d);
  }
  return d;
}

/**
 * Twins of a scene's shadow casters for the warm-up's draw (performance v6). The shadow pass draws a caster that has
 * no depth material of its own with one shared depth material, and three picks that material's program again only
 * when the kind of object changes (instanced or not, and so on) — taking the map and side of the caster it changes
 * at, and keeping that program for the casters after it. So which depth programs a warm-up builds depends on the
 * order things are drawn in: the arena's anthill rebuilt in play (its new mound drawn first after the instanced
 * casters) needed a variant nothing had been drawn with at loading, and linked it on the frame it was first
 * shadowed — 2.6–6.4 s on the build machine. Each twin shares its caster's geometry, instances and material and has
 * its own depth material (or the caster's own one), so the warm-up's shadow pass draws every caster's own variant
 * into the shadow map: compiled, linked and its pipeline built while loading. Twins sit at their caster's place.
 */
export function shadowTwins(scene: THREE.Object3D): THREE.Group | null {
  const group = new THREE.Group();
  group.name = 'shadow twins (warm-up)';
  scene.updateMatrixWorld();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.castShadow || Array.isArray(m.material) || !m.material) return;
    const im = o as THREE.InstancedMesh;
    let twin: THREE.Mesh;
    if (im.isInstancedMesh) {
      const t = new THREE.InstancedMesh(m.geometry, m.material, Math.max(1, im.count));
      t.instanceMatrix = im.instanceMatrix;
      t.instanceColor = im.instanceColor;
      (t as { morphTexture?: unknown }).morphTexture = (im as { morphTexture?: unknown }).morphTexture;
      twin = t;
    } else twin = new THREE.Mesh(m.geometry, m.material);
    twin.castShadow = true;
    twin.frustumCulled = false;
    twin.customDepthMaterial = m.customDepthMaterial ?? keptDepth(m.material, o, scene.uuid);
    twin.matrixAutoUpdate = false;
    twin.matrix.copy(o.matrixWorld);
    group.add(twin);
  });
  return group.children.length ? group : null;
}

/** A camera that sees the whole of a w × d plane from above (for warming an area). */
export function overviewCamera(w: number, d: number, y0 = 0): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 1, 1, Math.max(w, d) * 4);
  cam.position.set(w / 2, y0 + Math.max(w, d) * 1.1, d / 2 + Math.max(w, d) * 0.3);
  cam.lookAt(w / 2, y0, d / 2);
  cam.updateMatrixWorld();
  return cam;
}

/**
 * Wait, without blocking the page, until the GPU has done everything queued so far (performance v5 round 2): a WebGL2
 * fence polled between tasks, so the loading screen keeps moving. The pre-warm's draws and uploads (and the pipelines
 * a GPU builds as it takes each draw) run after the calls return; ended with the loading screen, the first frames of
 * play waited for all of it — on the build machine a read-back right after loading waited minutes. Resolves with the
 * time waited (ms); gives up after `maxMs`. WebGL1 has no fences: nothing to wait for there.
 */
export async function gpuIdle(renderer: THREE.WebGLRenderer, maxMs = 30000): Promise<number> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (typeof gl.fenceSync !== 'function') return 0;
  const t0 = performance.now();
  const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!s) return 0;
  gl.flush();
  while (gl.getSyncParameter(s, gl.SYNC_STATUS) !== gl.SIGNALED && performance.now() - t0 < maxMs) await new Promise<void>((res) => setTimeout(res, 8));
  gl.deleteSync(s);
  return performance.now() - t0;
}

/**
 * Stand-ins for `objs`' shadow draws (performance v6): `renderer.compileAsync` compiles the programs an object is drawn
 * with, not the ones the shadow map draws it with — three's shadow pass draws each caster with its depth material
 * (its own `customDepthMaterial`, else a shared plain one) set from the object's material (`WebGLShadowMap
 * getDepthMaterial`: side, alpha test and map, clipping, displacement). An anthill rebuilt in play (the arena's, when
 * its team's ants came) linked its depth program on the frame it was first shadowed: 2.6–6.4 s here. Each stand-in
 * shares the caster's geometry and has a depth material with the same settings (a program is chosen by its settings,
 * so the shadow pass then finds it built). `scene` is the one the objects will be shadowed in (its depth kit: see
 * `keptDepth`). `restore` puts the custom depth materials' own settings back after the compile has read them.
 */
export function shadowStandIns(objs: THREE.Object3D[], scene: THREE.Object3D): { group: THREE.Group; restore: () => void } {
  const group = new THREE.Group();
  const undo: Array<() => void> = [];
  const side = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide } as Record<number, THREE.Side>;
  const visit = (o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.castShadow || Array.isArray(m.material)) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    let dm = m.customDepthMaterial as THREE.MeshDepthMaterial | undefined;
    if (dm) {
      const keep = { side: dm.side, alphaMap: dm.alphaMap, alphaTest: dm.alphaTest, map: dm.map, displacementMap: dm.displacementMap, wireframe: dm.wireframe };
      undo.push(() => Object.assign(dm!, keep));
    } else dm = keptDepth(mat, o, scene.uuid);
    dm.wireframe = mat.wireframe;
    dm.side = mat.shadowSide !== null && mat.shadowSide !== undefined ? mat.shadowSide : side[mat.side];
    dm.alphaMap = mat.alphaMap ?? null;
    dm.alphaTest = mat.alphaToCoverage ? 0.5 : mat.alphaTest;
    dm.map = mat.map ?? null;
    dm.displacementMap = mat.displacementMap ?? null;
    const im = o as THREE.InstancedMesh;
    let twin: THREE.Mesh;
    if (im.isInstancedMesh) {
      const t = new THREE.InstancedMesh(m.geometry, dm, Math.max(1, im.count));
      t.instanceMatrix = im.instanceMatrix;
      t.instanceColor = im.instanceColor;
      (t as { morphTexture?: unknown }).morphTexture = (im as { morphTexture?: unknown }).morphTexture;
      twin = t;
    } else twin = new THREE.Mesh(m.geometry, dm);
    group.add(twin);
  };
  for (const o of objs) o.traverse(visit);
  return { group, restore: () => undo.forEach((f) => f()) };
}
