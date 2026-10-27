# Realism pass v2: the plastic look (pilot)

User spec: project doc `claude/realism/02-spec-realism-fix-plastic-look.md`. Pilot first: the tropical fire ant
worker and the stag beetle; rollout waits for the user's approval.

## Why v1 looked like plastic, and what changed

| cause | fix (code) |
|---|---|
| No image-based light: one sun and a flat hemisphere ambient, so every glossy part had the same smooth sheen | `src/render/lightPresets.ts`: three procedural worlds (sunny, overcast, forest shade) rendered into PMREM cube maps and used as the environment of every creature and ant material; the flat hemisphere ambient cut to ~20 % on them (`creatureLightPatch`). The game picks the preset from the map's biome (overcast during storms, the nest's own environment underground) in `View.applyCreatureLight`. |
| One round highlight blob: three.js lights the clearcoat with the **smooth** geometry normal, so the baked sculpture never reached the glossy layer | `detailShading.ts`: the clearcoat normal now follows the relief (`coatFollow`), clearcoat roughness per region (0.22–0.4), a broad undulation baked into every tile (`wave`), patchy roughness (`roughVar`), worn high points smoother. |
| Saturated, uniform albedo | colours calibrated on the reference photos (`morphs.ts` `fireLook`, `stagBeetle.ts` `SG2`): the fire ant's amber red-brown front, darker gaster, legs in the body's tone; the stag's maroon elytra and mandibles; joints and sutures darker, mid-segments lighter, worn edges lighter, dust in hollows and on the underside, per-individual hue/value jitter. |
| Microsculpture too weak to see | stronger and denser sculpture at true scale (`recipes.ts`): hair-bearing foveolae with the hair lying out of each pit, striate mesopleura on the lower flanks only, granulate waist; coarser granulation, reticulation and punctures on the beetle. |
| No light through thin parts | translucency from the sun and from the sky behind the part (`getIBLIrradiance(-n)`), thinner toward the tips; setae glow when backlit. |
| Clean toy surfaces | baked per-vertex occlusion and edge convexity (`bake/occlusion.ts`), dust, wear; gaster tergite seams with thin pale margins; promesonotal suture. |
| Tube geometry | stag beetle mandibles rebuilt as swept flat blades (sharp inner edge, the inner tooth and an irregular row of denticles as flat blades, forked point with an upper tine), antler-like course; femora with condyles, spinose mid and hind tibiae; fire ant legs with swollen femora, thin tibiae and short tarsi, capped antennal segments with a sharper elbow, overlapping gaster tergites, a notched head. |
| Uniform hairs | setae thin, tapered, curved, leaning back or toward the leg tip, lengths skewed short with a few long ones, paler and fading out at the tips (dithered), on head, mesosoma, gaster, femora and tibiae. |
| Flat presentation | labs (`src/dev/labLight.ts`): the presets, a backlit test, tone mapping choice (PBR Neutral keeps material colours true), sand grains and litter at the subject's scale, macro depth of field; `?bg=studio` for specimen-style comparisons; `?mask=1` part masks for the metrics. |

## Calibration against the photos (13 reference photos from the user, study only)

- Colours sampled from hand-marked part rectangles (`refs/refs.json`, `tools/realism-metrics.py`): the fire
  ant is a saturated amber to reddish brown (hue 17–26°, saturation 0.72–0.94) and polished; the stag's elytra
  maroon (#75312e), mandibles dark maroon, head and pronotum black but granular. The renders under the studio
  preset now land on the photos (fire ant head and mesosoma hue 16–18°, saturation 0.70–0.75, value 0.53–0.59;
  stag elytra hue 3.3°, saturation 0.56, value 0.46 against 3.1°, 0.57, 0.47).
- `?light=studio`: a specimen photo — the animal on white paper, a diffuser dome and a ring of small lamps
  (many small highlights rather than one window), no bloom, the paper fading into the backdrop.
- Proportions re-measured on the specimen photos: stag head 0.30 of the length wide, pronotum 0.24,
  elytra 0.27 with square shoulders and a rounded apex; long slender legs; mandibles ~⅓ of the length.

## Independent review (spec §4)

A fresh agent each round, never told which image is which: 13 pairs, each a reference photo and the render
from the matching view and light, framed alike (the render cropped to the animal by its mask, both
letterboxed, both brought to the photo's resolution and passed through the same JPEG compression), left and
right shuffled per round (`blind/key.json` holds the answer, never shown to the reviewer). The rounds and their
scores are logged in `PROGRESS.md`.

## Files

- `renders/`: `after_<view>_<light>.png` (overcast, sunny; backlit for the side views), `before_<view>.png`
  (the old build, same camera), `mask_<view>.png` (part masks), `metrics.json`.
- `before-after.png`, `backlit.png`: sheets. `compare-fire.png`, `compare-stag.png`: render vs reference photo
  (kept out of the repository: they contain the study photos).
- `metrics.md`: the numbers for the acceptance checks (`tools/realism-metrics.py`).

Render: `AFTER=… BEFORE=… python3 tests/browser/realism_v2.py docs/realism/pilot-v2/renders`; sheets:
`python3 tools/realism-v2-sheets.py docs/realism/pilot-v2 [refs]`.
