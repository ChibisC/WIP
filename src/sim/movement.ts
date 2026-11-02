import { antClear, antMostClear, antNeed } from './underpass';
import { World } from './world';
import { Ant, AS, Carry, Colony, Entrance, SURFACE, nestSpace, colonyOfSpace } from './types';
import { arrivalHash, canEnter, canLeave, entranceTop, exitHole, holeIn, passEntrance, usableMask } from './entrances';
import { casteOf } from './species';
import { hexCoreCells } from './colony';
import { hexSpeedOf } from './tiles';
import { BALANCE, ECITON, LAYERS, NASUTE, TERMANT, TRAIL } from './balance';
import { cartonBlocks, termantSpeedMul } from './termants';
import { potholeMul, teamLoad } from './eciton';
import { datan2, dcos, dhypot, dsin, hash01, sq } from './dmath';

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
  // layered ground: a little slower walking up a ramp (LAYERS.upSpeed)
  if (a.space === SURFACE && w.terrain.layers) v *= w.terrain.slopeSpeed(a.x, a.y, dcos(a.h), dsin(a.h));
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
/**
 * Underground, an ant walking along a wall keeps its body on the floor (user 2026-11-01: "not walk on the walls of
 * underground"): where soil is under its side (half its body width out) and the other side is open, it eases away from
 * the wall by up to half its step.
 */
const SKIRT = [0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.8];
/** ticks an ant that just skirted an obstacle keeps its heading along the edge before turning back to its goal */
const SKIRT_TICKS = 6;

/** Following an obstacle's edge (just skirted it): count the moment down; true while it lasts. */
function skirting(a: Ant): boolean {
  if ((a.avT ?? 0) <= 0) return false;
  a.avT = (a.avT ?? 0) - 1;
  return true;
}

function offWalls(w: World, a: Ant, step: number): void {
  const hw = casteOf(a.caste).length * 0.17;
  const px = -dsin(a.h) * hw;
  const py = dcos(a.h) * hw;
  const l = w.walkable(a.space, a.x + px, a.y + py);
  const r = w.walkable(a.space, a.x - px, a.y - py);
  if (l === r) return;
  const k = (l ? 1 : -1) * Math.min(step * 0.5, hw * 0.25) / hw;
  const x = a.x + px * k;
  const y = a.y + py * k;
  if (w.walkable(a.space, x, y)) {
    a.x = x;
    a.y = y;
  }
}

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
  // (on an obstacle it was put or pushed onto — a pebble since 2026-11-01 — it may always walk off it)
  if (w.walkable(a.space, nx, ny) || (a.space === SURFACE && !w.walkable(SURFACE, a.x, a.y) && w.terrain.inBounds(nx, ny, 2) && !w.terrain.isWater(nx, ny))) {
    a.x = nx;
    a.y = ny;
    a.v = speed;
    if (a.space !== SURFACE) offWalls(w, a, step);
    return true;
  }
  // (user 2026-11-01: rocks, pebbles and twigs are walked round, not climbed) on the surface, skirt the obstacle: the
  // smallest turn off the way it wants to go that is clear a step and a half ahead, on the side it last went round by,
  // so it follows the obstacle's edge round instead of jamming against it
  if (a.space === SURFACE) {
    // (its own side first, all the way round to nearly back the way it came — round a bulge in the edge — then the other)
    const pref = a.avs || ((a.id & 1) === 0 ? 1 : -1);
    for (let k = 0; k < 2; k++) {
      for (const off of SKIRT) {
        const side = k === 0 ? pref : -pref;
        const h = a.h + off * side;
        const cx = dcos(h);
        const cy = dsin(h);
        if (!w.walkable(SURFACE, a.x + cx * step * 1.5, a.y + cy * step * 1.5) || !w.walkable(SURFACE, a.x + cx * step, a.y + cy * step)) continue;
        a.x += cx * step;
        a.y += cy * step;
        a.h = h;
        a.avs = side;
        // keep to the edge a moment before turning back toward the goal (wall following, not a jam)
        a.avT = SKIRT_TICKS;
        a.v = speed * 0.85;
        return true;
      }
    }
  }
  // slide along an axis
  if (w.walkable(a.space, nx, a.y)) {
    a.x = nx;
    a.v = speed * 0.7;
    if (a.space !== SURFACE) offWalls(w, a, step);
    return true;
  }
  if (w.walkable(a.space, a.x, ny)) {
    a.y = ny;
    a.v = speed * 0.7;
    if (a.space !== SURFACE) offWalls(w, a, step);
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

/**
 * Layered ground: walk toward (tx, ty) round the banks, down the shared surface field to the target's `LAYERS.routeCell`
 * cell (the ramps are the only ways between levels). False when the target can't be reached that way (the caller then
 * steers straight, and skirts what it meets).
 */
function routeOverBanks(w: World, a: Ant, tx: number, ty: number, dt: number, speedMul: number, rate: number): boolean {
  const q = LAYERS.routeCell;
  const f = w.surfFlow.field(`bank:${Math.round(tx / q)}:${Math.round(ty / q)}`, 0, [{ x: tx, y: ty }]);
  if (!w.surfFlow.dir(f, a.x, a.y, tmp)) return false;
  if (!skirting(a)) turnToward(a, datan2(tmp.y, tmp.x), dt, Math.min(rate, 8));
  moveForward(w, a, antSpeed(w, a) * speedMul, dt);
  return true;
}

/** Steer to a point; returns distance remaining. */
export function steerTo(w: World, a: Ant, tx: number, ty: number, dt: number, speedMul = 1, rate = 8, weave = false): number {
  const dx = tx - a.x;
  const dy = ty - a.y;
  const d = dhypot(dx, dy);
  if (d < 0.05) {
    a.v = 0;
    return 0;
  }
  // layered ground: a straight line over a bank is no way at all — round by the ramps, on the field to the target
  // (user 2026-11-02 12:08: "give unit AI more intelligence to go around the map up or down a slope")
  if (a.space === SURFACE && w.terrain.layers && d > 2 && w.terrain.crossesCliff(a.x, a.y, tx, ty) && routeOverBanks(w, a, tx, ty, dt, speedMul, rate)) return d;
  // (`weave`: a trail walk — wandering in a band until the last stretch, user 2026-11-01)
  const want = datan2(dy, dx) + (weave && d > TRAIL.weaveNearMm * 2 ? trailWeave(w, a) : 0);
  // (going round an obstacle: along its edge at a walk, not slowed for facing away from the goal)
  const round = a.space === SURFACE && skirting(a);
  if (!round) turnToward(a, want, dt, rate);
  const facing = round ? 0.85 : dcos(angleDiff(a.h, want));
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
  // (the cone test as |lateral| ≤ forward × tan(cone): no angle per neighbour)
  if (AV.cone !== C21.avoidCone) {
    AV.cone = C21.avoidCone;
    AV.tan = dsin(C21.avoidCone) / dcos(C21.avoidCone);
  }
  AV.team = a.team ?? a.colony;
  AV.ra = bodyRadius(a.caste);
  AV.cw = cw;
  AV.sw = sw;
  AV.ax = a.x;
  AV.ay = a.y;
  AV.a = a;
  AV.fighters = fightersOnly;
  // (combat v2.2: teammates it can pass under, or that can pass under it, are not in its way — only their feet are)
  AV.up = BALANCE.underpass.allies;
  if (AV.up) {
    AV.need = antNeed(a);
    antClear(a, AVC);
    AV.cmax = Math.max(AVC[0], AVC[1], AVC[2]);
  }
  AV.best = Infinity;
  AV.side = 0;
  AV.odd = (a.id & 1) === 1;
  w.antsNear(a.space, a.x, a.y, look, avoidCb);
  return AV.side === 0 ? want : want + AV.side * C21.avoidTurn * (1 - Math.sqrt(AV.best) / look);
}
function avoidCb(g: Ant, d2: number): boolean {
  if (g === AV.a || (g.team ?? g.colony) !== AV.team || g.state === AS.Dead || g.state === AS.Flung || (g.ridePh ?? 0) >= 1 || d2 >= AV.best) return false;
  if (AV.fighters && g.state !== AS.Attack && g.state !== AS.Grapple && g.state !== AS.Spray) return false;
  const gx = g.x - AV.ax;
  const gy = g.y - AV.ay;
  const fwd = gx * AV.cw + gy * AV.sw;
  if (fwd <= 0) return false;
  const lat = -gx * AV.sw + gy * AV.cw;
  if (Math.abs(lat) > fwd * AV.tan) return false;
  if (Math.abs(lat) > (AV.ra + bodyRadius(g.caste)) * 1.4) return false;
  // (combat v2.2: a teammate it can pass under, or that can pass under it, is not in its way — feet aside)
  if (AV.up) {
    if (antNeed(g) <= AV.cmax) return false;
    if (AV.need <= antMostClear(g.caste)) {
      antClear(g, AVC);
      if (AV.need <= Math.max(AVC[0], AVC[1], AVC[2])) return false;
    }
  }
  AV.best = d2;
  AV.side = lat > 1e-6 ? -1 : lat < -1e-6 ? 1 : AV.odd ? 1 : -1;
  return false;
}
/** Body (crowding) radius of a caste: static data, cached. */
function bodyRadius(caste: string): number {
  let r = radiusOf.get(caste);
  if (r === undefined) {
    const S = BALANCE.separation;
    r = casteOf(caste).length * S.widthOfLength * S.radiusOfWidth;
    radiusOf.set(caste, r);
  }
  return r;
}
const radiusOf = new Map<string, number>(); // det-ok: cache of static caste data
const AV = { best: 0, side: 0, cone: NaN, tan: 0, team: 0, ra: 0, cw: 0, sw: 0, ax: 0, ay: 0, a: null as unknown as Ant, fighters: false, odd: false, up: false, need: 0, cmax: 0 }; // det-ok: scratch for avoidHeading's callback
const AVC = [0, 0, 0]; // det-ok: scratch

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
  // layered ground: over a bank only by the ramps (routeOverBanks)
  if (a.space === SURFACE && w.terrain.layers && d > 2 && w.terrain.crossesCliff(a.x, a.y, tx, ty) && routeOverBanks(w, a, tx, ty, dt, speedMul, rate)) return d;
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

/**
 * Field toward the way out of any underground area: a nest's flower's three top hexes (ants climb out over the whole
 * width of the entrance), a cave's tunnel top.
 */
export function exitFieldIn(w: World, space: number): Float32Array | null {
  const flow = w.flowOf(space);
  const g = w.nestOf(space);
  if (!flow || !g) return null;
  const ents = w.entrancesOf(space);
  // (fallen-in holes lead nowhere)
  const open = ents.some(canLeave);
  return flow.field('exit', () => (open ? entranceTop(g).flatMap((q) => hexCoreCells(g, q, 0.35)) : []), ents.length + 32 * usableMask(ents, true));
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

/** Nearest hole (index) of a colony's anthill to a surface point (any, when all have caved in). */
export function nearestEntrance(c: Colony, x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  c.entrances.forEach((e, i) => {
    if (!canEnter(e)) return;
    const d = sq(e.sx - x) + sq(e.sy - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/**
 * How far off its route an ant on a trail turns now (rad; TRAIL): three slow sines of the time, each ant with its own
 * phases and a little of its own pace, scaled by its speed over its length so every caste wanders a band of about the
 * same number of its own body widths.
 */
export function trailWeave(w: World, a: Ant): number {
  // (not in a fight: an ant going for a foe, or round to its place on one, walks straight)
  if (!TRAIL.weave || a.tgt || a.state === AS.Attack || a.state === AS.Grapple) return 0;
  const cd = casteOf(a.caste);
  // (army ants keep their three-lane columns: outbound at the sides, laden in the middle — eciton.ts; termites walk in
  // close processions inside their soldiers' guard lines)
  if (cd.species === 'eciton' || cd.termite) return 0;
  const f = cd.speed / Math.max(0.5, cd.length);
  let h = 0;
  for (let k = 0; k < 3; k++) {
    const pace = 0.8 + 0.4 * hash01(a.id, 40 + k);
    h += TRAIL.weaveA[k] * dsin(w.time * TRAIL.weaveK[k] * f * pace + hash01(a.id, 30 + k) * 6.2832);
  }
  return h * TRAIL.weave;
}

/** Is the straight way from (x0, y0) to (x1, y1) on the surface free of obstacles and water (sampled every 1.5 mm)? */
export function lineClear(w: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = dhypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 1.5);
  for (let i = 1; i < n; i++) {
    const u = i / n;
    if (!w.terrain.passable(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u)) return false;
  }
  return true;
}

/**
 * Walk to a nearby point on the surface (user 2026-11-01: obstacles are walked round): straight there when the way is
 * clear, else round by a shared route — `key`'s field to (rx, ry), the place many ants are going (a food item, a
 * marker), so ants share one field rather than each building its own — and skirting what is left near the point.
 */
export function approachSurface(w: World, a: Ant, x: number, y: number, dt: number, key: string, rx: number, ry: number, speedMul = 1, rate = 8, weave = false): number {
  const d = dhypot(x - a.x, y - a.y);
  // (near the point, or within a body length or two of the shared target: skirting takes it round what is left)
  const L = casteOf(a.caste).length;
  if (d < 2 || dhypot(rx - a.x, ry - a.y) < L * 2 + 8 || lineClear(w, a.x, a.y, x, y)) return steerTo(w, a, x, y, dt, speedMul, rate, weave);
  const c = w.surfFlow.cell;
  const f = w.surfFlow.field(key, Math.round(rx / c) * 10007 + Math.round(ry / c), [{ x: rx, y: ry }]);
  if (w.surfFlow.dir(f, a.x, a.y, tmp)) {
    if (!skirting(a)) turnToward(a, datan2(tmp.y, tmp.x), dt, 6);
    moveForward(w, a, antSpeed(w, a) * speedMul, dt);
    return d;
  }
  return steerTo(w, a, x, y, dt, speedMul, rate, weave);
}

/** Walk home on the surface; enters the nest when reaching an entrance. Returns true once inside. */
export function goHome(w: World, a: Ant, dt: number, speedMul = 1): boolean {
  const c = w.colony(a.colony);
  if (!c) return false;
  // the nearest hole; while it is busy, another of the anthill's with room that is not much farther
  let ei = holeIn(w, c.entrances, a.x, a.y);
  if (ei < 0) ei = nearestEntrance(c, a.x, a.y);
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
    // (user 2026-11-01: not a straight line) wandering in a band along the way
    const want = datan2(tmp.y, tmp.x) + trailWeave(w, a);
    if (!skirting(a)) turnToward(a, want, dt, 6);
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
  // (straight in for the last few centimetres — unless an obstacle lies across the way: then the route round it)
  if (d < 30 && lineClear(w, a.x, a.y, x, y)) {
    steerTo(w, a, x, y, dt, speedMul);
    return d;
  }
  const cell = w.surfFlow.cell;
  const stamp = Math.round(x / cell) * 10007 + Math.round(y / cell);
  const f = w.surfFlow.field(key, stamp, [{ x, y }]);
  if (w.surfFlow.dir(f, a.x, a.y, tmp)) {
    // (user 2026-11-01: not a straight line) wandering in a band along the way, straight in for the last stretch
    let want = datan2(tmp.y, tmp.x) + (d > TRAIL.weaveNearMm * 2 ? trailWeave(w, a) : dsin(w.time * 2 + a.id) * 0.12);
    // a squad on its way to a marker passes round fights instead of plowing through them (combat v2.1)
    if (avoid) want = avoidHeading(w, a, want, BALANCE.combat21.avoidLook * casteOf(a.caste).length, true);
    if (!skirting(a)) turnToward(a, want, dt, 6);
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

/**
 * Walk down hole `ei` of any underground area (own nest, rival nest, cave). In a nest the ant comes out on one of the
 * flower's three top hexes, spread over them by a hash of its id and the tick (not the simulation's random numbers),
 * facing down into the nest; in a cave at its tunnel's top.
 */
export function enterArea(w: World, a: Ant, space: number, ei: number): void {
  const e = w.entrancesOf(space)[ei];
  const g = w.nestOf(space);
  if (!e || !g) return;
  a.space = space;
  if (g.flowers[0]?.length) {
    const top = entranceTop(g);
    const q = top[Math.min(top.length - 1, Math.floor(arrivalHash(w, a, 0) * top.length))];
    const p = g.hexCenter(q);
    const c = g.hexCenter(g.entrances[0]);
    const r = g.R * 0.5 * arrivalHash(w, a, 1);
    const ang = arrivalHash(w, a, 2) * Math.PI * 2;
    a.x = a.px = p.x + dcos(ang) * r;
    a.y = a.py = p.y + dsin(ang) * r;
    a.h = a.ph = datan2(c.y - p.y, c.x - p.x) + (arrivalHash(w, a, 3) - 0.5) * 0.8;
  } else {
    const p = g.hexCenter(e.q);
    const ang = w.rng.range(0, Math.PI * 2);
    a.x = a.px = p.x + dcos(ang) * g.R * 0.15;
    a.y = a.py = p.y + dsin(ang) * g.R * 0.15;
    a.h = a.ph = ang;
  }
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

/**
 * In an area, at the top of its entrance (a nest: on one of its flower's top hexes; a cave: at its tunnel's top) →
 * surface, through the hole nearest where the ant is going (entrances.ts exitHole; while it is busy, another of the
 * anthill's with room). Returns true if exited.
 */
export function tryExit(w: World, a: Ant): boolean {
  if (a.space === SURFACE) return true;
  const g = w.nestOf(a.space);
  if (!g) return false;
  const ents = w.entrancesOf(a.space);
  if (!ents.length || !ents.some(canLeave)) return false;
  if (g.flowers[0]?.length) {
    if (!entranceTop(g).includes(g.hexAt(a.x, a.y))) return false;
  } else {
    const p = g.hexCenter(ents[0].q);
    if (sq(p.x - a.x) + sq(p.y - a.y) >= sq(g.R * 0.3)) return false;
  }
  const i = exitHole(w, a, ents);
  // wait in the entrance, facing up, while the hole is busy
  if (!passEntrance(w, ents[i], true)) {
    a.v = 0;
    return false;
  }
  // (raiders and visitors leave through the host's holes onto the surface beside them)
  exitAreaTo(w, a, a.space, i);
  return true;
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
    // climb the last bit of the ramp, to the nearest of its top hexes
    let best = -1;
    let bd = Infinity;
    for (const q of entranceTop(g)) {
      const p = g.hexCenter(q);
      const d = sq(p.x - a.x) + sq(p.y - a.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best >= 0) {
      const p = g.hexCenter(best);
      steerTo(w, a, p.x, p.y, dt);
    }
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
  // (any hole: the nearest; while it is busy, another of the anthill's with room not much farther)
  const bi = holeIn(w, ents, a.x, a.y);
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
