"""Compare two golden sets (performance pass, spec §4): SSIM and per-pixel difference for every shot, a verdict against
the threshold, and side-by-side sheets (before | after | difference ×4) for the ones that differ.

Run: python3 tools/golden-compare.py [before] [after]      (defaults: before after; SSIM_MIN=0.985 DIFF_MAX=2.0)
Writes docs/performance/golden/compare-<after>.md and docs/performance/golden/sheets-<after>/<name>.jpg
"""
import os
import sys
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity

ROOT = os.path.join(os.path.dirname(__file__), "..", "docs", "performance", "golden")
A = sys.argv[1] if len(sys.argv) > 1 else "before"
B = sys.argv[2] if len(sys.argv) > 2 else "after"
SSIM_MIN = float(os.environ.get("SSIM_MIN", "0.985"))
# mean absolute difference in 0–255 levels
DIFF_MAX = float(os.environ.get("DIFF_MAX", "2.0"))
da, db = os.path.join(ROOT, A), os.path.join(ROOT, B)
sheets = os.path.join(ROOT, f"sheets-{B}")
os.makedirs(sheets, exist_ok=True)
rows = []
fails = 0
for name in sorted(os.listdir(da)):
    if not name.endswith(".png"):
        continue
    pa, pb = os.path.join(da, name), os.path.join(db, name)
    if not os.path.exists(pb):
        rows.append((name, None, None, None, "missing"))
        fails += 1
        continue
    a = np.asarray(Image.open(pa).convert("RGB")).astype(np.float32)
    b = np.asarray(Image.open(pb).convert("RGB")).astype(np.float32)
    if a.shape != b.shape:
        rows.append((name, None, None, None, "size differs"))
        fails += 1
        continue
    ssim = structural_similarity(a, b, channel_axis=2, data_range=255)
    d = np.abs(a - b)
    mad = float(d.mean())
    p99 = float(np.percentile(d.max(axis=2), 99))
    ok = ssim >= SSIM_MIN and mad <= DIFF_MAX
    if not ok:
        fails += 1
    rows.append((name, ssim, mad, p99, "match" if ok else "DIFFERS"))
    if not ok or os.environ.get("ALL_SHEETS"):
        h, w = a.shape[:2]
        sheet = Image.new("RGB", (w * 3 // 2, h // 2))
        sheet.paste(Image.fromarray(a.astype(np.uint8)).resize((w // 2, h // 2)), (0, 0))
        sheet.paste(Image.fromarray(b.astype(np.uint8)).resize((w // 2, h // 2)), (w // 2, 0))
        sheet.paste(Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).resize((w // 2, h // 2)), (w, 0))
        sheet.save(os.path.join(sheets, name.replace(".png", ".jpg")), quality=88)
out = [f"# Golden set: {A} vs {B}", "", f"Pass: SSIM ≥ {SSIM_MIN} and mean absolute difference ≤ {DIFF_MAX} (0–255 levels).", "",
       "| shot | SSIM | mean diff | p99 diff | verdict |", "|---|---|---|---|---|"]
for name, ssim, mad, p99, v in rows:
    out.append(f"| {name[:-4]} | {'' if ssim is None else f'{ssim:.4f}'} | {'' if mad is None else f'{mad:.2f}'} | {'' if p99 is None else f'{p99:.0f}'} | {v} |")
out += ["", f"{len(rows) - fails} of {len(rows)} match."]
open(os.path.join(ROOT, f"compare-{B}.md"), "w").write("\n".join(out) + "\n")
print("\n".join(out))
raise SystemExit(1 if fails else 0)
