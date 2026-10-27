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
  // the outer margin a quarter ellipse (forward reach 0.27, inward 0.34 of the head width; length 0.48):
  // heading from straight ahead at the hinge to across the head at the apex
  yaw: [
    [0, 0],
    [0.1, 0.22],
    [0.2, 0.43],
    [0.3, 0.63],
    [0.5, 0.95],
    [0.7, 1.22],
    [0.9, 1.46],
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
  // the basal margin to the basal angle (u ≈ 0.45), then the masticatory margin to the apex
  inner: [
    [0, 0.15],
    [0.1, 0.24],
    [0.3, 0.315],
    [0.45, 0.335],
    [0.6, 0.31],
    [0.7, 0.27],
    [0.8, 0.21],
    [0.9, 0.125],
    [1, 0.02],
  ],
  thick: [
    [0, 0.16],
    [0.5, 0.13],
    [1, 0.07],
  ],
  edgeIn: 1.35,
  edgeOut: 2.2,
  edgeMin: 0.16,
  // the apical tooth is the apex; three more along the masticatory margin, smaller toward the base
  teeth: [
    { u: 0.885, size: 0.075, base: 0.05, lean: 0.35 },
    { u: 0.77, size: 0.065, base: 0.05, lean: 0.3 },
    { u: 0.655, size: 0.045, base: 0.05, lean: 0.25 },
  ],
  color: { base: 0x7a3214, mid: 0x5a2410, tip: 0x1c0b05, teeth: 0x120704, dark: [0.45, 0.95] },
  nu: 40,
  nv: 9,
};

/**
 * Fire ant major: short, thick, strongly curved, black; the teeth worn down by milling seeds (blunt,
 * nearly toothless).
 */
export const FIRE_MAJOR: MandibleSpec = {
  ...FIRE_WORKER,
  pitch: [
    [0, -0.12],
    [1, -0.38],
  ],
  outer: [
    [0, 0.09],
    [0.6, 0.08],
    [1, 0.045],
  ],
  inner: [
    [0, 0.18],
    [0.3, 0.29],
    [0.55, 0.31],
    [0.8, 0.19],
    [1, 0.05],
  ],
  thick: [
    [0, 0.3],
    [0.6, 0.25],
    [1, 0.14],
  ],
  edgeIn: 2.0,
  edgeOut: 2.4,
  edgeMin: 0.3,
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
      [0, l(-0.5, -0.9)],
      [0.15, l(-0.45, -0.82)],
      [0.3, l(-0.25, -0.42)],
      [0.45, l(0.0, -0.05)],
      [0.65, l(0.3, 0.12)],
      [0.78, l(0.6, 0.42)],
      [0.9, l(0.95, 0.85)],
      [1, l(1.2, 1.12)],
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
      [0, l(0.13, 0.12)],
      [0.3, l(0.085, 0.062)],
      [0.6, l(0.06, 0.042)],
      [0.85, l(0.042, 0.03)],
      [1, l(0.03, 0.018)],
    ],
    // the base's inner side a rounded lobe beside the mouth, narrowing into the blade
    inner: [
      [0, l(0.17, 0.2)],
      [0.08, l(0.18, 0.22)],
      [0.18, l(0.15, 0.17)],
      [0.3, l(0.1, 0.095)],
      [0.45, l(0.08, 0.062)],
      [0.6, l(0.065, 0.045)],
      [0.85, l(0.047, 0.034)],
      [1, l(0.025, 0.018)],
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
            // the large inner tooth at about half way: a broad flat point standing in from the inner edge,
            // leaning back toward the head
            { u: 0.5, size: 0.13, base: 0.055, lean: -0.35 },
            // small teeth on the broad base, a row of denticles from the big tooth to the fork
            { u: 0.2, size: 0.016, base: 0.03, lean: 0.3, blunt: 0.6 },
            { u: 0.27, size: 0.013, base: 0.026, lean: 0.3, blunt: 0.6 },
                        { u: 0.65, size: 0.022, base: 0.02, lean: 0.4 },
            { u: 0.7, size: 0.015, base: 0.018, lean: 0.4 },
            { u: 0.75, size: 0.02, base: 0.018, lean: 0.4 },
                      ]
        : [{ u: 0.72, size: l(0.06, 0.03), base: 0.08, lean: 0.3 }],
    tines:
      s > 0.5
        ? [
            // the fork: an inner prong pointing in beside the point and rising above it (the upper prong)
            { u: 0.77, len: l(0.1, 0.2), width: l(0.07, 0.075), thick: l(0.045, 0.04), yaw: 1.0, pitch: 0.22, curl: 0.1, across: 0, taper: 0.8 },
          ]
        : [],
    color: { base: 0x4a1c1b, mid: 0x3a1519, tip: 0x120809, teeth: 0x0c0507, dark: [0.55, 0.97] },
    nu: 56,
    nv: 11,
  };
}

/** A stag male's mandible length against its body length (mandibles included): ~⅓ in majors, ~⅙ in minors. */
export const stagMandibleShare = (size: number): number => 0.17 + 0.17 * Math.max(0, Math.min(1, size));
