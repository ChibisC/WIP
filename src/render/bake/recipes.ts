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

/**
 * Black garden ant (Lasius niger), rollout batch 1: matte and silky — the whole body finely shagreened (micro-
 * reticulate, cells ~12 µm) under a dense coat of short appressed hairs that lie back along the body and give a
 * grey sheen, strongest on the gaster; a few erect hairs (the setae). No gloss to speak of (docs/creatures/lasius-niger.md).
 */
const LAS_HEAD: Sculpt = { tile: [0.5, 0.5], noise: 0.0003, reticulum: { cell: 0.012, depth: 0.0004 }, pits: { n: 70, r: 0.0028, depth: 0.0005, pale: 0.25, stub: { len: 0.03, dir: -1, share: 1 } }, wave: { cell: 0.14, amp: 0.002 }, rough: [0.18, 0.42], roughVar: 0.05, dirt: 0.2, mottle: 0.08, cavityDark: 0.25 };
const LAS_MESO: Sculpt = { tile: [1.3, 0.5], noise: 0.0003, reticulum: { cell: 0.013, depth: 0.0006 }, pits: { n: 150, r: 0.0032, depth: 0.0006, pale: 0.4, stub: { len: 0.03, dir: -1, share: 1 } }, wave: { cell: 0.12, amp: 0.0025 }, rough: [0.2, 0.42], roughVar: 0.05, dirt: 0.28, mottle: 0.12, cavityDark: 0.26 };
const LAS_WAIST: Sculpt = { tile: [0.35, 0.35], noise: 0.0005, reticulum: { cell: 0.014, depth: 0.0008 }, pits: { n: 60, r: 0.004, depth: 0.001, pale: 0.35 }, rough: [0.2, 0.4], roughVar: 0.06, dirt: 0.3, mottle: 0.1, cavityDark: 0.3 };
const LAS_GASTER: Sculpt = { tile: [0.7, 0.7], noise: 0.0003, reticulum: { cell: 0.012, depth: 0.0005 }, pits: { n: 340, r: 0.003, depth: 0.0005, pale: 0.55, stub: { len: 0.04, dir: 1, share: 1 } }, wave: { cell: 0.16, amp: 0.003 }, rough: [0.14, 0.4], roughVar: 0.06, dirt: 0.15, mottle: 0.16, cavityDark: 0.22 };
const LAS_LEG: Sculpt = { ...FIRE_LEG, tile: [0.16, 0.4], rough: [0.16, 0.38] };
// (the photos: the formicine jaws look smooth at game scale, the striae fine — no ribbing)
const LAS_MAND: Sculpt = { ...FIRE_MAND, tile: [0.14, 0.32], striae: { per: 160, depth: 0.00006, angle: 0, wobble: 0.15 }, rough: [0.06, 0.3], cavityDark: 0.12 };
export const LASIUS: DetailRecipe = {
  key: 'lasius',
  regions: {
    [REGION.HEAD]: { sculpt: LAS_HEAD, shade: shade(0.8, 0.35, 0.45, 0.2, 0.4, { coatRough: 0.34, wear: 0.15, dust: 0.08, mid: 0.08 }), px: [512, 512] },
    [REGION.MESO]: { sculpt: LAS_MESO, shade: shade(0.8, 0.45, 0.5, 0.2, 0.4, { coatRough: 0.34, wear: 0.15, dust: 0.1, mid: 0.08 }), px: [1024, 512] },
    [REGION.WAIST]: { sculpt: LAS_WAIST, shade: shade(0.8, 0.06, 0.3, 0.2, 0.3, { coatRough: 0.36, wear: 0.15, dust: 0.12 }), px: [256, 256] },
    // (the user's photos: the hind margin of each tergite a plain pale, translucent band)
    [REGION.GASTER]: { sculpt: LAS_GASTER, shade: shade(0.75, 0.3, 0.35, 0.22, 0.5, { coatRough: 0.32, wear: 0.15, dust: 0.06, mid: 0.08, bands: [0.4, 0.6, 0.77, 0.9], band: [0.011, 0.2, 0.7, 0.06] }), px: [512, 512] },
    [REGION.LEG]: { sculpt: LAS_LEG, shade: shade(1.0, 0.5, 0, 0.5, 0.35, { coatRough: 0.34, wear: 0.25, dust: 0.35, mid: 0.2, tipThin: 0.5 }), px: [128, 320] },
    [REGION.TARSUS]: { sculpt: FIRE_TARSUS, shade: shade(0.9, 0.45, 0, 0.5, 0.35, { coatRough: 0.4, dust: 0.55, mid: 0.15, tipThin: 0.45 }), px: [64, 128] },
    [REGION.ANTENNA]: { sculpt: FIRE_ANTENNA, shade: shade(0.7, 0.05, 0, 0.5, 0.35, { coatRough: 0.36, dust: 0.15, mid: 0, tipThin: 0.4 }), px: [64, 160] },
    [REGION.MANDIBLE]: { sculpt: LAS_MAND, shade: shade(0.8, 0.1, 0, 0.4, 0.35, { coatRough: 0.24, wear: 0.5, dust: 0.05, tipThin: 0.6 }), px: [96, 192] },
  },
};

/**
 * Red wood ant (Formica rufa), rollout batch 1: head and mesosoma finely microreticulate and moderately shiny with
 * scattered hair pits; the gaster blackish and duller under dense, fine, silvery pubescence; legs dark, finely
 * punctate (docs/creatures/formica-rufa.md).
 */
const FOR_HEAD: Sculpt = { tile: [0.9, 0.9], noise: 0.0004, reticulum: { cell: 0.016, depth: 0.0005 }, pits: { n: 14, r: 0.005, depth: 0.0012, pale: 0.15, stub: { len: 0.03, dir: -1, share: 0.6 } }, wave: { cell: 0.2, amp: 0.003 }, rough: [0.24, 0.48], roughVar: 0.05, dirt: 0.18, mottle: 0.12, cavityDark: 0.25 };
const FOR_MESO: Sculpt = { tile: [2.2, 0.9], noise: 0.0004, reticulum: { cell: 0.017, depth: 0.001 }, pits: { n: 36, r: 0.005, depth: 0.0012, pale: 0.15, stub: { len: 0.03, dir: -1, share: 0.6 } }, wave: { cell: 0.18, amp: 0.0035 }, rough: [0.26, 0.5], roughVar: 0.05, dirt: 0.25, mottle: 0.16, cavityDark: 0.26 };
const FOR_WAIST: Sculpt = { tile: [0.6, 0.6], noise: 0.0006, reticulum: { cell: 0.018, depth: 0.0009 }, pits: { n: 40, r: 0.006, depth: 0.0014, pale: 0.25 }, rough: [0.08, 0.32], roughVar: 0.06, dirt: 0.3, mottle: 0.12, cavityDark: 0.3 };
const FOR_GASTER: Sculpt = { tile: [1.2, 1.2], noise: 0.0003, reticulum: { cell: 0.014, depth: 0.0005 }, pits: { n: 1500, r: 0.0022, depth: 0.0004, pale: 0.3, stub: { len: 0.05, dir: 1, share: 1 } }, wave: { cell: 0.22, amp: 0.004 }, rough: [0.12, 0.36], roughVar: 0.06, dirt: 0.15, mottle: 0.14, cavityDark: 0.22 };
const FOR_LEG: Sculpt = { ...FIRE_LEG, tile: [0.25, 0.6], rough: [0.1, 0.34] };
const FOR_MAND: Sculpt = { ...FIRE_MAND, tile: [0.22, 0.5], striae: { per: 160, depth: 0.00006, angle: 0, wobble: 0.15 }, cavityDark: 0.12 };
export const FORMICA: DetailRecipe = {
  key: 'formica',
  regions: {
    [REGION.HEAD]: { sculpt: FOR_HEAD, shade: shade(0.8, 0.35, 0.45, 0.22, 0.4, { coatRough: 0.2, wear: 0.2, dust: 0.08, mid: 0.1 }), px: [512, 512] },
    // (review round 3: the promesonotal suture's band read as a seam across the mesosoma)
    [REGION.MESO]: { sculpt: FOR_MESO, shade: shade(0.8, 0.45, 0.5, 0.22, 0.4, { coatRough: 0.2, wear: 0.2, dust: 0.1, mid: 0.1 }), px: [1024, 512] },
    [REGION.WAIST]: { sculpt: FOR_WAIST, shade: shade(0.8, 0.06, 0.3, 0.22, 0.3, { coatRough: 0.24, wear: 0.2, dust: 0.12 }), px: [256, 256] },
    [REGION.GASTER]: { sculpt: FOR_GASTER, shade: shade(0.75, 0.3, 0.35, 0.24, 0.5, { coatRough: 0.36, wear: 0.15, dust: 0.06, mid: 0.08, bands: [0.4, 0.6, 0.77, 0.9], band: [0.011, 0.2, 0.75, 0.06] }), px: [512, 512] },
    [REGION.LEG]: { sculpt: FOR_LEG, shade: shade(1.0, 0.5, 0, 0.5, 0.35, { coatRough: 0.28, wear: 0.3, dust: 0.35, mid: 0.25, tipThin: 0.55 }), px: [128, 320] },
    [REGION.TARSUS]: { sculpt: FIRE_TARSUS, shade: shade(0.9, 0.45, 0, 0.5, 0.35, { coatRough: 0.38, dust: 0.55, mid: 0.2, tipThin: 0.5 }), px: [64, 128] },
    [REGION.ANTENNA]: { sculpt: FIRE_ANTENNA, shade: shade(0.7, 0.05, 0, 0.5, 0.35, { coatRough: 0.32, dust: 0.15, mid: 0, tipThin: 0.4 }), px: [64, 160] },
    [REGION.MANDIBLE]: { sculpt: FOR_MAND, shade: shade(0.8, 0.1, 0, 0.45, 0.35, { coatRough: 0.2, wear: 0.5, dust: 0.05, tipThin: 0.7 }), px: [96, 192] },
  },
};

/**
 * Leafcutter (Atta cephalotes), overnight realism pass: the workers matte and finely rough all over — the cuticle
 * densely tuberculate (small rounded tubercles on head, mesosoma, waist and gaster) with short hooked hairs, dusty
 * from the trails; the major's head the exception: smooth and shining, without A. sexdens's hexagonal
 * microsculpture (Antkey; Longino's key: a smooth patch on the mesosoma's side) — docs/creatures/atta-cephalotes.md.
 */
const ATTA_HEAD: Sculpt = { tile: [1.2, 1.2], noise: 0.0005, granules: { cell: 0.045, height: 0.0055 }, pits: { n: 30, r: 0.006, depth: 0.0012, pale: 0.25, stub: { len: 0.04, dir: -1, share: 0.8 } }, wave: { cell: 0.25, amp: 0.004 }, rough: [0.26, 0.5], roughVar: 0.06, dirt: 0.32, mottle: 0.16, cavityDark: 0.3 };
const ATTA_MESO: Sculpt = { tile: [3, 1.2], noise: 0.0006, granules: { cell: 0.055, height: 0.007 }, pits: { n: 26, r: 0.006, depth: 0.0012, pale: 0.25, stub: { len: 0.04, dir: -1, share: 0.8 } }, wave: { cell: 0.22, amp: 0.005 }, rough: [0.28, 0.52], roughVar: 0.06, dirt: 0.38, mottle: 0.18, cavityDark: 0.32 };
const ATTA_WAIST: Sculpt = { tile: [0.8, 0.8], noise: 0.0006, granules: { cell: 0.05, height: 0.006 }, pits: { n: 30, r: 0.006, depth: 0.0012, pale: 0.25 }, rough: [0.28, 0.5], roughVar: 0.06, dirt: 0.38, mottle: 0.14, cavityDark: 0.32 };
const ATTA_GASTER: Sculpt = { tile: [1.6, 1.6], noise: 0.0004, granules: { cell: 0.04, height: 0.0035 }, pits: { n: 60, r: 0.004, depth: 0.0008, pale: 0.3, stub: { len: 0.035, dir: 1, share: 0.9 } }, wave: { cell: 0.3, amp: 0.004 }, rough: [0.2, 0.42], roughVar: 0.06, dirt: 0.25, mottle: 0.14, cavityDark: 0.26 };
const ATTA_LEG: Sculpt = { ...FIRE_LEG, tile: [0.4, 1.0], granules: { cell: 0.035, height: 0.003 }, rough: [0.22, 0.42], dirt: 0.45 };
const ATTA_MAND: Sculpt = { ...FIRE_MAND, tile: [0.35, 0.8], striae: { per: 120, depth: 0.0001, angle: 0, wobble: 0.2 }, cavityDark: 0.2 };
// the major's head: smooth and shining, sparse hair pits, a faint undulation so the highlight breaks up
const ATTA_MAJOR_HEAD: Sculpt = { tile: [3, 3], noise: 0.0004, pits: { n: 6, r: 0.012, depth: 0.003, pale: 0.12 }, wave: { cell: 0.5, amp: 0.01 }, rough: [-0.04, 0.22], roughVar: 0.05, dirt: 0.12, mottle: 0.12, cavityDark: 0.22 };
const attaRegions = {
  [REGION.HEAD]: { sculpt: ATTA_HEAD, shade: shade(0.85, 0.35, 0.45, 0.2, 0.45, { coatRough: 0.32, wear: 0.25, dust: 0.18, mid: 0.1 }), px: [512, 512] as [number, number] },
  [REGION.MESO]: { sculpt: ATTA_MESO, shade: shade(0.85, 0.45, 0.5, 0.2, 0.45, { coatRough: 0.32, wear: 0.25, dust: 0.22, mid: 0.1 }), px: [1024, 512] as [number, number] },
  [REGION.WAIST]: { sculpt: ATTA_WAIST, shade: shade(0.85, 0.06, 0.3, 0.2, 0.35, { coatRough: 0.32, wear: 0.2, dust: 0.22 }), px: [256, 256] as [number, number] },
  [REGION.GASTER]: { sculpt: ATTA_GASTER, shade: shade(0.8, 0.3, 0.35, 0.24, 0.5, { coatRough: 0.3, wear: 0.15, dust: 0.12, mid: 0.08, bands: [0.45, 0.65, 0.8, 0.92], band: [0.009, 0.28, 0.4, 0.035] }), px: [512, 512] as [number, number] },
  [REGION.LEG]: { sculpt: ATTA_LEG, shade: shade(1.0, 0.5, 0, 0.55, 0.35, { coatRough: 0.32, wear: 0.3, dust: 0.4, mid: 0.25, tipThin: 0.6 }), px: [128, 320] as [number, number] },
  [REGION.TARSUS]: { sculpt: FIRE_TARSUS, shade: shade(0.9, 0.45, 0, 0.55, 0.35, { coatRough: 0.38, dust: 0.55, mid: 0.2, tipThin: 0.5 }), px: [64, 128] as [number, number] },
  [REGION.ANTENNA]: { sculpt: FIRE_ANTENNA, shade: shade(0.7, 0.05, 0, 0.55, 0.35, { coatRough: 0.32, dust: 0.2, mid: 0, tipThin: 0.4 }), px: [64, 160] as [number, number] },
  [REGION.MANDIBLE]: { sculpt: ATTA_MAND, shade: shade(0.8, 0.1, 0, 0.45, 0.35, { coatRough: 0.2, wear: 0.55, dust: 0.08, tipThin: 0.7 }), px: [96, 192] as [number, number] },
};
export const ATTA: DetailRecipe = { key: 'atta', regions: attaRegions };
export const ATTA_MAJOR: DetailRecipe = {
  key: 'atta_major',
  regions: { ...attaRegions, [REGION.HEAD]: { sculpt: ATTA_MAJOR_HEAD, shade: shade(0.8, 0.35, 0.45, 0.2, 0.3, { coatRough: 0.16, wear: 0.4, dust: 0.06, mid: 0.12 }), px: [512, 512] } },
};

/**
 * Army ant (Eciton burchellii), overnight realism pass: semi-glossy, the cuticle finely microsculptured (a shallow net
 * that turns the gloss into a sheen) with scattered hair pits; sparse fine golden hairs, denser on the gaster and legs;
 * the soldier's big head smooth and glossy with darker antennal sockets (docs/creatures/eciton-burchellii.md).
 */
const EC_HEAD: Sculpt = { tile: [0.8, 0.8], noise: 0.0003, reticulum: { cell: 0.016, depth: 0.0003 }, pits: { n: 14, r: 0.005, depth: 0.001, pale: 0.12, stub: { len: 0.03, dir: -1, share: 0.7 } }, wave: { cell: 0.2, amp: 0.003 }, rough: [-0.02, 0.26], roughVar: 0.05, dirt: 0.18, mottle: 0.12, cavityDark: 0.22 };
const EC_MESO: Sculpt = { tile: [2.2, 0.8], noise: 0.0004, reticulum: { cell: 0.018, depth: 0.0006 }, pits: { n: 18, r: 0.005, depth: 0.0012, pale: 0.12, stub: { len: 0.03, dir: -1, share: 0.7 } }, wave: { cell: 0.18, amp: 0.004 }, rough: [0.06, 0.32], roughVar: 0.05, dirt: 0.3, mottle: 0.16, cavityDark: 0.26 };
const EC_GASTER_S: Sculpt = { tile: [1.2, 1.2], noise: 0.0003, reticulum: { cell: 0.014, depth: 0.0003 }, pits: { n: 60, r: 0.004, depth: 0.0008, pale: 0.25, stub: { len: 0.04, dir: 1, share: 0.9 } }, wave: { cell: 0.22, amp: 0.004 }, rough: [-0.02, 0.26], roughVar: 0.05, dirt: 0.14, mottle: 0.12, cavityDark: 0.2 };
const EC_LEG: Sculpt = { ...FIRE_LEG, tile: [0.3, 0.9], rough: [0.04, 0.3], dirt: 0.4 };
const ecRegions = {
  [REGION.HEAD]: { sculpt: EC_HEAD, shade: shade(0.8, 0.35, 0.45, 0.22, 0.35, { coatRough: 0.16, wear: 0.25, dust: 0.08, mid: 0.1 }), px: [512, 512] as [number, number] },
  [REGION.MESO]: { sculpt: EC_MESO, shade: shade(0.8, 0.45, 0.5, 0.22, 0.4, { coatRough: 0.2, wear: 0.25, dust: 0.14, mid: 0.1 }), px: [1024, 512] as [number, number] },
  [REGION.WAIST]: { sculpt: FIRE_WAIST, shade: shade(0.8, 0.06, 0.3, 0.25, 0.3, { coatRough: 0.2, wear: 0.2, dust: 0.14 }), px: [256, 256] as [number, number] },
  [REGION.GASTER]: { sculpt: EC_GASTER_S, shade: shade(0.75, 0.3, 0.35, 0.32, 0.5, { coatRough: 0.14, wear: 0.15, dust: 0.06, mid: 0.12, bands: [0.42, 0.6, 0.76, 0.9], band: [0.009, 0.22, 0.55, 0.045] }), px: [512, 512] as [number, number] },
  [REGION.LEG]: { sculpt: EC_LEG, shade: shade(1.0, 0.5, 0, 0.6, 0.35, { coatRough: 0.24, wear: 0.3, dust: 0.3, mid: 0.3, tipThin: 0.6 }), px: [128, 320] as [number, number] },
  [REGION.TARSUS]: { sculpt: FIRE_TARSUS, shade: shade(0.9, 0.45, 0, 0.6, 0.35, { coatRough: 0.36, dust: 0.5, mid: 0.2, tipThin: 0.5 }), px: [64, 128] as [number, number] },
  [REGION.ANTENNA]: { sculpt: FIRE_ANTENNA, shade: shade(0.7, 0.05, 0, 0.6, 0.35, { coatRough: 0.3, dust: 0.15, mid: 0, tipThin: 0.4 }), px: [64, 160] as [number, number] },
  [REGION.MANDIBLE]: { sculpt: FIRE_MAND, shade: shade(0.8, 0.1, 0, 0.45, 0.35, { coatRough: 0.14, wear: 0.5, dust: 0.04, tipThin: 0.7 }), px: [96, 192] as [number, number] },
};
export const ECITON: DetailRecipe = { key: 'eciton', regions: ecRegions };

/** Recipe for an ant morph (null: no baked detail yet, the material stays as before). */
export function antRecipe(morphKey: string): DetailRecipe | null {
  if (morphKey.startsWith('fire_')) return FIRE_ANT;
  if (morphKey.startsWith('lasius_')) return LASIUS;
  // (the Gene Thief ant is a Formica — modelled on F. sanguinea: the same microreticulate head and mesosoma, a dull pubescent gaster)
  if (morphKey.startsWith('formica_') || morphKey.startsWith('plagiaria_')) return FORMICA;
  // (overnight pass: the major's head smooth and shining, every other caste matte and tuberculate)
  if (morphKey === 'atta_major') return ATTA_MAJOR;
  if (morphKey.startsWith('atta_')) return ATTA;
  if (morphKey.startsWith('eciton_')) return ECITON;
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
