# Sound list

Every sound the game uses, what it should sound like, where to find it, and how to record it yourself.
Generated from `src/audio/catalog.ts` by `npm run audio:list`: edit the catalog, not this file.

**Status:** 0 of 100 sounds have recordings (94 are used by the game now; the rest wait for features still to come). Every sound without a recording plays an organic stand-in synthesised from the physics of the real sound (grain crackle, chitin and wood resonances, bubbles, stridulation pulse trains), so the game is never silent while recordings are gathered.

## How to add a recording

1. Find or record it (sources and licences below). Keep the original.
2. Cut it into takes and name each take after its slot: `audio-src/recordings/<folder>/<name>_01.wav`, `_02`… The **File slots** column below gives the names. Several takes of the same action (3–6) keep repeats from sounding mechanical; the engine also varies pitch and level.
3. Run `npm run audio:process` (needs ffmpeg). It trims, fades and normalises each file into `public/audio` as Ogg Vorbis plus AAC (`.m4a`, for older Safari), and rebuilds `public/audio/manifest.json`. The game picks the files up on the next load with no code change.
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

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `amb.wind_grass` | `amb/wind_grass_01` | Ambience | 30–60 s loop (loop, streamed) | Wind through grass and leaves, heard from the ground: soft gusts that swell and settle. Seamless loop. | "wind grass close", "wind meadow ground level", "breeze leaves rustle loop" | Record a breeze in tall grass with the microphone at grass-root level, sheltered by a windshield (a sock over the mic). Avoid traffic and voices. | stand-in |
| `amb.leaves_rustle` | `amb/leaves_rustle_01` | Ambience | 20–40 s loop (loop, streamed) | Dry leaf litter rustling up close (the macro layer you hear when zoomed in). Loop. | "leaf litter rustle close", "dry leaves movement macro" | Gently stir a tray of dry leaves with your fingertips 10 cm from the microphone, slow and irregular. | stand-in |
| `amb.bird` | `amb/bird_01` … `_06` | Ambience | 0.5–3 s | Distant songbird phrases for daytime (different birds and calls). | "songbird distant", "bird call meadow", "wren", "blackbird song distant" | Record birds at dawn in a park or garden from 20–50 m away; cut single phrases with a little room tail. | stand-in |
| `amb.cicada` | `amb/cicada_01` | Ambience | 20–40 s loop (loop, streamed) | Cicadas in warm daylight, swelling and fading (sandy and meadow maps). Loop. | "cicada loop", "cicadas summer chorus" | Field recording only (summer, warm climates). | stand-in |
| `amb.cricket` | `amb/cricket_01` … `_05` | Ambience | 0.1–0.3 s | One field cricket chirp: three or four pure, bright pulses. Many play at night, panned around. | "field cricket chirp single", "gryllus chirp" | Pet-shop crickets in a box at night; record close and cut single chirps. | stand-in |
| `amb.katydid` | `amb/katydid_01` … `_04` | Ambience | 0.3–0.8 s | A katydid rasp at night ("ka-ty-did"), high and dry. | "katydid call", "bush cricket rasp" | Field recording only. | stand-in |
| `amb.fly_pass` | `amb/fly_pass_01` … `_04` | Ambience | 1.5–3 s | A fly or small bee buzzing past the camera by day (Doppler swell). | "fly buzz pass by", "housefly flyby", "bee pass close" | Hard to stage; library sound recommended. | stand-in |
| `amb.frog` | `amb/frog_01` … `_05` | Ambience | 0.5–1.5 s | Frogs croaking in the distance at night (riverbank map). | "frog croak distant night", "tree frog chorus" | Field recording by a pond at night. | stand-in |
| `amb.owl` | `amb/owl_01` … `_03` | Ambience | 1–3 s | A tawny owl far away at night, now and then. | "tawny owl distant", "owl hoot night" | Field recording only. | stand-in |
| `amb.water_stream` | `amb/water_stream_01` | Ambience | 20–40 s loop (loop, streamed) | A small stream trickling (riverbank map): many small bubbles. Loop. | "small stream trickle close", "brook water loop" | Record a garden tap trickling into a bowl of water, mic 30 cm away, or a real brook. | stand-in |
| `amb.drip` | `amb/drip_01` … `_05` | Ambience | 0.2–0.5 s | A single water drop falling into a puddle (underground and riverbank). | "water drip cave", "single drop puddle" | Drip water from a pipette into a glass of water; record close. | stand-in |
| `amb.sand_hiss` | `amb/sand_hiss_01` | Ambience | 20–40 s loop (loop, streamed) | Wind blowing fine sand across the ground (sandy map): a bright, fine hiss of grains. Loop. | "sand blowing wind", "desert sand hiss" | Pour fine sand slowly onto a sheet of paper from 10 cm. | stand-in |
| `amb.rain` | `amb/rain_01` | Ambience | 20–40 s loop (loop, streamed) | Rain heard by an ant: huge single drops thudding into soil and slapping leaves, with a far-off hiss. Loop (weather). | "rain on leaves close", "heavy raindrops soil macro" | Drip water from a height onto leaves and soil in a tray; record very close. | stand-in; Weather is not in the game yet; the layer is wired to a weather setting. |
| `amb.raindrop_big` | `amb/raindrop_big_01` … `_05` | Ambience | 0.3–0.6 s | One huge raindrop landing right beside you: a thump, a splash and a bubble. | "raindrop impact close", "water drop leaf slap" | Drop water from a spoon onto a leaf on soil. | stand-in; Weather. |
| `amb.thunder` | `amb/thunder_01` … `_03` | Ambience | 4–8 s | Distant thunder rolling (weather). | "distant thunder roll" | Field recording only. | stand-in; Weather. |
| `amb.nest_room` | `amb/nest_room_01` | Ambience | 20–40 s loop (loop, streamed) | Inside the nest: a close, muffled, earthy room tone. Loop. | "underground room tone", "cave ambience muffled", "soil interior" | Bury a small microphone (in a plastic bag) a few cm under loose soil in a pot, and record the quiet. | stand-in |
| `amb.soil_trickle` | `amb/soil_trickle_01` … `_05` | Ambience | 0.5–1.5 s | Soil grains trickling down a tunnel wall now and then. | "soil trickle", "dirt falling small", "sand pour light" | Let a pinch of dry soil trickle from your fingers onto packed soil, mic 5 cm away. | stand-in |
| `amb.root_creak` | `amb/root_creak_01` … `_04` | Ambience | 0.5–1.5 s | A root creaking in the soil as it shifts. | "wood creak small", "root creak", "branch creak slow" | Slowly bend a fresh green twig near the mic; or twist a wooden ruler against a table edge. | stand-in |
| `amb.colony_rumble` | `amb/colony_rumble_01` | Ambience | 20–40 s loop (loop, streamed) | The colony at work, felt through the soil: a low rumble with a faint shimmer of thousands of feet. Loop. | "low rumble soil", "insect colony inside" | Record a busy aquarium or anthill with a contact microphone; or a slow rumble pitched down. | stand-in |

### Ants: footsteps and swarm

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ant.step_soil` | `ant/step_soil_01` … `_06` | Creatures | 20–50 ms | An ant tripod landing on soil: tiny, dry, rapid ticks. | "insect footsteps", "tiny ticks soil", "beetle walking close" | Tap a pencil tip very lightly on dry soil, 3 taps quickly; or a plastic comb tooth flicked on paper. Record 5 cm away and pitch up. | stand-in |
| `ant.step_leaf` | `ant/step_leaf_01` … `_06` | Creatures | 20–50 ms | Ant footsteps on a dry leaf: crisp ticks with a papery crinkle. | "tiny steps leaf", "insect walking leaf" | Tap a pen tip on a dry leaf lying on a table. | stand-in |
| `ant.step_bark` | `ant/step_bark_01` … `_06` | Creatures | 20–50 ms | Footsteps on bark or wood: duller, woody ticks. | "tiny taps wood", "insect on bark" | Pencil-tip taps on a piece of bark. | stand-in |
| `ant.step_stone` | `ant/step_stone_01` … `_06` | Creatures | 20–40 ms | Footsteps on stone or plaster (formicarium): sharp, hard ticks. | "tiny taps stone", "insect on rock" | Fingernail-tip taps on a smooth stone. | stand-in |
| `ant.step_sand` | `ant/step_sand_01` … `_06` | Creatures | 20–50 ms | Footsteps on sand: a soft, fine hiss of grains. | "tiny steps sand", "sand grains small" | Touch a fingertip into fine sand, quickly, very close to the mic. | stand-in |
| `ant.step_carton` | `ant/step_carton_01` … `_06` | Creatures | 20–50 ms | Footsteps on carton (chewed-wood nest walls): dull, papery. | "tiny steps cardboard", "taps on egg carton" | Pencil taps on an egg carton. | stand-in; No carton-nesting species yet. |
| `ant.step_queen` | `ant/step_queen_01` … `_05` | Creatures | 50–120 ms | The queen walking: slower, heavier, softer steps. | "beetle steps slow", "insect heavy step" | A fingertip pressed slowly onto soil, then a pencil tick. | stand-in |
| `ant.swarm_bed` | `ant/swarm_bed_01` | Creatures | 10–30 s loop (loop) | Hundreds of ants moving: a dense, shimmering rustle like wind in dry leaves. A loop the engine plays in grains, thicker with more ants. | "insects swarm rustle", "ants walking many", "beetles crawling mass" | Run fingertips continuously and lightly over a tray of dry soil and leaf crumbs; or pour rice slowly onto paper. | stand-in |

### Ants: digging, carrying, food

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ant.dig_bite` | `ant/dig_bite_01` … `_06` | Creatures | 0.08–0.15 s | Soil being bitten off: a small crunch over a dull crumble. | "soil crunch small", "dirt bite", "digging small close" | Squeeze a lump of slightly damp soil between fingertips next to the mic; or bite a cracker with the mic near your cheek, pitched up. | stand-in |
| `ant.soil_grains` | `ant/soil_grains_01` … `_05` | Creatures | 0.3–0.7 s | Grains trickling and bouncing after a bite (digging). | "sand trickle short", "dirt grains fall" | Drop a pinch of fine soil onto packed soil. | stand-in |
| `ant.pellet_drop` | `ant/pellet_drop_01` … `_05` | Creatures | 0.1–0.2 s | A soil pellet dropped at the spoil heap: a soft thud and a scatter. | "small dirt clod drop" | Drop a pea-sized clod of damp soil onto dry soil from 2 cm. | stand-in |
| `ant.drag_small` | `ant/drag_small_01` … `_05` | Creatures | 0.3–0.5 s | A small food item dragged over the ground: scraping and small bumps. | "small object drag dirt", "scrape tiny" | Drag a dried pea across soil on a tray. | stand-in |
| `ant.drag_heavy` | `ant/drag_heavy_01` … `_05` | Creatures | 0.5–0.8 s | A large food item hauled by a team: a heavier scrape with bumps. | "drag heavy object dirt", "scrape bump" | Drag a walnut across soil. | stand-in |
| `ant.food_cut` | `ant/food_cut_01` … `_05` | Creatures | 0.1–0.2 s | Mandibles shearing soft food: a fibrous crunch with moisture. | "bite fruit small", "crunch wet small" | Snap a small piece off a grape or a piece of cooked pasta near the mic. | stand-in |
| `ant.seed_crack` | `ant/seed_crack_01` … `_06` | Creatures | 0.1–0.2 s | A fire ant major cracking a seed: a sharp crack and fragments. | "seed crack", "nut crack small", "sunflower seed crack" | Crack sunflower or millet seeds with pliers 5 cm from the mic. | stand-in |
| `ant.leaf_cut` | `ant/leaf_cut_01` … `_05` | Creatures | 0.3–0.5 s | A leafcutter scissoring a disc from a leaf: rapid snips and crinkle, with faint stridulation. | "leaf cutting close", "scissors cutting leaf", "paper snip small" | Snip a fresh leaf with small nail scissors in quick, short cuts. | stand-in |

### Ants: communication

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ant.stridulate` | `ant/stridulate_01` … `_05` | Creatures | 0.1–0.35 s | Alarm stridulation: faint, fine rasping chirps (a scraper on the gaster rubbing a file). | "ant stridulation", "leafcutter ant stridulation", "insect stridulation" | Run a fingernail along the teeth of a fine comb very lightly; pitch up 1 octave. | stand-in |
| `ant.antenna_tap` | `ant/antenna_tap_01` … `_04` | Creatures | 30–80 ms | Antennae tapping (heard only very close): the faintest double tap. | "tiny tap tap" | Two light taps of a bristle on a beetle shell or a plastic lid. | stand-in |

### Ants: combat

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `combat.mandible_click` | `combat/mandible_click_01` … `_06` | Combat | 15–40 ms | Mandibles snapping on chitin: a crisp click. | "insect mandible click", "beetle click", "plastic click small" | Snap the tips of tweezers together; flick a fingernail on a hard plastic comb. | stand-in |
| `combat.mandible_snap` | `combat/mandible_snap_01` … `_06` | Combat | 40–80 ms | A strong bite (soldiers, majors): a heavier snap with a body thump. | "crab claw snap", "beetle shell snap" | Close a pair of small pliers sharply on a plastic bottle cap. | stand-in |
| `combat.chitin_crack` | `combat/chitin_crack_01` … `_06` | Combat | 40–100 ms | Exoskeleton cracking under a bite: a brittle crunch. | "crunch shell small", "insect crunch" | Crush a dried leaf or a piece of eggshell between fingers, close. | stand-in |
| `combat.grapple_scuffle` | `combat/grapple_scuffle_01` | Combat | 5–15 s loop (loop) | Ants grappling: legs scrabbling, bodies rubbing, clicks. A loop for the battle bed. | "insects fighting", "scuffle small" | Rub two dry leaves and a plastic comb together erratically near the mic. | stand-in |
| `combat.battle_bed` | `combat/battle_bed_01` | Combat | 10–30 s loop (loop) | A big fight heard as one texture: dense clicks, crunches and scuffles. The engine plays it louder as the fight grows past the voice limits. | "insects swarm battle", "crackling crunching dense" | Crunch a bag of dry leaves and cereal flakes continuously, close. | stand-in |
| `combat.acid_spray` | `combat/acid_spray_01` … `_05` | Combat | 0.2–0.4 s | Formic acid sprayed from the gaster: a fine, wet hiss. | "spray mist short", "aerosol hiss short", "water mist spray" | A fine plant mister, one short pump, 20 cm away; pitch up a little. | stand-in |
| `combat.acid_splat` | `combat/acid_splat_01` … `_05` | Combat | 0.2–0.5 s | Acid landing: a wet splat and a soft fizz. | "small splat wet", "fizz small" | Drop a little water onto a leaf, then a pinch of baking soda in vinegar for the fizz. | stand-in |
| `combat.sting` | `combat/sting_01` … `_05` | Combat | 30–80 ms | A sting going in: a sharp, wet puncture. | "puncture small wet", "needle pierce" | Push a needle through a grape skin; record close. | stand-in |
| `combat.sting_fire` | `combat/sting_fire_01` … `_05` | Combat | 30–80 ms | Fire ant stings: sharper and faster, often doubled. | "puncture sharp small" | As for sting, quicker, with a tick of tweezers. | stand-in |
| `combat.ant_death` | `combat/ant_death_01` … `_06` | Combat | 0.2–0.35 s | An ant dying: a brittle crunch and a soft collapse, legs curling. | "insect crush", "small crunch collapse" | Crush a dry leaf, then drop a paperclip onto soil. | stand-in |
| `combat.fling` | `combat/fling_01` … `_04` | Combat | 0.25–0.35 s | An ant thrown by a big creature: a scuffle, a short flight, a thump. | "small object thrown land" | Flick a dried bean so it lands on soil. | stand-in |

### Ants: brood and queen

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ant.egg_set` | `ant/egg_set_01` … `_04` | Creatures | 60–120 ms | An egg set down on its tile: soft and wet. | "wet small soft", "squish tiny" | Press a fingertip onto a wet jelly cube. | stand-in |
| `ant.larva_hatch` | `ant/larva_hatch_01` … `_04` | Creatures | 0.3–0.5 s | A new adult breaking out of its cocoon: a soft, wet tear. | "wet tear small", "membrane tear" | Tear a wet tissue slowly; peel a grape skin. | stand-in |
| `ant.queen_lay` | `ant/queen_lay_01` … `_03` | Creatures | 0.2–0.3 s | The queen laying an egg: a soft, wet sound. | "wet soft squish" | Squeeze a soaked sponge gently near the mic. | stand-in |

### Creatures

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `cr.spider_step` | `cr/spider_step_01` … `_06` | Creatures | 40–120 ms | Wolf spider steps: soft, padded footfalls with a brush of hairs. | "soft padded footsteps small", "spider walking" | Press the pad of a fingertip onto felt or soil, softly, quickly. | stand-in |
| `cr.spider_pounce` | `cr/spider_pounce_01` … `_04` | Creatures | 0.3–0.45 s | A spider pouncing: a scrape, a rush of air and a landing. | "pounce scrape", "animal pounce small" | Swipe a glove fast past the mic and slap it onto soil. | stand-in |
| `cr.spider_fangs` | `cr/spider_fangs_01` … `_04` | Creatures | 60–120 ms | Fangs clicking as a spider bites. | "click wet small", "fang click" | Click tweezers twice, then press a grape. | stand-in |
| `cr.beetle_step` | `cr/beetle_step_01` … `_06` | Creatures | 30–60 ms | Beetle steps: heavy, armoured clacking. | "beetle walking", "hard tap small plastic" | Tap a hard plastic bottle cap on a stone, quickly, irregularly. | stand-in |
| `cr.beetle_elytra` | `cr/beetle_elytra_01` … `_03` | Creatures | 0.3–0.5 s | Wing cases snapping open, then the wings unfolding. | "beetle wings open", "insect take off" | Snap two plastic lids apart and crinkle cellophane. | stand-in |
| `cr.stag_clash` | `cr/stag_clash_01` … `_05` | Creatures | 0.2–0.35 s | Stag beetle mandibles clashing: a heavy ringing clack and a scrape. | "antler clash small", "hard clack wood plastic" | Clack two pieces of hard wood or antler; scrape them apart. | stand-in |
| `cr.centipede_patter` | `cr/centipede_patter_01` … `_05` | Creatures | 0.2–0.35 s | A centipede running: a rippling patter of many legs. | "centipede walking", "fingers drumming fast light" | Drum all ten fingertips very lightly and fast on a tray of soil, in a wave. | stand-in |
| `cr.mantis_sway` | `cr/mantis_sway_01` … `_03` | Creatures | 0.5–0.8 s | A mantis swaying in wait: a quiet rustle. | "soft rustle leaf slow" | Brush a leaf slowly against another. | stand-in |
| `cr.mantis_strike` | `cr/mantis_strike_01` … `_05` | Creatures | 0.15–0.3 s | A mantis strike: a fast swish and a sharp snap shut. | "fast swish snap", "whip small" | Swish a thin twig past the mic and snap tweezers. | stand-in |
| `cr.pillbug_roll` | `cr/pillbug_roll_01` … `_03` | Creatures | 0.2–0.3 s | A pill woodlouse rolling up: plates clicking closed. | "small plates click", "shell roll" | Close a small hinged box of plastic plates; roll a bead chain. | stand-in |
| `cr.caterpillar_crawl` | `cr/caterpillar_crawl_01` … `_03` | Creatures | 0.3–0.5 s | A caterpillar crawling: soft, squishy. | "squish soft slow" | Press a damp sponge in a slow rhythm. | stand-in |
| `cr.antlion_flick` | `cr/antlion_flick_01` … `_04` | Creatures | 0.3–0.45 s | An antlion flicking sand at its prey. | "sand flick", "sand throw small" | Flick fine sand off a fingertip onto paper. | stand-in |
| `cr.creature_death` | `cr/creature_death_01` … `_04` | Creatures | 0.4–0.6 s | A creature going down: a heavier crunch and collapse. | "crunch collapse", "shell crush" | Crush a snail-shell-sized ball of dry leaves, then drop a pebble onto soil. | stand-in |
| `cr.cricket_burrow` | `cr/cricket_burrow_01` … `_03` | Creatures | 0.3–0.5 s | A mole cricket digging with its shovel legs. | "digging small scrape" | Scrape soil with a fingernail in short strokes. | stand-in; No mole crickets in the game yet. |

### Bosses

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `boss.footstep` | `boss/footstep_01` … `_05` | Creatures | 0.6–1.2 s | A boss footfall: ground-shaking, with debris trickling after. Real impacts pitched down; no roars. | "heavy footstep dirt", "body fall dirt", "impact earth heavy" | Drop a bag of soil onto a soil floor from 30 cm, mic low; pitch down an octave. | stand-in |
| `boss.rumble` | `boss/rumble_01` | Creatures | 10–30 s loop (loop) | A low-end rumble while a boss is near. Loop. | "low rumble earth loop" | Pitch a recording of a distant truck or a drum roll down two octaves. | stand-in |
| `boss.slam` | `boss/slam_01` … `_04` | Creatures | 1.5–2.2 s | A boss slam: a heavy impact, a crack, and soil showering down. | "heavy impact dirt debris", "earth slam" | Slam a fist onto a tray of soil and gravel, then pour a cup of soil; pitch down. | stand-in |
| `boss.windup` | `boss/windup_01` … `_04` | Creatures | 0.7–0.9 s | A boss winding up an attack: a heavy joint creaking tighter, a hiss of breath through spiracles. | "creak tension wood", "hiss slow rising" | Slowly bend a thick branch near the mic; breathe out through your teeth. | stand-in |
| `boss.phase` | `boss/phase_01` … `_03` | Creatures | 1–1.4 s | A boss entering a new phase: a big, rough stridulation and hiss (like a hissing cockroach scaled up). Never a roar. | "hissing cockroach", "beetle stridulation", "insect hiss" | Drag a stiff brush over a ridged plastic container; pitch down. | stand-in |
| `boss.hairs` | `boss/hairs_01` … `_03` | Creatures | 0.5–0.7 s | A tarantula flicking urticating hairs: quick, dry brushing strokes. | "brush strokes dry", "scratch fabric quick" | Brush the back of a fingernail quickly over velvet or a hairy blanket. | stand-in |
| `boss.arrive` | `boss/arrive_01` … `_02` | Creatures | 2–3 s | A boss arriving: distant heavy footfalls getting closer under a rising rumble. | "approaching heavy footsteps distant" | Combine boss footsteps with a swell of low rumble. | stand-in |

### Species not in the game yet

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `species.hellant_snap` | `species/hellant_snap_01` … `_05` | Combat | 0.1–0.25 s | Hell ant heavy attack: the vertical mandible snap, a loud, sharp, woody crack like a twig snapping. | "twig snap sharp", "stick break small" | Snap dry twigs (3–5 mm) close to the mic. | stand-in |
| `species.hellant_impale` | `species/hellant_impale_01` … `_04` | Combat | 0.15–0.3 s | Hell ant impale: the wet impact after the snap. | "stab wet small", "impale squish" | Stab a fork into a tomato. | stand-in |
| `species.hellant_struggle` | `species/hellant_struggle_01` … `_03` | Combat | 0.5–0.8 s | Prey struggling on the hell ant's jaw. | "insect struggle", "scrabble small" | Scrabble fingernails on a plastic lid. | stand-in |
| `species.nasute_move` | `species/nasute_move_01` … `_04` | Creatures | 0.1–0.2 s | Nasute termites moving: soft, papery. | "paper rustle small soft" | Rub tissue paper gently. | stand-in |
| `species.nasute_glue` | `species/nasute_glue_01` | Combat | 2–5 s loop (loop) | A nasute soldier's glue stream: a sticky, wet sputter (the engine makes it denser and faster as its damage ramps up). Loop. | "sticky wet sputter", "glue squeeze", "syrup drip pop" | Squeeze honey or glue from a bottle in short bursts; pull sticky fingers apart. | stand-in |
| `species.termite_headbang` | `species/termite_headbang_01` … `_04` | Creatures | 0.3–0.6 s | Termite soldiers' alarm: heads banging on the gallery wall, a rapid dull tapping. | "rapid tapping wood dull", "termite head banging" | Tap a pencil eraser rapidly on a wooden box. | stand-in |
| `species.saiyant_surge` | `species/saiyant_surge_01` … `_02` | Combat | 2–2.5 s | Saiy-Ant golden transformation: a rising rustle and shimmer (rattled seed pods, rain stick, shaken leaves) over a soft resonant tone, ending in a crisp crackle. Organic, never electronic. | "rain stick", "seed pod rattle", "shaker swell" | Turn a rain stick slowly, shake a dried seed pod, end with a crushed dry leaf; hum a low note softly under it. | stand-in |
| `species.saiyant_crackle` | `species/saiyant_crackle_01` … `_03` | Combat | 0.3–0.4 s | Saiy-Ant crackle: a crisp crackle of power. | "dry leaf crackle", "crackle crisp" | Crush a dry leaf sharply. | stand-in |

### Interface and alerts

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `ui.marker` | `ui/marker_01` … `_03` | Interface | 60–120 ms | Placing a pheromone marker: a soft natural chirp (a different pitch for each marker I–V; the engine pitches one sound). | "cricket chirp single", "insect chirp short" | One chirp of a cricket, or a comb flicked once, pitched up. | stand-in |
| `ui.marker_lift` | `ui/marker_lift_01` … `_03` | Interface | 30–60 ms | Lifting a marker: a light click. | "tiny click" | A fingernail tick on a plastic lid. | stand-in |
| `ui.group_assign` | `ui/group_assign_01` … `_03` | Interface | 40–80 ms | Moving a group card: a fingertip on a dry leaf. | "leaf tap" | Tap a dry leaf with a fingertip. | stand-in |
| `ui.tool_dig` | `ui/tool_dig_01` … `_04` | Interface | 60–120 ms | Marking soil to dig: a soft soil tap. | "dirt tap soft" | Tap packed soil with a fingertip. | stand-in |
| `ui.tool_build` | `ui/tool_build_01` … `_04` | Interface | 0.1–0.2 s | Placing a tile: an earthy tap and a puff of soil. | "earth tap", "soil puff" | Knock a knuckle on packed earth. | stand-in |
| `ui.tool_upgrade` | `ui/tool_upgrade_01` … `_03` | Interface | 0.2–0.3 s | Marking an upgrade: two earthy taps and a little trickle. | "double tap earth" | Two knuckle taps on packed earth, then a pinch of soil. | stand-in |
| `ui.tool_delete` | `ui/tool_delete_01` … `_03` | Interface | 0.3–0.45 s | Marking a tile for removal: a clod crumbling. | "dirt clod crumble" | Crumble a dry clod of soil between your fingers. | stand-in |
| `ui.menu_tap` | `ui/menu_tap_01` … `_04` | Interface | 30–60 ms | Menu buttons: a quiet tap on dry wood. | "wood tap soft", "button wood click" | Tap a wooden spoon with a fingernail. | stand-in |
| `ui.alert_queen` | `ui/alert_queen_01` … `_03` | Interface | 0.6–0.9 s | The queen under attack: an alarm stridulation over rapid drumming. Must cut through a battle. | "insect alarm stridulation", "rapid drumming wood" | Rapid fingertip drumming on a wooden box with a comb rasp over it. | stand-in |
| `ui.alert_starving` | `ui/alert_starving_01` … `_02` | Interface | 0.6–0.9 s | The colony is starving: a slow, dull drumming. | "slow knock wood" | Two pairs of slow knuckle knocks on a wooden box. | stand-in |
| `ui.alert_invasion` | `ui/alert_invasion_01` … `_02` | Interface | 0.8–1 s | Intruders in the nest: urgent drumming and stridulation. | "rapid drumming alarm" | Fast fingertip drumming in two bursts with a comb rasp. | stand-in |
| `ui.message_good` | `ui/message_good_01` … `_03` | Interface | 0.3–0.45 s | Good news: a dry seed pod shaken twice. | "seed pod shake", "shaker short" | Shake a dried poppy head or a pea pod twice. | stand-in |
| `ui.message_warn` | `ui/message_warn_01` … `_03` | Interface | 0.3–0.4 s | A warning: two dull knocks on wood. | "wood knock dull" | Two knuckle knocks on a wooden table. | stand-in |

### Music

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `music.explore` | `music/explore_01` | Music | 2–4 min loop (loop, streamed) | Calm, documentary music for building and exploring: plucked strings, kalimba, soft woodwind, light hand percussion. Loops seamlessly; never louder than the nature around it. | "nature documentary music calm acoustic", "acoustic ambient loop royalty free" | Commission or compose: acoustic guitar/harp, kalimba, flute, frame drum. Same key and tempo as the battle stem (D dorian, 96 BPM) so they can crossfade. | procedural score |
| `music.battle` | `music/battle_01` | Music | 2–4 min loop (loop, streamed) | Battle stem: the same piece with driving hand drums, shakers and pizzicato strings. Crossfades in with the fighting. | "tense acoustic percussion strings loop" | As the explore stem, same key and tempo, with percussion and ostinato strings. | procedural score |
| `music.boss` | `music/boss_01` | Music | 1–3 min loop (loop, streamed) | Boss stem: big low drums and swelling strings over the battle stem. | "epic acoustic drums strings loop" | Taiko or frame drums and cello, same key and tempo. | procedural score |
| `music.victory` | `music/victory_01` | Music | 3–6 s | A short acoustic flourish for winning. | "acoustic victory sting" | Rising plucked arpeggio and a drum. | stand-in |
| `music.defeat` | `music/defeat_01` | Music | 3–6 s | A short, falling acoustic phrase for losing. | "acoustic sad sting" | Falling plucked phrase, low and slow. | stand-in |

### Narration

| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |
|---|---|---|---|---|---|---|---|
| `narration.cue` | `narration/cue_01` … `_02` | Narration | 1–2 s | A soft cue before a narrator caption: one or two kalimba notes. | "kalimba note soft" | Two soft kalimba notes (D and A). | stand-in |
| `narration.voice` | one file per line | Narration | per line | Optional: recorded readings of the mission captions, one file per line (see docs/audio/sound-list.md). | — | A calm, warm documentary voice; quiet room; one take per caption. | stand-in; Captions are text only for now. |

## Narration lines (optional)

If you record the narrator, read each mission caption (in `src/sim/missions.ts`) as its own file, `narration/voice_<mission>_<stage>_<n>.ogg`. The captions work without them.

## Budget

Short sounds are decoded into memory: a second of mono audio at 44.1 kHz takes about 170 kB. Aim for one-shots under 1 s and 3–6 takes each, which keeps all effects under about 25 MB decoded. Loops longer than 8 s and the music stems are streamed instead of decoded, so their length costs download size only (Ogg at quality 5 is roughly 100 kB per 10 s of mono). The stand-ins the game warms up take about 25 MB decoded (low, rumbling ones are kept at a quarter or half sample rate; long ones keep three takes); a sound with recordings frees its stand-in.
