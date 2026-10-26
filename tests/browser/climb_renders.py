"""Climbing check in the real game (CHANGE_PLAN §15.2): ants and termites
attack a large creature, run to a foot, climb a leg, ride its back and climb
down. Takes close shots of climbers on the animated legs and riders on the
back (with the rails and slots debug overlay in one), and fails on page
errors, shader warnings, or if nobody climbed.

Run: tests/browser/with_server.sh python3 tests/browser/climb_renders.py
Screenshots: docs/creatures/climb-renders/
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "climb-renders")
ONLY = os.environ.get("ONLY", "")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)

SCENES = [
    # name, species, battle spec, creature, wait for phase (1 up / 2 riding), camera distance, debug overlay
    ("beetle_riders", "lasius", "lasius_soldier:14", "stagBeetle", 2, 70, False),
    ("beetle_climbing", "lasius", "lasius_soldier:14", "stagBeetle", 1, 28, False),
    ("beetle_rails_debug", "lasius", "lasius_soldier:14", "stagBeetle", 2, 80, True),
    ("tarantula_riders", "formica", "formica_soldier:16", "tarantula", 2, 150, False),
    ("centipede_riders", "lasius", "lasius_soldier:16", "scolopendra", 2, 110, False),
    ("mantis_riders", "aurimyrmex", "aurimyrmex_soldier:14", "giantMantis", 2, 90, False),
    ("termites_riding", "nasutitermes", "nasute_major:8", "stagBeetle", 2, 70, False),
    ("ground_beetle", "lasius", "lasius_worker:12", "groundBeetle", 2, 30, False),
]

STATS = """() => { const w = window.__session.world;
  const c = w.s.ants.filter(a => a.state === 38);
  const cr = w.s.creatures.find(x => !x.dead);
  return { walk: c.filter(a => a.ridePh === 0).length, up: c.filter(a => a.ridePh === 1).length, ride: c.filter(a => a.ridePh === 2).length,
           down: c.filter(a => a.ridePh === 3).length, creature: cr ? cr.kind : null, climbers: cr ? (cr.climbers || 0) : 0,
           hp: cr ? Math.round(cr.hp) : 0 } }"""

FOCUS = """([dist, ph]) => { const s = window.__session; const w = s.world;
  const cr = w.s.creatures.find(x => !x.dead); if (!cr) return null;
  // keep the scene still: the creature cannot die during the check
  cr.hp = cr.maxHp;
  let x = cr.x, y = cr.y;
  const a = w.s.ants.find(a => a.state === 38 && a.ridePh === ph);
  if (a && ph === 1) { x = a.x; y = a.y; }
  s.view.surfaceRig.jumpTo(x, y, dist); s.view.surfaceRig.pitchBias = 0.7;
  if (s.view.props) s.view.props.group.visible = false; if (s.view.grass) s.view.grass.mesh.visible = false;
  return { x, y } }"""

res = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 960, "height": 560})
    for name, species, battle, kind, ph, dist, debug in SCENES:
        if ONLY and ONLY not in name:
            continue
        pg = ctx.new_page()
        pg.set_default_timeout(600000)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
        q = f"?play=1&shot=1&noui=1&q=low&seed=5&creatures=0&species={species}&rival={'formica' if species != 'formica' else 'lasius'}&battle={battle}&spawn={kind}" + ("&climbdebug=1" if debug else "")
        pg.goto(BASE + q, wait_until="load")
        t0 = time.time()
        while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        # the creature must survive the check
        pg.evaluate("() => { const cr = window.__session.world.s.creatures.find(x => !x.dead); if (cr) { cr.hp = cr.maxHp = 1e6; } }")
        st = {}
        seen = False
        for k in range(120):
            pg.evaluate("window.__session.loop.advance(3)")
            st = pg.evaluate(STATS)
            if (ph == 2 and st["ride"] >= 3) or (ph == 1 and st["up"] >= 1):
                seen = True
                break
        pg.evaluate(FOCUS, [dist, ph])
        pg.evaluate("window.__step(2, 0.05)")
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        ok = seen and not errs
        res.append(f"{'PASS' if ok else 'FAIL'}  {name} seen={seen} {st} {errs[:3]}")
        pg.close()
    b.close()

for r in res:
    print(r)
print("FAILED" if any(r.startswith("FAIL") for r in res) else "all climbing renders OK")
