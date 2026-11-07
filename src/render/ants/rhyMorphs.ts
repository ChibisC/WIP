// @ts-nocheck
/**
 * Sickle-jaw termite morphs (Rhynchotermes perarmatus) for the ant pipeline (nasuteBuilder.ts; model redo,
 * claude/realism/10-spec-saiy-ant-sickle-jaw-models.md). Keys are the sim's caste morphs, so the game routes every
 * sickle-jaw caste to the ant renderer (NASUTE_ANT_PATH); the presoldier and the larva are brood views
 * (antViews.termiteBroodToView). Proportions: fractions of the body length L from the measurements and the traced
 * outlines in docs/creatures/rhynchotermes-perarmatus.md §5 and §10. Colours: the user's photos, set about a quarter
 * darker than the photos read (the lab's daylight lifts vertex colours).
 */
const SURF = {
  head: { rough: 0.3, coat: 0.6, sheen: 0.15 },
  body: { rough: 0.42, coat: 0.35, sheen: 0.3 },
  // soft, waxy, translucent, a wet glint on top
  abdomen: { rough: 0.34, coat: 0.55, sheen: 0.55 },
  leg: { rough: 0.42, coat: 0.3, sheen: 0.35 },
  mandible: { rough: 0.24, coat: 0.7, sheen: 0.04 },
  hair: { rough: 0.6, coat: 0.1, sheen: 0.2 },
};
// the soldier's head: hard, smooth and glassy red
const GLASSY = { rough: 0.1, coat: 1, sheen: 0.04 };

// ---------- the worker: large and lanky, a broad flat chestnut head with a whitish fontanelle; eyeless ----------
const WORKER_COLORS = {
  head: 0xa0522a, headTop: 0xac5c2e, headUnder: 0x8e4822, headBand: 0x7a3e1c, clypeus: 0xbc7a48, labrum: 0xcc9a6a, palp: 0xe6d6b8, suture: 0x7a3e1c, fontanelle: 0xeee2c8,
  mand: 0x7a3a1a, mandTip: 0x261006,
  thorax: 0xe0caa0, thoraxTop: 0xd6bc8e, pronotum: 0xdcc498,
  abd: 0xdcc292, abdTop: 0xd2b682, abdUnder: 0xe8d6b0, tergRear: 0xb8955e, membrane: 0xf0e2c2, gut: 0x2e2414,
  leg: 0xe2cca2, legLight: 0xeadab6, legBase: 0xd6be90, claw: 0x8a6a40, antenna: 0xd8c6a0, antennaTip: 0xe6d8b8,
  hair: 0xf2ead6, seta: 0xf2ead6,
};
const worker = {
  key: 'termite_rhy_worker', builder: 'nasute', real: true, L: 5.8, stance: 0.06, soft: 1.1,
  look: { colors: WORKER_COLORS, ...SURF, head: { rough: 0.36, coat: 0.42, sheen: 0.12 } },
  // a long, low, glassy abdomen (0.63 L), the dark leaf-litter gut showing through most of it
  abdomen: { x0: 0.5, len: 0.6, w: 0.25, h: 0.17, cy: 0.095, full: 0.38, sag: 0.012, groove: 0.04, membrane: 0.55, gut: 1.0, gutLobes: [[0.32, 0.05, 1], [0.55, 0.06, 1], [0.76, 0.03, 0.8]] },
  thorax: { meta: 0.045, meso: 0.045, pro: 0.05, w: 0.14, h: 0.09, cy: 0.09, proW: 0.18, proLift: 0.008, saddle: 0.016 },
  // head 1.57 mm wide, 1.1 long (wider than long), flattened top to bottom, hardly narrowing to the face
  head: { len: 0.19, w: 0.27, h: 0.12, tilt: -0.2, neck: 0.018, neckY: 0.01, flat: 0.62, narrow: 0.18, band: 0, fontanelle: 0.1 },
  mandible: { len: 0.11, curve: 1.1, r: 0.02, open: 0.65 },
  antenna: { beads: 14, len: 0.46, r: 0.0105, sx: 0.42, sy: -0.02, sz: 0.46, ang: 0.38, splay: 0.55, droop: 0.4 },
  // long, slender legs (hind tibia 1.26 mm = 0.22 L)
  legs: {
    thick: 0.0125, sprawl: 0.95,
    pairs: [
      { coxaDir: [0.025, -0.022, 0.03], femur: 0.16, tibia: 0.17, tarsus: 0.085, foot: [0.24, 0.3] },
      { coxaDir: [0.0, -0.022, 0.035], femur: 0.18, tibia: 0.2, tarsus: 0.09, foot: [0.02, 0.36] },
      { coxaDir: [-0.025, -0.022, 0.03], femur: 0.2, tibia: 0.22, tarsus: 0.1, foot: [-0.26, 0.34] },
    ],
  },
  gait: { lift: 0.3, duty: 0.55 },
};

// ---------- the soldier: a glossy red globe drawn into a long down-curved snout, long crossing sickles; eyeless ----------
const SOLDIER_COLORS = {
  ...WORKER_COLORS,
  head: 0xa23a16, headTop: 0xb0421a, headUnder: 0x8a3012, nasusTip: 0x5a1610, pore: 0x2a0806,
  mand: 0x6e1c12, mandTip: 0x200806,
  // the photos' amber-cream body with bold brown tergite bands (species doc §6: #D49E5C, bands #6E3E1E)
  thorax: 0xd4a464, thoraxTop: 0xc89656, pronotum: 0xcc9c5c,
  abd: 0xcc9450, abdTop: 0xbe8644, abdUnder: 0xdcb27a, tergRear: 0x6e3e1e, membrane: 0xf0dcb0, gut: 0x5a4024,
  leg: 0xe0c07c, legLight: 0xe8cc90, legBase: 0xd0aa66, antenna: 0xd4b070, antennaTip: 0xe0c088,
};
const soldier = {
  ...worker,
  key: 'termite_rhy_soldier', L: 4.5, stance: 0.075, soft: 1,
  look: { colors: SOLDIER_COLORS, ...SURF, head: GLASSY, mandible: GLASSY },
  abdomen: { x0: 0.37, len: 0.33, w: 0.18, h: 0.16, cy: 0.1, full: 0.5, sag: 0.01, groove: 0.05, membrane: 0.5, gut: 0.45, gutLobes: [[0.4, 0.016, 0.9], [0.6, 0.012, 0.7]] },
  thorax: { meta: 0.05, meso: 0.05, pro: 0.06, w: 0.12, h: 0.1, cy: 0.1, proW: 0.14, proLift: 0.01, saddle: 0.018 },
  // the capsule 1.05 mm (0.233 L) by 1.0 wide; the snout 1.45 mm (0.322 L), down-curved toward its blunt tip
  head: {
    len: 0.233, w: 0.222, h: 0.2, tilt: -0.1, neck: 0.012, neckY: 0.03,
    nasus: { len: 0.3, r0: 0.04, r1: 0.017, up: -0.32, rise: 0.0, curve: 0.22, dark: 0.55, flank: 2.6 },
    sickle: { len: 0.26, w: 0.03, flat: 0.62, yaw0: 1.35, yawPow: 1.15, dip0: 0.3, dip1: 0.9, hook: 0.8, at: 0.02, ang: 0.9, cross: 0.012, tooth: 0.42, toothLen: 0.1 },
  },
  mandible: { len: 0.25, curve: 1, r: 0.02, open: 0.55 },
  antenna: { beads: 14, len: 0.55, r: 0.0105, ss: 0.3, sa: 0.3, ang: 0.42, splay: 0.6, droop: 0.6 },
  // very long legs (hind tibia 1.45 mm = 0.32 L); a thorn on the fore coxa
  legs: {
    thick: 0.0125, sprawl: 0.95, coxaThorn: 0.05,
    pairs: [
      { coxaDir: [0.025, -0.025, 0.03], femur: 0.22, tibia: 0.24, tarsus: 0.1, foot: [0.32, 0.38] },
      { coxaDir: [0.0, -0.025, 0.035], femur: 0.25, tibia: 0.28, tarsus: 0.11, foot: [0.03, 0.46] },
      { coxaDir: [-0.025, -0.025, 0.03], femur: 0.28, tibia: 0.32, tarsus: 0.12, foot: [-0.36, 0.44] },
    ],
  },
};
// the presoldier (the last stage of a soldier's growth on the brood tile): the soldier's shape, pale and soft
const presoldier = {
  ...soldier,
  key: 'termite_rhy_presoldier',
  look: {
    colors: { ...SOLDIER_COLORS, head: 0xe2c8a2, headTop: 0xe8d0aa, headUnder: 0xd8bc94, nasusTip: 0xcaa67c, pore: 0x8a6a48, mand: 0xd4b48a, mandTip: 0xa88458 },
    ...SURF,
    head: { rough: 0.3, coat: 0.5, sheen: 0.3 },
  },
};

// ---------- the royals: dark reddish-brown, eyes and ocelli, wing scales, a shield pronotum ----------
const ROYAL_COLORS = {
  ...WORKER_COLORS,
  head: 0x5a2e18, headTop: 0x66361c, headUnder: 0x4e2814, clypeus: 0x6e3c20, labrum: 0x8a5a36, palp: 0xa88058, eye: 0x140c08, ocellus: 0xc8a070,
  mand: 0x4a2814, mandTip: 0x160a04,
  thorax: 0x5a3018, thoraxTop: 0x4e2814, pronotum: 0x5e321a, wingScale: 0x3a2010,
  abd: 0x6a4224, abdTop: 0x5a3820, abdUnder: 0x9a7650, tergRear: 0x4a2c16, membrane: 0xb8946a, gut: 0x2a1a0c,
  leg: 0x8e6038, legLight: 0x9e7044, legBase: 0x7a5030, antenna: 0x7e5430, antennaTip: 0x8e6038, hair: 0xd0b48c,
};
const king = {
  ...worker,
  key: 'termite_rhy_king', L: 8.5, stance: 0.055, soft: 0.8,
  look: { colors: ROYAL_COLORS, ...SURF, abdomen: { rough: 0.4, coat: 0.45, sheen: 0.35 } },
  abdomen: { x0: 0.48, len: 0.5, w: 0.21, h: 0.15, cy: 0.09, full: 0.4, sag: 0.01, groove: 0.05, membrane: 0.6, gut: 0, gutLobes: [[0.5, 0.02, 0]] },
  thorax: { meta: 0.07, meso: 0.07, pro: 0.08, w: 0.15, h: 0.1, cy: 0.09, proW: 0.2, proLift: 0.004, saddle: 0.006, wingScales: true },
  head: { len: 0.19, w: 0.17, h: 0.1, tilt: -0.15, neck: 0.015, neckY: 0.015, flat: 0.7, narrow: 0.25, band: 0, royal: true },
  mandible: { len: 0.075, curve: 1.1, r: 0.014, open: 0.6 },
  antenna: { beads: 16, len: 0.33, r: 0.009, sx: 0.36, sy: 0.0, sz: 0.4, ang: 0.32, splay: 0.6, droop: 0.6 },
  legs: {
    thick: 0.0115, sprawl: 0.9,
    pairs: [
      { coxaDir: [0.02, -0.02, 0.025], femur: 0.13, tibia: 0.14, tarsus: 0.07, foot: [0.2, 0.25] },
      { coxaDir: [0.0, -0.02, 0.03], femur: 0.15, tibia: 0.16, tarsus: 0.075, foot: [0.0, 0.29] },
      { coxaDir: [-0.02, -0.02, 0.025], femur: 0.17, tibia: 0.185, tarsus: 0.085, foot: [-0.22, 0.28] },
    ],
  },
};
// the queen: the king's head, thorax and legs (in mm), and the physogastric abdomen, 22.5 by 5.05 by 5.1 mm
const QL = 26.2;
const qf = (mm) => mm / QL;
const queen = {
  ...king,
  key: 'termite_rhy_queen', L: QL, stance: qf(0.47), soft: 1.6,
  look: { colors: { ...ROYAL_COLORS, abd: 0xd2b488, abdTop: 0xc8a87a, abdUnder: 0xdcc29a, membrane: 0xd8bc90, plate: 0x5a3a20, stern: 0x8a6a44, gut: 0x8a6a40 }, ...SURF },
  abdomen: { x0: qf(4.2), len: qf(22.5), w: qf(5.05), h: qf(5.1), cy: qf(2.3), full: 0.3, sag: qf(0.4), groove: 0.02, membrane: 0.2, gut: 0.5, gutLobes: [[0.5, 0.1, 0]], physo: { pleat: 1 } },
  thorax: { ...king.thorax, meta: qf(0.6), meso: qf(0.6), pro: qf(0.68), w: qf(1.27), h: qf(0.85), cy: qf(0.77), proW: qf(1.7) },
  head: { ...king.head, len: qf(1.6), w: qf(1.45), h: qf(0.85), neck: qf(0.13), neckY: qf(0.13) },
  mandible: { ...king.mandible, len: qf(0.64), r: qf(0.12) },
  antenna: { ...king.antenna, len: qf(2.8), r: qf(0.075) },
  legs: {
    thick: qf(0.098), sprawl: 0.9,
    pairs: king.legs.pairs.map((p) => ({ coxaDir: p.coxaDir.map((v) => qf(v * 8.5)), femur: qf(p.femur * 8.5), tibia: qf(p.tibia * 8.5), tarsus: qf(p.tarsus * 8.5), foot: [qf(p.foot[0] * 8.5), qf(p.foot[1] * 8.5)] })),
  },
  gait: { lift: 0.15, duty: 0.7 },
};

// ---------- the larva: a small, pale, soft nymph with a big head and short legs (scaled 0.3 → 0.85 on the brood tile) ----------
const LARVA_COLORS = {
  ...WORKER_COLORS,
  // (round-1 render: paper white) a translucent cream with a faint amber cast, the gut a soft grey-brown shadow
  head: 0xdccaa6, headTop: 0xe2d0ae, headUnder: 0xd2bf9a, clypeus: 0xe0cfae, labrum: 0xe6d8bc, mand: 0xc8ad80, mandTip: 0xa4865a, fontanelle: 0xece2cc,
  thorax: 0xe0d0b0, thoraxTop: 0xd8c6a2, pronotum: 0xdccaa8, abd: 0xe0cfae, abdTop: 0xd6c29c, abdUnder: 0xe8dcc2, tergRear: 0xccb68e, membrane: 0xeee4ce, gut: 0x8a7656,
  leg: 0xe2d4b8, legLight: 0xeae0ca, legBase: 0xd8c8a8, antenna: 0xdccdb0, antennaTip: 0xe6dac4,
};
const larva = {
  ...worker,
  key: 'termite_rhy_larva', L: 5.8, stance: 0.03, soft: 1.4,
  look: { colors: LARVA_COLORS, ...SURF, head: { rough: 0.4, coat: 0.4, sheen: 0.35 } },
  abdomen: { x0: 0.46, len: 0.54, w: 0.28, h: 0.22, cy: 0.11, full: 0.45, sag: 0.02, groove: 0.03, membrane: 0.4, gut: 0.3, gutLobes: [[0.45, 0.03, 1]] },
  thorax: { meta: 0.045, meso: 0.045, pro: 0.05, w: 0.18, h: 0.13, cy: 0.1, proW: 0.2, proLift: 0.006, saddle: 0.01 },
  head: { len: 0.24, w: 0.28, h: 0.2, tilt: -0.3, neck: 0.012, neckY: 0.012, flat: 0.9, narrow: 0.25, band: 0, fontanelle: 0.1 },
  mandible: { len: 0.06, curve: 1.1, r: 0.012, open: 0.4 },
  antenna: { beads: 12, len: 0.28, r: 0.011, sx: 0.42, sy: 0.0, sz: 0.46, ang: 0.2, splay: 0.6, droop: 0.8 },
  legs: {
    thick: 0.014, sprawl: 0.85,
    pairs: [
      { coxaDir: [0.02, -0.02, 0.03], femur: 0.09, tibia: 0.09, tarsus: 0.045, foot: [0.14, 0.22] },
      { coxaDir: [0.0, -0.02, 0.035], femur: 0.1, tibia: 0.1, tarsus: 0.05, foot: [0.0, 0.25] },
      { coxaDir: [-0.02, -0.02, 0.03], femur: 0.11, tibia: 0.11, tarsus: 0.05, foot: [-0.15, 0.24] },
    ],
  },
  gait: { lift: 0.2, duty: 0.6 },
};

export const RHY_MORPHS = {
  termite_rhy_worker: worker,
  termite_rhy_soldier: soldier,
  termite_rhy_presoldier: presoldier,
  termite_rhy_king: king,
  termite_rhy_queen: queen,
  termite_rhy_larva: larva,
};
