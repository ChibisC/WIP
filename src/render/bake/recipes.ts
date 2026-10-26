import { DetailRecipe, REGION, RegionShade, Sculpt } from './detailBake';

/**
 * Baked-detail recipes (realism pass, part B): each species' cuticle, region by region, from the reference
 * notes in docs/creatures (sculpture kind and scale, gloss, hairs). Pilot: the tropical fire ant
 * (docs/creatures/fire-ant.md) and the stag beetle (docs/creatures/stagBeetle.md). Atlas cell sizes (px)
 * set the texel density: a fire-ant head tile of 0.4 mm at 512 px is ~0.8 µm a texel.
 */

const shade = (normal: number, joint: number, ventral: number, thick: number, coatInPits = 0.35): RegionShade => ({ normal, joint, ventral, thick, coatInPits });

/** Tropical fire ant (Solenopsis geminata): smooth, shining cuticle with sparse hair-bearing punctures. */
const FIRE_HEAD: Sculpt = { tile: [0.42, 0.42], noise: 0.00035, pits: { n: 55, r: 0.0075, depth: 0.0035, pale: 0.55 }, rough: [-0.06, 0.28], dirt: 0.18, mottle: 0.16, cavityDark: 0.45 };
const FIRE_MESO: Sculpt = { tile: [0.42, 0.42], noise: 0.00045, pits: { n: 40, r: 0.0065, depth: 0.003, pale: 0.5 }, rough: [-0.02, 0.3], dirt: 0.2, mottle: 0.1, cavityDark: 0.4 };
const FIRE_WAIST: Sculpt = { tile: [0.3, 0.3], noise: 0.0005, granules: { cell: 0.018, height: 0.0012 }, pits: { n: 30, r: 0.006, depth: 0.0025, pale: 0.4 }, rough: [0.05, 0.3], dirt: 0.25, mottle: 0.1, cavityDark: 0.4 };
const FIRE_GASTER: Sculpt = { tile: [0.5, 0.5], noise: 0.00025, pits: { n: 26, r: 0.0065, depth: 0.0028, pale: 0.6 }, rough: [-0.1, 0.22], dirt: 0.12, mottle: 0.2, cavityDark: 0.35 };
const FIRE_LEG: Sculpt = { tile: [0.12, 0.3], noise: 0.0003, pits: { n: 260, r: 0.003, depth: 0.0012, pale: 0.5 }, rough: [0.06, 0.25], dirt: 0.3, mottle: 0.06, cavityDark: 0.25 };
const FIRE_TARSUS: Sculpt = { tile: [0.06, 0.12], noise: 0.0004, pits: { n: 500, r: 0.0025, depth: 0.001, pale: 0.4 }, rough: [0.15, 0.3], dirt: 0.5, mottle: 0.05, cavityDark: 0.25 };
const FIRE_ANTENNA: Sculpt = { tile: [0.08, 0.2], noise: 0.0003, pits: { n: 900, r: 0.002, depth: 0.0008, pale: 0.6 }, rough: [0.12, 0.25], dirt: 0.2, mottle: 0.05, cavityDark: 0.25 };

export const FIRE_ANT: DetailRecipe = {
  key: 'fire',
  regions: {
    [REGION.HEAD]: { sculpt: FIRE_HEAD, shade: shade(1.0, 0.35, 0.45, 0.08), px: [512, 512] },
    [REGION.MESO]: { sculpt: FIRE_MESO, shade: shade(1.0, 0.45, 0.5, 0.06), px: [512, 512] },
    [REGION.WAIST]: { sculpt: FIRE_WAIST, shade: shade(1.0, 0.5, 0.4, 0.1), px: [256, 256] },
    [REGION.GASTER]: { sculpt: FIRE_GASTER, shade: shade(0.9, 0.3, 0.35, 0.22, 0.5), px: [512, 512] },
    [REGION.LEG]: { sculpt: FIRE_LEG, shade: shade(0.9, 0.5, 0, 0.35), px: [128, 320] },
    [REGION.TARSUS]: { sculpt: FIRE_TARSUS, shade: shade(0.8, 0.4, 0, 0.4), px: [64, 128] },
    [REGION.ANTENNA]: { sculpt: FIRE_ANTENNA, shade: shade(0.8, 0.45, 0, 0.45), px: [64, 160] },
  },
};

/** Recipe for an ant morph (null: no baked detail yet, the material stays as before). */
export function antRecipe(morphKey: string): DetailRecipe | null {
  if (morphKey.startsWith('fire_')) return FIRE_ANT;
  return null;
}

/**
 * European stag beetle (Lucanus cervus), boss scale: the parts are modelled at a 60 mm major male and drawn
 * larger, so the tiles are in the real beetle's millimetres. Elytra: chestnut satin, finely shagreened with
 * shallow punctures; head and pronotum: black, densely granulate-punctate, duller; mandibles: glossy
 * red-chestnut, sparsely punctate; legs and underside: black, punctate, the underside with fine hairs.
 */
const STAG_ELYTRA: Sculpt = { tile: [6, 6], noise: 0.004, granules: { cell: 0.09, height: 0.004 }, pits: { n: 9, r: 0.045, depth: 0.012, pale: 0.15 }, rough: [-0.02, 0.22], dirt: 0.12, mottle: 0.28, cavityDark: 0.35 };
const STAG_PRONOTUM: Sculpt = { tile: [5, 5], noise: 0.004, granules: { cell: 0.07, height: 0.006 }, pits: { n: 22, r: 0.04, depth: 0.014, pale: 0.05 }, rough: [0.06, 0.28], dirt: 0.18, mottle: 0.12, cavityDark: 0.4 };
const STAG_HEAD: Sculpt = { tile: [5, 5], noise: 0.005, reticulum: { cell: 0.16, depth: 0.012 }, granules: { cell: 0.06, height: 0.006 }, rough: [0.1, 0.3], dirt: 0.22, mottle: 0.1, cavityDark: 0.45 };
const STAG_MAND: Sculpt = { tile: [3, 6], noise: 0.002, pits: { n: 10, r: 0.03, depth: 0.008, pale: 0.1 }, rough: [-0.1, 0.18], dirt: 0.06, mottle: 0.25, cavityDark: 0.3 };
const STAG_LEG: Sculpt = { tile: [2, 4], noise: 0.004, pits: { n: 40, r: 0.028, depth: 0.009, pale: 0.25 }, granules: { cell: 0.06, height: 0.003 }, rough: [0.05, 0.28], dirt: 0.3, mottle: 0.08, cavityDark: 0.35 };
const STAG_UNDER: Sculpt = { tile: [5, 5], noise: 0.004, pits: { n: 60, r: 0.03, depth: 0.01, pale: 0.6 }, rough: [0.15, 0.3], dirt: 0.25, mottle: 0.1, cavityDark: 0.3 };
const STAG_ANT: Sculpt = { tile: [1, 2], noise: 0.003, pits: { n: 120, r: 0.015, depth: 0.004, pale: 0.4 }, rough: [0.1, 0.25], dirt: 0.15, mottle: 0.05, cavityDark: 0.3 };

export const STAG: DetailRecipe = {
  key: 'stag',
  regions: {
    [REGION.ELYTRA]: { sculpt: STAG_ELYTRA, shade: shade(1.0, 0.35, 0.3, 0.04, 0.55), px: [512, 512] },
    [REGION.PRONOTUM]: { sculpt: STAG_PRONOTUM, shade: shade(1.0, 0.4, 0.3, 0, 0.4), px: [512, 512] },
    [REGION.CR_HEAD]: { sculpt: STAG_HEAD, shade: shade(1.0, 0.4, 0.3, 0, 0.35), px: [512, 512] },
    [REGION.CR_MAND]: { sculpt: STAG_MAND, shade: shade(1.0, 0.3, 0, 0.12, 0.6), px: [256, 512] },
    [REGION.CR_LEG]: { sculpt: STAG_LEG, shade: shade(1.0, 0.45, 0, 0.05), px: [256, 512] },
    [REGION.CR_UNDER]: { sculpt: STAG_UNDER, shade: shade(0.9, 0.4, 0, 0), px: [256, 256] },
    [REGION.CR_ANT]: { sculpt: STAG_ANT, shade: shade(0.8, 0.35, 0, 0.1), px: [128, 256] },
  },
};

/** Recipe for a creature part family (null: none). */
export function creatureRecipe(family: string): DetailRecipe | null {
  if (family === 'stag') return STAG;
  return null;
}
