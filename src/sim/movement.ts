import { World } from './world';
import { Ant, AS, Carry, Colony, Entrance, SURFACE, nestSpace, colonyOfSpace } from './types';
import { canEnter, canLeave, passEntrance, usableMask } from './entrances';
import { casteOf } from './species';
import { hexCoreCells } from './colony';
import { hexSpeedOf } from './tiles';
import { BALANCE, ECITON, NASUTE, TERMANT } from './balance';
import { cartonBlocks, termantSpeedMul } from './termants';
import { potholeMul, teamLoad } from './eciton';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';

const TAU = Math.PI * 2;
const tmp = { x: 0, y: 0 };

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function antSpeed(w: World, a: Ant): number {
  const c = casteOf(a.caste);
  let v = c.speed;
  const col = w.colony(a.colony);
  if (col && col.abilityT > 0 && col.species === 'eciton') v *= 1.2;
  // army ants: a team load slows the porter's team; unplugged potholes on their trails slow them (eciton.ts)
  if (col && col.species === 'eciton' && a.space === SURFACE) {
    if (teamLoad(a)) v *= ECITON.porter.teamSpeedMul;
    if (col.ecLinks) v *= potholeMul(col, a);
  }
  // termite major charging; Saiy-Ant gold surge
  if ((a.chT ?? 0) > 0) v *= NASUTE.majorCharge.speedMul;
  if ((a.surgeT ?? 0) > 0) v *= BALANCE.surge.speedMul;
  if (a.carry !== Carry.None) v *= a.carry === Carry.Leaf ? 0.75 : 0.85;
  if (a.slowT > 0) v *= 0.5;
  // glued by a Termant soldier; Termants' spider genes (termants.ts)
  if ((a.glueT ?? 0) > w.s.tick) v *= TERMANT.glue.slowMul;
  if (col && col.genome) v *= termantSpeedMul(col);
  v *= BALANCE.levelSpeed[Math.max(0, Math.min(2, (a.level || 1) - 1))];
  if (a.space !== SURFACE) {
    v *= 0.9;
    // Built tiles slow ants (35 %); highways speed them up (Revision 2).
    const owner = w.colony(colonyOfSpace(a.space));
    const g = w.nestOf(a.space);
    if (owner && g) {
      const q = g.hexAt(a.x, a.y);
      if (q >= 0) v *= hexSpeedOf(w, owner)[q];
    }
  }
  // Carabid-style night bonus not for ants; ants slow slightly at night.
  v *= 1 - w.s.night * 0.15;
  return v;
}

/** Rotate heading toward a desired angle with a max turn rate (rad/s). */
export function turnToward(a: Ant, desired: number, dt: number, rate = 7): void {
  const d = angleDiff(a.h, desired);
  const m = rate * dt;
  a.h += Math.max(-m, Math.min(m, d));
  if (a.h > Math.PI) a.h -= TAU;
  if (a.h < -Math.PI) a.h += TAU;
}

/**
 * Face a point while fighting: the turn is capped (BALANCE.combat.turnRate),
 * tiny corrections are ignored (deadZone) and a point almost on top of the ant
 * leaves the heading as it is, so headings never flip or spin.
 */
export function faceToward(a: Ant, tx: number, ty: number, dt: number): void {
  const C = BALANCE.combat;
  const dx = tx - a.x;
  const dy = ty - a.y;
  if (dx * dx + dy * dy < C.nearZero * C.nearZero) return;
  const want = datan2(dy, dx);
  if (Math.abs(angleDiff(a.h, want)) < C.deadZone) return;
  turnToward(a, want, dt, C.turnRate);
}

/** Advance along the heading, resolving collisions with obstacles/soil. */
export function moveForward(w: World, a: Ant, speed: number, dt: number): boolean {
  // rooted by a termite major's glue, or pinned in a hell ant's jaws: can't move (can still bite)
  if (speed <= 0 || a.pinned > 0 || a.stun > 0 || (a.root ?? 0) > w.s.tick) {
    a.v = 0;
    return false;
  }
  const step = speed * dt;
  const nx = a.x + dcos(a.h) * step;
  const ny = a.y + dsin(a.h) * step;
  // Termant carton walls: an enemy cannot walk into one; it chews it instead (termants.ts)
  if (a.space !== SURFACE && cartonBlocks(w, a, nx, ny)) {
    a.v = 0;
    return false;
  }
  if (w.walkable(a.space, nx, ny)) {
    a.x = nx;
    a.y = ny;
    a.v = speed;
    return true;
  }
  // slide along an axis
  if (w.walkable(a.space, nx, a.y)) {
    a.x = nx;
    a.v = speed * 0.7;
    return true;
  }
  if (w.walkable(a.space, a.x, ny)) {
    a.y = ny;
    a.v = speed * 0.7;
    return true;
  }
  // turn away: sample alternatives
  const s = w.rng.sign();
  for (const off of [0.6, 1.2, 1.9, 2.6]) {
    const h = a.h + off * s;
    if (w.walkable(a.space, a.x + dcos(h) * step * 2, a.y + dsin(h) * step * 2)) {
      a.h = h;
      break;
    }
  }
  a.v = 0;
  return false;
}

/** Steer to a point; returns distance remaining. */
export function steerTo(w: World, a: Ant, tx: number, ty: number, dt: number, speedMul = 1, rate = 8): number {
  const dx = tx - a.x;
  const dy = ty - a.y;
  const d = dhypot(dx, dy);
  if (d < 0.05) {
    a.v = 0;
    return 0;
  }
  const want = datan2(dy, dx);
  turnToward(a, want, dt, rate);
  const facing = dcos(angleDiff(a.h, want));
  const sp = antSpeed(w, a) * speedMul * Math.max(0.15, facing);
  moveForward(w, a, Math.min(sp, d / Math.max(dt, 1e-3)), dt);
  return d;
}

/**
 * Combat v2.1 (CHANGE_PLAN §17: avoidance, not pushing): heading `want` (rad) turned aside round the nearest teammate in
 * the way (`fightersOnly`: only teammates in a fight) — within `look` mm ahead, inside the cone `combat21.avoidCone`, and close enough to the line to touch — away
 * from the side it is on (dead ahead: by the ant's id), by up to `combat21.avoidTurn`, more the nearer it is.
 */
export function avoidHeading(w: World, a: Ant, want: number, look: number, fightersOnly = false): number {
  const C21 = BALANCE.combat21;
  const cw = dcos(want);
  const sw = dsin(want);
  const team = a.team ?? a.colony;
  const S = BALANCE.separation;
  const ra = casteOf(a.caste).length * S.widthOfLength * S.radiusOfWidth;
  AV.best = Infinity;
  AV.side = 0;
  w.antsNear(a.space, a.x, a.y, look, (g, d2) => {
    if (g === a || (g.team ?? g.colony) !== team || g.state === AS.Dead || g.state === AS.Flung || (g.ridePh ?? 0) >= 1 || d2 >= AV.best) return false;
    if (fightersOnly && g.state !== AS.Attack && g.state !== AS.Grapple && g.state !== AS.Spray) return false;
    const gx = g.x - a.x;
    const gy = g.y - a.y;
    const fwd = gx * cw + gy * sw;
    if (fwd <= 0) return false;
    const lat = -gx * sw + gy * cw;
    if (Math.abs(datan2(lat, fwd)) > C21.avoidCone) return false;
    const rg = casteOf(g.caste).length * S.widthOfLength * S.radiusOfWidth;
    if (Math.abs(lat) > (ra + rg) * 1.4) return false;
    AV.best = d2;
    AV.side = lat > 1e-6 ? -1 : lat < -1e-6 ? 1 : a.id & 1 ? 1 : -1;
    return false;
  });
  return AV.side === 0 ? want : want + AV.side * C21.avoidTurn * (1 - Math.sqrt(AV.best) / look);
}
const AV = { best: 0, side: 0 }; // det-ok: scratch for avoidHeading's callback

/**
 * Steer to a point like steerTo, but round teammates in the way instead of into them (avoidHeading, looking
 * `combat21.avoidLook` × its length ahead); within 0.8 of its length of the point it goes straight. Returns the distance
 * left.
 */
export function steerAvoid(w: World, a: Ant, tx: number, ty: number, dt: number, speedMul = 1, rate = 8): number {
  const dx = tx - a.x;
  const dy = ty - a.y;
  const d = dhypot(dx, dy);
  if (d < 0.05) {
    a.v = 0;
    return 0;
  }
  let want = datan2(dy, dx);
  const L = casteOf(a.caste).length;
  if (d > L * 0.8) want = avoidHeading(w, a, want, Math.min(d, BALANCE.combat21.avoidLook * L));
  // (a turn while walking, not a pivot: at least half speed, and no tighter than a body length's radius, until it is
  // close to the point)
  const v0 = antSpeed(w, a) * speedMul;
  const far = d > L * 1.5;
  turnToward(a, want, dt, far ? Math.min(rate, Math.max(1.5, v0 / L)) : rate);
  const facing = dcos(angleDiff(a.h, want));
  const sp = v0 * Math.max(far ? 0.5 : 0.15, facing);
  moveForward(w, a, Math.min(sp, d / Math.max(dt, 1e-3)), dt);
  return d;
}

/** Follow a nest flow field; returns 'arrived' at a target cell, 'moving' or 'stuck'. */
export function followNest(w: World, a: Ant, dist: Float32Array, dt: number, speedMul = 1): 'arrived' | 'moving' | 'stuck' {
  const flow = w.flowOf(a.space);
  if (!flow) return 'stuck';
  const d0 = flow.distAt(dist, a.x, a.y);
  if (d0 === 0) return 'arrived';
  if (!flow.next(dist, a.x, a.y, tmp)) return d0 === Infinity ? 'stuck' : 'arrived';
  steerTo(w, a, tmp.x, tmp.y, dt, speedMul);
  return 'moving';
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** Field toward the top of every entrance ramp of a colony's nest. */
export function exitField(w: World, c: Colony): Float32Array | null {
  return exitFieldIn(w, nestSpace(c.id));
}

/** Field toward the top of every entrance ramp of any underground area. */
export function exitFieldIn(w: World, space: number): Float32Array | null {
  const flow = w.flowOf(space);
  const g = w.nestOf(space);
  if (!flow || !g) return null;
  const ents = w.entrancesOf(space);
  // closed or fallen-in entrances lead nowhere
  return flow.field('exit', () => ents.flatMap((e) => (canLeave(e) ? hexCoreCells(g, e.q, 0.35) : [])), ents.length + 32 * usableMask(ents, true));
}

/** Surface field toward an underground area's entrances. */
export function areaField(w: World, space: number): Float32Array {
  const ents = w.entrancesOf(space);
  const stamp = ents.reduce((s, e) => s + e.sx * 7 + e.sy * 13, 0) + usableMask(ents, false) * 0.001;
  return w.surfFlow.field('area:' + space, stamp, ents.filter(canEnter).map((e) => ({ x: e.sx, y: e.sy })));
}

/** Nearest entrance (index) of a list to a surface point (−1 when empty). */
export function nearestOf(ents: Entrance[], x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  ents.forEach((e, i) => {
    if (!canEnter(e)) return;
    const d = sq(e.sx - x) + sq(e.sy - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export function chamberField(w: World, c: Colony, key: string, cells: () => number[], extra = 0): Float32Array | null {
  const flow = w.flow(c.id);
  if (!flow) return null;
  return flow.field(key, cells, extra);
}

export function homeField(w: World, c: Colony): Float32Array {
  const open = c.entrances.filter(canEnter);
  const targets = (open.length ? open : c.entrances.slice(0, 1)).map((e) => ({ x: e.sx, y: e.sy }));
  const stamp = c.entrances.reduce((s, e) => s + e.sx * 7 + e.sy * 13, 0) + usableMask(c.entrances, false) * 0.001;
  return w.surfFlow.field('home:' + c.id, stamp, targets);
}

/** Nearest entrance (index) on the surface to a point. */
export function nearestEntrance(c: Colony, x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  c.entrances.forEach((e, i) => {
    if (i > 0 && !canEnter(e)) return; // closed extra entrances (the main one never closes)
    const d = sq(e.sx - x) + sq(e.sy - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Walk home on the surface; enters the nest when reaching an entrance. Returns true once inside. */
export function goHome(w: World, a: Ant, dt: number, speedMul = 1): boolean {
  const c = w.colony(a.colony);
  if (!c) return false;
  const ei = nearestEntrance(c, a.x, a.y);
  const e = c.entrances[ei];
  if (!e) return false;
  const de = dhypot(e.sx - a.x, e.sy - a.y);
  if (de < 3) {
    if (!passEntrance(w, e, false)) return waitAtHole(w, a, e, dt);
    enterNest(w, a, ei);
    return true;
  }
  if (de < 30) {
    steerTo(w, a, e.sx, e.sy, dt, speedMul);
    return false;
  }
  const f = homeField(w, c);
  if (w.surfFlow.dir(f, a.x, a.y, tmp)) {
    // blend with slight wobble for natural paths
    const want = datan2(tmp.y, tmp.x) + dsin(w.time * 2 + a.id) * 0.15;
    turnToward(a, want, dt, 6);
    moveForward(w, a, antSpeed(w, a) * speedMul, dt);
  } else steerTo(w, a, e.sx, e.sy, dt, speedMul);
  return false;
}

/**
 * Walk to a surface point along a flow field (around puddles, rocks and
 * logs), steering straight in for the last few centimetres. `key` names the
 * cached field (one per marker); it is rebuilt when the point moves.
 * Returns the remaining distance.
 */
export function goToSurfacePoint(w: World, a: Ant, x: number, y: number, dt: number, key: string, speedMul = 1, avoid = false): number {
  const d = dhypot(x - a.x, y - a.y);
  if (d < 30) {
    steerTo(w, a, x, y, dt, speedMul);
    return d;
  }
  const cell = w.surfFlow.cell;
  const stamp = Math.round(x / cell) * 10007 + Math.round(y / cell);
  const f = w.surfFlow.field(key, stamp, [{ x, y }]);
  if (w.surfFlow.dir(f, a.x, a.y, tmp)) {
    let want = datan2(tmp.y, tmp.x) + dsin(w.time * 2 + a.id) * 0.12;
    // a squad on its way to a marker passes round fights instead of plowing through them (combat v2.1)
    if (avoid) want = avoidHeading(w, a, want, BALANCE.combat21.avoidLook * casteOf(a.caste).length, true);
    turnToward(a, want, dt, 6);
    moveForward(w, a, antSpeed(w, a) * speedMul, dt);
  } else steerTo(w, a, x, y, dt, speedMul);
  return d;
}

/** Queue at a busy hole (ENTRANCE.passPerS): stand facing it, edging in. Returns false (not inside yet). */
function waitAtHole(w: World, a: Ant, e: Entrance, dt: number): false {
  turnToward(a, datan2(e.sy - a.y, e.sx - a.x), dt, 6);
  a.v = 0;
  return false;
}

/** Walk down one of the colony's own entrances: appear at the top of its ramp in the nest. */
export function enterNest(w: World, a: Ant, ei: number): void {
  enterArea(w, a, nestSpace(a.colony), ei);
}

/** Walk down entrance `ei` of any underground area (own nest, rival nest, cave). */
export function enterArea(w: World, a: Ant, space: number, ei: number): void {
  const e = w.entrancesOf(space)[ei];
  const g = w.nestOf(space);
  if (!e || !g) return;
  const p = g.hexCenter(e.q);
  const ang = w.rng.range(0, Math.PI * 2);
  a.space = space;
  a.x = a.px = p.x + dcos(ang) * g.R * 0.15;
  a.y = a.py = p.y + dsin(ang) * g.R * 0.15;
  a.h = a.ph = ang;
  a.ent = ei;
  a.v = 0;
  a.entT = 0;
}

export function exitNest(w: World, a: Ant, ei: number): void {
  exitAreaTo(w, a, nestSpace(a.colony), ei);
}

const ctrTmp = { x: 0, y: 0 };
/** Climb out of an area through its entrance `ei` onto the surface beside the hole. */
function exitAreaTo(w: World, a: Ant, space: number, ei: number): void {
  const e = w.entrancesOf(space)[ei];
  if (!e) return;
  const ctr = w.areaCentre(space, ctrTmp);
  const ang = datan2(e.sy - ctr.y, e.sx - ctr.x) + w.rng.range(-0.8, 0.8);
  a.space = SURFACE;
  a.x = a.px = e.sx + dcos(ang) * 1.5;
  a.y = a.py = e.sy + dsin(ang) * 1.5;
  a.h = a.ph = ang;
  a.ent = ei;
  a.v = 0;
  a.entT = 0;
}

/** In an area, at the top of an entrance ramp → surface. Returns true if exited. */
export function tryExit(w: World, a: Ant): boolean {
  if (a.space === SURFACE) return true;
  const g = w.nestOf(a.space);
  if (!g) return false;
  const ents = w.entrancesOf(a.space);
  for (let i = 0; i < ents.length; i++) {
    if (!canLeave(ents[i])) continue;
    const p = g.hexCenter(ents[i].q);
    if (sq(p.x - a.x) + sq(p.y - a.y) < sq(g.R * 0.3)) {
      // queue in the tunnel while the hole is busy
      if (!passEntrance(w, ents[i], true)) {
        a.v = 0;
        return false;
      }
      // Raiders and visitors leave through the host's entrance onto the surface beside it.
      exitAreaTo(w, a, a.space, i);
      return true;
    }
  }
  return false;
}

/** Leave whichever area the ant is in via the nearest ramp. Returns true when on the surface. */
export function goOut(w: World, a: Ant, dt: number): boolean {
  if (a.space === SURFACE) return true;
  const g = w.nestOf(a.space);
  const ents = w.entrancesOf(a.space);
  if (!g || !ents.length) return false;
  if (tryExit(w, a)) return true;
  const f = exitFieldIn(w, a.space);
  if (!f) return false;
  const r = followNest(w, a, f, dt);
  if (r !== 'moving') {
    // climb the last bit of the ramp
    let best = ents[0];
    let bd = Infinity;
    for (const e of ents) {
      if (!canLeave(e)) continue;
      const p = g.hexCenter(e.q);
      const d = sq(p.x - a.x) + sq(p.y - a.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    const p = g.hexCenter(best.q);
    steerTo(w, a, p.x, p.y, dt);
    tryExit(w, a);
  }
  return a.space === SURFACE;
}

/**
 * Walk on the surface to an underground area's nearest entrance and go down
 * it (markers placed on entrances, raids, cave visits). Returns true once inside.
 */
export function goToArea(w: World, a: Ant, space: number, dt: number, speedMul = 1): boolean {
  if (a.space === space) return true;
  if (space === nestSpace(a.colony)) return goHome(w, a, dt, speedMul);
  if (a.space !== SURFACE) {
    goOut(w, a, dt);
    return false;
  }
  const ents = w.entrancesOf(space);
  const bi = nearestOf(ents, a.x, a.y);
  if (bi < 0) return false;
  const e = ents[bi];
  const de = dhypot(e.sx - a.x, e.sy - a.y);
  if (de < 3) {
    if (!passEntrance(w, e, false)) return waitAtHole(w, a, e, dt);
    enterArea(w, a, space, bi);
    return true;
  }
  if (de < 30) {
    steerTo(w, a, e.sx, e.sy, dt, speedMul);
    return false;
  }
  // Far away: follow the surface field to the area's entrances (paths round obstacles).
  const f = areaField(w, space);
  if (w.surfFlow.dir(f, a.x, a.y, tmp)) {
    turnToward(a, datan2(tmp.y, tmp.x) + dsin(w.time * 2 + a.id) * 0.12, dt, 6);
    moveForward(w, a, antSpeed(w, a) * speedMul, dt);
  } else steerTo(w, a, e.sx, e.sy, dt, speedMul);
  return false;
}

/**
 * Correlated random walk with bursts and pauses (searching ants zigzag).
 * `bias` is an optional preferred heading with weight.
 */
export function wander(w: World, a: Ant, dt: number, zig = 1, bias?: { h: number; k: number }, speedMul = 1): void {
  if (a.pause > 0) {
    a.pause -= dt;
    a.v = 0;
    return;
  }
  if (w.rng.chance(dt * 0.25)) {
    a.pause = w.rng.range(0.25, 1.4);
    return;
  }
  a.turn += (w.rng.next() - 0.5) * 6 * zig * dt - a.turn * dt * 1.5;
  a.turn = Math.max(-2.5, Math.min(2.5, a.turn));
  let want = a.h + a.turn * dt * 3;
  if (bias) want += angleDiff(want, bias.h) * Math.min(1, bias.k * dt);
  a.h = want;
  moveForward(w, a, antSpeed(w, a) * speedMul * (0.75 + 0.25 * dsin(w.time * 5 + a.id)), dt);
}

/** Keep surface ants inside the map. */
export function clampToMap(w: World, a: Ant): void {
  if (a.space !== SURFACE) return;
  const t = w.terrain;
  const m = 3;
  if (a.x < m || a.y < m || a.x > t.width - m || a.y > t.depth - m) {
    a.x = Math.min(t.width - m, Math.max(m, a.x));
    a.y = Math.min(t.depth - m, Math.max(m, a.y));
    a.h = datan2(t.depth / 2 - a.y, t.width / 2 - a.x) + w.rng.range(-0.6, 0.6);
  }
}

export { AS };
