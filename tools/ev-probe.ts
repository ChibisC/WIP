/** Dev probe: run a story level headless and log the surprise events and their parties (claude/story/06-spec §6). */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { storySetup } from '../src/sim/story/runner';
import { storyOf, actorIndex } from '../src/sim/story/state';
import { members } from '../src/sim/story/director';
import { firedSurprises } from '../src/sim/story/surprises';
import { storyLevel } from '../src/story/levels';
import type { Difficulty, StoryLevelId } from '../src/sim/story/types';

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv.slice(2).filter((a) => a !== '--');
const id = (argv[0] ?? 'garden') as StoryLevelId;
const diff = (argv[1] ?? 'normal') as Difficulty;
const seed = Number(argv[2] ?? 5);
const mins = Number(argv[3] ?? 30);
const w = createWorld(storySetup(id, diff, [], seed), new EventBus());
const st = storyOf(w)!;
const L = storyLevel(id);
console.log('rolled', (st.surp ?? []).map((s) => `${L.surprises![s.i].id}@${s.at < 0 ? `+${s.off}` : s.at}`).join(' '));
let last = '';
const t0 = Date.now();
for (let i = 0; i < mins * 60 * 20; i++) {
  w.step(0.05);
  w.events.drain();
  if (i % 200 === 0) {
    const parts = (L.surprises ?? []).map((ev) => {
      const ai = actorIndex(st, ev.id);
      if (ai < 0 || !st.actors[ai].spawned) return '';
      const m = members(w, st.actors[ai]);
      return `${ev.id}:${m.length}/${st.actors[ai].n0}${m[0] ? `@${Math.round(m[0].x)},${Math.round(m[0].y)}` : ''}`;
    }).filter(Boolean).join(' ');
    const line = `fired=${firedSurprises(st, L).join(',')} ${parts}`;
    if (line !== last) console.log(`${Math.round(w.s.time)}s stage ${(w.s.mode.mission as { stage: number }).stage} ${line}`);
    last = line;
  }
}
console.log('log', st.log.slice(-10).join(' | '));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
