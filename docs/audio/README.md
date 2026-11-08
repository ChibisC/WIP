# Audio

The game should sound like a nature documentary filmed with a tiny microphone among the ants: crisp chitin clicks, dry leaf crunches, soil grains trickling, soft wet squelches, set inside calm, living soundscapes. Nothing electronic in the game world: no beeps, zaps, whooshes or synth hits.

- **What every sound is, where to find it, how to record it:** [sound-list.md](sound-list.md) (generated from the catalog).
- **Where each recording came from:** [ATTRIBUTIONS.md](ATTRIBUTIONS.md). The in-game Credits screen reads it.

## Status

Every sound effect is a file made for this game (audio v3, `claude/audio/03-spec-sfx-rework-insect.md`): 103 sounds, 3–6 takes each, rendered offline by `tools/audio/sfx` (Python: numpy, scipy) from the physics of the real sound, with the research behind each one in [sound-research.md](sound-research.md). Insects are small, so the effects are mostly high, dry, quick and quiet; bigger animals play a little lower.

| Real sound | How the renderer makes it (`tools/audio/sfx/dsp.py`) |
|---|---|
| chitin clicks, mandibles, tarsi | **modal clicks**: a contact burst ringing a few narrow, inharmonic modes at 2–12 kHz that die within milliseconds; two mandible tips a few milliseconds apart |
| cuticle cracking, crushing bites, soil and seeds breaking | **fracture cascades**: many micro-clicks, densest at the start, their resonance falling as the pieces get smaller |
| ant alarms, a held ant's squeak, leafcutters cutting, a titan's rasp | **stridulation**: a file-and-scraper tooth train (hundreds to thousands of impacts a second) ringing the body, in strokes |
| legs scrabbling, dragging, rasps, brushing | **friction**: stick-slip catches with a faint rub, following a wandering pressure |
| venom, acid, glue, wet bites, drops, streams | **bubbles and fizz**: tiny Minnaert bubbles, resonant squelches, effervescent crackle |
| strikes, pounces | **air**: a short, soft bandpass sweep (never a movie whoosh) |
| wind, rain, the nest's hush, rumbles | filtered pink and brown noise with gusts and swells |
| birds, crickets, frogs, an owl, a fly | the naturally tonal calls: tones with contours, pulses through formants, wingbeat harmonics |
| music | played live by the game on acoustic instruments from physical models (`instruments.ts`) |

Checked by measuring, not by ear: `tools/audio/analyze.py` draws spectrogram sheets and flags any narrow tone held over 80 ms outside the naturally tonal calls; `tests/audio.ts`, `tests/browser/audio_files.py` and `tests/browser/audio_mix.py` check the files, their timing and the mix.

## How it works

```
simulation events ──┐        (bites, stings, acid, deaths, digging, hatching, wind-ups, slams…)
what is on screen ──┤        (ants picking up and setting down loads, sickle-jaw holds, creatures' gaits)
animation beats ────┤        (a grip, a crushing bite, a snap, a landing: on their own frame)
                    ▼
            GameAudio (src/audio/gameAudio.ts)
              place: distance from the camera's focus, relative to the zoom; stereo from the screen;
                     only the space on screen; important events elsewhere arrive muffled
                    ▼
            Mixer (mixer.ts): per frame, per pool, loudest first
              work 8 · combat 16 · creatures 10 voices; sim events wait for the frame that shows them
              combat that does not fit → overflow → the battle bed
                    ▼
            AudioEngine (engine.ts)
              voice → bus → environment filter → duck → volume → master → limiter → out
              buses: ambience · creatures · combat · ui · music · narration (one slider each)
              reverb sends: a close room (underground) and open air (surface)
```

- **Beds** (`beds.ts`): looping textures (wind, rain, the nest's room tone, the colony's rumble, a boss's rumble, a glue stream), and **granular beds** that play short grains from a texture, so their density, brightness and level follow the game every frame: the **scuffle** (grappling ants) and the **battle** (combat past the voice limits: a dense insect brawl). Ants and termites make no walking sounds; over a crowd close up the ambience's leaf-litter and soil layer rises a little instead.
- **Ambience** (`ambience.ts`): by biome (the map style), time of day, surface or underground, zoom (wide layers ↔ the macro layer) and rain (a parameter, ready for weather).
- **Music** (`music.ts`): recorded stems (explore, battle, boss) crossfading in sync when they exist; otherwise the procedural acoustic score: calm harp, bass, kalimba and flute; frame drums, shaker and a pizzicato ostinato with the fighting; big low drums and tremolo strings for a boss. D dorian, 96 BPM, a little swing.
- **Ducking**: queen alerts, invasions, a boss's phase change and narrator cues lower everything else briefly.
- **Underground**: the world closes in (lowpass, room reverb); the surface is heard faintly through the soil.
- **Orders** (`uiSound.ts`): every command gets an instant, natural confirmation. Markers I–V chirp at five pentatonic pitches; tools tap, puff and crumble like packed earth.
- **Rules**: audio only reads the game. It never changes the simulation, so determinism and multiplayer sync are untouched. Bite, sting and death events carry who and what (`by`, `on`, `what`) for the sound only. The context starts on the first click or key (browser autoplay rules) and fades out while the tab is hidden.

## Engines considered

- **FMOD Studio (HTML5/WebAssembly)** and **Wwise (web)**: both need an account and an SDK download, and licence terms by revenue. They can't be fetched from this build environment, and their event model (events, parameters, random containers, ducking) is implemented here in about 750 lines on the Web Audio API (engine, bank, beds, mixer).
- **Howler.js**: adds sprites and HTML5-audio fallbacks, but no filters, sends or granular playback, which this needs. Not used.
- **Tone.js**: capable, but large (≈ 300 kB) for what it would add. The granular beds and scheduling here use Web Audio directly.

## Making and adding sounds

`npm run audio:build` renders every recipe (`tools/audio/sfx/recipes_*.py`) into `audio-src/rendered/` (not committed), finishes the takes (trimmed to start on their first sound, short fades, normalised to the level each sound has in the mix, `levels.json`; loops crossfaded) and packs each sound into one file of takes in `public/audio/<folder>/<name>.ogg` and `.mp4`, with the manifest and the made-for-this-game rows of [ATTRIBUTIONS.md](ATTRIBUTIONS.md). To use a recording instead, put its takes in `audio-src/recordings/<folder>/<name>_01.wav` … (names in [sound-list.md](sound-list.md)), add its row to ATTRIBUTIONS.md and run the build again. To audition, open `?scene=sounds`.

| Command | What it does |
|---|---|
| `npm run audio:build` | render, finish and pack every sound (needs Python 3 with numpy, scipy, soundfile, pyloudnorm; and ffmpeg) |
| `npm run audio:build render <filter>` / `pack` | re-render some sounds / re-pack |
| `npm run audio:list` | regenerate `docs/audio/sound-list.md` (with the budget) from the catalog and the manifest |
| `python3 tools/audio/analyze.py <wavs> <out>` | spectrogram sheets, levels, held-tone check |
| `tests/browser/with_server.sh python3 tests/browser/audio_files.py` | every file decodes as Ogg and AAC, takes cut right, attacks start on their contact |
| `tests/browser/with_server.sh python3 tests/browser/audio_mix.py` | render whole soundscapes offline through the engine; check clipping, loudness, voice budgets, alert cut-through |
| `tests/browser/sfx_recordings.py <out> [scene…]` | in-game recordings with sound, frame by frame (before/after pairs for a review) |

## Budgets

- **Download:** 4.6 MB of Ogg Vorbis for all 103 files (5.1 MB of AAC on Safari without Ogg); a browser fetches one format. The ambience loops are about 2.6 MB of it and stream, and only the current map's beds are fetched.
- **Memory:** decoded effects are float32 at the context's rate (48 kHz on most phones): about 30 MB if every effect were decoded. A game decodes combat, orders, alerts and work in the background after the first click (about 17 MB) and the rest when first wanted (the map's ambience one-shots, the creatures and titans met). Low sounds (titans, thunder, an owl, a fly) decode at half or a quarter rate; long ambience loops stream through audio elements and cost no decoded memory. The previous stand-ins took about 27 MB, so iPhone Safari is no worse off. `sound-list.md` gives the current figures.
- **Voices:** 8 work sounds, 16 combat sounds, 10 creature sounds, plus each sound's own limit (the quietest gives way to a louder one), plus the beds. A 400-ant battle rendered offline peaks at about −5 dBFS within the budgets; most combat requests then go into the battle bed.
- **Files:** one file per sound with all its takes (an audio sprite): Ogg Vorbis (q3 for effects, q1 for the noise-like ambience beds) plus AAC `.mp4`; the game picks one with `canPlayType` and corrects for encoder delay when it cuts the takes.
