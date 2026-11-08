/**
 * The ant renderer's CPU time per frame, headless (no WebGL: the impostors are stubbed). Performance v2 (CHANGE_PLAN
 * §29): measures the per-ant animation, with the camera seeing all the ants or a fifth of them.
 *
 *   npx vite-node tools/perf/antRendererBench.ts [ants=900] [frames=240]
 */
import * as THREE from 'three';
import { AntRenderer, AntSpaceAdapter, AntView } from '../../src/render/ants/antRenderer';
import { blankView } from '../../src/game/antViews';
import { MORPHS } from '../../src/render/ants/morphs';
import { ViewCull } from '../../src/render/viewCull';
import type { Ant } from '../../src/sim/types';

const N = Number(process.argv[2] ?? 900);
const FRAMES = Number(process.argv[3] ?? 240);
const morphs = ['lasius_worker', 'lasius_soldier', 'formica_worker', 'fire_worker', 'fire_major', 'atta_minor', 'atta_major', 'hell_soldier'].filter((k) => MORPHS[k]);

function run(label: string, camSpan: number, culled = false): void {
  const r = new AntRenderer({} as THREE.WebGLRenderer, 'bench');
  const imp = (r as unknown as { impostorMats: Map<string, THREE.Material> }).impostorMats;
  for (const k of morphs) imp.set(k, new THREE.MeshStandardMaterial());
  const adapter: AntSpaceAdapter = {
    toWorld: (x, y, out) => out.set(x, 0, y),
    normal: (_x, _y, out) => out.set(0, 1, 0),
    forward: (h, out) => out.set(Math.cos(h), 0, Math.sin(h)),
  };
  // ants on a 600 × 600 mm field, walking in circles
  const views: AntView[] = [];
  for (let i = 0; i < N; i++) {
    const v = blankView();
    v.id = i + 1;
    v.morph = morphs[i % morphs.length];
    views.push(v);
  }
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 1, 5000);
  const place = (t: number) => {
    for (let i = 0; i < N; i++) {
      const v = views[i];
      const cx = ((i * 37) % 600) + 0.5;
      const cy = ((i * 91) % 600) + 0.5;
      const a0 = (t - 0.05) * 0.8 + i;
      const a1 = t * 0.8 + i;
      v.px = cx + Math.cos(a0) * 20;
      v.py = cy + Math.sin(a0) * 20;
      v.x = cx + Math.cos(a1) * 20;
      v.y = cy + Math.sin(a1) * 20;
      v.pheading = a0 + Math.PI / 2;
      v.heading = a1 + Math.PI / 2;
    }
  };
  // the camera looks down at the field's middle from far enough to see `camSpan` mm across
  const dist = camSpan / (2 * Math.tan(THREE.MathUtils.degToRad(25))) / (16 / 9);
  cam.position.set(300, dist, 300 + dist * 0.4);
  cam.lookAt(300, 0, 300);
  cam.updateMatrixWorld();
  let t = 0;
  const times: number[] = [];
  const cull = new ViewCull();
  const pos = (x: number, y: number, _l: number, out: THREE.Vector3) => out.set(x, 0, y);
  for (let f = 0; f < FRAMES; f++) {
    t += 1 / 60;
    place(t);
    const t0 = performance.now();
    let list = views;
    if (culled) {
      // the views' loose test (render/viewCull.ts), as the session and the nest view do it
      cull.begin(cam);
      list = views.filter((v) => cull.keeps({ x: v.x, y: v.y, state: 0, fz: 0 } as unknown as Ant, pos));
    }
    r.update(list, (f % 3) / 3, 1 / 60, cam, adapter, 760);
    if (f >= 30) times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`${label}: ${avg.toFixed(2)} ms a frame (p95 ${times[Math.floor(times.length * 0.95)].toFixed(2)}) for ${N} ants, ${r.stats.drawn} drawn`);
}

for (const culled of [false, true]) {
  console.log(culled ? 'with the views\' loose view test (render/viewCull.ts):' : 'every ant animated (before):');
  run('  whole field in view', 900, culled);
  run('  a fifth in view', 900 / Math.sqrt(5), culled);
  run('  zoomed in (≈ 1/30)', 900 / Math.sqrt(30), culled);
}
