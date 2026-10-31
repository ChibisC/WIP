/**
 * Every tunable number of the nest economy in one place (Revision 2,
 * EotU-style). Values marked "EotU" come from the user's brief; the rest are
 * starting defaults chosen to fit them.
 */

export type Tier = 'nanitic' | 'worker' | 'soldier' | 'heavy';

export interface TierBalance {
  /** food to build a brood tile of this tier (EotU) */
  build: number;
  /** food drawn while one larva grows (EotU) */
  hatch: number;
  /** seconds for a larva to grow from egg to adult at full feeding */
  grow: number;
}

export const BALANCE = {
  // ---------------------------------------------------------------- jobs
  /** completion points every dig / build / upgrade / delete job needs (EotU) */
  jobPoints: 6,
  /** points per second a worker adds, by its tile level 1 / 2 / 3 (EotU) */
  workRate: [2, 4, 6],
  /** workers allowed on one soil hex (EotU) */
  digWorkersPerHex: 2,
  /** workers allowed on an entrance dig (EotU) */
  entranceDigWorkers: 7,
  /** how far (mm, × marker radius) a marker-group worker looks for nest jobs */
  markerJobReach: 1.6,

  // ---------------------------------------------------------------- tiers and castes
  tiers: {
    nanitic: { build: 0, hatch: 1, grow: 14 },
    worker: { build: 10, hatch: 2, grow: 18 },
    soldier: { build: 25, hatch: 5, grow: 32 },
    heavy: { build: 150, hatch: 15, grow: 60 },
  } as Record<Tier, TierBalance>,
  /** caste → tier (others fall back to their role: worker/minim → worker, soldier → soldier, major → heavy) */
  casteTier: {
    eciton_media: 'soldier',
    eciton_major: 'heavy',
    nasute_soldier: 'soldier',
    nasute_major: 'heavy',
    rhy_soldier: 'soldier',
  } as Record<string, Tier>,
  /**
   * Per-caste costs (user note 2026-10-24): every worker caste costs the same
   * to build; hatch cost and grow time scale with how strong the ant is.
   * Castes not listed use their tier's values.
   */
  castes: {
    // workers: build 10
    lasius_worker: { build: 10, hatch: 2, grow: 18 },
    formica_worker: { build: 10, hatch: 3, grow: 22 },
    fire_minor: { build: 10, hatch: 1.5, grow: 14 },
    atta_minim: { build: 10, hatch: 1, grow: 12 },
    atta_media: { build: 10, hatch: 2.5, grow: 20 },
    eciton_minor: { build: 10, hatch: 2, grow: 16 },
    eciton_submajor: { build: 16, hatch: 3, grow: 22 },
    plagiaria_worker: { build: 10, hatch: 2.5, grow: 20 },
    // soldiers
    lasius_soldier: { build: 20, hatch: 4, grow: 28 },
    fire_soldier: { build: 20, hatch: 3.5, grow: 24 },
    atta_soldier: { build: 24, hatch: 5, grow: 30 },
    eciton_media: { build: 28, hatch: 5, grow: 30 },
    formica_soldier: { build: 30, hatch: 6, grow: 36 },
    formica_mortar: { build: 30, hatch: 6, grow: 36 },
    formica_rapid: { build: 30, hatch: 6, grow: 36 },
    // majors
    fire_major: { build: 60, hatch: 10, grow: 44 },
    atta_major: { build: 70, hatch: 10, grow: 50 },
    eciton_major: { build: 90, hatch: 12, grow: 50 },
    // Nasute Termites, paid in wood: × the baseline worker (10 / 2 / 18) by NASUTE.broodCostWoodMul / broodTimeMul
    nasute_worker: { build: 10, hatch: 2, grow: 18 }, // × 1.0 / × 1.0
    nasute_soldier: { build: 18, hatch: 3.6, grow: 23.4 }, // × 1.8 / × 1.3
    nasute_major: { build: 35, hatch: 7, grow: 32.4 }, // × 3.5 / × 1.8
    // Sickle-Jaw Termites, paid in plant matter: × the baseline worker (10 / 2 / 18) by SICKLE.broodCostMul / broodTimeMul
    rhy_worker: { build: 10, hatch: 2, grow: 18 }, // × 1.0 / × 1.0
    rhy_soldier: { build: 20, hatch: 2.8, grow: 25.2 }, // × 2.0 / × 1.4
    // Hell ants (05-implementation-plan Step 2)
    hell_worker: { build: 10, hatch: 3, grow: 22 },
    hell_soldier: { build: 28, hatch: 6, grow: 34 },
    // Saiy-Ants (03-implementation-plan Step 2)
    aurimyrmex_worker: { build: 10, hatch: 3, grow: 22 },
    aurimyrmex_soldier: { build: 30, hatch: 6, grow: 36 },
    // Termants (claude/termyrms plan Step 1)
    termant_worker: { build: 10, hatch: 2.5, grow: 18 },
    termant_soldier: { build: 22, hatch: 4.5, grow: 30 },
  } as Record<string, TierBalance>,
  /** ants a brood tile holds at level 1 / 2 / 3 (data-driven: fire-ant minors get 2 at level 3) */
  capacity: { default: [1, 1, 1], fire_minor: [1, 1, 2] } as Record<string, number[]>,

  /** a nanitic is a smaller, weaker worker: multipliers on the species' basic worker */
  nanitic: { length: 0.78, hp: 0.6, bite: 0.6, speed: 0.92, carry: 0.7 },

  // ---------------------------------------------------------------- tiles
  /** food held by each queen tile (EotU) */
  queenTileFood: 10,
  /** food storage capacity by level (EotU) */
  storage: [10, 40, 100],
  storageBuild: 5,
  highwayBuild: 5,
  /** speed on a highway by level (EotU) */
  highwaySpeed: [1.1, 1.2, 1.25],
  /** speed on any other built tile (EotU: 35 % slower) */
  tileSpeed: 0.65,
  /** species tiles: build cost and per-level effect */
  fungus: { build: 15, cap: [60, 120, 200] },
  /**
   * Fighting movement (fix: ants spinning in combat). Headings turn at most
   * `turnRate` (rad/s, 360°/s) and ignore changes under `deadZone` (~5°); a
   * target closer than `nearZero` mm leaves the heading alone. (Attack slots,
   * waiting and spacing: `combat2`.)
   */
  combat: { turnRate: 6.283, deadZone: 0.087, nearZero: 0.3 },
  /**
   * Fighting a creature (user note 2026-10-25: "planted to their ground"): a latched ant stands still on the
   * ground and does not swing round with the body when the creature turns or walks. It bites while the body
   * is within `reach` body lengths beyond its hold line (combat v2: its front half on the outline, or the ring under
   * the body for a small ant); up to `release` beyond it, it steps after the body, keeping its place in the ring;
   * further, it lets go and closes in again on a free place beside the body; a body swinging into it pushes it back
   * out at `pushMmPerSec` × its length per second.
   */
  creatureHold: { reach: 0.45, release: 1.65, pushMmPerSec: 6 },
  /** creatures choosing which ant to attack: one straight behind counts as (1 + this) × the squared distance */
  creatureFrontBias: 1,
  /**
   * Soft separation (light collision): each ant is a circle of radius
   * `radiusOfWidth` x its body width (`widthOfLength` x its length); overlaps are
   * pushed apart by `strength` of the overlap per tick, at most `maxPush` x the
   * ant's length; the heavier ant moves less. Creatures push ants out of their
   * bodies (`creatureStrength`); ants never push creatures.
   */
  separation: { radiusOfWidth: 0.8, widthOfLength: 0.28, strength: 0.5, maxPush: 0.15, creatureStrength: 0.9, creatureMaxPush: 0.6, creatureAllyRoom: 1.3 },
  /**
   * Combat v2 (CHANGE_PLAN §16, project doc claude/combat/02-spec-combat-v2.md): spread-out, readable fights.
   *
   * Spacing (separation.ts): two allies who are both fighting keep `personalSpace` × the larger one's length
   * centre to centre, pushed at `fightStrength` of the overlap a tick (walking: separation.strength) with
   * `fightCapMul` × the usual cap; enemies who are not fighting each other keep only their body radii, so lines
   * can meet. Allies going for the same foe stand at its slots instead.
   *
   * Stopping at reach (combat.ts, slots.ts): a victim ant's outline is an ellipse `antHalfLen` × its length
   * along and `antHalfWidth` × it across (a creature's is its capsule). The attacker holds where its front half
   * (`frontHalf` − `jawOverlap`, × its length) meets that outline in its slot's direction, so only the mandibles
   * reach over; it latches within `arriveTol` × its length of that point, where it stands within its slot, and then
   * keeps to the hold point at most `holdFollow` × its walking speed (it settles in, never snaps).
   *
   * Slots by perimeter: n = clamp(floor(P / (`slotWidth` × La × `slotSpacing`)), `slotsMin`, `slotsMax`), P the
   * length of the line the attackers' centres stand on (the victim's outline pushed out by half the attacker's
   * length); a queen keeps at least `queenSlotsMin`. (The plan's spacing 2.2 gave 8 slots on a worker; 5.6 puts
   * neighbouring attackers about a personal space apart and gives the counts the spec asks for: a worker on a
   * worker 3, a Lasius worker on a ground beetle 9, a boss the cap.)
   *
   * Overflow and duels (combat.ts findTarget / waitForSlot): each ant already on a foe counts `crowdPenalty` more
   * (on the squared distance); a target with no free slot is skipped. Focus fire (no crowd penalty, may wait in a
   * full target's ring) only when the ant's marker is within `focusMarkerMm` of the foe or its side outnumbers the
   * foes in sight `focusOutnumber` to 1. Waiting ants stand on a ring at a personal space and look for a free slot
   * every `ringCheckSec`; an ant whose slot is more than `flankStep` rad round the ring sidles round it facing the
   * target at `flankSpeed` × its speed. A bitten ant turns on the
   * biter only when its own target is more than `keepTargetReach` × its length from its hold point.
   *
   * Reposition (EotU): an attacker that has not closed `blockedGain` × its length on its hold point in
   * `blockedSec` pauses attacking for `pauseMin`..`pauseMax` s and sidesteps round the ring at `sidestepSpeed`.
   *
   * Under large creatures: an ant whose height (`antHeight` × its length) is below a creature's underside
   * (`clearance[kind]` × the creature's length) walks under it: only the feet (circles of `footRadius` × the
   * creature's length, at least `footMinMm`) push it, and it may take a slot on a ring `underInset` × the body's
   * half-width inside the outline (under the body, among the legs).
   *
   * Large-creature AI (creatureAI.ts): threat per attacker (damage × (1 + caste threat)), decaying `threatDecay`
   * a second, at most `threatMax` attackers remembered; a creature changes target only for `threatSticky` × the
   * current one's threat. Splash attacks are aimed at the most ground ants among `aimDirs` directions; a creature
   * with `surroundN` ants within `surroundR` × its length and under `backOffHp` of its health backs off
   * `backOffLen` × its length. Bosses shake their riders off every `shakeEverySec` once riders ≥ `shakeAtFrac` of
   * the cap (`shakeWind` s telegraphed). A wolf spider drags its catch `dragLen` × its length out of the crowd.
   */
  combat2: {
    personalSpace: 1.6,
    fightStrength: 0.8,
    fightCapMul: 2,
    antHalfLen: 0.5,
    antHalfWidth: 0.14,
    frontHalf: 0.5,
    jawOverlap: 0.08,
    arriveTol: 0.15,
    holdFollow: 2,
    slotWidth: 0.28,
    slotSpacing: 5.6,
    slotsMin: 2,
    slotsMax: 24,
    queenSlotsMin: 8,
    crowdPenalty: 2.5,
    focusMarkerMm: 6,
    focusOutnumber: 4,
    ringCheckSec: 0.5,
    flankStep: 0.7,
    flankSpeed: 0.8,
    keepTargetReach: 1,
    blockedSec: 1,
    blockedGain: 0.1,
    pauseMin: 0.5,
    pauseMax: 1,
    sidestepSpeed: 0.6,
    antHeight: 0.3,
    clearance: {
      groundBeetle: 0.085,
      rove: 0.05,
      wolfSpider: 0.1,
      lithobius: 0.04,
      cutworm: 0,
      mantis: 0.1,
      stagBeetle: 0.08,
      tarantula: 0.12,
      hogna: 0.12,
      giantMantis: 0.1,
      scolopendra: 0.012,
    } as Record<string, number>,
    footRadius: 0.02,
    footMinMm: 0.5,
    underInset: 0.45,
    threatDecay: 0.1,
    threatSticky: 1.3,
    threatMax: 8,
    aimDirs: 8,
    surroundN: 10,
    surroundR: 0.6,
    backOffHp: 0.5,
    backOffLen: 0.15,
    shakeEverySec: 20,
    shakeAtFrac: 0.5,
    shakeWind: 1,
    dragLen: 1.5,
  },
  /**
   * Combat v2.1 (CHANGE_PLAN §17, user spec claude/combat/03-spec-anchor-and-flow-around.md).
   *
   * **Anchored attacks.** An ant holding a foe, firing a spray, holding its range as a shooter, or recovering
   * (`recoverSec` after a hold ends) does not move: separation treats it as a fixed obstacle. Its bites have phases
   * from the bite timer: the wind-up is the last `windupSec` before a bite, when it may turn toward its foe at
   * `windupTurn` rad/s; from the bite to the next wind-up its facing is locked. A shooter holding its range turns at
   * `shooterTurn`. A hold within `reachTol` × its length of the hold distance needs nothing; up to `stepMax` × its
   * length off (between bites) it takes one small step (`stepSpeed` × walking speed) and re-anchors; farther, the foe has
   * left reach: the hold ends where it stands. A grip drags on the ant held: it walks at half speed (`holdSlowSec`
   * renewed every tick). Two anchored ants planted too close (bodies overlapping, or holding different foes within
   * `settlePS` × a personal space) are settled by one small step of at most `settleCap` × `stepMax` × its length, round its own foe;
   * small steps are taken between bites — not in the wind-up, nor until `recoverSec` after a bite, the bite's gap taken
   * as `settleWindow` × the caste's attack interval. Creatures: every bite has a wind-up of `crWindupSec` (turning at most
   * `crWindupTurn` rad/s) and a recovery of `crRecoverSec`, still and facing locked.
   *
   * **No shoving.** Closing in, an ant is blocked when a teammate stands in its forward cone (`blockCone` rad each side)
   * within a personal space and it has not come `blockedGain` × its length closer in `blockedSec`. It backs off
   * `backOffLen` × its length over `backOffSec` (turning `backOffTurn` rad to the side it picked), then walks round the
   * fight on a ring a personal space (`ringPS`) outside the slots, at `ringSpeed` × walking speed, aiming `ringLook` rad
   * ahead, to the nearest free slot on that side. The side: more free slots, minus `allyWeight` × the teammates on the
   * way; ties by its id. Walking in a fight or to a marker, it steers round teammates in its way: `avoidLook` × its
   * length ahead, in a cone of `avoidCone` rad, turning up to `avoidTurn` rad.
   */
  combat21: {
    windupSec: 0.25,
    windupTurn: 3,
    shooterTurn: 2,
    reachTol: 0.35,
    stepMax: 0.6,
    stepSpeed: 0.8,
    recoverSec: 0.3,
    holdSlowSec: 0.1,
    settleCap: 0.5,
    settlePS: 0,
    settleWindow: 0.85,
    crWindupSec: 0.3,
    crWindupTurn: 3,
    crRecoverSec: 0.3,
    blockCone: 0.6,
    blockedSec: 0.3,
    blockedGain: 0.05,
    backOffLen: 0.75,
    backOffSec: 0.4,
    backOffTurn: 0.5,
    ringPS: 1,
    ringSpeed: 1,
    ringLook: 0.6,
    allyWeight: 1,
    avoidLook: 2,
    avoidCone: 0.7,
    avoidTurn: 0.9,
  },
  /**
   * Mounting (EotU, CHANGE_PLAN §16 step 8): only ants and termites mount. A caste is small (mounts large and huge
   * creatures), large (`largeCasteMm` long or more, or flagged `mount: 'large'`: mounts only huge ones) or flagged
   * `mount: 'none'` (queens and kings too). Climbable creatures are large, bosses huge; at most `capLarge` /
   * `capHuge` riders whatever the size (fewer where the authored mount slots run out). A colony's riders on a
   * creature are at most `ratio` of its ants fighting it (riders + ground attackers): over that, the longest-mounted
   * climbs down first; no ground force, no mounting. With riders ≥ `bonusAt` of the cap the creature takes
   * `bonusMul` × damage from everyone. Mount slots are authored `slotGap` × `refRiderMm` apart (tools/climb-data.ts).
   */
  mount: { ratio: 0.3, capLarge: 8, capHuge: 12, bonusAt: 0.5, bonusMul: 1.25, largeCasteMm: 7, refRiderMm: 4.5, slotGap: 1.2 },
  /**
   * Climbing large creatures and titans (CHANGE_PLAN §15.2): seconds up the leg (from the foot), riding and down,
   * the cooldown before climbing again, damage × while riding, how close (body lengths, or of the creature's
   * length, at least `joinMinMm`) to a leg an attacker must be to start, and how long it may walk to the leg. Who
   * mounts and how many: `mount` (combat v2).
   */
  climb: {
    up: 1.5,
    ride: 8,
    down: 1.5,
    cooldown: 6,
    damageMul: 1,
    joinBodyLengths: 3,
    joinOfCreature: 0.35,
    joinMinMm: 8,
    approachMax: 4,
  },
  /** leafcutters: fungus per unit of leaf delivered, food per unit of fungus eaten (other species get `leafAsFood` from a leaf) */
  atta: { leafToFungus: 1.2, fungusToFood: 1.6, leafAsFood: 0.3 },
  aphid: { build: 15, dewPerSec: [0.08, 0.13, 0.18] },
  thatch: { build: 15, broodSpeed: [0.05, 0.08, 0.12] },
  /** fire ants' sun-warmed brood mound: brood speed by level, times daylight (this fraction of it at night) */
  mound: { build: 15, broodSpeed: [0.08, 0.12, 0.16], night: 0.25 },
  /** all brood-speed bonuses together (thatch, mound) are capped at this */
  broodSpeedCap: 0.5,

  // ---------------------------------------------------------------- upgrades
  maxLevel: 3,
  /** upgrade points needed to reach level 2 / level 3 (EotU) */
  upgradeNeed: [0, 6, 12],
  /** points from each adjacent soil / wall hex (EotU) */
  wallPoints: 1,
  /** ant stats by tile level */
  levelHp: [1, 1.25, 1.5],
  levelDamage: [1, 1.2, 1.4],
  levelSpeed: [1, 1.05, 1.1],
  levelSize: [1, 1.05, 1.1],
  /** harvest: each ant takes its caste's carry × this at level I / II / III (co-op hauling removed, 2026-10-25) */
  levelCarry: [1, 1.25, 1.5],
  /**
   * Corpses (2026-10-25): a dead ant falls over (`antFall` s), then lies as food that only
   * enemies may take for `antFood` s; a dead termite is food for any ant for `termiteFood` s.
   * Then the body sinks into the ground (`sink` s) and is gone. Creature carcasses are unchanged.
   */
  corpse: { antFall: 0.5, antFood: 2, termiteFood: 7, sink: 0.6 },
  /** level-3 perks */
  perkAcidRange: 1.4,
  perkCarry: 1.5,
  perkStun: 0.6,
  /** mortar sprayers at level 3: acid splashes onto everything this close to the impact (mm) */
  perkMortarSplash: 7,
  /** rapid sprayers at level 3: each hit slows the target (seconds of half speed) */
  perkRapidSlow: 0.6,
  /** acid projectile speeds (mm/s): straight jets and lobbed mortar shots */
  acidJetSpeed: 90,
  acidLobSpeed: 70,
  /** share of the build cost refunded as seeds when deleting (EotU) */
  refund: 2 / 3,

  // ---------------------------------------------------------------- rival AI foraging (sim/colonyAI.ts)
  aiForage: {
    /**
     * Honeydew in an aphid colony counts this much per unit, up to `aphidCap` units, when the AI rates a spot for its
     * main forage marker. It was 4 with no cap: a full cluster near the nest outscored every insect and seed on the
     * map, and fire-ant colonies lived on one aphid colony's trickle all game (Phase 15 playtest).
     */
    aphidValue: 2,
    aphidCap: 4,
    /**
     * Tenders (black garden ants, fire ants) instead keep one worker group on the nearest aphid colony within
     * `tendRange` mm of the nest, under marker IV, once at least `tendMinGroups` worker groups forage — a steady
     * honeydew income beside the main forage column, as a player would run it.
     */
    tendRange: 200,
    tendMinGroups: 2,
    tendMinAphids: 8,
    /** termites' soldier-first foraging: after this long scouting a new source, the workers follow anyway */
    scoutGiveUpSec: 40,
  },
  /**
   * Food respawn by diet (mapGen.respawnSystem): while a living colony's own food (what it can eat) lying on the
   * surface is under this share of the wanted amount, new food of a kind it eats is dropped. Seeds and berries
   * piled up untouched on maps with only insect-eaters (army ants) and the respawn stopped, so they starved.
   */
  respawnDietShare: 0.5,

  // ---------------------------------------------------------------- rival AI war (sim/warAI.ts)
  aiWar: {
    /** seconds between decisions */
    every: 4,
    /** no raids in the opening minutes of a game */
    firstRaid: 480,
    /** fighters needed before raiding */
    minFighters: 10,
    /** own fighting weight needed, as a multiple of the target's defence (÷ aggression) */
    margin: 1.8,
    /** call the raid off below this share of the fighters it set out with */
    retreatAt: 0.4,
    /** call it off after this long (s) */
    maxRaid: 240,
    /** seconds before the next raid (half after a win) */
    cooldown: 150,
    /** enemies this close to an entrance (mm) are attacked */
    defendRadius: 90,
    /** seconds clear before the defenders go home */
    clearFor: 12,
  },

  // ---------------------------------------------------------------- spawning
  startWorkers: 3,
  /** eggs the queen keeps in her pile */
  /** eggs the queen holds ready inside her (EotU: a worker pulls each one from the tip of her abdomen) */
  eggPileMax: 6,
  /** seconds a worker takes to pull an egg from the queen's abdomen */
  eggPullSec: 0.6,
  /** a pre-staged larva waits at this fraction while its tile's ant lives (EotU) */
  prestage: 0.5,
  /** seconds a tile waits after losing its larva */
  larvaLossCooldown: 10,
  /** failsafe: no workers and no food → a free nanitic, at most this often (s) */
  failsafeEvery: 12,

  // ---------------------------------------------------------------- areas
  /** seconds an ant with no route back to its queen survives */
  lostDeathTime: 30,

  /** simulation ticks per second (the ramp and hold timers count ticks) */
  tickHz: 20,

  // ---------------------------------------------------------------- hell ants (docs/creatures/hell-ant.md)
  snap: {
    /** creatures up to this body length (mm) can be snapped; bigger ones are only grappled */
    preyCreatureLength: 12,
    /** damage-over-time ticks while pinned, seconds apart */
    dotEvery: 0.5,
    /** a hunt (the cocked, creeping wind-up) gives up after this long, or when the prey gets this many body lengths away */
    huntMax: 4,
    huntLeash: 2.5,
    /** speed while creeping in on the prey (× normal) */
    creep: 0.35,
    /** seconds of the snap itself (mandibles fly up) */
    snapTime: 0.1,
    /** a dropped prey is stunned this long */
    dropStun: 0.4,
    /** after the prey dies the hell ant feeds on it this long before dropping it */
    feed: 0.8,
    /** paralysing sting while holding: seconds of half speed on the prey */
    stingSlow: 2,
    /** where the prey is held: forward of the ant's centre, × body length (the mandible–horn socket) */
    holdForward: 0.5,
    /** presentation only (never read by the sim): an impale shakes the camera and freezes the picture briefly when the camera is this close (mm) */
    shakeAt: 60,
    shake: 0.6,
    hitStop: 0.08,
  },

  // ---------------------------------------------------------------- Saiy-Ants gold surge (docs/creatures/aurimyrmex-fulgurans.md)
  surge: {
    duration: 4,
    /** level-3 tiles */
    durationL3: 5,
    cooldown: 20,
    /** level-2 tiles and up */
    cooldownL2: 14,
    /** visual ramps (render only, derived from surgeT) */
    rampIn: 0.3,
    rampOut: 0.5,
    speedMul: 1.5,
    damageMul: 1.6,
    attackRateMul: 1.25,
    /** presentation only: gold speed lines every this many seconds, for at most this many ants, when the camera is closer than this (mm) */
    trailEvery: 0.12,
    trailCap: 200,
    trailMaxDist: 260,
  },
};

/**
 * Nasute Termites (Nasutitermes corniger) — the user's spec values
 * (docs/creatures/nasutitermes.md, skill implement-nasute-termites §3).
 * Multipliers (`Mul`) are relative to the baseline worker ant, the Black
 * Garden Ant worker (hp 16, speed 16 mm/s, bite 2.6 every 0.9 s = 2.89 dps;
 * brood build 10 / hatch 2 / grow 18). The resolved numbers live in the
 * caste table (species.ts) and `BALANCE.castes`, with the multiplier noted.
 * The ramp values are the user's and must not change.
 */
export const NASUTE = {
  displayName: 'Nasute Termites',
  // kit v2.2 (2026-10-25): the worker is small and round, 4.2 mm (male 3.9 / female 4.5), clearly smaller than the sickle-jaw's
  sizeMm: { workerFemale: 4.5, workerMale: 3.9, nasuteSoldier: 5.0, majorSoldier: 6.5, king: 8.4, queen: 25.4 },
  worker: { hpMul: 0.7, speedMul: 0.8, biteDpsMul: 0.3, femaleHpBonus: 0.1 },
  nasute: { hpMul: 0.8, speedMul: 0.85, minDistanceBodyLengths: 1.5 },
  major: { hpMul: 3.0, speedMul: 0.75, meleeDpsMul: 1.5 },
  /** the king takes no damage and dies with the queen; he bites weakly (user note 2026-10-25) */
  king: { hpMul: 4.0, biteDpsMul: 0.5 },
  /** the nasute's ramping glue stream — the user's values, keep exactly */
  ramp: { startDps: 2, capDps: 20, rampSec: 6, graceSec: 0.5, rangeBodyLengths: 5, ignoresArmor: true },
  majorCharge: { triggerRangeBodyLengths: 4, speedMul: 1.6, maxSec: 1.5, cooldownSec: 4 },
  majorGlueBurst: {
    holdSec: 1.0,
    cooldownSec: 6,
    /** after a hold ends, the target can't be rooted again for this long */
    reRootImmunitySec: 2,
    /** halved on large targets: ants of at least `largeMass`, boss creatures and creatures of at least `largeLength` mm */
    largeTargetHoldMul: 0.5,
    largeMass: 8,
    largeLength: 20,
  },
  majorAlarm: { radiusBodyLengths: 12, alertSec: 8, cooldownSec: 3 },
  /** escort ring: nasutes this many body lengths outside the workers' work area; behind majors by this many */
  escort: { ringBodyLengths: 3, behindMajorsBodyLengths: 2, majorNearBodyLengths: 6 },
  /** wood: 1 wood = 1 food unit of the ant economy */
  wood: {
    bitesPerFragment: 4,
    biteIntervalSec: 0.3,
    /**
     * Wood per carried fragment. The spec's starting point was 1; calibrated
     * (tools/termite-income.ts) so that wood income per worker-minute is within
     * ±10 % of the Black Garden Ant's food income.
     */
    woodPerFragment: 3,
    sources: { twig: 10, branch: 40, bamboo: 60, palmFrond: 30, log: 150, stump: 300 } as Record<string, number>,
    /** chance of each source kind when deadwood falls */
    mix: { twig: 0.3, branch: 0.3, palmFrond: 0.15, bamboo: 0.1, log: 0.1, stump: 0.05 } as Record<string, number>,
    /** diameter / length on the ground (mm), for placement and models */
    size: { twig: 7, branch: 18, bamboo: 22, palmFrond: 26, log: 34, stump: 26 } as Record<string, number>,
    /** sources guaranteed near each termite nest at the start (twigs and branches) */
    startNear: 2,
  },
  broodCostWoodMul: { worker: 1.0, nasute: 1.8, major: 3.5 },
  broodTimeMul: { worker: 1.0, nasute: 1.3, major: 1.8 },
  /** final share of soldier brood growth drawn as a pale presoldier (render only) */
  presoldierFraction: 0.25,
  /** render: the 0.6 s maturation settle (kit SETTLE) */
  settleSec: 0.6,
  /** termite corpses as food for ants, × the baseline worker ant's corpse (5 food) */
  corpseFoodForAntsMul: { worker: 0.7, nasute: 0.7, major: 2.0, king: 3.0, queen: 6.0 } as Record<string, number>,
  /** idle in-nest life: chance per idle decision of grooming / feeding a nestmate, and seconds it lasts */
  idle: { interactChance: 0.45, minSec: 2, maxSec: 4 },
  /** termites hug walls: path cost of nest cells beside soil (× 1) */
  wallHug: 0.9,
  /**
   * Royals (model kit v2.1, claude/termite-royals/00-ROYALS-UPDATE.md): one queen per colony (the
   * user's call, 2026-10-25), lying along the royal chamber. The king stands beside her abdomen,
   * `kingAlong` of its length behind her thorax, `kingGapMm` clear of her.
   */
  royals: {
    kingAlong: 0.28,
    kingGapMm: 0.25,
  },
  ai: {
    soldierFraction: 0.2,
    nasutePerMajor: 3,
    scoutNasutes: 2,
    minNasutesPerForageColumn: 2,
    /** soldier-first foraging: the scouts hold a new wood source this long, clear of enemies, before the workers come */
    scoutSec: 3,
    /** enemies this close to the forage marker keep the workers home (and bring the majors), remembered this long */
    enemyRadius: 60,
    enemyMemorySec: 30,
  },
} as const;

/**
 * Sickle-Jaw Termites (Rhynchotermes perarmatus; docs/creatures/rhynchotermes-perarmatus.md,
 * claude/sickle-jaw-termites/implement-sickle-jaw-termites.md §3). Multipliers (`Mul`) are relative to
 * the baseline worker ant (hp 16, 16 mm/s, 2.89 bite dps); the resolved numbers live in the caste
 * table (species.ts). The grab-and-squirt values are the user's starting values (sim/sickleJaws.ts).
 */
export const SICKLE = {
  displayName: 'Sickle-Jaw Termites',
  /** kit v2.1; queen: the kit model (physogastric, 22.5 mm abdomen); soldier < worker */
  sizeMm: { worker: 5.8, soldier: 4.5, king: 8.5 },
  worker: { hpMul: 0.75, speedMul: 0.8, biteDpsMul: 0.3 },
  soldier: { hpMul: 0.8, speedMul: 0.9 },
  /** the king takes no damage and dies with the queen; he bites weakly (user note 2026-10-25) */
  king: { hpMul: 4.0, biteDpsMul: 0.5 },
  grab: {
    /**
     * × soldier length, centre to the target's edge. 0.6 (the spec's 1 made them grab from too far: user note
     * 2026-10-25, "they should be a short ranged fighter"): just past the nasus tip
     */
    lungeRangeBodyLengths: 0.6,
    /** = the kit's LUNGE_SEC */
    lungeSec: 0.55,
    /** = the kit's LUNGE_SNAP: the grab resolves round(snapAt × lungeSec × 20) = 6 ticks in */
    snapAt: 0.58,
    /** the target must still be within range + this many body lengths at the snap */
    snapSlackBodyLengths: 0.25,
    /** dealt once, on the snap */
    biteDamage: 3,
    missCooldownSec: 1.0,
    /** victims up to this × the soldier's length can be grabbed (never bosses or queens) */
    maxTargetSizeMul: 2.0,
  },
  acid: {
    /** the ramp (inferno-style): pure damage, ignores armour */
    startDps: 2,
    capDps: 18,
    rampSec: 6,
    /** targets too big to grab: the same ramp while within range (it resets out of range) … — contact range: the nasus
     *  tip touching the target (0.45; the spec's 1 squirted from a distance, user note 2026-10-25) */
    freeTargetRangeBodyLengths: 0.45,
    /** … plus a bite every this many seconds */
    freeTargetBiteInterval: 1.0,
  },
  alarm: { radiusBodyLengths: 12, alertSec: 8, cooldownSec: 3 },
  /**
   * Eisner's defensive row (user notes 2026-10-25: along the trail the workers really walk, wide enough that they
   * stay inside it, spare soldiers spread along it): at a surface marker the guards stand on both sides of the
   * workers' route from the marker back to the nest (the home flow field traced from the marker, refreshed every
   * `trailRefreshSec`), `halfWidthBodyLengths` out from it, evenly spread over its whole length (at least
   * `minSpacingBodyLengths` apart; more soldiers than fit stand in further rows `rowGapBodyLengths` out), facing
   * outward. On a marker with food, `guardShare` of the sickle-jaws there guard (the lowest ids) and the rest
   * gather; with no food, all guard. Guards only engage enemies within `aggroBodyLengths` (short-ranged fighters).
   */
  escort: { halfWidthBodyLengths: 3.5, minSpacingBodyLengths: 1.6, rowGapBodyLengths: 1.6, guardShare: 0.5, trailStepMm: 4, trailRefreshSec: 2, aggroBodyLengths: 3 },
  food: {
    /** plant matter: 1 unit = 1 food unit of the ant economy (the store shared with the Nasute Termites' wood) */
    leafLitterPatch: { amount: 25, bitesPerFragment: 3, biteIntervalSec: 0.3, perFragment: 1 },
    /** leaf-litter patches on the map at the start (beside the deadwood) and kept topped up */
    patchesPerColony: 4,
    patchesMin: 6,
  },
  broodCostMul: { worker: 1.0, soldier: 2.0 },
  broodTimeMul: { worker: 1.0, soldier: 1.4 },
  presoldierFraction: 0.25,
  /** termite corpses as food for ants, × the baseline worker ant's corpse (5 food); keys: CasteDef.termite */
  corpseFoodForAntsMul: { worker: 0.75, sickle: 0.7, king: 3.0, queen: 6.0 } as Record<string, number>,
  ai: { soldierFraction: 0.18, reserveSoldiers: 2, maxCommitFraction: 0.6 },
} as const;

/**
 * Army ants, Eciton burchellii (claude/army-ants package, plan Step 1; user decisions 2026-10-25: a normal dug nest,
 * no bivouac, no nomadic/statary phases, no queen attendants). Lengths in body lengths of the ant concerned unless
 * the name says mm.
 */
export const ECITON = {
  /**
   * Swarm raid at a surface marker: the front is an arc across the raid direction (nest entrance → marker), its
   * half-width `frontWidthPerSqrtN` × √(raiders) body lengths of a minor. The front centre starts on the near edge
   * of the marker and creeps forward at `frontSpeedMul` × a minor's speed to `frontReach` × the marker radius past
   * the marker, then sweeps back across the marker circle and forward again. Every raider pulses: it runs
   * `pulseAdvance` body lengths ahead of its slot on the front, falls back `pulseRetreat`, waits `pulseEvery` s
   * (seeded per ant), and goes again.
   */
  raid: {
    frontWidthPerSqrtN: 2.2,
    frontSpeedMul: 0.35,
    frontReach: 1.2,
    pulseAdvance: 1.6,
    pulseRetreat: 0.5,
    pulseEvery: [1.2, 2.4] as readonly [number, number],
    /** a raider bites into food it touches within this many body lengths of its pulse point */
    searchBodyLengths: 3,
    /** creatures (up to `flushMaxMm` long, not bosses, not held) within `flushRadiusMm` of the front centre run from it for `flushSec` */
    flushRadiusMm: 36,
    flushMaxMm: 30,
    flushSec: 2.5,
    /** the front roams within this × the marker radius of the marker; its half-width is at most this share of that */
    areaMul: 2,
    maxHalfWidthOfArea: 0.75,
    /** the raiders fill a band behind the front line about this many body lengths apart (a swarm, not a drill line) */
    bandSpacingBodyLengths: 1.3,
    /** the front only creeps on while this share of the raiders are up with it (within its half-width + 6 minor lengths) */
    keepUpShare: 0.3,
    /** the front turns back into the raid area by this angle either side of the marker direction (rad) */
    turnRad: 0.9,
    /** a raid with no raiders for this long is reset (the next one starts from the near edge again) */
    resetSec: 5,
  },
  /**
   * Three-lane traffic on the raid trail (Couzin & Franks 2003): laden ants walking home keep the centre; outbound
   * ants keep `laneOffset` body lengths to their right of it (so the two directions use the two edges) and step aside
   * for laden ants met head-on.
   */
  lanes: { laneOffset: 0.9, yieldBodyLengths: 1.2 },
  /**
   * Living bridges (Reid et al. 2015) and pothole plugs (Powell & Franks 2007): on a busy raid trail (≥ `formTraffic`
   * crossings per 10 s), minors fill the slots of a bridge over a gap (water's edge) in arrival order and the cells
   * become walkable at `speed`; they release in reverse order after `dissolveAfter` s of low traffic. Rough cells on
   * the trail get one minor each lying in the hole.
   */
  bridge: { maxAnts: 12, spacing: 0.8, formTraffic: 3, dissolveAfter: 15, speed: 0.9, minSaveMm: 10, detourRatio: 1.4 },
  /** a pothole: a dip of at least `minDipMm` in the trail (against the ground 6 mm either side); unplugged, army ants
   *  cross it at `unpluggedSpeed` (down and up again), plugged at `speed` */
  plug: { speed: 1.0, unpluggedSpeed: 0.6, minDipMm: 0.15, reachMm: 2.5, maxPlugs: 6 },
  /** the Soldier's hook: a successful bite locks on for `hold` s; × `softBonus` damage on armour-0 targets; the target's struggle-free chance × `dislodge` */
  hook: { hold: 4, softBonus: 1.5, dislodge: 0.3 },
  /** group pinning: this many army ants on one target spread-eagle it (pinned, as by a grapple) */
  pin: { minAttackers: 3 },
  /**
   * Soldiers (majors) guard the whole raid trail facing outward — only once the colony has `minMajors` of them
   * (with fewer they raid and fight with everyone else). Posts every `spacing` Soldier lengths along the route from
   * the nest entrance to the raid front, alternating sides, `sideOffset` Soldier lengths off it, with extra posts
   * within `entranceBias` and `frontBias` spacings of the two ends; `reserve` Soldiers stay with the raid. A guard
   * rushes enemies within `rushRadius` Soldier lengths of its post, then walks back.
   */
  guard: { minMajors: 3, spacing: 6, sideOffset: 1.2, rushRadius: 8, entranceBias: 2, frontBias: 2, reserve: 1, refreshSec: 1 },
  /**
   * Porters prefer loads of at least `minLoad` carry units. The load hangs under the body (`underFwd` body lengths
   * ahead of the middle, drawn `underLift` up and at most `underMaxSize` long — the model's carry-under point).
   * Team carries: a porter takes a whole item up to `teamMax` × its own load when `teamHelpers` unladen nestmates are
   * near (within `teamReachBodyLengths`); they walk beside it and the team moves at `teamSpeedMul`.
   */
  porter: { minLoad: 1.5, teamMax: 3, teamHelpers: 2, teamReachBodyLengths: 4, teamSpeedMul: 0.8, underFwd: 0.1, underLift: 0.2, underMaxSize: 0.45 },
  /** Media escort: stay within this many body lengths of a porter on the raid trail */
  escortBodyLengths: 6,
  /** the queen's physogastry (render `swell`), fixed: no phase cycle */
  queenSwell: 0.5,
  /** a meeting's antennation pause (s; other ants 0.6): army ants barely stop */
  meetPauseSec: 0.3,
  /** what army ants eat: insects and corpses, and crumbs of them (no seeds, fruit, honeydew or fungus) */
  foodKinds: ['insect', 'corpse', 'crumb'] as readonly string[],
  /** AI: recall the raid when stores fall below this */
  aiRecallFood: 10,
} as const;

/**
 * Termants, Chimaeromyrmex termitoides (fictional ant–termite hybrid; claude/termyrms package, plan Steps 1–3).
 * Behaviour in sim/termants.ts.
 */
export const TERMANT = {
  /**
   * Gene samples credited when an enemy corpse is delivered to the store (never the colony's own dead, never the
   * midden): by the dead ant's size class (a nanitic or minor is `small`, a worker `ant`, a soldier `soldier`, a
   * major or anything 10 mm and over `heavy`), creatures `creature`.
   */
  geneSample: { small: 1, ant: 2, soldier: 4, heavy: 7, creature: 3 },
  /** samples of a species needed to unlock its stolen caste (heavy castes need more) */
  geneThreshold: { default: 12, heavy: 18 },
  /** stolen castes active at once; a fourth waits for one to be forgotten */
  maxStolen: 3,
  /** a stolen caste's brood tile costs this × its own species' tile */
  stolenCostMul: 1.5,
  /** the amber tint of stolen-caste ants (render) */
  stolenTint: 0.35,
  /** a forgotten caste's samples drop to this share of its threshold (it can be learned again sooner) */
  forgetKeep: 0.5,
  /** soldier glue burst: every `cooldown` s within `range` mm: `damage`, the target slowed to `slowMul` for `slow` s; formic acid × `acidMul` on a glued target */
  glue: { cooldown: 5, slow: 3, slowMul: 0.4, damage: 3, range: 4, acidMul: 2 },
  /**
   * Dual diet: workers also gather dead wood, kept in a separate store (at most `cap`) that digests into food at
   * `digestRate` food per second per 10 wood stored (× `toFood`). Wood sources spawn on maps with Termants.
   */
  wood: { cap: 60, digestRate: 0.15, toFood: 0.5 },
  /** carton wall tile: paid in wood, hit points, build time (s), upgrade points */
  cartonWall: { cost: 8, hp: 120, build: 6, points: 1 },
  /** workers fetch corpses of species whose genes are still short first */
  corpsePriority: true,
  /**
   * In games with a Termant colony, dead ants stay food this long (s) before they sink, instead of the usual 2 s
   * (BALANCE.corpse.antFood) — long enough to be carried home for their genes.
   */
  corpseLingerSec: 25,
  /**
   * Termant AI: raid sooner (score × `raidScoreMul`, margin × `raidMarginMul`) a rival whose genes are within
   * `raidNear` of their threshold; wood counts × `woodWant` as a forage source while the wood store is under half
   * full (× `woodSated` above); a carton wall goes up beside each entrance while intruders are inside (if the wood is
   * there), at most `wallsPerEntrance` each.
   */
  ai: { raidNear: 0.3, raidScoreMul: 0.6, raidMarginMul: 0.8, woodWant: 1, woodSated: 0.3, wallsPerEntrance: 1 },
} as const;

/**
 * Guard line (sim/guardLine.ts; user note 2026-10-25: fighters were "too compact"): the fighters at a surface
 * marker stand in rows across it facing the front. Places `spacing` × the largest body in the line apart, rows
 * `rowSpacing` × it behind one another; `perRow` = max(`perRowMin`, ⌈√(n × `rowShape`)⌉) (20 ants: 2 rows of 10).
 * The front faces the nearest enemy within `threatMm`, looked for every `faceEverySec`, turning only for a change
 * over `faceTurnRad`. An ant goes back to its place when pushed `leaveBodyLengths` off it and stops
 * `arriveBodyLengths` from it.
 */
export const GUARD = {
  spacing: 1.35,
  rowSpacing: 1.25,
  perRowMin: 4,
  rowShape: 5,
  threatMm: 120,
  faceEverySec: 1,
  faceTurnRad: 0.5,
  leaveBodyLengths: 0.6,
  arriveBodyLengths: 0.15,
  /**
   * Ants in a fight (closing in, spraying, holding a foe, standing in a line) keep `fightRoom` × the usual
   * separation radius apart, friend or foe, unless one holds the other (separation.ts); an ant choosing a foe
   * counts each nestmate already on it as `crowdPenalty` more distance (squared, combat.ts findTarget): fights
   * spread into a front of one-on-ones instead of one heap.
   */
  fightRoom: 1.9,
  crowdPenalty: 0.8,
  /** a grappler within this many body lengths of its hold on a foe is pulled back to it only gently (combat.ts) */
  slotGive: 0.35,
  /**
   * an enemy this close to the marker (mm) means the marker is on it (a charge): the line faces its way of travel
   * (and its front row would stand `standOff` places short of the marker: 0, measured worse in tools/fightspread)
   */
  onMarkerMm: 20,
  standOff: 0,
  /**
   * an ant this close (mm) to its place, or to the marker, walks straight to its place (else the marker's route): on
   * the open arena floor from far out (the lines form as they come in: the melee measured a third less heaped in
   * tools/fightspread), on maps nearer, where rocks and water need the route
   */
  directMm: 120,
  directMmArena: 400,
};

/**
 * Battle arena (sim/arena.ts, DESIGN 3.13): 2–4 teams of any ants and creatures fight on an open surface. Units
 * appear in a spiral round their team's spawn point (`spacing` × body length apart); at most `maxUnits` live units
 * at once (ants and creatures) and `maxPerSpawn` per click. A charging team heads for the enemy unit nearest its own
 * centre, refreshed every `retargetSec`; its marker moves only when that point moved more than `moveMarkerMm`.
 * Holding creatures go back to their post when it is more than `holdLeash` mm away. Dead creatures' carcasses go
 * after `carcassSec`. A creature's level multiplies its health and bite like an ant's tile level
 * (BALANCE.levelHp / levelDamage). Map: `size` mm square; spawn points `spawnRadius` × size from the centre, the
 * teams' nests (needed by the engine, never used) `nestRadius` × size out.
 */
export const ARENA = {
  size: 560,
  spawnRadius: 0.24,
  nestRadius: 0.4,
  maxUnits: 700,
  maxPerSpawn: 50,
  spacing: 1.1,
  retargetSec: 1,
  moveMarkerMm: 12,
  holdLeash: 25,
  carcassSec: 8,
  /** creatures that cannot take part: the antlion lives in its pit and never moves */
  noCreatures: ['antlion'] as readonly string[],
} as const;

export const B = BALANCE;

/** Storms on authored maps (sim/floods.ts, docs/maps/design.md §5). */
export const FLOOD = {
  /** warning before the water rises (s) */
  warnS: 25,
  riseS: 10,
  drainS: 20,
  /** the level moves in this many steps (each rebuilds the water and the flow fields) */
  steps: 5,
  /** the rising water starts this far (mm) below the zone's full level */
  startBelow: 3,
  /** share of an ant's maximum health lost per second in flood water (creatures: half) */
  drownFrac: 0.06,
  /** paddling toward dry ground (mm/s) */
  swimMmS: 7,
};

/** Nest entrances (sim/entrances.ts; claude/maps/02-spec-nest-entrances, DESIGN.md "Entrances"). */
export const ENTRANCE = {
  /** extra entrances a colony may dig beside its main one (each site has this many surface spots) */
  maxExtra: 2,
  /** hexes in an entrance tunnel, from the ramp under the hole down to the nest floor */
  tunnelLen: 3,
  /** extra-entrance spots lie this many hexes from the queen's hex */
  spotMin: 8,
  spotMax: 13,
  /** ants through one entrance per second, in and out together (a chokepoint: busy holes queue) */
  passPerS: 10,
  /** ants that may pass at once after a quiet spell */
  burst: 4,
  /** seconds to plug an extra entrance with soil, or to open it again */
  closeS: 4,
  /** seconds for a fallen colony's entrances to cave in */
  collapseS: 60,
  /** tunnel hexes move ants like a level I highway */
  tunnelSpeed: 1.1,
  /** rival AI colonies dig an extra entrance per this many living ants (at most maxExtra) */
  aiExtraAt: 60,
};
