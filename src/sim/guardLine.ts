import { World } from './world';
import { Ant, AS, Carry, Colony, SURFACE } from './types';
import { casteOf } from './species';
import { BALANCE, GUARD } from './balance';
import { angleDiff, goToSurfacePoint, steerTo, turnToward } from './movement';
import { creatureHooks, friendlyCreature } from './combat';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';
import { arenaOf } from './arenaState';
import { underOrder } from './markers';

/**
 * Guard line (user note 2026-10-25: fighters stood "too compact … like they are fighting in a guard line like
 * EotU"). The fighters at a surface marker — every unit in the battle arena; elsewhere the castes that do not gather
 * (the rest forage the marker) — stand in a line across the marker facing its front, instead of milling in a crowd:
 *
 *  - rows of `perRow` ants (about √(n × `rowShape`), at least `perRowMin`), `spacing` × the largest body in the line
 *    apart, the rows `rowSpacing` × that behind one another and staggered by half a place;
 *  - places by id order (w.s.ants is in id order), centred on the marker; the front row stands on the marker;
 *  - the front faces the nearest enemy within `threatMm` of the marker (looked for every `faceEverySec`), and keeps
 *    that facing after the enemy is gone (no turning about once a fight is won); a new front must differ by
 *    `faceTurnRad` before the line wheels round. With no enemy ever seen it faces away from the nest (arena: the
 *    centre of the field). The facing is marker state (`MarkerSlot.face`), so it is in snapshots.
 *  - an ant walks back to its place only when pushed `leaveBodyLengths` off it, and stops `arriveBodyLengths` from
 *    it, so standing ants are not set off by every nudge. A place on rock or water falls back to the marker.
 *
 * Fights start from the line as before (combat preempts this) and the fighters come back to their places after.
 */

interface Line {
  ids: number[];
  /** spacing (mm) */
  s: number;
  perRow: number;
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
  let big = 0;
  for (const o of w.s.ants) {
    if (o.colony !== c.id || o.marker !== mi || o.task !== 'marker' || o.state === AS.Dead || o.space !== m.space || !inGuardLine(w, o)) continue;
    ids.push(o.id);
    big = Math.max(big, casteOf(o.caste).length);
  }
  const n = Math.max(1, ids.length);
  const perRow = Math.max(GUARD.perRowMin, Math.ceil(Math.sqrt(n * GUARD.rowShape)));
  updateFace(w, c, mi, ids);
  const f = m.face ?? 0;
  L = { ids, s: big * GUARD.spacing, perRow: Math.min(perRow, n), ux: dcos(f), uy: dsin(f) };
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

/** This ant's place in its marker's guard line (null when it has none). */
export function guardSlot(w: World, a: Ant, c: Colony, mi: number): { x: number; y: number; h: number } | null {
  const L = lineOf(w, c, mi);
  const k = L.ids.indexOf(a.id);
  if (k < 0) return null;
  const m = c.markers[mi];
  const row = Math.floor(k / L.perRow);
  const inRow = Math.min(L.perRow, L.ids.length - row * L.perRow);
  const col = k - row * L.perRow;
  const across = (col - (inRow - 1) / 2 + (row % 2 ? 0.5 : 0)) * L.s;
  // a charge (the marker on the enemy): the front row stands off short of it, and the fight starts from the line
  const back = row * L.s * (GUARD.rowSpacing / GUARD.spacing) + (m.onFoe ? L.s * GUARD.standOff : 0);
  // across the front: (−uy, ux)
  out.x = m.x - L.uy * across - L.ux * back;
  out.y = m.y + L.ux * across - L.uy * back;
  out.h = datan2(L.uy, L.ux);
  if (!w.walkable(m.space, out.x, out.y)) {
    out.x = m.x;
    out.y = m.y;
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
    else steerTo(w, a, p.x, p.y, dt, d < len * 2 ? 0.6 : 1);
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
