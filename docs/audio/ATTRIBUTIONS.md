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
| `amb/bird.ogg`, `.m4a` | amb.bird | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `amb/cicada.ogg`, `.m4a` | amb.cicada | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/colony_rumble.ogg`, `.m4a` | amb.colony_rumble | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/cricket.ogg`, `.m4a` | amb.cricket | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `amb/fly_pass.ogg`, `.m4a` | amb.fly_pass | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `amb/frog.ogg`, `.m4a` | amb.frog | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `amb/katydid.ogg`, `.m4a` | amb.katydid | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `amb/leaves_rustle.ogg`, `.m4a` | amb.leaves_rustle | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/nest_room.ogg`, `.m4a` | amb.nest_room | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/owl.ogg`, `.m4a` | amb.owl | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `amb/rain.ogg`, `.m4a` | amb.rain | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/root_creak.ogg`, `.m4a` | amb.root_creak | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `amb/sand_hiss.ogg`, `.m4a` | amb.sand_hiss | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/thunder.ogg`, `.m4a` | amb.thunder | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `amb/water_stream.ogg`, `.m4a` | amb.water_stream | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `amb/wind_grass.ogg`, `.m4a` | amb.wind_grass | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `ant/antenna_tap.ogg`, `.m4a` | ant.antenna_tap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ant/dig_bite.ogg`, `.m4a` | ant.dig_bite | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `ant/drag_heavy.ogg`, `.m4a` | ant.drag_heavy | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `ant/drag_small.ogg`, `.m4a` | ant.drag_small | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `ant/larva_hatch.ogg`, `.m4a` | ant.larva_hatch | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ant/leaf_cut.ogg`, `.m4a` | ant.leaf_cut | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `ant/stridulate.ogg`, `.m4a` | ant.stridulate | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `boss/arrive.ogg`, `.m4a` | boss.arrive | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `boss/footstep.ogg`, `.m4a` | boss.footstep | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `boss/hairs.ogg`, `.m4a` | boss.hairs | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `boss/phase.ogg`, `.m4a` | boss.phase | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `boss/rumble.ogg`, `.m4a` | boss.rumble | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `boss/slam.ogg`, `.m4a` | boss.slam | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `boss/windup.ogg`, `.m4a` | boss.windup | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `combat/acid_splat.ogg`, `.m4a` | combat.acid_splat | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/acid_spray.ogg`, `.m4a` | combat.acid_spray | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/battle_bed.ogg`, `.m4a` | combat.battle_bed | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `combat/bite_crush.ogg`, `.m4a` | combat.bite_crush | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/chitin_crack.ogg`, `.m4a` | combat.chitin_crack | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `combat/fling.ogg`, `.m4a` | combat.fling | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `combat/grapple_scuffle.ogg`, `.m4a` | combat.grapple_scuffle | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `combat/grip.ogg`, `.m4a` | combat.grip | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/mandible_click.ogg`, `.m4a` | combat.mandible_click | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `combat/mandible_snap.ogg`, `.m4a` | combat.mandible_snap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `combat/mortar_land.ogg`, `.m4a` | combat.mortar_land | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `combat/mortar_pop.ogg`, `.m4a` | combat.mortar_pop | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `combat/scissor_cut.ogg`, `.m4a` | combat.scissor_cut | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/sting.ogg`, `.m4a` | combat.sting | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/sting_fire.ogg`, `.m4a` | combat.sting_fire | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `combat/termite_bite.ogg`, `.m4a` | combat.termite_bite | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `cr/antlion_flick.ogg`, `.m4a` | cr.antlion_flick | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/beetle_bite.ogg`, `.m4a` | cr.beetle_bite | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `cr/beetle_elytra.ogg`, `.m4a` | cr.beetle_elytra | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/beetle_step.ogg`, `.m4a` | cr.beetle_step | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `cr/caterpillar_crawl.ogg`, `.m4a` | cr.caterpillar_crawl | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/centipede_bite.ogg`, `.m4a` | cr.centipede_bite | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/centipede_patter.ogg`, `.m4a` | cr.centipede_patter | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `cr/creature_death.ogg`, `.m4a` | cr.creature_death | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/cricket_burrow.ogg`, `.m4a` | cr.cricket_burrow | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_beetle.ogg`, `.m4a` | cr.death_beetle | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_centipede.ogg`, `.m4a` | cr.death_centipede | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_mantis.ogg`, `.m4a` | cr.death_mantis | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_soft.ogg`, `.m4a` | cr.death_soft | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/death_spider.ogg`, `.m4a` | cr.death_spider | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/mantis_strike.ogg`, `.m4a` | cr.mantis_strike | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `cr/mantis_sway.ogg`, `.m4a` | cr.mantis_sway | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/pillbug_roll.ogg`, `.m4a` | cr.pillbug_roll | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `cr/spider_fangs.ogg`, `.m4a` | cr.spider_fangs | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/spider_pounce.ogg`, `.m4a` | cr.spider_pounce | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `cr/spider_step.ogg`, `.m4a` | cr.spider_step | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 6 take(s), rendered offline |
| `cr/stag_clash.ogg`, `.m4a` | cr.stag_clash | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_creatures.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `species/army_hook.ogg`, `.m4a` | species.army_hook | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `species/glue_splat.ogg`, `.m4a` | species.glue_splat | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `species/hellant_impale.ogg`, `.m4a` | species.hellant_impale | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `species/hellant_snap.ogg`, `.m4a` | species.hellant_snap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `species/nasute_glue.ogg`, `.m4a` | species.nasute_glue | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 1 take(s), rendered offline |
| `species/saiyant_crackle.ogg`, `.m4a` | species.saiyant_crackle | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `species/saiyant_surge.ogg`, `.m4a` | species.saiyant_surge | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `species/sickle_acid.ogg`, `.m4a` | species.sickle_acid | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `species/sickle_snap.ogg`, `.m4a` | species.sickle_snap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `species/termant_absorb.ogg`, `.m4a` | species.termant_absorb | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `species/termant_caste.ogg`, `.m4a` | species.termant_caste | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `species/termite_chew.ogg`, `.m4a` | species.termite_chew | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 5 take(s), rendered offline |
| `species/termite_headbang.ogg`, `.m4a` | species.termite_headbang | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_combat.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ui/alert_invasion.ogg`, `.m4a` | ui.alert_invasion | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/alert_queen.ogg`, `.m4a` | ui.alert_queen | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/alert_starving.ogg`, `.m4a` | ui.alert_starving | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/group_assign.ogg`, `.m4a` | ui.group_assign | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/marker.ogg`, `.m4a` | ui.marker | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/marker_lift.ogg`, `.m4a` | ui.marker_lift | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/menu_tap.ogg`, `.m4a` | ui.menu_tap | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ui/message_good.ogg`, `.m4a` | ui.message_good | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/message_warn.ogg`, `.m4a` | ui.message_warn | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/tool_build.ogg`, `.m4a` | ui.tool_build | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ui/tool_delete.ogg`, `.m4a` | ui.tool_delete | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
| `ui/tool_dig.ogg`, `.m4a` | ui.tool_dig | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 4 take(s), rendered offline |
| `ui/tool_upgrade.ogg`, `.m4a` | ui.tool_upgrade | Underground Dominion (made for this game) | `tools/audio/sfx/recipes_world.py` | CC0 (made for this game) | 3 take(s), rendered offline |
<!-- made-for-this-game:end -->
