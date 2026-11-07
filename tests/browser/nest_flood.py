"""A nest flooding (claude/story/06-spec-levels-5-7-and-lengths.md §4, level 6 "High Water"; sim/nestFlood.ts): a rival
black garden ant nest seen before the water comes, while it pours in and fills the nest, and full. Uses the dev URL
?floodNest=<colony>&floodAt=<s> in the screenshot harness (a virtual clock; the sim fast-forwarded between views).
Fails on page errors.

Run: tests/browser/with_server.sh python3 tests/browser/nest_flood.py   (BASE=http://127.0.0.1:5173/)
Out: docs/story/shots/nest_flood_before.jpg, nest_flood_during.jpg, nest_flood_late.jpg, nest_flood_after.jpg and the
     sheet nest_flood_sheet.jpg. ONLY=during,late renders just those views (no sheet); UI=1 keeps the HUD and reveals
     the areas (the nest minimap's tint of the flooded hexes).
"""
import os
import time
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "story", "shots")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
FLOOD_AT = 40
FILL = 45
# (label, seconds of game time) — before, the water running down to the deepest chambers, most of the nest under, full
VIEWS = [("before", FLOOD_AT - 2), ("during", FLOOD_AT + 14), ("late", FLOOD_AT + 33), ("after", FLOOD_AT + FILL + 8)]
# (ONLY=late,during: just those views, no sheet — for tuning the look)
ONLY = [v for v in os.environ.get("ONLY", "").split(",") if v]
if ONLY:
    VIEWS = [v for v in VIEWS if v[0] in ONLY]
os.makedirs(OUT, exist_ok=True)
errs = []

# the rival's nest, framed on its dug hexes
FRAME = """() => {
  const s = window.__session, w = s.world, c = w.s.colonies[1], g = w.nest(c.id);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let q = 0; q < g.cols * g.rows; q++) {
    if (!g.isHexDug(q)) continue;
    const p = g.hexCenter(q);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const r = s.view.nestRig;
  r.jumpTo((x0 + x1) / 2, (y0 + y1) / 2 + 6, Math.max(x1 - x0, y1 - y0) * 1.05 + 40);
  return [x0, y0, x1, y1];
}"""

STATE = """() => {
  const w = window.__session.world, c = w.s.colonies[1], f = c.nestFlood;
  const home = w.s.ants.filter((a) => a.colony === 1 && a.state !== 28 && a.space === 2).length;
  return `${w.s.time.toFixed(0)} s · ${f && f.phase ? f.q.length + ' hexes under' : 'dry'} · ${home} ants inside${c.alive ? '' : ' · colony fallen'}`;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_context(viewport={"width": 1280, "height": 760}).new_page()
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    first = VIEWS[0][1]
    url = BASE + f"?play=1&mode=skirmish&species=lasius&rival=lasius&seed=3&creatures=0&titans=0&developed=12&floodNest=1&floodAt={FLOOD_AT}&floodFill={FILL}&shot=1&nocine=1{'&reveal=1' if os.environ.get('UI') else '&noui=1'}&q=high&ticks={first * 20}&view=nest&nest=2"
    t0 = time.time()
    pg.goto(url, wait_until="load")
    while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    print(f"loaded in {time.time() - t0:.0f} s; dug box {pg.evaluate(FRAME)}", flush=True)
    shots = []
    at = first
    for label, sec in VIEWS:
        if sec > at:
            pg.evaluate(f"window.__session.loop.advance({(sec - at) * 20})")
            at = sec
        pg.evaluate("window.__step(3, 0.05)")
        path = os.path.join(OUT, f"nest_flood_{label}.jpg")
        pg.screenshot(path=path, type="jpeg", quality=88)
        shots.append((label, path, pg.evaluate(STATE)))
        print(f"  {label}: {shots[-1][2]} [{time.time() - t0:.0f} s]", flush=True)
    b.close()

bad = [e for e in errs if "favicon" not in e]
if ONLY:
    raise SystemExit("FAIL: page errors: " + " | ".join(bad[:5]) if bad else "done")
# the sheet: the views side by side, two rows
W, H = 640, 380
cols = 2
rows = (len(shots) + cols - 1) // cols
sheet = Image.new("RGB", (W * cols, H * rows), (18, 14, 10))
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
except Exception:
    font = ImageFont.load_default()
for i, (label, path, state) in enumerate(shots):
    im = Image.open(path).resize((W, H))
    d = ImageDraw.Draw(im)
    d.rectangle([0, H - 30, W, H], fill=(18, 14, 10))
    d.text((10, H - 26), f"{label}: {state}", fill=(238, 226, 204), font=font)
    sheet.paste(im, ((i % cols) * W, (i // cols) * H))
sheet.save(os.path.join(OUT, "nest_flood_sheet.jpg"), quality=88)
print("FAIL: page errors: " + " | ".join(bad[:5]) if bad else "nest flood shots done")
