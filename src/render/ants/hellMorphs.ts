// @ts-nocheck
/** Hell ant morphs (claude/hell-ants/06-prototype-code.md, hell_morphs2.js): dimmed copper palette; proportions in head lengths. */
// ===== HELL ANT MORPHS v2 (proportions in head lengths; colours follow reference 4) =====
// Colours are an artistic reconstruction: amber fossils do not preserve colour.
const HELL_COLORS = {
  body: 0x6a3a22, bodyDark: 0x3e1e12, bodyLight: 0x865232, head: 0x6a3a22, headDark: 0x3e1e12,
  gasterRear: 0x54221a, gasterRearDark: 0x2e120e, band: 0x7e5036,
  // (realism rework 2026-11-02: legs a warm brown-orange, not toy orange; the jaws dark, near black at the tips)
  leg: 0x7c3c1e, legLight: 0x92502a, legDark: 0x4e2212, claw: 0x2e1c0e, mand: 0x4e2414, mandTip: 0x1a0c06,
  hornBase: 0x6a3a22, hornTip: 0x9e6040, eye: 0x3a3026, hair: 0xb8a482, trigger: 0x4a4234, fringe: 0xa8977a,
  spot: 0x3c3620, scar: 0x3e2d1a, plate: 0x4a3f26,
};
// (realism rework: smooth and shining, little pubescence — the baked detail adds the microsculpture and hair pits)
const HELL_SURF = {
  // (review round 1: "one uniform glossy plastic per part, a single hotspot" — less clearcoat, more roughness; the baked
  // sculpture breaks the highlight up)
  body: { rough: 0.5, coat: 0.28, sheen: 0.1 }, leg: { rough: 0.46, coat: 0.25, sheen: 0.12 },
  mandible: { rough: 0.32, coat: 0.55, sheen: 0.04 }, horn: { rough: 0.42, coat: 0.35, sheen: 0.1 },
  hornTip: { rough: 0.18, coat: 0.95, sheen: 0.05 }, hair: { rough: 0.6, coat: 0.1, sheen: 0.15 },
};
const HELL_BASE = {
  builder: "hell", units: 5.5, stance: 1.15,
  look: { colors: HELL_COLORS, ...HELL_SURF },
  meso: { len: 2.0, h: 0.72, w: 0.6 },
  neck: 0.2, neckY: 0.5,
  head: { tilt: -0.7, h: 0.82, w: 0.74, notch: 0.12 },
  eyes: { pos: 0.5, up: 0.15, len: 0.2, ht: 0.15 },
  horn: { pts: [[0, 0], [0.28, 0.55], [0.6, 1.1], [0.85, 1.55], [0.92, 1.82]], r0: 0.075, r1: 0.05, r2: 0.035, flat: 0.8, tip: "spoon", tipLen: 0.16, tipW: 0.07, tipThick: 0.03, hook: 0,
    fringe: { count: 26, from: 0.2, to: 0.97, len: 0.42 } },
  // four trigger hairs, two per side, in Ceratomyrmex (hell-ant.md §3)
  trigger: { count: 4, len: 1.0, ang: 0.35 },
  mandible: { pts: [[0, 0], [0.3, -0.35], [0.75, -0.22], [1.05, 0.4], [1.08, 1.1], [0.85, 1.75]], hingeZ: 0.16, tipZ: 0.05, r: 0.046, depth: 1.5, teeth: 0, teethFrom: 0.7, teethTo: 0.9, tooth: 0.08, openExtra: 0.55 },
  antenna: { scapeAng: 1.5, splay: 0.22, scape: 1.05, r: 0.045, funiStart: 0.2, funiBend: 1.5, funi: 3.0 },
  petiole: 0.5, node: { h: 0.32 },
  gaster: { len: 1.85, h: 1.0, w: 0.95, tilt: 0.08, constrict: 0.2, at: 0.3 },
  // (user 2026-11-02: "their legs are pretty long … look so compact; make them walk like the other ants" — the legs
  // 1.25× longer and the feet set out as wide as the other ants' (about half a body length either side; they were a
  // fifth), the body carried higher on them)
  legs: { thick: 0.062, pairs: [
    { cx: 0.82, coxaDir: [0.5, -0.6, 0.6], coxa: 0.3, foot: [2.0, 2.6], tarsus: 1.05, femur: 1.3, tibia: 1.25 },
    { cx: 0.52, coxaDir: [0.1, -0.6, 0.8], coxa: 0.3, foot: [-0.1, 3.5], tarsus: 1.2, femur: 1.5, tibia: 1.5 },
    { cx: 0.2, coxaDir: [-0.4, -0.6, 0.6], coxa: 0.32, foot: [-2.7, 2.9], tarsus: 1.5, femur: 1.8, tibia: 1.85 },
  ] },
  gait: { lift: 0.34, duty: 0.55 },
};
const HELL_WORKER = { ...HELL_BASE, key: "hell_worker", L: 5.0 };
const HELL_SOLDIER = { ...HELL_BASE, key: "hell_soldier", L: 6.5,
  look: { ...HELL_BASE.look, colors: { ...HELL_COLORS, head: 0x5e301c, headDark: 0x361a10, hornTip: 0x2c160c } },
  head: { ...HELL_BASE.head, h: 0.84, w: 0.8 },
  horn: { pts: [[0, 0], [0.2, 0.45], [0.42, 0.85], [0.58, 1.2]], r0: 0.11, r1: 0.085, r2: 0.07, flat: 0.6, tip: "paddle", tipLen: 0.5, tipW: 0.16, tipThick: 0.04, hook: 0.06,
    fringe: { count: 10, from: 0.55, to: 0.95, len: 0.22 } },
  mandible: { ...HELL_BASE.mandible, pts: [[0, 0], [0.3, -0.3], [0.66, -0.15], [0.88, 0.4], [0.86, 0.95], [0.66, 1.3]], r: 0.066, teeth: 3, teethFrom: 0.72, teethTo: 0.92, tooth: 0.09 },
  legs: { ...HELL_BASE.legs, thick: 0.068 },
};
const HELL_QUEEN = { ...HELL_BASE, key: "hell_queen", L: 7.6,
  look: { ...HELL_BASE.look, colors: { ...HELL_COLORS, body: 0x5e321e, bodyDark: 0x381c12, head: 0x5e321e, headDark: 0x381c12 } },
  meso: { len: 2.1, h: 0.95, w: 0.8, queen: true },
  head: { ...HELL_BASE.head, h: 0.74, w: 0.68 },
  eyes: { pos: 0.56, up: 0.32, len: 0.15, ht: 0.11 },
  horn: { ...HELL_BASE.horn, pts: [[0, 0], [0.22, 0.45], [0.48, 0.85], [0.66, 1.2], [0.72, 1.4]], r0: 0.08, r1: 0.055, r2: 0.04, tipLen: 0.14, tipW: 0.065, fringe: { count: 20, from: 0.22, to: 0.97, len: 0.34 } },
  mandible: { ...HELL_BASE.mandible, teeth: 6, teethFrom: 0.5, teethTo: 0.93, tooth: 0.05 },
  antenna: { ...HELL_BASE.antenna, scape: 1.3 },
  // Haidomyrmex: two trigger hairs on the clypeal pad
  trigger: { count: 2, len: 0.8, ang: 0.35 },
  gaster: { len: 2.3, h: 1.15, w: 1.1, tilt: 0.1, constrict: 0.17, at: 0.28 },
  legs: { ...HELL_BASE.legs, thick: 0.058 },
  stance: 1.05,
};
export const HELL_MORPHS = { hell_worker: HELL_WORKER, hell_soldier: HELL_SOLDIER, hell_queen: HELL_QUEEN };
// ===== END HELL ANT MORPHS v2 =====

