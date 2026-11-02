// @ts-nocheck
/**
 * Hell ant builder (Haidomyrmecinae) — ported from the user's verified prototype
 * (claude/hell-ants/06-prototype-code.md, hell_builder.js) onto the shared ant
 * builder's helpers. Returns the standard { geometry, rig } plus the vertical
 * mandible rig (mandVert, mandSwing, mandRest, hold, hornTip, gaitLift).
 * Units: head lengths H = L / units; +x forward, +y up, +z right.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { Acc, PART, tube, loft, ellipsoid, transformPts, ss, tmpC, BuiltAnt, detOf, plantHomes } from './antGeometry';
import { REGION } from '../bake/detailBake';
// ===== HELL ANT BUILDER (prototype; injected into a local copy of the bundle) =====
// A dedicated builder for the three hell ant morphs. It returns exactly what the shared
// morph builder returns ({ geometry, rig }) so the instanced renderer, impostors and the
// ant shader work unchanged, plus a few extra rig fields (mandVert, mandSwing, mandRest,
// hold, holdDir, hornTip, gaitLift). Body space: +x forward, +y up, z lateral, feet on y=0.
// All lengths in the morph spec are in head lengths (H); H = L / units.
const HV = THREE.Vector3, HQ = THREE.Quaternion, HC = THREE.Color;
const hellC = (hex) => new HC(hex);
const hellMix = (a, b, t) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));

function hellSpline(pts, n) {
  // Catmull-Rom through the control points; returns n + 1 points.
  const m = pts.length, P = [pts[0].clone().multiplyScalar(2).sub(pts[1]), ...pts, pts[m - 1].clone().multiplyScalar(2).sub(pts[m - 2])];
  const out = [], segs = m - 1;
  for (let k = 0; k <= n; k++) {
    const g = (k / n) * segs, s = Math.min(segs - 1, Math.floor(g)), t = g - s, t2 = t * t, t3 = t2 * t;
    const [p0, p1, p2, p3] = [P[s], P[s + 1], P[s + 2], P[s + 3]];
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    out.push(new HV(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z)));
  }
  return out;
}

// Per-vertex colours: piece() asks for one colour per vertex, in vertex order.
// (realism rework, CHANGE_PLAN §22: every piece carries its baked-detail coordinates — `reg` a detailBake REGION)
function hellPieceRGB(n, pos, idx, part, cols, surf, surfW = 0, det = undefined) {
  let k = 0;
  n.piece(pos, idx, part, () => tmpC.copy(cols[Math.min(k++, cols.length - 1)]), surf, surfW, undefined, det);
}
function hellTube(n, pts, radii, segs, part, colorAt, surf, capA = true, capB = true, flat = 1, surfW = 0, reg = 0) {
  const [p, ix, meta] = tube(pts, radii, segs, capA, capB, flat), cols = [];
  for (let u = 0; u < pts.length; u++) for (let d = 0; d < segs; d++) cols.push(colorAt(u / (pts.length - 1), d / segs));
  if (capA) cols.push(colorAt(0, 0));
  if (capB) cols.push(colorAt(1, 0));
  hellPieceRGB(n, p, ix, part, cols, surf, surfW, reg ? detOf(meta, reg) : undefined);
  return p;
}
function hellLoft(n, sections, segs, part, colorAt, surf, deform, xf, reg = 0) {
  // colorAt(tAlong, dorsal [-1..1], lateral [-1..1])
  let [p, ix, meta] = loft(sections, segs, deform);
  if (xf) p = transformPts(p, xf);
  const cols = [], rings = sections.length;
  for (let h = 0; h < rings; h++) for (let d = 0; d < segs; d++) { const a = (d / segs) * Math.PI * 2; cols.push(colorAt(h / (rings - 1), Math.sin(a), Math.cos(a))); }
  cols.push(colorAt(0, 0, 0), colorAt(1, 0, 0));
  hellPieceRGB(n, p, ix, part, cols, surf, 0, reg ? detOf(meta, reg) : undefined);
}
function hellBlob(n, c, rad, segs, part, col, surf, q, surfW = 0, reg = 0) {
  const [p, ix, meta] = ellipsoid(c, rad, segs, q);
  n.piece(p, ix, part, () => tmpC.copy(col), surf, surfW, undefined, reg ? detOf(meta, reg) : undefined);
}
/** An erect seta (realism setae path: tapered, paler toward the tip, kept out of the occlusion bake), curving by `bend`. */
function hellSeta(n, root, dir, len, r0, part, col, look, bend = null) {
  const tip = root.clone().addScaledVector(dir, len);
  const mid = root.clone().lerp(tip, 0.55);
  if (bend) mid.addScaledVector(bend, len);
  n.hair([root, mid, tip], [r0, r0 * 0.6, r0 * 0.12], 3, part, col, look);
}
function hellHair(n, root, tip, r0, part, col, surf, bend) {
  const pts = bend ? [root, root.clone().lerp(tip, 0.5).add(bend), tip] : [root, tip];
  const [p, ix] = tube(pts, bend ? [r0, r0 * 0.6, r0 * 0.15] : [r0, r0 * 0.15], 3, false, true);
  n.piece(p, ix, part, () => tmpC.copy(col), surf);
}
function hellRibbon(n, a, b, part, col, surf) {
  // Double-sided strip between two polylines (LOD1 stand-in for a hair fringe).
  const pos = [], idx = [], m = a.length;
  for (let k = 0; k < m; k++) pos.push(a[k].x, a[k].y, a[k].z, b[k].x, b[k].y, b[k].z);
  for (let k = 0; k < m - 1; k++) { const q = k * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3, q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  n.piece(pos, idx, part, () => tmpC.copy(col), surf);
}

export function buildHellAnt(i: any, t: number, e = 1): BuiltAnt {
  const n = new Acc(), rnd = new Rng(e * 101 + i.key.length * 7), lod = t, o = lod === 0;
  const L = i.L, H = L / (i.units ?? 5.5), lk = i.look, base = i.stance * H;
  const S = (a, b, c) => (lod === 0 ? a : lod === 1 ? b : c);
  const V = (x, y, z = 0) => new HV(x * H, y * H, z * H);
  const C = Object.fromEntries(Object.entries(lk.colors).map(([k, v]) => [k, hellC(v)]));
  const shade = (dors, top = C.bodyDark, under = C.bodyLight, mid = C.body) => (dors > 0 ? hellMix(mid, top, dors * 0.9) : hellMix(mid, under, -dors * 0.85));
  const UP = new HV(0, 1, 0);
  // ---------- mesosoma ----------
  const ms = i.meso, mL = ms.len * H;
  const mTop = (u) => ms.queen
    ? (0.2 + 0.5 * ss(0, 0.2, u) + 0.16 * Math.exp(-((u - 0.6) ** 2) / 0.02) + 0.06 * Math.exp(-((u - 0.36) ** 2) / 0.004) - 0.05 * Math.exp(-((u - 0.44) ** 2) / 0.0015) - 0.34 * ss(0.86, 1, u)) * ms.h
    : (0.18 + 0.42 * ss(0, 0.22, u) - 0.1 * Math.exp(-((u - 0.47) ** 2) / 0.006) + 0.12 * Math.exp(-((u - 0.74) ** 2) / 0.02) - 0.3 * ss(0.88, 1, u)) * ms.h / 0.62;
  const mBot = (u) => (0.02 + 0.08 * ss(0.86, 1, u) + 0.05 * (1 - ss(0, 0.14, u))) * ms.h / 0.62;
  const mW = (u) => ms.w * (0.64 + 0.22 * Math.exp(-((u - 0.74) ** 2) / 0.03) + 0.1 * Math.exp(-((u - 0.16) ** 2) / 0.02) + (ms.queen ? 0.15 * Math.exp(-((u - 0.55) ** 2) / 0.03) : 0))
    * Math.max(0.35, Math.pow(Math.min(1, u / 0.05), 0.5) * Math.pow(Math.min(1, (1 - u) / 0.06), 0.5));
  {
    const secs = [], R = S(16, 10, 6);
    for (let k = 0; k < R; k++) {
      const u = k / (R - 1), top = mTop(u), bot = mBot(u);
      secs.push({ x: u * mL, y: base + ((top + bot) / 2) * H, ry: ((top - bot) / 2) * H, rz: (mW(u) / 2) * H, n: 2.25 });
    }
    const plate = ms.queen ? C.plate : null;
    hellLoft(n, secs, S(14, 8, 5), PART.BODY, (u, d) => {
      let c = shade(d);
      if (plate && d > 0.2 && u > 0.3 && u < 0.75) c = hellMix(c, plate, 0.7);
      return c;
    }, lk.body, undefined, undefined, REGION.MESO);
    if (lod < 2) {
      // spiracle dot on the propodeum, and wing scars on queens
      for (const sd of [-1, 1]) {
        const u = 0.17, y = base + ((mTop(u) + mBot(u)) / 2) * H;
        hellBlob(n, new HV(u * mL, y + 0.05 * H, sd * (mW(u) / 2) * H * 0.98), V(0.035, 0.035, 0.015), 6, PART.BODY, C.spot, { rough: 0.5, coat: 0.2, sheen: 0 });
        if (ms.queen) {
          const uq = 0.56, yq = base + mTop(uq) * H * 0.82;
          hellBlob(n, new HV(uq * mL, yq, sd * (mW(uq) / 2) * H * 0.9), V(0.09, 0.045, 0.02), 8, PART.BODY, C.scar, { rough: 0.55, coat: 0.2, sheen: 0 });
        }
      }
    }
  }
  // ---------- neck + head ----------
  const hd = i.head, w = new HV(mL + i.neck * H, base + i.neckY * H, 0), th = hd.tilt;
  hellTube(n, [new HV(mL - 0.06 * H, base + (mTop(0.96) * 0.55 + 0.1) * H, 0), w.clone().add(V(0.02, 0))], [0.12 * H, 0.09 * H], S(8, 6, 4), PART.BODY, () => C.body, lk.body, false, true, 1, 0, REGION.MESO);
  const HM = new THREE.Matrix4().compose(w, new HQ().setFromAxisAngle(new HV(0, 0, 1), th), new HV(1, 1, 1));
  const hq = new HQ().setFromAxisAngle(new HV(0, 0, 1), th);
  const toB = (x, y, z) => new HV(x, y, z).applyMatrix4(HM);
  // wedge profile: tall and rounded at the back, tapering to a short vertical face
  const hTop = (s) => hd.h * (0.5 - (hd.topDrop ?? 0.22) * ss(0.3, 1, s));
  const hBot = (s) => hd.h * (-0.5 + (hd.botRise ?? 0.12) * ss(0.15, 1, s));
  const hRy = (s) => (hTop(s) - hBot(s)) / 2;
  const hCy = (s) => (hTop(s) + hBot(s)) / 2;
  const hRz = (s) => hd.w * (0.2 + 0.18 * ss(0, 0.22, s) - 0.08 * ss(0.3, 1, s));
  const taper = (s) => Math.max(0.2, Math.pow(Math.min(1, s / 0.12), 0.42) * Math.pow(Math.min(1, (1 - s) / 0.04), 0.28));
  {
    const secs = [], R = S(16, 9, 6);
    for (let k = 0; k < R; k++) {
      const s = k / (R - 1), tp = taper(s);
      secs.push({ x: s * H, y: hCy(s) * H, ry: hRy(s) * H * tp, rz: hRz(s) * H * tp, n: 2.3 });
    }
    const notch = (hd.notch ?? 0.12) * H;
    hellLoft(n, secs, S(16, 9, 6), PART.HEAD, (s, d) => shade(d * 0.9 + 0.15 * (s - 0.5), C.headDark ?? C.bodyDark, C.bodyLight, C.head ?? C.body), lk.body, (x, y, z, s) => {
      // heart-shaped from above: two rounded lobes at the back with a notch on the midline
      const rz = hRz(s) * H * taper(s), Y = Math.min(1, Math.abs(z) / Math.max(1e-6, rz));
      const dors = Math.max(0, (y - hCy(s) * H) / Math.max(1e-6, hRy(s) * H));
      return [x + notch * Math.pow(1 - Y, 2) * Math.pow(Math.max(0, 1 - s * 2.2), 2) * (0.4 + 0.6 * dors), y, z];
    }, HM, REGION.HEAD);
  }
  if (o) {
    // (realism rework) sparse erect setae: the head's crown and the mesosoma's back, leaning back
    for (let k = 0; k < 8; k++) {
      const s = rnd.range(0.2, 0.75), zf = rnd.range(-0.6, 0.6);
      const root = toB(s * H, (hCy(s) + hRy(s) * taper(s) * Math.sqrt(1 - zf * zf) * 0.97) * H, zf * hRz(s) * H * taper(s));
      hellSeta(n, root, new HV(-0.5, 1, zf * 0.6).applyQuaternion(hq).normalize(), rnd.range(0.1, 0.17) * H, 0.006 * H, PART.HEAD, C.hair, lk.hair, new HV(-0.2, 0, 0));
    }
    for (let k = 0; k < 12; k++) {
      const u = rnd.range(0.12, 0.92), zf = rnd.range(-0.55, 0.55), y = base + mTop(u) * H * (0.98 - 0.25 * zf * zf);
      hellSeta(n, new HV(u * mL, y, zf * (mW(u) / 2) * H), new HV(-0.45, 1, zf * 0.7).normalize(), rnd.range(0.1, 0.18) * H, 0.006 * H, PART.BODY, C.hair, lk.hair, new HV(-0.2, 0, 0));
    }
  }
  const face = 0.985, faceTop = hCy(face) + hRy(face) * 0.92 * taper(face), faceBot = hCy(face) - hRy(face) * 0.88 * taper(face);
  const hornBase = toB(0.94 * H, (hCy(0.94) + hRy(0.94) * taper(0.94) * 0.9) * H, 0);
  const hingeL = (sd) => toB(0.95 * H, faceBot * H + 0.02 * H, sd * i.mandible.hingeZ * H);
  const sockL = (sd) => toB(0.82 * H, (hCy(0.82) + hRy(0.82) * taper(0.82) * 0.86) * H, sd * 0.14 * H);
  // eyes: smooth, glossy, near-black; surfW 3 = subtle facet normal map only up close
  if (true) {
    const es = i.eyes, s = es.pos;
    for (const sd of [-1, 1]) {
      const c = toB(s * H, (hCy(s) + hRy(s) * es.up) * H, sd * hRz(s) * H * 0.84);
      hellBlob(n, c, V(es.len, es.ht, 0.08), S(14, 8, 6), PART.HEAD, C.eye, { rough: 0.12, coat: 1, sheen: 0 }, hq, 3);
    }
  }
  // ---------- horn (clypeal process) ----------
  const hn = i.horn, hornPts = hellSpline(hn.pts.map(([f, u]) => hornBase.clone().add(V(f, u))), S(20, 9, 5));
  const hornTan = hornPts.map((p, k) => hornPts[Math.min(hornPts.length - 1, k + 1)].clone().sub(hornPts[Math.max(0, k - 1)]).normalize());
  const hornR = hornPts.map((_, k) => { const s = k / (hornPts.length - 1); return H * (hn.r0 + (hn.r1 - hn.r0) * ss(0, 0.6, s) + (hn.r2 - hn.r1) * ss(0.6, 1, s)); });
  const hornCol = (s) => hellMix(C.hornBase, C.hornTip, ss(0.15, 1, s));
  hellTube(n, hornPts, hornR, S(9, 6, 4), PART.HEAD, (s) => hornCol(s), lk.horn, false, false, hn.flat ?? 0.8, 0, REGION.MANDIBLE);
  const tipP = hornPts[hornPts.length - 1], tipT = hornTan[hornTan.length - 1], tq = new HQ().setFromUnitVectors(new HV(1, 0, 0), tipT);
  let hornTip = tipP.clone();
  {
    const c = tipP.clone().addScaledVector(tipT, hn.tipLen * H * 0.35);
    hellBlob(n, c, V(hn.tipLen * 0.62, hn.tipThick, hn.tipW), S(14, 8, 6), PART.HEAD, hn.tip === "paddle" ? C.hornTip : hornCol(1), lk.horn, tq, 0, REGION.MANDIBLE);
    hornTip = c.clone().addScaledVector(tipT, hn.tipLen * H * 0.62);
    if (hn.tip === "paddle") {
      // hard blunt point on the flattened paddle (dense, reinforced core shown dark and glossy)
      const a = c.clone().addScaledVector(tipT, hn.tipLen * H * 0.3), b = c.clone().addScaledVector(tipT, hn.tipLen * H * 1.0).add(new HV(tipT.y, -tipT.x, 0).multiplyScalar(hn.hook * H));
      hellTube(n, [a, a.clone().lerp(b, 0.55), b], [hn.tipW * H * 0.75, hn.tipW * H * 0.4, 0.01 * H], S(8, 6, 4), PART.HEAD, () => C.hornTip, lk.hornTip, false, true, (hn.tipThick / hn.tipW) * 1.3, 0, REGION.MANDIBLE);
      hornTip = b.clone();
    }
    hellBlob(n, hornPts[1], V(hn.r0 * 1.6, hn.r0 * 1.3, hn.r0 * 1.5), S(10, 6, 0) || 4, PART.HEAD, C.hornBase, lk.horn, new HQ().setFromUnitVectors(new HV(1, 0, 0), hornTan[1]), 0, REGION.HEAD);
  }
  // fringe of long fine pale hairs along the horn's front (inner) edge, facing the mandibles
  if (lod < 2 && hn.fringe) {
    const fr = hn.fringe, roots = [], tips = [];
    const count = S(fr.count, 10, 0);
    for (let k = 0; k < count; k++) {
      // (review round 1: "a white toothbrush comb" — the setae now irregular in spacing, length and lean)
      const jit = o ? rnd.range(-0.45, 0.45) / Math.max(1, count - 1) : 0;
      const s = Math.min(fr.to, Math.max(fr.from, fr.from + (fr.to - fr.from) * (k / Math.max(1, count - 1)) + jit)), kk = Math.round(s * (hornPts.length - 1));
      const p = hornPts[kk], tn = hornTan[kk], under = new HV(tn.y, -tn.x, 0), len = H * fr.len * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, (s - fr.from) / (fr.to - fr.from) * 0.9 + 0.1))) * (o ? rnd.range(0.6, 1.1) : 1);
      const dir = under.clone().multiplyScalar(0.75).add(new HV(0, -0.55, 0)).addScaledVector(tn, o ? rnd.range(-0.35, 0.25) : 0).normalize();
      roots.push(p.clone().addScaledVector(under, hornR[kk] * 0.85)); tips.push(roots[k].clone().addScaledVector(dir, len));
    }
    if (o) for (let k = 0; k < count; k++) for (const sd of [-1, 1]) {
      if (rnd.range(0, 1) < 0.3) continue; // gaps: some setae missing on each side
      const r = roots[k].clone().add(new HV(0, 0, sd * hornR[0] * rnd.range(0.15, 0.5))), tp = tips[k].clone().add(new HV(rnd.range(-0.05, 0.05) * H, rnd.range(-0.05, 0.04) * H, sd * rnd.range(0.01, 0.07) * H));
      n.hair([r, r.clone().lerp(tp, 0.5).add(new HV(rnd.range(-0.02, 0.02) * H, -rnd.range(0.01, 0.05) * H, 0)), tp], [0.0055 * H, 0.0035 * H, 0.0008 * H], 3, PART.HEAD, C.fringe ?? C.hair, lk.hair);
    }
    else for (let k = 0; k < count; k++) hellHair(n, roots[k], roots[k].clone().lerp(tips[k], 0.85), 0.012 * H, PART.HEAD, C.hair, lk.hair);
    // (No spicules on the spoon tip: the user asked for a clean tip, 2026-10-24.)
  }
  // trigger hairs: long whisker-like bristles projecting forward from the face
  if (o && i.trigger) {
    const tg = i.trigger;
    for (let k = 0; k < tg.count; k++) {
      const sd = k % 2 === 0 ? -1 : 1, j = Math.floor(k / 2), s = 0.9;
      const root = toB(s * H, (hCy(s) + hRy(s) * (0.45 - 0.35 * j)) * H, sd * hRz(s) * H * 0.45);
      const ang = tg.ang - j * 0.12, dir = new HV(Math.cos(ang), Math.sin(ang), sd * 0.12).normalize();
      // (realism rework: stiff, dark at the socket, thinning to a fine pale tip)
      hellSeta(n, root, dir, tg.len * H * (1 - 0.12 * j), 0.013 * H, PART.HEAD, C.trigger ?? C.hair, lk.hair, new HV(0, 0.08, 0));
    }
  }
  // ---------- mandibles (scythes hinged at the bottom of the head) ----------
  const md = i.mandible, mandTips = [], hingePts = [];
  let closeAng = 0;
  {
    // Rest-pose shape (matches reference 4), then rotate up about the hinge until the tips
    // meet the horn underside: that rotated shape is the closed pose (mOpen = 0).
    const h0 = hingeL(1), restTip = h0.clone().add(V(md.pts[md.pts.length - 1][0], md.pts[md.pts.length - 1][1]));
    const rot = (p, a) => { const d = p.clone().sub(h0), c = Math.cos(a), s = Math.sin(a); return new HV(h0.x + d.x * c - d.y * s, h0.y + d.x * s + d.y * c, p.z); };
    const distToHorn = (p) => { let best = 1e9; for (let k = 0; k < hornPts.length; k++) best = Math.min(best, Math.hypot(p.x - hornPts[k].x, p.y - hornPts[k].y) - hornR[k]); return best; };
    let best = { a: 0, d: 1e9 };
    for (let a = 0; a <= 1.4; a += 0.005) {
      const d = distToHorn(rot(restTip, a));
      if (d < best.d) best = { a, d };
      if (d <= 0.025 * H) { best = { a, d }; break; }
    }
    closeAng = best.a;
    for (const sd of [-1, 1]) {
      const h = hingeL(sd), part = sd < 0 ? PART.MAND_L : PART.MAND_R;
      const ctrl = md.pts.map(([f, u], k) => { const z = sd * H * (md.hingeZ + (md.tipZ - md.hingeZ) * (k / (md.pts.length - 1))); return new HV(h.x + f * H, h.y + u * H, z); });
      let pts = hellSpline(ctrl, S(22, 10, 6));
      pts = pts.map((p) => { const d = p.clone().sub(h), c = Math.cos(closeAng), s = Math.sin(closeAng); return new HV(h.x + d.x * c - d.y * s, h.y + d.x * s + d.y * c, p.z); });
      const N = pts.length, rad = pts.map((_, k) => { const s = k / (N - 1); return H * (md.r * (1 + 0.45 * Math.exp(-((s - 0.13) ** 2) / 0.004) - 0.72 * ss(0.5, 1, s)) + 0.008); });
      // (realism rework: dark reddish-brown jaws, near black toward the tips, so they read against the body)
      const mc = C.mand ?? C.leg, mt = C.mandTip ?? C.legDark;
      hellTube(n, pts, rad, S(7, 5, 3), part, (s) => hellMix(mc, mt, ss(0.45, 1, s)), lk.mandible, true, true, md.depth, 0, REGION.MANDIBLE);
      if (lod < 2) {
        // small triangular process at the bend
        const k = Math.round(0.13 * (N - 1)), tn = pts[k + 1].clone().sub(pts[k - 1]).normalize(), out = new HV(tn.y, -tn.x, 0);
        hellTube(n, [pts[k], pts[k].clone().addScaledVector(out, md.r * 1.6 * H).addScaledVector(tn, -md.r * 1.2 * H)], [rad[k] * 0.8, 0.006 * H], S(5, 4, 3), part, () => C.mand ?? C.leg, lk.mandible, false, true, 1, 0, REGION.MANDIBLE);
      }
      const nT = S(md.teeth ?? 0, Math.min(2, md.teeth ?? 0), 0);
      for (let q = 0; q < nT; q++) {
        const s = md.teethFrom + (md.teethTo - md.teethFrom) * (nT === 1 ? 0.5 : q / (nT - 1)), k = Math.min(N - 2, Math.max(1, Math.round(s * (N - 1))));
        const tn = pts[k + 1].clone().sub(pts[k - 1]).normalize(), inner = new HV(-tn.y, tn.x, 0);
        const root = pts[k].clone().addScaledVector(inner, rad[k] * md.depth * 0.7);
        hellTube(n, [root, root.clone().addScaledVector(inner, md.tooth * H).addScaledVector(tn, md.tooth * 0.5 * H)], [rad[k] * 0.6, 0.004 * H], S(5, 4, 3), part, () => C.mandTip ?? C.legDark, lk.mandible, false, true, 1, 0, REGION.MANDIBLE);
      }
      mandTips.push(pts[N - 1]); hingePts.push(h);
    }
  }
  // ---------- antennae: 12 segments — a long club-ended scape, then an 11-segment funiculus in one even curve ----------
  // (realism rework, hell-ant.md §7: the pedicel short, segments 2–10 equal, the apical one longer; each segment narrow
  // at its base and full along its length, so the chain reads as jointed; curved through a spline, never kinked)
  const an = i.antenna, elbows = [], sockets = [];
  const segLen = [0.6, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.2], segTot = segLen.reduce((x, y) => x + y, 0);
  const segAt = (s) => { let acc = 0; for (let q = 0; q < segLen.length; q++) { const b = acc + segLen[q] / segTot; if (s <= b || q === segLen.length - 1) return [q, (s - acc) / (segLen[q] / segTot)]; acc = b; } return [10, 1]; };
  for (const sd of [-1, 1]) {
    const sk = sockL(sd), sDir = new HV(Math.cos(an.scapeAng), Math.sin(an.scapeAng), sd * an.splay).normalize();
    const el = sk.clone().addScaledVector(sDir, an.scape * H);
    {
      // the scape: thin at its base (the radicle), widening into a club at the elbow, bowed a little outward
      const m = S(10, 5, 3), sp = [], sr = [];
      const bow = new HV(0, 0, sd * 0.05 * H).add(new HV(-sDir.y, sDir.x, 0).multiplyScalar(0.04 * H));
      for (let k = 0; k <= m; k++) { const s = k / m; sp.push(sk.clone().lerp(el, s).addScaledVector(bow, Math.sin(Math.PI * s))); sr.push(an.r * H * (0.8 + 0.55 * ss(0.15, 1, s)) * (k === 0 ? 0.85 : 1)); }
      hellTube(n, sp, sr, S(10, 4, 3), sd < 0 ? PART.SCAPE_L : PART.SCAPE_R, (s) => hellMix(C.legDark, hellMix(C.leg, C.legLight, 0.35 + 0.4 * s), ss(0, 0.12, s) * ss(1, 0.9, s)), lk.leg, true, true, 1, 0, REGION.ANTENNA);
    }
    // the funiculus' path: the old arc, sampled coarsely and run through a spline (smooth curvature)
    const ctrl = [];
    {
      let p = el.clone();
      const a0 = an.scapeAng + an.funiStart, K = 8;
      for (let k = 0; k <= K; k++) {
        const s = k / K, a = a0 + an.funiBend * Math.pow(s, 1.1);
        ctrl.push(p.clone());
        p = p.clone().add(new HV(Math.cos(a), Math.sin(a), sd * an.splay * 0.6).normalize().multiplyScalar((an.funi * H) / K));
      }
    }
    const M = S(77, 22, 8), pts = hellSpline(ctrl, M), rad = [];
    for (let k = 0; k <= M; k++) {
      const s = k / M, [, fr] = segAt(s);
      const neck = o ? 0.74 + 0.26 * ss(0, 0.28, fr) : 1;
      rad.push(an.r * H * (0.82 + 0.12 * s) * neck);
    }
    const colAt = (s) => { const [, fr] = segAt(s); return hellMix(C.legDark, hellMix(C.leg, C.legLight, 0.3 + 0.5 * Math.sin(Math.PI * fr)), ss(0, 0.3, fr) * 0.9 + 0.1); };
    hellTube(n, pts, rad, S(9, 4, 3), sd < 0 ? PART.FUNI_L : PART.FUNI_R, colAt, lk.leg, true, true, 1, 0, REGION.ANTENNA);
    if (o) {
      // fine short setae standing off the funiculus (pubescent antennae)
      for (let k = 0; k < 14; k++) {
        const s = 0.08 + 0.9 * (k / 13), q = Math.round(s * M), tn = pts[Math.min(M, q + 1)].clone().sub(pts[Math.max(0, q - 1)]).normalize();
        const out = new HV(rnd.range(-1, 1), rnd.range(-1, 1), rnd.range(-1, 1)).cross(tn).normalize();
        hellSeta(n, pts[q].clone().addScaledVector(out, rad[q] * 0.9), out.clone().multiplyScalar(0.6).addScaledVector(tn, 0.8).normalize(), 0.07 * H, 0.004 * H, sd < 0 ? PART.FUNI_L : PART.FUNI_R, C.hair, lk.hair);
      }
    }
    elbows.push(el); sockets.push(sk);
  }
  // ---------- petiole: one narrow stalk with a single low node ----------
  const wp = new HV(0, base + 0.22 * H, 0), gp = new HV(-i.petiole * H, base + 0.26 * H, 0);
  {
    const pc = { rough: lk.body.rough, coat: lk.body.coat, sheen: lk.body.sheen };
    hellTube(n, [wp.clone().add(V(0.05, 0)), wp.clone().lerp(gp, 0.5).add(V(0, 0.02)), gp.clone().add(V(-0.04, 0))], [0.075 * H, 0.065 * H, 0.08 * H], S(8, 5, 4), PART.WAIST, () => C.body, pc, false, false, 1, 0, REGION.WAIST);
    const nc = wp.clone().lerp(gp, 0.55).add(V(0, i.node.h * 0.45));
    hellBlob(n, nc, V(0.11, i.node.h * 0.55, 0.12), S(10, 6, 4), PART.WAIST, C.body, pc, new HQ().setFromAxisAngle(new HV(0, 0, 1), 0.15), 0, REGION.WAIST);
    if (o) hellBlob(n, wp.clone().lerp(gp, 0.4).add(V(0, -0.07)), V(0.05, 0.035, 0.03), 6, PART.WAIST, C.bodyLight, pc);
  }
  // ---------- gaster: smooth oval, deep first constriction, faint bands, stinger ----------
  const ga = i.gaster, gL = ga.len * H;
  let gTip;
  {
    const ax = new HV(-Math.cos(ga.tilt), -Math.sin(ga.tilt), 0), R = S(20, 11, 7), secs = [];
    const prof = (s) => {
      let r = Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.05)), 0.62) * (1 - 0.22 * ss(0.78, 1, s));
      r *= 0.3 + 0.7 * Math.pow(Math.min(1, s / 0.07), 0.5);
      r *= 1 - ga.constrict * Math.exp(-((s - ga.at) ** 2) / 0.0012);
      if (o) for (const b of [0.52, 0.69, 0.83]) r *= 1 - 0.022 * Math.exp(-((s - b) ** 2) / 4e-4);
      return r;
    };
    for (let k = 0; k < R; k++) {
      const s = k / (R - 1), r = prof(s), c = gp.clone().addScaledVector(ax, s * gL);
      secs.push({ x: c.x, y: c.y + r * ga.h * H * 0.06, ry: (ga.h / 2) * H * r, rz: (ga.w / 2) * H * r, n: 2.1 });
    }
    hellLoft(n, secs, S(14, 8, 5), PART.GASTER, (s, d) => {
      let c = hellMix(shade(d * 0.8), shade(d * 0.8, C.gasterRearDark, C.gasterRear, C.gasterRear), ss(0.22, 0.85, s));
      for (const b of [ga.at + 0.03, 0.535, 0.705, 0.845]) c = hellMix(c, C.band, 0.15 * Math.exp(-((s - b) ** 2) / 1.5e-4));
      return c;
    }, lk.body, undefined, undefined, REGION.GASTER);
    gTip = gp.clone().addScaledVector(ax, gL * 0.99);
    const st0 = gTip.clone().addScaledVector(ax, -0.04 * H), st1 = gTip.clone().addScaledVector(ax, 0.12 * H).add(V(0, 0.015)), st2 = gTip.clone().addScaledVector(ax, 0.2 * H).add(V(0, 0.05));
    const [sp, si] = tube([st0, st1, st2], [0.03 * H, 0.016 * H, 0.004 * H], S(5, 4, 3), false, true);
    n.piece(sp, si, PART.GASTER, () => tmpC.copy(C.legDark), { rough: 0.3, coat: 0.5, sheen: 0 }, 2);
    if (o) for (let k = 0; k < 18; k++) {
      // sparse fine pale hairs on the gaster tip and underside
      const s = rnd.range(0.55, 0.97), a = rnd.range(-Math.PI * 0.95, -Math.PI * 0.05) + (k % 3 === 0 ? Math.PI * 0.8 : 0), r = prof(s);
      const c = gp.clone().addScaledVector(ax, s * gL), root = c.clone().add(new HV(0, Math.sin(a) * (ga.h / 2) * H * r * 0.97, Math.cos(a) * (ga.w / 2) * H * r * 0.97));
      const dir = new HV(-0.35, Math.sin(a), Math.cos(a)).normalize();
      hellSeta(n, root, dir, rnd.range(0.07, 0.14) * H, 0.006 * H, PART.GASTER, C.hair, lk.hair, new HV(-0.2, 0, 0));
    }
    // (realism rework) sparse erect setae over the gaster's back and sides, leaning back
    if (o) for (let k = 0; k < 16; k++) {
      const s = rnd.range(0.32, 0.9), a = rnd.range(0.15, Math.PI - 0.15), r = prof(s);
      const c = gp.clone().addScaledVector(ax, s * gL), root = c.clone().add(new HV(0, Math.sin(a) * (ga.h / 2) * H * r * 0.98, Math.cos(a) * (ga.w / 2) * H * r * 0.98));
      hellSeta(n, root, new HV(-0.55, Math.sin(a), Math.cos(a) * 0.8).normalize(), rnd.range(0.09, 0.16) * H, 0.006 * H, PART.GASTER, C.hair, lk.hair, new HV(-0.25, 0, 0));
    }
  }
  // ---------- legs: under a raised body; club-shaped femur, slim tibia, soft knee, five tarsomeres and claws ----------
  // (realism rework, hell-ant.md §7: the femur thickest at 0.3 of its length, the tibia 0.55× that and widening at the
  // apex, spurs 1-2-2, each tarsomere widening to its tip with a narrow joint; a soft pale membrane at the knee)
  const lg = i.legs, rig = { coxa: [], knee: [], ankle: [], axis: [], foot: [] };
  let reach = 0;
  const legCol = (s) => hellMix(C.legDark, hellMix(C.leg, C.legLight, Math.sin(Math.PI * s) * 0.6), ss(0, 0.12, s) * ss(1, 0.9, s));
  const knLook = { rough: 0.55, coat: 0.15, sheen: 0.1 };
  for (let li = 0; li < 6; li++) {
    const pair = Math.floor(li / 2), sd = li % 2 === 0 ? -1 : 1, P = lg.pairs[pair];
    const c0 = new HV(P.cx * mL, base + 0.07 * H, sd * ms.w * 0.26 * H);
    const c1 = c0.clone().addScaledVector(new HV(P.coxaDir[0], P.coxaDir[1], sd * P.coxaDir[2]).normalize(), P.coxa * H);
    const foot = new HV(c0.x + P.foot[0] * H, 0, sd * P.foot[1] * H);
    const hz = foot.clone().sub(c1).setY(0).normalize(), phi = 0.42;
    const ankle = foot.clone().addScaledVector(hz, -P.tarsus * H * Math.cos(phi)).add(new HV(0, P.tarsus * H * Math.sin(phi), 0));
    const Fm = P.femur * H, Tb = P.tibia * H, D = Math.min(Fm + Tb - 1e-4, ankle.distanceTo(c1));
    const along = ankle.clone().sub(c1).normalize(), perp = UP.clone().sub(along.clone().multiplyScalar(UP.dot(along))).normalize();
    const ca = Math.max(-1, Math.min(1, (Fm * Fm + D * D - Tb * Tb) / (2 * Fm * D))), knee = c1.clone().addScaledVector(along, Fm * ca).addScaledVector(perp, Fm * Math.sqrt(1 - ca * ca));
    const axis = new HV().crossVectors(hz, UP).normalize();
    rig.coxa.push(c0.clone()); rig.knee.push(knee.clone()); rig.ankle.push(ankle.clone()); rig.axis.push(axis); rig.foot.push(foot.clone());
    reach += Math.hypot(foot.x - c0.x, foot.z - c0.z);
    const p0 = PART.LEG0 + li * 3, th0 = lg.thick * H;
    // seg 0: coxa, trochanter, femur
    hellTube(n, [c0, c0.clone().lerp(c1, 0.5), c1], [th0 * 1.5, th0 * 1.45, th0 * 1.15], S(12, 4, 3), p0, () => C.leg, lk.leg, lod < 2, false, 1, 0, REGION.LEG);
    // (review round 1: "ball joints" — the trochanter flush with the femur, no knob)
    if (lod < 2) hellBlob(n, c1, V(0.05, 0.045, 0.045), S(10, 4, 4), p0, C.leg, lk.leg, undefined, 0, REGION.LEG);
    {
      const m = S(11, 4, 2), pts = [], rr = [];
      for (let k = 0; k <= m; k++) { const s = k / m; pts.push(c1.clone().lerp(knee, s)); rr.push(th0 * (0.95 + 0.62 * Math.exp(-((s - 0.32) ** 2) / 0.06) - 0.27 * s)); }
      hellTube(n, pts, rr, S(12, 4, 3), p0, legCol, lk.leg, false, true, 1, 0, REGION.LEG);
      if (o) for (let k = 0; k < 3; k++) {
        // erect setae on the femur's underside
        const s = 0.25 + 0.25 * k, q = Math.round(s * m), r = pts[q].clone().add(new HV(0, -rr[q] * 0.9, 0));
        hellSeta(n, r, new HV(0, -1, 0).addScaledVector(knee.clone().sub(c1).normalize(), 0.9).normalize(), 0.07 * H, 0.004 * H, p0, C.hair, lk.hair);
      }
    }
    // the knee: a soft, paler joint membrane (it moves with the tibia)
    if (lod < 2) hellBlob(n, knee, V(0.03, 0.03, 0.03), S(10, 4, 4), p0 + 1, hellMix(C.leg, C.legLight, 0.35), knLook, undefined, 0, REGION.LEG);
    // seg 1: tibia, slim, widening at the apex, with its spurs (1 on the fore leg, 2 on the mid and hind)
    {
      const m = S(7, 2, 1), pts = [], rr = [];
      for (let k = 0; k <= m; k++) { const s = k / m; pts.push(knee.clone().lerp(ankle, s)); rr.push(th0 * (0.6 + 0.14 * ss(0.65, 1, s) - 0.06 * ss(0, 0.2, s))); }
      hellTube(n, pts, rr, S(10, 4, 3), p0 + 1, legCol, lk.leg, lod < 2, true, 1, 0, REGION.LEG);
      if (o) {
        const tdir = ankle.clone().sub(knee).normalize();
        for (let q = 0; q < (pair === 0 ? 1 : 2); q++) {
          const sp = ankle.clone().lerp(knee, 0.04).addScaledVector(axis, (q === 0 ? 1 : -1) * sd * 0.015 * H);
          n.hair([sp, sp.clone().addScaledVector(tdir, (pair === 0 ? 0.12 : 0.08) * H).add(V(0, -0.02)), sp.clone().addScaledVector(tdir, (pair === 0 ? 0.17 : 0.12) * H).add(V(0, -0.05)).addScaledVector(axis, (q === 0 ? 1 : -1) * sd * 0.02 * H)], [th0 * 0.32, th0 * 0.2, th0 * 0.05], 3, p0 + 1, C.legDark, lk.leg);
        }
        for (let k = 0; k < 4; k++) {
          const s = 0.2 + 0.18 * k, r = knee.clone().lerp(ankle, s).add(new HV(0, -th0 * 0.55, 0));
          hellSeta(n, r, new HV(0, -0.6, 0).addScaledVector(tdir, 1).addScaledVector(axis, sd * 0.3).normalize(), 0.06 * H, 0.0035 * H, p0 + 1, C.hair, lk.hair);
        }
      }
    }
    // seg 2: five tarsomeres (each a little cone with a narrow joint) and two claws
    {
      const fracs = [0.34, 0.18, 0.15, 0.13, 0.2], pts = [ankle.clone()], rr = [th0 * 0.5];
      if (lod === 0) {
        let acc = 0;
        for (let q = 0; q < 5; q++) {
          const a = acc, b = acc + fracs[q];
          for (const f of [0.06, 0.5, 0.92, 1]) { const s = a + (b - a) * f; pts.push(ankle.clone().lerp(foot, s).add(V(0, -0.04 * Math.sin(Math.PI * s)))); rr.push(th0 * (0.34 + 0.16 * f) * (1 - 0.3 * s) * (f === 1 ? 0.72 : 1)); }
          acc = b;
        }
      } else { pts.push(ankle.clone().lerp(foot, 0.5)); rr.push(th0 * 0.45); pts.push(foot.clone()); rr.push(th0 * 0.35); }
      hellTube(n, pts, rr, S(8, 3, 3), p0 + 2, (s) => hellMix(C.leg, C.legLight, Math.sin(Math.PI * ((s * 5) % 1)) * 0.45), lk.leg, false, true, 1, 0, REGION.TARSUS);
      if (o) for (const cs of [-1, 1]) {
        const a = foot.clone().addScaledVector(axis, cs * th0 * 0.25), b = a.clone().addScaledVector(hz, 0.06 * H).add(V(0, -0.02)), c = b.clone().add(V(0, -0.05)).addScaledVector(hz, -0.01 * H);
        hellTube(n, [a, b, c], [th0 * 0.2, th0 * 0.13, th0 * 0.03], 3, p0 + 2, () => C.claw, { rough: 0.3, coat: 0.6, sheen: 0 }, false, true);
      }
    }
  }
  // ---------- rig ----------
  const geo = n.build();
  const headTipX = Math.max(mandTips[0].x, mandTips[1].x, hornTip.x, toB(H, faceBot * H, 0).x);
  const mouth = toB(0.98 * H, (faceBot + 0.08) * H, 0);
  // hold socket: where the closed mandible tips meet the horn underside
  let hk = 0, hd2 = 1e9;
  for (let k = 0; k < hornPts.length; k++) { const d = hornPts[k].distanceTo(new HV(mandTips[1].x, mandTips[1].y, 0)); if (d < hd2) { hd2 = d; hk = k; } }
  const hold = new HV((mandTips[0].x + mandTips[1].x) / 2, (mandTips[0].y + mandTips[1].y) / 2, 0);
  const holdDir = new HV(hornTan[hk].y, -hornTan[hk].x, 0);
  const out = {
    ...rig, neck: w.clone(), mandL: hingePts[0].clone(), mandR: hingePts[1].clone(), antL: sockets[0].clone(), antR: sockets[1].clone(), elbL: elbows[0].clone(), elbR: elbows[1].clone(),
    gasterPivot: gp.clone(), waistPivot: wp.clone(), length: 0, stride: 0, stance: base, q0: 0.34, headTip: new HV(headTipX, w.y, 0), gasterTip: gTip.clone(), mouth,
    mandVert: 1, mandSwing: closeAng + md.openExtra, mandRest: closeAng / (closeAng + md.openExtra), hold, holdDir, hornTip: hornTip.clone(), gaitLift: i.gait?.lift ?? 0.3, gaitDuty: i.gait?.duty ?? 0.55,
  };
  out.length = out.headTip.x - out.gasterTip.x;
  out.stride = (2 * out.q0 * (reach / 6)) / 0.55;
  const mid = (out.gasterTip.x + out.headTip.x) / 2;
  geo.translate(-mid, 0, 0);
  const sh = (v) => v.set(v.x - mid, v.y, v.z);
  out.coxa.forEach(sh), out.knee.forEach(sh), out.ankle.forEach(sh), out.foot.forEach(sh);
  [out.neck, out.mandL, out.mandR, out.antL, out.antR, out.elbL, out.elbR, out.gasterPivot, out.waistPivot, out.headTip, out.gasterTip, out.mouth, out.hold, out.hornTip].forEach(sh);
  geo.computeBoundingSphere();
  // (realism rework: the planted-feet animation — each foot's neutral place for the shader's leg IK)
  plantHomes(out);
  return { geometry: geo, rig: out };
}
// ===== END HELL ANT BUILDER =====

