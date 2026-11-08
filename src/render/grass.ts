import * as THREE from 'three';
import { thinLightPatch } from './ground/surfacePatch';
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

/**
 * Performance v3: the blades are drawn in square chunks, each its own instanced mesh with a bounding sphere (padded for
 * the lean and the wind), so the renderer culls the chunks out of view instead of shading every blade of the map and its
 * meadow skirt each frame — the same blades with the same data where they are seen (an opaque, depth-tested pass: the
 * draw order between chunks changes nothing drawn).
 */
const CHUNKS_ACROSS = 5;

export class Grass {
  /** the chunks ('grass' group; each child one chunk's instanced mesh) */
  mesh: THREE.Group;
  material: THREE.MeshStandardMaterial;

  constructor(terrain: Terrain, density: number, margin = 320, extra: readonly DecorClump[] = [], clear: ReadonlyArray<{ x: number; y: number; r: number }> = []) {
    const rng = new Rng(terrain.params.seed + 555);
    const blades: Array<{ x: number; z: number; h: number; w: number; rot: number; lean: number; c: number; reed?: boolean; dry?: boolean }> = [];
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
      if (c.kind === 'dry') {
        // savanna: tall pale bunch grass
        const from = blades.length;
        pushClump(c.x, c.z, c.s, true);
        for (let i = from; i < blades.length; i++) blades[i].dry = true;
        continue;
      }
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
        const from = blades.length;
        pushClump(x, z, rng.range(0.8, 1.6), true);
        if (terrain.map?.biome === 'savanna') for (let k = from; k < blades.length; k++) blades[k].dry = true;
        else if ((terrain.map?.biome === 'forest' || terrain.map?.biome === 'rainforest') && rng.chance(0.75)) blades.length = from;
      }
    }
    // (no grass growing through the anthills)
    if (clear.length) {
      const keep = blades.filter((b) => !clear.some((c) => (b.x - c.x) ** 2 + (b.z - c.y) ** 2 < c.r * c.r));
      blades.length = 0;
      blades.push(...keep);
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
             // dissolve upward (dithered over 4–16 mm) rather than a flat cut, so no blade ends in a sawn-off stub
             float hcut = smoothstep(4.0, 16.0, vWP.y - uFocus.y) * (1.0 - fade);
             if (dither < hcut && tt < L - 4.0) discard;
           }`,
        ],
        [
          '#include <color_fragment>',
          `#include <color_fragment>
           diffuseColor.rgb *= mix(0.42, 1.12, smoothstep(0.0, 0.7, vH));
           diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.18,1.08,0.78), smoothstep(0.75,1.0,vH)*0.5);`,
        ],
      ],
    });
    // light through the blades when the sun is behind them
    thinLightPatch(this.material, 0.38);
    // every blade's matrix and colour, in the order they were made (the same random draws as before)
    const mats = new Float32Array(Math.max(1, blades.length) * 16);
    const cols = new Float32Array(Math.max(1, blades.length) * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    // meadow grass: muted olive and blue-greens with the odd dry blade (real blades are far less saturated than paint)
    const greens = [new THREE.Color(0x4a6c2e), new THREE.Color(0x5e7c38), new THREE.Color(0x3c5c2c), new THREE.Color(0x76823f), new THREE.Color(0x938c5c)];
    const reeds = [new THREE.Color(0x3f6a34), new THREE.Color(0x547a3a), new THREE.Color(0x35583a), new THREE.Color(0x6e7d48)];
    const dry = [new THREE.Color(0xb59a5a), new THREE.Color(0xc8ad6a), new THREE.Color(0x9c8650), new THREE.Color(0xa59a62), new THREE.Color(0x8a8a50)];
    blades.forEach((b, i) => {
      const inside = b.x >= 0 && b.z >= 0 && b.x <= terrain.width && b.z <= terrain.depth;
      const y = inside ? terrain.heightAt(b.x, b.z) : terrain.heightAt(Math.min(Math.max(b.x, 0), terrain.width), Math.min(Math.max(b.z, 0), terrain.depth));
      p.set(b.x, y - 1, b.z);
      e.set(b.lean, b.rot, rng.range(-0.15, 0.15), 'YXZ');
      q.setFromEuler(e);
      s.set(b.w, b.h, b.w);
      m.compose(p, q, s);
      m.toArray(mats, i * 16);
      const pal = b.reed ? reeds : b.dry ? dry : greens;
      const gi = Math.floor(b.c * pal.length);
      col.copy(pal[gi]).lerp(pal[(gi + 1) % pal.length], rng.next() * 0.5);
      col.multiplyScalar(0.85 + rng.next() * 0.3);
      col.toArray(cols, i * 3);
    });
    // the chunks: blades binned by where they stand (each chunk keeps them in their order)
    const group = new THREE.Group();
    group.name = 'grass';
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const b of blades) {
      x0 = Math.min(x0, b.x);
      z0 = Math.min(z0, b.z);
      x1 = Math.max(x1, b.x);
      z1 = Math.max(z1, b.z);
    }
    const size = Math.max(1, Math.max(x1 - x0, z1 - z0) / CHUNKS_ACROSS);
    const nx = Math.max(1, Math.ceil((x1 - x0) / size + 1e-9));
    const bins = new Map<number, number[]>();
    blades.forEach((b, i) => {
      const cx = Math.min(nx - 1, Math.floor((b.x - x0) / size));
      const cz = Math.floor((b.z - z0) / size);
      const k = cz * nx + cx;
      let l = bins.get(k);
      if (!l) bins.set(k, (l = []));
      l.push(i);
    });
    const keys = [...bins.keys()].sort((a, b) => a - b);
    for (const k of keys) {
      const idx = bins.get(k)!;
      const mesh = new THREE.InstancedMesh(geo, this.material, idx.length);
      const im = mesh.instanceMatrix.array as Float32Array;
      const colArr = new Float32Array(idx.length * 3);
      // the bounding sphere: the blades' bases, out by each blade's height (its lean and the wind's sway stay within it)
      let cx = 0;
      let cz = 0;
      let cy = 0;
      for (const i of idx) {
        cx += mats[i * 16 + 12];
        cy += mats[i * 16 + 13];
        cz += mats[i * 16 + 14];
      }
      cx /= idx.length;
      cy /= idx.length;
      cz /= idx.length;
      let r = 0;
      idx.forEach((i, j) => {
        im.set(mats.subarray(i * 16, i * 16 + 16), j * 16);
        colArr.set(cols.subarray(i * 3, i * 3 + 3), j * 3);
        const d = Math.hypot(mats[i * 16 + 12] - cx, mats[i * 16 + 13] - cy, mats[i * 16 + 14] - cz);
        r = Math.max(r, d + blades[i].h * 1.6 + blades[i].w * 2);
      });
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
      mesh.count = idx.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = 'grass';
      group.add(mesh);
    }
    this.mesh = group;
  }

  /** Free the chunks' instance buffers and the shared blade geometry. */
  dispose(): void {
    let geo: THREE.BufferGeometry | null = null;
    for (const c of this.mesh.children) {
      const im = c as THREE.InstancedMesh;
      geo = im.geometry;
      im.dispose();
    }
    geo?.dispose();
  }
}
