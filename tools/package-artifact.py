#!/usr/bin/env python3
"""Package the Vite production build (dist/) as a single-page artifact.

Usage: python3 tools/package-artifact.py <out_dir>
Writes <out_dir>/index.html (title + inlined CSS + app markup) and <out_dir>/assets/*.js (the entry module
and the chunks it loads: the sim worker, multiplayer transport, QR reader), referenced relatively.
"""
import glob, os, re, shutil, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
css = open(glob.glob('dist/assets/*.css')[0]).read()
# the entry is the chunk the built index.html loads; the others are imported relative to it
entry = os.path.basename(re.search(r'src="(?:\./|/)?assets/([^"]+\.js)"', open('dist/index.html').read()).group(1))
os.makedirs(os.path.join(out, 'assets'), exist_ok=True)
for js in glob.glob('dist/assets/*.js'):
    shutil.copy(js, os.path.join(out, 'assets', os.path.basename(js)))
page = f"""<title>Underground Dominion</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Marcellus+SC&family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet" />
<style>
:root {{ color-scheme: dark; }}
{css}
</style>
<div id="app">
  <canvas id="view"></canvas>
  <div id="ui"></div>
</div>
<script type="module" src="assets/{entry}"></script>
"""
open(os.path.join(out, 'index.html'), 'w').write(page)
print('packaged', out, entry, sorted(os.listdir(os.path.join(out, 'assets'))))
