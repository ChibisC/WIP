# Realism references (study only)

Reference photos and descriptions are used **only to study** colour, gloss, sculpture, hair and translucency.
Nothing from them is copied into the game: no photo is a texture, sampled into a texture, or shipped. Every
surface in the game is generated procedurally (`src/render/bake/`, recipes in `src/render/bake/recipes.ts`).
Comparison sheets that contain photos stay out of the public repository (`docs/realism/pilot-v2/.gitignore`).

Colours are approximate sRGB under neutral light. Values marked *(literature)* come from written
descriptions; values marked *(sampled)* were measured on the reference photos with `tools/realism-metrics.py`
(part polygons in the photos' `refs.json`).

## Tropical fire ant worker, *Solenopsis geminata* (minor worker, 2.4–3 mm)

| part | colour | gloss | sculpture | hairs | translucent |
|---|---|---|---|---|---|
| head | reddish brown, often a little darker or redder than the mesosoma *(literature: "reddish brown"; head "brown")*; target ≈ #8a4826 | smooth and shining | conspicuous, abundant hair-bearing punctures (piligerous foveolae) over the dorsum; clypeus with two carinae ending in teeth | abundant, erect, thin, pale yellowish-gold, 0.13–0.37 mm | mandible tips, antennae |
| mesosoma | reddish brown to orange-brown ≈ #94522c | shining | promesonotum with foveolae like the head; mesopleuron striate-punctate in small workers; propodeum with transverse striae, rugose around the spiracle; promesonotal suture | abundant erect hairs on the promesonotum | thin edges |
| waist | as the mesosoma | peduncle and sides duller | petiole node sides areolate-punctate, peduncle transversely striate; postpetiole dorsum shiny, sides rugose-punctate | a few erect hairs on each node | — |
| gaster | dark brown behind a paler (orange-brown) base; "concolorous orange-red with only the posterior portion of the gaster dark brown" at one extreme ≈ #3a2416 / #744026 | smooth and fairly shiny; its highlight broken by the hairs and scattered punctures | scattered hair punctures; tergite hind margins thin and paler | numerous erect hairs | tergite margins, intersegmental membranes |
| legs, antennae | lighter, yellowish to reddish brown, the antennal club darker | satin | dense fine punctures | short erect and suberect hairs | strongly (thin cuticle) |

Colour varies a lot between colonies (from orange-red to nearly brownish black), little within one; smaller
workers tend to be darker. Highlights in photos are sharp but small and broken (hairs, punctures, the
convex plates), never one smooth disc.

Sources: [Pest Ant Identification fact sheet](https://idtools.org/id/ants/pia/Fact_Sheets/Solenopsis_geminata.html);
[AntWiki, *Solenopsis geminata*](https://antwiki.org/wiki/Solenopsis_geminata) (Trager 1991 description: colour
range, foveolae, mesopleural and propodeal sculpture, pilosity 0.13–0.37 mm); [Ants of Africa](https://antsofafrica.org/ant_species_2012/solenopsis/solenopsis_geminata/solenopsis_geminata.htm)
(reddish brown body, brown head; "shiny and polished"); AntWeb specimen photographs (CASENT0104522,
CASENT0063126, CASENT0102966 workers; photographer April Nobile) for proportions.

## Stag beetle, *Lucanus cervus* (major male, 50–75 mm)

| part | colour | gloss | sculpture | hairs | translucent |
|---|---|---|---|---|---|
| head | black | dull to satin | coarsely granulate-reticulate; the transverse ridge and front angles; eyes divided by the canthus | — | — |
| pronotum | black | satin | finely granulate with scattered punctures; sharp lateral margin | — | — |
| elytra | chestnut brown (reddish brown in strong light, never bright red) ≈ #5a321c | **satin, not mirror**: a soft, broad highlight with a fine grain | finely shagreened (dense micro-granules), shallow scattered punctures; suture, humeral calli, a fine raised margin | — | — |
| mandibles | reddish brown, darker toward the points and on the teeth ≈ #6a3418 → #24100a | satin to dull | finely granulate-punctate; flattened, branched at the tip (an upper tine), a large inner tooth, small denticles | sparse short hairs on the inner face | the points, thinly |
| legs | black | satin | punctate; fore tibia with teeth on the outer edge, mid and hind tibiae with small spines; five-segment tarsi with claws | golden pads and hairs under the tarsi | — |
| underside | black | dull | punctate, with fine golden-brown hairs on the thoracic sternites | yes | — |

Sources: [Wikipedia, *Lucanus cervus*](https://en.wikipedia.org/wiki/Lucanus_cervus) (black body, reddish
elytra, red mandibles in males; sizes); [DELTA British Coleoptera, Lucanidae](https://www.delta-intkey.com/britin/sca/www/lucanida.htm)
(family: glossy elytra, mandible apices bidentate to multidentate); photographs by George Chernilevsky
(Wikimedia Commons, [*Lucanus cervus* male 2017](https://c.enwp.org/wiki/File:Lucanus_cervus_male_2017_G1.jpg), public domain),
Malcolm Storey ([bioimages.org.uk P2369](https://bioimages.org.uk/image.php?id=2369), CC BY-NC-SA 2.0 UK)
and the Muséum de Toulouse specimen ([Wikimedia Commons](https://c.enwp.org/wiki/File:Cerf-volant_MHNT_male_et_femelle.jpg)).

## Sampled colours (photos)

Pending: the workspace cannot download images, so the photos for colour sampling and the side-by-side
comparison sheets come from the user (study only). `tools/realism-metrics.py docs/realism/pilot-v2/renders <refs>`
fills this section from their `refs.json`.
