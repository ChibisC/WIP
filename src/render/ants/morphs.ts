/**
 * Ant morphology parameters per species × caste, taken from the reference
 * notes in docs/creatures. Lengths are fractions of body length L unless
 * noted; colours are linear-ish sRGB hex.
 */
export type HeadShape = 'round' | 'heart' | 'rect' | 'tri' | 'square';
export type MandibleType = 'triangular' | 'falcate' | 'massive' | 'small';

export interface PartLook {
  color: number;
  /** Optional second colour blended by a part-specific gradient. */
  color2?: number;
  rough: number;
  coat: number; // clearcoat
  sheen: number; // pubescence
}

export interface AntMorph {
  key: string;
  L: number; // body length (mm), head to gaster tip
  head: {
    len: number;
    width: number;
    height: number;
    shape: HeadShape;
    /** posterior emargination (concave back border), fraction of head length */
    notch?: number;
    occSpines?: number;
    /** depth of the lengthwise groove down the top of the head, fraction of head height */
    groove?: number;
    /** clypeal carinae: two ridges on the clypeus ending in teeth on its front edge (size, fraction of L) */
    carinae?: number;
    /** lerp toward `look.head.color2` over the front of the head by this much (army ants: pale heads darker toward the mouth) */
    frontMix?: number;
    /** dark antennal sockets (army-ant majors) */
    sockets?: number;
    /** frontal gland pore (a stubby termite nasus) between the antenna bases: length and radius in head lengths, upward tilt */
    pore?: { len: number; r: number; up: number };
  };
  /** `none`: eyeless (termite soldiers, Termant soldiers) */
  eyes: { size: number; pos: number; height: number; ocelli: boolean; single?: boolean; none?: boolean };
  /** `bead`: funiculus segments swell toward the tip (moniliform, termite-like; LOD0) */
  antenna: { segments: number; scape: number; funiculus: number; club: number; thick: number; bead?: number };
  mandible: {
    type: MandibleType;
    len: number;
    teeth: number;
    width: number;
    /** falcate only: the tip curls back inward over the last 38 % (army-ant fishhook / ice tongs), 0..1 */
    hook?: number;
    /** falcate only: a small spur near the point (LOD0) */
    barb?: number;
  };
  /** `smooth`: one even arch, no metanotal groove (Saiy-Ants, Termants) */
  meso: { len: number; width: number; height: number; queen?: boolean; smooth?: boolean; spines?: { pro?: number; meso?: number; prop?: number } };
  waist: {
    nodes: 1 | 2;
    len: number;
    scale?: boolean;
    nodeH: number;
    /** myrmicines: petiole and postpetiole half-widths (fractions of mesosoma width; defaults .28 / .36) */
    petW?: number;
    postW?: number;
    /** postpetiole height relative to the petiole node (default .9) */
    postH?: number;
    /** wedge-shaped (cuneate) petiole node with a sharp crest */
    crest?: boolean;
    /** small tooth under the front of the petiole (fraction of L) */
    subTooth?: number;
    /** lateral thickness multiplier of the waist (army-ant queen: one very broad petiole) */
    thick?: number;
  };
  gaster: {
    len: number;
    width: number;
    height: number;
    sting: boolean;
    /** number of visible segments: segs − 1 evenly spaced faint bands (default: five fixed bands) */
    segs?: number;
    /** hard plate/membrane stripes centred on the segment joints (army-ant queen), and their width (fraction of a segment) */
    stripes?: number;
    stripeW?: number;
    /** physogastric gaster: the `swell` instance value grows it far more than a full crop does */
    physo?: number;
    /** dark gut contents showing through a pale abdomen (Termants): colour */
    gut?: number;
    /** soft abdomen: jiggles and sways with the stride (vertex shader `uSoft`) */
    soft?: number;
  };
  /** walk cycle: leg lift and duty factor (defaults .24 / .55; army ants step high and fast) */
  gait?: { lift: number; duty: number };
  legs: { hind: number; thick: number };
  look: {
    head: PartLook;
    meso: PartLook;
    waist: PartLook;
    gaster: PartLook;
    legs: PartLook;
    antenna: PartLook;
    mandible: PartLook;
  };
  hair: number; // erect setae density 0..1
  wingScars?: boolean;
  /** Walking body height above ground as a fraction of L. */
  stance: number;
}

const L = (color: number, rough: number, coat: number, sheen: number, color2?: number): PartLook => ({ color, color2, rough, coat, sheen });

// ---------- Lasius niger ----------
const lasiusWorker: AntMorph = {
  key: 'lasius_worker',
  L: 4,
  head: { len: 0.23, width: 0.21, height: 0.15, shape: 'rect' },
  eyes: { size: 0.22, pos: 0.52, height: 0.15, ocelli: false },
  antenna: { segments: 12, scape: 1.0, funiculus: 1.25, club: 0, thick: 0.013 },
  mandible: { type: 'triangular', len: 0.42, teeth: 8, width: 0.55 },
  meso: { len: 0.32, width: 0.13, height: 0.13 },
  waist: { nodes: 1, len: 0.05, scale: true, nodeH: 0.11 },
  gaster: { len: 0.4, width: 0.22, height: 0.18, sting: false },
  legs: { hind: 0.95, thick: 0.015 },
  look: {
    head: L(0x1e1611, 0.58, 0.08, 0.18),
    meso: L(0x2a1e15, 0.56, 0.08, 0.16),
    waist: L(0x271c14, 0.56, 0.08, 0.14),
    gaster: L(0x18120e, 0.5, 0.12, 0.32),
    legs: L(0x2a2018, 0.56, 0.06, 0.15, 0x56422f),
    antenna: L(0x281e16, 0.56, 0.06, 0.15, 0x46352a),
    mandible: L(0x2e2016, 0.55, 0.12, 0.0),
  },
  hair: 0.6,
  stance: 0.13,
};

/** Lasius soldier: a larger worker (L. niger workers run 3–5 mm) with a broader head and stronger jaws. */
const lasiusSoldier: AntMorph = {
  ...lasiusWorker,
  key: 'lasius_soldier',
  L: 4.9,
  head: { len: 0.25, width: 0.245, height: 0.165, shape: 'rect' },
  eyes: { size: 0.2, pos: 0.52, height: 0.15, ocelli: false },
  mandible: { type: 'triangular', len: 0.46, teeth: 8, width: 0.62 },
  meso: { len: 0.31, width: 0.14, height: 0.14 },
  legs: { hind: 0.93, thick: 0.0165 },
};

const lasiusQueen: AntMorph = {
  ...lasiusWorker,
  key: 'lasius_queen',
  L: 8.5,
  head: { len: 0.15, width: 0.15, height: 0.1, shape: 'rect' },
  eyes: { size: 0.24, pos: 0.5, height: 0.2, ocelli: true },
  antenna: { ...lasiusWorker.antenna, scape: 0.95, funiculus: 1.2 },
  mandible: { ...lasiusWorker.mandible, len: 0.34 },
  meso: { len: 0.3, width: 0.17, height: 0.18, queen: true },
  waist: { nodes: 1, len: 0.035, scale: true, nodeH: 0.11 },
  gaster: { len: 0.5, width: 0.3, height: 0.25, sting: false },
  legs: { hind: 0.62, thick: 0.0125 },
  look: { ...lasiusWorker.look, gaster: L(0x2a1d14, 0.45, 0.25, 0.4), meso: L(0x3a2a1c, 0.5, 0.15, 0.25) },
  wingScars: true,
  stance: 0.1,
};

// ---------- Formica rufa ----------
const formicaWorker: AntMorph = {
  key: 'formica_worker',
  L: 7,
  head: { len: 0.24, width: 0.22, height: 0.15, shape: 'tri' },
  eyes: { size: 0.3, pos: 0.48, height: 0.25, ocelli: true },
  antenna: { segments: 12, scape: 1.15, funiculus: 1.2, club: 0, thick: 0.0115 },
  mandible: { type: 'triangular', len: 0.4, teeth: 8, width: 0.6 },
  meso: { len: 0.34, width: 0.12, height: 0.13 },
  waist: { nodes: 1, len: 0.05, scale: true, nodeH: 0.12 },
  gaster: { len: 0.37, width: 0.21, height: 0.17, sting: false },
  legs: { hind: 1.1, thick: 0.0136 },
  look: {
    head: L(0x22160f, 0.45, 0.18, 0.12, 0x6e3218),
    meso: L(0x7a3419, 0.5, 0.12, 0.12, 0x24170f),
    waist: L(0x64301a, 0.5, 0.12, 0.1),
    gaster: L(0x18110d, 0.4, 0.25, 0.25, 0x3a1e14),
    legs: L(0x2a1d16, 0.5, 0.12, 0.15, 0x4a3022),
    antenna: L(0x2a1d16, 0.5, 0.1, 0.1, 0x553a2a),
    mandible: L(0x52281a, 0.45, 0.25, 0),
  },
  hair: 0.35,
  stance: 0.15,
};

const formicaQueen: AntMorph = {
  ...formicaWorker,
  key: 'formica_queen',
  L: 10.5,
  head: { len: 0.17, width: 0.17, height: 0.11, shape: 'tri' },
  meso: { len: 0.32, width: 0.17, height: 0.19, queen: true },
  waist: { nodes: 1, len: 0.035, scale: true, nodeH: 0.11 },
  gaster: { len: 0.48, width: 0.28, height: 0.23, sting: false },
  legs: { hind: 0.75, thick: 0.0116 },
  wingScars: true,
  stance: 0.12,
};

/** Wood ant soldier (tank): the biggest workers — broad head, heavy jaws, thick legs, a darker shield of a pronotum. */
const formicaSoldier: AntMorph = {
  ...formicaWorker,
  key: 'formica_soldier',
  L: 8.6,
  head: { len: 0.27, width: 0.275, height: 0.17, shape: 'tri' },
  eyes: { size: 0.26, pos: 0.48, height: 0.25, ocelli: true },
  mandible: { type: 'triangular', len: 0.46, teeth: 8, width: 0.7 },
  meso: { len: 0.33, width: 0.145, height: 0.15 },
  gaster: { len: 0.35, width: 0.22, height: 0.18, sting: false },
  legs: { hind: 1.02, thick: 0.0158 },
  look: {
    ...formicaWorker.look,
    head: L(0x1c120c, 0.42, 0.22, 0.1, 0x5e2a14),
    meso: L(0x6a2c14, 0.45, 0.18, 0.1, 0x1e140d),
  },
};

/** Mortar sprayer: a swollen, glossy acid-filled gaster for long lobbed shots. */
const formicaMortar: AntMorph = {
  ...formicaWorker,
  key: 'formica_mortar',
  L: 7.6,
  meso: { len: 0.31, width: 0.12, height: 0.13 },
  gaster: { len: 0.44, width: 0.27, height: 0.22, sting: false },
  legs: { hind: 1.02, thick: 0.0136 },
  look: { ...formicaWorker.look, gaster: L(0x1a120c, 0.28, 0.45, 0.2, 0x5a3418) },
};

/** Rapid sprayer: slimmer, long gaster with a red base, for quick jets. */
const formicaRapid: AntMorph = {
  ...formicaWorker,
  key: 'formica_rapid',
  L: 7.2,
  meso: { len: 0.33, width: 0.115, height: 0.125 },
  gaster: { len: 0.4, width: 0.215, height: 0.17, sting: false },
  look: { ...formicaWorker.look, gaster: L(0x1c120d, 0.36, 0.3, 0.22, 0x7a3018) },
};

// ---------- Atta cephalotes ----------
const attaLook = {
  head: L(0x5a2a14, 0.72, 0.05, 0.08, 0x44200e),
  meso: L(0x62301a, 0.78, 0.03, 0.08),
  waist: L(0x5c2c16, 0.78, 0.03, 0.08),
  gaster: L(0x522814, 0.75, 0.05, 0.1),
  legs: L(0x66341c, 0.7, 0.04, 0.08, 0x7a4224),
  antenna: L(0x66341c, 0.7, 0.04, 0.06),
  mandible: L(0x4a1e0c, 0.4, 0.3, 0, 0x1a0a04),
};

const attaMedia: AntMorph = {
  key: 'atta_media',
  L: 8,
  head: { len: 0.3, width: 0.3, height: 0.17, shape: 'heart', notch: 0.18, occSpines: 0.06 },
  eyes: { size: 0.13, pos: 0.62, height: 0.2, ocelli: false },
  antenna: { segments: 11, scape: 0.95, funiculus: 1.3, club: 0, thick: 0.0115 },
  mandible: { type: 'triangular', len: 0.36, teeth: 7, width: 0.6 },
  meso: { len: 0.3, width: 0.12, height: 0.14, spines: { pro: 0.09, meso: 0.07, prop: 0.08 } },
  waist: { nodes: 2, len: 0.1, nodeH: 0.08 },
  gaster: { len: 0.26, width: 0.19, height: 0.15, sting: true },
  legs: { hind: 1.2, thick: 0.0136 },
  look: attaLook,
  hair: 0.2,
  stance: 0.15,
};

const attaMinim: AntMorph = {
  ...attaMedia,
  key: 'atta_minim',
  L: 2,
  head: { len: 0.27, width: 0.25, height: 0.17, shape: 'round', notch: 0.05 },
  eyes: { size: 0.16, pos: 0.6, height: 0.2, ocelli: false },
  mandible: { type: 'triangular', len: 0.33, teeth: 6, width: 0.55 },
  meso: { len: 0.3, width: 0.12, height: 0.14, spines: { pro: 0.05, meso: 0.04, prop: 0.05 } },
  gaster: { len: 0.3, width: 0.21, height: 0.17, sting: true },
  legs: { hind: 1.05, thick: 0.0163 },
  look: { ...attaLook, head: L(0x6a3a1e, 0.7, 0.05, 0.08), gaster: L(0x5e3018, 0.72, 0.05, 0.08) },
  stance: 0.15,
};

/** Atta soldier: a scaled-up minim with a bigger head and slightly redder colour. */
const attaSoldier: AntMorph = {
  ...attaMinim,
  key: 'atta_soldier',
  L: 10.5,
  head: { len: 0.3, width: 0.31, height: 0.18, shape: 'round', notch: 0.09, occSpines: 0.03 },
  eyes: { size: 0.13, pos: 0.6, height: 0.2, ocelli: false },
  mandible: { type: 'triangular', len: 0.38, teeth: 6, width: 0.62 },
  meso: { len: 0.29, width: 0.12, height: 0.14, spines: { pro: 0.07, meso: 0.05, prop: 0.06 } },
  legs: { hind: 1.08, thick: 0.0145 },
  look: { ...attaLook, head: L(0x7a3318, 0.66, 0.06, 0.08, 0x5a2410), meso: L(0x76361a, 0.72, 0.04, 0.08), gaster: L(0x6a2c16, 0.7, 0.05, 0.08) },
};

const attaMajor: AntMorph = {
  ...attaMedia,
  key: 'atta_major',
  L: 14,
  head: { len: 0.4, width: 0.44, height: 0.21, shape: 'heart', notch: 0.3, occSpines: 0.05 },
  eyes: { size: 0.08, pos: 0.66, height: 0.15, ocelli: false },
  antenna: { segments: 11, scape: 0.7, funiculus: 1.2, club: 0, thick: 0.0086 },
  mandible: { type: 'massive', len: 0.36, teeth: 5, width: 0.75 },
  meso: { len: 0.25, width: 0.1, height: 0.12, spines: { pro: 0.07, meso: 0.06, prop: 0.06 } },
  waist: { nodes: 2, len: 0.08, nodeH: 0.07 },
  gaster: { len: 0.22, width: 0.16, height: 0.13, sting: true },
  legs: { hind: 1.0, thick: 0.0122 },
  look: { ...attaLook, head: L(0x4e2210, 0.55, 0.14, 0.05, 0x3a180a) },
  stance: 0.14,
};

const attaQueen: AntMorph = {
  ...attaMedia,
  key: 'atta_queen',
  L: 21,
  head: { len: 0.17, width: 0.2, height: 0.11, shape: 'heart', notch: 0.12, occSpines: 0.03 },
  eyes: { size: 0.2, pos: 0.6, height: 0.2, ocelli: true },
  antenna: { segments: 11, scape: 0.95, funiculus: 1.2, club: 0, thick: 0.0072 },
  meso: { len: 0.27, width: 0.14, height: 0.16, queen: true, spines: { pro: 0.03, meso: 0, prop: 0.03 } },
  waist: { nodes: 2, len: 0.06, nodeH: 0.06 },
  gaster: { len: 0.48, width: 0.3, height: 0.24, sting: true },
  legs: { hind: 0.7, thick: 0.0105 },
  wingScars: true,
  stance: 0.11,
};

// ---------- Solenopsis geminata (tropical fire ant) ----------
// Reference: docs/creatures/solenopsis-geminata.md. Head and mesosoma golden
// reddish-orange, gaster dark brown (lighter at the front), legs and antennae
// yellowish brown with a darker 2-segment club; smooth, glossy, sparse erect
// pale hairs. Worker ≈ 2.8 mm; the soldier is the SAME model scaled to ≈ 4 mm
// (CasteDef.scale); the major shares the body with an allometrically huge,
// square head; the queen is a separate model.
const fireLook = {
  head: L(0x9a4418, 0.26, 0.42, 0.04, 0xae5622),
  meso: L(0xa84e1e, 0.26, 0.42, 0.04),
  waist: L(0x9a461a, 0.26, 0.42, 0.04),
  gaster: L(0x2c1a10, 0.22, 0.5, 0.05, 0x6e3818),
  legs: L(0x9a6430, 0.32, 0.3, 0.05, 0xb07a44),
  antenna: L(0x9a6430, 0.32, 0.3, 0.05, 0x5a3418),
  mandible: L(0x5a2410, 0.3, 0.35, 0, 0x2a0e06),
};

const fireMinor: AntMorph = {
  key: 'fire_minor',
  L: 2.8,
  head: { len: 0.26, width: 0.24, height: 0.16, shape: 'rect', carinae: 0.022 },
  eyes: { size: 0.14, pos: 0.6, height: 0.15, ocelli: false },
  antenna: { segments: 10, scape: 0.95, funiculus: 1.15, club: 2, thick: 0.0144 },
  mandible: { type: 'triangular', len: 0.3, teeth: 4, width: 0.55 },
  meso: { len: 0.3, width: 0.12, height: 0.13 },
  waist: { nodes: 2, len: 0.11, nodeH: 0.085, petW: 0.27, postW: 0.29, postH: 0.82, crest: true, subTooth: 0.026 },
  gaster: { len: 0.34, width: 0.22, height: 0.18, sting: true },
  legs: { hind: 0.88, thick: 0.0145 },
  look: fireLook,
  hair: 0.7,
  stance: 0.12,
};

/** S. geminata major: the worker's body with a huge, square head (deep groove and back notch) and blunt black seed-milling jaws. */
const fireMajor: AntMorph = {
  ...fireMinor,
  key: 'fire_major',
  L: 6,
  head: { len: 0.34, width: 0.37, height: 0.215, shape: 'square', notch: 0.22, groove: 0.16, carinae: 0.014 },
  eyes: { size: 0.075, pos: 0.62, height: 0.15, ocelli: false },
  antenna: { segments: 10, scape: 0.55, funiculus: 1.0, club: 2, thick: 0.0105 },
  mandible: { type: 'massive', len: 0.32, teeth: 2, width: 0.75 },
  meso: { len: 0.26, width: 0.112, height: 0.122 },
  waist: { nodes: 2, len: 0.095, nodeH: 0.075, petW: 0.27, postW: 0.29, postH: 0.82, crest: true, subTooth: 0.02 },
  gaster: { len: 0.29, width: 0.19, height: 0.158, sting: true },
  legs: { hind: 0.78, thick: 0.019 },
  look: { ...fireLook, head: L(0x7a3010, 0.24, 0.45, 0.04, 0x8a3a14), mandible: L(0x160a06, 0.28, 0.45, 0, 0x0a0503) },
  hair: 0.6,
};

/** S. geminata queen: worker-like (slightly broad) head, bulky mesosoma with scutum and scutellum, long gaster; dark reddish brown. */
const fireQueen: AntMorph = {
  ...fireMinor,
  key: 'fire_queen',
  L: 8,
  head: { len: 0.15, width: 0.172, height: 0.1, shape: 'rect', carinae: 0.012 },
  eyes: { size: 0.24, pos: 0.58, height: 0.2, ocelli: true },
  antenna: { segments: 11, scape: 0.95, funiculus: 1.15, club: 2, thick: 0.0098 },
  mandible: { type: 'triangular', len: 0.3, teeth: 4, width: 0.6 },
  meso: { len: 0.28, width: 0.16, height: 0.18, queen: true },
  waist: { nodes: 2, len: 0.07, nodeH: 0.07, petW: 0.24, postW: 0.27, postH: 0.85, crest: true, subTooth: 0.012 },
  gaster: { len: 0.5, width: 0.31, height: 0.25, sting: true },
  legs: { hind: 0.64, thick: 0.0118 },
  look: {
    ...fireLook,
    head: L(0x5a2a14, 0.28, 0.4, 0.04, 0x7a3c1c),
    meso: L(0x6a3018, 0.28, 0.4, 0.04),
    waist: L(0x5e2a14, 0.28, 0.4, 0.04),
    gaster: L(0x24140c, 0.24, 0.48, 0.05, 0x4a2412),
    legs: L(0x8a5a2e, 0.32, 0.3, 0.05, 0xa8784a),
  },
  wingScars: true,
  stance: 0.1,
};

// ---------- Eciton burchellii (army ant): five models on the shared builder ----------
// Colours from the reference photos (the package's notes; the photos are reference only): minor and porter heads AND
// mesosoma near-black, legs dark rust paler toward the tarsi, gaster orange-amber; media and Soldier pale heads and
// tan-rust bodies; queen dark red-brown with a plated gaster. Builder options: mandible.hook/barb, head.sockets,
// head.frontMix, gaster.segs/stripes/stripeW/physo, waist.thick, gait.
const EC_GASTER = L(0xc97a30, 0.38, 0.26, 0.06, 0x8e4e1e); // orange-amber, faint darker segment bands
const EC_DARK = {
  head: L(0x1a1a1c, 0.34, 0.3, 0.04, 0x2e2a28),
  meso: L(0x241a16, 0.4, 0.22, 0.05, 0x3a2a22),
  waist: L(0x3a2218, 0.42, 0.18, 0.05, 0x4a2a1c),
  gaster: EC_GASTER,
  legs: L(0x4a2416, 0.45, 0.14, 0.06, 0x8a5a3a), // color2: paler toward the tarsi and claws
  antenna: L(0x3a2218, 0.45, 0.14, 0.05, 0x6a4a32),
  mandible: L(0x2a1a12, 0.38, 0.3, 0, 0x120c0a),
};
const EC_TAN = {
  ...EC_DARK,
  meso: L(0x6e2e1a, 0.42, 0.22, 0.05, 0x8a4a2c),
  waist: L(0x6e2e1a, 0.42, 0.18, 0.05, 0x8a4a2c),
  legs: L(0x6e2e1a, 0.45, 0.14, 0.06, 0xb89470), // pale tarsi and claws
  antenna: L(0x5a2818, 0.45, 0.14, 0.05, 0x8a5a3a),
};
const EC_GAIT = { lift: 0.42, duty: 0.5 }; // high-stepping and fast

const ecitonMinor: AntMorph = {
  key: 'eciton_minor',
  L: 4,
  head: { len: 0.2, width: 0.17, height: 0.14, shape: 'round', frontMix: 0.35 },
  eyes: { size: 0.05, pos: 0.55, height: 0.25, ocelli: false, single: true },
  antenna: { segments: 12, scape: 1.05, funiculus: 1.25, club: 0, thick: 0.0115 },
  mandible: { type: 'triangular', len: 0.3, teeth: 4, width: 0.42 },
  meso: { len: 0.36, width: 0.105, height: 0.12 },
  waist: { nodes: 2, len: 0.11, nodeH: 0.08 },
  gaster: { len: 0.3, width: 0.17, height: 0.145, sting: true, segs: 5 },
  legs: { hind: 1.5, thick: 0.0125 },
  look: EC_DARK,
  hair: 0.45,
  stance: 0.21,
  gait: EC_GAIT,
};

/** Porter (submajor): long narrow slightly curved mandibles, the lankiest legs (room for a load under the body). */
const ecitonSubmajor: AntMorph = {
  ...ecitonMinor,
  key: 'eciton_submajor',
  L: 6.5,
  head: { len: 0.22, width: 0.2, height: 0.15, shape: 'rect', frontMix: 0.35 },
  eyes: { size: 0.045, pos: 0.55, height: 0.25, ocelli: false, single: true },
  antenna: { segments: 12, scape: 1.0, funiculus: 1.2, club: 0, thick: 0.0105 },
  mandible: { type: 'falcate', len: 0.5, teeth: 0, width: 0.16, hook: 0.15 },
  meso: { len: 0.37, width: 0.105, height: 0.12 },
  gaster: { len: 0.29, width: 0.165, height: 0.14, sting: true, segs: 5 },
  legs: { hind: 1.75, thick: 0.0118 },
  look: { ...EC_DARK, head: L(0x222226, 0.34, 0.3, 0.04, 0x34302e) },
  stance: 0.25,
};

/** Media: pale-yellow head darker toward the mouth, medium thick curved mandibles. */
const ecitonMedia: AntMorph = {
  ...ecitonMinor,
  key: 'eciton_media',
  L: 8,
  head: { len: 0.25, width: 0.25, height: 0.17, shape: 'round', frontMix: 0.7 },
  eyes: { size: 0.04, pos: 0.52, height: 0.25, ocelli: false, single: true },
  antenna: { segments: 12, scape: 0.9, funiculus: 1.15, club: 0, thick: 0.0095 },
  mandible: { type: 'falcate', len: 0.62, teeth: 0, width: 0.26, hook: 0.35 },
  meso: { len: 0.34, width: 0.11, height: 0.125 },
  gaster: { len: 0.28, width: 0.165, height: 0.14, sting: true, segs: 5 },
  legs: { hind: 1.5, thick: 0.0115 },
  // (the package's #B09C64 head, a little darker: the game's sun lifted it to white on the surface)
  look: { ...EC_TAN, head: L(0x9e8854, 0.42, 0.14, 0.05, 0x6e5430), mandible: L(0x1a1410, 0.36, 0.32, 0, 0x0a0806) },
  stance: 0.21,
};

/** Soldier (major): big cream head with dark antennal sockets, long black ice-tong fishhook mandibles with barbed points. */
const ecitonMajor: AntMorph = {
  ...ecitonMinor,
  key: 'eciton_major',
  L: 11,
  head: { len: 0.3, width: 0.32, height: 0.19, shape: 'round', frontMix: 0.45, sockets: 1 },
  eyes: { size: 0.03, pos: 0.5, height: 0.25, ocelli: false, single: true },
  antenna: { segments: 12, scape: 0.75, funiculus: 1.05, club: 0, thick: 0.0082 },
  mandible: { type: 'falcate', len: 1.15, teeth: 0, width: 0.2, hook: 1, barb: 1 },
  meso: { len: 0.3, width: 0.1, height: 0.115 },
  gaster: { len: 0.27, width: 0.16, height: 0.13, sting: true, segs: 5 },
  legs: { hind: 1.4, thick: 0.0108 },
  look: {
    ...EC_TAN,
    head: L(0xaa9868, 0.38, 0.18, 0.05, 0x867244), // the package's #BCAC7C, a little darker (it read as white under the game's sun)
    mandible: L(0x0e0e10, 0.3, 0.4, 0, 0x060606),
    meso: L(0x8a4a28, 0.42, 0.22, 0.05, 0xa8683a),
    waist: L(0x8a4a28, 0.42, 0.18, 0.05, 0xa8683a),
  },
  stance: 0.19,
};

/** Queen (dichthadiigyne): wingless, one very broad petiole, a long plated gaster that swells with eggs (`swell`). */
const ecitonQueen: AntMorph = {
  ...ecitonMinor,
  key: 'eciton_queen',
  L: 22,
  head: { len: 0.18, width: 0.19, height: 0.125, shape: 'round', frontMix: 0.3 },
  eyes: { size: 0.02, pos: 0.5, height: 0.25, ocelli: false, single: true },
  antenna: { segments: 12, scape: 0.6, funiculus: 0.8, club: 0, thick: 0.007 },
  mandible: { type: 'falcate', len: 0.55, teeth: 0, width: 0.3, hook: 0.5 },
  meso: { len: 0.24, width: 0.11, height: 0.11 },
  waist: { nodes: 1, len: 0.06, scale: false, nodeH: 0.07, thick: 2.2 },
  gaster: { len: 0.55, width: 0.24, height: 0.2, sting: true, segs: 7, stripes: 7, stripeW: 0.22, physo: 1 },
  legs: { hind: 0.8, thick: 0.0095 },
  look: {
    ...EC_DARK,
    head: L(0x5a2418, 0.4, 0.26, 0.05, 0x7a3a24),
    meso: L(0x5a2418, 0.42, 0.22, 0.05, 0x7a3a24),
    waist: L(0x5a2418, 0.42, 0.2, 0.05, 0x7a3a24),
    gaster: L(0x32180f, 0.36, 0.3, 0.04, 0xb89068),
    legs: L(0x6e2e1a, 0.45, 0.14, 0.06, 0x9a5a3a),
    mandible: L(0x2a1612, 0.36, 0.32, 0, 0x120a08),
  },
  hair: 0.3,
  stance: 0.14,
  gait: { lift: 0.25, duty: 0.6 },
  wingScars: false,
};

// ---------- Formica plagiaria (fictional; modelled on F. sanguinea) ----------
const plagiariaWorker: AntMorph = {
  ...formicaWorker,
  key: 'plagiaria_worker',
  L: 6.5,
  head: { len: 0.24, width: 0.23, height: 0.15, shape: 'tri' },
  look: {
    head: L(0x1c120d, 0.42, 0.22, 0.1, 0x7a2416),
    meso: L(0x7e2216, 0.45, 0.18, 0.08, 0x5a180e),
    waist: L(0x6a1e12, 0.45, 0.18, 0.08),
    gaster: L(0x15100c, 0.32, 0.4, 0.15, 0x3a2a18),
    legs: L(0x3a2418, 0.45, 0.15, 0.08, 0x6a3a22),
    antenna: L(0x3a2418, 0.45, 0.12, 0.06, 0x5a3a24),
    mandible: L(0x6a2414, 0.4, 0.3, 0),
  },
  hair: 0.25,
};

const plagiariaQueen: AntMorph = {
  ...plagiariaWorker,
  key: 'plagiaria_queen',
  L: 10,
  head: { len: 0.17, width: 0.17, height: 0.11, shape: 'tri' },
  meso: { len: 0.32, width: 0.17, height: 0.19, queen: true },
  waist: { nodes: 1, len: 0.035, scale: true, nodeH: 0.11 },
  gaster: { len: 0.48, width: 0.28, height: 0.23, sting: false },
  legs: { hind: 0.75, thick: 0.0116 },
  wingScars: true,
  stance: 0.12,
};

import { HELL_MORPHS } from './hellMorphs';
import { SAIY_MORPHS } from './saiyMorphs';
import { TERMANT_MORPHS } from './termantMorphs';

export const MORPHS: Record<string, AntMorph> = {
  ...(HELL_MORPHS as unknown as Record<string, AntMorph>),
  ...(SAIY_MORPHS as unknown as Record<string, AntMorph>),
  ...TERMANT_MORPHS,
  plagiaria_worker: plagiariaWorker,
  plagiaria_queen: plagiariaQueen,
  lasius_worker: lasiusWorker,
  lasius_soldier: lasiusSoldier,
  lasius_queen: lasiusQueen,
  formica_worker: formicaWorker,
  formica_soldier: formicaSoldier,
  formica_mortar: formicaMortar,
  formica_rapid: formicaRapid,
  formica_queen: formicaQueen,
  atta_minim: attaMinim,
  atta_media: attaMedia,
  atta_soldier: attaSoldier,
  atta_major: attaMajor,
  atta_queen: attaQueen,
  fire_minor: fireMinor,
  fire_major: fireMajor,
  fire_queen: fireQueen,
  eciton_minor: ecitonMinor,
  eciton_submajor: ecitonSubmajor,
  eciton_media: ecitonMedia,
  eciton_major: ecitonMajor,
  /** the old army-ant soldier id: an alias of the Soldier (major) for saves and URLs */
  eciton_soldier: ecitonMajor,
  eciton_queen: ecitonQueen,
};
