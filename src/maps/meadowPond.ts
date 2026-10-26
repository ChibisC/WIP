import type { MapDef } from './types';

/**
 * Meadow Pond (docs/maps/design.md §9): sunny grassland round a central pond with lily pads and
 * reeds. A stream leaves the pond to the north-west and another to the south-east, each ending
 * short of the map edge and each crossed by flat stones. Ten sites in point-symmetric pairs (an
 * outer ring of six, an inner ring of four on the pond's free sides); rich food and aphid-laden
 * flower stems on the pond's east and west banks; rocks break the outer meadow into lanes; spider
 * lairs in the long grass to the north and south. Storms flood the low grass round the pond.
 *
 * Coordinates were computed once (point-symmetric about the centre) and are stored as plain numbers,
 * so every client builds byte-identical terrain.
 */
export const MEADOW_POND: MapDef = {
  id: 'meadowPond',
  name: 'Meadow Pond',
  blurb: 'Sunny grassland round a lily pond. Two streams with stone crossings; aphid-rich flowers on the banks; storms flood the low grass.',
  biome: 'meadow',
  style: 'meadow',
  width: 1600,
  depth: 1600,
  hexR: 8,
  relief: { amp: 4, scale: 240 },
  brushes: [
    // the pond sits in a shallow hollow (the low grass storms flood)
    { shape: { circle: [800, 800], r: 250 }, amount: -3, falloff: 140 },
  ],
  water: [
    { kind: 'pond', shape: { poly: [[1029.7, 832.3], [978, 918.8], [900.7, 970.5], [818.8, 1021.2], [714.2, 1025.2], [646.8, 945.1], [613.3, 859.6], [570.3, 767.7], [622, 681.2], [699.3, 629.5], [781.2, 578.8], [885.8, 574.8], [953.2, 654.9], [986.7, 740.4]] }, level: -2, depth: 12, bed: 60 },
    { kind: 'stream', shape: { path: [[668, 668], [602, 618], [528, 566], [458, 486], [392, 412], [344, 338]], width: 40 }, level: -2, depth: 5, bed: 14 },
    { kind: 'stream', shape: { path: [[932, 932], [998, 982], [1072, 1034], [1142, 1114], [1208, 1188], [1256, 1262]], width: 40 }, level: -2, depth: 5, bed: 14 },
  ],
  walkways: [
    { kind: 'stone', shape: { path: [[534.6, 503.7], [465.4, 564.3]], width: 32 } },
    { kind: 'stone', shape: { path: [[1065.4, 1096.3], [1134.6, 1035.7]], width: 32 } },
  ],
  walls: [
    { kind: 'rock', shape: { circle: [1362.9, 1125], r: 34 }, height: 31 },
    { kind: 'rock', shape: { circle: [237.1, 1125], r: 30 }, height: 27 },
    { kind: 'rock', shape: { circle: [800, 160], r: 32 }, height: 29 },
    { kind: 'rock', shape: { circle: [237.1, 475], r: 34 }, height: 31 },
    { kind: 'rock', shape: { circle: [1362.9, 475], r: 30 }, height: 27 },
    { kind: 'rock', shape: { circle: [800, 1440], r: 32 }, height: 29 },
    { kind: 'stone', shape: { circle: [1270, 800], r: 18 }, height: 11 },
    { kind: 'stone', shape: { circle: [85.8, 540.1], r: 22 }, height: 13 },
    { kind: 'stone', shape: { circle: [330, 800], r: 18 }, height: 11 },
    { kind: 'stone', shape: { circle: [1514.2, 1059.9], r: 22 }, height: 13 },
  ],
  sites: [
    { at: [1400, 800], entrances: [[1378, 800]] }, // 0
    { at: [200, 800], entrances: [[222, 800]] }, // 1
    { at: [1100, 1319.6], entrances: [[1089, 1300.5]] }, // 2
    { at: [500, 280.4], entrances: [[511, 299.5]] }, // 3
    { at: [500, 1319.6], entrances: [[511, 1300.5]] }, // 4
    { at: [1100, 280.4], entrances: [[1089, 299.5]] }, // 5
    { at: [800, 420], entrances: [[800, 442]] }, // 6
    { at: [800, 1180], entrances: [[800, 1158]] }, // 7
    { at: [1068.7, 531.3], entrances: [[1053.1, 546.9]] }, // 8
    { at: [531.3, 1068.7], entrances: [[546.9, 1053.1]] }, // 9
  ],
  siteSets: {
    2: [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]],
    3: [[1, 2, 5], [0, 3, 4]],
    4: [[2, 3, 4, 5]],
    10: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
  },
  zones: [
    { kind: 'food', shape: { circle: [1130, 800], r: 75 }, weight: 2, name: 'east bank' },
    { kind: 'food', shape: { circle: [470, 800], r: 75 }, weight: 2, name: 'west bank' },
    { kind: 'food', shape: { circle: [800, 240], r: 60 } },
    { kind: 'food', shape: { circle: [800, 1360], r: 60 } },
    { kind: 'food', shape: { circle: [1285, 520], r: 60 } },
    { kind: 'food', shape: { circle: [315, 1080], r: 60 } },
    { kind: 'food', shape: { circle: [315, 520], r: 60 } },
    { kind: 'food', shape: { circle: [1285, 1080], r: 60 } },
    { kind: 'aphid', shape: { circle: [1085.3, 892.7], r: 45 }, name: 'east flowers' },
    { kind: 'aphid', shape: { circle: [514.7, 707.3], r: 45 }, name: 'west flowers' },
    { kind: 'plant', shape: { circle: [1035.0, 1207.1], r: 50 } },
    { kind: 'plant', shape: { circle: [565.0, 392.9], r: 50 } },
    { kind: 'plant', shape: { circle: [565.0, 1207.1], r: 50 } },
    { kind: 'plant', shape: { circle: [1035.0, 392.9], r: 50 } },
    { kind: 'lair', shape: { circle: [618.8, 1476.1], r: 35 }, name: 'south burrow' },
    { kind: 'lair', shape: { circle: [981.2, 123.9], r: 35 }, name: 'north burrow' },
    // wild creatures come out of the long grass along the edges
    { kind: 'creature', shape: { poly: [[0, 0], [1600, 0], [1600, 90], [0, 90]] } },
    { kind: 'creature', shape: { poly: [[0, 1510], [1600, 1510], [1600, 1600], [0, 1600]] } },
    { kind: 'creature', shape: { poly: [[0, 0], [90, 0], [90, 1600], [0, 1600]] } },
    { kind: 'creature', shape: { poly: [[1510, 0], [1600, 0], [1600, 1600], [1510, 1600]] } },
  ],
  floods: [
    // storms flood the low grass round the pond (never the sites: the inner ring stands 380 mm out)
    { shape: { circle: [800, 800], r: 310 }, level: 0.5, first: [540, 780], every: [600, 960], hold: [40, 90] },
  ],
};
