"""Story mode in the browser (claude/story/02-spec, 03-spec): the island hub (map, level card, genome, journal), the
opening flight of each level with its captions and letterbox, and render-only views of both story maps (top-down
with the layers, gameplay zoom, the banks and ramps up close). Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/story.py   (ONLY=hub,garden,fireBanks)
Screenshots: docs/story/shots/*.jpg
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "hub,garden,fireBanks").split(",")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "story", "shots")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
errs = []
fails = []


def note(r):
    print(r, flush=True)


def wait_ready(pg, t0, limit=600):
    while time.time() - t0 < limit and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


def shot(pg, name):
    pg.screenshot(path=os.path.join(OUT, name + ".jpg"), type="jpeg", quality=86)
    note(f"  shot {name}")


# views per map: name -> (cx, cz, dist, yaw, pitchBias)
VIEWS = {
    "garden": {
        "overview": (550, 450, 1250, 0.0, 0.9),
        "gameplay": (420, 600, 260, 0.5, 0.0),
        "steps": (600, 400, 200, 2.4, 0.15),
        "bank": (470, 600, 110, 0.9, -0.15),
        "flowerbed": (860, 220, 300, 0.7, 0.1),
    },
    "fireBanks": {
        "overview": (600, 450, 1300, 0.0, 0.9),
        "gameplay": (230, 470, 260, 0.6, 0.0),
        "slope": (655, 400, 230, 2.8, 0.1),
        "margin": (600, 740, 220, 0.3, 0.0),
        "mound": (900, 170, 260, 0.9, 0.1),
    },
}

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1280, "height": 760})
    pg = ctx.new_page()
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
    if "hub" in ONLY:
        pg.goto(BASE + "?story=1", wait_until="load")
        pg.wait_for_selector(".story-hub", timeout=60000)
        time.sleep(2.5)
        shot(pg, "hub_island")
        # the locked second level
        box = pg.locator(".island-map").bounding_box()
        pg.mouse.click(box["x"] + box["width"] * 0.56, box["y"] + box["height"] * 0.79)
        time.sleep(0.5)
        shot(pg, "hub_level2_locked")
        pg.locator(".sh-tab[data-tab=genome]").click()
        time.sleep(0.4)
        shot(pg, "hub_genome")
        pg.locator(".sh-tab[data-tab=journal]").click()
        time.sleep(0.4)
        shot(pg, "hub_journal")
        # a campaign with level 1 won: the path reveal and level 2 open
        pg.evaluate("""() => { localStorage.setItem('ud-campaign-v1', JSON.stringify({ version: 1, levels: { garden: { won: true, plays: 1, time: 'gold', losses: 'silver', bonus: 'none', bestSeconds: 1100, bestLost: 30, hardest: 'normal' } }, castes: ['lasius_soldier'], bosses: 0, difficulty: {}, loadout: {}, journal: [{ level: 'garden', date: '2026-11-02', caste: 'lasius_soldier' }], revealed: [] })); }""")
        pg.goto(BASE + "?story=1", wait_until="load")
        pg.wait_for_selector(".story-hub", timeout=60000)
        time.sleep(1.0)
        shot(pg, "hub_reveal_mid")
        time.sleep(2.5)
        shot(pg, "hub_level2_open")
        pg.locator(".sh-tab[data-tab=journal]").click()
        time.sleep(0.4)
        shot(pg, "hub_journal_page")
        pg.evaluate("() => localStorage.removeItem('ud-campaign-v1')")
    for lv in ("garden", "fireBanks"):
        if lv not in ONLY:
            continue
        # the opening: flight, letterbox and captions (UI on)
        t0 = time.time()
        pg.goto(BASE + f"?story={lv}&shot=1&q=high&seed=3&ticks=2", wait_until="load")
        wait_ready(pg, t0)
        note(f"loaded {lv} in {time.time() - t0:.0f} s")
        pg.evaluate("window.__step(2, 0.05)")
        shot(pg, f"{lv}_open_0s")
        for k in range(10):
            pg.evaluate("window.__step(10, 0.05)")
        shot(pg, f"{lv}_open_5s")
        for k in range(14):
            pg.evaluate("window.__step(10, 0.05)")
        shot(pg, f"{lv}_open_12s")
        # render-only views (no UI, no shots)
        for name, (cx, cz, dist, yaw, pitch) in VIEWS[lv].items():
            t0 = time.time()
            pg.goto(BASE + f"?story={lv}&shot=1&noui=1&nocine=1&q=high&seed=3&ticks=40&cx={cx}&cz={cz}&dist={dist}&yaw={yaw}&pitch={pitch}", wait_until="load")
            wait_ready(pg, t0)
            pg.evaluate("window.__step(3, 0.05)")
            shot(pg, f"{lv}_{name}")
    bad = [e for e in errs if "favicon" not in e]
    if bad:
        fails.append("page errors: " + " | ".join(bad[:5]))
    b.close()
print("FAIL: " + "; ".join(fails) if fails else "story browser check passed")
