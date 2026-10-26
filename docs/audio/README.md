# Audio

The game should sound like a nature documentary filmed with a tiny microphone among the ants: crisp chitin clicks, dry leaf crunches, soil grains trickling, soft wet squelches, set inside calm, living soundscapes. Nothing electronic in the game world: no beeps, zaps, whooshes or synth hits.

- **What every sound is, where to find it, how to record it:** [sound-list.md](sound-list.md) (generated from the catalog).
- **Where each recording came from:** [ATTRIBUTIONS.md](ATTRIBUTIONS.md). The in-game Credits screen reads it.

## Status

Every sound has a file slot. Until a recording is placed in its slot, the sound plays an **organic stand-in**, synthesised from the physics of the real sound (`src/audio/standins.ts`):

| Real sound | How the stand-in makes it |
|---|---|
| soil, dry leaves, sand, debris | **grains**: streams of tiny impulses, each ringing a short resonance (crackle) |
| chitin, mandibles, beetle steps, wood | **modal resonators**: a few inharmonic modes that die within milliseconds, plus a sharp transient |
| hemolymph, wet impacts, water, drips, rain | **bubbles**: a sine at the bubble's resonance, rising about 10 % per decay (Minnaert / van den Doel) |
| ant alarms, crickets, katydids, frogs, beetle hisses | **stridulation**: a pulse train, one tick per ridge of the file, ringing the body |
| dragging, scuffles | **friction**: noise in a wandering band, gated by irregular stick-slip catches |
| strikes, pounces, flicks | **air**: noise through a fast bandpass sweep |
| wind, rumble, the nest's hush | filtered brown and white noise with slow gusts |
| music | **acoustic instruments from physical models**: Karplus–Strong plucked strings (harp, guitar, pizzicato), kalimba tines, frame drums (membrane modes), a seed shaker, a wooden flute |

Checked by rendering and measuring, not by ear: `npm run audio:standins` writes every take as WAV, and `tools/audio/analyze.py` draws spectrogram sheets and flags any narrow tone held over 80 ms (a beep or whine) outside the naturally tonal calls (birds, crickets, frogs, owls, music).

## How it works

```
simulation events ──┐        (bites, stings, acid, deaths, digging, hatching, wind-ups, slams…)
what is on screen ──┤        (the nearest ants' footsteps, ants dragging food, creatures' gaits)
                    ▼
            GameAudio (src/audio/gameAudio.ts)
              place: distance from the camera's focus, relative to the zoom; stereo from the screen;
                     only the space on screen; important events elsewhere arrive muffled
                    ▼
            Mixer (mixer.ts): per frame, per pool, loudest first
              steps 8 · work 8 · combat 16 · creatures 10 voices
              combat that does not fit → overflow → the battle bed
                    ▼
            AudioEngine (engine.ts)
              voice → bus → environment filter → duck → volume → master → limiter → out
              buses: ambience · creatures · combat · ui · music · narration (one slider each)
              reverb sends: a close room (underground) and open air (surface)
```

- **Beds** (`beds.ts`): looping textures (wind, rain, the nest's room tone, the colony's rumble, a boss's rumble), and **granular beds** that play short grains from a texture, so their density, brightness and level follow the game every frame: the **swarm** (moving ants in view), the **scuffle** (grappling ants), the **battle** (combat past the voice limits).
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

## Adding recordings

See [sound-list.md](sound-list.md#how-to-add-a-recording). In short: name the files after their slots in `audio-src/recordings/`, run `npm run audio:process` (ffmpeg), add rows to ATTRIBUTIONS.md, and run `npm run audio:list` to update the list's status column. To audition, open `?scene=sounds`. It shows every sound with its takes and source (file or stand-in), and a mixer for the soundscape (biome, nest, night, zoom, rain, swarm, battle, boss).

| Command | What it does |
|---|---|
| `npm run audio:process [filter]` | recordings → trimmed, faded, normalised `.ogg` + `.m4a` in public/audio, then the manifest |
| `npm run audio:manifest` | rebuild `public/audio/manifest.json` (which files exist, credits) |
| `npm run audio:list` | regenerate `docs/audio/sound-list.md` from the catalog |
| `npm run audio:standins [dir]` | render every stand-in take to WAV |
| `python3 tools/audio/analyze.py <wavs> <out>` | spectrogram sheets, levels, held-tone check |
| `tests/browser/with_server.sh python3 tests/browser/audio_mix.py` | render whole soundscapes offline through the engine; check clipping, loudness, voice budgets, alert cut-through |

## Budgets

- **Memory:** about 25 MB of decoded audio for all effects and stand-ins (float32). Low, rumbling stand-ins are kept at a half or quarter sample rate, and long one-shots keep three stand-in takes. Recorded one-shots should stay under about 1 s, with 3–6 takes. Loops over 8 s and music stems are **streamed** through audio elements, not decoded.
- **Voices:** 8 footsteps, 8 work sounds, 16 combat sounds, 10 creature sounds, plus each sound's own limit (the quietest gives way to a louder one), plus the beds. A 400-ant battle rendered offline peaks at −2.6 dBFS with at most 26 voices. Nearly 2,800 combat requests overflow into the battle bed over 8 s.
- **CPU:** rendering every stand-in take takes about 1.3 s in total, spread over idle slices after the first click; each one-shot is a buffer source and a gain.
- **Files:** Ogg Vorbis (quality 5) plus AAC `.m4a` for browsers without Ogg; the game picks one with `canPlayType`.
