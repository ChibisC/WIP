import * as THREE from 'three';
import { Input } from '../core/input';
import { GameView } from '../render/view';
import { Terrain, defaultTerrainParams } from '../world/terrain';
import { NestGrid } from '../world/nestGrid';
import { AntRenderer, AntView, AntSpaceAdapter } from '../render/ants/antRenderer';
import { POSE } from '../render/ants/antMaterial';

/**
 * Rendering stress/look test: ?scene=swarm&n=1000 — random walkers on the
 * surface using the real instanced ant renderer (no colony sim yet).
 */
export function runSwarmTest(canvas: HTMLCanvasElement, q: URLSearchParams): void {
  const input = new Input(canvas);
  const view = new GameView(canvas, input);
  view.setQuality((q.get('q') as 'low' | 'medium' | 'high') || 'high');
  const terrain = new Terrain(defaultTerrainParams(5, 'meadow', 600, 600));
  view.setTerrain(terrain);
  const grid = new NestGrid({ cols: 34, rows: 30, R: 6, seed: 5 });
  for (let q = 0; q < grid.cols * grid.rows; q++) if (grid.hexDistance(q, grid.hexIndex(17, 15)) <= 2) grid.completeHex(q);
  view.addNest(0, grid);
  const ants = new AntRenderer(view.renderer);
  view.surfaceScene.add(ants.group);
  const n = Number(q.get('n') || 600);
  const morphs = (q.get('morphs') || 'lasius_worker,lasius_soldier,formica_worker,formica_soldier,formica_mortar,formica_rapid,atta_media,atta_soldier,atta_major,fire_minor,fire_soldier,fire_major,eciton_minor,eciton_submajor,eciton_media,eciton_major').split(',');
  const cx = Number(q.get('x') || 300);
  const cz = Number(q.get('z') || 300);
  const R = Number(q.get('r') || 120);
  const views: AntView[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = q.get('straight') ? cx - 6 + i * 3 : cx + Math.cos(a) * r;
    const y = q.get('straight') ? cz + i * 3 : cz + Math.sin(a) * r;
    views.push({
      id: i,
      morph: morphs[i % morphs.length],
      space: 0,
      x,
      y,
      px: x,
      py: y,
      heading: q.get('straight') ? 0 : Math.random() * 6.28,
      pheading: 0,
      pose: 0,
      mandible: 0,
      antennaPitch: 0,
      antennaActivity: 0.3,
      gaster: 0,
      headPitch: 0,
      headYaw: 0,
      dead: false,
      carrying: false,
      crop: 0,
      sizeVar: Math.random() * 2 - 1,
      colorVar: Math.random() * 2 - 1,
      lift: 0,
      roll: 0,
      pitch: 0,
      selected: false,
    });
  }
  const speeds = new Map<number, number>();
  const pauses = new Map<number, number>();
  const adapter: AntSpaceAdapter = {
    toWorld: (x, y, out) => out.set(x, terrain.walkHeight(x, y), y),
    normal: (x, y, out) => {
      const o = { x: 0, y: 1, z: 0 };
      terrain.walkNormal(x, y, o);
      out.set(o.x, o.y, o.z);
    },
    forward: (h, out) => out.set(Math.cos(h), 0, Math.sin(h)),
  };
  const fixedPose = Number(q.get('pose') || -1);
  const tick = () => {
    for (const v of views) {
      v.px = v.x;
      v.py = v.y;
      v.pheading = v.heading;
      let p = pauses.get(v.id) ?? 0;
      if (fixedPose >= 0) {
        v.pose = fixedPose;
        continue;
      }
      if (p > 0) {
        pauses.set(v.id, p - 0.05);
        v.antennaActivity = 0.8;
        if (v.id % 7 === 0) v.pose = POSE.GROOM_ANT;
        continue;
      }
      v.pose = 0;
      v.antennaActivity = 0.3;
      if (q.get('straight')) {
        v.x += Math.cos(v.heading) * Number(q.get('speed') || 15) * 0.05;
        v.y += Math.sin(v.heading) * Number(q.get('speed') || 15) * 0.05;
        continue;
      }
      if (Math.random() < 0.01) pauses.set(v.id, 0.5 + Math.random() * 2);
      v.heading += (Math.random() - 0.5) * 0.5;
      const L = v.morph.startsWith('fire') ? 3 : v.morph.startsWith('lasius') ? 4 : v.morph.includes('soldier') ? 13 : 7;
      const sp = (speeds.get(v.id) ?? L * 3.5) * 0.05;
      const nx = v.x + Math.cos(v.heading) * sp;
      const ny = v.y + Math.sin(v.heading) * sp;
      if (Math.hypot(nx - cx, ny - cz) > R) v.heading += Math.PI * 0.6;
      else {
        v.x = nx;
        v.y = ny;
      }
    }
  };
  if (q.get('dist')) view.surfaceRig.jumpTo(cx, cz, Number(q.get('dist')));
  else view.surfaceRig.jumpTo(cx, cz, 200);
  if (q.get('yaw')) view.surfaceRig.yaw = view.surfaceRig.goalYaw = Number(q.get('yaw'));
  let acc = 0;
  const w = window as unknown as { __ready: boolean; __shotInfo: unknown; __step: (k: number, dt: number) => void };
  const step = (dt: number) => {
    acc += dt;
    while (acc >= 0.05) {
      tick();
      acc -= 0.05;
    }
    if (q.get('follow')) {
      const f = views[0];
      view.surfaceRig.jumpTo(f.x, f.y, Number(q.get('dist') || 14));
    }
    const t0 = performance.now();
    ants.update(views, acc / 0.05, dt, view.activeCamera(), adapter, window.innerHeight * view.renderer.getPixelRatio());
    const t1 = performance.now();
    view.frame(dt);
    w.__shotInfo = { antsCpuMs: +(t1 - t0).toFixed(2), stats: ants.stats, calls: view.renderer.info.render.calls, tris: view.renderer.info.render.triangles };
  };
  w.__step = (k: number, dt: number) => {
    for (let i = 0; i < k; i++) step(dt);
  };
  if (q.get('shot')) {
    // Warm up a few frames so gait/pose blends settle.
    for (let i = 0; i < 20; i++) {
      tick();
      ants.update(views, 1, 0.05, view.activeCamera(), adapter, window.innerHeight * view.renderer.getPixelRatio());
    }
    step(0.05);
    step(0.05);
    w.__ready = true;
    return;
  }
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setTimeout(() => (w.__ready = true), 500);
  void THREE;
}
