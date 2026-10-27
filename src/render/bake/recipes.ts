import { DetailRecipe, REGION, RegionShade, Sculpt } from './detailBake';

/**
 * Baked-detail recipes (realism pass): each species' cuticle, region by region — sculpture kind and scale,
 * gloss, wear, dust, translucency — from the reference notes (docs/realism/references.md). Atlas cell sizes
 * (px) set the texel density: a fire-ant head tile of 0.42 mm at 512 px is ~0.8 µm a texel.
 */

type ShadeX = Partial<Pick<RegionShade, 'coatRough' | 'wear' | 'dust' | 'mid' | 'tipThin' | 'coatFollow' | 'bands' | 'band'>>;
const shade = (normal: number, joint: number, ventral: number, thick: number, coatInPits = 0.35, x: ShadeX = {}): RegionShade => ({ normal, joint, ventral, thick, coatInPits, coatFollow: 0.9, ...x });

/**
 * Tropical fire ant worker (Solenopsis geminata): smooth and shining, but the head and promesonotum carry
 * conspicuous, abundant hair-bearing punctures (piligerous foveolae); the mesopleuron of small workers is
 * striate-punctate; the propodeum and waist sides rugose-punctate; the gaster smooth with scattered
 * hair punctures. A faint undulation everywhere so no highlight is a perfect blob.
 */
// pit hairs point back along the part: the head and mesosoma are built front-last (−1), the gaster and legs front-first (+1)
// a faint microreticulation everywhere (cells ~14 µm) turns the gloss into a sheen without hiding the shine
// polished (the photos: crisp window highlights): faint relief, the highlights bent rather than scattered
// (jaws pass: the review read the faint reticulation as reptile skin and the undulation as shiny blotches: both fainter)
// (jaws review: smooth and shining, no reticulate cells — their cavity shading read as a pebbled skin)
const FIRE_HEAD: Sculpt = { tile: [0.42, 0.42], noise: 0.0002, pits: { n: 22, r: 0.004, depth: 0.0008, pale: 0.05, stub: { len: 0.02, dir: -1, share: 0.9 } }, wave: { cell: 0.14, amp: 0.0015 }, rough: [-0.06, 0.2], roughVar: 0.04, dirt: 0.15, mottle: 0.06, cavityDark: 0.22 };
const FIRE_MESO: Sculpt = {
  tile: [1.1, 0.42],
  noise: 0.0003,
  reticulum: { cell: 0.015, depth: 0.0002 },
  pits: { n: 18, r: 0.004, depth: 0.0008, pale: 0.05, stub: { len: 0.022, dir: -1, share: 0.9 } },
  // small workers: the mesopleuron striate (on the lower flanks only: the tile wraps the mesosoma once)
  striae: { per: 48, depth: 0.0016, angle: 0.3, wobble: 0.18, sides: 1 },
  wave: { cell: 0.11, amp: 0.0028 },
  rough: [-0.05, 0.3],
  roughVar: 0.05,
  dirt: 0.28,
  mottle: 0.18,
  cavityDark: 0.26,
};
const FIRE_WAIST: Sculpt = { tile: [0.3, 0.3], noise: 0.0006, reticulum: { cell: 0.018, depth: 0.0012 }, pits: { n: 90, r: 0.0055, depth: 0.0022, pale: 0.35 }, wave: { cell: 0.08, amp: 0.003 }, rough: [0.06, 0.3], roughVar: 0.06, dirt: 0.3, mottle: 0.12, cavityDark: 0.3 };
const FIRE_GASTER: Sculpt = { tile: [0.5, 0.5], noise: 0.0002, pits: { n: 14, r: 0.0038, depth: 0.0007, pale: 0.05, stub: { len: 0.024, dir: 1, share: 0.9 } }, wave: { cell: 0.14, amp: 0.0035 }, rough: [-0.08, 0.2], roughVar: 0.06, dirt: 0.15, mottle: 0.28, cavityDark: 0.22 };
const FIRE_LEG: Sculpt = { tile: [0.12, 0.3], noise: 0.0005, pits: { n: 380, r: 0.0035, depth: 0.0016, pale: 0.4, stub: { len: 0.02, dir: 1, share: 0.9 } }, wave: { cell: 0.05, amp: 0.002 }, rough: [0.04, 0.3], roughVar: 0.06, dirt: 0.35, mottle: 0.1, cavityDark: 0.3 };
const FIRE_TARSUS: Sculpt = { tile: [0.06, 0.12], noise: 0.0005, pits: { n: 700, r: 0.0028, depth: 0.0015, pale: 0.5 }, rough: [0.12, 0.3], dirt: 0.55, mottle: 0.06, cavityDark: 0.35 };
const FIRE_ANTENNA: Sculpt = { tile: [0.08, 0.2], noise: 0.0004, pits: { n: 900, r: 0.002, depth: 0.0008, pale: 0.15 }, rough: [0.1, 0.28], dirt: 0.25, mottle: 0.06, cavityDark: 0.35 };

// jaws pass: the mandibles finely striate lengthwise with scattered hair pits, slightly glossy, thin enough to glow at the edge
const FIRE_MAND: Sculpt = { tile: [0.1, 0.24], noise: 0.0003, striae: { per: 55, depth: 0.00012, angle: 0, wobble: 0.35 }, pits: { n: 120, r: 0.003, depth: 0.0008, pale: 0.1 }, wave: { cell: 0.06, amp: 0.002 }, rough: [-0.02, 0.24], roughVar: 0.05, dirt: 0.15, mottle: 0.1, cavityDark: 0.3 };

export const FIRE_ANT: DetailRecipe = {
  key: 'fire',
  regions: {
    [REGION.HEAD]: { sculpt: FIRE_HEAD, shade: shade(0.8, 0.35, 0.45, 0.24, 0.4, { coatRough: 0.12, wear: 0.25, dust: 0.06, mid: 0.12 }), px: [512, 512] },
    // the promesonotal suture (the mesosoma is built back to front)
    [REGION.MESO]: { sculpt: FIRE_MESO, shade: shade(0.8, 0.45, 0.5, 0.22, 0.4, { coatRough: 0.13, wear: 0.25, dust: 0.08, mid: 0.12, bands: [0.6], band: [0.009, 0.22, 0.1, 0.02] }), px: [1024, 512] },
    [REGION.WAIST]: { sculpt: FIRE_WAIST, shade: shade(0.8, 0.06, 0.3, 0.25, 0.3, { coatRough: 0.18, wear: 0.2, dust: 0.12 }), px: [256, 256] },
    // four visible tergites: the hind margin of each thin, paler and translucent over the dark seam
    [REGION.GASTER]: { sculpt: FIRE_GASTER, shade: shade(0.75, 0.3, 0.35, 0.3, 0.5, { coatRough: 0.1, wear: 0.2, dust: 0.06, mid: 0.12, bands: [0.44, 0.63, 0.79, 0.91], band: [0.008, 0.18, 0.22, 0.035] }), px: [512, 512] },
    [REGION.LEG]: { sculpt: FIRE_LEG, shade: shade(1.0, 0.5, 0, 0.6, 0.35, { coatRough: 0.22, wear: 0.3, dust: 0.35, mid: 0.3, tipThin: 0.6 }), px: [128, 320] },
    [REGION.TARSUS]: { sculpt: FIRE_TARSUS, shade: shade(0.9, 0.45, 0, 0.6, 0.35, { coatRough: 0.36, dust: 0.55, mid: 0.2, tipThin: 0.5 }), px: [64, 128] },
    [REGION.ANTENNA]: { sculpt: FIRE_ANTENNA, shade: shade(0.7, 0.05, 0, 0.6, 0.35, { coatRough: 0.3, dust: 0.15, mid: 0, tipThin: 0.4 }), px: [64, 160] },
    [REGION.MANDIBLE]: { sculpt: FIRE_MAND, shade: shade(0.8, 0.1, 0, 0.45, 0.35, { coatRough: 0.18, wear: 0.5, dust: 0.05, tipThin: 0.7 }), px: [96, 192] },
  },
};

/** Recipe for an ant morph (null: no baked detail yet, the material stays as before). */
export function antRecipe(morphKey: string): DetailRecipe | null {
  if (morphKey.startsWith('fire_')) return FIRE_ANT;
  return null;
}

/**
 * European stag beetle (Lucanus cervus), boss scale: the parts are modelled at a 60 mm major male and drawn
 * larger, so the tiles are in the real beetle's millimetres. Elytra: chestnut, satin — finely shagreened
 * (dense micro-granules) with shallow scattered punctures, never a mirror; head and pronotum: black, densely
 * granulate-punctate, the head reticulate, dull to satin; mandibles: reddish-brown, finely granulate with
 * scattered punctures, satin; legs and underside: black, punctate, the underside with fine hairs.
 */
const STAG_ELYTRA: Sculpt = { tile: [6, 6], noise: 0.004, granules: { cell: 0.06, height: 0.004 }, pits: { n: 10, r: 0.06, depth: 0.014, pale: 0.12 }, wave: { cell: 1.4, amp: 0.06 }, rough: [0.0, 0.25], roughVar: 0.08, dirt: 0.12, mottle: 0.25, cavityDark: 0.35 };
const STAG_PRONOTUM: Sculpt = { tile: [5, 5], noise: 0.005, granules: { cell: 0.22, height: 0.028 }, pits: { n: 16, r: 0.07, depth: 0.022, pale: 0.05 }, wave: { cell: 1.2, amp: 0.06 }, rough: [0.06, 0.3], roughVar: 0.08, dirt: 0.22, mottle: 0.14, cavityDark: 0.45 };
const STAG_HEAD: Sculpt = { tile: [5, 5], noise: 0.004, reticulum: { cell: 0.45, depth: 0.025 }, granules: { cell: 0.16, height: 0.018 }, wave: { cell: 1.0, amp: 0.05 }, rough: [0.06, 0.3], roughVar: 0.08, dirt: 0.2, mottle: 0.1, cavityDark: 0.45 };
// (jaws pass: the photos show smooth, glossy antlers with fine punctures, not a speckled matte surface)
// (jaws review: satin and finely pitted, not lacquered)
const STAG_MAND: Sculpt = { tile: [3, 6], noise: 0.002, granules: { cell: 0.07, height: 0.004 }, pits: { n: 60, r: 0.028, depth: 0.008, pale: 0.04 }, wave: { cell: 1.2, amp: 0.03 }, rough: [-0.02, 0.2], roughVar: 0.05, dirt: 0.06, mottle: 0.14, cavityDark: 0.25 };
const STAG_LEG: Sculpt = { tile: [2, 4], noise: 0.004, pits: { n: 30, r: 0.05, depth: 0.016, pale: 0.25 }, granules: { cell: 0.07, height: 0.005 }, wave: { cell: 0.7, amp: 0.04 }, rough: [0.05, 0.3], roughVar: 0.06, dirt: 0.35, mottle: 0.1, cavityDark: 0.4 };
const STAG_UNDER: Sculpt = { tile: [5, 5], noise: 0.004, pits: { n: 60, r: 0.03, depth: 0.01, pale: 0.6 }, rough: [0.15, 0.3], dirt: 0.3, mottle: 0.12, cavityDark: 0.35 };
const STAG_ANT: Sculpt = { tile: [1, 2], noise: 0.003, pits: { n: 120, r: 0.015, depth: 0.004, pale: 0.4 }, rough: [0.1, 0.25], dirt: 0.15, mottle: 0.05, cavityDark: 0.3 };

export const STAG: DetailRecipe = {
  key: 'stag',
  regions: {
    [REGION.ELYTRA]: { sculpt: STAG_ELYTRA, shade: shade(1.15, 0.35, 0.3, 0.04, 0.5, { coatRough: 0.32, wear: 0.4, dust: 0.15, mid: 0.08 }), px: [512, 512] },
    [REGION.PRONOTUM]: { sculpt: STAG_PRONOTUM, shade: shade(1.2, 0.4, 0.3, 0, 0.35, { coatRough: 0.38, wear: 0.45, dust: 0.2 }), px: [512, 512] },
    [REGION.CR_HEAD]: { sculpt: STAG_HEAD, shade: shade(1.2, 0.4, 0.3, 0, 0.3, { coatRough: 0.4, wear: 0.45, dust: 0.22 }), px: [512, 512] },
    [REGION.CR_MAND]: { sculpt: STAG_MAND, shade: shade(1.0, 0.3, 0.15, 0.1, 0.4, { coatRough: 0.22, wear: 0.4, dust: 0.04, tipThin: 1.0 }), px: [256, 512] },
    [REGION.CR_LEG]: { sculpt: STAG_LEG, shade: shade(1.1, 0.45, 0, 0.08, 0.35, { coatRough: 0.34, wear: 0.45, dust: 0.35, mid: 0.15, tipThin: 0.8 }), px: [256, 512] },
    [REGION.CR_UNDER]: { sculpt: STAG_UNDER, shade: shade(0.9, 0.4, 0, 0, 0.3, { coatRough: 0.45, dust: 0.3 }), px: [256, 256] },
    [REGION.CR_ANT]: { sculpt: STAG_ANT, shade: shade(0.8, 0.35, 0, 0.15, 0.3, { coatRough: 0.35, tipThin: 0.6 }), px: [128, 256] },
  },
};

/** Recipe for a creature part family (null: none). */
export function creatureRecipe(family: string): DetailRecipe | null {
  if (family === 'stag') return STAG;
  return null;
}
