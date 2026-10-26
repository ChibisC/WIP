/**
 * Army-ant raid stress (plan Step 7): ~600 army ants raiding one marker; simulation time per tick, against the
 * same number of black garden ants foraging at a marker in the same map (the baseline).
 *
 *   npx vite-node tools/eciton-stress.ts -- [ants=600] [seconds=60]
 */
import { raidScene } from './ecitonScene';
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { makeAnt, makeFood } from '../src/sim/factory';
import { assignGroup, placeMarker } from '../src/sim/markers';
import { SURFACE } from '../src/sim/types';

const args = process.argv.slice(2).filter((a) => a !== '--').map(Number);
const N = args[0] ?? 600;
const secs = args[1] ?? 60;

let t = Date.now();
raidScene({ minors: Math.round(N * 0.8), porters: Math.round(N * 0.08), medias: Math.round(N * 0.07), majors: Math.round(N * 0.05), seconds: secs, prey: 60, puddle: true });
const army = (Date.now() - t) / (secs * 20);

// baseline: the same number of Lasius workers on a marker with food
const w = createWorld({ seed: 5, style: 'meadow', width: 700, depth: 700, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
const c = w.colony(0)!;
const e = c.entrances[0];
const mx = e.sx + 150;
const my = e.sy;
for (let i = 0; i < 60; i++) makeFood(w, 'insect', SURFACE, mx + Math.cos(i * 2.4) * 50 * Math.sqrt(i / 60), my + Math.sin(i * 2.4) * 50 * Math.sqrt(i / 60), 1.4, 'cricket');
placeMarker(w, c, 0, SURFACE, mx, my);
const ch = c.tiles.find((tl) => tl.type === 'queen')!;
for (let i = 0; i < N; i++) {
  const a = makeAnt(w, 0, 'lasius_worker', SURFACE, e.sx + Math.cos(i * 2.4) * (6 + i * 0.1), e.sy + Math.sin(i * 2.4) * (6 + i * 0.1), 0);
  a.tile = ch.q;
  a.task = 'marker';
  a.marker = 0;
}
assignGroup(w, c, ch.group, 0);
w.reindex();
t = Date.now();
for (let i = 0; i < secs * 20; i++) {
  w.step(0.05);
  w.events.drain();
}
const base = (Date.now() - t) / (secs * 20);
console.log(`${N} army ants raiding: ${army.toFixed(2)} ms per tick; ${N} black garden ants foraging: ${base.toFixed(2)} ms per tick (× ${(army / base).toFixed(2)})`);
