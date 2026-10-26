import { dhypot } from './dmath';
import { Colony, SURFACE } from './types';
import { World } from './world';
import { homeField, nearestEntrance } from './movement';
import { BALANCE } from './balance';

/**
 * The route the workers walk between a surface marker and the nest: they go home along the colony's home flow
 * field and out along the marker's own field, which follow the same shortest path round puddles, rocks and logs.
 * Traced from the marker down the home field every `stepMm`, straight in for the last 30 mm. Used by the
 * Sickle-Jaw guard row (termites.ts) and the army ants' lanes and Soldier posts (eciton.ts).
 *
 * A derived cache: rebuilt from the marker position, the entrances and the terrain, which every client has, so a
 * restored world traces the same route.
 */
export interface Route {
  state: unknown;
  tick: number;
  mx: number;
  my: number;
  /** x, y pairs from the marker (index 0) to the nest entrance */
  pts: number[];
  /** arc length at each point (0 at the marker) */
  cum: number[];
}

const routes = new Map<number, Route>(); // det-ok: derived cache, rebuilt from SimState (marker, entrances, terrain)
const tdir = { x: 0, y: 0 }; // det-ok: scratch

/** The route for marker `mi` of colony `c`, refreshed when the marker moves and every `refreshSec`. */
export function markerRoute(w: World, c: Colony, mi: number, stepMm: number, refreshSec: number): Route {
  const m = c.markers[mi];
  const key = c.id * 16 + mi;
  let t = routes.get(key);
  if (t && t.state === w.s && w.s.tick - t.tick < refreshSec * BALANCE.tickHz && t.mx === m.x && t.my === m.y) return t;
  if (!t) routes.set(key, (t = { state: w.s, tick: 0, mx: 0, my: 0, pts: [], cum: [] }));
  t.state = w.s;
  t.tick = w.s.tick;
  t.mx = m.x;
  t.my = m.y;
  t.pts.length = 0;
  t.cum.length = 0;
  let x = m.x;
  let y = m.y;
  t.pts.push(x, y);
  t.cum.push(0);
  let len = 0;
  const e = m.space === SURFACE ? c.entrances[nearestEntrance(c, x, y)] : undefined;
  if (e) {
    const f = homeField(w, c);
    for (let i = 0; i < 400; i++) {
      const de = dhypot(e.sx - x, e.sy - y);
      let nx: number;
      let ny: number;
      if (de < 30 || !w.surfFlow.dir(f, x, y, tdir)) {
        nx = e.sx;
        ny = e.sy;
      } else {
        nx = x + tdir.x * stepMm;
        ny = y + tdir.y * stepMm;
      }
      len += dhypot(nx - x, ny - y);
      x = nx;
      y = ny;
      t.pts.push(x, y);
      t.cum.push(len);
      if (x === e.sx && y === e.sy) break;
    }
  }
  return t;
}

/** Total length of a route (mm). */
export const routeLength = (r: Route): number => r.cum[r.cum.length - 1];

/** The point at arc length s along the route and the route's unit direction there (toward the nest). */
export function routeAt(r: Route, s: number, out: { x: number; y: number; ux: number; uy: number }): void {
  const n = r.cum.length;
  if (n < 2) {
    out.x = r.pts[0];
    out.y = r.pts[1];
    out.ux = 1;
    out.uy = 0;
    return;
  }
  let i = 1;
  while (i < n - 1 && r.cum[i] < s) i++;
  const s0 = r.cum[i - 1];
  const seg = Math.max(1e-6, r.cum[i] - s0);
  const f = Math.min(1, Math.max(0, (s - s0) / seg));
  const ax = r.pts[i * 2 - 2];
  const ay = r.pts[i * 2 - 1];
  const bx = r.pts[i * 2];
  const by = r.pts[i * 2 + 1];
  out.ux = (bx - ax) / seg;
  out.uy = (by - ay) / seg;
  out.x = ax + (bx - ax) * f;
  out.y = ay + (by - ay) * f;
}

/** The nearest point of the route to (x, y): its arc length, distance, and the route direction there (toward the nest). */
export function routeNearest(r: Route, x: number, y: number, out: { s: number; d: number; x: number; y: number; ux: number; uy: number }): void {
  out.s = 0;
  out.d = Infinity;
  out.x = r.pts[0];
  out.y = r.pts[1];
  out.ux = 1;
  out.uy = 0;
  const n = r.cum.length;
  for (let i = 1; i < n; i++) {
    const ax = r.pts[i * 2 - 2];
    const ay = r.pts[i * 2 - 1];
    const bx = r.pts[i * 2];
    const by = r.pts[i * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = dhypot(x - px, y - py);
    if (d < out.d) {
      const l = Math.sqrt(l2) || 1;
      out.d = d;
      out.s = r.cum[i - 1] + (r.cum[i] - r.cum[i - 1]) * t;
      out.x = px;
      out.y = py;
      out.ux = dx / l;
      out.uy = dy / l;
    }
  }
}
