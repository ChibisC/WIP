/**
 * Dump mandible meshes from the shared generator (jaws pass) as JSON for tools/mandible-plot.py:
 *
 *   npx vite-node tools/mandible-dump.ts -- out.json
 *
 * Each entry: a pair (left and right) at its rest pivots, closed, so the top and side outlines can be
 * checked against the reference photos without the browser.
 */
import { writeFileSync } from 'node:fs';
import { apexOf, buildMandible, fitLen, mergedMandible, MandibleSpec } from '../src/render/anatomy/mandible';
import { FIRE_MAJOR, FIRE_WORKER, stagMandible } from '../src/render/anatomy/mandibleSpecs';

const out = process.argv[2] || 'mandibles.json';
const res: Record<string, unknown> = {};
function pair(name: string, spec: MandibleSpec, halfGap: number, inward: number | null): void {
  const sp = inward !== null ? fitLen(spec, inward) : spec;
  const ap = apexOf(sp);
  console.log(name, 'len', sp.len.toFixed(3), 'apex fwd', (ap.fwd * sp.len).toFixed(3), 'inward', (ap.inward * sp.len).toFixed(3), 'up', (ap.up * sp.len).toFixed(3));
  const items = [];
  for (const side of [1, -1] as const) {
    const m = buildMandible(sp, side);
    const { pos, idx } = mergedMandible(m);
    for (let i = 0; i < pos.length; i += 3) pos[i + 2] += side * halfGap;
    items.push({ pos, idx, tips: m.tips.map((t) => [t.x, t.y, t.z + side * halfGap]) });
  }
  res[name] = items;
}
pair('fire_worker', FIRE_WORKER, 0.32, 0.32 * 1.06);
pair('fire_major', FIRE_MAJOR, 0.32, 0.32 * 1.04);
for (const s of [0, 0.5, 1]) pair(`stag_${s}`, stagMandible(s), 0.32, null);
writeFileSync(out, JSON.stringify(res));
console.log('wrote', out, Object.keys(res).join(', '));
