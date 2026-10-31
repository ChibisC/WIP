/**
 * Ant morphology parameters per species × caste, taken from the reference
 * notes in docs/creatures. Lengths are fractions of body length L unless
 * noted; colours are linear-ish sRGB hex.
 */
import type { MandibleSpec } from '../anatomy/mandible';
import { ECITON_MINOR_JAW, ATTA_MAJOR_JAW, ATTA_MEDIA_JAW, ATTA_MINIM_JAW, ATTA_SOLDIER_JAW, FIRE_MAJOR, FIRE_WORKER, FORMICA_WORKER, LASIUS_WORKER } from '../anatomy/mandibleSpecs';

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
  eyes: { size: number; pos: number; height: number; ocelli: boolean; single?: boolean; none?: boolean; /** length ÷ height of the eye (default 1.15) */ oval?: number };
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
    /**
     * jaws pass: built by the shared parametric generator from this spec (render/anatomy/mandibleSpecs.ts; the
     * numbers in the species' docs/creatures/<id>.md), its length fitted so a closed pair meets in front of the head
     */
    spec?: MandibleSpec;
    /** how far each mandible swings open at full gape (rad; default .95) */
    open?: number;
  };
  /** `smooth`: one even arch, no metanotal groove (Saiy-Ants, Termants) */
  meso: { len: number; width: number; height: number; queen?: boolean; smooth?: boolean; spines?: { pro?: number; meso?: number; prop?: number }; /** worker profile: groove depth (default 0.16), propodeum height (0.62), the waist of the mesosoma seen from above (0.12) */ groove?: number; prop?: number; pinch?: number; /** formicines: the pronotum slopes down into the neck over this much of the length (default: a short steep front) */ neck?: number };
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
    /** formicines: the acidopore's hair ring this much bigger (a sprayer's nozzle shows; default 1) */
    pore?: number;
    /** dark gut contents showing through a pale abdomen (Termants): colour */
    gut?: number;
    /** soft abdomen: jiggles and sways with the stride (vertex shader `uSoft`) */
    soft?: number;
  };
  /**
   * realism pass v2 (docs/realism): curved tapered setae, jointed legs with the knee membrane and leg hairs,
   * baked occlusion and edge convexity (LOD0)
   */
  real?: boolean;
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
  /** realism pass: erect setae on the head, mesosoma and gaster (counts at LOD0), their colour and length range (fractions of L) */
  setae?: { color: number; head: number; meso: number; gaster?: number; len?: [number, number] };
  wingScars?: boolean;
  /** Walking body height above ground as a fraction of L. */
  stance: number;
}

const L = (color: number, rough: number, coat: number, sheen: number, color2?: number): PartLook => ({ color, color2, rough, coat, sheen });

// ---------- Lasius niger ----------
const lasiusWorker: AntMorph = {
  key: 'lasius_worker',
  L: 4,
  // (overnight review round 1: the head deeper — a rounded box, not a flat lid)
  head: { len: 0.21, width: 0.2, height: 0.16, shape: 'rect' },
  // (overnight spec 3.4: three tiny ocelli on the vertex — the realism ocelli are glints set into it)
  eyes: { size: 0.27, pos: 0.5, height: 0.08, ocelli: true },
  // (the user's photos: slender antennae and legs, lighter brown)
  antenna: { segments: 12, scape: 1.0, funiculus: 1.25, club: 0, thick: 0.0072 },
  // rollout batch 1: the formicine jaw generator (8 teeth, closing neatly in front of the clypeus)
  mandible: { type: 'triangular', len: 0.42, teeth: 8, width: 0.55, spec: LASIUS_WORKER, open: 0.7 },
  // (overnight review round 1: one continuous convex profile, not stepped blocks)
  meso: { len: 0.32, width: 0.145, height: 0.13, groove: 0.13, prop: 0.6, neck: 0.075 },
  waist: { nodes: 1, len: 0.05, scale: true, nodeH: 0.1 },
  // (the photos: a broad, rounded oval, about as wide as the head or wider)
  // (review round 2: a broad, rounded gaster, glossy under the pubescence — not a pointed matte spindle)
  gaster: { len: 0.38, width: 0.28, height: 0.23, sting: false },
  // (overnight review round 1: the photos' legs are about half again as thick — the femora stout)
  legs: { hind: 0.86, thick: 0.0158 },
  // (rollout batch 1, the user's photos: dark brown, not black; the mesosoma a shade paler; a satin, faintly grey
  // sheen from the pubescence; legs brown, paler and more orange toward the tarsi)
  // (overnight colour check, docs/realism/lasius-niger: the renders sampled 20–30 L* darker than the photos and
  // over-saturated — lighter, more neutral browns; spec 02 cause 3)
  look: {
    // (review round 1: uniformly dark — the mesosoma no paler than the head; legs a translucent brown, not tan;
    // a grey pubescent sheen on the gaster)
    // (review round 2: too warm, milk-chocolate — a dark grey-black-brown; the legs an amber brown, lighter toward
    // the tarsi without a hard break)
    head: L(0x3a322c, 0.5, 0.14, 0.3),
    meso: L(0x3e342c, 0.5, 0.14, 0.26),
    waist: L(0x3a302a, 0.52, 0.12, 0.18),
    // (review round 3: satin and pubescent, between the round-1 matte and the round-2 gloss)
    gaster: L(0x36302a, 0.48, 0.16, 0.62),
    legs: L(0x4a3a2c, 0.48, 0.12, 0.15, 0x5e4a38),
    // (scapes lighter, yellowish brown; mandibles and knees too: AntWiki, Wilson 1955, Borowiec & Salata 2022)
    antenna: L(0x544030, 0.56, 0.06, 0.15, 0x46362a),
    mandible: L(0x2e2016, 0.55, 0.12, 0.0),
  },
  hair: 0.6,
  // erect hairs on the gaster (and scapes and tibiae, diagnostic); fine, pale greyish, short
  // (review round 1: the hairs read as white scratches — darker, a golden grey)
  setae: { color: 0x6e6254, head: 22, meso: 16, gaster: 80, len: [0.012, 0.05] },
  real: true,
  stance: 0.13,
};

/** Lasius soldier: a larger worker (L. niger workers run 3–5 mm) with a broader head and stronger jaws. */
const lasiusSoldier: AntMorph = {
  ...lasiusWorker,
  key: 'lasius_soldier',
  L: 4.9,
  head: { len: 0.25, width: 0.245, height: 0.165, shape: 'rect' },
  eyes: { size: 0.2, pos: 0.52, height: 0.15, ocelli: true },
  mandible: { type: 'triangular', len: 0.46, teeth: 8, width: 0.62, spec: LASIUS_WORKER, open: 0.7 },
  meso: { len: 0.31, width: 0.14, height: 0.14, neck: 0.075 },
  legs: { hind: 0.84, thick: 0.019 },
};

const lasiusQueen: AntMorph = {
  ...lasiusWorker,
  key: 'lasius_queen',
  L: 8.5,
  head: { len: 0.15, width: 0.15, height: 0.1, shape: 'rect' },
  eyes: { size: 0.24, pos: 0.5, height: 0.2, ocelli: true },
  antenna: { ...lasiusWorker.antenna, scape: 0.95, funiculus: 1.2 },
  mandible: { ...lasiusWorker.mandible, len: 0.34 },
  // (the user's photo: a tall, bulky mesosoma and a huge rounded gaster, legs orange-brown)
  meso: { len: 0.3, width: 0.19, height: 0.22, queen: true },
  waist: { nodes: 1, len: 0.035, scale: true, nodeH: 0.11 },
  gaster: { len: 0.5, width: 0.35, height: 0.31, sting: false },
  legs: { hind: 0.62, thick: 0.0115 },
  look: { ...lasiusWorker.look, gaster: L(0x2e2116, 0.42, 0.28, 0.36), meso: L(0x332419, 0.5, 0.15, 0.25), legs: L(0x6a4426, 0.5, 0.1, 0.12, 0x9a6a3a) },
  wingScars: true,
  stance: 0.1,
};

// ---------- Formica rufa ----------
const formicaWorker: AntMorph = {
  key: 'formica_worker',
  L: 7,
  // (overnight review round 1: deeper, rounder head as in the side photos)
  // (review round 1: broad and rounded-trapezoidal with convex sides, not a wedge: the realism 'rect' outline)
  head: { len: 0.225, width: 0.22, height: 0.165, shape: 'rect' },
  // elongate oval, ~0.27 of the head's length (AntWiki: Borowiec & Salata 2022)
  eyes: { size: 0.31, pos: 0.48, height: 0.12, ocelli: true, oval: 1.3 },
  antenna: { segments: 12, scape: 1.15, funiculus: 1.2, club: 0, thick: 0.0064 },
  mandible: { type: 'triangular', len: 0.4, teeth: 8, width: 0.6, spec: FORMICA_WORKER, open: 0.7 },
  // (rollout batch 1, the user's photos: the mesonotal groove deep and the propodeum high and rounded; the
  // mesosoma pinched in the middle seen from above)
  meso: { len: 0.34, width: 0.145, height: 0.13, groove: 0.12, prop: 0.6, pinch: 0.12, neck: 0.075 },
  // (overnight review round 1: the scale no taller than the propodeum, not a fin)
  waist: { nodes: 1, len: 0.05, scale: true, nodeH: 0.1 },
  // (the photos: a big, broad oval gaster)
  // (review round 2: rounder and glossy black-brown, wider than the head)
  gaster: { len: 0.37, width: 0.27, height: 0.23, sting: false },
  legs: { hind: 0.95, thick: 0.0148 },
  // (the photos: dull, microreticulate and finely pubescent everywhere — a satin at most, never a gloss)
  look: {
    // (overnight colour check, docs/realism/formica-rufa: the renders sampled 15–25 L* darker than the photos
    // and over-saturated — lighter, less saturated reds and browns)
    // (review round 1: deep rust red, not a flat bright orange; darker dorsal patches)
    head: L(0x3a2c24, 0.6, 0.08, 0.2, 0x8e4a32),
    meso: L(0x94482e, 0.62, 0.06, 0.18, 0x3a2a20),
    waist: L(0x5a2c1e, 0.6, 0.06, 0.14),
    // dark grey-brown, dull under a silvery pubescence, the hind margins of the tergites pale
    gaster: L(0x3a302a, 0.48, 0.16, 0.62, 0x56362a),
    // (the photos: coxae and femora reddish brown at the base, the tibiae and tarsi dark)
    // (review round 2: the legs read as thick orange tubes — dark, the coxae only a little reddish)
    legs: L(0x3e2820, 0.5, 0.12, 0.15, 0x2a1e18),
    antenna: L(0x2a1d16, 0.5, 0.1, 0.1, 0x553a2a),
    mandible: L(0x52281a, 0.45, 0.25, 0),
  },
  hair: 0.35,
  // sparse erect hairs (rufa is hairier than polyctena): head, pronotum, gaster
  // (the photos: the gaster bristles with erect hairs in silhouette)
  setae: { color: 0x7a6a58, head: 18, meso: 16, gaster: 90, len: [0.015, 0.07] },
  real: true,
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
  // (overnight spec 3.3: the queen's mesosoma darker, red-brown to blackish on top; her gaster shinier)
  look: { ...formicaWorker.look, meso: L(0x5e2614, 0.5, 0.14, 0.14, 0x1c120c), gaster: L(0x2e2420, 0.42, 0.26, 0.45, 0x4a2c20) },
  wingScars: true,
  stance: 0.12,
};

/** Wood ant soldier (tank): the biggest workers — broad head, heavy jaws, thick legs, a darker shield of a pronotum. */
const formicaSoldier: AntMorph = {
  ...formicaWorker,
  key: 'formica_soldier',
  L: 8.6,
  head: { len: 0.27, width: 0.28, height: 0.19, shape: 'rect' },
  eyes: { size: 0.26, pos: 0.48, height: 0.25, ocelli: true },
  mandible: { type: 'triangular', len: 0.46, teeth: 8, width: 0.7, spec: FORMICA_WORKER, open: 0.7 },
  meso: { len: 0.33, width: 0.145, height: 0.15, neck: 0.075 },
  gaster: { len: 0.35, width: 0.22, height: 0.18, sting: false },
  legs: { hind: 0.9, thick: 0.0195 },
  look: {
    ...formicaWorker.look,
    head: L(0x2e221c, 0.58, 0.1, 0.18, 0x7e3e28),
    meso: L(0x7a3a24, 0.45, 0.18, 0.1, 0x2a1c14),
  },
};

/** Mortar sprayer: a swollen, glossy acid-filled gaster for long lobbed shots. */
const formicaMortar: AntMorph = {
  ...formicaWorker,
  key: 'formica_mortar',
  L: 7.6,
  meso: { len: 0.31, width: 0.12, height: 0.13, neck: 0.075 },
  // (overnight spec 3.3: a bigger, more muscular gaster — the acid reservoir — and a visible acidopore)
  gaster: { len: 0.44, width: 0.27, height: 0.22, sting: false, pore: 1.7 },
  legs: { hind: 0.9, thick: 0.017 },
  look: { ...formicaWorker.look, gaster: L(0x1a120c, 0.28, 0.45, 0.2, 0x5a3418) },
};

/** Rapid sprayer: slimmer, long gaster with a red base, for quick jets. */
const formicaRapid: AntMorph = {
  ...formicaWorker,
  key: 'formica_rapid',
  L: 7.2,
  meso: { len: 0.33, width: 0.115, height: 0.125, neck: 0.075 },
  gaster: { len: 0.4, width: 0.215, height: 0.17, sting: false, pore: 1.5 },
  look: { ...formicaWorker.look, gaster: L(0x1c120d, 0.36, 0.3, 0.22, 0x7a3018) },
};

// ---------- Atta cephalotes ----------
// (overnight realism pass, docs/creatures/atta-cephalotes.md: rusty orange-brown, matte and finely tuberculate with
// short hooked golden hairs; legs a shade lighter; the teeth near black; the major's head deep chestnut and shining;
// the minim paler, orange-tan; the queen dark chestnut)
// (Atta review round 1: not one brick colour — orange on the head grading to dark red-brown on the body)
const attaLook = {
  head: L(0x8a4222, 0.64, 0.08, 0.12, 0x6a3018),
  meso: L(0x6e301a, 0.66, 0.06, 0.12, 0x5a2814),
  waist: L(0x642c18, 0.66, 0.06, 0.1),
  gaster: L(0x5e2a18, 0.62, 0.08, 0.16, 0x4a2214),
  // (review round 2: the legs dark red-brown like the body, not orange)
  legs: L(0x5e2c18, 0.6, 0.06, 0.1, 0x4e2414),
  antenna: L(0x8a4826, 0.64, 0.05, 0.08, 0x9a5630),
  mandible: L(0x5a2410, 0.4, 0.3, 0, 0x1a0a04),
};
// short, curved, golden hairs over everything (hooked at the tip in life: too small to model)
// (review round 3: a dense coat of short golden hairs, not a few pins)
const attaSetae = { color: 0xb88a50, head: 130, meso: 120, gaster: 160, len: [0.01, 0.035] as [number, number] };

const attaMedia: AntMorph = {
  key: 'atta_media',
  L: 8,
  head: { len: 0.3, width: 0.3, height: 0.19, shape: 'heart', notch: 0.22, occSpines: 0.14, groove: 0.14 },
  eyes: { size: 0.18, pos: 0.6, height: 0.12, ocelli: false, oval: 1.25 },
  antenna: { segments: 11, scape: 0.95, funiculus: 1.3, club: 0, thick: 0.009 },
  mandible: { type: 'triangular', len: 0.36, teeth: 8, width: 0.6, spec: ATTA_MEDIA_JAW, open: 0.7 },
  meso: { len: 0.3, width: 0.13, height: 0.14, spines: { pro: 0.09, meso: 0.07, prop: 0.08 } },
  waist: { nodes: 2, len: 0.1, nodeH: 0.08 },
  // (review round 2: a small gaster for the body, not a big round ball)
  gaster: { len: 0.22, width: 0.17, height: 0.14, sting: true },
  legs: { hind: 1.2, thick: 0.0125 },
  look: attaLook,
  hair: 0.2,
  setae: attaSetae,
  real: true,
  stance: 0.15,
};

const attaMinim: AntMorph = {
  ...attaMedia,
  key: 'atta_minim',
  L: 2,
  head: { len: 0.27, width: 0.25, height: 0.18, shape: 'round', notch: 0.05 },
  eyes: { size: 0.16, pos: 0.6, height: 0.2, ocelli: false },
  mandible: { type: 'triangular', len: 0.33, teeth: 6, width: 0.55, spec: ATTA_MINIM_JAW, open: 0.7 },
  meso: { len: 0.3, width: 0.13, height: 0.14, spines: { pro: 0.05, meso: 0.04, prop: 0.05 } },
  gaster: { len: 0.3, width: 0.21, height: 0.17, sting: true },
  legs: { hind: 1.05, thick: 0.0175 },
  // paler, orange-tan
  look: { ...attaLook, head: L(0xb06a38, 0.62, 0.06, 0.12, 0x9a5a2c), meso: L(0xb06a38, 0.66, 0.05, 0.12), waist: L(0xa86234, 0.66, 0.05, 0.1), gaster: L(0x9e5a30, 0.58, 0.1, 0.18), legs: L(0xb8743e, 0.6, 0.06, 0.1, 0xc2804a), antenna: L(0xb8743e, 0.62, 0.05, 0.08) },
  setae: { ...attaSetae, head: 18, meso: 16, gaster: 30 },
  stance: 0.15,
};

/** Atta soldier: the big-headed trail guard between the media and the major — a heart head with small occipital spines, heavy shears. */
const attaSoldier: AntMorph = {
  ...attaMedia,
  key: 'atta_soldier',
  L: 10.5,
  head: { len: 0.33, width: 0.36, height: 0.2, shape: 'heart', notch: 0.22, occSpines: 0.07, groove: 0.14 },
  eyes: { size: 0.15, pos: 0.6, height: 0.12, ocelli: false, oval: 1.25 },
  antenna: { segments: 11, scape: 0.8, funiculus: 1.25, club: 0, thick: 0.0085 },
  mandible: { type: 'massive', len: 0.38, teeth: 8, width: 0.68, spec: ATTA_SOLDIER_JAW, open: 0.6 },
  meso: { len: 0.28, width: 0.12, height: 0.14, spines: { pro: 0.07, meso: 0.05, prop: 0.06 } },
  gaster: { len: 0.25, width: 0.18, height: 0.15, sting: true },
  legs: { hind: 1.1, thick: 0.015 },
  look: { ...attaLook, head: L(0x7a3418, 0.48, 0.2, 0.08, 0x5a2410) },
};

/** Atta major: a disproportionately huge, deeply lobed head — smooth and shining (A. cephalotes) — with short blunt occipital spines and heavy shears. */
const attaMajor: AntMorph = {
  ...attaMedia,
  key: 'atta_major',
  L: 14,
  // (the photos: two big rounded lobes split by a deep median groove)
  head: { len: 0.4, width: 0.44, height: 0.24, shape: 'heart', notch: 0.3, occSpines: 0.04, groove: 0.2 },
  eyes: { size: 0.11, pos: 0.64, height: 0.1, ocelli: false, oval: 1.25 },
  antenna: { segments: 11, scape: 0.7, funiculus: 1.2, club: 0, thick: 0.0072 },
  mandible: { type: 'massive', len: 0.36, teeth: 8, width: 0.75, spec: ATTA_MAJOR_JAW, open: 0.55 },
  meso: { len: 0.25, width: 0.11, height: 0.12, spines: { pro: 0.07, meso: 0.06, prop: 0.06 } },
  waist: { nodes: 2, len: 0.08, nodeH: 0.07 },
  gaster: { len: 0.22, width: 0.16, height: 0.13, sting: true },
  legs: { hind: 1.0, thick: 0.0135 },
  // the head deep chestnut, shining; the frontal woolly tufts as a dense patch of longer red hairs on the head
  // (review round 1: mirror-glossy read as chocolate — a satin shine over the smooth cuticle)
  // (review rounds 1–2: any gloss read as plastic or chocolate — the user's major photos are matte and sculptured; the
  // photos win over the key's "shining")
  look: { ...attaLook, head: L(0x7a3018, 0.58, 0.12, 0.1, 0x5c2a16) },
  setae: { ...attaSetae, color: 0xa0502a, head: 70, len: [0.006, 0.026] },
  stance: 0.14,
};

const attaQueen: AntMorph = {
  ...attaMedia,
  key: 'atta_queen',
  L: 21,
  // (Borgmeier: head width 5.2 mm; no occipital tooth)
  head: { len: 0.22, width: 0.27, height: 0.15, shape: 'heart', notch: 0.12 },
  eyes: { size: 0.2, pos: 0.6, height: 0.2, ocelli: true },
  antenna: { segments: 11, scape: 0.95, funiculus: 1.2, club: 0, thick: 0.0062 },
  mandible: { type: 'triangular', len: 0.36, teeth: 8, width: 0.6, spec: ATTA_MEDIA_JAW, open: 0.6 },
  // (review round 2: a massive mesosoma, much taller than the head)
  meso: { len: 0.28, width: 0.18, height: 0.22, queen: true, spines: { pro: 0.03, meso: 0, prop: 0.03 } },
  waist: { nodes: 2, len: 0.06, nodeH: 0.06 },
  // (review round 1: huge and rounded, not a sausage)
  // (review round 3: globular, nearly as tall as long)
  gaster: { len: 0.4, width: 0.36, height: 0.34, sting: true },
  legs: { hind: 0.7, thick: 0.0115 },
  // dark chestnut, golden hairs, a satin gaster (Naskrecki's queen; the caste series)
  look: { ...attaLook, head: L(0x5a2a16, 0.55, 0.12, 0.14, 0x48200f), meso: L(0x5e2c18, 0.52, 0.14, 0.14), waist: L(0x5a2a16, 0.55, 0.1, 0.12), gaster: L(0x52261a, 0.42, 0.22, 0.3, 0x3e1c10), legs: L(0x6a3018, 0.56, 0.08, 0.1, 0x7a3a1e) },
  setae: { ...attaSetae, color: 0xc89a58, head: 40, meso: 50, gaster: 120, len: [0.006, 0.022] },
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
// realism v2 (docs/realism/references.md): muted reddish-brown, not saturated orange; the gaster dark brown
// behind its paler base; legs and antennae a lighter yellowish brown, the club darker
const fireLook = {
  // sampled from the reference photos: saturated amber to reddish brown (hue ~20°), very shiny
  head: L(0x8a3014, 0.2, 0.8, 0.02, 0x963a16),
  meso: L(0x8e3a14, 0.2, 0.8, 0.02),
  waist: L(0x8a3a14, 0.24, 0.7, 0.02),
  gaster: L(0x4a2010, 0.18, 0.85, 0.03, 0x8a3c12),
  // legs and antennae the body's amber (a little lighter toward the tips), not a separate pale tan
  legs: L(0x8e3e18, 0.24, 0.65, 0.03, 0x9a4a1e),
  antenna: L(0x8e4018, 0.28, 0.5, 0.03, 0x5c2a12),
  mandible: L(0x5a2c16, 0.32, 0.32, 0, 0x2a120a),
};

const fireMinor: AntMorph = {
  key: 'fire_minor',
  L: 2.8,
  // (jaws pass: a little longer than wide, as in the photos)
  head: { len: 0.27, width: 0.25, height: 0.17, shape: 'rect', notch: 0.07, carinae: 0.022 },
  eyes: { size: 0.14, pos: 0.6, height: 0.15, ocelli: false },
  // (jaws review: slimmer scapes, as in the photos)
  antenna: { segments: 10, scape: 0.95, funiculus: 1.15, club: 2, thick: 0.0118 },
  // jaws pass: triangular plates with four teeth, closing in front of the clypeus; open 60–90° apart
  mandible: { type: 'triangular', len: 0.3, teeth: 4, width: 0.55, spec: FIRE_WORKER, open: 0.7 },
  meso: { len: 0.3, width: 0.145, height: 0.13 },
  waist: { nodes: 2, len: 0.11, nodeH: 0.085, petW: 0.27, postW: 0.29, postH: 0.82, crest: true, subTooth: 0.026 },
  gaster: { len: 0.33, width: 0.26, height: 0.21, sting: true },
  legs: { hind: 0.74, thick: 0.0125 },
  look: fireLook,
  hair: 0.7,
  // abundant long, pale golden erect hairs (docs/creatures/fire-ant.md)
  // erect, thin, yellowish (paler than the body, not gold), most short, some to ~0.3 mm
  // many pale erect setae of mixed length, densest on the gaster (they catch the light in the silhouette)
  setae: { color: 0xc8aa80, head: 56, meso: 46, gaster: 150, len: [0.018, 0.09] },
  real: true,
  stance: 0.12,
};

/** S. geminata major: the worker's body with a huge, square head (deep groove and back notch) and blunt black seed-milling jaws. */
const fireMajor: AntMorph = {
  ...fireMinor,
  key: 'fire_major',
  L: 6,
  // (jaws pass: the front of the head darkens toward the black jaws, photos fire_02 and fire_04)
  head: { len: 0.34, width: 0.37, height: 0.215, shape: 'square', notch: 0.22, groove: 0.16, carinae: 0.014, frontMix: 0.95 },
  eyes: { size: 0.075, pos: 0.62, height: 0.15, ocelli: false },
  antenna: { segments: 10, scape: 0.55, funiculus: 1.0, club: 2, thick: 0.0105 },
  mandible: { type: 'massive', len: 0.32, teeth: 2, width: 0.75, spec: FIRE_MAJOR, open: 0.55 },
  meso: { len: 0.26, width: 0.112, height: 0.122 },
  waist: { nodes: 2, len: 0.095, nodeH: 0.075, petW: 0.27, postW: 0.29, postH: 0.82, crest: true, subTooth: 0.02 },
  gaster: { len: 0.29, width: 0.19, height: 0.158, sting: true },
  legs: { hind: 0.78, thick: 0.019 },
  look: { ...fireLook, head: L(0x7a3010, 0.24, 0.45, 0.04, 0x2e1208), mandible: L(0x2a0e06, 0.2, 0.6, 0, 0x0a0503) },
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
  mandible: { type: 'triangular', len: 0.3, teeth: 4, width: 0.6, spec: FIRE_WORKER, open: 0.7 },
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
// (overnight review round 1: the saturated orange read as a grub — a dull rust-brown oval, the user's photos)
const EC_GASTER = L(0x7e4020, 0.48, 0.16, 0.08, 0x6a341a); // rust-amber, faint darker segment bands
const EC_DARK = {
  // (review round 1: glossy plastic black — a duller, finely sculptured black)
  head: L(0x1e1c1c, 0.5, 0.14, 0.05, 0x2e2a28),
  meso: L(0x261c18, 0.55, 0.1, 0.05, 0x3a2a22),
  waist: L(0x3a2218, 0.42, 0.18, 0.05, 0x4a2a1c),
  gaster: EC_GASTER,
  legs: L(0x4a2416, 0.5, 0.12, 0.06, 0x5e3420), // color2: a little paler toward the tarsi (review: not blond)
  antenna: L(0x3a2218, 0.45, 0.14, 0.05, 0x6a4a32),
  mandible: L(0x2a1a12, 0.38, 0.3, 0, 0x120c0a),
};
const EC_TAN = {
  ...EC_DARK,
  meso: L(0x6e2e1a, 0.42, 0.22, 0.05, 0x8a4a2c),
  waist: L(0x6e2e1a, 0.42, 0.18, 0.05, 0x8a4a2c),
  legs: L(0x6e2e1a, 0.5, 0.12, 0.06, 0x7e4428), // slightly paler tarsi (review: not blond)
  antenna: L(0x5a2818, 0.45, 0.14, 0.05, 0x8a5a3a),
};
const EC_GAIT = { lift: 0.42, duty: 0.5 }; // high-stepping and fast

const ecitonMinor: AntMorph = {
  key: 'eciton_minor',
  L: 4,
  head: { len: 0.2, width: 0.17, height: 0.14, shape: 'round', frontMix: 0.35 },
  eyes: { size: 0.05, pos: 0.55, height: 0.25, ocelli: false, single: true },
  antenna: { segments: 12, scape: 1.05, funiculus: 1.25, club: 0, thick: 0.0115 },
  mandible: { type: 'triangular', len: 0.3, teeth: 5, width: 0.42, spec: ECITON_MINOR_JAW, open: 0.7 },
  meso: { len: 0.36, width: 0.105, height: 0.12, groove: 0.06, prop: 0.5 },
  waist: { nodes: 2, len: 0.11, nodeH: 0.08 },
  // (review rounds 1–2: a ringed grub — fewer visible plates, a duller rust)
  gaster: { len: 0.3, width: 0.17, height: 0.145, sting: true, segs: 3 },
  legs: { hind: 1.5, thick: 0.0115 },
  look: EC_DARK,
  hair: 0.45,
  // (overnight pass: sparse, fine golden hairs, denser on the gaster and legs)
  setae: { color: 0xc09a60, head: 14, meso: 16, gaster: 60, len: [0.01, 0.045] },
  real: true,
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
  gaster: { len: 0.29, width: 0.165, height: 0.14, sting: true, segs: 3 },
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
  gaster: { len: 0.28, width: 0.165, height: 0.14, sting: true, segs: 3 },
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
  // (review round 1: a huge featureless egg — rounded-square, about the mesosoma's size, whitish tan on the vertex
  // shading to orange-brown over the frons and clypeus, pin eyes on the sides)
  head: { len: 0.24, width: 0.26, height: 0.17, shape: 'square', frontMix: 0.8, sockets: 1 },
  eyes: { size: 0.08, pos: 0.52, height: 0.15, ocelli: false, single: true },
  antenna: { segments: 12, scape: 0.75, funiculus: 1.05, club: 0, thick: 0.0082 },
  mandible: { type: 'falcate', len: 1.45, teeth: 0, width: 0.2, hook: 0.7, barb: 1 },
  meso: { len: 0.3, width: 0.1, height: 0.115 },
  gaster: { len: 0.27, width: 0.16, height: 0.13, sting: true, segs: 3 },
  legs: { hind: 1.4, thick: 0.0108 },
  look: {
    ...EC_TAN,
    head: L(0xc0aa7a, 0.42, 0.16, 0.08, 0xa0602e), // pale tan vertex → orange-brown frons and clypeus (frontMix)
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
  // (review round 1: dichthadiiform — a broad flattened head and mesosoma; short jaws, not a wire loop)
  head: { len: 0.18, width: 0.24, height: 0.12, shape: 'square', frontMix: 0.3 },
  eyes: { size: 0.02, pos: 0.5, height: 0.25, ocelli: false, single: true },
  antenna: { segments: 12, scape: 0.6, funiculus: 0.8, club: 0, thick: 0.007 },
  mandible: { type: 'falcate', len: 0.32, teeth: 0, width: 0.3, hook: 0.15 },
  meso: { len: 0.24, width: 0.16, height: 0.11 },
  // (review round 2: the petiole massive, almost as broad as the gaster)
  waist: { nodes: 1, len: 0.06, scale: false, nodeH: 0.09, thick: 3.2 },
  // (review round 1: a huge, broad, rounded dark gaster, glossy plates — not a striped spindle)
  gaster: { len: 0.55, width: 0.32, height: 0.26, sting: true, segs: 7, stripes: 7, stripeW: 0.14, physo: 1 },
  legs: { hind: 0.8, thick: 0.0095 },
  look: {
    ...EC_DARK,
    head: L(0x5a2418, 0.4, 0.26, 0.05, 0x7a3a24),
    meso: L(0x5a2418, 0.42, 0.22, 0.05, 0x7a3a24),
    waist: L(0x5a2418, 0.42, 0.2, 0.05, 0x7a3a24),
    gaster: L(0x3e1c10, 0.34, 0.3, 0.06, 0xa8845e),
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
