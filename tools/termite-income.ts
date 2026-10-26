/**
 * Calibration (skill implement-nasute-termites §3): termite wood income per
 * worker-minute should be within ±10 % of the baseline ant's food income.
 * Runs AI-driven Black Garden Ant, Nasute Termite and Sickle-Jaw Termite colonies on the same maps
 * (a few seeds), lets each grow to a small fixed population, then measures
 * what its foragers bring home per worker-minute.
 *
 *   npx vite-node tools/termite-income.ts -- [seeds=4] [minutes=10]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS } from '../src/sim/types';
import { casteOf, SpeciesId } from '../src/sim/species';
import { NASUTE, SICKLE } from '../src/sim/balance';

const args = process.argv.slice(2).filter((a) => a !== '--');
const seeds = Number(args[0] ?? 4);
const minutes = Number(args[1] ?? 10);

function measure(species: SpeciesId, seed: number): { perWorkerMin: number; workers: number; income: number } {
  const w = createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 1.2, colonies: [{ species, player: true, ai: true, popLimit: 18, startFood: 70 }] }, new EventBus());
  const c = w.colony(0)!;
  // grow and settle
  for (let i = 0; i < 20 * 180; i++) w.step(0.05);
  const food0 = c.stats.food;
  let workerSum = 0;
  let samples = 0;
  for (let i = 0; i < 20 * 60 * minutes; i++) {
    w.step(0.05);
    if (i % 20 === 0) {
      let n = 0;
      for (const a of w.s.ants) if (a.colony === 0 && a.state !== AS.Dead && casteOf(a.caste).forage && casteOf(a.caste).carry > 0 && a.id !== c.queen) n++;
      workerSum += n;
      samples++;
    }
  }
  const workers = workerSum / samples;
  const income = c.stats.food - food0;
  return { perWorkerMin: income / Math.max(1, workers) / minutes, workers, income };
}

const res: Record<string, number[]> = { lasius: [], nasutitermes: [], rhynchotermes: [] };
for (let s = 0; s < seeds; s++) {
  for (const sp of ['lasius', 'nasutitermes', 'rhynchotermes'] as SpeciesId[]) {
    const r = measure(sp, 300 + s * 11);
    res[sp].push(r.perWorkerMin);
    console.log(`${sp.padEnd(13)} seed ${s}: ${r.income.toFixed(0)} in ${minutes} min, ${r.workers.toFixed(1)} workers → ${r.perWorkerMin.toFixed(2)} per worker-minute`);
  }
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const ant = mean(res.lasius);
const ter = mean(res.nasutitermes);
const rhy = mean(res.rhynchotermes);
console.log(`\nBlack Garden Ant ${ant.toFixed(2)} food / worker-minute; Nasute Termite ${ter.toFixed(2)} wood / worker-minute (woodPerFragment ${NASUTE.wood.woodPerFragment}) → ratio ${(ter / ant).toFixed(2)}`);
console.log(`Sickle-Jaw Termite ${rhy.toFixed(2)} plant matter / forager-minute (leaf litter ${SICKLE.food.leafLitterPatch.perFragment} per fragment) → ratio ${(rhy / ant).toFixed(2)}`);
