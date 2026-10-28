import { climbTick, climbUpdate } from './climbing';
import { World } from './world';
import { canLeave, usableMask } from './entrances';
import { Ant, AS, Brood, Carry, Colony, Food, POSE, SURFACE, TileType, colonyOfSpace, nestSpace, snapping } from './types';
import { casteOf, CASTES } from './species';
import { NestGrid } from '../world/nestGrid';
import {
  angleDiff,
  antSpeed,
  clampToMap,
  exitField,
  followNest,
  goHome,
  goOut,
  goToArea,
  goToSurfacePoint,
  homeField,
  moveForward,
  nearestEntrance,
  steerTo,
  turnToward,
  wander,
} from './movement';
import { dropCarried, hexCoreCells, onAntDied, setTask, tileCellsOfType, tilePoint } from './colony';
import { jobWork, JobNav } from './jobs';
import { tileAt } from './tiles';
import { markerRadius, underOrder } from './markers';
import { abilityMods } from './abilities';
import { makeFood } from './factory';
import { combatPreempt, flungUpdate, venomTick } from './combat';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';
import { edible, eatsWood, isWoodSource } from './diet';
import { BALANCE, ECITON, NASUTE, SICKLE, TERMANT } from './balance';
import { holdMarkerSlot, onTermiteDied, sickleGuardIndex, startTermiteIdle, termiteIdle, termiteTick } from './termites';
import { surgeTick } from './surge';
import { isHeld, snapTick } from './hellAnts';
import { genesWanted, isTermant, tagPiece, termantDeposit, termantKing } from './termants';
import { holdGuardLine, inGuardLine } from './guardLine';
import { crossBridge, ecitonTimers, escortPorter, holdLink, isArmyAnt, isMajor, raider, soldier, teamCarry, teamHelp } from './eciton';
import { passiveAnt } from './arena';

const tmp = { x: 0, y: 0 };

/** Hook for species-specific behaviour (registered by sim/speciesAI). */
export const speciesHooks: {
  forageSense?: (w: World, a: Ant, dt: number, area: { x: number; y: number; r: number } | null) => boolean;
  beforeAnt?: (w: World, a: Ant, dt: number) => boolean;
} = {};

// ---------------------------------------------------------------------------
// Nest navigation helpers
// ---------------------------------------------------------------------------

function storeField(w: World, c: Colony): Float32Array | null {
  const flow = w.flow(c.id);
  if (!flow) return null;
  return flow.field(
    'store',
    () => {
      const cells = tileCellsOfType(w, c, 'food');
      return cells.length ? cells : tileCellsOfType(w, c, 'queen');
    },
    c.tileVersion,
  );
}

function typeField(w: World, c: Colony, type: TileType): Float32Array | null {
  const flow = w.flow(c.id);
  if (!flow) return null;
  return flow.field('type:' + type, () => tileCellsOfType(w, c, type), c.tileVersion);
}

/**
 * Field to the hex containing a point, shared by every ant heading anywhere
 * in that hex (they steer straight in once inside it). One field per
 * destination hex, not per point: the old per-cell fields were the biggest
 * cost in the simulation (docs/performance.md).
 */
function pointField(w: World, space: number, x: number, y: number): Float32Array | null {
  const g = w.nestOf(space);
  const flow = w.flowOf(space);
  if (!g || !flow) return null;
  let q = g.hexAt(x, y);
  if (q < 0) {
    // off the hex grid: use the cell itself
    const cx = Math.min(g.w - 1, Math.max(0, Math.floor(x / g.cell)));
    const cy = Math.min(g.h - 1, Math.max(0, Math.floor(y / g.cell)));
    const k = cy * g.w + cx;
    return flow.field('pc:' + k, () => [k]);
  }
  return flow.field('ph:' + q, () => hexTargetCells(g, q));
}

/** Air cells of a hex; for a hex not dug yet, the air cell nearest its centre (depends only on the grid). */
function hexTargetCells(g: NestGrid, q: number): number[] {
  const out: number[] = [];
  for (const c of g.hexCells[q]) if (g.isAirIdx(c)) out.push(c);
  if (out.length) return out;
  const ctr = g.hexCenter(q);
  const cx = Math.floor(ctr.x / g.cell);
  const cy = Math.floor(ctr.y / g.cell);
  for (let r = 1; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (g.isAir(cx + dx, cy + dy)) return [(cy + dy) * g.w + cx + dx];
  return out;
}


/** Targets: dug space beside each designated frontier hex (near the shared edge) plus its carved part. */
function frontierField(w: World, c: Colony): Float32Array | null {
  const g = w.nest(c.id);
  const flow = w.flow(c.id);
  if (!g || !flow) return null;
  return flow.field(
    'frontier',
    () => {
      const out: number[] = [];
      const e = { x: 0, y: 0 };
      for (let q = 0; q < g.hexSoil.length; q++) {
        if (!g.isFrontierHex(q)) continue;
        for (const k of g.airCellsOfHex(q)) out.push(k);
        const nb = g.neighbors(q);
        for (let d = 0; d < 6; d++) {
          const n = nb[d];
          if (n < 0 || !g.isHexDug(n)) continue;
          g.edgeMid(q, d, e);
          for (const k of g.hexCells[n]) {
            if (!g.isAirIdx(k)) continue;
            const cx = ((k % g.w) + 0.5) * g.cell;
            const cy = (Math.floor(k / g.w) + 0.5) * g.cell;
            if (sq(cx - e.x) + sq(cy - e.y) < sq(g.R * 0.8)) out.push(k);
          }
        }
      }
      return out;
    },
    g.desigVersion,
  );
}

/** The designated hex an ant at this position should dig (its own hex or a neighbour), with the hex it digs from. */
function digTarget(g: NestGrid, a: Ant): { q: number; from: number } | null {
  const h0 = g.hexAt(a.x, a.y);
  if (h0 < 0) return null;
  if (g.hexDesig[h0] && g.isHexDiggable(h0)) {
    const nb = g.neighbors(h0);
    const from = nb.find((n) => n >= 0 && g.isHexDug(n)) ?? -1;
    if (from >= 0) return { q: h0, from };
  }
  let best: { q: number; from: number } | null = null;
  let bd = Infinity;
  const p = { x: 0, y: 0 };
  for (const n of g.neighbors(h0)) {
    if (n < 0 || !g.hexDesig[n] || !g.isHexDiggable(n) || !g.isHexDug(h0)) continue;
    g.hexCenter(n, p);
    const d = sq(p.x - a.x) + sq(p.y - a.y);
    if (d < bd) {
      bd = d;
      best = { q: n, from: h0 };
    }
  }
  return best;
}

/** Spoil is carried up the entrance ramps and dumped outside. */
function dumpField(w: World, c: Colony): Float32Array | null {
  const flow = w.flow(c.id);
  const g = w.nest(c.id);
  if (!flow || !g) return null;
  return flow.field('dump', () => c.entrances.flatMap((e) => (canLeave(e) ? hexCoreCells(g, e.q, 0.45) : [])), c.entrances.length + 32 * usableMask(c.entrances, true));
}

/** Move along a direction without changing the facing (walking backwards with soil). */
function moveAlong(w: World, a: Ant, dir: number, speed: number, dt: number): void {
  const h = a.h;
  a.h = dir;
  moveForward(w, a, speed, dt);
  a.h = h;
}

/** Walk to a point in the area the ant is in (own nest, rival nest or cave). */
export function goToNestPoint(w: World, a: Ant, _c: Colony | null, x: number, y: number, dt: number, speedMul = 1): boolean {
  const d = dhypot(x - a.x, y - a.y);
  if (d < 1.2) return true;
  if (d < 6) {
    steerTo(w, a, x, y, dt, speedMul);
    return false;
  }
  const f = pointField(w, a.space, x, y);
  if (!f) return false;
  const r = followNest(w, a, f, dt, speedMul);
  if (r !== 'moving') steerTo(w, a, x, y, dt, speedMul);
  return false;
}

function inOwnNest(a: Ant): boolean {
  return a.space === nestSpace(a.colony);
}

/** Signed smallest angle from a to b. */
function angleDiffTo(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function enterState(a: Ant, s: AS): void {
  a.state = s;
  a.st = 0;
}

// ---------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------

export function killAnt(w: World, a: Ant): void {
  if (a.state === AS.Dead) return;
  dropCarried(w, a);
  releaseGrapple(w, a);
  enterState(a, AS.Dead);
  a.deadT = 0;
  a.hp = 0;
  const c = w.colony(a.colony);
  if (c) c.stats.died++;
  onAntDied(w, a);
  w.events.emit({ t: 'death', x: a.x, y: a.y, space: a.space, kind: 'ant', id: a.id, colony: a.colony, what: a.caste, cause: a.lastHit ?? 0 });
  if (c && a.id === c.queen) w.events.emit({ t: 'queenDead', colony: c.id });
  if (c && casteOf(a.caste).termite) onTermiteDied(w, c, a);
  // the king (termites, Termants) dies as soon as his queen does (user note 2026-10-25)
  if (c && a.id === c.queen && c.king) {
    const k = w.antById.get(c.king);
    if (k && k.state !== AS.Dead) killAnt(w, k);
  }
}

export function releaseGrapple(w: World, a: Ant): void {
  a.gId = 0;
  a.gKind = 0;
}

function corpseFromAnt(w: World, a: Ant): void {
  const cd = casteOf(a.caste);
  const f = makeFood(w, 'corpse', a.space, a.x, a.y, 1, cd.morph);
  f.amount = f.max = Math.max(2, cd.cost * 0.5 + cd.mass * 2);
  // Termite corpses are food for ants: × the baseline worker ant's corpse (5 food).
  if (cd.termite) f.amount = f.max = 5 * ((cd.species === 'rhynchotermes' ? SICKLE : NASUTE).corpseFoodForAntsMul[cd.termite] ?? 1);
  f.mass = cd.mass * 1.2;
  f.size = cd.length;
  f.colony = a.colony;
  f.h = a.h;
  f.v = a.id;
  f.cause = a.lastHit ?? 0;
  // timed: food for enemies for a moment (termites: any ant), then it sinks into the ground and is gone
  f.sinkAt = cd.termite ? BALANCE.corpse.termiteFood : BALANCE.corpse.antFood;
  // games with Termants: the dead lie long enough to be carried home for their genes (termants.ts)
  if (w.s.colonies.some((o) => o.alive && o.species === 'termant')) f.sinkAt = Math.max(f.sinkAt, TERMANT.corpseLingerSec);
  w.killAntNow(a.id);
}

// ---------------------------------------------------------------------------
// Main system
// ---------------------------------------------------------------------------

const jobNav: JobNav = {
  goToNestPoint: (w, a, c, x, y, dt, speedMul) => goToNestPoint(w, a, c, x, y, dt, speedMul),
  goHome: (w, a, dt) => goHome(w, a, dt),
  goOut: (w, a, dt) => goOut(w, a, dt),
};

/** Battle arena, passive team: stand still, let go of any hold, never fight (sim/arena.ts). */
function arenaPassive(w: World, a: Ant): void {
  a.v = 0;
  if (a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Spray || snapping(a.state)) {
    releaseGrapple(w, a);
    a.tgt = 0;
    a.tk = 0;
    enterState(a, AS.Idle);
  }
}

export function antSystem(w: World, dt: number): void {
  const ants = w.s.ants;
  for (let i = 0; i < ants.length; i++) {
    const a = ants[i];
    a.px = a.x;
    a.py = a.y;
    a.ph = a.h;
    if (a.state === AS.Dead) {
      a.deadT += dt;
      a.v = 0;
      if (a.deadT > BALANCE.corpse.antFall) corpseFromAnt(w, a);
      continue;
    }
    a.age += dt;
    a.entT = (a.entT ?? 9) + dt;
    a.taskT += dt;
    a.st += dt;
    if (a.cd > 0) a.cd -= a.pinned > 0 ? dt * 0.5 : dt; // held by the legs: fights back slowly
    if (a.cd2 > 0) a.cd2 -= dt;
    if (a.meetCd > 0) a.meetCd -= dt;
    if (a.slowT > 0) a.slowT -= dt;
    if (a.stun > 0) a.stun -= dt;
    if (a.pinned > 0) a.pinned -= dt;
    if (a.alarm > 0) a.alarm = Math.max(0, a.alarm - dt * 0.15);
    if (a.surgeT !== undefined) surgeTick(a, dt);
    if (a.ecY !== undefined) ecitonTimers(a, dt);
    // hell ants: snap cooldown, and dropping a hold the ant can no longer keep
    if (a.snapCd !== undefined) snapTick(w, a, dt);
    if (a.heldBy) isHeld(w, a);
    if (a.climbCd !== undefined) climbTick(a, dt);
    a.pose = POSE.NONE;
    if (a.state === AS.Climb) {
      // on a creature: one transform a tick, whatever else is going on (climbing.ts)
      const cc = w.colony(a.colony);
      if (cc) climbUpdate(w, a, cc, dt);
      clampToMap(w, a);
      continue;
    }
    if (a.state === AS.Flung) {
      flungUpdate(w, a, dt);
      continue;
    }
    // army ants: links of a living bridge / pothole plugs hold still; an ant on a bridge walks across it (eciton.ts)
    if (a.state === AS.Bridge || a.state === AS.Plug || (a.xing ?? 0) !== 0) {
      const cc = w.colony(a.colony);
      if (cc && (a.state === AS.Bridge || a.state === AS.Plug ? holdLink(w, a, cc, dt) : crossBridge(w, a, cc, dt))) {
        venomTick(w, a, dt);
        finish(w, a);
        continue;
      }
    }
    const c = w.colony(a.colony);
    if (!c) continue;
    // battle arena: a passive team stands still and never fights (a dummy to test climbing on) — sim/arena.ts
    if (w.s.mode.arena && a.id !== c.queen && passiveAnt(w, a.colony)) {
      arenaPassive(w, a);
      venomTick(w, a, dt);
      finish(w, a);
      continue;
    }
    if (a.alertUntil !== undefined && !w.s.mode.arena && termiteTick(w, a, c, dt)) {
      finish(w, a);
      continue;
    }
    if (speciesHooks.beforeAnt && speciesHooks.beforeAnt(w, a, dt)) {
      finish(w, a);
      continue;
    }
    if (a.id === c.queen) {
      // Every queen (all species): she never moves and never fights back; she only takes the
      // damage and makes eggs (workers pull them from her abdomen). Immune to stuns and knockback.
      a.stun = 0;
      queenBehaviour(w, a, c, dt);
      venomTick(w, a, dt);
      continue;
    }
    if (a.stun > 0) {
      a.v = 0;
      finish(w, a);
      continue;
    }
    // A worker on a nest job ignores food and enemies (venom still hurts).
    if (a.task === 'job') {
      if (venomTick(w, a, dt)) continue;
      jobWork(w, a, c, dt, jobNav);
      finish(w, a);
      continue;
    }
    if (combatPreempt(w, a, c, dt)) {
      finish(w, a);
      continue;
    }
    if (a.id === c.king && isTermant(c) && termantKing(w, a, c, dt)) {
      finish(w, a);
      continue;
    }
    if (!w.s.mode.arena && (defendNest(w, a, c, dt) || rushHome(w, a, c, dt))) {
      finish(w, a);
      continue;
    }
    switch (a.task) {
      case 'forage':
        forage(w, a, c, dt);
        break;
      case 'haul':
        haul(w, a, c, dt);
        break;
      case 'garden':
        garden(w, a, c, dt);
        break;
      case 'guard':
        guard(w, a, c, dt);
        break;
      case 'marker':
        marker(w, a, c, dt);
        break;
      default:
        idle(w, a, c, dt);
    }
    encounters(w, a, c);
    finish(w, a);
  }
}

/**
 * Safety net: an ant shoved into solid soil (e.g. by a grapple next to a
 * wall) is eased back out to the nearest open floor, so it can't get stuck.
 */
function unstick(w: World, a: Ant): void {
  if (a.space === SURFACE || (w.s.tick + a.id) % 10 !== 0) return;
  const g = w.nestOf(a.space);
  if (!g || g.isAirAt(a.x, a.y)) return;
  const cx = Math.floor(a.x / g.cell);
  const cy = Math.floor(a.y / g.cell);
  for (let r = 1; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !g.isAir(cx + dx, cy + dy)) continue;
        a.x = (cx + dx + 0.5) * g.cell;
        a.y = (cy + dy + 0.5) * g.cell;
        return;
      }
}

function finish(w: World, a: Ant): void {
  clampToMap(w, a);
  unstick(w, a);
  // Carried brood/food follows the carrier's mandibles.
  if (a.carry === Carry.Brood) {
    const b = w.broodById.get(a.carryId);
    if (b) {
      const L = casteOf(a.caste).length;
      b.x = a.x + dcos(a.h) * L * 0.55;
      b.y = a.y + dsin(a.h) * L * 0.55;
    } else {
      a.carry = Carry.None;
      a.carryId = 0;
    }
  } else if (a.carry === Carry.Food || a.carry === Carry.Corpse || a.carry === Carry.Leaf) {
    const f = w.foodById.get(a.carryId);
    if (f) {
      const cd = casteOf(a.caste);
      const L = cd.length;
      f.px = f.x;
      f.py = f.y;
      // army-ant porters sling the load under the body; everyone else holds it in the jaws
      const fwd = cd.porter ? ECITON.porter.underFwd : 0.55;
      f.x = a.x + dcos(a.h) * L * fwd;
      f.y = a.y + dsin(a.h) * L * fwd;
      f.space = a.space;
      f.h = a.h;
    } else {
      a.carry = Carry.None;
      a.carryId = 0;
    }
  }
  if (a.pose === POSE.NONE && a.carry !== Carry.None && a.carry !== Carry.Soil) a.pose = POSE.CARRY;
}

// ---------------------------------------------------------------------------
// Queen
// ---------------------------------------------------------------------------

function queenBehaviour(w: World, a: Ant, c: Colony, dt: number): void {
  // She stays exactly where she is (her place in the queen's chamber) and never fights back.
  a.v = 0;
  a.tgt = 0;
  a.tk = 0;
  if (a.state !== AS.Idle && a.state !== AS.Dead) {
    a.state = AS.Idle;
    a.st = 0;
  }
  if (!casteOf(a.caste).termite && dsin(w.time * 0.3 + a.id) > 0.85) a.pose = POSE.GROOM_ANT;
}

// ---------------------------------------------------------------------------
// Idle / encounters
// ---------------------------------------------------------------------------

function idle(w: World, a: Ant, c: Colony, dt: number): void {
  if (a.carry !== Carry.None && a.carry !== Carry.Brood) {
    // finish any delivery first
    if (a.carry === Carry.Soil) {
      a.carry = Carry.None;
      a.carryAmt = 0;
    }
    returnAndStore(w, a, c, dt);
    return;
  }
  if (a.space === SURFACE || !inOwnNest(a)) {
    if (a.space === SURFACE) goHome(w, a, dt);
    else goOut(w, a, dt);
    return;
  }
  restInNest(w, a, c, dt, null);
}

/** In-nest resting: an ant returns to its own tile and idles there (pauses, grooms, wanders a little). */
function restInNest(w: World, a: Ant, c: Colony, dt: number, prefer: TileType | null): void {
  // termite workers: grooming the queen or brood, feeding a soldier or a royal
  if (a.idleT && termiteIdle(w, a, c, dt)) return;
  if (a.state === AS.Groom) {
    a.v = 0;
    a.pose = a.tk === 1 ? POSE.GROOM_LEGS : POSE.GROOM_ANT;
    if (a.st > 3.5) enterState(a, AS.Idle);
    return;
  }
  if (a.state === AS.Troph) {
    trophUpdate(w, a, dt);
    return;
  }
  if (a.state !== AS.Wander || a.st > 12) {
    if (casteOf(a.caste).termite === 'worker' && startTermiteIdle(w, a, c)) return;
    const r = w.rng.next();
    if (r < 0.28 && a.tile >= 0 && w.nest(c.id)!.hexAt(a.x, a.y) === a.tile) {
      enterState(a, AS.Groom);
      a.tk = w.rng.chance(0.5) ? 1 : 0;
      return;
    }
    let q = a.tile >= 0 && tileAt(c, a.tile) ? a.tile : -1;
    if (prefer || q < 0) {
      const opts = c.tiles.filter((t) => (prefer ? t.type === prefer : true));
      if (opts.length && (q < 0 || w.rng.chance(0.5))) q = opts[w.rng.int(0, opts.length - 1)].q;
    }
    if (q < 0) return;
    const p = tilePoint(w, c, q, 0.75);
    a.tx = p.x;
    a.ty = p.y;
    enterState(a, AS.Wander);
  }
  if (a.pause > 0) {
    a.pause -= dt;
    a.v = 0;
    return;
  }
  if (goToNestPoint(w, a, c, a.tx, a.ty, dt, 0.6)) {
    a.v = 0;
    if (w.rng.chance(dt * 0.4)) a.pause = w.rng.range(0.6, 2.5);
  } else if (w.rng.chance(dt * 0.15)) a.pause = w.rng.range(0.3, 1);
}

function encounters(w: World, a: Ant, c: Colony): void {
  if (a.meetCd > 0) return;
  if (a.state === AS.Troph || a.state === AS.Dig || a.state === AS.Attack || a.state === AS.Grapple || snapping(a.state)) return;
  if (a.carry === Carry.Brood || a.carry === Carry.Soil) return;
  const L = casteOf(a.caste).length;
  let met: Ant | null = null;
  w.antsNear(a.space, a.x, a.y, L * 1.1, (o) => {
    if (o === a || o.colony !== a.colony || o.state === AS.Dead || o.meetCd > 0 || o.id === c.queen || o.id === c.king) return false;
    if (o.state === AS.Troph || o.state === AS.Dig || o.state === AS.Attack || o.state === AS.Grapple || snapping(o.state)) return false;
    met = o;
    return true;
  });
  a.meetCd = w.rng.range(5, 11);
  if (!met) return;
  const o = met as Ant;
  o.meetCd = w.rng.range(5, 11);
  const givesFood = (a.crop > 0.25 && o.crop < 0.2) || (o.crop > 0.25 && a.crop < 0.2);
  const inNest = a.space !== SURFACE;
  if (givesFood || (inNest && w.rng.chance(0.18))) {
    // Trophallaxis: face to face, mouths together.
    startTroph(w, a, o);
  } else {
    // Antennation: brief stop, antennae on the other ant (army ants barely pause: ECITON.meetPauseSec)
    const p = c.species === 'eciton' ? ECITON.meetPauseSec : 0.6;
    a.pause = Math.max(a.pause, p);
    o.pause = Math.max(o.pause, p);
    a.look = angleDiff(a.h, datan2(o.y - a.y, o.x - a.x));
    o.look = angleDiff(o.h, datan2(a.y - o.y, a.x - o.x));
  }
}

function startTroph(w: World, a: Ant, o: Ant): void {
  for (const [p, q] of [
    [a, o],
    [o, a],
  ] as Array<[Ant, Ant]>) {
    p.partner = q.id;
    p.contact = 0;
    p.state = AS.Troph;
    p.st = 0;
    p.h = datan2(q.y - p.y, q.x - p.x);
  }
}

function trophUpdate(w: World, a: Ant, dt: number): void {
  const o = w.antById.get(a.partner);
  a.v = 0;
  a.pose = POSE.TROPH;
  const L = casteOf(a.caste).length;
  const d = o ? dhypot(o.x - a.x, o.y - a.y) : 0;
  const want = o ? (L + casteOf(o.caste).length) * 0.45 : 0;
  if (d <= want * 1.3) a.contact += dt;
  // ~2.5 s mouth to mouth once met; give up if they never meet
  if (!o || o.state !== AS.Troph || o.partner !== a.id || a.contact > 2.6 || a.st > 8) {
    a.partner = 0;
    a.contact = 0;
    enterState(a, AS.Idle);
    return;
  }
  // close the gap so the mouths meet
  if (d > want) moveForward(w, a, d > want * 2 ? 8 : 3, dt);
  turnToward(a, datan2(o.y - a.y, o.x - a.x), dt, 6);
  // share crop contents
  if (a.crop > o.crop) {
    const t = Math.min(a.crop - o.crop, dt * 0.25);
    a.crop -= t;
    o.crop += t;
  }
}

// ---------------------------------------------------------------------------
// Foraging
// ---------------------------------------------------------------------------

const SENSE = 16;
const MAX_RANGE = 520;

function homeDist(w: World, c: Colony, x: number, y: number): number {
  return w.surfFlow.distAt(homeField(w, c), x, y);
}

function forage(w: World, a: Ant, c: Colony, dt: number): void {
  if (a.carry !== Carry.None) {
    returnAndStore(w, a, c, dt);
    return;
  }
  if (a.state === AS.Troph) {
    trophUpdate(w, a, dt);
    return;
  }
  if (a.space !== SURFACE) {
    if (a.state === AS.Groom) {
      a.pose = POSE.GROOM_ANT;
      a.v = 0;
      if (a.st > 2.5) enterState(a, AS.ToExit);
      return;
    }
    if (a.state !== AS.ToExit) enterState(a, AS.ToExit);
    goOut(w, a, dt);
    // Out: head straight back to a remembered source, else search in a
    // direction of its own (scouts fan out instead of milling at the door).
    if (a.space === SURFACE) {
      enterState(a, (a.tk === 1 || a.tk === 2 || a.tk === 5) && a.tgt ? AS.ToFood : AS.Scout);
      a.scoutH = w.rng.range(-Math.PI, Math.PI);
    }
    return;
  }
  // Out in the field, searchers stop now and then to clean their antennae
  // (they are their noses: soiled antennae smell poorly).
  if (a.state === AS.Groom) {
    a.v = 0;
    a.pose = POSE.GROOM_ANT;
    if (a.st > 2.2) enterState(a, AS.Scout);
    return;
  }
  if (a.state === AS.Scout && a.st > 4 && w.rng.chance(dt * 0.035)) {
    enterState(a, AS.Groom);
    return;
  }
  searchAndCollect(w, a, c, dt, null);
}

/**
 * Surface search: go to known food, follow trails, sense food/aphids/leaves,
 * otherwise zigzag outward. `area` restricts searching (rally marker).
 */
function searchAndCollect(w: World, a: Ant, c: Colony, dt: number, area: { x: number; y: number; r: number; key?: string } | null): void {
  const cd = casteOf(a.caste);
  // 1. heading to a known food item
  if (a.tk === 1 && (a.state === AS.ToFood || a.state === AS.Collect)) {
    const f = w.foodById.get(a.tgt);
    if (!f || f.amount <= 0 || f.heldBy !== 0 || f.space !== SURFACE) {
      a.tgt = 0;
      a.tk = 0;
      enterState(a, AS.Scout);
    } else {
      if (a.state === AS.ToFood) {
        // Deadwood is chewed from a slot round its edge, so several termites can work one log.
        if (isWoodSource(f)) {
          const ang = (a.id * 2.399) % (Math.PI * 2);
          const r = f.size * 0.5 + cd.length * 0.35;
          const sx = f.x + dcos(ang) * r;
          const sy = f.y + dsin(ang) * r;
          if (dhypot(sx - a.x, sy - a.y) > cd.length * 0.4) {
            steerTo(w, a, sx, sy, dt);
            return;
          }
        } else {
          const reach = f.size * 0.5 + cd.length * 0.45;
          if (dhypot(f.x - a.x, f.y - a.y) > reach) {
            steerTo(w, a, f.x, f.y, dt);
            return;
          }
        }
        enterState(a, AS.Collect);
      }
      collect(w, a, c, f, dt);
      return;
    }
  }
  // 2. species-specific targets (aphids, leaves)
  if (speciesHooks.forageSense && speciesHooks.forageSense(w, a, dt, area)) return;
  // 3. sense food nearby
  if (w.s.tick % 4 === a.id % 4) {
    let best: Food | null = null;
    let bd = Infinity;
    w.foodNear(a.x, a.y, SENSE + 30, (f, d2) => {
      if (f.amount <= 0 || f.heldBy !== 0 || f.kind === 'honeydew') return false;
      if (!edible(c, f)) return false; // termites: wood only; ants: never wood (Termants: their workers)
      if (f.kind === 'wood' && !eatsWood(c) && !cd.wood) return false;
      if (f.kind === 'corpse' && w.teamOf(f.colony) === (a.team ?? a.colony)) return false; // only enemies take the dead
      if (f.colony === -2) return false; // the refuse heap is avoided (hygiene)
      if (f.kind === 'leaf' && !cd.cutLeaves) return false;
      if (area && sq(f.x - area.x) + sq(f.y - area.y) > sq(area.r * 1.6)) return false;
      // Food is found by its odour: bigger, juicier items are noticed from further away.
      const r = SENSE + f.size * (f.kind === 'seed' ? 0.8 : f.kind === 'wood' ? 1.0 : 1.6);
      if (d2 > r * r) return false;
      // Termants fetch corpses whose genes they still lack first
      const k = f.kind === 'corpse' && genesWanted(c, f.from) ? d2 * 0.25 : d2;
      if (k < bd) {
        bd = k;
        best = f;
      }
    });
    if (best) {
      a.tgt = (best as Food).id;
      a.tk = 1;
      enterState(a, AS.ToFood);
      return;
    }
  }
  // 4. trail following (outbound: prefer stronger trail further from home)
  const L = cd.length;
  const here = homeDist(w, c, a.x, a.y);
  if (!area) {
    if (here > MAX_RANGE || (a.state === AS.Scout && a.st > 110)) {
      // give up and go home empty-handed
      if (goHome(w, a, dt)) enterState(a, AS.ToStore);
      return;
    }
  }
  let bestS = 0;
  let bestH = a.h;
  for (const off of [-0.55, 0, 0.55]) {
    const h = a.h + off;
    const sx = a.x + dcos(h) * (L + 3);
    const sy = a.y + dsin(h) * (L + 3);
    const p = w.phero.sample(c.id, sx, sy);
    if (p < 0.05) continue;
    const outward = homeDist(w, c, sx, sy) > here ? 1.6 : 0.5;
    const s = p * outward;
    if (s > bestS) {
      bestS = s;
      bestH = h;
    }
  }
  if (bestS > 0.06 && (!area || sq(a.x - area.x) + sq(a.y - area.y) < area.r * area.r * 4)) {
    // trail followers walk straight with antennae low
    if (a.state !== AS.FollowTrail) enterState(a, AS.FollowTrail);
    turnToward(a, bestH, dt, 9);
    moveForward(w, a, antSpeed(w, a), dt);
    return;
  }
  // 5. scouting: zigzag, biased outward from home (or around the marker)
  if (area?.key && dhypot(area.x - a.x, area.y - a.y) > area.r * 1.5) {
    // Far from the marker: walk there along a path first. Where the colony's
    // trail runs under it, the ant is following that trail (antennae low).
    const onTrail = w.phero.sample(c.id, a.x, a.y) > 0.08;
    const st = onTrail ? AS.FollowTrail : AS.Scout;
    if (a.state !== st) enterState(a, st);
    goToSurfacePoint(w, a, area.x, area.y, dt, area.key);
    return;
  }
  if (a.state !== AS.Scout) enterState(a, AS.Scout);
  let bias: { h: number; k: number };
  if (area) {
    const dm = dhypot(area.x - a.x, area.y - a.y);
    bias = { h: datan2(area.y - a.y, area.x - a.x), k: dm > area.r ? 3 : 0.3 };
  } else {
    // Hold a personal heading, drifting outward from the entrance used (the
    // nest's centre can be well off to one side of its entrance).
    const e = c.entrances[nearestEntrance(c, a.x, a.y)];
    const out = e ? datan2(a.y - e.sy, a.x - e.sx) : a.scoutH;
    const h = here < 60 ? a.scoutH : a.scoutH + angleDiffTo(a.scoutH, out) * 0.35;
    bias = { h, k: 0.7 };
  }
  wander(w, a, dt, 1.2, bias);
}

/** How much one ant takes from a food source: its caste's carry × its level (harvest; no co-op hauling). */
export function carryCap(a: Ant): number {
  return casteOf(a.caste).carry * BALANCE.levelCarry[Math.max(0, Math.min(2, (a.level || 1) - 1))];
}

function collect(w: World, a: Ant, c: Colony, f: Food, dt: number): void {
  const cd = casteOf(a.caste);
  a.v = 0;
  turnToward(a, datan2(f.y - a.y, f.x - a.x), dt, 8);
  a.pose = POSE.DIG; // biting/handling the item
  const wood = f.kind === 'wood';
  // termites chew a fragment loose: a few bites, a fixed interval apart (leaf litter: SICKLE.food)
  const litter = f.from === 'litter';
  const LP = SICKLE.food.leafLitterPatch;
  const biteEvery = litter ? LP.biteIntervalSec : NASUTE.wood.biteIntervalSec;
  const handle = wood ? (litter ? LP.bitesPerFragment : NASUTE.wood.bitesPerFragment) * biteEvery : 0.7;
  if (wood && a.st > 0 && Math.floor(a.st / biteEvery) !== Math.floor((a.st - dt) / biteEvery) && a.st < handle) {
    w.events.emit({ t: 'bite', x: f.x, y: f.y, space: a.space, strength: 0.12, by: a.caste, on: 'wood' });
  }
  if (a.st < handle) return;
  // Harvest: a small item it can lift goes whole; from anything bigger it takes its own load
  // (caste carry × level) and the source shrinks. Nobody hauls a whole carcass together.
  const cap = carryCap(a);
  const small = f.mass <= cd.grip * 1.6 && f.amount <= cap * 1.8;
  // army-ant porters: a big item goes whole, carried by a team the porter leads (eciton.ts)
  if (!small && cd.porter && teamCarry(w, a, c, f, cap)) {
    f.heldBy = a.id;
    a.carry = Carry.Food;
    a.carryId = f.id;
    a.carryAmt = f.amount;
    a.tgt = 0;
    a.tk = 0;
    a.lost = 0.2;
    enterState(a, AS.Return);
    return;
  }
  if (small) {
    f.heldBy = a.id;
    a.carry = f.kind === 'leaf' ? Carry.Leaf : Carry.Food;
    a.carryId = f.id;
    a.carryAmt = f.amount;
    a.tgt = 0;
    a.tk = 0;
    a.lost = 0.2; // source exhausted: weak trail
    enterState(a, AS.Return);
    return;
  }
  // Cut off a load-sized piece (termites: one chewed fragment of wood).
  const amt = Math.min(wood ? (litter ? LP.perFragment : NASUTE.wood.woodPerFragment) : cap, f.amount);
  f.amount -= amt;
  const piece = wood
    ? makeFood(w, 'wood', SURFACE, a.x, a.y, 1, litter ? 'litterchip' : 'chip')
    : makeFood(w, f.kind === 'berry' ? 'crumb' : f.kind === 'seed' ? 'seed' : 'crumb', SURFACE, a.x, a.y, Math.sqrt(Math.max(0.3, amt / 2)) * 0.9, f.kind);
  piece.amount = piece.max = amt;
  piece.heldBy = a.id;
  tagPiece(c, f, piece, amt);
  a.carry = Carry.Food;
  a.carryId = piece.id;
  a.carryAmt = amt;
  a.lost = f.amount > 0 ? 1 : 0.2;
  a.tgt = f.amount > 0 ? f.id : 0; // remember the source to come back
  a.tk = f.amount > 0 ? 9 : 0;
  if (!wood) w.events.emit({ t: 'bite', x: f.x, y: f.y, space: SURFACE, strength: 0.25, by: a.caste, on: f.kind === 'seed' ? 'seed' : 'food' });
  if (f.amount <= 0.01) w.removeFoodNow(f.id);
  enterState(a, AS.Return);
}

/** Deliver whatever the ant carries to the right place in the nest. */
function returnAndStore(w: World, a: Ant, c: Colony, dt: number): void {
  if (a.space === SURFACE) {
    if (a.state !== AS.Return) enterState(a, AS.Return);
    // lay a recruitment trail when the source still has food
    if (a.carry === Carry.Food || a.carry === Carry.Leaf || a.carry === Carry.Liquid) {
      if (w.s.tick % 2 === 0) w.phero.deposit(c.id, a.x, a.y, 0.22 * (a.lost || 0.5) * abilityMods(c).trail);
    }
    if (a.carry === Carry.Corpse) {
      haulCorpseOutside(w, a, c, dt);
      return;
    }
    if (goHome(w, a, dt)) enterState(a, AS.ToStore);
    return;
  }
  if (!inOwnNest(a)) {
    goOut(w, a, dt);
    return;
  }
  if (a.carry === Carry.Corpse) {
    haulCorpse(w, a, c, dt);
    return;
  }
  // In the nest: to fungus garden (leaves) or food store.
  let f: Float32Array | null;
  if (a.carry === Carry.Leaf && c.fungusCap > 0) f = typeField(w, c, 'fungus');
  else f = storeField(w, c);
  if (!f) {
    deposit(w, a, c);
    return;
  }
  if (a.state !== AS.ToStore) enterState(a, AS.ToStore);
  const r = followNest(w, a, f, dt);
  if (r === 'arrived' || r === 'stuck') {
    if (a.st > 0.3 || r === 'stuck') {
      deposit(w, a, c);
    }
  }
}

function deposit(w: World, a: Ant, c: Colony): void {
  let amount = 0;
  if (a.carry === Carry.Liquid) amount = a.carryAmt > 0 ? a.carryAmt : a.crop * 3;
  else if (a.carry === Carry.Food || a.carry === Carry.Leaf) {
    const f = w.foodById.get(a.carryId);
    amount = f ? f.amount : a.carryAmt;
    // Termants: genes from enemy corpses; wood to the wood store (termants.ts)
    if (c.species === 'termant') amount = termantDeposit(w, c, f, amount);
    if (f) w.removeFoodNow(f.id);
  }
  if (a.carry === Carry.Leaf) {
    if (c.species === 'atta' || c.castes.includes('atta_media')) c.fungus += amount * BALANCE.atta.leafToFungus;
    else c.food = Math.min(c.foodCap, c.food + amount * BALANCE.atta.leafAsFood);
  } else {
    c.food = Math.min(c.foodCap, c.food + amount);
  }
  c.stats.food += amount;
  const liquid = a.carry === Carry.Liquid;
  if (liquid) a.crop = 0.6; // keeps some to pass on by trophallaxis
  a.carry = Carry.None;
  a.carryId = 0;
  a.carryAmt = 0;
  w.events.emit({ t: 'food', colony: c.id, amount });
  // Return to the remembered source, or rest briefly.
  // (9: a food item, 8: a leafy plant, 7: an aphid colony)
  if ((a.tk === 9 || a.tk === 8 || a.tk === 7) && a.tgt) {
    a.tk = a.tk === 9 ? 1 : a.tk === 8 ? 2 : 5;
    enterState(a, AS.ToExit);
  } else {
    a.tgt = 0;
    a.tk = 0;
    enterState(a, w.rng.chance(0.35) ? AS.Groom : AS.ToExit);
  }
  // Liquid foragers unload part of the crop to a waiting nestmate
  // (forager → receiver trophallaxis), then head out again.
  if (liquid) offerCrop(w, a);
}

function offerCrop(w: World, a: Ant): void {
  const L = casteOf(a.caste).length;
  let best: Ant | null = null;
  let bd = sq(L * 7);
  const c = w.colony(a.colony);
  w.antsNear(a.space, a.x, a.y, L * 7, (o) => {
    if (o === a || o.colony !== a.colony || o.id === c?.queen || o.partner || o.crop > 0.2) return false;
    if (o.carry !== Carry.None || !(o.state === AS.Idle || o.state === AS.Wander || o.state === AS.Groom || o.state === AS.TendQueen)) return false;
    const d2 = sq(o.x - a.x) + sq(o.y - a.y);
    if (d2 < bd) {
      bd = d2;
      best = o;
    }
    return false;
  });
  if (best) startTroph(w, a, best);
}

// ---------------------------------------------------------------------------
// Digging
// ---------------------------------------------------------------------------

function haul(w: World, a: Ant, c: Colony, dt: number): void {
  if (a.carry === Carry.Corpse) {
    if (a.space === SURFACE) haulCorpseOutside(w, a, c, dt);
    else haulCorpse(w, a, c, dt);
    return;
  }
  if (a.carry !== Carry.None) {
    returnAndStore(w, a, c, dt);
    return;
  }
  // nearest own corpse (prefer same space), or food lying on the nest floor
  // (seeds refunded from deleted tiles, dropped loads) to carry to storage
  let best: Food | null = null;
  let bd = Infinity;
  const home = nestSpace(c.id);
  for (const f of w.s.food) {
    if (f.heldBy) continue;
    // home workers only tidy their own nest (EotU: they do not go out)
    // (the colony's own dead are not carried: they sink into the ground within seconds)
    const floor = f.space === home && f.kind !== 'corpse' && f.colony !== -2 && edible(c, f);
    if (!floor) continue;
    const d = f.space === a.space ? sq(f.x - a.x) + sq(f.y - a.y) : 1e7;
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  if (!best) {
    setTask(w, a, 'idle');
    return;
  }
  const f = best;
  if (f.space !== a.space) {
    if (a.space === SURFACE) goHome(w, a, dt);
    else goOut(w, a, dt);
    return;
  }
  const L = casteOf(a.caste).length;
  const d = dhypot(f.x - a.x, f.y - a.y);
  if (d > L * 0.6 + f.size * 0.3) {
    if (a.space === SURFACE) steerTo(w, a, f.x, f.y, dt);
    else goToNestPoint(w, a, c, f.x, f.y, dt);
    return;
  }
  f.heldBy = a.id;
  a.carryId = f.id;
  if (f.kind === 'corpse') {
    a.carry = Carry.Corpse;
    enterState(a, AS.Necro);
  } else {
    a.carry = Carry.Food;
    a.carryAmt = f.amount;
    enterState(a, AS.ToStore);
  }
}

/** Necrophoresis: the dead are carried up and out to the refuse heap beside the entrance. */
function haulCorpse(w: World, a: Ant, c: Colony, dt: number): void {
  if (a.state !== AS.Necro) enterState(a, AS.Necro);
  goOut(w, a, dt);
}

/** Carry a corpse to a refuse spot away from the entrance (outside). */
function haulCorpseOutside(w: World, a: Ant, c: Colony, dt: number): void {
  const e = c.entrances[0];
  if (!e) {
    dropCorpse(w, a);
    return;
  }
  const ang = datan2(e.sy - c.ny, e.sx - c.nx) + 0.9;
  const tx = e.sx + dcos(ang) * 30;
  const ty = e.sy + dsin(ang) * 30;
  if (steerTo(w, a, tx, ty, dt) < 4) dropCorpse(w, a);
}

function dropCorpse(w: World, a: Ant): void {
  const f = w.foodById.get(a.carryId);
  if (f) {
    f.heldBy = 0;
    f.colony = -2; // refuse: no longer hauled
    f.x = a.x;
    f.y = a.y;
    f.space = a.space;
    f.amount *= 0.5;
  }
  a.carry = Carry.None;
  a.carryId = 0;
  enterState(a, AS.Idle);
}

// ---------------------------------------------------------------------------
// Fungus garden (Atta minims), guarding, markers
// ---------------------------------------------------------------------------

function garden(w: World, a: Ant, c: Colony, dt: number): void {
  const gardens = c.tiles.filter((t) => t.type === 'fungus');
  if (!gardens.length) {
    setTask(w, a, 'idle');
    return;
  }
  if (!inOwnNest(a)) {
    if (a.space === SURFACE) goHome(w, a, dt);
    else goOut(w, a, dt);
    return;
  }
  if (a.state === AS.Garden) {
    a.v = 0;
    a.pose = POSE.DIG;
    if (a.st > 2.5) enterState(a, AS.Idle);
    return;
  }
  if (a.state !== AS.Wander) {
    const t = gardens[w.rng.int(0, gardens.length - 1)];
    const p = tilePoint(w, c, t.q, 0.75);
    a.tx = p.x;
    a.ty = p.y;
    enterState(a, AS.Wander);
  }
  if (goToNestPoint(w, a, c, a.tx, a.ty, dt, 0.7)) enterState(a, AS.Garden);
}

function guard(w: World, a: Ant, c: Colony, dt: number): void {
  if (a.carry !== Carry.None) {
    dropCarried(w, a);
  }
  if (!inOwnNest(a)) {
    if (a.space === SURFACE) goHome(w, a, dt);
    else goOut(w, a, dt);
    return;
  }
  // Patrol between the ant's own tile, the queen and the entrance ramps.
  if (a.state !== AS.Guard || a.st > 14 + (a.id % 7)) {
    const g = w.nest(c.id)!;
    const queenT = c.tiles.find((t) => t.type === 'queen');
    const e = c.entrances[a.id % Math.max(1, c.entrances.length)];
    let r = w.rng.next();
    // termite majors hold the entrance chokes (their nasutes keep patrolling behind them)
    if (casteOf(a.caste).termite === 'major') r = 1;
    let p: { x: number; y: number };
    if (r < 0.45 && a.tile >= 0 && tileAt(c, a.tile)) p = tilePoint(w, c, a.tile, 0.8);
    else if (r < 0.75 && queenT) p = tilePoint(w, c, queenT.q, 0.9);
    else if (e) {
      // just inside the ramp: a neighbouring dug hex
      const nb = g.neighbors(e.q).filter((n) => n >= 0 && g.isHexDug(n));
      p = tilePoint(w, c, nb.length ? nb[a.id % nb.length] : e.q, 0.7);
    } else p = { x: a.x, y: a.y };
    a.tx = p.x;
    a.ty = p.y;
    enterState(a, AS.Guard);
  }
  if (goToNestPoint(w, a, c, a.tx, a.ty, dt, 0.6)) {
    a.v = 0;
    if (dsin(w.time * 0.4 + a.id * 1.7) > 0.6) a.pose = POSE.GROOM_LEGS;
  }
}

/**
 * Nest defence: while enemies are inside the nest, home soldiers (guards)
 * converge on the nearest intruder from anywhere in the nest, and workers
 * within reach join in. Narrow tunnels make the fights chokepoints. Groups
 * the player sent to markers keep their orders; nurses carrying brood and
 * the queen carry on.
 */
function defendNest(w: World, a: Ant, c: Colony, dt: number): boolean {
  const list = c.intruders;
  if (!list || !list.length || a.space !== nestSpace(c.id) || a.marker >= 0) return false;
  if (a.carry === Carry.Brood) return false;
  const cd = casteOf(a.caste);
  const fighter = cd.role === 'soldier' || cd.role === 'major' || a.task === 'guard';
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const p of list) {
    const d2 = sq(p.x - a.x) + sq(p.y - a.y);
    if (d2 < bd) {
      bd = d2;
      best = p;
    }
  }
  if (!best || (!fighter && bd > 70 * 70)) return false;
  if (a.carry !== Carry.None && a.carry !== Carry.Soil) dropCarried(w, a);
  a.alarm = 1;
  a.pose = POSE.ALARM;
  if (a.state !== AS.Guard) enterState(a, AS.Guard);
  goToNestPoint(w, a, c, best.x, best.y, dt, 1.15);
  return true;
}

/**
 * Nest alarm: while the nest is under attack, home-column ants out on the
 * surface drop what they are doing and run home to defend it (marker groups
 * keep the player's orders).
 */
function rushHome(w: World, a: Ant, c: Colony, dt: number): boolean {
  if (c.alarmT <= 0 || a.marker >= 0 || a.id === c.queen) return false;
  if (a.space === SURFACE) {
    if (a.carry !== Carry.None && a.carry !== Carry.Soil) dropCarried(w, a);
    a.alarm = Math.max(a.alarm, 0.8);
    a.pose = POSE.ALARM;
    if (a.state !== AS.Return) enterState(a, AS.Return);
    goHome(w, a, dt, 1.15);
    return true;
  }
  // Inside (and not near the intruders): nobody goes out; workers close in
  // round the queen, nurses keep to the brood.
  if (a.space !== nestSpace(c.id) || a.task === 'job' || a.carry === Carry.Brood) return false;
  const q = w.antById.get(c.queen);
  if (!q || q.space !== a.space) return false;
  const L = casteOf(a.caste).length;
  const ang = (a.id * 2.399) % (Math.PI * 2);
  const r = casteOf(q.caste).length * 0.9 + L * (1 + (a.id % 3));
  if (a.state !== AS.Guard) enterState(a, AS.Guard);
  a.alarm = Math.max(a.alarm, 0.6);
  if (goToNestPoint(w, a, c, q.x + dcos(ang) * r, q.y + dsin(ang) * r, dt, 1.1)) {
    a.v = 0;
    a.pose = POSE.ALARM;
  }
  return true;
}

/**
 * Raiders inside an enemy nest with nothing to fight grab its brood (eggs,
 * larvae, pupae) and carry it home as food, as army ants and slave-makers do.
 * Returns true when the ant is busy raiding.
 */
function raidBrood(w: World, a: Ant, c: Colony, dt: number): boolean {
  const cd = casteOf(a.caste);
  if (cd.carry <= 0 || a.carry !== Carry.None || eatsWood(c)) return false;
  const host = colonyOfSpace(a.space);
  const hc = w.colony(host);
  if (!hc || host === c.id || hc.team === c.team) return false; // allies' brood is left alone
  let target: Brood | null = null;
  if (a.tk === 6) {
    const b = w.broodById.get(a.tgt);
    if (b && b.colony === host && !b.carrier) target = b;
  }
  if (!target) {
    let bd = 60 * 60;
    for (const b of w.s.brood) {
      if (b.colony !== host || b.carrier) continue;
      const d2 = sq(b.x - a.x) + sq(b.y - a.y);
      if (d2 < bd) {
        bd = d2;
        target = b;
      }
    }
    if (!target) return false;
    a.tgt = target.id;
    a.tk = 6;
  }
  const d = dhypot(target.x - a.x, target.y - a.y);
  if (d > cd.length * 0.6 + 1) {
    goToNestPoint(w, a, null, target.x, target.y, dt, 1);
    return true;
  }
  // Seize it: the tile loses its brood (it will lay again later).
  const tile = tileAt(hc, target.tile);
  if (tile && tile.brood === target.id) {
    tile.brood = 0;
    tile.wait = 8;
  }
  const amt = Math.max(1.5, casteOf(target.caste).cost * (0.3 + 0.25 * target.stage));
  w.removeBroodNow(target.id);
  c.stats.stolen++;
  const piece = makeFood(w, 'crumb', a.space, a.x, a.y, 0.9 + 0.3 * target.stage, 'brood');
  piece.amount = piece.max = amt;
  piece.heldBy = a.id;
  a.carry = Carry.Food;
  a.carryId = piece.id;
  a.carryAmt = amt;
  a.tgt = 0;
  a.tk = 0;
  enterState(a, AS.Return);
  w.events.emit({ t: 'bite', x: a.x, y: a.y, space: a.space, strength: 0.2, by: a.caste, on: 'brood' });
  return true;
}

/** Ants whose group is out at a placed marker: swarm there; workers forage it, soldiers hold it. */
function marker(w: World, a: Ant, c: Colony, dt: number): void {
  const m = a.marker >= 0 ? c.markers[a.marker] : undefined;
  if (!m || !m.placed) {
    setTask(w, a, 'idle');
    return;
  }
  const cd = casteOf(a.caste);
  const radius = markerRadius(w, c, a.marker);
  // Get into the marker's space first (through an entrance into its area when it is underground).
  if (a.space !== m.space) {
    if (a.carry !== Carry.None && a.carry !== Carry.Soil) {
      returnAndStore(w, a, c, dt);
      return;
    }
    if (a.carry === Carry.Soil) {
      a.carry = Carry.None;
      a.carryAmt = 0;
    }
    if (m.space === SURFACE) goOut(w, a, dt);
    else goToArea(w, a, m.space, dt);
    return;
  }
  // battle arena: every unit only fights — it goes to its team's marker and takes on what comes near (sim/arena.ts)
  if (w.s.mode.arena) {
    if (a.carry !== Carry.None) dropCarried(w, a);
    const d = dhypot(m.x - a.x, m.y - a.y);
    if (a.space !== SURFACE) goToNestPoint(w, a, null, m.x, m.y, dt, 1);
    else if (holdGuardLine(w, a, c, a.marker, dt)) return;
    else if (d > radius) {
      goToSurfacePoint(w, a, m.x, m.y, dt, `mk:${c.id}:${a.marker}`);
      a.alarm = Math.max(a.alarm, 0.15);
    } else wander(w, a, dt, 1, { h: datan2(m.y - a.y, m.x - a.x), k: d / radius }, 0.6);
    return;
  }
  // army ants: a team-carry helper walks beside its porter's load; any army ant may cross a living bridge (eciton.ts)
  if (isArmyAnt(c) && a.space === SURFACE && ((a.helpOf ?? 0) !== 0 ? teamHelp(w, a, c, dt) : crossBridge(w, a, c, dt))) return;
  // Every caste collects food at a marker (fighters still fight first: combat preempts this). Termite soldiers
  // gather like ant soldiers (user note 2026-10-25); where there is nothing to gather they take their escort slots.
  // a marker's "no gathering" order: its ants hold the marker (the guard line) and pick nothing up
  const forager = cd.forage && cd.carry > 0 && !underOrder(c, a, 'noGather');
  let escort = forager && a.space === SURFACE && a.carry === Carry.None && (cd.termite === 'nasute' || cd.termite === 'major' || cd.termite === 'sickle');
  if (escort) {
    const food = foodAt(w, c, m.x, m.y, radius * 1.3);
    // sickle-jaws: a share guards the trail even while there is food (the rest gather); the others only without food
    escort = cd.termite === 'sickle' ? sickleGuardIndex(w, a, c, a.marker, food).k >= 0 : !food;
  }
  if (forager && a.space === SURFACE && !escort) {
    if (a.carry !== Carry.None) {
      returnAndStore(w, a, c, dt);
      return;
    }
    // army ants: the swarm raid (a media walks beside a laden porter first) — eciton.ts
    if (isArmyAnt(c) && m.space === SURFACE && ((cd.role === 'soldier' && escortPorter(w, a, c, dt)) || raider(w, a, c, a.marker, dt))) return;
    searchAndCollect(w, a, c, dt, { x: m.x, y: m.y, r: radius, key: `mk:${c.id}:${a.marker}` });
    return;
  }
  if (a.carry !== Carry.None && a.carry !== Carry.Soil) {
    returnAndStore(w, a, c, dt);
    return;
  }
  const away = a.space !== SURFACE && a.space !== nestSpace(c.id);
  // In an enemy nest, workers carry off its brood when nothing needs fighting.
  if (away && !underOrder(c, a, 'noGather') && !(cd.role === 'soldier' || cd.role === 'major') && raidBrood(w, a, c, dt)) return;
  // In a cave or another nest, foragers carry home any food lying near the marker.
  if (away && forager && collectUnderground(w, a, c, dt, m.x, m.y, radius * 1.6)) return;
  // Termite soldiers: the escort ring / the line at the marker front (termites.ts)
  if (cd.termite && holdMarkerSlot(w, a, c, a.marker, radius, dt)) return;
  // army-ant Soldiers: guard posts along the raid trail (or with the raid) — eciton.ts
  if (isArmyAnt(c) && isMajor(a) && m.space === SURFACE && a.space === SURFACE && soldier(w, a, c, a.marker, dt)) return;
  // Fighters on the surface: the guard line across the marker (guardLine.ts)
  if (a.space === SURFACE && inGuardLine(w, a) && holdGuardLine(w, a, c, a.marker, dt)) return;
  // Fighters (and workers in a nest): mill around the marker, ready to fight.
  const d = dhypot(m.x - a.x, m.y - a.y);
  if (d > radius) {
    if (a.space === SURFACE) goToSurfacePoint(w, a, m.x, m.y, dt, `mk:${c.id}:${a.marker}`);
    else goToNestPoint(w, a, null, m.x, m.y, dt, 1);
    a.alarm = Math.max(a.alarm, 0.15);
    return;
  }
  if (a.space === SURFACE) wander(w, a, dt, 1, { h: datan2(m.y - a.y, m.x - a.x), k: d / radius }, 0.6);
  else {
    if (a.state !== AS.Rally || a.st > 4) {
      const ang = w.rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(w.rng.next()) * radius * 0.8;
      a.tx = m.x + dcos(ang) * rr;
      a.ty = m.y + dsin(ang) * rr;
      enterState(a, AS.Rally);
    }
    if (goToNestPoint(w, a, null, a.tx, a.ty, dt, 0.6)) a.v = 0;
  }
}

/** Is there anything this colony eats lying within r of a point on the surface? */
export function foodAt(w: World, c: Colony, x: number, y: number, r: number): boolean {
  let found = false;
  w.foodNear(x, y, r, (f) => (found = f.amount > 0.05 && f.kind !== 'honeydew' && edible(c, f)));
  return found;
}

/**
 * Food lying on the floor of a cave or another colony's nest, near a marker:
 * walk to it, pick it up (or bite off a load), and carry it home.
 * Returns true while busy.
 */
function collectUnderground(w: World, a: Ant, c: Colony, dt: number, mx: number, my: number, r: number): boolean {
  const cd = casteOf(a.caste);
  if (cd.carry <= 0 || a.carry !== Carry.None) return false;
  let f: Food | null = null;
  if (a.tk === 1) {
    const t = w.foodById.get(a.tgt);
    if (t && t.space === a.space && !t.heldBy && t.amount > 0) f = t;
  }
  if (!f && (w.s.tick + a.id) % 4 === 0) {
    let bd = r * r;
    for (const o of w.s.food) {
      if (o.space !== a.space || o.heldBy || o.amount <= 0 || o.kind === 'honeydew' || o.colony === -2) continue;
      if (!edible(c, o)) continue;
      if (o.kind === 'wood' && !eatsWood(c) && !cd.wood) continue;
      if (o.kind === 'corpse' && w.teamOf(o.colony) === (a.team ?? a.colony)) continue;
      if (o.kind === 'leaf' && !cd.cutLeaves) continue;
      const d2 = sq(o.x - mx) + sq(o.y - my);
      if (d2 < bd) {
        bd = d2;
        f = o;
      }
    }
    if (f) {
      a.tgt = f.id;
      a.tk = 1;
      enterState(a, AS.ToFood);
    }
  }
  if (!f) return a.tk === 1 && a.state === AS.ToFood;
  const reach = f.size * 0.5 + cd.length * 0.45;
  if (dhypot(f.x - a.x, f.y - a.y) > reach) {
    if (a.state !== AS.ToFood) enterState(a, AS.ToFood);
    goToNestPoint(w, a, null, f.x, f.y, dt);
    return true;
  }
  if (a.state !== AS.Collect) enterState(a, AS.Collect);
  a.v = 0;
  a.pose = POSE.DIG;
  if (a.st < 0.7) return true;
  if (f.mass <= cd.grip * 1.6 && f.amount <= cd.carry * 1.8) {
    f.heldBy = a.id;
    a.carry = f.kind === 'leaf' ? Carry.Leaf : Carry.Food;
    a.carryId = f.id;
    a.carryAmt = f.amount;
  } else {
    const amt = Math.min(cd.carry, f.amount);
    f.amount -= amt;
    const piece = f.kind === 'wood' ? makeFood(w, 'wood', a.space, a.x, a.y, 1, 'chip') : makeFood(w, f.kind === 'seed' ? 'seed' : 'crumb', a.space, a.x, a.y, Math.sqrt(Math.max(0.3, amt / 2)) * 0.9, f.kind);
    piece.amount = piece.max = amt;
    piece.heldBy = a.id;
    tagPiece(c, f, piece, amt);
    a.carry = Carry.Food;
    a.carryId = piece.id;
    a.carryAmt = amt;
    if (f.amount <= 0.01) w.removeFoodNow(f.id);
  }
  a.tgt = 0;
  a.tk = 0;
  enterState(a, AS.Return);
  w.events.emit({ t: 'bite', x: a.x, y: a.y, space: a.space, strength: 0.15, by: a.caste, on: 'food' });
  return true;
}

export { colonyOfSpace, CASTES };
