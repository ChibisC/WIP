#!/usr/bin/env python3
"""Realism rework sheets (CHANGE_PLAN §22): one render-only sheet per unit — rows the light presets, columns the views —
and the hell ants' amber specimen shots, from tests/browser/hell_nasute_realism.py renders.

  python3 tools/hell-nasute-sheets.py <renders dir>

Writes docs/realism/hell-ants/sheet-<unit>.jpg, docs/realism/hell-ants/amber.jpg and docs/realism/nasutitermes/sheet-<unit>.jpg.
Render only: the reference photos never go into these sheets.
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

R = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/hell-nasute/renders"
try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 17)
except Exception:
    FONT = ImageFont.load_default()
VIEWS = [("side", "side"), ("top", "top"), ("front", "front"), ("34", "three-quarter"), ("macro", "close-up")]
LIGHTS = [("overcast", "overcast"), ("forest", "forest shade"), ("sunny", "sun")]
NAMES = {
    "hell_worker": ("hell-ants", "Hell ant worker (Ceratomyrmex-style), 5 mm"),
    "hell_soldier": ("hell-ants", "Hell ant soldier (Linguamyrmex paddle), 6.5 mm"),
    "hell_queen": ("hell-ants", "Hell ant queen (Haidomyrmex cerberus), 7.6 mm"),
    "nasute_worker": ("nasutitermes", "Nasute worker (Nasutitermes corniger), 4.2 mm"),
    "nasute_soldier": ("nasutitermes", "Nasute soldier, 5 mm"),
    "nasute_major": ("nasutitermes", "Nasute major soldier, 6.5 mm"),
    "nasute_king": ("nasutitermes", "Nasute king, 8.4 mm"),
    "nasute_queen": ("nasutitermes", "Nasute queen (physogastric), 25 mm"),
}
TW, TH, LAB, HEAD = 400, 272, 130, 34


def tile(path, label):
    im = Image.open(path).convert("RGB").resize((TW, TH)) if os.path.exists(path) else Image.new("RGB", (TW, TH), (30, 26, 22))
    d = ImageDraw.Draw(im)
    d.rectangle([0, TH - 24, TW, TH], fill=(18, 15, 12))
    d.text((8, TH - 22), label, fill=(240, 228, 205), font=FONT)
    return im


for unit, (folder, title) in NAMES.items():
    sheet = Image.new("RGB", (LAB + len(VIEWS) * TW, HEAD + len(LIGHTS) * TH), (14, 12, 10))
    d = ImageDraw.Draw(sheet)
    d.text((12, 8), title + " — realism rework 2026-11-02 (renders)", fill=(240, 228, 205), font=FONT)
    for r, (li, ln) in enumerate(LIGHTS):
        d.text((12, HEAD + r * TH + TH // 2 - 10), ln, fill=(224, 190, 120), font=FONT)
        for c, (v, vn) in enumerate(VIEWS):
            sheet.paste(tile(os.path.join(R, f"{unit}_{v}_{li}.png"), vn), (LAB + c * TW, HEAD + r * TH))
    os.makedirs(f"docs/realism/{folder}", exist_ok=True)
    out = f"docs/realism/{folder}/sheet-{unit}.jpg"
    sheet.save(out, quality=84)
    print("saved", out)

amb = [(f"{u}_{v}_studio.png", f"{u.split('_')[1]}: {vn}") for u in ("hell_worker", "hell_soldier", "hell_queen") for v, vn in (("34", "three-quarter"), ("side", "side"))]
sheet = Image.new("RGB", (3 * TW, HEAD + 2 * TH), (14, 12, 10))
d = ImageDraw.Draw(sheet)
d.text((12, 8), "Amber specimen mode (ant lab ?amber=1; lab only, never in the game)", fill=(240, 228, 205), font=FONT)
for i, (p, l) in enumerate(amb):
    sheet.paste(tile(os.path.join(R, p), l), ((i // 2) * TW, HEAD + (i % 2) * TH))
sheet.save("docs/realism/hell-ants/amber.jpg", quality=84)
print("saved docs/realism/hell-ants/amber.jpg")
