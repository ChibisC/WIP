"""Contact sheet of the caste close-ups from caste_tiles.py: every caste's brood tile, labelled with its species, caste,
colour and texture, grouped by species.

Run: python3 tests/browser/caste_sheet.py   → docs/realism/caste-tiles/sheet.jpg
"""
import os
from PIL import Image, ImageDraw, ImageFont

DIR = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "realism", "caste-tiles")
SPECIES = {
    "lasius": "Black Garden Ant", "formica": "Red Wood Ant", "atta": "Leafcutter Ant", "solenopsis": "Tropical Fire Ant",
    "eciton": "Army Ant", "plagiaria": "Gene Thief Ant", "nasutitermes": "Nasute Termites", "rhynchotermes": "Sickle-Jaw Termites",
    "hell": "Hell Ant", "aurimyrmex": "Saiy-Ants", "termant": "Termants",
}
rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(DIR, "castes.txt")) if l.strip()]
W, H = 300, 250  # each tile crop (from 600×500)
COLS = 6
LAB = 44
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)
small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
n = len(rows)
sheet = Image.new("RGB", (COLS * W, ((n + COLS - 1) // COLS) * (H + LAB)), (18, 13, 9))
d = ImageDraw.Draw(sheet)
for i, (caste, sp, name, colour, pattern) in enumerate(rows):
    x, y = (i % COLS) * W, (i // COLS) * (H + LAB)
    p = os.path.join(DIR, f"close_{caste}.jpg")
    if os.path.exists(p):
        sheet.paste(Image.open(p).resize((W, H)), (x, y + LAB))
    d.text((x + 8, y + 5), f"{SPECIES.get(sp, sp)} — {name}", font=font, fill=(240, 226, 196))
    d.text((x + 8, y + 24), f"{colour} · {pattern}", font=small, fill=(196, 176, 140))
sheet.save(os.path.join(DIR, "sheet.jpg"), quality=86)
print("sheet.jpg", sheet.size)
