/**
 * Where the GPU's time goes (performance v5, claude/performance/05-spec-performance-v5-nonstop.md §1.5): for a few
 * frames every pass — the shadow maps, the scene, each post effect — is followed by `gl.finish()`, which waits until
 * the GPU has done all of it, so each pass's time can be read on any browser (Safari has no GPU timer queries).
 * Waiting kills the overlap of the CPU and the GPU, so these frames are slower than real ones; what matters is how the
 * time splits. Draws are not waited for one by one (on a tiled GPU — Apple's — each wait would end the render pass
 * and store and reload the whole target): their triangles are counted by group instead. Used by the benchmark.
 */
import * as THREE from 'three';
import type { GameSession } from '../game/session';

export interface GpuBreakdown {
  frames: number;
  /** a whole frame with every pass waited for (ms) */
  frameMs: number;
  /** each pass's time (ms a frame), largest first */
  passes: Array<{ name: string; ms: number }>;
  /** the scene and shadow passes' draws, grouped by what they draw (triangles a frame), most first */
  draws: Array<{ name: string; tris: number }>;
}

/** A draw's group: its own or its nearest named parent's name (an ant model's LOD kept, its species dropped). */
function groupOf(o: THREE.Object3D): string {
  let x: THREE.Object3D | null = o;
  while (x && !x.name) x = x.parent;
  let n = x?.name || (o as THREE.Mesh).material?.constructor?.name || o.type;
  if (n.startsWith('ants:')) n = 'ants ' + n.split(':')[2];
  return n;
}

export function measureGpu(s: GameSession, frames: number, done: (r: GpuBreakdown) => void): void {
  const v = s.view;
  const r = v.renderer;
  const gl = r.getContext();
  const passes = new Map<string, number>();
  const draws = new Map<string, number>();
  let on = false;
  let markT = 0;
  let pass = 'scene';
  let tri0 = 0;
  const wait = () => {
    gl.finish();
    return performance.now();
  };
  const post = v.post;
  post.mark = (name) => {
    if (!on) return;
    if (!name) {
      // the post pipeline starts: the frame's own work before it (the main thread's) is not a pass
      markT = wait();
      return;
    }
    const t = wait();
    passes.set(name, (passes.get(name) ?? 0) + t - markT);
    markT = wait();
  };
  // the shadow maps are drawn inside the scene pass: timed on their own and taken out of it
  const sm = r.shadowMap;
  const smRender = sm.render;
  sm.render = function (...a: Parameters<typeof smRender>) {
    if (!on) return smRender.apply(this, a);
    const t0 = wait();
    pass = 'shadow';
    smRender.apply(this, a);
    pass = 'scene';
    const t1 = wait();
    passes.set('shadow maps', (passes.get('shadow maps') ?? 0) + t1 - t0);
    markT += t1 - t0;
  };
  // every drawable in the scenes, timed draw by draw (objects added later fall in the pass's remainder)
  const hooked: Array<{ o: THREE.Object3D; b: THREE.Object3D['onBeforeRender']; a: THREE.Object3D['onAfterRender']; bs: THREE.Object3D['onBeforeShadow']; as: THREE.Object3D['onAfterShadow'] }> = [];
  const scenes = [v.surfaceScene, ...[...s.nests.values()].map((nv) => nv.stage.scene)];
  for (const sc of scenes)
    sc.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
      const g = groupOf(o);
      const rec = { o, b: o.onBeforeRender, a: o.onAfterRender, bs: o.onBeforeShadow, as: o.onAfterShadow };
      hooked.push(rec);
      const before = () => {
        if (on) tri0 = r.info.render.triangles;
      };
      const after = (shadow: boolean) => {
        if (!on) return;
        const k = (shadow ? 'shadow: ' : '') + g;
        draws.set(k, (draws.get(k) ?? 0) + r.info.render.triangles - tri0);
      };
      o.onBeforeRender = function (...x) {
        before();
        return rec.b.apply(this, x);
      };
      o.onAfterRender = function (...x) {
        const res = rec.a.apply(this, x);
        after(pass === 'shadow');
        return res;
      };
      o.onBeforeShadow = function (...x) {
        before();
        return rec.bs.apply(this, x);
      };
      o.onAfterShadow = function (...x) {
        const res = rec.as.apply(this, x);
        after(true);
        return res;
      };
    });
  let n = 0;
  let total = 0;
  let frameT = 0;
  const skip = 2;
  const loop = () => {
    if (on) {
      const t = wait();
      total += t - frameT;
      n++;
    }
    if (n >= frames) {
      on = false;
      post.mark = null;
      sm.render = smRender;
      for (const h of hooked) {
        h.o.onBeforeRender = h.b;
        h.o.onAfterRender = h.a;
        h.o.onBeforeShadow = h.bs;
        h.o.onAfterShadow = h.as;
      }
      const per = (ms: number) => +(ms / Math.max(1, n)).toFixed(2);
      done({
        frames: n,
        frameMs: per(total),
        passes: [...passes].map(([name, ms]) => ({ name, ms: per(ms) })).sort((a, b) => b.ms - a.ms),
        draws: [...draws]
          .map(([name, tris]) => ({ name, tris: Math.round(tris / Math.max(1, n)) }))
          .sort((a, b) => b.tris - a.tris)
          .slice(0, 12),
      });
      return;
    }
    started++;
    if (started > skip) {
      on = true;
      frameT = wait();
      markT = frameT;
    }
    requestAnimationFrame(loop);
  };
  let started = 0;
  requestAnimationFrame(loop);
}
