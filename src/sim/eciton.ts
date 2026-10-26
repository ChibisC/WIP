import { World } from './world';
import { Ant, AS, Carry, Colony, EcLink, EcRaid, MARKER_COUNT, POSE, SURFACE } from './types';
import { BALANCE, ECITON } from './balance';
import { CASTES, casteOf } from './species';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';
import { antSpeed, goToSurfacePoint, homeField, moveForward, nearestEntrance, steerTo, turnToward } from './movement';
import { enterState } from './antAI';
import { edible } from './diet';
import { markerRadius } from './markers';
import { markerRoute, Route, routeAt, routeLength, routeNearest } from './route';

/**
 * Army ants, Eciton burchellii (claude/army-ants package, plan Step 3; numbers in ECITON, balance.ts). The colony
 * nests like every other species (user decision 2026-10-25: no bivouac, no phases, no queen attendants); what is
 * new happens on the surface, at the raid markers:
 *
 *  - Swarm raid. The workers sent to a surface marker form a front: an arc across the raid direction, as wide as
 *    √(raiders) allows, that creeps forward while the raiders keep up with it and turns back into the raid area at
 *    its edge (the front roams `raid.areaMul` × the marker radius round the marker). Each raider has a slot on
 *    the arc (by id) and pulses: it runs ahead of its slot, falls back a little, waits, and goes again. Food the
 *    pulse brings it near is bitten up and carried home. Small creatures near the front run from it (flushed).
 *  - Three lanes. Laden ants walk home down the middle of the trail (the home flow field); outbound ants walk
 *    out along the trail `lanes.laneOffset` body lengths to its side (each ant always the same side, so both
 *    edges are used) and step further aside for a laden ant met head-on.
 *  - Soldier posts. With at least `guard.minMajors` Soldiers alive, the Soldiers sent to a raid stand guard along
 *    the whole trail from the nest entrance to the front, alternating sides, facing out, densest at both ends;
 *    `guard.reserve` of them stay with the raid. They rush enemies near their post and walk back afterwards.
 *  - Porters carry their load slung under the body (finish() in antAI, the render's porter pose); a media walks
 *    beside a laden porter on its way home (escort).
 *
 * Sim state: the raid fronts and posts on the colony (`c.ecRaid`), the pulse on the ant (`ecPh`, `ecT`, `ecN`,
 * `ecY`). Rolls (who is at which marker) and the trail (route.ts) are caches rebuilt from the state.
 */

const LM = (): number => CASTES.eciton_minor.length;
const LMAJ = (): number => CASTES.eciton_major.length;

export const isArmyAnt = (c: Colony): boolean => c.species === 'eciton';
export const isMajor = (a: Ant): boolean => a.caste === 'eciton_major';

// ---------------------------------------------------------------------------------------------------------------
// Rolls: who is out at each marker (a per-tick cache rebuilt from the state)
// ---------------------------------------------------------------------------------------------------------------

interface Roll {
  /** raiders: foragers (Worker, Porter, Media) sent to the marker, any space, id order */
  raid: number[];
  /** Soldiers sent to the marker, id order */
  majors: number[];
}
let rollTick = -1; // det-ok: per-tick cache
let rollState: unknown = null; // det-ok: per-tick cache
const rolls = new Map<number, Roll>(); // det-ok: per-tick cache, rebuilt from SimState
const majorsAlive = new Map<number, number>(); // det-ok: per-tick cache, rebuilt from SimState

function buildRolls(w: World): void {
  if (rollTick === w.s.tick && rollState === w.s) return;
  rollTick = w.s.tick;
  rollState = w.s;
  rolls.clear();
  majorsAlive.clear();
  for (const a of w.s.ants) {
    if (a.state === AS.Dead) continue;
    const cd = casteOf(a.caste);
    if (cd.species !== 'eciton' || cd.role === 'queen') continue;
    if (isMajor(a)) majorsAlive.set(a.colony, (majorsAlive.get(a.colony) ?? 0) + 1);
    if (a.task !== 'marker' || a.marker < 0) continue;
    const key = a.colony * 16 + a.marker;
    let r = rolls.get(key);
    if (!r) rolls.set(key, (r = { raid: [], majors: [] }));
    if (isMajor(a)) r.majors.push(a.id);
    else if (cd.forage && cd.carry > 0) r.raid.push(a.id);
  }
}

const EMPTY: Roll = { raid: [], majors: [] }; // det-ok: constant
export function rollOf(w: World, c: Colony, mi: number): Roll {
  buildRolls(w);
  return rolls.get(c.id * 16 + mi) ?? EMPTY;
}
function majorCount(w: World, c: Colony): number {
  buildRolls(w);
  return majorsAlive.get(c.id) ?? 0;
}

/** The trail for a raid marker (route.ts), refreshed with the guard posts. */
export function raidRoute(w: World, c: Colony, mi: number): Route {
  return markerRoute(w, c, mi, 4, ECITON.guard.refreshSec * 2);
}

/** A deterministic 0..1 value from two integers (pulse waits; no RNG draw so the pulse never shifts other draws). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------------------
// The colony system: raid fronts, flushing, guard posts (every tick, before the ants move)
// ---------------------------------------------------------------------------------------------------------------

function newRaid(): EcRaid {
  return { on: 0, mx: 0, my: 0, x: 0, y: 0, h: 0, turn: 1, idle: 0, posts: [] };
}

/** Start (or restart) a raid at marker mi: the front on the marker's near edge, heading away from the nest. */
function resetRaid(w: World, c: Colony, mi: number, R: EcRaid): void {
  const m = c.markers[mi];
  const e = c.entrances[nearestEntrance(c, m.x, m.y)];
  const h = e ? datan2(m.y - e.sy, m.x - e.sx) : 0;
  const r = markerRadius(w, c, mi);
  R.on = 1;
  R.mx = m.x;
  R.my = m.y;
  R.h = h;
  R.x = m.x - dcos(h) * r;
  R.y = m.y - dsin(h) * r;
  if (!w.walkable(SURFACE, R.x, R.y)) {
    R.x = m.x;
    R.y = m.y;
  }
  R.turn = 1;
  R.idle = 0;
  R.posts.length = 0;
}

/** Half-width of the front (mm) for n raiders. */
export function frontHalfWidth(w: World, c: Colony, mi: number, n: number): number {
  return Math.min(ECITON.raid.frontWidthPerSqrtN * Math.sqrt(Math.max(1, n)) * LM(), markerRadius(w, c, mi) * ECITON.raid.areaMul * ECITON.raid.maxHalfWidthOfArea);
}

/** Depth of the swarm band behind the front line (mm): deep enough for the raiders at `bandSpacingBodyLengths` apart. */
function bandDepth(W: number, n: number): number {
  const sp = ECITON.raid.bandSpacingBodyLengths * LM();
  return Math.max(2 * LM(), (n * sp * sp) / (2 * W));
}

export function ecitonSystem(w: World, dt: number): void {
  for (const c of w.s.colonies) {
    if (!isArmyAnt(c)) continue;
    if (!c.ecRaid) {
      c.ecRaid = [];
      for (let i = 0; i < MARKER_COUNT; i++) c.ecRaid.push(newRaid());
    }
    for (let mi = 0; mi < c.markers.length && mi < c.ecRaid.length; mi++) {
      const m = c.markers[mi];
      const R = c.ecRaid[mi];
      if (!m.placed || m.space !== SURFACE) {
        if ((w.s.tick + c.id) % 10 === 0 && c.ecLinks?.length) linksSystem(w, c, mi, false, dt * 10);
        if (R.on) {
          R.on = 0;
          R.posts.length = 0;
        }
        continue;
      }
      const roll = rollOf(w, c, mi);
      if (!R.on || R.mx !== m.x || R.my !== m.y) resetRaid(w, c, mi, R);
      if (roll.raid.length === 0 && roll.majors.length === 0) {
        if ((w.s.tick + c.id) % 10 === 0 && c.ecLinks?.length) linksSystem(w, c, mi, false, dt * 10);
        R.idle += dt;
        if (R.idle > ECITON.raid.resetSec) resetRaid(w, c, mi, R);
        R.posts.length = 0;
        continue;
      }
      R.idle = 0;
      advanceFront(w, c, mi, R, roll, dt);
      if ((w.s.tick + c.id) % 10 === 0) linksSystem(w, c, mi, roll.raid.length > 0, dt * 10);
      if ((w.s.tick + c.id) % 10 === 0) flush(w, R);
      if ((w.s.tick + c.id) % Math.max(1, Math.round(ECITON.guard.refreshSec * BALANCE.tickHz)) === 0 || (R.posts.length === 0 && roll.majors.length > 0)) placePosts(w, c, mi, R, roll);
    }
  }
}

/** The front creeps on while the raiders keep up with it, and turns back into the raid area at its edge. */
function advanceFront(w: World, c: Colony, mi: number, R: EcRaid, roll: Roll, dt: number): void {
  const P = ECITON.raid;
  const n = roll.raid.length;
  if (n === 0) return;
  const W = frontHalfWidth(w, c, mi, n);
  const near = W + 6 * LM();
  let up = 0;
  for (const id of roll.raid) {
    const a = w.antById.get(id);
    if (a && a.space === SURFACE && sq(a.x - R.x) + sq(a.y - R.y) < near * near) up++;
  }
  if (up < Math.max(1, Math.ceil(n * P.keepUpShare))) return;
  const step = P.frontSpeedMul * CASTES.eciton_minor.speed * dt;
  const nx = R.x + dcos(R.h) * step;
  const ny = R.y + dsin(R.h) * step;
  const area = markerRadius(w, c, mi) * P.areaMul;
  if (dhypot(nx - R.mx, ny - R.my) > area || !w.walkable(SURFACE, nx, ny)) {
    // at the edge of the raid area (or water / a rock ahead): swing back in, alternately left and right of the marker
    R.h = datan2(R.my - R.y, R.mx - R.x) + R.turn * P.turnRad;
    R.turn = -R.turn;
    return;
  }
  R.x = nx;
  R.y = ny;
}

/** Small creatures near the front run from it (they are flushed ahead of the swarm). */
function flush(w: World, R: EcRaid): void {
  const P = ECITON.raid;
  w.creaturesNear(R.x, R.y, P.flushRadiusMm, (cr) => {
    if (cr.dead || cr.space !== SURFACE || cr.latched > 0 || cr.scale > P.flushMaxMm) return false;
    cr.data.flushT = P.flushSec;
    cr.data.flushX = R.x;
    cr.data.flushY = R.y;
    return false;
  });
}

const LAT = [1, 0.75, 0.5, 0.25]; // det-ok: constant
const pt = { x: 0, y: 0, ux: 0, uy: 0 }; // det-ok: scratch

/**
 * Soldier posts along the trail, nest entrance → marker → front: as many as there are Soldiers to man them (after
 * the reserve), at most one per `spacing` Soldier lengths plus the extra ones at the two ends, spread so they are
 * densest at both ends; alternating sides, `sideOffset` off the trail, facing out. None when the colony has fewer
 * than `minMajors` Soldiers (they raid with the others).
 */
function placePosts(w: World, c: Colony, mi: number, R: EcRaid, roll: Roll): void {
  const G = ECITON.guard;
  R.posts.length = 0;
  if (majorCount(w, c) < G.minMajors) return;
  const guards = roll.majors.length - G.reserve;
  if (guards <= 0) return;
  const L = LMAJ();
  const rt = raidRoute(w, c, mi);
  const routeLen = routeLength(rt);
  const tail = dhypot(R.x - R.mx, R.y - R.my); // marker → front
  const start = L * 2; // not on the entrance itself
  const total = routeLen + tail - start;
  if (total < L * 3) return;
  const sp = G.spacing * L;
  const maxPosts = Math.max(2, Math.round(total / sp) + G.entranceBias + G.frontBias);
  const n = Math.min(guards, maxPosts);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    // densest at both ends: arc length warped by u − ½·sin(2πu)/(2π)
    const s = start + total * (u - (0.5 * dsin(2 * Math.PI * u)) / (2 * Math.PI));
    // s runs from the entrance end: on the route (marker 0 … entrance routeLen) it is routeLen − s; past the marker,
    // the straight run out to the front
    let cx: number;
    let cy: number;
    let ux: number;
    let uy: number;
    if (s <= routeLen) {
      routeAt(rt, routeLen - s, pt);
      cx = pt.x;
      cy = pt.y;
      ux = -pt.ux; // outward along the trail
      uy = -pt.uy;
    } else {
      const k = tail > 1e-6 ? (s - routeLen) / tail : 0;
      ux = tail > 1e-6 ? (R.x - R.mx) / tail : 1;
      uy = tail > 1e-6 ? (R.y - R.my) / tail : 0;
      cx = R.mx + (R.x - R.mx) * k;
      cy = R.my + (R.y - R.my) * k;
    }
    const side = i % 2 === 0 ? 1 : -1;
    // right of the outward direction is (−uy, ux)
    const nx = -uy * side;
    const ny = ux * side;
    let px = cx;
    let py = cy;
    for (const k of LAT) {
      const qx = cx + nx * G.sideOffset * L * k;
      const qy = cy + ny * G.sideOffset * L * k;
      if (w.walkable(SURFACE, qx, qy)) {
        px = qx;
        py = qy;
        break;
      }
    }
    R.posts.push(px, py, datan2(ny, nx));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The ants (called from antAI.marker for army ants out at a surface marker)
// ---------------------------------------------------------------------------------------------------------------

const near = { s: 0, d: 0, x: 0, y: 0, ux: 0, uy: 0 }; // det-ok: scratch

/**
 * Walk out to the raid along the trail, in the outbound lane: `laneOffset` body lengths to the ant's own side of
 * the trail (by id, so both edges carry outbound traffic), further aside while a laden nestmate comes the other way.
 */
export function walkOut(w: World, a: Ant, c: Colony, mi: number, dt: number, speedMul = 1): void {
  const m = c.markers[mi];
  const L = casteOf(a.caste).length;
  const rt = raidRoute(w, c, mi);
  routeNearest(rt, a.x, a.y, near);
  if (near.d > 25 || rt.cum.length < 2) {
    // off the trail: back to it (or straight to the marker)
    goToSurfacePoint(w, a, m.x, m.y, dt, `mk:${c.id}:${mi}`, speedMul);
    return;
  }
  if ((w.s.tick + a.id) % 2 === 0) yieldCheck(w, a, L);
  const side = a.id % 2 === 0 ? 1 : -1;
  const off = ECITON.lanes.laneOffset * L * side * ((a.ecY ?? 0) > 0 ? 1.8 : 1);
  routeAt(rt, Math.max(0, near.s - (L * 2 + 4)), pt);
  // outbound direction is −u (toward the marker); its right is (u.y, −u.x)
  let tx = pt.x + pt.uy * off;
  let ty = pt.y - pt.ux * off;
  if (!w.walkable(SURFACE, tx, ty)) {
    tx = pt.x;
    ty = pt.y;
  }
  if (a.state !== AS.FollowTrail) enterState(a, AS.FollowTrail);
  steerTo(w, a, tx, ty, dt, speedMul);
}

/** Outbound ants give way: a laden nestmate coming head-on within `yieldBodyLengths` → step aside for a moment. */
function yieldCheck(w: World, a: Ant, L: number): void {
  if ((a.ecY ?? 0) > 0) return;
  const r = ECITON.lanes.yieldBodyLengths * L;
  const hx = dcos(a.h);
  const hy = dsin(a.h);
  let hit = false;
  w.antsNear(a.space, a.x + hx * r * 0.6, a.y + hy * r * 0.6, r, (o) => {
    if (o === a || o.colony !== a.colony || o.carry === Carry.None || o.carry === Carry.Soil) return false;
    if (hx * dcos(o.h) + hy * dsin(o.h) > -0.5) return false;
    hit = true;
    return true;
  });
  if (hit) a.ecY = 0.6;
}

/** Tick the pulse and yield timers (antAI, every army ant). */
export function ecitonTimers(a: Ant, dt: number): void {
  if ((a.ecY ?? 0) > 0) a.ecY = Math.max(0, (a.ecY ?? 0) - dt);
}

const slot = { x: 0, y: 0, ux: 0, uy: 0 }; // det-ok: scratch

/** This raider's place on the front: across the advance by roll index, the flanks trailing a little (a fan). */
function frontSlot(w: World, c: Colony, mi: number, R: EcRaid, k: number, n: number, id: number): void {
  const W = frontHalfWidth(w, c, mi, n);
  // across the advance by roll index (a little jitter so they are no drill line), back into the band by id
  const t = n > 1 ? Math.max(-1, Math.min(1, ((k + 0.25 + 0.5 * hash01(id, 11)) / n) * 2 - 1)) : 0;
  const back = W * 0.3 * t * t + bandDepth(W, n) * hash01(id, 23);
  const ux = dcos(R.h);
  const uy = dsin(R.h);
  slot.ux = ux;
  slot.uy = uy;
  slot.x = R.x - uy * t * W - ux * back;
  slot.y = R.y + ux * t * W - uy * back;
}

/**
 * A raider (Worker, Porter, Media, or a reserve Soldier) at a surface raid marker. Returns true when it handled
 * the tick; false lets antAI's forager code run (heading to and biting up food it has found).
 */
export function raider(w: World, a: Ant, c: Colony, mi: number, dt: number): boolean {
  const R = c.ecRaid?.[mi];
  if (!R || !R.on) return false;
  const cd = casteOf(a.caste);
  const L = cd.length;
  // on its way to food it found (or biting it up): the forager code
  if (a.tk === 1 && (a.state === AS.ToFood || a.state === AS.Collect)) return false;
  const roll = rollOf(w, c, mi);
  let k = roll.raid.indexOf(a.id);
  let n = roll.raid.length;
  if (k < 0) {
    // a reserve Soldier: a place among the raiders
    k = (roll.majors.indexOf(a.id) * 7919) % Math.max(1, n + 1);
    n = Math.max(n, 1);
  }
  frontSlot(w, c, mi, R, k, n, a.id);
  const W = frontHalfWidth(w, c, mi, n);
  const dFront = dhypot(a.x - R.x, a.y - R.y);
  // still on the way out: along the trail in the outbound lane
  if (dFront > W + 30) {
    const m = c.markers[mi];
    if (dhypot(a.x - m.x, a.y - m.y) > markerRadius(w, c, mi) * 1.5) walkOut(w, a, c, mi, dt);
    // (one flow field per raid, to the front centre: a field per ant's own slot would be rebuilt every call)
    else if (dhypot(slot.x - a.x, slot.y - a.y) < 30) steerTo(w, a, slot.x, slot.y, dt);
    else goToSurfacePoint(w, a, R.x, R.y, dt, `ecf:${c.id}:${mi}`);
    return true;
  }
  // water or a rock between it and its place on the front: round it on the front's own flow field
  if (dhypot(slot.x - a.x, slot.y - a.y) > L * 3 && !clearLine(w, a.x, a.y, slot.x, slot.y)) {
    if (a.state !== AS.Scout) enterState(a, AS.Scout);
    goToSurfacePoint(w, a, R.x, R.y, dt, `ecf:${c.id}:${mi}`);
    return true;
  }
  // food the pulse has brought it near: bite it up (the forager code takes over)
  if (cd.forage && cd.carry > 0 && (w.s.tick + a.id) % 4 === 0 && senseFood(w, a, c, L)) return false;
  pulse(w, a, L, dt);
  return true;
}

/** Open ground all the way from (ax, ay) to (bx, by) (sampled every 3 mm)? */
function clearLine(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  const d = dhypot(bx - ax, by - ay);
  const n = Math.min(40, Math.ceil(d / 3));
  for (let k = 1; k <= n; k++) if (!w.walkable(SURFACE, ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) return false;
  return true;
}

/** Edible food within `searchBodyLengths` of the raider (Porters pass over crumbs smaller than `porter.minLoad`). */
function senseFood(w: World, a: Ant, c: Colony, L: number): boolean {
  const cd = casteOf(a.caste);
  const r = ECITON.raid.searchBodyLengths * L + 6;
  let best = 0;
  let bd = Infinity;
  w.foodNear(a.x, a.y, r + 10, (f, d2) => {
    if (f.amount <= 0 || f.heldBy !== 0 || f.space !== SURFACE || !edible(c, f) || f.colony === -2) return false;
    if (f.kind === 'corpse' && w.teamOf(f.colony) === (a.team ?? a.colony)) return false;
    if (cd.porter && f.amount < ECITON.porter.minLoad && d2 > sq(L)) return false;
    const rr = r + f.size * 0.5;
    if (d2 > rr * rr) return false;
    if (d2 < bd || (d2 === bd && f.id < best)) {
      bd = d2;
      best = f.id;
    }
  });
  if (!best) return false;
  a.tgt = best;
  a.tk = 1;
  enterState(a, AS.ToFood);
  return true;
}

/** Run ahead of the slot, fall back a little, wait (seeded per ant and pulse), again. */
function pulse(w: World, a: Ant, L: number, dt: number): void {
  const P = ECITON.raid;
  if (a.state !== AS.Raid) {
    enterState(a, AS.Raid);
    a.ecPh = 0;
    a.ecT = 0;
    a.ecN = a.ecN ?? 0;
  }
  a.ecT = (a.ecT ?? 0) + dt;
  const ph = a.ecPh ?? 0;
  if (ph === 0) {
    // surge forward
    const tx = slot.x + slot.ux * P.pulseAdvance * L;
    const ty = slot.y + slot.uy * P.pulseAdvance * L;
    const d = dhypot(tx - a.x, ty - a.y);
    steerTo(w, a, tx, ty, dt, 1.05, 10);
    if (d < L * 0.5 || a.ecT > 4) {
      a.ecPh = 1;
      a.ecT = 0;
    }
  } else if (ph === 1) {
    // fall back a little without turning round
    const tx = slot.x + slot.ux * (P.pulseAdvance - P.pulseRetreat) * L;
    const ty = slot.y + slot.uy * (P.pulseAdvance - P.pulseRetreat) * L;
    const d = dhypot(tx - a.x, ty - a.y);
    const h = a.h;
    a.h = datan2(ty - a.y, tx - a.x);
    moveForward(w, a, Math.min(antSpeed(w, a) * 0.55, d / Math.max(dt, 1e-3)), dt);
    a.h = h;
    turnToward(a, datan2(slot.uy, slot.ux), dt, 4);
    if (d < L * 0.3 || a.ecT > 1.5) {
      a.ecPh = 2;
      a.ecT = 0;
    }
  } else {
    // wait, antennae sweeping, facing the advance
    a.v = 0;
    turnToward(a, datan2(slot.uy, slot.ux), dt, 4);
    const wait = P.pulseEvery[0] + (P.pulseEvery[1] - P.pulseEvery[0]) * hash01(a.id, a.ecN ?? 0);
    if (a.ecT > wait) {
      a.ecPh = 0;
      a.ecT = 0;
      a.ecN = ((a.ecN ?? 0) + 1) % 1000000;
    }
  }
}

/**
 * A Soldier at a surface raid marker: its guard post along the trail, or (in the reserve, or when the colony has
 * too few Soldiers for posts) a place with the raiders. Returns true when handled.
 */
export function soldier(w: World, a: Ant, c: Colony, mi: number, dt: number): boolean {
  const R = c.ecRaid?.[mi];
  if (!R || !R.on) return false;
  const roll = rollOf(w, c, mi);
  const k = roll.majors.indexOf(a.id) - ECITON.guard.reserve;
  if (k < 0 || k * 3 >= R.posts.length) return raider(w, a, c, mi, dt);
  const px = R.posts[k * 3];
  const py = R.posts[k * 3 + 1];
  const ph = R.posts[k * 3 + 2];
  const L = casteOf(a.caste).length;
  const d = dhypot(px - a.x, py - a.y);
  if (d > L * (a.state === AS.Guard ? 0.9 : 0.35)) {
    if (a.state === AS.Guard) enterState(a, AS.FollowTrail);
    if (d <= 30) steerTo(w, a, px, py, dt, 0.9);
    else {
      // along the trail toward the post: homeward when the post is nearer the nest than we are, else outward
      const m = c.markers[mi];
      if (dhypot(px - m.x, py - m.y) > dhypot(a.x - m.x, a.y - m.y)) {
        const f = homeField(w, c);
        if (w.surfFlow.dir(f, a.x, a.y, pt)) {
          turnToward(a, datan2(pt.y, pt.x), dt, 6);
          moveForward(w, a, antSpeed(w, a) * 0.9, dt);
        } else steerTo(w, a, px, py, dt, 0.9);
      } else walkOut(w, a, c, mi, dt, 0.9);
    }
    return true;
  }
  a.v = 0;
  turnToward(a, ph, dt, 5);
  if (a.state !== AS.Guard) enterState(a, AS.Guard);
  a.pose = POSE.GUARD;
  return true;
}

/** A Soldier at its post engages enemies within `guard.rushRadius` of itself (combat.aggroRadius). */
export function guardRush(a: Ant): number {
  return ECITON.guard.rushRadius * casteOf(a.caste).length;
}

/**
 * Media escort: an unladen media on the surface walks beside a laden Porter heading home (at most two per porter,
 * claimed in id order each tick). Returns true while escorting.
 */
const escortClaims = new Map<number, number>(); // det-ok: per-tick cache, rebuilt from SimState
let escortTick = -1; // det-ok: per-tick cache
let escortState: unknown = null; // det-ok: per-tick cache
export function escortPorter(w: World, a: Ant, c: Colony, dt: number): boolean {
  if (escortTick !== w.s.tick || escortState !== w.s) {
    escortTick = w.s.tick;
    escortState = w.s;
    escortClaims.clear();
  }
  const L = casteOf(a.caste).length;
  const reach = ECITON.escortBodyLengths * L;
  const ok = (o: Ant | undefined): o is Ant => !!o && o.colony === c.id && o.state !== AS.Dead && o.space === SURFACE && o.carry === Carry.Food && !!casteOf(o.caste).porter && (escortClaims.get(o.id) ?? 0) < 2;
  // keep walking with the porter we escort; look for one only now and then (a search round a swarm is not cheap)
  let p = (a.ecE ?? 0) !== 0 ? w.antById.get(a.ecE ?? 0) : undefined;
  if (!ok(p) || sq(p.x - a.x) + sq(p.y - a.y) > reach * reach * 2.25) {
    p = undefined;
    a.ecE = 0;
    if ((w.s.tick + a.id) % 5 !== 0) return false;
    let bd = Infinity;
    w.antsNear(SURFACE, a.x, a.y, reach, (o, d2) => {
      if (!ok(o)) return false;
      if (d2 < bd || (d2 === bd && p && o.id < p.id)) {
        bd = d2;
        p = o;
      }
    });
    if (!p) return false;
  }
  const P = p as Ant;
  // no escort for the last stretch: the porter is about to go down
  const e = c.entrances[nearestEntrance(c, P.x, P.y)];
  if (e && dhypot(e.sx - P.x, e.sy - P.y) < 30) {
    a.ecE = 0;
    return false;
  }
  a.ecE = P.id;
  const n = escortClaims.get(P.id) ?? 0;
  escortClaims.set(P.id, n + 1);
  const PL = casteOf(P.caste).length;
  const side = n === 0 ? 1 : -1;
  const tx = P.x + dcos(P.h) * PL * 0.3 - dsin(P.h) * side * (PL + L) * 0.6;
  const ty = P.y + dsin(P.h) * PL * 0.3 + dcos(P.h) * side * (PL + L) * 0.6;
  if (a.state !== AS.Return) enterState(a, AS.Return);
  const d = steerTo(w, a, tx, ty, dt, 1.1);
  if (d < L * 0.5) turnToward(a, P.h, dt, 6);
  return true;
}

/** Where a porter's load hangs: under its body (antAI.finish). */
export function underBody(a: Ant, out: { x: number; y: number }): void {
  const L = casteOf(a.caste).length;
  out.x = a.x + dcos(a.h) * L * ECITON.porter.underFwd;
  out.y = a.y + dsin(a.h) * L * ECITON.porter.underFwd;
}

// ---------------------------------------------------------------------------------------------------------------
// Combat: the Soldier's hook, group pinning
// ---------------------------------------------------------------------------------------------------------------

/** Damage multiplier of a Soldier's hooked bite: ×softBonus on unarmoured targets. */
export function hookMul(a: Ant, targetArmor: number): number {
  const h = casteOf(a.caste).hook;
  return h && targetArmor <= 0 ? h.softBonus : 1;
}

/**
 * After an army ant's bite on an ant: the Soldier's hook holds the victim (`hook.hold` s pinned), and a victim
 * held by `pin.minAttackers` army ants is spread-eagled (pinned) while they hold on.
 */
export function afterBite(w: World, a: Ant, o: Ant): void {
  const h = casteOf(a.caste).hook;
  if (h) {
    if (o.pinned <= 0.05) w.events.emit({ t: 'hook', x: o.x, y: o.y, space: o.space });
    o.pinned = Math.max(o.pinned, h.hold);
  }
  let n = 0;
  w.antsNear(o.space, o.x, o.y, casteOf(o.caste).length * 1.5 + 4, (g) => {
    if (g.state === AS.Grapple && g.gId === o.id && g.gKind === 3 && g.colony === a.colony) n++;
    return false;
  });
  if (n >= ECITON.pin.minAttackers) {
    if (o.pinned <= 0.05) w.events.emit({ t: 'pin', x: o.x, y: o.y, space: o.space });
    o.pinned = Math.max(o.pinned, 0.5);
  }
}


// ---------------------------------------------------------------------------------------------------------------
// Team carries (Powell & Franks 2005: teams usually led by porters)
// ---------------------------------------------------------------------------------------------------------------

const helpers: Ant[] = []; // det-ok: scratch

/**
 * A porter at an item too big for its own load: with `porter.teamHelpers` unladen raiders close by, the team takes
 * the whole item (up to `teamMax` × the porter's load). The helpers walk beside it (teamHelp). Returns true when the
 * team formed.
 */
export function teamCarry(w: World, a: Ant, c: Colony, f: { id: number; amount: number; mass: number; x: number; y: number }, cap: number): boolean {
  const P = ECITON.porter;
  const cd = casteOf(a.caste);
  if (!isArmyAnt(c) || a.space !== SURFACE || f.amount > cap * P.teamMax || f.mass > cd.grip * 1.6 * P.teamMax) return false;
  helpers.length = 0;
  const r = P.teamReachBodyLengths * cd.length;
  w.antsNear(SURFACE, f.x, f.y, r, (o) => {
    if (o === a || o.colony !== a.colony || o.state === AS.Dead || o.carry !== Carry.None || (o.helpOf ?? 0) !== 0 || o.task !== 'marker') return false;
    const oc = casteOf(o.caste);
    if (oc.porter || oc.hook || !oc.forage || oc.species !== 'eciton') return false;
    if (o.state !== AS.Raid && o.state !== AS.FollowTrail && o.state !== AS.ToFood && o.state !== AS.Collect) return false;
    helpers.push(o);
    return false;
  });
  if (helpers.length < P.teamHelpers) return false;
  helpers.sort((p, q) => sq(p.x - f.x) + sq(p.y - f.y) - (sq(q.x - f.x) + sq(q.y - f.y)) || p.id - q.id);
  for (let i = 0; i < P.teamHelpers; i++) {
    const o = helpers[i];
    o.helpOf = a.id;
    o.tgt = 0;
    o.tk = 0;
    enterState(o, AS.Return);
  }
  return true;
}

/** Is this porter carrying a team load (more than one ant could lift)? */
export function teamLoad(a: Ant): boolean {
  const cd = casteOf(a.caste);
  return !!cd.porter && a.carry === Carry.Food && a.carryAmt > cd.carry * 1.8;
}

/** A helper walks beside its porter's load, one on each side, until the porter goes down into the nest. */
export function teamHelp(w: World, a: Ant, c: Colony, dt: number): boolean {
  const p = w.antById.get(a.helpOf ?? 0);
  if (!p || p.state === AS.Dead || p.space !== a.space || p.carry !== Carry.Food || a.carry !== Carry.None) {
    a.helpOf = 0;
    return false;
  }
  const f = w.foodById.get(p.carryId);
  const L = casteOf(a.caste).length;
  const PL = casteOf(p.caste).length;
  // which side: the order among this porter's helpers (by id)
  let k = 0;
  w.antsNear(SURFACE, p.x, p.y, PL * 3 + 10, (o) => {
    if (o !== a && o.helpOf === p.id && o.id < a.id) k++;
    return false;
  });
  const side = k % 2 === 0 ? 1 : -1;
  const along = (f ? f.size * 0.25 : PL * 0.2) * (k < 2 ? 0 : -1);
  const fx = f ? f.x : p.x;
  const fy = f ? f.y : p.y;
  const lat = (f ? f.size * 0.5 : PL * 0.3) + L * 0.45;
  const tx = fx + dcos(p.h) * along - dsin(p.h) * side * lat;
  const ty = fy + dsin(p.h) * along + dcos(p.h) * side * lat;
  if (a.state !== AS.Return) enterState(a, AS.Return);
  const d = steerTo(w, a, tx, ty, dt, 1.25);
  if (d < L * 0.4) turnToward(a, p.h, dt, 8);
  a.pose = POSE.DIG; // jaws on the load
  void c;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Living bridges and pothole plugs (Reid et al. 2015; Powell & Franks 2007)
// ---------------------------------------------------------------------------------------------------------------

const RETIRED = -1;

/** The ants of a link in slot order (0 = empty) and its slot positions: slot k of n, from end B (nest side) to A. */
function linkSlot(L: EcLink, k: number, out: { x: number; y: number }): void {
  if (L.kind === 2) {
    out.x = L.ax;
    out.y = L.ay;
    return;
  }
  const t = (k + 0.5) / L.n;
  out.x = L.bx + (L.ax - L.bx) * t;
  out.y = L.by + (L.ay - L.by) * t;
}

/** A free record (a retired one is reused, so the ants' link indices stay valid). */
function newLink(c: Colony): number {
  const ls = (c.ecLinks ??= []);
  for (let i = 0; i < ls.length; i++) if (ls[i].done === RETIRED && ls[i].ants.every((id) => id === 0)) return i;
  ls.push({ kind: 0, mi: 0, ax: 0, ay: 0, bx: 0, by: 0, n: 0, ants: [], cross: 0, last: 0, winT: 0, lowT: 0, done: RETIRED, dissolve: 0 });
  return ls.length - 1;
}

/**
 * The place on a raid trail for a bridge (end A on the marker side, B on the nest side):
 *  - where the trail itself runs through water (the flow field's 8 mm cells cut the corner of a puddle): the wet
 *    stretch, from the last dry ground before it to the first after, if at most `maxAnts` links long;
 *  - else two points of the route whose straight span (over water only, no rock) is at most `maxAnts` links long
 *    and saves at least `minSaveMm` of a detour `detourRatio` × the span.
 */
function bridgeSpot(w: World, rt: Route): { ax: number; ay: number; bx: number; by: number } | null {
  const B = ECITON.bridge;
  const maxSpan = B.maxAnts * B.spacing * LM();
  const n = rt.cum.length;
  // 1. the trail crossing water
  const total = routeLength(rt);
  let dryS = -1;
  let wetRun = false;
  for (let s = 0; s <= total; s += 1) {
    routeAt(rt, s, pt);
    const wet = w.terrain.isWater(pt.x, pt.y);
    if (!wet) {
      if (wetRun && dryS >= 0) {
        const ax = pt.x;
        const ay = pt.y;
        routeAt(rt, dryS, pt);
        const span = dhypot(ax - pt.x, ay - pt.y);
        // (s runs from the marker: the dry point before the water is the marker-side end A)
        if (span <= maxSpan && span >= 2) return { ax: pt.x, ay: pt.y, bx: ax, by: ay };
      }
      wetRun = false;
      dryS = s;
    } else wetRun = true;
  }
  // 2. a shortcut over water
  let best: { ax: number; ay: number; bx: number; by: number } | null = null;
  let bestSave = B.minSaveMm;
  for (let i = 0; i < n; i++) {
    const ax = rt.pts[i * 2];
    const ay = rt.pts[i * 2 + 1];
    for (let j = i + 2; j < n; j++) {
      const arc = rt.cum[j] - rt.cum[i];
      const bx = rt.pts[j * 2];
      const by = rt.pts[j * 2 + 1];
      const span = dhypot(bx - ax, by - ay);
      if (span > maxSpan || span < LM() * 2 || arc < span * B.detourRatio || arc - span <= bestSave) continue;
      // the span must cross water, and nothing but water
      let wet = false;
      let ok = true;
      const steps = Math.ceil(span / 2);
      for (let k = 1; k < steps && ok; k++) {
        const x = ax + ((bx - ax) * k) / steps;
        const y = ay + ((by - ay) * k) / steps;
        if (w.terrain.isBlocked(x, y)) ok = false;
        else if (w.terrain.isWater(x, y)) wet = true;
      }
      if (!ok || !wet) continue;
      bestSave = arc - span;
      best = { ax, ay, bx, by };
    }
  }
  return best;
}

/** Potholes along a raid trail: dips of at least `plug.minDipMm`, deepest first, 10 mm apart, at most `maxPlugs`. */
function potholes(w: World, rt: Route): number[] {
  const P = ECITON.plug;
  const out: Array<{ i: number; d: number }> = [];
  const n = rt.cum.length;
  const total = routeLength(rt);
  for (let i = 1; i < n - 1; i++) {
    // not at the very ends (the marker area and the entrance)
    if (rt.cum[i] < 20 || rt.cum[i] > total - 20) continue;
    const x = rt.pts[i * 2];
    const y = rt.pts[i * 2 + 1];
    routeAt(rt, Math.max(0, rt.cum[i] - 6), pt);
    const ha = w.terrain.walkHeight(pt.x, pt.y);
    routeAt(rt, Math.min(total, rt.cum[i] + 6), pt);
    const hb = w.terrain.walkHeight(pt.x, pt.y);
    const dip = Math.min(ha, hb) - w.terrain.walkHeight(x, y);
    if (dip >= P.minDipMm && w.walkable(SURFACE, x, y)) out.push({ i, d: dip });
  }
  out.sort((p, q) => q.d - p.d || p.i - q.i);
  const keep: number[] = [];
  for (const o of out) {
    if (keep.length >= P.maxPlugs) break;
    if (keep.every((k) => Math.abs(rt.cum[k] - rt.cum[o.i]) >= 10)) keep.push(o.i);
  }
  return keep;
}

/** Set up and run the bridges and plugs of one raid marker (ecitonSystem, every 10 ticks). */
export function linksSystem(w: World, c: Colony, mi: number, active: boolean, dt: number): void {
  const B = ECITON.bridge;
  const ls = c.ecLinks ?? [];
  const m = c.markers[mi];
  const rt = raidRoute(w, c, mi);
  // retire the links of a marker that moved (their ends are off the trail now) or a raid that ended long ago
  for (const L of ls) {
    if (L.mi !== mi || L.done === RETIRED) continue;
    const endsOn = (x: number, y: number) => {
      routeNearest(rt, x, y, near);
      return near.d < 3;
    };
    if (!m.placed || m.space !== SURFACE || !endsOn(L.ax, L.ay) || !endsOn(L.bx, L.by)) retire(L);
  }
  if (!m.placed || m.space !== SURFACE) return;
  // new links on an active raid trail
  if (active && (w.s.tick + c.id * 7) % 40 === 0) {
    if (!ls.some((L) => L.mi === mi && L.kind === 1 && L.done !== RETIRED)) {
      const spot = bridgeSpot(w, rt);
      if (spot) {
        const k = newLink(c);
        const L = c.ecLinks![k];
        const span = dhypot(spot.bx - spot.ax, spot.by - spot.ay);
        Object.assign(L, { kind: 1, mi, ax: spot.ax, ay: spot.ay, bx: spot.bx, by: spot.by, n: Math.max(2, Math.ceil(span / (B.spacing * LM()))), cross: 0, last: 0, winT: 0, lowT: 0, done: 0, dissolve: 0 });
        L.ants.length = 0;
        for (let q = 0; q < L.n; q++) L.ants.push(0);
      }
    }
    if (!ls.some((L) => L.mi === mi && L.kind === 2 && L.done !== RETIRED)) {
      for (const i of potholes(w, rt)) {
        const k = newLink(c);
        const L = c.ecLinks![k];
        Object.assign(L, { kind: 2, mi, ax: rt.pts[i * 2], ay: rt.pts[i * 2 + 1], bx: rt.pts[i * 2], by: rt.pts[i * 2 + 1], n: 1, cross: 0, last: 0, winT: 0, lowT: 0, done: 0, dissolve: 0 });
        L.ants.length = 0;
        L.ants.push(0);
      }
    }
  }
  for (let li = 0; li < ls.length; li++) {
    const L = ls[li];
    if (L.mi !== mi || L.done === RETIRED) continue;
    // traffic: nestmates on the trail at either end, sampled every 10 ticks (≈ one sample per ant passing)
    let here = 0;
    for (const [x, y] of [[L.ax, L.ay], [L.bx, L.by]] as Array<[number, number]>) {
      w.antsNear(SURFACE, x, y, 6, (o) => {
        if (o.colony === c.id && o.state !== AS.Bridge && o.state !== AS.Plug && o.task === 'marker' && o.marker === mi) here++;
        return false;
      });
      if (L.kind === 2) break;
    }
    L.cross += here;
    L.winT += dt;
    if (L.winT >= 10) {
      L.last = L.cross;
      L.cross = 0;
      L.winT = 0;
    }
    const busy = active && L.last >= B.formTraffic;
    L.lowT = busy ? 0 : L.lowT + dt;
    // dissolve after a quiet spell: the links let go in reverse order (one every half second)
    if (L.lowT > B.dissolveAfter) L.dissolve = 1;
    if (L.dissolve) {
      if (busy) L.dissolve = 0;
      else {
        for (let k = L.n - 1; k >= 0; k--)
          if (L.ants[k]) {
            if ((w.s.tick % 10) === 0) L.ants[k] = 0;
            break;
          }
        L.done = 0;
        if (L.ants.every((id) => id === 0)) {
          if (!active) retire(L);
          L.dissolve = 0;
          L.lowT = 0;
        }
        continue;
      }
    }
    // members gone (killed, knocked off): their slots are empty again
    for (let k = 0; k < L.n; k++) {
      const a = L.ants[k] ? w.antById.get(L.ants[k]) : undefined;
      if (L.ants[k] && (!a || a.state === AS.Dead || a.link !== li)) L.ants[k] = 0;
    }
    if (busy || L.kind === 2 ? active : false) recruit(w, c, L, li);
    L.done = L.ants.every((id) => id !== 0) && L.ants.every((id) => atSlot(w, L, id)) ? 1 : 0;
  }
}

function retire(L: EcLink): void {
  L.done = RETIRED;
  for (let k = 0; k < L.ants.length; k++) L.ants[k] = 0;
}

const sp2 = { x: 0, y: 0 }; // det-ok: scratch
function atSlot(w: World, L: EcLink, id: number): boolean {
  const a = w.antById.get(id);
  if (!a) return false;
  linkSlot(L, L.ants.indexOf(id), sp2);
  return dhypot(a.x - sp2.x, a.y - sp2.y) < 0.6;
}

/** The next empty slot (from the nest end for a bridge) takes the nearest Worker walking the trail there (ties: lowest id). */
function recruit(w: World, c: Colony, L: EcLink, li: number): void {
  const k = L.ants.indexOf(0);
  if (k < 0) return;
  const ex = L.kind === 1 ? L.bx : L.ax;
  const ey = L.kind === 1 ? L.by : L.ay;
  let best: Ant | null = null;
  let bd = Infinity;
  w.antsNear(SURFACE, ex, ey, 10, (o, d2) => {
    if (o.colony !== c.id || o.caste !== 'eciton_minor' || o.task !== 'marker' || o.marker !== L.mi || o.carry !== Carry.None) return false;
    if ((o.helpOf ?? 0) !== 0 || (o.xing ?? 0) !== 0 || (o.state !== AS.FollowTrail && o.state !== AS.Raid)) return false;
    if (d2 < bd || (d2 === bd && best && o.id < best.id)) {
      bd = d2;
      best = o;
    }
  });
  if (!best) return;
  const a = best as Ant;
  L.ants[k] = a.id;
  a.link = li;
  enterState(a, L.kind === 1 ? AS.Bridge : AS.Plug);
  w.events.emit({ t: 'link', x: a.x, y: a.y, space: a.space });
}

/**
 * A link holds its place (moving into it first, over the water if need be), facing along the span (a plug: lying in
 * the hole). Let go (its slot emptied): it walks off to the nearer end and back to the raid. Returns true when handled.
 */
export function holdLink(w: World, a: Ant, c: Colony, dt: number): boolean {
  const li = a.link ?? -1;
  const L = li >= 0 ? c.ecLinks?.[li] : undefined;
  const k = L ? L.ants.indexOf(a.id) : -1;
  if (!L || k < 0) {
    // released: off the span to dry ground, then back to work
    if (w.walkable(a.space, a.x, a.y) || !L) {
      a.link = -1;
      enterState(a, AS.Idle);
      return false;
    }
    const toA = dhypot(L.ax - a.x, L.ay - a.y) < dhypot(L.bx - a.x, L.by - a.y);
    walkOver(a, toA ? L.ax : L.bx, toA ? L.ay : L.by, antSpeed(w, a) * 0.6, dt);
    a.pose = POSE.NONE;
    return true;
  }
  linkSlot(L, k, sp2);
  const d = dhypot(sp2.x - a.x, sp2.y - a.y);
  if (d > 0.3) {
    walkOver(a, sp2.x, sp2.y, antSpeed(w, a) * 0.7, dt);
    return true;
  }
  a.x = sp2.x;
  a.y = sp2.y;
  a.v = 0;
  // bridge links face along the span, alternately; a plug faces along the trail
  turnToward(a, datan2(L.ay - L.by, L.ax - L.bx) + (L.kind === 1 && k % 2 ? Math.PI : 0), dt, 6);
  a.pose = L.kind === 1 ? POSE.BRIDGE : POSE.PLUG;
  return true;
}

/** Step straight toward a point, whatever is underfoot (on a bridge, or becoming one). */
function walkOver(a: Ant, tx: number, ty: number, speed: number, dt: number): void {
  const d = dhypot(tx - a.x, ty - a.y);
  if (d < 1e-6) return;
  const step = Math.min(d, speed * dt);
  a.h = datan2(ty - a.y, tx - a.x);
  a.x += ((tx - a.x) / d) * step;
  a.y += ((ty - a.y) / d) * step;
  a.v = step / Math.max(dt, 1e-3);
}

/**
 * Over a finished bridge: a laden ant at its marker end crosses toward the nest; an outbound ant at its nest end
 * crosses toward the raid. Continues a crossing in progress. Returns true while on the bridge.
 */
export function crossBridge(w: World, a: Ant, c: Colony, dt: number): boolean {
  const ls = c.ecLinks;
  if (!ls || a.space !== SURFACE) {
    a.xing = 0;
    return false;
  }
  const x = a.xing ?? 0;
  if (x !== 0) {
    const L = ls[Math.abs(x) - 1];
    const toA = x > 0;
    const tx = toA ? L.ax : L.bx;
    const ty = toA ? L.ay : L.by;
    walkOver(a, tx, ty, antSpeed(w, a) * ECITON.bridge.speed, dt);
    if (dhypot(tx - a.x, ty - a.y) < 0.2) {
      a.xing = 0;
      a.xt = 0;
    } else a.xt = 1 - dhypot(tx - a.x, ty - a.y) / Math.max(1e-3, dhypot(L.ax - L.bx, L.ay - L.by));
    return true;
  }
  if (a.task !== 'marker' || (w.s.tick + a.id) % 2) return false;
  for (let li = 0; li < ls.length; li++) {
    const L = ls[li];
    if (L.kind !== 1 || L.done !== 1 || L.mi !== a.marker) continue;
    const laden = a.carry === Carry.Food;
    const outbound = a.carry === Carry.None && a.state === AS.FollowTrail;
    if (laden && dhypot(L.ax - a.x, L.ay - a.y) < 6) a.xing = -(li + 1);
    else if (outbound && dhypot(L.bx - a.x, L.by - a.y) < 6) a.xing = li + 1;
    else continue;
    a.xt = 0;
    return crossBridge(w, a, c, dt);
  }
  return false;
}

/** Unplugged potholes on the colony's raid trails slow army ants crossing them (movement.antSpeed). */
export function potholeMul(c: Colony, a: Ant): number {
  const ls = c.ecLinks;
  if (!ls || a.space !== SURFACE) return 1;
  const P = ECITON.plug;
  for (const L of ls) {
    if (L.kind !== 2 || L.done === RETIRED) continue;
    if (sq(L.ax - a.x) + sq(L.ay - a.y) < P.reachMm * P.reachMm) return L.done === 1 ? P.speed : P.unpluggedSpeed;
  }
  return 1;
}
