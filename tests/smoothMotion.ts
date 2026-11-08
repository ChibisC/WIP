/**
 * Smooth motion between the worker's frames (game/playout.ts; CHANGE_PLAN §29.2 step 2).
 *
 * A model of the worker setup — the loop asking for ticks on the display's clock, the worker answering after its own
 * tick time and batching ticks while busy, the frames read through the real column writer/reader with the motion
 * carry, and the renderers' lerp(px, x, α) — replays uneven and batched arrivals at 60 and 144 Hz and checks the
 * drawn path: the step from one rendered frame to the next stays close to the true speed (no freezes, no jumps),
 * a turn's heading too; a teleport snaps; a pause glides to the last tick and stops; the old arrival-based α is
 * measured alongside for the record.
 *
 *   npx vite-node tests/smoothMotion.ts
 */
import { ColumnReader, ColumnWriter } from '../src/sim/columns';
import { MotionCarry, Playout } from '../src/game/playout';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/** a small deterministic random */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface E {
  id: number;
  space: number;
  x: number;
  y: number;
  px: number;
  py: number;
  h: number;
  ph: number;
}

const V = 0.8; // mm per tick (a worker ant: 16 mm/s)
const W = 0.06; // rad per tick (a steady turn)

/** The worker's state after tick k: A walks straight, B turns, C walks and is teleported at tick 300. */
function worldAt(k: number): E[] {
  const cx = (t: number) => (t >= 300 ? 400 : 0) + t * V;
  return [
    { id: 1, space: 0, x: k * V, y: 0, px: (k - 1) * V, py: 0, h: 0, ph: 0 },
    { id: 2, space: 0, x: 50 + Math.cos(k * W) * 30, y: Math.sin(k * W) * 30, px: 50 + Math.cos((k - 1) * W) * 30, py: Math.sin((k - 1) * W) * 30, h: k * W + Math.PI / 2, ph: (k - 1) * W + Math.PI / 2 },
    // (the sim snaps px on a teleport: tunnels.ts, titanDig.ts)
    { id: 3, space: 0, x: cx(k), y: 5, px: k === 300 ? cx(k) : cx(k - 1), py: 5, h: 0, ph: 0 },
  ];
}

interface Run {
  /** per rendered frame after the warm-up: the step of A over its true speed */
  ratios: number[];
  /** heading steps of B over its true turn rate */
  turn: number[];
  /** C's drawn x around its teleport */
  cx: Array<[number, number]>;
  /** A's drawn x and the newest tick's x while paused */
  pause: Array<{ drawn: number; newest: number }>;
  extrapolated: number;
  latency: number;
}

/**
 * hz: display rate; cost(n): the worker's time for a step of n ticks (ms); pauseAt: a pause from this time for 1 s;
 * old: the old arrival-based α instead of the playout clock.
 */
function simulate(hz: number, cost: (n: number) => number, opts: { secs?: number; pauseAt?: number; old?: boolean; seed?: number } = {}): Run {
  const secs = opts.secs ?? 30;
  const writer = new ColumnWriter();
  const reader = new ColumnReader<E>();
  const playout = new Playout();
  const carry = new MotionCarry();
  let list = reader.read(writer.write(worldAt(0)));
  playout.reanchor = (a) => {
    const c = new MotionCarry();
    c.alpha = a;
    c.snap = false;
    for (const o of list) {
      c.save(o);
      c.restore(o);
    }
  };
  let replicaTick = 0;
  // the worker
  let workerTick = 0;
  let inFlight = 0;
  let queued = 0;
  let due = 0;
  const arrivals: Array<{ at: number; ran: number }> = [];
  const pump = (now: number) => {
    if (inFlight > 0 || queued <= 0) return;
    inFlight = queued;
    queued = 0;
    arrivals.push({ at: now + cost(inFlight), ran: inFlight });
  };
  // the old α
  let lastFrameAt = 0;
  let gap = 50;
  const R = rng(opts.seed ?? 7);
  let acc = 0;
  let paused = false;
  const out: Run = { ratios: [], turn: [], cx: [], pause: [], extrapolated: 0, latency: 0 };
  let prevA = NaN;
  let prevH = NaN;
  let prevNow = 0;
  const frameMs = 1000 / hz;
  for (let now = 0; now < secs * 1000; now += frameMs * (0.97 + R() * 0.06)) {
    // the worker's frames that came before this animation frame
    arrivals.sort((a, b) => a.at - b.at);
    while (arrivals.length && arrivals[0].at <= now) {
      const f = arrivals.shift()!;
      workerTick += f.ran;
      const packet = writer.write(worldAt(workerTick));
      if (opts.old) {
        list = reader.read(packet);
        if (lastFrameAt > 0) gap = Math.min(250, Math.max(8, gap * 0.8 + (f.at - lastFrameAt) * 0.2));
        lastFrameAt = f.at;
      } else {
        carry.mode = 'drawn';
        carry.ran = f.ran;
        carry.alpha = playout.arrive(workerTick, replicaTick);
        list = reader.read(packet, carry);
      }
      replicaTick = workerTick;
      inFlight = 0;
      pump(f.at);
    }
    // the loop
    const dt = prevNow ? now - prevNow : 0;
    if (opts.pauseAt !== undefined) paused = now >= opts.pauseAt && now < opts.pauseAt + 1000;
    if (!paused) {
      acc += dt;
      while (acc >= 50) {
        acc -= 50;
        queued = Math.min(queued + 1, 24);
        due++;
        pump(now);
      }
    }
    let alpha: number;
    if (opts.old) alpha = paused || lastFrameAt === 0 ? 1 : Math.min(1, Math.max(0, (now - lastFrameAt) / gap));
    else alpha = playout.frame(due + (paused ? 1 : acc / 50), now, paused);
    if (alpha > 1) out.extrapolated++;
    const [a, b, c] = list;
    const ax = a.px + (a.x - a.px) * alpha;
    let dh = b.h - b.ph;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const bh = b.ph + dh * alpha;
    const cxd = c.px + (c.x - c.px) * alpha;
    if (now > 2000 && !paused && (opts.pauseAt === undefined || now > opts.pauseAt + 1500 || now < opts.pauseAt)) {
      out.ratios.push((ax - prevA) / ((V * dt) / 50));
      out.turn.push((bh - prevH) / ((W * dt) / 50));
    }
    if (replicaTick >= 295 && replicaTick <= 306) out.cx.push([replicaTick, cxd]);
    if (paused) out.pause.push({ drawn: ax, newest: a.x });
    prevA = ax;
    prevH = bh;
    prevNow = now;
  }
  out.latency = playout.latency;
  return out;
}

function stats(r: number[]): { worst: number; p99: number; freeze: number; jump: number } {
  const dev = r.map((x) => Math.abs(x - 1)).sort((a, b) => a - b);
  return {
    worst: dev[dev.length - 1] ?? 0,
    p99: dev[Math.floor(dev.length * 0.99)] ?? 0,
    freeze: r.filter((x) => x < 0.5).length / r.length,
    jump: r.filter((x) => x > 1.5).length / r.length,
  };
}
const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

/** a step of n ticks costs the sum of n ticks' own times */
const sum = (n: number, one: () => number) => {
  let t = 0;
  for (let i = 0; i < n; i++) t += one();
  return t;
};
const scenarios: Array<{ name: string; hz: number; cost: (n: number) => number; worst: number; freeze?: number }> = [];
{
  const r = rng(1);
  scenarios.push({ name: '60 Hz, worker 4–40 ms a tick (uneven arrivals)', hz: 60, cost: (n) => sum(n, () => 4 + r() * 36), worst: 0.2 });
}
{
  const r = rng(2);
  scenarios.push({ name: '144 Hz, worker 4–40 ms a tick', hz: 144, cost: (n) => sum(n, () => 4 + r() * 36), worst: 0.2 });
}
{
  const r = rng(3);
  // a busy worker: 15–70 ms a tick (85 % of its time: it keeps up on average), so two or three ticks often come in
  // one frame and now and then the newest tick is 4–5 behind the loop's clock (the units ease off for those)
  scenarios.push({ name: '60 Hz, busy worker 15–70 ms a tick (batches of 2–3)', hz: 60, cost: (n) => sum(n, () => 15 + r() * 55), worst: 1, freeze: 0.015 });
}
{
  const r = rng(4);
  // hitches: mostly 8 ms, one tick in 40 takes 120 ms
  // (a rare hitch is not worth a permanent delay: the units stop for it — a few frames — and then catch up at a
  // tenth over their pace, without a jump)
  scenarios.push({ name: '120 Hz, worker 8 ms with a 120 ms hitch now and then', hz: 120, cost: (n) => sum(n, () => (r() < 0.025 ? 120 : 8)), worst: 1, freeze: 0.03 });
}

for (const sc of scenarios) {
  const now = simulate(sc.hz, sc.cost);
  const old = simulate(sc.hz, sc.cost, { old: true });
  const a = stats(now.ratios);
  const o = stats(old.ratios);
  const t = stats(now.turn);
  console.log(
    `      ${sc.name}: step / true speed — p99 off by ${f2(a.p99)}, worst ${f2(a.worst)}, frozen ${pct(a.freeze)}, jumped ${pct(a.jump)}, extrapolated ${pct(now.extrapolated / (now.ratios.length || 1))}, latency ${f2(now.latency)} ticks` +
      `  ·  old α: p99 off by ${f2(o.p99)}, worst ${f2(o.worst)}, frozen ${pct(o.freeze)}, jumped ${pct(o.jump)}`,
  );
  const fz = sc.freeze ?? 0;
  if (fz === 0) check(`${sc.name}: no frozen or jumping frames (steps within ${sc.worst} of the true speed at p99)`, a.freeze === 0 && a.jump === 0 && a.p99 <= sc.worst, `p99 ${f2(a.p99)}`);
  else check(`${sc.name}: no jumps; stops only for the hitches (under ${pct(fz)} of frames)`, a.jump === 0 && a.freeze <= fz, `frozen ${pct(a.freeze)}`);
  check(`${sc.name}: smoother than the old α`, a.jump + a.freeze < (o.jump + o.freeze) * 0.5 && (fz > 0 || a.p99 < o.p99 * 0.5), `${f2(a.p99)} vs ${f2(o.p99)}`);
  check(`${sc.name}: a turn's heading is as smooth`, t.freeze <= fz && t.jump === 0 && (fz > 0 || t.p99 <= sc.worst), `p99 ${f2(t.p99)}`);
  // C: at the teleport the drawn x goes from under 300 ticks of travel to past 400 mm on in one frame (nothing between)
  const between = now.cx.filter(([, x]) => x > 300 * V + 2 && x < 400 + 298 * V);
  check(`${sc.name}: a teleport snaps (nothing drawn on the way)`, between.length === 0, between.length ? `${between.length} frames between` : '');
}

{
  const r = rng(5);
  const p = simulate(60, (n) => sum(n, () => 4 + r() * 30), { pauseAt: 10000, secs: 14 });
  const last = p.pause[p.pause.length - 1];
  const over = Math.max(...p.pause.map((q) => q.drawn - q.newest));
  check('paused: the units glide to the newest tick and stop there (no extrapolation past it)', !!last && Math.abs(last.drawn - last.newest) < 1e-6 && over <= 1e-6, last ? `ends ${f2(last.drawn - last.newest)} mm from it` : 'no pause');
  const pr = stats(p.ratios);
  check('paused and resumed: no jump after the pause', pr.jump === 0, `jumped ${pct(pr.jump)}`);
}

if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
