import { World } from '../world';
import { HF_CREATURE } from '../../world/surfaceLayout';
import { Ant, AS, Creature, SURFACE } from '../types';
import { casteOf } from '../species';
import { ARENA, BALANCE, ECITON, TERMANT } from '../balance';
import { enforceMountRatio, riding, throwRiders } from '../climbing';
import { climbCap } from './climb';
import { applyVenom, creatureHooks, damageAnt, damageCreature, flingAnt } from '../combat';
import { STANCE, arenaTeam, stanceOf } from '../arenaState';
import { killAnt } from '../antAI';
import { Body, bodyHook } from '../slots';
import { makeCreature, makeFood } from '../factory';
import { CREATURES, CreatureKind, creatureKind, wildKinds } from './kinds';
import { datan2, dcos, dhypot, dsin, sq } from '../dmath';

/**
 * Creature behaviour (Phase 10, DESIGN 3.10). One program per species,
 * following its real hunting style: ambush (mantis, antlion pit),
 * stalk-and-pounce (wolf spider), pursuit (ground beetle, centipede, rove
 * beetle), passive (pill bug rolls into a ball, cutworm curls). Predators
 * hold a territory round their cover and flee there when badly hurt. Bosses
 * run phases with telegraphed attacks: a wind-up pose plus a ground marker
 * (the `telegraph` event) before every big attack.
 *
 * Creatures attack ants of every colony (in the battle arena, of every other team — and the other teams'
 * creatures: `arenaCreature`). Ants latched on to a creature slow
 * it in proportion to their grip against its strength; big creatures shake
 * them off and fling them.
 */

/** Creature states (`cr.state`), read by the renderer for poses. */
export const CS = {
  Wander: 0,
  Chase: 1,
  Attack: 2,
  Flee: 3,
  Rolled: 4,
  Curled: 5,
  Freeze: 6,
  Pounce: 7,
  WindUp: 8,
  Eat: 9,
  Display: 10,
  Lurk: 11,
  Hide: 12,
  Coil: 13,
  Whip: 14,
  Rear: 15,
  Flick: 16,
  Leap: 17,
  Strike: 18,
} as const;

const TAU = Math.PI * 2;

const sqd = (x: number, y: number) => x * x + y * y;

function angleTo(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Is this ant latched on to the creature (planted beside it: user note 2026-10-25) or riding it? The
 * creature does not turn to face these (it bites them where they are, or shakes them off): turning toward
 * ants all round its body would only spin it.
 */
function onBody(cr: Creature, a: Ant): boolean {
  return (a.state === AS.Grapple && a.gKind === 4 && a.gId === cr.id) || a.rideId === cr.id;
}

/**
 * Turn toward an angle at most `rate` rad/s, ignoring the last few degrees
 * (fix brief: stable facing, no spinning).
 */
function turnCreature(cr: Creature, want: number, dt: number, rate: number): void {
  const diff = angleTo(cr.h, want);
  if (Math.abs(diff) < BALANCE.combat.deadZone) return;
  cr.h += Math.max(-rate * dt, Math.min(rate * dt, diff));
}

/**
 * Face an ant. Not one latched on or riding: turning toward the ants round its
 * body would only spin it (the beetle spin). Those are bitten where they are,
 * or shaken off.
 */
function faceAnt(cr: Creature, a: Ant, dt: number, rate: number): void {
  if (onBody(cr, a)) return;
  const dx = a.x - cr.x;
  const dy = a.y - cr.y;
  if (dx * dx + dy * dy < 0.25) return;
  turnCreature(cr, datan2(dy, dx), dt, rate);
}

function setState(cr: Creature, s: number): void {
  if (cr.state === s) return;
  cr.state = s;
  cr.st = 0;
}

/** Hit radius (mm) ants latch round, by body plan. */
export function creatureRadius(cr: Creature): number {
  const k = creatureKind(cr.kind);
  if (!k) return cr.scale * 0.4;
  switch (k.ai) {
    case 'centipede':
    case 'scolopendra':
      return k.length * 0.09;
    case 'caterpillar':
      return k.length * 0.14;
    case 'mantis':
    case 'giantMantis':
      return k.length * 0.12;
    case 'antlion':
      return k.length * 0.5;
    case 'stag':
      return k.length * 0.24;
    case 'tarantula':
    case 'hogna':
    case 'stalker':
    case 'spiderling':
      return k.length * 0.42;
    default:
      return k.length * 0.36;
  }
}

/**
 * The body outline as a capsule (attack slots, soft collision, climbing):
 * radius = half its body width, half-length of the straight middle part as a
 * fraction of its length (long bodies: centipedes, caterpillars, mantises).
 */
const BODY_HALF: Partial<Record<string, number>> = { centipede: 0.41, scolopendra: 0.41, caterpillar: 0.36, mantis: 0.36, giantMantis: 0.36, rove: 0.3, stag: 0.22, hunter: 0.12, passiveRoller: 0.08, antlion: 0, tarantula: 0.08, hogna: 0.08, stalker: 0.08, spiderling: 0.06 };
export function creatureBody(cr: Creature): Body {
  const k = creatureKind(cr.kind);
  const r = creatureRadius(cr);
  if (!k) return { hl: 0, r };
  return { hl: Math.max(0, k.length * (BODY_HALF[k.ai] ?? 0.12)), r };
}

/** Is this point walkable for a creature (surface: dry ground; underground: dug floor)? */
function walkable(w: World, cr: Creature, x: number, y: number): boolean {
  if (cr.space === SURFACE) return w.terrain.inBounds(x, y, 4) && w.terrain.passable(x, y);
  return w.walkable(cr.space, x, y);
}

/** Speed left over when latched ants hold on. */
function holdMul(cr: Creature, k: CreatureKind): number {
  return Math.max(k.boss ? 0.35 : 0.12, 1 - cr.latchGrip / Math.max(1, k.strength));
}

/** Turn toward a point and walk; returns the remaining distance. */
function walkTo(w: World, cr: Creature, k: CreatureKind, tx: number, ty: number, speedMul: number, dt: number, turnRate = 5): number {
  const dx = tx - cr.x;
  const dy = ty - cr.y;
  const d = dhypot(dx, dy);
  if (d < 0.5) {
    cr.v = 0;
    return d;
  }
  const want = datan2(dy, dx);
  const diff = angleTo(cr.h, want);
  cr.h += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
  // glued by a termite major or pinned in a hell ant's jaws: it can turn and bite, not walk
  if ((cr.data.root ?? 0) > w.s.tick) {
    cr.v = 0;
    return d;
  }
  const facing = Math.max(0.2, dcos(diff));
  let sp = k.speed * speedMul * facing * holdMul(cr, k);
  if (cr.slowT > 0) sp *= 0.5;
  if ((cr.glueT ?? 0) > w.s.tick) sp *= TERMANT.glue.slowMul; // glued by a Termant soldier
  if (k.nocturnal) sp *= 0.75 + 0.35 * w.s.night;
  const step = Math.min(sp * dt, d);
  const nx = cr.x + dcos(cr.h) * step;
  const ny = cr.y + dsin(cr.h) * step;
  if (walkable(w, cr, nx, ny)) {
    cr.x = nx;
    cr.y = ny;
    cr.v = step / Math.max(dt, 1e-3);
  } else {
    // slide round obstacles
    const side = dsin(cr.id) > 0 ? 1 : -1;
    cr.h += side * 1.2 * dt * 4;
    cr.v = 0;
  }
  return d;
}

/** Live ants within r of a point in the creature's space; the best by score (lower is better). */
function pickAnt(w: World, cr: Creature, x: number, y: number, r: number, score?: (a: Ant, d2: number) => number): Ant | null {
  let best: Ant | null = null;
  let bs = Infinity;
  const reach = creatureRadius(cr) + 3;
  const team = cr.faction >= 0 ? w.teamOf(cr.faction) : -1;
  w.antsNear(cr.space, x, y, r, (a, d2) => {
    if (a.state === AS.Dead || a.state === AS.Flung || riding(a) || casteOf(a.caste).role === 'king') return false;
    if (team >= 0 && (a.team ?? a.colony) === team) return false; // battle arena: its own team
    if (onBody(cr, a) && d2 > reach * reach) return false;
    // ants ahead count as nearer than ants behind (one straight behind as √2 × as far): with a ring of
    // ants round it, the nearest flips from side to side every tick and the creature spun on the spot
    const off = Math.abs(angleTo(cr.h, datan2(a.y - cr.y, a.x - cr.x))) / Math.PI;
    const s = (score ? score(a, d2) : d2) * (1 + BALANCE.creatureFrontBias * off);
    if (s < bs) {
      bs = s;
      best = a;
    }
    return false;
  });
  return best;
}

function antsIn(w: World, cr: Creature, x: number, y: number, r: number, cone?: { dir: number; half: number }): Ant[] {
  const out: Ant[] = [];
  const team = cr.faction >= 0 ? w.teamOf(cr.faction) : -1;
  w.antsNear(cr.space, x, y, r, (a) => {
    if (a.state === AS.Dead || riding(a)) return false;
    if (team >= 0 && (a.team ?? a.colony) === team) return false; // battle arena: its own team
    if (cone) {
      const ang = datan2(a.y - y, a.x - x);
      if (Math.abs(angleTo(cone.dir, ang)) > cone.half) return false;
    }
    out.push(a);
    return false;
  });
  return out;
}

function bite(w: World, cr: Creature, k: CreatureKind, a: Ant, mul = 1): void {
  // (a battle-arena creature's level multiplies its bite: data.power)
  damageAnt(w, a, k.bite * mul * (cr.data.power ?? 1), 'bite', cr);
  if (k.venom) applyVenom(w, a, k.venom.dps, k.venom.duration, k.venom.maxStacks);
  w.events.emit({ t: 'bite', x: a.x, y: a.y, space: a.space, strength: Math.min(1, (k.bite * mul) / 20), by: cr.kind, on: 'ant' });
}

/** Ants holding on to this creature. */
function latchedAnts(w: World, cr: Creature): Ant[] {
  const out: Ant[] = [];
  w.antsNear(cr.space, cr.x, cr.y, creatureRadius(cr) + 12, (a) => {
    if (a.state === AS.Grapple && a.gKind === 4 && a.gId === cr.id) out.push(a);
    return false;
  });
  return out;
}

/** Shake off up to n latched ants, flinging them (an army-ant Soldier's hook comes loose only `hook.dislodge` of the time). */
function shakeOff(w: World, cr: Creature, n: number, power: number): number {
  const ants = latchedAnts(w, cr);
  let k = 0;
  for (const a of ants) {
    if (k >= n) break;
    const hook = casteOf(a.caste).hook;
    if (hook && w.rng.next() >= hook.dislodge) continue;
    flingAnt(w, a, cr.x, cr.y, power);
    k++;
  }
  return k;
}

function telegraph(w: World, cr: Creature, x: number, y: number, radius: number, duration: number, cone?: { dir: number; half: number }): void {
  w.events.emit({ t: 'telegraph', x, y, space: cr.space, radius, duration, creature: cr.id, dir: cone?.dir, half: cone?.half });
}

// ---------------------------------------------------------------------------
// Combat v2 (CHANGE_PLAN §16 step 7): threat, aimed splash attacks, backing off, shaking riders off
// ---------------------------------------------------------------------------

const C2 = BALANCE.combat2;

/** An ant hurt it: its threat grows by the damage × (1 + its caste's threat); the weakest entry gives way when full. */
function addThreat(cr: Creature, a: Ant, dmg: number): void {
  const v = dmg * (1 + (casteOf(a.caste).threat ?? 0));
  if (!(v > 0)) return;
  const t = cr.thr ?? (cr.thr = []);
  for (let i = 0; i < t.length; i += 2)
    if (t[i] === a.id) {
      t[i + 1] += v;
      return;
    }
  if (t.length < C2.threatMax * 2) {
    t.push(a.id, v);
    return;
  }
  let lo = 0;
  for (let i = 2; i < t.length; i += 2) if (t[i + 1] < t[lo + 1]) lo = i;
  if (t[lo + 1] < v) {
    t[lo] = a.id;
    t[lo + 1] = v;
  }
}

/** Threat fades (`threatDecay` a second); entries of the dead or gone, or nearly forgotten, are dropped. */
function decayThreat(w: World, cr: Creature, dt: number): void {
  const t = cr.thr;
  if (!t || t.length === 0) return;
  const k = Math.max(0, 1 - C2.threatDecay * dt);
  let j = 0;
  for (let i = 0; i < t.length; i += 2) {
    const a = w.antById.get(t[i]);
    const v = t[i + 1] * k;
    if (!a || a.state === AS.Dead || v < 0.05) continue;
    t[j] = t[i];
    t[j + 1] = v;
    j += 2;
  }
  t.length = j;
}

/**
 * Retaliation (EotU): the ant with the most threat within `reach` of it (not riders: they are untouchable), sticky —
 * it changes from its current target only for `threatSticky` × that one's threat. Null when nobody with threat is in
 * reach (then the program picks as before: the nearest, or a cluster).
 */
function threatPick(w: World, cr: Creature, reach: number): Ant | null {
  const t = cr.thr;
  if (!t || t.length === 0) return null;
  const team = cr.faction >= 0 ? w.teamOf(cr.faction) : -1;
  let best: Ant | null = null;
  let bv = 0;
  let curV = 0;
  let cur: Ant | null = null;
  for (let i = 0; i < t.length; i += 2) {
    const a = w.antById.get(t[i]);
    if (!a || a.state === AS.Dead || a.state === AS.Flung || a.space !== cr.space || riding(a)) continue;
    if (team >= 0 && (a.team ?? a.colony) === team) continue;
    if (sqd(a.x - cr.x, a.y - cr.y) > reach * reach) continue;
    if (cr.tk === 3 && a.id === cr.tgt) {
      cur = a;
      curV = t[i + 1];
    }
    if (t[i + 1] > bv) {
      bv = t[i + 1];
      best = a;
    }
  }
  if (cur && best && best !== cur && bv < curV * C2.threatSticky) return cur;
  return best;
}

/** Ground ants (not riders, not its own team) round the creature, counted per direction (scratch). */
const aimCount: number[] = []; // det-ok: scratch, filled and read within one call
const aimOut = { dir: 0, n: 0 }; // det-ok: scratch result

/**
 * Aim a splash attack (combat v2): of `combat2.aimDirs` directions round the creature (from its heading), the one
 * whose cone (`half` rad each side) holds the most ground ants within `reach` — ants counted in id order; ties to the
 * direction nearest its heading. The creature turns there before it strikes.
 */
function aimDir(w: World, cr: Creature, reach: number, half: number): { dir: number; n: number } {
  const N = C2.aimDirs;
  aimCount.length = N;
  for (let k = 0; k < N; k++) aimCount[k] = 0;
  const team = cr.faction >= 0 ? w.teamOf(cr.faction) : -1;
  w.antsNear(cr.space, cr.x, cr.y, reach, (a) => {
    if (a.state === AS.Dead || a.state === AS.Flung || riding(a)) return false;
    if (team >= 0 && (a.team ?? a.colony) === team) return false;
    const ang = datan2(a.y - cr.y, a.x - cr.x);
    for (let k = 0; k < N; k++) if (Math.abs(angleTo(cr.h + (k * TAU) / N, ang)) <= half) aimCount[k]++;
    return false;
  });
  let best = 0;
  // ties to the direction nearest its heading: 0, 1, N−1, 2, N−2, …
  for (let s = 1; s < N; s++) {
    const k = s % 2 ? (s + 1) / 2 : N - s / 2;
    if (aimCount[k] > aimCount[best]) best = k;
  }
  aimOut.dir = cr.h + (best * TAU) / N;
  aimOut.n = aimCount[best];
  return aimOut;
}

/**
 * Surrounded and hurt (`surroundN` ground ants within `surroundR` × its length, under `backOffHp` of its health):
 * it backs off `backOffLen` × its length from the crowd over half a second (not turning round), then fights on.
 * Returns true while it is backing off.
 */
function backOff(w: World, cr: Creature, k: CreatureKind, dt: number): boolean {
  // (between attacks only: combat v2.1)
  if ((cr.data.backT ?? 0) <= 0 && creatureAttacking(cr)) return false;
  if ((cr.data.backT ?? 0) > 0) {
    cr.data.backT = Math.max(0, (cr.data.backT ?? 0) - dt);
    const step = ((C2.backOffLen * k.length) / 0.5) * dt;
    const h = cr.data.backH ?? cr.h;
    const nx = cr.x + dcos(h) * step;
    const ny = cr.y + dsin(h) * step;
    if (walkable(w, cr, nx, ny)) {
      cr.x = nx;
      cr.y = ny;
      cr.v = step / Math.max(dt, 1e-3);
    } else cr.v = 0;
    return true;
  }
  if ((cr.data.backCd ?? 0) > 0) {
    cr.data.backCd = Math.max(0, (cr.data.backCd ?? 0) - dt);
    return false;
  }
  if (hurtFrac(cr) >= C2.backOffHp) return false;
  let n = 0;
  let sx = 0;
  let sy = 0;
  const team = cr.faction >= 0 ? w.teamOf(cr.faction) : -1;
  w.antsNear(cr.space, cr.x, cr.y, k.length * C2.surroundR, (a) => {
    if (a.state === AS.Dead || riding(a) || (team >= 0 && (a.team ?? a.colony) === team)) return false;
    n++;
    sx += a.x;
    sy += a.y;
    return false;
  });
  if (n < C2.surroundN) return false;
  cr.data.backH = datan2(cr.y - sy / n, cr.x - sx / n);
  cr.data.backT = 0.5;
  cr.data.backCd = 5;
  return true;
}

/**
 * A titan's shake-off (combat v2): once riders are `shakeAtFrac` of its cap, at most every `shakeEverySec`, it
 * telegraphs (`shakeWind` s, in the pose `state`: the stag beetle rears and shakes, the tarantula and the wolf-spider
 * mother rear up, the giant centipede thrashes, the giant mantis flares its wings) and throws every rider down.
 * Returns true while it is shaking.
 */
function riderShake(w: World, cr: Creature, dt: number, state: number): boolean {
  if (cr.data.shake) {
    cr.v = 0;
    if (cr.data.shake === 1 && cr.st >= C2.shakeWind) {
      cr.data.shake = 2;
      const n = throwRiders(w, cr, 1.4);
      w.events.emit({ t: 'slam', x: cr.x, y: cr.y, space: cr.space, radius: cr.scale * 0.6, power: Math.min(1, 0.3 + n * 0.06) });
    }
    if (cr.st >= C2.shakeWind + 0.5) {
      cr.data.shake = 0;
      cr.data.shakeCd = C2.shakeEverySec;
      setState(cr, CS.Chase);
    }
    return true;
  }
  cr.data.shakeCd = Math.max(0, (cr.data.shakeCd ?? C2.shakeEverySec * 0.5) - dt);
  const cap = climbCap(cr);
  if (cap <= 0 || cr.data.shakeCd > 0 || (cr.climbers ?? 0) < Math.max(1, Math.ceil(cap * C2.shakeAtFrac - 1e-9))) return false;
  setState(cr, state);
  cr.data.shake = 1;
  telegraph(w, cr, cr.x, cr.y, cr.scale * 0.6, C2.shakeWind);
  return true;
}

// ---------------------------------------------------------------------------
// Combat v2.1 (CHANGE_PLAN §17): anchored creature attacks
// ---------------------------------------------------------------------------

/** States in which a creature is in an attack — still, or on a planned lunge — and no other creature moves it. */
const ATTACKING = new Set<number>([CS.WindUp, CS.Attack, CS.Strike, CS.Pounce, CS.Coil, CS.Whip, CS.Rear, CS.Flick, CS.Display, CS.Leap, CS.Eat]); // det-ok: constant

/** In an attack, from the wind-up to the end of its recovery (or holding its catch, or shaking riders off)? */
export function creatureAttacking(cr: Creature): boolean {
  return ATTACKING.has(cr.state) || !!cr.data.shake;
}

/** Start a bite on ant `a`: a wind-up of `wind` s (CS.WindUp, still, turning slowly toward it), then the bite. */
function startBite(cr: Creature, a: Ant, wind = BALANCE.combat21.crWindupSec): void {
  cr.tgt = a.id;
  cr.tk = 3;
  setState(cr, CS.WindUp);
  cr.data.bw = wind;
}

/**
 * A bite under way (startBite): in the wind-up the creature stands still and turns toward its ant at most
 * `crWindupTurn`; then the bite (CS.Attack) — a miss if the ant has left `reach`, it never follows — and a recovery of
 * `crRecoverSec`, still, facing locked. `fling` > 0 throws the bitten ant. Returns true while the bite lasts.
 */
function biteSeq(w: World, cr: Creature, k: CreatureKind, reach: number, dt: number, mul = 1, fling = 0): boolean {
  const C21 = BALANCE.combat21;
  if (cr.state === CS.WindUp && (cr.data.bw ?? 0) > 0) {
    cr.v = 0;
    const a = cr.tk === 3 && cr.tgt ? w.antById.get(cr.tgt) : undefined;
    const live = a && a.state !== AS.Dead && a.space === cr.space && !riding(a) ? a : null;
    if (live) faceAnt(cr, live, dt, C21.crWindupTurn);
    if (cr.st >= (cr.data.bw ?? 0) - 1e-9) {
      cr.data.bw = 0;
      setState(cr, CS.Attack);
      cr.cd = k.attackInterval;
      if (live && dhypot(live.x - cr.x, live.y - cr.y) < reach) {
        bite(w, cr, k, live, mul);
        if (fling > 0 && live.state !== AS.Dead) flingAnt(w, live, cr.x, cr.y, fling);
      }
    }
    return true;
  }
  if (cr.state === CS.Attack) {
    cr.v = 0;
    if (cr.st >= C21.crRecoverSec - 1e-9) setState(cr, CS.Chase);
    return true;
  }
  return false;
}

/**
 * A planned lunge (pounce, leap, strike): straight on along its heading to (tx, ty), at `speedMul` × its speed, never
 * turning. Returns the distance left.
 */
function lunge(w: World, cr: Creature, k: CreatureKind, speedMul: number, dt: number): number {
  const d = dhypot(cr.tx - cr.x, cr.ty - cr.y);
  const step = Math.min(d, k.speed * speedMul * dt);
  const nx = cr.x + dcos(cr.h) * step;
  const ny = cr.y + dsin(cr.h) * step;
  if (step > 0 && walkable(w, cr, nx, ny)) {
    cr.x = nx;
    cr.y = ny;
    cr.v = step / Math.max(dt, 1e-3);
  } else cr.v = 0;
  return d - step;
}

/** A held prey ant: kept in the creature's jaws, drained, then killed. */
function holdPrey(w: World, cr: Creature, k: CreatureKind, dt: number, reach: number): boolean {
  const a = cr.tgt ? w.antById.get(cr.tgt) : undefined;
  if (!a || a.state === AS.Dead || cr.tk !== 3) {
    cr.tgt = 0;
    return false;
  }
  a.x = cr.x + dcos(cr.h) * reach;
  a.y = cr.y + dsin(cr.h) * reach;
  a.v = 0;
  a.stun = Math.max(a.stun, 0.3);
  a.pinned = Math.max(a.pinned, 0.3);
  a.hp -= (k.bite * 0.5 + 4) * dt;
  if (a.hp <= 0) killAnt(w, a);
  return true;
}

// ---------------------------------------------------------------------------
// Behaviour programs
// ---------------------------------------------------------------------------

function wanderHome(w: World, cr: Creature, k: CreatureKind, dt: number, range: number, speedMul = 0.6): void {
  if (cr.st > 3 + (cr.v2 * 4) || dhypot(cr.tx - cr.x, cr.ty - cr.y) < 3) {
    for (let i = 0; i < 8; i++) {
      const ang = w.rng.range(0, TAU);
      const r = w.rng.range(range * 0.2, range);
      const x = cr.homeX + dcos(ang) * r;
      const y = cr.homeY + dsin(ang) * r;
      if (walkable(w, cr, x, y)) {
        cr.tx = x;
        cr.ty = y;
        break;
      }
    }
    cr.st = 0;
  }
  walkTo(w, cr, k, cr.tx, cr.ty, speedMul, dt, 3);
}

function fleeHome(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  const d = walkTo(w, cr, k, cr.homeX, cr.homeY, 1.1, dt);
  if (d < 6) {
    setState(cr, CS.Hide);
    cr.data.hideT = 20;
  }
}

function hurtFrac(cr: Creature): number {
  return cr.hp / cr.maxHp;
}

function passiveRoller(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  if (cr.state === CS.Rolled) {
    cr.v = 0;
    // unroll after a calm spell
    if ((cr.data.hitT ?? 0) <= 0 && cr.st > 6) setState(cr, CS.Wander);
    return;
  }
  if ((cr.data.hitT ?? 0) > 0 || cr.latched > 0) {
    setState(cr, CS.Rolled);
    shakeOff(w, cr, 99, 0.6);
    return;
  }
  wanderHome(w, cr, k, dt, 70, 0.7);
}

function caterpillar(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  if (cr.state === CS.Curled) {
    cr.v = 0;
    if (cr.cd <= 0 && cr.latched > 0) {
      // thrashes its head: an ant comes loose now and then
      shakeOff(w, cr, 1, 0.9);
      cr.cd = k.attackInterval;
    }
    if ((cr.data.hitT ?? 0) <= 0 && cr.st > 5) setState(cr, CS.Wander);
    return;
  }
  if ((cr.data.hitT ?? 0) > 0 || cr.latched > 1) {
    setState(cr, CS.Curled);
    return;
  }
  wanderHome(w, cr, k, dt, 90, 1);
}

/** Pursuit predators (ground beetle; also the core of rove and centipede). */
function hunter(w: World, cr: Creature, k: CreatureKind, dt: number, opts: { biteMul?: number; display?: boolean; dart?: boolean } = {}): void {
  if (cr.state === CS.Hide) {
    cr.v = 0;
    cr.hp = Math.min(cr.maxHp, cr.hp + cr.maxHp * 0.01 * dt);
    cr.data.hideT = (cr.data.hideT ?? 0) - dt;
    if (cr.data.hideT <= 0) setState(cr, CS.Wander);
    return;
  }
  if (k.fleeAt > 0 && hurtFrac(cr) < k.fleeAt && cr.state !== CS.Flee) {
    setState(cr, CS.Flee);
    shakeOff(w, cr, 2, 1);
  }
  if (cr.state === CS.Flee) {
    fleeHome(w, cr, k, dt);
    return;
  }
  // a crowd on its back: stop and shake them off
  if (cr.latched >= 3 && cr.cd2 <= 0) {
    shakeOff(w, cr, 1, 1);
    cr.cd2 = 1.6;
  }
  if (backOff(w, cr, k, dt)) return;
  const reach = creatureRadius(cr) + 3;
  // a bite under way: the wind-up (the rove beetle raises its tail, jaws open), the bite, the recovery (combat v2.1)
  if (biteSeq(w, cr, k, reach + (opts.display ? 4 : 2), dt, opts.biteMul ?? 1, opts.display ? 1.2 : 0)) return;
  const target = cr.tgt ? w.antById.get(cr.tgt) : undefined;
  let a: Ant | null = target && target.state !== AS.Dead && target.space === cr.space ? target : null;
  // retaliation: the ant with the most threat close by (sticky), else the nearest as before
  const th = threatPick(w, cr, reach + k.length * 0.5);
  if (th && th !== a) {
    a = th;
    cr.tgt = th.id;
    cr.tk = 3;
  } else if (!a || cr.st > 12) {
    // isolated ants are picked first
    a = pickAnt(w, cr, cr.x, cr.y, k.sense * (k.nocturnal ? 0.7 + 0.4 * w.s.night : 1), (o, d2) => d2 * (1 + 0.25 * Math.min(6, o.alarm * 6)));
    cr.tgt = a ? a.id : 0;
    cr.tk = a ? 3 : 0;
    if (cr.state === CS.Chase) cr.st = 0;
  }
  if (!a) {
    if (opts.dart) {
      // centipedes dart between bits of cover
      if (cr.st > 2.5 + cr.v2 * 2) {
        const ang = w.rng.range(0, TAU);
        cr.tx = cr.homeX + dcos(ang) * w.rng.range(20, 90);
        cr.ty = cr.homeY + dsin(ang) * w.rng.range(20, 90);
        cr.st = 0;
      }
      walkTo(w, cr, k, cr.tx, cr.ty, cr.st < 1.2 ? 1 : 0, dt, 7);
    } else wanderHome(w, cr, k, dt, 140, 0.55);
    if (cr.state !== CS.Wander) setState(cr, CS.Wander);
    return;
  }
  const d = dhypot(a.x - cr.x, a.y - cr.y);
  if (d > reach) {
    setState(cr, CS.Chase);
    walkTo(w, cr, k, a.x, a.y, 1, dt, 6);
    return;
  }
  // in reach, between bites: it stands and faces its ant; the next bite's wind-up starts so that the bite lands when
  // the timer is up (the rove beetle's display: a telegraphed 0.8 s, after the timer)
  cr.v = 0;
  faceAnt(cr, a, dt, 6);
  if (opts.display ? cr.cd <= 0 : cr.cd <= BALANCE.combat21.crWindupSec) {
    startBite(cr, a, opts.display ? 0.8 : BALANCE.combat21.crWindupSec);
    if (opts.display) telegraph(w, cr, a.x, a.y, 6, 0.8);
  }
}

/** Wolf spider: walk, freeze, turn to face, creep, then a sprint and pounce; pins and eats its prey. */
function stalker(w: World, cr: Creature, k: CreatureKind, dt: number, frenzy = 1): void {
  if (cr.state === CS.Hide) {
    cr.v = 0;
    cr.hp = Math.min(cr.maxHp, cr.hp + cr.maxHp * 0.01 * dt);
    cr.data.hideT = (cr.data.hideT ?? 0) - dt;
    if (cr.data.hideT <= 0) setState(cr, CS.Wander);
    return;
  }
  if (k.fleeAt > 0 && hurtFrac(cr) < k.fleeAt && cr.state !== CS.Flee) {
    setState(cr, CS.Flee);
    cr.tgt = 0;
  }
  if (cr.state === CS.Flee) {
    fleeHome(w, cr, k, dt);
    return;
  }
  if (cr.state === CS.Eat) {
    cr.v = 0;
    // it drags its catch out of the crowd first (backing away with it in its jaws)
    if ((cr.data.drag ?? 0) > 0) {
      const step = Math.min(cr.data.drag ?? 0, k.speed * 0.6 * dt);
      const nx = cr.x - dcos(cr.h) * step;
      const ny = cr.y - dsin(cr.h) * step;
      if (walkable(w, cr, nx, ny)) {
        cr.x = nx;
        cr.y = ny;
        cr.v = step / Math.max(dt, 1e-3);
        cr.data.drag = (cr.data.drag ?? 0) - step;
      } else cr.data.drag = 0;
    }
    if (!holdPrey(w, cr, k, dt, creatureRadius(cr) * 0.9) || cr.st > 3.5 || cr.latched >= 3) {
      cr.tgt = 0;
      cr.data.drag = 0;
      setState(cr, CS.Wander);
    }
    return;
  }
  if (cr.state === CS.Strike) {
    // the recovery after a pounce that caught nothing (combat v2.1)
    cr.v = 0;
    if (cr.st >= BALANCE.combat21.crRecoverSec) setState(cr, CS.Wander);
    return;
  }
  if (cr.state === CS.Pounce) {
    // a planned lunge: straight along the heading it had when it sprang (combat v2.1)
    const sp = 3 * frenzy;
    const d = lunge(w, cr, k, sp, dt);
    if (d < 2 || cr.st > 0.6) {
      const a = pickAnt(w, cr, cr.x + dcos(cr.h) * creatureRadius(cr), cr.y + dsin(cr.h) * creatureRadius(cr), creatureRadius(cr) + 5);
      if (a) {
        bite(w, cr, k, a);
        if (a.state !== AS.Dead) {
          cr.tgt = a.id;
          cr.tk = 3;
          // drag it out of the cluster (combat v2)
          cr.data.drag = C2.dragLen * k.length;
          setState(cr, CS.Eat);
          return;
        }
      }
      cr.cd = 1.2 / frenzy;
      setState(cr, CS.Strike);
    }
    return;
  }
  if (backOff(w, cr, k, dt)) return;
  const a = threatPick(w, cr, creatureRadius(cr) + 16) ?? pickAnt(w, cr, cr.x, cr.y, k.sense);
  if (a) {
    const d = dhypot(a.x - cr.x, a.y - cr.y);
    const face = datan2(a.y - cr.y, a.x - cr.x);
    if (cr.state === CS.WindUp) {
      // the wind-up: still, turning toward its prey at most crWindupTurn; it springs along the heading it then has
      cr.v = 0;
      faceAnt(cr, a, dt, BALANCE.combat21.crWindupTurn * frenzy);
      if (cr.st > 0.3 / frenzy) {
        cr.tx = cr.x + dcos(cr.h) * (d + 2);
        cr.ty = cr.y + dsin(cr.h) * (d + 2);
        setState(cr, CS.Pounce);
      }
      return;
    }
    void face;
    if (d < creatureRadius(cr) + 16 && cr.cd <= 0) {
      setState(cr, CS.WindUp);
      telegraph(w, cr, a.x, a.y, 5, 0.3 / frenzy);
      return;
    }
    // freeze, face, creep
    if (cr.state !== CS.Freeze && cr.state !== CS.Chase) setState(cr, CS.Freeze);
    if (cr.state === CS.Freeze) {
      cr.v = 0;
      faceAnt(cr, a, dt, 2.25);
      if (cr.st > (1.2 + cr.v2) / frenzy) setState(cr, CS.Chase);
      return;
    }
    walkTo(w, cr, k, a.x, a.y, 0.4 * frenzy, dt, 4);
    if (cr.st > 2.5) setState(cr, CS.Freeze);
    return;
  }
  // nothing seen: a few steps, then stand still
  if (cr.state === CS.Freeze) {
    cr.v = 0;
    if (cr.st > 1.5 + cr.v2 * 1.5) setState(cr, CS.Wander);
    return;
  }
  wanderHome(w, cr, k, dt, 120, 0.7);
  if (cr.st > 1.2 + cr.v2) setState(cr, CS.Freeze);
}

/** Mantis: motionless ambush with a swaying stance; strikes whatever enters reach and eats it. */
function mantis(w: World, cr: Creature, k: CreatureKind, dt: number, opts: { boss?: boolean } = {}): void {
  const reach = k.length * 0.42;
  const half = opts.boss ? 0.65 : 0.45;
  // the giant mantis flares its wings and throws its riders off (combat v2)
  if (opts.boss && cr.state !== CS.Flee && riderShake(w, cr, dt, CS.Display)) return;
  if (k.fleeAt > 0 && hurtFrac(cr) < k.fleeAt && cr.state !== CS.Flee) setState(cr, CS.Flee);
  if (cr.state === CS.Flee) {
    // walks off, then flies away
    walkTo(w, cr, k, cr.homeX + dcos(cr.v2 * TAU) * 400, cr.homeY + dsin(cr.v2 * TAU) * 400, 1, dt);
    if (cr.st > 6) {
      cr.dead = true;
      cr.data.gone = 1;
    }
    return;
  }
  if (cr.state === CS.Eat) {
    cr.v = 0;
    if (!holdPrey(w, cr, k, dt, reach * 0.5) || cr.st > 4) {
      cr.tgt = 0;
      setState(cr, CS.Lurk);
    }
    if (cr.latched >= (opts.boss ? 6 : 4)) {
      setState(cr, CS.Display);
      telegraph(w, cr, cr.x, cr.y, reach * 1.1, 0.8);
    }
    return;
  }
  if (cr.state === CS.Display) {
    // deimatic display: rears up, spreads the wings; ants in front freeze in fear
    cr.v = 0;
    if (cr.st >= 0.8 && !cr.data.shown) {
      cr.data.shown = 1;
      for (const a of antsIn(w, cr, cr.x, cr.y, reach * 1.1)) a.stun = Math.max(a.stun, opts.boss ? 2.5 : 1.5);
      shakeOff(w, cr, 4, 1.2);
    }
    if (cr.st > 1.6) {
      cr.data.shown = 0;
      cr.cd = 0;
      setState(cr, CS.Lurk);
    }
    return;
  }
  if (cr.state === CS.WindUp) {
    cr.v = 0;
    if (cr.st >= (opts.boss ? 0.6 : 0.35)) {
      // the strike: forelegs shoot out and snap shut in a fraction of a second
      const ants = antsIn(w, cr, cr.x, cr.y, reach + 3, { dir: cr.h, half });
      let prey: Ant | null = null;
      for (const a of ants) {
        if (!prey || (opts.boss ? a.maxHp > prey.maxHp : sq(a.x - cr.x) + sq(a.y - cr.y) < sq(prey.x - cr.x) + sq(prey.y - cr.y))) prey = a;
        if (opts.boss) damageAnt(w, a, 15, 'bite', cr);
      }
      setState(cr, CS.Strike);
      cr.cd = k.attackInterval * (opts.boss && hurtFrac(cr) < 0.4 ? 0.6 : 1);
      if (prey && prey.state !== AS.Dead) {
        bite(w, cr, k, prey);
        if ((prey.state as AS) !== AS.Dead) {
          cr.tgt = prey.id;
          cr.tk = 3;
          setState(cr, CS.Eat);
        }
      }
    }
    return;
  }
  if (cr.state === CS.Strike && cr.st < 0.3) return;
  // boss: deimatic display on a timer once hurt
  if (opts.boss && hurtFrac(cr) < 0.66 && cr.cd2 <= 0) {
    cr.cd2 = 15;
    setState(cr, CS.Display);
    telegraph(w, cr, cr.x, cr.y, reach * 1.1, 0.8);
    return;
  }
  // boss below 40 %: hunting walk to clusters, with a short leap now and then
  if (opts.boss && hurtFrac(cr) < 0.4) {
    if (cr.state === CS.Leap) {
      walkTo(w, cr, k, cr.tx, cr.ty, 4, dt, 2);
      if (cr.st > 0.5) setState(cr, CS.Lurk);
      return;
    }
    const a = pickAnt(w, cr, cr.x, cr.y, k.sense * 1.5);
    if (a && dhypot(a.x - cr.x, a.y - cr.y) > reach) {
      if ((cr.data.leapT ?? 0) <= 0 && dhypot(a.x - cr.x, a.y - cr.y) > reach * 1.6) {
        cr.data.leapT = 10;
        cr.tx = a.x;
        cr.ty = a.y;
        setState(cr, CS.Leap);
        telegraph(w, cr, a.x, a.y, reach * 0.4, 0.4);
        return;
      }
      walkTo(w, cr, k, a.x, a.y, 1.6, dt, 4);
      return;
    }
  }
  // lurk: sway, turn slowly to track the ant with the most threat (else the nearest) — or, with several in reach, the
  // thickest of them (the strike's cone is aimed: combat v2) — and strike when it comes in reach
  setState(cr, cr.state === CS.Strike ? CS.Lurk : cr.state === CS.Wander ? CS.Wander : CS.Lurk);
  const a = threatPick(w, cr, reach + 3) ?? pickAnt(w, cr, cr.x, cr.y, k.sense);
  if (a) {
    const d = dhypot(a.x - cr.x, a.y - cr.y);
    const aim = aimDir(w, cr, reach + 3, half);
    const face = aim.n >= 2 ? aim.dir : datan2(a.y - cr.y, a.x - cr.x);
    if (aim.n >= 2) turnCreature(cr, aim.dir, dt, 1.125);
    else faceAnt(cr, a, dt, 1.125);
    cr.v = 0;
    if (d < reach && Math.abs(angleTo(cr.h, face)) < half && cr.cd <= 0) {
      setState(cr, CS.WindUp);
      telegraph(w, cr, cr.x + dcos(cr.h) * reach * 0.6, cr.y + dsin(cr.h) * reach * 0.6, reach, opts.boss ? 0.6 : 0.35, { dir: cr.h, half });
    }
    return;
  }
  // rarely, it creeps to a new perch
  if (cr.state === CS.Wander || cr.st > 25 + cr.v2 * 20) {
    setState(cr, CS.Wander);
    wanderHome(w, cr, k, dt, 80, 0.5);
    if (cr.st > 4) setState(cr, CS.Lurk);
  } else cr.v = 0;
}

/** Antlion: a pit that drags ants to the jaws at the bottom. Exposed (and vulnerable) when swarmed. */
function antlion(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  cr.v = 0;
  const pit = k.length * 1.3;
  cr.data.pit = pit;
  let atBottom = 0;
  w.antsNear(cr.space, cr.x, cr.y, pit, (a, d2) => {
    if (a.state === AS.Dead || a.state === AS.Flung || riding(a)) return false;
    const d = Math.sqrt(d2);
    // the loose sand slides: ants on the slope are dragged down and slowed
    if (d > 2) {
      const pull = (1 - d / pit) * 9 * dt + 2 * dt;
      a.x += ((cr.x - a.x) / d) * pull;
      a.y += ((cr.y - a.y) / d) * pull;
      a.slowT = Math.max(a.slowT, 0.3);
    }
    if (d < 5) atBottom++;
    return false;
  });
  // sand flicked at struggling prey
  if (cr.cd2 <= 0 && atBottom === 0) {
    const a = pickAnt(w, cr, cr.x, cr.y, pit);
    if (a) {
      w.events.emit({ t: 'spoil', colony: -1, x: a.x, y: a.y, space: cr.space });
      cr.cd2 = 0.8;
    }
  }
  // jaws at the bottom
  if (cr.state === CS.Eat) {
    if (!holdPrey(w, cr, k, dt, 2) || cr.st > 4) {
      cr.tgt = 0;
      setState(cr, CS.Lurk);
    }
  } else if (cr.cd <= 0) {
    const a = pickAnt(w, cr, cr.x, cr.y, 5);
    if (a) {
      bite(w, cr, k, a);
      cr.cd = k.attackInterval;
      if (a.state !== AS.Dead && atBottom < 3) {
        cr.tgt = a.id;
        cr.tk = 3;
        setState(cr, CS.Eat);
      }
    }
  }
  // swarmed: ants dig it out of the sand
  cr.data.dig = Math.max(0, (cr.data.dig ?? 0) + (atBottom >= 3 ? dt : -dt * 0.5));
  cr.data.exposed = cr.data.dig > 2 ? 1 : 0;
  if (cr.state !== CS.Eat) setState(cr, cr.data.exposed ? CS.Display : CS.Lurk);
}

function spiderling(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  hunter(w, cr, k, dt);
}

// ---------------------------------------------------------------- bosses

function bossPhase(w: World, cr: Creature, names: string[], cuts: number[]): number {
  const f = hurtFrac(cr);
  let p = 0;
  for (const c of cuts) if (f < c) p++;
  if (p !== cr.phase) {
    cr.phase = p;
    w.events.emit({ t: 'bossPhase', creature: cr.id, phase: p, name: names[p] ?? '' });
  }
  return p;
}

/** Bosses head for their goal (a nest entrance in missions) when no ant is near. */
function bossRoam(w: World, cr: Creature, k: CreatureKind, dt: number, speedMul = 0.8): void {
  const gx = cr.data.gx ?? cr.homeX;
  const gy = cr.data.gy ?? cr.homeY;
  if (dhypot(gx - cr.x, gy - cr.y) > 20) walkTo(w, cr, k, gx, gy, speedMul, dt, 2.5);
  else wanderHome(w, cr, k, dt, 80, 0.5);
}

function stag(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  const p = bossPhase(w, cr, ['Advance', 'Grab and toss', 'Enraged: rear-up crush'], [0.75, 0.4]);
  const L = k.length;
  // rears and shakes its riders off (combat v2)
  if (riderShake(w, cr, dt, CS.Rear)) return;
  if (backOff(w, cr, k, dt)) return;
  // a pinch of the antlers under way: wind-up, pinch, recovery (combat v2.1)
  if (biteSeq(w, cr, k, L * 0.55, dt)) return;
  if (cr.state === CS.WindUp) {
    cr.v = 0;
    if (cr.st >= 0.9) {
      // the antlers clamp: everything in front is bitten and thrown
      const ants = antsIn(w, cr, cr.x + dcos(cr.h) * L * 0.3, cr.y + dsin(cr.h) * L * 0.3, L * 0.32, { dir: cr.h, half: 0.9 });
      for (const a of ants.slice(0, 5)) {
        bite(w, cr, k, a, 0.6);
        if (a.state !== AS.Dead) flingAnt(w, a, cr.x, cr.y, 2.4);
      }
      cr.cd2 = p >= 1 ? 6 : 9;
      setState(cr, CS.Strike);
    }
    return;
  }
  if (cr.state === CS.Rear) {
    cr.v = 0;
    if (cr.st >= 1.2 && !cr.data.slammed) {
      cr.data.slammed = 1;
      const r = L * 0.55;
      for (const a of antsIn(w, cr, cr.x, cr.y, r)) {
        damageAnt(w, a, 20, 'bite', cr);
        if (a.state !== AS.Dead) flingAnt(w, a, cr.x, cr.y, 2);
      }
      shakeOff(w, cr, 99, 2);
      w.events.emit({ t: 'slam', x: cr.x, y: cr.y, space: cr.space, radius: r, power: 1 });
    }
    if (cr.st > 1.8) {
      cr.data.slammed = 0;
      cr.data.rearT = 10;
      setState(cr, CS.Chase);
    }
    return;
  }
  if (cr.state === CS.Strike && cr.st < 0.5) return;
  cr.data.rearT = (cr.data.rearT ?? 4) - dt;
  if (p >= 2 && cr.data.rearT <= 0) {
    setState(cr, CS.Rear);
    telegraph(w, cr, cr.x, cr.y, L * 0.55, 1.2);
    return;
  }
  // one target (the bite): the ant with the most threat in reach, else the nearest in a crowd
  const a = threatPick(w, cr, L * 0.6) ?? pickAnt(w, cr, cr.x, cr.y, k.sense, (o, d2) => d2 / (1 + crowd(w, cr, o)));
  if (!a) {
    setState(cr, CS.Wander);
    bossRoam(w, cr, k, dt);
    return;
  }
  const d = dhypot(a.x - cr.x, a.y - cr.y);
  setState(cr, CS.Chase);
  // the clamp (a splash in front) is aimed at the thickest crowd: it turns there first
  const aim = p >= 1 && cr.cd2 <= 0 && d < L * 0.6 ? aimDir(w, cr, L * 0.62, 0.9) : null;
  if (aim && aim.n >= 2 && Math.abs(angleTo(cr.h, aim.dir)) > 0.3) {
    cr.v = 0;
    turnCreature(cr, aim.dir, dt, 2.5);
    return;
  }
  if (d > L * 0.45) walkTo(w, cr, k, a.x, a.y, 1, dt, 2.5);
  else {
    cr.v = 0;
    faceAnt(cr, a, dt, 2.25);
  }
  if (aim) {
    setState(cr, CS.WindUp);
    telegraph(w, cr, cr.x + dcos(cr.h) * L * 0.3, cr.y + dsin(cr.h) * L * 0.3, L * 0.32, 0.9, { dir: cr.h, half: 0.9 });
    return;
  }
  // a pinch of the antlers on the nearest ant in front — standing still, with a wind-up (combat v2.1)
  if (cr.cd <= BALANCE.combat21.crWindupSec && d < L * 0.5 && cr.v === 0) {
    startBite(cr, a);
    return;
  }
  if (cr.latched >= 8 && cr.st > 2) {
    shakeOff(w, cr, 2, 1.5);
    cr.st = 0;
  }
}

/** How many ants stand near an ant (bosses go for clusters). */
function crowd(w: World, cr: Creature, a: Ant): number {
  let n = 0;
  w.antsNear(cr.space, a.x, a.y, 14, () => {
    n++;
    return false;
  });
  return n;
}

function tarantula(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  const p = bossPhase(w, cr, ['Threat and lunge', 'Urticating hairs', 'Frenzy'], [0.66, 0.33]);
  const L = k.length;
  const frenzy = p >= 2 ? 2 : 1;
  // rears up and shakes its riders off (combat v2)
  if (riderShake(w, cr, dt, CS.Rear)) return;
  if (backOff(w, cr, k, dt)) return;
  if (cr.state === CS.WindUp) {
    // threat posture: front legs and palps raised, fangs shown; it turns toward the aimed lunge (no snap: combat v2.1)
    cr.v = 0;
    turnCreature(cr, cr.data.aimH ?? cr.h, dt, BALANCE.combat21.crWindupTurn);
    if (cr.st >= 0.8 / frenzy) {
      cr.tx = cr.x + dcos(cr.h) * L * 0.4;
      cr.ty = cr.y + dsin(cr.h) * L * 0.4;
      setState(cr, CS.Pounce);
    }
    return;
  }
  if (cr.state === CS.Pounce) {
    lunge(w, cr, k, 4, dt);
    if (cr.st > 0.35) {
      // the downward fang strike
      const ants = antsIn(w, cr, cr.x + dcos(cr.h) * L * 0.35, cr.y + dsin(cr.h) * L * 0.35, L * 0.2);
      for (const a of ants.slice(0, 3)) bite(w, cr, k, a);
      if (frenzy > 1)
        for (const a of antsIn(w, cr, cr.x, cr.y, L * 0.45)) if (a.state !== AS.Dead) flingAnt(w, a, cr.x, cr.y, 1.2);
      cr.cd = (k.attackInterval * 1.6) / frenzy;
      setState(cr, CS.Chase);
    }
    return;
  }
  if (cr.state === CS.Flick) {
    cr.v = 0;
    // turning its rear to the thickest of the swarm while it rubs the hairs loose
    if (cr.st < 1) turnCreature(cr, cr.data.aimH ?? cr.h, dt, 4);
    if (cr.st >= 1 && !cr.data.flicked) {
      cr.data.flicked = 1;
      // a cloud of barbed hairs behind it: ants are slowed and stung
      const bx = cr.x - dcos(cr.h) * L * 0.4;
      const by = cr.y - dsin(cr.h) * L * 0.4;
      const r = L * 0.5;
      for (const a of antsIn(w, cr, bx, by, r)) {
        a.slowT = Math.max(a.slowT, 6);
        damageAnt(w, a, 3, 'acid', cr);
      }
      w.events.emit({ t: 'hairs', x: bx, y: by, space: cr.space, radius: r });
    }
    if (cr.st > 1.6) {
      cr.data.flicked = 0;
      cr.data.flickT = 12;
      setState(cr, CS.Chase);
    }
    return;
  }
  cr.data.flickT = (cr.data.flickT ?? 0) - dt;
  if (p >= 1 && cr.data.flickT <= 0 && cr.latched + countNear(w, cr, L * 0.6) >= 5) {
    // turns its rear to the thickest of the swarm (aimed: combat v2) and rubs the abdomen with a hind leg
    const aim = aimDir(w, cr, L * 0.8, 0.8);
    cr.data.aimH = aim.dir + Math.PI;
    setState(cr, CS.Flick);
    telegraph(w, cr, cr.x + dcos(aim.dir) * L * 0.4, cr.y + dsin(aim.dir) * L * 0.4, L * 0.5, 1);
    return;
  }
  const a = threatPick(w, cr, L * 0.6) ?? pickAnt(w, cr, cr.x, cr.y, k.sense, (o, d2) => d2 / (1 + crowd(w, cr, o)));
  if (!a) {
    setState(cr, CS.Wander);
    bossRoam(w, cr, k, dt, 0.7);
    return;
  }
  const d = dhypot(a.x - cr.x, a.y - cr.y);
  const face = datan2(a.y - cr.y, a.x - cr.x);
  setState(cr, CS.Chase);
  if (d < L * 0.6 && cr.cd <= 0) {
    // the lunge lands among the most ants in front (aimed: combat v2), else on its target; it turns there first,
    // between attacks, so the wind-up's area is where the lunge lands (combat v2.1: no snap, no turning after it)
    const aim = aimDir(w, cr, L * 0.6, 0.5);
    const dir = aim.n >= 2 || !onBody(cr, a) ? (aim.n >= 2 ? aim.dir : face) : cr.h;
    if (Math.abs(angleTo(cr.h, dir)) > 0.3) {
      cr.v = 0;
      turnCreature(cr, dir, dt, 2.5);
      return;
    }
    cr.data.aimH = dir;
    setState(cr, CS.WindUp);
    telegraph(w, cr, cr.x + dcos(dir) * L * 0.5, cr.y + dsin(dir) * L * 0.5, L * 0.22, 0.8 / frenzy);
    // in the frenzy the lunge also throws everything round it: that area is shown too
    if (frenzy > 1) telegraph(w, cr, cr.x, cr.y, L * 0.45, 0.8 / frenzy);
    return;
  }
  // slow deliberate walk with pauses
  if (dsin(w.time * 0.9 + cr.v2 * 6) > -0.3 || frenzy > 1) walkTo(w, cr, k, a.x, a.y, 0.8 * frenzy, dt, 2);
  else cr.v = 0;
  if (cr.latched >= 8 && cr.cd2 <= 0) {
    shakeOff(w, cr, 3, 1.4);
    cr.cd2 = 3;
  }
}

function countNear(w: World, cr: Creature, r: number): number {
  let n = 0;
  w.antsNear(cr.space, cr.x, cr.y, r, (a) => {
    if (a.state !== AS.Dead) n++;
    return false;
  });
  return n;
}

function scolopendra(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  const p = bossPhase(w, cr, ['Coil and strike', 'Body whip', 'Frenzy: constrict'], [0.66, 0.35]);
  const L = k.length;
  const fast = p >= 2 ? 1.3 : 1;
  // thrashes its riders off (combat v2)
  if (riderShake(w, cr, dt, CS.Whip)) return;
  if (backOff(w, cr, k, dt)) return;
  if (cr.state === CS.Coil) {
    // head rises and draws back, turning toward the strike (no snap: combat v2.1)
    cr.v = 0;
    turnCreature(cr, cr.data.aimH ?? cr.h, dt, BALANCE.combat21.crWindupTurn);
    if (cr.st >= 0.7 / fast) {
      cr.tx = cr.x + dcos(cr.h) * L * 0.3;
      cr.ty = cr.y + dsin(cr.h) * L * 0.3;
      setState(cr, CS.Pounce);
    }
    return;
  }
  if (cr.state === CS.Pounce) {
    lunge(w, cr, k, 4, dt);
    if (cr.st > 0.3) {
      const hx = cr.x + dcos(cr.h) * L * 0.1;
      const hy = cr.y + dsin(cr.h) * L * 0.1;
      for (const a of antsIn(w, cr, hx, hy, L * 0.08 + 6).slice(0, 2)) bite(w, cr, k, a);
      cr.cd = k.attackInterval / fast;
      setState(cr, CS.Chase);
    }
    return;
  }
  if (cr.state === CS.Whip) {
    cr.v = 0;
    // swinging its rear round toward the thickest of the swarm during the wind-up (aimed: combat v2)
    if (cr.st < 0.6) turnCreature(cr, cr.data.aimH ?? cr.h, dt, 3);
    if (cr.st >= 0.6 && !cr.data.whipped) {
      cr.data.whipped = 1;
      // the rear half lashes sideways: everything beside and behind is swept away
      const r = L * 0.5;
      for (const a of antsIn(w, cr, cr.x, cr.y, r, { dir: cr.h + Math.PI, half: 1.9 })) {
        damageAnt(w, a, 10, 'bite', cr);
        if (a.state !== AS.Dead) flingAnt(w, a, cr.x, cr.y, 1.8);
      }
      shakeOff(w, cr, 99, 1.6);
      w.events.emit({ t: 'slam', x: cr.x, y: cr.y, space: cr.space, radius: r, power: 0.6 });
    }
    if (cr.st > 1.1) {
      cr.data.whipped = 0;
      cr.cd2 = 9;
      setState(cr, CS.Chase);
    }
    return;
  }
  if (cr.state === CS.Rear) {
    // coiled round a cluster, squeezing
    cr.v = 0;
    const r = L * 0.18;
    for (const a of antsIn(w, cr, cr.x, cr.y, r)) a.hp -= 6 * dt;
    if (cr.st > 3) {
      cr.data.coilT = 8;
      setState(cr, CS.Chase);
    }
    return;
  }
  if (p >= 1 && cr.cd2 <= 0 && cr.latched + countNear(w, cr, L * 0.4) >= 6) {
    const aim = aimDir(w, cr, L * 0.5, 1.0);
    cr.data.aimH = aim.dir + Math.PI;
    setState(cr, CS.Whip);
    telegraph(w, cr, cr.x, cr.y, L * 0.5, 0.6, { dir: aim.dir, half: 1.9 });
    return;
  }
  cr.data.coilT = (cr.data.coilT ?? 0) - dt;
  const a = threatPick(w, cr, L * 0.4) ?? pickAnt(w, cr, cr.x, cr.y, k.sense, (o, d2) => d2 / (1 + crowd(w, cr, o)));
  if (p >= 2 && a && cr.data.coilT <= 0 && crowd(w, cr, a) >= 6 && dhypot(a.x - cr.x, a.y - cr.y) < L * 0.2) {
    setState(cr, CS.Rear);
    telegraph(w, cr, cr.x, cr.y, L * 0.18, 0.5);
    return;
  }
  if (!a) {
    setState(cr, CS.Wander);
    bossRoam(w, cr, k, dt, 0.6);
    return;
  }
  const d = dhypot(a.x - cr.x, a.y - cr.y);
  setState(cr, CS.Chase);
  if (d < L * 0.35 && cr.cd <= 0) {
    // it faces its prey first, between attacks (combat v2.1: the coil then strikes where it was telegraphed)
    const dir = onBody(cr, a) ? cr.h : datan2(a.y - cr.y, a.x - cr.x);
    if (Math.abs(angleTo(cr.h, dir)) > 0.3) {
      cr.v = 0;
      turnCreature(cr, dir, dt, 3);
      return;
    }
    cr.data.aimH = dir;
    setState(cr, CS.Coil);
    telegraph(w, cr, cr.x + dcos(dir) * L * 0.3, cr.y + dsin(dir) * L * 0.3, 8, 0.7 / fast, { dir, half: 0.25 });
    return;
  }
  walkTo(w, cr, k, a.x, a.y, fast, dt, 3);
}

function hogna(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  const p = bossPhase(w, cr, ['Stalk and pounce', 'Spiderlings scatter', 'Frenzy sprints'], [0.66, 0.33]);
  // the spiderlings drop off her back and attack (twice)
  if (p >= 1 && !cr.data.brood1) {
    cr.data.brood1 = 1;
    scatterSpiderlings(w, cr, 8);
  }
  if (p >= 2 && !cr.data.brood2) {
    cr.data.brood2 = 1;
    scatterSpiderlings(w, cr, 6);
  }
  // rears up and shakes her riders off (combat v2)
  if (riderShake(w, cr, dt, CS.Rear)) return;
  if (cr.latched >= 6 && cr.cd2 <= 0) {
    shakeOff(w, cr, 3, 1.6);
    cr.cd2 = 2.5;
  }
  const save = k.fleeAt;
  stalker(w, cr, k, dt, p >= 2 ? 1.6 : 1);
  void save;
  if (cr.state === CS.Wander && countNear(w, cr, k.sense) === 0) bossRoam(w, cr, k, dt, 0.7);
}

function scatterSpiderlings(w: World, cr: Creature, n: number): void {
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + w.rng.range(-0.3, 0.3);
    const s = spawnCreature(w, 'spiderling', cr.space, cr.x + dcos(ang) * 8, cr.y + dsin(ang) * 8);
    s.h = ang;
    s.homeX = cr.x;
    s.homeY = cr.y;
  }
  cr.data.riders = 0;
}

// ---------------------------------------------------------------------------
// Battle arena (sim/arena.ts): team creatures fight the other teams' creatures too
// ---------------------------------------------------------------------------

/** Two creatures' bodies are touching at this distance (centre to centre), plus a little reach. */
function meleeReach(cr: Creature, o: Creature): number {
  return creatureRadius(cr) + creatureRadius(o) + 2;
}

/** One creature bites another (any program's bite, against a creature): armour, venom and level as against ants. */
function biteCreature(w: World, cr: Creature, k: CreatureKind, o: Creature): void {
  const dmg = k.bite * (cr.data.power ?? 1);
  damageCreature(w, o, dmg, 'bite', null);
  if (k.venom && !o.dead) applyVenom(w, o, k.venom.dps, k.venom.duration, k.venom.maxStacks);
  w.events.emit({ t: 'bite', x: o.x, y: o.y, space: o.space, strength: Math.min(1, dmg / 20), by: cr.kind, on: 'creature' });
}

/**
 * A team creature in the battle arena, before its own program. Passive teams stand still. A creature with a bite
 * goes for the nearest enemy within its senses: another team's (or a wild) creature it fights here — walk up, face
 * it, bite on its own attack interval — and an ant it leaves to its own program (which only picks the other teams'
 * ants). With nothing in sense, a charging creature heads for its nearest enemy creature or its team's target; a
 * holding one goes back to its post. A fleeing or hiding creature keeps to its program. Returns true when it ran
 * the creature this tick.
 */
function arenaCreature(w: World, cr: Creature, k: CreatureKind, dt: number): boolean {
  if (cr.faction < 0) return false;
  const stance = stanceOf(w, cr.faction);
  if (stance < 0) return false;
  if (stance === STANCE.PASSIVE) {
    cr.v = 0;
    cr.tgt = 0;
    cr.tk = 0;
    if (cr.state !== CS.Wander && cr.state !== CS.Rolled && cr.state !== CS.Curled) setState(cr, CS.Wander);
    return true;
  }
  // arena creatures fight to the end (their programs get the kind with no fleeing: arenaKind)
  if (cr.state === CS.Flee || cr.state === CS.Hide) setState(cr, CS.Wander);
  if (k.bite <= 0) return false;
  // a bite on an ant under way: its own program finishes it (combat v2.1)
  if (cr.state === CS.WindUp && (cr.data.bw ?? 0) > 0) return false;
  const team = w.teamOf(cr.faction);
  // the nearest enemy creature anywhere (few creatures: a plain scan, in array order)
  let foe: Creature | null = null;
  let fd2 = Infinity;
  for (const o of w.s.creatures) {
    if (o === cr || o.dead || o.space !== cr.space) continue;
    if (o.faction >= 0 && w.teamOf(o.faction) === team) continue;
    const d2 = sqd(o.x - cr.x, o.y - cr.y);
    if (d2 < fd2) {
      fd2 = d2;
      foe = o;
    }
  }
  // the nearest enemy ant within its senses
  let ad2 = Infinity;
  w.antsNear(cr.space, cr.x, cr.y, k.sense, (a, d2) => {
    if (a.state === AS.Dead || riding(a) || (a.team ?? a.colony) === team || d2 >= ad2) return false;
    const c = w.colony(a.colony);
    if (c && (c.queen === a.id || c.king === a.id)) return false;
    ad2 = d2;
    return false;
  });
  const sense2 = k.sense * k.sense;
  if (foe && (fd2 <= sense2 || fd2 <= sq(meleeReach(cr, foe))) && fd2 <= ad2) {
    cr.data.foe = foe.id;
    const d = Math.sqrt(fd2);
    const want = datan2(foe.y - cr.y, foe.x - cr.x);
    const C21 = BALANCE.combat21;
    // combat v2.1: a wind-up (still, turning slowly), the bite (a miss if the foe has moved off: it never follows), a
    // recovery
    if (cr.state === CS.WindUp && (cr.data.cbw ?? 0) > 0) {
      cr.v = 0;
      turnCreature(cr, want, dt, C21.crWindupTurn);
      if (cr.st >= (cr.data.cbw ?? 0) - 1e-9) {
        cr.data.cbw = 0;
        setState(cr, CS.Attack);
        cr.cd = k.attackInterval;
        if (d <= meleeReach(cr, foe) + 2 && Math.abs(angleTo(cr.h, want)) < 0.8) biteCreature(w, cr, k, foe);
      }
      return true;
    }
    if (cr.state === CS.Attack) {
      cr.v = 0;
      if (cr.st >= C21.crRecoverSec - 1e-9) setState(cr, CS.Chase);
      return true;
    }
    if (d > meleeReach(cr, foe)) {
      if (cr.state !== CS.Chase) setState(cr, CS.Chase);
      walkTo(w, cr, k, foe.x, foe.y, 1, dt, 6);
      return true;
    }
    cr.v = 0;
    turnCreature(cr, want, dt, 6);
    if (cr.cd <= C21.crWindupSec && Math.abs(angleTo(cr.h, want)) < 0.8) {
      setState(cr, CS.WindUp);
      cr.data.cbw = C21.crWindupSec;
    }
    return true;
  }
  cr.data.foe = 0;
  if (ad2 < Infinity) return false; // an ant: its own program fights it
  if (stance === STANCE.CHARGE) {
    const T = arenaTarget(w, cr.faction);
    const tx = foe && (!T || fd2 <= sqd(T.x - cr.x, T.y - cr.y)) ? foe.x : T?.x;
    const ty = foe && (!T || fd2 <= sqd(T.x - cr.x, T.y - cr.y)) ? foe.y : T?.y;
    if (tx !== undefined && ty !== undefined) {
      if (cr.state !== CS.Chase) setState(cr, CS.Chase);
      walkTo(w, cr, k, tx, ty, 0.9, dt, 4);
      return true;
    }
  }
  // holding (or nothing left to charge): back to its post, then wait there
  if (dhypot(cr.homeX - cr.x, cr.homeY - cr.y) > ARENA.holdLeash) {
    if (cr.state !== CS.Wander) setState(cr, CS.Wander);
    walkTo(w, cr, k, cr.homeX, cr.homeY, 0.7, dt, 4);
  } else cr.v = 0;
  return true;
}

/** Battle arena: the kind as a team creature's program sees it — it never flees (fights are fought to the end). */
const NO_FLEE = new Map<string, CreatureKind>(); // det-ok: constant copies of the kind table
function arenaKind(k: CreatureKind): CreatureKind {
  let c = NO_FLEE.get(k.id);
  if (!c) {
    c = { ...k, fleeAt: 0 };
    NO_FLEE.set(k.id, c);
  }
  return c;
}

/** Where a team's charge is headed (arena state), or null when it has no enemy. */
function arenaTarget(w: World, colony: number): { x: number; y: number } | null {
  const T = arenaTeam(w, colony);
  return T && T.has ? { x: T.tx, y: T.ty } : null;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

const PROGRAMS: Record<string, (w: World, cr: Creature, k: CreatureKind, dt: number) => void> = {
  passiveRoller,
  caterpillar,
  hunter: (w, cr, k, dt) => hunter(w, cr, k, dt),
  stalker: (w, cr, k, dt) => stalker(w, cr, k, dt),
  centipede: (w, cr, k, dt) => hunter(w, cr, k, dt, { dart: true }),
  rove: (w, cr, k, dt) => hunter(w, cr, k, dt, { display: true, biteMul: 1 }),
  mantis: (w, cr, k, dt) => mantis(w, cr, k, dt),
  antlion,
  spiderling,
  stag,
  tarantula,
  scolopendra,
  giantMantis: (w, cr, k, dt) => mantis(w, cr, k, dt, { boss: true }),
  hogna,
};

/** Spawn a creature of a kind (boss scaled as its notes say). */
export function spawnCreature(w: World, kind: string, space: number, x: number, y: number): Creature {
  const k = CREATURES[kind];
  const cr = makeCreature(w, kind, space, x, y, k.hp * (k.boss ? 1 : w.s.settings.enemyStatMul), k.length);
  cr.state = k.ai === 'mantis' || k.ai === 'giantMantis' || k.ai === 'antlion' ? CS.Lurk : CS.Wander;
  if (k.ai === 'hogna') cr.data.riders = 14;
  return cr;
}

/** Army ants latched on each creature this tick (derived in the latch pass, cleared after use). */
const ecPins = new Map<number, number>(); // det-ok: per-tick scratch, rebuilt from SimState

export function creatureSystem(w: World, dt: number): void {
  // latch counts: ants holding on, and their total grip
  for (const cr of w.s.creatures) {
    cr.latched = 0;
    cr.latchGrip = 0;
  }
  // the mount ratio (combat v2): with too few of a colony's ants left fighting from the ground, riders climb down
  enforceMountRatio(w);
  for (const cr of w.s.creatures) {
    cr.climbers = 0;
    if ((cr.rideMask ?? 0) !== 0) cr.rideMask = 0;
  }
  for (const a of w.s.ants) {
    if (a.state === AS.Climb) {
      // on it (up the leg, riding, coming down); ants still walking to a leg only hold a reservation
      const cr = (a.ridePh ?? 0) >= 1 ? w.creatureById.get(a.rideId ?? 0) : undefined;
      if (cr) {
        cr.climbers = (cr.climbers ?? 0) + 1;
        // mount slots taken (the climb debug overlay draws them)
        cr.rideMask = (cr.rideMask ?? 0) | (1 << (a.rideSlot ?? 0));
        // army ants on its back pin it as surely as ants holding its legs
        if (casteOf(a.caste).species === 'eciton') ecPins.set(cr.id, (ecPins.get(cr.id) ?? 0) + 1);
      }
      continue;
    }
    if (a.state !== AS.Grapple || a.gKind !== 4) continue;
    const cr = w.creatureById.get(a.gId);
    if (!cr) continue;
    cr.latched++;
    cr.latchGrip += casteOf(a.caste).grip;
    if (casteOf(a.caste).species === 'eciton') ecPins.set(cr.id, (ecPins.get(cr.id) ?? 0) + 1);
  }
  // army ants: a creature held by enough of them (not a boss) is spread-eagled — it can turn and bite, not walk
  for (const [id, n] of ecPins) {
    const cr = w.creatureById.get(id);
    if (!cr || n < ECITON.pin.minAttackers || creatureKind(cr.kind)?.boss) continue;
    cr.data.root = Math.max(cr.data.root ?? 0, w.s.tick + 2);
  }
  ecPins.clear();
  for (const cr of w.s.creatures) {
    cr.px = cr.x;
    cr.py = cr.y;
    cr.ph = cr.h;
    const k = creatureKind(cr.kind);
    if (!k) continue;
    if (cr.dead) {
      deadUpdate(w, cr, k, dt);
      continue;
    }
    cr.st += dt;
    decayThreat(w, cr, dt);
    if (cr.cd > 0) cr.cd -= dt;
    if (cr.cd2 > 0) cr.cd2 -= dt;
    if (cr.slowT > 0) cr.slowT -= dt;
    if (cr.data.hitT) cr.data.hitT = Math.max(0, cr.data.hitT - dt);
    if (cr.data.leapT) cr.data.leapT -= dt;
    // venom from stings (fire ants, army ants)
    if (cr.venom > 0) {
      cr.hp -= cr.venomDps * cr.venom * dt * 0.35;
      cr.venomT -= dt;
      if (cr.venomT <= 0) {
        cr.venom = 0;
        cr.venomDps = 0;
      }
      if (cr.hp <= 0) {
        cr.hp = 0;
        cr.dead = true;
        cr.deadT = 0;
        w.events.emit({ t: 'death', x: cr.x, y: cr.y, space: cr.space, kind: 'creature', id: cr.id, colony: -1, what: cr.kind });
        continue;
      }
    }
    if (cr.stun > 0) {
      cr.stun -= dt;
      cr.v = 0;
      continue;
    }
    // a target now clinging to the body out of reach of the jaws cannot be chased round; riders are untouchable
    if (cr.tgt && cr.tk === 3) {
      const t = w.antById.get(cr.tgt);
      const reach = creatureRadius(cr) + 3;
      if (t && (riding(t) || (onBody(cr, t) && sqd(t.x - cr.x, t.y - cr.y) > reach * reach))) cr.tgt = 0;
    }
    const h0 = cr.h;
    // flushed by an army-ant swarm front (eciton.ts): it runs from the front for a moment instead
    if ((cr.data.flushT ?? 0) > 0) {
      cr.data.flushT = Math.max(0, (cr.data.flushT ?? 0) - dt);
      if (cr.latched === 0 && !k.boss && cr.state !== CS.Hide) {
        const away = datan2(cr.y - (cr.data.flushY ?? cr.y), cr.x - (cr.data.flushX ?? cr.x));
        walkTo(w, cr, k, cr.x + dcos(away) * 40, cr.y + dsin(away) * 40, 1.1, dt);
        if (k.maxTurn !== undefined) {
          const dh = angleTo(h0, cr.h);
          const lim = k.maxTurn * dt;
          if (dh > lim) cr.h = h0 + lim;
          else if (dh < -lim) cr.h = h0 - lim;
        }
        continue;
      }
    }
    if (!arenaCreature(w, cr, k, dt)) PROGRAMS[k.ai]?.(w, cr, cr.faction >= 0 && stanceOf(w, cr.faction) >= 0 ? arenaKind(k) : k, dt);
    // long bodies turn by curving, at most maxTurn rad/s (every path: walking, facing, snapping round)
    if (k.maxTurn !== undefined) {
      const dh = angleTo(h0, cr.h);
      const lim = k.maxTurn * dt;
      if (dh > lim) cr.h = h0 + lim;
      else if (dh < -lim) cr.h = h0 - lim;
    }
  }
}

/** A dead creature becomes a carcass the ants can eat; the body stays until the food is gone. */
function deadUpdate(w: World, cr: Creature, k: CreatureKind, dt: number): void {
  cr.deadT += dt;
  cr.v = 0;
  if (cr.data.gone) {
    w.removeCreatureNow(cr.id);
    return;
  }
  if (!cr.data.food && cr.deadT > 1) {
    const f = makeFood(w, 'corpse', cr.space, cr.x, cr.y, Math.max(2, k.length * 0.6), 'cr:' + k.id);
    f.amount = f.max = k.food;
    f.mass = k.mass;
    f.colony = -1;
    f.h = cr.h;
    cr.data.food = f.id;
  }
  if (cr.data.food) {
    const f = w.foodById.get(cr.data.food);
    // the body is eaten away; it follows its carcass if ants drag it
    if (!f || f.amount <= 0.05) w.removeCreatureNow(cr.id);
    else {
      cr.x = f.x;
      cr.y = f.y;
      cr.data.eaten = 1 - f.amount / Math.max(1, f.max);
    }
  }
}

/** Creature hooks for the combat code: armour (balled pill bugs, buried antlions), latching and hit radius. */
export function registerCreatureHooks(): void {
  creatureHooks.relation = (cr) => creatureKind(cr.kind)?.relation ?? 'hostile';
  creatureHooks.armor = (cr) => {
    const k = creatureKind(cr.kind);
    if (!k) return 0;
    if (cr.state === CS.Rolled) return k.armor + 12;
    if (k.ai === 'antlion' && !cr.data.exposed) return k.armor + 10;
    return k.armor;
  };
  creatureHooks.canLatch = (cr) => {
    const k = creatureKind(cr.kind);
    if (cr.state === CS.Rolled) return false;
    if (k?.ai === 'antlion' && !cr.data.exposed) return false;
    return true;
  };
  creatureHooks.radius = (cr) => creatureRadius(cr);
  creatureHooks.attacking = (cr) => creatureAttacking(cr);
  bodyHook.body = creatureBody;
  creatureHooks.onDamaged = (w, cr, from, dmg) => {
    cr.data.hitT = 4;
    // threat (combat v2): it remembers who hurts it most
    if (from) addThreat(cr, from, dmg);
  };
}

// ---------------------------------------------------------------------------
// Ecology: wild creatures come and go
// ---------------------------------------------------------------------------

/**
 * Keeps a few wild creatures on the surface (`settings.creatures` scales it):
 * pill bugs and cutworms as food, predators now and then, more of the
 * nocturnal ones at night, antlion pits in dry open ground. They appear away
 * from nest entrances. Bosses are only spawned by modes and the sandbox.
 */
export function ecologySystem(w: World, dt: number): void {
  const mul = w.s.settings.creatures ?? 1;
  if (mul <= 0) return;
  const area = (w.terrain.width * w.terrain.depth) / 1e4;
  const want = Math.round(area * 0.035 * mul);
  let wild = 0;
  for (const cr of w.s.creatures) if (!cr.dead && cr.space === SURFACE && !creatureKind(cr.kind)?.boss && cr.kind !== 'spiderling') wild++;
  if (wild >= want || !w.rng.chance(dt * 0.05 * mul)) return;
  const kinds = wildKinds();
  let tot = 0;
  for (const k of kinds) tot += k.w * (CREATURES[k.id].nocturnal ? 0.5 + w.s.night : 1);
  let r = w.rng.next() * tot;
  let pick = kinds[0].id;
  for (const k of kinds) {
    r -= k.w * (CREATURES[k.id].nocturnal ? 0.5 + w.s.night : 1);
    if (r <= 0) {
      pick = k.id;
      break;
    }
  }
  const p = wildSpot(w, CREATURES[pick].ai === 'antlion' ? 140 : 110);
  if (p) spawnCreature(w, pick, SURFACE, p.x, p.y);
}

function wildSpot(w: World, clear: number): { x: number; y: number } | null {
  const t = w.terrain;
  // on an authored map wild creatures come from its creature zones (when it has any)
  const L = t.layout;
  const zone = L ? L.zoneHexes(HF_CREATURE) : [];
  for (let i = 0; i < 30; i++) {
    let x: number;
    let y: number;
    if (L && zone.length) {
      const q = zone[w.rng.int(0, zone.length - 1)];
      x = L.hex.centerX(q) + w.rng.range(-0.7, 0.7) * L.hex.R;
      y = L.hex.centerY(q) + w.rng.range(-0.7, 0.7) * L.hex.R;
    } else {
      x = w.rng.range(30, t.width - 30);
      y = w.rng.range(30, t.depth - 30);
    }
    if (!t.passable(x, y) || !t.inBounds(x, y, 30)) continue;
    let ok = true;
    for (const space of w.undergroundSpaces()) for (const e of w.entrancesOf(space)) if (dhypot(e.sx - x, e.sy - y) < clear) ok = false;
    if (ok) return { x, y };
  }
  return null;
}
