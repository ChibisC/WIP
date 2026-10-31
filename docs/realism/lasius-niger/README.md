# Lasius niger — realism rollout (batch 1)

Comparison sheets (render only: the reference photos are study material and never go in the repo) are
`compare-<unit>.png`; animation clips are in `clips/`. Photo-vs-render sheets were sent to the user in chat.

## Numeric colour check (overnight 2026-10-31)
Median sRGB of a patch on each body part (the brightest 20 % dropped as highlights) in the user's reference
photos and in the studio-lit render, with the difference in CIE Lab (ΔE76) and in lightness (ΔL*). Patches are listed
in the overnight log; field photos are sunlit and read lighter than any studio render.

### Before (batch-1 colours)
#### Lasius niger worker (photo: studio 3/4)

| Part | Photo (median sRGB) | Render (median sRGB) | ΔE (Lab) | ΔL (render − photo) |
|---|---|---|---|---|
| head | #786a57 | #332512 | 29.8 | -29.6 |
| mesosoma | #725a3f | #452a11 | 20.4 | -20.0 |
| gaster | #503f27 | #3b2e20 | 10.0 | -7.9 |
| mandibles | #a17045 | #6a3f13 | 20.4 | -20.3 |

#### Lasius niger worker (photo: field)

| Part | Photo (median sRGB) | Render (median sRGB) | ΔE (Lab) | ΔL (render − photo) |
|---|---|---|---|---|
| gaster | #a2866a | #3b2e20 | 38.7 | -37.8 |
| head | #6c4b37 | #332512 | 20.6 | -19.1 |

### After (lighter, less saturated base colours)
#### Lasius niger worker (photo: studio 3/4)

| Part | Photo (median sRGB) | Render (median sRGB) | ΔE (Lab) | ΔL (render − photo) |
|---|---|---|---|---|
| head | #786a57 | #48351a | 23.2 | -21.9 |
| mesosoma | #725a3f | #5b3e1e | 12.5 | -11.0 |
| gaster | #503f27 | #443627 | 7.0 | -4.1 |
| mandibles | #a17045 | #7e4e1e | 14.2 | -13.6 |

#### Lasius niger worker (photo: field)

| Part | Photo (median sRGB) | Render (median sRGB) | ΔE (Lab) | ΔL (render − photo) |
|---|---|---|---|---|
| gaster | #a2866a | #443627 | 35.0 | -34.1 |
| head | #6c4b37 | #48351a | 13.3 | -11.3 |

Reading: the gasters match the studio photos (ΔE ≈ 7); the heads and mesosomas were 15–30 L* too dark and
over-saturated (the browns had almost no blue), now 8–22 L* darker — the rest is the photos' lighting and the
pubescence's grey sheen, which a studio render doesn't reproduce. A remaining head-patch gap is noted for review.
