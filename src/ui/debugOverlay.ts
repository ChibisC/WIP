/**
 * F3 debug overlay (multiplayer brief, Part F): frame rate and frame time,
 * simulation tick time and where the simulation runs, the tick, entity
 * counts, graphics quality, and in multiplayer the input delay, pings,
 * pending commands, waiting state, the last state hash and desync status.
 */
import type { GameSession } from '../game/session';

export class DebugOverlay {
  private el = document.createElement('pre');
  private on = false;
  private last = 0;
  private frames: number[] = [];

  constructor(
    private s: GameSession,
    parent: HTMLElement,
  ) {
    this.el.className = 'debug-overlay';
    parent.appendChild(this.el);
    s.input.on('debug', () => this.toggle());
    const loop = (t: number) => {
      if (this.last) this.frames.push(t - this.last);
      if (this.frames.length > 120) this.frames.shift();
      this.last = t;
      if (this.on) this.render();
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
    const f = this.frames.length ? this.frames.slice().sort((a, b) => a - b) : [16];
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    const worst = f[f.length - 1];
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `FPS ${(1000 / avg).toFixed(0)}  frame ${avg.toFixed(1)} ms (worst ${worst.toFixed(0)} ms of last ${f.length})`,
      `sim ${s.sim.kind}  tick ${s.sim.tickMs.toFixed(2)} ms  #${w.s.tick}  t=${w.s.time.toFixed(0)} s  speed ${s.loop.speed}×${s.loop.paused ? ' paused' : ''}`,
      `ants ${w.s.ants.length}  creatures ${w.s.creatures.length}  food ${w.s.food.length}  brood ${w.s.brood.length}`,
      `quality ${s.view.quality}${s.autoQuality.enabled ? ` (auto${s.autoQuality.lastChange ? `, last ${s.autoQuality.lastChange}` : ''})` : ''}  draw calls ${s.view.renderer.info.render.calls}  tris ${(s.view.renderer.info.render.triangles / 1000).toFixed(0)}k${mem ? `  heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : ''}`,
      `pending commands ${s.commands.pending().length}`,
      `climb rails and riding slots drawn (cyan)`,
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
      );
    }
    this.el.textContent = lines.join('\n');
  }
}
