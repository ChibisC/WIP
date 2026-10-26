"""The stress scenario in the browser (multiplayer brief, Part F): 4 x 400 ants and 100 creatures with
the simulation in the worker. Prints frame and tick statistics. In the build container rendering is
software (SwiftShader), which takes the container's CPU cores from the worker too, so there the
frame and tick numbers only compare builds with each other (tools/stress.ts measures the tick on its
own). On a machine with a GPU the tick must stay under 15 ms.

  tests/browser/with_server.sh python3 tests/browser/stress.py [secs=40] [quality=low] [species=a,b,c,d]
"""
import json, sys, time
from playwright.sync_api import sync_playwright

secs = sys.argv[1] if len(sys.argv) > 1 else '40'
q = sys.argv[2] if len(sys.argv) > 2 else 'low'
species = sys.argv[3] if len(sys.argv) > 3 else ''   # e.g. nasutitermes,hell,aurimyrmex,lasius
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    pg.set_default_timeout(300000)
    pg.goto(f"http://127.0.0.1:5173/?stress=1&secs={secs}&q={q}" + (f"&species={species}" if species else ""))
    t0 = time.time()
    while time.time() - t0 < int(secs) + 240 and not pg.evaluate("!!window.__stress"): time.sleep(1)
    r = pg.evaluate("window.__stress")
    print(json.dumps(r, indent=1))
    pg.screenshot(path="shots/mp_stress_browser.jpg", quality=75)
    gl = pg.evaluate("(()=>{const g=document.createElement('canvas').getContext('webgl2');const d=g&&g.getExtension('WEBGL_debug_renderer_info');return d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):''})()")
    soft = 'SwiftShader' in gl or 'llvmpipe' in gl
    ok = bool(r) and r['ants'] > 1200 and r['sim'] == 'worker' and r['ticksRun'] > 0
    print('PASS' if ok else 'FAIL', ' stress: 1,600 ants and 100 creatures run with the simulation in the worker')
    if not soft:
        ok2 = r['tickAvg'] < 15
        ok = ok and ok2
        print('PASS' if ok2 else 'FAIL', ' stress: simulation tick under 15 ms in the worker', f"{r['tickAvg']:.1f} ms")
    else:
        print(f"note: software rendering ({gl}); tick {r['tickAvg']:.1f} ms is not representative")
    b.close()
    sys.exit(0 if ok else 1)
