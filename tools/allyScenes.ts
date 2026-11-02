/**
 * Scenes for the ally brain (CHANGE_PLAN §22): tests/aiAllies.ts, tools/ally-probe.ts and the browser clip.
 *
 * `allyInvasion`: on Meadow Pond, two allied AI colonies placed next door by the team placement (A the helper, B the
 * one invaded; or B the player's, `human`), and a rival's colony across the pond. After `settle` s of growth, a band of
 * the rival's soldiers is dropped inside B's nest by its queen (and, with `bothInvaded`, a second band in A's). The rival
 * itself does nothing else (its brains are off) so the help is all there is to watch.
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { Ant, AS, Colony, nestSpace } from '../src/sim/types';
import { World } from '../src/sim/world';
import { makeAnt } from '../src/sim/factory';
import { casteOf } from '../src/sim/species';

export interface AllyScene {
  w: World;
  A: Colony;
  B: Colony;
  R: Colony;
  /** the rival's ants dropped in B's nest (and in A's) */
  raidB: Ant[];
  raidA: Ant[];
}

export function allyInvasion(o: { seed?: number; settle?: number; band?: number; caste?: string; human?: boolean; bothInvaded?: boolean; developed?: number; at?: 'queen' | 'entrance' } = {}): AllyScene {
  const w = createWorld(
    {
      seed: o.seed ?? 5,
      style: 'meadow',
      width: 1600,
      depth: 1600,
      map: 'meadowPond',
      food: 1,
      colonies: [
        { species: 'lasius', player: !!o.human, ai: !o.human, team: 0, developed: o.developed ?? 30, startWorkers: 14, name: 'Ally B' },
        { species: 'lasius', player: !o.human ? true : false, ai: true, team: 0, developed: o.developed ?? 30, startWorkers: 14, name: 'Helper A' },
        { species: 'formica', player: false, ai: false, team: 1, developed: 10, startWorkers: 6, name: 'Rival' },
      ],
      settings: { creatures: 0 },
    },
    new EventBus(),
  );
  // (colony 0 is B, 1 is A: with `human`, B is the player's and A the AI helper; else both are AI, A the "player" slot
  // only for the messages' colony)
  const B = w.s.colonies[0];
  const A = w.s.colonies[1];
  const R = w.s.colonies[2];
  for (let i = 0; i < 20 * (o.settle ?? 20); i++) w.step(0.05);
  const band = (into: Colony, n: number): Ant[] => {
    // by the queen (default), or just inside the nest's entrance
    const q = w.antById.get(into.queen)!;
    const e = w.nest(into.id)!.hexCenter(into.entrances[0].q);
    const at = o.at === 'entrance' ? { x: e.x, y: e.y - 14 } : { x: q.x, y: q.y };
    const out: Ant[] = [];
    for (let i = 0; i < n; i++) {
      const a = makeAnt(w, R.id, o.caste ?? 'formica_soldier', nestSpace(into.id), at.x + ((i % 4) - 1.5) * 3, at.y + 14 + Math.floor(i / 4) * 3, -Math.PI / 2);
      a.task = 'guard';
      a.alarm = 1;
      a.age = 1;
      out.push(a);
    }
    w.reindex();
    return out;
  };
  const raidB = band(B, o.band ?? 14);
  const raidA = o.bothInvaded ? band(A, o.band ?? 14) : [];
  void casteOf;
  void AS;
  return { w, A, B, R, raidB, raidA };
}
