/**
 * Story titan raid probe (claude/story/05-spec-story-titans-get-inside.md §1; the probe itself: tools/titanProbe.ts).
 *   npx vite-node tools/titan-raid-probe.ts -- [level=longNights] [setup=none] [difficulty=normal] [seed=5] [army=60]
 *   LOG=1 (every tick) or LINES=1 (once a second) prints the raid state lines.
 */
import { probe, type ProbeSetup } from './titanProbe';
import type { Difficulty, StoryLevelId } from '../src/sim/story/types';

const args = process.argv.slice(2).filter((a) => a !== '--');
const level = (args[0] ?? 'longNights') as StoryLevelId;
const setup = (args[1] ?? 'none') as ProbeSetup;
const diff = (args[2] ?? 'normal') as Difficulty;
const seed = Number(args[3] ?? 5);
const army = Number(args[4] ?? 60);
const r = probe(level, setup, diff, seed, army, 300, !!process.env.LOG);
console.log(`${level} / ${setup} / ${diff} (seed ${seed}, army ${army}): start ${r.start.toFixed(1)} dig ${r.dig.toFixed(1)} inside ${r.inside.toFixed(1)} (dug ${r.digSec.toFixed(1)} s) ${r.diedOutside ? 'DIED OUTSIDE ' : ''}${r.doneEarly ? 'CUE DONE EARLY ' : ''}hp in ${(r.hpIn * 100).toFixed(0)} % end ${(r.hpEnd * 100).toFixed(0)} %`);
for (const n of r.notes) console.log('  ' + n);
if (process.env.LOG || process.env.LINES) for (const l of r.lines) console.log('    ' + l);
