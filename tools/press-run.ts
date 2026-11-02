/**
 * Pressing in and taking turns, one scene (tools/press-probe.ts):
 *
 *   npx vite-node tools/press-run.ts -- [victimCaste=lasius_worker] [attackerCaste=fire_minor] [n=14] [sec=20] [seed=11]
 */
import { pressScene } from './press-probe';

const args = ((globalThis as unknown as { process?: { argv: string[] } }).process?.argv ?? []).slice(2).filter((a) => a !== '--');
const s = pressScene(args[0], args[1], args[2] ? +args[2] : undefined, args[3] ? +args[3] : undefined, args[4] ? +args[4] : undefined);
console.log(JSON.stringify(s, (k, x) => (typeof x === 'number' ? +x.toFixed(3) : x)));
