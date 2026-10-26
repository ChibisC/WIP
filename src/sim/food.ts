import { World } from './world';
import { AS, Carry, Food, SURFACE } from './types';
import { casteOf } from './species';
import { BALANCE } from './balance';
import { homeField, nearestEntrance, enterNest } from './movement';
import { makeFood } from './factory';
import { datan2, dcos, dhypot, dsin } from './dmath';

const tmp = { x: 0, y: 0 };

/**
 * Food items: honeydew and leaf regrowth, decay of untouched remains. (Large
 * items are harvested a load at a time by each ant; co-op hauling was removed
 * on 2026-10-25.)
 */
export function foodSystem(w: World, dt: number): void {
  for (const f of w.s.food) {
    f.px = f.x;
    f.py = f.y;
    if (f.heldBy) {
      const a = w.antById.get(f.heldBy);
      if (!a || a.state === AS.Dead || a.carryId !== f.id) f.heldBy = 0;
      continue;
    }
    f.age += dt;
    // dead ants and termites: food for a few seconds, then they sink into the ground and are gone
    if (f.sinkAt !== undefined && f.age >= f.sinkAt) {
      f.amount = 0; // no longer taken
      if (f.age >= f.sinkAt + BALANCE.corpse.sink) w.removeFoodNow(f.id);
      continue;
    }
    // Remains slowly decay (refuse piles, leftovers).
    if (f.colony === -2) {
      f.amount -= dt * 0.02;
      if (f.amount <= 0) w.removeFoodNow(f.id);
    } else if (f.kind === 'crumb' && f.age > 240) w.removeFoodNow(f.id);
  }
  // Aphids produce honeydew; leaf plants regrow.
  for (const ap of w.s.aphids) {
    ap.dew = Math.min(ap.n * 0.6, ap.dew + dt * ap.n * 0.012);
    if (w.s.tick % 200 === 0 && ap.n < 30 && w.rng.chance(0.3)) ap.n++; // parthenogenetic growth
  }
  for (const p of w.s.plants) p.leaf = Math.min(p.max, p.leaf + dt * 0.15);
}

