// @ts-nocheck
/**
 * Nasute termite builder (Nasutitermes corniger) — realism round 3 (CHANGE_PLAN §22.7; the user's ratings G7, T1, T4:
 * "redo the termite models based on the reference images and give them dynamic and dramatic but realistic attacks
 * and movement like the ants"). The worker, the nasute soldier and the major are built here on the shared ant
 * builder's helpers, so they run on the ants' animation (planted feet, attack poses, hit reactions, deaths by cause);
 * the kings and queens (both termite species) stay on the termite kit.
 *
 * Shapes from the user's study photos (docs/creatures/nasutitermes.md §11): no waist — a broad thorax–abdomen joint;
 * a saddle-shaped pronotum; a soft ten-segment abdomen with pale intersegmental membranes and the dark gut showing
 * through; long, slender, splayed legs with four tarsomeres; straight beaded (moniliform) antennae. Workers: a domed
 * amber head with short crossing mandibles and the postclypeus bulge. Soldiers: a glossy dark pear-shaped head drawn
 * into the nasus, vestigial mandibles, six stiff setae.
 *
 * Sickle-jaw termites (Rhynchotermes perarmatus; model redo, claude/realism/10-spec-saiy-ant-sickle-jaw-models.md,
 * shapes in docs/creatures/rhynchotermes-perarmatus.md §10) use the same builder: the soldier's globe head drawn into a
 * long, down-curved snout (`head.nasus` + `head.sickle`) with long, thin crossing sickle mandibles traced from the
 * user's photos; the worker's round glossy head and its dark banded abdomen (`head.fontanelle`); the presoldier and
 * the larva. (Their king and queen stay on the termite kit, as the conehead royals do:
 * the user preferred the kit's queen, review round 1, 2026-11-07.)
 *
 * Returns the standard { geometry, rig } plus `nasusTip` (soldiers: the glue or the secretion comes from it) and `soft`.
 * Units: mm; the spec's numbers are fractions of the body length L. +x forward, +y up, +z right, feet on y = 0.
 */
import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { Acc, PART, tube, loft, ellipsoid, ss, tmpC, BuiltAnt, detOf, plantHomes } from './antGeometry';
import { REGION } from '../bake/detailBake';

const NV = THREE.Vector3, NQ = THREE.Quaternion, NC = THREE.Color;
const mix = (a, b, t) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));

function pieceRGB(n, pos, idx, part, cols, surf, flags = 0, det = undefined) {
  let k = 0;
  n.piece(pos, idx, part, () => tmpC.copy(cols[Math.min(k++, cols.length - 1)]), surf, flags, undefined, det);
}
function ttube(n, pts, radii, segs, part, colorAt, surf, capA = true, capB = true, flat = 1, reg = 0) {
  const [p, ix, meta] = tube(pts, radii, segs, capA, capB, flat), cols = [];
  for (let u = 0; u < pts.length; u++) for (let d = 0; d < segs; d++) cols.push(colorAt(u / (pts.length - 1), d / segs));
  if (capA) cols.push(colorAt(0, 0));
  if (capB) cols.push(colorAt(1, 0));
  pieceRGB(n, p, ix, part, cols, surf, 0, reg ? detOf(meta, reg) : undefined);
  return p;
}
function tloft(n, sections, segs, part, colorAt, surf, deform, reg = 0) {
  // colorAt(tAlong, dorsal [-1..1], lateral [-1..1], angle)
  const [p, ix, meta] = loft(sections, segs, deform);
  const cols = [], rings = sections.length;
  for (let h = 0; h < rings; h++) for (let d = 0; d < segs; d++) { const a = (d / segs) * Math.PI * 2; cols.push(colorAt(h / (rings - 1), Math.sin(a), Math.cos(a), a)); }
  cols.push(colorAt(0, 0, 0, 0), colorAt(1, 0, 0, 0));
  pieceRGB(n, p, ix, part, cols, surf, 0, reg ? detOf(meta, reg) : undefined);
}
function blob(n, c, rad, segs, part, col, surf, q, flags = 0, reg = 0) {
  const [p, ix, meta] = ellipsoid(c, rad, segs, q);
  n.piece(p, ix, part, () => tmpC.copy(col), surf, flags, undefined, reg ? detOf(meta, reg) : undefined);
}
function seta(n, root, dir, len, r0, part, col, look, bend = null) {
  const tip = root.clone().addScaledVector(dir, len);
  const mid = root.clone().lerp(tip, 0.55);
  if (bend) mid.addScaledVector(bend, len);
  n.hair([root, mid, tip], [r0, r0 * 0.6, r0 * 0.12], 3, part, col, look);
}
/** A smooth closed loop of rings along a centre line (the pear head, the nasus): rings perpendicular to the path. */
function pathLoft(n, path, rad, ry, segs, part, colorAt, surf, reg) {
  const pos = [], idx = [], cols = [], N = path.length;
  const up = new NV(0, 1, 0);
  for (let k = 0; k < N; k++) {
    const t = path[Math.min(N - 1, k + 1)].clone().sub(path[Math.max(0, k - 1)]).normalize();
    const side = new NV().crossVectors(t, up).normalize(), u2 = new NV().crossVectors(side, t).normalize();
    for (let d = 0; d < segs; d++) {
      const a = (d / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const p = path[k].clone().addScaledVector(side, c * rad[k]).addScaledVector(u2, s * ry[k]);
      pos.push(p.x, p.y, p.z);
      cols.push(colorAt(k / (N - 1), s, c));
    }
  }
  for (let k = 0; k < N - 1; k++) for (let d = 0; d < segs; d++) {
    const a = k * segs + d, b = k * segs + ((d + 1) % segs), c2 = a + segs, d2 = b + segs;
    idx.push(a, c2, b, b, c2, d2);
  }
  // caps
  const c0 = pos.length / 3; pos.push(path[0].x, path[0].y, path[0].z); cols.push(colorAt(0, 0, 0));
  const c1 = pos.length / 3; pos.push(path[N - 1].x, path[N - 1].y, path[N - 1].z); cols.push(colorAt(1, 0, 0));
  for (let d = 0; d < segs; d++) { idx.push(c0, d, (d + 1) % segs); idx.push(c1, (N - 1) * segs + ((d + 1) % segs), (N - 1) * segs + d); }
  pieceRGB(n, pos, idx, part, cols, surf, 0, undefined);
}

export function buildNasute(i: any, lod: number, seed = 1): BuiltAnt {
  const n = new Acc(), rnd = new Rng(seed * 131 + i.key.length * 11), o = lod === 0;
  const L = i.L, lk = i.look;
  const S = (a, b, c) => (lod === 0 ? a : lod === 1 ? b : c);
  const V = (x, y, z = 0) => new NV(x * L, y * L, z * L);
  const C = Object.fromEntries(Object.entries(lk.colors).map(([k, v]) => [k, new NC(v)]));
  const base = i.stance * L; // the body's underside above the ground
  const ab = i.abdomen, th = i.thorax, hd = i.head;
  const soldier = !!hd.nasus;

  // ---------- abdomen: ten soft tergites, pale membranes between, the gut showing through ----------
  // built from the thorax joint (s = 0) back to the tip (s = 1)
  const aFront = ab.x0 * L, aLen = ab.len * L;
  const aCy = base + ab.cy * L;
  const NT = 10;
  const terg = (s) => { const f = s * NT; const q = Math.min(NT - 1, Math.floor(f)); return [q, f - q]; };
  const aProf = (s) => {
    // a rounded rear, fullest at `ab.full`, narrowing a little to the thorax joint (`ab.front`, its width there: the
    // sickle-jaw termites' egg-shaped abdomens round down into a narrow joint, rising in a rounded curve, not a cone)
    const front = ab.front == null ? 0.62 + 0.38 * ss(0, ab.full, s) : ab.front + (1 - ab.front) * Math.sqrt(1 - (1 - Math.min(1, s / ab.full)) ** 2);
    const rear = Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (s - ab.full) / (1 - ab.full)), 2.4)), 0.5);
    let r = front * (s < ab.full ? 1 : rear);
    r = Math.max(r, 0.04);
    if (o || lod === 1) {
      const [q, fr] = terg(s);
      if (q > 0 || fr > 0.2) r *= 1 - ab.groove * Math.exp(-((fr - 0.02) ** 2) / 0.004) - ab.groove * Math.exp(-((fr - 1) ** 2) / 0.004);
    }
    return r;
  };
  const gutAt = (s, dors, lat) => {
    // two to three lobes with a lumpy edge, centred a little back (45-70 % of the abdomen)
    let g = 0;
    for (const [c, w, a] of ab.gutLobes) g = Math.max(g, a * Math.exp(-((s - c) ** 2) / w));
    g *= 0.85 + 0.15 * Math.sin(s * 37 + lat * 5 + dors * 3);
    // seen through the top and the sides, faint underneath
    return g * (0.7 + 0.3 * Math.max(0, dors * 0.6 + Math.abs(lat) * 0.5));
  };
  let gTip;
  {
    const R = S(44, 22, 10), secs = [];
    for (let k = 0; k < R; k++) {
      const s = k / (R - 1), r = aProf(s);
      const x = aFront - s * aLen;
      // the abdomen sags a little toward its rear
      secs.push({ x, y: aCy - ab.sag * L * s * s, ry: ab.h * 0.5 * L * r, rz: ab.w * 0.5 * L * r, n: 2.15 });
    }
    gTip = new NV(aFront - aLen, aCy - ab.sag * L, 0);
    tloft(n, secs, S(18, 10, 6), PART.GASTER, (s, d, lat) => {
      const [q, fr] = terg(s);
      // each tergite a little darker toward its rear margin; the membrane between them pale
      let c = d > 0 ? mix(C.abd, C.abdTop, d * 0.7) : mix(C.abd, C.abdUnder, -d * 0.8);
      // (`abdomen.band`: how strongly — the sickle-jaw soldier's bands are bold)
      c = mix(c, C.tergRear, (ab.band ?? 0.35) * ss(0.4, 0.95, fr) * Math.max(0, d * 0.8 + 0.3));
      const mem = Math.exp(-((fr - 0.0) ** 2) / 0.006) + Math.exp(-((fr - 1) ** 2) / 0.006);
      if (q > 0 || fr > 0.15) c = mix(c, C.membrane, ab.membrane * Math.min(1, mem));
      c = mix(c, C.gut, ab.gut * gutAt(s, d, lat));
      // the tip a little paler and more translucent
      return mix(c, C.abdUnder, 0.25 * ss(0.85, 1, s));
    }, lk.abdomen, undefined, REGION.GASTER);
    if (o) {
      // sparse long pale hairs at the tergites' rear margins (6-10 per tergite), lying back
      for (let q = 1; q < NT; q++) {
        const s = (q + 0.96) / NT;
        if (s > 0.99) continue;
        const r = aProf(s);
        const cnt = 4 + Math.floor(rnd.range(0, 3));
        for (let k = 0; k < cnt; k++) {
          const a = rnd.range(0.1, Math.PI - 0.1);
          const x = aFront - s * aLen, y = aCy - ab.sag * L * s * s;
          const root = new NV(x, y + Math.sin(a) * ab.h * 0.5 * L * r * 0.97, Math.cos(a) * ab.w * 0.5 * L * r * 0.97);
          seta(n, root, new NV(-0.9, Math.sin(a) * 0.45, Math.cos(a) * 0.4).normalize(), rnd.range(0.018, 0.032) * L, 0.0011 * L, PART.GASTER, C.hair, lk.hair, new NV(0, -0.12, 0));
        }
      }
    }
  }
  const gp = new NV(aFront + 0.01 * L, aCy, 0); // the gaster pivot: the thorax–abdomen joint (no waist)

  // ---------- thorax: meta- and mesothorax, the saddle-shaped pronotum ----------
  const tx0 = aFront - 0.015 * L; // the thorax starts just inside the abdomen's front
  const meta = { x: tx0, len: th.meta * L }, meso = { x: tx0 + th.meta * L, len: th.meso * L }, pro = { x: tx0 + (th.meta + th.meso) * L, len: th.pro * L };
  const tCy = base + th.cy * L;
  {
    const R = S(18, 10, 6), secs = [];
    const x0 = meta.x, x1 = pro.x;
    for (let k = 0; k < R; k++) {
      const u = k / (R - 1), x = x0 + u * (x1 - x0);
      // two short segments, each fuller in its middle
      const seg = u < th.meta / (th.meta + th.meso) ? u / (th.meta / (th.meta + th.meso)) : (u - th.meta / (th.meta + th.meso)) / (th.meso / (th.meta + th.meso));
      const bulge = 0.88 + 0.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, seg)));
      secs.push({ x, y: tCy, ry: th.h * 0.5 * L * bulge, rz: th.w * 0.5 * L * bulge, n: 2.3 });
    }
    tloft(n, secs, S(14, 8, 5), PART.BODY, (s, d) => (d > 0 ? mix(C.thorax, C.thoraxTop, d * 0.6) : mix(C.thorax, C.abdUnder, -d * 0.7)), lk.body, undefined, REGION.MESO);
    // the pronotum: a saddle — a wide flat plate, the front lobe turned up, the sides turned down
    const PR = S(14, 8, 5), ps = [];
    for (let k = 0; k < PR; k++) {
      const u = k / (PR - 1), x = pro.x - 0.01 * L + u * (pro.len + 0.01 * L);
      const w = th.proW * L * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
      ps.push({ x, y: tCy + 0.006 * L + th.proLift * L * ss(0.6, 1, u), ry: th.h * 0.45 * L * (0.9 + 0.1 * Math.sin(Math.PI * u)), rz: w * 0.5, n: 2.6 });
    }
    tloft(n, ps, S(16, 8, 5), PART.BODY, (s, d) => mix(d > 0 ? mix(C.thorax, C.pronotum, 0.7 + 0.3 * d) : C.thorax, C.thoraxTop, 0.15 * ss(0.8, 1, s)), lk.body, (x, y, z, t) => {
      // saddle: the sides drop away from the midline
      const zf = Math.abs(z) / (th.proW * 0.5 * L);
      return [x, y - th.saddle * L * zf * zf * (y > tCy ? 1 : 0), z];
    }, REGION.MESO);
    if (o) for (let k = 0; k < 14; k++) {
      // a few fine setae at the pronotum's margin and on the thorax
      const u = rnd.range(0.1, 0.95), zf = rnd.range(-0.9, 0.9), x = pro.x + u * pro.len;
      seta(n, new NV(x, tCy + th.h * 0.45 * L * Math.sqrt(1 - zf * zf) * 0.98, zf * th.proW * 0.5 * L * 0.95), new NV(-0.5, 1, zf * 0.6).normalize(), rnd.range(0.018, 0.03) * L, 0.001 * L, PART.BODY, C.hair, lk.hair, new NV(-0.15, 0, 0));
    }
  }
  const neck = new NV(pro.x + pro.len + hd.neck * L, tCy + hd.neckY * L, 0);
  {
    // the neck membrane: soft and pale
    const a = new NV(pro.x + pro.len - 0.01 * L, tCy + 0.004 * L, 0);
    ttube(n, [a, a.clone().lerp(neck, 0.5), neck.clone().add(V(0.015, 0))], [th.h * 0.33 * L, th.h * 0.28 * L, th.h * 0.3 * L], S(10, 6, 4), PART.BODY, () => mix(C.thorax, C.membrane, 0.4), lk.abdomen, false, false, 1, REGION.MESO);
  }

  // ---------- head (user note 2026-11-02 17:48: "redo the head geometry and mandibles based on the reference images") ----------
  const HM = new THREE.Matrix4().compose(neck, new NQ().setFromAxisAngle(new NV(0, 0, 1), hd.tilt), new NV(1, 1, 1));
  const hq = new NQ().setFromAxisAngle(new NV(0, 0, 1), hd.tilt);
  const toB = (x, y, z) => new NV(x, y, z).applyMatrix4(HM);
  const hL = hd.len * L, hW = hd.w * L, hH = hd.h * L;
  let mouth, headTipX, nasusTip = null, chin, jawTip;
  // (sickle-jaws: points along the left sickle, so the renderer's lowestPosed keeps the hooks off the ground — review
  // round 1, "fix jaws clipping on the ground")
  const sickPts = [];
  /** a point on the head's surface (soldiers: from the teardrop loft), for the antennal sockets */
  let headSurf = null;
  const hingeAt = [], tips = [], sockets = [], elbows = [];
  const headCol = (s, d) => (d > 0 ? mix(C.head, C.headTop, d * 0.65) : mix(C.head, C.headUnder, -d * 0.7));
  /** a loft in head space, written to the body through the head matrix */
  const headLoft = (secs, segs, colorAt, look, deform, reg) => {
    const [p, ix, meta] = loft(secs, segs, deform);
    const cols = [];
    for (let h = 0; h < secs.length; h++) for (let d = 0; d < segs; d++) { const a = (d / segs) * Math.PI * 2; cols.push(colorAt(h / (secs.length - 1), Math.sin(a), Math.cos(a))); }
    cols.push(colorAt(0, 0, 0), colorAt(1, 0, 0));
    const pw = [];
    for (let q = 0; q < p.length; q += 3) { const v = toB(p[q], p[q + 1], p[q + 2]); pw.push(v.x, v.y, v.z); }
    pieceRGB(n, pw, ix, PART.HEAD, cols, look, 0, reg ? detOf(meta, reg) : undefined);
  };
  if (!soldier) {
    // The worker (photos: the live workers and the worker-head close-up): a glossy, translucent amber capsule, round
    // and a little wider than long from above, the top flattened; it sits on the neck with its back overhanging the
    // pronotum. A darker brown band across the frons and down the midline (the epicranial suture and the muscles seen
    // through the cuticle). In front: the inflated, paler postclypeus, a pale tongue-shaped labrum over the jaws, and
    // stout dark-tipped mandibles crossing under it.
    const x0 = -0.32 * hL;
    // round behind, the sides nearly parallel, the front blunt (the face), not a point
    const R = S(24, 14, 8), secs = [];
    for (let k = 0; k < R; k++) {
      const s = k / (R - 1);
      const back = s < 0.38 ? Math.sqrt(Math.max(0.0025, 1 - ((0.38 - s) / 0.38) ** 2)) : 1;
      const front = s > 0.84 ? Math.sqrt(Math.max(0.0025, 1 - ((s - 0.84) / 0.16) ** 2)) : 1;
      // (`head.narrow`: how much the face narrows forward — the sickle-jaw worker's broad head hardly does;
      // `head.round`: the cross-section's squareness, 2 a true ellipse — the sickle-jaw worker's head is a round dome)
      const narrow = 1 - (hd.narrow ?? 0.38) * ss(0.42, 1, s);
      const env = back * front;
      secs.push({ x: x0 + s * hL, y: 0.2 * hH - 0.16 * hH * s * s, ry: hH * 0.5 * env * (1 - 0.18 * ss(0.55, 1, s)), rz: hW * 0.5 * env * narrow, n: hd.round ?? 2.4 });
    }
    // (`head.flat`: the top flattened this much — the sickle-jaw worker's head is flattened top to bottom)
    const flat = hd.flat ?? 0.88;
    headLoft(secs, S(20, 12, 7), (s, d, lat) => {
      let c = headCol(s, d);
      // the darker band: across the frons (s ~ 0.6) and down the midline toward the back, on top only
      const top = Math.max(0, d);
      const band = Math.exp(-((s - 0.6) ** 2) / 0.006) * (0.6 + 0.4 * Math.abs(lat)) + Math.exp(-(lat * lat) / 0.02) * ss(0.15, 0.6, s) * 0.8;
      c = mix(c, C.headBand, (hd.band ?? 1) * 0.75 * Math.min(1, band) * top);
      // the fontanelle: a whitish spot in the middle of the frons (the frontal gland's pore)
      if (hd.fontanelle) c = mix(c, C.fontanelle, top * Math.exp(-(((s - 0.55) / hd.fontanelle) ** 2 + (lat / (hd.fontanelle * 1.3)) ** 2) * 3));
      return c;
    }, lk.head, (x, y, z) => [x, y > 0.22 * hH ? 0.22 * hH + (y - 0.22 * hH) * flat : y, z], REGION.HEAD);
    // (user notes 17:48 / 17:59: "redo the head geometry and mandibles", "fix the mandibles especially and the head")
    // The face, front to back as in the worker-head photo: the postclypeus — a broad, swollen cushion across the front
    // of the head, a dark line down its middle; the thin pale anteclypeus; the labrum — a large rounded tongue lying
    // forward and down over the jaws; under it the mandibles, broad flat blades whose dark toothed tips cross below
    // the labrum's tip (the left over the right); the pale palps hanging below (five-segment maxillary, three-segment
    // labial).
    const F = x0 + hL; // the capsule's front
    // the postclypeus swells out of the face (most of it inside the capsule, so it reads as a swelling, not a disc)
    // (wide and low: a transverse cushion across the lower face)
    const pcC = toB(F - 0.06 * hL, -0.06 * hH, 0);
    blob(n, pcC, new NV(0.12 * hL, 0.16 * hH, 0.3 * hW), S(18, 10, 6), PART.HEAD, C.clypeus, lk.head, hq, 0, REGION.HEAD);
    if (lod < 2) ttube(n, [toB(F - 0.12 * hL, 0.12 * hH, 0), toB(F + 0.02 * hL, 0.08 * hH, 0), toB(F + 0.06 * hL, -0.08 * hH, 0)], [0.0018 * L, 0.002 * L, 0.0016 * L], 4, PART.HEAD, () => C.headBand, lk.head, false, false);
    // the labrum: a broad rounded lobe from under the postclypeus, lying forward and down over the jaws
    const lbQ = hq.clone().multiply(new NQ().setFromAxisAngle(new NV(0, 0, 1), -1.0));
    const lbC = toB(F + 0.02 * hL, -0.3 * hH, 0);
    blob(n, lbC, new NV(0.13 * hL, 0.035 * hH, 0.2 * hW), S(16, 8, 5), PART.HEAD, C.labrum, lk.abdomen, lbQ, 0, REGION.HEAD);
    const lb = [lbC.clone().add(new NV(0.15 * hL, 0, 0).applyQuaternion(lbQ))];
    // mandibles: flat blades (wide across, thin top to bottom), broad at the hinge, curving in to a hooked apical tooth
    // with two marginal teeth on the inner edge
    const md = i.mandible;
    for (const sd of [-1, 1]) {
      const part = sd < 0 ? PART.MAND_L : PART.MAND_R;
      const h = toB(F - 0.2 * hL, -0.34 * hH + (sd < 0 ? 0.012 * hH : 0), sd * hW * 0.3);
      const M = S(14, 7, 4), pts = [], rad = [];
      const lift = sd < 0 ? 0.01 * L : 0; // the left blade lies over the right where they cross
      for (let k = 0; k <= M; k++) {
        const s = k / M;
        // forward, then sweeping in across the midline
        const a = md.curve * Math.pow(s, 1.6);
        const q = new NV(md.len * L * (s * 0.92 - 0.08 * s * s), -0.012 * L * s + lift * ss(0.5, 1, s), -sd * (md.len * L * 0.7) * (Math.sin(a) / Math.sin(md.curve)) * ss(0, 1, s));
        pts.push(h.clone().add(q.applyQuaternion(hq)));
        // (user rating W2 "fix the mandibles": broad, robust blades, not thin hooks — wide to two thirds of the way)
        rad.push(L * md.r * (1.4 - 0.55 * ss(0.1, 0.65, s) - 0.7 * ss(0.65, 1, s)) + 0.0018 * L);
      }
      ttube(n, pts, rad, S(10, 6, 4), part, (s) => mix(C.mand, C.mandTip, ss(0.5, 0.92, s)), lk.mandible, true, true, 0.38, REGION.MANDIBLE);
      if (lod < 2) for (let q = 0; q < 2; q++) {
        // marginal teeth: short dark cones from the inner edge, pointing in and a little forward
        const k = Math.round((0.5 + 0.18 * q) * M), tn = pts[Math.min(M, k + 1)].clone().sub(pts[k - 1]).normalize();
        const inner = new NV(0, sd < 0 ? -1 : 1, 0).applyQuaternion(hq).cross(tn).normalize();
        ttube(n, [pts[k].clone().addScaledVector(inner, rad[k] * 0.6), pts[k].clone().addScaledVector(inner, rad[k] * 0.6 + 0.016 * L).addScaledVector(tn, 0.009 * L)], [rad[k] * 0.5, 0.0015 * L], 4, part, () => C.mandTip, lk.mandible, false, true, 0.6);
      }
      hingeAt.push(h); tips.push(pts[M]);
    }
    if (lod < 2) for (const sd of [-1, 1]) {
      // the palps: pale, jointed, hanging down and forward under the jaws
      const mp = [toB(F - 0.22 * hL, -0.42 * hH, sd * 0.22 * hW)];
      const segs = [0.024, 0.02, 0.02, 0.018, 0.022];
      let d = new NV(0.7, -0.55, sd * 0.25).normalize();
      for (let k = 0; k < segs.length; k++) { d = d.clone().add(new NV(0, -0.18, 0)).normalize(); mp.push(mp[k].clone().add(d.clone().applyQuaternion(hq).multiplyScalar(segs[k] * L))); }
      ttube(n, mp, mp.map((_, k) => (0.0055 - 0.0006 * k) * L), 5, PART.HEAD, () => C.palp, lk.abdomen, true, true);
      const lp = [toB(F - 0.18 * hL, -0.45 * hH, sd * 0.07 * hW)];
      let e = new NV(0.6, -0.75, sd * 0.1).normalize();
      for (const sl of [0.016, 0.014, 0.016]) { lp.push(lp[lp.length - 1].clone().add(e.clone().applyQuaternion(hq).multiplyScalar(sl * L))); e = e.clone().add(new NV(0, -0.15, 0)).normalize(); }
      ttube(n, lp, lp.map(() => 0.0045 * L), 5, PART.HEAD, () => C.palp, lk.abdomen, true, true);
    }
    mouth = toB(F + 0.05 * hL, -0.25 * hH, 0);
    chin = toB(F - 0.25 * hL, -0.5 * hH, 0);
    jawTip = tips[0].clone().lerp(tips[1], 0.5);
    headTipX = Math.max(tips[0].x, tips[1].x, lb[0].x);
  } else {
    // The soldier (photos: the specimen in top, side and head views; the live soldiers): one teardrop — a round bulb
    // behind, its back overhanging the pronotum, drawn forward with concave flanks into the nasus, the dorsal line
    // nearly straight from the vertex to the tip, the underside sweeping up to it; glassy dark red-brown, the tip
    // lighter and translucent. The mandibles are vestigial points hidden under the bulb.
    const nz = hd.nasus;
    const HT = hL + nz.len * L, R = hW * 0.5, Ry = hH * 0.5, rT = nz.r1 * L;
    const sc = (R * 1.02) / HT; // the bulb's centre along the head: its back is round
    const x0 = -0.55 * R;
    const yC = 0.42 * Ry; // the bulb's centre above the neck joint
    const NS = S(30, 16, 8), secs = [];
    let tip = null;
    for (let k = 0; k < NS; k++) {
      const s = k / (NS - 1);
      let rz, ry, cy;
      if (s <= sc) {
        const f = Math.sqrt(Math.max(0, 1 - ((sc - s) / sc) ** 2));
        rz = R * Math.max(0.05, f);
        ry = Ry * Math.max(0.05, f);
        cy = yC;
      } else {
        const u = (s - sc) / (1 - sc);
        // concave flanks: a fast fall then a long slim cone
        const w = Math.pow(1 - u, nz.flank ?? 1.75);
        rz = rT + (R - rT) * w;
        ry = rT + (Ry - rT) * w;
        // the axis rises so the top line stays nearly straight and the underside sweeps up (the sickle-jaw's snout:
        // `rise` small, so the top of the head slopes down into it, and `curve` bends it down toward the tip)
        cy = yC + (Ry - rT) * (nz.rise ?? 0.55) * Math.pow(u, 0.9) + nz.up * u * nz.len * L - (nz.curve ?? 0) * u * u * nz.len * L;
      }
      secs.push({ x: x0 + s * HT, y: cy, ry, rz, n: 2.05 });
      if (k === NS - 1) tip = new NV(x0 + HT + rT, cy, 0);
    }
    headLoft(secs, S(22, 12, 7), (s, d) => {
      const c = headCol(s, d);
      return mix(c, C.nasusTip, ss(nz.dark ?? 0.78, 1, s) * 0.85);
    }, lk.head, undefined, REGION.HEAD);
    nasusTip = toB(tip.x, tip.y, 0);
    if (hd.sickle && lod < 2) {
      // the opening at the snout's tip (the frontal gland's pore): a small dark ring on the blunt end
      const g = secs[NS - 1], dq = hq.clone().multiply(new NQ().setFromUnitVectors(new NV(1, 0, 0), new NV(g.x - secs[NS - 3].x, g.y - secs[NS - 3].y, 0).normalize()));
      blob(n, toB(g.x + rT * 0.6, g.y, 0), new NV(rT * 0.35, rT * 0.62, rT * 0.62), S(10, 6, 4), PART.HEAD, C.pore ?? C.mandTip, lk.mandible, dq);
    }
    // a point on the teardrop's surface: s along the head, angle a round it (0 = the side, +pi/2 = the top), out = 1
    headSurf = (s0, a, out = 1) => {
      const f = Math.max(0, Math.min(NS - 1, s0 * (NS - 1))), k = Math.min(NS - 2, Math.floor(f)), t = f - k, g0 = secs[k], g1 = secs[k + 1];
      const x = g0.x + (g1.x - g0.x) * t, y = g0.y + (g1.y - g0.y) * t, ry = g0.ry + (g1.ry - g0.ry) * t, rz = g0.rz + (g1.rz - g0.rz) * t;
      return toB(x, y + Math.sin(a) * ry * out, Math.cos(a) * rz * out);
    };
    /**
     * The sickle-jaw soldier's mandibles (traced from the user's four photos, docs/creatures/rhynchotermes-perarmatus.md
     * §10): long, thin, flattened blades hinged low on the front sides of the globe, where it narrows into the snout.
     * Seen from above each sweeps out sideways, turns forward and then in (about 150° in all), the tips crossing in
     * front of and below the snout when closed; seen from the side it hangs, curving ever more steeply down, the last
     * sixth hooked down and back. A small conical tooth on the inner margin at 0.42; crimson, black from `sk.tip` on.
     */
    const sickles = (sk, sc0) => {
      const mL = sk.len * L;
      const path = (sd, sweep) => {
        const N = S(22, 12, 6), pts = [];
        let p = new NV(0, 0, 0);
        pts.push(p.clone());
        for (let k = 1; k <= N; k++) {
          const s0 = (k - 0.5) / N;
          const yaw = sk.yaw0 - sweep * Math.pow(s0, sk.yawPow ?? 1.15);
          const dip = sk.dip0 + sk.dip1 * s0 * s0 + sk.hook * ss(0.8, 1, s0);
          const d = new NV(Math.cos(dip) * Math.cos(yaw), -Math.sin(dip), sd * Math.cos(dip) * Math.sin(yaw));
          p = p.clone().addScaledVector(d, mL / N);
          pts.push(p);
        }
        return pts;
      };
      /**
       * (round-1 photo comparison: the photos' sickles are C-shaped hooks under the head — forward and down from the
       * hinge, round the bottom and the tip curling back up — not tusks hanging to the ground) `sk.plane`: each
       * sickle lies in one plane, turned out by `yaw0` and leaned in toward the midline by a fitted angle so the
       * closed tips just cross; `dip` runs past a right angle so the curve turns back on itself
       */
      // a turn about the blade's own forward axis that brings its lower part toward the midline
      const lean = (pts, sd, a) => pts.map((q) => new NV(q.x, q.y * Math.cos(a) - sd * q.z * Math.sin(a), q.z * Math.cos(a) + sd * q.y * Math.sin(a)));
      for (const sd of [-1, 1]) {
        const h = headSurf(sc0 + (sk.at ?? 0.02), -(sk.ang ?? 0.95), 0.9);
        h.z *= sd;
        let local;
        if (sk.plane) {
          const base = path(sd, 0);
          // the lean fitted so the closed tips just cross the midline (the left over the right)
          let lo = 0, hi2 = 1.4, a = 0.5;
          for (let it = 0; it < 22; it++) {
            a = (lo + hi2) / 2;
            const tp = lean(base, sd, a)[base.length - 1].clone().applyQuaternion(hq).add(h);
            if (sd * tp.z > -(sk.cross ?? 0.01) * L) lo = a;
            else hi2 = a;
          }
          local = lean(base, sd, a);
        } else {
          // the sweep fitted so the closed tips just cross the midline (the left over the right)
          let lo = 1.2, hi2 = 3.6, sw = 2.6;
          for (let it = 0; it < 22; it++) {
            sw = (lo + hi2) / 2;
            const tp = path(sd, sw)[S(22, 12, 6)].clone().applyQuaternion(hq).add(h);
            if (sd * tp.z > -(sk.cross ?? 0.01) * L) lo = sw;
            else hi2 = sw;
          }
          local = path(sd, sw);
        }
        const lift = sd < 0 ? 0.008 * L : 0;
        const pts = local.map((q, k) => q.clone().add(new NV(0, lift * ss(0.6, 1, k / (local.length - 1)), 0)).applyQuaternion(hq).add(h));
        const rad = pts.map((_, k) => {
          const t = k / (pts.length - 1);
          return L * (sk.w * (1 - 0.72 * Math.pow(t, 0.8)) + 0.0015);
        });
        const part = sd < 0 ? PART.MAND_L : PART.MAND_R;
        // flattened in the blade's plane: the tube's `flat` squashes its section across the curve
        ttube(n, pts, rad, S(10, 6, 4), part, (t) => mix(C.mand, C.mandTip, ss(sk.tip ?? 0.45, 0.97, t)), lk.mandible, true, true, sk.flat ?? 0.55, REGION.MANDIBLE);
        if (lod < 2) {
          // the marginal tooth on the inner edge
          const k = Math.round((sk.tooth ?? 0.42) * (pts.length - 1)), tn = pts[k + 1].clone().sub(pts[k - 1]).normalize();
          const inner = new NV(0, 0, -sd).applyQuaternion(hq).sub(tn.clone().multiplyScalar(new NV(0, 0, -sd).applyQuaternion(hq).dot(tn))).normalize();
          ttube(n, [pts[k].clone().addScaledVector(inner, rad[k] * 0.5), pts[k].clone().addScaledVector(inner, rad[k] * 0.5 + (sk.toothLen ?? 0.1) * mL).addScaledVector(tn, 0.03 * mL)], [rad[k] * 0.55, 0.0012 * L], 5, part, () => C.mandTip, lk.mandible, false, true, 0.7);
        }
        hingeAt.push(h); tips.push(pts[pts.length - 1]);
        if (sd < 0) for (let k = 0; k <= 8; k++) sickPts.push(pts[Math.round((k / 8) * (pts.length - 1))].clone());
      }
    };
    // (user rating S1/S2 "the mandibles are misplaced") vestigial mandibles: two small dark points tucked under the
    // front of the bulb where it narrows into the nasus, pointing forward along its underside, mostly hidden
    if (hd.sickle) sickles(hd.sickle, sc);
    else for (const sd of [-1, 1]) {
      const h = headSurf(sc + 0.06, -1.2, 0.92);
      h.z *= sd;
      const part = sd < 0 ? PART.MAND_L : PART.MAND_R;
      const t = h.clone().add(new NV(0.026 * L, -0.002 * L, -sd * 0.006 * L).applyQuaternion(hq));
      ttube(n, [h, h.clone().lerp(t, 0.5), t], [0.008 * L, 0.005 * L, 0.0015 * L], S(6, 4, 3), part, (s) => mix(C.mand, C.mandTip, s), lk.mandible, true, true, 0.6);
      hingeAt.push(h); tips.push(t);
    }
    // the six stiff setae: two on the vertex, two on the sides, two near the nasus base (0.25x the head width)
    if (lod < 2) {
      const sl = 0.25 * hW;
      const at = (s, a) => {
        const k = Math.min(NS - 1, Math.round(s * (NS - 1))), g = secs[k];
        return toB(g.x, g.y + Math.sin(a) * g.ry * 0.98, Math.cos(a) * g.rz * 0.98);
      };
      const sp = [[sc * 0.9, 1.35, new NV(0.1, 1, 0.25)], [sc * 0.9, 1.79, new NV(0.1, 1, -0.25)], [sc * 0.8, 0.25, new NV(-0.1, 0.3, 1)], [sc * 0.8, Math.PI - 0.25, new NV(-0.1, 0.3, -1)], [sc + 0.12, 1.2, new NV(0.3, 1, 0.4)], [sc + 0.12, Math.PI - 1.2, new NV(0.3, 1, -0.4)]];
      for (const [s0, a, d] of sp) seta(n, at(s0, a), d.normalize().applyQuaternion(hq), sl, 0.0018 * L, PART.HEAD, C.seta ?? C.hair, lk.hair);
    }
    mouth = toB(x0 + R * 1.5, yC - Ry * 0.8, 0);
    chin = toB(x0 + R, yC - Ry, 0);
    jawTip = tips[0].clone().lerp(tips[1], 0.5);
    headTipX = nasusTip.x;
  }
  // ---------- antennae: straight beaded chains (13 soldier, 14 worker), carried forward in a gentle curve ----------
  // (the ant rig needs an elbow: the scape is the first long article, the "elbow" the pedicel's end; the chain
  // carries on almost in line, so it reads as a straight termite antenna, not an ant's elbowed one)
  {
    const an = i.antenna;
    const nB = an.beads;
    const lens = [];
    for (let q = 0; q < nB; q++) lens.push(q === 0 ? 1.7 : q === 1 ? 0.85 : 0.8 + 0.45 * (q / (nB - 1)));
    const tot = lens.reduce((a, b) => a + b, 0);
    for (const sd of [-1, 1]) {
      // (user ratings S1, S2, J2, J4: the soldiers' antennae came out from under the head) soldiers: on the bulb's side,
      // low and in front of its middle, where it starts to narrow into the nasus
      const sk = headSurf ? headSurf(an.ss ?? 0.4, -(an.sa ?? 0.45), 0.97).add(new NV(0, 0, 0)) : toB(an.sx * hL, an.sy * hH, sd * an.sz * hW);
      if (headSurf) sk.z *= sd;
      sockets.push(sk);
      // the path: forward and out, rising a little at the scape, then curving gently down toward the tip
      const dir0 = new NV(Math.cos(an.ang), Math.sin(an.ang), sd * an.splay).normalize();
      let p = sk.clone(), a = 0;
      const beadPts = [];
      let el = null;
      for (let q = 0; q < nB; q++) {
        const segL = (lens[q] / tot) * an.len * L;
        const d = dir0.clone().applyAxisAngle(new NV(0, 0, 1), -an.droop * (q / nB) * (q / nB)).add(new NV(0, 0, sd * 0.02 * q / nB)).normalize();
        const a0 = p.clone(), a1 = p.clone().addScaledVector(d, segL);
        beadPts.push([a0, a1, q]);
        p = a1;
        if (q === 1) el = a1.clone();
      }
      elbows.push(el);
      const rB = an.r * L;
      for (const [a0, a1, q] of beadPts) {
        const part = q < 2 ? (sd < 0 ? PART.SCAPE_L : PART.SCAPE_R) : sd < 0 ? PART.FUNI_L : PART.FUNI_R;
        const M = S(q === 0 ? 6 : 5, 3, 2), pts = [], rr = [];
        for (let k = 0; k <= M; k++) {
          const f = k / M;
          pts.push(a0.clone().lerp(a1, f));
          // each bead narrow at its joints, round in its middle; a little thicker toward the tip (moniliform)
          const grow = 0.85 + 0.3 * (q / nB);
          rr.push(rB * grow * (q === 0 ? 0.85 + 0.15 * f : 0.55 + 0.45 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + f * 0.86)), 0.7)));
        }
        ttube(n, pts, rr, S(8, 5, 3), part, () => mix(C.antenna, C.antennaTip, q / nB), lk.leg, q === 0, q === nB - 1, 1, REGION.ANTENNA);
        if (o && q > 1 && q % 1 === 0) {
          // a whorl of fine setae on each bead
          for (let k = 0; k < 3; k++) {
            const t = a1.clone().sub(a0).normalize(), out = new NV(rnd.range(-1, 1), rnd.range(-1, 1), rnd.range(-1, 1)).cross(t).normalize();
            const root = a0.clone().lerp(a1, 0.55).addScaledVector(out, rB * 0.8);
            seta(n, root, out.clone().multiplyScalar(0.7).addScaledVector(t, 0.7).normalize(), 0.025 * L, 0.0012 * L, part, C.hair, lk.hair);
          }
        }
      }
    }
  }

  // ---------- legs: long, slender, splayed; femur, tibia, four tarsomeres and two claws ----------
  const lg = i.legs, rig = { coxa: [], knee: [], ankle: [], axis: [], foot: [] };
  const UP = new NV(0, 1, 0);
  let reach = 0;
  const segX = [pro.x + pro.len * 0.45, meso.x + meso.len * 0.5, meta.x + meta.len * 0.5];
  for (let li = 0; li < 6; li++) {
    const pair = Math.floor(li / 2), sd = li % 2 === 0 ? -1 : 1, P = lg.pairs[pair];
    const c0 = new NV(segX[pair], tCy - th.h * 0.3 * L, sd * th.w * 0.32 * L);
    // the coxa: a short stout cone down and out
    const c1 = c0.clone().add(new NV(P.coxaDir[0] * L, P.coxaDir[1] * L, sd * P.coxaDir[2] * L));
    const foot = new NV(c0.x + P.foot[0] * L, 0, sd * P.foot[1] * L);
    const hz = foot.clone().sub(c1).setY(0).normalize();
    const Fm = P.femur * L, Tb = P.tibia * L, Ts = P.tarsus * L;
    const phi = 0.32;
    const ankle = foot.clone().addScaledVector(hz, -Ts * Math.cos(phi)).add(new NV(0, Ts * Math.sin(phi), 0));
    const D = Math.min(Fm + Tb - 1e-4, ankle.distanceTo(c1));
    // the knee bends up and outward (sprawled, as in the photos), not straight up over the back
    const bend = UP.clone().addScaledVector(hz, lg.sprawl ?? 0.9).normalize();
    const along = ankle.clone().sub(c1).normalize(), perp = bend.clone().sub(along.clone().multiplyScalar(bend.dot(along))).normalize();
    const ca = Math.max(-1, Math.min(1, (Fm * Fm + D * D - Tb * Tb) / (2 * Fm * D)));
    const knee = c1.clone().addScaledVector(along, Fm * ca).addScaledVector(perp, Fm * Math.sqrt(1 - ca * ca));
    const axis = new NV().crossVectors(hz, UP).normalize();
    rig.coxa.push(c0.clone()); rig.knee.push(knee.clone()); rig.ankle.push(ankle.clone()); rig.axis.push(axis); rig.foot.push(foot.clone());
    reach += Math.hypot(foot.x - c0.x, foot.z - c0.z);
    const p0 = PART.LEG0 + li * 3, t0 = lg.thick * L;
    const legCol = (s) => mix(C.legBase, mix(C.leg, C.legLight, 0.3 + 0.4 * Math.sin(Math.PI * s)), ss(0, 0.2, s));
    // seg 0: coxa (stout), trochanter, femur (a little swollen in its basal half)
    ttube(n, [c0, c0.clone().lerp(c1, 0.5), c1], [t0 * 1.9, t0 * 1.7, t0 * 1.25], S(10, 5, 3), p0, () => C.legBase, lk.leg, lod < 2, false, 1, REGION.LEG);
    if (lg.coxaThorn && pair === 0 && lod < 2) {
      // the sickle-jaw soldier's fore coxa: a conical, thorn-like process pointing forward and down
      const b0 = c0.clone().lerp(c1, 0.45), tip = b0.clone().add(new NV(lg.coxaThorn * L, -lg.coxaThorn * 0.45 * L, sd * lg.coxaThorn * 0.2 * L));
      ttube(n, [b0, b0.clone().lerp(tip, 0.5), tip], [t0 * 1.1, t0 * 0.6, t0 * 0.08], 6, p0, () => C.legBase, lk.leg, false, true);
    }
    {
      const m = S(9, 4, 2), pts = [], rr = [];
      for (let k = 0; k <= m; k++) { const s = k / m; pts.push(c1.clone().lerp(knee, s)); rr.push(t0 * (1.15 + 0.3 * Math.exp(-((s - 0.35) ** 2) / 0.07) - 0.3 * s)); }
      ttube(n, pts, rr, S(10, 5, 3), p0, legCol, lk.leg, false, true, 1, REGION.LEG);
      if (o) for (let k = 0; k < 4; k++) {
        const s = 0.2 + 0.2 * k, q = Math.round(s * m);
        seta(n, pts[q].clone().add(new NV(0, -rr[q] * 0.9, 0)), new NV(0, -1, 0).addScaledVector(knee.clone().sub(c1).normalize(), 0.9).normalize(), 0.03 * L, 0.0014 * L, p0, C.hair, lk.hair);
      }
    }
    // seg 1: tibia, slender, a little wider at its apex, with two apical spurs
    {
      const m = S(7, 3, 1), pts = [], rr = [];
      for (let k = 0; k <= m; k++) { const s = k / m; pts.push(knee.clone().lerp(ankle, s)); rr.push(t0 * (0.78 + 0.12 * ss(0.7, 1, s))); }
      ttube(n, pts, rr, S(9, 4, 3), p0 + 1, legCol, lk.leg, lod < 2, true, 1, REGION.LEG);
      if (o) {
        const td = ankle.clone().sub(knee).normalize();
        for (const q of [-1, 1]) {
          const sp = ankle.clone().lerp(knee, 0.03).addScaledVector(axis, q * 0.006 * L);
          n.hair([sp, sp.clone().addScaledVector(td, 0.025 * L).add(V(0, -0.006)), sp.clone().addScaledVector(td, 0.04 * L).add(V(0, -0.014))], [t0 * 0.3, t0 * 0.18, t0 * 0.05], 3, p0 + 1, C.legBase, lk.leg);
        }
        for (let k = 0; k < 6; k++) {
          const s = 0.12 + 0.13 * k, r = knee.clone().lerp(ankle, s).add(new NV(0, -t0 * 0.7, 0)).addScaledVector(axis, rnd.range(-0.5, 0.5) * t0);
          seta(n, r, new NV(0, -0.6, 0).addScaledVector(td, 1).normalize(), 0.025 * L, 0.0012 * L, p0 + 1, C.hair, lk.hair);
        }
      }
    }
    // seg 2: four tarsomeres (the last the longest) and two claws
    {
      const fr = [0.18, 0.15, 0.15, 0.52], pts = [ankle.clone()], rr = [t0 * 0.6];
      if (lod === 0) {
        let acc = 0;
        for (let q = 0; q < 4; q++) {
          const a = acc, b = acc + fr[q];
          for (const f of [0.08, 0.5, 0.92, 1]) { const s = a + (b - a) * f; pts.push(ankle.clone().lerp(foot, s).add(V(0, -0.01 * Math.sin(Math.PI * s)))); rr.push(t0 * (0.46 + 0.14 * f) * (1 - 0.25 * s) * (f === 1 ? 0.75 : 1)); }
          acc = b;
        }
      } else { pts.push(ankle.clone().lerp(foot, 0.5)); rr.push(t0 * 0.5); pts.push(foot.clone()); rr.push(t0 * 0.4); }
      ttube(n, pts, rr, S(7, 3, 3), p0 + 2, () => C.legLight, lk.leg, false, true, 1, REGION.TARSUS);
      if (o) for (const cs of [-1, 1]) {
        const a = foot.clone().addScaledVector(axis, cs * t0 * 0.25), b = a.clone().addScaledVector(hz, 0.018 * L).add(V(0, -0.004)), c = b.clone().add(V(0, -0.012)).addScaledVector(hz, -0.003 * L);
        ttube(n, [a, b, c], [t0 * 0.22, t0 * 0.14, t0 * 0.04], 3, p0 + 2, () => C.claw, { rough: 0.3, coat: 0.6, sheen: 0 }, false, true);
      }
    }
  }

  // ---------- rig ----------
  const geo = n.build();
  const out = {
    ...rig, neck: neck.clone(), mandL: hingeAt[0].clone(), mandR: hingeAt[1].clone(), antL: sockets[0].clone(), antR: sockets[1].clone(), elbL: elbows[0].clone(), elbR: elbows[1].clone(),
    gasterPivot: gp.clone(), waistPivot: gp.clone(), length: 0, stride: 0, stance: base, q0: 0.32, headTip: new NV(headTipX, neck.y, 0), gasterTip: gTip.clone(), mouth: mouth.clone(),
    jawTip: jawTip.clone(), chin: chin.clone(), gaitLift: i.gait?.lift ?? 0.28, gaitDuty: i.gait?.duty ?? 0.56, soft: i.soft ?? 1,
    mandOpen: i.mandible?.open ?? 0.7,
    bodyTop: Math.max(aCy + ab.h * 0.5 * L, neck.y + hH * 0.5), bodyHalfW: Math.max(ab.w * 0.5 * L, hW * 0.5),
  };
  if (nasusTip) out.nasusTip = nasusTip.clone();
  if (sickPts.length) Object.assign(out, { mandPts: sickPts, mandSwing: 0 });
  out.length = out.headTip.x - out.gasterTip.x;
  out.stride = (2 * out.q0 * (reach / 6)) / 0.55;
  const mid = (out.gasterTip.x + out.headTip.x) / 2;
  geo.translate(-mid, 0, 0);
  const sh = (v) => v.set(v.x - mid, v.y, v.z);
  out.coxa.forEach(sh), out.knee.forEach(sh), out.ankle.forEach(sh), out.foot.forEach(sh);
  [out.neck, out.mandL, out.mandR, out.antL, out.antR, out.elbL, out.elbR, out.gasterPivot, out.waistPivot, out.headTip, out.gasterTip, out.mouth, out.jawTip, out.chin].forEach(sh);
  if (out.nasusTip) sh(out.nasusTip);
  if (out.mandPts) out.mandPts.forEach(sh);
  geo.computeBoundingSphere();
  plantHomes(out);
  return { geometry: geo, rig: out };
}
