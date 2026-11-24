/**
 * The Trees layer (sim/trees.ts; claude/trees/01-spec-trees-layer.md; CHANGE_PLAN §33).
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
import { climbSeconds, kindsOf, nearestBranch, TK_LEAF, TK_WOOD, treesApart, treesFloorZ, treesSlopeSpeed, upgradeWorldTrees } from '../src/sim/trees';
import { LAYERS, TREES as TB } from '../src/sim/balance';
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
  check('every tree is joined to the others by boughs (one crown)', new Set(d.trunks.map((t) => t.comp)).size === 1, d.trunks.map((t) => t.comp).join(','));
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

// ---------------------------------------------------------------- trees v2: tiers, slopes, drops, reach, the climb's height, falls
{
  const w = world({ trees: true, map: 'meadowPond' });
  const d = w.s.trees!;
  const g = w.nestOf(TREES)!;
  const td = w.treesData!;
  check('the floor has a height per fine cell', !!td && td.h.length === g.w * g.h);
  const tiers = new Map<number, number>();
  let slopes = 0;
  let jumps = 0;
  let mismatch = 0;
  const lv = (z: number) => {
    const l = z / TB.tierStep;
    return Math.abs(l - Math.round(l)) < 1e-3 ? Math.round(l) : -1;
  };
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const k = y * g.w + x;
      if ((td.h[k] >= 0) !== g.isAir(x, y)) mismatch++;
      if (td.h[k] < 0) continue;
      const l = lv(td.h[k]);
      if (l >= 0) tiers.set(l, (tiers.get(l) ?? 0) + 1);
      else slopes++;
      if (x + 1 < g.w && td.h[k + 1] >= 0 && Math.abs(td.h[k + 1] - td.h[k]) > TB.stepMax) jumps++;
      if (y + 1 < g.h && td.h[k + g.w] >= 0 && Math.abs(td.h[k + g.w] - td.h[k]) > TB.stepMax) jumps++;
    }
  check('the walkable cells are the floor cells', mismatch === 0, `${mismatch} differ`);
  check('the canopy has 2–4 tiers', tiers.size >= 2 && tiers.size <= 4, [...tiers.entries()].map(([l, c]) => `tier ${l}: ${c}`).join(', '));
  check('… and sloping floor between them', slopes > 500, `${slopes} slope cells`);
  check('drops between tiers block (no walkable step over stepMax)', jumps === 0, `${jumps} steps`);
  check('every trunk knows its crotch’s tier and its crown’s tiers', d.trunks.every((t) => t.tiers >= 2 && t.tiers <= 4 && t.z === Math.floor(t.tiers / 2) * TB.tierStep), d.trunks.map((t) => `${t.tiers}/${t.z}`).join(' '));
  check('… and the crotch is floor at that height', d.trunks.every((t) => Math.abs(treesFloorZ(w, t.x, t.y) - t.z) < 1e-6));
  const t0 = d.trunks[0];
  check('a climb takes the time of its height, up to the crotch', Math.abs(climbSeconds(w, t0) - (TB.climbSec * (d.height + t0.z)) / TB.height) < 1e-9 && climbSeconds(w, t0) > TB.climbSec, `${climbSeconds(w, t0).toFixed(2)} s`);
  // a slope cell: walking up it is slower (as on the ground's ramps), down it is not
  let sx = -1;
  let sy = -1;
  let ux = 0;
  let uy = 0;
  for (let k = 0; k < td.h.length && sx < 0; k++) {
    if (td.h[k] < 0 || lv(td.h[k]) >= 0) continue;
    const x = k % g.w;
    const y = (k - x) / g.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k2 = (y + dy * 2) * g.w + x + dx * 2;
      const k3 = (y - dy * 2) * g.w + x - dx * 2;
      if (td.h[k2] > td.h[k] + 1 && td.h[k3] >= 0 && td.h[k3] < td.h[k] - 1) {
        sx = (x + 0.5) * g.cell;
        sy = (y + 0.5) * g.cell;
        ux = dx;
        uy = dy;
        break;
      }
    }
  }
  check('up a sloping branch at the ramps’ speed, down at full speed', sx >= 0 && treesSlopeSpeed(w, sx, sy, ux, uy) === LAYERS.upSpeed && treesSlopeSpeed(w, sx, sy, -ux, -uy) === 1);
  // two floor points close in plan but on different tiers (a drop between them)
  let A: [number, number] | null = null;
  let B: [number, number] | null = null;
  for (let k = 0; k < td.h.length && !A; k++) {
    if (td.h[k] < 0) continue;
    const x = k % g.w;
    const y = (k - x) / g.w;
    for (let dy = -12; dy <= 12 && !A; dy++)
      for (let dx = -12; dx <= 12; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
        const k2 = yy * g.w + xx;
        if (td.h[k2] >= 0 && td.h[k2] - td.h[k] >= TB.tierStep - 0.01) {
          A = [(x + 0.5) * g.cell, (y + 0.5) * g.cell];
          B = [(xx + 0.5) * g.cell, (yy + 0.5) * g.cell];
          break;
        }
      }
  }
  check('floor on two tiers side by side exists (a branch passing over another)', !!A && !!B);
  if (A && B) {
    check('… they are out of each other’s reach', treesApart(w, A[0], A[1], B[0], B[1]) && !treesApart(w, A[0], A[1], A[0], A[1]));
    // an enemy right across the drop is not fought
    const me = w.s.colonies[0];
    const foe = w.s.colonies[1];
    const a = makeAnt(w, me.id, 'formica_worker', TREES, A[0], A[1]);
    const b = makeAnt(w, foe.id, 'lasius_worker', TREES, B[0], B[1]);
    a.state = AS.Idle;
    b.state = AS.Idle;
    const ha = a.hp;
    const hb = b.hp;
    let fought = 0;
    for (let i = 0; i < 40; i++) {
      w.step(0.05);
      w.events.drain();
      if ((a.state as AS) === AS.Attack || (b.state as AS) === AS.Attack) fought++;
    }
    check('… an enemy right across a drop is not fought', fought === 0 && a.hp === ha && b.hp === hb, `${fought} ticks attacking, hp ${a.hp}/${ha} ${b.hp}/${hb}`);
    // a fling from the higher tier falls from there
    const zB = treesFloorZ(w, b.x, b.y);
    flingAnt(w, b, b.x - 5, b.y, 1);
    check('a fling falls from the height the ant stood at', b.space === SURFACE && b.fz >= d.height + zB, `fz ${b.fz.toFixed(0)} from ${(d.height + zB).toFixed(0)}`);
  }
  // an old save (version 5, before the tiers): its canopy is rebuilt, what stood in the trees ends on the floor
  const fresh = world({ trees: true, map: 'meadowPond' });
  const c = makeAnt(w, w.s.colonies[0].id, 'formica_worker', TREES, 2, 2);
  c.state = AS.Idle;
  w.s.version = 5;
  const w5 = restoreWorld(encodeState(w), new EventBus());
  const g5 = w5.nestOf(TREES)!;
  const c5 = w5.s.ants.find((q) => q.id === c.id)!;
  let same = g5.soil.length === fresh.nestOf(TREES)!.soil.length;
  for (let k = 0; same && k < g5.soil.length; k++) if (g5.soil[k] !== fresh.nestOf(TREES)!.soil[k]) same = false;
  check('a version-5 save rebuilds its canopy (the same floor as a new match)', same && w5.s.version === 6 && !!w5.treesData);
  check('… and moves what stood off the floor onto a branch', g5.isAirAt(c5.x, c5.y), `${c5.x.toFixed(0)},${c5.y.toFixed(0)}`);
  void upgradeWorldTrees;
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

check('protocol bumped for trees v2', BUILD_ID === 'ud-mp-17', BUILD_ID);
console.log(`${failed ? failed + ' failed' : 'all trees tests passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
