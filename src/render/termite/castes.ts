/**
 * Nasute Termites (Nasutitermes corniger): caste parameters for the parametric termite builder.
 *
 * Units: millimetres. Model frame: +X = forward (head), +Y = up, +Z = right side.
 * Origin = ground point under the thorax centre. Convert to world units with the game's mm->world
 * scale (multiply the instance matrix scale by UNITS_PER_MM).
 *
 * Proportions for the nasute soldier follow the user's reference-photo brief (fractions of total
 * body length L, excluding antennae):
 *   head incl. nasus 0.38 L (nasus 0.17 L), thorax 0.17 L, abdomen 0.45 L,
 *   widths: head 0.22 L, thorax 0.13 L, abdomen 0.25 L, antennae 0.4 L.
 * Sizes: worker 5-6 mm, soldier ~5 mm (UF/IFAS, FDACS). Colours: reference photos (live macro photo
 * and specimen photos), which read warmer than the "brown to black" wording of UF/IFAS.
 */

import { RHYNCHOTERMES_CASTES } from './castes-rhynchotermes';

export type SpeciesId = 'nasutitermes' | 'rhynchotermes';
export type NasuteCasteId = 'worker' | 'nasute' | 'major' | 'king' | 'queen' | 'larva';
/** v2: Sickle-Jaw Termites (Rhynchotermes perarmatus), see castes-rhynchotermes.ts */
export type SickleCasteId = 'rhy_worker' | 'rhy_soldier' | 'rhy_king' | 'rhy_queen' | 'rhy_larva';
export type CasteId = NasuteCasteId | SickleCasteId;

/** Row of each caste in the shared rig texture (do not reorder: baked into geometry as aCaste). */
export const CASTE_ROW: Record<CasteId | 'eggs', number> = {
  worker: 0,
  nasute: 1,
  major: 2,
  king: 3,
  queen: 4,
  larva: 5,
  eggs: 6, // eggs are shared by both species
  rhy_worker: 7,
  rhy_soldier: 8,
  rhy_king: 9,
  rhy_queen: 10,
  rhy_larva: 11,
};

/** castes of each species (render order for sheets / viewers) */
export const SPECIES_CASTES: Record<SpeciesId, CasteId[]> = {
  nasutitermes: ['worker', 'nasute', 'major', 'king', 'queen', 'larva'],
  rhynchotermes: ['rhy_worker', 'rhy_soldier', 'rhy_king', 'rhy_queen', 'rhy_larva'],
};

export interface CastePalette {
  head: string; // head capsule base
  headHi: string; // warmer tone toward the front / ventral side of the head
  headTip: string; // nasus tip / head edges (lighter, translucent)
  body: string; // thorax / abdomen base
  tergite: string; // darker band toward the rear margin of each tergite
  inter: string; // lighter translucent intersegmental band
  gut: string; // gut contents seen through the abdomen
  leg: string;
  legMid: string; // lighter middle of each leg/antenna segment
  legJoint: string; // darker joints
  hair: string;
  mandible: string;
  mandibleTip: string;
  suture?: string; // pale Y-shaped epicranial suture (workers)
  /** v2 'globe' heads: colour of the nasus tube (toward its tip) and of the darker band at its base */
  nasus?: string;
  nasusBase?: string;
  /** v2.1 royals: colour of the triangular wing-scale stubs */
  wingScale?: string;
}

/** v2: long sickle mandibles (Rhynchotermes soldier). Lengths in mm. */
export interface SickleParams {
  /** length along the curve (mm) */
  length: number;
  /** total turning of the blade (rad); ~2.6 = 150 deg, most of it beyond the marginal tooth */
  curve: number;
  /** blade width at the base (mm, in the swing plane) and thickness (mm, across it) */
  width: number;
  thickness: number;
  /** swing plane tilted down from the head axis by this angle (rad) */
  tilt: number;
  /** base position: z as a fraction of the head half-width */
  spread: number;
  /** marginal tooth position (0..1 along the blade) and length (mm) */
  tooth: number;
  toothLen: number;
  /** maximum gape (rad per mandible) for LUNGE / THREAT / RUSH */
  gape: number;
  /** ventral hook: the distal blade curls down out of the swing plane by this much at the tip (rad) */
  hook?: number;
  /** oblique hinge: opening also swings the blades up toward the head axis (rad mixed into the hinge axis) */
  hingeLift?: number;
}


export interface CasteParams {
  id: CasteId;
  label: string;
  /** total body length L (mm), excluding antennae (and mandibles for chewing castes) */
  bodyLength: number;
  /** length fractions of L: head capsule (bulb), nasus, thorax, abdomen */
  prop: { head: number; nasus: number; thorax: number; abdomen: number };
  /** maximum widths as fractions of L */
  width: { head: number; thorax: number; abdomen: number };
  /** vertical height / width ratios */
  height: { head: number; thorax: number; abdomen: number };
  /**
   * 'pear' nasute soldier; 'round' royals/larvae; v2 'globe' = domed capsule + long slender frontal tube;
   * v2.2 workers: 'dome' = high rounded dome (nasute), 'flat' = broad, flattened, flat-topped (sickle-jaw)
   */
  headShape: 'pear' | 'round' | 'globe' | 'dome' | 'flat';
  /**
   * pear heads: nasus base half-width (fraction of head half-width), tip radius (mm).
   * globe heads (v2) also use tubeRadius (mm, slender part), droop (mm the tip sits below a straight tube),
   * rise (nasus base centre above the head centre, fraction of head half-height).
   */
  nasus?: { baseFrac: number; tipRadius: number; tubeRadius?: number; droop?: number; rise?: number };
  mandibles: { kind: 'chewing' | 'vestigial' | 'sickle'; scale: number; sickle?: SickleParams };
  eyes: boolean;
  ocelli: boolean;
  wingScales: boolean;
  antenna: { beads: number; lengthFrac: number; radius: number };
  setae: { head: number; perTergite: number };
  /** leg lengths (front, mid, hind) as fractions of L; femur radius (mm at this caste's size) */
  legs: { length: [number, number, number]; radius: number; spread: number };
  /** belly clearance above the ground at rest (mm) */
  clearance: number;
  colors: CastePalette;
  /** 0..1 subsurface/translucency strength of soft cuticle */
  translucency: number;
  /** 0..1 strength of the dark gut patch */
  gut: number;
  /** gut patch spread along the abdomen (gaussian sigma in abdomen-length units) */
  gutSpread?: number;
  /** head clearcoat strength 0..1 */
  headCoat: number;
  gait: { amplitude: number; lift: number };
  /**
   * queen only: physogastric abdomen in absolute mm. v2.1 adds the pleated-roll shape: pleat (crease depth 0..0.3),
   * frontLift (mm the front rolls rise over the thorax; default from the thorax height), age (0 ivory .. 1 honey,
   * per-instance override via setFx({ age })), plate (dorsal plate half-angle, rad) and the three age colours.
   */
  physogastric?: {
    length: number;
    width: number;
    height: number;
    pleat?: number;
    frontLift?: number;
    age?: number;
    plate?: number;
    ivory?: string;
    amber?: string;
    honey?: string;
  };
  // ---- v2 (all optional; defaults reproduce the v1 nasute castes exactly) ----
  species?: SpeciesId;
  /** head rest pitch (rad, nose up); default HEAD_REST_PITCH 0.06 */
  headRest?: number;
  /** mandible rest opening (rad); default 0.12 */
  mandRest?: number;
  /** whitish fontanelle spot on the head (radius as a fraction of the head half-width); 0/undefined = none */
  fontanelle?: number;
  /** thorn-like process on the fore coxae (Rhynchotermes soldier) */
  coxaProcess?: boolean;
  /** items this caste can carry in its mandibles (default: worker -> wood + egg) */
  carryItems?: ('wood' | 'egg' | 'leaf')[];
  // ---- v2.1 (royals) ----
  /** pronotum shape: 'saddle' (default, raised front lobe) or 'shield' (broad and flat) */
  pronotum?: 'saddle' | 'shield';
  /** radial segments of the legs at LOD0 (default 6; royals use 8 for smooth slender legs) */
  legRadial?: number;
  // ---- v2.2 (distinct workers) ----
  /** contrast of the pale Y-shaped suture 0..1 (default 1 when palette.suture is set; 0 = none) */
  sutureStrength?: number;
  /** postclypeus (face plate) size multiplier (default 1) */
  clypeus?: number;
  /** abdomen outline: 'plump' (default), 'oval' (rounded egg) or 'long' (long slim cigar) */
  abdShape?: 'plump' | 'oval' | 'long';
}

const SOLDIER_COLORS: CastePalette = {
  head: '#4A1E12',
  headHi: '#7A3420',
  headTip: '#8C4A26',
  body: '#D98A3E',
  tergite: '#B9652A',
  inter: '#F0B472',
  gut: '#3E2617',
  leg: '#DE9D52',
  legMid: '#F2C27A',
  legJoint: '#B87534',
  hair: '#F3E6CC',
  mandible: '#6A3018',
  mandibleTip: '#3A160D',
};

// v2.1: N. corniger alates are dark brown to nearly black (UF/IFAS); dealate royals keep that colour
const ROYAL_COLORS: CastePalette = {
  head: '#2E1E14',
  headHi: '#3A2618',
  headTip: '#4A3220',
  body: '#2E1E14',
  tergite: '#3E2A1C', // abdominal plates
  inter: '#C9AE88', // pale membrane between the plates
  gut: '#2A1A10',
  leg: '#7A5636',
  legMid: '#8E6844',
  legJoint: '#5A3E26',
  hair: '#C9B08A',
  mandible: '#4A3220',
  mandibleTip: '#1A0E06',
  wingScale: '#24160C',
};

export const NASUTE_CASTES: Record<NasuteCasteId, CasteParams> = {
  nasute: {
    id: 'nasute',
    label: 'Nasute soldier',
    bodyLength: 5.0,
    // tuned against the specimen photos (top + side): bulb 0.225 L, nasus 0.155 L, plump round abdomen
    prop: { head: 0.24, nasus: 0.14, thorax: 0.13, abdomen: 0.37 },
    width: { head: 0.22, thorax: 0.13, abdomen: 0.28 },
    height: { head: 0.95, thorax: 0.9, abdomen: 1.0 },
    headShape: 'pear',
    nasus: { baseFrac: 0.36, tipRadius: 0.026 },
    mandibles: { kind: 'vestigial', scale: 1 },
    eyes: false,
    ocelli: false,
    wingScales: false,
    antenna: { beads: 13, lengthFrac: 0.4, radius: 0.064 },
    setae: { head: 6, perTergite: 5 },
    legs: { length: [0.37, 0.39, 0.46], radius: 0.092, spread: 1.0 },
    clearance: 0.32,
    colors: SOLDIER_COLORS,
    translucency: 0.75,
    gut: 0.75,
    headCoat: 1.0,
    gait: { amplitude: 0.34, lift: 0.42 },
  },
  major: {
    id: 'major',
    label: 'Major soldier',
    bodyLength: 6.5,
    // larger, broader, darker head; shorter, thicker nasus (gameplay caste; see reference doc)
    prop: { head: 0.27, nasus: 0.12, thorax: 0.16, abdomen: 0.45 },
    width: { head: 0.27, thorax: 0.14, abdomen: 0.25 },
    height: { head: 0.86, thorax: 0.72, abdomen: 0.8 },
    headShape: 'pear',
    nasus: { baseFrac: 0.3, tipRadius: 0.04 },
    mandibles: { kind: 'vestigial', scale: 1.3 },
    eyes: false,
    ocelli: false,
    wingScales: false,
    antenna: { beads: 13, lengthFrac: 0.36, radius: 0.062 },
    setae: { head: 6, perTergite: 5 },
    legs: { length: [0.36, 0.38, 0.44], radius: 0.1, spread: 1.0 },
    clearance: 0.38,
    colors: { ...SOLDIER_COLORS, head: '#3A160D', headHi: '#5E2716', headTip: '#7A3E20' },
    translucency: 0.7,
    gut: 0.7,
    headCoat: 1.0,
    gait: { amplitude: 0.32, lift: 0.4 },
  },
  worker: {
    id: 'worker',
    label: 'Worker',
    // v2.2: small, compact and round so it can't be mistaken for the lanky sickle-jaw worker: a high glossy
    // pale-straw dome of a head with faint sutures, short sturdy pale legs, short antennae, a plump oval abdomen.
    // 4.2 mm (male 3.9 / female 4.5: scale the instance by WORKER_VARIANT_SCALE)
    bodyLength: 4.2,
    prop: { head: 0.25, nasus: 0, thorax: 0.15, abdomen: 0.52 },
    width: { head: 0.3, thorax: 0.19, abdomen: 0.37 },
    height: { head: 0.92, thorax: 0.74, abdomen: 0.86 },
    headShape: 'dome',
    mandibles: { kind: 'chewing', scale: 0.72 },
    eyes: false,
    ocelli: false,
    wingScales: false,
    // 14 antennal articles (Fontes-style morphometrics of N. corniger workers), short
    antenna: { beads: 14, lengthFrac: 0.3, radius: 0.058 },
    setae: { head: 0, perTergite: 4 },
    legs: { length: [0.27, 0.29, 0.33], radius: 0.088, spread: 1.0 },
    clearance: 0.2,
    colors: {
      // pale straw #C9A266 per the brief; the albedo sits a touch deeper so it reads as that under bright light
      head: '#BF9455',
      headHi: '#C9A062',
      headTip: '#D9B87F',
      body: '#EED6A6',
      tergite: '#D6A866',
      inter: '#F7E8C8',
      gut: '#3E2617',
      leg: '#F1E3C2',
      legMid: '#F8EED8',
      legJoint: '#DCC59A',
      hair: '#F6EAD2',
      mandible: '#A8743C',
      mandibleTip: '#4A2410',
      suture: '#D4B47E', // faint: barely paler than the head
    },
    translucency: 0.75,
    gut: 0.9,
    gutSpread: 0.28,
    headCoat: 0.85,
    gait: { amplitude: 0.38, lift: 0.4 },
    sutureStrength: 0.35,
    clypeus: 0.9,
    abdShape: 'oval',
  },
  king: {
    id: 'king',
    label: 'King',
    // v2.1: ~1.45x worker length; modest abdomen (1.1-1.3x head + thorax); dark brown-black like the alates
    bodyLength: 8.0,
    prop: { head: 0.19, nasus: 0, thorax: 0.25, abdomen: 0.53 },
    width: { head: 0.175, thorax: 0.17, abdomen: 0.21 },
    height: { head: 0.74, thorax: 0.62, abdomen: 0.74 },
    headShape: 'round',
    mandibles: { kind: 'chewing', scale: 0.8 },
    eyes: true,
    ocelli: true,
    wingScales: true,
    antenna: { beads: 15, lengthFrac: 0.34, radius: 0.05 },
    setae: { head: 0, perTergite: 0 },
    legs: { length: [0.36, 0.4, 0.46], radius: 0.07, spread: 1.0 },
    clearance: 0.3,
    colors: ROYAL_COLORS,
    translucency: 0.12,
    gut: 0.0,
    headCoat: 0.7,
    gait: { amplitude: 0.3, lift: 0.36 },
    legRadial: 8,
  },
  queen: {
    id: 'queen',
    label: 'Queen',
    // head + thorax + legs identical to the king; physogastric abdomen (absolute mm, ~6x head + thorax)
    bodyLength: 8.0,
    prop: { head: 0.19, nasus: 0, thorax: 0.25, abdomen: 0.53 },
    width: { head: 0.175, thorax: 0.17, abdomen: 0.21 },
    height: { head: 0.74, thorax: 0.62, abdomen: 0.74 },
    headShape: 'round',
    mandibles: { kind: 'chewing', scale: 0.8 },
    eyes: true,
    ocelli: true,
    wingScales: true,
    antenna: { beads: 15, lengthFrac: 0.34, radius: 0.05 },
    setae: { head: 0, perTergite: 0 },
    legs: { length: [0.36, 0.4, 0.46], radius: 0.07, spread: 1.0 },
    clearance: 0.3,
    // plates (tergite) and sternites (inter) of the stretched abdomen
    colors: { ...ROYAL_COLORS, tergite: '#6A4A2A', inter: '#B89060' },
    translucency: 0.55,
    gut: 0.0,
    headCoat: 0.7,
    gait: { amplitude: 0.2, lift: 0.2 },
    physogastric: { length: 22, width: 4.9, height: 4.9, pleat: 0.17, age: 0.5 },
    legRadial: 8,
  },
  larva: {
    id: 'larva',
    label: 'Larva',
    // built at worker length; scale the instance 0.35 -> 0.85 while it grows on the brood tile
    bodyLength: 5.5,
    prop: { head: 0.25, nasus: 0, thorax: 0.14, abdomen: 0.56 },
    width: { head: 0.28, thorax: 0.18, abdomen: 0.29 },
    height: { head: 0.75, thorax: 0.72, abdomen: 0.8 },
    headShape: 'round',
    mandibles: { kind: 'chewing', scale: 0.5 },
    eyes: false,
    ocelli: false,
    wingScales: false,
    antenna: { beads: 13, lengthFrac: 0.26, radius: 0.055 },
    setae: { head: 0, perTergite: 0 },
    legs: { length: [0.22, 0.24, 0.27], radius: 0.085, spread: 0.85 },
    clearance: 0.12,
    colors: {
      head: '#F1E6D2',
      headHi: '#F4EADA',
      headTip: '#F6EFE2',
      body: '#F3E8D4',
      tergite: '#E9D2AE',
      inter: '#F8F1E4',
      gut: '#B89A72',
      leg: '#F3EBDD',
      legMid: '#F8F3EA',
      legJoint: '#E6D6BA',
      hair: '#FAF5EC',
      mandible: '#E9D9BC',
      mandibleTip: '#CDB48A',
    },
    translucency: 1.0,
    gut: 0.35,
    headCoat: 0.2,
    gait: { amplitude: 0.22, lift: 0.25 },
  },
};

/** every caste of every species */
export const CASTES: Record<CasteId, CasteParams> = { ...NASUTE_CASTES, ...RHYNCHOTERMES_CASTES };

/** Worker size variants (UF/IFAS: large workers are female, small are male). Apply as instance scale. */
export const WORKER_VARIANT_SCALE = { male: 3.9 / 4.2, female: 4.5 / 4.2 };

/** Pale colour of freshly moulted cuticle (presoldier = soldier mesh with tan 0). */
export const PALE = '#F6EEDF';
export const EGG_COLOR = '#F2E9D6';
export const WOOD_COLOR = '#8A6A44';
export const GLUE_COLOR = '#F3DFA8';
export const EYE_COLOR = '#120C08';
export const OCELLUS_COLOR = '#CDB48A';
/** v2: carried leaf-litter fragment, acid (clear to pale amber) */
export const LEAF_COLORS = ['#6B4A26', '#8A6232', '#4E3A1E', '#A07A3E'];
export const ACID_COLOR = '#F2E2A8';
export const ACID_HOT_COLOR = '#FFC65A';
