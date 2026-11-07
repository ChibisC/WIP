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
