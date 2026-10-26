import * as THREE from 'three';
import { World } from '../../sim/world';
import { Rng } from '../../core/rng';
import { InstancedPool } from './instancedPool';
import { crumbGeometry } from './foodModels';
import { globalUniforms, patchDapple } from '../shaderPatch';
import { Food, SURFACE } from '../../sim/types';

/** Colour every vertex of a geometry. */
function tint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const a = new Float32Array(ng.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}

/** Aphid: pear-shaped soft body with siphunculi, legs tucked; ~2 mm. */
function aphidGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 10, 8);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const k = 0.75 + 0.35 * Math.max(0, -x); // wider abdomen at the rear
    p.setY(i, p.getY(i) * k * 0.75);
    p.setZ(i, p.getZ(i) * k);
  }
  body.computeVertexNormals();
  return body;
}

/** Flat radial decal (unit radius ≈ the hole) with RGBA vertex colours. */
function holeDecal(): THREE.BufferGeometry {
  const rings: Array<[number, number, number]> = [
    [0, 0.015, 1],
    [0.5, 0.02, 1],
    [0.85, 0.07, 0.9],
    [1.1, 0.2, 0.55],
    [1.6, 0.16, 0],
  ];
  const seg = 28;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  rings.forEach(([r, l, a], ri) => {
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const wob = ri > 0 ? 1 + 0.08 * Math.sin(t * 3 + ri) + 0.05 * Math.sin(t * 7) : 1;
      pos.push(Math.cos(t) * r * wob, 0, Math.sin(t) * r * wob);
      const c = new THREE.Color().setHSL(0.07, 0.35, l, THREE.SRGBColorSpace);
      col.push(c.r, c.g, c.b, a);
    }
  });
  for (let ri = 0; ri < rings.length - 1; ri++)
    for (let i = 0; i < seg; i++) {
      const a = ri * seg + i;
      const b = ri * seg + ((i + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** Simple dicot seedling leaf (unit length along +x), slightly cupped. */
function plantLeafGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 0.55, 6, 3);
  g.translate(0.5, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const w = Math.sin(Math.PI * Math.min(1, x)) * (1 - x * 0.25);
    p.setY(i, y * w);
    p.setZ(i, -Math.abs(y * w) * 0.35 + Math.sin(x * Math.PI) * 0.08);
  }
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return tint(g, 0xffffff);
}

/**
 * Surface features driven by the simulation: nest entrance holes with their
 * spoil rings, aphid colonies on plant stems and leafy plants that Atta cut.
 */
export class SurfaceDecor {
  group = new THREE.Group();
  private holes: InstancedPool;
  private spoil: InstancedPool;
  private aphids: InstancedPool;
  private stems: InstancedPool;
  private leaves: InstancedPool;
  /** food view: pulsing amber rings around every food item */
  private foodRings: InstancedPool;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private e = new THREE.Euler();

  constructor() {
    const vc = (rough: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, ...extra });
      patchDapple(m);
      return m;
    };
    // Entrance: a soft-edged dark opening with a ring of freshly turned, lighter soil.
    this.holes = new InstancedPool(holeDecal(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), this.group, 8, false);
    this.spoil = new InstancedPool(crumbGeometry(), vc(0.95), this.group, 256);
    this.aphids = new InstancedPool(tint(aphidGeometry(), 0xffffff), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.5, sheen: 0.3 }), this.group, 128);
    const stem = new THREE.CylinderGeometry(0.5, 0.7, 1, 6);
    stem.translate(0, 0.5, 0);
    this.stems = new InstancedPool(tint(stem, 0x5f8a3a), vc(0.7), this.group, 64);
    this.leaves = new InstancedPool(plantLeafGeometry(), vc(0.6, { side: THREE.DoubleSide }), this.group, 256);
    const ring = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
    this.foodRings = new InstancedPool(
      ring,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: globalUniforms.uTime },
        vertexShader: 'varying float vR; void main(){ vR = length(position.xz); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform float uTime; varying float vR; void main(){ float a = (0.55 + 0.35*sin(uTime*4.0)) * smoothstep(0.8, 0.9, vR) * smoothstep(1.0, 0.92, vR); gl_FragColor = vec4(vec3(1.0,0.75,0.3)*a, a); }',
      }),
      this.group,
      64,
      false,
    );
  }

  /** `foodView`: ring the food the viewer's colony can gather (`canEat`; others are not highlighted). */
  update(w: World, foodView = false, canEat?: (f: Food) => boolean): void {
    const t = w.terrain;
    const h = (x: number, y: number) => t.walkHeight(Math.min(Math.max(x, 0), t.width), Math.min(Math.max(y, 0), t.depth));
    for (const pool of [this.holes, this.spoil, this.aphids, this.stems, this.leaves, this.foodRings]) pool.begin();
    if (foodView)
      for (const f of w.s.food) {
        if (f.space !== SURFACE || f.heldBy || (f.kind === 'corpse' && f.colony >= 0) || (canEat && !canEat(f))) continue;
        const r = Math.max(4, f.size * 1.3);
        this.p.set(f.x, h(f.x, f.y) + 0.4, f.y);
        this.s.set(r, 1, r);
        this.m.compose(this.p, this.q.identity(), this.s);
        this.foodRings.add(this.m);
      }
    // Entrances and spoil rings
    for (const col of w.s.colonies) {
      col.entrances.forEach((e, i) => {
        const r = 2.6;
        this.p.set(e.sx, h(e.sx, e.sy) + 0.15, e.sy);
        this.s.set(r, 1, r);
        this.m.compose(this.p, this.q.identity(), this.s);
        this.holes.add(this.m);
        const rng = new Rng(col.id * 1000 + i * 17 + 3);
        const n = Math.min(90, 14 + Math.floor((col.spoil[i] ?? 0) * 1.5));
        for (let k = 0; k < n; k++) {
          const a = rng.range(0, Math.PI * 2);
          const d = r + 0.6 + Math.abs(rng.gauss()) * (2 + Math.min(6, (col.spoil[i] ?? 0) * 0.05));
          const x = e.sx + Math.cos(a) * d;
          const y = e.sy + Math.sin(a) * d;
          const sz = rng.range(0.5, 1.2);
          this.p.set(x, h(x, y) + sz * 0.25, y);
          this.e.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
          this.q.setFromEuler(this.e);
          this.s.setScalar(sz);
          this.m.compose(this.p, this.q, this.s);
          this.spoil.add(this.m, this.c.setHSL(0.07, 0.38, rng.range(0.13, 0.27), THREE.SRGBColorSpace));
        }
      });
    }
    // Caves and lairs: a wider hollow ringed with weathered stones and old leaf litter
    for (const cv of w.s.caves) {
      cv.entrances.forEach((e, i) => {
        const r = cv.kind === 'lair' ? 3.6 : 3.2;
        this.p.set(e.sx, h(e.sx, e.sy) + 0.15, e.sy);
        this.s.set(r, 1, r);
        this.m.compose(this.p, this.q.identity(), this.s);
        this.holes.add(this.m);
        const rng = new Rng(cv.space * 977 + i * 31 + 5);
        for (let k = 0; k < 26; k++) {
          const a = rng.range(0, Math.PI * 2);
          const d = r + 0.4 + Math.abs(rng.gauss()) * 2.2;
          const x = e.sx + Math.cos(a) * d;
          const y = e.sy + Math.sin(a) * d;
          const sz = rng.range(0.8, 2.0);
          this.p.set(x, h(x, y) + sz * 0.2, y);
          this.e.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
          this.q.setFromEuler(this.e);
          this.s.set(sz, sz * 0.6, sz);
          this.m.compose(this.p, this.q, this.s);
          this.spoil.add(this.m, this.c.setHSL(cv.kind === 'lair' ? 0.06 : 0.1, 0.12, rng.range(0.22, 0.38), THREE.SRGBColorSpace));
        }
      });
    }
    // Aphid colonies clustered on a plant stem
    for (const ap of w.s.aphids) {
      const rng = new Rng(ap.id * 31 + 1);
      const stemH = 14 + rng.range(0, 8);
      const base = h(ap.x, ap.y);
      this.p.set(ap.x, base, ap.y);
      this.s.set(1, stemH, 1);
      this.m.compose(this.p, this.q.identity(), this.s);
      this.stems.add(this.m);
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2);
        this.p.set(ap.x, base + stemH * (0.55 + k * 0.15), ap.y);
        this.e.set(0, a, 0.5);
        this.q.setFromEuler(this.e);
        this.s.setScalar(stemH * 0.5);
        this.m.compose(this.p, this.q, this.s);
        this.leaves.add(this.m, this.c.setHSL(0.26, 0.45, 0.3, THREE.SRGBColorSpace));
      }
      const col = ap.green ? 0x7aa84a : 0x2a2a22;
      for (let k = 0; k < ap.n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const y = base + stemH * rng.range(0.15, 0.9);
        const sz = rng.range(1.4, 2.4);
        this.p.set(ap.x + Math.cos(a) * 0.8, y, ap.y + Math.sin(a) * 0.8);
        this.e.set(0, -a, Math.PI / 2 - 0.3);
        this.q.setFromEuler(this.e);
        this.s.setScalar(sz);
        this.m.compose(this.p, this.q, this.s);
        this.aphids.add(this.m, this.c.setHex(col).multiplyScalar(rng.range(0.85, 1.15)));
      }
    }
    // Leafy plants (leaf count follows remaining leaf area)
    for (const pl of w.s.plants) {
      const rng = new Rng(pl.v + 5);
      const base = h(pl.x, pl.y);
      const height = 10 + rng.range(0, 10);
      this.p.set(pl.x, base, pl.y);
      this.s.set(0.9, height, 0.9);
      this.m.compose(this.p, this.q.identity(), this.s);
      this.stems.add(this.m, this.c.setHSL(0.27, 0.4, 0.32, THREE.SRGBColorSpace));
      const total = 9;
      const shown = Math.round(total * Math.max(0, pl.leaf / pl.max));
      for (let k = 0; k < total; k++) {
        const a = k * 2.4 + rng.range(-0.3, 0.3);
        const ly = base + height * (0.25 + (k / total) * 0.75);
        const len = (14 - k * 0.7) * rng.range(0.85, 1.15);
        if (k >= shown) continue;
        // eaten leaves get shorter as fragments are cut away
        this.p.set(pl.x, ly, pl.y);
        this.e.set(0, a, -0.35 + rng.range(-0.15, 0.15));
        this.q.setFromEuler(this.e);
        this.s.setScalar(len);
        this.m.compose(this.p, this.q, this.s);
        this.leaves.add(this.m, this.c.setHSL(0.25 + rng.range(-0.02, 0.03), 0.5, 0.32 + rng.range(-0.05, 0.05), THREE.SRGBColorSpace));
      }
    }
    for (const pool of [this.holes, this.spoil, this.aphids, this.stems, this.leaves, this.foodRings]) pool.end();
  }
}
