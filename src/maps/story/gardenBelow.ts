import type { MapDef } from '../types';

/**
 * Story map, chapter 1 level 1 — "The Garden Below" (claude/story/03-spec-story-level-maps.md §1). The edge of a garden
 * meadow on Wayfarer Island, the morning after a storm. Three levels:
 *  - level 0 (south-west, low and wet): the storm puddle and its muddy margin, where the queen is washed ashore, and
 *    the player's start on a small dry rise beside it;
 *  - level 1 (most of the map): the meadow — grass, clover, food, a few rocks, the first-contact ground; two ramps
 *    up from the start (a soil slope east, a moss bank north);
 *  - level 2 (north-east): the raised flowerbed with the black garden ants' nest under a flat stone and their aphid
 *    plants; a wide ramp of stone steps facing the meadow (defended) and a narrow soil ramp at the far east end (the
 *    flank to discover).
 * 1100 × 900 mm. Points, paths and zones the level script uses are in `story`.
 */
export const GARDEN_BELOW: MapDef = {
  id: 'gardenBelow',
  name: 'The Garden Below',
  blurb: 'A garden meadow after the storm: a puddle, the meadow, and a raised flowerbed held by black garden ants.',
  biome: 'meadow',
  style: 'meadow',
  width: 1100,
  depth: 900,
  hexR: 8,
  relief: { amp: 2, scale: 170 },
  brushes: [
    // the small dry rise the queen digs into
    { shape: { circle: [340, 640], r: 55 }, amount: 3, falloff: 40 },
    // a gentle swell in the meadow
    { shape: { ellipse: [700, 520], rx: 140, ry: 90 }, amount: 3, falloff: 80 },
  ],
  water: [
    {
      kind: 'puddle',
      shape: {
        poly: [
          [70, 770],
          [120, 735],
          [190, 728],
          [250, 748],
          [282, 790],
          [262, 838],
          [200, 866],
          [120, 862],
          [72, 828],
        ],
      },
      level: -1.2,
      depth: 6,
      bed: 26,
    },
  ],
  walkways: [],
  walls: [
    // the flat stone the Lasius nest lies under, and paving stones along the bed's foot
    { kind: 'stone', shape: { ellipse: [985, 95], rx: 46, ry: 30, rot: 0.3 }, height: 12 },
    { kind: 'stone', shape: { poly: [[700, 418], [758, 410], [762, 446], [704, 452]] }, height: 9 },
    { kind: 'stone', shape: { poly: [[820, 440], [880, 436], [884, 470], [822, 474]] }, height: 9 },
    // meadow rocks
    { kind: 'rock', shape: { ellipse: [430, 330], rx: 34, ry: 24, rot: 0.5 }, height: 26 },
    { kind: 'rock', shape: { ellipse: [820, 640], rx: 28, ry: 20, rot: -0.3 }, height: 22 },
    { kind: 'rock', shape: { ellipse: [250, 250], rx: 30, ry: 26 }, height: 24 },
  ],
  layers: [
    // the meadow: everything but the low south-west
    {
      shape: {
        poly: [
          [-60, -60],
          [1160, -60],
          [1160, 960],
          [490, 960],
          [478, 860],
          [505, 760],
          [470, 650],
          [395, 562],
          [270, 520],
          [130, 535],
          [-60, 515],
        ],
      },
      level: 1,
      edge: 'soilBank',
    },
    // the raised flowerbed
    {
      shape: {
        poly: [
          [560, -60],
          [1160, -60],
          [1160, 405],
          [1040, 398],
          [930, 385],
          [800, 360],
          [690, 318],
          [612, 250],
          [575, 150],
          [565, 40],
        ],
      },
      level: 2,
      edge: 'soilBank',
    },
  ],
  ramps: [
    // from the start: a soil slope east and a moss bank north
    { path: [[400, 704], [470, 702], [575, 690]], width: 48, style: 'soilSlope' },
    { path: [[262, 640], [255, 560], [246, 450]], width: 46, style: 'mossBank' },
    // up the flowerbed: wide stone steps facing the meadow, a narrow soil ramp at the far east end
    { path: [[545, 485], [592, 412], [652, 318], [690, 262]], width: 60, style: 'stoneSteps' },
    { path: [[1045, 560], [1040, 470], [1036, 330]], width: 42, style: 'soilSlope' },
  ],
  sites: [
    { at: [340, 640], entrances: [[362, 620], [312, 626], [346, 668]] },
    { at: [880, 170], entrances: [[858, 190], [908, 184], [874, 140]] },
  ],
  siteSets: { 2: [[0, 1]], 3: [], 4: [], 10: [[0, 1]] },
  zones: [
    { kind: 'food', shape: { circle: [430, 800], r: 45 } },
    { kind: 'food', shape: { circle: [620, 600], r: 70 } },
    { kind: 'food', shape: { circle: [470, 420], r: 60 } },
    { kind: 'food', shape: { circle: [880, 570], r: 60 } },
    { kind: 'aphid', shape: { circle: [760, 235], r: 36 } },
    { kind: 'aphid', shape: { circle: [1010, 290], r: 36 } },
    { kind: 'plant', shape: { circle: [780, 240], r: 60 } },
    { kind: 'plant', shape: { circle: [1000, 300], r: 60 } },
    { kind: 'plant', shape: { ellipse: [600, 500], rx: 220, ry: 140 } },
    { kind: 'noSpawn', shape: { circle: [340, 640], r: 70 } },
  ],
  floods: [],
  story: {
    points: {
      queenShore: [300, 708],
      queenGate: [362, 620],
      beetleStart: [40, 690],
      beetleStop: [222, 712],
      beetleExit: [10, 600],
      scoutTop: [720, 270],
      scoutStop: [585, 640],
      aphidPlants: [760, 235],
      aphidPlants2: [1010, 290],
      fruit: [640, 575],
      backRamp: [1045, 520],
      stoneSteps: [560, 470],
      lasiusNest: [880, 170],
      playerNest: [340, 640],
      meadow: [620, 450],
    },
    paths: {
      scoutsDown: [
        [700, 270],
        [652, 318],
        [592, 412],
        [548, 482],
        [565, 570],
        [585, 640],
      ],
      cutwormLoop: [
        [600, 535],
        [690, 540],
        [700, 615],
        [610, 625],
      ],
    },
    zones: {
      meadowSouth: { ellipse: [700, 700], rx: 140, ry: 80 },
    },
    flight: [
      { at: [880, 170], dist: 360, yaw: 0.95, t: 0, pitch: 0.1 },
      { at: [640, 430], dist: 440, yaw: 0.55, t: 4.5 },
      { at: [300, 700], dist: 150, yaw: 0.25, t: 9.5, pitch: -0.05 },
    ],
  },
};
