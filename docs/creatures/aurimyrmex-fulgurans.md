# Aurimyrmex fulgurans ("Saiy-Ants") — creature reference

Target file in the repo: `docs/creatures/aurimyrmex-fulgurans.md`. Copy this doc there when implementing.

**This species is fictional.** Everything below the "Fictional biology" section is real formicine/*Camponotus* anatomy, so the models and animations read as a believable ant with one invented trait. Checked 2026-10-24.

## 1. Identity
- Display name: one config value, `SPECIES_DISPLAY_NAME.aurimyrmex = "Saiy-Ants"` (fallback `"Gilded Ants"`). Nothing else in UI text or docs hard-codes the nickname.
- Scientific name: *Aurimyrmex fulgurans* — Latin *aurum* (gold) + Greek *myrmex* (ant) + Latin *fulgurans* (flashing). Internal id `aurimyrmex`; castes `aurimyrmex_worker`, `aurimyrmex_soldier`, `aurimyrmex_blaster` (section 7), `aurimyrmex_queen`; morph keys `saiy_worker`, `saiy_soldier`, `saiy_blaster`, `saiy_queen` (the prototype used these; keep or rename consistently).
- Fictional placement: Formicinae, close to the carpenter ants (*Camponotus*). Leaf litter of tropical forest.

## 2. Fictional biology (for the in-game info card)
- Cuticle with stacked thin reflective layers, like the real golden tortoise beetles (*Charidotella*). At rest the layers are dull black because the spaces between them are empty and scatter light.
- When alarmed, the ant floods the layers with hemolymph: the stack becomes a coherent multilayer mirror and the ant flashes metallic gold for about ten seconds (four before 2026-11-07: the user's spec 09 made it last at least ten). At the same time it dumps stored energy into its muscles: faster running, harder bites. The effort exhausts it, so it needs about thirty seconds to recover, during which the cuticle looks dull and matte and the antennae droop.
- Info card fact (hedged to match the sources): **"Inspired by the golden tortoise beetle, whose shell can switch between metallic gold and dull red when it is disturbed."**

### What is true about the beetle (so the card stays honest)
- *Charidotella egregia* (Panama) and *C. sexpunctata* (North America) are both called golden tortoise beetles. Vigneron et al. 2007 (*Physical Review E* 76:031907, "Switchable reflector in the Panamanian tortoise beetle *Charidotella egregia*") showed the gold comes from a chirped multilayer reflector in the transparent cuticle whose porous layers are filled with liquid; when the beetle is disturbed it withdraws the liquid, the reflector collapses, and a red pigment layer underneath shows through as matte red.
- **Direction is the opposite of the game's:** in the real beetle gold is the rest state and dull red is the alarmed state. The game inverts it deliberately (dull at rest, gold when alarmed). Say so in the doc.
- **Timing:** popular accounts say "within seconds"; the 2007 abstract gives no figure, and the press coverage describes the change as taking from seconds to a couple of minutes. The original brief's card text "can change color in seconds" is softened to "when it is disturbed".
- Sources: Smithsonian repository record of Vigneron et al. 2007 https://repository.si.edu/items/f348b3e2-faac-4ec3-8e88-1b9962e3e0e1 ; Science News, 18 Aug 2007 "Mood bugs" https://www.sciencenews.org/wp-content/uploads/2024/02/sciencenews20070818-dl.pdf ; Wikipedia *Charidotella egregia* https://en.wikipedia.org/wiki/Charidotella_egregia ; WorldAtlas summary https://www.worldatlas.com/animals/the-beetle-that-flashes-from-gold-to-ruby.html

## 3. Real anatomy to model (Camponotus-like formicine)
- **Head:** rounded, heart-shaped from the front with a shallow posterior notch; medium oval compound eyes on the sides; **no ocelli on workers and soldiers**, three small ocelli on the queen; triangular toothed mandibles that close sideways (horizontal plane, like all modern ants); 12-segmented elbowed antennae with a long scape and no club (formicine).
- **Mesosoma:** smooth, evenly arched profile with no spines; the queen has an enlarged mesosoma with visible mesoscutum/scutellum plates and wing scars (she is a dealate after her nuptial flight).
- **Waist:** a single petiole with an upright scale-like node.
- **Gaster:** oval, five visible segments with faint lighter bands at the margins; **no sting** — formicines spray formic acid from a circular acidopore ringed with a fringe of hairs at the gaster tip (the game's shared model already draws this ring when `sting: false`).
- **Legs:** long and slender: coxa, trochanter, femur, tibia with an apical spur, five tarsomeres, two claws; the fore tibia carries the antenna-cleaning comb (strigil). Sparse fine pale erect hairs on head, mesosoma and gaster.
- **Castes and sizes (game):** worker 6 mm, soldier 9 mm (allometric: broader, squarer head, thicker mandibles, sturdier legs; real *Camponotus* majors are the same idea), queen 14 mm.
- **Coloration (normal):** glossy jet black with a faint blue-black sheen in highlights; legs and antennae dark brown, slightly lighter at joints and tarsi; faint lighter gaster bands.
- **Gold form:** polished metallic gold — base `#F2C14E`, highlights `#FFE9A3`, deeper shading `#B8862B` as the brief's targets; the prototype's shader constants are darker in linear space (see the code doc) because the game's ACES tone mapping and sun otherwise blow the gold out to cream.

## 4. Behaviour (real formicine behaviours the animations should show)
- Alternating tripod gait; short bursts with pauses; antennae sweeping the ground; straight runs on trails.
- Bite and hold (legs, antennae), mandible-to-mandible grappling; formic acid sprayed at close range with the gaster curled forward between the legs (the game already has this as the `acid` "opener").
- Food carried in the mandibles with the head raised; cooperative dragging of large items with jerky pulls; brood carried gently.
- Antennation on meeting, grooming through the fore-leg comb, trophallaxis, alarm (mandibles open, gaster raised, rushing), corpse removal.
- **Game-only:** the ten-second gold transformation, its boosts, cooldown and exhausted look. The queen never transforms.

## 5. Design rules (from the brief, kept)
- **Six hair locks (user decisions 2026-10-24, briefs 07 + 08; supersede briefs 05–06 and the earlier crest):** six distinct locks of hair swept straight back off the head — a centre-top lock (longest), an upper pair, a middle pair behind the eyes, one low centre lock above the neck — placed by brief 07's table (head-local units of head length). Each lock is a thick clump of 5–8 narrower strands bundled and twisted slightly, wide at the root and tapering in a gentle S-curve to a sharp point whose tip curls a little upward like gelled hair, the strands splitting into 2–3 fine sub-tips over the last 10–15 %; the locks overlap at the roots and grow out of one continuous scalp cap behind the antenna bases, with a few short stray hairs between them. Tips 0.2–0.35 head lengths past the back of the head, never onto the thorax; nothing in front of the antenna bases and nothing over the eyes. Soldier: thicker, more tightly bundled locks, heavier cap. Queen: top three locks ×1.5 in length, more strands, glossier, softly curling, solid tips, a faint permanent amber at the tips. Fictional-biology framing: dense fused setae forming a streamlined dorsal comb — keratin-like, slightly flexible, shedding leaf litter and deflecting bites to the neck. Material: hair, not chitin — deep black with a blue-black anisotropic highlight band along the strands, slightly rougher than the glossy head; tips translucent dark brown when backlit. Gold form: ripple starts at the locks; metallic gold `#F2C14E` with pale `#FFF0B8` tips, the band becomes a golden streak, faint bloom at the tips only, locks lengthen ×1.3 along their own direction with a springy overshoot (never rising) and shed short golden speed lines while running. Exhausted: locks droop flatter and the band dulls. Motion: stiff like gelled hair but springy — light sway from acceleration and turning, tips lagging the head, slight backward flutter while running. The design is original and low/swept-back; it must not be modelled on any anime or cartoon character's hairstyle. No spines anywhere on the mesosoma or waist; mesosoma one smooth even arch.
- Effects stay subtle so 300+ transformed ants remain readable.

---

**Game note (2026-10-25, the user's decision):** in the game Saiy-Ants have **no formic acid** — they fight with bites only (pure physical damage). The acidopore is still modelled as real formicine anatomy, but it is never used.

## 6. Model redo (2026-11-07, `claude/realism/10-spec-saiy-ant-sickle-jaw-models.md`): the shape numbers

Rebuilt on the fire ant pilot's playbook (`src/render/ants/saiyMorphs.ts`, the shared builder with the formicine and *Camponotus* terms in `antGeometry.ts`, the baked recipe `SAIY` in `render/bake/recipes.ts`). The numbers below are fractions of body length L unless marked, taken from published *Camponotus* measurements (Mackay 2019, the AntWiki species pages for *C. pennsylvanicus*, *C. ligniperda*, *C. gigas*: head length/width indices, scape index, mesosoma length, eye position) because the specimen photos could not be downloaded into the workspace; **tracing over specimen photos is still to do** when the user supplies them (`tools/mandible-overlay.py`).

| Part | Worker (6 mm) | Soldier (major, 9 mm) | Queen (14 mm) | Source / note |
|---|---|---|---|---|
| Head length × width × height | 0.245 × 0.205 × 0.155 (CI 84) | 0.26 × 0.27 × 0.19 (CI 104, heart-shaped, posterior notch 0.07) | 0.20 × 0.215 × 0.15 | *Camponotus* minors CI 80–90, majors 100–115 |
| Eyes (size, position back along the head, height) | 0.25, 0.42, 0.24 | 0.22, 0.40, 0.22 | 0.26, 0.45, 0.24, three ocelli | eyes set back on the sides |
| Antennal sockets | 0.73 head lengths back, 0.2 up, 0.17 head widths out | same | same | set clearly behind the clypeus' rear edge (a *Camponotus* feature) |
| Clypeus | a raised plate with a median keel, its rear margin a dark suture, at 0.9 of the head | same | same | |
| Antenna | 12 segments, scape 1.12 (× the builder's base), funiculus 1.35 | scape 0.93 (majors' scapes are relatively shorter) | scape 0.87 | SI falls with head width |
| Mandibles | triangular, 5 teeth, length 0.38, broad 1.2, thick 1.9 (`SAIY_WORKER_JAW`) | 5 teeth, broad 1.4, thick 2.5, heavier teeth (`SAIY_SOLDIER_JAW`) | 5 teeth (`SAIY_QUEEN_JAW`) | *Camponotus* 5–7 teeth; colour darkening to the tips |
| Mesosoma | length 0.355, one smooth even arch, no spines | 0.34 × 0.135 × 0.15 | 0.35 × 0.185 × 0.2, wing scars | |
| Petiole | one upright scale, node height 0.13 | same | 0.11 | |
| Gaster | 0.36 × 0.235 × 0.2, acidopore with a hair fringe (never used: bites only) | 0.35 × 0.24 × 0.2 | 0.43 × 0.30 × 0.25 | |
| Hind leg | 1.18 × the builder's base (long, leggy), thickness 0.0135 | 1.08, thickness 0.0165 (sturdier) | 0.88 | |
| Colour | head `#0B0A0E` with a blue-black sheen `#181B2A`, gaster `#0A090C` with golden-grey pubescence `#B8A47A` (70 setae), legs `#161110` | head sheen `#1A1D2C` | as the worker | |

Animation: the planted-feet walk (`ANIM_V2_PREFIXES`), three bites per caste never the same twice running (worker lunge, clamp-and-tug, chomp; soldier crush, head swing, chomp; queen lunge, clamp, crush), **no acid**; the gold surge's stretch (head thrown up, gaster lifted, overshoot) as the ripple comes on, faster bites with gold sparks (`combatFx`), the exhausted droop. The six-lock hair is unchanged (briefs 07 and 08).

## 7. The Blaster (2026-11-07, `claude/saiy-ants/09-spec-saiy-blaster.md`; CHANGE_PLAN §31)

A ranged caste, `aurimyrmex_blaster`, display name **Blaster** (Termants that steal it: **Saiy-Ant Blaster**). Fictional,
like the gold form: it spits **glowing energy orbs from its mouth** — pale white-blue normally, gold in the gold form —
and in the gold form every fifth shot is a **straight beam for 3 s** while it stays planted. Physical damage only (armour
applies; no acid, venom or fire); allies are never hurt.

- **Fictional biology (info card):** "Its gold-form layers store charge like the rest of the colony's, but the Blaster
  dumps it through a broad, light-producing mouth instead of into its muscles: a pulse at a time, or all at once in a
  beam." There is no real animal behind the orbs; the light organ is borrowed in spirit from bioluminescent beetles.
- **Model** (`saiyMorphs.ts` `SAIY_BLASTER`, built on the worker with the same playbook as §6): 6.6 mm (the worker 6),
  slimmer and lighter — mesosoma 0.37 × 0.108 × 0.124, gaster 0.33 × 0.20 × 0.172, longer legs (hind 1.24, thinner
  0.0122); a larger, rounder head 0.27 × 0.25 × 0.19 (CI 93; the worker's 84) with bigger-set eyes; the jaws longer and
  set wider (length 0.46, broad 0.86, resting open 0.75) round a **mouth-glow piece** between their bases (a soft
  ellipsoid at 0.955 of the head, surface flag 9.5). The glow comes from the mouth between the parted jaws — no new
  orifice. The same six locks, swept back further (pitch lowered toward the head line, spread narrowed ×0.65, tips no
  longer curled up, ×1.18 longer). Gold form: the whole ant takes the gold shader as every Saiy-Ant does; the mouth glows
  gold instead of white-blue.
- **Animation** (`game/antViews.ts` `blastPose`): a faint glow at rest; aiming, the head turns to the target and the jaws
  part wide while the glow builds (the 0.32 s wind-up; the beam's charge builds harder); each orb kicks the head and the
  front of the body back, the planted feet soak it up; during the beam the feet plant wide (`brace`), the body sinks, the
  head stays on the line, the whole ant trembles and the mouth blazes. Heads face straight ahead the rest of the time.
- **Shots** (`sim/saiyBlaster.ts`): range 40 mm (melee reach < 10, the mortar 56); orbs fly straight at 150 mm/s at
  where the target was and hit the first enemy they touch (walls stop them; they fizzle at 1.3 × range). Shot counter: in
  the gold form shots 1–4 are orbs, shot 5 the beam; outside it, orbs only. The beam: 9 body lengths (59 mm), aimed down
  the densest line of enemies in reach, cut by walls, 3 s, a pulse every 0.25 s on every enemy crossing it, the Blaster
  planted (no moving, turning or orders); a fling, a grab or death ends it; the gold form ending does not. Then 2.5 s
  before the next shot.
- **Effects** (`render/game/blastFx.ts`): the orb a bright core (the only part that blooms), a coloured shell with
  swirling crackle, a short tapering trail and light on the ground; a burst of light, sparks and dust on a hit, a soft pop
  on a fizzle; the beam a bright core line in a thicker rippling, flickering glow, a charge ball at the mouth, a burst at
  the far end, light along the ground, a flash on and a fade off. **Sounds** (made for this game, `recipes_combat.py`):
  a rising charge hum, a punchy "fwip", an impact sizzle, the beam's steady roar-hum. Nothing is modelled on any show's
  attack, pose, look or sound; the attack has no name from one.
