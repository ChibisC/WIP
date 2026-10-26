import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { fbm2 } from '../core/rng';
import { addPatch, patchDapple, NOISE_GLSL } from './shaderPatch';
import { textures } from './textures';

/** Size of one texture tile in mm. */
const TILE = 70;

/**
 * Terrain mesh: heightfield over the playable area plus a decorative skirt
 * beyond the edges so the horizon reads as continuous ground.
 */
export class TerrainMesh {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  private geo: THREE.BufferGeometry;
  private step = 4;
  readonly margin: number;
  private nx: number;
  private ny: number;
  private builtVersion = -1;
  overlayUniforms = {
    uPhero: { value: null as THREE.Texture | null },
    uPheroOn: { value: 0 },
    uPheroColor: { value: new THREE.Color(0.55, 0.9, 1.0) },
    uMapSize: { value: new THREE.Vector2(1, 1) },
    uDesign: { value: null as THREE.Texture | null },
  };

  constructor(private terrain: Terrain, margin = 320) {
    this.margin = margin;
    const W = terrain.width + margin * 2;
    const D = terrain.depth + margin * 2;
    this.nx = Math.ceil(W / this.step) + 1;
    this.ny = Math.ceil(D / this.step) + 1;
    const n = this.nx * this.ny;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const cover = new Float32Array(n * 4);
    const idx: number[] = [];
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const x = -margin + i * this.step;
        const z = -margin + j * this.step;
        const k = j * this.nx + i;
        pos[k * 3] = x;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / TILE;
        uv[k * 2 + 1] = z / TILE;
      }
    for (let j = 0; j < this.ny - 1; j++)
      for (let i = 0; i < this.nx - 1; i++) {
        const a = j * this.nx + i;
        const b = a + 1;
        const c = a + this.nx;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('cover', new THREE.BufferAttribute(cover, 4));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setIndex(idx);
    this.geo = geo;

    const tex = textures();
    this.material = new THREE.MeshStandardMaterial({
      map: tex.soil.map,
      normalMap: tex.soil.normal,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.35,
    });
    this.overlayUniforms.uMapSize.value.set(terrain.width, terrain.depth);
    patchDapple(this.material);
    addPatch(this.material, {
      key: 'terrainSplat',
      uniforms: {
        tSoil: { value: tex.soil.map },
        tMoss: { value: tex.moss.map },
        tSand: { value: tex.sand.map },
        tLitter: { value: tex.litter.map },
        nSoil: { value: tex.soil.normal },
        nMoss: { value: tex.moss.normal },
        nSand: { value: tex.sand.normal },
        nLitter: { value: tex.litter.normal },
        tNoise: { value: tex.noise },
        ...this.overlayUniforms,
      },
      vertexHeader: 'attribute vec4 cover; varying vec4 vCover;',
      vertex: [['#include <begin_vertex>', '#include <begin_vertex>\n vCover = cover;']],
      fragmentHeader: `varying vec4 vCover;
        uniform sampler2D tSoil, tMoss, tSand, tLitter, nSoil, nMoss, nSand, nLitter, tNoise, uPhero, uDesign;
        uniform float uPheroOn; uniform vec3 uPheroColor; uniform vec2 uMapSize;
        vec4 sampleAT(sampler2D t, vec2 uv){ return mix(texture2D(t, uv), texture2D(t, uv*0.37+0.31), 0.35); }`,
      fragment: [
        [
          '#include <map_fragment>',
          `vec2 suv = vMapUv;
           vec4 a0 = sampleAT(tSoil, suv), a1 = sampleAT(tMoss, suv), a2 = sampleAT(tSand, suv), a3 = sampleAT(tLitter, suv);
           float nz = texture2D(tNoise, vWP.xz/180.0).r - 0.5;
           vec4 hw = vec4(a0.a, a1.a, a2.a, a3.a) * 0.6 + vCover * 1.6 + vec4(0.0, nz, -nz, nz*0.5) * 0.25;
           float hm = max(max(hw.x, hw.y), max(hw.z, hw.w)) - 0.22;
           vec4 sw = max(hw - hm, 0.0); sw /= max(dot(sw, vec4(1.0)), 1e-4);
           vec3 albedo = a0.rgb*sw.x + a1.rgb*sw.y + a2.rgb*sw.z + a3.rgb*sw.w;
           float macro = texture2D(tNoise, vWP.xz/900.0).g;
           albedo *= 0.82 + macro*0.36;
           diffuseColor.rgb *= albedo;`,
        ],
        [
          '#include <normal_fragment_maps>',
          `vec3 mapN = (texture2D(nSoil, vNormalMapUv).xyz*sw.x + texture2D(nMoss, vNormalMapUv).xyz*sw.y
                      + texture2D(nSand, vNormalMapUv).xyz*sw.z + texture2D(nLitter, vNormalMapUv).xyz*sw.w) * 2.0 - 1.0;
           mapN.xy *= normalScale;
           normal = normalize( tbn * mapN );`,
        ],
        [
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           vec2 puv = vWP.xz / uMapSize;
           if (uPheroOn > 0.5 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) {
             vec4 ph = texture2D(uPhero, puv);
             float trail = smoothstep(0.02, 0.6, ph.r);
             float alarm = smoothstep(0.05, 0.8, ph.g);
             float shimmer = 0.75 + 0.25*sin(uTime*3.0 + vWP.x*0.3 + vWP.z*0.2);
             totalEmissiveRadiance += uPheroColor * trail * 0.9 * shimmer + vec3(1.0,0.25,0.12) * alarm * 0.9;
             totalEmissiveRadiance += vec3(0.95,0.7,0.25) * smoothstep(0.02, 0.5, ph.b) * 0.6;
           }`,
        ],
      ],
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.rebuild();
  }

  /** Heights for the skirt beyond the playable map. */
  private heightOutside(x: number, z: number): number {
    const t = this.terrain;
    const cx = Math.min(Math.max(x, 0), t.width);
    const cz = Math.min(Math.max(z, 0), t.depth);
    const base = t.heightAt(cx, cz);
    const d = Math.hypot(x - cx, z - cz);
    if (d === 0) return base;
    const rise = (fbm2(x / 200, z / 200, 3, 99) - 0.3) * 30;
    const f = Math.min(1, d / 160);
    return base + rise * f + (this.terrain.params.style === 'formicarium' ? -6 * f : 0);
  }

  rebuild(): void {
    if (this.builtVersion === this.terrain.version) return;
    this.builtVersion = this.terrain.version;
    const t = this.terrain;
    const pos = this.geo.attributes.position.array as Float32Array;
    const cover = this.geo.attributes.cover.array as Float32Array;
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        const x = pos[k * 3];
        const z = pos[k * 3 + 2];
        const inside = x >= 0 && z >= 0 && x <= t.width && z <= t.depth;
        pos[k * 3 + 1] = inside ? t.heightAt(x, z) : this.heightOutside(x, z);
        const ci = Math.round(Math.min(Math.max(x, 0), t.width) / t.res);
        const cj = Math.round(Math.min(Math.max(z, 0), t.depth) / t.res);
        const k4 = (cj * t.nx + ci) * 4;
        if (!inside && t.params.style !== 'formicarium' && t.params.style !== 'sandy') {
          cover[k * 4] = 0.25;
          cover[k * 4 + 1] = 0.6;
          cover[k * 4 + 2] = 0;
          cover[k * 4 + 3] = 0.15;
        } else {
          cover[k * 4] = t.coverW[k4] / 255;
          cover[k * 4 + 1] = t.coverW[k4 + 1] / 255;
          cover[k * 4 + 2] = t.coverW[k4 + 2] / 255;
          cover[k * 4 + 3] = t.coverW[k4 + 3] / 255;
        }
      }
    // Soften cover transitions with a small box blur.
    const tmp = new Float32Array(cover);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 1; j < this.ny - 1; j++)
        for (let i = 1; i < this.nx - 1; i++) {
          const k = j * this.nx + i;
          for (let c = 0; c < 4; c++) {
            tmp[k * 4 + c] =
              (cover[k * 4 + c] * 4 +
                cover[(k - 1) * 4 + c] +
                cover[(k + 1) * 4 + c] +
                cover[(k - this.nx) * 4 + c] +
                cover[(k + this.nx) * 4 + c]) /
              8;
          }
        }
      cover.set(tmp);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.cover.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.geo.computeBoundingBox();
  }
}
