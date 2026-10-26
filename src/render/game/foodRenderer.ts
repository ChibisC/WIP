import * as THREE from 'three';
import { World } from '../../sim/world';
import { AS, Food, SURFACE } from '../../sim/types';
import { casteOf } from '../../sim/species';
import { ECITON } from '../../sim/balance';
import { InstancedPool } from './instancedPool';
import { appleGeometry, beetleGeometry, berryGeometry, crumbGeometry, cricketGeometry, dropletGeometry, flyGeometry, leafFragGeometry, mothGeometry, seedGeometry, woodGeometry } from './foodModels';
import { patchDapple } from '../shaderPatch';
import { buildLeafLitterGeometry, createLeafLitterMaterial } from '../termite/soil';

type ModelKey = 'fly' | 'cricket' | 'grasshopper' | 'moth' | 'beetle' | 'seed' | 'berry' | 'apple' | 'crumb' | 'leaf' | 'drop' | 'litter' | 'litterchip' | WoodKey;
type WoodKey = 'twig' | 'branch' | 'bamboo' | 'log' | 'stump' | 'palmFrond' | 'chip';
const WOOD_KEYS: WoodKey[] = ['twig', 'branch', 'bamboo', 'log', 'stump', 'palmFrond', 'chip'];

export interface SpaceMapper {
  /** world position of plane coords; `lift` along the surface normal */
  pos(x: number, y: number, lift: number, out: THREE.Vector3): void;
  up(out: THREE.Vector3): void;
  /** world rotation for a heading lying flat */
  quat(h: number, out: THREE.Quaternion): void;
}

const CRUMB_COL: Record<string, number> = {
  insect: 0x4a3424,
  fly: 0x3a3230,
  cricket: 0x4a3220,
  grasshopper: 0x5d7a2e,
  moth: 0x8a7258,
  beetle: 0x1a1a1a,
  berry: 0x8a1018,
  apple: 0xe8d8a8,
  seed: 0xb8a078,
  brood: 0xf2ead8, // stolen larvae and pupae
  corpse: 0x5a3a24,
};

/**
 * Renders food items (prey, seeds, fruit, pieces being carried, leaf
 * fragments) for one space. Ant corpses are drawn by the ant renderer.
 */
export class FoodRenderer {
  group = new THREE.Group();
  private pools = new Map<ModelKey, InstancedPool>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private up = new THREE.Vector3();

  constructor() {
    const mk = (k: ModelKey, g: THREE.BufferGeometry, rough = 0.6, coat = 0) => {
      const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: rough, clearcoat: coat, clearcoatRoughness: 0.2, side: k === 'leaf' ? THREE.DoubleSide : THREE.FrontSide });
      patchDapple(mat);
      this.pools.set(k, new InstancedPool(g, mat, this.group, 32));
    };
    mk('fly', flyGeometry(), 0.45, 0.4);
    mk('cricket', cricketGeometry(false), 0.5, 0.2);
    mk('grasshopper', cricketGeometry(true), 0.55, 0.2);
    mk('moth', mothGeometry(), 0.9, 0);
    mk('beetle', beetleGeometry(), 0.25, 0.9);
    mk('seed', seedGeometry(), 0.55, 0.1);
    mk('berry', berryGeometry(), 0.2, 0.8);
    mk('apple', appleGeometry(), 0.5, 0.2);
    mk('crumb', crumbGeometry(), 0.7, 0.1);
    mk('leaf', leafFragGeometry(), 0.6, 0.1);
    mk('drop', dropletGeometry(), 0.05, 1);
    for (const k of WOOD_KEYS) mk(k, woodGeometry(k), 0.85, 0);
    // leaf litter (the Sickle-Jaw Termites' food): the model kit's torn, curled, veined fragments
    const litterMat = createLeafLitterMaterial();
    patchDapple(litterMat);
    this.pools.set('litter', new InstancedPool(buildLeafLitterGeometry(26, { radius: 0.5, size: [0.12, 0.3], seed: 7 }), litterMat, this.group, 16));
    this.pools.set('litterchip', new InstancedPool(buildLeafLitterGeometry(1, { radius: 0, size: [0.9, 1.0], seed: 3 }), litterMat, this.group, 32));
  }

  setShadows(on: boolean): void {
    this.pools.forEach((p) => p.setShadows(on));
  }

  private keyOf(f: Food): ModelKey | null {
    switch (f.kind) {
      case 'insect':
        return (['fly', 'cricket', 'grasshopper', 'moth', 'beetle'] as ModelKey[]).includes(f.from as ModelKey) ? (f.from as ModelKey) : 'fly';
      case 'seed':
        return 'seed';
      case 'berry':
        return f.from === 'apple' ? 'apple' : 'berry';
      case 'crumb':
      case 'fungus':
        return f.from === 'seed' ? 'seed' : 'crumb';
      case 'leaf':
        return 'leaf';
      case 'honeydew':
        return 'drop';
      case 'corpse':
        return f.from.includes('_') ? null : 'crumb'; // ant corpses via ant renderer; creature remains as lumps
      case 'wood':
        if (f.from === 'litter' || f.from === 'litterchip') return f.from;
        return (WOOD_KEYS as string[]).includes(f.from) ? (f.from as WoodKey) : 'chip';
    }
    return null;
  }

  /** creature carcasses still drawn by the creature renderer (their food item is not drawn twice) */
  private carcass = new Set<number>();

  update(w: World, space: number, alpha: number, map: SpaceMapper): void {
    for (const p of this.pools.values()) p.begin();
    const carcass = this.carcass;
    carcass.clear();
    for (const cr of w.s.creatures) if (cr.dead && cr.space === space && cr.data.food) carcass.add(cr.data.food);
    for (const f of w.s.food) {
      if (f.space !== space) continue;
      if (carcass.size && carcass.has(f.id)) continue;
      const key = this.keyOf(f);
      if (!key) continue;
      const pool = this.pools.get(key)!;
      const x = f.px + (f.x - f.px) * alpha;
      const y = f.py + (f.y - f.py) * alpha;
      let lift = 0;
      let scale = f.size;
      const carrier = f.heldBy ? w.antById.get(f.heldBy) : undefined;
      if (carrier && carrier.state !== AS.Dead) {
        // a termite worker holds its fragment in the model kit's own carry pose (soldiers' meshes have no
        // carried items, so their loads are drawn here like an ant's)
        if (casteOf(carrier.caste).termite === 'worker') continue;
        const L = casteOf(carrier.caste).length;
        // hell ants clamp food up against the horn (the mandible–horn socket)
        lift = L * (casteOf(carrier.caste).snap ? 0.38 : 0.2);
        if (casteOf(carrier.caste).porter && key !== 'leaf') {
          // army-ant porter: slung under the body (the sim puts it at the carry-under point), long axis along the ant
          map.pos(x, y, L * ECITON.porter.underLift, this.p);
          map.quat(f.h, this.q);
          scale = Math.min(f.size, L * ECITON.porter.underMaxSize);
          this.s.set(scale, scale, scale);
          this.m.compose(this.p, this.q, this.s);
          let col: THREE.Color | undefined;
          if (key === 'crumb') col = this.c.setHex(CRUMB_COL[f.from] ?? CRUMB_COL[f.kind] ?? 0x5a4030);
          pool.add(this.m, col);
          continue;
        }
        if (key === 'leaf') {
          // carried upright over the head
          scale = L * 1.15;
          map.pos(x - Math.cos(f.h) * L * 0.25, y - Math.sin(f.h) * L * 0.25, L * 0.32, this.p);
          map.quat(f.h + Math.PI / 2, this.q);
          map.up(this.up);
          this.q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0);
          // stand the fragment up: rotate so its plane is vertical, tilted back slightly
          const rx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.25);
          this.q.multiply(rx);
          this.s.set(scale, scale, scale);
          this.m.compose(this.p, this.q, this.s);
          pool.add(this.m);
          continue;
        }
        scale = Math.min(f.size, L * 0.6);
      } else if (f.amount < f.max && (key === 'fly' || key === 'cricket' || key === 'grasshopper' || key === 'moth' || key === 'beetle' || key === 'berry' || key === 'apple')) {
        // partly eaten items shrink
        scale = f.size * (0.45 + 0.55 * Math.sqrt(Math.max(0, f.amount / f.max)));
      }
      if (key === 'litterchip') scale = Math.max(1.6, f.size * 1.6);
      if (key === 'litter') scale = f.size * (0.55 + 0.45 * Math.sqrt(Math.max(0, f.amount / f.max)));
      map.pos(x, y, lift, this.p);
      map.quat(f.h, this.q);
      if (key === 'leaf') {
        const rx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        this.q.multiply(rx);
        scale = Math.max(2.5, f.size);
      }
      this.s.set(scale, scale, scale);
      this.m.compose(this.p, this.q, this.s);
      let col: THREE.Color | undefined;
      if (key === 'crumb') col = this.c.setHex(CRUMB_COL[f.from] ?? CRUMB_COL[f.kind] ?? 0x5a4030);
      pool.add(this.m, col);
    }
    for (const p of this.pools.values()) p.end();
  }
}

export { SURFACE };
