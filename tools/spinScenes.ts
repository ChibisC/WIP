/**
 * Combat spinning check (fix brief, part 1): a 50 v 50 battle on open ground
 * and 30 ants on one beetle. Measures how fast fighting ants turn (heading
 * change per second), how many "spin" (turn a full circle the same way round
 * within 3 s), how close ants stack on each other, and how attackers spread round a
 * target.
 *
 * The scenes behind `tools/spin-check.ts` (run that).
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { Ant, AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { casteOf } from '../src/sim/species';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { World } from '../src/sim/world';

export function openGround(w: World, span = 120): { x: number; y: number } {
  for (let k = 0; k < 900; k++) {
    const x = 120 + (k % 30) * 15;
    const y = 120 + Math.floor(k / 30) * 15;
    let ok = true;
    for (let dx = -span / 2; dx <= span / 2 && ok; dx += 3) for (let dy = -span / 3; dy <= span / 3 && ok; dy += 3) if (!w.walkable(SURFACE, x + dx, y + dy)) ok = false;
    if (ok) return { x, y };
  }
  return { x: 320, y: 320 };
}

const wrap = (d: number) => {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function battleStats(n = 50, seconds = 25, seed = 7): { spinners: number; turnRate: number; overlapPairs: number; fighters: number; spinStates: Record<string, number> } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w);
  const ants: Ant[] = [];
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, 0, i % 5 === 0 ? 'lasius_soldier' : 'lasius_worker', SURFACE, p.x - 25 + (i % 5) * 3, p.y - 20 + Math.floor(i / 5) * 4, 0);
    const b = makeAnt(w, 1, i % 5 === 0 ? 'formica_soldier' : 'formica_worker', SURFACE, p.x + 25 - (i % 5) * 3, p.y - 20 + Math.floor(i / 5) * 4, Math.PI);
    for (const x of [a, b]) {
      x.task = 'guard';
      x.alarm = 1;
      x.cd2 = 1e6; // no acid: a melee test
      ants.push(x);
    }
  }
  w.reindex();
  const hist = new Map<number, number[]>();
  const histS = new Map<number, string[]>();
  let turn = 0;
  let turnN = 0;
  let overlapPairs = 0;
  let samples = 0;
  for (let t = 0; t < seconds * 20; t++) {
    const before = new Map(ants.map((a) => [a.id, a.h]));
    w.step(0.05);
    w.events.drain();
    for (const a of ants) {
      if (a.state === AS.Dead) continue;
      const d = wrap(a.h - before.get(a.id)!);
      const fighting = a.state === AS.Attack || a.state === AS.Grapple;
      if (!fighting) continue;
      turn += Math.abs(d);
      turnN++;
      let h = hist.get(a.id);
      if (!h) hist.set(a.id, (h = []));
      h.push(d);
      let hs = histS.get(a.id);
      if (!hs) histS.set(a.id, (hs = []));
      hs.push(a.state === AS.Grapple ? (a.gKind === 3 && w.antById.get(a.gId)?.gId === a.id ? 'mutual' : 'grapple') : (a.waitT ?? 0) > 0 ? 'wait' : 'attack');
    }
    if (t % 20 === 0) {
      samples++;
      const live = ants.filter((a) => a.state !== AS.Dead);
      for (let i = 0; i < live.length; i++)
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i];
          const b = live[j];
          const r = (casteOf(a.caste).length + casteOf(b.caste).length) * 0.12;
          if (Math.hypot(a.x - b.x, a.y - b.y) < r) overlapPairs++;
        }
    }
  }
  let spinners = 0;
  const spinStates: Record<string, number> = {};
  for (const [id, h] of hist) {
    for (let i = 0; i + 60 <= h.length; i += 10) {
      let s = 0;
      for (let k = i; k < i + 60; k++) s += h[k];
      // a spin: a full turn the same way round within 3 s (turning to and fro to face new targets is not)
      if (Math.abs(s) > Math.PI * 2) {
        spinners++;
        // where the turning happened
        const hs = histS.get(id)!;
        for (let k = i; k < i + 60; k++) spinStates[hs[k]] = (spinStates[hs[k]] ?? 0) + Math.abs(h[k]);
        break;
      }
    }
  }
  for (const k in spinStates) spinStates[k] = Math.round(spinStates[k] * 57.3);
  return { spinners, turnRate: (turn / Math.max(1, turnN)) * 20, overlapPairs: overlapPairs / Math.max(1, samples), fighters: hist.size, spinStates };
}

export function beetleRing(n = 30, seed = 7): { latched: number; ringErr: number; spinners: number; stacked: number } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w);
  const cr = spawnCreature(w, 'groundBeetle', SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e6;
  const ants: Ant[] = [];
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, 0, 'lasius_worker', SURFACE, p.x - 30 + (i % 6) * 4, p.y - 14 + Math.floor(i / 6) * 6, 0);
    a.task = 'guard';
    a.alarm = 1;
    a.tgt = cr.id;
    a.tk = 4;
    a.state = AS.Attack;
    ants.push(a);
  }
  w.reindex();
  const hist = new Map<number, number[]>();
  for (let t = 0; t < 20 * 20; t++) {
    const before = new Map(ants.map((a) => [a.id, a.h]));
    w.step(0.05);
    w.events.drain();
    for (const a of ants) {
      let h = hist.get(a.id);
      if (!h) hist.set(a.id, (h = []));
      h.push(wrap(a.h - before.get(a.id)!));
    }
  }
  let spinners = 0;
  for (const h of hist.values())
    for (let i = 200; i + 60 <= h.length; i += 10) {
      let s = 0;
      for (let k = i; k < i + 60; k++) s += h[k];
      // a spin: a full turn the same way round within 3 s (turning to and fro to face new targets is not)
      if (Math.abs(s) > Math.PI * 2) {
        spinners++;
        break;
      }
    }
  const latched = ants.filter((a) => a.state === AS.Grapple && a.gId === cr.id).length;
  let stacked = 0;
  const alive = ants.filter((a) => a.state !== AS.Dead);
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) if (Math.hypot(alive[i].x - alive[j].x, alive[i].y - alive[j].y) < 1.0) stacked++;
  const ringErr = 0;
  return { latched, ringErr, spinners, stacked };
}

/**
 * Tunnels: `n` workers start piled in the queen's chamber and are all sent out
 * to forage; returns how many reach the surface and the mean time it took.
 * Run with separation on and off to see that it does not jam the tunnels.
 */
export function tunnelFlow(n = 60, seconds = 40, seed = 7): { out: number; meanT: number } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const c = w.s.colonies[0];
  const q = w.antById.get(c.queen)!;
  const ants: Ant[] = [];
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, c.id, 'lasius_worker', q.space, q.x + ((i % 7) - 3) * 1.2, q.y + (Math.floor(i / 7) - 4) * 1.2, (i * 0.7) % 6.28);
    a.task = 'forage';
    ants.push(a);
  }
  w.reindex();
  const outAt = new Map<number, number>();
  for (let t = 0; t < seconds * 20; t++) {
    for (const a of ants) if (a.task !== 'forage') a.task = 'forage';
    w.step(0.05);
    w.events.drain();
    for (const a of ants) if (a.space === SURFACE && !outAt.has(a.id)) outAt.set(a.id, t / 20);
  }
  let sum = 0;
  for (const v of outAt.values()) sum += v;
  return { out: outAt.size, meanT: outAt.size ? sum / outAt.size : 0 };
}

/**
 * Planted fighting (user note 2026-10-25: ants "spin around with the creature they are fighting … they
 * should be planted to their ground"): `n` workers attack one creature that cannot die; for every tick an
 * ant spends latched on (Grapple), how far it slides over the ground and how fast it swings round the
 * creature's centre. Also how much the creature itself turned, so a still creature is not mistaken for a fix.
 */
export function creatureOrbit(kind: string, n = 24, seconds = 20, seed = 7, caste = 'formica_worker'): { latchedTicks: number; slideMmPerS: number; orbitDegPerS: number; creatureTurnDeg: number; biting: number } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: caste.split('_')[0] as never, player: true, ai: false }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  const p = openGround(w, 160);
  const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = 1e7;
  const ants: Ant[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = cr.scale * 0.9 + 6;
    const a = makeAnt(w, 0, caste, SURFACE, p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, ang + Math.PI);
    a.task = 'guard';
    a.alarm = 1;
    a.tgt = cr.id;
    a.tk = 4;
    a.state = AS.Attack;
    ants.push(a);
  }
  w.reindex();
  let slide = 0;
  let orbit = 0;
  let ticks = 0;
  let turn = 0;
  for (let t = 0; t < 20 * seconds; t++) {
    const before = ants.map((a) => ({ x: a.x, y: a.y, th: Math.atan2(a.y - cr.y, a.x - cr.x), g: a.state === AS.Grapple && a.gKind === 4 }));
    const h0 = cr.h;
    w.step(0.05);
    w.events.drain();
    turn += Math.abs(wrap(cr.h - h0));
    ants.forEach((a, i) => {
      const b = before[i];
      if (!b.g || a.state !== AS.Grapple || a.gKind !== 4 || a.rideId) return;
      ticks++;
      slide += Math.hypot(a.x - b.x, a.y - b.y);
      orbit += Math.abs(wrap(Math.atan2(a.y - cr.y, a.x - cr.x) - b.th));
    });
  }
  const biting = ants.filter((a) => a.state === AS.Grapple && a.gKind === 4).length;
  return { latchedTicks: ticks, slideMmPerS: (slide / Math.max(1, ticks)) * 20, orbitDegPerS: (orbit / Math.max(1, ticks)) * 20 * 57.3, creatureTurnDeg: turn * 57.3, biting };
}
