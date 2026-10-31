# Progress Log

## Phase 1 — Plan (done)
- Scaffolded TypeScript + Three.js r186 + Vite 7 project with the module layout from the brief
  (`core/ sim/ render/ world/ ui/ modes/ audio/ docs/creatures/ tests/ tools/`).
- Wrote `DESIGN.md`: units (1 unit = 1 mm, real body sizes), surface/nest spaces, fixed 20 Hz sim with
  interpolated rendering, plain-data `SimState` for saves, spatial hash, BFS flow fields, pheromone grid,
  ant state machine + response-threshold task allocation, combat model (bite/acid/sting, grapple,
  spread-eagle, knockback), creature/boss behaviour modules, rival utility AI, GPU-animated instanced ants.
- Core utilities: seeded serializable RNG + noise (`core/rng.ts`), typed event bus (`core/events.ts`),
  fixed-timestep loop with speed scaling (`core/loop.ts`).
- Headless screenshot harness (`tools/shot.py`, Playwright + SwiftShader WebGL2) verified working;
  it will be used for every visual review.

## Phase 2 — Research (done)
- Wrote 20 biological reference notes in `docs/creatures/` (index in `docs/creatures/README.md`):
  shared ant anatomy/gait/behaviour; 5 ant species (Lasius niger, Formica rufa, Atta cephalotes,
  Solenopsis invicta, Eciton burchellii); predators and creatures (wolf spiders Trochosa + Hogna,
  Pterostichus melanarius, Macrotermes bellicosus, Lithobius forficatus, Mantis religiosa, antlion,
  aphids, pill woodlouse, devil's coach horse, cutworm); bosses (Lucanus cervus, Brachypelma hamorii,
  Scolopendra cingulata, Hierodula membranacea, Hogna carolinensis mother).
- Notes give proportions as fractions of body length so the procedural builders consume them directly,
  plus colour/finish, gait, behaviours and game mapping. Checked against AntWiki/USDA ID sheets and
  species accounts (e.g. Solenopsis: 10-segment antennae with 2-segment club, no propodeal spines;
  Eciton: single-facet eyes, four worker castes; Mantis religiosa forecoxal eyespot).
- Correction to the brief noted: worker antennae are 12 segments total in most species (scape + 11),
  11 in Atta and 10 in Solenopsis — models follow the real counts.

## Phase 3 — World and camera (done)
- `world/terrain.ts`: deterministic heightfield (regenerated from params + sculpt/water ops so saves stay
  small), continuous ground-cover weights (soil/moss/sand/litter), walk-height overlay so ants climb over
  pebbles/twigs/leaves, obstacle mask, flood-filled puddles following the terrain contour, flood level.
- `world/nestGrid.ts`: vertical soil cross-section with strata hardness, buried undiggable stones, dig
  designation, bite-based excavation, chunk dirty tracking, base64 serialization.
- Rendering: procedural tileable textures (DataTextures with height in alpha), height-blended terrain
  splat shader with anti-tiling, instanced wind-swayed grass with Bayer-dither see-through toward the camera
  focus, merged props (displaced pebbles/rocks, bark twigs/logs with end caps, atlas leaves with veins,
  conifer needles, lathe mushrooms with gills, acorns), reflective water from a cube snapshot, procedural
  sky + PMREM environment, sun with view-following snapped shadow frustum, dappled canopy light patch.
- Nest diorama: signed-distance heightfield (blurred for organic contours) → rounded tunnel cavities behind
  glass; shader strata (humus/loam/clay/gravel), pebbles, rootlets, stones, moist scraped back wall, bump
  shading, dig-designation hatch, chamber glow slots; surface strip with grass above; optional glass+frame.
- Post pipeline needing a single scene render (ants are vertex-animated): depth-only SSAO + bilateral blur,
  tilt-shift DOF, colour grade/vignette per space, bloom, ACES output. Quality presets low/medium/high.
- Cameras: RTS surface rig (WASD/drag pan, wheel zoom, right-drag rotate, pitch flattens when zoomed in),
  nest rig, observe follow rig; cinematic dive transition between surface and nest (verified frame by frame).
- Headless harness extended with a synchronous shot mode and scripted key/eval steps.

## Phase 4 — Ant models and animation (done)
- `render/ants/morphs.ts`: morphology tables for 15 species×caste combinations from the reference notes
  (Lasius worker/queen; Formica worker/major/queen; Atta minim/media/soldier/queen; Solenopsis minor/major/queen;
  Eciton minor/soldier/queen): head shape (rect/round/triangular/heart with posterior notch, occipital spines),
  eye size/position/ocelli/single-facet, antenna segment counts (12/11/10 with 2-segment club), mandible type
  (triangular toothed, falcate sickle, massive), mesosoma profile & spines, 1-node scale vs 2-node waist,
  sting vs acidopore, leg length, per-part colour/roughness/clearcoat/pubescence sheen, hair density.
- `render/ants/antGeometry.ts`: anatomical builder (lofted head/mesosoma/gaster with tergite grooves, neck,
  clypeus, frontal carinae, faceted compound eyes, ocelli, toothed mandible blades or sickle tubes, elbowed
  antennae with per-segment funiculus, petiole scale or petiole+postpetiole, coxa/trochanter/femur/tibia/
  5 tarsomeres + claws, fore-tibia strigil comb, erect setae, acidopore coronula, wing scars on queens).
  Legs solved with 2-bone IK to splayed, mostly-extended poses so knees sit near the dorsum.
- `render/ants/antMaterial.ts`: vertex-shader skeleton: alternating tripod gait with stance/swing, knee and
  ankle flex, body bob; head yaw/pitch; mandible open; antenna socket/elbow motion with sweeping and tapping;
  gaster raise/curl; poses (antenna grooming with the strigil, leg rubbing, trophallaxis, sting, acid spray,
  digging, grapple brace, alarm, carry) and death curl. Matching depth material for shadows. Per-fragment
  roughness/clearcoat/sheen, hexagonal ommatidia, micro-sculpture bump.
- `render/ants/antRenderer.ts`: instancing manager with 3 LODs chosen by projected size (full, medium,
  top-down impostor atlas rendered from the real model at 8 gait phases), frustum culling, growable buffers,
  partial buffer uploads, gait phase advanced by distance/stride so feet don't slide, smoothed animation
  state, minimum on-screen size for far impostors.
- Reviewed with the ant lab (`?scene=antlab`) from side/top/front/3-4 views and a swarm test
  (`?scene=swarm`); fixed detached heads, arched legs, inverted gaster winding, over-bright eyes, colours.

## Phase 5 (in progress) — playable prototype build

- Fixed nurse brood pickup after the hex refactor (new walk-to-brood state); brood now moves into nurseries, gets fed and hatches. Tightened population cap. All headless tests pass.
- `GameSession` (src/game/session.ts): World + fixed 20 Hz loop + GameView, instanced ants in both spaces (surface heightfield adapter, nest back-wall adapter following the cavity SDF), food, brood, nest decor and chamber lights, surface decor (entrance holes with growing spoil rings, aphid colonies on stems, leaf plants, rally flags), pheromone overlay texture.
- Player commands: hex dig painting, room tiles (food, nursery, refuse, fungus, per-caste development rooms), clear tool, worker/soldier rally markers, recall, speed and pause, nest/surface dive.
- Nest shader: honeycomb seams on dug floors, per-room floor tints, hex hover preview (valid/invalid) with reason tooltip.
- HUD (src/ui/hud.ts) and start menu (src/ui/menu.ts): species, Gene Thief caste picks, rival colony, map style, quality.
- `tools/package-artifact.py` packages `dist/` as a shareable prototype page.
- Not yet in: creatures/bosses (Phase 7), species abilities and rival AI behaviour (Phase 8), modes (Phase 9), audio/settings/save (Phase 10).

## 2026-10-24 — Change of plans: top-down nest, hex brood tiles, marker UI

The design changed before Phase 5 was finished; see `CHANGE_PLAN.md` for the full plan.
- **Nest:** from a vertical cross-section behind glass to a **flat plane seen from above**, with the same camera controls as the surface. Raised dark undug soil, rounded tunnel walls, sunken floor in warm pooled light.
- **Colony:** chambers, nurseries, development rooms and the caste-ratio slider are replaced by **hex brood tiles**. Each brood tile raises and keeps exactly one ant of its caste. Adjacent same-type tiles merge into **nest groups**.
- **Command:** two-kind rally flags are replaced by **five numbered markers (I–V)**. Groups are assigned to them by dragging cards in a six-column **marker panel**. The rest of the UI is rebuilt to the reference layout: top bar, bookmarks with live previews, nest and surface minimaps, build panel.
- **Kept:** ant models, animation, creature notes, surface world, rendering, post-processing, and the simulation infrastructure (foraging, trails, digging, brood cycle, combat base).
- **Replaced:** the cross-section renderer and chamber logic.
- **Phases renumbered:**
  - 5 top-down nest and tiles;
  - 6 markers and UI;
  - 7 colony sim on tiles;
  - 8 combat;
  - 9 creatures and bosses;
  - 10 species and special tiles;
  - 11 modes;
  - 12 audio, menus and saves (the upgrade tree was later cut);
  - 13 polish.
- `DESIGN.md` is rewritten for the new design, with superseded parts marked. The Definition of Done is updated in `CHANGE_PLAN.md` §8.
- **Decisions recorded for review** (`CHANGE_PLAN.md` §4):
  - formicarium stays a map style only (the mission campaign remains cut);
  - home-column workers keep autonomous foraging;
  - hex size scales with the species;
  - bookmark hotkeys are Ctrl/Shift+1–4.

## 2026-10-24 — Skill tree removed
- At the user's request, the Adaptations upgrade tree and the Royal Jelly currency are gone.
  - `sim/upgrades.ts` is deleted, along with every persistent upgrade effect and the `upgrades` field on colonies and setups.
  - The top bar keeps Missions, the toggles, resources and Menu.
- In-game **tile upgrades** (levels I–III, bought with food from the build panel) are not a skill tree and stay. Their effect is carried by the ant's `power`, which scales health, bite, acid and venom.

## 2026-10-24 — Queen's chamber (user note)
- Every colony starts with a **7-tile queen's chamber**: the queen's hex plus the six around it.
  - Each chamber tile stores 25 food and raises one worker of the species, replaced after death.
  - A new colony is therefore the queen and seven workers, with 175 food capacity.
  - The seven tiles form one group that can be dragged to markers.
- Chamber tiles **cannot be built or removed** by the player or the AI. They are only the starting workers and food store.
- Starting worker brood tiles and the free starting food store are gone.
  - `startWorkers` now means extra worker brood tiles (rival head starts, tests).
  - Leafcutters still start with a fungus garden and two minim tiles to tend it.
- Tests cover all of this: the chamber's shape, one worker per tile, its food capacity, that it can't be built or removed, and that a brood tile placed next to it doesn't merge with it.

## 2026-10-24 — Phase 6 (in progress): markers, marker panel, UI layout; nest tabs (user notes)
- **World markers I–V.**
  - Each is a numeral above a downward arrow with a coloured glow and slowly drifting coloured smoke (shader-animated). The ground circle was removed per the user.
  - A live count label sits under each marker.
- **Marker panel.**
  - Six columns: home plus I–V, each showing current/max ants.
  - Group cards show a caste silhouette, living/max, a role badge and level pips.
  - **Drag and drop:** dragging a card shows a ghost and highlights drop columns; the dropped card animates into place and its ants respond immediately.
  - Click a header to place that marker; double-click to jump to it.
  - Collapse and cancel buttons on the left; Recall, aggression stance (attack / defend only) and the species ability on the right.
- **Species abilities** (`sim/abilities.ts`), each with a cooldown:
  - Black garden ant: mass recruitment.
  - Red wood ant: acid barrage.
  - Leafcutter: stridulation.
  - Fire ant: stinging frenzy.
  - Gene Thief: propaganda substance.
- **Build panel.**
  - Tiles tab: dig, one brood tile per caste, food, species tiles, remove.
  - Castes tab: stats and real facts for each caste.
  - Actions: food view, speed, upgrade selected tile, remove selected tile.
- **Top bar.** Missions (free-play objectives), toggles (food view, trails, creature info, hex grid, help), population, food, per-caste living/tiles, and Menu (pause, graphics, interface size, controls).
- **Rest of the UI.**
  - Minimaps for the viewed nest and the surface, with click-to-jump and the view frame.
  - An info card with a Follow (observe camera) button, a placement tooltip at the cursor, and messages.
  - The UI scales with the viewport and the interface-size setting.
- **Nest tabs (user note).** Tabs 1–4 are nests, not camera bookmarks.
  - Tab 1 is your nest; tabs 2–4 are rival nests, all freely viewable.
  - The tabs sit lower on the left as a tab strip over a live preview panel.
  - Each colony now has its own nest scene, terrain, ants and remembered camera.
  - Building is limited to your own nest; markers can be placed in rival nests to raid them.

## 2026-10-24 — Phase 6 complete: browser interaction tests, click fix, marker smoke
- **Bug fixed: the world couldn't be clicked with the new UI.**
  - An old rule in `style.css` (`#ui > *`) outranked `.gui { pointer-events: none }`, so the UI layer swallowed every click and wheel event on the 3D view.
  - It's now `#ui > *:not(.gui)`. Marker placement, tile placement, selection, zoom and pan on the canvas all work.
- **Browser tests with real mouse and keyboard input** (`tests/browser/`), all passing:
  - Drag a group card: a ghost appears and the target column highlights. The drop assigns the group, the card moves, and dragging it back home works.
  - One group dragged through **all six columns** in turn.
  - Header click then ground click places a marker in the nest. Key 2 then a click places one on the surface (after Tab). Key 3 selects III; Esc cancels.
  - **Ants reach their markers**: a group sent to marker IV in the nest gathers there (3/3). The 7 chamber workers sent to marker II all go out to the surface and around it (7/7).
  - Tiles:
    - the ghost tooltip shows cost and grouping;
    - a click places a food store;
    - a click selects a tile;
    - Upgrade raises its level and costs food;
    - Remove deletes it and refunds.
  - Dig: drag-painting designates hexes; painting over them again clears them.
  - Nest tabs 1 and 2 switch the viewed nest. The stance toggle, the ability cooldown, the menu (opens paused, Esc closes), wheel zoom, drag pan, and O to follow / Esc to stop all work.
- **Marker smoke reworked.**
  - The additive smoke vanished over bright grass at low quality.
  - It is now alpha-blended wisps (noise-broken puffs) that curl up, swell, lean downwind and fade.
  - It reads on grass, soil and nest floors and stays light. The selected marker smokes a little more.
- **Screenshots checked against the reference.** Same structure:
  - top bar;
  - nest tabs with preview at left-centre;
  - two minimaps bottom-left;
  - six-column marker panel bottom-centre;
  - build panel bottom-right;
  - numeral + arrow markers with count labels.

## 2026-10-24 — Phase 7: colony simulation on tiles (economy, foraging, colony life)
- **Builder brain** (`sim/colonyAI.ts`). It digs and places tiles like a steady player, and drives every AI colony, so rival nests now grow on their own.
  - It digs a compact ring around the chamber.
  - It adds food stores when nearly full, then species specials, then brood toward a caste mix.
  - Fighters wait for 12 workers. It won't overbuild while brood is backed up.
  - Groups are capped at 8 tiles and separated by gaps, giving several commandable groups.
- **Growth harness** (`tools/econ.ts`) was used for tuning. Every species now grows from 8 ants to 100–190 in 30 minutes of steady play. The default population limit is raised from 40 to 300.
- **Foraging fixes found by profiling forager states:**
  - **Bug:** a forager's remembered food source was wiped as it left the nest. It now walks straight back.
  - Food is found by odour (radius grows with item size) instead of a 16 mm touch range.
  - Scouts fan out on personal headings and search for longer, instead of milling near the entrance.
  - Respawn targets an *amount* of surface food, so a few seed scatters no longer stop all respawning.
  - Income per forager roughly doubled. With many foragers, income is limited by how fast food reappears within reach, which is what markers are for.
- **Species foraging** (`sim/speciesAI.ts`). Its hooks existed but had never been registered.
  - **Atta medias cut leaves.** They smell plants, saw out a fragment, carry it to the fungus garden and return to the same plant. They no longer take prey or seeds, like real leafcutters.
  - **Honeydew milking** (Lasius, and now red wood ants, who in reality live mostly on honeydew). Ants stroke aphids until the crop is full; crowded or claimed aphid colonies are skipped. **A full crop visibly swells the gaster** in the renderer.
  - Every nest gets an aphid-infested plant and a leafy plant within reach. Food spawns clear of plants.
- **Colony life:**
  - **Trophallaxis** has its own partner field and contact timer. Its old use of `tk`/`tgt` collided with forager memory and combat targets. Honeydew foragers unload part of the crop to a resting nestmate at the store.
  - **Grooming:** searchers stop in the field to clean their antennae.
  - **Necrophoresis:** foragers no longer pick refuse-heap corpses back up as food. The heap stays outside and slowly decays.
- **Balance:**
  - Brood tiles cost max(2, 0.6 × caste cost), so cheap castes have cheap tiles.
  - Fire-ant minors carry 1.5.
  - Red wood ant workers carry 5 and cost 9; majors carry 7.
  - Atta medias help nurse brood, so Atta no longer stalls with one minim nursing.
  - Leaves regrow 3× faster on slightly more plants.
- **Tests: 13 new**, all passing (sim suite and 17/17 browser checks):
  - colony growth, outward digging, several groups;
  - egg → larva → pupa → adult;
  - larval feeding, grooming, trophallaxis, aphid milking, trail following;
  - corpses carried out;
  - leaf cutting and fungus;
  - leafcutter growth;
  - rival AI building;
  - the player colony not being auto-built.

## 2026-10-24 — Phase 8: combat and nest invasions
- **Spread-eagling works.**
  - New grapplers take the limb (antenna or leg) furthest from those already held, so victims get pulled in opposite directions. Pinned time went up 2–5×.
  - A pinned ant fights back at half speed.
- **Balance**, checked with equal-cost battles (`tools/battle.ts`):
  - fire-ant swarms beat red wood majors and Atta soldiers;
  - red wood workers vs fire minors is close;
  - Lasius got a modest buff (hp 16, bite 2.6) but stays the weakest per food, making up for it in economy.
- **Raids and nest defence:**
  - **Bug:** raiders walked in a straight line and got stuck behind puddles. Now they cross the surface along the target colony's way-home flow field, and any group heading to a distant surface marker follows a path (`goToSurfacePoint`).
  - Inside the rival nest, raiders path to the marker. Workers with nothing to fight carry off enemy brood as food.
  - **Defence:** guards and nearby workers converge on intruders. A 25 s **nest alarm** calls foragers home. Other workers ring the queen; nurses stay with the brood.
  - **Bug:** returning defenders used to walk straight back out to forage.
  - **Bug:** fighters could be shoved into tunnel walls by grapples and freeze there. A safety net now eases them out.
  - Queens are much tougher (500–1200 hp), so a scouting party can't assassinate one.
  - A fallen nest's brood lingers 90 s for raiders.
- **Builder fix:** it now reserves food for larvae already waiting. A rival had spent everything on tiles and then couldn't feed its brood (8 ants after 6 min, now 22).
- **Foraging fix:** scouts spread out from the entrance they used, not the nest's centre, which sits off to one side. Before, Lasius only ever searched north of their entrance. Home aphids and plants are placed relative to the entrance.
- **Combat effects** (`render/game/combatFx.ts`):
  - bite flecks of hemolymph and grit;
  - sting flashes;
  - acid jets with a faint mist;
  - dust when ants are thrown.
  - Each scene has its own pool, effects run on game time, and events go to the scene where they happened.
- **Tests:** 13 new sim tests, all 61 passing:
  - acid vs armour;
  - grappling, spread-eagle pins, venom stacking, casualties;
  - attack vs defend-only stance;
  - raiders reach the rival nest, defenders converge, a strong raid kills the queen and the colony is lost;
  - brood stolen;
  - a small raid is beaten off.
- **Browser tests:** 28/28 pass. Two checks were fixed (a zoom artifact, and marker foragers shuttling food home).
- Dev hook `?battle=…&raid=1` and `tools/raid.ts`.

## 2026-10-24 — Revision 2, Step 1: review and replan (EotU brood, jobs, upgrades, areas)
- The user's revision covers:
  - nanitic queen chamber;
  - a worker job system (dig → build → spawn, 6 points);
  - egg delivery with pre-staging;
  - EotU tile costs, highways and weighted pathfinding;
  - neighbour-point upgrades;
  - delete-downgrade with seed refunds;
  - up to 6 underground areas with access-locked coloured tabs;
  - camera additions (edge scroll, reset, Space jump, F1–F6, photo mode).
- I reviewed the affected code and wrote **CHANGE_PLAN.md §9**: what changes, which code it replaces, the implementation order and the test plan, plus **8 flagged decisions**:
  1. the brief overrides the earlier queen-chamber note (7 workers, 25 food each);
  2. the brief overrides the earlier note that all nests are freely viewable; tabs lock until your ants are inside, with a sandbox "reveal" setting;
  3. Space → jump to marker, P → pause, T → trails, C → reset camera, N → next area;
  4. no larval feeding and no pupa stage;
  5. digging takes 6 points, with no spoil hauling;
  6. idle home workers still forage near the nest;
  7. population max = brood capacity;
  8. phases renumbered.
- **DESIGN.md** is updated as the source of truth:
  - 3.6: nest jobs;
  - 3.7: tiles, queen chamber, spawning loop, upgrades, delete, movement, overlay;
  - 3.9: entrance markers;
  - new 3.12: underground areas and teams;
  - 5: area tabs, minimaps, build tools, top-bar populations, camera, hotkeys;
  - the caste tiers, and Definition of Done items.
- The Adaptations / Royal Jelly meta-progression was already removed (§4.12); nothing is left in the code or UI.
- The creature phase (now Phase 10) is paused; `sim/creatures/kinds.ts` (stats only) is kept for later.

## 2026-10-24 — Revision 2, System 8: underground areas; EotU foraging; new castes; S. geminata models
**Underground areas (System 8)**
- Done:
  - every underground map is keyed by space;
  - neutral caves and lairs (`sim/areas.ts`);
  - colony teams, with allies that never fight and that open area tabs;
  - markers dropped on another area's entrance send the group down into it;
  - foragers carry cave food home;
  - ants with no route to a living queen die within 30 s.
- UI:
  - numbered, coloured area tabs along the top of the minimaps (user note: no 3D preview);
  - the access rule: "No ants in this area", pulse when an area opens, alert badges;
  - fade cuts between areas with per-area camera memory; F1–F6, N and Tab;
  - Space jumps to markers across areas;
  - an area minimap with ramp arrows and dots; area-coloured entrance icons (a crown for nests) on the surface map;
  - cave entrances on the surface; a scurry fade at holes and ramps;
  - the info card shows job, level, area and a cut-off countdown;
  - settings for edge scrolling and "Reveal all underground areas".
- Tests: 13 sim checks and `tests/browser/ui_areas.py` (20/21 on the first run; the failure was in the test and is fixed). Screenshots: `shots/areas_tabs_on_minimaps.jpg`, `shots/areas_inside_cave.jpg`.

**Home workers stay inside (user decision, the EotU way)**
- Food comes only from groups at markers. The AI keeps its own forage marker on the richest nearby source and recalls it when invaded (DESIGN 3.11).
- Growth at 24 min: Lasius 98, Formica 60, fire ant 42.

**Castes (user notes)**
- Black garden ant: worker and soldier.
- Red wood ant: worker (a short acid opener, then bites), tank soldier (draws attacks), mortar (lobbed acid, splash at level 3) and rapid sprayer (fast jets, slow at level 3). Both shooters are in one colony; the major is retired.
- Tropical fire ant (*S. geminata*): worker, soldier and major.
- Leafcutter: minim, media, soldier (a scaled-up minim) and major.
- Costs are per caste, with every worker caste at 10 to build. They were tuned with equal-food battles (`tools/equal.ts`, mixed armies in `tools/battle.ts`).
- Fixes found on the way:
  - task changes no longer interrupt sprays or drop combat targets;
  - acid jets use swept hit tests.

**S. geminata models (user spec)**
- The reference note `docs/creatures/solenopsis-geminata.md` was checked against AntWiki. Corrections to the brief:
  - the major's back notch and head groove are *deep*;
  - the postpetiole is only slightly wider than the petiole;
  - major mandibles are black, with teeth worn flat.
- Models:
  - the worker is 2.8 mm, and the soldier is the same model scaled to 4 mm;
  - the major (6 mm) shares the body plan, with a square head, a deep notch and groove, and blunt jaws;
  - the queen is 8 mm, with a scutellum, wing scars and ocelli.
- New geometry:
  - clypeal carinae with teeth;
  - a wedge-shaped petiole with a tooth underneath;
  - a sting that slides out when stinging.
- Screenshots: `shots/geminata_*.jpg`; other castes in `shots/castes_*.jpg`.

**Still open**
- Remaining Revision 2 screenshots: egg delivery, a growing larva, a hatch and a full upgraded chamber.
- `ui_test.py` and `ui_test2.py` are updated for the new tabs and tools but haven't been run since.
- Then Phase 10: creatures and bosses, including the lair occupants.

## 2026-10-24 — Revision 2 wrap-up; Phase 10 started and paused (user note: multiplayer first)
- **Job locality.** A marker group now takes only nest jobs near its marker, and drops them when the marker moves out of the nest or out of reach. New test, which passes.
- **Browser tests.**
  - `ui_test.py` and `ui_test2.py` are updated for the tabs on the minimaps and the Upgrade/Delete tools.
  - New `ui_camera.py` covers pan, arrow keys, rotation, clamped zoom, bounds, reset, edge scrolling, minimap click-to-jump on both maps, a tab alert while you watch the surface, and photo mode with the free camera.
  - `tests/browser/with_server.sh` runs any of them against a short-lived dev server.
  - `ui_dig.py` passes. The updated scripts were still running when work paused.
- **Screenshot helper.** `?chamber=1` builds a 19-hex worker chamber upgraded to level 3 beside the queen, for the brood and upgrade screenshots (egg carried, larva growing, hatch, full chamber).
- **Phase 10, creatures and bosses: paused at the user's request**, so multiplayer and performance come first.
  - Written so far:
    - `sim/creatures/kinds.ts` holds the full table: pill bug, cutworm, ground beetle, wolf spider, stone centipede, devil's coach horse, mantis, antlion, spiderling, and the bosses stag beetle, tarantula, Scolopendra, giant mantis and Hogna mother.
    - `sim/creatures/creatureAI.ts` holds every behaviour program, boss phases with telegraphs, carcasses, combat hooks and an ecology spawner.
  - Not wired in yet: no systems are registered and there are no renderers. It compiles, and every test still passes.
  - It will be made deterministic and command-driven under the new architecture before it is switched on.

## 2026-10-24 — Architecture upgrade, Step 1: review, baseline and plan (user brief: performance + deterministic multiplayer)
- **Reviewed** the docs and every simulation, game, render and UI module for the brief.
- **Baseline** in `docs/performance.md`. `tools/stress.ts` runs 4 × 400 ants, about 75 creatures and 6 underground areas.
  - Tick time: 16–23 ms average, 43–50 ms p95, about 130 ms worst. The target is under 15 ms with no hitches.
  - About 46 % of the time is flow-field Dijkstra, because nest fields are cached per cell and every tile change throws them all away. GC is another 9 %.
- **Design** in `docs/multiplayer.md`:
  - deterministic lockstep at 20 Hz, with one seeded RNG and dmath;
  - commands as the only way to change the sim, with a binary encoding;
  - a simulation worker plus a read-only ViewWorld that interpolates;
  - a `Transport` interface (loopback, BroadcastChannel, PeerJS star, network simulator);
  - adaptive input delay, waiting and drop, hash checks every 100 ticks, desync dumps and reconnect;
  - the lobby, invite links, tools and deployment.
- **Non-determinism audit** (in `docs/multiplayer.md` §9):
  - about 260 transcendental `Math` calls;
  - AI state kept in `WeakMap`s outside `SimState`;
  - the UI writing to the simulation directly (session paint/click, the marker panel, menus);
  - frame-time tick counts, and per-client facts (`player`, `revealAreas`).
  - No `Math.random`, `Date.now` or `performance.now` is used inside `sim/`.
- **CHANGE_PLAN §10** is the new Phase 10. It sets the implementation order, the test plan and the flagged decisions. Creatures move to Phase 11, and the later phases are renumbered.
- **New working rule:** every new gameplay system must be deterministic and change the simulation only through commands.

## 2026-10-24 — Architecture upgrade, steps 1–7: determinism, commands, speed, worker, lockstep, lobby
- **Determinism (MP1).**
  - `sim/dmath.ts`, with 290 maths calls replaced.
  - Hidden state moved into `SimState`: AI brains, intruders and the pheromone phase.
  - Per-client facts moved out of the simulation: the local colony and reveal-areas.
  - `sim/snapshot.ts` (binary snapshot plus hash plus restore) and `tools/check-determinism.ts` (lint in `npm test`).
  - Determinism test: 20 min of a 4-colony game, run twice plus once restored from a snapshot, is identical at all 240 checkpoints. Chromium matches Node.
- **Commands (MP2).** `sim/commands.ts` has 11 command types, with binary tick packets and replay logs.
  - Every UI action now issues a command.
  - Single-player applies them at the tick boundary at once, so it plays exactly as before.
  - Pending feedback for network delay: shimmering markers, ghost rings, cards in their new column, a click sound. `?delay=N` shows it in single-player.
  - A replay reproduces a game exactly.
- **Simulation speed (MP3).**
  - Nest fields are shared per destination hex and extended exactly from a dug-cell log; the determinism test audits them.
  - Allocation-free heap, team-tagged hash for target scans, staggered evaporation.
  - Stress tick: 16–23 ms → **about 5 ms**; worst 130 → 21 ms.
- **Structure-of-arrays (MP4).** Used for the worker-to-main frames (`sim/columns.ts`). The AI keeps plain objects, since the tick is already 5 ms; recorded as a decision in CHANGE_PLAN.
- **Web Worker (MP5).**
  - The worker owns the World and posts per-tick frames: entity columns transferred zero-copy, colonies, grid deltas, events, overlay.
  - The main thread keeps an exact replica World (a test checks it), so renderers and UI are unchanged.
  - Auto graphics quality, the default on the start menu.
- **Lockstep (MP6).**
  - Transports: in-memory hub, BroadcastChannel tabs, network simulator, PeerJS/WebRTC.
  - `Lockstep`: per-tick packets including empty ones, adaptive delay 2–8 with no agreement needed, drop/rejoin ranges.
  - `NetGame`: host relay, pings and relay-aware delay, hashes every 100 ticks, desync stop and report, 30 s auto-drop to the AI, rejoin by token with snapshot and fast-forward, chat.
  - `tests/net.ts`: 3–4 clients stay in sync over laggy links, a forced desync is caught, drop and rejoin stay in sync, and 150 ms runs at a steady 20 ticks/s.
- **Lobby and front end (MP7).**
  - Title screen with Single-player and Multiplayer (user note); create/join menus; invite links with Copy.
  - Lobby with 4 slots (open / closed / AI / player; name, species, colour, ping, ready), host settings and chat.
  - In-match HUD: waiting overlay with Drop, desync panel with downloadable report, host left, chat with mute, results screen.
  - F3 debug overlay; area hotkeys moved to Shift+1–6 (F3 is the overlay).
- **User note:** a multiplayer match cannot be paused, and runs at 1×.
- **Browser test** `tests/browser/mp_local.py` runs three tabs over BroadcastChannel. Create, join, ready, start, matching hashes, a guest's command, chat, no pause and F3 pass.
  - Fixes it led to:
    - busy tabs are no longer timed out of the channel;
    - a player who is still loading gets 2 min before the auto-drop;
    - a client dropped while still connected reloads and rejoins.

## 2026-10-24 — Architecture upgrade finished (step 8, Step 2 checks, Step 3 docs); Phase 11 creatures
- **MP8, tools and deployment.**
  - Worker frames use SharedArrayBuffer ring buffers when the page is cross-origin isolated, and transferables otherwise; both are tested.
  - `public/_headers` for Netlify and the same headers on the dev server (COOP same-origin, COEP credentialless).
  - Replays: save from the menu, watch from the title screen; playback is checked against the recorded final hash.
  - `?stress=1` in-browser stress page, `?netsim=lat,jit,loss` network simulator.
- **Surrender** (so a match can be finished on purpose, and tested): command id 12, a two-click button in the multiplayer menu, an "out of the match" panel. The sandbox "reveal all areas" option is single-player only.
- **Step 2 verification** (CHANGE_PLAN §10.3, ticked there): headless sync/desync/drop/rejoin/150 ms/surrender tests; three-tab and two-tab browser matches; worker, replay and determinism pages; 20 min determinism with creatures on. Open for the user: invite links between two networks on the deployed site, and frame rates on real hardware (F3).
  - Browser tests found two more problems: the waiting banner changed width every second so its Drop button never held still (fixed width, tabular digits), and a stale test server could outlive a run (the server script now stops vite itself).
  - Timing checks tolerate software rendering: in the container, SwiftShader takes the CPU from the worker, so tick time there is not representative.
- **Rival AI fix.** With full stores the builder planned a storage tile every few seconds; the plans piled up unbuilt and Formica and Atta colonies never grew past their start (17 ants after 20 min). Now one plan of a kind at a time; all four species grow (test). Build id `ud-mp-2`.
- **Phase 11, creatures on screen.**
  - `render/creatures/`: instanced primitives (ellipsoid, tapered tube, cone) with a per-instance surface (roughness, gloss, pattern: rings, hair, elytra striae, speckle, wing veins, rear bands, pit funnel); a posing rig with 2-bone IK; body plans for all 14 kinds from the reference notes.
  - Each plan has its states: the pill bug rolls into a ball; the caterpillar curls; the rove beetle raises its tail; the antlion lies buried in a lit funnel pit with only its jaws showing, or dug out; spiders rear and flick; the Scolopendra coils in a true spiral; mantids sway and strike; stag beetles rear with their antlers open. Dead insects lie on their backs with legs up; carcasses shrink as they are eaten.
  - Gait phase comes from the distance walked, and slow walkers take shorter, quicker steps so planted feet keep still. Long bodies follow their own trail. Off-screen creatures are culled; far ones are drawn as blobs.
  - Drawn in the surface scene and every underground area; a carcass is not drawn twice by the food renderer.
  - Bosses: red ground circles and cones fill during a wind-up (telegraphs), slams throw dust rings, the tarantula's hairs drift as a cloud, footfalls shake the camera, a health bar shows the boss's name and phase, and phase changes are announced. Bitten creatures flash.
  - Tools: `?scene=crlab` model viewer (states, walk frames, dead/eaten), `tools/crsheet.py` model sheets, `?spawn=` creatures beside your entrance, `tools/ecology.ts` balance harness.
  - Tests: every kind poses to finite transforms in every state, alive, dead and half eaten; 100 creatures pose in about 2 ms; a caterpillar follows its path round a bend; telegraphs appear and clear.
  - Balance check: with creatures on, colonies grow the same as without (creatures take a few ants, ants take a few creatures).

## 2026-10-24 — Phase 12 part 1, UI scaling; paused here (user: session limit)
- **Phase 12, part 1 (committed):** the fire ant mound (no central entrance, surface dome, Sun-warmed Brood Mound tile), the rival AI's war brain (defend with marker II, raid with marker III after an 8-minute peace), and builder fixes so Formica, Atta and Lasius colonies no longer stall. See CHANGE_PLAN §12 and DESIGN 3.11.
- **UI scaling (user note):** the interface and menus now fit any window, from 960 × 540 to 4K.
- **Prototype build:** `npx vite build` → `dist/` (zipped as `underground-dominion-prototype.zip`). It is a static site: serve the folder (`npx vite preview` or any static host) and open it. Single-player works anywhere; multiplayer invite links need it deployed (README, "Deploying").
- **Still open, next session:**
  - Re-check the last browser test run (multiplayer tabs and UI tests on `a5d83b6`), then tick CHANGE_PLAN §10.3.
  - Mound close-up screenshot (the dome now has soil clods and smoother colour; not yet reviewed).
  - Boss fight screenshot with telegraphs.
  - Phase 12 wrap-up, then Phase 13 (single-player sandbox / skirmish / missions with boss finales).
  - Known balance item: red wood ant AIs tend to win AI-only games quickly (`tools/ecology.ts`).

## 2026-10-24 — Single-player teams and AI colonies; Phase 13 first pass (missions, skirmish, sandbox)
- **Teams and up to six AI colonies** in single-player (user note), including Gene Thief AIs with chosen or random stolen castes. The map grows with the colony count; up to eight area tabs (Shift+1–8).
- **Online prototype:** published as a link (single-player; it updates in place) and as a zip; `netlify.toml` for automatic deploys from a repository.
- **Step 2 checklist ticked** (CHANGE_PLAN §10.3). Only the deployed two-network test is left, and it needs the user.
- **Phase 13, first pass:**
  - The single-player menu has Missions / Skirmish / Sandbox tabs.
  - Two missions as deterministic simulation scripts, with narrator captions, live goals (Missions panel and a goal list under the top-left buttons), and boss finales: the stag beetle, and the wolf spider mother.
    - Played headless with the AI in control, *A Meadow Kingdom* is won at 30 min. The stag beetle is a hard fight: it wiped out a 47-ant army at 65 % health, so mission bosses come at 50 %.
  - End screens: mission complete or failed, victory or defeat, with every colony's record.
  - Sandbox panel: place any creature or boss, fill the stores, infinite food, wild creatures on or off. These go through commands (ids 13–15), refused outside sandbox games.
  - Creature hit flash is now a short pulse; it used to tint a boss under constant attack solid pink.
  - Tests: missions start, advance on their goals, bring the boss and are won or lost; a mission game is deterministic; sandbox commands are refused outside sandbox and survive the wire format.
- **Next:**
  - Playtest the missions by hand, and tune the boss damage and stage sizes.
  - A mission briefing screen and medals (Phase 14 has saving).
  - Then Phase 14: audio, settings and key bindings, save/load.

## 2026-10-24 — Phase 14: settings, saves, briefing and medals; the audio overhaul (user's brief)
- **Settings and profile** (`game/profile.ts`, localStorage, guarded):
  - quality, interface size, edge scrolling, seven volumes, key bindings;
  - an older single "effects" volume is migrated;
  - mission medals: gold under 25 min, silver under 40, bronze for any finish; the best is kept.
- **Pause menu** has Game, Graphics, Sound and Controls tabs.
  - Controls lets you rebind any action. A key already in use swaps over, and Esc keeps the old key. Shift+number works for the area tabs.
  - Game has the saves, the replay, the Credits and Quit.
- **Saves** (`game/saves.ts`):
  - the snapshot plus a header, gzipped (a 40 s mission: 492 kB → 20 kB), in IndexedDB;
  - three slots, a quick save (F7/F8) and an autosave every 5 game minutes;
  - download or open `.udsave` files; Continue and Load on the title screen;
  - loading restarts the page into the save;
  - a replay of a loaded game carries its start snapshot.
- **Mission briefing** card (the story, the stages, the species, medal times; not shown again for a loaded game). The mission end screen shows the medal.
- **Audio overhaul** (the user's brief), replacing the first synth pass:
  - The sound libraries (Freesound, Sonniss, Kenney, OpenGameArt) are blocked from the build environment. Following the brief's own rule, nothing is faked: all 100 sounds have named file slots and an organic stand-in until recordings are added. `docs/audio/sound-list.md` (generated) lists every sound with what it should be, search terms, licence rules and a foley recipe. ATTRIBUTIONS.md feeds the Credits screen.
  - The stand-ins are physical models: grains, modal chitin and wood, bubbles, stridulation, friction, air. Checked by rendering every take and reading the spectrograms. That caught bubbles that zipped instead of plinked, chitin and wood that rang like beeps, thuds with a drum-machine boom, and drags that buzzed; all were rebuilt until no narrow tone outside the naturally tonal calls lasts over 80 ms.
  - Engine: Web Audio with six buses plus master, voice budgets by loudness with overflow into granular beds, ducking that spares the featured bus, underground and night filters, room and air reverbs, and muffled off-screen events. Recorded loops and music stream.
  - Game: footsteps of the nearest ants by ground type; a swarm bed; digging, carrying, stridulation on alarm; bites by species and size (fire ant stings sharper, majors cracking seeds, leafcutters snipping); creatures by gait; bosses scaled up, never roaring; marker chirps at five pitches; earthy tool taps; natural alerts.
  - Music: an acoustic procedural score (plucked strings, kalimba, flute, frame drums, shaker), or recorded stems when added.
  - Offline renders through the real engine (`tests/browser/audio_mix.py`):
    - no clipping in any scene;
    - a 400-ant battle peaks at −2.6 dBFS with at most 26 voices, and about 2,800 requests overflow into the battle bed;
    - the queen alert rises 6.4 dB in its band above the battle, and a boss's phase change 4.6 dB.
  - Not in the game yet, but with slots and stand-ins ready: hell ants, nasute termites, Saiy-Ants, weather, mole crickets.
  - Tools: `npm run audio:process` (ffmpeg: trim, fade, normalise, Ogg plus AAC), `audio:manifest`, `audio:list`, `audio:standins`; `?scene=sounds` sound board.
- Tests: headless for saves (round trip, a game that runs on identically, the replay snapshot, a bad file), settings (reload, sanitising, migration, rebinding) and medals; `tests/browser/ui_save.py` for the briefing, audio start, menu tabs, rebinding, save and load, F7, Continue; `audio_mix.py` for the mixes.
- **Next:**
  - Gather recordings with the sound list.
  - Then Phase 15: polish, balance (the Formica AI dominates), performance, playtesting.

## 2026-10-25 — New species: Nasute Termites, hell ants, Saiy-Ants
Built from the user's three design packages (the project "Ant game": `claude/nasute-termites/`, `claude/hell-ants/`, `claude/saiy-ants/`), following their decisions and step lists. Details and the marker table: DESIGN §3.11c. Branch `feature/new-species`.

- **Nasute Termites** (`nasutitermes`; reference `docs/creatures/nasutitermes.md`, Appendix A verbatim):
  - Species, six castes (worker in two sizes, nasute, major, king, queen; larva/presoldier render only), brood costs and times from the multipliers, all values in `NASUTE` (balance.ts).
  - Wood economy: six deadwood sources, chewing 4 × 0.3 s per fragment, termites eat only wood and ants never do, termite corpses feed ants. Wood is placed only on maps with termites (and the sandbox), so other games are unchanged.
  - The ramp attack with the user's exact numbers (66 / 146 / 32 / 23 HP tests), sticky targeting, line of sight, keep-distance; the major's charge, glue hold with re-root immunity and drumming alarm; the king (leashed, invulnerable while the queen lives, dies with her); worker last-resort bites; idle grooming and feeding in the nest.
  - Markers: escort ring, majors' front line, nasutes behind the majors when a threat is known; majors hold the entrance chokes at home. AI: 80 / 15 / 5 mix, soldier-first foraging (scouts under marker IV, then the column), majors join when enemies were seen.
  - Render: the model kit integrated (`render/termite/`, all castes and states, LOD0/1/2, glue streams from the nasus tip, the kit's look for glue on termites); glue on ant targets as a second pass; larvae wriggling and growing 0.35 → 0.85, the pale presoldier in the last 25 %, SETTLE on maturing, the queen's egg-lay peristalsis; carton walls, floor and royal cell in termite nests; carried wood and eggs shown by the kit.
  - Calibration: wood income × 0.95 of Lasius food per worker-minute (median of three seeds, 8 min, `tools/termite-income.ts`; `woodPerFragment` 3 instead of the spec's starting value 1). One nasute beats one Lasius soldier only with about 3 s of uninterrupted fire before contact (`tools/nasute-duel.ts`).
- **Hell ants** (`hell`; reference `docs/creatures/hell-ant.md`): worker, soldier, queen from the ported prototype builder; Hunt → Snap → Hold in the sim (wind-up creep, two-tick snap, prey pinned at the jaw–horn socket and bled, stung, dropped dazed; soldiers impale for a burst; release rules; feeding on a kill; small creatures too); posture (loose C at rest, cocked when stalking, closed when holding), held prey lifted and flailing, food clamped at the socket; impale droplets, a camera jolt and a presentation-only hit-stop close up; Ambush ability; inspect labels.
- **Saiy-Ants** (`aurimyrmex`, display name "Saiy-Ants" from one value; reference `docs/creatures/aurimyrmex-fulgurans.md`): the six-lock hair in the head mesh (original design), smooth eyes / antennae / mesosoma; gold surge (auto on entering combat; the **Gold Surge** button on each group card sends the `surgeGroup` command, with a ready/total tooltip); +50 % speed, +60 % damage, +25 % attack rate for 4 s (5 s at level 3), 20 s recovery (14 s at level 2), queen never; Second Wind ability; gold ripple with overshoot, lock stretch, a 2 Hz springy sway when turning, flutter, exhausted droop, gold impostors far away, surge sparkles, gold bite sparks and speed lines (capped), head-pitch clamp.
- **Sounds:** the reserved stand-ins are now live: hell-ant snap / impale / struggle, Saiy-Ant surge and crackle, termite steps, the nasute glue loop (brighter as ramps climb), headbang; the glue burst uses the acid splat.
- **Tests:** `tests/species.ts` (part of `npm test`): ramp values and resets, LOS, the major, the king, wood and diet, brood costs, termite AI growth and soldier-first foraging, escort ring and majors' line, idle life, the snap flow (wind-up, socket, bleed, release, hurt-release, refusal on an Atta major, impale burst, Ambush, a spiderling), the surge (80 ticks, boosts, 400-tick recovery, level perks, the group command, Second Wind), determinism (four species for 3 min; termites vs Lasius with a command stream for 10 min). Browser: `species_renders.py` (lab sheets), `species_battle.py` (in-game), `species_fx.py` (glue, holds, gold, carton nest with brood, the surge button).
- **Cut or simplified:**
  - covered galleries (phase 9b): they need a surface-structure and targeting system the game does not have; recorded in DESIGN;
  - no push priority (the game has no body-push system);
  - one queen and one king (polygyny documented only);
  - far termites use the kit's LOD2 mesh, not its baked impostors;
  - glue on creatures is not drawn, and a held creature is pinned in place but not drawn lifted;
  - the kit's strand glue shell read as a blocky print on ant meshes, so ants get a smooth wet film in the kit's glue colour instead;
  - the carton look is done in the nest terrain shader with the kit's palette rather than `cartonPatch()` (the nest floor is one custom material).
- **Remaining differences from the references:**
  - Termite kit (from its README): head pose raised (the pinned specimen holds it down); abdomen slightly longer and less humped; colours a little lighter under bright light (in the game's light the amber reads close to the photos); no fine leg/antenna hairs; one gut patch; a smooth queen abdomen; impostors (unused) don't animate; the glue burst droplets come from the game's particles.
  - Hell ants (from the plan): the mesosoma lacks the illustration's crisp pronotum/propodeum step; mandible blades a little thick; head slightly large; the horn tip does not curl back at the apex; femora thinner than drawn. LOD0 is ~8.2k triangles (other species 9–10k), so the fringe hairs were kept.
  - Saiy-Ants: the reference sheet draws the locks longer than the placement table; the table was kept. The gold was deepened a little after checking it in the game's sunlight (it read as cream).
- **Performance:** the stress scene (4 × 400 ants, 100 creatures; `tools/stress.ts … nasutitermes,hell,aurimyrmex,lasius`) ticks in 7.3 ms on average against 7.0 ms for the default four species (p95 11.6 vs 13.1 ms). Triangles per ant, LOD0 / LOD1: termites 4.1–4.7k / 0.9–1.1k, hell ants 7.8–8.2k / 2.3–2.4k, Saiy-Ants 13–15.5k / 3.9–4.0k (the brief's LOD rule keeps three strands per lock at LOD1), against 8.9–9.2k / 2.2–2.5k for the other ants. SwiftShader cannot render the 1,600-ant stress page fast enough here to compare frame times; check on a GPU.
- **Next:** Phase 15 — tournament balance (Atta dominates the AI tournament), performance pass, the DoD check.

## 2026-10-25 — Melee attack animations; Saiy-Ants without acid (user's notes)
- **Saiy-Ants fight with bites only** (pure physical damage): the formic-acid opener is gone from the worker, soldier and nanitic; trait text, DESIGN and the reference doc's game note updated.
- **Three melee attacks** for every biting ant and termite (`render/ants/attackPoses.ts`), after looking at how *Empires of the Undergrowth* handles attacks (one animation per attack at the unit's attack speed; special attacks reuse it, so hits land on the beat — its wiki's stat and termite pages; the studio's newsletters say little about animation): a lunge bite, a rear-up chomp and a side clamp with a tug back. All three last exactly one attack interval and close the jaws at the same moment, which is the tick the damage lands (read from the bite cooldown, so jitter, frenzy and the gold surge keep it on the beat). Units cycle through them, never repeating one twice running. Termite workers, majors and the king do the same body motions around the model kit's BITE / RAM, phased onto the contact. Render only: no sim state, hashes unchanged.
- Tests: the poses are neutral at both ends of the cycle and shut the jaws at contact; in a fight 12 of 12 bites land on the contact; the attacks cycle with no repeats; Saiy-Ants have no acid. Sheets: `docs/creatures/attack-renders/` (Lasius worker, Saiy-Ant soldier, hell ant, termite worker and major: rest, wind-up and contact of each attack).
- Also: the leafcutter fungus numbers moved into `BALANCE.atta` (same values) and `tools/tournament.ts` takes `TUNE=…` overrides, for the Phase 15 balance pass (Atta still wins 94–100 % of AI games; its economy, not its majors, is the cause: weaker majors and soldiers barely change the results).

## 2026-10-25 — Bug-fix release, part 1: ants spinning in combat (diagnosis and fix)
Plan: CHANGE_PLAN §15. Measured with `tools/spin-check.ts` (a spin = a full turn the same way round within 3 s).

**Diagnosis.** Five causes, the first two the main ones:
1. **Grapple slots were angles relative to the victim's heading.** Whenever the victim turned, every ant holding it was carried round it, and turned to keep facing it. Two ants biting each other made a feedback loop: each one turning moved the other's slot, so the pair orbited each other indefinitely. Stinging ants also deliberately pivoted round their bite (fire ants 0.9 rad/s).
2. **Creatures chased their own tails.** A creature turned toward its target ant, but an ant clinging to its body turns with it, so the target never came round to the front: the ground beetle spun at about 490°/s with 15 ants on it, carrying all of them.
3. **Headings were snapped every tick**: set straight to the target plus a sine wobble (±7–9°) with no dead zone, and the turn rate elsewhere was 10 rad/s (573°/s).
4. **No slots for attackers**: everyone steered to the target's centre and latched wherever it arrived. No waiting ring, so late arrivals pushed into the crowd.
5. **No separation at all**, so ants stacked on each other and on creatures.

**Fix** (CHANGE_PLAN §15.1): world-angle limb slots on ants, outline slots on creatures that cling with the body, an outer waiting ring with a retarget after 2 s, mutual grapples locked facing each other, `faceToward` everywhere (360°/s, 5° dead zone, heading kept at near-zero distance), no wobble or pivot, creatures never turning toward ants on their body (and rate-limited), soft separation after the creatures, targets roughly ahead preferred, and the next target taken at once when one dies.

| | before | after |
|---|---|---|
| 50 v 50 (seed 7): ants that spun | 71 of 91 | 1 of 90 |
| mean turn rate while fighting | 953°/s | 34°/s |
| overlapping pairs per sample | 17.2 | 8.0 |
| 30 ants on a beetle: spun / stacked pairs | 23 / 26 | 0 / 0 (12 latched in a ring, the rest wait outside) |
| 60 workers out of a crowded nest | — | all out, mean 6.2 s (6.0 s with separation off) |

Seeds 3, 11 and 19: 0–2 spinners of 90, no beetle spinners. Stress scene (4 × 400 ants, 100 creatures): the per-tick slot scans round big creatures were the largest new cost, so the slots held on each creature are now found once a tick and kept as a bitmask; separation runs every other tick with one shared callback and one terrain test per ant moved. Average tick 9–11 ms against 8.8 ms before (target < 15 ms); separation is about 1.5 ms of it.

## 2026-10-25 — Bug-fix release, part 2: climbing, collision, corpses, harvest, royals, eggs, AI nests (CHANGE_PLAN §15)
- **Climbing large creatures and titans** (`sim/climbing.ts`, `sim/creatures/climb.ts`, data from `tools/climb-data.ts`):
  - rails up every climbable leg (foot → ankle → knee → over the body's edge) and riding slots on the back, authored from the creature models themselves (each builder run once in its rest pose with a recording rig); centipedes and the cutworm have rails on every other segment's legs;
  - Attack or Grapple → Climb: to the nearest point of the nearest leg, up (1.5 s from the foot), ride 8 s attacking point-blank (bites, stings, acid, nasute glue, major glue bursts), down 1.5 s, then 6 s on the ground; lowest free slot, ants in id order;
  - untouchable from the first step up to the step off (no damage, flings, venom or targeting from anyone); riders drop off unhurt beside a creature that dies;
  - **room by size** (user notes during the work: "scale it to creature size and not difficulty"; "give ants size classes for climbing"): a creature's back holds its area ÷ 20 mm² units, and riders take room by size class (≤ 5 mm: 1, ≤ 7.5 mm: 2, ≤ 10 mm: 3, larger: 4), at most 32 ants at once. Ground beetle 3 (three Lasius workers, or one Formica soldier, no Atta major), mantis 13, titans 60–134;
  - render: builders record animated leg joints and body frames (`Rig.recLeg` / `recFrame`), climbers ride the animated legs and backs (ants and termites), F3 or `?climbdebug=1` draws rails and slots, small creature health bars and the boss bar show room taken / room, scrabbling claws while climbing, harder bites while riding, a thud when dropping off;
  - pursuit is measured from a creature's edge, so ants stepping off a titan's long legs don't give up the fight.
- **Corpses** (both timed food): a dead ant falls over (0.5 s) and is food for enemies only for 2 s; a dead termite is food for any ant for 7 s; then the body sinks into the ground (drawn) and is deleted. No more necrophoresis.
- **Harvest** instead of co-op hauling: each ant takes its caste's carry × level (×1 / ×1.25 / ×1.5); small items go whole.
- **Queens and the termite king:** every queen of every species stays exactly where she is and never fights back. The termite king stands beside the queen's abdomen (two separate bodies), still guards the royal chamber, and is never targeted: ants and creatures go for the queen, and nobody "fights back" at him.
- **Eggs EotU-style:** no pile; the queen holds eggs inside at the same rate, and a worker walks to the tip of her abdomen and pulls one out (0.6 s).
- **AI colonies:** the queen's group and about a third of the workers always stay home on nest jobs; the builder digs 7-hex chambers in solid soil, walled off and joined by 1–4 hex tunnels kept clear of tiles, for brood and (when stores lag) food. Growth: Lasius 23.7 ants at 10 min over seeds 7–9 (22.3 before); in the 4-colony game every species still grows (Lasius 41, Formica 34, fire ants 26, Atta 22 at 6 min).
- **Army ants** nest like the other colonies: the bivouac code is gone (their new models and animations are another agent's job).
- **Tests:** `tests/combat.ts` (added to `npm test`): spinning, slots, separation, tunnels, the climb cycle and its timings, caps and size classes, untouchability, dropping off, determinism, corpses, harvest, queens, the king, eggs, home workers. Browser: `climb_renders.py`, `royals_renders.py`. Renders in `docs/creatures/climb-renders/` and `docs/creatures/royals-renders/`.
- **Fixed on the way:** a mid-fight `waitT = undefined` changed the order of an ant's keys after a save, so a rejoining multiplayer client hashed differently (now `0`); the per-tick slot caches live on the World, so two worlds in one process never share them.
- **Measured** (quiet CPU, after the last change): stress scene (`tools/stress.ts -- 400 30 100`, 1,689 ants, 85 creatures, 6 underground areas) tick avg 8.4 ms, p95 14.7 ms, no tick over 50 ms; separation 4.6 ms per call, every other tick. Climb stress (`tools/climb-stress.ts -- 40`, 1,000 ants on four titans, up to 32 riders each) 3.4 ms a tick against 2.5 ms with climbing off. Browser checks all pass (`climb_renders`, `royals_renders`, `species_fx`, `attack_renders`, `ui_test`, `ui_test2`, `ui_dig`, `species_battle`); two of them only timed out while the CPU was shared and passed when run alone.

## 2026-10-25 — Termite royals rebuilt (model kit v2.1)
- Queens (Nasute + Sickle-Jaw): one continuous pleated physogastric abdomen (10 soft rolls with folded rear lips,
  deep side / shallow top creases, front dome swelling over the thorax, flattened belly, rounded slightly pointed
  tip), glossy wet translucent membrane coloured by age (ivory #F3EBDD -> amber #E6B85A -> honey #C98F3E), small
  dorsal plates #6A4A2A, sternites #B89060, spiracles, fine hairs. Peristaltic wave + breathing in the vertex
  shader, occasional leg twitches, egg-laying. LOD0 11.6k tris; LOD2 creases drawn by a shader bump.
- Kings: 1.45x worker, triangular wing-scale stubs on the meso/metathorax, smoothly bulging faceted eyes + 2 ocelli,
  slender legs with claws, modest abdomen (dark plates, pale membrane). New ATTEND state (antennae on the queen,
  occasional grooming).
- Colours: Nasute royals dark brown-black (UF/IFAS: alates dark brown with dark wings). Sickle-Jaw royals
  reddish-brown: a reconstruction from related Syntermitinae (imago colours unpublished).
- One queen per colony (the user's call, 2026-10-25: no several-queens setting); she keeps the kit's default
  age 0.5 (yellow-amber). The kit's `setFx({ age })` stays available.
- Checked in 4 render rounds against the user's two physogastric-queen photos; renders in
  docs/creatures/termite-royals-renders/. Non-royal castes pixel-identical to kit v2.
- Remaining differences: the queen follows the spec's proportions (6x head+thorax, 3.5x head width), so she is a
  little slimmer than the very mature queen in the side photo; the rolls are more regular than real folds; wrinkles
  and hairs only show close up; the colour is slightly more saturated orange than the photo under game lighting.
- **In the game** (`src/render/termite/` = kit v2.1, all 12 files):
  - sizes from the models: the sim's queen is 25.4 mm and the king 8.4 mm, and the egg-lay point is the kit's
    `Bone.EGG_LAY` pivot, through a generated `sim/termiteRoyalData.ts` (`tools/termite-royal-data.ts`;
    `tests/royals.ts` fails when it is stale);
  - the queen lies along the royal chamber's long axis with her whole body inside it; her abdomen is a solid body
    (separation pushes everyone out of it, nest paths go round it), so attendants groom her at her side, feed her
    at her head and pull eggs on an arc around her tip; the egg slides out of her tip as a worker pulls it;
  - the king stands beside the front third of her abdomen, parallel to her and just clear of her, holds his place
    while standing, plays ATTEND with his head turned to her and walks slowly (half speed) when he repositions;
    casual trophallaxis encounters leave him alone;
  - tests: `tests/royals.ts` (in `npm test`): data current, sizes, egg point, the chamber fits her, nobody walks
    through her, the king's place and ATTEND, eggs pulled at her tip, determinism. Browser:
    `tests/browser/termite_royals_v21.py` (renders `game-*.png` beside the kit's renders).

## 2026-10-25 — Sickle-Jaw Termites (*Rhynchotermes perarmatus*)
Built from the user's package `claude/sickle-jaw-termites/` with the model kit v2.1 used as built. Reference: `docs/creatures/rhynchotermes-perarmatus.md` (Appendix A verbatim). Design: DESIGN §3.11c "Sickle-Jaw Termites".
- **Shipped:**
  - species `rhynchotermes` ("Sickle-Jaw Termites") on the title screen, lobby and sandbox lists: worker 5.8 mm (larger than the soldier), sickle-jaw soldier 4.5 mm, king 8.5 mm and the physogastric queen from the kit; brood paid in plant matter (soldiers × 2 cost, × 1.4 time), presoldier for the last 25 %; one queen; the king guards her as for the Nasute Termites;
  - **grab-and-squirt** (`sim/sickleJaws.ts`): a 6-tick lunge, a 3-damage bite on the snap, the victim hooked in the crossed mandibles and pinned there, unable to move or fight, while the acid ramps 2 → 18 HP/s over 6 s (pure damage, exact to 1/1024 HP); the hold ends only when the victim or the soldier dies; one soldier per victim (lowest id wins); victims up to 2 × the soldier's length; anything bigger (and bosses) is bitten once a second and squirted while it stays in range, the ramp resetting whenever it leaves; a missed lunge costs 1 s;
  - the alarm (12 body lengths, 8 s, cooldown 3 s; soldiers rush with the mandibles open, the alarming termite drums); Eisner's defensive row at a marker with no food (both sides of the column, 3 soldier lengths apart, facing out); AI colonies keep two soldiers free and commit at most 60 % of the nearby soldiers to holds;
  - **leaf litter**: a new plant-matter source (25 units a patch) on maps with Sickle-Jaw colonies, two near each of their nests, falling again while they live; chewed 3 bites × 0.3 s per 1-unit scrap and carried home as a leaf scrap; they also eat deadwood; Nasute Termites stay on wood, ants never eat plant matter, ants eat Sickle-Jaw corpses;
  - **termites fight and gather like ants** (the user's notes): workers of both termite species attack like ant workers and no longer retreat on the alarm; nasute, major and sickle-jaw soldiers forage at a marker on food (escort duty only where there is nothing to gather);
  - render: the kit's castes through `TermiteInstances` (LUNGE on the renderer's own clock, HOLD aimed at the victim with `solveHoldOnVictim` / `holdAimAt`, free targets with `solveFreeSquirt`, THREAT, RUSH, ALARM, STRUGGLE for held termites), the acid jet (`GlueStreams` + `ACID_STREAM`) from the nasus tip and `AcidFizz` on the victim, held ants flailing with acid on the ant shell pass, leaf-litter patches and carried scraps from the kit's leaf-litter geometry, dark damp-soil nests; sounds: the jaw snap and struggle on a grab, a click on a miss, the kit's `SickleJawAudio` acid stream / fizz / struggle voices for the nearest three holds.
- **Tests:** `tests/sickle.ts` (in `npm test`): ramp values (18 / 60 / 132 HP; 90 HP dies on squirt tick 150; sums exact), the 6-tick lunge, the hold (victim pinned, cannot move or attack, ends only with a death; killing the soldier frees it next tick; no release when the soldier is hurt), one soldier per victim, the size limit and free attack (ramp reset out of range, the target fights back), a missed lunge, the alarm (same colony only, player markers kept), the king, AI defence (≤ 3 of 5 holding), workers attack, soldiers gather litter, 10-minute determinism with holds. Browser: `tests/browser/sickle_renders.py` → `docs/creatures/rhynchotermes-renders/` (the castes in four views, THREAT and LUNGE, a hold close up and from above, a battle, a free squirt on an Atta major, the nest with queen and king, leaf-litter foraging).
- **Calibration** (`tools/sickle-calibrate.ts`, `tools/termite-income.ts`): the user's ramp kills this game's 16 HP Lasius worker in 2.8 s from the lunge (the spec's 6–8 s assumed a 90 HP worker; 90 HP still dies on tick 150), a Lasius soldier in 5.3 s, a Formica soldier in 9.6 s. Two Lasius workers beside a holding soldier free their friend 10 / 10 times; starting 3 body lengths away, 1 / 10; three from 3 body lengths, 9 / 10. Plant income: median 1.52 per forager-minute against Lasius' 1.58 (× 0.96).
- **Performance:** stress scene (4 × 400 ants, 100 creatures, 60 s): average tick 8.2 ms against 8.6 ms before (p95 13.7 / 15.5 ms): no change.
- **Cut / simplified:** covered foraging trails; the spec's worker retreat on the alarm and last-resort-only worker bites (replaced by the user's note); baked impostors (far termites use the LOD2 mesh); acid drawn on held creatures (only the jet and fizz); held creatures are pinned but not lifted.
- **Remaining visual differences** (kit README, unchanged in the game): the nasus points forward and slightly up at rest (slightly down in the side photo); legs a little straighter, paler and more angular at the knees, and slightly shortened; the head reads as glossy red resin, without the photos' deep internal shading; the gape spans slightly less than in the front photo and fine hairs are sparse (LOD0 only); antennae straighter than live ones; the jet is short because delivery is point-blank, so the droplets and fizz carry the effect at game zoom; victims are held facing the soldier, hooked by the front; the queen is slimmer than the very mature photographed queen, her rolls more regular, and her colour slightly more saturated; the royal colours are a reconstruction. New in the game: the generic bite particles look large at the closest zoom; a victim with a big head (a Lasius soldier) is hooked by its front under the soldier's raised head, so from above or low at the side its head hides the soldier's head and nasus (the kit's own victims are smaller).

## 2026-10-25 — Fixes from the user's notes: planted fighting, centipede necks, hitboxes, stone, termite workers, the guard line, food view
- **Ants fighting creatures stand their ground** ("ants spin around with the creature they are fighting … they should be planted to their ground"). A latched ant no longer clings to a place on the creature's outline and swings round with it: it stands still beside the body, faces the nearest point and bites while it is in reach, steps after the body when it has moved a little (keeping its slot), lets go and closes in on a free slot when it is gone, and is shoved back out if the body turns into it; planted ants are eased apart so they never stack. Creatures pick targets with a bias to the front so a ring of ants doesn't swing them from side to side. `tools/spin-check.ts` (24 Formica workers on each creature, 20 s): latched ants used to slide 48–68 mm/s over the ground and swing 60–80°/s round a stag beetle or tarantula; now 7–15 mm/s (shoved by the body) and under 15°/s, under 3 mm/s on the smaller creatures; no spinners, no stacking.
- **The "dislocated neck"** was the chain creatures (Lithobius, Scolopendra, the cutworm). Their bodies followed a trail of past head positions, with each segment's heading taken from the two nearest points, so turning on the spot, being shoved or reversing pointed the head sideways or straight back and could fold the body. Now a follow-the-leader chain (`render/creatures/chainTrail.ts`): each joint is held one step behind the last, bends at most 0.3 rad, starts straight behind the head and relaxes back toward straight; long bodies also turn at most 1.2–2.5 rad/s in the sim (`maxTurn`). `tools/chain-check.ts` in real fights: worst neck 133–178° and 180° folds before, 34° and none after; the drawn body's middle sits 0–5 % of its length from its hitbox centre (31–45 % before).
- **Hitboxes** are all maths, never meshes: ants are circles, creatures capsules, a termite queen's abdomen a capsule. F3 (or `?hitboxes=1`) now draws them on the ground.
- **Undiggable stone** is pale, cool-grey cracked rock with a light rim and a dark seam, colour-balanced against the warm nest light, and stays visible in the dark undug soil (it was nearly black there).
- **Termite workers** (model kit v2.2, made by the kit's own update): the Nasute worker is small (4.2 mm, drawn 3.9 / 4.5) and round with a high pale-straw domed head and faint sutures; the Sickle-Jaw worker is lanky with a broad flat chestnut-orange head, a whitish fontanelle and a long glassy abdomen. The sim's Nasute worker is now 4.2 mm to match (its hitbox follows the model); the Nasute larva grows 0.27 → 0.66 of its mesh. Reference docs updated (one queen kept).
- **The Sickle-Jaw guard line** (user notes: too thin, workers walking outside it, spare soldiers should go where the workers are, too long-ranged): the guards now stand along the route the workers really walk (the home flow field traced from the marker to the nest), 16 mm out on each side, spread evenly over the whole route (further rows when they don't fit), walking to far posts along the route; posts on rock move in toward the route. With food at the marker half of the sickle-jaws guard and half gather (all guard without food); roles are stable while gatherers carry food home. Guards engage only enemies within 3 body lengths; every sickle-jaw now lunges from 0.6 body lengths (was 1) and squirts big targets at contact range (0.45, was 1), the jet drawn to the near side of the body. `tools/sickle-guard.ts` / `tests/sickle.ts`: 15 guards spread over 20–124 mm of a 150 mm bent route, none at the entrance, 95 % of the workers' walking inside the line.
- **Food view** rings only the food your colony can gather; on the minimaps the rest is a dim grey dot.
- **Fixed on the way:** a termite hatching from brood under the queen (the first workers grow on her tile) appeared inside her abdomen for a tick; it now steps out beside her, and separation puts anyone still inside her back on her surface after the crowd pushes.
- Renders: `docs/creatures/fixes-renders/` (`tests/browser/fixes_renders.py`).

## 2026-10-25 — Army ants upgraded (*Eciton burchellii*; package `claude/army-ants/`)
Built from the user's package (start-here, brief, fact-checked reference, plan, prototype code); user decisions kept: no bivouac (they nest like everyone else), no nomadic/statary phases (queen fixed at swell 0.5), no queen attendants, the major is the in-game Soldier, the submajor the Porter. Branch `feature/army-ants`.
- **Reference** `docs/creatures/eciton-burchellii.md` replaced with the package's fact-checked doc (lane correction: laden ants in the middle, outbound at the edges; porters are ~3 % of workers and carry under the body).
- **Models:** five on the shared builder, ported from the prototype (`eciton_minor`, `eciton_submajor`, `eciton_media`, `eciton_major`, `eciton_queen`; LOD0 triangles 9 150 / 9 446 / 9 446 / 9 624 / 10 395, the same as the prototype). New builder options: fishhook and barbed falcate mandibles, front-of-head gradient (`frontMix`), dark antennal sockets, broad petiole, segment bands and the plated physogastric gaster (`uPhyso`), high-stepping gait, the porter's carry-under point. Four poses: porter, Soldier on guard, bridge link, pothole plug (ids 10–13; 8 and 9 were taken by the sim's ALARM and CARRY). The 24 other morphs hash the same as before the patch (LOD0 and LOD1); the barb points inward along the hook (the prototype's sign pointed it out of the curve).
- **Castes and data:** Worker 4 mm, Porter 6.5, Media 8, Soldier 11, Queen 22 (`ECITON` block in balance.ts with every number); old `eciton_soldier` kept as an alias (caste lookups, `?battle=`, saved games, model ids). Diet: insects, corpses and crumbs of them only.
- **Behaviour** (`sim/eciton.ts`): swarm raid with a roaming front and pulsing raiders, three lanes, prey flushing, Soldier posts along the whole trail (only with 3+ Soldiers), porter carry-under and team carries, media escorts, living bridges and pothole plugs, the Soldier's hook, group pinning of ants and creatures. Shared marker trail extracted to `sim/route.ts` (the Sickle-Jaw guard row uses it too; its tests unchanged).
- **Bug fixed (all species):** the surface flow field's Dijkstra treated live heap entries as stale when their Float32 distance rounded below the Float64 priority, leaving invisible walls that sent routes on long detours round nothing. Found while testing the army ants' trail round a puddle.
- **AI:** brood mix with Soldiers early; Media and Soldiers go out with the raid once there are 3+ Soldiers; the raid moves on when the prey round the marker runs low. **Sound:** lighter, quicker footsteps; a clack when a Soldier's hook goes in; a struggle when a crowd spread-eagles a victim; a rustle as a bridge link joins. **UI:** species blurb and traits rewritten (no bivouac claim), caste names Worker / Porter / Media / Soldier / Queen; the food view lights up only insects and corpses for them.
- **Performance:** a flow field per raider's own slot was rebuilt on every call (119 ms a tick with 600 raiders); now one field per raid: 8.2 ms a tick for 600 raiding army ants against 4.4 ms for 600 foraging black garden ants (`tools/eciton-stress.ts`).
- **Pale heads:** the media and Soldier heads read as white under the game's sun; both are a little darker than the package's values (#9E8854, #AA9868), as its notes said to re-tune.
- **Verification:** `tests/eciton.ts` (in `npm test`, all pass: data and old ids, diet, other species' models byte-identical, front, pulses, lanes 1.44 L vs 0.49 L, porters 100 % under the body, posts along the whole trail densest at both ends and facing out, none with 2 Soldiers, team carries, bridge forms and is crossed and lets go, plugs, hook, pinning, determinism and a mid-raid restore); `tools/eciton-raid.ts`; renders in `docs/creatures/eciton-renders/` (five models side/top/front/¾ and LOD1, close-ups, queen swell 0/0.5/1, the four poses, a raid at the front, along the trail and far out, two Soldiers only, a bridge, a plug).
- **Not done:** the plan's two-client 10-minute sync run was covered by the determinism tests (same-seed runs and a restore mid-raid hash the same) and the existing `tests/net.ts` lockstep suite, not by a separate army-ant match; climbing large prey uses the game's existing climbing system unchanged.

## 2026-10-25 — Termants (*Chimaeromyrmex termitoides*; package `claude/termyrms/`)
A fictional ant–termite hybrid that raises the castes of the species it eats. Built from the user's package (start-here, brief, reference, plan, prototype code); the user's notes kept (one queen; soldiers gather and workers fight, as ants do). Names, text and numbers are original — nothing taken from Empires of the Undergrowth. Branch `feature/termants`.
- **Reference** `docs/creatures/chimaeromyrmex-termitoides.md` (the package's doc, with an as-implemented section).
- **Models:** four on the shared builder, ported from the prototype (`termant_worker`, `termant_soldier`, `termant_queen`, `termant_king`; LOD0 triangles 8 937 / 8 273 / 9 257 / 9 257). New opt-in builder options: frontal gland pore, no eyes, bead antennae, a soft striped gaster with a gut patch, a smooth mesosoma; the soft abdomen jiggles (`uSoft`) and deflates on death. The 30 existing models (army ants included) are byte-identical.
- **Data:** worker 5 mm (formic-acid opener, eats wood), soldier 7 mm (glue burst), king 7.5 mm, queen 12 mm; `TERMANT` block in balance.ts with every number; display name from one config value.
- **Behaviour** (`sim/termants.ts`): gene samples from enemy corpses carried into the store (own and allied dead give none; corpses linger 25 s in Termant games); stolen castes at 12 / 18 samples, max 3, a fourth waits; **forget** command refunds the caste's tiles (living ants stay); stolen tiles ×1.5; creature genes give one small bonus; soldier glue burst (slow ×0.4, formic acid ×2 on the glued); wood store digesting into food; carton walls (block enemies, chewed down, break; own ants pass; paid in wood); the king; a neotenic replacement queen once, while the king lives. Commands `forgetCaste` and `corpsePriority` go through the command queue (multiplayer-safe).
- **Render:** stolen-caste ants tinted faintly amber, the replacement queen smaller and paler (impostors too); glued ants coated. **UI:** a Genome tab in the build panel, wood in the top bar, stolen names on brood tiles, caste cards and the info card; Termants on the title screen and in the lobby. **Ability:** Alarm Drumming. **AI:** the brood mix follows the stolen castes, forgets the least-used caste, walls the entrances with carton when invaded, raids sooner a rival whose genes it nearly has. **Sound:** a soft gulp when genes are absorbed, a chord when a caste is stolen, a papery shuffle under the footsteps.
- **Verification:** `tests/termants.ts` (in `npm test`, all pass: data and king, other models unchanged, genes from enemy corpses only, unlock after 27 s of foraging, ×1.5 cost, the 3-caste limit and forget with refunds, glue slow and double acid, wood store and digestion, carton wall blocks / is chewed / breaks / own ants pass, replacement queen works once and fails when the king or she dies, the AI's forget / wall / raid rules, a stolen Acid Lancer spraying for the Termants, determinism over 4 AI minutes and a snapshot restore with two castes stolen). AI games: 20 min against Red Wood Ants (45 v 38 ants, no war yet); 45 min against black garden ants (the Garden Bruiser stolen at ~22 min and raised; the Termants were overrun at ~33 min — on that map the Lasius AI also overruns hell ants and Saiy-Ants, so it is not a Termant problem). Renders in `docs/creatures/termant-renders/`.
- **Not done:** the optional first-hatch glow of a new stolen caste; carton-coloured chamber floors (the game has no per-species nest floor; carton walls have their own look); a tense ambience while the replacement queen is raised; stolen termite castes (Glue Gunner, Sickle Grappler) are not tinted (they render through the termite kit); `settings.carryGenome` (nothing carries between missions yet).

## 2026-10-25 — Battle arena (2–4 teams; user request "like the EotU battle arena", also for testing climbing)
Researched Empires of the Undergrowth's arcade Battle Arena first (click icons to drop up to 50 units on one of two sides, levels, units attack on their own or on command, only mobile aggressive creatures); nothing copied. Ours: up to four teams, ants and creatures together, creatures fighting creatures, and tools for watching climbs. Branch `feature/arena`; DESIGN 3.13.
- **Sim** (`sim/arena.ts`, `sim/arenaState.ts`): one colony per team (nests at the edge, never used), no economy (no eggs, nanitics, jobs, food, colony loss or lost-route deaths), spawning in a spiral round each team's corner or where clicked (1–50, level I–III, at most 700 units), stances Charge / Hold / Passive, the round's winner, clearing. Commands `arenaSpawn`, `arenaStance`, `arenaClear` with a wire format, so replays and snapshots carry the arena.
- **Creatures fight creatures** of other teams (walk up, face, bite on their own interval, venom, level) and never flee in the arena; creature programs skip their own team's ants and ants skip their own team's creatures (targeting, nasute glue, acid splash). Arena ants only fight; a passive team stands still and never bites.
- **UI:** Battle Arena tab on the single-player menu (2/3/4 teams, floor) and `?mode=arena&teams=N`; the arena panel (teams with live counts, stance, roster by species or creatures, count, level, Place tool with a cursor tip, Clear team / Clear all, pause and ¼×–4×, climb rails and hitboxes); a scoreboard (units, health, losses, time, winner); the team on the info card; coloured rings under every unit. Colony panels, markers, minimaps and stores are hidden.
- **Verification:** `tests/arena.ts` (in `npm test`, all pass: 2/3/4-team layouts, no economy for a minute, spawning, levels, place tool, refusals, the 700 cap, ants v ants to a winner in 20 s, beetles v spiders v rove beetles with 6 deaths, a team sparing its own ants, spider and mantis, hold, passive, 32 ants riding a passive stag beetle, clearing, a minute of four-team battle replayed exactly from its command log, a restore mid-battle staying in step, 600 fighting units at 7.6 ms a tick). Browser: the menu → arena → roster → Place → Clear flow through the Web Worker with no page errors; renders in `docs/arena-renders/` (`tests/browser/arena_renders.py`).
- **Not done:** the arena is single-player (the multiplayer lobby does not offer it); "uber" creatures and EotU's star levels are left out (levels I–III only); bosses fight other creatures with plain bites (their special attacks are aimed at ants).

## 2026-10-25 — Phase 15, part 1: the user's notes (kings, fights, marker orders, eggs, phones and tablets) and AI fixes
Branch `feature/phase15`.
- **One queen, no replacement (Termants).** The neotenic replacement queen is gone: when the queen dies the colony is lost, as for every species.
- **Kings** (termites and Termants): never targeted by ants or creatures, take no damage, bite weakly (termite kings × 0.5 of the baseline bite, the Termant king 1 per 1.2 s) and die the moment the queen does (`antAI.killAnt`; `species.isKing`).
- **Fights less compact** ("like a guard line like EotU"): a **guard line** at surface markers (`sim/guardLine.ts`: rows across the marker a body's room apart, facing the nearest enemy, kept after the fight; every unit in the arena, elsewhere the castes that do not gather there); **room in a fight** (fighters keep 1.9 × the separation radius from each other unless one holds the other; holders are eased apart); foes **shared out** (each nestmate already on a foe makes it look farther); 3 holds on an ant (4 on a big one), the waiting ring 1.3 body lengths out, a new foe looked for every second; **creatures keep apart** (radii; teammates 1.3 ×). Measured in the arena (`tools/fightspread.ts`): fighters within half a body of a teammate 88 → 40 %, 82 → 42 %, 66 → 43 %; distinct foes per 100 attackers 27 → 39, 17 → 41, 24 → 48.
- **Glitchy movement after a fight** fixed: an ant in lingering alarm scent with no foe in sight took a four-tick step up the scent gradient on top of its own walk every fourth tick, so winners lurched and zigzagged (≈ 1.6 heading reversals a second per ant, `tools/postfight.ts`). The rush now walks a tick at a time as the only movement, and ants under a marker hold the marker instead (0.04 reversals a second, no jumps).
- **Marker orders** (EotU-style): no attacking, no gathering, no climbing — toggles under each marker and under the Home column (nest jobs) in the marker panel, command `markerOrder` (wire format, replays, saves).
- **Eggs:** the queen always has an egg ready, and every empty brood tile gets a free worker at once (it was one egg every few seconds and the spawn jobs capped at eggs on hand + 2, so only a couple of workers fetched eggs). Five places round her tip.
- **Phones and tablets** (`core/device.ts`): touch gestures (one finger pans or paints, tap = click, long press = right-click and tooltips, pinch, twist, three-finger tilt), a compact layout on phones in landscape and tablets in portrait (maps and build panel behind buttons, bigger buttons, folded marker panel), a cancel button for tools, a "turn your phone sideways" screen in portrait, safe areas, no page zoom or bounce, sound unlocked by a tap, Auto quality starting at Medium.
- **AI:** aphid tenders keep one group on the nearest aphid colony under marker IV (aphid value capped for the main forage marker: fire ants no longer live on one aphid colony's trickle); termite soldier scouts give up waiting after 40 s; insect food tops up when an army-ant or other insect eater runs short; rivals in the story missions raid only from the war stages on (the forest rival raided at ~23 min before).
- **Tests:** `tests/fights.ts` (new, in `npm test`): calm after a fight for three species, the guard line (rows, facing, spacing, wheeling), melee spacing and foes shared out, creatures apart, no attacking (and biting back), no climbing, no gathering, the order command and wire format, eggs to every empty tile at once, Home orders; `tests/termants.ts` (the king); `tests/run-all.ts` (missions: no early rival raids); `tests/browser/mobile.py` (iPhone and iPad emulation).

## 2026-10-26 — Phase 15, part 1 finished for publishing: finger-sized controls on the iPhone SE
New conversation; source restored from the project snapshot (`feature/phase15` @849ea58, sha256 checked).
- On the smallest compact screen (iPhone SE in landscape, `--ui` 0.629) the top toggles, area tabs, map and menu buttons measured 23–24 px and, with the marker panel unfolded, the marker-order switches 15 × 19 px. Finger controls in the compact layout are now 40 units (25 px there; the menu button had no compact size at all). A marker column there is 50 px wide, too narrow for three 24 px switches, so each column shows one **Orders** button with its three orders as small icons (struck in red when on); it opens the switches at 42 units (26 px) over the cards, and a press anywhere else closes them. Desktop and the iPad's full layout are unchanged.
- `tests/browser/mobile.py` now also unfolds the marker panel and checks its controls, opens a column's switches (sizes, on screen), sets and clears an order by tapping, and closes them with a tap elsewhere.

## 2026-10-26 — Touch fixes after v12: drag panning on every screen size, iPad controls
- **Panning** moved the camera a fixed 1.25 × distance / 700 mm per pixel, which matched only a screen about 390 px tall: on an iPad the ground ran three times faster than the finger, on a 900 px desktop window 2.3 ×. The step per pixel now comes from the camera distance, field of view and window height (and the view's pitch for vertical drags), so the point under the finger or cursor stays under it: measured 0.9–8.6 mm off after a 160 px drag on the iPhone SE, iPhone 15, iPad portrait and a 1440 × 900 desktop (`tests/browser/mobile.py` and a pan probe). Desktop drag-panning is slower than before on large windows; keyboard and edge scrolling are unchanged.
- **iPad in landscape** (full layout, scale 0.74): the top toggles (19 px), area tabs (22 px) and the marker panel's square buttons (24 px) were under finger size; on touch they are now 35 units (26 px). The marker columns' **Orders** button (three orders in a pop-up) is used on every touch layout, not only the compact one: the iPad's order switches were 18 px.
- `tests/browser/mobile.py`: the dig-drag check looks for a start and direction with fresh soil under it and checks the camera did not move; soil searches scale with the screen size.

## 2026-10-26 — LAN multiplayer with connection codes (no servers)
User request (`claude/multiplayer/01-spec-lan-manual-codes.md`), done before the remaining map work. Survey notes and the design are in DESIGN.md ("LAN play with connection codes") and docs/multiplayer.md §6.1.
- **`ManualRtcTransport`** (`net/lanTransport.ts`) implements the existing `Transport`: plain `RTCPeerConnection` with a frozen `iceServers: []`, a pre-agreed reliable ordered data channel per joiner, non-trickle ICE (gathering awaited, 3 s at most), messages framed in 16 KiB pieces with back-pressure. Lobby, lockstep, hashes, rejoin and replays are unchanged.
- **Connection codes** (`net/lanCode.ts`): `UD1H-` host codes and `UD1R-` replies, a compact binary form of the session description (ICE credentials, fingerprint, role, mid, SCTP port, UDP host candidates as raw bytes) with session id, slot, time and CRC-16: 128 characters with IPv4 candidates, about 170 with mDNS names. Stripped-and-deflated fallback for anything unusual. Validated and size-limited; 5-minute expiry, single use, clear wrong-kind messages.
- **Screens** (`ui/lanCodes.ts`): Multiplayer → Online | LAN | Local tabs. Host LAN game → lobby with **Add player** per open slot (QR code, text with Copy, Show larger, countdown; then paste or Scan QR code for the reply). Join LAN game → three labelled steps. QR encoder (qrcode-generator 1.4.4, MIT) and decoder (jsQR 1.4.0, Apache-2.0, only where `BarcodeDetector` is missing) are bundled; the camera is asked for only on Scan.
- **Drops:** host **Players → Reconnect player N** (and on the "Waiting for…" banner) makes a new code; the client's **Rejoin with a new code** reloads into the rejoin screen with its token, then the usual snapshot catch-up. "The host ended the match" when the host leaves on purpose.
- **No outside servers:** empty ICE list, plus a guard that logs any `RTCPeerConnection` with ICE servers in LAN mode. The page must be loaded first; then no internet is needed.
- **Tests:** `tests/lan.ts` (in `npm test`: Chrome, Firefox and Safari session descriptions through codes and back, damaged/oversized/wrong-kind/expired codes, framing up to 3 MB, the empty ICE config). `tests/browser/lan.py`: real WebRTC between Chromium pages through the menus: two players (connected 0.4 s after the reply), wrong codes, a reconnect with catch-up, four players, matching hashes, no requests to PeerJS/STUN/TURN, every peer connection with an empty ICE list. `mp_local.py` and `mp_finish.py` use the new Local tabs tab.
- **Not tested here** (needs real devices): two physical devices over Wi-Fi, a router with its internet unplugged, Firefox and Safari, mDNS name resolution on a real network, QR scanning with a real camera.

## 2026-10-26 — The first authored map: Meadow Pond (v13 with LAN play and the touch fixes)
User request: five realistic maps (`claude/maps/01-spec-new-maps.md`; plan `docs/maps/design.md`). Decisions with the user: the old random styles stay in code (hidden from menus once all five maps exist; for now they sit beside the new map), floods off by default, Savanna's termite mounds as walls with an option for live neutral colonies.
- **Infrastructure:** a general hex layout (`world/hexLayout.ts`, shared with the nest grid); map definitions as data (`maps/types.ts`: shapes, height brushes, water bodies, walkways, walls, sites, site sets, zones, flood zones); the surface layout rasterises them into hex types and flags with a hash (`world/surfaceLayout.ts`); the terrain carves basins whose waterline is the outline, raises walkways to walk height and blocks walls (4 mm grid on maps); a validator checks site rules (dry flat footprint and ring, distances to water, walls and other sites), entrances and land connectivity, also with each flood zone flooded (`world/mapValidate.ts`, `tools/validate-maps.ts`, `tests/maps.ts` in `npm test`); colonies placed on sites with their entrances; food, aphids, plants, lairs and wild creatures from the map's zones; markers snap off water and walls; strict flow fields (no corner cutting).
- **Meadow Pond** (1.6 × 1.6 m): a lily pond in a shallow hollow, two streams with flat-stone crossings, rocks and stones breaking the meadow into lanes, ten sites (six outer, four inner) in point-symmetric pairs, rich food and aphid flowers on the east and west banks, spider burrows north and south. Layout sketch `docs/maps/sketches/meadowPond.png` (`tools/map-dump.ts` + `tools/map-sketch.py`).
- **Art, first round** (`render/mapDecor.ts`, render-only, seeded from the map id): boulders filling the wall outlines (moss, lichen, per-face texture projection), overlapping flat stepping stones, lily pads with flowers in the shallows, reeds along the shores, long grass toward the edges, pebbles and scree, daisies and buttercups; a grass sward over most of the ground; thinner fog on big maps. Renders in `docs/maps/renders/`.
- **Menus:** single-player skirmish and sandbox offer Meadow Pond first, then the random styles; the multiplayer lobby's Map list too (LAN and online; build id `ud-mp-4`). The minimap draws rocks grey and stepping stones tan.
- **Not done yet:** the other four maps (Forest Floor has a layout draft), floods (off by default; no storms yet), map cards and the Floods switch in the menus, missions on maps, saves naming the map, terrain chunking and a performance pass on big maps.

## 2026-10-26 — All five maps playable: Forest Floor, Riverbank, Rainforest, Savanna join Meadow Pond; floods
User request (`claude/maps/01-spec-new-maps.md`), done overnight beside the nest entrances.
- **Four new maps** (generated by `tools/mapgen/*.py`, validated by `tools/validate-maps.ts`, sketches in `docs/maps/sketches/`, renders in `docs/maps/renders/`):
  - **Forest Floor** (1.6 × 1.6 m): a dim woodland floor; a stream in an S across the middle with three root-mat crossings; fallen logs (bark, cut ends) and rocks making lanes; mushroom clusters; ferns and leaf litter; litter hollows hold the lairs and flood after rain.
  - **Riverbank** (1.8 × 1.4 m): a winding stream west to east, six sites on the high north bank and four on the low south bank; two stepping-stone crossings and a fallen-leaf raft; uneven sand beaches, driftwood, reeds; washed-up food on both banks; the stream floods the south bank's mud margin.
  - **Rainforest** (1.5 × 1.5 m): two giant trunks whose buttress roots radiate into lanes; rain pools crossed on fallen leaves; heavy fog, ferns and big leaf litter (kept off water and crossings); short showers flood small hollows.
  - **Savanna** (1.8 × 1.8 m): wide and open; a seasonal waterhole in a shallow pan; fluted ochre termite mounds as walls; dry grass, acacia deadwood, seed patches.
- **Biome dressing and light** (`render/mapBiomes.ts`): per-map grass, litter, ferns, reeds, pebbles, flowers, sun, sky, fog and water colour; ground beyond the map edge to match.
- **Floods** (`sim/floods.ts`, off by default; a switch in the single-player menu and the lobby): a storm warning, the water rising over a flood zone in five steps, holding, then draining; ants in the water lose health and paddle to dry ground, loose food floats off. Deterministic (tests in `tests/maps.ts`).
- **Menus:** skirmish and sandbox offer the five maps only (the old random styles stay in the code for the story missions, tests and old saves); up to **9 AI colonies** (the maps have ten sites); the lobby starts on Meadow Pond. Up to **14 underground-area tabs** (ten nests and their caves; numbers only when there are more than eight).

## 2026-10-26 — Proper nest entrances (surface and underground), every species, every map
User request (`claude/maps/02-spec-nest-entrances.md`; decision `claude/maps/03-entrances-decisions.md`: the ordinary Dig tool on a marked spot opens an extra entrance, no new tool). Survey and design in DESIGN.md §3.12b; research notes in `docs/creatures/entrances.md`.
- **No surprise holes.** The three hidden shafts per nest are gone. Each nest has two marked **extra-entrance spots** (dashed rim and a pale ring on the soil, shown to the owner), placed without random numbers toward the site's two dry extra surface spots; the Dig tool on a spot marks its whole 3-hex tunnel (a drag only takes a spot if it starts on it); when it is dug out, the entrance opens on the matching site spot (never a raw projection; validated dry by `tools/validate-maps.ts`). Digging anywhere else never opens an entrance. At most two extras (`ENTRANCE.maxExtra`); rival AIs dig one when they grow (`aiExtraAt`), by the same rules.
- **Tunnels.** Every entrance (and cave mouth) is a 3-hex tunnel rising to its hole: no tiles on it, highway speed, a ramp graded along it, loose soil worn smooth down the middle, species debris along the sides (needles, leaf scraps, carton flakes, frass, granular soil), daylight down it (cool by day, faint at night).
- **Throughput.** Each entrance passes 10 ants a second (in and out together); the rest wait at the hole or at the top of the tunnel. Crowds still all get through (tests).
- **Closing and collapse.** Delete on an extra entrance plugs it with soil (4 s; command `entrance`, wire id 23); Dig on a plugged one opens it again; the main entrance never closes. A fallen colony's entrances cave in over a minute.
- **Surface models** for all eleven colony kinds: crumbly pellet craters (black garden ants, one extra under a flat stone), a thatched dome with holes in its flanks and worn trails (red wood ants), wide orange craters with leaf scraps and a refuse dump (leafcutters), small granular collars beside the dome (fire ants), a bivouac of linked bodies (army ants), a neat hole in litter (hell ants, a reconstruction), a rotting stump with frass (Gilded Ants), a carton-plastered crater (Termants), a lobed carton nest with covered galleries (nasute termites), tiny turrets and foraging holes in litter (sickle-jaw termites), a low crater with plant bits (Gene Thief). Ants walk over rims and domes. Screenshots in `docs/maps/entrances/` (`tests/browser/entrance_renders.py`).
- **UI.** Cursor tip on any surface entrance (area, owner, main/extra, open/closed/caving in, ants at the hole); minimap greys closed entrances and shows your spots; Dig and Delete tool tips explain entrances.
- **Saves.** Older saves load: tunnels rebuilt along the dug corridor, shafts turned into spots up to the allowance, entrances the player had already opened kept.
- **Tests** (`npm test`): tunnels and tile blocking, spots and the whole-spot dig, no entrance from ordinary digging, opening on the site's spots (both, on dry ground), the entrance dig job, closing and reopening (and the main one refusing), the wire format, throughput (6–10 a second) and a crowd getting home, collapse, old-save migration, the AI's extra entrance.

## 2026-10-26 — Multiplayer fixes for the website: relay, Check connection, Safari/iPhone LAN
User report: on https://chibisc.github.io/WIP/ neither LAN nor online connected; online said "a firewall may block it, a TURN server fixes that". Docs: README "When players cannot connect", docs/multiplayer.md §5 and §6.1–6.2.
- **Online had no relay.** Only STUN was configured, and PeerJS's free TURN servers are gone, so any pair that could not connect directly (phone data, strict routers, VPNs, two devices behind one router that will not loop back) timed out. Online now adds a TURN relay (`net/relay.ts`): the repository variables `TURN_URL` / `TURN_USER` / `TURN_PASS` when set (the Pages workflow passes them to the build), else the Open Relay Project's public static-auth server with credentials made in the browser. A failed ICE check ends the wait at once; a brief `disconnected` gets 8 s to recover instead of dropping the player.
- **LAN on Safari, iPhone and iPad.** WebKit can hide a page's own addresses until it may use the microphone or camera, so codes carried no address. Add player and Join LAN game now check first and, when hidden, ask once ("Allow and continue"; nothing recorded). A code with no address is refused with the reason.
- **Check connection** on the Online and LAN tabs: matchmaking server, direct route (STUN), relay and local address in plain words, with VPN advice and an Allow button for hidden or `.local` addresses.
- **Tests:** `tests/lan.ts` (+6), `tests/browser/net_check.py` (13 checks, including a simulated iPhone host joined by a desktop browser), `tests/browser/lan.py` two-player and codes runs unchanged. The relay and PeerJS cannot be reached from the test sandbox: use Check connection on the live site to see them from a real network.

## 2026-10-26 — Fix: in-game buttons did nothing in multiplayer
User report: multiplayer connected, but the buttons didn't work in the match. The multiplayer HUD (`ui/netHud.ts`: chat, the "Waiting for…" banner) is a full-screen layer marked `pointer-events: none`, but the rule `#ui > *:not(.gui) { pointer-events: auto }` outranked it, so the invisible layer covered the screen and swallowed clicks on every button (single-player has no HUD layer, so it was unaffected). The rule now has zero specificity (`:where(…)`), so a layer's own `pointer-events: none` wins; the HUD's chat box, Mute and banner buttons keep `auto`. The browser tests had missed it because they press in-game buttons with `dispatch_event`, which skips hit-testing: `tests/browser/mp_local.py` now checks that real clicks reach every in-game button on every tab, and (at its end) that real mouse clicks on Mute chat and Dig respond. On this 2-CPU sandbox the three software-rendered tabs of `mp_local.py` are too slow to finish reliably (a guest stalls past 30 s and is dropped, which reloads it); a two-tab version of the same click checks passed (0 of 47–49 buttons blocked; Mute, Dig, an area tab and Menu respond to real clicks).

## 2026-10-26 — Multiplayer: teams, Gene Thief picks, map cards, eight slots
User request (after confirming multiplayer works): teams, proper Gene Thief integration and map selection in multiplayer. Docs: README "Multiplayer and invite links", docs/multiplayer.md §6.
- **Teams:** Red, Blue, Green, Gold or no team per slot (players pick their own, the host arranges everyone). Teammates are allies in the simulation (no fighting each other; the war AI and brood raids skip them), start on neighbouring colony sites (`groupTeams`, `teamSiteOrder` in `sim/mapGen.ts`), and win together; the results screen names the winning team. Everyone on one team cannot start.
- **Eight slots** (was four): players and AI colonies, on the five ten-site maps.
- **Gene Thief:** its player (or the host, for an AI) picks the stolen castes in the lobby from all 21 borrowable castes; the host checks the picks; the colony raises exactly those (every multiplayer Gene Thief used to get the same two). Gene Thief AIs get two or three at random.
- **Map cards** with sketches in the lobby (host picks, guests see it), floods on/off.
- **Tests:** `tests/net.ts` (+15: teams to simulation teams, Gene Thief picks and cleaning, teammates on neighbouring sites, a 2 v 2 lockstep match with Gene Thieves in sync, team victory, lobby validation of teams and castes, the one-team blocker); `tests/browser/mp_teams.py` (15 checks, real clicks: eight slots, map cards with sketches, the Gene Thief picker, teams and the blocker, then the match on both tabs with the same teams and castes, allies, buttons reachable, the Castes tab listing the stolen caste). Screenshots `docs/multiplayer/teams-*.png`.

## 2026-10-26 — Realism pass, pilot: fire ant worker textures, stag beetle rebuilt (awaiting approval)
User spec: project doc `claude/realism/01-spec-realism-pass.md` (pilot first, then stop for approval). Branch `feature/realism`; details and screenshots in `docs/realism/` (README, `before/`, `pilot/`).
- **Baked cuticle detail** (`render/bake/`): per species family, a GPU-baked atlas of seamless tiles of real cuticle at real size (punctures with pale rims, granules, reticulation, striae, mottling, dust in hollows), mapped along each body part by a new `aDet` vertex attribute; one shader patch adds relief normals, roughness, cavity occlusion, darker joints, paler undersides, clearcoat broken in the pits and light through thin cuticle, fading out with distance so nothing shimmers. Recipes: fire ant, stag beetle.
- **Fire ant worker** (*Solenopsis geminata*): the texture pass plus pale golden erect hairs on the head, mesosoma and gaster (the majors and queen inherit them). Only the fire ants' close-up models changed (`tests/data/morph-hashes.json` re-baselined for fire_* LOD0; every other model byte-identical).
- **Stag beetle** (*Lucanus cervus*) rebuilt: sculpted model (long domed elytra, transverse pronotum, broad flat head with front angles, antler mandibles with the inner tooth and forked tips, elbowed antennae with a comb club, flattened toothed legs, tarsi and claws); slow tripod gait matched to its speed, body roll and heave; new attacks in the deterministic sim — grab one or two ants in the antlers, lift and squeeze, toss them aside; plough through swarms; the enraged rear-up and slam kept. Numbers in `balance.ts` `STAG`; climb rails and riding slots regenerated.
- **Tests:** `tests/realism.ts` (grab, lift height, sideways toss, landing, plough, determinism) added to `npm test`; `tests/browser/realism_pilot.py` renders the in-game shots and the frame strip; `tools/realism-sheets.py` composes the sheets.

## 2026-10-26 — Realism pass v2: killing the plastic look (pilot: fire ant worker, stag beetle; awaiting approval)
User spec: project doc `claude/realism/02-spec-realism-fix-plastic-look.md`. Details in `docs/realism/pilot-v2/README.md`, references and sampled photo colours in `docs/realism/references.md`. Thirteen reference photos from the user (study only; `docs/realism/pilot-v2/refs/`, git-ignored with every sheet that contains them).
- **Causes fixed:** image-based light (`render/lightPresets.ts`: sunny, overcast, forest presets as PMREM environments for creature and ant materials, picked per biome, overcast in storms, the nest's own underground; the flat hemisphere ambient cut to ~20 % on them); the clearcoat now follows the baked relief (three.js lights it with the smooth normal by default, which made the round highlight blob); colours and gloss calibrated against the photos (the fire ant is a saturated, polished amber after all; the stag's elytra and mandibles maroon); baked occlusion and edge convexity, wear, dust, sutures and translucent tergite margins; curved tapered setae; stag mandibles as swept flattened blades with tooth, denticles and fork; reshaped stag head, pronotum, elytra (shoulders, rounded apex, suture), legs, antennae.
- **Labs:** lighting presets plus `studio` (specimen-photo look) and `backlit`; PBR Neutral tone mapping; sand grains and blended ground at the subject's scale; grain, contact occlusion, soft shadows; part masks (`?mask=1`).
- **Tools:** `tests/browser/realism_v2.py` (renders), `tools/realism-metrics.py` (before/after ΔE, part colours vs photos, highlight blobs), `tools/realism-v2-sheets.py` (comparison sheets, blind pairs framed alike).
- **Independent review (blind, a fresh agent each round, photo/render pairs in random order):**
  - Round 0 (renders only, before the photos arrived): 2–4 / 10, all called CG or toy.
  - Round 1 (13 pairs): renders 2–3 / 10 (mean 2.8), each identified with 96–99 % confidence; photos 8–9. Main problems: one uniform hue and big softbox-window highlights; long tube legs, banded antennae, waist like stacked washers; tomato-red pill-shaped elytra, box pronotum, plank legs, tube mandibles; speckle texture, few straight hairs; CG ground, symmetric pose.
  - Round 2 (reshuffled): renders 2–3 / 10 (mean 2.8), identified 96–98 %. After: colour varied by part, small broken highlights from a ring of lamps, shorter legs with swollen femora, no ringed waist or antennae, many more pale setae; stag mahogany elytra with shoulders, rounder legs, flatter mandibles with a denticle row, sunken eyes. New problems found: open segment ends showing the background (white rings and dots), gaster seams reading as wireframe lines, a printed dot pattern, the studio horizon band, dimpled soil.
  - Round 3 (reshuffled): renders 3 / 10 each (mean 3.0), identified 96–98 %; photos 8–9. Credited as convincing: body plan and stance, the elytral suture, contact shadows, the stag pronotum's granular surface, the ant gaster's highlights and edge hairs. Still failing: even-width tube legs and antennae, one flat red without translucency, rounded-box head with a bead eye, lathe-turned waist, visible sting, slab elytra and plank legs on the beetle, the procedural floor.
- **Acceptance checks (spec §4):** visible difference ✓ (before → after ΔE 21–28 on the animals, mean 24); colour ✓ (fire ant head and mesosoma hue 15–20°, saturation 0.69–0.79 against photos 17–26°, 0.72–0.94; stag elytra 7°, 0.47 against 3°, 0.57); highlights ✓ (no round, smooth, even highlight blob in 35 renders, `tools/realism-metrics.py`); microsculpture ✓ at macro (hair punctures with their hairs, mesopleural striae, beetle granulation and reticulation); translucency ✓ partly (backlit setae and legs glow; the stag elytra show a grazing glare); hairs ✓ partly (curved, tapered, varied, fading tips, but still read as sparse to the reviewer); **independent review ✗: 3 / 10, not the 7 / 10 target**; gameplay zoom ✓ (arena shots read clearly). Pilot stopped here for the user's decision.

## 2026-10-27 — Jaws and animation pass, pilot: fire ant and stag beetle (awaiting approval)
User spec: project doc `claude/realism/03-spec-jaws-and-animation.md`. Details in `docs/realism/jaws.md` and `docs/realism/animation.md`; branch `feature/realism`; nothing rolled out beyond the pilot.
- **Jaws** (shared generator `src/render/anatomy/mandible.ts`, specs `mandibleSpecs.ts`, numbers in `docs/creatures/`):
  - Stag antlers are traced on a specimen photo: tapered hooked points, filleted big tooth and fork prong, denticles, a smooth base, held raised.
  - Allometry runs from small males' short stout jaws to the major's antlers, with heads narrowing below the pronotum's width.
  - The fire ant worker has amber four-toothed triangles closing under a forward clypeal lobe on a smooth rounded-square head; the major has a massive glossy wedge in a darkening face.
  - Fresh-reviewer scores (5 pairs + size series): round 1: 2, 4, 4, 3, 4 / size 5; round 2: 3, 4, 6, 5, 6 / 5; round 3: 3, 4, 6, 5, 5 / 4; round 4: 4, 3, 6, 5, 4 / 5. They plateaued, and reviewers contradicted each other (gloss, small males' jaw curve), so the pilot stops for the user's judgement.
- **Animation** (render-only): planted feet, turning, variety, five idles, three attacks, hits, deaths and flings.
  - Tests: foot drift 0.00 % straight, 2.2 % on curves, 5.7 % turning in place; 94/100 distinct gait phases.
  - Blind review fixes:
    - Dead and flung ants rest on the ground.
    - Flung ants lie kicking before they right themselves.
    - Gripped ants are drawn in the stag's animated antlers, with a smooth release.
    - The attack key poses are bigger, and the sting curls forward.
    - The slam has a soft dust shock wave and the hit flash is lighter.
    - The dead stag rests on its back with folded legs.
  - Second blind review: lunge identified at 75 %, grip-and-sting at 70 %; clamp-and-tug confused with rear-up. Fights are unreadable at the default zoom, where ants are about 10 px.
  - Later fixes, all in the final clips: each bite gets a warm pop that keeps 9 px on screen; dead pilot ants' legs curl under the belly; the sting curl is softer; the posed ants in the lab stand clear of the walker; a lighter creature hit flash.
  - Stress: the frame rate can't be measured with 1000+ ants on this sandbox, where the software GPU takes several seconds a frame and two 200 s runs never got past warm-up. The CPU side of the pass costs 1.25 ms a frame for 1,040 ants (2.2 ms p95), about 7.5 % of a 60 fps budget, and 3.3 ms for 4,160 (`tools/anim-cost.ts`, `docs/realism/animation/cost.json`). The frame rate needs checking on a real device.
- **Pilot finish (2026-10-27/28, at the user's request).**
  - The fire ant worker's jaws went back to the spec's "clearly visible": a longer, flatter toothed triangle in front of the head, apexes crossing a little, a small flat clypeal lobe and a dark labrum.
  - The antenna sockets sit back on the head surface.
  - Everything was re-rendered and all clips re-recorded both ways.
  - The review page for the user's own rating is https://claude.ai/artifact/DvWJzEKXqPdcp396FprwZC: jaws J1–J6, clips A1–A17, the spec's acceptance checklist and the rollout decision. Scores are stored in its `ratings` collection. The photo comparison sheet was sent in the chat; the photos are study-only and stay out of the page.
  - Waiting for the user's ratings and decision.
- Clips and strips: `docs/realism/animation/clips/`, `strips/`; jaw sheets: `docs/realism/jaws/` (photo sheets git-ignored).

## 2026-10-28 — Combat and death animation (spec 04), pilot: fire ant worker and major (awaiting approval)
User spec: project doc `claude/realism/04-spec-ant-attack-and-death-animations.md`, the user's ratings of round 1 (review page DvWJzEKXqPdcp396FprwZC: jaws all 10/10; the animation not yet approved) and a reference screen recording (study only). Details in `docs/realism/combat.md`; research in `docs/creatures/solenopsis-geminata.md`.
- **Planted feet under a moving body.** A per-instance body-offset texture (4 texels: translation, rotation, stance spread, sideways sweep, gaster yaw, sting, fore legs, decapitation, drying, crush). The shader solves each leg against its ground target in the body frame, so attacks, flinches and leans move the body over feet that stay put.
- **Attacks in three beats** (wind-up, a 4-frame strike on the damage tick, recovery):
  - Worker: a series of 3–5 stings on one grip, rising, arching, curling the gaster under and stepping round the grip between stings; also a lunge bite, a clamp and tug, and a quick sting.
  - Major: crushing bites and head swings.
  - Alarm: the gaster-flagging threat display.
  - Hits: two light reactions and a heavy knockback.
  - Render-side sound hooks.
- **Deaths by cause.** Sim: a deterministic `Ant.lastHit` (bite, venom, acid, crush, fall, drown, starve, decapitation) passed on the death event and the corpse. Each cause has its own death. Corpses keep the animation through the hand-over, lose their gloss, and sink out of sight.
- **Round-1 rating fixes:** A1, A2, A3, A4, A5, A9, A10, A11, A13, A14, A16, A17 (list in combat.md).
- **Checks:** check-determinism clean; tests/animation.ts and tests/combat.ts pass.
- **Clips:** `docs/realism/combat/fire-ant/`, `docs/realism/combat/stag-beetle/`.
- CPU: the motion controller costs 0.79 ms a frame for 1,040 ants and 2.8 ms for 4,160 (`tools/anim-cost.ts`); the GPU side needs a device.
- Round-2 review page https://claude.ai/artifact/9jbgV66mmYctu2Jy6HmsPM: 20 clips (round 1 beside round 2 where there was one), six acceptance checks and the rollout decision, stored in its `ratings` collection (B1–B20, E1–E6, D2). The game artifact is republished from this branch (version 19).
- Waiting for the user's ratings before rollout.

## 2026-10-31 — Overnight run (claude/realism/06-spec-overnight-atta-eciton.md): Lasius + Formica finished first, then Atta, then Eciton
User order (02:35): finish *Lasius niger* and *Formica rufa* first, then Atta, then Eciton; runs unattended.

**Decisions made without the user**
- The spec's "other agent" working on Formica/Lasius is this same session (no other session was running): the
  enhancement layer is applied directly on top of the batch-1 work, in the same files, rather than in separate
  modules.
- Reference photos stay study-only (the user's standing rule overrides the spec's "photo-vs-render sheets saved to
  docs/"): the repo gets **render-only** sheets (`docs/realism/<species>/compare-<unit>.png`: side, top, front, 3/4 in
  studio / overcast / sunny, macro head, macro jaws open); the photo-vs-render sheets and the blind-review pairs stay
  in the scratchpad and go to the user in chat as files.
- The fire queen's eyes follow the batch-1 eye rule (larger eyes set into the head, the user's "eyes bulge" note):
  her hash was re-baselined; the satin/grey eye material is formicine-only.
- Blind review: a fresh agent per round, shown photo/render pairs as unlabeled A/B panels in a seeded random
  order, scores each panel 1–10 and flags "plastic"; the render's score is read from the key.

**Blind review scores (render panel; photos scored 7–9)**
| Round | F1 side | F2 field 3/4 | F3 head | F4 jaws open | F5 top | F6 face | L1 3/4 | L2 head | L3 side | L4 field |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3 | 3 | 3 | 3 | 3 | 3 | 4 | 3 | 4 | 4 |
| 2 | 3 | 3 | 3 | 2 | 4 | 2 | 3 | 3 | 3 | 3 |
| 3 | 3 | 3 | 2 | 2 | 3 | 3 | 3 | 3 | 3 | 3 |

Fixes between rounds: (1→2) continuous mesosoma, stouter shorter legs, deeper heads with a broad front, longer
darker jaws, matte grey eyes, thinner antennae, darker hairs, uniformly dark Lasius, rust-red Formica, low dark
petiole, tergite margins; (2→3) no Solenopsis clypeal lobe or labrum on formicines/Atta (read as lips), a thin
narrow petiole scale, rounder gasters, bigger eyes, Lasius greyer; (3→4) the formicine face tilted down (−0.36 rad)
so the closed jaws hang below the clypeus instead of a forward beak, antennal sockets at the front of the frons with
the scapes rising up and back, the head set against the pronotum (no bare neck), no suture band across the
mesosoma, larger and lower eyes, satin gasters.
| 4 | 3 | 3 | 3 | 3 | 3 | 3 | 4 | 3 | 3 | 4 |

**Stopped at the 4-round limit, below the 7/10 target** (best version kept: round 4, the most anatomically correct —
the reviewers' shape notes shrank each round even where the score didn't move). What still blocks it, in the order
the reviewers keep naming it:
1. **Antennae and legs read as stiff, uniform rods** with "joint caps": the antenna is two straight tubes (no curve,
   no gradual thickening, obconical segments read as bamboo rings); femur/tibia radii vary too little to read at
   sheet scale; legs held straight and splayed in the lab's rest pose. Needs curved antenna geometry with a smooth
   taper, softer joints, and a natural rest pose.
2. **Waxy, uniform cuticle**: no visible pubescence (a fine-hair sheen layer, not baked pits), no translucency at the
   leg and gaster margins, hard CG shadows. Needs a pubescence/fuzz shading term and thin-part transmission.
3. **Jaws read as flat striped plates** (no visible tooth row at sheet scale); the head's underside flat.
4. Presentation: the plain studio renders vs studio photos with soft fill light.
Suggestions recorded in docs/realism/formica-lasius-suggestions.md.

