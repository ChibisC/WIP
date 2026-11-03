import type { World } from '../world';
import type { Colony } from '../types';
import { STORY } from '../balance';

/**
 * Story traits (claude/story/04-spec §4): permanent colony-wide bonuses earned from titans and mega colonies. They live
 * in the campaign save and come into a story level on the player's colony (`Colony.traits`, set by the story runner);
 * skirmish and multiplayer colonies never have any, so nothing here touches their balance. Built so far:
 *  - Spiderling Venom (the Spider Mother, chapter 1): every bite adds a small venom stack (STORY.traits.spiderlingVenom).
 */

/** After a bite by one of `c`'s ants lands on `t` (an ant or a creature). */
export function traitOnBite(_w: World, c: Colony, t: { venom: number; venomT: number; venomDps: number }): void {
  if (!c.traits?.length) return;
  if (c.traits.includes('spiderlingVenom')) {
    const T = STORY.traits.spiderlingVenom;
    // (as combat.ts applyVenom; inlined so combat can call in here without an import cycle)
    t.venom = Math.min(T.maxStacks ?? 1, t.venom + 1);
    t.venomT = Math.max(t.venomT, T.duration ?? 0);
    t.venomDps = Math.max(t.venomDps * 0.9, T.dps ?? 0);
  }
}

/** The traits that exist in the game (built), for the save and the Genome screen. */
export function builtTraits(): string[] {
  return Object.entries(STORY.traits)
    .filter(([, t]) => t.built)
    .map(([k]) => k);
}
