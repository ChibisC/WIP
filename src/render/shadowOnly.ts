import * as THREE from 'three';

/**
 * Objects drawn only into the shadow maps (trees v2: the canopy's coarse shadow casters). They are hidden from every
 * camera and shown while the renderer draws its shadow maps: three.js lists a frame's drawables before it draws the
 * shadows, so a group hidden then and shown for the shadow pass is drawn into the shadow maps alone. (Layers can't do
 * it: the shadow pass tests an object's layers against the view's camera.)
 */
const only = new Set<THREE.Object3D>();
const wrapped = new WeakSet<THREE.WebGLShadowMap>();

/** Draw `o` (and what it holds) into the shadow maps only. */
export function shadowOnly(o: THREE.Object3D): void {
  o.visible = false;
  only.add(o);
}

/** Make a renderer show the shadow-only objects while it draws its shadow maps (once per renderer). */
export function installShadowOnly(r: THREE.WebGLRenderer): void {
  const sm = r.shadowMap;
  if (wrapped.has(sm)) return;
  wrapped.add(sm);
  const render = sm.render;
  sm.render = function (...a: Parameters<typeof render>) {
    if (only.size === 0) return render.apply(this, a);
    for (const o of only) o.visible = true;
    try {
      render.apply(this, a);
    } finally {
      for (const o of only) o.visible = false;
    }
  };
}
