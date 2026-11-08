import { World } from './world';
import { AS, Ant, Brood, Carry, Colony, HIT, NestFloodState, POSE, SURFACE, colonyOfSpace, nestSpace, snapping } from './types';
import { NEST_FLOOD } from './balance';
import { NestGrid, SOIL_STONE } from '../world/nestGrid';
import { casteOf } from './species';
import { enterState, goToNestPoint, killAnt } from './antAI';
import { dropCarried } from './colony';
import { endJob } from './jobs';
import { exitFieldIn, followNest } from './movement';
import { entranceTop } from './entrances';
import { dhypot, dsin, sq } from './dmath';
import { startAllOut } from './warAI';

/**
 * A nest flooding (claude/story/06-spec-levels-5-7-and-lengths.md §4, level 6 "High Water"; NEST_FLOOD in balance.ts;
 * DESIGN.md 3.12c). Nothing floods unless a story (or the dev URL `?floodNest=`) calls `startNestFlood`.
 *
 * **The water.** It pours in at the entrance, runs down the tunnels and pools in the lowest part of the nest first, then
 * rises back up toward the entrance. The nest plane is flat, so "low" is how far a hex lies from the entrance's top
 * along the tunnels (a breadth-first walk over the open hexes: real nests run downhill from their entrance, and the
 * galleries farthest in are the deepest); among hexes as far in, the one farther from the entrance in a straight line
 * goes first, then the lower index. The open volume (dug hexes and hexes being dug) fills at a steady inflow, one hex
 * at a time, in about `fillSec`: a big chamber takes longer than a tunnel, and the waterline (the smallest depth under
 * water) climbs toward the entrance; the entrance's own hexes go last. Hexes dug while it fills join the volume.
 *
 * **Under water** (an ant, the queen, a brood item or a creature on a flooded hex): it holds its breath `breathS`, then
 * loses `drownFrac` of its maximum health a second (creatures `creatureDrownFrac`; brood is dead `broodS` later) until
 * it drowns (`HIT.DROWN`); breath comes back out of the water. Ants swim at `swimMul` of their speed. A full nest drowns
 * everything left inside; the queen's death ends the colony by the usual rule (colony.ts).
 *
 * **Higher ground.** The colony's ants at home keep at their work until the water comes within `keepAbove` hexes of them;
 * then they drop what they are doing and climb toward the entrance (the exit field) until they are `keepAbove` + 1
 * hexes above the water, and wait there, climbing again as it rises (Lasius do not raft); free workers carry brood
 * lying just above the water (`rescueAhead`) up with them. Ants of other colonies and the colony's groups out at a
 * marker keep their orders. Food, leaves and soil are washed out of the jaws in the water.
 *
 * **Tiles** on flooded hexes stop working (jobs.ts, brood.ts, colony.ts, tiles.ts): no eggs are delivered and larvae stop
 * growing, nothing is built, upgraded or taken apart, stores and the queen's chamber hold nothing — their capacity is
 * gone, so the food above what the dry stores hold is lost (washed out and spoiled) — and pastures and warming tiles
 * give nothing; loose food on flooded hexes floats off and is lost (corpses stay). No hex under water, or reached only
 * from water, can be dug; the queen lays no eggs while her hex is under water. The water never drains (a level's river).
 *
 * State: `Colony.nestFlood` (plain data, saved and replayed); the plan and the mask of flooded hexes are caches on the
 * World (`floodCache`), a pure function of the grid and that state.
 */

/** Per nest space: the fill plan for the grid as it is, and the hexes under water (World.floodCache; never saved). */
export interface FloodCache {
  /** the grid state the plan was made for (NestGrid.stateVersion) */
  ver: number;
  /** each hex's depth: hex steps along the open hexes from the entrance's top; −1 not open */
  depth: Int16Array;
  /** the open hexes, deepest first (the fill order) */
  order: number[];
  /** the next hex up toward the entrance along the tunnels (−1 at the top, or not open) */
  up: Int32Array;
  /** 1: under water, by hex */
  mask: Uint8Array;
  /** how many of `Colony.nestFlood.q` the mask holds */
  n: number;
  /** the waterline: the smallest depth under water (Infinity while dry) */
  top: number;
}

// ---------------------------------------------------------------------------------------------------------------
// The plan and the mask
// ---------------------------------------------------------------------------------------------------------------

/** Open to the water: dug, or being dug (its air cells take water). Stone never. */
function isOpen(g: NestGrid, q: number): boolean {
  if (g.isHexDug(q)) return true;
  return g.hexSoil[q] !== SOIL_STONE && g.hexProgress(q) > 0;
}

/** The fill plan: each open hex's depth from the entrance's top and the order the water fills them. */
function plan(g: NestGrid, fc: FloodCache): void {
  const N = g.cols * g.rows;
  const depth = fc.depth;
  const up = fc.up;
  depth.fill(-1);
  up.fill(-1);
  const tops = entranceTop(g);
  const queue: number[] = [];
  for (const q of tops.length ? tops : g.entrances) {
    if (q < 0 || depth[q] >= 0 || !isOpen(g, q)) continue;
    depth[q] = 0;
    queue.push(q);
  }
  let maxD = 0;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    for (const n of g.neighbors(q)) {
      if (n < 0 || depth[n] >= 0 || !isOpen(g, n)) continue;
      depth[n] = depth[q] + 1;
      up[n] = q;
      if (depth[n] > maxD) maxD = depth[n];
      queue.push(n);
    }
  }
  // (an open pocket the tunnels do not reach — none in a normal nest — fills first)
  const order: number[] = [];
  for (let q = 0; q < N; q++) {
    if (!isOpen(g, q)) continue;
    if (depth[q] < 0) depth[q] = maxD + 1;
    order.push(q);
  }
  const ctr = g.hexCenter(g.entrances[0] ?? tops[0] ?? 0);
  const far = new Float64Array(N);
  const p = { x: 0, y: 0 };
  for (const q of order) {
    g.hexCenter(q, p);
    far[q] = dhypot(p.x - ctr.x, p.y - ctr.y);
  }
  order.sort((a, b) => depth[b] - depth[a] || far[b] - far[a] || a - b);
  fc.order = order;
  fc.ver = g.stateVersion;
}

/** The plan and mask for a colony's nest, brought up to date (null: no nest). */
export function floodCache(w: World, c: Colony): FloodCache | null {
  const space = nestSpace(c.id);
  const g = w.nestOf(space);
  if (!g) return null;
  let fc = w.floodCache.get(space);
  const N = g.cols * g.rows;
  if (!fc || fc.depth.length !== N) {
    fc = { ver: -1, depth: new Int16Array(N), order: [], up: new Int32Array(N), mask: new Uint8Array(N), n: 0, top: Infinity };
    w.floodCache.set(space, fc);
  }
  let fresh = false;
  if (fc.ver !== g.stateVersion) {
    plan(g, fc);
    fresh = true;
  }
  const st = c.nestFlood;
  const n = st ? st.q.length : 0;
  if (n !== fc.n || fresh) {
    if (n < fc.n) fc.mask.fill(0);
    for (let i = n < fc.n ? 0 : fc.n; i < n; i++) fc.mask[st!.q[i]] = 1;
    fc.n = n;
    let top = Infinity;
    for (let i = 0; i < n; i++) top = Math.min(top, fc.depth[st!.q[i]]);
    fc.top = top;
  }
  return fc;
}

// ---------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------

/**
 * Start flooding a colony's nest: the water starts pouring in now (or after `delaySec`) and fills the nest in about
 * `fillSec` (NEST_FLOOD.fillSec by default). False when the colony has no nest or its nest is already flooding or
 * flooded.
 */
export function startNestFlood(w: World, colonyId: number, opts?: { fillSec?: number; delaySec?: number }): boolean {
  const c = w.colony(colonyId);
  if (!c || !w.nest(colonyId) || c.nestFlood) return false;
  const delay = Math.max(0, opts?.delaySec ?? 0);
  c.nestFlood = { phase: 0, t0: w.s.time + delay, fill: Math.max(1, opts?.fillSec ?? NEST_FLOOD.fillSec), q: [], at: [] };
  if (delay <= 0) begin(w, c, c.nestFlood);
  return true;
}

/** The share (0..1) of a colony's open nest hexes under water (0 when it is not flooding). */
export function nestFloodFraction(w: World, colonyId: number): number {
  const c = w.colony(colonyId);
  const st = c?.nestFlood;
  if (!c || !st || st.phase === 0) return 0;
  if (st.phase === 2) return 1;
  const fc = floodCache(w, c);
  if (!fc || !fc.order.length) return 0;
  return Math.min(1, st.q.length / fc.order.length);
}

/** Is hex q of a colony's nest under water? */
export function isHexFlooded(w: World, colonyId: number, q: number): boolean {
  const c = w.colony(colonyId);
  if (!c?.nestFlood || q < 0 || !c.nestFlood.q.length) return false;
  const fc = floodCache(w, c);
  return !!fc && fc.mask[q] === 1;
}

/** Is the point (x, y) of a nest space under water? (any underground space; caves never flood) */
export function floodedAt(w: World, space: number, x: number, y: number): boolean {
  if (space === SURFACE) return false;
  const c = w.colony(colonyOfSpace(space));
  if (!c?.nestFlood || !c.nestFlood.q.length) return false;
  const g = w.nestOf(space);
  const fc = floodCache(w, c);
  if (!g || !fc) return false;
  const q = g.hexAt(x, y);
  return q >= 0 && fc.mask[q] === 1;
}

/**
 * The colony goes all-in on the target's queen (warAI.ts `startAllOut`): every group but the queen's own (her chamber's
 * workers stay with her as nurses) marches on her and stays on her — no defence of its own nest, no retreat, no
 * gathering, no help for allies, nothing carried home — re-targeting her until she or they are dead. The state is
 * `c.aiWar.allOut` (and `c.aiWar.target`). Nothing changes for a colony this is never called on. Nothing happens when
 * either colony has fallen or they are on the same team.
 */
export function forceAllOut(w: World, colonyId: number, targetId: number): void {
  const c = w.colony(colonyId);
  const t = w.colony(targetId);
  // (an ally is no target: its ants and these never fight)
  if (!c || !t || c.id === t.id || !c.alive || !t.alive || c.team === t.team) return;
  startAllOut(w, c, t);
}

// ---------------------------------------------------------------------------------------------------------------
// The system (every tick, after the ants have moved)
// ---------------------------------------------------------------------------------------------------------------

function begin(w: World, c: Colony, st: NestFloodState): void {
  st.phase = 1;
  st.t0 = Math.min(st.t0, w.s.time);
  w.events.emit({ t: 'nestFlood', colony: c.id, phase: 'start', x: c.nx, y: c.ny });
}

/** Let the water in: the open hexes go under one at a time, deepest first, at a steady inflow. */
function fill(w: World, c: Colony, st: NestFloodState, fc: FloodCache): void {
  const N = fc.order.length;
  if (!N) return;
  const k = Math.min(1, Math.max(0, (w.s.time - st.t0) / st.fill));
  const want = Math.min(N, Math.ceil(N * k - 1e-9));
  if (st.q.length < want) {
    for (let i = 0; i < N && st.q.length < want; i++) {
      const q = fc.order[i];
      if (fc.mask[q]) continue;
      st.q.push(q);
      st.at.push(w.s.time);
      fc.mask[q] = 1;
      fc.top = Math.min(fc.top, fc.depth[q]);
    }
    fc.n = st.q.length;
  }
  if (st.phase === 1 && st.q.length >= N) {
    st.phase = 2;
    w.events.emit({ t: 'nestFlood', colony: c.id, phase: 'full', x: c.nx, y: c.ny });
  }
}

export function nestFloodSystem(w: World, dt: number): void {
  // the flooding nests (a game without floods leaves at once; only ants still short of breath are looked at)
  let wet: Array<{ c: Colony; g: NestGrid; fc: FloodCache; space: number }> | null = null;
  for (const c of w.s.colonies) {
    const st = c.nestFlood;
    if (!st) continue;
    if (st.phase === 0) {
      if (w.s.time < st.t0) continue;
      begin(w, c, st);
    }
    const fc = floodCache(w, c);
    const g = w.nest(c.id);
    if (!fc || !g) continue;
    fill(w, c, st, fc);
    if (st.q.length) (wet ??= []).push({ c, g, fc, space: nestSpace(c.id) });
  }
  const B = NEST_FLOOD;
  const under = (space: number, x: number, y: number): boolean => {
    if (!wet || space === SURFACE) return false;
    for (const f of wet) {
      if (f.space !== space) continue;
      const q = f.g.hexAt(x, y);
      return q >= 0 && f.fc.mask[q] === 1;
    }
    return false;
  };
  // ants: breath, then drowning; out of the water, breath comes back
  for (const a of w.s.ants) {
    if (a.uw === undefined && (!wet || a.space === SURFACE)) continue;
    if (a.state === AS.Dead) continue;
    if (under(a.space, a.x, a.y)) {
      a.uw = (a.uw ?? 0) + dt;
      if (a.uw <= B.breathS) continue;
      const c = w.colony(a.colony);
      // struggling (render hint)
      a.pose = POSE.ALARM;
      if (c && a.id === c.queen && c.invincibleQueen) continue;
      a.hp -= a.maxHp * B.drownFrac * dt;
      if (a.hp <= 0) {
        a.lastHit = HIT.DROWN;
        killAnt(w, a);
      }
    } else if (a.uw !== undefined) {
      a.uw -= dt * B.breathBack;
      if (a.uw <= 0) a.uw = undefined;
    }
  }
  if (!wet) return;
  // brood: an egg or larva under water is dead after breathS + broodS
  for (const b of w.s.brood) {
    if (under(nestSpace(b.colony), b.x, b.y)) {
      b.uw = (b.uw ?? 0) + dt;
      if (b.uw > B.breathS + B.broodS) drownBrood(w, b);
    } else if (b.uw !== undefined) {
      b.uw -= dt * B.breathBack;
      if (b.uw <= 0) delete b.uw;
    }
  }
  // creatures in a flooding nest
  for (const cr of w.s.creatures) {
    if (cr.dead || (cr.uw === undefined && cr.space === SURFACE)) continue;
    if (under(cr.space, cr.x, cr.y)) {
      cr.uw = (cr.uw ?? 0) + dt;
      if (cr.uw <= B.breathS) continue;
      cr.hp -= cr.maxHp * B.creatureDrownFrac * dt;
      if (cr.hp <= 0) {
        cr.hp = 0;
        cr.dead = true;
        cr.deadT = 0;
        w.events.emit({ t: 'death', x: cr.x, y: cr.y, space: cr.space, kind: 'creature', id: cr.id, colony: -1, what: cr.kind });
      }
    } else if (cr.uw !== undefined) {
      cr.uw -= dt * B.breathBack;
      if (cr.uw <= 0) delete cr.uw;
    }
  }
  // loose food floats off (corpses stay on the floor)
  for (const f of w.s.food) if (f.space !== SURFACE && !f.heldBy && f.kind !== 'corpse' && under(f.space, f.x, f.y)) w.removeFoodNow(f.id);
}

function drownBrood(w: World, b: Brood): void {
  const c = w.colony(b.colony);
  if (c) for (const t of c.tiles) if (t.brood === b.id) t.brood = 0;
  if (b.carrier) {
    const a = w.antById.get(b.carrier);
    if (a && a.carry === Carry.Brood && a.carryId === b.id) {
      a.carry = Carry.None;
      a.carryId = 0;
    }
  }
  w.removeBroodNow(b.id);
}

// ---------------------------------------------------------------------------------------------------------------
// Ants (antAI.ts): jobs given up, loads washed away, the colony climbing to higher ground with its brood
// ---------------------------------------------------------------------------------------------------------------

/** The flooding colony that owns this nest space, its cache and grid (null when the space is dry). */
function floodHere(w: World, space: number): { f: Colony; fc: FloodCache; g: NestGrid } | null {
  if (space === SURFACE) return null;
  const f = w.colony(colonyOfSpace(space));
  if (!f?.nestFlood || f.nestFlood.phase === 0) return null;
  const fc = floodCache(w, f);
  const g = w.nestOf(space);
  return fc && g ? { f, fc, g } : null;
}

/** Hexes within `keepAbove` of the waterline (or under it) are threatened: no work there, the ants move up. */
function threatened(fc: FloodCache, q: number): boolean {
  return q >= 0 && fc.depth[q] >= 0 && fc.depth[q] >= fc.top - NEST_FLOOD.keepAbove;
}

/**
 * Is a nest job on hex q off for the water (jobs.ts)? Under water, or about to be: nothing is dug, built or delivered
 * there, and no soil hex is dug from water.
 */
export function floodBlocksJob(w: World, c: Colony, q: number): boolean {
  if (!c.nestFlood || !c.nestFlood.q.length || q < 0) return false;
  const fc = floodCache(w, c);
  const g = w.nest(c.id);
  if (!fc || !g) return false;
  if (fc.mask[q] || threatened(fc, q)) return true;
  // a soil hex: only from a dry dug neighbour that is not about to flood
  if (!g.isHexDug(q) && fc.depth[q] < 0) {
    for (const n of g.neighbors(q)) if (n >= 0 && g.isHexDug(n) && !fc.mask[n] && !threatened(fc, n)) return false;
    return true;
  }
  return false;
}

/** The queen's hex is under water or about to be: she lays no eggs (they would be pulled from her in the water). */
export function queenHexBlocked(w: World, c: Colony): boolean {
  if (!c.nestFlood?.q.length) return false;
  const qa = w.antById.get(c.queen);
  const g = w.nest(c.id);
  if (!qa || !g || qa.space !== nestSpace(c.id)) return false;
  return floodBlocksJob(w, c, g.hexAt(qa.x, qa.y));
}

/**
 * A worker on a nest job in its own flooding nest gives it up when it is in the water or its job hex is about to go
 * under, and joins the climb to higher ground (antAI.ts, before the job runs).
 */
export function floodJob(w: World, a: Ant, c: Colony): void {
  if (a.task !== 'job' || a.space !== nestSpace(c.id)) return;
  const h = floodHere(w, a.space);
  if (!h) return;
  const q = h.g.hexAt(a.x, a.y);
  if ((q >= 0 && h.fc.mask[q]) || floodBlocksJob(w, c, a.jobQ)) {
    endJob(w, a, c);
    a.fl = 1;
  }
}

function fighting(a: Ant): boolean {
  return a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Spray || a.state === AS.Sting || a.state === AS.Flung || a.state === AS.Climb || snapping(a.state);
}

/**
 * An ant in a flooding nest (antAI.ts, every tick after its fights): a load other than brood is washed out of its jaws in
 * the water; the colony's own ants at home climb ahead of the water (and carry brood up). True when it moved the ant.
 */
export function floodAnt(w: World, a: Ant, c: Colony, dt: number): boolean {
  const h = floodHere(w, a.space);
  if (!h) return false;
  const { f, fc, g } = h;
  const q = g.hexAt(a.x, a.y);
  const wet = q >= 0 && fc.mask[q] === 1;
  if (wet && a.carry !== Carry.None && a.carry !== Carry.Brood) washLoad(w, a);
  // visitors, raiders and the colony's groups out at a marker keep their orders (they drown if they stay in the water)
  if (a.colony !== f.id || a.marker >= 0 || a.task === 'job' || a.id === c.queen || a.id === c.king || fighting(a)) return false;
  if (!a.fl) {
    if (!wet && !threatened(fc, q)) return false;
    a.fl = 1;
  }
  higherGround(w, a, f, g, fc, q, wet, dt);
  return true;
}

/** A load in the water is lost (food floats off; soil is mud). */
function washLoad(w: World, a: Ant): void {
  if (a.carry === Carry.Food || a.carry === Carry.Leaf || a.carry === Carry.Corpse) {
    const fd = w.foodById.get(a.carryId);
    if (fd) {
      if (a.carry === Carry.Corpse) {
        // (a corpse is let go where it is: it stays on the floor)
        dropCarried(w, a);
        return;
      }
      w.removeFoodNow(fd.id);
    }
  }
  a.carry = Carry.None;
  a.carryId = 0;
  a.carryAmt = 0;
}

/** Safe: dry and at least keepAbove + 1 hexes above the water. */
function safeHex(fc: FloodCache, q: number): boolean {
  return q >= 0 && fc.mask[q] !== 1 && fc.depth[q] >= 0 && fc.depth[q] < fc.top - NEST_FLOOD.keepAbove;
}

function higherGround(w: World, a: Ant, f: Colony, g: NestGrid, fc: FloodCache, q: number, wet: boolean, dt: number): void {
  const safe = safeHex(fc, q);
  if (a.carry === Carry.Brood) {
    // brood carried up is set down once out of the water's way
    if (safe) dropCarried(w, a);
    else return climb(w, a, dt);
  } else if (a.carry !== Carry.None) {
    // (soil from a dig, a load from outside: put down)
    if (a.carry === Carry.Soil) {
      a.carry = Carry.None;
      a.carryAmt = 0;
    } else dropCarried(w, a);
  }
  if (!wet && casteOf(a.caste).carry > 0 && fetchBrood(w, a, f, g, fc, dt)) return;
  if (!safe) return climb(w, a, dt);
  // waiting above the water: antennae up, now and then grooming
  a.v = 0;
  if (a.state !== AS.Guard) enterState(a, AS.Guard);
  a.pose = dsin(w.s.time * 0.6 + a.id * 1.3) > 0.55 ? POSE.GROOM_LEGS : POSE.ALARM;
}

/** Up the tunnels toward the entrance (the exit field), at the waterline's pace or faster. */
function climb(w: World, a: Ant, dt: number): void {
  if (a.state !== AS.Flee) enterState(a, AS.Flee);
  const fld = exitFieldIn(w, a.space);
  const r = fld ? followNest(w, a, fld, dt, 1.1) : 'stuck';
  if (r !== 'moving') {
    a.v = 0;
    a.pose = POSE.ALARM;
  }
}

/** Brood lying above the water but within `rescueAhead` of it, not yet safe: a worker fetches it up. */
function rescuable(fc: FloodCache, g: NestGrid, b: Brood): boolean {
  const q = g.hexAt(b.x, b.y);
  return q >= 0 && fc.mask[q] !== 1 && fc.depth[q] >= 0 && fc.depth[q] >= fc.top - NEST_FLOOD.rescueAhead && !safeHex(fc, q);
}

function fetchBrood(w: World, a: Ant, f: Colony, g: NestGrid, fc: FloodCache, dt: number): boolean {
  let b = a.flB ? w.broodById.get(a.flB) : undefined;
  if (b && (b.carrier || b.colony !== f.id || !rescuable(fc, g, b))) b = undefined;
  if (!b) {
    a.flB = 0;
    // (looked for every half second, spread over the ants)
    if ((w.s.tick + a.id) % 10 !== 0) return false;
    let bd = sq(NEST_FLOOD.rescueR);
    for (const o of w.s.brood) {
      if (o.colony !== f.id || o.carrier || !rescuable(fc, g, o)) continue;
      const d2 = sq(o.x - a.x) + sq(o.y - a.y);
      if (d2 >= bd) continue;
      // (one worker per item)
      let taken = false;
      for (const m of w.s.ants) if (m.flB === o.id && m.id !== a.id && m.state !== AS.Dead) taken = true;
      if (taken) continue;
      bd = d2;
      b = o;
    }
    if (!b) return false;
    a.flB = b.id;
  }
  const reach = casteOf(a.caste).length * 0.6 + 1;
  if (dhypot(b.x - a.x, b.y - a.y) > reach) {
    if (a.state !== AS.Flee) enterState(a, AS.Flee);
    goToNestPoint(w, a, f, b.x, b.y, dt, 1.05);
    return true;
  }
  b.carrier = a.id;
  a.carry = Carry.Brood;
  a.carryId = b.id;
  a.flB = 0;
  return true;
}
