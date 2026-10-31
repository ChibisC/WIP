/**
 * Unit heights from the models (combat v2.2, CHANGE_PLAN §20, user spec claude/combat/04-spec-height-and-underpass.md):
 * every ant, termite and creature model is built in its rest pose, standing on flat ground, and measured —
 *  - `h`: the highest point of the body (head, mesosoma or thorax, waist, gaster or abdomen, mandibles; not legs,
 *    antennae or thin hairs and spines);
 *  - `c`: the clearance under the rear, middle and front zone: the lowest point of the body over each zone (the gaster
 *    or abdomen; the mesosoma or thorax between the legs; the head and mandibles). Zones meet at the waist and the neck
 *    (ants), the abdomen–thorax and thorax–head joints (termites), or the body's thirds (creatures);
 *  - `hw`: the body's half-width; `feet`: where the feet stand (x, z pairs).
 * Everything is a fraction of the unit's length, x forward from the middle of the unit (the sim position), so a
 * unit's numbers scale with its caste or kind length. tools/height-data.ts writes them to src/sim/heightData.ts;
 * tests/underpass.ts checks the file still matches the builders.
 */
import * as THREE from 'three';
import { MORPHS } from '../src/render/ants/morphs';
import { buildAnt, PART } from '../src/render/ants/antGeometry';
import { buildTermiteGeometry } from '../src/render/termite/build';
import { Bone } from '../src/render/termite/rig';
import * as Prims from '../src/render/creatures/primitives';
import { PrimitiveBatch } from '../src/render/creatures/primitives';
import { Rig, ClimbRec } from '../src/render/creatures/rig';
import { BUILDERS, CHAINS, CrPose } from '../src/render/creatures/builders';
import { CREATURES } from '../src/sim/creatures/kinds';
import { CASTES } from '../src/sim/species';
import type { HeightDef } from '../src/sim/heightData';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Zones and extremes from body points (x, y, z already as fractions of the length, x from the middle). */
function measure(pts: Array<[number, number, number]>, zx: [number, number], feet: number[]): HeightDef {
  let h = 0;
  let hw = 0;
  const c: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const [x, y, z] of pts) {
    h = Math.max(h, y);
    hw = Math.max(hw, Math.abs(z));
    const k = x < zx[0] ? 0 : x < zx[1] ? 1 : 2;
    c[k] = Math.min(c[k], y);
  }
  // a zone with no body over it (only legs): open up to the body's top
  for (let k = 0; k < 3; k++) if (!Number.isFinite(c[k])) c[k] = h;
  return { h: r4(h), zx: [r4(zx[0]), r4(zx[1])], c: [r4(Math.max(0, c[0])), r4(Math.max(0, c[1])), r4(Math.max(0, c[2]))], hw: r4(hw), feet: feet.map(r4) };
}

// ---------------------------------------------------------------- ants (procedural builder, render/ants)
export function antHeights(morph: string): HeightDef {
  const { geometry: g, rig } = buildAnt(MORPHS[morph], 1, 1);
  const L = rig.length;
  const pos = g.getAttribute('position').array as ArrayLike<number>;
  const part = g.getAttribute('aPart').array as ArrayLike<number>;
  const body = new Set<number>([PART.BODY, PART.HEAD, PART.MAND_L, PART.MAND_R, PART.WAIST, PART.GASTER]);
  const pts: Array<[number, number, number]> = [];
  // the tarsus tips: per leg, its tarsus vertex farthest from the ankle
  const tip: Array<[number, number, number]> = [];
  for (let li = 0; li < 6; li++) tip.push([0, 0, -1]);
  for (let i = 0; i < part.length; i++) {
    const p = part[i];
    const x = pos[i * 3] / L;
    const y = pos[i * 3 + 1] / L;
    const z = pos[i * 3 + 2] / L;
    if (body.has(p)) pts.push([x, y, z]);
    else if (p >= PART.LEG0 && p < PART.LEG0 + 18 && (p - PART.LEG0) % 3 === 2) {
      const li = Math.floor((p - PART.LEG0) / 3);
      const a = rig.ankle[li];
      if (!a) continue;
      const d = Math.hypot(x - a.x / L, z - a.z / L);
      if (d > tip[li][2]) tip[li] = [x, z, d];
    }
  }
  const feet: number[] = [];
  for (const t of tip) feet.push(t[0], t[1]);
  return measure(pts, [rig.waistPivot.x / L, rig.neck.x / L], feet);
}

// ---------------------------------------------------------------- termites (render/termite)
export function termiteHeights(morph: string): HeightDef {
  const id = morph.replace(/^termite_/, '');
  const g = buildTermiteGeometry((id === 'termite' ? 'worker' : id) as never, 1);
  const pos = g.getAttribute('position').array as ArrayLike<number>;
  const rig = g.getAttribute('aRig').array as ArrayLike<number>;
  const n = pos.length / 3;
  // body extent and the part ranges along x
  let x0 = Infinity;
  let x1 = -Infinity;
  const range = new Map<number, [number, number]>();
  for (let i = 0; i < n; i++) {
    const b = Math.round(rig[i * 4]);
    if (b !== Bone.BODY && b !== Bone.HEAD && b !== Bone.ABDOMEN && b !== Bone.MAND_L && b !== Bone.MAND_R) continue;
    const x = pos[i * 3];
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    const r = range.get(b) ?? [Infinity, -Infinity];
    range.set(b, [Math.min(r[0], x), Math.max(r[1], x)]);
  }
  const L = x1 - x0;
  const mid = (x0 + x1) / 2;
  const th = range.get(Bone.BODY)!;
  const ab = range.get(Bone.ABDOMEN)!;
  const hd = range.get(Bone.HEAD)!;
  const zx: [number, number] = [((ab[1] + th[0]) / 2 - mid) / L, ((th[1] + hd[0]) / 2 - mid) / L];
  const pts: Array<[number, number, number]> = [];
  const tip: Array<[number, number, number]> = [];
  for (let l = 0; l < 6; l++) tip.push([0, 0, -1]);
  for (let i = 0; i < n; i++) {
    const b = Math.round(rig[i * 4]);
    const x = (pos[i * 3] - mid) / L;
    const y = pos[i * 3 + 1] / L;
    const z = pos[i * 3 + 2] / L;
    if (b === Bone.BODY || b === Bone.HEAD || b === Bone.ABDOMEN || b === Bone.MAND_L || b === Bone.MAND_R) pts.push([x, y, z]);
    else if (b >= Bone.LEG0 && b < Bone.LEG0 + 24 && (b - Bone.LEG0) % 4 === 3) {
      // the tarsus: its lowest, outermost point
      const l = Math.floor((b - Bone.LEG0) / 4);
      const d = Math.abs(z) - y * 4;
      if (d > tip[l][2]) tip[l] = [x, z, d];
    }
  }
  const feet: number[] = [];
  for (const t of tip) feet.push(t[0], t[1]);
  return measure(pts, zx, feet);
}

// ---------------------------------------------------------------- creatures (render/creatures primitives)
function restPose(kind: string, L: number): CrPose {
  const chain = CHAINS.has(kind);
  return {
    L, x: 0, z: 0, h: 0, hx: chain ? L * 0.5 : 0, hz: 0, phase: 0, amp: 0, t: 0, state: 0, st: 0, dead: false, deadT: 0, eaten: 0, v2: 0, hurt: 0, data: {},
    trail: new Float32Array(0), trailN: 0, trailStep: L / 30, ground: () => 0,
  } as unknown as CrPose;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** Distance from point p to segment a–b (3D). */
function segDist(p: THREE.Vector3, a: number[], b: number[]): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz || 1e-12;
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * abx + (p.y - a[1]) * aby + (p.z - a[2]) * abz) / l2));
  return Math.hypot(p.x - a[0] - abx * t, p.y - a[1] - aby * t, p.z - a[2] - abz * t);
}

export function creatureHeights(kind: string): HeightDef {
  const k = CREATURES[kind];
  const L = k.length;
  const batch = new PrimitiveBatch();
  const prims: Array<{ prim: string; m: THREE.Matrix4 }> = [];
  const add = batch.add.bind(batch);
  (batch as unknown as { add: (...a: unknown[]) => void }).add = (prim: unknown, m: unknown, c: unknown, s: unknown) => {
    prims.push({ prim: prim as string, m: (m as THREE.Matrix4).clone() });
    (add as (...a: unknown[]) => void)(prim, m, c, s);
  };
  // sculpted parts (feature/realism: Rig.part → PrimitiveBatch.addPart, a registered mesh per part): recorded too
  const parts: Array<{ name: string; m: THREE.Matrix4 }> = [];
  const ab = batch as unknown as { addPart?: (...a: unknown[]) => void };
  if (ab.addPart) {
    const addP = ab.addPart.bind(batch);
    ab.addPart = (name: unknown, m: unknown, c: unknown, s: unknown) => {
      parts.push({ name: name as string, m: (m as THREE.Matrix4).clone() });
      addP(name, m, c, s);
    };
  }
  const rig = new Rig(batch);
  const rec: ClimbRec = { legs: new Map(), frames: new Map(), frame: 0 };
  rig.rec = rec;
  BUILDERS[kind](rig, restPose(kind, L));
  const legs = [...rec.legs.values()].map((a) => [[a[0], a[1], a[2]], [a[3], a[4], a[5]], [a[6], a[7], a[8]], [a[9], a[10], a[11]]]);
  const pts: Array<[number, number, number]> = [];
  for (const { prim, m } of prims) {
    m.decompose(_p, _q, _s);
    const e = m.elements;
    // half-extents of the unit shape along world x, y, z (rows of the linear part)
    const ex = Math.hypot(e[0], e[4], e[8]);
    const ey = Math.hypot(e[1], e[5], e[9]);
    const ez = Math.hypot(e[2], e[6], e[10]);
    const thin = Math.min(_s.x, _s.z) < L * 0.012 || (prim === 'ell' && Math.min(_s.x, _s.y, _s.z) < L * 0.012);
    if (thin) continue; // antennae, hairs, spines, claws
    let c = _p.clone();
    if (prim !== 'ell') c = new THREE.Vector3(0, 0.5, 0).applyMatrix4(m); // a tube's or cone's middle
    // a leg part: near a recorded leg chain
    const r = Math.min(_s.x, _s.z, prim === 'ell' ? _s.y : Infinity);
    let leg = false;
    for (const ch of legs) for (let j = 0; j < 3 && !leg; j++) if (segDist(c, ch[j], ch[j + 1]) < r * 1.2 + L * 0.01) leg = true;
    if (leg) continue;
    if (prim === 'ell') {
      // its outline along x: the bottom and top at a few points
      for (const t of [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9]) {
        const k2 = Math.sqrt(1 - t * t);
        pts.push([(_p.x + t * ex) / L, (_p.y - ey * k2) / L, (_p.z) / L]);
        pts.push([(_p.x + t * ex) / L, (_p.y + ey * k2) / L, (_p.z + ez * Math.sign(_p.z || 1) * k2) / L]);
      }
    } else {
      const a = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
      const b = new THREE.Vector3(0, 1, 0).applyMatrix4(m);
      const rad = Math.min(_s.x, _s.z);
      for (const t of [0, 0.5, 1]) {
        const q = a.clone().lerp(b, t);
        pts.push([q.x / L, (q.y - rad) / L, q.z / L]);
        pts.push([q.x / L, (q.y + rad) / L, (q.z + rad * Math.sign(q.z || 1)) / L]);
      }
    }
  }
  // sculpted parts: every vertex of the body's (legs, antennae and their segments left out by name)
  const partGeometry = (Prims as unknown as { partGeometry?: (n: string) => THREE.BufferGeometry }).partGeometry;
  const v = new THREE.Vector3();
  for (const { name, m } of parts) {
    if (!partGeometry || /coxa|femur|tibia|tars|leg|scape|funic|club|antenn|claw|spur|hair|seta/i.test(name)) continue;
    const pos = partGeometry(name).getAttribute('position').array as ArrayLike<number>;
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m);
      pts.push([v.x / L, v.y / L, v.z / L]);
    }
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
  }
  const span = x1 - x0 || 1;
  const feet: number[] = [];
  for (const ch of legs) feet.push(ch[3][0] / L, ch[3][2] / L);
  return measure(pts, [x0 + span / 3, x0 + (span * 2) / 3], feet);
}

/** Every unit's heights: ants and termites by model (morph) key, creatures by kind. */
export function allHeights(): { ant: Record<string, HeightDef>; creature: Record<string, HeightDef> } {
  const ant: Record<string, HeightDef> = {};
  for (const c of Object.values(CASTES)) {
    const m = c.morph;
    if (!m || ant[m]) continue;
    if (MORPHS[m as keyof typeof MORPHS]) ant[m] = antHeights(m);
    else if (c.termite) ant[m] = termiteHeights(m);
  }
  const creature: Record<string, HeightDef> = {};
  for (const kind of Object.keys(BUILDERS)) if (CREATURES[kind]) creature[kind] = creatureHeights(kind);
  return { ant, creature };
}
