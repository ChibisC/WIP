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

export function warmScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): number {
  const t0 = performance.now();
  target ??= new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true });
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
  renderer.shadowMap.autoUpdate = true;
  renderer.shadowMap.needsUpdate = true;
  try {
    renderer.compile(scene, camera);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } catch (e) {
    // (warming is an optimisation: whatever failed here is built when it is first drawn, as before)
    console.warn('[prewarm]', e);
  } finally {
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
