import { SOUNDS, SoundDef } from './catalog';
import { MUSIC_RECIPES, SR } from './instruments';
import { rng } from './dsp';
import type { AudioEngine } from './engine';

/**
 * Where each sound's takes come from (audio v3: claude/audio/03-spec-sfx-rework-insect.md).
 *
 * Every effect is a file: `audio/manifest.json` (written by tools/audio/sfx/build.py) lists, per sound, one file
 * holding all its takes one after another (an audio sprite) and where each take starts. A sound is fetched and decoded
 * the first time it is wanted (or in the background after the first click, `warm`), then cut into one buffer per
 * take. Long ambience loops are streamed through an audio element instead of being decoded, so they cost no memory.
 * The music stingers and the narration cue are made in the game (instruments.ts).
 *
 * Encoders can add a little silence at the start of a file (AAC's priming), so each file's first sound is found
 * after decoding and compared with where the manifest says it is (`lead`); the takes are cut at the corrected times.
 */
export interface SoundFile {
  /** path without extension, under audio/ */
  file: string;
  /** the formats present */
  ext: string[];
  /** each take: [start, length] in samples at the manifest's `sr` */
  takes?: Array<[number, number]>;
  /** the first sample of the file above silence, at `sr` (to correct encoder delay) */
  lead?: number;
  loop?: boolean;
}

export interface Manifest {
  sr: number;
  sounds: Record<string, SoundFile>;
  /** CC-BY and other third-party credits shown on the Credits screen */
  credits: Array<{ file: string; title: string; author: string; url: string; license: string }>;
}

export type TakeSource = 'file' | 'in-game' | 'none';

export class Bank {
  manifest: Manifest = { sr: 44100, sounds: {}, credits: [] };
  ready = false;
  private manifestLoad: Promise<void> = Promise.resolve();
  private loaded = new Map<string, AudioBuffer[]>();
  private pending = new Map<string, Promise<void>>();
  /** the format this browser plays: Ogg Vorbis or, on Safari without Ogg, AAC */
  private ext = 'ogg';

  constructor(private engine: AudioEngine) {
    if (typeof window === 'undefined') return;
    try {
      const a = document.createElement('audio');
      if (!a.canPlayType('audio/ogg; codecs="vorbis"')) this.ext = 'mp4';
    } catch {
      // keep ogg
    }
    this.manifestLoad = this.loadManifest();
  }

  private async loadManifest(): Promise<void> {
    try {
      const r = await fetch('audio/manifest.json', { cache: 'no-cache' });
      if (r.ok) {
        const m = (await r.json()) as Partial<Manifest>;
        this.manifest = { sr: m.sr ?? 44100, sounds: m.sounds ?? {}, credits: m.credits ?? [] };
      }
    } catch {
      // no manifest: only the in-game music plays
    }
    this.ready = true;
  }

  /** The sound's file, if it has one. */
  file(def: SoundDef): SoundFile | undefined {
    return this.manifest.sounds[def.id];
  }

  source(def: SoundDef): TakeSource {
    if (this.file(def)) return 'file';
    return def.recipe && MUSIC_RECIPES[def.recipe] ? 'in-game' : 'none';
  }

  /** URL of a sound's file, in a format this browser plays. */
  url(f: SoundFile): string {
    const ext = f.ext.includes(this.ext) ? this.ext : f.ext[0];
    return `audio/${f.file}.${ext}`;
  }

  /** The takes of a sound, if ready (starts loading or rendering them otherwise). */
  takes(def: SoundDef): AudioBuffer[] | null {
    const got = this.loaded.get(def.id);
    if (got) return got;
    if (!this.engine.ctx || !this.ready) return null;
    const f = this.file(def);
    if (f) {
      void this.load(def);
      return null;
    }
    return this.render(def);
  }

  /** Make an in-game sound's takes now (the music stingers, the narration cue). */
  private render(def: SoundDef): AudioBuffer[] | null {
    const ctx = this.engine.ctx;
    if (!ctx || !def.recipe || !MUSIC_RECIPES[def.recipe]) return null;
    const out: AudioBuffer[] = [];
    for (let k = 1; k <= Math.max(1, def.takes); k++) {
      const x = MUSIC_RECIPES[def.recipe](rng(k * 7919 + def.id.length * 31 + Math.floor(Math.random() * 1e6)));
      const b = ctx.createBuffer(1, x.length, SR);
      b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
      out.push(b);
    }
    this.loaded.set(def.id, out);
    return out;
  }

  /** Fetch, decode and cut a sound's file into its takes (once). */
  load(def: SoundDef): Promise<void> {
    const f = this.file(def);
    const ctx = this.engine.ctx;
    if (!f || !ctx || this.loaded.has(def.id)) return Promise.resolve();
    let p = this.pending.get(def.id);
    if (p) return p;
    p = (async () => {
      try {
        const r = await fetch(this.url(f));
        if (!r.ok) return;
        const bytes = await r.arrayBuffer();
        // low sounds are decoded at a lower rate (half or a quarter of the memory)
        let whole: AudioBuffer | null = null;
        if (def.down && typeof OfflineAudioContext !== 'undefined') {
          try {
            whole = await new OfflineAudioContext(1, 1, Math.round(44100 / def.down)).decodeAudioData(bytes.slice(0));
          } catch {
            whole = null;
          }
        }
        whole ??= await ctx.decodeAudioData(bytes);
        this.loaded.set(def.id, this.cut(whole, f));
      } catch {
        // a broken or missing file: the sound stays silent
      } finally {
        this.pending.delete(def.id);
      }
    })();
    this.pending.set(def.id, p);
    return p;
  }

  /** Cut a decoded sprite into its takes, correcting for any encoder delay. */
  private cut(whole: AudioBuffer, f: SoundFile): AudioBuffer[] {
    const ctx = this.engine.ctx!;
    const R = whole.sampleRate;
    const sr = this.manifest.sr;
    const spans = f.takes ?? [[0, Math.round((whole.length * sr) / R)]];
    let shift = 0;
    if (f.lead !== undefined) {
      const ch = whole.getChannelData(0);
      let first = 0;
      while (first < ch.length && Math.abs(ch[first]) < 1e-3) first++;
      // (bounded: a coded file never starts more than ~0.1 s late)
      shift = Math.max(-0.02, Math.min(0.1, first / R - f.lead / sr));
    }
    const out: AudioBuffer[] = [];
    for (const [start, len] of spans) {
      // a loop is cut exactly; a one-shot gets 2 ms of margin before its first sound
      const pad = f.loop ? 0 : 0.002;
      const a = Math.max(0, Math.round((start / sr + shift - pad) * R));
      const n = Math.min(whole.length - a, Math.round((len / sr + pad) * R));
      if (n <= 0) continue;
      const b = ctx.createBuffer(whole.numberOfChannels, n, R);
      for (let c = 0; c < whole.numberOfChannels; c++) b.copyToChannel(whole.getChannelData(c).subarray(a, a + n), c);
      out.push(b);
    }
    return out;
  }

  /**
   * A looping bed: a streamed element for long ambience loops, else a buffer. Null until ready.
   * (An offline render — the tests' mixes and recordings — has no media elements: it decodes the loop instead.)
   */
  bed(def: SoundDef): { buffer?: AudioBuffer; element?: HTMLAudioElement } | null {
    const f = this.ready ? this.file(def) : undefined;
    const ctx = this.engine.ctx;
    if (def.stream && f && ctx && 'createMediaElementSource' in ctx) {
      const el = new Audio(this.url(f));
      el.loop = true;
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      return { element: el };
    }
    const t = this.takes(def);
    return t && t.length ? { buffer: t[0] } : null;
  }

  /** Decode every sound (or the given ones) now: for tests, offline renders and recordings. */
  async preload(ids?: string[]): Promise<void> {
    await this.manifestLoad;
    const defs = SOUNDS.filter((d) => (!ids || ids.includes(d.id)) && !(d.stream && this.engine.ctx && 'createMediaElementSource' in this.engine.ctx));
    for (const d of defs) {
      if (this.file(d)) await this.load(d);
      else if (d.recipe) this.render(d);
    }
  }

  /**
   * After the first click, decode the sounds a game uses most in the background, a few at a time, so nothing waits
   * on its first play: combat, the orders and alerts, work. Ambience one-shots, creatures and bosses load when first
   * wanted (a game uses only some of them).
   */
  warm(): void {
    const first = (d: SoundDef) => (d.bus === 'combat' || d.bus === 'ui' ? 0 : d.id.startsWith('ant.') ? 1 : 2);
    const queue = SOUNDS.filter((d) => this.file(d) && !d.stream && !d.reserved && first(d) < 2).sort((a, b) => first(a) - first(b));
    const step = async () => {
      await this.manifestLoad;
      while (queue.length) {
        const batch = queue.splice(0, 4);
        await Promise.all(batch.map((d) => this.load(d)));
        await new Promise((r) => setTimeout(r, 30));
      }
    };
    setTimeout(() => void step(), 200);
  }

  /** Memory held by decoded takes (bytes). */
  bytes(): number {
    let n = 0;
    for (const arr of this.loaded.values()) for (const b of arr) n += b.length * b.numberOfChannels * 4;
    return n;
  }
}
