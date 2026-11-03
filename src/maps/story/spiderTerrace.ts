import type { MapDef } from '../types';

/**
 * Story map, chapter 1 level 4 — "The Spider Mother" (claude/story/04-spec-chapter1-four-levels.md §3). The riverbank's
 * sandy upper terrace, the hunting ground of a Carolina wolf spider mother. Two levels and the river:
 *  - level 1 (most of the map, north): the open terrace of sand and short grass, a few rocks, and in its middle her
 *    burrow — a silk-lined hole with a turret rim (a den under the sand: an underground area, sim/areas.ts);
 *  - level 0 (the south): the lower terrace along the river where the colony has its nest, joined to the hunting ground
 *    by three ramps (a sand slide west, a soil slope in the middle, a root ramp east);
 *  - the slow river along the south edge.
 * 1100 × 900 mm.
 */
export const SPIDER_TERRACE: MapDef = {
  id: 'spiderTerrace',
  name: 'The Spider Mother',
  blurb: 'The sandy upper terrace above the river: a wolf spider’s hunting ground, her burrow in the middle, the nest below.',
  biome: 'riverbank',
  style: 'riverbank',
  width: 1100,
  depth: 900,
  hexR: 8,
  relief: { amp: 2, scale: 190 },
  brushes: [
    // the terrace swells a little round the burrow
    { shape: { circle: [600, 300], r: 120 }, amount: 2, falloff: 80 },
  ],
  water: [
    {
      kind: 'stream',
      shape: {
        path: [
          [-60, 884],
          [300, 870],
          [700, 886],
          [1160, 872],
        ],
        width: 80,
      },
      level: -2,
      depth: 6,
      bed: 26,
    },
  ],
  walkways: [],
  walls: [
    { kind: 'rock', shape: { ellipse: [380, 280], rx: 30, ry: 22, rot: 0.4 }, height: 26 },
    { kind: 'rock', shape: { ellipse: [830, 220], rx: 34, ry: 24, rot: -0.3 }, height: 28 },
    { kind: 'stone', shape: { ellipse: [740, 430], rx: 20, ry: 15, rot: 0.8 }, height: 12 },
    { kind: 'rock', shape: { ellipse: [250, 110], rx: 28, ry: 20 }, height: 22 },
    { kind: 'stone', shape: { ellipse: [460, 760], rx: 18, ry: 13 }, height: 10 },
  ],
  layers: [
    // the hunting ground: everything above the lower terrace
    {
      shape: {
        poly: [
          [-60, -60],
          [1160, -60],
          [1160, 560],
          [980, 600],
          [820, 572],
          [650, 600],
          [480, 576],
          [330, 560],
          [180, 590],
          [-60, 570],
        ],
      },
      level: 1,
      edge: 'sandBank',
    },
  ],
  ramps: [
    { path: [[160, 670], [168, 610], [176, 510]], width: 48, style: 'sandSlide' },
    { path: [[560, 690], [561, 620], [563, 510]], width: 56, style: 'soilSlope' },
    { path: [[900, 700], [905, 630], [912, 520]], width: 44, style: 'rootRamp' },
  ],
  sites: [{ at: [300, 730], entrances: [[324, 712], [276, 710], [300, 758]] }],
  siteSets: { 2: [], 3: [], 4: [], 10: [[0]] },
  zones: [
    { kind: 'food', shape: { circle: [480, 420], r: 60 } },
    { kind: 'food', shape: { circle: [800, 360], r: 60 } },
    { kind: 'food', shape: { circle: [200, 300], r: 50 } },
    { kind: 'food', shape: { circle: [720, 730], r: 50 } },
    { kind: 'food', shape: { circle: [980, 760], r: 40 } },
    { kind: 'plant', shape: { ellipse: [560, 330], rx: 300, ry: 180 } },
    { kind: 'plant', shape: { circle: [760, 740], r: 60 } },
    { kind: 'noSpawn', shape: { circle: [300, 730], r: 80 } },
  ],
  floods: [],
  story: {
    points: {
      playerNest: [300, 730],
      playerGate: [324, 712],
      burrow: [600, 300],
      burrowEdge: [600, 340],
      // the ground she watches the colony from: on the lower terrace, in front of the nest
      nestApproach: [430, 680],
      lookout: [820, 320],
      rampWestTop: [176, 500],
      rampMidTop: [563, 500],
      rampMidFoot: [560, 700],
      rampEastTop: [912, 510],
      river: [600, 815],
      prey: [470, 420],
    },
    paths: {
      // her prowl round the hunting ground
      prowl: [
        [600, 340],
        [760, 290],
        [860, 380],
        [700, 470],
        [480, 470],
        [380, 360],
        [470, 250],
        [600, 300],
      ],
    },
    zones: {
      terrace: { ellipse: [560, 330], rx: 280, ry: 170 },
    },
    flight: [
      { at: [600, 860], dist: 380, yaw: 0.2, t: 0, pitch: 0.05 },
      { at: [600, 300], dist: 260, yaw: 0.75, t: 4.5 },
      { at: [300, 720], dist: 230, yaw: 0.4, t: 10 },
    ],
  },
};
