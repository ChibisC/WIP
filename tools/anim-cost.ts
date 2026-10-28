/**
 * Animation pass: the CPU cost of the per-ant motion controller (render-only), for a stress-sized crowd.
 *
 *   npx vite-node tools/anim-cost.ts -- [ants=1040] [frames=600]
 *
 * The sandbox's software GPU can't time frames at 1000+ ants (one frame takes several seconds), so this measures
 * what the pass adds on the CPU each frame: `stepMotion` for every ant (walking, turning, fighting, idling,
 * a few dead or flung), at 60 fps. The vertex-shader foot solve runs on the GPU and needs a real device to time.
 */
import { performance } from 'node:perf_hooks';
import { buildAnt } from '../src/render/ants/antGeometry';
import { MORPHS } from '../src/render/ants/morphs';
import { newMotion, newMotionOut, stepMotion } from '../src/render/ants/antMotion';
import { blankView } from '../src/game/antViews';

const N = Number(process.argv[2] || 1040);
const F = Number(process.argv[3] || 600);
const rig = buildAnt(MORPHS.fire_minor, 1, 3).rig;
const dt = 1 / 60;
const ants = Array.from({ length: N }, (_, i) => {
  const v = blankView();
  v.id = i + 1;
  v.morph = 'fire_minor';
  v.hp = 40;
  return { v, m: newMotion(i + 1), s: { phase: 0, amp: 0, pose: 0, poseW: 0, pph: 0, wave: 0, death: 0 }, out: newMotionOut(), x: (i % 40) * 4, y: Math.floor(i / 40) * 4, h: (i * 2.4) % 6.28, lx: 0, ly: 0 };
});
// a mix like a big fight: 55 % walking (some turning), 25 % fighting, 15 % idle, 5 % dead or thrown
const kind = (i: number) => (i % 20 < 11 ? 'walk' : i % 20 < 16 ? 'fight' : i % 20 < 19 ? 'idle' : 'down');
function frame(f: number): void {
  for (let i = 0; i < N; i++) {
    const a = ants[i];
    const k = kind(i);
    a.lx = a.x;
    a.ly = a.y;
    if (k === 'walk') {
      a.h += (i % 3 === 0 ? 1.2 : 0) * dt;
      a.x += Math.cos(a.h) * 15 * dt;
      a.y += Math.sin(a.h) * 15 * dt;
    }
    a.v.heading = a.h;
    if (k === 'fight') {
      a.v.atk = ((f * dt) / 0.8 + i * 0.13) % 1;
      a.v.atkVar = i % 3;
      a.v.atkGap = 0.8;
      if (f % 48 === i % 48) a.v.hp = (a.v.hp ?? 40) - 1;
    }
    if (k === 'down') {
      if (i % 2) a.v.dead = f > 30;
      else {
        a.v.flung = (f % 120) < 40;
        a.v.lift = a.v.flung ? 5 : 0;
      }
    }
    stepMotion(a.s, a.m, a.v, rig, { x: a.x, y: a.y, h: a.h, lastX: a.lx, lastY: a.ly, dt, scale: 1, mounted: false, mountSpeed: 0, fighting: k === 'fight' }, a.out);
  }
}
for (let f = 0; f < 60; f++) frame(f); // warm up
const times: number[] = [];
for (let f = 60; f < 60 + F; f++) {
  const t0 = performance.now();
  frame(f);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const avg = times.reduce((s, t) => s + t, 0) / times.length;
const p95 = times[Math.floor(times.length * 0.95)];
console.log(JSON.stringify({ ants: N, frames: F, msPerFrameAvg: +avg.toFixed(3), msPerFrameP95: +p95.toFixed(3), usPerAnt: +((avg * 1000) / N).toFixed(2), shareOf60fpsBudget: +(avg / 16.67).toFixed(3) }));
