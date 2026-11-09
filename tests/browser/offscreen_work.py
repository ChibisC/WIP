"""Planes off screen do no render work (performance v4, claude/performance/04-spec-performance-v4-on-screen-spikes-story.md
§2 and §5): normal play on the ground with the trees on, every call that would update a plane not on screen counted —
the nest views and their tiles, the nests' and the canopy's mesh updates, the trees' backdrop, effects sent to the GPU —
then the same while one nest is shown (the ground, the other nests and the trees off screen).

  tests/browser/with_server.sh python3 tests/browser/offscreen_work.py      (SECS=30 a view)
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
SECS = float(os.environ.get("SECS", "30"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

HOOK = """() => {
  const s = window.__session, v = s.view;
  const c = (window.__counts = {});
  const shownSpace = () => (v.space === 'surface' ? 0 : v.activeNest);
  const count = (name) => (c[name] = (c[name] || 0) + 1);
  for (const [sp, nv] of s.nests) {
    const u = nv.update.bind(nv);
    nv.update = (...a) => { if (sp !== shownSpace()) count('nest view update, off screen'); return u(...a); };
    const h = nv.updateHexes.bind(nv);
    nv.updateHexes = (...a) => { if (sp !== shownSpace()) count('nest tiles, off screen'); return h(...a); };
    const t = nv.stage.terrain;
    const tu = t.update.bind(t);
    t.update = (...a) => { if (sp !== shownSpace() && !v.transitioning) count('nest or canopy mesh update, off screen'); return tu(...a); };
    const fx = nv.fx;
    const fu = fx.update.bind(fx);
    fx.update = (dt, h2, px, upload = true) => { if (upload && sp !== shownSpace() && !v.transitioning) count('effects to the GPU, off screen'); return fu(dt, h2, px, upload); };
  }
  const sf = s.surfFx;
  const su = sf.update.bind(sf);
  sf.update = (dt, h2, px, upload = true) => { if (upload && v.space !== 'surface' && !v.transitioning) count('ground effects to the GPU, off screen'); return su(dt, h2, px, upload); };
  const rb = v.refreshBackdrop.bind(v);
  v.refreshBackdrop = (...a) => { if (!v.inTrees && !v.transitioning) count('trees backdrop, trees off screen'); return rb(...a); };
  const m = s.mounds;
  const mu = m.update.bind(m);
  m.update = (...a) => { if (v.space !== 'surface') count('anthills, ground off screen'); return mu(...a); };
  const sa = s.surfAnts;
  const au = sa.update.bind(sa);
  sa.update = (...a) => { if (v.space !== 'surface') count('ground ants, ground off screen'); return au(...a); };
}"""

out = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 320, "height": 200})
    pg.set_default_timeout(1800000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "?play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1&trees=1&q=low", wait_until="load")
    pg.wait_for_function("window.__ready === true", timeout=1800000)
    pg.evaluate("() => { window.__session.view.renderer.render = function () {}; }")
    pg.evaluate(HOOK)
    time.sleep(SECS)
    out["on the ground"] = pg.evaluate("() => { const c = window.__counts; window.__counts = {}; return c; }")
    pg.evaluate("() => window.__session.showArea(window.__session.player.id + 1)")
    pg.wait_for_function("() => window.__session.view.space === 'nest' && !window.__session.view.transitioning", timeout=120000)
    pg.evaluate("() => { for (const k in window.__counts) delete window.__counts[k]; }")
    time.sleep(SECS)
    out["in the home nest"] = pg.evaluate("() => window.__counts")
    frames = pg.evaluate("() => window.__prof.frame")
    b.close()
print(json.dumps(out, indent=1))
print("frames", frames, "page errors:", errs[:2])
bad = sum(sum(v.values()) for v in out.values())
print("PASS: no render work for planes off screen" if bad == 0 else f"FAIL: {bad} calls")
raise SystemExit(0 if bad == 0 else 1)
