# Black garden ant — *Lasius niger* (Formicinae)

## Size
- Worker 3.5–5 mm (monomorphic, small size variation). Queen 8–9 mm.
  Male 3.5–4.5 mm (winged, small head, large eyes).

## Anatomy and proportions (worker, L = 4 mm)
- Head .23 L long, width ≈ .90 of its length; rounded rectangular, slightly
  narrower in front; eyes medium (~.22 of head length) at mid-sides; ocelli
  absent/inconspicuous in workers.
- Antennae 12 segments; scape ≈ 1.0 head length (just surpassing the occiput),
  funiculus ≈ 1.25 scape, segments slightly thickening toward the tip, no
  distinct club.
- Mandibles triangular, 7–9 teeth, closing neatly in front of the clypeus.
- Mesosoma .32 L, low smooth profile with a shallow metanotal groove,
  rounded propodeum without spines.
- Petiole: one upright scale, top slightly emarginate (notched), .05 L.
- Gaster .40 L, broad oval (widest part ≈ head width), acidopore at tip.
- Hind leg ≈ .95 L; legs moderately long and slender.

## Colour and surface
- Matte dark brown to blackish; mesosoma often slightly paler/browner;
  legs and antennae dark brown, tarsi paler.
- Dense fine appressed pubescence gives a silky grey sheen, strongest on the
  gaster; erect hairs on the gaster, and (diagnostic) on scapes and tibiae.
- Low gloss: roughness high, no clearcoat. Sheen layer for the pubescence.

## Queen
- Mesosoma tall and wide with wing scars on the mesothorax sides; dark brown
  glossier gaster swollen to ~1.6× head width; ocelli present.

## Movement
- Brisk walker, ~15 mm/s foraging; very regular tripod. Forages in long busy
  two-way columns along pheromone trails, often to aphid colonies on plants.

## Behaviour (game mechanics)
- **Aphid tending**: strokes aphids with the antennae to solicit honeydew,
  carries it home in the crop, shares by trophallaxis; protects aphids from
  predators. → Bonus honeydew from tended aphid clusters.
- Balanced, fast-breeding colonies (15–40k workers wild). Single queen,
  queens recorded living ~28 years in the lab.
- Will mob intruders but has no sting: bites and sprays small amounts of
  formic acid from the acidopore at close range.
- Game stats: cheap fast brood, average combat, large population cap.

## Real-world facts for info cards
- Lasius niger queens have lived over 28 years in captivity.
- Workers move from nursing to foraging as they age.
- Their nuptial flights happen on warm humid summer days, often city-wide at once.

## Realism rollout — shapes as numbers (batch 1, overnight 2026-10-31)
Fractions of L (worker L = 4 mm) unless marked; the model's numbers are in `src/render/ants/morphs.ts`.

| Part | Worker (4 mm) | Soldier (4.9 mm) | Queen (8.5 mm) |
|---|---|---|---|
| Head length / width / height | .23 / .21 / .15, rounded rectangle | .25 / .245 / .165 (broader head: a big worker, no true soldier caste) | .15 / .15 / .10 |
| Eye | .22 of head length at .52, low dome set in | .20 | .24, ocelli |
| Ocelli | three tiny glints (spec 3.4) | yes | yes |
| Antenna | 12 segments, scape 1.0 head length, funiculus 1.25 × scape; **erect hairs along the scape** (9 per scape, L. niger's field mark) | as worker | scape .95 |
| Mesosoma | .32 / .13 / .13; metanotal groove deep (.24), propodeum rounded (.68) | .31 / .14 / .14 | .30 / .19 / .22, wing scars |
| Petiole | one scale, top notched, .05 long, .11 high | as worker | .035 |
| Gaster | .38 / .26 / .21, broad oval; acidopore hair ring | as worker | .50 / .35 / .31 |
| Hind leg | .95 L; **11 erect hairs on each tibia** (field mark), 5 on each femur | .93 | .62 |

**Mandibles** (`LASIUS_WORKER`): the formicine triangle (see formica-rufa.md), 8 teeth, heading .68, roll .55, pitch
−.10 → −.26 → −.50, thickness 1.9 ×, reach 1.14; orange-brown (#7a4a24 → #6a3a1c), paler than the head, teeth
#2a1408, the cutting edge darkened .45 (the user's photos: the jaws a paler muzzle in front of the dark head).

**Colours**: head #2c2016, mesosoma #4a3020 (a shade paler), petiole #3e2a1c, gaster #30231a with a grey-golden
pubescence sheen .38; legs #5a3e24 → #9a6c3c toward the tarsi; antennae #5a4028. Not black: dark brown.

**Sources**: AntWiki *Lasius niger* (Wilson 1955; Borowiec & Salata 2022 for the scape and tibia hairs); AntWeb
specimen images; the user's reference photos (study only).
