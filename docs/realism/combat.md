# Combat and death animation (spec 04) — pilot: fire ant worker and major

Spec: project doc `claude/realism/04-spec-ant-attack-and-death-animations.md`. Plan: `claude/realism/05-plan-attack-death-pilot.md`.
The work is render only; the sim decides who hits whom and when. The one sim change is a deterministic integer recording what last hurt an ant (`Ant.lastHit`, `HIT.*`).
Research notes: docs/creatures/solenopsis-geminata.md, "Combat and death behavior". Clips: `combat/fire-ant/`, `combat/stag-beetle/`.

## The body moves over planted feet
Before this pass, attack, flinch and lean offsets went into the instance matrix, so the feet moved with the body. That was the "stiff legs, the body shifting up and down" and "legs not planted, the body rotates" notes (ratings A3, A5).

The transform is now split in two:
- **Ground frame.** Position, heading and the ground's slope, plus a flung tumble or a death roll.
- **Body offset.** Translation and rotation over the ground frame.

The instance matrix is ground × offset. Every instance also writes 4 texels to a float texture (`uBodyTex`, 128 instances per row, read with `gl_InstanceID`), because 15 of the 16 vertex attributes are already in use:

| texel | x | y | z | w |
|---|---|---|---|---|
| 0 | offset translation (object units) | | | sideways stance sweep |
| 1 | offset rotation vector | | | stance spread |
| 2 | gaster yaw | sting out | fore legs raised | decapitation |
| 3 | corpse drying | crushed flat | – | – |

The vertex shader puts each planted foot's ground target into the body frame (`R⁻¹(g − t)`) before the two-bone solve. The legs then bend and straighten under a body that lunges, rises, leans and twists, while the feet stay where they are. With the offset at identity the result is exactly the old solve.

- **Lean and flinch.** The lean into turns, the hit flinches and the sim's stun stagger are body offsets too.
- **Gait.** The gait gained a sideways sweep (`Dz`), so the ant can step sideways as well as forward and round.
- **Other materials.** Each LOD material has its own texture. The glue shell copies its instance's texels. The impostors and the labs leave the texture off.

## Attacks (`attackPoses.ts` `attackPoseV2`)
Every attack has the same three beats:
1. A readable wind-up to 0.5 of the cycle, holding with a tremble of tension until 0.62.
2. A strike lasting 0.62 → 0.7 of the cycle (about 4 frames at the default 0.8 s attack interval), landing on the sim's damage tick.
3. A recovery.

Jaws, sting and gaster do the attacking. The legs plant, brace wider (spread), lift the body or step; they never strike.

- **Worker: grip-and-pivot sting series.**
  - Grab, then plant wide, rise on the legs (+0.1 L) and arch (nose down about the jaws).
  - The gaster curls under (−1.6 rad) with the sting out, then jabs forward under the body (−2.8 rad) and pumps.
  - Between stings the ground frame turns 0.3 rad about the jaw tips, so the legs step round the grip. That gives the ring of stings.
  - A series is 3–5 stings on one grip (`holdIn`/`holdOut` keep the grip between cycles).
- **Worker: lunge bite, clamp and tug, quick sting.**
  - Lunge: crouch back on bent legs, surge forward and down, snap, then worry the grip with a tug and a head shake.
  - Clamp: twist over the planted feet, swing across and clamp, then brace wide and haul back.
  - Quick sting: a quick tuck and a single jab.
- **Bouts** (`antMotion.ts` `attackPlan`, seeded per ant). Six cycles: the sting series, then jaws-only attacks.
- **Major.** A crushing bite (low wide brace, head lowered, jaws opening slowly, surge and crunch, a shudder) and, now and then, a sideways head swing (never twice running).
- **Threat display (alarm).** Legs planted wider, body raised, gaster flagged near vertical, sting out, the gaster waving slowly, small head turns. It matches the posture in the reference footage (Obin & Vander Meer 1985: gaster flagging).

## Hit reactions
- **Two light reactions:** a recoil and a side flinch, with a flash and a 50 ms hit-stop of the ant's own clocks.
- **One heavy reaction**, when a single hit takes over a fifth of the most hit points the ant has had. The ant is shoved back a quarter of a body length in 0.1 s, reels (front up, jaws agape), then steps back to its place.
- All three are body offsets over planted feet.

## Deaths by cause (`antMotion.ts` `deathPose`)
The sim records what last hurt an ant:

| Code | Cause | Where it is set |
|---|---|---|
| bite | an ant's bite | `damageAnt` |
| venom | venom ticked it to death | `venomTick` |
| acid | acid | `damageAnt` |
| crush | a creature's bite | `damageAnt` |
| fall | the fling's landing | `flungUpdate` |
| drown | flood water | `floods.ts` |
| starve | lost / exhausted | `areas.ts` |
| decapitation | a killing bite of ≥ 45 % of its maximum life | `damageAnt` |

The cause goes out on the death event and is kept on the corpse.

How each one plays:
- **Bite:** the legs curl in half a second with a twitch, and the ant rolls onto its back or side.
- **Venom:** convulsions (tremble, legs flexing out of time, gaster pumping), then it curls tight on its side.
- **Acid:** writhing and rolling with the legs flailing, then on its back.
- **Crush:** flattened at once, legs splayed flat.
- **Fall:** on its back, kicking a moment.
- **Drown:** slow paddling that weakens.
- **Starve:** a slow collapse, the antennae drooping.
- **Decapitation:** the head comes away and rolls in front, while the body collapses, the legs twitching on.

Big kills (crush, decapitation) get a beat of hit-stop and a flash.

The corpse view keeps the ant's own id, so the death plays on through the hand-over from the dead ant to the corpse food item at 0.5 s. Its gloss fades (clearcoat down, roughness up) over the time it lies there. It then sinks along the ground's normal, deep enough to vanish (rating A9: on its back, the old lift along the body's up raised it instead).

## Sound hooks
These are render-side moments with no sim event of their own: a grip, the major's crunch, landing on the back, righting itself, and an acid, crush or decapitation death. `animHooks` in antRenderer.ts carries them into `GameAudio.anim`. Bites, stings, flings and deaths already sound on the sim's events.

## Fixes from the user's ratings (round 1)
- **A1:** the grooming fore leg comes up beside the head.
- **A2:** pose crossfades take about a quarter of a second.
- **A3/A5:** planted attacks, as above.
- **A4:** the sting rises on the legs.
- **A9:** sinking and despawning.
- **A10:** a flung ant tumbles about its middle in the air.
- **A11:** the flagging threat display.
- **A13:** the stag uses the old walk cycle walking straight on and the planted steps for turning and stopping.
- **A14:** the antlers clamp past closed on the lifted ant and stay shut through the flick; a tossed ant spins 1–1.5 turns a second.
- **A16:** the stag's death fold starts from the feet's last places, with a smooth twitch.
- **A17:** the stag uses the old idle.

## Checks
- **Determinism:** `tools/check-determinism.ts` is clean (56 files). The sim change only assigns a constant integer.
- **Tests:** `tests/animation.ts` passes. Planted-foot drift is unchanged (the stance sweep still eases fast: slower easing let the feet drift past 6 % when turning in place).
- **Clips** (5–10 s, close and gameplay zoom): `combat/fire-ant/` and `combat/stag-beetle/`.
- **Cost:** the body offset is one quaternion and 16 floats per ant on the CPU, plus 4 texel fetches per vertex on the GPU. See the cost entry in PROGRESS.md.
