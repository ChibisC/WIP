"""Performance v2 in the live page (worker mode): the units are drawn where the simulation has them (each one's drawn
position within a few ticks' travel of its own sim position — the playout's re-anchoring keeps every unit's own
record), the playout's α and latency stay in range, no page errors; a screenshot for the eye.

Run: BASE=http://127.0.0.1:5173/ python3 tests/browser/smooth_live.py   (OUT=<png>)
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.environ.get("OUT", "/tmp/smooth_live.png")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 640, "height": 400})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if "Simulation error" in m.text else None)
    pg.goto(BASE + "?play=1&q=low&seed=11&species=lasius&rival=solenopsis&developed=6&nocine=1&reveal=1", wait_until="load", timeout=600000)
    t0 = time.time()
    while time.time() - t0 < 900 and not pg.evaluate("!!(window.__session && window.__session.sim && window.__session.sim.kind === 'worker' && window.__session.world.s.tick > 200)"):
        time.sleep(2)
    res = pg.evaluate("""(() => {
      const s = window.__session; const w = s.world; const po = s.sim.playout;
      let worst = 0, n = 0, far = 0;
      const a = po.lastAlpha;
      for (const ant of w.s.ants) {
        if (ant.hp <= 0) continue;
        const dx = ant.px + (ant.x - ant.px) * a - ant.x, dy = ant.py + (ant.y - ant.py) * a - ant.y;
        const d = Math.hypot(dx, dy); n++;
        if (d > worst) worst = d;
        if (d > 20) far++;
      }
      return { tick: w.s.tick, ants: n, worst, far, alpha: a, latency: po.latency, kind: s.sim.kind };
    })()""")
    print(json.dumps(res), flush=True)
    try:
        pg.screenshot(path=OUT, timeout=600000)
    except Exception as e:  # (a busy software GPU: the numbers above are the check)
        print("screenshot skipped:", str(e).splitlines()[0])
    ok = res["kind"] == "worker" and res["ants"] > 20 and res["far"] == 0 and res["worst"] < 20 and 0 <= res["alpha"] <= 1.5 and 0.3 <= res["latency"] <= 4 and not errs
    print(("PASS" if ok else "FAIL") + f"  live page: {res['ants']} ants drawn within {res['worst']:.1f} mm of their sim positions, α {res['alpha']:.2f}, latency {res['latency']:.2f} ticks; errors {errs[:3]}")
    b.close()
    raise SystemExit(0 if ok else 1)
