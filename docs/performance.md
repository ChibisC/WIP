# Performance

Targets from the multiplayer brief (Part A):

- 60 FPS rendering on a mid-range laptop with integrated graphics, medium settings.
- Simulation tick under **15 ms** (of the 50 ms budget at 20 Hz) with 4 colonies × 400 ants (1,600 ants) and 100 other creatures, across the surface and 5 underground areas.
- No frame longer than 33 ms during normal play (no GC or loading hitches).

## Baseline — 2026-10-24, before the architecture upgrade

### Simulation (headless, Node 22 via vite-node, one core of the build container)

Scenario `tools/stress.ts` (`npx vite-node tools/stress.ts -- 400 60 100`):

- 4 AI colonies (black garden, red wood, tropical fire, leafcutter) on a 900 × 900 mm map. Each has about 400 ants: 45 % workers and 20 % fighters at a surface marker near the centre (the armies meet and fight), and 35 % working in the nest.
- 4 nests and 2 caves, so 6 underground areas.
- 70–80 wild creatures. They were spawned for the measurement only; the creature systems are not part of the game yet.

| Measure | Value |
|---|---|
| Tick time, average | **16–23 ms** (target < 15) |
| Tick time, p95 | **43–50 ms** |
| Tick time, worst | **125–138 ms** |
| Ticks over 50 ms | 27–33 per 1,200 |
| Heap | 40 MB after setup, 45–48 MB peak |
| JSON snapshot of the full state | 2.0 MB, 50 ms to serialize |

Per system (30 s run):

| System | ms per call | Worst |
|---|---|---|
| ants | **22.3** | 236 |
| creatures | 0.47 | 18 |
| colony | 0.38 | 29 |
| pheromones | 0.32 | 43 |
| everything else | < 0.6 | < 8 |

CPU profile of the same scenario (self time):

| Share | Where |
|---|---|
| **~46 %** | Flow-field Dijkstra: `flow.ts` `dijkstra` (17 %), heap `pop`/`push` (25 %), field lookup (5 %). Nest fields are cached per destination *cell* (`pt:<cell>`), so ants walking to their own tile points or random wander points create hundreds of distinct fields. Every tile change (a new tile cost version) invalidates all of them. |
| 9.4 % | Garbage collector: temporary arrays and objects in hot loops (field target lists, `filter`/`map` in the AI, closure callbacks in spatial queries). |
| 5 % | `findTarget` (combat scans) |
| 3 % | `antSystem` dispatch |
| 2.4 % | `searchAndCollect` (foraging) |
| 1.3 % | `fbm2` terrain noise evaluated at runtime |
| the rest | under 1.5 % each |

**Conclusions**
1. The worst offender by far is how often nest paths are recomputed.
   - Fields have to be shared per *destination* (tile chamber, marker, entrance, queen) rather than per cell.
   - They have to update incrementally, or at least without invalidating every field when one tile changes.
   - Ants should walk the last stretch to their own point by steering, without a per-cell field.
2. GC pressure comes from allocation in hot loops. The structure-of-arrays rewrite and scratch buffers remove most of it.
3. The spikes (worst 125–236 ms) are clusters of fresh Dijkstra runs plus GC, not steady load.

### Rendering (headless Chromium, SwiftShader software GL)
The build container has no GPU, so these numbers only compare builds with each other. They say nothing about a real laptop. A real-hardware baseline will be taken with the F3 debug overlay (Part F).

A partial run of the default small match (2 colonies, about 50 ants, after 1,200 ticks), with 60 timed frames each:

| Quality | View | Frame avg | p95 | Worst | Draw calls | Triangles |
|---|---|---|---|---|---|---|
| low | surface | 4.1 ms | 12.1 ms | 26 ms | 25 | 627 k |
| low | nest | 3.7 ms | 8.0 ms | 16 ms | 20 | 129 k |
| medium | surface | 4.8 ms | 14.7 ms | 45 ms | — | — |

The medium nest run timed out while loading under software GL. The large-colony browser numbers come from the in-browser stress scenario (`?stress=1`, Part F).

## After step 3 of the upgrade (simulation hot paths), 2026-10-24

Same scenario, now with exactly 100 creatures spawned (`npm run stress -- 400 60 100`):

| Measure | Before | After |
|---|---|---|
| Tick time, average | 16–23 ms | **4.9–5.1 ms** |
| Tick time, p95 | 43–50 ms | **8.9–9.2 ms** |
| Tick time, worst | 125–138 ms | **21–24 ms** |
| Ticks over 50 ms | 27–33 per 1,200 | **0** |
| Heap peak | 45–48 MB | 49–50 MB |

What changed:
1. **Nest path fields are shared per destination hex, not per cell.** An ant walking to a point follows the field of the hex the point is in, then steers straight in. This gives about 30× fewer fields. Each map keeps at most 64 fields and evicts the least recently used.
2. **Fields extend instead of recomputing.**
   - Nest cells only ever go from soil to air while playing, and the grid logs every dug cell.
   - A cached field takes each new cell's distance from its neighbours and spreads the improvements outward. A full rebuild happens only when a field's targets or the tile costs change.
   - Step costs are quantized to 1/32 of a cell and distances are exact in float32. So an extended field is **bit-identical to a fresh build**: caches are a pure function of the state, which keeps rejoining clients in sync.
   - The determinism test checks every cached field against a fresh build at every checkpoint (`staleFields`). This also caught the old frontier-field key, which could miss a designation swap; it is now keyed by the grid's designation version.
3. **The flow heap allocates nothing.** It is a typed-array binary heap, with the neighbour loop unrolled and no closures (the old heap swapped with array destructuring and allocated a closure per node).
4. **Target scans skip your own team inside the spatial-hash walk.** Hash entries carry a team tag, and `World.enemiesNear` checks it before measuring distance. The scan result is a reused object.
5. **Trail evaporation is spread over four ticks** (a quarter of the map each tick) instead of the whole map every fourth tick.

CPU profile now (self time): target scans 15 %, foraging 7 %, ant dispatch 5 %, GC 3 % (was 9 %), flow fields about 3 % (was 46 %).

## The performance pass, 2026-11-03 to 11-06 (CHANGE_PLAN §25)

Spec: `claude/performance/01-spec-performance-no-visual-loss.md` — faster in every mode, smooth switching between the
surface and the underground, and no loss of looks.

### How it is measured
- **F3** is a profiler (`src/core/profiler.ts`): frame time (average, p95, worst over the last 300 frames), the main
  thread's time and its parts (simulation messages, events, units, creatures, the nest, effects, UI, render submit),
  GPU time where the browser has `EXT_disjoint_timer_query_webgl2`, draw calls, triangles, programs, textures,
  geometries, heap, an estimate of live GPU memory (every texture, renderbuffer and buffer's size, followed through
  its binds, uploads and deletes), the GL work since loading (shader links and their time, texture uploads and bytes),
  and the **hitch log**: every frame over 33 ms with what happened in it (a model built, a shader linked, textures
  uploaded, a nest's terrain rebuilt, a big simulation message…).
- **`?bench=1`** (Menu → Graphics → Run the benchmark, `src/dev/bench.ts`): seven fixed scenes (the first, *feel*, added by
  performance v2 — below), each loaded fresh, warmed
  up, then timed while the camera flies a fixed path. *switch*: surface → home → every area → surface, ten rounds, every
  switch's frames kept; *fight*: 400 against 400 with two titans; *nest*: a developed nest; *story*: The Long Nights at
  dusk before the third night; *arena*: six teams of 100; *mp4*: a four-colony world. The report has the device, the
  numbers per scene, the switch table and the hitch causes, with a Copy button. `tests/browser/bench.py` runs it headless.
- **The golden set** (`tests/browser/golden.py`, `tools/golden-compare.py`, `docs/performance/golden/`): 35 fixed shots
  (every map at three zooms, both nests, eleven species close-ups, a big fight, a flood, a titan in a nest, day and
  night, the low and medium presets), rendered from main without the change and from the branch, compared by SSIM
  (≥ 0.985) and mean pixel difference (≤ 2 of 255).

### What was found
- **Switching hitches came from lazy creation.** Each space has its own ant renderer, and the first time an area was
  shown its renderer built every ant model it met, baked their far impostors, created their materials, and the GPU
  compiled every shader on first draw. The hitch log named it on the first probe: entering the home nest the first time
  was one 7.4 s frame on the build machine (medium quality), area 3 1.6 s, area 2 0.6 s.
- **three.js binds a program for every visible instanced mesh, even with no instances** (`setProgram` runs before the
  empty-draw check). Hundreds of empty pools (ant LODs × morphs, creature parts) cost a program switch each per frame.
- **`renderer.compile()` does not reach the shadow pass's depth materials**, so a scene "compiled" at load still linked
  depth programs on its first shadowed frame.
- **The worker re-sent every colony whole each frame** (structured clone: 175 KB of objects in a 10-colony match at
  10 minutes, about 1.5 ms to clone in the worker and as much to rebuild on the main thread, all of it garbage).
- **Entering an area rebuilt its terrain in one frame**: ants dig in every nest all the time, and an area not on screen
  piled up dirty chunks; showing it ran the distance field (12 ms), the light maps (5 ms) and 2 ms a chunk at once.
- **The ant shader is at the 16 vertex attributes WebGL guarantees** (phones have exactly 16): anything new per instance
  has to be packed into an existing channel.

### What changed (no change of looks)
| Area | Change |
|---|---|
| Switching | `GameSession.prewarm()` behind the loading screen: every model that can appear is built once and shared by all renderers (`builtCache`, `impostorCacheOf`, termite and creature part pools), then every space's scene is compiled and drawn once offscreen with shadows (`render/prewarm.ts`). |
| Switching | `warmNew()` warms a model the simulation shows mid-match in the background (under 4 ms a frame); `keepAreasCurrent()` keeps the areas not on screen up to date every sixth frame while there is room. |
| Switching | Nothing is drawn while the dive or area fade is fully opaque (the swap frame does the swap; the new space draws on the next). |
| Switching | The area a dive or cut is about to show is brought up to date under the fade, a 6 ms slice a frame; the areas not on screen are kept current in 3 ms slices (`NestTerrain.update(force, budgetMs)`: the distance field, then the light maps, then chunks). |
| CPU | The nest terrain's distance field blur skips bounds checks inside the grid, the same sums in the same order: the old result to the bit, 12 → 4 ms. |
| Rendering | Empty instanced meshes are hidden; creature pools upload only the instances drawn. |
| Memory | Every area's ant renderer shares each model's vertices (it used to clone them); the impostor bakes share one multisampled target and each model keeps only its resolved 0.5 MB atlas (it kept 4.5 MB); old instance buffers are freed when a pool grows. On the build machine, a developed match at Medium: estimated GPU memory 340 → 279 MB (buffers 82 → 43, renderbuffers 75 → 52). |
| Rendering | The AO composite pass is skipped when AO is off (it copied the image unchanged). |
| Rendering | Auto quality lowers the render resolution (10 % steps, never below 75 %, a light sharpen) before it drops a preset, and brings it back first. |
| Rendering | An ant's change of LOD cross-fades over 0.25 s (both models, each in the other's dithered pixels) with a 6 % hysteresis; camera cuts snap. The fade rides in `aE.z` with "exhausted". |
| CPU | The slow state goes as per-field deltas (`worker/slowDelta.ts`): 16 % of the bytes on average, and the replica ends up identical (`tests/performance.ts`). |
| CPU | HUD labels skip unchanged class and display writes; creature uploads allocate nothing. |
| Phones | Frame cap 30 / 60 / match the screen (phones default to 60); auto quality judges frames against the cap; an estimated GPU memory over 600 MB steps the preset down. |
| Multiplayer | Every pong carries the player's tick and frame time; the host shares them; F3 and the players panel show them, and the HUD names a slow device. |

### Not done, and why
- **KTX2 textures:** every texture is generated in the page at load; there are no image files to compress, and a
  transcoder would add weight for nothing.
- **Bake cache in IndexedDB / bakes in a worker:** worth it only if the device numbers show loading dominated by the
  impostor bakes; the profiler's notes will show it.
- **Cached static shadows:** the shadow camera follows the view and the units cast most of the shadow; a static cache
  would need a second shadow map and pass.
- **Termite LOD cross-fade:** the termite kit writes its instances through many setters; it keeps its own LOD switch.

### Switching, measured (build machine: SwiftShader, no GPU; Medium; `tests/browser/switch_probe.py`)
Meadow Pond at tick 400 with six developed areas, two seconds on the surface, then each area and back to the surface,
twice; every switch's first four frames (ms). "Before" is `main` at d1161a0 with only the measuring tools added (the
same profiler and probe); "after" is this branch. SwiftShader compiles shaders on the CPU, so the absolute numbers are
far above a real GPU's; the counts and causes are what transfer.

| switch | before: first frames | after: first frames | before: what the hitch log named |
|---|---|---|---|
| surface (warm-up) | max 1,355 | max 110 | ant model built (fire_minor), 5 shader compiles |
| area 1 (home), first | **119,609**, 6,104 | **11**, 7 | 31 shader compiles, the nest built, 10.7 MB of buffers, lasius_queen built |
| area 2, first | **819** | **89** | ant models built (fire_queen, fire_minor), the nest's terrain |
| area 3, first | **13,541** | **41** | 10.7 MB of buffers, lasius_queen built |
| cave 64, first | **12,885** | **6** | 4.3 MB of buffers |
| cave 65, first | 21 | 5 | — |
| round 2 (everything visited once) | 6–59, but 18,300 and 14,262 | 3–51, but 62,603 then 576, 159 | (see below) |

In round 2 both builds had multi-second frames in which a tiny buffer upload waited on SwiftShader's GPU process (the
hitch log: "buffer upload 0.0 MB (50,742 ms)"): the main thread blocks until the software GPU catches up with its
backlog. The before build had them too (18.3 s and 14.3 s here, 49.9 s in an earlier run), at different points each
run. Whether anything like it happens on a real GPU is what the device benchmark will show.

Loading takes longer in exchange: 14.4 s → 26.8 s here (every model and every program now built behind the loading
screen, with its progress shown). On a real GPU the programs compile in parallel and the difference is a fraction of
that; the benchmark's report gives the load time per device.

### The benchmark on the build machine (counts only)
`docs/performance/bench-swiftshader-before.txt` (`main` d1161a0 with the measuring tools) and `-after.txt` (this
branch before the memory changes), Medium, 15 s a scene, `tests/browser/bench.py`. SwiftShader runs the GPU on two CPU
cores: frame rates are well under 1 FPS in most scenes for both builds and say nothing about a real device (the
pre-warm's 150 programs also keep the software GPU busy for minutes after loading). What carries over:

| switching scene | before | after |
|---|---|---|
| main thread per frame (average) | 517 ms (nest 265, render 239) | 13.8 ms (nest 3.3, render 7.8) |
| shader links during the run | 38 | 0 |
| texture uploads during the run | 272 | 135 |
| ant models built during the run | yes (lasius_queen 15 s, …) | none |
| load | 94.7 s | 138.8 s (114.7 s of it the pre-warm) |

The real numbers come from the user's laptop and iPhone (`?bench=1`, below once they arrive).


## Performance v2: feel (claude/performance/02-spec-responsiveness-client-visuals.md)

### The feel meter (F3 and `?bench=1`)
`src/core/feel.ts` measures what the player feels, on every page (three lines on F3) and in the benchmark's new first
scene, *feel*, which plays scripted inputs through the real event handlers every 400 ms — a camera drag and wheel, a
click on an ant, a marker placed, a group sent, a key, then in the nest a hex marked for digging and a tile placed:

- **input → feedback**: from the input event's own timestamp to the end of the first frame that started after it (the
  frame that draws the ring, the marker, the ghost hex, the camera's move), by kind;
- **input → acting**: to the end of the first frame after the simulation ran the tick that applies the command;
- **command latency**: issue → the tick that applies it, in ticks and ms (single-player: 1 tick; multiplayer: the
  lockstep delay and one packet);
- **frame pacing**: the frame intervals (average, p95), their jitter, frames over 16.7 and 33 ms, frames that missed a
  vsync of the display (its rate estimated from the intervals), and long tasks (over 50 ms) where the browser reports
  them;
- the main thread's parts per frame (now with `input`, the time in input handlers) and the worker's tick time.

`tests/browser/bench.py` takes `ONLY=feel,fight` and `VW=480 VH=300` (a small viewport keeps the software GPU of the
build machine nearer real time; its frame times still mean nothing for a real device).

The real numbers come from the user's laptop and iPhone (`?bench=1`, below once they arrive).

### What was found
- **Single-player commands already acted on the next tick**: the worker applies a command at the boundary before its
  next tick as soon as it arrives. The meter confirms it (1 tick).
- **The 20 Hz stepping was the interpolation, not the tick rate.** In worker mode α ran 0 → 1 from each frame's
  arrival over the smoothed gap: an early frame jumped the units forward, a late one froze them, and a frame holding two
  or three ticks (a busy worker) drew the first ticks in one frame. Modelled with uneven arrivals (worker 4–40 ms a
  tick), 12 % of frames froze and 6–11 % jumped.
- **Off-screen ants cost as much as on-screen ones**: the ant renderer animated every ant of the space before its view
  test. Zoomed in on a crowd, 90 % of the time went to ants nobody could see.
- **Renders differed run to run** (`Math.random` seeds for gait, antenna wave, pose phase; random sparks), which is why
  the golden set needed a noise set.
- **The frame message was mostly unchanged data**: half to two thirds of the entity columns are the same from one tick
  to the next, and reading them was one megamorphic keyed store per value.
- **Multiplayer on a LAN waited 2 ticks** (100 ms) of input delay plus a packet: the delay's floor and a whole tick of
  margin on top of the path.

### What changed (no change of looks, no change of the simulation's results)
| Area | Change |
|---|---|
| Motion | `game/playout.ts`: a playout clock on the loop's pace, kept just behind the newest tick (98th percentile of the recent need); each frame with ticks re-anchors every unit's previous position to where it is drawn; late frames run on up to half a tick, easing off; teleports snap; paused glides to the newest tick. |
| Feedback | `game/intents.ts`: an order's ants turn toward it on the frame of the input (render only); a refused hex order's ghost unwinds; reasons said once. |
| Multiplayer | `MIN_DELAY` 1; the host's margin a quarter of the path plus a frame and slack, at most a tick: one tick on a LAN. |
| CPU per frame | `render/viewCull.ts`: ants more than 40 mm out of view get no view and no animation; the renderer catches each up in one step when it returns. |
| Looks, reproducible | Seeds hashed from ids and places; sparks from a seeded sequence. |
| Effects | Combat particles written once at spawn, played in the vertex shader in closed form from t − t0; only new slots uploaded. |
| Messages | Delta entity columns (unchanged columns left out); a reader generated per schema (named stores; the plain loop where compiling is forbidden). |
| UI | Marker counts once a tick; label and tip styles written only when they change. |

### Measured on the build machine (no GPU: the counts and the CPU parts carry over, the frame times do not)
| | before | after |
|---|---|---|
| Drawn step ÷ true speed, uneven arrivals at 60 Hz, p99 off by (`tests/smoothMotion.ts`) | 1.65 (12 % frozen, 11 % jumped) | 0.02 (none) |
| … at 144 Hz | 3.47 (12 % frozen, 6 % jumped) | 0.01 (none) |
| … a busy worker, batches of 2–3 ticks | 2.00 (16 % frozen, 13 % jumped) | eases off in 1 % of frames, no jumps |
| Single-player command → acting | 1 tick | 1 tick |
| LAN command → acting (1–4 ms one way, `tests/net.ts`) | delay 2: 3 ticks | delay 1: 2 ticks |
| Ant renderer, 600–900 ants, zoomed in on a crowd (`tests/clientVisuals.ts`) | 1.8–3.4 ms | 0.2–0.4 ms |
| Frame message, big fight (829 ants, 96 creatures) | 716 KB, columns read 3.1 ms | 381 KB, 1.8 ms |
| Golden set (12 shots the branch could touch, `golden/compare-v2after.md`) | needed a run-to-run noise set | 12 of 12 match with no noise set, 10 pixel for pixel |
| Simulation tick, big fight (Node, `tools/stress.ts`) | 24 ms (unchanged: no single hot spot; the simulation was not changed) | 24 ms |

## Performance v3: big colonies (claude/performance/03-spec-performance-v3-big-colonies.md, CHANGE_PLAN §32)

### How it is measured
- **`tools/perf/simBench.ts`** — the stress scenes at 500–2,000 ants (fight, economy, nests, ten colonies, titan raid,
  tunnel fight): tick times (avg, p95, max, over 40 ms), `--systems` (per system), `--series` (per 50 ticks, the slowest
  ticks), and a canonical state hash every 50 ticks.
- **Bundled, as the game ships** (`tools/perf/bundle.sh`): vite-node runs each module on its own and reaches every
  imported function through a module object, which slowed the small hot helpers (`sq`, `dsin`, …) several times over and
  put them at the top of every profile. The game's worker is one bundle; so is the bench now.
- **Same results** (`tools/perf/same.sh`, `tools/perf/canon.ts`): the hash lists of a reference checkout (main) and the
  branch for all 18 scene × size runs must be identical. The canonical hash sorts every object's keys (the branch gives
  every ant one field order; the snapshot hash depends on it). Every simulation change: ALL SAME.
- **Main thread** (`tools/perf/unitsBench.ts`): the real fight's ant views, ant renderer and creature renderer per
  frame, bundled, no WebGL.
- **Devices**: `?bench=1` on the laptop and the iPhone; the new **gpu** scene turns one effect off at a time.
- **Game speed and cutscenes** (added after the merge, when the user asked): the bench's **speed** scene runs the big
  fight at a fixed camera at 1×, 2×, 4× and 8× (3 s to warm up, then each speed 2 s to settle and 4 s measured): the
  speed the game really reached (ticks advanced ÷ 20 a second), frame times, the main thread's messages and events per
  frame and the worker's tick time. The **cine** scene measures The Antlered King's opening camera flight (Oak Woods,
  10.8 s) from its first frame to the camera's return: frames, hitches and their causes, shader links and texture
  uploads. `?bench=1&bonly=speed,cine` runs just these two. (`tests/browser/speed_check.py` does the speed steps from a
  script.)
- **What a scene holds** (`tests/browser/scene_census.py`): meshes, shadow casters and the biggest meshes by triangles.

### What was found
- **138 hidden classes for ants.** Fields were added in whatever order a code path first set them, and `delete`
  sent some ants into dictionary mode: every loop over ants was megamorphic.
- **Separation is the densest work**: in a full nest at 2,000 ants it tests ~90,000 pairs a pass (45 neighbours an
  ant within 3 mm) and pushes 37,000; each pair loaded both ant objects (1 KB+ each, out of cache).
- **The devices are limited by the graphics chip**, not the simulation: the laptop runs every scene at 28–46 FPS with
  the main thread at 2–8 ms and the simulation at 1–5 ms a tick; the phone (at High) at 7–22 FPS.
- **Most of the triangles were never seen**: the grass (one mesh for the whole map and its meadow skirt: 1.1 M
  triangles on Meadow Pond), the terrain (300 k), the water (320 k), the pebble sets (310 k, twice with shadows) were
  each one object, always "in view", shaded every frame. In the big fight 80 % of the 1.7 M triangles are the ants:
  ~200 mid-distance ants at 3,300 triangles, drawn twice (the picture and the shadow map).
- **The phone's main thread** in the big fight: 36 ms a frame (ant animation 12, drawing 13, creatures 4.5).
- **Once-a-second ticks are heavier in the stress scenes** (every ant was made on the same tick, so their
  one-second timers fire together; in a real game they hatch apart), plus garbage-collection pauses (about one minor
  collection a tick, 0.4 ms median, 9 ms at the 90th percentile).

### What changed (no change of looks, no change of the simulation's results)
| Area | Change |
|---|---|
| Ants, one shape | `sim/factory.ts antShape`: every field of an ant declared in one literal in a fixed order (restored saves normalised by `normalizeAnt`); fields cleared with `= undefined` instead of `delete`. One hidden class instead of 138. |
| Separation | The pair loop walks the packed spatial hash itself and drops the pairs `pairCb` would drop before touching them (itself, not taking part, the pair the other ant handles); an exact early out for pairs too far apart for any push or for either to be under the other; positions, teams, ids, states and foes read from typed arrays filled before the loop. Creature spacing computes each creature's radius, attack, push-through and team once a pass. |
| Spatial hash | Items packed cell by cell (in the lists' order, newest first) before the first query: every query reads consecutive memory, the same items in the same order. |
| Lookups | The hex under a point at once in the common case (well inside its column's nearest row, nearer than any centre beside it can be); the surface flow cache's least-recently-used order kept by a counter, not by re-inserting into the map on every look-up. |
| Worker frames | A column writer generated per schema (named loads: with one ant shape, monomorphic); key discovery tests the value before the map. The same packets byte for byte. |
| Ground and scenery | Drawn in culled chunks: the terrain heightfield (5 × 5, sharing one set of vertex attributes), the grass (5 × 5 instanced chunks, bounding spheres padded for lean and wind), the map-wide pebble sets and merged decor (`render/chunks.ts`, 5 × 5 of the map). The water draws, per camera, only the contiguous rows its camera can see (same index order: it is transparent). |
| Ant record | A class (`AntRecord`), not a literal: V8 keeps an object literal of 128 fields or more wholly outside the object, with a class per copy (this cost the full nests 20 % before it was found); always-set fields start as numbers. |
| Main-thread replica | New rows from a constructor generated per schema (fields inside the object; an empty literal grown field by field kept all but four outside). |
| Ant renderer | Its per-ant state in one literal (one hidden class instead of six). |
| Measuring | `tools/perf/*` (above); the benchmark's **gpu** scene; draw calls and triangles counted over the whole frame (Safari showed one call: the counters reset on every render call). |

### Measured: the simulation (build machine, bundled, best of 2 alternating runs, 300 ticks after 60; `main` 56be698)
| Scene | 1,000 ants: main → v3 (ms a tick) | 2,000 ants: main → v3 | ticks over 40 ms at 2,000 (of 300) |
|---|---|---|---|
| Big surface fight | 15.2 → **8.2** (−46 %) | 33.2 → **15.5** (−53 %) | 105 → 6 |
| Busy foraging economy | 12.2 → **10.9** (−11 %) | 21.8 → **16.3** (−25 %) | 25 → 16 |
| Full nests with brood and digging | 5.8 → **5.9** | 11.4 → **10.2** (−11 %) | 3 → 1 |
| Ten colonies | 12.9 → **10.7** (−17 %) | 18.6 → **13.4** (−28 %) | 7 → 7 |
| Titan raid into a full nest | 12.9 → **10.8** (−16 %) | 24.6 → **16.6** (−32 %) | 21 → 12 |
| Shared-underground tunnel fight | 6.1 → **5.7** (−5 %) | 13.1 → **11.5** (−12 %) | 5 → 1 |

Every run's canonical hash list equals `main`'s (same results). **Targets: under 15 ms at 1,000 — met in every scene
(5.7–10.9); under 25 ms at 2,000 — met in every scene (10.2–16.6). No spikes over 40 ms — not met at 2,000** (1–16 of
300 ticks in four scenes): in these scenes every ant was made on the same tick, so their one-second timers fire
together (the once-a-second ticks are about twice the others; in a real game ants hatch apart), and minor garbage
collections (about one a tick, 0.4 ms median, 9 ms at the 90th percentile) land on some of them. The user's laptop
runs the simulation about three times faster than this machine (5 ms a tick for the 821-ant fight against ~15 here).

### Measured: the graphics (what was drawn)
| | before (main) | v3 |
|---|---|---|
| Meadow Pond (the multiplayer map): grass | 1 mesh, 1.1 M triangles every frame | 25 culled chunks |
| Meadow Pond: pebble sets | 4 meshes, 310 k triangles, twice (shadows) | culled chunks, also in the shadow pass |
| Meadow Pond: water | 320 k triangles every frame | the rows in view |
| Every map: terrain | 1 mesh, ~300 k triangles every frame | 25 culled chunks |
| Golden set (`golden/compare-v3after.md`) | — | 11 of 11 match, 8 pixel for pixel; far shots 1–11 of 972,800 pixels where grass blades cross |

### Game speed and cutscenes (checked after the merge, when the user asked)
- **A cutscene builds nothing new.** The Antlered King's opening flight (the bench's **cine** scene, on this
  machine): no shader links and no texture uploads from its first frame to the camera's return (everything it shows was
  prepared at load); 86–92 draw calls and 420–440 k triangles. Its frame times wait for the devices' bench.
- **Game speed changes how many ticks a second the worker runs, not what a tick costs.** The fastest speed this
  machine's worker can hold (50 ms ÷ the tick times above): at 1,000 ants 4.6× (economy) to 8.8× (tunnel fight); at
  2,000 ants 3.0× (titan raid) to 4.9× (nests). The big fight at 2,000 went from 1.5× (`main` before v3) to 3.2×. The
  laptop's worker is about three times faster.
- **A device whose worker could not keep up:** single-player never piled up (at most 24 ticks waited), but each
  update then held up to 24 ticks (at 30 ms a tick, one update every 0.7 s: the paths drawn as long straight
  segments). Multiplayer and replays had no limit: each tick went to the worker as it came due, so an overloaded
  device's picture, and its player's orders, fell further behind every second (a simulated 4× match on a device at
  15 ms a tick: 2 s behind after 10 s, and growing).
- **Now** (`game/simHost.ts` `WORKER_LAG_MS`): single-player and replays keep at most about 100 ms of the worker's
  work queued. Single-player batches are smaller when the ticks are slow (24 ticks at up to 4 ms a tick, 6 at 15 ms,
  3 at 30 ms): about four times as many updates for a few per cent less speed (one frame packet a batch). A replay
  plays at the speed the device can do. A device that keeps up never reaches the limit, and the simulation computes
  the same ticks with the same commands.
- **Multiplayer is unchanged, for the user to decide.** In lockstep every device runs every tick, so a device that
  cannot keep up has only three ways to go: (1) as now, it falls behind (its picture and its orders later every
  second, the others unaffected); (2) the match waits for it, as it waits for a player's packets — the slowest device
  sets everyone's speed (tried and taken out: with it, `tests/browser/lan.py` lost the guest — dropped by the host after
  30 s of waiting — in 2 of 7 runs here, `main` in none of 4); (3) the slow device votes the speed down by itself (the
  vote already lowers the speed at once) with a message saying whose device could not keep up. (3) is the proposal.
- **The main thread at speed:** single-player gets one worker update a batch at any speed, so its message cost does
  not grow; the events of all the batch's ticks (hits, deaths, sounds, effects) do. Multiplayer sends every tick as its
  own update (lockstep). The **speed** scene measures both per frame on the devices.

### Not done, and why
- **Anything that changes the picture.** Both devices are limited by the GPU at High even in scenes with few ants (the
  laptop's menu-like scene with 38 ants: 35 FPS; the phone's: 22 FPS). In the big fight ~80 % of the triangles are
  the ants (mid-distance ants at 3,300 triangles, drawn for the picture and again for the shadow map). Cheaper shadow
  casters, a lower resolution or cheaper effects would change pixels: they wait for the **gpu** scene's report from
  the user's devices and the user's yes, with before/after pictures.
- **Ant transforms on the GPU.** The matrices are built in doubles on the CPU; built in the vertex shader they would
  be floats, and edges would move by a pixel here and there (the golden set's exact compare). The ant renderer is
  0.2–3.5 ms here; on the phone the ants' animation is 12 ms of a 36 ms frame — the motion controller (planted feet,
  springs), which a shader cannot keep across frames.
- **Only the viewed space at full rate.** Both minimaps draw ants of the other spaces every sixth frame and the fog
  of war gathers what every ant sees, so a lower rate for the other spaces would change what they show. The frames
  are cheaper instead (the generated writer; the reader's rows).
- **WASM or several workers**: not needed for the targets (and shared memory needs headers Pages cannot send).
- **Fewer garbage collections**: allocations are spread over many call sites (boxed numbers from small helpers,
  closures in a few callbacks); left for a later pass.

## Performance v4: draw only what's on screen, kill the lag spikes, smooth story (claude/performance/04-spec-performance-v4-on-screen-spikes-story.md, CHANGE_PLAN §34)

User decisions: areas nobody looks at are **not drawn or animated** — the simulation runs every ant and creature in
full, so results never change; the spikes are in normal play; story: camera flights and events. Every change below
keeps the pictures (golden set) and the simulation's results (`same.sh`, a 30-minute skirmish's hash, the story
playtest logs) exactly.

### How it is measured
- **`tools/perf/longRun.ts`** — a 30-minute skirmish as the menu builds it (four colonies on Meadow Pond, grown, wild
  creatures and titans on), the player's colony played by the AI or left alone (`idle`: its ants rest in the nest),
  trees on or off; every tick timed, the slow ticks with the systems that took the time and the full flow-field
  builds of that tick.
- **`tools/playtest-story.ts` `TICKS=1`** — the same for each chapter 1 level, played by the story bot.
- **`tests/browser/spike_session.py`** — normal play in the real page, every frame's main-thread parts and each
  surface renderer (and the view's own rebuilds: the ground, the water, the backdrop) timed on its own; `NORENDER=1`
  takes the GL draws out (SwiftShader draws on the CPU here) so the main thread's own work runs at full rate.
- **`tests/browser/story_flights.py`** — every level's opening flight, drawn: shader links, uploads, the main thread's
  work in its slowest frames.
- **`tests/browser/offscreen_work.py`** — counts every update of a plane not on screen (must be none).
- **Benchmark** (`?bench=1`): two new scenes, **trees** (the ground with the layer on, then up into the canopy) and
  **flood** (a flood's ten steps drawn); the devices' reports are the real numbers.

### What was found (build machine)
- **The simulation's spikes came from one place: a nest's flow-field cache thrashing.** A big nest (265 × 282 cells)
  with ~100 ants resting in it needs ~70 fields at once (one per rest hex); the cache held 64 and, least recently used
  first, threw out exactly the fields the next ants needed: 60–77 full builds a tick, each a Dijkstra over 75,000
  cells on a binary heap. *Spider Mother* at 22.7 min: 231 ticks over 40 ms in a row (50–91 ms); a 30-minute skirmish:
  3–14 ticks over 40 ms (the Atta nest). The rest of the simulation is light in natural games (1.3–1.7 ms a tick on
  average; story levels 0.5–1.3) and garbage collection in the worker is short (major collections 1–5 ms).
- **The trees layer adds nothing to the simulation** while no ant is up there (stress scenes and a 20-minute skirmish
  from before the trees merge against after: the same cost), and the trees are only on with a tree colony, the
  sandbox's toggle or the dev URL. The spikes of normal play were older than the layer.
- **Main thread, normal play** (Meadow Pond, four colonies, `NORENDER`): the 70–130 ms frames were **anthill rebuilds**
  — a colony's anthill rebuilt whole on the frame its look changes (it grows a size step, digs, a hole caves in):
  26–134 ms here (the red wood ants' thatch the most), and the rebuilt mesh could need a shader program the pre-warm
  never made (the one link caught in play). Next, **off-screen nests kept current**: a nest mesh slice meant to cost
  3 ms was a whole signed-distance pass or a chunk of 20–30 ms here — 80–130 frames a minute over 8 ms.
- **Story events: floods.** Each flood step (five up, five down) rebuilt the water mesh (35–175 ms: 25 look-ups a
  vertex), recomputed every ground field (160–400 ms: the wet band needs the water, the rest did not) and the
  terrain's water (6–49 ms: every sample of every water shape tested against its outline again) — 200–250 ms frames
  in High Water and Carton Kingdom. The **camera flights** compile nothing (no shader link in any of the seven) but
  ran over anthill rebuilds and off-screen nest slices (the slowest frames of four of them).
- The HUD wrote its DOM every frame (the marker panel's stance button, the ability tip) and read counters back with
  `innerHTML`; Chrome's `performance.memory` (~0.25 ms a read) was read every frame by the profiler.

### What changed
| Where | What (the same results, the same pictures) |
|---|---|
| Nest fields (`sim/flow.ts`) | Full builds on a bucket queue: steps cost (c₁ + c₂)/32 with whole cell costs, so a ring of 129 buckets of whole units replaces the heap; shortest distances are unique, so the fields are the heap's bit for bit (checked against a plain Dijkstra). The cache keeps every field used on the tick (past 64, up to 32 MB) and shrinks back once idle. |
| Anthills (`entranceModels.ts`) | The build is a generator (a step every 32 pieces and between big pieces); a changed anthill is built ~3 ms a frame from a copy of the colony, its programs compiled ahead (`compileAsync`), then swapped in whole. The first build and a fire-ant dome change stay at once. Pellets cloned from a plain geometry (cloning an IcosahedronGeometry rebuilt a polyhedron). Byte-identical meshes. |
| Off screen (`session.ts`, `view.ts`) | No mesh, tile or effect upload for planes not shown (effects keep their clocks). The area a dive or cut leads into is brought up to date while the fade hides the frame; the fade waits (at most 1.5 s) until it has caught up. The shown nest's mesh after digging in three steps (signed distance, maps, chunks). |
| Minimaps | Every 15th frame (4 a second) and only while on screen. |
| Trees' backdrop | Forced on entering the trees (under the fade); else every 30 s, a quadrant a frame, 256² (it is blurred). |
| Floods (`water.ts`, `terrain.ts`, `terrainMesh.ts`) | The water mesh's 5 × 5 maximum taken separably (checked against `waterAt`'s own rounding), ground heights cached; each water shape's inside mask kept; the ground fields split by what they depend on, and a water-only change rewrites and uploads only the two channels that depend on water. Byte-identical attributes. |
| HUD | Marker panel every third frame; DOM written only when it changes, compared with the last write. |
| Profiler | `performance.memory` every tenth frame and on slow ones. |
| Benchmark | Scenes **trees** and **flood**. |

### Measured
**Simulation** (bundled; the same results throughout):

| | before (`main`) | v4 |
|---|---|---|
| *Spider Mother* to 23 min (story bot) | 231 ticks over 40 ms (50–91 ms at 22.7 min), p99 21 ms | **0**, p99 4.0 ms, the slowest 29 ms |
| 30-minute skirmish, player idle (`longRun`) | 3–14 ticks over 40 ms, the slowest 47–62 ms, p99 11.9 | **0**, the slowest 22.5 ms, p99 8.6 |
| Stress scenes at 1,000 ants | economy 2 of 300 over 40 ms | economy, nests, ten, titan, tunnel 0; the fight 0–4 (as `main` on this machine: the stress scene's synchronised one-second ticks) |

**Main thread, normal play** (`spike_session.py NORENDER=1`, 60 s, Meadow Pond, four colonies; this machine is slower
than the laptop):

| | before | v4 |
|---|---|---|
| trees off: average, the worst frame, frames over 33 ms | 2.5 ms, 130 ms, 1 | **1.1 ms, 10 ms, 0** |
| trees on | 3.0 ms, 118 ms, 3 | **1.2 ms, 10 ms, 0** |
| sandbox, trees on | — | 1.1 ms, 13 ms, 0 |
| an anthill rebuild (four forced at once) | frames of 26–134 ms | at most 14 ms |
| flood step: water mesh / ground / terrain water | 35–175 / 160–400 / 6–49 ms, on one frame | 10–25 / 10–45 / 0.4–12 ms, on two frames |
| High Water at 4×, 120 s: frames over 33 ms | 1 (245 ms: the flood's ground and water) | 0 (the worst 12 ms) |
| Carton Kingdom at 4×, 120 s | 2 (198 ms, 45 ms) | 0 (the worst 15 ms) |
| shader programs compiled in 150 s of play / on entering the trees | 1 (an anthill's details) / 5 | **0 / 0** |

**Off screen** (`offscreen_work.py`): 30 s on the ground with the trees on, then 30 s in the home nest — **0** updates of
any plane not shown (nest views, tiles, meshes, the canopy, the backdrop, effects to the GPU, the ground's ants and
anthills). **Switching** after 45 s away (`switch_after_away.py`): the swap waits 0–0.6 s here while the area catches
up; the frames over 33 ms of that work fall while the fade covers the screen.

**Story flights** (`story_flights.py`, each level's opening flight drawn; the main thread's own work, without the
drawing that SwiftShader does on the CPU here): no shader link in any flight, before or after; the slowest frame, main
→ v4: The Garden Below 84 → 16 ms, The Long Nights 27 → 13, Fire on the Banks 47 → 13, The Spider Mother 8 → 14, The
Antlered King 16 → 17, High Water 40 → 11, Carton Kingdom 24 → 11 (what ran during the flights: anthill rebuilds and
off-screen nest slices).

**Golden set** (`golden/compare-v4after.md`): 17 of 17 match — 16 pixel for pixel; the flood shot differs by at most 1
level in 20 % of its pixels, as two renders of `main` differ from each other (run-to-run noise).

### Not done, and why
- **Spreading story events' spawns over ticks**: their ticks are light (0.5–1.3 ms on average, the slowest 15–38 ms,
  none over 40 ms) and it would change the simulation's results.
- **The stress scenes' synchronised one-second ticks**: every ant there is made on the same tick; changing when the
  timers fire changes results. In natural games they are spread (no tick over 40 ms in 30 minutes).
- **Anything that changes the picture** (v3's list: the devices are limited by the GPU at High) — waits for the user.
- **Multiplayer at high speed on a slow device** (handoff 25) — the user's choice.
- **The wet band's recomputation** after a flood step (a distance pass over the whole grid, 10–45 ms here): only its
  region could be redone, but its distances reach across the map; a step is now on its own frame.
## Performance v5: nonstop until smooth, underground first (claude/performance/05-spec-performance-v5-nonstop.md, CHANGE_PLAN §35)

The user's `?bench=1` on a Mac after v4 (`docs/performance/bench-mac-2026-11-09.md`; Safari 26.5, Apple GPU, Retina at
2×, High, Low Power Mode): the full nest at 2.6 FPS, switching worse in later rounds, the big fight falling behind
real time, GPU-bound everywhere, 8 million triangles in the arena, 28 s pre-warms and 8–12 s first frames, and effect
toggles that recompiled everything. User decisions: Retina at 1.5× with sharpening if it looks the same ("Full
sharpness" keeps 2×); the 30 FPS cap is Low Power Mode; everything else keeps the golden set and the simulation's
results.

### On the user's devices
- **2026-11-09, Mac (before v5)** — the whole report: `docs/performance/bench-mac-2026-11-09.md`. Every scene's
  display interval was 33.3 ms: Low Power Mode holds Safari to 30 frames a second, so no scene could show more than
  30 and the savings of the effect steps are understated.

### How it is measured (v5's tools)
- **The benchmark, made trustworthy** (`dev/bench.ts`): each heavy scene (feel, fight, nest, arena, mp4, trees, story)
  ends with the **GPU pass by pass** (`dev/gpuBreakdown.ts`: `gl.finish` after each pass — the shadow maps, the scene,
  ambient occlusion, depth of field and grade, bloom, the last pass — Safari has no GPU timer queries; draws are not
  waited one by one, which would end an Apple GPU's render pass each time, so their **triangles are counted by what is
  drawn** instead); the **longest frames** with their causes (the report listed the first eight, which hid the
  multi-second ones); **the UI's pieces** (`prof.sub`: marker panel, minimaps, top bar, labels…); **GPU memory split**
  into textures, render buffers and buffers; **the display's rate** measured on the start screen while it is idle
  (`core/display.ts`: "display 30 Hz — Low Power Mode?", also in F3, and frames are counted against it); the effect
  steps compile nothing ("shadow maps not redrawn" instead of shadows off, which recompiled every material twice — the
  83 links; "post effects off" draws the scene into its own target and tone maps, the same programs; the longest frame
  of each step and its cause); the speed steps settle for at least 8 frames and measure at least 15 (one 12-second
  frame took a whole step before), with the simulation's frames counted; the switching scene lists the steps with the
  longest frames and the renderer's counts after every round; the stress scenes run without the F3 overlay (its
  hitboxes and climb rails of every ant were rebuilt and drawn each frame).
- **Build machine** (SwiftShader, two cores; the GPU's times do not carry over, the counts do):
  `scratchpad` probes kept in the repo as `tests/browser/spike_session.py NEST=1` (the full nest's main thread).

### What was found
- **Underground, every frame**: the ants' body-offset textures (one 512 × 2 float texture per model and level of
  detail: three a frame in the full nest, four to eight in the arena) were rewritten and uploaded when the shadow pass
  first drew them. Safari draws WebGL through ANGLE's Metal backend, where a texture written while the GPU may still be
  reading it either waits for the GPU (`replaceRegion` on a texture in use: the command buffer is flushed and the CPU
  waits) or copies through a staging buffer and a blit, which ends the render pass being recorded (its attachments
  stored and loaded back). The report's frames were slower the more of them there were (87–97 ms with three, 120–138
  ms with six or seven). A nest's soil, light and hex maps did the same after every dig (0.6 MB).
- **The nest's shadow map covered the whole nest** (its key light is fixed): every chunk of ground was drawn into it
  every frame — 598,000 of the full nest's 1.29 million triangles (the view itself: 115,000).
- **The shown nest's mesh after digging** had a 40 ms budget a frame: a nest dug in many places rebuilt 16–21 chunks,
  33–41 ms, on one frame (build machine).
- **The nest's ground shader** computes the floor, the walls and the soil top, every pattern of each, for every pixel
  (it sums the bumps of all of them, so skipping the ones a pixel does not show would change the picture): at 2× on a
  Retina screen, 4.8 million pixels of it. The effects (ambient occlusion, depth of field, bloom) are full-screen
  passes at the same resolution.
- **The pre-warm compiled two variants of every program** — `renderer.compile` with no target set compiles the
  variant for drawing straight to the screen (tone mapped, sRGB), never used while the effects are on, and then the
  draw into a target compiled the other — and drew into a one-sample target while play draws into a four-sample one,
  so the GPU's pipelines for every draw were made again on the first real frame (the 8–12 s frames after loading).
  On the build machine: 167 programs after the pre-warm → 99, the pre-warm 13.8 → 8.8 s (a two-colony game, High).
- **The speed stall** (0.05× at 1×, then no frame from the simulation for ~12 s at 2× and 4×, then 0.19× at 8×):
  warm, the same scene has no tick over 0.2 s (Node), but its first 60 ticks run 60–160 ms each while the engine
  compiles the simulation, and the worker's first batch — before it had reported a tick time — was 24 ticks. On a
  cold engine in Safari (many times slower than V8 warm) that is seconds with nothing coming back, the game's
  picture standing still (msg 0, the clock not moving). Hit-stops (each 33–80 ms off the clock with no limit) are
  not it — the big fight has none in its first minute — but they could have added up, so they are guarded too.
- **The benchmark's toggles**: "shadows off" set `needsUpdate` on every material (twice: 83 shader links and seconds
  of stalls in Safari); "post effects off" drew to the screen, which needs every material's screen variant; the stress
  scenes had the F3 overlay open, which rebuilt and drew every ant's hitbox and climb rails each frame.
- **GPU memory "rising across scenes"** is each scene's own content (every scene is its own page load). What the
  scenes hold: four-sample HDR targets at 2× (≈ 230 MB of render buffers and 130 MB of resolve and effect targets at
  2940 × 1620), a 16 MB shadow map and a 6 MB environment map for every underground area, textures and buffers.
- **The arena's 8 million triangles** are ~300 ants at their closest model (25,000 triangles; the next is 3,300):
  at 2× a body 70 device pixels long gets the closest model, and the arena's camera is close.
- **The UI**: the area tabs set a CSS custom property on every tab every frame (a restyle a frame); the minimaps read
  their box's size each update after the frame's style writes (a layout), uploaded the whole nest raster with
  `putImageData` each update and built it with three arrays a pixel; tile labels read `innerHTML` back each frame.

### What changed (round 1; the same pictures and the same results unless said)
| Where | What |
|---|---|
| Changing textures (`render/dynamicTextures.ts`, `antRenderer.ts`, `nestTerrain.ts`) | A **ring of three** textures over one data array: each change goes to the next one, which the GPU finished with frames ago, and every changed texture is uploaded **before the frame's first render pass** (`uploadPendingTextures`). The ants' body offsets and glue shells, a nest's soil, light, hex and tint maps; the canopy's and the pheromone overlay's textures uploaded early too. |
| The nest's shadow map (`view.ts shadowCasterBox`, `nestTerrain.cullShadowCasters`) | Only the chunks that can shadow a pixel on screen cast: the ground the camera sees from the floor to the walls' top, widened toward the light by that height and by the shadow lookup's reach (normal offset, filter). Exact: 598k → 131k shadow triangles in the full nest; the golden nest shots pixel for pixel. |
| The shown nest's mesh after a dig (`view.ts NEST_MESH_MS`) | 5 ms of chunks a frame (was 40). |
| One shadow map and one environment map for every underground area and the trees (`view.shareAreaShadows`, `environment.ts`) | Only one is drawn in a frame and its map is redrawn every frame: 16 MB (High) and ~6 MB kept per area before. |
| Loading (`render/prewarm.ts`, `session.prewarm`, `post.warm`) | The pre-warm sets a target made like the scene's (HDR, four samples, a depth texture) before it compiles, so it compiles and draws exactly the variants play draws; every post pass drawn once; a rebuilt anthill's programs compiled for that target too. |
| The simulation's start (`game/simHost.ts`, `worker/warmUp.ts`) | The worker's first batch is 2 ticks until it has reported a tick time (was 24); before its first real tick it runs a few ticks on a throwaway copy of the world so the engine has compiled the simulation (at most 40 ticks or 1.2 s, stopping once a tick runs at half the first one's time). The real world's results are the same (`tests/performance.ts`; the fight and a skirmish, every hash equal over 600 ticks). |
| The nests' lights (`environment.ts`) | Four point lights at intensity 0, never lit by anything, removed: every pixel of every material in a nest computed all four. |
| Hit-stops (`core/loop.ts`) | A guard: one holding is lengthened to at most its own length, and after one the next waits nine times its length (at most a tenth of the time held). |
| Retina at High (`view.ts retinaScale`, `post.ts upscalePass`, Graphics → Sharpness) | **The user's decision**: the effects at 1.5 device pixels a screen pixel, the canvas at 2, the last pass upscaling with a Catmull-Rom filter (dynamic resolution then resizes only the effects' targets, not the canvas). The bloom's mips stay sized from the canvas (its kernels are in pixels: at 1.5× its glows came out a third larger) and nothing is sharpened before the bloom (a sharpened bright point bloomed into a big glow). The ants' detail is picked by the canvas's pixels, as at 2×. "Full sharpness" keeps 2×. The golden shots at 2× and at 1.5× are below. |
| UI (`ui/areaTabs.ts`, `ui/minimaps.ts`, `ui/gameUI.ts`) | Styles written only on change; the minimaps' box measured after a resize (or every 2 s); the nest raster kept in a canvas, built without allocating; a dot's colour set only when it changes; tile labels compared with what was written. |

### Measured (build machine; the Mac's report is the real test)
| | before (`main`) | v5 round 1 |
|---|---|---|
| Full nest: triangles a frame (shadow pass's ground) | 1.29 M (598 k) | 0.84 M (131 k) |
| Full nest: draw calls | 132 | 69 |
| Full nest: textures written each frame while possibly in use | 3 (more after digs) | 0 (rings, uploaded before the passes) |
| Programs after the pre-warm (two colonies, High) | 167 | 99 |
| Pre-warm (the same game) | 13.8 s | 8.8 s |
| Golden set | — | 17 of 17 (16 pixel for pixel; the flood shot within its noise) |
| `same.sh` (18 runs) | — | ALL SAME (no simulation code changed) |

### Resolution: 2× against 1.5× (the user's decision, made with pictures)
The golden shots rendered at two device pixels a screen pixel (`tests/browser/golden.py DPR=2`), once at full
sharpness and once with the effects at 1.5× and the last pass upscaling (`EXTRA=&res15=1`); `res_sheet` crops
(2× | 1.5× | difference ×4) of each shot's busiest regions. The ants' level of detail stays picked by the canvas's
pixels (a first try picked it by the pixels drawn: an ant's model then changed with the resolution, and its effects
with it — not the user's decision).

| Shot (DPR 2) | SSIM, full size | SSIM at viewing size (halved) | mean difference (of 255) |
|---|---|---|---|
| fight | 0.976 | 0.990 | 1.8 |
| fight_termites | 0.992 | 0.995 | 1.2 |
| map_meadowPond_close | 0.997 | 0.998 | 0.7 |
| story_day | 0.992 | 0.996 | 0.6 |
| nest_home_meadowPond | 0.866 | 0.910 | 2.6 |

The surface is the same at viewing size (ants in the same places, edges as sharp); the nest's fine grain and the
larvae's highlights are a little softer up close. Graphics → Sharpness → Full sharpness keeps 2×.

**Round 2, the upscale's black rings**: Catmull-Rom's negative lobes next to a very bright HDR pixel (a larva's
highlight) went below zero — a black ring inside the glow. Each result is now kept within its 2 × 2 nearest texels'
range (as FSR's upscaler does), which leaves edges as sharp; the table above is from the fixed upscale.

### Not done yet, and why
- **The arena's triangles** (8 M at 2×: ~300 ants at the closest model) — the same rule as the game; fewer would be a
  different model on screen: an option for the user with pictures.
- **The nest's ground shader** (every pattern of every layer, every pixel): skipping what a pixel does not show would
  change the bump of every pixel (the bumps of all the layers are summed) — an option with pictures.
- **The switching "growth"** was the report's arithmetic (round 2): the v4 line set the first round against the nine
  later rounds summed — "first 19, later 183" is about 20 a round. The report now counts a round. The few
  multi-second frames on a switch (2.6 s, 4.2 s, all "outside this thread") are real and not reproduced here: the next
  report's worst steps and causes say which.
- **The UI's 44 ms frame** (the full nest's first second): not reproduced here; the bench now lists the UI's pieces.
