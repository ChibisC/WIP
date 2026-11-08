/**
 * Performance pass (CHANGE_PLAN §25): the optimizations that touch data must leave it exactly as it was.
 *  - The slow state goes as deltas (worker/slowDelta.ts): a replica that merges each frame's delta over its copy ends
 *    up identical to the simulation's state, tick after tick, in a busy 4-colony match (tiles built, upgraded and
 *    deleted, AI plans, fields that appear and disappear); and the deltas are much smaller than the whole state.
 *  - The fingerprint tells apart values that differ (numbers, -0, NaN, strings, key order, typed arrays, nesting).
 *  - The LOD cross-fade rides in aE.z with "exhausted" (the ant shader has no vertex attribute left): both unpack
 *    as the shader unpacks them.
 *  - The nest terrain's signed distance (its faster blur) is the same to the bit as the plain loop's, and faster; an
 *    area kept current in slices ends with the mesh a full rebuild gives.
 *  - The frame cap holds 30 and 60 on a 120 Hz clock and never skips at 60 on a 60 Hz one.
 *  - Performance v2: the entity columns as deltas (unchanged columns left out), read by the generated reader or the
 *    plain one, leave the replica's ants exactly as the simulation's.
 *
 *   npx vite-node tests/performance.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { SlowDelta, fingerprint } from '../src/worker/slowDelta';
import { GameLoop } from '../src/core/loop';
import { frameCapOf, sanitizeSettings } from '../src/game/profile';
import { packExhaustedFade } from '../src/render/ants/antMaterial';
import { NestTerrain } from '../src/render/nest/nestTerrain';
import { SOIL_AIR } from '../src/world/nestGrid';
import { createStressWorld } from '../src/dev/stressScene';
import { ColumnReader, ColumnWriter, columnCodegen } from '../src/sim/columns';
import { antShape } from '../src/sim/factory';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';

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

// ---- aE.z: exhausted and the LOD fade, unpacked as the shader does (antMaterial.ts lodFadeOf)
{
  const unpack = (z: number) => {
    const f32 = Math.fround(z);
    const fe = Math.floor(f32 / 256);
    return { exh: (f32 - 256 * fe) / 255, fade: fe < 0.5 ? 0 : fe < 256.5 ? fe / 256 : (256 - fe) / 256 };
  };
  // what a fade draws: the pixels whose noise n (0..1) it keeps
  const keeps = (f: number, n: number) => (f === 0 ? true : f > 0 ? n < f : n >= -f);
  let worstE = 0;
  let worstF = 0;
  for (const exh of [0, 0.1, 0.37, 0.5, 0.99, 1]) {
    for (const fade of [0, 0.001, 0.2, 0.5, 0.999, 1, -0.001, -0.2, -0.5, -0.999, -1]) {
      const u = unpack(packExhaustedFade(exh, fade));
      worstE = Math.max(worstE, Math.abs(u.exh - exh));
      // the share of pixels drawn differently from the exact fade
      let diff = 0;
      for (let i = 0; i < 4096; i++) if (keeps(u.fade, (i + 0.5) / 4096) !== keeps(fade, (i + 0.5) / 4096)) diff++;
      worstF = Math.max(worstF, diff / 4096);
    }
  }
  check('aE.z packing: exhausted within 1/500; the fade draws the same pixels but for 1/256 of them', worstE <= 1 / 500 && worstF <= 1 / 256 + 1 / 4096, `exhausted ±${worstE.toFixed(4)}, pixels ${(worstF * 100).toFixed(2)} %`);
  check('aE.z packing: no fade unpacks as the whole model', unpack(packExhaustedFade(0.4, 0)).fade === 0);
}

// ---- the nest terrain's signed distance: the faster blur gives the old result to the bit
{
  // the plain implementation from before the performance pass
  const chamferRef = (d: Float32Array, W: number, H: number) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        let v = d[k];
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, d[k - 1] + 1);
        if (y > 0) {
          v = Math.min(v, d[k - W] + 1);
          if (x > 0) v = Math.min(v, d[k - W - 1] + Math.SQRT2);
          if (x < W - 1) v = Math.min(v, d[k - W + 1] + Math.SQRT2);
        }
        d[k] = v;
      }
    for (let y = H - 1; y >= 0; y--)
      for (let x = W - 1; x >= 0; x--) {
        const k = y * W + x;
        let v = d[k];
        if (v === 0) continue;
        if (x < W - 1) v = Math.min(v, d[k + 1] + 1);
        if (y < H - 1) {
          v = Math.min(v, d[k + W] + 1);
          if (x < W - 1) v = Math.min(v, d[k + W + 1] + Math.SQRT2);
          if (x > 0) v = Math.min(v, d[k + W - 1] + Math.SQRT2);
        }
        d[k] = v;
      }
  };
  const sdRef = (soil: Uint8Array | number[], W: number, H: number) => {
    const sd = new Float32Array(W * H);
    const dA = new Float32Array(W * H);
    const dS = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) {
      const air = soil[k] === SOIL_AIR;
      dA[k] = air ? 1e6 : 0;
      dS[k] = air ? 0 : 1e6;
      const x = k % W;
      const y = (k - x) / W;
      if (air && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) dA[k] = 0.5;
    }
    chamferRef(dA, W, H);
    chamferRef(dS, W, H);
    for (let k = 0; k < W * H; k++) sd[k] = soil[k] === SOIL_AIR ? dA[k] - 0.5 : -(dS[k] - 0.5);
    const tmp = new Float32Array(W * H);
    for (let pass = 0; pass < 7; pass++) {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let sum = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              const wgt = dx === 0 && dy === 0 ? 2 : 1;
              sum += sd[yy * W + xx] * wgt;
              n += wgt;
            }
          tmp[y * W + x] = sum / n;
        }
      sd.set(tmp);
    }
    return sd;
  };
  const w = createWorld({ seed: 4, style: 'meadow', width: 100, depth: 100, map: 'meadowPond', colonies: [{ species: 'lasius', player: true, ai: true }, { species: 'formica', player: false, ai: true }], food: 1.2, settings: {} } as never, new EventBus());
  for (let i = 0; i < 20 * 120; i++) w.step(0.05);
  let same = true;
  let tNew = 0;
  let tOld = 0;
  for (const sp of [1, 2]) {
    const g = w.nestOf(sp)!;
    const nt = new NestTerrain(g) as unknown as { computeSignedDistance(): void; sd: Float32Array };
    for (let r = 0; r < 3; r++) {
      let a = performance.now();
      nt.computeSignedDistance();
      tNew += performance.now() - a;
      a = performance.now();
      const ref = sdRef(g.soil as unknown as Uint8Array, g.w, g.h);
      tOld += performance.now() - a;
      for (let k = 0; k < ref.length; k++) if (!Object.is(ref[k], nt.sd[k])) same = false;
    }
  }
  check('nest terrain: the signed distance is the old one to the bit, in less time', same && tNew < tOld, `${(tNew / 6).toFixed(1)} ms against ${(tOld / 6).toFixed(1)} ms`);

  // an area kept current in slices (budget 3 ms a call) ends up with the very mesh a full rebuild gives
  {
    const g = w.nestOf(1)!;
    const bg = new NestTerrain(g) as unknown as { update(f?: boolean, b?: number): void; chunks: Map<number, { geometry: { attributes: Record<string, { array: ArrayLike<number> }> } }>; dirty: number };
    bg.update(true);
    // dig a tunnel across the nest, a cell at a time (as ants do), then let the slices catch up
    let calls = 0;
    for (let i = 0; i < 400; i++) {
      g.carve(Math.floor(g.w * 0.2) + (i % 120), Math.floor(g.h * 0.5) + Math.floor(i / 120));
      if (i % 25 === 0) {
        bg.update(false, 3);
        calls++;
      }
    }
    let slicesMax = 0;
    while (bg.dirty) {
      const a = performance.now();
      bg.update(false, 3);
      slicesMax = Math.max(slicesMax, performance.now() - a);
      calls++;
    }
    const full = new NestTerrain(g) as unknown as typeof bg;
    full.update(true);
    let equal = bg.chunks.size === full.chunks.size;
    for (const [ci, m] of full.chunks) {
      const o = bg.chunks.get(ci);
      if (!o) {
        equal = false;
        continue;
      }
      for (const name of ['position', 'normal']) {
        const A = m.geometry.attributes[name]?.array;
        const B = o.geometry.attributes[name]?.array;
        if (!A || !B || A.length !== B.length) equal = false;
        else for (let k = 0; k < A.length; k++) if (!Object.is(A[k], B[k])) equal = false;
      }
    }
    check('nest terrain: kept current in 3 ms slices, an area ends with the same mesh as a full rebuild', equal, `${calls} slices, the longest ${slicesMax.toFixed(1)} ms`);
  }
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

// ---- the entity columns as deltas, read by the generated reader (performance v2: sim/columns.ts)
{
  const w = createStressWorld(new EventBus(), 60, 20);
  for (let i = 0; i < 20; i++) {
    w.step(0.05);
    w.events.drain();
  }
  const can = columnCodegen.on;
  for (const gen of can ? [true, false] : [false]) {
    columnCodegen.on = gen;
    const wr = new ColumnWriter();
    const rd = new ColumnReader<{ id: number }>();
    let bad = '';
    let omitted = 0;
    let sent = 0;
    for (let f = 0; f < 120 && !bad; f++) {
      if (f > 0) {
        w.step(0.05);
        w.events.drain();
      }
      const p = wr.write(w.s.ants, null, undefined, true);
      if (p.omit) omitted += p.omit.reduce((a, b) => a + b, 0);
      sent += p.keys.length;
      const list = rd.read(p);
      // every field of every ant as the simulation has it (absent fields absent)
      if (list.length !== w.s.ants.length) bad = `frame ${f}: ${list.length} of ${w.s.ants.length}`;
      for (let i = 0; i < list.length && !bad; i++) {
        const a = w.s.ants[i] as unknown as Record<string, unknown>;
        const r = list[i] as unknown as Record<string, unknown>;
        for (const k of Object.keys(a)) {
          const x = a[k];
          if (x === undefined || (typeof x === 'object' && x !== null)) continue;
          const y = r[k];
          if (x !== y && !(Number.isNaN(x as number) && Number.isNaN(y as number))) bad = `frame ${f}, ant ${a.id}: ${k} ${String(x)} vs ${String(y)}`;
        }
        for (const k of Object.keys(r)) if (a[k] === undefined && r[k] !== undefined) bad = `frame ${f}, ant ${a.id}: ${k} should be absent`;
      }
    }
    check(`entity columns: delta frames (${gen ? 'generated' : 'plain'} reader) leave the replica's ants exactly as the simulation's, 120 ticks of a fight`, !bad, bad || `${((omitted / sent) * 100).toFixed(0)} % of the columns left out`);
  }
  columnCodegen.on = can;
}

// ---- one object shape for every ant (performance v3: sim/factory.ts antShape)
{
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(p: URL, enc: string): string };
  const src = fs.readFileSync(new URL('../src/sim/types.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export interface Ant {'), src.indexOf('\n}\n', src.indexOf('export interface Ant {')));
  const declared = [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1]);
  const shape = Object.keys(antShape());
  const missing = declared.filter((k) => !shape.includes(k));
  check('ant shape: every field of the Ant interface is in antShape (a new field must be added there)', missing.length === 0 && shape.length === declared.length, missing.join(', ') || `${shape.length} fields`);
  const w = createStressWorld(new EventBus(), 20, 5);
  for (let i = 0; i < 40; i++) {
    w.step(0.05);
    w.events.drain();
  }
  const w2 = restoreWorld(encodeState(w), new EventBus());
  const bad = w2.s.ants.filter((a) => Object.keys(a).slice(0, shape.length).join() !== shape.join());
  check('ant shape: restored ants have the fields in the same order as new ones', bad.length === 0 && w2.s.ants.length === w.s.ants.length, `${bad.length} of ${w2.s.ants.length}`);
  check('ant shape: the restored state hashes as the original', hashState(w) === hashState(w2));
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
