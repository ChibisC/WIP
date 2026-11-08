"""What a function's time goes to: its callees' inclusive time, from a V8 .cpuprofile (performance v3).

  python3 tools/perf/cpuchildren.py <file.cpuprofile> <function-name-substring> [depth=1]
"""
import collections, json, sys

P = json.load(open(sys.argv[1]))
want = sys.argv[2]
depth = int(sys.argv[3]) if len(sys.argv) > 3 else 1
nodes = {n['id']: n for n in P['nodes']}
selfT = collections.Counter()
for s, d in zip(P['samples'], P['timeDeltas']):
    selfT[s] += d
total = {}
def tot(i):
    if i in total: return total[i]
    t = selfT[i] + sum(tot(c) for c in nodes[i].get('children', []))
    total[i] = t
    return t
import sys as _s
_s.setrecursionlimit(100000)
def key(n):
    cf = n['callFrame']
    return f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1]}:{cf['lineNumber'] + 1}"
agg = collections.Counter()
own = 0
roots = [n for n in P['nodes'] if want in key(n)]
# skip nested matches (recursion): only the outermost
parent = {}
for n in P['nodes']:
    for c in n.get('children', []): parent[c] = n['id']
def nested(i):
    p = parent.get(i)
    while p is not None:
        if want in key(nodes[p]): return True
        p = parent.get(p)
    return False
whole = 0
def walk(i, d, prefix):
    for c in nodes[i].get('children', []):
        k = prefix + key(nodes[c])
        agg[k] += tot(c)
        if d > 1: walk(c, d - 1, k + '  >  ')
for n in roots:
    if nested(n['id']): continue
    whole += tot(n['id'])
    own += selfT[n['id']]
    walk(n['id'], depth, '')
print(f"{want}: {whole/1000:.0f} ms total, {own/1000:.0f} ms self")
for k, v in agg.most_common(30):
    print(f"{v/1000:8.0f} ms {100*v/max(1,whole):5.1f}%  {k}")
