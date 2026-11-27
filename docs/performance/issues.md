# Performance issue list (performance v7)

Every lag or freeze found, where it is, what it costs, how to reproduce it, and its status. Spec:
`claude/performance/07-spec-performance-v7-find-and-fix-everything.md` (CHANGE_PLAN §39). Measured on the build
machine (2 cores, SwiftShader: absolute frame times are slow, so causes and counters are what it reads) until the
user's Lag Hunt reports come in from the Mac and the iPhone/iPad.

Status: **open**, **fixed** (with the before/after), **watch** (measured, under budget here; the device reports decide),
**user** (only a change to the picture or the gameplay would fix it: waiting for the user's choice).

## Found before v7 (v1–v6, for the record)
| # | issue | where | cost | status |
|---|---|---|---|---|
| 1 | The arena's spawn built each new species' models in the frame its first ant was drawn | `game/session.ts spawnableMorphs` | 4.8 s here (4.1 s on the user's Mac) | fixed v6 (37 ms) |
| 2 | A shadow program linked in play (three's shared depth material, draw-order dependent) | `render/prewarm.ts shadowTwins` | 2.5–6.4 s here | fixed v6 |
| 3 | Boss wind-ups compiled their shaders at every wind-up (materials disposed, program released) | `render/game/combatFx.ts` | a compile a wind-up | fixed v6 |
| 4 | The Mac is GPU-bound at Retina: frames 40–180 ms with the main thread at 2–17 ms (bench 2026-11-09) | the whole picture | 20–25 FPS in normal play | user (v5: resolution and effects options shown) — re-measure with the Lag Hunt |

## v7
| # | issue | where | cost | how to reproduce | status |
|---|---|---|---|---|---|
| 5 | The simulation in the arena at its largest (300 a side) | `sim/guardLine.ts holdGuardLine`, `sim/antAI.ts`, `sim/markers.ts nearestWalkable` | tick mean 3–4.4 ms, worst 26 ms here at 600 units (Saiy-Ant soldiers v fire majors the heaviest: +40 % on fire v fire); ≤ 10 ms at 100 a side | `npx vite-node tools/perf/arenaStress.ts -- saiy 50,100,300` | watch (under the 50 ms a tick here; the Lag Hunt's "kept up" says on the devices) |
| 6 | **Saiy-Ants cost about 1.6× an ordinary ant to draw at middle distance** (the model drawn for an ant 9–70 px long — most ants in a match): their six hair locks are 1.9k of that model's 5.1k triangles (other species' whole models 3.2–3.7k), three strands a lock 1.1k of them, mostly thinner than a pixel there. Close up (+14 %) and far away (impostors) they cost as others do. The shadow pass likewise (+50 %). | `render/ants/saiyHair.ts` (`MID_STRANDS`), the middle-distance model | 60 ants at 120 mm, ant draws waited for: Saiy-Ant workers 1191 ms (20.2 ms an ant), fire majors (the same 6 mm) 744 ms (12.4), garden-ant soldiers 12.3, leafcutter mediae (8 mm) 14.2, Saiy-Ant soldiers (9 mm) 30.2; shadows 380 v 249 ms (build machine, SwiftShader) | `GPU=1 tests/browser/species_cost_probe.py` | user (fewer strands on the middle-distance model changes the hair's look there: before/after pictures for the user) |
