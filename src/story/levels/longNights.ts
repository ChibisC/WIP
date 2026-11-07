import type { StoryLevelDef } from '../../sim/story/types';
import { column, heat, surprisePool, wanderer, windfall } from '../surprises';

/**
 * Surprise events by day (claude/story/06-spec §6–7: the days have things to do): a moth fallen in the hollow, a red
 * wood ant column crossing it at midday and a hot spell on the second day, a praying mantis and a dead grasshopper on
 * the third, a rove beetle hunting and a seed drop on the fourth.
 */
const EV = surprisePool(
  windfall('moth', { window: [200, 320], until: 'dusk:1', chance: 0.7, at: 'dawnFood2', kind: 'insect', model: 'moth', scale: 1.4 }),
  column('woodAnts', { window: [60, 200], after: 'dawn:1', until: 'dusk:2', visitor: 'formica', species: 'formica', name: 'Red wood ants', ants: [['formica_worker', 7], ['formica_soldier', 2]], enter: 'evEast', path: 'woodColHollow', exit: 'evSouth', label: 'the wood ant column', say: 'woodAnts' }),
  heat('hotDay', { window: [120, 240], after: 'dawn:1', until: 'dusk:2', chance: 0.8, s: 90, say: 'heat' }),
  wanderer('mantis', { window: [40, 160], after: 'dawn:2', until: 'dusk:3', creature: 'mantis', enter: 'evEast', to: 'hollow', r: 70, s: 110, exit: 'evEast', label: 'the mantis', say: 'mantis' }),
  windfall('grasshopper', { window: [150, 260], after: 'dawn:2', until: 'dusk:3', at: 'hollowWest', kind: 'insect', model: 'grasshopper', scale: 1.8 }),
  wanderer('rove', { window: [120, 220], after: 'dawn:3', until: 'dusk:4', creature: 'rove', enter: 'evSouth', to: 'dawnFood2', r: 60, s: 100, exit: 'evWest', label: 'the rove beetle', say: 'rove' }),
  windfall('seeds', { window: [40, 140], after: 'dawn:3', until: 'dusk:4', at: 'hollow', kind: 'seed', model: '', scale: 1.1, n: 10, spread: 30, say: 'seeds' }),
);

/**
 * Chapter 1, level 2 — "The Long Nights" (claude/story/04-spec-chapter1-four-levels.md §2; map
 * src/maps/story/stonyHollow.ts). The colony has spread to the stony hollow where the meadow meets the river woods.
 * Days are calm: build, gather, prepare. Each night the island's night hunters come out of their lairs in the banks, in
 * bigger waves; on the fourth night a Mexican red-knee tarantula digs into the nest (digging titans:
 * claude/creatures/01-spec-digging-titans.md). Survive four nights. No enemy ant species; reward: medals only.
 *
 * Clock (`dayNight`): a first day of 7 min, nights of 3½ min (the last, with its titan, 4½ min), days of 5½ min between,
 * dusk warnings 30 s before; four nights (claude/story/06-spec §7: it ran 23 minutes; now about 38). The days have their
 * surprise events. The waves' counts scale with the difficulty (`wave`), their health with the level's `hp` and
 * the difficulty's enemy stat; the tarantula with the difficulty's enemy stat (story bosses, director.ts).
 */
export const LONG_NIGHTS_LEVEL: StoryLevelDef = {
  id: 'longNights',
  chapter: 1,
  number: 2,
  title: 'The Long Nights',
  region: 'meadow',
  map: 'stonyHollow',
  brief: 'The colony has spread to a stony hollow at the edge of the river woods. By day, build and gather. By night the hunters come out of their lairs in the banks, more each time. Survive four nights.',
  player: { site: 0, startWorkers: 8, startFood: 240, name: 'Termants' },
  rivals: {},
  creatures: 0,
  aphids: 0,
  plants: 6,
  reward: {},
  loadout: true,
  dayNight: { first: 420, day: 330, night: 210, lastNight: 270, dusk: 30, fade: 30, nights: 4 },
  lairs: [
    { name: 'Beetle den', at: 'lairNW', food: 30 },
    { name: 'Centipede crevice', at: 'lairN', food: 30 },
    { name: 'Spider hole', at: 'lairE', food: 30 },
    { name: 'Rove beetle den', at: 'lairSE', food: 30 },
    { name: 'Tarantula burrow', at: 'tarantulaBurrow', food: 50, look: 'burrow' },
  ],
  actors: {
    duskBeetle: { creature: 'groundBeetle', at: 'lairN', spawn: 'action', passive: true, hp: 0.6, label: 'a ground beetle' },
    // each night's hunters come in two packs, one up each ramp to the terrace (they hold the ramp tops till dawn)
    night1n: { creatures: [['groundBeetle', 2]], from: ['lairNW'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, label: 'the first night’s hunters' },
    night1e: { creatures: [['groundBeetle', 1], ['rove', 1]], from: ['lairSE'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, label: 'the first night’s hunters' },
    eyes: { creatures: [['wolfSpider', 2]], from: ['lairN', 'lairE'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, passive: true, label: 'the wolf spiders' },
    night2n: { creatures: [['lithobius', 1], ['groundBeetle', 1]], from: ['lairN', 'lairNW'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, label: 'the second night’s hunters' },
    night2e: { creatures: [['lithobius', 1], ['groundBeetle', 1]], from: ['lairE'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, label: 'the second night’s hunters' },
    night3n: { creatures: [['groundBeetle', 1], ['wolfSpider', 1], ['lithobius', 1]], from: ['lairNW', 'lairN'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, label: 'the third night’s hunters' },
    night3e: { creatures: [['rove', 1], ['wolfSpider', 1], ['groundBeetle', 1]], from: ['lairE', 'lairSE'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, label: 'the third night’s hunters' },
    // (the last night's packs are the third night's again: the tarantula is the last night's weight; with a fourth pack
    // member the bot lost Hard and Brutal at human pace, 2026-11-03)
    night4n: { creatures: [['groundBeetle', 1], ['wolfSpider', 1], ['lithobius', 1]], from: ['lairNW', 'lairN'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, label: 'the fourth night’s hunters' },
    night4e: { creatures: [['wolfSpider', 1], ['lithobius', 1], ['groundBeetle', 1]], from: ['lairE', 'lairSE'], face: 'playerNest', spawn: 'action', wave: true, hp: 0.3, label: 'the fourth night’s hunters' },
    // (0.7 → 0.6 with the fourth night, 2026-11-03: at a person's pace the bot lost Hard and Brutal to it on the last night)
    // (inside the nest, until dawn: softer on the queen as the difficulty's armies are thinner by the last night —
    // claude/story/05-spec §3; softer still on Hard and Brutal since the fourth night, 2026-11-06: a person-paced
    // colony lost its queen to it a minute before the last dawn)
    tarantula: { creature: 'tarantula', at: 'tarantulaBurrow', face: 'knollFoot', spawn: 'action', hp: 0.6, phases: [0.5], label: 'the red-knee tarantula', inside: { bite: { easy: 0.85, normal: 0.85, hard: 0.7, brutal: 0.65 }, queenBite: { easy: 0.4, normal: 0.5, hard: 0.4, brutal: 0.4 } } },
    ...EV.actors,
  },
  surprises: EV.surprises,
  visitors: EV.visitors,
  stages: [
    {
      name: 'The first day',
      objectives: [
        { type: 'surviveNight', n: 1 },
        { type: 'collectFood', amount: 150, optional: true },
        { type: 'build', tile: 'food', n: 3, optional: true, text: 'Build 3 food store tiles' },
      ],
      say: [
        { key: 'intro1', at: 0.5 },
        { key: 'intro2', at: 7 },
        { key: 'hollow', at: 45 },
        { key: 'lairs', at: 120 },
        { key: 'dusk1', on: 'dusk:1' },
        { key: 'beetle', on: 'beetleSeen' },
        { key: 'night1', on: 'night:1' },
        { key: 'closeUp', on: 'closeUp' },
      ],
      events: [
        { actions: [{ do: 'shot', shot: 'flight' }, { do: 'music', mood: 'calm' }] },
        { at: 2, actions: [{ do: 'food', at: 'dawnFood', kind: 'insect', from: 'grasshopper', scale: 1.8 }] },
        { at: 2, actions: [{ do: 'food', at: 'hollowWest', kind: 'seed', from: '', scale: 1.1, n: 10, spread: 26 }] },
        { at: 30, actions: [{ do: 'tip', key: 'nights' }] },
        { on: 'dusk:1', actions: [{ do: 'spawn', actor: 'duskBeetle' }, { do: 'music', mood: 'tense' }, { do: 'tip', key: 'dusk' }] },
        { on: 'beetleSeen', actions: [{ do: 'shot', shot: { keys: [{ at: { actor: 'duskBeetle' }, dist: 140, yaw: 0.7, t: 0 }, { at: { actor: 'duskBeetle' }, dist: 120, yaw: 1.1, t: 5 }] } }] },
        { on: 'night:1', actions: [{ do: 'spawn', actor: 'night1n' }, { do: 'spawn', actor: 'night1e' }, { do: 'music', mood: 'swarm' }] },
      ],
      scenes: [
        // the first sign: a ground beetle crosses the hollow at dusk, then goes to ground in the far den
        { actor: 'duskBeetle', on: 'dusk:1', cues: [{ wait: 3 }, { flag: 'beetleSeen' }, { path: 'duskCrossing', speed: 0.6 }, { leave: 'lairNW' }] },
        { actor: 'night1n', on: 'night:1', cues: [{ charge: 'rampNorthTop', timeout: 90 }, { flag: 'closeUp' }, { guard: 'rampNorthTop', r: 80 }] },
        { actor: 'night1e', on: 'night:1', cues: [{ charge: 'rampEastTop', timeout: 90 }, { guard: 'rampEastTop', r: 80 }] },
      ],
    },
    {
      name: 'The second day',
      objectives: [
        { type: 'surviveNight', n: 2 },
        { type: 'fighters', n: 10, optional: true },
        { type: 'storeFood', amount: 200, optional: true },
      ],
      say: [
        { key: 'dawn1', at: 1 },
        { key: 'day2', at: 50 },
        { key: 'dusk2', on: 'dusk:2' },
        { key: 'eyes', on: 'eyesSeen' },
        { key: 'night2', on: 'night:2' },
        { key: 'centipede', on: 'centipedes' },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'calm' }, { do: 'food', at: 'dawnFood', kind: 'insect', from: 'cricket', scale: 1.7 }] },
        { at: 3, actions: [{ do: 'food', at: 'dawnFood2', kind: 'insect', from: 'moth', scale: 1.5 }] },
        { on: 'dusk:2', actions: [{ do: 'spawn', actor: 'eyes' }, { do: 'music', mood: 'tense' }, { do: 'tip', key: 'dusk' }] },
        { on: 'eyesSeen', actions: [{ do: 'shot', shot: { keys: [{ at: 'lairN', dist: 150, yaw: 2.9, t: 0, pitch: -0.15 }, { at: 'lairE', dist: 160, yaw: 2.4, t: 5, pitch: -0.15 }] } }] },
        { on: 'night:2', actions: [{ do: 'spawn', actor: 'night2n' }, { do: 'spawn', actor: 'night2e' }, { do: 'music', mood: 'swarm' }] },
      ],
      scenes: [
        // dawn: the first night's hunters go back to their dens
        { actor: 'night1n', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
        { actor: 'night1e', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
        // dusk: eyes at the lair mouths, watching the terrace, then the wave
        { actor: 'eyes', on: 'dusk:2', cues: [{ face: 'playerNest' }, { flag: 'eyesSeen' }, { waitFlag: 'night:2', timeout: 40 }, { mode: 'normal' }, { charge: 'rampEastTop', timeout: 90 }, { guard: 'rampEastTop', r: 80 }] },
        { actor: 'night2n', on: 'night:2', cues: [{ wait: 8 }, { flag: 'centipedes' }, { charge: 'rampNorthTop', timeout: 90 }, { guard: 'rampNorthTop', r: 80 }] },
        { actor: 'night2e', on: 'night:2', cues: [{ wait: 8 }, { charge: 'rampEastTop', timeout: 90 }, { guard: 'rampEastTop', r: 80 }] },
      ],
    },
    {
      name: 'The third day',
      objectives: [
        { type: 'surviveNight', n: 3 },
        { type: 'upgrade', n: 1, optional: true, text: 'Upgrade a chamber' },
      ],
      say: [
        { key: 'dawn2', at: 1 },
        { key: 'unease', at: 70 },
        { key: 'dusk3', on: 'dusk:3' },
        { key: 'night3', on: 'night:3' },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'calm' }, { do: 'food', at: 'dawnFood', kind: 'insect', from: 'beetle', scale: 1.9 }] },
        { at: 3, actions: [{ do: 'food', at: 'dawnFood2', kind: 'insect', from: 'grasshopper', scale: 1.6 }] },
        { on: 'dusk:3', actions: [{ do: 'music', mood: 'tense' }, { do: 'tip', key: 'dusk' }] },
        { on: 'night:3', actions: [{ do: 'spawn', actor: 'night3n' }, { do: 'spawn', actor: 'night3e' }, { do: 'music', mood: 'swarm' }] },
      ],
      scenes: [
        { actor: 'eyes', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
        { actor: 'night2n', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
        { actor: 'night2e', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
        { actor: 'night3n', on: 'night:3', cues: [{ charge: 'rampNorthTop', timeout: 90 }, { guard: 'rampNorthTop', r: 80 }] },
        { actor: 'night3e', on: 'night:3', cues: [{ charge: 'rampEastTop', timeout: 90 }, { guard: 'rampEastTop', r: 80 }] },
      ],
    },
    {
      name: 'The fourth day',
      objectives: [
        { type: 'surviveNight', n: 4 },
        { type: 'fighters', n: 18, optional: true },
      ],
      say: [
        { key: 'dawn3', at: 1 },
        { key: 'day4', at: 80 },
        { key: 'dusk4', on: 'dusk:4' },
        { key: 'night4', on: 'night:4' },
        { key: 'tarantula1', on: 'tarantulaOut' },
        { key: 'tarantula2', on: 'tarantulaDigs' },
        { key: 'tarantulaIn', on: 'tarantulaIn' },
        { key: 'tarantulaHurt', on: 'hp:tarantula:50' },
        { key: 'tarantulaDead', on: 'killed:tarantula' },
      ],
      events: [
        { actions: [{ do: 'music', mood: 'calm' }, { do: 'food', at: 'dawnFood', kind: 'insect', from: 'cricket', scale: 1.9 }] },
        { at: 3, actions: [{ do: 'food', at: 'dawnFood2', kind: 'insect', from: 'moth', scale: 1.6 }] },
        { on: 'dusk:4', actions: [{ do: 'music', mood: 'tense' }, { do: 'tip', key: 'dusk' }] },
        { on: 'night:4', actions: [{ do: 'spawn', actor: 'night4n' }, { do: 'spawn', actor: 'night4e' }, { do: 'music', mood: 'swarm' }] },
        { on: 'tarantulaOut', actions: [{ do: 'music', mood: 'assault' }, { do: 'shot', shot: { keys: [{ at: { actor: 'tarantula' }, dist: 260, yaw: 0.6, t: 0 }, { at: { actor: 'tarantula' }, dist: 240, yaw: 0.9, t: 6 }] } }] },
        { on: 'tarantulaDigs', actions: [{ do: 'tip', key: 'titanDig' }] },
      ],
      scenes: [
        { actor: 'night3n', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
        { actor: 'night3e', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
        { actor: 'night4n', on: 'night:4', cues: [{ charge: 'rampNorthTop', timeout: 90 }, { guard: 'rampNorthTop', r: 80 }] },
        { actor: 'night4e', on: 'night:4', cues: [{ charge: 'rampEastTop', timeout: 90 }, { guard: 'rampEastTop', r: 80 }] },
        // the titan of the last night: out of its burrow on the knoll 40 s into the night (4 until 2026-11-06: in the
        // fourth night's worn colony it killed the queen seconds before dawn on Brutal), down to the hollow without stopping to fight (an
        // army on its way slows it, never stops it: claude/story/05-spec), then into the nest — every time (it can't die
        // before it is in; the dig can't be stalled); in the nest it fights what it meets until dawn
        {
          actor: 'tarantula',
          on: 'night:4',
          cues: [{ face: 'knollFoot' }, { wait: 40 }, { flag: 'tarantulaOut' }, { mode: 'passive' }, { path: 'tarantulaWay', speed: 1.6, timeout: 100 }, { mode: 'aggressive' }, { flag: 'tarantulaDigs' }, { digInto: 'player', flag: 'tarantulaIn' }, { release: true }],
        },
      ],
    },
  ],
  // dawn after the last night: the hunters go home and the tarantula climbs out and back to its knoll ("keep playing")
  events: [{ on: 'dawn:4', actions: [{ do: 'endRaid', actor: 'tarantula' }, { do: 'music', mood: 'calm' }] }],
  scenes: [
    { actor: 'night4n', on: 'dawn:4', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
    { actor: 'night4e', on: 'dawn:4', cues: [{ mode: 'passive' }, { leave: 'nest' }] },
    { actor: 'tarantula', on: 'dawn:4', cues: [{ mode: 'passive' }, { leave: 'tarantulaBurrow' }] },
    ...EV.scenes,
  ],
  medals: {
    food: [360, 200],
    losses: [60, 130],
    bonus: { type: 'killBefore', actor: 'tarantula', flag: 'dawn:4', text: 'Kill the tarantula before dawn' },
  },
  win: 'win',
  lose: 'lose',
};
