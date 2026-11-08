# The golden set (performance pass, spec §4)

Fixed shots (same seed, same camera, the game stepped on a virtual clock to a fixed tick) that an optimization must
leave unchanged. `tests/browser/golden.py` renders them (`TAG=<set>`, `RESUME=1` picks up an interrupted run);
`tools/golden-compare.py <before> <after> [noise]` compares two sets (SSIM ≥ 0.985 and mean difference ≤ 2 of 255)
and writes `compare-<after>.md` and, for the shots that differ, `sheets-<after>/` (before | after | difference × 4).

- `before/` — the reference: `main` at fd581b0, rendered before the performance pass merged. Committed.
- `after/`, `before2/` (a second render of `before`'s build, the run-to-run noise) — rendered for a comparison and not
  committed (about 50 MB a set); render them again from any two builds.

Run-to-run noise: ants get a random gait phase and antenna wave when first drawn, and combat effects use random sparks,
so two renders of one build differ wherever ants walk. The compare tool takes the noise set into account.

## Results
- `compare-after.md`: the branch before its memory changes against `main` at fd581b0 — 35 of 35 match.
- After the memory changes (shared model vertices, single-sample impostor atlases) and the merge of `main` at d1161a0:
  the shots they could touch were rendered again — Meadow Pond close, gameplay and far, both nests, the medium preset,
  the fight and its termites: all match the reference (SSIM ≥ 0.9999, the nests within their run-to-run noise). The
  titan shot changed with `main`'s own titan work (the tarantula now digs where the camera points); against `main` at
  d1161a0 it matches (SSIM 0.9906, mean difference 0.56: the nest's floating dust, which is random).

## Performance v2 (CHANGE_PLAN §29)
`compare-v2after.md`: the twelve shots the branch could touch (Meadow Pond close, gameplay and far, both nests, the
low preset, the Lasius and fire-ant line-ups, the fight and its termites, the titan in a nest, the story night), from
`feature/responsiveness` against `main` with only the branch's seeds applied (`seedsbefore`: ids and places hashed,
seeded sparks — the branch makes renders reproducible, so the reference must use the same seeds): **12 of 12 match
with no noise set**, ten of them pixel for pixel (the two nests 0.9997: their drifting dust). The ants are drawn the
same; the closed-form particles follow the old paths within 0.3 mm (`tests/clientVisuals.ts`).

## Performance v3 (CHANGE_PLAN §32)
`compare-v3after.md`: Meadow Pond, Riverbank and Savanna at three zooms, the fight and its termites, from
`feature/performance-v3` (the ground, grass, water and map scenery in culled chunks) against `main` 56be698: **11 of 11
match**, 8 pixel for pixel; the far shots differ in 1–11 pixels of 972,800 where grass blades cross (equal depths
drawn in another order).
