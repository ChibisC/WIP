/**
 * Performance pass (CHANGE_PLAN §25): the optimizations that touch data must leave it exactly as it was.
 *  - The slow state goes as deltas (worker/slowDelta.ts): a replica that merges each frame's delta over its copy ends
 *    up identical to the simulation's state, tick after tick, in a busy 4-colony match (tiles built, upgraded and
 *    deleted, AI plans, fields that appear and disappear); and the deltas are much smaller than the whole state.
 *  - The fingerprint tells apart values that differ (numbers, -0, NaN, strings, key order, typed arrays, nesting).
 *  - The frame cap holds 30 and 60 on a 120 Hz clock and never skips at 60 on a 60 Hz one.
 *
 *   npx vite-node tests/performance.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { SlowDelta, fingerprint } from '../src/worker/slowDelta';
import { GameLoop } from '../src/core/loop';
import { frameCapOf, sanitizeSettings } from '../src/game/profile';

const t0 = Date.now();
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ---- the fingerprint
{
  const pairs: Array<[unknown, unknown]> = [
    [1, 2],
    [0, -0],
    [NaN, 0],
    ['ab', 'ba'],
    [{ a: 1, b: 2 }, { a: 2, b: 1 }],
    [[1, [2]], [[1], 2]],
    [new Float32Array([1, 2]), new Float32Array([1, 3])],
    [null, undefined],
    [{ a: undefined }, {}],
    [[], {}],
    [true, false],
    [{ t: [{ q: 1, wait: 0.05 }] }, { t: [{ q: 1, wait: 0.1 }] }],
  ];
  check('fingerprint: different values give different fingerprints', pairs.every(([a, b]) => fingerprint(a) !== fingerprint(b)));
  check('fingerprint: equal values give the same one', fingerprint({ a: [1, 'x', { b: null }] }) === fingerprint({ a: [1, 'x', { b: null }] }));
}

// ---- deltas rebuild the state exactly
{
  const w = createWorld({ seed: 4, style: 'meadow', width: 100, depth: 100, map: 'meadowPond', colonies: (['lasius', 'formica', 'atta', 'termant'] as const).map((species, k) => ({ species, player: k === 0, ai: true })), food: 1.2, settings: { creatures: 1 } } as never, new EventBus());
  for (let i = 0; i < 20 * 60; i++) w.step(0.05);
  const s = w.s;
  const d = new SlowDelta();
  // the replica's copy starts from a clone (as the main thread's does from the snapshot)
  const rep = { colonies: structuredClone(s.colonies) as unknown as Array<Record<string, unknown>>, caves: s.caves, aphids: s.aphids, plants: s.plants };
  let full = 0;
  let sent = 0;
  let worst = 0;
  let same = true;
  let firstBad = '';
  for (let i = 0; i < 20 * 120; i++) {
    w.step(0.05);
    const delta = structuredClone({ colonies: d.colonyDelta(s.colonies), caves: d.part('caves', s.caves), aphids: d.part('aphids', s.aphids), plants: d.part('plants', s.plants) });
    for (const c of delta.colonies) {
      const ex = rep.colonies.find((x) => x.id === c.id);
      if (ex) Object.assign(ex, c);
      else rep.colonies.push(c as never);
    }
    if (delta.caves) rep.caves = delta.caves;
    if (delta.aphids) rep.aphids = delta.aphids;
    if (delta.plants) rep.plants = delta.plants;
    const a = JSON.stringify({ c: s.colonies, v: s.caves, p: s.aphids, l: s.plants });
    const b = JSON.stringify({ c: rep.colonies, v: rep.caves, p: rep.aphids, l: rep.plants });
    if (i > 0) {
      full += a.length;
      const n = JSON.stringify(delta).length;
      sent += n;
      worst = Math.max(worst, n);
    }
    if (a !== b && same) {
      same = false;
      firstBad = `tick ${s.tick}`;
    }
  }
  check('slow-state deltas: the replica matches the simulation after every one of 2,400 ticks', same, firstBad);
  check('slow-state deltas: a quarter or less of the whole state on average', sent < full * 0.25, `${((sent / full) * 100).toFixed(1)} % of ${(full / 2400 / 1024).toFixed(1)} KB a frame (largest delta ${(worst / 1024).toFixed(1)} KB)`);
}

// ---- the frame cap
{
  const run = (cap: number, hz: number) => {
    let frames = 0;
    const loop = new GameLoop({ tick: () => {}, frame: () => frames++ });
    loop.frameCap = cap;
    // drive start()'s rAF callback by hand on a hz clock with ±0.6 ms jitter, for 10 s
    const cbs: Array<(t: number) => void> = [];
    const g = globalThis as unknown as { requestAnimationFrame: (f: (t: number) => void) => number; cancelAnimationFrame: () => void; performance: Performance };
    const raf0 = g.requestAnimationFrame;
    const caf0 = g.cancelAnimationFrame;
    g.requestAnimationFrame = (f) => (cbs.push(f), cbs.length);
    g.cancelAnimationFrame = () => {};
    loop.start();
    let jit = 1;
    for (let i = 1; i <= hz * 10; i++) {
      const f = cbs.shift();
      jit = (jit * 16807) % 2147483647;
      f?.(1000 + (i * 1000) / hz + ((jit / 2147483647) * 1.2 - 0.6));
    }
    loop.stop();
    g.requestAnimationFrame = raf0;
    g.cancelAnimationFrame = caf0;
    return frames / 10;
  };
  const a = run(60, 120);
  const b = run(30, 120);
  const c = run(60, 60);
  const e = run(0, 120);
  check('frame cap: 60 on a 120 Hz screen', Math.abs(a - 60) <= 1, `${a} fps`);
  check('frame cap: 30 on a 120 Hz screen', Math.abs(b - 30) <= 1, `${b} fps`);
  check('frame cap: 60 on a 60 Hz screen skips nothing', c >= 59.5, `${c} fps`);
  check('frame cap: off follows the screen', e >= 119.5, `${e} fps`);
  check('frame cap: the setting is kept (0, 30, 60) and anything else dropped', sanitizeSettings({ frameCap: 30 } as never).frameCap === 30 && sanitizeSettings({ frameCap: 45 } as never).frameCap === undefined);
  check('frame cap: an explicit setting wins', frameCapOf({ ...sanitizeSettings(null), frameCap: 0 }) === 0);
  check('camera shake setting survives a reload (it was dropped before)', sanitizeSettings({ shake: 0.5 } as never).shake === 0.5);
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
