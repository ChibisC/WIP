import { World } from '../world';
import { AS, Ant, Colony, Creature, SURFACE, nestSpace } from '../types';
import { TITAN_DIG } from '../balance';
import { CreatureKind, creatureKind } from './kinds';
import { CS, bite, creatureBody, frontR, inReach, pickAnt, setState, walkTo } from './creatureAI';
import { entranceTop } from '../entrances';
import { datan2, dcos, dhypot, dsin } from '../dmath';
import { storyOf } from '../story/state';

/**
 * Titans dig into nests (claude/creatures/01-spec-digging-titans.md, user 2026-11-02 — the game's own twist: in Empires
 * of the Undergrowth titans can't enter nests). A raiding titan:
 *  1. walks to one of the colony's three surface holes (its warning goes out `warnSec` before it gets there);
 *  2. digs that hole wider — the only digging it does — over `holeWork` ÷ its `dig.speed` seconds, slowed by every hit it
 *     takes and set back by heavy ones; it gives up below `giveUpHealth` (a story script may forbid that);
 *  3. walks into the nest through the 7-hex entrance flower and straight through the ground to the queen (then brood and
 *     stores): every soil or stone hex its body touches opens at once (`NestGrid.breakHex`); built tiles, the queen's
 *     chamber and the flower are dug floor already, so nothing of them breaks; it bites ants in reach, standing still while
 *     it does;
 *  4. walks back out the way it came below `fleeHealth`, after `maxStay` s, once the queen is dead, or when a story says
 *     so (`endTitanRaid`); killed underground, its carcass stays in the nest as food.
 * The widened hole stays a breach (any titan walks in without digging) until the colony repairs it (`repairSec`).
 * State lives on the creature (`data.raid…`) and the entrance (`breach`, `breachBy`, `repair`): saves and lockstep carry it.
 *
 * Skirmish and multiplayer (`settings.titanRaids`, on unless false): `titanRaidSystem` starts raids now and then.
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
export function startTitanRaid(w: World, cr: Creature, colony: number, hole = -1, story = false): boolean {
  const k = creatureKind(cr.kind);
  const c = w.colony(colony);
  if (!canDig(k) || cr.dead || !c || !c.alive || !c.entrances.length || cr.space !== SURFACE) return false;
  if ((cr.data.raid ?? 0) > 0) return false;
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
  cr.data.rstag = 0;
  cr.data.rhp = cr.hp;
  cr.data.rin = 0;
  cr.data.rwarn = 0;
  cr.data.rstory = story ? 1 : 0;
  cr.data.rleave = 0;
  return true;
}

/** End a raid (a story's dawn): the titan walks back out the way it came and leaves. */
export function endTitanRaid(w: World, cr: Creature): void {
  if ((cr.data.raid ?? 0) > 0) cr.data.rleave = 1;
}

/** A titan raiding or leaving a nest (the creature system hands it over here; true = handled this tick). */
export function titanRaidTick(w: World, cr: Creature, k: CreatureKind, dt: number): boolean {
  const c = raidTarget(w, cr);
  const ph = cr.data.rph ?? 0;
  if (!c || ph <= 0) return false;
  const e = c.entrances[cr.data.rhole ?? 0] ?? c.entrances[0];
  if (!e) return finishRaid(w, cr, k);
  // hits: stagger and set-backs (dig phase), and the health checks
  const hp0 = cr.data.rhp ?? cr.hp;
  const lost = hp0 - cr.hp;
  cr.data.rhp = cr.hp;
  if (lost > 0) cr.data.rstag = TITAN_DIG.staggerSec;
  else if ((cr.data.rstag ?? 0) > 0) cr.data.rstag = Math.max(0, (cr.data.rstag ?? 0) - dt);
  const frac = cr.hp / Math.max(1, cr.maxHp);
  const queen = w.antById.get(c.queen);
  const leaving = (cr.data.rleave ?? 0) > 0 || !c.alive || !queen || queen.state === AS.Dead;

  if (ph === RAID.Approach) {
    if (leaving) return finishRaid(w, cr, k);
    // an open breach: straight in without digging
    const open = (e.breach ?? 0) > 0 && !(e.breachBy ?? 0);
    const d = dhypot(e.sx - cr.x, e.sy - cr.y);
    const there = frontR(cr) + 3;
    if (!(cr.data.rwarn ?? 0) && d - there <= k.speed * TITAN_DIG.warnSec) {
      cr.data.rwarn = 1;
      // (the player's client turns it into a warning toast that jumps the camera there, a rumble and a sound)
      w.events.emit({ t: 'titanDig', phase: 'warn', colony: c.id, x: e.sx, y: e.sy, space: SURFACE, creature: cr.id, kind: cr.kind });
    }
    if (d > there) {
      setState(cr, CS.Chase);
      walkTo(w, cr, k, e.sx, e.sy, 1, dt);
      return true;
    }
    if (open) return goInside(w, cr, c, e);
    cr.data.rph = RAID.Dig;
    setState(cr, CS.Dig);
    return true;
  }

  if (ph === RAID.Dig) {
    cr.v = 0;
    cr.h += angleStep(cr.h, datan2(e.sy - cr.y, e.sx - cr.x), 3 * dt);
    if (leaving || (!(cr.data.rstory ?? 0) && frac < TITAN_DIG.giveUpHealth)) return finishRaid(w, cr, k);
    // a heavy blow knocks some of the work back
    if (lost >= TITAN_DIG.heavyFrac * cr.maxHp) cr.data.rprog = Math.max(0, (cr.data.rprog ?? 0) - TITAN_DIG.heavyBack);
    const pace = (cr.data.rstag ?? 0) > 0 ? TITAN_DIG.hitSlow : 1;
    cr.data.rprog = (cr.data.rprog ?? 0) + (dt * (k.dig?.speed ?? 1) * pace) / TITAN_DIG.holeWork;
    setState(cr, CS.Dig);
    // soil thrown out behind it (render), twice a second
    if (w.s.tick % 10 === cr.id % 10) w.events.emit({ t: 'titanDig', phase: 'dig', colony: c.id, x: e.sx, y: e.sy, space: SURFACE, creature: cr.id, kind: cr.kind });
    if ((cr.data.rprog ?? 0) >= 1) {
      e.breach = 1;
      e.repair = 0;
      w.events.emit({ t: 'titanDig', phase: 'breach', colony: c.id, x: e.sx, y: e.sy, space: SURFACE, creature: cr.id, kind: cr.kind });
      return goInside(w, cr, c, e);
    }
    return true;
  }

  const g = w.nest(c.id);
  if (!g) return finishRaid(w, cr, k);
  if (ph === RAID.Inside) {
    cr.data.rin = (cr.data.rin ?? 0) + dt;
    if (leaving || frac < TITAN_DIG.fleeHealth || (cr.data.rin ?? 0) >= TITAN_DIG.maxStay) {
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
        bite(w, cr, k, prey);
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
  moveRiders(w, cr);
  breakAround(w, cr);
  w.events.emit({ t: 'titanDig', phase: 'enter', colony: c.id, x: p.x, y: p.y, space: cr.space, creature: cr.id, kind: cr.kind });
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
function walkThrough(w: World, cr: Creature, k: CreatureKind, tx: number, ty: number, dt: number): void {
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
    if (!canDig(k) || w.s.time < (cr.data.rnext ?? 0)) continue;
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

function angleStep(h: number, want: number, max: number): number {
  let d = want - h;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.max(-max, Math.min(max, d));
}
