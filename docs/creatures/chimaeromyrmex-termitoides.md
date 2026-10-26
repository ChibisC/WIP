# Chimaeromyrmex termitoides ("Termants") — creature reference

From the user's package `claude/termyrms/02-reference-termants.md` (copied before the code, as the brief asks), with an "As implemented" section at the end.

**This species is fictional.** Real ants (Hymenoptera: Formicidae) and termites (Blattodea: Termitoidae, i.e. social cockroaches) are only distantly related insects that separated more than 300 million years ago; they cannot hybridize, and no animal gains another species' castes by eating it. Every trait below is nevertheless a real ant or termite trait, so the models and animations read as a believable insect. Checked 2026-10-25.

## 1. Identity
- Display name: one config value, `SPECIES_DISPLAY_NAME.termant = "Termants"` (fallback `"Chimera Ants"`). The user's brief was titled "Termyrms"; the user later fixed the name to **Termants** — use Termants everywhere, and never hard-code it outside the config value.
- Scientific name: *Chimaeromyrmex termitoides* — Greek *chimaira* (chimera) + *myrmex* (ant), Latin *termitoides* (termite-like). Internal id `termant`; castes `termant_worker`, `termant_soldier`, `termant_queen`, `termant_king`; morph keys the same.
- Not related to the game's existing **Gene Thief Ant** (`plagiaria`, *Formica plagiaria*), which borrows castes chosen in the lobby. Termants earn castes during the match by eating other species. The two share the "borrowed castes" machinery.

## 2. Fictional biology (for the in-game info card)
- Lives in rotting logs on the forest floor. Imagined to have evolved by absorbing genetic material from the insects it eats — which is how it became part ant, part termite, and why it keeps changing.
- **From ants:** hardened front body, elbowed antennae, eyes on workers, sideways-closing toothed mandibles, formic acid, trail pheromones, hunting live prey.
- **From termites:** soft translucent abdomen with gut microbes that digest wood, a frontal gland that secretes sticky defensive glue, a royal pair (queen **and** king), carton nest building. (Real termites can also raise replacement reproductives; the game leaves that out — user note, 2026-10-25: one queen, no replacement queens.)
- **Gene stealing:** when workers feed the queen tissue from other species, she can lay eggs that hatch into that species' castes, raised and controlled as part of the Termant colony.
- Info card fact (true of termite queens): **"A termite queen is fed and cleaned by workers all her life while her abdomen swells with eggs; Termants keep her that way, with the king always at her side."** (The package's original fact, about replacement queens, was dropped with that mechanic.)
- Card disclaimer line: "Ants and termites are only distantly related and cannot hybridize or share genes like this."

### The real traits behind each feature (so the doc stays honest)

| Feature | Real source |
|---|---|
| Hardened glossy head + mesosoma, elbowed 12-segment antennae, sideways triangular mandibles, compound eyes on workers | Formicine ants (*Formica*, *Lasius*) — the game's existing ant base |
| Bead-like (moniliform) antenna segments toward the tip | Termites (worker/soldier antennae are strings of beads) |
| Cone-shaped frontal gland pore on the forehead; soldier's long forward-angled "nasus" that sprays sticky glue | Nasute termites (*Nasutitermes*): soldiers squirt a sticky terpene secretion from the fontanelle at the tip of the nasus; many termite soldiers are eyeless |
| Soft, pale, translucent abdomen with 9–10 segments and dark gut contents visible | Termite workers; the dark patch is the wood-filled hindgut seen through the cuticle |
| Short thick waist (petiole broader than an ant's but still a constriction) | Design blend: ants have a one- or two-node waist; termites have a broad join. The hybrid keeps a single node, scaled up |
| Formic acid from an acidopore, no sting | Formicinae (same as Red Wood Ant in the game) |
| Queen with wing scars, ocelli, larger eyes; physogastric (swollen) abdomen with stripes | Termite queens (extreme physogastry) toned down to ~3× a worker's abdomen; wing scars and ocelli from dealate ant/termite queens |
| King: a second long-lived reproductive beside the queen | Termites (ant males die after mating; termite kings live for years) |
| Carton nest material | *Nasutitermes* and other termites: chewed wood + faeces + saliva built into papery layers |
| Head-drumming alarm | Termite soldiers bang their heads against the gallery walls (vibrational alarm); ant alarm posture (gaster raised, mandibles open) from ants |
| Trail pheromones, corpse carrying, necrophoresis | Ants (already in the game) |

## 3. Shared body plan (what the models show)
Every hybrid caste is front-ant / back-termite, blended at the waist:
- **Head:** rounded heart-shaped capsule; 12-segment elbowed antennae, funiculus segments swelling into beads toward the tip; small compound eyes on workers (none on soldiers); triangular toothed mandibles closing sideways; a short cone-shaped frontal pore between the antenna bases (stubby on workers, 0.4 × head length and angled forward on soldiers, tip glossy).
- **Mesosoma:** hardened, glossy, one smooth arch, no spines; queen and king carry scutum/scutellum plates and wing scars.
- **Waist:** one short, thick petiole with a low node — ~2.6 × a normal ant waist's thickness.
- **Abdomen:** soft, plump, translucent cream-amber; 9 visible segments (10 on the queen) with darker bands and a dark gut patch low on the underside; acidopore ring at the tip; no sting. The queen's is ~3 × a worker's relative length, creamy-white with amber tergite stripes.
- **Legs:** ant legs, slightly stockier; two claws.
- Sparse fine pale hairs on head and abdomen.

### Colours (brief values; the prototype uses them as-is)
- Head and mesosoma `#8A4E22`, highlight `#C07A3E`; soldier head `#5E3018`; king head/mesosoma `#6E3A1A`.
- Abdomen `#E6C58E`, bands `#A8763E`, gut patch `#4A2E18`; queen abdomen `#F1E4C6` with `#A8763E` stripes.
- Legs and antennae `#B07A42`, lighter `#D4A66A` toward the tips; mandibles `#5E3018`.
- Head/mesosoma clearcoat gloss; abdomen high sheen (the game's shader has no real subsurface term — the sheen + low clearcoat reads as translucency at game scale).

### Sizes (length units, matching the game's other species: Lasius worker ≈ 5.5)
Worker 5 · Soldier 7 · King 7.5 · Queen 12. Brood: translucent cream eggs; pale nymph-style larvae (no pupa) darkening into their caste.

## 4. Behaviour the animations show
- Ant tripod gait with a lower, heavier stance; the soft abdomen jiggles vertically and sways slightly with each step (vertex shader, from the rig's `soft` value).
- Antennae: ant-style sweeping and antennation plus short rapid termite-style tapping.
- Workers: forage for live prey, corpses **and** dead wood; carry insect food in the mandibles; dig, build, carry eggs to brood tiles (including stolen-caste tiles), feed royals and larvae, groom.
- Soldiers: escort foragers, hold chokepoints; alarm = head-drumming (termite) plus abdomen raised with mandibles open (ant).
- Queen and king stay in the royal chamber; the queen lays continuously; the king idles beside her.
- Death: legs curl, abdomen deflates slightly (the gaster's soft value scaled down over the death animation). Corpses are edible by other colonies and give gene samples to other Termant colonies.

## 5. Game-only rules (summary; numbers live in `TERMANT`, `sim/balance.ts`)
Gene samples from eaten enemy corpses → per-species thresholds → stolen castes (max 3 active, forgetting refunds tiles) · soldier glue burst (slow + double formic-acid damage on glued targets) · worker formic acid · dual diet (meat instant, wood slow) · one queen and no replacement (her death loses the colony) · carton walls.

## 6. As implemented (2026-10-25)
Branch `feature/termants`; the code is in `sim/termants.ts` (genes, stealing, glue, wood, carton walls, king, AI helpers), `render/ants/termantMorphs.ts` (the four models), and every number in `TERMANT` (`sim/balance.ts`).

- **Gene samples** are credited only when food reaches the store (`antAI.deposit` → `termantDeposit`): a whole enemy corpse by the dead ant's size class (small 1, worker 2, soldier 4, major or 10 mm+ 7, creature 3), a piece cut from one carries its share (`tagPiece`). The colony's own dead, its team's dead and other Termants give nothing. In games with a Termant colony, dead ants stay food for 25 s instead of 2 s (`corpseLingerSec`) so there is time to carry them home.
- **Stealing:** a caste unlocks at 12 samples (18 for heavy castes); it is pushed into `colony.castes`, so the brood tile, egg allocation, hatching, model, behaviour and sounds are that species' own. At most 3; a fourth waits (`genome.pending`) until one is forgotten. A stolen caste's brood tile costs ×1.5.
- **Stolen-caste table** (`STOLEN_CASTES`, entries whose caste is not in the game are skipped): Hell ant soldier → Impaler, nasute → Glue Gunner, sickle-jaw soldier → Sickle Grappler, fire-ant major → Crusher, Saiy-Ant soldier → Gilded, Red Wood Ant rapid sprayer → Acid Lancer, black garden ant soldier → **Garden Bruiser** (the plan reused "Acid Lancer", but the game's Lasius soldier has no acid), leafcutter major → Shredder, army-ant Soldier (`eciton_major`) → Reaper. Creature genes give one passive bonus each: beetles +5 % armour, spiders +5 % speed.
- **Forgetting** (command `forgetCaste`): the caste's brood tiles go at once, every level refunded; living ants of it stay until they die; its samples drop to half the threshold (it can be re-learned sooner); a waiting caste comes in.
- **Glue burst:** a soldier's bite every 5 s within 4 mm adds 3 damage and coats the target (`glueT`, ants and creatures): speed ×0.4 for 3 s, and formic acid does double damage meanwhile. Shown with the existing glue shell on ants and a splash of glue.
- **Wood:** workers (`wood: true`) chew dead wood; it goes to `colony.wood` (at most 60) and digests into food at 0.15 per s per 10 wood stored, × 0.5. Carton walls are paid in wood.
- **Carton walls** (tile `carton`): 8 wood, 120 HP; enemy ants cannot pass and chew it down instead; it breaks at 0 HP; the colony's own ants pass; it counts as a wall for neighbours' upgrade points; deleting it refunds wood.
- **King** beside the queen (spawned with her). Like the termite kings he is a game rule, not biology: never targeted, takes no damage, bites weakly and dies the moment the queen does (user note, 2026-10-25). **One queen, no replacement** (user note, 2026-10-25; the package's neotenic replacement queen was built and then removed): when the queen dies the colony is lost.
- **Ability — Alarm Drumming** (70 s cooldown): soldiers drum like termites; for 15 s the whole colony is alarmed and rushes to fight, and every glue burst is ready at once.
- **Render:** stolen-caste ants carry a faint amber tint (`TERMANT.stolenTint`; tint code packed into the colour-variation channel, impostors too). Stolen termite castes (Glue Gunner, Sickle Grappler) render through the termite kit and are not tinted.
- **UI:** a Genome tab in the build panel (progress to each threshold, raised / ready / waiting, Forget, the corpse-priority toggle, creature genes); stolen names on brood tiles, caste cards and the info card; wood in the top bar.
- **AI:** the brood mix follows the stolen castes; it forgets the stolen caste with the fewest living ants; it builds a carton wall beside each entrance while invaded; it raids sooner a rival whose genes it nearly has; wood counts less as a forage target once the wood store is half full.
- **Not done:** the first-hatch glow of a new stolen caste (optional in the plan); carton-coloured chamber floors (no per-species nest floor in the game); a separate two-client 10-minute sync run (covered by the same-seed determinism test and the lockstep suite); `settings.carryGenome` (no campaign carries anything between missions yet).
