# Animation pass: smooth, varied, RTS-readable (pilot)

User spec: project doc `claude/realism/03-spec-jaws-and-animation.md`, part 2. The pilot covers the tropical
fire ant (worker, plus the soldier, major and queen on the same morph family) and the stag beetle. The
rollout to every species waits for the user's approval. All of it is render-only. The deterministic sim gives
positions, headings, states, cooldowns, hit points and events; the renderer decides how bodies move between
them and never feeds anything back. `npx vite-node tools/check-determinism.ts` stays clean.

## Ants: the motion controller and the planted feet

`src/render/ants/antMotion.ts` holds the per-ant state, gated by `animV2(morph)` (the pilot covers `fire_*`).
The vertex shader's planted-feet solve is in `src/render/ants/antMaterial.ts` (`uPlant`).

- **Planted feet.** Each foot has a neutral place on the ground. `plantHomes` in `antGeometry.ts` pulls it in
  from the nearly straight rest pose until the leg can reach forward and back. While a foot stands, its
  target moves back under the body by the stance sweep (`aD.y`) and round the body's centre by the turn per
  stance (`aE.y`). In the swing it comes forward lifted. The leg reaches its target by a yaw at the coxa and
  an analytic two-bone solve in its own plane, so no bones and no per-foot state are needed: it stays an
  instanced, vertex-shader animation.
- **Gait from the body's motion.** The cadence is set so that neither the sweep nor the turn per stance goes
  past the legs' reach. Each is derived from the smoothed forward speed and turn rate, so a planted foot moves
  back exactly as far as the body moves forward, and turning in place steps round. The stride is a little
  shorter when slow. On stopping, the last stance is held: the feet stay where they are instead of sliding
  home. `plantedFoot` mirrors the shader on the CPU for tests.
- **Turning.** The body's heading follows the sim's through a critically damped spring (18 rad/s,
  rate-limited to 12 rad/s). The head leads the turn, and the body leans into turns and pitches when speeding
  up or slowing down.
- **Between ticks.** Positions and headings interpolate between the 20 Hz ticks as before. Now the attack's
  phase also runs on between ticks, so a strike is as smooth at 60 fps as a walk.
- **Variety** (seeded by the ant's id, so clips repeat): stride ±10 %, body size ±5 %, antenna sweep speed
  ±25 %, gait phase, and which idle and when.
- **Idles** when standing still and calm: antenna grooming, leg rubbing, looking round, antennating a
  neighbour, and small repositioning steps (the body turns a little and the legs step round), with pauses
  between.
- **Crossfades.** Poses blend out and in within 0.1–0.25 s. Attacks ease in at 12/s and out at 9/s.
- **Attacks** (`attackPoses.ts`). Each has a wind-up, a fast strike that lands on the damage tick, and a
  recovery. Fire ants cycle three:
  - **lunge bite**: draw back with the jaws agape, thrust and snap;
  - **grip and sting**: seize, swing the gaster under, pivot round the grip and jab;
  - **side clamp and tug**.
- **Hits.** A recoil or a side flinch with a small overshoot, a brief warm flash, and a 50 ms hit-stop of the
  ant's own animation clocks. The flinch and flash are rate-limited so steady biting does not flicker.
- **Deaths.** The legs curl in about half a second with a fading twitch, and the body rolls onto its back
  or its side.
- **Flung ants** tumble in the air, land with a bounce and right themselves.
- **Secondary motion.** The antennae lag and overshoot on damped springs.
- **Postures** (from the sim, as before): alarm (gaster raised, jaws open), carrying (head up), digging. The
  fire ant's sting now rests retracted and slides out to sting.
- **LOD.** Close and mid-range models use the full shader solve. Far away the top-down impostor frames run
  on the same gait phase. The controller itself is a few dozen operations per ant.

## Stag beetle (`src/render/creatures/stagBeetle.ts`)

- **Planted feet.** World positions stay put until their tripod steps. A tripod lifts when the body has
  moved or turned far enough from its resting places, and steps to where they will be a moment later
  (velocity and turn rate ahead). The two tripods alternate, turning in place steps round, and a last small
  step settles the feet when it stops. The body rocks toward the planted tripod.
- **Attacks** use anticipation, a fast strike and overshoot:
  - **Grab:** the antlers spread and quiver while the head lowers and the body sinks forward.
  - **Clamp and lift:** the jaws snap shut, then the head heaves up with an overshoot while the jaws squeeze
    the struggling ants.
  - **Toss:** a fast flick with an overshoot.
  - **Rear-and-slam:** a crouch, the rear with an overshoot, then the slam exactly on the sim's slam tick,
    with a dust ring, camera shake and hit-stop, and a dip.
  - **Pinch:** in its first phase, a quick pinch of the antlers on each bite.
- **Idles:** antenna flicks, a jaw opening, and a slight rear-up.
- **Hits:** two flinches (a jolt back, a roll aside) with a softer flash.
- **Death:** the legs curl in half a second, twitching, and it rolls onto its back.
- **Secondary motion:** the antlers and antennae sway on springs (lagging turns and steps). Riding ants follow
  the animated body as before.

## Impact emphasis

The stag beetle's slam and its clamp shake the camera a little. The shake is scaled down when zoomed far out
and only applies if the hit is in view. Both also hold the sim for 50 ms or 33 ms, a hit-stop of a few
frames in single player (the sim is only delayed, never changed). The hell ant's impale and the bosses'
footfalls already did this. **Camera shake can be reduced or turned off** in Menu → Graphics → Camera shake
(Off, Reduced, Full; saved in the profile).

## Compared with real animals

- **Ants** (Zollikofer 1994, *Stepping patterns in ants*, J. Exp. Biol. 192:107). Workers of many species use
  an alternating tripod gait over all speeds, with stride lengths of 57–70 % of twice the midleg length and
  10–20 strides per second. Stride length grows roughly as speed^0.44, and at higher speeds frequency does
  more of the work. In the pass:
  - Fire ant workers walk a tripod too.
  - At their game speed of 15 mm/s they take about 1.6 mm strides at about 9–10 Hz. Real ants of that size
    stride about 2.5 mm at about 6 Hz.
  - The model's legs cannot sweep farther without the feet sliding (the rest pose is nearly straight), so its
    strides are shorter and quicker than a real ant's. That still reads as a busy small ant.
  - The stride shortens at low speed, roughly as the measured power law.
- **Stag beetle.** A slow, deliberate tripod, as in the species notes (no measured stride data was found).
  Males wrestle and throw rivals with the antlers, which the grab-and-toss follows.

## Acceptance (spec §2.7)

Results are logged in `PROGRESS.md`.

- **No foot sliding:** `tests/animation.ts` follows every planted foot in world space through scripted walks,
  using the CPU mirror of the shader solve.
- **Variety:** 100 idling ants, `clips/idle100_*`.
- **Readable attacks:** a fresh reviewer names the attacks from frame strips without UI (`clips/atk*`,
  `attack_game`).
- **Impacts present but not overdone:** the shake setting.
- **Gaits:** see above.
- **Clips:** `docs/realism/animation/clips/` (WebM in real time and at 0.25×, GIFs) and
  `docs/realism/animation/strips/` (before and after frame strips).

Lab: `?scene=animlab&clip=<name>` (`src/dev/animLab.ts`; `anim=1` shows the old motion). Recorder:
`tests/browser/anim_clips.py`. Strips: `tools/anim-sheets.py`. Stress comparison:
`tests/browser/anim_stress.py`.
