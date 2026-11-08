# Golden set: v3before vs v3after

Pass: SSIM ≥ 0.985 and mean absolute difference ≤ 2.0 (0–255 levels).

| shot | SSIM | mean diff | p99 diff | verdict |
|---|---|---|---|---|
| fight | 1.0000 | 0.00 | 0 | match |
| fight_termites | 1.0000 | 0.00 | 0 | match |
| map_meadowPond_close | 1.0000 | 0.00 | 0 | match |
| map_meadowPond_far | 1.0000 | 0.00 | 0 | match |
| map_meadowPond_play | 1.0000 | 0.00 | 0 | match |
| map_riverbank_close | 1.0000 | 0.00 | 0 | match |
| map_riverbank_far | 1.0000 | 0.00 | 0 | match |
| map_riverbank_play | 1.0000 | 0.00 | 0 | match |
| map_savanna_close | 1.0000 | 0.00 | 0 | match |
| map_savanna_far | 1.0000 | 0.00 | 0 | match |
| map_savanna_play | 1.0000 | 0.00 | 0 | match |

11 of 11 match.

Pixel for pixel (performance v3: the ground, grass, water and scenery in culled chunks; `main` 56be698 + the tools as
`v3before`, the branch at 34f1f2e as `v3after`): 8 of the 11 shots are identical; the three far shots differ in 11, 6
and 1 of 972,800 pixels (at most 13 levels), each where two grass blades cross — two blades at exactly the same depth
there, and the chunks draw the blades in another order than the one mesh did, so the other blade wins the tie.
