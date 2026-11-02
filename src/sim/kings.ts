/**
 * Kings — the Termants' and the termites' (user note 2026-11-02): a king does no nest duties (no jobs, no foraging);
 * he walks round the queen inside her chamber (the queen's tiles, where her nanitics are raised) and fights intruders
 * who come in. Termites: `termites.ts kingTick` (intruders first, then this walk); Termants: `termants.ts termantKing`.
 */
import { World } from './world';
import { Ant, AS, Colony, POSE } from './types';
import { casteOf } from './species';
import { datan2, dcos, dhypot, dsin } from './dmath';
import { steerTo, turnToward } from './movement';
import { tileAt } from './tiles';
import { KING } from './balance';

/** Is (x, y) on one of the colony's queen tiles (the royal chamber)? */
export function inRoyalChamber(w: World, c: Colony, x: number, y: number): boolean {
  const g = w.nest(c.id);
  if (!g) return false;
  const t = tileAt(c, g.hexAt(x, y));
  return !!t && t.type === 'queen';
}

const RING_SCALES = [1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.35]; // det-ok: constant
const RING_TURNS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]; // det-ok: constant

/** An integer hash (no random numbers: the walk is a pure function of the king's id and the tick). */
function mix(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The king's waypoint now: on a ring round the queen, in her chamber. A new one every `KING.legS` s, `stepRad` further
 * round her (his own way round, all the way round and then back), with a little jitter — from his id and the leg alone,
 * so nothing is stored and saves, replays and every client agree. The ring: `radius(angle)` from her centre (a termite
 * queen's long body: a set gap off it), else an ellipse round her (`ringAlong` / `ringSide` × her length + `ringK` × his).
 * `clear(x, y)`: the point is off her body. False when no point near the ring will do.
 */
export function kingWaypoint(w: World, a: Ant, c: Colony, q: Ant, out: { x: number; y: number }, clear?: (x: number, y: number) => boolean, radius?: (ang: number) => number): boolean {
  const leg = Math.max(1, Math.round(KING.legS * 20));
  const t = w.s.tick + ((a.id * 97) % leg);
  const k = Math.floor(t / leg);
  const lap = Math.max(2, Math.round((2 * Math.PI) / KING.stepRad));
  const p = k % (2 * lap);
  const round = p < lap ? p : 2 * lap - p; // round her one way, then back
  const way = mix(a.id) & 1 ? 1 : -1;
  const jit = ((mix(a.id * 7919 + k * 104729) % 1000) / 1000 - 0.5) * KING.jitterRad;
  const ang = q.h + Math.PI + way * round * KING.stepRad + jit; // starting behind her
  const QL = casteOf(q.caste).length;
  const KL = casteOf(a.caste).length;
  const ea = QL * KING.ringAlong + KL * KING.ringK;
  const eb = QL * KING.ringSide + KL * KING.ringK;
  // the ring point, or the nearest that will do: a little nearer or farther, then a little further round either way
  for (const da of RING_TURNS) {
    let r0: number;
    if (radius) r0 = radius(ang + da);
    else {
      const ca = dcos(ang + da - q.h);
      const sa = dsin(ang + da - q.h);
      r0 = (ea * eb) / Math.sqrt(eb * ca * (eb * ca) + ea * sa * (ea * sa));
    }
    for (const f of RING_SCALES) {
      const x = q.x + dcos(ang + da) * r0 * f;
      const y = q.y + dsin(ang + da) * r0 * f;
      if (!inRoyalChamber(w, c, x, y) || !w.walkable(q.space, x, y) || (clear && !clear(x, y))) continue;
      out.x = x;
      out.y = y;
      return true;
    }
  }
  return false;
}

const wp = { x: 0, y: 0 }; // det-ok: scratch

/**
 * Walk round the queen: to the waypoint at a slow walk, then wait there facing her (grooming her now and then when
 * `groom`). False when there is no waypoint (the caller keeps him at his old place beside her).
 */
export function kingWander(w: World, a: Ant, c: Colony, q: Ant, dt: number, groom: boolean, clear?: (x: number, y: number) => boolean, radius?: (ang: number) => number): boolean {
  if (!kingWaypoint(w, a, c, q, wp, clear, radius)) return false;
  if (a.state !== AS.Idle) {
    a.state = AS.Idle;
    a.st = 0;
  }
  const d = dhypot(wp.x - a.x, wp.y - a.y);
  if (d > (a.v > 0 ? KING.arrive * 0.5 : KING.arrive)) {
    a.pose = POSE.NONE;
    steerTo(w, a, wp.x, wp.y, dt, KING.speed);
    return true;
  }
  a.v = 0;
  turnToward(a, datan2(q.y - a.y, q.x - a.x), dt, 3);
  a.pose = groom && (w.s.tick + a.id) % 200 < 200 * KING.groomShare ? POSE.GROOM_ANT : POSE.NONE;
  return true;
}
