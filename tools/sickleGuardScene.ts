/**
 * Scene for tools/sickle-guard.ts and tests/sickle.ts. The Sickle-Jaw guard line (user notes 2026-10-25: the line should follow the trail the workers really walk, be
 * wide enough that they stay inside it, and spare soldiers should go to that trail): a colony works a leaf-litter
 * patch far from its nest; prints where the guards stand (spread along the route, none piled up at the entrance)
 * and how much of the workers' walking happens inside the guarded corridor.
 */
import { EventBus } from '../src/core/events';
import { createWorld, placeLitter } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { assignGroup, placeMarker, markerRadius } from '../src/sim/markers';
import { CASTES } from '../src/sim/species';
import { SICKLE } from '../src/sim/balance';
import { sickleTrail } from '../src/sim/termites';
import { Rng } from '../src/core/rng';


export function guardScene(nWorkers: number, nSoldiers: number, sd: number, seconds = 90) {
  const w: World = createWorld({ seed: sd, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'rhynchotermes', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  const c = w.colony(0)!;
  const e = c.entrances[0];
  // a patch 140 mm out, on open ground
  let mx = e.sx + 140;
  let my = e.sy;
  for (let k = 0; k < 24; k++) {
    const ang = (k / 24) * Math.PI * 2;
    const x = e.sx + Math.cos(ang) * 140;
    const y = e.sy + Math.sin(ang) * 140;
    if (x > 40 && y > 40 && x < 660 && y < 660 && w.walkable(SURFACE, x, y)) {
      mx = x;
      my = y;
      break;
    }
  }
  placeLitter(w, new Rng(1), mx, my);
  for (const f of w.s.food) if (f.from === 'litter' && Math.hypot(f.x - mx, f.y - my) < 1) f.amount = f.max = 1e4;
  placeMarker(w, c, 0, SURFACE, mx, my);
  const chamber = c.tiles.find((t) => t.type === 'queen')!;
  const spawn = (caste: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = makeAnt(w, 0, caste, SURFACE, e.sx + Math.cos(i * 2.4) * (6 + i * 0.5), e.sy + Math.sin(i * 2.4) * (6 + i * 0.5), 0);
      a.tile = chamber.q;
      a.task = 'marker';
      a.marker = 0;
    }
  };
  spawn('rhy_worker', nWorkers);
  spawn('rhy_soldier', nSoldiers);
  assignGroup(w, c, chamber.group, 0);
  w.reindex();
  const L = CASTES.rhy_soldier.length;
  const half = SICKLE.escort.halfWidthBodyLengths * L;
  let inside = 0;
  let walking = 0;
  const radius = markerRadius(w, c, 0);
  for (let t = 0; t < 20 * seconds; t++) {
    w.step(0.05);
    w.events.drain();
    if (t < 20 * 30 || t % 10) continue;
    const tr = sickleTrail(w, c, 0);
    for (const a of w.s.ants) {
      if (a.colony !== 0 || a.caste !== 'rhy_worker' || a.space !== SURFACE || a.state === AS.Dead || a.v < 1) continue;
      // on the way: away from the work area and the entrance
      if (Math.hypot(a.x - mx, a.y - my) < radius || Math.hypot(a.x - e.sx, a.y - e.sy) < 12) continue;
      walking++;
      if (distToTrail(tr.pts, a.x, a.y) < half) inside++;
    }
  }
  const tr = sickleTrail(w, c, 0);
  const total = tr.cum[tr.cum.length - 1];
  const guards = w.s.ants.filter((a) => a.colony === 0 && a.caste === 'rhy_soldier' && a.state === AS.Rally);
  const arcs = guards.map((g) => arcOf(tr.pts, tr.cum, g.x, g.y)).sort((a, b) => a - b);
  const gaps = arcs.slice(1).map((v, i) => v - arcs[i]);
  return {
    trail: total,
    straight: Math.hypot(mx - e.sx, my - e.sy),
    guards: guards.length,
    gatherers: w.s.ants.filter((a) => a.colony === 0 && a.caste === 'rhy_soldier' && a.state !== AS.Rally && a.state !== AS.Dead).length,
    atEntrance: guards.filter((g) => Math.hypot(g.x - e.sx, g.y - e.sy) < 15).length,
    arcFrom: arcs[0] ?? 0,
    arcTo: arcs[arcs.length - 1] ?? 0,
    maxGap: gaps.length ? Math.max(...gaps) : 0,
    sideDist: guards.map((g) => distToTrail(tr.pts, g.x, g.y)),
    insideFrac: inside / Math.max(1, walking),
  };
}

function distToTrail(p: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) best = Math.min(best, segDist(p[i], p[i + 1], p[i + 2], p[i + 3], x, y));
  return best;
}
function segDist(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}
function arcOf(p: number[], cum: number[], x: number, y: number): number {
  let best = Infinity;
  let arc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const d = segDist(p[i], p[i + 1], p[i + 2], p[i + 3], x, y);
    if (d < best) {
      best = d;
      arc = cum[i / 2];
    }
  }
  return arc;
}

