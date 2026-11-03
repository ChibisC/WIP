import type { StoryLevelDef } from '../../sim/story/types';
import { column, heat, party, rain, surprisePool, wanderer, windfall } from '../surprises';

/**
 * Chapter 1, level 7 — "Carton Kingdom" (claude/story/06-spec-levels-5-7-and-lengths.md §5; map
 * src/maps/story/rainforestEdge.ts). The chapter's last level. At the rainforest's edge two allied colonies of conehead
 * termites (Nasutitermes corniger, the game's Nasute Termites) hold a shelf between the buttress roots of two giant
 * trees: carton nests, covered galleries, wood-gathering workers, glue-squirting nasute soldiers and charging majors.
 * Allied (one team, the AI allies' brain): attacking one brings the other unless it is invaded itself. Stages:
 *  1. The forest's edge: settle, while termite foragers and their galleries spread toward the colony;
 *  2. The nasus: take nasute soldiers' corpses home and steal the caste (a shower fills the hollow; after it the
 *     termites' winged alates pour out for their mating flight: food for whoever catches them);
 *  3. The first nest and 4. The second: destroy both colonies, in either order.
 * Win: both termite queens dead. Lose: the queen dies. Reward: the Conehead Termite Sprayer (`nasute_soldier`, the glue
 * squirter: the spec's "Nasute Termite soldier"; main named it the Sprayer, 2026-11-03), kept for the campaign. The
 * chapter's closing line follows its win. About 38 minutes on Normal.
 */
const EV = surprisePool(
  party('foragers', { window: [180, 330], until: 'stage:1', rival: 'north', ants: [['nasute_worker', 5], ['nasute_soldier', 2]], enter: 'shelfWest', to: 'hollow', s: 70, label: 'the termite foragers', say: 'foragers' }),
  wanderer('mantis', { window: [300, 600], until: 'stage:2', creature: 'mantis', enter: 'evSouth', to: 'nestApproach', r: 70, s: 110, exit: 'evSouth', label: 'a mantis', say: 'mantis' }),
  rain('shower', { window: [60, 180], after: 'stage:1', s: 90, flood: 0, say: 'shower' }),
  windfall('alatesN', { window: [30, 50], after: 'ev:shower', at: 'shelfWest', kind: 'insect', model: 'fly', scale: 0.55, n: 12, spread: 70, say: 'alates' }),
  windfall('alatesS', { window: [40, 60], after: 'ev:shower', at: 'hollowWest', kind: 'insect', model: 'fly', scale: 0.55, n: 10, spread: 60 }),
  heat('steam', { window: [120, 400], after: 'stage:2', until: 'stage:3', chance: 0.6, s: 90, say: 'steam' }),
  column('armyAnts', { window: [200, 500], after: 'stage:2', from: 'hard', visitor: 'eciton', species: 'eciton', name: 'Army ants', ants: [['eciton_minor', 12], ['eciton_submajor', 3], ['eciton_major', 1]], enter: 'evWest', path: 'swarmWay', exit: 'evSouth', label: 'the army ant swarm', say: 'armyAnts', dur: 200 }),
  windfall('fruit', { window: [100, 400], after: 'stage:2', at: 'hollow', kind: 'berry', model: 'apple', scale: 2.4, say: 'fruit' }),
);

export const CARTON_KINGDOM_LEVEL: StoryLevelDef = {
  id: 'cartonKingdom',
  chapter: 1,
  number: 7,
  title: 'Carton Kingdom',
  region: 'rainforest',
  map: 'rainforestEdge',
  brief: 'At the rainforest’s edge two conehead termite colonies hold a shelf between the roots of two giant trees, and they defend each other. Steal the genes of their glue-squirting Sprayers, then destroy both nests.',
  player: { site: 0, startWorkers: 10, startFood: 240, name: 'Termants' },
  nest: [
    { type: 'brood', caste: 'termant_worker', n: 7 },
    { type: 'food', n: 4 },
    { type: 'brood', caste: 'termant_soldier', n: 3 },
  ],
  rivals: {
    north: { species: 'nasutitermes', site: 1, name: 'Conehead termites (north)', developed: 3, startWorkers: 10, popLimit: 30, team: 1 },
    east: { species: 'nasutitermes', site: 2, name: 'Conehead termites (east)', developed: 3, startWorkers: 10, popLimit: 30, team: 1 },
  },
  creatures: 0,
  aphids: 3,
  plants: 8,
  reward: { caste: 'nasute_soldier' },
  loadout: true,
  actors: { ...EV.actors },
  surprises: EV.surprises,
  visitors: EV.visitors,
  scenes: EV.scenes,
  stages: [
    {
      name: 'The forest’s edge',
      objectives: [
        { type: 'raise', n: 35, text: 'Raise 35 ants' },
        { type: 'collectFood', amount: 200 },
        { type: 'storeWood', amount: 20, optional: true },
      ],
      say: [
        { key: 'intro1', at: 0.5 },
        { key: 'intro2', at: 8 },
        { key: 'carton', at: 70 },
        { key: 'galleries', at: 200 },
        { key: 'allies', at: 330 },
      ],
      events: [
        { actions: [{ do: 'shot', shot: 'flight' }, { do: 'music', mood: 'calm' }] },
        { at: 50, actions: [{ do: 'tip', key: 'termites' }] },
      ],
    },
    {
      name: 'The nasus',
      objectives: [
        { type: 'stealCaste', caste: 'nasute_soldier' },
        { type: 'raiseCaste', caste: 'nasute_soldier', n: 4 },
      ],
      say: [
        { key: 'nasus1', at: 3 },
        { key: 'nasus2', at: 90 },
        { key: 'stolen', on: 'caste:nasute_soldier' },
      ],
      events: [
        { at: 10, actions: [{ do: 'tip', key: 'nasuteGenes' }] },
        { on: 'caste:nasute_soldier', actions: [{ do: 'tip', key: 'nasuteCaste' }] },
      ],
    },
    {
      name: 'The first nest',
      rivalRaids: true,
      objectives: [{ type: 'killQueens', rivals: ['north', 'east'], n: 1 }],
      say: [
        { key: 'assault1', at: 2 },
        { key: 'help', at: 120 },
        { key: 'royals', at: 260 },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'assault' }] },
        { at: 20, actions: [{ do: 'tip', key: 'allies' }] },
      ],
    },
    {
      name: 'The second nest',
      rivalRaids: true,
      objectives: [{ type: 'killQueens', rivals: ['north', 'east'], n: 2 }],
      say: [
        { key: 'assault2', at: 2 },
        { key: 'last', at: 150 },
      ],
      events: [{ actions: [{ do: 'music', mood: 'assault' }] }],
    },
  ],
  medals: {
    time: [40 * 60, 52 * 60],
    losses: [70, 160],
    bonus: { type: 'stealBefore', caste: 'nasute_soldier', flag: 'raid:north', text: 'Steal the Conehead Termite Sprayer before the termites raid you' },
  },
  win: 'win',
  lose: 'lose',
};
