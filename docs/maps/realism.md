# Ground realism — references (user add-on, items 1–8)

Scale: 1 unit = 1 mm. A worker ant is 3–5 mm long, so the ground it walks on is seen at the scale of a macro photo:
sand grains are 0.1–1 mm, soil crumbs 1–5 mm, a pebble 4–20 mm, a moss cushion 5–15 mm, a grass blade 1–4 mm wide.
Everything below is what the procedural ground layers (`src/render/ground/groundBake.ts`) aim at. Photos are
study-only: none is in the repo or sampled into a texture; only the numbers measured from them are written here.

## How the colours were taken
- **User photos** (four macro shots of ground, study only): a row of four soils on paper (humus, loam, red laterite,
  sand), a dark moist loam with drier crumbs, and a sunlit cut bank face with a grass thatch on top. Means and 10/90 %
  percentiles were measured in linear light; the paper between the soils in the first photo was used to take out half
  of the warm cast (its "white" is a cream paper, so a full correction turned the soils blue).
- **Munsell soil colours** (the soil scientist's chart, USDA/NRCS), converted to sRGB with the renotation data (the
  `aqp::munsell2rgb` method): the usual field ranges for each soil, dry and moist.
- **Albedo tables** for the overall brightness of each surface in sunlight.

| Ground | Dry (sRGB, neutral light) | Moist/wet | Gloss | What makes it read as real at ant scale |
|---|---|---|---|---|
| **Humus / dark topsoil** (forest, rainforest) | 10YR 2/2–3/2: mean (57, 45, 42), p10 (33, 24, 23), p90 (75, 58, 55) | 10YR 2/1: almost black (lum 0.02) | matte (rough 0.95) | crumbs 1–3 mm with black voids between them, pale rootlets 0.1–0.3 mm, wood fragments; luminance std/mean ≈ 1.5 — very uneven |
| **Loam** (meadow, garden) | 10YR 4/3–5/3: mean (126, 99, 80), p10 (83, 56, 37), p90 (157, 128, 109) | 10YR 3/2–3/3: mean (85, 71, 60), dark matrix (33, 22, 13) with drier crumbs (122, 104, 89) | matte, rough 0.9; wet film rough 0.3–0.4 | aggregates 1–5 mm, each lit on top and shadowed below; a few bright quartz grains 0.3–1 mm; straw and rootlets; std/mean 0.55 dry, 0.85 moist |
| **Red laterite** (savanna) | 2.5YR 4/6–5YR 5/6: mean (166, 114, 82), p10 (128, 78, 47), p90 (194, 140, 106) | 2.5YR 3/6: darker, more saturated | matte; ironstone nodules satin | crusted plates 5–20 mm with hairline cracks, dark ironstone nodules 1–3 mm, fine dust in the low spots |
| **Sand** (riverbank, savanna) | 10YR 7/3–6/4 quartz sand: (218, 197, 166), p10 (198, 172, 135); albedo 0.30–0.45 | wet sand 10YR 5/3, albedo 0.15–0.25 | dry grains matte, the odd quartz/mica glint; wet sand glossy in the hollows | grains 0.1–1 mm, mixed colours (clear quartz, feldspar pink, dark minerals 5–10 %); wind or water ripples 5–15 mm apart |
| **Clay** (cut banks, river margins) | 7.5YR 5/4 brown, mottled 5Y 6/1 grey and 5YR 5/8 orange | 7.5YR 4/4, smooth sheen | satin when moist (rough 0.5–0.6) | very fine (no visible grains), laminations 0.5–2 mm, desiccation cracks 3–10 mm cells when dry |
| **Mud** (water edges) | (as wet loam) 10YR 3/2: lum 0.04–0.06 | standing water film | glossy (rough 0.15–0.35), the sky reflected in the low spots | pitted (raindrops, burrows), smeared, a few grains on top; darkest in a band 2–15 mm from the water |
| **Gravel / pebbles** (river shelves) | greys and buffs (140–170, 130–150, 115–135) | darker, the pebble tops glossy where wet | dry pebbles satin (rough 0.6–0.7) | pebbles 3–15 mm half-sunk in sand, rounded, a dark contact shadow at each foot |
| **Moss** (forest floor, damp banks) | yellow-green (70, 90, 30)–(118, 120, 50); dry moss paler, browner | darker, saturated green | slight sheen on wet leaflets | cushions 5–15 mm, each a dome of leaflets 0.2–0.5 mm, dark gaps between cushions, the odd red-brown spore capsule |
| **Grass sward** (meadow ground) | the soil between blades (loam), a thatch of fallen blades (160, 135, 90) | as loam | blades satin | thatch fibres 1–2 mm wide and 10–30 mm long lying in all directions; living blades are geometry (render/grass.ts) |
| **Bark / roots** (root walls, root ramps) | (100, 74, 51)–(76, 56, 41) | darker | matte | ridged bark, roots 3–12 mm thick running along the bank, soil packed between them |
| **Rock** (ledges, boulders) | greys (120–160) with buff | darker, glossy where water runs | matte to satin (rough 0.75–0.9); gloss only on wet faces | bedding lines, cracks, lichen patches (pale grey-green, orange), dirt in the low spots |

Albedo in sunlight (for the overall brightness band): dark wet soil 0.05–0.08, dry dark soil 0.08–0.14, grass 0.20–0.25,
dry loam 0.15–0.25, red laterite 0.20–0.30, dry sand 0.30–0.45, wet sand 0.15–0.25.

## Wet vs dry (the wetness layer)
Wet ground is darker because the water film lets light that is scattered inside the grains escape less often (total
internal reflection at the water surface): typically 40–60 % of the dry albedo, more saturated, and the surface turns
glossy only where the film is continuous (mud, the low spots of sand), while the tops of crumbs and pebbles poke out
dry-looking. The renders follow that: albedo × 0.56 at full wetness (porous ground) and less on rock, roughness down
to 0.16–0.36 (lower in hollows), the bump flattened where water fills the hollows, saturation up slightly. Wetness
comes from the water's distance (a mud band 2–14 mm, damp to 34 mm), the low flooded layers while flooded and for
about 2½ minutes after, and the storm (everything a little, drying over 4 minutes); the garden map starts the
morning after rain (damp, dew glints on grass and moss).

## Gameplay readability (user rule 2026-11-01: "make sure the ground doesnt affect creature visibility")
Ants are mostly dark (Lasius, Termants, Eciton) or rust (fire ants, Formica, Atta). Real dark humus is as dark as a
Lasius worker, so the ground's luminance is kept in a band (linear 0.03–0.30 before light) and its fine detail fades
toward each layer's mean colour with camera distance: the macro look is for close zoom; at gameplay zoom the ground is
a calm mid-tone so units stand out. Measured by `tests/browser/ground_visibility.py` (results in PROGRESS.md).

## Sources (study only)
- User photos (four, attached to the request 2026-11-02): soils on paper, moist loam, a cut bank face. Not in the repo.
- Munsell soil colour notation and conversion: [aqp munsell2rgb](https://ncss-tech.github.io/aqp/reference/munsell2rgb.html),
  [Munsell colour conversion vignette](https://cloud.r-project.org/web/packages/aqp/vignettes/Munsell-color-conversion.html).
- Why wet things are darker: J. Lekner & M. C. Dorf, "Why some things are darker when wet", Applied Optics 27 (1988)
  ([pdf](https://www.wgtn.ac.nz/scps/staff/pdf/darkerwhenwet.pdf)).
- Surface albedo tables: [Iowa State, surface reflectivity](https://meteor.geol.iastate.edu/gccourse/forcing/reflectivity.html),
  [WOU albedo values](https://people.wou.edu/~mcgladm/SUST%20390/Albedo%20values%20for%20different%20Earth%20surfaces.docx).
- Field knowledge of soil structure (crumb/granular aggregates, mottling, laminated clay, desiccation cracks) from the
  USDA Soil Survey Manual's structure and colour chapters.

## How the renders do it (render only; nothing in the simulation changed)
- **Baked ground layers** (`src/render/ground/groundBake.ts`): sixteen ground types generated on the GPU once per game
  (512² per layer, 256² on low quality) into two texture arrays (albedo + roughness; normal + height + cavity). Each is
  a pile of particles — crumbs, clods, grains, pebbles, shoots, blades — of many sizes at their real size in mm, each
  with its own colour from the measured range, over a darker matrix; heights are real millimetres, so the normals and
  the cavity (the shadow baked into hollows) follow the real relief. `tools/ground/preview.html` shows every layer lit
  by a low sun with its own height-field shadows.
- **The ground shader** (`src/render/terrainMesh.ts`): the map's cover channels pick the layers by biome (garden loam
  and a grass thatch on meadows, red laterite and dry thatch on the savanna, humus and moss in forests, sand and
  gravel by rivers), plus mud along water, a worn walkway on ramps (packed sand on sand slides), the bank faces by edge
  style and damp moss on wet margins. The three heaviest layers are blended by height; each is sampled with
  stochastic tiling (three offset, rotated taps over a triangle grid; each lattice vertex keeps one offset and one
  angle, so the taps never turn at a triangle edge), so no tile ever repeats, and three scales of colour drift break
  up the large areas. A layer near the 0.02 cut of the top three fades in and out with its weight (its height too),
  so layer edges never show as lines along the mesh's triangles; the cover is softened once (`groundFields().cover`)
  and read by both the heightfield mesh and the bank sculpt (bilinear), and beyond the map's edge the edge's ground
  turns into the surrounding land over 140 mm (2026-11-02, the user's "cutoff on the map"). Close up, the sun is marched through the dominant layer's height so crumbs
  and pebbles shade the ground beside them.
- **Wetness**: mud band and damp margin from the distance to water; flood zones while flooded and draining for ~2½
  minutes after; storms wet everything a little, drying over ~4 minutes; the garden map starts damp with dew.
- **Banks and ramps** (`src/render/ground/bankSculpt.ts`, `bankDressing.ts`): the blocked cliff bands are re-meshed at
  1 mm and sculpted (strata that step out, lumps, slump scallops, rain runnels, an overhanging lip, a spill at the
  foot); roots hang out of soil banks and root walls, pebbles sit in the faces, crumbs and stones pile at the foot
  inside the blocked band, grass tufts lean over the lips; stone-step ramps get paving flush with the walk surface and
  root ramps roots along their sides. The walk surface is still the simulation's heightfield.
- **Water edges** (`src/render/water.ts`): murky water absorbs with depth (shallows show the bed), a broken foam and scum
  line at the edge, floating specks; on the ground, the wet mud band, a strand line of debris where the water reached.
- **Landmarks** (`src/render/ground/surfacePatch.ts`): rocks and pebbles take the baked weathered-stone layer by
  triplanar projection (pits, bedding, lichen), wet only near water; grass blades and flower petals let the sun through
  when it is behind them.
- **Light** (`src/render/mapBiomes.ts` MAP_MOOD, `post.ts`): the story maps' moods (garden: a fresh morning after
  rain, low sun, cool light, a little mist, dew; fire banks: a hot, bright, hazy day, high sun, distance haze, glare);
  a slighter, depth-true macro depth of field.
