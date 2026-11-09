"""Performance v5: what a frame draws — every draw of a few frames grouped by object and pass (scene or shadow), with
its triangles, and each pass timed with a read-back wait (SwiftShader here: the times are the CPU's drawing; the triangle
counts are what any GPU gets). Found the nest's shadow pass drawing the whole nest (598k of 1.29M triangles).

  tests/browser/with_server.sh python3 tests/browser/gpu_census.py
      Q="stress=1&ants=200&creatures=40&q=high" (the page)  NEST=1 (look into the home nest)  FRAMES=6  DPR=2  VW/VH  WARM=15
"""
import json, os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
Q = os.environ.get("Q", "stress=1&ants=200&creatures=40&q=high")
FR = int(os.environ.get("FRAMES", "6"))
VW = int(os.environ.get("VW", "480")); VH = int(os.environ.get("VH", "300")); DPR = float(os.environ.get("DPR", "2"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
HOOK = r"""(FR) => {
  const s = window.__session, v = s.view, r = v.renderer, gl = r.getContext();
  // (a read-back wait: fin() only flushes in Chromium — performance v5 round 2, dev/gpuBreakdown.ts gpuSync)
  const fin = (() => { const pt = gl.getParameter(gl.TEXTURE_BINDING_2D), pf = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.bindTexture(gl.TEXTURE_2D, pt);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, pf);
    const px = new Uint8Array(4);
    return () => { const d = gl.getParameter(gl.FRAMEBUFFER_BINDING), rd = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), sc = gl.isEnabled(gl.SCISSOR_TEST), m = gl.getParameter(gl.COLOR_WRITEMASK);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); if (sc) gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.colorMask(m[0], m[1], m[2], m[3]); if (sc) gl.enable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rd); }; })();
  const out = window.__gpu = { draws: {}, passes: {}, frames: 0, total: 0, tris: {}, dt: {} }; let tri0 = 0;
  let on = false, pass = 'scene', t = 0;
  const lab = (o) => { const n = []; let x = o; for (let i = 0; i < 4 && x; i++) { n.push(x.name || (x.isInstancedMesh ? 'Inst' : x.type)); x = x.parent; } return n.join('<') + ' [' + (o.material && (o.material.name || o.material.type)) + ']'; };
  const scenes = [v.surfaceScene, ...[...s.nests.values()].map(nv => nv.stage.scene)];
  for (const sc of scenes) sc.traverse(o => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    const L = lab(o);
    const b = o.onBeforeRender, a = o.onAfterRender;
    o.onBeforeRender = function (...x) { if (on) { fin(); t = performance.now(); tri0 = r.info.render.triangles; } return b.apply(this, x); };
    o.onAfterRender = function (...x) { const rr = a.apply(this, x); if (on) { fin(); const k = pass + ': ' + L; out.draws[k] = (out.draws[k] || 0) + performance.now() - t; out.dt[k] = (out.dt[k] || 0) + r.info.render.triangles - tri0; } return rr; };
    const bs = o.onBeforeShadow, as = o.onAfterShadow;
    o.onBeforeShadow = function (...x) { if (on) { fin(); t = performance.now(); tri0 = r.info.render.triangles; } return bs.apply(this, x); };
    o.onAfterShadow = function (...x) { const rr = as.apply(this, x); if (on) { fin(); const k = 'shadow: ' + L; out.draws[k] = (out.draws[k] || 0) + performance.now() - t; out.dt[k] = (out.dt[k] || 0) + r.info.render.triangles - tri0; } return rr; };
  });
  const render = r.render.bind(r);
  let depth = 0;
  r.render = function (sc, cam) {
    if (!on) return render(sc, cam);
    const rt = r.getRenderTarget();
    const name = scenes.includes(sc) ? 'scene' : ('quad ' + (sc.children[0] && sc.children[0].material ? (sc.children[0].material.fragmentShader || '').slice(0, 0) + (sc.children[0].material.name || sc.children[0].material.type) : sc.type) + ' ' + (rt ? rt.width + 'x' + rt.height : 'screen'));
    fin(); const t0 = performance.now(); pass = name;
    const res = render(sc, cam);
    fin(); out.passes[name] = (out.passes[name] || 0) + performance.now() - t0;
    return res;
  };
  // the FullScreenQuad renders through r.render(mesh, camera): that path is caught above (its scene is the mesh)
  const sm = r.shadowMap, smr = sm.render.bind(sm);
  sm.render = function (...x) { if (!on) return smr(...x); fin(); const t0 = performance.now(); pass = 'shadow'; const res = smr(...x); fin(); out.passes['shadow map'] = (out.passes['shadow map'] || 0) + performance.now() - t0; pass = 'scene'; return res; };
  const p = window.__prof, end = p.end.bind(p);
  let left = FR + 2;
  p.begin2 = 0;
  const begin = p.begin.bind(p);
  p.begin = function (...x) { if (left <= FR && left > 0) { on = true; fin(); this.__ft = performance.now(); } return begin(...x); };
  p.end = function () { const rr = end(); if (on) { fin(); out.total += performance.now() - this.__ft; out.frames++; out.tris.last = r.info.render.triangles; on = false; } left--; return rr; };
}"""
with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": VW, "height": VH}, device_scale_factor=DPR)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "?" + Q, wait_until="load", timeout=600000)
    pg.wait_for_function("window.__ready === true", timeout=900000)
    if os.environ.get("NEST", "1") == "1":
        pg.evaluate("() => { const s = window.__session, v = s.view; s.viewedArea = v.activeNest; v.space = 'nest'; v.onSpaceChanged && v.onSpaceChanged('nest'); }")
    time.sleep(float(os.environ.get("WARM", "15")))
    pg.evaluate(HOOK, FR)
    pg.wait_for_function("window.__gpu.frames >= %d" % FR, timeout=900000, polling=500)
    g = pg.evaluate("() => window.__gpu")
    n = g["frames"]
    print("frames", n, "avg frame (finish-to-finish) %.1f ms" % (g["total"] / n))
    print("passes:")
    for k, ms in sorted(g["passes"].items(), key=lambda kv: -kv[1]):
        print("  %7.2f  %s" % (ms / n, k))
    print("draws (top 30):")
    for k, ms in sorted(g["draws"].items(), key=lambda kv: -kv[1])[:30]:
        print("  %7.2f  %s" % (ms / n, k))
    print("triangles by draw (top 25):")
    for k, tr in sorted(g["dt"].items(), key=lambda kv: -kv[1])[:25]:
        print("  %9.0f  %s" % (tr / n, k))
    info = pg.evaluate("() => { const r = window.__session.view.renderer; return { calls: window.__prof.counts().calls, tris: window.__prof.counts().triangles, w: r.domElement.width, h: r.domElement.height }; }")
    print(info, "errors", errs[:3])
    b.close()
