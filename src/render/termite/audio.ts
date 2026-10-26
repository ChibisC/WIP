/**
 * v2 Sickle-Jaw audio events — a tiny procedural WebAudio synth (no audio files), so the colony has sound even if
 * the game has no assets for it. If the game already has an audio system, keep these EVENT NAMES and parameters
 * and route them there; this module is then only the reference sound design.
 *
 *   event          when (sim -> render event stream)                       params
 *   biteSnap       LUNGE reaches LUNGE_SNAP (the grab) / any sickle bite     -
 *   acidStream     continuous while a soldier is HOLDing and squirting       ramp 0..1 (wetter, louder, faster pulses)
 *   acidFizz       continuous while acid sits on a target                    level 0..1
 *   victimStruggle continuous while a victim is held                         intensity 0..1 (fades as it dies)
 *   alarmDrum      a soldier's alarm (ALARM state entered)                   -
 */

export const SICKLE_AUDIO_EVENTS = ['biteSnap', 'acidStream', 'acidFizz', 'victimStruggle', 'alarmDrum'] as const;
export type SickleAudioEvent = (typeof SICKLE_AUDIO_EVENTS)[number];

type Voice = { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; lfo: OscillatorNode; lfoGain: GainNode };

export class SickleJawAudio {
  private noise: AudioBuffer;
  private voices = new Map<string, Voice>();
  readonly out: GainNode;

  constructor(readonly ctx: AudioContext, destination: AudioNode = ctx.destination, volume = 0.6) {
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    this.out.connect(destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
  }

  /** sharp chitin snap: a click plus a short band-passed noise burst */
  biteSnap(gain = 1) {
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 1.4;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bp).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.5, 0.1);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1900, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.03);
    const og = c.createGain();
    og.gain.setValueAtTime(0.35 * gain, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(og).connect(this.out);
    o.start(t);
    o.stop(t + 0.05);
  }

  /** vibrational head drumming: a quick train of soft low taps (~8 Hz) */
  alarmDrum(gain = 1, taps = 6) {
    const c = this.ctx;
    for (let k = 0; k < taps; k++) {
      const t = c.currentTime + k * 0.12;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.05);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + 0.08);
    }
  }

  private voice(key: string, type: BiquadFilterType, freq: number, q: number, lfoType: OscillatorType): Voice {
    let v = this.voices.get(key);
    if (v) return v;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.type = lfoType;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(filter).connect(gain).connect(this.out);
    src.start(0, Math.random() * 1.5);
    lfo.start();
    v = { src, gain, filter, lfo, lfoGain };
    this.voices.set(key, v);
    return v;
  }

  private stopVoice(key: string) {
    const v = this.voices.get(key);
    if (!v) return;
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0, t, 0.05);
    v.lfoGain.gain.setTargetAtTime(0, t, 0.05);
    v.src.stop(t + 0.3);
    v.lfo.stop(t + 0.3);
    this.voices.delete(key);
  }

  /** wet acid stream for soldier `id`: pulses at the visual squirt rate (3 -> 12 Hz), steady and bright at the cap */
  acidStream(id: string | number, ramp: number, active: boolean) {
    const key = 'acid:' + id;
    if (!active) return this.stopVoice(key);
    const v = this.voice(key, 'bandpass', 900, 0.9, 'sine');
    const t = this.ctx.currentTime;
    const r = Math.min(1, Math.max(0, ramp));
    v.filter.frequency.setTargetAtTime(900 + 1700 * r, t, 0.1);
    const level = 0.12 + 0.28 * r;
    const pulseDepth = level * (1 - 0.8 * r);
    v.gain.gain.setTargetAtTime(level - pulseDepth * 0.5, t, 0.08);
    v.lfoGain.gain.setTargetAtTime(pulseDepth * 0.5, t, 0.08);
    v.lfo.frequency.setTargetAtTime(3 + 9 * r, t, 0.1);
  }

  /** crackling fizz on target `id` */
  acidFizz(id: string | number, level: number) {
    const key = 'fizz:' + id;
    if (level <= 0.01) return this.stopVoice(key);
    const v = this.voice(key, 'highpass', 4200, 0.7, 'square');
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0.06 * level, t, 0.1);
    v.lfoGain.gain.setTargetAtTime(0.05 * level, t, 0.1);
    v.lfo.frequency.setTargetAtTime(31 + 17 * level, t, 0.1);
  }

  /** scrabbling legs of held victim `id` */
  victimStruggle(id: string | number, intensity: number) {
    const key = 'struggle:' + id;
    if (intensity <= 0.01) return this.stopVoice(key);
    const v = this.voice(key, 'bandpass', 2300, 2.5, 'square');
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(0.05 * intensity, t, 0.05);
    v.lfoGain.gain.setTargetAtTime(0.05 * intensity, t, 0.05);
    v.lfo.frequency.setTargetAtTime(11 + 6 * intensity, t, 0.1);
  }

  stopAll() {
    for (const k of [...this.voices.keys()]) this.stopVoice(k);
  }
}
