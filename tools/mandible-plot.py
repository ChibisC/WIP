#!/usr/bin/env python3
"""Plot mandible pairs from tools/mandible-dump.ts: top and side views, shaded, for checking outlines.

  python3 tools/mandible-plot.py mandibles.json out.png
"""
import json, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection

data = json.load(open(sys.argv[1]))
names = list(data.keys())
fig, axes = plt.subplots(2, len(names), figsize=(4.2 * len(names), 8))
L = np.array([0.3, 0.8, 0.5]); L /= np.linalg.norm(L)
for c, name in enumerate(names):
    for r, (a, b, up) in enumerate([(0, 2, 1), (0, 1, 2)]):  # top: x-z ; side: x-y
        ax = axes[r][c]
        polys, cols, depth = [], [], []
        for it in data[name]:
            p = np.array(it["pos"]).reshape(-1, 3)
            t = np.array(it["idx"]).reshape(-1, 3)
            v0, v1, v2 = p[t[:, 0]], p[t[:, 1]], p[t[:, 2]]
            n = np.cross(v1 - v0, v2 - v0)
            nl = np.linalg.norm(n, axis=1) + 1e-12
            n = n / nl[:, None]
            shade = np.clip(n @ L, 0, 1) * 0.75 + 0.2
            facing = n[:, up] * (1 if r == 0 else -1) if False else n[:, up]
            for k in range(len(t)):
                tri = p[t[k]]
                polys.append(tri[:, [a, b]])
                cols.append((shade[k] * 0.55, shade[k] * 0.3, shade[k] * 0.2))
                depth.append(tri[:, up].mean())
        order = np.argsort(depth)
        pc = PolyCollection([polys[i] for i in order], facecolors=[cols[i] for i in order], edgecolors="none")
        ax.add_collection(pc)
        for it in data[name]:
            for tp in it["tips"]:
                ax.plot(tp[a], tp[b], "c.", ms=3)
        ax.autoscale()
        ax.set_aspect("equal")
        ax.set_title(f"{name} {'top' if r == 0 else 'side'}")
        if r == 0:
            ax.invert_yaxis()
plt.tight_layout()
plt.savefig(sys.argv[2], dpi=90)
print("wrote", sys.argv[2])
