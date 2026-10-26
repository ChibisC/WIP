import type { MapDef, MapId } from './types';
import { TEST_POND } from './testPond';
import { MEADOW_POND } from './meadowPond';
import { FOREST_FLOOR } from './forestFloor';

export type { MapDef, MapId } from './types';

/** Every authored map by id. The five playable maps are added as they are built (docs/maps/design.md §10). */
export const MAPS: Partial<Record<MapId, MapDef>> = {
  testPond: TEST_POND,
  meadowPond: MEADOW_POND,
  // a draft: validated, not yet offered in the menus (PLAYABLE_MAPS)
  forestFloor: FOREST_FLOOR,
};

/** The maps offered in menus and the lobby, in order. */
export const PLAYABLE_MAPS: MapId[] = ['meadowPond'];

export function mapDef(id: MapId): MapDef {
  const d = MAPS[id];
  if (!d) throw new Error(`Unknown map: ${id}`);
  return d;
}
