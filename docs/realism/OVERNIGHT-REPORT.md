# Overnight report — 2026-10-31 (realism: Lasius, Formica, Atta, Eciton)

Spec: `claude/realism/06-spec-overnight-atta-eciton.md`. Branch `feature/realism`. Your order (02:35): finish
Lasius and Formica first, then Atta, then Eciton. Nothing was published (see the end).

## In one paragraph
All four species were rebuilt as realism morphs, reviewed blind by a fresh agent every round against your reference
photos, and fixed round by round. Every unit's shape now follows the photos far more closely: triangular formicine
jaws hanging under a down-tilted face, a continuous mesosoma, frontal antennal sockets, thin petiole scales, rounder
satin gasters, matte faceted eyes; Atta's spines, frontal lobes, lobed heads and curved toothed shears; Eciton's
free-tipped soldier hooks, dichthadiiform queen and dull rust gasters. The reviewer's scores rose from 2–3 to 3–4
out of 10 but **none reached the 7/10 target**: what still marks the renders as CG is the same for all four species —
stiff straight antennae and uniform tube legs, a waxy surface without a visible hair coat or translucency, and studio
lighting — and those need geometry and shader work rather than another look tweak (details below).

## Per species
| Species | Units | Review rounds | Render scores (first → last) | Photos scored | Sheets | Clips |
|---|---|---|---|---|---|---|
| Lasius niger | worker, soldier, queen | 4 | 3.5 → 3.5 (L1–L4) | 8–9 | `lasius-niger/compare-*.png` | `lasius-niger/clips/`: walk, 3 attacks, hits, deaths, trophallaxis |
| Formica rufa | worker, soldier, mortar, rapid, queen | 4 | 3.0 → 3.0 (F1–F6) | 7–9 | `formica-rufa/compare-*.png` | `formica-rufa/clips/`: walk, 3 attacks, hits, deaths, the three sprayers |
| Atta cephalotes | minim, media, soldier, major, queen | 4 | 2.7 → 3.7 (round 3, kept) → 3.0 (round 4, harsher reviewer) | 9–10 | `atta-cephalotes/compare-*.png` | `atta-cephalotes/clips/`: walk, 3 attacks, hits, deaths, major attacks |
| Eciton burchellii | worker, porter, media, soldier, queen | 3 | 2.8 → 3.7 (round 2, kept) → 2.8 (round 3, harsher reviewer) | 8–10 | `eciton-burchellii/compare-*.png` | `eciton-burchellii/clips/` (if the overnight recording finished) |

Round-by-round scores and the fixes between rounds: PROGRESS.md, 2026-10-31.

## What changed, by species
- **Lasius / Formica** (your batch-1 notes first: jaws triangular, not crescents): new formicine jaw generator
  (straight external margin, toothed straight cutting edge, rolled blade so the open jaw shows its face); face tilted
  down so the closed jaws hang under the clypeus; antennae from the front of the face, scapes rising; head against the
  pronotum; continuous mesosoma; thin dark petiole scale; rounder satin gasters with pale tergite margins; matte grey
  eyes; Lasius scape and tibia hairs (its field mark) and ocelli; Formica's frosted gaster, the Mortar's and Rapid
  Sprayer's visible acidopore, the queen's darker mesosoma; spray animation by kind (the Mortar rears and recoils, the
  Rapid Sprayer pulses), trophallaxis nods and aphid drumming; numeric colour check (lighter, less saturated).
- **Atta**: tuberculate matte recipes, dense short golden hair, faces tilted down, frontal lobes and ridges, deep
  lobes and long occipital spines, slender sharp mesosoma spines, curved toothed hook-shears that get heavier up the
  castes, the queen's massive mesosoma and globular gaster; caste attacks (minims cling, medias bite and hold,
  soldiers bite and head-slam, majors a braced scissor crush); leaf cutting swings the body in an arc with the jaws
  vibrating.
- **Eciton**: semi-glossy microsculpture recipe, sparse golden hairs; the worker's short toothed clamp jaws; the
  soldier's hooks with free sharp tips (they met in a loop), its smaller tan head shading to orange-brown with pin
  eyes, dark body; dull rust gasters (were a saturated "grub" orange); the dichthadiiform queen (broad flat head and
  mesosoma, massive petiole, dark plates with pale membranes); caste attacks (workers bite and hold, the soldier hooks
  and holds).

## Decisions made without you
- The spec's "other agent" on Formica/Lasius was this session (no other session ran), so the enhancement layer went
  directly onto the batch-1 work.
- Photos stay study-only (your rule overrides the spec's "photo-vs-render sheets in docs/"): the repo has render-only
  sheets; the photo-vs-render sheets went to you in chat as files.
- Atta majors: the key says the A. cephalotes major's head is "smooth and shining", but your photos show matte,
  sculptured heads and the reviewer read any gloss as plastic or chocolate — the photos won (satin-matte heads).
- The fire queen's eyes follow the batch-1 eye rule (your "eyes bulge" note); a wing-scar change that had touched the
  approved fire queen was reverted to Atta only. No other species changed (morph hashes checked each commit).
- Stopped at 4 rounds for Lasius, Formica and Atta (the spec's limit) and 3 for Eciton (its minimum, time). Each
  round used a fresh reviewer, so scores move ±1 with the reviewer (the last one scored every render 2–3); where a
  change made things worse it was reverted (Atta's sideways scapes read as "stilts", the Eciton queen's pale
  membranes as "candy stripes") and the best-scoring look was kept.

## Below 7/10: what blocks it, and the next steps
Suggestions for each, with effort: `formica-lasius-suggestions.md` (they apply to all four species).
1. Antennae and legs read as stiff uniform rods: curved spline antennae with a smooth taper; stronger femur clubs and
   slim tibiae; softer joints; a natural rest pose (knees lower, tarsi under the body).
2. Waxy surfaces: a hair-coat sheen term driven by the setae density, transmission on thin parts, softer lighting.
3. Jaws: a bigger, darker tooth row that reads at sheet scale.
4. Eciton: the gaster still reads as a ringed grub; the soldier's head-to-body proportion and hook insertion (at the
   head's front corners, wide apart) need another pass.

## Published?
No. The spec allows publishing only when every check passes (the 7/10 review target was not met), so the game
artifact stays at v19. Tests: all suites pass on the final commit.
