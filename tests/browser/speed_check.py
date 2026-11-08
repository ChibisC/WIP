"""Game speed under load (performance v3): the big stress fight in the real page (worker simulation), at 1×, 2×, 4× and
8×. For each speed: the speed the game actually reached (ticks advanced per second of real time ÷ 20), the worker's
tick time, frames and the main thread's parts per frame (messages, events, units, ui), and frames over 50 ms.

  tests/browser/with_server.sh python3 tests/browser/speed_check.py     (PER=200 ants a colony, SECS=8, SPEEDS=1,2,4,8)
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
PER = int(os.environ.get("PER", "200"))
SECS = float(os.environ.get("SECS", "8"))
SPEEDS = [float(x) for x in os.environ.get("SPEEDS", "1,2,4,8").split(",")]
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

SNAP = """() => {
  const s = window.__session, p = window.__prof;
  const parts = {};
  for (const k of ['msg', 'events', 'units', 'creatures', 'fx', 'ui', 'render']) parts[k] = [p.parts[k].total, p.parts[k].pushes];
  return { tick: s.world.s.tick, now: performance.now(), frames: p.frameMs.pushes, frameTotal: p.frameMs.total, tickMs: s.sim.tickMs, parts,
           long: p.hitches.length, ants: s.world.s.ants.length };
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 320, "height": 200})
    pg.set_default_timeout(1800000)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + f"?stress=1&ants={PER}&creatures=100&bosses=2&q=low", wait_until="load")
    pg.wait_for_function("window.__ready === true", timeout=1800000)
    time.sleep(10)
    rows = []
    for sp in SPEEDS:
        pg.evaluate(f"() => window.__session.setSpeed({sp})")
        time.sleep(3)
        a = pg.evaluate(SNAP)
        frames_over = pg.evaluate("() => window.__prof.frameMs.pushes")
        time.sleep(SECS)
        z = pg.evaluate(SNAP)
        dt = (z["now"] - a["now"]) / 1000
        reached = (z["tick"] - a["tick"]) / dt / 20
        nf = max(1, z["frames"] - a["frames"])
        per = {k: (z["parts"][k][0] - a["parts"][k][0]) / max(1, z["parts"][k][1] - a["parts"][k][1]) for k in z["parts"]}
        row = {"speed": sp, "reached": round(reached, 2), "tickMs": round(z["tickMs"], 1), "fps": round(nf / dt, 1),
               "msg": round(per["msg"], 2), "events": round(per["events"], 2), "units": round(per["units"], 2), "fx": round(per["fx"], 2),
               "ui": round(per["ui"], 2), "ants": z["ants"]}
        rows.append(row)
        print(json.dumps(row), flush=True)
    pg.evaluate("() => window.__session.setSpeed(1)")
    print("page errors:", errors[:3])
    b.close()
