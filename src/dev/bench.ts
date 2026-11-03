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
 *
 * Each scene: a warm-up, then a camera tour of a fixed path for `bsecs` seconds (default 20) while the profiler
 * (core/profiler.ts) records every frame. Results live in sessionStorage between the page loads; `?bench=1&bdone=1`
 * shows the report (also left in `window.__bench` and the console for the browser test).
 */
import * as THREE from 'three';
import type { GameSession } from '../game/session';
import { prof } from '../core/profiler';
import { BUILD_ID } from '../net/messages';

interface SceneDef {
  id: string;
  title: string;
  /** the page's query for this scene (bench=1 and bscene are added) */
  query: string;
}

export const BENCH_SCENES: SceneDef[] = [
  { id: 'switch', title: 'Switching surface ↔ underground', query: 'play=1&seed=11&areas=1&species=lasius&rival=solenopsis&reveal=1&developed=6&nocine=1' },
  { id: 'fight', title: 'Big fight (4 × 200 ants, 100 creatures, 2 titans)', query: 'stress=1&ants=200&creatures=100&bosses=2' },
  { id: 'nest', title: 'Full nest', query: 'stress=1&ants=200&creatures=40&view=nest' },
  { id: 'story', title: 'Story: The Long Nights, last night', query: 'story=longNights&diff=normal&night=3&nocine=1&seed=7' },
  { id: 'arena', title: 'Battle arena, 600 units', query: 'play=1&mode=arena&teams=2&seed=4' },
  { id: 'mp4', title: 'Multiplayer-sized world (4 colonies, authored map)', query: 'play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1' },
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
  tickMs: number;
  msgKB: number;
  glLinks: number;
  glUploads: number;
  quality: string;
  ants: number;
  creatures: number;
  hitches: string[];
  switch?: SwitchResult;
}

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
}

interface BenchState {
  started: number;
  quality: string;
  secs: number;
  /** switching test rounds */
  rounds: number;
  results: SceneResult[];
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
  const st: BenchState = { started: Date.now(), quality: q.get('q') || 'high', secs: Number(q.get('bsecs') || 20), rounds: Number(q.get('brounds') || 10), results: [] };
  const box = panel(ui);
  box.innerHTML = `<h2>Benchmark</h2><p>Six scenes, about ${Math.round((BENCH_SCENES.length * (st.secs + 12) + 60) / 60)} minutes at <b>${st.quality}</b> quality. Each one loads, warms up, then flies the camera along a fixed path while every frame is timed. Leave the mouse and keyboard alone until the report appears; keep this tab in front.</p><p>Starting in 3 s…</p>`;
  save(st);
  setTimeout(() => go(sceneUrl(0, st)), 3000);
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
  (window as unknown as { __prof: unknown }).__prof = prof;
  const secs = Number(q.get('bsecs') || st.secs);
  const v = s.view;
  s.autoQuality.enabled = false;
  // (measured uncapped: the frame cap would hide what the device can do)
  s.loop.frameCap = 0;
  const finish = (sw?: SwitchResult) => {
    const r = collect(s, def, loadMs, secs, sw);
    st.results.push(r);
    save(st);
    console.log('[bench]', JSON.stringify(r));
    if (i + 1 < BENCH_SCENES.length) go(sceneUrl(i + 1, st));
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
    }
    const k = (el - warm) / (secs * 1000);
    tour(Math.min(1, k));
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
    tickMs: +s.sim.tickMs.toFixed(2),
    msgKB: +(prof.msgBytesAvg / 1024).toFixed(0),
    glLinks: G.links,
    glUploads: G.texUploads,
    quality: s.view.quality,
    ants: s.world.s.ants.length,
    creatures: s.world.s.creatures.length,
    hitches: prof.hitches.slice(0, 12).map((h) => `${h.t.toFixed(1)} s ${h.ms.toFixed(0)} ms: ${h.causes.join('; ')}`),
    switch: sw,
  };
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
      for (const h of prof.hitches.slice(hitchMark)) cur!.causes.push(`${h.ms.toFixed(0)} ms: ${h.causes.join('; ')}`);
      steps.push(cur!);
      k++;
      if (k >= plan.length) return done({ rounds, steps });
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
    `draw calls ${r.calls} · tris ${(r.tris / 1000).toFixed(0)}k · programs ${r.programs} · textures ${r.textures} · geometries ${r.geometries} · heap ${r.heapMB} MB · ${r.ants} ants, ${r.creatures} creatures · quality ${r.quality}`,
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
    const causes = sw.steps.filter((x) => x.causes.length).slice(0, 10);
    for (const x of causes) out.push(`  round ${x.round + 1} ${x.kind}: ${x.causes.slice(0, 3).join(' | ')}`);
  }
  if (r.hitches.length) {
    out.push('hitches:');
    for (const h of r.hitches.slice(0, 8)) out.push(`  ${h}`);
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
