import * as THREE from 'three';
import { currentMood } from './mapBiomes';
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
uniform float focusDist; uniform float dofStrength; uniform float dofOn; uniform float uTilt; uniform float uHaze; uniform vec3 uHazeColor;
uniform float exposure, saturation, contrast, warmth, vignette, grain; uniform vec3 lift; uniform vec3 gain;
uniform float uSharp;
${DEPTH_HELPERS}
float coc(vec2 uv){
  float z = linDepth(texture2D(tDepth, uv).x);
  // a lens focused at focusDist: the blur grows with the depth difference (in front of the focus faster than behind),
  // plus a little of the tilt-shift fall-off toward the top and bottom (slight: a macro lens, not a miniature)
  float c = abs(z - focusDist) / max(min(z, focusDist) * 1.6, 1e-3);
  float tilt = abs(uv.y - 0.5) * 2.0;
  c = max(c, smoothstep(0.55, 1.0, tilt) * uTilt * 0.45);
  return clamp(c, 0.0, 1.0);
}
void main(){
  vec3 col = texture2D(tColor, vUv).rgb;
  // dynamic resolution (performance pass): below full resolution a light sharpening keeps edges crisp; off at full
  if (uSharp > 0.0) {
    vec2 px = 1.0 / resolution;
    vec3 nb = texture2D(tColor, vUv + vec2(px.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(px.x, 0.0)).rgb + texture2D(tColor, vUv + vec2(0.0, px.y)).rgb + texture2D(tColor, vUv - vec2(0.0, px.y)).rgb;
    col = max(col + uSharp * (col - nb * 0.25), vec3(0.0));
  }
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
  // distance haze (a map's mood: heat haze over the sand), in linear HDR before the grade
  if (uHaze > 0.0) {
    float zh = linDepth(texture2D(tDepth, vUv).x);
    float hz = uHaze * (1.0 - exp(-zh / 1400.0));
    col = mix(col, uHazeColor * 0.75, hz);
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

/**
 * The output pass when the effects ran below the canvas's resolution (performance v5: Retina screens at 1.5 device
 * pixels a screen pixel): the HDR picture upscaled with a Catmull-Rom filter (nine bilinear taps — sharper than the
 * browser's bilinear stretch of a smaller canvas), then tone mapping and the colour space as three's OutputPass.
 */
const UPSCALE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uSrcSize;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
vec4 catmullRom(vec2 uv) {
  vec2 p = uv * uSrcSize;
  vec2 t1 = floor(p - 0.5) + 0.5;
  vec2 f = p - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t12 = (t1 + w2 / w12) / uSrcSize;
  vec2 t0 = (t1 - 1.0) / uSrcSize;
  vec2 t3 = (t1 + 2.0) / uSrcSize;
  vec4 c = texture2D(tDiffuse, vec2(t0.x, t0.y)) * (w0.x * w0.y)
    + texture2D(tDiffuse, vec2(t12.x, t0.y)) * (w12.x * w0.y)
    + texture2D(tDiffuse, vec2(t3.x, t0.y)) * (w3.x * w0.y)
    + texture2D(tDiffuse, vec2(t0.x, t12.y)) * (w0.x * w12.y)
    + texture2D(tDiffuse, vec2(t12.x, t12.y)) * (w12.x * w12.y)
    + texture2D(tDiffuse, vec2(t3.x, t12.y)) * (w3.x * w12.y)
    + texture2D(tDiffuse, vec2(t0.x, t3.y)) * (w0.x * w3.y)
    + texture2D(tDiffuse, vec2(t12.x, t3.y)) * (w12.x * w3.y)
    + texture2D(tDiffuse, vec2(t3.x, t3.y)) * (w3.x * w3.y);
  return max(c, vec4(0.0));
}
void main() {
  gl_FragColor = catmullRom(vUv);
  #ifdef LINEAR_TONE_MAPPING
    gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
  #elif defined(REINHARD_TONE_MAPPING)
    gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
  #elif defined(CINEON_TONE_MAPPING)
    gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
  #elif defined(ACES_FILMIC_TONE_MAPPING)
    gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
  #elif defined(AGX_TONE_MAPPING)
    gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
  #elif defined(NEUTRAL_TONE_MAPPING)
    gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
  #elif defined(CUSTOM_TONE_MAPPING)
    gl_FragColor.rgb = CustomToneMapping(gl_FragColor.rgb);
  #endif
  #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF(gl_FragColor);
  #endif
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
  /** dynamic resolution's sharpening (0 at full resolution) */
  sharpen = 0;
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
  /** the output pass that upscales (effects below the canvas's resolution) */
  private upscalePass: OutputPass;
  private w = 1;
  private h = 1;
  /** the canvas's drawing buffer (the effects run at w × h, at most this) */
  private outW = 1;
  private outH = 1;

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
        uHaze: { value: 0 },
        uHazeColor: { value: new THREE.Color(1, 1, 1) },
        vignette: { value: 0.3 },
        grain: { value: 0 },
        uSharp: { value: 0 },
        lift: { value: new THREE.Color() },
        gain: { value: new THREE.Color(1, 1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.25, 0.55, 0.92);
    this.outputPass = new OutputPass();
    this.upscalePass = new OutputPass();
    this.upscalePass.uniforms.uSrcSize = { value: new THREE.Vector2(1, 1) };
    this.upscalePass.material.fragmentShader = UPSCALE_FRAG;
  }

  /**
   * Draw every pass once (the pre-warm, performance v5): each effect's program and pipeline built behind the loading
   * screen — ambient occlusion, depth of field, bloom and both last passes (as set, and upscaling) whatever the settings.
   */
  warm(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.enabled) return;
    const keep = { ...this.settings };
    const s = this.settings;
    s.ao = s.bloom = s.dof = true;
    try {
      this.render(scene, camera);
      const r = this.renderer;
      for (const pass of [this.outputPass, this.upscalePass]) {
        (this.upscalePass.uniforms.uSrcSize.value as THREE.Vector2).set(this.w, this.h);
        pass.renderToScreen = true;
        pass.render(r, null as unknown as THREE.WebGLRenderTarget, this.hdrRT, 0, false);
      }
    } finally {
      Object.assign(this.settings, keep);
    }
  }

  /** the effects run below the canvas's resolution: the last pass upscales */
  get upscaling(): boolean {
    return this.w < this.outW || this.h < this.outH;
  }

  /** The last pass, to the screen: as three's OutputPass, upscaling when the effects ran smaller. */
  private toScreen(src: THREE.WebGLRenderTarget): void {
    const r = this.renderer;
    const pass = this.upscaling ? this.upscalePass : this.outputPass;
    if (pass === this.upscalePass) (this.upscalePass.uniforms.uSrcSize.value as THREE.Vector2).set(this.w, this.h);
    pass.renderToScreen = true;
    pass.render(r, null as unknown as THREE.WebGLRenderTarget, src, 0, false);
  }

  /**
   * The effects' size: `pixelRatio` device pixels a screen pixel; `outRatio` the canvas's own (performance v5: on a
   * Retina screen the effects at 1.5, the canvas at 2, the last pass upscaling; the same when they are equal).
   */
  setSize(w: number, h: number, pixelRatio: number, outRatio = pixelRatio): void {
    this.outW = Math.floor(w * outRatio);
    this.outH = Math.floor(h * outRatio);
    this.w = Math.min(this.outW, Math.floor(w * pixelRatio));
    this.h = Math.min(this.outH, Math.floor(h * pixelRatio));
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

  /**
   * The benchmark's GPU breakdown (performance v5, dev/gpuBreakdown.ts): called after each pass with its name; it waits
   * for the GPU (gl.finish) and times the pass. Null in play.
   */
  mark: ((pass: string) => void) | null = null;
  /**
   * The benchmark's "post effects off" (performance v5): the scene into its target and straight to tone mapping, no
   * effect between — the same shader programs as with the effects (drawing to the screen instead needs new ones for
   * every material, seconds of compiling on some devices). Never set in play.
   */
  bare = false;

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const r = this.renderer;
    const mark = this.mark;
    mark?.('');
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      mark?.('scene (no post effects)');
      return;
    }
    const s = this.settings;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    mark?.('scene');
    if (this.bare) {
      this.toScreen(this.sceneRT);
      mark?.('tone mapping to the screen');
      return;
    }

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
      mark?.('ambient occlusion (half resolution, blurred)');
    }
    // (without ambient occlusion the composite was a full-screen copy: the grade reads the scene directly — the same
    // pixels, one full-screen pass fewer; performance pass)
    if (s.ao) {
      this.comp.uniforms.aoOn.value = 1;
      this.comp.uniforms.aoStrength.value = s.aoStrength;
      this.quad.material = this.comp;
      r.setRenderTarget(this.compRT);
      this.quad.render(r);
      mark?.('ambient occlusion applied');
      this.dof.uniforms.tColor.value = this.compRT.texture;
    } else this.dof.uniforms.tColor.value = this.sceneRT.texture;

    const g = s.grade;
    const u = this.dof.uniforms;
    u.focusDist.value = this.focusDistance;
    u.dofOn.value = s.dof ? 1 : 0;
    u.dofStrength.value = s.dofStrength;
    u.uTilt.value = this.tilt;
    // the map's mood over the view's grade (render/mapBiomes.ts MAP_MOOD)
    const md = currentMood.mood;
    u.exposure.value = g.exposure * (md?.exposure ?? 1);
    u.saturation.value = g.saturation * (md?.saturation ?? 1);
    u.contrast.value = g.contrast * (md?.contrast ?? 1);
    u.warmth.value = g.warmth + (md?.warmth ?? 0);
    u.uHaze.value = md?.haze ?? 0;
    (u.uHazeColor.value as THREE.Color).setHex(md?.hazeColor ?? 0xffffff).convertSRGBToLinear();
    u.vignette.value = g.vignette;
    u.grain.value = g.grain ?? 0;
    u.uSharp.value = this.sharpen;
    (u.lift.value as THREE.Color).copy(g.lift);
    (u.gain.value as THREE.Color).copy(g.gain);
    this.quad.material = this.dof;
    r.setRenderTarget(this.hdrRT);
    this.quad.render(r);
    mark?.('depth of field and colour grade');

    if (s.bloom) {
      this.bloomPass.strength = s.bloomStrength + (currentMood.mood?.bloom ?? 0);
      this.bloomPass.render(r, this.hdrRT, this.hdrRT, 0, false);
      mark?.('bloom');
    }
    this.toScreen(this.hdrRT);
    mark?.('tone mapping to the screen');
  }
}
