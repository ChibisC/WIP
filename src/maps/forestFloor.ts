import type { MapDef } from './types';

/**
 * Forest Floor (docs/maps/design.md §9): a dim woodland floor. A trickling stream runs in an S
 * across the middle third with three root-mat crossings; fallen logs and rocks make lanes and
 * chokepoints; mushroom clusters; leaf-litter hollows hold spider and beetle lairs and flood after
 * rain. Ten sites in point-symmetric pairs.
 *
 * Coordinates were computed once (point-symmetric about the centre) and are stored as plain numbers,
 * so every client builds byte-identical terrain.
 */
export const FOREST_FLOOR: MapDef = {
  id: 'forestFloor',
  name: 'Forest Floor',
  blurb: 'Dim woodland floor. Fallen logs and rocks make lanes and chokepoints; a trickle crossed by root mats; spiders and beetles in leaf-litter hollows that flood after rain.',
  biome: 'forest',
  style: 'forest',
  width: 1600,
  depth: 1600,
  hexR: 8,
  relief: { amp: 7, scale: 200 },
  brushes: [
    // two leaf-litter hollows
    { shape: { circle: [1000, 920], r: 90 }, amount: -6, falloff: 70 },
    { shape: { circle: [600, 680], r: 90 }, amount: -6, falloff: 70 },
  ],
  water: [
    { kind: 'stream', shape: { path: [
        [216, 1148], [314, 1112], [404, 1066], [476, 1002], [552, 932], [638, 882],
        [720, 848], [800, 800], [880, 752], [962, 718], [1048, 668], [1124, 598],
        [1196, 534], [1286, 488], [1384, 452],
      ], width: 30 }, level: -2, depth: 4, bed: 10 },
  ],
  walkways: [
    { kind: 'rootMat', shape: { path: [
        [827.6, 827.8], [788.4, 762.6],
      ], width: 32 } },
    { kind: 'rootMat', shape: { path: [
        [1185.2, 594.4], [1134.8, 537.6],
      ], width: 32 } },
    { kind: 'rootMat', shape: { path: [
        [414.8, 1005.6], [465.2, 1062.4],
      ], width: 32 } },
  ],
  walls: [
    { kind: 'log', shape: { path: [
        [270, 590], [530, 476],
      ], width: 54 }, height: 54 },
    { kind: 'log', shape: { path: [
        [1330, 1010], [1070, 1124],
      ], width: 54 }, height: 54 },
    { kind: 'log', shape: { path: [
        [920, 250], [1130, 300],
      ], width: 40 }, height: 40 },
    { kind: 'log', shape: { path: [
        [680, 1350], [470, 1300],
      ], width: 40 }, height: 40 },
    { kind: 'log', shape: { path: [
        [1250, 760], [1330, 960],
      ], width: 36 }, height: 36 },
    { kind: 'log', shape: { path: [
        [350, 840], [270, 640],
      ], width: 36 }, height: 36 },
    { kind: 'rock', shape: { poly: [
        [403.9, 655.9], [382.6, 660.3], [366.1, 663.9], [346.5, 657], [322.6, 648.4], [321.9, 632.8],
        [331, 623.6], [338.6, 611.9], [361.2, 612.9], [378.3, 626.6], [388.4, 638.9],
      ] }, height: 27 },
    { kind: 'rock', shape: { poly: [
        [1196.1, 944.1], [1217.4, 939.7], [1233.9, 936.1], [1253.5, 943], [1277.4, 951.6], [1278.1, 967.2],
        [1269, 976.4], [1261.4, 988.1], [1238.8, 987.1], [1221.7, 973.4], [1211.6, 961.1],
      ] }, height: 27 },
    { kind: 'rock', shape: { poly: [
        [1090, 332.4], [1084.8, 347.1], [1079.7, 359.6], [1067.7, 373], [1049.9, 375.7], [1041.1, 366.4],
        [1029.7, 359.8], [1032.8, 345.5], [1043.9, 331.6], [1061, 332.7], [1079.5, 322.8],
      ] }, height: 23 },
    { kind: 'rock', shape: { poly: [
        [510, 1267.6], [515.2, 1252.9], [520.3, 1240.4], [532.3, 1227], [550.1, 1224.3], [558.9, 1233.6],
        [570.3, 1240.2], [567.2, 1254.5], [556.1, 1268.4], [539, 1267.3], [520.5, 1277.2],
      ] }, height: 23 },
    { kind: 'rock', shape: { poly: [
        [1100.3, 934.5], [1087.5, 929.1], [1076.1, 920.2], [1068, 906.1], [1058.8, 889.5], [1061.5, 877],
        [1073.6, 881.6], [1082.1, 877.1], [1094.4, 889.8], [1100.2, 906.4], [1098.2, 917.2],
      ] }, height: 20 },
    { kind: 'rock', shape: { poly: [
        [499.7, 665.5], [512.5, 670.9], [523.9, 679.8], [532, 693.9], [541.2, 710.5], [538.5, 723],
        [526.4, 718.4], [517.9, 722.9], [505.6, 710.2], [499.8, 693.6], [501.8, 682.8],
      ] }, height: 20 },
    { kind: 'mushrooms', shape: { circle: [587.9, 217.4], r: 16 }, height: 46 },
    { kind: 'mushrooms', shape: { circle: [1012.1, 1382.6], r: 16 }, height: 46 },
    { kind: 'mushrooms', shape: { circle: [714.5, 1034.9], r: 14 }, height: 46 },
    { kind: 'mushrooms', shape: { circle: [885.5, 565.1], r: 14 }, height: 46 },
  ],
  sites: [
    { at: [694.1, 199.3], entrances: [[697.9, 221]] }, // 0
    { at: [905.9, 1400.7], entrances: [[902.1, 1379]] }, // 1
    { at: [1400.7, 905.9], entrances: [[1379, 902.1]] }, // 2
    { at: [199.3, 694.1], entrances: [[221, 697.9]] }, // 3
    { at: [271.7, 495], entrances: [[290.8, 506]] }, // 4
    { at: [1328.3, 1105], entrances: [[1309.2, 1094]] }, // 5
    { at: [980, 1111.8], entrances: [[969, 1092.7]] }, // 6
    { at: [620, 488.2], entrances: [[631, 507.3]] }, // 7
    { at: [593.5, 1094.9], entrances: [[606.1, 1076.9]] }, // 8
    { at: [1006.5, 505.1], entrances: [[993.9, 523.1]] }, // 9
  ],
  siteSets: {
    2: [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]],
    3: [[1, 2, 5], [0, 3, 4]],
    4: [[2, 3, 4, 5]],
    10: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
  },
  zones: [
    { kind: 'food', shape: { circle: [976.8, 623.2], r: 60 }, weight: 2, name: 'fallen fruit' },
    { kind: 'food', shape: { circle: [623.2, 976.8], r: 60 }, weight: 2, name: 'fallen fruit' },
    { kind: 'food', shape: { circle: [536.2, 423.2], r: 55 } },
    { kind: 'food', shape: { circle: [1063.8, 1176.8], r: 55 } },
    { kind: 'food', shape: { circle: [1457.8, 560.6], r: 50 } },
    { kind: 'food', shape: { circle: [142.2, 1039.4], r: 50 } },
    { kind: 'aphid', shape: { circle: [713.2, 1292.4], r: 40 }, name: 'seedlings' },
    { kind: 'aphid', shape: { circle: [886.8, 307.6], r: 40 }, name: 'seedlings' },
    { kind: 'plant', shape: { circle: [921.6, 346], r: 45 } },
    { kind: 'plant', shape: { circle: [678.4, 1254], r: 45 } },
    { kind: 'lair', shape: { circle: [1000, 920], r: 35 }, name: 'spider hollow' },
    { kind: 'lair', shape: { circle: [600, 680], r: 35 }, name: 'beetle hollow' },
    { kind: 'litter', shape: { circle: [1000, 920], r: 110 } },
    { kind: 'litter', shape: { circle: [600, 680], r: 110 } },
    { kind: 'litter', shape: { circle: [1120, 245.7], r: 90 } },
    { kind: 'litter', shape: { circle: [480, 1354.3], r: 90 } },
    // wild creatures come out of the undergrowth along the edges
    { kind: 'creature', shape: { poly: [
        [0, 0], [1600, 0], [1600, 90], [0, 90],
      ] } },
    { kind: 'creature', shape: { poly: [
        [0, 1510], [1600, 1510], [1600, 1600], [0, 1600],
      ] } },
    { kind: 'creature', shape: { poly: [
        [0, 0], [90, 0], [90, 1600], [0, 1600],
      ] } },
    { kind: 'creature', shape: { poly: [
        [1510, 0], [1600, 0], [1600, 1600], [1510, 1600],
      ] } },
  ],
  floods: [
    // rain fills the two hollows
    { shape: { circle: [1000, 920], r: 100 }, level: -3.5, first: [420, 660], every: [540, 900], hold: [40, 80] },
    { shape: { circle: [600, 680], r: 100 }, level: -3.5, first: [420, 660], every: [540, 900], hold: [40, 80] },
  ],
};
