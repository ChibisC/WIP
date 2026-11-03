import type { StoryLevelDef } from '../../sim/story/types';

/**
 * Chapter 1, level 4 — "The Spider Mother" (claude/story/04-spec-chapter1-four-levels.md §3; map
 * src/maps/story/spiderTerrace.ts). The chapter's first boss: a Carolina wolf spider mother (`hogna`, a titan) whose
 * hunting ground is the sandy terrace above the river. The colony starts developed, with a short preparation before
 * she comes out to hunt (5–8 min by difficulty). Her three phases:
 *  1. Stalker (100–60 %): she stalks and pounces on lone ants and drags them off (the hogna program); hurt to 80 % she
 *     goes back to her burrow to rest a little, then comes out again (a director scene on `hp:mother:80`);
 *  2. Brood (60–30 %): her spiderlings spill off her back in two groups (at 60 % and 45 %) and chase the ants;
 *  3. Fury (30–0 %): she rushes for the nest, digs a hole wider and walks into it, breaking soil and stone (`digInto`) —
 *     always: she can't die before she is in (STORY.titanRaid); the bonus is killing her within a minute of it.
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
  brief: 'Above the river, the sandy terrace belongs to a huge wolf spider mother carrying her young. The colony is ready, but only just: prepare, and when she digs her way in, finish her fast.',
  player: { site: 0, startWorkers: 22, startFood: 280, name: 'Termants' },
  developed: 10,
  rivals: {},
  creatures: 0,
  aphids: 0,
  plants: 8,
  reward: { trait: 'spiderlingVenom' },
  loadout: true,
  lairs: [{ name: 'The spider’s burrow', at: 'burrow', food: 60, look: 'burrow' }],
  actors: {
    // (inside the nest her bites are softer on the harder difficulties' worn-down colonies: claude/story/05-spec §3 —
    // she always gets in now, where before a colony of 20 at the hole killed her)
    mother: { creature: 'hogna', at: 'burrowEdge', face: 'playerNest', goal: 'playerNest', hp: 0.7, phases: [0.8, 0.6, 0.3], bossCuts: [0.6, 0.3], label: 'the Spider Mother', inside: { bite: { easy: 0.8, normal: 0.75, hard: 0.5, brutal: 0.65 }, queenBite: { easy: 0.4, normal: 0.5, hard: 0.35, brutal: 0.5 } } },
  },
  stages: [
    {
      name: 'Before the hunt',
      objectives: [
        { type: 'surviveTime', s: { easy: 480, normal: 390, hard: 345, brutal: 330 }, text: 'Prepare: she hunts at dusk' },
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
      name: 'The Spider Mother',
      objectives: [{ type: 'killCreature', actor: 'mother' }],
      say: [
        { key: 'hunt', at: 1 },
        { key: 'pounce', at: 50 },
        { key: 'retreat', on: 'hp:mother:80' },
        { key: 'outAgain', on: 'motherRested' },
        { key: 'brood', on: 'hp:mother:60' },
        { key: 'fury', on: 'hp:mother:30' },
        { key: 'motherIn', on: 'motherIn' },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'assault' }, { do: 'night', level: 0.4 }, { do: 'shot', shot: { keys: [{ at: { actor: 'mother' }, dist: 180, yaw: 2.6, t: 0, pitch: -0.1 }, { at: { actor: 'mother' }, dist: 220, yaw: 2.9, t: 5 }] } }] },
        { on: 'hp:mother:30', actions: [{ do: 'tip', key: 'motherDig' }] },
      ],
      scenes: [
        // out of the burrow, a long look at the nest, then her rounds: down to the colony's doorstep, where whatever comes
        // near her she stalks and pounces on with her own program (stalk, pounce, drag away), then back to the burrow
        // with her catch for a while, and out again
        { actor: 'mother', cues: [{ mode: 'normal' }, { holdAt: 'burrowEdge', face: 'playerNest', s: 4 }, { charge: 'nestApproach', timeout: 90 }, { guard: 'nestApproach', r: 170, s: 50 }, { rest: 'burrowEdge', s: 35, heal: 0.001 }, { goto: 2 }] },
        // badly hurt in the first phase: back to the burrow for a little while, then out again and back to the hunt
        { actor: 'mother', on: 'hp:mother:80', cues: [{ mode: 'passive' }, { rest: 'burrowEdge', s: 26, heal: 0.002 }, { flag: 'motherRested' }, { mode: 'normal' }, { charge: 'nestApproach', timeout: 90 }, { guard: 'nestApproach', r: 170, s: 50 }, { rest: 'burrowEdge', s: 35, heal: 0.001 }, { goto: 4 }] },
        // fury: she rushes straight for the nest, digs a hole wider and goes in — every time (claude/story/05-spec: the
        // cue owns her until she is in, she can't die before, the dig can't be stalled); handed back to herself once in
        { actor: 'mother', on: 'hp:mother:30', cues: [{ mode: 'aggressive' }, { digInto: 'player', flag: 'motherIn', speed: 1.5 }, { release: true }] },
      ],
    },
  ],
  medals: {
    time: [12 * 60, 18 * 60],
    losses: [35, 80],
    // (she always gets in now: claude/story/05-spec §3 — the bonus was "kill her before she digs into the nest")
    bonus: { type: 'killWithin', actor: 'mother', s: 60, text: 'Kill her within a minute of her breaking into the nest' },
  },
  win: 'win',
  lose: 'lose',
};
