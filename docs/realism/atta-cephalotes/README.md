# Atta cephalotes — realism pass (overnight 2026-10-31)

Render-only comparison sheets per caste are `compare-<unit>.png` (the reference photos are study material, never in
the repo); animation clips are in `clips/`. Shapes and colours as numbers: docs/creatures/. Blind-review scores and
fixes per round: PROGRESS.md (2026-10-31).

## Numeric colour check
Median sRGB of a patch per body part (the brightest 20 % dropped as highlights), the user's photo vs the render, ΔE76
in CIE Lab and ΔL*:

#### Atta cephalotes media (photo: field, Alex Wild)

| Part | Photo (median sRGB) | Render (median sRGB) | ΔE (Lab) | ΔL (render − photo) |
|---|---|---|---|---|
| head | #df985a | #944519 | 31.5 | -29.7 |
| mesosoma | #8a6e60 | #6c2f0e | 33.8 | -21.3 |


Applied after the check: lighter, less saturated head and mesosoma (the field photo is flash-lit and reads lighter than any studio render).
