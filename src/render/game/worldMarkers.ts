import * as THREE from 'three';
import { MARKER_COLORS, MARKER_NAMES } from '../../sim/markers';
import { globalUniforms } from '../shaderPatch';

/** Numeral above a downward arrow, drawn once per marker into a canvas texture. */
function iconTexture(i: number): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const col = MARKER_COLORS[i];
  g.clearRect(0, 0, W, H);
  // numeral
  g.font = `600 ${i === 1 || i === 2 ? 64 : 76}px "Marcellus SC", "Cormorant SC", Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(20,12,6,0.85)';
  g.strokeText(MARKER_NAMES[i], W / 2, 62);
  const grad = g.createLinearGradient(0, 20, 0, 110);
  grad.addColorStop(0, '#fff8e8');
  grad.addColorStop(0.35, col);
  grad.addColorStop(1, shade(col, 0.55));
  g.fillStyle = grad;
  g.fillText(MARKER_NAMES[i], W / 2, 62);
  // downward arrow (faceted)
  const top = 118;
  const tip = 236;
  g.beginPath();
  g.moveTo(W / 2 - 34, top);
  g.lineTo(W / 2 + 34, top);
  g.lineTo(W / 2, tip);
  g.closePath();
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(20,12,6,0.85)';
  g.stroke();
  const ag = g.createLinearGradient(W / 2 - 34, 0, W / 2 + 34, 0);
  ag.addColorStop(0, shade(col, 0.6));
  ag.addColorStop(0.5, '#fff4dc');
  ag.addColorStop(0.52, col);
  ag.addColorStop(1, shade(col, 0.45));
  g.fillStyle = ag;
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return '#' + c.getHexString();
}

function glowTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

interface MarkerObj {
  root: THREE.Group;
  icon: THREE.Sprite;
  glow: THREE.Sprite;
  smoke: THREE.Points;
}

const SMOKE_N = 56;

/**
 * Coloured pheromone smoke curling up from a marker: each point is a wisp
 * born near the ground that rises, swells, drifts downwind and thins out.
 * Alpha-blended so it reads over bright grass as well as dark soil.
 * Shader-animated, no CPU work per frame.
 */
function smokePoints(col: THREE.Color, seed: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(SMOKE_N * 3);
  const sd = new Float32Array(SMOKE_N);
  for (let i = 0; i < SMOKE_N; i++) sd[i] = (i + 0.5) / SMOKE_N + Math.sin(i * 12.9898 + seed) * 0.004;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { uCol: { value: col }, uTime: globalUniforms.uTime, uK: { value: 1 }, uPx: { value: 900 }, uWind: { value: new THREE.Vector2(0.8, 0.35) }, uSel: { value: 0 } },
    vertexShader: `attribute float seed; uniform float uTime; uniform float uK; uniform float uPx; uniform vec2 uWind; uniform float uSel;
      varying float vA; varying float vT; varying float vRot; varying float vSeed;
      float h(float n){ return fract(sin(n*91.345)*47453.21); }
      void main(){
        float t = fract(uTime * 0.11 + seed);
        float a0 = h(seed*7.0) * 6.2832;
        float r0 = (0.08 + 0.22 * h(seed*3.0)) * uK;
        // curl: wisps spiral gently as they rise, then lean downwind
        float sw = sin(uTime*0.9 + seed*31.0) * 0.18 + sin(uTime*0.37 + seed*11.0) * 0.12;
        vec3 p = vec3(cos(a0 + t*2.2) * (r0 + 0.25*uK*t), (0.05 + t * 2.4) * uK, sin(a0 + t*2.2) * (r0 + 0.25*uK*t));
        p.xz += uWind * uK * (t*t*0.9 + sw*t);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uK * (0.45 + 1.25 * t) * (1.0 + 0.25*uSel) * uPx / -mv.z;
        vA = smoothstep(0.0, 0.18, t) * pow(1.0 - t, 1.3) * (0.85 + 0.3*uSel);
        vT = t;
        vRot = h(seed*13.0) * 6.2832 + t * (h(seed*5.0) - 0.5) * 3.0;
        vSeed = seed * 17.0;
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA; varying float vT; varying float vRot; varying float vSeed;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hh(i), hh(i+vec2(1,0)), f.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        d = mat2(c, -s, s, c) * d;
        // wispy puff: soft disc broken up by two octaves of noise
        float n = vn(d*4.0 + vSeed) * 0.65 + vn(d*9.0 - vSeed) * 0.35;
        float f = smoothstep(0.5, 0.05, length(d * vec2(1.0, 1.35)) + (n - 0.5) * 0.35);
        float a = f * vA * 0.3 * smoothstep(0.15, 0.55, n + 0.2);
        if (a < 0.004) discard;
        vec3 col = mix(uCol * 1.1, vec3(1.0), 0.25 * (1.0 - vT));
        gl_FragColor = vec4(col, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 18;
  return pts;
}

/**
 * The five pheromone markers drawn in a scene: a tall numeral above a
 * downward arrow with a soft coloured glow, gently giving off coloured smoke
 * (the pheromone). Screen size stays roughly constant with zoom.
 */
/** A marker as drawn: its state, or the state a pending command will give it. */
export interface ShownMarker {
  placed: boolean;
  space: number;
  x: number;
  y: number;
  pending?: boolean;
}

export class WorldMarkers {
  group = new THREE.Group();
  private objs: MarkerObj[] = [];
  /** world position of each marker's label anchor (under the arrow tip), null if hidden */
  anchors: Array<THREE.Vector3 | null> = [null, null, null, null, null];

  constructor() {
    const glowTex = glowTexture();
    // Redraw the numerals once the display font has loaded.
    document.fonts?.load('600 76px "Marcellus SC"').then(() => {
      this.objs.forEach((o, i) => {
        const m = o.icon.material as THREE.SpriteMaterial;
        m.map?.dispose();
        m.map = iconTexture(i);
        m.needsUpdate = true;
      });
    }).catch(() => undefined);
    for (let i = 0; i < 5; i++) {
      const col = new THREE.Color(MARKER_COLORS[i]);
      const root = new THREE.Group();
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(i), transparent: true, depthWrite: false, depthTest: false }));
      icon.renderOrder = 20;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
      glow.renderOrder = 19;
      const smoke = smokePoints(col, i * 17.3);
      root.add(smoke, glow, icon);
      root.visible = false;
      this.group.add(root);
      this.objs.push({ root, icon, glow, smoke });
    }
  }

  /**
   * Show the markers that sit in `space` (the player's markers as shown: a
   * command still waiting for its tick is drawn at once, shimmering).
   * `heightAt` gives the ground height; `camDist` keeps icons a steady size
   * on screen; `radius` per marker.
   */
  update(markers: ReadonlyArray<ShownMarker>, space: number, heightAt: (x: number, y: number) => number, camDist: number, radius: (i: number) => number, selected: number, time: number): void {
    for (let i = 0; i < 5; i++) {
      const m = markers[i];
      const o = this.objs[i];
      const shimmer = m?.pending ? 0.45 + 0.35 * Math.sin(time * 16 + i) : 1;
      (o.icon.material as THREE.SpriteMaterial).opacity = shimmer;
      (o.glow.material as THREE.SpriteMaterial).opacity = 0.55 * (m?.pending ? 0.5 + 0.5 * Math.sin(time * 16 + i + 1.2) : 1);
      if (!m || !m.placed || m.space !== space) {
        o.root.visible = false;
        this.anchors[i] = null;
        continue;
      }
      o.root.visible = true;
      const base = heightAt(m.x, m.y);
      o.root.position.set(m.x, base, m.y);
      const k = camDist * 0.1;
      const bob = Math.sin(time * 2 + i) * k * 0.05;
      const lift = k * 1.2 + bob;
      o.icon.scale.set(k * 0.5, k, 1);
      o.icon.position.set(0, lift + k * 0.5, 0);
      const sel = i === selected ? 1.35 : 1;
      o.glow.scale.setScalar(k * 1.5 * sel);
      o.glow.position.copy(o.icon.position);
      const su = (o.smoke.material as THREE.ShaderMaterial).uniforms;
      su.uK.value = k * 0.9;
      su.uPx.value = window.innerHeight * 0.9;
      su.uSel.value = i === selected ? 1 : 0;
      o.smoke.position.set(0, lift * 0.1, 0);
      void radius;
      const a = this.anchors[i] ?? new THREE.Vector3();
      this.anchors[i] = a.set(m.x, base + lift - k * 0.05, m.y);
    }
  }
}
