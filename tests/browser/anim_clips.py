"""Animation pass (docs/realism/animation.md): record the animation lab's clips frame by frame, then make
WebM and GIF clips (real time and 0.25x) and frame strips.

  BASE=http://127.0.0.1:5174/ CLIPS=walk,attack ANIM=2 python3 tests/browser/anim_clips.py docs/realism/animation/clips

Env: EXTRA (more query parameters), NAME (output-name suffix), CLIPS (comma list), ANIM (2 = the animation pass, 1 = the old motion), FPS (render rate, default 30),
EVERY (keep every n-th frame, default 1), W, H, LIGHT (default overcast), SECS (override the clip length).
"""
import os, sys, time, subprocess, shutil
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5174/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/animation/clips"
CLIPS = [c for c in os.environ.get("CLIPS", "walk").split(",") if c]
ANIM = os.environ.get("ANIM", "2")
FPS = int(os.environ.get("FPS", "30"))
EVERY = int(os.environ.get("EVERY", "1"))
W = int(os.environ.get("W", "800"))
H = int(os.environ.get("H", "500"))
LIGHT = os.environ.get("LIGHT", "overcast")
SECS = float(os.environ.get("SECS", "0"))
# EXTRA: more query parameters (e.g. "&cdist=80"); NAME: a suffix for the output names (e.g. "_d80")
EXTRA = os.environ.get("EXTRA", "")
NAME = os.environ.get("NAME", "")
os.makedirs(OUT, exist_ok=True)
tag = "after" if ANIM == "2" else "before"


def strip(frames, path, n=8, label=""):
    pick = [frames[round(i * (len(frames) - 1) / (n - 1))] for i in range(n)]
    ims = [Image.open(f) for f in pick]
    w = ims[0].width // 2
    h = ims[0].height // 2
    sheet = Image.new("RGB", (w * 4, h * ((n + 3) // 4) + 24), (18, 16, 14))
    d = ImageDraw.Draw(sheet)
    d.text((6, 5), label, fill=(235, 220, 190))
    for i, im in enumerate(ims):
        sheet.paste(im.resize((w, h)), ((i % 4) * w, 24 + (i // 4) * h))
    sheet.save(path)


errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": W, "height": H})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "ERR_" not in m.text)) else None)
    for clip in CLIPS:
        t0 = time.time()
        pg.goto(f"{BASE}?scene=animlab&clip={clip}&anim={ANIM}&light={LIGHT}&fps={FPS}&tm=neutral{EXTRA}", wait_until="load", timeout=600000)
        while time.time() - t0 < 600 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.25)
        dur = SECS or pg.evaluate("window.__anim.dur")
        fdir = os.path.join(OUT, f"{clip}{NAME}_{tag}_frames")
        shutil.rmtree(fdir, ignore_errors=True)
        os.makedirs(fdir)
        frames = []
        n = int(dur * FPS / EVERY)
        for k in range(n):
            pg.evaluate(f"window.__anim.step({EVERY})")
            f = os.path.join(fdir, f"f{k:04d}.png")
            pg.screenshot(path=f, timeout=300000)
            frames.append(f)
        rate = FPS / EVERY
        base = os.path.join(OUT, f"{clip}{NAME}_{tag}")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(rate), "-i", os.path.join(fdir, "f%04d.png"), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-deadline", "realtime", "-cpu-used", "8", "-pix_fmt", "yuv420p", base + ".webm"], check=False)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(rate / 4), "-i", os.path.join(fdir, "f%04d.png"), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-deadline", "realtime", "-cpu-used", "8", "-pix_fmt", "yuv420p", base + "_quarter.webm"], check=False)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(rate), "-i", os.path.join(fdir, "f%04d.png"), "-vf", f"fps={min(15, rate)},scale={W // 2}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer", base + ".gif"], check=False)
        strip(frames, base + "_strip.png", 8, f"{clip}{NAME} ({tag}): {dur:.1f} s, 8 frames evenly spaced")
        print(f"{time.time() - t0:6.1f}s  {clip}: {n} frames", flush=True)
    b.close()
print("errors:", errs[:8])
