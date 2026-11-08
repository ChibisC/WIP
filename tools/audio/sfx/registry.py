"""The sound registry: one recipe per catalog sound (src/audio/catalog.ts), rendered offline by build.py.

    @sound('combat.mandible_click', takes=6)
    def _(r, k): ...   # r: a seeded Rng for take k (1-based); returns mono samples at SR, or (2, n) for stereo

Options: takes (3-6 for one-shots; 1 for loops), loop (made seamless), stereo (ambience beds), lufs (the loudness
target when levels.json has none: the loudest 400 ms window, K-weighted; always capped by a -1 dBFS peak), xf (a loop's
crossfade, seconds).
"""
REG = {}


def sound(sid, takes=5, loop=False, stereo=False, lufs=-20.0, xf=1.0, desc=None):
    def deco(fn):
        REG[sid] = dict(fn=fn, takes=1 if loop else takes, loop=loop, stereo=stereo, lufs=lufs, xf=xf)
        return fn

    return deco
