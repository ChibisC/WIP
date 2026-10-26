# Nest entrances by species (research notes for the surface and tunnel models)

Study notes behind `render/game/entranceModels.ts` (surface) and the entrance tunnel in
`render/nest/nestTerrain.ts` (underground). Reference photos were studied only; nothing from them is
used in the game. Sizes are for the game's real scale (1 unit = 1 mm; workers 2–6 mm).

| Species (game) | What the real entrance looks like | Model |
|---|---|---|
| Black garden ant, *Lasius niger* | Small round holes, often several, each ringed by a low crater ("volcano") of fine, crumbly soil pellets that workers carry up and drop at the rim; nests are also common under a flat stone or paving slab, with the hole at its edge. | Hole r 1.6 mm; pellet crater (rim 2.1 × hole, 1.5 mm high, apron 5.5 ×); 110 pellets; the first extra entrance has a flat stone over one side. |
| Red wood ant, *Formica rufa* | A large dome thatched with pine needles, twigs and plant bits over a soil core; the entrance holes open in its sides and near the base; a worn, bare ring of ground at the foot, with trails radiating out to trees. | One thatched dome per nest over the site centre (radius ≥ 1.3 × the farthest hole, 16–30 mm, 0.42 × as high), 250–600 needles and twigs lying on it, holes with a small lip in its flanks; five darker trails from the foot. |
| Leafcutter ant, *Atta cephalotes* | Wide crater mounds of bare, loose excavated soil (often reddish or yellowish subsoil) with big entrance holes; cleared trails lead in with leaf fragments being carried; a separate pale refuse dump of spent fungus and dead ants outside. | Hole r 3.2 mm; wide crater of loose orange-brown soil (3.2 mm rim, apron 6.5 ×), 160 clods; green leaf fragments along the trail direction; a pale crumbly refuse dump 30 mm from the main hole (where corpses are dropped). |
| Tropical fire ant, *Solenopsis geminata* | Low irregular mounds or craters of worked granular soil in open sunny ground, up to ~60 cm across and 30 cm high in the wild, with no obvious central opening: workers come and go through many small holes and foraging tunnels at the edges (up to ~20 per nest). | The existing granular dome over the nest (`mounds.ts`) stays; each entrance is a small hole (r 1.2 mm) with a low granular collar away from the dome. |
| Army ant, *Eciton burchellii* | No dug nest: the bivouac, a living mass of hundreds of thousands of workers linked by their legs and bodies round the queen and brood (about a metre across), hung under a log or between buttress roots; it dissolves into raid columns each morning. The mass itself is the entrance. | A heap of 260–760 linked worker bodies (with leg links) over the main hole; ants walk onto it and vanish inside. |
| Gene Thief Ant (*Formica plagiaria*, fictional; modelled on *F. sanguinea*) | *F. sanguinea* nests in soil under stones, stumps and at the base of plants, with small earth mounds mixed with plant debris. | A low pellet crater with a few plant slivers. |
| Hell ant (Haidomyrmecinae, extinct; **reconstruction**) | Nothing survives of their nests (all known from Cretaceous amber). The model assumes a small ground-nesting hunter in leaf litter. | A neat round hole (r 1.4 mm) with a minimal soil rim among a few fallen leaf pieces. Stated as a reconstruction in game. |
| Gilded / Saiy-Ants (*Aurimyrmex*, fictional, carpenter-ant-like) | Carpenter ants (*Camponotus*) excavate galleries in decaying wood (stumps, roots, logs) and push out coarse pale frass: wood shavings mixed with insect parts, piling below the openings. | A rotting stump (bark sides, flared roots, pale crumbling top) beside the main hole; pale sawdust frass spilling out round every hole. |
| Gene-Thief Termants (*Chimaeromyrmex*, fictional hybrid) | Hybrid of an ant's soil crater and a termite's carton. | A soil crater whose crest is plastered with dark, papery carton flakes. |
| Nasute termites, *Nasutitermes corniger* | Dark brown carton nests (chewed wood and faeces bound with saliva) with a lumpy surface and lobes, small ones near spherical; covered foraging galleries (shelter tubes about one soldier length wide) run from the nest along the ground and up trunks. | A lobed dark carton mound round the main hole (carton material), three lumpy covered gallery tubes running off along the ground. |
| Sickle-jaw termites, *Rhynchotermes perarmatus* | Nest underground or shallow and epigeic in forest leaf litter; most species forage on the surface in the open, mainly on litter. Openings are inconspicuous. | A tiny soil turret (r 1.1 mm hole, 1.1 mm collar) in leaf litter, with four smaller foraging holes and their collars scattered nearby. |

## Underground (all species)
The underground end of every entrance is a tunnel of three hexes rising from the nest floor to the
hole: loose, paler soil worn smooth along the middle, spoil pellets toward the sides, a shaft of daylight
(cool white by day, faint blue moonlight at night) falling down it. A plugged entrance is capped with
fresh dark soil and has no light.

## Sources
- *Solenopsis geminata*: [Wikipedia](https://en.wikipedia.org/wiki/Solenopsis_geminata) (mounds or craters up to 2 ft across and 12 in tall, up to ~20 entrance holes, open sunny soil).
- *Nasutitermes corniger*: [Wikipedia](https://en.wikipedia.org/wiki/Nasutitermes_corniger) (dark brown, bumpy nest surface with lobes, small nests near spherical); covered galleries: [Conehead termite fact sheet](https://haititrust.org/wp-content/uploads/2025/09/Fact-Sheet_Conehead-Termite_2024.pdf); carton composition: notes in `docs/creatures/nasutitermes.md`.
- Army ant bivouac: [Bivouac (ants), Wikipedia](https://en.wikipedia.org/wiki/Bivouac_(ants)) (a living nest of 150,000–700,000 workers, about a metre across, re-formed at a new site each night).
- *Rhynchotermes*: [Wikipedia](https://en.wikipedia.org/wiki/Rhynchotermes) (nests underground or shallow and epigeic; forage above the surface in the open, mainly on leaf litter).
- Carpenter ant frass and nests in decaying wood: [University of Nebraska G1738](https://extensionpubs.unl.edu/publication/g1738/na/html/view), [UC IPM ant key](https://ipm.ucanr.edu/TOOLS/ANTKEY/carpenter.html).
- Red wood ant mounds: [Norsey Wood Society: wood ants](https://www.norseywoodsociety.uk/woodants); [MDPI Insects 13(2):198](https://www.mdpi.com/2075-4450/13/2/198).
- *Atta* nest architecture and external refuse dumps: [Atta colombica, University of Utah](https://ants.biology.utah.edu/genera/atta/species/colombica/colombica.html); [Weber, IUSSI 1969](https://dictionnaire-amoureux-des-fourmis.fr/UIEIS-IUSSI/IUSSI-Bern-1969/IUSSI-Bern-1969-Weber.pdf).
- *Lasius* nest structure and soil pellets: [Lasius neoniger nest structure, University of Illinois](https://experts.illinois.edu/en/publications/nest-structure-of-ant-lasius-neoniger-emery-and-its-implications-/); [AntWiki: Lasius neoniger](https://antwiki.org/wiki/Lasius_neoniger).
