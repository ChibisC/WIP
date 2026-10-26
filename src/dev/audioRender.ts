import { audio } from '../audio/engine';
import { Ambience } from '../audio/ambience';
import { Music } from '../audio/music';
import { GrainBed, LoopBed } from '../audio/beds';
import { Mixer, Pool } from '../audio/mixer';
import type { MapStyle } from '../world/terrain';

/**
 * ?scene=sounds&render=<scenario>&secs=N: render a soundscape offline, through
 * the real engine (buses, limiter, voice budgets, beds, ducking), and hand
 * the result to the test harness as a WAV. A way to listen by measurement:
 * tests/browser/audio_mix.py saves it, draws its spectrogram and checks
 * loudness, clipping and voice counts.
 *
 * Scenarios: meadow-day, forest-night, riverbank-night, nest, battle400, boss.
 */
export async function renderScenario(name: string, secs: number): Promise<void> {
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.ceil(sr * secs), sr);
  audio.build(off as unknown as AudioContext);
  const amb = new Ambience();
  const music = new Music();
  const swarm = new GrainBed('ant.swarm_bed');
  const battle = new GrainBed('combat.battle_bed');
  const scuffle = new GrainBed('combat.grapple_scuffle');
  const rumble = new LoopBed('boss.rumble');
  const mixer = new Mixer();
  const step = 2560 / sr;
  const stats = { maxVoices: 0, played: 0, dropped: 0, peakOverflow: 0, events: 0 };
  const place: { style: MapStyle; surface: number; night: number; zoom: number; rain: number; activity: number } = { style: 'meadow', surface: 1, night: 0, zoom: 0.3, rain: 0, activity: 0.4 };
  let heat = 0;
  let boss = 0;
  const want = (id: string, pool: Pool, dist: number, pan = Math.random() * 1.6 - 0.8, rate = 1) => {
    const g = 1 / (1 + dist * dist * 1.8);
    stats.events++;
    if (pool === 'combat') heat += 0.05 * g;
    mixer.push({ id, prio: g, gain: g, pan, rate, pool, muffle: false, wet: place.surface < 0.5 ? 0.15 : 0 });
  };
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pois = (rate: number) => {
    // events this step for a Poisson rate
    let n = 0;
    let p = Math.exp(-rate * step);
    let u = Math.random();
    while (u > p && n < 200) {
      n++;
      u *= Math.random();
    }
    return n;
  };
  const update = (t: number) => {
    let ants = 0;
    let fight = 0;
    let grapple = 0;
    if (name === 'meadow-day') ants = 40;
    if (name === 'forest-night') Object.assign(place, { style: 'forest', night: 1, zoom: 0.4 });
    if (name === 'riverbank-night') Object.assign(place, { style: 'riverbank', night: 0.9 });
    if (name === 'nest') {
      Object.assign(place, { surface: 0, activity: 0.8, zoom: 0.15 });
      ants = 60;
      for (let k = pois(4); k--; ) want('ant.dig_bite', 'work', rnd(0.2, 1.5));
      for (let k = pois(1.2); k--; ) want('ant.soil_grains', 'work', rnd(0.2, 1.5));
      for (let k = pois(40); k--; ) want('ant.step_soil', 'steps', rnd(0.1, 1.2));
      if (t > 3 && t < 3 + step) audio.play('ant.queen_lay');
    }
    if (name === 'battle400') {
      // 400 ants fighting in view: ~330 bites/s, stings, acid, deaths
      ants = 400;
      fight = 1;
      grapple = 160;
      for (let k = pois(330); k--; ) want(Math.random() < 0.7 ? 'combat.mandible_click' : 'combat.mandible_snap', 'combat', rnd(0.1, 2.5));
      for (let k = pois(60); k--; ) want('combat.sting_fire', 'combat', rnd(0.1, 2.5));
      for (let k = pois(25); k--; ) want('combat.acid_spray', 'combat', rnd(0.2, 2.5));
      for (let k = pois(8); k--; ) want('combat.ant_death', 'combat', rnd(0.1, 2.5));
      for (let k = pois(30); k--; ) want('combat.chitin_crack', 'combat', rnd(0.1, 2.5));
      for (let k = pois(80); k--; ) want('ant.step_soil', 'steps', rnd(0.1, 1.5));
      if (t >= 5 && t < 5 + step) {
        audio.duck(0.6, 1.4, 'ui');
        audio.play('ui.alert_queen');
      }
    }
    if (name === 'boss') {
      boss = 1;
      fight = 0.6;
      ants = 120;
      grapple = 30;
      if (Math.floor(t / 0.7) !== Math.floor((t - step) / 0.7)) want('boss.footstep', 'creature', 0.5, 0, 0.55);
      if (t >= 2 && t < 2 + step) want('boss.windup', 'creature', 0.4, 0);
      if (t >= 2.9 && t < 2.9 + step) want('boss.slam', 'creature', 0.4, 0);
      if (t >= 5 && t < 5 + step) {
        audio.duck(0.65, 1.5, 'creatures');
        want('boss.phase', 'creature', 0.4, 0);
      }
      for (let k = pois(60); k--; ) want('combat.mandible_click', 'combat', rnd(0.2, 2));
      for (let k = pois(6); k--; ) want('cr.stag_clash', 'creature', rnd(0.2, 1), rnd(-0.5, 0.5), 0.6);
    }
    mixer.flush(step);
    heat *= Math.exp(-step / 5);
    amb.update({ ...place, rain: 0 });
    swarm.level = Math.min(1, Math.sqrt(ants) / 16);
    swarm.density = 10 + Math.min(70, ants * 0.8);
    swarm.update();
    scuffle.level = Math.min(1, grapple / 12);
    scuffle.density = 12 + Math.min(50, grapple * 2);
    scuffle.update();
    battle.level = Math.min(1, mixer.overflow * 0.12 + Math.max(0, heat - 1) * 0.15);
    battle.density = 15 + Math.min(60, mixer.overflow * 6);
    battle.update();
    rumble.set(boss, 1.5);
    music.update(step, fight ? Math.max(fight, 1 - Math.exp(-heat * 0.8)) : 0, boss);
    stats.maxVoices = Math.max(stats.maxVoices, audio.playing());
    stats.peakOverflow = Math.max(stats.peakOverflow, mixer.overflow);
  };
  for (let t = step; t < secs - step; t += step) {
    void off.suspend(t).then(() => {
      update(t);
      void off.resume();
    });
  }
  update(0);
  const buf = await off.startRendering();
  stats.played = mixer.played;
  stats.dropped = mixer.dropped;
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
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
  (window as unknown as { __render: unknown }).__render = { name, sr, channels: 2, peak, stats, pcm: btoa(bin) };
}
