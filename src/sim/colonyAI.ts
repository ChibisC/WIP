import { World } from './world';
import { AphidCluster, AS, Colony, SURFACE, TileType } from './types';
import { CASTES, casteOf, isTermiteSpecies, tierOf } from './species';
import { designateDig } from './colony';
import type { NestGrid } from '../world/nestGrid';
import { buildableTiles, canPlaceTile, hatchCost, placeTile, raisesAnts, tileCost } from './tiles';
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
 * Every couple of seconds it:
 *  1. digs the nest EotU-style (user note, 2026-10-25): round 7-hex chambers
 *     (a centre and its six neighbours, like the queen's chamber) for brood and
 *     for food stores, each joined to the nest by a short tunnel and walled off
 *     from the others by a hex of soil; a new chamber is planned when the free
 *     floor in the chambers runs low;
 *  2. spends food, one tile at a time, in priority order:
 *     - a food store when the stores are nearly full (income would be wasted);
 *     - a species special tile when below its share (pastures, thatch, fungus);
 *     - a brood tile of the caste furthest below the target mix, but only when
 *       the colony can also pay to raise its ant and few tiles are still empty.
 * Groups grow to `GROUP_SIZE` tiles, then a new group is started, so the
 * colony ends up with several commandable groups like a player's.
 */

const THINK_EVERY = 2; // seconds
const GROUP_SIZE = 8;
const FOOD_CAP_MAX = 1600;

export interface BuildBrain {
  t: number;
  /** the last placement found only hexes touching full groups: dig more */
  blocked: boolean;
  /** target fraction of brood tiles per caste */
  mix: Record<string, number>;
  /** planned chambers (centre hex and what goes in it) and the tunnel hexes joining them (kept clear of tiles) */
  chambers?: Array<{ q: number; kind: 'brood' | 'food' }>;
  tunnels?: number[];
}

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
      // Gene Thief: its own workers plus an even share of every borrowed caste.
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

export function buildTick(w: World, c: Colony, dt: number): void {
  if (!c.alive) return;
  const g = w.nest(c.id);
  if (!g) return;
  const b = brainOf(c);
  b.t -= dt;
  if (b.t > 0) return;
  b.t = THINK_EVERY;
  // Termants: the stolen castes change mid-match (the mix follows them); forgetting and carton walls
  if (c.species === 'termant') {
    b.mix = defaultMix(c);
    termantAI(w, c);
  }
  const home = homeHex(w, c);
  const occupied = new Set(c.tiles.map((t) => t.q));
  const free: number[] = [];
  const N = g.cols * g.rows;
  for (let q = 0; q < N; q++) if (g.isHexDug(q) && !g.isEntrance(q) && !occupied.has(q)) free.push(q);

  // Tiles waiting for builders. Digging jobs come before building, so while
  // plans wait the frontier is not extended (or the diggers never get round
  // to building and the colony stops growing), and few plans are made at once.
  let unbuilt = 0;
  for (const t of c.tiles) if (!t.built) unbuilt++;

  // 1. Digging: chambers joined by tunnels (planned one at a time, dug a few hexes at a time).
  const tunnels = new Set(b.tunnels ?? []);
  const roomFree = free.filter((q) => !tunnels.has(q));
  const workers = c.living;
  const wantDesig = Math.max(3, Math.min(16, 3 + Math.floor(workers / 5)));
  // the planned hexes still to dig, nearest the dug nest first (tunnels then rooms)
  const todo = planned(g, b).filter((q) => g.isHexDiggable(q));
  if (!todo.length && ((roomFree.length <= 3 && unbuilt < 2) || b.blocked)) {
    const kind = nextChamberKind(c);
    if (planChamber(w, c, b, home, kind)) b.blocked = false;
  }
  if (g.designatedCount < wantDesig) {
    const plan = planned(g, b).filter((q) => g.isHexDiggable(q) && !g.hexDesig[q]);
    for (const q of plan.slice(0, wantDesig - g.designatedCount)) designateDig(w, c, q, true);
  }

  // 2. Building (in the chambers; the tunnels stay clear).
  if (!roomFree.length) return;
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
  // a) more storage when nearly full
  if (food >= c.foodCap * 0.8 && c.foodCap < FOOD_CAP_MAX && !plannedTile('food')) {
    if (place(w, c, 'food', undefined, roomFree, home)) return;
  }
  // b) species special tiles
  for (const sp of specialTargets(c, broodTiles, counts)) {
    const have = c.tiles.filter((t) => t.type === sp.type).length;
    if (have < sp.want && !plannedTile(sp.type) && food >= tileCost(c, sp.type) + 6) {
      if (place(w, c, sp.type, undefined, roomFree, home)) return;
    }
  }
  // c) brood: the caste furthest below its target share. Young colonies raise
  //    only workers (like real incipient colonies); fighters come once there
  //    is a workforce to feed them. Don't add tiles while brood is backed up,
  //    or while earlier plans still wait for builders.
  if (unfilled > 1 || unbuilt >= 2) return;
  let waiting = 0;
  for (const t of c.tiles) if (raisesAnts(t) && t.brood && !t.ant) waiting++;
  let nurses = 0;
  for (const [cs, n] of Object.entries(c.counts)) if (CASTES[cs].nurse) nurses += n;
  if (waiting > 2 + nurses * 1.5) return;
  // Keep enough food to feed the larvae already waiting on their tiles.
  let reserve = 0;
  for (const br of w.s.brood) if (br.colony === c.id) reserve += hatchCost(br.caste) * Math.max(0, 1 - br.t);
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
  if (!ranked.length) return;
  const need = (cs: string) => tileCost(c, 'brood', cs) + hatchCost(cs) + 4 + reserve;
  // Save up for the most-needed caste when it is well behind; otherwise take
  // the most-needed caste we can afford now.
  const top = ranked[0];
  const pick = food >= need(top.cs) ? top : top.gap >= 2 ? null : ranked.find((r) => r.gap > -1 && food >= need(r.cs));
  if (!pick) return;
  place(w, c, 'brood', pick.cs, roomFree, home);
}

/** What the next chamber is for: stores when the colony's stores are a small share of its tiles, else brood. */
function nextChamberKind(c: Colony): 'brood' | 'food' {
  const b = brainOf(c);
  const food = c.tiles.filter((t) => t.type === 'food').length;
  const brood = c.tiles.filter((t) => t.type !== 'food' && t.type !== 'queen').length;
  const foodRooms = (b.chambers ?? []).filter((r) => r.kind === 'food').length;
  return (foodRooms === 0 && brood >= 4) || food * 4 < brood - 6 ? 'food' : 'brood';
}

/** The chamber a hex belongs to (its centre or one of the six around it). */
function chamberOf(g: NestGrid, b: BuildBrain, q: number): { q: number; kind: 'brood' | 'food' } | null {
  for (const r of b.chambers ?? []) if (r.q === q || g.neighbors(r.q).includes(q)) return r;
  return null;
}

/** Hexes of the planned tunnels and chambers, in digging order (tunnels outward from the nest, then each room). */
function planned(g: NestGrid, b: BuildBrain): number[] {
  const out: number[] = [...(b.tunnels ?? [])];
  for (const r of b.chambers ?? []) {
    out.push(r.q);
    for (const n of g.neighbors(r.q)) if (n >= 0) out.push(n);
  }
  return out;
}

/**
 * Plan the next chamber: a 7-hex rosette of solid soil near the nest (a hex
 * of wall between it and every other room), and the shortest tunnel to it
 * from the dug nest. Deterministic: candidates by distance, ties by hex jitter.
 */
function planChamber(w: World, c: Colony, b: BuildBrain, home: number, kind: 'brood' | 'food'): boolean {
  const g = w.nest(c.id)!;
  const N = g.cols * g.rows;
  const rooms = b.chambers ?? (b.chambers = []);
  const tunnels = b.tunnels ?? (b.tunnels = []);
  const centres = [home, ...rooms.map((r) => r.q)];
  const rosette = (q: number) => [q, ...g.neighbors(q)];
  const ok = (q: number) => {
    const hs = rosette(q);
    if (hs.length !== 7 || hs.some((h) => h < 0 || g.isEntrance(h) || !(g.isHexDiggable(h) || g.isHexDug(h)))) return false;
    // carved out of solid soil, with a wall of soil all round (the tunnel will cut through it)
    if (hs.some((h) => g.isHexDug(h))) return false;
    for (const h of hs) for (const n of g.neighbors(h)) if (n >= 0 && g.isHexDug(n)) return false;
    for (const cq of centres) if (g.hexDistance(q, cq) < 4) return false;
    // no tiles of the colony on it
    for (const t of c.tiles) if (hs.includes(t.q)) return false;
    return true;
  };
  const cands: Array<{ q: number; s: number }> = [];
  for (let q = 0; q < N; q++) {
    let near = Infinity;
    for (const cq of centres) near = Math.min(near, g.hexDistance(q, cq));
    if (near < 4 || near > 7) continue;
    if (!ok(q)) continue;
    // close to the queen's chamber and to the rooms already there
    cands.push({ q, s: g.hexDistance(q, home) + near * 0.5 + jitter(q) * 0.7 });
  }
  cands.sort((x, z) => x.s - z.s);
  const blocked = new Set<number>();
  for (const r of rooms) for (const h of rosette(r.q)) blocked.add(h);
  const prev = new Int32Array(N);
  for (const cand of cands.slice(0, 16)) {
    const best = cand.q;
    // tunnel: breadth-first from the room's rim through soil to the dug nest (not through other rooms)
    const room = new Set(rosette(best));
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
          prev[n] = q;
          hit = n;
          break;
        }
        if (!g.isHexDiggable(n) || g.isEntrance(n)) continue;
        prev[n] = q;
        queue.push(n);
      }
    }
    if (hit < 0) continue;
    const path: number[] = [];
    for (let q = prev[hit]; q >= 0 && !room.has(q); q = prev[q]) path.push(q);
    if (path.length < 1 || path.length > 4) continue; // a short tunnel (1–4 hexes), with a wall of soil beside it
    rooms.push({ q: best, kind });
    for (const q of path) if (!tunnels.includes(q)) tunnels.push(q);
    return true;
  }
  return false;
}

function isFighter(cs: string): boolean {
  const r = CASTES[cs].role;
  return r === 'soldier' || r === 'major';
}

/**
 * Put one tile on the best free hex, as close to the chamber as possible so
 * the nest stays compact. A tile joins a same-kind group only while that
 * group (including any it would merge with) stays within GROUP_SIZE; once
 * groups are full, new ones start one hex away, leaving a gap — so the
 * colony ends up with several commandable groups. Touching a full group is a
 * last resort when the free floor is plentiful but all of it borders one.
 */
function place(w: World, c: Colony, type: TileType, caste: string | undefined, free: number[], home: number): boolean {
  const g = w.nest(c.id)!;
  const sizes = new Map<number, number>();
  for (const t of c.tiles) sizes.set(t.group, (sizes.get(t.group) ?? 0) + 1);
  let bestQ = -1;
  let bestS = Infinity;
  let backupQ = -1;
  let backupS = Infinity;
  for (const q of free) {
    if (canPlaceTile(w, c, type, q, caste)) continue;
    // distinct same-kind groups this tile would touch
    const touch = new Set<number>();
    for (const n of g.neighbors(q)) {
      if (n < 0) continue;
      const t = c.tiles.find((x) => x.q === n);
      if (t && t.type === type && t.caste === caste) touch.add(t.group);
    }
    let merged = 1;
    for (const id of touch) merged += sizes.get(id) ?? 0;
    let s = g.hexDistance(q, home) + jitter(q) * 0.5;
    if (touch.size) s -= 3; // prefer growing a group over scattering singles
    // its own kind of chamber: brood in brood chambers, stores in store chambers
    const room = chamberOf(g, brainOf(c), q);
    if (room) s += room.kind === (type === 'food' ? 'food' : 'brood') ? -4 : 3;
    // keep the hexes beside entrance ramps clear (traffic)
    if (g.neighbors(q).some((n) => n >= 0 && g.isEntrance(n))) s += 6;
    if (merged <= GROUP_SIZE || (type !== 'brood' && type !== 'food')) {
      if (s < bestS) {
        bestS = s;
        bestQ = q;
      }
    } else if (s < backupS) {
      backupS = s;
      backupQ = q;
    }
  }
  brainOf(c).blocked = bestQ < 0;
  const q = bestQ >= 0 ? bestQ : free.length > 40 ? backupQ : -1;
  if (q < 0) return false;
  return !!placeTile(w, c, type, q, caste);
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
    if (f.kind === 'leaf' && !cut) return false;
    if (!edible(c, f)) return false;
    v += f.kind === 'wood' && c.species === 'termant' ? f.amount * woodWant(c) : f.amount;
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
