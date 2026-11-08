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
