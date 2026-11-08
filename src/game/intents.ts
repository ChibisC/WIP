/**
 * Intent poses (claude/performance/02-spec-responsiveness-client-visuals.md §2): on the frame an order is given, the
 * ants it moves start turning toward where it sends them — before the simulation has applied it (single-player: a
 * tick and the playout's latency, about 150 ms; multiplayer: the lockstep delay on top). Render only: the simulation
 * never sees it, so nothing here can desync or change a replay.
 *
 * Each ant's drawn heading is blended toward the order's point: the blend rises over 160 ms, meets the simulation's
 * own heading as it comes round (so its turn takes over without a seam), and fades after 1.1 s whatever happens (an ant the simulation sends elsewhere — say, home with food — turns back). A refused order fades it in
 * 200 ms (the graceful rollback).
 *
 * Only orders that send ants to a point they walk to directly: a surface marker moved (its ants) or a group sent to a
 * surface marker (the group's ants already up there) — not ants that are fighting, carrying, dead or already there.
 */
import { AS, Ant, Carry, Colony, SURFACE } from '../sim/types';

interface Intent {
  x: number;
  y: number;
  t0: number;
  seq: number;
}

const RISE_MS = 160;
const HOLD_MS = 1100;
const FADE_MS = 400;
const REJECT_MS = 200;
/** at most this much of the way round (the simulation's turn does the rest) */
const MAX_W = 0.85;
/** the most ants one order turns (a big group: the nearest are enough) */
const MAX_ANTS = 240;

function wrap(d: number): number {
  d = (d + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d - Math.PI;
}

export class Intents {
  private ants = new Map<number, Intent>();
  private rejected = new Map<number, number>();

  get size(): number {
    return this.ants.size;
  }

  /** Ants `ids` were just sent toward (x, y) by command `seq`. */
  add(seq: number, ids: readonly number[], x: number, y: number, now = performance.now()): void {
    for (const id of ids) this.ants.set(id, { x, y, t0: now, seq });
  }

  /** The simulation refused command `seq`: its intents fade out. */
  reject(seq: number, now = performance.now()): void {
    for (const it of this.ants.values())
      if (it.seq === seq) {
        this.rejected.set(seq, now);
        return;
      }
  }

  /** The heading to draw for ant `id` at (x, y), whose simulation heading (interpolated) is `h`. */
  heading(id: number, x: number, y: number, h: number, now: number): number {
    const it = this.ants.get(id);
    if (!it) return h;
    const age = now - it.t0;
    if (age >= HOLD_MS + FADE_MS) {
      this.ants.delete(id);
      return h;
    }
    const dx = it.x - x;
    const dy = it.y - y;
    if (dx * dx + dy * dy < 1) return h;
    const d = wrap(Math.atan2(dy, dx) - h);
    const t = Math.min(1, age / RISE_MS);
    let w = MAX_W * t * t * (3 - 2 * t);
    if (age > HOLD_MS) w *= 1 - (age - HOLD_MS) / FADE_MS;
    const r = this.rejected.get(it.seq);
    if (r !== undefined) w *= Math.max(0, 1 - (now - r) / REJECT_MS);
    // (h + w·d: as the simulation's own heading comes round, d → 0 and the drawn heading meets it — monotonically,
    // since w < 1 — so its turn takes over without a seam)
    return h + d * w;
  }

  /** Drop what has run out (call now and then). */
  prune(now = performance.now()): void {
    for (const [id, it] of this.ants) if (now - it.t0 >= HOLD_MS + FADE_MS) this.ants.delete(id);
    for (const [seq, t] of this.rejected) if (now - t > 2000) this.rejected.delete(seq);
  }

  clear(): void {
    this.ants.clear();
    this.rejected.clear();
  }
}

/** The page's intents (the ant renderers read them through `antHooks.heading`). */
export const intents = new Intents();

/**
 * The ants an order turns: the colony's own, on the surface, not dead, fighting, carrying or already within `near` of
 * the point; nearest first, at most MAX_ANTS. `member(a)`: the ant is one the order moves.
 */
export function intentAnts(ants: readonly Ant[], c: Colony, x: number, y: number, near: number, member: (a: Ant) => boolean): number[] {
  const out: Array<{ id: number; d: number }> = [];
  for (const a of ants) {
    if (a.colony !== c.id || a.space !== SURFACE || a.state === AS.Dead || a.id === c.queen) continue;
    if (a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Spray || a.state === AS.Flung) continue;
    if (a.carry !== Carry.None) continue;
    if (!member(a)) continue;
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < near) continue;
    out.push({ id: a.id, d });
  }
  if (out.length > MAX_ANTS) {
    out.sort((p, q) => p.d - q.d);
    out.length = MAX_ANTS;
  }
  return out.map((o) => o.id);
}
