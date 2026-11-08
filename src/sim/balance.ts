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
  /**
   * Caste abilities (user 2026-10-31, after Empires of the Undergrowth; sim/casteAbilities.ts), automatic:
   *  taunt — leafcutter majors: on a bite, with more than `minHpFrac` health, a `chance` (EotU 30 %) to make every
   *    enemy within `radiusL` of its lengths fight it for `durSec` (EotU 4–6 s), every `cooldownSec` (EotU 10 s) at most;
   *  rage — army-ant soldiers: +`dmgPerStack` bite damage per kill (up to `maxStacks`: +45 %, EotU's cap) for the
   *    soldier and nestmates within `radiusL` of its lengths; one stack fades every `decaySec` without a kill.
   */
  casteAbility: {
    taunt: { chance: 0.3, minHpFrac: 0.3, radiusL: 2.5, durSec: 5, cooldownSec: 10 },
    rage: { maxStacks: 5, dmgPerStack: 0.09, radiusL: 3, decaySec: 8 },
  },
  // ---------------------------------------------------------------- jobs
  /** completion points every dig / build / upgrade / delete job needs (EotU) */
  jobPoints: 6,
  /** points per second a worker adds, by its tile level 1 / 2 / 3 (EotU) */
  workRate: [2, 4, 6],
  /** workers allowed on one soil hex (EotU) */
  digWorkersPerHex: 2,
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
    fire_minor: { build: 10, hatch: 1, grow: 14 }, // (balance pass 2026-11-02: hatch was 1.5)
    atta_minim: { build: 10, hatch: 1, grow: 12 },
    atta_media: { build: 10, hatch: 2.5, grow: 20 },
    eciton_minor: { build: 10, hatch: 2, grow: 16 },
    eciton_submajor: { build: 16, hatch: 3, grow: 22 },
    plagiaria_worker: { build: 10, hatch: 2.5, grow: 20 },
    // soldiers
    lasius_soldier: { build: 20, hatch: 4, grow: 28 },
    fire_soldier: { build: 16, hatch: 3, grow: 24 },
    atta_soldier: { build: 24, hatch: 5, grow: 30 },
    eciton_media: { build: 24, hatch: 5, grow: 30 },
    formica_soldier: { build: 30, hatch: 6, grow: 36 },
    formica_mortar: { build: 30, hatch: 6, grow: 36 },
    formica_rapid: { build: 30, hatch: 6, grow: 36 },
    // majors
    fire_major: { build: 60, hatch: 10, grow: 44 },
    atta_major: { build: 70, hatch: 10, grow: 50 },
    eciton_major: { build: 75, hatch: 11, grow: 50 },
    // Nasute Termites, paid in wood: × the baseline worker (10 / 2 / 18) by NASUTE.broodCostWoodMul / broodTimeMul
    nasute_worker: { build: 10, hatch: 2, grow: 18 }, // × 1.0 / × 1.0
    nasute_soldier: { build: 22, hatch: 4.4, grow: 23.4 }, // × 2.2 / × 1.3 (balance pass 2026-11-02: was × 1.8; the glue stream is the user's)
    nasute_major: { build: 35, hatch: 7, grow: 32.4 }, // × 3.5 / × 1.8
    // Sickle-Jaw Termites, paid in plant matter: × the baseline worker (10 / 2 / 18) by SICKLE.broodCostMul / broodTimeMul
    rhy_worker: { build: 10, hatch: 2, grow: 18 }, // × 1.0 / × 1.0
    rhy_soldier: { build: 22, hatch: 3.1, grow: 25.2 }, // × 2.2 / × 1.4
    // Hell ants (05-implementation-plan Step 2)
    hell_worker: { build: 10, hatch: 3, grow: 22 },
    hell_soldier: { build: 28, hatch: 6, grow: 34 },
    // Saiy-Ants (03-implementation-plan Step 2)
    aurimyrmex_worker: { build: 10, hatch: 3, grow: 22 },
    aurimyrmex_soldier: { build: 30, hatch: 6, grow: 36 },
    // the Blaster: a shooter's brood, as the wood ants' mortar (CHANGE_PLAN §31)
    aurimyrmex_blaster: { build: 30, hatch: 6, grow: 36 },
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
   * Creature melee reach (user note 2026-10-31: "increase some of the melee ranges of the creatures in a realistic
   * manner so they don't move too much when fighting"; CHANGE_PLAN §18). Reach is measured from the body outline (the
   * capsule ants plant round), no longer from the body's centre: `r` is how far its jaws, fangs or forelegs reach beyond
   * the outline, × its length; `arc` how far each side of its heading (rad), seen from the front of its body, it strikes
   * without turning. An ant is in reach when its centre is within r × L + `combat2.antHalfLen` × its own length of the
   * outline (an ant planted on the outline always is). In reach and in its arc, a creature stands and strikes; an ant in
   * reach but outside the arc it turns to (`turnTo` rad/s, standing); only with no ant in reach does it walk. From the
   * models (front of the body vs the jaw, fang and foreleg tips: tools/fight-motion.ts notes) and the animals:
   *  - ground beetle 0.12 ±1.3: sickle mandibles about an eighth of its length; the head and pronotum thrust and swing.
   *  - rove beetle 0.12 ±2.2: long crossing mandibles on a very mobile head, and it curls its abdomen forward.
   *  - stone centipede 0.12 ±2.4, giant centipede 0.1 ±2.0: venom claws, and the front segments swing the head far round.
   *  - wolf spider, spiderling, wolf-spider mother 0.35 ±1.0; tarantula 0.35 ±0.9: the front legs and palps (feet at
   *    about its own length ahead of its centre) grab and pull prey to the fangs.
   *  - mantis 0.3 ±0.45, giant mantis 0.3 ±0.65: the raptorial forelegs strike about a third of its length ahead of
   *    the head (its strike cone).
   *  - stag beetle 0.15 ±0.6: the antler tips stand 0.14 of its length beyond the head; it swings them sideways a little.
   */
  creatureReach: {
    groundBeetle: { r: 0.12, arc: 1.3 },
    rove: { r: 0.12, arc: 2.2 },
    lithobius: { r: 0.12, arc: 2.4 },
    wolfSpider: { r: 0.35, arc: 1.0 },
    spiderling: { r: 0.35, arc: 1.0 },
    hogna: { r: 0.35, arc: 1.0 },
    tarantula: { r: 0.35, arc: 0.9 },
    mantis: { r: 0.3, arc: 0.45 },
    giantMantis: { r: 0.3, arc: 0.65 },
    stagBeetle: { r: 0.15, arc: 0.6 },
    // the stag beetle males (STAG_MALE): their outline already ends at the antler tips (the model is centred on them);
    // the head swings the antlers a little further, more the longer they are
    stagMinor: { r: 0.06, arc: 0.6 },
    stagSmall: { r: 0.07, arc: 0.6 },
    stagMedium: { r: 0.09, arc: 0.6 },
    stagLarge: { r: 0.11, arc: 0.6 },
    scolopendra: { r: 0.1, arc: 2.0 },
  } as Record<string, { r: number; arc: number }>,
  /**
   * Reach of a kind not in the table; turning to an ant in reach (rad/s); a bite already coming lands `slack` × the reach
   * (and arc). Splash strikes (the tarantula's fangs, the giant centipede's venom claws) hit a circle half way out along
   * the reach, of radius (0.5 + `strikePad`) × the reach; the tarantula's body lurches `tarantulaLurch` × its length into
   * the strike (the front legs do the reaching: it was a 0.4 lunge).
   */
  creatureReachDefault: { r: 0.1, arc: 1.2, turnTo: 3, slack: 1.3, strikePad: 0.3, tarantulaLurch: 0.1 },
  /**
   * Soft separation (light collision): each ant is a circle of radius
   * `radiusOfWidth` x its body width (`widthOfLength` x its length); overlaps are
   * pushed apart by `strength` of the overlap per tick, at most `maxPush` x the
   * ant's length; the heavier ant moves less. Creatures push ants out of their
   * bodies (`creatureStrength`); ants never push creatures.
   */
  // (`antContact`, user 2026-11-01: ants collide with each other at half the distance — body circles, personal space,
  // waiting room, guard lines; hit shapes and creatures unchanged)
  separation: { radiusOfWidth: 0.8, widthOfLength: 0.28, strength: 0.5, maxPush: 0.15, creatureStrength: 0.9, creatureMaxPush: 0.6, creatureAllyRoom: 1.3, antContact: 0.5 },
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
   * Overflow and duels (combat.ts findTarget / waitForSlot): each nestmate already on a foe counts as `crowdLen` × the
   * ant's length farther away on a foe with room for `crowdRef` attackers, in proportion less on a bigger one (user
   * 2026-11-01, 21:06: share the swarm out by how many are already on each foe); picks count at once, an ant closing
   * in looks again every `retargetSec`, and its current foe gets `keepBias`. A target with no free slot is skipped.
   * Focus fire (the ant's marker within `focusMarkerMm` of the foe): the foe counts `focusPull` × as far (squared), and a
   * full target may be pressed on. Waiting ants stand on a ring at a personal space and look for a free slot
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
    // (user 2026-11-01) attackers round an ant (slots.ts antSlotCount): its own size, 6 round a minim-size ant (≤ 3 mm),
    // 7 round a 4 mm worker and one more every 3 mm longer; the perimeter rule above is for creatures now
    swarm: { small: 6, smallMm: 3, worker: 7, workerMm: 4, stepMm: 3 },
    slotsMin: 2,
    slotsMax: 24,
    queenSlotsMin: 8,
    crowdLen: 1.5,
    crowdRef: 7,
    focusPull: 0.6,
    keepBias: 0.8,
    retargetSec: 0.5,
    focusMarkerMm: 6,
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
      stagMinor: 0.08,
      stagSmall: 0.08,
      stagMedium: 0.08,
      stagLarge: 0.08,
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
   *
   * **Pressing in, never a queue** (user 2026-11-01, evening: "they need to look like they are trying to swarm and attack
   * even if they cant fit … take a small retreat to let the others in but dont allow whatever in the left is happening
   * ever" — the ants that stood in a still line off to one side, 2026-10-31's loose waiting band): every slot on its
   * foe taken, an ant presses in `pressGap` × its length behind the hold line (where the fighters stand), turned
   * `pressAngle` rad round the ring from facing the foe — edging round the crowd for a way in, the side it edges to
   * flipping every `pressFlipSec` (± a third, by its id) — at `pressSpeed` × its speed, nosing on at `pressPush` once
   * there (the fighters and the crowd push it back: it scrabbles on the spot, its jaws snapping in the render), backing
   * out at `pressBack` when pushed in closer than `pressNear` × its length behind the hold line. A place on an ant foe comes
   * free within `pressSidle` × its length: it sidles straight to it (no going round on the outer ring). Any teammate within
   * `waitSpace` × the larger one's length of a pressing ant is pushed off at the walking strength (a crowd, not a fight's
   * spacing). **Taking turns:** a fighter that has bitten `rotBites` (+ 0..`rotSpread`, by its id) times while a teammate
   * presses for the same foe within `rotNear` × its length lets go and hands its place to the presser nearest it round the
   * ring (which goes straight for it); it steps back `rotBackLen` × its length over `rotBackSec`, turned `rotTurn` rad
   * from straight back away from the side the presser comes from, and presses in itself until `rotSec` is up. A full
   * foe is pressed on only when no foe in sight has room, or when a marker is on it (and then the crowd on it still
   * counts: `combat2`).
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
    allyWeight: 0.5,
    avoidLook: 2,
    avoidCone: 0.7,
    avoidTurn: 0.9,
    waitSpace: 1,
    pressGap: 0.9,
    pressAngle: 0.55,
    pressFlipSec: 2.2,
    pressSpeed: 0.45,
    pressPush: 0.12,
    pressBack: 0.35,
    pressNear: 0.3,
    pressSidle: 3,
    rotBites: 3,
    rotSpread: 2,
    rotNear: 2.5,
    rotBackLen: 0.7,
    rotTurn: 0.6,
    rotBackSec: 0.45,
    rotSec: 1.6,
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
   * Unit heights and the under-pass (combat v2.2, CHANGE_PLAN §20, user spec claude/combat/04-spec-height-and-underpass.md;
   * EotU: "Smaller creatures can move and attack beneath larger ones"). Every unit's height, the clearance under the
   * rear, middle and front of its body, its half-width and its feet come from its model (src/sim/heightData.ts,
   * tools/height-data.ts). Unit A passes under unit B where B's body is over it when A's height × (1 + `margin`) is
   * at most B's clearance there, in B's pose: then A does not collide with B's body there, only with its feet (circles
   * of `footR` × B's length, at least `footMinMm`), and neither pushes the other; where it does not fit, B's body
   * there (that zone, `hw` wide) blocks as usual. At most `stackLen`-th of B's length in A's lengths (1..`maxStack`)
   * may stand under B at once (1 small worker under a media, 2–3 under a major). Teammates when `allies`; enemies
   * when `enemies`. Poses (zone multipliers on the clearance): a braced heavy bite (`braced` castes holding a foe) lowers
   * the front to `pose.braced`; a porter carrying prey slung under it (`porters`) drops its middle to
   * `pose.porterLoaded`; rearing to spray raises the front by `pose.rearing`; dead or flung: nothing passes under.
   * A unit that no longer fits steps out sideways (`stepOut` × its length clear of the body) in a planned move; one
   * mid-attack finishes its attack first, and B's front waits to lower until it has.
   * (user 2026-11-01: "atta worker n other ants should b able to walk under and attack under majors") To get under
   * something an ant crouches: legs bent, its body lowered by up to `crouch` × its own belly clearance (its middle
   * zone), so its height counts that much less (the render lowers it as far as the room above needs).
   */
  underpass: {
    margin: 0.1,
    crouch: 0.65,
    allies: true,
    enemies: true,
    footR: 0.03,
    footMinMm: 0.25,
    stackLen: 3,
    maxStack: 4,
    pose: { braced: 0.5, porterLoaded: 0, rearing: 1.3 },
    braced: ['atta_major', 'atta_soldier', 'eciton_major'] as string[],
    porters: ['eciton_submajor'] as string[],
    stepOut: 0.3,
  },
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
  /**
   * The AI builder (sim/colonyAI.ts; CHANGE_PLAN §23): EotU-style chambers of 7 or 19 hexes, one tile type (one caste)
   * each, highways on the tunnels, upgrades from mid game.
   */
  aiBuild: {
    /** 19-hex chambers once the colony has this many ants and this much game time (s) has passed (× levelFrom) */
    chamber19From: { ants: 45, time: 600 },
    /** a caste counts as one of the colony's main ones (19-hex chambers) with at least this share of the mix */
    mainShare: 0.15,
    /** a colony this big gets a 19-hex second store chamber (leafcutters always) */
    bigColony: 120,
    /** soil between a new chamber's rim and the other rooms' rims: at least, and to the nearest room at most (hexes) */
    rimGapMin: 2,
    rimGapMax: 5,
    /** longest tunnel to a new chamber (hexes); each hex of tunnel counts this much against a place; places tried */
    tunnelMax: 6,
    tunnelWeight: 0.6,
    planTries: 80,
    /** a chamber that found no place is not tried again for this long (s): the others go first */
    planRetry: 60,
    /** at most this many food store chambers, within storeNearEntrance hexes (rim) of the entrance */
    maxStoreChambers: 2,
    storeNearEntrance: 8,
    /** a tile type's (caste's) chambers count as nearly full with this many free hexes or fewer: plan the next */
    nearlyFull: 1,
    /** stores count as full at this share of the capacity; no new store tiles past foodCapMax */
    storeFull: 0.8,
    foodCapMax: 2400,
    /** highways on the tunnels once the colony has this many ants, keeping this much food after paying */
    highwayFrom: 18,
    highwayReserve: 12,
    /** upgrades from mid game (× levelFrom): game time (s), ants, food in store */
    upgradeFrom: { time: 720, ants: 50, food: 60 },
    /**
     * food kept back after paying an upgrade: this much, plus what the larvae on their tiles still need, plus the price
     * of the next brood tile and its ant (brood comes first: upgrades spend the surplus)
     */
    upgradeReserve: 20,
    /** upgrade jobs waiting at once (× levelInFlight, at least 1) */
    upgradesInFlight: 2,
    /** AI level (settings.aiLevel 0 Easy … 3 Brutal): × the mid-game thresholds, × upgrades in flight */
    levelFrom: [1.6, 1, 0.8, 0.6],
    levelInFlight: [0.5, 1, 1.5, 2],
  },
  /**
   * Kings (termites and Termants; user note 2026-11-02): no nest duties; a slow walk round the queen inside her chamber —
   * a new spot every `wanderS` s, `step` rad further round her, `ringMin`..`ringMax` of his length out from her body,
   * at `walkMul` of his speed — and bites for intruders in the chamber (sim/termites.ts kingTick)
   */
  king: { wanderS: 7, step: 0.6, ringMin: 0.35, ringMax: 0.85, walkMul: 0.45 },
  /** AI colonies with allies (CHANGE_PLAN §23, user spec claude/ai/01-spec-ai-allies-chambers.md) */
  aiAllies: {
    /** the ally brain and joint raids on (off: AI allies leave each other alone, as before; tools/ecology-teams.ts) */
    help: true,
    /** seconds between the ally brain's decisions */
    every: 2,
    /**
     * An ally's danger (warAI.ts allyDanger): the enemies' fighting weight there (health × damage rate) × where they are,
     * minus its defenders' weight; plus its losses a second × lossWeight; × queenMul when its queen is in danger.
     * Where: by the queen (within queenRadius mm), deep in the nest, at its entrance (within entranceRadius of the
     * flower), at its surface holes (siegeRadius), near them on the surface (nearRadius).
     */
    locQueen: 4,
    locDeep: 3,
    locEntrance: 2,
    locSiege: 1.5,
    locNear: 1,
    queenRadius: 40,
    entranceRadius: 30,
    siegeRadius: 60,
    nearRadius: 150,
    queenHurt: 0.7,
    queenMul: 3,
    lossWeight: 400,
    /** a creature's weight per point of health × its bite rate */
    creatureWeight: 1,
    /**
     * help only above this danger (one Red wood soldier weighs about 240: two at an ally's entrance, unopposed, are
     * about 1000), and not an ally whose defenders already have this × the attackers' weight
     */
    assistMinDanger: 500,
    allyWinningRatio: 1.5,
    /** help only if it can get there in this long (s; the land route over the fighters' speed), unless the queen is in danger */
    assistMaxTravel: 90,
    /** keep this share of the fighting weight at home (and at least homeGuardMin fighters); send enough that help +
     * the ally's defenders reach assistOvermatch × the attackers' weight, no more */
    homeGuardShare: 0.3,
    homeGuardMin: 3,
    assistOvermatch: 1.3,
    /**
     * a lost cause is left alone: no help when what it can spare + the ally's defenders would still be under this ×
     * the attackers' weight (assistMinOddsQueen with the ally's queen in danger); help under way falls back when the
     * helpers + defenders drop under assistQuitOdds × the attackers (they would only die with the ally)
     */
    assistMinOdds: 0.8,
    /** while helping: more groups (still keeping the guard) at most this often (s) when help + defenders fall short */
    reinforceEvery: 10,
    assistMinOddsQueen: 0.5,
    assistQuitOdds: 0.5,
    /** stop helping: clear (danger under clearDanger) for clearFor s, losses over assistMaxLoss of those sent, or after
     * assistMaxTime s; then a cooldown (s) */
    clearDanger: 150,
    clearFor: 8,
    assistMaxLoss: 0.6,
    assistMaxTime: 240,
    cooldown: 30,
    /** inside the ally's nest: the marker moves from its entrance to the threat once this share of the helpers is in */
    insideShare: 0.5,
    /** a raid gives way to helping when the ally's danger is over this (or its queen is in danger, or it is the same enemy) */
    raidValue: 4000,
    /** a human player's call for help (command callHelp): this long (s), its danger × callBoost and at least callMin */
    callHelpSec: 45,
    callBoost: 2,
    callMin: 800,
    /** joint raids: an AI ally may join a raid this young (s) with at least joinMinFighters; everyone gathers gatherDist
     * mm short of the target's holes and goes when gatherShare of each one's fighters are there, or after gatherMax s */
    joinWindow: 30,
    joinMinFighters: 6,
    gatherDist: 140,
    gatherR: 70,
    gatherShare: 0.6,
    gatherMax: 120,
    /** shared targets: an enemy seen attacking the team within foeMemory s is raided first (its score × sharedTargetMul) */
    foeMemory: 300,
    sharedTargetMul: 0.5,
    /** team-aware placement (world/teamSites.ts): limits as fractions of the map's width, and the score's weights */
    sites: {
      /** each ally's land route to its nearest teammate at most this */
      allyMaxRoute: 0.33,
      /** each colony's land route to its nearest enemy at least this */
      enemyMinRoute: 0.3,
      /** weights: allies' routes (shorter better), the teams' spread (fairer better), the nearest enemy (farther better) */
      wAlly: 1,
      wFair: 2,
      wEnemy: 0.5,
      /** an uneven match: how much the smaller side's worse food route counts */
      smallSideFood: 2,
    },
  },
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
    /**
     * the finisher (user rating 2026-11-02, H7/H10): a hell ant's bite on an enemy ant or termite at this fraction of
     * its health or less reaches its jaws round the neck and takes the head off — the foe dies (never a queen or king)
     */
    finisherHp: 0.25,
    /**
     * (user note 2026-11-02 12:39) the finisher lifts the foe into the air by its neck first: held up this long (s),
     * struggling, then the head is cut off; the foe's centre is held this many hell-ant body lengths ahead plus
     * `finisherNeck` of its own length (its head between the jaws, the body hanging back)
     */
    finisherLift: 1.0,
    finisherReach: 0.5,
    finisherNeck: 0.3,
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

  // ---------------------------------------------------------------- Saiy-Ant Blaster (sim/saiyBlaster.ts; docs/balance/castes.md)
  blaster: {
    /** orbs: reach (mm; the mortar 56, the rapid sprayer 32, a melee reach under 10), damage, seconds between shots */
    range: 40,
    /** backing off from a foe inside 0.4 × range: this share of its own speed, without the gold form's (melee catches it) */
    backoff: 0.6,
    orbDamage: 5,
    interval: 1.5,
    /** the shot: seconds of wind-up (head turns to aim, the mouth glows), then recovery until `shotDone` */
    windup: 0.32,
    shotDone: 0.55,
    /** orb speed (mm/s), radius (mm: what it touches), flight to 1.3 × range */
    orbSpeed: 150,
    orbRadius: 0.9,
    orbLife: 1.3,
    /** the beam (gold only, every `beamEvery`-th shot): seconds, reach (× the ant's length), half width (mm), a pulse
     *  every `beamTick` s for `beamDamage` (× the surge bonus at the moment it fires), then `beamCooldown` s */
    beamEvery: 5,
    beamTime: 3,
    beamReach: 9,
    beamHalfWidth: 1.6,
    beamTick: 0.25,
    beamDamage: 4,
    beamCooldown: 2.5,
    /** aiming the beam: candidate headings toward this many enemies in reach (nearest first) */
    beamCandidates: 12,
  },

  // ---------------------------------------------------------------- Saiy-Ants gold surge (docs/creatures/aurimyrmex-fulgurans.md)
  surge: {
    // (user 2026-11-07: the gold form lasts at least 10 s — 4 → 10, level 3 5 → 12; the cooldown 20 → 30, level 2
    // 14 → 22, keeps the share of time in gold near a quarter: CHANGE_PLAN §31, docs/balance/castes.md)
    duration: 10,
    /** level-3 tiles */
    durationL3: 12,
    cooldown: 30,
    /** level-2 tiles and up */
    cooldownL2: 22,
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
  displayName: 'Conehead Termites',
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
  broodCostWoodMul: { worker: 1.0, nasute: 2.2, major: 3.5 },
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
    /**
     * (user review round 1, 2026-11-07: "the mandibles dont even touch the ant"; round 2: "make the two still parallel
     * to each other (straight), just make the mandibles' clasp better") where the closed sickles hook (mm ahead of a
     * 4.5 mm soldier's centre, scaled with its size; the ant-pipeline model's C-hooks): the held victim is pinned
     * head-on in line with the soldier, its front this far ahead less `victimInHooks` of its length — its head and jaws
     * inside the crossed hooks, the snout lying along its back
     */
    gripMm: 0.82,
    /** how much of a held ant's length sits inside the hooks (its head and jaws) */
    victimInHooks: 0.08,
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
   * One store for everything (user 2026-11-02: "termants have the special ability to consume all known food resources
   * as food (wood leaves and normal food all share 1 store)"): their workers gather dead wood, leaf litter and leaves as
   * well as ordinary food, and each goes into the food store at `toFood` food per unit delivered. `cap` and
   * `digestRate` are kept only for old saves (their wood store is turned into food on load). Wood sources spawn on
   * maps with Termants.
   */
  wood: { cap: 60, digestRate: 0.15, toFood: 0.5, leafToFood: 1 },
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
   * `raidNear` of their threshold; wood and leaves count × `woodWant` as a forage source while the food store is under half
   * full (× `woodSated` above); a carton wall goes up beside each entrance while intruders are inside (if the wood is
   * there), at most `wallsPerEntrance` each.
   */
  ai: { raidNear: 0.3, raidScoreMul: 0.6, raidMarginMul: 0.8, woodWant: 1, woodSated: 0.3, wallsPerEntrance: 1 },
} as const;

/**
 * Trails (user 2026-11-01: "make ants not trail in a straight line like eotu and after they all reach destination,
 * some ants once in a while trail back to the nest … not all only like 2-3 + more depending on how many ants follow
 * the trail so that your army is viable for attacking still").
 *  - Weave (movement.ts `trailWeave`): an ant walking a route on the surface turns off it by the sum of three slow
 *    sines (`weaveA` rad, each `weaveK` × its speed / length rad a second, its own phases), so the column wanders in a
 *    band about four body widths wide instead of a ruled line. Within `weaveNearMm` of where it is going it walks
 *    straight in. `weave` 0 turns it off.
 *  - Traffic (guardLine.ts `trailTraffic`): of the fighters standing at a surface marker (not in the arena), now and
 *    then one walks back to the nest's entrance and out again — at most `trafficMin` + `trafficPer` × the group
 *    (never more than `trafficMaxShare` of it) at once, each starting on its own hashed clock.
 */
export const TRAIL = {
  weave: 1,
  weaveA: [0.25, 0.12, 0.08],
  weaveK: [0.8, 2.1, 0.35],
  weaveNearMm: 30,
  trafficMin: 2,
  trafficPer: 0.1,
  trafficMaxShare: 0.3,
} as const;

/**
 * Guard line (sim/guardLine.ts; user notes 2026-10-25: fighters were "too compact"; 2026-11-01: lined up isn't
 * natural for insects): the fighters at a surface marker gather in a loose crowd at it facing the front. Places
 * about `spacing` × each one's body apart (the small in the middle, the big round the edge), spread like a sunflower's
 * seeds and squashed `aspect` × wider across the front than deep. The front faces the nearest enemy within `threatMm`, looked for every `faceEverySec`,
 * turning only for a change over `faceTurnRad`. An ant goes back to its place when pushed `leaveBodyLengths` off it
 * and stops `arriveBodyLengths` from it.
 */
export const GUARD = {
  spacing: 1.5,
  aspect: 1.35,
  // a charge (the marker on the enemy) spreads wider: a broad, ragged front breaks into many small fights
  chargeAspect: 2.8,
  threatMm: 120,
  faceEverySec: 1,
  faceTurnRad: 0.5,
  leaveBodyLengths: 0.6,
  arriveBodyLengths: 0.15,
  // (user 2026-11-01: lined up isn't natural for insects) a milling crowd: each place pushed off its spot by up to
  // these shares of the spacing, the facing spread and sway (rad), a new spot every so often (s)
  jitterAcross: 0.25,
  jitterBack: 0.25,
  faceSpread: 0.5,
  sway: 0.12,
  shuffleSec: 8,
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
 * European stag beetle boss (realism pass, docs/creatures/stagBeetle.md): like a male wrestling a rival, it
 * opens its antlers (`windUp` s, the cone telegraph), clamps on up to `hold` ants between them, lifts them
 * for `liftS` s while the jaws squeeze (`squeeze` damage a second), then tosses them to one side (`toss`
 * fling power). Other ants in the cone take `sideBite` × a bite and are knocked aside. Walking at a swarm it
 * ploughs on: ants in front closer than `plough` × its length are shoved aside at `shove` mm/s.
 */
export const STAG = {
  windUp: 0.9,
  hold: 2,
  liftS: 0.85,
  squeeze: 12,
  toss: 2.6,
  sideBite: 0.45,
  sideFling: 1.2,
  plough: 0.42,
  ploughHalf: 0.9,
  shove: 26,
  /** height (fraction of its length) the clamped ants are lifted to, for the renderer */
  liftH: 0.22,
  /** how far in front of its centre the antler tips close (fraction of its length) */
  jaw: 0.42,
};

/** One stag beetle male size (STAG_MALE.size). */
export interface StagMaleSize {
  /** the model's allometric male size (render/creatures/stagBeetle.ts: 0 a minor … 1 the titan's major): head and antlers */
  msize: number;
  /** the antler grab: ants clamped at once (0: it never grabs) and the seconds between grabs */
  hold: number;
  grabEvery: number;
  /** rears up and slams down (and shakes its riders off) */
  rear: boolean;
  /** walking into ants it shoves them aside at this speed (mm/s) */
  shove: number;
  /** with this many ants holding on it shakes `shakeN` of them off (every 2 s) */
  shakeAt: number;
  shakeN: number;
}

/**
 * Stag beetle males (claude/story/06-spec-levels-5-7-and-lengths.md §2; docs/creatures/lucanus-cervus.md "Males of
 * four sizes"): four normal creatures (kinds `stagMinor` … `stagLarge`, ai `stagMale`) drawn with the titan's model at
 * male sizes 0–3 and scaled down from its 100 mm. The titan's moves, scaled down: all of them walk slowly and plough
 * through ants (`shove`), pinching what fights them (threat first, like the titan); the medium and large males also grab
 * ants in their antlers and toss them (`hold`, `grabEvery`, then the titan's sequence with the numbers below); the large
 * male rears and slams when hard pressed (below `rearHp` of its health with `rearMinAnts` ants round it, every
 * `rearEvery` s: `slamDmg` to the ants within `slamR` × its length) and shakes its riders off like a titan.
 *
 * `model`: the model's layout as fractions of its length (render/creatures/stagBeetle.ts SB, the antler length from
 * render/anatomy/mandibleSpecs.ts stagMandibleShare — tests/stagSizes.ts checks they agree). A male's model is drawn
 * shifted forward so its body, elytra apex to antler tips, is centred on the sim position (its short antlers left the
 * titan's layout tail-heavy); its outline is a capsule of radius `r` × L round that (kinds.ts stagMaleGeom).
 *
 * `wrestle` (stagWrestle.ts): two males meeting with no ants about face off, lock antlers and shove, then the winner —
 * the bigger one, mostly — lifts the other and throws it on its back; it rights itself and walks off.
 */
export const STAG_MALE = {
  size: {
    stagMinor: { msize: 0, hold: 0, grabEvery: 0, rear: false, shove: 14, shakeAt: 4, shakeN: 1 },
    stagSmall: { msize: 0.25, hold: 0, grabEvery: 0, rear: false, shove: 17, shakeAt: 5, shakeN: 1 },
    stagMedium: { msize: 0.5, hold: 1, grabEvery: 9, rear: false, shove: 21, shakeAt: 6, shakeN: 2 },
    stagLarge: { msize: 0.75, hold: 2, grabEvery: 7, rear: true, shove: 24, shakeAt: 7, shakeN: 2 },
  } as Record<string, StagMaleSize>,
  model: { back: -0.47, hinge: 0.176, share0: 0.075, shareK: 0.265, tipK: 0.9, closeK: 0.7, lockK: 0.55, r: 0.24 },
  /** the grab (as the titan's STAG): wind-up, the cone it clamps in (radius × L, half-angle), lift, squeeze, toss */
  windUp: 0.8,
  coneR: 0.3,
  coneHalf: 0.9,
  liftS: 0.8,
  squeeze: 8,
  toss: 2.2,
  sideBite: 0.45,
  sideFling: 1,
  liftH: 0.2,
  ploughHalf: 0.9,
  /** the large male's rear and slam */
  rearHp: 0.6,
  rearEvery: 12,
  rearMinAnts: 3,
  slamR: 0.45,
  slamDmg: 10,
  slamFling: 1.6,
  /** ants on it and none in front to pinch for this long (under its body, on its middle): it shrugs `shakeN` off */
  stuckSec: 2.5,
  /** turning to aim the grab at most this long (then it grabs where it faces) */
  aimSec: 1,
  wrestle: {
    /** an idle male looks for a rival every `scanSec`; a rival within `meet` × their mean length (centre to centre: it sees it and walks over) */
    scanSec: 1,
    meet: 4,
    /** a look that finds one starts a bout this often */
    chance: 0.5,
    /** no ant within `clear` × its length of either; both at least `minHp` of their health */
    clear: 0.9,
    minHp: 0.5,
    /** walking to the face-off (× its speed); given up if they have not faced off `approachSec` after their walks should end */
    speed: 0.8,
    approachSec: 5,
    /** the face-off: `gap` × their mean length further apart than locked, for `faceSec` */
    gap: 0.12,
    faceSec: 1.4,
    /** locked: stepping in over `lockIn` s, then `lockMin`..`lockMax` s of shoving (± `pushAmp` × the mean length at
     *  `pushHz`, the winner gaining `pushDrift` × it), the locked heads twisting ± `twist` rad */
    lockIn: 0.35,
    lockMin: 2.2,
    lockMax: 4.2,
    pushAmp: 0.035,
    pushHz: 0.9,
    pushDrift: 0.08,
    twist: 0.1,
    /** who wins: P = 0.5 + `winK` × (sa − sb) / (sa + sb), within `winMin`..`winMax`; s = length × (0.6 + 0.4 × health) */
    winK: 2.2,
    winMin: 0.1,
    winMax: 0.9,
    /** the lift: the loser held up at the winner's antlers (`liftZ` × the winner's length high) for `liftSec` */
    liftSec: 1,
    liftZ: 0.24,
    /** (the winner's antlers raised: the loser hangs `heldK` × as far ahead as the closed tips reach on the ground) */
    heldK: 0.8,
    /** the throw: `throwSec` in the air, landing `throwDist` × its length to one side, turned `throwSpin` rad */
    throwSec: 0.55,
    throwDist: 0.75,
    throwSpin: 1.2,
    /** on its back for `downSec`, the last `rightSec` of it righting itself */
    downSec: 1.8,
    rightSec: 0.7,
    /** then the loser walks `partDist` × its length away over `partSec` */
    partSec: 4,
    partDist: 1.2,
    /** no new bout for `cdMin`..`cdMax` s after one (`cdAbort` after one broken off) */
    cdMin: 40,
    cdMax: 80,
    cdAbort: 15,
  },
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

/**
 * A nest flooding (sim/nestFlood.ts; claude/story/06-spec-levels-5-7-and-lengths.md §4, level 6 "High Water"; DESIGN.md
 * 3.12c). Only a story (or a dev URL) starts one: `startNestFlood`. The water pours in at the entrance, runs down the
 * tunnels and fills the nest from its deepest hexes (farthest from the entrance along the tunnels) back up to the
 * entrance, hex by hex at a steady inflow (a big chamber takes longer to fill than a tunnel).
 */
export const NEST_FLOOD = {
  /** seconds the whole nest takes to fill (startNestFlood's default): a dramatic moment, short enough to watch through */
  fillSec: 45,
  /**
   * seconds an ant, the queen or a creature holds its breath under water before it starts to drown (real ants survive
   * hours under water; a game keeps it to a short window)
   */
  breathS: 6,
  /** then it loses this share of its maximum health a second (10 s more from full health: about 16 s in all) */
  drownFrac: 0.1,
  /** creatures (bigger, more air in them): this share a second */
  creatureDrownFrac: 0.05,
  /** brood (no health): an egg or larva under water this long past `breathS` is dead */
  broodS: 4,
  /** breath comes back this many times as fast out of the water */
  breathBack: 2,
  /** speed in water (swimming, × the walking speed) */
  swimMul: 0.45,
  /**
   * The colony's ants at home keep working until the water comes within this many hexes (along the tunnels) of where
   * they are; then they climb to higher ground at least `keepAbove` + 1 hexes above the water and stay there; workers
   * fetch brood lying within `rescueAhead` hexes above the water (and not under it yet) up with them. Jobs within
   * `keepAbove` of the water stop.
   */
  keepAbove: 2,
  rescueAhead: 3,
  /** how far (mm) a worker goes for brood to carry up */
  rescueR: 90,
  /** render: seconds a hex's water takes to rise from the floor to its full depth after it goes under */
  riseS: 2.5,
  /** render: the full water depth as a share of the nest's wall height (the walls' upper slopes still show above it) */
  depthOfWall: 0.6,
};

/**
 * Nest entrances (sim/entrances.ts; claude/maps/02-spec-nest-entrances, user spec 2026-11-01 "one wide underground
 * entrance, three surface holes per anthill"; DESIGN.md "Entrances"). Each nest has one entrance: a 7-hex flower at the
 * nest's edge underground, and three holes in its anthill on the surface, all leading into it, always open.
 */
export const ENTRANCE = {
  /** surface holes per anthill */
  holes: 3,
  /** maps without anthill sites: the holes lie this far (mm) from the colony's centre, 120° apart, by species */
  holeR: {
    lasius: 18,
    formica: 22,
    atta: 26,
    solenopsis: 20,
    eciton: 20,
    plagiaria: 18,
    hell: 16,
    aurimyrmex: 18,
    termant: 18,
    nasute: 18,
    sickle: 16,
  } as Record<string, number>,
  /** holeR for a species not listed (authored sites put their holes about 22 mm out) */
  holeRDefault: 18,
  /** two holes of an anthill are at least this far apart (mm; the map validator and the fallback placement) */
  holeGap: 16,
  /**
   * an ant waiting for a hole (no credit) takes another hole of the same anthill that has credit when that one is at most
   * this much farther on its way (mm)
   */
  switchMm: 14,
  /** … plus this fraction of its way (a crowd bound far off spreads over all three holes) */
  switchFrac: 0.25,
  /** ants through one hole per second, in and out together (each hole has its own credit) */
  passPerS: 10,
  /** ants that may pass a hole at once after a quiet spell */
  burst: 4,
  /** seconds for a fallen colony's holes and flower to cave in */
  collapseS: 60,
  /** entrance hexes move ants like a level I highway */
  tunnelSpeed: 1.1,
  /** creature caves keep a tunnel of this many hexes rising to their one hole */
  caveTunnelLen: 3,
  /** traffic shown in a hole's tooltip: ants through it over this many seconds */
  trafficS: 10,
  /** the refuse spot lies this far (mm) beyond the anthill's holes, between its first two */
  refuseMm: 24,
};

/**
 * Layered ground (claude/maps/05-spec-layered-maps.md; world/layers.ts, docs/maps/layers.md): terraces one `step` above
 * the other, their banks too steep to walk, joined by ramps no steeper than `rampMaxSlope`.
 */
/**
 * Titans dig into nests (claude/creatures/01-spec-digging-titans.md, user 2026-11-02; the game's own twist: in EotU titans
 * never enter nests; holes made easier: claude/creatures/02-spec-easier-titan-holes.md, user 2026-11-03). A titan digs one
 * surface hole wider: `holeWork` ÷ its `dig.speed` seconds undefended, × (its size ÷ `sizeRef`)^`sizeExp` (a bigger titan
 * digs a bigger hole, a little slower). Defence slows it by the damage it takes a second (smoothed over `rateSec`, as a
 * share of its health): its pace = `slowFloor` + (1 − `slowFloor`) ÷ (1 + (rate ÷ `slowRate`)²) — a few ants barely
 * matter, a big army nears the floor (about twice the time). A hit of `heavyFrac` of its health in one tick knocks
 * `heavyBack` of the work back, never below the last of the `checkpoints` reached (the hole's visible stages). Partial
 * work stays on the hole for `holeMemorySec` s. It gives up below `giveUpHealth` while digging (a story script may forbid
 * that: STORY.titanRaid), and a skirmish titan only sets out above `raidMinHealth`. Then it walks into the nest at
 * `undergroundSpeed` × its speed: every soil or stone hex its body touches (its body radius + `breakMargin` mm) opens at
 * once. It leaves below `fleeHealth`, after `maxStay` s, or once the queen is dead. The breach (the widened hole, drawn
 * `breachHoleMm` × (size ÷ `sizeRef`)^0.5 wide) is repaired by the colony over `repairSec` s once the titan is gone.
 * Skirmish ("Titans raid nests", on by default): after `peaceMin` minutes, a titan raids at most every `raidCooldown`
 * minutes (a `raidChance` a minute once off cooldown), a colony within `raidRange` mm (weighted by its ants and food), at
 * most `maxRaiding` titans at once; the colony is warned `warnSec` s before the titan reaches the hole.
 * (Before 2026-11-03: `holeWork` 40, any hit 45 % pace for 1.2 s, heavy hits 15 % back to zero, giving up at 35 %.)
 */
export const TITAN_DIG = {
  holeWork: 16,
  sizeRef: 90,
  sizeExp: 0.1,
  slowFloor: 0.55,
  slowRate: 0.008,
  rateSec: 2,
  heavyFrac: 0.05,
  heavyBack: 0.08,
  checkpoints: [0.25, 0.5, 0.75],
  holeMemorySec: 60,
  giveUpHealth: 0.55,
  raidMinHealth: 0.85,
  undergroundSpeed: 0.8,
  breakMargin: 1.5,
  fleeHealth: 0.25,
  maxStay: 180,
  repairSec: 120,
  peaceMin: 12,
  raidCooldown: 8,
  raidChance: 0.35,
  raidRange: 700,
  maxRaiding: 1,
  warnSec: 25,
  /** the widened hole's radius as drawn for a titan of `sizeRef` (mm; render only — the breach is still the colony's hole) */
  breachHoleMm: 10,
};

export const LAYERS = {
  /**
   * Straight steering (a chase, the last stretch to a point) that would cross a bank goes round by the ramps instead,
   * along a shared surface field to the target rounded to `routeCell` mm (user 2026-11-02 12:08: ants failed to find
   * their way up or down a slope)
   */
  routeCell: 24,
  /** a foe across a bank (the straight line to it crosses a cliff) scores as if this many times as far (squared) */
  crossBankScore: 9,
  /** height of one level (mm): about 8–9 worker lengths */
  step: 34,
  /** horizontal width of a bank (mm): 34 mm over 12 is about 70° */
  bankW: 12,
  /** the bank's outline wanders this far (mm) either side of the authored shape, over features of `jitterScale` mm */
  bankJitter: 5,
  jitterScale: 70,
  /** a ramp's sides blend into the ground beside it over this many mm */
  rampSide: 8,
  /** the steepest ground ants and creatures walk (tan of the slope: 0.75 ≈ 37°); steeper bank and ramp-side ground blocks */
  maxWalkSlope: 0.75,
  /** the validator's limits for ramps: slope along the path (tan 25°), width (mm) */
  rampMaxSlope: 0.47,
  rampMinWidth: 40,
  /** ants walking up a ramp go at this share of their speed (down: full speed) */
  upSpeed: 0.85,
  /** optional damage bonus for fighting from higher ground (off: EotU has none) */
  highGroundBonus: 0,
};

/**
 * Story mode (claude/story/02-spec; sim/story, docs/story/DESIGN-STORY.md). Difficulty multipliers (every one here):
 * `enemyStat` scales enemy ants' and creatures' health and damage (`settings.enemyStatMul`), `wave` the size of
 * scripted attack waves, `aggression` the rival AI's raid margin and the war AI (`settings.aggression`), `food` the
 * player's starting food, `rival` the rival colonies' head start (developed nest and starting workers), `boss` a story
 * boss's health (titans: the tarantula of the nights, the Spider Mother; gentler than `enemyStat`, which bosses skip).
 */
export const STORY = {
  difficulty: {
    // events: the surprise events' chance × this (claude/story/06-spec §6: fewer on Easy, more on Hard and Brutal)
    easy: { enemyStat: 0.75, wave: 0.6, aggression: 0.6, food: 1.6, rival: 0.7, boss: 0.75, events: 0.6 },
    normal: { enemyStat: 1, wave: 1, aggression: 1, food: 1, rival: 1, boss: 1, events: 1 },
    hard: { enemyStat: 1.2, wave: 1.35, aggression: 1.3, food: 0.85, rival: 1.25, boss: 1.1, events: 1.3 },
    brutal: { enemyStat: 1.4, wave: 1.7, aggression: 1.6, food: 0.7, rival: 1.5, boss: 1.2, events: 1.6 },
  },
  /** a member leaving the map by an edge point is gone once this near it (mm) */
  edgeLeave: 26,
  /** surprise events: a big one due while another runs waits this long after it (s) */
  eventGap: 20,
  /** a hot spell: the speed of ants on the surface × this */
  heatSpeed: 0.8,
  /** stolen-caste slots: one to start, one more per boss beaten (later chapters) */
  slots: { start: 1, perBoss: 1 },
  /** seconds before a cue that waits on the world gives up and the scene moves on */
  cueTimeout: 60,
  /** how near (mm) counts as arrived for a walking cue */
  arriveMm: 5,
  /** a group cue is done when this share of its living members have done it */
  groupDone: 0.8,
  /** members of a walking group spread round the point (mm per member, a loose cluster) */
  spread: 4,
  /** a wave is beaten when this share of it is dead or gone (or it has been back home) */
  waveBeaten: 0.8,
  /** a guarding actor chases what came within its radius at most this far beyond it (mm) */
  guardLeash: 40,
  /**
   * Story titan raids are guaranteed (claude/story/05-spec-story-titans-get-inside.md, user 2026-11-03): a titan on a
   * `digInto` cue walks to the hole at no less than `minPace` of its speed whatever holds it (riders, glue, jaws), and
   * sidesteps after `stuckSec` s without getting nearer; digs at no less than `minPace` (no knock-backs), breaking through
   * by `digCap` s whatever happens; can't drop below `hpFloor` of its health until it has been inside; a start that fails
   * retries every `retrySec` s. Inside, its bites on the queen do `queenBite` × (so the fight stays winnable).
   */
  titanRaid: {
    minPace: 0.6,
    stuckSec: 3,
    digCap: { easy: 12, normal: 15, hard: 18, brutal: 20 } as Record<'easy' | 'normal' | 'hard' | 'brutal', number>,
    hpFloor: 0.1,
    retrySec: 1,
    queenBite: { easy: 0.4, normal: 0.6, hard: 0.8, brutal: 1 } as Record<'easy' | 'normal' | 'hard' | 'brutal', number>,
  },
  /**
   * Traits (claude/story/04-spec §4): permanent colony-wide bonuses in story mode, earned from titans and mega colonies,
   * kept in the campaign save and given to the player's colony in every story level (`Colony.traits`); never in skirmish
   * or multiplayer. Only Spiderling Venom is built (chapter 1); the rest are planned for later chapters.
   *  - spiderlingVenom: every bite of the player's ants (on an ant or a creature, riders too) adds a venom stack of
   *    `dps` for `duration` s, up to `maxStacks` (a little, stacking a little).
   */
  traits: {
    spiderlingVenom: { name: 'Spiderling Venom', from: 'The Spider Mother', desc: 'Your ants’ bites carry a little spider venom: a weak poison that stacks a little.', dps: 0.6, duration: 4, maxStacks: 3, built: true },
    // antlerPlating (The Antlered King, chapter 1 level 5): every ant of the colony has `armor` more armour (bites lose
    // that much more; acid a quarter of it, as with an ant's own armour)
    antlerPlating: { name: 'Antler Plating', from: 'The Antlered King', desc: 'Harder shells: every one of your ants has a little more armour.', armor: 1, built: true },
    forcipuleStrike: { name: 'Forcipule Strike', from: 'a giant centipede titan', desc: 'Soldiers’ first bite in a fight deals bonus damage.', built: false },
    irritatingHairs: { name: 'Irritating Hairs', from: 'the red-knee tarantula, as a boss', desc: 'Enemies that attack your soldiers are briefly slowed.', built: false },
    ambushReflex: { name: 'Ambush Reflex', from: 'a giant mantis titan', desc: 'Attack speed bonus for the first seconds of each fight.', built: false },
    fungalLarder: { name: 'Fungal Larder', from: 'the leafcutter mega colony', desc: 'Food stores hold more.', built: false },
  } as Record<string, { name: string; from: string; desc: string; dps?: number; duration?: number; maxStacks?: number; armor?: number; built: boolean }>,
};

/**
 * A shared underground: set tunnels between nests (claude/underground/01-spec-shared-underground-tunnels.md, user
 * 2026-11-06; CHANGE_PLAN §27 — the game's own feature: in EotU every nest is sealed). Every colony nest has a ring of
 * `margin` hexes of unbreakable rock round its diggable interior; a route to a neighbour is a `width`-hex-wide path of
 * diggable soil through that rock from a gate on the nest's edge to the rim (its half; the other nest's half meets it
 * there). Up to `allPairsMax` colonies every pair of nests gets a route; more: each nest's `neighbours` nearest, and no
 * route crosses another. Gates keep `gateGap` edge hexes apart and `gateAway` hexes from the entrance flower; the path
 * wobbles `wobble` hexes to each side. A route hex costs `hexWorkMul` × `jobPoints` to dig (a normal crew of six
 * level-1 workers: about 3–4 minutes a route; `tools/tunnel-dig-probe.ts`). Hints show past a digger's frontier within
 * `hintRange` steps of the far gate; a defender is warned when an enemy's frontier is within `warnRange` steps of its gate
 * (a dig sound every `warnEvery` s). Units in a foreign nest see `sight` hexes round them. `ai`: when AI colonies tunnel
 * (`from` seconds by level, Easy never; a `chance` each war-brain decision), when they dig out to meet attackers
 * (`meetFrom` level), when allies link nests (`allyLinkFrom` s).
 */
export const TUNNELS = {
  margin: 8,
  width: 3,
  allPairsMax: 4,
  neighbours: 3,
  gateGap: 5,
  gateAway: 4,
  wobble: 1,
  hexWorkMul: 3,
  hintRange: 3,
  warnRange: 3,
  warnEvery: 4,
  sight: 5,
  /** an ant standing this far (× hex R) past its rim step's centre toward the rim has crossed to the other half */
  crossFrac: 0.45,
  ai: {
    from: [0, 900, 600, 420],
    chance: [0, 0.35, 0.6, 0.8],
    meetFrom: 2,
    allyLinkFrom: 300,
  },
};
