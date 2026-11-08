# Download list (optional)

Every sound in the game already has a made-for-this-game version (rendered by `tools/audio/sfx`), so nothing here is required. The build machine cannot download from sound libraries, so these are for you to fetch if you want real recordings layered in or swapped for a rendered sound. Only CC0 is listed (no credit needed, safe in a public repo); read each file's licence on its page before downloading, and skip anything that is not CC0 or CC BY.

| What | Where (CC0 filter) | Use it for | What to do with it |
|---|---|---|---|
| Ant or insect stridulation, contact-mic recordings | https://freesound.org/search/?q=stridulation&f=license:%22Creative+Commons+0%22 | `ant.stridulate`, `combat.grip`, `combat.struggle`, the battle bed's squeaks | Cut 3–6 short chirps; save as `audio-src/recordings/ant/stridulate_01.wav` … |
| Beetle clicks, insect mandibles, contact mic | https://freesound.org/search/?q=beetle+click&f=license:%22Creative+Commons+0%22 | `combat.mandible_click`, `cr.beetle_bite` | Trim to the click (under 50 ms), 5–6 takes |
| Crab or shrimp shell crunch, eggshell crack | https://freesound.org/search/?q=shell+crunch&f=license:%22Creative+Commons+0%22 | `combat.bite_crush`, `combat.chitin_crack` (pitched up 5–12 semitones) | Trim tight; the renderer normalises and packs |
| Dry leaf crunch, close | https://freesound.org/search/?q=dry+leaf+crunch+close&f=license:%22Creative+Commons+0%22 | `amb.leaves_rustle` (a 20–30 s loop), `ui.group_assign` | Loops: one long file `amb/leaves_rustle_01.wav` |
| Termite head-banging (rarely CC0; check) | https://freesound.org/search/?q=termite&f=license:%22Creative+Commons+0%22 | `species.termite_headbang` | Bursts of 0.4–0.7 s |

How to add one: put the file(s) in `audio-src/recordings/<folder>/<name>_NN.wav` (names in [sound-list.md](sound-list.md)), add a row to [ATTRIBUTIONS.md](ATTRIBUTIONS.md) with its page URL and licence, and run `npm run audio:build`. A sound with recordings uses them instead of its rendered takes.
