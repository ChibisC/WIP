# New surface maps — design (step 2)

Status: draft for review, 2026-10-26. Brief: `docs/maps/brief.md`. Survey of today's code: `DESIGN.md` 3.14.

The five maps are an **addition** to the terrain code, not a rewrite: the procedural styles stay for tests, tools and old saves (about 60 test worlds and every browser script depend on them), but the menus, the lobby and the missions offer only the five maps (plus the formicarium floor for the arena).

---

## 1. Units and the surface hex grid

- **Shared geometry.** The nest's hex maths moves out of `NestGrid` into a small `HexLayout` (`src/world/hexLayout.ts`): flat-top hexes, odd-q offset (odd columns shifted down), index `q = r·cols + c`, circumradius `R`, row spacing `H = √3·R`, column spacing `C = 1.5·R`, `hexCenter`, `hexAt` (allocation-free), `neighbors` (NE, SE, S, SW, NW, N), `hexDistance`, plus the helpers the maps need: `ring(q, k)`, `disk(q, k)`, `line(a, b)` and `round(x, y)`. `NestGrid` keeps its soil raster and digging and uses `HexLayout` for the geometry (its behaviour and saves unchanged; covered by the existing tests). The nest's GLSL copy (`render/nest/nestTerrain.ts`) is reused for the surface overlay.
- **Surface hex size: R = 8 mm** (14 mm across the flats). A 1,600 mm map is 133 × 115 = 15.3 k hexes. A mound footprint of a hex and its ring (7 hexes) is ~40 mm across, which holds the largest fire-ant mound today (radius 15–31 mm); the site's dry area (footprint + 2 rings, 37 hexes) is ~90 mm across.
- **Hexes never show** in normal play. The heightfield, cover, grass and water edges stay smooth; the hex layout is the authority for rules only (see §3). A debug overlay (`H` in dev builds, always on in the editor) draws hexes coloured by type.

## 2. The map file

Each map is a TypeScript module, `src/maps/<id>.ts`, exporting a `MapDef` (typed, diffable, bundled; the editor exports the same shape):

```ts
interface MapDef {
  id: 'meadowPond' | 'forestFloor' | 'riverbank' | 'rainforest' | 'savanna';
  name: string; blurb: string; biome: Biome;          // biome picks cover, grass, props, sound
  width: number; depth: number;                         // mm
  hexR: number;                                         // 8
  relief: { amp: number; scale: number };               // the seeded fbm under everything (small)
  brushes: HeightBrush[];                               // hills, hollows, banks, channels (mm, smooth falloff)
  water: WaterBody[];                                   // pond / stream / puddle / pool: polygon or polyline+width, depth
  walkways: Walkway[];                                  // hex paths across water: kind stone | leaf | rootMat | moss
  walls: Wall[];                                        // kind log | rock | trunk | buttress | mushrooms | pineCone | stone; capsule/polyline/blob footprint + look params
  sites: Site[];                                        // exactly 10
  siteSets: { 2: number[][]; 3: number[][]; 4: number[][]; 10: number[] };
  zones: Zone[];                                        // food | aphid | plant | lair | creature | noSpawn: polygon or hex list, weight
  floods: FloodZone[];                                  // polygon/hex list, depth order, timing range
  lighting: LightingPreset; ambience: AmbiencePreset;
  overrides?: [q: number, type: HexType][];             // sparse per-hex paint from the editor, applied last
}
interface Site { centre: [c: number, r: number]; footprint: 1 | 2; entrances: [c: number, r: number][] /* 1–3 */; facing?: number }
```

**Rasteriser** (`src/maps/raster.ts`, pure and deterministic, sim side): `MapDef + seed → SurfaceLayout` with one byte of **type** per hex (`ground`, `water`, `walkway`, `wall`) and one byte of **flags** (`shore`, `siteFootprint`, `siteRing`, `entrance`, `lair`, `food`, `aphid`, `plant`, `creature`, `noSpawn`) plus a **flood-zone id** per hex. It also turns brushes and water bodies into the terrain's height ops. Only geometry from the file and integer hex maths are used, and `dmath` where trigonometry is needed, so every client gets the same bytes; a **map hash** (FNV-1a over the layout) is checked by the validator and logged in the lobby.

The seed varies only detail: grass and decoration scatter, food item positions inside food zones, small colour variation, creature wander. Layout, water, walls, sites and lanes never change between matches.

## 3. Passability, water, walkways, walls

- **One rule for everything that moves:** a point is walkable if its hex is `ground` or `walkway` (or a dry flood hex, §5), not off the map, and not blocked by the few small blocking props that stay (mushroom stems). `Terrain.passable` reads the layout when a map is loaded; procedural styles keep today's rule. Ants, creatures, separation, food, aphids, plants, lairs and markers all go through it already.
- **Water hexes** are impassable. The heightfield is carved under them (a smooth basin from the body's shape, not hex-shaped) and filled to the body's level, so the visible waterline sits 2–4 mm inside the water hexes: ants stop on a wet, dark mud margin, never visibly on water. Shore hexes (land next to water) get wet cover.
- **Walkways** are hex paths at least 2 hexes wide, flat at the water level, rendered as one natural object each (a flat stone run, a floating leaf, a root mat, a moss bridge) lying flat; no climbing and no walk-height bumps. Army-ant living bridges keep working (they read the same water test).
- **Walls** (logs, rocks, trunks, buttress roots, mushroom clusters, pine cones, stones) are authored footprints rasterised to `wall` hexes, at least 2 hexes thick where ants pass by. They block everything. Their meshes are procedural (bark, moss, lichen, fungus, cracks, beetle holes, dew, litter heaped at the base) and shaped to the hex union with soft edges. **No climbable props** on the maps: pebbles, twigs, seeds, petals and grass are render-only decoration and stop raising walk height.
- **Flow fields** (`SurfaceFlow`, 8 mm cells) sample the layout, get a corner-cut check (no diagonal slips through a one-cell gap) and an LRU cap on cached fields; a target in water is moved to the nearest walkable cell.
- **Markers** dropped in water (by a player or an AI) snap to the nearest walkable shore hex in `placeMarker`: a fixed ring scan from the hex, ties broken by hex index, no random numbers.

## 4. Ten anthill sites

- **A site** is a centre hex, a footprint (radius 1: 7 hexes, or radius 2: 19 hexes) and 1–3 entrance hexes on or just outside the footprint. A colony placed on a site gets `ColonySpec.at` at the centre and its starting entrances at the entrance hexes; the nest's entrance tunnel is dug toward the matching side. Shafts dug later open on the surface inside the site's dry area (the mapping is scaled and clamped to the footprint + ring, instead of today's unchecked × 0.6).
- **Hard rules** (checked at load in dev builds, by the validator, and in `npm test`): footprint + 2-hex ring dry, walkable, flat within a set slope, never in a flood zone; ≥ 6 hexes from water and shore; ≥ 4 from walls and lairs; ≥ 12 from any other site (centre to centre ≥ ~170 mm); no entrance next to water; every entrance reaches every other site and every main food zone by land, also while each flood zone is flooded.
- **Site sets** are stored per map for 2, 3 and 4 players and one set of all 10. They are chosen by hand from the map's symmetry and checked by a tool (`tools/map-balance.ts`) that measures, for each site, land-path distances (the flow field) to the nearest food zones, water crossings, lairs and the other sites in its set; the spread inside a set must stay under 15 %.
- **Match setup:** the player picks a map and (optionally) a site set; colonies (players first, then AI rivals, up to 10 in all; 4 humans at most online) fill the set's sites in order, rotated by the seed for single player. Unused sites are bare ground with a small abandoned mound and a little food.

## 5. Floods

- Maps with flood zones schedule rain storms or rising water from the seed and the map's timing ranges (e.g. Meadow Pond: first storm at 9–13 min, then every 10–16 min). State lives in the simulation (`w.s.flood`: zone, phase, time), so it is deterministic, saved and replayed. A match setting turns floods off (default on).
- **Phases:** warning 25 s (the sky darkens, thunder rumbles, a timer icon on the minimap and the zone outlined on it) → rising 10 s (the zone's hexes turn to water lowest first, by a depth order stored in the file) → holding 40–90 s → draining 20 s.
- **Effects:** ants and walking creatures on a flooded hex take drowning damage over time and head for the nearest dry hex (a shared "dry land" flow field rebuilt once per phase); food on flooded hexes floats off and is destroyed; markers inside the zone stay but groups wait at its edge. Sites and their rings are never in flood zones; underground nests are not affected.
- **Rendering:** the water level of the zone's basin animates; the water mesh is per body (and per flood zone), so a flood rebuilds only its own patch.

## 6. Rendering at 1,400–1,800 mm

- **Terrain** keeps a 2 mm heightfield for procedural styles; the maps use **4 mm** (passability comes from the hex layout, so the finer grid is not needed): 3.6 MB at 1,800 mm instead of 14.6 MB.
- **Chunking:** the terrain mesh, grass and decoration are built in 200 mm chunks with frustum culling and two LODs; water meshes cover only each body's bounding box. Shadows follow the camera (the ±600 mm clamp becomes a camera-centred box).
- **Look per map** (`LightingPreset`): sun angle and colour, sky, fog density (thinner than today on the big maps: ~40 % at full zoom-out), dappled light and shafts (forest, rainforest), haze, dew in the morning, rain. Day and night presets per map.
- **Ambient life** (render-only, non-blocking): drifting seeds and petals, gnats, butterflies, water striders and rings on the water, frogs at the pond, dragonflies, bird shadows.
- **Ants' trails** darken the ground cover where traffic is heavy (render-only, from the pheromone fields).

## 7. Menus, lobby, missions, saves

- **Menus:** skirmish and sandbox show five map cards (name, blurb, size, number of sites, floods); a site set picker (Auto or a set); AI rivals up to 9. The arena keeps the formicarium floor.
- **Lobby:** `LobbySettings` gets `map`, `siteSet`, `floods`, `ai`; the start message still carries the `GameSetup`, but terrain comes from the map id + seed, never from serialized terrain. `BUILD_ID` bumps.
- **Missions:** *A Meadow Kingdom* plays on Meadow Pond (player on a fixed site, bosses spawned at a land-path distance), *Forest Floor* on Forest Floor (player and rival on fixed sites). Mission text is updated to the places.
- **Saves and replays:** `TerrainParams.map` (absent = procedural); `SaveHeader.map` for the save list; `SimState.version` 3 with a migration (old saves load as their procedural style).
- **Area tabs:** up to 8 tabs today; with 10 colonies a player sees their own nest, allies, and the enemy nests their ants are in, in that order, up to 8.
- **Minimap:** draws water, walls, sites and flood warnings, and re-bakes when the water changes.

## 8. The editor and the validator

- **Editor** (dev only, `?mapedit=<id>`): the hex overlay, paint hex types and flags, move sites and entrances, place walkways, run the validator live, export the `MapDef` (TypeScript) to download.
- **Validator** (`tools/validate-maps.ts`, and `tests/maps.ts` in `npm test`): the site rules, connectivity (also during each flood), no entrance near water, flood zones away from sites, every map's hash stable across two builds from the same seed, and 50 seeded matches per map with different site sets (setup only: placement, entrances, food zones).

## 9. The five maps (concepts; the layouts are drawn in the editor and shown with the hex overlay before the art pass)

| Map | Size (mm) | Water and crossings | Walls and lanes | Flood | Play pattern |
|---|---|---|---|---|---|
| **Meadow Pond** | 1,600 × 1,600 | A central pond (~420 mm) with lily pads and reeds; two flat-stone crossings on opposite sides | Stones and a few rocks break the open meadow into wide lanes; flower stems rich in aphids near the pond | Storms flood the low grass ring round the pond | Sites in two rings of five round the pond; the fight is for the pond's food and aphids; crossings are shortcuts |
| **Forest Floor** | 1,600 × 1,600 | A small trickling stream across one third, root-mat crossings | Fallen logs and rocks form lanes and chokepoints; mushrooms; spider and beetle lairs in hollows | Hollows flood after rain | Dim, dappled; lanes and flanks matter more than distance |
| **Riverbank** | 1,800 × 1,400 | A winding stream from one short edge to the other, off-centre, sandy and pebbly banks, reed beds; stepping stones and a fallen-leaf raft | Driftwood and stones on the banks | The stream rises after rain over its mud margins | Six sites on the high bank, four on the low one; washed-up food along the banks |
| **Rainforest** | 1,500 × 1,500 | Many puddles and rain pools; leaf crossings | Buttress roots radiate from two giant trunks (walls) into lanes; giant fallen leaves | Frequent short showers flood small hollows | Dense, humid, fruit falls; good for army ants and termites |
| **Savanna** | 1,800 × 1,800 | A seasonal waterhole that grows in a storm and shrinks after | Scattered termite mounds (walls; some neutral termite colonies as an option), acacia litter, cracked earth | The waterhole floods its flat margin during the storm event | Wide and open, long sight lines; seed patches as food zones |

## 10. Work order (each step committed; the game stays playable at every commit)

1. ~~Survey~~ (done: DESIGN 3.14).
2. This design (review with the user).
3. **Infrastructure:** `HexLayout` (nest unchanged, tests), `MapDef` types, the rasteriser and map hash, terrain from a map (4 mm, heights, water bodies, walkways, walls, passability), placement on sites with entrances, shaft clamping, marker shore snap, flow-field corner cut and LRU, the validator with a small test map, `?map=` launch.
4. **Meadow Pond end to end:** layout in the editor, validator clean, art pass (water, shore, walls, walkways, decoration, lighting), screenshots for review.
5. Forest Floor, Riverbank, Rainforest, Savanna.
6. Floods, the editor's export, menus and lobby, missions, minimap, area tabs, saves.
7. Verify (the brief's checklist), performance on the largest map with 10 colonies, docs (`docs/maps/` sketches and screenshots, DESIGN, README, PROGRESS).

## 11. Decisions to confirm

1. The procedural styles stay in the code (tests, tools, old saves) but leave the menus.
2. Surface hex R = 8 mm (mound footprint 7 hexes ≈ 40 mm; site area ≈ 90 mm).
3. Floods on by default, with a match setting to turn them off.
4. Sizes as in §9 (1,500–1,800 mm), to be checked against the performance targets on the largest.
5. Savanna's termite mounds: decorative walls by default, with an option to make some of them neutral termite colonies.
