# Tropical fire ant — *Solenopsis geminata* (Myrmicinae)

Replaces *S. invicta* as the game's fire ant (user note, 2026-10-24). Checked
against AntWiki (Trager 1991; Creighton 1930; Wetterer 2012) and the Landcare
Research invasive-ant fact sheet. Where those differ from the brief, the
sources win and the difference is noted.

## Castes and sizes (game models)
| Caste | Length | Model |
|---|---|---|
| Worker (minor) | 2.8 mm | base model `fire_minor` |
| Soldier | 4 mm | the SAME model scaled ×1.43 (`CasteDef.scale`): identical proportions, head, mandibles, rig and animations |
| Major | 6 mm | `fire_major`: the worker's body plan with an allometrically huge head and sturdier legs |
| Queen | 8 mm | `fire_queen`: separate model |

Real workers are continuously polymorphic, about 3–8 mm (head width 0.98–2.33 mm).
Queens are 7.5–8 mm.

## Colour and surface
- Head and mesosoma golden reddish-orange to reddish-brown. The major's head is a deeper reddish-brown.
- Gaster dark brown, a little lighter toward the front.
- Legs and antennae paler yellowish-brown, with the 2-segment antennal club darker.
- Colour varies a lot between colonies (from orange-red with only the back of the gaster dark, to nearly brownish-black), and smaller workers tend to be darker.
- Smooth and glossy, not sculptured. Sparse erect pale hairs on the head, mesosoma, waist and gaster, denser short hairs on antennae and legs.

## Worker and soldier head
- Oval to rectangular, about as long as wide (cephalic index 92–108) with rounded back corners.
- Small compound eyes (9–11 facets across), set a little in front of the middle of the head.
- Clypeus with two raised carinae ending in stout, protruding teeth on its front edge, the border concave between them; the median clypeal tooth is absent.
- Small triangular mandibles with four teeth.

## Major head (signature)
- Huge, nearly square head with parallel sides, much wider than the mesosoma.
- **Source correction:** the back edge has a *deep, angular* median notch between two rounded temples, and a *deep* lengthwise groove runs down the top of the head (the brief said "faint"). Modelled as `notch` 0.22 and `groove` 0.16.
- Mandibles short, thick, strongly curved and **black**. Their teeth are present when the major emerges but wear flat from milling seed, so they look blunt and nearly toothless.
- Eyes stay small. Short antennal scapes reach only about halfway to the back of the head.

## Antennae
- 10 segments: scape, funiculus and a distinct 2-segment club.

## Mesosoma
- Promesonotum smoothly convex in profile, a distinct metanotal groove, and a rounded propodeum with **no spines**.

## Waist
- Petiole: a peduncle in front, rising to a wedge-shaped (cuneate) node with a fairly sharp crest, with one or two small teeth underneath at the front (`subTooth`).
- **Source correction:** the postpetiole is lower than the petiole and only slightly wider (1.02–1.08× the petiole's width), not much broader.

## Gaster and legs
- Smooth, oval and dark brown, with faint overlapping tergite bands.
- Retractable sting: it slides out of the gaster tip during sting attacks (vertex shader, sting vertices flagged).
- Legs moderately long and slender on workers and soldiers, proportionally sturdier on the major.
- Not modelled: the strigil on the fore tibia (below the size where it reads).

## Queen
- Dark reddish-brown with a darker gaster.
- Head like a worker's (quadrate, slightly broader than long), with larger eyes and three ocelli.
- Bulky mesosoma with scutum and scutellum, and wing scars.
- Large, elongated gaster.

## Behaviour (game)
- Workers sting repeatedly, and venom stacks.
- Soldiers are mid-sized workers that defend the mound.
- Majors crush with their heads and jaws.
- In real colonies, workers harvest about eight times more seed than *S. invicta* does and store it in granaries, and the majors mill it.
- *S. geminata* foragers are slower and less aggressive than *S. invicta*'s, but defend food once found.

## Facts for info cards
- Majors have huge square heads and blunt mandibles built for milling seeds.
- Native to the Americas, *S. geminata* has spread across the tropics on ships for centuries.
- Its sting is painful, but its venom is chemically different from *S. invicta*'s and considered less potent.

## Sources
- AntWiki, *Solenopsis geminata*: https://www.antwiki.org/wiki/Solenopsis_geminata
- Landcare Research, *Solenopsis geminata* information sheet: https://oldwww.landcareresearch.co.nz/__data/assets/pdf_file/0015/51063/solgem.pdf
