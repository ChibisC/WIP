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
    if (g && g.drawRange && g.drawRange.count === 0) {
      const c = g.drawRange.count;
      g.drawRange.count = Infinity;
      undo.push(() => (g.drawRange.count = c));
    }
  });
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
    for (let i = undo.length - 1; i >= 0; i--) undo[i]();
  }
  return performance.now() - t0;
}

/** A camera that sees the whole of a w × d plane from above (for warming an area). */
export function overviewCamera(w: number, d: number, y0 = 0): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 1, 1, Math.max(w, d) * 4);
  cam.position.set(w / 2, y0 + Math.max(w, d) * 1.1, d / 2 + Math.max(w, d) * 0.3);
  cam.lookAt(w / 2, y0, d / 2);
  cam.updateMatrixWorld();
  return cam;
}
