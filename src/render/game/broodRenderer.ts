import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World } from '../../sim/world';
import { casteOf, isTermiteSpecies } from '../../sim/species';
import { InstancedPool } from './instancedPool';
import { SpaceMapper } from './foodRenderer';

/**
 * Brood (Revision 2, EotU style): small glossy cream eggs — carried in a
 * worker's mandibles (pulled from the queen's abdomen), or set on a brood tile — and
 * soft white C-shaped larvae that visibly grow on their tile as they develop,
 * with a faint pulsing idle motion. (The cocoon and naked-pupa models are
 * kept for possible later use.)
 */
function eggGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 10, 8);
  g.scale(1, 0.62, 0.62);
  g.deleteAttribute('uv');
  return g;
}

function larvaGeo(): THREE.BufferGeometry {
  // C-shaped tube with segment bulges; head at one end.
  const pts: THREE.Vector3[] = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = -0.3 + t * Math.PI * 1.15;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 40, 0.2, 10, false);
  const pos = tube.attributes.position;
  const v = new THREE.Vector3();
  // segment bulges + taper toward the head end
  for (let i = 0; i < pos.count; i++) {
    const seg = Math.floor(i / 11);
    const t = seg / 40;
    const center = curve.getPointAt(Math.min(1, t));
    v.fromBufferAttribute(pos, i).sub(center);
    const bulge = 1 + 0.08 * Math.cos(t * Math.PI * 22);
    const taper = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05));
    v.multiplyScalar(bulge * taper);
    v.add(center);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  tube.deleteAttribute('uv');
  const head = new THREE.SphereGeometry(0.11, 8, 6);
  const e = curve.getPointAt(1);
  head.translate(e.x, e.y + 0.02, e.z);
  head.deleteAttribute('uv');
  const g = mergeGeometries([tube.toNonIndexed(), head.toNonIndexed()]);
  // vertex colours: creamy body, amber head
  const cols = new Float32Array(g.attributes.position.count * 3);
  const tubeCount = tube.toNonIndexed().attributes.position.count;
  for (let i = 0; i < g.attributes.position.count; i++) {
    const c = i < tubeCount ? new THREE.Color(0xf2ead8) : new THREE.Color(0xc89a5a);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  g.translate(0.05, 0, -0.1);
  return g;
}

function cocoonGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 14, 10);
  g.scale(1, 0.48, 0.48);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    // slightly pointed at one end, faint silk wrinkles
    const s = 1 - 0.12 * Math.max(0, x) + 0.02 * Math.sin(x * 40 + pos.getZ(i) * 30);
    pos.setY(i, pos.getY(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
  }
  g.deleteAttribute('uv');
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    // dark meconium spot at the rear pole of formicine cocoons
    const c = x < -0.43 ? new THREE.Color(0x4a3420) : new THREE.Color(0xd8c49a).multiplyScalar(0.92 + 0.08 * Math.sin(i));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

function nakedPupaGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, c: number) => {
    g.deleteAttribute('uv');
    const ng = g.index ? g.toNonIndexed() : g;
    const cols = new Float32Array(ng.attributes.position.count * 3);
    const col = new THREE.Color(c);
    for (let i = 0; i < ng.attributes.position.count; i++) cols.set([col.r, col.g, col.b], i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    parts.push(ng);
  };
  const gaster = new THREE.SphereGeometry(0.22, 12, 8);
  gaster.scale(1.3, 1, 1);
  gaster.translate(-0.28, 0, 0);
  add(gaster, 0xf4eee2);
  const thorax = new THREE.SphereGeometry(0.14, 10, 8);
  thorax.scale(1.4, 1, 0.9);
  thorax.translate(0.08, 0.02, 0);
  add(thorax, 0xf0e8da);
  const head = new THREE.SphereGeometry(0.15, 10, 8);
  head.translate(0.34, -0.04, 0);
  add(head, 0xeee4d2);
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.04, 6, 5);
    eye.translate(0.38, 0.02, s * 0.12);
    add(eye, 0x6a4a3a);
    // legs and antennae folded tight against the ventral side
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.CapsuleGeometry(0.025, 0.28, 3, 6);
      leg.rotateZ(Math.PI / 2 + 0.25);
      leg.translate(0.06 - k * 0.1, -0.13, s * (0.06 + k * 0.02));
      add(leg, 0xe8dcc6);
    }
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

export class BroodRenderer {
  group = new THREE.Group();
  private egg: InstancedPool;
  private larva: InstancedPool;
  private cocoon: InstancedPool;
  private naked: InstancedPool;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor() {
    const translucent = new THREE.MeshPhysicalMaterial({ color: 0xf8f4ea, roughness: 0.35, transmission: 0, thickness: 0.4, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.6 });
    this.egg = new InstancedPool(eggGeo(), translucent, this.group, 64);
    const soft = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, clearcoat: 0.4, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) });
    this.larva = new InstancedPool(larvaGeo(), soft, this.group, 64);
    this.cocoon = new InstancedPool(cocoonGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), this.group, 64);
    this.naked = new InstancedPool(nakedPupaGeo(), soft, this.group, 64);
  }

  update(w: World, colony: number, map: SpaceMapper, alpha: number): void {
    this.egg.begin();
    this.larva.begin();
    this.cocoon.begin();
    this.naked.begin();
    const c = w.colony(colony);
    const time = w.time;
    // (no egg pile: EotU-style, a worker pulls each egg from the queen's abdomen and carries it off)
    const termites = !!c && isTermiteSpecies(c.species);
    for (const b of w.s.brood) {
      if (b.colony !== colony) continue;
      // termites: larvae are drawn by the model kit, carried eggs by the carrier's own look
      if (termites && (b.stage === 1 || b.carrier !== 0)) continue;
      const cd = casteOf(b.caste);
      const L = cd.length;
      const carried = b.carrier !== 0;
      let rot = (b.id * 2.399) % (Math.PI * 2);
      let size: number;
      let pool: InstancedPool;
      if (b.stage === 0) {
        size = Math.max(0.35, L * 0.16);
        pool = this.egg;
        const ant = carried ? w.antById.get(b.carrier) : undefined;
        if (ant) rot = ant.h;
      } else {
        // the larva grows with its progress and breathes gently
        const pulse = 1 + 0.045 * Math.sin(time * 2.6 + b.id);
        size = L * (0.28 + 0.62 * Math.min(1, b.t)) * pulse;
        pool = this.larva;
      }
      map.pos(b.x, b.y, size * 0.3 + (carried ? L * 0.18 : 0), this.p);
      map.quat(rot, this.q);
      this.s.setScalar(size);
      this.m.compose(this.p, this.q, this.s);
      pool.add(this.m);
    }
    this.egg.end();
    this.larva.end();
    this.cocoon.end();
    this.naked.end();
    void alpha;
  }
}
