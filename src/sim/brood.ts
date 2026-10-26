import { World } from './world';
import { makeAnt } from './factory';
import { AS, Colony, nestSpace, SURFACE } from './types';
import { tileAt, tileAnts, tileCapacity, hatchCost, growTime, applyLevel } from './tiles';
import { BALANCE } from './balance';
import { bindAntToTile } from './colony';
import { outsideQueenBody } from './termites';
import { casteOf } from './species';

/**
 * Extra brood growth speed from the colony's warming tiles: thatch (red wood
 * ants) all the time, the sun-warmed mound (fire ants) by day and a quarter
 * of that at night. Capped together.
 */
export function broodWarmth(w: World, c: Colony): number {
  let thatch = 0;
  let mound = 0;
  for (const t of c.tiles) {
    if (!t.built) continue;
    if (t.type === 'thatch') thatch += BALANCE.thatch.broodSpeed[t.level - 1];
    else if (t.type === 'mound') mound += BALANCE.mound.broodSpeed[t.level - 1];
  }
  const day = 1 - (1 - BALANCE.mound.night) * w.s.night;
  return Math.min(BALANCE.broodSpeedCap, thatch + mound * day);
}

/**
 * Brood (Revision 2, EotU loop — DESIGN.md 3.7). Eggs lie in the queen's pile
 * until a worker carries one to an empty brood tile (sim/jobs.ts). There the
 * larva grows, drawing its hatch cost from the stores gradually, and only
 * while there is food. At 100 % it hatches into the tile's caste. A larva
 * delivered to a tile whose ant is alive (pre-staged) stops at 50 % and
 * resumes when that ant dies, so replacements come quickly.
 */
export function broodSystem(w: World, dt: number): void {
  for (const c of w.s.colonies) c.starving = false;
  // brood-speed bonus per colony (thatch, sun-warmed mound), worked out once per tick
  const warmth: number[] = [];
  for (const c of w.s.colonies) warmth[c.id] = broodWarmth(w, c);
  for (const b of w.s.brood) {
    const c = w.colony(b.colony);
    if (!c) {
      w.removeBroodNow(b.id);
      continue;
    }
    // A carrier that died (or was removed) without putting it down leaves the brood free to pick up.
    if (b.carrier) {
      const ca = w.antById.get(b.carrier);
      if (!ca || ca.state === AS.Dead) b.carrier = 0;
    }
    if (!c.alive) {
      // A fallen nest's brood lies uncared for (raiders may carry it off) and dies.
      b.hunger += dt;
      if (b.hunger > 90) w.removeBroodNow(b.id);
      continue;
    }
    if (b.stage === 0) continue; // an egg being carried, or dropped on the floor
    const tile = tileAt(c, b.tile);
    if (!tile || tile.brood !== b.id || !tile.built) {
      w.removeBroodNow(b.id);
      continue;
    }
    if (b.carrier) continue;
    const full = tileAnts(w, tile).length >= tileCapacity(tile);
    const cap = full ? BALANCE.prestage : 1;
    if (b.t < cap) {
      const step = (dt / growTime(b.caste)) * (1 + (warmth[c.id] ?? 0)) * w.s.settings.eggRate;
      const grow = Math.min(step, cap - b.t);
      const need = hatchCost(b.caste) * grow;
      if (c.infiniteFood || c.food >= need) {
        if (!c.infiniteFood) c.food -= need;
        b.fed += need;
        b.t += grow;
      } else c.starving = true;
    }
    if (b.t >= 1 && !full) hatch(w, b.id);
  }
}

const hp = { x: 0, y: 0 }; // det-ok: scratch

function hatch(w: World, id: number): void {
  const b = w.broodById.get(id);
  if (!b) return;
  const c = w.colony(b.colony)!;
  const tile = tileAt(c, b.tile);
  const space = nestSpace(c.id);
  // a termite queen is a solid body: brood that grew under her steps out beside her
  const q = w.antById.get(c.queen);
  if (q && q.space === space) outsideQueenBody(w, q, b.x, b.y, casteOf(b.caste).length * 0.3, hp);
  else {
    hp.x = b.x;
    hp.y = b.y;
  }
  const a = makeAnt(w, c.id, b.caste, space, hp.x, hp.y, w.rng.range(0, Math.PI * 2));
  a.task = 'idle';
  a.state = AS.Idle;
  if (tile) {
    tile.brood = 0;
    bindAntToTile(c, a, tile.q);
    applyLevel(a, tile.level);
  }
  c.stats.born++;
  w.events.emit({ t: 'hatch', colony: c.id, caste: b.caste, x: b.x, y: b.y, space });
  w.removeBroodNow(b.id);
}
