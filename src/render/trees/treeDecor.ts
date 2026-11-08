import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { trunkGeometry } from '../mapBiomes';
import { textures } from '../textures';
import { patchDapple } from '../shaderPatch';
import { World } from '../../sim/world';
import { TREES } from '../../sim/types';
import { TREES as T } from '../../sim/balance';
import { trunkDrawHeight } from '../../game/trunkMount';

/**
 * What the Trees layer adds to the two scenes (render only; with the layer on):
 * - on the ground: every tree's trunk rising out of view (`trunkGeometry`, the map decor's bark look) and the climb
 *   points at its foot — a worn patch of bark and a faint pale ring, so the player sees where ants go up;
 * - in the canopy: the trunk tops as rough bark discs where the climbs arrive, and the nest sites as subtle marks
 *   (a leaf cluster: a soft green ring; a hollow: a dark oval; a sheltered fork: a pale ring), empty in normal games.
 * The placeholder tree nest's hole is drawn by the canopy view's own entrance mark (the trunk-top disc look).
 */
export class TreeDecor {
  readonly ground = new THREE.Group();
  readonly canopy = new THREE.Group();
  private rings: THREE.Mesh[] = [];

  constructor(w: World, groundAt: (x: number, y: number) => number) {
    const d = w.s.trees;
    const g = w.nestOf(TREES);
    if (!d || !g) return;
    const tex = textures();
    const trunks: THREE.BufferGeometry[] = [];
    d.trunks.forEach((t, i) => {
      const geo = trunkGeometry({ circle: [t.x, t.y], r: t.r }, trunkDrawHeight(d), groundAt, 2100 + i * 41);
      if (geo) trunks.push(barkReady(geo));
    });
    if (trunks.length) {
      const mat = new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, roughness: 0.9, vertexColors: true, normalScale: new THREE.Vector2(1.5, 1.5) });
      patchDapple(mat);
      const m = new THREE.Mesh(mergeGeometries(trunks), mat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'treeTrunks';
      this.ground.add(m);
    }
    // climb points: a pale worn ring on the ground at each, and a darker patch of trodden bark up the trunk's foot
    const ringGeo = new THREE.RingGeometry(3.2, 4.4, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe8dcb0, transparent: true, opacity: 0.55, depthWrite: false });
    for (const t of d.trunks)
      for (const e of t.climbs) {
        const m = new THREE.Mesh(ringGeo, ringMat);
        m.position.set(e.sx, groundAt(e.sx, e.sy) + 0.25, e.sy);
        m.renderOrder = 2;
        this.ground.add(m);
        this.rings.push(m);
      }
    // in the canopy: trunk tops as rough bark discs (the climbs arrive here) and the site marks
    const topGeo = new THREE.CircleGeometry(1, 40);
    topGeo.rotateX(-Math.PI / 2);
    const topMat = new THREE.MeshStandardMaterial({ map: tex.bark.map, normalMap: tex.bark.normal, roughness: 0.95, color: 0x8a7458 });
    for (const t of d.trunks) {
      if (t.top < 0) continue;
      const c = g.hexCenter(t.top);
      const m = new THREE.Mesh(topGeo, topMat);
      m.scale.setScalar(Math.max(t.r, g.R * 1.1));
      m.position.set(c.x, T.hexR * 1.3 + 0.3, c.y);
      m.receiveShadow = true;
      this.canopy.add(m);
    }
    const siteGeo = new THREE.RingGeometry(0.8, 1, 36);
    siteGeo.rotateX(-Math.PI / 2);
    const SITE_COL: Record<string, number> = { leaf: 0x9fe07a, hollow: 0x3a2a1c, fork: 0xf0e4c0 };
    for (const s of d.sites) {
      const mat = new THREE.MeshBasicMaterial({ color: SITE_COL[s.kind] ?? 0xffffff, transparent: true, opacity: s.kind === 'hollow' ? 0.7 : 0.45, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(s.kind === 'hollow' ? new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2) : siteGeo, mat);
      m.scale.set(g.R * (s.kind === 'hollow' ? 0.8 : 1.3), 1, g.R * (s.kind === 'hollow' ? 0.55 : 1.3));
      m.position.set(s.x, T.hexR * 1.3 + 0.35, s.y);
      m.renderOrder = 2;
      this.canopy.add(m);
      this.rings.push(m);
    }
  }

  /** The marks breathe a little so they read as live spots rather than paint. */
  update(w: World, time: number): void {
    void w;
    const k = 0.45 + 0.1 * Math.sin(time * 1.7);
    for (const r of this.rings) (r.material as THREE.MeshBasicMaterial).opacity = (r.material as THREE.MeshBasicMaterial).color.getHex() === 0x3a2a1c ? 0.7 : k;
  }
}

function barkReady(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) g = g.toNonIndexed();
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
