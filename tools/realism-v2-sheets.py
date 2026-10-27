#!/usr/bin/env python3
"""Realism pass v2 sheets (docs/realism/pilot-v2).

  python3 tools/realism-v2-sheets.py docs/realism/pilot-v2 [refs_dir]

Builds, from <dir>/renders:
  compare-fire.png, compare-stag.png   per view: reference photo | render (overcast) | render (sunny)
  before-after.png                     the old build against the new, same cameras
  backlit.png                          light through the thin parts
and, with refs_dir (refs.json: file, species, view, credit, license, render (the matching view)), a blind
review kit in <dir>/blind/: pair_NN.png (a photo and a render side by side, order random, unlabelled), and
blind/key.json (which side is which) — the key is for scoring only and is never shown to the reviewer.

Reference photos are study material only: these sheets stay out of the game and out of the public
repository (docs/realism/pilot-v2/.gitignore).
"""
import json, os, random, sys
from PIL import Image, ImageDraw, ImageFont

D = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/pilot-v2"
REFS = sys.argv[2] if len(sys.argv) > 2 else ""
R = os.path.join(D, "renders")
try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    SMALL = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
except Exception:
    FONT = SMALL = ImageFont.load_default()


def contain(im, w, h):
    """Scale to fit inside w×h, padded with the image's own border colour (no part of the animal cut off)."""
    import numpy as np
    a = np.asarray(im.convert("RGB"))
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = tuple(int(v) for v in np.median(border, axis=0))
    s = min(w / im.width, h / im.height)
    im2 = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    out = Image.new("RGB", (w, h), bg)
    out.paste(im2, ((w - im2.width) // 2, (h - im2.height) // 2))
    return out


def subject_crop(render_path, margin=0.12):
    """A render cropped to the animal (its part mask), so it is framed like the photo."""
    im = Image.open(render_path).convert("RGB")
    view = os.path.basename(render_path)[len("after_"):].rsplit("_", 1)[0]
    mp = os.path.join(R, f"mask_{view}.png")
    if not os.path.exists(mp):
        return im
    import numpy as np
    m = np.asarray(Image.open(mp).convert("RGB")).sum(axis=2) > 30
    ys, xs = np.nonzero(m)
    if len(xs) < 50:
        return im
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    dx, dy = (x1 - x0) * margin, (y1 - y0) * margin
    return im.crop((max(0, int(x0 - dx)), max(0, int(y0 - dy)), min(im.width, int(x1 + dx)), min(im.height, int(y1 + dy))))


def fit(im, w, h):
    """Scale to cover w×h and crop the middle (photos and renders have different aspects)."""
    s = max(w / im.width, h / im.height)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    x = (im.width - w) // 2
    y = (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def tile(path, label, sub="", w=520, h=330):
    if path and os.path.exists(path):
        im = fit(Image.open(path).convert("RGB"), w, h)
    else:
        im = Image.new("RGB", (w, h), (34, 30, 26))
        ImageDraw.Draw(im).text((20, h // 2 - 10), "photo pending", fill=(160, 150, 130), font=FONT)
    d = ImageDraw.Draw(im)
    d.rectangle([0, h - (44 if sub else 28), w, h], fill=(18, 15, 12))
    d.text((10, h - (42 if sub else 25)), label, fill=(240, 228, 205), font=FONT)
    if sub:
        d.text((10, h - 20), sub, fill=(190, 180, 160), font=SMALL)
    return im


def grid(out, title, rows, w=520, h=330):
    cols = max(len(r[1]) for r in rows)
    lab = 130
    head = 36
    sheet = Image.new("RGB", (lab + cols * w, head + len(rows) * h), (14, 12, 10))
    d = ImageDraw.Draw(sheet)
    d.text((12, 8), title, fill=(240, 228, 205), font=FONT)
    for ri, (rl, items) in enumerate(rows):
        d.text((12, head + ri * h + h // 2 - 10), rl, fill=(224, 190, 120), font=FONT)
        for ci, it in enumerate(items):
            sheet.paste(tile(*it, w=w, h=h) if isinstance(it, tuple) else it, (lab + ci * w, head + ri * h))
    sheet.save(os.path.join(D, out))
    print("saved", os.path.join(D, out))


def tile_args(path, label, sub=""):
    return (path, label, sub)


refs = []
if REFS and os.path.exists(os.path.join(REFS, "refs.json")):
    refs = json.load(open(os.path.join(REFS, "refs.json")))

VIEWS = ["profile", "side", "top", "front", "34", "macro"]
NAMES = {"profile": "profile", "side": "side", "top": "top", "front": "front / head", "34": "three-quarter", "macro": "macro close-up"}
LIGHTS = ["studio", "overcast", "sunny"]


def ref_image(r):
    """A reference photo, cropped to the animal when refs.json gives a crop (labels and scale bars removed)."""
    im = Image.open(os.path.join(REFS, r["file"])).convert("RGB")
    if r.get("crop"):
        im = im.crop(tuple(r["crop"]))
    return im


def tile_img(im, label, sub="", w=520, h=330):
    tmp = os.path.join(D, ".tile.png")
    im.save(tmp)
    t = tile(tmp, label, sub, w, h)
    os.remove(tmp)
    return t


for sp, title in (("fire", "Tropical fire ant worker (Solenopsis geminata): photo vs render"), ("stag", "Stag beetle (Lucanus cervus) male: photo vs render")):
    rows = []
    for r in [r for r in refs if r["species"] == sp]:
        v = r["render"]
        light = r.get("light", "overcast")
        credit = f"{r.get('credit', '')} ({r.get('license', '')})"
        items = [tile_img(ref_image(r), f"photo {r['file']} (study only)", credit[:70])]
        for l in [light] + [x for x in LIGHTS if x != light]:
            items.append(tile(os.path.join(R, f"after_{v}_{l}.png"), f"render: {v.split('_', 1)[1]}, {l}"))
        rows.append((r["file"].split(".")[0], items))
    grid(f"compare-{sp}.png", title, rows)

rows = []
for sp in ("fire", "stag"):
    for v in VIEWS:
        if not os.path.exists(os.path.join(R, f"before_{sp}_{v}.png")):
            continue
        rows.append((f"{sp} {NAMES[v]}", [tile(os.path.join(R, f"before_{sp}_{v}.png"), "before"), tile(os.path.join(R, f"after_{sp}_{v}_overcast.png"), "after (overcast)"), tile(os.path.join(R, f"after_{sp}_{v}_sunny.png"), "after (sunny)"), tile(os.path.join(R, f"after_{sp}_{v}_studio.png"), "after (studio)")]))
grid("before-after.png", "Realism v2: before and after (same cameras)", rows)

grid("backlit.png", "Backlit test: the sun low behind the animal", [("fire ant", [tile(os.path.join(R, "after_fire_side_backlit.png"), "backlit", w=780, h=460), tile(os.path.join(R, "after_fire_side_sunny.png"), "front-lit (sunny)", w=780, h=460)]), ("stag beetle", [tile(os.path.join(R, "after_stag_side_backlit.png"), "backlit", w=780, h=460), tile(os.path.join(R, "after_stag_side_sunny.png"), "front-lit (sunny)", w=780, h=460)])], w=780, h=460)

# blind review kit
if refs:
    B = os.path.join(D, "blind")
    os.makedirs(B, exist_ok=True)
    rnd = random.Random(int(os.environ.get("SEED", "1")))
    key = []
    n = 0
    for r in refs:
        v = r.get("render")
        if not v:
            continue
        light = r.get("light", "overcast")
        rp = os.path.join(R, f"after_{v}_{light}.png")
        if not os.path.exists(rp):
            continue
        n += 1
        src = ref_image(r)
        # the same treatment for both: the render brought down to the photo's resolution, both through JPEG
        rimg = subject_crop(rp)
        sc = min(1.0, max(src.width / rimg.width, src.height / rimg.height))
        rimg = rimg.resize((max(1, round(rimg.width * sc)), max(1, round(rimg.height * sc))), Image.LANCZOS)

        def jpeg(im):
            import io
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=88)
            return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")

        photo = contain(jpeg(src), 700, 470)
        rend = contain(jpeg(rimg), 700, 470)
        left_is_photo = rnd.random() < 0.5
        pair = Image.new("RGB", (1420, 490), (20, 20, 20))
        pair.paste(photo if left_is_photo else rend, (0, 10))
        pair.paste(rend if left_is_photo else photo, (720, 10))
        name = f"pair_{n:02d}.png"
        pair.save(os.path.join(B, name))
        key.append({"pair": name, "photo": "left" if left_is_photo else "right", "ref": r["file"], "render": os.path.basename(rp)})
    json.dump(key, open(os.path.join(B, "key.json"), "w"), indent=1)
    print("blind pairs:", n)
