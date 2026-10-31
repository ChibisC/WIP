#!/usr/bin/env python3
"""Side-by-side sheets of the 60 v 60 clash before / after combat v2 (docs/combat/v2/, from tests/browser/combat_v2.py):
one sheet per zoom, a row per time (10, 12, 14, 16 s), the base on the left and this branch on the right.

  python3 tools/combat-v2-sheets.py docs/combat/v2

The sheets are saved as JPEG, and the renders' PNGs are turned into JPEGs (quality 88) to keep the folder small.
"""
import glob, os, sys
from PIL import Image, ImageDraw, ImageFont

D = sys.argv[1] if len(sys.argv) > 1 else "docs/combat/v2"
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
except Exception:
    font = ImageFont.load_default()
NAMES = {"default": "default zoom", "close": "closer", "norings": "close, team rings hidden"}
for zoom in ("default", "close", "norings"):
    rows = []
    for t in (10, 12, 14, 16):
        pair = []
        for lab in ("before", "after"):
            f = os.path.join(D, f"clash60_{lab}_{t}s_{zoom}")
            pair.append(next((f + e for e in (".png", ".jpg") if os.path.exists(f + e)), None))
        if all(pair):
            rows.append((t, Image.open(pair[0]).convert("RGB"), Image.open(pair[1]).convert("RGB")))
    if not rows:
        continue
    w, h = rows[0][1].size
    s = 0.5
    cw, ch = int(w * s), int(h * s)
    sheet = Image.new("RGB", (cw * 2, (ch + 36) * len(rows) + 40), (20, 16, 12))
    d = ImageDraw.Draw(sheet)
    d.text((12, 8), "before (main)", fill=(240, 228, 205), font=font)
    d.text((cw + 12, 8), "after (combat v2)", fill=(240, 228, 205), font=font)
    for i, (t, a, b) in enumerate(rows):
        y = 40 + i * (ch + 36)
        d.text((12, y + 4), f"{t} s into the fight — 60 Black garden workers v 60 fire-ant soldiers, {NAMES[zoom]}", fill=(200, 188, 165), font=font)
        sheet.paste(a.resize((cw, ch)), (0, y + 32))
        sheet.paste(b.resize((cw, ch)), (cw, y + 32))
    out = os.path.join(D, f"clash60_sheet_{zoom}.jpg")
    sheet.save(out, quality=88)
    print("saved", out)
# the renders themselves, as JPEGs
for f in sorted(glob.glob(os.path.join(D, "*.png"))):
    Image.open(f).convert("RGB").save(f[:-4] + ".jpg", quality=88)
    os.remove(f)
