import type { StoryLevelDef } from '../../sim/story/types';
import { heat, surprisePool, wanderer, windfall } from '../surprises';

/**
 * Surprise events (claude/story/06-spec §6): before she hunts, a wolf spider stalking the foragers, a dead cricket, a hot
 * afternoon; during her rounds a ground beetle and a fallen moth, on Hard and Brutal a second wolf spider.
 */
const EV = surprisePool(
  wanderer('stalker', { window: [150, 330], until: 'stage:1', creature: 'wolfSpider', enter: 'evEast', to: 'rampMidFoot', r: 70, s: 110, exit: 'evEast', label: 'a wolf spider', say: 'stalker' }),
  windfall('cricket', { window: [110, 280], until: 'stage:1', at: 'prey', kind: 'insect', model: 'cricket', scale: 1.8 }),
  heat('hotAfternoon', { window: [250, 400], until: 'stage:1', chance: 0.6, s: 90, say: 'heat' }),
  wanderer('beetle', { window: [240, 520], after: 'stage:1', until: 'stage:2', creature: 'groundBeetle', enter: 'evWest', to: 'nestApproach', r: 60, s: 100, exit: 'evWest', hp: 0.8, label: 'a ground beetle', say: 'beetle' }),
  windfall('moth', { window: [100, 400], after: 'stage:1', until: 'stage:2', at: 'rampMidFoot', kind: 'insect', model: 'moth', scale: 1.5 }),
  wanderer('stalker2', { window: [420, 640], after: 'stage:1', until: 'stage:2', from: 'hard', creature: 'wolfSpider', enter: 'evWest', to: 'nestApproach', r: 70, s: 100, exit: 'evWest', label: 'another wolf spider' }),
);

/**
 * Chapter 1, level 4 — "The Spider Mother" (claude/story/04-spec-chapter1-four-levels.md §3; map
 * src/maps/story/spiderTerrace.ts). The chapter's first boss: a Carolina wolf spider mother (`hogna`, a titan) whose
 * hunting ground is the sandy terrace above the river. The colony starts developed, with a preparation before she
 * comes out (6½–9 min by difficulty); then she hunts the colony in rounds for 11–13 minutes — out to its doorstep, back to
 * her burrow, out again — while her dispersing spiderlings hunt round the terrace in groups and other hunters come
 * (claude/story/06-spec §7: the level ran 14–17 minutes); then the fight to the end. Her three phases:
 *  1. Stalker (100–60 %): she stalks and pounces on lone ants and drags them off (the hogna program); hurt to 80 % she
 *     goes back to her burrow to rest a little, then comes out again (a director scene on `hp:mother:80`);
 *  2. Brood (60–30 %): her spiderlings spill off her back in two groups (at 60 % and 45 %) and chase the ants;
 *  3. Fury (30–0 %): she comes for the nest, digs a hole wider and walks into it, breaking soil and stone (`digInto`).
 * Riders follow the mounting rules; she shakes them off (telegraphed). A restart skips the opening flight.
 * Reward: the trait Spiderling Venom (story only, STORY.traits). No extra slot.
 */
export const SPIDER_MOTHER_LEVEL: StoryLevelDef = {
  id: 'spiderMother',
  chapter: 1,
  number: 4,
  title: 'The Spider Mother',
  region: 'riverbank',
  map: 'spiderTerrace',
  brief: 'Above the river, the sandy terrace belongs to a huge wolf spider mother carrying her young. Prepare, hold out while she hunts the colony in rounds and her spiderlings scatter over the terrace, then kill her before she digs her way in.',
  // a developed colony laid out like an AI nest (user 2026-11-02): the founding ring of workers round the queen, a worker
  // chamber, a soldier chamber and a store chamber by the entrance (7-hex rosettes), the passage and tunnels paved; a
  // stolen caste brought in gets a small chamber of its own
  player: { site: 0, startWorkers: 12, startFood: 280, name: 'Termants' },
  nest: [
    { type: 'brood', caste: 'termant_worker', n: 7 },
    { type: 'food', n: 7 },
    { type: 'brood', caste: 'termant_soldier', n: 7 },
    { type: 'brood', caste: 'lasius_soldier', n: 3 },
    { type: 'brood', caste: 'fire_major', n: 3 },
  ],
  rivals: {},
  creatures: 0,
  aphids: 0,
  plants: 8,
  reward: { trait: 'spiderlingVenom' },
  loadout: true,
  lairs: [{ name: 'The spider’s burrow', at: 'burrow', food: 60, look: 'burrow' }],
  actors: {
    // (on her rounds she can be hurt but not killed: at 55 % she is hurt no further until the last stage, `stage:2`)
    mother: { creature: 'hogna', at: 'burrowEdge', face: 'playerNest', goal: 'playerNest', hp: 0.7, phases: [0.8, 0.6, 0.3], bossCuts: [0.6, 0.3], floor: { hp: 0.55, until: 'stage:2' }, label: 'the Spider Mother' },
    // her older young, dispersing: groups of spiderlings that hunt round the terrace on their own
    broodA: { creatures: [['spiderling', 5]], at: 'eggA', spawn: 'action', wave: true, label: 'a brood of spiderlings' },
    broodB: { creatures: [['spiderling', 5]], at: 'eggB', spawn: 'action', wave: true, label: 'a brood of spiderlings' },
    broodC: { creatures: [['spiderling', 6]], at: 'eggC', spawn: 'action', wave: true, label: 'a brood of spiderlings' },
    broodD: { creatures: [['spiderling', 6]], at: 'eggA', spawn: 'action', wave: true, label: 'a brood of spiderlings' },
    ...EV.actors,
  },
  surprises: EV.surprises,
  visitors: EV.visitors,
  scenes: EV.scenes,
  stages: [
    {
      name: 'Before the hunt',
      objectives: [
        { type: 'surviveTime', s: { easy: 600, normal: 570, hard: 540, brutal: 510 }, text: 'Prepare: she hunts at dusk' },
        { type: 'fighters', n: 14, optional: true },
        { type: 'raise', n: 50, optional: true, text: 'Raise 50 ants' },
      ],
      say: [
        { key: 'intro1', at: 0.5 },
        { key: 'intro2', at: 7 },
        { key: 'intro3', at: 14 },
        { key: 'prep', at: 60 },
        { key: 'sight', at: 180 },
      ],
      events: [
        { actions: [{ do: 'shot', shot: 'flight' }, { do: 'music', mood: 'calm' }] },
        { at: 2, actions: [{ do: 'food', at: 'prey', kind: 'insect', from: 'grasshopper', scale: 2 }] },
        { at: 25, actions: [{ do: 'tip', key: 'motherHunt' }] },
      ],
      // she sits in the mouth of her burrow; hurt early, she answers (her own program) and goes back
      scenes: [{ actor: 'mother', cues: [{ rest: 'burrowEdge', s: 1e9 }] }],
    },
    {
      name: 'Her rounds',
      objectives: [
        { type: 'surviveTime', s: { easy: 840, normal: 900, hard: 930, brutal: 960 }, text: 'Hold out while she hunts the colony' },
        { type: 'fighters', n: 20, optional: true },
        { type: 'raise', n: 60, optional: true, text: 'Raise 60 ants' },
      ],
      say: [
        { key: 'hunt', at: 1 },
        { key: 'pounce', at: 50 },
        { key: 'rounds', at: 200 },
        { key: 'hatch', on: 'hatchA' },
        { key: 'retreat', on: 'hp:mother:80' },
        { key: 'outAgain', on: 'motherRested' },
        { key: 'hide', on: 'motherHides' },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'tense' }, { do: 'night', level: 0.3 }, { do: 'shot', shot: { keys: [{ at: { actor: 'mother' }, dist: 180, yaw: 2.6, t: 0, pitch: -0.1 }, { at: { actor: 'mother' }, dist: 220, yaw: 2.9, t: 5 }] } }] },
        { at: 150, actions: [{ do: 'spawn', actor: 'broodA' }, { do: 'flag', flag: 'hatchA' }] },
        { at: 390, actions: [{ do: 'spawn', actor: 'broodB' }] },
        { at: 600, actions: [{ do: 'spawn', actor: 'broodC' }] },
        { at: 780, actions: [{ do: 'spawn', actor: 'broodD' }] },
      ],
      scenes: [
        // her rounds: down to the colony's doorstep, where whatever comes near her she stalks and pounces on with her own
        // program (stalk, pounce, drag away), then back to the burrow with her catch for a long while, and out again
        { actor: 'mother', cues: [{ mode: 'normal' }, { holdAt: 'burrowEdge', face: 'playerNest', s: 4 }, { charge: 'nestApproach', timeout: 90 }, { guard: 'nestApproach', r: 170, s: 40 }, { rest: 'burrowEdge', s: 75, heal: 0.0006 }, { goto: 2 }] },
        // hurt to 80 %: back to the burrow for a while, then her rounds again
        { actor: 'mother', on: 'hp:mother:80', cues: [{ mode: 'passive' }, { rest: 'burrowEdge', s: 40, heal: 0.001 }, { flag: 'motherRested' }, { mode: 'normal' }, { charge: 'nestApproach', timeout: 90 }, { guard: 'nestApproach', r: 170, s: 40 }, { rest: 'burrowEdge', s: 75, heal: 0.0006 }, { goto: 4 }] },
        // hurt to 60 % before the last stage: she stays down her burrow until full dark
        { actor: 'mother', on: 'hp:mother:60', cues: [{ mode: 'passive' }, { flag: 'motherHides' }, { rest: 'burrowEdge', s: 1e9, heal: 0.0003 }] },
        // the dispersing spiderlings: each brood hunts round a part of the terrace, then goes its own way
        { actor: 'broodA', on: 'hatchA', cues: [{ walkTo: 'rampMidFoot', timeout: 120 }, { guard: 'rampMidFoot', r: 80, s: 150 }, { release: true }] },
        { actor: 'broodB', at: 390, cues: [{ walkTo: 'rampWestTop', timeout: 120 }, { guard: 'rampWestTop', r: 80, s: 150 }, { release: true }] },
        { actor: 'broodC', at: 600, cues: [{ walkTo: 'nestApproach', timeout: 120 }, { guard: 'nestApproach', r: 80, s: 150 }, { release: true }] },
        { actor: 'broodD', at: 780, cues: [{ walkTo: 'rampMidFoot', timeout: 120 }, { guard: 'rampMidFoot', r: 80, s: 150 }, { release: true }] },
      ],
    },
    {
      name: 'The Spider Mother',
      objectives: [{ type: 'killCreature', actor: 'mother' }],
      say: [
        { key: 'last', at: 1 },
        { key: 'retreat', on: 'hp:mother:80' },
        { key: 'outAgain', on: 'motherRested' },
        { key: 'brood', on: 'hp:mother:60' },
        { key: 'fury', on: 'hp:mother:30' },
        { key: 'motherIn', on: 'motherIn' },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'assault' }, { do: 'night', level: 0.45 }] },
        { on: 'hp:mother:30', actions: [{ do: 'tip', key: 'motherDig' }] },
      ],
      scenes: [
        // out of the burrow, a long look at the nest, then her rounds: down to the colony's doorstep, where whatever comes
        // near her she stalks and pounces on with her own program (stalk, pounce, drag away), then back to the burrow
        // with her catch for a while, and out again
        { actor: 'mother', cues: [{ mode: 'normal' }, { holdAt: 'burrowEdge', face: 'playerNest', s: 4 }, { charge: 'nestApproach', timeout: 90 }, { guard: 'nestApproach', r: 170, s: 50 }, { rest: 'burrowEdge', s: 35, heal: 0.001 }, { goto: 2 }] },
        // badly hurt in the first phase: back to the burrow for a little while, then out again and back to the hunt
        { actor: 'mother', on: 'hp:mother:80', cues: [{ mode: 'passive' }, { rest: 'burrowEdge', s: 26, heal: 0.002 }, { flag: 'motherRested' }, { mode: 'normal' }, { charge: 'nestApproach', timeout: 90 }, { guard: 'nestApproach', r: 170, s: 50 }, { rest: 'burrowEdge', s: 35, heal: 0.001 }, { goto: 4 }] },
        // fury: straight for the nest, a hole dug wider, and in
        { actor: 'mother', on: 'hp:mother:30', cues: [{ mode: 'aggressive' }, { digInto: 'player', flag: 'motherIn', timeout: 300 }, { release: true }] },
      ],
    },
  ],
  medals: {
    time: [30 * 60, 40 * 60],
    losses: [45, 100],
    bonus: { type: 'killBefore', actor: 'mother', flag: 'motherIn', text: 'Kill her before she digs into the nest' },
  },
  win: 'win',
  lose: 'lose',
};
