# Trees v2 — references for the bark, leaves and crowns (study only)

Spec: `claude/trees/02-spec-trees-look-and-tiers.md` (user, 2026-11-21). Plan: `CHANGE_PLAN.md` §38. The descriptions
below come from botanical fact sheets and field guides (sources at the end); photos were looked at for study only and
are not in the game, the repo or any published page. The procedural patterns (`src/render/trees/barkBake.ts`) are
original; only these numbers and descriptions went into them.

## Scale
1 unit = 1 mm. A worker ant is 3–5 mm long; the game's trunks are 28–81 mm in radius and its crowns reach 220–400 mm.
That is a young tree's size, not a forest giant's, so the bark is drawn as it looks on a young trunk and its limbs at
an ant's scale (furrows a few millimetres apart), and the leaves at their real size (oak 100–150 mm is drawn 30 mm for
the small leaves of a sapling-sized crown, the big walkable ones 50 mm).

## Bark (per species)
| Species | What it is | Drawn as (tile, relief) |
|---|---|---|
| **English oak** (*Quercus robur*) | grey-brown, deeply fissured with age into rough plates and ridges, the plates broken across | 48 mm tile, 4.5 mm relief: plates ~6 × 16 mm along the branch (stretched Worley cells), dark red-brown furrow floors, cross cracks, rough grain on the plate faces |
| **European beech** (*Fagus sylvatica*) | thin, smooth even on the largest stems, grey (blue-grey), sometimes mottled; lenticels; dark scars ("eyes") where twigs fell | 40 mm tile, 0.6 mm relief: soft mottling, fine dashes across the branch, faint wrinkles round it, a scar with its crease |
| **White willow** (*Salix alba*) | grey-brown, irregularly furrowed into rough, narrow ridges that interlace (a net of diamonds) | 56 mm tile, 4.5 mm relief: two families of slanted ridges merging and parting |
| **Rainforest trees** | thin, smooth to flaky, pale grey-brown, lenticels, algae and moss; lianas climbing them | 64 mm tile, 1.6 mm relief: flakes lifting at their edges, paler or greener beneath, lenticels; lianas looping from the limbs to the trunk |
| **Umbrella thorn** (*Vachellia tortilis*) | rough, dark grey, fissured, the fissures showing red-brown inner bark; thorns in pairs, one long straight and pale, one short hooked and dark | 40 mm tile, 3.2 mm relief: an irregular fissure network with reddish floors; paired thorns along its branches and twigs |

On every species (the wood's shader, `woodMesh.ts`): moss on the upper sides and in the furrows of the damp, thick
wood (most on willow and the rainforest trees, least on acacia); lichen — pale grey-green crusts — on the ridges (most on
beech and oak); a knot now and then (a dark eye ringed by swollen bark); tiny bore holes; the walked tops worn smoother,
lighter and a little polished; the furrows' shadow (the baked cavity) and darker undersides.

## Leaves (per species)
| Species | Leaf | Drawn as |
|---|---|---|
| **English oak** | 100–150 mm, obovate to oblong, 3–7 pairs of rounded lobes with sinuses cut about halfway to the midrib, small "ear-lobes" at the base, very short stalk; dark shiny green above, paler blue-green beneath | 5–6 lobes a side, sinuses at ~45 % of the blade's half-width, ears at the base, pinnate veins to the lobes; waxy top, blue-green underside |
| **European beech** | 50–100 mm, ovate to elliptic, margin nearly entire to wavy with fine hairs, 7–9 pairs of straight parallel veins | an oval widest below the middle, a gently wavy edge, 8 pairs of straight veins; flat sprays |
| **White willow** | 50–100 mm, lanceolate to narrowly ovate, finely serrated, shiny green above, nearly white and silky beneath | a long narrow blade (geometry 34 × 6 mm), fine teeth, a faint midrib; the underside near white; on long hanging strands |
| **Rainforest trees** | large, smooth-edged, thick and glossy, drawn out into a drip tip (more and longer in the wettest forest) | a broad ovate blade with a drip tip, veins curving to the edge; in rosettes at the twig tips; the big walkable ones |
| **Umbrella thorn** | ~25 mm long, twice divided: 4–10 pairs of pinnae, each with up to 15 pairs of tiny leaflets | a frond of 6 pairs of pinnae with tiny leaflets; flat feathery sprays (the umbrella) |

All blades: midrib and veins, the cells between slightly puckered; four variants a species with different caterpillar
holes and browned edges; each leaf its own shade; the sun shining through a blade lit from behind (warm green, the
veins darker); a gentle sway.

## Crowns (sim/treeCrowns.ts; `TREES.crowns` in balance.ts)
- Oak: a broad spreading crown, nearly horizontal gnarled limbs (wobble 0.2), leaves in tufts at the twig ends.
- Beech: a dome, smoother straighter limbs (wobble 0.09), leaves in flat sprays.
- Willow: many limbs from a short trunk, most rising (3 of 6–7), the outer ones dropping; long hanging leafy strands.
- Rainforest: few big limbs from a high crotch, four tiers on the giants; big leaves in rosettes; lianas.
- Acacia: a flat-topped umbrella — most limbs level at the crotch's tier, a few dropping; feathery fronds; thorns.

## Sources (study only)
- English oak: [Virginia Tech Dendrology, *Quercus robur*](https://dendro.cnre.vt.edu/DENDROLOGY/carddetail.cfm?ID=551);
  [Woodland Trust, common oak](https://www.tcv.org.uk/i-dig-trees-tree-library/common-oak/);
  [Wikipedia, *Quercus robur*](https://EN.wikipedia.com/wiki/Q._robur).
- European beech: [Virginia Tech Dendrology, *Fagus sylvatica*](https://dendro.cnre.vt.edu/DENDROLOGY/syllabus/factsheet.cfm?ID=121);
  [Woodland Trust, common beech](https://woodlandtrust.org.uk/trees-woods-and-wildlife/british-trees/a-z-of-british-trees/common-beech).
- White willow: [Virginia Tech Dendrology, *Salix alba*](https://dendro.cnre.vt.edu/DENDROLOGY/carddetail.cfm?ID=920);
  [Woodland Trust, white willow](https://www.woodlandtrust.org.uk/trees-woods-and-wildlife/british-trees/a-z-of-british-trees/white-willow/).
- Umbrella thorn: [Wikipedia, *Vachellia tortilis*](https://en.wikipedia.org/wiki/Vachellia_tortilis);
  [PlantZAfrica, *Acacia tortilis*](https://plantzafrica.com/plantab/acaciatortilis.html).
- Rainforest drip tips: [Northern Woodlands, drip tips and lance-shaped leaves](https://northernwoodlands.org/outside_story/article/drip-tips-and-lance-shaped-leaves);
  [Oxford, drip-tips and precipitation in the Amazon](https://www.climate.ox.ac.uk/node/2553326).
