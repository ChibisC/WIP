/**
 * Saiy-Ant Blaster (`aurimyrmex_blaster`; user spec 2026-11-07, claude/saiy-ants/09-spec-saiy-blaster.md;
 * CHANGE_PLAN §31; numbers in `BALANCE.blaster`). Fictional: the caste fires glowing energy orbs from its mouth.
 *
 *  - It closes to its range and holds there like the acid shooters (combat.attackUpdate). A shot is a wind-up (the head
 *    turns to aim; the mouth glows), the shot, a short recovery (`AS.Spray` → `blastShot`).
 *  - An orb flies straight at where its target was and hits the first enemy it touches on the way (ants and
 *    creatures; never a teammate), or stops at a wall, or fizzles at 1.3 × range. Physical damage (`blast`: armour
 *    counts as against a bite).
 *  - In the gold form (sim/surge.ts) every fifth shot is the beam: straight along the densest line of enemies in reach,
 *    cut short by the first wall, fixed for 3 s; every `beamTick` each enemy crossing it is hurt. The ant is planted for
 *    the whole beam (antAI runs `beamUpdate` before orders, jobs and combat); a fling, a grab or death ends it; the gold
 *    form running out does not. Outside the gold form the shot count starts again.
 *
 * Deterministic: no randomness here, fixed iteration (ties by id), dmath trigonometry.
 */
import { World } from './world';
import { Ant, AS, Colony, POSE, SURFACE } from './types';
import type { Projectile } from './types';
import { BALANCE } from './balance';
import { casteOf } from './species';
import { abilityMods } from './abilities';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';
import { turnToward } from './movement';
import { surging } from './surge';
import { biteMul, creatureHooks, damageAnt, damageCreature, friendlyCreature } from './combat';
import { riding } from './climbing';

const B = BALANCE.blaster;

/** Is the caste a blaster? */
export const isBlaster = (a: Ant): boolean => !!casteOf(a.caste).blast;

/** The orbs' reach (mm). */
export const blastRange = (): number => B.range;

/** The mouth: where orbs and the beam leave the ant (just ahead of the head), facing `h` (default: its heading). */
function mouth(a: Ant, h = a.h): { x: number; y: number } {
  const L = casteOf(a.caste).length;
  return { x: a.x + dcos(h) * L * 0.5, y: a.y + dsin(h) * L * 0.5 };
}

/** A wall for orbs and the beam: on the surface a blocked cell or a bank (water is not a wall); in a nest, soil. */
export function blastWall(w: World, space: number, x: number, y: number): boolean {
  if (space === SURFACE) return w.terrain.isBlocked(x, y) || w.terrain.cliffAt(x, y);
  const g = w.nestOf(space);
  return !g || !g.isAir(Math.floor(x / g.cell), Math.floor(y / g.cell));
}

/** How far along (x0, y0) → (x1, y1) the first wall is, as a fraction (1: none), sampled every `step` mm. */
export function wallAlong(w: World, space: number, x0: number, y0: number, x1: number, y1: number, step = 1): number {
  const d = dhypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / step));
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    if (blastWall(w, space, x0 + (x1 - x0) * u, y0 + (y1 - y0) * u)) return (i - 1) / n;
  }
  return 1;
}

/** Can it fire at (tx, ty) from where it stands (no wall in the way)? */
export function fireClear(w: World, a: Ant, tx: number, ty: number): boolean {
  const m = mouth(a);
  return wallAlong(w, a.space, m.x, m.y, tx, ty, 1.5) >= 1;
}

/** Seconds between shots (gold: × the surge's attack rate; colony abilities). */
function interval(a: Ant, c: Colony): number {
  return B.interval / abilityMods(c).attackRate / (surging(a) ? BALANCE.surge.attackRateMul : 1);
}

/**
 * The shot (`AS.Spray` for a blaster): wind-up turning to aim, then an orb — or, the fifth shot in the gold form, the
 * beam — then the recovery. Returns true while it is busy.
 */
export function blastShot(w: World, a: Ant, c: Colony, dt: number, tx: number, ty: number, alive: boolean): boolean {
  a.v = 0;
  a.anc = Math.max(a.anc ?? 0, 1e-6);
  a.pose = POSE.SPRAY;
  if (a.st < B.windup - 1e-6) {
    if (alive) {
      const want = datan2(ty - a.y, tx - a.x);
      turnToward(a, want, dt, BALANCE.combat21.windupTurn * 1.6);
    }
    return true;
  }
  if (a.cd2 <= 0) {
    if (!alive) {
      // the target died during the wind-up: no shot
      a.state = AS.Attack;
      a.st = 0;
      return true;
    }
    const gold = surging(a);
    a.shotN = gold ? (a.shotN ?? 0) + 1 : 0;
    if (gold && a.shotN >= B.beamEvery) {
      a.shotN = 0;
      startBeam(w, a, c, tx, ty);
      return true;
    }
    fireOrb(w, a, c, tx, ty, gold);
    a.cd2 = interval(a, c);
  }
  if (a.st > B.shotDone) {
    a.state = AS.Attack;
    a.st = 0;
  }
  return true;
}

/** An orb from the mouth, straight at (tx, ty). */
function fireOrb(w: World, a: Ant, c: Colony, tx: number, ty: number, gold: boolean): void {
  const m = mouth(a);
  const ang = datan2(ty - m.y, tx - m.x);
  const v = B.orbSpeed;
  w.addProjectile({
    id: w.nextId(),
    kind: 'orb',
    space: a.space,
    x: m.x,
    y: m.y,
    vx: dcos(ang) * v,
    vy: dsin(ang) * v,
    t: 0,
    dmg: B.orbDamage * biteMul(w, a, c),
    colony: a.colony,
    tgt: a.tgt,
    tk: a.tk,
    life: (B.range * B.orbLife) / v,
    gold: gold || undefined,
    by: a.id,
  });
  w.events.emit({ t: 'orb', x: m.x, y: m.y, tx, ty, space: a.space, id: a.id, gold: gold || undefined });
}

/**
 * One tick of an orb (combat.projectileSystem): the first enemy its path touched this tick takes the hit — unless a
 * wall came first. Returns true when the orb is spent.
 */
export function orbStep(w: World, p: Projectile, x0: number, y0: number): boolean {
  const dx = p.x - x0;
  const dy = p.y - y0;
  const L2 = dx * dx + dy * dy;
  const seg = Math.sqrt(L2);
  const wallU = wallAlong(w, p.space, x0, y0, p.x, p.y, 0.75);
  const team = w.teamOf(p.colony);
  const r0 = B.orbRadius;
  // the nearest enemy along the way: smallest u, ties by id
  let bestU = 2;
  let bestAnt: Ant | null = null;
  let bestCr = -1;
  const along = (x: number, y: number, reach: number): number => {
    const u = L2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / L2 : 1;
    const uc = u < 0 ? 0 : u > 1 ? 1 : u;
    const d2 = sq(x0 + dx * uc - x) + sq(y0 + dy * uc - y);
    return d2 < reach * reach ? uc : 2;
  };
  w.antsNear(p.space, (x0 + p.x) / 2, (y0 + p.y) / 2, seg / 2 + 12, (o) => {
    if (o.state === AS.Dead || (o.team ?? o.colony) === team || riding(o)) return false;
    const u = along(o.x, o.y, casteOf(o.caste).length * 0.45 + r0);
    if (u < bestU || (u === bestU && bestAnt && o.id < bestAnt.id)) {
      bestU = u;
      bestAnt = o;
    }
    return false;
  });
  for (const cr of w.s.creatures) {
    if (cr.dead || cr.space !== p.space || friendlyCreature(w, team, cr)) continue;
    const u = along(cr.x, cr.y, creatureHooks.radius(cr) + r0);
    if (u < bestU) {
      bestU = u;
      bestAnt = null;
      bestCr = cr.id;
    }
  }
  if (bestU <= 1 && bestU <= wallU) {
    const hx = x0 + dx * bestU;
    const hy = y0 + dy * bestU;
    const by = p.by ? w.antById.get(p.by) : undefined;
    const src = by && by.state !== AS.Dead ? by : null;
    if (bestAnt) damageAnt(w, bestAnt, p.dmg, 'blast', src);
    else {
      const cr = w.creatureById.get(bestCr);
      if (cr) damageCreature(w, cr, p.dmg, 'blast', src);
    }
    w.events.emit({ t: 'orbHit', x: hx, y: hy, space: p.space, gold: p.gold || undefined });
    return true;
  }
  if (wallU < 1) {
    w.events.emit({ t: 'orbFizz', x: x0 + dx * wallU, y: y0 + dy * wallU, space: p.space, gold: p.gold || undefined, wall: true });
    return true;
  }
  if (p.t >= (p.life ?? 0.4)) {
    w.events.emit({ t: 'orbFizz', x: p.x, y: p.y, space: p.space, gold: p.gold || undefined });
    return true;
  }
  return false;
}

/** The enemies a beam from (x0, y0) along heading h, `len` long, crosses (calls `hit` for each; returns how many). */
function beamCrosses(w: World, a: Ant, x0: number, y0: number, h: number, len: number, hit?: (o: Ant | null, crId: number) => void): number {
  const ux = dcos(h);
  const uy = dsin(h);
  const team = w.teamOf(a.colony);
  let n = 0;
  const on = (x: number, y: number, r: number): boolean => {
    const t = (x - x0) * ux + (y - y0) * uy;
    if (t < -r || t > len + r) return false;
    const off = Math.abs((x - x0) * uy - (y - y0) * ux);
    return off < B.beamHalfWidth + r;
  };
  const found: Ant[] = [];
  w.antsNear(a.space, x0 + ux * len * 0.5, y0 + uy * len * 0.5, len * 0.5 + 12, (o) => {
    if (o.state === AS.Dead || (o.team ?? o.colony) === team || riding(o)) return false;
    if (on(o.x, o.y, casteOf(o.caste).length * 0.4)) found.push(o);
    return false;
  });
  // (in id order: the same hits in the same order on every client)
  found.sort((p, q) => p.id - q.id);
  for (const o of found) {
    n++;
    hit?.(o, -1);
  }
  for (const cr of w.s.creatures) {
    if (cr.dead || cr.space !== a.space || friendlyCreature(w, team, cr)) continue;
    if (on(cr.x, cr.y, creatureHooks.radius(cr))) {
      n++;
      hit?.(null, cr.id);
    }
  }
  return n;
}

/** The beam's reach along heading h from the mouth: `beamReach` × its length, or to the first wall. */
function beamLength(w: World, a: Ant, x0: number, y0: number, h: number): number {
  const L = casteOf(a.caste).length * B.beamReach;
  return L * wallAlong(w, a.space, x0, y0, x0 + dcos(h) * L, y0 + dsin(h) * L, 1);
}

/**
 * Aim the beam at the densest line of enemies in reach: a heading toward each of the nearest `beamCandidates` enemies
 * (the target first), scored by how many the beam would cross; the first best wins.
 */
export function aimBeam(w: World, a: Ant, tx: number, ty: number): number {
  const reach = casteOf(a.caste).length * B.beamReach;
  const team = w.teamOf(a.colony);
  // (headings from the ant's centre: it turns on the spot, so the mouth ends up on the same line)
  const cands: Array<{ d2: number; id: number; h: number }> = [];
  w.antsNear(a.space, a.x, a.y, reach, (o, d2) => {
    if (o.state === AS.Dead || (o.team ?? o.colony) === team || riding(o)) return false;
    cands.push({ d2, id: o.id, h: datan2(o.y - a.y, o.x - a.x) });
    return false;
  });
  for (const cr of w.s.creatures) {
    if (cr.dead || cr.space !== a.space || friendlyCreature(w, team, cr)) continue;
    const d2 = sq(cr.x - a.x) + sq(cr.y - a.y);
    if (d2 < reach * reach) cands.push({ d2, id: 1e9 + cr.id, h: datan2(cr.y - a.y, cr.x - a.x) });
  }
  cands.sort((p, q) => p.d2 - q.d2 || p.id - q.id);
  const heads = [datan2(ty - a.y, tx - a.x), ...cands.slice(0, B.beamCandidates).map((c) => c.h)];
  let best = heads[0];
  let bestN = -1;
  for (const h of heads) {
    const m = mouth(a, h);
    const n = beamCrosses(w, a, m.x, m.y, h, beamLength(w, a, m.x, m.y, h));
    if (n > bestN) {
      bestN = n;
      best = h;
    }
  }
  return best;
}

/** The fifth gold shot: plant and fire the beam. */
function startBeam(w: World, a: Ant, c: Colony, tx: number, ty: number): void {
  const h = aimBeam(w, a, tx, ty);
  a.h = h;
  const m = mouth(a);
  a.beamH = h;
  a.beamL = beamLength(w, a, m.x, m.y, h);
  a.beamT = B.beamTime;
  a.beamD = B.beamDamage * biteMul(w, a, c);
  a.beamP = 0;
  a.st = 0;
  a.v = 0;
  w.events.emit({ t: 'beam', x: m.x, y: m.y, h, len: a.beamL, space: a.space, id: a.id });
}

/**
 * A beam under way (antAI, before anything else the ant might do): planted and facing along it; a pulse every
 * `beamTick`. Returns false once the beam is over (or was broken), so the ant's turn goes on as usual.
 */
export function beamUpdate(w: World, a: Ant, c: Colony, dt: number): boolean {
  if (a.state === AS.Dead || a.state === AS.Flung || a.heldBy || riding(a)) {
    stopBeam(w, a);
    return false;
  }
  a.v = 0;
  a.h = a.beamH ?? a.h;
  a.anc = Math.max(a.anc ?? 0, 1e-6);
  a.pose = POSE.SPRAY;
  if (a.state !== AS.Spray) {
    a.state = AS.Spray;
    a.st = 0;
  }
  if ((a.beamP ?? 0) <= 1e-6) {
    const m = mouth(a);
    const dmg = a.beamD ?? B.beamDamage;
    beamCrosses(w, a, m.x, m.y, a.beamH ?? a.h, a.beamL ?? 0, (o, crId) => {
      if (o) damageAnt(w, o, dmg, 'blast', a);
      else {
        const cr = w.creatureById.get(crId);
        if (cr) damageCreature(w, cr, dmg, 'blast', a);
      }
    });
    a.beamP = (a.beamP ?? 0) + B.beamTick;
  }
  a.beamP = (a.beamP ?? 0) - dt;
  // (snapped within a millionth so 3 s is exactly 60 ticks despite float steps, as the surge)
  if ((a.beamT ?? 0) - dt <= 1e-6) {
    stopBeam(w, a);
    a.cd2 = Math.max(a.cd2, B.beamCooldown);
    a.state = AS.Attack;
    a.st = 0;
    void c;
    return true;
  }
  a.beamT = (a.beamT ?? 0) - dt;
  return true;
}

/** The beam ends (its time is up, or it was broken: a fling, a grab, death). */
export function stopBeam(w: World, a: Ant): void {
  if ((a.beamT ?? 0) <= 0) return;
  a.beamT = 0;
  a.beamP = 0;
  w.events.emit({ t: 'beamEnd', x: a.x, y: a.y, space: a.space, id: a.id });
}
