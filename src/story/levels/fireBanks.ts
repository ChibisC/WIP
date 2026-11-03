import type { StoryLevelDef } from '../../sim/story/types';
import { column, heat, party, rain, surprisePool, wanderer, windfall } from '../surprises';

/**
 * Surprise events (claude/story/06-spec §6): a praying mantis waiting at the slope's foot, a fire ant scouting band on
 * the shelf, a dead cricket by the river, a summer shower and the fire ants' mating flight after it (fallen alates:
 * food), a hot spell; on Hard and Brutal an army ant swarm raid along the river margin.
 */
const EV = surprisePool(
  wanderer('mantis', { window: [500, 1100], creature: 'mantis', enter: 'evEastMid', to: 'slopeFoot', r: 70, s: 120, exit: 'evEastMid', label: 'the mantis', say: 'mantis' }),
  party('scouts', { window: [700, 1500], rival: 'fire', ants: [['fire_minor', 5]], enter: 'slopeTop', to: 'shelf', s: 50, label: 'the fire ant scouts', say: 'scouts' }),
  windfall('cricket', { window: [300, 900], at: 'marginWest', kind: 'insect', model: 'cricket', scale: 1.8 }),
  rain('shower', { window: [900, 1600], s: 70, until: 'stage:3', say: 'shower' }),
  windfall('alates', { window: [30, 60], after: 'ev:shower', at: 'slopeFoot', kind: 'insect', model: 'fly', scale: 0.55, n: 12, spread: 60, say: 'alates' }),
  heat('hotSand', { window: [600, 2000], chance: 0.6, s: 100, say: 'heat' }),
  column('armySwarm', { window: [1300, 2200], from: 'hard', visitor: 'eciton', species: 'eciton', name: 'Army ants', ants: [['eciton_minor', 12], ['eciton_submajor', 3], ['eciton_major', 1]], enter: 'evEastMargin', path: 'swarmMargin', exit: 'evWestMargin', label: 'the army ant swarm', say: 'armySwarm', dur: 200 }),
);

/**
 * Chapter 1, level 3 — "Fire on the Banks" (claude/story/02-spec §5; map src/maps/story/fireBanks.ts; level 2 until
 * 2026-11-02, when the nights came before it — 04-spec §1: its gameplay, map and balance unchanged). A young queen from
 * the colony founds a fresh nest on the river's middle shelf (the simplest opening that fits the story and the
 * engine). Tropical fire ants own the high bank. Steal: the Tropical Fire Ant Major. Loadout: the Black Garden Ant
 * Soldier (one slot) or nothing.
 */
export const FIRE_BANKS_LEVEL: StoryLevelDef = {
  id: 'fireBanks',
  chapter: 1,
  number: 3,
  title: 'Fire on the Banks',
  region: 'riverbank',
  map: 'fireBanks',
  brief: 'A young queen from the colony that came through the long nights settles on the river shelf, below a mound of tropical fire ants. Hold off their swarm, steal their majors, ride out the river’s rise and take the mound.',
  player: { site: 0, startWorkers: 3, startFood: 170, name: 'Termants' },
  // (2026-11-02 caste balance: fire ant minors are tougher now, so the mound holds fewer of them; was 4 / 12 / 55)
  rivals: { fire: { species: 'solenopsis', site: 1, name: 'Tropical fire ants', developed: 3, startWorkers: 10, popLimit: 18 } },
  enemyStat: 0.85,
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
    ...EV.actors,
  },
  scenes: EV.scenes,
  surprises: EV.surprises,
  visitors: EV.visitors,
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
        // (`mode: 'aggressive'` then the guard: how these played and were balanced while a charge cue was skipped at once —
        // kept so the level plays exactly as before, 04-spec §1; the guard walks them down to the nest fighting)
        { actor: 'majors', cues: [{ holdAt: 'slopeTop', face: 'playerNest', anim: 'threat', s: 16 }, { flag: 'swarmGo' }, { mode: 'aggressive' }, { guard: 'playerNest', r: 80, s: 30 }, { release: true }] },
        { actor: 'swarm', cues: [{ anim: 'threat', s: 16 }, { waitFlag: 'swarmGo', timeout: 30 }, { mode: 'aggressive' }, { guard: 'playerNest', r: 80, s: 40 }, { release: true }] },
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
