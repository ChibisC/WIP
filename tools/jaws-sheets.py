#!/usr/bin/env python3
"""Jaws pass: mandible close-ups next to the reference photos at the same angle (docs/realism/jaws).

  python3 tools/jaws-sheets.py docs/realism/jaws docs/realism/pilot-v2/refs

Writes compare-jaws.png (render | photo pairs; contains the study photos: kept out of the repository),
renders-jaws.png (the renders alone) and, for the blind review, blind/pair_NN.jpg with a shuffled side and
blind/key.json.
"""
import json, os, random, sys
from PIL import Image, ImageDraw, ImageOps

D = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/jaws"
REFS = sys.argv[2] if len(sys.argv) > 2 else "docs/realism/pilot-v2/refs"
R = os.path.join(D, "renders")

# (name, render file, render crop or None, photo file, photo crop, photo rotation (degrees ccw), mirror photo)
PAIRS = [
    ("fire ant worker, head from above (jaws closed)", "fire_head_top.png", (150, 0, 850, 700), "fire_07.png", (115, 105, 310, 270), -90, False),
    ("fire ant major, head from the side", "major_head_side.png", (60, 40, 1000, 720), "fire_04.png", (540, 190, 960, 520), 0, False),
    ("stag beetle male, head and antlers from above", "stag_top.png", (150, 0, 850, 760), "stag_05.png", (240, 60, 547, 320), 90, False),
    ("stag beetle male, one antler from above", "stag_mand.png", None, "stag_02.png", (0, 0, 713, 507), 0, True),
    ("stag beetle male, from above and in front", "stag_high.png", (150, 60, 900, 700), "stag_04.png", (0, 0, 390, 420), 0, False),
]
SIZE = 520


def fit(im, box=SIZE):
    im = im.convert("RGB")
    k = min(box / im.width, box / im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    out = Image.new("RGB", (box, box), (236, 234, 230))
    out.paste(im, ((box - im.width) // 2, (box - im.height) // 2))
    return out


def load_pair(p):
    name, rf, rc, pf, pc, rot, mir = p
    r = Image.open(os.path.join(R, rf))
    if rc:
        r = r.crop(rc)
    if mir:
        r = ImageOps.mirror(r)
    ph = Image.open(os.path.join(REFS, pf)).crop(pc)
    if rot:
        ph = ph.rotate(rot, expand=True, fillcolor=(236, 234, 230))
    return name, fit(r), fit(ph)


def sheet(rows, path, with_photos=True):
    cols = 2 if with_photos else 1
    W = cols * SIZE + 20
    H = len(rows) * (SIZE + 30) + 30
    out = Image.new("RGB", (W, H), (18, 16, 14))
    d = ImageDraw.Draw(out)
    d.text((10, 8), "Jaws pass: render (left)" + (" | reference photo, study only (right)" if with_photos else ""), fill=(235, 220, 190))
    y = 30
    for name, r, ph in rows:
        d.text((10, y + 4), name, fill=(235, 220, 190))
        out.paste(r, (10, y + 22))
        if with_photos:
            out.paste(ph, (10 + SIZE, y + 22))
        y += SIZE + 30
    out.save(path)


rows = [load_pair(p) for p in PAIRS]
sheet(rows, os.path.join(D, "compare-jaws.png"))
sheet(rows, os.path.join(D, "renders-jaws.png"), with_photos=False)

# allometry: the five male sizes against photo stag_06
try:
    sizes = [Image.open(os.path.join(R, f"stag_size{k}.png")).crop((300, 0, 900, 760)) for k in (4, 3, 2, 1, 0)]
    w = 240
    strip = Image.new("RGB", (w * 5 + 20, 600), (18, 16, 14))
    d = ImageDraw.Draw(strip)
    d.text((10, 6), "Allometry: male size 1 to 0 (render, top) | photo stag_06 (study only), five males from large to small", fill=(235, 220, 190))
    for i, im in enumerate(sizes):
        im.thumbnail((w, 300))
        strip.paste(im, (10 + i * w, 24))
    ph = Image.open(os.path.join(REFS, "stag_06.png"))
    ph.thumbnail((w * 5, 270))
    strip.paste(ph, (10, 330))
    strip.save(os.path.join(D, "compare-allometry.png"))
except FileNotFoundError:
    pass

# blind pairs for a fresh reviewer: same framing, sides shuffled
random.seed(int(os.environ.get("SEED", "7")))
bd = os.path.join(D, "blind")
os.makedirs(bd, exist_ok=True)
key = {}
for i, (name, r, ph) in enumerate(rows):
    left_render = random.random() < 0.5
    a, b = (r, ph) if left_render else (ph, r)
    out = Image.new("RGB", (SIZE * 2 + 12, SIZE), (30, 30, 30))
    out.paste(a, (0, 0))
    out.paste(b, (SIZE + 12, 0))
    f = f"pair_{i + 1:02d}.jpg"
    out.save(os.path.join(bd, f), quality=88)
    key[f] = {"subject": name, "render": "left" if left_render else "right"}
json.dump(key, open(os.path.join(bd, "key.json"), "w"), indent=1)
print("wrote", D)
