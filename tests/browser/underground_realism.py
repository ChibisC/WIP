"""Before / after renders for the realism pass on the underground textures (user note 2026-11-01 23:55): each colony's
nest at gameplay zoom, its queen's chamber close up, a wall close up at a low angle, and its entrance. Fails on page
errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/underground_realism.py   (TAG=before|after  PAGES=0,1  ONLY=…)
Screenshots: docs/realism/underground/<tag>_<species>_<view>.jpg (render-only)
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
TAG = os.environ.get("TAG", "after")
ONLY = os.environ.get("ONLY", "")
GROUPS = [int(g) for g in os.environ.get("PAGES", "0,1").split(",")]
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "realism", "underground")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)

PAGES = [
    ["lasius", "formica", "atta", "solenopsis"],
    ["termant", "nasutitermes", "rhynchotermes", "eciton"],
]
# (camera distance in hex radii, pitch bias, where: 'queen' chamber, the 'entrance', or a 'wall' beside the chamber)
VIEWS = {"nest": (34, 0.5, "queen"), "chamber": (11, 0.55, "queen"), "wall": (6, 0.28, "wall"), "entrance": (12, 0.5, "entrance")}
res = []


def note(r):
    res.append(r)
    print(r, flush=True)


def want(name):
    return not ONLY or any(o in name for o in ONLY.split(","))


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    for gi in GROUPS:
        sp = PAGES[gi]
        ctx = b.new_context(viewport={"width": 1280, "height": 760})
        errs = []
        pg = ctx.new_page()
        pg.set_default_timeout(900000)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
        t0 = time.time()
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=high&seed=3&creatures=0&teams=4&map=testPond&species={sp[0]}&rival={','.join(sp[1:])}&ticks=40", wait_until="load")
        while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        note(f"loaded {','.join(sp)} in {time.time() - t0:.0f} s")
        pg.evaluate("window.__session.loop.advance(40 * 20)")
        for ci, name in enumerate(sp):
            for vn, (k, pitch, where) in VIEWS.items():
                if not want(f"{name}_{vn}"):
                    continue
                ok = pg.evaluate(f"""() => {{
                  const s = window.__session; const w = s.world; const space = {ci} + 1;
                  if (!s.nests.get(space)) return false;
                  s.viewedArea = space; s.view.setActiveNest(space); s.view.space = 'nest';
                  const g = w.nestOf(space); const c = w.colony({ci});
                  let q = g.entrances[0];
                  if ('{where}' !== 'entrance') q = c.tiles.find((t) => t.type === 'queen').q;
                  let p = g.hexCenter(q);
                  if ('{where}' === 'wall') {{
                    // the nearest undug hex beside the chamber's dug floor: look at the wall between them
                    let best = -1, bd = 1e9;
                    for (let h = 0; h < g.cols * g.rows; h++) {{
                      if (g.isHexDug(h) || !g.neighbors(h).some((n) => n >= 0 && g.isHexDug(n))) continue;
                      const d = g.hexDistance(h, q);
                      if (d < bd) {{ bd = d; best = h; }}
                    }}
                    const a = g.hexCenter(best); p = {{ x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 }};
                  }}
                  const r = s.view.nestRig;
                  r.jumpTo(p.x, p.y + g.R * 0.4, g.R * {k}); r.pitchBias = {pitch};
                  return true; }}""")
                if not ok:
                    note(f"SKIP  {name}_{vn}")
                    continue
                pg.evaluate("window.__step(4, 1/30)")
                pg.screenshot(path=os.path.join(OUT, f"{TAG}_{name}_{vn}.jpg"), type="jpeg", quality=84)
                note(f"{'PASS' if not errs else 'FAIL'}  {TAG}_{name}_{vn} {errs[:2]}")
        ctx.close()
    b.close()

bad = [r for r in res if r.startswith("FAIL")]
print(f"{len([r for r in res if r.startswith('PASS')])} rendered, {len(bad)} failed")
raise SystemExit(1 if bad else 0)
