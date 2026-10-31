#!/usr/bin/env python3
"""Side-by-side before / after of the combat v2.1 clips (docs/combat/v2.1/{before,after}/, from
tests/browser/combat_v21.py): for each clip a still of the last frames (compare_<name>.jpg) and a video with the two
clips side by side (compare_<name>.mp4), labelled. (The repo keeps the side-by-side videos and the stills; the separate
"after" videos are not kept: run it on a fresh render.)

  python3 tools/combat-v21-compare.py docs/combat/v2.1
"""
import os, sys, subprocess, shutil
from PIL import Image, ImageDraw, ImageFont

D = sys.argv[1] if len(sys.argv) > 1 else "docs/combat/v2.1"
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
except Exception:
    font = ImageFont.load_default()
TITLES = {
    "drift_clash": "60 v 60 clash, close: holders biting and stinging",
    "drift_spray": "Formica sprayers and mortars v Black garden ants",
    "creature_bites": "a tarantula and a stag beetle biting ants",
    "oneside_beetle": "30 ants charge one beetle from the west",
    "six_creatures": "45 ants v a group of six ground beetles",
}
for name, title in TITLES.items():
    a = os.path.join(D, "before", name + ".jpg")
    b = os.path.join(D, "after", name + ".jpg")
    if not (os.path.exists(a) and os.path.exists(b)):
        continue
    A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    w, h = A.size
    sheet = Image.new("RGB", (w * 2, h + 36), (20, 16, 12))
    d = ImageDraw.Draw(sheet)
    d.text((10, 7), f"before (combat v2) — {title}", fill=(240, 228, 205), font=font)
    d.text((w + 10, 7), "after (combat v2.1)", fill=(240, 228, 205), font=font)
    sheet.paste(A, (0, 36))
    sheet.paste(B.resize((w, h)), (w, 36))
    sheet.save(os.path.join(D, f"compare_{name}.jpg"), quality=88)
    va = os.path.join(D, "before", name + ".mp4")
    vb = os.path.join(D, "after", name + ".mp4")
    if shutil.which("ffmpeg") and os.path.exists(va) and os.path.exists(vb):
        draw = lambda txt: f"drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='{txt}':x=10:y=10:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.5"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", va, "-i", vb, "-filter_complex",
                        f"[0:v]{draw('before (v2)')}[l];[1:v]{draw('after (v2.1)')}[r];[l][r]hstack=inputs=2,format=yuv420p",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", os.path.join(D, f"compare_{name}.mp4")], check=False)
    print("saved", name)
