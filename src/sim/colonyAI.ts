import { World } from './world';
import { AphidCluster, AS, Colony, SURFACE, TileType } from './types';
import { CASTES, basicCaste, casteOf, isTermiteSpecies, tierOf } from './species';
import { designateDig } from './colony';
import type { NestGrid } from '../world/nestGrid';
import { MAX_TILE_LEVEL, buildableTiles, canPlaceTile, hatchCost, markUpgrade, placeTile, popUsed, raisesAnts, tileAnts, tileAt, tileCapacity, tileCost, upgradeCost, upgradeNeed, upgradePoints } from './tiles';
import { JOB, listJobs } from './jobs';
import { assignGroup, markerRadius, placeMarker, removeMarker } from './markers';
import { creatureHooks } from './combat';
import { BALANCE, ECITON, NASUTE, SICKLE } from './balance';
import { groupCounts } from './tiles';
import { dhypot, dsin, sq } from './dmath';
import { edible } from './diet';
import { termantAI, woodWant } from './termants';

/**
 * The nest builder: digs and places tiles the way a steady player would.
 * Drives every AI colony (rivals grow their nests), and the growth harness
 * that tunes the economy. Combat and marker decisions live elsewhere.
 *
 * Every couple of seconds it (CHANGE_PLAN §23; first version 2026-10-25):
 *  1. digs the nest EotU-style: chambers of 7 hexes (a centre and its ring) or,
 *     from mid game, 19 (two rings) for its main castes and leafcutter fungus,
 *     each in solid soil walled off from the others and joined to the nest by a
 *     tunnel; each holds ONE tile type (brood: one caste), so each is one
 *     commandable group; the next chamber is planned for whatever the last
 *     think had no room for (or whose rooms are nearly full); at most two food
 *     store chambers, beside the entrance;
 *  2. spends food, one tile at a time, in priority order, in its own room from
 *     the centre outward:
 *     - a food store when the stores are nearly full (income would be wasted);
 *     - a species special tile when below its share (pastures, thatch, fungus);
 *     - a brood tile of the caste furthest below the target mix, but only when
 *       the colony can also pay to raise its ant and few tiles are still empty;
 *  3. lays highways on the tunnels (the entrance passage and the stores' first);
 *  4. from mid game, upgrades tiles that have the points (`BALANCE.aiBuild`).
 */

const THINK_EVERY = 2; // seconds

export type BuildBrain = NonNullable<Colony['aiBuild']>;
type Chamber = NonNullable<BuildBrain['chambers']>[number];
type Need = { type: TileType; caste?: string };

/** Target caste mix by species (fractions of brood tiles). */
export function defaultMix(c: Colony): Record<string, number> {
  switch (c.species) {
    case 'lasius':
      return { lasius_worker: 0.85, lasius_soldier: 0.15 };
    case 'formica':
      return { formica_worker: 0.6, formica_soldier: 0.14, formica_mortar: 0.13, formica_rapid: 0.13 };
    case 'atta':
      return { atta_minim: 0.22, atta_media: 0.5, atta_soldier: 0.18, atta_major: 0.1 };
    case 'solenopsis':
      return { fire_minor: 0.68, fire_soldier: 0.22, fire_major: 0.1 };
    case 'eciton':
      // Soldiers early enough to guard the raid trail (ECITON.guard.minMajors), porters for the big prey
      return { eciton_minor: 0.6, eciton_submajor: 0.18, eciton_media: 0.1, eciton_major: 0.12 };
    case 'nasutitermes':
      // N. corniger: about 20 % soldiers, three nasutes to each major
      return { nasute_worker: 0.8, nasute_soldier: 0.15, nasute_major: 0.05 };
    case 'rhynchotermes':
      // SICKLE.ai.soldierFraction
      return { rhy_worker: 1 - SICKLE.ai.soldierFraction, rhy_soldier: SICKLE.ai.soldierFraction };
    case 'hell':
      return { hell_worker: 0.78, hell_soldier: 0.22 };
    case 'aurimyrmex':
      return { aurimyrmex_worker: 0.78, aurimyrmex_soldier: 0.22 };
    case 'termant': {
      // Termants: workers and soldiers, plus an even share of every caste stolen so far (termants.ts)
      const stolen = c.castes.filter((cs) => CASTES[cs].species !== 'termant');
      const m: Record<string, number> = { termant_worker: stolen.length ? 0.6 : 0.82, termant_soldier: stolen.length ? 0.12 : 0.18 };
      for (const cs of stolen) m[cs] = 0.28 / stolen.length;
      return m;
    }
    case 'plagiaria': {
      // Mimic Ant: its own workers plus an even share of every borrowed caste.
      const borrowed = c.castes.filter((cs) => cs !== 'plagiaria_worker' && CASTES[cs].role !== 'queen');
      const m: Record<string, number> = { plagiaria_worker: borrowed.length ? 0.5 : 1 };
      for (const cs of borrowed) m[cs] = 0.5 / borrowed.length;
      return m;
    }
  }
  return { [c.castes[0]]: 1 };
}

/** Special tiles: how many per brood tile, and a cap. */
function specialTargets(c: Colony, broodTiles: number, counts: Record<string, number>): Array<{ type: TileType; want: number }> {
  const out: Array<{ type: TileType; want: number }> = [];
  const can = new Set(buildableTiles(c).map((b) => b.type));
  if (can.has('aphid')) out.push({ type: 'aphid', want: Math.min(8, Math.floor(broodTiles / 10)) });
  if (can.has('thatch')) out.push({ type: 'thatch', want: Math.min(8, Math.floor(broodTiles / 9)) });
  if (can.has('mound')) out.push({ type: 'mound', want: Math.min(8, Math.floor(broodTiles / 8)) });
  if (can.has('fungus')) {
    const leafers = (counts.atta_media ?? 0) + (counts.atta_minim ?? 0);
    out.push({ type: 'fungus', want: Math.min(10, 1 + Math.floor(leafers / 6)) });
  }
  return out;
}

/** The build planner's memory lives on the colony (simulation state), never in a side table. */
export function brainOf(c: Colony): BuildBrain {
  if (!c.aiBuild) c.aiBuild = { t: (c.id * 0.37) % THINK_EVERY, blocked: false, mix: defaultMix(c) };
  return c.aiBuild;
}

/** The colony's centre hex: the chamber tile whose neighbours are all chamber tiles. */
function homeHex(w: World, c: Colony): number {
  const g = w.nest(c.id)!;
  const qs = new Set(c.tiles.filter((t) => t.type === 'queen').map((t) => t.q));
  for (const q of qs) if (g.neighbors(q).every((n) => qs.has(n))) return q;
  return c.tiles[0]?.q ?? 0;
}

/** Deterministic per-hex jitter so ties break the same way every run. */
function jitter(q: number): number {
  const s = dsin(q * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------------------
// Chambers (CHANGE_PLAN §23): a 7-hex rosette (radius 1) or a 19-hex hexagon (radius 2), one tile type each
// ---------------------------------------------------------------------------

/** The AI level (settings.aiLevel): 0 Easy … 3 Brutal, 1 by default. */
function aiLevel(w: World): number {
  return Math.max(0, Math.min(3, Math.round(w.s.settings.aiLevel ?? 1)));
}

function chType(ch: Chamber): TileType {
  return ch.type ?? (ch.kind === 'food' ? 'food' : 'brood');
}
function chR(ch: Chamber): number {
  return ch.r ?? 1;
}

/** Hexes within r steps of q: the centre, then ring by ring (each ring in index order). */
function disc(g: NestGrid, q: number, r: number): number[] {
  const out = [q];
  const seen = new Set<number>([q]);
  let ring = [q];
  for (let k = 0; k < r; k++) {
    const next: number[] = [];
    for (const h of ring)
      for (const n of g.neighbors(h))
        if (n >= 0 && !seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
    next.sort((a, z) => a - z);
    out.push(...next);
    ring = next;
  }
  return out;
}

/** Does chamber ch hold tiles of this type (and caste)? Old saves' brood chambers take any caste. */
function holds(ch: Chamber, type: TileType, caste?: string): boolean {
  return chType(ch) === type && (type !== 'brood' || ch.caste === undefined || ch.caste === caste);
}

/** The founding ring round the queen's chamber (the starting floor): the colony's first worker room. */
function founding(c: Colony, home: number): Chamber {
  return { q: home, r: 2, type: 'brood', caste: basicCaste(c.species) };
}

/** The rooms that take a tile of this type (and caste): the founding ring for the first workers, then the chambers. */
function roomsFor(c: Colony, b: BuildBrain, home: number, type: TileType, caste?: string): Chamber[] {
  const out: Chamber[] = [];
  const f = founding(c, home);
  if (holds(f, type, caste)) out.push(f);
  for (const ch of b.chambers ?? []) if (holds(ch, type, caste)) out.push(ch);
  return out;
}

/** Free floor of a room, from its centre outward (inner tiles get the most upgrade points). */
function freeIn(g: NestGrid, ch: Chamber, occupied: Set<number>): number[] {
  return disc(g, ch.q, chR(ch)).filter((q) => g.isHexDug(q) && !g.isEntrance(q) && !occupied.has(q));
}

/** Free and still-to-dig floor of the rooms for a tile type (caste). */
function roomFor(g: NestGrid, rooms: Chamber[], occupied: Set<number>): { free: number; coming: number } {
  let free = 0;
  let coming = 0;
  for (const ch of rooms)
    for (const q of disc(g, ch.q, chR(ch))) {
      if (occupied.has(q) || g.isEntrance(q)) continue;
      if (g.isHexDug(q)) free++;
      else if (g.isHexDiggable(q)) coming++;
    }
  return { free, coming };
}

/** Food store chambers so far. */
function storeChambers(b: BuildBrain): number {
  return (b.chambers ?? []).filter((ch) => chType(ch) === 'food').length;
}

/** The colony's mid game (× the level): 19-hex chambers and upgrades start. */
function midGame(w: World, c: Colony, from: { ants: number; time: number }): boolean {
  const k = BALANCE.aiBuild.levelFrom[aiLevel(w)];
  return c.living >= from.ants * k && w.s.time >= from.time * k;
}

/** One of the colony's main castes (workers for the economy, its main fighter for war): 19-hex chambers. */
function mainCaste(c: Colony, b: BuildBrain, caste: string): boolean {
  const share = b.mix[caste] ?? 0;
  if (share < BALANCE.aiBuild.mainShare || CASTES[caste].species !== CASTES[basicCaste(c.species)].species) return false;
  // the biggest share among its own kind (workers, or fighters)
  const fight = isFighter(caste);
  for (const [cs, f] of Object.entries(b.mix)) if (cs !== caste && isFighter(cs) === fight && c.castes.includes(cs) && f > share) return false;
  return true;
}

/** How big the next chamber for this tile is: 19 hexes for the main castes (and leafcutter fungus) from mid game. */
function chamberRadius(w: World, c: Colony, b: BuildBrain, need: Need): number {
  const A = BALANCE.aiBuild;
  if (!midGame(w, c, A.chamber19From)) return 1;
  if (need.type === 'fungus') return 2;
  if (need.type === 'food') return storeChambers(b) >= 1 && (c.species === 'atta' || c.living >= A.bigColony) ? 2 : 1;
  if (need.type === 'brood' && need.caste) return mainCaste(c, b, need.caste) ? 2 : 1;
  return 1;
}

/** Hexes of the planned tunnels and chambers (tunnels, then each room). */
function planned(g: NestGrid, b: BuildBrain): number[] {
  const out: number[] = [...(b.tunnels ?? [])];
  for (const ch of b.chambers ?? []) out.push(...disc(g, ch.q, chR(ch)));
  return out;
}

/**
 * The planned hexes still to dig, in digging order: outward from the dug nest (a hex is dug only from a dug neighbour,
 * so the ones touching dug floor first, then theirs…), any the walk cannot reach last.
 */
function digOrder(g: NestGrid, b: BuildBrain): number[] {
  const todo = planned(g, b).filter((q) => g.isHexDiggable(q));
  const left = new Set(todo);
  const out: number[] = [];
  let ring = todo.filter((q) => g.neighbors(q).some((n) => n >= 0 && g.isHexDug(n)));
  for (const q of ring) left.delete(q);
  while (ring.length) {
    out.push(...ring);
    const next: number[] = [];
    for (const q of ring)
      for (const n of g.neighbors(q))
        if (n >= 0 && left.has(n)) {
          left.delete(n);
          next.push(n);
        }
    ring = next;
  }
  for (const q of todo) if (left.has(q)) out.push(q);
  return out;
}

/** Every entrance hex of the nest (today's ramps; the 7-hex flower after the entrance rework). */
function entranceHexes(g: NestGrid): number[] {
  const out: number[] = [];
  for (let q = 0; q < g.cols * g.rows; q++) if (g.isEntrance(q)) out.push(q);
  return out;
}

/**
 * Plan the next chamber, for `need`: a rosette (7) or hexagon (19) of solid soil, walled off from every other room by
 * at least `rimGapMin` hexes of soil and no more than `rimGapMax` from the nearest, and the shortest tunnel to it from
 * the dug nest (never through another room, never beside an entrance). Stores go within `storeNearEntrance` of the
 * entrance. Deterministic: candidates by distance, ties by hex jitter.
 */
function planChamber(w: World, c: Colony, b: BuildBrain, home: number, need: Need): boolean {
  const A = BALANCE.aiBuild;
  const g = w.nest(c.id)!;
  const N = g.cols * g.rows;
  const store = need.type === 'food';
  if (store && storeChambers(b) >= A.maxStoreChambers) return false;
  const r = chamberRadius(w, c, b, need);
  const size = 1 + 3 * r * (r + 1);
  const rooms: Chamber[] = [{ q: home, r: 2 }, ...(b.chambers ?? [])];
  const tunnels = b.tunnels ?? (b.tunnels = []);
  const ents = entranceHexes(g);
  const nearEnt = new Set<number>();
  for (const e of ents) for (const n of g.neighbors(e)) if (n >= 0 && !g.isEntrance(n)) nearEnt.add(n);
  const ok = (q: number, hs: number[]) => {
    if (hs.length !== size || hs.some((h) => !g.isHexDiggable(h) || g.isEntrance(h) || nearEnt.has(h))) return false;
    // carved out of solid soil, with a wall of soil all round (the tunnel will cut through it)
    for (const h of hs) for (const n of g.neighbors(h)) if (n < 0 || g.isHexDug(n)) return false;
    for (const t of c.tiles) if (hs.includes(t.q)) return false;
    return true;
  };
  const cands: Array<{ q: number; s: number }> = [];
  for (let q = 0; q < N; q++) {
    let near = Infinity;
    let tooClose = false;
    for (const ch of rooms) {
      const gap = g.hexDistance(q, ch.q) - r - chR(ch);
      if (gap < A.rimGapMin) tooClose = true;
      near = Math.min(near, gap);
    }
    if (tooClose || near > A.rimGapMax) continue;
    let ent = Infinity;
    if (store) {
      for (const e of ents) ent = Math.min(ent, g.hexDistance(q, e) - r);
      if (ent > A.storeNearEntrance) continue;
    }
    const hs = disc(g, q, r);
    if (!ok(q, hs)) continue;
    // stores beside the entrance (foragers drop food quickly); the rest close to the queen and the other rooms
    cands.push({ q, s: (store ? ent : g.hexDistance(q, home)) + near * 0.5 + jitter(q) * 0.7 });
  }
  cands.sort((x, z) => x.s - z.s);
  // (a tunnel may open into the founding ring or a passage, never into another chamber)
  const blocked = new Set<number>();
  for (const ch of b.chambers ?? []) for (const h of disc(g, ch.q, chR(ch))) blocked.add(h);
  // every candidate's tunnel (the nearest by score first); the best of score + tunnel length wins
  const prev = new Int32Array(N);
  let pick: { q: number; path: number[]; s: number } | null = null;
  for (const cand of cands.slice(0, A.planTries)) {
    if (pick && cand.s >= pick.s) break; // (a tunnel only adds: nothing later can beat it)
    const best = cand.q;
    // tunnel: breadth-first from the room's rim through soil to the dug nest (not through other rooms or past an entrance)
    const room = new Set(disc(g, best, r));
    prev.fill(-2);
    const queue: number[] = [];
    for (const h of room) {
      prev[h] = -1;
      queue.push(h);
    }
    let hit = -1;
    for (let i = 0; i < queue.length && hit < 0; i++) {
      const q = queue[i];
      for (const n of g.neighbors(q)) {
        if (n < 0 || prev[n] !== -2 || blocked.has(n)) continue;
        if (g.isHexDug(n) && !room.has(n)) {
          if (g.isEntrance(n)) continue;
          prev[n] = q;
          hit = n;
          break;
        }
        if (!g.isHexDiggable(n) || g.isEntrance(n) || nearEnt.has(n)) continue;
        prev[n] = q;
        queue.push(n);
      }
    }
    if (hit < 0) continue;
    const path: number[] = [];
    for (let q = prev[hit]; q >= 0 && !room.has(q); q = prev[q]) path.push(q);
    if (path.length < 1 || path.length > A.tunnelMax) continue; // a tunnel, with a wall of soil beside it
    const s = cand.s + path.length * A.tunnelWeight;
    if (!pick || s < pick.s) pick = { q: best, path, s };
  }
  if (!pick) return false;
  (b.chambers ?? (b.chambers = [])).push(need.type === 'brood' ? { q: pick.q, r, type: 'brood', caste: need.caste } : { q: pick.q, r, type: need.type });
  for (const q of pick.path) if (!tunnels.includes(q)) tunnels.push(q);
  return true;
}

function isFighter(cs: string): boolean {
  const r = CASTES[cs].role;
  return r === 'soldier' || r === 'major';
}

/**
 * A developed AI colony's head start (colony.ts `developNest`: rivals' and tests' grown colonies), laid out the way its
 * builder lays a nest out: workers in the founding ring, then the stores and every other caste each in a chamber of its
 * own, planned like the builder's, dug and filled at once (centre out). Tiles that find no room are left out.
 */
export function developChambers(w: World, c: Colony, plan: Array<{ type: TileType; caste?: string }>): void {
  const g = w.nest(c.id)!;
  const b = brainOf(c);
  const home = homeHex(w, c);
  const occupied = new Set(c.tiles.map((t) => t.q));
  const dig = (q: number) => {
    if (!g.isHexDug(q) && g.isHexDiggable(q) && !g.isEntrance(q)) g.completeHex(q);
  };
  const basic = basicCaste(c.species);
  const first = (p: { type: TileType; caste?: string }) => (p.type === 'brood' && p.caste === basic ? 0 : p.type === 'food' ? 1 : 2);
  const order = [...plan].sort((p, q) => first(p) - first(q));
  for (const p of order) {
    if (p.type === 'brood' && popUsed(c) + 1 > c.popLimit) continue;
    let at = -1;
    for (let pass = 0; pass < 2 && at < 0; pass++) {
      for (const ch of roomsFor(c, b, home, p.type, p.caste)) {
        for (const h of disc(g, ch.q, chR(ch))) {
          if (occupied.has(h) || g.isEntrance(h)) continue;
          dig(h);
          // (a head start is free: placed instant, so not refused for its cost the way canPlaceTile would)
          if (g.isHexDug(h)) {
            at = h;
            break;
          }
        }
        if (at >= 0) break;
      }
      // no room: the next chamber for it, dug at once with its tunnel (the whole room, so the tunnel reaches its floor)
      if (at < 0 && pass === 0) {
        if (!planChamber(w, c, b, home, { type: p.type, caste: p.caste })) break;
        const ch = b.chambers![b.chambers!.length - 1];
        for (const h of [...(b.tunnels ?? []), ...disc(g, ch.q, chR(ch))]) dig(h);
      }
    }
    if (at < 0 || !placeTile(w, c, p.type, at, p.caste, true)) continue;
    occupied.add(at);
  }
}

/** Put one tile in its own kind of room, from the room's centre outward. False when no room has a free hex. */
function place(w: World, c: Colony, b: BuildBrain, home: number, occupied: Set<number>, type: TileType, caste?: string): boolean {
  const g = w.nest(c.id)!;
  for (const ch of roomsFor(c, b, home, type, caste))
    for (const q of freeIn(g, ch, occupied)) {
      if (canPlaceTile(w, c, type, q, caste)) continue;
      if (placeTile(w, c, type, q, caste)) {
        occupied.add(q);
        return true;
      }
    }
  return false;
}

// ---------------------------------------------------------------------------
// The builder's think (every 2 s)
// ---------------------------------------------------------------------------

export function buildTick(w: World, c: Colony, dt: number): void {
  if (!c.alive) return;
  const g = w.nest(c.id);
  if (!g) return;
  const b = brainOf(c);
  b.t -= dt;
  if (b.t > 0) return;
  b.t = THINK_EVERY;
  const A = BALANCE.aiBuild;
  // Termants: the stolen castes change mid-match (the mix follows them); forgetting and carton walls
  if (c.species === 'termant') {
    b.mix = defaultMix(c);
    termantAI(w, c);
  }
  const home = homeHex(w, c);
  const occupied = new Set(c.tiles.map((t) => t.q));

  // Tiles waiting for builders. Digging jobs come before building, so while
  // plans wait the frontier is not extended (or the diggers never get round
  // to building and the colony stops growing), and few plans are made at once.
  let unbuilt = 0;
  for (const t of c.tiles) if (!t.built) unbuilt++;

  // 1. Digging: one chamber planned at a time, for what the last think had no room for; dug a few hexes at a time.
  const workers = c.living;
  const wantDesig = Math.max(3, Math.min(16, 3 + Math.floor(workers / 5)));
  const todo = planned(g, b).filter((q) => g.isHexDiggable(q));
  if (!todo.length && b.need) {
    // no place for that chamber (the nest is crowded there): try the others for a while
    if (!planChamber(w, c, b, home, b.need)) (b.skip ??= {})[needKey(b.need)] = w.s.time + A.planRetry;
    b.need = null;
  }
  if (g.designatedCount < wantDesig) {
    const plan = digOrder(g, b).filter((q) => !g.hexDesig[q]);
    for (const q of plan.slice(0, wantDesig - g.designatedCount)) designateDig(w, c, q, true);
  }

  // 2. Building: one tile per think, in its own room. When the rooms for a tile are (nearly) full, the next chamber is
  //    planned for it (`need`); stores past two chambers are upgraded instead.
  const placedTile = buildOne(w, c, b, g, home, occupied, unbuilt);
  // 3. Highways on the tunnels (they feed the chamber edges' upgrade points and speed the traffic).
  if (!placedTile) highwayOne(w, c, b, g, home, occupied);
  // 4. Upgrades from mid game.
  upgradeOne(w, c, b);
}

/**
 * Note a room shortage for the next chamber (the first one noted wins: stores, specials, brood in that order). Stores
 * past `maxStoreChambers` are not a shortage: they are upgraded instead.
 */
function noteNeed(w: World, b: BuildBrain, need: Need): void {
  if (need.type === 'food' && storeChambers(b) >= BALANCE.aiBuild.maxStoreChambers) return;
  if ((b.skip?.[needKey(need)] ?? 0) > w.s.time) return;
  if (!b.need) b.need = need;
}

function needKey(n: Need): string {
  return n.caste ? `${n.type}:${n.caste}` : n.type;
}

function buildOne(w: World, c: Colony, b: BuildBrain, g: NestGrid, home: number, occupied: Set<number>, unbuilt: number): boolean {
  const A = BALANCE.aiBuild;
  const counts: Record<string, number> = {};
  let broodTiles = 0;
  let unfilled = 0;
  for (const t of c.tiles) {
    if (t.type === 'brood' && t.caste) {
      counts[t.caste] = (counts[t.caste] ?? 0) + 1;
      broodTiles++;
    }
    if (raisesAnts(t) && !t.ant && !t.brood) unfilled++;
  }
  const food = c.food;
  // One plan of a kind at a time: a planned tile only helps once it is built,
  // and piling up plans (storage especially, while the store is full) used to
  // keep the builders busy and stop the colony adding brood tiles at all.
  const plannedTile = (type: string) => c.tiles.some((t) => t.type === type && !t.built);
  const roomLeft = (type: TileType, caste?: string) => roomFor(g, roomsFor(c, b, home, type, caste), occupied);
  const tryPlace = (type: TileType, caste?: string): boolean => {
    if (place(w, c, b, home, occupied, type, caste)) {
      const r = roomLeft(type, caste);
      if (r.free + r.coming <= A.nearlyFull) noteNeed(w, b, { type, caste });
      return true;
    }
    // (no room at all: plan the next chamber; free floor but no tile placed means it could not pay — tiles are paid
    // when ordered since 2026-11-02 — so no new chamber for that)
    const r = roomLeft(type, caste);
    if (!r.free && !r.coming) noteNeed(w, b, { type, caste });
    return false;
  };
  // a) more storage when nearly full (once both store chambers are full, store upgrades take over)
  if (food >= c.foodCap * A.storeFull && c.foodCap < A.foodCapMax && !plannedTile('food')) {
    if (tryPlace('food')) return true;
  }
  // b) species special tiles
  for (const sp of specialTargets(c, broodTiles, counts)) {
    const have = c.tiles.filter((t) => t.type === sp.type).length;
    if (have < sp.want && !plannedTile(sp.type) && food >= tileCost(c, sp.type) + 6) {
      if (tryPlace(sp.type)) return true;
    }
  }
  // c) brood: the caste furthest below its target share. Young colonies raise
  //    only workers (like real incipient colonies); fighters come once there
  //    is a workforce to feed them. Don't add tiles while brood is backed up,
  //    or while earlier plans still wait for builders.
  if (unfilled > 1 || unbuilt >= 2) return false;
  let waiting = 0;
  for (const t of c.tiles) if (raisesAnts(t) && t.brood && !t.ant) waiting++;
  let nurses = 0;
  for (const [cs, n] of Object.entries(c.counts)) if (CASTES[cs].nurse) nurses += n;
  if (waiting > 2 + nurses * 1.5) return false;
  // Keep enough food to feed the larvae already waiting on their tiles.
  const reserve = larvaeReserve(w, c);
  let workerAnts = 0;
  for (const [cs, n] of Object.entries(c.counts)) if (!isFighter(cs)) workerAnts += n;
  const total = broodTiles + 1;
  const ranked: Array<{ cs: string; gap: number }> = [];
  for (const [cs, frac] of Object.entries(b.mix)) {
    if (!c.castes.includes(cs)) continue;
    if (isFighter(cs) && workerAnts < 12) continue;
    ranked.push({ cs, gap: frac * total - (counts[cs] ?? 0) });
  }
  ranked.sort((a, z) => z.gap - a.gap);
  if (!ranked.length) return false;
  const need = (cs: string) => tileCost(c, 'brood', cs) + hatchCost(cs) + 4 + reserve;
  // Save up for the most-needed caste when it is well behind; otherwise take
  // the most-needed caste we can afford now.
  const top = ranked[0];
  // the most-needed caste's rooms: plan its next chamber ahead when they are nearly full
  const topRoom = roomLeft('brood', top.cs);
  if (topRoom.free + topRoom.coming <= A.nearlyFull) noteNeed(w, b, { type: 'brood', caste: top.cs });
  const pick = food >= need(top.cs) ? top : top.gap >= 2 ? null : ranked.find((r) => r.gap > -1 && food >= need(r.cs));
  if (!pick) return false;
  return tryPlace('brood', pick.cs);
}

/** Food kept back for the larvae already waiting on their tiles. */
function larvaeReserve(w: World, c: Colony): number {
  let reserve = 0;
  for (const br of w.s.brood) {
    if (br.colony !== c.id) continue;
    // a pre-staged larva (its tile's ant alive) grows only to BALANCE.prestage and waits there, eating nothing more until
    // that ant dies: only the growing it still has to do counts (else a big colony's reserve outgrows its whole store,
    // nothing is ever upgraded, and a full store stops the gathering for good)
    const t = tileAt(c, br.tile);
    const cap = t && tileAnts(w, t).length >= tileCapacity(t) ? BALANCE.prestage : 1;
    reserve += hatchCost(br.caste) * Math.max(0, cap - br.t);
  }
  return reserve;
}

/**
 * One highway tile on the tunnels and passages: the passage from the entrance and the store chambers' tunnels first,
 * then the mouths of the chambers that will be upgraded (19 hexes), then the rest. Never on an entrance, in a room or in
 * the queen's chamber.
 */
function highwayOne(w: World, c: Colony, b: BuildBrain, g: NestGrid, home: number, occupied: Set<number>): void {
  const A = BALANCE.aiBuild;
  if (c.living < A.highwayFrom || c.tiles.some((t) => t.type === 'highway' && !t.built)) return;
  if (c.food < tileCost(c, 'highway') + A.highwayReserve + larvaeReserve(w, c)) return;
  const roomOf = new Map<number, Chamber>();
  for (const ch of [founding(c, home), ...(b.chambers ?? [])]) for (const q of disc(g, ch.q, chR(ch))) roomOf.set(q, ch);
  const tunnels = new Set(b.tunnels ?? []);
  let ent = entranceHexes(g);
  if (!ent.length) ent = [home];
  let best = -1;
  let bs = Infinity;
  for (let q = 0; q < g.cols * g.rows; q++) {
    if (!g.isHexDug(q) || g.isEntrance(q) || occupied.has(q) || roomOf.has(q)) continue;
    let mouth: Chamber | undefined;
    for (const n of g.neighbors(q)) {
      const ch = n >= 0 ? roomOf.get(n) : undefined;
      if (ch && ch.q !== home) mouth = !mouth || chR(ch) > chR(mouth) ? ch : mouth;
    }
    let toEnt = Infinity;
    for (const e of ent) toEnt = Math.min(toEnt, g.hexDistance(q, e));
    // the passage from the entrance (dug at the start, not a tunnel) and the stores' tunnels; then the 19s' mouths
    let s: number;
    if (!tunnels.has(q)) s = 0 + toEnt * 0.05;
    else if (mouth && chType(mouth) === 'food') s = 1 + toEnt * 0.05;
    else if (mouth && chR(mouth) >= 2) s = 2;
    else if (mouth) s = 3;
    else s = 4 + g.hexDistance(q, home) * 0.05;
    s += jitter(q) * 0.01;
    if (s < bs && !canPlaceTile(w, c, 'highway', q)) {
      bs = s;
      best = q;
    }
  }
  if (best >= 0 && placeTile(w, c, 'highway', best)) occupied.add(best);
}

/**
 * One upgrade job from mid game: only tiles with the points; within each kind the 19-hex chambers' tiles first, inner
 * tiles (most points) first; fighters first while the colony is threatened or raiding, stores once both store chambers
 * are full, then workers, specials, highways. Food is
 * kept back (`upgradeReserve` and the larvae's), at most `upgradesInFlight` at once, none during an invasion.
 */
function upgradeOne(w: World, c: Colony, b: BuildBrain): void {
  const A = BALANCE.aiBuild;
  const lv = aiLevel(w);
  if (!midGame(w, c, A.upgradeFrom) || c.food < A.upgradeFrom.food || (c.intruders?.length ?? 0) > 0) return;
  let inFlight = 0;
  for (const t of c.tiles) if (t.pend === 1) inFlight++;
  if (inFlight >= Math.max(1, Math.round(A.upgradesInFlight * A.levelInFlight[lv]))) return;
  // brood comes first: keep the price of the dearest brood tile of the mix and its ant, and the larvae's food
  let brood = 0;
  for (const cs of Object.keys(b.mix)) if (c.castes.includes(cs)) brood = Math.max(brood, tileCost(c, 'brood', cs) + hatchCost(cs));
  const keep = A.upgradeReserve + larvaeReserve(w, c) + brood;
  const war = !!c.aiWar && (c.aiWar.defending || c.aiWar.target >= 0);
  const storesFull = storeChambers(b) >= A.maxStoreChambers && c.food >= c.foodCap * A.storeFull;
  // the 19-hex chambers first: they are the ones whose tiles can all reach level 3 (a 7's ring stops at 2)
  const g = w.nest(c.id)!;
  const in19 = new Set<number>();
  for (const ch of b.chambers ?? []) if (chR(ch) >= 2) for (const q of disc(g, ch.q, chR(ch))) in19.add(q);
  let best: (typeof c.tiles)[number] | null = null;
  let bs = Infinity;
  for (const t of c.tiles) {
    if (!t.built || t.pend || t.type === 'queen' || t.type === 'carton' || t.level >= MAX_TILE_LEVEL) continue;
    if (c.food < keep + upgradeCost(c, t)) continue;
    let rank: number;
    if (t.type === 'brood' && t.caste && isFighter(t.caste)) rank = war ? 0 : 3;
    else if (t.type === 'food') rank = storesFull ? 1 : 6;
    else if (t.type === 'brood') rank = 2;
    else if (t.type === 'highway') rank = 5;
    else rank = 4;
    const pts = upgradePoints(w, c, t);
    if (pts < upgradeNeed(t)) continue; // no wasted orders
    // most points first (inner tiles: a 19-hex chamber's middle reaches level 3), a little ahead for lower levels
    const s = rank * 100 - (in19.has(t.q) ? 50 : 0) - pts + t.level + jitter(t.q) * 0.01;
    if (s < bs) {
      bs = s;
      best = t;
    }
  }
  if (best) markUpgrade(w, c, best.q);
}

// ---------------------------------------------------------------------------
// Foraging with markers (EotU: home workers stay inside; food is fetched by
// groups sent to a marker)
// ---------------------------------------------------------------------------

const FORAGE_EVERY = 5; // seconds
const RETARGET_EVERY = 25;
const FORAGE_MARKER = 0;
const FORAGE_RANGE = 420; // mm from the nest

interface ForageBrain {
  t: number;
  /** time since the target was chosen */
  age: number;
  target: { x: number; y: number } | null;
  /** the queen's own group is out foraging (only when it is the colony's sole worker group) */
  queenOut: boolean;
  /** termites (soldier-first foraging): seconds the scouts have held the source; the workers may follow; last enemy sighting */
  scoutT?: number;
  /** seconds spent scouting the current new source */
  scoutAge?: number;
  scouted?: boolean;
  enemyAt?: number;
}

function forageBrain(c: Colony): ForageBrain {
  if (!c.aiForage) c.aiForage = { t: (c.id * 0.61) % FORAGE_EVERY, age: 0, target: null, queenOut: false };
  return c.aiForage;
}

/** Food value a marker at (x, y) could reach: loose items, leaves (leafcutters), honeydew (tenders). */
function sourceValue(w: World, c: Colony, x: number, y: number, cut: boolean, tend: boolean): number {
  let v = 0;
  w.foodNear(x, y, 34, (f) => {
    if (f.space !== SURFACE || f.heldBy || f.amount <= 0 || f.kind === 'honeydew' || f.colony === -2) return false;
    if (f.kind === 'corpse' && w.teamOf(f.colony) === w.teamOf(c.id)) return false;
    if (f.kind === 'leaf' && !cut && c.species !== 'termant') return false;
    if (!edible(c, f)) return false;
    v += (f.kind === 'wood' || f.kind === 'leaf') && c.species === 'termant' ? f.amount * woodWant(c) : f.amount;
    return false;
  });
  // Leafcutters live on their fungus: leaves count for more while the garden is hungry.
  const leafK = c.fungus < c.fungusCap * 0.6 ? 4 : 1.5;
  if (cut && c.fungus < c.fungusCap) for (const p of w.s.plants) if (p.leaf >= 2 && sq(p.x - x) + sq(p.y - y) < 34 * 34) v += p.leaf * leafK;
  if (tend) for (const ap of w.s.aphids) if (ap.dew >= 0.5 && !(ap.owner >= 0 && ap.owner !== c.id && ap.tendT > 0) && sq(ap.x - x) + sq(ap.y - y) < 34 * 34) v += Math.min(ap.dew, BALANCE.aiForage.aphidCap) * BALANCE.aiForage.aphidValue;
  return v;
}

/** The best foraging spot within range: value discounted by distance from the nest. */
function findForageTarget(w: World, c: Colony, ox: number, oy: number): { x: number; y: number } | null {
  const cut = c.castes.some((cs) => CASTES[cs].cutLeaves);
  const tend = c.castes.some((cs) => CASTES[cs].tendAphids);
  const cand: Array<{ x: number; y: number }> = [];
  for (const f of w.s.food) if (f.space === SURFACE && !f.heldBy && f.kind !== 'honeydew' && f.colony !== -2 && f.amount > 0.5 && edible(c, f)) cand.push(f);
  if (cut && c.fungus < c.fungusCap) for (const p of w.s.plants) if (p.leaf >= 3) cand.push(p);
  if (tend) for (const ap of w.s.aphids) if (ap.dew >= 1) cand.push(ap);
  let best: { x: number; y: number } | null = null;
  let bestS = 0;
  for (const p of cand) {
    const d = dhypot(p.x - ox, p.y - oy);
    if (d > FORAGE_RANGE || d < 25) continue;
    const s = sourceValue(w, c, p.x, p.y, cut, tend) / (d + 80);
    if (s > bestS) {
      bestS = s;
      best = { x: p.x, y: p.y };
    }
  }
  return best;
}

/**
 * Nasute Termites forage soldier-first (Traniello & Busher 1985). When the AI
 * picks a new wood source, a nasute escort (at least
 * `ai.minNasutesPerForageColumn` soldiers) first scouts it under marker IV
 * while the workers keep to the old source (or stay home); once the scouts
 * have held it for `ai.scoutSec` with no enemy near, marker I moves there,
 * the workers follow and the nasutes stay as their escort ring. When enemies
 * have been seen at the source, a major group joins the column.
 * Returns true while scouting (marker I is left where it is).
 */
const SCOUT_MARKER = 3;
function termiteScout(w: World, c: Colony, b: ForageBrain): boolean {
  const A = NASUTE.ai;
  const target = b.target!;
  const free = (g: (typeof c.groups)[number]) => raisesAnts(g) && g.type !== 'queen' && !!g.caste && (g.marker < 1 || g.marker === SCOUT_MARKER);
  const nasG = c.groups.filter((g) => free(g) && CASTES[g.caste!].termite === 'nasute');
  const majG = c.groups.filter((g) => free(g) && CASTES[g.caste!].termite === 'major');
  const escortG: typeof nasG = [];
  let escort = 0;
  for (const g of nasG) {
    if (escort >= A.minNasutesPerForageColumn) break;
    const n = groupCounts(w, c, g.id).living;
    if (!n) continue;
    escortG.push(g);
    escort += n;
  }
  // enemies near the source? (they keep the workers back and bring the majors)
  const R2 = A.enemyRadius * A.enemyRadius;
  const team = w.teamOf(c.id);
  let enemy = false;
  for (const o of w.s.ants) {
    if (o.space !== SURFACE || o.state === AS.Dead || (o.team ?? w.teamOf(o.colony)) === team || sq(o.x - target.x) + sq(o.y - target.y) > R2) continue;
    enemy = true;
    break;
  }
  if (!enemy) for (const cr of w.s.creatures) if (!cr.dead && cr.space === SURFACE && sq(cr.x - target.x) + sq(cr.y - target.y) <= R2 && creatureHooks.relation(cr) === 'hostile') enemy = true;
  if (enemy) b.enemyAt = w.s.time;
  const recent = b.enemyAt !== undefined && w.s.time - b.enemyAt < A.enemyMemorySec;
  const column = b.scouted || !escortG.length ? FORAGE_MARKER : SCOUT_MARKER;
  for (const g of escortG) if (g.marker !== column) assignGroup(w, c, g.id, column);
  if (recent && majG.length && majG[0].marker !== column) assignGroup(w, c, majG[0].id, column);
  if (b.scouted || !escortG.length) {
    if (c.markers[SCOUT_MARKER].placed) removeMarker(w, c, SCOUT_MARKER);
    return false; // scouted (or no soldiers yet: the workers go alone)
  }
  const sm = c.markers[SCOUT_MARKER];
  if (!sm.placed || sm.space !== SURFACE || dhypot(sm.x - target.x, sm.y - target.y) > 6) placeMarker(w, c, SCOUT_MARKER, SURFACE, target.x, target.y);
  // the scouts must actually be there, with no enemy in sight, for a while
  let there = 0;
  const r2 = sq(markerRadius(w, c, SCOUT_MARKER) * 2 + 20);
  for (const a of w.s.ants) if (a.colony === c.id && a.marker === SCOUT_MARKER && a.space === SURFACE && casteOf(a.caste).termite === 'nasute' && sq(a.x - target.x) + sq(a.y - target.y) < r2) there++;
  if (there >= Math.min(A.scoutNasutes, escort) && !enemy) b.scoutT = (b.scoutT ?? 0) + FORAGE_EVERY;
  else b.scoutT = 0;
  // Soldiers forage like ants (user note), so scouts that reach a source with wood start carrying it home and may
  // never all stand there at once: after `scoutGiveUpSec` without enemies the workers follow anyway (Phase 15: the
  // column waited for ever at an exhausted source).
  b.scoutAge = (b.scoutAge ?? 0) + FORAGE_EVERY;
  if ((b.scoutT ?? 0) >= A.scoutSec || (!recent && b.scoutAge >= BALANCE.aiForage.scoutGiveUpSec)) {
    b.scouted = true;
    for (const g of escortG) assignGroup(w, c, g.id, FORAGE_MARKER);
    removeMarker(w, c, SCOUT_MARKER);
    return false;
  }
  return true;
}

/**
 * Aphid tenders keep one worker group (the last) milking the nearest aphid colony near the nest, under marker IV
 * (termites use IV for scouting, but no termite tends aphids); it rejoins the forage column when none is left.
 */
const TEND_MARKER = 3;
function tendAphids(w: World, c: Colony, ox: number, oy: number, foraging: Colony['groups']): void {
  const A = BALANCE.aiForage;
  const m = c.markers[TEND_MARKER];
  let best: AphidCluster | null = null;
  let bd = A.tendRange;
  for (const ap of w.s.aphids) {
    if (ap.n < A.tendMinAphids || (ap.owner >= 0 && ap.owner !== c.id && ap.tendT > 0)) continue;
    const d = dhypot(ap.x - ox, ap.y - oy);
    if (d < bd || (d === bd && best && ap.id < best.id)) {
      bd = d;
      best = ap;
    }
  }
  const tenders = c.groups.filter((g) => g.marker === TEND_MARKER);
  const pool = foraging.filter((g) => g.marker === FORAGE_MARKER || g.marker === TEND_MARKER);
  if (!best || pool.length < A.tendMinGroups) {
    for (const g of tenders) assignGroup(w, c, g.id, -1);
    if (m.placed) removeMarker(w, c, TEND_MARKER);
    return;
  }
  if (!m.placed || m.space !== SURFACE || dhypot(m.x - best.x, m.y - best.y) > 4) placeMarker(w, c, TEND_MARKER, SURFACE, best.x, best.y);
  const g = pool[pool.length - 1];
  if (g.marker !== TEND_MARKER) assignGroup(w, c, g.id, TEND_MARKER);
  for (const o of tenders) if (o.id !== g.id) assignGroup(w, c, o.id, -1);
}

/**
 * AI foraging: keep marker I on the richest food source near the nest and
 * send the worker groups there, keeping the queen's own group home for nest
 * jobs and eggs. A colony whose only workers are the queen's sends them out
 * only while there are no nest jobs and the stores are low.
 */
export function forageTick(w: World, c: Colony, dt: number): void {
  if (!c.alive) return;
  const b = forageBrain(c);
  b.t -= dt;
  b.age += dt;
  if (b.t > 0) return;
  b.t = FORAGE_EVERY;
  const ox = c.entrances[0]?.sx ?? c.nx;
  const oy = c.entrances[0]?.sy ?? c.ny;
  const cut = c.castes.some((cs) => CASTES[cs].cutLeaves);
  const tend = c.castes.some((cs) => CASTES[cs].tendAphids);
  const m = c.markers[FORAGE_MARKER];
  // Invaded: lift the forage marker so the foragers run home to defend the queen.
  if ((c.intruders?.length ?? 0) > 0) {
    if (m.placed) removeMarker(w, c, FORAGE_MARKER);
    return;
  }
  // (army ants move the raid on once the prey there runs low: ECITON.aiRecallFood)
  const low = c.species === 'eciton' ? ECITON.aiRecallFood : 2;
  if (!b.target || b.age > RETARGET_EVERY || sourceValue(w, c, b.target.x, b.target.y, cut, tend) < low) {
    const old = b.target;
    b.target = findForageTarget(w, c, ox, oy);
    b.age = 0;
    // a new source for termites: the soldiers scout it again first
    if (!old || !b.target || dhypot(old.x - b.target.x, old.y - b.target.y) > 60) {
      b.scoutT = 0;
      b.scoutAge = 0;
      b.scouted = false;
    }
  }
  if (!b.target) {
    if (m.placed && m.space === SURFACE) removeMarker(w, c, FORAGE_MARKER);
    return;
  }
  // termites: the soldiers scout a new source before marker I (and the workers) move there
  if (isTermiteSpecies(c.species) && termiteScout(w, c, b)) return;
  if (!m.placed || m.space !== SURFACE || dhypot(m.x - b.target.x, m.y - b.target.y) > 6) placeMarker(w, c, FORAGE_MARKER, SURFACE, b.target.x, b.target.y);
  // Groups (user note, 2026-10-25): the queen's group and about a third of the
  // workers always stay home on nest jobs (pulling eggs, nursing, storing,
  // digging); the other worker groups forage; gardeners (leafcutter minims)
  // tend the fungus; fighters guard. Only a founding colony whose sole workers
  // are the queen's own sends them out, and only while food runs short.
  const workerGroups = c.groups.filter((g) => raisesAnts(g) && g.caste && (tierOf(g.caste) === 'worker' || tierOf(g.caste) === 'nanitic') && !(c.fungusCap > 0 && CASTES[g.caste].garden && g.type !== 'queen'));
  const queenGroups = workerGroups.filter((g) => g.type === 'queen');
  const others = workerGroups.filter((g) => g.type !== 'queen').sort((x, z) => x.id - z.id);
  const living = new Map<number, number>();
  let total = 0;
  for (const g of workerGroups) {
    const n = groupCounts(w, c, g.id).living;
    living.set(g.id, n);
    total += n;
  }
  let home = 0;
  for (const g of queenGroups) home += living.get(g.id) ?? 0;
  const stay = new Set<number>();
  for (const g of others) {
    // keep groups home (lowest ids first) toward a third of the workers in the nest: a group is
    // added only if that does not leave much more than a third home, and never all of them
    if (home >= total / 3 || stay.size >= others.length - 1) break;
    const n = living.get(g.id) ?? 0;
    if (home + n > total * 0.4) continue;
    stay.add(g.id);
    home += n;
  }
  let foragers = 0;
  for (const g of others) {
    const want = stay.has(g.id) ? -1 : FORAGE_MARKER;
    if (!stay.has(g.id)) foragers += living.get(g.id) ?? 0;
    if (want === FORAGE_MARKER ? g.marker !== FORAGE_MARKER && g.marker < 1 : g.marker === FORAGE_MARKER) assignGroup(w, c, g.id, want);
  }
  // founding: no other foragers yet: the queen's workers fetch food while it is short (wide hysteresis)
  const enough = Math.min(c.foodCap * 0.85, 45);
  if (foragers >= 3) b.queenOut = false;
  else if (!b.queenOut && c.food < 10) b.queenOut = true;
  else if (b.queenOut && c.food >= enough) b.queenOut = false;
  for (const g of queenGroups) {
    const want = b.queenOut ? FORAGE_MARKER : -1;
    if (g.marker !== want) assignGroup(w, c, g.id, want);
  }
  if (tend && !isTermiteSpecies(c.species)) tendAphids(w, c, ox, oy, others.filter((g) => !stay.has(g.id)));
  // army ants: the Media escort the porters and the Soldiers guard the raid trail (eciton.ts) once there are enough
  // Soldiers to man posts; with fewer they stay home and defend
  if (c.species === 'eciton') {
    let majors = 0;
    for (const a of w.s.ants) if (a.colony === c.id && a.caste === 'eciton_major' && a.state !== AS.Dead) majors++;
    const out = majors >= ECITON.guard.minMajors && foragers > 0;
    for (const g of c.groups) {
      if (!raisesAnts(g) || (g.caste !== 'eciton_media' && g.caste !== 'eciton_major')) continue;
      if (out && g.marker < 1 && g.marker !== FORAGE_MARKER) assignGroup(w, c, g.id, FORAGE_MARKER);
      else if (!out && g.marker === FORAGE_MARKER) assignGroup(w, c, g.id, -1);
    }
  }
}
