#!/usr/bin/env python3
"""Render creatures one by one in the creature lab and compose a labelled sheet.

  SHOT_BASE=http://127.0.0.1:5173/ python3 tools/crsheet.py out.png "kind|label|extra-query;..." [cols] [w] [h]
"""
import os, subprocess, sys, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
items = [l.split('|') for l in sys.argv[2].split(';') if l]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
W = int(sys.argv[4]) if len(sys.argv) > 4 else 480
H = int(sys.argv[5]) if len(sys.argv) > 5 else 340
tmp = os.environ.get('TMPDIR', '/tmp')
def render(i_item):
    i, it = i_item
    kind, label = it[0], it[1] if len(it) > 1 else it[0]
    extra = it[2] if len(it) > 2 else ''
    p = f'{tmp}/crsheet_{os.getpid()}_{i}.png'
    subprocess.run(['python3', 'tools/shot.py', f'scene=crlab&kinds={kind}&cam=34&dof=0.2&{extra}', p, str(W), str(H), '200', '100'], capture_output=True)
    return i, p, label
with cf.ThreadPoolExecutor(2) as ex:
    res = list(ex.map(render, list(enumerate(items))))
rows = (len(res) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows), (20, 16, 12))
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
except Exception:
    font = ImageFont.load_default()
for i, p, label in sorted(res):
    try:
        im = Image.open(p)
    except Exception:
        continue
    d = ImageDraw.Draw(im)
    d.rectangle([0, H - 30, W, H], fill=(20, 16, 12))
    d.text((10, H - 27), label, fill=(240, 228, 205), font=font)
    sheet.paste(im, ((i % cols) * W, (i // cols) * H))
sheet.save(out)
print('saved', out)
