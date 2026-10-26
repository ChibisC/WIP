"""Renders of the authored maps (docs/maps/design.md §6) for the art review: an overview from high up, the
pond and a stone crossing, a colony site, the rocks, and a low ant's-eye view. Fails on page errors or
shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/map_renders.py   (MAP=<id>, ONLY=<view name parts, comma-separated>)
Screenshots: docs/maps/renders/<map>_<view>.jpg
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
MAP = os.environ.get("MAP", "meadowPond")
ONLY = os.environ.get("ONLY", "")
Q = os.environ.get("Q", "high")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "maps", "renders")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)

# name: (cx, cz, dist, yaw, pitchBias) — None picks from the map (site 0 / the first walkway / the first wall)
VIEWS = {
    "meadowPond": {
        "overview": (800, 800, 1500, 0.0, 0.9),
        "pond": (800, 800, 520, 0.6, 0.35),
        "crossing": ("walk0", None, 170, 2.2, 0.25),
        "site": ("site0", None, 240, 3.6, 0.3),
        "rocks": ("wall0", None, 200, 0.8, 0.2),
        "low": (690, 640, 90, 0.75, -0.6),
    },
}

res = []


def note(r):
    res.append(r)
    print(r, flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1280, "height": 760})
    errs = []
    pg = ctx.new_page()
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
    t0 = time.time()
    pg.goto(BASE + f"?play=1&shot=1&noui=1&q={Q}&seed=3&creatures=0&teams=2&map={MAP}&ticks=40", wait_until="load")
    while time.time() - t0 < 600 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    note(f"loaded {MAP} in {time.time() - t0:.0f} s")
    spots = pg.evaluate("""() => {
      const t = window.__session.world.terrain; const L = t.layout; const m = t.map;
      const c = (s) => s.circle ? s.circle : s.poly ? [s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length]
        : s.path ? s.path[Math.floor(s.path.length / 2)] : s.ellipse;
      return { W: t.width, D: t.depth, site0: [L.hex.centerX(L.sites[0].centre), L.hex.centerY(L.sites[0].centre)], walk0: m.walkways.length ? c(m.walkways[0].shape) : null, wall0: m.walls.length ? c(m.walls[0].shape) : null };
    }""")
    views = VIEWS.get(MAP)
    if views is None:
        # generic views for any map: the whole map, a site, a crossing, a wall, and an ant's-eye view
        W, D = spots["W"], spots["D"]
        sx, sz = spots["site0"]
        views = {
            "overview": (W / 2, D / 2, max(W, D) * 0.95, 0.0, 0.9),
            "site": ("site0", None, 240, 3.6, 0.3),
            "crossing": ("walk0", None, 190, 2.2, 0.25),
            "wall": ("wall0", None, 260, 0.8, 0.2),
            "low": (sx + 70, sz + 70, 90, 0.75, -0.6),
        }
    for name, (cx, cz, dist, yaw, pitch) in views.items():
        if ONLY and not any(o in name for o in ONLY.split(",")):
            continue
        if isinstance(cx, str):
            if not spots.get(cx):
                continue
            cx, cz = spots[cx]
        t1 = time.time()
        pg.evaluate(f"""() => {{ const r = window.__session.view.surfaceRig; r.jumpTo({cx}, {cz}, {dist}); r.yaw = r.goalYaw = {yaw}; r.pitchBias = {pitch}; }}""")
        pg.evaluate("window.__step(12, 1/30)")
        path = os.path.join(OUT, f"{MAP}_{name}.jpg")
        pg.screenshot(path=path, type="jpeg", quality=84)
        note(f"{'PASS' if not errs else 'FAIL'}  {MAP}_{name}  ({time.time() - t1:.0f} s) {errs[:2]}")
    b.close()

bad = [r for r in res if r.startswith("FAIL")]
print(f"{len(res) - 1 - len(bad)} rendered, {len(bad)} failed")
raise SystemExit(1 if bad else 0)
