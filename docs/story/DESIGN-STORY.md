# Story mode — "The Termants", Chapter 1

Specs: `claude/story/02-spec-gene-thief-chapter1-two-levels.md` (campaign, chapter 1), `claude/story/03-spec-story-level-maps.md`
(the two maps), `claude/story/04-spec-chapter1-four-levels.md` (chapter 1 as four levels: the nights and the Spider
Mother, traits), `claude/story/06-spec-levels-5-7-and-lengths.md` (chapter 1 as seven levels, surprise events, 30–50
minute levels), `claude/creatures/01-spec-digging-titans.md` (titans dig into nests; built on `feature/digging-titans`),
`claude/maps/05-spec-layered-maps.md` (layered ground; its core is built here), the long-term plan
`claude/story/01-spec-gene-thief-campaign.md`. Inspired only by the broad Kickstarter-era idea of Empires of the
Undergrowth (a scientist following a gene-stealing queen across an island); every name, character, line, mission and
asset here is original.

## 1. Premise and the narrator

A storm carries a winged **Termant** queen to **Wayfarer Island**, a remote island where ants, termites and
giant arthropods from across the world live side by side ("everything here arrived from somewhere else": currents,
storms, ships). Level by level her colony spreads inland, defeating each species it meets and absorbing its genes.

**Dr. Elena Varga** narrates. A field myrmecologist who has spent eleven years on the island, alone, cataloguing how
castaway species settle in; she keeps a field journal, and the captions are its voice: calm, curious, factual. She has
**no model** and never appears on the map: she exists only as captions (named "Dr. Elena Varga · field journal" above
them), the end-of-level quote and the journal pages. The Termants are fictional and she says so in her own words
("She is no species I know… ants are wasps' cousins, termites a kind of cockroach"). In chapter 1 the unease only
starts and grows level by level: on the nights the colony "prepares for the night as if it remembers", on the river
bank she notes it learns too fast, and the chapter's last line (after the Spider Mother) hints at the island's Mega
Colony ("In the island's heart there are ants that have been doing what she does for far longer than she has").

Tone: a nature documentary with a twist. Captions are one or two sentences, triggered by mission events, stored in
`src/story/text/en.ts` by key (`<level>.<key>`), each emitted with its key so recorded voice lines can hook on it
(`narration/<key>`; the `narration.voice` audio slot is reserved). Gameplay tips are separate notes (`tip.*`), shown as
info toasts, never in the narrator's voice.

## 2. How the campaign plugs into the game (survey)

| System | Where | How story mode uses it |
|---|---|---|
| Mission runner | `src/sim/missions.ts` | **Extended, not duplicated.** A story level compiles to a `MissionDef` (`story` set) whose stages' goals and enter hooks call `sim/story/runner.ts`; `missionSystem` calls `storySecond` once a second, picks the story win/lose lines, and lets optional goals not block a stage. `missionDef(id)` resolves missions and story levels; `MISSIONS` (the Missions menu) still lists only `meadow` and `forest`. |
| Story director | `src/sim/story/director.ts` | New: a simulation system (`story`, every tick) plus hooks in `antAI.antSystem` (a directed ant fights first unless passive, then follows its cue) and `creatureAI.creatureSystem` (a directed creature walks its cue unless hurt). |
| Gene samples, stolen castes | `src/sim/termants.ts` | Unchanged mechanics; names now from `stolenName` (no nicknames). The loadout uses ColonySpec `borrowed` plus `genome.stolen`. |
| Maps, terrain | `src/maps`, `src/world/terrain.ts`, new `src/world/layers.ts` | Two story maps (`src/maps/story/*.ts`) on the `MapDef` format plus layers, ramps and `story` (points, paths, zones, flight). |
| Floods | `src/sim/floods.ts` | A story map's flood zone idles (`next` 1e12) until a stage's `flood` action starts its warning; the flood system runs the rest. |
| AI colonies | `colonyAI.ts`, `warAI.ts` | Rivals are ordinary AI colonies (developed nest, start workers, a population cap); `rivalRaids` per stage gates raids as before; a `raid` action can force one (`forceRaid`). |
| Saves, replays | `src/game/saves.ts`, `replay.ts`, `sim/snapshot.ts` | All story state lives in `w.s.mode.mission.story` (plain data): saves, replays and snapshots carry it. The setup records `story: { difficulty, loadout }`. |
| Captions | `src/ui/gameUI.ts` | The narrator caption element, now named for story lines; letterbox bars and Skip while a shot plays. |
| Camera | `src/render/cameras.ts`, new `src/game/cinematic.ts` | Shots steer the surface rig's goals (input off meanwhile); the rig's own damping smooths them. |
| Audio | `src/audio/gameAudio.ts`, `music.ts` | Per-biome ambience as before (meadow, riverbank); the adaptive music gets a story mood floor (calm, tense, swarm, assault) from `music` actions. |
| Areas | `src/sim/areas.ts` | Unchanged: the rival nest's area tab opens when the player's ants are inside. |
| Profile | `src/game/profile.ts` | Untouched; the campaign has its own save (`src/game/campaign.ts`). |

## 3. The campaign hub (island map)

`src/ui/storyHub.ts`, `src/ui/islandMap.ts`, data in `src/story/campaign.ts`. Reached from the title screen (**Story**
card) and the single-player menu (**Story** tab next to Missions), and after every level (`?story=1`).

- The island is painted procedurally in the narrator's field-map style: paper, an ink coastline with ripples, a
  watercolour wash per region (Meadow Pond, Riverbank, Forest Floor, Rainforest, Savanna, the Island's Heart caldera),
  the river, small ink marks (grass, conifers, canopies, mounds), a compass and the title. Nothing is copied art.
- Chapter 1 has two nodes: **Level 1** in the meadow and **Level 2** on the riverbank, joined by a dashed path. Level 2
  opens when level 1 is won; the first time the hub shows it, the path draws itself out and the mist over the riverbank
  lifts (2 s). Regions without levels are under mist, labelled "Coming soon".
- The level card: region, title, brief, the caste to steal, the three medals with their thresholds, difficulty
  (Easy/Normal/Hard/Brutal), the stolen-caste loadout (slots) and Start.
- **Genome** tab: every stolen caste, kept ones with their stats and fact, the rest as "Unknown genome — to be stolen
  in …".
- **Field journal** tab: a page per won level: the species page (title, facts), Dr. Varga's note, and an in-game
  photograph of the stolen caste (taken when the level is won). "Start the campaign over…" lives here.
- When all four chapter-1 levels are won: "Chapter 1 complete — more of the island is coming soon" (end screen and hub;
  the closing hint is the chapter's last level's `ending` line, whichever level completed the chapter).
- Chapter 1 (2026-11-02, 04-spec): Garden Below (meadow) → The Long Nights (the meadow's east edge, by the river woods)
  → Fire on the Banks (riverbank) → The Spider Mother (the riverbank's upper slot; a boss node). The path reveal follows
  the order (`LevelNode.after`).

## 4. Progression

- Genes are earned in the level with the existing gene-sample system; reaching the threshold unlocks the caste at once.
  **Winning keeps it** for the campaign. A level can be won without the caste (if its species is wiped out first, the
  steal objective counts as missed and the level goes on); replaying it later can steal it.
- **Slots**: one to start (`STORY.slots.start`), +1 per boss in later chapters (`STORY.slots.perBoss`, data; chapter 1's
  boss gives a trait only, user 2026-11-02). A slot holds a caste brought into a level (chapter 1: levels 2–4 take any
  caste stolen so far). A caste stolen during a level can always be raised there without a slot.
- **Traits** (`STORY.traits`, `sim/story/traits.ts`): permanent colony-wide bonuses from bosses, kept in the save
  (`traits`), given to the player's colony in every story level (`Colony.traits`, passed in by `storySetup`), shown on
  the Genome screen; skirmish and multiplayer colonies never have any. Built: **Spiderling Venom** (the Spider Mother):
  every bite of the player's ants — on an ant or a creature, riders too — adds a venom stack (0.6 dps for 4 s, up to 3).
  Planned (data only): Antler Plating, Forcipule Strike, Irritating Hairs, Ambush Reflex, Fungal Larder, and the
  finale's cap removal.
- Every level starts with a fresh nest: the base Termant castes plus the chosen stolen castes.
- The campaign save (`ud-campaign-v1`, browser storage; memory when blocked): levels won, best medal per category,
  fastest win, fewest losses, hardest difficulty, castes kept, bosses, difficulty and loadout per level, journal pages
  (with the photograph), paths revealed, traits. Autosaved when a level is won. It only feeds story setups: skirmish and
  multiplayer never read it.
- **Progress by level id** (the four-level reorder): a level is open when every level before it is won, or when it is
  won already. An old two-level save (garden and Fire on the Banks won) keeps both with their medals and castes, gets
  The Long Nights open, and is offered The Spider Mother at once (the friendlier rule: it follows Fire on the Banks,
  which it has beaten). The save gains an empty `traits` list when loaded.

## 5. The levels

Each is a data file (`src/story/levels/garden.ts`, `longNights.ts`, `fireBanks.ts`, `spiderMother.ts`, `antleredKing.ts`,
`highWater.ts`, `cartonKingdom.ts`) on the format in `src/sim/story/types.ts`: map,
player start, rivals, creatures, aphids and plants, reward, loadout, stages (objectives, captions, scenes, events),
level-wide scenes/captions/events on game time, the cast, medals, and the win/lose lines.

### Level 1 — "The Garden Below" (map `gardenBelow`, 1100 × 900 mm)
Map: level 0 = the storm puddle and its muddy margin in the south-west, with the player's start on a small dry rise;
level 1 = the meadow (most of the map, rocks, paving stones, the fruit landmark); level 2 = the raised flowerbed in the
north-east with the black garden ants' nest under a flat stone and their aphid plants. Ramps: a soil slope east and a
moss bank north from the start; wide stone steps from the meadow to the flowerbed (defended) and a narrow soil ramp at
its far east end (the flank; a caption hints at it). No dangerous creatures (the beetle only passes through).

| Stage | Objectives | Scenes and set pieces |
|---|---|---|
| 1 Landfall | raise 10 workers, 2 worker brood tiles, a food store, gather 60 food, store 8 wood | opening flight (Lasius nest → meadow → the shore); the castaway queen walks from the puddle into her nest; a ground beetle walks the shore, stops and watches her, then leaves the map; the cutworm patrols by the fruit; Lasius workers tend the aphids (drumming, trophallaxis poses); tips: dig, tiles, foraging, wood, ramps |
| 2 First contact | kill 4 black garden ants, raise 18 ants | two Lasius scouts walk down the stone steps, stop at the edge of the player's ground, antennate, walk back up (then the normal AI) |
| 3 Stolen genes | steal the Black Garden Ant Soldier, raise 3 | captions on what she does with the dead, aphid farming, the soldier's arrival |
| 4 Raid the garden | take the aphid plants (8 ants), kill the black garden ant queen | rival raids allowed; the flank hint; the long-lived queen fact |
| level-wide | — | at 10 min: the first Lasius raid (2 soldiers, 5 workers; a wave) gathers on the steps, charges the nest, guards, goes home |

Medals: time gold ≤ 20 min, silver ≤ 32; losses gold ≤ 25, silver ≤ 60; bonus "steal the Black Garden Ant Soldier before
the first Lasius raid".

Surprise events (§6): a red wood ant column crossing the garden (a visiting party); the ground beetle back, hunting the
meadow's foragers; a strawberry fallen off the bed, and a Lasius foraging party coming for it; a seed drop; a hot spell.
(An early Lasius raid on Hard and Brutal was tried and cut: at a person's pace it ended the level at 15–19 minutes.)

### Level 2 — "The Long Nights" (map `stonyHollow`, 1100 × 900 mm) — new 2026-11-02
Kept the working title: it says what the level is (three nights to live through) and is our own. The colony has spread
to a stony hollow where the meadow meets the river woods. No enemy ant species; reward: medals only. Map: level 1 = the
player's terrace in the south-west (a soil bank, two ramps down: a soil slope east, a moss bank north); level 0 = the
hollow (moss, stones, the day's food); level 1 = the stony rim of the woods round the north and east (a rock ledge, a
root ramp and a soil slope down); level 2 = a rocky knoll on the rim with the tarantula's burrow. Five **lairs** open
at the foot of the banks (underground areas, `sim/areas.ts` caves of kind `lair`, each with a few old kills; the
tarantula's drawn as a silk-lined burrow). No water, no fallen leaves.

**Day and night** (`StoryLevelDef.dayNight`, `sim/story/dayNight.ts`): four nights since 2026-11-03 (claude/story/06-spec
§7: the level ran 23½ minutes) — a first day of 7 min, days of 5½ min, nights of 3½ min and a last night of 4½; dusk warnings 30 s before each night (a caption and a tip), the light fading through the dusk
(`w.s.night` 0 → 1 over the 30 s of dusk and back at dawn: moonlight on the client, `render/view.ts`), the flags `dusk:N`, `night:N`, `dawn:N`, a clock under
the stage name ("Day 2 · dusk in 1:40", "Night 2 of 4 · dawn in 0:55"). About 38½ minutes in all.

| Stage | Objectives | Scenes and set pieces |
|---|---|---|
| The first day | survive night 1; gather 150 food, 3 food store tiles (optional) | opening flight (the knoll → the hollow → the terrace); food in the hollow; at dusk a ground beetle comes out of a lair and crosses the hollow (the first sign; the camera follows it); at night two packs (2 ground beetles; a ground beetle and a rove beetle) come out of the two nearest lairs and climb the two ramps to hold the ramp tops till dawn |
| The second day | survive night 2; 10 fighters, store 200 food (optional) | at dawn the hunters go home (passive, `leave` to their lairs) and the night's leftovers lie in the hollow; at dusk two wolf spiders wait at the mouths of two lairs facing the terrace (their eyes shine: eyeshine, render), then charge with the night's two packs (stone centipedes and ground beetles), from two sides |
| The third day | survive night 3; upgrade a chamber (optional) | at night packs from every lair (beetles, a rove beetle, wolf spiders, centipedes) |
| The fourth day | survive night 4; 18 fighters (optional) | the biggest packs; the red-knee tarantula leaves its burrow on the knoll, walks down the rim and across the hollow (the camera follows), digs a hole wider and walks into the nest breaking soil (`digInto`; a story titan never gives up or flees, `titanDig.ts`); keep the queen alive until dawn |
| level-wide | — | at dawn after the fourth night the level is won; the tarantula walks back out (`endRaid`) to its burrow and the hunters go home |

Surprise events by day (§6): a moth fallen in the hollow (day 1); a red wood ant column crossing the hollow at midday
and a hot spell (day 2); a praying mantis hunting the hollow and a dead grasshopper (day 3); a rove beetle hunting the
foragers and a seed drop (day 4).

Hunters' health is scaled down for the level (`hp` 0.3–0.4; their counts × the difficulty's `wave`); the tarantula 0.6 (0.7 before the fourth night) ×
the difficulty's `boss`. Medals: **food stored** at the end (the level's length is fixed: gold ≥ 360, silver ≥ 200),
losses (gold ≤ 60, silver ≤ 130), bonus "kill the tarantula before dawn".

### Level 3 — "Fire on the Banks" (map `fireBanks`, 1200 × 900 mm)
Unchanged gameplay, map and balance (level 2 until 2026-11-02); its opening caption now links it to the nights before.
Opening: the colony that came through the nights has sent out a young queen; she founds a fresh nest on the river's middle shelf (the simplest
opening that fits the story and the engine). Map: level 2 = the high bank with the fire ants' worked-soil mound and two
seed patches; level 1 = the middle shelf, the player's start at its west end, rocks for cover; level 0 = the low margin
by the river (mud and sand, the washed-up grasshopper), which floods. Ramps: a wide sand slope to the high bank (the
fire ants' main route), a root ramp at the far east end (the flank), and two ramps from the margin up to the shelf.

| Stage | Objectives | Scenes and set pieces |
|---|---|---|
| 1 Settle the bank | raise 16 ants, 2 food stores, gather 120 food | opening flight (the river → the mound → the player's start); a foraging column walks the trail from the mound to the seed patch and back, the camera following it; washed-up food and seed scatters placed |
| 2 The swarm | survive the swarm | three majors hold at the top of the wide slope in threat pose while the swarm gathers; on `swarmGo` it charges the player's nest down the slope (hold its foot), guards, then goes home |
| 3 Majors | steal the Tropical Fire Ant Major | majors and soldiers guard the two seed patches on the high bank (guard cue, 70 mm); 10 and 20 minutes in, two more majors and a soldier come down from the mound to each patch in turn (guards lost to a mantis, or killed with no one to carry them home, left nothing to steal: a person-pace playtest, 2026-11-06) |
| 4 The river rises | ride out the flood (100 s) | the margin floods after a 25 s warning (`floods.ts`, scripted); the pill bug and cutworm on the margin flee up the ramps first. Rafts: not built (the flood system has no floating bodies); the caption tells the fact instead |
| 5 Take the mound | kill the fire ant queen | both ramps; the flank hint; Dr. Varga's unease line |

Medals: time gold ≤ 25 min, silver ≤ 38; losses gold ≤ 40, silver ≤ 80; bonus "lose no more than 10 ants to the swarm".
(The Mega Colony hint moved to the end of level 4, and on to level 7 on 2026-11-03.)

Surprise events (§6): a praying mantis waiting at the slope's foot; a fire ant scouting band on the shelf; a dead cricket
by the river; a summer shower, then the fire ants' mating flight (fallen alates: food); a hot spell; on Hard and Brutal an
army ant swarm raid along the river margin (a visiting party of Eciton).

### Level 4 — "The Spider Mother" (map `spiderTerrace`, 1100 × 900 mm) — new 2026-11-02, the chapter's boss
Kept the working title. A Carolina wolf spider mother (`hogna`, a titan) owns the sandy upper terrace above the river.
Map: level 1 = the terrace (sand and short grass, rocks) with her burrow in the middle (a den under the sand drawn with a
silk turret rim); level 0 = the lower terrace by the river with the player's nest; three ramps up (a sand slide, a soil
slope, a root ramp). A developed colony laid out like an AI nest (user 2026-11-02; `nest` in the level, `developPlan` in the map spec, built by
the colony AI's own `developChambers`): the founding ring of workers round the queen, a 7-hex worker rosette, a 7-hex food
store by the entrance, 7-hex soldier and 3-hex Lasius soldier and fire major chambers (castes the player owns), highways
on the tunnels between them (about 29 ants, 140 food), a preparation (Easy 11½ min, Normal 11, Hard 10½, Brutal 10), then her
rounds (Easy 18½ min, Normal 19, Hard 19½, Brutal 20: claude/story/06-spec §7, the level ran 14–17 minutes, then 27½ at a
person's pace; 30 minutes on every difficulty before the last fight now), then the fight
to the end, which she starts rested and fed (at least 85 % of her health: `heal`); the light goes toward dusk when she comes out. On her rounds she can be hurt but not killed: at 55 % of her
health she is hurt no further until the last stage (`ActorDef.floor`), and below 60 % she stays down her burrow.

| Stage | Objectives | Scenes and set pieces |
|---|---|---|
| Before the hunt | prepare (the time by difficulty); 14 fighters, 50 ants (optional) | opening flight (the river → her burrow → the nest; a restart skips it, `?retry=1`); she sits at her burrow's mouth (hurt early, she answers with her own program) |
| Her rounds | hold out (the time by difficulty); 20 fighters, 60 ants (optional) | dusk light 0.3; her rounds: out to the doorstep for 40 s (her own program stalks and pounces), back to the burrow for 75 s, out again; hurt below 80 % she rests 40 s; hurt below 60 % she stays down her burrow until the last stage; five broods of her older spiderlings disperse over the terrace (at 2½, 6½, 10, 13 and 16 min: 5–6 each, × the difficulty's `wave`), each hunting round a ramp for 2½ minutes, then on their own |
| The Spider Mother | kill her | light 0.45; her rounds (a `goto` loop): out to the colony's doorstep, where her own program stalks, pounces on and drags away lone ants, then back to the burrow with her catch, and out again. **Phase 1 (100–60 %)**: hurt below 80 % she goes back to her burrow, passive, healing a little (26 s), then out again. **Phase 2 (60–30 %)**: her spiderlings spill off her back in two groups (at 60 % and 45 %; `bossCuts`). **Phase 3 (30–0 %)**: she comes for the nest, digs a hole wider and walks in breaking soil and stone (`digInto`). Pounces and her rider shake are telegraphed (wind-up, ground marker, sound); riders follow the mounting rules |

Her health 0.7 × 2400 × the difficulty's `boss` (Easy 0.75, Normal 1, Hard 1.1, Brutal 1.2). Medals: time gold ≤ 34 min,
silver ≤ 44; losses gold ≤ 45, silver ≤ 100; bonus "kill her within a minute of her breaking into the nest" (`killWithin`;
it was "kill her before she digs in", impossible since 2026-11-03: she always gets in, claude/story/05-spec). Inside the
nest her bites are softened by difficulty (`ActorDef.inside`, 05-spec). On her rounds her own health floor (55 %) and the
dig-in's (`STORY.titanRaid.hpFloor`, until she has been inside) both hold: the higher one counts. Reward: the trait
**Spiderling Venom**. The win line now leads on to the oak woods (level 5).

Surprise events (§6): before she hunts, a smaller wolf spider stalking the foragers at the slope's foot, a dead cricket, a
hot afternoon; during her rounds a ground beetle, a fallen moth and a dead grasshopper, and on Hard and Brutal a second wolf spider.

### Level 5 — "The Antlered King" (map `oakWoods`, 1200 × 1000 mm) — new 2026-11-03
Kept the working title. Old oak woods in the Forest Floor region: a clearing on the woods floor round a big oak whose
bark weeps sap, rotting logs, mushrooms. Map: level 1 = the colony's raised shelf in the south-west (a bark slab east and
a root ramp north down to the floor); level 1 = the old male's knoll in the north-east round an ancient stump (a wide
soil slope, the titan's way, and a root ramp); level 0 = the woods floor and the clearing. A young colony (the founding
ring, a 7-hex worker chamber, 4 store tiles, 3 soldier tiles). The four stag beetle sizes (§2 of the spec,
`sim/creatures/kinds.ts`: minor, small, medium and large males) are normal creatures here; the titan is the major male.

| Stage | Objectives | Scenes and set pieces |
|---|---|---|
| Settle the woods | raise 35, gather 200 food, kill the small male | opening flight (the stump → the sap oak → the shelf); a minor male walks across the woods (1 min); a small male comes to the clearing (4½ min) and stays there until he is brought down (the first fight); tip: big beetles need many ants, riders bite where it can't reach |
| The sap run | hold the sap flow with 12 ants for 2½ min; gather 150 (optional) | the oak weeps sap (honeydew drops every 45 s); a small and a medium male come to the oak, face off and wrestle (`wrestle` action: jaws locked, the bigger throws the other); the loser leaves, the winner guards the sap 2½ min |
| Rivals in the woods | hold out 10–12 min (by difficulty) and kill the large male; 20 fighters (optional) | a medium male guards the root ramp's foot; the large male takes the sap, then comes to the shelf's foot, and again and again until he is killed (a `goto` loop); two more males wrestle in the clearing; the stump hint |
| The old stump | get ready (Easy 4½ min, Normal 4, Hard 3¾, Brutal 3½); 25 fighters (optional) | a breathing space after the large male (added 2026-11-06: the colony rebuilds before the titan): he sits on his stump over the woods; a younger medium male climbs the knoll to him, they face each other, and the younger one turns back down the slope without a fight; tip: meet him together |
| The Antlered King | kill him | the titan comes down from his stump along the clearing to the colony's doorstep, fighting what he meets (his own program: grab-and-toss, shoving through, rear-and-slam when enraged — telegraphed); at 45 % two lesser males come out of the woods (a wave); at 25 %, or after three minutes at the doorstep whatever his health, he digs into the nest (`digInto`): a colony that only waits him out does not stall the level |

Surprise events: a ground beetle at the root ramp's foot, a fallen moth, a summer shower and a beetle brought down by it,
on Hard and Brutal a small male at the shelf's foot. His health 0.85 × the titan's × the difficulty's `boss` (briefly the full titan's on
2026-11-06: with the longer stages before him a person-paced colony then lost him on Normal and Hard). Medals:
time gold ≤ 40 min, silver ≤ 52; losses gold ≤ 60, silver ≤ 140; bonus "kill him within a minute of his breaking into the
nest" (`killWithin`: story titans always get in, 05-spec, merged 2026-11-06). Reward:
the trait **Antler Plating** (`STORY.traits.antlerPlating`: +1 armour on every ant of the colony; story only).

### Level 6 — "High Water" (map `floodHill`, 1200 × 1000 mm) — new 2026-11-03
Kept the working title. A hill in the Riverbank region's flood plain: the summit (level 2, the colony), a terrace round
it (level 1, a black garden ant colony), the hill's foot (level 0: a colony on the west side, one on an east shelf 14 mm
higher), the low plain along the river (level −1: the best food). The river rises in four stages (four flood zones, each
higher, story-driven, never draining): the plain, the hill's foot, the east shelf, the terrace. A nest whose doorway goes
under starts to flood underground (`floodNests` → `sim/nestFlood.ts`: water pours in and fills the nest from its lowest
chambers up; what is inside drowns). A colony whose turn is next goes all-in on the summit about 2 minutes before its
flood (`allOut` → `forceAllOut`): taking the hill is its only way to live. Earlier the three raid the player normally and
fight each other (three separate colonies). The summit never floods.

| Stage | Objectives | Scenes and set pieces |
|---|---|---|
| The summit | before the river rises (10 min); 30 ants, store 200 (optional) | opening flight (the river → the east nest → the summit); the plain's food; a shower upriver as the warning |
| The plain goes under | before the hill's foot floods (9 min); store 280 (optional) | the plain floods; the west colony goes all-in at 5⅔ min; another shower |
| The hill's foot | before the east shelf floods (8 min); kill the west queen (optional) | the hill's foot floods and the west nest with it; the east colony goes all-in |
| The east shelf | before the terrace floods (7½ min); kill the east queen (optional) | the east shelf floods and its nest; the terrace colony goes all-in |
| The summit stands | all three colonies gone (drowned or destroyed) | the terrace and its nest flood; the scientist on the high ground |

Surprise events: a ground beetle and a drowned grasshopper on the plain, a seed drop on the hill's foot, a wolf spider
come up out of the water's way, on Hard and Brutal a red wood ant column crossing the plain (4 workers and a soldier: with
6 and 2 it cut a person-paced colony's foragers from 48 to 16 on Hard). Medals: food stored (gold ≥ 420, silver ≥ 240),
losses (gold ≤ 70, silver ≤ 160), bonus "destroy a colony yourself before the water takes it" (`deadBefore`). The water's
timetable is the same on every difficulty (about 35 minutes); the difficulty scales the rivals' strength and aggression
but not their sizes (`RivalDef.fixedSize`, 2026-11-06: three colonies at once, each 1.25× and 1.5× as big on Hard and
Brutal as well, overran a person-paced colony by 20 minutes).

### Level 7 — "Carton Kingdom" (map `rainforestEdge`, 1200 × 1000 mm) — new 2026-11-03, the chapter's last level
Kept the working title. The Rainforest's edge: two giant trunks on buttress roots, wet ground, a sunken hollow of puddles
that fills in a shower (a flood zone), and on a raised shelf between the roots two allied conehead termite colonies
(`nasutitermes`, one team: the AI allies' brain sends help to the one attacked unless the other is invaded itself) with
their carton nests and covered galleries. No fallen-leaf dressing (user rule).

| Stage | Objectives | Scenes and set pieces |
|---|---|---|
| The forest's edge | raise 35, gather 200; store 20 wood (optional) | opening flight (the trunks → the termite shelf → the colony); captions on carton and the galleries; tip: the allies |
| The nasus | steal the Conehead Termite Sprayer (`nasute_soldier`), raise 4 | a shower fills the hollow, then the termites' winged alates come out (fallen alates: food); tips on the genes |
| The first nest | destroy one of the two colonies (either) | rival raids; the other comes to help |
| The second nest | destroy the other | — |

Surprise events: a termite foraging party (workers with a soldier escort) in the hollow, a mantis at the forest's edge,
the shower and the alates, a fallen fruit, steam after the rain (a hot spell), on Hard and Brutal an army ant swarm raid
along the forest's edge. Medals: time gold ≤ 40 min, silver ≤ 52; losses gold ≤ 70, silver ≤ 160; bonus "steal the nasute
Sprayer before the termites raid you". Reward: the **Conehead Termite Sprayer** (`nasute_soldier`, the glue squirter — the spec's "Nasute Termite soldier"; main named it the Sprayer on 2026-11-03), kept for the campaign. The
chapter's closing line (the Mega Colony hint) follows its win, then "Chapter 1 complete".

### Surprise events (claude/story/06-spec §6)
Each level lists a pool (`StoryLevelDef.surprises`, built with `src/story/surprises.ts`: `column`, `party`, `wanderer`,
`windfall`, `rain`, `heat`, `earlyRaid`). When the level begins each is rolled from a hash of the seed and the level (not
the simulation's RNG): whether it happens (its `chance` × the difficulty's `events`: Easy 0.6, Normal 1, Hard 1.3,
Brutal 1.6; `from: 'hard'` events only on Hard and Brutal) and when in its window (game time, or after a flag such as
`stage:2` or `dawn:1`; `until` a flag it is dropped). Firing sets `ev:<id>`; the level's scenes on that flag bring the
party or the creature (the director plays them); its actions run (food, weather, a flood, a raid) and its caption is
said. Big ones (columns, hunters, raids) never overlap: one due while another runs waits until it is over plus
`STORY.eventGap` (20 s). Parties' sizes scale with the difficulty's `wave`. A **visiting party** (a species not in the
level: red wood ants, army ants) belongs to a nestless colony made for it (`Colony.visitor`: no nest dug, no queen,
never an AI, never lost, never lost on the surface); it follows its path fighting whatever it meets and walks off the map.
Its dead are gene samples like any other (a stolen caste from them is kept, like any stolen caste). Weather: a shower
(the storm light, falling rain `render/rainFX.ts`, wet ground; with `flood` on a map's flood zone), a hot spell (ants on
the surface at `STORY.heatSpeed` 0.8 of their speed).

## 6. The framework

- **Objective types** (`sim/story/objectives.ts`): raise, fighters, build, dig, collectFood, storeWood, killAnts,
  stealCaste, raiseCaste, killQueen, surviveTime (seconds, or per difficulty), surviveWave, killCreature, escort,
  protect, reach, enterNest, surviveNight, upgrade, storeFood; each with
  a default goal text, `optional`, and latching (a met goal stays met). Chapter 1 uses raise, build, collectFood,
  storeWood, killAnts, stealCaste, raiseCaste, surviveWave, surviveTime, reach, killQueen; the rest are tested.
- **Director** (`sim/story/director.ts`): actors (a creature, a group of a colony's ants, a whole rival colony) named in
  the level and given scenes: sequences of cues — `walkTo`, `path` (+`reverse`), `holdAt` (+`face`, `anim`), `patrol`,
  `guard`, `wander`, `follow`, `anim`, `face`, `leave` (an edge point or 'nest'), `mode` (passive, aggressive, normal),
  `flee`, `charge`, `wait`, `waitFlag`, `flag`, `release`, `digInto` (a titan digs into a colony's nest:
  `claude/creatures/01-spec`; guaranteed since 2026-11-03, `claude/story/05-spec`: the cue owns the titan until it is
  inside — retried if it can't start, out of its lair first, other scenes wait, a health floor until in, a pace floor and
  a dig cap per difficulty; `speed` its walk there; the level's actor `inside` softens its bites in the nest by
  difficulty — DESIGN.md "Story titans always get in"), `rest` (back to a place, still, healing a little), `goto` (loop back to an earlier cue: a
  hunter's rounds). Actors may be groups of creatures out of several lairs (`creatures`, `from`), with health marks
  (`phases` → flags `hp:<actor>:<percent>`, `killed:<actor>`), a boss's own phase cuts (`bossCuts`) and a hunting goal
  (`goal`). (2026-11-02: `charge` and `flee` used to be skipped at once — the actor went straight to its next cue; they
  now take their time. The two older levels' waves, balanced on the old behaviour, say `mode: 'aggressive'` then their
  guard instead, so they play exactly as before; their fleeing critters now really flee, which is only visual.)
  Scenes start with a stage, at a time (the stage's own clock: until the mission has entered a new stage, up to a second
  after the last one ended, the director reads 0 — it used to read the old stage's clock, so a new stage's timed scenes
  could all start at once; fixed 2026-11-06), or on a flag; cues set
  flags; captions, actions, camera shots and other scenes wait on flags. Walking uses the flow fields (round banks and
  walls, up ramps) and the ant and creature movement code (foot planting is the renderer's, as for any walking ant).
  Directed ants fight what they meet unless passive; a hurt creature reacts with its own program; a cue that cannot
  finish times out (`STORY.cueTimeout`) and is logged (`story.log`, `storyDebug`). Player units are never directed
  (the castaway queen of the opening is a stand-in that leaves the map).
- **Flags** the world sets: `stage:N`, `caste:<id>` (stolen), `raid:<rival>` (its war AI marches on the player),
  `dead:<rival>`, `wave:<actor>` (a wave appeared), `beaten:<actor>`, `gone:<actor>`, `flood:<zone>`, `dusk:N`,
  `night:N`, `dawn:N` (a level's clock), `hp:<actor>:<percent>`, `killed:<actor>`.
- **Actions**: spawn an actor, flood a zone, set a flag, place food, play a shot, set the music mood, force a raid, show
  a tip, end a titan's raid (`endRaid`), set the light (`night`); added for levels 5–7 (claude/story/06-spec): `weather`
  (a shower: falling rain `render/rainFX.ts` and wet ground; a hot spell: ants on the surface at `STORY.heatSpeed`),
  `note` (a researcher's note), `wrestle` (two stag beetle males lock antlers: `startStagWrestle`), `allOut` (a rival
  goes all-in on the player: `forceAllOut`), `floodNests` (every rival whose doorway is under water starts to flood:
  `startNestFlood`), `heal` (an actor to a share of its health).
- **Objectives and bonuses added for levels 5–7**: `hold` (`n` ants within `r` of a point for `s` seconds in a row; the
  clock starts over when too few are there), `killQueens` (`n` of these rivals' queens dead); bonuses `deadBefore` (a
  rival destroyed before the water floods its nest) and, from main's titan work, `killWithin`. Actors: `floor` (a boss's
  health floor until a flag: the Spider Mother on her rounds; with a dig-in's floor the higher one holds). Rivals: `team`
  (allies), `income` (food a second: a mature colony's economy), `fixedSize` (its size does not grow with the
  difficulty).
- **Level fields** besides the stages: `dayNight` (its own clock), `lairs` (dens as underground areas), `developed` (a
  preset nest), `reward` (a caste, a trait, or neither). The director keeps running after a win (actors walk off, a titan
  leaves at dawn) for "keep playing here".
- **Shots** (`game/cinematic.ts`): the map's opening flight, and short shots in data (keys at story points or following
  an actor), letterboxed, skippable (button or Esc), client-side only. Never more than ~10 s (the opening) or ~5 s.
- **Difficulty** (`STORY.difficulty` in `balance.ts`): enemy stats (health and damage), wave size, AI aggression,
  starting food, the rivals' head start and population cap, a story boss's health. Easy 0.75/0.6/0.6/1.6/0.7/0.75,
  Normal 1, Hard 1.2/1.35/1.3/0.85/1.25/1.1, Brutal 1.4/1.7/1.6/0.7/1.5/1.2.
- **Medals**: three per level — time (or food stored, on a level of fixed length) and losses (gold/silver/bronze by
  thresholds) and the bonus (gold when achieved: steal before a flag, lose few to a wave, kill an actor before a flag).
- **Rewards**: a stolen caste, or a boss's trait (`STORY.traits`); extra slots from later chapters' bosses
  (`LevelNode.boss`, `STORY.slots`).
- **Dev**: `?story=<level>&stage=N[&ants=N]` starts a level at any stage (with extra ants), `&titan=1` at the stage's
  titan moment (the last night's start; a boss just above the mark that sends it to dig in); `?nocine=1` skips shots;
  `storyDebug(world)` lists each actor's members, scene and cue; `tools/playtest-story.ts` plays a level headless.

## 7. Saves, determinism, co-op

All story state is simulation state (`w.s.mode.mission.story`), driven by ticks and the seeded RNG in id order: the same
commands give the same game (tests: two runs agree, a snapshot restore mid-scene runs on identically). The camera
shots and the campaign save are client-side. Two-player co-op could share the player colony later; solo ships first.

## 8. Balance plan

Played headless by `tools/playtest-story.ts` (the colony's own AI plus a scripted "player" that builds what a stage
asks, takes rival corpses for genes, waits for an army before the assault, falls back to regroup) on every difficulty;
results in PROGRESS.md. Targets: 20–40 min on Normal for a person; the bot (weaker than a person) wins Easy and Normal.

Results after the caste balance (2026-11-02, seed 7 unless noted; the bot is the colony AI plus the scripted player):

| level | Easy | Normal | Hard | Brutal |
|---|---|---|---|---|
| The Garden Below | won 29.6 min | won 48.0 min (seed 11: 20.8 min) | won 33.7 min | won 38.4 min |
| Fire on the Banks | won 33.2 min (seed 11: 50.8 min) | won 42.3 min (seed 11: not in 60 min) | not in 60 min | not in 60 min |

Four levels (2026-11-02, after the merges of the food-tile economy, the ground realism and the digging titans; seed 7
unless noted). The bot now also takes on bosses (an army gathered in front of the nest, then all onto her, falling back to
rebuild) and the nights (a titan in the nest first, else a hunter at the door — no sorties to the ramps in the dark):

| level | Easy | Normal | Hard | Brutal |
|---|---|---|---|---|
| The Garden Below | — | not in 60 min (seed 11: won 14.5 min) — the same on `main` without this work: its balance moved with the food-tile economy (another branch) | — | — |
| The Long Nights | won 23.6 min (93 ants, 66 lost, tarantula killed) | won 23.6 min (80 ants, 146 lost; seed 11: 92 ants, tarantula killed) | won (seed 11: 60 ants, 151 lost; seed 7: 16 ants) | won 23.6 min (90 ants, tarantula killed; seed 11: 1 ant left) |
| Fire on the Banks | — | won 46.4 min (seed 11: 44.8; seed 21: 36.1) — `main`: 41.8, not in 60, 37.6: the same within the bot's noise | — | — |
| The Spider Mother | won 9.3 min | won 8.7 min | won 8.7 min | not in 40 min (seed 11: won 8.3 min) |

The nights' length is fixed (23½ min). The bot's Spider Mother fights are short (about two minutes from the hunt: an army
of 50–70 against her); a person who lets her hunt the doorstep loses many more ants. On Brutal she is a coin toss for the
bot. Garden Below is not retuned here (04-spec: its balance is not to change); its bot result moved with another branch's
economy change, flagged in the handoff. After the AI-allies merge (the new colony AI plays the rivals and the bot): Long
Nights won, Spider Mother won 8.6 min, Fire on the Banks won (seed 21: 42.1 min); Garden Below seed 11 no longer finishes
in 60 min — a retune of the garden is the next balance job.

The caste balance made fire ant minors much tougher (13.5 health, was 8), so level 2's mound holds fewer ants (pop 18,
developed 3, 10 starting workers; was 55 / 4 / 12) under a level enemy scale of 0.85 (`StoryLevelDef.enemyStat`), and
the player starts with 170 food. Hard and Brutal level 2 are left to people: the bot takes the mound's hole head-on
and never uses the root at the east end.

## 9. Stolen-caste names (no nicknames, user 2026-11-01)

Hell Ant Soldier, Nasute Termite Soldier, Sickle-Jaw Termite Soldier, Tropical Fire Ant Major, Saiy-Ant Soldier, Red
Wood Ant Rapid Sprayer, Black Garden Ant Soldier, Leafcutter Ant Major, Army Ant Soldier (`stolenName`: the species'
common name in the singular plus the caste's own name; the two termite soldiers say "Soldier" for their "Nasute" and
"Sickle-jaw" castes).

## 10. Facts and sources

Every real-species line in the captions and the journal (`story/text/en.ts`), checked 2026-11-02:

| claim (caption key) | wording used | source |
|---|---|---|
| Lasius niger is one of Europe's commonest ants; workers 3.5–5 mm (`garden.contact1`, journal) | "one of the commonest ants in Europe" | [AntWiki: Lasius niger](https://antwiki.org/wiki/Lasius_niger) ("one of the commonest European species"; Collingwood 1979: 3.5–5.0 mm) |
| a founding queen seals herself in a claustral chamber and raises the first brood on her own reserves; the first workers are small (`garden.intro3`, `garden.nanitics`) | as written | [Black garden ant, Wikipedia](https://en.wikipedia.org/wiki/Lasius_niger) ("claustral chamber"); [AntWiki](https://antwiki.org/wiki/Lasius_niger) |
| a L. niger queen lived ~28¾ years in captivity, kept by the German entomologist Hermann Appel (`garden.queenFact`) | "kept by a German entomologist lived nearly twenty-nine years" (was "in a laboratory") | [Queen ant, Wikipedia](https://en.wikipedia.org/wiki/Queen_ant) |
| young workers nurse, older ones forage — true of ants in general, not shown for L. niger in what I found (`garden.contact2`, journal) | "in an ant colony the young workers …" (was said of Lasius) | [Ant, Wikipedia](https://en.wikipedia.org/wiki/Ant) |
| L. niger foragers recruit along pheromone trails (`garden.contact3`) | as written | [AntWiki](https://antwiki.org/wiki/Lasius_niger) ("mass recruiter"); Evison et al. 2008, *Behav. Ecol. Sociobiol.* 63: 261–267 |
| L. niger tends aphids for honeydew and drives off ladybirds (`garden.aphids`) | as written | [AntWiki](https://antwiki.org/wiki/Lasius_niger) (aphids tended, honeydew); [Black garden ant, Wikipedia](https://en.wikipedia.org/wiki/Lasius_niger) (removes ladybirds from black bean aphids) |
| nuptial flights on hot summer days, over a whole district at once (`garden.flight`) | as written | [AntWiki](https://antwiki.org/wiki/Lasius_niger) ("huge numbers may fly over a large district on the same date"); [Wikipedia](https://en.wikipedia.org/wiki/Lasius_niger) |
| S. geminata is American and spread with 16th-century Spanish trade, Acapulco to Manila (`fireBanks.intro2`, journal) | "Spanish galleons carried it across the Pacific in the 1500s" (was "ships … centuries ago") | Gotzek, Axen, Suarez, Helms Cahan & Shoemaker 2015, *Molecular Ecology*, doi:10.1111/mec.13040; [U. Illinois news](https://las.illinois.edu/news/2015-04-01/silk-gold-spices-andants) |
| workers are strongly polymorphic; majors have square heads and blunt jaws that crack seeds, which the colony stores (`fireBanks.foragers`, `fireBanks.majors`) | "from small minors to big, square-headed majors" (was "majors twice their length") | [Tropical fire ant fact sheet, Lucid](https://apps.lucidcentral.org/ppp_v9/pdf/web_full/tropical_fire_ant_362.pdf); [Landcare Research, S. geminata](https://oldwww.landcareresearch.co.nz/__data/assets/pdf_file/0015/51063/solgem.pdf) |
| fire ants grip with the mandibles and sting repeatedly; the venom is mostly alkaloids (`fireBanks.sting`) | as written | [Tropical fire ant fact sheet, Lucid](https://apps.lucidcentral.org/ppp_v9/pdf/web_full/tropical_fire_ant_362.pdf) |
| fire ants raft on floods — documented in the red imported fire ant, S. invicta (`fireBanks.river2`, journal) | "best known from a cousin, the red imported fire ant" (was said of fire ants in general) | [eXtension: fire ants in floods](https://ant-pests.extension.org/what-happens-to-fire-ants-during-a-flood); Mlot, Tovey & Hu 2011, *PNAS* (raft formation by S. invicta) |
| ants evolved within the stinging wasps; termites are a branch of the cockroaches (`garden.termant`) | as written | [Ant, Wikipedia](https://en.wikipedia.org/wiki/Ant); [Termite, Wikipedia](https://en.wikipedia.org/wiki/Termite) |
| Pterostichus melanarius is mostly nocturnal and eats ants among other prey (`longNights.beetle`, journal) | "Mostly nocturnal, and ants are on its menu" | [UK Beetles: Pterostichus melanarius](https://www.ukbeetles.co.uk/pterostichus-melanarius) ("adults are mostly nocturnal"; prey "ants, mites, larvae, spiders, slugs and worms") |
| the Brazilian ant Forelius pusillus seals its nest each night; a few workers seal it from outside and are left there (`longNights.closeUp`, journal) | as written ("each night") | [Phys.org 2008, on Tofilski et al., *American Naturalist*](https://phys.org/news/2008-09-puzzle-ants-suicide-mission.pdf) |
| wolf spider eyeshine comes from the tapetum lucidum, a reflective layer behind the retina (`longNights.dusk2`, journal) | "a mirror layer behind the retina" | [HHMI BioInteractive, "Eye see you"](https://www.hhmi.org/beautifulbiology/media-detail/eye-see-you) |
| wolf spiders hunt by sight, not with webs (`longNights.eyes`, `spiderMother.sight`, `spiderMother.hunt`) | as written | [Montana State Univ., wolf spiders](https://urbanipm.montana.edu/entomology/resources/fact-sheets/spiders_of_montana/wolf.spiders.html) ("excellent vision that is used for prey capture"); [Hogna carolinensis, Wikipedia](https://en.wikipedia.org/wiki/Hogna_carolinensis) (no webs; ambush from burrows) |
| stone centipedes (Lithobius) hide under stones and leaf litter by day and kill with venom claws (forcipules) (`longNights.centipede`, journal) | "venom claws behind the head" | [Lithobius forficatus, Bugs With Mike](https://bugswithmike.com/guide/arthropoda/myriapoda/chilopoda/lithobiomorpha/lithobiidae/lithobius/forficatus) |
| tarantulas are mainly nocturnal; the red-knee ambushes prey from its burrow and, disturbed, kicks off urticating hairs rather than biting (`longNights.tarantula1`, journal) | as written | [Bug of the Week: nocturnal hunters](https://bugoftheweek.com/blog/2014/1/20/nocturnal-hunters-mexican-redrump-tarantula-ibrachypelma-vagansi) ("primarily nocturnal hunters"); [Brachypelma hamorii, Wikipedia](https://en.wikipedia.org/wiki/Brachypelma_hamorii) (burrows "enable them to ambush passing prey"; hairs) |
| Hogna carolinensis is the largest wolf spider in North America; females 22–35 mm; it burrows and hunts from the burrow, mostly at night (`spiderMother.intro2`, `spiderMother.prep`, journal) | as written | [Hogna carolinensis, Wikipedia](https://en.wikipedia.org/wiki/Hogna_carolinensis); [BugGuide](https://bugguide.net/node/view/27062) (leaves the burrow at night to hunt) |
| wolf spider mothers carry the egg sac on their spinnerets, then the young on the abdomen (`spiderMother.intro3`) | as written | [Montana State Univ., wolf spiders](https://urbanipm.montana.edu/entomology/resources/fact-sheets/spiders_of_montana/wolf.spiders.html) |
| about 200 spiderlings per sac; they stay on the mother about six days (`spiderMother.brood`, journal) | "some two hundred … nearly a week" / "some six days" | [Hogna carolinensis, Wikipedia](https://en.wikipedia.org/wiki/Hogna_carolinensis) |
| red wood ants forage along trails up to about 100 m long, by day, and are aggressively territorial (`garden.woodAnts`, `longNights.woodAnts`, `highWater.woodAnts`) | "they forage along trails a long way from home and fight anything on them" | [Formica rufa, Wikipedia](https://en.wikipedia.org/wiki/Formica_rufa) ("Foraging trails may extend 100 m"; "aggressively territorial") |
| fire ant mating flights come on warm days a day or two after rain (`fireBanks.alates`) | "After the rain … winged queens and males for their mating flight" (game time compresses the day or two) | [eXtension: Life in a fire ant family, winged forms](https://ant-pests.extension.org/life-in-a-fire-ant-family-winged-forms) ("1 or 2 days after a rainfall") |
| Eciton burchellii swarm raids eat what cannot get away (`fireBanks.armySwarm`, `cartonKingdom.armyAnts`) | as written | the game's own army ant notes, `docs/creatures/eciton-burchellii.md` (sourced there) |
| male stag beetles reach about 75 mm; how big an adult grows depends on the quality and amount of food it had as a larva (`antleredKing.allometry`, journal) | "How big a male grows, and how long his jaws get, depends on how well he fed as a larva" (jaws scale with the body) | [Lucanus cervus, Wikipedia](https://en.wikipedia.org/wiki/Lucanus_cervus) ("Males grow up to 7.5 centimetres"); [NHM: stag beetles](https://nhm.ac.uk/discover/stag-beetles.html) ("The size of an adult stag beetle is influenced by the quality and amount of food it had access to as a larva") |
| the larvae spend 3–7 years in rotting wood; adults live a few weeks and drink sap (`antleredKing.larvae`, `antleredKing.sap1`, journal) | as written | [Lucanus cervus, Wikipedia](https://en.wikipedia.org/wiki/Lucanus_cervus) ("3 to 7 years", "only a few weeks", "tree sap"); [NHM](https://nhm.ac.uk/discover/stag-beetles.html) ("Adult stag beetles don't eat, but they do drink sweet fluids such as tree sap") |
| males fight rivals with their mandibles, trying to throw them off the log or branch; flight at dusk (`antleredKing.thrown`, `antleredKing.shower`, journal) | as written | [Lucanus cervus, Wikipedia](https://en.wikipedia.org/wiki/Lucanus_cervus) ("intending to throw their opponent off the log or branch"; "slow, lumbering flight, usually at dusk") |
| ants move their nest to a higher chamber when flood water rises (`highWater.brood`, journal) | "many ants carry their brood and their queen to higher ground" | Ecological Society of America 2008 abstract, [Paper 12888](https://eco.confex.com/eco/2008/webprogram/Paper12888.html) ("both species moved their nests to the higher nest chamber when faced with rising flood waters") |
| an ant tells nestmates from other colonies of its own species (`highWater.three`) | "an ant knows its nestmates by their scent" | [Ant, Wikipedia](https://en.wikipedia.org/wiki/Ant) (nestmate recognition by cuticular hydrocarbons) |
| fire ants (S. invicta) raft; black garden ants are not known to (`highWater.rafts`) | as written | as for `fireBanks.river2` above; no rafting record for Lasius in what I found |
| Nasutitermes corniger: carton of chewed wood and faeces bound with saliva; carton-covered tunnels from the nest; soldiers squirt a toxic secretion from the nasus and have small mandibles; workers feed the soldiers; alates swarm, often after rain; the king and queen stay together for the colony's life (`cartonKingdom.*`, journal) | as written ("sticky, noxious" for the secretion) | [Conehead termite fact sheet, Haiti Trust 2024](https://haititrust.org/wp-content/uploads/2025/09/Fact-Sheet_Conehead-Termite_2024.pdf); the game's notes `docs/creatures/nasutitermes.md` (terpene glue) |

Not used as facts: Hogna carolinensis building a silk turret round its burrow (the burrow's turret rim is the render's,
from the spec; I found no source for it in this species), and Pterostichus hunting ants specifically at night.

## 11. Later chapters (outline, so the framework fits them)

From `01-spec`: Forest Floor (red wood ants; an escort/migration level; the stag beetle titan), Riverbank's banded hunter
(Scolopendra), Rainforest (sickle-jaw termites; the leafcutter mega colony), Savanna (nasute termites in a flooding storm;
the giant mantis), a relict hell-ant cave, the red-knee tarantula as a boss, and the finale at the Island's Heart against
the island's Mega Colony and its titan. Each is a level file, a map, nodes and paths in `campaign.ts`; later bosses add a
slot (`perBoss`) and a trait (`reward.trait`, `STORY.traits`: Antler Plating, Forcipule Strike, Irritating Hairs, Ambush
Reflex, Fungal Larder, the finale's cap removal); titan phases use the existing boss scripts, `phases`/`bossCuts` and
`digInto`.
