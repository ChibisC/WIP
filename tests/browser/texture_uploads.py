"""Performance v5: which textures are uploaded every frame, and the code that flags them (Texture.needsUpdate traced)
— in the full nest, the ants' body-offset textures, one per model and level of detail.

  tests/browser/with_server.sh python3 tests/browser/texture_uploads.py   (Q=page NEST=1 SECS=8)
"""
import json, os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
Q = os.environ.get("Q", "stress=1&ants=200&creatures=40&q=high&worker=1")
SECS = float(os.environ.get("SECS", "8"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
HOOK = r"""() => {
  const s = window.__session, v = s.view;
  // find THREE.Texture.prototype from any texture in the scene
  let tex = null;
  const seen = new Set();
  const look = (o) => o.traverse && o.traverse(m => { const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []; for (const mat of mats) { for (const k in mat) { const x = mat[k]; if (x && x.isTexture) tex = tex || x; } if (mat.uniforms) for (const k in mat.uniforms) { const x = mat.uniforms[k].value; if (x && x.isTexture) tex = tex || x; } } });
  look(v.scene || v.surfaceScene); for (const [, nv] of s.nests) look(nv.scene || nv.stage.scene);
  let P = Object.getPrototypeOf(tex);
  while (P && !Object.getOwnPropertyDescriptor(P, 'needsUpdate')) P = Object.getPrototypeOf(P);
  const d = Object.getOwnPropertyDescriptor(P, 'needsUpdate');
  window.__texlog = {};
  window.__texframe = 0;
  Object.defineProperty(P, 'needsUpdate', { set(val) {
      if (val === true && window.__texon) {
        const st = (new Error().stack || '').split('\n').slice(2, 5).map(x => x.trim().replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:]*/, '')).join(' < ');
        const im = this.image || {};
        const key = (this.name || this.constructor.name) + ' ' + (im.width||'?') + 'x' + (im.height||'?') + ' | ' + st;
        window.__texlog[key] = (window.__texlog[key] || 0) + 1;
      }
      d.set.call(this, val);
    }, get: d.get, configurable: true });
  const p = window.__prof; const end = p.end.bind(p);
  p.end = function () { if (window.__texon) window.__texframe++; return end(); };
}"""
with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 480, "height": 300})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "?" + Q, wait_until="load", timeout=600000)
    pg.wait_for_function("window.__ready === true", timeout=600000)
    pg.evaluate(HOOK)
    if os.environ.get("NEST", "1") == "1":
        pg.evaluate("() => { const s = window.__session, v = s.view; s.viewedArea = v.activeNest; v.space = 'nest'; v.onSpaceChanged && v.onSpaceChanged('nest'); }")
    time.sleep(4)
    pg.evaluate("() => { window.__texon = true; }")
    time.sleep(SECS)
    r = pg.evaluate("() => ({ frames: window.__texframe, log: window.__texlog, space: window.__session.view.space })")
    print("frames", r["frames"], "space", r["space"])
    for k, n in sorted(r["log"].items(), key=lambda kv: -kv[1])[:30]:
        print(f"{n:5d}  {k}")
    print("errors", errs[:3])
    b.close()
