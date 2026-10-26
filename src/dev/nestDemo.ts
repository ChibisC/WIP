import { GameSession } from '../game/session';
import { placeTile, tileAt } from '../sim/tiles';
import { spawnTileAnt } from '../sim/colony';
import { assignGroup, placeMarker } from '../sim/markers';
import { SURFACE } from '../sim/types';
import { CASTES } from '../sim/species';

/**
 * Screenshot/dev helper: grow the player's nest into a lived-in layout —
 * dug galleries, groups of every brood caste, food stores, species tiles —
 * so visual reviews show the full range of tile looks.
 */
export function layoutDemo(s: GameSession): void {
  const w = s.world;
  const c = s.player;
  const g = w.nest(c.id)!;
  const q0 = c.tiles.find((t) => t.type === 'queen')!.q;
  c.popLimit = 120;
  c.food = 400;
  // Dig galleries: everything within 4 steps, plus two branching tunnels.
  for (let q = 0; q < g.cols * g.rows; q++) {
    const d = g.hexDistance(q, q0);
    if (d <= 4 && g.hexSoil[q] !== 255) {
      g.softenHex(q);
      g.completeHex(q);
    }
  }
  let cur = q0;
  for (const dir of [1, 1, 2, 1, 1, 2, 2, 1]) {
    for (let k = 0; k < 1; k++) cur = Math.max(0, g.neighbors(cur)[dir]);
    if (g.hexDistance(cur, q0) > 4) {
      g.softenHex(cur);
      g.completeHex(cur);
    }
  }
  // Mark a few hexes for digging so the designation shows.
  for (let q = 0; q < g.cols * g.rows; q++) if (g.hexDistance(q, q0) === 5 && g.hexCol(q) < g.hexCol(q0) - 2) g.designateHex(q, true);
  const free = () => {
    const out: number[] = [];
    for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q) && !g.isEntrance(q) && !tileAt(c, q)) out.push(q);
    return out;
  };
  const grow = (seed: number, n: number, type: Parameters<typeof placeTile>[2], caste?: string) => {
    const queue = [seed];
    const seen = new Set([seed]);
    let placed = 0;
    while (queue.length && placed < n) {
      const q = queue.shift()!;
      if (g.isHexDug(q) && !g.isEntrance(q) && !tileAt(c, q)) {
        placeTile(w, c, type, q, caste, true);
        placed++;
      }
      for (const m of g.neighbors(q)) if (m >= 0 && !seen.has(m) && g.isHexDug(m)) {
        seen.add(m);
        queue.push(m);
      }
    }
  };
  const castes = c.castes.filter((cs) => CASTES[cs].role !== 'queen');
  const nb = g.neighbors(q0);
  // soldier / extra castes on the far side
  castes.slice(1).forEach((cs, i) => {
    const seeds = free().filter((q) => g.hexDistance(q, q0) === 3 + (i % 2));
    if (seeds.length) grow(seeds[(i * 7) % seeds.length], 5, 'brood', cs);
  });
  grow(free().filter((q) => g.hexDistance(q, q0) >= 2)[0] ?? free()[0], 5, 'brood', castes[0]);
  const fseeds = free().filter((q) => g.hexDistance(q, nb[4]) <= 2);
  grow(fseeds[0] ?? free()[0], 4, 'food');
  if (c.species === 'atta') grow(free()[3], 3, 'fungus');
  if (c.species === 'lasius') grow(free()[2], 2, 'aphid');
  if (c.species === 'formica') grow(free()[2], 2, 'thatch');
  // Most tiles start with their ant; a few are still raising theirs (brood visible on the tiles).
  c.tiles.forEach((t, i) => {
    if (t.type === 'brood' && t.caste && !t.ant && i % 3 !== 0) spawnTileAnt(w, c, t.q, t.caste);
  });
  // One soldier group out on the surface at marker II.
  const e = c.entrances[0];
  placeMarker(w, c, 1, SURFACE, e.sx + 60, e.sy + 20);
  const sol = c.groups.find((gr) => gr.type === 'brood' && gr.caste !== castes[0]);
  if (sol) assignGroup(w, c, sol.id, 1);
}
