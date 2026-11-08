/**
 * The shared underground: set tunnel routes between nests (claude/underground/01-spec-shared-underground-tunnels.md,
 * user 2026-11-06; CHANGE_PLAN §27; sim/tunnels.ts).
 *
 *   npx vite-node tests/tunnels.ts
 */
import { EventBus, SimEvent } from '../src/core/events';
import { createWorld, registerSystems } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, SURFACE, nestSpace } from '../src/sim/types';
import { TUNNELS } from '../src/sim/balance';
import { NestGrid, SOIL_GATE, SOIL_ROCK, SOIL_ROUTE, chainToward } from '../src/world/nestGrid';
import { NEST_COLS, NEST_ROWS } from '../src/sim/colony';
import { canPlaceTile } from '../src/sim/tiles';
import { makeAnt } from '../src/sim/factory';
import { applyCommand, decodeCommandLog, encodeCommandLog } from '../src/sim/commands';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { assignGroup, placeMarker } from '../src/sim/markers';
import { crossIfPastRim, dugFromGate, gateConnected, halfIn, otherHalf, ownHalf, routeFrontier, routeUsable, routes, sealedAt, setRouteDig, upgradeWorldTunnels } from '../src/sim/tunnels';
import { hasRouteHome } from '../src/sim/areas';
import { Fog } from '../src/game/fog';
import type { SpeciesId } from '../src/sim/species';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const t0 = Date.now();
const run = (w: World, s: number, bus?: EventBus) => {
  for (let i = 0; i < Math.round(s * 20); i++) {
    w.step(0.05);
    (bus ?? w.events).drain();
  }
};
const runUntil = (w: World, done: () => boolean, maxS: number, bus?: EventBus) => {
  for (let i = 0; i < Math.round(maxS * 20) && !done(); i++) {
    w.step(0.05);
    (bus ?? w.events).drain();
  }
  return done();
};
const SPECIES: SpeciesId[] = ['lasius', 'formica', 'atta', 'solenopsis', 'eciton', 'hell', 'aurimyrmex', 'termant', 'nasutitermes', 'rhynchotermes'];

function world(n: number, seed = 5, more: Record<string, unknown> = {}, bus = new EventBus()): World {
  return createWorld({ seed, style: 'meadow', width: n <= 2 ? 640 : n <= 4 ? 800 : 980, depth: n <= 2 ? 640 : n <= 4 ? 800 : 980, food: 1, colonies: SPECIES.slice(0, n).map((species, i) => ({ species, player: i === 0, ai: i > 0 })), settings: { creatures: 0, titanRaids: false }, ...more } as never, bus);
}

/** Dig the colony's nest out to its gate on route r (a straight passage from the queen). */
function digToGate(w: World, cid: number, rid: number): void {
  const c = w.colony(cid)!;
  const g = w.nest(cid)!;
  const own = ownHalf(routes(w)[rid], cid)!;
  const q0 = c.tiles.find((t) => t.type === 'queen')!.q;
  for (const q of chainToward(g, q0, own.gate, 80, (q) => g.isHexDiggable(q) || g.isHexDug(q))) if (q !== own.gate && !g.isHexDug(q)) (g.softenHex(q), g.completeHex(q));
}

function crew(w: World, cid: number, n: number): void {
  const c = w.colony(cid)!;
  const g = w.nest(cid)!;
  const worker = c.castes.find((k) => k.endsWith('worker')) ?? c.castes[0];
  const p = g.hexCenter(c.tiles.find((t) => t.type === 'queen')!.q);
  for (let i = 0; i < n; i++) makeAnt(w, cid, worker, nestSpace(cid), p.x + (i % 4) * 2, p.y + Math.floor(i / 4) * 2, 0).task = 'idle';
  c.infiniteFood = true;
}

// ---------------------------------------------------------------- the margin and the routes
{
  const w = world(2);
  const g = w.nest(0)!;
  check('a colony nest grid is the diggable interior plus the rock margin', g.margin === TUNNELS.margin && g.cols === NEST_COLS + 2 * TUNNELS.margin && g.rows === NEST_ROWS + 2 * TUNNELS.margin);
  let rock = 0;
  let interiorRock = 0;
  for (let q = 0; q < g.cols * g.rows; q++) {
    if (g.hexSoil[q] === SOIL_ROCK) rock++;
    if (g.isInterior(q) && g.hexSoil[q] === SOIL_ROCK) interiorRock++;
  }
  check('the margin is rock, the interior has none', rock > 0 && interiorRock === 0, `${rock} rock hexes`);
  const rq = g.hexIndex(0, 0);
  check('rock cannot be dug, designated or broken (titans included)', !g.isHexDiggable(rq) && (g.designateHex(rq, true), !g.hexDesig[rq]) && !g.breakHex(rq) && g.hexSoil[rq] === SOIL_ROCK);
  const rs = routes(w);
  check('two colonies: one route, both halves to the rim, gates on the interior edge as gate soil', rs.length === 1 && rs[0].halves.every((h) => w.nestOf(h.space)!.isInteriorEdge(h.gate) && w.nestOf(h.space)!.hexSoil[h.gate] === SOIL_GATE && h.steps[h.steps.length - 1].some((q) => w.nestOf(h.space)!.isRim(q))));
  const h = rs[0].halves[0];
  const hg = w.nestOf(h.space)!;
  const walled = h.steps.slice(1).every((st) => st.every((q) => q < 0 || hg.neighbors(q).every((m) => m < 0 || hg.isInterior(m) || hg.hexSoil[m] === SOIL_ROCK || hg.routeOf(m) === 0)));
  check('the route is walled by rock all along and its soil is diggable route soil', walled && h.steps.slice(1).every((st) => st.every((q) => q < 0 || (hg.hexSoil[q] === SOIL_ROUTE && hg.isHexDiggable(q)))));
  const flower = hg.flowers[0];
  check('the gate keeps away from the entrance flower', flower.every((f) => hg.hexDistance(f, h.gate) >= TUNNELS.gateAway));
  check('a tile cannot stand on a gate (the satellite-nest hook is off for every species)', canPlaceTile(w, w.colony(0)!, 'food', ownHalf(rs[0], 0)!.gate) !== null);
}
{
  const w4 = world(4, 7);
  check('four colonies: a route between every pair', routes(w4).length === 6, `${routes(w4).length}`);
  const w6 = world(6, 7);
  const rs = routes(w6);
  const per = new Map<number, number>();
  for (const r of rs) {
    per.set(r.a, (per.get(r.a) ?? 0) + 1);
    per.set(r.b, (per.get(r.b) ?? 0) + 1);
  }
  check('six colonies: nearest neighbours only, every nest has a route, no more than all pairs', rs.length < 15 && w6.s.colonies.every((c) => (per.get(c.id) ?? 0) >= 1), `${rs.length} routes`);
  const wNone = world(2, 5, { tunnels: 'none' });
  check("a level may turn routes off ('none')", routes(wNone).length === 0);
  const wAuth = world(3, 5, { tunnels: [[0, 2]] });
  check('a level may author the pairs', routes(wAuth).length === 1 && routes(wAuth)[0].a === 0 && routes(wAuth)[0].b === 2);
  // deterministic: the same seed gives the same routes
  const a = routes(world(4, 9)).map((r) => r.halves.map((h) => h.gate + ':' + h.steps.flat().join('.')).join('/')).join('|');
  const b = routes(world(4, 9)).map((r) => r.halves.map((h) => h.gate + ':' + h.steps.flat().join('.')).join('/')).join('|');
  check('route generation is deterministic', a === b);
}

// ---------------------------------------------------------------- digging a route: one side all the way
{
  const bus = new EventBus();
  const w = world(2, 3, {}, bus);
  const ev: SimEvent[] = [];
  bus.onAny((e) => {
    if (e.t === 'tunnelWarn' || e.t === 'tunnelOpen' || e.t === 'tunnelBreach' || e.t === 'tunnelDig') ev.push(e);
  });
  const me = w.colony(0)!;
  const rival = w.colony(1)!;
  const r = routes(w)[0];
  const own = ownHalf(r, 0)!;
  const other = otherHalf(r, own);
  digToGate(w, 0, 0);
  crew(w, 0, 6);
  run(w, 1, bus);
  const g = w.nest(0)!;
  const bad = applyCommand(w, { type: 'dig', q: own.steps[2][0], on: true, tick: w.s.tick, player: 0, seq: 1 });
  check('the Dig tool on a route hex past the gate is refused', bad !== null, bad ?? '');
  const ok = applyCommand(w, { type: 'dig', q: own.gate, on: true, tick: w.s.tick, player: 0, seq: 2 });
  check('the Dig tool on the gate starts the route dig', ok === null && me.routeDig === 0);
  check('the route frontier is the gate (it touches dug floor)', routeFrontier(w, me).some((d) => d.q === own.gate));
  const rivalWarned = runUntil(w, () => other.warned, 420, bus);
  check('digging on, the defender is warned when the frontier is within warnRange of its gate', rivalWarned && ev.some((e) => e.t === 'tunnelWarn' && e.colony === 1 && e.space === nestSpace(1)), `${(w.time / 60).toFixed(1)} min`);
  run(w, 5, bus);
  check('… and a dig sound comes from behind its wall', ev.some((e) => e.t === 'tunnelDig' && e.colony === 1));
  // my diggers out in the rival's half are not in its nest: no invasion alarm, and sealed from its sight
  const inOther = w.s.ants.filter((a) => a.colony === 0 && a.space === nestSpace(1));
  check('my diggers past the rim stand in the rival’s space, sealed off from its nest (no intruders counted)', inOther.length > 0 && inOther.every((a) => sealedAt(w, a.space, a.x, a.y)) && (rival.intruders?.length ?? 0) === 0, `${inOther.length} diggers over`);
  check('the diggers have a route home (no "no route home" weakening)', inOther.every((a) => hasRouteHome(w, a)));
  const opened = runUntil(w, () => r.open, 300, bus);
  check('the route opens when both halves are dug through, for good', opened && r.openT > 0 && ev.some((e) => e.t === 'tunnelOpen' && e.route === 0), `${(w.time / 60).toFixed(1)} min`);
  const secs = w.time;
  check('a normal crew of six digs a route in about 3–6 minutes', secs > 150 && secs < 390, `${(secs / 60).toFixed(1)} min`);
  const breached = runUntil(w, () => !!other.joined, 300, bus);
  check('the diggers break on into the rival’s dug floor and the breach is told', breached && gateConnected(w, other) && ev.some((e) => e.t === 'tunnelBreach' && e.colony === 1 && e.by === 0), `${(w.time / 60).toFixed(1)} min`);
  check('nothing left to dig: the colony’s route dig ends by itself', me.routeDig === -1);
  // a group walks through to the rival's queen (its defenders removed: the walk is what is tested, fights are combat's)
  w.s.ants = w.s.ants.filter((a) => a.colony !== 1);
  w.reindex();
  run(w, 2, bus);
  const rg = w.nest(1)!;
  const rq = rival.tiles.find((t) => t.type === 'queen')!.q;
  const rp = rg.hexCenter(rq);
  applyCommand(w, { type: 'placeMarker', i: 2, space: nestSpace(1), x: rp.x, y: rp.y, tick: w.s.tick, player: 0, seq: 3 });
  for (const gr of me.groups) applyCommand(w, { type: 'assignGroup', group: gr.id, marker: 2, tick: w.s.tick, player: 0, seq: 4 });
  const arrived = runUntil(w, () => w.s.ants.filter((a) => a.colony === 0 && a.space === nestSpace(1) && Math.hypot(a.x - rp.x, a.y - rp.y) < 45).length >= 3, 240, bus);
  check('a marker in the rival nest: the group walks through the tunnel to it (no teleport: every ant crossed at the rim)', arrived && w.s.ants.filter((a) => a.colony === 0 && a.space === nestSpace(1)).every((a) => a.ent === -2));
  check('the rival now counts them as intruders (they are in its nest, not sealed)', w.s.ants.some((a) => a.colony === 0 && a.space === nestSpace(1) && !sealedAt(w, a.space, a.x, a.y)));
  // the fog: the rival's nest is seen only round my ants
  const fog = new Fog();
  fog.update(w, me, nestSpace(1));
  let seen = 0;
  let dark = 0;
  for (let q = 0; q < rg.cols * rg.rows; q++) {
    const l = fog.level(nestSpace(1), q);
    if (l === 0) seen++;
    else if (l === 2) dark++;
  }
  check('the attacker’s fog: part of the rival nest seen round its ants, the rest dark or remembered', seen > 0 && dark > 0, `${seen} seen, ${dark} dark`);
  fog.update(w, me, nestSpace(0));
  check('my own nest has no fog', !fog.hasFog(nestSpace(0)));
  check('the route stays open when the rival colony dies', !rival.alive && r.open);
  // the command roundtrip
  const log = encodeCommandLog([{ type: 'digRoute', route: 0, on: true, tick: 5, player: 0, seq: 9 }]);
  const back = decodeCommandLog(log);
  check('digRoute commands encode and decode', back.length === 1 && back[0].type === 'digRoute' && (back[0] as { route: number }).route === 0 && (back[0] as { on: boolean }).on);
}

// ---------------------------------------------------------------- both ends: meeting in the middle, one at a time, pausing
{
  const w = world(2, 11);
  const me = w.colony(0)!;
  const rival = w.colony(1)!;
  const r = routes(w)[0];
  digToGate(w, 0, 0);
  digToGate(w, 1, 0);
  crew(w, 0, 6);
  crew(w, 1, 6);
  run(w, 1);
  setRouteDig(w, me, 0);
  setRouteDig(w, rival, 0);
  const opened = runUntil(w, () => r.open, 420);
  const meHalf = ownHalf(r, 0)!;
  const rivalHalf = ownHalf(r, 1)!;
  check('both colonies digging from their own gates meet: the route opens in about half the time', opened && w.time < 240, `${(w.time / 60).toFixed(1)} min`);
  check('… each side dug its own half (the halves met at the rim)', dugFromGate(w, meHalf) === meHalf.steps.length && dugFromGate(w, rivalHalf) === rivalHalf.steps.length);
  // one route at a time: a second route pauses the first (progress stays)
  const w3 = world(3, 11);
  const c = w3.colony(0)!;
  const rs = routes(w3).filter((x) => x.a === 0 || x.b === 0);
  digToGate(w3, 0, rs[0].id);
  crew(w3, 0, 6);
  run(w3, 1);
  setRouteDig(w3, c, rs[0].id);
  run(w3, 60);
  const p1 = dugFromGate(w3, ownHalf(rs[0], 0)!);
  setRouteDig(w3, c, rs[1].id);
  run(w3, 30);
  check('one route at a time: marking another pauses the first, its progress kept', c.routeDig === rs[1].id && dugFromGate(w3, ownHalf(rs[0], 0)!) === p1 && p1 > 0, `${p1} steps kept`);
  const notMine = setRouteDig(w3, c, routes(w3).find((x) => x.a !== 0 && x.b !== 0)!.id);
  check('a colony cannot dig a route it has no gate on', !notMine);
}

// ---------------------------------------------------------------- crossing the rim: the halves face each other
{
  const w = world(2, 3);
  const r = routes(w)[0];
  const h = r.halves[0];
  const o = r.halves[1];
  const g = w.nestOf(h.space)!;
  const og = w.nestOf(o.space)!;
  for (const half of r.halves) for (const st of half.steps) for (const q of st) if (q >= 0) (w.nestOf(half.space)!.softenHex(q), w.nestOf(half.space)!.completeHex(q));
  r.open = true;
  const rim = h.steps[h.steps.length - 1][0];
  const ctr = g.hexCenter(rim);
  const a = makeAnt(w, 0, w.colony(0)!.castes[0], h.space, ctr.x, ctr.y, 0);
  const EDGE = [-Math.PI / 6, Math.PI / 6, Math.PI / 2, (5 * Math.PI) / 6, (7 * Math.PI) / 6, -Math.PI / 2];
  a.x = ctr.x + Math.cos(EDGE[h.dir]) * g.R * 0.6;
  a.y = ctr.y + Math.sin(EDGE[h.dir]) * g.R * 0.6;
  const crossed = crossIfPastRim(w, a, r, h);
  const oq = og.hexAt(a.x, a.y);
  check('an ant past its rim step’s centre comes out in the other half’s rim step, on dug floor, heading inward', crossed && a.space === o.space && o.steps[o.steps.length - 1].includes(oq) && og.isAirAt(a.x, a.y));
  check('an ant short of the rim stays', !crossIfPastRim(w, { space: h.space, x: ctr.x, y: ctr.y, h: 0 }, r, h));
  check('a closed route carries nobody but its digger', !routeUsable(w, { ...r, open: false }, 1));
}

// ---------------------------------------------------------------- old saves: the margin and the routes on load
{
  const w = world(2, 13);
  const c = w.colony(0)!;
  // a version-3 world: strip the margins (a grid without one, every index and position as before the feature)
  const st = JSON.parse(JSON.stringify((() => { encodeState(w); return w.s; })()));
  for (const col of w.s.colonies) {
    const g = w.nest(col.id)!;
    const m = g.margin;
    const old = new NestGrid({ cols: g.cols - 2 * m, rows: g.rows - 2 * m, R: g.R, seed: g.seed });
    const off = old.embedOffset(m);
    const sh = (q: number) => (q < 0 ? q : old.hexIndex(g.hexCol(q) - m, g.hexRow(q) - m));
    for (let q = 0; q < old.cols * old.rows; q++) {
      const nq = g.hexIndex(old.hexCol(q) + m, old.hexRow(q) + m);
      old.hexSoil[q] = g.hexSoil[nq] === SOIL_GATE ? 2 : g.hexSoil[nq];
      old.hexWork[q] = g.hexWork[nq];
      old.hexTotal[q] = g.hexTotal[nq];
    }
    for (let y = 0; y < old.h; y++) for (let x = 0; x < old.w; x++) old.soil[y * old.w + x] = g.soil[(y + Math.round(off.y / g.cell)) * g.w + x + Math.round(off.x / g.cell)];
    old.setEntranceLists({ entrances: g.entrances.map(sh), tunnels: g.tunnels.map((t) => t.map(sh)), flowers: g.flowers.map((t) => t.map(sh)) });
    const sc = st.colonies[col.id];
    for (const t of sc.tiles) t.q = sh(t.q);
    for (const e of sc.entrances) e.q = sh(e.q);
    for (const a of st.ants) {
      if (a.colony === col.id) ((a.tile = sh(a.tile)), (a.jobQ = sh(a.jobQ)));
      if (a.space === nestSpace(col.id)) ((a.x -= off.x), (a.y -= off.y), (a.px -= off.x), (a.py -= off.y));
    }
    for (const b of st.brood) if (b.colony === col.id) ((b.tile = sh(b.tile)), (b.x -= off.x), (b.y -= off.y));
    for (const f of st.food) if (f.space === nestSpace(col.id)) ((f.x -= off.x), (f.y -= off.y), (f.px -= off.x), (f.py -= off.y));
    st.nests[nestSpace(col.id)] = old.serialize();
  }
  st.version = 3;
  delete st.routes;
  const queenQ = c.tiles.find((t) => t.type === 'queen')!.q;
  const info = console.info;
  console.info = () => {};
  const w2 = new World(st, new EventBus());
  registerSystems(w2);
  console.info = info;
  const g2 = w2.nest(0)!;
  const c2 = w2.colony(0)!;
  check('a version-3 save loads with the margin: the grid grown, version 5 (the current)', g2.margin === TUNNELS.margin && w2.s.version === 5 && g2.cols === NEST_COLS + 2 * TUNNELS.margin);
  check('… tiles, entrances and ants shifted with it (the queen on her tile, on dug floor)', c2.tiles.find((t) => t.type === 'queen')!.q === queenQ && w2.antById.get(c2.queen)!.tile === w.antById.get(c.queen)!.tile && g2.isHexDug(queenQ) && w2.walkable(nestSpace(0), w2.antById.get(c2.queen)!.x, w2.antById.get(c2.queen)!.y) && g2.flowers[0].every((q) => g2.isHexDug(q) && g2.isInterior(q)));
  check('… and routes generated, all closed', routes(w2).length === 1 && !routes(w2)[0].open);
  const h = hashState(w2);
  upgradeWorldTunnels(w2);
  check('… upgrading again changes nothing', hashState(w2) === h);
  run(w2, 10);
  check('… and the game runs on', w2.s.ants.filter((a) => a.colony === 0 && a.state !== AS.Dead).length > 0);
}

// ---------------------------------------------------------------- snapshots and determinism
{
  const w = world(3, 17);
  digToGate(w, 0, routes(w)[0].id);
  crew(w, 0, 6);
  setRouteDig(w, w.colony(0)!, routes(w)[0].id);
  run(w, 40);
  const w2 = restoreWorld(encodeState(w), new EventBus());
  check('a snapshot carries the routes, the margin and the route tags', hashState(w2) === hashState(w) && w2.nest(0)!.margin === TUNNELS.margin && routes(w2).length === routes(w).length && w2.nest(0)!.routeOf(ownHalf(routes(w2)[0], 0)!.gate) === 0);
  run(w, 30);
  run(w2, 30);
  check('… and runs on identically (the dig continues)', hashState(w2) === hashState(w) && dugFromGate(w2, ownHalf(routes(w2)[0], 0)!) > 0);
  const a = world(3, 23);
  const b = world(3, 23);
  for (const x of [a, b]) {
    digToGate(x, 1, routes(x)[0].id);
    crew(x, 1, 6);
    setRouteDig(x, x.colony(1)!, routes(x)[0].id);
  }
  run(a, 60);
  run(b, 60);
  check('two worlds from one seed stay in step while a route is dug', hashState(a) === hashState(b));
  void SURFACE;
  void halfIn;
  void placeMarker;
  void assignGroup;
}

console.log(`${failed ? failed + ' FAILED' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
