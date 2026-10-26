/**
 * `?stress=1[&ants=400&creatures=100&secs=60&species=a,b,c,d]`: the stress scenario in the
 * browser (multiplayer brief, Part F). Four colonies of N ants fight and
 * forage on a 900 mm map with wild creatures; the simulation runs in the
 * worker and the F3 overlay is open. After `secs` seconds the frame-time and
 * tick-time statistics are shown on screen, logged to the console and left in
 * `window.__stress` for the browser test.
 */
import { GameSession } from '../game/session';
import { GameUI } from '../ui/gameUI';
import { DebugOverlay } from '../ui/debugOverlay';
import { populateStress, stressSetup } from './stressScene';
import type { Quality } from '../render/view';

export function runStressPage(canvas: HTMLCanvasElement, ui: HTMLElement, q: URLSearchParams): void {
  const per = Number(q.get('ants') || 400);
  const nCr = Number(q.get('creatures') || 100);
  const secs = Number(q.get('secs') || 60);
  const sp = q.get('species')?.split(',');
  const s = new GameSession(canvas, stressSetup(sp && sp.length === 4 ? sp : undefined), (q.get('q') as Quality) || 'medium');
  populateStress(s.world, per, nCr);
  if (q.get('worker') !== '0') s.useWorker();
  new GameUI(s, ui);
  const dbg = new DebugOverlay(s, ui);
  dbg.toggle(true);
  // look at the battle in the middle of the map
  s.view.surfaceRig.jumpTo(s.world.terrain.width / 2, s.world.terrain.depth / 2, 260);
  const w = window as unknown as { __session: GameSession; __ready: boolean; __stress: unknown };
  w.__session = s;
  s.start();
  w.__ready = true;
  const frames: number[] = [];
  const ticks: number[] = [];
  let last = performance.now();
  const t0 = last;
  const tick0 = () => s.world.s.tick;
  const startTick = tick0();
  const sample = (t: number) => {
    frames.push(t - last);
    last = t;
    ticks.push(s.sim.tickMs);
    if (t - t0 < secs * 1000) requestAnimationFrame(sample);
    else report();
  };
  requestAnimationFrame(sample);
  const report = () => {
    const f = frames.slice(30).sort((a, b) => a - b); // skip the warm-up frames
    const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
    const tk = ticks.filter((x) => x > 0);
    const r = {
      ants: s.world.s.ants.length,
      creatures: s.world.s.creatures.length,
      sim: s.sim.kind,
      quality: s.view.quality,
      frames: f.length,
      fps: 1000 / avg,
      frameAvg: avg,
      frameP95: f[Math.floor(f.length * 0.95)] ?? 0,
      frameWorst: f[f.length - 1] ?? 0,
      framesOver33: f.filter((x) => x > 33).length,
      tickAvg: tk.reduce((a, b) => a + b, 0) / Math.max(1, tk.length),
      ticksRun: tick0() - startTick,
      seconds: secs,
    };
    w.__stress = r;
    console.log('[stress]', JSON.stringify(r));
    const box = document.createElement('pre');
    box.className = 'debug-overlay show';
    box.style.top = 'auto';
    box.style.bottom = '12px';
    box.textContent = `Stress result (${secs} s): ${r.ants} ants, ${r.creatures} creatures, sim in ${r.sim}\nFPS ${r.fps.toFixed(1)} · frame avg ${r.frameAvg.toFixed(1)} ms, p95 ${r.frameP95.toFixed(1)} ms, worst ${r.frameWorst.toFixed(0)} ms, ${r.framesOver33} frames over 33 ms\nsimulation tick ${r.tickAvg.toFixed(2)} ms average, ${r.ticksRun} ticks run`;
    ui.appendChild(box);
  };
}
