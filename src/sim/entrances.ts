import { World } from './world';
import { Ant, Colony, Entrance, SURFACE } from './types';
import { ENTRANCE } from './balance';
import { recomputeGroups, recomputeTileCaps, tileCost } from './tiles';
import { NestGrid } from '../world/nestGrid';
import { SITE_RING } from '../world/surfaceLayout';
import { dcos, dhypot, dsin, datan2, hash01, sq } from './dmath';
import { nearestWalkable } from './markers';

/**
 * Nest entrances (user spec 2026-11-01 "one wide underground entrance, three surface holes per anthill"; DESIGN.md
 * "Entrances").
 *
 * Every colony's nest has exactly one entrance. Underground it is a wide 7-hex "flower" (a hex and its six neighbours,
 * NestGrid.flowers[0]) at the nest's edge on the surface side, its floor ramping up to the surface along a spine (the top
 * hex, the centre, the inner hex: NestGrid.tunnels[0]); a passage joins it to the queen's chamber. On the surface the
 * colony's anthill has three holes (`Colony.entrances`, ENTRANCE.holes), all leading into the flower, always open: one
 * `Entrance` record per hole, all with the flower's centre as their underground end `q`, each with its own throughput
 * credit (ENTRANCE.passPerS). Nobody can dig, plug or open another entrance. A fallen colony's holes and flower cave in.
 *
 * Creature caves keep their single 3-hex tunnel and one hole (sim/areas.ts).
 *
 * All of it is simulation state, changed only by the fixed tick (no random numbers: placement is geometric, arrivals are
 * spread by a hash of the ant and the tick).
 */

export function makeEntrance(q: number, sx: number, sy: number, time: number): Entrance {
  return { q, sx, sy, cr: ENTRANCE.burst, crT: time, fall: 0, n: 0 };
}

/** Fill the fields older saves lack and drop the ones they no longer have (canonical snapshots: makeEntrance's order). */
export function normalizeEntrance(e: Entrance, time: number): void {
  const r = e as unknown as Record<string, unknown>;
  if (r.shut === undefined && r.work === undefined && e.cr !== undefined && e.crT !== undefined && e.fall !== undefined && e.n !== undefined) return;
  const n = makeEntrance(e.q, e.sx, e.sy, time);
  n.cr = e.cr ?? n.cr;
  n.crT = e.crT ?? n.crT;
  n.fall = e.fall ?? 0;
  n.n = e.n ?? 0;
  for (const k of Object.keys(e)) delete r[k];
  Object.assign(e, n);
}

/** Can ants go in through this hole (not caving in)? */
export function canEnter(e: Entrance): boolean {
  return !e.fall;
}

/** Can ants climb out through it (a collapsing hole stays passable until it has fallen in)? */
export function canLeave(e: Entrance): boolean {
  return (e.fall ?? 0) < 1;
}

/** Bit mask of usable holes (cache keys of the fields that lead to them). */
export function usableMask(ents: readonly Entrance[], leaving: boolean): number {
  let m = 0;
  for (let i = 0; i < ents.length && i < 24; i++) if (leaving ? canLeave(ents[i]) : canEnter(ents[i])) m |= 1 << i;
  return m;
}

/** Throughput credit hole e has now (ENTRANCE.passPerS refilling up to ENTRANCE.burst), without spending any. */
export function holeCredit(w: World, e: Entrance): number {
  return Math.min(ENTRANCE.burst, (e.cr ?? ENTRANCE.burst) + (w.time - (e.crT ?? w.time)) * ENTRANCE.passPerS);
}

/**
 * Throughput: may one more ant pass hole e now? Spends one unit of its credit, which refills at ENTRANCE.passPerS up to
 * ENTRANCE.burst (each hole its own). Ants are updated in id order, so who waits is the same on every client.
 */
export function passEntrance(w: World, e: Entrance, leaving: boolean): boolean {
  if (leaving ? !canLeave(e) : !canEnter(e)) return false;
  const cr = holeCredit(w, e);
  e.crT = w.time;
  if (cr < 1) {
    e.cr = cr;
    return false;
  }
  e.cr = cr - 1;
  e.n = (e.n ?? 0) + 1;
  return true;
}

// ---------------------------------------------------------------------------
// Surface ends
// ---------------------------------------------------------------------------

/**
 * Map a nest-plane point to the colony's surface location. On an authored map the point is kept inside the colony's site
 * (its footprint and dry ring), which the map validator guarantees is dry, flat ground.
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

/**
 * Where the anthill's three holes open. An authored map: the colony site's three entrance spots (its main spot and the
 * two extra spots, validated dry, flat, away from walls and water and outside flood zones). Elsewhere: three points
 * ENTRANCE.holeR (by species) from the colony's centre, 120° apart, the first toward where the nest's flower lies, each
 * moved to the nearest walkable ground and kept ENTRANCE.holeGap from the others. No random numbers.
 */
export function holeSpots(w: World, c: Colony, g: NestGrid | undefined): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const L = w.terrain.layout;
  const site = L && c.site !== undefined ? L.sites[c.site] : undefined;
  if (L && site) for (const q of [...site.entrances.slice(0, 1), ...site.extras]) if (out.length < ENTRANCE.holes) out.push({ x: L.hex.centerX(q), y: L.hex.centerY(q) });
  if (out.length >= ENTRANCE.holes) return out;
  // the direction the flower lies in (the old main hole's), from the colony's centre
  let a0 = -Math.PI / 2;
  if (out.length) a0 = datan2(out[0].y - c.ny, out[0].x - c.nx);
  else if (g && g.entrances.length) {
    const p = g.hexCenter(g.entrances[0]);
    const s = nestToSurface(w, c, p.x, p.y);
    if (dhypot(s.x - c.nx, s.y - c.ny) > 1) a0 = datan2(s.y - c.ny, s.x - c.nx);
  }
  const r0 = ENTRANCE.holeR[c.species] ?? ENTRANCE.holeRDefault;
  const T = w.terrain;
  for (let k = out.length; k < ENTRANCE.holes; k++) {
    const a = a0 + (k * 2 * Math.PI) / ENTRANCE.holes;
    let pick: { x: number; y: number } | null = null;
    // the ring point, else a little farther out or round, until it is on walkable ground clear of the other holes
    for (let t = 0; t < 12 && !pick; t++) {
      const r = r0 + (t >> 1) * 4;
      const aa = a + (t & 1 ? 0.25 : 0) * ((t >> 1) % 2 ? -1 : 1);
      const x = Math.min(T.width - 20, Math.max(20, c.nx + dcos(aa) * r));
      const y = Math.min(T.depth - 20, Math.max(20, c.ny + dsin(aa) * r));
      const p = nearestWalkable(w, x, y);
      if (p && out.every((o) => dhypot(o.x - p.x, o.y - p.y) >= ENTRANCE.holeGap)) pick = p;
    }
    if (!pick) {
      const x = Math.min(T.width - 20, Math.max(20, c.nx + dcos(a) * r0));
      const y = Math.min(T.depth - 20, Math.max(20, c.ny + dsin(a) * r0));
      pick = nearestWalkable(w, x, y) ?? { x, y };
    }
    out.push(pick);
  }
  return out;
}

/** The anthill's centre: the middle of its holes. */
export function anthillCentre(ents: readonly Entrance[], out: { x: number; y: number }): { x: number; y: number } {
  out.x = 0;
  out.y = 0;
  for (const e of ents) {
    out.x += e.sx / ents.length;
    out.y += e.sy / ents.length;
  }
  return out;
}

/**
 * Where the colony drops its dead and waste on the surface: beside the anthill, out past the middle of its first two
 * holes (the leafcutters' refuse dump is drawn there, render/game/entranceModels.ts).
 */
export function refuseSpot(c: Colony, out: { x: number; y: number }): { x: number; y: number } {
  const ents = c.entrances;
  if (!ents.length) {
    out.x = c.nx;
    out.y = c.ny;
    return out;
  }
  const m = anthillCentre(ents, { x: 0, y: 0 });
  const e0 = ents[0];
  const e1 = ents[1] ?? e0;
  let dx = (e0.sx + e1.sx) / 2 - m.x;
  let dy = (e0.sy + e1.sy) / 2 - m.y;
  let d = dhypot(dx, dy);
  if (d < 1) {
    dx = e0.sx - c.nx;
    dy = e0.sy - c.ny;
    d = dhypot(dx, dy) || 1;
  }
  const r = dhypot(e0.sx - m.x, e0.sy - m.y) + ENTRANCE.refuseMm;
  out.x = m.x + (dx / d) * r;
  out.y = m.y + (dy / d) * r;
  return out;
}

/** (Re)build a colony's three holes over its nest's flower, keeping the credit and cave-in of the holes it had. */
export function placeHoles(w: World, c: Colony, g: NestGrid): void {
  const q = g.entrances[0] ?? 0;
  const old = c.entrances;
  c.entrances = holeSpots(w, c, g).map((p, i) => {
    const e = makeEntrance(q, p.x, p.y, w.time);
    const o = old[Math.min(i, old.length - 1)];
    if (o) {
      e.cr = o.cr ?? e.cr;
      e.crT = o.crT ?? e.crT;
      e.fall = o.fall ?? 0;
      e.n = old[i]?.n ?? 0;
    }
    return e;
  });
  c.spoil = c.entrances.map((_, i) => c.spoil[i] ?? 0);
}

// ---------------------------------------------------------------------------
// The flower
// ---------------------------------------------------------------------------

/**
 * The flower over a passage from the queen's hex (`path`, queen side first, ending where the entrance lies): its centre
 * is the second-last hex of the passage whose six neighbours all lie inside the grid (so the flower's top hex sits about
 * where the passage ends), its hexes the centre and its six neighbours (centre first), its spine the top hex (farthest
 * from the queen's hex `q0`), the centre and the inner hex (nearest the queen's hex).
 */
export function flowerOver(g: NestGrid, q0: number, path: readonly number[]): { flower: number[]; spine: number[] } {
  // (its six hexes and their neighbours all in the diggable interior, clear of the rim and the rock margin)
  const inGrid = (q: number) => g.neighbors(q).every((n) => n >= 0 && g.isInterior(n) && g.hexRow(n) > 0 && g.hexCol(n) > 0 && g.hexRow(n) < g.rows - 1 && g.hexCol(n) < g.cols - 1);
  let ci = Math.max(0, path.length - 2);
  while (ci > 0 && !inGrid(path[ci])) ci--;
  const centre = path[ci] ?? q0;
  const flower = [centre, ...g.neighbors(centre).filter((n) => n >= 0)];
  const a = g.hexCenter(q0);
  const b = g.hexCenter(centre);
  let ux = b.x - a.x;
  let uy = b.y - a.y;
  if (!ux && !uy) uy = -1;
  const proj = (q: number) => {
    const p = g.hexCenter(q);
    return p.x * ux + p.y * uy;
  };
  const ring = flower.slice(1).sort((p, q) => proj(q) - proj(p) || p - q);
  return { flower, spine: [ring[0], centre, ring[ring.length - 1]] };
}

/** Dig a nest's flower out and make it the nest's one entrance (any entrances it had are dropped first). */
export function digFlower(g: NestGrid, flower: number[], spine: number[]): void {
  for (const q of flower) {
    g.softenHex(q);
    g.completeHex(q);
  }
  g.clearEntrances();
  g.addEntrance(spine, flower);
}

/** The three hexes at the top of an area's entrance (where ants come down and climb out); a cave: its tunnel's top. */
export function entranceTop(g: NestGrid): readonly number[] {
  return g.flowerEdges(0).top;
}

/** The hexes at the inner edge of a nest's flower (where defenders hold the choke); a cave: its tunnel's bottom. */
export function entranceInner(g: NestGrid): readonly number[] {
  return g.flowerEdges(0).inner;
}

/**
 * Which hole an ant climbing out of an area takes: the one nearest where it is going on the surface — its marker (the
 * distance along the marker's shared surface field, the one its walk there uses), the food, foe or creature it is after
 * (straight distance) — else one by its id, so traffic comes out of the side facing the action. While that hole is busy
 * (no credit) it takes another of the anthill's that has room and is not much farther on its way (ENTRANCE.switchMm plus
 * ENTRANCE.switchFrac of the way; any of them for an ant going nowhere in particular), so a crowd spreads over the holes.
 */
export function exitHole(w: World, a: Ant, ents: readonly Entrance[]): number {
  const n = ents.length;
  if (n <= 1) return 0;
  const goal = leaveGoal(w, a);
  // (a marker its field cannot reach from any hole — walled off — goes by the straight distance)
  if (goal?.field && !ents.some((e) => fieldNear(w, goal.field!, e.sx, e.sy) < Infinity)) goal.field = undefined;
  const dist = (i: number) => (!goal ? 0 : goal.field ? fieldNear(w, goal.field, ents[i].sx, ents[i].sy) : dhypot(ents[i].sx - goal.x, ents[i].sy - goal.y));
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < n; k++) {
    // (from the ant's own hole round: equal distances — or no goal — spread the ants by id)
    const i = (a.id + k) % n;
    if (!canLeave(ents[i])) continue;
    const d = dist(i);
    if (d < bd - 1e-6) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return 0;
  if (holeCredit(w, ents[best]) >= 1) return best;
  // (the others with room that are not much farther, taken in turn by id: the crowd spreads over all of them)
  const slack = ENTRANCE.switchMm + (Number.isFinite(bd) ? bd : 0) * ENTRANCE.switchFrac;
  for (let k = 0; k < n; k++) {
    const i = (a.id + k) % n;
    if (i === best || !canLeave(ents[i]) || holeCredit(w, ents[i]) < 1) continue;
    if (dist(i) <= bd + slack) return i;
  }
  return best;
}

/** A surface field's distance at a hole: the least over its cell and the eight round it (a hole's own cell may be a rim). */
function fieldNear(w: World, f: Float32Array, x: number, y: number): number {
  const c = w.surfFlow.cell;
  let d = Infinity;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) d = Math.min(d, w.surfFlow.distAt(f, x + i * c, y + j * c) + (i || j ? c * (i && j ? 1.414 : 1) : 0));
  return d;
}

/** Where on the surface an ant leaving an area is headed (null: nowhere in particular). */
function leaveGoal(w: World, a: Ant): { x: number; y: number; field?: Float32Array } | null {
  const c = w.colony(a.colony);
  if (c && a.marker >= 0) {
    const m = c.markers?.[a.marker];
    if (m && m.placed && m.space === SURFACE) {
      const cell = w.surfFlow.cell;
      const field = w.surfFlow.field(`mk:${c.id}:${a.marker}`, Math.round(m.x / cell) * 10007 + Math.round(m.y / cell), [{ x: m.x, y: m.y }]);
      return { x: m.x, y: m.y, field };
    }
  }
  if (a.tgt) {
    if (a.tk === 1) {
      const f = w.foodById.get(a.tgt);
      if (f && f.space === SURFACE) return { x: f.x, y: f.y };
    } else if (a.tk === 3) {
      const o = w.antById.get(a.tgt);
      if (o && o.space === SURFACE) return { x: o.x, y: o.y };
    } else if (a.tk === 4) {
      const cr = w.creatureById.get(a.tgt);
      if (cr && cr.space === SURFACE) return { x: cr.x, y: cr.y };
    }
  }
  return null;
}

/**
 * Coming in: the hole an ant at (x, y) goes down — the nearest one that is open; while it has no credit (ants queue at a
 * busy hole), another hole of the same anthill with credit at most ENTRANCE.switchMm farther.
 */
export function holeIn(w: World, ents: readonly Entrance[], x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < ents.length; i++) {
    if (!canEnter(ents[i])) continue;
    const d = dhypot(ents[i].sx - x, ents[i].sy - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0 || holeCredit(w, ents[best]) >= 1) return best;
  let alt = -1;
  let ad = bd + ENTRANCE.switchMm;
  for (let i = 0; i < ents.length; i++) {
    if (i === best || !canEnter(ents[i]) || holeCredit(w, ents[i]) < 1) continue;
    const d = dhypot(ents[i].sx - x, ents[i].sy - y);
    if (d <= ad) {
      ad = d;
      alt = i;
    }
  }
  return alt >= 0 ? alt : best;
}

/** A hash in [0, 1) of an ant and the tick (spreads arrivals over the flower without the simulation's random numbers). */
export function arrivalHash(w: World, a: Ant, k: number): number {
  return hash01(a.id * 131 + k, w.s.tick);
}

// ---------------------------------------------------------------------------
// Collapse
// ---------------------------------------------------------------------------

/** Once a second: a fallen colony's holes (and with them its flower) caving in. */
export function entranceTick(w: World, dt: number): void {
  for (const c of w.s.colonies) {
    if (c.alive) continue;
    for (const e of c.entrances) e.fall = Math.min(1, (e.fall ?? 0) + dt / ENTRANCE.collapseS);
  }
}

// ---------------------------------------------------------------------------
// Older saves
// ---------------------------------------------------------------------------

/**
 * Bring a loaded colony's entrance up to date (saves from before the one-entrance rework, 2026-11-01). Idempotent: a
 * nest that already has its flower and three holes is left as it is.
 *
 * Extra entrances (dug or not), extra-entrance spots and shafts are dropped; their dug hexes stay ordinary dug floor.
 * The main entrance becomes the flower, centred on its old tunnel's top: its 7 hexes are dug out, and a tile standing
 * on one of them moves to the nearest free dug hex (or its cost is refunded when there is none). Ants and food in the
 * nest stay where they are (the old tunnels stay dug). The holes are rebuilt from the colony's site or around its
 * centre. Returns what it moved, for the load log.
 */
export function upgradeEntrances(w: World, c: Colony, g: NestGrid): string[] {
  const log: string[] = [];
  for (const e of c.entrances) normalizeEntrance(e, w.time);
  const has = g.flowers.length === 1 && g.flowers[0].length === 7 && g.entrances.length === 1;
  if (has && c.entrances.length === ENTRANCE.holes && c.entrances.every((e) => e.q === g.entrances[0])) return log;
  if (!has) {
    const q0 = nestHeart(c, g);
    // the old main tunnel ran from its top (the ramp under the hole) down toward the queen: the flower goes over it as
    // a new nest's goes over its passage, its top hex about where the old top was
    const old = g.tunnels[0]?.length ? g.tunnels[0] : [g.entrances[0] ?? q0];
    const { flower, spine } = flowerOver(g, q0, old.slice().reverse());
    digFlower(g, flower, spine);
    // tiles on the flower move off it
    for (const t of c.tiles.slice()) {
      if (!flower.includes(t.q)) continue;
      const to = nearestFreeDug(c, g, t.q);
      if (to >= 0) {
        log.push(`moved a ${t.type} tile off the widened entrance (hex ${t.q} → ${to})`);
        t.q = to;
      } else {
        const cost = t.type === 'carton' ? 0 : tileCost(c, t.type, t.caste);
        c.tiles.splice(c.tiles.indexOf(t), 1);
        c.food += cost;
        log.push(`removed a ${t.type} tile from the widened entrance (no free floor; ${cost} food refunded)`);
      }
    }
    if (log.length) {
      recomputeGroups(w, c);
      recomputeTileCaps(c);
    }
  }
  placeHoles(w, c, g);
  c.hexSpeed = null;
  return log;
}

/**
 * Bring every colony's entrance up to date after a load (`upgradeEntrances`; caves only get their fields normalized).
 * Called by the World constructor and again by restoreWorld once a binary snapshot's grids are attached. What it moved
 * goes to the load log (and the player's message log).
 */
export function upgradeWorldEntrances(w: World): void {
  for (const c of w.s.colonies) {
    const g = w.nest(c.id);
    if (!g) {
      for (const e of c.entrances) normalizeEntrance(e, w.time);
      continue;
    }
    for (const line of upgradeEntrances(w, c, g)) {
      console.info(`[load] colony ${c.id}: ${line}`);
      if (c.player) w.events.emit({ t: 'message', text: `Old save: ${line}.`, kind: 'info', colony: c.id });
    }
  }
  for (const cv of w.s.caves) for (const e of cv.entrances) normalizeEntrance(e, w.time);
}

/** The nearest dug hex to q that is not an entrance hex and holds no tile (−1: none). */
function nearestFreeDug(c: Colony, g: NestGrid, q: number): number {
  let best = -1;
  let bd = Infinity;
  for (let h = 0; h < g.cols * g.rows; h++) {
    if (!g.isHexDug(h) || g.isEntrance(h) || c.tiles.some((t) => t.q === h)) continue;
    const d = g.hexDistance(h, q);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

/** Speed factor of entrance hexes (a level I highway). */
export function tunnelSpeed(g: NestGrid, sp: Float32Array): void {
  for (const f of g.flowers) for (const q of f) if (q >= 0 && q < sp.length) sp[q] = ENTRANCE.tunnelSpeed;
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
