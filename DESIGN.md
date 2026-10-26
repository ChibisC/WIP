# Underground Dominion — Design Document

A 3D ant colony management / real-time strategy game. Grow a colony from a single
queen in an underground nest, build it out of hexagonal brood tiles, and command
its ant groups through five pheromone markers against rival colonies, predators and
bosses. Every creature is a real species and must look, move and behave like it.

> **Revision 2026-10-24 — change of plans.** The nest is now a flat plane seen from
> above (not a vertical cross-section). The old "chambers you expand" model is
> replaced by the **hex brood tile system**, and the old rally flags by **five
> numbered markers** commanded from a drag-and-drop **marker panel**. Sections 2,
> 3.4, 3.6, 3.7, 3.8, 3.10, 4, 5 and 6 below describe the new design. See
> `CHANGE_PLAN.md` for what was kept, refactored and replaced.

Everything (models, textures, audio) is generated in code. No downloaded assets.

---

## 1. Technology and layout

TypeScript + Three.js (r186) + Vite. Runs in any WebGL2 browser.

```
src/
  core/     game loop (fixed 20 Hz sim tick + interpolated render), time scaling,
            event bus, seeded RNG, save/load, settings, profile (mission medals)
  sim/      pure simulation, no Three.js imports:
            state.ts (SimState + entity types), colony.ts, ant AI, brood, digging,
            foraging, pheromones, flow fields, spatial hash, combat, creatures AI,
            bosses, rival-colony utility AI, species definitions
  world/    terrain heightfield + map generation, nest grid, nest generation
  render/   scenes, cameras, lighting, post-processing, procedural textures,
            materials, ant models (GPU-animated instancing), creature rigs,
            top-down nest terrain + tile floors, props, grass, effects, overlays
  ui/       DOM UI kit: top bar, nest tabs, minimaps, marker panel (drag and
            drop), build panel, in-world marker labels, menus, tooltips, settings
  modes/    sandbox, skirmish, outdoor missions
  audio/    Web Audio synthesis (sfx, ambience, adaptive music)
  game/     GameSession (input, views, the replica World), commands issued by
            the player, where the simulation runs (LocalSim / WorkerSim), replays
  worker/   the simulation Web Worker, its message protocol and frame builder
  net/      multiplayer: transports, wire format, lockstep, the running match,
            lobby, match setup
docs/creatures/   biological reference note per species (written before modelling)
tests/            headless simulation tests (vite-node)
tools/            headless screenshot harness (Playwright) for visual review
```

The sim never imports from `render/`, `ui/` or `audio/`. Those read the sim state
each frame and consume sim events from the event bus. This keeps the sim
testable headless and serializable for saves.

**Working rule (2026-10-24, multiplayer upgrade): every new gameplay system must
be deterministic and change the simulation only through commands.** That means:
- seeded `w.rng` and `sim/dmath.ts` only;
- no wall clock, no hidden module state, and no reads of UI or render state;
- every player action is a `sim/commands.ts` command.

`tools/check-determinism.ts` enforces the mechanical part in `npm test`, and the determinism test (§8) catches the rest.

## 2. Units, spaces and coordinates

* **1 world unit = 1 millimetre.** Real body sizes are used directly:
  Solenopsis worker ≈ 3 mm, Lasius worker ≈ 4 mm, Formica rufa worker ≈ 7 mm,
  Atta soldier ≈ 15 mm, wolf spider ≈ 18 mm body, stag beetle ≈ 60 mm,
  Scolopendra ≈ 200 mm. Bosses are shown at 1.2–2× real size.
* Every mobile entity lives in a **space**: the shared **surface** (space 0),
  or one of up to six **underground areas** (3.12). A colony's home nest is
  space `colony + 1`; neutral caves and lairs get spaces from 64 (`CAVE_BASE`). Positions are 2D plane coordinates `(x, y)`
  and **both spaces are horizontal planes seen from above**:
  * surface: `(x, y)` maps to world `(x, terrainHeight(x, y), y)` (y = world z);
  * nest: `(x, y)` maps to world `(x, nestFloorHeight(x, y), y)` in the nest
    scene. Undug soil is a raised plateau; ants only walk on the dug floor.
* Nest **entrances** are ramps in the nest plane that climb out of view toward the
  surface; each links to a surface hole. Ants walk into a ramp and emerge from the
  matching hole (and the reverse). Hidden **shaft sites** in the soil open a new
  surface entrance when the player digs into them (an *entrance dig*: up to 7
  workers, lowest dig priority).
* The nest hex grid's radius scales with the species (≈ 3 workers wide; see 3.7),
  so ants stay at real size while tile counts are the same for every species.

## 3. Simulation core

### 3.1 Loop
`core/loop.ts` runs the sim at a fixed **20 ticks/s**.
- In single-player the rate is scaled by game speed (0.25×–8×; at high speed several ticks run per frame, capped per frame to avoid a spiral of death).
- In multiplayer each tick runs only when every player's commands for it have arrived (lockstep, §8). The loop then waits, and keeps up to 250 ms of debt to catch up.
- The simulation runs in a Web Worker (`worker/simWorker.ts`). The main thread holds a replica World updated from the worker's per-tick frames, and renders it by interpolating each entity between its previous and current tick position and heading. Alpha comes from the time since the latest frame arrived.
- The screenshot harness (`?shot=1`), tests and `?worker=0` run the simulation in the main thread instead (`LocalSim`).

### 3.2 State (`sim/state.ts`)
`SimState` is plain data (JSON serializable). Entities reference each other by
numeric id, never by object reference.

| Collection | Contents |
|---|---|
| `colonies` | species, food, foodCap, popLimit, castes available, **tiles**, **groups**, entrances, **markers[5]**, aggression, stats, AI flag |
| `ants` | id, colony, caste, **home tile**, space, pos/prev pos, heading, speed, hp, state machine fields, carried item, grapple link, venom stacks, alarm level, crop (liquid food), age |
| `brood` | id, colony, stage (egg/larva/pupa), caste, **tile it is raised on**, progress, fed, position (nest), carrier |
| `creatures` | id, kind, pos, heading, hp, AI state, latched ant ids, phase (bosses), territory |
| `food` | id, kind (insect, seed, fruit, honeydew, leaf, corpse), amount, mass, space, pos, carriers |
| `nests` | per colony `NestGrid` (hex soil, dig designation, fine walk raster, entrance and shaft sites) |
| `phero` | surface pheromone grid: per-colony trail channel, shared alarm channel |
| `waves`, `mode` | scripted encounter state, objectives, timers |

Hot loops avoid allocation; arrays are compacted on death at the end of a tick.

### 3.3 Spatial queries
`sim/spatial.ts`: uniform spatial hash per space (cell 8 mm), rebuilt every tick
(O(n)). Used for neighbour avoidance, target search, antennation encounters,
alarm spread and grapple checks.

### 3.4 Navigation
* **Nest:** weighted shortest-path fields over the fine walk raster of the nest
  plane (`sim/flow.ts`), shared per destination: a tile type, the entrances,
  the dig frontier, or the hex an ant is heading for (it steers straight in once
  inside).
  - Nest cells only ever change from soil to air during play, so a field is *extended* from the grid's dug-cell log rather than recomputed.
  - Step costs are multiples of 1/32 and distances are exact in float32, so an extended field is bit-identical to a fresh one. Caches stay a pure function of the state, and the determinism test audits this.
  - At most 64 fields are kept per map (least recently used are dropped).
  - Ants descend the gradient. Invaders path to the queen through the real tunnel layout, so narrow tunnels become chokepoints.
* **Surface:** open ground; ants climb over litter. Water is impassable.
  A per-colony home distance field on a coarse grid (4 mm) gives path
  integration back to the nearest entrance. Marker distance fields are cached
  per marker. Local steering: separation from neighbours, wander, pheromone
  gradient sampling with three forward antennal sensors.

### 3.5 Pheromones (`sim/pheromones.ts`)
Surface grid (2 mm cells). Channels:
* **trail[colony]** — laid by foragers returning with food (strength ∝ food
  quality); evaporates exponentially; mild diffusion. Outbound foragers follow
  trail gradient weighted toward increasing home distance; inbound use the home
  field. Depleted sources stop being reinforced and their trails fade.
* **alarm** — emitted by damaged/alarmed ants, fast diffusion, fast decay.
  Ants above threshold enter the alarm response.
The nest grid has its own alarm channel for invasions.

### 3.6 Ant state machine (`sim/antAI.ts`)
`idle, groom, scout, followTrail, collect, carry, return, dig, haulSpoil, nurse,
carryBrood, tendQueen, trophallaxis, tendAphids, cutLeaf, garden,
rally, defend, attack, grapple, climb, flee, enterNest, exitNest, dead`
(co-op hauling, necrophoresis and the army-ant bivouac were removed on 2026-10-25).

**Nest jobs (Revision 2, `sim/jobs.ts`).**
- All nest work is done physically by **workers**; soldiers never take nest jobs.
- Each colony keeps a **job board**. Job types, in strict priority order:
  1. **Dig**: a marked soil hex. Up to 2 workers per hex, or up to 7 on an entrance dig, which is always the lowest-priority dig.
  2. **Build**: a planned tile. Upgrade and delete jobs are build jobs too. One worker each.
  3. **Spawn**: pull an egg from the tip of the queen's abdomen and carry it to a brood tile. One worker each.
- **Points.** Every dig, build, upgrade or delete job needs **6 completion points**. A worker adds **2 / 4 / 6 points per second** at tile level 1 / 2 / 3 (nanitics count as level 1). A thin progress ring shows over a hex while it is being worked.
- **Who takes what.** Workers in the **home column** take any job anywhere in the nest. Workers whose group is out at a marker take only jobs within their marker's radius (when that marker is in the nest).
- **On the job.** A worker ignores food and enemies until the job is finished or cancelled.
- **Reachability.** A job is reachable only if its hex touches dug floor that the worker can path to; unreachable jobs wait.
- **Cancelling.** Clicking a marked hex again cancels its job.
- **Throughput.** More workers in the home group means faster rebuilding and respawning (tooltips say so).

**Other home behaviour.**
- **Home workers stay inside (EotU; user decision 2026-10-24, §9.4-6).** With no job to do they carry floor food (seeds from refunds, dropped loads) to storage, tend gardens and rest on their tiles. Food is gathered only by groups sent to markers. The one exception is Lasius *mass recruitment*: while it runs, idle home workers pour out to forage round the nest.
- Home soldiers guard the nest.
- Ants whose group is at a marker run the **marker behaviour** instead (3.9).

Behavioural texture (required for realism): walking happens in bursts with
pauses; scouts zigzag with correlated random turns; trail followers walk
straight with antennae low; ants that meet antennate; idle ants groom
(antenna through front-leg strigil, leg rubbing); occasional trophallaxis;
workers pull eggs from the queen's abdomen and carry them to the brood tiles.

**Foraging (Phase 7).**
- **Finding food.**
  - Food is found by odour: the detection radius grows with the item's size (seeds the least).
  - Each scout leaves the nest with a heading of its own (directional persistence, biased outward). It searches for up to 110 s before giving up.
- **Memory.** A forager remembers its source (`tk`) and walks straight back to it after delivering:
  - 1 / 9: a food item;
  - 2 / 8: a leafy plant;
  - 5 / 7: an aphid colony.
  - Combat uses 3 (ant target) and 4 (creature target).
- **Trails.** Returning foragers lay trail in proportion to what is left at the source.
- **Species foraging** (`sim/speciesAI.ts`):
  - *Leafcutters* (Atta medias) also cut leaves; every caste collects ordinary food (user note). Within a marker's area they smell plants from 110 mm, cut a body-sized fragment (~3.5 s of sawing), carry it to a fungus garden and go back.
  - *Honeydew* (Lasius, Formica workers): ants stroke an aphid colony until the crop is full. A crowded colony is skipped, and a tended colony is claimed for 30 s.
  - The crop's fullness swells the rendered gaster.
- **Trophallaxis.** It has its own partner field and contact timer. Liquid foragers hand part of their crop to a resting nestmate at the store (forager → receiver).
- **Harvest (2026-10-25, replaces co-op hauling).** Each ant takes its own load from a source: its caste's carry × its level (×1, ×1.25 at level II, ×1.5 at level III, `BALANCE.levelCarry`). A small item it can lift goes whole; anything bigger shrinks as the ants harvest it.
- **Corpses (2026-10-25, replaces necrophoresis).** A dead ant falls over (0.5 s), then lies as food for **enemies only** for 2 s; a dead termite is food for any ant for 7 s. Then the body sinks into the ground (0.6 s) and is deleted. Creature carcasses are unchanged (`BALANCE.corpse`).
- **Map support.** Every nest gets an aphid-infested plant and a leafy plant within reach.
- **Respawn.** Surface food respawns toward a target *amount* (12 per 100 cm²), not an item count.

### 3.7 Colony: the hex tile system (`sim/tiles.ts`, `sim/colony.ts`, `sim/brood.ts`, `sim/balance.ts`)

All numbers below are defaults in **`sim/balance.ts`**, the single tuning file.

The nest floor is laid out on a hidden **flat-top hex grid**, shown only while placing tiles or with the grid overlay. Hex radius = 1.5 × the species' worker length, clamped to 5–11 mm. Tiles can only be placed on fully dug hexes.

**Queen's chamber**
- 7 **queen tiles**: the queen's hex and its six neighbours.
- They cannot be built, upgraded or deleted.
- Each queen tile is a **brood tile for one nanitic worker** (the queen's first brood: a smaller, weaker worker of the species) and a **food store holding 10**.
- A colony starts with the queen and **3 workers**.
- **Failsafe:** if the colony has no workers and no food, one nanitic is born for free.
- The queen only makes eggs. **Every queen of every species stays exactly where she was placed and never fights back** (2026-10-25): she takes the damage and lays until the game ends or she dies. She is immune to knockback and stuns, and her death loses the colony. The screen edges flash red while she is below 25% health.

**Tile types** (build cost / hatch cost)

| Tile | Costs | Notes |
|---|---|---|
| Worker brood | 10 / 2 | Workers, minims, medias, nanitic-sized castes. |
| Soldier brood | 25 / 5 | Formica and fire-ant majors. |
| Heavy (major) brood | 150 / 15 | Atta and Eciton soldiers. |
| Food storage | 5 | Holds **10 / 40 / 100** at levels 1 / 2 / 3. |
| **Highway** | 5 | Ants move **+10 / 20 / 25%** at levels 1 / 2 / 3. Looks like packed, worn earth. |
| Species tiles | — | Fungus garden (Atta), root-aphid pasture (Lasius), thatch (Formica), sun-warmed brood mound (Solenopsis). Same rules; per-level effects in balance.ts. |

**Placement and grouping**
- **Placing a tile creates a planned tile** (a ghost on the floor) and a build job. The food is paid when the worker completes it. If there isn't enough food then, the job waits.
- Adjacent tiles of the same type (and caste) form a **chamber**. All living ants of a brood chamber form one **control group**: one card in the marker panel, starting in the home column. Splitting a group means splitting the chamber by deleting tiles between.

**Population**
- Shown as **workers active / max** and **soldiers active / max**. Max = the brood capacity of that role's tiles; the queen is not counted.
- Per-tile capacity is 1, but balance.ts may give 2 at level 3 (fire-ant minors).
- Modes may cap the number of brood tiles.

**Spawning and egg delivery** (core loop)
1. The queen **always has an egg ready inside her** (EotU; user note 2026-10-25: "they should get eggs out of the queen no matter what"); nothing piles up beside her. Until 2026-10-25 she made one every few seconds (`eggInterval`, now unused) and spawn jobs were capped at the eggs on hand + 2, so only a couple of workers fetched eggs while brood tiles stood empty. Growth is set by the brood tiles, the workers carrying eggs and the food the larvae eat (25-minute AI economies came out within a few ants of before).
2. Every empty brood tile creates a **spawn job**, and every one gets a free home worker at once. The worker walks to the **tip of her abdomen** (EotU), takes one of five places on an arc round it, works an egg free (0.6 s, `BALANCE.eggPullSec`), and carries it in its mandibles (carry pose, head raised) along the nest paths to the tile.
3. The egg is set down in the tile's centre; the tile is **incubating**.
4. The larva grows on the tile over the caste's grow time, **only while the colony has food**. The hatch cost is drawn gradually. With no food, growth pauses and the status line reads "The colony is starving. There is not enough food to feed the new brood."
5. At 100% it hatches into an adult of the tile's caste, standing on the tile and joining its group.
6. **Pre-staging:** right after a hatch, a spawn job delivers a new egg to the same tile. That larva grows to **50% and pauses** while the tile's ant lives. When the ant dies, it resumes, so replacements come faster than a fresh spawn.
7. A tile incubates one egg or larva at a time.

Edge cases:
- If the carrier is killed, the egg drops on the floor and another worker finishes the job.
- Enemies can destroy or steal larvae; the tile then has a short cooldown.
- Deleting a tile kills its ant and drops its larva as food.

**Upgrades** (the only upgrade system)
- **Applying.** The **Upgrade tool** marks an upgrade job; a worker completes it (6 points). It costs the tile's build cost. Max level is 3.
- **Upgrade points.** A tile needs **6** to reach level 2 and **12** to reach level 3. Points come from its neighbours:
  - each adjacent tile **of the same type** adds 1 / 2 / 3 (its level);
  - each adjacent **soil/wall** hex adds 1;
  - each adjacent **highway** adds 1 / 2 / 3 (its level) to any tile;
  - a highway receives the level of every adjacent built tile.
- **Chamber shape.** Inner tiles of big chambers upgrade best. A **19-tile hexagon** (centre plus two rings) walled by soil can be taken entirely to level 3, inner tiles first (verified by test). Edge tiles of small chambers cannot.
- **Short of points.** The message reads "The workers have done all they can to prepare this brood chamber."
- **Effects**
  - **Brood tiles:** the ant's level rises: hp ×1 / 1.25 / 1.5, damage ×1 / 1.2 / 1.4, speed ×1 / 1.05 / 1.1, job speed 2 / 4 / 6. It is fully healed. Its size grows slightly and a rank pip shows on the info card. Level 3 gives a caste perk: soldiers/majors spray acid 40% farther (formicines) or stun on bite (heavies); workers carry 50% more.
  - **Storage:** 10 / 40 / 100.
  - **Highways:** 10 / 20 / 25%.
  - **Species tiles:** see balance.ts.
- **Delete tool.** It downgrades a tile one level at a time, healing its ant. At level 1 it removes the tile: the ant dies, and **two-thirds of the build cost** is dropped as seeds that workers carry to storage.

**Nest movement**
- Ants move **35% slower on any built tile**, at normal speed on bare floor, and faster on highways.
- Nest pathfinding is a **weighted Dijkstra** over the cell grid, with costs from these speed factors. Ants therefore prefer highways and walk round chambers when that is quicker.

**Tile info overlay** (toggle under Missions)
- It shows level pips, upgrade points have/need and incubation progress on every tile.
- With the Upgrade tool, hovering a tile highlights its neighbours with the points each gives.

### 3.8 Combat (`sim/combat.ts`, Phase 8)
Units: hp, damage, attack interval, armor, speed, range, mass, grip.

**Damage types**
* **Bite**: melee. Armour subtracts from each bite, floored at 30%.
* **Formic acid** (Formica, Lasius, Gene Thief): a ranged jet that mostly ignores armour (75% floor, a quarter of the armour applies).
* **Sting** (Solenopsis, Eciton): each sting adds a venom stack, up to 12. The stacks deal damage over time and expire a few seconds after the last sting.

**Grappling and attack slots** (2026-10-25 fix: ants no longer spin; `sim/slots.ts`)
* Every target exposes a ring of **attack slots**. An attacker takes the free one nearest the side it came from, walks to it and holds it; when every slot is taken it waits in an **outer ring** 1.3 body lengths out, facing the target (backing off without turning round), and looks for another target every second.
  - Ants: the legs and antennae, 3 slots (4 on an ant 1.5× the attacker's length, 8 on a queen), stored as a **world angle**, so a victim turning does not swing its grapplers round it. Within 0.35 body lengths of its slot a grappler is pulled back to it only gently, so neighbours can ease it aside.
  - Creatures: slots evenly along the body outline (a capsule per kind, one per 4.5 mm: 12 on a ground beetle) cap how many fight it at once. **Planted** (user note, 2026-10-25: "they should be planted to their ground"): a grappler stands still on the ground beside the body and never swings round with it when the creature turns or walks (`BALANCE.creatureHold`). It faces the nearest point of the body and bites while that is within 0.8 of its body length; up to 2 body lengths it steps after the body, keeping its slot; beyond that it lets go and closes in again on a free slot. A body turning into it shoves it back out to its stance. Planted grapplers are eased apart by separation so they never stack. Measured (`tools/spin-check.ts`, 24 Formica workers on each creature for 20 s): a latched ant slid 48–68 mm/s over the ground and swung 60–80°/s round a stag beetle or tarantula before; now 7–15 mm/s (shoved by the body) and under 15°/s, and under 3 mm/s on the smaller creatures.
* Creatures choose which ant to attack with a bias to the front (one straight behind counts as √2 × as far: `creatureFrontBias`), so a ring of ants does not make them swing from side to side.
* Two grapplers on opposite sides **spread-eagle** the victim. A pinned ant cannot move, takes +50% damage, and fights back at half speed.
* Two ants biting each other hold still and face each other.
* **Stable facing.** Fighters turn at most 360°/s and ignore changes under 5°; at near-zero distance they keep their heading. No wobble, no pivoting round a bite. Targets roughly ahead are preferred, and the next target is taken at once when one dies.
* **Room in a fight** (user note 2026-10-25: "fight too compact … like a guard line like EotU"; `GUARD` in balance.ts). Ants in a fight — closing in, spraying, holding a foe, or standing in a guard line — keep 1.9 × the usual separation radius from each other, friend or foe, unless one holds the other or both hold the same foe (their slots set that spacing); an ant holding a foe is eased apart from the fighters round it. Choosing a foe, each nestmate already on it counts as more distance (× 1 + 0.8 per attacker, on the squared distance), so the attackers share the foes out and a fight becomes a front of small engagements rather than one heap. Measured (`tools/fightspread.ts`, arena, 20 s): fighters within half a body of a teammate 88 → 40 % (24 v 24 Black Garden soldiers), 82 → 42 % (against Red Wood soldiers), 66 → 43 % (fire ants against wood-ant workers); distinct foes per 100 attackers 27 → 39, 17 → 41, 24 → 48. In the arena the guard line walks straight to its places from 400 mm out, so the lines form as they come in (on maps 120 mm, where rocks and water need the marker's route). Creatures are kept apart too: two living creatures closer than their radii (the ones their bites reach from) are pushed apart, teammates to 1.3 ×; foes still bite at that distance.
* **Alarm rush.** An ant with no foe in sight but alarm scent about rushes up the scent's gradient, the heading chosen on its scan tick (every 4th) and walked one tick at a time. It used to take a four-tick step on top of its own walk, so ants that had just won a fight lurched to and fro in the lingering scent (user note 2026-10-25: "a weird glitchy movement"); ants under a marker no longer chase the scent at all — they hold the marker.
* **Hitboxes** (all maths, never meshes; user note 2026-10-25): an ant is a circle (hit radius 0.45 × its length for bites, stings and sprays; a body circle 0.22 × its length for crowding); a creature is a capsule (`bodyHook.body`: half-length along its heading and a radius, per body plan) that ants approach, latch round and are pushed out of, with a bite reach from its centre; a termite queen's abdomen is a capsule too. F3 (or `?hitboxes=1`) draws them on the ground (`game/hitboxOverlay.ts`).
* **Soft separation** (`sim/separation.ts`, every other tick): ants closer than 0.8 × their body widths are pushed apart gently (capped, shared by mass); creature bodies push ants out. Grapplers on ants, hell ants holding prey, a holding sickle-jaw, the pinned and queens push but are not pushed (grapplers planted beside a creature are eased apart); climbers take no part. Swarms still squeeze through tunnels (`tools/spin-check.ts`).

**Climbing large creatures and titans** (2026-10-25; `sim/climbing.ts`, `sim/creatures/climb.ts`)
* Large creatures and every titan have **climb rails** (one per leg, from the foot up the tibia and femur to the knee, then over the body's edge) and **riding slots** on the back, authored from the creature models by `tools/climb-data.ts`.
* An ant attacking or holding on to one, with its climb ready, takes the lowest free riding slot (ants in id order), gets on the nearest leg where it meets it, climbs (1.5 s from the foot), **rides 8 s** attacking point-blank (bites, stings, acid, glue; damage × `climb.damageMul`), climbs down (1.5 s) and waits **6 s** before climbing again. All castes climb except queens and kings.
* From the first step up to the step off the ant is **untouchable**: nothing damages, flings or targets it.
* **Room by size** (user notes): a creature's back holds its area ÷ 20 mm² units; a rider takes the units of its **size class** (body up to 5 mm: 1; 7.5 mm: 2; 10 mm: 3; larger: 4). At most 32 ride at once. Ground beetle 3, wolf spider and rove beetle 2, cutworm 8, mantis 13, hogna 32, giant mantis 60, stag beetle 111, tarantula 121, scolopendra 134.
* If the creature dies every rider drops off beside it with a harmless tumble.
* The creature's small health bar (and the boss bar) shows room taken / room. F3 (or `?climbdebug=1`) draws the rails and slots.
* In the sim a climber is one transform a tick (root × rest-pose rail or slot); the renderer places it on the **animated** leg or back.

**Large enemies**
* Large enemies sweep and slam with area damage and knockback: ants are flung on ballistic arcs and stagger on landing.
* They can shake off latched ants.
* They turn at a limited rate and never toward an ant latched beside them or riding them (turning toward the ring round it would only spin it); those are bitten where they are or shaken off. Long bodies turn more slowly whatever they do (`maxTurn`: Lithobius 2.5, Scolopendra 1.8, the cutworm 1.2 rad/s).

**Alarm**
* On the surface, damage leaves alarm pheromone. Alarmed ants open their mandibles, raise their gasters and run up the alarm gradient.
* Inside a nest, alarm spreads ant to ant: full alarm within 90 mm of an intruder.

**Aggression toggle** (marker panel)
* *Attack*: ants engage any enemy they detect.
* *Defend only*: outside the home nest, unalarmed ants ignore enemies unless touched.

**Nest invasions**
* **Getting in.** A group sent to a marker in another colony's nest crosses the surface along that colony's own way-home flow field, walks down its ramp, and paths through the tunnels to the marker.
* **Brood raids.** Raiding workers with nothing to fight carry off enemy eggs, larvae and pupae as food (`stats.stolen`).
* **Defence.** While enemies are inside (`World.intruders`, refreshed each second):
  - home soldiers and workers within 70 mm converge on the nearest intruder, so tunnels become chokepoints;
  - the **nest alarm** (`colony.alarmT`, 25 s) calls home-column foragers back from the surface;
  - workers not needed at the fight close in round the queen;
  - nurses keep to the brood.
  - Groups out at markers keep the player's orders.
* **Queens.** Queens are much tougher (500–1200 hp, armour 3–5), so a scouting party cannot assassinate one. They never move or fight back.
* **Kings** (termites and Termants; user note 2026-10-25) are never targeted by ants or creatures, take no damage at all, bite weakly (half a baseline worker's bite for the termite kings, 1 per 1.2 s for the Termant king) and die the moment their queen does (antAI.killAnt); intruders go for the queen. A termite king stands beside her, a separate body, and bites intruders in the royal chamber.
* **Losing the queen.** Queen death loses the colony (toggle in sandbox). A fallen nest's brood lies uncared for for 90 s.

**Safety net.** An ant pushed into solid soil (e.g. a grapple beside a wall) is eased out to the nearest open floor.

**Effects** (`render/game/combatFx.ts`, one particle pool per scene, driven by events):
* bites throw flecks of hemolymph and grit;
* stings give a hot flash and venom droplets;
* acid is a fan of fine droplets from gaster to target, then a faint mist;
* a thrown ant raises a dust puff;
* creatures: a dying creature raises dust; a boss slam throws a dust ring; the tarantula's hairs drift as a tawny cloud;
* **telegraphs**: a boss's wind-up draws a red ground circle or cone that fills until the strike lands, so you can pull your ants out.

**Tools:**
* `tools/battle.ts`: equal-cost matchups.
* `tools/raid.ts`: a party raids a rival nest grown by the builder brain.
* Dev URL `?battle=formica_major:6,fire_minor:30` stages a fight; add `&raid=1` to raid the rival nest instead.

### 3.9 Markers and command (`sim/markers.ts`)

Each colony has **five pheromone markers I–V** (gold, green, teal, purple,
red). A marker is either unplaced or placed at a point in the nest or on the
surface. Every nest group is assigned to the **home** column or to one marker.

* Placing a marker sends every group assigned to it there as a swarm (nest flow
  fields / surface steering and trails). Around the marker, **workers** collect
  and haul food found within its radius and come back to it after delivering;
  **soldiers** hold the area and engage enemies (subject to the aggression
  toggle). Assigned ants that die are replaced on their tiles and rejoin.
* Moving a group to another column redirects its ants immediately.
* Removing a marker sends its ants home to their tiles; the groups stay in that
  column so re-placing the marker sends them out again.
* **Recall** sends every group back to the home column. The species ability
  button triggers the species power (Phase 10).
* The marker's in-world icon shows the number of ants currently assigned.
* **A marker placed on a surface entrance** sends its groups down that entrance into its underground area (3.12). There they gather near the ramp and can be given markers inside the area. Ants keep their group wherever they are, and every group stays controllable from the marker panel.
* **Guard line** (`sim/guardLine.ts`; user note 2026-10-25). On the surface, the fighters at a marker that are not gathering there — every unit in the battle arena, elsewhere the castes that do not forage or a group told not to gather — stand in rows across the marker instead of milling: places 1.35 × the largest body apart, rows 1.25 × it behind one another and staggered, about √(5n) to a row (24 ants: 2 rows of 12), by id order. The front faces the nearest enemy within 120 mm (looked for every second) and keeps that facing once the enemy is gone; a new front must differ by 0.5 rad before the line wheels; with no enemy ever seen it faces away from the nest (the arena: the field centre). The facing is marker state (`MarkerSlot.face`). An ant walks back to its place only when pushed 0.6 body lengths off it. Fights start from the line as before and the fighters come back to their places after. Termite soldiers keep their own escort ring / majors' line / sickle-jaw rows, and army-ant Soldiers their trail posts.
* **Marker orders** (user note 2026-10-25, "like EotU"): three toggles under each marker in the marker panel — and under the Home column, for the nest-job groups (`Colony.homeOrders`, marker −1) — through the command `markerOrder` (multiplayer, replays and saves carry them). At home, no attacking leaves even intruders alone unless they bite, and no gathering stops the hauling of food on the nest floor to the stores (and Lasius mass recruitment) — at a marker: **no attacking** — they go after no enemy (no scan, no alarm rush, no new target when a fight ends) and only bite back when bitten; **no gathering** — they pick up no food, carry off no brood, and hold the marker in a guard line; **no climbing** — they fight big creatures from the ground. A struck-through red icon shows an order that is on. The AI does not use them.

### 3.10 Creatures and bosses (`sim/creatures/`)
One behaviour module per species following its real hunting style:
ambush (mantis, antlion pit), stalk-and-pounce (wolf spider), active pursuit
(carabid, centipede, rove beetle), passive (aphids, woodlice — pill bugs roll
into a ball when attacked), colony (termites). Predators hold territory and
flee below a health threshold. Bosses run scripted phases with telegraphed
attacks (wind-up pose + ground marker before each big attack).

**Rendering** (`render/creatures/`, Phase 11):
- Every creature is built each frame from three shared instanced primitives: ellipsoids (segments, heads, eyes), tapered tubes (legs, antennae, jaws) and cones (fangs, claws, spines). Each instance has its own colour and surface (roughness, gloss, and a pattern drawn in the shape's own coordinates: segment rings, hair, elytra striae, speckle, wing veins, Scolopendra rear bands, the antlion's funnel). So the whole bestiary is three draw calls per scene.
- `builders.ts` holds one body plan per kind, from the reference notes in `docs/creatures/` (proportions as fractions of body length). `rig.ts` poses them: a base frame tilted to the ground, two-bone IK legs with tarsi along the ground, and tripod, tetrapod and wave gaits.
- `creatureRenderer.ts` keeps per-creature animation state: the gait phase advances with the distance walked (slow walkers take shorter, quicker steps so planted feet hold still), and the caterpillar and centipedes keep a trail of head positions their segments follow. Off-screen creatures are culled; tiny ones are drawn as a single blob.
- States have poses: rolling, curling, tail-raising, rearing, flicking hairs, coiling, swaying and striking; the dead lie on their backs with legs drawn up and shrink as they are eaten. A bitten creature flashes.
- A boss in view gets a health bar with its phase; boss footfalls shake the camera.
- `?scene=crlab&kinds=…&state=…&st=…&walk=…` shows models in any state; `tools/crsheet.py` makes contact sheets.
- **Climbing riders** (2026-10-25): builders record each climbable leg's joints and the body frames as they pose (`Rig.recLeg`, `Rig.recFrame`); `CreatureRenderer.mountPose` puts a climbing ant on the animated leg (pitched along it, belly to the leg) or a rider on its slot on the animated back with a slight sway. Creatures are drawn before ants for this.

### 3.11 Rival AI (`sim/colonyAI.ts` builder and forager, `sim/warAI.ts` war)
Rival colonies run the full simulation with the same tiles, groups and markers.

**Builder brain (done).** It runs every 2 s for each colony with `ai: true`:
- **Dig (EotU-style chambers, 2026-10-25).** When the free floor in its rooms runs low, it plans a **7-hex chamber** (a centre and its six neighbours, like the queen's chamber) in solid soil 4–7 hexes from the other rooms, walled off by a hex of soil and joined to the nest by a **1–4 hex tunnel**; brood chambers by default, a **store chamber** for food tiles when stores lag. It keeps 3–16 of the planned hexes designated, tunnels first. Tunnels stay clear of tiles; brood goes in brood chambers and stores in store chambers, so each room becomes one group.
- **Build**, at most one tile per think, in this order:
  1. a food store when food is ≥ 80 % of capacity;
  2. species specials up to their share: aphid pastures 1 per 10 brood tiles, thatch 1 per 9, fire-ant brood mounds 1 per 8, fungus gardens 1 + leaf-workers ÷ 6;
  3. a brood tile for the caste furthest below the species mix.

  Stores and specials are planned one at a time: a plan only helps once it is built, and piling plans up used to stall Formica and Atta colonies at their starting size.
- **Brood rules.**
  - Fighters wait until there are 12 workers, as in real incipient colonies.
  - It saves up for a caste that is ≥ 2 tiles behind; otherwise it takes the best affordable one.
  - It only builds when the colony can also pay to raise the ant, at most one tile is still empty, and brood is not backed up beyond what the nurses can handle.
- **Groups.** They grow to 8 tiles; new groups start one hex away so the colony has several commandable groups.

`tools/econ.ts` runs this brain on one colony for N minutes and prints growth.

**Measured growth** (900 mm map, steady play; before Revision 2 — with EotU foraging through markers and soldier castes, Lasius reached 98 and red wood ants 60 at 24 min):

| Species | 10 min | 20 min | 30 min |
|---|---|---|---|
| Lasius | 36 | 91 | 187 |
| Red wood ant | 35 | 95 | 182 |
| Atta | 40 | 91 | 183 |
| Fire ant | 38 | 78 | 136 |
| Gene Thief | 25 | 55 | 102 |

The default population limit is 300.

**Forage brain (Revision 2, done).** Every 5 s the AI keeps marker I on the richest food source within 420 mm of its nest (loose food; leaves for leafcutters while the garden is hungry; aphids for tenders), re-chosen every 25 s or when it runs dry. **The queen's group and about a third of the workers always stay home on nest jobs** (2026-10-25: pulling eggs, nursing, storing, digging; whole groups, lowest ids first, without overshooting much past a third); the other worker groups forage there, and gardener groups stay home. Only a founding colony whose sole workers are the queen's own sends them out, while food is under 10, until it has about 45. When intruders are in the nest it lifts the marker so the foragers run home. Growth is a little slower than before (Lasius 23.7 ants at 10 min, mean of three seeds).

**War brain (Phase 12, `sim/warAI.ts`).** Every 4 s, for each colony with `ai: true` (rivals, and a dropped multiplayer player's colony):
- **Defend.** The nearest threat — enemy ants or hostile creatures inside the nest, or within 90 mm of a surface entrance — gets marker II, and every fighter group (soldier and major castes) goes there. After 12 s clear the marker is lifted and the groups go home. A threat inside the nest calls off a raid.
- **Raid.** After the opening peace (8 min), with at least 10 fighters, it picks the rival with the weakest defence for its distance. Fighting weight is health × damage rate, acid included. It raids when its own weight is 1.8 × the target's, divided by `settings.aggression`. Marker III goes on the target queen and follows her; the fighter groups go.
- **Call off.** The raid ends when the rival has fallen, when 60 % of the fighters it set out with are dead, or after 4 min. Then there is a 150 s cooldown (half after a win).
- Workers keep foraging on marker I and the queen's group stays home.
- `tools/ecology.ts` runs four AI colonies. Typically the strongest raids the weakest from about 8 min; a well-grown colony can beat off a raid.
- The tuning lives in `BALANCE.aiWar`.

### 3.11b Species specials (Phase 12)
- **Black garden ant (Lasius):** tends aphids on the surface; root-aphid pastures in the nest trickle honeydew.
- **Red wood ant (Formica):** acid (opener sprays; mortar and rapid sprayers). Thatch stores warm the nest, so brood grows faster.
- **Leafcutter (Atta):** cuts leaves, with minims riding on them as hitchhikers. Fungus gardens turn the leaves into food.
- **Tropical fire ant (Solenopsis):** venom. A mound with no central entrance: the nest's tunnel surfaces about 70 mm away, and the mound is drawn on the surface as a dome of worked soil that grows with the colony; ants walk over it.
  - The **sun-warmed brood mound** tile speeds brood by 8 / 12 / 16 % per tile by day, a quarter of that at night. In the nest, brood is shown piled on it by day.
  - Thatch and mound bonuses together are capped at +50 %.
- **Gene Thief:** brood tiles for the castes it borrowed.

### 3.11c New species: Nasute Termites, hell ants, Saiy-Ants, Sickle-Jaw Termites (2026-10-25)
Three playable, AI-usable colonies, built from the user's design packages (kept in the project "Ant game": `claude/nasute-termites/`, `claude/hell-ants/`, `claude/saiy-ants/`). Every number is in `sim/balance.ts` (`NASUTE`, `BALANCE.snap`, `BALANCE.surge`, the caste rows); visual-only state is derived in the render layer and never feeds back into the sim. Existing species are unchanged: their snapshots and hashes are identical (new optional fields are skipped when undefined, wood only spawns in games with termites).

**Where each concept lives**

| Concept | Code |
|---|---|
| Species, castes, display names | `sim/species.ts` (`nasutitermes`, `hell`, `aurimyrmex`; `SPECIES_DISPLAY_NAME`, `isTermiteSpecies`, `resourceName`) |
| Brood costs and times | `BALANCE.castes` (resolved from the multipliers, comments keep them) |
| Termite combat, king, positioning, idle life | `sim/termites.ts` |
| Wood (food kind `wood`), who eats what | `sim/diet.ts`, `sim/mapGen.ts` (`placeWood`, `spawnWood`), chewing in `sim/antAI.ts` |
| Hell-ant snap | `sim/hellAnts.ts` (states `AS.Hunt / Snap / Hold`) |
| Sickle-jaw grab-and-squirt | `sim/sickleJaws.ts` (reuses `AS.Snap` for the lunge and `AS.Hold`; `heldBy` on the victim) |
| Leaf litter (food kind `wood`, `from: 'litter'`) | `sim/mapGen.ts` (`placeLitter`, `spawnLitter`), `sim/diet.ts` (`isLitter`) |
| Gold surge | `sim/surge.ts`, command `surgeGroup` (type 16) |
| Abilities | `sim/abilities.ts` (Drumming Alarm, Ambush, Second Wind) |
| AI | `sim/colonyAI.ts` (mix, soldier-first termite foraging), `sim/warAI.ts` (the ramp counts in fighter weight) |
| Termite models and animation | `render/termite/` (the user's model kit, copied verbatim) + `termiteLayer.ts` (game glue) |
| Hell-ant and Saiy-Ant models | `render/ants/hellBuilder.ts`, `hellMorphs.ts`, `saiyHair.ts`, `saiyMorphs.ts`; shader in `antMaterial.ts` (`aE`, vertical mandibles, gold, hair) |
| Sim → render hints | `game/antViews.ts` (`speciesExtras`, `hellPosture`, `termiteBroodToView`, glue on targets) |
| Effects and sounds | `render/game/combatFx.ts` (snap, glue burst, headbang, surge, gold sparks, speed lines), `audio/gameAudio.ts` |

#### Nasute Termites (*Nasutitermes corniger*) — reference `docs/creatures/nasutitermes.md`
- **Castes.** Worker (4.2 mm, model kit v2.2: small and round with a pale-straw domed head, unlike the sickle-jaw worker; drawn 3.9 / 4.5 mm by `hash(id) & 1`, females +10 % health), nasute soldier (5 mm, ranged), major soldier (6.5 mm, melee, a game caste), king (8.4 mm) and queen (25.4 mm, 22 of them physogastric abdomen; immobile). The royals' lengths, abdomen and egg-lay point come from the model kit (v2.1) through the generated `sim/termiteRoyalData.ts` (`tools/termite-royal-data.ts`; `tests/royals.ts` fails if it is stale). Ratio 80 / 15 / 5. Termites are slower than ants (× 0.75–0.85) and prefer walls (nest cells beside soil cost × 0.9).
- **Wood.** Termites eat only wood; ants never eat it; ants eat termite corpses (× 0.7 / 0.7 / 2 / 3 / 6 of the baseline worker corpse). Deadwood (twig 10, branch 40, bamboo 60, palm frond 30, log 150, stump 300) is placed only on maps that have a termite colony (and the sandbox), at least two twigs or branches near each termite nest, and falls again on the food schedule while termites live. Workers chew 4 bites × 0.3 s per fragment of 3 wood (calibrated, below) at slots round the source.
- **Royal chamber.** The queen's seven-tile chamber holds the queen and the king, two separate bodies. One queen per colony (the user's call, 2026-10-25). She lies along the chamber's long axis (centre hex to the middle of an edge), her body centred on it. Her abdomen is a solid capsule: separation pushes everyone fully out of it and the nest paths cost × 4 through it, so workers walk round her. Egg pullers stand on an arc around her tip, at the kit's `Bone.EGG_LAY` point (+ the egg's 0.75 mm slide); the render shows the egg sliding out as the worker pulls (QUEEN `stateT`). Workers groom her beside her abdomen and feed her at her head. The king stands beside the front third of her abdomen, parallel to her, just clear of her (`NASUTE.royals`), and holds his place (separation does not move him there); the render plays the kit's ATTEND with his head turned to her, and a slow WALK when he repositions. He is leashed to the chamber, ignores markers, takes no damage while the queen lives, is never targeted (2026-10-25: intruders go for the queen), bites only intruders inside the chamber and dies with her. The egg loop is the ants' (no pupa); soldier brood shows a pale presoldier for the last 25 % of growth (render only).
- **The nasute's ramp** (the user's values, exact). State on the ant: `rampN` (firing ticks on this target), `rampG` (grace ticks), the target. Each tick, in id order: if the target is alive, in range (25 mm, centre to edge), in sight and the nasute is planted and not disabled, it deals `total(n+1) − total(n)` and `rampN += 1`; otherwise `rampG += 1`, the ramp is held, and after 0.5 s (more than 10 ticks) it resets and the target is dropped. A new target resets at once. Sticky targeting; acquisition = nearest in range and sight, ties by lowest id. Pure damage (ignores armour).
  - `total(n) = (s·n + (c − s)·n² / 2R) / H` for n ≤ R, then `+ c·(n − R) / H`, with s = 2, c = 20 HP/s, R = 120 ticks (6 s), H = 20. Tests: 66 HP after 6 s, 146 after 10 s, 32 for 3 s + 0.4 s gap + 1 s, 23 for a 0.6 s gap.
  - Line of sight is a ray march over the walkable map (the game had no LOS system).
  - Keep distance: with an enemy closer than 1.5 body lengths and a friendly major within 6, it steps back behind the major; otherwise it holds and keeps firing.
- **Major soldier.** Charge (× 1.6 for up to 1.5 s when the target is within 4 body lengths but out of reach, cooldown 4 s); ram with normal, armour-respecting damage; glue burst on contact (root 1 s, half on targets ≥ 8 mass / 20 mm, cooldown 6 s, no re-root for 2 s after a hold); drumming alarm when hurt or engaging (12 body lengths, 8 s, cooldown 3 s): alerted idle soldiers go to the alarm, ants on a player's marker keep their orders. At home majors hold the entrance chokes.
- **Workers fight and soldiers gather like ants** (the user's note, 2026-10-25): workers attack like ant workers (no more last-resort-only bites, no falling back on the alarm), and nasute and major soldiers forage at a marker on food like ant soldiers (carry 2 / 3). With nothing to do in the nest they groom the queen or a larva, or feed a soldier, the king or the queen for 2–4 s (no economic effect).
- **Markers** (the game's five markers are generic: a group goes where its marker is and works / fights there):

| Marker use | Workers | Nasute soldiers | Major soldiers |
|---|---|---|---|
| Gather (a marker on wood) | chew the sources round the marker | gather with the workers; on a marker with no food in reach: escort ring, marker radius + 3 body lengths, evenly spaced by id, facing out | gather; with no food: the marker front (away from the nest, or toward a known threat) |
| Attack (a marker on enemies or a nest) | follow and bite only when bitten | fire from range; with majors and a known threat, a line 2 body lengths behind them | charge, glue burst, front line |
| Defend (a marker at home or a choke) | — | ring / line behind the majors | hold the line at the marker front |
| Recall | home | home | home |
| King, queen | ignore markers | | |

- **AI.** Brood mix 80 / 15 / 5 (soldiers 20 %, 3 nasutes per major), workers first. Soldier-first foraging: a nasute escort (at least 2 soldiers) scouts each new wood source under marker IV; once it has held it 3 s with no enemy within 60 mm, marker I moves there and the workers follow, the nasutes staying as their ring; when enemies have been seen there in the last 30 s a major group joins the column. Nest defence and raids use the shared war AI (the ramp counts at its mean, 11 HP/s, in fighter weight).
- **Balance notes.** Wood income: `tools/termite-income.ts` (AI colonies, three seeds, 8 min) gives a median of 1.53 wood per worker-minute against Lasius' 1.61 food (× 0.95; one Lasius seed starved and is left out of the mean). One nasute beats one Lasius soldier (44 HP, bite 5) only with about 3 s of uninterrupted fire before contact (`tools/nasute-duel.ts`: it loses with ≤ 2.6 s, wins with ≥ 3.6 s).
- **Simplifications.** One queen and one king (polygyny and replacement reproductives are documented in the reference only); no push priority (the game has no body-push system, so majors "hold" a choke by standing in it); covered galleries (phase 9b) were cut — they would need a new surface-structure and targeting system; far termites use the kit's LOD2 mesh rather than its baked impostors (the LOD2 mesh is ~290 triangles); glue on creatures is not drawn.

#### Hell ants (Haidomyrmecinae, extinct) — reference `docs/creatures/hell-ant.md`
- Worker 5 mm (pin), soldier 6.5 mm (impale, a game caste), queen 7.6 mm. Hunters more than gatherers; slow breeding. Ability **Ambush**: every snap ready at once, and for 15 s it recharges straight after each catch (cooldown 80 s).
- **The snap** (`sim/hellAnts.ts`): `Attack → Hunt` when small prey (ants up to the caste's `maxPreyMass`, latchable creatures up to 12 mm, never bosses, queens or the termite king) is within 0.9 body lengths of its edge and the snap is ready. **Hunt**: creep in at × 0.35 with the jaws cocked; after the wind-up (0.6 / 0.8 s) and within 0.5 body lengths it **Snaps** (2 ticks). **Hold**: the prey is pinned at the jaw–horn socket (0.5 body lengths ahead, lifted off the ground in the render), stunned, bled every 0.5 s (3.5 / 2 HP/s) and stung (slowed 2 s); soldiers first drive it onto the paddle for a 14 HP burst. Release: hold over (4 / 3 s), the prey dead (after 0.8 s of feeding), the hell ant hurt, stunned, pinned or flung (half cooldown), or the space changed; the prey is dropped dazed (0.4 s). Cooldown 5 / 7 s. Larger prey is grappled by the legs as usual; a grappling hell ant whose snap comes ready on small prey lets go and stalks it again. Snap states count as fighting everywhere (task allocation, markers, jobs).
- **Presentation only:** the jaws close instantly (mandible easing × 60); an impale throws pale droplets and, when the camera is closer than 60 mm, jolts the camera and holds the picture back 0.08 s (single player only; the sim is untouched).
- **Simplifications.** A held creature is pinned in place but not drawn lifted (the creature renderers have no lift).

#### Melee attack animations (all ants and termites; `render/ants/attackPoses.ts`)
- Inspired by *Empires of the Undergrowth*, where an attack plays once per attack (attack speed = attacks per second) and special attacks reuse the basic attack's animation, so every attack lands on the same beat. Each biting unit cycles through **three attacks of exactly one attack interval each**, the jaws closing at the same point (`ATTACK_CONTACT` = 0.7 of the cycle) in all three:
  1. **lunge bite** — draw back with the jaws agape, thrust forward 0.12 body lengths, snap;
  2. **rear-up chomp** — rear up on the hind legs (the threat display), crash down onto the target and chomp;
  3. **side clamp and tug** — twist and clamp from one side, then pull back (the tug of war over a held leg); the side alternates.
- Render only: `game/antViews.ts` reads the phase from the unit's bite cooldown. The cooldown is reset to the next gap on the tick the bite lands, so that jump gives the gap (jitter, frenzy and gold surge included) and the contact falls exactly on the damage tick. The next attack is chosen at each new cycle, never the same twice running (half the units go round the other way).
- Ants: body lunge / rear / twist on the instance frame (rearing keeps the hind legs planted), head pitch and yaw, mandibles (horizontal jaws, or the hell ants' vertical snap). Termites (workers, majors, the king): the same body motions around the kit's BITE / RAM, whose peak is phased onto the contact. Ranged units (nasutes, Formica sprayers) and the hell-ant snap keep their own animations.
- Lab: `?scene=antlab&ants=…&atk=0..1&atkvar=0|1|2&atkside=±1`; sheets in `docs/creatures/attack-renders/` (`tests/browser/attack_renders.py`).

#### Saiy-Ants (*Aurimyrmex fulgurans*, fictional) — reference `docs/creatures/aurimyrmex-fulgurans.md`
- A formicine body plan, worker 6 / soldier 9 / queen 14 mm, fighting with **bites only** (no sting and, by the user's decision, no formic acid: pure physical damage), glossy jet black with six swept-back hair locks grown from the head mesh (an original design, not modelled on any character's hairstyle). The display name comes from one value (`SPECIES_DISPLAY_NAME.aurimyrmex`, fallback "Gilded Ants").
- **Gold surge** (`sim/surge.ts`): `surgeT` (seconds left) and `surgeCd` on the ant. On entering combat (or by the group's **Gold Surge** button → command `surgeGroup`, so it works in multiplayer) a ready ant turns gold for 4 s (5 s from tile level 3): speed × 1.5, damage × 1.6, attack rate × 1.25; then 20 s of recovery (14 s from level 2), looking dull with drooping antennae and flattened locks. The queen never transforms. Ability **Second Wind** resets every recovery (cooldown 75 s).
- **Render:** gold ripples in from the locks with a small overshoot and out from the gaster; the locks stretch × 1.3 along their own direction, sway on a 2 Hz spring when the ant turns, flutter when it runs; far away the impostor turns gold too; surge sparkles, gold bite sparks and speed lines off the lock tips (close camera only, at most 200 ants); the head never pitches below −0.3 rad so the low lock stays clear of the thorax.

#### Sickle-Jaw Termites (*Rhynchotermes perarmatus*) — reference `docs/creatures/rhynchotermes-perarmatus.md`
Built from the user's package `claude/sickle-jaw-termites/` (model kit v2.1, used as built). Species id `rhynchotermes`, castes `rhy_worker`, `rhy_soldier`, `rhy_king`, `rhy_queen` (the kit's caste ids; sim morphs `termite_<caste>`). All numbers live in `SICKLE` (`sim/balance.ts`); the castes' stats are resolved from its multipliers × the baseline Lasius worker (16 HP, 16 mm/s), with the multiplier kept in a comment.

- **Castes.** Worker 5.8 mm (larger than the soldier; 12 HP, × 0.8 speed), soldier ("Sickle-jaw", 4.5 mm, 12.8 HP, × 0.9 speed), king 8.5 mm and queen (the kit models, sizes through `sim/termiteRoyalData.ts` like the Nasute royals). Brood mix 82 / 18; soldier brood costs × 2 and takes × 1.4 as long, paid in plant matter, and shows the pale presoldier for the last 25 %. Royals, the chamber, eggs, the king's guard and death work exactly as for the Nasute Termites (one queen; she is lost, the colony is lost).
- **Food: leaf litter.** A new source kind beside deadwood: food kind `wood` (the plant-matter store shared with the Nasute Termites), `from: 'litter'`, 25 units a patch. Placed from their own RNG stream on maps with a Sickle-Jaw colony (4 per colony, at least 6, two of them 35–60 mm from each Sickle-Jaw nest), 60 % near plant bases and the rest in the open, and topped up on the food schedule while a Sickle-Jaw colony lives. Workers chew 3 bites × 0.3 s per fragment of 1 unit (`litterchip`, drawn as a leaf scrap) and also eat deadwood; Nasute Termites stay on wood; ants never eat plant matter. Corpses as food for ants: × 0.75 / 0.7 / 3 / 6 (worker / soldier / king / queen).
- **Termites fight and gather like ants** (user note 2026-10-25): workers bite like ant workers (0.87 DPS), soldiers forage at a marker on food (carry 2).

**The grab-and-squirt** (`sim/sickleJaws.ts`). State on the soldier: the target in `tgt` / `tk`, the hold in `holdId` / `holdKind` (shared with the hell ants), squirt ticks `rampN`, the free target's id `rampT`, the miss cooldown `snapCd`, the alarm cooldown `alCd`; on the victim `heldBy` (ants) or `data.heldBy` (creatures). All in the snapshot and hash.

1. **Acquire.** From Attack (`combat.attackUpdate`, after the climbing check): a target is *grabbable* if it is an enemy ant or a latchable creature no longer than 2 × the soldier, not a boss, queen or termite king, not held, and not being lunged at by another soldier this tick (a per-tick map on `World.tickCache`; ants update in id order, so the lowest id wins and the other drops the target and takes another). Within 0.6 of its body length (centre to edge: just past its nasus tip; the spec's 1 body length made it grab from too far, user note 2026-10-25) and with the miss cooldown over, it starts the **lunge** (`AS.Snap`); otherwise it closes in.
2. **Lunge.** The grab resolves `round(0.58 × 0.55 s × 20)` = **6 ticks** in (the kit's `LUNGE_SNAP` × `LUNGE_SEC`). Hooked if the target is alive, free and within 0.85 body lengths: a 3-damage bite, the victim's `heldBy` is set, its target cleared, `grab` event, the colony alarm. Otherwise a **miss**: `grabMiss`, back to Attack with a 1 s cooldown.
3. **Hold** (`AS.Hold`). Every tick the victim is pinned with its front in the crossed mandible tips (`SICKLE_SOCKET` from the kit, scaled to the soldier: the socket distance plus the victim's half length), facing the soldier, speed 0 and stunned (so it cannot move, attack or obey orders), and takes the ramp's acid; the soldier is planted (no orders, not pushed by separation, not flung, never releases when hurt). **It ends only when** the victim dies (the soldier drops the corpse, the ramp resets, it takes the next target; `grabRelease` 'victimDied') or the soldier dies (`termites.onTermiteDied` → `holderDied`; the victim is free the next tick: `hellAnts.isHeld` checks the holder; 'holderDied'). Allies free a victim only by killing the soldier.
4. **Free target** (too big to grab, or a boss): at contact range (0.45 body lengths, edge distance: the nasus touching it; 0.7 once squirting, so small shoves don't break it) it squirts with the same ramp and bites (3) once a second; the ramp resets on any tick the target is out of range or a new target is taken; the target moves and fights back as usual. The jet is drawn to the near side of its body, a short point-blank squirt.
5. **The ramp** (pure damage, ignores armour; each soldier ramps on its own): with R = 6 s × 20, s = 2, c = 18 HP/s, H = 20,
   `total(n) = (s·n + (c − s)·n² / 2R) / H` for n ≤ R, then `total(R) + c·(n − R) / H`; the tick deals `total(n + 1) − total(n)`, rounded to 1/1024 HP so the sums are exact. 18 / 60 / 132 HP after 3 / 6 / 10 s; a 90 HP victim dies on squirt tick 150.

- **Alarm** (`sickleAlarm`, cooldown 3 s): a Sickle-Jaw termite hurt, or a soldier grabbing, alerts the colony's termites within 12 body lengths for 8 s; idle or automatic soldiers rush there with the mandibles open (render RUSH); units on a player's marker keep their orders; the alarming termite drums (render ALARM, the `headbang` event).
- **Markers.**

| Marker use | Workers | Soldiers |
|---|---|---|
| Gather (a marker on leaf litter or wood) | chew the sources round the marker, open columns | half of them (the lowest ids; all of them when there is no food in reach) form **Eisner's defensive row** along the route the workers really walk: the colony's home flow field traced from the marker to the nest (`sickleTrail`, refreshed every 2 s), guards on both sides 3.5 soldier lengths (16 mm) out, spread evenly over the whole route (at least 1.6 lengths apart, further rows 1.6 lengths out when they don't fit), a post on rock or water moved in toward the route, facing outward (THREAT); they walk to far posts along the route. The others gather. Guards engage only enemies within 3 body lengths. (User notes 2026-10-25: the row was one thin straight line the workers walked outside, spare soldiers piled up at the entrance, and they fought from too far.) |
| Attack | follow and fight like ant workers | advance; lunge at grabbable enemies one by one; bite and squirt the big ones |
| Defend | — | the row (in the nest: a ring round the marker); rush on the alarm |
| Recall | home | home (a holding soldier finishes its hold first: holds ignore orders) |
| King, queen | ignore markers | |

- **AI** (same command path as players): brood mix 82 / 18, workers first; open foraging columns with soldiers in the row; in defence the soldiers lock attackers down one by one but **commit at most 60 % of the soldiers within 12 body lengths to holds and keep 2 free** (`mayCommit`; the others bite and squirt and turn on whoever attacks a holder). Raids and nest defence use the shared war AI.
- **Rendering** (`render/termite/termiteLayer.ts` with the kit's `TermiteInstances`, sim hints from `game/antViews.ts`): Snap → the kit's LUNGE on the renderer's own clock from the lunge start (LUNGE until stateT ≥ 0.74, then HOLD with blend 0); in the hold `solveHoldOnVictim` places the head and the jet aim every frame, the jet is `GlueStreams` with `ACID_STREAM` from the nasus tip to the hit point (thickening with the ramp) and `AcidFizz` sits on the victim; free targets use `solveFreeSquirt` (aim clamped to ± 0.4 rad, cached every 4 frames). Held termites play STRUGGLE with acid on an `fxShell` herd; held ants flail (`victimStruggle` mapped onto the ant fields) with acid drawn by the ant glue shell (`max(glue, acid)`). Escort THREAT, alarm ALARM / RUSH, carried leaf scraps `Carry.LEAF`, the rhy larva and presoldier for brood. The nest is dark damp soil (the nest shader's `uCarton` 2, a port of the kit's `createDampSoilMaterial` look: crumbly walls, glossy wet patches, a darker trodden floor, dense soil brood cells) and leaf-litter patches use the kit's `buildLeafLitterGeometry` / `createLeafLitterMaterial`.
- **Sound:** a grab plays the game's jaw snap and a struggle, a miss a dry mandible click, the alarm the shared termite drumming (`headbang`); the nearest three holds within earshot get the kit's `SickleJawAudio` voices on the combat bus (`acidStream` pulsing faster with the ramp, `acidFizz`, `victimStruggle` by the victim's health).

**Balance notes** (`tools/sickle-calibrate.ts`, `tools/termite-income.ts`):
- The spec's "6–8 s to kill a baseline worker" assumed a 90 HP worker (the ramp kills 90 HP on tick 150, as the tests check). This game's baseline Lasius worker has 16 HP, so with the user's ramp unchanged a hold kills it in 2.8 s from the lunge; a Lasius soldier (44 HP) in 5.3 s, a Formica worker in 3.9 s, a Formica soldier (120 HP) in 9.6 s.
- Rescue: two Lasius workers that are beside the soldier when it grabs free their friend 10 times out of 10; starting 3 body lengths away, 1 in 10 (the victim dies first); three workers 3 body lengths away, 9 in 10. One worker never does.
- Plant income (AI colonies, three seeds, 8 min): median 1.52 per forager-minute against Lasius' 1.58 (× 0.96, within ± 10 %; one Lasius seed starved, as before). Soldiers forage too, so they count as foragers.
- **Simplifications.** Covered foraging trails are not built (as for the Nasute Termites); the spec's "workers retreat on the alarm" and "workers bite as a last resort" were replaced by the user's note (workers fight like ants); far termites use the kit's LOD2 mesh, not its baked impostors; acid on a held creature is not drawn (the creature renderers have no shell pass), only the jet and the fizz; a held creature is pinned at the socket but not lifted.

#### Army ants (*Eciton burchellii*) — reference `docs/creatures/eciton-burchellii.md`
Upgraded from the user's package `claude/army-ants/` (2026-10-25). User decisions: **no bivouac** (army ants dig a nest, a queen chamber and brood tiles like every other species; the dormant `colony.bivouac` branch is untouched), **no nomadic/statary phases** (the queen's physogastry is fixed at `ECITON.queenSwell` 0.5), **no queen attendants**. Every number is in `ECITON` (`sim/balance.ts`); the behaviour is in `sim/eciton.ts`, the shared trail in `sim/route.ts`.

- **Castes** (species `eciton`; brood mix 60 / 20 / 12 / 8): Worker `eciton_minor` 4 mm (14 HP, sting), **Porter** `eciton_submajor` 6.5 mm (carry 5, the lankiest legs, loads under the body), Media `eciton_media` 8 mm (role soldier, escorts porters), **Soldier** `eciton_major` 11 mm (70 HP, bite 11, armour 2, never carries, the hook), Queen 22 mm. Costs: 10/2, 16/3, 28/5, 90/12. The old id `eciton_soldier` is an alias of `eciton_major` (`CASTE_ALIAS`: `casteOf`, the `?battle=` URL, and `restoreWorld`, which renames old ids in saved states; the morph registry keeps the alias too).
- **Diet:** insects, corpses and crumbs of them (`ECITON.foodKinds`, `diet.edible`): no seeds, fruit, honeydew or fungus. The food view highlights only what they eat.
- **Swarm raid** (any army-ant group at a surface marker; `c.ecRaid[marker]` in the state): the front is an arc across the raid direction (nest entrance → marker), half-width 2.2 × √(raiders) Worker lengths, capped at ¾ of the raid area; the raiders fill a band behind it ~1.3 body lengths apart (lateral place by roll index with a little jitter, depth by id). The front starts on the marker's near edge and creeps on at 0.35 × a Worker's speed while 30 % of the raiders keep up with it, roams 2 × the marker radius round the marker and swings back in (0.9 rad either side of the marker, alternately) at the edge, at water or rock. Each raider **pulses**: runs 1.6 body lengths past its place, falls back 0.5 without turning, waits 1.2–2.4 s (a hash of id and pulse count, no RNG draw) and goes again. Food within 3 body lengths is bitten up and carried home (porters pass over crumbs under 1.5 units). Raiders with water or rock between them and their place go round on the front's own flow field. Small creatures (≤ 30 mm, not bosses, not held) within 36 mm of the front centre run from it for 2.5 s (flushed).
- **Three lanes** (Couzin & Franks 2003): laden ants walk home down the middle (the home flow field); outbound ants follow the trail 0.9 body lengths to one side (by id parity, so both edges carry outbound traffic) and step further aside (× 1.8) for 0.6 s when a laden nestmate comes head-on.
- **Soldier posts:** with at least `guard.minMajors` (3) Soldiers alive, the Soldiers sent to a raid man posts along the whole trail, entrance → marker → front (`R.posts`, recomputed every second in the state so a restored game has the same posts): one per Soldier after `guard.reserve` (1) who stays with the raid, at most one per 6 Soldier lengths plus 2 + 2 extra, spread so they are densest at both ends (arc length warped by u − ½·sin 2πu / 2π), alternating sides 1.2 lengths off the trail, facing out. At a post: `AS.Guard`, pose GUARD (fore legs raised, body pitched up 15°, head up, mandibles open); it engages enemies within 8 of its lengths, then walks back. With fewer Soldiers there are no posts and they raid with the others (the user's rule).
- **Porters** carry the load under the body (`porter.underFwd` 0.1 L ahead of the middle; render pose PORTER, the item drawn at 0.2 L and ≤ 0.45 L long). **Team carries:** a porter at an item up to 3 × its load takes it whole when 2 unladen raiders are within 4 of its lengths; they walk beside the load (`helpOf`) and the team moves at 0.8 ×. A media walks beside a laden porter heading home (two per porter at most).
- **Living bridges** (`c.ecLinks`, kind 1): where the trail runs over water (the 8 mm flow cells cut the corner of a puddle) or detours round water by ≥ 1.4 × a span of at most 12 links, Workers walking out fill the slots one by one from the nest end (`AS.Bridge`, pose BRIDGE, on the water surface) once the trail is busy (≥ 3 ants passing an end per 10 s). Finished, laden ants at the marker end and outbound ants at the nest end walk across it (`xing`) at 0.9 ×; after 15 s of low traffic the links let go from the far end and walk off to dry ground. **Pothole plugs** (kind 2): dips of ≥ 0.15 mm in the trail (up to 6, 10 mm apart) slow army ants to 0.6 × until a Worker lies in each (`AS.Plug`, pose PLUG). Link ants hold still: they are not crowded, do not fight back and stay out of the separation.
- **Combat:** the Soldier's hook pins an ant it bites for 4 s and bites × 1.5 through no armour; a creature shaking off its riders loses a hooked Soldier only 30 % of the time. Three or more army ants holding (or riding) an ant or a non-boss creature spread-eagle it (pinned; a creature can turn and bite but not walk).
- **Render** (`render/ants/antGeometry.ts`, `antMaterial.ts`, `morphs.ts`, `game/antViews.ts`): builder options `mandible.hook / barb` (fishhook tips, barbed points), `head.frontMix` (front-of-head gradient; replaces the old `eciton_soldier` special case), `head.sockets`, `waist.thick`, `gaster.segs / stripes / stripeW / physo` (`uPhyso`: the queen's `swell`), `gait.lift / duty` (high stepping), `rig.carryUnder`; poses 10 PORTER, 11 GUARD, 12 BRIDGE, 13 PLUG (8 and 9 were already the sim's ALARM and CARRY). Antennae sweep 1.6 × faster. Every other species' geometry hashes the same as before (`tools/morph-hash.ts`, checked by `tests/eciton.ts`).
- **Sound:** quicker, lighter footsteps; a dry clack when a Soldier's hook goes in; a struggle when a victim is spread-eagled; a rustle as a bridge link joins.
- **AI** (`sim/colonyAI.ts`): brood mix 60 / 18 / 10 / 12 (Soldiers early enough to man the posts); marker I goes on the richest insect food in reach, and moves on once less than `aiRecallFood` (10) is left round it; the Media and Soldier groups go out with the raid once there are 3 or more Soldiers (with fewer they stay home and defend).
- **Performance** (`tools/eciton-stress.ts`): 600 army ants raiding one marker take 8.2 ms a simulation tick against 4.4 ms for 600 black garden ants foraging on the same map (every raider moves all the time). One flow field per raid (to the front centre) — a field per ant's own slot was rebuilt on every call (119 ms a tick).
- **Also fixed:** the surface flow field compared Float64 heap priorities with Float32 distances, so a live entry whose distance rounded down looked stale and its cell was never expanded: invisible walls that sent routes on long detours (every species). It now compares at float32 precision.

#### Termants (*Chimaeromyrmex termitoides*, fictional) — reference `docs/creatures/chimaeromyrmex-termitoides.md`
From the user's package `claude/termyrms/` (2026-10-25). An ant–termite hybrid that raises the castes of the species it eats. Not EotU's design: names, text and numbers are original. Every number is in `TERMANT` (`sim/balance.ts`); the behaviour is in `sim/termants.ts`; the models in `render/ants/termantMorphs.ts` (shared builder, new opt-in options: frontal pore, no eyes, bead antennae, soft striped gaster with a gut patch, smooth mesosoma; `uSoft` abdomen jiggle that deflates on death).

- **Castes:** worker 5 mm (formic-acid opener, gathers wood), soldier 7 mm (glue burst; gathers and fights like an ant's soldier), king 7.5 mm (spawned beside the queen; role `king`, never in caste ratios), queen 12 mm. Ratio 85 / 15. One queen and no replacement queens (user note, 2026-10-25): when she dies the colony is lost, king or not.
- **Genes → stolen castes:** samples credited at the store (`termantDeposit`) from enemy corpses only (size classes 1 / 2 / 4 / 7, creatures 3; pieces cut from a corpse carry their share). 12 samples (18 heavy) unlock the source species' caste from `STOLEN_CASTES`; it joins `colony.castes`, so everything about it is that species' own. Max 3; a fourth waits until one is forgotten (command `forgetCaste`: tiles refunded, living ants stay, samples to half). Tiles ×1.5. Corpses linger 25 s in Termant games so they can be carried home. Command `corpsePriority` makes workers fetch the corpses of still-short species first.
- **Glue burst** (`glueT` on ants and creatures): +3 damage, speed ×0.4 for 3 s, formic acid ×2 meanwhile. **Wood:** separate store (cap 60) digesting into food. **Carton walls:** tile `carton`, paid in wood, 120 HP, blocks enemies (they chew it), own ants pass, wall points for upgrades.
- **Ability:** Alarm Drumming (colony alarmed 15 s, every glue burst ready; 70 s). **UI:** Genome tab, wood in the top bar, stolen names on tiles and cards. **Render:** stolen-caste amber tint (code in `aD.z`, see `antMaterial.TINT_GLSL`). **AI:** mix follows the stolen castes, forgets the least-used, carton walls when invaded, raids sooner a rival whose genes it nearly has.

### 3.12 Underground areas (`sim/areas.ts`, Revision 2)
**Structure**
- A level has one **surface** and **up to 6 underground areas**. Each is a self-contained top-down hex map (its own `NestGrid`, flow fields, scene and camera), with the same rendering and rules as the home nest.
- Area kinds:
  - **home nest**: always area 1;
  - **enemy nests**: rival colonies, each with a queen, tiles and brood;
  - **neutral caves/lairs**: pre-dug caverns holding food or creatures, such as a spider's burrow or a beetle den;
  - **allied nests**: friendly AI colonies on the player's team, as in special missions.
- Each area has a **number (1–6) and a colour**. Home is 1; the others are numbered in the order they appear in the level.

**Entrances**
- Areas connect to the surface **only through nest entrances**. Each entrance has a surface side and an underground ramp.
- Anything that walks into an entrance is moved to the matching spot on the other map, with a short scurry-in fade on both sides.

**Control and survival**
- Placing a marker on an entrance sends a group into that area (3.9).
- Ants that cannot find a route back to their own queen (no path to any exit, or their colony has fallen) take damage over time and die, as in EotU.

**Teams.** Colonies have a team. Allies share the player's team: they never fight each other, and allied ants count for area access.

**Simulation.** All areas simulate at full detail at all times. Only the viewed one is rendered (others at reduced animation detail).

**Implementation (done).**
- Spaces: colony nests are `colony + 1`; caves start at 64. `World.grids` / `gridFlows` hold every underground map keyed by space; `entrancesOf(space)` and `areaCentre(space)` serve nests and caves alike. Saves from version 1 (keyed by colony) are converted on load.
- `areasFor(w, colony)` numbers the areas from the viewer's side (home 1, then colony nests, then caves; at most 6) with colours `#d9a441, #d0554a, #5b8ed6, #a874d8, #4fb595, #e0873c`.
- `areaOpen` applies the access rule; `teamPresence` counts your and allied ants (and allied creatures) per space.
- Caves (`createCave`): a 26 × 22 hex map with an irregular cavern of radius 3 plus two side pockets, a tunnel to one ramp, food scattered on the floor (seeds, dead insects). Lairs get their creature in Phase 10.
- A marker dropped within 12 mm of another area's surface entrance moves to the top of that entrance's ramp in the area (`entranceAt`). Marker ants on the surface walk there (`goToArea`) and go down; foragers in a cave or another nest pick up loose food near their marker and carry it home (`collectUnderground`).
- No route home: once a second, an ant whose colony has fallen, which is outside with no entrance home, or which is underground with no path to any exit loses health so that it dies after `BALANCE.lostDeathTime` (30 s).
- Scurry fade: on the surface an ant shrinks and sinks as it reaches a hole; underground it grows in from the ramp for 0.45 s after arriving.

### 3.13 Battle arena (`sim/arena.ts`, `sim/arenaState.ts`, `ui/arenaPanel.ts`; 2026-10-25)
The user asked for an arena "like the EotU battle arena" for 2, 3 or 4 teams, also to make the creature-climbing mechanic easier to test.

**Research (Empires of the Undergrowth's arcade Battle Arena; no text or assets copied).** Its arena is a spectator sandbox: you click a creature's icon to drop units onto one of **two sides** (left/right, switched with buttons), up to 50 per click; some creatures and titans can be set to higher levels; units can attack on their own (they cross the map toward the other side and fight what they meet) or wait for orders; only mobile, aggressive creatures are offered; stats are the story-mode stats. Sources: the official wiki's Arcade Mode page (wiki.hoodedhorse.com/Empires_of_the_Undergrowth/Arcade_Mode) and the developer's demo news post. Our version keeps the idea (pick, drop, watch) and goes further where the user asked: up to four teams, creatures fighting creatures, and tools for watching climbs.

**Design.**
- **Teams are colonies.** One colony per team (all `lasius`, AI off, no starting ants); each has a nest because the engine needs one, placed out at the map's edge and never used. Ants belong to their team's colony; creatures carry it as their `faction`. Team colours: Red, Blue, Green, Gold (render only, `TEAM_COLORS`).
- **No economy:** `mode.arena` turns off eggs, nanitics, jobs, colony loss, lost-route deaths and food respawn; the map has no food, aphids, plants, puddles or caves. Corpses sink as usual; creature carcasses go after `ARENA.carcassSec`.
- **Spawning** (command `arenaSpawn`): any caste of any species except queens, kings and nanitics, and any creature but the immobile antlion; 1/5/10/25/50 at a time, level I–III (tile-level health and damage; for creatures `data.power`), in a sunflower spiral round the team's corner (two face each other, three in a triangle, four in the corners) or round a clicked point (Place tool). At most `ARENA.maxUnits` (700) at once.
- **Stances** (command `arenaStance`): **Charge** — the team's marker I goes to the enemy unit nearest the team's centre every second (`arenaSystem`), so its ants walk there and fight what comes in range; its creatures go for the nearest enemy. **Hold** — the marker stays at the corner; creatures keep to their own post (`holdLeash`). **Passive** — nobody walks or attacks (a dummy: a passive stag beetle is the easy climbing test).
- **Fights:** arena ants only fight (no foraging or going home). Team creatures fight other teams' creatures with a generic melee (walk up, face, bite on their own interval, venom, level) and leave ants to their own programs; creature programs skip their own team's ants; ants skip their own team's creatures (targeting, nasute glue, acid splash). Arena creatures never flee. Wild creatures (none spawn here) would be everyone's enemy.
- **The round:** a fight starts once two teams have units; the last team standing wins (a message and the scoreboard banner); Clear all (command `arenaClear −1`) starts a new round; Clear team removes one team's units.
- **UI:** the single-player menu's Battle Arena tab (2/3/4 teams, the floor: formicarium by default) and `?play=1&mode=arena&teams=N`; the arena panel (team picker with live counts, stance, roster by species or creatures, count, level, Place, Clear, pause and speeds ¼×–4×, climb rails and hitbox views); a scoreboard (units, health bar, losses, round time, winner); the team on the info card; a ring in the team colour under every unit (`render/game/teamRings.ts`). The colony panels, markers, minimaps and stores are hidden.
- **Determinism and multiplayer:** every action is a command with a wire format, so replays and snapshots carry the arena; the lobby does not offer it yet (single-player only).
- Numbers: `ARENA` in `sim/balance.ts`. Tests: `tests/arena.ts`.

## 4. Rendering

* Two scenes, both seen from above with the same top-down camera rig: **surface**
  (sun, hemisphere light, fog, dappled canopy light, grass, litter props) and
  **nest** (warm low-angle golden key light, pooled light over dug floor, deep
  shadow in undug soil). Each has its own colour grade. The transition is a
  camera dive into the entrance hole and down the ramp.
* **Nest terrain** (`render/nest/`): a chunked heightfield built from a signed
  distance field of the dug raster (blurred for organic contours): undug soil is
  a raised, dark, crumbly plateau; tunnel walls slope and round down to a
  sunken packed-earth floor with pebble drifts along wall bases, root fibres
  and debris. Baked cavity occlusion + SSAO darken wall feet; a blurred
  "openness" light map makes warm light pool in open areas and fall off down
  tunnels. Dust motes drift in the air.
  - **Buried stones** (undiggable hexes; user note 2026-10-25: hard to tell from
    diggable soil) are pale, cool-grey rock slabs cracked into plates, with a
    light rim and a dark seam where they meet the soil, colour-balanced against
    the warm key light so they read as neutral grey, and kept at least 62 % lit
    in the dark far from the dug area, where diggable soil fades to near black.
* **Tile floors**: drawn in the floor shader from a per-hex data texture (type,
  caste colour, level, group outline colour). Original procedural looks: queen
  = pale blue-grey silk mat; worker brood = ochre cell pits; soldier brood =
  red-brown ridged cells; major = dark crimson large pits; minim = pale orange;
  food storage = mossy green with stored morsels and honeydew beads; fungus
  garden = spongy white comb. Group outlines are drawn on hex edges bordering
  another group, coloured by the assigned marker. Placement ghost hex, grid
  overlay and active-tile particles (spores over fungus, shimmer over brood).
* Post-processing (quality dependent): GTAO ambient occlusion, gentle bloom,
  tilt-shift depth-of-field, color grading + vignette, FXAA.
* **Ants**: one merged geometry per species × caste × LOD, every vertex tagged
  with its body part and joint chain. A vertex shader animates legs (tripod
  gait, phase advanced by distance travelled ÷ stride length so feet never
  slide), antennae, mandibles, head yaw, gaster raise/curl, and special poses
  (grooming, trophallaxis, death curl, stinging, acid spray, carrying).
  Per-instance attributes carry the animation state; one draw call per
  species/caste/LOD. Far LOD uses top-down impostor quads rendered from the
  real model at load time.
* **Creatures**: articulated rigs (Object3D hierarchies) built from anatomical
  part builders, with leg IK and foot planting driven by gait controllers
  (spider tetrapod, insect tripod, centipede metachronal wave, isopod waves,
  caterpillar peristalsis, larva crawl).
  - **Chain bodies** (caterpillar, centipedes; `render/creatures/chainTrail.ts`):
    the segments lie along a follow-the-leader chain behind the head: each joint
    is pulled to exactly one step behind the one before it, its bend limited
    (0.3 rad a joint) starting from the head's own heading, and the chain relaxes
    back toward straight (4/s). It used to be a trail of past head positions with
    headings from the two nearest points, so turning on the spot, a shove or a
    reverse pointed the head sideways or backwards (the user's "dislocated
    neck") and could fold the body onto itself. `tools/chain-check.ts` (real
    fights): neck worst 133–178° and folds of 180° before, 34° and none after;
    the drawn body's middle now sits 0–5 % of its length from its hitbox centre
    (31–45 % before).
* **Markers** are drawn in 3D in both scenes: a tall Roman numeral above a
  downward arrow with a soft coloured glow, gently giving off coloured smoke
  (the pheromone); a label beneath shows the live count of assigned ants. No
  ground circle.
* Effects: GPU-friendly pooled particles (dust, falling soil, acid spray,
  venom drips, hemolymph splats), spoil heap meshes, pheromone overlay texture,
  camera shake.

## 5. UI, audio, saving

Original art throughout (self-drawn SVG icons, dark translucent panels, thin
bronze/gold borders, small-caps serif headers). Layout follows the reference:

* **Top bar**
  - **Top-left:** a large **Missions** button (objectives and briefing). Below it, a row of small toggles: food overlay, pheromone-trail overlay, creature info, grid, **tile info overlay** (levels, upgrade points, incubation), and help "?".
  - **Top-right:** readouts for **food current/max**, **workers active/max** and **soldiers active/max**, then **Menu**.
  - Below the top bar sit a status line ("The colony is starving…") and toasts.
  - There is no upgrade tree or progression currency (removed at the user's request, 2026-10-24).
* **Underground-area tabs** (a row of numbered tabs along the top of the bottom-left minimaps; user note 2026-10-24: no 3D preview)
  - One numbered tab per area in the level (up to 6), each in its area's colour with a kind icon (home hex, enemy mandibles, allied hexes, cave arch); tab 1 is home.
  - Clicking a tab (or F1–F6) shows that area in the main view; from the surface the camera dives in through the area's entrance, between areas it is a quick fade cut, and the camera returns to where it was in that area.
  - **Access rule:** a tab is clickable only while your ants (or allies) are in that area. Otherwise it is greyed, with the tooltip "No ants in this area". Home is always available, and a sandbox setting reveals every area. When your last ant leaves the area you are watching, the view returns home.
  - Tabs **pulse** when they become available and show **alert badges** for attacks or a hurt queen, even while you view another map.
* **Minimaps** (bottom-left): the selected underground area and the surface, side by side.
  - Click either to move the camera there, switching maps if needed. The current view is drawn as a frame.
  - Icons:
    - entrance arrows;
    - on the surface, queen icons at entrances, coloured by area;
    - dots for food, enemies, your ants and markers.
* **Marker panel** (bottom-centre): six columns, home (hex icon) and markers I–V (numeral headers in marker colours).
  - Each column shows current/max ants and a list of **control-group cards**: caste icon, living/max (e.g. "19/19"), role badge and tile-level pips.
  - Cards are **dragged** between columns: a drag ghost appears, valid drop columns highlight, and the card animates into place. The group's ants respond at once.
  - Click a header to select that marker for placement (in the nest, on the surface, or on an entrance); double-click to jump the camera to it.
  - A collapse arrow hides the panel, and a cancel button clears the selected marker.
  - Under each column's count, three order toggles (no attacking, no gathering, no climbing; 3.9), Home's for the nest-job groups.
  - Right-hand buttons: recall all, aggression toggle, species ability.
* **Build panel** (bottom-right) has two tabs:
  - **Tiles** (hammer): Dig, one brood tile per caste, food storage, **highway**, species tiles, then the **Upgrade** and **Delete** tools. Tooltips give the build cost, hatch cost, capacity per level and grow time.
  - **Castes** (ant): stats and real facts.
  - Action buttons: food view (rings the food *your* colony can gather; on the minimaps food you can't gather is a dim grey dot: user note 2026-10-25), game speed.
  - A placed tile appears as a ghost until a worker builds it. Upgrade and Delete are tools you click tiles with.
* **Other UI**
  - **Info card** on click: common and scientific name, caste, level pip, hp, task and a real fact. Tooltips on every button and card.
  - Main/pause menus; settings for quality, UI scale, volume, key bindings, edge scrolling and the sandbox "reveal areas" option; the observe camera.
  - The **queen-danger vignette** flashes the screen edges red while she is below 25%.
  - The layout scales with a UI-scale setting and the viewport size.
* **Camera** (all maps)
  - **Pan:** WASD / arrow keys, **edge scrolling**, middle drag (left drag on empty ground too).
  - **Zoom:** wheel with fast smoothing, clamped per map so the view never passes the edge. It tilts lower up close.
  - **Rotate:** right drag or Q/E, freely and damped. **C** resets the camera.
  - Bounds keep the view on the map.
  - **Space** jumps to the selected marker, switching maps if it is in another area.
  - **Photo mode (F9)** pauses and hides the UI; **Shift+F9** frees the camera to fly (WASD, mouse look, Q/E down/up).
* **Hotkeys**

  | Key | Action |
  |---|---|
  | 1–5 | Select marker I–V to place |
  | Tab | Surface ⇄ last area |
  | F1–F6 | Areas 1–6 |
  | N | Next available area |
  | Space | Jump to the selected marker |
  | P | Pause |
  | − / = | Speed |
  | T | Trail overlay |
  | G | Dig tool |
  | U / Delete | Upgrade / Delete tools |
  | R | Recall |
  | O | Follow ant |
  | C | Reset camera |
  | F9 | Photo mode |
  | Esc | Cancel / menu |
* **Audio** (revised by the user's audio brief, 2026-10-24; details in `docs/audio/README.md`).
  - Nature first, heard as if by a tiny microphone among the ants; nothing electronic in the game world.
  - Built mostly from real recordings. Each of the 100 sounds in `src/audio/catalog.ts` has file slots for 3–6 takes. Until recordings are added, it plays an organic stand-in synthesised from the physics of the real sound: grains, chitin and wood modes, bubbles, stridulation, friction, air.
  - Mixer:
    - six buses (ambience, creatures, combat, interface, music, narration) plus master, each with a slider;
    - voice budgets by loudness, with the overflow going into swarm and battle beds;
    - ducking for alerts, boss phases and narration;
    - underground and night filters;
    - only the space on screen is heard; important events elsewhere arrive muffled.
  - Ambience by biome, time of day, zoom and (future) weather.
  - Ants: footsteps by ground type for the nearest, a granular swarm bed for the rest, digging, carrying, stridulation, combat, brood and the queen.
  - Creatures and bosses by gait and size: bosses are scaled-up real sounds, never roars.
  - Natural interface cues: marker chirps at five pitches, earthy tool taps.
  - Acoustic adaptive music: stems, or the procedural score.
* **Save/load** (Phase 14). A save is the canonical snapshot plus a small header, gzipped, kept in IndexedDB in three slots, a quick save (F7/F8) and an autosave every 5 minutes of game time. Saves can be downloaded and opened as `.udsave` files. The title screen has Continue and Load. A loaded game runs on exactly as the saved one; its replay starts from the snapshot. Settings (quality, interface size, edge scrolling, seven volumes, key bindings) and the profile (mission medals) are kept in localStorage.

### Phones and tablets (`core/device.ts`, `core/input.ts`, `ui/gameUI.ts`; user request 2026-10-25)
* **Detection:** a coarse primary pointer, or an iPad reporting itself as a Mac with touch points; `?touch=1` / `?touch=0` force it. Touch mode changes only input and layout — the simulation is the same, so phones play multiplayer with desktops.
* **Gestures** on the game view (pointer events, one map of touches): one finger drags the ground (with Dig and the build tools it paints, starting after 110 ms so a second finger can still make it a camera gesture), a tap is a click, a long press (0.52 s) a right-click; two fingers pan with their midpoint, pinch to zoom (the wheel's units) and twist to rotate, the ground following the fingers; three fingers dragged up or down tilt. Hover (tile ghost, placement hints) follows the finger. Tooltips show on a long press over a button, and that press does not count as a tap.
* **Compact layout** when the full layout's scale would leave buttons under 0.7 (phones in landscape, tablets in portrait): laid out for about 1060 × 540; the top toggles join the Missions button in one row with bigger buttons; the area tabs sit under the top bar with a map button that shows the two maps; the marker panel sits bottom-left, narrower, folded to its markers (the arrow unfolds the cards); the build panel is a drawer behind **Build** beside the food view and speed buttons. An iPad in landscape keeps the full layout (scale 0.74). Every control is at least 24 px on the smallest screen tested (iPhone SE in landscape, scale 0.629): finger-sized controls are 40 units. A marker column is too narrow there for its three order switches at that size, so each column shows one **Orders** button with the three orders as small icons (struck in red when on); it opens the switches at full size over the cards, and a press anywhere else closes them.
* **No Esc or right-click:** a ✕ button at the top centre cancels the tool or stops following an ant. Hint text says "tap".
* **The page:** no pinch or double-tap zoom, no rubber-band scrolling, no long-press callouts; the interface keeps clear of the notch and home bar (safe areas); a phone in portrait shows "Turn your phone sideways to play". Sound unlocks on the first tap (pointerup / touchend: iOS does not count a pointerdown) and resumes after calls. Auto graphics quality starts at Medium on touch devices and never climbs above it on its own.
* **Tested** in Chromium's iPhone and iPad emulation (`tests/browser/mobile.py`); not on physical devices.

## 6. Modes (revised with the user, Phase 5)

The glass-formicarium lab campaign was **cut** at the user's request (formicarium remains a map style
for sandbox and skirmish). Final mode set:

* **Outdoor missions** — 2 documentary missions with narrator captions sharing real facts; each ends in a
  boss fight (real species at dramatic scale).
* **Skirmish** — player vs 1–3 AI colonies on a generated map; win by killing all rival queens.
* **Sandbox** — god-mode spawning (including all bosses), terrain sculpting, water, sliders, toggles,
  save/load setups.
* **Custom colony: *Formica plagiaria*** ("Gene Thief ant", fictional; Latin *plagiarius* = kidnapper,
  copier). Its own queen and workers are always present; the player picks **any number** of castes from
  every other species (all unlocked from the start). Each borrowed caste hatches looking and behaving like
  its source species and is raised on its own brood tile type. In-world this is real biology: slave-making
  *Formica* (e.g. *F. sanguinea*) raid other nests for brood and raise it as their workforce (dulosis).
  The custom colony is selectable in skirmish, sandbox and the outdoor missions.

There is no persistent upgrade tree or progression currency (cut at the user's request on 2026-10-24).
Every caste and species is available from the start; within a game, tiles can be upgraded with food.

**As built (Phase 13, first pass).** Single-player opens on three tabs:
- **Missions** (`sim/missions.ts`). A mission is a list of stages, each with goals, timed narrator captions and spawns. It runs as a simulation system (once a second), so it is deterministic and replays include it; its state is `w.s.mode.mission`, which the Missions panel and the goal list under the top-left buttons read. Mission bosses come at half their sandbox health and head for your entrance. Lose with the queen.
  - *A Meadow Kingdom* (meadow, written for black garden ants): raise 15 ants → gather 250 food and build 2 stores → kill a wolf spider → muster 50 ants and 8 fighters → finale, a stag beetle.
  - *The Forest Floor* (forest, written for red wood ants, with a rival black garden ant colony): 25 ants and 5 fighters → 2 thatch stores and 40 ants → destroy the rival colony → recover to 45 ants → finale, a wolf spider mother carrying her young.
  - Any species can play either; goals that need a fighting caste only appear when the colony has one.
- **Skirmish.** 1–6 AI colonies in teams. Victory when every rival queen has fallen; defeat with your queen. The end screen lists every colony's record.
- **Sandbox.** The same setup with no AI by default, and a Sandbox panel: place any creature or boss where you click, fill the stores, infinite food, wild creatures on or off. These are commands (`sandboxSpawn`, `sandboxFood`, `sandboxSet`) refused outside sandbox games.
- Narrator captions show above the marker panel, long enough to read.

**Single-player and multiplayer (user note, 2026-10-24).** The title screen has
both modes.
- **Single-player** holds the missions, skirmish and sandbox, with pause and speed controls.
- **Multiplayer** is 2–4 players plus AI colonies on one generated map, through a lobby and invite links; last queen standing wins.
- A multiplayer match runs at 1× and **cannot be paused** (user note).

### Caste/tile model
Every caste is a `CasteDef`: stats, morph, abilities and a **tier** (worker / soldier / heavy). Costs are **per caste** in `BALANCE.castes` (user note 2026-10-24): every worker caste costs 10 to build, and hatch cost and grow time scale with strength (castes not listed fall back to their tier).

**Castes (user notes 2026-10-24).**
| Species | Castes (build / hatch) |
|---|---|
| Black garden ant | worker 10/2, soldier 20/4 (a bigger worker, broader head) |
| Red wood ant | worker 10/3 (a short acid spray as it closes in, then bites), soldier 30/6 (tank: high HP and armour, enemies prefer to attack it), mortar 30/6 (lobs acid 56 mm; splash at level 3), rapid sprayer 30/6 (quick jets at 32 mm; slows at level 3). Both shooters in one colony, unlike EotU's either/or. Shooters hold their range and back off while reloading. |
| Tropical fire ant (*S. geminata*) | worker 10/1.5, soldier 20/3.5 (the worker model scaled to 4 mm), major 60/10 (huge square head, seed-milling jaws) |
| Leafcutter | minim 10/1 (2 mm), media 10/2.5 (8 mm, the middle of the range; user note), soldier 24/5 (10.5 mm: a scaled-up minim with a bigger head, redder), major 70/10 (14 mm) |
| Army ant | worker 10/2, porter 16/3, media 28/5, soldier (the major) 90/12 (package `claude/army-ants/`, 2026-10-25) |
Equal-food battles (`tools/equal.ts`, `tools/battle.ts`) were used to tune these: soldiers beat their own species' workers for the same food, majors beat soldiers, and the wood ants' tanks + shooters beat most equal-food armies while shooters alone lose to swarms.

Every caste a colony can raise has its own **brood tile type**, and a colony's build panel lists exactly those tiles. Each species also has a **nanitic** caste (a small first-brood worker) raised only on queen tiles. The Gene Thief colony gets a brood tile type for each borrowed caste. Caste mix is decided by which brood tiles the player places; there is no ratio slider.

## 7. Performance plan

Measured numbers and history are in docs/performance.md.

- **Simulation in a Web Worker.** Rendering never waits for a tick. Each tick the worker sends a frame:
  - entity lists as structure-of-arrays columns (`sim/columns.ts`), transferred zero-copy, or written into shared ring buffers when the page is cross-origin isolated;
  - colonies by structured clone;
  - nest grids only when they changed.
- **Simulation hot paths.**
  - Flow fields are shared per destination and extended incrementally (§3.4).
  - The flow heap and the target scans allocate nothing.
  - The spatial hash tags each entry with its team, so a target scan skips friends cheaply.
  - Trail evaporation is spread over four ticks.
  - Result: 4 × 400 ants with 100 creatures across 6 maps tick in about 5 ms (target 15 ms).
- **Rendering.**
  - GPU-animated instancing, so draw calls do not grow with ant count.
  - LOD and impostors, with per-instance frustum culling.
  - Graphics presets (low / medium / high) toggle shadows, post effects, grass density and LOD distances. **Auto** quality steps them down after 3 s of frames over 18 ms and back up after 12 s under 11 ms.
- **Tools.** The F3 overlay shows frame rate, worker tick time and network state. `?stress=1` runs the stress scenario in the browser, and `npm run stress` runs it headless.

## 8. Determinism and multiplayer

The full design is in docs/multiplayer.md. In short:
- **Deterministic simulation.**
  - One seeded RNG (mulberry32), with its state in the snapshot.
  - Basic IEEE operations only, plus `sim/dmath.ts` for sin, cos, atan2, exp and pow.
  - Ordered iteration, and no hidden state outside `SimState`.
  - A canonical binary snapshot (`sim/snapshot.ts`) with an FNV-1a 64 hash.
- **Commands** (`sim/commands.ts`) are the only way anything outside the simulation changes it.
  - 16 types, a few bytes each, validated when applied at the tick boundary in (player, seq) order.
  - Single-player applies them at once; replays apply the same log.
- **Lockstep** (`net/lockstep.ts`, `net/netGame.ts`).
  - Every player sends one packet per tick, for the tick `delay` ahead; the delay adapts from 2 to 8 ticks.
  - The host relays packets (star topology) and compares hashes every 100 ticks; a mismatch stops the match with a report.
  - A silent player is waited for, then dropped to the AI after 30 s. They can rejoin with a snapshot and the packets since.
  - Transports: in-memory for tests, BroadcastChannel for local tabs, PeerJS/WebRTC for the internet, plus a network simulator.
- **Determinism test.** The same seed and commands run twice and once from a mid-game snapshot must give identical hashes for 20 minutes of game time. It also passes in the browser against Node.
