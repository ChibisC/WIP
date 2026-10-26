import { onSettings, settings } from '../game/profile';
import type { Bus, SoundDef } from './catalog';
import { SOUND } from './catalog';
import { Bank } from './bank';

/**
 * The mixer (Phase 14 audio). Web Audio API, no outside engine (FMOD and
 * Wwise need accounts and SDK downloads; Howler adds nothing we need on top
 * of this; see docs/audio/README.md).
 *
 *   voice → [pan] → bus in → environment filter → duck → volume ─┐
 *                      └──────── reverb send (room / open air) ──┤→ master → limiter → out
 *   off-screen voices go through a muffle (lowpass, quieter) first
 *
 * Buses: ambience, creatures, combat, ui, music, narration, each with its
 * own volume slider. Ducking lowers ambience and music (and a little of the
 * creatures) while an alert or narration plays. Underground, the world buses
 * close in (lowpass, more room reverb); at night the ambience darkens a
 * little. The context starts on the first click or key (browser rule) and
 * everything fades out while the tab is hidden.
 *
 * Audio only reads the game: nothing here changes the simulation.
 */

export const BUSES: Bus[] = ['ambience', 'creatures', 'combat', 'ui', 'music', 'narration'];

interface BusNodes {
  input: GainNode;
  filter: BiquadFilterNode;
  duck: GainNode;
  vol: GainNode;
  room: GainNode;
  air: GainNode;
}

export interface PlayOpts {
  /** loudness 0–1 (distance already applied) */
  gain?: number;
  /** −1 left … 1 right */
  pan?: number;
  /** playback-rate multiplier on top of the random pitch (bosses play lower) */
  rate?: number;
  /** context time to start (default: now) */
  at?: number;
  /** an important event off screen: heard muffled and quiet */
  muffle?: boolean;
  /** extra reverb send 0–1 */
  wet?: number;
  /** a specific take (1-based), else a random one */
  take?: number;
}

export interface Voice {
  def: SoundDef;
  src: AudioBufferSourceNode;
  gain: GainNode;
  end: number;
  level: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  readonly bank = new Bank(this);
  private master!: GainNode;
  private bus = {} as Record<Bus, BusNodes>;
  private roomIn!: GainNode;
  private airIn!: GainNode;
  private muffleIn!: Record<Bus, GainNode>;
  private hidden = false;
  private waiting: Array<(ctx: AudioContext) => void> = [];
  private voices: Voice[] = [];
  private lastTake = new Map<string, number>();
  private duckUntil = 0;
  private meterNode: AnalyserNode | null = null;
  private meterBuf = new Float32Array(2048);
  /** voices started (for tests and the debug overlay) */
  stats = { started: 0, refused: 0 };

  constructor() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    (window as unknown as { __audio: AudioEngine }).__audio = this;
    // Browsers start sound only from a user gesture. On iPhone and iPad a touch's pointerdown is not one (its
    // pointerup / touchend is), and the context is suspended again after a call or a trip to the home screen, so
    // these stay on: unlock() does nothing once the context is running.
    const unlock = () => {
      if (!this.ctx || this.ctx.state !== 'running') this.unlock();
    };
    for (const t of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(t, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.apply();
    });
    onSettings(() => this.apply());
    // quiet wood taps on menu buttons (the in-game ones and the title menus)
    document.addEventListener(
      'click',
      (e) => {
        const b = (e.target as HTMLElement | null)?.closest?.('button, .chip, .mode-card, .sp-card, .mode-tab');
        if (b && this.ctx && !(b as HTMLElement).dataset.silent) this.play('ui.menu_tap', { gain: 0.8 });
      },
      true,
    );
  }

  /** Make (or resume) the context; safe to call often. */
  unlock(): void {
    if (this.ctx) {
      // 'suspended', or Safari's 'interrupted' after a phone call
      if ((this.ctx.state as string) !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.build(new AC({ latencyHint: 'interactive' }));
    } catch {
      this.ctx = null;
    }
  }

  /** Build the graph on a context (also used with an OfflineAudioContext to render mixes in tests). */
  build(ctx: AudioContext): void {
    this.ctx = ctx;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.knee.value = 6;
    lim.ratio.value = 8;
    lim.attack.value = 0.003;
    lim.release.value = 0.25;
    lim.connect(ctx.destination);
    this.meterNode = ctx.createAnalyser();
    this.meterNode.fftSize = 2048;
    lim.connect(this.meterNode);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(lim);
    // two reverbs: a close room for the nest, a sparse open air for the surface
    this.roomIn = ctx.createGain();
    this.airIn = ctx.createGain();
    const room = ctx.createConvolver();
    room.buffer = impulse(ctx, 0.7, 3.2, 0.004);
    const air = ctx.createConvolver();
    air.buffer = impulse(ctx, 2.4, 2.6, 0.02);
    const roomWet = ctx.createGain();
    roomWet.gain.value = 0.55;
    const airWet = ctx.createGain();
    airWet.gain.value = 0.35;
    this.roomIn.connect(room).connect(roomWet).connect(this.master);
    this.airIn.connect(air).connect(airWet).connect(this.master);
    this.muffleIn = {} as Record<Bus, GainNode>;
    for (const b of BUSES) {
      const input = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      filter.Q.value = 0.5;
      const duck = ctx.createGain();
      const vol = ctx.createGain();
      const roomS = ctx.createGain();
      const airS = ctx.createGain();
      roomS.gain.value = 0;
      airS.gain.value = b === 'music' ? 0.25 : b === 'ui' ? 0 : 0.12;
      input.connect(filter).connect(duck).connect(vol).connect(this.master);
      vol.connect(roomS).connect(this.roomIn);
      vol.connect(airS).connect(this.airIn);
      this.bus[b] = { input, filter, duck, vol, room: roomS, air: airS };
      // off-screen: muffled through a lowpass at a third of the level
      const mIn = ctx.createGain();
      mIn.gain.value = 0.35;
      const mf = ctx.createBiquadFilter();
      mf.type = 'lowpass';
      mf.frequency.value = 650;
      mIn.connect(mf).connect(input);
      this.muffleIn[b] = mIn;
    }
    if (ctx.state === 'suspended' && !('startRendering' in ctx)) void ctx.resume();
    this.apply();
    for (const f of this.waiting.splice(0)) f(ctx);
    this.bank.warm();
  }

  /** Run `f` once the context exists (now, or after the first click). */
  whenReady(f: (ctx: AudioContext) => void): void {
    if (this.ctx) f(this.ctx);
    else this.waiting.push(f);
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** The node a bed or voice of `bus` connects to. */
  input(bus: Bus, muffled = false): AudioNode {
    return muffled ? this.muffleIn[bus] : this.bus[bus].input;
  }

  /** Volumes from the settings (and silence while hidden or muted). */
  apply(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const s = settings();
    const t = ctx.currentTime;
    const m = s.muted || this.hidden ? 0 : s.volume.master;
    this.master.gain.setTargetAtTime(m * m, t, 0.08);
    for (const b of BUSES) {
      const v = s.volume[b];
      this.bus[b].vol.gain.setTargetAtTime(v * v, t, 0.08);
    }
  }

  /**
   * Where the listener is: underground (0–1) closes the world in (lowpass,
   * room reverb instead of open air); night (0–1) darkens the ambience.
   */
  environment(underground: number, night: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const u = Math.max(0, Math.min(1, underground));
    const lerp = (a: number, b: number) => a + (b - a) * u;
    this.bus.ambience.filter.frequency.setTargetAtTime(lerp(14000 - 6000 * night, 3200), t, 0.3);
    for (const b of ['creatures', 'combat'] as Bus[]) {
      this.bus[b].filter.frequency.setTargetAtTime(lerp(20000, 9000), t, 0.3);
      this.bus[b].room.gain.setTargetAtTime(lerp(0, 0.35), t, 0.3);
      this.bus[b].air.gain.setTargetAtTime(lerp(0.12, 0), t, 0.3);
    }
    this.bus.ambience.room.gain.setTargetAtTime(lerp(0, 0.3), t, 0.3);
    this.bus.ambience.air.gain.setTargetAtTime(lerp(0.15, 0), t, 0.3);
  }

  /**
   * Lower the rest of the mix for `hold` seconds so an alert, a boss's roar
   * of stridulation or a narrator line is heard: ambience and music fully,
   * creatures and combat partly. `spare` is the bus of the sound being
   * featured, which is left alone.
   */
  duck(depth = 0.45, hold = 1.2, spare?: Bus): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.duckUntil = Math.max(this.duckUntil, t + hold);
    for (const [b, k] of [
      ['ambience', 1],
      ['music', 1],
      ['creatures', 0.6],
      ['combat', 0.7],
    ] as Array<[Bus, number]>) {
      if (b === spare) continue;
      const g = this.bus[b].duck.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(1 - depth * k, t, 0.04);
      g.setTargetAtTime(1, this.duckUntil, 0.5);
    }
  }

  /** The output level right now (after the limiter): peak and RMS, linear. */
  meter(): { peak: number; rms: number } {
    if (!this.meterNode) return { peak: 0, rms: 0 };
    this.meterNode.getFloatTimeDomainData(this.meterBuf);
    let p = 0;
    let s = 0;
    for (const v of this.meterBuf) {
      p = Math.max(p, Math.abs(v));
      s += v * v;
    }
    return { peak: p, rms: Math.sqrt(s / this.meterBuf.length) };
  }

  /** Voices of a sound (or a bus) playing now. */
  playing(id?: string, bus?: Bus): number {
    const t = this.now;
    this.voices = this.voices.filter((v) => v.end > t);
    let n = 0;
    for (const v of this.voices) if ((!id || v.def.id === id) && (!bus || v.def.bus === bus)) n++;
    return n;
  }

  /**
   * Play one take of a sound. Returns the voice, or null when the sound is
   * not ready, too quiet, or at its voice limit (the quietest voice gives way
   * to a louder one).
   */
  play(id: string, o: PlayOpts = {}): Voice | null {
    const ctx = this.ctx;
    const def = SOUND[id];
    if (!ctx || !def) return null;
    const takes = this.bank.takes(def);
    if (!takes || !takes.length) return null;
    const rnd = (k: number) => 1 + (Math.random() * 2 - 1) * k;
    const level = (o.gain ?? 1) * def.gain * rnd(def.vol);
    if (level < 0.004) return null;
    const t = this.now;
    this.voices = this.voices.filter((v) => v.end > t);
    const same = this.voices.filter((v) => v.def === def);
    if (same.length >= def.voices) {
      const quiet = same.reduce((a, b) => (a.level < b.level ? a : b));
      if (quiet.level >= level) {
        this.stats.refused++;
        return null;
      }
      try {
        quiet.gain.gain.setTargetAtTime(0, t, 0.01);
        quiet.src.stop(t + 0.05);
      } catch {
        // already stopped
      }
      quiet.end = t;
    }
    // a different take each time
    let k = o.take ? Math.min(takes.length, o.take) - 1 : Math.floor(Math.random() * takes.length);
    if (!o.take && takes.length > 1 && k === this.lastTake.get(id)) k = (k + 1 + Math.floor(Math.random() * (takes.length - 1))) % takes.length;
    this.lastTake.set(id, k);
    const src = ctx.createBufferSource();
    src.buffer = takes[k];
    src.playbackRate.value = rnd(def.pitch) * (o.rate ?? 1);
    const g = ctx.createGain();
    g.gain.value = level;
    let node: AudioNode = g;
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p);
      node = p;
    }
    src.connect(g);
    node.connect(this.input(def.bus, o.muffle));
    if (o.wet) {
      const w = ctx.createGain();
      w.gain.value = o.wet;
      node.connect(w).connect(this.roomIn);
    }
    const start = Math.max(t, o.at ?? t);
    src.start(start);
    const v: Voice = { def, src, gain: g, end: start + takes[k].duration / src.playbackRate.value + 0.05, level };
    this.voices.push(v);
    this.stats.started++;
    return v;
  }
}

/** Play a raw buffer on a bus (the procedural score's notes). */
export function playBuffer(b: AudioBuffer, bus: Bus, gain: number, at: number, pan = 0, rate = 1): void {
  const ctx = audio.ctx;
  if (!ctx || gain <= 0.001) return;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(audio.input(bus));
  } else g.connect(audio.input(bus));
  src.start(Math.max(ctx.currentTime, at));
}

/** A generated reverb impulse: decaying noise, darker as it decays, with a pre-delay. */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number, pre: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  const p = Math.floor(pre * ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = p; i < n; i++) {
      const u = (i - p) / (n - p);
      const a = 0.5 - 0.45 * u;
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - u, decay);
    }
  }
  return b;
}

/** The one engine for the page. */
export const audio = new AudioEngine();
