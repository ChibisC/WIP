import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural food models (unit-ish size along x = 1). All carry vertex colours
 * and are merged so each kind is one instanced draw call.
 */
function colorize(g: THREE.BufferGeometry, c: THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.Color)): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (typeof c === 'function') col.copy(c(v));
    else col.set(c);
    arr.set([col.r, col.g, col.b], i * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (ng.attributes.uv) ng.deleteAttribute('uv');
  return ng;
}

function ell(rx: number, ry: number, rz: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg / 2 + 2));
  g.scale(rx, ry, rz);
  return g;
}

function stick(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 5): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

function legs(n: number, along: number, spread: number, len: number, r: number, color: number, curl: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    for (const s of [-1, 1]) {
      const x = (i / (n - 1) - 0.5) * along;
      const a = new THREE.Vector3(x, 0.05, s * spread * 0.4);
      const k = new THREE.Vector3(x + 0.05, 0.05 + len * 0.5, s * spread * (0.9 - curl * 0.3));
      const f = new THREE.Vector3(x + (i - 1) * 0.08, 0.05 + len * (0.4 + curl * 0.6), s * spread * (0.6 - curl * 0.4));
      out.push(colorize(stick(a, k, r, r * 0.8), color), colorize(stick(k, f, r * 0.8, r * 0.4), color));
    }
  }
  return out;
}

/** Dead housefly on its back: dark body, red eyes, glassy wings, curled legs. */
export function flyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const thorax = ell(0.2, 0.17, 0.17);
  parts.push(colorize(thorax, 0x2a2a2c));
  const abd = ell(0.26, 0.17, 0.19);
  abd.translate(-0.34, -0.02, 0);
  parts.push(colorize(abd, (p) => new THREE.Color(0x3a3530).lerp(new THREE.Color(0x6a6052), Math.sin(p.x * 30) * 0.5 + 0.5)));
  const head = ell(0.12, 0.13, 0.17);
  head.translate(0.27, 0, 0);
  parts.push(colorize(head, 0x302a28));
  for (const s of [-1, 1]) {
    const eye = ell(0.08, 0.1, 0.08);
    eye.translate(0.3, 0.02, s * 0.11);
    parts.push(colorize(eye, 0x7a1a12));
    const wing = ell(0.36, 0.01, 0.13, 10);
    wing.rotateY(s * 0.5);
    wing.translate(-0.2, -0.12, s * 0.2);
    parts.push(colorize(wing, (p) => new THREE.Color(0xb8bcc0).lerp(new THREE.Color(0x6a6e72), (Math.abs(Math.sin(p.x * 22 + p.z * 9)) < 0.1 ? 1 : 0) * 0.8)));
  }
  parts.push(...legs(3, 0.3, 0.3, 0.3, 0.018, 0x1a1a1a, 0.9));
  const g = mergeGeometries(parts);
  g.rotateX(Math.PI); // on its back
  g.translate(0, 0.18, 0);
  g.computeVertexNormals();
  return g;
}

/** Field cricket on its side: brown, big hind femora, long antennae. */
export function cricketGeometry(green = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = green ? 0x5d7a2e : 0x4a3220;
  const dark = green ? 0x3a5020 : 0x241810;
  const body = ell(0.5, 0.13, 0.12);
  parts.push(colorize(body, (p) => new THREE.Color(base).lerp(new THREE.Color(dark), (Math.sin(p.x * 26) * 0.5 + 0.5) * 0.5)));
  const head = ell(0.11, 0.12, 0.11);
  head.translate(0.52, 0.02, 0);
  parts.push(colorize(head, dark));
  const pron = ell(0.15, 0.13, 0.13);
  pron.translate(0.36, 0.03, 0);
  parts.push(colorize(pron, dark));
  for (const s of [-1, 1]) {
    // big hind femur + tibia
    const fem = ell(0.28, 0.06, 0.05);
    fem.rotateZ(0.5);
    fem.translate(-0.15, 0.14, s * 0.13);
    parts.push(colorize(fem, base));
    parts.push(colorize(stick(new THREE.Vector3(-0.38, 0.0, s * 0.14), new THREE.Vector3(0.02, -0.12, s * 0.16), 0.02, 0.015), dark));
    parts.push(colorize(stick(new THREE.Vector3(0.6, 0.06, s * 0.04), new THREE.Vector3(1.4, 0.35, s * 0.3), 0.008, 0.003), dark));
    parts.push(colorize(stick(new THREE.Vector3(0.3, -0.05, s * 0.09), new THREE.Vector3(0.38, -0.25, s * 0.22), 0.015, 0.01), dark));
    parts.push(colorize(stick(new THREE.Vector3(0.18, -0.05, s * 0.09), new THREE.Vector3(0.12, -0.26, s * 0.24), 0.015, 0.01), dark));
    // cerci
    parts.push(colorize(stick(new THREE.Vector3(-0.48, 0.02, s * 0.03), new THREE.Vector3(-0.7, 0.05, s * 0.09), 0.012, 0.004), dark));
  }
  const g = mergeGeometries(parts);
  g.rotateX(Math.PI / 2.2); // lying on its side
  g.translate(0, 0.12, 0);
  g.computeVertexNormals();
  return g;
}

export function mothGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = ell(0.35, 0.1, 0.1);
  parts.push(colorize(body, 0x8a7258));
  for (const s of [-1, 1]) {
    const wing = ell(0.42, 0.012, 0.42, 14);
    wing.translate(0.02, 0.06, s * 0.36);
    parts.push(colorize(wing, (p) => {
      const c = new THREE.Color(0x9a8468);
      const spot = Math.exp(-((p.x - 0.1) ** 2 + (Math.abs(p.z) - 0.4) ** 2) / 0.01);
      const band = Math.abs(Math.sin(p.x * 9 + Math.abs(p.z) * 4)) < 0.15 ? 0.25 : 0;
      return c.multiplyScalar(1 - spot * 0.6 - band);
    }));
  }
  const g = mergeGeometries(parts);
  g.translate(0, 0.06, 0);
  g.computeVertexNormals();
  return g;
}

export function beetleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const el = ell(0.42, 0.22, 0.25);
  el.translate(-0.08, 0, 0);
  parts.push(colorize(el, (p) => new THREE.Color(0x141414).lerp(new THREE.Color(0x2a2e34), Math.abs(Math.sin(p.z * 40)) > 0.9 ? 0.6 : 0)));
  const pr = ell(0.14, 0.15, 0.2);
  pr.translate(0.38, 0.02, 0);
  parts.push(colorize(pr, 0x161616));
  const hd = ell(0.09, 0.1, 0.12);
  hd.translate(0.55, 0, 0);
  parts.push(colorize(hd, 0x101010));
  parts.push(...legs(3, 0.4, 0.4, 0.34, 0.025, 0x0e0e0e, 0.8));
  const g = mergeGeometries(parts);
  g.rotateX(Math.PI);
  g.translate(0, 0.24, 0);
  g.computeVertexNormals();
  return g;
}

export function seedGeometry(): THREE.BufferGeometry {
  const g = ell(0.5, 0.2, 0.28, 12);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setX(i, x * (1 + 0.15 * Math.sign(x)));
    if (x > 0) pos.setZ(i, pos.getZ(i) * (1 - x * 0.6));
  }
  const cg = colorize(g, (p) => new THREE.Color(0x3a2e24).lerp(new THREE.Color(0xc8b896), Math.abs(Math.sin(p.z * 22)) < 0.35 ? 1 : 0));
  cg.translate(0, 0.18, 0);
  cg.computeVertexNormals();
  return cg;
}

export function berryGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const b = new THREE.SphereGeometry(0.5, 20, 14);
  parts.push(colorize(b, (p) => new THREE.Color(0x8a0e14).lerp(new THREE.Color(0x3a0408), Math.max(0, -p.y) * 0.8)));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    parts.push(colorize(stick(new THREE.Vector3(0, 0.48, 0), new THREE.Vector3(Math.cos(a) * 0.14, 0.53, Math.sin(a) * 0.14), 0.03, 0.01, 3), 0x3a3a1a));
  }
  const g = mergeGeometries(parts);
  g.translate(0, 0.45, 0);
  g.computeVertexNormals();
  return g;
}

export function appleGeometry(): THREE.BufferGeometry {
  // wedge of apple: white flesh, red skin on the outer curve
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.absarc(0, 0, 0.6, -0.5, 0.5, false);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2, curveSegments: 12 });
  g.translate(-0.3, 0, -0.22);
  g.rotateX(-Math.PI / 2);
  const cg = colorize(g, (p) => (Math.hypot(p.x + 0.3, p.z) > 0.55 ? new THREE.Color(0xa01818) : new THREE.Color(0xf0e2b8).lerp(new THREE.Color(0xc8a868), Math.random() * 0.15)));
  cg.computeVertexNormals();
  return cg;
}

export function crumbGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const s = 0.75 + 0.35 * Math.sin(pos.getX(i) * 9 + pos.getY(i) * 7) * Math.cos(pos.getZ(i) * 8);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.7, pos.getZ(i) * s);
  }
  const cg = colorize(g, 0xffffff);
  cg.translate(0, 0.3, 0);
  cg.computeVertexNormals();
  return cg;
}

/** Leaf fragment cut by a leafcutter: a semicircle, carried upright. */
export function leafFragGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.absarc(0, 0, 0.5, Math.PI, 0, true);
  shape.lineTo(-0.5, 0);
  const g = new THREE.ShapeGeometry(shape, 16);
  // slight bend
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.pow(pos.getX(i), 2) * 0.12);
  const cg = colorize(g, (p) => new THREE.Color(0x3f7a24).lerp(new THREE.Color(0x2c5a18), Math.abs(p.x) < 0.02 || Math.abs(Math.sin((p.x * 0.7 - p.y) * 14)) < 0.06 ? 0.8 : 0));
  cg.computeVertexNormals();
  return cg;
}

export function dropletGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 12, 8);
  g.scale(1, 0.7, 1);
  const cg = colorize(g, 0xe8c870);
  cg.translate(0, 0.3, 0);
  cg.computeVertexNormals();
  return cg;
}

/**
 * Deadwood (termite food): a lying stick of length 1 along x, a stump, a
 * dead palm frond, and a chewed fragment. Bark is grey-brown with darker
 * fissures; cut and chewed faces are pale. Sized per kind by the renderer.
 */
export function woodGeometry(kind: 'twig' | 'branch' | 'bamboo' | 'log' | 'stump' | 'palmFrond' | 'chip'): THREE.BufferGeometry {
  const bark = new THREE.Color(0x6a5240);
  const fissure = new THREE.Color(0x3a2c22);
  const pale = new THREE.Color(0xc8a878);
  if (kind === 'chip') {
    const g = new THREE.BoxGeometry(1, 0.35, 0.6, 2, 1, 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (1 - 0.3 * Math.sign(pos.getZ(i)) * pos.getX(i)));
    const cg = colorize(g, (p) => pale.clone().lerp(new THREE.Color(0x8a6a44), p.y > 0 ? 0.6 : 0.1));
    cg.translate(0, 0.18, 0);
    cg.computeVertexNormals();
    return cg;
  }
  if (kind === 'stump') {
    const g = new THREE.CylinderGeometry(0.42, 0.5, 0.6, 18, 3);
    const cg = colorize(g, (p) => (p.y > 0.29 ? pale.clone().lerp(new THREE.Color(0x9a7a52), Math.abs(Math.sin(Math.hypot(p.x, p.z) * 40)) * 0.6) : bark.clone().lerp(fissure, Math.abs(Math.sin(Math.atan2(p.z, p.x) * 9)) > 0.8 ? 0.7 : 0)));
    cg.translate(0, 0.3, 0);
    cg.computeVertexNormals();
    return cg;
  }
  if (kind === 'palmFrond') {
    const g = new THREE.PlaneGeometry(1, 0.32, 12, 4);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setZ(i, z * (1 - 0.7 * Math.max(0, x + 0.1)));
      pos.setY(i, 0.02 + Math.abs(z) * 0.25 + 0.04 * Math.sin(x * 20));
    }
    const cg = colorize(g, (p) => new THREE.Color(0x8a6a3c).lerp(new THREE.Color(0x5a4228), Math.abs(p.z) < 0.02 ? 0.8 : Math.abs(Math.sin(p.x * 60)) * 0.3));
    cg.computeVertexNormals();
    return cg;
  }
  const r = kind === 'twig' ? 0.05 : kind === 'branch' ? 0.08 : kind === 'bamboo' ? 0.07 : 0.2;
  const g = new THREE.CylinderGeometry(r * 0.85, r, 1, 10, kind === 'bamboo' ? 12 : 4);
  g.rotateZ(Math.PI / 2);
  const cg = colorize(g, (p) => {
    if (Math.abs(p.x) > 0.49) return pale.clone();
    if (kind === 'bamboo') return new THREE.Color(0xb89a5a).lerp(new THREE.Color(0x6a5228), Math.abs(Math.sin(p.x * Math.PI * 5)) < 0.12 ? 0.8 : 0);
    return bark.clone().lerp(fissure, Math.abs(Math.sin(Math.atan2(p.z, p.y) * 7 + p.x * 12)) > 0.85 ? 0.7 : 0);
  });
  cg.translate(0, r, 0);
  cg.computeVertexNormals();
  return cg;
}
