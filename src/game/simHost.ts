/**
 * Where the simulation runs (performance brief, Part A).
 *
 * - `LocalSim`: in this thread, as before. Used by tests, the screenshot
 *   harness (`?shot=1`, which steps the game synchronously) and as the
 *   fallback when workers are unavailable (`?worker=0`).
 * - `WorkerSim`: in a Web Worker (src/worker/simWorker.ts). The main thread
 *   keeps a replica World updated from the worker's frames and only renders,
 *   so a slow tick never costs a rendered frame.
 *
 * Either way the game loop asks for ticks, commands reach the simulation
 * through `LocalCommands`, and the renderers read `session.world`.
 */
import { World } from '../sim/world';
import { Command, CommandSchedule, applyCommandsNow, encodeCommandLog, stepWithCommands } from '../sim/commands';
import { encodeState, hashState } from '../sim/snapshot';
import type { NetSim } from '../net/netGame';
import { Replica } from './replica';
import { MotionCarry, Playout } from './playout';
import { prof } from '../core/profiler';
import { sharedAvailable } from '../worker/sharedPool';
import type { FromWorker, FrameMsg, ToWorker } from '../worker/protocol';

const TICK_DT = 0.05;

/**
 * How far a device's worker may fall behind the game's clock (ms of its own tick time) — performance v3, game speed
 * (CHANGE_PLAN §32.4). At 4× or 8× a big colony can need more ticks a second than a slow device's worker can run.
 * Past this much queued work the device waits for its worker instead of queueing more: single-player then runs at the
 * speed the device can do, in smaller and more frequent updates; multiplayer and replays wait as they do for a
 * player's packets (the slowest device paces the match), instead of the picture and the player's orders falling
 * further and further behind. A device that keeps up never gets near it. Nothing the simulation computes changes.
 */
export const WORKER_LAG_MS = 100;
/** (a rejoining player's catch-up keeps more queued: its worker should never wait for the next frame's top-up) */
export const WORKER_CATCHUP_LAG_MS = 500;

/** Single-player: how many ticks one batch may hold (24, fewer when the worker's ticks are slow). */
export function workerBatchCap(tickMs: number): number {
  return tickMs > 0 ? Math.max(2, Math.min(24, Math.floor(WORKER_LAG_MS / tickMs))) : 24;
}

/** Lockstep and replays: may another tick go to the worker with `inFlight` ticks not answered yet? */
export function workerHasRoom(inFlight: number, tickMs: number, lagMs = WORKER_LAG_MS): boolean {
  return inFlight * Math.max(tickMs, 0.5) < lagMs;
}

/** Rough size of a worker frame: its typed arrays (the per-tick entity columns and grids). */
function frameBytes(m: unknown, depth = 0): number {
  if (!m || typeof m !== 'object' || depth > 4) return 0;
  if (ArrayBuffer.isView(m)) return m.byteLength;
  if (m instanceof ArrayBuffer) return m.byteLength;
  let n = 0;
  if (Array.isArray(m)) {
    for (const x of m) n += frameBytes(x, depth + 1);
    return n;
  }
  for (const k in m as Record<string, unknown>) n += frameBytes((m as Record<string, unknown>)[k], depth + 1);
  return n;
}

export interface SimHost extends NetSim {
  readonly kind: 'local' | 'worker';
  /** n ticks are due (the loop's clock, or the lockstep scheduler, decided) */
  tick(n: number): void;
  /** lockstep and replays: can the next tick be sent (the worker is not too far behind; `WORKER_LAG_MS`)? */
  canStep(lagMs?: number): boolean;
  /** interpolation alpha for this frame */
  alpha(loopAlpha: number, now: number, paused: boolean): number;
  /** simulation time per tick (ms) */
  readonly tickMs: number;
  /** ask for the pheromone overlay of a colony (−1 = off) */
  setOverlay(colony: number): void;
  /** the newest overlay, once per change (worker mode) */
  takeOverlay(): Uint8Array | null;
  /** the canonical snapshot (saves, desync dumps, rejoining players) */
  snapshot(): Promise<Uint8Array>;
  /** every command applied so far, encoded (replays) */
  commandLog(): Promise<Uint8Array>;
  /** apply commands at the current tick boundary (single-player and replay endings) */
  applyNow(cmds: Command[]): void;
  dispose(): void;
}

export class LocalSim implements SimHost {
  readonly kind = 'local';
  tickMs = 0;

  constructor(
    private world: World,
    private schedule: CommandSchedule,
  ) {}

  tick(n: number): void {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) stepWithCommands(this.world, TICK_DT, this.schedule);
    if (n > 0) this.tickMs = this.tickMs * 0.9 + ((performance.now() - t0) / n) * 0.1;
  }

  stepWith(cmds: Command[]): void {
    for (const c of cmds) this.schedule.add(c);
    this.tick(1);
  }

  canStep(): boolean {
    return true;
  }

  hash(): Promise<{ tick: number; hash: string }> {
    return Promise.resolve({ tick: this.world.s.tick, hash: hashState(this.world) });
  }

  alpha(loopAlpha: number): number {
    return loopAlpha;
  }

  setOverlay(): void {}

  takeOverlay(): null {
    return null;
  }

  snapshot(): Promise<Uint8Array> {
    return Promise.resolve(encodeState(this.world));
  }

  commandLog(): Promise<Uint8Array> {
    return Promise.resolve(encodeCommandLog(this.schedule.log));
  }

  applyNow(cmds: Command[]): void {
    for (const c of cmds) this.schedule.add({ ...c, tick: this.world.s.tick + 1 });
    applyCommandsNow(this.world, this.schedule.take(this.world.s.tick + 1));
  }

  dispose(): void {}
}

export class WorkerSim implements SimHost {
  readonly kind = 'worker';
  private worker: Worker;
  private replica: Replica;
  private ready = false;
  /** ticks requested and not yet answered */
  private inFlight = 0;
  /** ticks due but not yet requested (the worker is busy) */
  private queued = 0;
  /** the replica's tick when the worker started, and the ticks asked for since (the loop's clock, with its alpha) */
  private base: number;
  private due = 0;
  /** smooth motion between the worker's frames (game/playout.ts) */
  readonly playout = new Playout();
  private carry = new MotionCarry();
  private nextId = 1;
  private waits = new Map<number, (v: Uint8Array) => void>();
  private hashWaits = new Map<number, (v: { tick: number; hash: string }) => void>();
  /** lockstep drives each tick itself (stepWith); the clock-driven batching is off */
  private lockstep = false;
  /** frames arrive in shared memory (cross-origin isolated page) */
  readonly shared: boolean;
  /** a frame was applied (the session clears pending commands from its events) */
  onFrame: ((f: FrameMsg) => void) | null = null;
  onError: ((msg: string) => void) | null = null;

  constructor(world: World) {
    // Cross-origin isolated pages share the per-tick entity columns instead of transferring them.
    const ctrl = sharedAvailable() ? new Int32Array(new SharedArrayBuffer(4)) : undefined;
    this.shared = !!ctrl;
    this.replica = new Replica(world, ctrl);
    this.base = world.s.tick;
    this.playout.reanchor = (a) => this.replica.reanchor(a);
    this.worker = new Worker(new URL('../worker/simWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => this.onError?.(e.message);
    const snap = encodeState(world);
    this.post({ t: 'init', snapshot: snap, ctrl }, [snap.buffer as ArrayBuffer]);
  }

  get tickMs(): number {
    return this.replica.tickMs;
  }

  private post(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer);
  }

  /** Commands for the worker (single-player ones for the next tick are applied at once). */
  send(cmds: Command[]): void {
    const bytes = encodeCommandLog(cmds);
    this.post({ t: 'cmds', bytes }, [bytes.buffer as ArrayBuffer]);
  }

  tick(n: number): void {
    const q = this.queued;
    // (at most 24 ticks wait, or fewer when the worker's ticks are slow: `WORKER_LAG_MS`)
    this.queued = Math.max(q, Math.min(q + n, workerBatchCap(this.tickMs)));
    this.due += this.queued - q;
    this.pump();
  }

  canStep(lagMs = WORKER_LAG_MS): boolean {
    return workerHasRoom(this.inFlight, this.tickMs, lagMs);
  }

  /** One lockstep tick with its commands (sent at once; the worker queues them in order). */
  stepWith(cmds: Command[]): void {
    this.lockstep = true;
    const bytes = cmds.length ? encodeCommandLog(cmds) : undefined;
    this.inFlight++;
    this.due++;
    this.post({ t: 'step', n: 1, cmds: bytes }, bytes ? [bytes.buffer as ArrayBuffer] : []);
  }

  /** Ticks sent to the worker and not answered yet. */
  get backlog(): number {
    return this.inFlight;
  }

  hash(): Promise<{ tick: number; hash: string }> {
    const id = this.nextId++;
    return new Promise((res) => {
      this.hashWaits.set(id, res);
      this.post({ t: 'hash', id });
    });
  }

  private pump(): void {
    if (this.lockstep || !this.ready || this.inFlight > 0 || this.queued <= 0) return;
    this.inFlight = this.queued;
    this.queued = 0;
    this.post({ t: 'step', n: this.inFlight });
  }

  private receive(m: FromWorker): void {
    switch (m.t) {
      case 'ready':
        this.ready = true;
        this.pump();
        break;
      case 'frame': {
        const t0 = performance.now();
        const c = this.carry;
        if (m.ran > 0) {
          c.mode = 'drawn';
          c.ran = m.ran;
          c.alpha = this.playout.arrive(m.slow.tick, this.replica.world.s.tick);
        } else c.mode = 'keep';
        this.replica.apply(m, c);
        prof.addMsg(performance.now() - t0, frameBytes(m));
        if (m.ran > 0) this.inFlight = Math.max(0, this.inFlight - m.ran);
        this.onFrame?.(m);
        this.pump();
        break;
      }
      case 'snapshot':
      case 'log': {
        const cb = this.waits.get(m.id);
        this.waits.delete(m.id);
        cb?.(m.bytes);
        break;
      }
      case 'hash': {
        const cb = this.hashWaits.get(m.id);
        this.hashWaits.delete(m.id);
        cb?.({ tick: m.tick, hash: m.hash });
        break;
      }
      case 'error':
        console.error('[sim worker]', m.message);
        this.onError?.(m.message);
        break;
    }
  }

  /**
   * The playout clock's α (game/playout.ts): the replica holds where each entity was drawn when the newest frame
   * arrived (px) and where it is in that frame (x); α runs on the loop's own clock, a little behind it.
   */
  alpha(loopAlpha: number, now: number, paused: boolean): number {
    return this.playout.frame(this.base + this.due + loopAlpha, now, paused);
  }

  setOverlay(colony: number): void {
    this.post({ t: 'overlay', colony });
  }

  takeOverlay(): Uint8Array | null {
    const o = this.replica.overlay;
    if (!o || !o.fresh) return null;
    o.fresh = false;
    return o.data;
  }

  snapshot(): Promise<Uint8Array> {
    const id = this.nextId++;
    return new Promise((res) => {
      this.waits.set(id, res);
      this.post({ t: 'snapshot', id });
    });
  }

  commandLog(): Promise<Uint8Array> {
    const id = this.nextId++;
    return new Promise((res) => {
      this.waits.set(id, res);
      this.post({ t: 'log', id });
    });
  }

  applyNow(cmds: Command[]): void {
    if (cmds.length) this.send(cmds);
  }

  dispose(): void {
    this.worker.terminate();
  }
}
