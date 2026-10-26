import { audio } from './engine';
import { LoopBed } from './beds';
import type { MapStyle } from '../world/terrain';

/**
 * The soundscape (Phase 14 audio): always running, so silence never feels empty.
 *
 * Surface, by day: wind in the grass, birds in the distance, cicadas in
 * warm biomes, a fly passing now and then, leaf litter rustling up close.
 * By night: crickets and katydids, frogs by water, an owl far off, a
 * cooler and quieter wind. Underground: a close, muffled room tone, soil
 * trickling, roots creaking, the colony's low rumble, and the surface
 * faintly through the ground.
 *
 * Biomes are the map styles: meadow (grassland), forest (woodland litter),
 * sandy (scrub: cicadas, sand hiss), riverbank (water, frogs), formicarium
 * (a quiet room). Weather (rain, thunder) is a parameter, ready for when
 * the game has weather. Zoom crossfades the wide layers (wind, birds) with
 * the macro layer (litter, grains): close up you hear the detail.
 */
export interface Place {
  style: MapStyle;
  /** 1 on the surface, 0 underground (eased by the caller) */
  surface: number;
  /** 0 day … 1 night */
  night: number;
  /** 0 = right down among the ants … 1 = zoomed far out */
  zoom: number;
  /** 0 dry … 1 heavy rain */
  rain: number;
  /** how busy the colony nearby is (0–1), for the underground rumble */
  activity: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Ambience {
  private wind = new LoopBed('amb.wind_grass');
  private litter = new LoopBed('amb.leaves_rustle');
  private cicada = new LoopBed('amb.cicada');
  private stream = new LoopBed('amb.water_stream');
  private sand = new LoopBed('amb.sand_hiss');
  private rainBed = new LoopBed('amb.rain');
  private room = new LoopBed('amb.nest_room');
  private rumble = new LoopBed('amb.colony_rumble');
  /** the surface heard through the soil */
  private above = new LoopBed('amb.wind_grass', true);
  private timers: Record<string, number> = {};

  update(p: Place): void {
    if (!audio.ctx) return;
    const s = p.surface;
    const u = 1 - s;
    const day = 1 - p.night;
    const wide = 0.45 + 0.55 * p.zoom;
    const close = 1 - 0.75 * p.zoom;
    const style = p.style;
    const open = style !== 'formicarium';
    audio.environment(u, p.night);
    // surface beds
    this.wind.set(open ? s * wide * (0.75 - 0.25 * p.night + 0.3 * p.rain) : 0, 0.8, 5200 - 1800 * p.night);
    this.litter.set(open ? s * close * (style === 'forest' ? 0.9 : 0.55) * (1 - 0.4 * p.night) : 0, 0.6);
    this.cicada.set(open && (style === 'sandy' || style === 'meadow') ? s * day * day * (style === 'sandy' ? 0.8 : 0.4) * (1 - p.rain) : 0, 2);
    this.stream.set(style === 'riverbank' ? s * (0.6 + 0.4 * close) : 0, 1);
    this.sand.set(style === 'sandy' ? s * (0.5 + 0.3 * wide) : 0, 1);
    this.rainBed.set(open ? s * p.rain : 0, 1.5);
    // underground beds
    this.room.set(u * (style === 'formicarium' ? 0.6 : 1), 0.6);
    this.rumble.set(u * (0.3 + 0.7 * p.activity), 1);
    this.above.set(open ? u * 0.5 : 0, 0.8, 600);
    // one-shots, each on its own clock
    const t = audio.now;
    const every = (key: string, lo: number, hi: number, f: () => void) => {
      if ((this.timers[key] ?? 0) === 0) this.timers[key] = t + rnd(lo, hi) * 0.5;
      if (t >= this.timers[key]) {
        this.timers[key] = t + rnd(lo, hi);
        f();
      }
    };
    const pan = () => rnd(-0.9, 0.9);
    if (open && s > 0.3) {
      every('bird', 2, 7, () => day > 0.4 && p.rain < 0.6 && audio.play('amb.bird', { gain: s * day * wide * rnd(0.4, 1), pan: pan() }));
      every('fly', 14, 40, () => day > 0.5 && p.rain < 0.3 && style !== 'sandy' && audio.play('amb.fly_pass', { gain: s * day * rnd(0.4, 0.9), pan: pan() }));
      every('cricket', 0.25, 0.7, () => p.night > 0.35 && audio.play('amb.cricket', { gain: s * p.night * rnd(0.25, 1) * (1 - 0.5 * p.rain), pan: pan() }));
      every('katydid', 3, 9, () => p.night > 0.5 && style !== 'sandy' && audio.play('amb.katydid', { gain: s * p.night * rnd(0.3, 0.8), pan: pan() }));
      every('frog', 1.5, 5, () => p.night > 0.4 && style === 'riverbank' && audio.play('amb.frog', { gain: s * p.night * rnd(0.3, 1), pan: pan() }));
      every('owl', 25, 70, () => p.night > 0.6 && style === 'forest' && audio.play('amb.owl', { gain: s * p.night * rnd(0.5, 0.9), pan: pan(), wet: 0.2 }));
      every('drop', 0.2, 0.9, () => p.rain > 0.2 && audio.play('amb.raindrop_big', { gain: s * p.rain * close * rnd(0.3, 1), pan: pan() }));
      every('thunder', 20, 60, () => p.rain > 0.6 && audio.play('amb.thunder', { gain: s * p.rain * rnd(0.5, 1), pan: pan() * 0.5 }));
      every('drip', 4, 12, () => style === 'riverbank' && audio.play('amb.drip', { gain: s * rnd(0.2, 0.5), pan: pan() }));
    }
    if (u > 0.3) {
      every('trickle', 3, 9, () => audio.play('amb.soil_trickle', { gain: u * rnd(0.3, 0.9), pan: pan(), wet: 0.3 }));
      every('creak', 12, 35, () => open && audio.play('amb.root_creak', { gain: u * rnd(0.3, 0.7), pan: pan(), wet: 0.3 }));
      every('cavedrip', 6, 18, () => (style === 'riverbank' || p.rain > 0.3) && audio.play('amb.drip', { gain: u * rnd(0.2, 0.5), pan: pan(), wet: 0.5 }));
    }
  }
}
