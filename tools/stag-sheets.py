"""Before/after sheets of the stag beetle leg review (docs/realism/stag/): one row per model (size 4 = the boss,
sizes 0–3 the lab's smaller males) with the four views, before above after; and a pose sheet for the boss.

  python3 tools/stag-sheets.py docs/realism/stag
"""
import os, sys
from PIL import Image, ImageDraw

ROOT = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/stag"
VIEWS = ["side", "top", "front", "34"]
POSES = ["rest", "walk", "windup", "lift", "toss", "rear", "dead"]
CW, CH = 500, 380
BG = (18, 16, 14)
INK = (235, 220, 190)


def cell(path):
    if not os.path.exists(path):
        return Image.new("RGB", (CW, CH), (40, 30, 30))
    im = Image.open(path).convert("RGB")
    w, h = im.size
    # crop the middle (the beetle sits at the centre of each lab render)
    cw = int(w * 0.8)
    ch = int(cw * CH / CW)
    return im.crop(((w - cw) // 2, (h - ch) // 2, (w + cw) // 2, (h + ch) // 2)).resize((CW, CH))


def sheet(rows, cols, name, title):
    """rows: list of (label, name-prefix)."""
    sh = Image.new("RGB", (CW * len(cols) + 120, (CH * 2 + 30) * len(rows) + 40), BG)
    d = ImageDraw.Draw(sh)
    d.text((8, 10), title, fill=INK)
    for ci, c in enumerate(cols):
        d.text((120 + ci * CW + 8, 26), c, fill=INK)
    for ri, (label, pre) in enumerate(rows):
        y0 = 40 + ri * (CH * 2 + 30)
        d.text((8, y0 + 8), label, fill=INK)
        d.text((8, y0 + 30), "before", fill=INK)
        d.text((8, y0 + CH + 30), "after", fill=INK)
        for ci, c in enumerate(cols):
            sh.paste(cell(os.path.join(ROOT, "before", f"{pre}_{c}.png")), (120 + ci * CW, y0))
            sh.paste(cell(os.path.join(ROOT, "after", f"{pre}_{c}.png")), (120 + ci * CW, y0 + CH))
    sh.save(os.path.join(ROOT, name))
    print(name, sh.size)


sheet([(f"size {k}" + (" (boss, major male)" if k == 4 else ""), f"size{k}_rest") for k in [4, 3, 2, 1, 0]], VIEWS, "sheet-sizes-rest.jpg", "Stag beetle fore legs — every male size at rest, before (top) / after (bottom)")
sheet([(p, f"size4_{p}") for p in POSES], VIEWS, "sheet-boss-poses.jpg", "Stag beetle boss — poses, before (top) / after (bottom)")
sheet([("boss fore legs, close", "size4_rest_fore")], ["side", "low"], "sheet-closeups.jpg", "Fore legs close up, before (top) / after (bottom)")
sheet([(f"size {k} walking", f"size{k}_walk") for k in [4, 3, 2, 1, 0]], ["side"], "sheet-sizes-walk.jpg", "Every size mid-stride, before (top) / after (bottom)")
