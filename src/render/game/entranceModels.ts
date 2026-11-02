import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World } from '../../sim/world';
import { Colony, Entrance } from '../../sim/types';
import { anthillCentre, refuseSpot } from '../../sim/entrances';
import { SpeciesId } from '../../sim/species';
import { Rng, valueNoise2 } from '../../core/rng';
import { patchDapple } from '../shaderPatch';
import { textures } from '../textures';
import { buildGalleryTubeGeometry, createCartonMaterial } from '../termite/carton';

/**
 * Species-specific anthills (claude/maps/02-spec-nest-entrances §2.1; user spec 2026-11-01 "three surface holes per
 * anthill"; research notes in docs/creatures/entrances.md). Render-only: every hole is drawn from the simulation's
 * entrance list (a colony's three holes, sim/entrances.ts), so it always sits where the ants go in.
 *
 * Each colony gets one structure over its three holes, centred between them, so they read as one nest: a black garden
 * ant's (and a Termant's, carton-reinforced) low crater of crumbly soil with the holes in its rampart, a red wood ant's
 * thatched dome (holes in its flanks), a leafcutter's wide bare-soil mound with its refuse dump beside it, a nasute
 * termite's carton nest (openings at its base) with covered galleries, a Gilded Ant's rotting stump with a root out to
 * each hole, an army ant bivouac of clinging bodies, a hell ant's minimal soil ring in leaf litter (a reconstruction);
 * fire ants' worked-soil dome is render/game/mounds.ts. Each hole gets an apron mesh: a crater rim, collar or plain lip
 * of the species' soil, damp and darker toward a black opening, fading into the ground at its edge. Loose details (soil
 * pellets, needles, leaf bits, sawdust) are merged. Everything walkable adds to `height()`, which the surface renderers
 * add to the terrain so ants climb rims and domes instead of passing through them.
 *
 * Meshes are rebuilt only when the anthill grows a size step or caves in.
 */

type Look = 'lasius' | 'formica' | 'atta' | 'solenopsis' | 'eciton' | 'plagiaria' | 'hell' | 'aurimyrmex' | 'termant' | 'nasute' | 'sickle';

const LOOK: Record<SpeciesId, Look> = {
  lasius: 'lasius',
  formica: 'formica',
  atta: 'atta',
  solenopsis: 'solenopsis',
  eciton: 'eciton',
  plagiaria: 'plagiaria',
  hell: 'hell',
  aurimyrmex: 'aurimyrmex',
  termant: 'termant',
  nasutitermes: 'nasute',
  rhynchotermes: 'sickle',
};

/** Crater / collar shape round one hole (mm). */
interface Rim {
  holeR: number;
  /** crest radius and height */
  rimR: number;
  rimH: number;
  /** apron (outer edge) radius */
  outR: number;
  /** angular unevenness 0..1 */
  wob: number;
  /** a steep little chimney (sickle-jaw termites) rather than a sloping crater */
  turret?: boolean;
  seed: number;
}

/** Soil colours (sRGB hex): dry crest, damp near the hole, fresh plug. */
interface Palette {
  dry: number;
  damp: number;
  pellet: number;
}

const PAL: Record<Look, Palette> = {
  lasius: { dry: 0x4a3a2c, damp: 0x241a12, pellet: 0x5a4636 },
  formica: { dry: 0x46362a, damp: 0x241a12, pellet: 0x4a382a },
  atta: { dry: 0x8a5230, damp: 0x4e2c18, pellet: 0xa86a3e },
  solenopsis: { dry: 0x6e4630, damp: 0x3a2418, pellet: 0x8a5a3a },
  eciton: { dry: 0x46382c, damp: 0x221a14, pellet: 0x4a3c30 },
  plagiaria: { dry: 0x4e3e30, damp: 0x281e16, pellet: 0x56443a },
  hell: { dry: 0x483828, damp: 0x241a12, pellet: 0x4e3e30 },
  aurimyrmex: { dry: 0x504030, damp: 0x2a2018, pellet: 0xd2bc90 },
  termant: { dry: 0x544232, damp: 0x2a2016, pellet: 0x5a4434 },
  nasute: { dry: 0x46362a, damp: 0x241a12, pellet: 0x4a3828 },
  sickle: { dry: 0x523c2c, damp: 0x281c12, pellet: 0x5a4232 },
};

/** Hole radius (mm) per look (an anthill's three holes alike). */
const HOLE: Record<Look, number> = { lasius: 1.6, formica: 2.0, atta: 3.2, solenopsis: 1.2, eciton: 2.4, plagiaria: 1.8, hell: 1.4, aurimyrmex: 1.9, termant: 2.0, nasute: 2.0, sickle: 1.1 };

function smooth(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
}

/** Height (mm above whatever lies under it) of a rim at distance d, angle a; plug 0..1 fills the hole, fall 0..1 flattens it. */
function rimHeight(r: Rim, d: number, a: number, plug: number, fall: number): number {
  if (d >= r.outR) return 0;
  const w = 1 + r.wob * (0.22 * Math.sin(a * 3 + r.seed) + 0.1 * Math.sin(a * 7 + r.seed * 1.7));
  const crest = r.rimR * (1 + r.wob * 0.08 * Math.sin(a * 2 + r.seed * 0.7));
  const H = r.rimH * w * (1 - 0.75 * fall);
  let h: number;
  if (r.turret) {
    // a little collar: steep inside and out
    h = d < crest ? H * smooth((d - r.holeR * 0.7) / Math.max(0.2, crest - r.holeR * 0.7) * 3) : H * (1 - smooth((d - crest) / Math.max(0.3, r.outR - crest) * 1.6));
  } else if (d < crest) h = H * smooth((d - r.holeR * 0.55) / Math.max(0.3, crest - r.holeR * 0.55));
  else h = H * (1 - smooth((d - crest) / Math.max(0.3, r.outR - crest)));
  // plugged or caved in: the hole fills with soil up to most of the rim
  const fill = Math.max(plug, fall);
  if (fill > 0 && d < crest) h = Math.max(h, H * 0.7 * fill * (1 - smooth((d - crest * 0.6) / (crest * 0.5))) + H * 0.15 * fill);
  return Math.max(0, h);
}

/** A walkable shape spanning a whole nest (domes, stumps, bivouacs, dumps). */
interface Mass {
  x: number;
  y: number;
  r: number;
  h: number;
  /** profile exponent: 1 = round dome, >1 = steeper sides with a flatter top */
  k: number;
  seed: number;
  /** a crater instead of a dome: its rampart's crest at this fraction of r, the floor inside it a third as high */
  ring?: number;
}

function massHeight(m: Mass, x: number, y: number): number {
  const dx = x - m.x;
  const dy = y - m.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= m.r * m.r) return 0;
  const a = Math.atan2(dy, dx);
  const t0 = Math.sqrt(d2) / m.r;
  const ang = Math.min(1, t0 * 2);
  const rr = m.r * (1 + ang * (0.06 * Math.sin(a * 5 + m.seed) + 0.04 * Math.sin(a * 9 + m.seed * 2)));
  const t = Math.sqrt(d2) / rr;
  if (t >= 1) return 0;
  if (m.ring) {
    const u = t < m.ring ? (m.ring - t) / m.ring : (t - m.ring) / (1 - m.ring);
    const crest = 1 - smooth(u);
    return m.h * (t < m.ring ? 0.33 + 0.67 * crest : crest) * (1 + 0.08 * Math.sin(a * 7 + m.seed));
  }
  return m.h * Math.pow(Math.max(0, 1 - Math.pow(t, 2 / m.k)), 0.5 * m.k) * (1 - ang * 0.04 + ang * 0.04 * Math.sin(a * 11 + m.seed));
}

interface Hole {
  x: number;
  y: number;
  look: Look;
  rim: Rim;
  plug: number;
  fall: number;
}

interface Built {
  sig: string;
  objs: THREE.Object3D[];
  holes: Hole[];
  masses: Mass[];
}

export class SurfaceEntrances {
  readonly group = new THREE.Group();
  private built = new Map<string, Built>();
  private frame = 0;
  private apronMat: THREE.MeshStandardMaterial;
  private detailMat: THREE.MeshStandardMaterial;
  private massMat: THREE.MeshStandardMaterial;
  private cartonMat: THREE.MeshStandardMaterial;
  /** loose-soil craters and mounds (vertex alpha at their edge) */
  private craterMat: THREE.MeshStandardMaterial;
  /** glossy cuticle for the army-ant bivouac's bodies (instance colours) */
  private bodyMat: THREE.MeshStandardMaterial;
  /** flat lists for height queries */
  private holes: Hole[] = [];
  private masses: Mass[] = [];

  constructor() {
    const tex = textures();
    this.apronMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, normalMap: tex.soil.normal, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    patchDapple(this.apronMat);
    this.detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    patchDapple(this.detailMat);
    this.massMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, normalMap: tex.soil.normal, normalScale: new THREE.Vector2(1.3, 1.3), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    patchDapple(this.massMat);
    this.craterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, normalMap: tex.soil.normal, normalScale: new THREE.Vector2(1.2, 1.2), transparent: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    patchDapple(this.craterMat);
    this.cartonMat = createCartonMaterial({ layerMm: 0.45, bump: 0.8 });
    this.bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.05 });
    patchDapple(this.bodyMat);
  }

  /** Height (mm) the entrances' rims and nest structures add to the ground at (x, y). */
  height(x: number, y: number): number {
    let h = 0;
    for (const m of this.masses) h += massHeight(m, x, y);
    for (const o of this.holes) {
      const dx = x - o.x;
      const dy = y - o.y;
      const R = o.rim.outR;
      if (dx * dx + dy * dy >= R * R) continue;
      h += rimHeight(o.rim, Math.sqrt(dx * dx + dy * dy), Math.atan2(dy, dx), o.plug, o.fall);
    }
    return h;
  }

  get empty(): boolean {
    return !this.holes.length && !this.masses.length;
  }

  /** Rebuild a colony's anthill on the next update (the ground under it changed: a fire-ant dome grew). */
  rebuild(colony: number): void {
    const b = this.built.get('c' + colony);
    if (b) b.sig = '';
    this.frame = 0;
  }

  update(w: World, ground: (x: number, y: number) => number): void {
    if (this.frame++ % 30 !== 0) return;
    const seen = new Set<string>();
    for (const c of w.s.colonies) {
      if (!c.entrances.length) continue;
      const key = 'c' + c.id;
      seen.add(key);
      const look = LOOK[c.species] ?? 'lasius';
      const g = w.nest(c.id);
      const dug = g ? g.dugHexCount() : 30;
      const size = Math.round(Math.min(0.8, Math.max(0, (dug - 30) / 120)) * 10) / 10;
      const living = Math.round(Math.min(1, Math.sqrt(Math.max(0, c.living)) / 18) * 5) / 5;
      const sig = `${look}|${size}|${living}|${c.entrances.map((e) => `${e.sx.toFixed(1)},${e.sy.toFixed(1)},${Math.round((e.fall ?? 0) * 4)}`).join(';')}`;
      const old = this.built.get(key);
      if (old && old.sig === sig) continue;
      if (old) this.dispose(old);
      this.built.set(key, this.build(w, c, look, 1 + size, living, sig, ground));
    }
    for (const [key, b] of this.built)
      if (!seen.has(key)) {
        this.dispose(b);
        this.built.delete(key);
      }
    this.holes = [];
    this.masses = [];
    for (const b of this.built.values()) {
      this.holes.push(...b.holes);
      this.masses.push(...b.masses);
    }
  }

  private dispose(b: Built): void {
    for (const o of b.objs) {
      this.group.remove(o);
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
  }

  // ------------------------------------------------------------------ building

  private build(w: World, c: Colony, look: Look, s: number, living: number, sig: string, ground: (x: number, y: number) => number): Built {
    const b: Built = { sig, objs: [], holes: [], masses: [] };
    const fallC = Math.max(...c.entrances.map((e) => e.fall ?? 0));
    // the anthill: its three holes round its centre (sim/entrances.ts), one structure over them all
    const ctr = anthillCentre(c.entrances, { x: 0, y: 0 });
    const details: THREE.BufferGeometry[] = [];
    const massGeos: THREE.BufferGeometry[] = [];
    // (low craters and mounds of loose soil: fading into the ground at their edge)
    const craterGeos: THREE.BufferGeometry[] = [];
    const cartonGeos: THREE.BufferGeometry[] = [];
    const rng = new Rng(c.id * 7919 + 101);
    const far = Math.max(4, ...c.entrances.map((e) => Math.hypot(e.sx - ctr.x, e.sy - ctr.y)));
    const outs = c.entrances.map((e) => Math.atan2(e.sy - ctr.y, e.sx - ctr.x));
    const pal = PAL[look];
    const addTrails = (R: number) => {
      // trails worn bare, running out from the foot past each hole
      for (const g of trails(ctr.x, ctr.y, R, outs.length, rng, ground, outs)) {
        const tm = new THREE.Mesh(g, this.apronMat);
        tm.receiveShadow = true;
        tm.renderOrder = 1;
        b.objs.push(tm);
        this.group.add(tm);
      }
    };
    if (look === 'formica') {
      // a thatched dome over the nest; the three holes open in its flanks
      const R = Math.max(16 + living * 14, far * 1.3);
      const m: Mass = { x: ctr.x, y: ctr.y, r: R, h: R * 0.42 * (1 - 0.6 * fallC), k: 1.15, seed: c.id * 3 + 1 };
      b.masses.push(m);
      massGeos.push(massMesh(m, ground, (x, y, h, t) => thatchColour(x, y, h, t, m.seed)));
      details.push(...thatch(m, ground, rng, Math.round(700 + R * 30)));
      addTrails(R);
    } else if (look === 'lasius' || look === 'plagiaria' || look === 'termant') {
      // a low crater of crumbly worked soil, the three holes in its rampart (Termants: carton-reinforced)
      const R = far * 1.45;
      const m: Mass = { x: ctr.x, y: ctr.y, r: R, h: (1.7 + living * 1.5) * (look === 'termant' ? 1.25 : 1) * (1 - 0.6 * fallC), k: 1, seed: c.id * 23 + 9, ring: far / R };
      b.masses.push(m);
      craterGeos.push(massMesh(m, ground, (x, y, h, t) => soilColour(x, y, t, pal, m.seed, h / m.h), true));
      const at = (x: number, y: number) => ground(x, y) + massHeight(m, x, y);
      details.push(...pellets(ctr.x, ctr.y, R * 0.97, Math.round((260 + living * 260) * (1 - 0.6 * fallC)), rng, at, [pal.pellet, pal.dry, pal.damp, 0x6a5644], 0.3, 0.75));
      if (look === 'termant') details.push(...pellets(ctr.x, ctr.y, R * 0.8, Math.round(40 + living * 40), rng, at, [0x2e2016, 0x3b2a1e, 0x4a3626], 0.45, 0.9, far * 0.5));
    } else if (look === 'atta') {
      // a wide bare-soil mound, its three big craters on the flanks; a pale refuse dump beside it (where the dead and the
      // waste are dropped: entrances.ts refuseSpot)
      const R = far * 1.7;
      const m: Mass = { x: ctr.x, y: ctr.y, r: R, h: (2.5 + living * 4) * (1 - 0.6 * fallC), k: 0.8, seed: c.id * 29 + 4 };
      b.masses.push(m);
      craterGeos.push(massMesh(m, ground, (x, y, h, t) => soilColour(x, y, t, pal, m.seed, h / m.h), true));
      const rs = refuseSpot(c, { x: 0, y: 0 });
      const d: Mass = { x: rs.x, y: rs.y, r: 6 + living * 6, h: 1.4 + living * 1.6, k: 0.8, seed: c.id * 19 + 7 };
      b.masses.push(d);
      massGeos.push(massMesh(d, ground, (x, y, h, t) => refuseColour(x, y, t)));
      details.push(...pellets(d.x, d.y, d.r * 0.95, Math.round(160 + d.r * 12), rng, (x, y) => ground(x, y) + massHeight(d, x, y), [0x9a8c74, 0x7a6e5a, 0xb0a288, 0x5a5040, 0x6a6a4a], 0.4, 1.0));
      addTrails(R);
    } else if (look === 'nasute') {
      // a dark carton nest, its three openings at its base, covered galleries running off along the ground between them
      const R = Math.max(9 + living * 9, far * 0.8);
      const m: Mass = { x: ctr.x, y: ctr.y, r: R, h: R * 0.85 * (1 - 0.5 * fallC), k: 1.4, seed: c.id * 5 + 3 };
      b.masses.push(m);
      cartonGeos.push(lobedMass(m, ground, rng));
      for (let k = 0; k < outs.length; k++) {
        // (between hole k and the next)
        const a0 = outs[k];
        const a1 = outs[(k + 1) % outs.length];
        const a = a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) / 2 + rng.range(-0.25, 0.25);
        const pts: THREE.Vector3[] = [];
        const L = 45 + rng.range(0, 40);
        let x = m.x + Math.cos(a) * R * 0.9;
        let y = m.y + Math.sin(a) * R * 0.9;
        let h = a;
        for (let i = 0; i <= 6; i++) {
          pts.push(new THREE.Vector3(x, ground(x, y) + 0.6, y));
          h += rng.range(-0.35, 0.35);
          x += Math.cos(h) * (L / 6);
          y += Math.sin(h) * (L / 6);
        }
        cartonGeos.push(buildGalleryTubeGeometry(pts, { radius: 1.3, flatten: 0.7, lumpiness: 0.25, seed: c.id * 17 + k }));
      }
    } else if (look === 'aurimyrmex') {
      // a rotting stump in the middle, a root running out to each hole (the holes open among the roots), frass below
      const R = 9 + living * 6;
      const m: Mass = { x: ctr.x, y: ctr.y, r: R, h: R * 1.25, k: 3.2, seed: c.id * 11 + 2 };
      b.masses.push(m);
      massGeos.push(stumpMesh(m, ground, rng));
      for (let k = 0; k < outs.length; k++) massGeos.push(rootMesh(m, outs[k] + 0.35, far + 3, ground, c.id * 13 + k));
    } else if (look === 'eciton') {
      // the bivouac: a hanging mass of linked workers, the three ways in dark gaps at its skirt
      const R = Math.max(12 + living * 10, far * 1.05);
      const m: Mass = { x: ctr.x, y: ctr.y, r: R, h: R * 0.75 * (1 - 0.8 * fallC), k: 1.5, seed: c.id * 13 + 5 };
      b.masses.push(m);
      // a dark core under the clinging bodies, so no ground shows between them
      massGeos.push(massMesh(m, ground, () => new THREE.Color(0x24120a)));
      if (fallC < 0.9) {
        // the linked workers: one instanced ant body (head, thorax, gaster, legs) many times over
        const ants = bivouac(m, ground, rng, Math.round(500 + living * 700), this.bodyMat, c.entrances);
        b.objs.push(ants);
        this.group.add(ants);
      }
    } else if (look === 'hell') {
      // (a reconstruction) a minimal ring of soil, three small neat holes on it, leaf litter round about
      const R = far * 1.3;
      const m: Mass = { x: ctr.x, y: ctr.y, r: R, h: 0.45 * (1 - 0.6 * fallC), k: 1, seed: c.id * 31 + 6, ring: far / R };
      b.masses.push(m);
      craterGeos.push(massMesh(m, ground, (x, y, h, t) => soilColour(x, y, t, pal, m.seed, h / m.h), true));
      details.push(...leafBits(ctr.x, ctr.y, R * 1.8, 14, rng, (x, y) => ground(x, y) + massHeight(m, x, y), [0x5a3e22, 0x7a5430, 0x4a321c, 0x6a4a2a, 0x8a6236], [2, 4.2], far * 0.2));
    } else if (look === 'sickle') {
      // three small openings with soil collars in the leaf litter
      details.push(...leafBits(ctr.x, ctr.y, far * 1.9, 12, rng, ground, [0x7a5a30, 0x5e4426, 0x9a7038], [1.4, 2.8], 0));
    }
    const under = (x: number, y: number) => {
      let h = ground(x, y);
      for (const m of b.masses) h += massHeight(m, x, y);
      return h;
    };
    // ---- each hole: its rim, opening and loose details (the three alike: one anthill)
    c.entrances.forEach((e, i) => {
      const k = Math.min(1.35, s);
      const hr = HOLE[look];
      const seed = c.id * 31 + i * 7 + 1;
      const rim = rimFor(look, hr, k, seed, true);
      const hole: Hole = { x: e.sx, y: e.sy, look, rim, plug: 0, fall: e.fall ?? 0 };
      b.holes.push(hole);
      const apron = apronMesh(hole, under, PAL[look]);
      const mesh = new THREE.Mesh(apron, this.apronMat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.renderOrder = 1;
      b.objs.push(mesh);
      this.group.add(mesh);
      const at = (x: number, y: number) => under(x, y) + rimHeight(rim, Math.hypot(x - e.sx, y - e.sy), Math.atan2(y - e.sy, x - e.sx), hole.plug, hole.fall);
      details.push(...entranceDetails(look, e, i, rim, rng, at, ctr, k));
      if (look === 'lasius' && i === 1) details.push(flatStone(e.sx, e.sy, rim, rng, under));
      // Termants: dark papery carton plastered round each crater's throat
      if (look === 'termant' && !hole.fall) cartonGeos.push(cartonCollar(e.sx, e.sy, rim, at, seed));
    });
    if (details.length) {
      const g = mergeGeometries(details.map(prep));
      if (g) {
        const m = new THREE.Mesh(g, this.detailMat);
        m.castShadow = m.receiveShadow = true;
        b.objs.push(m);
        this.group.add(m);
      }
    }
    if (massGeos.length) {
      const g = mergeGeometries(massGeos.map(prep));
      if (g) {
        const m = new THREE.Mesh(g, this.massMat);
        m.castShadow = m.receiveShadow = true;
        b.objs.push(m);
        this.group.add(m);
      }
    }
    if (craterGeos.length) {
      const g = mergeGeometries(craterGeos);
      if (g) {
        const m = new THREE.Mesh(g, this.craterMat);
        m.receiveShadow = true;
        m.castShadow = true;
        m.renderOrder = 0;
        b.objs.push(m);
        this.group.add(m);
      }
    }
    if (cartonGeos.length) {
      const g = mergeGeometries(cartonGeos.map((x) => strip(x)));
      if (g) {
        const m = new THREE.Mesh(g, this.cartonMat);
        m.castShadow = m.receiveShadow = true;
        b.objs.push(m);
        this.group.add(m);
      }
    }
    return b;
  }
}

/** The rim each species raises round a hole of radius hr (k: size factor). */
function rimFor(look: Look, hr: number, k: number, seed: number, main: boolean): Rim {
  switch (look) {
    case 'lasius': // a crumbly "volcano" of fine pellets
      return { holeR: hr, rimR: hr * 2.1 * k, rimH: 1.5 * k, outR: hr * 5.5 * k, wob: 0.9, seed };
    case 'atta': // a wide crater of loose excavated soil
      return { holeR: hr, rimR: hr * 2.2 * k, rimH: (main ? 3.2 : 2.4) * k, outR: hr * 6.5 * k, wob: 0.7, seed };
    case 'solenopsis': // small holes with a granular collar (the dome stands elsewhere)
      return { holeR: hr, rimR: hr * 2 * k, rimH: 0.7 * k, outR: hr * 4.5 * k, wob: 1, seed };
    case 'plagiaria': // a low crater with plant bits
      return { holeR: hr, rimR: hr * 2 * k, rimH: 1 * k, outR: hr * 5 * k, wob: 0.8, seed };
    case 'hell': // a neat round hole with a minimal rim (reconstruction)
      return { holeR: hr, rimR: hr * 1.6, rimH: 0.35, outR: hr * 3.2, wob: 0.2, seed };
    case 'aurimyrmex': // at the stump's foot: a lip of frass
      return { holeR: hr, rimR: hr * 1.9 * k, rimH: 0.7 * k, outR: hr * 4.5 * k, wob: 0.6, seed };
    case 'termant': // a soil crater whose crest is carton-reinforced
      return { holeR: hr, rimR: hr * 2 * k, rimH: 1.7 * k, outR: hr * 5 * k, wob: 0.7, seed };
    case 'sickle': // a tiny soil turret in the litter
      return { holeR: hr, rimR: hr * 1.7, rimH: 1.1 * Math.min(1.2, k), outR: hr * 3, wob: 0.4, turret: true, seed };
    case 'eciton': // the way into the bivouac: a dark gap in the mass
      return { holeR: hr, rimR: hr * 1.2, rimH: 0.2, outR: hr * 1.7, wob: 0.3, seed };
    case 'formica': // a hole in the dome's flank with a small lip
    case 'nasute':
      return { holeR: hr, rimR: hr * 1.7, rimH: 0.5, outR: hr * 3, wob: 0.5, seed };
  }
}

/** Polar apron round a hole: rim heights on whatever lies beneath, coloured damp → dry, a black opening, fading out at the edge. */
function apronMesh(o: Hole, under: (x: number, y: number) => number, pal: Palette): THREE.BufferGeometry {
  const RINGS = 18;
  const SEG = 36;
  const r = o.rim;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const dry = new THREE.Color(pal.dry);
  const damp = new THREE.Color(pal.damp);
  const black = new THREE.Color(0x050403);
  const fresh = new THREE.Color(pal.damp).multiplyScalar(0.8);
  const c = new THREE.Color();
  const fill = Math.max(o.plug, o.fall);
  for (let ri = 0; ri <= RINGS; ri++) {
    // rings packed toward the hole
    const t = ri / RINGS;
    const d = r.outR * (t * t * 0.6 + t * 0.4);
    const n = ri === 0 ? 1 : SEG;
    for (let i = 0; i < n; i++) {
      const a = (i / SEG) * Math.PI * 2 + (ri % 2) * (Math.PI / SEG);
      const x = o.x + Math.cos(a) * d;
      const y = o.y + Math.sin(a) * d;
      const h = rimHeight(r, d, a, o.plug, o.fall);
      pos.push(x, under(x, y) + h + 0.06, y);
      uv.push(x / 14, y / 14);
      // colour: black opening → damp throat → dry crest → apron
      const grain = valueNoise2(x * 1.7, y * 1.7, r.seed) - 0.5;
      const crest = Math.min(1, h / Math.max(0.1, r.rimH));
      c.copy(damp).lerp(dry, Math.min(1, crest * 0.8 + Math.max(0, (d - r.rimR) / r.outR)));
      c.multiplyScalar(0.9 + grain * 0.25);
      if (d < r.holeR * 1.5) {
        // a dark throat: black in the opening, shading out over half a hole radius
        const k = smooth((r.holeR * 1.5 - d) / (r.holeR * 0.9));
        c.lerp(fill > 0 ? fresh : black, k * (fill > 0 ? fill : 1));
        if (fill > 0 && fill < 1) c.lerp(black, k * (1 - fill));
      }
      if (o.fall > 0) c.lerp(new THREE.Color(0x6a6058), o.fall * 0.35);
      const alpha = 1 - smooth((d - r.outR * 0.62) / (r.outR * 0.38));
      col.push(c.r, c.g, c.b, alpha);
    }
  }
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + ((i + 1) % SEG), 1 + i);
  for (let ri = 1; ri < RINGS; ri++) {
    const a0 = 1 + (ri - 1) * SEG;
    const b0 = 1 + ri * SEG;
    for (let i = 0; i < SEG; i++) {
      const a = a0 + i;
      const a1 = a0 + ((i + 1) % SEG);
      const bb = b0 + i;
      const b1 = b0 + ((i + 1) % SEG);
      idx.push(a, a1, bb, a1, b1, bb);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A polar mesh over a mass (dome, dump), coloured by `paint(x, y, h, t)` (t = distance / radius); `fade`: with vertex
 * alpha, fading into the ground over its outer part (a crater of loose soil has no hard edge).
 */
function massMesh(m: Mass, ground: (x: number, y: number) => number, paint: (x: number, y: number, h: number, t: number) => THREE.Color, fade = false): THREE.BufferGeometry {
  const RINGS = 22;
  const SEG = 56;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let ri = 0; ri <= RINGS; ri++) {
    const t = ri / RINGS;
    const d = m.r * 1.12 * t;
    const n = ri === 0 ? 1 : SEG;
    for (let i = 0; i < n; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = m.x + Math.cos(a) * d;
      const y = m.y + Math.sin(a) * d;
      const h = massHeight(m, x, y);
      pos.push(x, ground(x, y) + h + 0.05, y);
      uv.push(x / 16, y / 16 + h / 16);
      const cc = paint(x, y, h, t);
      col.push(cc.r, cc.g, cc.b);
      if (fade) col.push(1 - smooth((t - 0.62) / 0.38));
    }
  }
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + ((i + 1) % SEG), 1 + i);
  for (let ri = 1; ri < RINGS; ri++) {
    const a0 = 1 + (ri - 1) * SEG;
    const b0 = 1 + ri * SEG;
    for (let i = 0; i < SEG; i++) {
      const a = a0 + i;
      const a1 = a0 + ((i + 1) % SEG);
      const bb = b0 + i;
      const b1 = b0 + ((i + 1) % SEG);
      idx.push(a, a1, bb, a1, b1, bb);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, fade ? 4 : 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const tmpC = new THREE.Color();
function thatchColour(x: number, y: number, h: number, t: number, seed: number): THREE.Color {
  // a mat of needles, twigs and resin-dark plant bits; drier and paler on the sunny top
  const n1 = valueNoise2(x * 0.9, y * 0.9, seed);
  const n2 = valueNoise2(x * 3.1 + 5, y * 3.1, seed + 3);
  const n3 = valueNoise2(x * 7.3 + 2, y * 7.3, seed + 6);
  tmpC.setHSL(0.07 + 0.02 * n1, 0.42 + 0.12 * n2, 0.1 + 0.06 * n1 + 0.05 * n3 + 0.04 * Math.min(1, h / 8), THREE.SRGBColorSpace);
  // the foot: worn bare soil
  if (t > 0.9) tmpC.lerp(new THREE.Color(0x2e2218), Math.min(1, (t - 0.9) / 0.12));
  return tmpC.clone();
}

/** Worked soil of a mound or crater in the species' palette: crumbly, darker and damper toward the foot. */
function soilColour(x: number, y: number, t: number, pal: Palette, seed: number, crest = 0.5): THREE.Color {
  const n = valueNoise2(x * 1.1, y * 1.1, seed);
  const n2 = valueNoise2(x * 3.7, y * 3.7, seed + 2);
  tmpC.setHex(pal.dry).lerp(new THREE.Color(pal.pellet), 0.35 * n2).multiplyScalar((0.7 + 0.3 * n) * (0.8 + 0.4 * crest));
  if (t > 0.8) tmpC.lerp(new THREE.Color(pal.damp), Math.min(1, (t - 0.8) / 0.25) * 0.5);
  return tmpC.clone();
}

/**
 * A root running out from a stump's foot along the ground (heading a, out to `len` mm from the stump's middle), half
 * buried, tapering to a point: Gilded Ants' holes open among them.
 */
function rootMesh(m: Mass, a: number, len: number, ground: (x: number, y: number) => number, seed: number): THREE.BufferGeometry {
  const SEG = 10;
  const SIDES = 7;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bark = new THREE.Color(0x3a2a1e);
  const r0 = m.r * 0.22;
  const x0 = m.x + Math.cos(a) * m.r * 0.55;
  const y0 = m.y + Math.sin(a) * m.r * 0.55;
  const L = Math.max(4, len - m.r * 0.55);
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const bend = 0.25 * Math.sin(u * 3 + seed);
    const ax = Math.cos(a + bend * u);
    const ay = Math.sin(a + bend * u);
    const cx = x0 + ax * L * u;
    const cy = y0 + ay * L * u;
    const r = r0 * (1 - 0.85 * u) + 0.15;
    for (let j = 0; j < SIDES; j++) {
      const t = (j / SIDES) * Math.PI * 2;
      const lx = -ay * Math.cos(t) * r;
      const ly = ax * Math.cos(t) * r;
      const x = cx + lx;
      const y = cy + ly;
      // (half buried: the lower half sinks into the ground)
      pos.push(x, ground(x, y) + Math.sin(t) * r * 0.8 - r * 0.25 + (1 - u) * m.h * 0.08, y);
      tmpC.copy(bark).multiplyScalar(0.7 + 0.4 * valueNoise2(u * 6, j, seed));
      col.push(tmpC.r, tmpC.g, tmpC.b);
    }
  }
  for (let i = 0; i < SEG; i++)
    for (let j = 0; j < SIDES; j++) {
      const a0 = i * SIDES + j;
      const a1 = i * SIDES + ((j + 1) % SIDES);
      idx.push(a0, a0 + SIDES, a1, a1, a0 + SIDES, a1 + SIDES);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function refuseColour(x: number, y: number, t: number): THREE.Color {
  const n = valueNoise2(x * 1.3, y * 1.3, 77);
  const n2 = valueNoise2(x * 4.1, y * 4.1, 79);
  tmpC.setHSL(0.1, 0.16, 0.3 + 0.12 * n + 0.08 * n2, THREE.SRGBColorSpace);
  if (t > 0.9) tmpC.lerp(new THREE.Color(0x5a4a3a), Math.min(1, (t - 0.9) / 0.2));
  return tmpC.clone();
}

/** Carton nest: a lumpy lobed dome of papery carton (the carton material shades it). */
function lobedMass(m: Mass, ground: (x: number, y: number) => number, rng: Rng): THREE.BufferGeometry {
  const lobes: Array<[number, number, number]> = [];
  for (let i = 0; i < 9; i++) lobes.push([rng.range(0, Math.PI * 2), rng.range(0.2, 1), rng.range(0.8, 1.6)]);
  const g = new THREE.IcosahedronGeometry(1, 5);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const a = Math.atan2(z, x);
    let bump = 1;
    for (const [la, lh, ls] of lobes) {
      const da = Math.abs(((a - la + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      bump += 0.1 * ls * Math.exp(-da * da * 6) * Math.exp(-((y - lh) * (y - lh)) * 6);
    }
    bump += 0.06 * (valueNoise2(x * 6 + 3, y * 6 + z * 4, m.seed) - 0.5);
    x *= m.r * bump;
    z *= m.r * bump;
    y = Math.max(-0.2, y) * m.h * bump;
    const wx = m.x + x;
    const wz = m.y + z;
    p.setXYZ(i, wx, ground(wx, wz) + y - 0.4, wz);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** A rotting stump: bark sides with roots flaring into the ground, a crumbling pale top. */
function stumpMesh(m: Mass, ground: (x: number, y: number) => number, rng: Rng): THREE.BufferGeometry {
  const SEG = 28;
  const RINGS = 10;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bark = new THREE.Color(0x3e2e22);
  const rot = new THREE.Color(0xb89a6a);
  const g0 = ground(m.x, m.y);
  const ribs = 5 + rng.int(0, 3);
  for (let ri = 0; ri <= RINGS; ri++) {
    const t = ri / RINGS;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const flare = 1 + 0.55 * Math.pow(1 - t, 3) * (0.6 + 0.4 * Math.sin(a * ribs + m.seed));
      const rr = m.r * 0.7 * flare * (1 + 0.05 * Math.sin(a * 13 + t * 5));
      const x = m.x + Math.cos(a) * rr;
      const y = m.y + Math.sin(a) * rr;
      const top = t >= 1 ? m.h * (0.9 + 0.1 * valueNoise2(x, y, m.seed)) : m.h * t;
      pos.push(x, Math.min(ground(x, y), g0) + top - 0.3, y);
      // furrowed bark: dark vertical cracks between ridges, lichen-pale flecks
      const furrow = Math.pow(Math.abs(Math.sin(a * 11 + valueNoise2(a * 2, t * 3, m.seed) * 2)), 3);
      tmpC.copy(bark).multiplyScalar((0.75 + 0.35 * valueNoise2(a * 3, t * 8, m.seed)) * (0.55 + 0.45 * (1 - furrow)));
      col.push(tmpC.r, tmpC.g, tmpC.b);
    }
  }
  // the decayed top: growth rings in rotting wood, darker and dished toward a crumbling heart
  const topStart = pos.length / 3;
  const RR = 12;
  pos.push(m.x, g0 + m.h * 0.8, m.y);
  col.push(0.16, 0.1, 0.06);
  for (let rr = 1; rr <= RR; rr++) {
    const f = rr / RR;
    for (let i = 0; i < SEG; i++) {
      const k = RINGS * SEG + i;
      const ex = pos[k * 3];
      const ey = pos[k * 3 + 1];
      const ez = pos[k * 3 + 2];
      const x = m.x + (ex - m.x) * f;
      const z = m.y + (ez - m.y) * f;
      const dish = (1 - f) * m.h * 0.12 * (0.6 + 0.4 * valueNoise2(i, rr, m.seed));
      pos.push(x, ey - 0.05 - dish, z);
      const ring = 0.5 + 0.5 * Math.sin(f * 22 + valueNoise2(i * 0.5, rr, m.seed) * 2);
      tmpC.copy(rot).multiplyScalar((0.38 + 0.3 * ring) * (0.6 + 0.4 * f));
      col.push(tmpC.r, tmpC.g, tmpC.b);
    }
  }
  for (let i = 0; i < SEG; i++) idx.push(topStart, topStart + 1 + ((i + 1) % SEG), topStart + 1 + i);
  for (let rr = 1; rr < RR; rr++)
    for (let i = 0; i < SEG; i++) {
      const a = topStart + 1 + (rr - 1) * SEG + i;
      const a1 = topStart + 1 + (rr - 1) * SEG + ((i + 1) % SEG);
      const b = a + SEG;
      const b1 = a1 + SEG;
      idx.push(a, a1, b, a1, b1, b);
    }
  for (let ri = 0; ri < RINGS; ri++)
    for (let i = 0; i < SEG; i++) {
      const a = ri * SEG + i;
      const a1 = ri * SEG + ((i + 1) % SEG);
      const b = a + SEG;
      const b1 = a1 + SEG;
      idx.push(a, b, a1, a1, b, b1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ loose details (vertex coloured, merged)

function coloured(g: THREE.BufferGeometry, hex: number, k = 1): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (n !== 'position' && n !== 'normal') ng.deleteAttribute(n);
  const c = new THREE.Color(hex).multiplyScalar(k);
  const a = new Float32Array(ng.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}

/** Same attribute set for merging (position, normal, colour). */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'color' && n !== 'uv') ng.deleteAttribute(n);
  if (!ng.attributes.normal) ng.computeVertexNormals();
  if (!ng.attributes.color) {
    const a = new Float32Array(ng.attributes.position.count * 3).fill(1);
    ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
  const c = ng.attributes.color as THREE.BufferAttribute;
  if (c.itemSize === 4) {
    const a = new Float32Array(c.count * 3);
    for (let i = 0; i < c.count; i++) a.set([c.getX(i), c.getY(i), c.getZ(i)], i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  return ng;
}

/** Position and normal only (the carton material needs nothing else). */
function strip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (n !== 'position' && n !== 'normal') ng.deleteAttribute(n);
  return ng;
}

const PELLET = (() => {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  return g;
})();

/** Soil pellets (or frass, refuse) scattered in a disc, denser inward. */
function pellets(cx: number, cy: number, R: number, n: number, rng: Rng, at: (x: number, y: number) => number, cols: number[], s0: number, s1: number, inner = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = inner + Math.pow(rng.next(), 0.8) * (R - inner);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const sz = rng.range(s0, s1);
    const g = coloured(PELLET.clone(), cols[i % cols.length], rng.range(0.8, 1.15));
    g.scale(sz, sz * rng.range(0.55, 0.85), sz);
    g.rotateY(rng.range(0, 6.28));
    g.translate(x, at(x, y) + sz * 0.18, y);
    out.push(g);
  }
  return out;
}

/** Thin slivers lying on a surface (pine needles, twigs, frass flakes). */
function slivers(cx: number, cy: number, R: number, n: number, rng: Rng, at: (x: number, y: number) => number, cols: number[], len: [number, number], wid: number, inner = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = inner + Math.sqrt(rng.next()) * (R - inner);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const L = rng.range(len[0], len[1]);
    const g = coloured(new THREE.BoxGeometry(L, wid * 0.7, wid), cols[i % cols.length], rng.range(0.8, 1.2));
    const yaw = rng.range(0, Math.PI);
    // tilt with the local slope so needles lie on the dome
    const e = 0.6;
    const sx = (at(x + e, y) - at(x - e, y)) / (2 * e);
    const sz = (at(x, y + e) - at(x, y - e)) / (2 * e);
    g.rotateY(yaw);
    const slope = Math.atan(Math.cos(yaw) * sx - Math.sin(yaw) * sz);
    g.rotateZ(0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize(), slope));
    g.translate(x, at(x, y) + wid * 0.4, y);
    out.push(g);
  }
  return out;
}

/** Small flat leaf pieces (leafcutter fragments, litter). */
function leafBits(cx: number, cy: number, R: number, n: number, rng: Rng, at: (x: number, y: number) => number, cols: number[], size: [number, number], inner = 0, dir?: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = dir !== undefined ? dir + rng.range(-0.25, 0.25) : rng.range(0, Math.PI * 2);
    const d = inner + Math.sqrt(rng.next()) * (R - inner);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const s = rng.range(size[0], size[1]);
    // a leaf (or a torn piece of one): pointed oval, ragged where it is torn
    const shape = new THREE.Shape();
    const k = 14;
    const torn = rng.chance(0.5);
    for (let j = 0; j < k; j++) {
      const t = (j / k) * Math.PI * 2;
      const pointed = Math.pow(Math.abs(Math.sin(t)), 0.8);
      const rag = torn && Math.cos(t) > 0.3 ? 0.7 + 0.3 * rng.next() : 1;
      const px = Math.cos(t) * s * rag;
      const py = Math.sin(t) * s * 0.42 * pointed;
      if (j) shape.lineTo(px, py);
      else shape.moveTo(px, py);
    }
    const g = coloured(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }), cols[i % cols.length], rng.range(0.8, 1.15));
    g.rotateX(-Math.PI / 2 + rng.range(-0.15, 0.15));
    g.rotateY(rng.range(0, 6.28));
    g.translate(x, at(x, y) + 0.15, y);
    out.push(g);
  }
  return out;
}

/** Thatch over a Formica dome: needles and twig pieces lying on it. */
function thatch(m: Mass, ground: (x: number, y: number) => number, rng: Rng, n: number): THREE.BufferGeometry[] {
  const at = (x: number, y: number) => ground(x, y) + massHeight(m, x, y);
  return [...slivers(m.x, m.y, m.r * 0.98, n, rng, at, [0x5a3a20, 0x7a4e2a, 0x3e2814, 0x8a6036, 0x4a3018, 0x6a4024], [1.6, 3.8], 0.17), ...slivers(m.x, m.y, m.r * 0.9, Math.round(n / 40), rng, at, [0x3e2e20, 0x4e3a28], [4, 8], 0.45)];
}

/**
 * Trails worn bare running out from a mound's foot: ribbons of packed soil, fading at their edges and ends (out past the
 * holes, when their headings `angles` are given).
 */
function trails(cx: number, cy: number, R: number, n: number, rng: Rng, ground: (x: number, y: number) => number, angles?: number[]): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const c = new THREE.Color(0x3a2c20);
  for (let k = 0; k < n; k++) {
    let a = (angles ? angles[k] : (k / n) * Math.PI * 2) + rng.range(-0.4, 0.4) * (angles ? 0.3 : 1);
    let x = cx + Math.cos(a) * R * 0.92;
    let y = cy + Math.sin(a) * R * 0.92;
    const L = rng.range(40, 90);
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const steps = Math.round(L / 3);
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const w = 2.2 * (1 - u * 0.5);
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      for (const side of [-1, 0, 1]) {
        const px = x + nx * w * side;
        const py = y + ny * w * side;
        pos.push(px, ground(px, py) + 0.05, py);
        const al = (side === 0 ? 0.75 : 0) * (1 - u) * Math.min(1, s / 2);
        col.push(c.r, c.g, c.b, al);
        uv.push(px / 14, py / 14);
      }
      if (s < steps) {
        const i0 = s * 3;
        idx.push(i0, i0 + 3, i0 + 1, i0 + 1, i0 + 3, i0 + 4, i0 + 1, i0 + 4, i0 + 2, i0 + 2, i0 + 4, i0 + 5);
      }
      a += rng.range(-0.15, 0.15);
      x += Math.cos(a) * 3;
      y += Math.sin(a) * 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    out.push(g);
  }
  return out;
}

/** One army-ant worker (unit length ≈ 4 mm along x): head, narrow waist, thorax, gaster, six legs splayed to hook neighbours. */
function antBody(): THREE.BufferGeometry {
  const part = (rx: number, ry: number, rz: number, x: number, y = 0) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(rx, ry, rz);
    g.translate(x, y, 0);
    return g;
  };
  const parts: THREE.BufferGeometry[] = [part(0.5, 0.42, 0.45, 1.45), part(0.62, 0.36, 0.34, 0.45), part(0.2, 0.2, 0.2, -0.25), part(0.85, 0.55, 0.6, -1.05, 0.05)];
  for (const side of [-1, 1])
    for (const [x, a] of [
      [0.75, 0.6],
      [0.45, 0],
      [0.15, -0.6],
    ] as const) {
      const leg = new THREE.BoxGeometry(1.7, 0.09, 0.09);
      leg.translate(0.85, 0, 0);
      leg.rotateZ(-0.35);
      leg.rotateY(side * (Math.PI / 2 - a));
      leg.translate(x, -0.1, 0);
      parts.push(leg);
    }
  const g = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => {
    for (const n of Object.keys(x.attributes)) if (n !== 'position' && n !== 'normal') x.deleteAttribute(n);
    return x;
  }))!;
  g.computeVertexNormals();
  return g;
}

let ANT_BODY: THREE.BufferGeometry | null = null;

/** Army ant bivouac: hundreds of linked workers heaped over the mass, every way up, legs hooked together (none over its holes). */
function bivouac(m: Mass, ground: (x: number, y: number) => number, rng: Rng, n: number, mat: THREE.Material, holes: readonly Entrance[] = []): THREE.InstancedMesh {
  ANT_BODY ??= antBody();
  const mesh = new THREE.InstancedMesh(ANT_BODY, mat, n);
  const M = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * m.r * 0.98;
    let x = m.x + Math.cos(a) * d;
    let y = m.y + Math.sin(a) * d;
    // (the ways in stay open: a body over a hole slides up the mass, away from it)
    for (const e of holes)
      if (Math.hypot(x - e.sx, y - e.sy) < 3.2) {
        x = m.x + (x - m.x) * 0.7;
        y = m.y + (y - m.y) * 0.7;
      }
    const h = massHeight(m, x, y) * rng.range(0.9, 1.04);
    const major = i % 23 === 0;
    const s = (major ? 1.6 : 1) * rng.range(0.75, 1.1);
    e.set(rng.range(-1.2, 1.2), rng.range(0, 6.28), rng.range(-1.2, 1.2));
    q.setFromEuler(e);
    pos.set(x, ground(x, y) + h + 0.2, y);
    sc.setScalar(s);
    M.compose(pos, q, sc);
    mesh.setMatrixAt(i, M);
    // reddish-brown workers, a few majors with pale heads
    col.setHex(major ? 0x9a7240 : [0x4a2412, 0x5a2c14, 0x3a1a0c, 0x6a3618][i % 4]).multiplyScalar(rng.range(0.8, 1.1));
    mesh.setColorAt(i, col);
  }
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** A lumpy, broken ring of carton round a hole's throat (Termants), following the rim. */
function cartonCollar(x0: number, y0: number, rim: Rim, at: (x: number, y: number) => number, seed: number): THREE.BufferGeometry {
  const R = (rim.holeR + rim.rimR) * 0.5;
  const g = new THREE.TorusGeometry(R, rim.rimH * 0.42, 6, 40, Math.PI * 2 * 0.82);
  g.rotateX(-Math.PI / 2);
  g.rotateY((seed % 7) * 0.9);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const lump = 1 + 0.35 * (valueNoise2(x * 1.7 + seed, z * 1.7, seed) - 0.5);
    const wx = x0 + x * lump;
    const wz = y0 + z * lump;
    p.setXYZ(i, wx, at(wx, wz) + p.getY(i) * lump * 0.8 + rim.rimH * 0.1, wz);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** A flat stone overhanging one side of a hole (black garden ants often nest under one). */
function flatStone(x0: number, y0: number, rim: Rim, rng: Rng, under: (x: number, y: number) => number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const n = 0.85 + 0.3 * valueNoise2(p.getX(i) * 2 + 7, p.getZ(i) * 2 + p.getY(i), rim.seed);
    p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.32, p.getZ(i) * n);
  }
  const a = rng.range(0, Math.PI * 2);
  const R = rim.rimR * 1.5;
  g.scale(R, R, R * 0.8);
  g.rotateY(a);
  const x = x0 + Math.cos(a) * R * 0.9;
  const y = y0 + Math.sin(a) * R * 0.9;
  g.translate(x, under(x, y) + R * 0.2, y);
  return coloured(g, 0x5a564e, 1);
}

/** Loose bits round one entrance, by species. */
function entranceDetails(look: Look, e: Entrance, i: number, rim: Rim, rng: Rng, at: (x: number, y: number) => number, ctr: { x: number; y: number }, k: number): THREE.BufferGeometry[] {
  const pal = PAL[look];
  const out = Math.atan2(e.sy - ctr.y, e.sx - ctr.x);
  const fill = e.fall ?? 0;
  const n = (base: number) => Math.round(base * k * (1 - 0.6 * fill));
  switch (look) {
    case 'lasius':
    case 'plagiaria':
    case 'solenopsis':
      return [
        ...pellets(e.sx, e.sy, rim.outR * 0.9, n(look === 'solenopsis' ? 120 : 190), rng, at, [pal.pellet, pal.dry, pal.damp, 0x6a5644], 0.35, 0.8, rim.holeR * 1.1),
        ...(look === 'plagiaria' ? slivers(e.sx, e.sy, rim.outR * 0.8, n(30), rng, at, [0x7a5a34, 0x5a3e24], [1.8, 4], 0.28, rim.holeR * 1.3) : []),
      ];
    case 'atta':
      // loose excavated soil, leaf fragments carried in, a cleared trail leading away
      return [
        ...pellets(e.sx, e.sy, rim.outR, n(260), rng, at, [pal.pellet, pal.dry, 0xa8703e, pal.damp], 0.45, 1.2, rim.holeR * 1.1),
        ...leafBits(e.sx, e.sy, rim.outR * 1.6, n(16), rng, at, [0x5a8a30, 0x6a9a3a, 0x4a7a28, 0x8aa040], [0.9, 1.8], rim.holeR * 1.5, out),
      ];
    case 'formica':
      return slivers(e.sx, e.sy, rim.outR, n(26), rng, at, [0x6a4426, 0x8a5a30], [2, 4.5], 0.3, rim.holeR * 1.1);
    case 'hell':
      // a neat hole in the leaf litter (reconstruction)
      return [...leafBits(e.sx, e.sy, rim.outR * 3.4, 16, rng, at, [0x5a3e22, 0x7a5430, 0x4a321c, 0x6a4a2a, 0x8a6236], [2, 4.2], rim.holeR * 2.2), ...pellets(e.sx, e.sy, rim.outR, n(26), rng, at, [pal.pellet, pal.dry], 0.25, 0.5, rim.holeR * 1.1)];
    case 'aurimyrmex':
      // pale sawdust-like frass spilling from the hole
      return [...pellets(e.sx, e.sy, rim.outR * 1.2, n(140), rng, at, [0xd8c49a, 0xc8b086, 0xe6d6b0, 0xa88e62], 0.18, 0.42, rim.holeR * 0.9), ...slivers(e.sx, e.sy, rim.outR, n(40), rng, at, [0xd2bc90, 0xbca478], [0.6, 1.4], 0.18, rim.holeR)];
    case 'termant':
      // soil pellets and dark carton flakes plastered round the crest
      return [...pellets(e.sx, e.sy, rim.outR * 0.85, n(80), rng, at, [pal.pellet, pal.dry], 0.3, 0.55, rim.rimR * 0.9), ...pellets(e.sx, e.sy, rim.rimR * 1.15, n(46), rng, at, [0x2e2016, 0x3b2a1e, 0x4a3626], 0.45, 0.9, rim.holeR * 1.05)];
    case 'nasute':
      return pellets(e.sx, e.sy, rim.outR, n(24), rng, at, [0x3b2a1e, 0x2e2016], 0.3, 0.6, rim.holeR);
    case 'sickle': {
      // the litter round the collar, and crumbs of the soil it is built of
      return [...leafBits(e.sx, e.sy, 9, 6, rng, at, [0x7a5a30, 0x5e4426, 0x9a7038], [1.4, 2.8], rim.outR), ...pellets(e.sx, e.sy, rim.outR * 1.3, n(20), rng, at, [pal.pellet, pal.dry], 0.2, 0.45, rim.outR * 0.8)];
    }
    case 'eciton':
      return [];
  }
  void i;
}
