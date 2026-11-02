import type { MapId, Pt } from '../../maps/types';
import type { SpeciesId } from '../species';
import type { TileType } from '../types';

/**
 * Story levels as data (claude/story/02-spec-gene-thief-chapter1-two-levels.md §5–6; docs/story/DESIGN-STORY.md).
 * A level names its map, the colonies, the stages with their objectives, the narration (keys into a text file),
 * the director's actors and scenes, the medals and the rewards. `sim/story/runner.ts` turns it into a mission that
 * the existing mission runner (`sim/missions.ts`) plays, deterministically, inside the simulation.
 */

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'brutal'];

/** A named point of the map's story data, or a point in mm. */
export type Where = string | Pt;

/** Data-driven objectives (each has a default goal text; `text` overrides it). */
export type Objective = (
  | { type: 'raise'; n: number }
  | { type: 'fighters'; n: number }
  | { type: 'build'; tile: TileType; n: number }
  | { type: 'dig'; hexes: number }
  | { type: 'collectFood'; amount: number }
  | { type: 'storeWood'; amount: number }
  | { type: 'killAnts'; rival: string; n: number }
  | { type: 'stealCaste'; caste: string }
  | { type: 'raiseCaste'; caste: string; n: number }
  | { type: 'killQueen'; rival: string }
  | { type: 'surviveTime'; s: number }
  | { type: 'surviveWave'; actor: string }
  | { type: 'killCreature'; actor: string }
  | { type: 'escort'; actor: string; to: Where; r?: number }
  | { type: 'protect'; actor: string; s: number }
  | { type: 'reach'; at: Where; r: number; n: number }
  | { type: 'enterNest'; rival: string; n: number }
) & {
  text?: string;
  /** shown, never needed to finish the stage */
  optional?: boolean;
};

/** An ant pose or creature idle a cue can hold. */
export type Anim = 'idle' | 'threat' | 'groom' | 'antennate' | 'drum' | 'troph' | 'dig' | 'carry' | 'feed';

/** Director cues (sim/story/director.ts). Every cue that waits on the world times out (STORY.cueTimeout s). */
export type Cue =
  /** walk to a point, or along a named path (natural walking: the flow field round banks and up ramps) */
  | { walkTo: Where; path?: undefined; speed?: number; anim?: Anim; timeout?: number; flag?: string }
  | { path: string; walkTo?: undefined; speed?: number; anim?: Anim; timeout?: number; flag?: string; reverse?: boolean }
  /** stand (walking there first when given a place), facing a point or another actor, for `s` seconds */
  | { holdAt?: Where; face?: Where | { actor: string }; s: number; anim?: Anim; flag?: string }
  /** loop a named path for `s` seconds (or `loops` times) */
  | { patrol: string; s?: number; loops?: number; speed?: number; flag?: string }
  /** keep near a point and fight only what comes within `r` mm (for `s` seconds; for ever when left out) */
  | { guard: Where; r: number; s?: number; flag?: string }
  /** wander inside a named zone for `s` seconds */
  | { wander: string; s: number; speed?: number; flag?: string }
  /** keep `dist` mm behind another actor for `s` seconds */
  | { follow: string; dist?: number; s: number; flag?: string }
  /** play an animation on the spot for `s` seconds */
  | { anim: Anim; s: number; flag?: string }
  /** turn toward a point or an actor */
  | { face: Where | { actor: string }; flag?: string }
  /** walk off the map at an edge point, or into the actor's colony's nest ('nest'); the actor is gone after */
  | { leave: Where | 'nest'; speed?: number; flag?: string }
  /** behaviour: passive (never fights), aggressive (fights whatever it meets), flee (runs to `to`, away from `from`) */
  | { mode: 'passive' | 'aggressive' | 'normal' }
  | { flee: Where; speed?: number; flag?: string }
  /** walk to a point fighting whatever is met on the way (an attack wave); done once there or mostly dead */
  | { charge: Where; speed?: number; flag?: string; timeout?: number }
  /** wait seconds, or until a story flag is set */
  | { wait: number }
  | { waitFlag: string; timeout?: number }
  /** set a story flag (captions, objectives, other scenes and the camera wait on flags) */
  | { flag: string }
  /** hand back to the normal AI */
  | { release: true };

/** A sequence of cues for one or more actors (each member walks it; group cues finish when the living members do). */
export interface Scene {
  actor: string;
  cues: Cue[];
  /** start when the stage begins (default), `at` seconds into it, or once a flag is set */
  at?: number;
  on?: string;
}

/** A level's cast: creatures, groups of a colony's ants, or a whole rival colony. */
export interface ActorDef {
  /** a creature kind (sim/creatures/kinds.ts) */
  creature?: string;
  /** ants of a story colony: [caste, how many] (`colony`: a rival key, or 'player') */
  ants?: Array<[string, number]>;
  colony?: string;
  /** a whole rival colony (behaviour cues: passive, aggressive, normal) */
  rival?: string;
  /** where it appears (a story point); `face` where it looks */
  at?: Where;
  face?: Where;
  /** an attack wave: its size scales with the difficulty's `wave` (and its fighters' health with `enemyStat`) */
  wave?: boolean;
  /** health × this (creatures; a gentle first level) */
  hp?: number;
  /** spawned when the level starts (default), or only by a stage's `spawn` action */
  spawn?: 'start' | 'action';
  /** directed from the moment it appears (default true); false: a normal creature or ant the level only names */
  directed?: boolean;
  /** passive from the start */
  passive?: boolean;
  /** the name objectives use ("the swarm") */
  label?: string;
}

/** A caption: a key into the level's narration text, said `at` seconds into the stage or once a flag is set. */
export interface Caption {
  key: string;
  at?: number;
  on?: string;
}

/** A short in-engine shot (letterbox, camera flight; client-side, sim/story never waits on it). */
export interface Shot {
  /** the camera keys; `follow` an actor instead of a fixed point while it walks */
  keys: Array<{ at: Where | { actor: string }; dist: number; yaw: number; t: number; pitch?: number }>;
}

/** Things a stage does as it begins (or at a time or a flag). */
export type Action =
  | { do: 'spawn'; actor: string }
  | { do: 'flood'; zone: number }
  | { do: 'flag'; flag: string }
  | { do: 'food'; at: Where; kind: 'insect' | 'berry' | 'seed'; from: string; scale: number; n?: number; spread?: number }
  | { do: 'shot'; shot: Shot | 'flight' }
  | { do: 'music'; mood: 'calm' | 'tense' | 'swarm' | 'assault' }
  | { do: 'raid'; rival: string }
  /** a gameplay tip (a note, not narration): key into the text file (`tip.<key>`) */
  | { do: 'tip'; key: string };

export interface TimedAction {
  at?: number;
  on?: string;
  actions: Action[];
}

export interface StoryStage {
  name: string;
  objectives: Objective[];
  say?: Caption[];
  scenes?: Scene[];
  /** on entering the stage (no `at`/`on`), at a time in it, or on a flag */
  events?: TimedAction[];
  /** from this stage on the rival colonies may raid the player */
  rivalRaids?: boolean;
}

export interface RivalDef {
  species: SpeciesId;
  /** the map site it nests on */
  site: number;
  name: string;
  /** pre-built nest (× the difficulty's `rival`) and starting workers */
  developed: number;
  startWorkers: number;
  /** population limit (× the difficulty's `rival`): keeps a level's rival beatable */
  popLimit?: number;
}

/** A bonus objective: the third medal. */
export type Bonus =
  /** steal `caste` before `flag` is set (e.g. before the first raid) */
  | { type: 'stealBefore'; caste: string; flag: string; text: string }
  /** lose no more than `max` ants from the moment `actor` (a wave) appears until it is beaten */
  | { type: 'waveLosses'; actor: string; max: number; text: string };

export interface Medals {
  /** game seconds: gold at or under [0], silver at or under [1], else bronze */
  time: [number, number];
  /** ants lost: gold at or under [0], silver at or under [1], else bronze */
  losses: [number, number];
  bonus: Bonus;
}

export interface StoryLevelDef {
  id: 'garden' | 'fireBanks';
  chapter: number;
  /** "Level 1" … */
  number: number;
  title: string;
  /** the island region its map node sits in (src/story/campaign.ts) */
  region: string;
  map: MapId;
  brief: string;
  /** the player's colony */
  player: { site: number; startWorkers: number; startFood: number; name: string };
  rivals: Record<string, RivalDef>;
  /** wild creatures besides the cast (settings.creatures; 0 none) */
  creatures: number;
  /** the level's own scale on enemy health and damage, times the difficulty's (default 1) */
  enemyStat?: number;
  /** aphid clusters and leafy plants placed in the map's zones */
  aphids: number;
  plants: number;
  /** the caste a win keeps for the campaign */
  reward: { caste: string };
  /** stolen castes may be brought in (slot rules: src/story/campaign.ts) */
  loadout: boolean;
  stages: StoryStage[];
  actors: Record<string, ActorDef>;
  medals: Medals;
  /** level-wide scenes, captions and actions, on game time (`at`, seconds since the level began) or flags */
  scenes?: Scene[];
  say?: Caption[];
  events?: TimedAction[];
  /** narration keys (src/story/text: the level's own keys are `<id>.<key>`) said on a loss and on the win */
  lose: string;
  win: string;
}
