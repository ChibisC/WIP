/**
 * Sickle-Jaw Termites (Rhynchotermes perarmatus): caste parameters for the parametric termite builder.
 * Units and frame as castes.ts (mm; +X forward, +Y up, +Z right; origin under the thorax centre).
 *
 * Soldier, measured (see docs/rhynchotermes-perarmatus.md section 5):
 *   head length with nasus 2.5-2.6 mm (Snyder 1925); nasus ~1.5x the head capsule (Constantini & Cancello 2016);
 *   mandibles ~2/3 the nasus, evenly curved ~150 deg, conical marginal tooth, tips cross when closed;
 *   head width ~1.0 mm, pronotum ~0.63 mm (R. armatus x 1.24); hind tibia modelled at 1.45 mm (scaled value 1.72,
 *   shortened slightly to match the photos).
 * Soldier proportions from the user's reference photos (side view): head+nasus ~56% of the body,
 *   abdomen ~1.4x the head capsule, abdomen width ~0.75x head width -> total ~4.5 mm.
 * Worker: larger than the soldier, head ~1.45 mm wide, rounded from above, flattened top to bottom,
 *   transparent abdomen full of dark leaf-litter gut contents, whitish fontanelle.
 * Colours: the brief's photo-derived head hexes (soldier head #B8381E, highlights #E0603A, nasus #6E1A14,
 *   mandibles #7A1E16 -> tips #2A0E0A). Body, bands and legs were darkened from the brief's #E8C890 / #9A6A3A /
 *   #E9D49A to #D49E5C / #6E3E1E / #E6CA88 to match the photos under game-like lighting.
 */
import type { CasteParams, CastePalette, SickleCasteId } from './castes';

const SOLDIER: CastePalette = {
  head: '#B8381E',
  headHi: '#C4452A', // warmer front / underside
  headTip: '#E0603A', // glassy translucent rim highlight
  nasus: '#6E1A14',
  nasusBase: '#8E2A1A',
  body: '#D49E5C',
  tergite: '#6E3E1E',
  inter: '#F5E2B8',
  gut: '#4A3622',
  leg: '#E6CA88',
  legMid: '#F2DFAE',
  legJoint: '#C8A060',
  hair: '#F6EDD6',
  mandible: '#7A1E16',
  mandibleTip: '#2A0E0A',
};

// v2.1 RECONSTRUCTION (the R. perarmatus imago's colours are not published): warm reddish-brown, based on
// related Syntermitinae and echoing the soldiers' red heads
const ROYAL: CastePalette = {
  head: '#6E3A1E',
  headHi: '#7E4626',
  headTip: '#8E5632',
  body: '#6E3A1E',
  tergite: '#5A3A22', // abdominal plates
  inter: '#C8A27A', // pale membrane between the plates
  gut: '#24160C',
  leg: '#A8784A',
  legMid: '#BC8C5C',
  legJoint: '#86603A',
  hair: '#D8BC94',
  mandible: '#5A3018',
  mandibleTip: '#1E0E06',
  wingScale: '#4A2814',
};

export const RHYNCHOTERMES_CASTES: Record<SickleCasteId, CasteParams> = {
  rhy_soldier: {
    id: 'rhy_soldier',
    label: 'Sickle-jaw soldier',
    species: 'rhynchotermes',
    bodyLength: 4.5,
    // capsule 1.05 mm, tube 1.45 mm, thorax 0.72 mm, abdomen 1.5 mm
    prop: { head: 0.233, nasus: 0.322, thorax: 0.16, abdomen: 0.333 },
    width: { head: 0.222, thorax: 0.14, abdomen: 0.18 },
    height: { head: 0.88, thorax: 0.82, abdomen: 0.95 },
    headShape: 'globe',
    nasus: { baseFrac: 0.46, tipRadius: 0.032, tubeRadius: 0.07, droop: 0.12, rise: 0.36 },
    mandibles: {
      kind: 'sickle',
      scale: 1,
      sickle: { length: 1.12, curve: 2.45, width: 0.21, thickness: 0.12, tilt: 0.95, spread: 0.6, tooth: 0.42, toothLen: 0.1, gape: 1.15, hook: 1.0, hingeLift: 0.6 },
    },
    eyes: false,
    ocelli: false,
    wingScales: false,
    antenna: { beads: 14, lengthFrac: 0.55, radius: 0.042 },
    setae: { head: 2, perTergite: 6 },
    legs: { length: [0.7, 0.8, 0.95], radius: 0.074, spread: 0.95 },
    clearance: 0.36,
    colors: SOLDIER,
    translucency: 0.62,
    gut: 0.55,
    gutSpread: 0.22,
    headCoat: 1.0,
    gait: { amplitude: 0.3, lift: 0.4 },
    headRest: 0.16,
    mandRest: 0.0,
    coxaProcess: true,
  },
  rhy_worker: {
    id: 'rhy_worker',
    label: 'Worker',
    species: 'rhynchotermes',
    // v2.2: larger, lanky and flat-headed so it can't be mistaken for the compact nasute worker: a broad head
    // flattened top to bottom (Wikipedia: "rounded when viewed dorsally and flattened dorso-ventrally"), warm
    // chestnut-orange with a whitish fontanelle and no white Y-lines, bigger mandibles, long slender pale legs and
    // antennae, a long slim very transparent abdomen with the dark leaf-litter gut showing strongly
    bodyLength: 5.8,
    prop: { head: 0.19, nasus: 0, thorax: 0.14, abdomen: 0.63 },
    width: { head: 0.27, thorax: 0.14, abdomen: 0.25 },
    height: { head: 0.5, thorax: 0.62, abdomen: 0.7 },
    headShape: 'flat',
    mandibles: { kind: 'chewing', scale: 1.05 },
    eyes: false,
    ocelli: false,
    wingScales: false,
    antenna: { beads: 14, lengthFrac: 0.47, radius: 0.046 },
    setae: { head: 0, perTergite: 4 },
    legs: { length: [0.64, 0.72, 0.82], radius: 0.06, spread: 1.05 },
    clearance: 0.3,
    colors: {
      head: '#B9642E',
      headHi: '#C2703A',
      headTip: '#D08A52',
      body: '#F4EBD8',
      tergite: '#E9DABE',
      inter: '#FBF6EC',
      gut: '#2E2416',
      leg: '#EEDFBC',
      legMid: '#F6EDD6',
      legJoint: '#D6BC8E',
      hair: '#F8F0DE',
      mandible: '#8E4A22',
      mandibleTip: '#2A1208',
      suture: '#F6EAD0', // fontanelle colour (the Y-lines are off)
    },
    translucency: 1.0,
    gut: 1.0,
    gutSpread: 0.45,
    headCoat: 0.5,
    gait: { amplitude: 0.34, lift: 0.4 },
    fontanelle: 0.27,
    sutureStrength: 0,
    clypeus: 1.2,
    abdShape: 'long',
    carryItems: ['leaf', 'wood', 'egg'],
  },
  rhy_king: {
    id: 'rhy_king',
    label: 'King',
    species: 'rhynchotermes',
    // v2.1: ~1.45x worker length; head flattened from above like the workers'; broad shield-like pronotum
    bodyLength: 8.5,
    prop: { head: 0.19, nasus: 0, thorax: 0.25, abdomen: 0.53 },
    width: { head: 0.17, thorax: 0.18, abdomen: 0.21 },
    height: { head: 0.6, thorax: 0.58, abdomen: 0.72 },
    pronotum: 'shield',
    legRadial: 8,
    headShape: 'round',
    mandibles: { kind: 'chewing', scale: 0.8 },
    eyes: true,
    ocelli: true,
    wingScales: true,
    antenna: { beads: 14, lengthFrac: 0.33, radius: 0.05 },
    setae: { head: 0, perTergite: 0 },
    legs: { length: [0.36, 0.4, 0.46], radius: 0.07, spread: 1.0 },
    clearance: 0.32,
    colors: ROYAL,
    translucency: 0.12,
    gut: 0.0,
    headCoat: 0.7,
    gait: { amplitude: 0.3, lift: 0.36 },
  },
  rhy_queen: {
    id: 'rhy_queen',
    label: 'Queen',
    species: 'rhynchotermes',
    // head + thorax + legs identical to the king; physogastric abdomen (absolute mm, ~6x head + thorax)
    bodyLength: 8.5,
    prop: { head: 0.19, nasus: 0, thorax: 0.25, abdomen: 0.53 },
    width: { head: 0.17, thorax: 0.18, abdomen: 0.21 },
    height: { head: 0.6, thorax: 0.58, abdomen: 0.72 },
    pronotum: 'shield',
    legRadial: 8,
    headShape: 'round',
    mandibles: { kind: 'chewing', scale: 0.8 },
    eyes: true,
    ocelli: true,
    wingScales: true,
    antenna: { beads: 14, lengthFrac: 0.33, radius: 0.05 },
    setae: { head: 0, perTergite: 0 },
    legs: { length: [0.36, 0.4, 0.46], radius: 0.07, spread: 1.0 },
    clearance: 0.32,
    // plates (tergite) and sternites (inter) of the stretched abdomen
    colors: { ...ROYAL, tergite: '#6A4A2A', inter: '#B89060' },
    translucency: 0.55,
    gut: 0.0,
    headCoat: 0.7,
    gait: { amplitude: 0.2, lift: 0.2 },
    // leans to the amber / honey end of the age range (like the user's side photo)
    physogastric: { length: 22.5, width: 5.05, height: 5.1, pleat: 0.17, age: 0.78 },
  },
  rhy_larva: {
    id: 'rhy_larva',
    label: 'Larva',
    species: 'rhynchotermes',
    // built at worker length; scale the instance 0.3 -> 0.85 while it grows on the brood tile
    bodyLength: 5.8,
    prop: { head: 0.24, nasus: 0, thorax: 0.14, abdomen: 0.57 },
    width: { head: 0.28, thorax: 0.18, abdomen: 0.28 },
    height: { head: 0.7, thorax: 0.72, abdomen: 0.8 },
    headShape: 'round',
    mandibles: { kind: 'chewing', scale: 0.5 },
    eyes: false,
    ocelli: false,
    wingScales: false,
    antenna: { beads: 14, lengthFrac: 0.28, radius: 0.05 },
    setae: { head: 0, perTergite: 0 },
    legs: { length: [0.3, 0.33, 0.37], radius: 0.075, spread: 0.85 },
    clearance: 0.12,
    colors: {
      head: '#F3EADA',
      headHi: '#F5EDE0',
      headTip: '#F8F2E8',
      body: '#F4ECDD',
      tergite: '#ECDCC0',
      inter: '#FAF4EA',
      gut: '#BBA684',
      leg: '#F5EEE2',
      legMid: '#F9F5EE',
      legJoint: '#E8DCC6',
      hair: '#FBF7F0',
      mandible: '#EBDDC4',
      mandibleTip: '#CDB894',
    },
    translucency: 1.0,
    gut: 0.25,
    headCoat: 0.2,
    gait: { amplitude: 0.22, lift: 0.25 },
  },
};
