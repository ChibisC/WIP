/**
 * The "dislocated neck" (user report 2026-10-25) on chain creatures (caterpillar, centipedes): runs real
 * fights, replays each creature's interpolated position and heading at 60 fps the way the renderer does,
 * lays the segments out with the old trail (past head positions, headings from the two nearest points)
 * and with the new follow-the-leader chain (render/creatures/chainTrail.ts), and reports how sharply the
 * neck (head segment against the next) and the worst joint bend.
 *
 *   npx vite-node tools/chain-check.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { openGround } from './spinScenes';
import { chainPoint, followChain, TRAIL_CAP, TRAIL_RELAX, TRAIL_STEP } from '../src/render/creatures/chainTrail';

const wrap = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));

// ---- the old trail, as it was in creatureRenderer.ts / builders.ts
function oldRecord(t: Float32Array, n: number, hx: number, hz: number, step: number): number {
  if (n === 0) {
    t[0] = hx;
    t[1] = hz;
    return 1;
  }
  let dx = hx - t[0];
  let dz = hz - t[1];
  let d = Math.hypot(dx, dz);
  while (d >= step) {
    const nx = t[0] + (dx / d) * step;
    const nz = t[1] + (dz / d) * step;
    t.copyWithin(2, 0, (TRAIL_CAP - 1) * 2);
    t[0] = nx;
    t[1] = nz;
    n = Math.min(TRAIL_CAP, n + 1);
    dx = hx - nx;
    dz = hz - nz;
    d = Math.hypot(dx, dz);
  }
  return n;
}
function oldAlong(p: { h: number; hx: number; hz: number; trail: Float32Array; trailN: number; trailStep: number }, dist: number): { x: number; z: number; h: number } {
  const k = dist / p.trailStep;
  const i = Math.floor(k);
  const f = k - i;
  const n = p.trailN;
  const tx = (j: number) => (j <= 0 ? p.hx : p.trail[Math.min(j, n) * 2 - 2]);
  const tz = (j: number) => (j <= 0 ? p.hz : p.trail[Math.min(j, n) * 2 - 1]);
  if (n === 0 || i >= n) {
    const back = dist - n * p.trailStep;
    const bx = tx(n);
    const bz = tz(n);
    const hh = n > 0 ? Math.atan2(tz(n - 1) - bz, tx(n - 1) - bx) : p.h;
    return { x: bx - Math.cos(hh) * back, z: bz - Math.sin(hh) * back, h: n > 1 ? hh : p.h };
  }
  const ax = tx(i);
  const az = tz(i);
  const bx = tx(i + 1);
  const bz = tz(i + 1);
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, h: Math.hypot(ax - bx, az - bz) > 1e-3 ? Math.atan2(az - bz, ax - bx) : p.h };
}

interface Stat {
  frames: number;
  neckMax: number;
  neckOver45: number;
  headOffMax: number;
  bendMax: number;
  /** mean distance (× L) from the drawn body's middle to the sim body's centre */
  midOff: number;
}
const stat = (): Stat => ({ frames: 0, neckMax: 0, neckOver45: 0, headOffMax: 0, bendMax: 0, midOff: 0 });

function scene(kind: string, segs: number, caste: string, n: number, seconds = 30, seed = 7): { old: Stat; neu: Stat } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: caste.split('_')[0] as never, player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w, 160);
  const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e7;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = cr.scale * 0.6 + 8;
    const a = makeAnt(w, 0, caste, SURFACE, p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, ang + Math.PI);
    a.task = 'guard';
    a.alarm = 1;
    a.tgt = cr.id;
    a.tk = 4;
    a.state = AS.Attack;
  }
  w.reindex();
  const L = cr.scale;
  const step = L * TRAIL_STEP;
  const segL = L / segs;
  const oldT = new Float32Array(TRAIL_CAP * 2);
  const newT = new Float32Array(TRAIL_CAP * 2);
  let oldN = 0;
  let newN = 0;
  const old = stat();
  const neu = stat();
  const measure = (s: Stat, along: (d: number) => { x: number; z: number; h: number }, h: number) => {
    s.frames++;
    const hs: number[] = [];
    for (let i = 0; i < segs; i++) hs.push(along(i * segL).h);
    const neck = Math.abs(wrap(hs[0] - hs[1]));
    s.neckMax = Math.max(s.neckMax, neck);
    if (neck > Math.PI / 4) s.neckOver45++;
    s.headOffMax = Math.max(s.headOffMax, Math.abs(wrap(hs[0] - h)));
    for (let i = 0; i + 1 < segs; i++) s.bendMax = Math.max(s.bendMax, Math.abs(wrap(hs[i] - hs[i + 1])));
    const m = along(L * 0.5);
    s.midOff += Math.hypot(m.x - cx, m.z - cz) / L;
  };
  let cx = 0;
  let cz = 0;
  for (let t = 0; t < 20 * seconds; t++) {
    w.step(0.05);
    w.events.drain();
    if (cr.dead) break;
    for (const alpha of [1 / 3, 2 / 3, 1]) {
      const x = cr.px + (cr.x - cr.px) * alpha;
      const z = cr.py + (cr.y - cr.py) * alpha;
      const h = cr.ph + wrap(cr.h - cr.ph) * alpha;
      cx = x;
      cz = z;
      const hx = x + Math.cos(h) * L * 0.5;
      const hz = z + Math.sin(h) * L * 0.5;
      oldN = oldRecord(oldT, oldN, hx, hz, step);
      newN = followChain(newT, newN, hx, hz, h, step, 1 - Math.exp(-TRAIL_RELAX / 60));
      const po = { h, hx, hz, trail: oldT, trailN: oldN, trailStep: step };
      const pn = { h, hx, hz, trail: newT, trailN: newN, trailStep: step };
      measure(old, (d) => oldAlong(po, d), h);
      measure(neu, (d) => ({ ...chainPoint(pn, d) }), h);
    }
  }
  return { old, neu };
}

const deg = (r: number) => (r * 57.3).toFixed(0) + '°';
for (const [kind, segs, caste, n] of [
  ['lithobius', 16, 'formica_worker', 20],
  ['scolopendra', 22, 'formica_worker', 30],
  ['cutworm', 13, 'lasius_worker', 12],
  ['lithobius', 16, 'lasius_worker', 6],
] as Array<[string, number, string, number]>) {
  const r = scene(kind, segs, caste, n);
  for (const [name, s] of [
    ['old', r.old],
    ['new', r.neu],
  ] as Array<[string, Stat]>)
    console.log(
      `${kind.padEnd(12)} vs ${String(n).padStart(2)} ${caste.padEnd(15)} ${name}: neck worst ${deg(s.neckMax)}, over 45° in ${((100 * s.neckOver45) / Math.max(1, s.frames)).toFixed(1)} % of frames; head off the heading by up to ${deg(s.headOffMax)}; worst joint ${deg(s.bendMax)}; body middle ${((100 * s.midOff) / Math.max(1, s.frames)).toFixed(1)} % of L from the hitbox centre on average`,
    );
}
