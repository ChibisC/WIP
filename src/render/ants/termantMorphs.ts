import { AntMorph, PartLook } from './morphs';

/**
 * Termant morphs (Chimaeromyrmex termitoides, fictional ant–termite hybrid; claude/termyrms/04-prototype-code.md).
 * Front half ant on the shared builder, back half termite through its opt-in options: head.pore (frontal gland
 * pore), eyes.none, waist.thick, gaster.segs / gut / stripes / soft (jiggle), antenna.bead, meso.smooth. Colours are
 * the brief's hexes.
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

const termantWorker: AntMorph = {
  key: 'termant_worker',
  L: 5,
  head: { len: 0.22, width: 0.21, height: 0.15, shape: 'heart', notch: 0.05, pore: { len: 0.12, r: 0.045, up: 0.35 } },
  eyes: { size: 0.17, pos: 0.52, height: 0.22, ocelli: false },
  antenna: { segments: 12, scape: 1.05, funiculus: 1.25, club: 0, thick: 0.0115, bead: 1 },
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
  // long frontal pore angled forward over the mandibles
  head: { len: 0.27, width: 0.27, height: 0.18, shape: 'heart', notch: 0.04, pore: { len: 0.4, r: 0.06, up: 0.05 } },
  eyes: { size: 0.1, pos: 0.52, height: 0.22, ocelli: false, none: true },
  mandible: { type: 'massive', len: 0.36, teeth: 5, width: 0.7 },
  meso: { len: 0.32, width: 0.14, height: 0.155, smooth: true },
  gaster: { len: 0.4, width: 0.27, height: 0.23, sting: false, segs: 9, gut: 0x4a2e18, soft: 1 },
  legs: { hind: 0.95, thick: 0.017 },
  look: { ...TERM_LOOK, head: L(0x5e3018, 0.28, 0.6, 0.12, 0x8a4e22) },
};

const termantQueen: AntMorph = {
  ...termantWorker,
  key: 'termant_queen',
  L: 12,
  head: { len: 0.14, width: 0.14, height: 0.1, shape: 'heart', notch: 0.04, pore: { len: 0.08, r: 0.03, up: 0.35 } },
  eyes: { size: 0.24, pos: 0.5, height: 0.22, ocelli: true },
  antenna: { ...termantWorker.antenna, scape: 0.95, funiculus: 1.1 },
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
  head: { len: 0.21, width: 0.2, height: 0.145, shape: 'heart', notch: 0.05, pore: { len: 0.1, r: 0.04, up: 0.35 } },
  eyes: { size: 0.2, pos: 0.52, height: 0.22, ocelli: true },
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
