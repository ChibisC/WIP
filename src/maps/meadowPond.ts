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
    { kind: 'pond', shape: { poly: [
        [1041.7, 800], [1040.4, 831.6], [1031.4, 862], [1018.6, 890.5], [1001.3, 916.2], [978.9, 937.3],
        [955.2, 955.2], [933.9, 974.5], [913.4, 996.3], [888.8, 1014.3], [859.3, 1021.4], [828.7, 1018.3],
        [800, 1011.3], [773.2, 1003.6], [748.3, 993.1], [725.9, 978.8], [705, 964.6], [682.6, 953],
        [658.9, 941.1], [638, 924.3], [621.8, 902.9], [606.1, 880.3], [587.2, 857], [568.5, 830.5],
        [558.3, 800], [559.6, 768.4], [568.6, 738], [581.4, 709.5], [598.7, 683.8], [621.1, 662.7],
        [644.8, 644.8], [666.1, 625.5], [686.6, 603.7], [711.2, 585.7], [740.7, 578.6], [771.3, 581.7],
        [800, 588.7], [826.8, 596.4], [851.7, 606.9], [874.1, 621.2], [895, 635.4], [917.4, 647],
        [941.1, 658.9], [962, 675.7], [978.2, 697.1], [993.9, 719.7], [1012.8, 743], [1031.5, 769.5],
      ] }, level: -2, depth: 12, bed: 60 },
    { kind: 'stream', shape: { path: [
        [700, 700], [650, 650], [602, 618], [528, 566], [458, 486], [392, 412],
        [344, 338],
      ], width: 40 }, level: -2, depth: 5, bed: 14 },
    { kind: 'stream', shape: { path: [
        [900, 900], [950, 950], [998, 982], [1072, 1034], [1142, 1114], [1208, 1188],
        [1256, 1262],
      ], width: 40 }, level: -2, depth: 5, bed: 14 },
  ],
  walkways: [
    { kind: 'stone', shape: { path: [
        [534.6, 503.7], [465.4, 564.3],
      ], width: 32 } },
    { kind: 'stone', shape: { path: [
        [1065.4, 1096.3], [1134.6, 1035.7],
      ], width: 32 } },
  ],
  walls: [
    { kind: 'rock', shape: { poly: [
        [1416.6, 1144.5], [1391.8, 1148.8], [1372.7, 1152.3], [1349.6, 1144.2], [1321.5, 1134.1], [1320.3, 1116.8],
        [1330.6, 1107], [1339.2, 1094.3], [1365.6, 1096.1], [1385.9, 1111.6], [1398, 1125.4],
      ] }, height: 31 },
    { kind: 'rock', shape: { poly: [
        [183.4, 455.5], [208.2, 451.2], [227.3, 447.7], [250.4, 455.8], [278.5, 465.9], [279.7, 483.2],
        [269.4, 493], [260.8, 505.7], [234.4, 503.9], [214.1, 488.4], [202, 474.6],
      ] }, height: 31 },
    { kind: 'rock', shape: { poly: [
        [269.2, 1102.5], [265.4, 1119.5], [260.7, 1134.4], [248.5, 1151.6], [228.3, 1155], [216.9, 1146.3],
        [203, 1139.8], [205.3, 1122.9], [217.1, 1106.1], [236.5, 1105.3], [257.1, 1091.6],
      ] }, height: 27 },
    { kind: 'rock', shape: { poly: [
        [1330.8, 497.5], [1334.6, 480.5], [1339.3, 465.6], [1351.5, 448.4], [1371.7, 445], [1383.1, 453.7],
        [1397, 460.2], [1394.7, 477.1], [1382.9, 493.9], [1363.5, 494.7], [1342.9, 508.4],
      ] }, height: 27 },
    { kind: 'rock', shape: { poly: [
        [853.8, 164.7], [841.6, 175.9], [817.4, 180.2], [792.3, 178.1], [764.9, 174.3], [745.3, 162.3],
        [767, 152.7], [768.1, 139.9], [794.5, 136.2], [821.9, 142.1], [833.2, 153.6],
      ] }, height: 29 },
    { kind: 'rock', shape: { poly: [
        [746.2, 1435.3], [758.4, 1424.1], [782.6, 1419.8], [807.7, 1421.9], [835.1, 1425.7], [854.7, 1437.7],
        [833, 1447.3], [831.9, 1460.1], [805.5, 1463.8], [778.1, 1457.9], [766.8, 1446.4],
      ] }, height: 29 },
    { kind: 'stone', shape: { poly: [
        [1277.5, 820.5], [1267.5, 817.3], [1257.3, 809], [1254.3, 793.6], [1258.8, 782.9], [1267.2, 776.6],
        [1278.2, 784.6], [1280.9, 799.1], [1288.4, 816.4],
      ] }, height: 11 },
    { kind: 'stone', shape: { poly: [
        [322.5, 779.5], [332.5, 782.7], [342.7, 791], [345.7, 806.4], [341.2, 817.1], [332.8, 823.4],
        [321.8, 815.4], [319.1, 800.9], [311.6, 783.6],
      ] }, height: 11 },
    { kind: 'stone', shape: { poly: [
        [119.8, 534.1], [106.3, 546.1], [92.5, 553.5], [71.4, 561.2], [63.7, 549.1], [57.8, 539],
        [68.8, 527.9], [87.7, 523.4], [104.2, 526.5],
      ] }, height: 13 },
    { kind: 'stone', shape: { poly: [
        [1480.2, 1065.9], [1493.7, 1053.9], [1507.5, 1046.5], [1528.6, 1038.8], [1536.3, 1050.9], [1542.2, 1061],
        [1531.2, 1072.1], [1512.3, 1076.6], [1495.8, 1073.5],
      ] }, height: 13 },
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
