import type { MapDef } from './types';

/**
 * A small map for tests and tools (not offered in menus): a pond with a stone walkway across,
 * a log wall, four sites in the corners and food, aphid and lair zones. 720 × 720 mm.
 */
export const TEST_POND: MapDef = {
  id: 'testPond',
  name: 'Test Pond',
  blurb: 'A small test map: a pond, a walkway, a log and four sites.',
  biome: 'meadow',
  style: 'meadow',
  width: 720,
  depth: 720,
  hexR: 8,
  relief: { amp: 3, scale: 160 },
  brushes: [{ shape: { circle: [140, 140], r: 60 }, amount: 3, falloff: 60 }],
  water: [
    {
      kind: 'pond',
      shape: {
        poly: [
          [300, 250],
          [400, 238],
          [470, 290],
          [478, 380],
          [430, 460],
          [340, 470],
          [272, 410],
          [262, 320],
        ],
      },
      level: -1.5,
      depth: 9,
      bed: 40,
    },
  ],
  walkways: [{ kind: 'stone', shape: { path: [[230, 360], [510, 350]], width: 30 } }],
  walls: [{ kind: 'log', shape: { path: [[500, 420], [570, 520]], width: 26 }, height: 22 }],
  sites: [
    { at: [110, 110], entrances: [[110, 78]] },
    { at: [610, 110], entrances: [[610, 78]] },
    { at: [110, 610], entrances: [[110, 578]] },
    { at: [610, 610], entrances: [[578, 610]] },
  ],
  siteSets: { 2: [[0, 3], [1, 2]], 3: [[0, 1, 2]], 4: [[0, 1, 2, 3]], 10: [[0, 1, 2, 3]] },
  zones: [
    { kind: 'food', shape: { circle: [360, 150], r: 70 } },
    { kind: 'food', shape: { circle: [360, 580], r: 70 } },
    { kind: 'aphid', shape: { circle: [200, 360], r: 40 } },
    { kind: 'plant', shape: { circle: [560, 300], r: 50 } },
    { kind: 'lair', shape: { circle: [600, 360], r: 35 } },
  ],
  floods: [
    {
      shape: { ellipse: [370, 360], rx: 175, ry: 165 },
      level: 1.2,
      first: [120, 160],
      every: [200, 260],
      hold: [30, 40],
    },
  ],
};
