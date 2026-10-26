import { separationSystem } from './separation';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { MapStyle, Terrain, defaultTerrainParams, mapTerrainParams } from '../world/terrain';
import type { MapId } from '../maps/types';
import { HF_APHID, HF_FOOD, HF_LAIR, HF_LITTER, HF_PLANT } from '../world/surfaceLayout';
import { World, emptyState } from './world';
import { ColonyOptions, createColony, colonySystem } from './colony';
import { broodSystem } from './brood';
import { antSystem } from './antAI';
import { foodSystem } from './food';
import { invasionCheck, projectileSystem } from './combat';
import { makeFood } from './factory';
import { aphidClaims, registerSpeciesAI } from './speciesAI';
import { SURFACE, SimState } from './types';
import { CaveOptions, createCave, lostRouteSystem } from './areas';
import { SpeciesId, SPECIES } from './species';
import { BALANCE, NASUTE, SICKLE } from './balance';
import { edible } from './diet';
import { datan2, dcos, dhypot, dsin } from './dmath';
import { creatureSystem, ecologySystem, registerCreatureHooks } from './creatures/creatureAI';
import { MissionId, missionSystem, startMission } from './missions';
import { ecitonSystem } from './eciton';
import { termantSystem } from './termants';
import { arenaSystem, setupArena } from './arena';
import { floodSystem, initFloods } from './floods';

export interface ColonySpec {
  species: SpeciesId;
  player: boolean;
  ai: boolean;
  borrowed?: string[];
  developed?: number;
  startWorkers?: number;
  startFood?: number;
  /** population limit (brood tile slots) */
  popLimit?: number;
  name?: string;
  /** fixed nest location (else auto-placed) */
  at?: { x: number; y: number };
  /** team: give an AI colony the player's team (0) to make it an ally */
  team?: number;
}

/** A neutral underground area (cave or lair); placed automatically when `at` is left out. */
export type CaveSpec = Omit<CaveOptions, 'at'> & { at?: { x: number; y: number } };

export interface GameSetup {
  seed: number;
  style: MapStyle;
  width: number;
  depth: number;
  colonies: ColonySpec[];
  food: number; // density multiplier
  puddles?: number;
  aphids?: number;
  plants?: number;
  /** neutral caves and lairs (extra underground areas) */
  caves?: CaveSpec[];
  settings?: Partial<SimState['settings']>;
  /** single-player mission script (sim/missions.ts) */
  mission?: MissionId;
  /** sandbox game: the sandbox commands (spawn, fill stores, toggles) are allowed */
  sandbox?: boolean;
  /** battle arena (sim/arena.ts): the colonies are the teams; no economy */
  arena?: boolean;
  /** an authored map (docs/maps/design.md): its size, water, walls, sites and zones replace style, width and depth */
  map?: MapId;
  /** which of the map's balanced site sets for this colony count (default: chosen by the seed) */
  siteSet?: number;
  /** multiplayer teams: colonies sharing a `team` start on neighbouring sites of the balanced set */
  groupTeams?: boolean;
}

/**
 * Teams on neighbouring sites: the chosen sites in order around the map's centre, each team taking a
 * run of consecutive ones (bigger teams first), colonies without a team the rest. Pure arithmetic on
 * the map file and the setup, so every client gets the same answer.
 */
export function teamSiteOrder(sites: number[], centres: Array<{ x: number; y: number }>, cx: number, cy: number, teams: Array<number | undefined>): number[] {
  const around = sites.map((site, k) => ({ site, a: datan2(centres[k].y - cy, centres[k].x - cx) })).sort((p, q) => p.a - q.a || p.site - q.site);
  const groups = new Map<number, number[]>();
  teams.forEach((t, i) => {
    if (t === undefined) return;
    const g = groups.get(t);
    if (g) g.push(i);
    else groups.set(t, [i]);
  });
  const ordered = [...groups.entries()].sort((p, q) => q[1].length - p[1].length || p[1][0] - q[1][0]);
  const out: number[] = new Array(teams.length).fill(-1);
  let k = 0;
  for (const [, members] of ordered) for (const i of members) out[i] = around[k++].site;
  teams.forEach((t, i) => {
    if (out[i] < 0) out[i] = around[k++].site;
  });
  return out;
}

/** Register all simulation systems in update order. */
/** Species that eat dead wood (termites, and the Termants' second diet): maps with them get deadwood. */
function woodSpecies(sp: SpeciesId): boolean {
  return SPECIES[sp].kind === 'termite' || sp === 'termant';
}

export function registerSystems(w: World): void {
  registerSpeciesAI();
  // Creatures are part of every game (Phase 11): the hooks must be the same on every client.
  registerCreatureHooks();
  w.systems = [
    { name: 'colony', fn: colonySystem },
    // army ants: raid fronts, flushing, Soldier posts (before the ants move)
    { name: 'eciton', fn: ecitonSystem },
    // Termants: stolen castes unlocking, wood digesting (every second)
    { name: 'termant', fn: termantSystem },
    // battle arena: tallies, charge targets, the round (sim/arena.ts)
    { name: 'arena', fn: arenaSystem },
    { name: 'brood', fn: broodSystem },
    { name: 'ants', fn: antSystem },
    { name: 'food', fn: foodSystem },
    { name: 'projectiles', fn: projectileSystem },
    { name: 'phero', fn: (ww, dt) => ww.phero.update(dt, ww.s.tick) },
    { name: 'respawn', fn: respawnSystem, every: 20 },
    { name: 'aphidClaims', fn: aphidClaims, every: 20 },
    { name: 'invasion', fn: (ww) => invasionCheck(ww), every: 20 },
    { name: 'lost', fn: lostRouteSystem, every: 20 },
    { name: 'creatures', fn: creatureSystem },
    { name: 'separation', fn: separationSystem, every: 2 },
    { name: 'ecology', fn: ecologySystem, every: 20 },
    { name: 'mission', fn: missionSystem, every: 20 },
    // storms on authored maps (only when the match turns floods on)
    { name: 'floods', fn: floodSystem },
    ...extraSystems,
  ];
}

/** Modules (creatures, species AI, rival AI) push their systems here. */
export const extraSystems: Array<{ name: string; fn: (w: World, dt: number) => void; every?: number }> = [];

export function createWorld(setup: GameSetup, events: EventBus): World {
  const params = setup.map ? mapTerrainParams(setup.seed, setup.map) : defaultTerrainParams(setup.seed, setup.style, setup.width, setup.depth);
  // an authored map sets the size
  setup = { ...setup, width: params.width, depth: params.depth, style: params.style };
  const state = emptyState(setup.seed, params);
  Object.assign(state.settings, setup.settings ?? {});
  // Puddles are sculpted into the params before the world builds its terrain (authored maps have their own water).
  const pre = new Terrain(params);
  const rng = new Rng(setup.seed * 31 + 5);
  const nPud = setup.map ? 0 : (setup.puddles ?? (setup.style === 'sandy' || setup.style === 'formicarium' ? 0 : 2));
  for (let i = 0; i < nPud; i++) pre.addPuddle(rng.range(80, setup.width - 80), rng.range(80, setup.depth - 80), rng.range(18, 36));
  state.terrain = pre.params;
  const w = new World(state, events);
  registerSystems(w);

  // Place colonies: on an authored map on its sites (a balanced set), else far apart on dry ground.
  const L = w.terrain.layout;
  let sites = L ? L.siteOrder(setup.colonies.length, setup.siteSet ?? -1, setup.seed) : null;
  if (sites && L && setup.groupTeams && sites.length === setup.colonies.length) {
    const centres = sites.map((site) => ({ x: L.hex.centerX(L.sites[site].centre), y: L.hex.centerY(L.sites[site].centre) }));
    sites = teamSiteOrder(sites, centres, w.terrain.width / 2, w.terrain.depth / 2, setup.colonies.map((c) => c.team));
  }
  const spots = sites ? [] : colonySpots(w, setup.colonies.length, rng);
  let nextSite = 0;
  setup.colonies.forEach((spec, i) => {
    let at = spec.at;
    let site: number | undefined;
    if (!at && sites && L) {
      site = sites[nextSite++];
      const q = L.sites[site].centre;
      at = { x: L.hex.centerX(q), y: L.hex.centerY(q) };
    }
    at ??= spots[i];
    const opts: ColonyOptions = { species: spec.species, player: spec.player, ai: spec.ai, borrowed: spec.borrowed, nx: at.x, ny: at.y, developed: spec.developed, startWorkers: spec.startWorkers, startFood: spec.startFood, popLimit: spec.popLimit, name: spec.name, team: spec.team, site };
    createColony(w, opts);
  });
  if (setup.mission) startMission(w, setup.mission, w.s.colonies.find((c) => c.player)?.id ?? 0);
  if (setup.sandbox) w.s.mode.sandbox = true;
  if (setup.arena) setupArena(w);

  // Neutral caves and lairs, away from the nests.
  const lairs = L ? L.def.zones.filter((z) => z.kind === 'lair') : [];
  (setup.caves ?? []).forEach((cv, i) => createCave(w, { ...cv, at: cv.at ?? (i < lairs.length ? zonePoint(w, rng, HF_LAIR, 40) : caveSpot(w, rng)) }));

  // Food, aphids and leaf plants.
  const area = (setup.width * setup.depth) / 1e4;
  const nFood = Math.round(area * 0.55 * setup.food);
  for (let i = 0; i < nFood; i++) spawnRandomFood(w, rng);
  const nAph = setup.aphids ?? Math.round(area * 0.08);
  for (let i = 0; i < nAph; i++) {
    const p = L ? zonePoint(w, rng, HF_APHID, 40) : dryPoint(w, rng, 40);
    w.s.aphids.push({ id: w.nextId(), x: p.x, y: p.y, n: rng.int(6, 16), dew: rng.range(1, 4), owner: -1, tendT: 0, green: rng.chance(0.5) });
  }
  // Every nest has an aphid-infested plant within reach (ants nest beside them).
  if (setup.aphids === undefined) {
    for (const c of w.s.colonies) {
      for (let k = 0; k < 30; k++) {
        const e = c.entrances[0] ?? { sx: c.nx, sy: c.ny };
        const ang = rng.range(0, Math.PI * 2);
        const r = rng.range(60, 110);
        const x = e.sx + dcos(ang) * r;
        const y = e.sy + dsin(ang) * r;
        if (x < 40 || y < 40 || x > setup.width - 40 || y > setup.depth - 40 || !w.terrain.passable(x, y)) continue;
        w.s.aphids.push({ id: w.nextId(), x, y, n: rng.int(9, 14), dew: rng.range(2, 4), owner: -1, tendT: 0, green: rng.chance(0.5) });
        break;
      }
    }
  }
  // ...and a leafy plant close by (leafcutters forage leaves; other ants shelter under it).
  if (setup.plants === undefined) {
    for (const c of w.s.colonies) {
      for (let k = 0; k < 30; k++) {
        const e = c.entrances[0] ?? { sx: c.nx, sy: c.ny };
        const ang = rng.range(0, Math.PI * 2);
        const r = rng.range(70, 120);
        const x = e.sx + dcos(ang) * r;
        const y = e.sy + dsin(ang) * r;
        if (x < 40 || y < 40 || x > setup.width - 40 || y > setup.depth - 40 || !w.terrain.passable(x, y)) continue;
        const max = rng.range(28, 40);
        w.s.plants.push({ id: w.nextId(), x, y, leaf: max, max, v: rng.int(0, 1 << 20) });
        break;
      }
    }
  }
  const nPl = setup.plants ?? Math.round(area * 0.14);
  for (let i = 0; i < nPl; i++) {
    const p = L ? zonePoint(w, rng, HF_PLANT, 30) : dryPoint(w, rng, 30);
    const max = rng.range(18, 40);
    w.s.plants.push({ id: w.nextId(), x: p.x, y: p.y, leaf: max, max, v: rng.int(0, 1 << 20) });
  }
  // Deadwood (termite food; ants ignore it) on any map a termite colony plays: about the value of
  // the insect food, biased toward plant bases and the map edges, from its own RNG stream. Games
  // without termites get none, so their maps (and every entity id) stay exactly as before.
  const termites = w.s.colonies.some((c) => woodSpecies(c.species)) || !!setup.sandbox;
  const wr = new Rng(setup.seed * 7 + 41);
  const nWood = termites ? Math.max(4, Math.round(nFood * 0.3)) : 0;
  for (let i = 0; i < nWood; i++) spawnWood(w, wr);
  // every termite nest starts with twigs and branches close by
  for (const c of w.s.colonies) {
    if (!woodSpecies(c.species)) continue;
    const e = c.entrances[0] ?? { sx: c.nx, sy: c.ny };
    for (let k = 0; k < NASUTE.wood.startNear; k++) {
      const ang = wr.range(0, Math.PI * 2);
      const r = wr.range(45, 75);
      const x = Math.min(setup.width - 30, Math.max(30, e.sx + dcos(ang) * r));
      const y = Math.min(setup.depth - 30, Math.max(30, e.sy + dsin(ang) * r));
      placeWood(w, wr, k % 2 ? 'branch' : 'twig', x, y);
    }
  }
  // Leaf-litter patches (the Sickle-Jaw Termites' food) on maps with them, from another RNG stream.
  if (w.s.colonies.some((c) => c.species === 'rhynchotermes')) {
    const lr = new Rng(setup.seed * 11 + 59);
    const nRhy = w.s.colonies.filter((c) => c.species === 'rhynchotermes').length;
    const n = Math.max(SICKLE.food.patchesMin, SICKLE.food.patchesPerColony * nRhy);
    for (let i = 0; i < n; i++) spawnLitter(w, lr);
    for (const c of w.s.colonies) {
      if (c.species !== 'rhynchotermes') continue;
      const e = c.entrances[0] ?? { sx: c.nx, sy: c.ny };
      for (let k = 0; k < 2; k++) {
        const ang = lr.range(0, Math.PI * 2);
        const r = lr.range(35, 60);
        placeLitter(w, lr, Math.min(setup.width - 30, Math.max(30, e.sx + dcos(ang) * r)), Math.min(setup.depth - 30, Math.max(30, e.sy + dsin(ang) * r)));
      }
    }
  }
  // storms on an authored map, when the match turns floods on (scheduled from the seed)
  initFloods(w);
  w.reindex();
  return w;
}

/** A leaf-litter patch: a food item of kind 'wood' (plant matter) with `from` 'litter', chewed in place. */
export function placeLitter(w: World, rng: Rng, x: number, y: number): void {
  const f = makeFood(w, 'wood', SURFACE, x, y, 1, 'litter');
  f.amount = f.max = SICKLE.food.leafLitterPatch.amount;
  f.size = 16;
  f.mass = 999;
  f.h = rng.range(0, Math.PI * 2);
}

/** Leaf litter gathers at plant bases and in the open (forest-floor litter). */
export function spawnLitter(w: World, rng: Rng = w.rng): void {
  let p: { x: number; y: number };
  if (w.s.plants.length && rng.chance(0.6)) {
    const pl = w.s.plants[rng.int(0, w.s.plants.length - 1)];
    const a = rng.range(0, Math.PI * 2);
    p = { x: pl.x + dcos(a) * rng.range(10, 30), y: pl.y + dsin(a) * rng.range(10, 30) };
  } else p = w.terrain.layout ? zonePoint(w, rng, HF_LITTER, 25) : dryPoint(w, rng, 25);
  const t = w.terrain;
  if (p.x < 25 || p.y < 25 || p.x > t.width - 25 || p.y > t.depth - 25 || !t.passable(p.x, p.y)) return;
  for (const c of w.s.colonies) for (const e of c.entrances) if (dhypot(e.sx - p.x, e.sy - p.y) < 25) return;
  placeLitter(w, rng, p.x, p.y);
}

/**
 * A walkable point in one of an authored map's zones (food, aphid, plant, lair, litter): a random
 * hex of the zone, a random point in it. Falls back to any dry point when the map has no such zone.
 */
function zonePoint(w: World, rng: Rng, flag: number, margin: number): { x: number; y: number } {
  const L = w.terrain.layout;
  const hexes = L ? L.zoneHexes(flag) : [];
  if (!L || !hexes.length) return dryPoint(w, rng, margin);
  const t = w.terrain;
  for (let i = 0; i < 20; i++) {
    const q = hexes[rng.int(0, hexes.length - 1)];
    const x = L.hex.centerX(q) + rng.range(-0.7, 0.7) * L.hex.R;
    const y = L.hex.centerY(q) + rng.range(-0.7, 0.7) * L.hex.R;
    if (t.inBounds(x, y, margin) && t.passable(x, y)) return { x, y };
  }
  return dryPoint(w, rng, margin);
}

function dryPoint(w: World, rng: Rng, margin: number): { x: number; y: number } {
  const t = w.terrain;
  for (let i = 0; i < 40; i++) {
    const x = rng.range(margin, t.width - margin);
    const y = rng.range(margin, t.depth - margin);
    if (t.passable(x, y)) return { x, y };
  }
  return { x: t.width / 2, y: t.depth / 2 };
}

/** A dry spot for a cave entrance, as far as possible from every other entrance. */
function caveSpot(w: World, rng: Rng): { x: number; y: number } {
  let best = dryPoint(w, rng, 60);
  let bestD = -1;
  for (let i = 0; i < 40; i++) {
    const p = dryPoint(w, rng, 60);
    let d = Infinity;
    for (const c of w.s.colonies) for (const e of c.entrances) d = Math.min(d, dhypot(e.sx - p.x, e.sy - p.y));
    for (const cv of w.s.caves) for (const e of cv.entrances) d = Math.min(d, dhypot(e.sx - p.x, e.sy - p.y));
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function colonySpots(w: World, n: number, rng: Rng): Array<{ x: number; y: number }> {
  const t = w.terrain;
  const out: Array<{ x: number; y: number }> = [];
  const m = Math.min(t.width, t.depth) * 0.18;
  const cand: Array<{ x: number; y: number }> = [];
  if (n === 1) cand.push({ x: t.width / 2, y: t.depth / 2 });
  else if (n <= 4) {
    // Corners / opposite sides first.
    cand.push({ x: m, y: m }, { x: t.width - m, y: t.depth - m }, { x: t.width - m, y: m }, { x: m, y: t.depth - m });
  } else {
    // Five to seven colonies: evenly round a ring, so every nest has room.
    const a0 = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      cand.push({ x: t.width / 2 + dcos(a) * (t.width / 2 - m * 0.9), y: t.depth / 2 + dsin(a) * (t.depth / 2 - m * 0.9) });
    }
  }
  for (let i = 0; i < n; i++) {
    let p = cand[i] ?? dryPoint(w, rng, m);
    // nudge to dry ground
    for (let k = 0; k < 30 && !t.passable(p.x, p.y); k++) p = { x: p.x + rng.range(-20, 20), y: p.y + rng.range(-20, 20) };
    out.push(p);
  }
  return out;
}

export function spawnRandomFood(w: World, rng: Rng = w.rng, insect = false): void {
  // on an authored map most food falls in its food zones (a quarter anywhere on dry ground)
  const p = w.terrain.layout && rng.chance(0.75) ? zonePoint(w, rng, HF_FOOD, 25) : dryPoint(w, rng, 25);
  // `insect`: an insect (what every ant eats, army ants included), when a colony's own food has run short
  const r = insect ? (rng.next() < 0.6 ? 0.1 : 0.9) : rng.next();
  // keep food away from nest entrances
  for (const c of w.s.colonies) for (const e of c.entrances) if (dhypot(e.sx - p.x, e.sy - p.y) < 40) return;
  for (const cv of w.s.caves) for (const e of cv.entrances) if (dhypot(e.sx - p.x, e.sy - p.y) < 25) return;
  // ...and clear of plants and aphid colonies
  for (const pl of w.s.plants) if (dhypot(pl.x - p.x, pl.y - p.y) < 22) return;
  for (const ap of w.s.aphids) if (dhypot(ap.x - p.x, ap.y - p.y) < 18) return;
  if (r < 0.32) makeFood(w, 'insect', SURFACE, p.x, p.y, rng.range(0.6, 1.4), rng.pick(['fly', 'cricket', 'moth', 'beetle']));
  else if (r < 0.62) {
    // a scatter of seeds
    const n = rng.int(3, 8);
    for (let i = 0; i < n; i++) makeFood(w, 'seed', SURFACE, p.x + rng.range(-8, 8), p.y + rng.range(-8, 8), rng.range(0.8, 1.3));
  } else if (r < 0.82) makeFood(w, 'berry', SURFACE, p.x, p.y, rng.range(0.7, 1.2), rng.pick(['berry', 'apple']));
  else makeFood(w, 'insect', SURFACE, p.x, p.y, rng.range(1.4, 2.2), rng.pick(['cricket', 'grasshopper']));
}

/** One piece of deadwood (a food item of kind 'wood'; `from` = twig, branch, bamboo, palmFrond, log or stump). */
export function placeWood(w: World, rng: Rng, kind: string, x: number, y: number): void {
  const size = NASUTE.wood.size[kind] ?? 10;
  const f = makeFood(w, 'wood', SURFACE, x, y, 1, kind);
  f.amount = f.max = NASUTE.wood.sources[kind] ?? 10;
  f.size = size;
  f.mass = 999; // chewed in place, never carried off whole
  f.h = rng.range(0, Math.PI * 2);
}

export function spawnWood(w: World, rng: Rng = w.rng): void {
  let r = rng.next();
  let kind = 'twig';
  for (const [k, p] of Object.entries(NASUTE.wood.mix)) {
    r -= p;
    if (r <= 0) {
      kind = k;
      break;
    }
  }
  // near a plant's base half the time, else toward the map edge
  let p: { x: number; y: number };
  if (w.s.plants.length && rng.chance(0.5)) {
    const pl = w.s.plants[rng.int(0, w.s.plants.length - 1)];
    const a = rng.range(0, Math.PI * 2);
    p = { x: pl.x + dcos(a) * rng.range(12, 26), y: pl.y + dsin(a) * rng.range(12, 26) };
  } else {
    p = dryPoint(w, rng, 25);
    const t = w.terrain;
    const cx = t.width / 2;
    const cy = t.depth / 2;
    p = { x: cx + (p.x - cx) * 1.15, y: cy + (p.y - cy) * 1.15 };
  }
  const t = w.terrain;
  if (p.x < 25 || p.y < 25 || p.x > t.width - 25 || p.y > t.depth - 25 || !t.passable(p.x, p.y)) return;
  for (const c of w.s.colonies) for (const e of c.entrances) if (dhypot(e.sx - p.x, e.sy - p.y) < 30) return;
  placeWood(w, rng, kind, p.x, p.y);
}

function respawnSystem(w: World, dt: number): void {
  if (w.s.mode.arena) return; // the battle arena has no food
  const rate = w.s.settings.foodRespawn;
  if (rate <= 0) return;
  const area = (w.terrain.width * w.terrain.depth) / 1e4;
  // Keep an amount of food lying around (not a count of items: one seed
  // scatter is many items but little food).
  const want = area * 12 * rate;
  let have = 0;
  for (const f of w.s.food) if (f.space === SURFACE && f.kind !== 'corpse' && f.kind !== 'wood' && f.heldBy === 0 && f.colony !== -2) have += f.amount;
  // ...and enough of what each living ant colony can eat: seeds and berries pile up where only insect-eaters
  // (army ants) live, and the total alone stopped the respawn while they starved (Phase 15)
  let short = false;
  for (const c of w.s.colonies) {
    if (!c.alive || woodSpecies(c.species)) continue;
    let mine = 0;
    for (const f of w.s.food) if (f.space === SURFACE && f.kind !== 'corpse' && f.kind !== 'wood' && f.heldBy === 0 && f.colony !== -2 && edible(c, f)) mine += f.amount;
    if (mine < want * BALANCE.respawnDietShare) short = true;
  }
  if ((have < want || short) && w.rng.chance(dt * 0.3 * rate)) spawnRandomFood(w, w.rng, short && have >= want);
  // Deadwood falls on the same cadence while a termite colony lives (no RNG is drawn otherwise).
  if (w.s.colonies.some((c) => c.alive && woodSpecies(c.species))) {
    let wood = 0;
    let litter = 0;
    for (const f of w.s.food) {
      if (f.kind !== 'wood' || f.space !== SURFACE || f.from === 'chip' || f.from === 'litterchip') continue;
      if (f.from === 'litter') litter += f.amount;
      else wood += f.amount;
    }
    if (wood < want * 0.9 && w.rng.chance(dt * 0.3 * rate)) spawnWood(w);
    // leaf litter keeps falling while a Sickle-Jaw colony lives (no RNG drawn otherwise)
    if (w.s.colonies.some((c) => c.alive && c.species === 'rhynchotermes') && litter < want * 0.6 && w.rng.chance(dt * 0.3 * rate)) spawnLitter(w);
  }
}
