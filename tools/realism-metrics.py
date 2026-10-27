#!/usr/bin/env python3
"""Realism pass v2: numbers for the acceptance checks (docs/realism/pilot-v2).

  python3 tools/realism-metrics.py docs/realism/pilot-v2/renders [refs_dir] > docs/realism/pilot-v2/metrics.md

1. Visible difference: mean colour difference (CIE76 ΔE in Lab) between each before render and the after
   render from the same camera (overcast and sunny), over the whole image and over the subject only.
2. Colour per body part: from the part masks (mask_<view>.png), each part's circular mean hue (degrees),
   mean saturation and value (HSV), and mean Lab, for every after render; and, when a refs dir with
   refs.json is given, the same for the reference photos (part polygons drawn by hand in refs.json).
3. Highlights: in each render the specular highlights on the subject (bright and pale) are found as
   connected blobs; the largest are reported with their area and roundness (4πA/P², 1 = a disc) and how
   even their brightness is. A large, round, evenly bright blob is the "plastic" highlight the check forbids.
Writes metrics.json next to the renders.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import color as skcolor, measure

R = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/pilot-v2/renders"
REFS = sys.argv[2] if len(sys.argv) > 2 else ""

PARTS = {
    "fire": {"head": (255, 0, 0), "mesosoma": (0, 255, 0), "gaster": (0, 0, 255), "waist": (0, 255, 255), "legs": (255, 255, 0), "antennae": (255, 0, 255)},
    "stag": {"head": (255, 0, 0), "pronotum": (0, 255, 0), "elytra": (0, 0, 255), "mandibles": (255, 128, 0), "legs": (255, 255, 0), "antennae": (255, 0, 255)},
}


def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.float32) / 255.0


def part_masks(mask_img, species, erode=2):
    m = (mask_img * 255).round().astype(int)
    out = {}
    for name, (r, g, b) in PARTS[species].items():
        sel = (np.abs(m[..., 0] - r) < 40) & (np.abs(m[..., 1] - g) < 40) & (np.abs(m[..., 2] - b) < 40)
        if erode:
            sel = ndimage.binary_erosion(sel, iterations=erode)
        out[name] = sel
    subject = m.sum(axis=2) > 30
    return out, subject


def stats(img, sel):
    """Colour of the pixels in sel: circular mean hue, mean S and V, mean Lab."""
    px = img[sel]
    if len(px) < 30:
        return None
    hsv = skcolor.rgb2hsv(px.reshape(-1, 1, 3)).reshape(-1, 3)
    # weight hue by saturation (grey pixels have no meaningful hue)
    w = hsv[:, 1] + 1e-6
    ang = hsv[:, 0] * 2 * np.pi
    hue = (np.degrees(np.arctan2((np.sin(ang) * w).sum(), (np.cos(ang) * w).sum())) + 360) % 360
    lab = skcolor.rgb2lab(px.reshape(-1, 1, 3)).reshape(-1, 3)
    return {
        "n": int(len(px)),
        "hue": round(float(hue), 1),
        "sat": round(float(hsv[:, 1].mean()), 3),
        "val": round(float(hsv[:, 2].mean()), 3),
        "lab": [round(float(v), 1) for v in lab.mean(axis=0)],
        "srgb": "#%02x%02x%02x" % tuple(int(round(v * 255)) for v in np.median(px, axis=0)),
    }


def delta_e(a, b, sel=None):
    la = skcolor.rgb2lab(a)
    lb = skcolor.rgb2lab(b)
    d = np.sqrt(((la - lb) ** 2).sum(axis=2))
    return round(float(d[sel].mean() if sel is not None else d.mean()), 2)


def highlights(img, subject, top=3):
    """Specular highlight blobs on the subject: bright (V > .82) and pale (S < .38)."""
    hsv = skcolor.rgb2hsv(img)
    hl = subject & (hsv[..., 2] > 0.82) & (hsv[..., 1] < 0.38)
    lab = measure.label(hl, connectivity=2)
    out = []
    for r in measure.regionprops(lab, intensity_image=hsv[..., 2]):
        if r.area < 12:
            continue
        per = max(r.perimeter, 1.0)
        round_ = 4 * np.pi * r.area / (per * per)
        vals = hsv[..., 2][lab == r.label]
        out.append({"area": int(r.area), "roundness": round(float(min(1.0, round_)), 2), "solidity": round(float(r.solidity), 2), "evenness": round(float(1 - vals.std() * 6), 2)})
    out.sort(key=lambda h: -h["area"])
    big = [h for h in out if h["area"] >= 0.0015 * subject.sum()]
    blob = [h for h in big if h["roundness"] > 0.7 and h["solidity"] > 0.9 and h["evenness"] > 0.7]
    return {"count": len(out), "largest": out[:top], "plastic_blobs": len(blob)}


def main():
    res = {"delta_e": {}, "parts": {}, "highlights": {}, "refs": {}}
    views = sorted({f[len("mask_"):-4] for f in os.listdir(R) if f.startswith("mask_")})
    for v in views:
        species = v.split("_")[0]
        mimg = load(os.path.join(R, f"mask_{v}.png"))
        masks, subject = part_masks(mimg, species)
        for light in ("studio", "overcast", "sunny", "backlit"):
            p = os.path.join(R, f"after_{v}_{light}.png")
            if not os.path.exists(p):
                continue
            img = load(p)
            if img.shape != mimg.shape:
                continue
            key = f"{v}_{light}"
            res["parts"][key] = {name: stats(img, sel) for name, sel in masks.items()}
            res["highlights"][key] = highlights(img, ndimage.binary_erosion(subject, iterations=2))
            b = os.path.join(R, f"before_{v}.png")
            if os.path.exists(b):
                bimg = load(b)
                if bimg.shape == img.shape:
                    res["delta_e"][key] = {"image": delta_e(bimg, img), "subject": delta_e(bimg, img, subject)}
    if REFS and os.path.exists(os.path.join(REFS, "refs.json")):
        refs = json.load(open(os.path.join(REFS, "refs.json")))
        for r in refs:
            img = load(os.path.join(REFS, r["file"]))
            h, w = img.shape[:2]
            out = {}
            for part, polys in r.get("parts", {}).items():
                sel = np.zeros((h, w), bool)
                for poly in polys:
                    rr, cc = measure_poly(poly, h, w)
                    sel[rr, cc] = True
                out[part] = stats(img, sel)
            res["refs"][r["file"]] = {"species": r["species"], "view": r.get("view", ""), "parts": out}
    json.dump(res, open(os.path.join(R, "metrics.json"), "w"), indent=1)
    report(res)


def measure_poly(poly, h, w):
    from skimage.draw import polygon
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return polygon(ys, xs, (h, w))


def report(res):
    print("## Visible difference (before → after, mean ΔE CIE76)\n")
    print("| view | light | whole image | subject |\n|---|---|---|---|")
    for k, d in res["delta_e"].items():
        v, light = k.rsplit("_", 1)
        print(f"| {v} | {light} | {d['image']} | {d['subject']} |")
    print("\n## Colour per body part (renders)\n")
    print("| view | light | part | hue° | sat | val | median sRGB |\n|---|---|---|---|---|---|---|")
    for k, parts in res["parts"].items():
        v, light = k.rsplit("_", 1)
        for name, s in parts.items():
            if s:
                print(f"| {v} | {light} | {name} | {s['hue']} | {s['sat']} | {s['val']} | {s['srgb']} |")
    if res["refs"]:
        print("\n## Colour per body part (reference photos)\n")
        print("| photo | part | hue° | sat | val | median sRGB |\n|---|---|---|---|---|---|")
        for f, r in res["refs"].items():
            for name, s in r["parts"].items():
                if s:
                    print(f"| {f} | {name} | {s['hue']} | {s['sat']} | {s['val']} | {s['srgb']} |")
    print("\n## Highlights on the subject (largest blobs: area px, roundness, solidity, evenness)\n")
    print("| view | light | blobs | plastic blobs | largest |\n|---|---|---|---|---|")
    for k, h in res["highlights"].items():
        v, light = k.rsplit("_", 1)
        lg = "; ".join(f"{x['area']} / {x['roundness']} / {x['solidity']} / {x['evenness']}" for x in h["largest"])
        print(f"| {v} | {light} | {h['count']} | {h['plastic_blobs']} | {lg} |")


if __name__ == "__main__":
    main()
