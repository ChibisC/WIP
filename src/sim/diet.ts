import { Colony, Food } from './types';
import { SPECIES } from './species';
import { ECITON } from './balance';

/**
 * Who eats what. Termites live on plant matter (food kind 'wood'): the Nasute
 * Termites on deadwood alone, the Sickle-Jaw Termites on leaf-litter patches
 * (`from` 'litter') and deadwood. Termites ignore insect food, seeds, honeydew
 * and every corpse. Ants never touch plant matter, but termite corpses are
 * food for them (as in EotU).
 */
export function eatsWood(c: Colony): boolean {
  return SPECIES[c.species]?.kind === 'termite';
}

/** Leaf litter (and its fragments): the Sickle-Jaw Termites' main food. */
export function isLitter(f: Food): boolean {
  return f.from === 'litter' || f.from === 'litterchip';
}

/** Plant food (and crumbs of it): army ants leave these alone. */
const PLANT_FROM = new Set(['seed', 'berry', 'apple', 'fungus', 'leaf', 'honeydew', 'wood']); // det-ok: constant table

/** Can this colony's foragers take this item as food? */
export function edible(c: Colony, f: Food): boolean {
  if (eatsWood(c)) return f.kind === 'wood' && (!isLitter(f) || c.species === 'rhynchotermes');
  // army ants are pure predators: insects and corpses, and crumbs of them (or of raided brood) — ECITON.foodKinds
  if (c.species === 'eciton') return ECITON.foodKinds.includes(f.kind) && !(f.kind === 'crumb' && PLANT_FROM.has(f.from));
  // Termants: every food there is — what ants eat, dead wood, leaf litter and leaves (one store; their workers gather
  // the wood, litter and leaves: user 2026-11-02)
  if (c.species === 'termant') return true;
  return f.kind !== 'wood';
}

/** Plant-matter sources (twigs, logs, leaf-litter patches…) are chewed in place; fragments ('chip', 'litterchip') are carried. */
export function isWoodSource(f: Food): boolean {
  return f.kind === 'wood' && f.from !== 'chip' && f.from !== 'litterchip';
}
