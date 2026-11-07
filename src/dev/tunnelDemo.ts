import { GameSession } from '../game/session';
import { makeAnt } from '../sim/factory';
import { chainToward } from '../world/nestGrid';
import { ownHalf, otherHalf, routes } from '../sim/tunnels';
import { nestSpace } from '../sim/types';

/**
 * Dev: a tunnel-route scene (`?tunnel=<stage>`, CHANGE_PLAN §27). The player's nest is dug out to its gate on route 0
 * and the player digs that route with a bigger crew; `stage`: `dig` (digging on), `warn` (fast-forwarded until the
 * defender is warned), `open` (until the route opens), `in` (until the breach into the rival's floor), `enemy` (the
 * rival digs toward the player instead: the player is the one warned), `ally` (the two are teamed: linking nests).
 * `&tunnelview=2` looks at the rival's nest. Edits the world directly (not replayable).
 */
export function tunnelDemo(s: GameSession, stage: string): void {
  const w = s.world;
  const me = s.player;
  const r = routes(w)[0];
  if (!r) return;
  const rival = w.colony(r.a === me.id ? r.b : r.a)!;
  const digger = stage === 'enemy' ? rival : me;
  const own = ownHalf(r, digger.id)!;
  const g = w.nest(digger.id)!;
  if (stage === 'ally') {
    rival.team = me.team;
    rival.ai = true;
  }
  const q0 = digger.tiles.find((t) => t.type === 'queen')!.q;
  for (const q of chainToward(g, q0, own.gate, 80, (q) => g.isHexDiggable(q) || g.isHexDug(q)))
    if (q !== own.gate && !g.isHexDug(q)) {
      g.softenHex(q);
      g.completeHex(q);
    }
  // a crew: more workers for the digger
  digger.infiniteFood = true;
  const worker = digger.castes.find((k) => k.endsWith('worker')) ?? digger.castes[0];
  const qp = g.hexCenter(q0);
  for (let i = 0; i < 12; i++) makeAnt(w, digger.id, worker, nestSpace(digger.id), qp.x + (i % 4) * 2, qp.y + Math.floor(i / 4) * 2, 0).task = 'idle';
  for (let i = 0; i < 20; i++) w.step(0.05);
  digger.routeDig = r.id;
  const until = (done: () => boolean, max: number) => {
    for (let t = 0; t < max && !done(); t++) for (let i = 0; i < 20; i++) w.step(0.05);
  };
  const other = otherHalf(r, own);
  if (stage === 'warn' || stage === 'enemy') until(() => other.warned, 900);
  if (stage === 'open') until(() => r.open, 1200);
  if (stage === 'in' || stage === 'ally') until(() => !!other.joined, 1500);
  s.events.drain();
}
