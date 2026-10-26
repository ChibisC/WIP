import { GameSession } from '../game/session';
import { spawnCreature } from '../sim/creatures/creatureAI';
import { CREATURES } from '../sim/creatures/kinds';
import { SURFACE } from '../sim/types';

/**
 * Screenshot/dev helper (`?spawn=wolfSpider:2,groundBeetle,pillbug:3`): wild
 * creatures placed in a ring on open ground beside the player's entrance
 * (around entrance + (70, 40) mm, where `?battle` meets too). Returns that point.
 */
export function creatureDemo(s: GameSession, spec: string): { x: number; y: number } {
  const w = s.world;
  const e = s.player.entrances[0];
  const cx = e.sx + 70;
  const cy = e.sy + 40;
  const list: string[] = [];
  for (const part of spec.split(',')) {
    const [kind, n] = part.split(':');
    if (!CREATURES[kind]) continue;
    for (let i = 0; i < Math.max(1, Number(n) || 1); i++) list.push(kind);
  }
  list.forEach((kind, i) => {
    const a = (i / list.length) * Math.PI * 2;
    const r = list.length > 1 ? 18 + list.length * 3 : 0;
    spawnCreature(w, kind, SURFACE, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  });
  s.view.surfaceRig.jumpTo(cx, cy, 140);
  return { x: cx, y: cy };
}
