/**
 * The stress scenario (performance brief, Part A targets), shared by the
 * headless profiler (tools/stress.ts) and the in-browser stress page
 * (`?stress=1`): 4 colonies × N ants fighting and foraging across the
 * surface, their nests and two caves, plus wild creatures.
 */
import type { EventBus } from '../core/events';
import { createWorld, GameSetup } from '../sim/mapGen';
import { SURFACE, nestSpace } from '../sim/types';
import { makeAnt } from '../sim/factory';
import { placeTile, tileAt } from '../sim/tiles';
import { assignGroup, placeMarker } from '../sim/markers';
import { SPECIES } from '../sim/species';
import { spawnCreature } from '../sim/creatures/creatureAI';
import type { World } from '../sim/world';

export const STRESS_SPECIES = ['lasius', 'formica', 'solenopsis', 'atta'] as const;

/** `species` (four ids) swaps the colonies, e.g. to measure the new species against the default four. */
export function stressSetup(species: readonly string[] = STRESS_SPECIES): GameSetup {
  return {
    seed: 77,
    style: 'meadow',
    width: 900,
    depth: 900,
    colonies: species.map((sp, i) => ({ species: sp as (typeof STRESS_SPECIES)[number], player: i === 0, ai: true, developed: 8, startWorkers: 10, popLimit: 600 })),
    caves: [
      { name: 'Root hollow', kind: 'cave', food: 80 },
      { name: 'Beetle den', kind: 'lair', food: 50 },
    ],
    food: 1.2,
  };
}

/**
 * Fill a world made from `stressSetup()`: per colony a worker army and
 * fighters at a surface marker near the map centre (the armies meet and
 * fight), and workers in the nest; then `creatures` wild creatures.
 * Creature systems must be registered by the caller (they are a separate
 * phase of the game).
 */
export function populateStress(w: World, perColony: number, creatures: number): void {
  const cx = w.terrain.width / 2;
  const cy = w.terrain.depth / 2;
  for (const c of w.s.colonies) {
    const g = w.nest(c.id)!;
    const free: number[] = [];
    for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q) && !g.isEntrance(q) && !tileAt(c, q)) free.push(q);
    const castes = SPECIES[c.species].castes;
    const e = c.entrances[0];
    placeMarker(w, c, 0, SURFACE, cx + (e.sx - cx) * 0.15, cy + (e.sy - cy) * 0.15);
    const makeGroup = (caste: string, n: number, space: number, x: number, y: number, marker: number) => {
      const q = free.shift();
      if (q === undefined) return;
      const t = placeTile(w, c, 'brood', q, caste, true)!;
      t.wait = 1e9;
      for (let i = 0; i < n; i++) {
        const a = makeAnt(w, c.id, caste, space, x + w.rng.range(-15, 15), y + w.rng.range(-15, 15), w.rng.range(0, 6.28));
        a.tile = t.q;
      }
      w.reindex();
      assignGroup(w, c, t.group, marker);
    };
    const p = g.hexCenter(free[0] ?? 0);
    makeGroup(castes[0], Math.round(perColony * 0.45), SURFACE, e.sx, e.sy, 0);
    makeGroup(castes[castes.length - 1], Math.round(perColony * 0.2), SURFACE, e.sx, e.sy, 0);
    makeGroup(castes[0], Math.round(perColony * 0.35), nestSpace(c.id), p.x, p.y, -1);
  }
  const kinds = ['pillbug', 'cutworm', 'groundBeetle', 'wolfSpider', 'lithobius', 'rove', 'mantis', 'antlion'];
  for (let i = 0, tries = 0; i < creatures && tries < creatures * 50; tries++) {
    const x = w.rng.range(40, w.terrain.width - 40);
    const y = w.rng.range(40, w.terrain.depth - 40);
    if (!w.terrain.passable(x, y)) continue;
    spawnCreature(w, kinds[i % kinds.length], SURFACE, x, y);
    i++;
  }
}

export function createStressWorld(events: EventBus, perColony: number, creatures: number, species?: readonly string[]): World {
  const w = createWorld(stressSetup(species), events);
  populateStress(w, perColony, creatures);
  return w;
}
