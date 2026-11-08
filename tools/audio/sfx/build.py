"""Render the game's sound effects offline and pack them for the game (audio v3).

    python3 tools/audio/sfx/build.py                 render every sound, pack, write the manifest
    python3 tools/audio/sfx/build.py render [filter] render (and finish) only, into audio-src/rendered/
    python3 tools/audio/sfx/build.py pack            pack audio-src/rendered (+ recordings) into public/audio

Render: each recipe (registry.py) is called once per take with its own seed, then finished: DC and rumble removed,
silence trimmed (one-shots start within a millisecond of their first sound, so they land on the strike frame), short
fades at both ends, loudness-normalised (the loudest 400 ms, K-weighted, to the sound's target in levels.json, which
keeps each sound where the tuned mix had it; never above a -1 dBFS peak), loops made seamless. Recordings in audio-src/recordings/<folder>/<name>_NN.* replace a sound's rendered takes.

Pack: one file per sound (its takes one after another with silence between: an audio sprite, so the whole game is a
few hundred files, not thousands), Ogg Vorbis plus AAC (.mp4) for browsers without Ogg; long ambience loops are single
streamed files. public/audio/manifest.json lists each sound's file, takes (start, length in samples at 44.1 kHz) and
its first sound's position (`lead`), which the game uses to correct any encoder delay before slicing the takes.
"""
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from multiprocessing import Pool

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "../../.."))
OUT_WAV = os.path.join(ROOT, "audio-src/rendered")
REC = os.path.join(ROOT, "audio-src/recordings")
PUB = os.path.join(ROOT, "public/audio")

from dsp import SR, Rng, fade, hp, seamless  # noqa: E402
import recipes_combat  # noqa: E402,F401
import recipes_creatures  # noqa: E402,F401
import recipes_world  # noqa: E402,F401
from registry import REG  # noqa: E402

GAP = 0.12  # silence between takes in a sprite (s)
LEAD = 0.05  # silence before the first take
# long loops are streamed (catalog `stream`): ambience beds; the others are decoded into buffers
STREAM = {"amb.wind_grass", "amb.leaves_rustle", "amb.cicada", "amb.water_stream", "amb.sand_hiss", "amb.rain", "amb.nest_room", "amb.colony_rumble"}

_meter = pyln.Meter(SR)
# per-sound loudness targets (the loudest 400 ms, LUFS): the level each sound had in the tuned mix, so the catalog's
# gains keep their meaning; a sound without one uses its recipe's `lufs`
LEVELS = json.load(open(os.path.join(HERE, "levels.json")))


def kweight(x):
    y = np.asarray(x, dtype=float)
    for f in _meter._filters.values():
        y = f.apply_filter(y)
    return y


def loud_max(x):
    """The loudest 400 ms window, K-weighted (LUFS): a short sound is measured as heard, with silence around it."""
    if x.ndim == 2:
        return 10 * np.log10(sum(10 ** (loud_max(c) / 10) for c in x))
    w = int(0.4 * SR)
    y = kweight(np.concatenate([np.zeros(w), x, np.zeros(w)]))
    ms = np.convolve(y * y, np.ones(w) / w, "valid")
    return -0.691 + 10 * np.log10(max(1e-12, ms.max()))


def seed_of(sid, k):
    return int(hashlib.md5(f"{sid}#{k}".encode()).hexdigest()[:8], 16)


def finish(x, spec):
    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        x = x[None, :]
    x = np.stack([hp(c, 30 if not spec["sid"].startswith(("boss.", "amb.thunder", "amb.nest", "amb.colony")) else 18, 2) for c in x])
    if spec["loop"]:
        x = np.stack([seamless(c, spec["xf"]) for c in x])
    else:
        env = np.abs(x).max(axis=0)
        pk = env.max()
        on = np.nonzero(env > pk * 10 ** (-60 / 20))[0]
        a = max(0, on[0] - int(0.0005 * SR))
        b = min(x.shape[1], on[-1] + int(0.004 * SR))
        x = np.stack([fade(c[a:b], 0.0004, min(0.008, (b - a) / SR * 0.3)) for c in x])
    lufs = loud_max(x if x.shape[0] > 1 else x[0])
    g = 10 ** ((LEVELS.get(spec["sid"], spec["lufs"]) - lufs) / 20)
    pk = np.abs(x).max()
    g = min(g, 10 ** (-1 / 20) / max(pk, 1e-9))
    return x * g, lufs + 20 * np.log10(g)


def render_one(sid):
    try:
        return _render_one(sid)
    except Exception as e:  # report and carry on with the other sounds
        import traceback
        return sid, [], 0.0, "ERROR " + "".join(traceback.format_exception_only(e)).strip() + " @ " + traceback.format_tb(e.__traceback__)[-1].strip().splitlines()[0]


def _render_one(sid):
    spec = dict(REG[sid], sid=sid)
    folder, name = sid.split(".", 1)
    out = []
    recs = sorted(glob.glob(os.path.join(REC, folder, f"{name}_[0-9][0-9].*")))
    t0 = time.time()
    if recs:
        takes = []
        for p in recs:
            y, sr = sf.read(p, always_2d=True)
            y = y.T
            if sr != SR:
                from scipy.signal import resample_poly
                y = np.stack([resample_poly(c, SR, sr) for c in y])
            if not spec["stereo"]:
                y = y.mean(axis=0)
            takes.append(y)
    else:
        takes = []
        for k in range(1, spec["takes"] + 1):
            x = spec["fn"](Rng(seed_of(sid, k)), k)
            takes.append(x)
    for k, x in enumerate(takes, 1):
        y, lufs = finish(x, spec)
        p = os.path.join(OUT_WAV, folder, f"{name}_{k:02d}.wav")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        sf.write(p, y.T if y.shape[0] > 1 else y[0], SR, subtype="FLOAT")
        out.append((k, y.shape[1] / SR, lufs, float(np.abs(y).max())))
    return sid, out, time.time() - t0, bool(recs)


def render(flt=""):
    ids = [s for s in REG if flt in s]
    for f in glob.glob(os.path.join(OUT_WAV, "*", "*.wav")):
        sid = os.path.basename(os.path.dirname(f)) + "." + re.sub(r"_\d\d\.wav$", "", os.path.basename(f))
        if sid in ids:
            os.remove(f)
    with Pool(max(1, (os.cpu_count() or 2))) as pool:
        for sid, takes, dt, rec in pool.imap_unordered(render_one, ids):
            if isinstance(rec, str):
                print(f"{sid:28s} {rec}", flush=True)
                continue
            durs = ", ".join(f"{d*1000:.0f}" if d < 2 else f"{d:.1f}s" for _, d, _, _ in takes)
            print(f"{sid:28s} {len(takes)} take(s) [{durs}] {takes[0][2]:6.1f} LUFS  {dt:5.1f} s{'  (recordings)' if rec else ''}", flush=True)


def enc(wav, base, stereo, loop):
    # one-shots: Vorbis q3 (clicks keep their top end); streamed ambience loops: q1 (noise beds code cheaply)
    q = ("1" if stereo else "3") if loop else "3"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libvorbis", "-q:a", q, base + ".ogg"], check=True)
    br = ("96k" if stereo else "64k") if loop else "80k"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", br, "-movflags", "+faststart", base + ".mp4"], check=True)


def pack():
    sounds = {}
    tmp = os.path.join(ROOT, "audio-src/.pack")
    os.makedirs(tmp, exist_ok=True)
    # clear the old files (a removed sound must not stay behind)
    for f in glob.glob(os.path.join(PUB, "*", "*")):
        if re.search(r"\.(ogg|mp4|mp3|opus|webm|wav)$", f):
            os.remove(f)
    size = {"ogg": 0, "mp4": 0}
    for sid in sorted(REG):
        folder, name = sid.split(".", 1)
        files = sorted(glob.glob(os.path.join(OUT_WAV, folder, f"{name}_[0-9][0-9].wav")))
        if not files:
            print(f"  (no takes for {sid}: run render first)")
            continue
        takes = [sf.read(f, always_2d=True)[0].T for f in files]
        ch = takes[0].shape[0]
        base = os.path.join(PUB, folder, name)
        os.makedirs(os.path.dirname(base), exist_ok=True)
        entry = {"file": f"{folder}/{name}", "ext": ["ogg", "mp4"]}
        if REG[sid]["loop"]:
            data = takes[0]
            entry["loop"] = True
            entry["len"] = data.shape[1]
            if sid not in STREAM:
                # decoded loops get the lead silence too, so the encoder delay can be found and cut
                data = np.concatenate([np.zeros((ch, int(LEAD * SR))), data, np.zeros((ch, int(GAP * SR)))], axis=1)
                entry["takes"] = [[int(LEAD * SR), takes[0].shape[1]]]
                entry["lead"] = int(LEAD * SR) + int(np.argmax(np.abs(takes[0]).max(axis=0) > 1e-3))
        else:
            parts, spans = [np.zeros((ch, int(LEAD * SR)))], []
            pos = int(LEAD * SR)
            for t in takes:
                spans.append([pos, t.shape[1]])
                parts += [t, np.zeros((ch, int(GAP * SR)))]
                pos += t.shape[1] + int(GAP * SR)
            data = np.concatenate(parts, axis=1)
            entry["takes"] = spans
            entry["lead"] = int(LEAD * SR) + int(np.argmax(np.abs(takes[0]).max(axis=0) > 1e-3))
        wav = os.path.join(tmp, f"{folder}_{name}.wav")
        sf.write(wav, data.T if ch > 1 else data[0], SR, subtype="PCM_16")
        enc(wav, base, ch > 1, REG[sid]["loop"])
        for e in ("ogg", "mp4"):
            size[e] += os.path.getsize(f"{base}.{e}")
        sounds[sid] = entry
    write_attributions(sounds)
    credits = read_credits()
    with open(os.path.join(PUB, "manifest.json"), "w") as f:
        json.dump({"sr": SR, "sounds": sounds, "credits": credits}, f, separators=(",", ":"))
        f.write("\n")
    n = sum(len(e.get("takes", [[0]])) for e in sounds.values())
    print(f"packed {len(sounds)} sounds ({n} takes): Ogg {size['ogg']/1e6:.2f} MB, AAC {size["mp4"]/1e6:.2f} MB; {2*len(sounds)} files")


def write_attributions(sounds):
    """The made-for-this-game rows of docs/audio/ATTRIBUTIONS.md (between its markers): one per file."""
    p = os.path.join(ROOT, "docs/audio/ATTRIBUTIONS.md")
    text = open(p, encoding="utf8").read()
    a, b = "<!-- made-for-this-game:start -->", "<!-- made-for-this-game:end -->"
    if a not in text or b not in text:
        return
    rows = []
    for sid, e in sorted(sounds.items()):
        folder, name = sid.split(".", 1)
        rec = bool(glob.glob(os.path.join(REC, folder, f"{name}_[0-9][0-9].*")))
        if rec:
            continue
        mod = REG[sid]["fn"].__module__
        rows.append(f"| `{e['file']}.ogg`, `.mp4` | {sid} | Underground Dominion (made for this game) | `tools/audio/sfx/{mod}.py` | CC0 (made for this game) | {len(e.get('takes', [0]))} take(s), rendered offline |")
    body = "\n| File | Title | Author | Source | License | Notes |\n|---|---|---|---|---|---|\n" + "\n".join(rows) + "\n"
    text = text[: text.index(a) + len(a)] + body + text[text.index(b):]
    open(p, "w", encoding="utf8").write(text)


def read_credits():
    """Third-party rows of docs/audio/ATTRIBUTIONS.md, for the Credits screen (the game's own sounds need none)."""
    p = os.path.join(ROOT, "docs/audio/ATTRIBUTIONS.md")
    out = []
    if not os.path.exists(p):
        return out
    fence = False
    for line in open(p, encoding="utf8"):
        if line.strip().startswith("```"):
            fence = not fence
        if fence:
            continue
        c = [x.strip() for x in line.split("|")]
        if len(c) < 7 or not c[1] or c[1].startswith(("File", "---", "*")):
            continue
        if "made for this game" in line.lower():
            continue
        out.append({"file": c[1].replace("`", ""), "title": c[2], "author": c[3], "url": c[4], "license": c[5]})
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("render", "all"):
        render(sys.argv[2] if cmd == "render" and len(sys.argv) > 2 else "")
    if cmd in ("pack", "all"):
        pack()
