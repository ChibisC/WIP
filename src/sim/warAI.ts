import { World } from './world';
import { AS, Colony, SURFACE, colonyOfSpace, nestSpace } from './types';
import { casteOf, CASTES } from './species';
import { assignGroup, placeMarker, removeMarker } from './markers';
import { raisesAnts } from './tiles';
import { creatureKind } from './creatures/kinds';
import { dhypot, sq } from './dmath';
import { BALANCE, NASUTE, TERMANT } from './balance';
import { genesNear } from './termants';
import { rivalsMayRaid } from './missions';
import { siteRoutes } from '../world/teamSites';

/**
 * The rival AI's war (Phase 12; allies CHANGE_PLAN §23): its fighter groups defend the nest, raid rivals and help
 * allies, through the same markers a player uses.
 *
 * Every few seconds an AI colony:
 *  - **defends**: enemies (other teams' ants, hostile creatures) near one of
 *    its surface entrances or inside its nest get marker II, and every
 *    fighter group goes there; the marker is lifted once it has been clear
 *    for a while;
 *  - **helps an ally** in trouble (`allyTick`, every 2 s), unless it is
 *    threatened at home itself: marker V, a share of its fighters, a home
 *    guard kept back (below);
 *  - **attacks**: when its fighters clearly outweigh a rival's (the margin is
 *    divided by `settings.aggression`) and the opening peace is over, it puts
 *    marker III on that rival's queen and sends the fighters; it calls them
 *    home when the raid has cost too many of them, takes too long, or the
 *    rival has fallen. AI allies may join a raid and arrive together; an
 *    enemy seen attacking the team is raided first.
 * Workers keep foraging (marker I, `forageTick`); the queen's group stays
 * home. State lives on the colony (`aiWar`, `aiAlly`), so it is deterministic
 * and in snapshots.
 */

const DEFEND = 1;
const ATTACK = 2;
/** marker V: help for an ally */
export const HELP = 4;

export type WarBrain = NonNullable<Colony['aiWar']>;
export type AllyBrain = NonNullable<Colony['aiAlly']>;

export function warBrain(c: Colony): WarBrain {
  if (!c.aiWar) c.aiWar = { t: (c.id * 0.43) % BALANCE.aiWar.every, target: -1, start: 0, age: 0, cooldown: 0, defending: false, clearT: 0 };
  return c.aiWar;
}

export function allyBrain(c: Colony): AllyBrain {
  if (!c.aiAlly) c.aiAlly = { t: (c.id * 0.29) % BALANCE.aiAllies.every, ally: -1, since: 0, sent: 0, stage: 0, clearT: 0, cooldown: 0, flips: 0, died: {}, foe: -1, foeT: -1e9 };
  return c.aiAlly;
}

function isFighter(caste: string | undefined): boolean {
  if (!caste) return false;
  const r = CASTES[caste]?.role;
  return r === 'soldier' || r === 'major';
}

/** Rough fighting weight of one ant: health × damage rate (bites plus acid). */
function weight(caste: string): number {
  const cd = casteOf(caste);
  // a nasute's ramping stream counts at its mean rate over the ramp
  const acid = cd.acid ? (cd.acid.kind === 'ramp' ? (NASUTE.ramp.startDps + NASUTE.ramp.capDps) / 2 : cd.acid.damage / Math.max(0.2, cd.acid.cooldown)) : 0;
  const dps = cd.bite / Math.max(0.3, cd.attackInterval) + acid;
  return cd.hp * dps;
}

/** A creature's fighting weight: its health × its bite rate. */
function creatureWeight(cr: { kind: string; hp: number }): number {
  const k = creatureKind(cr.kind);
  return k ? cr.hp * (k.bite / Math.max(0.3, k.attackInterval)) * BALANCE.aiAllies.creatureWeight : 0;
}

/** Living fighters of a colony and their total weight. */
function fighters(w: World, c: Colony): { n: number; power: number } {
  let n = 0;
  let power = 0;
  for (const a of w.s.ants) {
    if (a.colony !== c.id || a.state === AS.Dead || !isFighter(a.caste)) continue;
    n++;
    power += weight(a.caste);
  }
  return { n, power };
}

/** The nearest threat to this colony, if any: in its nest first, then near its surface entrances. */
function threat(w: World, c: Colony): { space: number; x: number; y: number } | null {
  const home = nestSpace(c.id);
  const R = BALANCE.aiWar.defendRadius;
  const queen = w.antById.get(c.queen);
  const qx = queen?.x ?? 0;
  const qy = queen?.y ?? 0;
  let best: { space: number; x: number; y: number } | null = null;
  let bd = Infinity;
  const consider = (space: number, x: number, y: number) => {
    if (space === home) {
      // anything inside the nest beats anything outside (nearest the queen first)
      const d = -1e9 + sq(x - qx) + sq(y - qy);
      if (d < bd) {
        bd = d;
        best = { space, x, y };
      }
      return;
    }
    if (space !== SURFACE) return;
    for (const e of c.entrances) {
      const d = sq(x - e.sx) + sq(y - e.sy);
      if (d < R * R && d < bd) {
        bd = d;
        best = { space, x, y };
      }
    }
  };
  for (const a of w.s.ants) {
    if (a.state === AS.Dead || a.colony === c.id) continue;
    const o = w.colony(a.colony);
    if (!o || o.team === c.team) continue;
    consider(a.space, a.x, a.y);
  }
  for (const cr of w.s.creatures) {
    if (cr.dead || creatureKind(cr.kind)?.relation !== 'hostile') continue;
    if (cr.faction >= 0 && w.colony(cr.faction)?.team === c.team) continue;
    consider(cr.space, cr.x, cr.y);
  }
  return best;
}

function sendFighters(w: World, c: Colony, marker: number): void {
  for (const g of c.groups) if (raisesAnts(g) && isFighter(g.caste) && g.type !== 'queen' && g.marker !== marker && g.marker !== HELP) assignGroup(w, c, g.id, marker);
}

function callHome(w: World, c: Colony, marker: number): void {
  if (c.markers[marker].placed) removeMarker(w, c, marker);
  for (const g of c.groups) if (g.marker === marker) assignGroup(w, c, g.id, -1);
}

/** Has a teammate (or this colony) seen this enemy attack the team lately (shared targets)? */
function attacksTeam(w: World, c: Colony, enemy: number): boolean {
  const A = BALANCE.aiAllies;
  for (const o of w.s.colonies) if (o.team === c.team && o.aiAlly && o.aiAlly.foe === enemy && w.s.time - o.aiAlly.foeT < A.foeMemory) return true;
  return false;
}

/** The weakest reachable rival, by its defenders' weight and distance; one attacking the team first. */
function pickTarget(w: World, c: Colony): { id: number; power: number } | null {
  let best: { id: number; power: number } | null = null;
  let bs = Infinity;
  const ox = c.entrances[0]?.sx ?? c.nx;
  const oy = c.entrances[0]?.sy ?? c.ny;
  for (const o of w.s.colonies) {
    if (o.id === c.id || !o.alive || o.team === c.team || !w.nest(o.id) || !o.entrances.length) continue;
    const def = fighters(w, o).power + o.living * 0.5;
    const e = o.entrances[0];
    const d = Math.sqrt(sq(e.sx - ox) + sq(e.sy - oy));
    // Termants raid sooner a rival whose genes they nearly have; everyone raids sooner the enemy attacking the team
    const s = (def + 1) * (1 + d / 600) * (genesNear(c, o.species) ? TERMANT.ai.raidScoreMul : 1) * (attacksTeam(w, c, o.id) ? BALANCE.aiAllies.sharedTargetMul : 1);
    if (s < bs) {
      bs = s;
      best = { id: o.id, power: def };
    }
  }
  return best;
}

export function warTick(w: World, c: Colony, dt: number): void {
  const b = warBrain(c);
  if (!c.alive) {
    b.defending = false;
    b.target = -1;
    return;
  }
  // all-out (sim/nestFlood.ts forceAllOut): nothing else counts
  if (b.allOut) return allOutTick(w, c, b, dt);
  allyTick(w, c, dt);
  const W = BALANCE.aiWar;
  if (b.target >= 0) b.age += dt;
  b.t -= dt;
  if (b.t > 0) return;
  const step = W.every - b.t;
  b.t = W.every;

  // ---- Defence first: a raid in progress is called off when home is threatened.
  const th = threat(w, c);
  if (th) {
    b.clearT = 0;
    if (b.target >= 0 && th.space === nestSpace(c.id)) {
      callHome(w, c, ATTACK);
      b.target = -1;
      b.cooldown = w.s.time + W.cooldown;
    }
    const m = c.markers[DEFEND];
    if (!m.placed || m.space !== th.space || sq(m.x - th.x) + sq(m.y - th.y) > 100) placeMarker(w, c, DEFEND, th.space, th.x, th.y);
    if (!b.defending) b.defending = true;
    sendFighters(w, c, DEFEND);
    return;
  }
  if (b.defending) {
    b.clearT += step;
    if (b.clearT >= W.clearFor) {
      callHome(w, c, DEFEND);
      b.defending = false;
    }
    return;
  }

  // ---- A raid under way: follow the queen, call it off when it goes badly or is won.
  const aggression = w.s.settings.aggression ?? 1;
  if (b.target >= 0) {
    const t = w.colony(b.target);
    const army = fighters(w, c).n;
    const won = !t || !t.alive;
    if (won || army < b.start * W.retreatAt || b.age > W.maxRaid) {
      endRaid(w, c, won);
      return;
    }
    // a joint raid gathers near the target first, then everyone goes together (the leader's gathering)
    const lead = b.joined !== undefined && b.joined >= 0 ? w.colony(b.joined) : null;
    const gather = (lead?.aiWar?.target === b.target ? lead.aiWar.gather : undefined) ?? b.gather;
    if (gather && !gather.go) {
      const m = c.markers[ATTACK];
      if (!m.placed || m.space !== SURFACE || sq(m.x - gather.x) + sq(m.y - gather.y) > 64) placeMarker(w, c, ATTACK, SURFACE, gather.x, gather.y);
      if (b.joined === c.id) gatherCheck(w, c, gather);
      sendFighters(w, c, ATTACK);
      return;
    }
    const q = w.antById.get(t.queen);
    if (q && q.state !== AS.Dead) {
      const m = c.markers[ATTACK];
      if (!m.placed || m.space !== q.space || sq(m.x - q.x) + sq(m.y - q.y) > 64) placeMarker(w, c, ATTACK, q.space, q.x, q.y);
    }
    sendFighters(w, c, ATTACK);
    return;
  }

  // ---- Peace: raid when strong enough (in a mission, only once the story has set the war going); not while helping.
  if (aggression <= 0 || w.s.time < W.firstRaid || w.s.time < b.cooldown || (!c.player && !rivalsMayRaid(w))) return;
  if ((c.aiAlly?.ally ?? -1) >= 0) return;
  const own = fighters(w, c);
  // join an AI ally's young raid (CHANGE_PLAN §23): same target, gather and arrive together
  if (joinRaid(w, c, own.n)) return;
  if (own.n < W.minFighters) return;
  const tgt = pickTarget(w, c);
  const t = tgt ? w.colony(tgt.id)! : null;
  if (!tgt || !t || own.power < tgt.power * (W.margin / aggression) * (genesNear(c, t.species) ? TERMANT.ai.raidMarginMul : 1)) return;
  const q = w.antById.get(t.queen);
  if (!q || q.state === AS.Dead) return;
  b.target = tgt.id;
  b.start = own.n;
  b.age = 0;
  b.joined = c.id;
  b.gather = gatherPoint(w, c, t);
  if (b.gather) placeMarker(w, c, ATTACK, SURFACE, b.gather.x, b.gather.y);
  else placeMarker(w, c, ATTACK, q.space, q.x, q.y);
  sendFighters(w, c, ATTACK);
  if (colonyOfSpace(q.space) === t.id && t.player) w.events.emit({ t: 'message', text: `${c.name} is marching on your nest!`, kind: 'warn', colony: t.id });
}

function endRaid(w: World, c: Colony, won: boolean): void {
  const b = warBrain(c);
  callHome(w, c, ATTACK);
  b.target = -1;
  b.joined = -1;
  b.gather = undefined;
  b.cooldown = w.s.time + (won ? BALANCE.aiWar.cooldown * 0.5 : BALANCE.aiWar.cooldown);
}

// ---------------------------------------------------------------------------
// Joint raids (CHANGE_PLAN §23): AI allies with spare fighters join a young raid on the same target; everyone gathers
// short of the target and goes together once they are there (or after a while)
// ---------------------------------------------------------------------------

/** AI allies that could join a raid now: alive, fighters to spare, not threatened at home, not busy. */
function couldJoin(w: World, c: Colony, o: Colony): boolean {
  return o.id !== c.id && o.alive && o.ai && o.team === c.team && (o.aiWar?.target ?? -1) < 0 && !(o.aiWar?.defending ?? false) && (o.aiAlly?.ally ?? -1) < 0 && fighters(w, o).n >= BALANCE.aiAllies.joinMinFighters && !threat(w, o);
}

/** The gathering point for a raid on t: gatherDist short of its nearest hole, on the side the raider comes from. */
function gatherPoint(w: World, c: Colony, t: Colony): WarBrain['gather'] {
  const A = BALANCE.aiAllies;
  if (!A.help || !w.s.colonies.some((o) => couldJoin(w, c, o))) return undefined;
  const ox = c.entrances[0]?.sx ?? c.nx;
  const oy = c.entrances[0]?.sy ?? c.ny;
  let e = t.entrances[0];
  for (const h of t.entrances) if (sq(h.sx - ox) + sq(h.sy - oy) < sq(e.sx - ox) + sq(e.sy - oy)) e = h;
  if (!e) return undefined;
  const d = Math.max(1, dhypot(ox - e.sx, oy - e.sy));
  const k = Math.min(1, A.gatherDist / d);
  return { x: e.sx + (ox - e.sx) * k, y: e.sy + (oy - e.sy) * k, until: w.s.time + A.gatherMax, go: false };
}

/** Join an AI ally's young raid: the same target, the leader's gathering point. */
function joinRaid(w: World, c: Colony, n: number): boolean {
  const A = BALANCE.aiAllies;
  if (!A.help || n < A.joinMinFighters || threat(w, c)) return false;
  for (const o of w.s.colonies) {
    const ob = o.aiWar;
    if (o.id === c.id || !o.alive || o.team !== c.team || !ob || ob.target < 0 || ob.joined !== o.id || ob.age > A.joinWindow) continue;
    const t = w.colony(ob.target);
    if (!t || !t.alive) continue;
    const b = warBrain(c);
    b.target = ob.target;
    b.start = n;
    b.age = 0;
    b.joined = o.id;
    b.gather = undefined;
    sendFighters(w, c, ATTACK);
    return true;
  }
  return false;
}

/** The leader's check: everyone's fighters at the gathering point (each with gatherShare there), or time is up. */
function gatherCheck(w: World, c: Colony, gather: NonNullable<WarBrain['gather']>): void {
  const A = BALANCE.aiAllies;
  if (w.s.time >= gather.until) {
    gather.go = true;
    return;
  }
  for (const o of w.s.colonies) {
    if (!o.alive || o.team !== c.team || o.aiWar?.target !== c.aiWar?.target || o.aiWar?.joined !== c.id) continue;
    // the fighters it sent (its groups on marker III), not the ones still at home
    const raid = new Set(o.groups.filter((g) => g.marker === ATTACK).map((g) => g.id));
    const groupOf = groupsByTile(o);
    let all = 0;
    let there = 0;
    for (const a of w.s.ants) {
      if (a.colony !== o.id || a.state === AS.Dead || a.tile < 0 || !raid.has(groupOf.get(a.tile) ?? -1)) continue;
      all++;
      if (a.space === SURFACE && sq(a.x - gather.x) + sq(a.y - gather.y) < A.gatherR * A.gatherR) there++;
    }
    if (all && there < all * A.gatherShare) return;
  }
  gather.go = true;
}

// ---------------------------------------------------------------------------
// The ally brain (CHANGE_PLAN §23): help an ally in trouble, unless threatened at home
// ---------------------------------------------------------------------------

export interface AllyDanger {
  /** the score the decision weighs (0 = fine) */
  score: number;
  /** the attackers' fighting weight there (raw) and × where they are; the ally's defenders' weight there */
  enemy: number;
  enemyLoc: number;
  defence: number;
  /** enemies inside its nest; its queen hurt or enemies by her */
  inside: boolean;
  queen: boolean;
  /** where to send help: the threat nearest the queen inside, else nearest its holes */
  space: number;
  x: number;
  y: number;
  /** the enemy colony with the most weight there (−1 none or creatures) */
  foe: number;
}

/**
 * How much trouble ally `o` is in: the enemies' weight in its nest (by depth: by the queen worst) and at or near its
 * surface holes, minus its team's weight there, plus how fast it is losing ants; × queenMul with its queen in danger;
 * a human's call for help raises it. `lossRate`: its ants lost a second lately.
 */
export function allyDanger(w: World, o: Colony, lossRate = 0): AllyDanger {
  const A = BALANCE.aiAllies;
  const home = nestSpace(o.id);
  const g = w.nest(o.id);
  const queen = w.antById.get(o.queen);
  const qx = queen?.x ?? 0;
  const qy = queen?.y ?? 0;
  const ent = g && o.entrances[0] ? g.hexCenter(o.entrances[0].q) : null;
  let enemy = 0;
  let enemyLoc = 0;
  let defence = 0;
  let inside = false;
  let queenDanger = !!queen && queen.state !== AS.Dead && queen.hp < queen.maxHp * A.queenHurt;
  let best = Infinity;
  let space = SURFACE;
  let px = o.entrances[0]?.sx ?? o.nx;
  let py = o.entrances[0]?.sy ?? o.ny;
  const foes = new Map<number, number>();
  // where a point is, as a weight (0: not near the ally at all), and how urgent (lower = more)
  const where = (sp: number, x: number, y: number): { loc: number; urg: number } => {
    if (sp === home) {
      const dq = queen ? dhypot(x - qx, y - qy) : Infinity;
      if (dq < A.queenRadius) return { loc: A.locQueen, urg: dq };
      if (ent && dhypot(x - ent.x, y - ent.y) < A.entranceRadius) return { loc: A.locEntrance, urg: 2000 + dq };
      return { loc: A.locDeep, urg: 1000 + dq };
    }
    if (sp !== SURFACE) return { loc: 0, urg: Infinity };
    let dh = Infinity;
    for (const e of o.entrances) dh = Math.min(dh, dhypot(x - e.sx, y - e.sy));
    if (dh < A.siegeRadius) return { loc: A.locSiege, urg: 3000 + dh };
    if (dh < A.nearRadius) return { loc: A.locNear, urg: 4000 + dh };
    return { loc: 0, urg: Infinity };
  };
  const enemyAt = (sp: number, x: number, y: number, wt: number, from: number) => {
    const p = where(sp, x, y);
    if (!p.loc) return;
    enemy += wt;
    enemyLoc += wt * p.loc;
    if (sp === home) inside = true;
    if (queen && sp === home && dhypot(x - qx, y - qy) < A.queenRadius) queenDanger = true;
    if (from >= 0) foes.set(from, (foes.get(from) ?? 0) + wt);
    if (p.urg < best) {
      best = p.urg;
      space = sp;
      px = x;
      py = y;
    }
  };
  for (const a of w.s.ants) {
    if (a.state === AS.Dead) continue;
    const ac = w.colony(a.colony);
    if (!ac) continue;
    if (ac.team === o.team) {
      if (a.space === home || a.space === SURFACE) if (where(a.space, a.x, a.y).loc) defence += weight(a.caste);
      continue;
    }
    enemyAt(a.space, a.x, a.y, weight(a.caste), a.colony);
  }
  for (const cr of w.s.creatures) {
    if (cr.dead || creatureKind(cr.kind)?.relation !== 'hostile') continue;
    if (cr.faction >= 0 && w.colony(cr.faction)?.team === o.team) continue;
    enemyAt(cr.space, cr.x, cr.y, creatureWeight(cr), cr.faction >= 0 ? cr.faction : -1);
  }
  let score = Math.max(0, enemyLoc - defence) + lossRate * A.lossWeight;
  if (queenDanger && enemy > 0) score *= A.queenMul;
  if ((o.helpCall ?? 0) > w.s.time && enemy > 0) score = Math.max(score * A.callBoost, A.callMin);
  let foe = -1;
  let fw = 0;
  for (const [id, wt] of [...foes.entries()].sort((p, q) => p[0] - q[0])) if (wt > fw) ((fw = wt), (foe = id));
  return { score, enemy, enemyLoc, defence, inside, queen: queenDanger && enemy > 0, space, x: px, y: py, foe };
}

/** Seconds for this colony's fighters to reach ally o: the land route between their sites (else 1.3 × the straight line). */
function travelTime(w: World, c: Colony, o: Colony): number {
  let speed = 0;
  let n = 0;
  for (const cs of c.castes)
    if (isFighter(cs)) {
      speed += casteOf(cs).speed;
      n++;
    }
  speed = n ? speed / n : 10;
  const L = w.terrain.layout;
  let d = -1;
  if (L && c.site !== undefined && o.site !== undefined) {
    const R = siteRoutes(L);
    const r = R.d[c.site * R.n + o.site];
    if (Number.isFinite(r)) d = r;
  }
  if (d < 0) {
    const a = c.entrances[0] ?? { sx: c.nx, sy: c.ny };
    const e = o.entrances[0] ?? { sx: o.nx, sy: o.ny };
    d = dhypot(a.sx - e.sx, a.sy - e.sy) * 1.3;
  }
  return d / Math.max(1, speed);
}

/** The colony's fighter groups at home (not out at a marker), lowest id first, and their living ants' weight and count. */
function homeFighterGroups(w: World, c: Colony): Array<{ id: number; power: number; n: number }> {
  const groupOf = groupsByTile(c);
  const per = new Map<number, { power: number; n: number }>();
  for (const a of w.s.ants) {
    if (a.colony !== c.id || a.state === AS.Dead || a.tile < 0) continue;
    const gid = groupOf.get(a.tile);
    if (gid === undefined) continue;
    const e = per.get(gid) ?? { power: 0, n: 0 };
    e.power += weight(a.caste);
    e.n++;
    per.set(gid, e);
  }
  const out: Array<{ id: number; power: number; n: number }> = [];
  for (const g of c.groups) {
    if (!raisesAnts(g) || !isFighter(g.caste) || g.type === 'queen' || g.marker >= 0) continue;
    const e = per.get(g.id);
    if (e && e.n) out.push({ id: g.id, power: e.power, n: e.n });
  }
  return out.sort((p, q) => p.id - q.id);
}

/**
 * The fighter groups at home to send for `need` more fighting weight, lowest id first, keeping the home guard
 * (`homeGuardShare` of all its fighters' weight, at least `homeGuardMin` fighters); `out` is the weight already out
 * helping.
 */
function helpGroups(w: World, c: Colony, need: number, out: number): { go: number[]; power: number; n: number } {
  const A = BALANCE.aiAllies;
  const total = fighters(w, c);
  const guard = Math.max(total.power * A.homeGuardShare, total.n ? (total.power / total.n) * A.homeGuardMin : 0);
  let power = 0;
  let n = 0;
  const go: number[] = [];
  for (const g of homeFighterGroups(w, c)) {
    if (power >= need) break;
    if (total.power - out - power - g.power < guard) continue;
    go.push(g.id);
    power += g.power;
    n += g.n;
  }
  return { go, power, n };
}

/** Each tile's group (an ant belongs to its tile's group). */
function groupsByTile(c: Colony): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of c.tiles) m.set(t.q, t.group);
  return m;
}

/**
 * Living ants of the groups out helping (marker V): how many, how many inside the ally's nest, their weight, and the
 * weight of those still on their way (not yet in the ally's nest or near its holes, so not in its `defence`).
 */
function helpers(w: World, c: Colony): { n: number; inside: number; space: number; coming: number; power: number } {
  const s = allyBrain(c);
  const o = s.ally >= 0 ? w.colony(s.ally) : undefined;
  const space = o ? nestSpace(o.id) : -1;
  const groups = new Set(c.groups.filter((g) => g.marker === HELP).map((g) => g.id));
  const groupOf = groupsByTile(c);
  const near = BALANCE.aiAllies.nearRadius;
  let n = 0;
  let inside = 0;
  let coming = 0;
  let power = 0;
  for (const a of w.s.ants) {
    if (a.colony !== c.id || a.state === AS.Dead || a.tile < 0 || !groups.has(groupOf.get(a.tile) ?? -1)) continue;
    n++;
    power += weight(a.caste);
    if (a.space === space) inside++;
    else if (!(a.space === SURFACE && o && o.entrances.some((e) => sq(a.x - e.sx) + sq(a.y - e.sy) < near * near))) coming += weight(a.caste);
  }
  return { n, inside, space, coming, power };
}

/** Stop helping: the groups walk home, the marker is lifted, a cooldown; a human ally is told why. */
function stopHelp(w: World, c: Colony, why: 'home' | 'done' | 'fallen' | 'losses' | 'outmatched' | 'time'): void {
  const s = allyBrain(c);
  const o = w.colony(s.ally);
  callHome(w, c, HELP);
  if (o && o.player && o.alive && why === 'home') w.events.emit({ t: 'message', text: `Your ally's soldiers went home to defend their own nest.`, kind: 'warn', colony: o.id });
  else if (o && o.player && o.alive && why === 'done') w.events.emit({ t: 'message', text: `Your ally's soldiers are going home: the danger has passed.`, kind: 'info', colony: o.id });
  else if (o && o.player && o.alive && why === 'losses') w.events.emit({ t: 'message', text: `Your ally's soldiers fell back: they lost too many.`, kind: 'warn', colony: o.id });
  else if (o && o.player && o.alive && why === 'outmatched') w.events.emit({ t: 'message', text: `Your ally's soldiers fell back: the enemy is too strong for them.`, kind: 'warn', colony: o.id });
  else if (o && o.player && o.alive && why === 'time') w.events.emit({ t: 'message', text: `Your ally's soldiers are going home.`, kind: 'info', colony: o.id });
  s.why = why;
  s.block = why === 'done' || why === 'fallen' ? -1 : s.ally;
  s.ally = -1;
  s.sent = 0;
  s.clearT = 0;
  s.cooldown = w.s.time + BALANCE.aiAllies.cooldown;
  s.flips++;
}

/** Put marker V where the help goes: the ally's entrance first while the enemy is inside, then on the threat. */
function steerHelp(w: World, c: Colony, o: Colony, d: AllyDanger): void {
  const A = BALANCE.aiAllies;
  const s = allyBrain(c);
  const h = helpers(w, c);
  if (d.inside && s.stage === 0 && h.n && h.inside >= h.n * A.insideShare) s.stage = 1;
  if (!d.inside) s.stage = 1;
  let space = d.space;
  let x = d.x;
  let y = d.y;
  if (d.inside && s.stage === 0) {
    // the ally's hole nearest us: a marker dropped on it goes down into the ally's nest, at its entrance
    const ox = c.entrances[0]?.sx ?? c.nx;
    const oy = c.entrances[0]?.sy ?? c.ny;
    let e = o.entrances[0];
    for (const hole of o.entrances) if (sq(hole.sx - ox) + sq(hole.sy - oy) < sq(e.sx - ox) + sq(e.sy - oy)) e = hole;
    if (!e) return;
    space = SURFACE;
    x = e.sx;
    y = e.sy;
    const m = c.markers[HELP];
    if (m.placed && m.space === nestSpace(o.id)) return; // already down at the entrance
  }
  const m = c.markers[HELP];
  if (!m.placed || m.space !== space || sq(m.x - x) + sq(m.y - y) > 100) placeMarker(w, c, HELP, space, x, y);
}

/** Every 2 s: keep helping (or stop), or pick an ally to help. */
export function allyTick(w: World, c: Colony, dt: number): void {
  const A = BALANCE.aiAllies;
  if (!A.help) return;
  const s = allyBrain(c);
  s.t -= dt;
  if (s.t > 0) return;
  const step = A.every - s.t;
  s.t = A.every;
  const allies = w.s.colonies.filter((o) => o.id !== c.id && o.alive && o.team === c.team);
  // the allies' losses a second since the last look
  const loss = new Map<number, number>();
  for (const o of allies) {
    const prev = s.died[o.id];
    loss.set(o.id, prev === undefined ? 0 : Math.max(0, o.stats.died - prev) / step);
    s.died[o.id] = o.stats.died;
  }
  const home = threat(w, c);
  // ---- helping: carry on, or stop (threatened at home: at once)
  if (s.ally >= 0) {
    const o = w.colony(s.ally);
    if (home) return stopHelp(w, c, 'home');
    if (!o || !o.alive) return stopHelp(w, c, 'fallen');
    const d = allyDanger(w, o, loss.get(o.id) ?? 0);
    if (d.foe >= 0) ((s.foe = d.foe), (s.foeT = w.s.time));
    const h = helpers(w, c);
    if (s.sent > 0 && h.n < s.sent * (1 - A.assistMaxLoss)) return stopHelp(w, c, 'losses');
    // the enemy has grown far beyond what help and defenders can hold: fall back rather than die with the ally
    if (d.enemy > 0 && d.defence + h.coming < A.assistQuitOdds * d.enemy) return stopHelp(w, c, 'outmatched');
    if (w.s.time - s.since > A.assistMaxTime) return stopHelp(w, c, 'time');
    if (d.score < A.clearDanger || d.enemy <= 0) {
      s.clearT += step;
      if (s.clearT >= A.clearFor) return stopHelp(w, c, 'done');
    } else s.clearT = 0;
    // the fight is going worse than it looked (the ally's defenders falling, more enemies): send more, keeping the guard
    const more = A.assistOvermatch * d.enemy - d.defence - h.coming;
    if (d.enemy > 0 && more > 0 && w.s.time - (s.sentT ?? s.since) >= A.reinforceEvery) {
      const r = helpGroups(w, c, more, h.power);
      for (const id of r.go) assignGroup(w, c, id, HELP);
      if (r.go.length) ((s.sent += r.n), (s.sentT = w.s.time));
    }
    if (d.enemy > 0) steerHelp(w, c, o, d);
    return;
  }
  if (!allies.length || home || w.s.time < s.cooldown) return;
  const war = warBrain(c);
  if (war.defending) return;
  // ---- pick the ally in the most trouble for the time it takes to get there
  let pick: { o: Colony; d: AllyDanger; v: number } | null = null;
  for (const o of allies) {
    const d = allyDanger(w, o, loss.get(o.id) ?? 0);
    if (d.foe >= 0 && d.enemy > 0) ((s.foe = d.foe), (s.foeT = w.s.time));
    // one go per threat: an ally helped before waits until its danger has cleared once
    if ((s.block ?? -1) === o.id) {
      if (d.score < A.clearDanger) s.block = -1;
      else continue;
    }
    if (d.score < A.assistMinDanger || d.defence >= d.enemy * A.allyWinningRatio) continue;
    const travel = travelTime(w, c, o);
    if (travel > A.assistMaxTravel && !d.queen) continue;
    const v = d.score / Math.max(1, travel);
    if (!pick || v > pick.v) pick = { o, d, v };
  }
  if (!pick) return;
  // a raid gives way when the ally is in more trouble than the raid is worth, its queen is in danger, or the raid is on
  // the very enemy attacking it (the fighters go to the ally's nest instead)
  if (war.target >= 0) {
    if (!(pick.d.score > A.raidValue || pick.d.queen || war.target === pick.d.foe)) return;
    endRaid(w, c, false);
  }
  // ---- send enough fighters, keeping a home guard
  const need = A.assistOvermatch * pick.d.enemy - pick.d.defence;
  if (need <= 0) return;
  const { go, power: sent, n: sentN } = helpGroups(w, c, need, 0);
  if (!go.length) return;
  // a lost cause: even all it can spare would leave the ally's side well short of the attackers
  if (sent + pick.d.defence < (pick.d.queen ? A.assistMinOddsQueen : A.assistMinOdds) * pick.d.enemy) {
    const call = pick.o.helpCall ?? 0;
    if (pick.o.player && call > w.s.time && s.told !== call) {
      s.told = call;
      w.events.emit({ t: 'message', text: `Your ally can't spare enough soldiers to help against an attack this strong.`, kind: 'warn', colony: pick.o.id });
    }
    return;
  }
  for (const id of go) assignGroup(w, c, id, HELP);
  s.ally = pick.o.id;
  s.since = w.s.time;
  s.sentT = w.s.time;
  s.sent = sentN;
  s.stage = pick.d.inside ? 0 : 1;
  s.clearT = 0;
  s.flips++;
  steerHelp(w, c, pick.o, pick.d);
  if (pick.o.player) w.events.emit({ t: 'message', text: `Your ally's soldiers are coming to help.`, kind: 'info', colony: pick.o.id });
}

// ---------------------------------------------------------------------------
// All-out (sim/nestFlood.ts `forceAllOut`; claude/story/06-spec-levels-5-7-and-lengths.md §4): a colony with nowhere
// else to go throws everything at one enemy's queen
// ---------------------------------------------------------------------------

/** Every group but the queen's own (her chamber's workers stay with her as nurses), to marker III. */
function sendAllOut(w: World, c: Colony): void {
  for (const g of c.groups) if (raisesAnts(g) && g.type !== 'queen' && g.marker !== ATTACK) assignGroup(w, c, g.id, ATTACK);
}

/**
 * Go all in on t's queen: marker III on her (it follows her; nothing is carried home from it), every group but the
 * queen's own sent, the defence, the forage marker and any help for an ally lifted. No retreat, no gathering, no
 * cooldown: `allOutTick` keeps at it until she or the colony is dead. A skirmish never calls this.
 */
export function startAllOut(w: World, c: Colony, t: Colony): void {
  const b = warBrain(c);
  const q = w.antById.get(t.queen);
  b.allOut = true;
  b.target = t.id;
  b.start = Math.max(1, fighters(w, c).n);
  b.age = 0;
  b.defending = false;
  b.clearT = 0;
  b.joined = c.id;
  b.gather = undefined;
  b.t = 0;
  // whatever else the groups were doing is over: defence (II), forage (I), help for an ally (V)
  const s = c.aiAlly;
  if (s && s.ally >= 0) {
    s.ally = -1;
    s.sent = 0;
  }
  for (const i of [0, DEFEND, HELP]) {
    if (c.markers[i].placed) removeMarker(w, c, i);
    for (const g of c.groups) if (g.marker === i) g.marker = -1;
  }
  const m = c.markers[ATTACK];
  m.noGather = true;
  if (q && q.state !== AS.Dead) placeMarker(w, c, ATTACK, q.space, q.x, q.y);
  sendAllOut(w, c);
}

/** Every think: stay on the target's queen with everything (new hatchlings join), until she or the colony is dead. */
function allOutTick(w: World, c: Colony, b: WarBrain, dt: number): void {
  b.age += dt;
  b.t -= dt;
  if (b.t > 0) return;
  b.t = BALANCE.aiWar.every;
  const t = w.colony(b.target);
  const q = t ? w.antById.get(t.queen) : undefined;
  if (!t || !t.alive || !q || q.state === AS.Dead) {
    // the queen is dead: the war is won (the groups come home, as after any raid)
    b.allOut = false;
    delete c.markers[ATTACK].noGather;
    endRaid(w, c, true);
    return;
  }
  const m = c.markers[ATTACK];
  m.noGather = true;
  if (!m.placed || m.space !== q.space || sq(m.x - q.x) + sq(m.y - q.y) > 16) placeMarker(w, c, ATTACK, q.space, q.x, q.y);
  if (c.markers[0].placed) removeMarker(w, c, 0);
  sendAllOut(w, c);
}
