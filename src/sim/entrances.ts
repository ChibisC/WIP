import { World } from './world';
import { Colony, Entrance } from './types';
import { ENTRANCE } from './balance';
import { NestGrid, chainToward } from '../world/nestGrid';
import { SITE_RING } from '../world/surfaceLayout';
import { dhypot, sq } from './dmath';
import { nearestWalkable } from './markers';

/**
 * Nest entrances (claude/maps/02-spec-nest-entrances; DESIGN.md "Entrances").
 *
 * An entrance is one object with two ends: a hole on the surface and a short tunnel of nest hexes
 * (ENTRANCE.tunnelLen, top first) rising to it. Every nest starts with one main entrance. Each
 * nest also has up to ENTRANCE.maxExtra marked extra-entrance spots: undug tunnels the player
 * digs out with the ordinary Dig tool (an entrance dig: the lowest dig priority, up to 7
 * workers). Digging anywhere else never opens an entrance. A spot's surface end is the free
 * extra-entrance spot of the colony's map site that best matches its direction (all validated
 * dry and flat by the map validator); maps without sites fall back to a projected point moved to
 * the nearest walkable ground.
 *
 * Each entrance lets ENTRANCE.passPerS ants through per second (either way), so busy entrances
 * queue; extra entrances can be plugged with soil and opened again; a fallen colony's entrances
 * cave in. All of it is simulation state, changed only by commands and the fixed tick.
 */

export function makeEntrance(q: number, sx: number, sy: number, time: number): Entrance {
  return { q, sx, sy, shut: 0, work: 0, cr: ENTRANCE.burst, crT: time, fall: 0 };
}

/** Fill the fields older saves lack, in the order makeEntrance writes them (canonical snapshots). */
export function normalizeEntrance(e: Entrance, time: number): void {
  if (e.shut !== undefined && e.work !== undefined && e.cr !== undefined && e.crT !== undefined && e.fall !== undefined) return;
  const n = makeEntrance(e.q, e.sx, e.sy, time);
  n.shut = e.shut ?? 0;
  n.work = e.work ?? 0;
  n.cr = e.cr ?? n.cr;
  n.crT = e.crT ?? n.crT;
  n.fall = e.fall ?? 0;
  for (const k of Object.keys(e)) delete (e as unknown as Record<string, unknown>)[k];
  Object.assign(e, n);
}

/** Can ants use this entrance to go in (open, not caving in)? */
export function canEnter(e: Entrance): boolean {
  return !e.shut && !e.fall;
}

/** Can ants climb out through it (open; a collapsing hole stays passable until it has fallen in)? */
export function canLeave(e: Entrance): boolean {
  return !e.shut && (e.fall ?? 0) < 1;
}

/** Bit mask of usable entrances (cache keys of the fields that lead to them). */
export function usableMask(ents: readonly Entrance[], leaving: boolean): number {
  let m = 0;
  for (let i = 0; i < ents.length && i < 24; i++) if (leaving ? canLeave(ents[i]) : canEnter(ents[i])) m |= 1 << i;
  return m;
}

/**
 * Throughput: may one more ant pass entrance e now? Spends one unit of its credit, which refills
 * at ENTRANCE.passPerS up to ENTRANCE.burst. Ants are updated in id order, so who waits is the
 * same on every client.
 */
export function passEntrance(w: World, e: Entrance, leaving: boolean): boolean {
  if (leaving ? !canLeave(e) : !canEnter(e)) return false;
  const t = w.time;
  const cr = Math.min(ENTRANCE.burst, (e.cr ?? ENTRANCE.burst) + (t - (e.crT ?? t)) * ENTRANCE.passPerS);
  e.crT = t;
  if (cr < 1) {
    e.cr = cr;
    return false;
  }
  e.cr = cr - 1;
  return true;
}

/** Extra entrances a colony has (beyond its main one). */
export function extraCount(c: Colony): number {
  return Math.max(0, c.entrances.length - 1);
}

// ---------------------------------------------------------------------------
// Surface ends
// ---------------------------------------------------------------------------

/**
 * Map a nest-plane point to the colony's surface location (the fallback for maps without site
 * data). On an authored map the point is kept inside the colony's site (its footprint and dry
 * ring), which the map validator guarantees is dry, flat ground.
 */
export function nestToSurface(w: World, c: Colony, x: number, y: number): { x: number; y: number } {
  const g = w.nest(c.id)!;
  const k = 0.6;
  let dx = (x - g.widthMm / 2) * k;
  let dy = (y - g.depthMm / 2) * k;
  const L = w.terrain.layout;
  if (L && c.site !== undefined && L.sites[c.site]) {
    const fp = L.def.sites[c.site].footprint ?? 1;
    const lim = (fp + SITE_RING) * L.hex.H * 0.9;
    const d = dhypot(dx, dy);
    if (d > lim) {
      dx *= lim / d;
      dy *= lim / d;
    }
  }
  const sx = c.nx + dx;
  const sy = c.ny + dy;
  return { x: Math.min(w.terrain.width - 20, Math.max(20, sx)), y: Math.min(w.terrain.depth - 20, Math.max(20, sy)) };
}

/** The middle of the queen's chamber (the queen tile ringed by six more), else the grid's middle. */
export function nestHeart(c: Colony, g: NestGrid): number {
  const queens = c.tiles.filter((t) => t.type === 'queen').map((t) => t.q);
  for (const q of queens) if (g.neighbors(q).every((n) => n >= 0 && queens.includes(n))) return q;
  return queens[0] ?? g.hexIndex(Math.floor(g.cols / 2), Math.floor(g.rows / 2));
}

function unit(x: number, y: number): [number, number] {
  const l = dhypot(x, y) || 1;
  return [x / l, y / l];
}

/** Direction (unit vector, nest plane = surface orientation) from the nest's heart to hex q. */
function nestDir(g: NestGrid, from: number, q: number): [number, number] {
  const a = g.hexCenter(from);
  const ax = a.x;
  const ay = a.y;
  const b = g.hexCenter(q);
  return unit(b.x - ax, b.y - ay);
}

/**
 * Where an extra entrance with its top at nest hex `top` opens on the surface: the free extra spot
 * of the colony's site that best matches its direction from the nest's heart; on maps without
 * sites, the projected point moved to the nearest walkable ground. Null when there is none (the
 * spot cannot be dug).
 */
export function surfaceFor(w: World, c: Colony, top: number): { x: number; y: number } | null {
  const g = w.nest(c.id);
  if (!g) return null;
  const L = w.terrain.layout;
  const site = L && c.site !== undefined ? L.sites[c.site] : undefined;
  if (L && site) {
    const [vx, vy] = nestDir(g, nestHeart(c, g), top);
    const cx = L.hex.centerX(site.centre);
    const cy = L.hex.centerY(site.centre);
    let best = -1;
    let bs = -Infinity;
    for (const q of site.extras) {
      const x = L.hex.centerX(q);
      const y = L.hex.centerY(q);
      if (c.entrances.some((e) => sq(e.sx - x) + sq(e.sy - y) < 4)) continue; // taken
      const [ux, uy] = unit(x - cx, y - cy);
      const s = ux * vx + uy * vy;
      if (s > bs) {
        bs = s;
        best = q;
      }
    }
    return best < 0 ? null : { x: L.hex.centerX(best), y: L.hex.centerY(best) };
  }
  const p = g.hexCenter(top);
  const s = nestToSurface(w, c, p.x, p.y);
  const ok = nearestWalkable(w, s.x, s.y);
  if (!ok) return null;
  // never on top of another entrance
  if (c.entrances.some((e) => sq(e.sx - ok.x) + sq(e.sy - ok.y) < 36)) return null;
  return ok;
}

// ---------------------------------------------------------------------------
// Nest layout: the main tunnel and the extra-entrance spots
// ---------------------------------------------------------------------------

/**
 * Mark the nest's extra-entrance spots (ENTRANCE.maxExtra): undug tunnels ENTRANCE.spotMin–spotMax
 * hexes from the queen, pointing the way their surface ends lie from the site's centre (or ±120°
 * from the main tunnel on maps without sites), clear of the main tunnel and of each other. Stone
 * in a spot is softened so it can be dug. No random numbers.
 */
export function markSpots(w: World, c: Colony, g: NestGrid, q0: number, avoid: number[]): void {
  const E = ENTRANCE;
  const targets: Array<[number, number]> = [];
  const L = w.terrain.layout;
  const site = L && c.site !== undefined ? L.sites[c.site] : undefined;
  if (L && site) {
    const cx = L.hex.centerX(site.centre);
    const cy = L.hex.centerY(site.centre);
    for (const x of site.extras.slice(0, E.maxExtra)) targets.push(unit(L.hex.centerX(x) - cx, L.hex.centerY(x) - cy));
  }
  if (!targets.length) {
    const [mx, my] = nestDir(g, q0, g.entrances[0] ?? q0);
    const S = 0.8660254037844386;
    targets.push([mx * -0.5 - my * S, mx * S + my * -0.5], [mx * -0.5 + my * S, -mx * S + my * -0.5]);
  }
  const taken: number[] = [...avoid];
  const N = g.cols * g.rows;
  for (const [tx, ty] of targets.slice(0, E.maxExtra)) {
    let best: number[] | null = null;
    let bs = -Infinity;
    for (let q = 0; q < N; q++) {
      const d = g.hexDistance(q, q0);
      if (d < E.spotMin || d > E.spotMax) continue;
      if (g.hexRow(q) <= 1 || g.hexRow(q) >= g.rows - 2 || g.hexCol(q) <= 1 || g.hexCol(q) >= g.cols - 2) continue;
      const [ux, uy] = nestDir(g, q0, q);
      const s = ux * tx + uy * ty - d * 0.01; // prefer the nearer of equally good spots
      if (s <= bs) continue;
      const chain = chainToward(g, q, q0, E.tunnelLen, (h) => !g.isHexDug(h));
      if (chain.length < E.tunnelLen) continue;
      if (chain.some((h) => taken.some((t) => g.hexDistance(h, t) < 3))) continue;
      bs = s;
      best = chain;
    }
    if (!best) continue;
    for (const h of best) g.softenHex(h);
    g.addSpot(best);
    taken.push(...best);
  }
}

// ---------------------------------------------------------------------------
// Digging spots, opening entrances
// ---------------------------------------------------------------------------

/** Why spot i cannot become an entrance now (null when it can). */
export function spotBlocked(w: World, c: Colony, i: number): string | null {
  const g = w.nest(c.id);
  if (!g || !g.spots[i]) return 'No entrance spot here';
  if (extraCount(c) >= ENTRANCE.maxExtra) return `This colony already has ${ENTRANCE.maxExtra} extra entrances`;
  if (!surfaceFor(w, c, g.spots[i][0])) return 'No free entrance spot on the surface';
  return null;
}

/**
 * Designate (or clear) a whole extra-entrance spot for digging. Returns false when the spot
 * cannot be dug (see spotBlocked).
 */
export function designateSpot(w: World, c: Colony, i: number, on: boolean): boolean {
  const g = w.nest(c.id)!;
  if (on && spotBlocked(w, c, i)) return false;
  for (const q of g.spots[i]) if (g.isHexDiggable(q)) g.designateHex(q, on);
  return true;
}

/** Once a second: a spot whose every hex is dug becomes an entrance (or plain floor when it can't). */
export function openDugSpots(w: World, c: Colony): void {
  const g = w.nest(c.id);
  if (!g) return;
  for (let i = 0; i < g.spots.length; i++) {
    const tunnel = g.spots[i];
    if (!tunnel.every((q) => g.isHexDug(q))) continue;
    const can = !spotBlocked(w, c, i);
    const s = can ? surfaceFor(w, c, tunnel[0]) : null;
    g.removeSpot(i);
    i--;
    if (!s) continue;
    g.addEntrance(tunnel);
    c.entrances.push(makeEntrance(tunnel[0], s.x, s.y, w.time));
    c.spoil.push(0);
    c.hexSpeed = null;
    if (c.player) w.events.emit({ t: 'message', text: 'The diggers broke through: a new entrance to the surface.', kind: 'good', colony: c.id });
  }
}

// ---------------------------------------------------------------------------
// Closing, reopening, collapse
// ---------------------------------------------------------------------------

/**
 * Plug an extra entrance with soil (op 'close') or dig the plug out again ('open'). It takes
 * ENTRANCE.closeS; asking for the opposite while it is under way cancels it. The main entrance
 * never closes. Returns null when it took effect, else why not.
 */
export function setEntranceShut(w: World, c: Colony, i: number, close: boolean): string | null {
  const e = c.entrances[i];
  if (!e || !Number.isInteger(i)) return 'no such entrance';
  if (i === 0) return 'The main entrance cannot be closed';
  if (e.fall) return 'This entrance has caved in';
  const shut = !!e.shut;
  const working = (e.work ?? 0) > 0;
  if (close === shut) {
    // already in (or heading back to) the asked state: cancel a change under way
    if (working) e.work = 0;
    else return close ? 'Already closed' : 'Already open';
    return null;
  }
  if (working) return close ? 'Already being closed' : 'Already being opened';
  e.work = ENTRANCE.closeS;
  return null;
}

/** Once a second: plugging and unplugging work, and fallen colonies' entrances caving in. */
export function entranceTick(w: World, dt: number): void {
  for (const c of w.s.colonies) {
    for (const e of c.entrances) {
      if (!c.alive) {
        e.fall = Math.min(1, (e.fall ?? 0) + dt / ENTRANCE.collapseS);
        continue;
      }
      if ((e.work ?? 0) > 0) {
        e.work = Math.max(0, (e.work ?? 0) - dt);
        if (e.work === 0) {
          e.shut = e.shut ? 0 : 1;
          c.hexSpeed = null;
          if (c.player) w.events.emit({ t: 'message', text: e.shut ? 'An entrance is plugged with soil.' : 'An entrance is open again.', kind: 'info', colony: c.id });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Older saves
// ---------------------------------------------------------------------------

/**
 * Bring a loaded colony's entrances up to date. Entrances the player already dug in an older save
 * (where digging a hidden shaft opened one) stay open, even beyond the allowance; each tunnel stops
 * before any tile standing on it; unused shaft sites become marked spots only while the colony is
 * under its allowance. Idempotent (a current save or snapshot is left as it is).
 */
export function migrateColonyEntrances(w: World, c: Colony, g: NestGrid): void {
  for (const e of c.entrances) normalizeEntrance(e, w.time);
  for (let i = 0; i < g.tunnels.length; i++) {
    const t = g.tunnels[i];
    const k = t.findIndex((q, j) => j > 0 && c.tiles.some((tl) => tl.q === q));
    if (k > 0) g.tunnels[i] = t.slice(0, k);
  }
  const room = Math.max(0, ENTRANCE.maxExtra - extraCount(c));
  while (g.spots.length > room) g.removeSpot(g.spots.length - 1);
}

/** Speed factor of tunnel hexes (a level I highway). */
export function tunnelSpeed(g: NestGrid, sp: Float32Array): void {
  for (const t of g.tunnels) for (const q of t) if (q >= 0 && q < sp.length) sp[q] = ENTRANCE.tunnelSpeed;
}

/** Surface hole of an underground area nearest a point that ants may go in by (−1: none). */
export function nearestOpen(ents: readonly Entrance[], x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < ents.length; i++) {
    if (!canEnter(ents[i])) continue;
    const d = sq(ents[i].sx - x) + sq(ents[i].sy - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

