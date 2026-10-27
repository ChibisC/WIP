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

## Mandibles (jaws pass, 2026-10-27)

Built by the shared generator (`src/render/anatomy/mandible.ts`) from `FIRE_WORKER` and `FIRE_MAJOR` in
`src/render/anatomy/mandibleSpecs.ts`. Measured on the reference photos fire_02, fire_04 and fire_07 (study
only) and the descriptions above. Fractions are of the mandible's own length, hinge to apex along the outer
margin.

| | Worker and soldier (`FIRE_WORKER`, also the queen) | Major (`FIRE_MAJOR`) |
|---|---|---|
| Outline (top) | Triangular plate. The outer margin is a quarter ellipse: straight ahead at the hinge, curving in to an apex just past the midline, 0.47 of the hinge's distance from the midline in front of it. The basal margin (under the clypeus) runs to the basal angle at u 0.48. From there the straight masticatory margin runs about 30° off transverse to the apex. Widest (0.19) at the basal angle. The outline was derived from a target triangle (docs/realism/jaws.md). | A broader quarter ellipse (apex 0.55 ahead). Broad (0.37 at the base), the cutting edge a blunt rounded ridge. |
| Thickness (side) | 0.11 at the hinge to 0.05 at the apex. The cutting edge is a wedge (bevelled to 16 % of the local thickness) and the underside flatter. Curves down 0.1–0.3 rad below the head's plane. | Deep: 0.42 to 0.2, the edges rounded. Curves down 0.24–0.74 rad round the front of the head. |
| Teeth | Four: the apical tooth (the apex itself, largest) and three on the masticatory margin at u 0.885, 0.76 and 0.62. They get smaller toward the basal angle and lean toward the apex. | One low rounded crown (worn flat milling seed): nearly toothless. |
| Tip | A single pointed apical tooth. | Blunt. |
| Colour | Reddish brown (#8a3816) through #6a2a10 to near black (#1c0b05) at the apex and on the teeth. | Black-brown (#2a1209) to near black. |
| Surface | Faintly striate lengthwise with scattered hair pits (detail recipe `FIRE_MAND`), slightly glossy, the thin edge translucent. | As the worker's, duller. |
| Hinge | At the head's anterolateral corners, just under the front margin, 0.84 of the half-width out. The length is fitted so the closed apexes cross a little (10 %) past the midline. | Set higher into the face (0.93 of the head's length, 0.07 of its height below the centre), so the jaws continue the head's front as a blunt muzzle. They meet on the midline. |
| Closed / open | Closed, a low arc in front of the head. The clypeal lobe covers the bases and the space between the cutting edges, so from above the jaws barely show past it. Open, each swings 0.7 rad (the pair about 80° apart). | Each swings 0.55 rad. |

**Head (jaws review).** The worker's head is a rounded square: nearly parallel sides, the front still broad.
The clypeus is a lobe projecting forward over the closed jaws. The antennae insert near the front, close to
the midline. The surface is smooth and shining, with no reticulate cells. The clypeal carinae are left off
(too small to show; at game scale their ends read as prongs). The major's face darkens gradually into its
jaws, the lower front most, and its profile slopes down to them.

## Animation (animation pass, 2026-10-27)

See docs/realism/animation.md. Tripod gait with planted feet. Five idles (antenna grooming, leg rubbing,
looking round, antennating, small repositioning steps). Three attacks: the lunge bite, grip-and-sting (the
jaws seize, the gaster swings under and the sting jabs while the ant pivots round its grip), and the side
clamp and tug. Two hit reactions (recoil, side flinch). Two deaths (onto the back, onto the side).

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
