import type { StoryLevelDef } from '../../sim/story/types';

/**
 * Chapter 1, level 2 — "Fire on the Banks" (claude/story/02-spec §5; map src/maps/story/fireBanks.ts). A young queen
 * from the garden colony founds a fresh nest on the river's middle shelf (the simplest opening that fits the story
 * and the engine). Tropical fire ants own the high bank. Steal: the Tropical Fire Ant Major. Loadout: the Black
 * Garden Ant Soldier (one slot) or nothing.
 */
export const FIRE_BANKS_LEVEL: StoryLevelDef = {
  id: 'fireBanks',
  chapter: 1,
  number: 2,
  title: 'Fire on the Banks',
  region: 'riverbank',
  map: 'fireBanks',
  brief: 'A young queen from the garden colony settles on the river shelf, below a mound of tropical fire ants. Hold off their swarm, steal their majors, ride out the river’s rise and take the mound.',
  player: { site: 0, startWorkers: 3, startFood: 140, name: 'Gene-Thief Termants' },
  rivals: { fire: { species: 'solenopsis', site: 1, name: 'Tropical fire ants', developed: 4, startWorkers: 12, popLimit: 55 } },
  creatures: 0,
  aphids: 2,
  plants: 8,
  reward: { caste: 'fire_major' },
  loadout: true,
  actors: {
    foragers: { ants: [['fire_minor', 5], ['fire_major', 1]], colony: 'fire', at: 'mound', label: 'the foraging column' },
    critterW: { creature: 'pillbug', at: 'marginWest', passive: true, label: 'a pill bug' },
    critterE: { creature: 'cutworm', at: 'marginEast', passive: true, label: 'a cutworm' },
    majors: { ants: [['fire_major', 3]], colony: 'fire', at: 'slopeTop', face: 'playerNest', spawn: 'action', label: 'the majors' },
    swarm: { ants: [['fire_minor', 22], ['fire_soldier', 5]], colony: 'fire', at: 'slopeTop', face: 'playerNest', spawn: 'action', wave: true, label: 'the swarm' },
    guardsA: { ants: [['fire_major', 2], ['fire_soldier', 2]], colony: 'fire', at: 'seedA', spawn: 'action', label: 'the seed guards' },
    guardsB: { ants: [['fire_major', 2], ['fire_soldier', 2]], colony: 'fire', at: 'seedB', spawn: 'action', label: 'the seed guards' },
  },
  stages: [
    {
      name: 'Settle the bank',
      objectives: [
        { type: 'raise', n: 16, text: 'Raise 16 ants' },
        { type: 'build', tile: 'food', n: 2, text: 'Build 2 food store tiles' },
        { type: 'collectFood', amount: 120 },
      ],
      say: [
        { key: 'intro1', at: 0.5 },
        { key: 'intro2', at: 6.5 },
        { key: 'foragers', on: 'columnOut' },
        { key: 'sting', at: 70 },
        { key: 'numbers', at: 140 },
      ],
      events: [
        { actions: [{ do: 'shot', shot: 'flight' }, { do: 'music', mood: 'calm' }] },
        { at: 2, actions: [{ do: 'food', at: 'fish', kind: 'insect', from: 'grasshopper', scale: 2.4 }] },
        { at: 2, actions: [{ do: 'food', at: 'seedA', kind: 'seed', from: '', scale: 1.1, n: 10, spread: 22 }] },
        { at: 2, actions: [{ do: 'food', at: 'seedB', kind: 'seed', from: '', scale: 1.1, n: 10, spread: 22 }] },
        { at: 40, actions: [{ do: 'tip', key: 'ramps' }] },
        { at: 15, actions: [{ do: 'shot', shot: { keys: [{ at: { actor: 'foragers' }, dist: 120, yaw: 0.9, t: 0 }, { at: { actor: 'foragers' }, dist: 110, yaw: 1.2, t: 5 }] } }] },
      ],
      scenes: [
        { actor: 'foragers', at: 12, cues: [{ flag: 'columnOut' }, { path: 'forageTrail', speed: 0.9, anim: 'carry' }, { release: true }] },
        { actor: 'critterW', cues: [{ wander: 'marginWestZone', s: 1e9, speed: 0.4 }] },
        { actor: 'critterE', cues: [{ wander: 'marginEastZone', s: 1e9, speed: 0.6 }] },
      ],
    },
    {
      name: 'The swarm',
      objectives: [{ type: 'surviveWave', actor: 'swarm' }],
      say: [
        { key: 'warn', at: 2 },
        { key: 'swarm', on: 'swarmGo' },
        { key: 'swarmDone', on: 'beaten:swarm' },
      ],
      events: [
        { actions: [{ do: 'spawn', actor: 'majors' }, { do: 'spawn', actor: 'swarm' }, { do: 'music', mood: 'swarm' }] },
        { at: 1, actions: [{ do: 'shot', shot: { keys: [{ at: 'slopeTop', dist: 170, yaw: 2.6, t: 0, pitch: -0.1 }, { at: 'slopeFoot', dist: 230, yaw: 2.9, t: 4.5 }] } }] },
        { on: 'beaten:swarm', actions: [{ do: 'music', mood: 'calm' }] },
      ],
      scenes: [
        { actor: 'majors', cues: [{ holdAt: 'slopeTop', face: 'playerNest', anim: 'threat', s: 16 }, { flag: 'swarmGo' }, { charge: 'playerNest' }, { guard: 'playerNest', r: 80, s: 30 }, { release: true }] },
        { actor: 'swarm', cues: [{ anim: 'threat', s: 16 }, { waitFlag: 'swarmGo', timeout: 30 }, { charge: 'playerNest' }, { guard: 'playerNest', r: 80, s: 40 }, { release: true }] },
      ],
    },
    {
      name: 'Majors',
      objectives: [{ type: 'stealCaste', caste: 'fire_major' }],
      say: [
        { key: 'majors', at: 4 },
        { key: 'genes', at: 60 },
        { key: 'stolen', on: 'caste:fire_major' },
      ],
      events: [
        { actions: [{ do: 'spawn', actor: 'guardsA' }, { do: 'spawn', actor: 'guardsB' }, { do: 'music', mood: 'tense' }] },
        { at: 20, actions: [{ do: 'tip', key: 'genes' }] },
        { on: 'caste:fire_major', actions: [{ do: 'tip', key: 'fireCaste' }] },
      ],
      scenes: [
        { actor: 'guardsA', cues: [{ guard: 'seedA', r: 70 }] },
        { actor: 'guardsB', cues: [{ guard: 'seedB', r: 70 }] },
      ],
    },
    {
      name: 'The river rises',
      objectives: [{ type: 'surviveTime', s: 100, text: 'Ride out the flood' }],
      say: [
        { key: 'river1', at: 1 },
        { key: 'river2', at: 35 },
        { key: 'river3', at: 90 },
      ],
      events: [
        { actions: [{ do: 'tip', key: 'flood' }, { do: 'flood', zone: 0 }] },
        { at: 2, actions: [{ do: 'shot', shot: { keys: [{ at: 'river', dist: 320, yaw: 0.2, t: 0 }, { at: 'marginWest', dist: 200, yaw: 0.5, t: 4 }] } }] },
      ],
      scenes: [
        { actor: 'critterW', cues: [{ mode: 'passive' }, { flee: 'fleeWest', speed: 1.4 }, { release: true }] },
        { actor: 'critterE', cues: [{ mode: 'passive' }, { flee: 'fleeEast', speed: 1.4 }, { release: true }] },
      ],
    },
    {
      name: 'Take the mound',
      rivalRaids: true,
      objectives: [{ type: 'killQueen', rival: 'fire' }],
      say: [
        { key: 'assault', at: 2 },
        { key: 'unease', at: 70 },
      ],
      events: [{ actions: [{ do: 'music', mood: 'assault' }] }, { at: 25, actions: [{ do: 'tip', key: 'rival' }] }],
    },
  ],
  medals: {
    time: [25 * 60, 38 * 60],
    losses: [40, 80],
    bonus: { type: 'waveLosses', actor: 'swarm', max: 10, text: 'Lose no more than 10 ants to the swarm' },
  },
  win: 'win',
  lose: 'lose',
};
