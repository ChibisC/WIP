import type { MapDef } from '../types';

/**
 * Story map, chapter 1 level 7 — "Carton Kingdom" (claude/story/06-spec-levels-5-7-and-lengths.md §5). The edge of the
 * island's rainforest: two giant trunks whose buttress roots split the floor into lanes, wet ground, a sunken hollow
 * of puddles that fill in showers (a flood zone, story-driven), and on a raised shelf between the roots two allied
 * conehead termite colonies (Nasutitermes corniger) with their carton nests. The colony comes in from the forest's edge
 * in the south-west. No fallen-leaf dressing on the ground (user rule). Three levels:
 *  - level 1, north-east: the termites' shelf between the big trunks' roots;
 *  - level 0: the forest floor;
 *  - level −1, the middle: the hollow of puddles.
 * 1200 × 1000 mm.
 */
export const RAINFOREST_EDGE: MapDef = {
  id: 'rainforestEdge',
  name: 'Carton Kingdom',
  blurb: 'The rainforest’s edge: buttress roots, a hollow of rain puddles, and two conehead termite nests on a shelf between the trunks.',
  biome: 'rainforest',
  style: 'forest',
  width: 1200,
  depth: 1000,
  hexR: 8,
  relief: { amp: 3, scale: 150 },
  brushes: [],
  water: [
    { kind: 'puddle', shape: { ellipse: [560, 560], rx: 40, ry: 26 }, level: -36, depth: 4, bed: 14 },
    { kind: 'puddle', shape: { ellipse: [680, 640], rx: 30, ry: 20 }, level: -36, depth: 4, bed: 12 },
  ],
  walkways: [],
  walls: [
    // two giant trunks and their buttress roots
    { kind: 'trunk', shape: { circle: [760, 170], r: 85 }, height: 260 },
    { kind: 'buttress', shape: { path: [[760, 170], [640, 320]], width: 22 }, height: 60 },
    { kind: 'buttress', shape: { path: [[760, 170], [900, 330]], width: 22 }, height: 60 },
    { kind: 'buttress', shape: { path: [[760, 170], [600, 120]], width: 20 }, height: 55 },
    { kind: 'trunk', shape: { circle: [240, 230], r: 70 }, height: 240 },
    { kind: 'buttress', shape: { path: [[240, 230], [360, 360]], width: 20 }, height: 55 },
    { kind: 'buttress', shape: { path: [[240, 230], [110, 380]], width: 20 }, height: 50 },
    { kind: 'buttress', shape: { path: [[240, 230], [400, 180]], width: 18 }, height: 50 },
    { kind: 'log', shape: { path: [[850, 900], [1060, 875]], width: 40 }, height: 40 },
    { kind: 'mushrooms', shape: { circle: [420, 720], r: 14 }, height: 42 },
    { kind: 'stone', shape: { ellipse: [980, 640], rx: 16, ry: 12 }, height: 9 },
  ],
  layers: [
    // the termites' shelf between the trunks' roots (north-east)
    { shape: { poly: [[820, -60], [1260, -60], [1260, 640], [1120, 680], [960, 600], [900, 420], [840, 300]] }, level: 1, edge: 'rootWall' },
    // the hollow of puddles in the middle
    { shape: { ellipse: [600, 590], rx: 210, ry: 140 }, level: -1, edge: 'clayCut' },
  ],
  ramps: [
    // the shelf: a root ramp west, a soil slope south
    { path: [[780, 380], [835, 372], [895, 365]], width: 50, style: 'rootRamp' },
    { path: [[1020, 760], [1030, 700], [1040, 625]], width: 54, style: 'soilSlope' },
    // the hollow: in from the west, out to the east
    { path: [[330, 590], [370, 592], [420, 594]], width: 48, style: 'mossBank' },
    { path: [[875, 600], [822, 602], [768, 604]], width: 48, style: 'mossBank' },
  ],
  sites: [
    { at: [220, 820], entrances: [[244, 802], [196, 800], [220, 848]] },
    { at: [1000, 170], entrances: [[976, 190], [1024, 190], [1000, 142]] },
    { at: [1110, 470], entrances: [[1086, 488], [1134, 488], [1110, 444]] },
  ],
  siteSets: { 2: [], 3: [[0, 1, 2]], 4: [], 10: [[0, 1, 2]] },
  // the two termite colonies (allies) on the shelf's sites, the colony at the forest's edge
  teamSets: { '2v1': [[1, 2], [0]] },
  zones: [
    { kind: 'food', shape: { circle: [600, 590], r: 90 } },
    { kind: 'food', shape: { circle: [420, 860], r: 60 } },
    { kind: 'food', shape: { circle: [880, 870], r: 60 } },
    { kind: 'food', shape: { circle: [140, 520], r: 50 } },
    { kind: 'plant', shape: { ellipse: [500, 800], rx: 300, ry: 120 } },
    { kind: 'plant', shape: { circle: [1100, 300], r: 60 } },
    { kind: 'aphid', shape: { circle: [520, 860], r: 40 } },
    { kind: 'litter', shape: { circle: [880, 860], r: 100 } },
    { kind: 'noSpawn', shape: { circle: [220, 820], r: 80 } },
    { kind: 'noSpawn', shape: { circle: [1000, 170], r: 70 } },
    { kind: 'noSpawn', shape: { circle: [1110, 470], r: 70 } },
  ],
  floods: [
    // the hollow fills in a shower (story-driven only)
    { shape: { ellipse: [600, 590], rx: 230, ry: 160 }, level: -22, first: [99999, 99999], every: [99999, 99999], hold: [50, 60] },
  ],
  story: {
    points: {
      playerNest: [220, 820],
      nestApproach: [330, 760],
      termitesNorth: [1000, 170],
      termitesEast: [1110, 470],
      shelfWest: [780, 380],
      shelfSouth: [1020, 760],
      shelfGap: [1030, 330],
      hollow: [600, 590],
      hollowWest: [330, 590],
      evSouth: [700, 986],
      evWest: [14, 640],
    },
    paths: {
      swarmWay: [[120, 660], [300, 700], [480, 780], [640, 900]],
    },
    zones: {},
    flight: [
      { at: [760, 200], dist: 380, yaw: 0.8, t: 0, pitch: 0.12 },
      { at: [1050, 320], dist: 300, yaw: 1.3, t: 5 },
      { at: [230, 810], dist: 220, yaw: 0.4, t: 10.5 },
    ],
  },
};
