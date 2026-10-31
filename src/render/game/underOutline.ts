import * as THREE from 'three';
import { World } from '../../sim/world';
import { AS } from '../../sim/types';
import { casteOf } from '../../sim/species';
import { antHeights } from '../../sim/underpass';
import { arenaOf } from '../../sim/arenaState';
import { TEAM_COLORS } from './teamRings';

/** Outline colours away from the battle arena: yours, an ally's, a foe's. */
const MINE = new THREE.Color('#9cf59a');
const ALLY = new THREE.Color('#79b8ff');
const FOE = new THREE.Color('#ff7563');
const SEG = 14;
/** two outlines a little apart (a WebGL line is one pixel wide), the team colour lightened toward white */
const RINGS = [1, 1.14];
const LIGHT = 0.45;
const WHITE = new THREE.Color(1, 1, 1);
const tc = new THREE.Color();

/**
 * Under-pass (combat v2.2, CHANGE_PLAN §20; render only): an ant standing under a taller unit (`Ant.udr`) is hidden by
 * the body above it, so its outline is drawn through it — the shape of its body at half its height, in its team's
 * colour (the arena's team colour; elsewhere green yours, blue an ally's, red a foe's) lightened toward white so it
 * reads against the team rings, doubled, over everything (no depth test). Ants that are not under anything have none.
 */
export class UnderOutline {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private pos = new Float32Array(0);
  private col = new Float32Array(0);
  private cols = TEAM_COLORS.map((c) => new THREE.Color(c));

  constructor(name = 'underOutline') {
    const g = new THREE.BufferGeometry();
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false }));
    this.lines.renderOrder = 997;
    this.lines.frustumCulled = false;
    this.lines.name = name;
    this.group.add(this.lines);
  }

  /** Outline every ant in `space` standing under another unit; `player` is the colony this client plays. */
  update(w: World, space: number, alpha: number, heightAt: (x: number, y: number) => number, player: number): void {
    const A = arenaOf(w);
    const team = new Map<number, number>();
    if (A) A.teams.forEach((t, i) => team.set(t.colony, i));
    const myTeam = w.colony(player)?.team ?? -1;
    let n = 0;
    for (const a of w.s.ants) {
      if ((a.udr ?? 0) === 0 || a.space !== space || a.state === AS.Dead) continue;
      const need = (n + 1) * SEG * 6 * RINGS.length;
      if (need > this.pos.length) {
        const p = new Float32Array(Math.max(need, this.pos.length * 2));
        p.set(this.pos);
        this.pos = p;
        const c = new Float32Array(p.length);
        c.set(this.col);
        this.col = c;
      }
      const L = casteOf(a.caste).length;
      const d = antHeights(a.caste);
      const x = a.px + (a.x - a.px) * alpha;
      const z = a.py + (a.y - a.py) * alpha;
      const y = heightAt(x, z) + d.h * L * 0.5;
      const t = team.get(a.colony);
      const c = tc.copy(t !== undefined ? this.cols[t % this.cols.length] : a.colony === player ? MINE : w.colony(a.colony)?.team === myTeam && myTeam >= 0 ? ALLY : FOE).lerp(WHITE, LIGHT);
      const ch = Math.cos(a.h);
      const sh = Math.sin(a.h);
      const rx = L * 0.5;
      const rz = Math.max(d.hw * L, L * 0.08);
      let o = n * SEG * 6 * RINGS.length;
      for (const g of RINGS) for (let k = 0; k < SEG; k++) {
        for (const kk of [k, k + 1]) {
          const u = (kk / SEG) * Math.PI * 2;
          const lx = Math.cos(u) * rx * g;
          const lz = Math.sin(u) * rz * g;
          this.pos[o] = x + lx * ch - lz * sh;
          this.pos[o + 1] = y;
          this.pos[o + 2] = z + lx * sh + lz * ch;
          this.col[o] = c.r;
          this.col[o + 1] = c.g;
          this.col[o + 2] = c.b;
          o += 3;
        }
      }
      n++;
    }
    const g = this.lines.geometry;
    if (g.getAttribute('position')?.array !== this.pos) {
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    } else {
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('color').needsUpdate = true;
    }
    g.setDrawRange(0, n * SEG * 2 * RINGS.length);
    this.group.visible = n > 0;
  }
}
