# NEW MAPS — Five Larger, Realistic, EotU-Style Surface Maps (with safe water and 10 anthill sites)

Replace the current surface maps with five new, larger, hand-designed maps that feel like real, living places at ant scale (Empires of the Undergrowth's maps are the benchmark for realism and readability; match the feel, never copy their layouts or assets). They must work in single-player, skirmish, sandbox, and up to 4-player multiplayer, and stay deterministic.

Take your time: survey first, design on paper (docs) second, build third, test last.

---

## 0. WHAT'S WRONG TODAY (found in the published build)
Surface terrain is a square heightfield (`res = 2`, 720×720 or 900×900) in five styles: meadow, forest, sandy, riverbank, formicarium. World setup (`w1` in the bundle) does this:
- `addPuddle(...)` places 2 puddles at **random positions** (`range(80, width-80)`) **before** colonies are placed, with **no exclusion zone** around spawns, entrances, or each other.
- Colony placement (`oU`) uses fixed corners at 18% of the map and only checks that the **single center point** is passable, then nudges it randomly up to 30 times. The mound footprint and nest entrances are never checked, so anthills end up on pond edges or in water.
- The riverbank style carves a diagonal river through the map center, close to spawns.
- Logs and other climbable props caused pathing bugs.
Fix all of this structurally, not with more random nudging.

Survey the real source first (systems: terrain/heightfield, water, props, colony placement, entrances, caves/lairs, food/aphid/plant spawning, creatures, missions, skirmish/multiplayer setup screens, minimap, save format) and write a short mapping table in `DESIGN.md`.

---

## 1. MAP FORMAT: HAND-DESIGNED LAYOUT + SEED DETAIL
- Each map is a data file (`maps/<id>.json` or `.ts`) authored by hand: size, biome, hex layout, height/feature brushes, water bodies and their shorelines, solid obstacles, walkways/bridges, 10 anthill sites, nest entrances, lairs/caves, food zones, aphid/plant zones, creature spawns, flood zones, lighting/time-of-day preset, ambience preset.
- The match **seed only varies small details**: exact grass/prop scatter, small food item positions within food zones, minor color variation, creature wander paths. Layout, water, spawns, and lanes are identical every match (fair and learnable).
- Maps are loaded by id everywhere (single-player, skirmish, sandbox, multiplayer lobby); the multiplayer lobby shares only the map id + seed.
- Keep the formicarium and existing missions working (missions may be pointed at the new maps; document any changes).

## 2. HEX LAYOUT ON SMOOTH TERRAIN
- Add a **surface hex grid** used for layout and rules: anthill sites, nest entrances, lairs, water bodies and shorelines, flood zones, walkways, food zones, and exclusion zones all snap to hexes. Use the same hex conventions (orientation, axial coordinates, spacing math) as the underground nest grid so code and tools are shared.
- Hex size: about the same as a nest tile in world units (tune so a mound is 3–7 hexes).
- Terrain still LOOKS natural: the heightfield, grass, and props are smooth and organic; hex edges are never visible (except in an editor/debug overlay).
- Ants and creatures still move smoothly (existing flow fields/pathing on the heightfield). Passability is derived from the hex layout + heightfield together, so water and walls are consistent in both.
- Debug overlay (toggle) draws hexes colored by type: spawn, exclusion, water, shore, walkway, flood zone, lair, food zone.

## 3. TEN ANTHILL SITES PER MAP
- Every map has exactly **10 anthill sites** (hex clusters with a mound footprint, 1–3 nest entrances, and a guaranteed dry, flat area).
- Sites are placed for fairness: symmetric or near-symmetric groups so that any 2, 3, or 4 player selection gets comparable distance to food, water, lairs, and opponents. Precompute and store **balanced site sets** per map for 2, 3, and 4 players (and a "free for all 10" set for big AI matches/sandbox).
- Unused sites are either empty (natural ground, maybe a small abandoned mound with food) or filled by AI rival colonies, set in match setup.
- Up to 10 colonies total per match (players + AI); multiplayer still caps at 4 human players.
- **Hard rules for every site** (validated at load and in a test):
  - The whole mound footprint + a ring of 2 hexes around it is dry, passable, flat enough, and never in a flood zone.
  - At least 6 hexes from any water or shoreline; at least 4 hexes from any wall or lair; at least 12 hexes from any other site.
  - Every entrance connects to every other site and to the main food zones by a land path (no site can be isolated by water).

## 4. WATER (impassable + bridges, plus flooding)
- **Water bodies are authored**, never randomly placed: ponds, streams, puddles, tide pools, with hand-drawn shorelines on the hex layout.
- **Water is impassable** to ants and walking creatures. Pathfinding, flow fields, food spawning, aphids, plants, lairs, and markers must all respect it (a marker placed in water snaps to the nearest shore hex).
- **Crossings** are flat walkways, not climbable props: flat stones, leaves floating or lying across narrow water, root mats, moss bridges, and (for army ants) the existing living-bridge system. A crossing is a hex path marked `walkway`, rendered as a natural object lying flat, and treated as normal ground for movement. No 3D climbing over them.
- Water looks real: depth-colored shallows, soft shoreline wetness and darker mud, refraction/ripples, floating debris, small reflections, rings when insects land; frogs, water striders, and dragonflies as ambient life (non-blocking).
- **Flooding events** (on maps that have flood zones): rain storms or rising water temporarily flood marked low-lying hexes. Warn players (darkening sky, rumble, a timer icon on the minimap) 20–30 s before; water rises over ~10 s, stays for a set time, then drains. Ants caught in flooded hexes take drowning damage over time and try to flee to high ground; food items in flood zones float away or are destroyed. **Anthill sites and their surroundings are never in flood zones.** Flood timing is deterministic from the seed and map data, toggleable in match settings.
- Nest entrances never sit in or next to water; underground nests are unaffected by surface flooding unless a mission says otherwise.

## 5. OBSTACLES: SOLID WALLS ONLY
- Remove all climbable props that ants walk over (logs, branches, etc. that caused bugs).
- Large natural objects (logs, rocks, tree trunks, buttress roots, mushroom clusters, pine cones, stones) are now **solid walls**: impassable to everything (ants and creatures), with clean, hex-aligned collision footprints and smooth visual shapes.
- They must look great: detailed bark, moss, lichen, fungus, cracks, beetle holes, dew, small plants growing around them, dirt/leaf buildup at their base, so they read as natural, not as blocks.
- Use them to create readable lanes, chokepoints, and flanks.
- Small decoration (grass blades, pebbles, twigs, petals, seeds) is purely visual and never blocks movement.

## 6. THE FIVE MAPS
All five are larger than today's (target 1,400–1,800 world units across, tune for performance and pacing), use the 10-site rule, and feel like a real place at ant scale.

1. **Meadow Pond** — sunny grassland with wildflowers, clover, and dandelions around a central pond with lily pads, reeds, and frogs. Two flat-stone crossings. Aphid-rich flower stems near the middle. Rain storm flooding of the low grass by the pond.
2. **Forest Floor** — dim, dappled pine/oak woodland: deep leaf litter, mushrooms, moss, fern fronds, roots, fallen logs and rocks as walls forming lanes, spider and beetle lairs in hollows, a small trickling stream with root-mat crossings.
3. **Riverbank** — a winding stream (not through the map center) with sandy and pebbly banks, washed-up food (dead insects, fruit), reed beds, wet mud margins; flooding as the stream rises after rain. Crossings: stepping stones and a fallen leaf raft.
4. **Rainforest** — humid jungle floor: giant fallen leaves, buttress roots as walls, puddles and rain pools, fruit falls, dense insect life; frequent short rain showers (flooding small hollows). Great for army ants and termites.
5. **Savanna** — dry grassland with scattered termite mounds (decorative or as neutral termite colonies), acacia litter, cracked earth, dry seed patches, a seasonal waterhole that floods during a storm event and shrinks back after.

For each map document: layout sketch (hex overlay screenshot), site sets for 2/3/4 players, food/lair/creature zones, flood zones and timing, lighting and ambience preset, and the intended play pattern.

## 7. REALISM AND LIFE (EotU-level)
- Ant-scale macro look: grass blades taller than ants, depth of field, soft sunlight with dappled shadows, light shafts in forest/rainforest, humid haze, dew sparkle in the morning.
- Day/night and weather presets per map (sun angle, color grading, fog, rain).
- Ambient life that doesn't block: drifting seeds and petals, gnats, butterflies passing, water striders, frogs croaking, birds overhead shadows.
- Natural ground: mixed soil, leaf litter layers, moss, sand ripples, mud wetness near water, worn ant trails that appear where traffic is heavy.
- Use the existing ambience/audio system per biome (wind, birds, insects, water, rain).

## 8. PERFORMANCE AND MULTIPLAYER
- Larger maps must still meet performance targets: instanced grass/props with LOD and culling, terrain chunking, baked lighting/AO where possible, water as a cheap shader.
- Everything that affects gameplay (hex layout, passability, water levels, flood timing, site selection, food zones) is deterministic and identical on every client.
- Minimap shows water, walls, sites, flood warnings.

## 9. TOOLS
- A simple map editor/debug mode (dev only): view hex types, paint hex types, move sites, validate rules, export the map file.
- A validation script run in tests for all five maps: site rules, connectivity (every site reaches every other and the food zones by land, also during floods), no entrance near water, flood zones exclude sites, and determinism (same seed → same map hash).

## 10. VERIFY
- [ ] All 5 maps load in single-player, skirmish, sandbox, and 4-player multiplayer (and a 10-colony AI match).
- [ ] No anthill or entrance can ever be in or next to water (run the validator, plus 50 seeded matches per map with different site sets).
- [ ] Water is impassable; crossings work; markers in water snap to shore; flooding warns, rises, drowns, drains, and never reaches sites.
- [ ] No climbable obstacles remain; walls block everything and look natural.
- [ ] Hex layout matches the nest grid conventions; hexes invisible in normal play.
- [ ] Performance targets met on the largest map with 10 colonies.
- [ ] Screenshots of each map at several zooms and times of day saved to `docs/maps/`.
- [ ] Update `DESIGN.md`, `README.md`, and add a dated entry to `PROGRESS.md`.