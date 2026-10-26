"""Draw an authored map's layout sketch from tools/map-dump.ts output.
Usage: python3 tools/map-sketch.py <dump.json> <out.png> [--hex]
Ground shaded by height, water (where ants stop) blue, walkways tan, walls grey; zones outlined
(food gold, aphid green, plant leaf, lair red, creature brown dashes), the flood zone dashed blue,
sites as numbered discs (footprint) with their dry ring and entrances. --hex adds the hex grid."""
import json, math, sys
from PIL import Image, ImageDraw, ImageFont

d = json.load(open(sys.argv[1]))
out = sys.argv[2]
show_hex = '--hex' in sys.argv
S = 0.5  # px per mm
W, H = int(d['width'] * S), int(d['depth'] * S)
img = Image.new('RGB', (W, H + 40), (24, 20, 16))
px = img.load()
nx, ny, step = d['nx'], d['ny'], d['step']
hs = d['height']
lo, hi = min(hs), max(hs)
for j in range(ny):
    for i in range(nx):
        k = j * nx + i
        h = (hs[k] - lo) / max(1e-6, hi - lo)
        kind = d['kind'][k]
        if kind == 1:
            c = (int(40 + 30 * h), int(92 + 40 * h), int(140 + 40 * h))
        elif kind == 2:
            c = (186, 160, 118)
        elif kind == 3:
            c = (110, 104, 98)
        else:
            g = 0.75 + 0.5 * h
            c = (int(92 * g), int(128 * g), int(64 * g))
        x0, y0 = int(i * step * S), int(j * step * S)
        for yy in range(y0, min(H, int((j + 1) * step * S) + 1)):
            for xx in range(x0, min(W, int((i + 1) * step * S) + 1)):
                px[xx, yy] = c
dr = ImageDraw.Draw(img, 'RGBA')
hx = d['hex']
R, Hh, C, cols = hx['R'], hx['H'], hx['C'], hx['cols']


def centre(q):
    c, r = q % cols, q // cols
    return (R + c * C, Hh * 0.5 + r * Hh + (Hh * 0.5 if c & 1 else 0))


def hexpoly(q, scale=1.0):
    cx, cy = centre(q)
    return [((cx + math.cos(math.radians(a)) * R * scale) * S, (cy + math.sin(math.radians(a)) * R * scale) * S) for a in range(0, 360, 60)]


if show_hex:
    for q in range(len(d['type'])):
        dr.polygon(hexpoly(q), outline=(255, 255, 255, 28))


def shape_outline(s, col, width=2, dash=False):
    if 'circle' in s:
        (x, y), r = s['circle'], s['r']
        bb = [(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S]
        if dash:
            for a in range(0, 360, 20):
                dr.arc(bb, a, a + 10, fill=col, width=width)
        else:
            dr.ellipse(bb, outline=col, width=width)
    elif 'ellipse' in s:
        (x, y), rx, ry = s['ellipse'], s['rx'], s['ry']
        dr.ellipse([(x - rx) * S, (y - ry) * S, (x + rx) * S, (y + ry) * S], outline=col, width=width)
    elif 'poly' in s:
        pts = [(p[0] * S, p[1] * S) for p in s['poly']]
        dr.line(pts + [pts[0]], fill=col, width=width)
    elif 'path' in s:
        dr.line([(p[0] * S, p[1] * S) for p in s['path']], fill=col, width=max(1, int(s['width'] * S)))


ZC = {'food': (240, 196, 70, 230), 'aphid': (120, 230, 120, 230), 'plant': (170, 220, 90, 200), 'lair': (230, 80, 70, 240), 'creature': (150, 110, 70, 60), 'litter': (190, 150, 90, 200), 'noSpawn': (255, 255, 255, 120)}
for z in d['zones']:
    if z['kind'] == 'creature':
        continue
    shape_outline(z['shape'], ZC.get(z['kind'], (255, 255, 255, 200)), 2)
for f in d['floods']:
    shape_outline(f['shape'], (110, 170, 255, 220), 3, dash=True)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
except OSError:
    font = small = ImageFont.load_default()
for s in d['sites']:
    for q in s['ring']:
        dr.polygon(hexpoly(q, 0.97), fill=(255, 240, 200, 38))
    for q in s['footprint']:
        dr.polygon(hexpoly(q, 0.97), fill=(250, 214, 120, 150))
    for ex, ey in s['entrances']:
        dr.ellipse([(ex - 4) * S - 2, (ey - 4) * S - 2, (ex + 4) * S + 2, (ey + 4) * S + 2], fill=(30, 20, 10, 255), outline=(255, 230, 160, 255))
    dr.text((s['x'] * S, s['y'] * S), str(s['i']), fill=(20, 14, 6, 255), font=font, anchor='mm')
legend = f"{d['name']}  {d['width']:.0f} x {d['depth']:.0f} mm, hex R {R:g} mm, layout {d['hash']}   |  water  walkway  wall  | food  aphid  plant  lair  | flood (dashed) | sites: footprint + dry ring, entrances"
dr.rectangle([0, H, W, H + 40], fill=(24, 20, 16, 255))
dr.text((8, H + 12), legend, fill=(230, 220, 200, 255), font=small)
img.save(out)
print('wrote', out)
