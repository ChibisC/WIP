/**
 * The simulation worker (performance brief, Part A).
 *
 * Owns the authoritative World. It is created from a binary snapshot made
 * by the main thread (so map generation, dev scenes and, in multiplayer, a
 * host's state arrive the same way), advances only on `step`, applies
 * commands at tick boundaries, and posts a frame (protocol.ts) after every
 * batch. It never sees the DOM, the camera or the frame rate.
 */
import { EventBus, SimEvent } from '../core/events';
import { restoreWorld, encodeState, hashState } from '../sim/snapshot';
import { CommandSchedule, applyCommandsNow, decodeCommandLog, encodeCommandLog, stepWithCommands } from '../sim/commands';
import { World } from '../sim/world';
import { FrameBuilder } from './frames';
import type { FromWorker, ToWorker } from './protocol';

const TICK_DT = 0.05;
let world: World | null = null;
let frames: FrameBuilder | null = null;
const schedule = new CommandSchedule();
const events: SimEvent[] = [];

function post(m: FromWorker, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(m, transfer);
}

function sendFrame(ran: number, tickMs: number): void {
  if (!world || !frames) return;
  world.events.drain();
  const { msg, transfer } = frames.build(world, ran, events.splice(0), tickMs);
  post(msg, transfer);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.t) {
      case 'init': {
        const bus = new EventBus();
        world = restoreWorld(m.snapshot, bus);
        bus.onAny((e) => events.push(e));
        frames = new FrameBuilder(world, true, m.ctrl);
        post({ t: 'ready' });
        break;
      }
      case 'cmds': {
        if (!world) return;
        const w = world;
        const now: ReturnType<typeof decodeCommandLog> = [];
        for (const c of decodeCommandLog(m.bytes)) {
          // A command for the next tick (or one that arrived late) is applied at once at this boundary,
          // and logged for that tick: exactly where a replay applies it.
          if (c.tick <= w.s.tick + 1) {
            c.tick = w.s.tick + 1;
            now.push(c);
          } else schedule.add(c);
        }
        if (now.length) {
          for (const c of now) schedule.add(c);
          applyCommandsNow(w, schedule.take(w.s.tick + 1));
          sendFrame(0, 0);
        }
        break;
      }
      case 'step': {
        if (!world) return;
        if (m.cmds) for (const c of decodeCommandLog(m.cmds)) schedule.add(c);
        const t0 = performance.now();
        for (let i = 0; i < m.n; i++) stepWithCommands(world, TICK_DT, schedule);
        const ms = m.n > 0 ? (performance.now() - t0) / m.n : 0;
        sendFrame(m.n, ms);
        break;
      }
      case 'overlay':
        if (frames) {
          frames.overlayColony = m.colony;
          frames.resetOverlay();
        }
        break;
      case 'snapshot':
        if (world) {
          const bytes = encodeState(world);
          post({ t: 'snapshot', id: m.id, bytes }, [bytes.buffer as ArrayBuffer]);
        }
        break;
      case 'log': {
        const bytes = encodeCommandLog(schedule.log);
        post({ t: 'log', id: m.id, bytes }, [bytes.buffer as ArrayBuffer]);
        break;
      }
      case 'hash':
        if (world) post({ t: 'hash', id: m.id, hash: hashState(world), tick: world.s.tick });
        break;
    }
  } catch (err) {
    post({ t: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
