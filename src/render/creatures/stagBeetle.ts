import * as THREE from 'three';
import { Acc, Ring, detOf, ellipsoid, loft, tube } from '../ants/antGeometry';
import type { PartLook } from '../ants/morphs';
import { REGION } from '../bake/detailBake';
import { bakeOcclusion } from '../bake/occlusion';
import { registerPart } from './primitives';
import { Rig, V, ease, footAt, tripod } from './rig';
import type { CrPose } from './builders';

/**
 * European stag beetle, Lucanus cervus, major male (realism pass, pilot): a sculpted model from the
 * reference notes in docs/creatures/stagBeetle.md, drawn from instanced part meshes with baked macro
 * detail (render/bake, family 'stag').
 *
 * Proportions are fractions of the total length L, mandibles included (a 60 mm major male: mandibles ~⅓,
 * head broader than the pronotum, elytra ~⅜, body flattened). The parts are modelled in millimetres at
 * L = 60 (so the baked sculpture is at the real beetle's scale) and drawn at the creature's length.
 *
 * Local frame as in builders.ts: +x forward, +y up, +z to the side, y = 0 on the ground.
 */

export const STAG_REF = 60;
const F = (f: number) => f * STAG_REF;
const ss = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const WHITE = new THREE.Color(1, 1, 1);
const LOOK: PartLook = { color: 0xffffff, rough: 0.5, coat: 0.5, sheen: 0 };

/**
 * Body layout (fractions of L, a 60 mm major male): mandibles ~0.32, head 0.13 long and 0.30 across its
 * front angles (broader than the pronotum), pronotum 0.13 × 0.27, elytra 0.40 × 0.29; 3 mm of clearance.
 */
export const SB = {
  belly: 0.05,
  // proportions from a major male specimen (top view): head 0.30 wide, pronotum 0.24, elytra 0.27
  elytra: { x0: -0.47, x1: -0.07, half: 0.135, top: 0.178 },
  pronotum: { x0: -0.085, x1: 0.045, half: 0.122, top: 0.158 },
  head: { x0: 0.035, x1: 0.17, half: 0.162, cy: 0.112, ry: 0.04 },
  neck: { x: 0.04, y: 0.11 },
  mand: { x: 0.158, y: 0.108, z: 0.076, len: 0.34 },
  eye: { x: 0.098, y: 0.112, z: 0.146 },
  ant: { x: 0.14, y: 0.104, z: 0.115 },
};

// --------------------------------------------------------------------------- part geometry

function build(fn: (acc: Acc) => void, color: (x: number, y: number, z: number) => THREE.Color = () => WHITE, occRadius = F(0.03)): THREE.BufferGeometry {
  const acc = new Acc();
  colorFn = color;
  fn(acc);
  const g = acc.build();
  // realism v2: occlusion between the teeth, at the margins and joints; worn convex edges
  bakeOcclusion(g, { radius: occRadius, skip: acc.skipOcc });
  return g;
}
let colorFn: (x: number, y: number, z: number) => THREE.Color = () => WHITE;
const put = (acc: Acc, r: [number[], number[], ReturnType<typeof loft>[2]], region: number) => acc.piece(r[0], r[1], 0, colorFn, LOOK, 0, undefined, detOf(r[2], region));

/** Elytra over the abdomen: long, parallel-sided, domed, rounded behind, with the elytral suture. */
function elytraGeo(): THREE.BufferGeometry {
  // painted shading (× the instance colour): a lighter disc, darker toward the margins, the suture and the apex
  const col = new THREE.Color();
  const E0 = SB.elytra;
  const paint = (x: number, _y: number, z: number) => {
    const lat = Math.abs(z) / F(E0.half);
    const sut = Math.exp(-(z * z) / (F(0.0045) ** 2));
    const apex = ss(F(E0.x0 + 0.12), F(E0.x0), x);
    const shoulder = ss(F(E0.x1 - 0.05), F(E0.x1), x);
    const k = 1.08 - 0.3 * ss(0.62, 1.0, lat) - 0.7 * sut - 0.22 * apex - 0.1 * shoulder;
    return col.setRGB(k * 1.02, k, k * 0.96);
  };
  return build((acc) => {
    const E = SB.elytra;
    const rings: Ring[] = [];
    const N = 28;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1); // 0 front (shoulders) … 1 apex
      const x = F(E.x1 + (E.x0 - E.x1) * t);
      // square shoulders (the humeral angles), the sides converging a little toward a broadly rounded apex
      const shoulder = (0.9 + 0.1 * ss(0, 0.05, t)) * (1 - 0.1 * ss(0.08, 0.7, t));
      const apex = t < 0.68 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.68) / 0.32, 2)));
      const close = Math.pow(Math.min(1, t / 0.035), 0.5);
      const w = F(E.half) * shoulder * Math.max(0.08, apex) * Math.max(0.88, close);
      const dome = 0.82 + 0.18 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 1.1));
      const top = F(SB.belly + 0.012) + (F(E.top) - F(SB.belly + 0.012)) * dome * Math.max(0.3, Math.pow(apex, 0.6)) * Math.max(0.75, close);
      const bot = F(SB.belly + 0.012);
      rings.push({ x, y: (top + bot) / 2, rz: w, ry: (top - bot) / 2, n: 2.7 });
    }
    put(
      acc,
      // (enough vertices around for the suture's fine line to show)
      loft(rings, 128, (x, y, z, t) => {
        const r = rings[Math.round(t * (N - 1))];
        const lat = Math.abs(z) / Math.max(1e-3, r.rz);
        // a domed back and a flatter belly; the suture down the middle
        if (y < r.y) y = r.y - (r.y - y) * 0.55;
        else {
          y -= F(0.006) * Math.exp(-(z * z) / (F(0.0035) ** 2)) - F(0.0018) * Math.exp(-(((Math.abs(z) - F(0.008)) / F(0.004)) ** 2));
          // the humeral calli: a low swelling at each shoulder
          y += F(0.006) * Math.exp(-(((t - 0.08) / 0.07) ** 2)) * Math.exp(-(((lat - 0.72) / 0.16) ** 2));
          // the lateral margin turned up a little into a fine rim
          y += F(0.0045) * ss(0.88, 0.96, lat) * (1 - ss(0.97, 1.0, lat)) - F(0.0025) * Math.exp(-(((lat - 0.84) / 0.03) ** 2));
        }
        return [x, y, z];
      }),
      REGION.ELYTRA,
    );
  }, paint);
}

/** Pronotum: transverse, rounded sides with a sharp margin, narrower in front, blunt hind angles. */
function pronotumGeo(): THREE.BufferGeometry {
  return build((acc) => {
    const P = SB.pronotum;
    const rings: Ring[] = [];
    const N = 20;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1); // 0 rear … 1 front
      const x = F(P.x0 + (P.x1 - P.x0) * t);
      const close = Math.pow(Math.min(1, t / 0.06), 0.5) * Math.pow(Math.min(1, (1 - t) / 0.08), 0.5);
      // sides curved: narrower in front, widest a little behind the middle, the hind angles rounded
      const w = F(P.half) * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95))) * Math.max(0.72, close);
      const bot = F(SB.belly + 0.045);
      const top = bot + (F(P.top) - bot) * (0.86 + 0.14 * Math.sin(Math.PI * t)) * Math.max(0.7, close);
      rings.push({ x, y: (top + bot) / 2, rz: w, ry: (top - bot) / 2, n: 2.05 });
    }
    put(
      acc,
      loft(rings, 40, (x, y, z, t) => {
        const r = rings[Math.round(t * (N - 1))];
        if (y < r.y) y = r.y - (r.y - y) * 0.5;
        // the lateral margin: a thin sharp edge
        const lat = Math.abs(z) / Math.max(1e-3, r.rz);
        if (lat > 0.85 && y < r.y + r.ry * 0.2) z *= 1.03;
        return [x, y, z];
      }),
      REGION.PRONOTUM,
    );
  });
}

/**
 * Head of a major male: broad and flat, narrow at the neck and flaring to sharp front angles (broader than
 * the pronotum), a transverse ridge across the front, the eyes far back at the sides under the canthus.
 */
function headGeo(): THREE.BufferGeometry {
  return build((acc) => {
    const H = SB.head;
    const rings: Ring[] = [];
    const N = 20;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1); // 0 neck … 1 front
      const x = F(H.x0 + (H.x1 - H.x0) * t);
      const close = Math.pow(Math.min(1, t / 0.08), 0.45) * Math.pow(Math.min(1, (1 - t) / 0.05), 0.5);
      // flares from the neck to the front angles (which jut forward), the sides curving out; the cheeks behind
      // the eyes swell a little
      const w = F(H.half) * (0.6 + 0.4 * ss(0.0, 0.85, t) + 0.05 * Math.exp(-(((t - 0.35) / 0.12) ** 2))) * Math.max(0.55, close);
      const ry = F(H.ry) * 1.1 * (0.8 + 0.2 * Math.sin(Math.PI * t)) * Math.max(0.55, close);
      rings.push({ x, y: F(H.cy), rz: w, ry, n: 2.05 });
    }
    put(
      acc,
      loft(rings, 40, (x, y, z, t) => {
        if (y > F(H.cy)) {
          // the transverse ridge across the front, a shallow hollow in the middle behind it
          y += F(0.006) * Math.exp(-(((t - 0.82) / 0.07) ** 2)) - F(0.004) * Math.exp(-(((t - 0.55) / 0.15) ** 2)) * Math.exp(-(z * z) / (F(0.07) ** 2));
        } else y = F(H.cy) - (F(H.cy) - y) * 0.7;
        // the front angles jut forward at the sides (the middle of the front margin stays back)
        const lat = Math.abs(z) / F(H.half);
        if (t > 0.85) x += F(0.018) * ss(0.55, 0.95, lat) * ss(0.85, 1, t);
        return [x, y, z];
      }),
      REGION.CR_HEAD,
    );
  });
}

/** Underside: the sternal plates under the elytra and pronotum, with the segment sutures. */
function underGeo(): THREE.BufferGeometry {
  return build((acc) => {
    const rings: Ring[] = [];
    const N = 24;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1); // 0 rear … 1 front
      const x = F(-0.43 + 0.47 * t);
      const close = Math.pow(Math.min(1, t / 0.08), 0.5) * Math.pow(Math.min(1, (1 - t) / 0.08), 0.5);
      let w = F(0.105) * (0.7 + 0.3 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * Math.max(0.3, close);
      // sutures between the visible sternites
      for (const s of [0.16, 0.3, 0.42, 0.53]) w *= 1 - 0.03 * Math.exp(-(((t - s) / 0.012) ** 2));
      rings.push({ x, y: F(SB.belly + 0.012), rz: w, ry: F(0.016) * Math.max(0.4, close), n: 2.3 });
    }
    put(acc, loft(rings, 24), REGION.CR_UNDER);
  });
}

/**
 * A swept blade: a path with a cross-section that changes along it (realism v2). The section is a
 * superellipse whose two halves can differ: `w` half-width (sideways, +B outward), `h` half-height (up),
 * `eIn`/`eOut` the inner and outer edge exponents (low = sharp edge), `eUp`/`eDown` the top and bottom. The
 * frame keeps "up" near world up, so a blade flattened by h < w stays flat like a real mandible.
 * Returns positions, indices and the surface coordinates for the baked detail.
 */
interface Section {
  w: number;
  h: number;
  eIn: number;
  eOut: number;
  eUp: number;
  eDown: number;
}
function sweep(path: THREE.Vector3[], sec: (t: number) => Section, radial: number, capEnd = true): [number[], number[], ReturnType<typeof loft>[2]] {
  const p: number[] = [];
  const ind: number[] = [];
  const n = path.length;
  const along: number[] = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = along[n - 1];
  const meta = { th: [] as number[], s: [] as number[], total, circ: 0 };
  const up = new THREE.Vector3(0, 1, 0);
  const T = new THREE.Vector3();
  const B = new THREE.Vector3();
  const N = new THREE.Vector3();
  let girth = 0;
  for (let i = 0; i < n; i++) {
    T.copy(path[Math.min(n - 1, i + 1)]).sub(path[Math.max(0, i - 1)]).normalize();
    B.crossVectors(T, up).normalize();
    N.crossVectors(B, T).normalize();
    const c = sec(i / (n - 1));
    girth += Math.PI * (c.w + c.h);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ex = 2 / (ca >= 0 ? c.eOut : c.eIn);
      const ey = 2 / (sa >= 0 ? c.eUp : c.eDown);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), ex) * c.w;
      const y = Math.sign(sa) * Math.pow(Math.abs(sa), ey) * c.h;
      p.push(path[i].x + B.x * x + N.x * y, path[i].y + B.y * x + N.y * y, path[i].z + B.z * x + N.z * y);
      meta.th.push(j / radial);
      meta.s.push(along[i]);
    }
  }
  meta.circ = girth / n;
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      ind.push(a, c, b, b, c, d);
    }
  // close the base (it sits in the head) and the point
  const c0 = p.length / 3;
  p.push(path[0].x, path[0].y, path[0].z);
  meta.th.push(-1);
  meta.s.push(0);
  for (let j = 0; j < radial; j++) ind.push(c0, j, (j + 1) % radial);
  if (capEnd) {
    const c1 = p.length / 3;
    const e = path[n - 1].clone().add(T.clone().multiplyScalar(sec(1).w * 0.3));
    p.push(e.x, e.y, e.z);
    meta.th.push(-1);
    meta.s.push(total);
    const o = (n - 1) * radial;
    for (let j = 0; j < radial; j++) ind.push(c1, o + ((j + 1) % radial), o + j);
  }
  return [p, ind, meta];
}

/**
 * Antler mandible of a major male (mandible frame: pivot at the origin, pointing +x; +z outward, so the other
 * side is mirrored), realism v2: a robust, flattened blade — taller than wide only at the base, then
 * flattened, the inner edge sharp and the outer rounded — sweeping out and up, then inward like a caliper;
 * the broad inner tooth just past the middle, angled in and up; three small denticles toward the point; the
 * point forked, with an upper tine. Reddish chestnut, darker toward the points and on the teeth.
 */
function mandibleGeo(side: 1 | -1): THREE.BufferGeometry {
  const ml = F(SB.mand.len);
  const base = new THREE.Color(0x42181c);
  const mid = new THREE.Color(0x321318);
  const tip = new THREE.Color(0x160a0c);
  const col = new THREE.Color();
  // the centre line: heading turns from 20° outward to 75° inward, rising at first
  const n = 40;
  const P: THREE.Vector3[] = [new THREE.Vector3()];
  for (let i = 1; i <= n; i++) {
    const t = (i - 0.5) / n;
    // out at the base, fairly straight through the middle, hooking inward toward the point (antler-like)
    const yaw = 0.42 - 0.35 * t - 1.45 * ss(0.5, 1.0, t);
    const pitch = 0.2 * (1 - t) - 0.03;
    const d = ml / n;
    const q = P[i - 1];
    P.push(new THREE.Vector3(q.x + Math.cos(yaw) * Math.cos(pitch) * d, q.y + Math.sin(pitch) * d, q.z + Math.sin(yaw) * Math.cos(pitch) * d));
  }
  const at = (t: number) => P[Math.min(n, Math.round(t * n))].clone();
  const dirAt = (t: number) => at(Math.min(1, t + 0.03)).sub(at(Math.max(0, t - 0.03))).normalize();
  const g = build(
    (acc) => {
      // the blade: half-width and half-height along it (mm at the 60 mm reference)
      put(
        acc,
        sweep(
          P,
          (t) => ({
            w: F(0.022) * (1 - 0.55 * Math.pow(t, 0.7)) * (1 - 0.35 * ss(0.85, 1, t)) + F(0.0024),
            h: F(0.011) * (1 - 0.5 * Math.pow(t, 0.6)) * (1 - 0.3 * ss(0.85, 1, t)) + F(0.0011),
            eIn: 1.35,
            eOut: 2.3,
            eUp: 2.6,
            eDown: 2.0,
          }),
          22,
        ),
        REGION.CR_MAND,
      );
      // a tooth or tine: a flattened tapering blade from inside the main blade at `t`, along `dir`
      const tooth = (t: number, dir: THREE.Vector3, len: number, w0: number, h0: number, curl = 0.08) => {
        const a = at(t);
        const d = dir.clone().normalize();
        const pts: THREE.Vector3[] = [];
        const m = 10;
        for (let k = 0; k <= m; k++) {
          const u = k / m;
          pts.push(a.clone().addScaledVector(d, -w0 * 0.6 + len * u).add(new THREE.Vector3(0, len * curl * u * u, 0)));
        }
        // a flat blade, broad most of its length and pointed only at the end
        put(acc, sweep(pts, (u) => ({ w: w0 * (1 - 0.55 * u - 0.4 * ss(0.7, 1, u)), h: h0 * (1 - 0.5 * u), eIn: 1.4, eOut: 1.4, eUp: 2.4, eDown: 2.4 }), 12), REGION.CR_MAND);
      };
      // the inward direction at t: the blade's tangent turned toward the midline (−z), tilted up
      const inward = (t: number, up: number, fwd = 0.15) => {
        const d = dirAt(t);
        const inn = new THREE.Vector3(d.z, 0, -d.x).normalize(); // 90° toward −z for a +x blade
        return inn.multiplyScalar(1).addScaledVector(d, fwd).add(new THREE.Vector3(0, up, 0)).normalize();
      };
      // the broad inner tooth, angled in and up
      tooth(0.6, inward(0.6, 0.45, 0.55), F(0.085), F(0.019), F(0.009), 0.04);
      // small denticles toward the point
      for (const [t, l] of [[0.64, 0.016], [0.675, 0.024], [0.71, 0.014], [0.745, 0.027], [0.78, 0.018], [0.815, 0.022], [0.845, 0.012]] as const)
        tooth(t, inward(t, 0.12, 0.35), F(l), F(0.006), F(0.0035), 0);
      // the forked point: the upper tine
      tooth(0.88, dirAt(0.88).add(new THREE.Vector3(0, 1.0, 0)).add(inward(0.88, 0, 0).multiplyScalar(0.45)).normalize(), F(0.055), F(0.011), F(0.008), -0.06);
    },
    (x, y, z) => {
      // reddish chestnut, darker toward the points; the teeth (off the centre line, inward) darker still
      const d = Math.hypot(x, z);
      const k = ss(ml * 0.25, ml * 0.62, d);
      col.copy(base).lerp(mid, k).lerp(tip, ss(ml * 0.62, ml * 0.98, d));
      return col;
    },
  );
  if (side < 0) {
    // mirror across z and flip the winding
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, -pos.getZ(i));
      nrm.setZ(i, -nrm.getZ(i));
    }
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  return g;
}

/** Leg segments, modelled along +y from 0 to 1 at unit thickness (x outward, z the flat side). */
function segGeo(kind: 'coxa' | 'femur' | 'tibia1' | 'tibia' | 'tarsus' | 'scape' | 'funicle' | 'club'): THREE.BufferGeometry {
  return build((acc) => {
    const Y = (y: number, x = 0, z = 0) => new THREE.Vector3(x, y, z);
    const reg = kind === 'scape' || kind === 'funicle' || kind === 'club' ? REGION.CR_ANT : REGION.CR_LEG;
    if (kind === 'coxa') put(acc, tube([Y(-0.04), Y(0.5), Y(1.04)], [1.0, 1.2, 0.95], 12, false, false, 0.8), reg);
    else if (kind === 'femur') {
      const pts: THREE.Vector3[] = [];
      const rad: number[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(Y(-0.03 + t * 1.06));
        // a narrow neck at the trochanter, broad and flattened, the knee condyles at the end
        rad.push(0.7 + 0.5 * Math.sin(Math.PI * Math.pow(t, 0.8)) - 0.15 * t + 0.18 * ss(0.86, 1, t));
      }
      put(acc, tube(pts, rad, 14, false, false, 0.85), reg);
    } else if (kind === 'tibia1' || kind === 'tibia') {
      const fore = kind === 'tibia1';
      const pts: THREE.Vector3[] = [];
      const rad: number[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(Y(t, fore ? 0.25 * t * t : 0));
        rad.push(fore ? 0.7 + 0.75 * t : 0.72 + 0.22 * t);
      }
      put(acc, tube(pts, rad, 14, false, false, fore ? 0.82 : 0.92), reg);
      // teeth on the outer edge (the fore tibia digs; the others carry small spines), and the apical spurs
      const teeth = fore ? [0.42, 0.6, 0.76, 0.9] : [0.5, 0.72];
      // (y is in leg lengths, x and z in thicknesses: keep the teeth's y offsets tiny) — small, blunt teeth
      for (const t of teeth) {
        const r0 = fore ? 0.22 + 0.16 * t : 0.16;
        const a = Y(t, (fore ? 0.25 * t * t : 0) + (fore ? 0.7 + 0.75 * t : 0.7) * 0.6);
        const b = a.clone().add(new THREE.Vector3(fore ? 0.5 : 0.32, fore ? 0.012 : 0.015, 0));
        put(acc, tube([a, b], [r0, 0.05], 6, false, true), reg);
      }
      for (const z of [-0.4, 0.4]) put(acc, tube([Y(0.97, 0, z * (fore ? 0.5 : 0.7)), Y(1.06, -0.3, z)], [0.26, 0.03], 6, false, true), reg);
      // rows of fine spines along the tibia (the mid and hind tibiae of Lucanus are spinose)
      if (!fore)
        for (let k = 0; k < 7; k++) {
          const t = 0.18 + k * 0.11;
          const zz = (k % 2 ? -0.45 : 0.45) * 0.8;
          const a0 = Y(t, 0.55, zz);
          put(acc, tube([a0, a0.clone().add(new THREE.Vector3(0.75, 0.035, zz * 0.4))], [0.12, 0.02], 5, false, true), reg);
        }
    } else if (kind === 'tarsus') {
      const shares = [0.18, 0.14, 0.13, 0.13, 0.42];
      let y = 0;
      for (let k = 0; k < 5; k++) {
        const l = shares[k];
        const r = k === 4 ? 0.6 : 0.8 - k * 0.04;
        // each tarsomere widening toward its tip, flattened, the next set into it
        put(acc, tube([Y(y), Y(y + l * 0.4), Y(y + l)], [r * 0.72, r * 0.88, r], 10, false, false, 0.7), reg);
        y += l;
      }
      // two curved claws
      for (const z of [-0.35, 0.35]) put(acc, tube([Y(0.96, 0, z), Y(1.04, 0.25, z * 1.3), Y(1.09, -0.45, z * 1.4)], [0.24, 0.15, 0.02], 6, false, true), reg);
    } else if (kind === 'scape') {
      put(acc, tube([Y(0), Y(0.5), Y(0.92), Y(1)], [0.75, 0.8, 1.0, 0.9], 10, false, false), reg);
    } else if (kind === 'funicle') {
      for (let k = 0; k < 6; k++) put(acc, ellipsoid(new THREE.Vector3(0, (k + 0.5) / 6, 0), new THREE.Vector3(0.6 / 6 + 0.02, 0.85, 0.85), 10, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)), reg);
    } else {
      // the club: four lamellae combed out to one side (+x)
      for (let k = 0; k < 4; k++) {
        const y = (k + 0.5) / 4;
        put(acc, ellipsoid(new THREE.Vector3(0.65, y, 0), new THREE.Vector3(1.05, 0.11, 0.5), 12), reg);
        put(acc, ellipsoid(new THREE.Vector3(0, y, 0), new THREE.Vector3(0.5, 0.13, 0.5), 8), reg);
      }
    }
  });
}

let registered = false;
/** Register the stag beetle's parts (once; geometry is built when first drawn). */
export function registerStagParts(): void {
  if (registered) return;
  registered = true;
  const fam = 'stag';
  registerPart('stag_elytra', { family: fam, make: elytraGeo });
  registerPart('stag_pronotum', { family: fam, make: pronotumGeo });
  registerPart('stag_head', { family: fam, make: headGeo });
  registerPart('stag_under', { family: fam, make: underGeo });
  registerPart('stag_mandL', { family: fam, make: () => mandibleGeo(1) });
  registerPart('stag_mandR', { family: fam, make: () => mandibleGeo(-1) });
  for (const k of ['coxa', 'femur', 'tibia1', 'tibia', 'tarsus', 'scape', 'funicle', 'club'] as const) registerPart(`stag_${k}`, { family: fam, make: () => segGeo(k) });
}

// --------------------------------------------------------------------------- the animal

const C = (hex: number) => new THREE.Color(hex);
/** Colours (docs/creatures/stagBeetle.md): chestnut elytra, black head, pronotum, legs and underside. */
// colours sampled from specimen and field photos (docs/realism/references.md): maroon elytra and mandibles
export const SG2 = { gold: C(0x4a3a26), elytra: C(0x4e2420), black: C(0x2a2623), leg: C(0x1e1a18), under: C(0x1a1612), eye: C(0x080605), mand: C(0xffffff) };
const S = (rough: number, gloss: number) => ({ rough, gloss, pattern: 0, scale: 1 });
// realism v2: satin, not lacquer (the clearcoat roughness per region is in render/bake/recipes.ts)
const SURF = { elytra: S(0.38, 0.42), shield: S(0.58, 0.25), head: S(0.66, 0.18), mand: S(0.5, 0.35), leg: S(0.42, 0.42), under: S(0.6, 0.15), eye: S(0.1, 1.0) };
const HAIR = { rough: 0.9, gloss: 0, pattern: 2, scale: 3 };
const jit = new THREE.Color();
/** Each beetle a little different (hue and value), from its variation seed. */
function jitter(c: THREE.Color, v: number, k = 1): THREE.Color {
  return jit.copy(c).multiplyScalar(1 + (v - 0.5) * 0.16 * k).offsetHSL((v - 0.5) * 0.02 * k, (0.5 - v) * 0.06 * k, 0);
}

/** Creature states used here (render mirror of sim/creatures/creatureAI.ts CS). */
const ST = { WindUp: 8, Rear: 15, Strike: 18, Lift: 19 } as const;

const hip = new V();
const foot = new V();
const knee = new V();
const ankle = new V();
const tA = new V();
const tB = new V();
const side = new V();
const head = new THREE.Matrix4();
const mloc = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const sc = new THREE.Vector3();
const pv = new THREE.Vector3();

/** Rest legs: [hip x, hip z, foot x, foot reach, femur, tibia, tarsus] (fractions of L). */
const LEGS: Array<[number, number, number, number, number, number, number]> = [
  // long, slender legs (a specimen's fore legs reach past the mandible bases)
  [-0.02, 0.055, 0.19, 0.31, 0.15, 0.15, 0.13],
  [-0.11, 0.07, -0.15, 0.37, 0.16, 0.16, 0.14],
  [-0.17, 0.08, -0.43, 0.33, 0.17, 0.18, 0.15],
];

/** Knee for a two-bone leg from hip to foot (bending up and out), the foot clamped to its reach. */
function solveKnee(h: V, f: V, l1: number, l2: number, outZ: number, out: V): void {
  let dx = f.x - h.x;
  let dy = f.y - h.y;
  let dz = f.z - h.z;
  let d = Math.hypot(dx, dy, dz);
  const max = (l1 + l2) * 0.999;
  if (d > max) {
    const k = max / d;
    dx *= k;
    dy *= k;
    dz *= k;
    d = max;
    f.set(h.x + dx, h.y + dy, h.z + dz);
  }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  // a beetle's knees stick out sideways at about body height: bend mostly outward, a little up
  let bx = 0;
  let by = 0.45;
  let bz = outZ;
  const dot = bx * ux + by * uy + bz * uz;
  bx -= dot * ux;
  by -= dot * uy;
  bz -= dot * uz;
  const bl = Math.hypot(bx, by, bz) || 1;
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  out.set(h.x + ux * along + (bx / bl) * hh, h.y + uy * along + (by / bl) * hh, h.z + uz * along + (bz / bl) * hh);
}

/**
 * Pose and draw one stag beetle. States: walking (a slow, heavy tripod gait, the body rocking with each
 * step), WindUp (antlers wide, head down: about to grab), Lift (an ant clamped in the antlers, the head and
 * forebody raised), Strike (the toss: the head flicks up and to the side, antlers opening), Rear (enraged:
 * reared up on the middle and hind legs, forelegs raised, antlers spread, then the slam), dead (on its back).
 */
export function stagBeetle2(rig: Rig, p: CrPose): void {
  registerStagParts();
  const L = p.L * (p.dead ? 1 - 0.4 * p.eaten : 1);
  const k = L / STAG_REF;
  const st = p.st;
  const rear = p.state === ST.Rear ? ease(st * 1.8) * (1 - ease((st - 1.15) * 6)) : 0;
  const slam = p.state === ST.Rear ? ease((st - 1.15) * 6) * (1 - ease((st - 1.5) * 3)) : 0;
  const wind = p.state === ST.WindUp ? ease(st * 2.5) : 0;
  const lift = p.state === ST.Lift ? ease(st * 3) : 0;
  const toss = p.state === ST.Strike ? Math.sin(Math.min(1, st * 2.2) * Math.PI) : 0;
  // heavy gait: the body rolls toward the planted tripod and heaves a little each step
  const ph = p.phase * Math.PI * 2;
  const amp = p.dead ? 0 : p.amp;
  // the renderer advances the gait by STRIDE·L·max(.35, amp) per cycle: sweep exactly that during the stance
  // (so planted feet never slide), and lift the feet only while it walks
  const moving = Math.min(1, amp * 4);
  // (when it stops, the feet settle back to their rest places)
  const sweep = 0.22 * Math.max(0.35, amp) * 0.6 * Math.min(1, amp * 6);
  const roll = Math.sin(ph) * 0.045 * moving + (p.dead ? Math.PI * ease(p.deadT * 2) : 0);
  const heave = Math.abs(Math.sin(ph)) * L * 0.006 * moving;
  const pitchUp = rear * 0.52 + lift * 0.16 + wind * -0.05 - slam * 0.04;
  // place the body: tilted to the ground under its front and back, then reared
  {
    const c = Math.cos(p.h);
    const s = Math.sin(p.h);
    const hf = p.ground(p.x + c * L * 0.25, p.z + s * L * 0.25);
    const hb = p.ground(p.x - c * L * 0.3, p.z - s * L * 0.3);
    const pitch = Math.atan2(hf - hb, L * 0.55) + pitchUp;
    const flip = p.dead ? L * SB.elytra.top * (1 - Math.cos(roll)) : 0;
    // rearing pivots on the hind legs: raise the centre so the elytra apex stays near the ground
    const raise = Math.sin(pitchUp) * L * 0.36 + heave + flip;
    rig.setBase(p.x, (hf + hb) / 2 + raise, p.z, p.h, pitch, roll);
    rig.recFrame('body');
  }
  // body shell
  rig.part('stag_under', 0, 0, 0, k, SG2.under, SURF.under);
  rig.part('stag_elytra', 0, 0, 0, k, jitter(SG2.elytra, p.v2), SURF.elytra);
  rig.part('stag_pronotum', 0, 0, 0, k, SG2.black, SURF.shield);
  // scutellum
  rig.ell(-0.08 * L, 0.174 * L, 0, 0.012 * L, 0.003 * L, 0.011 * L, SG2.black, SURF.shield);
  // golden hair at the joints: behind the pronotum (around the scutellum) and in front of it
  rig.ell(-0.077 * L, 0.16 * L, 0, 0.005 * L, 0.004 * L, 0.06 * L, SG2.gold, HAIR);
  rig.ell(0.043 * L, 0.118 * L, 0, 0.004 * L, 0.004 * L, 0.06 * L, SG2.gold, HAIR);

  // head frame: pitches about the neck (down to grab, up to lift and toss), yaws a little in the toss
  const tossSide = p.v2 > 0.5 ? 1 : -1;
  const hPitch = -0.12 * wind + 0.32 * lift + 0.42 * toss + 0.12 * rear - 0.08 * slam;
  const hYaw = 0.35 * toss * tossSide + Math.sin(p.t * 0.7 + p.v2 * 6) * 0.03 * (1 - amp);
  e.set(0, hYaw, hPitch, 'YZX');
  q.setFromEuler(e);
  pv.set(SB.neck.x * L, SB.neck.y * L, 0);
  head.compose(pv, q, sc.set(1, 1, 1));
  mloc.makeTranslation(-SB.neck.x * L, -SB.neck.y * L, 0);
  head.multiply(mloc);
  rig.sub = head;
  rig.part('stag_head', 0, 0, 0, k, SG2.black, SURF.head);
  for (const sd of [-1, 1]) rig.ell(SB.eye.x * L, SB.eye.y * L, sd * (SB.eye.z - 0.008) * L, 0.015 * L, 0.013 * L, 0.009 * L, SG2.eye, SURF.eye);
  // antler mandibles: open in the wind-up and when rearing, clamped while lifting, flung open in the toss
  const idle = 0.12 + 0.05 * Math.sin(p.t * 1.3 + p.v2 * 5);
  const open = p.dead ? 0.25 : Math.max(idle, wind * 0.62, rear * 0.55, toss * 0.5) * (1 - lift * 0.85) + lift * 0.02;
  for (const sd of [-1, 1] as const) {
    // a positive yaw turns +x toward −z: open the left (+z) antler with a negative one
    rig.part(sd > 0 ? 'stag_mandL' : 'stag_mandR', SB.mand.x * L, SB.mand.y * L, sd * SB.mand.z * L, k, SG2.mand, SURF.mand, -sd * open, 0.05);
  }
  // antennae: elbowed — a long scape out to the side, the funicle forward, the comb club; waving a little
  for (const sd of [-1, 1]) {
    const wv = Math.sin(p.t * 2.2 + sd + p.v2 * 7) * 0.12;
    tA.set(SB.ant.x * L, SB.ant.y * L, sd * SB.ant.z * L);
    tB.set(tA.x + 0.01 * L, tA.y + 0.014 * L, tA.z + sd * 0.12 * L);
    side.set(0, 1, 0);
    rig.partFrame('stag_scape', tA, tB, side, 0.006 * L, 0.006 * L, SG2.black, SURF.leg);
    // the elbow: the funicle turns forward from the end of the long scape
    const fx = Math.cos(0.2 + wv);
    const fz = Math.sin(0.2 + wv);
    tA.copy(tB);
    tB.set(tA.x + fx * 0.095 * L, tA.y + 0.004 * L, tA.z + sd * fz * 0.095 * L);
    rig.partFrame('stag_funicle', tA, tB, side, 0.0052 * L, 0.0052 * L, SG2.black, SURF.leg);
    tA.copy(tB);
    tB.set(tA.x + fx * 0.045 * L, tA.y + 0.003 * L, tA.z + sd * fz * 0.045 * L);
    side.set(-fz * sd * 0.3, 0.2, fx * sd);
    rig.partFrame('stag_club', tA, tB, side, 0.006 * L, 0.006 * L, SG2.black, SURF.leg);
  }
  rig.sub = null;

  // legs: tripod gait, slow and deliberate; feet planted on the ground below them
  LEGS.forEach(([hx, hz, fx, reach, l1, l2, l3], i) => {
    for (const sd of [-1, 1]) {
      hip.set(hx * L, (SB.belly + 0.025) * L, sd * hz * L);
      if (p.dead) {
        const tw = Math.sin(p.t * 7 + i * 2 + sd) * 0.08 * Math.max(0, 1 - p.deadT / 4);
        foot.set((hx * 0.6 + tw) * L, hip.y - 0.12 * L, sd * (hz + 0.08) * L);
      } else {
        footAt(foot, fx * L, sd * reach * L, p.phase + tripod(i, sd), sweep * L, 0.05 * L * moving, 1, 0.6);
        // a rearing beetle lifts its fore legs and waves them; the others brace wider
        if (i === 0 && rear > 0) foot.set(foot.x + 0.12 * L * rear, foot.y + 0.18 * L * rear + Math.sin(p.t * 9 + sd) * 0.02 * L * rear, foot.z + sd * 0.04 * L * rear);
        else if (rear > 0) foot.set(foot.x - 0.05 * L * rear, foot.y, foot.z + sd * 0.04 * L * rear);
        if (!(i === 0 && rear > 0.3)) foot.y += rig.groundAt(foot.x, foot.z, p.ground);
      }
      // tarsus lies along the ground from the ankle to the claws
      const dx = foot.x - hip.x;
      const dz = foot.z - hip.z;
      const dl = Math.hypot(dx, dz) || 1;
      const tl = l3 * L;
      ankle.set(foot.x - (dx / dl) * tl * 0.82, foot.y + tl * 0.32, foot.z - (dz / dl) * tl * 0.82);
      solveKnee(hip, ankle, l1 * L, l2 * L, sd, knee);
      side.set(dz / dl, 0, -dx / dl);
      // femora ~4 mm across on a 100 mm beetle, flattened; tibiae a little thinner, tarsi slender
      const r = 0.02 * L;
      rig.partFrame('stag_coxa', hip, tA.set(hip.x, hip.y - 0.004 * L, hip.z + sd * 0.022 * L), side, r * 1.2, r * 1.2, SG2.leg, SURF.leg);
      rig.partFrame('stag_femur', tA, knee, side, r * 1.1, r * 0.9, SG2.leg, SURF.leg);
      side.set(0, 1, 0);
      rig.partFrame(i === 0 ? 'stag_tibia1' : 'stag_tibia', knee, ankle, side, r * (i === 0 ? 0.95 : 0.8), r * 0.75, SG2.leg, SURF.leg);
      rig.partFrame('stag_tarsus', ankle, foot, side, r * 0.5, r * 0.5, SG2.leg, SURF.leg);
      rig.recLeg((sd > 0 ? 'L' : 'R') + (i + 1), hip, knee, ankle, foot);
    }
  });
}
