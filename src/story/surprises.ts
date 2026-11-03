import type { Action, ActorDef, Difficulty, Scene, SurpriseDef, VisitorDef, Where } from '../sim/story/types';

/**
 * Building blocks for a level's surprise events (claude/story/06-spec §6; the runtime is sim/story/surprises.ts). Each
 * returns a fragment — the actors, the scenes that start on the event's flag `ev:<id>`, the event itself, and a visiting
 * species' colony when a party needs one — and `surprisePool` merges the fragments into the level's fields. Levels stay
 * data: a column is "these ants, from here, along this path, off the map there", a hunter "this creature, from here,
 * hunting round there for so long, then gone".
 */

export interface Fragment {
  actors: Record<string, ActorDef>;
  scenes: Scene[];
  surprises: SurpriseDef[];
  visitors: Record<string, VisitorDef>;
}

/** When and how likely (the event's timing fields). */
export interface When {
  window: [number, number];
  after?: string;
  until?: string;
  chance?: number;
  from?: Difficulty;
  /** narration said as it starts */
  say?: string;
  /** a short note in the log as it starts (`<level>.<key>`) */
  note?: string;
}

function event(id: string, when: When, big: boolean, dur: number, actions: Action[] = []): SurpriseDef {
  const acts = [...actions, ...(when.note ? [{ do: 'note' as const, key: when.note, kind: 'warn' as const }] : [])];
  return { id, window: when.window, ...(when.after ? { after: when.after } : {}), ...(when.until ? { until: when.until } : {}), ...(when.chance !== undefined ? { chance: when.chance } : {}), ...(when.from ? { from: when.from } : {}), big, dur, ...(acts.length ? { actions: acts } : {}), ...(when.say ? { say: when.say } : {}) };
}

/**
 * A marching column of another species out of the blue: it comes on at `enter`, follows `path` fighting whatever it
 * meets (ants and creatures alike), and walks off the map at `exit`. Its size scales with the difficulty (a wave).
 */
export function column(
  id: string,
  o: When & { visitor: string; species: VisitorDef['species']; name: string; ants: Array<[string, number]>; enter: Where; path: string; exit: Where; speed?: number; label: string; dur?: number },
): Fragment {
  return {
    visitors: { [o.visitor]: { species: o.species, name: o.name } },
    actors: { [id]: { ants: o.ants, colony: o.visitor, at: o.enter, spawn: 'action', wave: true, label: o.label } },
    scenes: [{ actor: id, on: `ev:${id}`, cues: [{ mode: 'aggressive' }, { path: o.path, speed: o.speed ?? 0.9, timeout: 400 }, { leave: o.exit, speed: o.speed ?? 0.9 }] }],
    surprises: [event(id, o, true, o.dur ?? 150)],
  };
}

/**
 * A rival colony's party out of the blue (a foraging party contesting a windfall, a scouting band): its ants come out
 * at `enter`, go to `to` fighting what they meet, hold there for `s` seconds, then go home.
 */
export function party(id: string, o: When & { rival: string; ants: Array<[string, number]>; enter: Where; to: Where; s: number; label: string; big?: boolean; dur?: number }): Fragment {
  return {
    visitors: {},
    actors: { [id]: { ants: o.ants, colony: o.rival, at: o.enter, spawn: 'action', wave: true, label: o.label } },
    scenes: [{ actor: id, on: `ev:${id}`, cues: [{ mode: 'aggressive' }, { charge: o.to, timeout: 240 }, { guard: o.to, r: 45, s: o.s }, { leave: 'nest', timeout: 240 }] }],
    surprises: [event(id, o, o.big ?? false, o.dur ?? o.s + 80)],
  };
}

/**
 * A wandering creature (or a few): it comes on at `enter`, walks to `to`, hunts there for `s` seconds (fighting what
 * comes within `r` mm, foragers included), and leaves the map at `exit`.
 */
export function wanderer(id: string, o: When & { creature: string; n?: number; enter: Where; to: Where; r?: number; s: number; exit: Where; label: string; big?: boolean; hp?: number }): Fragment {
  const def: ActorDef = o.n && o.n > 1 ? { creatures: [[o.creature, o.n]], at: o.enter, spawn: 'action', wave: true, label: o.label } : { creature: o.creature, at: o.enter, spawn: 'action', label: o.label };
  if (o.hp) def.hp = o.hp;
  return {
    visitors: {},
    actors: { [id]: def },
    scenes: [{ actor: id, on: `ev:${id}`, cues: [{ walkTo: o.to, speed: 0.8, timeout: 240 }, { guard: o.to, r: o.r ?? 60, s: o.s }, { leave: o.exit, speed: 0.8 }] }],
    surprises: [event(id, o, o.big ?? true, o.s + 90)],
  };
}

/** A windfall: food out of the blue (a fallen fruit, a dead insect, a seed drop, fallen alates after a flight); `model` the food's look (cricket, grasshopper, moth, fly, beetle; apple). */
export function windfall(id: string, o: When & { at: Where; kind: 'insect' | 'berry' | 'seed'; model: string; scale: number; n?: number; spread?: number }): Fragment {
  return {
    visitors: {},
    actors: {},
    scenes: [],
    surprises: [event(id, o, false, 30, [{ do: 'food', at: o.at, kind: o.kind, from: o.model, scale: o.scale, ...(o.n ? { n: o.n } : {}), ...(o.spread ? { spread: o.spread } : {}) }])],
  };
}

/** A rain shower (the storm light; on a map with flood zones the low ground floods for a while). */
export function rain(id: string, o: When & { s: number; flood?: number }): Fragment {
  const acts: Action[] = [{ do: 'weather', rain: o.s }];
  if (o.flood !== undefined) acts.push({ do: 'flood', zone: o.flood });
  return { visitors: {}, actors: {}, scenes: [], surprises: [event(id, o, false, o.s, acts)] };
}

/** A hot spell: ants out on the surface walk slower for `s` seconds. */
export function heat(id: string, o: When & { s: number }): Fragment {
  return { visitors: {}, actors: {}, scenes: [], surprises: [event(id, o, false, o.s, [{ do: 'weather', heat: o.s }])] };
}

/** A rival colony raids early (its war AI marches on the player now). */
export function earlyRaid(id: string, o: When & { rival: string }): Fragment {
  return { visitors: {}, actors: {}, scenes: [], surprises: [event(id, o, true, 120, [{ do: 'raid', rival: o.rival }])] };
}

/** Merge fragments into a level's fields (`actors`, `scenes`, `surprises`, `visitors`), keeping the level's own. */
export function surprisePool(...fr: Fragment[]): Fragment {
  const out: Fragment = { actors: {}, scenes: [], surprises: [], visitors: {} };
  for (const f of fr) {
    Object.assign(out.actors, f.actors);
    out.scenes.push(...f.scenes);
    out.surprises.push(...f.surprises);
    Object.assign(out.visitors, f.visitors);
  }
  return out;
}
