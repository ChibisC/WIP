# Saiy-Ant Blaster renders and clips (claude/saiy-ants/09-spec-saiy-blaster.md §6; CHANGE_PLAN §31)

All from the game's own renderer, effects and (for the arena clips) simulation.

| File | What | Made by |
|---|---|---|
| `blaster_model_side.jpg`, `_front.jpg`, `_top.jpg` | the Saiy worker (top left), the Blaster at rest, aiming (jaws wide, mouth lit) and in the gold form | `tests/browser/saiy_sickle_realism.py` (units `saiy_worker,saiy_blaster,saiy_blaster_aim,saiy_blaster_gold`, light overcast) |
| `blaster_lab_orbs_gold_beam.mp4`, `blaster_lab_strip.jpg` | the animation lab's `blast` clip: two white-blue orbs, the gold form, two gold orbs, the 3 s beam down a line of five workers (each hit makes the target flinch) | `CLIPS=blast FPS=15 tests/browser/anim_clips.py` |
| `blaster_arena_orbs.mp4` / `.jpg` | arena, normal form (gold held off): six Blasters against fourteen black garden ant workers | `tests/browser/blaster_clips.py` (`ONLY=orbs`) |
| `blaster_arena_beam.mp4` / `.jpg` | arena, gold form: six Blasters' beams down a line of 24 workers (staged: the shot counter set so the beam is the second gold shot) | `ONLY=beam` |
| `blaster_arena_line.mp4` / `.jpg` | arena: twelve Saiy soldiers hold the line with eight Blasters behind it, against thirty fire ant soldiers | `ONLY=line` |

The arena clips are 4 s of game time at 10 frames a second; run them against a frozen build (`vite build` + `vite preview`)
so a source edit does not reload the page mid-clip.
