import type { StoryLevelDef } from '../../sim/story/types';

/**
 * Chapter 1, level 1 — "The Garden Below" (claude/story/02-spec §5; map src/maps/story/gardenBelow.ts). The queen is
 * washed ashore by the garden puddle; the level teaches the basics (the old "Landfall" tutorial folded in) and ends
 * with the black garden ants' queen dead. Steal: the Black Garden Ant Soldier.
 */
export const GARDEN: StoryLevelDef = {
  id: 'garden',
  chapter: 1,
  number: 1,
  title: 'The Garden Below',
  region: 'meadow',
  map: 'gardenBelow',
  brief: 'A storm has washed a Gene-Thief Termant queen ashore by a garden puddle. Found a colony, learn the ground, steal the black garden ants’ soldiers and take their flowerbed.',
  player: { site: 0, startWorkers: 0, startFood: 50, name: 'Gene-Thief Termants' },
  rivals: { lasius: { species: 'lasius', site: 1, name: 'Black garden ants', developed: 2, startWorkers: 8, popLimit: 26 } },
  creatures: 0,
  aphids: 4,
  plants: 8,
  reward: { caste: 'lasius_soldier' },
  loadout: false,
  actors: {
    // the opening: the castaway queen walks from the shore into her new nest (the colony's real queen is already in it)
    queen: { ants: [['termant_queen', 1]], colony: 'player', at: 'queenShore', face: 'queenGate', passive: true, label: 'the queen' },
    beetle: { creature: 'groundBeetle', at: 'beetleStart', face: 'beetleStop', passive: true, hp: 0.6, label: 'the ground beetle' },
    cutworm: { creature: 'cutworm', at: 'fruit', passive: true, label: 'the cutworm' },
    tenders: { ants: [['lasius_worker', 3]], colony: 'lasius', at: 'aphidPlants', label: 'the aphid tenders' },
    tenders2: { ants: [['lasius_worker', 2]], colony: 'lasius', at: 'aphidPlants2', label: 'the aphid tenders' },
    scouts: { ants: [['lasius_worker', 2]], colony: 'lasius', at: 'scoutTop', spawn: 'action', label: 'the scouts' },
    // the first raid, ten minutes in (the bonus: steal the soldier before it)
    raiders: { ants: [['lasius_soldier', 2], ['lasius_worker', 5]], colony: 'lasius', at: 'stoneSteps', spawn: 'action', wave: true, label: 'the Lasius raid' },
  },
  scenes: [
    {
      actor: 'raiders',
      at: 600,
      cues: [{ holdAt: 'stoneSteps', anim: 'threat', s: 4 }, { flag: 'raidComing' }, { charge: 'playerNest' }, { guard: 'playerNest', r: 70, s: 45 }, { release: true }],
    },
  ],
  say: [{ key: 'raid1', on: 'raidComing' }],
  events: [
    { on: 'raidComing', actions: [{ do: 'music', mood: 'tense' }] },
    { on: 'beaten:raiders', actions: [{ do: 'music', mood: 'calm' }] },
  ],
  stages: [
    {
      name: 'Landfall',
      objectives: [
        { type: 'raise', n: 10, text: 'Raise 10 workers' },
        { type: 'build', tile: 'brood', n: 2, text: 'Build 2 worker brood tiles' },
        { type: 'build', tile: 'food', n: 1, text: 'Build a food store tile' },
        { type: 'collectFood', amount: 60 },
        { type: 'storeWood', amount: 8 },
      ],
      say: [
        { key: 'intro1', at: 0.5 },
        { key: 'intro2', at: 6 },
        { key: 'beetle', on: 'beetleLook' },
        { key: 'intro3', on: 'queenIn' },
        { key: 'termant', at: 45 },
        { key: 'nanitics', at: 80 },
        { key: 'wood', at: 130 },
      ],
      events: [
        { actions: [{ do: 'shot', shot: 'flight' }, { do: 'music', mood: 'calm' }] },
        { at: 30, actions: [{ do: 'tip', key: 'dig' }] },
        { at: 60, actions: [{ do: 'tip', key: 'tiles' }] },
        { at: 100, actions: [{ do: 'tip', key: 'forage' }] },
        { at: 140, actions: [{ do: 'tip', key: 'wood' }] },
        { at: 190, actions: [{ do: 'tip', key: 'ramps' }] },
      ],
      scenes: [
        { actor: 'queen', cues: [{ wait: 2 }, { walkTo: 'queenGate', speed: 1 }, { leave: 'nest', flag: 'queenIn' }] },
        {
          actor: 'beetle',
          cues: [{ walkTo: 'beetleStop', speed: 0.5 }, { holdAt: 'beetleStop', face: { actor: 'queen' }, s: 5, flag: 'beetleLook' }, { leave: 'beetleExit', speed: 0.6 }],
        },
        { actor: 'cutworm', cues: [{ patrol: 'cutwormLoop', speed: 0.6 }] },
        { actor: 'tenders', cues: [{ holdAt: 'aphidPlants', anim: 'drum', s: 1e9 }] },
        { actor: 'tenders2', cues: [{ holdAt: 'aphidPlants2', anim: 'troph', s: 1e9 }] },
      ],
    },
    {
      name: 'First contact',
      objectives: [{ type: 'killAnts', rival: 'lasius', n: 4, text: 'Fight off the black garden ants (kill 4)' }, { type: 'raise', n: 18, text: 'Raise 18 ants' }],
      say: [
        { key: 'contact1', at: 4 },
        { key: 'contact2', on: 'scoutsLook' },
        { key: 'contact3', on: 'scoutsBack' },
        { key: 'contactDead', on: 'gone:scouts' },
      ],
      events: [
        { at: 1, actions: [{ do: 'spawn', actor: 'scouts' }] },
        { on: 'scoutsBack', actions: [{ do: 'tip', key: 'markers' }] },
      ],
      scenes: [
        {
          actor: 'scouts',
          at: 1,
          cues: [
            { path: 'scoutsDown', speed: 0.8, flag: 'scoutsStop' },
            { holdAt: 'scoutStop', face: 'playerNest', anim: 'antennate', s: 7, flag: 'scoutsLook' },
            { path: 'scoutsDown', reverse: true, speed: 1.1, flag: 'scoutsBack' },
            { release: true },
          ],
        },
      ],
    },
    {
      name: 'Stolen genes',
      objectives: [
        { type: 'stealCaste', caste: 'lasius_soldier' },
        { type: 'raiseCaste', caste: 'lasius_soldier', n: 3 },
      ],
      say: [
        { key: 'genes1', at: 3 },
        { key: 'aphids', at: 50 },
        { key: 'genes2', on: 'caste:lasius_soldier' },
        { key: 'flight', at: 200 },
      ],
      events: [
        { at: 10, actions: [{ do: 'tip', key: 'genes' }] },
        { on: 'caste:lasius_soldier', actions: [{ do: 'tip', key: 'caste' }] },
      ],
    },
    {
      name: 'Raid the garden',
      rivalRaids: true,
      objectives: [
        { type: 'reach', at: 'aphidPlants', r: 55, n: 8, text: 'Take the aphid plants on the flowerbed (8 ants)' },
        { type: 'killQueen', rival: 'lasius' },
      ],
      say: [
        { key: 'raid1', at: 2 },
        { key: 'flank', at: 55 },
        { key: 'queenFact', at: 140 },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'assault' }] },
        { at: 20, actions: [{ do: 'tip', key: 'rival' }] },
      ],
    },
  ],
  medals: {
    time: [20 * 60, 32 * 60],
    losses: [25, 60],
    bonus: { type: 'stealBefore', caste: 'lasius_soldier', flag: 'raidComing', text: 'Steal the Black Garden Ant Soldier before the first Lasius raid' },
  },
  win: 'win',
  lose: 'lose',
};
