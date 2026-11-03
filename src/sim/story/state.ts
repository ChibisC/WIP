import type { World } from '../world';
import type { Difficulty, StoryLevelDef } from './types';

/**
 * A story level's running state (inside the mission state, `w.s.mode.mission.story`): plain data, so snapshots,
 * saves and replays carry it, and every client computes the same.
 */

/** A member of the cast while the level runs. */
export interface StoryActor {
  name: string;
  /** 0 creature(s), 1 ants, 2 a whole rival colony */
  kind: number;
  /** entity ids (creature or ant ids; a colony id for kind 2) */
  ids: number[];
  /** members when it appeared */
  n0: number;
  /** 0 normal, 1 passive, 2 aggressive */
  mode: number;
  spawned: boolean;
  released: boolean;
  /** the scene running on it (index into `scenes`), −1 none */
  scene: number;
  /** game time it appeared; the player's deaths then (waves) */
  t0: number;
  died0: number;
  /** a wave: beaten (1) */
  beaten: number;
}

/** A scene running (or finished) on an actor. */
export interface StoryScene {
  actor: number;
  /** where its cues are: stage index and scene index in that stage's `scenes` */
  stage: number;
  idx: number;
  cue: number;
  /** seconds in the current cue */
  t: number;
  done: boolean;
}

export interface StoryState {
  level: StoryLevelDef['id'];
  diff: Difficulty;
  /** the stolen castes brought in (not counted as stolen in this level) */
  loadout: string[];
  /** story flags set so far, in order */
  flags: string[];
  actors: StoryActor[];
  scenes: StoryScene[];
  /** rival key → colony id */
  rivals: Record<string, number>;
  /** per objective of the current stage: met once (goals stay met) */
  latched: number[];
  /** timed captions, scenes and actions of the current stage already fired (their indexes, by kind) */
  firedSay: number[];
  firedScene: number[];
  firedEvent: number[];
  /** level-wide scenes, captions and actions fired ('scene3', 'say1', 'event0') */
  firedLevel: string[];
  /** caption keys said (a flag-triggered caption is said once) */
  said: string[];
  /** the player's deaths when the level began */
  died0: number;
  /** bonus objective: 0 open, 1 won, −1 failed */
  bonus: number;
  /** game time of the win (for the time medal) */
  endT: number;
  /** a dev log of cues that timed out or could not run */
  log: string[];
  /** the campaign's traits the player's colony has (STORY.traits; also on the colony: `Colony.traits`) */
  traits?: string[];
  /** a restart: the opening flight is skipped (the boss rule: straight to the preparation) */
  retry?: number;
  /** the player's food in the stores at the win (the food medal) */
  endFood?: number;
}

export function storyOf(w: World): StoryState | null {
  const m = w.s.mode.mission as { story?: StoryState } | undefined;
  return m?.story ?? null;
}

export function hasFlag(st: StoryState, f: string): boolean {
  return st.flags.includes(f);
}

export function setFlag(st: StoryState, f: string): boolean {
  if (st.flags.includes(f)) return false;
  st.flags.push(f);
  return true;
}

export function actorIndex(st: StoryState, name: string): number {
  for (let i = 0; i < st.actors.length; i++) if (st.actors[i].name === name) return i;
  return -1;
}
