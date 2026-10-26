import math
C = 800.0
def P(x, y): return [round(x, 1), round(y, 1)]
def rot(p): return P(2 * C - p[0], 2 * C - p[1])          # 180° about the centre
def polar(deg, r, cx=C, cy=C): a = math.radians(deg); return P(cx + math.cos(a) * r, cy + math.sin(a) * r)   # y down: 90° = south

# pond: a smooth outline, point-symmetric (even harmonics only): r(t + 180°) = r(t)
def pond_r(deg):
    t = math.radians(deg)
    return 218 + 20 * math.sin(2 * t + 0.6) + 9 * math.sin(4 * t + 1.9) + 5 * math.sin(6 * t + 0.3) + 3 * math.sin(10 * t + 2.2)
pond = [polar(k * 360 / 48, pond_r(k * 360 / 48)) for k in range(48)]
# streams NW (A) and its 180° image (B): start well inside the pond, meander, end short of the map edge
A = [P(700, 700), P(650, 650), P(602, 618), P(528, 566), P(458, 486), P(392, 412), P(344, 338)]
B = [rot(p) for p in A]
def crossing(a, b, t, half):
    mx, my = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
    dx, dy = b[0] - a[0], b[1] - a[1]; l = math.hypot(dx, dy); nx, ny = -dy / l, dx / l
    return [P(mx + nx * half, my + ny * half), P(mx - nx * half, my - ny * half)]
cA = crossing(A[3], A[4], 0.4, 46)
cB = [rot(p) for p in cA]
outer = [polar(d, 600) for d in (0, 180, 60, 240, 120, 300)]
inner = [polar(d, 380) for d in (270, 90, 315, 135)]
sites = outer + inner
def ent(s):
    dx, dy = C - s[0], C - s[1]; l = math.hypot(dx, dy); return P(s[0] + dx / l * 22, s[1] + dy / l * 22)
# rocks and stones: irregular outlines (a lumpy ring), mirrored through the centre
def blob(cx, cy, r, seed, n=11, elong=1.0, rotd=0.0):
    pts = []
    for k in range(n):
        a = k * 2 * math.pi / n
        rr = r * (1 + 0.16 * math.sin(3 * a + seed) + 0.09 * math.sin(5 * a + seed * 1.7) + 0.05 * math.sin(7 * a + seed * 0.3))
        x, y = math.cos(a) * rr * elong, math.sin(a) * rr / elong
        ca, sa = math.cos(math.radians(rotd)), math.sin(math.radians(rotd))
        pts.append(P(cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts
def rotpoly(ps): return [rot(p) for p in ps]
rock_specs = [(30, 650, 34, 1.1, 1.35, 20), (150, 650, 30, 2.3, 1.2, -35), (270, 640, 32, 0.4, 1.5, 5)]
stone_specs = [(0, 470, 18, 3.1, 1.25, 70), (200, 760, 22, 1.7, 1.3, -10)]
rocks = []
for d_, r_, rr, sd, el, ro in rock_specs:
    c = polar(d_, r_); b = blob(c[0], c[1], rr, sd, 11, el, ro); rocks += [(b, rr), (rotpoly(b), rr)]
stones = []
for d_, r_, rr, sd, el, ro in stone_specs:
    c = polar(d_, r_); b = blob(c[0], c[1], rr, sd, 9, el, ro); stones += [(b, rr), (rotpoly(b), rr)]
out = dict(pond=pond, A=A, B=B, cA=cA, cB=cB, sites=sites, ents=[ent(s) for s in sites], rocks=rocks, stones=stones,
           foodE=polar(0, 330), foodW=polar(180, 330), aphE=polar(18, 300), aphW=polar(198, 300),
           foodN=[800, 240], foodS=[800, 1360], foodNE=polar(330, 560), foodSW=polar(150, 560), foodNW=polar(210, 560), foodSE=polar(30, 560),
           lair1=polar(105, 700), lair2=polar(285, 700))
import json; print(json.dumps(out))
