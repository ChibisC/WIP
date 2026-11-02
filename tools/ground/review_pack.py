"""Blind review pack (ground realism item 7): shuffled render and photo crops, renamed, plus a key kept apart.

Usage: python3 tools/ground/review_pack.py OUTDIR SEED item.json
  item.json: [{"src": path, "box": [x0, y0, x1, y1] | null, "kind": "render"|"photo"|"anchor", "label": "...",
               "score": anchor score (anchors only)}]
Writes OUTDIR/pack/item_NN.jpg (each resized so its longer side is 512 px) and OUTDIR/key.json (never inside pack/). Photos are
study-only: OUTDIR must be outside the repository (the scratchpad).
"""
import json
import os
import random
import sys

from PIL import Image

out, seed, spec = sys.argv[1], int(sys.argv[2]), sys.argv[3]
items = json.load(open(spec))
assert "/wip" not in os.path.abspath(out), "review packs hold photos: keep them out of the repository"
random.Random(seed).shuffle(items)
pack = os.path.join(out, "pack")
os.makedirs(pack, exist_ok=True)
key = []
for i, it in enumerate(items, 1):
    im = Image.open(it["src"]).convert("RGB")
    if it.get("box"):
        im = im.crop(tuple(it["box"]))
    # every item to the same size (small crops upscaled), so size is no tell
    k = 512 / max(im.width, im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    name = f"item_{i:02d}.jpg"
    im.save(os.path.join(pack, name), quality=90)
    key.append({"item": name, **{k: v for k, v in it.items() if k != "box"}})
json.dump(key, open(os.path.join(out, "key.json"), "w"), indent=1)
print(f"{len(items)} items in {pack}")
