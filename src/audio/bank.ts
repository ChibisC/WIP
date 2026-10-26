import { SOUNDS, SoundDef, takePath } from './catalog';
import { RECIPES, SR } from './standins';
import { decimate, rng } from './dsp';
import type { AudioEngine } from './engine';

/**
 * Where each sound's takes come from (Phase 14 audio).
 *
 * `audio/manifest.json` (written by `npm run audio:manifest`) lists the
 * recordings that exist under public/audio. A sound with files there plays
 * them; a sound without files plays its organic stand-in, rendered on the
 * spot (all of them together take about a second, so they are warmed up in
 * small slices after the first click). Short sounds are decoded whole;
 * long looping files (music, long ambience) are streamed through an audio
 * element instead of being decoded, so they cost no memory.
 */
export interface Manifest {
  /** take path (no extension) → the extensions present, e.g. { "ant/bite_01": ["ogg", "m4a"] } */
  files: Record<string, string[]>;
  /** CC-BY and other credits shown on the Credits screen */
  credits: Array<{ file: string; title: string; author: string; url: string; license: string }>;
}

export type TakeSource = 'file' | 'stand-in' | 'none';

export class Bank {
  manifest: Manifest = { files: {}, credits: [] };
  private loaded = new Map<string, AudioBuffer[]>();
  private pending = new Set<string>();
  private ready = false;
  /** the format this browser plays: Ogg (Vorbis/Opus) or, on older Safari, AAC */
  private ext = 'ogg';

  constructor(private engine: AudioEngine) {
    if (typeof window === 'undefined') return;
    try {
      const a = document.createElement('audio');
      if (!a.canPlayType('audio/ogg; codecs="vorbis"') && !a.canPlayType('audio/ogg; codecs="opus"')) this.ext = 'm4a';
    } catch {
      // keep ogg
    }
    void this.loadManifest();
  }

  private async loadManifest(): Promise<void> {
    try {
      const r = await fetch('audio/manifest.json', { cache: 'no-cache' });
      if (r.ok) {
        const m = (await r.json()) as Partial<Manifest>;
        this.manifest = { files: m.files ?? {}, credits: m.credits ?? [] };
      }
    } catch {
      // no manifest: every sound uses its stand-in
    }
    this.ready = true;
  }

  /** The recorded takes of a sound that exist (paths without extension). */
  files(def: SoundDef): string[] {
    const out: string[] = [];
    for (let n = 1; n <= Math.max(1, def.takes); n++) {
      const p = takePath(def.id, n);
      if (this.manifest.files[p]) out.push(p);
    }
    return out;
  }

  source(def: SoundDef): TakeSource {
    if (this.files(def).length) return 'file';
    return def.recipe && RECIPES[def.recipe] ? 'stand-in' : 'none';
  }

  /** URL of a take, in a format this browser plays. */
  url(path: string): string {
    const have = this.manifest.files[path] ?? [];
    const ext = have.includes(this.ext) ? this.ext : have[0] ?? this.ext;
    return `audio/${path}.${ext}`;
  }

  /** The takes of a sound, if ready (starts loading or rendering them otherwise). */
  takes(def: SoundDef): AudioBuffer[] | null {
    const got = this.loaded.get(def.id);
    if (got) return got;
    if (!this.engine.ctx) return null;
    const files = this.ready ? this.files(def) : [];
    if (files.length && !def.stream) {
      void this.decode(def, files);
      return null;
    }
    if (!this.ready && !def.recipe) return null;
    return this.render(def);
  }

  /** Render the stand-in takes now. */
  render(def: SoundDef): AudioBuffer[] | null {
    const ctx = this.engine.ctx;
    if (!ctx || !def.recipe || !RECIPES[def.recipe]) return null;
    const want = def.loop ? 1 : Math.max(1, def.takes);
    const out: AudioBuffer[] = [];
    for (let k = 1; k <= want; k++) {
      const k2 = def.down ?? 1;
      const x = decimate(RECIPES[def.recipe](rng(k * 7919 + def.id.length * 31 + Math.floor(Math.random() * 1e6))), SR, k2);
      const b = ctx.createBuffer(1, x.length, SR / k2);
      b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
      out.push(b);
      // long one-shots (thunder, slams, phrases) keep three stand-in takes, to save memory
      if (k >= 3 && b.duration > 1.2) break;
    }
    this.loaded.set(def.id, out);
    return out;
  }

  private async decode(def: SoundDef, files: string[]): Promise<void> {
    const ctx = this.engine.ctx;
    if (!ctx || this.pending.has(def.id)) return;
    this.pending.add(def.id);
    const out: AudioBuffer[] = [];
    for (const p of files) {
      try {
        const r = await fetch(this.url(p));
        if (!r.ok) continue;
        out.push(await ctx.decodeAudioData(await r.arrayBuffer()));
      } catch {
        // a broken file: skip it
      }
    }
    this.pending.delete(def.id);
    if (out.length) this.loaded.set(def.id, out);
    else if (def.recipe) this.render(def);
  }

  /**
   * A looping bed: a streamed element for long recorded loops, else a buffer
   * (the decoded file or the stand-in). Null until ready.
   */
  bed(def: SoundDef): { buffer?: AudioBuffer; element?: HTMLAudioElement } | null {
    if (def.stream && this.ready) {
      const files = this.files(def);
      if (files.length) {
        const el = new Audio(this.url(files[0]));
        el.loop = true;
        el.crossOrigin = 'anonymous';
        el.preload = 'auto';
        return { element: el };
      }
    }
    const t = this.takes(def);
    return t && t.length ? { buffer: t[0] } : null;
  }

  /** Render every stand-in in small slices after the first click, so nothing hitches the first time it plays. */
  warm(): void {
    const queue = SOUNDS.filter((d) => d.recipe && !d.reserved);
    const step = () => {
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 6) {
        const d = queue.shift()!;
        if (!this.loaded.has(d.id) && !(this.ready && this.files(d).length)) this.takes(d);
      }
      if (queue.length) setTimeout(step, 16);
    };
    setTimeout(step, 200);
  }

  /** Memory held by decoded and rendered takes (bytes). */
  bytes(): number {
    let n = 0;
    for (const arr of this.loaded.values()) for (const b of arr) n += b.length * b.numberOfChannels * 4;
    return n;
  }
}
