import { termantKingSpot } from './termants';
import { World } from './world';
import { distToQueenBody, kingSpot, queenBody, queenSpot } from './termites';
import { NestGrid, hexRadiusFor } from '../world/nestGrid';
import { Ant, AS, Carry, Colony, MARKER_COUNT, SURFACE, Task, TileType, nestSpace, snapping } from './types';
import { CASTES, SPECIES, SpeciesId, basicCaste, casteOf, isSoldierCaste, naniticCaste } from './species';
import { makeAnt, makeBrood } from './factory';
import { applyLevel, hexSpeedOf, placeTile, popUsed, raisesAnts, recomputeGroups, recomputeTileCaps, tileAnts, tileAt, tileCapacity } from './tiles';
import { BALANCE, NASUTE } from './balance';
import { assignJobs, isJobWorker } from './jobs';
import { applyGroupOrders, nearestWalkable } from './markers';
import { abilityActive, abilityTick } from './abilities';
import { buildTick, forageTick } from './colonyAI';
import { warTick } from './warAI';
import { dcos, dhypot, dsin, sq } from './dmath';
import { ENTRANCE } from './balance';
import { designateSpot, entranceTick, makeEntrance, markSpots, nestToSurface, openDugSpots } from './entrances';

/** Nest plane size in hexes (the same for every species; hex radius scales instead). */
export const NEST_COLS = 34;
export const NEST_ROWS = 30;

// ---------------------------------------------------------------------------
// Tile geometry helpers
// ---------------------------------------------------------------------------

/** Random walkable point inside hex q (spread = fraction of the hex radius). */
export function tilePoint(w: World, c: Colony, q: number, spread = 0.7): { x: number; y: number } {
  const g = w.nest(c.id)!;
  const ctr = g.hexCenter(q);
  for (let i = 0; i < 24; i++) {
    const a = w.rng.range(0, Math.PI * 2);
    const r = Math.sqrt(w.rng.next()) * g.R * spread;
    const x = ctr.x + dcos(a) * r;
    const y = ctr.y + dsin(a) * r;
    if (g.insideHex(x - ctr.x, y - ctr.y, 0.92) && g.isAirAt(x, y)) return { x, y };
  }
  return { x: ctr.x, y: ctr.y };
}

/** Air cells of all tiles of a type (optionally one caste). */
export function tileCellsOfType(w: World, c: Colony, type: TileType, caste?: string): number[] {
  const g = w.nest(c.id);
  if (!g) return [];
  const out: number[] = [];
  for (const t of c.tiles) if (t.type === type && (!caste || t.caste === caste)) for (const k of g.hexCells[t.q]) if (g.isAirIdx(k)) out.push(k);
  return out;
}

/** Air cells of one hex near its centre. */
export function hexCoreCells(g: NestGrid, q: number, frac = 0.5): number[] {
  const ctr = g.hexCenter(q);
  const out: number[] = [];
  const r2 = sq(g.R * frac);
  for (const k of g.hexCells[q]) {
    if (!g.isAirIdx(k)) continue;
    const x = ((k % g.w) + 0.5) * g.cell - ctr.x;
    const y = (Math.floor(k / g.w) + 0.5) * g.cell - ctr.y;
    if (x * x + y * y <= r2) out.push(k);
  }
  return out.length ? out : g.airCellsOfHex(q);
}

export { nestToSurface } from './entrances';

/** Where a colony's main entrance opens on an authored map's site (its authored entrance hex), or null. */
function siteEntrance(w: World, c: Colony): { x: number; y: number } | null {
  const L = w.terrain.layout;
  if (!L || c.site === undefined) return null;
  const s = L.sites[c.site];
  if (!s || !s.entrances.length) return null;
  const q = s.entrances[0];
  return { x: L.hex.centerX(q), y: L.hex.centerY(q) };
}

// ---------------------------------------------------------------------------
// Colony creation
// ---------------------------------------------------------------------------

export interface ColonyOptions {
  species: SpeciesId;
  player: boolean;
  ai: boolean;
  name?: string;
  nx: number;
  ny: number;
  /** custom colony: borrowed castes */
  borrowed?: string[];
  startFood?: number;
  /** extra worker brood tiles beyond the queen's chamber (rivals, tests) */
  startWorkers?: number;
  /** population limit (brood tile slots) */
  popLimit?: number;
  /** pre-built larger nest (rival AI head start): number of extra brood tiles */
  developed?: number;
  /** team: colonies on the same team are allies (default: a team of its own) */
  team?: number;
  /** the authored map's site index the colony stands on */
  site?: number;
}

export function createColony(w: World, o: ColonyOptions): Colony {
  const id = w.s.colonies.length;
  const sp = SPECIES[o.species];
  const castes = [...sp.castes, ...(o.borrowed ?? []).filter((c) => !sp.castes.includes(c) && CASTES[c] && CASTES[c].role !== 'queen')];
  const c: Colony = {
    id,
    species: o.species,
    name: o.name ?? sp.common,
    player: o.player,
    ai: o.ai,
    team: o.team ?? id,
    alive: true,
    food: o.startFood ?? 50,
    foodCap: 70,
    fungus: o.species === 'atta' ? 20 : 0,
    queen: 0,
    castes,
    tiles: [],
    groups: [],
    nextGroupId: 1,
    tileVersion: 0,
    entrances: [],
    markers: Array.from({ length: MARKER_COUNT }, () => ({ placed: false, space: SURFACE, x: 0, y: 0 })),
    eggT: 3,
    eggs: 1,
    starving: false,
    popLimit: o.popLimit ?? 300,
    workers: 0,
    workersMax: 0,
    soldiers: 0,
    soldiersMax: 0,
    failsafeT: 0,
    hexSpeed: null,
    fungusCap: 0,
    aggressive: true,
    abilityCd: 0,
    abilityT: 0,
    nx: o.nx,
    ny: o.ny,
    ...(o.site !== undefined ? { site: o.site } : {}),
    stats: { born: 0, died: 0, food: 0, kills: 0, lostQueen: false, peakPop: 0, stolen: 0 },
    recall: false,
    alarmT: 0,
    aiT: 0,
    aiMode: 'grow',
    counts: {},
    pop: 0,
    living: 0,
    broodCount: 0,
    invincibleQueen: false,
    infiniteFood: false,
    aggression: 1,
    color: sp.color,
    spoil: [],
    aiPlan: 0,
  };
  w.s.colonies.push(c);
  w.colonyById.set(id, c);
  w.phero.ensureColonies(w.s.colonies.length);

  // ---- Nest plane: queen cluster in the middle, a tunnel to the entrance ramp.
  const R = hexRadiusFor(casteOf(basicCaste(o.species)).length);
  const g = new NestGrid({ cols: NEST_COLS, rows: NEST_ROWS, R, seed: w.s.seed * 13 + id * 101 + 7 });
  const q0 = g.hexIndex(Math.floor(NEST_COLS / 2) + w.rng.int(-2, 2), Math.floor(NEST_ROWS / 2) + w.rng.int(-1, 1));
  // Starting area: hexes within 2 steps of the queen's hex.
  const start: number[] = [];
  for (let q = 0; q < g.cols * g.rows; q++) if (g.hexDistance(q, q0) <= 2) start.push(q);
  // Tunnel north to the entrance ramp. Fire ants build a mound with no opening in the middle:
  // their way out is a long foraging tunnel that surfaces well away from it.
  const path: number[] = [];
  let cur = q0;
  const dirs = o.species === 'solenopsis' ? [5, 5, 5, 0, 5, 0, 0, 5, 0, 0, 5, 5, 0, 5, 5] : [5, 5, 0, 5, 5, 4, 5, 5];
  for (let i = 0; i < dirs.length; i++) {
    const n = g.neighbors(cur)[dirs[i]];
    if (n < 0) break;
    cur = n;
    path.push(n);
  }
  const entQ = path[path.length - 1];
  for (const q of [...start, ...path]) {
    g.softenHex(q);
    g.completeHex(q);
  }
  // The main entrance: the last hexes of the passage form its tunnel, rising to the hole.
  g.addEntrance(path.slice(-ENTRANCE.tunnelLen).reverse());
  w.addNest(id, g);

  // Entrance on the surface.
  const ep = g.hexCenter(entQ);
  const proj = nestToSurface(w, c, ep.x, ep.y);
  const es = siteEntrance(w, c) ?? nearestWalkable(w, proj.x, proj.y) ?? proj;
  c.entrances.push(makeEntrance(entQ, es.x, es.y, w.time));
  c.spoil.push(0);
  // Marked extra-entrance spots further out (the player digs one out to open another entrance).
  markSpots(w, c, g, q0, [...start, ...path]);

  // ---- The queen's chamber: her hex and the six around it. Each queen tile stores 10 food
  // and raises one nanitic worker (the queen's small first brood). The colony starts with
  // the queen and three of them; workers bring eggs to the other four.
  const nb0 = g.neighbors(q0);
  for (const q of [q0, ...nb0]) if (q >= 0) placeTile(w, c, 'queen', q, undefined, true);
  const free = () => start.filter((q) => !tileAt(c, q) && !g.isEntrance(q));
  const base = basicCaste(o.species);
  // Optional extra worker brood tiles (rival head starts, tests) on the far side from the tunnel.
  const nW = o.startWorkers ?? 0;
  if (nW > 0) {
    const ring = free().filter((q) => g.hexDistance(q, q0) === 2);
    const seed = ring.sort((a, b) => g.hexDistance(a, path[0]) - g.hexDistance(b, path[0])).pop() ?? free()[0];
    for (const q of growCluster(g, free(), seed, nW)) placeTile(w, c, 'brood', q, base, true);
  }
  if (o.species === 'atta') {
    // Leafcutters start with a fungus garden and a few minims to tend it.
    for (const q of free().slice(0, 2)) placeTile(w, c, 'fungus', q, undefined, true);
    const minims = growCluster(g, free(), free().sort((a, b) => g.hexDistance(a, nb0[3]) - g.hexDistance(b, nb0[3]))[0], 2);
    for (const q of minims) placeTile(w, c, 'brood', q, 'atta_minim', true);
  }
  if (o.developed) developNest(w, c, o.developed);
  recomputeGroups(w, c);
  recomputeTileCaps(c);

  // ---- Queen and her first workers (already raised on their tiles).
  const qp = tilePoint(w, c, q0, 0.3);
  const qh = w.rng.range(0, Math.PI * 2);
  // Termites: the long physogastric queen lies along the royal chamber, centred on it, and the king
  // stands beside her (two separate bodies).
  const qs = casteOf(sp.queen).termite ? queenSpot(w, c, q0, sp.queen, qh) : { x: qp.x, y: qp.y, h: qh };
  const queen = makeAnt(w, id, sp.queen, nestSpace(id), qs.x, qs.y, qs.h);
  queen.task = 'idle';
  c.queen = queen.id;
  if (sp.king) {
    const kp = { x: 0, y: 0, h: 0 };
    if (casteOf(sp.king).termite) kingSpot(w, queen, sp.king, kp);
    else termantKingSpot(w, queen, kp); // Termants: an ant-built king, beside the queen's thorax
    const king = makeAnt(w, id, sp.king, nestSpace(id), kp.x, kp.y, kp.h);
    king.task = 'idle';
    c.king = king.id;
  }
  // starting food (set after the tiles: placing them re-clamps food to the capacity so far)
  c.food = Math.min(c.foodCap, o.startFood ?? 50);
  let nanitics = BALANCE.startWorkers;
  for (const t of c.tiles) {
    if (!raisesAnts(t)) continue;
    if (t.type === 'queen') {
      if (nanitics-- > 0) spawnTileAnt(w, c, t.q, t.caste!);
    } else spawnTileAnt(w, c, t.q, t.caste!);
  }
  countColony(w, c);
  return c;
}

/** Up to n connected free hexes grown outward from a seed (BFS). */
function growCluster(g: NestGrid, free: number[], seed: number, n: number): number[] {
  const ok = new Set(free);
  const out: number[] = [];
  if (!ok.has(seed)) seed = free[0];
  const queue = [seed];
  const seen = new Set<number>([seed]);
  while (queue.length && out.length < n) {
    const q = queue.shift()!;
    if (!ok.has(q)) continue;
    out.push(q);
    for (const m of g.neighbors(q)) if (m >= 0 && !seen.has(m) && ok.has(m)) {
      seen.add(m);
      queue.push(m);
    }
  }
  return out;
}

/** Spawn an adult bound to a brood tile (level start / sandbox fill). */
export function spawnTileAnt(w: World, c: Colony, q: number, caste: string): Ant | null {
  const t = tileAt(c, q);
  if (!t) return null;
  const p = tilePoint(w, c, q, 0.55);
  const a = makeAnt(w, c.id, caste, nestSpace(c.id), p.x, p.y, w.rng.range(0, Math.PI * 2));
  bindAntToTile(c, a, t.q);
  a.task = 'idle';
  return a;
}

export function bindAntToTile(c: Colony, a: Ant, q: number): void {
  const t = tileAt(c, q);
  if (!t) return;
  a.tile = q;
  applyLevel(a, t.level);
  if (!t.ant) t.ant = a.id;
  else t.ant2 = a.id;
  t.wait = 0;
}

/** A pre-built nest for rival colonies: dig outward and fill with tiles of the species mix. */
function developNest(w: World, c: Colony, extra: number): void {
  const g = w.nest(c.id)!;
  const sp = SPECIES[c.species];
  const plan: Array<{ type: TileType; caste?: string }> = [];
  const castes = c.castes.filter((cs) => CASTES[cs].role !== 'queen');
  const wsum = castes.reduce((s, cs) => s + (sp.ratio[cs] ?? 0.2), 0);
  for (const cs of castes) {
    const n = Math.round((extra * (sp.ratio[cs] ?? 0.2)) / wsum);
    for (let i = 0; i < n; i++) plan.push({ type: 'brood', caste: cs });
  }
  plan.push({ type: 'food' }, { type: 'food' });
  // BFS outward over diggable hexes from the existing floor.
  const queen = c.tiles.find((t) => t.type === 'queen')!;
  const seen = new Set<number>([queen.q]);
  const queue = [queen.q];
  let i = 0;
  while (queue.length && i < plan.length) {
    const q = queue.shift()!;
    for (const n of g.neighbors(q)) {
      if (n < 0 || seen.has(n) || g.hexSoil[n] === 255) continue;
      seen.add(n);
      queue.push(n);
      if (g.isEntrance(n) || g.shafts.includes(n)) continue;
      if (!g.isHexDug(n)) g.completeHex(n);
      if (tileAt(c, n)) continue;
      const p = plan[i];
      // keep tiles of the same caste together: place in plan order (already grouped)
      if (p.type === 'brood' && popUsed(c) + 1 > c.popLimit) {
        i++;
        continue;
      }
      placeTile(w, c, p.type, n, p.caste, true);
      i++;
      if (i >= plan.length) break;
    }
  }
}

// ---------------------------------------------------------------------------
// Player commands: digging
// ---------------------------------------------------------------------------

/** Mark (or unmark) a hex of soil for the workers to excavate. */
export function designateDig(w: World, c: Colony, q: number, on: boolean): boolean {
  const g = w.nest(c.id);
  if (!g || q < 0 || !g.isHexDiggable(q)) return false;
  // an extra-entrance spot is dug out whole (sim/entrances.ts)
  const sp = g.spotIndex(q);
  if (sp >= 0) return designateSpot(w, c, sp, on);
  g.designateHex(q, on);
  return true;
}

// ---------------------------------------------------------------------------
// Entrances
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-second colony bookkeeping
// ---------------------------------------------------------------------------

export function countColony(w: World, c: Colony): void {
  const counts: Record<string, number> = {};
  let living = 0;
  for (const a of w.s.ants) {
    if (a.colony !== c.id || a.state === AS.Dead || a.id === c.queen || a.id === c.king) continue;
    counts[a.caste] = (counts[a.caste] ?? 0) + 1;
    living++;
  }
  let brood = 0;
  for (const b of w.s.brood) if (b.colony === c.id) brood++;
  c.counts = counts;
  c.living = living;
  c.pop = popUsed(c);
  c.broodCount = brood;
  c.stats.peakPop = Math.max(c.stats.peakPop, living);
  // Workers and soldiers, active / maximum (max = brood capacity; the queen is not counted).
  let wk = 0;
  let so = 0;
  for (const [cs, n] of Object.entries(counts)) {
    if (isSoldierCaste(cs)) so += n;
    else wk += n;
  }
  let wMax = 0;
  let sMax = 0;
  for (const t of c.tiles) {
    if (!raisesAnts(t)) continue;
    if (isSoldierCaste(t.caste!)) sMax += tileCapacity(t);
    else wMax += tileCapacity(t);
  }
  c.workers = wk;
  c.soldiers = so;
  c.workersMax = wMax;
  c.soldiersMax = sMax;
}

/** Keep tile ↔ ant ↔ brood links consistent (deaths, removals, lost brood). */
function auditTiles(w: World, c: Colony): void {
  for (const t of c.tiles) {
    if (!raisesAnts(t)) continue;
    for (const slot of ['ant', 'ant2'] as const) {
      const id = t[slot];
      if (!id) continue;
      const a = w.antById.get(id);
      if (!a || a.state === AS.Dead || a.tile !== t.q) t[slot] = 0;
    }
    if (!t.ant && t.ant2) {
      t.ant = t.ant2;
      t.ant2 = 0;
    }
    if (t.brood && !w.broodById.get(t.brood)) t.brood = 0;
  }
}

/** Called when an ant dies: its tile's waiting larva resumes (or a fresh egg is fetched). */
export function onAntDied(w: World, a: Ant): void {
  const c = w.colony(a.colony);
  if (!c || a.tile < 0) return;
  const t = tileAt(c, a.tile);
  if (!t) return;
  if (t.ant === a.id) {
    t.ant = t.ant2;
    t.ant2 = 0;
  } else if (t.ant2 === a.id) t.ant2 = 0;
}

/**
 * The queen always has an egg ready inside her (as in EotU; user note 2026-10-25: "they should get eggs out of the
 * queen no matter what"): a free worker walks to the tip of her abdomen, pulls one out and carries it to an empty
 * brood tile (sim/jobs.ts), however many come at once. How fast the colony grows is set by its brood tiles, the
 * workers carrying eggs and the food the larvae eat. (It was one egg every `eggInterval` s, which left all but a
 * couple of free workers idle while brood tiles stood empty.) Nothing piles up beside her.
 */
function queenLay(w: World, c: Colony, dt: number): void {
  for (const t of c.tiles) if (t.wait > 0) t.wait -= dt;
  const q = w.antById.get(c.queen);
  c.eggs = q && q.state !== AS.Dead ? BALANCE.eggPileMax : 0;
  void dt;
}

const qb = { ax: 0, ay: 0, bx: 0, by: 0, r: 0 }; // det-ok: scratch

/** Weighted nest paths: each fine cell costs 1 / (speed on its hex). */
export function updateFlowCosts(w: World, c: Colony): void {
  const flow = w.flow(c.id);
  const g = w.nest(c.id);
  if (!flow || !g || flow.costVersion === c.tileVersion) return;
  const sp = hexSpeedOf(w, c);
  const cost = new Float32Array(g.w * g.h).fill(1);
  for (let q = 0; q < sp.length; q++) {
    if (sp[q] === 1) continue;
    const k = 1 / sp[q];
    for (const cell of g.hexCells[q]) cost[cell] = k;
  }
  // Termites hug the walls: open cells beside soil are a little cheaper to walk.
  if (SPECIES[c.species].kind === 'termite') {
    for (let y = 1; y < g.h - 1; y++)
      for (let x = 1; x < g.w - 1; x++) {
        const k = y * g.w + x;
        if (!g.isAirIdx(k)) continue;
        if (!g.isAirIdx(k - 1) || !g.isAirIdx(k + 1) || !g.isAirIdx(k - g.w) || !g.isAirIdx(k + g.w)) cost[k] *= NASUTE.wallHug;
      }
    // a physogastric queen's abdomen is a body to walk around, not through (she never moves)
    const q = w.antById.get(c.queen);
    if (q && q.state !== AS.Dead) {
      queenBody(q, qb);
      const pad = qb.r + g.cell * 0.5;
      const x0 = Math.max(0, Math.floor((Math.min(qb.ax, qb.bx) - pad) / g.cell));
      const x1 = Math.min(g.w - 1, Math.floor((Math.max(qb.ax, qb.bx) + pad) / g.cell));
      const y0 = Math.max(0, Math.floor((Math.min(qb.ay, qb.by) - pad) / g.cell));
      const y1 = Math.min(g.h - 1, Math.floor((Math.max(qb.ay, qb.by) + pad) / g.cell));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) if (distToQueenBody(q, (x + 0.5) * g.cell, (y + 0.5) * g.cell) < g.cell * 0.5) cost[y * g.w + x] *= 4;
    }
  }
  flow.setCosts(cost, c.tileVersion);
}

/** Failsafe: a colony with no workers and no food gets one free nanitic, so it can recover. */
function failsafe(w: World, c: Colony, dt: number): void {
  if (c.failsafeT > 0) c.failsafeT -= dt;
  if (c.workers > 0 || c.food >= 1 || c.failsafeT > 0) return;
  const q = w.antById.get(c.queen);
  if (!q || q.state === AS.Dead) return;
  const t = c.tiles.find((x) => x.type === 'queen' && tileAnts(w, x).length < tileCapacity(x)) ?? c.tiles.find((x) => x.type === 'queen');
  if (!t) return;
  c.failsafeT = BALANCE.failsafeEvery;
  const a = spawnTileAnt(w, c, t.q, naniticCaste(c.species));
  if (a && c.player) w.events.emit({ t: 'message', text: 'With no workers and no food left, the queen raised a nanitic from her own reserves.', kind: 'info', colony: c.id });
}

/** Atta: fungus garden converts cut leaves into food. */
function fungusFarm(w: World, c: Colony, dt: number): void {
  const cap = c.fungusCap;
  if (cap <= 0) {
    c.fungus = Math.min(c.fungus, 20);
    return;
  }
  let gardeners = 0;
  for (const a of w.s.ants) if (a.colony === c.id && a.task === 'garden') gardeners++;
  const rate = (0.25 + Math.min(1, gardeners / 4) * 0.5) * dt;
  const conv = Math.min(c.fungus, rate * (1 + cap / 160));
  c.fungus -= conv;
  c.food = Math.min(c.foodCap, c.food + conv * BALANCE.atta.fungusToFood);
  c.fungus = Math.min(cap, c.fungus);
}

/** Root-aphid pastures (Lasius) trickle honeydew; tended by nurses in the nest. */
function aphidPastures(w: World, c: Colony, dt: number): void {
  let n = 0;
  for (const t of c.tiles) if (t.type === 'aphid') n += 1 + 0.25 * (t.level - 1);
  if (n > 0) c.food = Math.min(c.foodCap, c.food + n * 0.08 * dt);
}

// ---------------------------------------------------------------------------
// Task allocation for ants in the home column (response-threshold style)
// ---------------------------------------------------------------------------

const TASK_LOCK = 8; // seconds an ant keeps a task before it may be re-assigned

export function allocateTasks(w: World, c: Colony): void {
  applyGroupOrders(w, c);
  // Nest jobs first: dig → build/upgrade/delete → spawn (sim/jobs.ts).
  assignJobs(w, c);
  const workers: Ant[] = [];
  const soldiers: Ant[] = [];
  for (const a of w.s.ants) {
    if (a.colony !== c.id || a.state === AS.Dead || a.id === c.queen || a.id === c.king || a.marker >= 0 || a.task === 'job') continue;
    if (isJobWorker(c, a)) workers.push(a);
    else soldiers.push(a);
  }
  const W = workers.length;
  const counts: Record<Task, number> = { idle: 0, forage: 0, job: 0, haul: 0, garden: 0, tend: 0, guard: 0, marker: 0, cut: 0, raid: 0 };
  for (const a of workers) counts[a.task]++;
  const want: Partial<Record<Task, number>> = {};
  // Hauling: the colony's dead and food lying on the home nest floor (seeds from deleted tiles, dropped loads).
  let haulWork = 0;
  const home = nestSpace(c.id);
  for (const f of w.s.food) {
    if (f.heldBy || f.space !== home || f.colony === -2) continue;
    if (f.kind !== 'corpse') haulWork++;
  }
  // the Home column's "no gathering" order: nobody carries food to the stores (or goes out for it)
  const noGather = !!c.homeOrders?.noGather;
  want.haul = noGather ? 0 : Math.min(haulWork, Math.ceil(W * 0.25));
  const hasGarden = c.fungusCap > 0;
  want.garden = hasGarden ? Math.min(Math.ceil(W * 0.2), 2 + Math.ceil(c.fungusCap / 60)) : 0;
  // EotU: home workers stay in the nest (jobs, eggs, hauling, gardens); food is
  // gathered by groups sent to markers. Mass recruitment (Lasius) is the
  // exception: while it runs, idle home workers pour out to forage round the nest.
  want.forage = abilityActive(c) && c.species === 'lasius' && !c.recall && !noGather ? W : 0;
  if (c.recall) for (const a of workers) if (a.task === 'forage' || a.task === 'tend') setTask(w, a, 'guard');

  const order: Task[] = ['haul', 'garden', 'forage'];
  for (const t of order) {
    let excess = counts[t] - (want[t] ?? 0);
    if (excess <= 0) continue;
    for (const a of workers) {
      if (excess <= 0) break;
      // foragers are called back at once (EotU: no foraging from home); other chores finish their stint
      if (a.task !== t || (t !== 'forage' && a.taskT < TASK_LOCK) || a.carry !== Carry.None) continue;
      setTask(w, a, 'idle');
      counts[t]--;
      excess--;
      counts.idle++;
    }
  }
  for (const a of workers) {
    if (a.task !== 'idle' && a.task !== 'guard' && a.task !== 'marker') continue;
    if ((a.task === 'guard' && !c.recall) || a.task === 'marker') setTask(w, a, 'idle');
    if (c.recall) {
      if (a.space === SURFACE || a.task === 'idle') setTask(w, a, 'guard');
      continue;
    }
    const cd = casteOf(a.caste);
    let best: Task | null = null;
    let bestNeed = 0;
    for (const t of order) {
      if (t === 'garden' && !cd.garden) continue;
      const need = ((want[t] ?? 0) - counts[t]) / Math.max(1, want[t] ?? 1);
      const thr = Math.abs(dsin(a.id * 12.9898 + t.length)) * 0.4;
      if (need > thr && need > bestNeed) {
        bestNeed = need;
        best = t;
      }
    }
    if (best) {
      setTask(w, a, best);
      counts[best]++;
      counts.idle--;
    } else if (cd.garden && hasGarden) setTask(w, a, 'garden');
  }
  // Home soldiers defend the nest (they never take nest jobs).
  for (const a of soldiers) {
    if (a.task !== 'guard' && a.state !== AS.Attack && a.state !== AS.Grapple && !snapping(a.state)) setTask(w, a, 'guard');
  }
}

export function setTask(w: World, a: Ant, t: Task): void {
  if (a.task === t) return;
  a.task = t;
  a.taskT = 0;
  // a fight in progress keeps its target; anything else starts afresh
  if (a.state === AS.Grapple || a.state === AS.Attack || a.state === AS.Spray || a.state === AS.Flung || snapping(a.state)) return;
  a.tgt = 0;
  a.tk = 0;
  a.state = AS.Idle;
}

export function dropCarried(w: World, a: Ant): void {
  if (a.carry === Carry.None) return;
  if (a.carry === Carry.Brood) {
    const b = w.broodById.get(a.carryId);
    if (b) {
      b.carrier = 0;
      b.x = a.x;
      b.y = a.y;
    }
  } else if (a.carry === Carry.Food || a.carry === Carry.Corpse || a.carry === Carry.Leaf) {
    const f = w.foodById.get(a.carryId);
    if (f) {
      f.heldBy = 0;
      f.space = a.space;
      f.x = a.x + dcos(a.h) * 1.5;
      f.y = a.y + dsin(a.h) * 1.5;
    }
  }
  a.carry = Carry.None;
  a.carryId = 0;
  a.carryAmt = 0;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export function colonySystem(w: World, dt: number): void {
  // battle arena: the colonies are teams with no economy — no eggs, no nanitics, no jobs, never lost (sim/arena.ts)
  const arena = !!w.s.mode.arena;
  // entrances: plugging work, and fallen colonies' entrances caving in (every colony, dead or alive)
  if (!arena && w.s.tick % 20 === 0) entranceTick(w, 1);
  for (const c of w.s.colonies) {
    if (!c.alive) continue;
    if (c.infiniteFood) c.food = c.foodCap;
    abilityTick(c, dt);
    if (c.alarmT > 0) c.alarmT -= dt;
    if (arena) {
      if (w.s.tick % 20 === 0) countColony(w, c);
      continue;
    }
    queenLay(w, c, dt);
    failsafe(w, c, dt);
    if (c.ai) {
      buildTick(w, c, dt);
      forageTick(w, c, dt);
      warTick(w, c, dt);
    }
    if (w.s.tick % 20 === 0) {
      updateFlowCosts(w, c);
      auditTiles(w, c);
      countColony(w, c);
      recomputeTileCaps(c);
      openDugSpots(w, c);
      fungusFarm(w, c, 1);
      aphidPastures(w, c, 1);
      allocateTasks(w, c);
      c.food = Math.min(c.food, c.foodCap);
      // Queen death → colony lost (unless toggled off). One queen per colony and no replacement queens (user note)
      const q = w.antById.get(c.queen);
      if ((!q || q.state === AS.Dead) && c.alive) {
        c.stats.lostQueen = true;
        if (w.s.settings.queenDeathLoses || !c.player) {
          c.alive = false;
          w.events.emit({ t: 'colonyLost', colony: c.id });
        }
      }
    }
  }
}
