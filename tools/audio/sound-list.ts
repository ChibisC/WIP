/**
 * Write docs/audio/sound-list.md from the catalog (src/audio/catalog.ts) and public/audio/manifest.json: every
 * sound, where its takes come from (rendered by tools/audio/sfx, or a recording), its file and the audio budget.
 *   npx vite-node tools/audio/sound-list.ts
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { SOUNDS } from '../../src/audio/catalog';
import type { Manifest } from '../../src/audio/bank';

const man: Manifest = existsSync('public/audio/manifest.json') ? JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) : { sr: 44100, sounds: {}, credits: [] };
const recDir = (id: string) => `audio-src/recordings/${id.split('.')[0]}`;
const recorded = (id: string) => {
  const d = recDir(id);
  const name = id.split('.')[1];
  return existsSync(d) ? readdirSync(d).filter((f) => f.startsWith(name + '_')).length : 0;
};
const groups = [...new Set(SOUNDS.map((s) => s.group))];
const withFile = SOUNDS.filter((s) => man.sounds[s.id]).length;
const busName: Record<string, string> = { ambience: 'Ambience', creatures: 'Creatures', combat: 'Combat', ui: 'Interface', music: 'Music', narration: 'Narration' };
// the budget: download sizes, and decoded memory at a 48 kHz context (float32), streamed loops excluded
const size = (ext: string) => SOUNDS.reduce((n, s) => (man.sounds[s.id] && existsSync(`public/audio/${man.sounds[s.id].file}.${ext}`) ? n + statSync(`public/audio/${man.sounds[s.id].file}.${ext}`).size : n), 0);
const decoded = (pred: (id: string) => boolean) =>
  SOUNDS.reduce((n, s) => {
    const f = man.sounds[s.id];
    if (!f || s.stream || !pred(s.id)) return n;
    const samples = (f.takes ?? []).reduce((m, [, len]) => m + len, 0);
    const ch = s.id.startsWith('amb.') && s.loop ? 2 : 1;
    return n + ((samples / man.sr) * (48000 / (s.down ?? 1)) * 4 * ch);
  }, 0);
const MB = (b: number) => (b / 1e6).toFixed(1);
const streamed = SOUNDS.filter((s) => s.stream && man.sounds[s.id]).reduce((n, s) => n + statSync(`public/audio/${man.sounds[s.id].file}.ogg`).size, 0);

let md = `# Sound list

Every sound the game uses, what it should sound like, where to find it, and how to record it yourself.
Generated from \`src/audio/catalog.ts\` by \`npm run audio:list\`: edit the catalog, not this file.

**Status:** ${withFile} of ${SOUNDS.length} sounds are files in \`public/audio\` (audio v3: every sound effect). Each was rendered offline by \`tools/audio/sfx\` from the physics of the real sound (chitin clicks and fractures, stridulation tooth trains, friction, tiny bubbles; research in [sound-research.md](sound-research.md)), unless a recording replaces it. The music and the narration cue are played by the game itself.

## How sounds are made and packed

\`npm run audio:build\` (Python 3 with numpy, scipy, soundfile and pyloudnorm; ffmpeg) renders every recipe's takes into \`audio-src/rendered/\` (not committed), finishes them (trimmed to start on their first sound, short fades, loudness-normalised, loops made seamless) and packs each sound's takes into one file, \`public/audio/<folder>/<name>.ogg\` plus \`.m4a\` (AAC, for Safari without Ogg), listed with each take's position in \`public/audio/manifest.json\`. \`npm run audio:build render <filter>\` re-renders some; \`npm run audio:build pack\` re-packs.

## How to add a recording

1. Find or record it (sources and licences below). Keep the original.
2. Cut it into takes named after the sound: \`audio-src/recordings/<folder>/<name>_01.wav\`, \`_02\`… (the **Recording slots** column). 3–6 takes keep repeats from sounding mechanical; the engine also varies pitch and level.
3. Run \`npm run audio:build\`: a sound with recordings uses them instead of its rendered takes (finished and packed the same way).
4. Add a row to \`docs/audio/ATTRIBUTIONS.md\` (every file, whatever its licence). CC-BY credits appear on the in-game Credits screen.

## Sources and licences

In this order of preference:

1. **Royalty-free commercial libraries that allow use in games.** The free Sonniss GDC Game Audio Bundles (gdc.sonniss.com; a new one every year since 2015) are royalty-free and need no attribution; read the licence text that ships with each bundle. They are strong on nature, foley, insects and field recordings.
2. **Freesound.org**, licences **CC0** or **CC BY** only. Never **CC BY-NC** (non-commercial) or the old Sampling+ licence: a game that might ever be sold cannot use them. In Freesound's search, filter by licence. Record the author and URL of every CC BY sound.
3. **Your own foley** (each sound below has a recipe). A phone works for a start; a small recorder or a lavalier mic gets closer. Record in a quiet room, 5–20 cm from the source, several takes, at 44.1 or 48 kHz, 24-bit if possible, and leave half a second of silence around each take. Insect scale means close and detailed: get the mic right up to small things, and pitch up or down later if needed.
4. **AI sound-effect generators** only if their terms allow commercial game use; write the tool and its licence in ATTRIBUTIONS.md.

Do not take audio from Empires of the Undergrowth or any other game.

## Sounds

`;
for (const g of groups) {
  const list = SOUNDS.filter((s) => s.group === g);
  md += `### ${g}\n\n| Sound | Recording slots | Bus | Length | What it sounds like | Search terms | Record it yourself | Status |\n|---|---|---|---|---|---|---|---|\n`;
  for (const s of list) {
    const n = s.takes;
    const [folder, name] = s.id.split('.');
    const slots = n === 0 ? 'one file per line' : n === 1 ? `\`${folder}/${name}_01\`` : `\`${folder}/${name}_01\` … \`_${String(n).padStart(2, '0')}\``;
    const h = recorded(s.id);
    const f = man.sounds[s.id];
    const takes = f ? (f.takes?.length ?? 1) : 0;
    const status = h ? `recorded (${h} takes)` : f ? `rendered (${takes} take${takes > 1 ? 's' : ''})${s.reserved ? `; ${s.reserved}` : ''}` : s.recipe ? 'played by the game' : s.reserved ? s.reserved : 'procedural score';
    const extra = [s.loop ? 'loop' : '', s.stream ? 'streamed' : ''].filter(Boolean).join(', ');
    md += `| \`${s.id}\` | ${slots} | ${busName[s.bus]} | ${s.dur}${extra ? ` (${extra})` : ''} | ${s.desc.replace(/\|/g, '/')} | ${s.search.map((x) => `"${x}"`).join(', ') || '—'} | ${s.foley.replace(/\|/g, '/')} | ${status} |\n`;
  }
  md += '\n';
}
md += `## Narration lines (optional)

If you record the narrator, read each mission caption (in \`src/sim/missions.ts\`) as its own file, \`narration/voice_<mission>_<stage>_<n>.ogg\`. The captions work without them.

## Budget

- **Download:** ${MB(size('ogg'))} MB of Ogg Vorbis (or ${MB(size('m4a'))} MB of AAC on Safari) for all ${withFile} files; a browser fetches one format. The ambience loops (${MB(streamed)} MB of it) stream, and only the current map's beds are fetched.
- **Memory:** decoded effects are float32 at the audio context's rate (48 kHz on most phones): ${MB(decoded(() => true))} MB if every effect were decoded. A game decodes combat, orders, alerts and work in the background after the first click (${MB(decoded((id) => /^(combat|ui|ant|species)\./.test(id)))} MB) and the rest when first wanted: ambience one-shots of the map, the creatures and titans met. Low sounds (titans, thunder, an owl) decode at half or a quarter rate. Long ambience loops are streamed through audio elements, so they cost no decoded memory. This stays well inside iPhone Safari's limits.
- **Voices:** 8 work sounds, 16 combat sounds, 10 creature sounds at once, plus each sound's own limit and the beds.
`;
writeFileSync('docs/audio/sound-list.md', md);
console.log(`docs/audio/sound-list.md: ${SOUNDS.length} sounds in ${groups.length} groups, ${withFile} files; Ogg ${MB(size('ogg'))} MB, AAC ${MB(size('m4a'))} MB; decoded ${MB(decoded(() => true))} MB (warm ${MB(decoded((id) => /^(combat|ui|ant|species)\./.test(id)))} MB)`);
