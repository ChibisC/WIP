import { EventBus } from '../core/events';
import { restoreWorld } from '../sim/snapshot';
import { CommandSchedule, stepWithCommands } from '../sim/commands';

const TICK_DT = 0.05;

/**
 * Warm the JavaScript engine up before the first real tick (performance v5): a throwaway copy of the world runs a few
 * ticks and is dropped, so the game's own first ticks run compiled code — on a phone or in Safari the first ticks of
 * a big world ran many times slower and the picture stood still for seconds. The copy has its own state, events and
 * commands: the real world's results are the same with or without it (checked: the stress fight and a four-colony
 * skirmish, 600 ticks, every hash equal). At most 40 ticks or 1.2 s, and it stops once a tick runs at under half the
 * first one's time (the engine has caught up).
 */
export function warmUp(bytes: Uint8Array, maxMs = 1200, maxTicks = 40): number {
  const t0 = performance.now();
  const copy = restoreWorld(bytes, new EventBus());
  const sched = new CommandSchedule();
  let first = 0;
  let n = 0;
  for (let i = 0; i < maxTicks && performance.now() - t0 < maxMs; i++) {
    n++;
    const t = performance.now();
    stepWithCommands(copy, TICK_DT, sched);
    copy.events.drain();
    const ms = performance.now() - t;
    if (i === 0) first = ms;
    else if (i >= 3 && ms < first * 0.5) break;
  }
  return n;
}

