"""The three melee attacks (lunge bite, rear-up chomp, side clamp and tug) in
the lab, for ants and termites: wind-up peak (q 0.5) and contact (q 0.7, jaws
shut), from the three-quarter view; one contact sheet per unit in
docs/creatures/attack-renders/. Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/attack_renders.py
"""
import os
import time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "attack-renders")
os.makedirs(OUT, exist_ok=True)
UNITS = [
    ("lasius_worker", ""),
    ("saiy_soldier", ""),
    ("hell_worker", ""),
    ("termite_worker", "&tstate=9"),
    ("termite_major", "&tstate=7"),
]
NAMES = ["lunge bite", "rear-up chomp", "side clamp + tug"]
PHASES = [(0.0, "rest"), (0.5, "wind-up"), (0.7, "contact")]
res = []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 480, "height": 360})
    for unit, extra in UNITS:
        tiles = []
        errs = []
        for v in range(3):
            row = []
            for q, label in PHASES:
                pg = ctx.new_page()
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.on("console", lambda m: errs.append(m.text) if ("marker missing" in m.text or "THREE.WebGLProgram" in m.text) else None)
                pg.goto(BASE + f"?scene=antlab&ao=0&dof=0&ants={unit}&cam=34&amp=0&atk={q}&atkvar={v}&atkside=1{extra}", wait_until="load")
                t0 = time.time()
                while time.time() - t0 < 120 and not pg.evaluate("window.__ready===true"):
                    time.sleep(0.3)
                time.sleep(0.3)
                path = os.path.join(OUT, f"_{unit}_{v}_{label}.png")
                pg.screenshot(path=path)
                pg.close()
                row.append(path)
            tiles.append(row)
        W, H = 480, 360
        sheet = Image.new("RGB", (W * 3, H * 3 + 24 * 3), (20, 18, 16))
        d = ImageDraw.Draw(sheet)
        for r, row in enumerate(tiles):
            for c, path in enumerate(row):
                im = Image.open(path).convert("RGB")
                sheet.paste(im, (c * W, r * (H + 24) + 24))
                d.text((c * W + 8, r * (H + 24) + 5), f"{NAMES[r]} — {PHASES[c][1]} (q {PHASES[c][0]})", fill=(235, 225, 200))
                os.remove(path)
        out = os.path.join(OUT, f"{unit}.png")
        sheet.save(out)
        res.append(f"{'PASS' if not errs else 'FAIL'}  attack-renders/{unit}.png {errs[:3]}")
    b.close()
for r in res:
    print(r)
print("FAILED" if any(r.startswith("FAIL") for r in res) else "all attack renders OK")
