import type { MapDef } from '../types';

/**
 * Story map, chapter 1 level 2 — "The Long Nights" (claude/story/04-spec-chapter1-four-levels.md §2). A stony hollow
 * where the garden meadow meets the river woods, the night hunters' country. Three levels:
 *  - level 1 (south-west): the player's terrace, a soil bank all round, two ramps down into the hollow (a soil slope
 *    east, a moss bank north) — the two ways in for whatever comes at night;
 *  - level 0 (the middle): the hollow itself — moss, stones, roots and the day's food (dead insects, seeds); the
 *    hunters' lairs open at the foot of the banks round it (dens under the rim: underground areas, sim/areas.ts);
 *  - level 1 (north and east): the stony rim of the woods, a rock ledge, with a root ramp and a soil slope down;
 *  - level 2 (north-east): a rocky knoll on the rim, where the red-knee tarantula has its burrow (a ramp down to the rim).
 * No water and no fallen leaves (user rule). 1100 × 900 mm.
 */
export const STONY_HOLLOW: MapDef = {
  id: 'stonyHollow',
  name: 'The Long Nights',
  blurb: 'A stony hollow at the edge of the river woods: a terrace for the nest, the hollow below, and lairs in the banks.',
  biome: 'forest',
  style: 'forest',
  width: 1100,
  depth: 900,
  hexR: 8,
  relief: { amp: 2, scale: 150 },
  brushes: [
    // the hollow sags a little toward its middle
    { shape: { ellipse: [640, 500], rx: 220, ry: 170 }, amount: -2.5, falloff: 90 },
  ],
  water: [],
  walkways: [],
  walls: [
    { kind: 'rock', shape: { ellipse: [520, 400], rx: 30, ry: 22, rot: 0.5 }, height: 26 },
    { kind: 'stone', shape: { ellipse: [720, 560], rx: 22, ry: 16, rot: -0.3 }, height: 14 },
    { kind: 'rock', shape: { ellipse: [790, 330], rx: 26, ry: 20, rot: 1.1 }, height: 22 },
    { kind: 'stone', shape: { ellipse: [600, 760], rx: 18, ry: 14 }, height: 12 },
    { kind: 'log', shape: { path: [[150, 70], [420, 100]], width: 22 }, height: 18 },
    { kind: 'rock', shape: { ellipse: [700, 70], rx: 34, ry: 24, rot: 0.2 }, height: 30 },
  ],
  layers: [
    // the rim of the woods (north and east): a stony ledge round the hollow
    {
      shape: {
        poly: [
          [-60, -60],
          [1160, -60],
          [1160, 960],
          [980, 960],
          [960, 820],
          [985, 640],
          [950, 470],
          [975, 300],
          [930, 200],
          [760, 170],
          [600, 190],
          [440, 160],
          [280, 185],
          [120, 160],
          [-60, 190],
        ],
      },
      level: 1,
      edge: 'rockLedge',
    },
    // the player's terrace (south-west)
    {
      shape: {
        poly: [
          [-60, 540],
          [150, 520],
          [330, 540],
          [420, 600],
          [440, 720],
          [420, 960],
          [-60, 960],
        ],
      },
      level: 1,
      edge: 'soilBank',
    },
    // the tarantula's knoll on the rim
    { shape: { ellipse: [1010, 100], rx: 110, ry: 72 }, level: 2, edge: 'rockLedge' },
  ],
  ramps: [
    // terrace ↔ hollow: a soil slope east and a moss bank north
    { path: [[540, 690], [470, 692], [396, 696]], width: 46, style: 'soilSlope' },
    { path: [[210, 430], [212, 500], [216, 584]], width: 44, style: 'mossBank' },
    // hollow ↔ rim: a root ramp north and a soil slope east
    { path: [[600, 290], [601, 225], [602, 136]], width: 44, style: 'rootRamp' },
    { path: [[850, 600], [930, 600], [1030, 600]], width: 46, style: 'soilSlope' },
    // rim ↔ the knoll
    { path: [[860, 150], [910, 128], [960, 112]], width: 40, style: 'rootRamp' },
  ],
  sites: [{ at: [190, 740], entrances: [[214, 720], [166, 718], [190, 768]] }],
  siteSets: { 2: [], 3: [], 4: [], 10: [[0]] },
  zones: [
    { kind: 'food', shape: { circle: [560, 520], r: 70 } },
    { kind: 'food', shape: { circle: [700, 380], r: 55 } },
    { kind: 'food', shape: { circle: [400, 380], r: 50 } },
    { kind: 'food', shape: { circle: [760, 760], r: 55 } },
    { kind: 'food', shape: { circle: [300, 840], r: 40 } },
    { kind: 'plant', shape: { circle: [90, 620], r: 50 } },
    { kind: 'plant', shape: { ellipse: [640, 500], rx: 200, ry: 150 } },
    { kind: 'plant', shape: { circle: [500, 80], r: 70 } },
    { kind: 'noSpawn', shape: { circle: [190, 740], r: 80 } },
  ],
  floods: [],
  story: {
    points: {
      playerNest: [190, 740],
      playerGate: [214, 720],
      hollow: [620, 520],
      hollowWest: [420, 520],
      lairNW: [300, 240],
      lairN: [760, 236],
      lairE: [890, 420],
      lairSE: [890, 780],
      rampEastFoot: [560, 690],
      rampEastTop: [380, 700],
      rampNorthFoot: [210, 410],
      rampNorthTop: [216, 600],
      rootFoot: [600, 300],
      rootTop: [602, 130],
      tarantulaBurrow: [1035, 92],
      knollFoot: [850, 152],
      dawnFood: [600, 470],
      dawnFood2: [480, 620],
    },
    paths: {
      // a ground beetle crosses the hollow at dusk, the first sign of the night
      duskCrossing: [
        [760, 250],
        [690, 360],
        [600, 460],
        [480, 520],
        [380, 470],
        [310, 260],
      ],
      // the tarantula leaves its burrow and comes down off the knoll, along the rim, down the root ramp and across the hollow
      tarantulaWay: [
        [1035, 100],
        [950, 112],
        [860, 150],
        [740, 132],
        [602, 132],
        [601, 230],
        [600, 320],
        [570, 470],
        [560, 640],
        [520, 692],
      ],
    },
    zones: {
      hollowZone: { ellipse: [620, 520], rx: 180, ry: 130 },
    },
    flight: [
      { at: [1010, 110], dist: 330, yaw: 0.9, t: 0, pitch: 0.1 },
      { at: [620, 480], dist: 420, yaw: 0.5, t: 4.5 },
      { at: [200, 730], dist: 220, yaw: 0.3, t: 9.5, pitch: -0.05 },
    ],
  },
};
