import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Terrain } from '../world/terrain';
import { addPatch, globalUniforms, patchDapple } from './shaderPatch';
import type { DecorClump } from './mapDecor';

/**
 * Instanced grass blades. Each blade is a tapered, slightly curved strip.
 * The vertex shader bends blades with world-space wind gusts; the fragment
 * shader dithers away blades between the camera and its focus point so the
 * swarm underneath stays readable.
 */
function bladeGeometry(): THREE.BufferGeometry {
  const seg = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = 0.5 * (1 - Math.pow(t, 1.6)) + 0.02;
    const curve = t * t * 0.25; // forward lean, bent further by wind
    pos.push(-w, t, curve, w, t, curve);
    uv.push(0, t, 1, t);
    // Normals splayed outward for rounded-looking lighting.
    nrm.push(-0.45, 0.25, 0.85, 0.45, 0.25, 0.85);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

const WIND_VERTEX = /* glsl */ `
  {
    // Blade-local wind: rotate world wind into instance space.
    mat3 im = mat3(instanceMatrix);
    vec3 iw = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
    float t = position.y;
    float gust = sin(uTime*1.7 + iw.x*0.012 + iw.z*0.009) * 0.5 + sin(uTime*0.63 + iw.x*0.004) * 0.5;
    float flutter = sin(uTime*7.0 + iw.x*0.3 + iw.z*0.21 + t*3.0) * 0.08;
    float hs = length(im[1]);
    float amt = (0.06 + 0.16*(gust*0.5+0.5) + flutter) * uWindStrength * t * t;
    vec3 worldOff = vec3(normalize(uWind + 1e-5), 0.0).xzy * amt * hs;
    worldOff = vec3(worldOff.x, 0.0, worldOff.z);
    transformed += inverse(im) * worldOff;
    transformed.y -= amt*amt*0.4;
  }
`;

export class Grass {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;

  constructor(terrain: Terrain, density: number, margin = 320, extra: readonly DecorClump[] = []) {
    const rng = new Rng(terrain.params.seed + 555);
    const blades: Array<{ x: number; z: number; h: number; w: number; rot: number; lean: number; c: number; reed?: boolean }> = [];
    const style = terrain.params.style;
    const pushClump = (cx: number, cz: number, s: number, tall: boolean) => {
      const n = Math.round((tall ? 26 : 12) * s * density);
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(rng.next()) * 9 * s;
        const a = rng.range(0, Math.PI * 2);
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const h = (tall ? rng.range(45, 150) : rng.range(16, 46)) * (0.75 + 0.5 * (1 - r / (9 * s + 1)));
        blades.push({ x, z, h, w: tall ? rng.range(2.4, 4.6) : rng.range(0.9, 1.8), rot: a + rng.range(-0.6, 0.6), lean: rng.range(-0.35, 0.35) * (tall ? 1 : 1.6), c: rng.next() });
      }
    };
    for (const p of terrain.props) if (p.kind === 'grassClump') pushClump(p.x, p.y, p.scale, true);
    // an authored map's clumps (render/mapDecor.ts); reeds are tall, narrow and nearly upright
    for (const c of extra) {
      if (c.kind !== 'reed') {
        pushClump(c.x, c.z, c.s, c.kind === 'tall');
        continue;
      }
      const n = Math.round(14 * c.s * density);
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(rng.next()) * 6 * c.s;
        const a = rng.range(0, Math.PI * 2);
        blades.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, h: rng.range(80, 200) * c.s, w: rng.range(1.3, 2.4), rot: a + rng.range(-0.5, 0.5), lean: rng.range(-0.12, 0.12), c: rng.next(), reed: true });
      }
    }
    if (style !== 'formicarium') {
      // Short sprouts on mossy ground inside the map.
      const sprouts = Math.round(((terrain.width * terrain.depth) / 1e4) * 14 * density);
      for (let i = 0; i < sprouts; i++) {
        const x = rng.range(0, terrain.width);
        const z = rng.range(0, terrain.depth);
        const ci = Math.round(x / terrain.res);
        const cj = Math.round(z / terrain.res);
        if (terrain.cover[cj * terrain.nx + ci] !== 1) continue;
        if (terrain.isWater(x, z)) continue;
        // not through an authored map's rocks or stepping stones
        if (terrain.map && (terrain.isBlocked(x, z) || terrain.walkHeight(x, z) - terrain.heightAt(x, z) > 0.3)) continue;
        pushClump(x, z, rng.range(0.4, 0.9), false);
      }
      // Dense meadow beyond the edges (skirt).
      const W = terrain.width;
      const D = terrain.depth;
      const ringCount = Math.round((((W + D) * 2 * margin) / 1e4) * 5 * density);
      for (let i = 0; i < ringCount; i++) {
        let x = rng.range(-margin, W + margin);
        let z = rng.range(-margin, D + margin);
        if (x > 0 && x < W && z > 0 && z < D) {
          // push outward
          if (rng.chance(0.5)) x = x < W / 2 ? -rng.range(0, margin) : W + rng.range(0, margin);
          else z = z < D / 2 ? -rng.range(0, margin) : D + rng.range(0, margin);
        }
        pushClump(x, z, rng.range(0.8, 1.6), true);
      }
    }
    const geo = bladeGeometry();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.4,
    });
    patchDapple(this.material);
    addPatch(this.material, {
      key: 'grass',
      uniforms: {
        uWind: globalUniforms.uWind,
        uWindStrength: globalUniforms.uWindStrength,
        uFocus: globalUniforms.uFocus,
        uCamPos: globalUniforms.uCamPos,
        uSeeThrough: globalUniforms.uSeeThrough,
      },
      vertexHeader: 'uniform vec2 uWind; uniform float uWindStrength; uniform float uTime; varying float vH;',
      vertex: [['#include <begin_vertex>', '#include <begin_vertex>\n vH = position.y;\n' + WIND_VERTEX]],
      fragmentHeader: 'uniform vec3 uFocus; uniform vec3 uCamPos; uniform float uSeeThrough; varying float vH;',
      fragment: [
        [
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
           if (uSeeThrough > 0.5) {
             vec3 seg = uFocus - uCamPos; float L = length(seg); vec3 sd = seg / L;
             float tt = clamp(dot(vWP - uCamPos, sd), 0.0, L);
             float dline = length(uCamPos + sd*tt - vWP);
             float rad = 26.0 + L*0.12;
             // 4x4 ordered (Bayer) dither: cleaner than random noise without TAA.
             ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
             int bi = bp.x + bp.y * 4;
             float bayer[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0);
             float dither = (bayer[bi] + 0.5) / 16.0;
             float fade = smoothstep(rad*0.75, rad, dline);
             if (vWP.y - uFocus.y > 6.0 && dither > fade && tt < L - 4.0) discard;
           }`,
        ],
        [
          '#include <color_fragment>',
          `#include <color_fragment>
           diffuseColor.rgb *= mix(0.42, 1.12, smoothstep(0.0, 0.7, vH));
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.25,1.12,0.7), smoothstep(0.75,1.0,vH)*0.6);`,
        ],
      ],
    });
    const mesh = new THREE.InstancedMesh(geo, this.material, Math.max(1, blades.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const greens = [new THREE.Color(0x4f7a2a), new THREE.Color(0x6b8f34), new THREE.Color(0x3d6626), new THREE.Color(0x8a9a44), new THREE.Color(0xa49a5a)];
    const reeds = [new THREE.Color(0x3f6a34), new THREE.Color(0x547a3a), new THREE.Color(0x35583a), new THREE.Color(0x6e7d48)];
    blades.forEach((b, i) => {
      const inside = b.x >= 0 && b.z >= 0 && b.x <= terrain.width && b.z <= terrain.depth;
      const y = inside ? terrain.heightAt(b.x, b.z) : terrain.heightAt(Math.min(Math.max(b.x, 0), terrain.width), Math.min(Math.max(b.z, 0), terrain.depth));
      p.set(b.x, y - 1, b.z);
      e.set(b.lean, b.rot, rng.range(-0.15, 0.15), 'YXZ');
      q.setFromEuler(e);
      s.set(b.w, b.h, b.w);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      const pal = b.reed ? reeds : greens;
      const gi = Math.floor(b.c * pal.length);
      col.copy(pal[gi]).lerp(pal[(gi + 1) % pal.length], rng.next() * 0.5);
      col.multiplyScalar(0.85 + rng.next() * 0.3);
      mesh.setColorAt(i, col);
    });
    mesh.count = blades.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'grass';
    this.mesh = mesh;
  }
}
