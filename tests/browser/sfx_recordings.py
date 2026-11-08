"""In-game recordings with sound (audio v3, claude/audio/03-spec-sfx-rework-insect.md §6).

    BASE=http://127.0.0.1:5173/ TAG=after python3 tests/browser/sfx_recordings.py <out dir> [scenario …]

Runs a real game scene on the virtual clock (?shot=1) with the audio engine built on an OfflineAudioContext, so the
picture and the sound advance together, frame by frame, however slow the software renderer is: at every frame the
offline render suspends, the game steps one frame (simulation, rendering, GameAudio), the canvas is captured, and the
render resumes. Writes <out>/<scenario>_<TAG>.mp4 (H.264 + AAC) and .wav, and prints the peak and loudness.

The same scenes, seeds and camera on two builds (the old stand-ins on main, the new sounds on the branch) give the
before/after pairs for the sound board. Scenarios: fight60 (60 v 60), creature (ants against a spider and a beetle),
titan (ants against a stag beetle titan), battle400 (400 v 400, for the density and clipping check).
"""
import base64
import os
import subprocess
import sys
import time
import wave

import numpy as np
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
TAG = os.environ.get("TAG", "after")
FPS = int(os.environ.get("FPS", "20"))
W = int(os.environ.get("W", "854"))
H = int(os.environ.get("H", "480"))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sfx_rec"
COMMON = "?play=1&shot=1&q=low&seed=5&creatures=0&titans=0&nocine=1"
SCENES = {
    # (query, seconds, warm-up ticks before the recording starts)
    "fight60": ("&species=formica&rival=solenopsis&battle=formica_worker:60,fire_minor:60", 8, 40),
    "creature": ("&species=formica&rival=lasius&spawn=wolfSpider,groundBeetle,lithobius&battle=formica_worker:30", 8, 30),
    "titan": ("&species=lasius&rival=formica&spawn=stagBeetle&battle=lasius_soldier:40", 9, 30),
    "battle400": ("&species=atta&rival=formica&battle=atta_media:400,formica_worker:400", 8, 60),
}
pick = sys.argv[2:] or ["fight60", "creature", "titan"]
os.makedirs(OUT, exist_ok=True)

# a virtual performance.now: the game's frame timers (GameAudio's dt, cooldowns) follow the recording's clock
INIT = """
(() => {
  const real = performance.now.bind(performance);
  window.__vnow = null;
  performance.now = () => (window.__vnow === null ? real() : window.__vnow);
})();
"""

RUN = """
async ([fps, secs, warm]) => {
  const audio = window.__audio, s = window.__session;
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.ceil(sr * secs), sr);
  audio.build(off);
  // the manifest first; then (new bank) every file decoded before the first frame
  for (let i = 0; i < 200 && audio.bank.ready === false; i++) await new Promise((r) => setTimeout(r, 50));
  if (audio.bank.preload) await audio.bank.preload();
  const canvas = document.getElementById('view');
  const dt = 1 / fps;
  window.__vnow = 1e6;
  for (let i = 0; i < warm; i++) { window.__vnow += 50; window.__step(1, 0.05); }
  const rec = (window.__rec = { frames: [], done: false, peak: 0, pcm: null, stats: null });
  const frame = () => {
    window.__vnow += dt * 1000;
    window.__step(1, dt);
    rec.frames.push(canvas.toDataURL('image/jpeg', 0.82));
  };
  const n = Math.floor(secs * fps);
  for (let i = 1; i < n; i++) off.suspend(i * dt).then(() => { frame(); off.resume(); });
  frame();
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const pcm = new Int16Array(L.length * 2);
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  rec.pcm = btoa(bin);
  rec.peak = peak;
  rec.stats = { voices: audio.playing(), started: audio.stats.started, refused: audio.stats.refused, ui: window.__ui && window.__ui.audio ? window.__ui.audio.state : null };
  rec.done = true;
  return n;
}
"""

errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    for sc in pick:
        query, secs, warm = SCENES[sc]
        ctx = b.new_context(viewport={"width": W, "height": H})
        ctx.add_init_script(INIT)
        pg = ctx.new_page()
        pg.set_default_timeout(1800000)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        t0 = time.time()
        # the warm-up ticks run in the simulation only (no rendering) before the page is ready
        pg.goto(BASE + COMMON + query + f"&ticks={warm}", wait_until="load")
        while time.time() - t0 < 300 and not pg.evaluate("window.__ready === true && !!window.__step && !!window.__audio"):
            time.sleep(0.25)
        fdir = os.path.join(OUT, f"{sc}_{TAG}_frames")
        subprocess.run(["rm", "-rf", fdir])
        os.makedirs(fdir)
        pg.evaluate("(a) => { window.__job = (" + RUN + ")(a); }", [FPS, secs, 0])
        k = 0
        while True:
            got = pg.evaluate("window.__rec ? window.__rec.frames.splice(0, 24) : []")
            for f in got:
                with open(os.path.join(fdir, f"f{k:04d}.jpg"), "wb") as fh:
                    fh.write(base64.b64decode(f.split(",", 1)[1]))
                k += 1
            if not got and pg.evaluate("window.__rec && window.__rec.done"):
                break
            if not got:
                time.sleep(0.3)
        r = pg.evaluate("window.__rec")
        pcm = np.frombuffer(base64.b64decode(r["pcm"]), dtype=np.int16).reshape(-1, 2)
        wav = os.path.join(OUT, f"{sc}_{TAG}.wav")
        with wave.open(wav, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(44100)
            w.writeframes(pcm.tobytes())
        x = pcm.astype(np.float32).mean(axis=1) / 32768
        win = 11025
        rms = [20 * np.log10(np.sqrt(np.mean(x[i:i + win] ** 2)) + 1e-9) for i in range(0, len(x) - win, win)]
        mp4 = os.path.join(OUT, f"{sc}_{TAG}.mp4")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(fdir, "f%04d.jpg"), "-i", wav,
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", mp4], check=True)
        print(f"{sc} {TAG}: {k} frames, peak {20*np.log10(r['peak']+1e-9):.1f} dBFS, median {np.median(rms):.1f} dB RMS (max {max(rms):.1f}), {r['stats']} [{time.time()-t0:.0f} s]", flush=True)
        ctx.close()
    b.close()
bad = [e for e in errs if "favicon" not in e]
print("page errors: " + " | ".join(bad[:5]) if bad else "recordings done")
