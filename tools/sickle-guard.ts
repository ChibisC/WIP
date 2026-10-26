/**
 * The Sickle-Jaw guard line (user notes 2026-10-25): where the guards stand along the workers' route and how much
 * of the workers' walking stays inside the guarded corridor. Scene: tools/sickleGuardScene.ts.
 *
 *   npx vite-node tools/sickle-guard.ts -- [workers=24] [soldiers=12] [seed=5]
 */
import { guardScene } from './sickleGuardScene';
import { CASTES } from '../src/sim/species';
import { SICKLE } from '../src/sim/balance';

const args = process.argv.slice(2).filter((a) => a !== '--');
const nW = Number(args[0] ?? 24);
const nS = Number(args[1] ?? 12);
const seed = Number(args[2] ?? 5);
const r = guardScene(nW, nS, seed);
const L = CASTES.rhy_soldier.length;
console.log(`route ${r.trail.toFixed(0)} mm (straight line ${r.straight.toFixed(0)} mm)`);
console.log(`${r.guards} guards, ${r.gatherers} gathering; ${r.atEntrance} at the entrance; spread from ${r.arcFrom.toFixed(0)} to ${r.arcTo.toFixed(0)} mm along the route, largest gap ${r.maxGap.toFixed(0)} mm`);
console.log(`guards stand ${Math.min(...r.sideDist).toFixed(1)}–${Math.max(...r.sideDist).toFixed(1)} mm from the route (row half-width ${(SICKLE.escort.halfWidthBodyLengths * L).toFixed(1)} mm)`);
console.log(`workers walking the route inside the guarded corridor: ${(100 * r.insideFrac).toFixed(0)} %`);
