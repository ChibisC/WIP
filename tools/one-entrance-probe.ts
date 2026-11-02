/** Quick look at the one-entrance rework: the flower, the holes, traffic per hole. npx vite-node tools/one-entrance-probe.ts */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { SURFACE, nestSpace } from '../src/sim/types';

for (const species of ['lasius', 'formica', 'atta', 'solenopsis', 'eciton', 'nasutitermes', 'termant'] as const) {
  const w = createWorld({ seed: 3, style: 'meadow', width: 700, depth: 700, colonies: [{ species, player: true, ai: true }, { species: 'formica', player: false, ai: true }] } as never, new EventBus());
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const holes = c.entrances.map((e) => `(${e.sx.toFixed(0)},${e.sy.toFixed(0)})`).join(' ');
  const gaps = c.entrances.map((e, i) => Math.hypot(e.sx - c.entrances[(i + 1) % 3].sx, e.sy - c.entrances[(i + 1) % 3].sy).toFixed(0)).join('/');
  const ed = g.flowerEdges(0);
  let t0 = 0;
  const n0 = c.entrances.map((e) => e.n ?? 0);
  for (let i = 0; i < 20 * 60; i++) {
    w.step(0.05);
    w.events.drain();
    t0++;
  }
  const n1 = c.entrances.map((e, i) => (e.n ?? 0) - n0[i]);
  const out = w.s.ants.filter((a) => a.colony === 0 && a.space === SURFACE).length;
  const inn = w.s.ants.filter((a) => a.colony === 0 && a.space === nestSpace(0)).length;
  console.log(species, 'flower', g.flowers[0].length, 'dug', g.flowers[0].every((q) => g.isHexDug(q)), 'top', ed.top.join(','), 'inner', ed.inner.join(','), 'holes', holes, 'gaps', gaps, 'through per hole (60 s)', n1.join('/'), 'out', out, 'in', inn);
}
