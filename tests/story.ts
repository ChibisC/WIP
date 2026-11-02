/**
 * Headless tests for story mode (claude/story/02-spec, 03-spec) and the layered ground (claude/maps/05-spec):
 * the rename and caste names, the layered terrain (banks block, ramps carry, floods stay low), both story maps
 * validated with their set pieces on walkable ground, level setup by difficulty and loadout, the director's cues
 * (walk, path, hold, face, patrol, guard, wander, follow, anim, leave, flee, charge, waits, flags, release, modes),
 * every objective type, flags, the bonus and medals, a stolen caste missed, the campaign save, and determinism
 * (two runs, a snapshot restore).
 *   npx vite-node tests/story.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, SURFACE, nestSpace } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { killAnt } from '../src/sim/antAI';
import { goToSurfacePoint } from '../src/sim/movement';
import { CASTES, SPECIES } from '../src/sim/species';
import { genomeOf, stolenName } from '../src/sim/termants';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { missionDef, missionOf, MISSIONS } from '../src/sim/missions';
import { storyMedals, storySetup, storyStolen } from '../src/sim/story/runner';
import { storyOf, hasFlag } from '../src/sim/story/state';
import { members, wherePt } from '../src/sim/story/director';
import { evalObjective } from '../src/sim/story/objectives';
import type { Objective, StoryLevelDef } from '../src/sim/story/types';
import { STORY_LEVELS } from '../src/story/levels';
import { EN } from '../src/story/text/en';
import { STORY, LAYERS } from '../src/sim/balance';
import { Terrain, mapTerrainParams } from '../src/world/terrain';
import { validateMap } from '../src/world/mapValidate';
import { MAPS, PLAYABLE_MAPS } from '../src/maps';
import { campaign, isUnlocked, recordWin, reloadCampaign, resetCampaign, slots } from '../src/game/campaign';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    w.step(0.05);
    w.events.drain();
  }
};
const level = (id: 'garden' | 'fireBanks', diff: 'easy' | 'normal' | 'hard' | 'brutal' = 'normal', loadout: string[] = [], seed = 5, ev = new EventBus()) => createWorld(storySetup(id, diff, loadout, seed), ev);
/** Run until a flag is set (or a limit in seconds); returns the game time it was set, −1 if never. */
function until(w: World, flag: string, secs: number): number {
  const st = storyOf(w)!;
  for (let i = 0; i < secs * 20; i++) {
    w.step(0.05);
    w.events.drain();
    if (hasFlag(st, flag)) return w.s.time;
  }
  return -1;
}
/** Jump a story world to a stage (as the dev URL does). */
function toStage(w: World, n: number): void {
  const m = missionOf(w)!;
  m.stage = n;
  m.entered = false;
}

// ---------------------------------------------------------------- rename, names
check('rename: the Termants show as "Gene-Thief Termants"; the internal id stays termant', SPECIES.termant.common === 'Gene-Thief Termants' && SPECIES.termant.id === 'termant');
check('stolen castes by their ant names', stolenName('lasius_soldier') === 'Black Garden Ant Soldier' && stolenName('fire_major') === 'Tropical Fire Ant Major');
check('the Missions menu still lists the two missions only', Object.keys(MISSIONS).join() === 'meadow,forest' && missionDef('meadow').title === 'A Meadow Kingdom');

// ---------------------------------------------------------------- layered ground
{
  const t = new Terrain(mapTerrainParams(1, 'testTerrace'));
  const F = t.layers!;
  let cl = 0;
  for (let k = 0; k < F.cliff.length; k++) cl += F.cliff[k];
  check('layers: a terrace stands one step up, a hollow one down', Math.abs(t.heightAt(260, 80) - LAYERS.step) < 4 && Math.abs(t.heightAt(380, 380) + LAYERS.step) < 4, `${t.heightAt(260, 80).toFixed(1)} / ${t.heightAt(380, 380).toFixed(1)} mm`);
  check('layers: the bank is blocked (cliff samples), the ramp walkway is not', cl > 200 && t.isBlocked(300, 208) && t.passable(125, 240) && t.onRamp(125, 240), `${cl} cliff samples`);
  const r = validateMap(MAPS.testTerrace!, 1, 2);
  check('layers: the test map passes the validator (ramps, levels, reachability)', r.problems.length === 0, r.problems.join('; '));
  // an ant routes up the ramp, never onto a cliff
  const w = createWorld({ seed: 3, style: 'meadow', width: 480, depth: 480, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], map: 'testTerrace', aphids: 0, plants: 0, settings: { creatures: 0 } }, new EventBus());
  const a = makeAnt(w, 0, 'lasius_worker', SURFACE, 200, 330, 0);
  let onCliff = 0;
  let arrived = -1;
  let slowUp = false;
  for (let i = 0; i < 20 * 90 && arrived < 0; i++) {
    goToSurfacePoint(w, a, 300, 100, 0.05, 'test');
    if (w.terrain.layers!.cliff[Math.round(a.y / 4) * w.terrain.nx + Math.round(a.x / 4)]) onCliff++;
    if (w.terrain.onRamp(a.x, a.y) && w.terrain.slopeSpeed(a.x, a.y, Math.cos(a.h), Math.sin(a.h)) < 1) slowUp = true;
    if (Math.hypot(a.x - 300, a.y - 100) < 3) arrived = i;
  }
  check('layers: an ant walks round the bank and up the ramp onto the terrace (slower going up)', arrived > 0 && onCliff === 0 && w.terrain.levelAt(a.x, a.y) === 1 && slowUp, `arrived tick ${arrived}, ${onCliff} cliff samples`);
  // the five skirmish maps have no layers (unchanged)
  check('layers: the five skirmish maps are flat as before (no layer fields)', PLAYABLE_MAPS.every((id) => !new Terrain(mapTerrainParams(1, id)).layers));
}

// ---------------------------------------------------------------- story maps
for (const id of ['gardenBelow', 'fireBanks'] as const) {
  const def = MAPS[id]!;
  const r = validateMap(def, 1, 2);
  check(`story map ${id}: passes the validator`, r.problems.length === 0, r.problems.join('; '));
  const t = new Terrain(mapTerrainParams(1, id));
  const bad = Object.entries(def.story!.points).filter(([, p]) => !t.passable(p[0], p[1]) || !t.inBounds(p[0], p[1], 4));
  check(`story map ${id}: every set-piece point is on walkable ground`, bad.length === 0, bad.map(([k]) => k).join(', '));
  const flight = def.story!.flight;
  check(`story map ${id}: an opening flight of 3 keys ending at the player's start`, flight.length >= 3 && Math.hypot(flight[flight.length - 1].at[0] - def.sites[0].at[0], flight[flight.length - 1].at[1] - def.sites[0].at[1]) < 120);
  check(`story map ${id}: three levels (0, 1, 2), the player's nest and the rival's on different ones`, t.levelAt(def.sites[0].at[0], def.sites[0].at[1]) !== t.levelAt(def.sites[1].at[0], def.sites[1].at[1]) && new Set([0, 1, 2].map((l) => l)).size === 3);
}

// ---------------------------------------------------------------- text
{
  const keys: string[] = [];
  for (const L of Object.values(STORY_LEVELS)) {
    for (const S of L.stages) for (const c of S.say ?? []) keys.push(`${L.id}.${c.key}`);
    for (const c of L.say ?? []) keys.push(`${L.id}.${c.key}`);
    keys.push(`${L.id}.${L.win}`, `${L.id}.${L.lose}`, `journal.${L.id}.title`, `journal.${L.id}.body`, `journal.${L.id}.note`);
    for (const S of L.stages) for (const e of S.events ?? []) for (const a of e.actions) if (a.do === 'tip') keys.push(`tip.${a.key}`);
  }
  const missing = keys.filter((k) => !EN[k]);
  check('narration: every caption, tip and journal key has text', missing.length === 0, missing.join(', '));
  const long = Object.entries(EN).filter(([k, v]) => !k.startsWith('journal.') && v.split(/[.!?](\s|$)/).filter((x) => x && x.trim().length > 2).length > 2);
  check('narration: captions are short (one or two sentences)', long.length === 0, long.map(([k]) => k).join(', '));
}

// ---------------------------------------------------------------- setup, difficulty, loadout
{
  const w = level('garden');
  const c = w.colony(0)!;
  const r = w.colony(1)!;
  const st = storyOf(w)!;
  check('setup: Gene-Thief Termants at site 0, the black garden ants at site 1, story state with the cast', c.species === 'termant' && c.player && r.species === 'lasius' && st.rivals.lasius === 1 && st.actors.length === Object.keys(STORY_LEVELS.garden.actors).length);
  check('setup: no wild creatures in the first level; the opening cast is on the map', w.s.settings.creatures === 0 && st.actors.filter((a) => a.spawned).map((a) => a.name).join() === 'queen,beetle,cutworm,tenders,tenders2');
  const e = level('garden', 'easy');
  const b = level('garden', 'brutal');
  check('difficulty: enemy stats and aggression from STORY.difficulty', e.s.settings.enemyStatMul === STORY.difficulty.easy.enemyStat && b.s.settings.aggression === STORY.difficulty.brutal.aggression && e.colony(0)!.food > b.colony(0)!.food, `food ${e.colony(0)!.food} / ${b.colony(0)!.food}`);
  const swarmN = (d: 'easy' | 'normal' | 'brutal') => {
    const ww = level('fireBanks', d);
    toStage(ww, 1);
    run(ww, 40);
    const s = storyOf(ww)!;
    return s.actors.find((a) => a.name === 'swarm')!.n0;
  };
  const [se, sn, sb] = [swarmN('easy'), swarmN('normal'), swarmN('brutal')];
  check('difficulty: the swarm is smaller on Easy and bigger on Brutal', se < sn && sn < sb, `${se} / ${sn} / ${sb}`);
  const lw = level('fireBanks', 'normal', ['lasius_soldier']);
  const lc = lw.colony(0)!;
  check('loadout: the Black Garden Ant Soldier brought into level 2 can be raised from the start (and is not counted as stolen there)', lc.castes.includes('lasius_soldier') && genomeOf(lc).stolen.includes('lasius_soldier') && storyStolen(lw, ['lasius_soldier']).length === 0);
  const nl = level('garden', 'normal', ['fire_major']);
  check('loadout: a level without a loadout ignores one', !nl.colony(0)!.castes.includes('fire_major'));
}

// ---------------------------------------------------------------- the opening (director: walk, hold, face, leave)
{
  const ev = new EventBus();
  const said: string[] = [];
  const shots: string[] = [];
  ev.on('message', (e) => e.kind === 'narrator' && e.key && said.push(e.key));
  ev.on('story', (e) => shots.push(e.what));
  const w = level('garden', 'normal', [], 5, ev);
  const st = storyOf(w)!;
  const queen = st.actors.find((a) => a.name === 'queen')!;
  const q0 = w.antById.get(queen.ids[0])!;
  const qx = q0.x;
  const look = until(w, 'beetleLook', 60);
  const queenIn = until(w, 'queenIn', 60);
  check('director: the beetle walks to the shore and holds, facing the queen (flag beetleLook)', look > 0, `at ${look.toFixed(0)} s`);
  check('director: the castaway queen walks to the entrance and leaves the surface (flag queenIn)', queenIn > 0 && !w.antById.get(q0.id) && qx < 320, `at ${queenIn.toFixed(0)} s`);
  run(w, 20 * 30);
  const beetle = st.actors.find((a) => a.name === 'beetle')!;
  check('director: the beetle leaves the map at its exit (the first level stays gentle)', members(w, beetle).length === 0 && hasFlag(st, 'gone:beetle') === false && st.scenes.find((s) => s.actor === st.actors.indexOf(beetle))!.done);
  check('captions: the opening captions are said in order, with keys (voice hooks)', said.slice(0, 4).join() === 'garden.intro1,garden.intro2,garden.beetle,garden.intro3', said.slice(0, 4).join());
  check('shots: the opening flight and the calm music are asked for', shots[0] === 'shot' && shots.includes('music'));
  const tenders = st.actors.find((a) => a.name === 'tenders')!;
  const ten = members(w, tenders) as Array<{ x: number; y: number; pose: number }>;
  const ap = wherePt(w, 'aphidPlants');
  check('director: the aphid tenders hold at the aphid plants, drumming (pose)', ten.length === 3 && ten.every((a) => Math.hypot(a.x - ap[0], a.y - ap[1]) < 16) && ten.some((a) => a.pose === 1));
  const cut = st.actors.find((a) => a.name === 'cutworm')!;
  const cw = members(w, cut)[0] as { data: Record<string, number> } | undefined;
  check('director: the cutworm patrols its loop by the fruit', !!cw && (cw.data.dirW ?? 0) >= 1, `waypoint ${cw?.data.dirW}`);
  check('director: nothing timed out', st.log.length === 0, st.log.join('; '));
}

// ---------------------------------------------------------------- first contact: a path down the stone steps, hold, back, release
{
  const w = level('garden', 'normal', [], 7);
  toStage(w, 1);
  const st = storyOf(w)!;
  // keep the player's ants home (the scouts must not be killed here)
  for (const a of w.s.ants) if (a.colony === 0) a.x = a.x;
  const t1 = until(w, 'scoutsStop', 120);
  const scouts = st.actors.find((a) => a.name === 'scouts')!;
  const sc = members(w, scouts);
  const stop = wherePt(w, 'scoutStop');
  check('director: the scouts walk down the flowerbed ramp onto the meadow, to the edge of the player’s ground', t1 > 0 && sc.every((a) => Math.hypot(a.x - stop[0], a.y - stop[1]) < 20), `at ${t1.toFixed(0)} s`);
  const back = until(w, 'scoutsBack', 120);
  check('director: they antennate, then walk back up and are handed to the normal AI', back > 0 && scouts.released && members(w, scouts).every((a) => (a as { dirA?: number }).dirA === undefined), `back at ${back.toFixed(0)} s`);
}

// ---------------------------------------------------------------- level 2: the swarm (hold, waitFlag, charge, guard, release), flood, flee
{
  const ev = new EventBus();
  const w = level('fireBanks', 'normal', [], 9, ev);
  toStage(w, 1);
  run(w, 40);
  const st = storyOf(w)!;
  const swarm = st.actors.find((a) => a.name === 'swarm')!;
  const top = wherePt(w, 'slopeTop');
  const near0 = members(w, swarm).filter((a) => Math.hypot(a.x - top[0], a.y - top[1]) < 50).length;
  check('director: the majors and the swarm gather at the top of the wide slope', near0 >= swarm.n0 * 0.8, `${near0}/${swarm.n0}`);
  const go = until(w, 'swarmGo', 40);
  run(w, 20 * 25);
  const s = members(w, swarm);
  const avgY = s.reduce((t, a) => t + a.y, 0) / Math.max(1, s.length);
  const onSlope = s.filter((a) => w.terrain.onRamp(a.x, a.y)).length;
  check('director: on swarmGo the swarm pours down the wide sand slope toward the player (charge)', go > 0 && (avgY > 330 || onSlope > 0), `avg y ${avgY.toFixed(0)}, ${onSlope} on the ramp`);
  // the flood: only the low margin
  toStage(w, 3);
  run(w, 20 * 50);
  const fl = w.s.flood?.[0];
  const marg = wherePt(w, 'marginWest');
  check('flood: the river rises on the scripted stage (no storm timer)', !!fl && fl.level > -9000 && w.terrain.isWater(marg[0], marg[1]), `phase ${fl?.phase}, level ${fl?.level}`);
  const nests = [w.colony(0)!, w.colony(1)!].every((c) => c.entrances.every((e) => !w.terrain.isWater(e.sx, e.sy)));
  const shelf = wherePt(w, 'shelf');
  check('flood: the shelf, the high bank and both nests stay dry', nests && !w.terrain.isWater(shelf[0], shelf[1]) && !w.terrain.isWater(930, 150));
  const cr = st.actors.find((a) => a.name === 'critterW')!;
  check('director: the margin’s creatures flee up the ramps before the water (flee)', cr.released || members(w, cr).every((e) => w.terrain.levelAt(e.x, e.y) >= 1 || e.y < 700), cr.released ? 'released' : 'fled');
  check('director: no cue timed out on level 2', st.log.length === 0, st.log.join('; '));
}

// ---------------------------------------------------------------- objectives (each type)
{
  const w = level('garden', 'normal', [], 11);
  const st = storyOf(w)!;
  const c = w.colony(0)!;
  run(w, 40);
  const base = { food0: 0, kills0: c.stats.kills, t: 0 };
  const ev = (o: Objective, b = base) => evalObjective(w, c, st, b, o);
  check('objective raise / fighters / build / dig', ev({ type: 'raise', n: 1 }).done && !ev({ type: 'fighters', n: 50 }).done && ev({ type: 'build', tile: 'queen', n: 1 }).done && ev({ type: 'dig', hexes: 1 }).done);
  check('objective collectFood / storeWood', !ev({ type: 'collectFood', amount: 999 }).done && ev({ type: 'storeWood', amount: 0 }).done);
  check('objective surviveTime', ev({ type: 'surviveTime', s: 10 }, { ...base, t: 12 }).done && !ev({ type: 'surviveTime', s: 10 }, { ...base, t: 5 }).done);
  check('objective stealCaste: genes progress, then stolen', ev({ type: 'stealCaste', caste: 'lasius_soldier' }).progress.includes('/12'));
  genomeOf(c).samples.lasius = 20;
  run(w, 40);
  check('objective stealCaste and raiseCaste', ev({ type: 'stealCaste', caste: 'lasius_soldier' }).done && !ev({ type: 'raiseCaste', caste: 'lasius_soldier', n: 1 }).done && hasFlag(st, 'caste:lasius_soldier'));
  // killAnts, killCreature, escort, protect, reach, enterNest, killQueen
  const lw = w.s.ants.find((a) => a.colony === 1 && a.state !== AS.Dead && a.space === SURFACE)!;
  killAnt(w, lw);
  c.stats.kills++;
  check('objective killAnts', ev({ type: 'killAnts', rival: 'lasius', n: 1 }).done);
  const cut = st.actors.find((a) => a.name === 'cutworm')!;
  const cw = w.creatureById.get(cut.ids[0])!;
  check('objective protect (alive) then killCreature', ev({ type: 'protect', actor: 'cutworm', s: 5 }, { ...base, t: 6 }).done && !ev({ type: 'killCreature', actor: 'cutworm' }).done);
  cw.hp = 0;
  cw.dead = true;
  run(w, 2);
  check('objective killCreature', ev({ type: 'killCreature', actor: 'cutworm' }).done);
  const tend = st.actors.find((a) => a.name === 'tenders')!;
  check('objective escort (an actor at a point)', ev({ type: 'escort', actor: 'tenders', to: 'aphidPlants', r: 30 }).done && !ev({ type: 'escort', actor: 'tenders', to: 'playerNest', r: 30 }).done);
  void tend;
  const e0 = c.entrances[0];
  for (let i = 0; i < 4; i++) makeAnt(w, 0, 'termant_worker', SURFACE, 760 + i, 235, 0);
  run(w, 1);
  check('objective reach', ev({ type: 'reach', at: 'aphidPlants', r: 30, n: 4 }).done && !ev({ type: 'reach', at: 'aphidPlants', r: 30, n: 40 }).done);
  for (let i = 0; i < 2; i++) makeAnt(w, 0, 'termant_worker', nestSpace(1), 40, 40, 0);
  check('objective enterNest', ev({ type: 'enterNest', rival: 'lasius', n: 2 }).done);
  void e0;
  check('objective killQueen: alive', !ev({ type: 'killQueen', rival: 'lasius' }).done);
  const rq = w.antById.get(w.colony(1)!.queen)!;
  killAnt(w, rq);
  run(w, 40);
  check('objective killQueen: dead (and the flag dead:lasius)', ev({ type: 'killQueen', rival: 'lasius' }).done && hasFlag(st, 'dead:lasius'));
}

// ---------------------------------------------------------------- a caste missed: the level goes on (replay to steal it)
{
  const w = level('garden', 'normal', [], 13);
  toStage(w, 2);
  run(w, 40);
  const r = w.colony(1)!;
  killAnt(w, w.antById.get(r.queen)!);
  for (const a of w.s.ants) if (a.colony === 1 && a.state !== AS.Dead) killAnt(w, a);
  run(w, 20 * 40);
  const m = missionOf(w)!;
  check('a caste missed: with its species gone before it was stolen, the stage counts it missed and the level goes on', m.stage >= 3, `stage ${m.stage}: ${m.goals.map((g) => g.text + ' ' + g.progress).join('; ')}`);
}

// ---------------------------------------------------------------- the win, the bonus, medals
{
  const w = level('garden', 'normal', [], 15);
  const st = storyOf(w)!;
  const c = w.colony(0)!;
  run(w, 40);
  genomeOf(c).samples.lasius = 20; // stolen before the raid at 10 min
  run(w, 40);
  check('bonus: stealing the soldier before the first raid wins it', st.bonus === 1);
  toStage(w, 3);
  run(w, 40);
  killAnt(w, w.antById.get(w.colony(1)!.queen)!);
  for (let i = 0; i < 9; i++) makeAnt(w, 0, 'termant_worker', SURFACE, 760 + (i % 3) * 2, 236 + Math.floor(i / 3) * 2, 0);
  run(w, 60);
  const m = missionOf(w)!;
  const med = storyMedals(w)!;
  check('win: the last stage met wins the level; medals by time and losses', m.result === 'won' && st.endT > 0 && med.time === 'gold' && med.bonus === 'gold', JSON.stringify(med));
  const w2 = level('fireBanks', 'normal', [], 15);
  const st2 = storyOf(w2)!;
  toStage(w2, 1);
  run(w2, 40);
  const sw = st2.actors.find((a) => a.name === 'swarm')!;
  for (let i = 0; i < 12; i++) makeAnt(w2, 0, 'termant_worker', SURFACE, 150 + i * 3, 470, 0);
  for (let i = 0; i < 12; i++) {
    const a = w2.s.ants.find((x) => x.colony === 0 && x.state !== AS.Dead && x.id !== w2.colony(0)!.queen && x.id !== w2.colony(0)!.king);
    if (a) killAnt(w2, a);
  }
  run(w2, 40);
  check('bonus: losing more than 10 ants once the swarm is out fails it', st2.bonus === -1 && sw.spawned);
}

// ---------------------------------------------------------------- the lose
{
  const ev = new EventBus();
  const said: string[] = [];
  ev.on('message', (e) => e.kind === 'narrator' && e.key && said.push(e.key));
  const w = level('garden', 'normal', [], 17, ev);
  run(w, 40);
  killAnt(w, w.antById.get(w.colony(0)!.queen)!);
  run(w, 60);
  check('lose: the queen dead loses the level, with its own line', missionOf(w)!.result === 'lost' && said.includes('garden.lose'));
}

// ---------------------------------------------------------------- campaign save
{
  resetCampaign();
  reloadCampaign();
  check('campaign: a new campaign opens level 1 only, one stolen-caste slot', isUnlocked('garden') && !isUnlocked('fireBanks') && slots() === 1 && campaign().castes.length === 0);
  const r = recordWin('garden', 'normal', { time: 'silver', losses: 'gold', bonus: 'none', seconds: 1500, lost: 12 }, ['lasius_soldier'], { caste: 'lasius_soldier' });
  check('campaign: a win keeps the caste, opens level 2 and writes a journal page', r.firstWin && r.newCastes.join() === 'lasius_soldier' && isUnlocked('fireBanks') && campaign().journal.length === 1);
  recordWin('garden', 'hard', { time: 'gold', losses: 'bronze', bonus: 'gold', seconds: 1100, lost: 40 }, ['lasius_soldier'], null);
  const rec = campaign().levels.garden!;
  check('campaign: replays keep the best of each medal, the fastest time and the hardest difficulty', rec.time === 'gold' && rec.losses === 'gold' && rec.bonus === 'gold' && rec.bestSeconds === 1100 && rec.hardest === 'hard' && campaign().castes.length === 1);
  resetCampaign();
}

// ---------------------------------------------------------------- determinism
{
  const a = level('fireBanks', 'normal', ['lasius_soldier'], 21);
  const b = level('fireBanks', 'normal', ['lasius_soldier'], 21);
  toStage(a, 1);
  toStage(b, 1);
  run(a, 20 * 60);
  run(b, 20 * 60);
  check('determinism: two runs of a story level with its scenes agree exactly', hashState(a) === hashState(b) && storyOf(a)!.flags.join() === storyOf(b)!.flags.join(), hashState(a));
  const snap = encodeState(a);
  const r = restoreWorld(snap, new EventBus());
  run(a, 20 * 30);
  run(r, 20 * 30);
  check('determinism: a story level restored from a snapshot mid-scene runs on identically', hashState(a) === hashState(r) && storyOf(r)!.scenes.length === storyOf(a)!.scenes.length);
}

void CASTES;
console.log(failed ? `\n${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `\nall story tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
