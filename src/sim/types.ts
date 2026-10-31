import { SpeciesId } from './species';
import { NestGridData } from '../world/nestGrid';
import { TerrainParams } from '../world/terrain';

/**
 * Space id: 0 = the surface; 1..CAVE_BASE-1 = the nest of colony (space - 1);
 * CAVE_BASE and above = neutral caves and lairs (DESIGN 3.12). Every
 * underground space is an "area" with its own hex map.
 */
export const SURFACE = 0;
export const CAVE_BASE = 64;
export const nestSpace = (colony: number) => colony + 1;
/** Colony whose nest a space is (−1 for the surface and for caves). */
export const colonyOfSpace = (space: number) => (space > 0 && space < CAVE_BASE ? space - 1 : -1);
export const isCaveSpace = (space: number) => space >= CAVE_BASE;

export enum AS {
  Idle = 0,
  Groom,
  Wander,
  Scout,
  FollowTrail,
  ToFood,
  Collect,
  Return,
  ToStore,
  ToExit,
  Dig,
  HaulSpoil,
  ToDig,
  Nurse,
  CarryBrood,
  FeedLarva,
  TendQueen,
  Troph,
  TendAphids,
  CutLeaf,
  Garden,
  Necro,
  Rally,
  Guard,
  Attack,
  Grapple,
  Flee,
  Flung,
  Dead,
  Sting,
  Spray,
  /** unused: co-op hauling was removed (kept so the numbers of the states after it stay the same) */
  CoopCarry,
  Raid,
  /** unused: the army-ant bivouac was removed (army ants nest like other colonies; kept so later state numbers stay the same) */
  Bivouac,
  Recall,
  /** hell ants: creeping in with the mandibles cocked (the readable wind-up) */
  Hunt,
  /** hell ants: the mandibles fly up (one or two ticks) */
  Snap,
  /** hell ants: prey pinned against the horn (or impaled on the paddle) */
  Hold,
  /** climbing a large creature: to the foot, up a leg, riding its back, down again (sim/climbing.ts) */
  Climb,
  /** army ants: a link in a living bridge (eciton.ts) */
  Bridge,
  /** army ants: lying in a pothole in the trail (eciton.ts) */
  Plug,
}

/** Render pose hints (mirrors render/ants/antMaterial POSE ids). */
/** A special fight in progress, like Attack / Grapple: a hell ant mid-catch (hunting, snapping, holding) or an ant climbing a creature. */
export function snapping(s: AS): boolean {
  return s === AS.Hunt || s === AS.Snap || s === AS.Hold || s === AS.Climb;
}

export const POSE = { NONE: 0, GROOM_ANT: 1, GROOM_LEGS: 2, TROPH: 3, STING: 4, SPRAY: 5, DIG: 6, GRAPPLE: 7, ALARM: 8, CARRY: 9, PORTER: 10, GUARD: 11, BRIDGE: 12, PLUG: 13 } as const;

export enum Carry {
  None = 0,
  Food,
  Brood,
  Soil,
  Corpse,
  Leaf,
  Liquid,
}

export type Task = 'idle' | 'forage' | 'job' | 'haul' | 'garden' | 'tend' | 'guard' | 'marker' | 'cut' | 'raid';

export interface Ant {
  id: number;
  colony: number;
  caste: string;
  space: number;
  x: number;
  y: number;
  px: number;
  py: number;
  h: number;
  ph: number;
  /** current speed mm/s */
  v: number;
  hp: number;
  maxHp: number;
  age: number;
  state: AS;
  st: number; // time in state
  task: Task;
  taskT: number;
  tx: number;
  ty: number;
  /** target entity id (food, brood, enemy, marker) */
  tgt: number;
  /** target kind: 0 none, 1 food, 2 brood, 3 ant, 4 creature, 5 marker, 6 chamber, 7 aphid */
  tk: number;
  carry: Carry;
  carryId: number;
  carryAmt: number;
  /** liquid food in crop 0..1 */
  crop: number;
  /** personal search heading for this scouting trip (directional persistence) */
  scoutH: number;
  /** trophallaxis partner (ant id) */
  partner: number;
  /** seconds in mouth-to-mouth contact during trophallaxis */
  contact: number;
  /** remaining pause time (burst-and-pause walking) */
  pause: number;
  /** wander turn bias */
  turn: number;
  alarm: number;
  /** alarm rush (combat.ts): the heading up the alarm scent, and how long more to walk it (s) */
  rushH?: number;
  rushT?: number;
  /** grapple: target id and kind (3 ant, 4 creature), slot index */
  gId: number;
  gKind: number;
  gSlot: number;
  /** seconds spent waiting outside a target whose attack slots are all taken */
  waitT?: number;
  /**
   * Combat v2 (CHANGE_PLAN §16): the target whose attack slot this ant has reserved while closing in (its id; 0 none;
   * the slot is `gSlot`); and the reposition rule: the nearest it has come to its hold point and the seconds since it
   * last closed in (`blkD`, `blkT`), and the pause to sidestep round the ring (s; the sign is the side), 0 if none.
   */
  rsv?: number;
  /** flanking round the target to a slot on the far side: the way round (+1 / −1), 0 when not flanking */
  flk?: number;
  blkD?: number;
  blkT?: number;
  repT?: number;
  /** climbing / riding: the creature id (0 = on the ground) */
  rideId?: number;
  /** climbing: 0 walking to the foot of the rail, 1 up, 2 riding, 3 down (1–3: untouchable) */
  ridePh?: number;
  /** climbing: rail index, riding slot index, progress (up / down 0..1) or seconds riding */
  rideRail?: number;
  rideSlot?: number;
  rideT?: number;
  /** seconds before it may climb again */
  climbCd?: number;
  /** seconds spent walking to the leg (gives up after `climb.approachMax`) */
  rideWalk?: number;
  /** dropped off a dying creature: the tumble does not hurt */
  softLand?: boolean;
  /** venom stacks and remaining time */
  venom: number;
  venomT: number;
  venomDps: number;
  /** attack cooldown */
  cd: number;
  /** special ability cooldown (acid) */
  cd2: number;
  /** marker index 0..4 the ant's group is out at, −1 = home */
  marker: number;
  /** nest entrance index used */
  ent: number;
  /** ballistic flight when flung */
  fz: number;
  fvz: number;
  fvx: number;
  fvy: number;
  /** time since death */
  deadT: number;
  /** hint for renderer: pose id */
  pose: number;
  /** body-relative head yaw toward target */
  look: number;
  /** debuffs: slow (0..1) remaining time */
  slowT: number;
  /** stun time */
  stun: number;
  /** antennation/encounter cooldown */
  meetCd: number;
  /** path integration: last known home direction memory */
  lost: number;
  sizeVar: number;
  colorVar: number;
  /** spread-eagled (immobilised) by enemy grapplers */
  pinned: number;
  /** riding on a leaf (Atta minim hitchhiker) */
  ride: number;
  /** cooldown before joining another group transport */
  /** home brood tile (hex index in the colony's nest), −1 = unbound (queen, tile removed, raider) */
  tile: number;
  /** stat multiplier from the tile's upgrade level when raised */
  power: number;
  /** level of the ant (its tile's level: 1..3) */
  level: number;
  /** nest job: kind (JOB.*, 0 = none) and hex */
  jobK: number;
  jobQ: number;
  /** seconds without a route back to its own queen (dies when too long) */
  lostT: number;
  /** team (colonies on the same team are allies); older saves fall back to the colony id */
  team?: number;
  /** seconds since the ant last came through an entrance (scurry-in fade) */
  entT?: number;

  // ---- species extras (left undefined for species that don't use them, so snapshots of other species are unchanged)
  /** nasute glue ramp: target id, effective firing ticks on it, consecutive interrupted ticks; 1 while firing this tick */
  rampT?: number;
  rampN?: number;
  rampG?: number;
  fire?: number;
  /** glue burst hold: rooted until this tick (can still attack); can't be rooted again before rootImm */
  root?: number;
  rootImm?: number;
  /** termite worker: seconds left of an idle grooming / feeding interaction */
  idleT?: number;
  /** termite major: charge seconds left and cooldowns (charge, glue burst, alarm) */
  chT?: number;
  chCd?: number;
  glueCd?: number;
  alCd?: number;
  /** alerted by a major's alarm until this tick, and where it came from */
  alertUntil?: number;
  alX?: number;
  alY?: number;
  /** termite worker size: 0 male (5 mm), 1 female (6 mm, +10 % hp) */
  variant?: number;
  /** hell ants: snap cooldown; the held prey (id, kind 3 ant / 4 creature) and seconds held; set on prey: the holder */
  snapCd?: number;
  holdId?: number;
  holdKind?: number;
  holdT?: number;
  heldBy?: number;
  /** Saiy-Ants: seconds of gold surge left, and cooldown left */
  surgeT?: number;
  surgeCd?: number;
  /** army ants (eciton.ts): raid pulse phase (0 advance, 1 fall back, 2 wait), its timer and count; steps aside until (s) */
  ecPh?: number;
  ecT?: number;
  ecN?: number;
  ecY?: number;
  /** army ants: team carry helper — the porter it helps (0 none); a media's escorted porter (0 none) */
  helpOf?: number;
  ecE?: number;
  /** army ants: living bridge / pothole plug the ant is part of (index into the colony's `ecLinks`), −1 none */
  link?: number;
  /** army ants: crossing a living bridge — (link index + 1) × direction (+1 toward its marker end), and progress 0..1 */
  xing?: number;
  xt?: number;
  /** glued by a Termant soldier's burst: slowed (and formic acid hurts double) until this tick */
  glueT?: number;
}

export interface Brood {
  id: number;
  colony: number;
  /** 0 = egg (carried or dropped), 1 = larva incubating on its tile */
  stage: 0 | 1;
  caste: string;
  /** growth 0..1 (larva) */
  t: number;
  /** food paid toward the hatch cost so far */
  fed: number;
  /** seconds uncared for (fallen colony) */
  hunger: number;
  x: number; // nest coords (mm)
  y: number;
  carrier: number;
  /** brood tile (hex index) this individual is raised for */
  tile: number;
}

/** `wood`: deadwood (twig, branch, bamboo, palm frond, log, stump — in `from`) and chewed fragments ('chip'); termites only */
export type FoodKind = 'insect' | 'seed' | 'berry' | 'honeydew' | 'crumb' | 'corpse' | 'leaf' | 'fungus' | 'wood';

export interface Food {
  id: number;
  kind: FoodKind;
  space: number;
  x: number;
  y: number;
  px: number;
  py: number;
  h: number;
  amount: number;
  max: number;
  /** visual size (mm) */
  size: number;
  /** mass needed to move it (sum of carrier grip) */
  mass: number;
  /** carried by a single ant (id) */
  heldBy: number;
  /** for corpses: what it was (ant morph or creature kind) */
  from: string;
  /** for corpses of own colony */
  colony: number;
  /** ant and termite corpses: the age (s) at which the body starts sinking into the ground (then it is deleted) */
  sinkAt?: number;
  /** variant seed */
  v: number;
  /** jerk timer for group transport */
  jerk: number;
  /** spoil timer: food decays slowly when untouched */
  age: number;
  /** Termants: a piece bitten off a corpse remembers what it was (`from` of the corpse) and the gene samples it carries */
  gsrc?: string;
  gene?: number;
}

/** Hex tile kinds (EotU-style brood tile system). */
export type TileType = 'queen' | 'brood' | 'food' | 'highway' | 'fungus' | 'aphid' | 'thatch' | 'mound' | 'carton';

/** One placed hex tile in a colony's nest. */
export interface Tile {
  /** hex index in the nest grid */
  q: number;
  type: TileType;
  /** brood tiles: the caste raised here */
  caste?: string;
  /** upgrade level 1..3 */
  level: number;
  /** nest group id */
  group: number;
  /** living ant bound to this brood tile (0 = none) */
  ant: number;
  /** second ant (tiles with capacity 2 at level 3) */
  ant2: number;
  /** larva incubating on this tile, or the egg being brought for it (0 = none) */
  brood: number;
  /** cooldown (s) before the tile can receive another egg */
  wait: number;
  /** false while only planned (a ghost waiting for a worker to build it) */
  built: boolean;
  /** pending job on a built tile: 0 none, 1 upgrade, 2 delete */
  pend: number;
  /** completion points of the current build / upgrade / delete job */
  progress: number;
  /** Termant carton wall: hit points left (enemies chew through it) */
  hp?: number;
}

/** Adjacent same-type tiles form a group — the unit the player commands. */
export interface NestGroup {
  id: number;
  type: TileType;
  caste?: string;
  /** −1 = home column, 0..4 = marker I..V */
  marker: number;
}

export interface Entrance {
  /** top hex of the entrance tunnel in the nest (the ramp under the hole; the whole tunnel is NestGrid.tunnels) */
  q: number;
  /** surface hole */
  sx: number;
  sy: number;
  /** 1 while plugged with soil: nobody passes (extra entrances only; sim/entrances.ts) */
  shut?: number;
  /** seconds of plugging or unplugging left (the change applies when it reaches 0) */
  work?: number;
  /** throughput credit (ants that may pass now) and the sim time it was last topped up */
  cr?: number;
  crT?: number;
  /** a fallen colony's entrance caving in: 0 → 1 over ENTRANCE.collapseS */
  fall?: number;
}

/** One of the five pheromone markers (I–V). */
export interface MarkerSlot {
  placed: boolean;
  space: number;
  x: number;
  y: number;
  /** guard line (guardLine.ts): the heading the fighters at this marker face */
  face?: number;
  /** guard line: the marker is on an enemy (a charge): the line stands off short of it */
  onFoe?: boolean;
  /**
   * Orders for the groups sent to this marker (markers.ts markerOrder; user note 2026-10-25, as in EotU): no
   * attacking (they go after no enemy and only bite back when bitten), no gathering (they hold the marker instead of
   * collecting food there), no climbing (they fight creatures from the ground).
   */
  noAttack?: boolean;
  noGather?: boolean;
  noClimb?: boolean;
}

export const MARKER_COUNT = 5;

/** Termant gene stealing (termants.ts; TERMANT in balance.ts). */
export interface Genome {
  /** samples per source: a species id, or `cr:<kind>` for creatures */
  samples: Record<string, number>;
  /** castes stolen and active (at most TERMANT.maxStolen), in unlock order */
  stolen: string[];
  /** passive bonuses won from creature genes ('armor', 'speed'), each once */
  bonuses: string[];
  /** a caste waiting for one to be forgotten ('' none) */
  pending: string;
  /** 1: workers fetch corpses of species with genes still short first */
  corpsePriority: number;
  /** the castes whose first ant has hatched (the first hatch shimmers) */
  hatched: string[];
}

/** Army-ant swarm raid at one surface marker (eciton.ts; ECITON.raid / ECITON.guard). */
export interface EcRaid {
  /** 1 while the raid runs (raiders assigned); the marker position it was set up for */
  on: number;
  mx: number;
  my: number;
  /** the front centre, its heading, and the side of the next turn (±1) */
  x: number;
  y: number;
  h: number;
  turn: number;
  /** seconds with no raiders */
  idle: number;
  /** Soldier guard posts along the trail: x, y, facing — triples, entrance end first */
  posts: number[];
}

/** A living bridge over a gap or a pothole plug on an army-ant raid trail (eciton.ts; ECITON.bridge / plug). */
export interface EcLink {
  /** 1 bridge, 2 plug */
  kind: number;
  /** the marker whose trail it serves */
  mi: number;
  /** span ends (a plug: both the hole) */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** slot count, the ants in it in arrival order (0 = empty slot) */
  n: number;
  ants: number[];
  /** crossings counted in the current 10 s window, the last window's count, window timer, seconds of low traffic */
  cross: number;
  last: number;
  winT: number;
  lowT: number;
  /** 1 once every slot is filled (walkable), 0 while forming; 1 while dissolving */
  done: number;
  dissolve: number;
}

export interface ColonyStats {
  born: number;
  died: number;
  food: number;
  kills: number;
  lostQueen: boolean;
  peakPop: number;
  /** enemy brood carried off in raids */
  stolen: number;
}

export interface Colony {
  id: number;
  species: SpeciesId;
  name: string;
  /** human-controlled (stat multiplier `statMul`, player messages). Which human is local is client-side. */
  player: boolean;
  ai: boolean;
  /** colonies on one team are allies: they never fight, and allied ants open area tabs */
  team: number;
  alive: boolean;
  food: number;
  foodCap: number;
  /** Atta fungus biomass (converted to food) */
  fungus: number;
  queen: number;
  /** termites: the king (ant id), who lives in the royal chamber with the queen */
  king?: number;
  /** castes this colony can raise (one brood tile type each) */
  castes: string[];
  tiles: Tile[];
  groups: NestGroup[];
  nextGroupId: number;
  /** bumped whenever tiles change (cache key for flow fields) */
  tileVersion: number;
  entrances: Entrance[];
  markers: MarkerSlot[];
  eggT: number;
  /** eggs lying in the queen's pile */
  eggs: number;
  /** a larva could not grow for lack of food (status line) */
  starving: boolean;
  /** cap on total brood capacity set by the mode (sandbox: high) */
  popLimit: number;
  /** living / maximum workers and soldiers (recomputed each second; queen not counted) */
  workers: number;
  workersMax: number;
  soldiers: number;
  soldiersMax: number;
  /** failsafe timer (free nanitic when workers and food run out) */
  failsafeT: number;
  /** movement factor per nest hex (tiles slow, highways speed up); rebuilt with the tiles */
  hexSpeed: Float32Array | null;
  /** AI build planner memory. Kept in state so snapshots and rejoining clients match (colonyAI). */
  aiBuild?: { t: number; blocked: boolean; mix: Record<string, number>; chambers?: Array<{ q: number; kind: 'brood' | 'food' }>; tunnels?: number[] };
  /** enemies inside the nest, refreshed every second by the invasion check (combat) */
  intruders?: Array<{ x: number; y: number }>;
  /** army ants: the swarm raid at each marker (eciton.ts) */
  ecRaid?: EcRaid[];
  /** army ants: living bridges and pothole plugs on the raid trails (eciton.ts) */
  ecLinks?: EcLink[];
  /** Termants (termants.ts): gene samples and stolen castes, the wood store */
  genome?: Genome;
  wood?: number;
  /** AI forage planner memory (colonyAI). */
  /** the Home column's orders (markers.ts; user note 2026-10-25): no attacking, no gathering, no climbing */
  homeOrders?: { noAttack?: boolean; noGather?: boolean; noClimb?: boolean };
  aiForage?: { t: number; age: number; target: { x: number; y: number } | null; queenOut: boolean; scoutT?: number; scouted?: boolean; enemyAt?: number };
  /** rival AI war planner (sim/warAI.ts): raid target (−1 none), fighters at the start, raid age, cooldown until (game time), defending and seconds clear */
  aiWar?: { t: number; target: number; start: number; age: number; cooldown: number; defending: boolean; clearT: number };
  /** fungus garden capacity (Atta) */
  fungusCap: number;
  /** attack anything (true) or defend only (false) */
  aggressive: boolean;
  /** species ability: cooldown and remaining active time (s) */
  abilityCd: number;
  abilityT: number;
  /** surface location of the nest centre */
  nx: number;
  ny: number;
  /** the authored map's anthill site the colony stands on (its entrances open inside it) */
  site?: number;
  stats: ColonyStats;
  /** set by Recall: every group is in the home column */
  recall: boolean;
  /** seconds the nest alarm keeps sounding after intruders were seen inside */
  alarmT: number;
  aiT: number;
  aiMode: string;
  /** cached counts (recomputed each second): living adults per caste */
  counts: Record<string, number>;
  /** population used by brood tiles (Σ caste pop) */
  pop: number;
  /** living adult ants (excluding queen) */
  living: number;
  broodCount: number;
  /** invincible / infinite food toggles (sandbox) */
  invincibleQueen: boolean;
  infiniteFood: boolean;
  aggression: number;
  color: string;
  /** spoil heap volume per entrance (visual) */
  spoil: number[];
  /** pending dig requests by AI */
  aiPlan: number;
}

export interface AphidCluster {
  id: number;
  x: number;
  y: number;
  /** number of aphids */
  n: number;
  /** honeydew stored and ready to milk */
  dew: number;
  /** tended by colony (last), and time */
  owner: number;
  tendT: number;
  green: boolean;
}

export interface LeafPlant {
  id: number;
  x: number;
  y: number;
  /** remaining leaf area (fragments) */
  leaf: number;
  max: number;
  v: number;
}

export interface Creature {
  id: number;
  kind: string;
  space: number;
  x: number;
  y: number;
  px: number;
  py: number;
  h: number;
  ph: number;
  v: number;
  hp: number;
  maxHp: number;
  state: number;
  st: number;
  tgt: number;
  tk: number;
  tx: number;
  ty: number;
  homeX: number;
  homeY: number;
  cd: number;
  cd2: number;
  /** number of ants grappling it (recomputed each tick) */
  latched: number;
  latchGrip: number;
  /** ants on it (up a leg, riding or coming down), and the mount slots they hold (bit k = slot k) (recomputed each tick) */
  climbers?: number;
  rideMask?: number;
  /** boss phase */
  phase: number;
  /** telegraph/wind-up timer */
  wind: number;
  /** animation hint flags */
  anim: number;
  /** random per creature */
  v2: number;
  dead: boolean;
  deadT: number;
  scale: number;
  /** venom stacks */
  venom: number;
  venomT: number;
  venomDps: number;
  slowT: number;
  stun: number;
  /** owner colony for termites/hostile ants spawned as creatures (-1 = wild) */
  faction: number;
  /** generic extra data */
  data: Record<string, number>;
  /** glued by a Termant soldier's burst: slowed (and formic acid hurts double) until this tick */
  glueT?: number;
  /**
   * Threat (combat v2, creatureAI.ts): the ants that hurt it most lately, as pairs [ant id, threat, …] (at most
   * `combat2.threatMax`; each hit adds its damage × (1 + the caste's threat), decaying `threatDecay` a second).
   */
  thr?: number[];
}

export interface Projectile {
  id: number;
  kind: 'acid' | 'hairs';
  space: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  dmg: number;
  colony: number;
  /** target */
  tgt: number;
  tk: number;
  /** lobbed (mortar) shot: flies for `life` seconds to the aimed point, then lands */
  lob?: boolean;
  life?: number;
  /** splash radius on landing (mm, mortar level 3) */
  splash?: number;
  /** seconds of half speed on a hit (rapid sprayer level 3) */
  slow?: number;
}

/** A neutral underground area: a pre-dug cave or a creature's lair (DESIGN 3.12). */
export interface CaveDef {
  space: number;
  name: string;
  /** flavour: 'cave' (food cache), 'lair' (a creature's den) */
  kind: 'cave' | 'lair';
  entrances: Entrance[];
  /** surface centre (entrances sit around it) */
  nx: number;
  ny: number;
}

export interface SimSettings {
  /** wild creature abundance multiplier (0 = none); undefined = 1 */
  creatures?: number;
  /** authored maps: storms flood the map's flood zones (off unless the match turns it on) */
  floods?: boolean;
  queenDeathLoses: boolean;
  fog: boolean;
  autoWaves: boolean;
  waveInterval: number;
  eggRate: number;
  statMul: number;
  enemyStatMul: number;
  aggression: number;
  foodRespawn: number;
  /**
   * Multiplayer game speed (1, 2 or 4; undefined = 1): faster only when every player agrees (`speedVote`). Each
   * colony's vote, by colony id (0 = none): the speed it asks for or agrees to. Not simulation logic: the clients
   * run their tick clocks this much faster, all together.
   */
  gameSpeed?: number;
  speedVotes?: number[];
}

export interface SimState {
  version: number;
  tick: number;
  time: number;
  seed: number;
  rng: number;
  nextId: number;
  terrain: TerrainParams;
  /** underground maps keyed by space id (version ≥ 2; version 1 keyed them by colony id) */
  nests: Record<number, NestGridData | null>;
  /** neutral caves and lairs */
  caves: CaveDef[];
  colonies: Colony[];
  ants: Ant[];
  brood: Brood[];
  food: Food[];
  creatures: Creature[];
  aphids: AphidCluster[];
  plants: LeafPlant[];
  projectiles: Projectile[];
  settings: SimSettings;
  /** night factor 0 day .. 1 night */
  night: number;
  /** mode-specific serialized data */
  mode: Record<string, unknown>;
  /** multiplayer: the host's player id (may issue host commands such as AI takeover); default 0 */
  host?: number;
  /** authored maps with floods on: each flood zone's storm cycle (sim/floods.ts) */
  flood?: FloodState[];
}

/** One flood zone's storm cycle: phase 0 idle, 1 warning, 2 rising, 3 holding, 4 draining. */
export interface FloodState {
  phase: number;
  /** seconds left in the phase */
  t: number;
  /** game time of the next storm (while idle) */
  next: number;
  /** the water level now (−9999: dry) */
  level: number;
}
