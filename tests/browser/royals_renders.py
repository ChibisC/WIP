"""Queens, king and eggs (CHANGE_PLAN §15.5–15.6) in the real game: the queen
lies still with no egg pile beside her, workers pull eggs from the tip of her
abdomen, and the termite king stands beside his queen (not inside her).
Fails on page errors, shader warnings, a queen that moved, or a king that
overlaps the queen.

Run: tests/browser/with_server.sh python3 tests/browser/royals_renders.py
Screenshots: docs/creatures/royals-renders/
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "royals-renders")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)

SCENES = [("termite_royals", "nasutitermes", 28), ("lasius_queen_eggs", "lasius", 26), ("formica_queen_eggs", "formica", 30)]

INFO = """() => { const s = window.__session; const w = s.world; const c = s.player;
  const q = w.antById.get(c.queen); const k = c.king ? w.antById.get(c.king) : null;
  const pulling = w.s.ants.filter(a => a.colony === c.id && a.state === 16).length;
  return { qx: q.x, qy: q.y, kd: k ? Math.hypot(k.x - q.x, k.y - q.y) : -1, ql: q ? 0 : 0, eggs: c.eggs, pulling } }"""

res = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 960, "height": 560})
    for name, species, dist in SCENES:
        pg = ctx.new_page()
        pg.set_default_timeout(600000)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=low&seed=5&species={species}&rival=lasius&view=nest", wait_until="load")
        t0 = time.time()
        while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        a = pg.evaluate(INFO)
        seen = 0
        for k in range(60):
            pg.evaluate("window.__session.loop.advance(10)")
            i = pg.evaluate(INFO)
            seen = max(seen, i["pulling"])
            if i["pulling"] > 0 and k > 10:
                break
        z = pg.evaluate(INFO)
        pg.evaluate(f"""() => {{ const s = window.__session; const q = s.world.antById.get(s.player.queen); s.view.nestRig.jumpTo(q.x, q.y, {dist}); }}""")
        pg.evaluate("window.__step(3, 0.05)")
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        moved = abs(z["qx"] - a["qx"]) + abs(z["qy"] - a["qy"])
        ok = not errs and moved < 1e-6 and (species != "nasutitermes" or z["kd"] > 6) and seen > 0
        res.append(f"{'PASS' if ok else 'FAIL'}  {name} queen moved {moved:.3f} mm, king from queen {z['kd']:.1f} mm, egg pullers seen {seen} {errs[:3]}")
        pg.close()
    b.close()
for r in res:
    print(r)
print("FAILED" if any(r.startswith("FAIL") for r in res) else "royals renders OK")
