# Sound list

Every sound the game uses, what it should sound like, where to find it, and how to record it yourself.
Generated from `src/audio/catalog.ts` by `npm run audio:list`: edit the catalog, not this file.

**Status:** 103 of 110 sounds are files in `public/audio` (audio v3: every sound effect). Each was rendered offline by `tools/audio/sfx` from the physics of the real sound (chitin clicks and fractures, stridulation tooth trains, friction, tiny bubbles; research in [sound-research.md](sound-research.md)), unless a recording replaces it. The music and the narration cue are played by the game itself.

## How sounds are made and packed

`npm run audio:build` (Python 3 with numpy, scipy, soundfile and pyloudnorm; ffmpeg) renders every recipe's takes into `audio-src/rendered/` (not committed), finishes them (trimmed to start on their first sound, short fades, loudness-normalised, loops made seamless) and packs each sound's takes into one file, `public/audio/<folder>/<name>.ogg` plus `.m4a` (AAC, for Safari without Ogg), listed with each take's position in `public/audio/manifest.json`. `npm run audio:build render <filter>` re-renders some; `npm run audio:build pack` re-packs.

## How to add a recording

1. Find or record it (sources and licences below). Keep the original.
2. Cut it into takes named after the sound: `audio-src/recordings/<folder>/<name>_01.wav`, `_02`… (the **Recording slots** column). 3–6 takes keep repeats from sounding mechanical; the engine also varies pitch and level.
3. Run `npm run audio:build`: a sound with recordings uses them instead of its rendered takes (finished and packed the same way).
4. Add a row to `docs/audio/ATTRIBUTIONS.md` (every file, whatever its licence). CC-BY credits appear on the in-game Credits screen.

## Sources and licences

In this order of preference:

1. **Royalty-free commercial libraries that allow use in games.** The free Sonniss GDC Game Audio Bundles (gdc.sonniss.com; a new one every year since 2015) are royalty-free and need no attribution; read the licence text that ships with each bundle. They are strong on nature, foley, insects and field recordings.
2. **Freesound.org**, licences **CC0** or **CC BY** only. Never **CC BY-NC** (non-commercial) or the old Sampling+ licence: a game that might ever be sold cannot use them. In Freesound's search, filter by licence. Record the author and URL of every CC BY sound.
3. **Your own foley** (each sound below has a recipe). A phone works for a start; a small recorder or a lavalier mic gets closer. Record in a quiet room, 5–20 cm from the source, several takes, at 44.1 or 48 kHz, 24-bit if possible, and leave half a second of silence around each take. Insect scale means close and detailed: get the mic right up to small things, and pitch up or down later if needed.
4. **AI sound-effect generators** only if their terms allow commercial game use; write the tool and its licence in ATTRIBUTIONS.md.

Do not take audio from Empires of the Undergrowth or any other game.

## Sounds

### Ambience

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `amb.wind_grass` | `amb/wind_grass_01` | Ambience | 30–60 s loop (loop, streamed) | Wind through grass and leaves, heard from the ground: soft gusts that swell and settle. Seamless loop. | "wind grass close", "wind meadow ground level", "breeze leaves rustle loop" | Record a breeze in tall grass with the microphone at grass-root level, sheltered by a windshield (a sock over the mic). Avoid traffic and voices. | rendered (1 take) |
| `amb.leaves_rustle` | `amb/leaves_rustle_01` | Ambience | 20–40 s loop (loop, streamed) | Dry leaf litter rustling up close (the macro layer you hear when zoomed in). Loop. | "leaf litter rustle close", "dry leaves movement macro" | Gently stir a tray of dry leaves with your fingertips 10 cm from the microphone, slow and irregular. | rendered (1 take) |
| `amb.bird` | `amb/bird_01` … `_06` | Ambience | 0.5–3 s | Distant songbird phrases for daytime (different birds and calls). | "songbird distant", "bird call meadow", "wren", "blackbird song distant" | Record birds at dawn in a park or garden from 20–50 m away; cut single phrases with a little room tail. | rendered (6 takes) |
| `amb.cicada` | `amb/cicada_01` | Ambience | 20–40 s loop (loop, streamed) | Cicadas in warm daylight, swelling and fading (sandy and meadow maps). Loop. | "cicada loop", "cicadas summer chorus" | Field recording only (summer, warm climates). | rendered (1 take) |
| `amb.cricket` | `amb/cricket_01` … `_05` | Ambience | 0.1–0.3 s | One field cricket chirp: three or four pure, bright pulses. Many play at night, panned around. | "field cricket chirp single", "gryllus chirp" | Pet-shop crickets in a box at night; record close and cut single chirps. | rendered (5 takes) |
| `amb.katydid` | `amb/katydid_01` … `_04` | Ambience | 0.3–0.8 s | A katydid rasp at night ("ka-ty-did"), high and dry. | "katydid call", "bush cricket rasp" | Field recording only. | rendered (4 takes) |
| `amb.fly_pass` | `amb/fly_pass_01` … `_04` | Ambience | 1.5–3 s | A fly or small bee buzzing past the camera by day (Doppler swell). | "fly buzz pass by", "housefly flyby", "bee pass close" | Hard to stage; library sound recommended. | rendered (4 takes) |
| `amb.frog` | `amb/frog_01` … `_05` | Ambience | 0.5–1.5 s | Frogs croaking in the distance at night (riverbank map). | "frog croak distant night", "tree frog chorus" | Field recording by a pond at night. | rendered (5 takes) |
| `amb.owl` | `amb/owl_01` … `_03` | Ambience | 1–3 s | A tawny owl far away at night, now and then. | "tawny owl distant", "owl hoot night" | Field recording only. | rendered (3 takes) |
| `amb.water_stream` | `amb/water_stream_01` | Ambience | 20–40 s loop (loop, streamed) | A small stream trickling (riverbank map): many small bubbles. Loop. | "small stream trickle close", "brook water loop" | Record a garden tap trickling into a bowl of water, mic 30 cm away, or a real brook. | rendered (1 take) |
| `amb.drip` | `amb/drip_01` … `_05` | Ambience | 0.2–0.5 s | A single water drop falling into a puddle (underground and riverbank). | "water drip cave", "single drop puddle" | Drip water from a pipette into a glass of water; record close. | rendered (5 takes) |
| `amb.sand_hiss` | `amb/sand_hiss_01` | Ambience | 20–40 s loop (loop, streamed) | Wind blowing fine sand across the ground (sandy map): a bright, fine hiss of grains. Loop. | "sand blowing wind", "desert sand hiss" | Pour fine sand slowly onto a sheet of paper from 10 cm. | rendered (1 take) |
| `amb.rain` | `amb/rain_01` | Ambience | 20–40 s loop (loop, streamed) | Rain heard by an ant: huge single drops thudding into soil and slapping leaves, with a far-off hiss. Loop (weather). | "rain on leaves close", "heavy raindrops soil macro" | Drip water from a height onto leaves and soil in a tray; record very close. | rendered (1 take); Weather is not in the game yet; the layer is wired to a weather setting. |
| `amb.raindrop_big` | `amb/raindrop_big_01` … `_05` | Ambience | 0.3–0.6 s | One huge raindrop landing right beside you: a thump, a splash and a bubble. | "raindrop impact close", "water drop leaf slap" | Drop water from a spoon onto a leaf on soil. | rendered (5 takes); Weather. |
| `amb.thunder` | `amb/thunder_01` … `_03` | Ambience | 4–8 s | Distant thunder rolling (weather). | "distant thunder roll" | Field recording only. | rendered (3 takes); Weather. |
| `amb.nest_room` | `amb/nest_room_01` | Ambience | 20–40 s loop (loop, streamed) | Inside the nest: a close, muffled, earthy room tone. Loop. | "underground room tone", "cave ambience muffled", "soil interior" | Bury a small microphone (in a plastic bag) a few cm under loose soil in a pot, and record the quiet. | rendered (1 take) |
| `amb.soil_trickle` | `amb/soil_trickle_01` … `_05` | Ambience | 0.5–1.5 s | Soil grains trickling down a tunnel wall now and then. | "soil trickle", "dirt falling small", "sand pour light" | Let a pinch of dry soil trickle from your fingers onto packed soil, mic 5 cm away. | rendered (5 takes) |
| `amb.root_creak` | `amb/root_creak_01` … `_04` | Ambience | 0.5–1.5 s | A root creaking in the soil as it shifts. | "wood creak small", "root creak", "branch creak slow" | Slowly bend a fresh green twig near the mic; or twist a wooden ruler against a table edge. | rendered (4 takes) |
| `amb.colony_rumble` | `amb/colony_rumble_01` | Ambience | 20–40 s loop (loop, streamed) | The colony at work, felt through the soil: a low rumble with a faint shimmer of thousands of feet. Loop. | "low rumble soil", "insect colony inside" | Record a busy aquarium or anthill with a contact microphone; or a slow rumble pitched down. | rendered (1 take) |

### Ants: digging, carrying, food

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ant.dig_bite` | `ant/dig_bite_01` … `_06` | Creatures | 0.08–0.15 s | Soil being bitten off: a small crunch over a dull crumble. | "soil crunch small", "dirt bite", "digging small close" | Squeeze a lump of slightly damp soil between fingertips next to the mic; or bite a cracker with the mic near your cheek, pitched up. | rendered (6 takes) |
| `ant.soil_grains` | `ant/soil_grains_01` … `_05` | Creatures | 0.3–0.7 s | Grains trickling and bouncing after a bite (digging). | "sand trickle short", "dirt grains fall" | Drop a pinch of fine soil onto packed soil. | rendered (5 takes) |
| `ant.pellet_drop` | `ant/pellet_drop_01` … `_05` | Creatures | 0.1–0.2 s | A soil pellet dropped at the spoil heap: a soft thud and a scatter. | "small dirt clod drop" | Drop a pea-sized clod of damp soil onto dry soil from 2 cm. | rendered (5 takes) |
| `ant.drag_small` | `ant/drag_small_01` … `_05` | Creatures | 0.3–0.5 s | A small food item dragged over the ground: scraping and small bumps. | "small object drag dirt", "scrape tiny" | Drag a dried pea across soil on a tray. | rendered (5 takes) |
| `ant.drag_heavy` | `ant/drag_heavy_01` … `_05` | Creatures | 0.5–0.8 s | A large food item hauled by a team: a heavier scrape with bumps. | "drag heavy object dirt", "scrape bump" | Drag a walnut across soil. | rendered (5 takes) |
| `ant.pick_up` | `ant/pick_up_01` … `_05` | Creatures | 60–80 ms | Picking up a load: the mandibles closing on it (a soft click) and a brief scrape as it lifts. | "tiny pick up", "small grab" | Pick a dried pea off soil with tweezers, close. | rendered (5 takes) |
| `ant.put_down` | `ant/put_down_01` … `_05` | Creatures | 55–60 ms | Setting a load down: a soft tap and a grain or two. | "tiny drop soft" | Set a dried pea down on soil. | rendered (5 takes) |
| `ant.food_cut` | `ant/food_cut_01` … `_05` | Creatures | 0.1–0.2 s | Mandibles shearing soft food: a fibrous crunch with moisture. | "bite fruit small", "crunch wet small" | Snap a small piece off a grape or a piece of cooked pasta near the mic. | rendered (5 takes) |
| `ant.seed_crack` | `ant/seed_crack_01` … `_06` | Creatures | 0.1–0.2 s | A fire ant major cracking a seed: a sharp crack and fragments. | "seed crack", "nut crack small", "sunflower seed crack" | Crack sunflower or millet seeds with pliers 5 cm from the mic. | rendered (6 takes) |
| `ant.leaf_cut` | `ant/leaf_cut_01` … `_05` | Creatures | 0.3–0.5 s | A leafcutter scissoring a disc from a leaf: rapid snips and crinkle, with faint stridulation. | "leaf cutting close", "scissors cutting leaf", "paper snip small" | Snip a fresh leaf with small nail scissors in quick, short cuts. | rendered (5 takes) |

### Ants: communication

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ant.stridulate` | `ant/stridulate_01` … `_05` | Creatures | 0.1–0.35 s | Alarm stridulation: faint, fine rasping chirps (a scraper on the gaster rubbing a file). | "ant stridulation", "leafcutter ant stridulation", "insect stridulation" | Run a fingernail along the teeth of a fine comb very lightly; pitch up 1 octave. | rendered (5 takes) |
| `ant.antenna_tap` | `ant/antenna_tap_01` … `_04` | Creatures | 30–80 ms | Antennae tapping (heard only very close): the faintest double tap. | "tiny tap tap" | Two light taps of a bristle on a beetle shell or a plastic lid. | rendered (4 takes) |

### Ants: combat

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `combat.mandible_click` | `combat/mandible_click_01` … `_06` | Combat | 20–35 ms | A worker's bite: a dry, high double click of the mandible tips closing on chitin. | "insect mandible click", "beetle click", "tweezers click" | Snap the tips of fine tweezers together twice, very close; pitch up. | rendered (6 takes) |
| `combat.mandible_snap` | `combat/mandible_snap_01` … `_06` | Combat | 40–50 ms | A strong bite (soldiers, majors): a sharper click with a brittle crunch of cuticle giving way. | "crab shell crack small", "beetle shell snap" | Close small pliers sharply on a dry crab-leg shell or a shrimp shell. | rendered (6 takes) |
| `combat.bite_crush` | `combat/bite_crush_01` … `_05` | Combat | 70–100 ms | A crushing bite (fire ant majors, Atta majors, the Termant soldier's Macrotermes jaws): a click, then a dense crunch of many tiny fractures, a little lower. | "shell crush small", "crunch brittle close" | Crush a dry snail shell or a piece of crab shell slowly with pliers, mic 5 cm away. | rendered (5 takes) |
| `combat.scissor_cut` | `combat/scissor_cut_01` … `_05` | Combat | 80–100 ms | A leafcutter soldier's shear: a short stridulation-like rasp as the blades pass, closing with a snip. | "scissors snip small", "shear rasp" | Close small nail scissors slowly on a leaf vein, close to the mic; pitch up. | rendered (5 takes) |
| `combat.chitin_crack` | `combat/chitin_crack_01` … `_06` | Combat | 50–70 ms | A heavy hit taken: a brittle crunch of cuticle cracking. | "crunch shell small", "insect crunch" | Crack a piece of eggshell or a dry beetle wing case between fingernails, close. | rendered (6 takes) |
| `combat.hit_tick` | `combat/hit_tick_01` … `_06` | Combat | 10–20 ms | A light hit taken: a tiny chitin tick. | "tiny tick click" | A fingernail tick on a hard plastic comb tooth. | rendered (6 takes) |
| `combat.grip` | `combat/grip_01` … `_05` | Combat | 0.2–0.35 s | Taking hold (the grip of a hold, a claw catching a creature's leg): legs scraping on chitin and the held ant's stridulation squeak. | "scrabble small", "insect stridulation" | Scrabble fingernails on a plastic lid; run a fingernail over a fine comb. | rendered (5 takes) |
| `combat.struggle` | `combat/struggle_01` … `_04` | Combat | 0.5–0.65 s | Prey held fast (a hell ant's jaw, a sickle-jaw's grip, army ant hooks, a pin): its legs scrabbling and its stridulation, on and off. | "insect struggle", "scrabble small", "ant stridulation" | Scrabble fingernails on a plastic lid, with a fine comb rasped now and then. | rendered (4 takes) |
| `combat.grapple_scuffle` | `combat/grapple_scuffle_01` | Combat | 7 s loop (loop) | Ants grappling, as one texture: scrabbling legs, bodies rubbing, grips and squeaks (the engine plays it in grains, denser with more grapplers). | "insects fighting", "scuffle small" | Rub two dry leaves and a plastic comb together erratically near the mic. | rendered (1 take) |
| `combat.battle_bed` | `combat/battle_bed_01` | Combat | 11 s loop (loop) | A fight too big for single voices, as one texture: a dense insect brawl of clicks, crunches, scrapes, stings and stridulation squeaks (never a crowd of people). | "insects swarm battle", "crackling crunching dense" | Crunch dry leaves, eggshell and cereal flakes continuously, close, with a comb rasped now and then. | rendered (1 take) |
| `combat.sting` | `combat/sting_01` … `_05` | Combat | 0.12–0.14 s | A sting going in: a tiny wet tick as the lancets pierce, then a faint venom fizz (army ants: a little stronger). | "puncture small wet", "needle pierce" | Push a needle through a grape skin; a pinch of sherbet on a wet fingertip for the fizz. | rendered (5 takes) |
| `combat.sting_fire` | `combat/sting_fire_01` … `_05` | Combat | 85–95 ms | Fire ant stings: quicker and doubled. | "puncture sharp small" | As for sting, twice in quick succession. | rendered (5 takes) |
| `combat.acid_spray` | `combat/acid_spray_01` … `_05` | Combat | 0.28–0.34 s | Formic acid sprayed from the acidopore: a fine, fizzy hiss pulsing with the gaster's squeezes, with tiny droplet ticks. | "spray mist short", "aerosol hiss short" | A fine plant mister, one short pump, 20 cm away; pitch up a little. | rendered (5 takes) |
| `combat.acid_splat` | `combat/acid_splat_01` … `_05` | Combat | 0.35–0.4 s | Acid landing on a body: a small wet tick and a fizz as it bites in (no splash: the drops are tiny). | "fizz small", "effervescent close" | A drop of vinegar onto baking soda, recorded very close. | rendered (5 takes) |
| `combat.mortar_pop` | `combat/mortar_pop_01` … `_04` | Combat | 85 ms | A mortar ant lobbing a droplet: a soft pop at launch and a breath of spray. | "soft pop small", "bubble pop" | Pop a small bubble of washing-up liquid with a fingertip, close. | rendered (4 takes) |
| `combat.mortar_land` | `combat/mortar_land_01` … `_04` | Combat | 0.45 s | The lobbed droplet landing: a wet tick, a little splat and a fizz spreading (no explosion). | "fizz splat small" | A drop of vinegar onto baking soda on a leaf. | rendered (4 takes) |
| `combat.termite_bite` | `combat/termite_bite_01` … `_05` | Combat | 55–65 ms | A termite's bite (soft-bodied): a duller, wetter crunch. | "wet crunch small", "bite soft crunch" | Bite through a thin slice of cucumber with the mic by your cheek; pitch up. | rendered (5 takes) |
| `combat.ant_death` | `combat/ant_death_01` … `_06` | Combat | 0.27–0.36 s | An ant dying: a brittle crack, then a faint, short twitch of clicks as the legs curl (quieter for small ants). | "insect crush", "small crunch" | Crack a dry leaf, then tick a fingernail on a comb a few times, fading. | rendered (6 takes) |
| `combat.termite_death` | `combat/termite_death_01` … `_04` | Combat | 0.22–0.27 s | A termite dying: a dull, wet crunch and a few slow twitches. | "wet crunch small" | Squash a grape gently, then a few faint fingernail ticks. | rendered (4 takes) |
| `combat.fling` | `combat/fling_01` … `_04` | Combat | 0.27–0.34 s | An ant thrown by a big creature: a short scrabble as it loses hold, a moment in the air, a light tick landing. | "small object thrown land" | Scrabble a fingernail, then flick a dried lentil onto soil. | rendered (4 takes) |

### Ants: brood and queen

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ant.egg_set` | `ant/egg_set_01` … `_04` | Creatures | 60–120 ms | An egg set down on its tile: soft and wet. | "wet small soft", "squish tiny" | Press a fingertip onto a wet jelly cube. | rendered (4 takes) |
| `ant.larva_hatch` | `ant/larva_hatch_01` … `_04` | Creatures | 0.3–0.5 s | A new adult breaking out of its cocoon: a soft, wet tear. | "wet tear small", "membrane tear" | Tear a wet tissue slowly; peel a grape skin. | rendered (4 takes) |
| `ant.queen_lay` | `ant/queen_lay_01` … `_03` | Creatures | 0.2–0.3 s | The queen laying an egg: a soft, wet sound. | "wet soft squish" | Squeeze a soaked sponge gently near the mic. | rendered (3 takes) |

### Creatures

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `cr.spider_step` | `cr/spider_step_01` … `_06` | Creatures | 40–120 ms | Wolf spider steps: soft, padded footfalls with a brush of hairs. | "soft padded footsteps small", "spider walking" | Press the pad of a fingertip onto felt or soil, softly, quickly. | rendered (6 takes) |
| `cr.spider_pounce` | `cr/spider_pounce_01` … `_04` | Creatures | 0.3–0.45 s | A spider pouncing: a scrape, a rush of air and a landing. | "pounce scrape", "animal pounce small" | Swipe a glove fast past the mic and slap it onto soil. | rendered (4 takes) |
| `cr.spider_fangs` | `cr/spider_fangs_01` … `_04` | Creatures | 60–120 ms | A spider's bite: a soft scrape of the strike, then the fangs going in with a wet tick. | "click wet small", "fang click" | Click tweezers twice, then press a grape. | rendered (4 takes) |
| `cr.beetle_step` | `cr/beetle_step_01` … `_06` | Creatures | 30–60 ms | Beetle steps: heavy, armoured clacking. | "beetle walking", "hard tap small plastic" | Tap a hard plastic bottle cap on a stone, quickly, irregularly. | rendered (6 takes) |
| `cr.beetle_bite` | `cr/beetle_bite_01` … `_05` | Creatures | 0.11–0.14 s | A beetle's mandibles: a woody, hollow clack, the two jaws meeting a hair apart. | "wood clack small", "beetle mandibles" | Clack two small pieces of hardwood or a hollow seed pod. | rendered (5 takes) |
| `cr.beetle_elytra` | `cr/beetle_elytra_01` … `_03` | Creatures | 0.3–0.5 s | Wing cases snapping open, then the wings unfolding. | "beetle wings open", "insect take off" | Snap two plastic lids apart and crinkle cellophane. | rendered (3 takes) |
| `cr.stag_clash` | `cr/stag_clash_01` … `_05` | Creatures | 0.2–0.35 s | Stag beetle mandibles clashing: a heavy ringing clack and a scrape. | "antler clash small", "hard clack wood plastic" | Clack two pieces of hard wood or antler; scrape them apart. | rendered (5 takes) |
| `cr.centipede_patter` | `cr/centipede_patter_01` … `_05` | Creatures | 0.2–0.35 s | A centipede running: a rippling patter of many legs. | "centipede walking", "fingers drumming fast light" | Drum all ten fingertips very lightly and fast on a tray of soil, in a wave. | rendered (5 takes) |
| `cr.centipede_bite` | `cr/centipede_bite_01` … `_04` | Creatures | 0.11–0.13 s | A centipede's strike: a rattling ripple of legs surging, then the forcipules snapping in with a wet tick. | "ripple patter snap" | Drum fingertips fast in a wave, end with a tweezer snap and a grape press. | rendered (4 takes) |
| `cr.mantis_sway` | `cr/mantis_sway_01` … `_03` | Creatures | 0.5–0.8 s | A mantis swaying in wait: a quiet rustle. | "soft rustle leaf slow" | Brush a leaf slowly against another. | rendered (3 takes) |
| `cr.mantis_strike` | `cr/mantis_strike_01` … `_05` | Creatures | 0.15–0.3 s | A mantis strike: a fast swish and a sharp snap shut. | "fast swish snap", "whip small" | Swish a thin twig past the mic and snap tweezers. | rendered (5 takes) |
| `cr.pillbug_roll` | `cr/pillbug_roll_01` … `_03` | Creatures | 0.2–0.3 s | A pill woodlouse rolling up: plates clicking closed. | "small plates click", "shell roll" | Close a small hinged box of plastic plates; roll a bead chain. | rendered (3 takes) |
| `cr.caterpillar_crawl` | `cr/caterpillar_crawl_01` … `_03` | Creatures | 0.3–0.5 s | A caterpillar crawling: soft, squishy. | "squish soft slow" | Press a damp sponge in a slow rhythm. | rendered (3 takes) |
| `cr.antlion_flick` | `cr/antlion_flick_01` … `_04` | Creatures | 0.3–0.45 s | An antlion flicking sand at its prey. | "sand flick", "sand throw small" | Flick fine sand off a fingertip onto paper. | rendered (4 takes) |
| `cr.creature_death` | `cr/creature_death_01` … `_04` | Creatures | 0.4–0.6 s | A creature going down: a heavier crunch and collapse. | "crunch collapse", "shell crush" | Crush a snail-shell-sized ball of dry leaves, then drop a pebble onto soil. | rendered (4 takes) |
| `cr.cricket_burrow` | `cr/cricket_burrow_01` … `_03` | Creatures | 0.3–0.5 s | A mole cricket digging with its shovel legs. | "digging small scrape" | Scrape soil with a fingernail in short strokes. | rendered (3 takes); No mole crickets in the game yet. |

### Bosses

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `boss.footstep` | `boss/footstep_01` … `_05` | Creatures | 0.6–1.2 s | A boss footfall: ground-shaking, with debris trickling after. Real impacts pitched down; no roars. | "heavy footstep dirt", "body fall dirt", "impact earth heavy" | Drop a bag of soil onto a soil floor from 30 cm, mic low; pitch down an octave. | rendered (5 takes) |
| `boss.rumble` | `boss/rumble_01` | Creatures | 10–30 s loop (loop) | A low-end rumble while a boss is near, with grains shaken loose now and then. Loop. | "low rumble earth loop" | Pitch a recording of a distant truck or a drum roll down two octaves. | rendered (1 take) |
| `boss.slam` | `boss/slam_01` … `_04` | Creatures | 1.5–2.2 s | A boss slam: a heavy impact, a crack, and soil showering down. | "heavy impact dirt debris", "earth slam" | Slam a fist onto a tray of soil and gravel, then pour a cup of soil; pitch down. | rendered (4 takes) |
| `boss.windup` | `boss/windup_01` … `_04` | Creatures | 0.7–0.9 s | A boss winding up an attack: a heavy joint creaking tighter, a hiss of breath through spiracles. | "creak tension wood", "hiss slow rising" | Slowly bend a thick branch near the mic; breathe out through your teeth. | rendered (4 takes) |
| `boss.phase` | `boss/phase_01` … `_03` | Creatures | 1–1.4 s | A boss entering a new phase: a big, rough stridulation and hiss (like a hissing cockroach scaled up). Never a roar. | "hissing cockroach", "beetle stridulation", "insect hiss" | Drag a stiff brush over a ridged plastic container; pitch down. | rendered (3 takes) |
| `boss.hairs` | `boss/hairs_01` … `_03` | Creatures | 0.5–0.7 s | A tarantula flicking urticating hairs: quick, dry brushing strokes. | "brush strokes dry", "scratch fabric quick" | Brush the back of a fingernail quickly over velvet or a hairy blanket. | rendered (3 takes) |
| `boss.arrive` | `boss/arrive_01` … `_03` | Creatures | 2–3 s | A boss arriving: distant heavy footfalls getting closer under a rising rumble. | "approaching heavy footsteps distant" | Combine boss footsteps with a swell of low rumble. | rendered (3 takes) |

### Species: hell ants, army ants, termites, Saiy-Ants, Termants

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `species.hellant_snap` | `species/hellant_snap_01` … `_05` | Combat | 15–30 ms | A hell ant's trap jaw: the fastest, sharpest crack in the game, an almost pure impulse. | "trap-jaw ant snap", "sharp click", "twig snap tiny" | Snap a thin dry twig (1 mm) or flick a fingernail off a fingertip, very close. | rendered (5 takes) |
| `species.hellant_impale` | `species/hellant_impale_01` … `_04` | Combat | 0.1–0.13 s | The impale and the finisher: a wet crunch as the horn and jaws go through. | "stab wet small", "crunch wet" | Push a fork through a cherry tomato skin into a grape. | rendered (4 takes) |
| `species.army_hook` | `species/army_hook_01` … `_05` | Combat | 0.25–0.43 s | An army ant soldier's hooks: a rasp as the sickle mandibles drive in and seat, then the victim's stridulation. | "rasp short", "hook scrape" | Drag a fish hook's point over a plastic comb, then a comb rasp. | rendered (5 takes) |
| `species.sickle_snap` | `species/sickle_snap_01` … `_04` | Combat | 20–30 ms | A sickle-jaw soldier grabbing: long crossed blades snapping shut, the second a hair behind the first. | "double click sharp" | Snap two pairs of tweezers shut a few milliseconds apart. | rendered (4 takes) |
| `species.sickle_acid` | `species/sickle_acid_01` … `_04` | Combat | 0.5–0.6 s | A sickle-jaw's acid smeared on its victim: a wet smear and a fizz. | "fizz wet", "effervescent" | Smear a drop of vinegar over baking soda, close. | rendered (4 takes) |
| `species.glue_splat` | `species/glue_splat_01` … `_04` | Combat | 0.2–0.26 s | A conehead soldier's glue landing: a sticky, stringy sputter, threads stretching and snapping. | "sticky wet sputter", "glue squelch" | Press and pull sticky fingertips apart in honey. | rendered (4 takes) |
| `species.nasute_glue` | `species/nasute_glue_01` | Combat | 2.6 s loop (loop) | A conehead soldier's glue stream: a sticky, wet sputter in bursts (the engine makes it denser and brighter as its damage ramps up). Loop. | "sticky wet sputter", "glue squeeze", "syrup drip pop" | Squeeze honey or glue from a bottle in short bursts; pull sticky fingers apart. | rendered (1 take) |
| `species.termite_headbang` | `species/termite_headbang_01` … `_04` | Creatures | 0.45–0.65 s | Termite soldiers' alarm (only on a real alarm: an attack, an invasion, a soldier charging a foe): heads banging on the gallery wall, 11–19 beats a second. | "rapid tapping wood dull", "termite head banging" | Tap a pencil eraser rapidly on a cardboard box. | rendered (4 takes) |
| `species.termite_chew` | `species/termite_chew_01` … `_05` | Creatures | 55–75 ms | A termite worker chewing wood loose while foraging: a quiet, fibrous crunch. | "wood chew small", "fibre crunch" | Nibble balsa wood or a matchstick with the mic by your cheek; pitch up. | rendered (5 takes) |
| `species.saiyant_surge` | `species/saiyant_surge_01` … `_03` | Combat | 1.9–2.2 s | Saiy-Ant golden transformation: a rising rustle of rattled seeds with a stridulating shimmer climbing over it. Organic, never electronic. | "rain stick", "seed pod rattle", "shaker swell" | Turn a rain stick slowly, shake a dried seed pod, end with a crushed dry leaf. | rendered (3 takes) |
| `species.saiyant_crackle` | `species/saiyant_crackle_01` … `_03` | Combat | 0.25 s | Saiy-Ant crackle: a crisp crackle of dry cuticle. | "dry leaf crackle", "crackle crisp" | Crush a dry leaf sharply. | rendered (3 takes) |
| `species.termant_absorb` | `species/termant_absorb_01` … `_03` | Combat | 0.5–0.6 s | Termants absorb a corpse's genes: a soft organic gulp, a wet swallow and a few slow bubbles. | "wet gulp soft", "organic swallow bubble" | Swallow close to the mic; squeeze a wet sponge slowly. | rendered (3 takes) |
| `species.termant_caste` | `species/termant_caste_01` … `_03` | Combat | 1.9 s | Termants raise a stolen caste: a rising chord of plucked tines (the one musical moment among the effects). | "kalimba chord rising" | Pluck a kalimba chord upward. | rendered (3 takes) |

### Interface and alerts

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ui.marker` | `ui/marker_01` … `_03` | Interface | 60–120 ms | Placing a pheromone marker: a soft natural chirp (a different pitch for each marker I–V; the engine pitches one sound). | "cricket chirp single", "insect chirp short" | One chirp of a cricket, or a comb flicked once, pitched up. | rendered (3 takes) |
| `ui.marker_lift` | `ui/marker_lift_01` … `_03` | Interface | 30–60 ms | Lifting a marker: a light click. | "tiny click" | A fingernail tick on a plastic lid. | rendered (3 takes) |
| `ui.group_assign` | `ui/group_assign_01` … `_03` | Interface | 40–80 ms | Moving a group card: a fingertip on a dry leaf. | "leaf tap" | Tap a dry leaf with a fingertip. | rendered (3 takes) |
| `ui.tool_dig` | `ui/tool_dig_01` … `_04` | Interface | 60–120 ms | Marking soil to dig: a soft soil tap. | "dirt tap soft" | Tap packed soil with a fingertip. | rendered (4 takes) |
| `ui.tool_build` | `ui/tool_build_01` … `_04` | Interface | 0.1–0.2 s | Placing a tile: an earthy tap and a puff of soil. | "earth tap", "soil puff" | Knock a knuckle on packed earth. | rendered (4 takes) |
| `ui.tool_upgrade` | `ui/tool_upgrade_01` … `_03` | Interface | 0.2–0.3 s | Marking an upgrade: two earthy taps and a little trickle. | "double tap earth" | Two knuckle taps on packed earth, then a pinch of soil. | rendered (3 takes) |
| `ui.tool_delete` | `ui/tool_delete_01` … `_03` | Interface | 0.3–0.45 s | Marking a tile for removal: a clod crumbling. | "dirt clod crumble" | Crumble a dry clod of soil between your fingers. | rendered (3 takes) |
| `ui.menu_tap` | `ui/menu_tap_01` … `_04` | Interface | 30–60 ms | Menu buttons: a quiet tap on dry wood. | "wood tap soft", "button wood click" | Tap a wooden spoon with a fingernail. | rendered (4 takes) |
| `ui.alert_queen` | `ui/alert_queen_01` … `_03` | Interface | 0.6–0.9 s | The queen under attack: an alarm stridulation over rapid drumming. Must cut through a battle. | "insect alarm stridulation", "rapid drumming wood" | Rapid fingertip drumming on a wooden box with a comb rasp over it. | rendered (3 takes) |
| `ui.alert_starving` | `ui/alert_starving_01` … `_03` | Interface | 0.6–0.9 s | The colony is starving: a slow, dull drumming. | "slow knock wood" | Two pairs of slow knuckle knocks on a wooden box. | rendered (3 takes) |
| `ui.alert_invasion` | `ui/alert_invasion_01` … `_03` | Interface | 0.8–1 s | Intruders in the nest: urgent drumming and stridulation. | "rapid drumming alarm" | Fast fingertip drumming in two bursts with a comb rasp. | rendered (3 takes) |
| `ui.message_good` | `ui/message_good_01` … `_03` | Interface | 0.3–0.45 s | Good news: a dry seed pod shaken twice. | "seed pod shake", "shaker short" | Shake a dried poppy head or a pea pod twice. | rendered (3 takes) |
| `ui.message_warn` | `ui/message_warn_01` … `_03` | Interface | 0.3–0.4 s | A warning: two dull knocks on wood. | "wood knock dull" | Two knuckle knocks on a wooden table. | rendered (3 takes) |

### Music

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `music.explore` | `music/explore_01` | Music | 2–4 min loop (loop, streamed) | Calm, documentary music for building and exploring: plucked strings, kalimba, soft woodwind, light hand percussion. Loops seamlessly; never louder than the nature around it. | "nature documentary music calm acoustic", "acoustic ambient loop royalty free" | Commission or compose: acoustic guitar/harp, kalimba, flute, frame drum. Same key and tempo as the battle stem (D dorian, 96 BPM) so they can crossfade. | procedural score |
| `music.battle` | `music/battle_01` | Music | 2–4 min loop (loop, streamed) | Battle stem: the same piece with driving hand drums, shakers and pizzicato strings. Crossfades in with the fighting. | "tense acoustic percussion strings loop" | As the explore stem, same key and tempo, with percussion and ostinato strings. | procedural score |
| `music.boss` | `music/boss_01` | Music | 1–3 min loop (loop, streamed) | Boss stem: big low drums and swelling strings over the battle stem. | "epic acoustic drums strings loop" | Taiko or frame drums and cello, same key and tempo. | procedural score |
| `music.victory` | `music/victory_01` | Music | 3–6 s | A short acoustic flourish for winning. | "acoustic victory sting" | Rising plucked arpeggio and a drum. | played by the game |
| `music.defeat` | `music/defeat_01` | Music | 3–6 s | A short, falling acoustic phrase for losing. | "acoustic sad sting" | Falling plucked phrase, low and slow. | played by the game |

### Narration

| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `narration.cue` | `narration/cue_01` … `_02` | Narration | 1–2 s | A soft cue before a narrator caption: one or two kalimba notes. | "kalimba note soft" | Two soft kalimba notes (D and A). | played by the game |
| `narration.voice` | one file per line | Narration | per line | Optional: recorded readings of the mission captions, one file per line (see docs/audio/sound-list.md). | — | A calm, warm documentary voice; quiet room; one take per caption. | Captions are text only for now. |

## Narration lines (optional)

If you record the narrator, read each mission caption (in `src/sim/missions.ts`) as its own file, `narration/voice_<mission>_<stage>_<n>.ogg`. The captions work without them.

## Budget

- **Download:** 4.6 MB of Ogg Vorbis (or 5.1 MB of AAC on Safari) for all 103 files; a browser fetches one format. The ambience loops (2.4 MB of it) stream, and only the current map's beds are fetched.
- **Memory:** decoded effects are float32 at the audio context's rate (48 kHz on most phones): 30.1 MB if every effect were decoded. A game decodes combat, orders, alerts and work in the background after the first click (16.6 MB) and the rest when first wanted: ambience one-shots of the map, the creatures and titans met. Low sounds (titans, thunder, an owl) decode at half or a quarter rate. Long ambience loops are streamed through audio elements, so they cost no decoded memory. This stays well inside iPhone Safari's limits.
- **Voices:** 8 work sounds, 16 combat sounds, 10 creature sounds at once, plus each sound's own limit and the beds.
