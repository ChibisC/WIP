/**
 * Write docs/audio/sound-list.md from the catalog (src/audio/catalog.ts), with
 * which sounds already have recordings in public/audio.
 *   npx vite-node tools/audio/sound-list.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SOUNDS, takePath } from '../../src/audio/catalog';

const man = existsSync('public/audio/manifest.json') ? (JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as { files: Record<string, string[]> }) : { files: {} };
const have = (id: string, n: number) => Array.from({ length: n }, (_, i) => takePath(id, i + 1)).filter((p) => man.files[p]).length;
const groups = [...new Set(SOUNDS.map((s) => s.group))];
const total = SOUNDS.filter((s) => !s.reserved).length;
const recorded = SOUNDS.filter((s) => have(s.id, Math.max(1, s.takes)) > 0).length;
const busName: Record<string, string> = { ambience: 'Ambience', creatures: 'Creatures', combat: 'Combat', ui: 'Interface', music: 'Music', narration: 'Narration' };

let md = `# Sound list

Every sound the game uses, what it should sound like, where to find it, and how to record it yourself.
Generated from \`src/audio/catalog.ts\` by \`npm run audio:list\`: edit the catalog, not this file.

**Status:** ${recorded} of ${SOUNDS.length} sounds have recordings (${total} are used by the game now; the rest wait for features still to come). Every sound without a recording plays an organic stand-in synthesised from the physics of the real sound (grain crackle, chitin and wood resonances, bubbles, stridulation pulse trains), so the game is never silent while recordings are gathered.

## How to add a recording

1. Find or record it (sources and licences below). Keep the original.
2. Cut it into takes and name each take after its slot: \`audio-src/recordings/<folder>/<name>_01.wav\`, \`_02\`… The **File slots** column below gives the names. Several takes of the same action (3–6) keep repeats from sounding mechanical; the engine also varies pitch and level.
3. Run \`npm run audio:process\` (needs ffmpeg). It trims, fades and normalises each file into \`public/audio\` as Ogg Vorbis plus AAC (\`.m4a\`, for older Safari), and rebuilds \`public/audio/manifest.json\`. The game picks the files up on the next load with no code change.
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
  md += `### ${g}\n\n| Sound | File slots | Bus | Length | What it should sound like | Search terms | Record it yourself | Status |\n|---|---|---|---|---|---|---|---|\n`;
  for (const s of list) {
    const n = s.takes;
    const slots = n === 0 ? 'one file per line' : n === 1 ? `\`${takePath(s.id, 1)}\`` : `\`${takePath(s.id, 1)}\` … \`_${String(n).padStart(2, '0')}\``;
    const h = have(s.id, Math.max(1, n));
    const status = h ? `recorded (${h}/${Math.max(1, n)})` : s.reserved ? `stand-in; ${s.reserved}` : s.recipe ? 'stand-in' : 'procedural score';
    const extra = [s.loop ? 'loop' : '', s.stream ? 'streamed' : ''].filter(Boolean).join(', ');
    md += `| \`${s.id}\` | ${slots} | ${busName[s.bus]} | ${s.dur}${extra ? ` (${extra})` : ''} | ${s.desc.replace(/\|/g, '/')} | ${s.search.map((x) => `"${x}"`).join(', ') || '—'} | ${s.foley.replace(/\|/g, '/')} | ${status} |\n`;
  }
  md += '\n';
}
md += `## Narration lines (optional)

If you record the narrator, read each mission caption (in \`src/sim/missions.ts\`) as its own file, \`narration/voice_<mission>_<stage>_<n>.ogg\`. The captions work without them.

## Budget

Short sounds are decoded into memory: a second of mono audio at 44.1 kHz takes about 170 kB. Aim for one-shots under 1 s and 3–6 takes each, which keeps all effects under about 25 MB decoded. Loops longer than 8 s and the music stems are streamed instead of decoded, so their length costs download size only (Ogg at quality 5 is roughly 100 kB per 10 s of mono). The stand-ins the game warms up take about 25 MB decoded (low, rumbling ones are kept at a quarter or half sample rate; long ones keep three takes); a sound with recordings frees its stand-in.
`;
writeFileSync('docs/audio/sound-list.md', md);
console.log(`docs/audio/sound-list.md: ${SOUNDS.length} sounds in ${groups.length} groups, ${recorded} recorded`);
