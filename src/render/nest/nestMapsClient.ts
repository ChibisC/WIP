/**
 * The page's side of worker/nestMapsWorker.ts (action-lag fix, 2026-11-23): one worker for every nest terrain, made
 * on the first request. Off (everything on the page, as before) until the session turns it on, and never on with a
 * stepped clock (the golden shots: what a frame shows must not depend on when a worker answers), without Worker
 * support (the tests), or after the worker failed to start (the requests then answer null: the caller computes).
 */
import type { NestMapsInput } from './nestMaps';
import type { NestMapsJob, NestMapsResult } from '../../worker/nestMapsWorker';

let on = false;
let worker: Worker | null = null;
type Runner = (job: NestMapsJob, cb: (r: NestMapsResult | null) => void) => void;
/** the tests: requests answered by this instead of a worker (tests/performance.ts answers them late, out of turn) */
let runner: Runner | null = null;
export function setNestMapsRunner(r: Runner | null): void {
  runner = r;
}
let broken = false;
let nextId = 1;
const waiting = new Map<number, (r: NestMapsResult | null) => void>();

export function setNestMapsAsync(enable: boolean): void {
  on = enable && (typeof Worker !== 'undefined' || !!runner);
}

export function nestMapsAsync(): boolean {
  return on && (!broken || !!runner);
}

function fail(): void {
  broken = true;
  for (const cb of waiting.values()) cb(null);
  waiting.clear();
  worker?.terminate();
  worker = null;
}

/** Ask the worker for the maps of `m` (its arrays are handed over: pass copies). `cb` gets null if it cannot. */
export function requestNestMaps(m: NestMapsInput, cb: (r: NestMapsResult | null) => void): void {
  if (!nestMapsAsync()) return cb(null);
  if (runner) return runner({ ...m, id: nextId++ }, cb);
  if (!worker) {
    try {
      worker = new Worker(new URL('../../worker/nestMapsWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<NestMapsResult>) => {
        const f = waiting.get(e.data.id);
        waiting.delete(e.data.id);
        f?.(e.data);
      };
      worker.onerror = () => fail();
      worker.onmessageerror = () => fail();
    } catch {
      fail();
      return cb(null);
    }
  }
  const id = nextId++;
  waiting.set(id, cb);
  const job: NestMapsJob = { ...m, id };
  const transfer: Transferable[] = [m.soil.buffer];
  if (m.sealed) transfer.push(m.sealed.buffer);
  worker.postMessage(job, transfer);
}
