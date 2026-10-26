# Hell ants (Haidomyrmecinae) — creature reference

Target file in the repo: `docs/creatures/hell-ant.md`. Copy this doc there when implementing.

This is the fact-checked version of the anatomy and behaviour in `01-spec-models-and-attack.md`. Where the brief and the fossil record differ, the fossil record is given here and the game decision is stated under **Game decision**. Checked 2026-10-24 against AntWiki, Guo et al. 2021 (ZooKeys 1048), Barden et al. 2017 (Syst. Entomol. 42) and 2020 (Curr. Biol. 30), Lattke & Melo 2020 (Cretaceous Research 114), Lepeco et al. 2025 (Curr. Biol. 35), McKellar et al. 2013 (Can. Entomol. 145). Sources are listed at the end.

## 1. What they were

- Extinct stem-group ants, subfamily Haidomyrmecinae. About 11 genera and 15 species.
- **Age: about 113–78 Ma** (not 113–99 as in the brief). Oldest: *Vulcanidris cratensis*, Crato Formation limestone, Brazil, ~113 Ma. Youngest: *Haidoterminus cippus*, Canadian amber (Grassy Lake, Alberta), ~78–79 Ma. Most species: Kachin amber, Myanmar, ~99 Ma. France: *Haidomyrmodes mammuthus*, Charentese amber, ~100 Ma. The four regions in the brief are right.
- Known castes: **workers and queens only** (alate and dealate). No soldier caste or worker polymorphism is known in any hell ant. The game's "soldier" is a gameplay caste: a large worker in the style of *Linguamyrmex*.
- Mandibles moved in a plane perpendicular to a modern ant's (vertical, sagittal), confirmed by the *Ceratomyrmex* fossil holding prey (Barden et al. 2020). The head and mandible shape co-vary across species; elongate horns evolved at least twice in the group.

## 2. Design basis per caste

| Caste | Basis | Real size | Notes |
|---|---|---|---|
| Worker | *Ceratomyrmex ellenbergeri* | 4.5–5.9 mm | Long clypeal horn with a spatulate tip; the one fossil caught holding prey (a *Caputoraptor elegans* nymph, an extinct cockroach relative). Horn did not pierce the prey. |
| Soldier (gameplay caste) | *Linguamyrmex vladi* | no total length published; *L. rhinocerus* workers reach 6.6 mm | Flattened clypeal **paddle** with a setose pad underneath, not a sharp horn. Micro-CT showed a denser core, "most probably sequestered metals". **No element was identified; "iron" is unsupported.** The authors' stated function: pin and potentially puncture soft-bodied prey. "Impales" is the game's exaggeration. |
| Queen | *Haidomyrmex cerberus* (Guo et al. 2021) | alate 7.75 mm, dealate 6.31 mm; *H. scimitarus* dealate 8.0 mm | One alate and one dealate queen known. "Wingless" means dealate (wings shed after mating), not a permanently wingless queen. |

**Game decision:** worker ≈ 5.0, soldier ≈ 6.5, queen ≈ 7.6 game length units (the game's `length` field, which is roughly mm). These sit between Lasius (4 / 4.9 / 8.5) and Formica (7 / 8.6 / 10.5).

## 3. Shared anatomy

### Head
- Head orientation: the clypeal expansion rotates part of the head nearly 90° relative to a modern ant (Lattke & Melo 2020); the occipital foramen sits high and dorsal in *Linguamyrmex*. The brief's "head carried angled downward, mouth facing down and forward" is a fair reading. **Nothing in the literature addresses the neck's range of motion**; "limited up-down movement" is a game choice.
- **Horn / clypeal process:** rises from the clypeus between the antennal bases. Shape varies by genus: a small setose lobe (*Haidomyrmex*), a flattened paddle (*Linguamyrmex*), a long curved horn (*Ceratomyrmex*). In *Ceratomyrmex* the tip is rounded and spatulate; **dense long setae run along the underside** from the apex toward the base, and small spicules rim the spatula. (The brief said "fringe of bristles on the edge"; put the long hairs on the underside/inner edge facing the mandibles. **Game decision:** the rim spicules are omitted; the user wants a clean tip.)
- **Trigger hairs:** *Ceratomyrmex* has four long trigger hairs, two per side, near where the closed mandible tips rest. *Haidomyrmex* has two on the clypeal pad; *Linguamyrmex* has them at the base of the setose pad. Their role in firing the snap is inferred by analogy with living trap-jaw ants.
- **Mandibles:** long, slender, scythe-shaped; articulate in an oblique vertical plane and swing upward so the tips meet the horn. In *Ceratomyrmex* the tips reach the horn apex. Estimated gape in *Haidomyrmex*: 140–180°. **At rest the mandibles are closed with the tips against the clypeus**; hunting with the jaws cocked wide open is a hypothesis (Barden et al. 2017). *H. cerberus* queens have serrated mandible tips and a longer, sharper ventral blade than workers; some species have serrated or toothed horns and peg-like denticles on the setose pad.
- **Eyes:** oval compound eyes. *H. cerberus* worker eye ~0.30 mm, alate queen 0.24 mm, dealate 0.28 mm (queen eyes smaller, which the authors note is unexpected). *L. vladi* eye ovoid, bulging, 0.38 mm. *Haidoterminus* eyes small. "Large" depends on genus.
- **Ocelli:** the alate *H. cerberus* queen has **no ocelli**. Some other gynes have them (*L. brevicornis* faint, *Haidomyrmodes* a pair). Workers: none.
- **Antennae:** 12 segments (10 flagellomeres) in females, filiform, no true club; older literature counted 11 in *Haidomyrmex* and *Haidomyrmodes*. Scape long: 0.94 mm against a 0.96 mm head in *L. vladi*. *Haidoterminus* has a bulb-shaped tip and *L. brevicornis* slightly broadened apical flagellomeres.

### Body
- Mesosoma slender and elongate. Queens (Guo 2021): mesoscutum, parapsidal furrows, expanded mesoscutellum described. **Wing scars are not described** for the dealate (wings "not preserved"); wing scars on the game queen are a convention.
- Petiole: a single node with a short anterior peduncle, often a subpetiolar process.
- Gaster: constriction between abdominal segments III and IV (first and second gastral segments) is generally present but ranges from **faint to deep** (deep in *L. brevicornis*, weak in *Dilobops* and *H. davidbowiei*).
- Sting: robust and dorsally curved; in *Haidomyrmex* fully retractable, so not always visible.
- Legs: five tarsomeres; claws with subapical teeth and a small arolium; fore coxa much longer than the others; tibial spur formula 1-2-2. "Tall, leggy stance" is artistic licence.

### Coloration
Amber does not preserve true colour. The game palette is an artistic reconstruction following the user's side-view illustration (reference 4): olive-brown head, mesosoma and petiole; gaster blending to dark reddish maroon; bright orange legs, antennae and mandibles; olive-to-sage horn; near-black glossy eyes; pale cream hairs. The soldier's paddle tip is shown dark and glossy to suggest the dense, reinforced core. Exact hexes are in `02-spec-visual-fix.md` §3. Say this in the in-game caste fact text.

## 4. Behaviour (what is evidence, what is game design)

| Behaviour | Status |
|---|---|
| Vertical snap of the mandibles against the horn to pin prey | Supported (fossil with prey; Barden 2020). |
| Trigger hairs fire the snap | Inferred by analogy with trap-jaw ants. |
| Sting to paralyse prey | Speculated by Barden in interviews; no direct evidence. |
| Hemolymph feeding | Proposed only for *L. vladi* as an "educated guess"; grooves on the **mandibles** could act as a gutter toward the mouth. Not a groove at the horn base. |
| Puncturing / impaling prey | *L. vladi*: "pin and potentially puncture". Impaling is a game exaggeration. |
| Carrying food clamped vertically between mandibles and horn | No evidence either way. Game design. |
| Soldier caste | None known. Game design. |
| Queens as hunting foragers during colony founding | Suggested in the literature (Wikipedia summary of the group). |

## 5. Extra details worth using in-game text
- The *Vulcanidris* holotype is a winged female preserved in rock: the first hell ant outside amber and the first from western Gondwana. Its describers compared the jaws to an upward-moving forklift.
- *Haidomyrmodes* workers and alates found together are the earliest direct evidence of reproductive division of labour in ants.
- No male hell ant appears to have been described (AntCat lists only workers and queens for *H. cerberus*).
- A 2016 NIGPAS press page wrongly says the mandibles moved horizontally; ignore it.

## 6. Corrections to the original brief (summary)
1. Date range 113–78 Ma, not 113–99.
2. No soldier caste exists; call it a gameplay caste in docs and in the caste "fact" text.
3. *Linguamyrmex* has a paddle with a hard, dense core, not a metal spike; "iron" and "impale" are not in the papers.
4. *H. cerberus* alate queen has no ocelli; wing scars are not described.
5. Mandibles are closed at rest (tips on the clypeus); cocked-open hunting is a hypothesis.
6. Horn hairs: long setae on the underside/inner edge, spicules on the rim.
7. Hemolymph groove: on the mandibles (*L. vladi*), not the horn base.
8. Four trigger hairs in *Ceratomyrmex* (two per side).

## Sources
- AntWiki Haidomyrmecinae: https://www.antwiki.org/wiki/Haidomyrmecinae
- AntWiki key to genera and species: https://antwiki.org/wiki/Key_to_Haidomyrmecinae_genera_and_species
- AntWiki *Ceratomyrmex ellenbergeri*: https://www.antwiki.org/wiki/Ceratomyrmex_ellenbergeri
- AntWiki *Haidomyrmex cerberus*: https://www.antwiki.org/wiki/Haidomyrmex_cerberus
- AntWiki *Linguamyrmex vladi* / *brevicornis* / *rhinocerus*: https://antwiki.org/wiki/Linguamyrmex_vladi , https://antwiki.org/wiki/Linguamyrmex_brevicornis , https://antwiki.org/wiki/Linguamyrmex_rhinocerus
- Guo et al. 2021, ZooKeys 1048: https://zookeys.pensoft.net/article/66920/
- Barden, Perrichot & Wang 2020, Curr. Biol. (abstract): https://digitalcommons.njit.edu/fac_pubs/4934 ; NJIT news: https://news.njit.edu/new-fossil-discovery-shows-how-ancient-hell-ants-hunted-killer-headgear
- Barden, Herhold & Grimaldi 2017, Syst. Entomol. (abstract): https://digitalcommons.njit.edu/fac_pubs/9275
- Lattke & Melo 2020, Cretaceous Research (PDF via AntWiki): https://antwiki.org/wiki/images/e/e3/Lattke,_J.E.,_Melo,_G.A.R._2020._New_haidomyrmecine_ants_(10.1016@j.cretres.2020.104502).pdf
- Perrichot, Wang & Barden 2020: https://digitalcommons.njit.edu/fac_pubs/5342
- *Vulcanidris cratensis* (Lepeco et al. 2025): https://www.sci.news/paleontology/vulcanidris-cratensis-13856.html ; https://zoobank.org/References/98ff88eb-2a16-46e0-98e0-871c4099b876
- Wikipedia: Haidomyrmecinae, Haidomyrmex, Ceratomyrmex, Linguamyrmex, Haidoterminus, Haidomyrmodes, Vulcanidris, Caputoraptor
- Press: Live Science https://livescience.com/hell-ant-in-amber.html ; Smithsonian https://www.smithsonianmag.com/smart-news/metal-horned-vampire-ant-lived-alongside-dinosaurs-180964886/ ; Sci.News https://www.sci.news/paleontology/amber-hell-ant-attack-08721.html
- AntCat *H. cerberus*: https://antcat.org/catalog/438176
