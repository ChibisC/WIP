/**
 * Headless tests for chapter 1 as four levels (claude/story/04-spec-chapter1-four-levels.md): the campaign order and the
 * save rule (progress by level id; old saves keep theirs), both new maps validated, The Long Nights (the day/night clock
 * and its light, the hunters out of their lairs at night and home at dawn, the tarantula digging in on the last night,
 * the win at dawn, the food medal), The Spider Mother (a developed colony, the preparation by difficulty, her health
 * marks and phases — the retreat to her burrow, the spiderlings spilling, digging into the nest — the bonus), the trait
 * Spiderling Venom (story only), the director's loop cue, and determinism.
 *   npx vite-node tests/storyCh1.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, Creature, SURFACE, nestSpace } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { storyMedals, storySetup } from '../src/sim/story/runner';
import { storyOf, hasFlag, actorIndex } from '../src/sim/story/state';
import { members, wherePt } from '../src/sim/story/director';
import { dayNightAt, dayNightFlags, dayNightLabel, nightStart } from '../src/sim/story/dayNight';
import { missionOf } from '../src/sim/missions';
import { STORY_LEVELS } from '../src/story/levels';
import { CHAPTERS, NODES, REGIONS, nodePos } from '../src/story/campaign';
import { nearestRegion } from '../src/story/islandGeo';
import { campaign, isUnlocked, recordWin, reloadCampaign, resetCampaign, saveCampaign } from '../src/game/campaign';
import { STORY } from '../src/sim/balance';
import { MAPS } from '../src/maps';
import { validateMap } from '../src/world/mapValidate';
import { Terrain, mapTerrainParams } from '../src/world/terrain';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { damageCreature } from '../src/sim/combat';
import { RAID, startTitanRaid } from '../src/sim/creatures/titanDig';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { probe } from '../tools/titanProbe';
import { EN } from '../src/story/text/en';
import type { Difficulty, StoryLevelId } from '../src/sim/story/types';

// (a browser's storage for the campaign save, in memory: the save round trip is part of what is tested)
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

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
const level = (id: StoryLevelId, diff: Difficulty = 'normal', seed = 5, more: { traits?: string[]; retry?: boolean } = {}) => createWorld(storySetup(id, diff, [], seed, more), new EventBus());
function until(w: World, flag: string, secs: number): number {
  const st = storyOf(w)!;
  for (let i = 0; i < secs * 20; i++) {
    w.step(0.05);
    w.events.drain();
    if (hasFlag(st, flag)) return w.s.time;
  }
  return -1;
}
/** Jump a level to a stage and a game time (the clock runs on game time; tests skip the days). */
function jump(w: World, stage: number, time: number): void {
  const m = missionOf(w)!;
  m.stage = stage;
  m.entered = false;
  w.s.time = time;
}
const actor = (w: World, name: string) => storyOf(w)!.actors[actorIndex(storyOf(w)!, name)];

// ---------------------------------------------------------------- the campaign: four levels in order
{
  const ids = CHAPTERS[0].levels.join();
  check('campaign: chapter 1 is Garden Below → The Long Nights → Fire on the Banks → The Spider Mother', ids === 'garden,longNights,fireBanks,spiderMother', ids);
  check('campaign: level numbers follow the order', CHAPTERS[0].levels.every((l, i) => STORY_LEVELS[l].number === i + 1));
  const after = Object.fromEntries(NODES.map((n) => [n.level, n.after.join()]));
  check('campaign: each level opens after the one before it', after.garden === '' && after.longNights === 'garden' && after.fireBanks === 'longNights' && after.spiderMother === 'fireBanks');
  check('campaign: the new nodes sit in their regions (the nights in the meadow by the river woods, the spider on the riverbank)', NODES.every((n) => nearestRegion(REGIONS, nodePos(n)[0], nodePos(n)[1]).r.id === n.region) && NODES.find((n) => n.level === 'longNights')!.region === 'meadow' && NODES.find((n) => n.level === 'spiderMother')!.region === 'riverbank');
  const pg = nodePos(NODES[0]);
  const pn = nodePos(NODES[1]);
  const pf = nodePos(NODES[2]);
  check('campaign: The Long Nights sits between the garden and the river on the map', pn[0] > pg[0] && pn[0] < pf[0], `${pg[0].toFixed(2)} < ${pn[0].toFixed(2)} < ${pf[0].toFixed(2)}`);
  check('campaign: Fire on the Banks keeps its gameplay (same stages, reward, map); only its number moved to 3', STORY_LEVELS.fireBanks.number === 3 && STORY_LEVELS.fireBanks.stages.length === 5 && STORY_LEVELS.fireBanks.reward.caste === 'fire_major' && STORY_LEVELS.fireBanks.map === 'fireBanks');
  check('campaign: the chapter’s closing hint moved to the end of The Spider Mother', !!EN['spiderMother.ending'] && !EN['fireBanks.ending']);
  check('campaign: Fire on the Banks opens with a line linking it to the nights before', /nights/.test(EN['fireBanks.intro1']));

  // the save: progress by level id; a new player; an old save that beat Fire on the Banks
  resetCampaign();
  reloadCampaign();
  check('save: a new campaign opens the garden only', isUnlocked('garden') && !isUnlocked('longNights') && !isUnlocked('fireBanks') && !isUnlocked('spiderMother'));
  recordWin('garden', 'normal', { time: 'gold', losses: 'gold', bonus: 'none', seconds: 1500, lost: 12 }, ['lasius_soldier'], null);
  check('save: the garden won opens The Long Nights (not Fire on the Banks)', isUnlocked('longNights') && !isUnlocked('fireBanks'));
  // an old save (two-level chapter 1): garden and Fire on the Banks won, the fire ant major kept
  const old = campaign();
  old.levels.fireBanks = { won: true, plays: 2, time: 'silver', losses: 'gold', bonus: 'gold', bestSeconds: 2100, bestLost: 30, hardest: 'normal' };
  old.castes.push('fire_major');
  delete (old as { traits?: string[] }).traits;
  saveCampaign();
  reloadCampaign();
  const c = campaign();
  check('save: an old save keeps its medals and castes (by level id)', c.levels.fireBanks?.losses === 'gold' && c.castes.includes('fire_major') && c.castes.includes('lasius_soldier'));
  check('save: an old save gains an empty trait list', Array.isArray(c.traits) && c.traits.length === 0);
  check('save: the old save keeps Fire on the Banks open, opens The Long Nights, and offers The Spider Mother at once', isUnlocked('fireBanks') && isUnlocked('longNights') && isUnlocked('spiderMother'));
  const r = recordWin('spiderMother', 'normal', { time: 'gold', losses: 'silver', bonus: 'gold', seconds: 900, lost: 40 }, [], null, 'spiderlingVenom');
  check('save: beating the Spider Mother keeps the trait Spiderling Venom (no extra slot)', r.newTrait && campaign().traits.join() === 'spiderlingVenom' && campaign().bosses === 0);
  resetCampaign();
}

// ---------------------------------------------------------------- the two new maps
for (const [id, levels] of [['stonyHollow', 3], ['spiderTerrace', 2]] as const) {
  const def = MAPS[id]!;
  const r = validateMap(def, 1, 1);
  check(`story map ${id}: passes the validator`, r.problems.length === 0, r.problems.join('; '));
  const t = new Terrain(mapTerrainParams(1, id));
  const bad = Object.entries(def.story!.points).filter(([, p]) => !t.passable(p[0], p[1]) || !t.inBounds(p[0], p[1], 4));
  check(`story map ${id}: every set-piece point is on walkable ground`, bad.length === 0, bad.map(([k]) => k).join(', '));
  const badPath = Object.entries(def.story!.paths).filter(([, P]) => P.some((p) => !t.passable(p[0], p[1])));
  check(`story map ${id}: every story path runs over walkable ground`, badPath.length === 0, badPath.map(([k]) => k).join(', '));
  const fl = def.story!.flight;
  check(`story map ${id}: an opening flight ending at the player's start`, fl.length >= 3 && Math.hypot(fl[fl.length - 1].at[0] - def.sites[0].at[0], fl[fl.length - 1].at[1] - def.sites[0].at[1]) < 120);
  const lv = new Set<number>();
  for (let y = 20; y < def.depth; y += 20) for (let x = 20; x < def.width; x += 20) if (t.passable(x, y)) lv.add(t.levelAt(x, y));
  check(`story map ${id}: ${levels} levels of layered ground`, lv.size === levels, [...lv].join(','));
  check(`story map ${id}: no fallen leaves (user rule)`, !def.walls.some((w) => (w.kind as string) === 'leaf') && !def.walkways.some((k) => k.kind === 'leaf'));
}
{
  const t = new Terrain(mapTerrainParams(1, 'stonyHollow'));
  const P = MAPS.stonyHollow!.story!.points;
  check('stony hollow: the nest on a raised terrace, the hollow below, the lairs at the foot of the banks, the tarantula on its knoll', t.levelAt(P.playerNest[0], P.playerNest[1]) === 1 && t.levelAt(P.hollow[0], P.hollow[1]) === 0 && ['lairNW', 'lairN', 'lairE', 'lairSE'].every((k) => t.levelAt(P[k][0], P[k][1]) === 0) && t.levelAt(P.tarantulaBurrow[0], P.tarantulaBurrow[1]) === 2);
  const t2 = new Terrain(mapTerrainParams(1, 'spiderTerrace'));
  const Q = MAPS.spiderTerrace!.story!.points;
  check('spider terrace: her burrow in the middle of the upper terrace, the nest on the lower one with ramps up', t2.levelAt(Q.burrow[0], Q.burrow[1]) === 1 && t2.levelAt(Q.playerNest[0], Q.playerNest[1]) === 0 && (MAPS.spiderTerrace!.ramps ?? []).length === 3);
}

// ---------------------------------------------------------------- the day/night clock
{
  const D = STORY_LEVELS.longNights.dayNight!;
  const n1 = nightStart(D, 1);
  const n3 = nightStart(D, 3);
  check('clock: three nights; the first day the longest of the days; the last night the longest', D.nights === 3 && D.first > D.day && (D.lastNight ?? D.night) > D.night);
  check('clock: day light at the start, full night inside a night, smooth fades', dayNightAt(D, 10).light === 0 && dayNightAt(D, n1 + 10).light === 1 && dayNightAt(D, n1 - D.fade / 2).light > 0.3 && dayNightAt(D, n1 - D.fade / 2).light < 0.7 && dayNightAt(D, n1 + D.night + D.fade / 2).light < 0.7);
  check('clock: the dusk warning comes 30 s before each night', dayNightFlags(D, n1 - D.dusk).includes('dusk:1') && !dayNightFlags(D, n1 - D.dusk - 1).includes('dusk:1') && !dayNightFlags(D, n1 - 1).includes('night:1'));
  check('clock: dawn after the last (longer) night, then day for good', dayNightFlags(D, n3 + (D.lastNight ?? D.night)).includes('dawn:3') && !dayNightFlags(D, n3 + (D.lastNight ?? D.night) - 1).includes('dawn:3') && dayNightAt(D, n3 + 2000).light === 0);
  check('clock: the HUD says the day and the time to dusk, the night count and the time to dawn', dayNightLabel(D, 30) === 'Day 1 · dusk in 4:30' && dayNightLabel(D, n1 + 60).startsWith('Night 1 of 3 · dawn in 2:00') && dayNightLabel(D, n1 - 10).startsWith('Dusk'));
}

// ---------------------------------------------------------------- The Long Nights
{
  const w = level('longNights');
  const st = storyOf(w)!;
  const c = w.colony(0)!;
  check('long nights: no enemy ant species; five lairs as underground areas (a burrow for the tarantula)', w.s.colonies.length === 1 && w.s.caves.length === 5 && w.s.caves.filter((v) => v.kind === 'lair').length === 5 && w.s.caves.some((v) => v.look === 'burrow'));
  check('long nights: day light at the start, no hunters on the map', w.s.night === 0 && w.s.creatures.filter((cr) => !cr.dead).length === 0);
  const D = STORY_LEVELS.longNights.dayNight!;
  // to the first dusk: the beetle crosses the hollow
  w.s.time = nightStart(D, 1) - D.dusk - 2;
  run(w, 20 * 8);
  check('long nights: at dusk a ground beetle comes out and crosses the hollow (the first sign)', hasFlag(st, 'dusk:1') && hasFlag(st, 'beetleSeen') && members(w, actor(w, 'duskBeetle')).length === 1);
  const t1 = until(w, 'night:1', 60);
  const lairs = ['lairNW', 'lairSE'].map((k) => wherePt(w, k));
  const fromLairs = [...members(w, actor(w, 'night1n')), ...members(w, actor(w, 'night1e'))].every((e) => lairs.some((p) => Math.hypot(e.x - p[0], e.y - p[1]) < 40));
  run(w, 20 * 3);
  check('long nights: night falls (the light) and the first night’s hunters come out of their lairs', t1 > 0 && w.s.night > 0.95 && members(w, actor(w, 'night1n')).length >= 2 && members(w, actor(w, 'night1e')).length >= 2);
  check('long nights: the hunters start at the lair mouths', fromLairs);
  run(w, 20 * 60);
  const top = wherePt(w, 'rampNorthTop');
  const n1 = members(w, actor(w, 'night1n'));
  check('long nights: a pack climbs to the top of its ramp (the terrace)', n1.some((e) => Math.hypot(e.x - top[0], e.y - top[1]) < 110 || w.terrain.levelAt(e.x, e.y) === 1), n1.map((e) => `${e.x.toFixed(0)},${e.y.toFixed(0)}`).join(' '));
  check('long nights: the HUD goal counts down to dawn', (missionOf(w)!.goals[0]?.progress ?? '').startsWith('dawn in'), missionOf(w)!.goals[0]?.progress);
  const d1 = until(w, 'dawn:1', 200);
  run(w, 20 * 70);
  check('long nights: at dawn the stage moves on and the hunters go home (gone from the map)', d1 > 0 && missionOf(w)!.stage === 1 && members(w, actor(w, 'night1n')).length + members(w, actor(w, 'night1e')).length === 0 && w.s.night === 0);
  check('long nights: food comes at dawn (the night’s leftovers)', w.s.food.some((f) => f.space === SURFACE && f.kind === 'insect' && Math.hypot(f.x - 600, f.y - 470) < 40));
  // night 2: the eyes at the lair mouths before the wave
  jump(w, 1, nightStart(D, 2) - D.dusk - 1);
  run(w, 20 * 4);
  const eyes = members(w, actor(w, 'eyes'));
  check('long nights: before night 2 wolf spiders wait at the lair mouths facing the terrace (their eyes)', eyes.length >= 2 && eyes.every((e) => (e as Creature).v === 0 || Math.hypot(e.x - 760, e.y - 236) < 80 || Math.hypot(e.x - 890, e.y - 420) < 80));
  // night 3: the tarantula
  const ww = level('longNights', 'normal', 9);
  const st3 = storyOf(ww)!;
  for (let i = 0; i < 4; i++) makeAnt(ww, 0, 'termant_soldier', SURFACE, 190 + i * 4, 760, 0);
  jump(ww, 2, nightStart(D, 3) - 2);
  const out = until(ww, 'tarantulaOut', 30);
  const tar = members(ww, actor(ww, 'tarantula'))[0] as Creature;
  check('long nights: on the third night the red-knee tarantula leaves its burrow on the knoll', out > 0 && !!tar && ww.terrain.levelAt(tar.x, tar.y) === 2);
  const bossHp = (d: Difficulty) => {
    const x = level('longNights', d, 3);
    jump(x, 2, nightStart(D, 3) + 1);
    run(x, 40);
    const cr = members(x, actor(x, 'tarantula'))[0] as Creature;
    return cr?.maxHp ?? 0;
  };
  check('long nights: the titan’s health scales with the difficulty (STORY.difficulty.*.boss)', bossHp('easy') < bossHp('normal') && bossHp('normal') < bossHp('brutal'));
  const digs = until(ww, 'tarantulaDigs', 150);
  const inside = until(ww, 'tarantulaIn', 120);
  const t2 = members(ww, actor(ww, 'tarantula'))[0] as Creature;
  check('long nights: it walks to the nest and digs one of its holes wider (digInto)', digs > 0 && ww.s.colonies[0].entrances.some((e) => (e.breach ?? 0) > 0), `digs at ${digs.toFixed(0)}`);
  check('long nights: it walks into the nest (the story raid)', inside > 0 && !!t2 && t2.space === nestSpace(0) && (t2.data.rph ?? 0) === RAID.Inside, `in at ${inside.toFixed(0)}`);
  run(ww, 20 * 30);
  check('long nights: a story titan stays in (no flight at low health, no time limit) until dawn', !!t2 && (t2.dead || t2.space === nestSpace(0)));
  if (!t2.dead) {
    t2.hp = t2.maxHp * 0.2;
    run(ww, 20 * 3);
  }
  check('long nights: …even badly hurt', t2.dead || (t2.space === nestSpace(0) && (t2.data.rph ?? 0) === RAID.Inside));
  // dawn: the level is won (queen alive); the titan climbs out and leaves
  const q = ww.antById.get(ww.colony(0)!.queen)!;
  q.hp = q.maxHp;
  t2.hp = Math.max(t2.hp, t2.maxHp * 0.6);
  // (keep the queen out of its reach for the rest of the night: the test is about dawn)
  const qx = q.x;
  ww.s.time = nightStart(D, 3) + (D.lastNight ?? D.night) - 3;
  for (let i = 0; i < 20 * 6; i++) {
    q.hp = q.maxHp;
    ww.step(0.05);
    ww.events.drain();
  }
  void qx;
  const m = missionOf(ww)!;
  check('long nights: dawn after the third night wins the level', m.result === 'won', m.result);
  const med = storyMedals(ww)!;
  check('long nights: the first medal is food stored (a level of fixed length)', med.food !== undefined && med.time !== undefined && STORY_LEVELS.longNights.medals.food !== undefined);
  run(ww, 20 * 40);
  check('long nights: at dawn the tarantula walks back out of the nest', t2.dead || t2.space === SURFACE, `space ${t2.space}`);
  check('long nights: no bonus without the titan killed before dawn', st3.bonus === -1);
  void c;
}

// ---------------------------------------------------------------- The Spider Mother
{
  const w = level('spiderMother');
  const st = storyOf(w)!;
  const c = w.colony(0)!;
  check('spider mother: a developed colony (a preset nest with chambers)', c.tiles.length >= 20 && c.living >= 20, `${c.tiles.length} tiles, ${c.living} ants`);
  check('spider mother: no wild creatures; her burrow is drawn as a burrow', w.s.creatures.filter((cr) => !cr.dead).length === 1 && w.s.caves.length === 1 && w.s.caves[0].look === 'burrow');
  const prep = (d: Difficulty) => {
    const x = level('spiderMother', d);
    run(x, 30);
    return missionOf(x)!.goals[0]?.progress ?? '';
  };
  check('spider mother: the preparation is longer on Easy than on Brutal (5–8 min)', prep('easy').endsWith('8:00') && prep('brutal').endsWith('5:30'), `${prep('easy')} / ${prep('brutal')}`);
  const mom = members(w, actor(w, 'mother'))[0] as Creature;
  const burrow = wherePt(w, 'burrowEdge');
  run(w, 20 * 20);
  check('spider mother: before the hunt she waits at her burrow', Math.hypot(mom.x - burrow[0], mom.y - burrow[1]) < 20);
  // the hunt
  const m = missionOf(w)!;
  m.stage = 1;
  m.entered = false;
  run(w, 20 * 60);
  check('spider mother: the hunt begins with dusk light; she comes down toward the nest', w.s.night > 0.3 && Math.hypot(mom.x - burrow[0], mom.y - burrow[1]) > 100, `night ${w.s.night}, ${Math.hypot(mom.x - burrow[0], mom.y - burrow[1]).toFixed(0)} mm from the burrow`);
  // phase 1: badly hurt, back to the burrow
  damageCreature(w, mom, mom.maxHp * 0.22 + 2, 'pure', null);
  const r80 = until(w, 'hp:mother:80', 3);
  run(w, 20 * 20);
  check('spider mother: hurt below 80 % she goes back to her burrow (passive, resting)', r80 > 0 && Math.hypot(mom.x - burrow[0], mom.y - burrow[1]) < 30 && actor(w, 'mother').mode === 1, `${Math.hypot(mom.x - burrow[0], mom.y - burrow[1]).toFixed(0)} mm`);
  const rested = until(w, 'motherRested', 40);
  check('spider mother: …and comes out again (back on her rounds)', rested > 0 && actor(w, 'mother').mode !== 1);
  // phase 2: spiderlings spill in two groups
  const sp = () => w.s.creatures.filter((cr) => cr.kind === 'spiderling' && !cr.dead).length;
  damageCreature(w, mom, mom.hp - mom.maxHp * 0.58, 'pure', null);
  run(w, 20 * 2);
  const g1 = sp();
  damageCreature(w, mom, mom.hp - mom.maxHp * 0.43, 'pure', null);
  run(w, 20 * 2);
  const g2 = sp();
  check('spider mother: below 60 % her spiderlings spill off her back, a second group halfway through the phase', hasFlag(st, 'hp:mother:60') && g1 >= 8 && g2 >= g1 + 5, `${g1} then ${g2}`);
  // phase 3: she digs into the nest
  damageCreature(w, mom, mom.hp - mom.maxHp * 0.28, 'pure', null);
  const dig = until(w, 'motherIn', 150);
  check('spider mother: below 30 % she digs a hole wider and walks into the nest', dig > 0 && mom.space === nestSpace(0), `in at ${dig.toFixed(0)}, space ${mom.space}`);
  check('spider mother: once in, her health floor lifts (she can be killed inside)', mom.data.hpFloor === undefined);
  damageCreature(w, mom, mom.hp + 10, 'pure', null);
  run(w, 20 * 2);
  check('spider mother: killing her within a minute of her breaking in wins the level and the bonus', missionOf(w)!.result === 'won' && st.bonus === 1, `bonus ${st.bonus}`);
  // before she is in she can't be killed (claude/story/05-spec §2: her health stops at the floor)
  const w2 = level('spiderMother', 'normal', 6);
  const m2 = missionOf(w2)!;
  m2.stage = 1;
  m2.entered = false;
  run(w2, 40);
  const mom2 = members(w2, actor(w2, 'mother'))[0] as Creature;
  damageCreature(w2, mom2, mom2.hp + 10, 'pure', null);
  run(w2, 40);
  check('spider mother: before she has dug in she can’t be killed — her health stops at STORY.titanRaid.hpFloor (the boss bar shows a lock)', !mom2.dead && Math.abs(mom2.hp - mom2.maxHp * STORY.titanRaid.hpFloor) < 1 && (mom2.data.hpFloor ?? 0) > 0 && !missionOf(w2)!.result, `${(mom2.hp / mom2.maxHp * 100).toFixed(0)} %`);
  // …so the fury starts, she rushes in, and the bonus clock runs: a minute, then it is lost
  const inAt = until(w2, 'motherIn', 90);
  check('spider mother: at her floor (below 30 %) she rushes to the nest and digs in', inAt > 0 && mom2.space === nestSpace(0), `in at ${inAt.toFixed(0)}`);
  const sm = STORY_LEVELS.spiderMother.medals.bonus;
  check('spider mother: the bonus is now killing her within a minute of her breaking in (her old one, before she digs in, can’t happen)', sm.type === 'killWithin' && sm.s === 60 && /minute/.test(sm.text));
  for (let i = 0; i < 20 * 64 && !mom2.dead; i++) {
    mom2.hp = Math.max(mom2.hp, mom2.maxHp * 0.5);
    w2.step(0.05);
    w2.events.drain();
  }
  check('spider mother: alive a minute after breaking in: the bonus is lost', storyOf(w2)!.bonus === -1, `bonus ${storyOf(w2)!.bonus}`);
  check('spider mother: the reward is the trait Spiderling Venom (built, story only)', STORY_LEVELS.spiderMother.reward.trait === 'spiderlingVenom' && !!STORY.traits.spiderlingVenom.built);
  // a restart skips the opening flight
  const shots = (retry: boolean) => {
    const ev = new EventBus();
    const x = createWorld(storySetup('spiderMother', 'normal', [], 5, { retry }), ev);
    let n = 0;
    ev.on('story', (e) => {
      if (e.what === 'shot' && e.shot === 'flight') n++;
    });
    run(x, 60);
    return n;
  };
  check('spider mother: a restart skips the opening flight (the boss rule)', shots(false) === 1 && shots(true) === 0);
}

// ---------------------------------------------------------------- the titans always get in (claude/story/05-spec-story-titans-get-inside.md §4)
{
  // both levels, every difficulty: no defence; the whole army at the hole; ants on it (riders); the titan down in its
  // burrow when its dig cue fires — it gets inside every time, digging no longer than the difficulty's cap, and the cue
  // is not done before it is in
  const rows: string[] = [];
  let bad = 0;
  let capOk = true;
  for (const L of ['longNights', 'spiderMother'] as const)
    for (const d of ['easy', 'normal', 'hard', 'brutal'] as const)
      for (const setup of ['none', 'hole', 'riders', 'burrow'] as const) {
        const r = probe(L, setup, d, 5, 40, 240, false, 0);
        const ok = r.inside >= 0 && !r.doneEarly && !r.diedOutside;
        if (!ok) bad++;
        if (r.digSec > STORY.titanRaid.digCap[d] + 0.1) capOk = false;
        rows.push(`${L}/${d}/${setup}: ${ok ? `in at ${r.inside.toFixed(0)} s (dug ${r.digSec.toFixed(1)} s, ${(r.hpIn * 100).toFixed(0)} %)` : `NOT IN (${r.notes.slice(-2).join('; ')})`}`);
      }
  check('titans get in: both levels × four difficulties × no defence / army at the hole / riders / in its burrow — inside every time, the cue never done before', bad === 0, bad ? rows.filter((x) => /NOT IN/.test(x)).join(' | ') : `${rows.length} runs`);
  check('titans get in: never more than the difficulty’s dig cap (STORY.titanRaid.digCap)', capOk, rows.filter((x) => /hole/.test(x)).join(' | '));
  check('titans get in: the caps rise with the difficulty, 12–20 s', STORY.titanRaid.digCap.easy === 12 && STORY.titanRaid.digCap.brutal === 20 && STORY.titanRaid.digCap.normal < STORY.titanRaid.digCap.hard);
  console.log('      ' + rows.join('\n      '));
}
{
  // the dig cue owns the titan: a story raid can't be stalled (no knock-backs, a pace floor) and never gives up
  const r = probe('longNights', 'hole', 'normal', 5, 60, 240, false, 0);
  check('titans get in: with 60 ants at the hole the tarantula still gets in (before: it died at the hole after 9 s of digging)', r.inside > 0 && !r.diedOutside, `in at ${r.inside.toFixed(0)} s with ${(r.hpIn * 100).toFixed(0)} %`);
  // skirmish raids are unchanged by this fix: no floor, they give up
  const sk = createWorld({ seed: 3, style: 'meadow', width: 640, depth: 640, colonies: [{ species: 'termant', player: true, ai: false }], settings: { creatures: 0, titanRaids: false } } as never, new EventBus());
  const c0 = sk.colony(0)!;
  const e0 = c0.entrances[0];
  const t = spawnCreature(sk, 'tarantula', SURFACE, e0.sx + 30, e0.sy);
  startTitanRaid(sk, t, 0);
  run(sk, 20 * 3);
  damageCreature(sk, t, t.hp + 10, 'pure', null);
  check('titans get in: a skirmish raid has no health floor (only story raids are guaranteed)', t.dead && t.data.hpFloor === undefined && !t.data.rstory);
}

// ---------------------------------------------------------------- the trait: Spiderling Venom
{
  const w = level('garden', 'normal', 5, { traits: ['spiderlingVenom'] });
  const c = w.colony(0)!;
  check('trait: the campaign’s traits come into a story level on the player’s colony only', (c.traits ?? []).join() === 'spiderlingVenom' && w.s.colonies.filter((o) => !o.player).every((o) => !o.traits?.length));
  // a soldier bites a beetle: the venom
  const cr = members(w, actor(w, 'beetle'))[0] as Creature;
  const a = makeAnt(w, 0, 'termant_soldier', SURFACE, cr.x + 6, cr.y, Math.PI);
  let venom = 0;
  for (let i = 0; i < 20 * 20 && !venom; i++) {
    a.gId = cr.id;
    w.step(0.05);
    w.events.drain();
    venom = cr.venom;
  }
  check('trait: a bite of the player’s ants adds a little venom', venom > 0 && cr.venomDps > 0, `stacks ${venom}`);
  const plain = level('garden', 'normal', 5);
  check('trait: none without the trait (a level played before the boss is beaten)', !(plain.colony(0)!.traits?.length));
  // skirmish: no story, no traits
  const sk = createWorld({ seed: 3, style: 'meadow', width: 640, depth: 640, colonies: [{ species: 'termant', player: true, ai: false }, { species: 'lasius', player: false, ai: true }], food: 1 }, new EventBus());
  check('trait: never in skirmish or multiplayer', sk.s.colonies.every((o) => !o.traits?.length));
  check('trait: Spiderling Venom is small (≤ 1 dps a stack, a few stacks)', (STORY.traits.spiderlingVenom.dps ?? 9) <= 1 && (STORY.traits.spiderlingVenom.maxStacks ?? 9) <= 4);
}

// ---------------------------------------------------------------- narration
{
  const keys: string[] = [];
  for (const id of ['longNights', 'spiderMother'] as const) {
    const L = STORY_LEVELS[id];
    for (const S of L.stages) for (const cap of S.say ?? []) keys.push(`${id}.${cap.key}`);
    for (const S of L.stages) for (const e of S.events ?? []) for (const a of e.actions) if (a.do === 'tip') keys.push(`tip.${a.key}`);
    keys.push(`${id}.win`, `${id}.lose`, `journal.${id}.title`, `journal.${id}.body`, `journal.${id}.note`);
  }
  keys.push('spiderMother.ending');
  const missing = keys.filter((k) => !EN[k]);
  check('narration: every new caption, tip and journal key has text', missing.length === 0, missing.join(', '));
  check('narration: the scientist’s unease grows on the nights (“as if it remembers”)', /as if it does|remember/.test(EN['longNights.unease']));
}

// ---------------------------------------------------------------- determinism
{
  const D = STORY_LEVELS.longNights.dayNight!;
  const a = level('longNights', 'normal', 21);
  const b = level('longNights', 'normal', 21);
  for (const w of [a, b]) jump(w, 2, nightStart(D, 3) - 5);
  run(a, 20 * 100);
  run(b, 20 * 100);
  check('determinism: two runs of the last night (hunters, the tarantula on its way) agree exactly', hashState(a) === hashState(b) && storyOf(a)!.flags.join() === storyOf(b)!.flags.join(), hashState(a));
  const r = restoreWorld(encodeState(a), new EventBus());
  run(a, 20 * 40);
  run(r, 20 * 40);
  check('determinism: restored from a snapshot mid-night, it runs on identically', hashState(a) === hashState(r));
  const s1 = level('spiderMother', 'hard', 4);
  const s2 = level('spiderMother', 'hard', 4);
  for (const w of [s1, s2]) {
    const m = missionOf(w)!;
    m.stage = 1;
    m.entered = false;
    run(w, 20 * 90);
  }
  check('determinism: two runs of the Spider Mother’s hunt agree exactly', hashState(s1) === hashState(s2));
}

void AS;
console.log(failed ? `\n${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `\nall chapter 1 (four levels) tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
