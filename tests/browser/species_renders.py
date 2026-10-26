"""Render the three new species in the ant lab (side / top / front / three-quarter;
gold, exhausted; mandibles closed and open; glue firing) and save the sheets to
docs/creatures/*-renders/. Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/species_renders.py
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures")
ONLY = os.environ.get("ONLY", "")
res = []

SHOTS = [
    # (folder, file, query)
    ("hell-ant-renders", "worker_side_closed", "ants=hell_worker&cam=side&mopen=0&amp=0"),
    ("hell-ant-renders", "worker_side_open", "ants=hell_worker&cam=side&mopen=1&amp=0"),
    ("hell-ant-renders", "worker_side_rest", "ants=hell_worker&cam=side&mopen=0.45&amp=0"),
    ("hell-ant-renders", "worker_top", "ants=hell_worker&cam=top&mopen=0.45&amp=0"),
    ("hell-ant-renders", "worker_front", "ants=hell_worker&cam=front&mopen=0.45&amp=0"),
    ("hell-ant-renders", "worker_34", "ants=hell_worker&cam=34&mopen=0.45"),
    ("hell-ant-renders", "castes_34", "ants=hell_worker,hell_soldier,hell_queen&cam=34&mopen=0.4"),
    ("hell-ant-renders", "soldier_side", "ants=hell_soldier&cam=side&mopen=0.3&amp=0"),
    ("hell-ant-renders", "queen_side", "ants=hell_queen&cam=side&mopen=0.3&amp=0"),
    ("hell-ant-renders", "worker_lod1", "ants=hell_worker&cam=34&lod=1&mopen=0.45"),
    ("aurimyrmex-renders", "worker_side", "ants=saiy_worker&cam=side&amp=0"),
    ("aurimyrmex-renders", "worker_side_gold", "ants=saiy_worker&cam=side&amp=0&gold=1"),
    ("aurimyrmex-renders", "worker_side_ripple", "ants=saiy_worker&cam=side&amp=0&gold=0.5"),
    ("aurimyrmex-renders", "worker_side_exhausted", "ants=saiy_worker&cam=side&amp=0&exh=1"),
    ("aurimyrmex-renders", "worker_top", "ants=saiy_worker&cam=top&amp=0"),
    ("aurimyrmex-renders", "worker_front", "ants=saiy_worker&cam=front&amp=0"),
    ("aurimyrmex-renders", "worker_34_gold", "ants=saiy_worker&cam=34&gold=1"),
    ("aurimyrmex-renders", "castes_34", "ants=saiy_worker,saiy_soldier,saiy_queen&cam=34"),
    ("aurimyrmex-renders", "castes_34_gold", "ants=saiy_worker,saiy_soldier,saiy_queen&cam=34&gold=1"),
    ("aurimyrmex-renders", "soldier_front", "ants=saiy_soldier&cam=front&amp=0"),
    ("aurimyrmex-renders", "queen_side", "ants=saiy_queen&cam=side&amp=0"),
    ("nasutitermes-renders", "soldiers_worker_34", "ants=termite_nasute,termite_major,termite_worker&cam=34"),
    ("nasutitermes-renders", "royals_34", "ants=termite_king,termite_queen,termite_larva&cam=34"),
    ("nasutitermes-renders", "nasute_side", "ants=termite_nasute&cam=side"),
    ("nasutitermes-renders", "nasute_top", "ants=termite_nasute&cam=top"),
    ("nasutitermes-renders", "nasute_front", "ants=termite_nasute&cam=front"),
    ("nasutitermes-renders", "nasute_fire", "ants=termite_nasute&cam=34&tstate=5&ramp=1&fire=1"),
    ("nasutitermes-renders", "presoldier_34", "ants=termite_nasute&cam=34&tan=0"),
    ("nasutitermes-renders", "nasute_lod2", "ants=termite_nasute,termite_worker&cam=34&lod=2"),
]

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1000, "height": 600})
    for folder, name, query in SHOTS:
        if ONLY and ONLY not in folder + name:
            continue
        os.makedirs(os.path.join(ROOT, folder), exist_ok=True)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if ("marker missing" in m.text or "ERROR" in m.text or "THREE.WebGLProgram" in m.text) else None)
        pg.goto(BASE + "?scene=antlab&ao=0&dof=0&" + query, wait_until="load")
        t0 = time.time()
        while time.time() - t0 < 120 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.3)
        ok = pg.evaluate("window.__ready===true")
        info = pg.evaluate("JSON.stringify(window.__shotInfo||null)")
        out = os.path.join(ROOT, folder, name + ".png")
        pg.screenshot(path=out)
        res.append(f"{'PASS' if ok and not errs else 'FAIL'}  {folder}/{name} {info} {errs[:2]}")
        pg.close()
    b.close()

for r in res:
    print(r)
print("FAILED" if any(r.startswith("FAIL") for r in res) else "all renders OK")
