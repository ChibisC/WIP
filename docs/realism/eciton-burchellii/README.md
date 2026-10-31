# Eciton burchellii — realism pass (overnight 2026-10-31)

Render-only comparison sheets per caste are `compare-<unit>.png` (the reference photos are study material, never in
the repo); animation clips are in `clips/`. Shapes and colours as numbers: docs/creatures/. Blind-review scores and
fixes per round: PROGRESS.md (2026-10-31).

## Numeric colour check
Median sRGB of a patch per body part (the brightest 20 % dropped as highlights), the user's photo vs the render, ΔE76
in CIE Lab and ΔL*:

#### Eciton burchellii soldier (photo: studio side, Alex Wild)

| Part | Photo (median sRGB) | Render (median sRGB) | ΔE (Lab) | ΔL (render − photo) |
|---|---|---|---|---|
| head | #c79564 | #ad9361 | 11.0 | -3.2 |
| mesosoma | #3d1e10 | #7e4016 | 29.6 | +19.0 |
| gaster | #823914 | #6c350e | 9.3 | -4.6 |

Applied after the check: the soldier's mesosoma and waist dark brown (#4a2618) — it sampled orange against the photo's #3d1e10; the head (ΔE 11) and gaster (ΔE 9) were kept.
