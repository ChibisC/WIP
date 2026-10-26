/**
 * Turning a lobby into a match (multiplayer brief, Part E): the shared seed
 * and the filled slots become the GameSetup every client builds the same
 * world from. Colony ids follow the filled slots in order, so a player's
 * number in the match is their colony id, and the host is always 0.
 */
import type { GameSetup } from '../sim/mapGen';
import type { World } from '../sim/world';
import { BORROWABLE } from '../sim/species';
import { TEAM_NAMES } from '../sim/arena';
import type { LobbySettings, Slot } from './messages';

export const DEFAULT_LOBBY: LobbySettings = { style: 'meadow', seed: 1, food: 1.2, popLimit: 300 };

/** Lobby teams 1–4 (0 = no team). In the simulation, lobby team t is team `TEAM_BASE + t` (colony ids stay below it). */
export const LOBBY_TEAMS = 4;
export const TEAM_BASE = 100;
export { TEAM_NAMES };
/** the battle arena's team colours (render/game/teamRings.ts), kept here so the lobby needs no renderer */
export const TEAM_COLORS = ['#d9473f', '#3f7fd9', '#4fb04a', '#e0b130'];

/** The castes a Gene Thief starts with when nobody picked any (the old fixed multiplayer choice). */
export const GENE_THIEF_DEFAULT = ['formica_mortar', 'fire_major'];

/** Only castes a Gene Thief can raise, each once, in BORROWABLE order. */
export function cleanBorrowed(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const want = new Set(list.filter((x): x is string => typeof x === 'string'));
  return BORROWABLE.filter((id) => want.has(id));
}

/** Two or three castes for a Gene Thief AI (the host picks them in the lobby; everyone gets the result). */
export function pickBorrowed(rand: () => number = Math.random): string[] {
  const pool = [...BORROWABLE];
  const out: string[] = [];
  const n = 2 + Math.floor(rand() * 2);
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return cleanBorrowed(out);
}

/** A lobby team number, made safe (0–4). */
export function cleanTeam(t: unknown): number {
  const n = Math.floor(Number(t));
  return n >= 0 && n <= LOBBY_TEAMS ? n : 0;
}

/** The simulation team of a filled slot (undefined: a team of its own). */
export function simTeam(s: Slot): number | undefined {
  const t = cleanTeam(s.team);
  return t ? TEAM_BASE + t : undefined;
}

/** Why these colonies cannot start as teams ('' when they can): everyone on one team would win at once. */
export function teamsBlocker(players: Slot[]): string {
  if (players.length < 2) return '';
  const sides = new Set(players.map((p, i) => (cleanTeam(p.team) ? `t${cleanTeam(p.team)}` : `c${i}`)));
  if (sides.size < 2) return `Everyone is on Team ${TEAM_NAMES[cleanTeam(players[0].team) - 1]}: put at least one colony on another team (or on no team).`;
  return '';
}

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
    colonies: players.map((p) => {
      const borrowed = cleanBorrowed(p.borrowed);
      return {
        species: p.species,
        player: p.kind === 'human',
        ai: p.kind === 'ai',
        // the Gene Thief raises the castes its player (or the host, for an AI) picked in the lobby
        borrowed: p.species === 'plagiaria' ? (borrowed.length ? borrowed : [...GENE_THIEF_DEFAULT]) : undefined,
        team: simTeam(p),
        developed: 3,
        startWorkers: 10,
        popLimit: s.popLimit,
        name: p.name,
      };
    }),
    // teammates start on neighbouring colony sites
    ...(players.some((p) => cleanTeam(p.team)) ? { groupTeams: true } : {}),
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
