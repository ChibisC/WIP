// @ts-nocheck
/**
 * Saiy-Ant morphs (Aurimyrmex fulgurans: fictional, built on a real carpenter ant, Camponotus). Model redo
 * (claude/realism/10-spec-saiy-ant-sickle-jaw-models.md) on the fire ant pilot's playbook: proportions from
 * C. pennsylvanicus measurements (Mackay 2019: minor, major and female head, scape, eye, mesosoma and femur lengths;
 * docs/creatures/aurimyrmex-fulgurans.md §6), five-toothed parametric jaws, antennal sockets set well back from the
 * clypeus, eyes behind the head's middle, one smooth mesosomal arch, a scale-like petiole, long legs, sparse erect
 * setae with golden-grey pubescence on the gaster, baked cuticle (bake/recipes.ts SAIY). Normal colour: deep black
 * with a faint blue-black sheen; the gold form is in the shader (aE.x). The six hair locks are the user's design
 * (claude/saiy-ants/07, 08): unchanged.
 */
import { SAIY_QUEEN_JAW, SAIY_SOLDIER_JAW, SAIY_WORKER_JAW } from '../anatomy/mandibleSpecs';

const L = (color, rough, coat, sheen, color2) => ({ color, color2, rough, coat, sheen });
// ===== SAIY-ANT MORPHS (Aurimyrmex fulgurans, fictional Camponotus-like formicine) =====
// black cuticle with a blue-black sheen toward the light (color2), satin rather than mirror (densely punctate head,
// finely punctate gaster); the gaster's appressed golden-grey pubescence as sheen; legs and antennae a very dark
// brown, lighter at the joints and tarsi; jaws black-brown, darkest at the teeth
const SAIY_LOOK = {
  head: L(0x0b0a0e, 0.42, 0.3, 0.05, 0x181b2a),
  meso: L(0x0c0b0f, 0.45, 0.28, 0.06, 0x1a1d2c),
  waist: L(0x0d0c10, 0.46, 0.25, 0.05),
  gaster: L(0x0a090c, 0.4, 0.32, 0.3, 0x262220),
  legs: L(0x161110, 0.48, 0.15, 0.04, 0x2a1e16),
  antenna: L(0x181210, 0.5, 0.12, 0.04, 0x2a1e16),
  // (review round 1: "make the mandibles look better") a dark reddish-brown, as the jaws of black carpenter ants read
  // against the black head, their toothed edge near-black
  mandible: L(0x2e1a10, 0.32, 0.42, 0, 0x120a06),
};
// sparse pale erect setae (none on the cheeks and scapes), more on the mesosoma and gaster
const SAIY_SETAE = { color: 0xb8a47a, head: 14, meso: 28, gaster: 70, len: [0.012, 0.042] };
const SAIY_WORKER = {
  key: "saiy_worker", L: 6, real: true,
  // a minor (C. pennsylvanicus HL 1.58-2.56, HW 1.24-2.34 mm, CI 78-91): longer than wide, narrowing a little
  // forward, the back nearly straight; eyes (EL ~ 0.25 HL) set behind the middle of the sides
  head: { len: 0.245, width: 0.205, height: 0.155, shape: "round", notch: 0.02 },
  // (review round 1: "fix eyes" — the smooth black eyes vanished into the black head) the formicine compound eye:
  // a low convex dome, satin grey-black with a faceted grain
  eyes: { size: 0.25, pos: 0.42, height: 0.24, ocelli: false },
  // long scapes (SI 100-118: they pass the back of the head by half their length), no club
  antenna: { segments: 12, scape: 1.12, funiculus: 1.35, club: 0, thick: 0.0112, smooth: true },
  // (review round 1) larger, as a Camponotus' closed jaws show below the clypeus
  mandible: { type: "triangular", len: 0.52, teeth: 5, width: 0.72, spec: SAIY_WORKER_JAW, open: 0.7 },
  // one smooth, even arch (WL ~ 1.45 HL), the pronotum sloping into the neck
  meso: { len: 0.355, width: 0.125, height: 0.14, smooth: true, neck: 0.2 },
  waist: { nodes: 1, len: 0.05, scale: true, nodeH: 0.13 },
  gaster: { len: 0.36, width: 0.235, height: 0.2, sting: false },
  // leggy (fore femur ~ 0.95 HL)
  legs: { hind: 1.18, thick: 0.0135 },
  look: SAIY_LOOK, hair: 0.3, setae: SAIY_SETAE, stance: 0.16,
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
  // a Camponotus major (HL 2.62-3.16, HW 2.68-3.34 mm, CI 102-106): a broad head, wider than long, the sides convex
  // and narrowing forward, the back concave; heavier five-toothed jaws; sturdier, relatively shorter legs
  head: { len: 0.26, width: 0.27, height: 0.19, shape: "heart", notch: 0.07 },
  eyes: { size: 0.22, pos: 0.4, height: 0.22, ocelli: false },
  antenna: { ...SAIY_WORKER.antenna, scape: 0.93, funiculus: 1.3 },
  mandible: { type: "triangular", len: 0.48, teeth: 5, width: 0.78, spec: SAIY_SOLDIER_JAW, open: 0.6 },
  meso: { len: 0.34, width: 0.135, height: 0.15, smooth: true, neck: 0.2 },
  gaster: { len: 0.35, width: 0.24, height: 0.2, sting: false },
  legs: { hind: 1.08, thick: 0.0165 },
  look: { ...SAIY_LOOK, head: L(0x0b0a0e, 0.4, 0.34, 0.05, 0x1a1d2c) },
  hair6: { ...SAIY_WORKER.hair6, wMul: 1.15, lenMul: 1.05, strands: 7, twist: 0.45, cap: { at: [-0.15, 0.3], r: [0.44, 0.16, 0.38] } },
};
const SAIY_QUEEN = {
  ...SAIY_WORKER, key: "saiy_queen", L: 14,
  // a dealate Camponotus queen (HL 3.10-3.52, HW 3.38-3.80, WL ~ 5.7 mm): a broad head with large eyes and three
  // ocelli, the big mesosoma with its scutum, scutellum and wing scars, a large gaster
  head: { len: 0.2, width: 0.215, height: 0.15, shape: "round", notch: 0.03 },
  eyes: { size: 0.26, pos: 0.45, height: 0.24, ocelli: true },
  antenna: { ...SAIY_WORKER.antenna, scape: 0.87, funiculus: 1.3 },
  mandible: { type: "triangular", len: 0.42, teeth: 5, width: 0.66, spec: SAIY_QUEEN_JAW, open: 0.6 },
  meso: { len: 0.35, width: 0.185, height: 0.2, queen: true },
  waist: { nodes: 1, len: 0.04, scale: true, nodeH: 0.11 },
  gaster: { len: 0.43, width: 0.3, height: 0.25, sting: false },
  legs: { hind: 0.88, thick: 0.0128 },
  look: { ...SAIY_LOOK, meso: L(0x0e0d12, 0.34, 0.45, 0.2, 0x1e2032), gaster: L(0x0a090d, 0.26, 0.6, 0.3, 0x2a2426) },
  wingScars: true, stance: 0.14,
  // queen: spikes 1-3 x1.5 length, 4-6 unchanged
  hair6: { ...SAIY_WORKER.hair6, queen: true, strands: 8, rough: 0.36, curl: 0.09, spikes: SAIY_WORKER.hair6.spikes.map((s, k) => k < 3 ? { ...s, lenMul: 1.5 } : s) },
};
// The Blaster (user spec 2026-11-07, claude/saiy-ants/09-spec-saiy-blaster.md; CHANGE_PLAN §31): a fictional ranged caste
// built on the worker — slimmer and a little longer and lighter, a larger, rounder head with the jaws set wide round a
// broad mouth (the energy orbs glow there, between the opened jaws, not from any new opening: `mouth`, surface flag
// 9.5), the same six locks swept back further (lower and longer). Original design, like the hair.
const SAIY_BLASTER = {
  ...SAIY_WORKER, key: "saiy_blaster", L: 6.6,
  head: { len: 0.27, width: 0.25, height: 0.19, shape: "round", notch: 0.0 },
  eyes: { ...SAIY_WORKER.eyes, size: 0.23, pos: 0.42 },
  // the jaws set wider apart and a little shorter, so the mouth between them shows
  mandible: { ...SAIY_WORKER.mandible, len: 0.46, width: 0.86, open: 0.75 },
  // the glowing mouth: head-local (x in head lengths from the back, y in head heights from the centre line, half sizes
  // in head length / height / width)
  mouth: { at: [0.955, -0.2], r: [0.075, 0.1, 0.16] },
  meso: { ...SAIY_WORKER.meso, len: 0.37, width: 0.108, height: 0.124 },
  gaster: { len: 0.33, width: 0.2, height: 0.172, sting: false },
  legs: { hind: 1.24, thick: 0.0122 },
  hair6: { ...SAIY_WORKER.hair6, lenMul: 1.18, curl: 0.02, sag: 0.08, spikes: SAIY_WORKER.hair6.spikes.map((s) => ({ ...s, pitch: Math.max(-4, s.pitch * 0.35 - 2), yaw: s.yaw * 0.65 })) },
};
export const SAIY_MORPHS = { saiy_worker: SAIY_WORKER, saiy_soldier: SAIY_SOLDIER, saiy_queen: SAIY_QUEEN, saiy_blaster: SAIY_BLASTER };
// ===== END SAIY-ANT MORPHS =====

