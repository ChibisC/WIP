import * as THREE from 'three';

/**
 * Signs over tunnel routes (claude/underground/01-spec-shared-underground-tunnels.md §3; game/fog.ts): a red "!" over a
 * warned gate (enemy diggers behind the wall) and over enemy ants an attacker's diggers sense past their frontier; a
 * small amber food mark and a violet creature mark for the other hints. Camera-facing sprites, render-only.
 */
export type SignKind = 'alert' | 'food' | 'creature' | 'brood';

export interface Sign {
  kind: SignKind;
  x: number;
  y: number;
  /** 0..1 fade */
  a?: number;
}

const TEX = new Map<SignKind, THREE.CanvasTexture>();

function texture(kind: SignKind): THREE.CanvasTexture {
  let t = TEX.get(kind);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, 64, 64);
  if (kind === 'alert') {
    // a red disc with a bold white "!"
    c.fillStyle = '#e8342a';
    c.beginPath();
    c.arc(32, 32, 28, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 44px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('!', 32, 34);
  } else if (kind === 'food') {
    c.fillStyle = '#f0b040';
    c.beginPath();
    c.arc(32, 32, 16, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#6b4a10';
    c.beginPath();
    c.arc(32, 32, 7, 0, Math.PI * 2);
    c.fill();
  } else if (kind === 'brood') {
    c.fillStyle = '#f4f0e2';
    c.beginPath();
    c.ellipse(32, 32, 12, 17, 0.4, 0, Math.PI * 2);
    c.fill();
  } else {
    c.fillStyle = '#b060e0';
    c.beginPath();
    c.moveTo(32, 6);
    c.lineTo(56, 50);
    c.lineTo(8, 50);
    c.closePath();
    c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 26px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', 32, 36);
  }
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  TEX.set(kind, t);
  return t;
}

export class RouteSigns {
  readonly group = new THREE.Group();
  private sprites: THREE.Mesh[] = [];
  private mats = new Map<SignKind, THREE.MeshBasicMaterial>();
  private quad = new THREE.PlaneGeometry(1, 1);

  private mat(kind: SignKind): THREE.MeshBasicMaterial {
    let m = this.mats.get(kind);
    if (!m) {
      // (camera-facing quads like the health bars: drawn over everything, no fog, no tone mapping)
      m = new THREE.MeshBasicMaterial({ map: texture(kind), depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false, side: THREE.DoubleSide });
      this.mats.set(kind, m);
    }
    return m;
  }

  /** Draw the signs this frame: positions in nest mm, `height` the floor height there, `scale` sprite size in mm, `time` for the pulse. */
  update(signs: ReadonlyArray<Sign>, height: (x: number, y: number) => number, scale: number, time: number, camera?: THREE.Camera): void {
    while (this.sprites.length < signs.length) {
      const sp = new THREE.Mesh(this.quad, this.mat('alert'));
      sp.renderOrder = 50;
      sp.frustumCulled = false;
      this.group.add(sp);
      this.sprites.push(sp);
    }
    for (let i = 0; i < this.sprites.length; i++) {
      const sp = this.sprites[i];
      const sg = signs[i];
      if (!sg) {
        sp.visible = false;
        continue;
      }
      sp.visible = true;
      sp.material = this.mat(sg.kind);
      const big = sg.kind === 'alert';
      const pulse = big ? 1 + 0.12 * Math.sin(time * 5) : 1;
      const s = scale * (big ? 1 : 0.6) * pulse;
      sp.scale.set(s, s, 1);
      // just above the floor (a gate sits in the wall: its sign hangs at head height, not over the wall top)
      sp.position.set(sg.x, height(sg.x, sg.y) + s * (big ? 0.6 : 0.5), sg.y);
      if (camera) sp.quaternion.copy(camera.quaternion);
      (sp.material as THREE.MeshBasicMaterial).opacity = sg.a ?? 1;
    }
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
  }
}
