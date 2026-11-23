/// <reference lib="webworker" />
/**
 * The nest mesh's signed distance and light map, made off the page (action-lag fix, 2026-11-23): the same functions
 * the page runs for a full rebuild (render/nest/nestMaps.ts), so the same values to the bit.
 */
import { NestMapsInput, nestMapsCompute, sdScratch, SdScratch } from '../render/nest/nestMaps';

export interface NestMapsJob extends NestMapsInput {
  id: number;
}

export interface NestMapsResult {
  id: number;
  sd: Float32Array;
  light: Uint8Array;
  ms: number;
}

let scratch: SdScratch | null = null;

self.onmessage = (e: MessageEvent<NestMapsJob>) => {
  const m = e.data;
  const t0 = performance.now();
  const n = m.W * m.H;
  scratch = sdScratch(n, scratch);
  const { sd, light } = nestMapsCompute(m, scratch);
  const out: NestMapsResult = { id: m.id, sd, light, ms: performance.now() - t0 };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(out, [sd.buffer, light.buffer]);
};
