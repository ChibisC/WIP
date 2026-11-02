import type { StoryLevelDef } from '../sim/story/types';
import { STORY } from '../sim/balance';

/**
 * The Gene-Thief campaign as data (claude/story/02-spec §3–4; docs/story/DESIGN-STORY.md): the island's regions as
 * the hub draws them, the level nodes on it, the paths between them, and the unlock and slot rules. Later chapters add
 * regions' nodes and levels here without code changes.
 */

export interface Region {
  id: string;
  name: string;
  /** the region's rough centre on the island map (0..1 of the map's width and height) */
  at: [number, number];
  /** its painted colour on the map */
  color: string;
  /** a chapter-1 region with a level in it (the rest are drawn fogged, "Coming soon") */
  open: boolean;
  /** the hub's line about it */
  blurb: string;
}

export interface LevelNode {
  level: StoryLevelDef['id'];
  region: string;
  /** where the node sits (0..1) */
  at: [number, number];
  /** levels that must be won first */
  after: Array<StoryLevelDef['id']>;
  /** the path drawn to this node from the one before (0..1 points), revealed when it unlocks */
  path?: Array<[number, number]>;
  /** a boss level gives a stolen-caste slot (later chapters) */
  boss?: boolean;
}

export const ISLAND_NAME = 'Wayfarer Island';

export const REGIONS: Region[] = [
  { id: 'meadow', name: 'Meadow Pond', at: [0.3, 0.68], color: '#7f9a4f', open: true, blurb: 'Garden meadows and a storm-filled pond on the south-west shore, where the queen came ashore.' },
  { id: 'riverbank', name: 'Riverbank', at: [0.55, 0.78], color: '#c2a46a', open: true, blurb: 'Warm sandy banks along the slow river that drains the island to the south.' },
  { id: 'forest', name: 'Forest Floor', at: [0.25, 0.36], color: '#5d6b3c', open: false, blurb: 'Pine and oak woods on the western hills. Red wood ants build their thatch mounds here.' },
  { id: 'rainforest', name: 'Rainforest', at: [0.68, 0.3], color: '#3f6b45', open: false, blurb: 'Steaming lowland forest in the north-east, buttress roots and leaf litter.' },
  { id: 'savanna', name: 'Savanna', at: [0.8, 0.58], color: '#c9a95a', open: false, blurb: 'Open grassland and termite mounds on the dry eastern plateau.' },
  { id: 'heart', name: "The Island's Heart", at: [0.52, 0.5], color: '#7a6248', open: false, blurb: 'An old caldera in the middle of the island. Nobody goes there.' },
];

export const NODES: LevelNode[] = [
  { level: 'garden', region: 'meadow', at: [0.31, 0.7], after: [] },
  {
    level: 'fireBanks',
    region: 'riverbank',
    at: [0.56, 0.79],
    after: ['garden'],
    path: [
      [0.31, 0.7],
      [0.36, 0.75],
      [0.43, 0.76],
      [0.49, 0.8],
      [0.56, 0.79],
    ],
  },
];

/** The chapters (a hub banner and the chapter-end screen). */
export const CHAPTERS = [{ n: 1, name: 'Chapter 1 — Landfall', levels: ['garden', 'fireBanks'] as Array<StoryLevelDef['id']> }];

/** Stolen-caste slots for a campaign that has beaten `bosses` bosses (data: STORY.slots). */
export function slotsFor(bosses: number): number {
  return STORY.slots.start + STORY.slots.perBoss * bosses;
}
