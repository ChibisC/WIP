"""Summarize a V8 .cpuprofile: self and inclusive time per function (performance v3).

  python3 tools/perf/cpuprof.py <file.cpuprofile> [top=40] [filter-substring]
"""
import collections, json, sys

f = sys.argv[1]
top = int(sys.argv[2]) if len(sys.argv) > 2 else 40
filt = sys.argv[3] if len(sys.argv) > 3 else None
P = json.load(open(f))
nodes = {n['id']: n for n in P['nodes']}
parent = {}
for n in P['nodes']:
    for c in n.get('children', []):
        parent[c] = n['id']
def key(n):
    cf = n['callFrame']
    return f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber'] + 1}"
selfT = collections.Counter()
incl = collections.Counter()
for s, d in zip(P['samples'], P['timeDeltas']):
    n = nodes[s]
    selfT[key(n)] += d
    seen = set()
    cur = s
    while cur is not None:
        k = key(nodes[cur])
        if k not in seen:
            incl[k] += d
            seen.add(k)
        cur = parent.get(cur)
tot = sum(selfT.values())
print(f"total {tot/1000:.0f} ms")
print("--- inclusive")
for k, v in incl.most_common(top * 3):
    if filt and filt not in k: continue
    if any(x in k for x in ['(root)', '(program)']): continue
    print(f"{v/1000:8.0f} ms {100*v/tot:5.1f}%  self {selfT[k]/1000:6.0f}  {k}")
    top -= 1
    if top <= 0: break
