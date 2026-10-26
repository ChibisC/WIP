/**
 * Scan public/audio for recorded takes and write public/audio/manifest.json,
 * which tells the game which sounds have files (the rest play stand-ins).
 * Credits come from the table in docs/audio/ATTRIBUTIONS.md.
 *   npx vite-node tools/audio/build-manifest.ts
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SOUNDS, takePath } from '../../src/audio/catalog';

const root = 'public/audio';
const files: Record<string, string[]> = {};
const walk = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const m = /^(.*)\.(ogg|m4a|mp3|opus|webm|wav)$/i.exec(relative(root, p).replace(/\\/g, '/'));
      if (m) (files[m[1]] ??= []).push(m[2].toLowerCase());
    }
  }
};
walk(root);
// the credits table: | File | Title | Author | Source URL | License | ... |
const credits: Array<{ file: string; title: string; author: string; url: string; license: string }> = [];
const attr = 'docs/audio/ATTRIBUTIONS.md';
if (existsSync(attr)) {
  let fence = false;
  for (const line of readFileSync(attr, 'utf8').split('\n')) {
    if (line.trim().startsWith('```')) fence = !fence;
    if (fence) continue;
    const c = line.split('|').map((x) => x.trim());
    if (c.length < 7 || !c[1] || c[1].startsWith('File') || c[1].startsWith('---') || c[1].startsWith('*')) continue;
    credits.push({ file: c[1].replace(/`/g, ''), title: c[2], author: c[3], url: c[4], license: c[5] });
  }
}
const known = new Set(SOUNDS.flatMap((s) => Array.from({ length: Math.max(1, s.takes) }, (_, i) => takePath(s.id, i + 1))));
const stray = Object.keys(files).filter((p) => !known.has(p));
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ files, credits }, null, 1) + '\n');
const covered = SOUNDS.filter((s) => Object.keys(files).some((p) => p.startsWith(takePath(s.id, 1).slice(0, -3)))).length;
console.log(`manifest: ${Object.keys(files).length} take file(s), ${covered}/${SOUNDS.length} sounds recorded, ${credits.length} credit(s)`);
if (stray.length) console.log(`not in the catalog (check the names): ${stray.join(', ')}`);
