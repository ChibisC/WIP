import type { StoryLevelDef } from '../../sim/story/types';
import { column, rain, surprisePool, wanderer, windfall } from '../surprises';

/**
 * Chapter 1, level 6 — "High Water" (claude/story/06-spec-levels-5-7-and-lengths.md §4; map src/maps/story/floodHill.ts).
 * King of the hill: the colony holds the summit of a hill in the river's flood plain; three black garden ant colonies
 * nest below it, on the hill's foot (west), on a raised shelf (east) and on the terrace round the summit. The best food
 * is down on the plain; the summit has little. The river rises in stages, each warned of (a shower upriver, a caption,
 * the goal's clock, the flood warning): the plain, the hill's foot (the west nest floods), the east shelf (the east nest),
 * the terrace (the last nest). A nest under the water line floods underground and everything in it drowns
 * (sim/nestFlood.ts). A colony whose nest is about to flood goes all-in on the summit (its only way to survive is to kill
 * the queen who holds the high ground); earlier they raid normally and fight each other. The summit never floods.
 * Win: all three colonies gone (drowned or destroyed). Lose: the queen dies. Medals: food stored, losses, and destroying
 * a colony before the water does. About 36 minutes on Normal (the water's timetable is the same on every difficulty).
 */
const EV = surprisePool(
  wanderer('beetle', { window: [240, 520], until: 'stage:1', creature: 'groundBeetle', enter: 'evWest', to: 'plainWest', r: 70, s: 110, exit: 'evWest', hp: 0.8, label: 'a ground beetle', say: 'beetle' }),
  windfall('grasshopper', { window: [150, 420], until: 'stage:1', at: 'plainMid', kind: 'insect', model: 'grasshopper', scale: 2.2, say: 'grasshopper' }),
  windfall('seeds', { window: [60, 240], after: 'stage:1', until: 'stage:2', at: 'footWest', kind: 'seed', model: '', scale: 1.1, n: 10, spread: 30 }),
  wanderer('spider', { window: [100, 300], after: 'stage:2', until: 'stage:4', creature: 'wolfSpider', enter: 'evEast', to: 'footEast', r: 70, s: 100, exit: 'evEast', label: 'a wolf spider', say: 'spider' }),
  column('woodAnts', { window: [380, 560], until: 'stage:1', from: 'hard', visitor: 'formica', species: 'formica', name: 'Red wood ants', ants: [['formica_worker', 6], ['formica_soldier', 2]], enter: 'evWest', path: 'plainCross', exit: 'evEast', label: 'the wood ant column', say: 'woodAnts' }),
);

export const HIGH_WATER_LEVEL: StoryLevelDef = {
  id: 'highWater',
  chapter: 1,
  number: 6,
  title: 'High Water',
  region: 'riverbank',
  map: 'floodHill',
  brief: 'The colony holds the summit of a hill in the river’s flood plain, above three black garden ant nests. The river is rising. Forage the low ground while it lasts, and hold the summit against colonies with nowhere else to go.',
  player: { site: 0, startWorkers: 10, startFood: 200, name: 'Termants' },
  nest: [
    { type: 'brood', caste: 'termant_worker', n: 7 },
    { type: 'food', n: 4 },
    { type: 'brood', caste: 'termant_soldier', n: 3 },
  ],
  rivals: {
    west: { species: 'lasius', site: 1, name: 'Black garden ants (west)', developed: 2, startWorkers: 8, popLimit: 24 },
    east: { species: 'lasius', site: 2, name: 'Black garden ants (east)', developed: 2, startWorkers: 8, popLimit: 24 },
    terrace: { species: 'lasius', site: 3, name: 'Black garden ants (terrace)', developed: 3, startWorkers: 9, popLimit: 26 },
  },
  creatures: 0,
  aphids: 3,
  plants: 8,
  reward: {},
  loadout: true,
  actors: { ...EV.actors },
  surprises: EV.surprises,
  visitors: EV.visitors,
  scenes: EV.scenes,
  stages: [
    {
      name: 'The summit',
      objectives: [
        { type: 'surviveTime', s: 600, text: 'Before the river rises' },
        { type: 'raise', n: 30, optional: true, text: 'Raise 30 ants' },
        { type: 'storeFood', amount: 200, optional: true },
      ],
      say: [
        { key: 'intro1', at: 0.5 },
        { key: 'intro2', at: 8 },
        { key: 'plain', at: 60 },
        { key: 'three', at: 150 },
        { key: 'upriver', at: 470 },
      ],
      events: [
        { actions: [{ do: 'shot', shot: 'flight' }, { do: 'music', mood: 'calm' }] },
        { at: 40, actions: [{ do: 'tip', key: 'highWater' }] },
        // the warning: a shower upriver, then the water
        { at: 470, actions: [{ do: 'weather', rain: 150 }, { do: 'music', mood: 'tense' }] },
      ],
    },
    {
      name: 'The plain goes under',
      rivalRaids: true,
      objectives: [
        { type: 'surviveTime', s: 540, text: 'Before the hill’s foot floods' },
        { type: 'storeFood', amount: 280, optional: true },
      ],
      say: [
        { key: 'rise1', at: 2 },
        { key: 'rafts', at: 90 },
        { key: 'westKnows', on: 'allOut:west' },
        { key: 'upriver2', at: 470 },
      ],
      events: [
        { actions: [{ do: 'flood', zone: 0 }] },
        { at: 340, actions: [{ do: 'allOut', rival: 'west' }, { do: 'flag', flag: 'allOut:west' }, { do: 'music', mood: 'assault' }] },
        { at: 470, actions: [{ do: 'weather', rain: 120 }] },
      ],
    },
    {
      name: 'The hill’s foot',
      rivalRaids: true,
      objectives: [
        { type: 'surviveTime', s: 480, text: 'Before the east shelf floods' },
        { type: 'killQueen', rival: 'west', optional: true },
      ],
      say: [
        { key: 'rise2', at: 2 },
        { key: 'westNest', on: 'nestFlood:west' },
        { key: 'brood', at: 120 },
        { key: 'eastKnows', on: 'allOut:east' },
      ],
      events: [
        { actions: [{ do: 'flood', zone: 1 }, { do: 'music', mood: 'tense' }] },
        // (the water reaches the west nest's doorway as the flood rises: 25 s warning, 10 s rising)
        { at: 38, actions: [{ do: 'floodNests' }] },
        { at: 290, actions: [{ do: 'allOut', rival: 'east' }, { do: 'flag', flag: 'allOut:east' }, { do: 'music', mood: 'assault' }] },
        { at: 420, actions: [{ do: 'weather', rain: 100 }] },
      ],
    },
    {
      name: 'The east shelf',
      rivalRaids: true,
      objectives: [
        { type: 'surviveTime', s: 450, text: 'Before the terrace floods' },
        { type: 'killQueen', rival: 'east', optional: true },
      ],
      say: [
        { key: 'rise3', at: 2 },
        { key: 'eastNest', on: 'nestFlood:east' },
        { key: 'terraceKnows', on: 'allOut:terrace' },
      ],
      events: [
        { actions: [{ do: 'flood', zone: 2 }, { do: 'music', mood: 'tense' }] },
        { at: 38, actions: [{ do: 'floodNests' }] },
        { at: 260, actions: [{ do: 'allOut', rival: 'terrace' }, { do: 'flag', flag: 'allOut:terrace' }, { do: 'music', mood: 'assault' }] },
        { at: 390, actions: [{ do: 'weather', rain: 100 }] },
      ],
    },
    {
      name: 'The summit stands',
      rivalRaids: true,
      objectives: [{ type: 'killQueens', rivals: ['west', 'east', 'terrace'], n: 3 }],
      say: [
        { key: 'rise4', at: 2 },
        { key: 'terraceNest', on: 'nestFlood:terrace' },
        { key: 'island', at: 150 },
      ],
      events: [
        { actions: [{ do: 'flood', zone: 3 }, { do: 'music', mood: 'tense' }] },
        { at: 38, actions: [{ do: 'floodNests' }] },
        // (in case a nest's doorway was still dry the first time: the water stays, so check again)
        { at: 60, actions: [{ do: 'floodNests' }] },
      ],
    },
  ],
  medals: {
    food: [420, 240],
    losses: [70, 160],
    bonus: { type: 'deadBefore', rivals: ['west', 'east', 'terrace'], text: 'Destroy a colony yourself before the water takes it' },
  },
  win: 'win',
  lose: 'lose',
};
