import { World } from './world';
import { AS, Colony, SURFACE, colonyOfSpace, nestSpace } from './types';
import { casteOf, CASTES } from './species';
import { assignGroup, placeMarker, removeMarker } from './markers';
import { raisesAnts } from './tiles';
import { creatureKind } from './creatures/kinds';
import { sq } from './dmath';
import { BALANCE, NASUTE, TERMANT } from './balance';
import { genesNear } from './termants';
import { rivalsMayRaid } from './missions';

/**
 * The rival AI's war (Phase 12): its fighter groups defend the nest and raid
 * rivals, through the same markers a player uses.
 *
 * Every few seconds an AI colony:
 *  - **defends**: enemies (other teams' ants, hostile creatures) near one of
 *    its surface entrances or inside its nest get marker II, and every
 *    fighter group goes there; the marker is lifted once it has been clear
 *    for a while;
 *  - **attacks**: when its fighters clearly outweigh a rival's (the margin is
 *    divided by `settings.aggression`) and the opening peace is over, it puts
 *    marker III on that rival's queen and sends the fighters; it calls them
 *    home when the raid has cost too many of them, takes too long, or the
 *    rival has fallen.
 * Workers keep foraging (marker I, `forageTick`); the queen's group stays
 * home. State lives on the colony (`aiWar`), so it is deterministic and in
 * snapshots.
 */

const DEFEND = 1;
const ATTACK = 2;

export type WarBrain = NonNullable<Colony['aiWar']>;

export function warBrain(c: Colony): WarBrain {
  if (!c.aiWar) c.aiWar = { t: (c.id * 0.43) % BALANCE.aiWar.every, target: -1, start: 0, age: 0, cooldown: 0, defending: false, clearT: 0 };
  return c.aiWar;
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
  for (const g of c.groups) if (raisesAnts(g) && isFighter(g.caste) && g.type !== 'queen' && g.marker !== marker) assignGroup(w, c, g.id, marker);
}

function callHome(w: World, c: Colony, marker: number): void {
  if (c.markers[marker].placed) removeMarker(w, c, marker);
  for (const g of c.groups) if (g.marker === marker) assignGroup(w, c, g.id, -1);
}

/** The weakest reachable rival, by its defenders' weight and distance. */
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
    // Termants raid sooner a rival whose genes they nearly have
    const s = (def + 1) * (1 + d / 600) * (genesNear(c, o.species) ? TERMANT.ai.raidScoreMul : 1);
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
      callHome(w, c, ATTACK);
      b.target = -1;
      b.cooldown = w.s.time + (won ? W.cooldown * 0.5 : W.cooldown);
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

  // ---- Peace: raid when strong enough (in a mission, only once the story has set the war going).
  if (aggression <= 0 || w.s.time < W.firstRaid || w.s.time < b.cooldown || (!c.player && !rivalsMayRaid(w))) return;
  const own = fighters(w, c);
  if (own.n < W.minFighters) return;
  const tgt = pickTarget(w, c);
  const t = tgt ? w.colony(tgt.id)! : null;
  if (!tgt || !t || own.power < tgt.power * (W.margin / aggression) * (genesNear(c, t.species) ? TERMANT.ai.raidMarginMul : 1)) return;
  const q = w.antById.get(t.queen);
  if (!q || q.state === AS.Dead) return;
  b.target = tgt.id;
  b.start = own.n;
  b.age = 0;
  placeMarker(w, c, ATTACK, q.space, q.x, q.y);
  sendFighters(w, c, ATTACK);
  if (colonyOfSpace(q.space) === t.id && t.player) w.events.emit({ t: 'message', text: `${c.name} is marching on your nest!`, kind: 'warn', colony: t.id });
}
