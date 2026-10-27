import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Post-processing pipeline that needs only ONE scene render (important because
 * ants are animated in their vertex shader, so override-material passes would
 * show them unanimated):
 *   scene → HDR target with depth → depth-only SSAO (+ bilateral blur)
 *   → AO composite → tilt-shift depth of field + colour grade/vignette
 *   → bloom → tone mapping/sRGB output.
 */
export interface GradeSettings {
  exposure: number;
  saturation: number;
  contrast: number;
  warmth: number; // -1 cool … +1 warm
  lift: THREE.Color;
  gain: THREE.Color;
  vignette: number;
  /** film grain (labs: the look of a real macro photo), 0 = none */
  grain?: number;
}

export interface PostSettings {
  ao: boolean;
  aoStrength: number;
  bloom: boolean;
  bloomStrength: number;
  dof: boolean;
  dofStrength: number;
  grade: GradeSettings;
}

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DEPTH_HELPERS = /* glsl */ `
uniform float cameraNear; uniform float cameraFar; uniform mat4 projInv;
float linDepth(float d){ float z = d*2.0-1.0; return (2.0*cameraNear*cameraFar)/(cameraFar + cameraNear - z*(cameraFar-cameraNear)); }
vec3 viewPos(vec2 uv, float d){ vec4 c = vec4(uv*2.0-1.0, d*2.0-1.0, 1.0); vec4 v = projInv * c; return v.xyz / v.w; }
`;

const SSAO_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth; uniform vec2 resolution; uniform mat4 proj; uniform float radiusScale; uniform float uTime;
${DEPTH_HELPERS}
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  float d = texture2D(tDepth, vUv).x;
  if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv, d);
  vec2 px = 1.0 / resolution;
  vec3 Pr = viewPos(vUv + vec2(px.x,0.0), texture2D(tDepth, vUv + vec2(px.x,0.0)).x);
  vec3 Pl = viewPos(vUv - vec2(px.x,0.0), texture2D(tDepth, vUv - vec2(px.x,0.0)).x);
  vec3 Pu = viewPos(vUv + vec2(0.0,px.y), texture2D(tDepth, vUv + vec2(0.0,px.y)).x);
  vec3 Pd = viewPos(vUv - vec2(0.0,px.y), texture2D(tDepth, vUv - vec2(0.0,px.y)).x);
  vec3 dx = abs(Pr.z-P.z) < abs(P.z-Pl.z) ? Pr-P : P-Pl;
  vec3 dy = abs(Pu.z-P.z) < abs(P.z-Pd.z) ? Pu-P : P-Pd;
  vec3 N = normalize(cross(dx, dy));
  float radius = radiusScale * -P.z;
  float a0 = rnd(vUv*resolution) * 6.2831;
  float occ = 0.0;
  const int S = 12;
  for (int i = 0; i < S; i++) {
    float fi = float(i);
    float r = (fi + 0.5) / float(S);
    float a = a0 + fi * 2.3999;
    float z = sqrt(1.0 - r);
    vec3 h = vec3(cos(a)*sqrt(r), sin(a)*sqrt(r), z);
    // orient hemisphere around N
    vec3 up = abs(N.z) < 0.999 ? vec3(0,0,1) : vec3(1,0,0);
    vec3 T = normalize(cross(up, N)); vec3 B = cross(N, T);
    vec3 dir = T*h.x + B*h.y + N*h.z;
    vec3 S3 = P + dir * radius * mix(0.2, 1.0, r*r);
    vec4 c = proj * vec4(S3, 1.0); vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sd = texture2D(tDepth, suv).x;
    vec3 Q = viewPos(suv, sd);
    float range = smoothstep(0.0, 1.0, radius / max(abs(P.z - Q.z), 1e-4));
    occ += (Q.z >= S3.z + radius*0.03 ? 1.0 : 0.0) * range;
  }
  float ao = 1.0 - occ / float(S);
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv; uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 dir; uniform vec2 resolution;
${DEPTH_HELPERS}
void main(){
  float d0 = linDepth(texture2D(tDepth, vUv).x);
  float sum = 0.0, w = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + dir * float(i) / resolution;
    float di = linDepth(texture2D(tDepth, uv).x);
    float wi = exp(-float(i*i)/12.0) * (1.0 / (1.0 + abs(di - d0) / max(d0*0.02, 1e-3)));
    sum += texture2D(tAO, uv).r * wi; w += wi;
  }
  gl_FragColor = vec4(vec3(sum / w), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tAO; uniform float aoStrength; uniform float aoOn;
void main(){
  vec4 c = texture2D(tColor, vUv);
  float ao = aoOn > 0.5 ? texture2D(tAO, vUv).r : 1.0;
  ao = mix(1.0, ao, aoStrength);
  gl_FragColor = vec4(c.rgb * ao, c.a);
}`;

const DOF_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 resolution;
uniform float focusDist; uniform float dofStrength; uniform float dofOn; uniform float uTilt;
uniform float exposure, saturation, contrast, warmth, vignette, grain; uniform vec3 lift; uniform vec3 gain;
${DEPTH_HELPERS}
float coc(vec2 uv){
  float z = linDepth(texture2D(tDepth, uv).x);
  float c = abs(z - focusDist) / max(focusDist, 1e-3);
  float tilt = abs(uv.y - 0.5) * 2.0;
  c = max(c*1.4, smoothstep(0.35, 1.0, tilt) * uTilt);
  return clamp(c, 0.0, 1.0);
}
void main(){
  vec3 col = texture2D(tColor, vUv).rgb;
  if (dofOn > 0.5) {
    float c0 = coc(vUv);
    float maxR = dofStrength * resolution.y / 1080.0 * 9.0;
    float r0 = c0 * maxR;
    if (r0 > 0.6) {
      vec3 acc = col; float wsum = 1.0;
      const int N = 22;
      for (int i = 0; i < N; i++) {
        float fi = float(i);
        float rr = sqrt((fi + 0.5) / float(N));
        float a = fi * 2.39996;
        vec2 o = vec2(cos(a), sin(a)) * rr * r0 / resolution;
        vec2 uv = vUv + o;
        float ci = coc(uv) * maxR;
        float w = smoothstep(0.0, 1.0, ci / max(rr*r0, 0.001)); // avoid sharp → blurred bleeding
        acc += texture2D(tColor, uv).rgb * w; wsum += w;
      }
      col = acc / wsum;
    }
  }
  // Colour grade in linear HDR
  col *= exposure;
  col = col * gain + lift * (1.0 - clamp(col, 0.0, 1.0));
  float l = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(vec3(l), col, saturation);
  col = (col - 0.18) * contrast + 0.18;
  col *= vec3(1.0 + warmth*0.06, 1.0, 1.0 - warmth*0.08);
  vec2 vv = vUv - 0.5; vv.x *= resolution.x / resolution.y;
  col *= mix(1.0, smoothstep(1.05, 0.25, length(vv)), vignette);
  if (grain > 0.0) {
    vec2 g = gl_FragCoord.xy;
    float n = fract(sin(dot(g, vec2(12.9898, 78.233))) * 43758.5453) + fract(sin(dot(g + 17.3, vec2(39.346, 11.135))) * 24634.6345) - 1.0;
    col *= 1.0 + n * grain;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export class PostPipeline {
  settings: PostSettings = {
    ao: true,
    aoStrength: 0.75,
    bloom: true,
    bloomStrength: 0.22,
    dof: true,
    dofStrength: 1,
    grade: { exposure: 1, saturation: 1.05, contrast: 1.05, warmth: 0.2, lift: new THREE.Color(0.01, 0.008, 0.004), gain: new THREE.Color(1, 1, 1), vignette: 0.35 },
  };
  enabled = true;
  focusDistance = 300;
  tilt = 0.35;
  private sceneRT: THREE.WebGLRenderTarget;
  private aoRT: THREE.WebGLRenderTarget;
  private aoRT2: THREE.WebGLRenderTarget;
  private compRT: THREE.WebGLRenderTarget;
  private hdrRT: THREE.WebGLRenderTarget;
  private ssao: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private comp: THREE.ShaderMaterial;
  private dof: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private bloomPass: UnrealBloomPass;
  private outputPass: OutputPass;
  private w = 1;
  private h = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    const mk = (samples: number, depth: boolean, type: THREE.TextureDataType = THREE.HalfFloatType) => {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type, samples, depthBuffer: depth });
      if (depth) {
        rt.depthTexture = new THREE.DepthTexture(1, 1);
        rt.depthTexture.type = THREE.UnsignedIntType;
      }
      return rt;
    };
    this.sceneRT = mk(4, true);
    this.aoRT = mk(0, false, THREE.UnsignedByteType);
    this.aoRT2 = mk(0, false, THREE.UnsignedByteType);
    this.compRT = mk(0, false);
    this.hdrRT = mk(0, false);
    const depthUniforms = () => ({
      tDepth: { value: this.sceneRT.depthTexture },
      cameraNear: { value: 1 },
      cameraFar: { value: 1000 },
      projInv: { value: new THREE.Matrix4() },
    });
    this.ssao = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: SSAO_FRAG,
      uniforms: { ...depthUniforms(), resolution: { value: new THREE.Vector2() }, proj: { value: new THREE.Matrix4() }, radiusScale: { value: 0.035 }, uTime: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { ...depthUniforms(), tAO: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, resolution: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.comp = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: { tColor: { value: this.sceneRT.texture }, tAO: { value: this.aoRT.texture }, aoStrength: { value: 0.7 }, aoOn: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.dof = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: DOF_FRAG,
      uniforms: {
        ...depthUniforms(),
        tColor: { value: this.compRT.texture },
        resolution: { value: new THREE.Vector2() },
        focusDist: { value: 300 },
        dofStrength: { value: 1 },
        dofOn: { value: 1 },
        uTilt: { value: 0.35 },
        exposure: { value: 1 },
        saturation: { value: 1 },
        contrast: { value: 1 },
        warmth: { value: 0 },
        vignette: { value: 0.3 },
        grain: { value: 0 },
        lift: { value: new THREE.Color() },
        gain: { value: new THREE.Color(1, 1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.25, 0.55, 0.92);
    this.outputPass = new OutputPass();
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.w = Math.floor(w * pixelRatio);
    this.h = Math.floor(h * pixelRatio);
    this.sceneRT.setSize(this.w, this.h);
    const aw = Math.max(1, Math.floor(this.w / 2));
    const ah = Math.max(1, Math.floor(this.h / 2));
    this.aoRT.setSize(aw, ah);
    this.aoRT2.setSize(aw, ah);
    this.compRT.setSize(this.w, this.h);
    this.hdrRT.setSize(this.w, this.h);
    this.bloomPass.setSize(this.w, this.h);
    (this.ssao.uniforms.resolution.value as THREE.Vector2).set(aw, ah);
    (this.blur.uniforms.resolution.value as THREE.Vector2).set(aw, ah);
    (this.dof.uniforms.resolution.value as THREE.Vector2).set(this.w, this.h);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    const s = this.settings;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    for (const m of [this.ssao, this.blur, this.dof]) {
      m.uniforms.cameraNear.value = camera.near;
      m.uniforms.cameraFar.value = camera.far;
      (m.uniforms.projInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
      m.uniforms.tDepth.value = this.sceneRT.depthTexture;
    }
    if (s.ao) {
      (this.ssao.uniforms.proj.value as THREE.Matrix4).copy(camera.projectionMatrix);
      this.quad.material = this.ssao;
      r.setRenderTarget(this.aoRT);
      this.quad.render(r);
      this.quad.material = this.blur;
      this.blur.uniforms.tAO.value = this.aoRT.texture;
      (this.blur.uniforms.dir.value as THREE.Vector2).set(1, 0);
      r.setRenderTarget(this.aoRT2);
      this.quad.render(r);
      this.blur.uniforms.tAO.value = this.aoRT2.texture;
      (this.blur.uniforms.dir.value as THREE.Vector2).set(0, 1);
      r.setRenderTarget(this.aoRT);
      this.quad.render(r);
    }
    this.comp.uniforms.aoOn.value = s.ao ? 1 : 0;
    this.comp.uniforms.aoStrength.value = s.aoStrength;
    this.quad.material = this.comp;
    r.setRenderTarget(this.compRT);
    this.quad.render(r);

    const g = s.grade;
    const u = this.dof.uniforms;
    u.focusDist.value = this.focusDistance;
    u.dofOn.value = s.dof ? 1 : 0;
    u.dofStrength.value = s.dofStrength;
    u.uTilt.value = this.tilt;
    u.exposure.value = g.exposure;
    u.saturation.value = g.saturation;
    u.contrast.value = g.contrast;
    u.warmth.value = g.warmth;
    u.vignette.value = g.vignette;
    u.grain.value = g.grain ?? 0;
    (u.lift.value as THREE.Color).copy(g.lift);
    (u.gain.value as THREE.Color).copy(g.gain);
    this.quad.material = this.dof;
    r.setRenderTarget(this.hdrRT);
    this.quad.render(r);

    if (s.bloom) {
      this.bloomPass.strength = s.bloomStrength;
      this.bloomPass.render(r, this.hdrRT, this.hdrRT, 0, false);
    }
    this.outputPass.renderToScreen = true;
    this.outputPass.render(r, null as unknown as THREE.WebGLRenderTarget, this.hdrRT, 0, false);
  }
}
