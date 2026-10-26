/**
 * Determinism check (multiplayer brief, Part F).
 *
 * The same seed and the same scripted player actions are run several times,
 * and the state hash is compared every 100 ticks:
 *  - run A: from tick 0;
 *  - run B: from tick 0 again, in the same process (catches state leaking
 *    through module-level variables or object identity);
 *  - run C: restored from run A's binary snapshot part-way through (catches
 *    state that lives outside the snapshot: a rejoining client would diverge).
 * In a browser the same function runs, so hashes can also be compared across
 * engines (tools/determinism.ts prints them; the browser page exposes them).
 *
 * Every 4 colonies are AI-driven, so the run covers foraging, building,
 * digging, brood, fighting, raids and the cave areas. The scripted actions are
 * a player colony's commands: markers, groups, digging, building, upgrades,
 * stance, ability, recall, plus illegal ones that every client ignores.
 */
import { EventBus } from '../core/events';
import { createWorld, GameSetup } from '../sim/mapGen';
import { World } from '../sim/world';
import { SURFACE, nestSpace } from '../sim/types';
import { encodeState, fnv1a64, restoreWorld } from '../sim/snapshot';
import { raisesAnts, tileAt } from '../sim/tiles';
import { Command, CommandBody, CommandSchedule, quantize, stepWithCommands } from '../sim/commands';

export const DET_SETUP: GameSetup = {
  seed: 20261024,
  style: 'meadow',
  width: 720,
  depth: 720,
  colonies: [
    { species: 'lasius', player: true, ai: true, developed: 3, startWorkers: 14 },
    { species: 'formica', player: false, ai: true, developed: 3, startWorkers: 14 },
    { species: 'solenopsis', player: false, ai: true, developed: 3, startWorkers: 14 },
    { species: 'atta', player: false, ai: true, developed: 3, startWorkers: 14 },
  ],
  caves: [
    { name: 'Root hollow', kind: 'cave', food: 60 },
    { name: 'Beetle den', kind: 'lair', food: 40 },
  ],
  food: 1.2,
  // wild creatures on: they hunt, are hunted and become carcasses, all through the deterministic path
  settings: { creatures: 1.5 },
};

/**
 * Scripted player orders for colony 0, as commands scheduled for the next
 * tick (the same path the UI uses).
 */
export function scriptedOrders(w: World, tick: number, sched: CommandSchedule): void {
  const c = w.colony(0);
  if (!c || !c.alive) return;
  let seq = tick * 8; // unique per player within the run
  const send = (b: CommandBody) => sched.add({ ...quantize(b), tick: tick + 1, player: 0, seq: seq++ & 0xffff } as Command);
  const cx = w.terrain.width / 2;
  const cy = w.terrain.depth / 2;
  const e = c.entrances[0];
  const g = w.nest(c.id)!;
  switch (tick) {
    case 200: {
      // a fighter group to a surface marker halfway to the map centre
      send({ type: 'placeMarker', i: 1, space: SURFACE, x: (e.sx + cx) / 2, y: (e.sy + cy) / 2 });
      const gr = [...c.groups].reverse().find((x) => raisesAnts(x) && x.type !== 'queen');
      if (gr) send({ type: 'assignGroup', group: gr.id, marker: 1 });
      break;
    }
    case 1200: {
      // paint a few dig hexes next to the dug floor
      let n = 0;
      for (let q = 0; q < g.cols * g.rows && n < 6; q++) {
        if (g.isHexDug(q) || !g.isHexDiggable(q)) continue;
        if (!g.neighbors(q).some((nb) => nb >= 0 && g.isHexDug(nb))) continue;
        send({ type: 'dig', q, on: true });
        n++;
      }
      break;
    }
    case 2400: {
      // build a food store on the first free dug hex (and try an illegal one: ignored on every client)
      send({ type: 'buildTile', q: 0, tile: 'food', caste: '' });
      for (let q = 0; q < g.cols * g.rows; q++) {
        if (!g.isHexDug(q) || g.isEntrance(q) || tileAt(c, q)) continue;
        send({ type: 'buildTile', q, tile: 'food', caste: '' });
        break;
      }
      break;
    }
    case 3000: {
      const t = c.tiles.find((x) => x.type === 'brood' && x.built);
      if (t) send({ type: 'markUpgrade', q: t.q });
      break;
    }
    case 4000:
      send({ type: 'setAggression', on: !c.aggressive });
      send({ type: 'useAbility' });
      break;
    case 5200:
      send({ type: 'removeMarker', i: 1 });
      break;
    case 6400: {
      // a marker inside the first cave, then a recall
      const cave = w.s.caves[0];
      const cg = cave ? w.nestOf(cave.space) : undefined;
      if (cave && cg) send({ type: 'placeMarker', i: 2, space: cave.space, x: cg.widthMm / 2, y: cg.depthMm / 2 });
      break;
    }
    case 9000:
      send({ type: 'recall' });
      break;
    case 9100:
      send({ type: 'placeMarker', i: 3, space: nestSpace(c.id), x: g.widthMm / 2, y: g.depthMm / 2 });
      break;
    case 9200:
      // a command for an AI colony is ignored (not that player's colony)
      sched.add({ type: 'recall', tick: tick + 1, player: 2, seq: 0 });
      break;
  }
}

export interface DetResult {
  ticks: number;
  every: number;
  /** hash per checkpoint, run A */
  a: string[];
  /** first checkpoint where run B differs (−1 = none) */
  bDiff: number;
  /** first checkpoint where the restored run C differs (−1 = none) */
  cDiff: number;
  /** checkpoint index run C started from */
  cFrom: number;
  ants: number;
  snapshotBytes: number;
  /** cached nest fields that did not match a fresh build (stale-cache hazards), as "tick space key" */
  staleFields: string[];
  ms: { a: number; b: number; c: number; hash: number };
}

function runFrom(w: World, from: number, to: number, every: number, out: string[], hashMs: { v: number }, onSnap?: (tick: number, w: World) => void, stale?: string[]): void {
  const sched = new CommandSchedule();
  for (let t = from; t < to; t++) {
    scriptedOrders(w, w.s.tick, sched);
    stepWithCommands(w, 0.05, sched);
    w.events.drain();
    if (w.s.tick % every === 0) {
      const h0 = now();
      out.push(fnv1a64(encodeState(w)));
      hashMs.v += now() - h0;
      if (stale) for (const [space, f] of w.gridFlows) for (const key of f.audit()) stale.push(`${w.s.tick} ${space} ${key}`);
      onSnap?.(w.s.tick, w);
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Run the check. `ticks` defaults to 20 minutes of game time. */
export function runDeterminism(ticks = 24000, every = 100, restoreAt = Math.floor(ticks / 4 / 100) * 100, setup: GameSetup = DET_SETUP, audit = true): DetResult {
  const hashMs = { v: 0 };
  const t0 = now();
  const wa = createWorld(setup, new EventBus());
  const a: string[] = [];
  const staleFields: string[] = [];
  let snap: Uint8Array | null = null;
  runFrom(
    wa,
    0,
    ticks,
    every,
    a,
    hashMs,
    (tick, w) => {
      if (tick === restoreAt) snap = encodeState(w);
    },
    audit ? staleFields : undefined,
  );
  const t1 = now();
  const wb = createWorld(setup, new EventBus());
  const b: string[] = [];
  runFrom(wb, 0, ticks, every, b, hashMs);
  const t2 = now();
  let bDiff = -1;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
    bDiff = i;
    break;
  }
  let cDiff = -1;
  const cFrom = restoreAt / every;
  if (snap) {
    const wc = restoreWorld(snap, new EventBus());
    const c: string[] = [];
    runFrom(wc, restoreAt, ticks, every, c, hashMs);
    for (let i = 0; i < c.length; i++) if (c[i] !== a[cFrom + i]) {
      cDiff = cFrom + i;
      break;
    }
  }
  const t3 = now();
  return {
    ticks,
    every,
    a,
    bDiff,
    cDiff,
    cFrom,
    ants: wa.s.ants.length,
    staleFields,
    snapshotBytes: snap ? (snap as Uint8Array).length : 0,
    ms: { a: t1 - t0, b: t2 - t1, c: t3 - t2, hash: hashMs.v },
  };
}
