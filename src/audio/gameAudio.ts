import * as THREE from 'three';
import type { GameSession } from '../game/session';
import type { SimEvent } from '../core/events';
import { AS, Carry, SURFACE, nestSpace } from '../sim/types';
import { CASTES } from '../sim/species';
import { CREATURES } from '../sim/creatures/kinds';
import { rampFraction } from '../sim/termites';
import { isSickle, sickleRampFraction } from '../sim/sickleJaws';
import { SickleJawAudio } from '../render/termite/audio';
import { animHooks } from '../render/ants/antRenderer';
import { ANIM_SFX } from '../render/ants/antMotion';
import type { MapStyle } from '../world/terrain';
import { audio } from './engine';
import { GrainBed, LoopBed } from './beds';
import { Ambience } from './ambience';
import { Music } from './music';
import { Mixer, Pool } from './mixer';

/**
 * The game's sound, driven by the session (Phase 14 audio).
 *
 * - **Where:** a sound is placed where it happens. Loudness falls off with
 *   distance from the point the camera looks at, relative to the zoom, so
 *   zooming in brings sounds closer; stereo follows the screen. Only the
 *   place on screen is heard (the surface, or the one underground area in
 *   view); important events elsewhere (a slam, your ants dying in another
 *   area) come through muffled and quiet.
 * - **How many:** each frame's sound requests are sorted by loudness
 *   within their pool and only the loudest play (8 footsteps, 16 combat
 *   sounds, 10 creature sounds…). The rest feed the beds: the swarm rustle
 *   follows the moving ants in view, and the battle bed thickens with a fight
 *   too big for single voices. A 400-ant battle stays dense, readable and
 *   within budget.
 * - **What:** simulation events (bites, stings, acid, deaths, digging,
 *   hatching, bosses' wind-ups and slams) and what is visible (footsteps of
 *   the nearest ants by ground type, ants dragging food, creatures walking
 *   by their gait, a boss's footfalls).
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

const hash = (x: number, y: number) => {
  let h = Math.imul(Math.floor(x) * 374761393 + Math.floor(y) * 668265263, 1274126177);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000;
};

export class GameAudio {
  private ambience = new Ambience();
  private music = new Music();
  private swarm = new GrainBed('ant.swarm_bed');
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
  private bossNear = 0;
  private surfaceMix = 1;
  private last = performance.now();
  private right = new THREE.Vector3();
  /** walked distance since the last step, per ant / creature */
  private walk = new Map<number, { x: number; y: number; acc: number; t: number }>();
  private seenBoss = new Set<number>();
  private lastSay = new Map<string, number>();
  private moving = 0;
  private grappling = 0;
  private scanT = 0;
  private activity = 0;
  /** sandbox / future weather: 0 dry … 1 heavy rain */
  rain = 0;

  constructor(private s: GameSession) {
    s.events.onAny((e) => this.event(e));
    // the ant animation's own moments (spec 04; the sim's bites, stings and deaths have their sounds already)
    animHooks.emit = (k, x, y, space, cause) => this.anim(k, x, y, space, cause);
  }

  /** Render-side sound hooks (render/ants/antMotion.ts ANIM_SFX): a grip, a crunch, a landing on the back, righting, a death's own sound. */
  private anim(k: number, x: number, y: number, space: number, cause: number): void {
    if (!audio.ctx) return;
    if (k === ANIM_SFX.GRIP) return this.want('combat.grapple_scuffle', x, y, space, { pool: 'combat', gain: 0.45, rate: 1.4 });
    if (k === ANIM_SFX.CRUNCH) return this.want('combat.chitin_crack', x, y, space, { pool: 'combat', gain: 0.55, rate: 0.85 });
    if (k === ANIM_SFX.FLIP || k === ANIM_SFX.RIGHT) return this.want('ant.pellet_drop', x, y, space, { pool: 'work', gain: k === ANIM_SFX.FLIP ? 0.6 : 0.4, rate: 1.3 });
    if (k === ANIM_SFX.DEATH) {
      if (cause === 3) return this.want('combat.acid_splat', x, y, space, { pool: 'combat', gain: 0.4, rate: 1.2 });
      if (cause === 4 || cause === 8) return this.want('combat.chitin_crack', x, y, space, { pool: 'combat', gain: 0.8, rate: 0.75 });
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
    this.mixer.push({ id, prio: gain, gain: Math.min(1.2, gain), pan, rate: o.rate ?? 1, pool: o.pool, muffle, wet: this.s.view.space === 'nest' ? 0.15 : 0 });
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
    if (!audio.ctx) return;
    const me = this.s.player.id;
    switch (e.t) {
      case 'dig':
        this.want('ant.dig_bite', e.x, e.y, nestSpace(e.colony), { pool: 'work', gain: 0.8 });
        if (Math.random() < 0.3) this.want('ant.soil_grains', e.x, e.y, nestSpace(e.colony), { pool: 'work', gain: 0.6 });
        return;
      case 'spoil':
        return this.want('ant.pellet_drop', e.x, e.y, e.space, { pool: 'work', gain: 0.7 });
      case 'bite':
        return this.bite(e);
      case 'sting': {
        const fire = !!e.by && CASTES[e.by]?.species === 'solenopsis';
        return this.want(fire ? 'combat.sting_fire' : 'combat.sting', e.x, e.y, e.space, { pool: 'combat', gain: 0.8, heat: 0.05 });
      }
      case 'acid':
        return this.want('combat.acid_spray', e.x, e.y, e.space, { pool: 'combat', gain: e.lob ? 0.9 : 0.75, heat: 0.04 });
      case 'acidHit':
        return this.want('combat.acid_splat', e.x, e.y, e.space, { pool: 'combat', gain: 0.8, heat: 0.03 });
      case 'splash':
        return this.want('combat.acid_splat', e.x, e.y, e.space, { pool: 'combat', gain: 0.5 });
      case 'hit':
        return this.want('combat.chitin_crack', e.x, e.y, e.space, { pool: 'combat', gain: e.big ? 1 : 0.7, heat: 0.05 });
      case 'death': {
        if (e.kind === 'creature') {
          const k = e.what ? CREATURES[e.what] : undefined;
          return this.want('cr.creature_death', e.x, e.y, e.space, { pool: 'creature', gain: 1, rate: k ? sizeRate(k.length) : 1, reach: k?.boss ? 3 : 1.5, important: !!k?.boss, heat: 0.25 });
        }
        if (e.colony === me) this.heat += 0.08;
        return this.want('combat.ant_death', e.x, e.y, e.space, { pool: 'combat', gain: 0.85, heat: 0.08, important: e.colony === me && this.every('offdeath', 0.6) });
      }
      case 'alarm':
        if (this.every('alarm' + e.space, 0.35)) this.want('ant.stridulate', e.x, e.y, e.space, { pool: 'work', gain: 0.7, heat: 0.02 });
        return;
      case 'fling':
        return this.want('combat.fling', e.x, e.y, e.space, { pool: 'combat', gain: 0.9, reach: 1.4, heat: 0.1 });
      case 'climb':
        // getting onto a creature's leg: a scuffle of claws; dropping off a dying one: a soft thud and a tumble
        if (e.phase === 'up') return this.want('combat.grapple_scuffle', e.x, e.y, e.space, { pool: 'combat', gain: 0.6, rate: 1.2, heat: 0.03 });
        if (e.phase === 'drop') {
          this.want('ant.pellet_drop', e.x, e.y, e.space, { pool: 'work', gain: 0.85, rate: 0.75 });
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
        // hell ant: a sharp woody crack; an impale adds the wet impact
        this.want('species.hellant_snap', e.x, e.y, e.space, { pool: 'combat', gain: 0.9, heat: 0.06 });
        if (e.impale) this.want('species.hellant_impale', e.x, e.y, e.space, { pool: 'combat', gain: 0.8, heat: 0.04 });
        else if (Math.random() < 0.5) this.want('species.hellant_struggle', e.x, e.y, e.space, { pool: 'combat', gain: 0.6 });
        return;
      case 'surge':
        // Saiy-Ant gold surge (one shimmer per moment, however many ants flash; a crackle each)
        if (this.every('surge' + e.space, 0.6)) this.want('species.saiyant_surge', e.x, e.y, e.space, { pool: 'combat', gain: 0.8, heat: 0.1 });
        else this.want('species.saiyant_crackle', e.x, e.y, e.space, { pool: 'combat', gain: 0.55 });
        return;
      case 'glueBurst':
        return this.want('combat.acid_splat', e.x, e.y, e.space, { pool: 'combat', gain: 0.7, rate: 0.75, heat: 0.03 });
      case 'grab':
        // a sickle-jaw hooks its victim: the mandibles snap shut, then it struggles
        this.want('species.hellant_snap', e.x, e.y, e.space, { pool: 'combat', gain: 0.75, rate: 1.25, heat: 0.06 });
        if (Math.random() < 0.6) this.want('species.hellant_struggle', e.x, e.y, e.space, { pool: 'combat', gain: 0.55 });
        return;
      case 'hook':
        // army-ant Soldier: the ice-tong hooks clack shut
        return this.want('combat.mandible_click', e.x, e.y, e.space, { pool: 'combat', gain: 0.9, rate: 0.8, heat: 0.04 });
      case 'pin':
        if (this.every('pin' + e.space, 0.5)) this.want('species.hellant_struggle', e.x, e.y, e.space, { pool: 'combat', gain: 0.55, rate: 1.15 });
        return;
      case 'link':
        // a living-bridge link hooks its claws on: a dry rustle
        return this.want('combat.grapple_scuffle', e.x, e.y, e.space, { pool: 'work', gain: 0.4, rate: 1.45 });
      case 'grabMiss':
        return this.want('combat.mandible_click', e.x, e.y, e.space, { pool: 'combat', gain: 0.7, rate: 1.2 });
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

  /** A bite: whose jaws, on what. */
  private bite(e: Extract<SimEvent, { t: 'bite' }>): void {
    const by = e.by ?? '';
    const kind = CREATURES[by];
    if (kind) {
      // a creature attacking: its own sound, scaled to its size
      const fam = FAMILY[by];
      const rate = sizeRate(kind.length);
      const reach = kind.boss ? 3 : 1.5;
      const id = by === 'stagBeetle' ? 'cr.stag_clash' : fam === 'spider' ? (Math.random() < 0.25 ? 'cr.spider_pounce' : 'cr.spider_fangs') : fam === 'mantis' ? 'cr.mantis_strike' : by === 'antlion' ? 'cr.antlion_flick' : 'combat.mandible_snap';
      this.want(id, e.x, e.y, e.space, { pool: 'creature', gain: 0.9, rate, reach, heat: 0.12 });
      if (Math.random() < 0.4) this.want('combat.chitin_crack', e.x, e.y, e.space, { pool: 'combat', gain: 0.6, heat: 0.03 });
      return;
    }
    const caste = CASTES[by];
    if (e.riding) {
      // riding a creature: bites straight into its back, louder and harder
      this.want('combat.mandible_snap', e.x, e.y, e.space, { pool: 'combat', gain: 1, rate: caste ? sizeRate(caste.length * 3) : 1, heat: 0.06 });
      if (Math.random() < 0.6) this.want('combat.chitin_crack', e.x, e.y, e.space, { pool: 'combat', gain: 0.75, heat: 0.03 });
      return;
    }
    if (e.on === 'ant' || e.on === 'creature') {
      const big = !!caste && (caste.role === 'major' || caste.role === 'soldier' || e.strength > 0.9);
      this.want(big ? 'combat.mandible_snap' : 'combat.mandible_click', e.x, e.y, e.space, { pool: 'combat', gain: big ? 0.9 : 0.75, rate: caste ? sizeRate(caste.length * 3) : 1, heat: 0.05 });
      if (big && Math.random() < 0.35) this.want('combat.chitin_crack', e.x, e.y, e.space, { pool: 'combat', gain: 0.6, heat: 0.02 });
      return;
    }
    if (e.on === 'leaf') return this.want('ant.leaf_cut', e.x, e.y, e.space, { pool: 'work', gain: 0.8 });
    if (e.on === 'seed') return this.want(caste?.role === 'major' ? 'ant.seed_crack' : 'ant.food_cut', e.x, e.y, e.space, { pool: 'work', gain: 0.8 });
    if (e.on === 'brood') return this.want('ant.egg_set', e.x, e.y, e.space, { pool: 'work', gain: 0.6 });
    return this.want('ant.food_cut', e.x, e.y, e.space, { pool: 'work', gain: 0.7 });
  }

  // ---------------------------------------------------------------- what is visible

  /** Ground under (x, y): the map's mix of soil, litter, bark, stone and sand (stable per patch). */
  private ground(x: number, y: number, space: number): string {
    const st = this.style;
    if (st === 'formicarium') return 'ant.step_stone';
    if (space !== SURFACE) return 'ant.step_soil';
    const h = hash(x / 18, y / 18);
    if (st === 'sandy') return h < 0.8 ? 'ant.step_sand' : 'ant.step_stone';
    if (st === 'forest') return h < 0.55 ? 'ant.step_leaf' : h < 0.7 ? 'ant.step_bark' : 'ant.step_soil';
    if (st === 'riverbank') return h < 0.4 ? 'ant.step_stone' : h < 0.55 ? 'ant.step_sand' : 'ant.step_soil';
    return h < 0.25 ? 'ant.step_leaf' : 'ant.step_soil';
  }

  /** Footsteps of the nearest ants, carrying sounds, antennae, and the counts the beds follow. */
  private scanAnts(dt: number): void {
    const s = this.s;
    const L = this.listener();
    const near: Array<{ id: number; d: number }> = [];
    const r2 = (L.ref * 1.4) ** 2;
    let moving = 0;
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
      const w = this.walk.get(a.id);
      if (!w) {
        this.walk.set(a.id, { x: a.x, y: a.y, acc: 0, t: now });
        continue;
      }
      const step = Math.hypot(a.x - w.x, a.y - w.y);
      w.x = a.x;
      w.y = a.y;
      w.t = now;
      if (step > 0.02 && step < 30) {
        moving++;
        w.acc += step;
        near.push({ id: a.id, d: d2 });
      }
    }
    this.moving = moving;
    this.grappling = grapple;
    this.glue = glue;
    this.glueRamp = glueRamp;
    this.sickleVoices(L);
    this.activity = Math.min(1, busy / 120);
    // individual footsteps only close up, for the nearest few
    if (L.ref < 170) {
      near.sort((a, b) => a.d - b.d);
      for (const n of near.slice(0, 12)) {
        const a = s.world.antById.get(n.id);
        const w = this.walk.get(n.id);
        if (!a || !w) continue;
        const caste = CASTES[a.caste];
        const queen = caste?.role === 'queen';
        // up or down a creature's leg: claws scrabbling on chitin, quicker and sharper than walking
        const climbing = a.state === AS.Climb && (a.ridePh === 1 || a.ridePh === 3);
        // army ants: a quicker, lighter skitter (high-stepping, fast)
        const army = caste?.species === 'eciton' && !queen;
        const stride = (caste?.length ?? 4) * (queen ? 0.4 : climbing ? 0.25 : army ? 0.38 : 0.55);
        if (w.acc < stride) continue;
        w.acc = 0;
        if (climbing) {
          this.want('ant.step_stone', a.x, a.y, a.space, { pool: 'steps', gain: 0.85, rate: (caste ? sizeRate(caste.length * 2.5) : 1) * 1.25 });
          if (Math.random() < 0.15) this.want('combat.grapple_scuffle', a.x, a.y, a.space, { pool: 'combat', gain: 0.45, rate: 1.3 });
          continue;
        }
        if (caste?.species === 'termant' && !queen) {
          // Termants: a dry ant skitter with a soft-bodied, papery shuffle under it now and then
          this.want(this.ground(a.x, a.y, a.space), a.x, a.y, a.space, { pool: 'steps', gain: 0.5, rate: sizeRate(caste.length * 2.5) * 1.05 });
          if (Math.random() < 0.35) this.want('species.nasute_move', a.x, a.y, a.space, { pool: 'steps', gain: 0.32, rate: sizeRate(caste.length * 2.5) * 0.9 });
          continue;
        }
        if (caste?.species === 'nasutitermes' && !queen) {
          // termites: soft, papery steps
          this.want('species.nasute_move', a.x, a.y, a.space, { pool: 'steps', gain: 0.5, rate: sizeRate(caste.length * 2.5) });
          continue;
        }
        this.want(queen ? 'ant.step_queen' : this.ground(a.x, a.y, a.space), a.x, a.y, a.space, { pool: 'steps', gain: queen ? 0.9 : army ? 0.45 : 0.55, rate: (caste ? sizeRate(caste.length * 2.5) : 1) * (army ? 1.2 : 1) });
        if ((a.carry === Carry.Food || a.carry === Carry.Leaf || a.carry === Carry.Corpse) && Math.random() < 0.18) this.want((CASTES[a.caste]?.carry ?? 0) >= 6 ? 'ant.drag_heavy' : 'ant.drag_small', a.x, a.y, a.space, { pool: 'work', gain: 0.6 });
      }
      if (L.ref < 50 && near.length && this.every('antenna', 2.5)) {
        const a = s.world.antById.get(near[0].id);
        if (a) this.want('ant.antenna_tap', a.x, a.y, a.space, { pool: 'work', gain: 0.8 });
      }
    }
    // forget ants not seen for a while
    if (this.walk.size > 3000) for (const [id, w] of this.walk) if (now - w.t > 2) this.walk.delete(id);
    void dt;
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
    const s = this.s;
    const v = s.view;
    const L = this.listener();
    const paused = s.loop.paused;
    this.scanT -= dt;
    if (!paused && this.scanT <= 0) {
      this.scanT = 0.05;
      this.scanAnts(dt);
      this.scanCreatures();
    }
    this.mixer.flush(dt);
    const overflow = this.mixer.overflow;
    // beds: the swarm, the scuffle of grappling ants, the battle past the voice limit
    const zoomNear = Math.min(1, 140 / L.ref);
    this.swarm.level = paused ? 0 : Math.min(1, Math.sqrt(this.moving) / 16) * (0.35 + 0.65 * zoomNear);
    this.swarm.density = 10 + Math.min(70, this.moving * 0.8);
    this.swarm.bright = 5000 + 9000 * zoomNear;
    this.swarm.update();
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
    this.ambience.update({ style: this.style, surface: this.surfaceMix, night: s.world.s.night ?? 0, zoom: Math.max(0, Math.min(1, (L.ref - 40) / 500)), rain: this.rain, activity: this.activity });
    this.music.update(dt, 1 - Math.exp(-this.heat * 0.8), this.boss);
  }

  /**
   * Sickle-Jaw holds close to the listener (the model kit's procedural voices, SickleJawAudio): the wet acid
   * stream pulsing faster with the ramp, the fizz on the victim and its scrabbling legs. The nearest three.
   */
  private sj: SickleJawAudio | null = null;
  private sjOn = new Set<number>();
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
    const keep = new Set<number>();
    if (holds.length && !this.sj && audio.ctx) this.sj = new SickleJawAudio(audio.ctx, audio.input('combat'), 0.5);
    for (const { a } of holds.slice(0, 3)) {
      const ramp = sickleRampFraction(a);
      const v = w.antById.get(a.holdId ?? 0);
      this.sj!.acidStream(a.id, ramp, true);
      this.sj!.acidFizz(a.id, ramp);
      this.sj!.victimStruggle(a.id, v && v.state !== AS.Dead ? 0.35 + 0.65 * Math.min(1, v.hp / Math.max(1, v.maxHp)) : 0);
      keep.add(a.id);
    }
    for (const id of this.sjOn)
      if (!keep.has(id)) {
        this.sj?.acidStream(id, 0, false);
        this.sj?.acidFizz(id, 0);
        this.sj?.victimStruggle(id, 0);
      }
    this.sjOn = keep;
  }

  /** The end of a game: an acoustic flourish. */
  stinger(win: boolean): void {
    audio.duck(0.6, 4, 'music');
    audio.play(win ? 'music.victory' : 'music.defeat');
  }

  /** For tests and the debug overlay. */
  get state(): { ctx: string; heat: number; overflow: number; boss: number; moving: number; grappling: number; voices: number; played: number; dropped: number; memoryMB: number } {
    return { ctx: audio.ctx?.state ?? 'none', heat: this.heat, overflow: this.mixer.overflow, boss: this.boss, moving: this.moving, grappling: this.grappling, voices: audio.playing(), played: this.mixer.played, dropped: this.mixer.dropped, memoryMB: audio.bank.bytes() / 1048576 };
  }
}

/** Playback rate for a body of `length` mm: bigger is slower and lower (relative to a ~12 mm creature). */
export function sizeRate(length: number): number {
  return Math.max(0.42, Math.min(1.35, Math.pow(12 / Math.max(1, length), 0.3)));
}
