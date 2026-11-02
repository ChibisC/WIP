"""Ground realism, user rule 2026-11-01 23:50: "make sure the ground doesn't affect creature visibility".

For each map and ground type (soil, moss/grass, sand, humus/litter, wet margin, bank top/foot, ramp) it lays a row of
ants (dark Lasius, dark Termants, rust fire ants, red wood ants) and a row of creatures (ground beetle, cutworm, wolf
spider) on that ground at gameplay zoom, renders the view with and without them, and measures each unit against the
ground behind it: luminance contrast |Lu − Lg| / max(Lg, 0.05) and colour difference ΔE (CIE76, Lab) over the
unit's own pixels (where the two renders differ). Results: JSON (OUT) and a contact sheet of the crops.

Run: tests/browser/ground_server.sh python3 tests/browser/ground_visibility.py
  env: MAPS=testTerrace,meadowPond,…  OUT=docs/maps/realism/visibility-<tag>.json  TAG=baseline  PRESETS=map,overcast
"""
import json
import os
import sys
import time

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5181/")
MAPS = os.environ.get("MAPS", "testTerrace,meadowPond,forestFloor,riverbank,rainforest,savanna").split(",")
TAG = os.environ.get("TAG", "now")
PRESETS = os.environ.get("PRESETS", "map,overcast").split(",")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUTDIR = os.path.join(ROOT, "docs", "maps", "realism")
OUT = os.environ.get("OUT", os.path.join(OUTDIR, f"visibility-{TAG}.json"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
W, H = 1280, 760
os.makedirs(OUTDIR, exist_ok=True)

ANTS = ["lasius_worker", "termant_worker", "fire_minor", "formica_worker", "termant_soldier", "fire_major"]
CRS = ["groundBeetle", "cutworm", "wolfSpider"]

FIND = """(want) => {
  const s = window.__session, t = s.world.terrain, L = t.layers, res = t.res;
  const ok = (x, y) => t.passable(x, y) && t.inBounds(x, y, 40);
  const clearRow = (x, y) => { for (let dx = -50; dx <= 50; dx += 6) for (const dy of [0, 26]) if (!ok(x + dx, y + dy)) return false; return true; };
  const cw = (x, y, c) => { const i = Math.round(x / res), j = Math.round(y / res); return t.coverW[(j * t.nx + i) * 4 + c] / 255; };
  const waterD = (x, y) => { let d = 99; for (let r = 4; r <= 40; r += 4) for (let a = 0; a < 6.28; a += 0.5) if (t.isWater(x + Math.cos(a) * r, y + Math.sin(a) * r)) { d = Math.min(d, r); } return d; };
  const spots = {};
  const cand = [];
  for (let y = 60; y < t.depth - 60; y += 16) for (let x = 70; x < t.width - 70; x += 16) if (clearRow(x, y)) cand.push([x, y]);
  const best = (score) => { let b = null, bs = -1e9; for (const [x, y] of cand) { const v = score(x, y); if (v > bs) { bs = v; b = [x, y]; } } return b && bs > -1e8 ? b : null; };
  const chans = ['soil', 'moss', 'sand', 'litter'];
  chans.forEach((n, c) => { const p = best((x, y) => { let m = 1; for (let dx = -40; dx <= 40; dx += 20) m = Math.min(m, cw(x + dx, y, c), cw(x + dx, y + 26, c)); return m > 0.3 ? m : -1e9; }); if (p) spots[n] = p; });
  const wet = best((x, y) => { const d = waterD(x, y); return d <= 16 ? 20 - d : -1e9; });
  if (wet) spots.wet = wet;
  if (L) {
    // on a terrace near its bank top, and at a bank foot; a ramp's walkway
    const lvl = (x, y) => t.levelAt(x, y);
    const top = best((x, y) => { const up = lvl(x, y); for (let dy = -30; dy <= 60; dy += 6) if (lvl(x, y + dy) < up && Math.abs(dy) < 40) return 10 - Math.abs(dy) / 10 + up; return -1e9; });
    if (top) spots.bankTop = top;
    const foot = best((x, y) => { const lo = lvl(x, y); for (let dy = -40; dy <= 40; dy += 4) if (lvl(x, y + dy) > lo) return 10 - Math.abs(dy) / 10; return -1e9; });
    if (foot) spots.bankFoot = foot;
    let rp = null;
    for (let y = 40; y < t.depth - 40 && !rp; y += 8) for (let x = 40; x < t.width - 40; x += 8) if (t.onRamp(x, y) && t.onRamp(x + 12, y) && t.onRamp(x - 12, y)) { rp = [x, y]; break; }
    if (rp) spots.ramp = rp;
  }
  const out = {};
  for (const k of Object.keys(spots)) if (!want || want.includes(k)) out[k] = spots[k];
  return out;
}"""

PLACE = """([x, y, ants, crs, on]) => {
  const s = window.__session, w = s.world;
  const pick = (pred) => w.s.ants.find(pred);
  const used = window.__used || (window.__used = {});
  ants.forEach((caste, i) => {
    let a = used[caste];
    if (!a) {
      const sp = caste.split('_')[0];
      a = pick((q) => q.caste === caste && !Object.values(used).includes(q)) || pick((q) => q.caste.startsWith(sp + '_') && !q.caste.includes('queen') && !q.caste.includes('king') && !Object.values(used).includes(q));
      if (!a) {
        // no ant of that species in this game: a copy of any worker, given the caste (the sim is paused)
        const src = pick((q) => !q.caste.includes('queen') && !q.caste.includes('king'));
        a = structuredClone(src);
        a.id = w.nextId();
        w.addAnt(a);
      }
      used[caste] = a;
      a.caste = caste;
    }
    const ax = on ? x - 45 + i * 18 : -500, ay = on ? y : -500;
    a.space = 0; a.x = a.px = ax; a.y = a.py = ay; a.h = a.ph = 0.3 + i; a.v = 0; a.state = 0; a.carry = 0; a.dead = 0;
  });
  crs.forEach((kind, i) => {
    const cr = w.s.creatures.find((c) => c.kind === kind);
    if (!cr) return;
    const cx = on ? x - 40 + i * 40 : -800, cy = on ? y + 34 : -800;
    cr.x = cr.px = cx; cr.y = cr.py = cy; cr.h = cr.ph = 0.4 + i * 1.3; cr.v = 0; cr.space = 0;
  });
  return true;
}"""

PROJECT = """([ants, crs]) => {
  const s = window.__session, w = s.world, cam = s.view.surfaceCamera || s.view.activeCamera();
  const V = cam.position.constructor; const out = [];
  const t = w.terrain;
  const proj = (x, y, kind, id) => { const v = new V(x, t.walkHeight(x, y) + 1, y); v.project(cam); out.push({ id, kind, sx: (v.x * 0.5 + 0.5) * innerWidth, sy: (-v.y * 0.5 + 0.5) * innerHeight }); };
  for (const c of ants) { const a = (window.__used || {})[c]; if (a) proj(a.x, a.y, 'ant', c); }
  for (const k of crs) { const cr = w.s.creatures.find((q) => q.kind === k); if (cr) proj(cr.x, cr.y, 'creature', k); }
  return out;
}"""


def lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


def lum(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    return c @ np.array([0.2126, 0.7152, 0.0722])


def measure(img_on, img_off, pts):
    on = np.asarray(img_on.convert("RGB")).astype(np.float64)
    off = np.asarray(img_off.convert("RGB")).astype(np.float64)
    diff = np.abs(on - off).sum(-1)
    res = []
    for p in pts:
        r = 9 if p["kind"] == "ant" else 26
        x0, x1 = int(max(0, p["sx"] - r)), int(min(W, p["sx"] + r))
        y0, y1 = int(max(0, p["sy"] - r)), int(min(H, p["sy"] + r))
        if x1 <= x0 or y1 <= y0:
            continue
        m = diff[y0:y1, x0:x1] > 30
        n = int(m.sum())
        if n < 3:
            res.append({**p, "px": n, "contrast": 0.0, "dE": 0.0})
            continue
        u = on[y0:y1, x0:x1][m]
        g = off[y0:y1, x0:x1][m]
        lu, lg = lum(u).mean(), lum(g).mean()
        de = float(np.linalg.norm(lab(u).mean(0) - lab(g).mean(0)))
        res.append({**p, "px": n, "contrast": float(abs(lu - lg) / max(lg, 0.05)), "dE": de, "Lu": float(lu), "Lg": float(lg)})
    return res


results = {}
crops = []
with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    for M in MAPS:
        ctx = b.new_context(viewport={"width": W, "height": H})
        pg = ctx.new_page()
        pg.set_default_timeout(900000)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        t0 = time.time()
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=high&seed=5&creatures=0&species=termant&rival=lasius&map={M}&ticks=60&spawn=groundBeetle,cutworm,wolfSpider", wait_until="load")
        while time.time() - t0 < 600 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        if errs:
            print("page errors", errs[:3], flush=True)
        pg.evaluate("window.__session.loop.paused = true")
        spots = pg.evaluate(FIND, None)
        print(f"{M}: loaded in {time.time() - t0:.0f} s, spots {list(spots)}", flush=True)
        for preset in PRESETS:
            if preset == "overcast":
                pg.evaluate("() => { const v = window.__session.view; v.storm = 1; v.stormShown = 1; }")
            for name, (x, y) in spots.items():
                t1 = time.time()
                pg.evaluate(f"() => {{ const r = window.__session.view.surfaceRig; r.jumpTo({x}, {y + 12}, 230); r.yaw = r.goalYaw = 0.6; r.pitchBias = 0; }}")
                pg.evaluate(PLACE, [x, y, ANTS, CRS, True])
                pg.evaluate("window.__step(6, 1/30)")
                a_on = Image.open(__import__("io").BytesIO(pg.screenshot()))
                pts = pg.evaluate(PROJECT, [ANTS, CRS])
                pg.evaluate(PLACE, [x, y, ANTS, CRS, False])
                pg.evaluate("window.__step(6, 1/30)")
                a_off = Image.open(__import__("io").BytesIO(pg.screenshot()))
                m = measure(a_on, a_off, pts)
                key = f"{M}/{name}/{preset}"
                results[key] = m
                ants = [r for r in m if r["kind"] == "ant"]
                crs_ = [r for r in m if r["kind"] == "creature"]
                f = lambda rs, k: (sum(r[k] for r in rs) / len(rs)) if rs else 0
                print(f"  {key}: ants contrast {f(ants, 'contrast'):.2f} dE {f(ants, 'dE'):.1f} (min {min([r['contrast'] for r in ants] or [0]):.2f}), creatures contrast {f(crs_, 'contrast'):.2f} dE {f(crs_, 'dE'):.1f}  [{time.time() - t1:.0f} s]", flush=True)
                if pts:
                    xs = [p["sx"] for p in pts]
                    ys = [p["sy"] for p in pts]
                    box = (int(max(0, min(xs) - 40)), int(max(0, min(ys) - 40)), int(min(W, max(xs) + 40)), int(min(H, max(ys) + 40)))
                    crops.append((key, a_on.crop(box)))
            if preset == "overcast":
                pg.evaluate("() => { const v = window.__session.view; v.storm = 0; v.stormShown = 0; }")
        ctx.close()
    b.close()

json.dump(results, open(OUT, "w"), indent=1)
# contact sheet
if crops:
    cw = 420
    rows = []
    for key, im in crops:
        k = cw / im.width
        rows.append((key, im.resize((cw, max(1, int(im.height * k))))))
    cols = 3
    hmax = max(r[1].height for r in rows) + 18
    sheet = Image.new("RGB", (cw * cols, hmax * ((len(rows) + cols - 1) // cols)), (20, 20, 20))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, (key, im) in enumerate(rows):
        x = (i % cols) * cw
        y = (i // cols) * hmax
        sheet.paste(im, (x, y + 18))
        d.text((x + 4, y + 3), key, fill=(230, 220, 200))
    sheet.save(OUT.replace(".json", ".jpg"), quality=85)
print("wrote", OUT)
