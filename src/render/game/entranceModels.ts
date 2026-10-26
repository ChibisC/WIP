import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World } from '../../sim/world';
import { Colony, Entrance } from '../../sim/types';
import { SpeciesId } from '../../sim/species';
import { Rng, valueNoise2 } from '../../core/rng';
import { patchDapple } from '../shaderPatch';
import { textures } from '../textures';
import { buildGalleryTubeGeometry, createCartonMaterial } from '../termite/carton';

/**
 * Species-specific surface entrances (claude/maps/02-spec-nest-entrances §2.1; research notes in
 * docs/creatures/entrances.md). Render-only: every hole is drawn from the simulation's entrance
 * list, so it always sits where the ants go in.
 *
 * Each entrance gets an apron mesh round its hole: a crater rim, collar or plain lip of the
 * species' soil, damp and darker toward a black opening, fading into the ground at its edge.
 * Some species also raise one structure over the whole nest: a red wood ant's thatched dome
 * (holes in its flanks), a nasute termite's carton nest with covered galleries, a carpenter-like
 * Gilded Ant's rotting stump with frass, an army ant bivouac of clinging bodies, a leafcutter's
 * pale refuse dump. Loose details (soil pellets, needles, leaf bits, sawdust) are merged per
 * entrance. Everything walkable adds to `height()`, which the surface renderers add to the
 * terrain so ants climb rims and domes instead of passing through them.
 *
 * Meshes are rebuilt only when an entrance appears, grows a size step, is plugged or caves in.
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
  lasius: { dry: 0x6b5644, damp: 0x3a2c22, pellet: 0x58463a },
  formica: { dry: 0x5c4634, damp: 0x34261c, pellet: 0x4a382a },
  atta: { dry: 0xa8683c, damp: 0x6a3e22, pellet: 0xb87a4a },
  solenopsis: { dry: 0x8a5a3a, damp: 0x4a3020, pellet: 0x9a6a46 },
  eciton: { dry: 0x5a4a3a, damp: 0x2e241c, pellet: 0x4a3c30 },
  plagiaria: { dry: 0x66503e, damp: 0x382a20, pellet: 0x56443a },
  hell: { dry: 0x5e4a38, damp: 0x30241a, pellet: 0x4e3e30 },
  aurimyrmex: { dry: 0x6a5440, damp: 0x3a2c20, pellet: 0xd2bc90 },
  termant: { dry: 0x6e5440, damp: 0x3a2a1e, pellet: 0x5a4434 },
  nasute: { dry: 0x5a4430, damp: 0x2e2218, pellet: 0x4a3828 },
  sickle: { dry: 0x6a4e38, damp: 0x34261a, pellet: 0x5a4232 },
};

/** Hole radius (mm) of a main entrance per look; extras are 0.8×. */
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
}

function massHeight(m: Mass, x: number, y: number): number {
  const dx = x - m.x;
  const dy = y - m.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= m.r * m.r) return 0;
  const a = Math.atan2(dy, dx);
  const rr = m.r * (1 + 0.06 * Math.sin(a * 5 + m.seed) + 0.04 * Math.sin(a * 9 + m.seed * 2));
  const t = Math.sqrt(d2) / rr;
  if (t >= 1) return 0;
  return m.h * Math.pow(Math.max(0, 1 - Math.pow(t, 2 / m.k)), 0.5 * m.k) * (0.96 + 0.04 * Math.sin(a * 11 + m.seed));
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
  /** flat lists for height queries */
  private holes: Hole[] = [];
  private masses: Mass[] = [];

  constructor() {
    const tex = textures();
    this.apronMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, normalMap: tex.soil.normal, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    patchDapple(this.apronMat);
    this.detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    patchDapple(this.detailMat);
    this.massMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, normalMap: tex.soil.normal, normalScale: new THREE.Vector2(1.3, 1.3) });
    patchDapple(this.massMat);
    this.cartonMat = createCartonMaterial({ layerMm: 0.45, bump: 0.8 });
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
      const sig = `${look}|${size}|${living}|${c.entrances.map((e) => `${e.sx.toFixed(1)},${e.sy.toFixed(1)},${e.shut ? 1 : 0},${Math.round((e.fall ?? 0) * 4)}`).join(';')}`;
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
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
  }

  // ------------------------------------------------------------------ building

  private build(w: World, c: Colony, look: Look, s: number, living: number, sig: string, ground: (x: number, y: number) => number): Built {
    const b: Built = { sig, objs: [], holes: [], masses: [] };
    const fallC = Math.max(...c.entrances.map((e) => e.fall ?? 0));
    const ctr = { x: c.nx, y: c.ny };
    // ---- the nest structure first (holes sit on it)
    const details: THREE.BufferGeometry[] = [];
    const massGeos: THREE.BufferGeometry[] = [];
    const cartonGeos: THREE.BufferGeometry[] = [];
    const rng = new Rng(c.id * 7919 + 101);
    const far = Math.max(...c.entrances.map((e) => Math.hypot(e.sx - ctr.x, e.sy - ctr.y)));
    const e0 = c.entrances[0];
    const out0 = Math.atan2(e0.sy - ctr.y, e0.sx - ctr.x);
    if (look === 'formica') {
      // a thatched dome over the nest; the entrance holes open in its flanks
      const R = Math.max(16 + living * 14, far * 1.3);
      const m: Mass = { x: ctr.x, y: ctr.y, r: R, h: R * 0.42 * (1 - 0.6 * fallC), k: 1.15, seed: c.id * 3 + 1 };
      b.masses.push(m);
      massGeos.push(massMesh(m, ground, (x, y, h, t) => thatchColour(x, y, h, t, m.seed)));
      details.push(...thatch(m, ground, rng, Math.round(220 + R * 14)));
      // a worn bare ring at its foot, trails radiating out
      details.push(...trails(ctr.x, ctr.y, R, 5, rng, ground, 0x4a3828));
    } else if (look === 'nasute') {
      // a dark carton nest round the main entrance, covered galleries running off along the ground
      const R = 9 + living * 9;
      const m: Mass = { x: e0.sx + Math.cos(out0) * R * 0.35, y: e0.sy + Math.sin(out0) * R * 0.35, r: R, h: R * 0.85 * (1 - 0.5 * fallC), k: 1.4, seed: c.id * 5 + 3 };
      b.masses.push(m);
      cartonGeos.push(lobedMass(m, ground, rng));
      for (let k = 0; k < 3; k++) {
        const a = out0 + 1.4 + k * 1.75 + rng.range(-0.3, 0.3);
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
      // a rotting stump beside the main hole, pale frass spilling out in front
      const R = 6 + living * 4;
      const m: Mass = { x: e0.sx - Math.cos(out0) * (R + 0.8), y: e0.sy - Math.sin(out0) * (R + 0.8), r: R, h: R * 1.05, k: 3.2, seed: c.id * 11 + 2 };
      b.masses.push(m);
      massGeos.push(stumpMesh(m, ground, rng));
    } else if (look === 'eciton') {
      // the bivouac: a hanging mass of linked workers round the main hole
      const R = 8 + living * 7;
      const m: Mass = { x: e0.sx - Math.cos(out0) * R * 0.25, y: e0.sy - Math.sin(out0) * R * 0.25, r: R, h: R * 0.7 * (1 - 0.8 * fallC), k: 1.2, seed: c.id * 13 + 5 };
      b.masses.push(m);
      if (fallC < 0.9) details.push(bivouac(m, ground, rng, Math.round(260 + living * 500)));
    } else if (look === 'atta') {
      // a pale refuse dump to one side of the main entrance (where the waste and the dead are dropped)
      const a = out0 + 0.9;
      const m: Mass = { x: e0.sx + Math.cos(a) * 30, y: e0.sy + Math.sin(a) * 30, r: 6 + living * 6, h: 2 + living * 2.5, k: 1, seed: c.id * 19 + 7 };
      b.masses.push(m);
      massGeos.push(massMesh(m, ground, (x, y, h, t) => refuseColour(x, y, t)));
      details.push(...pellets(m.x, m.y, m.r * 0.9, Math.round(70 + m.r * 6), rng, (x, y) => ground(x, y) + massHeight(m, x, y), [0xc8bca4, 0x9a8e78, 0xd8ccb0, 0x6a6050], 0.35, 0.8));
    }
    const under = (x: number, y: number) => {
      let h = ground(x, y);
      for (const m of b.masses) h += massHeight(m, x, y);
      return h;
    };
    // ---- each entrance: its rim, hole and loose details
    c.entrances.forEach((e, i) => {
      const main = i === 0;
      const k = (main ? 1 : 0.8) * Math.min(1.35, s);
      const hr = HOLE[look] * (main ? 1 : 0.8);
      const seed = c.id * 31 + i * 7 + 1;
      const rim = rimFor(look, hr, k, seed, main);
      const hole: Hole = { x: e.sx, y: e.sy, look, rim, plug: e.shut ? 1 : (e.work ?? 0) > 0 ? 0.5 : 0, fall: e.fall ?? 0 };
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
    case 'formica': // a hole in the dome's flank with a small lip
    case 'nasute':
    case 'eciton':
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
      // the opening sinks a little below the lip so it reads as a hole, not a decal
      const sink = fill < 1 && d < r.holeR ? -0.25 * (1 - fill) * (1 - d / r.holeR) : 0;
      pos.push(x, under(x, y) + h + 0.06 + sink, y);
      uv.push(x / 14, y / 14);
      // colour: black opening → damp throat → dry crest → apron
      const grain = valueNoise2(x * 1.7, y * 1.7, r.seed) - 0.5;
      const crest = Math.min(1, h / Math.max(0.1, r.rimH));
      c.copy(damp).lerp(dry, Math.min(1, crest * 0.8 + Math.max(0, (d - r.rimR) / r.outR)));
      c.multiplyScalar(0.9 + grain * 0.25);
      if (d < r.holeR * 1.15) {
        const k = smooth((r.holeR * 1.15 - d) / (r.holeR * 0.6));
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

/** A polar mesh over a mass (dome, dump), coloured by `paint(x, y, h, t)` (t = distance / radius). */
function massMesh(m: Mass, ground: (x: number, y: number) => number, paint: (x: number, y: number, h: number, t: number) => THREE.Color): THREE.BufferGeometry {
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
      pos.push(x, ground(x, y) + h + 0.03 - (t > 1 ? 0.3 : 0), y);
      uv.push(x / 16, y / 16 + h / 16);
      const cc = paint(x, y, h, t);
      col.push(cc.r, cc.g, cc.b);
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
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const tmpC = new THREE.Color();
function thatchColour(x: number, y: number, h: number, t: number, seed: number): THREE.Color {
  // needles, twigs and resin-dark plant bits; drier and paler on the sunny top
  const n1 = valueNoise2(x * 0.9, y * 0.9, seed);
  const n2 = valueNoise2(x * 2.6 + 5, y * 2.6, seed + 3);
  tmpC.setHSL(0.075 + 0.02 * n1, 0.45 + 0.1 * n2, 0.14 + 0.1 * n1 + 0.06 * Math.min(1, h / 8), THREE.SRGBColorSpace);
  if (t > 0.92) tmpC.lerp(new THREE.Color(0x3a2c20), (t - 0.92) / 0.2);
  return tmpC.clone();
}

function refuseColour(x: number, y: number, t: number): THREE.Color {
  const n = valueNoise2(x * 1.3, y * 1.3, 77);
  tmpC.setHSL(0.1, 0.18, 0.5 + 0.18 * n, THREE.SRGBColorSpace);
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
      tmpC.copy(bark).multiplyScalar(0.8 + 0.4 * valueNoise2(a * 3, t * 8, m.seed));
      col.push(tmpC.r, tmpC.g, tmpC.b);
    }
  }
  // the decayed top: a dished, crumbling cap
  const topStart = pos.length / 3;
  pos.push(m.x, g0 + m.h * 0.82, m.y);
  col.push(rot.r * 0.7, rot.g * 0.7, rot.b * 0.7);
  for (let i = 0; i < SEG; i++) {
    const k = RINGS * SEG + i;
    pos.push(pos[k * 3], pos[k * 3 + 1] - 0.05, pos[k * 3 + 2]);
    tmpC.copy(rot).multiplyScalar(0.75 + 0.35 * valueNoise2(i, 3, m.seed));
    col.push(tmpC.r, tmpC.g, tmpC.b);
  }
  for (let ri = 0; ri < RINGS; ri++)
    for (let i = 0; i < SEG; i++) {
      const a = ri * SEG + i;
      const a1 = ri * SEG + ((i + 1) % SEG);
      const b = a + SEG;
      const b1 = a1 + SEG;
      idx.push(a, b, a1, a1, b, b1);
    }
  for (let i = 0; i < SEG; i++) idx.push(topStart, topStart + 1 + i, topStart + 1 + ((i + 1) % SEG));
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
    const shape = new THREE.Shape();
    const k = 5 + rng.int(0, 3);
    for (let j = 0; j < k; j++) {
      const t = (j / k) * Math.PI * 2;
      const r = s * (0.6 + 0.4 * rng.next());
      const px = Math.cos(t) * r;
      const py = Math.sin(t) * r * 0.7;
      if (j) shape.lineTo(px, py);
      else shape.moveTo(px, py);
    }
    const g = coloured(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }), cols[i % cols.length], rng.range(0.8, 1.15));
    g.rotateX(-Math.PI / 2);
    g.rotateY(rng.range(0, 6.28));
    g.translate(x, at(x, y) + 0.12, y);
    out.push(g);
  }
  return out;
}

/** Thatch over a Formica dome: needles and twig pieces lying on it. */
function thatch(m: Mass, ground: (x: number, y: number) => number, rng: Rng, n: number): THREE.BufferGeometry[] {
  const at = (x: number, y: number) => ground(x, y) + massHeight(m, x, y);
  return [...slivers(m.x, m.y, m.r * 0.98, n, rng, at, [0x6a4426, 0x8a5a30, 0x4a3018, 0x9a7040, 0x5a3a20], [2.4, 5.5], 0.32), ...slivers(m.x, m.y, m.r * 0.9, Math.round(n / 14), rng, at, [0x4a3626, 0x5a4430], [5, 10], 0.9)];
}

/** Worn ground at the foot of a mound and darker trails running out from it. */
function trails(cx: number, cy: number, R: number, n: number, rng: Rng, ground: (x: number, y: number) => number, col: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    let a = (k / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
    let x = cx + Math.cos(a) * R * 0.95;
    let y = cy + Math.sin(a) * R * 0.95;
    const L = rng.range(30, 70);
    for (let s = 0; s < L; s += 2.2) {
      a += rng.range(-0.12, 0.12);
      x += Math.cos(a) * 2.2;
      y += Math.sin(a) * 2.2;
      const w = 2.4 * (1 - (s / L) * 0.6);
      const g = coloured(new THREE.CircleGeometry(w, 7), col, rng.range(0.85, 1.05));
      g.rotateX(-Math.PI / 2);
      g.translate(x, ground(x, y) + 0.03, y);
      out.push(g);
    }
  }
  return out;
}

/** Army ant bivouac: hundreds of linked workers heaped round the hole, legs hooked together. */
function bivouac(m: Mass, ground: (x: number, y: number) => number, rng: Rng, n: number): THREE.BufferGeometry {
  const body = new THREE.IcosahedronGeometry(0.5, 0);
  body.scale(2.6, 0.9, 0.9);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * m.r * 0.98;
    const x = m.x + Math.cos(a) * d;
    const y = m.y + Math.sin(a) * d;
    const h = massHeight(m, x, y) * rng.range(0.85, 1.02);
    const g = coloured(body.clone(), [0x5a2814, 0x6a3418, 0x3e1c0e, 0x7a4020][i % 4], rng.range(0.85, 1.15));
    g.rotateZ(rng.range(-0.8, 0.8));
    g.rotateY(rng.range(0, 6.28));
    g.translate(x, ground(x, y) + h, y);
    parts.push(g);
    // a strand of hooked legs: a thin dark link to a neighbour
    if (i % 3 === 0) {
      const leg = coloured(new THREE.BoxGeometry(1.6, 0.12, 0.12), 0x2a1408);
      leg.rotateY(rng.range(0, 6.28));
      leg.rotateZ(rng.range(-0.6, 0.6));
      leg.translate(x, ground(x, y) + h + 0.2, y);
      parts.push(leg);
    }
  }
  return mergeGeometries(parts.map(prep))!;
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
  return coloured(g, 0x8a8478, 0.95);
}

/** Loose bits round one entrance, by species. */
function entranceDetails(look: Look, e: Entrance, i: number, rim: Rim, rng: Rng, at: (x: number, y: number) => number, ctr: { x: number; y: number }, k: number): THREE.BufferGeometry[] {
  const pal = PAL[look];
  const out = Math.atan2(e.sy - ctr.y, e.sx - ctr.x);
  const fill = Math.max(e.shut ? 1 : 0, e.fall ?? 0);
  const n = (base: number) => Math.round(base * k * (1 - 0.6 * fill));
  switch (look) {
    case 'lasius':
    case 'plagiaria':
    case 'solenopsis':
      return [
        ...pellets(e.sx, e.sy, rim.outR * 0.9, n(look === 'solenopsis' ? 70 : 110), rng, at, [pal.pellet, pal.dry, pal.damp], 0.3, 0.6, rim.holeR * 1.1),
        ...(look === 'plagiaria' ? slivers(e.sx, e.sy, rim.outR * 0.8, n(30), rng, at, [0x7a5a34, 0x5a3e24], [1.8, 4], 0.28, rim.holeR * 1.3) : []),
      ];
    case 'atta':
      // loose excavated soil, leaf fragments carried in, a cleared trail leading away
      return [
        ...pellets(e.sx, e.sy, rim.outR, n(160), rng, at, [pal.pellet, pal.dry, 0xc48a58, pal.damp], 0.35, 0.8, rim.holeR * 1.1),
        ...leafBits(e.sx, e.sy, rim.outR * 1.6, n(16), rng, at, [0x5a8a30, 0x6a9a3a, 0x4a7a28, 0x8aa040], [0.9, 1.8], rim.holeR * 1.5, out),
      ];
    case 'formica':
      return slivers(e.sx, e.sy, rim.outR, n(26), rng, at, [0x6a4426, 0x8a5a30], [2, 4.5], 0.3, rim.holeR * 1.1);
    case 'hell':
      // a neat hole in the leaf litter (reconstruction)
      return [...leafBits(e.sx, e.sy, rim.outR * 3, 9, rng, at, [0x7a5a30, 0x9a7038, 0x5e4426, 0x8a6a40], [1.6, 3.2], rim.holeR * 2.2), ...pellets(e.sx, e.sy, rim.outR, n(18), rng, at, [pal.pellet, pal.dry], 0.25, 0.45, rim.holeR * 1.1)];
    case 'aurimyrmex':
      // pale sawdust-like frass spilling from the hole
      return [...pellets(e.sx, e.sy, rim.outR * 1.2, n(140), rng, at, [0xd8c49a, 0xc8b086, 0xe6d6b0, 0xa88e62], 0.18, 0.42, rim.holeR * 0.9), ...slivers(e.sx, e.sy, rim.outR, n(40), rng, at, [0xd2bc90, 0xbca478], [0.6, 1.4], 0.18, rim.holeR)];
    case 'termant':
      // soil pellets and dark carton flakes plastered round the crest
      return [...pellets(e.sx, e.sy, rim.outR * 0.85, n(80), rng, at, [pal.pellet, pal.dry], 0.3, 0.55, rim.rimR * 0.9), ...pellets(e.sx, e.sy, rim.rimR * 1.15, n(46), rng, at, [0x2e2016, 0x3b2a1e, 0x4a3626], 0.45, 0.9, rim.holeR * 1.05)];
    case 'nasute':
      return pellets(e.sx, e.sy, rim.outR, n(24), rng, at, [0x3b2a1e, 0x2e2016], 0.3, 0.6, rim.holeR);
    case 'sickle': {
      // tiny foraging holes with soil collars scattered in the litter round the turret
      const parts: THREE.BufferGeometry[] = [...leafBits(e.sx, e.sy, 16, 10, rng, at, [0x7a5a30, 0x5e4426, 0x9a7038], [1.4, 2.8], rim.outR)];
      for (let j = 0; j < 4 * (1 - fill); j++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(7, 14);
        const x = e.sx + Math.cos(a) * d;
        const y = e.sy + Math.sin(a) * d;
        const ring = coloured(new THREE.TorusGeometry(0.7, 0.32, 5, 12), pal.dry, rng.range(0.85, 1.1));
        ring.rotateX(-Math.PI / 2);
        ring.translate(x, at(x, y) + 0.15, y);
        const hole = coloured(new THREE.CircleGeometry(0.55, 10), 0x060504);
        hole.rotateX(-Math.PI / 2);
        hole.translate(x, at(x, y) + 0.12, y);
        parts.push(ring, hole);
      }
      return parts;
    }
    case 'eciton':
      return [];
  }
  void i;
}
