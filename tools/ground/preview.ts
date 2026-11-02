import * as THREE from 'three';
import { bakeGround, GL, GL_COUNT, GL_RELIEF, GL_TILE } from '../../src/render/ground/groundBake';

/**
 * Ground layer preview (dev tool, render only): every baked ground layer lit by a low sun with its own height-field
 * shadows, at true scale. Fast to render on software GL, for iterating on the layer generators.
 *   /tools/ground/preview.html?cell=300&cols=4&mm=90&layers=0,1,2&wet=0&sun=35
 * `mm` is the width of ground each cell shows; `wet` 0..1 previews the wetness layer.
 */
const q = new URLSearchParams(location.search);
const cell = Number(q.get('cell') ?? 300);
const cols = Number(q.get('cols') ?? 4);
const mm = Number(q.get('mm') ?? 90);
const wet = Number(q.get('wet') ?? 0);
const sunEl = (Number(q.get('sun') ?? 35) * Math.PI) / 180;
const layers = (q.get('layers') ?? [...Array(GL_COUNT).keys()].join(',')).split(',').map(Number);
const rows = Math.ceil(layers.length / cols);
const names = Object.fromEntries(Object.entries(GL).map(([k, v]) => [v, k]));

const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
r.setPixelRatio(1);
r.setSize(cell * cols, cell * rows);
const maps = bakeGround(r, Number(q.get('size') ?? 512));

const mat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    tA: { value: maps.a },
    tN: { value: maps.n },
    uL: { value: 0 },
    uTileMm: { value: 64 },
    uRelief: { value: 1 },
    uMm: { value: mm },
    uWet: { value: wet },
    uSun: { value: new THREE.Vector3(-Math.cos(sunEl) * 0.8, Math.sin(sunEl), -Math.cos(sunEl) * 0.6).normalize() },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    in vec3 position; in vec2 uv; out vec2 vUv;
    uniform mat4 modelViewMatrix, projectionMatrix;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float; precision highp sampler2DArray;
    in vec2 vUv; out vec4 o;
    uniform sampler2DArray tA, tN; uniform float uL, uTileMm, uRelief, uMm, uWet; uniform vec3 uSun;
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      vec2 uv = vUv * uMm / uTileMm;
      vec4 A = texture(tA, vec3(uv, uL));
      vec4 N = texture(tN, vec3(uv, uL));
      vec3 alb = pow(A.rgb, vec3(2.2));
      vec3 n = normalize(vec3(N.xy * 2.0 - 1.0, 1.0));
      float rough = A.a;
      // wetness preview: darker, glossier, bumps filled
      alb *= mix(1.0, 0.56, uWet); rough = mix(rough, 0.2, uWet * 0.85); n = normalize(mix(n, vec3(0, 0, 1), uWet * 0.35));
      // height-field shadow toward the sun (march in uv; heights in mm)
      vec3 L = vec3(uSun.x, -uSun.z, uSun.y);
      float h0 = N.b * uRelief;
      float sh = 1.0;
      for (int i = 1; i <= 16; i++) {
        float d = float(i) * 0.35; // mm
        vec2 p = uv + L.xy / length(L.xy) * d / uTileMm;
        float h = texture(tN, vec3(p, uL)).b * uRelief;
        float rise = d * L.z / length(L.xy);
        sh = min(sh, clamp(1.0 - (h - h0 - rise) * 2.0, 0.0, 1.0));
      }
      float ndl = max(dot(n, L), 0.0);
      vec3 V = vec3(0.0, -0.5, 0.86);
      vec3 H = normalize(L + normalize(V));
      float a2 = pow(max(rough, 0.05), 4.0);
      float d = pow(max(dot(n, H), 0.0), 2.0) * (a2 - 1.0) + 1.0;
      float spec = a2 / (3.14159 * d * d) * 0.04 * ndl;
      vec3 col = alb * (vec3(1.0, 0.93, 0.82) * 2.6 * ndl * sh + vec3(0.55, 0.62, 0.75) * 0.55 * N.a) + spec * 2.6 * sh;
      col = aces(col);
      o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
    }`,
});

const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
quad.position.set(0.5, 0.5, 0);
scene.add(quad);
r.autoClear = false;
r.setClearColor(0x111111);
r.clear();
layers.forEach((L, i) => {
  const cx = i % cols;
  const cy = rows - 1 - Math.floor(i / cols);
  mat.uniforms.uL.value = L;
  mat.uniforms.uTileMm.value = GL_TILE[L];
  mat.uniforms.uRelief.value = GL_RELIEF[L];
  r.setViewport(cx * cell, cy * cell, cell, cell);
  r.render(scene, cam);
  const lab = document.createElement('div');
  lab.textContent = `${L} ${names[L] ?? ''} (${mm} mm)`;
  lab.style.cssText = `position:absolute;left:${cx * cell + 4}px;top:${Math.floor(i / cols) * cell + 3}px;color:#fff;font:11px sans-serif;text-shadow:0 0 3px #000`;
  document.body.appendChild(lab);
});
// wait for the GPU (software GL renders asynchronously) before saying ready
const px = new Uint8Array(4);
const gl = r.getContext();
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
(window as unknown as { __previewReady: boolean }).__previewReady = true;
