/**
 * Parametric termite geometry builder (one base for every caste).
 *
 * buildTermiteGeometry(casteId, lod) -> THREE.BufferGeometry with attributes
 *   position, normal, color (linear RGB), aRig = (bone, bone param, material class, caste row)
 * and geometry.userData.rig : TermiteRig (pivots + the caste's row of the shared rig texture).
 *
 * Construction (per the reference-photo brief):
 *   head    one smooth lathe: bulb + nasus for soldiers (teardrop; straight sharply pointed cone,
 *           top line sloping down to the tip, slightly concave underside), rounded capsule otherwise
 *   thorax  one loft with three narrow plates (saddle pronotum with raised anterior lobe, meso, meta),
 *           joined broadly to head and abdomen (NO waist, no beads)
 *   abdomen one segmented loft: 10 tergites with serrated rear margins
 *   legs    one continuous swept tube per leg (coxa, femur, tibia, tarsus) + tibial spurs and claws
 *   antennae one swept tube with moniliform bead bulges (straight, never elbowed)
 *   setae   long pale bristles on the soldier head and the rear edge of each tergite (LOD0 only)
 *   queen   (v2.1) one continuous pleated physogastric abdomen on a custom grid (QUEEN_ABD in rig.ts)
 * Triangle budgets: LOD0 < 5000, LOD1 < 1200, LOD2 < 300; queens (a few per match) LOD0 < 12000.
 */
import { BufferGeometry, Color, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import {
  CASTES,
  CASTE_ROW,
  CasteId,
  CasteParams,
  EGG_COLOR,
  EYE_COLOR,
  LEAF_COLORS,
  OCELLUS_COLOR,
  WOOD_COLOR,
} from './castes';
import { Bone, GAIT_DUTY, HEAD_REST_PITCH, Mat, QUEEN_ABD, RigCol, TermiteRig, legBone, legSide } from './rig';

// ---------------------------------------------------------------------------
// mesh assembly
// ---------------------------------------------------------------------------

interface VertexAttrs {
  bone: number[];
  col: Color[];
  bt: number[];
}
// sq (v2.2): superellipse exponent of the cross-section (2 = ellipse; larger = boxier, flat top and bottom)
type Sample = { p: Vector3; rN: number; rB?: number; bone: number; col: Color; bt: number; sq?: number };

class MeshAccumulator {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  bone: number[] = [];
  bt: number[] = [];
  mat: number[] = [];
  idx: number[] = [];
  parts: [number, number][] = [];

  /** append an indexed piece (local positions lp, indices li, per-vertex attrs), transformed by m */
  piece(lp: number[], li: number[], va: VertexAttrs, mat: number, m?: Matrix4) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(lp, 3));
    g.setIndex(li);
    g.computeVertexNormals();
    if (m) g.applyMatrix4(m);
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const base = this.pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i));
      this.nor.push(N.getX(i), N.getY(i), N.getZ(i));
      const c = va.col[i];
      this.col.push(c.r, c.g, c.b);
      this.bone.push(va.bone[i]);
      this.bt.push(va.bt[i]);
      this.mat.push(mat);
    }
    this.parts.push([this.idx.length, li.length]);
    for (const i of li) this.idx.push(base + i);
    g.dispose();
  }

  /**
   * Swept tube through samples (parallel-transport frames). Each sample sets its own bone,
   * colour, aBT and two radii (rN along the frame normal ~ "up hint", rB along the binormal).
   */
  sweep(S: Sample[], radial: number, mat: number, capStart = true, capEnd = true, upHint = new Vector3(0, 1, 0)) {
    const n = S.length;
    const lp: number[] = [];
    const li: number[] = [];
    const va: VertexAttrs = { bone: [], col: [], bt: [] };
    const T: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = S[Math.max(0, i - 1)].p;
      const b = S[Math.min(n - 1, i + 1)].p;
      T.push(new Vector3().subVectors(b, a).normalize());
    }
    let N = upHint.clone().addScaledVector(T[0], -T[0].dot(upHint));
    if (N.lengthSq() < 1e-8) N = new Vector3(1, 0, 0).addScaledVector(T[0], -T[0].x);
    N.normalize();
    const push = (v: Vector3, s: Sample) => {
      lp.push(v.x, v.y, v.z);
      va.bone.push(s.bone);
      va.col.push(s.col);
      va.bt.push(s.bt);
    };
    for (let i = 0; i < n; i++) {
      if (i > 0) N.addScaledVector(T[i], -T[i].dot(N)).normalize();
      const B = new Vector3().crossVectors(T[i], N);
      const s = S[i];
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        let ca = Math.cos(a);
        let sa = Math.sin(a);
        if (s.sq !== undefined && s.sq !== 2) {
          ca = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / s.sq);
          sa = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / s.sq);
        }
        push(s.p.clone().addScaledVector(N, ca * s.rN).addScaledVector(B, sa * (s.rB ?? s.rN)), s);
      }
    }
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j;
        const b = i * radial + ((j + 1) % radial);
        const c = (i + 1) * radial + j;
        const d = (i + 1) * radial + ((j + 1) % radial);
        li.push(a, b, c, b, d, c);
      }
    if (capStart) {
      const s = S[0];
      const p = lp.length / 3;
      push(s.p.clone().addScaledVector(T[0], -Math.min(s.rN, s.rB ?? s.rN) * 0.6), s);
      for (let j = 0; j < radial; j++) li.push(p, (j + 1) % radial, j);
    }
    if (capEnd) {
      const s = S[n - 1];
      const p = lp.length / 3;
      push(s.p.clone().addScaledVector(T[n - 1], Math.min(s.rN, s.rB ?? s.rN) * 0.6), s);
      const o0 = (n - 1) * radial;
      for (let j = 0; j < radial; j++) li.push(p, o0 + j, o0 + ((j + 1) % radial));
    }
    this.piece(lp, li, va, mat);
  }

  /** lathe along +X: rings with centre (x, cy, cz), vertical radius ry and lateral radius rz */
  lathe(R: { x: number; cy: number; ry: number; rz: number; col: Color; bt: number; cz?: number; sq?: number }[], radial: number, bone: number, mat: number, capStart = true, capEnd = true) {
    this.sweep(
      R.map((r) => ({ p: new Vector3(r.x, r.cy, r.cz ?? 0), rN: r.ry, rB: r.rz, bone, col: r.col, bt: r.bt, sq: r.sq })),
      radial,
      mat,
      capStart,
      capEnd,
    );
  }

  ellipsoid(r: Vector3, wSeg: number, hSeg: number, bone: number, mat: number, col: Color, m: Matrix4, bt = 0) {
    const lp: number[] = [];
    const li: number[] = [];
    const va: VertexAttrs = { bone: [], col: [], bt: [] };
    const push = (x: number, y: number, z: number) => {
      lp.push(x, y, z);
      va.bone.push(bone);
      va.col.push(col);
      va.bt.push(bt);
    };
    for (let i = 1; i < hSeg; i++) {
      const th = (i / hSeg) * Math.PI;
      const x = -Math.cos(th) * r.x;
      const s = Math.sin(th);
      for (let j = 0; j < wSeg; j++) {
        const a = (j / wSeg) * Math.PI * 2;
        push(x, s * r.y * Math.cos(a), s * r.z * Math.sin(a));
      }
    }
    const nr = hSeg - 1;
    for (let i = 0; i < nr - 1; i++)
      for (let j = 0; j < wSeg; j++) {
        const a = i * wSeg + j;
        const b = i * wSeg + ((j + 1) % wSeg);
        const c = (i + 1) * wSeg + j;
        const d = (i + 1) * wSeg + ((j + 1) % wSeg);
        li.push(a, b, c, b, d, c);
      }
    const p0 = lp.length / 3;
    push(-r.x, 0, 0);
    for (let j = 0; j < wSeg; j++) li.push(p0, (j + 1) % wSeg, j);
    const p1 = lp.length / 3;
    push(r.x, 0, 0);
    const o0 = (nr - 1) * wSeg;
    for (let j = 0; j < wSeg; j++) li.push(p1, o0 + j, o0 + ((j + 1) % wSeg));
    this.piece(lp, li, va, mat, m);
  }

  /** thin tapered bristle (2-ring cone, no caps) */
  hair(base: Vector3, dir: Vector3, len: number, r: number, bone: number, col: Color, bt = 0) {
    this.sweep(
      [
        { p: base, rN: r, bone, col, bt },
        { p: base.clone().addScaledVector(dir, len), rN: r * 0.12, bone, col, bt },
      ],
      3,
      Mat.SETA,
      false,
      false,
    );
  }

  toGeometry(casteRow: number): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    // packed per-vertex rig data (one attribute slot): bone id, bone param (aBT), material class, caste row
    const rigv = new Float32Array(this.bone.length * 4);
    for (let i = 0; i < this.bone.length; i++) rigv.set([this.bone[i], this.bt[i], this.mat[i], casteRow], i * 4);
    g.setAttribute('aRig', new Float32BufferAttribute(rigv, 4));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.parts = this.parts;
    return g;
  }
}

const C = (hex: string) => new Color(hex);
const mixC = (a: Color, b: Color, t: number) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const trs = (p: Vector3, e?: [number, number, number]) =>
  new Matrix4().compose(p, e ? new Quaternion().setFromEuler(new Euler(e[0], e[1], e[2])) : new Quaternion(), new Vector3(1, 1, 1));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** smoothstep interpolation through control points [(x, ...values)] */
function curve(points: number[][], x: number, k: number): number {
  if (x <= points[0][0]) return points[0][k];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (x <= b[0]) {
      const t = (x - a[0]) / (b[0] - a[0]);
      return a[k] + (b[k] - a[k]) * (t * t * (3 - 2 * t));
    }
  }
  return points[points.length - 1][k];
}

// ---------------------------------------------------------------------------
// LOD settings
// ---------------------------------------------------------------------------
interface LodCfg {
  headRadial: number;
  headRings: number;
  bodyRadial: number;
  thoraxRings: number;
  abdRingsPerSeg: number;
  legRadial: number;
  legDetail: 0 | 1 | 2;
  antRadial: number;
  antDetail: 0 | 1 | 2;
  setae: boolean;
  spursClaws: boolean;
  ocelli: boolean;
  smallSeg: [number, number];
}
const LODS: LodCfg[] = [
  { headRadial: 16, headRings: 26, bodyRadial: 14, thoraxRings: 14, abdRingsPerSeg: 3, legRadial: 6, legDetail: 0, antRadial: 6, antDetail: 0, setae: true, spursClaws: true, ocelli: true, smallSeg: [8, 5] },
  { headRadial: 8, headRings: 12, bodyRadial: 8, thoraxRings: 6, abdRingsPerSeg: 1, legRadial: 4, legDetail: 1, antRadial: 4, antDetail: 1, setae: false, spursClaws: false, ocelli: true, smallSeg: [6, 3] },
  { headRadial: 6, headRings: 5, bodyRadial: 6, thoraxRings: 3, abdRingsPerSeg: 0, legRadial: 3, legDetail: 2, antRadial: 3, antDetail: 2, setae: false, spursClaws: false, ocelli: false, smallSeg: [5, 3] },
];

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

export function buildTermiteGeometry(casteId: CasteId, lod = 0): BufferGeometry {
  const Lc = LODS[Math.max(0, Math.min(2, lod))];
  const P: CasteParams = CASTES[casteId];
  const isQueen = !!P.physogastric;
  const isLarva = casteId === 'larva' || casteId === 'rhy_larva';
  const pal = P.colors;
  const acc = new MeshAccumulator();
  const pivots = new Float32Array(Bone.COUNT * 3);
  const setPivot = (b: number, v: Vector3) => pivots.set([v.x, v.y, v.z], b * 3);
  // queens: hard dark head, thorax, legs and antennae like the king (only the abdomen is soft membrane)
  const hard = P.headShape === 'pear' || P.headShape === 'globe' || P.translucency < 0.3 || isQueen;
  const bodyMat = P.translucency < 0.3 || isQueen ? Mat.HARD : Mat.SOFT;
  const up = new Vector3(0, 1, 0);
  const down = new Vector3(0, -1, 0);

  // ---- lengths (normalised so that the total equals bodyLength) ----
  const L = P.bodyLength;
  const ovH = 0.14; // head back overlaps the pronotum (fraction of head capsule)
  const ovA = 0.08; // abdomen front overlaps the metanotum (fraction of thorax)
  const raw = P.prop.head + P.prop.nasus + P.prop.thorax * (1 - ovA) + P.prop.abdomen - P.prop.head * ovH;
  const k = 1 / raw;
  const Hc = P.prop.head * L * k;
  const Nn = P.prop.nasus * L * k;
  const T = P.prop.thorax * L * k;
  const A = isQueen ? P.physogastric!.length : P.prop.abdomen * L * k;
  const Hw = P.width.head * L;
  const Tw = P.width.thorax * L;
  const Aw = isQueen ? P.physogastric!.width : P.width.abdomen * L;
  const Hh = Hw * P.height.head;
  const Th = Tw * P.height.thorax;
  const Ah = isQueen ? P.physogastric!.height : Aw * P.height.abdomen;
  const sc = L / 5; // detail scale relative to a 5 mm soldier

  // ---- heights ----
  const c = P.clearance;
  const normalAh = P.width.abdomen * L * P.height.abdomen;
  const yA = isQueen ? Ah / 2 + 0.02 : c + Ah / 2;
  const yT = isQueen ? c + 0.6 * normalAh - 0.08 : yA + 0.1 * Ah; // v2.1: queen thorax at king height (legs splayed)
  const yH = P.headShape === 'pear' ? yT + 0.18 * Hh : P.headShape === 'globe' ? yT + 0.24 * Hh : P.headShape === 'dome' ? yT + 0.1 * Hh : yT + 0.05 * Hh;

  // ---- X layout ----
  const xT0 = -T / 2;
  const xT1 = T / 2;
  // abdomen front overlaps the metanotum: broad join, no waist. v2.1 queen: the front dome sits over the back of
  // the thorax, so the small head and thorax poke out from under it
  const xA0 = isQueen ? xT0 + 0.25 * T : xT0 + ovA * T;
  const xH0 = xT1 - ovH * Hc; // back of head
  const xHb = xH0 + Hc; // end of head capsule / start of nasus
  setPivot(Bone.BODY, new Vector3(0, yT, 0));

  // =========================================================================
  // HEAD
  // =========================================================================
  const neck = new Vector3(xH0 + 0.12 * Hc, yH - 0.05 * Hh, 0);
  setPivot(Bone.HEAD, neck);
  const headC = C(pal.head);
  const headHi = C(pal.headHi);
  const headTip = C(pal.headTip);
  let nasusTip: [number, number, number] | null = null;
  let nasusTipR = 0;
  let hW: (u: number) => number;
  let hTop: (u: number) => number;
  let hBot: (u: number) => number;
  let Ht = Hc;
  let antU: number;
  let antDirOverride: ((sd: number) => Vector3) | null = null;
  let mandTips: [[number, number, number], [number, number, number]] | null = null;
  let mandAxis: [number, number, number] = [0, 1, 0];
  let nasusBaseU = 0;
  let nasusDirOut: [number, number, number] | null = null;

  if (P.headShape === 'pear') {
    Ht = Hc + Nn;
    const uB = Hc / Ht; // bulb / nasus boundary
    const W2 = Hw / 2;
    const wn = W2 * P.nasus!.baseFrac;
    const rt = P.nasus!.tipRadius * sc;
    nasusTipR = rt;
    const uc = 0.46 * uB; // widest point (top view)
    const ucr = 0.4 * uB; // crown (side view)
    const ulo = 0.46 * uB; // lowest point of the bulb
    const crown = yH + Hh / 2;
    const bottom = yH - Hh / 2;
    const tipY = yH - 0.02 * Hh;
    const tipTop = tipY + rt;
    const tipBot = tipY - rt;
    const topLine = (u: number) => crown + (tipTop - crown) * Math.pow((u - ucr) / (1 - ucr), 1.0);
    const nbTop = topLine(uB);
    const nbBot = nbTop - 2.1 * wn;
    // cubic Hermite between (x0,y0,slope m0) and (x1,y1,slope m1): keeps the bulb -> nasus join smooth
    const herm = (x: number, x0: number, y0: number, m0: number, x1: number, y1: number, m1: number) => {
      const h = x1 - x0;
      const t = (x - x0) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
    };
    const coneSlopeW = (rt - wn) / (1 - uB);
    hW = (u: number) => {
      if (u <= uc) return W2 * Math.sqrt(Math.max(0, 1 - ((uc - u) / uc) ** 2));
      if (u <= uB) return herm(u, uc, W2, 0, uB, wn, coneSlopeW * 1.15);
      return wn + (rt - wn) * Math.pow((u - uB) / (1 - uB), 0.92);
    };
    hTop = (u: number) => (u <= ucr ? yH + (Hh / 2) * Math.sqrt(Math.max(0, 1 - ((ucr - u) / ucr) ** 2)) : topLine(u));
    const coneSlopeB = (tipBot - nbBot) / (1 - uB);
    hBot = (u: number) => {
      if (u <= ulo) return yH - (Hh / 2) * Math.sqrt(Math.max(0, 1 - ((ulo - u) / ulo) ** 2));
      if (u <= uB) return herm(u, ulo, bottom, 0, uB, nbBot, coneSlopeB * 1.2);
      return nbBot + (tipBot - nbBot) * ((u - uB) / (1 - uB));
    };
    let us: number[];
    if (lod === 2) us = [0.05, ucr, uB * 0.72, uB, 0.985];
    else {
      us = [];
      const n = Lc.headRings;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        us.push(0.012 + 0.976 * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)));
      }
    }
    const rings = us.map((u) => {
      const top = hTop(u);
      const bot = hBot(u);
      const tn = u > uB ? (u - uB) / (1 - uB) : 0;
      let col = mixC(headC, headHi, 0.1 + smooth(uB * 0.55, uB * 1.05, u) * 0.45);
      col = mixC(col, headTip, smooth(0.45, 1.0, tn));
      return { x: xH0 + u * Ht, cy: (top + bot) / 2, ry: Math.max((top - bot) / 2, rt * 0.6), rz: Math.max(hW(u), rt * 0.6), col, bt: tn };
    });
    acc.lathe(rings, Lc.headRadial, Bone.HEAD, Mat.NASUS, true, true);
    nasusTip = [xH0 + Ht + rt * 0.3, tipY, 0];
    antU = uB * 0.86;

    // vestigial mandible nubs under the nasus base
    for (const sd of [-1, 1]) {
      const bone = sd < 0 ? Bone.MAND_L : Bone.MAND_R;
      const u = uB * 0.9;
      const b = new Vector3(xH0 + u * Ht, hBot(u) + 0.04 * Hh, sd * hW(u) * 0.45);
      const tip = b.clone().add(new Vector3(0.07 * sc * P.mandibles.scale, -0.03 * sc, -sd * 0.02 * sc));
      acc.sweep(
        [
          { p: b, rN: 0.03 * sc * P.mandibles.scale, bone, col: C(pal.mandible), bt: 0 },
          { p: tip, rN: 0.006 * sc, bone, col: C(pal.mandibleTip), bt: 0 },
        ],
        4,
        Mat.MANDIBLE,
        false,
        true,
      );
      setPivot(bone, b);
    }

    // long thin pale bristles standing up from the top and sides of the head (6 in N. corniger)
    if (Lc.setae && P.setae.head > 0) {
      const spots: [number, number, number][] = [
        [0.22, 0.45, 0.2],
        [0.5, 1.0, 0.24],
        [0.78, 0.4, 0.17],
      ];
      const hair = C(pal.hair);
      for (let i = 0; i < Math.min(3, Math.ceil(P.setae.head / 2)); i++)
        for (const sd of [-1, 1]) {
          const [uf, ang, len] = spots[i];
          const u = uf * uB;
          const a = sd * ang;
          const cy = (hTop(u) + hBot(u)) / 2;
          const ry = (hTop(u) - hBot(u)) / 2;
          const base = new Vector3(xH0 + u * Ht, cy + ry * Math.cos(a) * 0.97, hW(u) * Math.sin(a) * 0.97);
          const nrm = new Vector3(0, Math.cos(a) / ry, Math.sin(a) / hW(u)).normalize();
          const dir = nrm.multiplyScalar(0.9).add(new Vector3(-0.35, 0.15, 0)).normalize();
          acc.hair(base, dir, len * sc, 0.007 * sc, Bone.HEAD, hair);
        }
    }
  } else if (P.headShape === 'globe') {
    // ---- v2: Rhynchotermes soldier. Domed glossy capsule + long slender frontal tube from its front-top,
    // concave dorsal profile, tube curving slightly down to an open tip; long crossed sickle mandibles. ----
    Ht = Hc + Nn;
    const uB = Hc / Ht; // capsule / tube boundary
    nasusBaseU = uB;
    const W2 = Hw / 2;
    const nz = P.nasus!;
    const wn = W2 * nz.baseFrac; // half-width of the broad tube base
    const rt = nz.tubeRadius ?? 0.06; // slender tube radius (mm)
    const rtip = nz.tipRadius;
    nasusTipR = rtip;
    const droop = nz.droop ?? 0;
    const yNb = yH + ((nz.rise ?? 0.3) * Hh) / 2; // tube centreline at its base (front-top of the capsule)
    const tt = (u: number) => clamp01((u - uB) / (1 - uB));
    const tubeR = (u: number) => rt + (rtip - rt) * Math.pow(tt(u), 1.3);
    const tubeY = (u: number) => yNb - droop * tt(u) * tt(u);
    const lam = 0.32; // flare: broad base tapering into the slender tube (concave cone)
    const flare = (u: number) => 1 / ((1 + Math.max(0, u - uB) / lam) ** 2);
    const tubeW = (u: number) => tubeR(u) + (wn - tubeR(u)) * flare(u);
    const herm = (x: number, x0: number, y0: number, m0: number, x1: number, y1: number, m1: number) => {
      const h = x1 - x0;
      const t = (x - x0) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
    };
    const dU = 1e-4;
    const slope = (fn: (u: number) => number, u: number) => (fn(u + dU) - fn(u)) / dU;
    // top view width: round capsule, then a steep neck into the tube base, then the slender tube
    const uc = 0.47 * uB;
    const mW = slope(tubeW, uB);
    hW = (u: number) => {
      if (u <= uc) return W2 * Math.sqrt(Math.max(0, 1 - ((uc - u) / uc) ** 2));
      if (u <= uB) return herm(u, uc, W2, 0, uB, wn, mW);
      return tubeW(u);
    };
    // side view: dome crown -> concave dip into the tube top; face rises steeply to the tube underside
    const ucr = 0.42 * uB;
    const uJ = uB + 0.1 * (1 - uB);
    const uJb = uB + 0.16 * (1 - uB);
    const tTop = (u: number) => tubeY(u) + tubeW(u) * 0.95;
    const tBot = (u: number) => tubeY(u) - tubeW(u) * 0.95;
    const crown = yH + Hh / 2;
    const bottom = yH - Hh / 2;
    const ulo = 0.5 * uB;
    hTop = (u: number) => {
      if (u <= ucr) return yH + (Hh / 2) * Math.sqrt(Math.max(0, 1 - ((ucr - u) / ucr) ** 2));
      if (u <= uJ) return herm(u, ucr, crown, 0, uJ, tTop(uJ), slope(tTop, uJ));
      return tTop(u);
    };
    hBot = (u: number) => {
      if (u <= ulo) return yH - (Hh / 2) * Math.sqrt(Math.max(0, 1 - ((ulo - u) / ulo) ** 2));
      if (u <= uJb) return herm(u, ulo, bottom, 0, uJb, tBot(uJb), slope(tBot, uJb));
      return tBot(u);
    };
    let us: number[];
    if (lod === 2) us = [0.05, ucr, 0.86 * uB, uB + 0.08 * (1 - uB), 0.996];
    else {
      us = [];
      const nC = lod === 0 ? 14 : 7;
      const nT = lod === 0 ? 14 : 6;
      for (let i = 0; i < nC; i++) {
        const t = i / (nC - 1);
        us.push(0.012 + (uB - 0.012) * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)));
      }
      for (let i = 1; i <= nT; i++) {
        const t = i / nT;
        us.push(uB + (0.996 - uB) * Math.pow(t, 1.6));
      }
    }
    const nasC = C(pal.nasus ?? pal.head);
    const nasB = C(pal.nasusBase ?? pal.head);
    const rings = us.map((u) => {
      const top = hTop(u);
      const bot = hBot(u);
      const tn = tt(u);
      let col = mixC(headC, headHi, 0.15 + 0.45 * smooth(0.25 * uB, uB, u));
      col = mixC(col, nasB, smooth(0.78 * uB, uB + 0.04 * (1 - uB), u) * (1 - smooth(0.05, 0.35, tn)));
      col = mixC(col, nasC, smooth(0.08, 0.6, tn));
      return { x: xH0 + u * Ht, cy: (top + bot) / 2, ry: Math.max((top - bot) / 2, rtip * 0.7), rz: Math.max(hW(u), rtip * 0.7), col, bt: u >= 0.995 ? 0.995 : tn };
    });
    acc.lathe(rings, Lc.headRadial, Bone.HEAD, Mat.NASUS, true, true);
    nasusTip = [xH0 + Ht + rtip * 0.3, tubeY(1), 0];
    {
      const d = new Vector3(Ht * (1 - 0.8), tubeY(1) - tubeY(0.8), 0).normalize();
      nasusDirOut = [d.x, d.y, d.z];
    }
    antU = 0.8 * uB;
    antDirOverride = (sd: number) => new Vector3(1.0, 0.12, sd * 0.62).normalize();

    // labrum: small subrectangular plate under the tube base, between the mandible bases
    if (lod < 2) {
      const ul = 0.95 * uB;
      acc.ellipsoid(new Vector3(0.07 * sc, 0.045 * sc, 0.13 * sc), Lc.smallSeg[0], Lc.smallSeg[1], Bone.HEAD, Mat.HARD, mixC(headHi, headTip, 0.4), trs(new Vector3(xH0 + ul * Ht, hBot(ul) + 0.05 * Hh, 0), [0, 0, -0.5]));
    }

    // ---- sickle mandibles: planar curve in a swing plane tilted down from the head axis ----
    const sk = P.mandibles.sickle!;
    const tilt = sk.tilt;
    const fDir = new Vector3(Math.cos(tilt), -Math.sin(tilt), 0); // down-forward in the swing plane
    const pN = new Vector3(Math.sin(tilt), Math.cos(tilt), 0); // swing-plane normal
    // oblique hinge (LEFT mandible; the shader mirrors z for the right one): +angle swings the blade out AND up
    const hl = sk.hingeLift ?? 0;
    const hinge = pN.clone().multiplyScalar(Math.cos(hl)).add(new Vector3(0, 0, Math.sin(hl))).normalize();
    mandAxis = [hinge.x, hinge.y, hinge.z];
    const um = 0.88 * uB;
    const mcol = C(pal.mandible);
    const mtip = C(pal.mandibleTip);
    const nS = lod === 0 ? 16 : lod === 1 ? 7 : 3;
    const radial = lod === 0 ? 6 : lod === 1 ? 4 : 3;
    const tips: Vector3[] = [];
    for (const sd of [-1, 1]) {
      const bone = sd < 0 ? Bone.MAND_L : Bone.MAND_R;
      const inward = new Vector3(0, 0, -sd);
      const B = new Vector3(xH0 + um * Ht, hBot(um) + 0.16 * Hh, sd * sk.spread * W2);
      setPivot(bone, B);
      // integrate the blade: heading phi(s) = phi0 + curve * (s/L)^1.5 (most curvature toward the tip)
      const N = 160;
      const ds = sk.length / N;
      const path: { p: Vector3; t: Vector3; s: number }[] = [];
      let p = B.clone();
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const ph = -0.25 + sk.curve * Math.pow(s, 1.5);
        const hk = (sk.hook ?? 0) * s * s; // distal blade curls down out of the swing plane (ventral hook)
        const t = fDir.clone().multiplyScalar(Math.cos(ph)).addScaledVector(inward, Math.sin(ph)).multiplyScalar(Math.cos(hk)).addScaledVector(pN, -Math.sin(hk));
        // the left blade passes just above the right one where they cross
        const lift = -sd * 0.022 * sc * smooth(0.45, 0.85, s);
        path.push({ p: p.clone().addScaledVector(pN, lift), t, s });
        p = p.addScaledVector(t, ds);
      }
      const S: Sample[] = [];
      for (let k = 0; k < nS; k++) {
        const s = lod === 2 ? [0, 0.6, 1][k] : Math.pow(k / (nS - 1), 0.85);
        const e = path[Math.round(s * N)];
        const taper = Math.pow(Math.max(0, 1 - s), 0.7);
        const w = Math.max(0.006, (sk.width / 2) * (0.35 + 0.65 * taper) * (s < 0.08 ? 1.15 - s : 1));
        const th = Math.max(0.005, (sk.thickness / 2) * (0.45 + 0.55 * taper));
        S.push({ p: e.p, rN: th, rB: w, bone, col: mixC(mcol, mtip, smooth(0.5, 0.92, s)), bt: s });
      }
      acc.sweep(S, radial, Mat.SICKLE, lod < 2, true, pN);
      tips.push(path[N].p.clone());
      // conical marginal tooth on the inner (concave) edge, angled toward the labrum
      if (lod < 2) {
        const ti = Math.round(sk.tooth * N);
        const e = path[ti];
        const inner = path[ti + 1].t.clone().sub(path[ti - 1].t).normalize(); // toward the centre of curvature
        const dir = inner.multiplyScalar(0.85).addScaledVector(e.t, -0.5).normalize();
        acc.sweep(
          [
            { p: e.p.clone().addScaledVector(dir, -0.01 * sc), rN: 0.032 * sc, bone, col: mixC(mcol, mtip, 0.35), bt: 0.4 },
            { p: e.p.clone().addScaledVector(dir, sk.toothLen), rN: 0.004 * sc, bone, col: mtip, bt: 0.45 },
          ],
          lod === 0 ? 5 : 3,
          Mat.SICKLE,
          false,
          true,
        );
      }
    }
    mandTips = [
      [tips[0].x, tips[0].y, tips[0].z],
      [tips[1].x, tips[1].y, tips[1].z],
    ];

    // two long apical bristles on the head (LOD0)
    if (Lc.setae && P.setae.head > 0) {
      const hair = C(pal.hair);
      for (const sd of [-1, 1]) {
        const u = 0.93 * uB;
        const base = new Vector3(xH0 + u * Ht, hTop(u) - 0.01, sd * 0.25 * hW(u));
        acc.hair(base, new Vector3(0.55, 0.8, sd * 0.25).normalize(), 0.3 * sc, 0.008 * sc, Bone.HEAD, hair);
      }
    }
  } else {
    // ---- rounded capsule (workers, royals, larvae) ----
    // v2.2 worker heads: 'dome' = high rounded dome (nasute worker); 'flat' = broad, flattened top to bottom with a
    // flat top and a rounded outline seen from above (sickle-jaw worker, superellipse cross-section)
    const W2 = Hw / 2;
    const hs = P.headShape;
    const eW = hs === 'flat' ? 0.45 : 0.6;
    const eT = hs === 'dome' ? 0.5 : hs === 'flat' ? 0.35 : 0.75;
    const eB = hs === 'flat' ? 0.45 : 0.85;
    hW = (u: number) => W2 * Math.pow(Math.max(0, Math.sin(Math.PI * u)), eW) * (1 + 0.04 * Math.cos(Math.PI * u));
    hTop = (u: number) => yH + (Hh / 2) * Math.pow(Math.max(0, Math.sin(Math.PI * u)), eT);
    hBot = (u: number) => yH - (Hh / 2) * 0.92 * Math.pow(Math.max(0, Math.sin(Math.PI * u)), eB);
    const n = lod === 2 ? 4 : Math.round(Lc.headRings * 0.7);
    const rings = [];
    for (let i = 0; i < n; i++) {
      const u = 0.02 + (0.96 * i) / (n - 1);
      const top = hTop(u);
      const bot = hBot(u);
      rings.push({ x: xH0 + u * Hc, cy: (top + bot) / 2, ry: (top - bot) / 2, rz: hW(u), col: mixC(headC, headHi, smooth(0.5, 1, u) * 0.5), bt: 0, sq: hs === 'flat' ? 2.8 : undefined });
    }
    const headMat = hard ? Mat.HARD : Mat.SOFT;
    acc.lathe(rings, Lc.headRadial, Bone.HEAD, headMat, true, true);
    antU = 0.7;
    if (lod < 2) {
      const face = mixC(headHi, headTip, 0.5);
      const cl = P.clypeus ?? 1; // v2.2: postclypeus size (inflated in Rhynchotermes workers)
      acc.ellipsoid(new Vector3(0.16 * Hc * cl, 0.2 * Hh * cl, 0.27 * Hw * cl), Lc.smallSeg[0] + 2, Lc.smallSeg[1], Bone.HEAD, headMat, face, trs(new Vector3(xHb - 0.1 * Hc, yH - 0.03 * Hh, 0)));
      acc.ellipsoid(new Vector3(0.1 * Hc, 0.06 * Hh, 0.19 * Hw), Lc.smallSeg[0], Lc.smallSeg[1] - 1, Bone.HEAD, headMat, mixC(face, headTip, 0.5), trs(new Vector3(xHb + 0.02 * Hc, yH - 0.22 * Hh, 0), [0, 0, -0.35]));
    }
    // chewing mandibles: curved flattened blades meeting in front of the labrum
    const ms = P.mandibles.scale;
    const mcol = C(pal.mandible);
    const mtip = C(pal.mandibleTip);
    for (const sd of [-1, 1]) {
      const bone = sd < 0 ? Bone.MAND_L : Bone.MAND_R;
      const b = new Vector3(xHb - 0.14 * Hc, yH - 0.3 * Hh, sd * 0.24 * Hw);
      const mid = new Vector3(xHb + 0.06 * Hc * ms, yH - 0.35 * Hh, sd * 0.19 * Hw * ms);
      const tip = new Vector3(xHb + 0.2 * Hc * ms, yH - 0.38 * Hh, -sd * 0.03 * Hw);
      const r0 = 0.09 * Hc * ms;
      const S: Sample[] = [
        { p: b, rN: r0 * 0.55, rB: r0, bone, col: mcol, bt: 0 },
        { p: b.clone().lerp(mid, 0.5), rN: r0 * 0.5, rB: r0 * 0.95, bone, col: mcol, bt: 0 },
        { p: mid, rN: r0 * 0.42, rB: r0 * 0.75, bone, col: mixC(mcol, mtip, 0.3), bt: 0 },
        { p: mid.clone().lerp(tip, 0.6), rN: r0 * 0.3, rB: r0 * 0.45, bone, col: mixC(mcol, mtip, 0.7), bt: 0 },
        { p: tip, rN: r0 * 0.12, bone, col: mtip, bt: 0 },
      ];
      acc.sweep(lod === 2 ? [S[0], S[4]] : lod === 1 ? [S[0], S[2], S[4]] : S, lod === 0 ? 5 : lod === 1 ? 4 : 3, Mat.MANDIBLE, lod < 2, true);
      setPivot(bone, b);
    }
    // compound eyes + ocelli (royals only). v2.1: set into the capsule so only a smooth low dome bulges out
    // (facets are drawn by the shader)
    if (P.eyes) {
      for (const sd of [-1, 1]) {
        const u = 0.5;
        const ex = xH0 + u * Hc;
        acc.ellipsoid(new Vector3(0.19 * Hc, 0.2 * Hh, 0.13 * Hw), lod === 2 ? 4 : lod === 1 ? 8 : 12, lod === 2 ? 2 : lod === 1 ? 5 : 7, Bone.HEAD, Mat.EYE, C(EYE_COLOR), trs(new Vector3(ex, yH + 0.06 * Hh, sd * hW(u) * 0.86), [0, sd * 0.2, 0]));
        if (P.ocelli && Lc.ocelli) {
          const uo = 0.68;
          acc.ellipsoid(new Vector3(0.05 * Hc, 0.035 * Hh, 0.045 * Hw), 6, 3, Bone.HEAD, Mat.OCELLUS, C(OCELLUS_COLOR), trs(new Vector3(xH0 + uo * Hc, hTop(uo) - 0.08 * Hh, sd * hW(uo) * 0.6)));
        }
      }
    }
  }

  // =========================================================================
  // THORAX: three narrow plates in one loft (meta at back -> saddle pronotum at front)
  // =========================================================================
  const bodyC = C(pal.body);
  const tergC = C(pal.tergite);
  const interC = C(pal.inter);
  {
    // queens: head + thorax in the king's colours (their palette's tergite / inter are the abdominal plates)
    const thPal = isQueen ? CASTES[P.species === 'rhynchotermes' ? 'rhy_king' : 'king'].colors : pal;
    const thBody = C(thPal.body);
    const thTerg = C(thPal.tergite);
    // royals: the pale membranes between the thoracic plates are mostly hidden (only thin seams show)
    const thInter = P.eyes ? mixC(C(thPal.inter), thBody, 0.75) : C(thPal.inter);
    // v, half-width factor, half-height factor, centre-y offset (x Th)
    const cpSaddle = [
      [0.0, 0.96, 0.96, 0.0],
      [0.17, 1.0, 1.0, 0.0],
      [0.33, 0.8, 0.84, 0.0],
      [0.47, 0.9, 0.9, 0.02],
      [0.6, 0.76, 0.8, 0.02],
      [0.74, 1.0, 0.86, 0.05],
      [0.9, 0.94, 1.12, 0.2], // raised anterior lobe of the saddle-shaped pronotum
      [1.0, 0.78, 0.92, 0.16],
    ];
    // v2.1: broad, flat, shield-like pronotum (Rhynchotermes royals)
    const cpShield = [
      [0.0, 0.96, 0.96, 0.0],
      [0.17, 1.0, 1.0, 0.0],
      [0.33, 0.82, 0.84, 0.0],
      [0.47, 0.92, 0.88, 0.02],
      [0.6, 0.8, 0.78, 0.03],
      [0.72, 1.12, 0.74, 0.08],
      [0.88, 1.18, 0.76, 0.1],
      [1.0, 0.92, 0.64, 0.1],
    ];
    const cp = P.pronotum === 'shield' ? cpShield : cpSaddle;
    const nR = Lc.thoraxRings;
    const vs = lod === 2 ? [0.02, 0.5, 0.98] : Array.from({ length: nR }, (_, i) => 0.01 + (0.98 * i) / (nR - 1));
    const rings = vs.map((v) => {
      const plate = v < 0.33 ? 0 : v < 0.6 ? 1 : 2;
      const local = plate === 0 ? v / 0.33 : plate === 1 ? (v - 0.33) / 0.27 : (v - 0.6) / 0.4;
      const plateCol = mixC(thBody, thTerg, 0.25 + 0.35 * smooth(0.2, 0.9, local));
      const col = mixC(plateCol, thInter, 1 - smooth(0.0, 0.14, Math.min(local, 1 - local)));
      return {
        x: xT0 + v * T,
        cy: yT + curve(cp, v, 3) * Th,
        ry: (Th / 2) * curve(cp, v, 2),
        rz: (Tw / 2) * curve(cp, v, 1),
        col,
        bt: v,
      };
    });
    acc.lathe(rings, Lc.bodyRadial, Bone.BODY, bodyMat, true, true);
  }

  // wing scales (royals). v2.1: small triangular, slightly curved stubs of the shed wings, attached to the sides
  // of the meso- and metathorax, angled backward, ~1/4 of the thorax length
  if (P.wingScales && lod < 2) {
    const wcol = C((isQueen ? CASTES[P.species === 'rhynchotermes' ? 'rhy_king' : 'king'].colors.wingScale : pal.wingScale) ?? '#3E2A1A');
    for (const v of [0.5, 0.2]) {
      for (const sd of [-1, 1]) {
        const len = 0.25 * T;
        const base = new Vector3(xT0 + v * T, yT + 0.26 * Th, sd * 0.43 * Tw);
        const dir = new Vector3(-0.86, -0.28, sd * 0.42).normalize();
        const n = lod === 0 ? 4 : 2;
        const S: Sample[] = [];
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const p = base.clone().addScaledVector(dir, f * len).add(new Vector3(0, -0.14 * len * f * f, sd * -0.05 * len * f * f));
          S.push({ p, rN: 0.03 * Th * (1 - 0.55 * f) + 0.004, rB: 0.15 * T * (1 - f) + 0.008 * T, bone: Bone.BODY, col: mixC(wcol, C('#000000'), 0.15 * f), bt: 0 });
        }
        acc.sweep(S, 4, Mat.HARD, true, true, new Vector3(0, 1, sd * 0.7).normalize());
      }
    }
  }

  // =========================================================================
  // ABDOMEN
  // =========================================================================
  const nSeg = 10;
  let abdTip: Vector3;
  let abdA: [number, number, number];
  let abdB: [number, number, number];
  if (isQueen) {
    // v2.1 QUEEN: ONE continuous, soft, pleated physogastric abdomen (custom grid; layout in QUEEN_ABD).
    // Each roll swells and its rear lip folds back over the next roll; creases deep on the sides, shallow on top
    // and below; flattened belly resting on the ground; the front dome swells up around the back of the thorax;
    // widest in the front-to-middle third; rounded, slightly pointed rear tip; slight downward arch.
    const q = P.physogastric!;
    const QA = QUEEN_ABD;
    const pleat = q.pleat ?? 0.17;
    const g0 = 0.015; // belly on the ground
    const uD = QA.frontDome;
    const uR = QA.rearCap;
    const yNose = g0 + (q.frontLift ?? 0.55) * Ah;
    const yTip = g0 + 0.24 * Ah;
    const qW = (u: number) => (QA.segments * (u + QA.warp * u * u)) / (1 + QA.warp);
    const qU = (w: number) => (-1 + Math.sqrt(1 + 4 * QA.warp * (1 + QA.warp) * (w / QA.segments))) / (2 * QA.warp);
    // 0 on the full part of a roll .. 1 at the bottom of a crease (mirrored by qCrease() in the shader)
    const qCrease = (w: number) => {
      const mask = smooth(0.55, 0.7, w) * (1 - smooth(QA.segments - 0.75, QA.segments - 0.45, w));
      if (mask <= 0) return 0;
      const s = w - Math.floor(w);
      return mask * (1 - Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(s, QA.rollSkew))), QA.rollPow));
    };
    const body = (u: number) => (1 - 0.2 * smooth(0.4, 1.0, u)) * (1 + 0.04 * (1 - smooth(0.12, 0.4, u)));
    const fc = (u: number) => (u < uD ? Math.sqrt(Math.max(0, 1 - (1 - u / uD) ** 2)) : 1);
    const rc = (u: number) => (u > uR ? Math.pow(Math.max(0, 1 - Math.pow((u - uR) / (1 - uR), 1.9)), 0.55) : 1);
    const ringAt = (u: number) => {
      const b = body(u);
      let top = g0 + Ah * b * (1 - 0.06 * smooth(0.25, 1.0, u));
      let bot = g0;
      if (u < uD) {
        const f = fc(u);
        top = yNose + (top - yNose) * f;
        bot = yNose - (yNose - g0) * f;
      }
      if (u > uR) {
        const r = rc(u);
        top = yTip + (top - yTip) * r;
        bot = yTip - (yTip - g0) * r;
      }
      return { top, bot, ym: bot + 0.45 * (top - bot), hw: (Aw / 2) * b * fc(u) * rc(u) };
    };
    const NU = 2.3; // superellipse exponents: rounded back ...
    const NL = 3.2; // ... flattened belly
    const spow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
    const creases = lod < 2; // LOD2: smooth body, the shader draws the creases (bump + shading)
    const qPoint = (u: number, a: number) => {
      const R = ringAt(u);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const upper = ca >= 0;
      let y = upper ? (R.top - R.ym) * spow(ca, 2 / NU) : (R.ym - R.bot) * spow(ca, 2 / NL);
      let z = R.hw * spow(sa, 2 / (upper ? NU : NL));
      let x = xA0 - u * A;
      if (creases) {
        const w = qW(u);
        const side = Math.pow(Math.abs(sa), 1.4);
        const k = 1 - pleat * qCrease(w) * (0.35 + 0.65 * side);
        y *= k;
        z *= k;
        // the rear lip of each roll folds back over the crease
        const kk = Math.round(w);
        const d = w - kk;
        if (kk >= 1 && kk <= QA.segments - 1 && d < 0) {
          const segLen = (A * (1 + QA.warp)) / (QA.segments * (1 + 2 * QA.warp * u));
          x -= 0.13 * segLen * smooth(-0.16, -0.05, d) * (0.3 + 0.7 * side);
        }
      }
      return new Vector3(x, R.ym + y, z);
    };
    // rings: dense in the creases (LOD0 9 per roll), rounded poles at both ends
    const us: number[] = [];
    const nDome = lod === 0 ? 7 : lod === 1 ? 3 : 2;
    for (let i = 1; i <= nDome; i++) us.push(uD * (1 - Math.cos((i / nDome) * (Math.PI / 2))));
    const sList = lod === 0 ? [0, 0.05, 0.13, 0.25, 0.42, 0.6, 0.76, 0.87, 0.94] : lod === 1 ? [0, 0.3, 0.72] : null;
    if (sList) {
      for (let k = 0; k < QA.segments; k++)
        for (const s of sList) {
          const u = qU(k + s);
          if (u > uD + 0.004 && u < 0.984) us.push(u);
        }
    } else us.push(0.14, 0.22, 0.32, 0.44, 0.56, 0.68, 0.79, 0.88, 0.95);
    us.sort((a, b) => a - b);
    for (const xr of lod === 0 ? [0.9, 0.95, 0.98, 0.995] : lod === 1 ? [0.92, 0.975] : [0.98]) {
      const u = uR + (1 - uR) * xr;
      if (u > us[us.length - 1] + 0.001) us.push(u);
    }
    const radial = lod === 0 ? 40 : lod === 1 ? 18 : 10;
    const lp: number[] = [];
    const li: number[] = [];
    const va: VertexAttrs = { bone: [], col: [], bt: [] };
    const baseCol = C(q.amber ?? '#E6B85A'); // the shader colours the membrane from the age palette
    const pushV = (v: Vector3, u: number) => {
      lp.push(v.x, v.y, v.z);
      va.bone.push(Bone.ABDOMEN);
      va.col.push(baseCol);
      va.bt.push(u);
    };
    const order = us.slice().reverse(); // rings run along +X (rear tip first), like the lathe
    for (const u of order) for (let j = 0; j < radial; j++) pushV(qPoint(u, (j / radial) * Math.PI * 2), u);
    const nR = order.length;
    for (let i = 0; i < nR - 1; i++)
      for (let j = 0; j < radial; j++) {
        const a0 = i * radial + j;
        const b0 = i * radial + ((j + 1) % radial);
        const c0 = (i + 1) * radial + j;
        const d0 = (i + 1) * radial + ((j + 1) % radial);
        li.push(a0, b0, c0, b0, d0, c0);
      }
    const pTip = lp.length / 3;
    pushV(new Vector3(xA0 - A, yTip, 0), 1);
    for (let j = 0; j < radial; j++) li.push(pTip, (j + 1) % radial, j);
    const pNose = lp.length / 3;
    pushV(new Vector3(xA0, yNose, 0), 0);
    const o0 = (nR - 1) * radial;
    for (let j = 0; j < radial; j++) li.push(pNose, o0 + j, o0 + ((j + 1) % radial));
    acc.piece(lp, li, va, lod === 2 ? Mat.MEMBRANE_LO : Mat.MEMBRANE);

    // very fine, sparse pale hairs (LOD0)
    if (lod === 0) {
      const rnd = mulberry32(23);
      const hairC = C('#F4EBD8');
      for (let h = 0; h < 44; h++) {
        const u = 0.1 + 0.85 * rnd();
        const a = (rnd() - 0.5) * 2.6;
        const p0 = qPoint(u, a);
        const nrm = qPoint(u, a + 0.02).sub(qPoint(u, a - 0.02)).cross(qPoint(u - 0.004, a).sub(qPoint(u + 0.004, a))).normalize();
        const dir = nrm.multiplyScalar(0.7).add(new Vector3(-0.7, 0, 0)).normalize();
        acc.hair(p0.addScaledVector(nrm, -0.01), dir, (0.1 + 0.08 * rnd()) * sc, 0.005 * sc, Bone.ABDOMEN, hairC, u);
      }
    }
    abdTip = new Vector3(xA0 - A, yTip, 0);
    setPivot(Bone.ABDOMEN, new Vector3(xA0 - 0.06 * A, ringAt(0.06).ym, 0));
    abdA = [xA0 - 0.35 * A, ringAt(0.35).ym, 0];
    abdB = [xA0 - 0.92 * A, ringAt(0.92).ym, 0];
    // egg emerging at the tip (hidden unless laying)
    const eggC = new Vector3(abdTip.x + 0.25, abdTip.y, 0);
    if (lod < 2) acc.ellipsoid(new Vector3(0.27, 0.16, 0.16), lod === 0 ? 8 : 6, lod === 0 ? 5 : 3, Bone.EGG_LAY, Mat.EGG, C(EGG_COLOR), trs(eggC));
    setPivot(Bone.EGG_LAY, eggC);
  } else {
    // segmented loft (10 tergites, serrated rear margins), broad join to the metanotum
    const jw = (0.5 * Tw * 0.95) / (Aw / 2);
    const jh = (0.5 * Th * 0.95) / (Ah / 2);
    const abdTs: number[] = [];
    if (lod === 2) abdTs.push(0.0, 0.12, 0.35, 0.62, 0.85, 0.97);
    else {
      abdTs.push(0.0);
      const subs = Lc.abdRingsPerSeg === 3 ? [0.04, 0.5, 0.93] : [0.6];
      for (let s = 0; s < nSeg; s++) for (const f of subs) abdTs.push((s + f) / nSeg);
      abdTs.push(0.985);
    }
    const abdShape = P.abdShape ?? 'plump';
    const prof = (t: number) => {
      // plump: rises steeply from the thorax, stays full, rounds off bluntly at the rear
      // v2.2 'oval': a rounded egg (nasute worker); 'long': a long slim cigar tapering to the tip (sickle-jaw worker)
      let p: number;
      if (abdShape === 'oval') {
        if (t < 0.42) p = jw + (1 - jw) * Math.pow(Math.sin((Math.PI / 2) * (t / 0.42)), 0.8);
        else p = Math.pow(Math.max(0, 1 - Math.pow((t - 0.42) / 0.58, 2.2)), 0.6);
      } else if (abdShape === 'long') {
        if (t < 0.3) p = jw + (1 - jw) * Math.sin((Math.PI / 2) * (t / 0.3));
        else if (t < 0.58) p = 1;
        else p = Math.pow(Math.max(0, 1 - Math.pow((t - 0.58) / 0.42, 2.0)), 0.5);
      } else if (t < 0.45) p = jw + (1 - jw) * Math.sin((Math.PI / 2) * (t / 0.45));
      else p = Math.pow(Math.max(0, 1 - Math.pow((t - 0.45) / 0.55, 2.0)), 0.55);
      const s = (t * nSeg) % 1;
      if (lod < 2) p *= 1 - 0.015 + 0.035 * smooth(0.1, 0.95, s) * (t > 0.06 ? 1 : 0);
      return Math.max(p, 0.002);
    };
    const abdCy = (t: number) => {
      const y0 = yT - 0.12 * Th;
      return y0 + (yA - y0) * smooth(0.0, 0.35, t) - 0.05 * Ah * smooth(0.75, 1, t);
    };
    {
      const rings = abdTs.map((t) => {
        const p = prof(t);
        const ph = Math.max(p, jh * (1 - smooth(0, 0.3, t)));
        return { x: xA0 - t * A, cy: abdCy(t), ry: (Ah / 2) * ph, rz: (Aw / 2) * p, col: bodyC, bt: t };
      });
      rings.reverse(); // lathe runs along +X
      acc.lathe(rings, Lc.bodyRadial, Bone.ABDOMEN, bodyMat, true, true);
    }
    abdTip = new Vector3(xA0 - A, abdCy(1), 0);
    setPivot(Bone.ABDOMEN, new Vector3(xA0, abdCy(0), 0));
    abdA = [xA0, abdCy(0.35), 0];
    abdB = [xA0 - A * 0.92, abdCy(0.92), 0];

    // sparse long pale hairs along the rear edge of each tergite
    if (Lc.setae && P.setae.perTergite > 0) {
      const hair = C(pal.hair);
      const rnd = mulberry32(11);
      for (let s = 1; s < nSeg; s++) {
        const t = (s + 0.93) / nSeg;
        if (t > 0.98) continue;
        const p = prof(t);
        const ry = (Ah / 2) * p;
        const rz = (Aw / 2) * p;
        const cy = abdCy(t);
        for (let h = 0; h < P.setae.perTergite; h++) {
          const a = -1.35 + (2.7 * (h + 0.5)) / P.setae.perTergite + (rnd() - 0.5) * 0.3;
          const base = new Vector3(xA0 - t * A, cy + ry * Math.cos(a) * 0.98, rz * Math.sin(a) * 0.98);
          const nrm = new Vector3(0, Math.cos(a) / ry, Math.sin(a) / rz).normalize();
          const dir = nrm.multiplyScalar(0.75).add(new Vector3(-0.65, 0, 0)).normalize();
          acc.hair(base, dir, (0.12 + 0.08 * rnd()) * sc, 0.0065 * sc, Bone.ABDOMEN, hair, t);
        }
      }
    }
    setPivot(Bone.EGG_LAY, abdTip);
  }

  // =========================================================================
  // ANTENNAE: straight moniliform (beaded) tubes
  // =========================================================================
  const antBase = new Float32Array(6);
  const antDir = new Float32Array(6);
  const antLen = P.antenna.lengthFrac * L;
  const antR = P.antenna.radius * sc;
  const antMid = C(pal.legMid);
  const antJoint = C(pal.legJoint);
  const antBaseCol = C(pal.leg);
  for (const sd of [-1, 1]) {
    const ai = sd < 0 ? 0 : 1;
    const bone = sd < 0 ? Bone.ANT_L : Bone.ANT_R;
    const u = antU;
    const top = hTop(u);
    const bot = hBot(u);
    const base = new Vector3(xH0 + u * Ht, (top + bot) / 2 - (0.28 * (top - bot)) / 2, sd * hW(u) * 0.9);
    const dir = antDirOverride ? antDirOverride(sd) : new Vector3(1.0, -0.06, sd * (P.headShape === 'pear' ? 0.5 : 0.62)).normalize();
    antBase.set([base.x, base.y, base.z], ai * 3);
    antDir.set([dir.x, dir.y, dir.z], ai * 3);
    setPivot(bone, base);
    const n = P.antenna.beads;
    const rawL: number[] = [];
    for (let i = 0; i < n; i++) rawL.push(i === 0 ? 1.9 : i === 1 ? 1.0 : 0.85 + 0.4 * ((i - 2) / Math.max(1, n - 3)));
    const sum = rawL.reduce((a, b) => a + b, 0);
    const segL = rawL.map((r) => (r / sum) * antLen);
    const at = (s: number) => base.clone().addScaledVector(dir, s);
    const S: Sample[] = [];
    if (Lc.antDetail === 0) {
      let s0 = 0;
      S.push({ p: at(0), rN: antR * 0.8, bone, col: antJoint, bt: 0 });
      for (let i = 0; i < n; i++) {
        const l = segL[i];
        const r = antR * (i === 0 ? 1.05 : i === 1 ? 0.85 : 0.8 + 0.22 * (i / n));
        if (i > 0) S.push({ p: at(s0 + l * 0.06), rN: r * 0.58, bone, col: antJoint, bt: s0 + l * 0.06 });
        S.push({ p: at(s0 + l * 0.5), rN: r, bone, col: mixC(antBaseCol, antMid, 0.3), bt: s0 + l * 0.5 });
        s0 += l;
      }
      S.push({ p: at(antLen - segL[n - 1] * 0.1), rN: antR * 0.5, bone, col: antJoint, bt: antLen });
    } else {
      const m = Lc.antDetail === 1 ? 7 : 2;
      for (let i = 0; i < m; i++) {
        const s = (antLen * i) / (m - 1);
        S.push({ p: at(s), rN: antR * (0.95 - 0.15 * (i / (m - 1))) * (Lc.antDetail === 2 ? 1.25 : 1), bone, col: mixC(antBaseCol, antMid, 0.4), bt: s });
      }
    }
    acc.sweep(S, Lc.antRadial, bodyMat, true, true);
  }

  // =========================================================================
  // LEGS: one swept tube per leg through coxa, femur, tibia, tarsus (+ spurs, claws)
  // =========================================================================
  const legDir = new Float32Array(18);
  const legC = C(pal.leg);
  const legMidC = C(pal.legMid);
  const legJointC = C(pal.legJoint);
  const clawC = mixC(legJointC, C('#2A160A'), 0.5);
  const segCol = (t: number) => mixC(legJointC, mixC(legC, legMidC, 0.35 * Math.sin(Math.PI * t) ** 1.5), smooth(0, 0.2, Math.min(t, 1 - t)) * 0.75 + 0.25);
  const hipX = [xT0 + 0.8 * T, xT0 + 0.47 * T, xT0 + 0.17 * T];
  // v2.1: the queen's legs are splayed forward and to the sides at the front (they cannot carry the abdomen)
  const fwd = isQueen ? [0.5, 0.3, 0.12] : [0.42, 0.04, -0.46];
  const lat = isQueen ? [0.42, 0.55, 0.6] : [0.38, 0.46, 0.4];
  const R = P.legs.radius;
  let reachSum = 0;
  for (let leg = 0; leg < 6; leg++) {
    const sd = legSide(leg);
    const pair = leg % 3;
    const Ll = P.legs.length[pair] * L;
    const lc = 0.14 * Ll;
    const lf = 0.34 * Ll;
    const ltb = 0.34 * Ll;
    const lts = 0.18 * Ll;
    const H = new Vector3(hipX[pair], yT - 0.36 * Th, sd * 0.3 * Tw);
    const F = new Vector3(H.x + fwd[pair] * Ll, 0.01 * sc, H.z + sd * lat[pair] * Ll * P.legs.spread);
    const dOut = new Vector3(F.x - H.x, 0, F.z - H.z).normalize();
    legDir.set([dOut.x, dOut.y, dOut.z], leg * 3);
    const Cx = H.clone().addScaledVector(dOut, 0.4 * lc).addScaledVector(down, 0.85 * lc);
    let Ak = F.clone().addScaledVector(dOut, -lts * 0.93);
    Ak.y = 0.02 * sc + lts * 0.3;
    // two-bone IK in the vertical plane through C and A, knee bent upward
    let D = Ak.distanceTo(Cx);
    const maxD = (lf + ltb) * 0.985;
    if (D > maxD) {
      Ak = Cx.clone().add(Ak.clone().sub(Cx).setLength(maxD));
      D = maxD;
    }
    const along = Ak.clone().sub(Cx).normalize();
    const sideV = new Vector3().crossVectors(along, up).normalize();
    const kUp = new Vector3().crossVectors(sideV, along).normalize();
    const a = (lf * lf - ltb * ltb + D * D) / (2 * D);
    const hk = Math.sqrt(Math.max(0, lf * lf - a * a));
    const K = Cx.clone().addScaledVector(along, a).addScaledVector(kUp, hk);
    const Fp = Ak.clone().add(F.clone().sub(Ak).setLength(lts));
    Fp.y = Math.max(Fp.y, 0.012 * sc);
    reachSum += Math.hypot(Fp.x - H.x, Fp.z - H.z);
    const b0 = legBone(leg, 0);
    setPivot(b0, H);
    setPivot(b0 + 1, Cx);
    setPivot(b0 + 2, K);
    setPivot(b0 + 3, Ak);
    const L3 = (p: Vector3, q: Vector3, t: number) => p.clone().lerp(q, t);
    const S: Sample[] = [];
    if (Lc.legDetail === 0) {
      S.push({ p: H.clone().addScaledVector(down, -0.02 * sc), rN: 1.3 * R, bone: b0, col: segCol(0.05), bt: 0 });
      S.push({ p: L3(H, Cx, 0.55), rN: 1.38 * R, bone: b0, col: segCol(0.5), bt: 0 });
      S.push({ p: L3(H, Cx, 0.94), rN: 1.12 * R, bone: b0, col: segCol(0.95), bt: 0 });
      S.push({ p: L3(Cx, K, 0.08), rN: 0.95 * R, rB: 0.8 * R, bone: b0 + 1, col: segCol(0.08), bt: 0 });
      S.push({ p: L3(Cx, K, 0.35), rN: 1.18 * R, rB: 0.9 * R, bone: b0 + 1, col: segCol(0.4), bt: 0 });
      S.push({ p: L3(Cx, K, 0.75), rN: 1.05 * R, rB: 0.85 * R, bone: b0 + 1, col: segCol(0.75), bt: 0 });
      S.push({ p: L3(Cx, K, 0.97), rN: 0.8 * R, bone: b0 + 1, col: segCol(0.98), bt: 0 });
      S.push({ p: L3(K, Ak, 0.06), rN: 0.72 * R, bone: b0 + 2, col: segCol(0.05), bt: 0 });
      S.push({ p: L3(K, Ak, 0.5), rN: 0.66 * R, bone: b0 + 2, col: segCol(0.5), bt: 0 });
      S.push({ p: L3(K, Ak, 0.95), rN: 0.6 * R, bone: b0 + 2, col: segCol(0.95), bt: 0 });
      S.push({ p: L3(Ak, Fp, 0.06), rN: 0.46 * R, bone: b0 + 3, col: segCol(0.1), bt: 0 });
      S.push({ p: L3(Ak, Fp, 0.55), rN: 0.4 * R, bone: b0 + 3, col: segCol(0.5), bt: 0 });
      S.push({ p: Fp.clone(), rN: 0.3 * R, bone: b0 + 3, col: segCol(0.95), bt: 0 });
    } else if (Lc.legDetail === 1) {
      S.push({ p: H.clone(), rN: 1.3 * R, bone: b0, col: segCol(0.3), bt: 0 });
      S.push({ p: L3(Cx, K, 0.05), rN: 1.0 * R, bone: b0 + 1, col: segCol(0.1), bt: 0 });
      S.push({ p: L3(Cx, K, 0.45), rN: 1.12 * R, bone: b0 + 1, col: segCol(0.45), bt: 0 });
      S.push({ p: L3(K, Ak, 0.04), rN: 0.75 * R, bone: b0 + 2, col: segCol(0.05), bt: 0 });
      S.push({ p: L3(K, Ak, 0.95), rN: 0.6 * R, bone: b0 + 2, col: segCol(0.9), bt: 0 });
      S.push({ p: Fp.clone(), rN: 0.35 * R, bone: b0 + 3, col: segCol(0.9), bt: 0 });
    } else {
      S.push({ p: H.clone(), rN: 1.5 * R, bone: b0, col: segCol(0.4), bt: 0 });
      S.push({ p: K.clone(), rN: 1.1 * R, bone: b0 + 2, col: segCol(0.4), bt: 0 });
      S.push({ p: Fp.clone(), rN: 0.6 * R, bone: b0 + 3, col: segCol(0.4), bt: 0 });
    }
    acc.sweep(S, lod === 0 && P.legRadial ? P.legRadial : Lc.legRadial, bodyMat, Lc.legDetail < 2, Lc.legDetail < 2, dOut.clone().cross(up));
    if (Lc.spursClaws) {
      const tdir = Ak.clone().sub(K).normalize();
      for (const kk of [-1, 1]) {
        const base = L3(K, Ak, 0.93).add(new Vector3(0, 0, kk * 0.25 * R));
        const dir = tdir.clone().add(new Vector3(kk * 0.1, -0.15, 0)).normalize();
        acc.sweep(
          [
            { p: base, rN: 0.18 * R, bone: b0 + 2, col: clawC, bt: 0 },
            { p: base.clone().addScaledVector(dir, 0.6 * R + 0.04 * sc), rN: 0.02 * R, bone: b0 + 2, col: clawC, bt: 0 },
          ],
          3,
          bodyMat,
          false,
          false,
        );
        const cb = Fp.clone().add(new Vector3(0, 0, kk * 0.1 * R));
        const cdir = dOut.clone().add(new Vector3(0, -0.9, kk * 0.4)).normalize();
        acc.sweep(
          [
            { p: cb, rN: 0.16 * R, bone: b0 + 3, col: clawC, bt: 0 },
            { p: cb.clone().addScaledVector(cdir, 0.035 * sc + 0.3 * R), rN: 0.02 * R, bone: b0 + 3, col: clawC, bt: 0 },
          ],
          3,
          Mat.HARD,
          false,
          false,
        );
      }
    }
    // v2: thorn-like process on the fore coxa (Rhynchotermes soldier), pointing forward and slightly down
    if (P.coxaProcess && pair === 0 && lod < 2) {
      const cb = L3(H, Cx, 0.55);
      const cdir = new Vector3(1, -0.35, sd * 0.25).normalize();
      acc.sweep(
        [
          { p: cb, rN: 0.75 * R, bone: b0, col: segCol(0.5), bt: 0 },
          { p: cb.clone().addScaledVector(cdir, 0.11 * sc), rN: 0.05 * R, bone: b0, col: legJointC, bt: 0 },
        ],
        lod === 0 ? 4 : 3,
        bodyMat,
        false,
        true,
      );
    }
  }

  // =========================================================================
  // carried items (worker): wood fragment / egg in the mandibles
  // =========================================================================
  const itemC = new Vector3(xHb + 0.36 * Hc, yH - 0.4 * Hh, 0);
  setPivot(Bone.CARRY, itemC);
  const items = P.carryItems ?? (casteId === 'worker' ? ['wood', 'egg'] : []);
  if (items.includes('wood') && lod < 2) {
    const rnd = mulberry32(7);
    const wood = C(WOOD_COLOR);
    const cl = 0.55 * sc;
    const q = new Quaternion().setFromAxisAngle(up, 1.25);
    const S: Sample[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const r = Math.sin(Math.PI * (0.1 + 0.8 * t)) * 0.13 * sc * (0.8 + 0.4 * rnd());
      S.push({ p: new Vector3(-cl / 2 + cl * t, 0, 0).applyQuaternion(q).add(itemC), rN: r * 0.55, rB: r * 1.25, bone: Bone.CARRY, col: mixC(wood, C('#5E4428'), rnd()), bt: 0 });
    }
    acc.sweep(lod === 0 ? S : [S[0], S[2], S[5]], lod === 0 ? 6 : 4, Mat.WOOD, true, true);
  }
  if (items.includes('leaf') && lod < 2) {
    // v2: torn leaf-litter fragment, a thin curled wafer held crosswise in the mandibles
    const rnd = mulberry32(13);
    const cl = 0.95 * sc;
    const q = new Quaternion().setFromAxisAngle(up, 1.35).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.35));
    const S: Sample[] = [];
    const n = lod === 0 ? 7 : 4;
    const lc = LEAF_COLORS.map((h) => C(h));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w = (0.12 + 0.24 * Math.sin(Math.PI * (0.08 + 0.84 * t)) * (0.75 + 0.5 * rnd())) * sc;
      const curl = 0.07 * sc * Math.sin(Math.PI * t);
      S.push({ p: new Vector3(-cl / 2 + cl * t, curl, 0).applyQuaternion(q).add(itemC).add(new Vector3(0, -0.04 * sc, 0)), rN: 0.016 * sc, rB: w, bone: Bone.CARRY, col: mixC(lc[i % 4], lc[(i + 1) % 4], rnd()), bt: 0 });
    }
    acc.sweep(S, lod === 0 ? 8 : 4, Mat.LEAF, true, true, new Vector3(0, 1, 0).applyQuaternion(q));
  }
  if (items.includes('egg') && lod < 2) {
    acc.ellipsoid(new Vector3(0.26, 0.15, 0.15), lod === 0 ? 8 : 6, lod === 0 ? 5 : 3, Bone.CARRY, Mat.EGG, C(EGG_COLOR), new Matrix4().compose(itemC.clone().add(new Vector3(0.05 * sc, 0, 0)), new Quaternion().setFromAxisAngle(up, 1.4), new Vector3(1, 1, 1)));
  }

  // =========================================================================
  // finish: geometry + rig (incl. the caste's row of the shared rig texture)
  // =========================================================================
  const row = CASTE_ROW[casteId];
  const geom = acc.toGeometry(row);
  const bb = geom.boundingBox!;
  const amp = P.gait.amplitude;
  const reach = reachSum / 6;
  const front = nasusTip ? nasusTip[0] : xHb + 0.27 * Hc * P.mandibles.scale;
  const bodyLength = front - (xA0 - A);
  const texRow = new Float32Array(RigCol.COUNT * 4);
  const put = (col: number, x: number, y = 0, z = 0, w = 0) => texRow.set([x, y, z, w], col * 4);
  for (let b = 0; b < Bone.COUNT; b++) put(RigCol.PIVOT + b, pivots[b * 3], pivots[b * 3 + 1], pivots[b * 3 + 2]);
  for (let l = 0; l < 6; l++) put(RigCol.LEGDIR + l, legDir[l * 3], legDir[l * 3 + 1], legDir[l * 3 + 2]);
  for (let ai = 0; ai < 2; ai++) {
    put(RigCol.ANTBASE + ai, antBase[ai * 3], antBase[ai * 3 + 1], antBase[ai * 3 + 2]);
    put(RigCol.ANTDIR + ai, antDir[ai * 3], antDir[ai * 3 + 1], antDir[ai * 3 + 2]);
  }
  put(RigCol.ABD_A, ...abdA);
  put(RigCol.ABD_B, ...abdB);
  put(RigCol.RIG_A, bodyLength, amp, isQueen ? 1 : 0, isLarva ? 1 : 0);
  put(RigCol.RIG_B, yT, P.gait.lift, antLen, 0.012 * L);
  const kind = P.headShape === 'pear' || P.headShape === 'globe' ? 1 : isLarva ? 3 : P.eyes ? 2 : 0;
  put(RigCol.SKIN, P.translucency, P.gut, P.headCoat, kind);
  put(RigCol.HEAD0, xH0 + Hc / 2, yH, 0, Hc / 2);
  put(RigCol.HEAD1, Hw / 2, Hh / 2, pal.suture ? (P.sutureStrength ?? 1) : 0, P.fontanelle ?? 0);
  const tg = C(pal.tergite);
  const it = C(pal.inter);
  const gu = C(pal.gut);
  const hr = C(pal.headTip);
  const su = C(pal.suture ?? pal.headTip);
  put(RigCol.TERGITE, tg.r, tg.g, tg.b);
  put(RigCol.INTER, it.r, it.g, it.b);
  put(RigCol.GUT, gu.r, gu.g, gu.b, P.gutSpread ?? 0.2);
  put(RigCol.HEADRIM, hr.r, hr.g, hr.b);
  put(RigCol.SUTURE, su.r, su.g, su.b);
  put(RigCol.ABD_INFO, xA0, A, Aw / 2, Ah / 2);
  // v2
  const headRest = P.headRest ?? HEAD_REST_PITCH;
  const sickle = P.mandibles.kind === 'sickle';
  put(RigCol.POSE, headRest, P.mandRest ?? 0.12, sickle ? P.mandibles.sickle!.gape : 0.6, sickle ? 1 : 0);
  put(RigCol.MANDAX, mandAxis[0], mandAxis[1], mandAxis[2], 0);
  const nb = C(pal.nasusBase ?? pal.head);
  put(RigCol.NASUSBASE, nb.r, nb.g, nb.b, nasusBaseU);
  // v2.1 physogastric queen: default age, dorsal plate size (fraction of the half-width, front / rear), pleat
  if (isQueen) {
    const q = P.physogastric!;
    const plate = q.plate ?? 0.36;
    put(RigCol.QUEEN0, q.age ?? 0.5, plate, plate * 0.72, q.pleat ?? 0.17);
    const iv = C(q.ivory ?? '#F3EBDD');
    const am = C(q.amber ?? '#E6B85A');
    const ho = C(q.honey ?? '#C98F3E');
    put(RigCol.QIVORY, iv.r, iv.g, iv.b);
    put(RigCol.QAMBER, am.r, am.g, am.b);
    put(RigCol.QHONEY, ho.r, ho.g, ho.b);
  }

  const rig: TermiteRig = {
    casteId,
    row,
    lod,
    texRow,
    pivots,
    legDir,
    antBase,
    antDir,
    abdA,
    abdB,
    bodyLength,
    bodyHeight: yT,
    antennaLength: antLen,
    strideLength: (2 * reach * Math.sin(amp)) / GAIT_DUTY,
    gaitAmplitude: amp,
    gaitLift: P.gait.lift,
    isQueen,
    isLarva,
    nasusTip,
    nasusTipDiameter: nasusTipR * 2,
    neck: [neck.x, neck.y, neck.z],
    bounds: { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] },
    triangles: geom.getIndex()!.count / 3,
    headRest,
    mandibleTips: mandTips,
    socket: mandTips ? [(mandTips[0][0] + mandTips[1][0]) / 2, (mandTips[0][1] + mandTips[1][1]) / 2, (mandTips[0][2] + mandTips[1][2]) / 2] : null,
    mandibleAxis: mandAxis,
    nasusDir: nasusDirOut,
  };
  geom.userData.rig = rig;
  return geom;
}

/** A loose clutch of termite eggs (translucent cream ovals). Uses the 'eggs' rig row. */
export function buildEggClusterGeometry(count = 6, seed = 1, lod = 0): BufferGeometry {
  const acc = new MeshAccumulator();
  const rnd = mulberry32(seed);
  const seg = lod === 0 ? [10, 6] : lod === 1 ? [7, 4] : [5, 3];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 0.32 * Math.sqrt(count);
    const layer = i > count * 0.65 ? 1 : 0;
    const p = new Vector3(Math.cos(a) * r, 0.15 + layer * 0.22, Math.sin(a) * r);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rnd() * Math.PI).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (rnd() - 0.5) * 0.6));
    const s = 0.9 + rnd() * 0.2;
    acc.ellipsoid(new Vector3(0.27 * s, 0.155 * s, 0.155 * s), seg[0], seg[1], Bone.BODY, Mat.EGG, C(EGG_COLOR), new Matrix4().compose(p, q, new Vector3(1, 1, 1)));
  }
  const g = acc.toGeometry(CASTE_ROW.eggs);
  const texRow = new Float32Array(RigCol.COUNT * 4);
  texRow.set([1, 0, 0, 0], RigCol.RIG_A * 4);
  texRow.set([0.15, 0, 1, 0.02], RigCol.RIG_B * 4);
  texRow.set([0.9, 0, 0.4, 4], RigCol.SKIN * 4);
  texRow.set([-1, 0, 0, 0], RigCol.ABD_B * 4);
  texRow.set([HEAD_REST_PITCH, 0.12, 0.6, 0], RigCol.POSE * 4);
  texRow.set([0, 1, 0, 0], RigCol.MANDAX * 4);
  const bb = g.boundingBox!;
  g.userData.rig = {
    casteId: 'eggs',
    row: CASTE_ROW.eggs,
    lod,
    texRow,
    pivots: new Float32Array(Bone.COUNT * 3),
    legDir: new Float32Array(18),
    antBase: new Float32Array(6),
    antDir: new Float32Array(6),
    abdA: [0, 0, 0],
    abdB: [-1, 0, 0],
    bodyLength: 1,
    bodyHeight: 0.15,
    antennaLength: 1,
    strideLength: 1,
    gaitAmplitude: 0,
    gaitLift: 0,
    isQueen: false,
    isLarva: false,
    nasusTip: null,
    nasusTipDiameter: 0,
    neck: [0, 0, 0],
    bounds: { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] },
    triangles: g.getIndex()!.count / 3,
  } satisfies TermiteRig;
  return g;
}
