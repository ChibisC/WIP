/**
 * The main thread's per-frame CPU for the ants in a real fight (performance v3, CHANGE_PLAN §32): the big-fight stress
 * world (the bench's fight scene) is simulated until the armies are engaged; then each frame builds the surface ants'
 * views (game/antViews.ts antToView, as the session does) and runs the ant renderer over them (no WebGL: the impostor
 * materials are stubbed, as in antRendererBench.ts), the sim stepping every third frame (60 fps against 20 Hz).
 * The camera is the game's default surface zoom over the fight, or the whole field (`all`).
 *
 *   tools/perf/bundle-units.sh, then node <bundle> [antsPerColony=200] [frames=300] [view=default|all] [warmTicks=300]
 */
import * as THREE from 'three';
import { EventBus } from '../../src/core/events';
import { createStressWorld } from '../../src/dev/stressScene';
import { AntRenderer, AntSpaceAdapter, AntView } from '../../src/render/ants/antRenderer';
import { antToView, blankView } from '../../src/game/antViews';
import { ViewCull } from '../../src/render/viewCull';
import { MORPHS } from '../../src/render/ants/morphs';
import { AS, SURFACE } from '../../src/sim/types';
import { CreatureRenderer } from '../../src/render/creatures/creatureRenderer';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const PER = Number(argv[0] ?? 200);
const FRAMES = Number(argv[1] ?? 300);
const VIEW = argv[2] ?? 'default';
const WARM = Number(argv[3] ?? 300);

const w = createStressWorld(new EventBus(), PER, 100);
for (let i = 0; i < WARM; i++) {
  w.step(0.05);
  w.events.drain();
}
const t = w.terrain;
const cx = (x: number) => Math.max(0, Math.min(t.width, x));
const cy = (y: number) => Math.max(0, Math.min(t.depth, y));
const n3 = new THREE.Vector3();
const adapter: AntSpaceAdapter = {
  toWorld: (x, y, out) => out.set(x, t.walkHeight(cx(x), cy(y)), y),
  normal: (x, y, out) => {
    t.walkNormal(cx(x), cy(y), n3);
    out.set(n3.x, n3.y, n3.z);
  },
  forward: (h, out) => out.set(Math.cos(h), 0, Math.sin(h)),
};
const pos = (x: number, y: number, lift: number, out: THREE.Vector3) => out.set(x, t.walkHeight(cx(x), cy(y)) + lift, y);

const r = new AntRenderer({} as THREE.WebGLRenderer, 'bench');
const imp = (r as unknown as { impostorMats: Map<string, THREE.Material> }).impostorMats;
for (const k of Object.keys(MORPHS)) imp.set(k, new THREE.MeshStandardMaterial());
// the game builds the models before play (render/prewarm.ts): the ones this world has
{
  const ms = new Set<string>();
  const vv = blankView();
  for (const a of w.s.ants) ms.add(antToView(w, a, vv, 0, 0).morph);
  r.prepare(ms);
}

// where the most surface ants are (a 60 mm grid's fullest cell)
const G = 60;
const gw = Math.ceil(t.width / G);
const cnt = new Map<number, number>();
for (const a of w.s.ants) if (a.space === SURFACE && a.state !== AS.Dead) {
  const key = Math.floor(a.y / G) * gw + Math.floor(a.x / G);
  cnt.set(key, (cnt.get(key) ?? 0) + 1);
}
let bestK = 0;
for (const [key, c] of cnt) if (c > (cnt.get(bestK) ?? 0)) bestK = key;
const mx = ((bestK % gw) + 0.5) * G;
const my = (Math.floor(bestK / gw) + 0.5) * G;
const cam = new THREE.PerspectiveCamera(50, 1470 / 810, 1, 8000);
// the bench's default surface view (distance 260 at a 0.6 rad yaw) or the whole map from high up
const dist = VIEW === 'all' ? Math.max(t.width, t.depth) * 1.1 : 260;
cam.position.set(mx + Math.cos(0.6) * dist * 0.55, t.walkHeight(cx(mx), cy(my)) + dist * 0.83, my + Math.sin(0.6) * dist * 0.55);
cam.lookAt(mx, t.walkHeight(cx(mx), cy(my)), my);
cam.updateMatrixWorld();

const crs = new CreatureRenderer('bench');
const ground = (x: number, y: number) => t.walkHeight(cx(x), cy(y));
const tc: number[] = [];
const views: AntView[] = [];
const list: AntView[] = [];
const cull = new ViewCull();
const tv: number[] = [];
const tr: number[] = [];
let drawn = 0;
let lods = "";
for (let f = 0; f < FRAMES; f++) {
  if (f % 3 === 0) {
    w.step(0.05);
    w.events.drain();
  }
  const t0 = performance.now();
  let n = 0;
  cull.begin(cam);
  for (const a of w.s.ants) {
    if (a.space !== SURFACE) continue;
    if (a.state === AS.Dead && a.deadT > 30) continue;
    if (!cull.keeps(a, pos)) continue;
    if (n >= views.length) views.push(blankView());
    antToView(w, a, views[n++], 0, 0);
  }
  list.length = n;
  for (let i = 0; i < n; i++) list[i] = views[i];
  const t1 = performance.now();
  r.update(list, (f % 3) / 3, 1 / 60, cam, adapter, 810);
  const t2 = performance.now();
  crs.update(w.s.creatures, SURFACE, (f % 3) / 3, 1 / 60, ground, cam, 810);
  const t3 = performance.now();
  if (f >= 30) {
    tc.push(t3 - t2);
    tv.push(t1 - t0);
    tr.push(t2 - t1);
  }
  drawn = r.stats.drawn;
  lods = r.stats.lod.join("/");
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const p95 = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
if (process.env.UNITS_PHASE) {
  const byPh = [0, 1, 2].map((ph) => tr.filter((_, i) => (i + 30) % 3 === ph));
  console.log(`renderer by frame phase (sim stepped before phase 0): ${byPh.map((a) => avg(a).toFixed(2)).join(' / ')} ms; frames over 8 ms: ${tr.filter((x) => x > 8).length} of ${tr.length}`);
}
console.log(`${w.s.ants.length} ants (${list.length} viewed, ${drawn} drawn — lod0/lod1/impostor ${lods}, view ${VIEW}): views ${avg(tv).toFixed(2)} ms (p95 ${p95(tv).toFixed(2)}), ant renderer ${avg(tr).toFixed(2)} ms (p95 ${p95(tr).toFixed(2)}), creatures ${avg(tc).toFixed(2)} ms (${crs.stats.drawn} drawn of ${w.s.creatures.length}) a frame`);

// (UNITS_SHAPES=1 node --allow-natives-syntax …: how many hidden classes the renderer's per-ant objects have)
if (process.env.UNITS_SHAPES) {
  const same = new Function('a', 'b', 'return %HaveSameMap(a, b)') as (a: object, b: object) => boolean;
  const count = (objs: object[]): number => {
    const reps: object[] = [];
    for (const o of objs) if (!reps.some((r) => same(r, o))) reps.push(o);
    return reps.length;
  };
  const anim = [...(r as unknown as { anim: Map<number, object> }).anim.values()];
  const m2 = anim.map((s) => (s as { m2?: object }).m2).filter((x): x is object => !!x);
  console.log(`hidden classes: anim states ${count(anim)} (of ${anim.length}), motion states ${count(m2)}, views ${count(views)} (of ${views.length})`);
}
