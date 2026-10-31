# Under-pass: smaller ants walk and fight under taller ones (combat v2.2)

User spec: project doc `claude/combat/04-spec-height-and-underpass.md`. Plan and changes: CHANGE_PLAN.md §20; design: DESIGN.md §3.8 (*Unit heights and the under-pass*); numbers in `BALANCE.underpass`; heights in `src/sim/heightData.ts` (made by `tools/height-data.ts` from the models); code in `src/sim/underpass.ts`, `separation.ts`, `slots.ts`, `movement.ts`, `combat.ts`; tests `tests/underpass.ts`; clips `docs/combat/underpass/`.

## 1. Research

### Empires of the Undergrowth (the rule)
The official wiki's *Stat Explanation* page, under **Size**: "Only a limited number of creatures can fight in an enclosed space"; "Smaller creatures can move and attack beneath larger ones"; "Creatures are briefly prevented from attacking and move around to find better position if they can't reach enemies within their vision radius." So size does two things. It limits how many units fit round a target, and it lets small units use the room under big ones. A big ant does not just block its small allies: they slip under it, and more of the army fights at once. EotU is used here only for the rule; nothing else is taken from it.

### Real ants
- **Leafcutters (*Atta*)** are the most size-varied ants. Workers range from minims of about 2 mm (head about 0.6–0.8 mm wide) that tend the fungus and ride on leaves, to majors of 14 mm and more with huge heads (Wilson 1980, *Atta sexdens*). On the trails, minims run round and under medias and majors. A major carries its big head low and forward, mandibles near the ground: its front is low, its middle and gaster high on long legs.
- **Army ants (*Eciton burchellii*)** stand high on long legs. The porters (submajors) are a special caste with the longest legs for their size: they carry prey slung under the body, so the body has to be high off the ground — and while one carries, nothing passes under it (Powell & Franks 2005). Small workers run among and under the big castes in raid columns and swarm fronts.
- **Big creatures**: a ground beetle (Carabidae) runs on long legs but holds its body close over the ground; a wolf spider's body hangs low between its legs; a tarantula's belly is lifted, its fangs and pedipalps low at the front; mantises stand very high. The measured models (below) agree.

## 2. How the heights are measured
`tools/heightLib.ts` builds every ant (`buildAnt` with each morph), termite (`buildTermiteGeometry`) and creature (`BUILDERS[kind]` with its rest pose) standing on flat ground and reads the geometry, not the render:
- **height**: the highest vertex of the body — head, mesosoma, waist, gaster. Antennae, hairs, spines and claws are left out (by part id, or as thin primitives under 1.2 % of the length), and so are the legs.
- **clearance per zone**: the lowest vertex of the body over each third of its length — rear (gaster), middle (mesosoma between the legs) and front (head and mandibles). The zone limits are stored per model (`zx`, fractions of the length), so a big head or a hanging gaster counts where it is.
- **half-width** of the body, and the **feet**: each leg's tip (the lowest leg vertex, or the climb rails' foot for creatures), as x, z fractions of the length.
- The numbers are fractions of the length, so a caste's size variation scales them. `tests/underpass.ts` rebuilds them and fails when `heightData.ts` no longer matches the builders (run `npx vite-node tools/height-data.ts` to regenerate; `-- table` prints this table).

The game ships `main` merged with `feature/realism` (another session is reworking the models there). `heightData.ts` on `main` is made from `main`'s models; the published build regenerates it from the combined models. Both are below.

## 3. The table
Height and clearance in mm at the caste's base length. "Shipped" = `feature/realism` 952ee65 (compact Atta and Eciton legs) + `main`, the published game, measured 2026-10-31.

| unit | length mm | height mm (main → shipped) | clearance rear / middle / front mm, main | shipped |
|---|---|---|---|---|
| `lasius_worker` | 4.0 | 1.21 → 1.23 | 0.37 / 0.51 / 0.56 | 0.29 / 0.53 / 0.30 |
| `lasius_soldier` | 4.9 | 1.54 → 1.52 | 0.46 / 0.62 / 0.67 | 0.36 / 0.62 / 0.25 |
| `lasius_queen` | 8.5 | 2.69 → 3.08 | 0.41 / 0.85 / 1.45 | 0.30 / 0.84 / 0.84 |
| `formica_worker` | 7.0 | 2.26 → 2.23 | 0.81 / 1.04 / 1.12 | 0.63 / 1.03 / 0.53 |
| `formica_soldier` | 8.6 | 3.01 → 2.91 | 1.01 / 1.27 / 1.37 | 0.98 / 1.23 / 0.45 |
| `formica_mortar` | 7.6 | 2.36 → 2.35 | 0.70 / 1.08 / 1.17 | 0.69 / 1.08 / 0.56 |
| `formica_rapid` | 7.2 | 2.23 → 2.22 | 0.81 / 1.05 / 1.11 | 0.80 / 1.04 / 0.52 |
| `formica_queen` | 10.5 | 3.59 | 0.83 / 1.24 / 1.95 | 0.83 / 1.24 / 1.24 |
| `atta_minim` | 2.0 | 0.70 → 0.66 | 0.24 / 0.31 / 0.33 | 0.23 / 0.29 / 0.13 |
| `atta_media` | 8.0 | 3.05 → 2.85 | 1.06 / 1.23 / 1.28 | 1.08 / 1.22 / 0.20 |
| `atta_soldier` | 10.5 | 3.69 | 1.26 / 1.57 / 1.60 | 1.38 / 1.60 / 0.54 |
| `atta_major` | 14.0 | 4.87 → 4.62 | 1.76 / 2.04 / 1.43 | 1.72 / 1.99 / 0.00 |
| `atta_queen` | 21.0 | 6.39 → 7.82 | 1.20 / 2.33 / 3.43 | 0.68 / 2.30 / 2.06 |
| `fire_minor` | 2.8 | 0.81 → 0.79 | 0.23 / 0.33 / 0.36 | 0.19 / 0.32 / 0.34 |
| `fire_soldier` | 4.0 | 1.16 → 1.12 | 0.33 / 0.47 / 0.51 | 0.27 / 0.45 / 0.49 |
| `fire_major` | 6.0 | 1.72 → 1.70 | 0.54 / 0.72 / 0.59 | 0.53 / 0.71 / 0.61 |
| `fire_queen` | 8.0 | 2.50 → 2.44 | 0.38 / 0.79 / 1.34 | 0.38 / 0.77 / 1.32 |
| `eciton_minor` | 4.0 | 1.52 → 1.53 | 0.75 / 0.86 / 0.92 | 0.76 / 0.86 / 0.86 |
| `eciton_submajor` | 6.5 | 2.50 → 2.56 | 1.37 / 1.51 / 1.58 | 1.41 / 1.55 / 1.55 |
| `eciton_media` | 8.0 | 2.79 → 2.87 | 1.38 / 1.54 / 1.55 | 1.43 / 1.58 / 1.58 |
| `eciton_major` | 11.0 | 3.45 → 3.69 | 1.60 / 1.80 / 1.45 | 1.77 / 1.97 / 1.45 |
| `eciton_queen` | 22.0 | 5.81 → 8.28 | 1.77 / 2.08 / 3.13 | 1.76 / 2.58 / 3.52 |
| `plagiaria_worker` | 6.5 | 2.10 → 2.07 | 0.75 / 0.96 / 1.04 | 0.59 / 0.96 / 0.55 |
| `plagiaria_queen` | 10.0 | 3.42 | 0.79 / 1.18 / 1.85 | 0.79 / 1.18 / 1.18 |
| `nasute_worker` | 4.2 | 1.61 | 0.19 / 0.58 / 0.57 | same |
| `nasute_soldier` | 5.0 | 1.84 | 0.31 / 0.78 / 0.82 | same |
| `nasute_major` | 6.5 | 2.17 | 0.37 / 0.74 / 0.68 | same |
| `nasute_king` | 8.4 | 1.62 | 0.30 / 0.48 / 0.64 | same |
| `nasute_queen` | 25.4 | 5.13 | 0.02 / 0.55 / 0.55 | same |
| `rhy_worker` | 5.8 | 1.27 | 0.28 / 0.56 / 0.56 | same |
| `rhy_soldier` | 4.5 | 1.45 | 0.35 / 0.47 / 0.17 | same |
| `rhy_king` | 8.9 | 1.63 | 0.32 / 0.47 / 0.75 | same |
| `rhy_queen` | 26.1 | 5.33 | 0.02 / 0.58 / 0.67 | same |
| `hell_worker` | 5.0 | 2.23 | 0.43 / 0.65 / 0.09 | same |
| `hell_soldier` | 6.5 | 2.74 | 0.56 / 0.85 / 0.14 | same |
| `hell_queen` | 7.6 | 2.61 | 0.40 / 0.86 / 0.06 | same |
| `aurimyrmex_worker` | 6.0 | 2.00 | 0.69 / 0.90 / 1.01 | same |
| `aurimyrmex_soldier` | 9.0 | 3.15 | 1.06 / 1.33 / 1.42 | same |
| `aurimyrmex_queen` | 14.0 | 4.84 | 1.05 / 1.67 / 2.67 | same |
| `termant_worker` | 5.0 | 1.57 | 0.37 / 0.46 / 0.76 | same |
| `termant_soldier` | 7.0 | 2.28 | 0.53 / 0.67 / 0.96 | same |
| `termant_king` | 7.5 | 2.45 | 0.65 / 0.78 / 1.29 | same |
| `termant_queen` | 12.0 | 2.62 | 0.36 / 0.69 / 1.42 | same |
| `lasius_nanitic` | 3.1 | 0.95 → 0.96 | 0.29 / 0.40 / 0.44 | 0.23 / 0.41 / 0.23 |
| `formica_nanitic` | 5.5 | 1.76 → 1.74 | 0.63 / 0.81 / 0.87 | 0.49 / 0.80 / 0.42 |
| `atta_nanitic` | 6.2 | 2.38 → 2.23 | 0.83 / 0.96 / 1.00 | 0.84 / 0.95 / 0.15 |
| `solenopsis_nanitic` | 2.2 | 0.63 → 0.61 | 0.18 / 0.26 / 0.28 | 0.15 / 0.25 / 0.27 |
| `eciton_nanitic` | 3.1 | 1.19 → 1.20 | 0.59 / 0.67 / 0.72 | 0.60 / 0.67 / 0.67 |
| `plagiaria_nanitic` | 5.1 | 1.64 → 1.61 | 0.59 / 0.75 / 0.81 | 0.46 / 0.75 / 0.43 |
| `nasutitermes_nanitic` | 3.3 | 1.25 | 0.15 / 0.45 / 0.44 | same |
| `rhynchotermes_nanitic` | 4.5 | 0.99 | 0.22 / 0.43 / 0.44 | same |
| `hell_nanitic` | 3.9 | 1.74 | 0.33 / 0.51 / 0.07 | same |
| `aurimyrmex_nanitic` | 4.7 | 1.56 | 0.54 / 0.70 / 0.79 | same |
| `termant_nanitic` | 3.9 | 1.23 | 0.29 / 0.36 / 0.59 | same |
| `pillbug` (creature) | 12.0 | 3.94 | 0.00 / 0.00 / 0.00 | same |
| `cutworm` (creature) | 40.0 | 6.63 | 0.00 / 0.00 / 0.00 | same |
| `groundBeetle` (creature) | 16.0 | 3.49 | 0.67 / 0.74 / 1.12 | same |
| `wolfSpider` (creature) | 12.0 | 4.23 | 0.57 / 0.94 / 0.34 | same |
| `lithobius` (creature) | 25.0 | 1.29 | 0.30 / 0.30 / 0.21 | same |
| `rove` (creature) | 26.0 | 3.35 | 1.26 / 1.07 / 0.91 | same |
| `mantis` (creature) | 70.0 | 24.28 | 6.68 / 6.83 / 5.81 | same |
| `antlion` (creature) | 14.0 | 0.77 | 0.00 / 0.00 / 0.00 | same |
| `spiderling` (creature) | 5.0 | 1.76 | 0.24 / 0.39 / 0.14 | same |
| `stagBeetle` (creature) | 100.0 | 22.00 → 21.17 | 8.00 / 13.40 / 17.00 | 4.60 / 4.60 / 8.08 |
| `tarantula` (creature) | 90.0 | 32.79 | 3.21 / 6.17 / 0.85 | same |
| `scolopendra` (creature) | 180.0 | 11.05 | 2.34 / 2.34 / 0.95 | same |
| `giantMantis` (creature) | 130.0 | 40.38 | 10.97 / 11.31 / 6.49 | same |
| `hogna` (creature) | 45.0 | 16.88 | 1.13 / 2.70 / 1.26 | same |

**What must fit:** an ant's height + 10 % (`underpass.margin`) ≤ the zone's clearance in the taller unit's pose. Pose multipliers (`underpass.pose`): a braced bite (Atta majors and soldiers, Eciton soldiers; `underpass.braced`) lowers the front × 0.5; a porter carrying (`underpass.porters`) drops the middle to 0; rearing to spray raises the front × 1.3; dead or flung: no clearance.

## 4. Which pass under which
### Ants of the same species (rest pose)
**`main`'s models**
- Atta: the **minim** goes under the media, soldier, major and queen (all zones) and the Atta nanitic; the **media** under the queen's front.
- Eciton: the **worker** under the soldier's middle and the whole queen; the porter and media under the queen's front; the nanitic under the porter, media and soldier.
- Also: workers and nanitics under the front of the Lasius, Formica, Plagiaria, Saiy-Ant and Termant queens; fire-ant minors and soldiers under the fire queen's front, the fire nanitic under the fire major's middle.

**Shipped (realism + main)**
- Atta: the **minim** goes under the rear and middle of the media, soldier and major (their heads are now carried low — media 0.20 mm, major 0.00 at the front), and under the queen's middle and front. Nothing else.
- Eciton: the **worker** under the soldier's rear and middle and the whole queen; porter and media under the queen's front; the nanitic as on `main`.
- The Lasius, Formica and Plagiaria queens' fronts are lower: nothing passes there any more.

Between species the same rule applies (an Atta minim under an enemy Formica soldier, say), with the enemy toggle (`underpass.enemies`, on).

### Under creatures
Combat v2 assumed every ant is 0.3 × its length tall and gave each creature one belly height (`combat2.clearance`). The models now decide (same on both builds unless noted):

| creature | belly, highest zone (mm) | combat v2 | castes (not queens or nanitics) that fit now | v2 |
|---|---|---|---|---|
| ground beetle (16 mm) | 0.67 / 0.74 / 1.12 | 1.36 | Atta minim, fire minor (front only) | 7 |
| wolf spider (12 mm) | 0.57 / 0.94 / 0.34 | 1.20 | Atta minim, fire minor | 5 |
| rove beetle (26 mm) | 1.26 / 1.07 / 0.91 | 1.30 | Atta minim, fire minor (+ fire soldier shipped) | 6 |
| stone centipede (25 mm) | 0.30 | 1.00 | none | 2 |
| giant centipede (180 mm) | 2.34 / 2.34 / 0.95 | 2.16 | 14 (Lasius, fire ants, Eciton worker, termite workers…) | 20 |
| wolf-spider mother (45 mm) | 1.13 / 2.70 / 1.26 | 5.40 | 20 | 29 |
| tarantula (90 mm) | 3.21 / 6.17 / 0.85 | 10.8 | all 29 | 29 |
| mantis, giant mantis | 6.7–11.3 | 7, 13 | all | all |
| stag beetle (100 mm) | main 8.0 / 13.4 / 17.0; shipped 4.6 / 4.6 / 8.1 | 8.0 | all | all |

## 5. Against the spec's expectations
| expected | measured (shipped) | why / what to do |
|---|---|---|
| Atta minim fits under media, soldier, major, queen | **yes** (rear and middle; queen middle and front) | the big castes' heads are carried low, as in real majors |
| Atta media fits under the major's middle (maybe the soldier's) | **no**: needs 3.14 mm, major middle 1.99, soldier 1.60 | the major would have to stand with its belly at 22 % of its length; the models (and photos of majors on trails) carry the mesosoma lower. For the realism session to check against the reference photos; when the models change, regenerate and it follows |
| nothing fits under the minim | **yes** | |
| Eciton worker fits under the porter, media, soldier, queen (not her gaster) | soldier rear and middle, queen **yes**; porter **no** (needs 1.68, belly 1.55), media **no** (1.58) | 8 % short. Real porters carry prey under the body, so their stance is high; the realism session can raise the porter's and media's stance (it already made the legs more compact). Without the 10 % margin the worker would fit; the margin is the spec's, kept |
| porter possibly under the soldier | **no** (needs 2.82, soldier middle 1.97) | consistent with the models |
| the queen's front and middle, not her gaster | the shipped queen's whole body clears a worker (gaster 1.76) | |

## 6. Consequences
- **Creatures: fewer ants under the low ones.** A ground beetle's belly is 0.74 mm at the middle, and a Lasius worker needs 1.33: Lasius workers no longer fight from under it (combat v2 let 2–5 of them). Seeds 1–9, 30 Lasius workers on a passive beetle from one side: at 6 s, 5–11 holding (`main` 6–14), both sides held on every seed; at 10 s, 7–13 (12–17), far side 2–6 (4–6). `tests/combatV21.ts`'s one-sided split now checks the split itself (both sides, the thinner a third). The same holds for wolf spiders, rove beetles and stone centipedes; the tarantula and the wolf-spider mother keep big under rings but a lower belly. Titans unchanged.
- **Ants:** Atta minims and Eciton workers walk straight under their big castes; nothing else changes for species without big castes.

## 7. Results
Tests (`tests/underpass.ts`, in `npm test`; `main`'s models):
- An Atta minim walks through a column of four standing majors: 0.00 mm off its line, no foot overlap, nobody shoved (under-pass off: 2.0 mm detour, 0.09 mm shove). An Eciton worker through a column of soldiers: 0.00 (off: 3.05 mm, 0.05).
- Poses: a loaded porter's middle 1.51 → 0 mm; a braced major's front 1.43 → 0.72 mm; equal sizes, dead ants: nothing under. A minim under a major's head steps out sideways when the major braces (3.8 mm out, the major not moved); mid-attack it stays and the head waits.
- From beneath: 30 Atta minims on an Eciton soldier held from every side: 1 under it (toggle off: 0).
- Mixed squads: 4 Atta majors + 20 minims v a ground beetle, 7.7 holding on average (13 at most), killed in 11.2 s (off 8.3, 13, 11.8 s); 3 Eciton soldiers + 3 porters + 30 workers v a tarantula, 3.9 (7) v 3.7 (7). Combat v2's slots were already per attacker size, and teammates on one foe never needed personal space, so on creatures the gain is small; the spec's "clearly more attackers" is not met. The beetle's belly is too low for Atta minims under its middle (only its front), so the majors' ring decides.
- Determinism: the same mixed fight twice gives the same result; `tools/check-determinism.ts` clean.
- Performance (`tools/climb-stress.ts -- 30 400`: 400 v 400 and four titans with full loads of riders, 1440 ants; `main` measured in between): 15.7 and 16.1 ms a tick (`main` 15.5), mounting off 12.5 and 12.2 (`main` 12.6). Profiles: the new checks cost about 2 % of the sim (the slot sharing round creatures, the height checks in avoidance, the feet). *Found on the way:* writing the new `Ant` fields on ants only when they first went under something gave the ants many more object shapes in V8, and everything that reads ants got slower (`antSystem` +36 %, 18–20 ms a tick); they are now set to 0 when an ant is made.

## 8. Visibility and control
- An ant under a taller unit (`Ant.udr`) is outlined through it: its body's outline at half its height, in its team's colour (the arena's team colours; elsewhere green yours, blue an ally's, red a foe's), drawn over everything (`render/game/underOutline.ts`; on the surface and in the nests).
- Clicking picks the unit nearest the cursor; clicking the same spot again (within 6 px) picks the next one there, round and round (`GameSession.pickAnt`).
- Health: the creature health bars are screen-space labels (never hidden by a body); ants show theirs in the info card. Nothing to offset. There is no box select in this game (EotU-style: orders are markers, not unit selection).
- Posture: units under another should keep a slightly lower posture where the clearance is close. The ant renderer is the realism session's (`src/render/ants/*`): handed over (claude/handoff/05-UPDATE-2026-10-31-underpass.md). The 10 % margin keeps heads under bellies meanwhile.
- `?combatdebug` / the arena's *Combat* button also shows the under-pass: the height zones of a unit with something under it (green fits, red too low, amber a front waiting to lower), its feet (violet), a magenta line up from the ant under it to its height, a violet ring on ants holding from under a foe, orange arrows on ants stepping out (red: mid-attack, waiting).

## Sources
- EotU official wiki, Stat Explanation (Size): https://hoodedhorse.com/wiki/Empires_of_the_Undergrowth/Stat_Explanation
- Powell S. & Franks N. R. 2005, "Caste evolution and ecology: a special worker for novel prey", Proc. R. Soc. B (Eciton porters): https://pmc.ncbi.nlm.nih.gov/articles/PMC1559956
- Wilson E. O. 1980, "Caste and division of labor in leaf-cutter ants (Hymenoptera: Formicidae: Atta)" I and II, Behav. Ecol. Sociobiol.: https://link.springer.com/doi/10.1007/BF00299521
- *Atta sexdens*: https://en.wikipedia.org/wiki/Atta_sexdens
