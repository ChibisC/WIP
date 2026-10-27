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
  // the outer margin a quarter ellipse: from straight ahead at the hinge to across the head at the apex, the
  // apex 0.47 of the hinge's distance from the midline in front of it. Closed, the pair is a low arc in
  // front of the clypeus, the cutting edges nearly transverse behind it (review: not a dome, no gap between
  // them); derived with a target outline (docs/realism/jaws.md)
  yaw: [
    [0, 0],
    [0.1, 0.48],
    [0.2, 0.8],
    [0.3, 1.0],
    [0.4, 1.145],
    [0.5, 1.253],
    [0.6, 1.341],
    [0.7, 1.417],
    [0.8, 1.486],
    [0.9, 1.553],
    [1, 1.618],
  ],
  // curving down: from above only the arc in front of the clypeus shows
  pitch: [
    [0, -0.1],
    [1, -0.3],
  ],
  outer: [
    [0, 0.05],
    [0.5, 0.045],
    [1, 0.02],
  ],
  // the basal margin (hidden under the clypeus) to the basal angle (u ≈ 0.48), then the straight masticatory
  // margin, 30° off transverse, to the apex: a proper triangle; closed, the clypeal lobe covers the space
  // between the two cutting edges
  inner: [
    [0, 0.15],
    [0.1, 0.155],
    [0.2, 0.177],
    [0.3, 0.189],
    [0.4, 0.19],
    [0.5, 0.181],
    [0.6, 0.162],
    [0.7, 0.135],
    [0.8, 0.099],
    [0.9, 0.054],
    [0.95, 0.028],
    [1, 0.004],
  ],
  // thin plates
  thick: [
    [0, 0.11],
    [0.5, 0.09],
    [1, 0.05],
  ],
  edgeIn: 1.35,
  edgeOut: 2.2,
  edgeMin: 0.16,
  // the base rounds off into the joint under the head's front corner (no flat cut)
  baseRound: 0.1,
  // four teeth: the apex is the apical (largest) one; three more along the masticatory margin, smaller
  // toward the basal angle, each leaning toward the apex
  teeth: [
    { u: 0.885, size: 0.042, base: 0.05, lean: 0.35 },
    { u: 0.76, size: 0.036, base: 0.05, lean: 0.3 },
    { u: 0.622, size: 0.028, base: 0.05, lean: 0.25 },
  ],
  // the head's own reddish brown at the base, darkening to near black at the teeth
  color: { base: 0x8a3816, mid: 0x6a2a10, tip: 0x1c0b05, teeth: 0x120704, dark: [0.55, 0.97] },
  reach: 1.1,
  nu: 44,
  nv: 9,
};

/**
 * Fire ant major: massive, black, closed tight into a blunt muzzle that continues the head's front (photo
 * fire_04: the face darkens into them); the cutting edges worn smooth by milling seeds, nearly toothless.
 */
export const FIRE_MAJOR: MandibleSpec = {
  ...FIRE_WORKER,
  // a broader quarter ellipse than the worker's (apex 0.55 of the hinge distance ahead), bending down round
  // the front of the head; closed, the two meet on the midline
  yaw: [
    [0, 0],
    [0.1, 0.416],
    [0.2, 0.726],
    [0.3, 0.939],
    [0.4, 1.093],
    [0.5, 1.212],
    [0.6, 1.31],
    [0.7, 1.396],
    [0.8, 1.474],
    [0.9, 1.549],
    [1, 1.6],
  ],
  reach: 1.0,
  pitch: [
    [0, -0.24],
    [0.5, -0.48],
    [1, -0.74],
  ],
  outer: [
    [0, 0.13],
    [0.6, 0.12],
    [1, 0.07],
  ],
  // broad, the cutting edge a blunt rounded ridge
  inner: [
    [0, 0.2],
    [0.3, 0.24],
    [0.5, 0.21],
    [0.7, 0.16],
    [0.85, 0.11],
    [1, 0.045],
  ],
  // deep: the muzzle fills the lower front of the face
  thick: [
    [0, 0.42],
    [0.6, 0.34],
    [1, 0.2],
  ],
  edgeIn: 2.0,
  edgeOut: 2.4,
  edgeMin: 0.4,
  baseRound: 0.14,
  teeth: [{ u: 0.8, size: 0.014, base: 0.1, blunt: 1 }],
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
  // how much of the major's armature a male carries: the big tooth and the denticles fade first, the fork last
  const arm = s * s * (3 - 2 * s);
  const den = Math.max(0, (s - 0.35) / 0.65);
  const teeth = [];
  // a row of fine denticles on the inner edge below the big tooth (photo stag_03), fading in smaller males
  if (den > 0) for (let k = 0; k < 7; k++) teeth.push({ u: 0.405 + k * 0.021, size: 0.011 * den * (k % 2 ? 0.8 : 1), base: 0.0095, lean: 0.35, blunt: 0.35 });
  return {
    len: 1,
    // traced on a major from above (photo stag_03; tools/mandible-overlay.py): out from the head's front corner
    // at ~55°, turning through the basal third to run straight forward, the distal third leaning in and the
    // point hooking in a little more — an antler, not a sickle. Smaller males: shorter calipers, out less at
    // the base and curving in more (photo stag_06)
    yaw: [
      [0, l(-0.45, -1.0)],
      [0.14, l(-0.32, -0.78)],
      [0.3, l(-0.15, -0.5)],
      [0.42, l(0.02, -0.17)],
      [0.52, l(0.14, -0.05)],
      [0.64, l(0.28, -0.02)],
      [0.74, l(0.42, 0.18)],
      [0.84, l(0.58, 0.32)],
      [0.93, l(0.74, 0.45)],
      [1, l(0.86, 0.58)],
    ],
    // held raised: lifting from the head, levelling toward the points
    pitch: [
      [0, l(0.16, 0.28)],
      [0.25, l(0.24, 0.46)],
      [0.55, l(0.16, 0.33)],
      [1, l(0.05, 0.1)],
    ],
    // the base: a smooth swollen bulge seated in the head's front corner, no corner or flange
    baseRound: l(0.12, 0.2),
    outer: [
      [0, l(0.1, 0.1)],
      [0.14, l(0.085, 0.1)],
      [0.3, l(0.072, 0.086)],
      [0.42, l(0.064, 0.082)],
      [0.55, l(0.056, 0.076)],
      [0.66, l(0.048, 0.058)],
      [0.72, l(0.044, 0.04)],
      [0.8, l(0.04, 0.044)],
      [0.88, l(0.032, 0.034)],
      [0.95, l(0.02, 0.02)],
      [1, l(0.004, 0.004)],
    ],
    // the inner margin: broad at the base, concave, the denticle row, then narrowing between the big tooth
    // and the fork; the point tapers to a sharp hook
    inner: [
      [0, l(0.11, 0.15)],
      [0.14, l(0.085, 0.12)],
      [0.3, l(0.068, 0.075)],
      [0.42, l(0.06, 0.066)],
      [0.55, l(0.054, 0.068)],
      [0.66, l(0.046, 0.05)],
      [0.71, l(0.042, 0.036)],
      [0.78, l(0.038, 0.046)],
      [0.86, l(0.03, 0.034)],
      [0.94, l(0.018, 0.02)],
      [1, l(0.004, 0.004)],
    ],
    thick: [
      [0, l(0.13, 0.12)],
      [0.4, l(0.095, 0.075)],
      [0.8, l(0.06, 0.05)],
      [1, l(0.02, 0.016)],
    ],
    edgeIn: 1.35,
    edgeOut: 2.0,
    edgeMin: 0.16,
    flatBelow: 0.3,
    teeth,
    // the big inner tooth at about 0.58 (a thorn standing straight in, a little forward) and the fork's inner
    // prong at about 0.78 (longer, slightly upturned; the point itself a little longer still): both shrink with
    // the male, the big tooth to a nub, the fork to a small notch-like prong
    tines: [
      { u: l(0.58, 0.565), len: l(0.035, 0.12), width: l(0.06, 0.085), thick: l(0.05, 0.055), yaw: 1.52, pitch: 0.05, curl: -0.18, across: 0.85, taper: 0.8, flare: 0.9 },
      { u: l(0.82, 0.775), len: l(0.07, 0.17), width: l(0.06, 0.08), thick: l(0.045, 0.05), yaw: l(1.0, 1.36), pitch: 0.08, curl: -0.3, across: 0.85, taper: 0.8, flare: 0.9 },
    ].filter((t) => t.len > 0.02 && (t.u > 0.7 || arm > 0.02)),
    // dark maroon at the base, near black at the points and teeth (satin; finely pitted in the detail bake)
    color: { base: 0x46181c, mid: 0x34121a, tip: 0x0a0506, teeth: 0x080405, dark: [0.45, 0.96] },
    nu: 64,
    nv: 11,
  };
}

/** A stag male's mandible length against its body length (mandibles included): ~⅓ in majors, about the head's length in minors. */
export const stagMandibleShare = (size: number): number => 0.12 + 0.22 * Math.max(0, Math.min(1, size));
