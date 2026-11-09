/**
 * `?bench=1`: the benchmark (performance pass, claude/performance/01-spec-performance-no-visual-loss.md §1). A fixed,
 * deterministic run through the game's heaviest moments, one page load per scene (so loading is measured too), then
 * a report to copy and paste back:
 *
 *  1. switching — surface → home nest → every other area → surface, ten times, every frame of every switch recorded;
 *  2. a big fight — four colonies of 200 at the middle of the map, 100 creatures and two titans;
 *  3. a full nest — the same world, looking round a crowded home nest;
 *  4. a story night — The Long Nights at dusk before its last, longest night (lairs, hunters, the tarantula);
 *  5. the battle arena with 600 units;
 *  6. a multiplayer-sized world — four colonies on an authored map, the camera touring the surface.
 *  0. first, *feel* (claude/performance/02-spec §1): real pointer and key events dispatched on the page every 0.4 s —
 *     camera drags and wheel turns, clicks on ants, orders (a marker placed, a group sent), then in the home nest digs
 *     and tiles — timed from each event to the frame that shows it and to the units acting (core/feel.ts).
 *
 * Each scene: a warm-up, then a camera tour of a fixed path for `bsecs` seconds (default 20) while the profiler
 * (core/profiler.ts) records every frame. Results live in sessionStorage between the page loads; `?bench=1&bdone=1`
 * shows the report (also left in `window.__bench` and the console for the browser test).
 */
import * as THREE from 'three';
import type { GameSession } from '../game/session';
import { prof } from '../core/profiler';
import { feel, FeelSummary } from '../core/feel';
import { BUILD_ID } from '../net/messages';
import { AS, SURFACE } from '../sim/types';
import { shapeBox } from '../world/mapShapes';
import { display, probeDisplay } from '../core/display';
import { GpuBreakdown, measureGpu } from './gpuBreakdown';

interface SceneDef {
  id: string;
  title: string;
  /** the page's query for this scene (bench=1 and bscene are added) */
  query: string;
}

export const BENCH_SCENES: SceneDef[] = [
  { id: 'feel', title: 'Feel: clicks, orders, digging, building and the camera (scripted inputs)', query: 'play=1&seed=11&species=lasius&rival=solenopsis&developed=6&nocine=1&reveal=1' },
  { id: 'gpu', title: 'What each effect costs: the big fight at the default zoom, one effect off at a time', query: 'stress=1&ants=200&creatures=100&bosses=2' },
  { id: 'switch', title: 'Switching surface ↔ underground', query: 'play=1&seed=11&areas=1&species=lasius&rival=solenopsis&reveal=1&developed=6&nocine=1' },
  { id: 'fight', title: 'Big fight (4 × 200 ants, 100 creatures, 2 titans)', query: 'stress=1&ants=200&creatures=100&bosses=2' },
  { id: 'nest', title: 'Full nest', query: 'stress=1&ants=200&creatures=40&view=nest' },
  { id: 'story', title: 'Story: The Long Nights, last night', query: 'story=longNights&diff=normal&night=3&nocine=1&seed=7' },
  { id: 'arena', title: 'Battle arena, 600 units', query: 'play=1&mode=arena&teams=2&seed=4' },
  { id: 'mp4', title: 'Multiplayer-sized world (4 colonies, authored map)', query: 'play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1' },
  { id: 'speed', title: 'Game speed: the big fight at 1×, 2×, 4× and 8×', query: 'stress=1&ants=200&creatures=100&bosses=2' },
  { id: 'cine', title: 'Story cutscene: the opening flight of The Antlered King', query: 'story=antleredKing&diff=normal&seed=7' },
  { id: 'trees', title: 'Trees layer on: the multiplayer-sized world, the ground, then up into the canopy', query: 'play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1&trees=1' },
  { id: 'flood', title: 'A flood rising and draining on Meadow Pond (what it costs to draw: five steps up, five down)', query: 'play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1' },
];

const KEY = 'ud-bench';

interface SceneResult {
  id: string;
  title: string;
  /** page start to the session's first frame (ms) */
  loadMs: number;
  /** of which the pre-warm (ms) */
  prewarmMs: number;
  secs: number;
  frames: number;
  fps: number;
  frameAvg: number;
  p95: number;
  worst: number;
  over33: number;
  over50: number;
  cpuAvg: number;
  parts: Record<string, number>;
  gpuAvg: number | null;
  calls: number;
  tris: number;
  programs: number;
  textures: number;
  geometries: number;
  heapMB: number;
  /** GPU memory, estimated (MB) */
  gpuMB: number;
  /** of which textures, render buffers (the multisampled targets), vertex and index buffers (MB; performance v5) */
  gpuParts?: { tex: number; rb: number; buf: number };
  tickMs: number;
  msgKB: number;
  glLinks: number;
  glUploads: number;
  quality: string;
  ants: number;
  creatures: number;
  hitches: string[];
  switch?: SwitchResult;
  /** the GPU breakdown scene's steps (performance v3) */
  gpuSteps?: GpuStep[];
  speedSteps?: SpeedStep[];
  /** the cutscene scene: how long the shot ran (s), and whether it ended before the time limit */
  cine?: { secs: number; ended: boolean };
  /** latency and pacing (core/feel.ts) */
  feel?: FeelSummary;
  /** the named pieces of the frame with the most time (performance v5: the UI's panels, the nest mesh's steps) */
  subs?: Array<{ name: string; avg: number; worst: number }>;
  /** where the GPU's time goes, pass by pass (performance v5, dev/gpuBreakdown.ts) */
  gpu?: GpuBreakdown;
}

/** the scenes that end with the GPU breakdown (a second or two of frames with every pass waited for) */
const GPU_BREAKDOWN = new Set(['feel', 'fight', 'nest', 'arena', 'mp4', 'trees', 'story']);

interface SwitchStep {
  kind: 'dive in' | 'area' | 'dive out';
  round: number;
  frames: number;
  worst: number;
  over33: number;
  over50: number;
  causes: string[];
}

interface SwitchResult {
  rounds: number;
  steps: SwitchStep[];
  /** the renderer's counts at the end of each round */
  counts?: Array<{ textures: number; geometries: number; programs: number; gpuMB: number }>;
}

interface BenchState {
  started: number;
  quality: string;
  secs: number;
  /** switching test rounds */
  rounds: number;
  results: SceneResult[];
  /** run only these scenes (`?bonly=feel,fight`), else all */
  only?: string[];
  /** the display's rate on the start screen (performance v5: Low Power Mode holds Safari to 30 Hz) */
  display?: { hz: number; capped: boolean };
}

function load(): BenchState | null {
  try {
    const s = sessionStorage.getItem(KEY);
    return s ? (JSON.parse(s) as BenchState) : null;
  } catch {
    return null;
  }
}

function save(st: BenchState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    // private mode: the run cannot go on across page loads
  }
}

function go(params: string): void {
  location.href = `${location.pathname}?${params}`;
}

function sceneUrl(i: number, st: BenchState): string {
  return `${BENCH_SCENES[i].query}&bench=1&bscene=${i}&q=${st.quality}&bsecs=${st.secs}&brounds=${st.rounds}`;
}

/** `?bench=1` without a scene: the start screen, or (bdone) the report. */
export function startBench(ui: HTMLElement, q: URLSearchParams): void {
  if (q.get('bdone')) return showReport(ui);
  const only = q.get('bonly')?.split(',').filter((id) => BENCH_SCENES.some((d) => d.id === id));
  const st: BenchState = { started: Date.now(), quality: q.get('q') || 'high', secs: Number(q.get('bsecs') || 20), rounds: Number(q.get('brounds') || 10), results: [], only: only?.length ? only : undefined };
  const box = panel(ui);
  box.innerHTML = `<h2>Benchmark</h2><p>${BENCH_SCENES.length} scenes, about ${Math.round((BENCH_SCENES.length * (st.secs + 12) + 60) / 60)} minutes at <b>${st.quality}</b> quality. Each one loads, warms up, then flies the camera along a fixed path while every frame is timed. Leave the mouse and keyboard alone until the report appears; keep this tab in front.</p><p>Starting in 3 s…</p>`;
  save(st);
  // the display's rate while this screen is idle (core/display.ts)
  void probeDisplay(1500).then((hz) => {
    st.display = { hz, capped: display.capped };
    save(st);
  });
  setTimeout(() => go(sceneUrl(nextScene(st, -1), st)), 3000);
}

/** The scene after scene i (−1: the first) that this run includes; −1 when none is left. */
function nextScene(st: BenchState, i: number): number {
  for (let k = i + 1; k < BENCH_SCENES.length; k++) if (!st.only || st.only.includes(BENCH_SCENES[k].id)) return k;
  return -1;
}

function panel(ui: HTMLElement): HTMLElement {
  const box = document.createElement('div');
  box.className = 'bench-panel';
  box.style.cssText = 'position:fixed;inset:6vh 8vw;overflow:auto;background:rgba(14,10,7,0.95);color:#e8dcc0;font:14px/1.5 system-ui,sans-serif;padding:20px 24px;border:1px solid #8a6a3a;border-radius:6px;z-index:100';
  ui.appendChild(box);
  return box;
}

/** Device facts for the report. */
function device(): string {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  let gpu = 'unknown GPU';
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }
  return `${navigator.userAgent}\nGPU ${gpu}; ${navigator.hardwareConcurrency || '?'} cores; screen ${screen.width}×${screen.height} at ${devicePixelRatio}× (window ${innerWidth}×${innerHeight})`;
}

/** Run this page's scene in the session that was just started, then move on. */
export function runBenchScene(s: GameSession, q: URLSearchParams): void {
  const st = load();
  const i = Number(q.get('bscene'));
  if (!st || !(i >= 0 && i < BENCH_SCENES.length)) return;
  const def = BENCH_SCENES[i];
  const loadMs = performance.now();
  if (st.display?.hz) Object.assign(display, { hz: st.display.hz, ms: 1000 / st.display.hz, capped: st.display.capped });
  (window as unknown as { __prof: unknown }).__prof = prof;
  const secs = Number(q.get('bsecs') || st.secs);
  const v = s.view;
  s.autoQuality.enabled = false;
  // (measured uncapped: the frame cap would hide what the device can do)
  s.loop.frameCap = 0;
  const finish = (sw?: SwitchResult, gpuSteps?: GpuStep[], extra?: Partial<SceneResult>) => {
    const r = collect(s, def, loadMs, secs, sw);
    if (gpuSteps) r.gpuSteps = gpuSteps;
    if (extra) Object.assign(r, extra);
    // (the scene's numbers are taken first: the breakdown's frames wait for the GPU and are slow on purpose)
    if (GPU_BREAKDOWN.has(def.id)) measureGpu(s, 20, (g) => save1({ ...r, gpu: g }));
    else save1(r);
  };
  const save1 = (r: SceneResult) => {
    st.results.push(r);
    save(st);
    console.log('[bench]', JSON.stringify(r));
    const nx = nextScene(st, i);
    if (nx >= 0) go(sceneUrl(nx, st));
    else go(`bench=1&bdone=1`);
  };
  // the camera tour: a slow orbit round a point, zooming in close, then out far, over `secs`
  const surf = v.surfaceRig;
  const w = s.world;
  let cx = w.terrain.width / 2;
  let cz = w.terrain.depth / 2;
  if (def.id === 'mp4' || def.id === 'switch') {
    const e = s.player.entrances[0];
    cx = e.sx;
    cz = e.sy;
  }
  if (def.id === 'arena') {
    // two armies of 300, both sides' strongest castes mixed in
    for (const [team, unit] of [
      [0, 'ant:formica_soldier'],
      [0, 'ant:formica_worker'],
      [0, 'ant:atta_major'],
      [1, 'ant:fire_soldier'],
      [1, 'ant:eciton_minor'],
      [1, 'ant:lasius_soldier'],
    ] as Array<[number, string]>)
      s.issue({ type: 'arenaSpawn', team, unit, n: 100, level: 1, at: false, x: 0, y: 0 } as never);
  }
  if (def.id === 'nest') {
    s.viewedArea = v.activeNest;
    v.space = 'nest';
    v.onSpaceChanged?.('nest');
  }
  // the flood scene: over the first flood zone, its water stepped up then down on the page's copy of the world (the
  // drawing's cost of a flood: the ground's wet band, the water mesh; the simulation is not flooded)
  const fz = def.id === 'flood' ? w.terrain.map?.floods[0] : undefined;
  if (fz) {
    const b = shapeBox(fz.shape, 0);
    cx = (b.x0 + b.x1) / 2;
    cz = (b.y0 + b.y1) / 2;
  }
  let floodStep = -1;
  const floodAt = (k: number) => {
    if (!fz) return;
    // ten steps over the scene's middle: up in five, down in five
    const step = Math.floor((k - 0.15) / 0.07);
    if (step < 0 || step > 10 || step === floodStep) return;
    floodStep = step;
    const up = step <= 5 ? step : 10 - step;
    w.terrain.setZoneFlood(0, up === 0 ? -9999 : fz.level - 3 * (1 - up / 5));
  };
  let treesUp = false;
  const tour = (k: number) => {
    // k: 0..1 through the scene
    const rig = v.space === 'nest' ? v.nestRig : surf;
    const ang = 0.6 + k * Math.PI * 1.5;
    const far = rig.maxDist * 0.6;
    const near = rig.minDist * (v.space === 'nest' ? 3 : 2) + 20;
    // in close for the middle third, then out far
    const d = k < 0.33 ? THREE.MathUtils.lerp(260, near, k / 0.33) : k < 0.66 ? near : THREE.MathUtils.lerp(near, far, (k - 0.66) / 0.34);
    rig.goalYaw = ang;
    rig.goalDistance = v.space === 'nest' ? Math.min(d, rig.maxDist * 0.5) : d;
    if (v.space === 'surface') surf.goal.set(cx + Math.cos(ang) * 30, surf.goal.y, cz + Math.sin(ang) * 30);
  };
  const t0 = performance.now();
  const warm = 3000;
  let reset = false;
  if (def.id === 'switch') return void runSwitching(s, () => finish(undefined), (sw) => finish(sw));
  if (def.id === 'feel') return void runFeel(s, secs, () => finish());
  if (def.id === 'gpu') return void runGpuSteps(s, cx, cz, (steps) => finish(undefined, steps));
  if (def.id === 'speed') return void runSpeedSteps(s, cx, cz, (steps) => finish(undefined, undefined, { speedSteps: steps }));
  if (def.id === 'cine') return void runCine(s, (c) => finish(undefined, undefined, { cine: c }));
  const loop = (t: number) => {
    const el = t - t0;
    if (el < warm) {
      tour(0);
      requestAnimationFrame(loop);
      return;
    }
    if (!reset) {
      reset = true;
      prof.reset();
      feel.reset();
    }
    const k = (el - warm) / (secs * 1000);
    tour(Math.min(1, k));
    floodAt(k);
    // the trees scene: half on the ground, then up into the canopy
    if (def.id === 'trees' && k >= 0.5 && !treesUp) {
      treesUp = true;
      s.toggleTrees();
    }
    if (k < 1) requestAnimationFrame(loop);
    else finish();
  };
  requestAnimationFrame(loop);
}

function collect(s: GameSession, def: SceneDef, loadMs: number, secs: number, sw?: SwitchResult): SceneResult {
  const f = prof.frameMs.summary();
  const c = prof.cpuMs.summary();
  const n = prof.counts();
  const parts: Record<string, number> = {};
  for (const p of prof.partNames()) parts[p] = +prof.parts[p].summary().avg.toFixed(2);
  const G = prof.glSince();
  // every frame the window held (the rolling window keeps the last 600)
  const arr = prof.frameMs;
  const over = (lim: number) => prof.hitches.filter((h) => h.ms > lim).length;
  return {
    id: def.id,
    title: def.title,
    loadMs: Math.round(loadMs),
    prewarmMs: Math.round(s.prewarmMs),
    secs,
    frames: arr.count,
    fps: +(1000 / Math.max(1, f.avg)).toFixed(1),
    frameAvg: +f.avg.toFixed(2),
    p95: +f.p95.toFixed(1),
    worst: +f.worst.toFixed(0),
    over33: over(33),
    over50: over(50),
    cpuAvg: +c.avg.toFixed(2),
    parts,
    gpuAvg: prof.gpuMs.count ? +prof.gpuMs.summary().avg.toFixed(2) : null,
    calls: n.calls,
    tris: n.triangles,
    programs: n.programs,
    textures: n.textures,
    geometries: n.geometries,
    heapMB: +n.heapMB.toFixed(0),
    gpuMB: +prof.gpuMB().toFixed(0),
    gpuParts: { tex: Math.round(prof.mem.tex / 1048576), rb: Math.round(prof.mem.rb / 1048576), buf: Math.round(prof.mem.buf / 1048576) },
    tickMs: +s.sim.tickMs.toFixed(2),
    msgKB: +(prof.msgBytesAvg / 1024).toFixed(0),
    glLinks: G.links,
    glUploads: G.texUploads,
    quality: s.view.quality,
    ants: s.world.s.ants.length,
    creatures: s.world.s.creatures.length,
    // the worst frames (in the order they came) with what was in them (v5: the first ones hid the long frames)
    hitches: prof.hitches
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10)
      .sort((a, b) => a.t - b.t)
      .map((h) => `${h.t.toFixed(1)} s ${h.ms.toFixed(0)} ms (main thread ${h.cpu.toFixed(0)}): ${h.causes.join('; ')}`),
    switch: sw,
    feel: feel.summary(),
    subs: prof.topSubs(8).map((x) => ({ name: x.name, avg: +x.avg.toFixed(2), worst: +x.worst.toFixed(0) })),
  };
}

/** One step of the GPU breakdown: the frame interval with one thing changed (performance v3). */
/** One game speed of the speed scene (performance v3). */
interface SpeedStep {
  speed: number;
  /** the speed the game actually ran at (ticks a second of real time ÷ 20) */
  reached: number;
  /** frame interval avg and p95 (ms), frames over 50 ms */
  avg: number;
  p95: number;
  over50: number;
  /** main thread a frame (ms), and its messages and events parts */
  cpu: number;
  msg: number;
  events: number;
  /** the simulation's tick (ms) */
  tickMs: number;
  /** frames from the simulation worker in the measured time, its ticks not answered at the end, the time (s) */
  msgs?: number;
  backlog?: number;
  secs?: number;
}

/**
 * Game speed under load (performance v3): the big fight at the default zoom, the camera still, at 1×, 2×, 4× and 8×
 * (2 s to settle, 4 s measured each): does the simulation keep up, and what the speed costs a frame.
 */
function runSpeedSteps(s: GameSession, cx: number, cz: number, done: (steps: SpeedStep[]) => void): void {
  const surf = s.view.surfaceRig;
  surf.goalYaw = 0.6;
  surf.goalDistance = 260;
  surf.goal.set(cx + Math.cos(0.6) * 30, surf.goal.y, cz + Math.sin(0.6) * 30);
  const speeds = [1, 2, 4, 8];
  const out: SpeedStep[] = [];
  const WARM = 3000;
  // each step settles for 2 s and is measured for 4 s — and for at least 8 and 15 frames (performance v5: one
  // 12-second frame after loading took a whole step, which then had no frames and a speed made up of page time)
  const SETTLE = 2000;
  const MEASURE = 4000;
  const CAP = 15000;
  let k = -1;
  let t0 = 0;
  let phase: 'settle' | 'measure' = 'settle';
  let n = 0;
  let last = 0;
  let times: number[] = [];
  let tick0 = 0;
  let tm0 = 0;
  let msgs0 = 0;
  const snap = () => ({ cpu: [prof.cpuMs.total, prof.cpuMs.pushes], msg: [prof.parts.msg.total, prof.parts.msg.pushes], ev: [prof.parts.events.total, prof.parts.events.pushes] });
  let p0 = snap();
  const per = (a: number[], b: number[]) => (b[1] - a[1] > 0 ? (b[0] - a[0]) / (b[1] - a[1]) : 0);
  const start = performance.now();
  const next = (t: number) => {
    k++;
    if (k >= speeds.length) {
      s.setSpeed(1);
      done(out);
      return false;
    }
    s.setSpeed(speeds[k]);
    t0 = t;
    phase = 'settle';
    n = 0;
    return true;
  };
  const loop = (t: number) => {
    if (t - start < WARM) {
      requestAnimationFrame(loop);
      return;
    }
    if (k < 0 && !next(t)) return;
    n++;
    if (phase === 'settle') {
      if ((t - t0 >= SETTLE && n >= 8) || t - t0 > CAP) {
        phase = 'measure';
        tick0 = s.world.s.tick;
        tm0 = t;
        msgs0 = prof.msgs;
        p0 = snap();
        times = [];
        last = t;
      }
    } else {
      times.push(t - last);
      last = t;
      if ((t - tm0 >= MEASURE && times.length >= 15) || t - tm0 > CAP) {
        const srt = times.slice().sort((a, b) => a - b);
        const p1 = snap();
        out.push({
          speed: speeds[k],
          reached: +((s.world.s.tick - tick0) / ((t - tm0) / 1000) / 20).toFixed(2),
          avg: +(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)).toFixed(1),
          p95: +(srt[Math.floor(srt.length * 0.95)] ?? 0).toFixed(1),
          over50: times.filter((x) => x > 50).length,
          cpu: +per(p0.cpu, p1.cpu).toFixed(2),
          msg: +per(p0.msg, p1.msg).toFixed(2),
          events: +per(p0.ev, p1.ev).toFixed(2),
          tickMs: +s.sim.tickMs.toFixed(1),
          msgs: prof.msgs - msgs0,
          backlog: (s.sim as unknown as { backlog?: number }).backlog ?? 0,
          secs: +((t - tm0) / 1000).toFixed(1),
        });
        if (!next(t)) return;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * A story cutscene (performance v3): the level's opening camera flight, measured from the first frame to the shot's
 * end (at most 40 s) — the frame times and the hitch log with their causes (new things coming into view: shader
 * links, texture uploads, model builds).
 */
function runCine(s: GameSession, done: (c: { secs: number; ended: boolean }) => void): void {
  // the level's own opening flight (it starts on the story's first ticks, a few seconds into a slow device's start):
  // measured from its first frame to the camera's return
  const begin = performance.now();
  let start = 0;
  const loop = (t: number) => {
    if (!start) {
      if (!s.cine) {
        if (t - begin > 30000) return done({ secs: 0, ended: false });
        return void requestAnimationFrame(loop);
      }
      prof.reset();
      feel.reset();
      start = t;
    }
    const el = (t - start) / 1000;
    if (!s.cine || el > 40) return done({ secs: +el.toFixed(1), ended: !s.cine });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

interface GpuStep {
  name: string;
  avg: number;
  p95: number;
  cpu: number;
  /** frames measured (a GPU too slow for a few frames in the window cannot be judged) */
  frames: number;
  /** the step's longest frame, settling included, and what was in it (performance v5) */
  worst?: number;
  why?: string;
}

/**
 * The GPU breakdown (performance v3): the big fight seen from the default zoom, the camera still, then every 3.7 s one
 * thing changed (each back as it was before the next): ambient occlusion off, bloom off, depth of field off, all post
 * effects off, shadows off, one device pixel per screen pixel, the ants hidden, the grass hidden, and everything off at
 * once. Each step's frame interval (after 1.2 s to settle: shadow toggles recompile) says what that thing costs on this
 * device; the main thread's time says whether it is the CPU's.
 */
function runGpuSteps(s: GameSession, cx: number, cz: number, done: (steps: GpuStep[]) => void): void {
  const v = s.view;
  const R = v.renderer;
  const surf = v.surfaceRig;
  surf.goalYaw = 0.6;
  surf.goalDistance = 260;
  surf.goal.set(cx + Math.cos(0.6) * 30, surf.goal.y, cz + Math.sin(0.6) * 30);
  const S = s as unknown as { surfAnts?: { group: THREE.Object3D }; surfCreatures?: { group: THREE.Object3D } };
  // (performance v5: the shadow map kept, not redrawn — turning shadows off recompiled every material twice, 83
  // shader links and seconds of stalls on Safari; what is measured is the shadow pass's own cost)
  const shadows = (on: boolean) => {
    R.shadowMap.autoUpdate = on;
    R.shadowMap.needsUpdate = false;
  };
  // (performance v5: the effects at one device pixel a screen pixel, upscaled to the canvas as the game does)
  const pixels = (one: boolean) => {
    v.pixelOverride = one ? 1 : null;
    v.resize();
  };
  const P = v.post.settings;
  const keep = { ao: P.ao, bloom: P.bloom, dof: P.dof, post: v.post.enabled };
  const steps: Array<{ name: string; on: () => void; off: () => void }> = [
    { name: 'as set', on: () => {}, off: () => {} },
    { name: 'ambient occlusion off', on: () => (P.ao = false), off: () => (P.ao = keep.ao) },
    { name: 'bloom off', on: () => (P.bloom = false), off: () => (P.bloom = keep.bloom) },
    { name: 'depth of field off', on: () => (P.dof = false), off: () => (P.dof = keep.dof) },
    { name: 'all post effects off', on: () => (v.post.bare = true), off: () => (v.post.bare = false) },
    { name: 'shadow maps not redrawn', on: () => shadows(false), off: () => shadows(true) },
    { name: '1 device pixel per screen pixel', on: () => pixels(true), off: () => pixels(false) },
    { name: 'ants hidden', on: () => S.surfAnts && (S.surfAnts.group.visible = false), off: () => S.surfAnts && (S.surfAnts.group.visible = true) },
    { name: 'grass hidden', on: () => v.grass && (v.grass.mesh.visible = false), off: () => v.grass && (v.grass.mesh.visible = true) },
    {
      name: 'all of these off',
      on: () => {
        v.post.bare = true;
        shadows(false);
        pixels(true);
        if (S.surfAnts) S.surfAnts.group.visible = false;
        if (v.grass) v.grass.mesh.visible = false;
      },
      off: () => {
        v.post.bare = false;
        shadows(true);
        pixels(false);
        if (S.surfAnts) S.surfAnts.group.visible = true;
        if (v.grass) v.grass.mesh.visible = true;
      },
    },
  ];
  const out: GpuStep[] = [];
  const WARM = 3000;
  const SETTLE = 1200;
  const MEASURE = 2500;
  let k = -1;
  let t0 = 0;
  let last = 0;
  let times: number[] = [];
  let cpu0 = 0;
  let frames0 = 0;
  let hitch0 = 0;
  const start = performance.now();
  const loop = (t: number) => {
    if (t - start < WARM) {
      requestAnimationFrame(loop);
      return;
    }
    if (k < 0 || t - t0 > SETTLE + MEASURE) {
      if (k >= 0) {
        const srt = times.slice().sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
        const cpuN = prof.cpuMs.pushes - frames0;
        const hs = prof.hitches.slice(hitch0).sort((a, b) => b.ms - a.ms)[0];
        out.push({ name: steps[k].name, avg: +avg.toFixed(1), p95: +(srt[Math.floor(srt.length * 0.95)] ?? 0).toFixed(1), cpu: +(cpuN > 0 ? (prof.cpuMs.total - cpu0) / cpuN : 0).toFixed(1), frames: times.length, worst: hs ? Math.round(hs.ms) : undefined, why: hs?.causes.join('; ') });
        steps[k].off();
      }
      k++;
      if (k >= steps.length) return done(out);
      hitch0 = prof.hitches.length;
      steps[k].on();
      t0 = t;
      times = [];
      last = 0;
    }
    if (t - t0 > SETTLE) {
      if (last) times.push(t - last);
      else {
        cpu0 = prof.cpuMs.total;
        frames0 = prof.cpuMs.pushes;
      }
      last = t;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * The feel scene: real pointer, wheel and key events on the page, one every 0.4 s, between animation frames (a timer,
 * as a person's input arrives): half the time on the surface (camera drags, wheel, clicks on ants, a marker placed with
 * the marker tool, a group sent to it), then in the home nest (digs painted, a tile placed, the camera). Every one is
 * timed by the feel meter from the event's own timestamp.
 */
function runFeel(s: GameSession, secs: number, done: () => void): void {
  const v = s.view;
  const el = v.renderer.domElement;
  const w = s.world;
  const vec = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number): { x: number; y: number } | null => {
    vec.set(x, y, z).project(v.activeCamera());
    if (Math.abs(vec.x) > 0.95 || Math.abs(vec.y) > 0.95 || vec.z > 1) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + ((vec.x + 1) / 2) * r.width, y: r.top + ((1 - vec.y) / 2) * r.height };
  };
  const ptr = (type: string, x: number, y: number, button = 0, target: EventTarget = el) =>
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, buttons: type === 'pointerup' ? 0 : 1 << button, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true }));
  const click = (x: number, y: number) => {
    ptr('pointermove', x, y, 0, window);
    ptr('pointerdown', x, y);
    ptr('pointerup', x, y, 0, window);
  };
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const drag = (dx: number) => {
    ptr('pointerdown', cx, cy, 1);
    ptr('pointermove', cx + dx, cy, 1, window);
    ptr('pointerup', cx + dx, cy, 1, window);
  };
  const wheel = (dy: number) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
  const key = (code: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  };
  const home = s.viewedArea;
  const groups = s.player.groups.filter((g) => g.type !== 'queen');
  let step = 0;
  let inNest = false;
  // an own ant on screen, its screen point
  const antOnScreen = (space: number): { x: number; y: number } | null => {
    for (const a of w.s.ants) {
      if (a.space !== space || a.colony !== s.player.id || a.state === AS.Dead) continue;
      const p = space === SURFACE ? toScreen(a.x, w.terrain.walkHeight(a.x, a.y), a.y) : null;
      if (p) return p;
    }
    return null;
  };
  const act = () => {
    const k = step++ % 6;
    if (!inNest) {
      if (k === 0) drag(60);
      else if (k === 1) wheel(step % 4 < 2 ? -120 : 120);
      else if (k === 2) {
        const p = antOnScreen(SURFACE);
        if (p) click(p.x, p.y);
      } else if (k === 3) {
        // the marker tool, then a click on the ground
        s.selectMarker(step % 5);
        click(cx + ((step * 37) % 200) - 100, cy + ((step * 23) % 120) - 60);
      } else if (k === 4 && groups.length) s.assignGroup(groups[step % groups.length].id, step % 5);
      else key('KeyO');
    } else {
      const g = w.nest(s.player.id)!;
      if (k === 0) drag(-50);
      else if (k === 1) wheel(step % 4 < 2 ? -120 : 120);
      else if (k === 2 || k === 3) {
        // a hex next to the dug floor: the dig tool painted on it, or a tile on a dug one
        s.setTool(k === 2 ? 'dig' : 'tile', 'brood', s.player.castes[0] ?? '');
        for (let q = (step * 131) % (g.cols * g.rows), n = 0; n < g.cols * g.rows; n++, q = (q + 1) % (g.cols * g.rows)) {
          const ok = k === 2 ? !g.isHexDug(q) && g.isHexDiggable(q) : g.isHexDug(q) && !g.isEntrance(q);
          if (!ok) continue;
          const c = g.hexCenter(q);
          const p = toScreen(c.x, 0, c.y);
          if (!p) continue;
          ptr('pointerdown', p.x, p.y);
          ptr('pointerup', p.x, p.y, 0, window);
          break;
        }
        s.setTool('none');
      } else if (k === 4) {
        const p = antOnScreen(home);
        if (p) click(p.x, p.y);
      } else key('KeyO');
    }
  };
  const t0 = performance.now();
  const warm = 3000;
  let started = false;
  let timer = 0;
  const loop = (t: number) => {
    const el2 = t - t0;
    if (el2 >= warm && !started) {
      started = true;
      prof.reset();
      feel.reset();
      timer = window.setInterval(act, 400);
    }
    if (started && !inNest && el2 - warm > (secs * 1000) / 2) {
      inNest = true;
      s.showArea(home);
    }
    if (el2 - warm < secs * 1000) requestAnimationFrame(loop);
    else {
      window.clearInterval(timer);
      done();
    }
  };
  requestAnimationFrame(loop);
}

/**
 * The switching test: from the surface into the home nest (the dive), through every other area (fade cuts), and back
 * out to the surface (the dive), `brounds` times (default 10). Every frame from the start of a switch until 0.4 s
 * after it ends counts toward that switch.
 */
function runSwitching(s: GameSession, _fail: () => void, done: (sw: SwitchResult) => void): void {
  const v = s.view;
  const q = new URLSearchParams(location.search);
  const rounds = Number(q.get('brounds') || 10);
  const home = s.viewedArea;
  const areas = s
    .areaTabs()
    .map((t) => t.space)
    .filter((sp) => sp !== home);
  type Step = { kind: SwitchStep['kind']; round: number; act: () => void };
  const plan: Step[] = [];
  for (let r = 0; r < rounds; r++) {
    plan.push({ kind: 'dive in', round: r, act: () => void (v.space === 'surface' && s.showArea(home)) });
    for (const a of areas) plan.push({ kind: 'area', round: r, act: () => void s.showArea(a) });
    plan.push({ kind: 'dive out', round: r, act: () => void (v.space === 'nest' && s.toggleView()) });
  }
  const steps: SwitchStep[] = [];
  const counts: NonNullable<SwitchResult['counts']> = [];
  let k = -1;
  let stepStart = 0;
  let endAt = 0;
  let last = 0;
  let cur: SwitchStep | null = null;
  let hitchMark = 0;
  const t0 = performance.now();
  const loop = (t: number) => {
    const dt = last ? t - last : 0;
    last = t;
    if (t - t0 < 3000) {
      // warm-up on the surface
      requestAnimationFrame(loop);
      return;
    }
    if (k === -1) {
      prof.reset();
      feel.reset();
      k = 0;
      startStep(t);
      requestAnimationFrame(loop);
      return;
    }
    if (cur && dt > 0) {
      cur.frames++;
      cur.worst = Math.max(cur.worst, dt);
      if (dt > 33) cur.over33++;
      if (dt > 50) cur.over50++;
    }
    if (!v.transitioning && !endAt && t - stepStart > 100) endAt = t + 400;
    if (endAt && t >= endAt) {
      // this step's hitches and their causes
      // (the longest first — performance v5: the first three hid the multi-second ones)
      for (const h of prof.hitches.slice(hitchMark).sort((a, b) => b.ms - a.ms)) cur!.causes.push(`${h.ms.toFixed(0)} ms (main thread ${h.cpu.toFixed(0)}): ${h.causes.join('; ')}`);
      steps.push(cur!);
      if (plan[k].kind === 'dive out') {
        const c = prof.counts();
        counts.push({ textures: c.textures, geometries: c.geometries, programs: c.programs, gpuMB: Math.round(prof.gpuMB()) });
      }
      k++;
      if (k >= plan.length) return done({ rounds, steps, counts });
      startStep(t);
    }
    requestAnimationFrame(loop);
  };
  const startStep = (t: number) => {
    const p = plan[k];
    cur = { kind: p.kind, round: p.round, frames: 0, worst: 0, over33: 0, over50: 0, causes: [] };
    hitchMark = prof.hitches.length;
    stepStart = t;
    endAt = 0;
    p.act();
  };
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ the report

function fmtScene(r: SceneResult): string[] {
  const parts = Object.entries(r.parts)
    .filter(([, ms]) => ms >= 0.05)
    .map(([p, ms]) => `${p} ${ms}`)
    .join(', ');
  const out = [
    `## ${r.title}`,
    `load ${(r.loadMs / 1000).toFixed(1)} s (pre-warm ${((r.prewarmMs ?? 0) / 1000).toFixed(1)} s) · ${r.frames} frames · ${r.fps} FPS · frame avg ${r.frameAvg} ms, p95 ${r.p95}, worst ${r.worst} · over 33 ms: ${r.over33}, over 50 ms: ${r.over50}`,
    `main thread ${r.cpuAvg} ms (${parts}) · GPU ${r.gpuAvg ?? 'n/a'} ms · sim tick ${r.tickMs} ms, msg ${r.msgKB} KB`,
    `draw calls ${r.calls} · tris ${(r.tris / 1000).toFixed(0)}k · programs ${r.programs} · textures ${r.textures} · geometries ${r.geometries} · heap ${r.heapMB} MB · GPU memory ≈ ${r.gpuMB} MB${r.gpuParts ? ` (textures ${r.gpuParts.tex}, render buffers ${r.gpuParts.rb}, buffers ${r.gpuParts.buf})` : ''} · ${r.ants} ants, ${r.creatures} creatures · quality ${r.quality}`,
    `GL during the run: ${r.glLinks} shader links, ${r.glUploads} texture uploads`,
  ];
  if (r.switch) {
    const sw = r.switch;
    const kinds: Array<SwitchStep['kind']> = ['dive in', 'area', 'dive out'];
    for (const kind of kinds) {
      const all = sw.steps.filter((x) => x.kind === kind);
      if (!all.length) continue;
      const first = all.filter((x) => x.round === 0);
      const later = all.filter((x) => x.round > 0);
      const worst = (a: SwitchStep[]) => (a.length ? Math.max(...a.map((x) => x.worst)).toFixed(0) : '—');
      const over = (a: SwitchStep[]) => a.reduce((n, x) => n + x.over33, 0);
      out.push(`switch ${kind}: ${all.length}× · worst frame first round ${worst(first)} ms, later rounds ${worst(later)} ms · frames over 33 ms: first ${over(first)}, later ${over(later)}`);
    }
    // the steps with the longest frames, and what was in them
    const causes = sw.steps
      .filter((x) => x.causes.length)
      .sort((a, b) => b.worst - a.worst)
      .slice(0, 10);
    for (const x of causes) out.push(`  round ${x.round + 1} ${x.kind}: ${x.causes.slice(0, 2).join(' | ')}`);
    // the renderer's counts after each round (performance v5: does anything pile up?)
    if (sw.counts?.length) out.push(`  after each round (textures, geometries, programs, GPU MB): ${sw.counts.map((c) => `${c.textures}/${c.geometries}/${c.programs}/${c.gpuMB}`).join(' · ')}`);
  }
  if (r.feel) {
    const F = r.feel;
    const fm = (x: { avg: number; p95: number } | null) => (x ? `${x.avg}/${x.p95}` : '—');
    const kinds = Object.keys(F.feedback) as Array<keyof FeelSummary['feedback']>;
    out.push(
      `input → feedback ms (avg/p95): ${kinds.filter((k) => F.feedback[k]).map((k) => `${k} ${fm(F.feedback[k])}`).join(', ') || '—'}`,
      `input → acting ms: ${kinds.filter((k) => F.acting[k]).map((k) => `${k} ${fm(F.acting[k])}`).join(', ') || '—'} · command ${F.cmdTicks ? `${F.cmdTicks.avg} ticks, ${F.cmdMs?.avg} ms` : '—'}`,
      `pacing: interval ${fm(F.interval)} ms, jitter ${F.jitter ? F.jitter.avg : '—'} ms, display ${F.vsync} ms · over 16.7 ms ${F.over16}/${F.frames}, over 33 ms ${F.over33}, missed vsync ${F.missed} · long tasks ${F.longTasks ? `${F.longTasks.n} (${F.longTasks.ms} ms)` : 'n/a'}`,
    );
  }
  if (r.speedSteps) {
    out.push('  speed  reached   frame avg / p95, over 50 ms   main thread (msg, events)   sim tick   sim frames (in s), waiting');
    for (const g of r.speedSteps)
      out.push(`  ${String(g.speed).padStart(3)}×   ${g.reached.toFixed(2)}×     ${g.avg.toFixed(1)} / ${g.p95.toFixed(1)} ms, ${g.over50}`.padEnd(48) + `${g.cpu} ms (${g.msg}, ${g.events})`.padEnd(28) + `${g.tickMs} ms`.padEnd(11) + (g.msgs !== undefined ? `${g.msgs} (${g.secs} s), ${g.backlog} ticks` : ''));
  }
  if (r.cine) out.push(r.cine.secs ? `  the shot ran ${r.cine.secs} s${r.cine.ended ? '' : ' (not seen to end)'}` : '  the flight did not start within 30 s');
  if (r.gpuSteps) {
    const base = r.gpuSteps[0]?.avg ?? 0;
    for (const g of r.gpuSteps)
      out.push(
        (g.frames < 5
          ? `  ${g.name.padEnd(32)} too slow to measure (${g.frames} frames in 2.5 s)`
          : `  ${g.name.padEnd(32)} frame ${g.avg.toFixed(1)} ms (p95 ${g.p95.toFixed(1)}, ${g.frames} frames)${g === r.gpuSteps[0] ? '' : `, saves ${(base - g.avg).toFixed(1)} ms`} · main thread ${g.cpu} ms`) +
          (g.worst && g.worst > 100 ? ` · longest ${g.worst} ms: ${g.why}` : ''),
      );
  }
  if (r.subs?.length) out.push(`pieces (ms a frame, the worst frame): ${r.subs.map((x) => `${x.name} ${x.avg} (${x.worst})`).join(', ')}`);
  if (r.gpu) {
    const g = r.gpu;
    out.push(`GPU, pass by pass (${g.frames} frames, each pass waited for: ${g.frameMs} ms a frame): ${g.passes.map((p) => `${p.name} ${p.ms}`).join(', ')}`);
    out.push(`  triangles a frame by what is drawn: ${g.draws.map((d) => `${d.name} ${(d.tris / 1000).toFixed(0)}k`).join(', ')}`);
  }
  if (r.hitches.length) {
    out.push('the longest frames:');
    for (const h of r.hitches.slice(0, 10)) out.push(`  ${h}`);
  }
  return out;
}

function showReport(ui: HTMLElement): void {
  const st = load();
  const box = panel(ui);
  if (!st || !st.results.length) {
    box.innerHTML = `<h2>Benchmark</h2><p>No results in this tab. <a href="?bench=1" style="color:#e0c28a">Run the benchmark</a>.</p>`;
    return;
  }
  const text = [
    `# Underground Dominion benchmark — ${BUILD_ID} — ${new Date(st.started).toISOString()}`,
    device(),
    st.display ? `display ${st.display.hz} Hz on the start screen${st.display.capped ? ' — capped at 30 Hz: Low Power Mode or on battery? Frames are measured against it; for the full numbers, plug in and turn Low Power Mode off' : ''}` : 'display rate not measured',
    `quality ${st.quality}, ${st.secs} s a scene`,
    '',
    ...st.results.flatMap((r) => [...fmtScene(r), '']),
  ].join('\n');
  (window as unknown as { __bench: unknown }).__bench = { text, results: st.results };
  console.log(text);
  box.innerHTML = `<h2>Benchmark report</h2><p>Copy it and paste it back in the chat.</p>`;
  const ta = document.createElement('textarea');
  ta.readOnly = true;
  ta.value = text;
  ta.style.cssText = 'width:100%;height:55vh;background:#0b0806;color:#cfe8c8;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;border:1px solid #5a4528;padding:8px';
  box.appendChild(ta);
  const row = document.createElement('div');
  row.style.cssText = 'margin-top:10px;display:flex;gap:10px';
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:14px system-ui;padding:6px 14px;background:#2c2116;color:#e8dcc0;border:1px solid #a8844f;border-radius:3px;cursor:pointer';
    b.onclick = fn;
    row.appendChild(b);
    return b;
  };
  const copy = btn('Copy report', () => {
    ta.select();
    void navigator.clipboard?.writeText(text).then(
      () => (copy.textContent = 'Copied'),
      () => document.execCommand('copy'),
    );
  });
  btn('Run again', () => go(`bench=1&q=${st.quality}&bsecs=${st.secs}`));
  btn('Back to the game', () => go(''));
  box.appendChild(row);
}
