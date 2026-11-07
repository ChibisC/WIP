import { World } from './world';
import { Ant, AS, Colony, Creature, RouteHalf, SURFACE, TunnelRoute, colonyOfSpace, nestSpace } from './types';
import { TUNNELS } from './balance';
import { NestGrid, SOIL_AIR } from '../world/nestGrid';
import { datan2, dcos, dhypot, dsin, hash01 } from './dmath';
import { hexCoreCells } from './colony';

/**
 * A shared underground: set tunnel routes between nests (claude/underground/01-spec-shared-underground-tunnels.md, user
 * 2026-11-06; CHANGE_PLAN §27; DESIGN.md "A shared underground"). The game's own feature: in EotU every nest is sealed.
 *
 * Every colony nest grid has a ring of TUNNELS.margin hexes of rock round its diggable interior (world/nestGrid.ts). A
 * route between two nests is two halves, one in each grid: from a gate on the interior's edge (brownish loosened soil)
 * outward through the rock, three hexes wide, to the grid's rim, where the halves meet (the route's halfway point).
 * Routes are generated once at match start from the anthills' positions (`generateRoutes`): every pair of nests on small
 * maps, each nest's nearest neighbours on big ones, never crossing. The route's hexes are diggable soil drawn as rock until
 * dug, walled by rock nothing breaks.
 *
 * A colony digs one route at a time (`Colony.routeDig`): its own half from its gate to the rim, then on through the
 * partner's half from the rim to the partner's gate — so an attacker digs the whole way, and a defender or ally digging
 * from its own gate meets it; hexes dug from either side count. The route opens for good when every hex of both halves
 * is dug (`tunnelTick`). Ants (and creatures) walk through: a unit in a rim step heading out over the rim comes out at
 * the same place in the partner's rim step (`crossings`), in the partner's space. The defender is warned when an enemy's
 * frontier comes within TUNNELS.warnRange steps of its gate. Everything here is deterministic simulation state; what a
 * player sees of it is the client's fog (game/fog.ts).
 */

const EDGE_ANG = [-Math.PI / 6, Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6, (7 * Math.PI) / 6, -Math.PI / 2];

export type RoutePlan = 'auto' | 'none' | ReadonlyArray<readonly [number, number]>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function routes(w: World): TunnelRoute[] {
  return w.s.routes ?? (w.s.routes = []);
}

export function routeById(w: World, id: number): TunnelRoute | undefined {
  return id >= 0 ? routes(w)[id] : undefined;
}

/** The half of route r that lies in `space` (undefined: none). */
export function halfIn(r: TunnelRoute, space: number): RouteHalf | undefined {
  return r.halves[0].space === space ? r.halves[0] : r.halves[1].space === space ? r.halves[1] : undefined;
}

/** The other half. */
export function otherHalf(r: TunnelRoute, h: RouteHalf): RouteHalf {
  return r.halves[0] === h ? r.halves[1] : r.halves[0];
}

/** The routes a nest space has halves in. */
export function routesOf(w: World, space: number): TunnelRoute[] {
  return routes(w).filter((r) => r.halves[0].space === space || r.halves[1].space === space);
}

/** The route between two nest spaces (undefined: none). */
export function routeBetween(w: World, a: number, b: number): TunnelRoute | undefined {
  return routes(w).find((r) => (r.halves[0].space === a && r.halves[1].space === b) || (r.halves[0].space === b && r.halves[1].space === a));
}

/** Are all the hexes of a step dug? */
function stepDug(g: NestGrid, step: readonly number[]): boolean {
  for (const q of step) if (q >= 0 && !g.isHexDug(q)) return false;
  return true;
}

/** Steps dug through from the gate (a prefix count, 0..steps.length). */
export function dugFromGate(w: World, h: RouteHalf): number {
  const g = w.nestOf(h.space);
  if (!g) return 0;
  let n = 0;
  while (n < h.steps.length && stepDug(g, h.steps[n])) n++;
  return n;
}

/** Steps dug through from the rim (a suffix count, 0..steps.length). */
export function dugFromRim(w: World, h: RouteHalf): number {
  const g = w.nestOf(h.space);
  if (!g) return 0;
  let n = 0;
  while (n < h.steps.length && stepDug(g, h.steps[h.steps.length - 1 - n])) n++;
  return n;
}

/** Is a half dug through from gate to rim? */
export function halfThrough(w: World, h: RouteHalf): boolean {
  return dugFromGate(w, h) >= h.steps.length;
}

/**
 * Does the half's gate join the owner's dug floor: the gate dug and touching dug interior floor that is not the route's
 * own, or its breach dug through to it (an attacker's digging inside the nest).
 */
export function gateConnected(w: World, h: RouteHalf): boolean {
  const g = w.nestOf(h.space);
  if (!g || !g.isHexDug(h.gate)) return false;
  const floor = (q: number, except: readonly number[]) => g.neighbors(q).some((m) => m >= 0 && g.isInterior(m) && g.isHexDug(m) && g.routeOf(m) < 0 && !except.includes(m));
  if (floor(h.gate, h.breach ?? [])) return true;
  if (!h.breach) return false;
  for (let i = 0; i < h.breach.length; i++) {
    const q = h.breach[i];
    if (!g.isHexDug(q)) return false;
    if (floor(q, h.breach)) return true;
  }
  return false;
}

/**
 * Plan the breach from a half's gate inward to the owner's nearest dug interior floor (a breadth-first search through
 * diggable interior hexes, deterministic by neighbour order): the hexes to dig, gate excluded. Empty when the gate
 * already touches dug floor; undefined when no way exists.
 */
export function planBreach(w: World, h: RouteHalf): number[] | undefined {
  const g = w.nestOf(h.space);
  if (!g) return undefined;
  const isFloor = (m: number) => m >= 0 && g.isInterior(m) && g.isHexDug(m) && g.routeOf(m) < 0;
  if (g.neighbors(h.gate).some(isFloor)) return [];
  const prev = new Map<number, number>([[h.gate, -1]]);
  const queue = [h.gate];
  while (queue.length) {
    const q = queue.shift()!;
    for (const m of g.neighbors(q)) {
      if (m < 0 || prev.has(m) || !g.isInterior(m) || g.routeOf(m) >= 0) continue;
      if (isFloor(m)) {
        const path: number[] = [];
        let cur = q;
        while (cur !== h.gate && cur >= 0) {
          path.push(cur);
          cur = prev.get(cur)!;
        }
        return path.reverse();
      }
      if (!g.isHexDiggable(m)) continue;
      prev.set(m, q);
      queue.push(m);
    }
  }
  return undefined;
}

/** Can units cross between the halves (both rim steps dug)? */
export function canCross(w: World, r: TunnelRoute): boolean {
  if (r.open) return true;
  return dugFromRim(w, r.halves[0]) > 0 && dugFromRim(w, r.halves[1]) > 0;
}

/**
 * May this colony's units walk the route between the two halves now: it is open, or the colony is digging it and its
 * side is through to the rim with the partner's rim step dug (its diggers go on inside).
 */
export function routeUsable(w: World, r: TunnelRoute, colony: number): boolean {
  if (r.open) return true;
  const c = w.colony(colony);
  if (!c || c.routeDig !== r.id || !canCross(w, r)) return false;
  const own = r.halves[0].colony === colony ? r.halves[0] : r.halves[1].colony === colony ? r.halves[1] : undefined;
  return !!own && halfThrough(w, own);
}

/** A route a unit of `colony` may walk from `from` to `to` (undefined: none). */
export function usableRoute(w: World, from: number, to: number, colony: number): TunnelRoute | undefined {
  if (from === SURFACE || to === SURFACE || from === to) return undefined;
  const r = routeBetween(w, from, to);
  return r && routeUsable(w, r, colony) ? r : undefined;
}

/** The nest spaces linked to `space` by routes `colony`'s units may walk. */
export function linkedSpaces(w: World, space: number, colony: number): number[] {
  const out: number[] = [];
  for (const r of routesOf(w, space)) if (routeUsable(w, r, colony)) out.push(otherHalf(r, halfIn(r, space)!).space);
  return out;
}

/** The rim step's cells (the target of the walk out to the rim). */
export function rimCells(g: NestGrid, h: RouteHalf): number[] {
  const step = h.steps[h.steps.length - 1];
  const out: number[] = [];
  for (const q of step) if (q >= 0 && g.isHexDug(q)) for (const k of hexCoreCells(g, q, 0.5)) out.push(k);
  return out;
}

/** Field in `space` toward route r's rim step there (null: none). */
export function routeField(w: World, space: number, r: TunnelRoute): Float32Array | null {
  const flow = w.flowOf(space);
  const g = w.nestOf(space);
  const h = halfIn(r, space);
  if (!flow || !g || !h) return null;
  return flow.field(`route:${r.id}`, () => rimCells(g, h), r.open ? 1 : 0);
}

/** The gate's centre (mm) in the half's space. */
export function gatePos(w: World, h: RouteHalf, out = { x: 0, y: 0 }): { x: number; y: number } {
  const g = w.nestOf(h.space);
  if (!g) return out;
  return g.hexCenter(h.gate, out);
}

/** Which rim-step hex (index in the step, −1 none) a point lies in. */
function rimIndex(g: NestGrid, h: RouteHalf, x: number, y: number): number {
  const q = g.hexAt(x, y);
  if (q < 0) return -1;
  return h.steps[h.steps.length - 1].indexOf(q);
}

/**
 * Carry a unit standing in `h`'s rim step, past its centre toward the rim (TUNNELS.crossFrac × R), over to the other
 * half: the mirrored place in the partner's rim step (the halves face each other: left ↔ right), just inside its rim,
 * heading inward. Returns true if it crossed.
 */
export function crossIfPastRim(w: World, u: { space: number; x: number; y: number; h: number; px?: number; py?: number; ph?: number }, r: TunnelRoute, h: RouteHalf): boolean {
  const g = w.nestOf(h.space);
  const o = otherHalf(r, h);
  const og = w.nestOf(o.space);
  if (!g || !og) return false;
  const i = rimIndex(g, h, u.x, u.y);
  if (i < 0) return false;
  const step = h.steps[h.steps.length - 1];
  const ctr = g.hexCenter(step[i]);
  const ox = dcos(EDGE_ANG[h.dir]);
  const oy = dsin(EDGE_ANG[h.dir]);
  const along = (u.x - ctr.x) * ox + (u.y - ctr.y) * oy;
  if (along < g.R * TUNNELS.crossFrac) return false;
  const ostep = o.steps[o.steps.length - 1];
  let j = Math.min(ostep.length - 1, Math.max(0, ostep.length - 1 - i));
  // (its mirrored hex is not dug yet — a half dug from the rim one hex at a time: take a dug one of the step)
  if (!og.isHexDug(ostep[j])) {
    const k = ostep.findIndex((q) => q >= 0 && og.isHexDug(q));
    if (k < 0) return false;
    j = k;
  }
  const lat = -(u.x - ctr.x) * oy + (u.y - ctr.y) * ox; // left of the outward direction
  const ix = dcos(EDGE_ANG[o.dir] + Math.PI);
  const iy = dsin(EDGE_ANG[o.dir] + Math.PI);
  const oc = og.hexCenter(ostep[j]);
  // (mirrored: what was to its left going out is to its right coming in)
  const latK = Math.max(-0.35, Math.min(0.35, -lat / g.R)) * og.R;
  let x = oc.x - ix * og.R * TUNNELS.crossFrac + -iy * latK;
  let y = oc.y - iy * og.R * TUNNELS.crossFrac + ix * latK;
  if (!og.isAirAt(x, y)) {
    x = oc.x;
    y = oc.y;
  }
  u.space = o.space;
  u.x = x;
  u.y = y;
  u.h = datan2(iy, ix);
  if (u.px !== undefined) {
    u.px = x;
    u.py = y;
    u.ph = u.h;
  }
  return true;
}

/**
 * Is a point in `space` sealed off from the nest's owner: in a route half's hexes the owner's own digging has not reached
 * (a closed route: beyond its dug steps from the gate), or in a breach not yet joined to the floor. Units there are in
 * the tunnel, not in the nest: no alarm, no intruders, unseen (game/fog.ts).
 */
export function sealedAt(w: World, space: number, x: number, y: number): boolean {
  const g = w.nestOf(space);
  if (!g) return false;
  const q = g.hexAt(x, y);
  if (q < 0) return false;
  const id = g.routeOf(q);
  if (id >= 0) {
    const r = routes(w)[id];
    const h = r ? halfIn(r, space) : undefined;
    if (!r || !h) return false;
    if (r.open) return false;
    return stepIndex(h, q) >= dugFromGate(w, h);
  }
  for (const r of routesOf(w, space)) {
    const h = halfIn(r, space)!;
    // (an enemy's breach from the open route, not the owner's own passage to its gate)
    if (h.breach && !h.joined && r.open && h.breach.includes(q)) return true;
  }
  return false;
}

/** The step index (from the gate) of a route hex in its half, −1 if not in it. */
export function stepIndex(h: RouteHalf, q: number): number {
  for (let i = 0; i < h.steps.length; i++) if (h.steps[i].includes(q)) return i;
  return -1;
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------

/** A hex of a route to dig next: in `space`; `cross` when it is dug from across the rim (the digger stands in its own rim step). */
export interface RouteDig {
  space: number;
  q: number;
  cross: boolean;
  route: number;
}

/** The half of route r that belongs to `colony` (undefined: not its route). */
export function ownHalf(r: TunnelRoute, colony: number): RouteHalf | undefined {
  return r.halves[0].colony === colony ? r.halves[0] : r.halves[1].colony === colony ? r.halves[1] : undefined;
}

/**
 * The hexes `colony` digs next on its route: its own half's first step not dug through, from the gate (each undug hex of
 * it that touches dug floor; the gate itself once the nest's digging has reached it), else — its half through to the
 * rim — the partner's half from the rim inward: its rim step from across the rim, then each step from the one before.
 */
export function routeFrontier(w: World, c: Colony): RouteDig[] {
  const r = routeById(w, c.routeDig ?? -1);
  if (!r) return [];
  const own = ownHalf(r, c.id);
  if (!own) return [];
  const out: RouteDig[] = [];
  const g = w.nestOf(own.space);
  if (!g) return out;
  const n = r.open ? own.steps.length : dugFromGate(w, own);
  // the way to its own gate first: a passage from the nest's dug floor to the gate (the AI's nest rarely reaches it;
  // a player digs it by hand or lets this do it), dug from the floor outward
  if (n === 0 && !g.neighbors(own.gate).some((m) => m >= 0 && g.isHexDug(m))) {
    if (!own.breach || own.breach.some((q) => !g.isHexDiggable(q) && !g.isHexDug(q))) own.breach = planBreach(w, own);
    if (!own.breach) return out;
    for (let i = own.breach.length - 1; i >= 0; i--) {
      const q = own.breach[i];
      if (g.isHexDug(q)) continue;
      if (g.neighbors(q).some((k) => k >= 0 && g.isHexDug(k))) out.push({ space: own.space, q, cross: false, route: r.id });
      break;
    }
    return out;
  }
  if (n < own.steps.length) {
    for (const q of own.steps[n]) {
      if (q < 0 || g.isHexDug(q)) continue;
      if (g.neighbors(q).some((m) => m >= 0 && g.isHexDug(m))) out.push({ space: own.space, q, cross: false, route: r.id });
    }
    return out;
  }
  const o = otherHalf(r, own);
  const og = w.nestOf(o.space);
  if (!og) return out;
  const m = dugFromRim(w, o);
  if (m >= o.steps.length) {
    // through to the partner's gate: on into its nest, to its dug floor (the breach)
    if (gateConnected(w, o)) return out;
    if (!o.breach) o.breach = planBreach(w, o);
    if (!o.breach) return out;
    for (const q of o.breach) {
      if (og.isHexDug(q)) continue;
      if (og.isHexDiggable(q) && og.neighbors(q).some((k) => k >= 0 && og.isHexDug(k))) out.push({ space: o.space, q, cross: false, route: r.id });
      break;
    }
    return out;
  }
  const step = o.steps[o.steps.length - 1 - m];
  for (const q of step) {
    if (q < 0 || og.isHexDug(q)) continue;
    if (m === 0) out.push({ space: o.space, q, cross: true, route: r.id });
    else if (og.neighbors(q).some((k) => k >= 0 && og.isHexDug(k))) out.push({ space: o.space, q, cross: false, route: r.id });
  }
  return out;
}

/** Is a route hex dug from across the rim? The digger stands in its own rim step at the rim edge (the spot). */
export function crossSpot(w: World, c: Colony, r: TunnelRoute, q: number, a: Ant, out: { x: number; y: number; dir: number }): boolean {
  const own = ownHalf(r, c.id);
  const g = w.nestOf(own?.space ?? -1);
  if (!own || !g) return false;
  const o = otherHalf(r, own);
  const ostep = o.steps[o.steps.length - 1];
  const i = ostep.indexOf(q);
  const step = own.steps[own.steps.length - 1];
  // mirrored place; else the nearest dug hex of its rim step
  let k = Math.min(step.length - 1, Math.max(0, step.length - 1 - i));
  if (!g.isHexDug(step[k])) {
    k = step.findIndex((h) => h >= 0 && g.isHexDug(h));
    if (k < 0) return false;
  }
  const ctr = g.hexCenter(step[k]);
  const ox = dcos(EDGE_ANG[own.dir]);
  const oy = dsin(EDGE_ANG[own.dir]);
  const side = ((a.id % 3) - 1) * g.R * 0.2;
  out.x = ctr.x + ox * g.R * 0.55 - oy * side;
  out.y = ctr.y + oy * g.R * 0.55 + ox * side;
  // the partner hex's entry edge: the one facing the partner's rim (its outward direction)
  out.dir = o.dir;
  return true;
}

/** Set which route a colony digs (−1: none). Marking another pauses the first (its dug hexes stay). */
export function setRouteDig(w: World, c: Colony, id: number): boolean {
  const r = routeById(w, id);
  if (id >= 0 && (!r || !ownHalf(r, c.id) || routeDone(w, r, c.id))) return false;
  c.routeDig = id;
  return true;
}

/** Nothing left for this colony to dig on the route: open, and the partner's gate joined to its floor. */
export function routeDone(w: World, r: TunnelRoute, colony: number): boolean {
  const own = ownHalf(r, colony);
  return r.open && (!own || gateConnected(w, otherHalf(r, own)));
}

/** Route progress 0..1 (both halves' steps dug). */
export function routeProgress(w: World, r: TunnelRoute): number {
  let dug = 0;
  let all = 0;
  for (const h of r.halves) {
    const g = w.nestOf(h.space);
    for (const step of h.steps)
      for (const q of step) {
        if (q < 0) continue;
        all++;
        if (g && g.isHexDug(q)) dug++;
      }
  }
  return all ? dug / all : 0;
}

// ---------------------------------------------------------------------------
// The tick: opening, warnings, crossings
// ---------------------------------------------------------------------------

/** Once a second (registered by mapGen): routes opening, the defender's warning. */
export function tunnelTick(w: World, dt: number): void {
  void dt;
  for (const r of routes(w)) {
    // a gate joining its nest's floor: the breach (the other colony dug in) or the owner's digging reaching its gate
    for (const h of r.halves) {
      if (h.joined || !gateConnected(w, h)) continue;
      h.joined = true;
      const o = otherHalf(r, h);
      const oc = w.colony(o.colony);
      const by = oc && oc.routeDig === r.id && r.open ? o.colony : -1;
      const p = gatePos(w, h);
      w.events.emit({ t: 'tunnelBreach', colony: h.colony, by, route: r.id, space: h.space, x: p.x, y: p.y, open: r.open });
    }
    if (r.open) {
      for (const c of [w.colony(r.a), w.colony(r.b)]) if (c && c.routeDig === r.id && routeDone(w, r, c.id)) c.routeDig = -1;
      continue;
    }
    if (halfThrough(w, r.halves[0]) && halfThrough(w, r.halves[1])) {
      r.open = true;
      r.openT = w.time;
      // (a colony still digging the breach into the other nest digs on)
      for (const c of [w.colony(r.a), w.colony(r.b)]) if (c && c.routeDig === r.id && routeDone(w, r, c.id)) c.routeDig = -1;
      const p0 = gatePos(w, r.halves[0]);
      const p1 = gatePos(w, r.halves[1]);
      w.events.emit({ t: 'tunnelOpen', route: r.id, a: r.a, b: r.b, spaces: [r.halves[0].space, r.halves[1].space], x: [p0.x, p1.x], y: [p0.y, p1.y] });
      for (const flow of [w.flowOf(r.halves[0].space), w.flowOf(r.halves[1].space)]) flow?.invalidate(`route:${r.id}`);
      continue;
    }
    for (const h of r.halves) {
      const o = otherHalf(r, h);
      const oc = w.colony(o.colony);
      const hc = w.colony(h.colony);
      if (!oc || !hc || oc.routeDig !== r.id || !oc.alive) continue;
      if (w.teamOf(o.colony) === w.teamOf(h.colony)) continue; // allies linking up: no alarm
      const left = h.steps.length - dugFromRim(w, h);
      if (left > TUNNELS.warnRange) continue;
      const p = gatePos(w, h);
      if (!h.warned) {
        h.warned = true;
        w.events.emit({ t: 'tunnelWarn', colony: h.colony, by: o.colony, route: r.id, space: h.space, x: p.x, y: p.y, q: h.gate });
      }
      if (Math.floor(w.time) % TUNNELS.warnEvery === 0) w.events.emit({ t: 'tunnelDig', colony: h.colony, route: r.id, space: h.space, x: p.x, y: p.y });
    }
  }
}

/**
 * Every tick (before the ants move): units standing in a rim step and past it toward the rim cross to the other half.
 * An open route carries anyone; a closed one only the units of the colony digging it (its diggers going on inside).
 */
export function crossings(w: World): void {
  const rs = routes(w);
  if (!rs.length) return;
  for (const a of w.s.ants) {
    if (a.space === SURFACE || a.state === AS.Dead) continue;
    const g = w.nestOf(a.space);
    if (!g) continue;
    const id = g.routeOf(g.hexAt(a.x, a.y));
    if (id < 0) continue;
    const r = rs[id];
    const h = halfIn(r, a.space);
    if (!h || !routeUsable(w, r, a.colony)) continue;
    if (crossIfPastRim(w, a, r, h)) a.ent = -2;
  }
  for (const cr of w.s.creatures) {
    if (cr.space === SURFACE || cr.dead) continue;
    const g = w.nestOf(cr.space);
    if (!g) continue;
    const id = g.routeOf(g.hexAt(cr.x, cr.y));
    if (id < 0) continue;
    const r = rs[id];
    const h = halfIn(r, cr.space);
    if (!h || !r.open) continue;
    crossIfPastRim(w, cr as unknown as Creature & { px?: number }, r, h);
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

interface Cand {
  a: number;
  b: number;
  d: number;
}

/** Do segments p1–p2 and p3–p4 cross (sharing an endpoint does not count)? */
function segmentsCross(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }): boolean {
  const o = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(p3, p4, p1);
  const d2 = o(p3, p4, p2);
  const d3 = o(p1, p2, p3);
  const d4 = o(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Generate the routes once the colonies stand (mapGen): `plan` 'auto' (by the number of nests), 'none', or authored
 * pairs of colony ids. Deterministic: geometry and the seed only.
 */
export function generateRoutes(w: World, plan: RoutePlan = 'auto'): void {
  w.s.routes = [];
  if (plan === 'none') return;
  const cols = w.s.colonies.filter((c) => w.nest(c.id));
  if (cols.length < 2) return;
  let cands: Cand[] = [];
  const dist = (a: Colony, b: Colony) => dhypot(a.nx - b.nx, a.ny - b.ny);
  if (plan === 'auto') {
    if (cols.length <= TUNNELS.allPairsMax) {
      for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) cands.push({ a: cols[i].id, b: cols[j].id, d: dist(cols[i], cols[j]) });
    } else {
      const seen = new Set<string>();
      for (const c of cols) {
        const near = cols
          .filter((o) => o !== c)
          .map((o) => ({ o, d: dist(c, o) }))
          .sort((p, q) => p.d - q.d || p.o.id - q.o.id)
          .slice(0, TUNNELS.neighbours);
        for (const { o, d } of near) {
          const key = Math.min(c.id, o.id) + ':' + Math.max(c.id, o.id);
          if (seen.has(key)) continue;
          seen.add(key);
          cands.push({ a: Math.min(c.id, o.id), b: Math.max(c.id, o.id), d });
        }
      }
    }
  } else {
    for (const [a, b] of plan) {
      const ca = w.colony(a);
      const cb = w.colony(b);
      if (ca && cb && a !== b && w.nest(a) && w.nest(b)) cands.push({ a, b, d: dist(ca, cb) });
    }
  }
  cands.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
  const accepted: TunnelRoute[] = [];
  const gates = new Map<number, number[]>(); // colony → its gate hexes
  for (const cd of cands) {
    const ca = w.colony(cd.a)!;
    const cb = w.colony(cd.b)!;
    const pt = (c: Colony) => ({ x: c.nx, y: c.ny });
    // (a big map: no route crosses another; a small one takes every pair — the halves lie in separate grids, so a
    // crossing is only a line on the surface plan)
    if (plan === 'auto' && cols.length > TUNNELS.allPairsMax && accepted.some((r) => segmentsCross(pt(ca), pt(cb), pt(w.colony(r.a)!), pt(w.colony(r.b)!)))) continue;
    const ha = layHalf(w, ca, cb, accepted.length, gates.get(ca.id) ?? []);
    if (!ha) continue;
    const hb = layHalf(w, cb, ca, accepted.length, gates.get(cb.id) ?? []);
    if (!hb) continue;
    const r: TunnelRoute = { id: accepted.length, a: ca.id, b: cb.id, open: false, openT: -1, halves: [ha, hb] };
    accepted.push(r);
    // (tagged now, so the next half of this nest keeps clear of it)
    for (const h of r.halves) w.nestOf(h.space)!.layRoute(r.id, h.gate, h.steps.slice(1).flat().filter((q) => q >= 0));
    gates.set(ca.id, [...(gates.get(ca.id) ?? []), ha.gate]);
    gates.set(cb.id, [...(gates.get(cb.id) ?? []), hb.gate]);
  }
  w.s.routes = accepted;
}

/**
 * Plan colony `c`'s half of a route toward `o`: the gate on its interior's edge facing `o`, away from the flower and
 * other gates, then the path through the margin to the rim: step by step the margin hex nearest a point ahead (the
 * route's direction, with a sine wobble of TUNNELS.wobble hexes to the side), until a rim hex; each step the centre
 * hex and its two side neighbours. Undefined when no gate fits.
 */
function layHalf(w: World, c: Colony, o: Colony, id: number, taken: readonly number[]): RouteHalf | undefined {
  const g = w.nest(c.id)!;
  const space = nestSpace(c.id);
  const bx = o.nx - c.nx;
  const by = o.ny - c.ny;
  const bl = dhypot(bx, by) || 1;
  const ux = bx / bl;
  const uy = by / bl;
  const cx = g.widthMm / 2;
  const cy = g.depthMm / 2;
  const flower = g.flowers[0] ?? [];
  // the gate: the interior edge hex whose direction from the nest's centre best matches the bearing
  let gate = -1;
  let best = -Infinity;
  for (let q = 0; q < g.cols * g.rows; q++) {
    if (!g.isInteriorEdge(q) || g.hexRoute[q]) continue;
    if (flower.some((f) => g.hexDistance(f, q) < TUNNELS.gateAway)) continue;
    if (taken.some((t) => g.hexDistance(t, q) < TUNNELS.gateGap)) continue;
    const p = g.hexCenter(q);
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dl = dhypot(dx, dy) || 1;
    const dot = (dx * ux + dy * uy) / dl;
    if (dot > best) {
      best = dot;
      gate = q;
    }
  }
  if (gate < 0 || best < 0.5) return undefined;
  // the path: the centreline outward from the gate through the margin hexes to the rim
  const centres: number[] = [];
  const gp = g.hexCenter(gate);
  let cur = gate;
  let dir = -1;
  for (let i = 0; i < TUNNELS.margin * 3; i++) {
    const n = i + 1;
    const wob = dsin(n * 0.9 + hash01(id * 7 + c.id, 3) * 6.28) * TUNNELS.wobble * g.H;
    const tx = gp.x + ux * n * g.H * 1.1 - uy * wob;
    const ty = gp.y + uy * n * g.H * 1.1 + ux * wob;
    const nb = g.neighbors(cur);
    let pick = -1;
    let pd = -1;
    let bd = Infinity;
    for (let d = 0; d < 6; d++) {
      const m = nb[d];
      if (m < 0 || g.isInterior(m) || centres.includes(m) || g.hexRoute[m]) continue;
      const p = g.hexCenter(m);
      const dd = dhypot(p.x - tx, p.y - ty);
      if (dd < bd) {
        bd = dd;
        pick = m;
        pd = d;
      }
    }
    if (pick < 0) break;
    centres.push(pick);
    cur = pick;
    dir = pd;
    if (g.isRim(pick)) break;
  }
  // the band: every margin hex within a step of the centreline, each in the step of the first centre it touches
  // (three hexes wide, no holes where the path bends)
  const steps: number[][] = [[gate]];
  const taken2 = new Set<number>([gate]);
  for (const ctr of centres) {
    const step = [ctr];
    taken2.add(ctr);
    for (const m of g.neighbors(ctr)) {
      if (m < 0 || g.isInterior(m) || g.hexRoute[m] || taken2.has(m) || centres.includes(m)) continue;
      taken2.add(m);
      step.push(m);
    }
    steps.push(step);
  }
  // no rock pockets: a margin rock hex with four or more of the band round it joins the step of the first of them
  for (let pass = 0; pass < 2; pass++)
    for (let q = 0; q < g.cols * g.rows; q++) {
      if (g.isInterior(q) || taken2.has(q) || g.hexRoute[q]) continue;
      const nbs = g.neighbors(q).filter((m) => m >= 0 && taken2.has(m));
      if (nbs.length < 4) continue;
      const si = steps.findIndex((st) => st.includes(nbs[0]));
      if (si < 0) continue;
      steps[si].push(q);
      taken2.add(q);
    }
  if (steps.length < 2 || !g.isRim(cur) || dir < 0) return undefined;
  // the outward direction at the rim: the rim edge nearest the walking direction
  let outDir = dir;
  if (g.neighbor(cur, dir) >= 0) {
    for (const d of [dir, (dir + 1) % 6, (dir + 5) % 6, (dir + 2) % 6, (dir + 4) % 6]) if (g.neighbor(cur, d) < 0) {
      outDir = d;
      break;
    }
  }
  return { colony: c.id, space, gate, steps, dir: outDir, warned: false };
}

/**
 * Saves from before the shared underground (SimState.version < 4; CHANGE_PLAN §27): every colony nest grid gets its rock
 * margin — the old grid embedded in a larger one, every hex index and position in that space shifted by the margin —
 * and the routes are generated afresh, all closed. Idempotent: grids that have a margin are left alone.
 */
export function upgradeWorldTunnels(w: World): void {
  const m = TUNNELS.margin;
  let changed = false;
  for (const c of w.s.colonies) {
    const space = nestSpace(c.id);
    const g = w.nest(c.id);
    if (!g || g.margin) continue;
    const ng = g.embed(m);
    const off = g.embedOffset(m);
    const sh = (q: number) => (q < 0 ? q : ng.hexIndex(g.hexCol(q) + m, g.hexRow(q) + m));
    for (const t of c.tiles) t.q = sh(t.q);
    for (const e of c.entrances) e.q = sh(e.q);
    c.hexSpeed = null;
    if (c.aiBuild) {
      for (const ch of c.aiBuild.chambers ?? []) ch.q = sh(ch.q);
      if (c.aiBuild.tunnels) c.aiBuild.tunnels = c.aiBuild.tunnels.map(sh);
    }
    for (const mk of c.markers) if (mk.placed && mk.space === space) ((mk.x += off.x), (mk.y += off.y));
    for (const p of c.intruders ?? []) ((p.x += off.x), (p.y += off.y));
    for (const a of w.s.ants) {
      if (a.colony === c.id) {
        a.tile = sh(a.tile);
        if (a.jobS === undefined) a.jobQ = sh(a.jobQ);
      }
      if (a.space === space) ((a.x += off.x), (a.y += off.y), (a.px += off.x), (a.py += off.y));
    }
    for (const b of w.s.brood) if (b.colony === c.id) ((b.tile = sh(b.tile)), (b.x += off.x), (b.y += off.y));
    for (const f of w.s.food) if (f.space === space) ((f.x += off.x), (f.y += off.y), (f.px += off.x), (f.py += off.y));
    for (const cr of w.s.creatures) if (cr.space === space) ((cr.x += off.x), (cr.y += off.y), (cr.px += off.x), (cr.py += off.y));
    w.replaceGrid(space, ng);
    changed = true;
  }
  if (!w.s.routes) {
    const mode = w.s.mode as { mission?: { story?: unknown } };
    generateRoutes(w, mode.mission?.story ? 'none' : 'auto');
    changed = true;
  }
  if (changed) w.events.emit({ t: 'message', text: 'Old save: the nests gained their rock margins and tunnel routes (all closed).', kind: 'info' });
}

export { colonyOfSpace };
