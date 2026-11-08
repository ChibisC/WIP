import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { addPatch, globalUniforms, patchDapple } from './shaderPatch';
import { textures } from './textures';

/**
 * Water surface (puddles, sandbox water, floods). A grid following the
 * terrain water field; vertices without water sink below the ground.
 * Reflections come from a cube snapshot of the surroundings.
 */
export class Water {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  private geo: THREE.BufferGeometry;
  private step = 4;
  private nx: number;
  private ny: number;
  private builtVersion = -1;
  /**
   * Performance v3: the grid's rows in bands, each band's bounds (rebuilt with the heights). Each render draws only the
   * index range from the first band its camera sees to the last — a contiguous part of the same index, in the same order
   * (it is transparent: the order of its triangles matters, and stays) — instead of every row of the map.
   */
  private bands: THREE.Box3[] = [];
  private static readonly BAND_ROWS = 12;

  constructor(private terrain: Terrain) {
    this.nx = Math.ceil(terrain.width / this.step) + 1;
    this.ny = Math.ceil(terrain.depth / this.step) + 1;
    const n = this.nx * this.ny;
    const pos = new Float32Array(n * 3);
    const depth = new Float32Array(n);
    const idx: number[] = [];
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        pos[k * 3] = Math.min(i * this.step, terrain.width);
        pos[k * 3 + 2] = Math.min(j * this.step, terrain.depth);
      }
    for (let j = 0; j < this.ny - 1; j++)
      for (let i = 0; i < this.nx - 1; i++) {
        const a = j * this.nx + i;
        idx.push(a, a + this.nx, a + 1, a + 1, a + this.nx, a + this.nx + 1);
      }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('wdepth', new THREE.BufferAttribute(depth, 1));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    this.geo.setIndex(idx);
    const tex = textures();
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x2a3a34,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.82,
      envMapIntensity: 1.25,
      ior: 1.33,
      specularIntensity: 1,
      normalMap: tex.sand.normal,
      normalScale: new THREE.Vector2(0.08, 0.08),
    });
    patchDapple(this.material);
    addPatch(this.material, {
      key: 'water',
      uniforms: { tNoise: { value: tex.noise } },
      vertexHeader: 'attribute float wdepth; varying float vDepth;',
      vertex: [['#include <begin_vertex>', '#include <begin_vertex>\n vDepth = wdepth;']],
      fragmentHeader: 'varying float vDepth; uniform sampler2D tNoise;',
      fragment: [
        [
          '#include <normal_fragment_maps>',
          `vec2 wuv = vWP.xz / 60.0;
           vec3 n1 = texture2D(tNoise, wuv + vec2(uTime*0.02, uTime*0.013)).rgb;
           vec3 n2 = texture2D(tNoise, wuv*1.7 - vec2(uTime*0.017, -uTime*0.021)).rgb;
           vec3 mapN = normalize(vec3((n1.r + n2.g - 1.0)*0.18, (n1.g + n2.r - 1.0)*0.18, 1.0));
           normal = normalize( tbn * mapN );`,
        ],
        [
          '#include <color_fragment>',
          `#include <color_fragment>
           // murky water (ground realism item 4): light absorbed and scattered with depth — the shallows show the bed
           // through a thin brown-green tint, deeper water is dark and nearly opaque
           float dep = max(vDepth, 0.0);
           vec3 Tr = exp(-vec3(0.36, 0.27, 0.22) * dep);
           float op = 1.0 - dot(Tr, vec3(0.3333));
           diffuseColor.a *= clamp(op * 1.2, 0.0, 1.0) * smoothstep(0.0, 0.3, dep);
           diffuseColor.rgb *= mix(1.3, 0.82, smoothstep(0.5, 5.0, dep));
           // the edge: a broken line of foam and scum where the water meets the shore, drifting a little
           float edge = smoothstep(0.02, 0.1, dep) * (1.0 - smoothstep(0.12, 0.55, dep));
           float fn1 = texture2D(tNoise, vWP.xz / 40.0 + vec2(uTime * 0.002, uTime * 0.0013)).r;
           float fn2 = texture2D(tNoise, vWP.xz / 20.0 - vec2(uTime * 0.004, -uTime * 0.003)).b;
           float foam = edge * smoothstep(0.62, 0.8, fn1 * 0.5 + fn2 * 0.6);
           float bub = edge * step(0.975, texture2D(tNoise, vWP.xz / 70.0 + vec2(uTime * 0.001, 0.0)).a) * 0.8;
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.72, 0.66), max(foam * 0.7, bub));
           diffuseColor.a = max(diffuseColor.a, max(foam * 0.7, bub));
           // floating specks: grit, seeds, bits of plant (no leaves), thicker toward the shore
           float speck = step(0.982, texture2D(tNoise, vWP.xz / 85.0 + 0.5).a) * (1.0 - smoothstep(0.5, 5.0, dep));
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.13, 0.09), speck * 0.8);
           diffuseColor.a = max(diffuseColor.a, speck * 0.8);`,
        ],
        ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.75, max(foam, speck));'],
      ],
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.name = 'water';
    this.mesh.receiveShadow = true;
    const frustum = new THREE.Frustum();
    const pm = new THREE.Matrix4();
    const full = idx.length;
    const perRow = (this.nx - 1) * 6;
    this.mesh.onBeforeRender = (_r, _s, camera, geometry) => {
      const bands = this.bands;
      if (!bands.length) return geometry.setDrawRange(0, full);
      pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pm);
      let first = -1;
      let last = -1;
      for (let b = 0; b < bands.length; b++)
        if (frustum.intersectsBox(bands[b])) {
          if (first < 0) first = b;
          last = b;
        }
      if (first < 0) return geometry.setDrawRange(0, 0);
      const R = Water.BAND_ROWS;
      const r0 = first * R;
      const r1 = Math.min(this.ny - 1, (last + 1) * R);
      geometry.setDrawRange(r0 * perRow, (r1 - r0) * perRow);
    };
    this.rebuild();
    void globalUniforms;
  }

  rebuild(): void {
    if (this.builtVersion === this.terrain.waterVersion + this.terrain.version * 1000) return;
    this.builtVersion = this.terrain.waterVersion + this.terrain.version * 1000;
    const t = this.terrain;
    const pos = this.geo.attributes.position.array as Float32Array;
    const dep = this.geo.attributes.wdepth.array as Float32Array;
    let any = false;
    for (let k = 0; k < this.nx * this.ny; k++) {
      const x = pos[k * 3];
      const z = pos[k * 3 + 2];
      // Dilate the water level a little so the flat plane runs under the shore
      // and the terrain depth-clips it along a smooth natural contour.
      let w = -9999;
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const v = t.waterAt(x + dx * this.step, z + dz * this.step);
          if (v > w) w = v;
        }
      const g = t.heightAt(x, z);
      if (w > -9000 && w > g - 3) {
        pos[k * 3 + 1] = w;
        dep[k] = w - g;
        if (w > g) any = true;
      } else {
        // Sink dry vertices; neighbours with water make a sloped shoreline under ground.
        pos[k * 3 + 1] = g - 1.5;
        dep[k] = 0;
      }
    }
    this.mesh.visible = any;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.wdepth.needsUpdate = true;
    this.geo.computeBoundingSphere();
    // each band of rows: the box round its vertices (the rows it draws and the row below them)
    const R = Water.BAND_ROWS;
    const bands: THREE.Box3[] = [];
    const v = new THREE.Vector3();
    for (let r0 = 0; r0 < this.ny - 1; r0 += R) {
      const box = new THREE.Box3();
      const r1 = Math.min(this.ny - 1, r0 + R);
      for (let j = r0; j <= r1; j++)
        for (let i = 0; i < this.nx; i++) {
          const k = j * this.nx + i;
          box.expandByPoint(v.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]));
        }
      bands.push(box);
    }
    this.bands = bands;
  }
}
