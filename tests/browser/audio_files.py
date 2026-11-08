"""The sound files (audio v3): every sound in the manifest decodes in both formats (Ogg for most browsers, AAC for
Safari without Ogg), is cut into the right number of takes, and every one-shot take starts on its first sound (so a
bite lands on the strike frame): the encoder-delay correction works for both codecs.

    tests/browser/with_server.sh python3 tests/browser/audio_files.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
CHECK = r"""
async (ext) => {
  const audio = window.__audio;
  const bank = audio.bank;
  bank.ext = ext;
  audio.build(new OfflineAudioContext(1, 44100, 48000));
  await bank.preload();
  const out = { sounds: 0, takes: 0, bad: [], late: [], onsetMs: [], missing: [] };
  const STRIKE = /^(combat\.(?!grapple|battle)|species\.(hellant|army|sickle|glue|termite_chew)|cr\.(beetle_bite|centipede_bite|spider_fangs|stag_clash|mantis_strike|creature_death)|ant\.(dig_bite|seed_crack|food_cut))/;
  for (const [id, f] of Object.entries(bank.manifest.sounds)) {
    const def = (await import('/src/audio/catalog.ts')).SOUND[id];
    if (!def) { out.missing.push(id + ' (not in the catalog)'); continue; }
    if (def.stream) continue;
    const t = bank.takes(def);
    if (!t || !t.length) { out.bad.push(id + ': no takes'); continue; }
    out.sounds++;
    if (t.length !== (f.takes || [0]).length) out.bad.push(`${id}: ${t.length} takes, manifest ${(f.takes || [0]).length}`);
    for (const b of t) {
      out.takes++;
      const x = b.getChannelData(0);
      let peak = 0, first = -1;
      for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; if (first < 0 && v > 0.01) first = i; }
      if (!(peak > 0.02) || !isFinite(peak)) out.bad.push(`${id}: silent take`);
      // the attacks, hits and deaths must start on their contact (ambience and titans may swell in)
      if (!f.loop && STRIKE.test(id)) {
        const ms = (first / b.sampleRate) * 1000;
        out.onsetMs.push(ms);
        if (ms > 8) out.late.push(`${id}: starts ${ms.toFixed(1)} ms in`);
      }
    }
  }
  out.onsetMs.sort((a, b) => a - b);
  out.median = out.onsetMs[Math.floor(out.onsetMs.length / 2)];
  out.max = out.onsetMs[out.onsetMs.length - 1];
  delete out.onsetMs;
  return out;
}
"""
res = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for ext in ("ogg", "mp4"):
        pg = b.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE + "?scene=sounds", wait_until="load")
        pg.wait_for_function("!!window.__audio && window.__audio.bank.ready === true", timeout=60000)
        r = pg.evaluate(CHECK, ext)
        ok = not r["bad"] and not r["late"] and not r["missing"] and r["sounds"] > 90
        res.append(f"{'PASS' if ok else 'FAIL'}  {ext}: {r['sounds']} sounds, {r['takes']} takes decoded; attacks, hits and deaths start {r['median']:.1f} ms in (median), {r['max']:.1f} ms at most")
        for k in ("bad", "late", "missing"):
            for x in r[k][:8]:
                res.append(f"      {k}: {x}")
        if errs:
            res.append(f"FAIL  {ext}: page errors {errs[:2]}")
        pg.close()
    b.close()
print("\n".join(res))
sys.exit(1 if any(x.startswith("FAIL") for x in res) else 0)
