"""Measure rendered sounds and draw spectrogram sheets (a way to "listen" without ears).

    python3 tools/audio/analyze.py <dir-of-wavs> <out-dir>

Per file: length, peak and RMS (dBFS), spectral centroid, spectral flatness
(0 = a pure tone, 1 = white noise) and a steadiness score (how much of the
energy sits in one unchanging frequency: high = beep-like). Writes
metrics.csv, a list of suspects (tonal and steady sounds outside the
naturally tonal set: birds, crickets, frogs, owls, music), and one
spectrogram sheet per folder.
"""
import os
import sys
import csv
import numpy as np
from scipy.io import wavfile
from scipy import signal
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
NATURALLY_TONAL = ("bird", "cricket", "katydid", "frog", "owl", "cicada", "fly_pass", "victory", "defeat", "cue", "marker", "phase")
rows = []
by_folder = {}
for root, _, files in os.walk(src):
    for f in sorted(files):
        if not f.endswith(".wav"):
            continue
        p = os.path.join(root, f)
        sr, x = wavfile.read(p)
        x = x.astype(np.float32) / 32768.0
        peak = float(np.max(np.abs(x)) + 1e-12)
        rms = float(np.sqrt(np.mean(x ** 2)) + 1e-12)
        fr, tt, S = signal.stft(x, sr, nperseg=1024, noverlap=768)
        P = np.abs(S) ** 2
        band = (fr > 150) & (fr < 16000)
        Pb = P[band] + 1e-18
        frame_e = Pb.sum(axis=0)
        loud = frame_e > frame_e.max() * 0.05
        flat = float(np.mean(np.exp(np.mean(np.log(Pb[:, loud]), axis=0)) / np.mean(Pb[:, loud], axis=0))) if loud.any() else 1.0
        cen = float(np.sum(fr[band][:, None] * Pb, axis=0).sum() / Pb.sum())
        # steadiness: the longest time (s) a narrow spectral peak (20 dB above its
        # neighbourhood) stays at the same frequency: a beep or whine holds one; noise,
        # crackle and short resonances do not
        hop = (1024 - 768) / sr
        Pd = 10 * np.log10(Pb)
        k = 15
        best = 0
        prev = None
        run = 0
        for j in range(Pd.shape[1]):
            if not loud[j]:
                prev, run = None, 0
                continue
            col = Pd[:, j]
            pk = int(np.argmax(col))
            lo, hi = max(0, pk - k), min(len(col), pk + k)
            neigh = np.median(np.concatenate([col[lo:max(lo, pk - 2)], col[min(hi, pk + 3):hi]])) if hi - lo > 6 else col.mean()
            if col[pk] - neigh > 20 and (prev is None or abs(pk - prev) <= 1):
                run = run + 1 if prev is not None else 1
                prev = pk
            elif col[pk] - neigh > 20:
                run, prev = 1, pk
            else:
                run, prev = 0, None
            best = max(best, run)
        steady = best * hop
        rel = os.path.relpath(p, src)
        rows.append([rel, len(x) / sr, 20 * np.log10(peak), 20 * np.log10(rms), cen, flat, steady])
        by_folder.setdefault(rel.split(os.sep)[0], []).append((rel, x, sr))
with open(os.path.join(out, "metrics.csv"), "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["file", "seconds", "peak_db", "rms_db", "centroid_hz", "flatness", "steady"])
    for r in rows:
        w.writerow([r[0]] + [f"{v:.4f}" for v in r[1:]])
sus = [r for r in rows if r[6] > 0.08 and not any(k in r[0] for k in NATURALLY_TONAL)]
print(f"{len(rows)} files")
print("suspects (a narrow tone held > 80 ms, outside the naturally tonal set):")
for r in sorted(sus, key=lambda r: -r[6]):
    print(f"  {r[0]:40s} tone held {r[6]*1000:.0f} ms, flatness {r[5]:.3f}, centroid {r[4]:.0f} Hz")
clip = [r for r in rows if r[2] > -0.1]
print("clipping:", [r[0] for r in clip] or "none")
# spectrogram sheets: first take of each sound, per folder
for folder, items in by_folder.items():
    firsts = {}
    for rel, x, sr in items:
        key = rel.rsplit("_", 1)[0]
        firsts.setdefault(key, (rel, x, sr))
    n = len(firsts)
    cols = 4
    rws = (n + cols - 1) // cols
    fig, axes = plt.subplots(rws, cols, figsize=(cols * 3.6, rws * 2.4), squeeze=False)
    for ax in axes.flat:
        ax.axis("off")
    for ax, (key, (rel, x, sr)) in zip(axes.flat, sorted(firsts.items())):
        ax.axis("on")
        seg = x[: int(sr * 2.5)]
        ax.specgram(seg + 1e-9, NFFT=512, Fs=sr, noverlap=384, cmap="magma", vmin=-120)
        ax.set_ylim(0, 14000)
        ax.set_title(os.path.basename(key), fontsize=9)
        ax.tick_params(labelsize=6)
    fig.tight_layout()
    fig.savefig(os.path.join(out, f"sheet_{folder}.png"), dpi=80)
    plt.close(fig)
print("sheets:", sorted(os.listdir(out)))
