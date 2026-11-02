"""Draw each map's team layouts (docs/maps/team-sites/sites.json, from tools/team-sites.ts) on its sketch
(docs/maps/sketches/<map>.png): one picture per map with a panel per team shape, each team's sites ringed in its
colour and allies joined by a line. Writes docs/maps/team-sites/<map>.png.

  python3 tools/team-sites-sketch.py
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

D = 'docs/maps/team-sites'
data = json.load(open(os.path.join(D, 'sites.json')))
COLS = [(230, 70, 60), (70, 130, 230), (80, 190, 80), (230, 180, 50), (180, 90, 220)]
SOLO = (235, 235, 235)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
except Exception:
    font = ImageFont.load_default()
for mid, m in data.items():
    base = Image.open(os.path.join('docs/maps/sketches', mid + '.png')).convert('RGB')
    S = 0.5
    shapes = list(m['shapes'].items())
    tw = 360
    sc = tw / base.width
    th = int(base.height * sc)
    cols = 3
    rows = (len(shapes) + cols - 1) // cols
    sheet = Image.new('RGB', (tw * cols, (th + 26) * rows), (20, 16, 12))
    for k, (shape, groups) in enumerate(shapes):
        im = base.copy()
        d = ImageDraw.Draw(im)
        sizes = [len(g) for g in groups]
        team_i = 0
        for g in groups:
            col = COLS[team_i % len(COLS)] if len(g) > 1 else SOLO
            if len(g) > 1:
                team_i += 1
            pts = [(m['centres'][s][0] * S, m['centres'][s][1] * S) for s in g]
            for a in range(len(pts)):
                for b in range(a + 1, len(pts)):
                    d.line([pts[a], pts[b]], fill=col, width=4)
            for (x, y) in pts:
                d.ellipse([x - 30, y - 30, x + 30, y + 30], outline=col, width=6)
        small = im.resize((tw, th))
        x0 = (k % cols) * tw
        y0 = (k // cols) * (th + 26)
        sheet.paste(small, (x0, y0 + 26))
        ImageDraw.Draw(sheet).text((x0 + 6, y0 + 4), shape + '  (' + ' v '.join('+'.join(str(s) for s in g) for g in groups) + ')', fill=(240, 228, 205), font=font)
    sheet.save(os.path.join(D, mid + '.png'))
    print('saved', mid)
