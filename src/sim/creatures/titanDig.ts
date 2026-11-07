import { World } from '../world';
import { AS, Ant, Colony, Creature, SURFACE, isCaveSpace, nestSpace } from '../types';
import { STORY, TERMANT, TITAN_DIG } from '../balance';
import { CreatureKind, creatureKind } from './kinds';
import { CS, bite, creatureBody, frontR, hognaPhases, inReach, pickAnt, setState, walkTo } from './creatureAI';
import { entranceTop } from '../entrances';
import { datan2, dcos, dhypot, dpow, dsin } from '../dmath';
import { storyOf } from '../story/state';

/**
 * Titans dig into nests (claude/creatures/01-spec-digging-titans.md, user 2026-11-02 — the game's own twist: in Empires
 * of the Undergrowth titans can't enter nests). A raiding titan:
 *  1. walks to one of the colony's three surface holes (its warning goes out `warnSec` before it gets there);
 *  2. digs that hole wider — the only digging it does — over `holeWork` ÷ its `dig.speed` seconds (a little longer for a
 *     bigger titan), slowed by the damage it takes a second (down to `slowFloor` of its pace) and set back a little by
 *     heavy blows, never below the last checkpoint (25 / 50 / 75 %); the work stays on the hole `holeMemorySec` s; it
 *     gives up below `giveUpHealth` (claude/creatures/02-spec-easier-titan-holes.md);
 *  3. walks into the nest through the 7-hex entrance flower and straight through the ground to the queen (then brood and
 *     stores): every soil or stone hex its body touches opens at once (`NestGrid.breakHex`); built tiles, the queen's
 *     chamber and the flower are dug floor already, so nothing of them breaks; it bites ants in reach, standing still while
 *     it does;
 *  4. walks back out the way it came below `fleeHealth`, after `maxStay` s (neither for a story's titan), once the queen is dead, or when a story says
 *     so (`endTitanRaid`); killed underground, its carcass stays in the nest as food.
 * The widened hole stays a breach (any titan walks in without digging) until the colony repairs it (`repairSec`).
 * State lives on the creature (`data.raid…`) and the entrance (`breach`, `breachBy`, `repair`): saves and lockstep carry it.
 *
 * Skirmish and multiplayer (`settings.titanRaids`, on unless false): `titanRaidSystem` starts raids now and then.
 *
 * Story raids (`rstory`, a `digInto` cue; claude/story/05-spec-story-titans-get-inside.md) always get in: the approach
 * walks the surface route field at no less than `STORY.titanRaid.minPace` of its speed and sidesteps when stuck; the dig
 * goes at no less than `minPace`, with no knock-backs, breaking through by the difficulty's `digCap`; it never gives up
 * or flees, and the director keeps its health above a floor until it is in.
 */

/** raid phases (`data.rph`) */
export const RAID = { Approach: 1, Dig: 2, Inside: 3, Leave: 4, Out: 5 } as const;

export function canDig(k: CreatureKind | undefined): boolean {
  return !!k && !!k.boss && !!k.dig?.can && k.dig.speed > 0;
}

/** The colony a titan is raiding (or null). */
export function raidTarget(w: World, cr: Creature): Colony | null {
  const id = (cr.data.raid ?? 0) - 1;
  return id >= 0 ? (w.colony(id) ?? null) : null;
}

/**
 * Send a titan to dig into a colony's nest: by the hole `hole` (its index in the colony's entrances) or the nearest one.
 * `story`: a script started it (it never gives up digging; story levels ignore the skirmish setting). Returns false when
 * it can't (not a digger, already raiding, the colony gone or without holes).
 */
export function startTitanRaid(w: World, cr: Creature, colony: number, hole = -1, story = false, speed = 1): boolean {
  if (whyNoRaid(w, cr, colony)) return false;
  const c = w.colony(colony)!;
  let ei = hole;
  if (ei < 0 || ei >= c.entrances.length) {
    // a breach already open is the way in; else the nearest hole
    ei = c.entrances.findIndex((e) => (e.breach ?? 0) > 0 && !(e.breachBy ?? 0));
    if (ei < 0) {
      let bd = Infinity;
      c.entrances.forEach((e, i) => {
        const d = dhypot(e.sx - cr.x, e.sy - cr.y);
        if (d < bd) (bd = d), (ei = i);
      });
    }
  }
  cr.data.raid = colony + 1;
  cr.data.rph = RAID.Approach;
  cr.data.rhole = ei;
  cr.data.rprog = 0;
  cr.data.rrate = 0;
  cr.data.rdt = 0;
  cr.data.rhp = cr.hp;
  cr.data.rin = 0;
  cr.data.rwarn = 0;
  cr.data.rstory = story ? 1 : 0;
  cr.data.rleave = 0;
  cr.data.rspd = speed;
  cr.data.rbest = 1e9;
  cr.data.rstuck = 0;
  cr.data.rside = 0;
  return true;
}

/** Why a titan can't start a raid on that colony now ('' it can). */
export function whyNoRaid(w: World, cr: Creature, colony: number): string {
  const k = creatureKind(cr.kind);
  const c = w.colony(colony);
  if (!canDig(k)) return 'not a digging titan';
  if (cr.dead) return 'dead';
  if (!c || !c.alive) return 'the colony is gone';
  if (!c.entrances.length) return 'the colony has no holes';
  if (cr.space !== SURFACE) return isCaveSpace(cr.space) ? 'in its lair (underground)' : 'not on the surface';
  if ((cr.data.raid ?? 0) > 0) return 'already raiding';
  return '';
}

/** Seconds of undisturbed digging this titan needs for a hole: `holeWork` ÷ its dig speed × (its size ÷ `sizeRef`)^`sizeExp`. */
export function holeSecs(cr: Creature, k: CreatureKind): number {
  return (TITAN_DIG.holeWork / Math.max(0.05, k.dig?.speed ?? 1)) * dpow(Math.max(1, cr.scale) / TITAN_DIG.sizeRef, TITAN_DIG.sizeExp);
}

/** Its digging pace under fire: from the damage it takes a second (a share of its health), with diminishing returns. */
export function digPace(rate: number, floor = TITAN_DIG.slowFloor): number {
  const r = Math.max(0, rate) / TITAN_DIG.slowRate;
  return floor + (1 - floor) / (1 + r * r);
}

/** The last checkpoint at or below a hole's progress (a blow never knocks the work back past it). */
export function lastCheckpoint(p: number): number {
  let c = 0;
  for (const x of TITAN_DIG.checkpoints) if (p >= x - 1e-9) c = x;
  return c;
}

/** The work already on a hole (kept `holeMemorySec` s after the digging stopped). */
function savedWork(w: World, e: Colony['entrances'][number]): number {
  return (e.dprog ?? 0) > 0 && w.s.time - (e.dT ?? -1e9) <= TITAN_DIG.holeMemorySec ? (e.dprog ?? 0) : 0;
}

/** Seconds until it breaks through, digging from progress p at its present pace (story: by its cap at the latest). */
function etaDig(w: World, cr: Creature, k: CreatureKind, p: number): number {
  const story = (cr.data.rstory ?? 0) > 0;
  const pace = Math.max(digPace(cr.data.rrate ?? 0), story ? STORY.titanRaid.minPace : 0);
  let t = (holeSecs(cr, k) * Math.max(0, 1 - p)) / pace;
  const st = story ? storyOf(w) : null;
  if (st) t = Math.min(t, Math.max(0, STORY.titanRaid.digCap[st.diff] - (cr.data.rdt ?? 0)));
  return t;
}

/** End a raid (a story's dawn): the titan walks back out the way it came and leaves (a story's retries stop too). */
export function endTitanRaid(w: World, cr: Creature): void {
  if ((cr.data.raid ?? 0) > 0) cr.data.rleave = 1;
  cr.data.rstop = 1;
}

/** A titan raiding or leaving a nest (the creature system hands it over here; true = handled this tick). */
export function titanRaidTick(w: World, cr: Creature, k: CreatureKind, dt: number): boolean {
  const c = raidTarget(w, cr);
  const ph = cr.data.rph ?? 0;
  if (!c || ph <= 0) return false;
  const e = c.entrances[cr.data.rhole ?? 0] ?? c.entrances[0];
  if (!e) return finishRaid(w, cr, k);
  // hits: the damage it takes a second (smoothed; it slows the digging), heavy blows, and the health checks
  const hp0 = cr.data.rhp ?? cr.hp;
  const lost = Math.max(0, hp0 - cr.hp);
  cr.data.rhp = cr.hp;
  const rate0 = cr.data.rrate ?? 0;
  cr.data.rrate = rate0 + (lost / Math.max(1, cr.maxHp) / Math.max(dt, 1e-3) - rate0) * Math.min(1, dt / TITAN_DIG.rateSec);
  const frac = cr.hp / Math.max(1, cr.maxHp);
  const story = (cr.data.rstory ?? 0) > 0;
  const queen = w.antById.get(c.queen);
  const leaving = (cr.data.rleave ?? 0) > 0 || !c.alive || !queen || queen.state === AS.Dead;
  // the wolf spider mother's phases and brood still happen while she raids
  if (k.ai === 'hogna') hognaPhases(w, cr);

  if (ph === RAID.Approach) {
    if (leaving) return finishRaid(w, cr, k);
    // an open breach: straight in without digging
    const open = (e.breach ?? 0) > 0 && !(e.breachBy ?? 0);
    const d = dhypot(e.sx - cr.x, e.sy - cr.y);
    const there = frontR(cr) + 3;
    const spd = k.speed * (cr.data.rspd ?? 1);
    if (!(cr.data.rwarn ?? 0) && d - there <= spd * TITAN_DIG.warnSec) {
      cr.data.rwarn = 1;
      // (the player's client turns it into a warning toast that jumps the camera there, a rumble and a sound)
      const eta = Math.max(0, d - there) / Math.max(1, spd) + (open ? 0 : etaDig(w, cr, k, savedWork(w, e)));
      w.events.emit({ t: 'titanDig', phase: 'warn', colony: c.id, x: e.sx, y: e.sy, space: SURFACE, creature: cr.id, kind: cr.kind, eta, prog: savedWork(w, e), ...(story ? { story: true } : {}) });
    }
    if (d > there) {
      setState(cr, CS.Chase);
      if (story) storyWalk(w, cr, k, e.sx, e.sy, d, dt);
      else walkTo(w, cr, k, e.sx, e.sy, 1, dt);
      return true;
    }
    if (open) return goInside(w, cr, c, e);
    // the work already on this hole, if it was dug lately (holeMemorySec)
    cr.data.rprog = Math.max(cr.data.rprog ?? 0, savedWork(w, e));
    cr.data.rdt = 0;
    cr.data.rph = RAID.Dig;
    setState(cr, CS.Dig);
    w.events.emit({ t: 'titanDig', phase: 'start', colony: c.id, x: e.sx, y: e.sy, space: SURFACE, creature: cr.id, kind: cr.kind, eta: etaDig(w, cr, k, cr.data.rprog ?? 0), prog: cr.data.rprog ?? 0, ...(story ? { story: true } : {}) });
    return true;
  }

  if (ph === RAID.Dig) {
    cr.v = 0;
    cr.h += angleStep(cr.h, datan2(e.sy - cr.y, e.sx - cr.x), 3 * dt);
    if (leaving || (!story && frac < TITAN_DIG.giveUpHealth)) {
      // (the work stays on the hole for a while)
      e.dprog = cr.data.rprog ?? 0;
      e.dT = w.s.time;
      return finishRaid(w, cr, k);
    }
    let p = cr.data.rprog ?? 0;
    // a heavy blow knocks a little of the work back, never past the last checkpoint (none in a story's raid)
    if (!story && lost >= TITAN_DIG.heavyFrac * cr.maxHp) p = Math.max(lastCheckpoint(p), p - TITAN_DIG.heavyBack);
    const pace = Math.max(digPace(cr.data.rrate ?? 0), story ? STORY.titanRaid.minPace : 0);
    p += (dt * pace) / holeSecs(cr, k);
    cr.data.rdt = (cr.data.rdt ?? 0) + dt;
    // a story's titan breaks through by its cap, whatever happens
    const st = story ? storyOf(w) : null;
    if (st && (cr.data.rdt ?? 0) >= STORY.titanRaid.digCap[st.diff]) p = 1;
    cr.data.rprog = Math.min(1, p);
    e.dprog = cr.data.rprog;
    e.dT = w.s.time;
    setState(cr, CS.Dig);
    // soil thrown out behind it (render), twice a second
    if (w.s.tick % 10 === cr.id % 10) w.events.emit({ t: 'titanDig', phase: 'dig', colony: c.id, x: e.sx, y: e.sy, space: SURFACE, creature: cr.id, kind: cr.kind, prog: cr.data.rprog });
    if ((cr.data.rprog ?? 0) >= 1) {
      e.breach = 1;
      e.repair = 0;
      e.dprog = 0;
      e.breachMm = TITAN_DIG.breachHoleMm * Math.min(1.6, Math.max(0.7, Math.sqrt(Math.max(1, cr.scale) / TITAN_DIG.sizeRef)));
      w.events.emit({ t: 'titanDig', phase: 'breach', colony: c.id, x: e.sx, y: e.sy, space: SURFACE, creature: cr.id, kind: cr.kind, prog: 1, ...(story ? { story: true } : {}) });
      return goInside(w, cr, c, e);
    }
    return true;
  }

  const g = w.nest(c.id);
  if (!g) return finishRaid(w, cr, k);
  if (ph === RAID.Inside) {
    cr.data.rin = (cr.data.rin ?? 0) + dt;
    // (a story's titan stays until its script sends it out — dawn — or it dies: claude/story/04-spec)
    if (leaving || (!story && (frac < TITAN_DIG.fleeHealth || (cr.data.rin ?? 0) >= TITAN_DIG.maxStay))) {
      cr.data.rph = RAID.Leave;
      return true;
    }
    // fight what is in reach (standing still while it bites), else walk on to the queen
    const prey = pickAnt(w, cr, cr.x, cr.y, frontR(cr) + 12);
    if (prey && inReach(cr, k, prey)) {
      cr.v = 0;
      cr.h += angleStep(cr.h, datan2(prey.y - cr.y, prey.x - cr.x), 4 * dt);
      if (cr.cd <= 0) {
        setState(cr, CS.Strike);
        // (a story's titan bites softer inside, the queen softest, by the difficulty: the fight inside stays winnable —
        // the level's `inside`, set by the director)
        const mul = story ? (cr.data.rbite ?? 1) * (prey.id === c.queen ? (cr.data.rqbite ?? 1) : 1) : 1;
        bite(w, cr, k, prey, mul);
        cr.cd = k.attackInterval;
      }
      return true;
    }
    const t = innerTarget(w, c, queen);
    if (t) walkThrough(w, cr, k, t.x, t.y, dt);
    return true;
  }

  if (ph === RAID.Leave) {
    // back to the flower's top, the way it came, then out of the breach
    const top = entranceTop(g);
    const p = g.hexCenter(top[0] ?? g.entrances[0]);
    if (dhypot(p.x - cr.x, p.y - cr.y) > frontR(cr) * 0.5 + 2) {
      walkThrough(w, cr, k, p.x, p.y, dt);
      return true;
    }
    cr.space = SURFACE;
    cr.x = cr.px = e.sx;
    cr.y = cr.py = e.sy;
    cr.h = cr.ph = datan2(e.sy - c.ny, e.sx - c.nx);
    e.breachBy = 0;
    moveRiders(w, cr);
    w.events.emit({ t: 'titanDig', phase: 'leave', colony: c.id, x: e.sx, y: e.sy, space: SURFACE, creature: cr.id, kind: cr.kind });
    cr.data.rph = RAID.Out;
    cr.data.rout = 0;
    return true;
  }

  // out: walk well away from the anthill, then back to its own life
  cr.data.rout = (cr.data.rout ?? 0) + dt;
  const away = datan2(cr.y - c.ny, cr.x - c.nx);
  walkTo(w, cr, k, cr.x + dcos(away) * 60, cr.y + dsin(away) * 60, 1, dt);
  if ((cr.data.rout ?? 0) > 8) return finishRaid(w, cr, k);
  return true;
}

/** Through the breach into the nest: onto the flower's top, facing in; riders come along. */
function goInside(w: World, cr: Creature, c: Colony, e: Colony['entrances'][number]): boolean {
  const g = w.nest(c.id);
  if (!g) return false;
  const top = entranceTop(g);
  const p = g.hexCenter(top[0] ?? g.entrances[0]);
  const ctr = g.hexCenter(g.entrances[0]);
  e.breachBy = cr.id;
  cr.space = nestSpace(c.id);
  cr.x = cr.px = p.x;
  cr.y = cr.py = p.y;
  cr.h = cr.ph = datan2(ctr.y - p.y, ctr.x - p.x);
  cr.data.rph = RAID.Inside;
  cr.data.rin = 0;
  // (it has been inside: a story's dig-in is done, its health floor lifts — the director reads this)
  cr.data.rinside = 1;
  moveRiders(w, cr);
  breakAround(w, cr);
  w.events.emit({ t: 'titanDig', phase: 'enter', colony: c.id, x: p.x, y: p.y, space: cr.space, creature: cr.id, kind: cr.kind, ...((cr.data.rstory ?? 0) > 0 ? { story: true } : {}) });
  return true;
}

/** The raid is over: the titan's own program takes over again; a raid may come again after the cooldown. */
function finishRaid(w: World, cr: Creature, _k: CreatureKind): boolean {
  const c = raidTarget(w, cr);
  if (c) for (const e of c.entrances) if (e.breachBy === cr.id) e.breachBy = 0;
  cr.data.raid = 0;
  cr.data.rph = 0;
  cr.data.rnext = w.s.time + TITAN_DIG.raidCooldown * 60;
  setState(cr, CS.Wander);
  return false;
}

/** Where it heads underground: the queen, else a brood tile, else a food store, else the queen's chamber. */
function innerTarget(w: World, c: Colony, queen: Ant | undefined): { x: number; y: number } | null {
  const g = w.nest(c.id);
  if (!g) return null;
  if (queen && queen.state !== AS.Dead && queen.space === nestSpace(c.id)) return queen;
  const t = c.tiles.find((x) => x.type === 'brood') ?? c.tiles.find((x) => x.type === 'food') ?? c.tiles.find((x) => x.type === 'queen');
  return t ? g.hexCenter(t.q) : null;
}

/** Underground walking: straight on through the ground (it opens as the body touches it), at `undergroundSpeed`. */
export function walkThrough(w: World, cr: Creature, k: CreatureKind, tx: number, ty: number, dt: number): void {
  const g = w.nestOf(cr.space);
  if (!g) return;
  const d = dhypot(tx - cr.x, ty - cr.y);
  if (d < 0.5) {
    cr.v = 0;
    return;
  }
  cr.h += angleStep(cr.h, datan2(ty - cr.y, tx - cr.x), 2.5 * dt);
  const sp = Math.min(d / Math.max(dt, 1e-3), k.speed * TITAN_DIG.undergroundSpeed * (cr.slowT > 0 ? 0.5 : 1));
  const m = creatureBody(cr).r;
  cr.x = Math.min(g.widthMm - m, Math.max(m, cr.x + dcos(cr.h) * sp * dt));
  cr.y = Math.min(g.depthMm - m, Math.max(m, cr.y + dsin(cr.h) * sp * dt));
  cr.v = sp;
  setState(cr, CS.Chase);
  breakAround(w, cr);
}

/** Every soil or stone hex its body touches opens at once (built tiles are dug floor already: untouched). */
export function breakAround(w: World, cr: Creature): number {
  const g = w.nestOf(cr.space);
  if (!g) return 0;
  const b = creatureBody(cr);
  const r = b.r + TITAN_DIG.breakMargin;
  const ux = dcos(cr.h);
  const uy = dsin(cr.h);
  let n = 0;
  // the body as a capsule: a few circles along its axis, each sampled on a grid finer than a hex
  const step = g.R * 0.7;
  const parts = Math.max(1, Math.ceil((b.hl * 2) / Math.max(1, r)));
  for (let p = 0; p <= parts; p++) {
    const off = parts ? -b.hl + (2 * b.hl * p) / parts : 0;
    const cx = cr.x + ux * off;
    const cy = cr.y + uy * off;
    for (let dy = -r; dy <= r + 1e-6; dy += step)
      for (let dx = -r; dx <= r + 1e-6; dx += step) {
        if (dx * dx + dy * dy > r * r) continue;
        const q = g.hexAt(cx + dx, cy + dy);
        if (q >= 0 && g.breakHex(q)) {
          n++;
          const h = g.hexCenter(q);
          w.events.emit({ t: 'titanDig', phase: 'break', colony: cr.space - 1, x: h.x, y: h.y, space: cr.space, creature: cr.id, kind: cr.kind });
        }
      }
  }
  return n;
}

/** Ants riding it change space with it. */
function moveRiders(w: World, cr: Creature): void {
  for (const a of w.s.ants) if (a.state === AS.Climb && (a.rideId ?? 0) === cr.id) a.space = cr.space;
}

/** The skirmish raids, warnings' timing aside: picks raiders now and then; repairs breaches. Every second. */
export function titanRaidSystem(w: World): void {
  const dt = 1;
  // breaches: the colony rebuilds the rim once no titan is in it
  for (const c of w.s.colonies) {
    if (!c.alive) continue;
    for (const e of c.entrances) {
      // (the titan in it died or left some other way: the breach is free again)
      if ((e.breachBy ?? 0) && !w.creatureById.get(e.breachBy ?? 0)?.data.raid) e.breachBy = 0;
      // half-dug work no titan came back to is filled in after `holeMemorySec`
      if ((e.dprog ?? 0) > 0 && w.s.time - (e.dT ?? 0) > TITAN_DIG.holeMemorySec) {
        e.dprog = 0;
        delete e.dT;
      }
      if (!(e.breach ?? 0) || (e.breachBy ?? 0)) continue;
      e.repair = Math.min(1, (e.repair ?? 0) + dt / TITAN_DIG.repairSec);
      if ((e.repair ?? 0) >= 1) {
        e.breach = 0;
        e.repair = 0;
      }
    }
  }
  // skirmish and multiplayer only (story levels follow their scripts), when the match allows it
  if (storyOf(w) || w.s.mode.arena || w.s.settings.titanRaids === false) return;
  if (w.s.time < TITAN_DIG.peaceMin * 60) return;
  let raiding = 0;
  for (const cr of w.s.creatures) if (!cr.dead && (cr.data.raid ?? 0) > 0) raiding++;
  if (raiding >= TITAN_DIG.maxRaiding) return;
  for (const cr of w.s.creatures) {
    if (raiding >= TITAN_DIG.maxRaiding) break;
    if (cr.dead || cr.space !== SURFACE || (cr.data.raid ?? 0) > 0 || cr.faction >= 0 || cr.data.dirA !== undefined) continue;
    const k = creatureKind(cr.kind);
    if (!canDig(k) || w.s.time < (cr.data.rnext ?? 0) || cr.hp < cr.maxHp * TITAN_DIG.raidMinHealth) continue;
    // once off cooldown, a `raidChance` a minute
    if (!w.rng.chance(TITAN_DIG.raidChance / 60)) continue;
    // a colony within range, weighted by its ants and its food (it smells the stores), not already raided
    const busy = new Set<number>();
    for (const o of w.s.creatures) if (!o.dead && (o.data.raid ?? 0) > 0) busy.add((o.data.raid ?? 0) - 1);
    let total = 0;
    const opts: Array<{ id: number; wgt: number }> = [];
    for (const c of w.s.colonies) {
      if (!c.alive || busy.has(c.id) || !c.entrances.length) continue;
      if (dhypot(c.nx - cr.x, c.ny - cr.y) > TITAN_DIG.raidRange) continue;
      const wgt = Math.max(1, c.living) + c.food * 0.2;
      opts.push({ id: c.id, wgt });
      total += wgt;
    }
    if (!opts.length) continue;
    let r = w.rng.next() * total;
    let pick = opts[opts.length - 1].id;
    for (const o of opts) {
      r -= o.wgt;
      if (r <= 0) {
        pick = o.id;
        break;
      }
    }
    if (startTitanRaid(w, cr, pick)) raiding++;
  }
}

const route = { x: 0, y: 0 }; // det-ok: scratch vector, overwritten before every read

/**
 * A story titan's walk to the hole (claude/story/05-spec §2): along the surface route field (round banks and walls, up
 * the ramps), sliding round obstacles, at no less than `STORY.titanRaid.minPace` of its speed whatever holds it (ants
 * latched on, glue, jaws: it drags them along), and after `stuckSec` s without getting nearer a sidestep to one side
 * for a moment (the next time the other side).
 */
function storyWalk(w: World, cr: Creature, k: CreatureKind, tx: number, ty: number, d: number, dt: number): void {
  const T = STORY.titanRaid;
  // getting nowhere?
  if (d < (cr.data.rbest ?? 1e9) - 1) {
    cr.data.rbest = d;
    cr.data.rstuck = 0;
  } else cr.data.rstuck = (cr.data.rstuck ?? 0) + dt;
  if ((cr.data.rstuck ?? 0) >= T.stuckSec) {
    cr.data.rstuck = 0;
    cr.data.rbest = d;
    cr.data.rside = 1.5;
    cr.data.rsgn = (cr.data.rsgn ?? 1) > 0 ? -1 : 1;
  }
  let want = datan2(ty - cr.y, tx - cr.x);
  if (d > 20) {
    const cell = w.surfFlow.cell;
    const f = w.surfFlow.field(`raid:${Math.round(tx / cell)}:${Math.round(ty / cell)}`, 0, [{ x: tx, y: ty }]);
    if (w.surfFlow.dir(f, cr.x, cr.y, route)) want = datan2(route.y, route.x);
  }
  if ((cr.data.rside ?? 0) > 0) {
    cr.data.rside = Math.max(0, (cr.data.rside ?? 0) - dt);
    want += 1.2 * (cr.data.rsgn ?? 1);
  }
  cr.h += angleStep(cr.h, want, 4 * dt);
  const diff = Math.abs(angleStep(cr.h, want, 9));
  // what slows it (ants holding on, glue, a slowing hit), but never below the story's floor; a pin can't stop it
  let held = Math.max(0.35, 1 - cr.latchGrip / Math.max(1, k.strength));
  if (cr.slowT > 0) held *= 0.5;
  if ((cr.glueT ?? 0) > w.s.tick) held *= TERMANT.glue.slowMul;
  const night = k.nocturnal ? 0.75 + 0.35 * w.s.night : 1;
  const sp = k.speed * (cr.data.rspd ?? 1) * night * Math.max(T.minPace, held);
  const step = Math.min(sp * Math.max(0.3, dcos(diff)) * dt, d);
  const free = (x: number, y: number) => w.terrain.inBounds(x, y, 4) && w.terrain.passable(x, y);
  const side = dsin(cr.id) > 0 ? 1 : -1;
  for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
    const hh = cr.h + off * side;
    const nx = cr.x + dcos(hh) * step;
    const ny = cr.y + dsin(hh) * step;
    if (!free(nx, ny)) continue;
    cr.x = nx;
    cr.y = ny;
    if (off) cr.h += angleStep(cr.h, hh, 4 * dt);
    cr.v = step / Math.max(dt, 1e-3);
    return;
  }
  cr.h += side * 4 * dt;
  cr.v = 0;
}

function angleStep(h: number, want: number, max: number): number {
  let d = want - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.max(-max, Math.min(max, d));
}
