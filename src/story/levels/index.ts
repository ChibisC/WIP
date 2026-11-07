import type { StoryLevelDef, StoryLevelId } from '../../sim/story/types';
import { GARDEN } from './garden';
import { LONG_NIGHTS_LEVEL } from './longNights';
import { FIRE_BANKS_LEVEL } from './fireBanks';
import { SPIDER_MOTHER_LEVEL } from './spiderMother';
import { ANTLERED_KING_LEVEL } from './antleredKing';
import { HIGH_WATER_LEVEL } from './highWater';
import { CARTON_KINGDOM_LEVEL } from './cartonKingdom';

/** Every story level by id (each in its own data file; new chapters add files here). */
export const STORY_LEVELS: Record<StoryLevelId, StoryLevelDef> = {
  garden: GARDEN,
  longNights: LONG_NIGHTS_LEVEL,
  fireBanks: FIRE_BANKS_LEVEL,
  spiderMother: SPIDER_MOTHER_LEVEL,
  antleredKing: ANTLERED_KING_LEVEL,
  highWater: HIGH_WATER_LEVEL,
  cartonKingdom: CARTON_KINGDOM_LEVEL,
};

export function storyLevel(id: StoryLevelId): StoryLevelDef {
  const L = STORY_LEVELS[id];
  if (!L) throw new Error(`Unknown story level: ${id}`);
  return L;
}
