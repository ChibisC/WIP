/**
 * Story playtest (claude/story/02-spec §9 phase 6): a story level played by the colony's own AI (builder, foraging,
 * defence) with a little help from a "player", like tools/playtest-missions.ts: for each objective of the current
 * stage it puts marker V where a player would — on rival ants near home to get corpses for genes, on the point to
 * take, down the rival entrance and onto its queen — and calls the groups home when the stage needs defending.
 * Prints each stage's start, the captions' flags, the cues that timed out, the result and the medals.
 *
 *   npx vite-node tools/playtest-story.ts -- [level=garden] [difficulty=normal] [minutes=60] [seed=7] [loadout=]
 *
 * PACE=human (claude/story/06-spec §7): a person's pace — it looks at the map every 15 s instead of every 5, acts on a
 * target only once it has seen it twice in a row, waits for a bigger army (×1.3) before an assault or a boss, and
 * defends at home (no sorties beyond 90 mm) while a stage asks it to hold out. JSON=1 prints one line of results.
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { missionDef, missionOf } from '../src/sim/missions';
import { AS, SURFACE, nestSpace } from '../src/sim/types';
import { assignGroup, placeMarker, removeMarker } from '../src/sim/markers';
import { placeTile, raisesAnts } from '../src/sim/tiles';
import { CASTES } from '../src/sim/species';
import { storyMedals, storySetup } from '../src/sim/story/runner';
import { storyOf } from '../src/sim/story/state';
import { wherePt } from '../src/sim/story/director';
import type { Difficulty, StoryLevelId } from '../src/sim/story/types';
import { actorIndex } from '../src/sim/story/state';
import { members } from '../src/sim/story/director';
import { genomeOf } from '../src/sim/termants';

const args = process.argv.slice(2).filter((a) => a !== '--');
const level = (args[0] ?? 'garden') as StoryLevelId;
const diff = (args[1] ?? 'normal') as Difficulty;
const minutes = Number(args[2] ?? 60);
const seed = Number(args[3] ?? 7);
const loadout = (args[4] ?? '').split(',').filter(Boolean);
const ASSIST = 4;
/** the army a player would wait for before the final assault */
const ARMY0 = Number(process.env.ARMY ?? 45);
/** …and before going out after a boss on the surface */
const BOSS_ARMY0 = Number(process.env.BOSS_ARMY ?? 40);
/** …and how far from the nest it goes after the night's hunters */
const HUMAN = process.env.PACE === 'human';
const NIGHT_R = Number(process.env.NIGHT_R ?? (HUMAN ? 90 : 130));
/** how often the "player" looks (ticks) */
const LOOK = HUMAN ? 300 : 100;
const ARMY_MUL = HUMAN ? 1.3 : 1;

const ev = new EventBus();
// TRAITS=spiderlingVenom: play with the campaign's traits
const setup = storySetup(level, diff, loadout, seed, { traits: (process.env.TRAITS ?? '').split(',').filter(Boolean) });
// ESTAT=x: try another enemy scale on top of the level's and the difficulty's (balancing)
if (process.env.ESTAT && setup.settings) setup.settings.enemyStatMul = (setup.settings.enemyStatMul ?? 1) * Number(process.env.ESTAT);
const w = createWorld(setup, ev);
const ARMY = Math.round(ARMY0 * ARMY_MUL);
const BOSS_ARMY = Math.round(BOSS_ARMY0 * ARMY_MUL);
/** a human acts on a target seen on two looks in a row (the key of the last one seen) */
let seenKey = '';
const c = w.colony(0)!;
c.ai = true;
const def = missionDef(level);
const st = storyOf(w)!;
const log: string[] = [];
let stage = -1;
let assisting = false;
/** the final assault: under way, and the army it set out with (it falls back to regroup below 45 %) */
let assaulting = false;
let assaultStart = 0;
/** after a failed assault, the army to rebuild before going again */
let regroupTo = 0;
/** the assault has gathered at its staging point and is going in */
let pushing = false;
let gatherT = 0;
let deaths = 0;
ev.on('death', (e) => {
  if (e.kind === 'ant' && e.colony === 0) deaths++;
});
const t0 = performance.now();
let end = minutes;
for (let t = 0; t < minutes * 1200; t++) {
  w.step(0.05);
  w.events.drain();
  if (t % LOOK !== 0) continue;
  const m = missionOf(w)!;
  if (m.stage !== stage) {
    stage = m.stage;
    const rv = w.colony(Object.values(st.rivals)[0]);
    log.push(`${(w.s.time / 60).toFixed(1)} min: ${def.stages[stage]?.name ?? 'done'} (${c.living} ants, ${Math.floor(c.food)} food, rival ${rv?.living ?? 0} ants, genes ${JSON.stringify(genomeOf(c).samples)})`);
  }
  if (m.result) {
    end = w.s.time / 60;
    break;
  }
  if (t % 1200 < LOOK) {
    const rv = w.colony(Object.values(st.rivals)[0]);
    log.push(`    ${(w.s.time / 60).toFixed(0)} min: ${c.living} ants (${Object.entries(c.counts).map(([k, v]) => k.split('_')[1] + ' ' + v).join(', ')}) v rival ${rv?.living ?? 0}; goals ${m.goals.map((g) => g.progress).join(' ')}`);
  }
  // the "player": builds what a stage asks for (a tutorial goal the colony AI would get to late)
  const S = def.story!.stages[m.stage];
  if (t % 1200 < LOOK)
    for (const o of S?.objectives ?? []) {
      if (o.type !== 'build' || c.tiles.filter((x) => x.type === o.tile).length >= o.n) continue;
      const g = w.nest(c.id)!;
      const used = new Set(c.tiles.map((x) => x.q));
      for (let q = 0; q < g.cols * g.rows; q++) {
        if (!g.isHexDug(q) || g.isEntrance(q) || used.has(q)) continue;
        const caste = o.tile === 'brood' ? c.castes.find((cs) => CASTES[cs].role === 'worker' && !CASTES[cs].nanitic) : undefined;
        if (placeTile(w, c, o.tile, q, caste)) break;
      }
    }
  let target: { space: number; x: number; y: number } | null = null;
  // the rival to go after: the objective's, else the first still alive (levels with several)
  const killObj = (S?.objectives ?? []).find((o) => o.type === 'killQueen' || o.type === 'killQueens');
  const keys = killObj?.type === 'killQueen' ? [killObj.rival] : killObj?.type === 'killQueens' ? killObj.rivals : Object.keys(st.rivals);
  const rivalId = keys.map((k) => st.rivals[k]).find((id) => w.colony(id)?.alive) ?? Object.values(st.rivals)[0];
  const rival = w.colony(rivalId);
  for (const o of S?.objectives ?? []) {
    if (target) break;
    if ((o.type === 'stealCaste' || o.type === 'killAnts') && c.living >= 12) {
      // the nearest rival ant on the surface
      const e = c.entrances[0];
      let best = Infinity;
      for (const a of w.s.ants) {
        if (a.colony !== rivalId || a.state === AS.Dead || a.space !== SURFACE) continue;
        const d = Math.hypot(a.x - e.sx, a.y - e.sy);
        if (d < best && d < 500) {
          best = d;
          target = { space: SURFACE, x: a.x, y: a.y };
        }
      }
    } else if ((o.type === 'reach' || o.type === 'hold') && c.living >= 20) {
      const p = wherePt(w, o.at);
      target = { space: SURFACE, x: p[0], y: p[1] };
    } else if ((o.type === 'killQueen' || o.type === 'killQueens') && rival && rival.alive) {
      // go when the army is big enough (or, after 20 min of the stage, at the army size alone); fall back below 45 %
      // of the army it set out with and rebuild to at least that size before going again, as a player would
      if (assaulting) {
        assaulting = c.living > assaultStart * 0.45;
        if (!assaulting) (pushing = false), (gatherT = 0);
      } else if (c.living >= Math.max(ARMY, rival.living * 1.5, regroupTo) || (m.t > 1200 && c.living >= Math.max(ARMY, regroupTo))) {
        assaulting = true;
        assaultStart = c.living;
        regroupTo = Math.round(assaultStart * 0.9);
      }
      if (!assaulting) continue;
      const q = w.antById.get(rival.queen);
      const inside = w.s.ants.some((a) => a.colony === c.id && a.space === nestSpace(rival.id) && a.state !== AS.Dead);
      // as a player would: gather the army at a staging point short of the rival's hole first, then go in together
      const hole = rival.entrances[0];
      const home = c.entrances[0];
      const dx = home.sx - hole.sx;
      const dy = home.sy - hole.sy;
      const dl = Math.hypot(dx, dy) || 1;
      const stage = { x: hole.sx + (dx / dl) * 70, y: hole.sy + (dy / dl) * 70 };
      if (!pushing && !inside) {
        let near = 0;
        let out = 0;
        for (const a of w.s.ants)
          if (a.colony === c.id && a.state !== AS.Dead && a.task === 'marker' && a.marker === ASSIST) {
            out++;
            if (a.space === SURFACE && Math.hypot(a.x - stage.x, a.y - stage.y) < 60) near++;
          }
        gatherT++;
        // (checked every 5 s: go once most are there, or after a minute and a half of waiting)
        if ((out && near >= out * 0.6) || gatherT > 18) pushing = true;
      }
      if (q && inside) target = { space: q.space, x: q.x, y: q.y };
      else if (pushing) target = { space: SURFACE, x: hole.sx, y: hole.sy };
      else target = { space: SURFACE, x: stage.x, y: stage.y };
    } else if (o.type === 'killCreature') {
      // a boss: in the nest, everyone onto it at once; on the surface, an army gathered in front of the nest first, then
      // all together onto it (falling back to rebuild below 45 % of the army it set out with), as a player would
      const act = st.actors[actorIndex(st, o.actor)];
      const boss = act ? members(w, act)[0] : undefined;
      if (!boss) continue;
      if (boss.space !== SURFACE) {
        target = { space: boss.space, x: boss.x, y: boss.y };
        continue;
      }
      if (assaulting) {
        assaulting = c.living > assaultStart * 0.45;
        if (!assaulting) (pushing = false), (gatherT = 0);
      } else if (c.living >= Math.max(BOSS_ARMY, regroupTo)) {
        assaulting = true;
        assaultStart = c.living;
        regroupTo = Math.round(assaultStart * 0.9);
      }
      if (!assaulting) continue;
      const home = c.entrances[0];
      const stage = { x: home.sx + (boss.x - home.sx) * 0.25, y: home.sy + (boss.y - home.sy) * 0.25 };
      if (!pushing) {
        let near = 0;
        let out = 0;
        for (const a of w.s.ants)
          if (a.colony === c.id && a.state !== AS.Dead && a.task === 'marker' && a.marker === ASSIST) {
            out++;
            if (a.space === SURFACE && Math.hypot(a.x - stage.x, a.y - stage.y) < 60) near++;
          }
        gatherT++;
        if ((out && near >= out * 0.6) || gatherT > 18) pushing = true;
      }
      target = pushing ? { space: SURFACE, x: boss.x, y: boss.y } : { space: SURFACE, x: stage.x, y: stage.y };
    } else if ((o.type === 'surviveNight' || (o.type === 'surviveTime' && !o.optional)) && c.living >= 12) {
      // the nights: a titan in the nest first; else the nearest hunter at the door (a careful player's defence: no
      // sorties to the ramps in the dark; NIGHT_R=220 for a bolder one)
      const home = c.entrances[0];
      let best = Infinity;
      for (const cr of w.s.creatures) {
        if (cr.dead) continue;
        if (cr.space === nestSpace(c.id)) {
          target = { space: cr.space, x: cr.x, y: cr.y };
          best = -1;
          break;
        }
        if (cr.space !== SURFACE) continue;
        const d = Math.hypot(cr.x - home.sx, cr.y - home.sy);
        if (d < best && d < NIGHT_R) {
          best = d;
          target = { space: SURFACE, x: cr.x, y: cr.y };
        }
      }
    }
  }
  // a person reacts a look late: a new target is acted on the second time it is seen
  if (HUMAN && target) {
    const key = `${target.space}:${Math.round(target.x / 60)}:${Math.round(target.y / 60)}`;
    if (key !== seenKey && !assisting) {
      seenKey = key;
      target = null;
    } else seenKey = key;
  }
  if (target) {
    placeMarker(w, c, ASSIST, target.space, target.x, target.y);
    if (!assisting) for (const g of c.groups) if (raisesAnts(g) && g.type !== 'queen') assignGroup(w, c, g.id, ASSIST);
    assisting = true;
  } else if (assisting) {
    removeMarker(w, c, ASSIST);
    for (const g of c.groups) if (g.marker === ASSIST) assignGroup(w, c, g.id, -1);
    assisting = false;
  }
}
const m = missionOf(w)!;
if (process.env.JSON) console.log(JSON.stringify({ level, diff, seed, pace: HUMAN ? 'human' : 'bot', result: m.result || 'unfinished', min: Number(end.toFixed(1)), stage: m.stage, ants: c.living, died: deaths, events: (st.flags.filter((f) => f.startsWith('ev:')).map((f) => f.slice(3))), wall: Math.round((performance.now() - t0) / 1000) }));
console.log(`\n${def.title} (${diff}, seed ${seed}${loadout.length ? ', loadout ' + loadout.join('+') : ''}): ${m.result || 'unfinished'} at ${end.toFixed(1)} min — ${c.living} ants, ${deaths} died (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
for (const l of log) console.log('  ' + l);
console.log('  flags: ' + st.flags.join(', '));
if (st.log.length) console.log('  director: ' + st.log.join('; '));
if (!m.result) console.log(`  stuck at: ${m.goals.map((g) => `${g.text} ${g.progress}`).join('; ')}`);
else console.log('  medals: ' + JSON.stringify(storyMedals(w)) + ', bonus ' + st.bonus);
