/**
 * Shared column buffers for the worker's per-tick frames (performance
 * brief, Part A; deployment brief, Part G).
 *
 * When the page is cross-origin isolated (Netlify with public/_headers, or
 * the dev server), `SharedArrayBuffer` is available: the worker then writes
 * each frame's entity columns into a ring of three shared buffers per column
 * set and the main thread reads them in place — nothing is allocated,
 * copied or transferred per tick. The main thread records the last frame it
 * applied in a small shared control array; a ring slot is reused only after
 * the frame that used it has been applied, otherwise the frame falls back to
 * a fresh transferable buffer. Without isolation (GitHub Pages) every frame
 * uses transferable buffers, which also avoids copies.
 */

const RING = 3;

export function sharedAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

interface Slot {
  buf: SharedArrayBuffer;
  frame: number;
}

export class SharedPool {
  private rings = new Map<string, Slot[]>();
  /** buffers of the current frame that are not shared (must be transferred) */
  readonly loose: ArrayBuffer[] = [];
  /** frames written to shared memory / with a fallback, for the debug overlay */
  stats = { shared: 0, fallback: 0 };

  /** `ctrl[0]`: the last frame the main thread applied (Atomics). */
  constructor(private ctrl: Int32Array) {}

  private applied(): number {
    return Atomics.load(this.ctrl, 0);
  }

  /** A typed array of `length` elements for column set `key` in frame `frame`. */
  take<T extends Float64Array | Uint16Array>(key: string, frame: number, length: number, Ctor: { new (b: ArrayBufferLike, o?: number, l?: number): T; BYTES_PER_ELEMENT: number }): T {
    const bytes = Math.max(8, length * Ctor.BYTES_PER_ELEMENT);
    let ring = this.rings.get(key);
    if (!ring) this.rings.set(key, (ring = []));
    const i = frame % RING;
    let slot = ring[i];
    if (slot && slot.frame > this.applied()) {
      // the main thread has not applied the frame that used this slot yet: use a loose buffer this time
      const b = new ArrayBuffer(bytes);
      this.loose.push(b);
      this.stats.fallback++;
      return new Ctor(b, 0, length);
    }
    if (!slot || slot.buf.byteLength < bytes) {
      slot = { buf: new SharedArrayBuffer(Math.ceil(bytes * 1.25 / 8) * 8), frame };
      ring[i] = slot;
    }
    slot.frame = frame;
    this.stats.shared++;
    return new Ctor(slot.buf, 0, length);
  }

  /** Start a frame: forget last frame's loose buffers. */
  begin(): void {
    this.loose.length = 0;
  }
}
