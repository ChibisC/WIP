# Audio attributions

Every audio file in `public/audio` gets a row here: where it came from, who made it, and the licence it is used under. `npm run audio:build` reads this table: third-party rows go to the in-game **Credits** screen; the made-for-this-game rows (generated below) need no credit.

Allowed licences: CC0, CC BY (credit required), royalty-free licences that allow commercial use in games and redistribution of the files in a public repository, and our own work. Not allowed: CC BY-NC, Sampling+, "personal use only", the BBC archive licence, libraries that forbid redistributing the raw files, anything from another game (never Empires of the Undergrowth), anything unlabelled.

## Third-party recordings

| File | Title | Author | Source URL | License | Notes |
|---|---|---|---|---|---|
| *(none yet: every sound effect is made for this game; see below)* | | | | | |

Example row for a recording (put the original in `audio-src/recordings/<folder>/<name>_NN.wav`, then `npm run audio:build`):

```
| `combat/mandible_click.ogg` | Tweezer clicks | Jane Doe | https://freesound.org/s/123456/ | CC BY 4.0 | takes 1-3; trimmed, pitched +5 semitones |
```

## Made for this game

Rendered offline by `tools/audio/sfx` (Python: numpy, scipy) from the physics of the real sounds (research: [sound-research.md](sound-research.md)); no samples or recordings from anyone else are used in them. Released with the game under CC0. This table is written by `npm run audio:build`.

<!-- made-for-this-game:start -->
| File | Title | Author | Source | License | Notes |
|---|---|---|---|---|---|
| `amb/bird.ogg`, `.mp4` | amb.bird | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `amb/cicada.ogg`, `.mp4` | amb.cicada | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/colony_rumble.ogg`, `.mp4` | amb.colony_rumble | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/cricket.ogg`, `.mp4` | amb.cricket | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `amb/fly_pass.ogg`, `.mp4` | amb.fly_pass | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `amb/frog.ogg`, `.mp4` | amb.frog | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `amb/katydid.ogg`, `.mp4` | amb.katydid | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `amb/leaves_rustle.ogg`, `.mp4` | amb.leaves_rustle | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/nest_room.ogg`, `.mp4` | amb.nest_room | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/owl.ogg`, `.mp4` | amb.owl | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `amb/rain.ogg`, `.mp4` | amb.rain | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/root_creak.ogg`, `.mp4` | amb.root_creak | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `amb/sand_hiss.ogg`, `.mp4` | amb.sand_hiss | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/thunder.ogg`, `.mp4` | amb.thunder | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `amb/water_stream.ogg`, `.mp4` | amb.water_stream | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/wind_grass.ogg`, `.mp4` | amb.wind_grass | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `ant/antenna_tap.ogg`, `.mp4` | ant.antenna_tap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ant/dig_bite.ogg`, `.mp4` | ant.dig_bite | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `ant/drag_heavy.ogg`, `.mp4` | ant.drag_heavy | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `ant/drag_small.ogg`, `.mp4` | ant.drag_small | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `ant/larva_hatch.ogg`, `.mp4` | ant.larva_hatch | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ant/leaf_cut.ogg`, `.mp4` | ant.leaf_cut | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `ant/stridulate.ogg`, `.mp4` | ant.stridulate | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `boss/arrive.ogg`, `.mp4` | boss.arrive | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `boss/footstep.ogg`, `.mp4` | boss.footstep | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `boss/hairs.ogg`, `.mp4` | boss.hairs | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `boss/phase.ogg`, `.mp4` | boss.phase | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `boss/rumble.ogg`, `.mp4` | boss.rumble | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `boss/slam.ogg`, `.mp4` | boss.slam | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `boss/windup.ogg`, `.mp4` | boss.windup | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `combat/acid_splat.ogg`, `.mp4` | combat.acid_splat | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/acid_spray.ogg`, `.mp4` | combat.acid_spray | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/battle_bed.ogg`, `.mp4` | combat.battle_bed | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `combat/bite_crush.ogg`, `.mp4` | combat.bite_crush | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/chitin_crack.ogg`, `.mp4` | combat.chitin_crack | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `combat/fling.ogg`, `.mp4` | combat.fling | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `combat/grapple_scuffle.ogg`, `.mp4` | combat.grapple_scuffle | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `combat/grip.ogg`, `.mp4` | combat.grip | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/mandible_click.ogg`, `.mp4` | combat.mandible_click | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `combat/mandible_snap.ogg`, `.mp4` | combat.mandible_snap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `combat/mortar_land.ogg`, `.mp4` | combat.mortar_land | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `combat/mortar_pop.ogg`, `.mp4` | combat.mortar_pop | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `combat/scissor_cut.ogg`, `.mp4` | combat.scissor_cut | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/sting.ogg`, `.mp4` | combat.sting | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/sting_fire.ogg`, `.mp4` | combat.sting_fire | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/termite_bite.ogg`, `.mp4` | combat.termite_bite | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `cr/antlion_flick.ogg`, `.mp4` | cr.antlion_flick | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/beetle_bite.ogg`, `.mp4` | cr.beetle_bite | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `cr/beetle_elytra.ogg`, `.mp4` | cr.beetle_elytra | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/beetle_step.ogg`, `.mp4` | cr.beetle_step | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `cr/caterpillar_crawl.ogg`, `.mp4` | cr.caterpillar_crawl | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/centipede_bite.ogg`, `.mp4` | cr.centipede_bite | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/centipede_patter.ogg`, `.mp4` | cr.centipede_patter | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `cr/creature_death.ogg`, `.mp4` | cr.creature_death | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/cricket_burrow.ogg`, `.mp4` | cr.cricket_burrow | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_beetle.ogg`, `.mp4` | cr.death_beetle | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_centipede.ogg`, `.mp4` | cr.death_centipede | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_mantis.ogg`, `.mp4` | cr.death_mantis | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_soft.ogg`, `.mp4` | cr.death_soft | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_spider.ogg`, `.mp4` | cr.death_spider | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/mantis_strike.ogg`, `.mp4` | cr.mantis_strike | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `cr/mantis_sway.ogg`, `.mp4` | cr.mantis_sway | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/pillbug_roll.ogg`, `.mp4` | cr.pillbug_roll | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/spider_fangs.ogg`, `.mp4` | cr.spider_fangs | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/spider_pounce.ogg`, `.mp4` | cr.spider_pounce | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/spider_step.ogg`, `.mp4` | cr.spider_step | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `cr/stag_clash.ogg`, `.mp4` | cr.stag_clash | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `species/army_hook.ogg`, `.mp4` | species.army_hook | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `species/glue_splat.ogg`, `.mp4` | species.glue_splat | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `species/hellant_impale.ogg`, `.mp4` | species.hellant_impale | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `species/hellant_snap.ogg`, `.mp4` | species.hellant_snap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `species/nasute_glue.ogg`, `.mp4` | species.nasute_glue | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `species/saiyant_crackle.ogg`, `.mp4` | species.saiyant_crackle | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `species/saiyant_surge.ogg`, `.mp4` | species.saiyant_surge | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `species/sickle_acid.ogg`, `.mp4` | species.sickle_acid | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `species/sickle_snap.ogg`, `.mp4` | species.sickle_snap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `species/termant_absorb.ogg`, `.mp4` | species.termant_absorb | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `species/termant_caste.ogg`, `.mp4` | species.termant_caste | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `species/termite_chew.ogg`, `.mp4` | species.termite_chew | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `species/termite_headbang.ogg`, `.mp4` | species.termite_headbang | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ui/alert_invasion.ogg`, `.mp4` | ui.alert_invasion | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/alert_queen.ogg`, `.mp4` | ui.alert_queen | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/alert_starving.ogg`, `.mp4` | ui.alert_starving | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/group_assign.ogg`, `.mp4` | ui.group_assign | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/marker.ogg`, `.mp4` | ui.marker | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/marker_lift.ogg`, `.mp4` | ui.marker_lift | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/menu_tap.ogg`, `.mp4` | ui.menu_tap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ui/message_good.ogg`, `.mp4` | ui.message_good | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/message_warn.ogg`, `.mp4` | ui.message_warn | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/tool_build.ogg`, `.mp4` | ui.tool_build | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ui/tool_delete.ogg`, `.mp4` | ui.tool_delete | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/tool_dig.ogg`, `.mp4` | ui.tool_dig | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ui/tool_upgrade.ogg`, `.mp4` | ui.tool_upgrade | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
<!-- made-for-this-game:end -->
