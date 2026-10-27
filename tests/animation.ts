/**
 * Animation pass (docs/realism/animation.md): headless checks of the pilot's motion controller and the planted
 * feet. The vertex shader's foot solve is mirrored on the CPU (antMotion.ts plantedFoot), so the feet can be
 * followed in world space through a scripted walk, a curve, a stop and a turn in place.
 *
 *   npx vite-node tests/animation.ts
 */
import { buildAnt } from '../src/render/ants/antGeometry';
import { MORPHS } from '../src/render/ants/morphs';
import { newMotion, newMotionOut, plantedFoot, stepMotion } from '../src/render/ants/antMotion';
import { blankView } from '../src/game/antViews';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}

const rig = buildAnt(MORPHS.fire_minor, 1, 3).rig;
const L = rig.length;
const TICK = 0.05;
const FPS = 60;

interface Seg {
  d: number;
  v?: number;
  turn?: number;
}
/** Sim positions at tick times along segments (as the sim moves an ant: straight runs, arcs, turns in place). */
function path(segs: Seg[]): (t: number) => { x: number; y: number; h: number } {
  const pts: Array<{ t: number; x: number; y: number; h: number }> = [{ t: 0, x: 0, y: 0, h: 0 }];
  let x = 0;
  let y = 0;
  let h = 0;
  let t = 0;
  for (const s of segs) {
    const n = Math.round(s.d / 0.001);
    for (let i = 0; i < n; i++) {
      h += (s.turn ?? 0) * 0.001;
      x += Math.cos(h) * (s.v ?? 0) * 0.001;
      y += Math.sin(h) * (s.v ?? 0) * 0.001;
      t += 0.001;
      pts.push({ t, x, y, h });
    }
  }
  return (tt) => pts[Math.min(pts.length - 1, Math.max(0, Math.round(tt / 0.001)))];
}

/** Run the controller through a path; for every foot, how far it drifts on the ground while planted. */
function drift(segs: Seg[], dur: number, from = 0.6): { max: number; mean: number; stances: number } {
  const p = path(segs);
  const v = blankView();
  v.id = 7;
  v.morph = 'fire_minor';
  v.hp = 10;
  const m = newMotion(7);
  const s = { phase: 0, amp: 0, pose: 0, poseW: 0, pph: 0, wave: 0, death: 0 };
  const out = newMotionOut();
  let last = p(0);
  let cur = p(0);
  let tick = 0;
  let lastX = 0;
  let lastY = 0;
  const plant: Array<{ x: number; z: number } | null> = Array(6).fill(null);
  let max = 0;
  let sum = 0;
  let n = 0;
  let stances = 0;
  const f = { x: 0, y: 0, z: 0 };
  for (let k = 0; k <= dur * FPS; k++) {
    const t = k / FPS;
    while ((tick + 1) * TICK <= t) {
      tick++;
      last = cur;
      cur = p(tick * TICK);
    }
    const a = (t - tick * TICK) / TICK;
    let dh = cur.h - last.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const x = last.x + (cur.x - last.x) * a;
    const y = last.y + (cur.y - last.y) * a;
    stepMotion(s, m, v, rig, { x, y, h: last.h + dh * a, lastX, lastY, dt: 1 / FPS, scale: 1, mounted: false, mountSpeed: 0, fighting: false }, out);
    lastX = x;
    lastY = y;
    const c = Math.cos(out.h);
    const sn = Math.sin(out.h);
    for (let li = 0; li < 6; li++) {
      const gB = li === 1 || li === 2 || li === 5;
      const ph = (((s.phase + (gB ? 0.5 : 0)) % 1) + 1) % 1;
      plantedFoot(rig, li, s.phase, s.amp, out.Dh, out.Ps, f);
      // object → world: x forward, z right; the heading turns +x toward +y(world z)
      const wx = x + f.x * c - f.z * sn;
      const wz = y + f.x * sn + f.z * c;
      const stance = ph > 0.04 && ph < (rig.gaitDuty ?? 0.55) - 0.04;
      if (!stance) {
        if (plant[li]) stances++;
        plant[li] = null;
        continue;
      }
      if (!plant[li]) plant[li] = { x: wx, z: wz };
      if (t < from) continue;
      const d = Math.hypot(wx - plant[li]!.x, wz - plant[li]!.z) / L;
      max = Math.max(max, d);
      sum += d;
      n++;
    }
  }
  return { max, mean: n ? sum / n : 0, stances };
}

{
  const r = drift([{ d: 3, v: 15 }], 3);
  check('planted feet: walking straight at the sim speed, a planted foot drifts < 3 % of the body length', r.max < 0.03 && r.stances > 20, `max ${(r.max * 100).toFixed(2)} %, mean ${(r.mean * 100).toFixed(2)} %, ${r.stances} stances`);
}
{
  const r = drift([{ d: 3, v: 6 }], 3);
  check('planted feet: walking slowly (6 mm/s), drift < 3 %', r.max < 0.03, `max ${(r.max * 100).toFixed(2)} %, mean ${(r.mean * 100).toFixed(2)} %`);
}
{
  const r = drift([{ d: 3, v: 12, turn: 1.4 }], 3);
  check('planted feet: walking a curve, drift < 5 %', r.max < 0.05, `max ${(r.max * 100).toFixed(2)} %, mean ${(r.mean * 100).toFixed(2)} %`);
}
{
  const r = drift([{ d: 0.3 }, { d: 2.5, turn: 2.4 }], 2.8);
  check('planted feet: turning in place steps round, drift < 6 %', r.max < 0.06 && r.stances > 6, `max ${(r.max * 100).toFixed(2)} %, mean ${(r.mean * 100).toFixed(2)} %, ${r.stances} stances`);
}
{
  // variety: a hundred ants never share a gait phase, stride or size exactly
  const ms = Array.from({ length: 100 }, (_, i) => newMotion(i + 1));
  const phases = new Set(ms.map((m) => m.seed.toFixed(3)));
  const strides = ms.map((m) => m.strideK);
  check('variety: a hundred ants get different gait phases and strides within ±10 %', phases.size > 90 && Math.min(...strides) >= 0.9 && Math.max(...strides) <= 1.1, `${phases.size} phases`);
}
{
  // idles: standing ants start idling, with more than one kind among a crowd, never in lockstep
  const kinds = new Set<number>();
  let starts: number[] = [];
  for (let i = 0; i < 40; i++) {
    const v = blankView();
    v.id = i + 1;
    v.morph = 'fire_minor';
    v.antennaActivity = 0.3;
    const m = newMotion(i + 1);
    const s = { phase: 0, amp: 0, pose: 0, poseW: 0, pph: 0, wave: 0, death: 0 };
    const out = newMotionOut();
    let first = -1;
    for (let k = 0; k < 8 * 60; k++) {
      stepMotion(s, m, v, rig, { x: 0, y: 0, h: 0, lastX: 0, lastY: 0, dt: 1 / 60, scale: 1, mounted: false, mountSpeed: 0, fighting: false }, out);
      if (m.idle >= 0) {
        kinds.add(m.idle);
        if (first < 0) first = k;
      }
    }
    starts.push(first);
  }
  starts = starts.filter((x) => x >= 0);
  check('idles: standing ants idle (several kinds) and start at different moments', kinds.size >= 4 && starts.length >= 36 && new Set(starts).size > 25, `${kinds.size} kinds, ${starts.length}/40 idled, ${new Set(starts).size} distinct start frames`);
}
{
  // a hit: the flinch, the flash, the brief hit-stop of the ant's own clocks
  const v = blankView();
  v.id = 3;
  v.morph = 'fire_minor';
  v.hp = 10;
  const m = newMotion(3);
  const s = { phase: 0, amp: 0, pose: 0, poseW: 0, pph: 0, wave: 0, death: 0 };
  const out = newMotionOut();
  const step = () => stepMotion(s, m, v, rig, { x: 0, y: 0, h: 0, lastX: 0, lastY: 0, dt: 1 / 60, scale: 1, mounted: false, mountSpeed: 0, fighting: true }, out);
  for (let k = 0; k < 10; k++) step();
  v.hp = 8;
  step();
  const flash0 = out.flash;
  const clock0 = out.clock;
  let moved = 0;
  for (let k = 0; k < 12; k++) {
    step();
    moved = Math.max(moved, Math.abs(out.fwd) + Math.abs(out.side) + Math.abs(out.yaw) * L);
  }
  check('hit reaction: a flash, a moment of hit-stop and a visible flinch', flash0 > 0.8 && clock0 === 0 && moved > L * 0.03, `flash ${flash0.toFixed(2)}, flinch ${(moved / L * 100).toFixed(1)} % L`);
}
{
  // death: the legs curl within about half a second, the body rolls over
  const v = blankView();
  v.id = 5;
  v.morph = 'fire_minor';
  const m = newMotion(5);
  const s = { phase: 0, amp: 0, pose: 0, poseW: 0, pph: 0, wave: 0, death: 0 };
  const out = newMotionOut();
  for (let k = 0; k < 10; k++) stepMotion(s, m, v, rig, { x: 0, y: 0, h: 0, lastX: 0, lastY: 0, dt: 1 / 60, scale: 1, mounted: false, mountSpeed: 0, fighting: false }, out);
  v.dead = true;
  let at = -1;
  for (let k = 0; k < 90; k++) {
    stepMotion(s, m, v, rig, { x: 0, y: 0, h: 0, lastX: 0, lastY: 0, dt: 1 / 60, scale: 1, mounted: false, mountSpeed: 0, fighting: false }, out);
    if (at < 0 && out.deathLeg > 0.9) at = k / 60;
  }
  check('death: legs curl in about half a second and the body rolls onto its side or back', at > 0.3 && at < 0.75 && Math.abs(out.deathRoll) > 1.3, `curled at ${at.toFixed(2)} s, roll ${out.deathRoll.toFixed(2)}`);
}
{
  // flung: it tumbles in the air; landing on its back or side it lies kicking a moment, then rights itself
  let upsideDown = 0;
  let kicked = 0;
  let righted = 0;
  let worst = 0;
  for (let id = 1; id <= 24; id++) {
    const v = blankView();
    v.id = id;
    v.morph = 'fire_minor';
    const m = newMotion(id);
    const s = { phase: 0, amp: 0, pose: 0, poseW: 0, pph: 0, wave: 0, death: 0 };
    const out = newMotionOut();
    const step = () => stepMotion(s, m, v, rig, { x: 0, y: 0, h: 0, lastX: 0, lastY: 0, dt: 1 / 60, scale: 1, mounted: false, mountSpeed: 0, fighting: false }, out);
    for (let k = 0; k < 5; k++) step();
    // airborne for 0.6 s (a 9 mm hop), then down
    v.flung = true;
    for (let k = 0; k < 36; k++) {
      v.lift = 9 * Math.sin((Math.PI * (k + 1)) / 37);
      step();
    }
    v.flung = false;
    v.lift = 0;
    step();
    const tilt = () => Math.abs(Math.sin((out.spinRoll + out.spinPitch) / 2)); // 0 upright … 1 on its back
    const onBack = tilt() > 0.7;
    if (onBack) upsideDown++;
    let kick = 0;
    for (let k = 0; k < 90; k++) {
      step();
      if (onBack && k < 20) kick = Math.max(kick, out.deathLeg);
    }
    if (onBack && kick > 0.3) kicked++;
    worst = Math.max(worst, tilt());
    if (tilt() < 0.05) righted++;
  }
  check('flung: tumbles, lies kicking a moment if it lands on its back, then rights itself within 1.5 s', upsideDown > 0 && kicked === upsideDown && righted === 24, `${upsideDown}/24 landed on their backs (all kicked: ${kicked}), ${righted}/24 upright after 1.5 s, worst tilt ${worst.toFixed(2)}`);
}
console.log(failed ? `\n${failed} animation test(s) FAILED` : '\nall animation tests passed');
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
