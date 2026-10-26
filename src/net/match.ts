/**
 * Turning a lobby into a match (multiplayer brief, Part E): the shared seed
 * and the filled slots become the GameSetup every client builds the same
 * world from. Colony ids follow the filled slots in order, so a player's
 * number in the match is their colony id, and the host is always 0.
 */
import type { GameSetup } from '../sim/mapGen';
import type { World } from '../sim/world';
import type { LobbySettings, Slot } from './messages';

export const DEFAULT_LOBBY: LobbySettings = { style: 'meadow', seed: 1, food: 1.2, popLimit: 300 };

/** Filled slots in order: these become colonies 0, 1, 2… */
export function matchPlayers(slots: Slot[]): Slot[] {
  return slots.filter((s) => s.kind === 'human' || s.kind === 'ai');
}

export function matchSetup(players: Slot[], s: LobbySettings): GameSetup {
  const n = players.length;
  const size = n <= 2 ? 760 : 900;
  return {
    seed: s.seed,
    style: s.style,
    width: size,
    depth: size,
    colonies: players.map((p) => ({
      species: p.species,
      player: p.kind === 'human',
      ai: p.kind === 'ai',
      borrowed: p.species === 'plagiaria' ? ['formica_mortar', 'fire_major'] : undefined,
      developed: 3,
      startWorkers: 10,
      popLimit: s.popLimit,
      name: p.name,
    })),
    // neutral underground areas between the spawns
    caves: [
      { name: 'Root hollow', kind: 'cave', food: 70 },
      { name: 'Beetle den', kind: 'lair', food: 40 },
    ],
    food: s.food,
    settings: { queenDeathLoses: true, statMul: 1, enemyStatMul: 1, creatures: 1, ...(s.map && s.floods ? { floods: true } : {}) },
    ...(s.map ? { map: s.map } : {}),
  };
}

/**
 * Last queen standing: the winning team once only one team has a living
 * colony (−1 while the match goes on). Every client computes it from the
 * same state, so no message is needed.
 */
export function matchWinner(w: World): number {
  const teams = new Set<number>();
  for (const c of w.s.colonies) if (c.alive) teams.add(c.team);
  if (teams.size === 1 && w.s.colonies.length > 1) return [...teams][0];
  if (teams.size === 0) return -2; // everyone lost at once
  return -1;
}
