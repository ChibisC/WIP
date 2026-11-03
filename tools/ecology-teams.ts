/**
 * Teams of AI colonies (CHANGE_PLAN §23): a 2v2 of AI colonies on an authored map (placed by team, world/teamSites.ts)
 * for N minutes, with the ally brain on or off. Prints each colony's ants, deaths and kills, and its ally brain (help
 * started, why the last stopped) every 5 minutes, and who is alive at the end.
 * Lineups: `mixed` Black garden + Red wood v Fire ant + Leafcutter (the leafcutters are much the strongest), `mirror`
 * Black garden + Red wood on both sides, `swap` Black garden + Leafcutter v Red wood + Fire ant.
 *   npx vite-node tools/ecology-teams.ts -- [minutes=45] [seed=1] [help=1] [map=meadowPond] [creatures=1] [lineup=mixed]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { BALANCE } from '../src/sim/balance';
import { AS } from '../src/sim/types';
import { MapId } from '../src/maps/types';
import { SpeciesId, SPECIES } from '../src/sim/species';

const args = process.argv.slice(2).filter((a) => a !== '--');
const minutes = Number(args[0] ?? 45);
const seed = Number(args[1] ?? 1);
BALANCE.aiAllies.help = (args[2] ?? '1') !== '0';
const map = (args[3] ?? 'meadowPond') as MapId;
const crMul = Number(args[4] ?? 1);
const lineup = args[5] ?? 'mixed';
const SIDES: Record<string, SpeciesId[]> = { mixed: ['lasius', 'formica', 'solenopsis', 'atta'], mirror: ['lasius', 'formica', 'lasius', 'formica'], swap: ['lasius', 'atta', 'formica', 'solenopsis'] };
const sp = SIDES[lineup] ?? SIDES.mixed;
const w = createWorld(
  {
    seed,
    style: 'meadow',
    width: 1600,
    depth: 1600,
    map,
    food: 1.2,
    colonies: [
      ...sp.map((species, k) => ({ species, player: k === 0, ai: true, team: k < 2 ? 0 : 1, developed: 6, startWorkers: 14, name: `${SPECIES[species]?.name ?? species} (team ${k < 2 ? 1 : 2})` })),
    ],
    settings: { creatures: crMul },
  },
  new EventBus(),
);
let helps = 0;
const fell: number[] = w.s.colonies.map(() => -1);
const starts: number[] = w.s.colonies.map(() => 0);
const stops: Array<Record<string, number>> = w.s.colonies.map(() => ({}));
for (let m = 1; m <= minutes; m++) {
  for (let i = 0; i < 1200; i++) {
    const before = w.s.colonies.map((c) => c.aiAlly?.ally ?? -1);
    w.step(0.05);
    w.s.colonies.forEach((c, k) => {
      const now = c.aiAlly?.ally ?? -1;
      if (before[k] < 0 && now >= 0) (helps++, starts[k]++);
      if (before[k] >= 0 && now < 0 && c.aiAlly?.why) stops[k][c.aiAlly.why] = (stops[k][c.aiAlly.why] ?? 0) + 1;
      if (!c.alive && fell[k] < 0) fell[k] = w.s.time / 60;
    });
  }
  w.events.drain();
  if (m % 5 && m !== minutes) continue;
  const cols = w.s.colonies.map((c) => {
    const n = w.s.ants.filter((a) => a.colony === c.id && a.state !== AS.Dead).length;
    const war = c.aiWar && c.alive ? (c.aiWar.target >= 0 ? `→${c.aiWar.target}` : c.aiWar.defending ? 'def' : '') : '';
    const ally = c.aiAlly ? `${c.aiAlly.ally >= 0 ? `help→${c.aiAlly.ally}` : ''}${c.aiAlly.why ? ` (${c.aiAlly.why})` : ''}` : '';
    return `${c.species.slice(0, 4)}${c.alive ? '' : '✝'} ${String(n).padStart(3)} d${c.stats.died}/k${c.stats.kills} ${war} ${ally}`.padEnd(34);
  });
  console.log(`${String(m).padStart(3)} min  ${cols.join(' | ')}`);
}
const alive = w.s.colonies.map((c) => (c.alive ? 1 : 0));
w.s.colonies.forEach((c, k) =>
  console.log(`  ${c.name.padEnd(28)} ${c.alive ? 'alive' : `fell at ${fell[k].toFixed(1)} min`}, ants ${c.living}, died ${c.stats.died}, kills ${c.stats.kills}, helped ${starts[k]}× ${Object.entries(stops[k]).map(([why, n]) => `${why} ${n}`).join(', ')}${c.aiAlly ? `, flips ${c.aiAlly.flips}` : ''}`),
);
console.log(`end: ${lineup}, help ${BALANCE.aiAllies.help ? 'on' : 'off'}, seed ${seed}, alive ${alive.join('')} (team 1: ${alive[0] + alive[1]}/2, team 2: ${alive[2] + alive[3]}/2), help started ${helps} times`);
