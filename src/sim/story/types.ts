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

/** Every story level id, in campaign order (src/story/campaign.ts has the nodes and the unlock rules). */
export const STORY_LEVEL_IDS = ['garden', 'longNights', 'fireBanks', 'spiderMother', 'antleredKing', 'highWater', 'cartonKingdom'] as const;
export type StoryLevelId = (typeof STORY_LEVEL_IDS)[number];

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
  /** `n` of these rival colonies gone (their queens dead: killed, or drowned), in any order */
  | { type: 'killQueens'; rivals: string[]; n: number }
  /** hold out `s` seconds (or per difficulty: a boss level's preparation) */
  | { type: 'surviveTime'; s: number | Partial<Record<Difficulty, number>> }
  | { type: 'surviveWave'; actor: string }
  | { type: 'killCreature'; actor: string }
  | { type: 'escort'; actor: string; to: Where; r?: number }
  | { type: 'protect'; actor: string; s: number }
  | { type: 'reach'; at: Where; r: number; n: number }
  | { type: 'enterNest'; rival: string; n: number }
  /** the level's day/night clock (`dayNight`): met at dawn after night `n` */
  | { type: 'surviveNight'; n: number }
  /** chambers (tiles) upgraded to level 2 or more */
  | { type: 'upgrade'; n: number; tile?: TileType }
  /** food in the stores now (not gathered since the stage began) */
  | { type: 'storeFood'; amount: number }
  /** keep `n` ants within `r` mm of a point for `s` seconds without a break (a landmark held: the sap run) */
  | { type: 'hold'; at: Where; r: number; n: number; s: number; name?: string }
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
  | { release: true }
  /**
   * a titan digs into a colony's nest (sim/creatures/titanDig.ts): `into` a rival's key or 'player'; by hole `hole` (else the
   * nearest); done once it is inside (or its raid ended). It never gives up digging; `endRaid` sends it out.
   */
  | { digInto: string; hole?: number; flag?: string; timeout?: number }
  /** go back to cue `goto` of this scene (a loop: a hunter's rounds) */
  | { goto: number }
  /** rest on the spot (or walking there first), healing `heal` of its health a second, for `s` seconds */
  | { rest: Where; s: number; heal?: number; flag?: string };

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
  /** a group of creatures: [kind, how many] (a night's hunters); with `wave`, the counts scale with the difficulty */
  creatures?: Array<[string, number]>;
  /** creatures: spread over these story points in turn (the lairs they come out of; `at` is then unused) */
  from?: string[];
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
  /**
   * A boss's health marks (fractions, falling): the flag `hp:<actor>:<percent>` is set as its health drops below each
   * (e.g. `hp:mother:30`; scenes and captions wait on them), and `killed:<actor>` when it dies.
   */
  phases?: number[];
  /** a boss's own phase cuts (fractions of health) in place of its kind's (the wolf spider mother: [0.6, 0.3]) */
  bossCuts?: [number, number];
  /** a boss roams toward this point when no ant is near (its hunting goal; default: where it appeared) */
  goal?: Where;
  /**
   * a boss's health floor (a fraction of its health) until a flag is set: hurt to it, it is hurt no further for now (the
   * Spider Mother can't be killed on her rounds, only driven down her burrow; the fight to the death is the last stage)
   */
  floor?: { hp: number; until: string };
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
  | { do: 'food'; at: Where; kind: 'insect' | 'berry' | 'seed' | 'honeydew'; from: string; scale: number; n?: number; spread?: number }
  | { do: 'shot'; shot: Shot | 'flight' }
  | { do: 'music'; mood: 'calm' | 'tense' | 'swarm' | 'assault' }
  | { do: 'raid'; rival: string }
  /** the light changes now (the day/night clock does this on its own; a level may also force it): 0 day … 1 night */
  | { do: 'night'; level: number }
  /** a titan raiding a nest (digInto) walks back out and leaves (dawn) */
  | { do: 'endRaid'; actor: string }
  /** a gameplay tip (a note, not narration): key into the text file (`tip.<key>`) */
  | { do: 'tip'; key: string }
  /**
   * the weather for `s` seconds: a rain shower (the storm light, the ground wet; give a `flood` action too on a map with
   * flood zones) or a hot spell (ants on the surface walk slower: STORY.heatSpeed)
   */
  | { do: 'weather'; rain?: number; heat?: number }
  /** two male stag beetles (creature actors) lock jaws and wrestle now; the bigger tends to throw the other */
  | { do: 'wrestle'; a: string; b: string }
  /** a rival colony goes all-in on the player's queen (no retreat): its nest is about to flood (High Water) */
  | { do: 'allOut'; rival: string }
  /** the nests whose entrances are under water now start to flood underground (sim/nestFlood.ts) */
  | { do: 'floodNests' }
  /** a toast (a short note in the message log, not narration): key into the level's text (`<level>.<key>`) */
  | { do: 'note'; key: string; kind?: 'warn' | 'good' | 'info' };

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
  /** allies share a team (the AI allies' brain: they help each other); default a team of its own */
  team?: number;
}

/** A bonus objective: the third medal. */
export type Bonus =
  /** steal `caste` before `flag` is set (e.g. before the first raid) */
  | { type: 'stealBefore'; caste: string; flag: string; text: string }
  /** lose no more than `max` ants from the moment `actor` (a wave) appears until it is beaten */
  | { type: 'waveLosses'; actor: string; max: number; text: string }
  /** kill `actor` (a creature) before `flag` is set (e.g. before dawn, before it digs into the nest) */
  | { type: 'killBefore'; actor: string; flag: string; text: string }
  /** destroy one of these rival colonies before its nest floods (`dead:<rival>` before `nestFlood:<rival>`) */
  | { type: 'deadBefore'; rivals: string[]; text: string };

export interface Medals {
  /**
   * The first medal: game seconds (gold at or under [0], silver at or under [1], else bronze) — or, on a level whose
   * length is fixed (the nights), `food`: food in the stores at the end (gold at or over [0], silver at or over [1]).
   */
  time?: [number, number];
  food?: [number, number];
  /** ants lost: gold at or under [0], silver at or under [1], else bronze */
  losses: [number, number];
  bonus: Bonus;
}

/**
 * A level's own day and night (the island's night hunters): the light (`w.s.night`) and the flags `dusk:N` (the warning,
 * `dusk` s before), `night:N` and `dawn:N` follow from game time. The first day lasts `first` s, later days `day` s,
 * nights `night` s; dusk and dawn fade over `fade` s. After `nights` nights the clock stops at day.
 */
export interface DayNight {
  first: number;
  day: number;
  night: number;
  /** the last night's length when it differs (the longest night, with its titan) */
  lastNight?: number;
  dusk: number;
  fade: number;
  nights: number;
}

/** Wild creature lairs as underground areas (sim/areas.ts caves): the dens the night hunters come out of. */
export interface LairDef {
  name: string;
  /** a story point: the lair's mouth on the surface */
  at: string;
  food: number;
  /** drawn as a spider's silk-lined burrow with a turret rim (render) instead of a stony den */
  look?: 'den' | 'burrow';
}

/**
 * A surprise event (claude/story/06-spec §6): a marching column of another species, a wandering hunter, a windfall,
 * the weather or a rival's move, out of the blue. The level lists a pool; when the level starts each is rolled (its
 * `chance` × the difficulty's `events`, from a seeded hash, so the same seed gives the same events) and given a time in
 * its `window`. When it fires it sets the flag `ev:<id>` (level scenes with `on: 'ev:<id>'` play the party or the
 * creature; sim/story/surprises.ts), does its `actions` and says its caption. Big ones never overlap: a big one due while
 * another runs waits until that one's `dur` is over.
 */
export interface SurpriseDef {
  id: string;
  /** seconds after the level began (or after `after` was set) it may start: [earliest, latest] */
  window: [number, number];
  /** the window counts from this flag (default: the level's start); never before it */
  after?: string;
  /** never once this flag is set (e.g. the boss fight) */
  until?: string;
  /** chance on Normal (× the difficulty's `events`, at most 1); default 1 */
  chance?: number;
  /** only on this difficulty and harder */
  from?: Difficulty;
  /** a big one (a column, a swarm raid, a hunter): never two at once */
  big?: boolean;
  /** how long it keeps the map busy (s) */
  dur: number;
  actions?: Action[];
  /** narration said as it starts (`<level>.<key>`) */
  say?: string;
}

/** Ants of a species that is not in the level (a marching column): a nestless colony that only owns them. */
export interface VisitorDef {
  species: SpeciesId;
  name: string;
}

export interface StoryLevelDef {
  id: StoryLevelId;
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
  /** a win keeps for the campaign: a stolen caste, a trait (STORY.traits), or neither (medals only) */
  reward: { caste?: string; trait?: string };
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
  /** the level's own day and night */
  dayNight?: DayNight;
  /** creature lairs as underground areas */
  lairs?: LairDef[];
  /**
   * the player's nest comes pre-built (a developed colony), tile by tile, laid out the way the AI builds: one caste per
   * chamber (7-hex rosettes), the stores by the entrance, the passage and tunnels paved with highways. The founding ring
   * round the queen holds `player.startWorkers` worker tiles (at most 12). A caste not brought in is left out.
   */
  nest?: Array<{ type: TileType; caste?: string; n: number }>;
  /** surprise events (claude/story/06-spec §6) */
  surprises?: SurpriseDef[];
  /** visiting species' parties (actors name them as their `colony`) */
  visitors?: Record<string, VisitorDef>;
}
