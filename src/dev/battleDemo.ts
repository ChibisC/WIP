import { GameSession } from '../game/session';
import { makeAnt } from '../sim/factory';
import { assignGroup, placeMarker } from '../sim/markers';
import { SURFACE, nestSpace } from '../sim/types';
import { CASTES, canonCaste } from '../sim/species';

/**
 * Screenshot/dev helper (`?battle=formica_soldier:6,fire_minor:30`): two armies
 * — the player's first caste spec and the rival's second — meet at marker I
 * on open ground near the player's entrance. With `?raid=1` the player's army
 * instead raids the rival's nest (marker I beside the rival queen).
 */
export function battleDemo(s: GameSession, spec: string, raid: boolean): void {
  const w = s.world;
  const [mine, theirs] = spec.split(',').map((p) => {
    const [caste, n] = p.split(':');
    return { caste: canonCaste(caste), n: Number(n) };
  });
  const P = s.player;
  const R = w.s.colonies.find((c) => c.id !== P.id);
  if (!R || !CASTES[mine.caste] || (theirs && !CASTES[theirs.caste])) return;
  const e = P.entrances[0];
  const cx = e.sx + 70;
  const cy = e.sy + 40;
  if (raid) {
    const q = w.antById.get(R.queen)!;
    placeMarker(w, P, 0, nestSpace(R.id), q.x + 6, q.y);
  } else placeMarker(w, P, 0, SURFACE, cx, cy);
  // Demo ants ride on the queen's-chamber group (only group members follow
  // markers), which is sent to marker I.
  const spawn = (colony: number, caste: string, n: number, x: number, y: number, h: number) => {
    const c = w.colony(colony)!;
    const chamber = c.tiles.find((t) => t.type === 'queen')!;
    for (let i = 0; i < n; i++) {
      const a = makeAnt(w, colony, caste, SURFACE, x + Math.cos(i * 2.4) * (4 + i * 0.6), y + Math.sin(i * 2.4) * (4 + i * 0.6), h);
      a.tile = chamber.q;
      a.task = 'marker';
      a.marker = 0;
      a.alarm = 0.5;
    }
    assignGroup(w, c, chamber.group, 0);
  };
  spawn(P.id, mine.caste, mine.n, raid ? e.sx : cx - 45, raid ? e.sy + 10 : cy, 0);
  if (theirs && !raid) {
    // a test scene: the rival's AI would call its demo group home to forage, so it sits this one out
    R.ai = false;
    placeMarker(w, R, 0, SURFACE, cx, cy);
    spawn(R.id, theirs.caste, theirs.n, cx + 45, cy, Math.PI);
  }
  w.reindex();
  s.view.surfaceRig.jumpTo(cx, cy, 120);
}
