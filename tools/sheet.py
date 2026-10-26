#!/usr/bin/env python3
"""Render each ant morph individually (3/4 view) and compose a labelled model sheet."""
import subprocess, sys, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFont
items = [l.split('|') for l in sys.argv[2].split(';')]
out = sys.argv[1]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
W, H = 520, 360
def render(i_item):
    i, (key, label) = i_item
    p = f'/tmp/claude-0/sheet_{i}.png'
    subprocess.run(['python3', 'tools/shot.py', f'scene=antlab&ant={key}&cam=34&dof=0.25', p, str(W), str(H), '120', '100'], capture_output=True)
    return i, p, label
with cf.ThreadPoolExecutor(4) as ex:
    res = list(ex.map(render, list(enumerate(items))))
rows = (len(res) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows), (20, 16, 12))
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
except Exception:
    font = ImageFont.load_default()
for i, p, label in sorted(res):
    im = Image.open(p)
    d = ImageDraw.Draw(im)
    d.rectangle([0, H - 34, W, H], fill=(20, 16, 12))
    d.text((12, H - 30), label, fill=(240, 228, 205), font=font)
    sheet.paste(im, ((i % cols) * W, (i // cols) * H))
sheet.save(out)
print('saved', out)
