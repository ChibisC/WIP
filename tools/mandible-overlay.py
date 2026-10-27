#!/usr/bin/env python3
"""Overlay a mandible's top-view silhouette (from tools/mandible-dump.ts) on a reference photo (study only;
the output stays out of the repository), to match the outline by eye.

  python3 tools/mandible-overlay.py dump.json stag_1 photo.png out.png --origin 280,690 --scale 728 [--half 0.32] [--side -1]

The photo shows the animal from above, head up. --origin is the hinge (the centreline's start) in photo pixels,
--scale the photo pixels per unit of mandible length, --half the hinge's distance from the midline in the dump.
"""
import argparse, json
import numpy as np
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("dump")
ap.add_argument("name")
ap.add_argument("photo")
ap.add_argument("out")
ap.add_argument("--origin", default="0,0")
ap.add_argument("--scale", type=float, default=500)
ap.add_argument("--half", type=float, default=0.32)
ap.add_argument("--side", type=int, default=-1)
ap.add_argument("--rot", type=float, default=0, help="degrees, + turns the model clockwise in the photo")
a = ap.parse_args()
ox, oy = (float(v) for v in a.origin.split(","))
items = json.load(open(a.dump))[a.name]
it = items[0 if a.side == 1 else 1]
p = np.array(it["pos"]).reshape(-1, 3)
t = np.array(it["idx"]).reshape(-1, 3)
z = p[:, 2] - a.side * a.half
x = p[:, 0]
c, s = np.cos(np.radians(a.rot)), np.sin(np.radians(a.rot))
ix = ox + (z * c - x * s) * a.scale
iy = oy - (x * c + z * s) * a.scale
photo = Image.open(a.photo).convert("RGB")
mask = Image.new("L", photo.size, 0)
d = ImageDraw.Draw(mask)
for tri in t:
    d.polygon([(ix[k], iy[k]) for k in tri], fill=255)
red = Image.new("RGB", photo.size, (40, 220, 255))
over = Image.composite(red, photo, mask.point(lambda v: v * 0.45))
# outline of the silhouette
edge = mask.filter(__import__("PIL.ImageFilter", fromlist=["FIND_EDGES"]).FIND_EDGES)
over.paste((0, 140, 255), mask=edge)
dd = ImageDraw.Draw(over)
dd.ellipse((ox - 4, oy - 4, ox + 4, oy + 4), outline=(255, 0, 0))
for tp in it["tips"]:
    tx = ox + ((tp[2] - a.side * a.half) * c - tp[0] * s) * a.scale
    ty = oy - (tp[0] * c + (tp[2] - a.side * a.half) * s) * a.scale
    dd.ellipse((tx - 3, ty - 3, tx + 3, ty + 3), fill=(255, 255, 0))
over.save(a.out)
print("wrote", a.out)
