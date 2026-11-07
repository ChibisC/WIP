/**
 * A creature against `n` ants of one caste on open ground (tools/balance-matrix.ts `creatures` and `stags`,
 * tests/stagSizes.ts): the ants ring it 45 mm out and attack on their marker, which follows it. Returns whether it died,
 * the ants lost, its health left (0..1) and the time (s). No node globals, so tests can import it.
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { CASTES } from '../src/sim/species';
import { makeAnt } from '../src/sim/factory';
import { placeMarker } from '../src/sim/markers';
import { spawnCreature } from '../src/sim/creatures/creatureAI';

export function creatureFight(kind: string, caste: string, n: number, seed = 3, secs = 150): { dead: boolean; lost: number; hp: number; t: number } {
  const ev = new EventBus();
  const w = createWorld({ seed, style: 'formicarium', width: 600, depth: 600, colonies: [{ species: CASTES[caste].species, player: true, ai: false }], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 } }, ev);
  w.s.settings.foodRespawn = 0;
  w.terrain.clearArea(150, 150, 450, 450);
  const cr = spawnCreature(w, kind, SURFACE, 300, 300);
  const c = w.colony(0)!;
  placeMarker(w, c, 0, SURFACE, 300, 300);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const a = makeAnt(w, 0, caste, SURFACE, 300 + Math.cos(ang) * 45, 300 + Math.sin(ang) * 45, ang + Math.PI);
    a.task = 'marker';
    a.marker = 0;
    ids.push(a.id);
  }
  w.reindex();
  let t = 0;
  for (; t <= secs * 20; t++) {
    w.step(0.05);
    ev.drain();
    for (const id of ids) {
      const x = w.antById.get(id);
      if (x && x.state !== AS.Dead) {
        x.task = 'marker';
        x.marker = 0;
        const p = w.creatureById.get(cr.id);
        if (p && !p.dead && t % 20 === 0) placeMarker(w, c, 0, SURFACE, p.x, p.y);
      }
    }
    const p = w.creatureById.get(cr.id);
    const left = ids.filter((id) => w.antById.get(id)?.state !== AS.Dead && w.antById.get(id)).length;
    if (!p || p.dead || !left) break;
  }
  const p = w.creatureById.get(cr.id);
  const lost = ids.filter((id) => !w.antById.get(id) || w.antById.get(id)!.state === AS.Dead).length;
  return { dead: !p || p.dead, lost, hp: p ? Math.max(0, p.hp) / p.maxHp : 0, t: t / 20 };
}
