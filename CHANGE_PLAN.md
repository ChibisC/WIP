# Change Plan — Top-down Nest, Hex Brood Tiles, Marker UI

*Written 2026-10-24, before any code for this change. Reference: the Empires of the Undergrowth
screenshot supplied with the change request. We copy its layout and mechanics only. All art,
icons, fonts and text stay original.*

---

## 1. Summary of the three changes and why they matter

| # | Change | What it replaces | Why it matters |
|---|---|---|---|
| 1 | **The nest becomes a flat plane seen from above** (three-quarter view, same pan/zoom/rotate as the surface). Undug soil is raised, dark and solid. Dug floor is a lower layer of packed earth lit by warm pools of light. Tunnels are wide channels with rounded, sloped walls. | The vertical ant-farm cross-section behind glass. | Tile-based colony building needs a top-down view. One camera model for both spaces also makes controls consistent. It lets invasions and swarms move in 2D the same way above and below ground. |
| 2 | **Hex brood tile system.** The player places hex tiles on dug floor: queen, one brood tile per caste, food storage, and species specials. **Each brood tile supports exactly one ant**, raised visibly on its tile and replaced when it dies. Adjacent tiles of the same type merge into a **nest group**. | Chambers you expand, nurseries with brood capacity, development rooms that unlock castes, and the caste-ratio slider. | Population, army make-up and food economy become directly readable from the nest layout. Every ant has a home tile, and every tile group is a commandable unit. This is the core of the EotU economy. |
| 3 | **UI redesign** matching the reference layout. A top bar with Missions and resources (the Adaptations upgrade tree was later cut, see §4.12). Nest tabs 1–4 (your nest and up to three rival nests) with a live preview. Nest and surface minimaps. **Five numbered markers (I–V)** with in-world icons. A **six-column marker panel where nest-group cards are dragged between columns**. A build panel with tabs. | The prototype HUD (stats panel, flat toolbar, two marker kinds). | The marker panel is how the player commands the colony. Groups are assigned to markers instead of placing one-off rally flags. Without it the tile groups have no purpose. |

---

## 2. Where the project actually stands

The change request says Phases 1–4 are complete. In fact the codebase is further along. Phase 5 work had already started, and a playable prototype was published. This matters for what is kept:

- **Done and kept:**
  - Phase 1: scaffold, loop, RNG, events, harness.
  - Phase 2: 21 creature notes.
  - Phase 3: terrain, grass, props, water, sky, post-processing, cameras.
  - Phase 4: anatomical ants, GPU gait animation, LOD and impostors.
- **Built during Phase 5 and kept** after adapting it to tiles:
  - Simulation world, spatial hash, flow fields and pheromone grid.
  - Foraging with trail recruitment, cooperative transport, the brood cycle and nurse care.
  - Hex digging with progressive excavation.
  - Combat base: grapple slots, spread-eagling, bite/acid/sting, venom stacks, alarm, knockback, acid projectiles, and corpses as food.
  - GameSession wiring, surface decor, brood/food models and the headless test suite.
- **Built during Phase 5 and replaced:**
  - The cross-section nest renderer.
  - The room/chamber model: nurseries, development rooms, the caste ratio and chamber caps.
  - The two-kind rally markers.
  - The prototype HUD.

---

## 3. Keep / refactor / replace

### Kept as is (or with small additions)
| Area | Files |
|---|---|
| Ant models, animation, instanced renderer, impostors | `render/ants/*` |
| Creature reference notes | `docs/creatures/*` |
| Surface world: terrain, grass, props, water, sky, lighting | `world/terrain.ts`, `render/terrainMesh.ts`, `grass.ts`, `props.ts`, `water.ts`, `environment.ts`, `textures.ts` |
| Post-processing, shader patches | `render/post.ts`, `render/shaderPatch.ts` |
| Core | `core/loop.ts`, `rng.ts`, `events.ts`, `input.ts` (gains new actions) |
| Sim infrastructure | `sim/spatial.ts`, `sim/pheromones.ts`, `sim/flow.ts` (NestFlow already works on any 2D raster), `sim/food.ts`, `sim/factory.ts`, `sim/combat.ts` |
| Food and brood models, surface decor | `render/game/foodModels.ts`, `foodRenderer.ts`, `broodRenderer.ts` (mapping only), `surfaceDecor.ts`, `instancedPool.ts` |
| Tools and tests | `tools/*`, `tests/run-all.ts` (rewritten assertions for tiles) |

### Refactored
| File | Change |
|---|---|
| `world/nestGrid.ts` | Becomes a generic top-down plane. Strata-by-depth is replaced by patchy soil types: loam, clay lenses, gravel, roots and buried stones. The hex radius is set per grid (scaled to the species, see §6), not a global constant. The "row 0 touches the surface" rule is replaced by explicit **entrance sites** (ramps up to the surface) and hidden **shaft sites** that open new entrances when dug into. The "outside the grid above row 0 is air" hack is removed. |
| `sim/types.ts` | `Chamber` is replaced by `Tile`, `NestGroup` and `MarkerSlot`. `Ant` gains `tile` (home hex). `Brood` gains `tile`. `Colony` loses `ratio`, `nurseryCap`, `chambers`, `maxMarkers` and old `markers`. It gains `tiles`, `groups`, `markers[5]`, `popLimit` and `aggressive`. |
| `sim/colony.ts` | Tile placement/removal/upgrade rules, group merge/split with stable ids, food cap from food tiles, population limit, per-tile egg laying and replacement, and group-to-marker assignment. Task allocation runs per group: home-column workers do chores, marker groups go to their marker. |
| `sim/brood.ts` | Brood is bound to a tile. Eggs are laid at the queen and carried by nurses to their tile. Development pauses while larvae are unfed. The adult hatches bound to the tile. |
| `sim/antAI.ts` | Nursing (carry the egg to its tile, feed larvae from food tiles), digging (unchanged hex logic), queen and guard behaviour use tiles. A new **marker behaviour** applies per group: workers forage around the marker, soldiers engage around it, and ants return to their tiles when unassigned. |
| `sim/movement.ts`, `sim/world.ts` | Nest entry and exit happen at entrance ramps anywhere in the plane, not at the top edge. The y-up/surface special cases are removed. |
| `render/view.ts`, `render/cameras.ts` | The nest scene is built like the surface: a top-down rig (the surface rig, generalised), no glass, frame or soil border. The dive transition goes down the entrance ramp. `NestCameraRig` is deleted. |
| `game/session.ts`, `game/antViews.ts`, `ui/menu.ts` | The nest adapter changes from back-wall mapping to floor mapping (the same shape as the surface adapter). The menu is restyled to the new UI kit. |

### Replaced (old code deleted after the switch-over)
| Old | New |
|---|---|
| `render/nestMesh.ts`: cross-section SDF slab, strata shader, glass | `render/nest/nestTerrain.ts`: top-down heightfield from the same signed-distance field (raised soil, rounded walls, sunken floor) with baked cavity occlusion and a light-pool map. `render/nest/tileFloor.ts`: per-tile floor materials, hex overlay, group outlines, ghost hex. |
| `render/game/nestDecor.ts`: chamber piles and glow slots | `render/nest/tileDecor.ts`: queen silk, stored food on food tiles, fungus comb, brood on brood tiles, dust and active-tile particles, light pools. |
| Chamber system (`CHAMBER_INFO`, `makeRoom`, nurseries, dev rooms, caste ratio) | `sim/tiles.ts` (tile types, costs, placement and group logic) plus colony changes. |
| Two-kind rally markers | Five numbered markers per colony (`sim/markers.ts`). |
| `ui/hud.ts` | `ui/` kit: `topBar.ts`, `nestTabs.ts`, `minimaps.ts`, `markerPanel.ts` (drag and drop), `buildPanel.ts`, `worldMarkers.ts` (in-world icons), `tooltip.ts`, `icons.ts` (original SVG icon set), `theme.css`. |

---

## 4. Design decisions taken (flagged for review)

1. **Formicarium missions stay cut.** The change request's suggested phase 11 lists "formicarium". You earlier asked to cancel the lab/formicarium missions and make two outdoor missions with boss finales. I'm keeping that. Formicarium stays available only as a **map style** for sandbox and skirmish. Say so if you want the campaign back.
2. **What home-column workers do.** Home groups "stay in the nest", but the original brief requires automatic foraging with trails. So home-column **worker** groups do colony chores: digging, nursing, moving food, carrying out corpses. They also forage near the nest by scouting and following trails, so the colony feeds itself without micromanagement. Home-column **soldier/major** groups stay in the nest and defend it. Assigning a worker group to a marker focuses its foraging and hauling on that area.
3. **Removing a marker** sends its ants home to their tiles, but the groups **stay in that column**. Placing the marker again sends them back out. The cancel button clears the marker selection. Dragging a card to the home column un-assigns a group.
4. **Hex size scales with the species**, keeping your earlier choice of "about 3 workers wide". Hex radius = 1.5 × worker length, clamped to 5–11 mm:
   - Fire ant 5 mm.
   - Black garden ant 6 mm.
   - Army ant 6 mm.
   - Mimic Ant 9.75 mm.
   - Red wood ant and leafcutter 10.5 mm.

   The fine navigation raster scales with it, about 3.5 cells per hex radius. So nests of every species have the same tile count and performance, and ants stay at real size.
5. **No waste/refuse tile.** Necrophoresis carries corpses out to a refuse heap on the surface beside the entrance. This is real behaviour for *Lasius* and *Formica* and is visible to the player.
6. **Population limit** = the number of brood tiles allowed. It comes from the mode (sandbox slider, skirmish base, mission value). Each caste's tile uses `pop` slots: majors use 2–3, minims 0.5. This keeps big castes expensive.
7. **Queen's chamber** (user, 2026-10-24). Every colony starts with seven special chamber tiles: the queen's hex plus the six around it. Each stores 25 food and raises one worker of the species, so a colony starts as a queen and seven workers, with 175 food capacity. Neither the player nor the AI can build or remove these tiles; they are only the starting workers and food store. The seven tiles form one group that can be sent to markers like any other. (This replaces the earlier idea of extra queen tiles for fire ants.)
8. **Eggs are laid by the queen** on the queen tile and carried by nurses to the empty brood tile. This is realistic brood transport. If no nurse is free for 20 s, the egg is moved by the colony's general workforce on its next free tick, so a tile never stalls forever.
9. **Tile upgrades** have levels I–III. Each level gives the tile's ant +15 % health and damage and −10 % development time. Upgrades cost food and show as a richer floor pattern on the tile.
10. **Tabs 1–4 are nest tabs** (user, 2026-10-24), not camera bookmarks. Tab 1 is your nest; tabs 2–4 are rival nests (up to four nests per map). All are freely viewable, with a live preview panel under the tabs, placed lower on the left like the reference. Digits 1–5 stay as the marker hotkeys.
11. **Removing a tile** refunds 50 % of its placement cost. A living ant bound to a removed brood tile stays alive but unbound: it no longer counts toward the population limit and is not replaced when it dies. A colony would not kill a healthy adult.
12. **No skill tree** (user, 2026-10-24). The Adaptations upgrade tree, the Royal Jelly currency and every persistent upgrade are removed from the plan and the code. The top bar keeps Missions, the toggles, resources and Menu. In-game tile upgrades stay: they are part of the build panel and cost food.

---

## 5. Revised phase list (renumbered)

Phases 1–4 are done. The rest builds on the new systems.

| Phase | Scope | Notes / reuse |
|---|---|---|
| **5** | **Top-down nest, digging, hex brood tile system** | New nest terrain mesh and lighting. Per-species hex scale. Entrance ramps and shaft sites. Tile, group and population sim. One ant per brood tile with visible brood, replacement on death, upgrades, removal with refund. Placement ghost with validity, group preview, cost and drag-painting. Tests for merge/split and replacement. Screenshots compared with the reference. |
| **6** | **Markers I–V, marker panel, drag-and-drop, full UI layout** | In-world marker icons with live counts. Six-column panel with group cards and drag ghost. Top bar, nest tabs with live previews, two minimaps, build panel with tabs. Tooltips everywhere. UI scales with resolution. Marker behaviour in both nest and surface. |
| **7** | **Colony simulation on tiles** | Food economy (tile costs, egg/feeding costs, food tiles), foraging with pheromone trails, brood development, grooming, trophallaxis, necrophoresis to the refuse heap. Most of this exists and is re-tuned and re-verified on top of tiles. |
| **8** | **Combat** | Grappling, spread-eagling, damage types, alarm response, aggression toggle. **Nest invasions through tunnels**: invaders enter by the ramps and path toward the queen, so tunnels become chokepoints. |
| **9** | **EotU revision: brood, jobs, upgrades, underground areas** | See §9. Done before creatures, which had just started. |
| **10** | **Architecture upgrade: performance + deterministic multiplayer (up to 4 colonies)** | See §10 (user brief, 2026-10-24). Done before more gameplay is built on the simulation. Creatures were paused for it. |
| **11** | **Creatures and bosses** | All creatures from the notes, with rigs, gaits and AI. Bosses are the stag beetle, tarantula, Scolopendra, giant mantis and Hogna mother, with telegraphed phases. The table and behaviour programs are already written (`sim/creatures/`); they must become deterministic (dmath) and command-driven before they are switched on. |
| **12** | **Playable species and their special tiles** | Lasius: aphid tending and a **root-aphid pasture** tile. Formica: acid and a **thatch** tile (warmer nest, faster brood). Atta: leaf cutting, minim hitchhikers and the **fungus garden** tile. Solenopsis: venom, a mound with no central entrance, and a **sun-warmed brood mound** tile (workers move brood up into the warm mound, so it develops faster). Mimic Ant: brood tiles for any borrowed caste. Plus the rival AI's tile and marker logic. |
| **13** | **Game modes** | Main menu: **Single-player** and **Multiplayer** (user note). Single-player has sandbox first, then skirmish (1–3 AI), then the **two outdoor missions** with narrator captions and boss finales. The custom Mimic Ant colony is selectable in all of them. Formicarium is a map style only (see §4.1). **Multiplayer** has the lobby and matches (2–4 players plus AI slots) from Phase 10. |
| **14** | **Audio, menus, saving** | Main/pause menus, settings and key bindings, Web Audio synthesis, save/load, info cards, observe camera polish. (No upgrade tree: cut, see §4.12.) Saves and replays reuse Phase 10's snapshots and command logs. |
| **15** | **Polish, balancing, performance** | Playtest every mode. Hit 1,000+ ants at 60 FPS. Bug sweep. README. Definition of Done check. |

---

## 6. Technical approach for Phase 5–6 (outline)

**Nest geometry.**
- The same signed-distance field as today (dug raster → distance transform → blur) drives a heightfield. Height is `wallH · smoothstep(sd)` with `wallH ≈ 1.2 × hex radius`. Walls slope smoothly and the floor stays at 0.
- The nest scene maps sim `(x, y)` to world `(x, floorH, y)`, exactly like the surface. So the ant adapter, food/brood mappers, picking and camera rig become shared code.

**Nest look.**
- **Soil top:** a dark, crumbly, slightly lumpy top surface that fades to near black away from light.
- **Walls:** compacted soil, roots poking out, small stones, with baked cavity occlusion plus SSAO.
- **Floor:** packed earth with pebble gravel drifts along wall bases, root fibres and debris.
- **Light pools:** a blurred "openness" map of the dug area drives warm golden emissive-style light that pools in open areas and falls off in tunnels. One low warm key light with shadows lets walls throw long shadows across floors.
- **Particles:** floating dust motes. Each tile type has its own subtle particles (spores over fungus, a faint shimmer over brood).

**Tile floors.**
- Each tile type has a procedural floor material, drawn in the floor shader from a per-hex data texture (type, caste colour, level, group outline colour).
- The looks are original:
  - Queen: pale blue-grey silk mat with fine strands.
  - Worker brood: ochre cell pits.
  - Soldier brood: deep red-brown ridged cells.
  - Major brood: dark crimson with large pits.
  - Minim brood: pale orange.
  - Food storage: mossy green with stored morsels and honeydew beads.
  - Fungus garden: spongy white comb.
- Group outlines are drawn on hex edges whose neighbour is not in the same group, coloured by the group's marker.

**Groups.** Connected components of same-type (and same-caste) tiles, recomputed on any tile change. Ids stay stable: a new component keeps the id of the old group it overlaps most, and the others get new ids.

**Markers.**
- `colony.markers[0..4] = {placed, space, x, y}` and `group.marker ∈ {-1, 0..4}`.
- In-world icons are drawn in 3D, not DOM: a tall numeral above a downward arrow, a soft glow and a count label.
- The marker panel is DOM with pointer-event drag and drop. Assignment logic lives in a UI-independent function with unit tests.

**Keeping the game runnable.**
- The new nest renderer is built **alongside** the old one behind `?nest=top`. The current sim nest is already a 2D (x, y) raster with hexes, so it renders top-down without sim changes.
- Then switch the default, then delete the cross-section code.
- The sim switch to tiles happens in one step with the test suite updated in the same commit.
- `npx tsc`, the headless tests and a screenshot run must pass before each commit.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The tile refactor breaks behaviour that already works (foraging, digging, combat) | Keep and extend the headless suite. Add tests for: tile placement validity, merge/split with stable ids, one ant per tile, replacement after death, marker assignment, and ants reaching nest and surface markers. Run before every commit. |
| The per-species hex scale misses some code that still uses a fixed cell size | Replace `NEST_CELL`, `HEX_R` and `HEX_H` imports with grid fields, so the type checker finds every caller. Grep audit for numeric literals. |
| The new nest doesn't look like the reference | Screenshot side by side with the reference at a matching camera angle. Iterate on light pooling, contrast, floor materials and wall AO until the read matches: dark masses, glowing golden floors, distinct tile colours. |
| Performance of nest mesh and decor | The heightfield is chunked and rebuilt only for dirty chunks (as today). Light uses a baked map instead of many point lights. Tile decor is instanced. Particles are pooled. |
| Drag-and-drop UI complexity and resolution scaling | A UI-independent assignment model. The panel layout uses CSS grid with clamp() sizing and a UI scale setting. Test at 1280×720, 1920×1080 and 2560×1440. |
| Scope creep delays the playable build | Phase 5 ends with a playable nest using tiles and the old HUD. Phase 6 swaps in the new UI. The prototype link is refreshed at the end of each phase. |

---

## 8. Updated Definition of Done

The project is complete only when:
- [ ] The game launches to a main menu and every mode is playable start to finish: **sandbox, skirmish and the two outdoor missions with boss finales**. The Mimic Ant custom colony is selectable in each.
- [ ] Every creature is recognizable as its real species from its look, movement and behaviour, and holds up in the close-up observe camera.
- [ ] Reference notes exist in `docs/creatures/` for every species.
- [ ] The **top-down nest** can be dug by marking soil. The dug floor grows outward with rounded tunnel walls and warm pooled light.
- [ ] Every colony starts with a **7-tile queen's chamber**: each tile raises one **nanitic** worker and stores 10 food. The tiles cannot be built, upgraded or removed. Colonies start with 3 workers.
- [ ] **Workers do all nest jobs** (dig → build/upgrade/delete → spawn, 6 points each) and **carry eggs** from the queen's pile to brood tiles. Larvae grow on food, pre-stage at 50%, and replace dead ants faster.
- [ ] **Upgrade points** from neighbours (a 19-hex chamber reaches level 3). **Highways** speed ants and tiles slow them, with weighted pathfinding. Delete downgrades first and refunds seeds.
- [ ] **Up to 6 underground areas** (home, enemy, neutral, allied), with coloured tabs. Tabs unlock while your ants are inside; markers on entrances send groups in. The camera is remembered per area, F1–F6 / Tab / N work, and there is photo mode.
- [ ] **Hex tiles** (one brood type per caste, food storage, species specials) can be placed on dug floor, upgraded and removed with a refund.
- [ ] **Adjacent same-type tiles merge into nest groups**, and removing a tile splits them.
- [ ] **Each brood tile raises exactly one ant** through visible egg → larva → pupa → adult, and dead ants are replaced over time.
- [ ] The colony grows from a queen to hundreds of ants.
- [ ] **Five markers (I–V)** can be placed in any nest and on the surface, with in-world icons (numeral, arrow, glow, drifting coloured smoke) showing live ant counts.
- [ ] The **six-column marker panel** supports drag and drop of nest-group cards between home and markers I–V, and ants respond immediately.
- [ ] Recall, aggression toggle and a species ability button work.
- [ ] The full UI layout works and scales to different resolutions:
  - top bar with Missions and resources;
  - nest tabs 1–4 to look into your nest and every rival nest, with a live preview;
  - nest and surface minimaps;
  - build panel with tile and caste tabs;
  - tooltips on everything.
- [ ] Foraging with visible pheromone trails works automatically, along with grooming, trophallaxis and brood care.
- [ ] Combat works, with grappling, damage types, alarm response and nest invasions through tunnels.
- [ ] At least four playable species, plus the Mimic Ant custom colony, play differently and behave like their real counterparts.
- [ ] Saving/loading, settings and audio work.
- [ ] Performance targets are met: 1,000+ ants plus dozens of creatures at 60 FPS on a mid-range laptop.
- [ ] `README.md` explains how to run the game and lists all controls.

---

## 9. Revision 2 — brood, spawning, egg delivery, tile upgrades, camera and underground areas (user, 2026-10-24)

The goal is to match Empires of the Undergrowth closely. The numbers come from the user's brief and live in one tunable file, `sim/balance.ts`. **This revision overrides earlier decisions where they differ** (listed in §9.4). The creature phase was paused mid-way for this; only a stats table (`sim/creatures/kinds.ts`) had been written, and it is not wired in yet.

### 9.1 What changes

| System | New behaviour | Replaces (code) |
|---|---|---|
| **Queen chamber** | 7 queen tiles. Each is a brood tile for one **nanitic worker** (a small, weak first-brood worker; one per species) and stores **10 food**. The colony starts with the queen and **3 workers**. Failsafe: no workers and no food → one free nanitic. The queen only lays eggs and is immune to knockback and stun. The screen edges flash red below 25% queen health. | Chamber tiles storing 25 and raising basic workers; 7 starting workers. |
| **Nest jobs** | Workers do all nest work physically, in strict priority **dig → build (incl. upgrade, delete) → spawn**. Every job needs **6 points**; a worker adds **2/4/6 per s** by its tile level. One worker per job, except digging: up to 2 per hex, or 7 on an entrance dig (lowest dig priority). Home-group workers take any job; marker-group workers take only jobs near their marker. A worker on a job ignores food and enemies. Unreachable jobs wait. Clicking a marked hex again cancels it. A progress ring shows over each hex being worked. | `allocateTasks` dig/nurse quotas; cell-by-cell digging with spoil hauling (`HaulSpoil`, `HEX_WORK`). |
| **Building** | Placing a tile creates a **planned tile** (ghost) and a build job. The food is paid when the worker finishes. Costs: worker brood 10 build / 2 hatch; soldier 25 / 5; heavy (major) 150 / 15; food storage 5 (holds 10/40/100 by level); **highway** 5. Same-type adjacent tiles form a chamber = one control group, which starts in the home column. | Instant placement with immediate cost; brood tile cost = 0.6 × caste cost. |
| **Spawning** | The queen lays eggs continuously into a **pile beside her**. Each empty brood tile creates a spawn job: a worker fetches an egg and carries it to the tile. The larva then grows on the tile, but **only while food is available**, drawing the hatch cost gradually; with no food it shows "The colony is starving…". On completion it hatches into the tile's caste. **Pre-staging:** a new egg is delivered at once, grows to 50% and pauses while the tile's ant lives, and resumes when that ant dies. Dropped eggs are picked up again. Stolen or destroyed larvae put the tile on cooldown. Deleting a tile kills its ant and drops its larva as food. | Eggs bound to tiles at laying; egg → larva → pupa; nurses feeding larvae three times (`FeedLarva`, `FEEDS`, `pickUpBrood`). |
| **Brood visuals** | A glossy cream egg; a soft white C-shaped larva that grows and pulses; on hatching, a puff of particles and the adult settles. A progress ring (in the tile overlay) stays frozen at 50% while a larva is pre-staged. | Egg/larva/pupa models with cocoons. |
| **Nest movement** | 35% slower on any built tile; **highways** +10/20/25%. Pathfinding becomes a weighted Dijkstra over cell costs, so ants prefer highways and go round chambers. Highways look like packed, worn earth. | Uniform BFS nest flow fields. |
| **Upgrades** | An **Upgrade tool** creates upgrade jobs (cost = build cost, max level 3). A tile needs **6 upgrade points** for level 2 and **12** for level 3. Points come from neighbours: each same-type tile adds its level, each soil/wall hex adds 1, and each highway adds its level to any tile; highways in turn get points from every adjacent built tile. A 19-tile hexagon can be taken entirely to level 3 (verified in tests). **Brood upgrades** raise the ant's level: more hp, damage, speed and job speed, a full heal, a small size increase and a rank pip; level 3 unlocks a caste perk. **Storage** holds 10 → 40 → 100. **Highways** give 10 → 20 → 25%. Optionally a tile holds 2 ants at level 3 (fire-ant minors). If points are short: "The workers have done all they can to prepare this brood chamber." | Instant upgrades with no neighbour rule; the selected-tile upgrade button. |
| **Delete** | The Delete tool **downgrades one level at a time** (the ant is healed). Removal at level 1 kills the tile's ant and refunds **two-thirds of the build cost as seeds** on the floor, which workers carry back to storage. | 50% instant refund. |
| **Tile overlay** | A toggle under Missions shows level pips, upgrade points (have / need) and incubation progress on every tile. With the Upgrade tool, hovering highlights neighbours and the points each gives. | — |
| **HUD** | Food current / max; **workers active / max**; **soldiers active / max**. Max = brood capacity; the queen is not counted. Marker cards show living / max and tile level. | One combined population figure. |
| **Underground areas** | A level has one surface and **up to 6 separate underground areas**: home nest (always 1), enemy nests, **neutral caves / lairs**, **allied nests**. Each has a number and a colour and is linked to the surface only by entrances. A marker **on an entrance** sends the group down into that area; once there they can be given markers inside it. Ants keep their group and can be controlled from anywhere. Ants with no route back to their queen die. All areas simulate at once. | One nest per colony, keyed by colony id (`nestSpace(c) = c + 1`); markers placed directly inside any nest. |
| **Area tabs** | A vertical column on the left, one tab per area, in its colour, with a live minimap preview of the selected area. **A tab is clickable only while your ants (or allied creatures) are in that area**; the home tab always is. A tab pulses when it becomes available. Camera position, zoom and rotation are remembered per area. Alerts appear on tabs (ants under attack, queen hurt). **F1–F6** jump to areas, **Tab** toggles surface ⇄ last area, **N** cycles available areas. | Nest tabs 1–4, every nest freely viewable. |
| **Minimaps** | The selected area and the surface. Entrance arrows; queen icons at surface entrances, in each area's colour; dots for food, enemies, your ants and markers. Click to jump, switching maps if needed. | Same, without area colours or entrance icons. |
| **Camera** | Pan with WASD **and arrow keys**, **edge scrolling**, and middle drag (left drag kept). Zoom clamped per map, with a lower tilt up close. Free rotation (right drag, Q/E). **C** resets the camera. Bounds keep the view inside the map. **Space jumps to the selected marker**, switching areas. **Photo mode (F9)** pauses and hides the UI; **Shift+F9** flies a free camera. | Space = pause, P = trails overlay (moved to **P → pause**, **T → trails**). |

### 9.2 Implementation order (each step keeps the game runnable and tested)
1. `sim/balance.ts` holding every number; the nanitic castes; caste tiers (worker / soldier / heavy) with build cost, hatch cost, grow time and per-level capacity.
2. Tiles v2: planned tiles, levels, upgrade points, highways, storage capacities, worker and soldier capacity.
3. Job system: a job board per colony with dig / build / upgrade / delete / spawn jobs, priorities, worker limits, points, reachability, marker-group locality, and "ignore food and enemies while on a job". Remove spoil hauling, nurse feeding and the pupa stage.
4. Spawning: the queen's egg pile, egg delivery, incubation drawing food gradually, starving status, pre-staging at 50%, dropped eggs, cooldowns, the nanitic failsafe, delete side-effects and the floor-seed refund.
5. Nest movement: tile and highway speed factors; a weighted Dijkstra NestFlow keyed by grid and tile versions.
6. Underground areas: an area registry keyed by space (home / enemy / neutral / allied, number, colour); entrances per area; teams for allies; neutral lairs as pre-dug caves; markers on entrances; the "no route home" rule.
7. UI:
   - area tabs with access, pulse and alerts; minimaps with icons;
   - build panel tools (Upgrade, Delete, Highway) with tooltips; tile overlay;
   - top-bar populations; starving status; queen red-edge flash.
8. Camera: arrow keys, edge scroll, reset, Space jump, F1–F6 / N, photo mode, and the new key map (pause P, trails T).
9. Brood visuals: egg, growing C-larva, hatch puff and settle, progress rings.
10. Tests (below), screenshots, then docs (`DESIGN.md`, `README.md` controls and hotkeys, `PROGRESS.md`).

### 9.3 Test plan
**Simulation tests** (`tests/run-all.ts`), all from the brief:
- The colony starts with 7 queen tiles holding 70 food, plus 3 workers.
- Eggs are carried from the pile to empty tiles.
- Larvae grow only with food, hatch the right caste, then pre-stage and pause at 50%. A death resumes the paused larva, so the replacement comes faster than a fresh spawn.
- Job priority is dig → build → spawn, with worker limits; marker-group workers take only nearby jobs; a job worker ignores enemies and food.
- Ants are slower on tiles and faster on highways, and paths prefer highways.
- Upgrade-point math is right; a 19-hex chamber goes fully to level 3, while edge tiles of small chambers can't.
- Upgraded ants heal and gain stats; storage capacity rises.
- Delete downgrades first, refunds two-thirds as seeds, and kills the ant.
- The nanitic failsafe works.
- A 5-area test level gives 5 areas with the right numbers and colours.
- An entrance marker sends a group into an area; the group can be commanded there and come home.

**Browser tests** (`tests/browser/`):
- tabs greyed until ants enter, then clickable and pulsing;
- F1–F6, Tab and N; camera remembered per area;
- both minimaps, with click-to-jump;
- rotation, zoom, pan, bounds, reset, Space jump, photo mode;
- alerts on tabs while viewing elsewhere.

**Screenshots** (checked by eye):
- egg delivery, a growing larva, a hatch;
- a fully upgraded chamber;
- the tab column with its preview.

### 9.4 Decisions flagged for review (where the brief overrides earlier choices)
1. **Queen chamber.** Earlier: each chamber tile raised a full worker and stored 25 food, so a colony started with 7 workers. Now: nanitics, 10 food per tile, 3 starting workers, as the brief says.
2. **Area access.** Earlier (user note): "nest 2, 3 and 4 are all freely visible". The brief now asks for the EotU rule: a tab opens only while your ants are inside. **I follow the brief**, and add a sandbox setting *"Reveal all underground areas"* for free viewing.
3. **Key map.** Space becomes jump-to-marker, so pause moves to **P** and the trail overlay to **T**. **C** resets the camera; **N** cycles areas.
4. **Brood biology.** Larval feeding trips and the pupa/cocoon stage are dropped in favour of the EotU loop: an egg is carried to the tile and the larva grows on food. The facts on the info cards keep the biology.
5. **Digging.** A hex now takes 6 points, so a level-1 worker digs one in 3 s. Spoil is no longer hauled to the surface. The surface spoil ring stays as decoration, growing with the size of the nest.
6. **Home-group foraging.** ~~Idle home workers still forage close to the nest.~~ **Resolved by the user (2026-10-24): do it the EotU way.** Home workers stay inside; food comes only from groups at markers. The AI places its own forage marker (DESIGN 3.11).
7. **Population limit.** Max population is the brood capacity. Modes can still cap the number of brood tiles (missions); sandbox has no cap.
8. **Phase numbering.** This revision is the new **Phase 9**. Creatures and bosses move to 10, species to 11, modes to 12, audio/menus/saving to 13, and polish to 14.


---

## 10. Architecture upgrade: performance and deterministic multiplayer (user brief, 2026-10-24)

The full design is in **docs/multiplayer.md**, and the baseline numbers and profile are in **docs/performance.md**. This section is the plan.

### Working rule (from now on)
**Every new gameplay system must be deterministic and change the simulation only through commands.** That means:
- seeded RNG and `dmath` only;
- no wall-clock or real-time APIs;
- no hidden state outside `SimState`;
- no reads of UI, render or camera state.

`tools/check-determinism.ts` enforces the banned-API part in the test suite.

### 10.1 Baseline (Step 1.2)
- Simulation tick with 4 × 400 ants, about 75 creatures and 6 underground areas: **16–23 ms average**, 43–50 ms p95, 125–138 ms worst (target < 15 ms average, no hitches).
- About **46 % of tick time is flow-field Dijkstra**, because nest fields are cached per destination *cell*. Another 9 % is GC.
- Heap 40–48 MB. A JSON snapshot is 2 MB and takes 50 ms.

### 10.2 Implementation order (each step keeps single-player working and tested)
1. **Determinism groundwork.**
   - `sim/dmath.ts`, and every `Math.sin/cos/atan2/hypot/exp/pow` in `sim/` and `world/` replaced (about 260 calls).
   - AI brains and intruders moved into `SimState`.
   - `player` means "human-controlled"; the local player id lives outside the simulation; `revealAreas` becomes a client setting.
   - `tools/check-determinism.ts` (a banned-API scan).
   - `sim/snapshot.ts`: canonical binary snapshot, FNV-1a 64 hash, restore.
   - `tools/determinism.ts`: seed + scripted commands, run twice, hashes compared every 100 ticks for 20 minutes of game time.
2. **Command system.**
   - `sim/commands.ts`: command types, binary encoding, validation, `applyCommand` at the start of a tick.
   - Every UI action (session, marker panel, build panel, menus) goes through a `CommandQueue`; single-player has zero delay.
   - Instant local feedback: pending marker shimmer, tile ghosts, group cards moving, a click sound.
   - Recording a command log gives replays.
3. **Simulation hot paths.**
   - Flow fields shared per destination, invalidated incrementally, with a time budget per tick.
   - The last stretch to an ant's own point is steered directly.
   - No allocation in hot loops; incremental pheromone evaporation.
   - Re-profile against the 15 ms target.
4. **Structure-of-arrays entities.**
   - Ants and creatures move to typed-array storage (`sim/ecs.ts`) behind an accessor layer, so the AI code changes mechanically.
   - The determinism test must give **identical hashes before and after**, which makes it the regression check.
5. **Simulation in a Web Worker.**
   - `worker/simWorker.ts` owns the World.
   - Snapshots go out as typed arrays (transferables; `SharedArrayBuffer` when cross-origin isolated), with versioned slow state and grid diffs.
   - `game/viewWorld.ts` is the read-only replica the renderers and UI use, interpolating between snapshots.
   - `core/loop.ts` splits into the worker tick clock and the render loop.
6. **Lockstep networking.**
   - The `Transport` interface, with four implementations: loopback, BroadcastChannel (local tabs), PeerJS star (WebRTC, host relays) and a network-simulator wrapper.
   - Tick packets with adaptive input delay (2–8 ticks).
   - Slow-down for laggards; "Waiting for…" after 3 s; drop after 30 s with an AI takeover.
   - Hash exchange every 100 ticks with desync dumps.
   - Reconnect with a snapshot plus commands and fast-forward.
7. **Lobby and match flow.**
   - Multiplayer menu (Create / Join); `?room=` invite links with Copy Link.
   - 4 lobby slots (name, species, colour, ping, ready; Open / Closed / AI) and host settings.
   - Seeded match setup with 2–4 fair spawns plus neutral lairs.
   - No pausing and no fast-forward in multiplayer (user note, 2026-10-24).
   - Results screen; simple text chat with mute.
8. **Tools.**
   - F3 debug overlay.
   - Stress scenario in the browser (`?stress=1`) and headless (`tools/stress.ts`).
   - Replays (save and play back).
   - Cross-browser determinism run (Chromium and Firefox via Playwright, if both are available).
9. **Deployment.**
   - Static build for GitHub Pages, Netlify or itch.io.
   - Netlify `_headers` for cross-origin isolation, with the transferable fallback documented.
   - README sections on deploying and sharing invite links.
10. **Verify (Step 2), then document (Step 3).**

### 10.3 Test plan (Step 2 checklist) — checked 2026-10-24
- [x] Single-player works as before, now through the command queue and the worker. `npm test` passes (determinism lint, simulation, commands, worker frames, creatures, headless multiplayer); the browser checks `worker`, `replay`, `ui_test`, `ui_test2`, `ui_areas`, `ui_camera` and `ui_dig` pass.
- [x] Determinism over 20 minutes of game time (4 colonies, creatures on): two Node runs and one restored from a snapshot agree at all 240 checkpoints; Chromium matches Node at every checkpoint (`determinism.py`). Firefox and Safari are not installed here: open `?scene=determinism` on the deployed site in each and compare the final hash.
- [x] Stress: the simulation tick is about 5 ms for 4 × 400 ants and 100 creatures (target 15 ms). Frame times cannot be measured here (software rendering): check with F3 on real hardware.
- [x] Browser tabs over BroadcastChannel: three tabs plus an AI create, join, start, stay in step with matching hashes, pass commands and chat, cannot pause, show the waiting banner and drop a closed tab (`mp_local.py`); a two-tab match is played to the end with surrender and the Victory and Defeat screens (`mp_finish.py`). Four clients are covered headless (`tests/net.ts`). With three tabs software-rendering on two cores, a tab can stall long enough to be dropped, so `mp_local.py` is sometimes cut short there.
- [x] 150 ms round trip with jitter and loss: a steady 20 ticks/s with the adaptive delay (`tests/net.ts`); orders show pending feedback at once.
- [x] Disconnect and rejoin; a dropped player's colony goes to the AI and comes back on rejoin (`tests/net.ts`; drop in the browser).
- [x] A forced desync is detected at the next hash and the report holds the snapshot and recent packets (`tests/net.ts`).
- [ ] The deployed build with invite links between two different networks. **This needs the user** (the build container cannot reach the public PeerJS or STUN servers).

### 10.4 Decisions flagged for review
1. **Order of the structure-of-arrays rewrite.** The brief asks for typed-array entities. Converting `antAI` (1,300 lines that read `a.x`, `a.state`…) is the riskiest change. I plan to do it as step 4, *after* the determinism test exists, so identical hashes prove the rewrite changed nothing. Steps 1–3 come first: dmath, commands, and the flow-field and allocation fixes, which account for about 55 % of tick time.
2. **The RNG stays mulberry32.** It is seeded, fast and bit-exact everywhere. The brief's xoshiro128** / PCG were examples. Say if you want a specific one.
3. **Deterministic floating point rather than fixed point**, as the brief allows: only IEEE basic operations plus `sqrt`, and polynomial `dsin`/`dcos`/`datan2`/`dexp`/`dpow`. Fixed point would mean rewriting every formula, for no gain in determinism.
4. **Networking runs on the main thread.** WebRTC data channels are not available inside workers in every browser. The worker only receives complete per-tick command batches.
5. **A reliable ordered data channel first** (the brief allows it). An unreliable channel plus acks can come later behind the same `Transport`.
6. **Testing without a GPU or the internet.** This container has no GPU and cannot reach the public PeerJS or STUN servers.
   - Multiplayer is verified here with the BroadcastChannel transport and the network simulator.
   - The PeerJS path is built and unit-tested with a mock.
   - The two-network test on the deployed build, and real-laptop FPS, need you.
7. **Single-player and Multiplayer are separate modes** (user note, 2026-10-24). The main menu has both.
   - **Single-player** has the two outdoor missions with their boss finales, skirmish against 1–3 AI colonies, and the sandbox. It runs locally with zero input delay.
   - **Multiplayer** opens the lobby (Create / Join, invite links). Matches are skirmish-style: 2–4 players plus optional AI slots, last queen standing.
   - Both modes run the same deterministic simulation and command queue. Only the transport differs: loopback for single-player, the network for multiplayer. So missions get replays and exact saves for free.
8. **`player` flag.** In the simulation, `player` now means "human-controlled colony". Which human is *you* is client-side only. Stat multipliers keyed on `player` become match settings that are the same for every client.
9. **Phases renumbered.** 10 is this upgrade, then 11 creatures (paused mid-way), 12 species, 13 modes, 14 audio/menus/saving (saves and replays reuse the snapshots and command logs), and 15 polish.

## 11. Phase 11 — creatures and bosses (done 2026-10-24)
- **Simulation.** The behaviour programs in `sim/creatures/` run in every game: the ecology spawner keeps wild creatures on the surface (`settings.creatures` scales it: 1 in games and matches, 0 in headless tests unless asked). They are deterministic (dmath, simulation RNG, state on the creature) and in the 20-minute determinism test.
- **Rendering** (`render/creatures/`). Instanced primitives and a posing rig. One body plan per kind with its states. Gait from the distance walked; trails for long bodies; culling and far blobs.
- **Bosses.** Telegraphs as filling red ground circles and cones; slam rings; hair clouds; camera shake; health bar with phase names.
- **Balance.** With creatures on, colonies grow the same as without (`tools/ecology.ts`).
- Bosses only appear through `?spawn=` until the missions (Phase 13) stage them.

## 12. Phase 12 — playable species and their special tiles, rival AI (done 2026-10-24)
Already in place from Revision 2: Lasius root-aphid pastures and aphid tending, Formica thatch and acid (mortar and rapid sprayers), Atta leaf cutting, minim hitchhikers and fungus gardens, Solenopsis venom, Mimic Ant borrowed castes.

To do, in this order:
1. **Fire ant mound** (Solenopsis; real biology: a mound of worked soil with no central opening, entered through foraging tunnels that surface away from it; workers carry brood up into the sun-warmed upper mound in the day and down again at night).
   - World: the fire ant nest's tunnel to the surface is long and winding, so the entrance opens some distance from the mound. The mound itself is drawn on the surface as a dome of granular soil with no hole.
   - Tile **Sun-warmed Brood Mound** (`mound`, build 15): each built one speeds brood growth by 8 / 12 / 16 % at levels 1–3, scaled by daylight (full by day, a quarter at night). Brood speed bonuses (thatch, mound) together are capped at +50 %.
   - The tile's decor is heaped sandy soil; by day, brood is drawn piled on it.
   - AI: one mound per 8 brood tiles.
2. **Rival AI war logic** (`sim/colonyAI.ts`, state on the colony, deterministic, only for `ai` colonies):
   - **Defence.** Enemies (other teams' ants, hostile creatures) near one of its surface entrances or inside its nest: marker II on them, and its fighter groups sent there. Lifted when clear.
   - **Attack.** When its fighters outnumber the target's estimated defenders by a margin (scaled by `settings.aggression`), it picks a rival (nearest entrance), sends the fighters to marker III at that entrance, then on into the nest toward the queen. It retreats when the army has lost more than 60 %.
   - Workers keep foraging; the queen's group stays home.
3. **Tests.** Fire ant entrances are away from the mound; mound tiles speed brood by day only; an AI colony defends its entrance; an AI colony with a strong army raids a weak rival and kills its queen.
4. **Screenshots and docs.** DESIGN species section, PROGRESS.

## 13. Phase 13 — game modes (single-player) (first pass done 2026-10-24)
The title screen already splits Single-player and Multiplayer. Single-player gets a mode choice:

1. **Missions** (two, outdoor, documentary tone). A mission is a script in the simulation (`sim/missions.ts`: stages, goals, narrator captions, spawns). It runs deterministically like everything else, so replays and saves cover it. Lose if the queen dies.
   - **A Meadow Kingdom** (meadow; default black garden ants, any species allowed). Found and grow the colony, gather food, beat off a hunting wolf spider. Finale: a male **stag beetle** (*Lucanus cervus*) blunders into the colony's ground.
   - **The Forest Floor** (forest; default red wood ants). Grow an army and break a rival black garden ant colony. Finale: a **wolf spider mother** (*Hogna*) carrying her spiderlings.
   - Captions share real facts at each stage (from the species and creature notes). The Missions button shows the brief and live goals.
2. **Skirmish.** The current setup screen: 1–6 AI colonies with teams. Win when every rival queen has fallen, lose when yours does. A result screen with colony stats.
3. **Sandbox.** The same setup with no AI by default, plus in-game sandbox tools (a panel): spawn any creature or boss where you click, fill the stores, infinite food, creatures on or off. These change the simulation, so they are commands (`sandbox*`), refused outside sandbox games.
4. **Tests.** Mission stages advance on their conditions and the finale boss appears. A mission game is deterministic (two runs, same hashes). Sandbox commands work only in sandbox.
5. **Screenshots** of a mission finale with the boss's telegraphs. Docs. A new prototype build.

**Done:** 1–4, docs, and the prototype build. The AI wins *A Meadow Kingdom* when it plays it headless (about 30 min). Mission bosses have half their sandbox health; the stage sizes may still need tuning after hand play. Still open: a mission briefing screen and medals (with Phase 14 saving), and the boss telegraph screenshot.

## 14. Phase 14 plan — audio, settings, saving
1. **Settings and profile** (`ui/settings.ts`, localStorage, wrapped so a blocked store just means defaults):
   - Settings: graphics quality, interface size, edge scrolling, volumes (master, effects, ambience, music), key bindings.
   - Profile: mission medals.
   - The pause menu becomes tabs: Game (save, load, replay, quit), Graphics, Sound, Controls (rebind any action; reset to defaults).
2. **Audio**: replaced by the user's audio brief (2026-10-24, see `docs/audio/README.md`). Nature first, built mostly from real recordings: every sound has file slots, with organic stand-ins until recordings are gathered (the libraries cannot be reached from the build environment). The first synth plan below is superseded.
   - *(superseded)* Web Audio synthesis only, no files:
   - Buses: master → effects / ambience / music, with a compressor at the end.
   - Effects from simulation events, placed by distance from the camera and heard only in the space being watched (surface or that nest):
     - dig crunch, bites and clicks, stings, acid hiss and splash;
     - deaths, a tile built, a hatch;
     - boss footsteps and slams, the boss phase roar, a telegraph warning;
     - message chimes, and victory and defeat stingers.
   - Ambience by place and time:
     - surface: wind, with birdsong by day and crickets at night;
     - underground: a low room tone with soil trickles;
     - a skitter that grows with the number of ants in view.
   - Adaptive music: a slow generative pad in a modal scale. A pulse and drum layer fades in with combat near your colony, and grows heavier while a boss is alive.
   - The audio starts on the first click (browser rule) and goes quiet when the tab is hidden.
3. **Save and load** (single-player):
   - A save is the canonical snapshot (Phase 10) plus a small header: build, mode, mission, species, game time, date. It is gzipped and kept in IndexedDB, in three slots plus an autosave every 5 minutes of game time.
   - Saves can also be downloaded or loaded from a file (`.udsave`).
   - The title screen gets **Continue** (newest save) and **Load game**. The pause menu gets Save and Load; F7 / F8 quick-save and quick-load.
   - A loaded game is the same world, deterministic from there. Its replay starts at the load.
   - Multiplayer has no saves: the host's snapshot already brings players back.
4. **Mission briefing and medals.**
   - A mission opens with a briefing card (the story, the stages to come, a species tip).
   - Completing it records a medal by game time (gold, silver, bronze), shown on its card in the menu.
5. **Tests.**
   - Headless:
     - a save round-trips (bytes → world → same hash), and the game runs on identically after a load;
     - settings survive a reload;
     - rebinding changes the action;
     - medals are recorded.
   - Browser: the audio graph starts without errors, and saving and loading from the pause menu brings back the same tick and colony.
6. Docs, screenshots, a new prototype build.

**Phase 14 done (2026-10-24):** settings and profile, pause-menu tabs with rebinding, saves (slots, quick save, autosave, files, Continue and Load), the mission briefing and medals, and the audio overhaul (catalog, stand-ins, engine, ambience, ants, creatures, interface, music, docs, tools, Credits, sound board). Tests: headless, `ui_save.py`, `audio_mix.py`.

## 15. Bug-fix release — combat spinning, collision, climbing, corpses, harvest, royals, queens, eggs, AI nests (user brief, 2026-10-25)
*Written 2026-10-25 after reviewing `sim/movement.ts`, `sim/combat.ts`, `sim/creatures/creatureAI.ts`, `sim/antAI.ts`, `sim/colony.ts`, `sim/jobs.ts`, `sim/termites.ts`, `sim/colonyAI.ts` and the creature renderers. The diagnosis of the spinning is in PROGRESS (2026-10-25). This release ships (and is published) before the next species: nasute royals kit v2.1, sickle-jaw termites, Termants.*

Decisions from the user's answers: both kinds of corpse are timed food; every queen of every species is immobile and passive; climbing is in this release; Atta balance waits; harvest is caste carry × level; dead ants are food for enemies only; AI colonies keep the queen's group and a third of their workers home; ants and termites climb; the termite king still guards; army ants become ordinary colonies (bivouac code removed; their models and animations are another agent's job).

### 15.1 Part 1 — no spinning, light collision
1. **Stable facing** (`movement.faceToward`): at most 360°/s (`BALANCE.combat.turnRate`), changes under 5° ignored, the heading kept when the target is under 0.3 mm away. Used everywhere an ant faces a foe (grapple, shooters, spraying, non-latching bites, nasutes, the king, hell-ant stalking). The bite wobble and the stinging ants' pivot round their bite are removed.
2. **Attack slots** (`sim/slots.ts`).
   - Ant targets: legs and antennae as slots, 4 per ant (6 on an ant 1.5× the attacker's length, 8 on a queen). Stored as a **world** angle, so a victim turning no longer swings its grapplers round it. The free limb nearest the side the attacker came from.
   - Creature targets: slots evenly along the body outline, a capsule per kind (`creatureBody`), one per 4.5 mm of outline (6–32; 12 on a ground beetle). Stored as a fraction of the outline in the creature's frame: grapplers cling to the body and turn with it.
   - Close to the target the ant walks to its slot, not to the centre. Every slot taken: it waits on an outer ring facing the target (backing off without turning round), and looks for another target every 2 s.
   - Mutual grapples: neither repositions round the other; both face each other.
3. **Creatures don't chase their own tails.** A creature never turns toward an ant that clings to its body (it turns with it: the ground beetle spun at 490°/s); it bites those where they hang, or shakes them off. Creature turning is rate-limited with the same dead zone, and a target that clings out of the jaws' reach is dropped.
4. **Soft separation** (`sim/separation.ts`, after the creatures, every other tick): radius 0.8 × body width, pairs once by id, pushes summed per ant and capped (0.15 mm a tick), shared by mass. Ants holding still on purpose (grappling, holding prey, pinned, queens) push others but are not pushed; the dead, the flung, climbers and riders, and prey held in jaws take no part. A creature's body pushes ants out (twice the cap), except its grapplers and riders; ants never push creatures. Pushes into rock are dropped.
5. **Verify** (`tools/spin-check.ts`): 50 v 50, 30 ants on a beetle, 60 workers leaving a crowded nest (separation on vs off), stress scene timing.

### 15.2 Part 2 — climbing large creatures and titans
- **Data.** `BALANCE.climb`: up 1.5 s, ride 8 s, down 1.5 s, cooldown 6 s, `damageMul` 1. **Riders scale with sizes** (user notes, 2026-10-25: "scale it to creature size and not difficulty"; "give ants size classes for climbing"): a creature's back has room for its area ÷ `roomUnitMm2` (20 mm²) units, and each rider takes the units of its **size class** by body length (up to 5 mm: 1, e.g. Lasius, fire ants, minims; up to 7.5 mm: 2, e.g. Formica workers, nasute majors; up to 10 mm: 3, e.g. Formica soldiers, Atta medias; bigger: 4, e.g. Atta majors, army-ant soldiers). At most `maxRiders` 32 ants at once (riding slots). Rooms: ground beetle 3, rove beetle, wolf spider and Lithobius 2, cutworm 8, mantis 13, hogna 32, giant mantis 60, stag beetle 111, tarantula 121, scolopendra 134. So a ground beetle carries three small workers, or one Formica soldier, and no Atta major. Rails and riding slots per kind in `sim/creatures/climb.ts`, authored in the creature builders' local frame (fractions of the length; +x forward, +y up, +z left): one rail per climbable leg from the foot up the tibia and femur to the body edge, then on to a riding slot; centipedes get rails along their body segments. Slots spread over the back (and head and abdomen on titans), at least one per climber, set slightly above the surface.
- **Sim state on the ant:** `rideId`, `rideRail`, `rideSlot`, `ridePh` (0 going to the foot, 1 up, 2 riding, 3 down), `rideT`, `climbCd`. State `AS.Climb`. Position each tick = creature root transform × rest-pose rail point or slot: one transform, no pathfinding, no separation, no flow fields.
- **Sequence.** An ant attacking (or holding on to) a climbable creature with its cooldown ready takes the lowest free riding slot (ants in id order) and walks to the nearest point of the nearest leg (a spider's long legs are climbed from wherever the ant meets them); if the cap is full it fights on the ground in an attack slot. Up 1.5 s, ride 8 s attacking with its normal attack point-blank (bites, stings, acid, glue: damage × `damageMul`), down 1.5 s, then 6 s cooldown fighting on the ground.
- **Untouchable** from the first step up the rail to the step off at the foot: no damage from anyone, never targeted (by the creature, its splash, or any other enemy).
- **Death of the creature:** every rider drops beside it with a short tumble and carries on. Water and other ground the ant could not reach do not matter while it is on the creature.
- **UI and debug:** the riders counter on the creature's health bar (room taken / room; small bars over climbable creatures that are hurt or carrying ants, and on the boss bar); a debug overlay (dev panel toggle and `?climbdebug=1`) draws rails and slots.
- **Render:** each creature builder records its animated leg chains (hip, knee, foot) and body frame; a climbing ant is placed on the animated leg at its progress and pitched along it, a rider on the animated body with a slight sway, slightly above the surface. Uses the normal ant instances; presentation only, nothing feeds back into the sim. Climbing uses the walking gait on the leg; riding uses the grapple pose with the three melee attacks.
- **Audio:** scrabbling claws while climbing, harder bites while riding, a soft thud when dropping off.
- **Stress:** 4 titans with full caps and 1,000 ants on the ground within the targets in `docs/performance.md`.

### 15.3 Corpses (both are food, timed)
- A dead ant lies 1.4 s (as now), then becomes food that only **enemies** may pick up for 2 s, then sinks into the ground and is deleted (drawn sinking).
- A dead termite stays food for 7 s, open to its predators (any ant colony), then sinks and is deleted.
- Creature carcasses are unchanged.

### 15.4 Harvest instead of co-op hauling
- Co-op carrying (`AS.CoopCarry`, the wait for helpers, carriers sharing a load) is removed.
- Each ant takes a load of its caste's carry × its level multiplier (1, 1.25 at level II, 1.5 at level III) from a food source and brings it home; a small item it can lift whole is carried whole. Big items (carcasses, large crumbs) shrink as they are harvested.

### 15.5 Termite royals and all queens
- The king and queen are separate bodies: the king stands beside the queen, not inside her, and keeps guarding and biting intruders in the royal chamber, invulnerable while she lives.
- Enemies never target the king; they go for the queen.
- **Every queen of every species** stays still where she is placed, never moves, never fights back; she only takes damage and lays eggs.

### 15.6 Eggs (EotU style)
- No pile of eggs at the queen's abdomen. She makes eggs internally at the same rate (the internal count is kept and capped); a worker walks to the tip of her abdomen and pulls one out, then carries it to a brood tile.

### 15.7 Smarter AI colonies
- The queen's group plus about a third of the workers always stay home on nest jobs (egg pulling, nursing, storing, digging).
- They dig chambers EotU-style: 7-hex rosettes for brood and for food stores, joined to the rest by short tunnels.

### 15.8 Army ants as ordinary colonies
- Remove the bivouac code (`Colony.bivouac`, the bivouac branches in movement, antAI, warAI, mounds and surface decor). Army ants keep their stats and look, nest and grow like other colonies.

### 15.9 Release
- `npm test`, the species tests, browser checks, the determinism hash, the stress scene; DESIGN / README / PROGRESS; commit; build; publish as a new version of the existing artifact; re-zip `dist`.

## 16. Combat v2 — EotU-style fight spacing, large-creature AI, titan mounting (user spec 2026-10-31)
Spec: project doc `claude/combat/02-spec-combat-v2.md` (replaces / extends §15 and `claude/combat/01-spec-collision-and-climbing.md`). Branch `feature/combat-v2` (from `main`). Everything below is sim state: deterministic (dmath, `w.rng`, id order, per-tick caches on `World.tickCache`), numbers in `BALANCE.combat2` / `BALANCE.mount`, new optional fields default to 0 (never `undefined`: hash key order, PROGRESS.md 2026-10-25).

### Survey: what there is now (and what the spec changes)
- **Spacing.**
  - Body radius 0.224 L (`separation.ts antRadius`). Hit radius 0.45 L.
  - "Room in a fight" is ×1.9 (`GUARD.fightRoom`) for every pair in fight stance, friend and foe alike, about 0.85 L centre to centre, at the walking strength (0.5) and cap (3 mm/s).
  - The spec wants a personal-space radius of 1.3–1.6 L between allies in a fight (stronger than walking), and only body radius between enemies who are not fighting each other.
- **Slots and stopping.**
  - Ants: fixed limb slots, 3 / 4 for big victims / 8 for queens (`slots.ts`). Creatures: one per 4.5 mm of outline, 6–32 (a ground beetle gets 12; the spec wants 6–10).
  - Slots are claimed only on latching, so several ants approach the same limb.
  - Stopping is centre-based (`d ≤ 0.45 (Lv + La)`). The grapple holds at 0.84 × the mean length, so the bodies overlap head to head.
- **Overflow.** A ring at `reach + 1.3 L` and `findTarget` again every second. That does not prefer targets with free slots, so a waiting ant often re-picks the same one. There is no flanking choice and no "can't reach: pause and reposition".
- **Targeting.**
  - Score = d² × ahead × (1 + 0.8 × attackers) / (1 + threat). The crowd penalty is soft, so mobs still form; creature targets get none.
  - Getting bitten retargets every non-grappling ant, so targets flicker.
  - No focus-fire order.
- **Large creatures.**
  - One solid capsule: nothing goes under, and there are no leg footprints.
  - No threat table; the target is the crowd-biased nearest.
  - Splash attacks are centred on the creature, not aimed at clusters. Not every attack is telegraphed.
  - Riders are never shaken off.
- **Climbing.**
  - Any non-royal ant climbs, capped by area room units (stag 111, up to 32 riders).
  - Rails run foot → knee → one back slot, and slots fill lowest index first, so riders bunch at the rear.
  - No ratio, ground-force rule, mount bonus, basic-attack-only rule, death on leaving the map, or dismount on noAttack / noClimb.
  - Nothing in the data marks a creature as huge, only `boss`.
- **Tests that pin v1 numbers** (to update with the new rules): combat.ts `maxRiders ≥ 24` and `caps.stagBeetle === 32`; arena.ts `riders ≥ 20`; fights.ts `antSlots === 3 && bigAntSlots === 4`.

### Plan (in this order; each step committed with its tests)
1. **Spacing** (`separation.ts`, `BALANCE.combat2`):
   - Allies who are both in a fight keep `personalSpace` 1.45 L centre to centre, using the larger ant's length, at a stronger push (`fightStrength` 0.8, cap ×2).
   - Enemies who are not engaged with each other keep body radius only, so lines can meet.
   - An attacker and its own target keep exactly the hold distance (step 2).
   - The guard line's spacing stays as it is; it is already wider.
2. **Stop at reach, head to head without overlap** (`combat.ts`, `slots.ts`):
   - The victim's outline is an ellipse: half its length along, its half-width across (ants: 0.5 L × 0.14 L; creatures: the existing capsule).
   - The hold point is the outline in the slot's direction plus the attacker's front half (0.5 La − its own mandible overlap of 0.08 La). Approach stops there, and the grapple holds there.
3. **Slots sized by perimeter:**
   - `n = clamp(floor(perimeter(outline offset by 0.5 La) / (0.28 La × spacing 2.2)), 2, cap)`. A worker on a worker gets about 3, a 16 mm beetle about 8, a 100 mm boss about 24 (`slotsMax` 24). Queens keep a minimum of 8.
   - Slot positions are spread evenly along the outline.
   - Slots are **reserved on approach** in a per-tick cache (id order), so two ants never head for the same slot.
4. **Overflow and duel distribution** (`findTarget`, `waitForSlot`):
   - Targets with no free slot are skipped unless the ant already holds one there.
   - The score weights the attacker count heavily (`crowdPenalty` 2.5), so a clash breaks into 1v1 and 2v1 duels.
   - An ant with no target that has a free slot (a) takes the nearest one within its vision radius; else (b) flanks round the outline to a free slot on the far side, if there is one; else (c) waits on a loose ring at personal-space distance, facing the fight, and steps in when a slot frees (checked every 0.5 s).
   - **Focus fire** only when a marker sits on an enemy (within 6 mm of it) or when the target is outnumbered 4 to 1 or worse. Those ants ignore the crowd penalty and may take the ring places.
   - Being bitten retargets an ant only when its current target is out of reach (no more flicker).
5. **Reposition when blocked:** an attacker that hasn't closed 0.1 L on its hold point in 1 s pauses attacking for 0.5–1 s (`w.rng`), then sidesteps along the ring (seeded side) before it tries again. It no longer shoves forever.
6. **Under large creatures** (`creatureAI.ts`, `separation.ts`):
   - Each creature kind gets an underside clearance (fraction of L) and foot points (the climb rails' feet).
   - Ants shorter than the clearance collide only with foot circles, not the body capsule, so they walk and fight under it.
   - The body still pushes ants that are taller than the clearance.
   - Creature slots include points under the body and at the legs.
7. **Creature threat and splash AI:**
   - `cr.threat`: a small id/value list, add damage × caste threat, decay 10 %/s.
   - Retarget only to an ant whose threat is 1.3 times the current target's (stickiness).
   - Splash attacks (stag clamp / rear, tarantula frenzy / flick, scolopendra whip / constrict, mantis cone) are aimed: the centre or cone direction with the most ground ants in reach (a fixed set of candidate directions, counted in id order). The creature turns toward that cluster first.
   - It backs off a few mm when surrounded (≥ 10 within 0.6 L) and its hp is below half.
   - Every splash attack telegraphs its area.
   - Titans (bosses) get a telegraphed **shake-off** that throws riders down (stag: rear-and-shake; tarantula: roll; scolopendra: thrash), roughly every 20 s once riders ≥ half the cap.
   - Wolf spiders pounce and drag an ant 1–2 body lengths out of a cluster.
8. **Mounting rules** (`climbing.ts`, `BALANCE.mount`):
   - Creature size class: **large** (non-boss climbables) or **huge** (bosses).
   - Caste mount class from data: small (default), large (≥ 7 mm or flagged: leafcutter mediae/majors, army-ant majors, fire majors, termite major soldiers) or none. Small castes mount large and huge; large castes mount only huge.
   - Fixed caps: large 8, huge 12. These replace the area room units.
   - **Ratio:** a colony's riders on a creature are at most 30 % of its ants fighting that creature (riders plus ground attackers). Over the ratio, the longest-mounted rider climbs down first. No ground force, no mounting.
   - **Mount bonus:** riders ≥ half the cap → +25 % damage taken from everyone.
   - **While mounted:** basic attack only, no acid or glue; fire ants keep their sting.
   - **Dismount:** the timer (8 s, then a 6 s cooldown); the creature dies (drop and tumble); it leaves the map (riders die); the marker's no-attack / no-climb order (climb down).
9. **Placement on the creature** (`tools/climb-data.ts`, `climbData.ts`, `creatureRenderer.mountPose`):
   - Per creature, author **climbing points** at the feet and lower legs (the existing rails), **weak points** (head–thorax joint, leg bases, thorax–abdomen joint, top of the abdomen, neck) and **mount slots** spaced evenly round the weak points (≥ 1.2 rider lengths apart).
   - Each rail runs foot → leg → its weak point.
   - New riders take the free slot farthest from the occupied ones, so riders spread front to back on both sides.
   - Render: slots oriented to the body surface (belly down, facing the weak point), lifted clear, following the animated frames.
   - The debug overlay shows climbing points, rails, weak points and occupancy.
   - Authored for: stag beetle, tarantula, Scolopendra, giant mantis, hogna (the wolf-spider mother), mantis, ground beetle, rove, wolf spider, Lithobius, cutworm.
10. **UI:**
    - Health bars and the boss bar show riders / cap and a mount-bonus icon.
    - Caste cards say "Mounts large and huge creatures" / "huge only" / "cannot mount".
    - The marker toggles dismount riders.
11. **Tests and checks:**
    - Update the v1-pinned numbers.
    - New tests:
      - spacing (allies ≥ 0.9 × personal space in a fight; enemies at body radius);
      - stop-at-reach (no body overlap in grapples, using the outline ellipses);
      - slot counts by perimeter (worker 2–4, beetle 6–10);
      - reservation (no two approachers on one slot);
      - overflow (flank, switch, ring), reposition when blocked;
      - under-body movement and foot pushes;
      - threat stickiness and splash aiming at the densest cluster;
      - mount size rules, caps, 30 % ratio and dismount order, mount bonus, basic-only, dismount conditions;
      - determinism (replay and restore);
      - performance: 400 v 400 ants plus 4 titans at full caps, under 15 ms a tick (`tools/stress.ts`, `tools/climb-stress.ts`).
    - Browser: 60 v 60 before / after screenshots against the reference and `tools/fightspread.ts` numbers; titan riders at default zoom; clips and shots in `docs/combat/v2/`.
    - Update DESIGN.md §3.8–3.10, README.md and PROGRESS.md.

## 17. Combat v2.1 — anchored attacks, back off and go around (user spec 2026-10-31)
Spec: project doc `claude/combat/03-spec-anchor-and-flow-around.md`. Branch `feature/combat-v2.1` from `main` (`1803902`). Evidence: `tools/drift-probe.ts` (every sim system wrapped; each tick's movement and turning of an attacking unit attributed to the system that made it), output in `docs/combat/v2.1/before/probe.txt`, a per-tick trace in `docs/combat/v2.1/before/trace-clash.txt`, clips in `docs/combat/v2.1/before/` (`tests/browser/combat_v21.py`, hitboxes on).

### 17.1 Findings: what moves an attacking unit
Measured on the base (seed 4, 20 s; % of the unit's body length per second, by system; degrees per second):

| scene | attacking units | moves | turns |
|---|---|---|---|
| 60 v 60 clash | holding an ant, one-way | 314 % BL/s (own hold-follow 191, separation 123) | 101°/s |
| | holding an ant, mutual | 95 (separation 65, own easing 30) | 63°/s |
| | spraying | 117 (separation 115) | 79°/s |
| Formica v Lasius | spraying / shooter holding range | 52 / 48 (separation 44 / 27) | 58 / 23°/s |
| ants on a tarantula | planted at it | 109 (own step-after 108.5) | 23°/s |
| ants on a wolf spider | planted at it | 116 (own 72, separation 43) | 24°/s |
| tarantula | 0.3 s before to 0.2 s after a bite | 31 % BL/s | 3°/s |
| wolf spider | the same (pounce, then its bites) | 87 % BL/s | 41°/s; 72°/s while pouncing |
| stag beetle | the same (its pinch) | 2.9 % BL/s | 10°/s |

1. **Separation moves attackers** (`separation.ts`). An ant holding an ant is movable in a "fight" or guard-line pair (`ma = … || ((fight || line) && fa & 32)`); planted ants at a creature (`gKind 4`), sprayers and shooters are always movable. Of the separation movement of attacking ants in the clashes, 67–75 % comes from a fighting ally inside the personal space (1.6 L, strength 0.8, cap × 2 = 0.6 mm a separation tick), 6–29 % from an ally closing in with bodies touching, 6–10 % from enemies; at creatures 44–100 % is the body and feet. Trace: spraying ant 17 is pushed the full 0.6 mm on every separation tick while it fires.
2. **The holds re-follow** (`grappleUpdate`). A one-way hold walks to its hold point (a world angle round the victim) every tick at up to 2 × walking speed (`combat2.holdFollow`): when the victim is shoved or walks, the holder follows (trace: ant 102 creeps 0.03–0.1 mm a tick). A mutual hold eases half the distance error a tick. A planted ant at a creature steps after it (`steerTo`) when the creature moves more than 0.45 L, and is shoved back out when the body swings in.
3. **Facing** is re-aimed every tick (`faceToward` in grapple, spray and the shooter's hold: 60–100°/s). Ant bites are a timer (`cd`); there is no wind-up / strike / recovery.
4. Not a cause: velocity (`a.v = 0` in every attack branch: nothing coasts).
5. **Re-chasing inside an attack**: the creature hold's step-after (2); the ant holds' follow (2).
6. **Creatures.** Hunters (ground beetle, rove, centipede, spiderlings) and the arena's creature-on-creature bites have no wind-up: they face the target at 6 rad/s and bite on the timer. The stag beetle's pinch bites while it walks or turns. The tarantula's lunge and the giant centipede's coil snap the heading to the aim (`cr.h = dir`) as the wind-up starts. The wolf spider's wind-up turns at 7.5 rad/s, and its pounce steers at a point (72°/s). Already still: the stag beetle's clamp wind-up, the mantis strike, the tarantula wind-up, the centipede coil, every shake-off. Creatures push each other during attacks (`creatureSpacing`); creature feet push planted ants whether the creature walks or attacks.
7. **Render: not a cause.** Interpolation (`px → x`) adds nothing to a unit that does not move; ant and creature gaits advance only with distance walked (ants: and turning), and a stationary ant's feet settle (`antRenderer`). The sliding is the sim moving the unit. `render/ants` stays with `feature/realism`.

**Shoving:**
8. Ants closing in steer straight at their hold point; with a teammate in the way, separation splits the overlap by mass, so the walker pushes the one in front, often a holder (above: 6–29 %). A teammate's body against an ant's front while it closes in: 2–3 % of closing-in ticks in the clashes, 8–10 % at a 16 mm ground beetle and a 12 mm wolf spider; up to 0.4–0.95 s at a time.
9. The blocked rule (`blkD`/`blkT`) needs 1 s without gaining 0.1 L, and pushing an ally forward counts as gaining, so it rarely fires; when it does, the ant pauses 0.5–1 s and sidesteps to a random side (`w.rng`), possibly back into the same press. Nothing remembers the blocked spot.
10. The ally push has no direction rule: it can push an ant toward the enemy.
11. At a ground beetle charged from the west, no holder is on the far side after 4 s, 2 of 4 at 6 s, about half by 10 s: the far slots fill slowly, by flanking.

### 17.2 Plan (each step committed with its tests)
1. **Anchor state (ants).** An ant is anchored while it holds a foe (Grapple, on an ant or planted at a creature), during a spray shot (plant, rear, fire, settle), while a shooter holds its range, while it holds prey, during a recovery after an attack ends (`anc`, seconds left) and during a small planned step (`stp` seconds, toward a fixed point `stx`, `sty`). `anchored(a)` in `slots.ts`. Bites get phases from the bite timer: wind-up = the last `combat21.windupSec` before the bite (`a.cd`), strike at the bite, recovery after. Facing turns only in the wind-up, at `combat21.windupTurn`; locked otherwise.
2. **Separation.** Anchored ants are never moved by other ants: a fixed obstacle (the other one takes the whole push). Right of way between allies: anchored (3) > holding or closing in on a reserved slot (2) > looking for a slot, waiting, going round (1) > the rest (0): the lower one moves alone; equal: by mass as before. An ally push on a fighting or closing-in ant loses its component toward the ant's target (never pushed into the fight). A creature body or foot moves an anchored ant only while the creature walks (not during its attack); that cancels the ant's attack (recovery, then it re-plants). Anchored creatures are not moved by `creatureSpacing`.
3. **Holds** (`grappleUpdate`): no hold-follow, no easing, no step-after. The hold distance is checked each tick: within `reachTol` × L, bite on the timer; off by up to `stepMax` × L between bites → one small step (`stp`) to the hold point, then re-anchor; farther (the foe left reach) → the hold ends where the ant stands, `recoverSec` of recovery, then it closes in again (Attack). Mutual holds: both anchored; the same rule. A creature turning into a planted ant is a push from a large creature: the ant's attack is cancelled and it re-plants.
4. **Sprays and shooters**: anchored per shot (turning only before the jet), shooters holding range anchored (turning slowly between shots); moving to keep range only between shots.
5. **Creatures**: `cr.anc` (seconds) and a facing lock. Every bite has a wind-up (`combat21.crWindupSec`, turning at most `crWindupTurn`), the strike, a recovery (`crRecoverSec`) — hunters, the stag beetle's pinch, the arena's creature bites. No heading snaps: the tarantula lunge and centipede coil turn toward the aim during the wind-up; the lunge, pounce and coil strike go along the heading fixed at the strike start (planned paths). Splash areas are fixed when the wind-up starts. Backing off only between attacks.
6. **No shoving.** Blocked: a teammate in the forward cone (`blockCone`) within a personal space and no closer to the slot or target for `blockedSec` (0.3 s). Then: back off `backOffLen` × L over `backOffSec`, turning a little to the chosen side; pick a side (more free slots, fewer allies on the way; ties by id parity); walk round on a ring (target outline + reach + personal space, outside the fighters) to the nearest free slot on that side, keeping the side; reserve it on arrival, move in, anchor. Nothing free all round → another enemy with room, or wait on the outer ring (v2). The blocked slot is remembered (`bkS`, on `rsv`'s target): never tried twice in a row. Replaces v2's pause and sidestep.
7. **Avoidance instead of pushing.** Ants closing in, going round, waiting, and squads walking to a marker steer sideways round teammates in their path (look-ahead `avoidLook` × L, cone `avoidCone`): a cheap velocity-obstacle test against nearby teammates (the spatial grid), turning away from the nearest one ahead by up to `avoidTurn`; ties by id.
8. **Numbers** in `BALANCE.combat21`; DESIGN.md §3.8.
9. **Debug view** `?combatdebug=1` (and in the arena's panel): a pin on anchored units, blocked (red), backing off (an arrow back), the side chosen (an arrow along the ring), the target slot, free / taken slots round each target.
10. **Tests** `tests/combatV21.ts` (the spec's checklist), the v2 tests that pin the follow and the pause-and-sidestep updated; clips after; stress (400 v 400 + 4 titans); determinism; LAN tests; docs; merge; the artifact (with `feature/realism` combined while it is unmerged).

## 18. Creature melee reach from the body outline (user note 2026-10-31)
"Maybe a factor that makes them move so much is that they all have too short of a range — how about increasing some of the melee ranges of the creatures in a realistic manner so they don't move too much when fighting." Branch `feature/melee-reach` from `main` (`1ec3f1b`). Evidence: `tools/fight-motion.ts` (every sim system wrapped; each tick's movement of a creature that is fighting, and of every fighting ant, put down to the system and the state that made it; hold endings by cause; `kill` mode: real health), clips `docs/combat/reach/` (`tests/browser/melee_reach.py`).

### 18.1 Findings
Seed 4, 20 s, 40 Black garden ants (a quarter soldiers) round one creature; % of the creature's length a second:

| creature | walks | turns | bites | ants' grips lost a minute | why |
|---|---|---|---|---|---|
| ground beetle | 5.1 | 11°/s | 18 | 1.8 | bite reach from its centre (radius + 3 mm) is short of the ants at its head and tail: it walks at them |
| rove beetle | 15.4 | 46°/s | 5 | 18.2 | the same, a longer body: it walks while ants hold it (9.7 ticks a second), their holds end |
| stone centipede | 14.9 | 30°/s | 17 | 4.3 | the same |
| stag beetle | 2.0 | 9°/s | **1** | **82.5** | walks while its target is over 0.45 L from its centre, but ants planted at its head stand at 0.48 L: it walks into its own attackers and never stops to pinch |
| mantis | 0 | 28°/s | 4 | 34.9 | strike reach 0.42 L from its middle, short of its own head (0.48 L): only ants beside its forelegs; it swings to track ants and sweeps the holders |
| tarantula | 7.2 | 34°/s | 7 | 39.5 | a 0.4 L lunge each strike, and walking to crowds |
| giant centipede | 11.4 | 65°/s | 3 | 5.8 | strikes when an ant is within 0.35 L of its *middle*, then lunges the whole 180 mm body 0.3 L |
| wolf spider / mother | 122 / 51 | 14 / 25°/s | 19 / 8 | 7.0 / 9.1 | pounces from 16 mm (sprint at 3 × speed) even on ants its front legs could reach, then drags its catch |

Also found: an ant may latch up to 2 × `arriveTol` (0.3 L) inside its hold distance at a creature, but a hold was cancelled once the body was more than half the hold distance (0.21 L) inside it: those ants latched and cancelled every other tick without moving or biting (most of the stag's 82.5). Arena creature-on-creature reach was the two radii from the centres, so long bodies could not reach each other's ends.

### 18.2 Changes
1. **Reach from the outline** (`BALANCE.creatureReach`, `creatureReachDefault`): per kind the jaw, fang or foreleg reach beyond the body capsule (× its length) and the strike arc each side of its heading, seen from the front of its body (DESIGN §3.8). `inReach` (an ant's centre within reach × L + half the ant's length of the outline), `inStrike` (and in the arc).
2. **Reach first** (`reachPick`, `standAndFace`): in reach, a creature stands and strikes; an ant in its arc first, then threat, then the one nearest its heading; sticky; retaliation (× 1.3 threat) still wins. An ant in reach outside the arc it turns to (3 rad/s) — never a long body to an ant planted beside it (it would sweep the others off). Only with no ant in reach does it walk. Hunters, the stag's pinch, wolf spiders (an ant in reach is grabbed without the sprint), the tarantula (the strike area is its front legs' reach in front of it, fixed at the wind-up; the body lurches 0.1 L instead of lunging 0.4 L), the giant centipede (the head strikes an ant in its arc, the body does not move; it lunged 0.3 L), the mantis (the raptorial reach past its head; it turns only to ants not holding it), bite landing (`biteSeq`: reach and arc × 1.3), the creature system's and `pickAnt`'s "clinging out of reach" checks.
3. **Arena creatures**: reach capsule to capsule (`bodyGap`), facing the foe's nearest point from the front of the body.
4. **An ant holding a creature**: a little way inside its hold distance it steps back between bites (as a little way outside); only over `stepMax` inside is the hold cancelled.
5. Tools: `tools/fight-motion.ts`; tests `tests/combatV21.ts` (the one-sided split is checked at 6 s); clips; docs.

## 19. Ants circling one foe (user note and screenshot 2026-10-31)
"Maybe they should have smaller collisions cos now there is a bug where they circle around a single ant like this when they shouldn't." Branch `feature/no-orbit`. Evidence: `tools/orbit-probe.ts` (45 Black garden workers v 6 Red wood workers and 2 soldiers in the arena; each second the ants waiting or going round, those idle while a foe they could attack had room, the most on one foe, how far out the waiters stand, how much they walk).

**Causes.** (1) Focus fire: with our side outnumbering the foes in sight 4 to 1, `findTarget` dropped the crowd penalty *and* let a full foe be chosen, so every ant took the nearest foe and the overflow waited on it while other foes had free slots (seed 7: 57 % of the fighting time idle that way). (2) Waiting: ants waiting on the same foe kept only their bodies' room and were held on an exact ring a personal space out (stepping back on to it whenever pushed past half a body length): with 30 of them, a ring shoulder to shoulder that overflowed into a spiral and kept moving — waiting ants walked 1.6–2 body lengths a second.

**Changes.** Outnumbering drops the crowd penalty only; a full foe is chosen only when no foe in sight has room (or a marker is on it), and then the waiting is spread by the crowd on each. Waiting ants stand anywhere in a band from just inside the ring to `combat21.waitBand` (3) of their lengths beyond it; two waiting teammates keep `combat21.waitSpace` (1) × the larger length apart and ease apart at the walking strength; a waiting ant and a teammate fighting keep a personal space even on the same foe.

## 20. Combat v2.2 — unit heights: smaller ants walk and fight under taller ones (user spec 2026-10-31)
User spec: project doc `claude/combat/04-spec-height-and-underpass.md` ("Unit Heights: Smaller Ants Walk and Fight Under Taller Allies (Leafcutters and Army Ants first)"). Branch `feature/underpass` from `main` (`ab4d193`). Research and the measured table: `docs/combat/underpass.md`.

### 20.1 Plan
1. **Heights from the models** (`tools/heightLib.ts`, `tools/height-data.ts` → `src/sim/heightData.ts`): per ant morph (termites included) and creature kind — height, the lowest point under the body in three zones (rear, middle, front; zone limits per model), half-width and feet, as fractions of the length. A test fails when the file no longer matches the builders. The published build regenerates it from the realism + main models.
2. **The rule** (`src/sim/underpass.ts`, `BALANCE.underpass`): A fits under B in a zone when A's height × 1.1 ≤ B's clearance there in B's pose (braced bite: front × 0.5; a porter carrying: middle 0; rearing: front × 1.3; dead or flung: 0). Stacking: ⌊L_B / (3 L_A)⌋, 1–4.
3. **Separation**: a pair that fits (allies; enemies with the toggle) is not pushed apart while the small one is under the body (it counts toward the stack); the tall ant's feet push only the ants under it. One that no longer fits steps out sideways (a planned move, only it moves); mid-attack it stays and B's braced front waits (`Ant.fhd`, sim state). Creatures: the model's zones and feet replace `combat2.clearance` and the climb rails' feet.
4. **Two-layer slots**: an attacker may take a slot held by one teammate it fits under at that spot (creatures: ring 0; ants: the sector). Full: an under slot on a tall enemy ant (`Ant.gUn`, angle + 100 in the held list), at most the stack, its sides first.
5. **Movement**: avoidance ignores teammates you pass under (or that pass under you).
6. **Visibility**: outline of hidden ants; click cycling; health bars; posture handed to the realism session.
7. **Debug view** in `?combatdebug`; tests `tests/underpass.ts`; clips; docs; determinism, multiplayer, performance.

### 20.2 Findings
- Shipped models: the Atta minim fits under the media, soldier and major (rear and middle; their heads are low) and the queen; the media does not fit under the major (needs 3.14 mm, 1.99). The Eciton worker fits under the soldier (rear and middle) and the queen, not under the porter (needs 1.68, 1.55) or the media (1.58). Handed to the realism session with the models.
- Creatures are lower than combat v2 assumed: a ground beetle's middle is 0.74 mm (v2 1.36), so Lasius workers no longer fight from under it; wolf spiders, rove beetles and stone centipedes likewise; titans unchanged.
- Fights against creatures gain little (v2's slots were already per attacker size and allies on one foe never kept a personal space); the gain is in walking (no detours round big teammates, no shoves) and in small ants under tall enemy ants.
- Performance: lazily added `Ant` fields gave the ants many more V8 object shapes (everything reading ants ~20 % slower); `makeAnt` sets them to 0.

## 21. One wide underground entrance, three surface holes per anthill (user spec 2026-11-01)
User spec (2026-11-01 22:47, "REWORK — One Wide Underground Entrance per Nest, Three Surface Holes per Anthill (EotU-style)"). Replaces the extra-entrance feature of `claude/maps/02-spec-nest-entrances.md` / `03-entrances-decisions.md` (spots, digging them out, plugging, reopening); keeps the species surface models, validator, throughput, invasion, collapse, markers and transition fade. Branch `feature/one-entrance` from `main` (`fc6f58a`). Decisions: a 7-hex flower underground; three surface holes sharing it; always open.

### 21.1 Model
- **One entrance per nest, three surface ends.** `Colony.entrances` stays an array but always holds the anthill's **three holes** (`Entrance` records: `sx, sy` the hole, `cr, crT` its own throughput credit, `fall` cave-in, new `n` ants through it — a deterministic counter for the tooltip). All three share one underground end: `q` = the flower's centre hex. `shut` and `work` are dropped (holes never close). One record per hole keeps every `c.entrances[i]` user working and gives each hole its own `ENTRANCE.passPerS` credit as the spec asks; `w.entrancesOf(space)` returns the three holes of the one entrance.
- **NestGrid**: `entrances = [centre]`; `tunnels = [spine]` (outer-top hex, centre, inner hex: the line the ramp follows); new `flowers: number[][]` (the 7 hexes, centre first). `isEntrance(q)` = in a tunnel or a flower; `tunnelIndex` → 0 for flower hexes. `spots`, `shafts`, `addSpot`, `removeSpot`, `spotIndex` deleted (also from `NestGridSnap`/`NestGridData`, the worker grid delta and the replica). New helpers `flowerTop(g)` (the 3 flower hexes farthest along the outward direction queen → centre, where ants arrive and leave) and `flowerInner(g)` (the flower hexes whose neighbours lead into the nest, where defenders stand).
- **Caves** (spaces 64+) keep their single 3-hex tunnel and one hole (`ENTRANCE.caveTunnelLen`; DESIGN note). Shared code takes "a flower if the grid has one, else the tunnel top".

### 21.2 Underground: the flower
- `createColony`: every species walks the standard passage north from the queen (the fire ants' long tunnel goes: their holes now sit at the dome's edge). Flower centre = the last passage hex whose six neighbours are all inside the grid (else the one before); soften and complete all 7 hexes and the passage; the ring round the flower stays soil (except the passage). No random numbers beyond the existing queen placement.
- Speed: all 7 at `ENTRANCE.tunnelSpeed` (highway). Tiles: `isEntrance` blocks building on all 7 (`tiles.ts`, AI planners, `developNest`).
- **Arriving**: `enterArea` into a nest with a flower puts the ant on one of the flower's top hexes, picked by `hash(a.id, tick)` (not the sim RNG), at a hashed offset inside it, facing down into the nest. Caves unchanged (they keep the RNG angle so cave replays do not shift).
- **Leaving**: the exit field targets the core cells of the 3 top hexes; `tryExit` fires inside any of them; then the hole is chosen (21.3).
- **Defenders**: home guards and termite majors (nasutes "hold the entrance chokes") post on the flower's inner-edge hexes, spread by id (were `c.entrances[a.id % n].q`). Termant carton walls, guard lines and the war AI read the flower instead of tunnels.
- **Removed**: `markSpots`, `spotBlocked`, `designateSpot`, `openDugSpots`, `surfaceFor`, `setEntranceShut`, `extraCount`; plugging in `entranceTick` (collapse stays); `JOB.Entrance` work (the id stays reserved), the entrance dig priority and `entranceDigWorkers`; the colony AI's `aiEntrance` and spot avoidance; Dig/Delete special cases at the nest edge and their tips; Free Play goal "Open a second entrance"; build-panel and help text; dashed spot rings on the nest map and minimap; the shader's spot rim. `ENTRANCE.maxExtra/tunnelLen/spotMin/spotMax/closeS/aiExtraAt` go.
- **Command**: `entrance` (wire id 23) stays in `TYPE_IDS` and the codec so old replays still parse, but `applyCommand` rejects it; `speedVote` keeps 24. `BUILD_ID` `ud-mp-5` → `ud-mp-6` (mixed versions refuse to join).

### 21.3 Surface: three holes
- **Placement**: authored maps — the site's main spot and its two extra spots (`SiteHexes.entrances[0]`, `extras[0..1]`, already validated dry, flat, off walls, water and flood zones). Maps without sites (generated, formicarium, arena) — three points `ENTRANCE.holeR[species]` from the colony centre, 120° apart, the first toward where the main hole was; each moved to the nearest walkable ground (`nearestWalkable`, no RNG); never closer than `ENTRANCE.holeGap` to each other.
- **Validator** (`mapValidate.ts`): every site has three holes (1 + 2), each dry, flat, reachable by land, pairwise ≥ `holeGap` apart.
- **Leaving**: an ant at the flower's top picks the hole nearest its destination — a marker: the marker's shared surface field (`mk:<colony>:<i>`, the one `approachSurface` already builds) sampled at the holes; food, a trail target or a foe: straight distance; none: `a.id % 3`. If that hole has no credit and another with credit lies within `ENTRANCE.switchMm` more, it takes that one; else it waits in the flower facing up.
- **Coming home / invading**: nearest hole (`nearestEntrance`, `nearestOf`); a waiting ant switches to another hole of the same anthill with credit when it is at most `switchMm` farther; enemies and creatures go down any hole and arrive in the flower.
- **Throughput**: per hole (`passPerS` 10, `burst` 4): three holes move three times the traffic of one.
- **Always open; collapse**: a dead colony's three holes and its flower cave in over `collapseS` (60 s); the nest render puts a soil cap over the flower.
- **Markers**: a marker within `ENTRANCE_SNAP` of any hole, or inside the flower, means "this entrance" (`entranceAt`).

### 21.4 Looks
- **Nest**: `nestTerrain.heightAt` ramps the whole flower up toward the outward side (by the distance along the spine, ~1.7 R wide), highest and darkest at the top; the daylight/moonlight beam widens to cover it (`tileDecor`); the species tunnel touches (thatch, leaf bits, carton lining, frass, granular soil) spread round the flower's rim; the hex-type and level shading (`nestView`) read the flower.
- **Surface** (`entranceModels.ts`): each species' structure centred on the holes' centroid (the anthill), three equal holes (no main/extra sizes), the species details per hole (spec §2 Looks); fire ants: the dome with three small holes at its edge; army ants: three streams at the bivouac. Meshes rebuild only on a size step or cave-in; instancing and LODs kept (10 colonies × 3 holes).
- **Minimaps**: surface — a queen icon in the colony colour at the anthill centre plus three dots; nest — one arrow at the flower.
- **Tooltip** on a hole or the flower: owner, area, ants through each hole (last 10 s, from `Entrance.n`).

### 21.5 Saves and multiplayer
- `SimState.version` 2 → 3. `upgradeEntrances(w)` (idempotent; runs in the `World` constructor where grids exist and again in `restoreWorld` after the binary snapshot attaches its grids — that path skipped `migrateColonyEntrances`): drop spots/shafts and extra entrances (their dug hexes stay dug floor); build the flower on the main tunnel's top (dig its 7 hexes); a tile on one of them moves to the nearest free dug hex (or its cost is refunded) and the load log says so; ants and food on removed tunnel hexes stay where they are (the hexes remain dug), ants on a flower hex now dug are fine; rebuild the three holes (site or fallback), keeping the old main hole's credit and `fall`.
- Determinism: no RNG, no wall clock; LAN two-tab sync check.

### 21.6 Verify
`tests/entrances.ts` (replaces the extra-entrance checks in `tests/run-all.ts`, the fire-ant hole test, the rival-AI entrance defence test, `tools/entrance-check.ts`): the flower on every species' nest, connected to the queen, unbuildable; digging never opens an entrance (player and AI, 50 seeded matches); `entrance` rejected; three valid spaced holes on all five maps plus formicarium and arena; hole choice by destination, home by nearest, arrivals spread; throughput per hole and a crowd emptying faster than with one hole; invasion through any hole; defenders at the inner edge; markers on holes and the flower; collapse; old save migration. Plus the full suite (combat, underpass, swarm, trails, missions), determinism, LAN, 10-colony performance, browser shots in `docs/maps/entrances-v2/`, docs (DESIGN §3.12/§3.12b, README, `docs/creatures/entrances.md`, PROGRESS), handoff update.

## 22. Realism rework — hell ants and nasute termites (user spec 2026-11-02)
User spec: project doc `claude/realism/08-spec-hell-ants-nasute-termites.md`. Branch `feature/realism-hell-nasute` from `main`
(`fc6f58a`). Looks and animation only: every unit id, stat, ability and behaviour stays. References: the user's photos
(2026-11-02: 11 hell ant images — micro-CT head, amber head and drawing of *Linguamyrmex*, the *Ceratomyrmex*-with-prey
fossil, a winged queen in amber, *Odontomachus* and *Myrmecia* analogues, paleoart; 12 *Nasutitermes* images — live
workers and soldiers, specimens, the alate head and wings, two royal chambers), plus the earlier *N. corniger* photos and
the queen photos. All study-only: render-only sheets in the repo, photo-vs-render sheets to the user in chat.

### 22.1 The last run's blockers, built in from the start (spec §2)
1. **Antennae and legs.** Hell ants: 12 segments, elbowed, the scape ≈ the head length, a smooth spline with a gentle
   taper, droop and a slight curl at the tip; segment joints only as faint waists. Termites: straight beaded chains
   with a gentle curve, varied per individual. Legs: club femora (≥1.6× the tibia's girth), slim tibiae, soft knee
   membranes, separate tarsomeres and claws; rest pose with the knees lower, tarsi under the body, small left/right
   asymmetry.
2. **Surfaces.** Hell ants get a baked detail recipe (they had none): satin microsculpture, a little more gloss on the
   gaster, finely sculptured head and horn; sparse fine curved hairs through the realism setae path; a pubescence
   sheen term driven by the setae density; transmission on thin parts. Termites (kit shader, nasute rows only): a
   warm forward-scattering term, an irregular per-individual gut, tergite plates with stretching membranes, a fine
   broken "wet" glint, fine pale hairs, the hard dark soldier head against the soft body, a taut queen membrane with
   faint eggs inside.
3. **Lighting.** Every review render in the overcast and forest-shade presets (sunny as a third), soft environment
   light, the macro ground with contact shadows, mild depth of field. The lab's termite path gets the same lab
   lighting the ants have.
4. **Jaws.** Hell ant scythes with darker edges and tips, the soldier's teeth near the tips and the blade grooves,
   large enough to read on a sheet; termite point mandibles dark-tipped.
5. **Reviews.** A fixed rubric (shape, surface, colour, lighting, hairs, "could this be a macro photo?", 1–10 each),
   real photos mixed in unlabeled, and 2–3 calibration anchors with known scores (earlier renders) in every round.

### 22.2 Hell ants (render/ants/hellBuilder.ts, hellMorphs.ts, bake/recipes.ts)
- Shape numbers in `docs/creatures/hell-ant.md` §7 (head lengths), from the fossils (micro-CT and amber photos,
  the *Linguamyrmex* drawing) before any geometry change.
- Worker (*Ceratomyrmex*): the long curved horn rising up and forward from between the antennal sockets to a spoon
  tip; the underside setae row; four long trigger hairs (two a side) where the closed jaw tips rest; scythe jaws that
  reach the horn tip and move only vertically; head angled down.
- Soldier (*Linguamyrmex*): the flattened clypeal paddle with a dark, hard (not chrome) tip; grooved, toothed blades.
- Queen (*Haidomyrmex*): bulkier mesosoma with the wing-muscle plates and wing scars, smaller eyes, a longer scape,
  serrated jaws, a sturdier shorter horn. Ocelli: the spec asks for three; the fossil record wins (the alate
  *H. cerberus* queen has none, docs/creatures/hell-ant.md) — none, noted in the report.
- Body: slender mesosoma, single-node petiole, oval gaster with the deep first constriction and the sting.
- Nanitic, brood (eggs, larvae, cocoons) and corpses follow the shared builders; checked on the sheets.
- **Amber mode** (`?amber=1` in the ant lab, render-only): the model in a clear amber block with tint, small bubbles
  and slight blur, posed and framed like a fossil photo, for silhouette checks.
- Animation (`antMotion` / `attackPoses`, render-only): add the hell castes to the realism animation set (planted
  feet, blends, deaths); hunting walk (slower, pauses, body low, head down, jaws cocked open, wide antenna sweeps),
  normal walk faster with the jaws half closed; the snap (legs planted wide, jaws flick up in 1–2 frames, a tiny
  hit-stop and dust puff, head rocks back, the gaster curls forward to sting), the soldier's impale (longer crouched
  wind-up, heavier recoil), carrying clamped vertically, idles (grooming the horn and trigger hairs, antenna cleaning,
  slow head scans), deaths by cause with the jaws dropping open. Never a sideways jaw motion.

### 22.3 Nasute termites (render/termite/*, nasute castes only)
- A per-caste realism flag in the kit's rig texture; every new shader term is gated on it, so the sickle-jaw rows
  (and the Termant/other users of the kit) render exactly as before (pixel-compared).
- Geometry (nasute castes): beaded antennae (14 / 13 / 15) with a gentle curve; club femora, tarsomeres and claws;
  fine body hairs at LOD0; the six head setae on the nasute (an *N. corniger* ID feature); the major's bigger, darker
  head with a short thick nasus; the presoldier pale and untanned; the royals fix kept.
- Shader: forward scattering and warm transmission in the abdomen, legs and antennae; the irregular gut (darker core,
  soft edges, per individual); membranes that stretch and compress with the abdomen; a broken wet glint; the glue as a
  glossy, transmissive, stringy material whose threads stretch and snap.
- Animation: short quick steps with the abdomen lagging; antennae tapping the ground ahead; breathing pulse; the
  queen's waves (kept); the glue attack planted, aimed and pulsing with recoil (match the ramp); the major's charge,
  head-butt and point-blank glue, and alarm drumming as rapid head-banging on the ground; workers chewing, carrying,
  trophallaxis and grooming; glued victims struggling with legs pulling free; deaths (legs fold, the body sags, the
  gut darkens; glue deaths stuck in place).

### 22.4 Review, checks and finish
- Sheets per unit (side, top, front, 3/4, macro) in overcast / forest / sunny → `docs/realism/<species>/` (render
  only); mandible/horn and nasus close-ups; amber-mode sheets; photo-vs-render sheets to the user in chat.
- Blind review rounds (fresh agent, rubric, anchors, photos mixed in): at least 3 per unit, up to 6; target 7/10;
  below that, keep the best version and report what blocks it.
- Clips in `docs/realism/<species>/clips/`.
- Combat data: `npx vite-node tools/height-data.ts` after model changes; underpass, anchoring, mounting, melee
  reach tests. Model hashes: only `hell_*` re-baselined; sickle-jaw and every other species unchanged.
- Performance: triangle counts, `tools/anim-cost.ts`; frame-rate checks with 1000+ units go to the user's device.
- `npm test`, determinism. Docs (`hell-ant.md`, `nasutitermes.md`, DESIGN, README, PROGRESS with every round's
  scores), a handoff update and a report; sheets and clips to the user; **wait for approval** before merging into
  `main` and publishing a new version of the game artifact.

### 22.5 Merge rule (user note 2026-11-02 00:39; project doc `claude/handoff/00-MERGE-RULE.md`)
When the work is done: fetch, read the newest handoff updates, merge the latest `origin/main` and any finished
feature branches into this branch (combine both sides; never drop another agent's work), delete work that has been
replaced (keep save migrations), run `npm ci`, `npm test`, the determinism check and the build, regenerate the
height and climb data, re-baseline only the hell ant hashes, merge into `main`, push, and write a handoff update
(what was merged, how conflicts were resolved, what was removed). Merge `origin/main` in along the way whenever it moves.

## 23. Titans dig into nests (user spec 2026-11-02, claude/creatures/01-spec-digging-titans.md)
Survey: creatures already live in any space (`cr.space`; the renderer, health bars and effects draw by space; ants find
creature targets underground through `w.s.creatures`; `invasionCheck` counts creatures in a nest as intruders, and the
war AI defends against hostile creatures at the holes or inside). Nest ground is the fine raster (soil types, 255 stone)
with a hex layer; cells only go solid → air, logged for the flow fields. Holes are `Colony.entrances` (three per anthill,
one flower underground).
Plan, as built:
1. Data: `CreatureKind.dig` per titan; `TITAN_DIG` in balance.ts (hole work, stagger, set-back, give-up, underground
   speed, break margin, flee, stay, repair, raids, warning, breach look).
2. Sim (`sim/creatures/titanDig.ts`): a raid state on the creature (`data.raid/rph/rhole/rprog/rstag/rhp/rin/…`) and on
   the entrance (`breach`, `breachBy`, `repair`; optional, so old saves load as before); `titanRaidTick` before the
   director and the creature programs; `titanRaidSystem` once a second (repairs, skirmish raids). `NestGrid.breakHex`
   opens a hex, stone included. Riders change space with the titan.
3. Story: cue `digInto` (a rival's key or 'player', a hole) and action `endRaid` (dawn).
4. Client: event `titanDig` (warn, dig, breach, enter, break, leave): clickable warning toast (jumps the camera), area
   alert, rumble and digging shake, soil spray and clods (`combatFx`), sounds; the breach crater (`entranceModels`); each
   style's digging pose (`builders.digPose`).
5. Lobby: "Titans raid nests" (menu and multiplayer lobby, `settings.titanRaids`), protocol `ud-mp-8`.
6. Tests `tests/titans.ts`; clips `tests/browser/titan_dig.py`.
Not done here: the ally brain's titan danger (on `feature/ai-allies`, not in `main` yet — noted for that work).

### 22.6 The user's ratings, round 1 (review page, 2026-11-02 afternoon)
Scores: hell ants 9–10 for the looks (the amber 10, the lineup 10), the attacks 7–8; the nasutes 8–9. Asked for:
- **H8 / H9 — the jaws:** open much wider when attacking (`hellMorphs` `openExtra` 0.55 → 1.45) and open and close
  through the attack. The renderer keeps the wide-open jaws off the ground (`lowestJaw`: the head is raised until the
  jaw blades clear it).
- **H10 — three attacks:** `ATK.SNAP` (the vertical snap), `ATK.CHOMP` (a lunge with the jaws working open and shut),
  `ATK.SLAM` (rear, hold, slam the head down, hit-stop). The game never plays the same one twice running.
- **H7 — the finisher, a gameplay change the user asked for:** a hell ant's grapple bite on a foe at
  `BALANCE.snap.finisherHp` (25 %) of its health or less (never a queen or king) — the jaws reach round the neck
  (`ATK.EXECUTE`, the soldier's `ATK.EXECUTE_P` with the paddle) and close. **User note 12:39:** the foe is then lifted
  into the air: `combat.startExecution` → `AS.Hold` with `exec` (hellAnts.ts) holds it up by the neck in front of the
  jaws for `finisherLift` s (stunned, pulled in over 0.3 s, facing the hell ant), then `executeAnt` kills it with
  `HIT.EXEC` (9). Render: the hell ant's `ATK.LIFT` (head and front raised, shaking the foe, the jaws part, the shear);
  the foe's `execHeld` (head up at the jaws, body hanging nose-up, kicking); death 9: the head comes off in the air,
  the body drops. Ant field `exec` is set on hell ants only (older saves: undefined).
- **N6 — the alarm:** the major drums with its feet planted (no body bob or pitch; only the head).
- **G4 — more attack motion for every creature:** the nasute melee in the kit shader, gated by `real` (sickle-jaws
  unchanged): workers' BITE 0 snap, 1 grab and tug, 2 nibbling flurry; majors' RAM 0 lunge, 1 head swing, 2 rear and
  crush; `TermiteInstances.setMelee` picks it. The body moves with the legs compensating so the feet stay put
  (termiteLayer no longer slides the whole nasute body). The soldier sways its aim and each squirt jolts it back,
  squeezes the abdomen and dips the head.

### 22.7 The user's ratings, round 2: the finisher on the neck; the nasute termites redone (2026-11-02 evening)
Round 2 scores: the hell ant finisher 8 (worker) and 7 (soldier: "it just looks like the ant is floating, make it on
the neck"), the attacks 8–9; the termite attacks 4–6 ("redo the termite models based on the reference images and give
them dynamic and dramatic but realistic attacks and movement like the ants but realistic to termites"; "fix the models
for nasute workers so that it can do more dynamic and dramatic but realistic attacks"; "same with the soldiers").
- **The finisher on the neck:** the lifting hell ant records its mandible–horn socket (`rig.hold`) as posed each frame
  (`recordHold` with the point), and the renderer moves the foe so its neck (`rig.neck`) sits on it (`AntView.neckBy`).
- **The nasute worker, soldier and major on the ant pipeline:** a new builder (`render/ants/nasuteBuilder.ts`,
  morphs `nasuteMorphs.ts` under the sim's keys `termite_worker`, `termite_nasute`, `termite_major`), so they get the
  ants' animation: planted-feet walking and idles, full-body attack poses, hit reactions, deaths by cause, the
  finisher's decapitation. The king, the queen, the larvae and the sickle-jaw termites stay on the kit
  (`NASUTE_ANT_PATH` routes). Shapes from the photos (nasutitermes.md §11): no waist; a saddle pronotum; a soft
  ten-segment abdomen with pale membranes and the gut showing through; long slender splayed legs with four
  tarsomeres; straight beaded antennae (14 worker, 13 soldier); the worker's domed head with crossing mandibles and the
  postclypeus; the soldier's glassy pear head drawn into the nasus, vestigial mandibles, six setae. Baked soft-cuticle
  detail (`recipes.ts` `NASUTE_W`, `NASUTE_S`).
- **Termite attacks** (`attackPoses.ts`): workers T_TUG (clamp and haul back), T_RIP (clamp and twist), T_LUNGE (reared
  snap); soldiers T_JAB (double nasus peck), T_LUNGE, T_RIP; majors T_CRUSH (rear and crash down, hit-stop), T_DOZE
  (bulldoze), T_TOSS (scoop and flick). Never the same twice running. The soldier's glue is an attack cycle of its own
  (`GLUE`, special 6: braced, the head aimed at the target, each squirt jolting it back) with the glue stream from the
  nasus tip (`GlueStreams` in the ant renderer); the major's alarm is `DRUM` (special 5: the head hammering, the feet
  planted). Views: `antViews.nasuteAntPath` (worker sizes, glue, drum, chewing).
- Height data regenerated for the new models (sim data only).
- **User notes 17:47–17:59:** the species is renamed **Conehead Termites** (`NASUTE.displayName`; ids unchanged); the
  legs cut to their real length from the specimen sheet (hind femur ~0.18 L, short and stout, the body lower); the
  heads and mandibles redone from the photos — the worker: a round, glossy capsule, blunt in front, with the darker
  band across the frons, the postclypeus swelling across the lower face with a dark midline, the labrum lying over
  flat toothed mandibles that cross (the left over the right), the maxillary and labial palps; the soldier and major:
  one teardrop loft, the bulb overhanging the thorax and sweeping with concave flanks into the nasus.

## 23. AI colonies — allies start close, EotU-style chambers with upgrades, allies help each other (user spec 2026-11-02)
User spec: project doc `claude/ai/01-spec-ai-allies-chambers.md`. Branch `feature/ai-allies` from `main` (`fc6f58a`). §21 is the entrance rework (merged into this branch on the way); §22 is the hell ant and nasute realism rework (another session; this section was §22 on its branch until both reached `main`): the code here works on "the nest's entrance hexes" (`isEntrance`), so it holds for today's ramps and for the 7-hex flower; it does not dig entrances. Layered maps (`claude/maps/05-spec-layered-maps.md`) are not started: site routes run on the map's hex layout, where a future layer edge is one more blocked hex type.

### 23.1 Survey (main, 2026-11-02)
- **Placement** (`mapGen.ts createWorld`): a balanced site set by seed (`SurfaceLayout.siteOrder`), then `teamSiteOrder` (sites sorted round the map centre, each team a consecutive run) only when `groupTeams` is set (multiplayer). Skirmish AI allies (team 0 with the player, `menu.ts teamOf`) get no grouping at all.
- **Builder** (`colonyAI.ts buildTick`, every 2 s): 7-hex chambers only, kind brood or food; any caste in a brood chamber; `GROUP_SIZE` 8; tunnels 1–4 hexes kept clear of tiles; no upgrades, no highways.
- **Upgrades** (`tiles.ts`): 6 points for level 2, 12 for 3; a same-type neighbour gives its level, soil 1, a highway its level to any tile, a highway gets the level of each built neighbour; dug floor 0. In a soil-walled 7-hex rosette the centre reaches 3 and the ring 2 (ring: 3 soil + centre + 2 ring tiles = 10 < 12); in a 19-hex hexagon every tile can reach 3 (inner first). A tunnel mouth is dug floor (0) beside an edge tile — a highway there gives it back its points.
- **War** (`warAI.ts`, every 4 s): marker II defends home, marker III raids; marker IV is used by foraging (termite scouts, aphid tenders); **marker V is free** → the help marker. `c.intruders` (combat.ts `invasionCheck`, every second) lists enemies inside a nest.
- **No AI difficulty** exists (only `settings.aggression`).

### 23.2 Plan
1. **Allied nests close** — new `sim/teamSites.ts` (pure: map def + team shape, no seed, so the lobby preview and every client agree):
   - land routes on the map's hex layout (ground and walkways; water and walls block), breadth-first from each site's main entrance: site–site, site–nearest food zone, site–map middle (cached per map);
   - authored `MapDef.teamSets[shape]` when present (shapes `1v1`, `2v2`, `2v1`, `3v1`, `2v2v2`, `2v1v1` …), else an exhaustive search over site subsets and their split into teams (≤ ~5,000 candidates), scored: ally route ≤ `allyMaxRoute` and short, enemy route ≥ `enemyMinRoute`, no enemy between two allies, fair team spreads (food, middle, enemy), the smaller side of an uneven match gets the better food; ties by site index;
   - `mapGen`: whenever a team has 2+ colonies (skirmish allies too); validator + `tools/team-sites.ts` → `docs/maps/team-sites.md`; authored sets for the five maps; lobby and skirmish map cards colour each team's sites.
2. **Chambers** (`colonyAI.ts`): a chamber is a 7-hex rosette or a 19-hex hexagon in solid soil, walled off, one tile type (one caste) each, filled from the centre out; 19s from mid game (`chamber19From`) for the main castes and leafcutter fungus; at most 2 store chambers within `storeNearEntrance` of the entrance, then store upgrades; one chamber = one group. Old saves: chambers of kind brood/food are read as before.
3. **Highways** on every tunnel hex (the mouth beside a chamber first, entrance → stores → queen first), never on entrance hexes, in chambers or in the queen's chamber.
4. **Upgrades** from `upgradeFrom` (time, ants, food): inner tiles first, soldiers before raids or when threatened, workers, stores once both store chambers are full, highways; only tiles with the points; `upgradeReserve` food kept, `upgradesInFlight` at once, none during an invasion.
5. **AI level** `settings.aiLevel` (0 Easy … 3 Brutal, default 1) scales when 19s and upgrades start and how many run; a skirmish menu choice.
6. **Ally brain** (`warAI.ts`, every 2 s): danger of each ally (invaded, by depth; siege at its holes; losing a fight near its nest; queen in danger; loss rate); help only if not threatened at home, the ally is not winning, help arrives in time (route time) or the queen is in danger, keeping a home guard and sending only enough (`assistOvermatch`); raids give way (or redirect when it is the same enemy); highest danger ÷ travel first; hysteresis and a cooldown. Marker V: on the ally's hole first when the enemy is inside, then on the threat once the helpers are in. Messages for a human ally; a `callHelp` command (protocol bump); joint raids gather and arrive together; shared targets.
7. **Verify**: `tests/aiAllies.ts`, `tools/econ.ts` / `tools/ecology.ts` reports, nest screenshots (`docs/ai/chambers/`), a help clip, determinism, LAN, performance, docs, handoff, merge, publish.

### 23.3 Findings while building it
- **Placement.** Every map's authored sets pass the limits except the 2v2v2 on Meadow Pond and Rainforest (three pairs cannot all sit within a third of the width by land with every enemy a little further off; the best placement is used and the validator reports it). The search runs once at world creation; `tools/team-sites.ts` (five maps × seven shapes, layouts and routes built from scratch) takes about 6 s in all.
- **Chambers after the entrance rework.** The 7-hex flower took the space the old 3-hex ramp left, so the first store chamber often found no place within the old 4-hex tunnel limit: tunnels now go up to 6 hexes, every candidate's tunnel is measured (the best score + tunnel length wins), and a need with no place is skipped for a while instead of blocking every other plan.
- **Digging order.** Designating a chamber's centre first left diggers waiting behind solid soil (Atta and Formica stalled): hexes are now designated breadth-first out from the dug floor.
- **Upgrades.** Ranking by tile kind alone never reached level III; ranking by upgrade points (inner tiles of 19-hex chambers first) does. Upgrades must not starve growth: the dearest brood tile and its ant are kept back.
- **Developed head starts.** Menu rivals start `developed: 6`; the old `developNest` scattered those tiles round the founding ring (mixed castes, stores outside any chamber, visible in the first nest renders). They are now laid out in the builder's chambers, each dug whole with its tunnel (a half-dug chamber cut its tiles off from the nurses and stopped growth).
- **The ally brain.** Danger weights are in fighting-weight units (a Red wood soldier ≈ 240). Helping the same threat again right after leaving it made helpers flip-flop: an ally helped and left is now blocked until its danger has cleared once. In the 2v2 ecology runs the first version sent helpers into hopeless fights (the leafcutters' raids) and the helper fell sooner than without the brain: it now leaves lost causes alone (`assistMinOdds`), falls back when outmatched and reinforces a fight going worse. Joint raids timed out while gathering because the leader counted fighters still at home: it now counts only the groups sent.
- **After main's EotU food rules** (tiles paid when placed, full stores stop the gathering): a developed head start was refused for its cost (placed instant now), and the upgrade reserve counted every paused pre-staged larva's whole growth, outgrowing the store — nothing upgraded, the full store stopped the gathering, a crowded game's Red wood colony stopped at 88 ants (now only the growing still to do counts).
- **Not this branch's:** the army-ant AI stalls (in `tools/econ.ts` on `main` `f79ebd1` at 22 ants from about 10 min; after main's caste balance, at 68 on `main` and 81 here from about 30 min): its foragers stop going out. Left for the army-ant work.

## 24. Chapter 1 becomes four levels (user spec 2026-11-02, claude/story/04-spec-chapter1-four-levels.md)
Built on §23 (`digInto`). Plan, as built:
1. Order and save: `story/campaign.ts` nodes Garden → The Long Nights → Fire on the Banks → The Spider Mother; the save
   keeps progress by level id (open = the one before won, or won already); `traits` in the save.
2. Data: `STORY_LEVEL_IDS`; `StoryLevelDef.dayNight`, `lairs`, `developed`, `reward.trait`; objectives `surviveNight`,
   `upgrade`, `storeFood`, `surviveTime` per difficulty; cues `rest`, `goto`; actions `night`, `endRaid`; actors with
   creature groups (`creatures`, `from`), `phases`, `bossCuts`, `goal`; bonus `killBefore`; food medal; `STORY.traits`,
   `STORY.difficulty.*.boss`.
3. Sim: `sim/story/dayNight.ts` (light and flags from game time), `sim/story/traits.ts` (Spiderling Venom on bites,
   `Colony.traits`), lairs as caves, story titans that stay until dawn or death, the hogna's story cuts.
4. Levels and maps: `longNights` on `stonyHollow`, `spiderMother` on `spiderTerrace`; narration and journal pages with
   sources (DESIGN-STORY §10).
5. Client: moonlight blend, wolf spider eyeshine, the spider burrow, map moods, the night clock, hub/Genome/end screen.
6. Tests `tests/storyCh1.ts`; the playtest bot plays bosses and nights; browser shots `tests/browser/story_ch1_4.py`.

### 22.8 The user's ratings, round 3 (night)
Scores: the finisher 8 and 8; the models 9, 9, 9; the walk 8; the worker attacks 6–7. Notes: "do nasute even have
majors? if not just do worker, soldier (can be major model) and sprayer"; "the nasute sprayer doesn't melee, just
sprays"; "fix the antennae and mandibles, they are misplaced" (soldiers); "fix the mandibles" (worker).
- Castes renamed (display only, ids and rules unchanged): `nasute_major` → **Soldier**, `nasute_soldier` →
  **Sprayer**; the stolen caste is "Conehead Termite Sprayer" (`termants.ts` `as`).
- The sprayer shows only the glue (`attackPlan`: `termite_nasute` → `GLUE`); the sim never gave it a bite.
- The soldiers' antennal sockets and vestigial mandibles are placed on the teardrop head's own surface
  (`headSurf`): the sockets on the bulb's sides, low, in front of its middle; the mandibles under the nasus base.
- The worker's mandibles: broad toothed blades (wide to two thirds of their length), satin rather than glossy.

### 22.9 The user's ratings, round 4 (2026-11-03, 00:47): approved with one change
Every item 8 (models, worker attacks, the sprayer's glue, the soldier's crush, bulldoze, toss and drum); decision
"approve with changes". The change (K4): the soldier drums "while walking when approaching enemies" — in bursts
(0.6 s every 1.5 s) while it walks or charges at a foe (`antViews.drumWalking`), the head only, the walk going on.

## 25. Performance pass — faster in every mode, smooth surface ↔ underground switching, no loss of looks (user spec 2026-11-02, claude/performance/01-spec-performance-no-visual-loss.md)
Branch `feature/performance` from `main` (`18d3d79`). Render, client and worker-message work only: the simulation's
results never change (the determinism check, replays and every suite prove it).

**Step 1 — measure first.**
- `core/profiler.ts` (`prof`): every frame's time (animation frame to animation frame), the main thread's own time, named
  parts (sim, msg, units, creatures, nest, fx, ui, render, prewarm), GL work counted and timed by wrapping the WebGL
  context (shader compiles and links, texture and buffer uploads), the renderer's counts, the JS heap (Chrome), GPU time
  (`EXT_disjoint_timer_query_webgl2`), and the hitch log: every frame over 33 ms with what happened in it.
- F3 overlay (`ui/debugOverlay.ts`) shows all of it at 4 Hz.
- `?bench=1` (`dev/bench.ts`, Menu → Graphics → Run the benchmark): six scenes, one page load each (so loading counts):
  the switching test (surface → home nest → each area → surface, ten rounds, every frame), a big fight (4 × 200 ants,
  100 creatures, 2 titans), a full nest, a story night (The Long Nights' last night), the arena at 600 units, and a
  multiplayer-sized world. A report to copy and paste back. `tests/browser/bench.py` runs it headless.
- The golden set before anything changes (`tests/browser/golden.py` → `docs/performance/golden/`) and a comparison tool
  (`tools/golden-compare.py`: SSIM and per-pixel difference, side-by-side sheets).
- Baseline numbers in `docs/performance.md`; the measurement build merged to `main` first so the user's devices can run
  the same `?bench=1` before the optimizations land.

**Step 2 — switching (top priority).** Findings from the hitch log decide the order; the plan:
- Pre-warm while loading: every area's stage rendered once behind the loading screen (shaders, shadow variants, textures,
  instance buffers), every ant and creature model that can appear built and compiled for every space, the effects
  compiled; `renderer.compileAsync` where it avoids a blocking compile (KHR_parallel_shader_compile).
- Shared model assets: one copy of each ant model's geometry, materials' programs and far-LOD impostor atlas for every
  space (each area's renderer used to build and bake its own the first time it was shown).
- Things that appear mid-match (a caste first raised, a creature kind first spawned, a stolen caste) are warmed in the
  background under a small time budget per frame, as soon as the simulation shows them.
- Inactive areas kept current at a low rate (nest meshes after digging, hex tiles), so a switch has nothing to catch up.
- During the dive's black frames the leaving scene is not rendered at full cost; the swap's work is spread over frames.

**Step 3 — every mode, no visible change.** Culling and draw-call merges where the counts say they pay; dynamic
resolution before `autoQuality` drops a preset; allocation-free hot loops (GC in the hitch log); HUD at a few Hz;
the worker's tick in the stress scenes; per-player tick and frame times in the multiplayer HUD; a mobile memory budget
and a 30/60 frame cap option. Each change is checked against the golden set before it is kept.

**Step 4 — verify.** Golden set, `npm test`, determinism, build, replays; final numbers (the build machine and the user's
devices) in `docs/performance.md`; DESIGN, README, PROGRESS; handoff; merge rule; merge and publish.

**As built (2026-11-03).**
- Switching: `GameSession.prewarm()` runs behind the loading screen: every ant, termite and creature model that can
  appear in a space is built once and shared by every renderer (`antRenderer.ts` `builtCache`/`impostorCacheOf`,
  `termiteLayer.ts` `baseGeos`, `primitives.ts` `prepare`), then each space's scene is compiled and drawn once offscreen
  with shadows on (`render/prewarm.ts` `warmScene`: everything visible, empty instanced meshes given one instance).
  `warmNew()` warms morphs the simulation shows mid-match under 4 ms a frame; `keepAreasCurrent()` keeps the other
  areas' terrain current in 3 ms slices every third frame (`NestTerrain.update(force, budgetMs)`: the distance field,
  then the light maps, then chunks) and brings the area a dive or cut is about to show up to date under the fade, a
  6 ms slice a frame. The fade covers the swap: nothing is drawn while it is fully opaque (`GameView.fadedOut`). The
  distance field's blur is 3× faster with the same result to the bit.
- Every mode: empty instanced meshes hidden (three binds a program for a visible mesh with no instances); creature part
  pools upload only the used range; the AO composite pass is skipped when AO is off (same image); dynamic resolution
  (to 75 %, never lower, with a light sharpen) before auto quality drops a preset; the HUD's labels skip unchanged
  writes; the slow state goes as per-field deltas (`worker/slowDelta.ts`: 16 % of the bytes, replica identical, tested);
  ant LOD changes cross-fade over 0.25 s with a 6 % hysteresis (dithered, both models drawn in complementary pixels;
  the fade rides in `aE.z` with "exhausted" — a new attribute put the ant shader over the 16 a phone allows);
  frame cap 30/60 (phones 60 by default); a GPU memory estimate (profiler) and a 600 MB phone budget in auto quality;
  multiplayer pong/delay carry each player's tick and frame time (HUD line and players panel).
- Verified: the golden set (35 shots, `docs/performance/golden/compare-after.md`) — 35 of 35 match `main`: 30
  identical (at most a few pixels), the fight and the flood at SSIM 0.9999, the home nest and the titan at 0.997 (walking ants
  and dust), and the enemy nest at 0.9845, which is closer to `main` than `main` is to itself (0.9871: the ants' random
  gait phases); every test suite; the determinism check; the switching probe (`docs/performance.md`).
- Not done, and why: KTX2 (every texture is generated in the page; a transcoder would cost more than it saves);
  IndexedDB bake cache (not done in this pass: worth it only if the user's device numbers show loading dominated by
  the impostor bakes); cached static shadows (the shadow camera follows the view, and units cast
  most of the shadow); termite LOD cross-fade (the kit's instance writes are spread over many setters; it keeps its own
  hard switch).

## 26. Story titans get inside; titans open holes more easily (user specs 2026-11-03: claude/story/05-spec-story-titans-get-inside.md, claude/creatures/02-spec-easier-titan-holes.md)

(§25 is the performance pass's.)

### 26.1 Why the story titans never got in (evidence, before any change: `main` `762d7c3`)
`tools/titan-raid-probe.ts` (the probe: `tools/titanProbe.ts`) starts each level at its titan's moment and logs the
titan every tick (`raid`, `rph`, `rprog`, `rstag`, health, space, position, its scene and cue, its creature state,
riders, `hitT`, the actor's mode). The army is 60 Termants (⅔ soldiers) on marker V; the spider mother is put at 31.5 %
(the 80 % and 60 % marks pass), and the last blow comes from the army (or a single blow undefended). Normal, seed 5:

| level / setup | the dig cue began | digging from | inside | what happened |
|---|---|---|---|---|
| Long Nights / none | 0 s | 30 s | **55 s** | in (25 s of digging) |
| Long Nights / army at the hole | 0 s | 50 s (39 % left) | never | **died at the hole** after 9 s of digging (rprog never reached 1: hit every tick, 45 % pace, knock-backs) |
| Long Nights / army on it (no climbing) | 0 s | never | never | **died on the approach**, 30 mm short of its digging spot: latched ants, glue and grip slowed it to 1.7 mm/s (14 % of its speed) for 60 s while 60 ants chewed through 2 030 hp; the raid tick never bites on the approach |
| Long Nights / riders | never | never | never | **died before its dig cue began**: on its path cue, every hit hands it to its own program (`hitT` > 0), so it stood and fought on the hollow's floor with 12 riders and died 45 s later |
| Long Nights / army in its way, not attacking | 0 s | 23 s | 48 s | in |
| Spider Mother / none | 0 s | 16 s | **43 s** | in (27 s of digging) |
| Spider Mother / army at the hole | 0 s | 17 s (23 %) | never | **died at the hole** after 5.5 s |
| Spider Mother / army on it | 0 s | 24 s (17 %) | never | **died at the hole** after 20 s |
| Spider Mother / riders | 0 s | 23 s (11 %) | never | **died at the hole** after 16 s |
| Spider Mother / army in its way | 0 s | 16 s | 43 s | in |
| Spider Mother / from her burrow | 0 s | 16 s | 43 s | in |

Even 20 ants at the hole killed both on Easy (the tarantula after 42 s of digging, the spider after 6 s); 20 on Brutal let
the tarantula in after 56 s of digging. `tools/playtest-story.ts` (its bot fights at the door) on Normal, seed 7: the
tarantula was killed after `tarantulaDigs` without `tarantulaIn`; the spider mother after `hp:mother:30` without
`motherIn` — neither ever got in.

The six suspects of the spec:
1. **The cue gives up silently — confirmed by reading, not the cause here.** `enterCue` ignores `startTitanRaid`'s
   result and the done check counts "not raiding" (`!data.raid`) as done, so a failed start or a raid ended early
   (death aside) would move the scene on at once. In these runs the start never failed: creatures never go into caves in
   this code (lairs are drawn holes; the titans stand at them on the surface), so `space !== SURFACE` cannot happen yet.
   Fixed anyway (§26.2).
2. **It dies or stalls at the hole — confirmed: the main cause.** Under attack it digs at `hitSlow` 45 % all the time
   (any hit restarts the 1.2 s stagger) and heavy ticks knock progress back 15 %; the spider starts at 30 % health.
   Before the hole, the approach crawls (latched grip floor 35 % × Termant glue × being held) and never fights back.
3. **The spider's timeout — ruled out.** `digInto` is not a walking cue, so its `timeout: 300` never applied; the
   `release` after it only clears the director's links (the raid goes on). Removed all the same.
4. **Something else drives it — partly.** During the raid nothing else moves it (the raid tick runs first and returns
   true in every phase), but *before* the dig cue the tarantula's path cue hands it to its own program whenever hit, so
   an army on the hollow's floor stops it there and kills it. A later scene could also replace the dig scene (none does
   today).
5. **It can't reach the hole — partly.** The approach uses `walkTo`: straight at the hole (the banks' route only when the
   line crosses a cliff), turning on the spot when blocked — no sliding round a pebble, no re-route. Not seen to block
   here, but it can; and the crawl of (2).
6. **`leaving` / `finishRaid` early — ruled out** (queen and colony alive in every run).

### 26.2 Plan, as built
Story (spec A; story raids only, skirmish unchanged):
1. **The dig cue owns the titan.** A story actor with a dig-in ahead (`digInto` in its running scene, not yet inside)
   is *locked*: a new scene for it waits until it is in (then the newest waiting one starts); nothing ends its raid but
   death or the level's own `endRaid` (dawn). Boss phase events (the spiderlings, captions) still happen.
2. **Start reliably.** In a cave (a lair) it first walks out of it to the surface; any other failure retries every
   second and logs why (`story.log`, the dev view). Done only when inside (`rph ≥ Inside`) or dead.
3. **Always reach the hole.** Story approaches walk the surface route field (round banks, up ramps), slide round
   obstacles, push through ants (a floor on its pace whatever holds it: `STORY.titanRaid.minPace`) and re-route
   (sidestep) after `stuckSec` without progress.
4. **Digging can't be stalled.** Story pace ≥ `minPace`, no knock-backs, and a cap per difficulty (`digCap`): it
   breaks through by then whatever happens.
5. **It can't die before it gets in.** A locked titan's health stops at `hpFloor` (10 %) until it is inside (bites,
   acid, venom, floods); the boss bar shows a lock and the floor's mark meanwhile.
6. **The levels.** The tarantula walks its path to the hollow without stopping to fight (passive on the way, its path cue
   shorter), then digs in; the spider mother rushes straight to the nest at 30 % (`digInto` `speed`), no timeout, the
   release only once she is in. A breakthrough caption ("It's in the nest!") and a dig ring over the hole.
7. **Fair.** The fight inside: measured (the queen's time to die with the army inside), tuned in the level data per
   difficulty (`STORY.titanRaid.queenBite`: the titan's bite on the queen). The spider's bonus becomes "kill her within
   N s of breaking in" (`killWithin`, N by difficulty); "kill the tarantula before dawn" stays.

All modes (spec B):
8. **Faster base digging**: `holeWork` lowered and the stag beetle's dig speed raised (undefended: tarantula and wolf
   spider mother ≈ 10 s, centipede ≈ 15 s, stag beetle ≈ 20 s), times scaled a little by the titan's own size.
9. **Defence slows by damage rate**, not by "any hit": a smoothed damage per second ÷ its health; pace = floor + (1 −
   floor) ÷ (1 + (rate ÷ `slowRate`)²) — a few ants barely matter, a big army nears the floor (55 % in skirmish,
   `STORY.titanRaid.minPace` in story).
10. **Checkpoints** at 25 / 50 / 75 %: a heavy blow knocks a little back (`heavyBack` 8 %), never below the last one.
11. **Memory**: partial progress stays on the hole for `holeMemorySec` (60 s); an open breach is still walked into.
12. **Readable**: the hole's stages in the anthill model (rim crumbling, wider crater, soil fountaining, the breach —
    sized to the titan), a progress ring over the hole for everyone, the warning toast with the time to breakthrough,
    the rumble rising with progress.
13. Verify: `tests/titans.ts`, `tests/storyCh1.ts` (both levels × four difficulties × no defence / army at the hole /
    riders / from its burrow), `tools/titan-holes.ts` (before/after table: `docs/creatures/titans.md`), the playtests,
    browser clips (`docs/story/shots/`), determinism, LAN, docs, handoff, merge, publish.

### 26.3 Results
- **The probe, Normal, 60 Termants** (`tools/titan-raid-probe.ts`), after: every setup gets in. Long Nights — none in
  at 33 s (dug 10 s), army at the hole 45 s (dug 15 s = the cap, in at 31 %), army on it 42 s (killed inside 40 s
  later), riders 37 s; from its burrow (walked out of the lair, down the knoll and the ramps) 124 s. Spider Mother —
  none 27 s, hole / on her / riders 24–27 s (in at the 10 % floor), from her lair (out in 9 s) 33 s. A guard creature
  on the moss bank's ramp top had held the tarantula for good on the burrow route (`separation.ts`: the guard "stood its
  ground" in an attack and pushed the titan back each tick) — story raiders now push through other creatures.
- **`tests/storyCh1.ts`**: both levels × four difficulties × no defence / 40 ants at the hole / 40 riders / in its lair
  when the cue fires (32 runs): inside every time, never digging longer than the cap, the cue never done before.
- **The fight inside** (40 ants on it, or none, 150 s after it got in): the queen is never killed at once — with no
  defence at all she lasts 120–145 s (Long Nights; dawn comes about 140 s after it gets in), the spider never reaches
  her; with the army the titan dies inside (the spider in 10–20 s) or is still fighting at dawn on Hard / Brutal. The
  bites inside are softened per difficulty in the level data (`inside`): after a first matrix lost the Spider Mother on
  Hard (seed 7: a colony of 17 left after the brood phase, where before 20 ants at the hole had killed her) and the Long
  Nights on Brutal with the hole strategy.
- **`tools/playtest-story.ts`** (seed 7; default bot / STRATEGY=hole), after the merge with main's AI-style Spider Mother
  nest — the titan inside in every run that reached it:

  | level | Easy | Normal | Hard | Brutal |
  |---|---|---|---|---|
  | The Long Nights | won 23.6 min, 99 / 96 ants | won, 85 / 91 | won, 80 / 78 | won, 13 / 3 |
  | The Spider Mother | won 9.8 min, 74 / 78 | won 8.8, 28 / 28 | won 8.1 / 8.0, 48 / 51 | seed 7 unfinished (the bot never brings her to 30 %, as before), seed 9 won 7.8 min (16 ants), seeds 8 and 11 lost after she got in |

  Before (`main` `762d7c3`, Normal): neither titan ever got in (the tarantula killed after `tarantulaDigs`, the spider
  after her 30 % mark).
- **Skirmish holes**: `docs/creatures/titans.md` (before/after tables; Termant and Lasius soldiers).
- **AI colonies v titans** (`tools/titan-ai-defence.ts`, Meadow Pond, two AI colonies grown 20 min, the titan from
  300 mm): before, 10 of 12 kept out (9 driven off, one never reached the hole; the holes took 22–74 s); after, 8 of 12
  (Formica and the Termants drive off or kill every titan but one that never reached the hole; the Lasius colony lets
  all four in, 76–99 % health). AI colonies now meet a warned titan at the hole it will dig (`warAI.ts threat`).

## 27. A shared underground: set tunnels between nests, underground fog (user spec 2026-11-06, claude/underground/01-spec-shared-underground-tunnels.md)

Branch `feature/shared-underground` off `main` `d1161a0`. Every number in `balance.ts` `TUNNELS`. Deterministic sim; fog is
client-side only.

### 27.1 What exists (survey, `main` d1161a0)
- Each underground area is its own `NestGrid` (34 × 30 hexes, `colony.ts NEST_COLS/ROWS`) in its own space
  (`nestSpace(id) = id + 1`), joined to the surface only by its one flower entrance. Nothing joins two nests: `goToArea`
  always goes out onto the surface and down the other nest's holes; `hasRouteHome`, `teamPresence`, `threat`,
  `allyDanger`, `invasionCheck` and the job system assume "own nest + surface".
- Digging: `dig {q, on}` designates a hex of the player's own nest (`designateDig`); `jobs.ts listJobs` turns designated
  hexes next to dug floor into Dig jobs (2 workers a hex, `workRate` 2/4/6 points a second by level, 6 points a hex
  whatever the soil — soil only changes how the raster is carved). No per-caste or per-species dig speed is read.
- Soil: fine raster + hex layer; `SOIL_STONE` (255) is undiggable by ants but `breakHex` (titans) breaks it.
- Tabs: an area's tab opens while the viewer's team has live ants in it (`areaOpen`); once open the whole grid, its
  ants and tiles are drawn (no visibility layer anywhere: nest renderer, `NestView`, minimap).
- The worker sends every grid to every client (`worker/frames.ts`), so fog can be purely render-side.
- Saves: `SimState.version` 3; `NestGridSnap` / `serialize` list every grid array; `restoreWorld` attaches grids after
  the World constructor. Net: `BUILD_ID` `ud-mp-11`.

### 27.2 Design (the user's decisions, 2026-11-06, and how they map onto the code)
**One underground, nests kept separate, joined by set routes.**
- The shared frame: every nest grid is placed under its anthill (nest mm → surface mm through `nestToSurface`'s 0.6
  scale, as before); routes are planned in the surface frame from the anthills' positions, so gates face the neighbour
  they lead to. The nest grids themselves stay separate spaces (their own tab, grid and rules); a route is two halves,
  one in each nest's grid, that meet at the grids' rims (the route's halfway point).
- **Rock margin:** every colony nest grows a ring of `TUNNELS.margin` (8) hexes of **rock** (`SOIL_ROCK`, 254: a new
  type nothing digs or breaks — `isHexDiggable` false, `carve` and `breakHex` refuse it, titans included) round the old
  34 × 30 diggable interior, so the interior (where tiles go) is exactly as before and routes have room. Grid 50 × 46.
  The margin's rock is the walls of every route. Caves keep their grids.
- **Routes** (`SimState.routes`, `sim/tunnels.ts`): generated once at match start, after the colonies, from the
  anthills' positions: up to `allPairsMax` (4) colonies every pair; more colonies: each nest's `neighbours` (3) nearest,
  and a route whose surface segment crosses an accepted route (shorter routes first) or whose gate would come within
  `gateGap` (5) edge hexes of another gate is dropped. A story level decides (`GameSetup.tunnels`: `'auto'`, `'none'` or
  authored pairs; story levels default to none unless the level says). Each route: `{ id, a, b, open, openT,
  halves: [{ colony, space, gate, steps, dir, warned }, …] }`. A half's `steps` are hex triples (left, centre, right in
  the walking direction) from the gate outward through the margin to the rim (step 0 is the gate hex alone, an interior
  edge hex), the centreline a gently curving walk (a sine wobble of ±1 hex, deterministic) toward the rim in the
  direction of the other nest, `dir` the outward edge at the rim. Route hexes get `hexRoute[q] = id + 1`, soil
  `SOIL_ROUTE` (6, diggable, drawn as rock until dug: "not visible beyond the gate"); the gate hex `SOIL_GATE` (5,
  brownish loosened soil). `HEX_WORK` for both. Gates keep `gateAway` (4) hexes from the flower and never lie on the
  flower's side.
- **Digging a route:** the player uses the Dig tool on a gate: `dig` on a gate hex becomes a route dig toggle
  (`digRoute {route, on}`, a new command, also sent directly by the UI). `Colony.routeDig` is the one route a colony
  digs (`-1` none); marking another pauses the first (its dug hexes stay). `jobs.ts` lists route Dig jobs for the
  colony's frontier on that route: its own half's first undug step from its gate (each hex of the step a job, 2
  workers each), and once its own half is through to the rim, the partner's half from the rim inward — so an attacker
  digs the whole way and a defender (or ally) digging from its own gate meets it; dug hexes count from either side.
  Route hexes cost `jobPoints × hexWorkMul` (10) points: 3 hexes in parallel a step, 15 steps a route, a normal crew of
  six level-1 workers ≈ 3.7 min (`tools/tunnel-dig-probe.ts` measures it). Dig speed is data: `CasteDef.digRate`
  and `SpeciesDef.digRate` multiply a worker's rate on Dig jobs (all 1 now; digging specialists later).
  Cross-rim digging: a worker in its own rim step digs the partner's rim step from across the rim (`digHex` with the
  rim edge as the entry side); once that step is dug the worker walks through (portal below) and digs on inside the
  partner's half. A job has a space now (`Ant.jobS`); every job helper takes the grid of that space.
- **Opening:** a half is through when all its steps are dug; the route is `open` when both halves are (checked once a
  second by `tunnelTick`), then `tunnelOpen` is emitted (toasts for both players, tab alerts). Open routes never close;
  a fallen colony's halves stay dug.
- **Moving through routes (walk, no teleport):** `goToArea`, `goHome`, `hasRouteHome`, job navigation and markers:
  an ant in a nest linked to its goal nest by an open route (or by a route it may pass: the route's halves dug all the
  way from its own side — its colony's diggers) follows the nest field `route:<id>` to its rim step, and when it stands
  in the rim step and heads out over the rim it crosses: same lateral place in the partner's rim step (left ↔ right,
  since the halves face each other), heading turned inward, in the partner's space. Flow fields never cross a rim; a
  cross-nest walk is two legs (to the rim, then the partner's field). Creatures do the same in `creatureAI` when their
  goal lies through an open route (a titan raid walking on into a linked nest).
- **Fog (client-side, `game/fog.ts`):** per viewed space the session builds a per-hex mask (0 seen, 1 remembered, 2
  dark) from the sim each frame, plus an `explored` memory per space (not saved: a reload forgets what was seen).
  Rules for the viewer's team T looking at space S owned by O:
  - own or allied nest: all seen, **except** route hexes of a closed route that O's own digging has not reached (the
    steps beyond O's dug prefix): those are **sealed** — the nest renderer draws them as solid rock (the SDF and the
    soil map treat sealed cells as rock) and units in them are hidden, so an enemy digging in is unseen until the
    warning, and the route beyond the gate is "inside the dark soil";
  - enemy nest the viewer's ants entered by the surface (`Ant.ent ≥ 0` for any of them in S): all seen, as now;
  - enemy nest reached only by tunnel: while the route is closed, seen = the route's own hexes within `sight` (5) of
    the viewer's units; once open, every dug hex within `sight` of a viewer unit; remembered hexes are drawn dimmed
    without units; enemy units, food and brood show only in seen hexes;
  - **hints:** when the viewer's diggers are within `hintRange` (3) steps of the far gate and the route is closed, the
    far nest's view shows, beyond the frontier at the gate: a red ! if enemy ants stand within `hintRange` hexes of
    the gate, a food/brood mark, a creature mark (billboards, `render/game/routeSigns.ts`).
  - The sim knows everything (lockstep); AI colonies decide from `threat`/`allyDanger`/`pickTarget` as before (they
    are already omniscient about strengths; tunnels add no new knowledge).
- **Warnings:** `tunnelTick` once a second: when an enemy's dug frontier on a half comes within `warnRange` (3) steps
  of the half's gate and the route is closed, emit `tunnelWarn {colony, route, space, x, y}` once (then `warned`) and
  `tunnelDig {space, x, y}` every `warnEvery` (4) s while the digging goes on (a muffled dig sound from behind the
  wall). UI: toast "Something is digging toward your nest" (click: jump to the gate), the tab alert, a red ! billboard
  on the gate until the route opens; the breakthrough toast.
- **Tabs and camera:** each nest view draws its half up to the rim (the halfway point). Scrolling: when the nest camera
  goal is clamped at the rim inside an open (or passable) route's rim step, the view cuts (fade) to the partner nest at
  its rim step; following a group (`updateFollow`) already follows an ant across spaces; `areaOpen` treats the viewer's
  ants in a partner's half as presence (the tab lights up as they dig in). The minimap draws gates (brown) and open
  routes (a line to the rim).
- **Tiles:** `tiles.ts` refuses tiles on route hexes unless the species flag `satelliteNests` is set
  (`tileAllowedOnRoute`): the hook for multiple-queen species; nothing hard-codes "never".
- **AI (`warAI.ts`, `TUNNELS.ai`):** when `time ≥ ai.from[aiLevel]` (Easy never), a closed route leads to the war
  brain's chosen target and no raid is on, the brain starts digging it (`routeDig`), keeps its fighters at its gate
  (DEFEND there) and raids through it when it opens (ATTACK on the target queen; pathing takes the route). Defence:
  a warned closed half is a `threat` at the gate (guards go there); on Hard+ the colony digs the same route to meet
  them (`ai.meetFrom`). Allies: the ally brain digs a route to an ally from `ai.allyLinkFrom` s when idle; once linked,
  help walks through it (`travelTime` prefers a linked nest). Difficulty: `ai.from`, `ai.meetFrom`, `ai.chance`.
- **Saves and net:** `SimState.version` 4: a version-3 grid is embedded into the margin (every hex index and nest
  position in that space shifted by the margin; tiles, entrances, flowers, ants, food, brood, creatures, markers,
  jobs, the AI's chambers) and routes are generated closed; `NestGridSnap`/`serialize` carry `hexRoute`; `BUILD_ID`
  `ud-mp-12`. Fog never touches the sim.
- **Performance:** grids are ~2.2× the cells (50 × 46 vs 34 × 30 hexes); the nest renderer's full-grid SDF runs only on
  version changes; the fog mask is one byte a hex, and only the viewed space is computed.

### 27.3 Files
`sim/balance.ts` (TUNNELS), `sim/types.ts` (TunnelRoute, SimState.routes, Colony.routeDig, Ant.jobS), `world/nestGrid.ts`
(SOIL_ROCK/ROUTE/GATE, hexRoute, margin, embed), `sim/tunnels.ts` (new: generation, frontier, tick, crossing, queries),
`sim/colony.ts`, `sim/jobs.ts`, `sim/commands.ts`, `sim/movement.ts`, `sim/areas.ts`, `sim/antAI.ts` (job nav),
`sim/tiles.ts`, `sim/warAI.ts`, `sim/mapGen.ts`, `sim/snapshot.ts`, `sim/world.ts`, `core/events.ts`, `net/messages.ts`,
`game/fog.ts` (new), `game/session.ts`, `game/nestView.ts`, `render/nest/nestTerrain.ts`, `render/game/routeSigns.ts`
(new), `ui/minimaps.ts`, `ui/gameUI.ts`, `audio/gameAudio.ts`, `tests/tunnels.ts` (new), `tools/tunnel-dig-probe.ts`
(new), docs.

### 27.4 Results (2026-11-07)
- Routes valid on every playable map for 2, 3, 4, 6 and 10 colonies × 2 seeds (`tools/tunnel-check.ts`): three hexes
  wide (bands of every margin hex within a step of the centreline, rock pockets filled), rock-walled, gates on the
  interior edge ≥ 4 from the flower and ≥ 5 apart; all pairs ≤ 4 colonies (6 routes for 4), nearest neighbours without
  surface crossings above (9 routes for 6).
- Dig times with six level-1 workers (`tests/tunnels.ts`, seed 3): the defender warned at 4.5 min, the route open at
  5.7 min, the breach into the rival's floor at 6.7 min; both sides digging: open at 3.6 min. `hexWorkMul` went
  10 → 5 → 4 → 3 to land near the spec's 3–5 min (the hexes dug one step of three at a time, two workers each, so the
  crew of six is the natural crew size).
- Changes of plan while building: a half's `breach` is also the owner's own passage from its floor to its gate (the
  AI's nests never reach the edge; dug first, from the floor outward); `goOut` takes a usable route home from a foreign
  nest (every "not in own nest → go out" path in antAI then walks the tunnel instead of climbing out — before that,
  marker groups oscillated between the nests); the `tunnelBreach` event (the gate joining the floor) was added for the
  "they have dug into your nest" alert; `Fog` lives on the session and is handed to each `NestView`.
- AI (`tools/tunnel-ai-probe.ts`, Brutal, seed 5, 4 colonies with an AI ally): the fire ants tunnelled toward the idle
  player — warned 13.3 min, open 13.8, in 14.7 — and the leafcutter ally linked nests at 14 min; the black garden ants
  guarded (DEFEND) when warned. Easy never tunnels.
- Checks: `npm test` (32 suites incl. `tests/tunnels.ts`), `tools/check-determinism.ts` (72 files clean), `npm run
  build`. `tests/run-all.ts` and `tests/entrances.ts` were adjusted for the margin and version 4.
- Open: the fog's "remembered" dimming is subtle on the dark tunnel floor; hints past the frontier appear only when the
  rival has ants/food within 3 hexes of its gate (quiet gates give none); the nest renderer's full-grid SDF runs on
  every grid version change over a grid 2.3× the cells (fine on this machine; a device check with 10 colonies is
  pending); creatures cross only open routes; the camera switch needs the goal pushed against the rim in a rim step.
## 28. Audio v3 — sound effects reworked: made-for-this-game files, no walking or termite idle sounds, insect-like attacks (user spec 2026-11-06, claude/audio/03-spec-sfx-rework-insect.md)
Kept: the audio system of `claude/audio/02-spec-eotu-style-audio.md` (buses, mixer and voice limits, the scuffle and
battle beds, adaptive music, ducking, marker chirps, alerts, ambience).

**Replaced** — every synthesised stand-in (`src/audio/standins.ts`, 1,100 lines of runtime recipes) by files rendered
offline (`tools/audio/sfx`: `dsp.py` primitives, one recipe per sound in `recipes_combat.py`, `recipes_creatures.py`,
`recipes_world.py`; `build.py` renders 3–6 takes, trims them to start on their first sound, fades, normalises them to
the level each had in the tuned mix (`levels.json`) and packs each sound into one Ogg + AAC file with its take offsets
in `public/audio/manifest.json`). `bank.ts` reads the sprite manifest, corrects encoder delay from the file's first
sound, decodes lazily (combat, orders and work warm up after the first click), streams the ambience loops and decodes
them in offline renders. The music's instruments moved to `instruments.ts` (with the stingers and the narration cue,
the only sounds still made in the game); `dsp.ts` kept only what they use. The stand-in tools (`render-standins.ts`,
`process.sh`, `build-manifest.ts`) are replaced by `npm run audio:build`; recordings in `audio-src/recordings` still
override a sound's takes.

**Removed: ant and termite walking (all species)** — `ant.step_soil`, `ant.step_leaf`, `ant.step_bark`,
`ant.step_stone`, `ant.step_sand`, `ant.step_carton`, `ant.step_queen`, `ant.swarm_bed` (the swarm movement bed and
its `GrainBed` in `gameAudio.ts`, `audioRender.ts`, `soundBoard.ts`), `species.nasute_move`; in `scanAnts`: the
walked-distance tracking, the ground-type step choice (`ground()`, its hash), the climbing skitter on creatures' legs
(and its random scuffle), the Termant skitter and papery shuffle, the moving-ant count; the mixer's `steps` pool.
Kept: creature and titan footsteps (`scanCreatures`), digging, antenna taps up close (ants only), the battle bed.

**Removed: termite idle sounds** — antenna taps for termites (now ants only); the termite kit's procedural voices
`render/termite/audio.ts` (`SickleJawAudio`: `biteSnap` and `alarmDrum` were never wired, `acidStream`, `acidFizz` and
`victimStruggle` ran on every sickle-jaw hold; replaced by `species.sickle_acid` and `combat.struggle` files, timed by
the hold's ramp and the victim's health), `SICKLE_AUDIO_EVENTS` and its type. Checked and kept as real actions: the
`headbang` events (the colony alarm ability, `sickleAlarm` when attacked or grabbing, `majorAlarm` when a soldier is
attacked) and the `alarm` event (now a termite colony drums, `species.termite_headbang`, instead of an ant's
stridulation); the conehead soldier drumming while it walks or charges at a foe is part of that alarm (animation, no
extra sound); wood chewing only on a forager's `bite` on wood (`species.termite_chew`, quiet); attacks, glue, digging,
building and deaths. There were no idle chewing, grooming or royal sounds.

**Changed: attacks, hits and deaths** (§4 of the spec; research in `docs/audio/sound-research.md`): new
`combat.bite_crush` (fire ant and Atta majors, the Termant soldier), `combat.scissor_cut` (Atta soldiers, 40 % of Atta
majors' bites), `combat.hit_tick` (light hits), `combat.grip` (the animation's grip and claws catching a creature's
leg, instead of playing the 7 s scuffle loop as a one-shot), `combat.struggle` (renames `species.hellant_struggle`:
prey on a jaw, hooks, pins, sickle holds), `combat.termite_bite`, `combat.termite_death`, `combat.mortar_pop` and
`combat.mortar_land` (the lob and its landing, instead of the spray and the splat), `species.glue_splat` (instead of a
slowed acid splat), `species.army_hook` (instead of a slowed mandible click), `species.sickle_snap` (instead of a sped-up
hell ant snap), `species.sickle_acid`, `species.termite_chew`, `cr.beetle_bite` and `cr.centipede_bite` (creatures had
used the ants' `combat.mandible_snap`), `ant.pick_up` and `ant.put_down`. Stings are sized by the stinger (army ants a
little stronger); deaths by the caste (quieter for small ants). Carrying is heard on pick-up and set-down and every
1.5–4 s while carrying (it was 18 % of footsteps). Sim-event sounds wait for the frame that shows their tick
(`GameSession.renderAlpha`, `GameAudio.lag`), so a bite sounds as the jaws close. The ambience's macro layer (leaf
litter on the surface, the colony rumble underground) rises a little over a crowd close up (`Place.crowd`).

**Checks:** `tests/audio.ts` (catalog, manifest, files and attributions agree; no removed sound referenced; takes
3–6), `tests/browser/audio_files.py` (every file decodes as Ogg and as AAC, the takes are cut right, attacks start on
their contact), `tests/browser/audio_mix.py` (no clipping, budgets, the queen alert cuts through a 400-ant battle),
`tests/browser/sfx_recordings.py` (before/after in-game recordings for the sound board).

**Review pass 2 (2026-11-07):** the user rated the board (66 notes). Cut outright: `amb.drip`, `amb.raindrop_big`,
`amb.soil_trickle`, `ant.soil_grains`, `ant.pellet_drop`, `ant.pick_up`, `ant.put_down`, `ant.food_cut`,
`ant.seed_crack`, `ant.egg_set`, `ant.queen_lay`, `combat.hit_tick`, `combat.struggle`, `combat.ant_death`,
`combat.termite_death` (tunnel and titan soil cues reuse deep, muffled `ant.dig_bite`). "Deeper": the bites, snaps,
crushes, cracks, scissor cut, dig bite, beetle bite and step, centipede patter, pillbug roll, boss phase and wind-up
(a 150–750 Hz body under each, lower modes, no narrow ringing above 2 kHz). "No plink": rain, battle bed, boss step /
slam / rumble, sand hiss, colony rumble, water stream (bubbles), drag (scrape). "Not ghostly": grip, scuffle, battle
bed and cricket burrow trade airy swells for zipper-like click trains and squeals. "Like the old one": fly pass
(higher), root creak, pillbug roll, boss phase and wind-up; thunder and boss arrival keep both as extra takes.
Reshaped: frog, owl, larva hatch, caterpillar. Creature deaths per family (`cr.death_spider/beetle/centipede/mantis/
soft`; `cr.creature_death` the fallback), chosen in `GameAudio` by the kind's family. Attack gains × 0.6. Approved
by the user on the board ("add the sfx"); 93 sounds, 348 takes. The stag beetle's wing-case flare
(`render/creatures/stagBeetle.ts`: `stag_elytronL/R`, `stag_hindwing`; on `ST.Rear` and `ST.Display`, 1.6 s) gives
`cr.beetle_elytra` its animation; the audio fires it on the same state entry.

## 29. Responsiveness: instant feedback, smooth motion, math-based client-side visuals (user spec 2026-11-07, claude/performance/02-spec-responsiveness-client-visuals.md)

Branch `feature/responsiveness` off `main` `361ed47`. Everything from §25 stays (pre-warm, shared geometry, dynamic
resolution, the golden set, the benchmark). The simulation's results must not change (the determinism check, replays,
LAN); only the client changes, plus the multiplayer input delay (when commands are scheduled, not what they do).

### 29.1 What the code does now (read before measuring)
- **Commands, single-player:** the worker applies a command at the boundary before the next tick as soon as it
  arrives and posts a frame at once (`simWorker.ts 'cmds'`): one tick at most, the right number already. Until the
  worker acknowledges it, the client shows it as pending (a shimmering marker, ghost rings on hexes, group cards in their
  new column, a click: `localCommands.ts`, `session.pendingHexes/shownMarkers`).
- **Commands, multiplayer:** adaptive lockstep delay, `ceil(worst path / 50 ms) + 1` ticks, never under `MIN_DELAY` 2
  (100 ms) even on a LAN with a 2 ms round trip.
- **Interpolation (worker mode):** the replica keeps each entity's position at the previous tick (`px`) and the last
  (`x`); the frame draws `lerp(px, x, α)` with `α = time since the last ticked frame arrived ÷ the smoothed gap`,
  clamped to 1. Two faults: (1) when a frame carries two or more ticks (the worker was still busy when the next tick
  fell due — slow phones, big fights), `px` is only one tick back, so the ants jump the other ticks' distance; (2) the
  arrival of a frame resets α to 0 wherever the drawn position was, so any unevenness in when frames arrive (worker tick
  time 2–15 ms, message timing against the display's frames) shows as an uneven step, and a late frame freezes motion
  (α held at 1) and then jumps. This is "20 Hz stepping" and judder.
- **Per-frame CPU:** the ant renderer runs every ant of the viewed space through its whole animation (the planted-feet
  motion controller, springs, posing, matrices) and only then tests it against the view: ants off screen cost as much
  as ants on it. Gait phase, antenna wave and pose phase are `Math.random()` at first draw (renders differ run to run).
- **Profiler:** frame time, main-thread time and parts, GPU time, GL work, hitches. Nothing about input latency,
  command latency, jitter, long tasks or missed frames.

### 29.2 Plan (in this order; each step measured before and after)
1. **Measure feel** (F3 and `?bench=1`, `core/profiler.ts`, `core/feel.ts`): input → first frame showing a reaction
   (select, move order/marker, build, dig, camera pan and zoom), input → the units acting (the sim applied it and ran a
   tick); command latency in ticks and ms (single-player, LAN, online); frame pacing (interval distribution, jitter,
   frames over 16.7 / 33 ms, missed vsync estimated against the display's interval, long tasks via
   `PerformanceObserver('longtask')`); main-thread budget per part and the worker's tick. A bench scene "feel" scripts
   the inputs. Baseline on the build machine; ask the user once for `?bench=1` on their laptop and iPhone.
2. **Smooth motion** (`game/replica.ts`, `game/simHost.ts`): when a ticked frame arrives, each entity's `px/py/ph` is
   set to where it is drawn now (no jump at arrival, whatever the number of ticks in the frame); α runs over the time
   the next frame is expected, and may run on to 1.5 when a frame is late (extrapolating half a tick along the motion,
   then the next frame takes over from where it is drawn). Teleports (space change, > 3 ticks of travel) snap. A test
   replays uneven and batched arrivals and checks the drawn path's steps.
3. **Instant feedback** (`localCommands.ts`, session, renderers): every command shows its feedback on the frame of the
   input (already true for markers and hexes: check each, fill the gaps: selection ring, build ghost solid, dig mark,
   group move); a render-only **intent turn**: the ants of a group sent to a marker turn their heads and bodies toward
   it at once, eased out when the sim's own heading takes over or the command is refused; rejected commands drop their
   pending look with a short fade. Input handlers only record and queue.
4. **Command delay:** single-player stays at the next tick (verified by the new metric); LAN/online: the host's
   suggestion `ceil((worst path + margin) / 50 ms)` with `MIN_DELAY` 1 — one tick on a LAN, adaptive elsewhere —
   shown in F3 and the players panel.
5. **Less CPU per frame, math-based** (`render/ants/antRenderer.ts`, creatures, termites): an early cheap view test on
   the sim position (a generous margin) skips the animation of ants off screen; when one comes back, its state is
   brought forward from formulas (the gait phase from the distance walked since last seen ÷ stride, the springs to
   their targets, poses at their weights) instead of being stepped every frame. Per-ant seeds hashed from the id
   (gait phase, antenna wave, pose phase) instead of `Math.random()`. Effects that run a whole animation from one event
   (sparks, puffs) as closed-form curves of `t − t0`; rings and bars as instanced quads where they are meshes per item;
   instance buffers uploaded over the used range only.
6. **Messages and the sim:** measure frame bytes and decode time per message in busy scenes; profile the hot systems
   of the stress scenes (fights, 10 colonies, story set pieces, tunnels, titan raids) and take the safe wins (squared
   distances, cached fields, staggering expensive brains deterministically) only where the determinism check and the
   replays show identical results.
7. **Main thread and UI:** no per-frame DOM writes for unchanged values, passive touch listeners, no layout reads
   after writes in the frame.
8. **Verify:** before/after table in `docs/performance.md` (latencies, pacing, budgets, CPU per frame for 1,000+ ants);
   the golden set; determinism check, replays, LAN two-tab; `npm test`, build; DESIGN, README, PROGRESS, handoff;
   merge; publish v-next of the artifact; ask the user for a new `?bench=1`.

### 29.3 What was done (in order)
1. **The feel meter** — `core/feel.ts`, F3, the bench's *feel* scene (merged into `main` early, `0eb564a`, so the user
   could take a baseline on their own devices; handoff 19). With it: a story save with a visiting party restores to the
   same state again (the save upgrade no longer embeds the visitor's margin-less nest plane).
2. **Smooth motion** — `game/playout.ts`: a playout clock R on the loop's own pace (ticks asked for + accumulator),
   kept L ticks behind it (L = the 98th percentile, over the last 64 arrivals, of how far the loop's clock got past the
   newest tick before the next arrived, + 0.12), pulled toward its target by at most ±10 % of its pace (a gap over 3
   ticks re-anchors). Each frame with ticks sets every ant's, food's and creature's px/py/ph to where it is drawn
   (`MotionCarry` through `ColumnReader.read(…, carry)`); a frame with no tick keeps them. α = (R − from)/(to − from)
   may run past 1 by half a tick when a frame is late, easing off as it does. Teleports snap (space change; a jump over
   10 mm + 3 × (ticks + 1) × the last tick's travel). Paused: R glides to the newest tick and stops. `tests/smoothMotion.ts`
   (uneven arrivals at 60/144 Hz: steps within 2 % of the true speed at p99, against 165–347 % off for the old α, which
   froze in 12 % and jumped in 6–11 % of frames).
3. **Instant feedback** — `game/intents.ts`: a surface marker moved or a group sent to one turns its ants toward it on
   the frame of the input (blend rising over 160 ms, h + w·d so the sim's own turn meets it, fading after 1.1 s; refused:
   200 ms); `antHeadingHook` in the ant renderer. A refused hex order's ghost ring unwinds in 300 ms
   (`pendingHexes` kind 'refused'); player-facing refusal reasons (capitalised sentences) are said once.
   `tests/feel.ts`. The rest of the list was already same-frame (selection ring, marker flag and trail preview, ghost
   hexes, the ack click, the camera).
4. **Command delay** — `MIN_DELAY` 1; the host's delay is `ceil((path + min(50, path/4 + 25)) / 50)`: one tick on a
   LAN, the old value on long paths. `tests/net.ts` LAN case (1–4 ms one way: delay 1, 20 ticks/s, no waiting, own
   commands act 2 ticks after they are given; the 150 ms case unchanged).
5. **Client-side visuals** — `render/viewCull.ts`: the views leave out ants more than 40 mm outside the camera's view
   (not those in the air or on a creature); the ant renderer catches a returning ant up in one step (`catchUp`: its
   timers and springs run the time it missed, up to a second; its gait keeps its pace; its body takes its heading).
   Zoomed in on a crowd the ant renderer's time falls about tenfold (`tests/clientVisuals.ts`,
   `tools/perf/antRendererBench.ts`). Seeds hashed from ids (gait phase, antenna wave, pose phase) and places (acid
   mist), sparks from a seeded sequence: renders no longer differ run to run. Combat particles are written once at
   spawn and played by the vertex shader in closed form from t − t0 (drag e^(−dτ), gravity, the landing time worked out
   at spawn); only the new slots are uploaded. The ant shader is untouched (still 16 attributes); health bars and rings
   were already instanced quads drawn only for the few units that need them.
6. **Messages** — delta entity columns (`ColumnWriter.write(…, delta)`: when every entity was in the last frame too —
   rows matched by id, so deaths and reordering do not matter — the columns nobody changed are left out, 50–70 % of
   them in a fight) and a generated reader
   (one loop per schema with named stores; the plain loop where a page forbids compiling code). Big fight (829 ants,
   96 creatures, build machine, Node): 716 → 381 KB a frame, the columns' read 3.1 → 1.8 ms. `tests/performance.ts`
   checks the replica's ants stay exactly the simulation's. The simulation's systems were profiled
   (`tools/stress.ts`, a CPU profile): the time is spread over the ant brains, combat and separation with no single
   hot spot; no change to the simulation (its results are untouched: determinism check, replays).
7. **UI** — marker counts once a tick instead of every frame (they walk every tile of every group); label and tip
   styles written only when they change. Pointer events with `touch-action` already (no 300 ms delay, no blocking
   touch listeners).


## 30. Model redo: Saiy-Ants and sickle-jaw termites; the rest of spec 09 (rows, grab-and-squirt fit, balance, Termants) — branch `feature/models-saiy-sickle`

User specs: `claude/realism/10-spec-saiy-ant-sickle-jaw-models.md` (the models, with the fire ant pilot's playbook) and the parts of `claude/realism/09-spec-sickle-jaw-termants.md` it says still apply. (Numbered 30 at the merge: §27 the shared underground, §28 audio v3, §29 performance v2 landed on main first.)

- **Saiy-Ants** on *Camponotus* anatomy (`saiyMorphs.ts`, `antGeometry.ts` `campo` terms: set-back antennal sockets, a keeled clypeus with a dark suture; `mandibleSpecs.ts` `SAIY_*_JAW`, five teeth; baked recipe `SAIY`; planted feet; three bites per caste, no acid — the user's rule; the gold surge's stretch and overshoot in `antViews.speciesExtras`). Hair (briefs 07/08) unchanged.
- **Sickle-jaw termites** on the ant pipeline (`rhyMorphs.ts`, routed by `NASUTE_ANT_PATH`; `nasuteBuilder.ts`: the C-hook sickles, the snout's down-curve and pore, the worker's round glossy head (`head.round`) and egg-shaped abdomen (`abdomen.front`), the soldier's bold tergite bands (`abdomen.band`) and crimson sickles darkening only at the hook (`sickle.tip`); presoldier and larva morphs). The king and queen stay on the termite kit, as the conehead royals do (review round 1: the user preferred the kit's queen; the ant-pipeline royals and their builder options were removed). Animation: `antViews.sickleAntPath` maps the kit states to attack cycles (special 7 grab, 8 hold-and-squirt, 9 free squirt, 5 drum) and poses (THREAT, RUSH), `attackPoses` `S_GRAB` / `S_HOLD` / `S_SQUIRT`; the acid jet and fizz drawn by `antRenderer` from the snout's tip. The kit's sickle-jaw worker and soldier castes stay in `render/termite` (their rig-texture rows are fixed, as the conehead castes' were) but are no longer drawn in the game. The hold pins the victim head-on in line with the soldier, its head inside the closed hooks (`SICKLE.grab.gripMm`, `victimInHooks`; the kit-derived `SICKLE_SOCKET` is gone from `termiteRoyalData.ts` and its generator).
- **Spec 09 §2.4** the defensive rows removed (`sickleTrail`, `sickleRowSlot`, `sickleGuardIndex`, `SICKLE.escort`, the short guard aggro, `tools/sickle-guard.ts`, `tools/sickleGuardScene.ts`, the tests and docs); soldiers gather or hold the escort ring. No saved fields existed (the posts were derived per tick), so old saves load unchanged.
- **Spec 09 §2.2** a knockback (`flingAnt`, `gripAnt`) ends a hold cleanly on either side (`sickleHoldBroken`; the victim knocked loose → `endHold(…, 'flung')`); the hold stays anchored (`slots.anchored`); mounted sickle-jaws bite like other riders (they climb first: `tryClimb` runs before `sickleAttack`).
- **Spec 09 §2.3** balance in `docs/balance/castes.md`.
- **Spec 09 §3** Termants rebuilt (`termantMorphs.ts` `real`; builder options `antenna.termite`, `head.fontanelle` — the old `head.pore` tube removed — and mandible type `sabre`; recipes `TERMANT_W` / `TERMANT_S`; planted feet and attacks in `antMotion`).
- Review round 1 (all species): the leg-grooming idle lifts one hind leg at a time (`antMaterial` pose 2); planted feet no longer slide outward during attacks (the attack keys' `spread` removed). Saiy-Ants: faceted visible eyes, larger reddish-brown jaws.
- Review round 2: the hold back to head-on and in line ("make the two still parallel to each other ( straight) just make mandibles clasp of termite better"), the victim's head inside the hooks; the sickle-jaw workers bite with the ant workers' set (lunge, clamp, chomp; "make them similar to ant worker attacks"); bites no longer spray grit (`combatFx` 'bite': "remove the dust particles").
- Review round 3 (the user's field photos, study only): the worker rebuilt ("redo rhyncotermes workers based on real life images cos they look off") — a small round glossy orange dome of a head (no pale fontanelle or Y suture: `head.suture` removed), a lighter orange thorax, a big glossy chocolate egg-shaped abdomen whose tergites are divided by dark creases, textured as in the photos ("make the workers have more texture in abdomen like reference photos": pillowed plates `abdomen.pillow`, the spiracle row `abdomen.spiracles`, fine golden hairs `abdomen.hairs`, and the castes' first baked cuticle recipe, `RHY_W` in `render/bake/recipes.ts`: mottled gut, hair pits, a soft undulation); the soldier's sickles a quarter slimmer and wine-crimson, black only at the hook ("slightly less thick and more colored like irl counterparts"), and its abdomen fuller and tan-brown with bold brown bands ("as well as their abdomens"). The presoldier takes the soldier's new shape in its own pale colours; the larva is unchanged.
- Checks: morph hashes (only these three species changed; `tests/data/morph-hashes.json` re-baselined for them), `tools/height-data.ts` regenerated (climb data unchanged: creatures only), `npm test`, review pages rounds 1–4.

## 31. Saiy-Ant Blaster: energy orbs from the mouth, a 3-second beam in gold form; gold form at least 10 s (user spec 2026-11-07, claude/saiy-ants/09-spec-saiy-blaster.md) — branch `feature/saiy-blaster`

**Base.** Built on the model redo (§30; merged into this branch while it was in review, then approved and merged into
`main`, handoff 21): the blaster's morph derives from the redone `saiy_worker`.

**31.1 Caste** — `aurimyrmex_blaster`, display name **Blaster**, role `soldier` (there is no `ranged` role; the mortar and
rapid sprayer are soldiers too), morph `saiy_blaster`, worker-sized and light (length 6.6, hp 12, armour 0, speed 24),
`surge: true`, `mount: 'none'` (no climbing: it fires from the ground), a new caste field `blast` (`species.ts`) with
the shot data; brood times and costs in `BALANCE.castes`; numbers in `BALANCE.blaster`. AI mix (`colonyAI.defaultMix`):
worker 0.68, soldier 0.18, blaster 0.14. Termants can steal it as **Saiy-Ant Blaster** (`STOLEN_CASTES`, heavy
threshold, after the soldier; the per-species lookups take every entry of a species).

**31.2 Sim** (`src/sim/saiyBlaster.ts`, deterministic) —
- Positioning reuses the shooters' (`attackUpdate`: walk to 0.9 × range, back off inside 0.4 × range, hold anchored);
  the shot is `AS.Spray` → `blastShot`: wind-up (head turns to aim; the mouth glow brightens), fire, recovery.
- Orb: `Projectile` kind `orb`: straight at where the target is; each tick its swept segment is tested against every
  enemy ant and creature near it (allies skipped) and the nearest along the path takes the hit (damage type `blast`:
  physical, armour as a bite); a wall (surface: blocked cells, banks; nest: soil) on the segment ends it first; at
  1.3 × range it fizzles. Events `orb` (fired), `orbHit`, `orbFizz`.
- Shot counter `shotN`: reset to 0 whenever a shot is fired outside the gold form; in gold, shots 1–4 orbs, 5 the beam.
- Beam: aimed at the densest line of enemies within the beam's length (candidate headings toward each enemy in reach,
  scored by how many the beam would cross; ties keep the target's line); its length cut by the first wall; fixed for
  `beamTime` 3 s; every `beamTick` each enemy crossing it takes `beamDamage` (× the surge bonus at the moment of firing);
  the ant is planted for the whole beam (an `antSystem` guard before jobs, orders and combat: nothing moves or turns it);
  a fling, a grab or death ends it; the gold form ending does not. Then `beamCooldown`. Fields `beamT`, `beamH`, `beamL`,
  `beamD` (damage a pulse), `beamP` (pulse clock).
- Gold form: `BALANCE.surge.duration` 4 → 10 s (level 3: 5 → 12); cooldown 20 → 30 s (level 2: 14 → 22) so the gold
  share stays near the old one (balance matrix).
- `aggroRadius`, the pursuit leash and `warAI.weight` count the blaster's range and damage.

**31.3 Model** (`saiyMorphs.ts` `SAIY_BLASTER`, from `SAIY_WORKER`): slimmer and a little longer, a larger rounder head
with the jaws set wide, the six locks the same design swept back further (lower and longer), a mouth-glow piece between
the jaw bases (surface flag 9.5: emissive, white-blue → gold with the gold level; per-instance level in the rage channel, which
the blaster's program reads as the mouth glow — `#define MOUTH_GLOW`). Poses (`antViews.ts` `blastPose`): head aims,
jaws part wide in the wind-up, recoil on each orb, braced for the beam (legs spread, body low, head steady, a tremble).
Morph hashes re-baselined for `saiy_blaster` only; height data regenerated.

**31.4 Effects** (`render/game/blastFx.ts`, inside each scene's `CombatFx`; instanced, played in closed form in the
shader from the sim's events — nothing stepped per frame on the CPU but the few live beams' end sparks): orbs from `orb`
(where and when fired, at the orb's speed; the projectile id `pid` ties `orbHit` / `orbFizz` to its orb, which runs on to
the hit point and bursts there): core, coloured shell with swirling crackle, a short trail, ground light; bursts of
light, sparks and dust on a hit, a soft pop on a fizzle (particles in `CombatFx`). Beams from `beam` / `beamEnd`: core,
rippling flickering glow, the charge ball at the mouth, the far-end burst, ground light, a flash on and a fade out. Bloom
only on the cores (HDR > the bloom threshold); everything at least a few pixels across at gameplay zoom. Pools: 512 orbs,
64 beams, the oldest reused. A sim event `blastCharge` marks the wind-up (render and sound).

**31.5 Sounds** (audio v3 recipes in `tools/audio/sfx/recipes_combat.py`, made for this game, original):
`species.blaster_charge` (rising hum, snapped off at the shot), `species.blaster_orb` (punchy fwip; at 0.62 × the
beam's flash), `species.blaster_hit` (sizzle; quiet and higher for a fizzle), `species.blaster_beam` (steady roar-hum
loop, a `LoopBed` that follows the beams near the listener). `build.py pack <filter>` packs only those sounds (the rest
of the manifest and files kept).

**31.5b Balance as built** (`tools/blaster-balance.ts`; docs/balance/castes.md "Saiy-Ant Blaster"): the Blaster backs
off from a foe inside 0.4 × range at 60 % of its own speed, gold or not (it out-ran every melee caste in gold and won
even in contact); in a marker's guard crowd it stands `holdBack` 14 mm behind its place (the melee line in front).
The 10 s gold form doubled the Saiy worker's and soldier's equal-food margins, so their health and bite were scaled
back to the tie with the references (the gold boosts themselves are kept).

**31.6 Verify** — `tests/saiyBlaster.ts` (first enemy on the path, allies never hit, walls, physical damage, five-shot
cycle in gold only, beam length/planting/finishing after gold ends, densest-line aim, 10 s gold, determinism);
balance matrix runs; replays and two-tab LAN in sync; 50+ blasters cost; clips; a review page for the user; handoff.

## 32. Performance v3 — big colonies (500–2,000 ants) without lag, same looks, same results (user spec 2026-11-07, claude/performance/03-spec-performance-v3-big-colonies.md)

Branch `feature/performance-v3` off `main` `8e07623`. Hard rules: the golden set matches exactly (any visible change —
LOD, impostors, resolution — only with zoom clips and the user's approval); the simulation's results are identical
(canonical hash lists from `tools/perf/same.sh` against main for every sim change, the determinism check, replays;
LAN two-tab in sync).

### 32.1 Measured first
- **Stress scenes** (`tools/perf/simBench.ts`, Node, build machine; 500/1,000/1,500/2,000 ants): fight, economy
  (foraging), nests (full nests with digging), ten colonies, titan raid into a full nest, the shared-underground tunnel
  fight. Baseline main, ms a tick: fight 19.0 @1,000 / 45.2 @2,000; economy 26.9, nests 23.4, ten 22, titan 29,
  tunnel 26.4 @2,000. Per system at 2,000: the ant brains 12–16 ms (combat preempt and attack, foraging and flow
  fields, hex lookup), separation 8–10 ms in dense crowds.
- **The cause of half of it:** V8 kept 138 hidden classes for ants (fields added in whatever order a code path first
  set them, `delete` sending some into dictionary mode): every hot loop over ants was megamorphic.
- **The user's laptop** (`?bench=1`, Safari, Apple 8-core GPU, 1,470×956 at 2×, high quality): 28–37 FPS in the
  fight, mp4 and arena scenes with the main thread at 2–4 ms and the sim at 5 ms — **GPU-bound**; the full nest 19 FPS
  with 6 ms of render work on the main thread and nest-chunk rebuild hitches of 13–28 ms.

### 32.2 Plan (each step measured before and after; results proven the same)
1. **Sim, without changing a single result:** one object shape for every ant (all fields declared in one literal,
   restored saves normalised, fields cleared instead of deleted); separation walking the hash itself with exact early
   outs; the hash packed cell by cell (same items, same order); cheaper exact lookups (hex centres from column/row).
   Then combat (preempt, attack slots, go-round), foraging/flow-field lookups, colony brains, allocations — profile
   per call site, keep floating-point order, only side-effect-free early outs.
2. **GPU (the laptop's limit):** a bench scene that turns each effect off in turn at a fixed camera (AO, bloom, DOF,
   all post, shadows, 1 device pixel, ants hidden, grass hidden) so the user's run shows what each costs; then the
   cheapest identical-looking wins (shadow casters, overdraw, upload ranges); anything that changes pixels goes to the
   user with clips first.
3. **Ants on the GPU:** instance transforms built in the vertex shader from a data texture (position, heading, previous
   values, state, caste, seeds; dirty rows only) — the golden set must match exactly.
4. **Full nest:** the render work on the main thread and the chunk rebuild hitches (spread or move the rebuilds).
5. **Worker → main:** the viewed space at full rate, the others at a low rate with a summary per space for the UI;
   bytes and decode time at 2,000.
6. **UI/audio, memory:** cheap with hundreds of ants; no growth over 45 min; GPU memory toward the phone's 600 MB.
7. **Verify:** targets table in `docs/performance.md` ("Performance v3"); golden set; hash lists, replays, LAN;
   `npm test`, determinism, build; docs, handoff 21, merge, publish.

### 32.3 What was done (in order)
1. `tools/perf` — simBench (the stress scenes), canon.ts (canonical hash: keys sorted), same.sh (hash lists of two
   checkouts compared), ab.sh (alternating timing runs), cpuprof/cpuchildren (profile summaries).
2. **One shape for every ant** (`factory.ts antShape/normalizeAnt`, `world.ts`, deletes → `= undefined`): fight
   1,000 −23 %, economy −15 %. `tests/performance.ts` checks every interface field is in the shape and a restored
   world hashes the same.
3. **Separation**: the pair loop walks the hash and drops pairs pairCb would drop before touching them; an exact early
   out for pairs too far apart for any push or for one to be under the other; spaces read from a typed array. 2,000-ant
   fight 45.2 → 26 ms.
4. **Hash packed** cell by cell before the first query; **hex lookup** from column/row.
5. **Bench GPU scene** (`dev/bench.ts` 'gpu'); the profiler counts draw calls and triangles over the whole frame (Safari
   showed one call before) and keeps running totals.
6. **Timing bundled** (`tools/perf/bundle.sh`): vite-node reaches every imported function through a module object;
   the game's worker is one bundle. All timings since are of bundles (same.sh and ab.sh bundle both checkouts).
7. **Separation's pair loop on typed arrays** (positions, teams, ids, states, foes filled before the loop);
   **creature spacing** computes each creature's radius, attack, push-through and team once a pass.
8. **Surface flow cache**: use counter instead of a map re-insert per look-up (same eviction order).
9. **Hex lookup fast path** (the common case without the 3 × 3 loop; 7.2 M points checked against it).
10. **Worker frames**: a generated column writer (named loads) and key discovery testing the value first — the same
    packets byte for byte (`tests/performance.ts`).
11. **The ground and scenery in culled chunks** (render only, the same triangles): the terrain heightfield (5 × 5
    chunks sharing one set of attributes), the grass (5 × 5 instanced chunks, spheres padded for lean and wind), the
    map-wide pebble sets and merged decor (`render/chunks.ts`); the water draws only the contiguous rows a camera sees
    (`onBeforeRender`, same index order — it is transparent). On Meadow Pond the grass alone was 1.1 M triangles a
    frame, the pebbles 310 k (twice: they cast shadows), the water 320 k.
12. Merged `main` twice (audio v3, the model redo); the reference for same.sh is `main` + the tools.
13. **The ant record a class** (found by bisecting a 20 % slowdown in the bundled full nests to the shape commit): an
    object literal of ≥ 128 fields keeps them all outside the object and makes a class per copy; a constructor keeps
    151 inside. Always-set fields start as numbers. All 18 runs the same.
14. **Replica rows** from a constructor generated per schema (main thread; fields inside the object).
15. **Measured** (bundled, best of 2, `main` 56be698): 1,000 ants 5.7–10.9 ms a tick (target 15), 2,000 ants
    10.2–16.6 (target 25); the big fight at 2,000 33.2 → 15.5. Spikes over 40 ms at 2,000 not gone (1–16 of 300 in
    four scenes: synchronised one-second timers of the stress scenes, minor GCs). Docs: `docs/performance.md` v3.

### 32.4 Game speed and cutscenes (after the merge; the user asked whether they had been checked — they had not)
1. **Measured:** bench scenes **speed** (the big fight at a fixed camera at 1×, 2×, 4× and 8×: the speed really
   reached, frame times, the main thread's messages and events a frame, the worker's tick time) and **cine** (The
   Antlered King's opening flight, from its first frame to the camera's return: frames, hitches and their causes,
   shader links, texture uploads); `tests/browser/speed_check.py` (the speed steps from a script).
2. **Cutscenes:** the flight links no shader and uploads no texture (everything it shows is prepared at load).
3. **Game speed:** a tick costs the same at any speed; at N× the worker runs 20·N a second (this machine holds
   3.0–4.9× at 2,000 ants, 4.6–8.8× at 1,000). Found: lockstep and replay ticks went to the worker with no limit, so a
   device whose worker could not keep up fell further behind every second; single-player batches grew to 24 ticks.
   **Worker lag limit** (`game/simHost.ts` `WORKER_LAG_MS` = 100 ms of the worker's ticks): single-player batches
   hold at most that much (still at most 24); lockstep and replay ticks wait while that much is queued (a rejoin's
   catch-up 500 ms). Pacing only: the same ticks with the same commands (no `BUILD_ID` change). `tests/performance.ts`
   checks the caps and a simulated overloaded 4× match (90 ms behind with the limit; 2 s after 10 s, growing, without).
