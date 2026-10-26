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
import { sharedAvailable } from '../worker/sharedPool';
import type { FromWorker, FrameMsg, ToWorker } from '../worker/protocol';

const TICK_DT = 0.05;

export interface SimHost extends NetSim {
  readonly kind: 'local' | 'worker';
  /** n ticks are due (the loop's clock, or the lockstep scheduler, decided) */
  tick(n: number): void;
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
  private lastFrameAt = 0;
  /** smoothed time between ticked frames (ms) */
  private gap = 50;
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
    this.queued = Math.min(this.queued + n, 24);
    this.pump();
  }

  /** One lockstep tick with its commands (sent at once; the worker queues them in order). */
  stepWith(cmds: Command[]): void {
    this.lockstep = true;
    const bytes = cmds.length ? encodeCommandLog(cmds) : undefined;
    this.inFlight++;
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
        this.replica.apply(m);
        if (m.ran > 0) {
          const now = performance.now();
          if (this.lastFrameAt > 0) this.gap = Math.min(250, Math.max(8, this.gap * 0.8 + (now - this.lastFrameAt) * 0.2));
          this.lastFrameAt = now;
          this.inFlight = Math.max(0, this.inFlight - m.ran);
        }
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
   * Render between the last two ticks: the replica holds the previous (px)
   * and current (x) positions, so alpha runs 0 → 1 over the time one tick
   * takes to arrive.
   */
  alpha(_loopAlpha: number, now: number, paused: boolean): number {
    if (paused || this.lastFrameAt === 0) return 1;
    return Math.min(1, Math.max(0, (now - this.lastFrameAt) / this.gap));
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
