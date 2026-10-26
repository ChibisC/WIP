import { ENTRANCE } from './balance';
import { makeEntrance } from './entrances';
import { World } from './world';
import { NestGrid, hexRadiusFor } from '../world/nestGrid';
import { AS, CAVE_BASE, CaveDef, Colony, SURFACE, colonyOfSpace, isCaveSpace, nestSpace } from './types';
import { BALANCE } from './balance';
import { killAnt } from './antAI';
import { exitFieldIn } from './movement';
import { makeFood } from './factory';
import { Rng } from '../core/rng';
import { dcos, dsin } from './dmath';

/**
 * Underground areas (Revision 2, DESIGN 3.12). A level has one surface and up
 * to six underground areas, each its own hex map joined to the surface only
 * by entrances: the player's home nest (always area 1), enemy nests, allied
 * nests and neutral caves or lairs. Areas are numbered and coloured from the
 * viewing colony's point of view.
 *
 * Access rule (EotU): an area's tab opens only while the viewer's ants, or
 * allied ants, are inside it. Home is always open; the sandbox setting
 * "reveal all underground areas" opens every tab.
 */

export const MAX_AREAS = 8;
/** Area colours by number 1..8 (home is 1; up to seven nests and a cave). */
export const AREA_COLORS = ['#d9a441', '#d0554a', '#5b8ed6', '#a874d8', '#4fb595', '#e0873c', '#c4b85a', '#d470a8'];

export type AreaKind = 'home' | 'enemy' | 'allied' | 'neutral';

export interface AreaInfo {
  space: number;
  /** 1..6 */
  number: number;
  color: string;
  kind: AreaKind;
  name: string;
  /** owning colony id, −1 for caves */
  owner: number;
  /** false once an owning colony has fallen */
  alive: boolean;
}

/** The areas of the level as one colony sees them: home first, then in level order. */
export function areasFor(w: World, colonyId: number): AreaInfo[] {
  const me = w.colony(colonyId);
  const home = nestSpace(colonyId);
  const spaces = w.undergroundSpaces();
  const order = spaces.includes(home) ? [home, ...spaces.filter((s) => s !== home)] : spaces;
  return order.slice(0, MAX_AREAS).map((space, i) => {
    const owner = colonyOfSpace(space);
    const oc = w.colony(owner);
    let kind: AreaKind = 'neutral';
    let name = w.cave(space)?.name ?? 'Cave';
    if (space === home) {
      kind = 'home';
      name = 'Your nest';
    } else if (oc) {
      kind = me && oc.team === me.team ? 'allied' : 'enemy';
      name = `${kind === 'allied' ? 'Allied' : 'Enemy'} nest · ${oc.name}`;
    }
    return { space, number: i + 1, color: AREA_COLORS[i], kind, name, owner: oc ? oc.id : -1, alive: oc ? oc.alive : true };
  });
}

/** Live ants (and allied creatures) of a team in each space. */
export function teamPresence(w: World, team: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const a of w.s.ants) {
    if (a.state === AS.Dead || a.space === SURFACE) continue;
    if ((a.team ?? a.colony) !== team) continue;
    out.set(a.space, (out.get(a.space) ?? 0) + 1);
  }
  for (const cr of w.s.creatures) {
    if (cr.dead || cr.space === SURFACE || cr.faction < 0 || w.teamOf(cr.faction) !== team) continue;
    out.set(cr.space, (out.get(cr.space) ?? 0) + 1);
  }
  return out;
}

/** Can the colony's player look into this area right now? `reveal` is the viewer's sandbox setting (client-side, not simulation state). */
export function areaOpen(w: World, c: Colony, space: number, presence?: Map<number, number>, reveal = false): boolean {
  if (space === nestSpace(c.id) || reveal) return true;
  return ((presence ?? teamPresence(w, c.team)).get(space) ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// "No route home" (EotU): ants cut off from their queen weaken and die
// ---------------------------------------------------------------------------

/**
 * Does this ant still have a way back to its own queen? Lost when its colony
 * has fallen, when it stands outside with no entrance to go home by, or when
 * it is underground somewhere with no path to any exit.
 */
export function hasRouteHome(w: World, a: { colony: number; space: number; x: number; y: number }): boolean {
  const c = w.colony(a.colony);
  if (!c || !c.alive) return false;
  const home = nestSpace(c.id);
  if (a.space === home) return true;
  if (!c.entrances.length) return false;
  if (a.space === SURFACE) return true;
  const flow = w.flowOf(a.space);
  const f = exitFieldIn(w, a.space);
  if (!flow || !f) return false;
  return flow.distAt(f, a.x, a.y) < Infinity;
}

/** Once a second: lost ants lose health so that they die after BALANCE.lostDeathTime. */
export function lostRouteSystem(w: World, dt: number): void {
  // battle arena: the teams never go home, and nobody is cut off (sim/arena.ts)
  if (w.s.mode.arena) return;
  for (const a of w.s.ants) {
    if (a.state === AS.Dead) continue;
    const c = w.colony(a.colony);
    if (c && a.id === c.queen) continue;
    if (hasRouteHome(w, a)) {
      a.lostT = 0;
      continue;
    }
    a.lostT = (a.lostT ?? 0) + dt;
    a.hp -= (a.maxHp * dt) / BALANCE.lostDeathTime;
    if (a.hp <= 0 || a.lostT >= BALANCE.lostDeathTime) killAnt(w, a);
  }
}

// ---------------------------------------------------------------------------
// Neutral caves and lairs
// ---------------------------------------------------------------------------

export interface CaveOptions {
  name: string;
  kind: 'cave' | 'lair';
  /** surface position of the entrance hole */
  at: { x: number; y: number };
  /** cavern radius in hexes */
  size?: number;
  /** food units scattered on the floor */
  food?: number;
  /** hex radius (defaults to the size used for a 4 mm worker) */
  R?: number;
}

/**
 * A pre-dug cavern joined to the surface by one entrance ramp: a food cache
 * in a hollow under a root, or a creature's den (lairs get their occupant in
 * the creatures phase). Returns the cave's space id.
 */
export function createCave(w: World, o: CaveOptions): number {
  const space = CAVE_BASE + w.s.caves.length;
  const rng = new Rng(w.s.seed * 7 + space * 131);
  const cols = 26;
  const rows = 22;
  const g = new NestGrid({ cols, rows, R: o.R ?? hexRadiusFor(4), seed: w.s.seed * 17 + space * 53 });
  const q0 = g.hexIndex(Math.floor(cols / 2) + rng.int(-1, 1), Math.floor(rows / 2) + 1);
  const size = o.size ?? 3;
  // An irregular cavern: hexes within `size` of the centre, the rim nibbled by noise,
  // plus a couple of side pockets.
  const dug = new Set<number>();
  for (let q = 0; q < cols * rows; q++) {
    const d = g.hexDistance(q, q0);
    if (d <= size - 1 || (d === size && rng.chance(0.55))) dug.add(q);
  }
  for (let k = 0; k < 2; k++) {
    let cur = q0;
    const dir = rng.int(0, 5);
    for (let i = 0; i < size + 2; i++) {
      const n = g.neighbors(cur)[(dir + (rng.chance(0.3) ? rng.int(-1, 1) + 6 : 0)) % 6];
      if (n < 0) break;
      cur = n;
      dug.add(n);
    }
  }
  // Tunnel north to the entrance ramp.
  let cur = q0;
  const path: number[] = [];
  for (const d of [5, 5, 0, 5, 4, 5, 5, 5, 0, 5]) {
    const n = g.neighbors(cur)[d];
    if (n < 0) break;
    cur = n;
    path.push(n);
  }
  const entQ = path[path.length - 1];
  for (const q of [...dug, ...path]) {
    g.softenHex(q);
    g.completeHex(q);
  }
  g.addEntrance(path.slice(-ENTRANCE.tunnelLen).reverse());
  w.addGrid(space, g);
  const def: CaveDef = { space, name: o.name, kind: o.kind, entrances: [makeEntrance(entQ, o.at.x, o.at.y, w.time)], nx: o.at.x, ny: o.at.y + 20 };
  w.s.caves.push(def);
  // Food on the cavern floor: a seed cache, and a dead insect or two.
  let left = o.food ?? (o.kind === 'cave' ? 60 : 40);
  const ctr = g.hexCenter(q0);
  const spot = () => {
    for (let i = 0; i < 30; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * g.R * size * 1.4;
      const x = ctr.x + dcos(ang) * r;
      const y = ctr.y + dsin(ang) * r;
      if (g.isAirAt(x, y)) return { x, y };
    }
    return { x: ctr.x, y: ctr.y };
  };
  let guard = 0;
  while (left > 0 && guard++ < 200) {
    const p = spot();
    if (o.kind === 'lair' || rng.chance(0.25)) {
      const f = makeFood(w, 'insect', space, p.x, p.y, rng.range(0.9, 1.5), rng.pick(['cricket', 'beetle', 'moth']));
      left -= f.amount;
    } else {
      for (let i = 0; i < 4 && left > 0; i++) {
        const f = makeFood(w, 'seed', space, p.x + rng.range(-3, 3), p.y + rng.range(-3, 3), rng.range(0.8, 1.2));
        left -= f.amount;
      }
    }
  }
  return space;
}

export { isCaveSpace };
