/**
 * Determinism test (multiplayer brief, Parts B and F): same seed and scripted
 * orders, run twice from tick 0 and once restored from a mid-run binary
 * snapshot; state hashes compared every 100 ticks.
 *
 *   npx vite-node tools/determinism.ts -- [minutes=20] [--out hashes.json]
 *
 * The hash list can be compared with a browser run (tests/browser/determinism.py).
 */
import { writeFileSync } from 'node:fs';
import { runDeterminism } from '../src/dev/determinism';

const args = process.argv.slice(2).filter((a) => a !== '--');
const minutes = Number(args.find((a) => /^[0-9.]+$/.test(a)) ?? 20);
const outI = args.indexOf('--out');
const ticks = Math.round(minutes * 60 * 20);
const r = runDeterminism(ticks);
console.log(`${minutes} min of game time (${ticks} ticks), ${r.a.length} checkpoints, ${r.ants} ants at the end, snapshot ${(r.snapshotBytes / 1024).toFixed(0)} KB`);
console.log(`run A ${(r.ms.a / 1000).toFixed(1)} s, run B ${(r.ms.b / 1000).toFixed(1)} s, run C (restored at tick ${r.cFrom * r.every}) ${(r.ms.c / 1000).toFixed(1)} s, hashing ${(r.ms.hash / 1000).toFixed(1)} s total`);
console.log(`final hash ${r.a[r.a.length - 1]}`);
const okA = r.staleFields.length === 0;
console.log(`${okA ? 'PASS' : 'FAIL'}  every cached nest path field equals a fresh build at every checkpoint${okA ? '' : `: ${r.staleFields.slice(0, 8).join(', ')}`}`);
const okB = r.bDiff < 0;
const okC = r.cDiff < 0;
console.log(`${okB ? 'PASS' : 'FAIL'}  two runs from tick 0 give identical hashes${okB ? '' : ` (first difference at tick ${(r.bDiff + 1) * r.every})`}`);
console.log(`${okC ? 'PASS' : 'FAIL'}  a run restored from a snapshot matches${okC ? '' : ` (first difference at tick ${(r.cDiff + 1) * r.every})`}`);
if (outI >= 0) writeFileSync(args[outI + 1], JSON.stringify({ engine: `node ${process.version}`, ticks, every: r.every, hashes: r.a }, null, 1));
process.exit(okA && okB && okC ? 0 : 1);
