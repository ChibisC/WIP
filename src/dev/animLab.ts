import * as THREE from 'three';
import { setBakeRenderer } from '../render/bake/detailBake';
import { AntRenderer, AntView } from '../render/ants/antRenderer';
import { animSettings } from '../render/ants/antMotion';
import { ATTACK_CONTACT } from '../render/ants/attackPoses';
import { POSE } from '../render/ants/antMaterial';
import { CreatureRenderer } from '../render/creatures/creatureRenderer';
import { CombatFx } from '../render/game/combatFx';
import { PostPipeline } from '../render/post';
import { createSurfaceEnvironment } from '../render/environment';
import { textures } from '../render/textures';
import { globalUniforms } from '../render/shaderPatch';
import { applyLabLight } from './labLight';
import { blankView } from '../game/antViews';
import { CREATURES } from '../sim/creatures/kinds';
import { STAG } from '../sim/balance';
import type { Creature } from '../sim/types';
import type { SimEvent } from '../core/events';

/**
 * Animation lab (animation pass, docs/realism/animation.md): scripted clips through the game's own ant and
 * creature renderers, stepped at a fixed frame rate over a 20 Hz "sim" (positions and headings arrive per
 * tick and are interpolated exactly as in the game), for frame strips and clips:
 *
 *   ?scene=animlab&clip=walk&anim=2&light=overcast
 *
 * `anim=1` shows the old motion (before/after). The page exposes `__anim.step(n)` (render n frames) and
 * `__anim.t` for tests/browser/anim_clips.py.
 */

const TICK = 0.05;
const FIRE = 'fire_minor';
const STAG_L = CREATURES.stagBeetle?.length ?? 100;

type AntScript = (t: number, v: AntView) => void;
interface Actor {
  id: number;
  morph: string;
  script: AntScript;
  /** sim-side values at the previous and current tick */
  cur: AntView;
  prev: { x: number; y: number; h: number };
}
type CrScript = (t: number, c: Creature) => void;

interface Clip {
  dur: number;
  ants: Array<{ morph?: string; script: AntScript }>;
  stag?: CrScript;
  /** camera: target (x, y, z mm), direction and distance; `follow` an actor index (its position, smoothed) */
  cam: { tx: number; ty: number; tz: number; dir: [number, number, number]; dist: number; follow?: number; fov?: number };
  /** events at times (slam dust, bites) */
  events?: Array<{ t: number; e: SimEvent; shake?: number; hitStop?: number }>;
}

const sm = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** A walk along a path of segments (straight runs, arcs, stops, turns in place) at the sim's speed. */
function pathWalker(x0: number, y0: number, h0: number, segs: Array<{ d: number; v?: number; turn?: number }>): AntScript {
  // precompute states at fine steps
  const st: Array<{ t: number; x: number; y: number; h: number; v: number }> = [];
  let x = x0;
  let y = y0;
  let h = h0;
  let t = 0;
  st.push({ t, x, y, h, v: 0 });
  for (const s of segs) {
    const n = Math.max(1, Math.round(s.d / 0.005));
    for (let i = 0; i < n; i++) {
      const dt = s.d / n;
      const v = s.v ?? 0;
      h += (s.turn ?? 0) * dt;
      x += Math.cos(h) * v * dt;
      y += Math.sin(h) * v * dt;
      t += dt;
      st.push({ t, x, y, h, v });
    }
  }
  return (tt, out) => {
    let i = Math.min(st.length - 1, Math.max(0, Math.round(tt / 0.005)));
    while (i > 0 && st[i].t > tt) i--;
    const s = st[i];
    out.x = s.x;
    out.y = s.y;
    out.heading = s.h;
  };
}

function standing(x: number, y: number, h: number): AntScript {
  return (_t, v) => {
    v.x = x;
    v.y = y;
    v.heading = h;
  };
}

/** A biting attacker (as game/antViews.ts meleeAttack): the cycle's phase from the cooldown, the variant per cycle. */
/** bites landed this tick (where the jaws are), for the combat effects — as the sim's 'bite' events in the game */
const biteFx: Array<{ x: number; y: number }> = []; // det-ok: dev lab only
function attacker(x: number, y: number, h: number, variant: number, gap: number, t0: number, onBite?: (t: number) => void): AntScript {
  let lastCycle = -1;
  return (t, v) => {
    v.x = x;
    v.y = y;
    v.heading = h;
    v.mandible = 0.95;
    v.antennaPitch = 0.6;
    v.antennaActivity = 1;
    v.gaster = 0.2;
    v.headPitch = -0.15;
    if (t < t0) return;
    const p = ((t - t0) / gap) % 1;
    const cyc = Math.floor((t - t0) / gap);
    if (cyc !== lastCycle) {
      lastCycle = cyc;
      if (cyc > 0) {
        onBite?.(t);
        biteFx.push({ x: x + Math.cos(h) * 1.3, y: y + Math.sin(h) * 1.3 });
      }
    }
    v.atk = (p + ATTACK_CONTACT) % 1;
    v.atkVar = variant;
    v.atkSide = cyc & 1 ? 1 : -1;
    v.atkGap = gap;
    v.atkN = Math.max(0, cyc);
  };
}

function clips(): Record<string, Clip> {
  const R = 2.8;
  // the target in the attack clip loses hit points at every bite
  const tgt = { hp: 100 };
  const bite = () => {
    tgt.hp -= 3;
  };
  const C: Record<string, Clip> = {
    // a worker walks, curves, stops, turns in place and stands (idles begin)
    walk: {
      dur: 8,
      ants: [{ script: pathWalker(-14, 0, 0, [{ d: 1.4, v: 15 }, { d: 1.4, v: 12, turn: 1.4 }, { d: 0.4, v: 5 }, { d: 0.3, v: 0 }, { d: 1.3, turn: 2.4 }, { d: 3.2 }]) }],
      cam: { tx: 0, ty: 0.4, tz: 0, dir: [0.15, 0.6, 1], dist: 11, follow: 0, fov: 30 },
    },
    // turning in place both ways
    turn: {
      dur: 5,
      ants: [{ script: pathWalker(0, 0, 0, [{ d: 0.5 }, { d: 1.2, turn: 2.6 }, { d: 0.5 }, { d: 1.2, turn: -2.6 }, { d: 1.6 }]) }],
      cam: { tx: 0, ty: 0.3, tz: 0, dir: [0.2, 1, 0.5], dist: 9, fov: 30 },
    },
    // a hundred workers idling side by side
    idle100: {
      dur: 9,
      ants: Array.from({ length: 100 }, (_, i) => ({ script: standing(((i % 10) - 4.5) * 3.9, (Math.floor(i / 10) - 4.5) * 3.9, (i * 2.399) % 6.283) })),
      cam: { tx: 0, ty: 0, tz: 0, dir: [0.25, 1, 0.55], dist: 60, fov: 30 },
    },
    // three attackers round a worker: lunge bite, grip-and-sting, side clamp; the target flinches and flashes
    attack: {
      dur: 6,
      ants: [
        {
          script: (t, v) => {
            v.x = 0;
            v.y = 0;
            v.heading = 0.4;
            v.hp = tgt.hp;
            v.antennaActivity = 1;
            v.antennaPitch = 0.6;
            v.mandible = 0.6;
          },
        },
        { script: attacker(R * 0.95, 0, Math.PI, 0, 0.8, 0.3, bite) },
        { script: attacker(-R * 0.6, R * 0.75, -0.9, 1, 0.8, 0.5, bite) },
        { script: attacker(-R * 0.6, -R * 0.75, 0.9, 2, 0.8, 0.7, bite) },
      ],
      cam: { tx: 0, ty: 0.3, tz: 0, dir: [0.3, 0.85, 0.6], dist: 11, fov: 30 },
    },
    // two workers walk and die (onto the back / the side)
    death: {
      dur: 4,
      ants: [0, 1].map((k) => ({
        script: (t: number, v: AntView) => {
          const tt = Math.min(t, 1 + k * 0.3);
          v.x = -8 + 12 * tt;
          v.y = (k - 0.5) * 6;
          v.heading = 0;
          v.dead = t > 1 + k * 0.3;
        },
      })),
      cam: { tx: 5, ty: 0.3, tz: 0, dir: [0.2, 1, 0.75], dist: 17, fov: 30 },
    },
    // spec 04: a death for each cause (sim HIT.*: bite, venom, acid, crush, fall, drown, starve, decapitation), each
    // corpse drying and then sinking into the ground as in the game (BALANCE.corpse: 0.5 s + 2 s, then 0.6 s down)
    deaths: {
      dur: 5,
      ants: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({
        script: (t: number, v: AntView) => {
          const td = 0.8 + (k % 4) * 0.12 + (k >> 2) * 0.06;
          const tt = Math.min(t, td);
          v.x = -10 + (k % 4) * 6 + 3 * tt;
          v.y = (k >> 2) * 6 - 3;
          v.heading = 0;
          v.dead = t > td;
          v.cause = k + 1;
          const age = t - td - 0.5;
          v.dry = v.dead ? Math.max(0, Math.min(1, age / 2)) : 0;
          v.lift = age > 2 ? -Math.min(1, (age - 2) / 0.6) * 3.5 : 0;
        },
      })),
      cam: { tx: 0.3, ty: 0.3, tz: 0, dir: [0.15, 1, 0.75], dist: 28, fov: 30 },
    },
    // a worker thrown through the air: it tumbles, lands with a bounce and rights itself, then walks on
    fling: {
      dur: 4,
      ants: [
        {
          script: (t, v) => {
            const a = 0.6;
            const b = 1.5;
            const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
            v.x = -10 + (t < a ? 0 : t < b ? 16 * u : 16 + Math.min(1.5, t - b) * 6);
            v.y = 0;
            v.heading = 0;
            v.lift = t > a && t < b ? 9 * Math.sin(Math.PI * u) : 0;
            v.flung = t > a && t < b;
          },
        },
      ],
      cam: { tx: 0, ty: 2, tz: 0, dir: [0.1, 0.35, 1], dist: 20, follow: 0, fov: 30 },
    },
    // carrying (head up), digging, alarm (gaster raised, jaws open)
    poses: {
      dur: 5,
      ants: [
        {
          script: (t, v) => {
            pathWalker(-2, -5, 0, [{ d: 6, v: 6, turn: 1.1 }])(t, v);
            v.carrying = true;
            v.mandible = 0.35;
          },
        },
        {
          script: (t, v) => {
            standing(-2, 0.6, 0.3)(t, v); // inside the walker's circle, clear of it
            v.pose = POSE.DIG;
            v.mandible = 0.4 + Math.max(0, Math.sin(t * 16)) * 0.55;
            v.headPitch = -0.4;
            v.antennaPitch = -0.4;
          },
        },
        {
          script: (t, v) => {
            standing(6.5, 2.5, 2.6)(t, v); // outside it, still in frame
            v.pose = POSE.ALARM;
            v.mandible = 0.8;
            v.antennaPitch = 0.7;
            v.antennaActivity = 1;
            v.gaster = 0.2;
          },
        },
      ],
      cam: { tx: 1, ty: 0.3, tz: 0, dir: [0.35, 0.8, 1], dist: 17, fov: 30 },
    },
  };
  // one attacker at a time, side on (for naming the attacks): 0 lunge bite, 1 grip and sting, 2 side clamp and tug
  for (const k of [0, 1, 2]) {
    C[`atk${k}`] = {
      dur: 3.2,
      ants: [
        {
          script: (_t, v) => {
            v.x = R * 0.55;
            v.y = R * 0.15;
            v.heading = Math.PI * 0.8;
            v.hp = tgt.hp;
            v.antennaActivity = 1;
            v.antennaPitch = 0.6;
            v.mandible = 0.6;
          },
        },
        { script: attacker(-R * 0.62, 0, 0, k, 0.8, 0.2, bite) },
      ],
      cam: { tx: 0, ty: 0.4, tz: 0, dir: [0.15, 0.35, 1], dist: 9, fov: 30 },
    };
  }
  // the major's attacks (spec 04): 0 crushing bite, 1 head swing
  for (const k of [0, 1]) {
    C[`major${k}`] = {
      ...C[`atk${k}`],
      ants: [C.atk0.ants[0], { morph: 'fire_major', script: attacker(-R * 1.05, 0, 0, k, 1.0, 0.2, bite) }],
      cam: { tx: -0.6, ty: 0.6, tz: 0, dir: [0.15, 0.35, 1], dist: 11, fov: 30 },
    };
  }
  // the same attack seen from the default gameplay zoom (readability)
  // (the game's surface camera: 38° field of view, 230 mm away at the default zoom, looking down at about 50°)
  C.attack_game = { ...C.attack, cam: { tx: 0, ty: 0, tz: 0, dir: [0.35, 1, 0.55], dist: 230, fov: 38 } };
  const L = STAG_L;
  const stagBase = (c: Creature, x: number, y: number, h: number) => {
    c.x = x;
    c.y = y;
    c.h = h;
  };
  // the stag beetle: walk, turn, stop and idle
  C.stag_walk = {
    dur: 10,
    ants: [],
    stag: (() => {
      const w = pathWalker(-L * 0.9, 0, 0, [{ d: 2.2, v: 40 }, { d: 1.6, v: 30, turn: 0.7 }, { d: 0.6, v: 10 }, { d: 0.4 }, { d: 1.6, turn: -1.1 }, { d: 3.6 }]);
      const v = blankView();
      return (t: number, c: Creature) => {
        w(t, v);
        stagBase(c, v.x, v.y, v.heading);
        c.state = 0;
      };
    })(),
    cam: { tx: 0, ty: 6, tz: 0, dir: [0.4, 0.75, 1], dist: 260, follow: -1, fov: 30 },
  };
  // the grab-and-toss: the grab (antlers wide), the clamp and lift of a worker, the toss — it tumbles and lands
  const tossAt = 0.5 + STAG.windUp + STAG.liftS;
  C.stag_toss = {
    dur: tossAt + 2.6,
    ants: [
      {
        morph: 'fire_major',
        script: (t, v) => {
          const jx = L * STAG.jaw;
          const g0 = 0.5 + STAG.windUp;
          if (t < g0) {
            v.x = jx + 6;
            v.y = 0;
            v.heading = Math.PI;
            v.antennaActivity = 1;
            v.mandible = 0.9;
            v.pose = POSE.ALARM;
          } else if (t < tossAt) {
            const rise = Math.min(1, (t - g0) / (STAG.liftS * 0.6));
            v.x = jx;
            v.y = 0;
            v.heading = Math.PI / 2;
            v.lift = L * STAG.liftH * (0.4 + 0.6 * rise);
            v.pose = POSE.GRAPPLE;
            v.heldCr = 900; // drawn in the animated antlers (as the game does for a gripped ant)
            v.roll = Math.sin(t * 20) * 0.35;
            v.mandible = 0.6;
            v.hp = 50 - (t - g0) * 12;
          } else {
            // a quick, high arc out of the jaws (it peaks while the flick is still on)
            const u = Math.min(1, (t - tossAt) / 0.8);
            v.x = jx + L * 0.1 + u * L * 0.15;
            v.y = -u * L * 0.55;
            v.heading = Math.PI / 2;
            v.lift = u < 1 ? L * STAG.liftH + Math.sin(Math.PI * u) * L * 0.25 - u * L * STAG.liftH : 0;
            v.flung = u < 1;
            v.hp = 40;
          }
        },
      },
    ],
    stag: (t, c) => {
      stagBase(c, 0, 0, 0);
      const g0 = 0.5;
      if (t < g0) {
        c.state = 1;
        c.st = t;
      } else if (t < g0 + STAG.windUp) {
        c.state = 8;
        c.st = t - g0;
      } else if (t < tossAt) {
        c.state = 19;
        c.st = t - g0 - STAG.windUp;
      } else {
        c.state = 18;
        c.st = t - tossAt;
      }
    },
    cam: { tx: L * 0.3, ty: 12, tz: -L * 0.1, dir: [0.7, 0.45, 1], dist: 190, fov: 30 },
  };
  // the enraged rear-and-slam: ants round it are flung at the slam (1.2 s into the rear)
  const slamAt = 0.6 + 1.2;
  C.stag_slam = {
    dur: slamAt + 2.4,
    ants: Array.from({ length: 6 }, (_, i) => ({
      script: (t: number, v: AntView) => {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const r0 = L * 0.4;
        const u = Math.max(0, Math.min(1, (t - slamAt) / 0.9));
        const r = r0 + u * L * 0.35;
        v.x = Math.cos(a) * r;
        v.y = Math.sin(a) * r;
        v.heading = a + Math.PI;
        v.lift = t > slamAt && u < 1 ? Math.sin(Math.PI * u) * L * 0.18 : 0;
        v.flung = t > slamAt && u < 1;
        v.hp = t > slamAt ? 20 : 40;
        v.antennaActivity = 1;
        v.mandible = 0.9;
      },
    })),
    stag: (t, c) => {
      stagBase(c, 0, 0, 0);
      if (t < 0.6) {
        c.state = 1;
        c.st = t;
      } else if (t < 0.6 + 1.8) {
        c.state = 15;
        c.st = t - 0.6;
      } else {
        c.state = 1;
        c.st = t - 2.4;
      }
    },
    events: [{ t: slamAt, e: { t: 'slam', x: 0, y: 0, space: -1, radius: L * 0.55, power: 1 } as unknown as SimEvent, shake: 0.6, hitStop: 0.05 }],
    cam: { tx: 0, ty: 10, tz: 0, dir: [0.6, 0.55, 1], dist: 260, fov: 30 },
  };
  // hits on the stag (two flinches) and its death
  C.stag_hit = {
    dur: 6,
    ants: [],
    stag: (t, c) => {
      stagBase(c, 0, 0, 0);
      c.state = 1;
      c.st = t;
      c.data.hitT = Math.floor(t / 0.9) * 4;
      c.dead = t > 4;
      c.deadT = Math.max(0, t - 4);
    },
    cam: { tx: 0, ty: 8, tz: 0, dir: [0.6, 0.55, 1], dist: 230, fov: 30 },
  };
  // the stag beetle standing (its idles)
  C.stag_idle = {
    dur: 9,
    ants: [],
    stag: (t, c) => {
      stagBase(c, 0, 0, 0.4);
      c.state = 0;
      c.st = t;
    },
    cam: { tx: 0, ty: 8, tz: 0, dir: [0.6, 0.5, 1], dist: 220, fov: 30 },
  };
  return C;
}

export function runAnimLab(canvas: HTMLCanvasElement, q: URLSearchParams): void {
  animSettings.v2 = q.get('anim') !== '1';
  const clip = clips()[q.get('clip') || 'walk'];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  setBakeRenderer(renderer);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const env = createSurfaceEnvironment(renderer, scene);
  scene.fog = null;
  const tex = textures();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex.soil.map, normalMap: tex.soil.normal, roughness: 0.95 }));
  const rep = clip.stag ? 60 : 300;
  (ground.material as THREE.MeshStandardMaterial).map!.repeat.set(rep, rep);
  (ground.material as THREE.MeshStandardMaterial).normalMap!.repeat.set(rep, rep);
  ground.receiveShadow = true;
  scene.add(ground);
  const ants = new AntRenderer(renderer, 'labAnts');
  scene.add(ants.group);
  const crs = new CreatureRenderer('labCreatures');
  scene.add(crs.group);
  const fx = new CombatFx();
  scene.add(fx.group);
  const flat = () => 0;
  const adapter = {
    toWorld: (x: number, y: number, out: THREE.Vector3) => out.set(x, 0, y),
    normal: (_x: number, _y: number, out: THREE.Vector3) => out.set(0, 1, 0),
    forward: (h: number, out: THREE.Vector3) => out.set(Math.cos(h), 0, Math.sin(h)),
  };
  const actors: Actor[] = clip.ants.map((a, i) => {
    const v = blankView();
    v.id = i + 1;
    v.morph = a.morph ?? FIRE;
    v.antennaActivity = 0.3;
    v.hp = 40;
    a.script(0, v);
    return { id: i + 1, morph: v.morph, script: a.script, cur: v, prev: { x: v.x, y: v.y, h: v.heading } };
  });
  const stag: Creature | null = clip.stag
    ? ({ id: 900, kind: 'stagBeetle', space: -1, x: 0, y: 0, px: 0, py: 0, h: 0, ph: 0, v: 0, hp: 1, maxHp: 1, state: 0, st: 0, tgt: 0, tk: 0, tx: 0, ty: 0, homeX: 0, homeY: 0, cd: 0, cd2: 0, latched: 0, latchGrip: 0, phase: 0, wind: 0, anim: 0, v2: 0.62, dead: false, deadT: 0, scale: STAG_L, venom: 0, venomT: 0, venomDps: 0, slowT: 0, stun: 0, faction: -1, data: { msize: 1 } } as unknown as Creature)
    : null;
  if (stag) clip.stag!(0, stag);
  if (stag) {
    stag.px = stag.x;
    stag.py = stag.y;
    stag.ph = stag.h;
  }
  /** one sim tick at time T: previous ← current, then the scripts set the new current */
  const tickAt = (T: number) => {
    for (const a of actors) {
      a.prev.x = a.cur.x;
      a.prev.y = a.cur.y;
      a.prev.h = a.cur.heading;
      const keepHp = a.cur.hp;
      a.cur.atk = undefined;
      a.cur.pose = 0;
      a.cur.lift = 0;
      a.cur.flung = false;
      a.cur.heldCr = 0;
      a.cur.roll = 0;
      a.cur.dead = false;
      a.cur.hp = keepHp;
      a.script(T, a.cur);
      a.cur.px = a.prev.x;
      a.cur.py = a.prev.y;
      a.cur.pheading = a.prev.h;
    }
    if (stag) {
      stag.px = stag.x;
      stag.py = stag.y;
      stag.ph = stag.h;
      clip.stag!(T, stag);
    }
    for (const b of biteFx.splice(0)) fx.emit({ t: 'bite', x: b.x, y: b.y, space: -1, strength: 0.6 } as unknown as SimEvent, flat);
    for (const ev of clip.events ?? []) if (ev.t > T - TICK && ev.t <= T) {
      fx.emit(ev.e, flat);
      if (ev.shake) shake = Math.max(shake, ev.shake);
      if (ev.hitStop) hold = ev.hitStop;
    }
  };
  // camera (`cdist=` overrides the clip's distance: the same scene at another zoom)
  // (`ctx` / `ctz` move the camera's target: a close look at one actor)
  const C = { ...clip.cam, dist: Number(q.get('cdist') || clip.cam.dist), tx: Number(q.get('ctx') ?? clip.cam.tx), tz: Number(q.get('ctz') ?? clip.cam.tz) };
  const cam = new THREE.PerspectiveCamera(C.fov ?? 30, window.innerWidth / window.innerHeight, C.dist * 0.02, C.dist * 60);
  const dir = new THREE.Vector3(...C.dir).normalize();
  const target = new THREE.Vector3(C.tx, C.ty, C.tz);
  const span = C.dist * 0.6;
  const placeCam = () => {
    cam.position.copy(target).addScaledVector(dir, C.dist);
    cam.lookAt(target);
  };
  placeCam();
  applyLabLight(renderer, scene, env, cam, target, span, q, ground);
  const sun = env.sun;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -span * 2;
  sc.right = span * 2;
  sc.top = span * 2;
  sc.bottom = -span * 2;
  sc.updateProjectionMatrix();
  const post = new PostPipeline(renderer);
  post.setSize(window.innerWidth, window.innerHeight, 1);
  post.focusDistance = C.dist;
  post.tilt = 0;
  post.settings.dofStrength = Number(q.get('dof') || 0.3);
  post.settings.ao = q.get('ao') !== '0';
  if (q.get('bloom') === '0' || q.get('light') === 'studio') post.settings.bloom = false;
  env.sun.shadow.radius = 2.5;
  const fps = Number(q.get('fps') || 30);
  const dt = 1 / fps;
  let t = 0;
  let simT = 0;
  let tick = 0;
  let shake = 0;
  let hold = 0;
  const views: AntView[] = actors.map((a) => a.cur);
  tickAt(0);
  const frame = (draw = true) => {
    // the sim clock (a hit-stop holds it a moment), ticks at 20 Hz, the render interpolates between them
    if (hold > 0) hold -= dt;
    else simT += dt;
    while ((tick + 1) * TICK <= simT) {
      tick++;
      tickAt(tick * TICK);
    }
    const alpha = (simT - tick * TICK) / TICK;
    globalUniforms.uTime.value = t;
    if (stag) crs.update([stag], -1, alpha, dt, flat, cam, window.innerHeight);
    if (C.follow !== undefined) {
      const fx0 = C.follow < 0 && stag ? stag.px + (stag.x - stag.px) * alpha : actors[C.follow] ? actors[C.follow].cur.px + (actors[C.follow].cur.x - actors[C.follow].cur.px) * alpha : 0;
      const fz0 = C.follow < 0 && stag ? stag.py + (stag.y - stag.py) * alpha : actors[C.follow] ? actors[C.follow].cur.py + (actors[C.follow].cur.y - actors[C.follow].cur.py) * alpha : 0;
      target.x += (fx0 - target.x) * (t === 0 ? 1 : 1 - Math.exp(-dt * 6));
      target.z += (fz0 - target.z) * (t === 0 ? 1 : 1 - Math.exp(-dt * 6));
    }
    placeCam();
    if (shake > 0.01) {
      const s = shake * C.dist * 0.006;
      cam.position.x += Math.sin(t * 97) * s;
      cam.position.y += Math.sin(t * 131 + 1) * s;
      cam.position.z += Math.sin(t * 113 + 2) * s;
      shake *= Math.exp(-dt * 5);
    }
    cam.updateMatrixWorld();
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(env.sunDir, C.dist * 4);
    ants.mount = (av, a, out) => !!stag && (av.heldCr === stag.id || av.rideCr === stag.id) && crs.mountPose(stag, av, a, out);
    ants.update(views, alpha, dt, cam, adapter, window.innerHeight);
    // (the game's pixel scale: particles the size they are on screen in play)
    fx.update(dt, flat, window.innerHeight / (2 * Math.tan((cam.fov * Math.PI) / 360)));
    if (draw) post.render(scene, cam);
    t += dt;
  };
  // settle the first frames
  frame();
  const w = window as unknown as { __ready: boolean; __anim: unknown };
  w.__anim = {
    /** advance n frames, drawing only the last */
    step: (n: number) => {
      for (let i = 0; i < n; i++) frame(i === n - 1);
      return t;
    },
    get t() {
      return t;
    },
    dur: clip.dur,
  };
  w.__ready = true;
}
