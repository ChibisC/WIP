"""Render the soundscapes offline through the real audio engine and measure them.

    SHOTS=<dir> tests/browser/with_server.sh python3 tests/browser/audio_mix.py

For each scenario, saves <dir>/mix_<scenario>.wav and a spectrogram sheet, and checks:
no clipping, a sensible loudness, voice counts inside the budgets, and that the
queen alert (battle) and the boss's phase (boss) stand out from the mix.
"""
import base64
import os
import sys
import time
import wave
import numpy as np
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.environ.get("SHOTS", "/tmp")
SCEN = sys.argv[1:] or ["meadow-day", "forest-night", "riverbank-night", "nest", "battle400", "boss"]
res = []
mixes = {}


def check(name, ok, info=""):
    res.append(f"{'PASS' if ok else 'FAIL'}  {name} {info}")


with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    for sc in SCEN:
        pg = b.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"{BASE}?scene=sounds&render={sc}&secs=8", wait_until="load")
        t0 = time.time()
        while time.time() - t0 < 240 and not pg.evaluate("!!window.__render"):
            time.sleep(0.5)
        r = pg.evaluate("window.__render")
        if not r:
            check(f"{sc}: rendered", False, str(errs[:2]))
            continue
        pcm = np.frombuffer(base64.b64decode(r["pcm"]), dtype=np.int16).reshape(-1, 2)
        path = os.path.join(OUT, f"mix_{sc}.wav")
        with wave.open(path, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(r["sr"])
            w.writeframes(pcm.tobytes())
        x = pcm.astype(np.float32).mean(axis=1) / 32768
        sr = r["sr"]
        win = int(sr * 0.25)
        rms = [20 * np.log10(np.sqrt(np.mean(x[i:i + win] ** 2)) + 1e-9) for i in range(0, len(x) - win, win)]
        mixes[sc] = (x, sr)
        st = r["stats"]
        res.append(f"      {sc}: peak {20*np.log10(r['peak']+1e-9):.1f} dBFS, loudness {np.median(rms):.1f} dB RMS (min {min(rms):.1f}, max {max(rms):.1f}); voices max {st['maxVoices']}, played {st['played']}, dropped {st['dropped']}, events {st['events']}")
        check(f"{sc}: no clipping", r["peak"] < 0.999, f"peak {r['peak']:.3f}")
        check(f"{sc}: never silent, never too loud", min(rms[2:]) > -70 and max(rms) < -4, f"{min(rms[2:]):.1f}…{max(rms):.1f} dB")
        check(f"{sc}: no page errors", not errs, str(errs[:2]))
        if sc == "battle400":
            check("battle400: voices stay inside the budgets", st["maxVoices"] <= 16 + 10 + 8 + 8 + 12, str(st["maxVoices"]))
            check("battle400: the overflow goes to the battle bed", st["dropped"] > st["played"] and st["peakOverflow"] > 1, f"{st['dropped']} dropped, overflow up to {st['peakOverflow']:.1f}")
            # the queen alert at 5 s: its band (0.4–3 kHz) rises above the battle before it
            from scipy import signal
            f, t, S = signal.stft(x, sr, nperseg=2048)
            band = (f > 400) & (f < 3000)
            e = (np.abs(S[band]) ** 2).sum(axis=0)
            before = e[(t > 4.0) & (t < 4.9)].mean()
            during = e[(t > 5.05) & (t < 5.7)].mean()
            check("battle400: the queen alert cuts through the battle", during > before * 1.6, f"{10*np.log10(during/before):+.1f} dB in its band")
        if sc == "boss":
            i0, i1 = int(4.3 * sr), int(4.9 * sr)
            j0, j1 = int(5.05 * sr), int(5.9 * sr)
            a = np.sqrt(np.mean(x[i0:i1] ** 2))
            c = np.sqrt(np.mean(x[j0:j1] ** 2))
            check("boss: the phase change stands out", c > a * 1.3, f"{20*np.log10(c/a):+.1f} dB")
        pg.close()
    b.close()

# spectrogram sheet of all mixes
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
if mixes:
    fig, axes = plt.subplots(len(mixes), 1, figsize=(12, 2.3 * len(mixes)), squeeze=False)
    for ax, (sc, (x, sr)) in zip(axes[:, 0], mixes.items()):
        ax.specgram(x + 1e-9, NFFT=1024, Fs=sr, noverlap=768, cmap="magma", vmin=-110)
        ax.set_ylim(0, 14000)
        ax.set_title(sc, fontsize=10)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "mix_sheet.png"), dpi=70)
print("\n".join(res))
