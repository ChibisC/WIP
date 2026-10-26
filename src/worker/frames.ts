/**
 * Worker side of the per-tick frame (protocol.ts): what changed since the
 * last frame, packed for postMessage with its transferable buffers.
 */
import type { SimEvent } from '../core/events';
import { ColumnAlloc, ColumnWriter, columnBuffers } from '../sim/columns';
import { SharedPool } from './sharedPool';
import { World } from '../sim/world';
import { FrameMsg, GridDelta } from './protocol';

export class FrameBuilder {
  private ants = new ColumnWriter();
  private food = new ColumnWriter();
  private brood = new ColumnWriter();
  private creatures = new ColumnWriter();
  private projectiles = new ColumnWriter();
  /** per grid: dug cells, change and designation counters already sent */
  private seen = new Map<number, { air: number; ver: number; desig: number }>();
  overlayColony = -1;
  private overlayVer = -1;
  private frame = 0;
  /** shared ring buffers (cross-origin isolated pages), else null */
  private pool: SharedPool | null;

  /** `synced`: the main thread built its replica from the same snapshot, so grids start in step. */
  constructor(w: World, synced: boolean, ctrl?: Int32Array) {
    this.pool = ctrl ? new SharedPool(ctrl) : null;
    for (const [space, g] of w.grids) this.seen.set(space, synced ? { air: g.airCount, ver: g.stateVersion, desig: g.desigVersion } : { air: 0, ver: -1, desig: -1 });
  }

  build(w: World, ran: number, events: SimEvent[], tickMs: number): { msg: FrameMsg; transfer: ArrayBuffer[] } {
    const s = w.s;
    const transfer: ArrayBuffer[] = [];
    const frame = ++this.frame;
    const pool = this.pool;
    pool?.begin();
    const alloc = (key: string): ColumnAlloc | undefined =>
      pool ? { num: (n) => pool.take(`${key}:n`, frame, n, Float64Array), str: (n) => pool.take(`${key}:s`, frame, n, Uint16Array) } : undefined;
    const ants = this.ants.write(s.ants, null, alloc('ants'));
    const food = this.food.write(s.food, null, alloc('food'));
    const brood = this.brood.write(s.brood, null, alloc('brood'));
    const creatures = this.creatures.write(s.creatures, null, alloc('creatures'));
    const projectiles = this.projectiles.write(s.projectiles, null, alloc('proj'));
    for (const p of [ants, food, brood, creatures, projectiles]) transfer.push(...columnBuffers(p));
    const grids: GridDelta[] = [];
    for (const [space, g] of w.grids) {
      let seen = this.seen.get(space);
      if (!seen) {
        seen = { air: 0, ver: -1, desig: -1 };
        this.seen.set(space, seen);
      }
      if (seen.ver === g.stateVersion && seen.air === g.airCount) continue;
      const d: GridDelta = { space, air: g.airLog.slice(seen.air, g.airCount) };
      transfer.push(d.air.buffer as ArrayBuffer);
      d.hexSoil = g.hexSoil.slice();
      d.hexWork = g.hexWork.slice();
      d.hexEntry = g.hexEntry.slice();
      d.hexDesig = g.hexDesig.slice();
      d.designatedCount = g.designatedCount;
      d.entrances = g.entrances.slice();
      d.shafts = g.shafts.slice();
      d.tunnels = g.tunnels.map((t) => t.slice());
      d.spots = g.spots.map((t) => t.slice());
      if (seen.desig !== g.desigVersion) {
        d.designated = g.designated.slice();
        d.hexTotal = g.hexTotal.slice();
        d.desigVersion = g.desigVersion;
        transfer.push(d.designated.buffer as ArrayBuffer, d.hexTotal.buffer as ArrayBuffer);
      }
      transfer.push(d.hexSoil.buffer as ArrayBuffer, d.hexWork.buffer as ArrayBuffer, d.hexEntry.buffer as ArrayBuffer, d.hexDesig.buffer as ArrayBuffer);
      seen.air = g.airCount;
      seen.ver = g.stateVersion;
      seen.desig = g.desigVersion;
      grids.push(d);
    }
    const msg: FrameMsg = {
      t: 'frame',
      frame,
      ran,
      slow: {
        tick: s.tick,
        time: s.time,
        night: s.night,
        nextId: s.nextId,
        rng: w.rng.state,
        host: s.host,
        mode: s.mode,
        settings: s.settings,
        colonies: s.colonies,
        caves: s.caves,
        aphids: s.aphids,
        plants: s.plants,
      },
      ants,
      food,
      brood,
      creatures,
      projectiles,
      grids,
      events,
      tickMs,
    };
    if (this.overlayColony >= 0 && w.phero.version !== this.overlayVer) {
      this.overlayVer = w.phero.version;
      const ph = w.phero;
      const buf = new Uint8Array(ph.w * ph.h * 4);
      ph.pack(this.overlayColony, buf);
      msg.phero = { colony: this.overlayColony, data: buf };
      transfer.push(buf.buffer as ArrayBuffer);
    }
    return { msg, transfer };
  }

  /** Column arrays written to shared memory / to fallback buffers (null without shared memory). */
  get sharedStats(): { shared: number; fallback: number } | null {
    return this.pool ? this.pool.stats : null;
  }

  /** Force the next frame to resend the overlay (it was just switched on). */
  resetOverlay(): void {
    this.overlayVer = -1;
  }
}
