/**
 * Check every authored map against the site, entrance and connectivity rules (docs/maps/design.md §4, §8)
 * and print what was measured. Run: npx vite-node tools/validate-maps.ts [-- mapId …]
 */
import { MAPS, PLAYABLE_MAPS } from '../src/maps';
import type { MapId } from '../src/maps/types';
import { validateMap } from '../src/world/mapValidate';

const argv = (globalThis as unknown as { process: { argv: string[]; exitCode: number } }).process;
const ids = (argv.argv.slice(2).filter((a) => a !== '--') as MapId[]).filter((a) => MAPS[a]);
let bad = 0;
for (const id of ids.length ? ids : [...PLAYABLE_MAPS, 'testPond' as MapId]) {
  const def = MAPS[id]!;
  const t0 = Date.now();
  const r = validateMap(def, 1, id === 'testPond' ? 4 : 10);
  for (const l of r.info) console.log(l);
  for (const p of r.problems) console.log(`  PROBLEM  ${p}`);
  console.log(`${r.problems.length ? 'FAIL' : 'OK  '}  ${id}: ${r.problems.length} problem(s), ${Date.now() - t0} ms\n`);
  if (r.problems.length) bad++;
}
if (bad) argv.exitCode = 1;
