/**
 * Textures rewritten while the game runs (performance v5, claude/performance/05-spec-performance-v5-nonstop.md §1.1):
 * the ants' per-instance body offsets every frame, a nest's soil and light maps after a dig, its per-hex tiles.
 *
 * WebGL on Apple devices runs through ANGLE's Metal backend, where writing to a texture the GPU is still reading (the
 * frame before, still being drawn) either waits for the GPU (`replaceRegion` on a texture in use: the command buffer is
 * flushed and the CPU waits for it) or copies through a staging buffer with a blit, which ends the render pass being
 * recorded (its attachments stored and loaded back — a full-screen multisampled target at 2× on a Retina screen). A
 * texture uploaded by three.js is uploaded when its first draw binds it: in the middle of the shadow or scene pass.
 *
 * So a changing texture is a small ring of textures over one data array (`TextureRing`): each change goes to the next
 * one, which the GPU finished with frames ago, and is uploaded before the frame's first render pass
 * (`uploadPendingTextures`, from the view). The pixels are the same — only which GL texture holds them changes.
 */
import * as THREE from 'three';

/** textures changed since the last upload (the view uploads them before it draws) */
const pending = new Set<THREE.Texture>();

/** Mark a texture changed: it is uploaded before the next frame's draws. */
export function texturePending(t: THREE.Texture): void {
  t.needsUpdate = true;
  pending.add(t);
}

/** Upload every changed texture now (before the frame's render passes; nothing is drawn). */
export function uploadPendingTextures(renderer: THREE.WebGLRenderer): void {
  if (!pending.size) return;
  for (const t of pending) renderer.initTexture(t);
  pending.clear();
}

/** How many textures a ring holds: the one written now was last drawn this many frames ago. */
export const RING = 3;

/**
 * A data texture that changes while the game runs, as a ring of `RING` textures over the same data: write `data`,
 * then `commit()` — the next texture of the ring takes the change and is uploaded before the frame's draws; bind
 * `current` (the material's uniform is set by `onSwap`).
 */
export class TextureRing<T extends THREE.DataTexture = THREE.DataTexture> {
  readonly ring: T[];
  private i = 0;
  /** called with the texture to bind after each commit (a material's uniform) */
  onSwap: ((t: T) => void) | null = null;

  /**
   * Per texture of the ring: the rows changed since it was last uploaded — 'all' (the whole texture: never uploaded,
   * or a change without rows), a span, or null (it holds the data). Action-lag fix: a nest's light and soil textures
   * changed a few rows a dig and were sent whole each time (600 KB, many times a second while ants dig); a commit that
   * names its rows sends only those to the texture taking the change — and to the others when their turn comes.
   */
  private dirty: Array<{ y0: number; y1: number } | 'all' | null>;

  constructor(make: () => T, n = RING) {
    const first = make();
    this.ring = [first];
    for (let k = 1; k < n; k++) {
      const t = make();
      // one array for all of them: a commit uploads the current contents into the next texture
      t.image = first.image;
      this.ring.push(t);
    }
    this.dirty = this.ring.map(() => 'all');
    // (three.js calls this when a texture's upload is done: it holds the data from then on)
    this.ring.forEach((t, k) => (t.onUpdate = () => (this.dirty[k] = null)));
  }

  get current(): T {
    return this.ring[this.i];
  }

  get data(): T['image']['data'] {
    return this.ring[0].image.data;
  }

  get image(): T['image'] {
    return this.ring[0].image;
  }

  /**
   * The data changed: the next texture holds it from now on (a second change before the upload reuses it). `rows`:
   * only these rows changed (every change since the last commit must lie in them) — the texture taking the change
   * uploads the rows it is missing, not the whole picture.
   */
  commit(rows?: { y0: number; y1: number }): T {
    for (let k = 0; k < this.dirty.length; k++) {
      const d = this.dirty[k];
      this.dirty[k] = !rows || d === 'all' ? 'all' : d ? { y0: Math.min(d.y0, rows.y0), y1: Math.max(d.y1, rows.y1) } : { y0: rows.y0, y1: rows.y1 };
    }
    const cur = this.ring[this.i];
    if (pending.has(cur)) {
      cur.needsUpdate = true;
      this.setRanges(this.i);
      return cur;
    }
    this.i = (this.i + 1) % this.ring.length;
    const t = this.ring[this.i];
    this.setRanges(this.i);
    texturePending(t);
    this.onSwap?.(t);
    return t;
  }

  /** Texture k's upload: its missing rows (three.js uploads a range as one row), or all of it. */
  private setRanges(k: number): void {
    const t = this.ring[k];
    t.clearUpdateRanges();
    const d = this.dirty[k];
    if (!d || d === 'all') return;
    const stride = t.image.width * 4;
    for (let y = d.y0; y <= d.y1; y++) t.addUpdateRange(y * stride, stride);
  }

  dispose(): void {
    for (const t of this.ring) {
      t.dispose();
      pending.delete(t);
    }
  }
}
