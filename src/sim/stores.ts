import { World } from './world';
import { Colony } from './types';

/**
 * Full stores stop the gathering, as in EotU (user note 2026-11-02 12:06: "if food stores are full, units stop
 * collecting"). Foragers at a marker hold it instead of collecting, home foragers and haulers stand down, and a load
 * already in an ant's mandibles is still brought home. Leafcutters keep cutting while their fungus garden has room
 * (cut leaves feed the garden, not the food store), and the garden turns leaves into food only while the store has
 * room, so a full store fills the garden and then stops the leaf cutting too.
 */

/** A store within this much of its cap counts as full (a forager's load would not fit). */
export const STORE_FULL_SLACK = 0.5;

/** The food store is full (never for sandbox colonies with endless food). */
export function foodFull(c: Colony): boolean {
  return !c.infiniteFood && c.food >= c.foodCap - STORE_FULL_SLACK;
}

/** Cut leaves go into a fungus garden (leafcutters, and colonies raising leafcutter workers), not the food store. */
export function leavesToFungus(c: Colony): boolean {
  return c.species !== 'termant' && (c.species === 'atta' || c.castes.includes('atta_media'));
}

/** The fungus garden's leaf store is full (without a garden, leaves rot past 20: colony.ts fungusFarm). */
export function gardenFull(c: Colony): boolean {
  const cap = c.fungusCap > 0 ? c.fungusCap : 20;
  return c.fungus >= cap - STORE_FULL_SLACK;
}

/** Is the store a load of this kind goes into full? */
export function storeFullFor(c: Colony, kind: string): boolean {
  if (kind === 'leaf' && leavesToFungus(c)) return gardenFull(c);
  return foodFull(c);
}

/** Nothing this colony gathers has room left: its foragers stop collecting. */
export function storesFull(c: Colony): boolean {
  return foodFull(c) && (!leavesToFungus(c) || gardenFull(c));
}

/** The player hears once when the stores fill (and again after they have had room). */
export function storeNotice(w: World, c: Colony): void {
  const full = storesFull(c);
  if (full && !c.fullNoted && c.player) w.events.emit({ t: 'message', text: 'The food store is full: foragers stop gathering. Build more food storage to keep them working.', kind: 'info', colony: c.id });
  c.fullNoted = full;
}
