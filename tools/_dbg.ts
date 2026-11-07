import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { storySetup } from '../src/sim/story/runner';
import { storyOf } from '../src/sim/story/state';
import { AS } from '../src/sim/types';
const w = createWorld(storySetup('cartonKingdom', 'normal', [], 7), new EventBus());
const st = storyOf(w)!;
for (let m = 0; m <= 10; m += 2) {
  if (m) for (let i = 0; i < 20 * 120; i++) { w.step(0.05); w.events.drain(); }
  const out = Object.entries(st.rivals).map(([k, id]) => {
    const c = w.colony(id)!;
    const by: Record<string, number> = {};
    for (const a of w.s.ants) if (a.colony === id && a.state !== AS.Dead) by[a.caste] = (by[a.caste] ?? 0) + 1;
    return `${k}: living ${c.living} food ${Math.round(c.food)} tiles ${c.tiles.length} pop ${c.popLimit} ${JSON.stringify(by)}`;
  });
  const p = w.colony(0)!;
  console.log(`${m} min | player ${p.living} | ${out.join(' | ')}`);
}
