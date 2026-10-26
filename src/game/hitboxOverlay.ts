import * as THREE from 'three';
import { World } from '../sim/world';
import { AS } from '../sim/types';
import { casteOf } from '../sim/species';
import { bodyHook } from '../sim/slots';
import { creatureHooks } from '../sim/combat';
import { isTermiteQueen, queenBody } from '../sim/termites';

/**
 * Debug overlay (F3 or `?hitboxes=1`): the simulation's hitboxes, drawn on the ground. Everything in
 * the sim collides and fights with simple maths, never with the meshes:
 *  - an ant is a circle: its hit radius (0.45 × its length, yellow) for bites, stings and sprays, and a
 *    smaller body circle (0.22 × its length, dim) for crowding (separation); a heading tick shows its front;
 *  - a creature is a capsule (cyan: half-length `hl` along its heading, radius `r`): ants approach,
 *    latch and are pushed out by it; its bite reach from the centre is the magenta circle;
 *  - a termite queen's abdomen is a capsule too (orange).
 */
const SEG = 20;
const pos = new Float32Array(0);
const qb = { ax: 0, ay: 0, bx: 0, by: 0, r: 0 };

export class HitboxOverlay {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private p = pos;
  private c = new Float32Array(0);
  private n = 0;

  constructor(name: string) {
    const g = new THREE.BufferGeometry();
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 }));
    this.lines.renderOrder = 998;
    this.lines.frustumCulled = false;
    this.lines.name = name;
    this.group.add(this.lines);
    this.group.visible = false;
  }

  /** Draw the hitboxes of everything in `space` within `radius` mm of (cx, cy); hide with `on` false. */
  update(w: World, space: number, on: boolean, heightAt: (x: number, y: number) => number, cx: number, cy: number, radius: number): void {
    this.group.visible = on;
    if (!on) return;
    this.n = 0;
    const r2 = radius * radius;
    let ants = 0;
    for (const a of w.s.ants) {
      if (a.space !== space || a.state === AS.Dead || (a.x - cx) ** 2 + (a.y - cy) ** 2 > r2) continue;
      if (++ants > 1500) break;
      const cd = casteOf(a.caste);
      const y = heightAt(a.x, a.y) + 0.15;
      this.circle(a.x, y, a.y, cd.length * 0.45, 0xffd84a);
      this.circle(a.x, y, a.y, cd.length * 0.224, 0x8a7a40);
      this.line(a.x, y, a.y, a.x + Math.cos(a.h) * cd.length * 0.6, y, a.y + Math.sin(a.h) * cd.length * 0.6, 0xffd84a);
      if (isTermiteQueen(a)) {
        queenBody(a, qb);
        this.capsule(qb.ax, qb.ay, qb.bx, qb.by, qb.r, heightAt, 0xff9a3c);
      }
    }
    for (const cr of w.s.creatures) {
      if (cr.space !== space || cr.dead || (cr.x - cx) ** 2 + (cr.y - cy) ** 2 > r2 * 4) continue;
      const b = bodyHook.body(cr);
      const c = Math.cos(cr.h);
      const s = Math.sin(cr.h);
      this.capsule(cr.x - c * b.hl, cr.y - s * b.hl, cr.x + c * b.hl, cr.y + s * b.hl, b.r, heightAt, 0x40e8ff);
      this.circle(cr.x, heightAt(cr.x, cr.y) + 0.2, cr.y, creatureHooks.radius(cr) + 3, 0xff4ad8);
    }
    const g = this.lines.geometry;
    if ((g.getAttribute('position') as THREE.BufferAttribute | undefined)?.array !== this.p) {
      g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
    }
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.n * 2);
  }

  private circle(x: number, y: number, z: number, r: number, col: number): void {
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2;
      const a1 = ((i + 1) / SEG) * Math.PI * 2;
      this.line(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, col);
    }
  }

  /** A capsule round the segment (ax, ay)–(bx, by) on the ground, radius r. */
  private capsule(ax: number, ay: number, bx: number, by: number, r: number, heightAt: (x: number, y: number) => number, col: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);
    const h = d > 1e-6 ? Math.atan2(dy, dx) : 0;
    const nx = -Math.sin(h) * r;
    const ny = Math.cos(h) * r;
    const y = (x: number, z: number) => heightAt(x, z) + 0.25;
    if (d > 1e-6) {
      this.line(ax + nx, y(ax + nx, ay + ny), ay + ny, bx + nx, y(bx + nx, by + ny), by + ny, col);
      this.line(ax - nx, y(ax - nx, ay - ny), ay - ny, bx - nx, y(bx - nx, by - ny), by - ny, col);
    }
    // the two end caps: half circles
    for (const [ex, ey, a0] of [
      [bx, by, h - Math.PI / 2],
      [ax, ay, h + Math.PI / 2],
    ] as Array<[number, number, number]>) {
      for (let i = 0; i < SEG / 2; i++) {
        const t0 = a0 + (i / (SEG / 2)) * Math.PI;
        const t1 = a0 + ((i + 1) / (SEG / 2)) * Math.PI;
        const x0 = ex + Math.cos(t0) * r;
        const z0 = ey + Math.sin(t0) * r;
        const x1 = ex + Math.cos(t1) * r;
        const z1 = ey + Math.sin(t1) * r;
        this.line(x0, y(x0, z0), z0, x1, y(x1, z1), z1, col);
      }
    }
  }

  private line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, col: number): void {
    if ((this.n + 1) * 6 > this.p.length) {
      const np = new Float32Array(Math.max(6000, this.p.length * 2));
      np.set(this.p);
      this.p = np;
      const nc = new Float32Array(np.length);
      nc.set(this.c);
      this.c = nc;
    }
    const o = this.n * 6;
    this.p[o] = ax;
    this.p[o + 1] = ay;
    this.p[o + 2] = az;
    this.p[o + 3] = bx;
    this.p[o + 4] = by;
    this.p[o + 5] = bz;
    const r = ((col >> 16) & 255) / 255;
    const g = ((col >> 8) & 255) / 255;
    const b = (col & 255) / 255;
    this.c[o] = this.c[o + 3] = r;
    this.c[o + 1] = this.c[o + 4] = g;
    this.c[o + 2] = this.c[o + 5] = b;
    this.n++;
  }
}
