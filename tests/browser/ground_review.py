"""Ground realism review renders (render only): for each map, find a spot of each ground type (soil, moss/grass,
sand, humus, wet margin, bank face, bank foot, ramp, water edge, a landmark) and render it at close, gameplay and far
zoom; plus a map overview. Output: docs/maps/realism/shots/<map>/<spot>_<zoom>_<tag>.jpg (git-ignored), and a
spots.json with where each one is.

Run (one browser job at a time): tests/browser/ground_server.sh python3 tests/browser/ground_review.py
  env: MAPS=testTerrace,gardenBelow,…  TAG=r1  ZOOMS=close,game,far  SPOTS=soil,bank,…  W=1280 H=760
       BASE=http://127.0.0.1:5181/  OVERCAST=1 (storm light)  MOOD=1 (default: the map's own light)
"""
import io
import json
import os
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5181/")
MAPS = os.environ.get("MAPS", "testTerrace,gardenBelow,fireBanks,meadowPond,forestFloor,riverbank,rainforest,savanna").split(",")
TAG = os.environ.get("TAG", "now")
ZOOMS = os.environ.get("ZOOMS", "close,game,far").split(",")
WANT = [s for s in os.environ.get("SPOTS", "").split(",") if s]
OVERCAST = os.environ.get("OVERCAST", "0") == "1"
STEPS = int(os.environ.get("STEPS", "4"))
W = int(os.environ.get("W", "1280"))
H = int(os.environ.get("H", "760"))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.environ.get("OUT", os.path.join(ROOT, "docs", "maps", "realism", "shots"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

# camera per zoom: distance (mm), pitch bias; close looks across the ground, far looks down
ZOOM = {"close": (62, -0.32), "game": (230, 0.0), "far": (520, 0.35)}

FIND = """(want) => {
  const s = window.__session, t = s.world.terrain, L = t.layers, res = t.res;
  const ok = (x, y) => t.passable(x, y) && t.inBounds(x, y, 40);
  const cw = (x, y, c) => { const i = Math.round(x / res), j = Math.round(y / res); return t.coverW[(j * t.nx + i) * 4 + c] / 255; };
  const near = (x, y, f, r) => { for (let a = 0; a < 6.28; a += 0.4) for (let d = 4; d <= r; d += 4) if (f(x + Math.cos(a) * d, y + Math.sin(a) * d)) return d; return 99; };
  const cand = [];
  for (let y = 50; y < t.depth - 50; y += 12) for (let x = 50; x < t.width - 50; x += 12) cand.push([x, y]);
  const best = (score) => { let b = null, bs = -1e9; for (const [x, y] of cand) { const v = score(x, y); if (v > bs) { bs = v; b = [x, y]; } } return b && bs > -1e8 ? b : null; };
  const spots = {};
  const clear = (x, y, r) => { for (let a = 0; a < 6.28; a += 0.8) if (!ok(x + Math.cos(a) * r, y + Math.sin(a) * r)) return false; return ok(x, y); };
  ['soil', 'moss', 'sand', 'humus'].forEach((n, c) => {
    const p = best((x, y) => { if (!clear(x, y, 20)) return -1e9; let m = 1; for (let dx = -20; dx <= 20; dx += 10) for (let dy = -20; dy <= 20; dy += 10) m = Math.min(m, cw(x + dx, y + dy, c)); return m > 0.35 ? m + (x * 7 + y * 3) % 5 * 0.001 : -1e9; });
    if (p) spots[n] = p;
  });
  const wet = best((x, y) => { if (!ok(x, y)) return -1e9; const d = near(x, y, (a, b) => t.isWater(a, b), 24); return d <= 12 ? 20 - d : -1e9; });
  if (wet) spots.water = wet;
  if (L) {
    const cl = (x, y) => { const i = Math.round(x / res), j = Math.round(y / res); return L.cliff[j * t.nx + i] === 1; };
    // a bank face seen from its foot: low ground next to a cliff band that rises
    const foot = best((x, y) => { if (!ok(x, y)) return -1e9; const d = near(x, y, cl, 20); if (d > 16) return -1e9; return 30 - d - Math.abs(d - 10) + (cw(x, y, 2) > 0.5 ? -5 : 0); });
    if (foot) spots.bank = foot;
    const top = best((x, y) => { if (!ok(x, y) || t.levelAt(x, y) < 1) return -1e9; const d = near(x, y, cl, 20); return d <= 14 ? 20 - d : -1e9; });
    if (top) spots.bankTop = top;
    let rp = null;
    for (let y = 40; y < t.depth - 40 && !rp; y += 8) for (let x = 40; x < t.width - 40; x += 8) if (t.onRamp(x, y) && t.onRamp(x + 14, y) && t.onRamp(x - 14, y)) { const k = Math.round(y / res) * t.nx + Math.round(x / res); if (L.rampU[k] > 90 && L.rampU[k] < 170) { rp = [x, y]; break; } }
    if (rp) spots.ramp = rp;
  }
  const out = {};
  for (const k of Object.keys(spots)) if (!want || !want.length || want.includes(k)) out[k] = spots[k];
  // which way to look at each: toward the bank / water, else a fixed angle
  const yaw = {};
  for (const [k, [x, y]] of Object.entries(out)) {
    let tx = 0, ty = 0, n = 0;
    const f = k === 'water' ? (a, b) => t.isWater(a, b) : (k === 'bank' || k === 'bankTop') && L ? (a, b) => { const i = Math.round(a / res), j = Math.round(b / res); return L.cliff[j * t.nx + i] === 1; } : null;
    if (f) for (let a = 0; a < 6.28; a += 0.2) for (let d = 4; d <= 30; d += 4) if (f(x + Math.cos(a) * d, y + Math.sin(a) * d)) { tx += Math.cos(a); ty += Math.sin(a); n++; }
    yaw[k] = n ? Math.atan2(tx, ty) : 0.6;
  }
  return { spots: out, yaw };
}"""


def shoot(pg, cx, cz, dist, yaw, pitch):
    pg.evaluate(f"() => {{ const r = window.__session.view.surfaceRig; r.jumpTo({cx}, {cz}, {dist}); r.yaw = r.goalYaw = {yaw}; r.pitchBias = {pitch}; }}")
    pg.evaluate(f"window.__step({STEPS}, 1/30)")
    return Image.open(io.BytesIO(pg.screenshot())).convert("RGB")


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        for M in MAPS:
            ctx = b.new_context(viewport={"width": W, "height": H})
            pg = ctx.new_page()
            pg.set_default_timeout(1800000)
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append(m.text) if ("WebGLProgram" in m.text or "[patch" in m.text or "ERROR" in m.text) else None)
            t0 = time.time()
            pg.goto(BASE + f"?play=1&shot=1&noui=1&q=high&seed=5&creatures=0&species=lasius&rival=lasius&map={M}&ticks=30", wait_until="load")
            while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
                time.sleep(0.5)
            pg.evaluate("window.__session.loop.paused = true")
            # no ants in the review renders (the ground is what is judged)
            pg.evaluate("() => { for (const a of window.__session.world.s.ants) { a.x = a.px = -900; a.y = a.py = -900; } }")
            if OVERCAST:
                pg.evaluate("() => { const v = window.__session.view; v.storm = 1; v.stormShown = 1; }")
            found = pg.evaluate(FIND, WANT)
            spots, yaws = found["spots"], found["yaw"]
            print(f"{M}: loaded in {time.time() - t0:.0f} s; spots {spots}", flush=True)
            d = os.path.join(OUT, M)
            os.makedirs(d, exist_ok=True)
            json.dump({"spots": spots, "yaw": yaws}, open(os.path.join(d, "spots.json"), "w"))
            sfx = ("_overcast" if OVERCAST else "") + f"_{TAG}"
            if not WANT or "overview" in WANT:
                t1 = time.time()
                tw = pg.evaluate("[window.__session.world.terrain.width, window.__session.world.terrain.depth]")
                im = shoot(pg, tw[0] / 2, tw[1] / 2, max(tw) * 0.95, 0.5, 0.55)
                im.save(os.path.join(d, f"overview{sfx}.jpg"), quality=88)
                print(f"  overview [{time.time() - t1:.0f} s]", flush=True)
            for name, (x, y) in spots.items():
                for z in ZOOMS:
                    t1 = time.time()
                    dist, pitch = ZOOM[z]
                    # close and gameplay views look toward the feature; the camera stands back from it
                    yaw = yaws.get(name, 0.6) + (3.14159 if name in ("bank", "water") else 0)
                    im = shoot(pg, x, y, dist, yaw if z != "far" else 0.5, pitch)
                    im.save(os.path.join(d, f"{name}_{z}{sfx}.jpg"), quality=88)
                    print(f"  {name} {z} [{time.time() - t1:.0f} s]", flush=True)
            if errs:
                print("ERRORS:", "\n".join(errs[:6]), flush=True)
            ctx.close()
        b.close()


main()
