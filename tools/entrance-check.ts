/**
 * Entrances on every playable map (claude/maps/02-spec-nest-entrances §5): for several seeds, a
 * 10-colony match on each map; every colony digs out both its extra-entrance spots; every hole —
 * main and extra — must be on dry, walkable ground, at least a hex from water and walls, and the
 * three holes of a colony apart. Run: npx vite-node tools/entrance-check.ts [-- seeds]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { PLAYABLE_MAPS, MAPS } from '../src/maps';
import { SpeciesId } from '../src/sim/species';
import { HEX_GROUND, HF_SHORE } from '../src/world/surfaceLayout';

const argv = (globalThis as unknown as { process: { argv: string[]; exitCode: number } }).process;
const seeds = Number(argv.argv.slice(2).filter((a) => a !== '--')[0] ?? 10);
const SPECIES: SpeciesId[] = ['lasius', 'formica', 'atta', 'solenopsis', 'eciton', 'hell', 'aurimyrmex', 'termant', 'nasutitermes', 'rhynchotermes'];
let bad = 0;
let holes = 0;
for (const id of [...PLAYABLE_MAPS, ...(['forestFloor', 'riverbank', 'rainforest', 'savanna'] as const).filter((m) => MAPS[m] && !PLAYABLE_MAPS.includes(m))]) {
  const t0 = Date.now();
  let mapBad = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const w = createWorld({ seed, style: 'meadow', width: 100, depth: 100, map: id, colonies: SPECIES.map((species, i) => ({ species, player: i === 0, ai: i > 0 })), food: 1 }, new EventBus());
    for (const c of w.s.colonies) {
      const g = w.nest(c.id)!;
      for (const sp of [...g.spots]) for (const q of sp) g.completeHex(q);
    }
    for (let i = 0; i < 25; i++) w.step(0.05);
    const L = w.terrain.layout!;
    for (const c of w.s.colonies) {
      const why: string[] = [];
      if (c.entrances.length !== 3) why.push(`${c.entrances.length} entrances`);
      c.entrances.forEach((e, i) => {
        holes++;
        const q = L.hex.hexAt(e.sx, e.sy);
        if (!w.terrain.passable(e.sx, e.sy) || w.terrain.isWater(e.sx, e.sy)) why.push(`hole ${i} not dry and walkable`);
        if (q < 0 || L.type[q] !== HEX_GROUND || L.flags[q] & HF_SHORE) why.push(`hole ${i} on a ${q < 0 ? 'missing' : L.type[q]} / shore hex`);
        for (const n of q >= 0 ? L.hex.neighbors(q) : []) if (n >= 0 && L.type[n] !== HEX_GROUND && L.type[n] !== 2) why.push(`hole ${i} next to water or a wall`);
        c.entrances.forEach((o, j) => {
          if (j > i && Math.hypot(o.sx - e.sx, o.sy - e.sy) < 8) why.push(`holes ${i} and ${j} ${Math.hypot(o.sx - e.sx, o.sy - e.sy).toFixed(1)} mm apart`);
        });
      });
      if (why.length) {
        mapBad++;
        if (mapBad < 6) console.log(`  ${id} seed ${seed} colony ${c.id} (${c.species}, site ${c.site}): ${why.join('; ')}`);
      }
    }
  }
  console.log(`${mapBad ? 'FAIL' : 'OK  '}  ${id}: ${seeds} seeds × 10 colonies, ${mapBad} bad colonies, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  bad += mapBad;
}
console.log(`${holes} holes checked, ${bad} colonies with problems`);
if (bad) argv.exitCode = 1;
