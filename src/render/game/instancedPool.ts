import * as THREE from 'three';

/**
 * Growable instanced mesh helper: begin() → add(matrix, color) … → end().
 */
export class InstancedPool {
  mesh: THREE.InstancedMesh;
  private n = 0;
  private cap: number;

  constructor(private geo: THREE.BufferGeometry, private mat: THREE.Material, private parent: THREE.Object3D, cap = 64, private shadows = true) {
    this.cap = cap;
    this.mesh = this.make(cap);
  }

  private make(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = this.shadows;
    m.receiveShadow = true;
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    this.parent.add(m);
    return m;
  }

  begin(): void {
    this.n = 0;
  }

  add(m: THREE.Matrix4, color?: THREE.Color): void {
    if (this.n >= this.cap) {
      const old = this.mesh;
      this.cap *= 2;
      this.mesh = this.make(this.cap);
      for (let i = 0; i < this.n; i++) {
        old.getMatrixAt(i, tmpM);
        this.mesh.setMatrixAt(i, tmpM);
        old.getColorAt(i, tmpC);
        this.mesh.setColorAt(i, tmpC);
      }
      this.parent.remove(old);
      old.dispose();
    }
    this.mesh.setMatrixAt(this.n, m);
    this.mesh.setColorAt(this.n, color ?? white);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    this.mesh.castShadow = on;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

/** Copy the instances `old` holds into `next` (a grown copy): matrices, and colours where both have them. */
export function keepInstances(old: THREE.InstancedMesh, next: THREE.InstancedMesh): void {
  const a = old.instanceMatrix.array;
  const b = next.instanceMatrix.array;
  b.set(a.subarray(0, Math.min(a.length, b.length)));
  if (old.instanceColor && next.instanceColor) {
    const c = old.instanceColor.array;
    const d = next.instanceColor.array;
    d.set(c.subarray(0, Math.min(c.length, d.length)));
  }
}

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
const white = new THREE.Color(1, 1, 1);
