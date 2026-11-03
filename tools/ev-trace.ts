/** Dev probe: trace one story actor's members second by second from a game time (claude/story/06-spec §6). */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { storySetup } from '../src/sim/story/runner';
import { storyOf, actorIndex } from '../src/sim/story/state';
import { members } from '../src/sim/story/director';
import { AS } from '../src/sim/types';
import type { Difficulty, StoryLevelId } from '../src/sim/story/types';

const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv.slice(2).filter((a) => a !== '--');
const [id, diff, seedS, actor, fromS, toS] = argv;
const w = createWorld(storySetup(id as StoryLevelId, diff as Difficulty, [], Number(seedS)), new EventBus());
const st = storyOf(w)!;
const from = Number(fromS);
const to = Number(toS);
while (w.s.time < to) {
  w.step(0.05);
  w.events.drain();
  if (w.s.time < from || w.s.tick % 20) continue;
  const ai = actorIndex(st, actor);
  const act = st.actors[ai];
  if (!act?.spawned) continue;
  const sc = act.scene >= 0 ? st.scenes[act.scene] : null;
  const dead = act.ids.map((i) => w.antById.get(i)).filter((a) => a && a.state === AS.Dead).length;
  console.log(`${w.s.time.toFixed(0)} cue ${sc?.cue} done ${sc?.done} alive ${members(w, act).length}/${act.n0} deadObj ${dead} ` + members(w, act).slice(0, 4).map((e) => `${Math.round(e.x)},${Math.round(e.y)} sp${e.space}${'caste' in e ? ` st${(e as { state: number }).state} hp${Math.round((e as { hp: number }).hp)}` : ''}`).join(' | '));
}
console.log(st.log.join('\n'));
