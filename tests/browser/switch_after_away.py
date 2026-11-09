"""Switching after time away (performance v4): play on the surface for a while (the nests dig, nothing off screen is
kept current), then open each area and come back; every frame's main-thread time during each switch, how long the
swap waited for the area's mesh, and the chunks it had to rebuild."""
import json, os, time
from playwright.sync_api import sync_playwright
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
AWAY = float(os.environ.get("AWAY", "45"))
NORENDER = os.environ.get("NORENDER", "1") == "1"
with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 320, "height": 200})
    pg.set_default_timeout(1800000)
    pg.goto("http://127.0.0.1:5173/?play=1&seed=11&areas=1&species=lasius&rival=solenopsis&reveal=1&developed=6&nocine=1&q=low", wait_until="load")
    pg.wait_for_function("window.__ready === true", timeout=1800000)
    if NORENDER:
        pg.evaluate("() => { window.__session.view.renderer.render = function () {}; }")
    pg.evaluate("""() => { const p = window.__prof; p.__rec = []; const end = p.end.bind(p);
      p.end = function () { const cpu = performance.now() - this.cpuStart; const v = window.__session.view;
        p.__rec.push({ t: performance.now(), cpu: +cpu.toFixed(1), nest: +(this.cur.nest || 0).toFixed(1), tr: v.transitioning, sp: v.space, fade: v.fadedOut }); end(); }; }""")
    areas = pg.evaluate("() => window.__session.areaTabs().filter(t => t.open).map(t => t.space)")
    out = []
    for a in areas:
        time.sleep(AWAY)
        dirty = pg.evaluate(f"() => window.__session.nests.get({a}).stage.terrain.dirty")
        pg.evaluate("() => { window.__prof.__rec.length = 0; }")
        t0 = pg.evaluate("() => performance.now()")
        pg.evaluate(f"() => window.__session.showArea({a})")
        pg.wait_for_function("() => !window.__session.view.transitioning", timeout=60000)
        time.sleep(0.5)
        rec = pg.evaluate("() => window.__prof.__rec")
        tr = [f for f in rec if f["tr"]]
        swapAt = next((f["t"] for f in rec if f["sp"] == "nest"), None)
        held = sum(1 for f in rec if f["tr"] and f["fade"])
        out.append({"area": a, "dirty": dirty, "frames": len(tr), "worst": max([f["cpu"] for f in tr] or [0]), "over33": sum(1 for f in tr if f["cpu"] > 33), "nestMax": max([f["nest"] for f in tr] or [0]), "fadedFrames": held, "toSwap_ms": round(swapAt - t0) if swapAt else None, "after": max([f["cpu"] for f in rec if not f["tr"]] or [0])})
        pg.evaluate("() => window.__session.toggleView()")
        pg.wait_for_function("() => !window.__session.view.transitioning && window.__session.view.space === 'surface'", timeout=60000)
    print(json.dumps(out, indent=1))
    b.close()
