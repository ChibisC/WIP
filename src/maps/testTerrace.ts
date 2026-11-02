import type { MapDef } from './types';

/**
 * A small layered map for tests and tools (not offered in menus): a terrace one level up across the north, a hollow
 * one level down in the south-east, a wide soil ramp and a narrow root ramp up the terrace, a moss ramp down into the
 * hollow. 480 × 480 mm.
 */
export const TEST_TERRACE: MapDef = {
  id: 'testTerrace',
  name: 'Test Terrace',
  blurb: 'A small test map: a terrace, a hollow and three ramps.',
  biome: 'meadow',
  style: 'meadow',
  width: 480,
  depth: 480,
  hexR: 8,
  relief: { amp: 1.5, scale: 160 },
  brushes: [],
  water: [],
  walkways: [],
  walls: [],
  layers: [
    { shape: { poly: [[-40, -40], [520, -40], [520, 190], [330, 210], [180, 196], [-40, 200]] }, level: 1, edge: 'soilBank' },
    { shape: { ellipse: [380, 380], rx: 70, ry: 60 }, level: -1, edge: 'clayCut' },
  ],
  ramps: [
    { path: [[120, 330], [125, 260], [130, 160]], width: 46, style: 'soilSlope' },
    { path: [[440, 300], [430, 240], [420, 150]], width: 40, style: 'rootRamp' },
    { path: [[250, 380], [292, 382], [350, 380]], width: 42, style: 'mossBank' },
  ],
  sites: [
    { at: [80, 420], entrances: [[80, 392], [52, 436], [108, 436]] },
    { at: [260, 80], entrances: [[260, 112], [232, 64], [288, 64]] },
  ],
  siteSets: { 2: [[0, 1]], 3: [], 4: [], 10: [[0, 1]] },
  zones: [
    { kind: 'food', shape: { circle: [240, 300], r: 40 } },
    { kind: 'food', shape: { circle: [380, 385], r: 30 } },
  ],
  floods: [],
};
