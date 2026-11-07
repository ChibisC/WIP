# Sound research (audio v3)

Listening notes for every sound the game makes: what the real animal or material sounds like, what makes it read at game scale, and where the game's sound comes from. Spec: `claude/audio/03-spec-sfx-rework-insect.md`.

**Source for every sound: made for this game.** Each is rendered offline by `tools/audio/sfx` (one recipe per sound, numpy/scipy) from the physics below. Downloading recordings was not possible from the build machine (the shell cannot reach Freesound, Kenney or OpenGameArt); optional raw material the user could fetch is in [download-list.md](download-list.md). A recording dropped into `audio-src/recordings` replaces a sound's rendered takes without code changes.

## What makes insect sounds read

- **Small bodies ring high and briefly.** A mandible, a tarsus or a leg segment is a millimetre-scale shell of cuticle: its resonances sit at several kilohertz (much of their energy is ultrasonic) and die within milliseconds. A believable chitin click is an impulse through a few narrow, *inharmonic* modes at 2–12 kHz with 1–10 ms decays, never a pitched beep and never a low "thump". Bigger animals ring a little lower and longer, which the game also gets by playing big castes and creatures slower (`sizeRate`).
- **Breaking cuticle is a cascade.** A bite that cracks cuticle is many micro-fractures in a few tens of milliseconds, densest at the start, their resonance falling as the pieces get smaller and looser (granular crunch).
- **Ants talk by stridulation.** Many ants have a file of fine ridges on the first gastral tergite and a scraper on the postpetiole; raising and lowering the gaster drags one over the other, one impact per ridge, so each stroke ("chirp") is a fast tooth train ringing the body. Ants stridulate when alarmed, and **when trapped or held** (buried leafcutter workers stridulate and nestmates dig them out: Markl 1965). Leafcutters stridulate **while cutting** too: the vibration stiffens the leaf like a vibratome (Tautz, Roces & Hölldobler 1995). The signal is broadband with much energy in the ultrasound (Messor: the spec's source); the game uses the audible part, a dry, fine rasp.
- **Termites drum.** Termite soldiers bang their heads on the gallery wall in bursts: *Macrotermes natalensis* at 11 ± 3 beats a second (5–22 beats a signal), *Odontotermes* at 19 ± 2 (4–29), with most energy between 1 and 5 kHz (Hager & Kirchner 2013, J. Exp. Biol. 216: 3249). The drum is an alarm, not an idle habit.
- **Wet sounds are tiny bubbles.** Liquids sound through bubbles ringing at their Minnaert resonance, rising slightly as they close (van den Doel 2005). At ant scale a "splat" is a few small bubbles and a fizz, never a big splash.
- **Trap jaws are the fastest thing in the game.** Trap-jaw ant mandibles close in about a tenth of a millisecond at 35–64 m/s (Patek et al. 2006, PNAS 103: 12787); hell ants (Haidomyrmecinae) had vertical trap jaws. The sound is an almost pure impulse.
- **Avoid human-scale foley.** Movie punches, whooshes, low booms and explosions read as people. Insects are small: high, dry, quick and quiet; even titans are big *insects*, so their sounds are the same clicks, crunches and scrapes, lower and fuller, with soil around them.

## Attacks, hits and deaths (spec §4)

Every one of these starts within a few milliseconds of its file's start (checked by `tests/browser/audio_files.py`), and the game plays sim-event sounds on the frame that shows the tick they happened on, so they land on the animation's strike frame (`antViews.ts` closes the jaws on the damage tick).

| Sound | The real thing | What reads at game scale | Recipe |
|---|---|---|---|
| `combat.mandible_click` (worker bite) | Mandible tips meeting cuticle; the two jaws rarely touch at the same instant | A dry, high **double click**, 3–9 ms apart, 3–11 kHz | two short modal clicks and a grain or two |
| `combat.mandible_snap` (soldiers, majors) | A larger jaw closing hard enough to dent or crack | A sharper click and a brittle crunch | contact burst, double click, 8–14 micro-fractures (8 → 3 kHz) |
| `combat.bite_crush` (fire ant and Atta majors, the Termant soldier's Macrotermes jaws) | Big crushing mandibles breaking a body | Many tiny fractures, a little lower and fuller | click, 26–40 fractures (6.5 → 1.7 kHz), a lower second burst |
| `combat.scissor_cut` (leafcutter soldiers; 40 % of Atta majors' bites) | Atta mandibles shear like scissors; they stridulate while cutting | A short rasp as the blades pass and a snip | a 45–70 ms stridulation tooth train (1.6–2.4 k teeth/s) with friction, then a click |
| `combat.chitin_crack` (heavy hit taken) | Cuticle cracking | A brittle crunch | click and 14–24 fractures |
| `combat.hit_tick` (light hit taken) | A jaw glancing off cuticle | A tiny chitin tick | one 4–12 kHz click |
| `combat.grip` (a hold's grip, claws catching a creature) | Legs scrabbling for purchase; the held ant stridulates | Fine scratchy grains and a squeak | friction (stick-slip catches) and 1–3 stridulation chirps |
| `combat.struggle` (prey on a hell ant's jaw, a sickle-jaw's grip, hooks, pins) | A held insect kicking and stridulating | Scrabble with squeaks on and off | friction bed and repeated short chirps |
| `combat.grapple_scuffle` (bed) | Many ants wrestling | A texture of scrapes, grips and squeaks the engine plays in grains | 8 s of overlapping friction, clicks and chirps |
| `combat.sting` | The lancets piercing, venom going in | A tiny wet tick and a faint fizz; army ants a little stronger (played lower and louder) | a high click, 2–4 tiny bubbles, a thin fizz |
| `combat.sting_fire` | Fire ants grip and sting repeatedly | Quicker and doubled | two ticks 16–30 ms apart, a short fizz |
| `combat.acid_spray` | Formic acid squirted from the acidopore in pulses | A fine, fizzy hiss with droplet ticks, pulsing | 3.5–13 kHz hiss pulsed at 18–30 Hz, grains, fizz |
| `combat.acid_splat` | Acid on cuticle | A small wet tick and a fizz, no splash | a click, a few bubbles, a fizz thinning out |
| `combat.mortar_pop`, `combat.mortar_land` | A droplet lobbed and landing | A soft pop at launch; a wet fizz on landing (no explosion) | a low bubble and a breath of spray; a squelch, bubbles and a long fizz |
| `species.hellant_snap` | A trap jaw firing (~0.1 ms closure) | The fastest, sharpest crack in the game | a 0.1 ms impulse ringing high modes for a few ms over a short woody ring |
| `species.hellant_impale` (impale and finisher) | The horn and jaws going through a body | A wet crunch | click, 16–26 fractures, a falling squelch, bubbles |
| `species.army_hook` | Eciton soldiers' sickle mandibles hook in; prey stridulates | A hooking rasp, a seat click, the victim's stridulation | friction rasp, click, 2–3 chirps |
| `combat.termite_bite` | Termite heads are lightly sclerotised; their prey is soft | Duller and wetter | a damped low click, a soft crunch, a small squelch |
| `species.glue_splat`, `species.nasute_glue` (bed) | Nasute soldiers squirt sticky defensive secretion from the nasus | A sticky, stringy sputter; threads snapping | many tiny squelches at irregular rates, bubbles, high ticks |
| `species.sickle_snap`, `species.sickle_acid` | Sickle-jaw soldiers' crossed mandibles snap; the hold smears secretion | A double snap; a wet smear and a fizz (struggle: `combat.struggle`) | two clicks a hair apart; a squelch and a fizz |
| `species.termite_headbang` | Head-banging at 11–19 beats/s, energy 1–5 kHz | Dull, papery taps on carton and soil, in a burst | 6–12 taps through a "wall" body (0.9–4.2 kHz) at 11–19 Hz |
| `combat.fling` | An ant thrown clear | A short scrabble, a moment of silence, a light tick | friction, a gap, a click and grains |
| `combat.ant_death` | Cuticle cracking, then legs curling (death throes) | A brittle crack, then a faint, short twitch of clicks, quieter for small ants (the game scales it by caste length) | click, fractures, 6–12 fading ticks |
| `combat.termite_death` | Soft-bodied | A dull wet crunch and a few slow twitches | soft crunch, squelch, fading ticks |
| `combat.battle_bed` | A big melee | A dense insect brawl, never a crowd of people | 12 s of double clicks (55/s), crunches, friction, squeaks, high ticks, faint fizz |

## Creatures and titans

| Sound | The real thing | What reads | Recipe |
|---|---|---|---|
| `cr.spider_step` | Wolf spiders walk on hairy pads (scopulae) and are nearly silent | Soft, padded footfalls with a brush of hairs | lowpassed noise pads and a faint high brush |
| `cr.spider_pounce`, `cr.spider_fangs` | Push-off, a short leap, landing; chelicerae piercing | A scrape, a little air, a padded landing; a soft scrape and a wet tick | friction, a soft swish, pads and grains; friction, click, squelch |
| `cr.beetle_step`, `cr.beetle_bite` | Armoured tarsi and claws; heavy beetle mandibles | Hard quick clacks; a woody, hollow clack | 2–3 short clicks; a closed "shell" ringing 8–30 ms (0.9–3.8 kHz) |
| `cr.beetle_elytra` | Elytra opening, wings unfolding and beating (~80–100 Hz) | Two clacks, a crinkle, a brief buzz | hollow clacks, friction, a band-passed wingbeat |
| `cr.stag_clash` | Stag beetle mandibles locking | A heavy ringing clack and a scrape | two long hollow clacks (0.6–2.8 kHz), friction |
| `cr.centipede_patter`, `cr.centipede_bite` | Dozens of legs in metachronal waves; forcipules striking | A rippling patter; a surging ripple and a snap with a wet tick | 160–260 ticks/s modulated in waves; accelerating ticks, click, squelch |
| `cr.mantis_sway`, `cr.mantis_strike` | A mantis is silent in wait; the raptorial strike lasts tens of milliseconds | A very quiet rustle; a short swish and a snap as the spined tibia folds | soft friction; a 20–30 ms swish, click and crunch at 12–20 ms |
| `cr.pillbug_roll` | Tergites sliding shut | Plates clicking closed, faster at the end | 9 hollow clicks with shrinking gaps |
| `cr.caterpillar_crawl` | Prolegs gripping and releasing | Soft, squishy | slow squelches and soft friction |
| `cr.antlion_flick` | A head jerk flinging sand | A flick and a spray of grains pattering down | a tiny swish, 30–50 fast grains, 20–35 slower |
| `cr.creature_death`, `cr.cricket_burrow` | A bigger body breaking and slumping; shovel legs scooping soil | A heavier crunch, slump and twitches; rhythmic scoops | 35–50 fractures, a soft thud, ticks; friction and grains ×3–5 |
| `boss.footstep` | A 10–18 cm arthropod planting a leg | A tarsus click, a crunch of soil crust, the ground taking the weight, debris | click, crunch, a rough 55–75 Hz thud (no clean drum), grains |
| `boss.windup` (telegraph) | A huge joint loading up | A creak tightening (stick-slip 30 → 160 Hz) and claws scraping | creak through woody modes, friction swelling |
| `boss.slam` | A titan's body or jaws driven into soil | A crack of crust and cuticle, a heavy impact, a shower of soil (not an explosion) | click, 45–70 fractures, a 42–55 Hz rough thud, 90–140 grains, a little rumble |
| `boss.phase` | Hissing cockroaches and some beetles force air through spiracles; beetles stridulate | A big, rough stridulation and a hiss, never a roar | slow tooth train (140–260 teeth/s) through low body modes, a 2.5–9 kHz hiss |
| `boss.hairs` | A tarantula brushing urticating hairs off its abdomen | Quick dry brushing strokes | 3–5 bright friction strokes |
| `boss.arrive`, `boss.rumble` | Distant footfalls nearing; ground vibration | Footfalls getting brighter and louder over a rising rumble; a low rumble with grains shaken loose | footsteps lowpassed by distance over brown noise; brown noise with slow swells and grains |

## Work, brood, orders and alerts

| Sound | What reads | Recipe |
|---|---|---|
| `ant.dig_bite`, `ant.soil_grains`, `ant.pellet_drop` | A small crunch of packed grains; grains trickling and bouncing; a soft thud and scatter | fractures over a dull crumble; grains piled at the start; a soft thud and grains |
| `ant.pick_up`, `ant.put_down` (new: carrying is heard on pick-up and set-down, and now and then while carrying) | The mandibles closing on a load; a soft tap | a soft click and a short scrape; a light thud and a grain or two |
| `ant.drag_small`, `ant.drag_heavy` | A load scraping and bumping along | friction with bumps (lower for heavy loads) |
| `ant.food_cut`, `ant.seed_crack`, `ant.leaf_cut` | A fibrous wet crunch; a seed coat cracking; snips with the vibratome's faint buzz | fractures, a tear and bubbles; a hollow crack and fragments; repeated snips, crinkle and a faint stridulation |
| `species.termite_chew` | A termite worker chewing wood loose (quiet, only while gathering) | a small fibrous crunch |
| `ant.stridulate`, `ant.antenna_tap` | Alarm stridulation; the faintest double tap (ants only) | 3–5 chirps; two tiny clicks |
| `ant.egg_set`, `ant.larva_hatch`, `ant.queen_lay` | Soft and slightly wet; a fibrous wet tear; a soft wet sound | squelches, bubbles, soft friction |
| `ui.marker` | A natural chirp at five pentatonic pitches (the game sets the pitch), so the carrier stays clean | three pure cricket-like pulses at 2.9 kHz |
| `ui.marker_lift`, `ui.group_assign`, `ui.menu_tap` | A light click; a fingertip on a dry leaf; a tap on dry wood | hollow clicks; a short crinkle of grains |
| `ui.tool_dig`, `ui.tool_build`, `ui.tool_upgrade`, `ui.tool_delete` | Soil taps, a puff, a trickle, a clod crumbling | soft thuds, lowpassed puffs, grains, a low crunch |
| `ui.alert_queen`, `ui.alert_invasion`, `ui.alert_starving` | The colony's alarm: hard, fast drumming under bright stridulation (queen; at 0.45–2.6 kHz, where a fight is thin, so it cuts through); urgent drumming in two bursts (invasion); slow dull drumming (starving) | drum taps through a wall body at 13 / 17 / 3.8 beats a second, stridulation over the first two |
| `ui.message_good`, `ui.message_warn` | A dry seed pod shaken twice; two dull knocks on wood | grain rattles in a pod body; two low hollow knocks |

## Ambience and the other species' moments

| Sound | What reads | Recipe |
|---|---|---|
| Beds: `amb.wind_grass`, `amb.leaves_rustle`, `amb.sand_hiss`, `amb.rain`, `amb.water_stream`, `amb.cicada`, `amb.nest_room`, `amb.colony_rumble` | Gusts with blades and leaf ticks; dry litter crackling in flares; fine bright grains in gusts; drops thudding and slapping over a wash; many small bubbles; tymbal clicks resonating at 5–6 kHz, swelling; a close earthy room tone; a low rumble with distant scratching | stereo, 20–30 s, seamless (crossfaded), streamed in the game |
| One-shots: `amb.bird`, `amb.cricket`, `amb.katydid`, `amb.frog`, `amb.owl`, `amb.fly_pass`, `amb.drip`, `amb.raindrop_big`, `amb.thunder`, `amb.soil_trickle`, `amb.root_creak` | The naturally tonal calls stay tonal (songbird whistles and trills, a field cricket's 3–4 pulses near 4.5 kHz, a frog's pulsed croak, a tawny owl's hoot); a fly's 150–240 Hz wingbeat with a Doppler bend; a drop's rising "plink" (capped to a fraction of an octave); thunder's crackle and roll | tones with contours and vibrato, pulse trains through formants, bubbles, brown noise, creaks |
| `species.saiyant_surge`, `species.saiyant_crackle` | A rising rustle of rattled seeds with a stridulating shimmer; a crisp crackle | accelerating grains and chirps; dense high fractures |
| `species.termant_absorb`, `species.termant_caste` | A soft organic gulp; a rising chord of plucked tines | falling squelches and slow bubbles; modal tines |

## Removed (spec §2–3)

Ant and termite walking (all species, Termants included): `ant.step_soil`, `ant.step_leaf`, `ant.step_bark`, `ant.step_stone`, `ant.step_sand`, `ant.step_carton`, `ant.step_queen`, the climbing skitter on creatures' legs, the Termant skitter and papery shuffle, `species.nasute_move`, and the swarm movement bed `ant.swarm_bed`. Termite idle sounds: termites no longer get antenna taps, and their alarm drum plays only on a real alarm (a soldier attacked or grabbing, the colony's alarm ability, a conehead soldier charging a foe); the termite kit's procedural voices (`SickleJawAudio`: an unused bite snap and alarm drum, the hold's acid stream, fizz and struggle) were replaced by files. Details: CHANGE_PLAN.md §24.

## References

- Hager F. A., Kirchner W. H. (2013). Vibrational long-distance communication in the termites *Macrotermes natalensis* and *Odontotermes* sp. *J. Exp. Biol.* 216: 3249–3256.
- Patek S. N., Baio J. E., Fisher B. L., Suarez A. V. (2006). Multifunctionality and mechanical origins: ballistic jaw propulsion in trap-jaw ants. *PNAS* 103: 12787–12792.
- Tautz J., Roces F., Hölldobler B. (1995). Use of a sound-based vibratome by leaf-cutting ants. *Science* 267: 84–87.
- Markl H. (1965). Stridulation in leaf-cutting ants. *Science* 149: 1392–1393.
- Masters W. M., Tautz J., Fletcher N. H., Markl H. (1983). Body vibration and sound production in an insect (*Atta sexdens*) without specialized radiating structures. *J. Comp. Physiol.* 150: 239–249.
- Stridulation in four ant species of the genus *Messor*: ultrasonic emission and description of their stridulatory organs (*Bioacoustics*; the spec's source).
- Hickling R., Brown R. L. (2000). Analysis of acoustic communication by ants. *J. Acoust. Soc. Am.* 108: 1920–1929.
- van den Doel K. (2005). Physically based models for liquid sounds. *ACM Trans. Applied Perception* 2: 534–546. Minnaert M. (1933). On musical air-bubbles and the sounds of running water. *Phil. Mag.* 16: 235–248.
