import type { StoryLevelDef } from '../sim/story/types';
import { STORY } from '../sim/balance';
import { MAP_H, MAP_W, regionSlots } from './islandGeo';

/**
 * The Termants campaign as data (claude/story/02-spec §3–4; docs/story/DESIGN-STORY.md): the island's regions as
 * the hub draws them, the level nodes on it, the paths between them, the chapters, and the unlock and slot rules.
 *
 * Built for the whole campaign, about 30–40 levels (user, 2026-11-02): each region has a fixed number of node slots
 * (`slots`, 43 in all), spread evenly inside it by story/islandGeo.ts. A new level only names its region and slot and
 * the level(s) before it; its node's place and the path to it follow from that, so adding levels needs no art or code.
 */

export interface Region {
  id: string;
  name: string;
  /** the region's rough centre on the island map (0..1 of the map's width and height) */
  at: [number, number];
  /** its painted colour on the map */
  color: string;
  /** level-node slots it holds */
  slots: number;
  /** the first chapter with a level in it (regions of later chapters are drawn under mist, "Coming soon") */
  chapter: number;
  /** the hub's line about it */
  blurb: string;
}

export interface LevelNode {
  level: StoryLevelDef['id'];
  region: string;
  /** which of the region's slots (0 nearest its centre) */
  slot: number;
  chapter: number;
  /** levels that must be won first (the path is drawn from the first) */
  after: Array<StoryLevelDef['id']>;
  /** a boss level (chapter 1's gives a trait only; from later chapters a boss also gives a stolen-caste slot) */
  boss?: boolean;
}

export const ISLAND_NAME = 'Wayfarer Island';

/** The current chapter (regions of later chapters are under mist). */
export const CURRENT_CHAPTER = 1;

export const REGIONS: Region[] = [
  { id: 'meadow', name: 'Meadow Pond', at: [0.3, 0.68], color: '#7f9a4f', slots: 8, chapter: 1, blurb: 'Garden meadows and a storm-filled pond on the south-west shore, where the queen came ashore.' },
  { id: 'riverbank', name: 'Riverbank', at: [0.55, 0.78], color: '#c2a46a', slots: 7, chapter: 1, blurb: 'Warm sandy banks along the slow river that drains the island to the south.' },
  { id: 'forest', name: 'Forest Floor', at: [0.25, 0.36], color: '#5d6b3c', slots: 8, chapter: 2, blurb: 'Pine and oak woods on the western hills. Red wood ants build their thatch mounds here.' },
  { id: 'rainforest', name: 'Rainforest', at: [0.68, 0.3], color: '#3f6b45', slots: 8, chapter: 3, blurb: 'Steaming lowland forest in the north-east, buttress roots and leaf litter.' },
  { id: 'savanna', name: 'Savanna', at: [0.8, 0.58], color: '#c9a95a', slots: 8, chapter: 4, blurb: 'Open grassland and termite mounds on the dry eastern plateau.' },
  { id: 'heart', name: "The Island's Heart", at: [0.52, 0.5], color: '#7a6248', slots: 4, chapter: 5, blurb: 'An old caldera in the middle of the island. Nobody goes there.' },
];

/**
 * Chapter 1 runs Garden Below → The Long Nights → Fire on the Banks → The Spider Mother (claude/story/04-spec §1). The
 * nights are at the meadow's east edge where it meets the river woods (between the garden and the river); the spider
 * mother's terrace is the riverbank's sandy upper slot, north of the fire ants' bank.
 */
export const NODES: LevelNode[] = [
  { level: 'garden', region: 'meadow', slot: 1, chapter: 1, after: [] },
  { level: 'longNights', region: 'meadow', slot: 4, chapter: 1, after: ['garden'] },
  { level: 'fireBanks', region: 'riverbank', slot: 2, chapter: 1, after: ['longNights'] },
  { level: 'spiderMother', region: 'riverbank', slot: 6, chapter: 1, after: ['fireBanks'], boss: true },
];

/** The chapters (the hub's banner and level list, the chapter-end screen; its last level carries the ending line). */
export const CHAPTERS = [{ n: 1, name: 'Chapter 1 — Landfall', levels: ['garden', 'longNights', 'fireBanks', 'spiderMother'] as Array<StoryLevelDef['id']> }];

const slotCache = new Map<string, Array<[number, number]>>();

/** A region's node slots (map units, computed once). */
export function slotsOf(regionId: string): Array<[number, number]> {
  let s = slotCache.get(regionId);
  if (!s) {
    const r = REGIONS.find((x) => x.id === regionId);
    s = r ? regionSlots(REGIONS, r, r.slots) : [];
    slotCache.set(regionId, s);
  }
  return s;
}

/** Where a level's node sits (map units). */
export function nodePos(n: LevelNode): [number, number] {
  const s = slotsOf(n.region);
  return s[Math.min(n.slot, s.length - 1)] ?? REGIONS.find((r) => r.id === n.region)?.at ?? [0.5, 0.5];
}

/** The path drawn to a node from the level before it: a gentle curve (map units), or none for the first level. */
export function nodePath(n: LevelNode): Array<[number, number]> | null {
  const prev = NODES.find((x) => x.level === n.after[0]);
  if (!prev) return null;
  const [x0, y0] = nodePos(prev);
  const [x1, y1] = nodePos(n);
  // bow the path to one side (alternating by level index), sampled as a smooth curve
  const i = NODES.indexOf(n);
  const dx = (x1 - x0) * (MAP_W / MAP_H);
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const bow = 0.18 * (i % 2 ? 1 : -1);
  const mx = (x0 + x1) / 2 + ((-dy / len) * len * bow * MAP_H) / MAP_W;
  const my = (y0 + y1) / 2 + (dx / len) * len * bow;
  const out: Array<[number, number]> = [];
  for (let k = 0; k <= 12; k++) {
    const u = k / 12;
    out.push([(1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x1, (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * y1]);
  }
  return out;
}

/** Stolen-caste slots for a campaign that has beaten `bosses` bosses (data: STORY.slots). */
export function slotsFor(bosses: number): number {
  return STORY.slots.start + STORY.slots.perBoss * bosses;
}

/** How many levels the island's regions can hold. */
export function capacity(): number {
  return REGIONS.reduce((t, r) => t + slotsOf(r.id).length, 0);
}
