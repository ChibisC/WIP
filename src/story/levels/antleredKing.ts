import type { StoryLevelDef } from '../../sim/story/types';
import { rain, surprisePool, wanderer, windfall } from '../surprises';

/**
 * Chapter 1, level 5 — "The Antlered King" (claude/story/06-spec-levels-5-7-and-lengths.md §3; map
 * src/maps/story/oakWoods.ts). The colony moves into old oak woods where male stag beetles of every size fight over the
 * sap of a wounded oak. Four stages:
 *  1. Settle the woods: build up; a minor male walks through, a small male comes to the clearing and stays until he is
 *     brought down (big beetles need many ants; ants can climb onto them);
 *  2. The sap run: the oak weeps sap (a food landmark: honeydew drops every 45 s); two males meet there and wrestle,
 *     the bigger throws the smaller; the colony must hold the sap;
 *  3. Rivals in the woods: a medium male comes and goes, the large male holds the sap and keeps coming to the shelf until
 *     he is killed, two more wrestle in the clearing, surprise events;
 *  4. The Antlered King: the major male (the stag beetle titan) comes down from his stump. Every attack is telegraphed
 *     (his own program: grab-and-toss, shoving through the swarm, rear-and-slam when enraged); at 45 % lesser males
 *     arrive from the woods; at 25 %, or after three minutes at the doorstep, he digs into the nest.
 * Win: kill him. Lose: the queen dies. Reward: the trait Antler Plating (story only, STORY.traits). The level aims at
 * 35–45 minutes on Normal.
 */
const EV = surprisePool(
  wanderer('beetle', { window: [300, 700], creature: 'groundBeetle', enter: 'evWest', to: 'northFoot', r: 60, s: 100, exit: 'evWest', hp: 0.8, label: 'a ground beetle', say: 'groundBeetle' }),
  windfall('moth', { window: [200, 500], at: 'woodsNorth', kind: 'insect', model: 'moth', scale: 1.6 }),
  rain('shower', { window: [60, 300], after: 'stage:2', s: 80, say: 'shower' }),
  windfall('fallenBeetle', { window: [120, 260], after: 'ev:shower', at: 'clearing', kind: 'insect', model: 'beetle', scale: 2.0, say: 'fallen' }),
  wanderer('smallLate', { window: [200, 400], after: 'stage:2', until: 'stage:3', from: 'hard', creature: 'stagSmall', enter: 'evSouth', to: 'shelfFoot', r: 70, s: 100, exit: 'evSouth', label: 'a small male stag beetle' }),
);

export const ANTLERED_KING_LEVEL: StoryLevelDef = {
  id: 'antleredKing',
  chapter: 1,
  number: 5,
  title: 'The Antlered King',
  region: 'forest',
  map: 'oakWoods',
  brief: 'Old oak woods on the western hills, full of stag beetles: males of every size, fighting over the sap of a wounded oak. Settle the woods, take the sap, and face the old male who rules the ancient stump.',
  player: { site: 0, startWorkers: 10, startFood: 220, name: 'Termants' },
  // a young colony on the shelf: the founding ring, a worker chamber and a store by the entrance (claude/story/06-spec)
  nest: [
    { type: 'brood', caste: 'termant_worker', n: 7 },
    { type: 'food', n: 4 },
    { type: 'brood', caste: 'termant_soldier', n: 3 },
  ],
  rivals: {},
  creatures: 0,
  aphids: 3,
  plants: 8,
  reward: { trait: 'antlerPlating' },
  loadout: true,
  actors: {
    minor: { creature: 'stagMinor', at: 'evWest', face: 'clearing', spawn: 'action', label: 'a minor male stag beetle' },
    small: { creature: 'stagSmall', at: 'evNorth', face: 'clearing', spawn: 'action', label: 'a small male stag beetle' },
    // the sap run: two males meet at the oak and wrestle
    sapA: { creature: 'stagSmall', at: 'evEast', face: 'sapOak', spawn: 'action', label: 'a small male' },
    sapB: { creature: 'stagMedium', at: 'evNorthEast', face: 'sapOak', spawn: 'action', label: 'a medium male' },
    // rivals in the woods
    medium: { creature: 'stagMedium', at: 'evWest', face: 'clearing', spawn: 'action', label: 'a medium male stag beetle' },
    large: { creature: 'stagLarge', at: 'evNorth', face: 'sapOak', spawn: 'action', label: 'the large male' },
    pairA: { creature: 'stagSmall', at: 'evSouth', face: 'clearing', spawn: 'action', label: 'a small male' },
    pairB: { creature: 'stagMedium', at: 'evEast', face: 'clearing', spawn: 'action', label: 'a medium male' },
    // the titan and the lesser males that come to the fight
    king: { creature: 'stagBeetle', at: 'kingStump', face: 'knollFoot', goal: 'nestApproach', spawn: 'action', hp: 1, phases: [0.7, 0.45, 0.25], label: 'the Antlered King' },
    callA: { creature: 'stagSmall', at: 'evWest', face: 'nestApproach', spawn: 'action', wave: true, label: 'the lesser males' },
    callB: { creature: 'stagMedium', at: 'evSouth', face: 'nestApproach', spawn: 'action', wave: true, label: 'the lesser males' },
    ...EV.actors,
  },
  surprises: EV.surprises,
  visitors: EV.visitors,
  scenes: EV.scenes,
  stages: [
    {
      name: 'Settle the woods',
      objectives: [
        { type: 'raise', n: 35, text: 'Raise 35 ants' },
        { type: 'collectFood', amount: 200 },
        // (the first fight: the small male stays in the clearing until he is brought down)
        { type: 'killCreature', actor: 'small' },
      ],
      say: [
        { key: 'intro1', at: 0.5 },
        { key: 'intro2', at: 8 },
        { key: 'minor', on: 'minorSeen' },
        { key: 'allometry', at: 150 },
        { key: 'small', on: 'smallSeen' },
        { key: 'larvae', at: 330 },
      ],
      events: [
        { actions: [{ do: 'shot', shot: 'flight' }, { do: 'music', mood: 'calm' }] },
        { at: 60, actions: [{ do: 'spawn', actor: 'minor' }] },
        { at: 80, actions: [{ do: 'tip', key: 'stagBeetles' }] },
        { at: 260, actions: [{ do: 'spawn', actor: 'small' }] },
      ],
      scenes: [
        { actor: 'minor', at: 60, cues: [{ wait: 2 }, { flag: 'minorSeen' }, { path: 'minorWalk', speed: 0.6, timeout: 300 }, { leave: 'evEast', speed: 0.6 }] },
        { actor: 'small', at: 260, cues: [{ walkTo: 'clearing', speed: 0.6, timeout: 200, flag: 'smallSeen' }, { wander: 'clearingZone', s: 1e9, speed: 0.5 }] },
      ],
    },
    {
      name: 'The sap run',
      objectives: [
        { type: 'hold', at: 'sapOak', r: 50, n: 12, s: 150, name: 'the sap flow' },
        { type: 'collectFood', amount: 150, optional: true },
      ],
      say: [
        { key: 'sap1', at: 2 },
        { key: 'sap2', on: 'sapMeet' },
        { key: 'thrown', on: 'sapThrown' },
        { key: 'sap3', at: 300 },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'tense' }, { do: 'shot', shot: { keys: [{ at: 'sapOak', dist: 220, yaw: 0.6, t: 0, pitch: 0.05 }, { at: 'sapOak', dist: 180, yaw: 1.0, t: 5 }] } }] },
        // the oak weeps sap: drops at its foot, again and again
        ...[0, 45, 90, 135, 180, 225, 270, 315, 360, 405, 450, 495, 540, 585, 630, 675, 720].map((at) => ({ at: at + 2, actions: [{ do: 'food' as const, at: 'sapOak', kind: 'honeydew' as const, from: '', scale: 1.6, n: 2, spread: 12 }] })),
        { at: 20, actions: [{ do: 'spawn', actor: 'sapA' }, { do: 'spawn', actor: 'sapB' }] },
        { on: 'sapMeet', actions: [{ do: 'wrestle', a: 'sapA', b: 'sapB' }] },
        { at: 40, actions: [{ do: 'tip', key: 'hold' }] },
      ],
      scenes: [
        { actor: 'sapA', at: 20, cues: [{ walkTo: 'sapEast', speed: 0.7, timeout: 200 }, { holdAt: 'sapEast', face: { actor: 'sapB' }, s: 4 }, { flag: 'sapMeet' }, { wait: 26 }, { flag: 'sapThrown' }, { mode: 'normal' }, { leave: 'evEast', speed: 0.7 }] },
        { actor: 'sapB', at: 20, cues: [{ walkTo: 'sapWest', speed: 0.7, timeout: 200 }, { holdAt: 'sapWest', face: { actor: 'sapA' }, s: 4 }, { waitFlag: 'sapThrown', timeout: 60 }, { guard: 'sapOak', r: 60, s: 160 }, { leave: 'evNorthEast', speed: 0.7 }] },
      ],
    },
    {
      name: 'Rivals in the woods',
      objectives: [
        { type: 'surviveTime', s: { easy: 600, normal: 660, hard: 690, brutal: 720 }, text: 'Hold the woods while the rival males come and go' },
        { type: 'killCreature', actor: 'large' },
        { type: 'fighters', n: 20, optional: true },
      ],
      say: [
        { key: 'rivals1', at: 2 },
        { key: 'medium', on: 'mediumSeen' },
        { key: 'large', on: 'largeSeen' },
        { key: 'pair', on: 'pairMeet' },
        { key: 'stump', at: 470 },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'calm' }] },
        { at: 60, actions: [{ do: 'spawn', actor: 'medium' }] },
        { at: 210, actions: [{ do: 'spawn', actor: 'large' }, { do: 'music', mood: 'tense' }] },
        { at: 380, actions: [{ do: 'spawn', actor: 'pairA' }, { do: 'spawn', actor: 'pairB' }] },
        { on: 'pairMeet', actions: [{ do: 'wrestle', a: 'pairA', b: 'pairB' }] },
      ],
      scenes: [
        { actor: 'medium', at: 60, cues: [{ walkTo: 'northFoot', speed: 0.7, timeout: 200, flag: 'mediumSeen' }, { guard: 'northFoot', r: 70, s: 110 }, { leave: 'evWest', speed: 0.7 }] },
        // (the large male stays: he holds the sap and comes to the shelf's foot again and again until he is killed)
        { actor: 'large', at: 210, cues: [{ walkTo: 'sapOak', speed: 0.7, timeout: 240, flag: 'largeSeen' }, { guard: 'sapOak', r: 80, s: 150 }, { charge: 'shelfFoot', timeout: 120 }, { guard: 'shelfFoot', r: 80, s: 60 }, { goto: 1 }] },
        { actor: 'pairA', at: 380, cues: [{ walkTo: 'clearing', speed: 0.7, timeout: 200 }, { holdAt: 'clearing', face: { actor: 'pairB' }, s: 3 }, { flag: 'pairMeet' }, { wait: 30 }, { leave: 'evSouth', speed: 0.7 }] },
        { actor: 'pairB', at: 380, cues: [{ walkTo: 'sapWest', speed: 0.7, timeout: 200 }, { holdAt: 'sapWest', face: { actor: 'pairA' }, s: 3 }, { wait: 30 }, { leave: 'evEast', speed: 0.7 }] },
      ],
    },
    {
      name: 'The Antlered King',
      objectives: [{ type: 'killCreature', actor: 'king' }],
      say: [
        { key: 'king1', at: 2 },
        { key: 'king2', on: 'kingOut' },
        { key: 'grab', on: 'kingAtNest' },
        { key: 'enraged', on: 'hp:king:70' },
        { key: 'call', on: 'hp:king:45' },
        { key: 'kingDigs', on: 'kingDigs' },
        { key: 'kingIn', on: 'kingIn' },
        { key: 'kingDead', on: 'killed:king' },
      ],
      events: [
        { actions: [{ do: 'spawn', actor: 'king' }, { do: 'music', mood: 'assault' }, { do: 'shot', shot: { keys: [{ at: { actor: 'king' }, dist: 260, yaw: 0.9, t: 0, pitch: 0.05 }, { at: { actor: 'king' }, dist: 220, yaw: 1.3, t: 6 }] } }] },
        { on: 'hp:king:45', actions: [{ do: 'spawn', actor: 'callA' }, { do: 'spawn', actor: 'callB' }] },
        { on: 'hp:king:25', actions: [{ do: 'flag', flag: 'kingDigs' }] },
        { on: 'kingDigs', actions: [{ do: 'tip', key: 'titanDig' }] },
      ],
      scenes: [
        // down from his stump, across the clearing and up to the colony's doorstep, fighting what he meets (his own program)
        // (after three minutes at the doorstep he goes for the nest itself, hurt or not: a colony that only waits him out
        // does not stall the level, 2026-11-03)
        { actor: 'king', cues: [{ holdAt: 'kingStump', face: 'clearing', s: 5 }, { flag: 'kingOut' }, { path: 'kingWay', speed: 1, timeout: 240 }, { flag: 'kingAtNest' }, { guard: 'nestApproach', r: 160, s: 180 }, { flag: 'kingDigs' }, { mode: 'aggressive' }, { digInto: 'player', flag: 'kingIn', timeout: 300 }, { release: true }] },
        { actor: 'callA', on: 'hp:king:45', cues: [{ charge: 'nestApproach', timeout: 200 }, { guard: 'nestApproach', r: 90 }] },
        { actor: 'callB', on: 'hp:king:45', cues: [{ charge: 'shelfFoot', timeout: 200 }, { guard: 'shelfFoot', r: 90 }] },
        // a quarter left: he goes for the nest itself, shoving a hole wider with his head and antlers
        { actor: 'king', on: 'hp:king:25', cues: [{ mode: 'aggressive' }, { digInto: 'player', flag: 'kingIn', timeout: 300 }, { release: true }] },
      ],
    },
  ],
  medals: {
    time: [40 * 60, 52 * 60],
    losses: [60, 140],
    bonus: { type: 'killBefore', actor: 'king', flag: 'kingIn', text: 'Kill the Antlered King before he digs into the nest' },
  },
  win: 'win',
  lose: 'lose',
};
