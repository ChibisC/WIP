import { AntMorph, PartLook } from './morphs';

/**
 * Termant morphs (Chimaeromyrmex termitoides, fictional ant–termite hybrid; claude/termyrms/04-prototype-code.md),
 * rebuilt realistically (spec 09 §3, the user's design of 2026-11-03; shape numbers in
 * docs/creatures/chimaeromyrmex-termitoides.md §10): the front half a formicine ant's on the shared builder (head,
 * mesosoma, legs, the workers' toothed jaws), the back half a termite's (one short thick waist, a soft pale abdomen
 * with the gut showing); **termite antennae on every caste** (straight and beaded, `antenna.termite`); **no nasus** —
 * the soldier's glue comes from the fontanelle on its forehead (`head.fontanelle`, as in Coptotermes); the soldier a
 * Macrotermes-style head: a big, hard, dark, rectangular capsule with two thick sabre jaws crossing at the tips
 * (`mandible.type 'sabre'`), eyeless. Colours: the brief's palette, muted.
 */
const L = (color: number, rough: number, coat: number, sheen: number, color2?: number): PartLook => ({ color, color2, rough, coat, sheen });

const TERM_LOOK = {
  head: L(0x8a4e22, 0.3, 0.55, 0.15, 0xc07a3e), // glossy amber-brown, highlight toward the vertex
  meso: L(0x8a4e22, 0.32, 0.5, 0.15, 0xc07a3e),
  waist: L(0xa8763e, 0.4, 0.3, 0.15, 0xe6c58e), // amber blending into the abdomen colour
  gaster: L(0xe6c58e, 0.55, 0.08, 0.45, 0xa8763e), // translucent cream-amber; color2 = segment bands
  legs: L(0xb07a42, 0.42, 0.2, 0.12, 0xd4a66a), // amber-tan, lighter toward the tips
  antenna: L(0xb07a42, 0.42, 0.2, 0.1, 0xd4a66a),
  mandible: L(0x5e3018, 0.35, 0.4, 0, 0x2a1408),
};

// termite antennae: a short basal segment (head lengths) and the beads (`funiculus` × it); workers 15 segments,
// soldiers 14, royals 17 (Reticulitermes / Coptotermes / Macrotermes counts)
const termantWorker: AntMorph = {
  key: 'termant_worker',
  L: 5,
  real: true,
  // erect pale setae: sparse on the ant front, finer and denser on the termite abdomen
  setae: { color: 0xe8d4a8, head: 10, meso: 16, gaster: 46, len: [0.01, 0.035] },
  head: { len: 0.22, width: 0.21, height: 0.15, shape: 'heart', notch: 0.05 },
  eyes: { size: 0.17, pos: 0.52, height: 0.22, ocelli: false },
  antenna: { segments: 15, scape: 0.2, funiculus: 6.2, club: 0, thick: 0.0105, termite: true },
  mandible: { type: 'triangular', len: 0.34, teeth: 6, width: 0.55 },
  meso: { len: 0.32, width: 0.125, height: 0.14, smooth: true },
  waist: { nodes: 1, len: 0.045, scale: true, nodeH: 0.1, thick: 2.6 },
  gaster: { len: 0.42, width: 0.27, height: 0.23, sting: false, segs: 9, gut: 0x4a2e18, soft: 1 },
  legs: { hind: 1.0, thick: 0.015 },
  look: TERM_LOOK,
  hair: 0.3,
  stance: 0.13,
};

const termantSoldier: AntMorph = {
  ...termantWorker,
  key: 'termant_soldier',
  L: 7,
  // a Macrotermes soldier's head: a big, hard, dark rectangular capsule (longer than wide, the sides nearly parallel),
  // the fontanelle on the forehead, eyeless; the sabre jaws 0.62 of the head's length
  head: { len: 0.34, width: 0.26, height: 0.19, shape: 'rect', fontanelle: 0.045 },
  eyes: { size: 0.1, pos: 0.52, height: 0.22, ocelli: false, none: true },
  antenna: { segments: 14, scape: 0.16, funiculus: 6.6, club: 0, thick: 0.0115, termite: true },
  mandible: { type: 'sabre', len: 0.62, teeth: 0, width: 0.7, open: 0.55 },
  meso: { len: 0.32, width: 0.14, height: 0.155, smooth: true },
  gaster: { len: 0.4, width: 0.27, height: 0.23, sting: false, segs: 9, gut: 0x4a2e18, soft: 1 },
  legs: { hind: 0.95, thick: 0.017 },
  look: { ...TERM_LOOK, head: L(0x5e3018, 0.28, 0.6, 0.12, 0x8a4e22) },
};

const termantQueen: AntMorph = {
  ...termantWorker,
  key: 'termant_queen',
  L: 12,
  head: { len: 0.14, width: 0.14, height: 0.1, shape: 'heart', notch: 0.04 },
  eyes: { size: 0.24, pos: 0.5, height: 0.22, ocelli: true },
  antenna: { segments: 17, scape: 0.22, funiculus: 6.4, club: 0, thick: 0.0075, termite: true },
  mandible: { type: 'triangular', len: 0.3, teeth: 6, width: 0.55 },
  meso: { len: 0.26, width: 0.15, height: 0.17, queen: true },
  waist: { nodes: 1, len: 0.03, scale: true, nodeH: 0.08, thick: 2.6 },
  // moderately physogastric: about 3× a worker's relative abdomen length, creamy white with amber tergite stripes
  gaster: { len: 0.95, width: 0.3, height: 0.26, sting: false, segs: 10, stripes: 10, gut: 0x5a3a1c, soft: 0.5 },
  legs: { hind: 0.62, thick: 0.012 },
  look: { ...TERM_LOOK, gaster: L(0xf1e4c6, 0.5, 0.12, 0.5, 0xa8763e) },
  wingScars: true,
  stance: 0.1,
};

const termantKing: AntMorph = {
  ...termantWorker,
  key: 'termant_king',
  L: 7.5,
  head: { len: 0.21, width: 0.2, height: 0.145, shape: 'heart', notch: 0.05 },
  eyes: { size: 0.2, pos: 0.52, height: 0.22, ocelli: true },
  antenna: { segments: 17, scape: 0.2, funiculus: 6.0, club: 0, thick: 0.0095, termite: true },
  meso: { len: 0.3, width: 0.14, height: 0.155, queen: true },
  gaster: { len: 0.4, width: 0.26, height: 0.22, sting: false, segs: 9, gut: 0x4a2e18, soft: 0.6 },
  legs: { hind: 0.9, thick: 0.014 },
  look: {
    ...TERM_LOOK,
    head: L(0x6e3a1a, 0.3, 0.55, 0.15, 0x9c5a2c),
    meso: L(0x6e3a1a, 0.32, 0.5, 0.15, 0x9c5a2c),
    gaster: L(0xd8b47e, 0.55, 0.08, 0.4, 0x9a6a36),
  },
  wingScars: true,
  stance: 0.13,
};

export const TERMANT_MORPHS: Record<string, AntMorph> = {
  termant_worker: termantWorker,
  termant_soldier: termantSoldier,
  termant_queen: termantQueen,
  termant_king: termantKing,
};
