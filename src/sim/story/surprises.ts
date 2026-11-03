import type { World } from '../world';
import { STORY } from '../balance';
import { createColony } from '../colony';
import { DIFFICULTIES, type Action, type StoryLevelDef } from './types';
import { StoryState, hasFlag, setFlag } from './state';

/**
 * Surprise events (claude/story/06-spec §6): a level's pool of things that happen out of the blue — a marching column of
 * another species, a wandering hunter, a windfall of food, a rain shower or a hot spell, a rival's early raid. Each is
 * rolled when the level begins from a hash of the seed and the level (not the simulation's RNG, so the rest of the game
 * is not moved by it): whether it happens (its chance × the difficulty's `events`) and when in its window. Firing one sets
 * the flag `ev:<id>` — the level's scenes that start on it bring the party or the creature (the director plays them) —
 * does its actions and says its caption. Big ones never overlap.
 */

/** A small seeded hash in 0..1 (mulberry32 of the seed, the level and a salt). */
function hash01(seed: number, salt: string): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h + Math.imul(h ^ (h >>> 7), 0x297a2d39);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

/** Roll the level's surprises (initStory): which happen and when, by the seed. */
export function rollSurprises(w: World, st: StoryState, L: StoryLevelDef): void {
  const pool = L.surprises ?? [];
  if (!pool.length) return;
  const D = STORY.difficulty[st.diff];
  const di = DIFFICULTIES.indexOf(st.diff);
  st.surp = [];
  pool.forEach((ev, i) => {
    if (ev.from && di < DIFFICULTIES.indexOf(ev.from)) return;
    const p = Math.min(1, (ev.chance ?? 1) * D.events);
    if (hash01(w.s.seed, `${L.id}:${ev.id}:go`) >= p) return;
    const off = ev.window[0] + hash01(w.s.seed, `${L.id}:${ev.id}:at`) * Math.max(0, ev.window[1] - ev.window[0]);
    st.surp!.push({ i, id: ev.id, off: Math.round(off), at: ev.after ? -1 : Math.round(off), done: 0 });
  });
}

/** Visiting parties' nestless colonies, made the first time the level needs them. */
export function visitorColony(w: World, st: StoryState, L: StoryLevelDef, key: string): number {
  const id = st.visitors?.[key];
  if (id !== undefined) return id;
  const v = L.visitors?.[key];
  if (!v) return -1;
  const c = createColony(w, { species: v.species, player: false, ai: false, name: v.name, nx: 0, ny: 0, visitor: true });
  (st.visitors ??= {})[key] = c.id;
  return c.id;
}

/** Once a second: fire the surprises now due (big ones one at a time). */
export function surprisesSecond(w: World, st: StoryState, L: StoryLevelDef, act: (a: Action) => void, say: (key: string) => void): void {
  if (!st.surp) return;
  const now = w.s.time;
  for (const s of st.surp) {
    if (s.done) continue;
    const ev = L.surprises![s.i];
    if (ev.until && hasFlag(st, ev.until)) {
      s.done = 1;
      continue;
    }
    if (s.at < 0) {
      // its window counts from a flag: anchored when that is set (the flag's own second)
      if (!ev.after || !hasFlag(st, ev.after)) continue;
      s.at = Math.round(now) + s.off;
    }
    if (now < s.at) continue;
    if (ev.big && (st.bigUntil ?? 0) > now) {
      s.at = Math.ceil((st.bigUntil ?? now) + STORY.eventGap);
      continue;
    }
    s.done = 1;
    if (ev.big) st.bigUntil = now + ev.dur;
    setFlag(st, `ev:${ev.id}`);
    for (const a of ev.actions ?? []) act(a);
    if (ev.say) say(ev.say);
  }
}

/** The surprises that fired so far, in order (tests, the dev view). */
export function firedSurprises(st: StoryState, L: StoryLevelDef): string[] {
  return st.flags.filter((f) => f.startsWith('ev:')).map((f) => f.slice(3)).filter((id) => (L.surprises ?? []).some((e) => e.id === id));
}
