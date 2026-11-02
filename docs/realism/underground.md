# Underground textures — realism notes (2026-11-02)

User note 2026-11-01 23:55: "use this realism prompt to fix the underground textures as well". No prompt file came
with it; the pass follows the realism pipeline of `claude/realism/01-spec-realism-pass.md` and
`02-spec-realism-fix-plastic-look.md` (study-only references, materials at real scale, roughness and damp variation,
baked occlusion, no flat CG patterns, review against before shots). Render-only: nothing in the simulation changed.

## What real ant-nest soil looks like at the ants' scale
- **Grains.** At 1 unit = 1 mm a worker is 2–8 mm long, so sand grains (0.1–2 mm; most 0.2–0.5 mm) are visible
  objects: pale, slightly glassy quartz, pinkish feldspar, dark mineral grains, rust-stained iron oxide grains, set in a
  brown matrix of silt, clay and organic matter. Chamber walls of initial *Atta sexdens* nests hold quartz and charcoal
  fragments in a fine clay–organic–iron-oxide matrix, with lower porosity than the soil round them (Soil micromorphology
  and CO2 exchange in initial *Atta sexdens* nests, UNESP repository).
- **Pellets.** Diggers carry soil as pellets — about 160 grains each, about a millimetre — and in experimental nests the
  sand dropped while digging is smoothed into chamber walls and floors; upper chambers hold scattered grains and intact
  pellets (W. Tschinkel, "my colored sand box").
- **Floors** are packed and smoothed by traffic; loose grains, pellets and small stones collect along the wall feet.
- **Walls** are compacted soil scraped by mandibles: smoother than the surrounding soil, with short scrape grooves,
  embedded grains and stones, and fine roots crossing them.
- **Colour** is neutral brown to grey-brown; damp soil is darker and a little glossier.
- **Queen's chamber**: an ordinary soil chamber, its floor smoothed and often plastered with fine soil (the old blue
  "silk mat" had no basis in ants; silk is spun by larvae for cocoons).

## What changed (`render/nest/nestTerrain.ts`, `render/environment.ts`)
- Floor: neutral silt-clay matrix; sand grains (cells 0.28 mm) in four mineral colours with domed shading and glassy
  quartz (lower roughness at their tops); ~1 mm crumb structure with dark crevices, softened where ants walk (the open
  middle) and loose along the walls; pellets (~0.5 mm radius) with contact shadows, densest along the walls; pebbles
  with contact shadows; damp patches darker and less rough; occlusion at the wall foot.
- Walls: lighter so their texture reads; mandible scrape grooves in patches; grains; roots; damp.
- Soil top: the same grains, dark gaps between clods.
- Tiles: the queen's chamber is smoothed pale silt (cool grey, still distinct); brood tiles are soil washed with the
  caste colour, pockets pressed into it; the food store is a swept olive-stained floor; softer cell bevels. Group
  outlines, the grid, ghosts and dig marks are unchanged.
- Light: the nest's key light is a warm white (0xffdcb4, was orange 0xffc27a) and the light pools are less orange, so
  soils keep their own colours; stones are less blue-biased to match.

- Round 3 (after the first blind review): soil crumbs and a few angular stones with irregular outlines instead of
  round blue-grey pebbles; crumbly walls (fewer, rarer roots; no fibrous scrape streaks); the queen's and food tiles
  keep the floor's grain under their silt and stain; thinner group outlines; a little soil shows in the dark beyond
  the dug floor (the darkness floor 0.12 → 0.17).

## Review
Before/after renders (render-only) in `docs/realism/underground/` (`tests/browser/underground_realism.py`, TAG=before
from `main` before the pass, TAG=after): each colony's nest at gameplay zoom, its queen's chamber, a wall close up, the
entrance. Nest hexes are 1.10 × in the after shots (1.25 × before; the cameras are placed in hex radii, so the framing
matches).

Blind reviews (a fresh agent each round, before and after shuffled as A/B, scored 1–10 on surface, colour, lighting
and "could this be a macro photo of a real ant nest in soil?"):
- Round 2 (8 pairs): the new render preferred in 8 of 8; photo-likeness 4.25 vs about 2. Remaining: tiles read as
  flat slabs with printed outlines; spotlight pools falling to black; leftover warm tint on some brood floors;
  round blue-grey pebbles; fibrous walls.


## Sources
- W. Tschinkel, "my colored sand box": https://waltertschinkel.substack.com/p/my-colored-sand-box
- Soil micromorphology and CO2 exchange in initial *Atta sexdens* nests (UNESP):
  https://repositorio.unesp.br/items/67a02c3c-bf62-4d2f-afe9-77bc0d497fd6
