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
   - Gene Thief 9.75 mm.
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
| **12** | **Playable species and their special tiles** | Lasius: aphid tending and a **root-aphid pasture** tile. Formica: acid and a **thatch** tile (warmer nest, faster brood). Atta: leaf cutting, minim hitchhikers and the **fungus garden** tile. Solenopsis: venom, a mound with no central entrance, and a **sun-warmed brood mound** tile (workers move brood up into the warm mound, so it develops faster). Gene Thief: brood tiles for any borrowed caste. Plus the rival AI's tile and marker logic. |
| **13** | **Game modes** | Main menu: **Single-player** and **Multiplayer** (user note). Single-player has sandbox first, then skirmish (1–3 AI), then the **two outdoor missions** with narrator captions and boss finales. The custom Gene Thief colony is selectable in all of them. Formicarium is a map style only (see §4.1). **Multiplayer** has the lobby and matches (2–4 players plus AI slots) from Phase 10. |
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
- [ ] The game launches to a main menu and every mode is playable start to finish: **sandbox, skirmish and the two outdoor missions with boss finales**. The Gene Thief custom colony is selectable in each.
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
- [ ] At least four playable species, plus the Gene Thief custom colony, play differently and behave like their real counterparts.
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
Already in place from Revision 2: Lasius root-aphid pastures and aphid tending, Formica thatch and acid (mortar and rapid sprayers), Atta leaf cutting, minim hitchhikers and fungus gardens, Solenopsis venom, Gene Thief borrowed castes.

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
