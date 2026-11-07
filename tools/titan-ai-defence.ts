/**
 * Skirmish titan raids on AI colonies (claude/creatures/02-spec-easier-titan-holes.md §4: AI colonies still defend and
 * sometimes drive titans off). A meadow skirmish of AI colonies grown for `minutes`, then each digging titan sent on a
 * raid at the colony from `dist` mm off its hole (the colony is warned 25 s before it gets there): whether it got in (and
 * how long the hole took) or gave up.
 *   npx vite-node tools/titan-ai-defence.ts -- [minutes=10] [seed=4] [dist=400]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { SURFACE } from '../src/sim/types';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { RAID, startTitanRaid } from '../src/sim/creatures/titanDig';
import { CREATURES } from '../src/sim/creatures/kinds';

const args = process.argv.slice(2).filter((a) => a !== '--');
const minutes = Number(args[0] ?? 10);
const seed = Number(args[1] ?? 4);
const dist = Number(args[2] ?? 400);
for (const species of ['lasius', 'formica', 'termant'] as const)
  for (const kind of ['tarantula', 'hogna', 'scolopendra', 'stagBeetle']) {
    const w = createWorld({ seed, map: 'meadowPond', colonies: [{ species, player: false, ai: true }, { species: 'lasius', player: false, ai: true }], settings: { creatures: 0, titanRaids: false } } as never, new EventBus());
    for (let i = 0; i < minutes * 1200; i++) {
      w.step(0.05);
      w.events.drain();
    }
    const c = w.colony(0)!;
    const e = c.entrances[0];
    const a = Math.atan2(e.sy - c.ny, e.sx - c.nx);
    // (from open ground that far out: the first heading round the anthill's axis with a clear, dry straight line to the hole)
    let p = { x: e.sx + Math.cos(a) * 60, y: e.sy + Math.sin(a) * 60 };
    for (let k = 0; k < 12; k++) {
      const h = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
      let ok = true;
      for (let r = 50; r <= dist && ok; r += 8) {
        const x = e.sx + Math.cos(h) * r;
        const y = e.sy + Math.sin(h) * r;
        ok = w.walkable(SURFACE, x, y) && !w.terrain.isWater(x, y);
      }
      if (ok) {
        p = { x: e.sx + Math.cos(h) * dist, y: e.sy + Math.sin(h) * dist };
        break;
      }
    }
    const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
    startTitanRaid(w, cr, 0, 0);
    let dig = 0;
    let out = 'not in after 180 s';
    for (let i = 0; i < 20 * 180; i++) {
      w.step(0.05);
      w.events.drain();
      if ((cr.data.rph ?? 0) === RAID.Dig) dig += 0.05;
      if ((cr.data.rph ?? 0) >= RAID.Inside) {
        out = `in after ${dig.toFixed(1)} s of digging (${Math.round((cr.hp / cr.maxHp) * 100)} %)`;
        break;
      }
      if (cr.dead || (!(cr.data.raid ?? 0) && dig > 0)) {
        out = cr.dead ? `killed ${dig > 0 ? `after ${dig.toFixed(1)} s of digging` : `on its way (${((cr.data.rph ?? 0) === RAID.Approach ? 'approaching' : 'not raiding')})`}` : `driven off after ${dig.toFixed(1)} s of digging (${Math.round((cr.hp / cr.maxHp) * 100)} %)`;
        break;
      }
    }
    console.log(`${species} (${c.living} ants) v ${CREATURES[kind].name}: ${out}`);
  }
