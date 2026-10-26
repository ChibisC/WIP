import * as THREE from 'three';
import { World } from '../../sim/world';
import { Colony } from '../../sim/types';
import { NestGrid, SOIL_AIR } from '../../world/nestGrid';
import { Rng } from '../../core/rng';
import { TERMANT } from '../../sim/balance';
import { InstancedPool } from '../game/instancedPool';
import { crumbGeometry, seedGeometry } from '../game/foodModels';
import { NestTerrain } from './nestTerrain';
import { globalUniforms } from '../shaderPatch';

/** Spongy Leucoagaricus comb lump. */
function fungusLump(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + 0.2 * Math.sin(x * 13 + y * 7) * Math.cos(z * 11 - x * 5) + 0.08 * Math.sin(y * 31 + z * 23);
    pos.setXYZ(i, x * n, Math.max(-0.1, y * n * 0.7), z * n);
  }
  g.computeVertexNormals();
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const pit = Math.sin(pos.getX(i) * 40) * Math.sin(pos.getY(i) * 37) * Math.sin(pos.getZ(i) * 43) > 0.35;
    const c = pit ? new THREE.Color(0x8a8270) : new THREE.Color(0xeae6da);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

/** Thin straight segment (needle / grass stem) along +x. */
function needle(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.06, 0.08, 1, 5);
  g.rotateZ(Math.PI / 2);
  g.deleteAttribute('uv');
  const c = new Float32Array(g.attributes.position.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Soft vertical shaft of daylight falling onto an entrance ramp. */
function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: globalUniforms.uTime, uCol: { value: new THREE.Color(0.92, 0.95, 1.0) } },
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec2 vUv; varying vec3 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        float fall = pow(1.0 - vUv.y, 0.6);                 // brighter at the bottom
        float edge = sin(vUv.x * 3.14159);                  // soft sides
        float motes = step(0.985, h(floor(vec2(vUv.x*40.0, vUv.y*60.0 + uTime*1.5))));
        float a = fall * edge * edge * 0.16 + motes * 0.25 * edge;
        gl_FragColor = vec4(uCol * a, a);
      }`,
  });
}

/**
 * Contents of the player's nest tiles: stored food on food tiles (fills with
 * the colony's stock), fungus comb, root aphids, thatch, the fire ants' brood
 * mound (soil clods, with brood carried up onto it by day), daylight over the
 * entrance ramps and dust drifting in the warm light.
 */
export class TileDecor {
  group = new THREE.Group();
  private crumbs: InstancedPool;
  private seeds: InstancedPool;
  private fungus: InstancedPool;
  private aphids: InstancedPool;
  private needles: InstancedPool;
  private clods: InstancedPool;
  private sunBrood: InstancedPool;
  private beams: THREE.Mesh[] = [];
  private beamGeo: THREE.CylinderGeometry;
  private beamMat = beamMaterial();
  private dust: THREE.Points;
  private dustVersion = -1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private e = new THREE.Euler();
  private tick = 0;
  private lastKey = '';

  constructor(private terrain: NestTerrain) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.crumbs = new InstancedPool(crumbGeometry(), mat, this.group, 256);
    this.seeds = new InstancedPool(seedGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), this.group, 256);
    this.fungus = new InstancedPool(fungusLump(), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6 }), this.group, 128);
    const aph = new THREE.SphereGeometry(0.5, 8, 6);
    aph.scale(1.2, 0.75, 0.9);
    aph.deleteAttribute('uv');
    aph.setAttribute('color', new THREE.BufferAttribute(new Float32Array(aph.attributes.position.count * 3).fill(1), 3));
    this.aphids = new InstancedPool(aph, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6 }), this.group, 128);
    this.needles = new InstancedPool(needle(), mat, this.group, 256);
    this.clods = new InstancedPool(crumbGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), this.group, 256);
    const pupa = new THREE.SphereGeometry(0.5, 8, 6);
    pupa.scale(0.62, 0.5, 1);
    pupa.deleteAttribute('uv');
    pupa.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pupa.attributes.position.count * 3).fill(1), 3));
    this.sunBrood = new InstancedPool(pupa, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, clearcoat: 0.3, sheen: 0.5, sheenColor: new THREE.Color(0xfff6e0) }), this.group, 128);
    const wallH = terrain.wallH;
    this.beamGeo = new THREE.CylinderGeometry(terrain.grid.R * 0.55, terrain.grid.R * 0.95, wallH * 9, 20, 1, true);
    this.beamGeo.translate(0, wallH * 4.5, 0);
    // Dust motes
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(600), 1));
    this.dust = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: globalUniforms.uTime, uSize: { value: terrain.grid.R * 0.06 } },
        vertexShader: `attribute float seed; uniform float uTime; uniform float uSize; varying float vA;
          void main(){
            vec3 p = position;
            float t = uTime * (0.15 + fract(seed*7.3)*0.2) + seed*40.0;
            p.x += sin(t) * 1.6; p.z += cos(t*0.8) * 1.6; p.y += sin(t*0.6 + seed*3.0) * 0.9;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(uSize * 900.0 / -mv.z, 1.0, 6.0);
            vA = 0.35 + 0.65 * fract(seed * 13.7);
          }`,
        fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * vA * 0.5; gl_FragColor = vec4(vec3(1.0,0.86,0.6)*a, a); }`,
      }),
    );
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  /** Scatter dust motes over the dug floor (re-done when the floor grows). */
  private placeDust(g: NestGrid): void {
    const air: number[] = [];
    for (let k = 0; k < g.soil.length; k += 3) if (g.soil[k] === SOIL_AIR) air.push(k);
    const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const seed = this.dust.geometry.attributes.seed as THREE.BufferAttribute;
    const rng = new Rng(g.version + 17);
    for (let i = 0; i < pos.count; i++) {
      const k = air.length ? air[rng.int(0, air.length - 1)] : 0;
      const x = ((k % g.w) + rng.next()) * g.cell;
      const z = (Math.floor(k / g.w) + rng.next()) * g.cell;
      pos.setXYZ(i, x, rng.range(0.5, this.terrain.wallH * 1.4), z);
      seed.setX(i, rng.next());
    }
    pos.needsUpdate = true;
    seed.needsUpdate = true;
  }

  update(w: World, c: Colony): void {
    const g = this.terrain.grid;
    this.tick++;
    if (this.tick % 30 === 1 && Math.abs(g.version - this.dustVersion) > 40) {
      this.dustVersion = g.version;
      this.placeDust(g);
    }
    // Daylight shafts over entrance ramps
    while (this.beams.length < g.entrances.length) {
      const m = new THREE.Mesh(this.beamGeo, this.beamMat);
      m.renderOrder = 4;
      this.beams.push(m);
      this.group.add(m);
    }
    g.entrances.forEach((q, i) => {
      const p = g.hexCenter(q);
      this.beams[i].position.set(p.x, 0, p.y);
      // no daylight down a plugged or fallen-in hole
      this.beams[i].visible = !this.terrain.isShut(q);
    });
    for (let i = g.entrances.length; i < this.beams.length; i++) this.beams[i].visible = false;
    // cool daylight by day, a faint blue moonlight at night
    const night = Math.max(0, Math.min(1, w.s.night));
    this.beamMat.uniforms.uCol.value.setRGB(0.92 - night * 0.6, 0.95 - night * 0.55, 1.0 - night * 0.35);
    // Tile contents change slowly: rebuild a few times a second or when tiles change.
    const day = w.s.night < 0.5;
    const key = `${c.tileVersion}|${Math.round(c.food)}|${Math.round(c.fungus)}|${day}|${c.tiles.reduce((s, t) => s + (t.type === 'carton' ? Math.round(t.hp ?? 0) : 0), 0)}|${g.tunnels.length}`;
    if (key === this.lastKey && this.tick % 20 !== 0) return;
    this.lastKey = key;
    for (const pool of [this.crumbs, this.seeds, this.fungus, this.aphids, this.needles, this.clods, this.sunBrood]) pool.begin();
    const foods = c.tiles.filter((t) => t.type === 'food');
    const fill = Math.min(1, c.food / Math.max(1, c.foodCap));
    // Food tiles fill one after another (first tiles full before later ones start).
    const per = fill * foods.length;
    foods.forEach((t, i) => {
      const f = Math.max(0, Math.min(1, per - i));
      const rng = new Rng(t.q * 977 + 3);
      const n = Math.round(f * 26);
      for (let k = 0; k < n; k++) {
        const pool = rng.chance(0.45) ? this.seeds : this.crumbs;
        const col = [0x5a3a24, 0x8a6a40, 0x3a2a1c, 0x6a5030, 0x8a7a50][k % 5];
        this.pile(g, t.q, rng, k, n, pool, rng.range(0.9, 2.0) * (g.R / 7), col);
      }
    });
    const gardens = c.tiles.filter((t) => t.type === 'fungus');
    const ff = Math.min(1, c.fungus / Math.max(1, c.fungusCap));
    for (const t of gardens) {
      const rng = new Rng(t.q * 131 + 7);
      const n = Math.round(4 + ff * 10);
      for (let k = 0; k < n; k++) this.pile(g, t.q, rng, k, n, this.fungus, rng.range(2.4, 4.5) * (g.R / 7), 0xffffff);
    }
    for (const t of c.tiles.filter((x) => x.type === 'aphid')) {
      const rng = new Rng(t.q * 53 + 1);
      for (let k = 0; k < 14; k++) this.pile(g, t.q, rng, k, 14, this.aphids, rng.range(1.0, 1.7) * (g.R / 7), rng.chance(0.5) ? 0xd8d0b0 : 0xc8c098);
    }
    for (const t of c.tiles.filter((x) => x.type === 'thatch')) {
      const rng = new Rng(t.q * 71 + 5);
      for (let k = 0; k < 40; k++) this.pile(g, t.q, rng, k, 40, this.needles, rng.range(3, 6) * (g.R / 7), rng.chance(0.5) ? 0x6a4a28 : 0x8a6a38);
    }
    for (const t of c.tiles.filter((x) => x.type === 'mound')) {
      const rng = new Rng(t.q * 89 + 11);
      const n = 22 + t.level * 6;
      for (let k = 0; k < n; k++) this.pile(g, t.q, rng, k, n, this.clods, rng.range(1.6, 3.2) * (g.R / 7), [0x8a6640, 0xa88458, 0x6e5034, 0xb89466][k % 4]);
      // by day the workers bring the brood up into the warm mound
      if (day && t.built) for (let k = 0; k < 4 + t.level * 2; k++) this.pile(g, t.q, rng, n + k, n + 8, this.sunBrood, rng.range(1.3, 1.9) * (g.R / 7), rng.chance(0.3) ? 0xfffaf0 : 0xf0e6cc);
    }
    // Termant carton walls: a tall heap of papery wood flakes across the hex (lower as it is chewed down)
    for (const t of c.tiles.filter((x) => x.type === 'carton' && x.built)) {
      const rng = new Rng(t.q * 97 + 13);
      const n = Math.round(14 + 30 * Math.max(0.2, (t.hp ?? 1) / TERMANT.cartonWall.hp));
      for (let k = 0; k < n; k++) this.pile(g, t.q, rng, k, n, this.clods, rng.range(2.6, 4.6) * (g.R / 7), [0x6a4a2a, 0x9a7448, 0x4e3420, 0xb08a58][k % 4]);
    }
    this.tunnelBits(g, c);
    for (const pool of [this.crumbs, this.seeds, this.fungus, this.aphids, this.needles, this.clods, this.sunBrood]) pool.end();
  }

  /**
   * Loose bits along the sides of every entrance tunnel, matching the species' surface entrance: soil
   * pellets everywhere, pine needles fallen in (wood ants), leaf scraps (leafcutters), carton flakes
   * (nasute termites, Termants), pale frass (Gilded Ants), granular worked soil (fire ants).
   */
  private tunnelBits(g: NestGrid, c: Colony): void {
    const sz = g.R / 7;
    const extra: Partial<Record<string, { pool: InstancedPool; cols: number[]; n: number; s: [number, number] }>> = {
      formica: { pool: this.needles, cols: [0x6a4a28, 0x8a6a38, 0x4a3018], n: 9, s: [3, 5.5] },
      atta: { pool: this.crumbs, cols: [0x5a8a30, 0x6a9a3a, 0x7a9a40], n: 6, s: [1.2, 2] },
      nasutitermes: { pool: this.clods, cols: [0x2e2016, 0x3b2a1e, 0x4a3626], n: 8, s: [1.4, 2.4] },
      termant: { pool: this.clods, cols: [0x2e2016, 0x3b2a1e, 0x5a4434], n: 6, s: [1.4, 2.4] },
      aurimyrmex: { pool: this.crumbs, cols: [0xd8c49a, 0xc8b086, 0xe6d6b0], n: 10, s: [0.7, 1.2] },
      solenopsis: { pool: this.clods, cols: [0x8a6640, 0xa88458, 0x6e5034], n: 8, s: [1.0, 1.8] },
    };
    const sp = extra[c.species];
    g.tunnels.forEach((t, ti) => {
      t.forEach((q, k) => {
        const rng = new Rng(q * 131 + ti * 17 + 7);
        const ctr = g.hexCenter(q);
        const put = (pool: InstancedPool, col: number, size: number) => {
          const a = rng.range(0, Math.PI * 2);
          const r = g.R * rng.range(0.45, 0.85); // the sides: the middle is worn smooth
          const x = ctr.x + Math.cos(a) * r;
          const z = ctr.y + Math.sin(a) * r;
          this.p.set(x, this.terrain.heightAt(x, z) + size * 0.25, z);
          this.e.set(rng.range(-0.5, 0.5), rng.range(0, 6.28), rng.range(-0.5, 0.5));
          this.q.setFromEuler(this.e);
          this.s.setScalar(size);
          this.m.compose(this.p, this.q, this.s);
          pool.add(this.m, this.c.setHex(col));
        };
        for (let i = 0; i < 7 - k; i++) put(this.crumbs, [0x3a2a1c, 0x5a4430, 0x4a3828][i % 3], rng.range(0.8, 1.5) * sz);
        if (sp) for (let i = 0; i < sp.n - k * 2; i++) put(sp.pool, sp.cols[i % sp.cols.length], rng.range(sp.s[0], sp.s[1]) * sz);
      });
    });
  }

  /** Items heap toward the tile centre: early items low and central, later ones spread and stack. */
  private pile(g: NestGrid, q: number, rng: Rng, i: number, n: number, pool: InstancedPool, size: number, color: number): void {
    const ctr = g.hexCenter(q);
    const t = i / Math.max(1, n);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * g.R * (0.25 + 0.5 * t);
    const x = ctr.x + Math.cos(a) * r;
    const z = ctr.y + Math.sin(a) * r;
    const base = this.terrain.heightAt(x, z);
    const stack = (1 - r / (g.R * 0.75)) * size * 0.6 * Math.min(1, n / 12);
    this.p.set(x, base + size * 0.3 + Math.max(0, stack) * rng.next(), z);
    this.e.set(rng.range(-0.5, 0.5), rng.range(0, 6.28), rng.range(-0.5, 0.5));
    this.q.setFromEuler(this.e);
    this.s.setScalar(size);
    this.m.compose(this.p, this.q, this.s);
    pool.add(this.m, this.c.setHex(color));
  }
}
