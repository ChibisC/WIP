/**
 * Feel (claude/performance/02-spec-responsiveness-client-visuals.md; CHANGE_PLAN §29):
 *  - the meter (core/feel.ts): input → feedback is the time to the end of the first frame that started after the
 *    input; input → acting waits for the tick that applies the command; command latency in ticks; frame pacing
 *    (intervals, jitter, frames over 16.7/33 ms, missed vsyncs against the estimated display rate);
 *  - intent poses (game/intents.ts): an order's ants turn toward it at once, smoothly (no jump in any frame), most of
 *    the way in 160 ms; the simulation's own turn takes over without a seam; a refused order unturns in 200 ms;
 *    everything is gone after 1.5 s; the ants picked are the colony's own on the surface, not fighting, carrying or
 *    already there.
 *
 *   npx vite-node tests/feel.ts
 */
import { Feel } from '../src/core/feel';
import { Intents, intentAnts } from '../src/game/intents';
import { AS, Ant, Carry, Colony, SURFACE } from '../src/sim/types';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ---- the meter (with a fake clock)
{
  let now = 1000;
  const real = performance.now.bind(performance);
  (performance as unknown as { now: () => number }).now = () => now;
  try {
    const f = new Feel();
    // frames every 16.7 ms; an input at 1005 (between the frame at 1000 and the one at 1016.7)
    f.frameEnd(1000, 10);
    f.input('select', 1005);
    f.inputDone();
    now = 1016.7 + 4; // the frame that started at 1016.7 ends 4 ms later
    f.frameEnd(1016.7, 10);
    const fb = f.feedback.select.summary();
    check('meter: input → feedback runs to the end of the first frame after it', f.feedback.select.count === 1 && Math.abs(fb.avg - 15.7) < 0.01, `${fb.avg.toFixed(1)} ms`);
    // an order: issued in its input's handler at tick 10, applied for tick 11
    now = 1020;
    f.input('order', 1020);
    f.command(7, 'order', 10);
    f.inputDone();
    now = 1030;
    f.ack(7, 11);
    now = 1033.4 + 3;
    f.frameEnd(1033.4, 10);
    check('meter: acting waits for the tick that applies the command', f.acting.order.count === 0);
    now = 1050 + 3;
    f.frameEnd(1050, 11);
    check('meter: … and then counts from the input', f.acting.order.count === 1 && Math.abs(f.acting.order.summary().avg - 33) < 0.01, `${f.acting.order.summary().avg.toFixed(1)} ms`);
    check('meter: command latency in ticks and ms', f.cmdTicks.summary().avg === 1 && Math.abs(f.cmdMs.summary().avg - 10) < 0.01);
    // pacing: steady 60 Hz then one long frame
    f.reset();
    let t = 2000;
    for (let i = 0; i < 120; i++) {
      t += 16.67;
      now = t + 5;
      f.frameEnd(t, 20);
    }
    t += 50;
    now = t + 5;
    f.frameEnd(t, 20);
    check('meter: 60 Hz display estimated; one 50 ms frame is over 33 ms and a missed vsync', Math.abs(f.vsync - 16.67) < 0.1 && f.over33 === 1 && f.missed === 1 && f.over16 === 1, `display ${f.vsync.toFixed(2)} ms, over 33 ${f.over33}, missed ${f.missed}`);
  } finally {
    (performance as unknown as { now: () => number }).now = real;
  }
}

// ---- intent poses
{
  const t0 = 10_000;
  // an ant at the origin facing +x (0), sent to a point straight up (+y: π/2); a fresh set for each check
  const fresh = () => {
    const I = new Intents();
    I.add(3, [1], 0, 100, t0);
    return I;
  };
  const at = (I: Intents, ms: number, h = 0) => I.heading(1, 0, 0, h, t0 + ms);
  check('intent: nothing on the frame it is given (it starts there)', Math.abs(at(fresh(), 0)) < 1e-9);
  check('intent: most of the way round in 160 ms', Math.abs(at(fresh(), 160) - (Math.PI / 2) * 0.85) < 1e-6, `${at(fresh(), 160).toFixed(3)} rad`);
  {
    const I = fresh();
    let worst = 0;
    let prev = at(I, 0);
    for (let ms = 4; ms <= 1500; ms += 4) {
      const d = at(I, ms);
      worst = Math.max(worst, Math.abs(d - prev));
      prev = d;
    }
    // (the quickest part of the turn: 0.85 × 90° in 160 ms on a smoothstep, 1.5 × the mean rate)
    check('intent: smooth — no step over 0.06 rad between 4 ms frames, ends where the simulation is', worst < 0.06 && Math.abs(prev) < 1e-9, `worst ${worst.toFixed(3)} rad`);
  }
  {
    // the simulation's own turn: as its heading comes round, the drawn heading never moves away from the target
    const I = fresh();
    let mono = true;
    let prev = at(I, 200, 0);
    for (let h = 0; h <= Math.PI / 2 + 1e-9; h += 0.02) {
      const d = at(I, 200, h);
      if (d < prev - 1e-9) mono = false;
      prev = d;
    }
    check('intent: the simulation turning toward it takes over without going back', mono && Math.abs(at(I, 200, Math.PI / 2) - Math.PI / 2) < 1e-9);
  }
  {
    const I = fresh();
    const a1000 = at(I, 1000);
    const a1300 = at(I, 1300);
    const a1500 = at(I, 1500);
    check('intent: fades after the hold (1.1 s) and is gone at 1.5 s', a1300 < a1000 && a1300 > 0 && Math.abs(a1500) < 1e-9 && I.size === 0, `${a1000.toFixed(2)} → ${a1300.toFixed(2)} → ${a1500.toFixed(2)}`);
  }
  {
    // a refused order
    const I = fresh();
    const mid = at(I, 100);
    I.reject(3, t0 + 100);
    const r1 = at(I, 200);
    const r2 = at(I, 300);
    check('intent: a refused order unturns in 200 ms', mid > 0.3 && r1 > 0 && r1 < at(fresh(), 200) && Math.abs(r2) < 1e-9, `${mid.toFixed(2)} → ${r1.toFixed(2)} → ${r2.toFixed(2)}`);
  }
  {
    // the wrap: a target behind across ±π turns the short way
    const I = new Intents();
    I.add(5, [3], -100, -1, t0);
    const back = I.heading(3, 0, 0, Math.PI - 0.1, t0 + 160);
    check('intent: turns the short way across ±π', back > Math.PI - 0.1, back.toFixed(3));
  }
}

// ---- which ants an order turns
{
  const c = { id: 1, queen: 9 } as unknown as Colony;
  const ant = (id: number, o: Partial<Ant>): Ant => ({ id, colony: 1, space: SURFACE, x: 0, y: 0, state: AS.Idle, carry: Carry.None, marker: 2, ...o }) as Ant;
  const ants = [
    ant(1, {}),
    ant(2, { colony: 2 }),
    ant(3, { space: 5 }),
    ant(4, { state: AS.Attack }),
    ant(5, { carry: Carry.Food }),
    ant(6, { x: 95, y: 0 }), // already at the marker
    ant(7, { marker: 1 }),
    ant(9, {}), // the queen
    ant(10, { state: AS.Dead }),
  ];
  const ids = intentAnts(ants, c, 100, 0, 10, (a) => a.marker === 2);
  check("intent: only the colony's own ants on the surface, not fighting, carrying, already there, the queen or dead", ids.join() === '1', ids.join());
}

if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
