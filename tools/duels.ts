/**
 * Probe: does a big melee break into small, readable duels with ground between them (combat v2, CHANGE_PLAN §16)?
 * See tools/duelScenes.ts for what is measured.
 *
 *   npx vite-node tools/duels.ts -- [a=ant:lasius_worker] [na=60] [b=ant:fire_soldier] [nb=60] [secs=20] [seed=4]
 */
import { duelBattle } from './duelScenes';

const args = process.argv.slice(2).filter((a) => a !== '--');
const r = duelBattle(args[0] ?? 'ant:lasius_worker', Number(args[1] ?? 60), args[2] ?? 'ant:fire_soldier', Number(args[3] ?? 60), Number(args[4] ?? 20), Number(args[5] ?? 4), true);
console.log(`mean over ${r.samples} samples: ${r.fighters.toFixed(0)} fighting, ${r.clusters.toFixed(1)} clusters, largest ${r.largest.toFixed(1)}, ${(r.small * 100).toFixed(0)} % in clusters ≤ 4, ${(r.overlap * 100).toFixed(0)} % overlapping, nn teammate ${r.nnTeam.toFixed(2)} BL`);
