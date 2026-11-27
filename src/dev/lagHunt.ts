/**
 * The Lag Hunt (performance v7, claude/performance/07-spec-performance-v7-find-and-fix-everything.md §1): a
 * self-running stress test the player starts on their own device — Menu → Graphics → "Run Lag Hunt", or `?lagHunt=1`.
 * It plays the game by itself, one page load a scene (loading is part of what a player sees): the battle arena with
 * Saiy-Ants and every species on the roster in growing armies, a four-colony match played as Saiy-Ants (diving into
 * the nest and back, the areas, the game speeds), the trees, a story night and the big fight — the camera moving like
 * a player's, zooming in close and out far. Every frame is recorded with what was going on: the script's step, the
 * frame's parts on the main thread, shader compiles and links, texture and buffer uploads, notes (a model built),
 * the simulation's tick time and whether it kept up with real time. It flags every frame over 33 ms and keeps every
 * freeze over 100 ms with its cause, and ends with a report — the summary first (the worst freezes, where and why;
 * each scene's frame rate), then the details — to copy or download as a text file.
 *
 * The simulation does not change: the script plays through commands as a player would (arena drops, stances, the
 * game speed) and the camera; the results are its own. Results live in sessionStorage between the page loads.
 */
import type { GameSession } from '../game/session';
import { prof, type Hitch } from '../core/profiler';
import { BUILD_ID } from '../net/messages';
import { SURFACE } from '../sim/types';
import { CASTES } from '../sim/species';
import { arenaRosterCastes, ARENA_ROSTER_SPECIES } from '../sim/arena';
import { display, probeDisplay } from '../core/display';
import { measureGpu, type GpuBreakdown } from './gpuBreakdown';

/** the scenes that end with the GPU breakdown (every pass, then every draw, waited for: where the GPU's time goes —
 *  Safari has no GPU timers; these frames are slow on purpose and are not counted) */
const GPU_SCENES = new Set(['arena-saiy', 'match-saiy', 'trees', 'bigfight']);

/** What a script step can do (the session, and the camera like a player's). */
interface Hands {
  s: GameSession;
  /** move the camera's goal (eased, as a player's drag and wheel); null keeps the place */
  look(x: number | null, z: number | null, dist: number): void;
  /** turn the camera by `da` radians */
  orbit(da: number): void;
  /** the camera onto the thickest fighting (the surface's live ants' middle) */
  toFight(dist: number): void;
  /** an arena team's army (in drops of 50, the arena's most) */
  army(team: number, unit: string, n: number): void;
  clear(team: number): void;
  stance(team: number, stance: number): void;
  centre(): [number, number];
}

type Step = [t: number, label: string, act: (h: Hands) => void];

interface HuntScene {
  id: string;
  title: string;
  /** the page's query (lagHunt=1 and lhscene are added) */
  query: string;
  secs: number;
  steps: (h: Hands) => Step[];
}

/** One fighting caste of each roster species (its soldier, else its first). */
export function rosterFighters(): string[] {
  const all = arenaRosterCastes();
  const out: string[] = [];
  for (const sp of ARENA_ROSTER_SPECIES) {
    const cs = all.filter((c) => CASTES[c].species === sp);
    const pick = cs.find((c) => CASTES[c].role === 'soldier') ?? cs.find((c) => CASTES[c].role === 'major') ?? cs[0];
    if (pick) out.push(pick);
  }
  return out;
}

export const HUNT_SCENES: HuntScene[] = [
  {
    id: 'arena-saiy',
    title: 'Battle arena: Saiy-Ants against fire ants, armies of 10, 50, 100 and 300 a side',
    query: 'play=1&mode=arena&teams=2&seed=4',
    secs: 112,
    steps: () => [
      [0, '10 Saiy-Ant soldiers v 10 fire-ant majors', (h) => (h.army(0, 'ant:aurimyrmex_soldier', 10), h.army(1, 'ant:fire_major', 10), h.toFight(220))],
      [6, 'the first fight, close', (h) => h.toFight(60)],
      [14, '50 Saiy-Ants (soldiers, blasters) v 50 fire ants', (h) => (h.clear(-1), h.army(0, 'ant:aurimyrmex_soldier', 35), h.army(0, 'ant:aurimyrmex_blaster', 15), h.army(1, 'ant:fire_minor', 30), h.army(1, 'ant:fire_major', 20), h.toFight(260))],
      [22, 'zoom in on the fight', (h) => h.toFight(55)],
      [28, 'close up, turning', (h) => (h.toFight(35), h.orbit(1.2))],
      [34, 'zoom out far', (h) => h.toFight(420)],
      [40, '100 a side (soldiers, workers, blasters v fire ants)', (h) => (h.clear(-1), h.army(0, 'ant:aurimyrmex_soldier', 50), h.army(0, 'ant:aurimyrmex_worker', 30), h.army(0, 'ant:aurimyrmex_blaster', 20), h.army(1, 'ant:fire_minor', 60), h.army(1, 'ant:fire_major', 40), h.toFight(300))],
      [50, 'zoom in on 200 fighting', (h) => h.toFight(70)],
      [58, 'close, turning', (h) => (h.toFight(40), h.orbit(-1.5))],
      [66, '300 a side', (h) => (h.clear(-1), h.army(0, 'ant:aurimyrmex_soldier', 200), h.army(0, 'ant:aurimyrmex_blaster', 50), h.army(0, 'ant:aurimyrmex_worker', 50), h.army(1, 'ant:fire_minor', 180), h.army(1, 'ant:fire_major', 120), h.toFight(380))],
      [78, 'zoom in on 600 fighting', (h) => h.toFight(90)],
      [86, 'close', (h) => (h.toFight(45), h.orbit(1))],
      [94, '4× speed', (h) => (h.s.setSpeed(4), h.toFight(150))],
      [104, 'back to 1×, far', (h) => (h.s.setSpeed(1), h.toFight(450))],
    ],
  },
  {
    id: 'arena-roster',
    title: 'Battle arena: every species on the roster in turn, 30 a side, the camera in close',
    query: 'play=1&mode=arena&teams=2&seed=5',
    secs: 0, // (set from the roster below)
    steps: () => {
      const f = rosterFighters();
      const out: Step[] = [];
      f.forEach((cs, i) => {
        const foe = f[(i + 1) % f.length];
        const t = i * 9;
        out.push([t, `${CASTES[cs].name} (${CASTES[cs].species}) v ${CASTES[foe].species}`, (h) => (h.clear(-1), h.army(0, 'ant:' + cs, 30), h.army(1, 'ant:' + foe, 30), h.toFight(200))]);
        out.push([t + 3, `${CASTES[cs].species} close`, (h) => h.toFight(50)]);
        out.push([t + 6, `${CASTES[cs].species} far`, (h) => h.toFight(320)]);
      });
      out.push([f.length * 9, 'creatures: wolf spiders and ground beetles', (h) => (h.clear(-1), h.army(0, 'cr:wolfSpider', 6), h.army(1, 'cr:groundBeetle', 6), h.army(1, 'ant:fire_minor', 30), h.toFight(150))]);
      out.push([f.length * 9 + 5, 'creatures close', (h) => h.toFight(60)]);
      return out;
    },
  },
  {
    id: 'match-saiy',
    title: 'A four-colony match as the Saiy-Ants: the surface, the nest and back, the areas, 1×–8×',
    query: 'play=1&seed=3&map=meadowPond&species=aurimyrmex&rival=formica,solenopsis,atta&developed=6&nocine=1&reveal=1',
    secs: 96,
    steps: () => [
      [0, 'the home entrance', (h) => {
        const e = h.s.player.entrances[0];
        if (e) h.look(e.sx, e.sy, 140);
      }],
      [6, 'close to the ants', (h) => h.look(null, null, 45)],
      [12, 'across the map', (h) => {
        const [x, z] = h.centre();
        h.look(x, z, 320);
      }],
      [20, 'down into the nest', (h) => h.s.toggleView()],
      [28, 'the nest, close', (h) => h.look(null, null, 40)],
      [34, 'every area in turn', (h) => {
        const tabs = h.s.areaTabs?.() ?? [];
        const next = tabs.find((t) => t.space !== h.s.viewedArea && t.open);
        if (next) h.s.showArea(next.space);
      }],
      [42, 'back up to the surface', (h) => h.s.toggleView()],
      [48, '2× speed, a tour', (h) => {
        h.s.setSpeed(2);
        const [x, z] = h.centre();
        h.look(x * 0.6, z * 0.7, 240);
      }],
      [58, '4× speed', (h) => {
        h.s.setSpeed(4);
        const [x, z] = h.centre();
        h.look(x * 1.4, z * 1.2, 120);
      }],
      [68, '8× speed, far', (h) => {
        h.s.setSpeed(8);
        const [x, z] = h.centre();
        h.look(x, z, 480);
      }],
      [78, '1×, into the nest again', (h) => (h.s.setSpeed(1), h.s.toggleView())],
      [86, 'and out', (h) => h.s.toggleView()],
    ],
  },
  {
    id: 'trees',
    title: 'The trees: up into the canopy and down again, twice',
    query: 'play=1&seed=3&map=meadowPond&species=aurimyrmex&rival=formica,solenopsis,atta&developed=6&nocine=1&trees=1',
    secs: 64,
    steps: () => [
      [0, 'the ground', (h) => h.look(null, null, 160)],
      [6, 'climb into the trees', (h) => h.s.toggleTrees()],
      [16, 'the canopy, close', (h) => h.look(null, null, 60)],
      [24, 'the canopy, far', (h) => h.look(null, null, 300)],
      [32, 'down to the ground', (h) => h.s.toggleTrees()],
      [40, 'up again', (h) => h.s.toggleTrees()],
      [52, 'and down', (h) => h.s.toggleTrees()],
    ],
  },
  {
    id: 'story',
    title: 'Story: The Long Nights, the dusk before the last night',
    query: 'story=longNights&diff=normal&night=3&nocine=1&seed=7',
    secs: 60,
    steps: () => [
      [0, 'the colony', (h) => h.look(null, null, 140)],
      [10, '4× speed into the night', (h) => (h.s.setSpeed(4), h.look(null, null, 220))],
      [30, 'close', (h) => h.look(null, null, 60)],
      [44, '1×, far', (h) => (h.s.setSpeed(1), h.look(null, null, 380))],
    ],
  },
  {
    id: 'bigfight',
    title: 'The big fight: four colonies of 200, 100 creatures, two titans',
    query: 'stress=1&ants=200&creatures=100&bosses=2',
    secs: 60,
    steps: () => [
      [0, 'the fight', (h) => h.toFight(260)],
      [10, 'close', (h) => h.toFight(60)],
      [20, 'turning close', (h) => (h.toFight(40), h.orbit(1.4))],
      [30, '4× speed', (h) => (h.s.setSpeed(4), h.toFight(180))],
      [44, '1×, far', (h) => (h.s.setSpeed(1), h.toFight(500))],
    ],
  },
];

const KEY = 'ud-lag-hunt';

/** One step of a scene: its frames and how they went. */
interface StepResult {
  label: string;
  frames: number;
  ms: number;
  over33: number;
  over100: number;
  worst: number;
  /** the simulation's ticks in the step against the ticks real time × speed asked for */
  ticks: number;
  wanted: number;
}

interface Freeze {
  scene: string;
  step: string;
  t: number;
  ms: number;
  cpu: number;
  causes: string[];
  /** what was on screen (ants drawn, their detail levels, draw calls, triangles) */
  ctx: string;
}

interface HuntSceneResult {
  id: string;
  title: string;
  loadMs: number;
  prewarmMs: number;
  frames: number;
  secs: number;
  fps: number;
  avg: number;
  p95: number;
  worst: number;
  over33: number;
  over100: number;
  cpuAvg: number;
  parts: Record<string, number>;
  tickAvg: number;
  tickMax: number;
  msgKB: number;
  keptUp: number;
  links: number;
  uploads: number;
  calls: number;
  tris: number;
  gpuMB: number;
  ants: number;
  steps: StepResult[];
  freezes: Freeze[];
  /** the slowest frames over 33 ms (not freezes), with their causes */
  slow: Freeze[];
  /** where the GPU's time went at the scene's end (GPU_SCENES) */
  gpu?: GpuBreakdown;
}

export interface HuntState {
  started: number;
  quality: string;
  results: HuntSceneResult[];
  display?: { hz: number; capped: boolean };
  only?: string[];
}

function load(): HuntState | null {
  try {
    const s = sessionStorage.getItem(KEY);
    return s ? (JSON.parse(s) as HuntState) : null;
  } catch {
    return null;
  }
}

function save(st: HuntState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    // private mode: the run cannot go on across page loads
  }
}

function go(params: string): void {
  location.href = `${location.pathname}?${params}`;
}

function sceneSecs(def: HuntScene): number {
  if (def.secs > 0) return def.secs;
  const st = def.steps({} as Hands);
  return Math.max(...st.map((x) => x[0])) + 8;
}

function sceneUrl(i: number, st: HuntState): string {
  return `${HUNT_SCENES[i].query}&lagHunt=1&lhscene=${i}&q=${st.quality}`;
}

function nextScene(st: HuntState, i: number): number {
  for (let k = i + 1; k < HUNT_SCENES.length; k++) if (!st.only || st.only.includes(HUNT_SCENES[k].id)) return k;
  return -1;
}

function panel(ui: HTMLElement): HTMLElement {
  const box = document.createElement('div');
  box.className = 'bench-panel';
  box.style.cssText = 'position:fixed;inset:5vh 6vw;overflow:auto;background:rgba(14,10,7,0.96);color:#e8dcc0;font:14px/1.5 system-ui,sans-serif;padding:20px 24px;border:1px solid #8a6a3a;border-radius:6px;z-index:100';
  ui.appendChild(box);
  return box;
}

/** Device facts for the report. */
function device(): string[] {
  if (typeof document === 'undefined') return ['(no browser)'];
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  let gpu = 'unknown GPU';
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }
  return [navigator.userAgent, `GPU ${gpu}; ${navigator.hardwareConcurrency || '?'} cores; screen ${screen.width}×${screen.height} at ${devicePixelRatio}× (window ${innerWidth}×${innerHeight})`];
}

/** `?lagHunt=1` without a scene: the start screen, or (lhdone) the report. */
export function startLagHunt(ui: HTMLElement, q: URLSearchParams): void {
  if (q.get('lhdone')) return showHuntReport(ui);
  const only = q.get('lhonly')?.split(',').filter((id) => HUNT_SCENES.some((d) => d.id === id));
  const st: HuntState = { started: Date.now(), quality: q.get('q') || 'high', results: [], only: only?.length ? only : undefined };
  const scenes = HUNT_SCENES.filter((d) => !st.only || st.only.includes(d.id));
  const mins = Math.round(scenes.reduce((s, d) => s + sceneSecs(d) + 25, 0) / 60);
  const box = panel(ui);
  box.innerHTML = `<h2>Lag Hunt</h2><p>${scenes.length} scenes, about ${mins} minutes at <b>${st.quality}</b> quality: the battle arena with Saiy-Ants and every species, a match as the Saiy-Ants (the nest, the areas, 1×–8×), the trees, a story night and the big fight. The game plays itself and records every frame; at the end you get a report to copy or download.</p><p>Plug in a laptop, keep this tab in front and leave the mouse and keyboard alone until the report appears.</p><p>Starting in 3 s…</p>`;
  save(st);
  void probeDisplay(1500).then((hz) => {
    st.display = { hz, capped: display.capped };
    save(st);
  });
  setTimeout(() => go(sceneUrl(nextScene(st, -1), st)), 3000);
}

/** Run this page's scene in the session that was just started, then move on. */
export function runLagHuntScene(s: GameSession, q: URLSearchParams): void {
  const st = load();
  const i = Number(q.get('lhscene'));
  if (!st || !(i >= 0 && i < HUNT_SCENES.length)) return;
  const def = HUNT_SCENES[i];
  const loadMs = performance.now();
  if (st.display?.hz) Object.assign(display, { hz: st.display.hz, ms: 1000 / st.display.hz, capped: st.display.capped });
  (window as unknown as { __prof: unknown }).__prof = prof;
  s.autoQuality.enabled = false;
  s.loop.frameCap = 0;
  const v = s.view;
  const w = s.world;
  const rig = () => (v.space === 'nest' ? v.nestRig : v.surfaceRig);
  const H: Hands = {
    s,
    look(x, z, dist) {
      const r = rig();
      if (x !== null && z !== null) r.goal.set(x, r.goal.y, z);
      r.goalDistance = dist;
    },
    orbit(da) {
      rig().goalYaw += da;
    },
    centre() {
      return [w.terrain.width / 2, w.terrain.depth / 2];
    },
    toFight(dist) {
      let x = 0;
      let y = 0;
      let n = 0;
      for (const a of w.s.ants) if (a.space === SURFACE && a.hp > 0) ((x += a.x), (y += a.y), n++);
      const [cx, cz] = n ? [x / n, y / n] : H.centre();
      if (v.space !== 'surface') return H.look(null, null, dist);
      H.look(cx, cz, dist);
    },
    army(team, unit, n) {
      while (n > 0) {
        const k = Math.min(50, n);
        s.issue({ type: 'arenaSpawn', team, unit, n: k, level: 1, at: false, x: 0, y: 0 } as never, true);
        n -= k;
      }
    },
    clear(team) {
      s.issue({ type: 'arenaClear', team } as never, true);
    },
    stance(team, stance) {
      s.issue({ type: 'arenaStance', team, stance } as never, true);
    },
  };
  // (the first seconds after loading are a step of their own: the script starts after them)
  const LEAD = 3;
  const steps: Step[] = [[-LEAD, 'the first seconds after loading', () => {}], ...def.steps(H).sort((a, b) => a[0] - b[0])];
  const secs = sceneSecs(def);
  const t0 = performance.now();
  // per step, and the scene's freezes and slow frames
  const res: StepResult[] = steps.map((x) => ({ label: x[1], frames: 0, ms: 0, over33: 0, over100: 0, worst: 0, ticks: 0, wanted: 0 }));
  const freezes: Freeze[] = [];
  const slow: Freeze[] = [];
  let cur = -1;
  let next = 0;
  let measuring = false;
  let tickAt = w.s.tick;
  let tickSum = 0;
  let tickN = 0;
  let tickMax = 0;
  const ctx = () => {
    const st2 = s.surfaceAntStats;
    return `${v.space}, camera ${rig().distance.toFixed(0)} mm, ${w.s.ants.length} ants (drawn ${st2.drawn}: close ${st2.lod[0]}, mid ${st2.lod[1]}, far ${st2.lod[2]}), speed ${s.loop.speed}×`;
  };
  prof.onFrameEnd = (ms: number, cpu: number, h: Hitch | null, hidden: boolean) => {
    if (!measuring || hidden || cur < 0) return;
    const r = res[cur];
    r.frames++;
    r.ms += ms;
    r.worst = Math.max(r.worst, ms);
    if (ms > 33) r.over33++;
    if (ms > 100) r.over100++;
    if (h && (ms > 33 || cpu > 33)) {
      const f: Freeze = { scene: def.id, step: r.label, t: +((performance.now() - t0) / 1000).toFixed(1), ms: Math.round(ms), cpu: Math.round(cpu), causes: h.causes, ctx: ctx() };
      if (ms > 100) {
        if (freezes.length < 60) freezes.push(f);
      } else {
        slow.push(f);
        if (slow.length > 40) {
          slow.sort((a, b) => b.ms - a.ms);
          slow.length = 24;
        }
      }
    }
    const tm = s.sim.tickMs;
    if (tm > 0) {
      tickSum += tm;
      tickN++;
      tickMax = Math.max(tickMax, tm);
    }
  };
  const finish = () => {
    prof.onFrameEnd = null;
    const f = prof.frameMs.summary();
    const c = prof.cpuMs.summary();
    const n = prof.counts();
    const G = prof.glSince();
    const parts: Record<string, number> = {};
    for (const p of prof.partNames()) parts[p] = +prof.parts[p].summary().avg.toFixed(2);
    const frames = res.reduce((a, r) => a + r.frames, 0);
    const msSum = res.reduce((a, r) => a + r.ms, 0);
    const ticks = res.reduce((a, r) => a + r.ticks, 0);
    const wanted = res.reduce((a, r) => a + r.wanted, 0);
    const r: HuntSceneResult = {
      id: def.id,
      title: def.title,
      loadMs: Math.round(loadMs),
      prewarmMs: Math.round(s.prewarmMs),
      frames,
      secs,
      fps: +((frames * 1000) / Math.max(1, msSum)).toFixed(1),
      avg: +(msSum / Math.max(1, frames)).toFixed(1),
      p95: +f.p95.toFixed(0),
      worst: Math.round(Math.max(0, ...res.map((x) => x.worst))),
      over33: res.reduce((a, x) => a + x.over33, 0),
      over100: res.reduce((a, x) => a + x.over100, 0),
      cpuAvg: +c.avg.toFixed(1),
      parts,
      tickAvg: +(tickSum / Math.max(1, tickN)).toFixed(1),
      tickMax: +tickMax.toFixed(1),
      msgKB: +(prof.msgBytesAvg / 1024).toFixed(0),
      keptUp: wanted > 0 ? Math.min(1, ticks / wanted) : 1,
      links: G.links,
      uploads: G.texUploads,
      calls: n.calls,
      tris: n.triangles,
      gpuMB: +prof.gpuMB().toFixed(0),
      ants: w.s.ants.length,
      steps: res,
      freezes,
      slow: slow.sort((a, b) => b.ms - a.ms).slice(0, 12),
    };
    const done = () => {
      st.results.push(r);
      save(st);
      console.log('[lag hunt]', JSON.stringify(r));
      (window as unknown as { __lagHuntScene: unknown }).__lagHuntScene = r;
      const nx = nextScene(st, i);
      if (nx >= 0) go(sceneUrl(nx, st));
      else go('lagHunt=1&lhdone=1');
    };
    if (GPU_SCENES.has(def.id)) {
      // (a stuck breakdown never stops the run)
      const stop = setTimeout(done, 60000);
      measureGpu(s, 6, (g) => {
        clearTimeout(stop);
        r.gpu = g;
        done();
      });
    } else done();
  };
  let lastT = performance.now();
  const loop = () => {
    const el = performance.now() - t0;
    if (!measuring) {
      measuring = true;
      prof.reset();
    }
    {
      const k = el / 1000 - LEAD;
      // the simulation's progress over the last frame against what real time and the speed asked for
      const now = performance.now();
      if (cur >= 0 && !s.loop.paused) {
        res[cur].ticks += Math.max(0, w.s.tick - tickAt);
        res[cur].wanted += ((now - lastT) / 1000) * 20 * s.loop.speed;
      }
      tickAt = w.s.tick;
      lastT = now;
      while (next < steps.length && k >= steps[next][0]) {
        cur = next;
        try {
          steps[next][2](H);
        } catch (e) {
          console.warn('[lag hunt] step', steps[next][1], e);
        }
        next++;
      }
      if (k >= secs) return finish();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** The report's text: the summary first, then each scene. */
export function huntReportText(st: HuntState): string {
  const out: string[] = [];
  const when = new Date(st.started).toISOString().slice(0, 16).replace('T', ' ');
  out.push(`Underground Dominion — Lag Hunt — build ${BUILD_ID} — ${when} UTC`);
  out.push(...device());
  out.push(`quality ${st.quality}; display ${st.display ? `${st.display.hz.toFixed(0)} Hz${st.display.capped ? ' (held to 30 Hz: Low Power Mode or a battery setting)' : ''}` : 'not measured'}`);
  out.push('');
  out.push('== SUMMARY');
  const all = st.results.flatMap((r) => r.freezes);
  out.push(`freezes over 100 ms after loading: ${all.length}${all.length ? '' : ' — none'}`);
  for (const f of all.sort((a, b) => b.ms - a.ms).slice(0, 12)) out.push(`  ${f.ms} ms (main thread ${f.cpu}) in ${f.scene}, "${f.step}" at ${f.t} s: ${f.causes.join('; ')} [${f.ctx}]`);
  out.push('scenes (frame rate, frames over 33 ms, freezes over 100 ms, the worst frame; the simulation):');
  for (const r of st.results)
    out.push(
      `  ${r.id.padEnd(13)} ${String(r.fps).padStart(5)} FPS (avg ${r.avg} ms, p95 ${r.p95}) · over 33 ms ${r.over33} of ${r.frames} · over 100 ms ${r.over100} · worst ${r.worst} ms · sim tick avg ${r.tickAvg} / max ${r.tickMax} ms, kept up ${Math.round(r.keptUp * 100)} % · load ${(r.loadMs / 1000).toFixed(1)} s`,
    );
  out.push('');
  out.push('== DETAILS');
  for (const r of st.results) {
    out.push('');
    out.push(`## ${r.title}`);
    out.push(`load ${(r.loadMs / 1000).toFixed(1)} s (pre-warm ${(r.prewarmMs / 1000).toFixed(1)} s) · ${r.frames} frames in ${r.secs} s · ${r.fps} FPS · main thread ${r.cpuAvg} ms (${Object.entries(r.parts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, x]) => `${k} ${x}`).join(', ')})`);
    out.push(`draw calls ${r.calls} · triangles ${(r.tris / 1000).toFixed(0)}k · GPU memory ≈ ${r.gpuMB} MB · ${r.ants} ants · shader links during the run ${r.links} · texture uploads ${r.uploads} · worker messages ${r.msgKB} KB`);
    out.push('  step                                                frames   avg ms  >33  >100  worst  sim kept up');
    for (const x of r.steps) {
      if (!x.frames) continue;
      out.push(`  ${x.label.slice(0, 50).padEnd(50)} ${String(x.frames).padStart(7)} ${(x.ms / x.frames).toFixed(1).padStart(8)} ${String(x.over33).padStart(4)} ${String(x.over100).padStart(5)} ${String(Math.round(x.worst)).padStart(6)}  ${x.wanted > 0 ? Math.round(Math.min(1, x.ticks / x.wanted) * 100) + ' %' : '—'}`);
    }
    if (r.freezes.length) {
      out.push('  freezes over 100 ms:');
      for (const f of r.freezes) out.push(`    ${f.t} s "${f.step}": ${f.ms} ms (main thread ${f.cpu}): ${f.causes.join('; ')} [${f.ctx}]`);
    }
    if (r.slow.length) {
      out.push('  the slowest other frames:');
      for (const f of r.slow) out.push(`    ${f.t} s "${f.step}": ${f.ms} ms (main thread ${f.cpu}): ${f.causes.join('; ')} [${f.ctx}]`);
    }
    if (r.gpu) {
      const g = r.gpu;
      out.push(`  the GPU at the end (every pass waited for, ${g.frames} frames — slower than real ones; the split is what counts): ${g.frameMs.toFixed(0)} ms a frame: ${g.passes.slice(0, 8).map((x) => `${x.name} ${x.ms.toFixed(1)}`).join(', ')}`);
      out.push(`    what the scene and shadows draw (triangles a frame): ${g.draws.slice(0, 8).map((x) => `${x.name} ${(x.tris / 1000).toFixed(0)}k`).join(', ')}`);
      if (g.drawMs?.length) out.push(`    each draw waited for (ms a frame; compare them with each other): ${g.drawMs.slice(0, 8).map((x) => `${x.name} ${x.ms.toFixed(1)}`).join(', ')}`);
    }
  }
  return out.join('\n');
}

function showHuntReport(ui: HTMLElement): void {
  const st = load();
  const box = panel(ui);
  if (!st) {
    box.innerHTML = '<h2>Lag Hunt</h2><p>No results (the run needs this tab to stay open between its scenes).</p>';
    return;
  }
  const text = huntReportText(st);
  (window as unknown as { __lagHunt: unknown }).__lagHunt = { text, results: st.results };
  console.log(text);
  box.innerHTML = `<h2>Lag Hunt report</h2><p>Copy it or download it, and send it back in the chat.</p>`;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px';
  const btn = (label: string, f: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:8px 14px;background:#3a2a16;color:#f0e0c0;border:1px solid #a07a40;border-radius:4px;cursor:pointer;font:inherit';
    b.onclick = f;
    row.appendChild(b);
    return b;
  };
  const copy = btn('Copy report', () => {
    const done = (ok: boolean) => (copy.textContent = ok ? 'Copied' : 'Copy failed — select the text below');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  });
  btn('Download report', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `lag-hunt-${BUILD_ID}-${new Date(st.started).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  btn('Run it again', () => go(`lagHunt=1&q=${st.quality}`));
  btn('Back to the game', () => go(''));
  box.appendChild(row);
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;font:12px/1.45 ui-monospace,Menlo,monospace;background:rgba(0,0,0,0.35);padding:12px;border-radius:4px;user-select:text';
  pre.textContent = text;
  box.appendChild(pre);
}
