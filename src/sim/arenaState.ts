import type { World } from './world';

/**
 * Battle arena state (DESIGN 3.13), kept in `w.s.mode.arena` so snapshots, saves and replays carry it. This module
 * only reads it (no imports beyond the World type), so the combat, ant and creature code can ask "is this an arena
 * unit, and what is its team told to do?" without import cycles; the arena's own logic lives in `arena.ts`.
 */

/** What a team's units do: charge the nearest enemy, hold their ground, or stand still and never attack. */
export const STANCE = { CHARGE: 0, HOLD: 1, PASSIVE: 2 } as const;

export interface ArenaTeam {
  /** the colony that owns the team's units (ants belong to it; creatures carry it as their faction) */
  colony: number;
  stance: number;
  /** spawn point (surface mm): new units appear round it; holding units stay near it */
  x: number;
  y: number;
  /** where a charging team heads: the enemy unit nearest its own centre (refreshed every `ARENA.retargetSec`) */
  tx: number;
  ty: number;
  /** 1 while there is an enemy to charge */
  has: number;
  /** units spawned and lost so far */
  spawned: number;
  lost: number;
  /** living units and their total health (refreshed with the target) */
  alive: number;
  hp: number;
}

export interface ArenaState {
  teams: ArenaTeam[];
  /** arena centre (surface mm) */
  cx: number;
  cy: number;
  /** seconds since the first fight in this round (0 until two teams have units) */
  t: number;
  /** the team left standing once at least two have fought (−1 none yet) */
  winner: number;
  /** 1 once at least two teams have had units at the same time (a fight is on) */
  fought: number;
}

export function arenaOf(w: World): ArenaState | null {
  return (w.s.mode.arena as ArenaState | undefined) ?? null;
}

/** The arena team of a colony (undefined outside the arena or for another colony). */
export function arenaTeam(w: World, colony: number): ArenaTeam | undefined {
  const A = arenaOf(w);
  if (!A || colony < 0) return undefined;
  for (const t of A.teams) if (t.colony === colony) return t;
  return undefined;
}

/** A colony's stance in the arena; −1 outside the arena. */
export function stanceOf(w: World, colony: number): number {
  return arenaTeam(w, colony)?.stance ?? -1;
}
