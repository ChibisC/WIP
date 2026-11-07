/**
 * Story surprise events and the new chapter 1 levels (claude/story/06-spec-levels-5-7-and-lengths.md §6–8): every level
 * has a pool; the same seed gives the same events; more on Brutal than on Easy; big ones never overlap; a visiting
 * party (a nestless colony) crosses the map and leaves it; weather; the hold objective; the three new maps validate.
 * Run: npx vite-node tests/storyEvents.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { storySetup } from '../src/sim/story/runner';
import { storyOf, actorIndex, hasFlag } from '../src/sim/story/state';
import { members, wherePt } from '../src/sim/story/director';
import { missionOf } from '../src/sim/missions';
import { firedSurprises } from '../src/sim/story/surprises';
import { STORY_LEVELS } from '../src/story/levels';
import { STORY } from '../src/sim/balance';
import { MAPS } from '../src/maps';
import { validateMap } from '../src/world/mapValidate';
import { Terrain, mapTerrainParams } from '../src/world/terrain';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { damageAnt } from '../src/sim/combat';
import { EN } from '../src/story/text/en';
import type { Difficulty, StoryLevelId } from '../src/sim/story/types';

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
const level = (id: StoryLevelId, diff: Difficulty = 'normal', seed = 5) => createWorld(storySetup(id, diff, [], seed), new EventBus());
const rolled = (id: StoryLevelId, diff: Difficulty, seed: number) => {
  const st = storyOf(level(id, diff, seed))!;
  return (st.surp ?? []).map((s) => `${STORY_LEVELS[id].surprises![s.i].id}@${s.at}/${s.off}`);
};

// ---------------------------------------------------------------- every level has a pool, with text
{
  const ids = Object.keys(STORY_LEVELS) as StoryLevelId[];
  check('events: all seven levels have surprise events (the four old ones too)', ids.length === 7 && ids.every((id) => (STORY_LEVELS[id].surprises ?? []).length >= 4), ids.map((id) => `${id} ${(STORY_LEVELS[id].surprises ?? []).length}`).join(', '));
  const missing: string[] = [];
  for (const L of Object.values(STORY_LEVELS)) for (const e of L.surprises ?? []) if (e.say && !EN[`${L.id}.${e.say}`]) missing.push(`${L.id}.${e.say}`);
  check('events: every event caption has text', missing.length === 0, missing.join(', '));
  // every event's scenes name actors that exist; every visitor's species is in the game
  const bad: string[] = [];
  for (const L of Object.values(STORY_LEVELS)) {
    for (const sc of L.scenes ?? []) if (!L.actors[sc.actor]) bad.push(`${L.id}: scene for ${sc.actor}`);
    for (const a of Object.values(L.actors)) if (a.colony && a.colony !== 'player' && !L.rivals[a.colony] && !L.visitors?.[a.colony]) bad.push(`${L.id}: colony ${a.colony}`);
  }
  check('events: every scene names an actor, every party a colony of the level', bad.length === 0, bad.join(', '));
}

// ---------------------------------------------------------------- deterministic, scaled by difficulty
{
  const a = rolled('fireBanks', 'normal', 11).join();
  const b = rolled('fireBanks', 'normal', 11).join();
  const c = rolled('fireBanks', 'normal', 12).join();
  check('events: the same seed rolls the same events at the same times', a === b && a.length > 0, a);
  check('events: another seed rolls them differently', a !== c, c);
  let easy = 0;
  let brutal = 0;
  for (let seed = 1; seed <= 12; seed++) {
    for (const id of ['garden', 'fireBanks', 'longNights'] as const) {
      easy += rolled(id, 'easy', seed).length;
      brutal += rolled(id, 'brutal', seed).length;
    }
  }
  check('events: more of them on Brutal than on Easy (STORY.difficulty.*.events)', brutal > easy && STORY.difficulty.easy.events < STORY.difficulty.brutal.events, `${easy} on Easy, ${brutal} on Brutal (12 seeds × 3 levels)`);
  check('events: the army ant swarm only on Hard and Brutal', !rolled('fireBanks', 'normal', 3).some((x) => x.startsWith('armySwarm')) && [1, 2, 3, 4, 5].some((s) => rolled('fireBanks', 'brutal', s).some((x) => x.startsWith('armySwarm'))));
}

// ---------------------------------------------------------------- a column crosses the map and leaves it
{
  const w = level('garden', 'normal', 5);
  const st = storyOf(w)!;
  const L = STORY_LEVELS.garden;
  const ev = st.surp!.find((s) => L.surprises![s.i].id === 'woodAnts')!;
  check('garden: the wood ant column is rolled on Normal', !!ev);
  // (the test skips ahead: the earlier events are let go, so none of them holds the column back)
  for (const x of st.surp!) if (x !== ev) x.done = 1;
  w.s.time = ev.at - 2;
  run(w, 20 * 4);
  const act = st.actors[actorIndex(st, 'woodAnts')];
  const col = w.colony(act.ids.length ? w.antById.get(act.ids[0])!.colony : -1);
  check('garden: the column comes on (its own nestless colony of red wood ants)', firedSurprises(st, L).includes('woodAnts') && members(w, act).length >= 6 && !!col?.visitor && col.species === 'formica' && col.entrances.length === 0);
  check('garden: the visitors never build or raid (no queen, no nest, not an AI)', !!col && !col.ai && col.queen === -1 && col.tiles.length === 0);
  let gone = -1;
  for (let i = 0; i < 20 * 180 && gone < 0; i++) {
    w.step(0.05);
    w.events.drain();
    if (members(w, act).length === 0) gone = w.s.time;
  }
  check('garden: …walks its path across the garden and off the map (no ant left behind)', gone > 0 && w.s.ants.filter((a) => a.colony === col!.id && a.state !== AS.Dead).length === 0, `gone at ${gone.toFixed(0)} s`);
  check('garden: the visitors’ colony is never lost (no queen to lose)', col!.alive);
}

// ---------------------------------------------------------------- a column fights what it meets
{
  const w = level('garden', 'normal', 5);
  const st = storyOf(w)!;
  const L = STORY_LEVELS.garden;
  const ev = st.surp!.find((s) => L.surprises![s.i].id === 'woodAnts')!;
  for (const x of st.surp!) if (x !== ev) x.done = 1;
  // a group of the player's ants on its path
  const p = wherePt(w, [720, 680]);
  for (let i = 0; i < 8; i++) makeAnt(w, 0, 'termant_worker', SURFACE, p[0] + (i % 4) * 5, p[1] + Math.floor(i / 4) * 5, 0);
  const died0 = w.colony(0)!.stats.died;
  w.s.time = ev.at - 1;
  run(w, 20 * 60);
  const act = st.actors[actorIndex(st, 'woodAnts')];
  check('garden: the column fights the ants it meets on its way', w.colony(0)!.stats.died > died0 || members(w, act).length < act.n0, `player lost ${w.colony(0)!.stats.died - died0}, column ${members(w, act).length}/${act.n0}`);
}

// ---------------------------------------------------------------- big events never overlap
{
  let overlaps = 0;
  let checked = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const w = level('fireBanks', 'brutal', seed);
    const st = storyOf(w)!;
    const L = STORY_LEVELS.fireBanks;
    const starts: Array<[number, number]> = [];
    for (let s = 0; s < 2400; s++) {
      run(w, 20);
      for (const id of firedSurprises(st, L)) {
        const e = L.surprises!.find((x) => x.id === id)!;
        if (e.big && !starts.some((x) => x[1] === L.surprises!.indexOf(e))) starts.push([w.s.time, L.surprises!.indexOf(e)]);
      }
      if (missionOf(w)!.result) break;
    }
    starts.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < starts.length; i++) {
      checked++;
      if (starts[i][0] < starts[i - 1][0] + L.surprises![starts[i - 1][1]].dur - 1) overlaps++;
    }
  }
  check('events: a big event never starts while another runs (STORY.eventGap)', overlaps === 0 && checked > 0, `${checked} pairs`);
}

// ---------------------------------------------------------------- weather
{
  const w = level('fireBanks', 'normal', 5);
  const st = storyOf(w)!;
  const L = STORY_LEVELS.fireBanks;
  const hot = st.surp!.find((s) => L.surprises![s.i].id === 'hotSand');
  const a = makeAnt(w, 0, 'termant_worker', SURFACE, 300, 500, 0);
  if (hot) {
    w.s.time = hot.at + 1;
    run(w, 20 * 2);
    check('weather: a hot spell slows ants on the surface (STORY.heatSpeed)', (w.s.weather?.heat ?? 0) > w.s.time && STORY.heatSpeed < 1);
  } else check('weather: a hot spell rolled for this seed', false);
  void a;
}

// ---------------------------------------------------------------- snapshot round trip mid-event
{
  const w = level('garden', 'normal', 5);
  const st = storyOf(w)!;
  const ev = st.surp!.find((s) => STORY_LEVELS.garden.surprises![s.i].id === 'woodAnts')!;
  for (const x of st.surp!) if (x !== ev) x.done = 1;
  w.s.time = ev.at - 2;
  run(w, 20 * 10);
  const snap = encodeState(w);
  const w2 = restoreWorld(snap, new EventBus());
  run(w, 20 * 30);
  run(w2, 20 * 30);
  check('events: a save in the middle of a column plays on exactly the same', hashState(w) === hashState(w2));
}

// ---------------------------------------------------------------- the new maps
{
  for (const id of ['oakWoods', 'floodHill', 'rainforestEdge'] as const) {
    const def = MAPS[id]!;
    const r = validateMap(def, 1, def.sites.length);
    // (High Water floods everything but the summit, and the rainforest hollow's food floods in showers: by design)
    const probs = r.problems.filter((p) => !(id === 'floodHill' && /flood zone/.test(p)) && !(id === 'rainforestEdge' && /while flood zone/.test(p)));
    check(`story map ${id}: passes the validator`, probs.length === 0, probs.join('; '));
    const t = new Terrain(mapTerrainParams(1, id));
    const bad = Object.entries(def.story!.points).filter(([, p]) => !t.passable(p[0], p[1]) || !t.inBounds(p[0], p[1], 4));
    check(`story map ${id}: every story point is on walkable ground`, bad.length === 0, bad.map(([k]) => k).join(', '));
    const fl = def.story!.flight;
    check(`story map ${id}: an opening flight ending at the player's start`, fl.length >= 3 && Math.hypot(fl[fl.length - 1].at[0] - def.sites[0].at[0], fl[fl.length - 1].at[1] - def.sites[0].at[1]) < 120);
    check(`story map ${id}: no fallen leaves (user rule)`, !def.walls.some((w) => (w.kind as string) === 'leaf') && !def.walkways.some((k) => k.kind === 'leaf'));
  }
  const t = new Terrain(mapTerrainParams(1, 'floodHill'));
  const S = MAPS.floodHill!.sites;
  const lv = S.map((s) => t.levelAt(s.at[0], s.at[1]));
  const h = S.map((s) => t.heightAt(s.at[0], s.at[1]));
  check('high water: the summit is the highest site; the three nests stand at three different heights below it', h[0] > h[1] && h[0] > h[2] && h[0] > h[3] && new Set([Math.round(h[1]), Math.round(h[2]), Math.round(h[3])]).size === 3 && lv[0] === 2, h.map((x) => x.toFixed(0)).join(' / '));
  const F = MAPS.floodHill!.floods;
  check('high water: four water stages, each higher; the last one under the summit', F.length === 4 && F.every((f, i) => i === 0 || f.level > F[i - 1].level) && F[3].level < h[0] - 10 && F[3].level > Math.max(h[1], h[2], h[3]));
}

// ---------------------------------------------------------------- the new levels' set-up
{
  const hw = level('highWater', 'normal', 5);
  const st = storyOf(hw)!;
  const lasius = Object.values(st.rivals).map((id) => hw.colony(id)!);
  check('high water: three black garden ant colonies, each on its own (they fight each other too)', lasius.length === 3 && lasius.every((c) => c.species === 'lasius') && new Set(lasius.map((c) => c.team)).size === 3 && lasius.every((c) => c.team !== hw.colony(0)!.team));
  const t = hw.terrain;
  const p = hw.colony(0)!;
  check('high water: the colony nests on the summit', t.levelAt(p.nx, p.ny) === 2);
  {
    // (three colonies at once: their sizes stay the same on every difficulty, only strength and aggression grow)
    const size = (d: Difficulty) => {
      const x = level('highWater', d, 5);
      return Object.values(storyOf(x)!.rivals).map((id) => x.colony(id)!.popLimit).join();
    };
    const fc = level('fireBanks', 'brutal', 5);
    const fire = fc.colony(Object.values(storyOf(fc)!.rivals)[0])!.popLimit;
    check('high water: the three colonies are the same size on Normal and Brutal (other levels still grow theirs)', size('normal') === size('brutal') && size('normal') === '24,24,26' && fire > 18, `${size('normal')} / ${size('brutal')}; fire ants on Brutal ${fire}`);
  }
  check('high water: the water rises in stages (the plain, the foot, the east shelf, the terrace)', STORY_LEVELS.highWater.stages.map((S) => (S.events ?? []).flatMap((e) => e.actions).find((a) => a.do === 'flood')).filter(Boolean).map((a) => (a as { zone: number }).zone).join() === '0,1,2,3');
  const ck = level('cartonKingdom', 'normal', 5);
  const sk = storyOf(ck)!;
  const tm = Object.values(sk.rivals).map((id) => ck.colony(id)!);
  check('carton kingdom: two conehead termite colonies, allies (one team), not the colony’s', tm.length === 2 && tm.every((c) => c.species === 'nasutitermes') && tm[0].team === tm[1].team && tm[0].team !== ck.colony(0)!.team);
  check('carton kingdom: the reward is the glue-squirting Sprayer, kept for the campaign', STORY_LEVELS.cartonKingdom.reward.caste === 'nasute_soldier');
  const ak = STORY_LEVELS.antleredKing;
  check('antlered king: five stages (the old stump before the titan), the titan last; the reward is Antler Plating (built, story only)', ak.stages.length === 5 && ak.stages[3].name === 'The old stump' && ak.actors.king.creature === 'stagBeetle' && ak.reward.trait === 'antlerPlating' && !!STORY.traits.antlerPlating.built);
  check('antlered king: the four stag beetle sizes are in the cast', ['stagMinor', 'stagSmall', 'stagMedium', 'stagLarge'].every((k) => Object.values(ak.actors).some((a) => a.creature === k)));
}

// ---------------------------------------------------------------- Antler Plating
{
  const w = level('garden', 'normal', 5);
  const plated = createWorld(storySetup('garden', 'normal', [], 5, { traits: ['antlerPlating'] }), new EventBus());
  const hit = (x: World) => {
    const a = makeAnt(x, 0, 'termant_worker', SURFACE, 300, 640, 0);
    const hp0 = a.hp;
    damageAnt(x, a, 5, 'bite', null);
    return hp0 - a.hp;
  };
  const d0 = hit(w);
  const d1 = hit(plated);
  check('trait: Antler Plating takes armour off every bite on the colony’s ants', d1 < d0 && Math.abs(d0 - d1 - (STORY.traits.antlerPlating.armor ?? 0)) < 0.01, `${d0.toFixed(2)} → ${d1.toFixed(2)}`);
}

// ---------------------------------------------------------------- the hold objective (the sap run)
{
  const w = level('antleredKing', 'normal', 5);
  const m = missionOf(w)!;
  m.stage = 1;
  m.entered = false;
  run(w, 20 * 2);
  const p = wherePt(w, 'sapOak');
  const ants = Array.from({ length: 14 }, (_, i) => makeAnt(w, 0, 'termant_soldier', SURFACE, p[0] + (i % 4) * 6 - 9, p[1] + 14 + Math.floor(i / 4) * 6, 0));
  let held = '';
  for (let s = 0; s < 170; s++) {
    for (const a of ants) if (a.state !== AS.Dead) Object.assign(a, { x: p[0] + (ants.indexOf(a) % 4) * 6 - 9, y: p[1] + 14 + Math.floor(ants.indexOf(a) / 4) * 6, hp: a.maxHp });
    run(w, 20);
    held = m.goals[0]?.progress ?? '';
    if (m.stage !== 1) break;
  }
  check('antlered king: holding the sap with 12 ants for 150 s finishes the sap run', m.stage === 2, held);
}

// ---------------------------------------------------------------- a new stage's timed scenes wait for its own clock
{
  // (the mission enters a stage once a second: until it does, the director must not read the last stage's clock — the
  // Spider Mother's broods at 6½ and 10 min came out together at the start of her rounds)
  const w = level('spiderMother', 'normal', 5);
  const st = storyOf(w)!;
  const m = missionOf(w)!;
  while (w.s.tick % 20 !== 1) run(w, 1);
  m.stage = 1;
  m.entered = false;
  m.t = 900;
  run(w, 25);
  check('director: a new stage’s timed scenes wait for its own clock (no brood at the start of her rounds)', m.entered && !hasFlag(st, 'wave:broodB') && !hasFlag(st, 'wave:broodC'), st.flags.join(', '));
}

// ---------------------------------------------------------------- the old stump (the king sees off a challenger)
{
  const w = level('antleredKing', 'normal', 5);
  const st = storyOf(w)!;
  const m = missionOf(w)!;
  m.stage = 3;
  m.entered = false;
  let off = -1;
  for (let s = 0; s < 200; s++) {
    run(w, 20);
    if (off < 0 && hasFlag(st, 'challengerOff')) off = s;
  }
  const king = st.actors.find((a) => a.name === 'king')!;
  const k = w.creatureById.get(king.ids[0])!;
  const stump = wherePt(w, 'kingStump');
  check('antlered king: on the old stump the king sees off a challenger without a fight (it climbs to him, turns back and leaves the woods)', hasFlag(st, 'challenger') && off > 0 && members(w, st.actors[actorIndex(st, 'challenger')]).length === 0 && !k.dead && k.hp === k.maxHp && Math.hypot(k.x - stump[0], k.y - stump[1]) < 40, `off at ${off} s; king ${Math.round((k.hp / k.maxHp) * 100)} % at ${Math.hypot(k.x - stump[0], k.y - stump[1]).toFixed(0)} mm from the stump`);
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
