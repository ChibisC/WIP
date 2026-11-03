/**
 * F3 debug overlay (multiplayer brief, Part F; a full profiler since the performance pass, core/profiler.ts): frame
 * rate and frame time (average, p95, worst), the main thread's time and where it goes (simulation messages, units,
 * creatures, the nest, effects, UI, render submit), GPU time where the browser can measure it, draw calls,
 * triangles, shader programs, textures, geometries, the JS heap, the GL work since loading, and the hitch log (frames
 * over 33 ms and what happened in them); then the simulation and, in multiplayer, the net state.
 */
import type { GameSession } from '../game/session';
import { prof } from '../core/profiler';

export class DebugOverlay {
  private el = document.createElement('pre');
  private on = false;
  private lastDraw = 0;

  constructor(
    private s: GameSession,
    parent: HTMLElement,
  ) {
    this.el.className = 'debug-overlay';
    parent.appendChild(this.el);
    s.input.on('debug', () => this.toggle());
    const loop = (t: number) => {
      // (text at 4 Hz: the overlay must not cost what it measures)
      if (this.on && t - this.lastDraw > 250) {
        this.lastDraw = t;
        this.render();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  toggle(force?: boolean): void {
    this.on = force ?? !this.on;
    this.el.classList.toggle('show', this.on);
    // the climb rails and riding slots are drawn with it
    this.s.setClimbDebug(this.on || new URLSearchParams(location.search).has('climbdebug'));
    // and the simulation's hitboxes
    this.s.setHitboxes(this.on || new URLSearchParams(location.search).has('hitboxes'));
  }

  private render(): void {
    const s = this.s;
    const w = s.world;
    const f = prof.frameMs.summary();
    const c = prof.cpuMs.summary();
    const n = prof.counts();
    const gpu = prof.gpuMs.count ? `${prof.gpuMs.ema.toFixed(1)} ms` : prof.gpuSupported ? '…' : 'n/a in this browser';
    const parts = prof
      .partNames()
      .map((p) => [p, prof.parts[p].ema] as const)
      .filter(([, ms]) => ms >= 0.05)
      .map(([p, ms]) => `${p} ${ms.toFixed(1)}`)
      .join('  ');
    const G = prof.glSince();
    const lines = [
      `FPS ${(1000 / Math.max(1, f.avg)).toFixed(0)}  frame ${f.avg.toFixed(1)} ms  p95 ${f.p95.toFixed(1)}  worst ${f.worst.toFixed(0)} (last ${prof.frameMs.count})  main thread ${c.avg.toFixed(1)} ms  GPU ${gpu}`,
      `parts (ms): ${parts || '—'}`,
      `draw calls ${n.calls}  tris ${(n.triangles / 1000).toFixed(0)}k  programs ${n.programs}  textures ${n.textures}  geometries ${n.geometries}${n.heapMB ? `  heap ${n.heapMB.toFixed(0)} MB` : ''}  sim msg ${(prof.msgBytesAvg / 1024).toFixed(0)} KB`,
      `GL since loading: ${G.links} shader links (${G.compileMs.toFixed(0)} ms), ${G.texUploads} texture uploads (${(G.texBytes / 1048576).toFixed(1)} MB)`,
      `sim ${s.sim.kind}  tick ${s.sim.tickMs.toFixed(2)} ms  #${w.s.tick}  t=${w.s.time.toFixed(0)} s  speed ${s.loop.speed}×${s.loop.paused ? ' paused' : ''}`,
      `ants ${w.s.ants.length}  creatures ${w.s.creatures.length}  food ${w.s.food.length}  brood ${w.s.brood.length}`,
      `quality ${s.view.quality}${s.view.renderScale < 1 ? ` at ${Math.round(s.view.renderScale * 100)} % resolution` : ''}${s.autoQuality.enabled ? ` (auto${s.autoQuality.lastChange ? `, last ${s.autoQuality.lastChange}` : ''})` : ''}`,
      `pending commands ${s.commands.pending().length}`,
    ];
    const net = s.net;
    if (net) {
      const st = net.status();
      const pings = Object.entries(st.pings)
        .map(([p, ms]) => `${net.slots[Number(p)]?.name ?? p} ${ms} ms`)
        .join(', ');
      lines.push(
        `net ${net.isHost ? 'host' : 'guest'} as player ${net.self + 1}  input delay ${st.delay} ticks (${st.delay * 50} ms)  clock ×${st.speed}`,
        `pings ${pings || '—'}`,
        `queued ${net.lockstep.queued}  sent to #${net.lockstep.lastSent}  lead ${net.lockstep.lead()}${st.waitingFor.length ? `  WAITING for ${st.waitingFor.map((p) => net.slots[p]?.name ?? p).join(', ')} ${(st.waitingMs / 1000).toFixed(1)} s` : ''}`,
        `hash ${st.lastHash ? `#${st.lastHash.tick} ${st.lastHash.hash}` : '—'}  ${st.desync ? `DESYNC at #${st.desync.tick}` : 'in sync'}${st.dropped.length ? `  dropped: ${st.dropped.map((p) => net.slots[p]?.name ?? p).join(', ')}` : ''}`,
        `players (tick / frame ms): ${
          Object.entries(st.perf)
            .map(([p, [t, f]]) => `${net.slots[Number(p)]?.name ?? p} ${t.toFixed(1)} / ${f.toFixed(0)}`)
            .join(', ') || '—'
        }`,
      );
    }
    const hs = prof.hitches.slice(-6);
    lines.push(`hitches (frames over 33 ms): ${prof.hitches.length}${hs.length ? '' : ' — none'}`);
    for (const h of hs) lines.push(`  ${h.t.toFixed(1)} s  ${h.ms.toFixed(0)} ms (main ${h.cpu.toFixed(0)}): ${h.causes.join('; ')}`);
    lines.push(`climb rails and riding slots drawn (cyan)`);
    this.el.textContent = lines.join('\n');
  }
}
