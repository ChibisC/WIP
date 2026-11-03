import type { MapDef } from '../types';

/**
 * Story map, chapter 1 level 2 — "Fire on the Banks" (claude/story/03-spec-story-level-maps.md §2). A sunny tropical
 * riverbank on Wayfarer Island. Three levels:
 *  - level 2 (north-east, the high bank): the tropical fire ants' worked-soil mound on open, sunny ground, their
 *    foraging ground and seed patches;
 *  - level 1 (the middle shelf): the player's start at its west end, food and rocks for cover, the main battleground;
 *    two ramps up to the fire ants: a wide sand slope (their main attack route) and a root ramp at the far east end
 *    (the flank for the final assault);
 *  - level 0 (the low margin): mud and sand by the slow river, washed-up food, reeds; it floods when the river rises
 *    (the level's scripted flood: one flood zone, triggered by the story, never by the storm timer).
 * 1200 × 900 mm.
 */
export const FIRE_BANKS: MapDef = {
  id: 'fireBanks',
  name: 'Fire on the Banks',
  blurb: 'A sunny riverbank: a low muddy margin, a middle shelf and the high bank where the fire ants nest.',
  biome: 'riverbank',
  style: 'riverbank',
  width: 1200,
  depth: 900,
  hexR: 8,
  relief: { amp: 2, scale: 180 },
  brushes: [
    { shape: { ellipse: [560, 500], rx: 160, ry: 90 }, amount: 2.5, falloff: 70 },
    { shape: { circle: [930, 150], r: 70 }, amount: 2, falloff: 50 },
  ],
  water: [
    {
      kind: 'stream',
      shape: {
        path: [
          [-60, 862],
          [260, 846],
          [600, 866],
          [900, 850],
          [1260, 866],
        ],
        width: 96,
      },
      level: -2,
      depth: 7,
      bed: 30,
    },
  ],
  walkways: [],
  walls: [
    { kind: 'rock', shape: { ellipse: [420, 400], rx: 34, ry: 24, rot: 0.4 }, height: 28 },
    { kind: 'rock', shape: { ellipse: [780, 600], rx: 30, ry: 22, rot: -0.2 }, height: 24 },
    { kind: 'rock', shape: { ellipse: [1010, 520], rx: 32, ry: 26, rot: 0.8 }, height: 26 },
    { kind: 'rock', shape: { ellipse: [560, 780], rx: 26, ry: 18 }, height: 18 },
  ],
  layers: [
    // the middle shelf: everything above the low margin
    {
      shape: {
        poly: [
          [-60, -60],
          [1260, -60],
          [1260, 702],
          [1100, 690],
          [950, 716],
          [800, 690],
          [650, 706],
          [500, 682],
          [350, 700],
          [200, 684],
          [-60, 700],
        ],
      },
      level: 1,
      edge: 'clayCut',
    },
    // the high bank
    {
      shape: {
        poly: [
          [430, -60],
          [1260, -60],
          [1260, 380],
          [1150, 362],
          [1010, 332],
          [870, 342],
          [730, 318],
          [610, 300],
          [510, 244],
          [452, 140],
        ],
      },
      level: 2,
      edge: 'sandBank',
    },
  ],
  ramps: [
    // margin ↔ shelf
    { path: [[300, 795], [306, 720], [318, 600]], width: 50, style: 'sandSlide' },
    { path: [[880, 795], [888, 720], [900, 604]], width: 48, style: 'soilSlope' },
    // shelf ↔ high bank: the wide sand slope (the fire ants' main route) and the root ramp at the far east end
    { path: [[648, 520], [652, 420], [660, 300], [664, 240]], width: 66, style: 'sandSlide' },
    { path: [[1150, 548], [1144, 450], [1130, 300]], width: 44, style: 'rootRamp' },
  ],
  sites: [
    { at: [170, 450], entrances: [[194, 432], [150, 430], [168, 478]] },
    { at: [930, 150], entrances: [[906, 170], [956, 168], [930, 120]] },
  ],
  siteSets: { 2: [[0, 1]], 3: [], 4: [], 10: [[0, 1]] },
  zones: [
    { kind: 'food', shape: { circle: [500, 520], r: 70 } },
    { kind: 'food', shape: { circle: [800, 500], r: 60 } },
    { kind: 'food', shape: { circle: [650, 760], r: 60 } },
    { kind: 'food', shape: { circle: [760, 185], r: 40 } },
    { kind: 'food', shape: { circle: [1080, 230], r: 40 } },
    { kind: 'plant', shape: { ellipse: [600, 520], rx: 260, ry: 100 } },
    { kind: 'plant', shape: { circle: [760, 185], r: 50 } },
    { kind: 'aphid', shape: { circle: [520, 450], r: 40 } },
    { kind: 'noSpawn', shape: { circle: [170, 450], r: 70 } },
  ],
  floods: [
    // the low margin, flooded only by the story (first and every far beyond any game's length)
    { shape: { poly: [[-60, 690], [1260, 690], [1260, 960], [-60, 960]] }, level: 5, first: [99999, 99999], every: [1186, 886], hold: [45, 55] },
  ],
  story: {
    points: {
      // surprise events (claude/story/06-spec §6): where parties and wanderers come on and go off, windfalls
      evWestMargin: [14, 760],
      evEastMargin: [1186, 760],
      evEastMid: [1186, 560],
      mound: [930, 150],
      seedA: [760, 185],
      seedB: [1080, 230],
      slopeTop: [664, 250],
      slopeFoot: [648, 530],
      rootTop: [1130, 300],
      rootFoot: [1150, 548],
      playerNest: [170, 450],
      playerGate: [196, 430],
      marginWest: [190, 762],
      marginEast: [760, 762],
      fish: [650, 768],
      fleeWest: [318, 600],
      fleeEast: [900, 600],
      river: [600, 784],
      shelf: [500, 520],
    },
    paths: {
      swarmMargin: [[1000, 760], [760, 760], [650, 765], [400, 760], [200, 760]],
      forageTrail: [
        [906, 172],
        [850, 196],
        [790, 188],
        [762, 186],
        [800, 192],
        [860, 190],
        [906, 172],
      ],
    },
    zones: {
      marginWestZone: { ellipse: [180, 762], rx: 70, ry: 26 },
      marginEastZone: { ellipse: [760, 762], rx: 70, ry: 26 },
    },
    flight: [
      { at: [600, 820], dist: 420, yaw: 0.15, t: 0, pitch: 0.05 },
      { at: [900, 170], dist: 300, yaw: 0.85, t: 5 },
      { at: [170, 450], dist: 230, yaw: 0.6, t: 10.5 },
    ],
  },
};
