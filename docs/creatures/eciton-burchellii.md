# Eciton burchellii (Burchell's army ant) — creature reference

From the army-ant package (`claude/army-ants/02-reference-eciton.md`), fact-checked 2026-10-25 against Wikipedia, AntWiki, Powell & Franks (2005/2007), Reid et al. (2015) and Couzin & Franks (2003). Each point says whether the sources confirm the brief or correct it.

## 1. Identity and range
- *Eciton burchellii* (Westwood 1842), Dorylinae. Neotropical: tropical forest from Mexico to Paraguay and Argentina; Brazil is the type locality; absent above ~24° N and at high elevation (Wikipedia, AntWiki). ✔ brief.
- Colony size: 100 000–600 000 adults (Wikipedia); 150 000–700 000 workers in a bivouac (AntWiki). ✔ brief (~300–700 k).
- Game species id `eciton`, common name "Army Ant".

## 2. Workers — shared anatomy (what the models show)
- Slender, very long-legged, high stilt-like stance; worker body lengths 3–12 mm (Wikipedia). ✔
- **Eyes: single-faceted** ("workers possess single-faceted compound eyes", Wikipedia) — one lens per side, no true compound eye. ✔ (`eyes.single`).
- Antennae 12-segmented, elbowed, no club — standard for *Eciton* workers; held forward and always sweeping (nearly blind, they navigate by pheromone). ✔ (from the AntWiki genus description).
- Mesosoma long, narrow, without spines. **Waist two-segmented** (petiole + postpetiole, Wikipedia). **Well-developed sting** (Wikipedia). ✔
- Legs long with a tibial spur, long tarsi and strong hooked claws used to link bodies into bridges and bivouacs. ✔ (Reid et al. 2015; AntWiki).
- Colours from the reference photos (the brief's table was adjusted to them, since the photos are the stated primary target): minors and submajors have **glossy black heads and a black-brown mesosoma**, dark rust legs with slightly paler tarsi, and an **orange-amber gaster**; medias and majors have pale heads and tan-rust bodies. AntWiki: workers "reddish-black", soldiers "light-colored". ✔ with a correction (the brief said the mesosoma is reddish-brown on all castes; the photos show it near-black on the small castes).

## 3. The four worker castes
Size varies continuously, with four named size classes: minors, medias, submajors (porters), majors/soldiers (Wikipedia; Powell & Franks 2005).

| caste (game id) | real size | head | mandibles | role | source notes |
|---|---|---|---|---|---|
| Minor (`eciton_minor`, "Worker") | ~3–4 mm | small, rounded, black | short, clamp-shaped, toothed | swarm front, prey capture, brood care, bridges, plugs | AntWiki: minims/medias "bearing shorter, clamp-shaped mandibles, are the generalists" ✔ |
| **Submajor / porter** (`eciton_submajor`, "Porter") | second in size to the major; 5.6–9.5 mg dry mass | larger, black-grey, squarer | long, narrow, slightly curved | **specialist prey transport**: loads held **below the body**; leads transport teams; disproportionately long legs give loading space and ground clearance | Powell & Franks 2005: "disproportionately large legs, head and mandibles"; "*Eciton* hold all loads below the body"; "only 3 % of the worker population"; teams "usually led by submajors" and "never transported larvae". ✔ brief, with two corrections: porters are rare (3 %), and team loads are usually no heavier than solo loads |
| Media (`eciton_media`, "Media") | ~8 mm | pale-yellow head, smaller relative to the major's | medium, thick, curved | mid-weight fighter and guard; "large medias serving as porters" in teams | AntWiki ✔ |
| **Major / soldier** (`eciton_major`, "Soldier") | ~10–12 mm | very large, smooth, pale ivory-yellow, tiny lens eye, dark antennal sockets | enormous, **long, pointed, falcate (sickle)**; "tusk-like" in the largest; curving inward to sharp points | defence only — "serve almost exclusively as a defense force"; they do not carry food | Wikipedia, AntWiki ✔. Barbed points and their use as sutures are widely reported for *Eciton* soldiers in popular accounts, but neither page states them: the model keeps the barbs (they read well), and the in-game fact says "hooked", not "barbed" |

The user chose the display names: the major is the in-game "Soldier" (it guards the trail) and the submajor is the "Porter". The old id `eciton_soldier` is kept as an alias of `eciton_major` for saves and URLs.

## 4. Queen
- **Dichthadiigyne** ("dichthadiiform", AntWiki): permanently wingless, no wing scars, much larger than any worker, built for walking during emigrations; broad rounded head, tiny or no eyes, strong curved mandibles, single very broad petiole, enormous elongated gaster. ✔ brief.
- **Physogastry:** before each statary egg burst she becomes "maximally physogastric", the abdomen "greatly swollen by 55 000 to 66 000 eggs" within a week; one burst is **100 000–300 000 eggs** (AntWiki). The model drives this with one value `swell` (0 nomadic → 1 statary); **the game uses a fixed 0.5** because the phase cycle was dropped. ✔
- Monogynous; mates with 10–20 males (Wikipedia). Always surrounded by attendant workers during emigration (AntWiki: a "retinue… darkly colored, unladen smaller workers"). ✔ Attendants are not in the game (user decision).

## 5. Colony cycle (biology only)
- **Statary phase ~20 days / 2–3 weeks:** the colony stays put, pupae develop, the queen lays the egg burst, and raids happen about every other day (Wikipedia, AntWiki). The brief said "raids smaller"; the sources say *less frequent*.
- **Nomadic phase ~15 days / 2–3 weeks:** after the eggs hatch and the pupae eclose; raids daily; the colony emigrates most nights, a move taking 6–8 h (Wikipedia). ✔ brief.
- **The user dropped the bivouac and the phase cycle (2026-10-25).** In the game the army ants keep a dug nest, a queen chamber and brood tiles like every other species.

## 6. Raids and movement (what the behaviour code shows)
- Swarm raids with up to ~⅓ of the colony, "up to 200 000 members", **up to 20 m wide and 200 m long** (Wikipedia); AntWiki: a front "15 meters or more in width and 1 to 2 meters in depth". The front advances as a loose swarm over the litter; behind it a branching trail network merges into one column home. ✔ brief.
- **Lanes:** Couzin & Franks 2003 (*Proc. R. Soc. B* 270:139–146, "Self-organized lane formation and optimized traffic flow in army ants") — three-lane traffic: **returning (laden) ants take the centre lane and outbound ants the two edges**, because outbound ants turn away more readily (Wikipedia: outbound ants "turn to avoid inbound traffic more often, giving the prey-burdened ants the right-of-way"). **Correction to the brief**, which had outbound ants in the centre and porters on the sides.
- Front ants advance in short pulses and fall back while others push past; prey is flushed ahead of the front (classic Schneirla/Rettenmeyer descriptions; consistent with Wikipedia's "loose swarm"). ✔ (not directly quoted).
- **Living bridges:** Reid et al. 2015, *PNAS* 112:15113–15118, "Army ants dynamically adjust living bridges in response to a cost–benefit trade-off" — bridges form where traffic is heavy, lengthen and shift to shorten the path, and dissolve when traffic drops. ✔ brief.
- **Pothole plugging:** Powell & Franks 2007, *Animal Behaviour* 73:1067–1076, "How a few help all: living pothole plugs speed prey delivery in the army ant *Eciton burchellii*" — workers size-match holes, lie motionless if they fit, and team up for larger holes. ✔ brief.
- Majors stand along the trail edges facing outward as guards and rush intruders (AntWiki "defense force"; photos). ✔ In the game they do this along the whole raid trail once the colony has a few of them.
- Combat: bite + sting; groups pin prey by its legs and stretch it out; majors hook with the sickle mandibles. ✔ (general *Eciton* accounts).

## 7. Design rules carried into the models
- One parameterised rig (the game's shared builder) for all four worker castes, with allometry: head width grows faster than length, submajor legs longest (`legs.hind` 1.75 vs 1.5), major head 0.32 wide at L 11.
- Semi-glossy, finely textured cuticle; sparse golden hairs, denser on the gaster and legs (`hair 0.45`).
- Queen: dark red-brown `#5A2418`; gaster plates `#32180F` separated by membranes `#B89068`; `swell` 0 → 1 for nomadic → statary.
- The reference photos (Alex Wild; Piotr Naskrecki/Minden/naturepl) are copyrighted: reference only, never textures or in-game images.

## Facts for info cards
- An Eciton raid can be 200 m long and 20 m wide, carried out by up to 200 000 ants.
- Porters are only about 3 % of the workers, but they carry most of the big prey, slung under the body.
- Returning ants laden with prey take the centre of the trail; outbound ants keep to the edges.
- Workers plug potholes in the trail with their own bodies and link up into living bridges.
- Antbirds follow the raids to catch insects fleeing the swarm front.

## Sources
- Wikipedia, *Eciton burchellii* — https://en.wikipedia.org/wiki/Eciton_burchellii
- AntWiki, *Eciton burchellii* — https://www.antwiki.org/wiki/Eciton_burchellii
- Powell S. & Franks N. R. 2005, "Caste evolution and ecology: a special worker for novel prey", *Proc. R. Soc. B* — https://pmc.ncbi.nlm.nih.gov/articles/PMC1559956
- Powell S. & Franks N. R. 2007, "How a few help all: living pothole plugs…", *Animal Behaviour* 73:1067–1076 (cited via Wikipedia)
- Reid C. R. et al. 2015, "Army ants dynamically adjust living bridges…", *PNAS* 112:15113 (cited via Wikipedia)
- Couzin I. D. & Franks N. R. 2003, "Self-organized lane formation and optimized traffic flow in army ants", *Proc. R. Soc. B* 270:139–146

## Realism pass (overnight 2026-10-31)
Studied (never shipped): the user's 7 Eciton photos (Alex Wild soldiers in three-quarter, profile and face; a soldier
with prey; Kronauer's and a field photo of workers; Naskrecki's queen among workers) and the references in
claude/army-ants/02-reference-eciton.md. Shapes as numbers (fractions of L):

| Unit | L | Head (len / width) | Head look | Eyes | Mandibles | Legs (hind) |
|---|---|---|---|---|---|---|
| Worker (minor) | 4 mm | .20 / .17 | glossy-to-satin black | single lens, .05 | short toothed clamps: the formicine triangle generator, 5 teeth, black | 1.5 |
| Porter (submajor) | 6.5 mm | .22 / .20 | black | .045 | long narrow slightly curved sickles (.5) | 1.75 |
| Media | 8 mm | .25 / .25 | pale yellow-tan darkening toward the mouth | .04 | thick curved toothless sickles (.62) | 1.5 |
| Soldier (major) | 11 mm | .26 / .27, rounded-square (review: about the mesosoma's size, not an egg) | whitish tan on the vertex shading to orange-brown over the frons and clypeus, smooth | pin eyes .05 | 1.45 head lengths: slender black sickles rising from the front corners, sweeping up then hooking down and in, tips free and apart, a small barb near each tip | 1.4 |
| Queen | 22 mm | .18 / .24, broad and flat | dark red-brown | tiny | short (.32) | .8 |

Colours (sRGB): workers' head and mesosoma a dull black (#1e1c1c / #261c18), legs dark rust (#4a2416) a little paler at
the tarsi (not blond), gasters a dull rust-amber (#9a5428; the saturated orange read as a grub in review); medias and
soldiers tan-rust bodies (#6e2e1a, #8a4a28); the queen #5a2418 with dark gaster plates (#3e1c10) and narrow pale
membranes (#8a5a3a). Surface: semi-glossy over a shallow microreticulation, sparse fine golden hairs, denser on the
gaster and legs (recipe `ECITON`, src/render/bake/recipes.ts).
