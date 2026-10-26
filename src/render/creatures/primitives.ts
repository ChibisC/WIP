import * as THREE from 'three';
import { addPatch, patchDapple } from '../shaderPatch';

/**
 * Instanced primitives for creatures (Phase 11). Every creature is built
 * each frame from a few shared shapes — ellipsoids for body segments, heads
 * and eyes, tapered tubes for legs, antennae and jaws, cones for fangs and
 * claws — each instance with its own transform, colour and surface. So the
 * whole bestiary draws in a handful of calls however many creatures are out.
 *
 * Surface per instance (`aMat`): x roughness, y gloss (clearcoat-like
 * highlight), z pattern, w pattern scale. Patterns, in the shape's own
 * coordinates:
 *   0 plain · 1 rings (segment bands) · 2 hair (fuzz, rim sheen) ·
 *   3 striae (elytra grooves) · 4 speckle · 5 veins (mantis wings) ·
 *   6 rear band (Scolopendra tergites) · 7 pit (darker toward the centre,
 *   with sand ripples: the antlion's funnel).
 */

export type Prim = 'ell' | 'tube' | 'cone';

export interface Surface {
  rough: number;
  gloss: number;
  pattern: number;
  scale: number;
}

export const PLAIN: Surface = { rough: 0.6, gloss: 0.2, pattern: 0, scale: 1 };

const MAX_START = 1024;

class Pool {
  mesh: THREE.InstancedMesh;
  mat: THREE.InstancedBufferAttribute;
  n = 0;
  cap: number;

  constructor(
    private geo: THREE.BufferGeometry,
    private material: THREE.Material,
    private depth: THREE.Material,
    cap = MAX_START,
  ) {
    this.cap = cap;
    this.mesh = this.make(cap);
    this.mat = this.mesh.geometry.getAttribute('aMat') as THREE.InstancedBufferAttribute;
  }

  private make(cap: number): THREE.InstancedMesh {
    const g = this.geo.clone();
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aMat', attr);
    const m = new THREE.InstancedMesh(g, this.material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.customDepthMaterial = this.depth;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }

  /** Grow (keeping the group membership) when a frame needs more instances. */
  ensure(n: number, group: THREE.Group): void {
    if (n <= this.cap) return;
    let cap = this.cap;
    while (cap < n) cap *= 2;
    group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.cap = cap;
    this.mesh = this.make(cap);
    this.mat = this.mesh.geometry.getAttribute('aMat') as THREE.InstancedBufferAttribute;
    group.add(this.mesh);
  }
}

const patternGLSL = /* glsl */ `
varying vec4 vMat;
varying vec3 vLocal;
varying vec3 vPitDir;
float crHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float crNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(crHash(i), crHash(i + vec3(1,0,0)), f.x), mix(crHash(i + vec3(0,1,0)), crHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(crHash(i + vec3(0,0,1)), crHash(i + vec3(1,0,1)), f.x), mix(crHash(i + vec3(0,1,1)), crHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

function creatureMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0 });
  addPatch(m, {
    key: 'creature',
    vertexHeader: /* glsl */ `attribute vec4 aMat;\nvarying vec4 vMat;\nvarying vec3 vLocal;\nvarying vec3 vPitDir;`,
    vertex: [
      [
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vMat = aMat;
        vLocal = position;
        // outward direction across the shape's base plane (view space): the pit pattern slopes its normal against it
        vPitDir = (modelViewMatrix * instanceMatrix * vec4(position.x, 0.0, position.z, 0.0)).xyz;`,
      ],
    ],
    fragmentHeader: patternGLSL,
    fragment: [
      [
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          int pat = int(vMat.z + 0.5);
          float s = vMat.w;
          if (pat == 1) { // segment rings
            float r = abs(fract(vLocal.x * s * 0.5 + 0.5) - 0.5) * 2.0;
            diffuseColor.rgb *= mix(0.62, 1.05, smoothstep(0.08, 0.35, r));
          } else if (pat == 2) { // hair: fine noise
            float n = crNoise(vLocal * 38.0 * s);
            diffuseColor.rgb *= 0.78 + 0.4 * n;
          } else if (pat == 3) { // elytra striae
            float st = abs(sin(vLocal.z * 9.0 * s));
            diffuseColor.rgb *= mix(0.72, 1.04, smoothstep(0.1, 0.6, st));
          } else if (pat == 4) { // speckle
            float n = crNoise(vLocal * 14.0 * s);
            diffuseColor.rgb *= mix(0.65, 1.12, smoothstep(0.35, 0.7, n));
          } else if (pat == 5) { // wing veins
            float v = min(abs(fract(vLocal.x * 7.0 * s) - 0.5), abs(fract((vLocal.x * 0.4 + vLocal.z) * 9.0 * s) - 0.5));
            diffuseColor.rgb *= mix(0.78, 1.05, smoothstep(0.02, 0.08, v));
          } else if (pat == 6) { // dark rear band on each tergite (Scolopendra)
            diffuseColor.rgb *= mix(1.0, 0.25, smoothstep(0.35, 0.75, -vLocal.x));
          } else if (pat == 7) { // funnel: dark in the middle, rippled sand
            float r = length(vLocal.xz);
            float rip = 0.5 + 0.5 * sin(r * 26.0 * s + crNoise(vLocal * 9.0) * 3.0);
            diffuseColor.rgb *= mix(0.42, 1.0, smoothstep(0.0, 0.95, r)) * (0.9 + 0.12 * rip);
          }
        }`,
      ],
      [
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        if (int(vMat.z + 0.5) == 7) {
          // a flat disc lit like a funnel: the normal leans toward the centre
          float pr = length(vLocal.xz);
          float lean = smoothstep(0.04, 0.3, pr) * (1.0 - smoothstep(0.8, 1.0, pr)) * 1.3;
          normal = normalize(normal - normalize(vPitDir + 1e-6) * lean);
        }`,
      ],
      [
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = vMat.x;
        if (int(vMat.z + 0.5) == 2) roughnessFactor = min(1.0, roughnessFactor + 0.25 * crNoise(vLocal * 60.0));
        // elytra striae: the grooves are matt, the ridges between them lacquered
        if (int(vMat.z + 0.5) == 3) roughnessFactor = mix(0.75, roughnessFactor, smoothstep(0.1, 0.6, abs(sin(vLocal.z * 9.0 * vMat.w))));`,
      ],
      [
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        {
          // gloss: a sharp extra highlight (chitin lacquer); hair: a soft rim sheen
          vec3 V = normalize(vViewPosition);
          float rim = pow(1.0 - abs(dot(normal, V)), 3.0);
          reflectedLight.directSpecular *= 1.0 + vMat.y * 2.5;
          if (int(vMat.z + 0.5) == 2) reflectedLight.indirectDiffuse += diffuseColor.rgb * rim * 0.35;
        }`,
      ],
    ],
  });
  patchDapple(m);
  return m;
}

function depthMaterial(): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
}

const tmpC = new THREE.Color();

/** A set of primitive pools in one scene group. */
export class PrimitiveBatch {
  readonly group = new THREE.Group();
  private pools: Record<Prim, Pool>;
  /** instances written this frame (debug) */
  count = 0;

  constructor() {
    const mat = creatureMaterial();
    const depth = depthMaterial();
    const ell = new THREE.SphereGeometry(1, 16, 12);
    // tube along +Y from 0 to 1, tapering a little toward the tip
    const tube = new THREE.CylinderGeometry(0.8, 1, 1, 9, 1, false);
    tube.translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(1, 1, 8, 1);
    cone.translate(0, 0.5, 0);
    this.pools = { ell: new Pool(ell, mat, depth), tube: new Pool(tube, mat, depth), cone: new Pool(cone, mat, depth) };
    for (const p of Object.values(this.pools)) this.group.add(p.mesh);
  }

  begin(): void {
    for (const p of Object.values(this.pools)) p.n = 0;
    this.count = 0;
  }

  add(prim: Prim, m: THREE.Matrix4, color: THREE.ColorRepresentation | THREE.Color, surf: Surface): void {
    const p = this.pools[prim];
    if (p.n >= p.cap) p.ensure(p.n + 1, this.group);
    const i = p.n++;
    p.mesh.setMatrixAt(i, m);
    p.mesh.setColorAt(i, color instanceof THREE.Color ? color : tmpC.set(color));
    const a = p.mat.array as Float32Array;
    a[i * 4] = surf.rough;
    a[i * 4 + 1] = surf.gloss;
    a[i * 4 + 2] = surf.pattern;
    a[i * 4 + 3] = surf.scale;
    this.count++;
  }

  end(): void {
    for (const p of Object.values(this.pools)) {
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      p.mat.needsUpdate = true;
    }
  }
}
