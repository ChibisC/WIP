/**
 * Main-thread replica of the simulation (worker mode).
 *
 * The replica is an ordinary World that never runs systems: each frame from
 * the worker (worker/protocol.ts) overwrites its state in place, so the
 * renderers, the HUD and the UI's read-only sim queries (marker counts,
 * tile costs, area access…) keep working unchanged. Colony objects keep
 * their identity (the session holds on to its own colony), and entity
 * objects are pooled by id.
 */
import { ColumnReader } from '../sim/columns';
import { World } from '../sim/world';
import { Ant, Brood, Creature, Food, Projectile } from '../sim/types';
import { FrameMsg } from '../worker/protocol';

export class Replica {
  private ants = new ColumnReader<Ant>();
  private food = new ColumnReader<Food>();
  private brood = new ColumnReader<Brood>();
  private creatures = new ColumnReader<Creature>();
  private projectiles = new ColumnReader<Projectile>();
  /** the latest pheromone overlay (RGBA), if one was asked for */
  overlay: { colony: number; data: Uint8Array; fresh: boolean } | null = null;
  /** simulation time per tick in the worker (ms) */
  tickMs = 0;
  /** flood levels already applied to the replica's terrain, by zone */
  private floodLevels: number[] = [];

  /** `ctrl` (shared memory): tells the worker which frame's buffers it may reuse */
  constructor(
    public world: World,
    private ctrl?: Int32Array,
  ) {}

  apply(f: FrameMsg): void {
    const w = this.world;
    const s = w.s;
    const sl = f.slow;
    s.tick = sl.tick;
    s.time = sl.time;
    s.night = sl.night;
    s.nextId = sl.nextId;
    s.rng = sl.rng;
    w.rng.state = sl.rng;
    s.host = sl.host;
    s.mode = sl.mode;
    Object.assign(s.settings, sl.settings);
    for (const c of sl.colonies) {
      const ex = w.colonyById.get(c.id);
      if (ex) Object.assign(ex, c);
      else s.colonies.push(c);
    }
    s.caves = sl.caves;
    s.aphids = sl.aphids;
    s.plants = sl.plants;
    // floods: the sim's water lives in the worker; raise (or drain) this copy of the terrain to match
    if (sl.flood) {
      s.flood = sl.flood;
      sl.flood.forEach((f, i) => {
        if (this.floodLevels[i] !== f.level) {
          this.floodLevels[i] = f.level;
          w.terrain.setZoneFlood(i, f.level);
        }
      });
    }
    s.ants = this.ants.read(f.ants);
    s.food = this.food.read(f.food);
    s.brood = this.brood.read(f.brood);
    s.creatures = this.creatures.read(f.creatures);
    s.projectiles = this.projectiles.read(f.projectiles);
    for (const d of f.grids) {
      const g = w.nestOf(d.space);
      if (!g) continue;
      for (let i = 0; i < d.air.length; i++) {
        const k = d.air[i];
        g.carve(k % g.w, Math.floor(k / g.w));
      }
      if (d.hexSoil) g.hexSoil.set(d.hexSoil);
      if (d.hexWork) g.hexWork.set(d.hexWork);
      if (d.hexEntry) g.hexEntry.set(d.hexEntry);
      if (d.hexDesig) g.hexDesig.set(d.hexDesig);
      if (d.hexTotal) g.hexTotal.set(d.hexTotal);
      if (d.designated) {
        // redraw only the cells whose dig designation changed
        const des = g.designated;
        for (let k = 0; k < des.length; k++)
          if (des[k] !== d.designated[k]) {
            des[k] = d.designated[k];
            g.markDirty(k % g.w, Math.floor(k / g.w));
          }
      }
      if (d.designatedCount !== undefined) g.designatedCount = d.designatedCount;
      if (d.entrances) g.entrances = d.entrances;
      if (d.shafts) g.shafts = d.shafts;
      if (d.tunnels) g.tunnels = d.tunnels;
      if (d.spots) g.spots = d.spots;
      if (d.desigVersion !== undefined) g.desigVersion = d.desigVersion;
      g.version++;
      g.stateVersion++;
    }
    w.reindex();
    w.touch();
    if (f.phero) this.overlay = { colony: f.phero.colony, data: f.phero.data, fresh: true };
    this.tickMs = f.tickMs;
    // the columns have been read: the worker may reuse this frame's shared buffers
    if (this.ctrl) Atomics.store(this.ctrl, 0, f.frame);
    for (const e of f.events) w.events.emit(e);
  }
}
