import type { Medals } from '../sim/story/types';

/**
 * How a level's medals read (the hub's card, the level-end screen, the Missions panel): the first medal is time, or
 * food stored on a level whose length is fixed (The Long Nights); then losses and the bonus objective.
 */
export function firstMedal(M: Medals): { name: string; need: string } {
  if (M.food) return { name: 'Food stored', need: `gold at ${M.food[0]} food in the stores at the end, silver ${M.food[1]}` };
  const t = M.time ?? [0, 0];
  return { name: 'Time', need: `gold under ${Math.round(t[0] / 60)} min, silver ${Math.round(t[1] / 60)}` };
}

export function lossesNeed(M: Medals): string {
  return `gold at ${M.losses[0]} ants lost or fewer, silver ${M.losses[1]}`;
}
