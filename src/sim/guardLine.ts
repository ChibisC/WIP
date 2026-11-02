import { World } from './world';
import { Ant, AS, Carry, Colony, SURFACE } from './types';
import { casteOf } from './species';
import { BALANCE, GUARD, TRAIL } from './balance';
import { angleDiff, approachSurface, goToSurfacePoint, nearestEntrance, turnToward } from './movement';
import { creatureHooks, friendlyCreature } from './combat';
import { datan2, dcos, dhypot, dsin, hash01, sq } from './dmath';
import { arenaOf } from './arenaState';
import { nearestWalkable, underOrder } from './markers';

/**
 * Guard line (user note 2026-10-25: fighters stood "too compact … like they are fighting in a guard line like
 * EotU"; 2026-11-01: "fix up the lining up thing in battle arena cos that isnt natural for insects"). The fighters at
 * a surface marker — every unit in the battle arena; elsewhere the castes that do not gather (the rest forage the
 * marker) — gather in a loose crowd at the marker, facing its front, a body's room apart:
 *
 *  - places spread like seeds in a sunflower head (no rows, no columns), each ant `spacing` × its own body from its
 *    neighbours (the small in the middle, the big round the edge), the spread squashed `aspect` × wider across the
 *    front than deep; its front edge on the marker;
 *  - each place pushed off by the ant's own amount (`jitterAcross`, `jitterBack` × the spacing), each ant facing the
 *    front give or take `faceSpread` and swaying a little, and every `shuffleSec` or so (each on its own clock) it
 *    picks a new spot nearby — a milling crowd rather than a drilled line. All hashed from ids and ticks: no draws
 *    from the sim's random stream;
 *  - places by body size, then id (w.s.ants is in id order);
 *  - the front faces the nearest enemy within `threatMm` of the marker (looked for every `faceEverySec`), and keeps
 *    that facing after the enemy is gone (no turning about once a fight is won); a new front must differ by
 *    `faceTurnRad` before the crowd turns. With no enemy ever seen it faces away from the nest (arena: the centre of
 *    the field). The facing is marker state (`MarkerSlot.face`), so it is in snapshots.
 *  - an ant walks back to its place only when pushed `leaveBodyLengths` off it, and stops `arriveBodyLengths` from
 *    it, so standing ants are not set off by every nudge. A place on rock or water falls back to the marker.
 *
 * Fights start from the crowd as before (combat preempts this) and the fighters come back to their places after.
 */

interface Line {
  /** smallest body first, then by id */
  ids: number[];
  /** each one's room: `spacing` × its body length (mm) */
  room: number[];
  /** the crowd's area so far: Σ room² up to and including each one */
  cum: number[];
  ux: number;
  uy: number;
}

let lineTick = -1; // det-ok: derived per-tick cache
let lineState: unknown = null; // det-ok: derived per-tick cache
const lines = new Map<number, Line>(); // det-ok: derived per-tick cache, rebuilt from SimState

/** Does this ant stand in its marker's guard line (rather than forage it or take a termite squad place)? */
export function inGuardLine(w: World, a: Ant): boolean {
  if (a.space !== SURFACE || a.carry !== Carry.None) return false;
  if (w.s.mode.arena) return true;
  const cd = casteOf(a.caste);
  const c = w.colony(a.colony);
  if (cd.forage && cd.carry > 0 && !(c && underOrder(c, a, 'noGather'))) return false;
  return cd.termite !== 'nasute' && cd.termite !== 'major' && cd.termite !== 'sickle' && !cd.hook;
}

function lineOf(w: World, c: Colony, mi: number): Line {
  if (lineTick !== w.s.tick || lineState !== w.s) {
    lineTick = w.s.tick;
    lineState = w.s;
    lines.clear();
  }
  const key = c.id * 16 + mi;
  let L = lines.get(key);
  if (L) return L;
  const m = c.markers[mi];
  const ids: number[] = [];
  const lenOf = new Map<number, number>(); // det-ok: per-call scratch
  for (const o of w.s.ants) {
    if (o.colony !== c.id || o.marker !== mi || o.task !== 'marker' || o.state === AS.Dead || o.space !== m.space || !inGuardLine(w, o)) continue;
    ids.push(o.id);
    lenOf.set(o.id, casteOf(o.caste).length);
  }
  updateFace(w, c, mi, ids);
  // the small ones in the middle, the big ones round the edge — each kind at its own spacing (a crowd spaced for
  // its majors would scatter the minors)
  ids.sort((p, q) => lenOf.get(p)! - lenOf.get(q)! || p - q);
  const room = ids.map((id) => lenOf.get(id)! * GUARD.spacing);
  const cum: number[] = [];
  let acc = 0;
  for (const r of room) cum.push((acc += r * r));
  const f = m.face ?? 0;
  L = { ids, room, cum, ux: dcos(f), uy: dsin(f) };
  lines.set(key, L);
  return L;
}

/** The marker's front: toward the nearest enemy near it (checked now and then), kept once the enemy is gone. */
function updateFace(w: World, c: Colony, mi: number, ids: number[]): void {
  const m = c.markers[mi];
  const every = Math.max(1, Math.round(GUARD.faceEverySec * BALANCE.tickHz));
  if (m.face !== undefined && (w.s.tick + c.id * 7 + mi) % every !== 0) return;
  const team = w.teamOf(c.id);
  let best = sq(GUARD.threatMm);
  let tx = 0;
  let ty = 0;
  let seen = false;
  w.enemiesNear(m.space, team, m.x, m.y, GUARD.threatMm, (o, d2) => {
    if (o.state === AS.Dead || casteOf(o.caste).role === 'king') return false;
    if (d2 < best) {
      best = d2;
      tx = o.x;
      ty = o.y;
      seen = true;
    }
    return false;
  });
  if (m.space === SURFACE)
    w.creaturesNear(m.x, m.y, GUARD.threatMm, (cr, d2) => {
      if (cr.dead || cr.space !== SURFACE || friendlyCreature(w, team, cr) || creatureHooks.relation(cr) === 'ignore') return false;
      if (d2 < best) {
        best = d2;
        tx = cr.x;
        ty = cr.y;
        seen = true;
      }
      return false;
    });
  let want: number;
  const onFoe = seen && sq(tx - m.x) + sq(ty - m.y) < sq(GUARD.onMarkerMm);
  if (onFoe) m.onFoe = true;
  else delete m.onFoe;
  if (onFoe && ids.length) {
    // the marker is on the enemy (a charge): face the way the line is going, from where it stands to the marker
    let cx = 0;
    let cy = 0;
    for (const id of ids) {
      const o = w.antById.get(id)!;
      cx += o.x;
      cy += o.y;
    }
    cx /= ids.length;
    cy /= ids.length;
    want = sq(m.x - cx) + sq(m.y - cy) > 1 ? datan2(m.y - cy, m.x - cx) : (m.face ?? 0);
  } else if (seen) want = datan2(ty - m.y, tx - m.x);
  else if (m.face !== undefined) return;
  else if (arenaOf(w)) want = datan2(arenaOf(w)!.cy - m.y, arenaOf(w)!.cx - m.x);
  else {
    const e = c.entrances[0];
    want = datan2(m.y - (e?.sy ?? c.ny), m.x - (e?.sx ?? c.nx));
  }
  if (m.face === undefined || Math.abs(angleDiff(m.face, want)) > GUARD.faceTurnRad) m.face = want;
}

const out = { x: 0, y: 0, h: 0 }; // det-ok: scratch

/** This ant's place in its marker's crowd (null when it has none). */
export function guardSlot(w: World, a: Ant, c: Colony, mi: number): { x: number; y: number; h: number } | null {
  const L = lineOf(w, c, mi);
  const k = L.ids.indexOf(a.id);
  if (k < 0) return null;
  const m = c.markers[mi];
  // its own shuffle clock (ticks: integer, the same on every machine)
  const per = Math.max(1, Math.round(GUARD.shuffleSec * BALANCE.tickHz));
  const ep = Math.floor((w.s.tick + Math.floor(hash01(a.id, 1) * per)) / per);
  const s = L.room[k];
  const jx = (hash01(a.id, ep * 4 + 2) - 0.5) * 2 * GUARD.jitterAcross * s;
  const jy = (hash01(a.id, ep * 4 + 3) - 0.5) * 2 * GUARD.jitterBack * s;
  // a sunflower spread, each ant given its room's area (π·r² over the crowd so far ≈ the √3/2·s² each of close
  // packing), turned by the marker's own angle
  const AREA = 0.88 / Math.PI;
  const r = Math.sqrt((L.cum[k] - 0.5 * s * s) * AREA);
  const R = Math.sqrt(L.cum[L.cum.length - 1] * AREA);
  const th = k * 2.39996 + hash01(c.id * 64 + mi, 7) * 6.2832;
  // (a charge spreads into a broad, ragged front, as a swarm does when it meets the enemy)
  const asp = m.onFoe ? GUARD.chargeAspect : GUARD.aspect;
  const across = dcos(th) * r * asp + jx;
  // a charge (the marker on the enemy): the front edge stands off short of it, and the fight starts from the crowd
  const back = (dsin(th) * r + R) / asp + jy + (m.onFoe ? L.room[L.room.length - 1] * GUARD.standOff : 0);
  // across the front: (−uy, ux)
  out.x = m.x - L.uy * across - L.ux * back;
  out.y = m.y + L.ux * across - L.uy * back;
  out.h = datan2(L.uy, L.ux) + (hash01(a.id, ep * 4 + 4) - 0.5) * 2 * GUARD.faceSpread + GUARD.sway * dsin(w.time * 0.8 + (a.id % 97));
  if (!w.walkable(m.space, out.x, out.y)) {
    // (on the surface: the nearest open ground to its place — a pebble or a twig there, since 2026-11-01; else the marker)
    const q = m.space === SURFACE ? nearestWalkable(w, out.x, out.y) : null;
    out.x = q ? q.x : m.x;
    out.y = q ? q.y : m.y;
  }
  return out;
}

/**
 * Walk to this ant's place in the guard line and stand there facing the front. Returns false when it has no place
 * (the caller mills about the marker as before).
 */
export function holdGuardLine(w: World, a: Ant, c: Colony, mi: number, dt: number): boolean {
  const p = guardSlot(w, a, c, mi);
  if (!p) return false;
  const m = c.markers[mi];
  const len = casteOf(a.caste).length;
  const d = dhypot(p.x - a.x, p.y - a.y);
  const moving = a.state !== AS.Rally;
  if (d > len * (moving ? GUARD.arriveBodyLengths : GUARD.leaveBodyLengths)) {
    if (a.state === AS.Rally) {
      a.state = AS.Idle;
      a.st = 0;
    }
    // far off: the marker's own shared route (one flow field per marker: a field per place would be rebuilt for
    // every ant), then straight to the place from `directMm` out, so the line forms as it comes in rather than
    // funnelling through the marker
    const direct = w.s.mode.arena ? GUARD.directMmArena : GUARD.directMm;
    // (on the way round fights, not through them: combat v2.1; straight into its own place in the line)
    if (d > direct && dhypot(m.x - a.x, m.y - a.y) > direct) goToSurfacePoint(w, a, m.x, m.y, dt, `mk:${c.id}:${mi}`, 1, true);
    else approachSurface(w, a, p.x, p.y, dt, `mk:${c.id}:${mi}`, m.x, m.y, d < len * 2 ? 0.6 : 1, 8, true);
    a.alarm = Math.max(a.alarm, 0.15);
    return true;
  }
  a.v = 0;
  turnToward(a, p.h, dt, 4);
  if (a.state !== AS.Rally) {
    a.state = AS.Rally;
    a.st = 0;
  }
  return true;
}

/**
 * Trail traffic (user 2026-11-01: "after they all reach destination, some ants once in a while trail back to the nest
 * for a realism of how trails look … only like 2-3 + more depending on how many ants follow the trail so that your
 * army is viable for attacking still"): now and then one of the fighters standing at a surface marker walks back to
 * the nest's entrance and out to its place again. At most `TRAIL.trafficMin` + `trafficPer` × the group at once (never
 * more than `trafficMaxShare` of it); a standing ant starts on its own hashed clock — about once per round trip per
 * free place. Not in the battle arena. Fights preempt it (combat runs first). Returns true when it handled the tick.
 */
export function trailTraffic(w: World, a: Ant, c: Colony, mi: number, dt: number): boolean {
  const m = c.markers[mi];
  if (w.s.mode.arena || m.space !== SURFACE || a.space !== SURFACE || !c.entrances.length) {
    a.trf = 0;
    return false;
  }
  const L = lineOf(w, c, mi);
  const n = L.ids.length;
  const cap = Math.min(Math.floor(n * TRAIL.trafficMaxShare), Math.floor(TRAIL.trafficMin + TRAIL.trafficPer * n));
  const len = casteOf(a.caste).length;
  const tr = a.trf ?? 0;
  if (tr === 0) {
    // standing in its place: may it set off? (once a second, on its own tick)
    if (cap < 1 || a.state !== AS.Rally || (w.s.tick + a.id) % BALANCE.tickHz !== 0) return false;
    let busy = 0;
    for (const id of L.ids) if ((w.antById.get(id)?.trf ?? 0) !== 0) busy++;
    if (busy >= cap) return false;
    const e = c.entrances[nearestEntrance(c, m.x, m.y)];
    const trip = (2 * dhypot(e.sx - m.x, e.sy - m.y)) / Math.max(1, casteOf(a.caste).speed);
    // each free place starts about one trip per round trip: expected busy ≈ cap
    const p = (cap - busy) / Math.max(1, n - busy) / Math.max(1, trip);
    if (hash01(a.id, Math.floor(w.s.tick / BALANCE.tickHz) * 7 + 3) >= p) return false;
    a.trf = 1;
    a.state = AS.Idle;
    a.st = 0;
  }
  if (a.trf === 1) {
    const ei = nearestEntrance(c, m.x, m.y);
    const e = c.entrances[ei];
    if (dhypot(e.sx - a.x, e.sy - a.y) < Math.max(4, len * 1.5)) a.trf = 2;
    else {
      goToSurfacePoint(w, a, e.sx, e.sy, dt, `trf:${c.id}:${ei}`);
      return true;
    }
  }
  // on its way out again: to the marker, then back to its place in the crowd
  if (dhypot(m.x - a.x, m.y - a.y) < Math.max(markerReach(w, c, mi), len * 3)) {
    a.trf = 0;
    return false;
  }
  goToSurfacePoint(w, a, m.x, m.y, dt, `mk:${c.id}:${mi}`, 1, true);
  return true;
}

/** How near the marker a returning ant has to be to rejoin the crowd (its slots reach about this far). */
function markerReach(w: World, c: Colony, mi: number): number {
  const L = lineOf(w, c, mi);
  return L.room.length ? Math.sqrt(L.cum[L.cum.length - 1] * (0.88 / Math.PI)) * GUARD.aspect + L.room[L.room.length - 1] : 10;
}
