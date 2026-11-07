import type { MapDef } from '../types';

/**
 * Story map, chapter 1 level 5 — "The Antlered King" (claude/story/06-spec-levels-5-7-and-lengths.md §3). Old oak
 * woodland on the island's western hills: a clearing on the woods floor round a big oak whose bark weeps sap, rotting
 * logs, deep humus and roots. Two levels:
 *  - level 1, south-west: the raised shelf where the colony nests (two ramps down: a bark slab east, a root ramp north);
 *  - level 1, north-east: the old male's knoll round an ancient stump (stag beetle larvae live for years in rotting wood
 *    like it), with a wide soil slope and a root ramp down into the clearing;
 *  - level 0: the woods floor and the clearing between them, with the sap oak in its middle.
 * Stag beetles come and go from the woods at the edges. 1200 × 1000 mm.
 */
export const OAK_WOODS: MapDef = {
  id: 'oakWoods',
  name: 'The Antlered King',
  blurb: 'An old oak wood: a clearing round a sap-weeping oak, rotting logs, a raised shelf for the nest and an ancient stump on a knoll.',
  biome: 'forest',
  style: 'forest',
  width: 1200,
  depth: 1000,
  hexR: 8,
  relief: { amp: 3, scale: 160 },
  brushes: [
    // the clearing dips a little round the oak; the knoll swells toward the stump
    { shape: { circle: [640, 560], r: 160 }, amount: -2, falloff: 90 },
    { shape: { circle: [1010, 190], r: 140 }, amount: 3, falloff: 80 },
  ],
  water: [],
  walkways: [],
  walls: [
    // the ancient stump on the knoll, and the sap oak in the clearing
    { kind: 'trunk', shape: { circle: [1010, 180], r: 72 }, height: 130 },
    { kind: 'trunk', shape: { circle: [660, 420], r: 52 }, height: 220 },
    // rotting logs
    { kind: 'log', shape: { path: [[140, 250], [500, 170]], width: 58 }, height: 58 },
    { kind: 'log', shape: { path: [[640, 780], [880, 860]], width: 46 }, height: 46 },
    { kind: 'log', shape: { path: [[1060, 640], [1150, 860]], width: 40 }, height: 40 },
    { kind: 'mushrooms', shape: { circle: [400, 420], r: 15 }, height: 44 },
    { kind: 'mushrooms', shape: { circle: [930, 560], r: 13 }, height: 40 },
    { kind: 'stone', shape: { ellipse: [820, 640], rx: 18, ry: 13, rot: 0.6 }, height: 10 },
    { kind: 'stone', shape: { ellipse: [140, 920], rx: 16, ry: 12 }, height: 9 },
  ],
  layers: [
    // the colony's shelf (south-west)
    { shape: { poly: [[-60, 640], [140, 625], [300, 600], [420, 655], [470, 780], [455, 900], [430, 1060], [-60, 1060]] }, level: 1, edge: 'soilBank' },
    // the old male's knoll round the stump (north-east)
    { shape: { poly: [[760, -60], [1260, -60], [1260, 420], [1080, 470], [900, 430], [790, 330], [745, 160]] }, level: 1, edge: 'rootWall' },
  ],
  ramps: [
    // the shelf: a bark slab east into the clearing, a root ramp north
    { path: [[540, 700], [480, 712], [400, 728]], width: 52, style: 'barkSlab' },
    { path: [[240, 520], [242, 600], [244, 690]], width: 48, style: 'rootRamp' },
    // the knoll: a wide soil slope (the titan's way) and a root ramp
    { path: [[780, 500], [835, 410], [900, 330]], width: 60, style: 'soilSlope' },
    { path: [[1150, 560], [1152, 470], [1156, 380]], width: 48, style: 'rootRamp' },
  ],
  sites: [{ at: [210, 840], entrances: [[234, 822], [186, 820], [210, 868]] }],
  siteSets: { 2: [], 3: [], 4: [], 10: [[0]] },
  zones: [
    { kind: 'food', shape: { circle: [560, 600], r: 70 } },
    { kind: 'food', shape: { circle: [360, 330], r: 60 } },
    { kind: 'food', shape: { circle: [900, 700], r: 60 } },
    { kind: 'food', shape: { circle: [120, 480], r: 50 } },
    { kind: 'food', shape: { circle: [1100, 300], r: 50 } },
    { kind: 'plant', shape: { ellipse: [600, 600], rx: 330, ry: 220 } },
    { kind: 'plant', shape: { circle: [250, 900], r: 70 } },
    { kind: 'litter', shape: { circle: [380, 360], r: 120 } },
    { kind: 'litter', shape: { circle: [920, 760], r: 120 } },
    { kind: 'noSpawn', shape: { circle: [210, 840], r: 80 } },
  ],
  floods: [],
  story: {
    points: {
      playerNest: [210, 840],
      nestApproach: [370, 760],
      shelfFoot: [560, 700],
      northFoot: [240, 500],
      clearing: [560, 600],
      sapOak: [670, 500],
      sapWest: [610, 520],
      sapEast: [740, 515],
      kingStump: [1000, 290],
      knollFoot: [770, 520],
      knollSlope: [900, 372],
      evNorth: [600, 14],
      evWest: [14, 420],
      evEast: [1186, 700],
      evSouth: [800, 986],
      evNorthEast: [700, 14],
      woodsEast: [1060, 760],
      woodsNorth: [420, 300],
    },
    paths: {
      minorWalk: [[60, 430], [300, 460], [520, 600], [800, 690], [1180, 700]],
      kingWay: [[960, 330], [900, 360], [800, 480], [640, 640], [540, 700], [440, 724]],
    },
    zones: {
      clearingZone: { ellipse: [620, 600], rx: 200, ry: 130 },
    },
    flight: [
      { at: [1010, 220], dist: 360, yaw: 0.9, t: 0, pitch: 0.12 },
      { at: [660, 480], dist: 300, yaw: 0.5, t: 5 },
      { at: [230, 820], dist: 220, yaw: 0.35, t: 10 },
    ],
  },
};
