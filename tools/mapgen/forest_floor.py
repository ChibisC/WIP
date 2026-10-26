# Draft, not yet registered in src/maps/index.ts: the two hollows (lairs, flood zones) sit on the
# stream's ends; move them clear of the water before the art pass.
"""Forest Floor (docs/maps/design.md §9): 1,600 x 1,600 mm, point-symmetric about the centre.
A small trickling stream in an S across the middle third, three root-mat crossings; fallen logs and
rocks forming lanes and chokepoints; mushroom clusters; two leaf-litter hollows (spider and beetle
lairs) that flood after rain. Ten sites: six on an outer ring, four inner."""
import json, math, sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from tsemit import emit, P

C = 800.0
def rot(p): return P(2 * C - p[0], 2 * C - p[1])
def polar(deg, r, cx=C, cy=C):
    a = math.radians(deg); return P(cx + math.cos(a) * r, cy + math.sin(a) * r)

# stream: an S through the centre, NE end to SW end, ending ~200 mm short of the edges
half = [P(800, 800), P(880, 752), P(962, 718), P(1048, 668), P(1124, 598), P(1196, 534), P(1286, 488), P(1384, 452)]
stream = [rot(p) for p in reversed(half[1:])] + half
def crossing(a, b, t, half_len):
    mx, my = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
    dx, dy = b[0] - a[0], b[1] - a[1]; l = math.hypot(dx, dy); nx, ny = -dy / l, dx / l
    return [P(mx + nx * half_len, my + ny * half_len), P(mx - nx * half_len, my - ny * half_len)]
cMid = crossing(half[0], half[1], 0.1, 38)
cA = crossing(half[4], half[5], 0.5, 38)
cB = [rot(p) for p in cA]

def blob(cx, cy, r, seed, n=11, elong=1.0, rotd=0.0):
    pts = []
    for k in range(n):
        a = k * 2 * math.pi / n
        rr = r * (1 + 0.16 * math.sin(3 * a + seed) + 0.09 * math.sin(5 * a + seed * 1.7) + 0.05 * math.sin(7 * a + seed * 0.3))
        x, y = math.cos(a) * rr * elong, math.sin(a) * rr / elong
        ca, sa = math.cos(math.radians(rotd)), math.sin(math.radians(rotd))
        pts.append(P(cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts

walls = []
def pair(w):
    walls.append(w)
    s = dict(w)
    if 'path' in w['shape']: s['shape'] = {'path': [rot(p) for p in w['shape']['path']], 'width': w['shape']['width']}
    elif 'poly' in w['shape']: s['shape'] = {'poly': [rot(p) for p in w['shape']['poly']]}
    elif 'circle' in w['shape']: s['shape'] = {'circle': rot(w['shape']['circle']), 'r': w['shape']['r']}
    walls.append(s)

# fallen logs: a long one across the north-west quarter (a chokepoint with the stream), shorter ones as lane edges
pair({'kind': 'log', 'shape': {'path': [P(270, 590), P(530, 476)], 'width': 54}, 'height': 54})
pair({'kind': 'log', 'shape': {'path': [P(920, 250), P(1130, 300)], 'width': 40}, 'height': 40})
pair({'kind': 'log', 'shape': {'path': [P(1250, 760), P(1330, 960)], 'width': 36}, 'height': 36})
# rocks
for (d, r, rr, sd, el, ro) in [(200, 470, 30, 1.1, 1.3, 20), (300, 520, 26, 2.2, 1.2, -30), (20, 300, 22, 0.7, 1.4, 60)]:
    c = polar(d, r); pair({'kind': 'rock', 'shape': {'poly': blob(c[0], c[1], rr, sd, 11, el, ro)}, 'height': round(rr * 0.9)})
# mushroom clusters
for (d, r, rr) in [(250, 620, 16), (110, 250, 14)]:
    c = polar(d, r); pair({'kind': 'mushrooms', 'shape': {'circle': c, 'r': rr}, 'height': 46})

outer = [polar(d, 610) for d in (-100, 80, 10, 190, -150, 30)]
inner = [polar(d, 360) for d in (60, 240, 125, 305)]
sites_at = outer + inner
def ent(s):
    dx, dy = C - s[0], C - s[1]; l = math.hypot(dx, dy); return P(s[0] + dx / l * 22, s[1] + dy / l * 22)

hollowA = polar(150, 560)
hollowB = rot(hollowA)
d = dict(
    const='FOREST_FLOOR', id='forestFloor', name='Forest Floor',
    blurb='Dim woodland floor. Fallen logs and rocks make lanes and chokepoints; a trickle crossed by root mats; spiders and beetles in leaf-litter hollows that flood after rain.',
    biome='forest', style='forest', width=1600, depth=1600, relief=(7, 200),
    doc='Forest Floor (docs/maps/design.md §9): a dim woodland floor. A trickling stream runs in an S\nacross the middle third with three root-mat crossings; fallen logs and rocks make lanes and\nchokepoints; mushroom clusters; leaf-litter hollows hold spider and beetle lairs and flood after\nrain. Ten sites in point-symmetric pairs.\n\nCoordinates were computed once (point-symmetric about the centre) and are stored as plain numbers,\nso every client builds byte-identical terrain.',
    brushes=[{'shape': {'circle': hollowA, 'r': 90}, 'amount': -6, 'falloff': 70, 'note': 'two leaf-litter hollows'}, {'shape': {'circle': hollowB, 'r': 90}, 'amount': -6, 'falloff': 70}],
    water=[{'kind': 'stream', 'shape': {'path': stream, 'width': 30}, 'level': -2, 'depth': 4, 'bed': 10}],
    walkways=[{'kind': 'rootMat', 'shape': {'path': c, 'width': 32}} for c in (cMid, cA, cB)],
    walls=walls,
    sites=[{'at': s, 'entrances': [ent(s)]} for s in sites_at],
    siteSets={2: [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]], 3: [[1, 2, 5], [0, 3, 4]], 4: [[2, 3, 4, 5]], 10: [list(range(10))]},
    zones=[
        {'kind': 'food', 'shape': {'circle': polar(-45, 250), 'r': 60}, 'weight': 2, 'name': 'fallen fruit'},
        {'kind': 'food', 'shape': {'circle': polar(135, 250), 'r': 60}, 'weight': 2, 'name': 'fallen fruit'},
        {'kind': 'food', 'shape': {'circle': polar(-125, 460), 'r': 55}},
        {'kind': 'food', 'shape': {'circle': polar(55, 460), 'r': 55}},
        {'kind': 'food', 'shape': {'circle': polar(-20, 700), 'r': 50}},
        {'kind': 'food', 'shape': {'circle': polar(160, 700), 'r': 50}},
        {'kind': 'aphid', 'shape': {'circle': polar(100, 500), 'r': 40}, 'name': 'seedlings'},
        {'kind': 'aphid', 'shape': {'circle': polar(280, 500), 'r': 40}, 'name': 'seedlings'},
        {'kind': 'plant', 'shape': {'circle': polar(-75, 470), 'r': 45}},
        {'kind': 'plant', 'shape': {'circle': polar(105, 470), 'r': 45}},
        {'kind': 'lair', 'shape': {'circle': hollowA, 'r': 35}, 'name': 'spider hollow'},
        {'kind': 'lair', 'shape': {'circle': hollowB, 'r': 35}, 'name': 'beetle hollow'},
        {'kind': 'litter', 'shape': {'circle': hollowA, 'r': 110}},
        {'kind': 'litter', 'shape': {'circle': hollowB, 'r': 110}},
        {'kind': 'litter', 'shape': {'circle': polar(-60, 640), 'r': 90}},
        {'kind': 'litter', 'shape': {'circle': polar(120, 640), 'r': 90}},
        {'kind': 'creature', 'shape': {'poly': [P(0, 0), P(1600, 0), P(1600, 90), P(0, 90)]}, 'note': 'wild creatures come out of the undergrowth along the edges'},
        {'kind': 'creature', 'shape': {'poly': [P(0, 1510), P(1600, 1510), P(1600, 1600), P(0, 1600)]}},
        {'kind': 'creature', 'shape': {'poly': [P(0, 0), P(90, 0), P(90, 1600), P(0, 1600)]}},
        {'kind': 'creature', 'shape': {'poly': [P(1510, 0), P(1600, 0), P(1600, 1600), P(1510, 1600)]}},
    ],
    floods=[
        {'shape': {'circle': hollowA, 'r': 100}, 'level': -3.5, 'first': [420, 660], 'every': [540, 900], 'hold': [40, 80], 'note': 'rain fills the two hollows'},
        {'shape': {'circle': hollowB, 'r': 100}, 'level': -3.5, 'first': [420, 660], 'every': [540, 900], 'hold': [40, 80]},
    ],
)
if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else None
    src = emit(d)
    if out:
        open(out, 'w').write(src)
    else:
        print(src)
