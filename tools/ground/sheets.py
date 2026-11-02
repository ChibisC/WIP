"""Render-only review sheets (ground realism item 7): per map (each spot at close, gameplay and far zoom, plus the
overview) and per ground type (that spot across the maps). Reads docs/maps/realism/shots/<map>/<spot>_<zoom>_<tag>.jpg
(tests/browser/ground_review.py), writes docs/maps/realism/sheets/map_<map>_<tag>.jpg and type_<spot>_<tag>.jpg.

Usage: python3 tools/ground/sheets.py TAG [maps=…] [cell=420]
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
SHOTS = os.path.join(ROOT, "docs", "maps", "realism", "shots")
OUT = os.path.join(ROOT, "docs", "maps", "realism", "sheets")
tag = sys.argv[1]
maps = sys.argv[2].split(",") if len(sys.argv) > 2 and sys.argv[2] else sorted(d for d in os.listdir(SHOTS) if os.path.isdir(os.path.join(SHOTS, d)))
cell = int(sys.argv[3]) if len(sys.argv) > 3 else 420
ZOOMS = ["close", "game", "far"]
SPOTS = ["soil", "moss", "sand", "humus", "water", "bank", "bankTop", "ramp"]
os.makedirs(OUT, exist_ok=True)
ch = int(cell * 570 / 960)


def grid(rows, title, fn):
    """rows: [(label, [path or None per column])]"""
    if not rows:
        return
    cols = max(len(r[1]) for r in rows)
    lw = 90
    W = lw + cols * cell
    Hh = 22 + len(rows) * (ch + 4)
    im = Image.new("RGB", (W, Hh), (18, 18, 18))
    d = ImageDraw.Draw(im)
    d.text((6, 5), title, fill=(235, 225, 205))
    for ri, (label, paths) in enumerate(rows):
        y = 22 + ri * (ch + 4)
        d.text((6, y + ch // 2 - 6), label, fill=(220, 210, 190))
        for ci, p in enumerate(paths):
            if not p or not os.path.exists(p):
                continue
            t = Image.open(p).convert("RGB").resize((cell, ch), Image.LANCZOS)
            im.paste(t, (lw + ci * cell, y))
    im.save(os.path.join(OUT, fn), quality=82)
    print("wrote", fn)


for m in maps:
    rows = []
    ov = os.path.join(SHOTS, m, f"overview_{tag}.jpg")
    if os.path.exists(ov):
        rows.append(("overview", [ov]))
    for s in SPOTS:
        ps = [os.path.join(SHOTS, m, f"{s}_{z}_{tag}.jpg") for z in ZOOMS]
        if any(os.path.exists(p) for p in ps):
            rows.append((s, ps))
    grid(rows, f"{m} — {tag} — close / gameplay / far (render only)", f"map_{m}_{tag}.jpg")
for s in SPOTS:
    rows = []
    for m in maps:
        ps = [os.path.join(SHOTS, m, f"{s}_{z}_{tag}.jpg") for z in ZOOMS]
        if any(os.path.exists(p) for p in ps):
            rows.append((m, ps))
    grid(rows, f"{s} — {tag} — close / gameplay / far across maps (render only)", f"type_{s}_{tag}.jpg")
