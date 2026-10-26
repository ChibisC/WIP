# audio-src

The original audio, before processing. The game never loads anything from here.

- `recordings/<folder>/<name>_NN.<wav|flac|aiff|mp3|ogg>`: originals, named after their slots in [docs/audio/sound-list.md](../docs/audio/sound-list.md). Keep the untouched file; note any edits (pitch, trims, layering) in the Notes column of [ATTRIBUTIONS.md](../docs/audio/ATTRIBUTIONS.md).
- `standins/`: the procedural stand-ins rendered as WAV (`npm run audio:standins`), to listen to or compare against (not committed).

**Processing** (`npm run audio:process`, needs ffmpeg) writes each recording to `public/audio/<folder>/<name>_NN.ogg` (Vorbis q5) and `.m4a` (AAC 128k), then rebuilds the manifest. It:

1. removes rumble below 40 Hz, except for music, bosses, thunder and the low ambience;
2. trims silence from both ends of one-shots (−60 dB) and fades the tail out over 10 ms;
3. normalises one-shots to a −1 dBFS peak, and loops and music over 8 s to −20 LUFS integrated;
4. mixes effects down to mono; ambience and music stay stereo;
5. resamples to 44.1 kHz.
