// @ts-nocheck
/**
 * Nasute termite morphs for the ant pipeline (nasuteBuilder.ts; CHANGE_PLAN §22.7). Keys are the sim's caste morphs
 * (`termite_worker`, `termite_nasute`, `termite_major`), so the game routes them to the ant renderer; the king, the
 * queen and the sickle-jaw castes stay on the termite kit. Proportions are fractions of the body length L, from the
 * user's study photos (docs/creatures/nasutitermes.md §11). Colours: live animals on soil, moss and wood.
 */
// (round 3 review of the first renders against the photos: the live workers are golden amber, not cream; the gut
// shows dark brown through the abdomen; the head a deeper glossy amber)
// (the lab's daylight brightens vertex colours a lot: these are set about a quarter darker than the photos read)
const WORKER_COLORS = {
  head: 0xb47830, headTop: 0xc48a3e, headUnder: 0x9a6628, clypeus: 0xbc8640, labrum: 0xb07a3a, suture: 0x7a4c1e,
  mand: 0x5a2e12, mandTip: 0x1e0e04,
  thorax: 0xc48e48, thoraxTop: 0xb07a38, pronotum: 0xb47c3a,
  abd: 0xcc9448, abdTop: 0xbc8440, abdUnder: 0xdcb070, tergRear: 0x9c6a30, membrane: 0xdcb67a, gut: 0x24100a,
  leg: 0xbc8c50, legLight: 0xc89a5c, legBase: 0xac7a40, claw: 0x6a4a26, antenna: 0xae7c3e, antennaTip: 0xbc8c50,
  hair: 0xd8c08a, seta: 0xd2b880, nasusTip: 0x8a4a22,
};
const SOLDIER_COLORS = {
  ...WORKER_COLORS,
  // the glassy pear head: dark red-brown to black, the nasus tip lighter and translucent
  head: 0x2e1208, headTop: 0x4a1e0e, headUnder: 0x1e0c06, nasusTip: 0x8c4a22, mand: 0x3a1a0c, mandTip: 0x1a0a04,
  thorax: 0xb8722e, thoraxTop: 0xa4642a, pronotum: 0xa8662a,
  abd: 0xc07e38, abdTop: 0xae6c2e, abdUnder: 0xd49c5e, tergRear: 0x925424, membrane: 0xd8aa6a, gut: 0x3a1c0a,
  leg: 0xb8803e, legLight: 0xc89250, legBase: 0xa46c32, antenna: 0xa46c30, antennaTip: 0xb8803e,
};
const MAJOR_COLORS = {
  ...SOLDIER_COLORS,
  head: 0x220c06, headTop: 0x3c160a, headUnder: 0x160804, nasusTip: 0x6e3618,
  thorax: 0xae6a2a, thoraxTop: 0x985c26, pronotum: 0x9c5e26, abd: 0xb87434, abdTop: 0xa4642c, tergRear: 0x864c20,
};
const SURF = {
  head: { rough: 0.34, coat: 0.55, sheen: 0.2 },
  body: { rough: 0.44, coat: 0.35, sheen: 0.35 },
  // soft and waxy, a wet glint on top, light passing through
  abdomen: { rough: 0.36, coat: 0.5, sheen: 0.6 },
  leg: { rough: 0.44, coat: 0.25, sheen: 0.4 },
  mandible: { rough: 0.3, coat: 0.6, sheen: 0.05 },
  hair: { rough: 0.6, coat: 0.1, sheen: 0.2 },
};
const GLASSY = { rough: 0.12, coat: 1, sheen: 0.05 };

const worker = {
  key: 'termite_worker', builder: 'nasute', real: true, L: 4.2, stance: 0.07, soft: 1,
  look: { colors: WORKER_COLORS, ...SURF },
  abdomen: { x0: 0.5, len: 0.5, w: 0.25, h: 0.2, cy: 0.105, full: 0.45, sag: 0.015, groove: 0.05, membrane: 0.55, gut: 0.95, gutLobes: [[0.33, 0.014, 1], [0.5, 0.012, 0.95], [0.66, 0.01, 0.8]] },
  thorax: { meta: 0.075, meso: 0.075, pro: 0.08, w: 0.17, h: 0.11, cy: 0.1, proW: 0.21, proLift: 0.012, saddle: 0.02 },
  head: { len: 0.21, w: 0.24, h: 0.155, tilt: -0.25, neck: 0.02, neckY: 0.012 },
  mandible: { len: 0.09, curve: 1.05, r: 0.014, open: 0.7 },
  antenna: { beads: 14, len: 0.42, r: 0.011, sx: 0.74, sy: 0.12, sz: 0.4, ang: 0.38, splay: 0.5, droop: 0.6 },
  // (first renders: the knees stood high above the back like a harvestman's — the feet set farther out, so the legs
  // splay sideways with the knees about level with the back, as in the photos)
  legs: {
    thick: 0.013,
    pairs: [
      { coxaDir: [0.03, -0.03, 0.035], femur: 0.2, tibia: 0.2, tarsus: 0.1, foot: [0.27, 0.36] },
      { coxaDir: [0.0, -0.03, 0.04], femur: 0.2, tibia: 0.2, tarsus: 0.1, foot: [0.02, 0.42] },
      { coxaDir: [-0.03, -0.03, 0.035], femur: 0.22, tibia: 0.22, tarsus: 0.11, foot: [-0.29, 0.38] },
    ],
  },
  gait: { lift: 0.3, duty: 0.56 },
};

const soldier = {
  ...worker,
  key: 'termite_nasute', L: 5, stance: 0.075,
  look: { colors: SOLDIER_COLORS, ...SURF, head: GLASSY },
  abdomen: { x0: 0.42, len: 0.42, w: 0.19, h: 0.17, cy: 0.1, full: 0.45, sag: 0.012, groove: 0.045, membrane: 0.5, gut: 0.55, gutLobes: [[0.36, 0.012, 0.9], [0.55, 0.01, 0.8]] },
  thorax: { meta: 0.07, meso: 0.07, pro: 0.07, w: 0.13, h: 0.12, cy: 0.1, proW: 0.15, proLift: 0.01, saddle: 0.018 },
  // the bulb 0.23 L long and 0.22 L wide, its top 1.2x the thorax height; the nasus 0.16 L, tip radius 0.012 L
  head: { len: 0.23, w: 0.22, h: 0.2, tilt: -0.06, neck: 0.015, neckY: 0.03, nasus: { len: 0.16, r0: 0.035, r1: 0.012, up: 0.12, droop: 0.0 } },
  mandible: { len: 0.03, curve: 0.4, r: 0.01, open: 0.4 },
  antenna: { beads: 13, len: 0.5, r: 0.0105, sx: 0.42, sy: -0.05, sz: 0.42, ang: 0.3, splay: 0.55, droop: 0.55 },
  legs: {
    thick: 0.012,
    pairs: [
      { coxaDir: [0.03, -0.03, 0.035], femur: 0.23, tibia: 0.24, tarsus: 0.12, foot: [0.31, 0.41] },
      { coxaDir: [0.0, -0.03, 0.04], femur: 0.23, tibia: 0.24, tarsus: 0.12, foot: [0.02, 0.48] },
      { coxaDir: [-0.03, -0.03, 0.035], femur: 0.25, tibia: 0.26, tarsus: 0.13, foot: [-0.33, 0.43] },
    ],
  },
};

const major = {
  ...soldier,
  key: 'termite_major', L: 6.5, stance: 0.075,
  look: { colors: MAJOR_COLORS, ...SURF, head: GLASSY },
  abdomen: { ...soldier.abdomen, w: 0.21, h: 0.19, cy: 0.105, gut: 0.5 },
  thorax: { ...soldier.thorax, w: 0.145, h: 0.13, proW: 0.17 },
  // a bigger, darker bulb; the nasus shorter and thicker
  head: { len: 0.27, w: 0.26, h: 0.23, tilt: -0.1, neck: 0.015, neckY: 0.035, nasus: { len: 0.12, r0: 0.05, r1: 0.02, up: 0.08, droop: 0.0 } },
  antenna: { ...soldier.antenna, beads: 14, len: 0.45 },
  legs: {
    thick: 0.0125,
    pairs: [
      { coxaDir: [0.03, -0.03, 0.035], femur: 0.22, tibia: 0.22, tarsus: 0.11, foot: [0.29, 0.38] },
      { coxaDir: [0.0, -0.03, 0.04], femur: 0.22, tibia: 0.22, tarsus: 0.11, foot: [0.02, 0.44] },
      { coxaDir: [-0.03, -0.03, 0.035], femur: 0.24, tibia: 0.24, tarsus: 0.12, foot: [-0.3, 0.4] },
    ],
  },
};

export const NASUTE_MORPHS = { termite_worker: worker, termite_nasute: soldier, termite_major: major };
/** Termite castes drawn by the ant renderer (the rest stay on the termite kit). */
export const NASUTE_ANT_PATH = new Set(Object.keys(NASUTE_MORPHS));
