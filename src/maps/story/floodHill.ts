import type { MapDef } from '../types';

/**
 * Story map, chapter 1 level 6 — "High Water" (claude/story/06-spec-levels-5-7-and-lengths.md §4). A hill in the
 * river's flood plain, the only high ground for a long way: the summit (level 2, the colony's nest), a terrace round
 * it (level 1, one black garden ant colony), the hill's foot (level 0, a colony on the west side and one on a raised
 * shelf on the east, 14 mm higher), and the low flood plain along the river (level −1, the best food). The river rises in
 * stages (four flood zones, each a level higher, story-driven only): the plain, the hill's foot, the east shelf, the
 * terrace; the summit never floods. 1200 × 1000 mm.
 */
export const FLOOD_HILL: MapDef = {
  id: 'floodHill',
  name: 'High Water',
  blurb: 'A hill in the river’s flood plain: the summit, a terrace, the hill’s foot and the low plain, three garden ant nests below the summit.',
  biome: 'riverbank',
  style: 'riverbank',
  width: 1200,
  depth: 1000,
  hexR: 8,
  relief: { amp: 2, scale: 180 },
  brushes: [
    // the east colony's shelf: a little higher than the rest of the hill's foot (it floods one stage later)
    { shape: { circle: [1030, 470], r: 120 }, amount: 14, falloff: 50 },
  ],
  water: [
    {
      kind: 'stream',
      shape: { path: [[-60, 975], [400, 960], [800, 975], [1260, 962]], width: 110 },
      level: -37,
      depth: 6,
      bed: 26,
    },
  ],
  walkways: [],
  walls: [
    { kind: 'rock', shape: { ellipse: [700, 300], rx: 26, ry: 18, rot: 0.3 }, height: 22 },
    { kind: 'stone', shape: { ellipse: [300, 600], rx: 18, ry: 13, rot: 0.8 }, height: 10 },
    { kind: 'stone', shape: { ellipse: [880, 660], rx: 16, ry: 12 }, height: 9 },
    { kind: 'log', shape: { path: [[480, 880], [640, 850]], width: 30 }, height: 28 },
    { kind: 'rock', shape: { ellipse: [120, 250], rx: 30, ry: 22 }, height: 24 },
    { kind: 'rock', shape: { ellipse: [1120, 230], rx: 28, ry: 20, rot: -0.4 }, height: 24 },
  ],
  layers: [
    // the low flood plain along the river
    { shape: { poly: [[-60, 790], [300, 770], [600, 790], [900, 765], [1260, 780], [1260, 1060], [-60, 1060]] }, level: -1, edge: 'clayCut' },
    // the terrace round the summit
    { shape: { ellipse: [600, 430], rx: 310, ry: 270 }, level: 1, edge: 'soilBank' },
    // the summit
    { shape: { ellipse: [620, 345], rx: 150, ry: 118 }, level: 2, edge: 'rockLedge' },
  ],
  ramps: [
    // the plain ↔ the hill's foot (south-west, south-east)
    { path: [[300, 860], [302, 805], [305, 730]], width: 50, style: 'soilSlope' },
    { path: [[900, 850], [898, 795], [895, 720]], width: 50, style: 'soilSlope' },
    // the foot ↔ the terrace (west, east, south)
    { path: [[230, 430], [270, 432], [330, 436]], width: 48, style: 'mossBank' },
    { path: [[975, 420], [935, 424], [870, 428]], width: 48, style: 'soilSlope' },
    { path: [[700, 760], [698, 715], [692, 650]], width: 52, style: 'rootRamp' },
    // the terrace ↔ the summit (west, south-east)
    { path: [[396, 386], [450, 374], [506, 362]], width: 46, style: 'stoneSteps' },
    { path: [[730, 540], [712, 500], [690, 445]], width: 46, style: 'rootRamp' },
  ],
  sites: [
    { at: [620, 330], entrances: [[644, 312], [596, 310], [620, 358]] },
    { at: [160, 470], entrances: [[184, 452], [136, 450], [160, 498]] },
    { at: [1040, 470], entrances: [[1016, 452], [1064, 450], [1040, 498]] },
    { at: [470, 560], entrances: [[494, 542], [446, 540], [470, 588]] },
  ],
  siteSets: { 2: [], 3: [], 4: [[0, 1, 2, 3]], 10: [[0, 1, 2, 3]] },
  zones: [
    // the best food is down on the plain; little up on the summit
    { kind: 'food', shape: { circle: [200, 880], r: 70 } },
    { kind: 'food', shape: { circle: [600, 900], r: 80 } },
    { kind: 'food', shape: { circle: [1000, 880], r: 70 } },
    { kind: 'food', shape: { circle: [140, 650], r: 50 } },
    { kind: 'food', shape: { circle: [1060, 650], r: 50 } },
    { kind: 'food', shape: { circle: [800, 600], r: 45 } },
    { kind: 'aphid', shape: { circle: [400, 880], r: 40 } },
    { kind: 'aphid', shape: { circle: [820, 880], r: 40 } },
    { kind: 'plant', shape: { ellipse: [600, 880], rx: 500, ry: 80 } },
    { kind: 'plant', shape: { circle: [600, 520], r: 140 } },
    { kind: 'noSpawn', shape: { circle: [620, 330], r: 80 } },
    { kind: 'noSpawn', shape: { circle: [160, 470], r: 70 } },
    { kind: 'noSpawn', shape: { circle: [1040, 470], r: 70 } },
    { kind: 'noSpawn', shape: { circle: [470, 560], r: 70 } },
  ],
  floods: [
    // the river rises in stages (story-driven only; it never drains): the plain, the hill's foot, the east shelf, the terrace
    { shape: { poly: [[-60, -60], [1260, -60], [1260, 1060], [-60, 1060]] }, level: -22, first: [99999, 99999], every: [99999, 99999], hold: [1e7, 1e7] },
    { shape: { poly: [[-60, -60], [1260, -60], [1260, 1060], [-60, 1060]] }, level: 8, first: [99999, 99999], every: [99999, 99999], hold: [1e7, 1e7] },
    { shape: { poly: [[-60, -60], [1260, -60], [1260, 1060], [-60, 1060]] }, level: 25, first: [99999, 99999], every: [99999, 99999], hold: [1e7, 1e7] },
    { shape: { poly: [[-60, -60], [1260, -60], [1260, 1060], [-60, 1060]] }, level: 46, first: [99999, 99999], every: [99999, 99999], hold: [1e7, 1e7] },
  ],
  story: {
    points: {
      playerNest: [620, 330],
      summitWest: [470, 365],
      summitSouth: [700, 470],
      lasiusA: [160, 470],
      lasiusB: [1040, 470],
      lasiusC: [470, 560],
      footWest: [230, 430],
      footEast: [975, 420],
      terraceSouth: [692, 650],
      plainWest: [250, 880],
      plainMid: [600, 900],
      plainEast: [950, 880],
      evWest: [14, 640],
      evEast: [1186, 640],
    },
    paths: {
      plainCross: [[120, 880], [400, 905], [700, 895], [1000, 880], [1120, 760]],
    },
    zones: {},
    flight: [
      { at: [600, 920], dist: 380, yaw: 0.1, t: 0, pitch: 0.05 },
      { at: [1040, 470], dist: 260, yaw: 1.2, t: 4.5 },
      { at: [620, 340], dist: 240, yaw: 0.5, t: 10 },
    ],
  },
};
