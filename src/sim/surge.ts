import { World } from './world';
import { Ant, AS, Colony } from './types';
import { BALANCE } from './balance';
import { casteOf } from './species';
import { groupById } from './tiles';

/**
 * Saiy-Ants (Aurimyrmex fulgurans): the gold surge. Deterministic sim state
 * on the ant (`surgeT` seconds of gold left, `surgeCd` cooldown left); all
 * visuals (ripple, hair stretch, sparkles) are derived from these in render.
 */
const S = BALANCE.surge;

export function surgeDuration(a: Ant): number {
  return a.level >= 3 ? S.durationL3 : S.duration;
}

export function surgeCooldown(a: Ant): number {
  return a.level >= 2 ? S.cooldownL2 : S.cooldown;
}

export function canSurge(w: World, a: Ant): boolean {
  const c = w.colony(a.colony);
  return !!casteOf(a.caste).surge && (a.surgeT ?? 0) <= 0 && (a.surgeCd ?? 0) <= 0 && a.state !== AS.Dead && a.id !== c?.queen;
}

export function startSurge(w: World, a: Ant): boolean {
  if (!canSurge(w, a)) return false;
  a.surgeT = surgeDuration(a);
  w.events.emit({ t: 'surge', x: a.x, y: a.y, space: a.space, id: a.id });
  return true;
}

/** Timers (antSystem, every tick): when the gold runs out the cooldown starts. */
export function surgeTick(a: Ant, dt: number): void {
  // (snapped to zero within a millionth of a second so 4 s is exactly 80 ticks despite float steps)
  if ((a.surgeT ?? 0) > 0) {
    a.surgeT = a.surgeT! - dt > 1e-6 ? a.surgeT! - dt : 0;
    if (a.surgeT <= 0) a.surgeCd = surgeCooldown(a);
  } else if ((a.surgeCd ?? 0) > 0) a.surgeCd = a.surgeCd! - dt > 1e-6 ? a.surgeCd! - dt : 0;
}

export function surging(a: Ant): boolean {
  return (a.surgeT ?? 0) > 0;
}

/** Manual trigger for one control group (command `surgeGroup`): every ready ant of the group, in id order. */
export function surgeGroup(w: World, c: Colony, groupId: number): number {
  if (!groupById(c, groupId)) return 0;
  const tiles = new Set(c.tiles.filter((t) => t.group === groupId).map((t) => t.q));
  let n = 0;
  for (const a of w.s.ants) if (a.colony === c.id && a.tile >= 0 && tiles.has(a.tile) && startSurge(w, a)) n++;
  return n;
}

/** Ready / total surge-capable ants of a group (UI). */
export function surgeReady(w: World, c: Colony, groupId: number): { ready: number; total: number } {
  const tiles = new Set(c.tiles.filter((t) => t.group === groupId).map((t) => t.q));
  let ready = 0;
  let total = 0;
  for (const a of w.s.ants) {
    if (a.colony !== c.id || a.tile < 0 || !tiles.has(a.tile) || !casteOf(a.caste).surge || a.state === AS.Dead) continue;
    total++;
    if (canSurge(w, a)) ready++;
  }
  return { ready, total };
}
