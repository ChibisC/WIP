/**
 * The lag report (performance v6, claude/performance/06-spec-performance-v6-no-hitches-ever.md §4): the frames over
 * 100 ms since loading, from the profiler's lag recorder (core/profiler.ts `lag`), with what was in each — shader
 * compiles, uploads, the parts of the frame that took the time, notes such as a model built — and what the game was
 * doing, as text to copy and send. Menu → Graphics → "Copy lag report", or the button with the F3 overlay.
 */
import type { GameSession } from '../game/session';
import { LAG_MS, prof } from '../core/profiler';
import { BUILD_ID } from '../net/messages';

/** The GPU's name as the browser gives it. */
function gpuName(s: GameSession): string {
  try {
    const gl = s.view.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch {
    return '?';
  }
}

/** What the game is doing now, for a lag record (set as the profiler's `lagContext` by the session). */
export function lagContext(s: GameSession): string {
  const v = s.view;
  const rig = v.space === 'nest' ? v.nestRig : v.surfaceRig;
  const w = s.world;
  return `${v.space}${v.inTrees ? ' (trees)' : ''}, camera ${rig.distance.toFixed(0)} mm, ${w.s.ants.length} ants, ${w.s.creatures.length} creatures, speed ${s.loop.speed}×${s.loop.paused ? ' paused' : ''}, tick #${w.s.tick}`;
}

/** The report's text. */
export function lagReportText(s: GameSession): string {
  const q = new URLSearchParams(location.search);
  const f = prof.frameMs.summary();
  const c = prof.cpuMs.summary();
  const G = prof.glSince();
  const out: string[] = [];
  out.push(`Underground Dominion lag report — build ${BUILD_ID}, ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`);
  out.push(`page: ${q.get('mode') ?? (q.get('play') ? 'game' : 'menu')}${q.get('map') ? `, map ${q.get('map')}` : ''}${q.get('level') ? `, level ${q.get('level')}` : ''}; ${(performance.now() / 1000).toFixed(0)} s since the page opened`);
  out.push(`browser: ${navigator.userAgent}`);
  out.push(`GPU: ${gpuName(s)}; screen ${window.innerWidth}×${window.innerHeight} at ${(window.devicePixelRatio || 1).toFixed(2)}×; quality ${s.view.quality}${s.view.renderScale < 1 ? ` at ${Math.round(s.view.renderScale * 100)} %` : ''}`);
  out.push(`now: ${lagContext(s)}`);
  out.push(`frames now: ${(1000 / Math.max(1, f.avg)).toFixed(0)} fps, ${f.avg.toFixed(1)} ms (p95 ${f.p95.toFixed(1)}, worst ${f.worst.toFixed(0)} of the last ${prof.frameMs.count}), main thread ${c.avg.toFixed(1)} ms`);
  out.push(`GL since loading: ${G.links} shader links (${G.compileMs.toFixed(0)} ms), ${G.texUploads} texture uploads (${(G.texBytes / 1048576).toFixed(1)} MB)`);
  const L = prof.lag;
  out.push('');
  out.push(`frames over ${LAG_MS} ms since loading: ${prof.lagCount}${prof.lagCount > L.length ? ` (the last ${L.length} below)` : ''}${L.length ? '' : ' — none'}`);
  for (const h of L)
    out.push(
      `  ${h.at}  ${h.ms.toFixed(0)} ms, main thread ${h.cpu.toFixed(0)} ms — ${h.causes.join('; ')}${h.ctx ? `  [${h.ctx}]` : ''}`,
    );
  // (a long frame whose main thread was short: the time went outside the page — the GPU, the browser, the system)
  const outside = L.filter((h) => h.cpu < h.ms * 0.4).length;
  if (outside) out.push(`(${outside} of them spent most of their time outside the page's thread: the GPU, the browser or the system)`);
  return out.join('\n');
}

/** Copy the report; `done` gets whether it worked (the text is also put in the console). */
export function copyLagReport(s: GameSession, done?: (ok: boolean) => void): void {
  const text = lagReportText(s);
  console.log(text);
  const fallback = () => {
    // (no clipboard permission: a hidden text box, selected and copied)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    done?.(ok);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done?.(true), fallback);
  else fallback();
}
