import { World } from './world';
import { Ant, AS, Carry, POSE, SURFACE } from './types';
import { casteOf } from './species';
import { speciesHooks } from './antAI';
import { steerTo } from './movement';
import { makeFood } from './factory';
import { dhypot, dsin, sq } from './dmath';

/**
 * Species foraging behaviours that go beyond picking up food:
 *
 * - **Leaf cutting** (Atta medias): smell a leafy plant, walk to it, saw out a
 *   fragment sized to the body (several seconds of cutting), carry it home
 *   held high over the head, and return to the same plant. Leaves feed the
 *   fungus garden, which turns them into food.
 * - **Honeydew milking** (Lasius, Formica): find an aphid colony, stroke the
 *   aphids with the antennae until they release honeydew, fill the crop, and
 *   carry it home. Tended colonies are claimed for a while.
 *
 * Memory codes in `ant.tk` (shared with combat, which uses 3 and 4): 2 =
 * heading to a plant, 8 = carrying a leaf from it; 5 = heading to aphids, 7 =
 * carrying honeydew from them. After delivery the ant goes back to the same
 * source (see `deposit`).
 */

const CUT_T = 3.5; // seconds to cut one fragment
const MILK_T = 4; // seconds to milk a full crop
const PLANT_SENSE = 110; // leafy plants are found by smell from further away
const APHID_SENSE = 70; // honeydew smells sweet from a distance
const CLAIM_T = 30; // tended aphids belong to the colony for this long

function plantById(w: World, id: number) {
  return w.s.plants.find((p) => p.id === id);
}
function aphidById(w: World, id: number) {
  return w.s.aphids.find((p) => p.id === id);
}

/** Is a source inside the marker's working area (with a margin)? No area = free foraging. */
function inArea(area: { x: number; y: number; r: number } | null, x: number, y: number): boolean {
  return !area || sq(x - area.x) + sq(y - area.y) < sq(area.r * 1.6);
}

function forageSense(w: World, a: Ant, dt: number, area: { x: number; y: number; r: number } | null): boolean {
  const cd = casteOf(a.caste);
  // --- leaf cutting -------------------------------------------------------
  if (cd.cutLeaves) {
    if (a.tk === 2) {
      const p = plantById(w, a.tgt);
      if (!p || p.leaf < 1) {
        a.tk = 0;
        a.tgt = 0;
        a.state = AS.Scout;
        a.st = 0;
        return false;
      }
      const reach = 4 + cd.length * 0.5;
      const d = dhypot(p.x - a.x, p.y - a.y);
      if (d > reach && a.state !== AS.CutLeaf) {
        if (a.state !== AS.ToFood) {
          a.state = AS.ToFood;
          a.st = 0;
        }
        steerTo(w, a, p.x, p.y, dt);
        return true;
      }
      if (a.state !== AS.CutLeaf) {
        a.state = AS.CutLeaf;
        a.st = 0;
      }
      // sawing: stand at the leaf edge, head swinging in an arc
      a.v = 0;
      a.pose = POSE.DIG;
      a.h += dsin(a.st * 5) * dt * 1.2;
      if (a.st < CUT_T * (0.8 + cd.length / 35)) return true;
      const amt = Math.min(cd.carry, 3);
      p.leaf = Math.max(0, p.leaf - amt / 3);
      const piece = makeFood(w, 'leaf', SURFACE, a.x, a.y, Math.max(0.5, cd.length / 7), 'leaf');
      piece.amount = piece.max = amt;
      piece.heldBy = a.id;
      a.carry = Carry.Leaf;
      a.carryId = piece.id;
      a.carryAmt = amt;
      a.lost = p.leaf > 2 ? 1 : 0.2; // strong trail while the plant has leaves
      a.tk = p.leaf >= 1 ? 8 : 0;
      a.tgt = p.leaf >= 1 ? p.id : 0;
      a.state = AS.Return;
      a.st = 0;
      w.events.emit({ t: 'bite', x: a.x, y: a.y, space: SURFACE, strength: 0.15, by: a.caste, on: 'leaf' });
      return true;
    }
    if (w.s.tick % 4 === a.id % 4) {
      let best = -1;
      let bd = PLANT_SENSE * PLANT_SENSE;
      for (const p of w.s.plants) {
        if (p.leaf < 1.5 || !inArea(area, p.x, p.y)) continue;
        const d2 = sq(p.x - a.x) + sq(p.y - a.y);
        if (d2 < bd) {
          bd = d2;
          best = p.id;
        }
      }
      if (best >= 0) {
        a.tgt = best;
        a.tk = 2;
        a.state = AS.ToFood;
        a.st = 0;
        return true;
      }
    }
  }
  // --- honeydew milking ---------------------------------------------------
  if (cd.tendAphids) {
    if (a.tk === 5) {
      const ap = aphidById(w, a.tgt);
      const claimed = ap && ap.owner >= 0 && ap.owner !== a.colony && ap.tendT > 0;
      if (!ap || claimed || (ap.dew < 0.3 && a.state !== AS.TendAphids)) {
        a.tk = 0;
        a.tgt = 0;
        a.state = AS.Scout;
        a.st = 0;
        return false;
      }
      const reach = 3 + cd.length * 0.6;
      const d = dhypot(ap.x - a.x, ap.y - a.y);
      if (d > reach && a.state !== AS.TendAphids) {
        if (a.state !== AS.ToFood) {
          a.state = AS.ToFood;
          a.st = 0;
        }
        steerTo(w, a, ap.x, ap.y, dt);
        return true;
      }
      if (a.state !== AS.TendAphids) {
        a.state = AS.TendAphids;
        a.st = 0;
      }
      // antennal drumming on the aphids' backs; they release droplets
      a.v = 0;
      a.pose = POSE.TROPH;
      ap.owner = a.colony;
      ap.tendT = CLAIM_T;
      const want = (1 - a.crop) * (cd.carry / 3); // dew units the crop can still hold
      const take = Math.min(ap.dew, want, (dt / MILK_T) * (cd.carry / 3));
      ap.dew -= take;
      a.carryAmt += take * 3;
      a.crop = Math.min(1, a.crop + take / Math.max(0.3, cd.carry / 3));
      if (a.crop < 0.98 && ap.dew > 0.02 && a.st < MILK_T * 2.5) return true;
      if (a.carryAmt < 0.3) return true; // nothing yet: keep stroking
      a.carry = Carry.Liquid;
      a.carryId = 0;
      a.lost = ap.dew > 0.5 ? 1 : 0.4;
      a.tk = 7;
      a.state = AS.Return;
      a.st = 0;
      return true;
    }
    if (a.crop < 0.5 && w.s.tick % 4 === (a.id + 2) % 4) {
      let best = -1;
      let bd = APHID_SENSE * APHID_SENSE;
      for (const ap of w.s.aphids) {
        if (ap.dew < 1 || !inArea(area, ap.x, ap.y)) continue;
        if (ap.owner >= 0 && ap.owner !== a.colony && ap.tendT > 0) continue;
        // crowded: enough nestmates already work this colony
        let tending = 0;
        for (const o of w.s.ants) if (o.tk === 5 && o.tgt === ap.id) tending++;
        if (tending >= 2 + Math.floor(ap.n / 4)) continue;
        const d2 = sq(ap.x - a.x) + sq(ap.y - a.y);
        if (d2 < bd) {
          bd = d2;
          best = ap.id;
        }
      }
      if (best >= 0) {
        a.tgt = best;
        a.tk = 5;
        a.carryAmt = 0;
        a.state = AS.ToFood;
        a.st = 0;
        return true;
      }
    }
  }
  return false;
}

/** Claims on aphid colonies lapse when nobody tends them. */
export function aphidClaims(w: World, dt: number): void {
  for (const ap of w.s.aphids) {
    if (ap.tendT > 0) ap.tendT -= dt;
    else ap.owner = -1;
  }
}

export function registerSpeciesAI(): void {
  speciesHooks.forageSense = forageSense;
}
