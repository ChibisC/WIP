#!/usr/bin/env python3
"""Side-by-side before / after of the combat clips — docs/combat/v2.1/{before,after}/ (tests/browser/combat_v21.py) and
docs/combat/reach/{before,after}/ (tests/browser/melee_reach.py, CHANGE_PLAN §18): for each clip a still of the last
frames (compare_<name>.jpg) and a video with the two clips side by side (compare_<name>.mp4), labelled. (The repo keeps
the side-by-side videos and the stills; the separate "after" videos are not kept: run it on a fresh render.)

  python3 tools/combat-v21-compare.py docs/combat/v2.1
  python3 tools/combat-v21-compare.py docs/combat/reach
  python3 tools/combat-v21-compare.py docs/combat/underpass   (combat v2.2, tests/browser/underpass.py)
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
    # melee reach (docs/combat/reach)
    "stag_ring": "a stag beetle and 40 soldiers",
    "six_beetles": "45 workers v six ground beetles",
    "wolf_spider": "a wolf spider and 12 workers",
    "tarantula_mantis": "a tarantula and a mantis v 40 soldiers",
    # under-pass (docs/combat/underpass)
    "minims_through_majors": "8 Atta minims run through a column of majors",
    "atta_mixed_beetle": "4 Atta majors + 20 minims v a ground beetle",
    "eciton_raid": "Eciton soldiers, porters, workers v Red wood ants",
    "from_beneath": "25 fire-ant minors v 2 Atta majors",
    "outline_top": "minims under majors, from above",
}
REACH = os.path.basename(os.path.normpath(D)) == "reach"
UNDER = os.path.basename(os.path.normpath(D)) == "underpass"
LB, LA = ("before (reach from the centre)", "after (reach from the outline)") if REACH else ("before (main)", "after (under-pass)") if UNDER else ("before (combat v2)", "after (combat v2.1)")
VB, VA = ("before", "after (reach)") if REACH else ("before", "after (under-pass)") if UNDER else ("before (v2)", "after (v2.1)")
for name, title in TITLES.items():
    a = os.path.join(D, "before", name + ".jpg")
    b = os.path.join(D, "after", name + ".jpg")
    if not (os.path.exists(a) and os.path.exists(b)):
        continue
    A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    w, h = A.size
    sheet = Image.new("RGB", (w * 2, h + 36), (20, 16, 12))
    d = ImageDraw.Draw(sheet)
    d.text((10, 7), f"{LB} — {title}", fill=(240, 228, 205), font=font)
    d.text((w + 10, 7), LA, fill=(240, 228, 205), font=font)
    sheet.paste(A, (0, 36))
    sheet.paste(B.resize((w, h)), (w, 36))
    sheet.save(os.path.join(D, f"compare_{name}.jpg"), quality=88)
    va = os.path.join(D, "before", name + ".mp4")
    vb = os.path.join(D, "after", name + ".mp4")
    if shutil.which("ffmpeg") and os.path.exists(va) and os.path.exists(vb):
        draw = lambda txt: f"drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='{txt}':x=10:y=10:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.5"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", va, "-i", vb, "-filter_complex",
                        f"[0:v]{draw(VB)}[l];[1:v]{draw(VA)}[r];[l][r]hstack=inputs=2,format=yuv420p",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", os.path.join(D, f"compare_{name}.mp4")], check=False)
    print("saved", name)
