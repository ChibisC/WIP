import * as THREE from 'three';
import type { GameSession } from '../game/session';
import type { SimEvent } from '../core/events';
import { AS, Carry, SURFACE, nestSpace } from '../sim/types';
import { CASTES, isTermiteSpecies } from '../sim/species';
import { CREATURES } from '../sim/creatures/kinds';
import { rampFraction } from '../sim/termites';
import { isSickle, sickleRampFraction } from '../sim/sickleJaws';
import { animHooks } from '../render/ants/antRenderer';
import { ANIM_SFX } from '../render/ants/antMotion';
import type { MapStyle } from '../world/terrain';
import { audio } from './engine';
import { GrainBed, LoopBed } from './beds';
import { Ambience } from './ambience';
import { Music } from './music';
import { Mixer, Pool } from './mixer';

/**
 * The game's sound, driven by the session (Phase 14 audio; the effects reworked in audio v3,
 * claude/audio/03-spec-sfx-rework-insect.md).
 *
 * - **Where:** a sound is placed where it happens. Loudness falls off with
 *   distance from the point the camera looks at, relative to the zoom, so
 *   zooming in brings sounds closer; stereo follows the screen. Only the
 *   place on screen is heard (the surface, or the one underground area in
 *   view); important events elsewhere (a slam, your ants dying in another
 *   area) come through muffled and quiet.
 * - **How many:** each frame's sound requests are sorted by loudness
 *   within their pool and only the loudest play (8 work sounds, 16 combat
 *   sounds, 10 creature sounds). Combat past the limit feeds the battle bed,
 *   which thickens with a fight too big for single voices; grapplers feed the
 *   scuffle bed. A 400-ant battle stays dense, readable and within budget.
 * - **What:** simulation events (bites, stings, acid, deaths, digging,
 *   hatching, bosses' wind-ups and slams), the animation's own beats (a grip,
 *   a crushing bite, a snap) and what is visible close up (ants picking up and
 *   setting down loads, an antenna tap, sickle-jaw holds, creatures walking by
 *   their gait, a boss's footfalls). Ants and termites make no walking sounds,
 *   and termites make no idle sounds: their alarm drum only plays on a real
 *   alarm.
 * - **When:** sim events arrive on the damage tick, which is the attack
 *   animation's strike frame (antViews.ts), and every file starts on its
 *   first sound, so a bite is heard as the jaws close.
 *
 * Sound only reads the game; it never changes the simulation.
 */

interface Want {
  pool: Pool;
  gain?: number;
  rate?: number;
  /** wider reach for loud sounds (1 = normal) */
  reach?: number;
  /** heard muffled when it happens off screen */
  important?: boolean;
  /** contributes to the fight intensity (music, battle bed) */
  heat?: number;
}

type Family = 'spider' | 'beetle' | 'centipede' | 'mantis' | 'soft' | 'still';
/** loads worth a sound when picked up and set down (soil has its own: the dig bite and the spoil heap) */
const LOADS = new Set<number>([Carry.Food, Carry.Leaf, Carry.Corpse, Carry.Brood]);
const FAMILY: Record<string, Family> = {
  wolfSpider: 'spider',
  spiderling: 'spider',
  tarantula: 'spider',
  hogna: 'spider',
  groundBeetle: 'beetle',
  stagBeetle: 'beetle',
  rove: 'beetle',
  pillbug: 'beetle',
  lithobius: 'centipede',
  scolopendra: 'centipede',
  mantis: 'mantis',
  giantMantis: 'mantis',
  cutworm: 'soft',
  antlion: 'still',
};

export class GameAudio {
  private ambience = new Ambience();
  private music = new Music();
  private battle = new GrainBed('combat.battle_bed');
  private scuffle = new GrainBed('combat.grapple_scuffle');
  private bossRumble = new LoopBed('boss.rumble');
  /** nasute soldiers firing glue nearby: a sticky sputter, brighter as their ramps climb */
  private glueBed = new LoopBed('species.nasute_glue');
  private glue = 0;
  private glueRamp = 0;
  private mixer = new Mixer();
  private heat = 0;
  private boss = 0;
  /** story levels: the music mood the level asks for (a floor under the fight intensity, and the boss stem) */
  private moodFloor = 0;
  private moodBoss = 0;
  private bossNear = 0;
  private surfaceMix = 1;
  private last = performance.now();
  private right = new THREE.Vector3();
  /** creatures' walked distance since their last step */
  private walk = new Map<number, { x: number; y: number; acc: number; t: number }>();
  /** nearby ants' loads: what each carried at the last look, and when it may next make a carrying sound */
  private loads = new Map<number, { c: number; next: number; t: number }>();
  private seenBoss = new Set<number>();
  private lastSay = new Map<string, number>();
  /** ants in view close up (the ambience's macro layer rises a little over a busy patch) */
  private crowd = 0;
  private grappling = 0;
  private scanT = 0;
  private activity = 0;
  /** sandbox / future weather: 0 dry … 1 heavy rain */
  rain = 0;

  /** set while a sim event is being voiced: its sounds wait for the picture (see `lag`) */
  private fromSim = false;
  /** seconds per tick, measured; and the last tick seen */
  private tickSec = 0.05;
  private lastTick = -1;
  private lastTickAt = 0;

  constructor(private s: GameSession) {
    s.events.onAny((e) => {
      this.fromSim = true;
      try {
        this.event(e);
      } finally {
        this.fromSim = false;
      }
    });
    // the ant animation's own moments (spec 04; the sim's bites, stings and deaths have their sounds already)
    animHooks.emit = (k, x, y, space, cause) => this.anim(k, x, y, space, cause);
  }

  /**
   * Render-side sound hooks (render/ants/antMotion.ts ANIM_SFX), on the animation's own frame: the grip of a sting
   * series (scrapes and the held ant's squeak), a major's crushing bite, a hell ant's snap, a landing on the back and
   * righting (a tick as the feet catch), a death's own sound.
   */
  private anim(k: number, x: number, y: number, space: number, cause: number): void {
    if (!audio.ctx) return;
    if (k === ANIM_SFX.GRIP) return this.want('combat.grip', x, y, space, { pool: 'combat', gain: 0.5 });
    if (k === ANIM_SFX.CRUNCH) return this.want('combat.bite_crush', x, y, space, { pool: 'combat', gain: 0.6, rate: 0.9 });
    // a hell ant's melee snap (the hunt's snap has its own sim event): the same sharp crack, a little quieter
    if (k === ANIM_SFX.SNAP) return this.want('species.hellant_snap', x, y, space, { pool: 'combat', gain: 0.6, rate: 1.1, heat: 0.03 });
    if (k === ANIM_SFX.FLIP) return this.want('combat.hit_tick', x, y, space, { pool: 'combat', gain: 0.55, rate: 0.85 });
    if (k === ANIM_SFX.RIGHT) return this.want('combat.hit_tick', x, y, space, { pool: 'combat', gain: 0.3, rate: 1.2 });
    if (k === ANIM_SFX.DEATH) {
      if (cause === 3) return this.want('combat.acid_splat', x, y, space, { pool: 'combat', gain: 0.4, rate: 1.2 });
      if (cause === 4 || cause === 8 || cause === 9) return this.want('combat.bite_crush', x, y, space, { pool: 'combat', gain: 0.75, rate: 0.85 });
    }
  }

  // ---------------------------------------------------------------- placement

  private listener(): { x: number; y: number; ref: number; space: number } {
    const v = this.s.view;
    const rig = v.space === 'nest' ? v.nestRig : v.surfaceRig;
    return { x: rig.goal.x, y: rig.goal.z, ref: Math.max(20, rig.distance), space: v.space === 'nest' ? v.activeNest : SURFACE };
  }

  private get style(): MapStyle {
    return this.s.world.terrain.params.style;
  }

  /** Queue a sound at (x, y) in `space`. */
  private want(id: string, x: number, y: number, space: number, o: Want): void {
    const L = this.listener();
    const reach = o.reach ?? 1;
    let gain = o.gain ?? 1;
    let pan = 0;
    let muffle = false;
    if (space !== L.space || this.s.view.transitioning) {
      if (!o.important) return;
      muffle = true;
      gain *= 0.6;
    } else {
      const dx = x - L.x;
      const dy = y - L.y;
      const d = Math.hypot(dx, dy) / (L.ref * reach);
      if (d > 3) {
        if (!o.important) return;
        muffle = true;
        gain *= 0.4;
      } else {
        gain *= 1 / (1 + d * d * 1.8);
        // zoomed far out, small sounds fade; right down among the ants they are close and loud
        gain *= Math.min(1.3, Math.pow(140 / L.ref, 0.45));
        const cam = this.s.view.activeCamera();
        this.right.setFromMatrixColumn(cam.matrixWorld, 0);
        pan = Math.max(-1, Math.min(1, (dx * this.right.x + dy * this.right.z) / (L.ref * 0.9))) * 0.85;
      }
    }
    if (o.heat && !muffle) this.heat += o.heat * Math.min(1, gain * 2);
    if (gain < 0.02) return;
    this.mixer.push({ id, prio: gain, gain: Math.min(1.2, gain), pan, rate: o.rate ?? 1, pool: o.pool, muffle, wet: this.s.view.space === 'nest' ? 0.15 : 0, delay: this.fromSim ? this.lag() : 0 });
  }

  /**
   * How long until the picture shows the tick a sim event happened on: the renderer draws between the last two ticks,
   * so a bite's tick is on screen (the jaws closed) once the frame's interpolation reaches it. Waiting that long puts
   * the sound on the strike frame instead of up to a tick ahead of it.
   */
  private lag(): number {
    return Math.max(0, Math.min(0.12, (1 - this.s.renderAlpha) * this.tickSec));
  }

  /** At most one of `key` per `gap` seconds. */
  private every(key: string, gap: number): boolean {
    const t = audio.now;
    if ((this.lastSay.get(key) ?? -1e9) > t - gap) return false;
    this.lastSay.set(key, t);
    return true;
  }

  // ---------------------------------------------------------------- events

  private event(e: SimEvent): void {
    if (e.t === 'story' && e.what === 'music') {
      const M: Record<string, [number, number]> = { calm: [0, 0], tense: [0.35, 0], swarm: [0.85, 0.35], assault: [0.6, 0.15] };
      [this.moodFloor, this.moodBoss] = M[e.mood ?? 'calm'] ?? [0, 0];
      return;
    }
    if (!audio.ctx) return;
    const me = this.s.player.id;
    switch (e.t) {
      case 'dig':
        this.want('ant.dig_bite', e.x, e.y, nestSpace(e.colony), { pool: 'work', gain: 0.8 });
        if (Math.random() < 0.3) this.want('ant.soil_grains', e.x, e.y, nestSpace(e.colony), { pool: 'work', gain: 0.6 });
        return;
      case 'spoil':
        return this.want('ant.pellet_drop', e.x, e.y, e.space, { pool: 'work', gain: 0.7 });
      case 'titanDig':
        // a titan digging into a nest: the warning and the breach as heavy slams, its digging as footfalls and soil, the
        // ground breaking round it underground as soil grains
        if (e.phase === 'warn' || e.phase === 'breach') return this.want('boss.slam', e.x, e.y, e.space, { pool: 'creature', gain: 0.8, reach: 6, important: true, heat: 0.4 });
        if (e.phase === 'dig') {
          // the rumble rises in pitch and grows louder as the hole opens (claude/creatures/02-spec §3)
          const p = Math.max(0, Math.min(1, e.prog ?? 0));
          this.want('boss.footstep', e.x, e.y, e.space, { pool: 'creature', gain: 0.65 + 0.45 * p, rate: 0.82 + 0.5 * p, reach: 4 + 2 * p, heat: 0.05 + 0.05 * p });
          return this.want('ant.soil_grains', e.x, e.y, e.space, { pool: 'work', gain: 0.85 + 0.4 * p, rate: 0.9 + 0.3 * p });
        }
        if (e.phase === 'start') return this.want('boss.footstep', e.x, e.y, e.space, { pool: 'creature', gain: 0.9, rate: 0.8, reach: 5, heat: 0.1 });
        if (e.phase === 'break') return this.want('ant.soil_grains', e.x, e.y, e.space, { pool: 'work', gain: 0.9, heat: 0.02 });
        return;
      case 'bite':
        return this.bite(e);
      case 'sting': {
        // fire ants: quicker and doubled; army ants: a little stronger; sized by the stinger
        const c = e.by ? CASTES[e.by] : undefined;
        const fire = c?.species === 'solenopsis';
        const army = c?.species === 'eciton';
        return this.want(fire ? 'combat.sting_fire' : 'combat.sting', e.x, e.y, e.space, { pool: 'combat', gain: army ? 0.95 : 0.8, rate: (c ? sizeRate(c.length * 3) : 1) * (army ? 0.9 : 1), heat: 0.05 });
      }
      case 'acid':
        // a mortar's lob pops; a spray hisses
        if (e.lob) return this.want('combat.mortar_pop', e.x, e.y, e.space, { pool: 'combat', gain: 0.85, heat: 0.04 });
        return this.want('combat.acid_spray', e.x, e.y, e.space, { pool: 'combat', gain: 0.75, heat: 0.04 });
      case 'acidHit':
        // the lobbed droplet landing: a wet fizz, no explosion
        return this.want('combat.mortar_land', e.x, e.y, e.space, { pool: 'combat', gain: 0.8, heat: 0.03 });
      case 'splash':
        return this.want('combat.acid_splat', e.x, e.y, e.space, { pool: 'combat', gain: 0.5 });
      case 'hit':
        // a hit taken: a crunch when heavy, a tiny tick when light
        return this.want(e.big ? 'combat.chitin_crack' : 'combat.hit_tick', e.x, e.y, e.space, { pool: 'combat', gain: e.big ? 1 : 0.7, heat: 0.05 });
      case 'death': {
        if (e.kind === 'creature') {
          const k = e.what ? CREATURES[e.what] : undefined;
          return this.want('cr.creature_death', e.x, e.y, e.space, { pool: 'creature', gain: 1, rate: k ? sizeRate(k.length) : 1, reach: k?.boss ? 3 : 1.5, important: !!k?.boss, heat: 0.25 });
        }
        if (e.colony === me) this.heat += 0.08;
        // sized by the body (lower and a little louder for big castes, quieter for small ants); termites die soft
        const c = e.what ? CASTES[e.what] : undefined;
        const len = c?.length ?? 5;
        return this.want(c?.termite ? 'combat.termite_death' : 'combat.ant_death', e.x, e.y, e.space, { pool: 'combat', gain: 0.55 + 0.35 * Math.min(1, len / 9), rate: sizeRate(len * 3), heat: 0.08, important: e.colony === me && this.every('offdeath', 0.6) });
      }
      case 'alarm': {
        // ants stridulate; termites drum their heads (only on a real alarm: an attack)
        const termite = isTermiteSpecies(this.s.world.colony(e.colony)?.species ?? 'lasius');
        if (this.every((termite ? 'drum' : 'alarm') + e.space, termite ? 0.9 : 0.35)) this.want(termite ? 'species.termite_headbang' : 'ant.stridulate', e.x, e.y, e.space, { pool: 'work', gain: 0.7, heat: 0.02 });
        return;
      }
      case 'fling':
        return this.want('combat.fling', e.x, e.y, e.space, { pool: 'combat', gain: 0.9, reach: 1.4, heat: 0.1 });
      case 'climb':
        // getting onto a creature's leg: claws catching (a grip); dropping off a dying one: a soft landing and a tumble
        if (e.phase === 'up') return this.want('combat.grip', e.x, e.y, e.space, { pool: 'combat', gain: 0.5, rate: 1.2, heat: 0.03 });
        if (e.phase === 'drop') {
          this.want('ant.put_down', e.x, e.y, e.space, { pool: 'work', gain: 0.85, rate: 0.8 });
          if (this.every('drop' + e.creature, 0.3)) this.want('combat.fling', e.x, e.y, e.space, { pool: 'combat', gain: 0.5, rate: 1.2 });
        }
        return;
      case 'slam':
        audio.duck(0.3, 0.6, 'creatures');
        return this.want('boss.slam', e.x, e.y, e.space, { pool: 'creature', gain: Math.min(1, 0.6 + e.power * 0.4), reach: 4, important: true, heat: 0.5 });
      case 'telegraph': {
        const cr = this.s.world.creatureById.get(e.creature);
        const k = cr ? CREATURES[cr.kind] : undefined;
        return this.want('boss.windup', e.x, e.y, e.space, { pool: 'creature', gain: 0.9, rate: k ? Math.max(0.7, sizeRate(k.length) * 1.3) : 1, reach: 4, heat: 0.15 });
      }
      case 'bossPhase': {
        const cr = this.s.world.creatureById.get(e.creature);
        if (!cr) return;
        audio.duck(0.65, 1.5, 'creatures');
        return this.want('boss.phase', cr.x, cr.y, cr.space, { pool: 'creature', gain: 1, reach: 5, important: true, heat: 0.6 });
      }
      case 'hairs':
        return this.want('boss.hairs', e.x, e.y, e.space, { pool: 'creature', gain: 0.9, reach: 3, heat: 0.2 });
      case 'snap':
        // hell ant: the fastest, sharpest crack; an impale or a finisher adds the wet crunch; prey kicks on the jaw
        this.want('species.hellant_snap', e.x, e.y, e.space, { pool: 'combat', gain: 0.95, heat: 0.06 });
        if (e.impale) this.want('species.hellant_impale', e.x, e.y, e.space, { pool: 'combat', gain: 0.8, heat: 0.04 });
        else if (Math.random() < 0.5) this.want('combat.struggle', e.x, e.y, e.space, { pool: 'combat', gain: 0.55 });
        return;
      case 'surge':
        // Saiy-Ant gold surge (one shimmer per moment, however many ants flash; a crackle each)
        if (this.every('surge' + e.space, 0.6)) this.want('species.saiyant_surge', e.x, e.y, e.space, { pool: 'combat', gain: 0.8, heat: 0.1 });
        else this.want('species.saiyant_crackle', e.x, e.y, e.space, { pool: 'combat', gain: 0.55 });
        return;
      case 'glueBurst':
        // a conehead's glue landing: a sticky, stringy sputter
        return this.want('species.glue_splat', e.x, e.y, e.space, { pool: 'combat', gain: 0.75, heat: 0.03 });
      case 'grab':
        // a sickle-jaw hooks its victim: the crossed blades snap shut, then it struggles (the hold's acid and the
        // struggle go on in sickleVoices)
        this.want('species.sickle_snap', e.x, e.y, e.space, { pool: 'combat', gain: 0.8, heat: 0.06 });
        if (Math.random() < 0.6) this.want('combat.struggle', e.x, e.y, e.space, { pool: 'combat', gain: 0.5 });
        return;
      case 'hook':
        // an army-ant soldier: the sickle hooks rasp in and seat; the victim stridulates
        return this.want('species.army_hook', e.x, e.y, e.space, { pool: 'combat', gain: 0.9, heat: 0.04 });
      case 'pin':
        if (this.every('pin' + e.space, 0.5)) this.want('combat.struggle', e.x, e.y, e.space, { pool: 'combat', gain: 0.5, rate: 1.15 });
        return;
      case 'link':
        // a living-bridge link hooks its claws on: a tiny click and scrape
        return this.want('ant.pick_up', e.x, e.y, e.space, { pool: 'work', gain: 0.4, rate: 1.3 });
      case 'grabMiss':
        // the blades closing on air
        return this.want('species.sickle_snap', e.x, e.y, e.space, { pool: 'combat', gain: 0.55, rate: 1.15 });
      case 'gene':
        // Termants absorb an enemy corpse's genes (only the colony's own player hears it)
        if (e.colony !== me) return;
        if (this.every('gene', 1.2)) {
          const q = this.s.world.antById.get(this.s.player.queen);
          if (q) this.want('species.termant_absorb', q.x, q.y, q.space, { pool: 'work', gain: 0.75 });
        }
        return;
      case 'caste': {
        if (e.colony !== me || e.forgotten) return;
        const q = this.s.world.antById.get(this.s.player.queen);
        if (q) this.want('species.termant_caste', q.x, q.y, q.space, { pool: 'work', gain: 0.9, reach: 4 });
        return;
      }
      case 'headbang':
        // the termite alarm (a soldier attacked or grabbing, the colony's alarm ability): never an idle sound
        return this.want('species.termite_headbang', e.x, e.y, e.space, { pool: 'work', gain: 0.8 });
      case 'hatch':
        return this.want('ant.larva_hatch', e.x, e.y, e.space, { pool: 'work', gain: 0.7 });
      case 'egg': {
        if (e.colony !== me) return;
        const q = this.s.world.antById.get(this.s.player.queen);
        if (q) this.want('ant.queen_lay', q.x, q.y, q.space, { pool: 'work', gain: 0.8 });
        return;
      }
      case 'tileBuilt': {
        if (e.colony !== me || (e.kind !== 'build' && e.kind !== 'upgrade')) return;
        const g = this.s.world.nest(me);
        if (!g) return;
        const c = g.hexCenter(e.q);
        return this.want('ant.pellet_drop', c.x, c.y, nestSpace(me), { pool: 'work', gain: 0.9, reach: 2 });
      }
      case 'queenHurt':
        if (e.colony !== me || !this.every('queen', 4)) return;
        this.heat += 0.5;
        audio.duck(0.6, 1.4, 'ui');
        audio.play('ui.alert_queen');
        return;
      case 'invasion':
        if (e.colony !== me || !this.every('invasion', 6)) return;
        this.heat += 0.6;
        audio.duck(0.6, 1.4, 'ui');
        audio.play('ui.alert_invasion');
        return;
      case 'starving':
        if (e.colony !== me || !this.every('starving', 30)) return;
        audio.duck(0.3, 1, 'ui');
        audio.play('ui.alert_starving');
        return;
      case 'message':
        if (e.colony !== undefined && e.colony !== me) return;
        if (e.kind === 'narrator') {
          audio.duck(0.35, 4, 'narration');
          audio.play('narration.cue');
        } else if (e.kind === 'good' && this.every('good', 1.5)) audio.play('ui.message_good');
        else if (e.kind === 'warn' && this.every('warn', 1.5)) audio.play('ui.message_warn');
        return;
    }
  }

  /** A bite: whose jaws, on what (spec §4: insect-like, sized to the animal). */
  private bite(e: Extract<SimEvent, { t: 'bite' }>): void {
    const by = e.by ?? '';
    const kind = CREATURES[by];
    if (kind) {
      // a creature attacking: its own sound, scaled to its size (titans: the same, much bigger and lower)
      const fam = FAMILY[by];
      const rate = sizeRate(kind.length);
      const reach = kind.boss ? 3 : 1.5;
      const id =
        by === 'stagBeetle'
          ? 'cr.stag_clash'
          : fam === 'spider'
            ? Math.random() < 0.25
              ? 'cr.spider_pounce'
              : 'cr.spider_fangs'
            : fam === 'mantis'
              ? 'cr.mantis_strike'
              : fam === 'centipede'
                ? 'cr.centipede_bite'
                : by === 'antlion'
                  ? 'cr.antlion_flick'
                  : fam === 'soft'
                    ? 'combat.termite_bite'
                    : 'cr.beetle_bite';
      this.want(id, e.x, e.y, e.space, { pool: 'creature', gain: 0.9, rate, reach, heat: 0.12 });
      // the ant on the receiving end: a crunch or a tick
      if (Math.random() < 0.4) this.want(e.strength > 0.6 ? 'combat.chitin_crack' : 'combat.hit_tick', e.x, e.y, e.space, { pool: 'combat', gain: 0.6, heat: 0.03 });
      return;
    }
    const caste = CASTES[by];
    const rate = caste ? sizeRate(caste.length * 3) : 1;
    if (e.riding) {
      // riding a creature: bites straight into its back, louder and harder
      this.want('combat.mandible_snap', e.x, e.y, e.space, { pool: 'combat', gain: 1, rate, heat: 0.06 });
      if (Math.random() < 0.6) this.want('combat.chitin_crack', e.x, e.y, e.space, { pool: 'combat', gain: 0.75, heat: 0.03 });
      return;
    }
    if (e.on === 'ant' || e.on === 'creature') {
      const id = this.biteSound(by);
      const big = id !== 'combat.mandible_click' && id !== 'combat.termite_bite';
      this.want(id, e.x, e.y, e.space, { pool: 'combat', gain: big ? 0.9 : 0.75, rate, heat: 0.05 });
      if (big && id === 'combat.mandible_snap' && Math.random() < 0.3) this.want('combat.chitin_crack', e.x, e.y, e.space, { pool: 'combat', gain: 0.55, heat: 0.02 });
      return;
    }
    // termite workers (and Termant workers) chewing wood loose while foraging: quiet
    if (e.on === 'wood') return this.want('species.termite_chew', e.x, e.y, e.space, { pool: 'work', gain: 0.55, rate });
    if (e.on === 'leaf') return this.want('ant.leaf_cut', e.x, e.y, e.space, { pool: 'work', gain: 0.8 });
    if (e.on === 'seed') return this.want(caste?.role === 'major' ? 'ant.seed_crack' : 'ant.food_cut', e.x, e.y, e.space, { pool: 'work', gain: 0.8 });
    if (e.on === 'brood') return this.want('ant.egg_set', e.x, e.y, e.space, { pool: 'work', gain: 0.6 });
    return this.want('ant.food_cut', e.x, e.y, e.space, { pool: 'work', gain: 0.7 });
  }

  /** Which bite a caste makes on an animal. */
  private biteSound(by: string): string {
    const c = CASTES[by];
    if (!c) return 'combat.mandible_click';
    // termites: soft-bodied, a duller and wetter crunch; sickle-jaw soldiers' crossed blades snap
    if (c.termite === 'sickle') return 'species.sickle_snap';
    if (c.termite) return 'combat.termite_bite';
    // the Termant soldier's stolen Macrotermes jaws, fire ant and leafcutter majors: a crushing bite
    if ((c.species === 'termant' && c.role === 'soldier') || (c.role === 'major' && (c.species === 'solenopsis' || c.species === 'atta'))) {
      return c.species === 'atta' && Math.random() < 0.4 ? 'combat.scissor_cut' : 'combat.bite_crush';
    }
    // leafcutter soldiers shear
    if (c.species === 'atta' && c.role === 'soldier') return 'combat.scissor_cut';
    return c.role === 'major' || c.role === 'soldier' ? 'combat.mandible_snap' : 'combat.mandible_click';
  }

  // ---------------------------------------------------------------- what is visible

  /**
   * What the nearby ants are doing that has a sound but no sim event: picking up and setting down loads (and now and
   * then while carrying one), an antenna tap right up close (ants only: termites make no idle sounds); and the
   * counts the beds follow. Ants and termites make no walking sounds.
   */
  private scanAnts(): void {
    const s = this.s;
    const L = this.listener();
    const r2 = (L.ref * 1.4) ** 2;
    const near: Array<{ id: number; d: number }> = [];
    let grapple = 0;
    let busy = 0;
    let glue = 0;
    let glueRamp = 0;
    const now = audio.now;
    for (const a of s.world.s.ants) {
      if (a.space !== L.space || a.state === AS.Dead) continue;
      const dx = a.x - L.x;
      const dy = a.y - L.y;
      const d2 = dx * dx + dy * dy;
      if (a.colony === s.player.id && a.space !== SURFACE) busy++;
      if (d2 > r2) continue;
      if (a.state === AS.Grapple) grapple++;
      if ((a.fire ?? 0) > 0) {
        glue++;
        glueRamp = Math.max(glueRamp, rampFraction(a));
      }
      near.push({ id: a.id, d: d2 });
    }
    this.grappling = grapple;
    this.glue = glue;
    this.glueRamp = glueRamp;
    this.sickleVoices(L);
    this.activity = Math.min(1, busy / 120);
    this.crowd = L.ref < 170 ? Math.min(1, near.length / 60) : 0;
    if (L.ref >= 170) return;
    near.sort((a, b) => a.d - b.d);
    for (const n of near.slice(0, 16)) {
      const a = s.world.antById.get(n.id);
      if (!a) continue;
      const c = a.carry ?? Carry.None;
      const was = this.loads.get(a.id);
      if (!was) {
        this.loads.set(a.id, { c, next: now + 1 + Math.random() * 2, t: now });
        continue;
      }
      was.t = now;
      const caste = CASTES[a.caste];
      const rate = caste ? sizeRate(caste.length * 3) : 1;
      if (c !== was.c) {
        // picked up or set down: the mandibles closing on it, a soft tap as it goes down
        if (LOADS.has(c) && !LOADS.has(was.c)) this.want('ant.pick_up', a.x, a.y, a.space, { pool: 'work', gain: 0.7, rate });
        else if (LOADS.has(was.c) && !LOADS.has(c)) this.want('ant.put_down', a.x, a.y, a.space, { pool: 'work', gain: 0.7, rate });
        was.c = c;
        was.next = now + 1.2 + Math.random() * 1.5;
      } else if (LOADS.has(c) && now >= was.next) {
        // now and then while carrying: the load scraping or bumping along
        was.next = now + 1.5 + Math.random() * 2.5;
        this.want((caste?.carry ?? 0) >= 6 ? 'ant.drag_heavy' : 'ant.drag_small', a.x, a.y, a.space, { pool: 'work', gain: 0.55, rate });
      }
    }
    if (L.ref < 50 && near.length && this.every('antenna', 2.5)) {
      const a = s.world.antById.get(near[0].id);
      if (a && !CASTES[a.caste]?.termite) this.want('ant.antenna_tap', a.x, a.y, a.space, { pool: 'work', gain: 0.8 });
    }
    // forget ants not seen for a while
    if (this.loads.size > 600) for (const [id, w] of this.loads) if (now - w.t > 2) this.loads.delete(id);
  }

  /** Creatures walking by their gait; bosses shake the ground. */
  private scanCreatures(): void {
    const s = this.s;
    const L = this.listener();
    const now = audio.now;
    let bossNear = 0;
    let boss = 0;
    const e0 = s.player.entrances[0];
    for (const cr of s.world.s.creatures) {
      if (cr.dead) continue;
      const k = CREATURES[cr.kind];
      if (!k) continue;
      const here = cr.space === L.space;
      const d = Math.hypot(cr.x - L.x, cr.y - L.y);
      if (k.boss) {
        const near = here && d < L.ref * 4;
        const home = !!e0 && cr.space === SURFACE && Math.hypot(cr.x - e0.sx, cr.y - e0.sy) < 320;
        if (near || home || cr.hp < cr.maxHp) boss = 1;
        if (here) bossNear = Math.max(bossNear, Math.max(0, 1 - d / (L.ref * 4)));
        if (near && !this.seenBoss.has(cr.id)) {
          this.seenBoss.add(cr.id);
          audio.duck(0.4, 2.5, 'creatures');
          this.want('boss.arrive', cr.x, cr.y, cr.space, { pool: 'creature', gain: 1, reach: 6, heat: 0.3 });
        }
      }
      if (!here || d > L.ref * (k.boss ? 5 : 2.2)) continue;
      const w = this.walk.get(-cr.id);
      if (!w) {
        this.walk.set(-cr.id, { x: cr.x, y: cr.y, acc: 0, t: now });
        continue;
      }
      const step = Math.hypot(cr.x - w.x, cr.y - w.y);
      w.x = cr.x;
      w.y = cr.y;
      w.t = now;
      if (step > 0.02 && step < 80) w.acc += step;
      const fam = FAMILY[cr.kind] ?? 'beetle';
      const stride = k.length * (k.boss ? 0.45 : fam === 'centipede' ? 0.9 : 0.35);
      if (w.acc < stride) continue;
      w.acc = 0;
      const rate = sizeRate(k.length);
      if (k.boss) this.want('boss.footstep', cr.x, cr.y, cr.space, { pool: 'creature', gain: 0.9, rate: Math.min(1, rate * 1.8), reach: 4, heat: 0.03 });
      else if (fam === 'spider') this.want('cr.spider_step', cr.x, cr.y, cr.space, { pool: 'creature', gain: 0.7, rate });
      else if (fam === 'beetle') this.want(cr.kind === 'pillbug' && Math.random() < 0.05 ? 'cr.pillbug_roll' : 'cr.beetle_step', cr.x, cr.y, cr.space, { pool: 'creature', gain: 0.7, rate });
      else if (fam === 'centipede') this.want('cr.centipede_patter', cr.x, cr.y, cr.space, { pool: 'creature', gain: 0.8, rate });
      else if (fam === 'mantis' && Math.random() < 0.3) this.want('cr.mantis_sway', cr.x, cr.y, cr.space, { pool: 'creature', gain: 0.8, rate });
      else if (fam === 'soft') this.want('cr.caterpillar_crawl', cr.x, cr.y, cr.space, { pool: 'creature', gain: 0.7, rate });
    }
    this.boss = boss;
    this.bossNear = bossNear;
  }

  // ---------------------------------------------------------------- per frame

  update(): void {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!audio.ctx) return;
    const tick = this.s.world.s.tick;
    if (tick !== this.lastTick) {
      if (this.lastTick >= 0 && tick > this.lastTick && this.lastTickAt > 0) this.tickSec += (Math.min(0.25, (now - this.lastTickAt) / 1000 / (tick - this.lastTick)) - this.tickSec) * 0.2;
      this.lastTick = tick;
      this.lastTickAt = now;
    }
    const s = this.s;
    const v = s.view;
    const L = this.listener();
    const paused = s.loop.paused;
    this.scanT -= dt;
    if (!paused && this.scanT <= 0) {
      this.scanT = 0.05;
      this.scanAnts();
      this.scanCreatures();
    }
    this.mixer.flush(dt);
    const overflow = this.mixer.overflow;
    // beds: the scuffle of grappling ants, the battle past the voice limit
    const zoomNear = Math.min(1, 140 / L.ref);
    this.scuffle.level = paused ? 0 : Math.min(1, this.grappling / 12) * (0.4 + 0.6 * zoomNear);
    this.scuffle.density = 12 + Math.min(50, this.grappling * 2);
    this.scuffle.update();
    this.heat *= Math.exp(-dt / 5);
    this.battle.level = paused ? 0 : Math.min(1, overflow * 0.12 + Math.max(0, this.heat - 1) * 0.15);
    this.battle.density = 15 + Math.min(60, overflow * 6);
    this.battle.update();
    this.bossRumble.set(paused ? 0 : this.bossNear, 1.5);
    this.glueBed.set(paused || !this.glue ? 0 : Math.min(1, 0.35 + Math.sqrt(this.glue) * 0.2) * (0.4 + 0.6 * zoomNear), 0.25, 2500 + 10000 * this.glueRamp);
    // where we are
    const target = v.space === 'surface' ? 1 : 0;
    this.surfaceMix += (target - this.surfaceMix) * (1 - Math.exp(-dt / 0.5));
    this.ambience.update({ style: this.style, surface: this.surfaceMix, night: s.world.s.night ?? 0, zoom: Math.max(0, Math.min(1, (L.ref - 40) / 500)), rain: this.rain, activity: this.activity, crowd: paused ? 0 : this.crowd });
    this.music.update(dt, Math.max(this.moodFloor, 1 - Math.exp(-this.heat * 0.8)), Math.max(this.boss, this.moodBoss));
  }

  /**
   * Sickle-Jaw holds close to the listener (the nearest three): the acid smeared on the victim fizzing, faster as the
   * hold's ramp climbs, and the victim's struggle (legs scrabbling, its stridulation) while it lives.
   */
  private holds = new Map<number, { acid: number; struggle: number }>();
  private sickleVoices(L: { x: number; y: number; ref: number; space: number }): void {
    const w = this.s.world;
    const holds: Array<{ a: (typeof w.s.ants)[number]; d: number }> = [];
    const r2 = (L.ref * 1.1) ** 2;
    if (!this.s.loop.paused && L.ref < 220)
      for (const a of w.s.ants) {
        if (a.state !== AS.Hold || a.space !== L.space || !isSickle(a)) continue;
        const d = (a.x - L.x) ** 2 + (a.y - L.y) ** 2;
        if (d <= r2) holds.push({ a, d });
      }
    holds.sort((p, q) => p.d - q.d);
    const now = audio.now;
    const keep = new Map<number, { acid: number; struggle: number }>();
    for (const { a } of holds.slice(0, 3)) {
      const st = this.holds.get(a.id) ?? { acid: now + 0.15, struggle: now + 0.3 };
      const ramp = sickleRampFraction(a);
      const v = w.antById.get(a.holdId ?? 0);
      if (now >= st.acid) {
        st.acid = now + (0.55 - 0.3 * ramp) * (0.8 + Math.random() * 0.4);
        this.want('species.sickle_acid', a.x, a.y, a.space, { pool: 'combat', gain: 0.35 + 0.45 * ramp, rate: 0.95 + 0.15 * ramp });
      }
      if (v && v.state !== AS.Dead && now >= st.struggle) {
        st.struggle = now + 0.45 + Math.random() * 0.4;
        this.want('combat.struggle', v.x, v.y, v.space, { pool: 'combat', gain: 0.3 + 0.4 * Math.min(1, v.hp / Math.max(1, v.maxHp)) });
      }
      keep.set(a.id, st);
    }
    this.holds = keep;
  }

  /** The end of a game: an acoustic flourish. */
  stinger(win: boolean): void {
    audio.duck(0.6, 4, 'music');
    audio.play(win ? 'music.victory' : 'music.defeat');
  }

  /** For tests and the debug overlay. */
  get state(): { ctx: string; heat: number; overflow: number; boss: number; crowd: number; grappling: number; voices: number; played: number; dropped: number; memoryMB: number } {
    return { ctx: audio.ctx?.state ?? 'none', heat: this.heat, overflow: this.mixer.overflow, boss: this.boss, crowd: this.crowd, grappling: this.grappling, voices: audio.playing(), played: this.mixer.played, dropped: this.mixer.dropped, memoryMB: audio.bank.bytes() / 1048576 };
  }
}

/** Playback rate for a body of `length` mm: bigger is slower and lower (relative to a ~12 mm creature). */
export function sizeRate(length: number): number {
  return Math.max(0.42, Math.min(1.35, Math.pow(12 / Math.max(1, length), 0.3)));
}
