"""Compare two golden sets (performance pass, spec §4): SSIM and per-pixel difference for every shot, a verdict against
the threshold, and side-by-side sheets (before | after | difference ×4) for the ones that differ.

Run: python3 tools/golden-compare.py [before] [after] [noise]   (defaults: before after; SSIM_MIN=0.985 DIFF_MAX=2.0)
Writes docs/performance/golden/compare-<after>.md and docs/performance/golden/sheets-<after>/<name>.jpg

Run-to-run noise: the renderer gives each ant a random gait phase and antenna wave when it first draws it, and effects
use random sparks, so two renders of the same build differ wherever ants walk. [noise] is a second render of the
"before" build for those shots: a shot whose after-vs-before difference is no larger than before-vs-noise (SSIM at most
0.003 lower, mean difference at most 1.5 × + 0.1) passes as "match (run-to-run noise)".
"""
import os
import sys
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity

ROOT = os.path.join(os.path.dirname(__file__), "..", "docs", "performance", "golden")
A = sys.argv[1] if len(sys.argv) > 1 else "before"
B = sys.argv[2] if len(sys.argv) > 2 else "after"
N = sys.argv[3] if len(sys.argv) > 3 else None
SSIM_MIN = float(os.environ.get("SSIM_MIN", "0.985"))
# mean absolute difference in 0–255 levels
DIFF_MAX = float(os.environ.get("DIFF_MAX", "2.0"))
da, db = os.path.join(ROOT, A), os.path.join(ROOT, B)
dn = os.path.join(ROOT, N) if N else None


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.float32)


def measure(a, b):
    return structural_similarity(a, b, channel_axis=2, data_range=255), float(np.abs(a - b).mean())
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
    a = load(pa)
    b = load(pb)
    if a.shape != b.shape:
        rows.append((name, None, None, None, "size differs"))
        fails += 1
        continue
    ssim, mad = measure(a, b)
    d = np.abs(a - b)
    p99 = float(np.percentile(d.max(axis=2), 99))
    ok = ssim >= SSIM_MIN and mad <= DIFF_MAX
    verdict = "match" if ok else "DIFFERS"
    if not ok and dn and os.path.exists(os.path.join(dn, name)):
        ns, nm = measure(a, load(os.path.join(dn, name)))
        if ssim >= ns - 0.003 and mad <= nm * 1.5 + 0.1:
            ok = True
            verdict = f"match (run-to-run noise: before vs before {ns:.4f} / {nm:.2f})"
        else:
            verdict = f"DIFFERS (run-to-run noise only {ns:.4f} / {nm:.2f})"
    if not ok:
        fails += 1
    rows.append((name, ssim, mad, p99, verdict))
    if not ok or os.environ.get("ALL_SHEETS"):
        h, w = a.shape[:2]
        sheet = Image.new("RGB", (w * 3 // 2, h // 2))
        sheet.paste(Image.fromarray(a.astype(np.uint8)).resize((w // 2, h // 2)), (0, 0))
        sheet.paste(Image.fromarray(b.astype(np.uint8)).resize((w // 2, h // 2)), (w // 2, 0))
        sheet.paste(Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).resize((w // 2, h // 2)), (w, 0))
        sheet.save(os.path.join(sheets, name.replace(".png", ".jpg")), quality=88)
out = [f"# Golden set: {A} vs {B}" + (f" (run-to-run noise from {N})" if N else ""), "", f"Pass: SSIM ≥ {SSIM_MIN} and mean absolute difference ≤ {DIFF_MAX} (0–255 levels).", "",
       "| shot | SSIM | mean diff | p99 diff | verdict |", "|---|---|---|---|---|"]
for name, ssim, mad, p99, v in rows:
    out.append(f"| {name[:-4]} | {'' if ssim is None else f'{ssim:.4f}'} | {'' if mad is None else f'{mad:.2f}'} | {'' if p99 is None else f'{p99:.0f}'} | {v} |")
out += ["", f"{len(rows) - fails} of {len(rows)} match."]
open(os.path.join(ROOT, f"compare-{B}.md"), "w").write("\n".join(out) + "\n")
print("\n".join(out))
raise SystemExit(1 if fails else 0)
