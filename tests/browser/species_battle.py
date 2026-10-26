"""The new species in a real game: battle demos on the surface (nasutes firing
glue, majors, hell ants snapping, Saiy-Ants turning gold) and the termite nest
with its king and queen. Saves screenshots next to the lab renders and fails
on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/species_battle.py
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures")
res = []

CASES = [
    ("nasutitermes-renders", "game_battle", "species=nasutitermes&rival=lasius&battle=nasute_soldier:6,lasius_worker:6", [40, 40]),
    ("nasutitermes-renders", "game_majors", "species=nasutitermes&rival=formica&battle=nasute_major:4,formica_worker:6", [50, 40]),
    ("hell-ant-renders", "game_battle", "species=hell&rival=lasius&battle=hell_worker:6,lasius_worker:6", [50, 30]),
    ("aurimyrmex-renders", "game_battle", "species=aurimyrmex&rival=lasius&battle=aurimyrmex_worker:6,lasius_worker:6", [45, 20]),
]


def wait_ready(pg, t=300):
    t0 = time.time()
    while time.time() - t0 < t and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


def focus(pg, dist):
    pg.evaluate(f"""() => {{
      const s = window.__session; const w = s.world; const me = s.player.id;
      const mine = w.s.ants.filter(a => a.colony === me && a.space === 0 && a.state !== 28);
      if (!mine.length) return;
      const x = mine.reduce((t, a) => t + a.x, 0) / mine.length, y = mine.reduce((t, a) => t + a.y, 0) / mine.length;
      s.view.surfaceRig.jumpTo(x, y, {dist});
    }}""")


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1200, "height": 700})
    for folder, name, query, steps in CASES:
        pg = ctx.new_page()
        pg.set_default_timeout(240000)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if ("marker missing" in m.text or "THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=low&seed=5&{query}", wait_until="load")
        wait_ready(pg)
        info = []
        for k, n in enumerate(steps):
            pg.evaluate(f"window.__step({n}, 0.05)")
            focus(pg, 32)
            pg.evaluate("window.__step(2, 0.05)")
            out = os.path.join(ROOT, folder, f"{name}_{k}.png")
            pg.screenshot(path=out)
            info.append(pg.evaluate("""() => { const w = window.__session.world; const me = window.__session.player.id;
              const a = w.s.ants.filter(x => x.colony === me);
              return { gold: a.filter(x => (x.surgeT||0) > 0).length, firing: a.filter(x => x.fire).length, held: w.s.ants.filter(x => x.heldBy).length, alive: a.filter(x => x.state !== 28).length } }"""))
        res.append(f"{'PASS' if not errs else 'FAIL'}  {folder}/{name} {info} {errs[:3]}")
        pg.close()
    # the termite nest: queen, king, brood
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "?play=1&shot=1&noui=1&q=low&seed=5&species=nasutitermes&rival=lasius&ticks=600&view=nest", wait_until="load")
    wait_ready(pg)
    pg.evaluate("""() => { const s = window.__session; const w = s.world; const c = s.player; const q = w.antById.get(c.queen);
      s.view.nestRig.jumpTo(q.x, q.y, 40); }""")
    pg.evaluate("window.__step(3, 0.05)")
    pg.screenshot(path=os.path.join(ROOT, "nasutitermes-renders", "game_royal_chamber.png"))
    res.append(f"{'PASS' if not errs else 'FAIL'}  nasutitermes-renders/game_royal_chamber {errs[:3]}")
    b.close()

for r in res:
    print(r)
print("FAILED" if any(r.startswith("FAIL") for r in res) else "all game renders OK")
