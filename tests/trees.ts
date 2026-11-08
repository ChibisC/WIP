/**
 * The Trees layer (sim/trees.ts; claude/trees/01-spec-trees-layer.md; CHANGE_PLAN §30).
 *
 *   npx vite-node tests/trees.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { makeAnt } from '../src/sim/factory';
import { applyCommand } from '../src/sim/commands';
import { AS, SURFACE, TREES, nestSpace } from '../src/sim/types';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { flingAnt } from '../src/sim/combat';
import { kindsOf, nearestBranch, TK_LEAF, TK_WOOD } from '../src/sim/trees';
import { hasRouteHome } from '../src/sim/areas';
import { BUILD_ID } from '../src/net/messages';
import { goHome } from '../src/sim/movement';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const t0 = Date.now();
const run = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * 20); i++) {
    w.step(0.05);
    w.events.drain();
  }
};
const runUntil = (w: World, done: () => boolean, maxS: number) => {
  for (let i = 0; i < Math.round(maxS * 20) && !done(); i++) {
    w.step(0.05);
    w.events.drain();
  }
  return done();
};
function world(more: Record<string, unknown> = {}, seed = 5): World {
  return createWorld(
    {
      seed,
      style: 'meadow',
      width: 800,
      depth: 800,
      food: 1,
      colonies: [
        { species: 'formica', player: true, ai: false },
        { species: 'lasius', player: false, ai: true },
      ],
      settings: { creatures: 0, titanRaids: false },
      ...more,
    } as never,
    new EventBus(),
  );
}

// ---------------------------------------------------------------- off by default: nothing of the layer exists
{
  const w = world();
  check('without a tree colony or the flag: no trees state', !w.s.trees);
  check('… no trees grid', !w.nestOf(TREES));
  check('… no climb points', w.entrancesOf(TREES).length === 0);
  check('… nothing blocks the ground for trunks', w.terrain.trunks.length === 0);
  check('… no food in the trees', w.s.food.every((f) => f.space !== TREES));
}

// ---------------------------------------------------------------- on: the map, the climb, markers, the fall
{
  const w = world({ trees: true, map: 'meadowPond' });
  const d = w.s.trees!;
  const g = w.nestOf(TREES)!;
  check('with the flag: the trees map exists', !!d && !!g, `${d?.trunks.length} trees`);
  check('the canopy grid lies in the ground frame', g.widthMm >= w.terrain.width - 20 && g.depthMm >= w.terrain.depth - 20, `${g.widthMm.toFixed(0)}×${g.depthMm.toFixed(0)} over ${w.terrain.width}×${w.terrain.depth}`);
  check('every trunk blocks the ground', d.trunks.every((t) => !w.terrain.passable(t.x, t.y)));
  check('4–6 sites, all three kinds', d.sites.length >= 4 && d.sites.length <= 6 && ['leaf', 'hollow', 'fork'].every((k) => d.sites.some((s) => s.kind === k)), d.sites.map((s) => s.kind).join(','));
  check('the climb points are the space’s entrances', w.entrancesOf(TREES).length === d.trunks.reduce((n, t) => n + t.climbs.length, 0));
  const kinds = kindsOf(d);
  let sky = 0;
  for (let q = 0; q < kinds.length; q++) if (!kinds[q] && g.isHexDug(q)) sky++;
  check('walkable only on wood, leaves and trunk tops', sky === 0, `${sky} dug sky hexes`);
  let wood = 0;
  for (let q = 0; q < kinds.length; q++) if ((kinds[q] === TK_WOOD || kinds[q] === TK_LEAF) && !g.isHexDug(q)) wood++;
  check('every branch and leaf hex is walkable', wood === 0, `${wood} undug`);

  // an ant sent to a marker in the trees climbs the nearest trunk and arrives on the branches
  const me = w.s.colonies[0];
  const tr = d.trunks[0];
  const e = tr.climbs[0];
  // (120 mm out from the trunk past its climb point: not in the trunk)
  const ax = e.sx + ((e.sx - tr.x) / Math.hypot(e.sx - tr.x, e.sy - tr.y)) * 120;
  const ay = e.sy + ((e.sy - tr.y) / Math.hypot(e.sx - tr.x, e.sy - tr.y)) * 120;
  const a = makeAnt(w, me.id, 'formica_worker', SURFACE, ax, ay);
  a.state = AS.Idle;
  // (in a group: the tile of one of the colony's own workers)
  const tileOf = w.s.ants.find((q) => q.colony === me.id && q.id !== me.queen && q.tile >= 0)!.tile;
  a.tile = tileOf;
  const site = d.sites[0];
  applyCommand(w, { type: 'placeMarker', i: 0, space: TREES, x: site.x, y: site.y, tick: w.s.tick, player: 0, seq: 1 });
  for (const gr of me.groups) applyCommand(w, { type: 'assignGroup', group: gr.id, marker: 0, tick: w.s.tick, player: 0, seq: 2 });
  const m = me.markers[0];
  check('a marker in the trees lies on a branch', m.placed && m.space === TREES && g.isAirAt(m.x, m.y));
  const up = runUntil(w, () => a.space === TREES, 60);
  check('the ant climbs into the trees', up, `after ${w.time.toFixed(1)} s`);
  check('… and is held on the trunk for the climb', (a.trunkT ?? 0) > 0 && a.trunkUp === 1, `trunkT ${a.trunkT?.toFixed(1)}`);
  const x0 = a.x;
  const y0 = a.y;
  run(w, 2);
  check('… without moving while on the trunk', Math.hypot(a.x - x0, a.y - y0) < 0.01 && (a.trunkT ?? 0) > 0);
  const arrived = runUntil(w, () => a.space === TREES && Math.hypot(a.x - m.x, a.y - m.y) < 30, 120);
  check('the ant walks the branches to the marker', arrived, `${Math.hypot(a.x - m.x, a.y - m.y).toFixed(0)} mm away after ${w.time.toFixed(0)} s`);
  // never off the branches
  let off = 0;
  for (let i = 0; i < 100; i++) {
    w.step(0.05);
    w.events.drain();
    for (const q of w.s.ants) if (q.space === TREES && q.state !== AS.Flung && !g.isAirAt(q.x, q.y)) off++;
  }
  check('ants in the trees stay on wood and leaves', off === 0, `${off} ant-ticks off`);
  check('an ant in the trees has a route home', hasRouteHome(w, a));

  // a marker dropped in the sky moves to the nearest branch
  const sky0 = (() => {
    for (let q = 0; q < kinds.length; q++) if (!kinds[q]) return g.hexCenter(q);
    return null;
  })();
  if (sky0) {
    const nb = nearestBranch(w, sky0.x, sky0.y, 40);
    check('nearestBranch finds a branch for a sky point', !!nb && g.isAirAt(nb!.x, nb!.y));
  }

  // the fall: a fling in the trees drops the ant to the ground below, dazed
  const fx = a.x;
  const fy = a.y;
  flingAnt(w, a, a.x + 5, a.y, 1);
  check('a fling in the trees moves the ant to the ground at once', a.space === SURFACE && (a.state as AS) === AS.Flung && a.fz > 100, `fz ${a.fz.toFixed(0)}`);
  const landed = runUntil(w, () => (a.state as AS) !== AS.Flung, 10);
  check('… it lands below', landed && Math.hypot(a.x - fx, a.y - fy) < 60, `${Math.hypot(a.x - fx, a.y - fy).toFixed(0)} mm from where it was flung`);
  check('… dazed', a.stun > 1, `stun ${a.stun.toFixed(2)}`);

  // marker on the ground: the ants in the trees come down
  applyCommand(w, { type: 'placeMarker', i: 0, space: SURFACE, x: 400, y: 400, tick: w.s.tick, player: 0, seq: 3 });
  const b = makeAnt(w, me.id, 'formica_worker', TREES, site.x, site.y);
  b.state = AS.Idle;
  b.tile = tileOf;
  for (const gr of me.groups) applyCommand(w, { type: 'assignGroup', group: gr.id, marker: 0, tick: w.s.tick, player: 0, seq: 4 });
  const down = runUntil(w, () => b.space === SURFACE, 120);
  check('a marker on the ground brings a tree ant down a trunk', down, `after ${w.time.toFixed(0)} s`);
  check('… held on the trunk going down', down && (b.trunkT ?? 0) > 0 && b.trunkUp === 0);

  // saves: the layer round-trips
  const bytes = encodeState(w);
  const w2 = restoreWorld(bytes, new EventBus());
  check('save round-trip keeps the trees', !!w2.s.trees && !!w2.nestOf(TREES) && w2.terrain.trunks.length === d.trunks.length);
  check('… same state hash', hashState(w2) === hashState(w));
  run(w, 3);
  run(w2, 3);
  check('… and the same future', hashState(w2) === hashState(w));
}

// ---------------------------------------------------------------- the sandbox toggle builds it at runtime (any map)
{
  const w = world({ sandbox: true });
  check('sandbox: off at first', !w.s.trees);
  const err = applyCommand(w, { type: 'sandboxSet', key: 'trees', on: true, tick: w.s.tick, player: 0, seq: 1 });
  check('sandboxSet trees builds the layer', !err && !!w.s.trees && !!w.nestOf(TREES), err ?? '');
  run(w, 2);
}

// ---------------------------------------------------------------- a tree nest (the framework): holes on a branch
{
  const w = world({ trees: true, map: 'meadowPond', colonies: [{ species: 'formica', player: true, ai: false }, { species: 'lasius', player: false, ai: true, treeSite: 0, name: 'tree test' }] });
  const d = w.s.trees!;
  const c = w.s.colonies[1];
  check('a colony with treeSite nests on the site', c.treeSite === 0 && d.sites[0].nest === c.id);
  check('… its hole lies in the trees', c.entrances.length === 1 && c.entrances[0].space === TREES);
  const g = w.nestOf(TREES)!;
  check('… on a branch', g.isAirAt(c.entrances[0].sx, c.entrances[0].sy));
  // (a dry spot on open ground)
  const spot = [[800, 1500], [1000, 1500], [600, 1500], [800, 100], [300, 800]].find(([x, y]) => w.walkable(SURFACE, x, y))!;
  const a = makeAnt(w, c.id, 'lasius_worker', SURFACE, spot[0], spot[1]);
  a.state = AS.Idle;
  check('… its ants on the ground have a route home', hasRouteHome(w, a));
  // goHome from the ground: up a trunk, along the branches, in

  let home = false;
  for (let i = 0; i < 20 * 240 && !home; i++) {
    if (!a.trunkT) home = goHome(w, a, 0.05);
    w.step(0.05);
    w.events.drain();
  }
  check('an ant walks home into the tree nest (up the trunk, along the branch, in)', home && a.space === nestSpace(c.id), `space ${a.space} after ${w.time.toFixed(0)} s`);
}

check('protocol bumped for the layer', BUILD_ID === 'ud-mp-15', BUILD_ID);
console.log(`${failed ? failed + ' failed' : 'all trees tests passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
