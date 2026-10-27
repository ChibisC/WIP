import type { MandibleSpec } from './mandible';

/**
 * Mandible specs per species (jaws pass). The numbers come from each species' "Mandibles" section in
 * docs/creatures/<id>.md, measured on the reference photos (study only) and the literature. Lengths are
 * fractions of the mandible's own length (hinge → apex along the centreline); `len` is set by the builder.
 */

/**
 * Tropical fire ant worker (Solenopsis geminata, minor): a short subtriangular plate, the outer margin
 * convex and curving in, the masticatory margin with four teeth (the apical one largest, the basal one
 * smallest), reddish brown darkening to near black at the teeth; slightly glossy. Closed, the two overlap a
 * little in front of the clypeus; open, they spread 60–90° apart.
 */
export const FIRE_WORKER: MandibleSpec = {
  len: 1,
  // the outer margin a quarter ellipse (forward reach 0.235, inward 0.34 of the head width; length 0.46):
  // heading from straight ahead at the hinge to across the head at the apex. Closed, the pair shows clearly in
  // front of the clypeus as two toothed triangles (not a dome reaching far forward)
  yaw: [
    [0, 0],
    [0.1, 0.28],
    [0.2, 0.52],
    [0.3, 0.73],
    [0.5, 1.05],
    [0.7, 1.28],
    [0.9, 1.48],
    [1, 1.57],
  ],
  pitch: [
    [0, -0.08],
    [1, -0.28],
  ],
  outer: [
    [0, 0.06],
    [0.5, 0.05],
    [1, 0.025],
  ],
  // the basal margin to the basal angle (u ≈ 0.5), then the masticatory margin to the apex
  inner: [
    [0, 0.155],
    [0.1, 0.228],
    [0.3, 0.288],
    [0.5, 0.313],
    [0.6, 0.292],
    [0.7, 0.249],
    [0.8, 0.189],
    [0.9, 0.108],
    [1, 0.02],
  ],
  // thin plates
  thick: [
    [0, 0.12],
    [0.5, 0.1],
    [1, 0.06],
  ],
  edgeIn: 1.35,
  edgeOut: 2.2,
  edgeMin: 0.16,
  // the base rounds off into the joint under the head's front corner (no flat cut)
  baseRound: 0.1,
  // the apical tooth is the apex; three more along the masticatory margin, smaller toward the base
  teeth: [
    { u: 0.885, size: 0.065, base: 0.05, lean: 0.35 },
    { u: 0.77, size: 0.055, base: 0.05, lean: 0.3 },
    { u: 0.655, size: 0.04, base: 0.05, lean: 0.25 },
  ],
  // the head's own reddish brown at the base, darkening to near black at the teeth
  color: { base: 0x8a3816, mid: 0x6a2a10, tip: 0x1c0b05, teeth: 0x120704, dark: [0.55, 0.97] },
  nu: 40,
  nv: 9,
};

/**
 * Fire ant major: short, thick, strongly curved, black; the teeth worn down by milling seeds (blunt,
 * nearly toothless).
 */
export const FIRE_MAJOR: MandibleSpec = {
  ...FIRE_WORKER,
  // deep and strongly curved, bending down to wrap the front of the head (photo fire_04); worn, the points
  // stop short of meeting
  reach: 0.85,
  pitch: [
    [0, -0.22],
    [0.5, -0.55],
    [1, -0.9],
  ],
  outer: [
    [0, 0.1],
    [0.6, 0.09],
    [1, 0.05],
  ],
  inner: [
    [0, 0.2],
    [0.3, 0.3],
    [0.55, 0.32],
    [0.8, 0.2],
    [1, 0.05],
  ],
  thick: [
    [0, 0.32],
    [0.6, 0.26],
    [1, 0.14],
  ],
  edgeIn: 2.0,
  edgeOut: 2.4,
  edgeMin: 0.35,
  teeth: [
    { u: 0.84, size: 0.035, base: 0.09, blunt: 1 },
    { u: 0.66, size: 0.025, base: 0.09, blunt: 1 },
  ],
  color: { base: 0x2a1209, mid: 0x1a0b06, tip: 0x0c0503, teeth: 0x080302, dark: [0.3, 0.9] },
};

/**
 * European stag beetle male (Lucanus cervus). `size` 0 = a small (minor) male, 1 = a large major male
 * (allometry: photos stag_06, five males from small to large). A major's mandibles are broad, flattened
 * blades as long as the head and pronotum together: wide at the base (about the width of the eye
 * region), curving outward, then back inward so the tips nearly meet; rising gently; one large inner
 * tooth at about two thirds, angled in and a little up; a few small teeth near the base and a row of
 * denticles toward the fork; the tip forked, the upper prong a little longer. Reddish brown to chestnut
 * (a little darker and duller than the elytra), near black at the tips and teeth, satin. A minor male's
 * are short and simple: a gentle inward curve, one small tooth near the point, no fork.
 */
export function stagMandible(size: number): MandibleSpec {
  const s = Math.max(0, Math.min(1, size));
  const l = (a: number, b: number) => a + (b - a) * s;
  return {
    len: 1,
    // out from the head's front corner at ~45° (continuing its side), turning to run forward through the
    // middle, then hooking in toward the point (photos stag_05, stag_06)
    yaw: [
      [0, l(-0.25, -0.9)],
      [0.15, l(-0.2, -0.82)],
      [0.3, l(-0.12, -0.42)],
      [0.45, l(0.0, -0.05)],
      [0.65, l(0.12, 0.12)],
      [0.78, l(0.25, 0.42)],
      [0.9, l(0.45, 0.85)],
      [1, l(0.65, 1.12)],
    ],
    // rising gently: level where it leaves the head, lifting through the basal third
    pitch: [
      [0, l(0.08, 0.1)],
      [0.2, l(0.15, 0.26)],
      [0.5, l(0.1, 0.18)],
      [1, l(0.02, 0.06)],
    ],
    // the base rounds off into the condyle seated in the head's front corner
    baseRound: l(0.16, 0.16),
    // broad at the base (a third of the head's width), broad through the middle, then tapering
    outer: [
      [0, l(0.12, 0.1)],
      [0.3, l(0.085, 0.072)],
      [0.6, l(0.06, 0.05)],
      [0.85, l(0.042, 0.035)],
      [1, l(0.03, 0.02)],
    ],
    // tapering evenly from a broad base like a horn (review: no lobe at the base)
    inner: [
      [0, l(0.15, 0.15)],
      [0.25, l(0.11, 0.1)],
      [0.45, l(0.085, 0.072)],
      [0.6, l(0.07, 0.058)],
      [0.85, l(0.05, 0.042)],
      [1, l(0.025, 0.02)],
    ],
    thick: [
      [0, l(0.16, 0.11)],
      [0.4, l(0.12, 0.07)],
      [1, l(0.05, 0.03)],
    ],
    edgeIn: 1.25,
    edgeOut: 2.0,
    edgeMin: 0.14,
    flatBelow: 0.3,
    teeth:
      s > 0.5
        ? [
            // the large inner tooth at about 0.58: stout, a little two-pointed, angled forward (photos stag_02, stag_05)
            { u: 0.58, size: 0.085, base: 0.07, lean: 0.5 },
            { u: 0.635, size: 0.045, base: 0.03, lean: 0.4 },
            // a row of small blunt denticles toward the fork
            { u: 0.69, size: 0.018, base: 0.018, lean: 0.4, blunt: 0.4 },
            { u: 0.725, size: 0.022, base: 0.02, lean: 0.4, blunt: 0.4 },
            { u: 0.76, size: 0.018, base: 0.018, lean: 0.4, blunt: 0.4 },
            { u: 0.795, size: 0.02, base: 0.018, lean: 0.4, blunt: 0.4 },
            // the fork: a stout subapical tooth pointing in beside the hooked point
            { u: 0.89, size: 0.07, base: 0.05, lean: 0.65 },
          ]
        : [{ u: 0.72, size: l(0.04, 0.03), base: 0.07, lean: 0.4 }],
    tines: [],
    color: { base: 0x4c1a20, mid: 0x3c1420, tip: 0x0e0608, teeth: 0x0a0406, dark: [0.5, 0.97] },
    nu: 56,
    nv: 11,
  };
}

/** A stag male's mandible length against its body length (mandibles included): ~⅓ in majors, about the head's length in minors. */
export const stagMandibleShare = (size: number): number => 0.12 + 0.22 * Math.max(0, Math.min(1, size));
