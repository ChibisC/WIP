import type { StoryLevelDef } from '../../sim/story/types';
import { GARDEN } from './garden';
import { FIRE_BANKS_LEVEL } from './fireBanks';

/** Every story level by id (each in its own data file; new chapters add files here). */
export const STORY_LEVELS: Record<StoryLevelDef['id'], StoryLevelDef> = {
  garden: GARDEN,
  fireBanks: FIRE_BANKS_LEVEL,
};

export function storyLevel(id: StoryLevelDef['id']): StoryLevelDef {
  const L = STORY_LEVELS[id];
  if (!L) throw new Error(`Unknown story level: ${id}`);
  return L;
}
