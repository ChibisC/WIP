/**
 * Phase 15 playtest of the two story missions, played by the AI with a little help from a "player": the colony's
 * own AI builds, forages and defends; when the mission names a creature to kill (the hunter, the bosses), every
 * group but the queen's is sent to marker V on it, and at the rival-colony stage (once it has 30 ants) down the
 * rival's entrance and onto its queen — what a player does. Prints when each stage starts and how the
 * mission ends.
 *
 *   npx vite-node tools/playtest-missions.ts -- [minutes=60] [mission=meadow,forest] [species=<mission's own>,plagiaria,…] [seed=41]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { MISSIONS, MissionId, missionOf } from '../src/sim/missions';
import { AS, SURFACE } from '../src/sim/types';
import { assignGroup, placeMarker, removeMarker } from '../src/sim/markers';
import { raisesAnts } from '../src/sim/tiles';
import { SpeciesId } from '../src/sim/species';

const args = process.argv.slice(2).filter((a) => a !== '--');
const minutes = Number(args[0] ?? 60);
const missions = (args[1] ?? 'meadow,forest').split(',') as MissionId[];
const extra = args[2] ? (args[2].split(',') as SpeciesId[]) : [];
const seed = Number(args[3] ?? 41);
const ASSIST = 4;

for (const id of missions) {
  const def = MISSIONS[id];
  for (const sp of [def.species, ...extra.filter((s) => s !== def.species)]) {
    const ev = new EventBus();
    const w = createWorld(
      {
        seed,
        style: def.style,
        width: 640,
        depth: 640,
        food: 1.2,
        colonies: [{ species: sp, player: true, ai: false, team: 0, borrowed: sp === 'plagiaria' ? ['formica_mortar', 'fire_major'] : undefined }, ...(def.rival ? [{ species: def.rival, player: false, ai: true, developed: 6, startWorkers: 14 }] : [])],
        caves: [{ name: 'Root hollow', kind: 'cave', food: 70 }],
        settings: { creatures: 1 },
        mission: id,
      },
      ev,
    );
    const c = w.colony(0)!;
    c.ai = true; // the colony's own AI plays (builder, foraging, defence, raids)
    const log: string[] = [];
    let stage = -1;
    let assisting = false;
    const t0 = performance.now();
    let end = minutes;
    for (let t = 0; t < minutes * 1200; t++) {
      w.step(0.05);
      w.events.drain();
      if (t % 100 !== 0) continue;
      const m = missionOf(w)!;
      if (m.stage !== stage) {
        stage = m.stage;
        log.push(`${(w.s.time / 60).toFixed(1)} min: ${def.stages[stage]?.name ?? 'done'} (${c.living} ants)`);
      }
      // the "player": send the groups at the creature the mission names, or at the rival queen when the stage says so
      const cr = m.target >= 0 ? w.creatureById.get(m.target) : undefined;
      const rival = m.goals.some((g) => /rival/i.test(g.text)) ? w.s.colonies.find((o) => !o.player && o.alive) : undefined;
      const rq = rival ? w.antById.get(rival.queen) : undefined;
      if ((cr && !cr.dead && cr.space === SURFACE) || (rq && c.living >= 30)) {
        if (cr && !cr.dead) placeMarker(w, c, ASSIST, SURFACE, cr.x, cr.y);
        else if (rq) {
          // down the rival's entrance first; once ants are inside, on the queen herself
          const inside = w.s.ants.some((a) => a.colony === c.id && a.space === rq.space && a.state !== AS.Dead);
          if (inside) placeMarker(w, c, ASSIST, rq.space, rq.x, rq.y);
          else placeMarker(w, c, ASSIST, SURFACE, rival!.entrances[0].sx, rival!.entrances[0].sy);
        }
        if (!assisting) for (const g of c.groups) if (raisesAnts(g) && g.type !== 'queen') assignGroup(w, c, g.id, ASSIST);
        assisting = true;
      } else if (assisting) {
        removeMarker(w, c, ASSIST);
        for (const g of c.groups) if (g.marker === ASSIST) assignGroup(w, c, g.id, -1);
        assisting = false;
      }
      if (m.result) {
        end = w.s.time / 60;
        break;
      }
    }
    const m = missionOf(w)!;
    console.log(`\n${def.title} with ${sp} (seed ${seed}): ${m.result || 'unfinished'} at ${end.toFixed(1)} min — ${c.living} ants, queen ${c.alive ? 'alive' : 'dead'} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
    for (const l of log) console.log('  ' + l);
    if (!m.result) console.log(`  stuck at: ${m.goals.map((g) => `${g.text} ${g.progress}`).join('; ')}`);
  }
}
