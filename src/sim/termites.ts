import { World } from './world';
import { Ant, AS, Colony, POSE, SURFACE, nestSpace } from './types';
import { BALANCE, NASUTE, SICKLE } from './balance';
import { casteOf } from './species';
import { damageAnt, damageCreature, creatureHooks, friendlyCreature, isEnemyAnt } from './combat';
import { killAnt, goToNestPoint, foodAt } from './antAI';
import { antSpeed, faceToward, moveForward, steerTo, turnToward, goHome, goToSurfacePoint, homeField, nearestEntrance } from './movement';
import { tileAt } from './tiles';
import { tilePoint } from './colony';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';
import { TERMITE_ROYALS } from './termiteRoyalData';
import { holderDied } from './sickleJaws';
import { markerRoute, Route } from './route';

/**
 * Nasute Termites (docs/creatures/nasutitermes.md; DESIGN "Nasute Termites").
 * Prototype: the nasute's ramping glue stream (the user's exact formula),
 * the major's charge / glue hold / alarm, the king, and the royal pair's death.
 */

const H = BALANCE.tickHz;
/** R: ticks to reach the cap */
export const RAMP_TICKS = NASUTE.ramp.rampSec * H;

/** Cumulative ramp damage (HP) after n firing ticks. Only + − × ÷: deterministic on every client. */
export function rampTotal(n: number): number {
  const s = NASUTE.ramp.startDps;
  const c = NASUTE.ramp.capDps;
  const R = RAMP_TICKS;
  if (n <= R) return (s * n + ((c - s) * n * n) / (2 * R)) / H;
  return rampTotal(R) + (c * (n - R)) / H;
}

/** Damage of the next firing tick when n ticks have already landed. */
export function rampDamage(n: number): number {
  return rampTotal(n + 1) - rampTotal(n);
}

/** Render hint: 0..1 of the way to the cap. */
export function rampFraction(a: Ant): number {
  return Math.min(1, (a.rampN ?? 0) / RAMP_TICKS);
}

function resetRamp(a: Ant, target = 0): void {
  a.rampT = target;
  a.rampN = 0;
  a.rampG = 0;
}

/** Straight-line sight through open ground / dug floor (no LOS system in the game: a ray march over walkable cells). */
export function lineOfSight(w: World, space: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = dhypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (!w.walkable(space, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

interface Tgt {
  id: number;
  kind: 3 | 4;
  x: number;
  y: number;
  r: number;
  space: number;
}

function resolve(w: World, id: number, kind: number): Tgt | null {
  if (kind === 3) {
    const o = w.antById.get(id);
    if (!o || o.state === AS.Dead) return null;
    return { id, kind: 3, x: o.x, y: o.y, r: casteOf(o.caste).length * 0.45, space: o.space };
  }
  if (kind === 4) {
    const cr = w.creatureById.get(id);
    if (!cr || cr.dead) return null;
    return { id, kind: 4, x: cr.x, y: cr.y, r: creatureHooks.radius(cr), space: cr.space };
  }
  return null;
}

/** Nearest enemy in range with line of sight; ties to the lowest id. */
export function acquireInRange(w: World, a: Ant, range: number): Tgt | null {
  let best: Tgt | null = null;
  let bd = Infinity;
  const offer = (t: Tgt) => {
    const d = dhypot(t.x - a.x, t.y - a.y) - t.r;
    if (d > range) return;
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && best && t.id < best.id)) {
      if (!lineOfSight(w, a.space, a.x, a.y, t.x, t.y)) return;
      bd = d;
      best = t;
    }
  };
  w.enemiesNear(a.space, a.team ?? a.colony, a.x, a.y, range + 12, (o) => {
    if (!isEnemyAnt(a, o)) return false;
    offer({ id: o.id, kind: 3, x: o.x, y: o.y, r: casteOf(o.caste).length * 0.45, space: o.space });
    return false;
  });
  for (const cr of w.s.creatures) {
    if (cr.dead || cr.space !== a.space || creatureHooks.relation(cr) === 'ignore' || friendlyCreature(w, a.team ?? a.colony, cr)) continue;
    if (sq(cr.x - a.x) + sq(cr.y - a.y) > sq(range + 40)) continue;
    offer({ id: cr.id, kind: 4, x: cr.x, y: cr.y, r: creatureHooks.radius(cr), space: cr.space });
  }
  return best;
}

/**
 * The nasute in combat, every tick (combat.attackUpdate hands it over).
 * Valid to fire = target alive, within range (centre to edge), in sight,
 * soldier planted (not moving this tick) and not disabled. Valid: damage,
 * lockTicks + 1, grace 0. Not valid but alive: grace + 1, lockTicks held;
 * past grace the ramp resets and the target is dropped. A new target resets
 * at once. Sticky: no switching to a closer enemy.
 */
export function nasuteAttack(w: World, a: Ant, c: Colony, dt: number, biteMul: number): boolean {
  const cd = casteOf(a.caste);
  const range = cd.acid!.range;
  a.fire = 0;
  a.pose = POSE.SPRAY;
  if ((a.rampT ?? 0) !== a.tgt) resetRamp(a, a.tgt); // target switch: immediate reset, no grace
  let t = resolve(w, a.tgt, a.tk);
  if (!t) {
    // target died (or vanished): re-acquire the nearest in range at once
    const n = acquireInRange(w, a, range);
    if (!n) {
      resetRamp(a);
      a.state = AS.Idle;
      a.st = 0;
      a.tgt = 0;
      a.tk = 0;
      return false;
    }
    a.tgt = n.id;
    a.tk = n.kind;
    resetRamp(a, n.id);
    t = n;
  }
  const d = dhypot(t.x - a.x, t.y - a.y);
  const inRange = t.space === a.space && d - t.r <= range;
  const disabled = a.stun > 0 || a.pinned > 0 || (a.heldBy ?? 0) > 0;
  const sight = inRange && lineOfSight(w, a.space, a.x, a.y, t.x, t.y);
  // Keep distance: an enemy right on top of it and a friendly major close by → step back behind the major.
  let stepBack = false;
  if (inRange && !disabled) {
    const L = cd.length;
    if (d - t.r < NASUTE.nasute.minDistanceBodyLengths * L) {
      w.antsNear(a.space, a.x, a.y, NASUTE.escort.majorNearBodyLengths * L, (o) => {
        if (o.colony === a.colony && o.state !== AS.Dead && casteOf(o.caste).termite === 'major') stepBack = true;
        return stepBack;
      });
    }
  }
  if (inRange && sight && !disabled && !stepBack) {
    a.v = 0;
    faceToward(a, t.x, t.y, dt);
    const dmg = rampDamage(a.rampN ?? 0) * biteMul;
    if (t.kind === 3) damageAnt(w, w.antById.get(t.id)!, dmg, 'pure', a);
    else damageCreature(w, w.creatureById.get(t.id)!, dmg, 'pure', a);
    a.rampN = (a.rampN ?? 0) + 1;
    a.rampG = 0;
    a.fire = 1;
    return true;
  }
  // Interrupted: hold the ramp through the grace, then reset and drop the target.
  a.rampG = (a.rampG ?? 0) + 1;
  if (a.rampG > NASUTE.ramp.graceSec * H) {
    resetRamp(a);
    a.tgt = 0;
    a.tk = 0;
    a.state = AS.Idle;
    a.st = 0;
    return false;
  }
  if (disabled) return true;
  if (stepBack) {
    const away = datan2(a.y - t.y, a.x - t.x);
    steerTo(w, a, a.x + dcos(away) * 6, a.y + dsin(away) * 6, dt);
  } else if (t.space === a.space) steerTo(w, a, t.x, t.y, dt);
  return true;
}

// ---------------------------------------------------------------------------
// Major soldier
// ---------------------------------------------------------------------------

/** Charge: target within the trigger range but out of reach → faster for a moment. */
export function majorCharge(a: Ant, distToEdge: number, reach: number): void {
  const L = casteOf(a.caste).length;
  const k = NASUTE.majorCharge;
  if ((a.chT ?? 0) <= 0 && (a.chCd ?? 0) <= 0 && distToEdge > reach && distToEdge <= k.triggerRangeBodyLengths * L) {
    a.chT = k.maxSec;
    a.chCd = k.cooldownSec;
  }
}

/** Point-blank glue burst on contact: the target is rooted (it can still bite back). */
export function glueBurst(w: World, a: Ant, kind: number, id: number): void {
  if ((a.glueCd ?? 0) > 0) return;
  const g = NASUTE.majorGlueBurst;
  const now = w.s.tick;
  if (kind === 3) {
    const o = w.antById.get(id);
    if (!o || o.state === AS.Dead || (o.rootImm ?? 0) > now) return;
    const large = casteOf(o.caste).mass >= g.largeMass;
    const hold = Math.round(g.holdSec * H * (large ? g.largeTargetHoldMul : 1));
    o.root = now + hold;
    o.rootImm = o.root + g.reRootImmunitySec * H;
    w.events.emit({ t: 'glueBurst', x: o.x, y: o.y, space: o.space, target: o.id });
  } else {
    const cr = w.creatureById.get(id);
    if (!cr || cr.dead || (cr.data.rootImm ?? 0) > now) return;
    const large = cr.scale >= g.largeLength || !!cr.data.boss;
    const hold = Math.round(g.holdSec * H * (large ? g.largeTargetHoldMul : 1));
    cr.data.root = now + hold;
    cr.data.rootImm = cr.data.root + g.reRootImmunitySec * H;
    w.events.emit({ t: 'glueBurst', x: cr.x, y: cr.y, space: cr.space, target: cr.id });
  }
  a.glueCd = g.cooldownSec;
}

/** The alarm: head-banging that alerts nearby nestmates (soldiers rush in, workers fall back). */
export function majorAlarm(w: World, a: Ant): void {
  if ((a.alCd ?? 0) > 0) return;
  const k = NASUTE.majorAlarm;
  a.alCd = k.cooldownSec;
  const R = k.radiusBodyLengths * casteOf(a.caste).length;
  const until = w.s.tick + k.alertSec * H;
  w.events.emit({ t: 'headbang', x: a.x, y: a.y, space: a.space });
  w.antsNear(a.space, a.x, a.y, R, (o) => {
    if (o.colony !== a.colony || o.state === AS.Dead || !casteOf(o.caste).termite) return false;
    o.alertUntil = until;
    o.alX = a.x;
    o.alY = a.y;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Every termite, every tick (speciesHooks.beforeAnt)
// ---------------------------------------------------------------------------

export function termiteTick(w: World, a: Ant, c: Colony, dt: number): boolean {
  const cd = casteOf(a.caste);
  if (a.chT && a.chT > 0) a.chT = Math.max(0, a.chT - dt);
  if (a.chCd && a.chCd > 0) a.chCd = Math.max(0, a.chCd - dt);
  if (a.glueCd && a.glueCd > 0) a.glueCd = Math.max(0, a.glueCd - dt);
  if (a.alCd && a.alCd > 0) a.alCd = Math.max(0, a.alCd - dt);
  if (cd.termite === 'king') return kingTick(w, a, c, dt);
  // Alerted by the drumming (units on a player's marker keep their orders). Workers fight like ant
  // workers (user note 2026-10-25): only the soldiers rush to the drummer.
  if ((a.alertUntil ?? 0) > w.s.tick && a.marker < 0 && a.state !== AS.Attack && a.state !== AS.Grapple && a.task !== 'job') {
    if ((cd.termite === 'nasute' || cd.termite === 'major' || cd.termite === 'sickle') && a.alX !== undefined && a.alY !== undefined) {
      if (dhypot(a.alX - a.x, a.alY - a.y) > cd.length * 2) {
        if (a.space === SURFACE) steerTo(w, a, a.alX, a.alY, dt, 1.1);
        else goToNestPoint(w, a, c, a.alX, a.alY, dt, 1.1);
        a.pose = POSE.ALARM;
        // still scan for enemies on the way
        return false;
      }
    }
  }
  return false;
}

/** The king: leashed to the royal chamber; bites intruders inside it; grooms the queen. */
function kingTick(w: World, a: Ant, c: Colony, dt: number): boolean {
  a.stun = 0;
  const home = nestSpace(c.id);
  if (a.space !== home) return false;
  const inChamber = (x: number, y: number) => {
    const g = w.nest(c.id);
    if (!g) return false;
    const t = tileAt(c, g.hexAt(x, y));
    return !!t && t.type === 'queen';
  };
  // nearest intruder inside the chamber (ties: lowest id)
  let best: Ant | null = null;
  let bd = Infinity;
  w.enemiesNear(a.space, a.team ?? a.colony, a.x, a.y, 60, (o, d2) => {
    if (!isEnemyAnt(a, o) || !inChamber(o.x, o.y)) return false;
    if (d2 < bd || (d2 === bd && best && o.id < best.id)) {
      bd = d2;
      best = o;
    }
    return false;
  });
  const cd = casteOf(a.caste);
  if (best) {
    const o = best as Ant;
    const reach = (cd.length + casteOf(o.caste).length) * 0.45;
    a.pose = POSE.ALARM;
    if (Math.sqrt(bd) > reach) steerTo(w, a, o.x, o.y, dt, 1);
    else {
      a.v = 0;
      faceToward(a, o.x, o.y, dt);
      if (a.cd <= 0) {
        a.cd = cd.attackInterval;
        damageAnt(w, o, cd.bite * (a.power || 1), 'bite', a);
        w.events.emit({ t: 'bite', x: o.x, y: o.y, space: o.space, strength: cd.bite / 10, by: a.caste, on: 'ant' });
      }
    }
    return true;
  }
  // otherwise stand beside the queen (two separate bodies: by her side, not on her); the renderer
  // plays ATTEND there: antennae tapping her, a grooming bout now and then
  const q = w.antById.get(c.queen);
  if (!q || q.state === AS.Dead || q.space !== a.space) {
    a.v = 0;
    return true;
  }
  kingSpot(w, q, a.caste, spot);
  if (a.state !== AS.Idle) {
    a.state = AS.Idle; // a worker feeding him leaves him as he was
    a.st = 0;
  }
  a.pose = POSE.NONE;
  // repositioning: a slow, careful walk (half speed); a nudge from a nestmate does not set him off
  const d = dhypot(spot.x - a.x, spot.y - a.y);
  if (d > (a.v > 0 ? 0.5 : Math.max(0.8, cd.length * 0.15))) goToNestPoint(w, a, c, spot.x, spot.y, dt, 0.5);
  else {
    a.v = 0;
    faceToward(a, a.x + dcos(spot.h), a.y + dsin(spot.h), dt);
  }
  return true;
}

const spot = { x: 0, y: 0, h: 0 }; // det-ok: scratch

// ---------------------------------------------------------------------------
// Royals (model kit v2.1): the queen's body and egg point, the king's place
// ---------------------------------------------------------------------------

/** How far the laid egg slides out past the kit's Bone.EGG_LAY pivot (shaders.ts: egg at P.egg = 1). */
const EGG_OUT_MM = 0.75;

type Royal = (typeof TERMITE_ROYALS)[keyof typeof TERMITE_ROYALS];

/** A termite royal's kit model data (TERMITE_ROYALS is keyed by the kit caste: the morph after 'termite_'). */
export function royalOf(caste: string): Royal {
  return TERMITE_ROYALS[casteOf(caste).morph.slice(8) as keyof typeof TERMITE_ROYALS] ?? TERMITE_ROYALS.queen;
}

/** A termite queen's size relative to the kit model (her sim length over the model's). */
function queenScale(q: Ant): number {
  return casteOf(q.caste).length / royalOf(q.caste).length;
}

/** Is this a physogastric termite queen (body: a long abdomen behind her position)? */
export function isTermiteQueen(a: Ant): boolean {
  return casteOf(a.caste).termite === 'queen';
}

/**
 * A termite queen's abdomen as a capsule (segment a–b plus radius r, world mm): it starts just
 * behind her thorax and runs back 22 mm (kit v2.1). Separation keeps everyone out of it.
 */
export function queenBody(q: Ant, out: { ax: number; ay: number; bx: number; by: number; r: number }): void {
  const R = royalOf(q.caste);
  const s = queenScale(q);
  const r = R.abdHalfWidth * s;
  const xa = R.abdFront * s - r;
  const xb = -R.back * s + r;
  const c = dcos(q.h);
  const n = dsin(q.h);
  out.ax = q.x + c * xa;
  out.ay = q.y + n * xa;
  out.bx = q.x + c * xb;
  out.by = q.y + n * xb;
  out.r = r;
}

/** Distance from a point to a queen's abdomen capsule surface (negative inside). */
export function distToQueenBody(q: Ant, x: number, y: number): number {
  queenBody(q, qb);
  const dx = qb.bx - qb.ax;
  const dy = qb.by - qb.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - qb.ax) * dx + (y - qb.ay) * dy) / l2)) : 0;
  return dhypot(x - (qb.ax + dx * t), y - (qb.ay + dy * t)) - qb.r;
}
const qb = { ax: 0, ay: 0, bx: 0, by: 0, r: 0 }; // det-ok: scratch

/**
 * A point moved out of a termite queen's abdomen (her capsule + `margin`), along the shortest way: brood that
 * matures under her (the first workers grow on her tile) steps out beside her rather than inside her.
 */
export function outsideQueenBody(w: World, q: Ant, x: number, y: number, margin: number, out: { x: number; y: number }): void {
  out.x = x;
  out.y = y;
  if (!isTermiteQueen(q)) return;
  queenBody(q, qb);
  const dx = qb.bx - qb.ax;
  const dy = qb.by - qb.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - qb.ax) * dx + (y - qb.ay) * dy) / l2)) : 0;
  const cx = qb.ax + dx * t;
  const cy = qb.ay + dy * t;
  let ex = x - cx;
  let ey = y - cy;
  const d = dhypot(ex, ey);
  const min = qb.r + margin;
  if (d >= min) return;
  const l = Math.sqrt(l2) || 1;
  if (d > 1e-6) {
    ex /= d;
    ey /= d;
  } else {
    ex = -dy / l;
    ey = dx / l;
  }
  // that side, or the other one when it is soil
  for (const sd of [1, -1]) {
    const px = cx + ex * min * sd;
    const py = cy + ey * min * sd;
    if (w.walkable(q.space, px, py)) {
      out.x = px;
      out.y = py;
      return;
    }
  }
}

/**
 * How far behind a queen's position a laid egg appears: for a termite queen the kit's egg-lay
 * point (Bone.EGG_LAY) plus the egg's slide out of the tip; other queens half a body length.
 */
export function abdomenTipBack(q: Ant): number {
  const cd = casteOf(q.caste);
  if (cd.termite !== 'queen') return cd.length * 0.5;
  return (-royalOf(q.caste).eggLay[0] + EGG_OUT_MM) * queenScale(q);
}

/**
 * Where a worker grooms or feeds a termite queen: feeding at her head (mouth to mouth), grooming
 * beside the nearest part of her abdomen, just clear of it. `out.fx/fy` is the point to face.
 */
export function queenTendPoint(q: Ant, x: number, y: number, len: number, feed: boolean, out: { x: number; y: number; fx: number; fy: number }): void {
  const c = dcos(q.h);
  const n = dsin(q.h);
  if (feed) {
    const f = royalOf(q.caste).front * queenScale(q) + len * 0.45;
    out.x = q.x + c * f;
    out.y = q.y + n * f;
    out.fx = q.x;
    out.fy = q.y;
    return;
  }
  queenBody(q, qb);
  const dx = qb.bx - qb.ax;
  const dy = qb.by - qb.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - qb.ax) * dx + (y - qb.ay) * dy) / l2)) : 0;
  const ax = qb.ax + dx * t;
  const ay = qb.ay + dy * t;
  let ox = x - ax;
  let oy = y - ay;
  const d = dhypot(ox, oy);
  if (d > 1e-6) {
    ox /= d;
    oy /= d;
  } else {
    ox = -n;
    oy = c;
  }
  const off = qb.r + len * 0.5;
  out.x = ax + ox * off;
  out.y = ay + oy * off;
  out.fx = ax;
  out.fy = ay;
}

/**
 * Where the king stands: beside the front third of his queen's abdomen, parallel to her and just
 * clear of her, so his antennae reach her (kit v2.1: he plays ATTEND there). Her left side, or her
 * right when the left is soil.
 */
export function kingSpot(w: World, q: Ant, kingCaste: string, out: { x: number; y: number; h: number }): void {
  const R = NASUTE.royals;
  const Q = royalOf(q.caste);
  const K = royalOf(kingCaste);
  const s = queenScale(q);
  const xa = Q.abdFront * s;
  const along = xa + R.kingAlong * (-Q.back * s - xa);
  const lateral = Q.abdHalfWidth * s + K.halfWidth * (casteOf(kingCaste).length / K.length) + R.kingGapMm;
  const c0 = dcos(q.h);
  const s0 = dsin(q.h);
  for (const side of SIDES) {
    out.x = q.x + c0 * along - s0 * lateral * side;
    out.y = q.y + s0 * along + c0 * lateral * side;
    out.h = q.h;
    if (w.walkable(q.space, out.x, out.y)) return;
  }
  out.x = q.x + c0 * along - s0 * lateral;
  out.y = q.y + s0 * along + c0 * lateral;
}
const SIDES = [1, -1] as const;

/**
 * Founding a termite colony (createColony): where the queen lies. Along the royal chamber's long
 * axis (from the centre hex through the middle of an edge: a 7-hex chamber is longest that way),
 * her body (head to abdomen tip) centred on the chamber. `h` is a random heading, snapped to that axis.
 */
export function queenSpot(w: World, c: Colony, q0: number, queenCaste: string, h: number): { x: number; y: number; h: number } {
  const g = w.nest(c.id)!;
  const ctr = g.hexCenter(q0);
  // the neighbour direction closest to h
  let best = -Infinity;
  let hx = dcos(h);
  let hy = dsin(h);
  const wantX = hx;
  const wantY = hy;
  for (const nq of g.neighbors(q0)) {
    if (nq < 0) continue;
    const p = g.hexCenter(nq);
    const dx = p.x - ctr.x;
    const dy = p.y - ctr.y;
    const d = dhypot(dx, dy);
    const dot = (dx * wantX + dy * wantY) / d;
    if (dot > best) {
      best = dot;
      hx = dx / d;
      hy = dy / d;
    }
  }
  const Q = royalOf(queenCaste);
  // thorax forward of the centre so the body is centred on it
  const fwd = ((Q.back - Q.front) / 2) * (casteOf(queenCaste).length / Q.length);
  return { x: ctr.x + hx * fwd, y: ctr.y + hy * fwd, h: datan2(hy, hx) };
}

/** After killAnt (the king dying with his queen is killAnt's, for termites and Termants alike). */
export function onTermiteDied(w: World, c: Colony, a: Ant): void {
  if (casteOf(a.caste).termite === 'sickle') holderDied(w, a);
  if (casteOf(a.caste).termite === 'queen') c.tileVersion++; // her body no longer blocks the paths (updateFlowCosts)
}

/** Is this nest hex part of the royal chamber? */
export function isRoyalHex(c: Colony, q: number): boolean {
  return tileAt(c, q)?.type === 'queen';
}

void sq;

// ---------------------------------------------------------------------------
// Positioning at markers: escort ring, majors in front, nasutes behind them
// ---------------------------------------------------------------------------

interface MarkerSquad {
  nasutes: number[];
  majors: number[];
  /** unit vector from the marker toward the threat (or away from the nest when none is known) */
  ux: number;
  uy: number;
  threat: boolean;
}
// A per-tick cache derived entirely from sim state (rebuilt when the tick or the state object changes).
let squadTick = -1; // det-ok: derived per-tick cache
let squadState: unknown = null; // det-ok: derived per-tick cache
const squads = new Map<number, MarkerSquad>(); // det-ok: derived per-tick cache, rebuilt from SimState

function squadOf(w: World, c: Colony, mi: number): MarkerSquad {
  if (squadTick !== w.s.tick || squadState !== w.s) {
    squadTick = w.s.tick;
    squadState = w.s;
    squads.clear();
  }
  const key = c.id * 16 + mi;
  let s = squads.get(key);
  if (s) return s;
  const m = c.markers[mi];
  s = { nasutes: [], majors: [], ux: 1, uy: 0, threat: false };
  let tx = 0;
  let ty = 0;
  // w.s.ants is in id order, so the slot lists come out sorted by id
  for (const o of w.s.ants) {
    if (o.colony !== c.id || o.marker !== mi || o.task !== 'marker' || o.state === AS.Dead || o.space !== m.space) continue;
    const t = casteOf(o.caste).termite;
    if (t === 'nasute' || t === 'sickle') s.nasutes.push(o.id);
    else if (t === 'major') s.majors.push(o.id);
    else continue;
    if (!s.threat && (o.alertUntil ?? 0) > w.s.tick && o.alX !== undefined && o.alY !== undefined) {
      s.threat = true;
      tx = o.alX;
      ty = o.alY;
    }
  }
  let dx: number;
  let dy: number;
  if (s.threat) {
    dx = tx - m.x;
    dy = ty - m.y;
  } else {
    const e = c.entrances[0];
    dx = m.x - (e?.sx ?? c.nx);
    dy = m.y - (e?.sy ?? c.ny);
  }
  const d = dhypot(dx, dy);
  if (d > 1e-6) {
    s.ux = dx / d;
    s.uy = dy / d;
  }
  squads.set(key, s);
  return s;
}

/**
 * Where a nasute or major stands at its marker (DESIGN "Nasute Termites", marker table):
 *  - nasutes take evenly spaced slots on a ring around the workers' work area
 *    (marker radius + `escort.ringBodyLengths`), facing outward, by sorted id;
 *  - majors hold a line at the marker front (toward a known threat, else away from the nest);
 *  - with majors present and a threat known, the nasutes form a line
 *    `escort.behindMajorsBodyLengths` behind the majors instead.
 */
export function termiteMarkerSlot(w: World, a: Ant, c: Colony, mi: number, radius: number): { x: number; y: number; h: number } | null {
  const t = casteOf(a.caste).termite;
  if (t !== 'nasute' && t !== 'major' && t !== 'sickle') return null;
  const m = c.markers[mi];
  const s = squadOf(w, c, mi);
  if (t === 'sickle') return sickleRowSlot(w, a, c, mi, radius);
  const L = NASUTE.sizeMm.nasuteSoldier;
  const E = NASUTE.escort;
  const px = -s.uy;
  const py = s.ux;
  const front = radius * 0.6;
  const line = (ids: number[], dist: number, spacing: number) => {
    const k = ids.indexOf(a.id);
    const off = (k - (ids.length - 1) / 2) * spacing;
    return { x: m.x + s.ux * dist + px * off, y: m.y + s.uy * dist + py * off, h: datan2(s.uy, s.ux) };
  };
  if (t === 'major') return line(s.majors, front, casteOf(a.caste).length * 1.5);
  if (s.majors.length && s.threat) return line(s.nasutes, front - E.behindMajorsBodyLengths * L, L * 1.25);
  const k = s.nasutes.indexOf(a.id);
  const n = Math.max(1, s.nasutes.length);
  const ang = datan2(s.uy, s.ux) + (k / n) * Math.PI * 2;
  const R = radius + E.ringBodyLengths * L;
  return { x: m.x + dcos(ang) * R, y: m.y + dsin(ang) * R, h: ang };
}

/**
 * Which sickle-jaws at a marker guard the trail (Eisner's defensive row) and which gather. With food at the
 * marker, `escort.guardShare` of them guard (the lowest ids; user note 2026-10-25: the spare soldiers go to the
 * trail where the workers are) and the rest gather like ant soldiers; with nothing to gather, all of them guard.
 * Returns this soldier's guard index and the number of guards, or k = -1 for a gatherer.
 */
export function sickleGuardIndex(w: World, a: Ant, c: Colony, mi: number, hasFood: boolean): { k: number; n: number } {
  // every sickle-jaw sent to this marker, wherever it is now (one carrying food home stays on the roll, so the
  // others keep their roles and places)
  const ids = sickleRoll(w, c, mi);
  const k = ids.indexOf(a.id);
  if (k < 0) return { k: -1, n: 0 };
  const n = hasFood ? Math.ceil(ids.length * SICKLE.escort.guardShare) : ids.length;
  return { k: k < n ? k : -1, n };
}

let rollTick = -1; // det-ok: derived per-tick cache
let rollState: unknown = null; // det-ok: derived per-tick cache
const rolls = new Map<number, number[]>(); // det-ok: derived per-tick cache, rebuilt from SimState

/** The sickle-jaw soldiers on a marker, in id order (any space). */
function sickleRoll(w: World, c: Colony, mi: number): number[] {
  if (rollTick !== w.s.tick || rollState !== w.s) {
    rollTick = w.s.tick;
    rollState = w.s;
    rolls.clear();
  }
  const key = c.id * 16 + mi;
  let r = rolls.get(key);
  if (r) return r;
  r = [];
  for (const o of w.s.ants) if (o.colony === c.id && o.marker === mi && o.task === 'marker' && o.state !== AS.Dead && casteOf(o.caste).termite === 'sickle') r.push(o.id);
  rolls.set(key, r);
  return r;
}

/**
 * The route the workers walk between a surface marker and the nest (route.ts: the home flow field traced from the
 * marker every `trailStepMm`, refreshed when the marker moves and every `trailRefreshSec`).
 */
export function sickleTrail(w: World, c: Colony, mi: number): Route {
  return markerRoute(w, c, mi, SICKLE.escort.trailStepMm, SICKLE.escort.trailRefreshSec);
}

const tdir = { x: 0, y: 0 }; // det-ok: scratch
const LAT_STEPS = [1, 0.8, 0.6, 0.4, 0.2];

/**
 * Sickle-Jaw guards at a marker (Eisner's defensive row; SICKLE.escort): both sides of the workers' actual route
 * from the work area back to the nest (sickleTrail), spread evenly over its whole length, `halfWidthBodyLengths`
 * out from it, facing outward (mandibles open: THREAT), slots by sorted id; soldiers beyond one row per side
 * stand in further rows. In a nest, or when the marker is beside the entrance: the ring round the marker.
 */
function sickleRowSlot(w: World, a: Ant, c: Colony, mi: number, radius: number): { x: number; y: number; h: number } {
  const m = c.markers[mi];
  const E = SICKLE.escort;
  const L = casteOf(a.caste).length;
  // the guard index among the guards (gatherers never ask: antAI.marker sends only guards here). With food at
  // the marker the guards are the first `guardShare` of the roll, so the indices are the same either way.
  const g = sickleGuardIndex(w, a, c, mi, foodAt(w, c, m.x, m.y, radius * 1.3));
  const k = Math.max(0, g.k);
  const n = Math.max(1, g.n);
  const tr = m.space === SURFACE && c.entrances.length ? sickleTrail(w, c, mi) : null;
  const total = tr ? tr.cum[tr.cum.length - 1] : 0;
  const start = Math.min(total, radius * 0.6);
  const avail = total - start - L * 2; // stop short of the entrance itself
  if (!tr || avail < L * 2) {
    const ang = (k / n) * Math.PI * 2;
    const R = radius + NASUTE.escort.ringBodyLengths * L;
    return { x: m.x + dcos(ang) * R, y: m.y + dsin(ang) * R, h: ang };
  }
  const side = k % 2 === 0 ? 1 : -1;
  const j = Math.floor(k / 2);
  const pairs = Math.ceil(n / 2);
  const perRow = Math.max(1, Math.min(pairs, Math.floor(avail / (E.minSpacingBodyLengths * L)) + 1));
  const row = Math.floor(j / perRow);
  const jj = j % perRow;
  const s = start + ((jj + 0.5) / perRow) * avail;
  // the point at arc length s and the route's direction there (toward the nest)
  let i = 1;
  while (i < tr.cum.length - 1 && tr.cum[i] < s) i++;
  const s0 = tr.cum[i - 1];
  const seg = Math.max(1e-6, tr.cum[i] - s0);
  const f = Math.min(1, Math.max(0, (s - s0) / seg));
  const ax = tr.pts[i * 2 - 2];
  const ay = tr.pts[i * 2 - 1];
  const bx = tr.pts[i * 2];
  const by = tr.pts[i * 2 + 1];
  const ux = (bx - ax) / seg;
  const uy = (by - ay) / seg;
  const lat = (E.halfWidthBodyLengths + row * E.rowGapBodyLengths) * L * side;
  const cx = ax + (bx - ax) * f;
  const cy = ay + (by - ay) * f;
  // a post on a rock or in water moves in toward the route until it is on open ground
  let px = cx;
  let py = cy;
  for (const k of LAT_STEPS) {
    const qx = cx - uy * lat * k;
    const qy = cy + ux * lat * k;
    if (w.walkable(SURFACE, qx, qy)) {
      px = qx;
      py = qy;
      break;
    }
  }
  return { x: px, y: py, h: datan2(ux * side, -uy * side) };
}

/** Walk to the marker slot and hold it, facing out. Returns true when handled. */
export function holdMarkerSlot(w: World, a: Ant, c: Colony, mi: number, radius: number, dt: number): boolean {
  const p = termiteMarkerSlot(w, a, c, mi, radius);
  if (!p) return false;
  const m = c.markers[mi];
  const d = dhypot(p.x - a.x, p.y - a.y);
  const L = casteOf(a.caste).length;
  if (d > Math.min(L * 0.3, 1.5) * (a.state === AS.Rally ? 2 : 1)) {
    if (a.state === AS.Rally) a.state = AS.Idle;
    const guard = a.space === SURFACE && casteOf(a.caste).termite === 'sickle';
    if (guard && d <= 30) steerTo(w, a, p.x, p.y, dt, 0.8);
    else if (guard) {
      // a guard post on the route: walk along the route toward it (the workers' own flow fields), homeward when
      // the post is nearer the nest than we are, else out toward the marker; straight in for the last 30 mm
      if (dhypot(p.x - m.x, p.y - m.y) > dhypot(a.x - m.x, a.y - m.y)) {
        const f = homeField(w, c);
        if (w.surfFlow.dir(f, a.x, a.y, tdir)) {
          turnToward(a, datan2(tdir.y, tdir.x), dt, 6);
          moveForward(w, a, antSpeed(w, a) * 0.9, dt);
        } else steerTo(w, a, p.x, p.y, dt, 0.9);
      } else goToSurfacePoint(w, a, m.x, m.y, dt, `mk:${c.id}:${mi}`, 0.9);
    } else if (a.space === SURFACE && dhypot(m.x - a.x, m.y - a.y) > radius * 2 + 30) goToSurfacePoint(w, a, m.x, m.y, dt, `mk:${c.id}:${mi}`);
    else if (a.space === SURFACE) steerTo(w, a, p.x, p.y, dt, 0.8);
    else goToNestPoint(w, a, null, p.x, p.y, dt, 0.8);
    return true;
  }
  a.v = 0;
  turnToward(a, p.h, dt, 5);
  if (a.state !== AS.Rally) {
    a.state = AS.Rally;
    a.st = 0;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Idle colony life: workers groom the queen and brood, feed soldiers and the royals
// ---------------------------------------------------------------------------

/** Continue an idle interaction (restInNest calls this first). No economic effect. */
export function termiteIdle(w: World, a: Ant, c: Colony, dt: number): boolean {
  if ((a.idleT ?? 0) <= 0) return false;
  if (a.state !== AS.Groom || a.space !== nestSpace(c.id)) return endIdle(a);
  const o = a.partner ? w.antById.get(a.partner) : undefined;
  if (a.partner && (!o || o.state === AS.Dead || o.space !== a.space)) return endIdle(a);
  const L = casteOf(a.caste).length;
  let tx = o ? o.x : a.tx;
  let ty = o ? o.y : a.ty;
  let fx = tx;
  let fy = ty;
  let reach = (o ? casteOf(o.caste).length * 0.5 : 1.2) + L * 0.5;
  if (o && isTermiteQueen(o)) {
    // a termite queen is mostly abdomen: tend her at her body, not at her position (her thorax)
    queenTendPoint(o, a.x, a.y, L, a.tk === 1, tend);
    tx = tend.x;
    ty = tend.y;
    fx = tend.fx;
    fy = tend.fy;
    reach = L * 0.4;
  }
  const d = dhypot(tx - a.x, ty - a.y);
  if (d > reach) {
    if (a.st > 14) return endIdle(a); // could not get there
    goToNestPoint(w, a, c, tx, ty, dt, 0.7);
    return true;
  }
  a.v = 0;
  turnToward(a, datan2(fy - a.y, fx - a.x), dt, 6);
  a.pose = a.tk === 1 ? POSE.TROPH : POSE.GROOM_ANT;
  a.idleT = (a.idleT ?? 0) - dt;
  if ((a.idleT ?? 0) <= 0) return endIdle(a);
  return true;
}

const tend = { x: 0, y: 0, fx: 0, fy: 0 }; // det-ok: scratch

function endIdle(a: Ant): boolean {
  a.idleT = 0;
  a.partner = 0;
  if (a.state === AS.Groom) {
    a.state = AS.Idle;
    a.st = 0;
  }
  return false;
}

/** Maybe start an idle interaction (a termite worker choosing what to do next in the nest). */
export function startTermiteIdle(w: World, a: Ant, c: Colony): boolean {
  if (casteOf(a.caste).termite !== 'worker' || a.space !== nestSpace(c.id)) return false;
  const I = NASUTE.idle;
  if (!w.rng.chance(I.interactChance)) return false;
  const r = w.rng.next();
  let partner = 0;
  let tx = 0;
  let ty = 0;
  let feed = false;
  if (r < 0.3) partner = c.queen; // groom the queen
  else if (r < 0.6) {
    // groom an egg pile or a larva on its tile
    const larvae = w.s.brood.filter((b) => b.colony === c.id && b.stage === 1);
    if (larvae.length) {
      const b = larvae[w.rng.int(0, larvae.length - 1)];
      tx = b.x;
      ty = b.y;
    } else partner = c.queen;
  } else {
    // feed a soldier, the king or the queen mouth to mouth (they cannot feed themselves)
    feed = true;
    const home = nestSpace(c.id);
    const fed = w.s.ants.filter((o) => o.colony === c.id && o.space === home && o.state !== AS.Dead && o.state !== AS.Attack && (casteOf(o.caste).termite === 'nasute' || casteOf(o.caste).termite === 'major' || casteOf(o.caste).termite === 'sickle' || o.id === c.king || o.id === c.queen));
    if (!fed.length) return false;
    partner = fed[w.rng.int(0, fed.length - 1)].id;
  }
  if (partner) {
    const o = w.antById.get(partner);
    if (!o || o.state === AS.Dead || o.space !== a.space || o.id === a.id) return false;
  }
  a.partner = partner;
  a.tx = tx;
  a.ty = ty;
  a.tk = feed ? 1 : 0;
  a.idleT = w.rng.range(I.minSec, I.maxSec);
  a.state = AS.Groom;
  a.st = 0;
  return true;
}
