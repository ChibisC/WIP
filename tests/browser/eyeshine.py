"""Wolf spider eyeshine at night (render only; claude/story/04-spec §2): a wolf spider on the stony hollow at night, seen
from in front (the glints) and from behind (none). Fails on page errors.

Run: tests/browser/with_server.sh python3 tests/browser/eyeshine.py   → docs/story/shots/ch1_4/eyeshine_*.jpg
"""
import math
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "story", "shots", "ch1_4")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 1100, "height": 680})
    pg.set_default_timeout(1800000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    t0 = time.time()
    pg.goto(BASE + "?story=longNights&shot=1&noui=1&nocine=1&q=high&seed=3&ticks=20", wait_until="load")
    while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    # a wolf spider in the hollow, the story clock at the middle of the first night (moonlight), still
    sp = pg.evaluate("""() => { const s = window.__session, w = s.world;
      w.s.time = 420 + 60;
      const c = w.s.creatures.find((x) => x.kind === 'wolfSpider') ?? null;
      return c ? { x: c.x, y: c.y, h: c.h } : null; }""")
    if not sp:
        pg.evaluate("() => { const w = window.__session.world; const m = w.s.mode.mission; m.stage = 1; m.entered = false; w.s.time = 420 + 210 + 330 - 10; }")
        for _ in range(10):
            pg.evaluate("() => { const w = window.__session.world; for (let i = 0; i < 40; i++) { w.step(0.05); w.events.drain(); } }")
        sp = pg.evaluate("() => { const c = window.__session.world.s.creatures.find((x) => x.kind === 'wolfSpider' && !x.dead); return c ? { x: c.x, y: c.y, h: c.h } : null; }")
    # hold the world still (the frames still render) so the camera stays on the spider
    pg.evaluate("() => { window.__session.loop.paused = true; }")
    sp = pg.evaluate("() => { const c = window.__session.world.s.creatures.find((x) => x.kind === 'wolfSpider' && !x.dead); return { x: c.x, y: c.y, h: c.h }; }")
    print('spider', sp, 'night', pg.evaluate("window.__session.world.s.night"), flush=True)
    for name, yaw_off in (("front", 0.0), ("behind", math.pi)):
        yaw = math.pi / 2 - sp["h"] + yaw_off
        pg.evaluate(f"() => {{ const r = window.__session.view.surfaceRig; r.jumpTo({sp['x']}, {sp['y']}, 70); r.yaw = r.goalYaw = {yaw}; r.pitchBias = -0.15; }}")
        pg.evaluate("window.__step(60, 0.05)")
        pg.screenshot(path=os.path.join(OUT, f"eyeshine_{name}.jpg"), type="jpeg", quality=88)
        print("shot", name, flush=True)
    b.close()
print("FAIL: " + " | ".join(errs[:4]) if errs else "eyeshine shots done")
