/**
 * Geometry fingerprint of every ant morph (LOD0 and LOD1): positions, normals, colours, surface flags, part ids,
 * indices and the rig numbers, hashed per morph. Used to prove a builder change leaves the other species
 * untouched: save a baseline, patch, compare.
 *
 *   npx vite-node tools/morph-hash.ts -- save <file>      write the hashes
 *   npx vite-node tools/morph-hash.ts -- check <file>     compare (exit 1 on any difference; skips morphs not in the file)
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { MORPHS } from '../src/render/ants/morphs';
import { hashMorph } from './morphHashLib';

const args = process.argv.slice(2).filter((a) => a !== '--');
const [mode, file] = args;
const now: Record<string, string> = {};
for (const k of Object.keys(MORPHS).sort()) now[k] = hashMorph(k);
if (mode === 'save') {
  writeFileSync(file, JSON.stringify(now, null, 1));
  console.log(`saved ${Object.keys(now).length} morph hashes to ${file}`);
} else {
  const base = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  let bad = 0;
  let same = 0;
  for (const [k, v] of Object.entries(base)) {
    if (!(k in now)) {
      console.log(`  gone     ${k}`);
      continue;
    }
    if (now[k] !== v) {
      bad++;
      console.log(`  CHANGED  ${k}: ${v} -> ${now[k]}`);
    } else same++;
  }
  for (const k of Object.keys(now)) if (!(k in base)) console.log(`  new      ${k} (${now[k]})`);
  console.log(`${same} unchanged, ${bad} changed`);
  if (bad) process.exit(1);
}
