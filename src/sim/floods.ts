import { FLOOD } from './balance';
import { casteOf } from './species';
import { killAnt } from './antAI';
import { AS, SURFACE, FloodState } from './types';
import { World } from './world';
import { inShape, shapeBox } from '../world/mapShapes';
import { dhypot } from './dmath';
import { nearestWalkable } from './markers';

/**
 * Storms and rising water on authored maps (docs/maps/design.md §5). Each of the map's flood zones
 * runs a cycle scheduled from the seed: idle until its storm → warning (25 s) → rising (10 s, in
 * steps, so the zone's low ground fills first) → holding (the map's range) → draining (20 s) → idle
 * until the next storm. The state lives in `w.s.flood` (saved and replayed); the water level goes
 * into the terrain parameters (`zoneFlood`), so every client and a restored game see the same water.
 *
 * In the water: ants and walking creatures lose health (a share of their maximum per second) and
 * paddle toward the nearest dry ground; loose food floats off and is lost. Nests are not affected.
 * Floods are off unless the match turns them on (`settings.floods`, the user's choice).
 */

export const FP = { Idle: 0, Warn: 1, Rise: 2, Hold: 3, Drain: 4 } as const;

/** Schedule the first storm of every flood zone (only when the match has floods on). */
export function initFloods(w: World): void {
  const m = w.terrain.map;
  if (!m || !m.floods.length || !w.s.settings.floods) return;
  w.s.flood = m.floods.map((f): FloodState => ({ phase: FP.Idle, t: 0, next: w.rng.range(f.first[0], f.first[1]), level: -9999 }));
}

function setLevel(w: World, i: number, f: FloodState, level: number): void {
  f.level = level;
  w.terrain.setZoneFlood(i, level);
}

function announce(w: World, i: number, what: 'warn' | 'rise' | 'drain'): void {
  const z = w.terrain.map!.floods[i];
  const b = shapeBox(z.shape, 0);
  const x = (b.x0 + b.x1) / 2;
  const y = (b.y0 + b.y1) / 2;
  w.events.emit({ t: 'flood', zone: i, phase: what, x, y });
  for (const c of w.s.colonies)
    if (c.player && c.alive) {
      const text = what === 'warn' ? 'A storm is coming: the low ground will flood in 25 seconds.' : what === 'rise' ? 'The water is rising.' : 'The flood is draining away.';
      w.events.emit({ t: 'message', text, kind: what === 'drain' ? 'good' : 'warn', colony: c.id });
    }
}

export function floodSystem(w: World, dt: number): void {
  const fl = w.s.flood;
  const m = w.terrain.map;
  if (!fl || !m) return;
  for (let i = 0; i < fl.length; i++) {
    const f = fl[i];
    const z = m.floods[i];
    if (!z) continue;
    if (f.phase === FP.Idle) {
      if (w.s.time >= f.next) {
        f.phase = FP.Warn;
        f.t = FLOOD.warnS;
        announce(w, i, 'warn');
      }
      continue;
    }
    f.t -= dt;
    if (f.phase === FP.Warn) {
      if (f.t <= 0) {
        f.phase = FP.Rise;
        f.t = FLOOD.riseS;
        announce(w, i, 'rise');
      }
    } else if (f.phase === FP.Rise) {
      const k = Math.min(FLOOD.steps, Math.floor((1 - Math.max(0, f.t) / FLOOD.riseS) * FLOOD.steps) + 1);
      const lvl = z.level - FLOOD.startBelow * (1 - k / FLOOD.steps);
      if (lvl !== f.level) setLevel(w, i, f, lvl);
      if (f.t <= 0) {
        f.phase = FP.Hold;
        f.t = w.rng.range(z.hold[0], z.hold[1]);
      }
    } else if (f.phase === FP.Hold) {
      if (f.t <= 0) {
        f.phase = FP.Drain;
        f.t = FLOOD.drainS;
        announce(w, i, 'drain');
      }
    } else if (f.phase === FP.Drain) {
      const k = Math.min(FLOOD.steps, Math.floor((1 - Math.max(0, f.t) / FLOOD.drainS) * FLOOD.steps) + 1);
      const lvl = k >= FLOOD.steps ? -9999 : z.level - FLOOD.startBelow * (k / FLOOD.steps);
      if (lvl !== f.level) setLevel(w, i, f, lvl);
      if (f.t <= 0) {
        if (f.level !== -9999) setLevel(w, i, f, -9999);
        f.phase = FP.Idle;
        f.next = w.s.time + w.rng.range(z.every[0], z.every[1]);
      }
    }
    if (f.level > -9000) floodEffects(w, i, dt);
  }
}

/** Ants and creatures in the water lose health and paddle ashore; loose food floats off. */
function floodEffects(w: World, i: number, dt: number): void {
  const z = w.terrain.map!.floods[i];
  const t = w.terrain;
  const step = FLOOD.swimMmS * dt;
  for (const a of w.s.ants) {
    if (a.space !== SURFACE || a.state === AS.Dead) continue;
    if (!t.isWater(a.x, a.y) || !inShape(z.shape, a.x, a.y)) continue;
    const cd = casteOf(a.caste);
    if (cd.role === 'king') continue;
    a.hp -= cd.hp * FLOOD.drownFrac * dt;
    if (a.hp <= 0) {
      killAnt(w, a);
      continue;
    }
    const dry = nearestWalkable(w, a.x, a.y);
    if (dry) {
      const d = dhypot(dry.x - a.x, dry.y - a.y);
      if (d > 0.01) {
        const k = Math.min(1, step / d);
        a.x += (dry.x - a.x) * k;
        a.y += (dry.y - a.y) * k;
      }
    }
  }
  for (const cr of w.s.creatures) {
    if (cr.space !== SURFACE || cr.dead) continue;
    if (!t.isWater(cr.x, cr.y) || !inShape(z.shape, cr.x, cr.y)) continue;
    cr.hp -= cr.maxHp * FLOOD.drownFrac * 0.5 * dt;
    if (cr.hp <= 0) {
      cr.hp = 0;
      cr.dead = true;
      cr.deadT = 0;
      w.events.emit({ t: 'death', x: cr.x, y: cr.y, space: cr.space, kind: 'creature', id: cr.id, colony: -1, what: cr.kind });
      continue;
    }
    const dry = nearestWalkable(w, cr.x, cr.y);
    if (dry) {
      const d = dhypot(dry.x - cr.x, dry.y - cr.y);
      if (d > 0.01) {
        const k = Math.min(1, (step * 1.5) / d);
        cr.x += (dry.x - cr.x) * k;
        cr.y += (dry.y - cr.y) * k;
      }
    }
  }
  const gone: number[] = [];
  for (const f of w.s.food) if (f.space === SURFACE && !f.heldBy && t.isWater(f.x, f.y) && inShape(z.shape, f.x, f.y)) gone.push(f.id);
  for (const id of gone) w.removeFoodNow(id);
}
