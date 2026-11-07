import type { StoryLevelDef } from '../../sim/story/types';
import { column, heat, party, surprisePool, wanderer, windfall } from '../surprises';

/**
 * Surprise events (claude/story/06-spec §6): a red wood ant column crossing the garden, the ground beetle back hunting
 * the meadow's foragers, a fallen strawberry the garden ants come for, a seed drop, a hot spell.
 */
const EV = surprisePool(
  column('woodAnts', { window: [1000, 1700], visitor: 'formica', species: 'formica', name: 'Red wood ants', ants: [['formica_worker', 7], ['formica_soldier', 2]], enter: 'evEast', path: 'woodCol', exit: 'evSouth', label: 'the wood ant column', say: 'woodAnts' }),
  wanderer('beetleHunt', { window: [520, 900], creature: 'groundBeetle', enter: 'beetleExit', to: 'fruit', r: 60, s: 110, exit: 'evSouth', hp: 0.7, label: 'the ground beetle', say: 'beetleHunt' }),
  windfall('strawberry', { window: [700, 1300], at: 'berryDrop', kind: 'berry', model: '', scale: 2.2, say: 'strawberry' }),
  party('berryParty', { window: [25, 55], after: 'ev:strawberry', rival: 'lasius', ants: [['lasius_worker', 4]], enter: 'stoneSteps', to: 'berryDrop', s: 50, label: 'the strawberry foragers' }),
  heat('hotSpell', { window: [1500, 2400], chance: 0.7, s: 100, say: 'heat' }),
  // (an early Lasius raid on Hard and Brutal was cut, 2026-11-03: at a person's pace it ended the first level at 15–19
  // minutes; a seed drop instead, something to gain)
  windfall('seeds', { window: [400, 900], after: 'stage:1', at: 'fruit', kind: 'seed', model: '', scale: 1.1, n: 10, spread: 30, say: 'seeds' }),
);

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
  brief: 'A storm has washed a Termant queen ashore by a garden puddle. Found a colony, learn the ground, steal the black garden ants’ soldiers and take their flowerbed.',
  player: { site: 0, startWorkers: 0, startFood: 50, name: 'Termants' },
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
    ...EV.actors,
  },
  surprises: EV.surprises,
  visitors: EV.visitors,
  scenes: [
    {
      actor: 'raiders',
      at: 600,
      // (`mode: 'aggressive'` then the guard: as this played while a charge cue was skipped at once — kept unchanged)
      cues: [{ holdAt: 'stoneSteps', anim: 'threat', s: 4 }, { flag: 'raidComing' }, { mode: 'aggressive' }, { guard: 'playerNest', r: 70, s: 45 }, { release: true }],
    },
    ...EV.scenes,
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
        // (taken and held for two minutes, not only reached: with the playtest bot fixed the level ran 27 minutes on Normal
        // at a person's pace, under the 30 the chapter aims at, claude/story/06-spec §7, 2026-11-06)
        { type: 'hold', at: 'aphidPlants', r: 55, n: 8, s: 120, name: 'the aphid plants on the flowerbed' },
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
    time: [28 * 60, 40 * 60],
    losses: [25, 60],
    bonus: { type: 'stealBefore', caste: 'lasius_soldier', flag: 'raidComing', text: 'Steal the Black Garden Ant Soldier before the first Lasius raid' },
  },
  win: 'win',
  lose: 'lose',
};
