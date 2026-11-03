# Nest entrances by species (research notes for the anthill and entrance models)

Study notes behind `render/game/entranceModels.ts` (surface) and the entrance in
`render/nest/nestTerrain.ts` (underground). Reference photos were studied only; nothing from them is
used in the game. Sizes are for the game's real scale (1 unit = 1 mm; workers 2–6 mm).

**Since 2026-11-01 (user spec "one wide underground entrance, three surface holes per anthill"):** every
colony's anthill has three holes, alike, round one structure centred between them, all leading into the
nest's one wide entrance (DESIGN §3.12b). Real nests of most of these species have several openings (black
garden ants: often several small craters; fire ants: up to ~20 holes; leafcutters: many craters), so three
is a game simplification in the spirit of Empires of the Undergrowth's anthills; the looks below are kept
and rearranged so the three holes read as one nest:

| Species | Anthill now |
|---|---|
| Black garden ant | A low crater of crumbly soil pellets (rampart crest ~0.7 of its radius, fading into the ground), the three holes in its rampart, a flat stone over one. |
| Red wood ant | The thatch dome over the middle, the three holes in its flanks, worn trails running out past each. |
| Leafcutter | A wide low mound of bare orange soil with three big craters on its flanks, leaf fragments along each hole's trail, the pale refuse dump beside it (where the dead are dropped: `refuseSpot`). |
| Fire ant | The worked-soil dome centred over the holes, the three small holes with granular collars at its edge; no opening in the middle (the single tunnel opening ~70 mm away is gone). |
| Army ant | The bivouac over the middle, three dark gaps in its skirt; the real ants stream in and out of them. |
| Mimic Ant (*F. plagiaria*) | As the black garden ant's crater, with plant slivers. |
| Hell ant (reconstruction) | Three small neat holes on a minimal ring of soil, leaf litter round about. |
| Gilded Ant | The rotting stump in the middle, a root running out to each hole (the holes open among the roots), pale frass below. |
| Termant | The black garden ant's crater, carton-reinforced: dark carton flakes on it, a carton collar in each throat. |
| Nasute termite | The lobed carton nest over the middle, its three openings at its base, gallery tubes running off between them. |
| Sickle-jaw termite | Three small soil collars in the leaf litter (no extra foraging holes: three holes, one nest). |

What the real nests look like (the study behind the looks above; 2026-10-26):

| Species (game) | What the real entrance looks like |
|---|---|
| Black garden ant, *Lasius niger* | Small round holes, often several, each ringed by a low crater ("volcano") of fine, crumbly soil pellets that workers carry up and drop at the rim; nests are also common under a flat stone or paving slab, with the hole at its edge. |
| Red wood ant, *Formica rufa* | A large dome thatched with pine needles, twigs and plant bits over a soil core; the entrance holes open in its sides and near the base; a worn, bare ring of ground at the foot, with trails radiating out to trees. |
| Leafcutter ant, *Atta cephalotes* | Wide crater mounds of bare, loose excavated soil (often reddish or yellowish subsoil) with big entrance holes; cleared trails lead in with leaf fragments being carried; a separate pale refuse dump of spent fungus and dead ants outside. |
| Tropical fire ant, *Solenopsis geminata* | Low irregular mounds or craters of worked granular soil in open sunny ground, up to ~60 cm across and 30 cm high in the wild, with no obvious central opening: workers come and go through many small holes and foraging tunnels at the edges (up to ~20 per nest). |
| Army ant, *Eciton burchellii* | No dug nest: the bivouac, a living mass of hundreds of thousands of workers linked by their legs and bodies round the queen and brood (about a metre across), hung under a log or between buttress roots; it dissolves into raid columns each morning. The mass itself is the entrance. |
| Mimic Ant (*Formica plagiaria*, fictional; modelled on *F. sanguinea*) | *F. sanguinea* nests in soil under stones, stumps and at the base of plants, with small earth mounds mixed with plant debris. |
| Hell ant (Haidomyrmecinae, extinct; **reconstruction**) | Nothing survives of their nests (all known from Cretaceous amber). The model assumes a small ground-nesting hunter in leaf litter. |
| Gilded / Saiy-Ants (*Aurimyrmex*, fictional, carpenter-ant-like) | Carpenter ants (*Camponotus*) excavate galleries in decaying wood (stumps, roots, logs) and push out coarse pale frass: wood shavings mixed with insect parts, piling below the openings. |
| Termants (*Chimaeromyrmex*, fictional hybrid) | Hybrid of an ant's soil crater and a termite's carton. |
| Nasute termites, *Nasutitermes corniger* | Dark brown carton nests (chewed wood and faeces bound with saliva) with a lumpy surface and lobes, small ones near spherical; covered foraging galleries (shelter tubes about one soldier length wide) run from the nest along the ground and up trunks. |
| Sickle-jaw termites, *Rhynchotermes perarmatus* | Nest underground or shallow and epigeic in forest leaf litter; most species forage on the surface in the open, mainly on litter. Openings are inconspicuous. |

## Underground (all species)
Since 2026-11-01 the nest's one entrance is a wide 7-hex "flower" at the nest's edge: its floor slopes up
toward the surface as one wide ramp (highest, and darkening, at its top edge), loose paler soil worn smooth
along the middle, the species' bits (soil pellets; needles for wood ants, leaf scraps for leafcutters, carton
flakes for nasutes and Termants, frass for Gilded Ants, worked soil for fire ants) round its rim where the
walls flare out, and one broad soft shaft of daylight (cool white by day, faint blue moonlight at night)
falling across it. A fallen colony's entrance is capped with fresh dark soil over all seven hexes and has no
light. Creature caves keep their three-hex tunnel.

## Sources
- *Solenopsis geminata*: [Wikipedia](https://en.wikipedia.org/wiki/Solenopsis_geminata) (mounds or craters up to 2 ft across and 12 in tall, up to ~20 entrance holes, open sunny soil).
- *Nasutitermes corniger*: [Wikipedia](https://en.wikipedia.org/wiki/Nasutitermes_corniger) (dark brown, bumpy nest surface with lobes, small nests near spherical); covered galleries: [Conehead termite fact sheet](https://haititrust.org/wp-content/uploads/2025/09/Fact-Sheet_Conehead-Termite_2024.pdf); carton composition: notes in `docs/creatures/nasutitermes.md`.
- Army ant bivouac: [Bivouac (ants), Wikipedia](https://en.wikipedia.org/wiki/Bivouac_(ants)) (a living nest of 150,000–700,000 workers, about a metre across, re-formed at a new site each night).
- *Rhynchotermes*: [Wikipedia](https://en.wikipedia.org/wiki/Rhynchotermes) (nests underground or shallow and epigeic; forage above the surface in the open, mainly on leaf litter).
- Carpenter ant frass and nests in decaying wood: [University of Nebraska G1738](https://extensionpubs.unl.edu/publication/g1738/na/html/view), [UC IPM ant key](https://ipm.ucanr.edu/TOOLS/ANTKEY/carpenter.html).
- Red wood ant mounds: [Norsey Wood Society: wood ants](https://www.norseywoodsociety.uk/woodants); [MDPI Insects 13(2):198](https://www.mdpi.com/2075-4450/13/2/198).
- *Atta* nest architecture and external refuse dumps: [Atta colombica, University of Utah](https://ants.biology.utah.edu/genera/atta/species/colombica/colombica.html); [Weber, IUSSI 1969](https://dictionnaire-amoureux-des-fourmis.fr/UIEIS-IUSSI/IUSSI-Bern-1969/IUSSI-Bern-1969-Weber.pdf).
- *Lasius* nest structure and soil pellets: [Lasius neoniger nest structure, University of Illinois](https://experts.illinois.edu/en/publications/nest-structure-of-ant-lasius-neoniger-emery-and-its-implications-/); [AntWiki: Lasius neoniger](https://antwiki.org/wiki/Lasius_neoniger).
