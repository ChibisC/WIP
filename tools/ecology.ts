/**
 * Creature balance harness: the determinism scenario (4 AI colonies, a cave
 * and a lair) for N minutes with wild creatures at a given scale. Prints each
 * colony's ants, deaths and kills, and the creatures alive, every 2 minutes.
 *   npx vite-node tools/ecology.ts -- [minutes=20] [creaturesMul=1.5] [seed]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { DET_SETUP } from '../src/dev/determinism';
import { AS } from '../src/sim/types';

const args = process.argv.slice(2).filter((a) => a !== '--');
const minutes = Number(args[0] ?? 20);
const mul = Number(args[1] ?? 1.5);
const seed = Number(args[2] ?? DET_SETUP.seed);
const w = createWorld({ ...DET_SETUP, seed, settings: { ...DET_SETUP.settings, creatures: mul } }, new EventBus());
let crDeaths = 0;
w.events.onAny((e) => {
  if (e.t === 'death' && e.kind === 'creature') crDeaths++;
});
for (let m = 1; m <= minutes; m++) {
  for (let i = 0; i < 1200; i++) w.step(0.05);
  w.events.drain();
  if (m % 2 && m !== minutes && minutes <= 20) continue;
  const cols = w.s.colonies.map((c) => {
    const n = w.s.ants.filter((a) => a.colony === c.id && a.state !== AS.Dead).length;
    const war = c.aiWar && c.alive ? (c.aiWar.target >= 0 ? `→${c.aiWar.target}` : c.aiWar.defending ? 'def' : '') : '';
    return `${c.species.slice(0, 4)}${c.alive ? '' : '✝'} ${String(n).padStart(3)} d${c.stats.died}/k${c.stats.kills} ${war}`.padEnd(24);
  });
  const crs: Record<string, number> = {};
  for (const cr of w.s.creatures) if (!cr.dead) crs[cr.kind] = (crs[cr.kind] ?? 0) + 1;
  console.log(`${String(m).padStart(3)} min  ${cols.join(' | ')}  creatures ${JSON.stringify(crs)} (${crDeaths} killed)`);
}
