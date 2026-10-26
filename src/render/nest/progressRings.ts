import * as THREE from 'three';

/**
 * Thin circular progress rings lying on the nest floor, one per hex being
 * worked (dig / build / upgrade / delete) and — with the tile overlay on —
 * one per incubating larva. Instanced quads; the fragment shader draws the
 * filled arc. A paused (pre-staged) larva's ring is drawn frozen at its value
 * with a dimmer colour.
 */
const MAX = 512;

export interface RingItem {
  x: number;
  y: number;
  /** floor height */
  h: number;
  radius: number;
  progress: number;
  color: THREE.Color;
}

export class ProgressRings {
  readonly mesh: THREE.InstancedMesh;
  private prog: THREE.InstancedBufferAttribute;
  private col: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.prog = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    geo.setAttribute('aProg', this.prog);
    geo.setAttribute('aCol', this.col);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float aProg; attribute vec3 aCol; varying vec2 vUv; varying float vP; varying vec3 vC;
        void main(){ vUv = uv * 2.0 - 1.0; vP = aProg; vC = aCol;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vP; varying vec3 vC;
        void main(){
          float r = length(vUv);
          float band = smoothstep(0.66, 0.72, r) * smoothstep(1.0, 0.94, r);
          if (band < 0.01) discard;
          // angle from 12 o'clock, clockwise
          float a = atan(vUv.x, vUv.y) / 6.2831853;
          a = a < 0.0 ? a + 1.0 : a;
          float filled = step(a, vP);
          vec3 c = mix(vec3(0.08,0.06,0.04), vC, filled);
          gl_FragColor = vec4(c, band * mix(0.55, 0.95, filled));
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
  }

  set(items: RingItem[]): void {
    const n = Math.min(MAX, items.length);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      this.p.set(it.x, it.h + 0.5, it.y);
      this.s.set(it.radius, it.radius, 1);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.prog.setX(i, Math.max(0, Math.min(1, it.progress)));
      this.col.setXYZ(i, it.color.r, it.color.g, it.color.b);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.prog.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}
