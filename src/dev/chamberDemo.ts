import { GameSession } from '../game/session';
import { canUpgrade, completeUpgrade, placeTile, tileAt } from '../sim/tiles';
import { Tile } from '../sim/types';
import { basicCaste } from '../sim/species';

/**
 * Screenshot/dev helper (`?chamber=1`): a 19-hex worker chamber dug next to
 * the queen and upgraded to level 3 the way the player would (upgrade points
 * from neighbours, inside out), joined to the chamber by a short tunnel. Its
 * tiles start empty so the brood loop shows: eggs carried from the queen's
 * pile, larvae growing with their rings, hatching adults. Stores are filled so
 * nothing starves; the tile overlay is switched on.
 */
export function chamberDemo(s: GameSession): void {
  const w = s.world;
  const c = s.player;
  const g = w.nest(c.id)!;
  const q0 = c.tiles.find((t) => t.type === 'queen' && g.neighbors(t.q).every((n) => tileAt(c, n)?.type === 'queen'))?.q ?? c.tiles[0].q;
  // a centre 5 steps from the queen, on the side away from the entrance tunnel
  const ent = g.entrances[0];
  let centre = -1;
  let best = -1;
  for (let q = 0; q < g.cols * g.rows; q++) {
    if (g.hexDistance(q, q0) !== 5) continue;
    if (g.hexCol(q) < 3 || g.hexCol(q) > g.cols - 4 || g.hexRow(q) < 3 || g.hexRow(q) > g.rows - 4) continue;
    const s2 = g.hexDistance(q, ent);
    if (s2 > best) {
      best = s2;
      centre = q;
    }
  }
  const dig = (q: number) => {
    g.softenHex(q);
    g.completeHex(q);
  };
  const disc: number[] = [];
  for (let q = 0; q < g.cols * g.rows; q++) if (g.hexDistance(q, centre) <= 2) {
    dig(q);
    disc.push(q);
  }
  // tunnel from the queen's chamber to the new one
  let cur = q0;
  for (let k = 0; k < 12 && g.hexDistance(cur, centre) > 2; k++) {
    let next = cur;
    for (const n of g.neighbors(cur)) if (n >= 0 && g.hexDistance(n, centre) < g.hexDistance(next, centre)) next = n;
    cur = next;
    if (!g.isHexDug(cur)) dig(cur);
  }
  c.infiniteFood = true;
  c.food = c.foodCap;
  const caste = basicCaste(c.species);
  const tiles = disc.map((q) => placeTile(w, c, 'brood', q, caste, true)).filter((t): t is Tile => !!t);
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const t of tiles) if (!canUpgrade(w, c, t)) {
      completeUpgrade(w, c, t);
      changed = true;
    }
    if (!changed) break;
  }
  s.tileOverlay = true;
  const ctr = g.hexCenter(centre);
  const qc = g.hexCenter(q0);
  // look between the queen and the new chamber
  const st = s.view.nestStages.get(s.viewedArea);
  if (st) st.cam = { x: (ctr.x * 2 + qc.x) / 3, z: (ctr.y * 2 + qc.y) / 3, dist: g.R * 13, yaw: 0.6, pitch: 0 };
  s.view.setActiveNest(s.viewedArea);
}
