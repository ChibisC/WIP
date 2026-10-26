# Audio attributions

Every audio file in `public/audio` (and its original in `audio-src/recordings`) gets a row here, whatever its licence: where it came from, who made it, and the licence it was used under. `npm run audio:manifest` reads this table, and the in-game **Credits** screen lists every row.

Allowed licences: CC0, CC BY (credit required), royalty-free licences that allow commercial use in games (for example the Sonniss GDC bundles), and your own recordings. Not allowed: CC BY-NC, Sampling+, "personal use only", anything taken from another game.

| File | Title | Author | Source URL | License | Notes |
|---|---|---|---|---|---|
| *(no recordings yet: every sound plays its procedural stand-in, generated in the game, no third-party audio)* | | | | | |

Example rows (copy the format):

```
| `ant/step_soil_01` | Beetle walking on dry soil | Jane Doe | https://freesound.org/s/123456/ | CC BY 4.0 | trimmed, pitched +5 semitones |
| `amb/wind_grass_01` | Meadow wind, ground level | (Sonniss GDC 2024, Some Library) | https://gdc.sonniss.com | Sonniss GDC licence | looped |
| `combat/mandible_click_01` | Tweezer clicks | (you) | own recording | CC0 / own | |
```
