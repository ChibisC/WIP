/**
 * Render every stand-in sound to WAV, for listening and measuring outside the game.
 *   npx vite-node tools/audio/render-standins.ts [outDir] [filter]
 * Writes <outDir>/<folder>/<name>_NN.wav (default outDir: audio-src/standins) and prints timings.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SOUNDS, takePath } from '../../src/audio/catalog';
import { RECIPES, SR } from '../../src/audio/standins';
import { decimate, rng } from '../../src/audio/dsp';

const outDir = process.argv[2] || 'audio-src/standins';
const filter = process.argv[3] || '';

function wav(x: Float32Array, sr: number): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return b;
}

let total = 0;
for (const s of SOUNDS) {
  if (!s.recipe || (filter && !s.id.includes(filter))) continue;
  const n = s.loop ? 1 : Math.max(1, s.takes);
  const t0 = performance.now();
  for (let k = 1; k <= n; k++) {
    const x = decimate(RECIPES[s.recipe](rng(k * 7919 + s.id.length * 31)), SR, s.down ?? 1);
    const p = join(outDir, takePath(s.id, k) + '.wav');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, wav(x, SR / (s.down ?? 1)));
  }
  const ms = performance.now() - t0;
  total += ms;
  console.log(`${s.id.padEnd(28)} ${n} take(s) ${(ms / n).toFixed(1).padStart(7)} ms each`);
}
console.log(`total ${(total / 1000).toFixed(2)} s`);
