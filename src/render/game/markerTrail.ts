import * as THREE from 'three';
import { MARKER_COLORS } from '../../sim/markers';

/**
 * The trail line of a pheromone marker (user 2026-11-01: "make a straight trail line showing where the path the
 * pheromone marker is going from the designated location to the nest like eotu", shown only while a marker is selected
 * or being placed): a straight dashed ribbon on the ground from the nest's entrance to the marker, in the marker's
 * colour, its dashes flowing out towards the marker. Two per scene: where the marker is now, and (fainter) where it
 * would go — from the cursor while placing.
 */
const SEG = 96;

const VERT = /* glsl */ `
  attribute float aU;
  varying float vU;
  void main() {
    vU = aU;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uCol;
  uniform float uAlpha;
  uniform float uDash;
  uniform float uTime;
  uniform float uLen;
  varying float vU;
  void main() {
    // dashes uDash long (mm), flowing from the nest (u = 0) to the marker; soft ends
    float d = fract((vU * uLen - uTime * uDash * 1.5) / (uDash * 2.0));
    float on = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.5, 0.58, d));
    float ends = smoothstep(0.0, 0.04, vU) * (1.0 - smoothstep(0.96, 1.0, vU));
    float a = uAlpha * (0.28 + 0.72 * on) * ends;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uCol, a);
  }
`;

class Ribbon {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array((SEG + 1) * 2 * 3);
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    const u = new Float32Array((SEG + 1) * 2);
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      u[i * 2] = u[i * 2 + 1] = i / SEG;
      if (i < SEG) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uCol: { value: new THREE.Color() }, uAlpha: { value: 1 }, uDash: { value: 4 }, uTime: { value: 0 }, uLen: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 17;
    this.mesh.visible = false;
  }

  /** Lay it from (ax, ay) — the nest — to (bx, by) — the marker — on the ground. */
  set(ax: number, ay: number, bx: number, by: number, heightAt: (x: number, y: number) => number, width: number, col: string, alpha: number, time: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy);
    if (L < 1e-3) {
      this.mesh.visible = false;
      return;
    }
    // across the line on the ground: (−dy, dx)
    const nx = (-dy / L) * width * 0.5;
    const ny = (dx / L) * width * 0.5;
    const lift = width * 0.15;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const x = ax + dx * t;
      const y = ay + dy * t;
      const h = heightAt(x, y) + lift;
      const o = i * 6;
      this.pos[o] = x + nx;
      this.pos[o + 1] = h;
      this.pos[o + 2] = y + ny;
      this.pos[o + 3] = x - nx;
      this.pos[o + 4] = h;
      this.pos[o + 5] = y - ny;
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const U = this.mat.uniforms;
    (U.uCol.value as THREE.Color).set(col);
    U.uAlpha.value = alpha;
    U.uDash.value = width * 2.2;
    U.uTime.value = time;
    U.uLen.value = L;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

export interface TrailEnds {
  /** where the marker is (placed in this scene) and the nest's end for it (the entrance nearest it), or null */
  at: { x: number; y: number } | null;
  nest: { x: number; y: number } | null;
  /** where it would go (the cursor, while placing) and the nest's end for that, or null */
  preview: { x: number; y: number } | null;
  nestP: { x: number; y: number } | null;
}

export class MarkerTrail {
  readonly group = new THREE.Group();
  private now = new Ribbon();
  private next = new Ribbon();

  constructor() {
    this.group.add(this.now.mesh, this.next.mesh);
    this.group.name = 'markerTrail';
  }

  /** Draw marker `i`'s trail (hidden when `i` < 0 or there is no nest end). `camDist` keeps the width steady on screen. */
  update(i: number, ends: TrailEnds | null, heightAt: (x: number, y: number) => number, camDist: number, time: number): void {
    if (i < 0 || !ends) {
      this.now.hide();
      this.next.hide();
      return;
    }
    const w = Math.max(0.3, camDist * 0.012);
    const col = MARKER_COLORS[i];
    if (ends.at && ends.nest) this.now.set(ends.nest.x, ends.nest.y, ends.at.x, ends.at.y, heightAt, w, col, 0.9, time);
    else this.now.hide();
    const p = ends.preview;
    if (p && ends.nestP && (!ends.at || Math.hypot(p.x - ends.at.x, p.y - ends.at.y) > w * 2)) this.next.set(ends.nestP.x, ends.nestP.y, p.x, p.y, heightAt, w * 0.8, col, 0.5, time);
    else this.next.hide();
  }
}
