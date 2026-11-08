/**
 * Client-side visuals (claude/performance/02-spec-responsiveness-client-visuals.md §3; CHANGE_PLAN §29.2):
 *  - the views' loose view test (render/viewCull.ts) keeps ants near the view and in the air, leaves out the rest;
 *  - an ant left out for a while catches up in one step when it comes back (antRenderer.ts `catchUp`): its gait keeps
 *    its pace, its body takes its heading, a death that happened meanwhile is over — and an ant that never left is
 *    animated exactly as before;
 *  - with the test, the renderer's time falls with what is on screen (zoomed in: a tenth);
 *  - the combat particles' closed form (played in the shader from t − t0) follows the paths the old per-frame stepping
 *    drew.
 *
 *   npx vite-node tests/clientVisuals.ts
 */
import * as THREE from 'three';
import { AntRenderer, AntSpaceAdapter, AntView } from '../src/render/ants/antRenderer';
import { blankView } from '../src/game/antViews';
import { ViewCull, CULL_MARGIN } from '../src/render/viewCull';
import { AS, Ant } from '../src/sim/types';
import { landTime, particleAt } from '../src/render/game/combatFx';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const adapter: AntSpaceAdapter = {
  toWorld: (x, y, out) => out.set(x, 0, y),
  normal: (_x, _y, out) => out.set(0, 1, 0),
  forward: (h, out) => out.set(Math.cos(h), 0, Math.sin(h)),
};
const pos = (x: number, y: number, _l: number, out: THREE.Vector3) => out.set(x, 0, y);

function renderer(morphs: string[]): AntRenderer {
  const r = new AntRenderer({} as THREE.WebGLRenderer, 'test');
  // (no WebGL here: the far impostors are stubbed)
  const imp = (r as unknown as { impostorMats: Map<string, THREE.Material> }).impostorMats;
  for (const k of morphs) imp.set(k, new THREE.MeshStandardMaterial());
  return r;
}
type AnimState = { amp: number; phase: number; m2?: { vf: number; hb: number; deadT: number } };
const animOf = (r: AntRenderer, id: number) => (r as unknown as { anim: Map<number, AnimState> }).anim.get(id)!;

// a camera over (0, 0) looking down, seeing about ±60 mm
const cam = new THREE.PerspectiveCamera(50, 1, 1, 5000);
cam.position.set(0, 130, 0.01);
cam.lookAt(0, 0, 0);
cam.updateMatrixWorld();
cam.updateProjectionMatrix();

// ---- the loose test
{
  const c = new ViewCull();
  c.begin(cam);
  const ant = (x: number, o: Partial<Ant> = {}) => ({ x, y: 0, state: AS.Idle, fz: 0, ...o }) as Ant;
  check('view test: an ant in view is kept', c.keeps(ant(10), pos));
  check(`view test: one just outside (within ${CULL_MARGIN} mm) is kept`, c.keeps(ant(60 + CULL_MARGIN * 0.6), pos));
  check('view test: one well outside is left out', !c.keeps(ant(400), pos) && c.left === 1);
  check('view test: ants thrown through the air or riding a creature are always kept', c.keeps(ant(400, { state: AS.Flung }), pos) && c.keeps(ant(400, { rideId: 3 }), pos) && c.keeps(ant(400, { fz: 2 }), pos));
}

// ---- catching up
{
  const morph = 'lasius_worker';
  const walk = (v: AntView, t: number) => {
    // straight along +x at 16 mm/s (a worker's pace), 20 Hz ticks
    const tick = Math.floor(t * 20);
    v.px = (tick - 1) * 0.8 - 40;
    v.x = tick * 0.8 - 40;
    v.py = v.y = 0;
    v.heading = v.pheading = 0;
    return (t * 20) % 1;
  };
  const mk = (id: number) => {
    const v = blankView();
    v.id = id;
    v.morph = morph;
    return v;
  };
  // A: drawn every frame; B: the same walk, left out of the views for 2 s in the middle
  const rA = renderer([morph]);
  const rB = renderer([morph]);
  const a = mk(1);
  const b = mk(1);
  let t = 0;
  let before = { vf: 0, amp: 0 };
  for (let f = 0; f < 360; f++) {
    t += 1 / 60;
    const al = walk(a, t);
    walk(b, t);
    rA.update([a], al, 1 / 60, cam, adapter, 760);
    const out = f >= 120 && f < 240;
    rB.update(out ? [] : [b], al, 1 / 60, cam, adapter, 760);
    if (f === 119) before = { vf: animOf(rB, 1).m2!.vf, amp: animOf(rB, 1).amp };
    if (f === 240) {
      const s = animOf(rB, 1);
      check('catch-up: the gait keeps its pace (speed and stride amplitude as before it left)', Math.abs(s.m2!.vf - before.vf) < before.vf * 0.15 && Math.abs(s.amp - before.amp) < 0.15, `speed ${before.vf.toFixed(1)} → ${s.m2!.vf.toFixed(1)} mm/s, amplitude ${before.amp.toFixed(2)} → ${s.amp.toFixed(2)}`);
    }
  }
  const sa = animOf(rA, 1);
  const sb = animOf(rB, 1);
  check('catch-up: two seconds later it walks as the one that never left', Math.abs(sa.m2!.vf - sb.m2!.vf) < 0.5 && Math.abs(sa.amp - sb.amp) < 0.05 && Math.abs(sa.m2!.hb - sb.m2!.hb) < 1e-3, `speed ${sa.m2!.vf.toFixed(2)} / ${sb.m2!.vf.toFixed(2)}, amplitude ${sa.amp.toFixed(3)} / ${sb.amp.toFixed(3)}`);

  // a death off screen: it comes back dead and done (its death timer ran the time it missed, up to a second)
  const rC = renderer([morph]);
  const c = mk(2);
  c.x = c.px = 0;
  c.y = c.py = 0;
  for (let f = 0; f < 30; f++) rC.update([c], 1, 1 / 60, cam, adapter, 760);
  c.dead = true;
  rC.update([c], 1, 1 / 60, cam, adapter, 760);
  for (let f = 0; f < 90; f++) rC.update([], 1, 1 / 60, cam, adapter, 760);
  rC.update([c], 1, 1 / 60, cam, adapter, 760);
  const dT = animOf(rC, 2).m2!.deadT;
  // (one step runs at most a second: a death's fall is shorter)
  check('catch-up: a death that happened off screen is over when it comes back', dT >= 1, `death timer ${dT.toFixed(2)} s after 1.5 s away`);
}

// ---- the renderer's time with the test
{
  const morphs = ['lasius_worker', 'formica_worker', 'fire_major', 'lasius_soldier'];
  const N = 600;
  const timeFor = (span: number, culled: boolean) => {
    const r = renderer(morphs);
    const views: AntView[] = [];
    for (let i = 0; i < N; i++) {
      const v = blankView();
      v.id = i + 1;
      v.morph = morphs[i % morphs.length];
      v.x = v.px = ((i * 37) % 600) - 300;
      v.y = v.py = ((i * 91) % 600) - 300;
      views.push(v);
    }
    const c2 = new THREE.PerspectiveCamera(50, 1, 1, 5000);
    c2.position.set(0, span / (2 * Math.tan(THREE.MathUtils.degToRad(25))), 0.01);
    c2.lookAt(0, 0, 0);
    c2.updateMatrixWorld();
    const cull = new ViewCull();
    let ms = 0;
    for (let f = 0; f < 240; f++) {
      for (const v of views) {
        v.px = v.x;
        v.x += 0.27;
      }
      const t0 = performance.now();
      let list = views;
      if (culled) {
        cull.begin(c2);
        list = views.filter((v) => cull.keeps({ x: v.x, y: v.y, state: 0, fz: 0 } as unknown as Ant, pos));
      }
      r.update(list, 0.5, 1 / 60, c2, adapter, 760);
      if (f >= 60) ms += performance.now() - t0;
    }
    return ms / 180;
  };
  const all = timeFor(120, false);
  const cut = timeFor(120, true);
  check('view test: zoomed in on a big crowd, the ants cost far less (under a third)', cut < all / 3, `${all.toFixed(2)} → ${cut.toFixed(2)} ms a frame for ${N} ants`);
}

// ---- closed-form particles (combatFx.ts): the same paths the old per-frame stepping drew
{
  /** the old CPU step at 60 frames a second (ground flat at 0.1) */
  const euler = (p: number[], v: number[], life: number, grav: number, drag: number, frames: number) => {
    const pos = p.slice();
    const vel = v.slice();
    let left = life;
    const dt = 1 / 60;
    const out: Array<[number, number, number] | null> = [];
    for (let f = 0; f < frames; f++) {
      if (left <= 0) {
        out.push(null);
        continue;
      }
      left -= dt;
      const dr = Math.max(0, 1 - drag * dt);
      vel[0] *= dr;
      vel[2] *= dr;
      vel[1] -= grav * dt;
      let x = pos[0] + vel[0] * dt;
      let h = pos[1] + vel[1] * dt;
      const y = pos[2] + vel[2] * dt;
      if (h < 0.1) {
        h = 0.1;
        vel[0] = vel[1] = vel[2] = 0;
        x = pos[0];
      }
      pos[0] = x;
      pos[1] = h;
      pos[2] = y;
      out.push(left > 0 ? [x, h, y] : null);
    }
    return out;
  };
  // a bite's fleck (ballistic), a hell ant's dust puff (drag, light gravity), an acid mist puff (rising)
  const kinds: Array<{ name: string; p: number[]; v: number[]; life: number; grav: number; drag: number }> = [
    { name: 'a bite fleck', p: [0, 0.7, 0], v: [9, 14, 4], life: 0.55, grav: 70, drag: 0 },
    { name: 'a dust puff', p: [0, 0.25, 0], v: [3, 2.5, -2], life: 0.6, grav: 5, drag: 2.5 },
    { name: 'an acid mist puff', p: [0, 1.1, 0], v: [-2, 1.6, 2], life: 0.9, grav: -2, drag: 3 },
  ];
  for (const k of kinds) {
    const old = euler(k.p, k.v, k.life, k.grav, k.drag, 70);
    const tl = landTime(k.v[1], k.grav, k.p[1] - 0.1);
    let worst = 0;
    let aliveDiff = 0;
    for (let f = 0; f < old.length; f++) {
      const now = particleAt(k.p, k.v, k.life, k.grav, k.drag, 0.1, tl, (f + 1) / 60);
      const o = old[f];
      if (!!now !== !!o) aliveDiff++;
      if (now && o) worst = Math.max(worst, Math.hypot(now[0] - o[0], now[1] - o[1], now[2] - o[2]));
    }
    check(`closed-form particles: ${k.name} follows the old path (within 0.3 mm, gone within a frame of it)`, worst < 0.3 && aliveDiff <= 1, `worst ${worst.toFixed(3)} mm`);
  }
}

if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
