"""AI colonies' nests (CHANGE_PLAN §22): five AI colonies on Meadow Pond grown for 10, 30 and 45 minutes, each nest seen
from above — EotU-style chambers of 7 or 19 hexes holding one tile type each, store chambers by the entrance, highways
on the tunnels, upgraded tiles. Writes docs/ai/chambers/<species>_<min>min.jpg and a contact sheet sheet.jpg.

Run: tests/browser/with_server.sh python3 tests/browser/ai_nests.py   (MINUTES=10,30,45  RIVALS=lasius,formica,...)
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
MINUTES = [int(m) for m in os.environ.get("MINUTES", "10,30,45").split(",")]
RIVALS = os.environ.get("RIVALS", "lasius,formica,atta,solenopsis,eciton").split(",")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "ai", "chambers")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
res = []


def blank(path):
    """A frame with almost no detail (the view not drawn yet)."""
    try:
        from PIL import Image, ImageStat
        return max(ImageStat.Stat(Image.open(path).convert("L")).stddev) < 6
    except Exception:  # noqa: BLE001
        return False


def note(r):
    res.append(r)
    print(r, flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1100, "height": 760})
    errs = []
    pg = ctx.new_page()
    pg.set_default_timeout(1800000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    t0 = time.time()
    # you (a Black garden colony, standing in) and the AI colonies; no wild creatures and no wars, so the nests just grow
    pg.goto(BASE + f"?play=1&shot=1&noui=1&q=medium&seed=4&creatures=0&map=meadowPond&species=lasius&rival={','.join(RIVALS)}&ticks=40", wait_until="load")
    while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    note(f"loaded in {time.time() - t0:.0f} s")
    # peace (no raids), so every colony grows the whole time and can be seen at 45 min
    pg.evaluate("window.__session.world.s.settings.aggression = 0")
    done = 0
    for m in MINUTES:
        t1 = time.time()
        pg.evaluate(f"window.__session.loop.advance({(m - done) * 60 * 20})")
        done = m
        note(f"advanced to {m} min in {time.time() - t1:.0f} s")
        cols = pg.evaluate("""() => window.__session.world.s.colonies.filter((c) => c.ai && c.alive).map((c) => {
          const lv = [0, 0, 0]; for (const t of c.tiles) if (t.type !== 'queen') lv[t.level - 1]++;
          return { id: c.id, sp: c.species, ants: c.living, chambers: (c.aiBuild?.chambers ?? []).map((x) => (x.r === 2 ? 19 : 7)), lv,
                   hw: c.tiles.filter((t) => t.type === 'highway').length }; })""")
        for c in cols:
            CAM = f"""() => {{
              const s = window.__session; const w = s.world; const space = {c['id']} + 1;
              const nv = s.nests.get(space); if (!nv) return false;
              s.viewedArea = space; s.view.setActiveNest(space); s.view.space = 'nest';
              const g = w.nestOf(space); const col = w.colony({c['id']});
              // the middle of everything dug, from above
              let x = 0, y = 0, n = 0;
              for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q)) {{ const p = g.hexCenter(q); x += p.x; y += p.y; n++; }}
              x /= n; y /= n;
              let far = 0;
              for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q)) {{ const p = g.hexCenter(q); far = Math.max(far, Math.hypot(p.x - x, p.y - y)); }}
              const r = s.view.nestRig; r.jumpTo(x, y, Math.max(g.R * 30, far * 2.3)); r.pitchBias = 0.9;
              return true; }}"""
            ok = pg.evaluate(CAM)
            if not ok:
                note(f"SKIP  {c['sp']} {m} min (no nest view)")
                continue
            # let the view settle (the nest's meshes, the camera's focus), then shoot; a blank frame is shot again
            path = os.path.join(OUT, f"{c['sp']}_{m}min.jpg")
            for attempt in range(3):
                # (switching to a nest view moves the camera on its own for a few frames: place it again after them)
                pg.evaluate(f"window.__step({10 + attempt * 20}, 1/30)")
                pg.evaluate(CAM)
                pg.evaluate("window.__step(12, 1/30)")
                pg.screenshot(path=path, type="jpeg", quality=84)
                if not blank(path):
                    break
                note(f"  (blank frame for {c['sp']} {m} min, shooting again)")
            note(f"{'PASS' if not errs else 'FAIL'}  {c['sp']} {m} min: {c['ants']} ants, chambers {c['chambers'].count(7)} × 7 + {c['chambers'].count(19)} × 19, tiles by level {c['lv']}, highways {c['hw']} {errs[:2]}")
    ctx.close()
    b.close()

# contact sheet: a row per species, a column per time
try:
    from PIL import Image, ImageDraw, ImageFont
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    species = [sp for sp in RIVALS if all(os.path.exists(os.path.join(OUT, f"{sp}_{m}min.jpg")) for m in MINUTES)]
    tw, th = 440, 304
    sheet = Image.new("RGB", (tw * len(MINUTES), (th + 28) * len(species)), (20, 16, 12))
    d = ImageDraw.Draw(sheet)
    for r, sp in enumerate(dict.fromkeys(species)):
        for k, m in enumerate(MINUTES):
            im = Image.open(os.path.join(OUT, f"{sp}_{m}min.jpg")).resize((tw, th))
            sheet.paste(im, (k * tw, r * (th + 28) + 28))
            d.text((k * tw + 8, r * (th + 28) + 4), f"{sp} — {m} min", fill=(240, 228, 205), font=font)
    sheet.save(os.path.join(OUT, "sheet.jpg"), quality=86)
    print("saved sheet.jpg")
except Exception as e:  # noqa: BLE001
    print("no sheet:", e)

bad = [r for r in res if r.startswith("FAIL")]
print(f"{len([r for r in res if r.startswith('PASS')])} rendered, {len(bad)} failed")
raise SystemExit(1 if bad else 0)
