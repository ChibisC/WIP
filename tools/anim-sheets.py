#!/usr/bin/env python3
"""Animation pass: before/after frame strips per clip (docs/realism/animation).

  python3 tools/anim-sheets.py docs/realism/animation

For every clip recorded both ways (clips/<clip>_before_frames, clips/<clip>_after_frames) writes
strips/<clip>.png: eight frames of the old motion above eight of the new, at the same moments. A clip recorded
only with the pass gets its after strip alone.
"""
import glob, os, sys
from PIL import Image, ImageDraw

D = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/animation"
C = os.path.join(D, "clips")
S = os.path.join(D, "strips")
os.makedirs(S, exist_ok=True)
N = 8


def row(frames, w, h):
    pick = [frames[round(i * (len(frames) - 1) / (N - 1))] for i in range(N)]
    out = Image.new("RGB", (w * N, h))
    for i, f in enumerate(pick):
        out.paste(Image.open(f).convert("RGB").resize((w, h)), (i * w, 0))
    return out


clips = sorted({os.path.basename(p).rsplit("_", 2)[0] for p in glob.glob(os.path.join(C, "*_after_frames"))})
for clip in clips:
    after = sorted(glob.glob(os.path.join(C, f"{clip}_after_frames", "*.png")))
    before = sorted(glob.glob(os.path.join(C, f"{clip}_before_frames", "*.png")))
    if not after:
        continue
    im = Image.open(after[0])
    w, h = im.width // 3, im.height // 3
    rows = [("before (old motion)", before)] if before else []
    rows.append(("after (animation pass)", after))
    sheet = Image.new("RGB", (w * N, len(rows) * (h + 20) + 22), (18, 16, 14))
    d = ImageDraw.Draw(sheet)
    d.text((6, 5), f"{clip}: {N} frames evenly spaced over the clip", fill=(235, 220, 190))
    y = 22
    for label, frames in rows:
        d.text((6, y + 3), label, fill=(200, 190, 170))
        sheet.paste(row(frames, w, h), (0, y + 18))
        y += h + 20
    sheet.save(os.path.join(S, f"{clip}.png"))
    print("wrote", clip)
