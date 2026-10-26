"""Emit a src/maps/<id>.ts MapDef from a python dict (shared by the map generators)."""
import math


def P(x, y):
    return [round(x, 1), round(y, 1)]


def num(v):
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)


def pt(p):
    return f"[{num(p[0])}, {num(p[1])}]"


def pts(a, per=6, ind="        "):
    rows = [", ".join(pt(p) for p in a[i:i + per]) for i in range(0, len(a), per)]
    return "[\n" + ind + (",\n" + ind).join(rows) + ",\n" + ind[:-2] + "]"


def shape(s):
    if 'poly' in s:
        return "{ poly: " + pts(s['poly']) + " }"
    if 'path' in s:
        return "{ path: " + pts(s['path']) + f", width: {num(s['width'])} }}"
    if 'circle' in s:
        return f"{{ circle: {pt(s['circle'])}, r: {num(s['r'])} }}"
    if 'ellipse' in s:
        rot = f", rot: {num(round(s['rot'], 3))}" if s.get('rot') else ""
        return f"{{ ellipse: {pt(s['ellipse'])}, rx: {num(s['rx'])}, ry: {num(s['ry'])}{rot} }}"
    raise ValueError(s)


def emit(d):
    o = []
    o.append("import type { MapDef } from './types';\n")
    o.append("/**\n" + "\n".join(" * " + l if l else " *" for l in d['doc'].split("\n")) + "\n */")
    o.append(f"export const {d['const']}: MapDef = {{")
    for k in ('id', 'name', 'blurb', 'biome', 'style'):
        o.append(f"  {k}: {d[k]!r},".replace("\\'", "’"))
    o.append(f"  width: {d['width']},\n  depth: {d['depth']},\n  hexR: 8,")
    o.append(f"  relief: {{ amp: {num(d['relief'][0])}, scale: {num(d['relief'][1])} }},")
    o.append("  brushes: [")
    for b in d['brushes']:
        if b.get('note'):
            o.append(f"    // {b['note']}")
        o.append(f"    {{ shape: {shape(b['shape'])}, amount: {num(b['amount'])}, falloff: {num(b['falloff'])} }},")
    o.append("  ],\n  water: [")
    for w in d['water']:
        bed = f", bed: {num(w['bed'])}" if 'bed' in w else ""
        o.append(f"    {{ kind: '{w['kind']}', shape: {shape(w['shape'])}, level: {num(w['level'])}, depth: {num(w['depth'])}{bed} }},")
    o.append("  ],\n  walkways: [")
    for w in d['walkways']:
        o.append(f"    {{ kind: '{w['kind']}', shape: {shape(w['shape'])} }},")
    o.append("  ],\n  walls: [")
    for w in d['walls']:
        o.append(f"    {{ kind: '{w['kind']}', shape: {shape(w['shape'])}, height: {num(round(w['height']))} }},")
    o.append("  ],\n  sites: [")
    for i, s in enumerate(d['sites']):
        fp = f", footprint: {s['footprint']}" if s.get('footprint') else ""
        o.append(f"    {{ at: {pt(s['at'])}{fp}, entrances: [{', '.join(pt(e) for e in s['entrances'])}] }}, // {i}")
    o.append("  ],\n  siteSets: {")
    for n in (2, 3, 4, 10):
        o.append(f"    {n}: [{', '.join('[' + ', '.join(str(i) for i in s) + ']' for s in d['siteSets'][n])}],")
    o.append("  },\n  zones: [")
    for z in d['zones']:
        if z.get('note'):
            o.append(f"    // {z['note']}")
        extra = (f", weight: {num(z['weight'])}" if 'weight' in z else "") + (f", name: {z['name']!r}" if 'name' in z else "")
        o.append(f"    {{ kind: '{z['kind']}', shape: {shape(z['shape'])}{extra} }},")
    o.append("  ],\n  floods: [")
    for f in d['floods']:
        if f.get('note'):
            o.append(f"    // {f['note']}")
        o.append(f"    {{ shape: {shape(f['shape'])}, level: {num(f['level'])}, first: {pt(f['first'])}, every: {pt(f['every'])}, hold: {pt(f['hold'])} }},")
    o.append("  ],\n};\n")
    return "\n".join(o)
