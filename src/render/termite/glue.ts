/**
 * Nasute glue VFX + (v2) Sickle-Jaw acid VFX.
 *
 *  - GlueStreams: instanced ribbons of clear-to-pale-amber glue from a nasus tip to a target.
 *      squirt rate   lerp 3 -> 12 Hz with rampFraction
 *      thickness     lerp 0.4 -> 1.0 x reference diameter
 *      at ramp = 1   continuous thread with a wet glow
 *  - createGlueShellMaterial(): glistening strand shell for NON-termite meshes (ants, bosses).
 *    Termites get their shell from TermiteInstances({ glueShell: true }).
 *
 * Visual only: nothing here feeds back into the simulation.
 */
import {
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ACID_COLOR, ACID_HOT_COLOR, GLUE_COLOR } from './castes';
import { NOISE_GLSL } from './shaders';
import { applyPatch, ShaderPatch, termiteTime } from './material';

export interface GlueStreamOptions {
  /** reference diameter in WORLD units (nasus tip diameter x UNITS_PER_MM x visibility exaggeration) */
  diameter: number;
  /** droplet travel speed in world units / s */
  dropletSpeed: number;
  // ---- v2 (defaults reproduce the nasute glue exactly) ----
  /** base colour and the saturated colour reached at full ramp (mixed by ramp x saturate) */
  color: string;
  hotColor: string;
  saturate: number;
  /** squirt pulse rate (Hz) at ramp 0 and 1 */
  rate: [number, number];
  /** the stream turns continuous between these ramp values */
  continuous: [number, number];
  /** sag of the stream as a fraction of its length (at ramp 0) */
  sag: number;
  /** viscous wobble of the jet (fraction of its radius) */
  wobble: number;
}

/** v2: point-blank acid jet of the Sickle-Jaw soldier (clear -> pale amber, thicker/faster/brighter with the ramp) */
export const ACID_STREAM: Partial<GlueStreamOptions> = {
  color: ACID_COLOR,
  hotColor: ACID_HOT_COLOR,
  saturate: 0.65,
  rate: [3, 12], // same pulse rate as the head recoil in HOLD (shader holdRecoil) and the acidStream sound
  continuous: [0.55, 0.95],
  sag: 0.03,
  wobble: 0.45,
  dropletSpeed: 18,
};

export class GlueStreams {
  readonly mesh: Mesh;
  private iStart: InstancedBufferAttribute;
  private iEnd: InstancedBufferAttribute;
  private iParams: InstancedBufferAttribute;
  private geo: InstancedBufferGeometry;

  constructor(readonly capacity: number, opts: Partial<GlueStreamOptions> = {}) {
    const diameter = opts.diameter ?? 0.09;
    const speed = opts.dropletSpeed ?? 45;
    const rate = opts.rate ?? [3, 12];
    const cont = opts.continuous ?? [0.72, 1.0];
    const rings = 32;
    const radial = 6;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        pos.push(i / rings, Math.cos(a), Math.sin(a));
      }
    }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j;
        const b = i * radial + ((j + 1) % radial);
        const c = (i + 1) * radial + j;
        const d = (i + 1) * radial + ((j + 1) % radial);
        idx.push(a, c, b, b, c, d);
      }
    this.geo = new InstancedBufferGeometry();
    this.geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.geo.setIndex(idx);
    this.iStart = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.iEnd = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.iParams = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.geo.setAttribute('iStart', this.iStart);
    this.geo.setAttribute('iEnd', this.iEnd);
    this.geo.setAttribute('iParams', this.iParams);
    this.geo.instanceCount = 0;

    const mat = new ShaderMaterial({
      uniforms: {
        uTime: termiteTime,
        uColor: { value: new Color(opts.color ?? GLUE_COLOR) },
        uHot: { value: new Color(opts.hotColor ?? opts.color ?? GLUE_COLOR) },
        uSat: { value: opts.saturate ?? 0 },
        uRate: { value: rate },
        uCont: { value: cont },
        uSag: { value: opts.sag ?? 0.05 },
        uWobble: { value: opts.wobble ?? 0 },
        uDiameter: { value: diameter },
        uSpeed: { value: speed },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 iStart; attribute vec3 iEnd; attribute vec4 iParams; // ramp, firing, seed, unused
        uniform float uDiameter; uniform float uSag; uniform float uWobble; uniform float uTime;
        varying float vT; varying float vF; varying float vSeed; varying float vLen;
        varying vec3 vN; varying vec3 vView;
        void main() {
          float t = position.x;
          vec3 d = iEnd - iStart; float len = length(d); vec3 dir = d / max(len, 1e-5);
          vec3 upv = abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 e1 = normalize(cross(dir, upv)); vec3 e2 = cross(e1, dir);
          float f = iParams.x;
          float sag = uSag * len * (1.0 - 0.75 * f);
          vec3 c = iStart + d * t - vec3(0.0, sag * 4.0 * t * (1.0 - t), 0.0);
          float r = 0.5 * uDiameter * mix(0.4, 1.0, f) * (1.0 - 0.3 * t) * (0.35 + 0.65 * smoothstep(0.0, 0.05, t));
          if (iParams.y < 0.5) r = 0.0;
          vec3 off = (e1 * position.y + e2 * position.z);
          if (uWobble > 0.0) c += (e1 * sin(t * 19.0 - uTime * 14.0 + iParams.z * 6.0) + e2 * cos(t * 13.0 - uTime * 11.0)) * uWobble * r * sin(3.14159 * t);
          vec4 mv = modelViewMatrix * vec4(c + off * r, 1.0);
          vN = normalize(mat3(modelViewMatrix) * off);
          vView = -mv.xyz;
          vT = t; vF = f; vSeed = iParams.z; vLen = len;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform vec3 uHot; uniform float uSat; uniform vec2 uRate; uniform vec2 uCont; uniform float uSpeed;
        varying float vT; varying float vF; varying float vSeed; varying float vLen;
        varying vec3 vN; varying vec3 vView;
        void main() {
          float rate = mix(uRate.x, uRate.y, vF);
          float travel = vT * vLen / uSpeed;
          float ph = fract((uTime - travel) * rate + vSeed);
          float drop = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.22, 0.42, ph));
          float cont = smoothstep(uCont.x, uCont.y, vF);
          float body = max(drop, cont);
          if (body < 0.03) discard;
          vec3 N = normalize(vN); vec3 V = normalize(vView);
          float fres = pow(1.0 - abs(dot(N, V)), 2.0);
          vec3 cc = mix(uColor, uHot, vF * uSat);
          vec3 col = cc * (0.5 + 0.6 * fres) + vec3(1.0) * pow(fres, 6.0) * 0.9;
          col += cc * smoothstep(0.85, 1.0, vF) * 0.45;
          gl_FragColor = vec4(col, (0.35 + 0.5 * fres) * body);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  get count() {
    return this.geo.instanceCount;
  }
  set count(n: number) {
    this.geo.instanceCount = n;
  }

  /** start/end in world space; rampFraction from the sim; seed in 0..1 keeps streams out of sync */
  set(i: number, start: Vector3, end: Vector3, rampFraction: number, firing: boolean, seed = (i * 0.618) % 1) {
    this.iStart.setXYZ(i, start.x, start.y, start.z);
    this.iEnd.setXYZ(i, end.x, end.y, end.z);
    this.iParams.setXYZW(i, rampFraction, firing ? 1 : 0, seed, 0);
  }

  commit() {
    this.iStart.needsUpdate = true;
    this.iEnd.needsUpdate = true;
    this.iParams.needsUpdate = true;
  }
}

/**
 * Glue shell for ordinary meshes (e.g. ant species). Requires a per-instance float attribute `aGlue`
 * (0..1) on InstancedMeshes, or set material.userData.glue.value for a single Mesh.
 * Render the same geometry a second time with this material.
 * If the ant mesh is skinned/animated, apply the same normal push after the ant's own deformation.
 */
export function createGlueShellMaterial(thickness = 0.04, instanced = true) {
  const mat = new MeshStandardMaterial({ color: new Color(GLUE_COLOR), roughness: 0.06, metalness: 0, transparent: true, depthWrite: false });
  const glue = { value: 1 };
  mat.userData.glue = glue;
  applyPatch(mat, glueShellPatch(thickness, instanced, glue));
  return mat;
}

/** the generic glue-shell patch: add to an ant material clone (after its own deformation patch) */
export function glueShellPatch(thickness = 0.04, instanced = true, glue = { value: 1 }): ShaderPatch {
  return {
    key: 'glueShell',
    uniforms: { uGlueTime: termiteTime, uGlue: glue, uGlueThick: { value: thickness } },
    vertexHeader: `${instanced ? 'attribute float aGlue;' : ''}\nuniform float uGlue; uniform float uGlueThick; varying float vGlue; varying vec3 vObjP;`,
    vertex: [
      [
        '#include <begin_vertex>',
        `#include <begin_vertex>
        { float g_ = ${instanced ? 'aGlue' : 'uGlue'}; vGlue = g_; vObjP = position;
          transformed += objectNormal * uGlueThick * (0.35 + 0.65 * g_); if (g_ < 0.01) transformed = vec3(0.0); }`,
      ],
    ],
    fragmentHeader: `uniform float uGlueTime; varying float vGlue; varying vec3 vObjP;\n${NOISE_GLSL}`,
    fragment: [
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float n1 = tNoise(vObjP * vec3(3.0, 11.0, 3.0) * 4.0 + vec3(0.0, uGlueTime * 0.05, 0.0));
          float n2 = tNoise(vObjP * vec3(9.0, 2.5, 7.0) * 4.0 + 3.1);
          float strands = smoothstep(0.55, 0.78, max(n1, n2));
          float a_ = vGlue * (0.18 + 0.82 * strands) * 0.8;
          if (a_ < 0.02) discard;
          diffuseColor.a = a_;
          totalEmissiveRadiance += diffuseColor.rgb * (0.05 + 0.25 * vGlue * vGlue) * strands;
        }`,
      ],
    ],
  };
}

/** short radial splash for the major's point-blank glue burst (one-shot sprite-free burst of droplets) */
export function glueBurstOffsets(count = 14, seed = 1): Vector3[] {
  const out: Vector3[] = [];
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const e = (rnd() - 0.3) * 1.2;
    out.push(new Vector3(Math.cos(a) * Math.cos(e), Math.sin(e) + 0.2, Math.sin(a) * Math.cos(e)).multiplyScalar(0.4 + rnd() * 0.6));
  }
  return out;
}


// ---------------------------------------------------------------------------
// v2: acid on ordinary meshes (the game's ants, beetles, spiders)
// ---------------------------------------------------------------------------

/**
 * Acid-droplet shell for ordinary meshes (the game's ant materials): glossy beads that grow with the acid level,
 * a thin wet film and fizzing bubbles. Like glueShellPatch(): add it to a CLONE of the ant material, after the ant's
 * own deformation patch, and draw the ant geometry a second time with it. Per-instance float attribute `aAcid`
 * (0..1) on InstancedMeshes, or material.userData.acid.value for a single mesh. Visual only.
 */
export function acidShellPatch(thickness = 0.03, instanced = true, acid = { value: 1 }): ShaderPatch {
  return {
    key: 'acidShell',
    uniforms: { uAcidTime: termiteTime, uAcidLevel: acid, uAcidThick: { value: thickness }, uAcidCol: { value: new Color(ACID_COLOR) }, uAcidHotCol: { value: new Color(ACID_HOT_COLOR) } },
    vertexHeader: `${instanced ? 'attribute float aAcid;' : ''}\nuniform float uAcidLevel; uniform float uAcidThick; varying float vAcid; varying vec3 vAcidP;`,
    vertex: [
      [
        '#include <begin_vertex>',
        `#include <begin_vertex>
        { float a_ = ${instanced ? 'aAcid' : 'uAcidLevel'}; vAcid = a_; vAcidP = position;
          transformed += objectNormal * uAcidThick * (0.3 + 0.3 * a_); if (a_ < 0.01) transformed = vec3(0.0); }`,
      ],
    ],
    fragmentHeader: `uniform float uAcidTime; uniform vec3 uAcidCol; uniform vec3 uAcidHotCol; varying float vAcid; varying vec3 vAcidP;\n${NOISE_GLSL}`,
    fragment: [
      [
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float ac = vAcid;
          vec2 c1 = tCell(vAcidP * 9.0);
          float rad = mix(0.14, 0.42, ac) * (0.6 + 0.4 * c1.y);
          float bead = 1.0 - smoothstep(rad * 0.65, rad, c1.x);
          vec2 c2 = tCell(vAcidP * 26.0 + vec3(0.0, uAcidTime * 0.9, 0.0));
          float blink = step(1.0 - 0.55 * ac, c2.y) * (0.5 + 0.5 * sin(uAcidTime * 23.0 + c2.y * 60.0));
          float spark = (1.0 - smoothstep(0.03, 0.12, c2.x)) * blink;
          float a_ = max(bead * (0.5 + 0.4 * ac), (0.04 + 0.06 * ac) * ac) + spark * 0.55;
          if (a_ < 0.02) discard;
  // glossy domes: bump the normal with the bead height (scale-free: rest units -> view units via derivatives)
  {
    float hgt = bead * sqrt(max(0.0, 1.0 - (c1.x / rad) * (c1.x / rad)));
    vec3 dpdx = dFdx(-vViewPosition); vec3 dpdy = dFdy(-vViewPosition);
    float k = length(dpdx) / max(length(dFdx(vAcidP)), 1e-6) * 0.045;
    float hx = dFdx(hgt) * k; float hy = dFdy(hgt) * k;
    vec3 r1 = cross(dpdy, normal); vec3 r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (hx * r1 + hy * r2);
    normal = normalize(abs(det) * normal - grad);
  }
          vec3 acol = mix(uAcidCol, uAcidHotCol, 0.25 + 0.5 * ac);
          diffuseColor = vec4(acol, a_);
          totalEmissiveRadiance += acol * (0.04 + 0.22 * ac * ac) * bead + vec3(1.0, 0.95, 0.8) * spark * 0.6;
        }`,
      ],
      ['#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = 1.0; material.clearcoatRoughness = 0.04;\n#endif\nmaterial.roughness = 0.05;'],
    ],
  };
}

/** a ready-made acid shell material for ordinary meshes (MeshPhysicalMaterial + acidShellPatch) */
export function createAcidShellMaterial(thickness = 0.03, instanced = true) {
  const mat = new MeshPhysicalMaterial({ color: new Color(ACID_COLOR), roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, depthWrite: false });
  const acid = { value: 1 };
  mat.userData.acid = acid;
  applyPatch(mat, acidShellPatch(thickness, instanced, acid));
  return mat;
}

/**
 * Fizzing bubbles + a faint steam wisp rising off an acid-covered target. Fully procedural (shader-driven, no CPU
 * particle simulation): each emitter = a world position, a radius (about a quarter of the target's half-length:
 * ~0.5 mm for a 4 mm ant), an intensity 0..1
 * (drive it from the acid ramp) and a seed. Visual only.
 */
export class AcidFizz {
  readonly mesh: Mesh;
  private iPos: InstancedBufferAttribute;
  private iParams: InstancedBufferAttribute;
  private geo: InstancedBufferGeometry;

  constructor(readonly capacity: number, opts: { bubbles?: number; wisps?: number } = {}) {
    const nb = opts.bubbles ?? 14;
    const nw = opts.wisps ?? 4;
    const pos: number[] = [];
    const pid: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < nb + nw; j++) {
      const b = pos.length / 3;
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(x, y, 0);
        pid.push(j, j < nb ? 0 : 1);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    this.geo = new InstancedBufferGeometry();
    this.geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('pid', new Float32BufferAttribute(pid, 2));
    this.geo.setIndex(idx);
    this.iPos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.iParams = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iParams', this.iParams);
    this.geo.instanceCount = 0;
    const mat = new ShaderMaterial({
      uniforms: { uTime: termiteTime, uColor: { value: new Color(ACID_COLOR) } },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec2 pid; attribute vec3 iPos; attribute vec4 iParams; // radius, intensity, seed, unused
        uniform float uTime;
        varying vec2 vUv; varying float vKind; varying float vA; varying float vSeed;
        float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
        void main() {
          float j = pid.x; float kind = pid.y; float R = iParams.x; float I = iParams.y; float sd = iParams.z * 17.0;
          vec3 c = iPos; float size; float a;
          if (kind < 0.5) { // bubble: appears on the surface, swells, pops
            float life = 0.45 + 0.4 * h1(j + sd);
            float ph = fract(uTime / life + h1(j * 3.1 + sd));
            float th = h1(j * 5.7 + sd + floor(uTime / life)) * 6.2832;
            float rr = R * sqrt(h1(j * 9.3 + sd + floor(uTime / life)));
            c += vec3(cos(th) * rr, R * (0.04 + 0.1 * ph), sin(th) * rr); // on the wet surface around the hit point
            size = R * (0.03 + 0.05 * ph) * (0.6 + 0.6 * I);
            a = I * smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.8, 1.0, ph)) * step(h1(j * 7.7 + sd), 0.35 + 0.65 * I);
          } else { // steam wisp: rises, drifts, expands, fades
            float life = 2.2 + h1(j + sd) * 1.2;
            float ph = fract(uTime / life + h1(j * 2.3 + sd));
            c += vec3(sin(ph * 5.0 + j) * 0.3 * R, R * (0.3 + 2.4 * ph), cos(ph * 4.0 + j * 2.0) * 0.3 * R);
            size = R * (0.35 + 0.9 * ph);
            a = I * I * 0.16 * sin(3.14159 * ph);
          }
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * size;
          vUv = position.xy; vKind = kind; vA = a; vSeed = j + sd;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime;
        varying vec2 vUv; varying float vKind; varying float vA; varying float vSeed;
        void main() {
          float d = length(vUv);
          if (d > 1.0 || vA < 0.002) discard;
          vec4 c;
          if (vKind < 0.5) {
            float ring = smoothstep(0.55, 0.85, d) * (1.0 - smoothstep(0.88, 1.0, d));
            float hi = 1.0 - smoothstep(0.0, 0.25, length(vUv - vec2(-0.35, 0.35)));
            c = vec4(mix(uColor, vec3(1.0), 0.5 + 0.5 * hi), (ring * 0.8 + hi * 0.9 + 0.08) * vA);
          } else {
            float n = 0.5 + 0.5 * sin(vUv.x * 4.0 + vSeed + uTime * 0.7) * sin(vUv.y * 3.0 - uTime * 0.9 + vSeed * 2.0);
            c = vec4(vec3(0.95, 0.93, 0.88), vA * (1.0 - d * d) * (0.55 + 0.45 * n));
          }
          gl_FragColor = c;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  get count() {
    return this.geo.instanceCount;
  }
  set count(n: number) {
    this.geo.instanceCount = n;
  }

  /** world position of the target's acid-covered spot, radius (world units), intensity 0..1, seed 0..1 */
  set(i: number, pos: Vector3, radius: number, intensity: number, seed = (i * 0.618) % 1) {
    this.iPos.setXYZ(i, pos.x, pos.y, pos.z);
    this.iParams.setXYZW(i, radius, intensity, seed, 0);
  }

  commit() {
    this.iPos.needsUpdate = true;
    this.iParams.needsUpdate = true;
  }
}
