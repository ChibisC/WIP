import { World } from './world';
import { AS, Ant, Colony, MARKER_COUNT, SURFACE, nestSpace, snapping } from './types';
import { groupById, groupCounts, raisesAnts } from './tiles';
import { sq } from './dmath';

/**
 * The five pheromone markers (I–V). Every nest group is assigned to the home
 * column (−1) or to one marker; ants of groups whose marker is placed go out
 * to it as a swarm, the rest stay home.
 */

export const MARKER_NAMES = ['I', 'II', 'III', 'IV', 'V'];
/** Marker colours: I gold, II green, III teal, IV purple, V red. */
export const MARKER_COLORS = ['#e8b84a', '#7cc45a', '#4ac0b0', '#a07ae0', '#e0584a'];

/** Area (radius, mm) ants of a marker work in. */
export function markerRadius(w: World, c: Colony, i: number): number {
  const m = c.markers[i];
  if (m.space === SURFACE) return 26;
  const g = w.nestOf(m.space) ?? w.nest(c.id);
  return g ? g.R * 2.4 : 14;
}

/** How close (mm) to a surface entrance a marker must be dropped to go down it. */
export const ENTRANCE_SNAP = 12;

/**
 * The underground area whose surface entrance is at (x, y), if any, other
 * than the colony's own nest: a marker dropped there goes down into the area
 * and sits at the top of that entrance's ramp (DESIGN 3.9 / 3.12).
 */
export function entranceAt(w: World, c: Colony, x: number, y: number): { space: number; x: number; y: number } | null {
  let best: { space: number; x: number; y: number } | null = null;
  let bd = ENTRANCE_SNAP * ENTRANCE_SNAP;
  for (const space of w.undergroundSpaces()) {
    if (space === nestSpace(c.id)) continue;
    const g = w.nestOf(space);
    if (!g) continue;
    for (const e of w.entrancesOf(space)) {
      const d2 = sq(e.sx - x) + sq(e.sy - y);
      if (d2 >= bd) continue;
      bd = d2;
      // a little way down the ramp, on its floor
      const p = g.hexCenter(e.q);
      best = { space, x: p.x, y: p.y };
    }
  }
  return best;
}

/**
 * The nearest walkable surface point to (x, y): the point itself when walkable, else the first
 * walkable sample on square rings of the terrain grid round it (fixed order, no random numbers),
 * up to 240 mm away; null when there is none.
 */
export function nearestWalkable(w: World, x: number, y: number): { x: number; y: number } | null {
  const t = w.terrain;
  if (w.walkable(SURFACE, x, y)) return { x, y };
  const r = t.res;
  const ci = Math.round(x / r);
  const cj = Math.round(y / r);
  const maxK = Math.ceil(240 / r);
  for (let k = 1; k <= maxK; k++) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (let dj = -k; dj <= k; dj++)
      for (let di = -k; di <= k; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== k) continue;
        const px = (ci + di) * r;
        const py = (cj + dj) * r;
        if (!w.walkable(SURFACE, px, py)) continue;
        const d = sq(px - x) + sq(py - y);
        if (d < bd) {
          bd = d;
          best = { x: px, y: py };
        }
      }
    if (best) return best;
  }
  return null;
}

export function placeMarker(w: World, c: Colony, i: number, space: number, x: number, y: number): void {
  if (i < 0 || i >= MARKER_COUNT) return;
  if (space === SURFACE) {
    const ent = entranceAt(w, c, x, y);
    if (ent) {
      space = ent.space;
      x = ent.x;
      y = ent.y;
    } else if (w.terrain.layout) {
      // on an authored map a marker dropped in water or on a wall moves to the nearest dry ground
      const p = nearestWalkable(w, x, y);
      if (p) {
        x = p.x;
        y = p.y;
      }
    }
  }
  const m = c.markers[i];
  // a marker put down afresh (or in another area) finds its front again (guardLine.ts)
  if (!m.placed || m.space !== space) m.face = undefined;
  m.placed = true;
  m.space = space;
  m.x = x;
  m.y = y;
  c.recall = false;
  applyGroupOrders(w, c);
}

export type MarkerOrder = 'noAttack' | 'noGather' | 'noClimb';
export const MARKER_ORDERS: MarkerOrder[] = ['noAttack', 'noGather', 'noClimb'];

/** Set one of a marker's orders, or the Home column's (i = −1) (command `markerOrder`). */
export function setMarkerOrder(c: Colony, i: number, order: MarkerOrder, on: boolean): void {
  const m = i < 0 ? (c.homeOrders ??= {}) : c.markers[i];
  if (on) m[order] = true;
  else delete m[order];
}

/** Is that order on for marker i (−1: the Home column)? */
export function orderOn(c: Colony, i: number, order: MarkerOrder): boolean {
  return !!(i < 0 ? c.homeOrders?.[order] : c.markers[i]?.[order]);
}

/**
 * Is this ant under that order? An ant of a marker's groups while it is out on the marker's task; an ant of the
 * Home column (nest jobs, chores, defence) always.
 */
export function underOrder(c: Colony, a: Ant, order: MarkerOrder): boolean {
  if (a.marker < 0) return !!c.homeOrders?.[order] && a.id !== c.queen && a.id !== c.king;
  return a.task === 'marker' && !!c.markers[a.marker]?.[order];
}

/** Lift a marker: its ants return to their tiles; the groups stay in that column. */
export function removeMarker(w: World, c: Colony, i: number): void {
  if (i < 0 || i >= MARKER_COUNT) return;
  c.markers[i].placed = false;
  applyGroupOrders(w, c);
}

/** Move a nest group to a column (−1 home, 0..4 markers). Its ants respond at once. */
export function assignGroup(w: World, c: Colony, groupId: number, marker: number): boolean {
  const g = groupById(c, groupId);
  if (!g || !raisesAnts(g)) return false;
  if (marker < -1 || marker >= MARKER_COUNT) return false;
  g.marker = marker;
  if (marker >= 0) c.recall = false;
  applyGroupOrders(w, c);
  return true;
}

/** Recall: every group back to the home column. */
export function recallAll(w: World, c: Colony): void {
  for (const g of c.groups) g.marker = -1;
  c.recall = true;
  applyGroupOrders(w, c);
  if (c.player) w.events.emit({ t: 'message', text: 'All ants recalled to defend the nest.', kind: 'warn', colony: c.id });
}

/** Ants currently out at a marker / ants in groups assigned to it. */
export function markerCounts(w: World, c: Colony, i: number): { current: number; max: number } {
  let current = 0;
  let max = 0;
  for (const g of c.groups) {
    if (g.marker !== i || !raisesAnts(g)) continue;
    const n = groupCounts(w, c, g.id);
    current += n.living;
    max += n.max;
  }
  return { current, max };
}

/** Home column totals (ants in groups not assigned to any marker). */
export function homeCounts(w: World, c: Colony): { current: number; max: number } {
  let current = 0;
  let max = 0;
  for (const g of c.groups) {
    if (g.marker !== -1 || !raisesAnts(g)) continue;
    const n = groupCounts(w, c, g.id);
    current += n.living;
    max += n.max;
  }
  return { current, max };
}

/** Push group assignments onto the ants: marker index + task. */
export function applyGroupOrders(w: World, c: Colony): void {
  const groupOfTile = new Map<number, number>();
  for (const t of c.tiles) groupOfTile.set(t.q, t.group);
  const markerOfGroup = new Map<number, number>();
  for (const g of c.groups) markerOfGroup.set(g.id, g.marker);
  for (const a of w.s.ants) {
    if (a.colony !== c.id || a.state === AS.Dead || a.id === c.queen) continue;
    const gid = a.tile >= 0 ? groupOfTile.get(a.tile) : undefined;
    const mi = gid !== undefined ? (markerOfGroup.get(gid) ?? -1) : -1;
    const out = mi >= 0 && c.markers[mi].placed ? mi : -1;
    if (out === a.marker) continue;
    a.marker = out;
    if (out >= 0) {
      a.task = 'marker';
      a.taskT = 0;
      a.tgt = 0;
      a.tk = 0;
      if (a.state !== AS.Grapple && a.state !== AS.Attack && a.state !== AS.Spray && a.state !== AS.Flung && !snapping(a.state)) {
        a.state = AS.Idle;
        a.st = 0;
      }
    } else if (a.task === 'marker') {
      a.task = 'idle';
      a.taskT = 0;
    }
  }
}
