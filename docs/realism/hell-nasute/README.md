# Realism rework: hell ants and nasute termites (2026-11-02)

Spec: `claude/realism/08-spec-hell-ants-nasute-termites.md` (in the project). Plan: `CHANGE_PLAN.md` §22. Branch: `feature/realism-hell-nasute`. The work changes looks and animation only; every unit id, stat, ability and behaviour is unchanged.

## What is here
- `RUBRIC.md`: the fixed review rubric and its three calibration anchors.
- `termite-hashes.md`: termite kit geometry before and after, per caste and LOD. The sickle‑jaw castes are identical, and so are their lab renders, pixel for pixel in all 12 shots.
- `../hell-ants/`: sheets per hell ant unit (side, top, front, three‑quarter and close‑up, under overcast, forest and sunny light), amber specimen shots, and `clips/`.
- `../nasutitermes/`: sheets per nasute unit, and `clips/` (termites, royals).
- The repo holds render‑only images. Photo‑vs‑render sheets went to the user in chat; the reference photos are for study only.

## User notes during the run (2026-11-02, 10:30)
- **Hell ant legs:** the legs were "so compact", so they are now 1.25× longer and set as wide as the other ants' (about half a body length on each side; before it was about a fifth). The body is carried higher, and the ants walk and idle with the other ants' planted‑feet animation. The clips and sheets show the new legs. The review rounds were scored on the older, compact legs.
- **Nothing through the ground:** every hell ant and termite clip was filmed at ground level (anim lab `cdir=0,0.04,1`): walk, snap, impale, the three attacks, deaths, the termite states and the royals. Nothing dips below the ground. The snap's cocked jaws used to swing into the ground, so the head now rises as they cock. Corpses still sink away after drying, as every ant's do.

## Blind review: render scores per round (0–10; real photos mixed in scored 8.5–9.5)

| Unit | R1 side / close | R2 | R3 | R4 |
|---|---|---|---|---|
| hell worker | 3.5 / 3.5 | 3.5 / 3 | 3.5 / 4 | 4 / 3.5 |
| hell soldier | 3.5 / 3.5 | 3.5 / 3 | 3.5 / 4 | 4 / 3.5 |
| hell queen | 3.5 / 3.5 | 3.5 / 3.5 | 3.5 / 4 | 3.5 / 3.5 |
| nasute worker | 3.5 / 3 | 3.5 / 3 | 3.5 / 3.5 | 3.5 / 3 |
| nasute soldier | 3.5 / 3 | 3.5 / 3 | 3.5 / 3.5 | 3.5 / 3 |
| nasute major | 3.5 / 3 | 3.5 / 3 | 3.5 / 3.5 | 3.5 / 3.5 |
| nasute king | 3 / 3 | 3.5 / 3 | 3.5 / 4 | 3.5 / 3.5 |
| nasute queen | 3 / 3 | 3 / 3 | 3.5 / 4 | 3 / 3.5 |
| **mean** | **3.3** | **3.25** | **3.7** | **3.45** |

Every round used a fresh reviewer, and the same reviewer's anchors scored 3 (the hell worker before this pass), 4 (the fire ant, the game's previous best realism ant) and 9 (a live photo). Scores move by about ±0.5 between reviewers. The renders went from the anchor‑A level to about the anchor‑B level. **The 7/10 target was not reached.**

The tells reviewers named in every round:
1. **Legs and antennae** read as tubes of even width or strings of beads. Their joints, setae and claws don't read at sheet scale.
2. **Cuticle** looks like one plastic material with a sharp highlight per part. The soft termite bodies read as opaque.
3. **Ground and light:** the macro ground is soft and repetitive, and the lighting looks lit like a model.

What each round fixed is in PROGRESS.md (2026‑11‑02). Going further needs heavier tools than look tweaks: a layered skin shader with true thickness‑based transmission, hair cards or a fur shell for pubescence, tapered and segmented appendage meshes with visible articulations, and a photographed or photogrammetric ground.
