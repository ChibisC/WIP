# Story mode — "The Gene-Thief", Chapter 1

Specs: `claude/story/02-spec-gene-thief-chapter1-two-levels.md` (campaign, chapter 1), `claude/story/03-spec-story-level-maps.md`
(the two maps), `claude/maps/05-spec-layered-maps.md` (layered ground; its core is built here), the long-term plan
`claude/story/01-spec-gene-thief-campaign.md`. Inspired only by the broad Kickstarter-era idea of Empires of the
Undergrowth (a scientist following a gene-stealing queen across an island); every name, character, line, mission and
asset here is original.

## 1. Premise and the narrator

A storm carries a winged **Gene-Thief Termant** queen to **Wayfarer Island**, a remote island where ants, termites and
giant arthropods from across the world live side by side ("everything here arrived from somewhere else": currents,
storms, ships). Level by level her colony spreads inland, defeating each species it meets and absorbing its genes.

**Dr. Elena Varga** narrates. A field myrmecologist who has spent eleven years on the island, alone, cataloguing how
castaway species settle in; she keeps a field journal, and the captions are its voice: calm, curious, factual. She has
**no model** and never appears on the map: she exists only as captions (named "Dr. Elena Varga · field journal" above
them), the end-of-level quote and the journal pages. The Termants are fictional and she says so in her own words
("She is no species I know… ants are wasps' cousins, termites a kind of cockroach"). In chapter 1 the unease only
starts: by the end of level 2 she notes the colony learns too fast, and the last line hints at the island's Mega
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
- When both chapter-1 levels are won: "Chapter 1 complete — more of the island is coming soon" (end screen and hub).

## 4. Progression

- Genes are earned in the level with the existing gene-sample system; reaching the threshold unlocks the caste at once.
  **Winning keeps it** for the campaign. A level can be won without the caste (if its species is wiped out first, the
  steal objective counts as missed and the level goes on); replaying it later can steal it.
- **Slots**: one to start (`STORY.slots.start`), +1 per boss in later chapters (`STORY.slots.perBoss`, data). A slot holds
  a caste brought into a level (chapter 1: the Black Garden Ant Soldier into level 2). A caste stolen during a level can
  always be raised there without a slot.
- Every level starts with a fresh nest: the base Termant castes plus the chosen stolen castes.
- The campaign save (`ud-campaign-v1`, browser storage; memory when blocked): levels won, best medal per category,
  fastest win, fewest losses, hardest difficulty, castes kept, bosses, difficulty and loadout per level, journal pages
  (with the photograph), paths revealed. Autosaved when a level is won. It only feeds story setups: skirmish and
  multiplayer never read it.

## 5. The levels

Both are data files (`src/story/levels/garden.ts`, `fireBanks.ts`) on the format in `src/sim/story/types.ts`: map,
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

### Level 2 — "Fire on the Banks" (map `fireBanks`, 1200 × 900 mm)
Opening: the garden colony has sent out a young queen; she founds a fresh nest on the river's middle shelf (the simplest
opening that fits the story and the engine). Map: level 2 = the high bank with the fire ants' worked-soil mound and two
seed patches; level 1 = the middle shelf, the player's start at its west end, rocks for cover; level 0 = the low margin
by the river (mud and sand, the washed-up grasshopper), which floods. Ramps: a wide sand slope to the high bank (the
fire ants' main route), a root ramp at the far east end (the flank), and two ramps from the margin up to the shelf.

| Stage | Objectives | Scenes and set pieces |
|---|---|---|
| 1 Settle the bank | raise 16 ants, 2 food stores, gather 120 food | opening flight (the river → the mound → the player's start); a foraging column walks the trail from the mound to the seed patch and back, the camera following it; washed-up food and seed scatters placed |
| 2 The swarm | survive the swarm | three majors hold at the top of the wide slope in threat pose while the swarm gathers; on `swarmGo` it charges the player's nest down the slope (hold its foot), guards, then goes home |
| 3 Majors | steal the Tropical Fire Ant Major | majors and soldiers guard the two seed patches on the high bank (guard cue, 70 mm) |
| 4 The river rises | ride out the flood (100 s) | the margin floods after a 25 s warning (`floods.ts`, scripted); the pill bug and cutworm on the margin flee up the ramps first. Rafts: not built (the flood system has no floating bodies); the caption tells the fact instead |
| 5 Take the mound | kill the fire ant queen | both ramps; the flank hint; Dr. Varga's unease line |

Medals: time gold ≤ 25 min, silver ≤ 38; losses gold ≤ 40, silver ≤ 80; bonus "lose no more than 10 ants to the swarm".
The ending: the win line, then (first win of the chapter) the Mega Colony hint and "Chapter 1 complete".

## 6. The framework

- **Objective types** (`sim/story/objectives.ts`): raise, fighters, build, dig, collectFood, storeWood, killAnts,
  stealCaste, raiseCaste, killQueen, surviveTime, surviveWave, killCreature, escort, protect, reach, enterNest; each with
  a default goal text, `optional`, and latching (a met goal stays met). Chapter 1 uses raise, build, collectFood,
  storeWood, killAnts, stealCaste, raiseCaste, surviveWave, surviveTime, reach, killQueen; the rest are tested.
- **Director** (`sim/story/director.ts`): actors (a creature, a group of a colony's ants, a whole rival colony) named in
  the level and given scenes: sequences of cues — `walkTo`, `path` (+`reverse`), `holdAt` (+`face`, `anim`), `patrol`,
  `guard`, `wander`, `follow`, `anim`, `face`, `leave` (an edge point or 'nest'), `mode` (passive, aggressive, normal),
  `flee`, `charge`, `wait`, `waitFlag`, `flag`, `release`. Scenes start with a stage, at a time, or on a flag; cues set
  flags; captions, actions, camera shots and other scenes wait on flags. Walking uses the flow fields (round banks and
  walls, up ramps) and the ant and creature movement code (foot planting is the renderer's, as for any walking ant).
  Directed ants fight what they meet unless passive; a hurt creature reacts with its own program; a cue that cannot
  finish times out (`STORY.cueTimeout`) and is logged (`story.log`, `storyDebug`). Player units are never directed
  (the castaway queen of the opening is a stand-in that leaves the map).
- **Flags** the world sets: `stage:N`, `caste:<id>` (stolen), `raid:<rival>` (its war AI marches on the player),
  `dead:<rival>`, `wave:<actor>` (a wave appeared), `beaten:<actor>`, `gone:<actor>`, `flood:<zone>`.
- **Actions**: spawn an actor, flood a zone, set a flag, place food, play a shot, set the music mood, force a raid, show
  a tip.
- **Shots** (`game/cinematic.ts`): the map's opening flight, and short shots in data (keys at story points or following
  an actor), letterboxed, skippable (button or Esc), client-side only. Never more than ~10 s (the opening) or ~5 s.
- **Difficulty** (`STORY.difficulty` in `balance.ts`): enemy stats (health and damage), wave size, AI aggression,
  starting food, the rivals' head start and population cap. Easy 0.75/0.6/0.6/1.6/0.7, Normal 1, Hard
  1.2/1.35/1.3/0.85/1.25, Brutal 1.4/1.7/1.6/0.7/1.5.
- **Medals**: three per level — time and losses (gold/silver/bronze by thresholds) and the bonus (gold when achieved).
- **Rewards**: the stolen caste now; titan traits and extra slots are later data (`LevelNode.boss`, `STORY.slots`).
- **Dev**: `?story=<level>&stage=N[&ants=N]` starts a level at any stage (with extra ants); `?nocine=1` skips shots;
  `storyDebug(world)` lists each actor's members, scene and cue; `tools/playtest-story.ts` plays a level headless.

## 7. Saves, determinism, co-op

All story state is simulation state (`w.s.mode.mission.story`), driven by ticks and the seeded RNG in id order: the same
commands give the same game (tests: two runs agree, a snapshot restore mid-scene runs on identically). The camera
shots and the campaign save are client-side. Two-player co-op could share the player colony later; solo ships first.

## 8. Balance plan

Played headless by `tools/playtest-story.ts` (the colony's own AI plus a scripted "player" that builds what a stage
asks, takes rival corpses for genes, waits for an army before the assault, falls back to regroup) on every difficulty;
results in PROGRESS.md. Targets: 20–40 min on Normal for a person; the bot (weaker than a person) wins Easy and Normal.

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

## 11. Later chapters (outline, so the framework fits them)

From `01-spec`: Forest Floor (red wood ants; an escort/migration level; the stag beetle titan), Riverbank's banded hunter
(Scolopendra), Rainforest (sickle-jaw termites; the leafcutter mega colony), Savanna (nasute termites in a flooding storm;
the giant mantis), a relict hell-ant cave, the red-knee tarantula, and the finale at the Island's Heart against the
island's Mega Colony and its titan. Each is a level file, a map, nodes and paths in `campaign.ts`; bosses add a slot
(`perBoss`) and a trait (a later `reward` field); titan phases use the existing boss scripts.
