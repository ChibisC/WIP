#!/usr/bin/env python3
"""Compose the realism pilot's before/after sheets (docs/realism/pilot) from the renders in that folder.

  python3 tools/realism-sheets.py docs/realism/pilot
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

D = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/pilot"
try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
except Exception:
    FONT = ImageFont.load_default()


def tile(path, w, h, label):
    im = Image.open(path).convert("RGB") if os.path.exists(path) else Image.new("RGB", (w, h), (30, 26, 22))
    im = im.resize((w, h))
    d = ImageDraw.Draw(im)
    d.rectangle([0, h - 28, w, h], fill=(18, 15, 12))
    d.text((10, h - 25), label, fill=(240, 228, 205), font=FONT)
    return im


def grid(out, rows, w=480, h=300, title=None):
    """rows: [(row label, [(path, label), …]), …]"""
    cols = max(len(r[1]) for r in rows)
    head = 34 if title else 0
    lab = 110
    sheet = Image.new("RGB", (lab + cols * w, head + len(rows) * h), (14, 12, 10))
    d = ImageDraw.Draw(sheet)
    if title:
        d.text((12, 8), title, fill=(240, 228, 205), font=FONT)
    for r, (rl, items) in enumerate(rows):
        d.text((12, head + r * h + h // 2 - 10), rl, fill=(224, 190, 120), font=FONT)
        for c, (p, l) in enumerate(items):
            sheet.paste(tile(os.path.join(D, p), w, h, l), (lab + c * w, head + r * h))
    sheet.save(os.path.join(D, out))
    print("saved", os.path.join(D, out))


views = [("34", "three-quarter"), ("side", "side"), ("top", "top"), ("front", "front")]
grid("stag_beetle.png", [(t, [(f"{t}_stag_{v}.png", n) for v, n in views] + [(f"{t}_stag_macro.png", "close-up")]) for t in ("before", "after")], title="Stag beetle (Lucanus cervus) — creature lab, before and after")
grid("fire_ant.png", [(t, [(f"{t}_fire_{v}.png", n) for v, n in views] + [(f"{t}_fire_macro.png", "macro close-up")]) for t in ("before", "after")], title="Tropical fire ant worker (Solenopsis geminata) — ant lab, before and after")
grid("in_game.png", [(t, [(f"{t}_gameplay_zoom.png", "stag: gameplay zoom"), (f"{t}_far_zoom.png", "stag: far zoom"), (f"{t}_macro_stag.png", "stag: close"), (f"{t}_ants_gameplay_zoom.png", "fire ants: gameplay zoom"), (f"{t}_ants_close.png", "fire ants: close")]) for t in ("before", "after")], title="In the game (battle arena) — before and after")
frames = [("after_strip_1_walk.png", "1 walking (tripod gait, body rolls)"), ("after_strip_2_windup.png", "2 antlers open (cone telegraph)"), ("after_strip_3_lift.png", "3 two ants clamped and lifted"), ("after_strip_4_toss.png", "4 the toss: a flick to one side"), ("after_strip_5_rear.png", "5 enraged: rears up"), ("after_strip_6_slam.png", "6 and slams down")]
grid("stag_strip.png", [("", frames[:3]), ("", frames[3:])], w=560, h=340, title="Stag beetle in action (after)")
