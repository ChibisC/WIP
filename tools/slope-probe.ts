/**
 * Layered ground (user 2026-11-02 12:08: "because of slopes some ant AI is failing to properly pathfind their way up or
 * down a slope"): scenes on testTerrace where ants must go up or down a bank — a fight across the terrace's bank, a
 * fight across the hollow's rim, a walk to a point just over the bank (straight steering), going home from below the
 * terrace — and how many end pressed against a bank (within 8 mm of a cliff, not moving for 4 s).
 *   npx vite-node tools/slope-probe.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { placeMarker } from '../src/sim/markers';
import { steerTo, goHome } from '../src/sim/movement';
import type { World } from '../src/sim/world';

function world(): World {
  const w = createWorld({ seed: 3, style: 'meadow', width: 480, depth: 480, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], map: 'testTerrace', aphids: 0, plants: 0, settings: { creatures: 0 } } as never, new EventBus());
  w.s.settings.foodRespawn = 0;
  return w;
}
function nearCliff(w: World, x: number, y: number, r = 8): boolean {
  for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) if (w.terrain.layers && w.terrain.isBlocked(x + dx, y + dy) && w.terrain.levelAt(x + dx, y + dy) !== undefined && cliffAt(w, x + dx, y + dy)) return true;
  return false;
}
function cliffAt(w: World, x: number, y: number): boolean {
  const T = w.terrain;
  const i = Math.min(T.nx - 1, Math.max(0, Math.round(x / T.res)));
  const j = Math.min(T.ny - 1, Math.max(0, Math.round(y / T.res)));
  return !!T.layers!.cliff[j * T.nx + i];
}
type Track = Map<number, { x: number; y: number; t: number }>;
function stuck(w: World, ids: number[], tr: Track, t: number): number {
  let n = 0;
  for (const id of ids) {
    const a = w.antById.get(id);
    if (!a || a.state === AS.Dead) continue;
    const p = tr.get(id);
    if (!p || Math.hypot(a.x - p.x, a.y - p.y) > 3) tr.set(id, { x: a.x, y: a.y, t });
    else if (t - p.t >= 80 && nearCliff(w, a.x, a.y)) {
      // (only an ant held up by the bank: its foe, or where it is going, lies over it — not one standing in a fight)
      const o = a.tgt ? w.antById.get(a.tgt) : undefined;
      const c = w.colony(a.colony)!;
      const m = a.marker >= 0 ? c.markers[a.marker] : undefined;
      const over = (o && w.terrain.crossesCliff(a.x, a.y, o.x, o.y)) || (!o && m && w.terrain.crossesCliff(a.x, a.y, m.x, m.y));
      if (over) n++;
    }
  }
  return n;
}

// 1. a fight across the terrace bank: 10 workers below, 10 above, each side's marker on the other side
function fight(label: string, ax: number, ay: number, bx: number, by: number): void {
  const w = world();
  const ids: number[][] = [[], []];
  for (const ci of [0, 1]) {
    const c = w.colony(ci)!;
    const [x, y] = ci === 0 ? [ax, ay] : [bx, by];
    const [ox, oy] = ci === 0 ? [bx, by] : [ax, ay];
    placeMarker(w, c, 0, SURFACE, ox, oy);
    for (let i = 0; i < 10; i++) {
      const a = makeAnt(w, c.id, 'lasius_worker', SURFACE, x + (i % 5) * 6 - 12, y + Math.floor(i / 5) * 6, 0);
      a.task = 'marker';
      a.marker = 0;
      ids[ci].push(a.id);
    }
  }
  w.reindex();
  const tr: Track = new Map();
  let maxStuck = 0;
  let firstKill = -1;
  for (let t = 0; t < 20 * 60; t++) {
    w.step(0.05);
    w.events.drain();
    for (const l of ids) for (const id of l) { const a = w.antById.get(id); if (a && a.state !== AS.Dead) { a.task = 'marker'; a.marker = 0; } }
    if (t % 20 === 0) maxStuck = Math.max(maxStuck, stuck(w, [...ids[0], ...ids[1]], tr, t));
    const dead = [...ids[0], ...ids[1]].filter((id) => !w.antById.get(id) || w.antById.get(id)!.state === AS.Dead).length;
    if (dead && firstKill < 0) firstKill = t / 20;
  }
  const alive = ids.map((l) => l.filter((id) => w.antById.get(id) && w.antById.get(id)!.state !== AS.Dead).length);
  console.log(`${label.padEnd(34)} alive ${alive[0]} v ${alive[1]}; first death ${firstKill < 0 ? 'none' : firstKill.toFixed(0) + ' s'}; most pressed on a bank at once ${maxStuck}`);
}

// 2. straight steering to points just over a bank (what combat chases and the last stretch home use)
function steer(label: string, sx: number, sy: number, tx: number, ty: number): void {
  const w = world();
  const a = makeAnt(w, 0, 'lasius_worker', SURFACE, sx, sy, 0);
  w.reindex();
  let t = 0;
  for (; t < 20 * 60; t++) {
    a.task = 'idle';
    steerTo(w, a, tx, ty, 0.05);
    if (Math.hypot(a.x - tx, a.y - ty) < 4) break;
  }
  console.log(`${label.padEnd(34)} ${t < 1200 ? 'there in ' + (t / 20).toFixed(1) + ' s' : 'NOT there in 60 s (' + Math.hypot(a.x - tx, a.y - ty).toFixed(0) + ' mm short)'}`);
}

fight('fight across the terrace bank', 250, 240, 250, 165);
fight('fight across the hollow rim', 300, 300, 380, 380);
steer('steer up over the bank', 250, 235, 250, 175);
steer('steer down over the bank', 250, 175, 250, 235);
steer('steer down into the hollow', 380, 300, 380, 370);
steer('steer up out of the hollow', 380, 370, 380, 300);
{
  // 3. home from just below the terrace (colony 1's anthill is up on it)
  const w = world();
  const c = w.colony(1)!;
  const e = c.entrances[0];
  const a = makeAnt(w, 1, 'lasius_worker', SURFACE, e.sx, 232, 0);
  w.reindex();
  let t = 0;
  for (; t < 20 * 90 && a.space === SURFACE; t++) goHome(w, a, 0.05);
  console.log(`${'home to the terrace from below'.padEnd(34)} ${a.space !== SURFACE ? 'home in ' + (t / 20).toFixed(1) + ' s' : 'NOT home in 90 s'}`);
}
{
  // 4. a hunting creature below the terrace, its prey up on it
  const w = world();
  const { spawnCreature } = await import('../src/sim/creatures/creatureAI');
  const cr = spawnCreature(w, 'groundBeetle', SURFACE, 250, 232);
  const a = makeAnt(w, 1, 'lasius_worker', SURFACE, 250, 182, 0);
  w.reindex();
  let t = 0;
  let best = Infinity;
  for (; t < 20 * 60; t++) {
    w.step(0.05);
    w.events.drain();
    a.x = 250;
    a.y = 182;
    best = Math.min(best, Math.hypot(cr.x - a.x, cr.y - a.y));
    if (a.state === AS.Dead || best < 12) break;
  }
  console.log(`${'beetle hunting up the bank'.padEnd(34)} ${best < 12 || a.state === AS.Dead ? 'reached its prey in ' + (t / 20).toFixed(1) + ' s' : 'NOT in 60 s (closest ' + best.toFixed(0) + ' mm)'}`);
}
