import * as THREE from 'three';
import { World } from '../../sim/world';
import { RAID } from '../../sim/creatures/titanDig';
import { TITAN_DIG } from '../../sim/balance';

/** Arc steps cached (the arc's geometry for each 1/STEPS of the work). */
const STEPS = 64;

/**
 * A titan's dig progress over the hole it is digging (claude/creatures/02-spec-easier-titan-holes.md §3,
 * claude/story/05-spec-story-titans-get-inside.md §2; render only): a ring flat on the ground round the hole — a dark
 * track, a bright arc filling with its work from twelve o'clock, and the three checkpoints (25 / 50 / 75 %) as pale
 * ticks the arc never falls back past. Everyone sees it (it is drawn from the shared simulation state, like the
 * titan). Sized to the breach the titan will make; drawn through the ground (no depth test) so a rim or a body never
 * hides it.
 */
export class DigRings {
  readonly group = new THREE.Group();
  private arcs: THREE.RingGeometry[] = [];
  private track = new THREE.RingGeometry(0.86, 1, 56);
  private tick = new THREE.PlaneGeometry(0.05, 0.3);
  private matTrack = new THREE.MeshBasicMaterial({ color: 0x140d07, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  private matArc = new THREE.MeshBasicMaterial({ color: 0xf2a23a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  private matTick = new THREE.MeshBasicMaterial({ color: 0xf6ead0, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  private items: Array<{ root: THREE.Group; arc: THREE.Mesh; step: number }> = [];

  constructor() {
    this.group.name = 'digRings';
    for (let i = 0; i <= STEPS; i++) {
      // (from twelve o'clock, clockwise seen from above: local +y is north after the ring is laid flat)
      const len = Math.max(1e-3, (i / STEPS) * Math.PI * 2);
      this.arcs.push(new THREE.RingGeometry(0.86, 1, Math.max(3, Math.ceil(56 * (i / STEPS))), 1, Math.PI / 2 - len, len));
    }
  }

  private item(i: number): { root: THREE.Group; arc: THREE.Mesh; step: number } {
    let it = this.items[i];
    if (it) return it;
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    const track = new THREE.Mesh(this.track, this.matTrack);
    const arc = new THREE.Mesh(this.arcs[0], this.matArc);
    track.renderOrder = 1003;
    arc.renderOrder = 1004;
    root.add(track, arc);
    for (const f of TITAN_DIG.checkpoints) {
      const t = new THREE.Mesh(this.tick, this.matTick);
      const a = Math.PI / 2 - f * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.93, Math.sin(a) * 0.93, 0);
      t.rotation.z = a - Math.PI / 2;
      t.renderOrder = 1005;
      root.add(t);
    }
    this.group.add(root);
    it = { root, arc, step: 0 };
    this.items[i] = it;
    return it;
  }

  update(w: World, heightAt: (x: number, y: number) => number): void {
    let n = 0;
    for (const cr of w.s.creatures) {
      if (cr.dead || (cr.data.raid ?? 0) <= 0 || (cr.data.rph ?? 0) !== RAID.Dig) continue;
      const c = w.colony((cr.data.raid ?? 0) - 1);
      const e = c?.entrances[cr.data.rhole ?? 0];
      if (!e) continue;
      const it = this.item(n++);
      const p = Math.max(0, Math.min(1, cr.data.rprog ?? 0));
      const step = Math.round(p * STEPS);
      if (step !== it.step) {
        it.step = step;
        it.arc.geometry = this.arcs[step];
      }
      // round the breach it will make (TITAN_DIG.breachHoleMm × its size), a little out from the rim
      const R = TITAN_DIG.breachHoleMm * Math.min(1.6, Math.max(0.7, Math.sqrt(Math.max(1, cr.scale) / TITAN_DIG.sizeRef))) * 2.1 + 6;
      it.root.position.set(e.sx, heightAt(e.sx, e.sy) + 0.6, e.sy);
      it.root.scale.setScalar(R);
      it.root.visible = true;
    }
    for (let i = n; i < this.items.length; i++) this.items[i].root.visible = false;
  }
}
