# Aurimyrmex fulgurans ("Saiy-Ants") — creature reference

Target file in the repo: `docs/creatures/aurimyrmex-fulgurans.md`. Copy this doc there when implementing.

**This species is fictional.** Everything below the "Fictional biology" section is real formicine/*Camponotus* anatomy, so the models and animations read as a believable ant with one invented trait. Checked 2026-10-24.

## 1. Identity
- Display name: one config value, `SPECIES_DISPLAY_NAME.aurimyrmex = "Saiy-Ants"` (fallback `"Gilded Ants"`). Nothing else in UI text or docs hard-codes the nickname.
- Scientific name: *Aurimyrmex fulgurans* — Latin *aurum* (gold) + Greek *myrmex* (ant) + Latin *fulgurans* (flashing). Internal id `aurimyrmex`; castes `aurimyrmex_worker`, `aurimyrmex_soldier`, `aurimyrmex_queen`; morph keys `saiy_worker`, `saiy_soldier`, `saiy_queen` (the prototype used these; keep or rename consistently).
- Fictional placement: Formicinae, close to the carpenter ants (*Camponotus*). Leaf litter of tropical forest.

## 2. Fictional biology (for the in-game info card)
- Cuticle with stacked thin reflective layers, like the real golden tortoise beetles (*Charidotella*). At rest the layers are dull black because the spaces between them are empty and scatter light.
- When alarmed, the ant floods the layers with hemolymph: the stack becomes a coherent multilayer mirror and the ant flashes metallic gold for about four seconds. At the same time it dumps stored energy into its muscles: faster running, harder bites. The effort exhausts it, so it needs about twenty seconds to recover, during which the cuticle looks dull and matte and the antennae droop.
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
- **Game-only:** the four-second gold transformation, its boosts, cooldown and exhausted look. The queen never transforms.

## 5. Design rules (from the brief, kept)
- **Six hair locks (user decisions 2026-10-24, briefs 07 + 08; supersede briefs 05–06 and the earlier crest):** six distinct locks of hair swept straight back off the head — a centre-top lock (longest), an upper pair, a middle pair behind the eyes, one low centre lock above the neck — placed by brief 07's table (head-local units of head length). Each lock is a thick clump of 5–8 narrower strands bundled and twisted slightly, wide at the root and tapering in a gentle S-curve to a sharp point whose tip curls a little upward like gelled hair, the strands splitting into 2–3 fine sub-tips over the last 10–15 %; the locks overlap at the roots and grow out of one continuous scalp cap behind the antenna bases, with a few short stray hairs between them. Tips 0.2–0.35 head lengths past the back of the head, never onto the thorax; nothing in front of the antenna bases and nothing over the eyes. Soldier: thicker, more tightly bundled locks, heavier cap. Queen: top three locks ×1.5 in length, more strands, glossier, softly curling, solid tips, a faint permanent amber at the tips. Fictional-biology framing: dense fused setae forming a streamlined dorsal comb — keratin-like, slightly flexible, shedding leaf litter and deflecting bites to the neck. Material: hair, not chitin — deep black with a blue-black anisotropic highlight band along the strands, slightly rougher than the glossy head; tips translucent dark brown when backlit. Gold form: ripple starts at the locks; metallic gold `#F2C14E` with pale `#FFF0B8` tips, the band becomes a golden streak, faint bloom at the tips only, locks lengthen ×1.3 along their own direction with a springy overshoot (never rising) and shed short golden speed lines while running. Exhausted: locks droop flatter and the band dulls. Motion: stiff like gelled hair but springy — light sway from acceleration and turning, tips lagging the head, slight backward flutter while running. The design is original and low/swept-back; it must not be modelled on any anime or cartoon character's hairstyle. No spines anywhere on the mesosoma or waist; mesosoma one smooth even arch.
- Effects stay subtle so 300+ transformed ants remain readable.

---

**Game note (2026-10-25, the user's decision):** in the game Saiy-Ants have **no formic acid** — they fight with bites only (pure physical damage). The acidopore is still modelled as real formicine anatomy, but it is never used.
