# Realism pass (pilot)

User spec: project doc `claude/realism/01-spec-realism-pass.md`. Pilot first (spec §6): the full texture pass on the
**fire ant worker** (*Solenopsis geminata*) and the full rebuild (model, movement, attacks, textures) of the **stag
beetle** boss (*Lucanus cervus*). Rollout to everything else waits for the user's approval.

## Before (docs/realism/before/)
`creatures.png` (all 14 creatures and bosses, creature lab) and `ants.png` (every ant caste and both termite species,
ant lab), rendered from `main` before any change.

Problems seen:
- **Stag beetle:** a glossy red dome on a black ball with stubby jaws — reads as a tick or a ladybird. No broad flat
  head, no long parallel-sided elytra, mandibles thin rods, legs plain rods.
- **Tarantula:** smooth black tubes with orange balls on the knees; no hair at all.
- **Mantises:** lime-green blobs; box forelegs; no long prothorax, no folded raptorial legs, no wings over the abdomen.
- **Rove beetle:** reads as an ant-like chain of black beads; abdomen too uniform, no raised-tail threat look.
- **Wolf spiders, spiderling, Hogna:** shape fine, but smooth and flat-coloured; no hair, no stripes, no eye pattern.
- **Ground beetle, centipedes, woodlouse, cutworm:** acceptable shapes, plastic surfaces (one roughness, no
  microsculpture, no dirt).
- **All ants and termites:** colour by vertex only; one procedural bump for "microsculpture" (aliasing noise in the
  shader, not anatomy-aligned); setae only on some gasters, dark, sparse; no cavity shading at joints and sutures; no
  translucency in legs, antennae or soft abdomens.
- **Brood, food, corpses:** primitive shapes (not rendered here: no lab scene yet; rebuilt in the last rollout batch).

## What the pilot adds

### Baked macro detail (render/bake)
- `detailBake.ts`: per species family, a GPU-baked atlas (two RGBA8 textures with mips): albedo modulation and a
  roughness offset; tangent-space normal, cavity occlusion and hair-socket mask. Each **region** (head, mesosoma,
  waist, gaster, legs, tarsi, antennae; elytra, pronotum, head, mandibles, legs, underside, antennae for beetles) is a
  seamless tile of real cuticle at its real size in mm: punctures (with pale rims where hairs sit), striae,
  reticulation, granules, fine irregularity, mottling and dust in the hollows. Baked once on the first use of a
  species (a few ms on a GPU), cached.
- Geometry carries `aDet` (angle around the part, mm along it, 0..1 along it, region and girth). Lofted and tubular
  pieces get it automatically (antGeometry `loft`, `tube`, `ellipsoid` return the surface coordinates), so the
  sculpture runs along the body and repeats at true scale whatever the part's size.
- `detailShading.ts`: one shader patch for any physical material: albedo, relief normal (tangent frame from
  screen-space derivatives), roughness, cavity occlusion, darker joints and sutures, a paler underside, clearcoat
  broken in the pits, and light through thin cuticle (back light and wrap, for legs, antennae and soft gasters).
  Mip-clamped sampling with a fade so far-away ants never shimmer.
- `recipes.ts`: the fire ant (smooth, shining, sparse hair-bearing punctures; legs and antennae densely punctate;
  waist finely granulate) and the stag beetle (elytra finely shagreened with shallow punctures; head reticulate-
  granulate; pronotum granulate-punctate; mandibles smooth and glossy with sparse punctures; legs punctate).
- Fire ant: pale golden **erect setae** on the head, mesosoma and gaster (`morph.setae`), as in the reference notes.

### Stag beetle rebuild (render/creatures/stagBeetle.ts, sim/creatures/creatureAI.ts `stag`)
- **Model:** sculpted part meshes drawn instanced like the old primitives (`registerPart`, `Rig.part/partFrame`),
  with the baked atlas. A 60 mm major male: long parallel-sided domed elytra with the suture and painted shading;
  a transverse pronotum with sharp margins; a broad flat head flaring to sharp front angles, a ridge across the
  front, eyes far back under the canthus; antler mandibles ⅓ of the length, broad at the base, sweeping in like a
  caliper to forked tips, the big inner tooth just past the middle and small denticles; elbowed antennae with a
  four-lamella comb club; legs with flattened femora, a toothed fore tibia, spined mid and hind tibiae, five-
  segment tarsi and claws; the underside plates. Climb rails and riding slots regenerated from the new model.
- **Movement:** slow tripod gait whose stance sweep matches the distance walked (no foot sliding), the body rolling
  toward the planted tripod and heaving each step, feet set on the ground under them, knees out to the sides.
- **Attacks (deterministic sim, numbers in `balance.ts` `STAG`):**
  - *Grab and lift:* after the cone telegraph it clamps the nearest one or two ants between the antlers
    (`gripAnt`), lifts them off the ground while the jaws squeeze, then *tosses* them to one side with a flick of
    the head (as males throw rivals off a branch). Other ants in the cone are bitten and knocked aside.
  - *Plough:* walking into a swarm it shoves the ants in front aside instead of stopping.
  - *Enraged:* rears up on the hind legs with the forelegs raised and antlers spread (red ring telegraph kept),
    then slams down.
  - Tests: `tests/realism.ts` (grab, lift height, sideways toss, landing, plough, determinism).

## Texture memory
Atlases are baked per family at the size of their cells (recipe `px`) plus gutters, RGBA8, two textures, with mips
(×4/3). Pilot: fire ant ~2048×1024 (≈22 MB), stag beetle ~2048×1024 (≈22 MB). For the rollout the cells will be
halved for ants that only the observe camera sees up close, and `setBakeRenderer(r, 0)` (low quality) halves every
cell on phones; budget target 96 MB on desktop for all families, 24 MB on phones.

## Screenshots (docs/realism/pilot/)
`before_*` / `after_*`: macro close-up, gameplay zoom, far zoom; `after_strip_*`: the stag beetle walking, opening
its antlers, lifting two fire ants, tossing them, rearing and slamming. Sheets: `fire_ant.png`, `stag_beetle.png`,
`stag_strip.png`.

## Sources (study only; nothing copied into the game)
- *Lucanus cervus*: [Wikipedia](https://en.wikipedia.org/wiki/Lucanus_cervus); docs/creatures/lucanus-cervus.md.
- *Solenopsis geminata*: [AntWiki](https://www.antwiki.org/wiki/Solenopsis_geminata); docs/creatures/solenopsis-geminata.md.
