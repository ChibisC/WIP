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

// ---------- the worker (review round 1: "is that truly how the worker looks?"; round 3: "redo rhyncotermes workers
// based on real life images cos they look off" — rebuilt from the user's three field photos, study only) ----------
// What the photos show: a strongly two-toned animal. The head a small, round, glossy orange dome (the photos read
// #c95b07), about as wide as long, the face the same colour; a narrow thorax of a lighter orange (#d2863e); long,
// slender pale-amber legs and beaded antennae; and a big, plump egg-shaped abdomen that is dark — a glossy chocolate
// (#623525) to grey-brown (#785d47), the gut contents showing through a wet-looking cuticle — its tergites divided by
// dark creases, not pale stripes (the pale bits in the photos are highlights). No visible fontanelle or suture at
// this scale. The descriptions (Constantini et al. 2019; Scheffrahn 2010: the head concolorous with the soldier's,
// reddish-orange, eyeless, 14 antennal articles) agree.
const WORKER_COLORS = {
  head: 0xc85818, headTop: 0xd06020, headUnder: 0xa84414, headBand: 0xa04418, clypeus: 0xd06a2a, labrum: 0xc0743c, palp: 0xd8b07a, fontanelle: 0xdc8a52,
  mand: 0x6a2a10, mandTip: 0x200a04,
  thorax: 0xd2843c, thoraxTop: 0xc87a34, pronotum: 0xcc7e36,
  abd: 0x6c381e, abdTop: 0x5a2e18, abdUnder: 0x86583c, tergRear: 0x381a0c, membrane: 0x8a644a, gut: 0x26160c,
  leg: 0xd8a862, legLight: 0xe2b874, legBase: 0xcc9a54, claw: 0x7a5a30, antenna: 0xd09c58, antennaTip: 0xdcb070,
  hair: 0xe8d8b0, seta: 0xe8d8b0,
};
const worker = {
  key: 'termite_rhy_worker', builder: 'nasute', real: true, L: 5.8, stance: 0.06, soft: 1.1,
  // the head and the abdomen both glossy and wet-looking in the photos
  look: { colors: WORKER_COLORS, ...SURF, head: { rough: 0.16, coat: 0.85, sheen: 0.06 }, abdomen: { rough: 0.14, coat: 0.9, sheen: 0.08 } },
  // a big plump egg-shaped abdomen, dark, the tergites divided by dark creases
  abdomen: { x0: 0.5, len: 0.5, w: 0.32, h: 0.26, cy: 0.155, full: 0.55, front: 0.3, sag: 0.015, groove: 0.09, membrane: 0.3, gut: 0.35, gutLobes: [[0.35, 0.04, 1], [0.55, 0.045, 1], [0.74, 0.03, 0.85]] },
  // a narrow thorax, the pronotum a small saddle
  thorax: { meta: 0.05, meso: 0.05, pro: 0.05, w: 0.12, h: 0.09, cy: 0.1, proW: 0.15, proLift: 0.012, saddle: 0.016 },
  // a small round glossy dome, about as wide as long
  head: { len: 0.19, w: 0.2, h: 0.18, tilt: -0.2, neck: 0.02, neckY: 0.014, flat: 1.0, narrow: 0.22, round: 2.0, band: 0, fontanelle: 0.04 },
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
  // the palps, claws and pale hairs as before the worker's round-3 redo
  palp: 0xe6d6b8, claw: 0x8a6a40, hair: 0xf2ead6, seta: 0xf2ead6, clypeus: 0xc0784a, labrum: 0xcc9a6a, fontanelle: 0xf2e6cc, headBand: 0x7a3216,
  head: 0xa23a16, headTop: 0xb0421a, headUnder: 0x8a3012, nasusTip: 0x5a1610, pore: 0x2a0806,
  // (round 3, the user's photos: "more colored like irl counterparts") the sickles a glossy wine-crimson (the photos
  // read #7c2018 in the light, #4a0604 in shadow), going black only at the hook
  mand: 0x8a2218, mandTip: 0x140404,
  // the photos' amber-cream body with bold brown tergite bands (species doc §6: #D49E5C, bands #6E3E1E)
  // (round-1 photo comparison: still too pale) a warmer amber
  thorax: 0xc08440, thoraxTop: 0xb47838, pronotum: 0xb87c3a,
  // (round 3, "as well as their abdomens") browner than before: a warm tan-brown (the photos read #8c674a), each
  // tergite darkening to a bold brown rear band (#533115), thin pale cream membranes between, the gut a dull shadow
  abd: 0xa07044, abdTop: 0x8c5e36, abdUnder: 0xc0966a, tergRear: 0x40200a, membrane: 0xdac4a0, gut: 0x4a3a2a,
  leg: 0xd4a258, legLight: 0xdeb26a, legBase: 0xc49048, antenna: 0xc89a54, antennaTip: 0xd8ae68,
};
const soldier = {
  ...worker,
  key: 'termite_rhy_soldier', L: 4.5, stance: 0.09, soft: 1,
  look: { colors: SOLDIER_COLORS, ...SURF, head: GLASSY, mandible: GLASSY },
  // (round 3, the photos) a plump oval abdomen about 1.8 × the capsule's length and a little wider than it
  abdomen: { x0: 0.38, len: 0.4, w: 0.25, h: 0.2, cy: 0.115, full: 0.52, front: 0.35, sag: 0.012, groove: 0.06, membrane: 0.4, band: 0.85, gut: 0.45, gutLobes: [[0.38, 0.02, 0.9], [0.6, 0.016, 0.75]] },
  thorax: { meta: 0.05, meso: 0.05, pro: 0.06, w: 0.12, h: 0.1, cy: 0.1, proW: 0.14, proLift: 0.01, saddle: 0.018 },
  // the capsule 1.05 mm (0.233 L) by 1.0 wide; the snout 1.45 mm (0.322 L), down-curved toward its blunt tip
  head: {
    len: 0.233, w: 0.222, h: 0.2, tilt: 0.08, neck: 0.012, neckY: 0.03,
    nasus: { len: 0.3, r0: 0.04, r1: 0.017, up: -0.32, rise: 0.0, curve: 0.22, dark: 0.55, flank: 2.6 },
    // (round-1 photo comparison) a C-hook in one plane: forward and down from the hinge, round the bottom, the tip
    // curling back and up; thicker at the base. (round 3: "slightly less thick") a quarter slimmer; crimson, black
    // from `tip` along the blade
    sickle: { len: 0.34, w: 0.03, tip: 0.74, flat: 0.6, plane: true, yaw0: 0.32, yawPow: 1, dip0: 0.4, dip1: 2.0, hook: 0.5, at: 0.02, ang: 0.9, cross: 0.012, tooth: 0.42, toothLen: 0.1 },
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
    colors: {
      ...SOLDIER_COLORS, head: 0xe2c8a2, headTop: 0xe8d0aa, headUnder: 0xd8bc94, nasusTip: 0xcaa67c, pore: 0x8a6a48, mand: 0xd4b48a, mandTip: 0xa88458,
      // soft and untanned all over
      thorax: 0xe6d4b0, thoraxTop: 0xdecaa4, pronotum: 0xe2d0aa, abd: 0xe4d0a8, abdTop: 0xdac49a, abdUnder: 0xeadcbc, tergRear: 0xc8aa7c, membrane: 0xf0e4ca, gut: 0x4a3018,
      leg: 0xe8d8b4, legLight: 0xeee2c4, legBase: 0xdecca6, antenna: 0xe2d2ae, antennaTip: 0xeadcbc,
    },
    ...SURF,
    head: { rough: 0.3, coat: 0.5, sheen: 0.3 },
  },
};

// ---------- the larva: a small, pale, soft nymph with a big head and short legs (scaled 0.3 → 0.85 on the brood tile) ----------
const LARVA_COLORS = {
  ...WORKER_COLORS,
  // (round-1 render: paper white) a translucent cream with a faint amber cast, the gut a soft grey-brown shadow
  head: 0xdccaa6, headTop: 0xe2d0ae, headUnder: 0xd2bf9a, clypeus: 0xe0cfae, labrum: 0xe6d8bc, mand: 0xc8ad80, mandTip: 0xa4865a, fontanelle: 0xece2cc,
  thorax: 0xe0d0b0, thoraxTop: 0xd8c6a2, pronotum: 0xdccaa8, abd: 0xe0cfae, abdTop: 0xd6c29c, abdUnder: 0xe8dcc2, tergRear: 0xccb68e, membrane: 0xeee4ce, gut: 0x8a7656,
  leg: 0xe2d4b8, legLight: 0xeae0ca, legBase: 0xd8c8a8, antenna: 0xdccdb0, antennaTip: 0xe6dac4,
  palp: 0xe6d6b8, claw: 0x8a6a40, hair: 0xf2ead6, seta: 0xf2ead6, headBand: 0x7a3216,
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
  termite_rhy_larva: larva,
};
