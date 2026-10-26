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
