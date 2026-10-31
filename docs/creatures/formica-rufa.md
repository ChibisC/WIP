# Red wood ant — *Formica rufa* (Formicinae)

## Size
- Workers 4.5–9 mm (moderately polymorphic). Queen 9–11 mm. Male ~10 mm.

## Anatomy and proportions (worker, L = 7 mm)
- Head .24 L, slightly wider behind the eyes; **large eyes** (~.30 of head
  length) set on the upper sides; **three ocelli** on the vertex.
- Antennae 12 segments; long scape (≈ 1.15 head length), slender funiculus.
- Mandibles large triangular blades, 8 teeth.
- Mesosoma .34 L, longer and more slender than Lasius, distinct
  meso-metanotal dip, rounded propodeum, no spines.
- Petiole a thick upright scale, .05 L.
- Gaster .37 L, oval, acidopore at tip.
- Long legs: hind leg ≈ 1.10 L. Long-legged, rangy look.

## Colour and surface
- **Bicoloured**: head dark brown on the vertex and back, reddish on the
  clypeus, cheeks and underside; mesosoma bright rusty red with a dark
  blotch on the promesonotal dorsum; petiole red-brown; gaster blackish
  brown with faint reddish base; legs dark brown.
- Moderately shiny, sparse erect hairs (rufa is hairier than F. polyctena),
  fine pubescence on the gaster. Slight clearcoat on gaster and head.

## Movement
- Fast, purposeful (~30 mm/s). Holds the gaster slightly raised when excited.
- Trunk trails radiate from the mound to trees, used for years.

## Signature behaviour
- **Formic acid spray**: bends the gaster forward between the legs (under the
  body) and sprays a jet of up to ~60% formic acid from the acidopore at an
  enemy in front, often while biting first to open a wound.
- Builds large **thatched mounds** of conifer needles, twigs and resin over
  the nest, with many entrances; mound acts as a solar collector.
- Aggressive territorial fighter; hunts other insects; also tends aphids.
- Game: strong melee + armour-piercing ranged acid; slower brood; mound
  chamber unique to species.

## Facts for info cards
- Red wood ant nests can hold several hundred thousand workers and many queens.
- They carry pieces of conifer resin into the nest, which has antimicrobial effects.
- Formic acid was first isolated (1671) by distilling crushed ants — its name comes from formica.

## Realism rollout — shapes as numbers (batch 1, overnight 2026-10-31)
All lengths are fractions of the body length L (worker L = 7 mm) unless marked; the model's numbers live in
`src/render/ants/morphs.ts` and `src/render/anatomy/mandibleSpecs.ts`.

| Part | Worker (7 mm) | Soldier (8.6 mm) | Mortar (7.6) / Rapid (7.2) | Queen (10.5 mm) |
|---|---|---|---|---|
| Head length / width / height | .24 / .22 / .15, rounded triangle, widest behind the eyes | .27 / .275 / .17 | as worker | .17 / .17 / .11 |
| Eye | elongate oval (1.3 : 1), .27 of head length, at .48 of it, low dome set into the outline | .26 | as worker | as worker; ocelli larger |
| Ocelli | three glints on the vertex | yes | yes | yes |
| Antenna | 12 segments; scape 1.15 head lengths; funiculus 1.2 × scape | as worker | as worker | as worker |
| Mesosoma | .34 long, .12 wide, .13 high; mesonotal groove deep (.22), propodeum high and rounded (.64), pinched in the middle from above (.22) | .33 / .145 / .15 | .31–.33 | .32 / .17 / .19, queen thorax with wing scars |
| Petiole | one upright scale, .05 long, .12 high | as worker | as worker | .035 / .11 |
| Gaster | .37 long, .25 wide, .21 high, broad oval; acidopore with a hair ring | .35 / .22 / .18 | Mortar .44 / .27 / .22 (acid reservoir), Rapid .40 / .215 / .17; acidopore 1.7× / 1.5× with a visible nozzle | .48 / .28 / .23 |
| Hind leg | 1.10 L | 1.02 | 1.02 | .75 |

**Mandibles** (`FORMICA_WORKER`, the formicine generator): flat triangular blades (user note 2026-10-31: "more
triangular than crescent"). External margin nearly straight from the hinge, set .68 rad inward, turning in over the
last fifth (+.77 rad at the apex); masticatory margin straight from the apex to a broad basal angle (u .30, .46 of the
blade length across, × 1.15); 8 teeth from u .92 to .40, alternating large/small, the apical largest; the blade
rolled .6 rad (toothed margin below the external one) so the open jaw shows its flat face from the side; pitch
−.12 → −.30 → −.56 (a beak hooking down toward the point, as in the side photos); thickness 1.85 × the fire ant's;
closed, the apical teeth cross a little past the midline (reach 1.14). Colour: red-orange (#a04a20 base →
#5a2410 tip), teeth near black (#1a0a06), the cutting edge darkened .6.

**Colours** (sRGB, the model's base values; photo samples in docs/realism/formica-rufa/README.md): head dark brown
#2a1f19 on the frons and vertex grading to rust red #8a4220 on the genae, clypeus sides and behind the eyes;
mesosoma rust red #8e4424 with a dark promesonotal blotch (#2a1a10); petiole #84391c; gaster warm dark grey-brown
#3e3029 under a fine silvery pubescence (satin, sheen .65), the tergite hind margins pale; legs and antennae dark
brown #2a1d16 → #4a3022. Queen mesosoma darker (#5e2614 → #1c120c on top), her gaster shinier.

**Where the photos disagree**: the amount of dark on the head and pronotum varies a lot between workers (and between
F. rufa and F. polyctena); the model takes the middle (dark frons and vertex, red below the antennal sockets). Field
photos make the gaster look black and glossy in sun, specimen photos grey and frosted; the model is satin with a
pale pubescence sheen.

**Sources**: AntWiki *Formica rufa* (description; Borowiec & Salata 2022); AntWeb specimen images (head, profile,
dorsal); the user's 20 reference photos (study only, never shipped).
