import * as THREE from 'three';
import { World } from '../../sim/world';
import { AS, SURFACE } from '../../sim/types';
import { casteOf } from '../../sim/species';
import { creatureKind } from '../../sim/creatures/kinds';
import { arenaOf } from '../../sim/arenaState';

/** Team colours of the battle arena (UI and rings): red, blue, green, gold. */
export const TEAM_COLORS = ['#d9473f', '#3f7fd9', '#4fb04a', '#e0b130'];

/**
 * Battle arena (render only): a flat ring in the team's colour on the ground under every unit, so four teams of
 * the same species can be told apart. Sized to the body (ants by caste length, creatures by body length), drawn
 * through the ground's shading, over the terrain and under the bodies; dead units have none.
 */
export class TeamRings {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private cap = 0;
  /** creatures: a thinner band (a big body's ring would be a wide disc otherwise) */
  private crMesh: THREE.InstancedMesh;
  private crCap = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private cols = TEAM_COLORS.map((c) => new THREE.Color(c));
  private geo = new THREE.RingGeometry(0.74, 1, 28);
  private crGeo = new THREE.RingGeometry(0.9, 1, 48);
  private mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

  constructor() {
    this.group.name = 'teamRings';
    this.mesh = this.make(null, this.geo, 256);
    this.crMesh = this.make(null, this.crGeo, 32);
    this.cap = 256;
    this.crCap = 32;
  }

  private make(old: THREE.InstancedMesh | null, geo: THREE.BufferGeometry, cap: number): THREE.InstancedMesh {
    if (old) {
      this.group.remove(old);
      old.dispose();
    }
    const m = new THREE.InstancedMesh(geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, this.cols[0]);
    m.frustumCulled = false;
    m.renderOrder = 1;
    m.count = 0;
    this.group.add(m);
    return m;
  }

  update(w: World, alpha: number, heightAt: (x: number, y: number) => number): void {
    const A = arenaOf(w);
    this.group.visible = !!A;
    if (!A) return;
    const team = new Map<number, number>();
    A.teams.forEach((t, i) => team.set(t.colony, i));
    let n = 0;
    let nc = 0;
    const put = (x: number, y: number, r: number, t: number, cr: boolean) => {
      if (!cr && n >= this.cap) this.mesh = this.make(this.mesh, this.geo, (this.cap *= 2));
      if (cr && nc >= this.crCap) this.crMesh = this.make(this.crMesh, this.crGeo, (this.crCap *= 2));
      const mesh = cr ? this.crMesh : this.mesh;
      const k = cr ? nc++ : n++;
      this.p.set(x, heightAt(x, y) + 0.12, y);
      this.s.set(r, r, r);
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(k, this.m);
      mesh.setColorAt(k, this.cols[t % this.cols.length]);
    };
    for (const a of w.s.ants) {
      if (a.space !== SURFACE || a.state === AS.Dead) continue;
      if (a.state === AS.Climb && (a.ridePh ?? 0) >= 1) continue; // up on a creature: the creature's ring is enough
      const t = team.get(a.colony);
      if (t === undefined) continue;
      const x = a.px + (a.x - a.px) * alpha;
      const y = a.py + (a.y - a.py) * alpha;
      put(x, y, casteOf(a.caste).length * 0.62 + 0.6, t, false);
    }
    for (const cr of w.s.creatures) {
      if (cr.space !== SURFACE || cr.dead) continue;
      const t = team.get(cr.faction);
      if (t === undefined) continue;
      const x = cr.px + (cr.x - cr.px) * alpha;
      const y = cr.py + (cr.y - cr.py) * alpha;
      put(x, y, (creatureKind(cr.kind)?.length ?? cr.scale) * 0.42 + 2, t, true);
    }
    for (const [mesh, k] of [
      [this.mesh, n],
      [this.crMesh, nc],
    ] as const) {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
