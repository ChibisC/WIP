// @ts-nocheck — a Node script (vite-node): tsconfig types the browser build only, without Node's modules
/**
 * Audio v3 (claude/audio/03-spec-sfx-rework-insect.md): the catalog, the packed files, the manifest and the
 * attributions agree; no walking or termite idle sound is left anywhere; every sound has 3-6 takes.
 *   npx vite-node tests/audio.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SOUNDS, SOUND } from '../src/audio/catalog';
import type { Manifest } from '../src/audio/bank';
import { MUSIC_RECIPES } from '../src/audio/instruments';

let fails = 0;
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ` — ${info}` : ''}`);
};

const man = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as Manifest;

// every effect is a file; only the music and the narration cue are made in the game
const noFile = SOUNDS.filter((s) => !man.sounds[s.id] && !(s.recipe && MUSIC_RECIPES[s.recipe]) && s.bus !== 'music' && s.id !== 'narration.voice');
check('every sound effect has a file', noFile.length === 0, noFile.map((s) => s.id).join(', '));
const stray = Object.keys(man.sounds).filter((id) => !SOUND[id]);
check('every file belongs to a catalog sound', stray.length === 0, stray.join(', '));
const missing: string[] = [];
let bytes = 0;
for (const [id, f] of Object.entries(man.sounds)) {
  for (const e of f.ext) {
    const p = `public/audio/${f.file}.${e}`;
    if (!existsSync(p) || statSync(p).size < 200) missing.push(p);
    else if (e === 'ogg') bytes += statSync(p).size;
  }
  void id;
}
check('the manifest lists real files (Ogg and AAC)', missing.length === 0, missing.slice(0, 5).join(', '));
const onDisk: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ogg|m4a|mp3|wav|opus)$/.test(f)) onDisk.push(p.replace(/\\/g, '/').replace(/^public\/audio\//, '').replace(/\.\w+$/, ''));
  }
};
walk('public/audio');
const known = new Set(Object.values(man.sounds).map((f) => f.file));
const orphans = [...new Set(onDisk)].filter((p) => !known.has(p));
check('no audio file outside the manifest', orphans.length === 0, orphans.slice(0, 5).join(', '));

// takes: 3-6 for one-shots, one for loops, as the catalog says; offsets in order
const badTakes: string[] = [];
for (const s of SOUNDS) {
  const f = man.sounds[s.id];
  if (!f) continue;
  const n = f.takes?.length ?? 1;
  if (s.loop ? n !== 1 : n < 3 || n > 6 || n !== s.takes) badTakes.push(`${s.id}: ${n} (catalog ${s.takes})`);
  let end = 0;
  for (const [start, len] of f.takes ?? []) {
    if (start < end || len <= 0) badTakes.push(`${s.id}: take offsets`);
    end = start + len;
  }
}
check('every sound has 3-6 takes (loops one), matching the catalog', badTakes.length === 0, badTakes.join('; '));

// the attributions: a row per file
const attr = readFileSync('docs/audio/ATTRIBUTIONS.md', 'utf8');
const noRow = Object.values(man.sounds).filter((f) => !attr.includes(`\`${f.file}.ogg\``));
check('every file has a source and licence row in ATTRIBUTIONS.md', noRow.length === 0, noRow.map((f) => f.file).slice(0, 5).join(', '));

// removed: ant and termite walking, the swarm bed, the termite kit's procedural voices; nothing may refer to them
const REMOVED = ['ant.step_soil', 'ant.step_leaf', 'ant.step_bark', 'ant.step_stone', 'ant.step_sand', 'ant.step_carton', 'ant.step_queen', 'ant.swarm_bed', 'species.nasute_move', 'species.hellant_struggle',
  // review 2026-11-07: drips, trickles, pellets, loads, food cutting, brood, light hits, struggles and ant/termite deaths are silent
  'amb.drip', 'amb.raindrop_big', 'amb.soil_trickle', 'ant.soil_grains', 'ant.pellet_drop', 'ant.pick_up', 'ant.put_down', 'ant.food_cut', 'ant.seed_crack', 'ant.egg_set', 'ant.queen_lay', 'combat.hit_tick', 'combat.struggle', 'combat.ant_death', 'combat.termite_death'];
check('the walking sounds and the swarm bed are gone from the catalog', REMOVED.every((id) => !SOUND[id]));
const src: string[] = [];
const walkSrc = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walkSrc(p);
    else if (/\.ts$/.test(f)) src.push(p);
  }
};
walkSrc('src');
const refs: string[] = [];
for (const p of src) {
  const t = readFileSync(p, 'utf8');
  for (const id of REMOVED) if (t.includes(`'${id}'`)) refs.push(`${p}: ${id}`);
  if (/SickleJawAudio|standins'/.test(t)) refs.push(`${p}: stand-in or SickleJawAudio`);
}
check('no code plays a removed sound', refs.length === 0, refs.slice(0, 5).join('; '));
// no footstep scanning for ants: the only per-ant sounds in view are loads and an antenna tap, and termites get no tap
const ga = readFileSync('src/audio/gameAudio.ts', 'utf8');
check('ants have no step pool or ground-type steps', !/'steps'|ground\(/.test(ga) && !/pool: 'steps'/.test(ga));
check('termites get no antenna taps (no idle sounds)', /antenna_tap/.test(ga) && /!CASTES\[a\.caste\]\?\.termite\) this\.want\('ant\.antenna_tap'/.test(ga));
check('creature deaths are per family', /cr\.death_spider/.test(ga) && /cr\.death_beetle/.test(ga) && /cr\.death_soft/.test(ga));
check('a termite alarm drums (headbang), an ant alarm stridulates', /termite \? 'species\.termite_headbang' : 'ant\.stridulate'/.test(ga));

console.log(`audio: ${Object.keys(man.sounds).length} files, ${(bytes / 1e6).toFixed(2)} MB of Ogg`);
if (fails) {
  console.log(`${fails} audio check(s) failed`);
  process.exit(1);
}
console.log('audio checks passed');
