// @ts-nocheck
/**
 * Saiy-Ant morphs (Aurimyrmex fulgurans, fictional Camponotus-like formicine), from the
 * user's verified prototype (claude/saiy-ants/04-prototype-code.md). Shared builder;
 * glossy jet black with a blue-black sheen; the gold form is in the shader (aE.x).
 */
const L = (color, rough, coat, sheen, color2) => ({ color, color2, rough, coat, sheen });
// ===== SAIY-ANT MORPHS (Aurimyrmex fulgurans, fictional Camponotus-like formicine) =====
// Uses the game's shared morph builder unchanged. Normal coloration: glossy jet black with a
// blue-black sheen; the gold form is done entirely in the shader (per-instance aE.x).
const SAIY_LOOK = {
  head: L(0x0b0a0e, 0.3, 0.55, 0.22, 0x1a1c2c),     // color2: blue-black sheen toward the vertex
  meso: L(0x0c0b10, 0.32, 0.5, 0.2, 0x1c1e30),
  waist: L(0x0e0d12, 0.34, 0.45, 0.18),
  gaster: L(0x0a090d, 0.26, 0.6, 0.28, 0x2a2426),  // color2: faint lighter band at segment edges
  legs: L(0x241a14, 0.45, 0.1, 0.06, 0x241a14),    // no light bands; joints are lightened by the shared builder's joint pieces only
  antenna: L(0x241a14, 0.45, 0.1, 0.06, 0x2c2018),
  mandible: L(0x2a1c14, 0.35, 0.4, 0, 0x120c08),
};
const SAIY_WORKER = {
  key: "saiy_worker", L: 6,
  head: { len: 0.22, width: 0.21, height: 0.15, shape: "heart", notch: 0.05 },
  eyes: { size: 0.24, pos: 0.5, height: 0.22, ocelli: false, smooth: true },
  antenna: { segments: 12, scape: 1.2, funiculus: 1.25, club: 0, thick: 0.0115, smooth: true },
  mandible: { type: "triangular", len: 0.4, teeth: 7, width: 0.58 },
  meso: { len: 0.34, width: 0.12, height: 0.135, smooth: true },
  waist: { nodes: 1, len: 0.05, scale: true, nodeH: 0.13 },
  gaster: { len: 0.38, width: 0.22, height: 0.18, sting: false },
  legs: { hind: 1.1, thick: 0.0135 },
  look: SAIY_LOOK, hair: 0.3, stance: 0.15,
  // six separate swept-back spikes, exact recipe from brief 07 (head-local, units of head length)
  hair6: { flat: 0.75, sag: 0.06, curl: 0.05, twist: 0.6, strands: 5, strays: 8, rough: 0.46, cap: { at: [-0.15, 0.3], r: [0.42, 0.14, 0.36] }, spikes: [
    { at: [0.10, 0.38, 0], yaw: 0, pitch: 12, len: 0.85, w: 0.45 },
    { at: [0.00, 0.33, -0.20], yaw: 12, pitch: 8, len: 0.75, w: 0.40 }, { at: [0.00, 0.33, 0.20], yaw: 12, pitch: 8, len: 0.75, w: 0.40 },
    { at: [-0.26, 0.18, -0.34], yaw: 22, pitch: 4, len: 0.60, w: 0.35 }, { at: [-0.26, 0.18, 0.34], yaw: 22, pitch: 4, len: 0.60, w: 0.35 },  // moved behind the eye so no hair overlaps it
    { at: [-0.35, 0.02, 0], yaw: 0, pitch: 0, len: 0.50, w: 0.30 },
  ] },
};
const SAIY_SOLDIER = {
  ...SAIY_WORKER, key: "saiy_soldier", L: 9,
  // allometric: broader, squarer head with heavier mandibles; sturdier legs; slightly shorter relative legs
  head: { len: 0.26, width: 0.27, height: 0.18, shape: "square", notch: 0.03 },
  eyes: { size: 0.19, pos: 0.52, height: 0.2, ocelli: false, smooth: true },
  antenna: { ...SAIY_WORKER.antenna, scape: 1.0, funiculus: 1.15 },
  mandible: { type: "massive", len: 0.4, teeth: 6, width: 0.7 },
  meso: { len: 0.33, width: 0.135, height: 0.15, smooth: true },
  gaster: { len: 0.36, width: 0.22, height: 0.18, sting: false },
  legs: { hind: 1.0, thick: 0.0155 },
  look: { ...SAIY_LOOK, head: L(0x0a090e, 0.28, 0.6, 0.22, 0x1c1e30) },
  hair6: { ...SAIY_WORKER.hair6, wMul: 1.15, lenMul: 1.05, strands: 7, twist: 0.45, cap: { at: [-0.15, 0.3], r: [0.44, 0.16, 0.38] } },
};
const SAIY_QUEEN = {
  ...SAIY_WORKER, key: "saiy_queen", L: 14,
  head: { len: 0.16, width: 0.16, height: 0.11, shape: "heart", notch: 0.04 },
  eyes: { size: 0.22, pos: 0.5, height: 0.22, ocelli: true, smooth: true },
  antenna: { ...SAIY_WORKER.antenna, scape: 1.05, funiculus: 1.15 },
  mandible: { type: "triangular", len: 0.36, teeth: 7, width: 0.58 },
  meso: { len: 0.3, width: 0.17, height: 0.19, queen: true },
  waist: { nodes: 1, len: 0.035, scale: true, nodeH: 0.11 },
  gaster: { len: 0.5, width: 0.29, height: 0.24, sting: false },
  legs: { hind: 0.72, thick: 0.0125 },
  look: { ...SAIY_LOOK, meso: L(0x0e0d12, 0.34, 0.45, 0.2, 0x1e2032), gaster: L(0x0a090d, 0.26, 0.6, 0.3, 0x2a2426) },
  wingScars: true, stance: 0.12,
  // queen: spikes 1-3 x1.5 length, 4-6 unchanged
  hair6: { ...SAIY_WORKER.hair6, queen: true, strands: 8, rough: 0.36, curl: 0.09, spikes: SAIY_WORKER.hair6.spikes.map((s, k) => k < 3 ? { ...s, lenMul: 1.5 } : s) },
};
export const SAIY_MORPHS = { saiy_worker: SAIY_WORKER, saiy_soldier: SAIY_SOLDIER, saiy_queen: SAIY_QUEEN };
// ===== END SAIY-ANT MORPHS =====

