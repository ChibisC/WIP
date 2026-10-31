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
  // apex 0.58 of the hinge's distance from the midline in front of it (pilot finish: clearly visible, as the spec asks). Closed, the pair is a low arc in
  // front of the clypeus, the cutting edges nearly transverse behind it (review: not a dome, no gap between
  // them); derived with a target outline (docs/realism/jaws.md)
  yaw: [
    [0, 0],
    [0.1, 0.347],
    [0.2, 0.633],
    [0.3, 0.851],
    [0.4, 1.019],
    [0.5, 1.153],
    [0.6, 1.266],
    [0.7, 1.365],
    [0.8, 1.456],
    [0.9, 1.543],
    [1, 1.629],
  ],
  // nearly level, curving down a little: from above the toothed triangles show in front of the head
  pitch: [
    [0, -0.04],
    [1, -0.16],
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
    [0, 0.16],
    [0.1, 0.168],
    [0.2, 0.19],
    [0.3, 0.199],
    [0.4, 0.197],
    [0.5, 0.186],
    [0.6, 0.171],
    [0.7, 0.145],
    [0.8, 0.109],
    [0.9, 0.061],
    [0.95, 0.033],
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
    { u: 0.89, size: 0.042, base: 0.05, lean: 0.35 },
    { u: 0.768, size: 0.036, base: 0.05, lean: 0.3 },
    { u: 0.63, size: 0.028, base: 0.05, lean: 0.25 },
  ],
  // amber like the head, the cutting edge and teeth near black (review: two jaws, not one dark rim)
  color: { base: 0x9a461a, mid: 0x8a3c16, tip: 0x4a1a0a, teeth: 0x140704, dark: [0.75, 1.0] },
  edgeDark: 0.85,
  // closed, the apexes cross a little past each other
  reach: 1.18,
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
  // a heavy wedge, the end broad and rounded (not hooked back)
  pitch: [
    [0, -0.26],
    [0.5, -0.42],
    [1, -0.55],
  ],
  outer: [
    [0, 0.16],
    [0.6, 0.15],
    [1, 0.09],
  ],
  // broad, the cutting edge a blunt rounded ridge
  inner: [
    [0, 0.24],
    [0.3, 0.3],
    [0.5, 0.27],
    [0.7, 0.2],
    [0.85, 0.13],
    [1, 0.05],
  ],
  // deep: the muzzle fills the lower front of the face
  thick: [
    [0, 0.5],
    [0.6, 0.42],
    [1, 0.26],
  ],
  edgeIn: 2.0,
  edgeOut: 2.4,
  edgeMin: 0.4,
  baseRound: 0.14,
  teeth: [{ u: 0.8, size: 0.014, base: 0.1, blunt: 1 }],
  color: { base: 0x3a150a, mid: 0x261008, tip: 0x120604, teeth: 0x0a0403, dark: [0.3, 0.9] },
  edgeDark: 0,
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
  const den = Math.max(0, (s - 0.35) / 0.65);
  // small males' jaws are short and stout: their widths are larger fractions of their length
  const st = 1 + 0.45 * (1 - s);
  const W = (c: [number, number][]): [number, number][] => c.map(([u, v]) => [u, v * st]);
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
      [0, l(-0.22, -1.0)],
      [0.14, l(-0.16, -0.78)],
      [0.3, l(-0.08, -0.5)],
      [0.42, l(0.0, -0.17)],
      [0.52, l(0.06, -0.05)],
      [0.64, l(0.14, -0.02)],
      [0.74, l(0.24, 0.18)],
      [0.84, l(0.34, 0.32)],
      [0.93, l(0.46, 0.45)],
      [1, l(0.56, 0.58)],
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
    outer: W([
      [0, l(0.1, 0.1)],
      [0.14, l(0.085, 0.092)],
      [0.3, l(0.072, 0.086)],
      [0.42, l(0.064, 0.082)],
      [0.55, l(0.056, 0.076)],
      [0.66, l(0.048, 0.058)],
      [0.72, l(0.044, 0.04)],
      [0.8, l(0.04, 0.044)],
      [0.88, l(0.032, 0.034)],
      [0.95, l(0.02, 0.02)],
      [1, l(0.004, 0.004)],
    ]),
    // the inner margin: broad at the base, concave, the denticle row, then narrowing between the big tooth
    // and the fork; the point tapers to a sharp hook
    inner: W([
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
    ]),
    thick: W([
      [0, l(0.11, 0.09)],
      [0.4, l(0.095, 0.075)],
      [0.8, l(0.06, 0.05)],
      [1, l(0.02, 0.016)],
    ]),
    edgeIn: 1.35,
    edgeOut: 1.7,
    edgeMin: 0.16,
    flatBelow: 0.3,
    teeth,
    // the big inner tooth at about 0.58 (a thorn standing straight in, a little forward) and the fork's inner
    // prong at about 0.78 (longer, slightly upturned; the point itself a little longer still): both shrink with
    // the male, the big tooth to a nub, the fork to a small notch-like prong
    tines: [
      { u: l(0.6, 0.565), len: l(0.04, 0.1), width: l(0.07, 0.09), thick: l(0.03, 0.03), yaw: 1.52, pitch: 0.05, curl: -0.18, across: 0.85, taper: 0.9, flare: 1.3 },
      { u: l(0.8, 0.775), len: l(0.08, 0.15), width: l(0.08, 0.085), thick: l(0.03, 0.03), yaw: l(1.0, 1.36), pitch: 0.08, curl: -0.35, across: 0.85, taper: 0.9, flare: 1.3 },
    ].filter((t) => t.len > 0.02),
    // dark maroon at the base, near black at the points and teeth (satin; finely pitted in the detail bake)
    color: { base: 0x3e1c22, mid: 0x2e161c, tip: 0x0a0506, teeth: 0x080405, dark: [0.45, 0.96] },
    nu: 64,
    nv: 11,
  };
}

/** A stag male's mandible length against its body length (mandibles included): ~⅓ in majors, about the head's length in minors. */
export const stagMandibleShare = (size: number): number => 0.075 + 0.265 * Math.max(0, Math.min(1, size));

/**
 * Rollout (spec 03/04): a formicine worker's triangular mandible (Lasius, Formica, the formicine queens): the fire
 * ant worker's plate, with a longer straight masticatory margin carrying `teeth` teeth from the apical one (the
 * apex) down to the basal angle, larger and smaller alternating and shrinking toward the base (Formicinae: 7–9
 * teeth), and the species' colours.
 */
export function formicineMandible(o: { teeth: number; color: MandibleSpec['color']; reach?: number; broad?: number; thick?: number; pitch?: [number, number] | [number, number, number]; edgeDark?: number; heading?: number; roll?: number }): MandibleSpec {
  const n = Math.max(1, o.teeth - 1);
  const teeth = [];
  for (let k = 0; k < n; k++) {
    const f = k / Math.max(1, n - 1);
    // from just behind the apex (u 0.92) to the basal angle (u 0.4)
    teeth.push({ u: 0.92 - 0.52 * f, size: (0.036 - 0.014 * f) * (k % 2 ? 0.75 : 1), base: 0.045, lean: 0.32 - 0.1 * f });
  }
  const b = o.broad ?? 1;
  const h = o.heading ?? 0.68;
  return {
    ...FIRE_WORKER,
    // (user note: real formicine jaws are triangles, not crescents) — the external margin nearly straight from
    // the hinge, set well inward, turning in only over the last fifth to the apical tooth; the masticatory
    // margin a straight toothed line from the apex back to a broad basal angle (u 0.3, 0.46 of the length
    // across): a flat triangular plate. Closed, the pair is a blunt arrowhead in front of the clypeus, the
    // apical teeth crossing; open, two toothed triangles (docs/realism/jaws.md)
    yaw: [
      [0, h],
      [0.5, h + 0.1],
      [0.8, h + 0.27],
      [0.94, h + 0.52],
      [1, h + 0.77],
    ],
    outer: [
      [0, 0.05],
      [0.6, 0.05],
      [1, 0.015],
    ],
    inner: [
      [0, 0.2 * b],
      [0.3, 0.46 * b],
      [1, 0.004],
    ],
    teeth,
    color: o.color,
    reach: o.reach ?? 1.1,
    ...(o.thick ? { thick: FIRE_WORKER.thick.map(([u, v]) => [u, v * o.thick!] as [number, number]) } : {}),
    // three values: hinge, 0.6 along, apex — the blade hooks down toward the point (a beak from the side)
    ...(o.pitch ? { pitch: (o.pitch.length === 3 ? [[0, o.pitch[0]], [0.6, o.pitch[1]], [1, o.pitch[2]]] : [[0, o.pitch[0]], [1, o.pitch[1]]]) as [number, number][] } : {}),
    ...(o.edgeDark !== undefined ? { edgeDark: o.edgeDark } : {}),
    // (the user's photos: open, seen from the side, the jaw is a big triangle, its teeth along the lower front
    // edge — the blade is tilted, the toothed margin below the external one)
    ...(o.roll ? { roll: [[0, o.roll * 0.6], [0.5, o.roll], [1, o.roll]] as [number, number][] } : {}),
  };
}

/** Black garden ant (Lasius niger): dark brown jaws, a little paler and redder along the masticatory margin, the teeth black (docs/creatures/lasius-niger.md). */
// (the user's photos: the jaws orange-brown, paler than the head, darkening at the teeth)
// (closed, the formicine jaws overlap well past the midline, the apical teeth crossing: larger blades than the fire
// ant's — the photos)
// (user note: they didn't look like the photos — closed, Lasius jaws are a broad, thick, rounded muzzle in front of the
// head, curving down like a beak, orange-brown and paler than the head, only the cutting edge darker)
export const LASIUS_WORKER = formicineMandible({ teeth: 8, color: { base: 0x7a4a24, mid: 0x8a5428, tip: 0x6a3a1c, teeth: 0x2a1408, dark: [0.86, 1.0] }, reach: 1.14, broad: 1.15, thick: 1.9, pitch: [-0.1, -0.26, -0.5], edgeDark: 0.45, roll: 0.55 });
/** Red wood ant (Formica rufa): reddish-brown jaws darkening to black at the teeth (docs/creatures/formica-rufa.md). */
// (the user's photos: red-orange jaws, near black at the teeth)
// (user note and photos: closed, a pointed beak projecting forward and down from the head, red-orange and paler than
// the face; open, two big curved red blades with dark tips and teeth)
export const FORMICA_WORKER = formicineMandible({ teeth: 8, color: { base: 0xa04a20, mid: 0x9a4220, tip: 0x5a2410, teeth: 0x1a0a06, dark: [0.8, 1.0] }, reach: 1.14, broad: 1.15, thick: 1.85, pitch: [-0.12, -0.3, -0.56], edgeDark: 0.6, roll: 0.6 });
