/**
 * One wide underground entrance per nest, three surface holes per anthill (user spec 2026-11-01; DESIGN §3.12,
 * sim/entrances.ts). Replaces the extra-entrance tests (spots, entrance digs, plugging).
 *
 *   npx vite-node tests/entrances.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld, registerSystems } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, Ant, Colony, SURFACE, nestSpace } from '../src/sim/types';
import { ENTRANCE, ARENA } from '../src/sim/balance';
import { anthillCentre, entranceInner, entranceTop, exitHole, upgradeWorldEntrances } from '../src/sim/entrances';
import { designateDig } from '../src/sim/colony';
import { canPlaceTile, placeTile, tileAt } from '../src/sim/tiles';
import { makeAnt, makeFood } from '../src/sim/factory';
import { assignGroup, entranceAt, placeMarker } from '../src/sim/markers';
import { enterArea, exitFieldIn, goHome, tryExit } from '../src/sim/movement';
import { Command, CommandBody, applyCommand, decodeCommandLog, encodeCommandLog } from '../src/sim/commands';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { arenaLayout, TEAM_NAMES } from '../src/sim/arena';
import { PLAYABLE_MAPS } from '../src/maps';
import { BUILD_ID } from '../src/net/messages';
import type { SpeciesId } from '../src/sim/species';
import type { NestGrid } from '../src/world/nestGrid';

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
const SPECIES: SpeciesId[] = ['lasius', 'formica', 'atta', 'solenopsis', 'eciton', 'plagiaria', 'hell', 'aurimyrmex', 'termant', 'nasutitermes', 'rhynchotermes'];

function world(species: SpeciesId = 'lasius', seed = 5, more: Partial<Record<string, unknown>> = {}): World {
  return createWorld({ seed, style: 'meadow', width: 600, depth: 600, food: 0, colonies: [{ species, player: true, ai: false }], settings: { creatures: 0 }, ...more } as never, new EventBus());
}

/** Dug hexes reachable from hex `from` through dug hexes. */
function reachable(g: NestGrid, from: number): Set<number> {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const h = q.pop()!;
    for (const n of g.neighbors(h)) if (n >= 0 && g.isHexDug(n) && !seen.has(n)) (seen.add(n), q.push(n));
  }
  return seen;
}

// ---------------------------------------------------------------- the flower: every species
{
  const bad: string[] = [];
  for (const sp of SPECIES) {
    const w = world(sp);
    const c = w.colony(0)!;
    const g = w.nest(0)!;
    const f = g.flowers[0] ?? [];
    const queen = c.tiles.find((t) => t.type === 'queen')!.q;
    const ring = [...new Set(f.flatMap((q) => g.neighbors(q)))].filter((q) => q >= 0 && !f.includes(q));
    const ed = g.flowerEdges(0);
    const why: string[] = [];
    if (g.entrances.length !== 1 || g.flowers.length !== 1 || f.length !== 7) why.push(`${g.entrances.length} entrances, ${f.length} flower hexes`);
    if (!f.slice(1).every((q) => g.hexDistance(q, f[0]) === 1) || !f.every((q) => g.isHexDug(q))) why.push('not a dug hex and its six neighbours');
    if (!f.every((q) => canPlaceTile(w, c, 'food', q) !== null)) why.push('a tile can go on it');
    if (!reachable(g, queen).has(f[0])) why.push('not joined to the queen');
    // the ring round it stays soil but for the passage (one or two hexes, joined to the queen)
    const dugRing = ring.filter((q) => g.isHexDug(q));
    if (dugRing.length < 1 || dugRing.length > 2) why.push(`${dugRing.length} dug hexes round it`);
    // at the nest's edge: its top edge farther from the queen than its middle
    if (!(ed.top.every((q) => g.hexDistance(q, queen) >= g.hexDistance(f[0], queen)) && g.hexDistance(f[0], queen) >= 6)) why.push('not at the edge');
    if (c.entrances.length !== 3 || !c.entrances.every((e) => e.q === f[0])) why.push(`${c.entrances.length} holes`);
    if (why.length) bad.push(`${sp}: ${why.join(', ')}`);
  }
  check('every species\' nest starts with one 7-hex entrance at its edge, joined to the queen, nothing buildable on it; its anthill has three holes into it', !bad.length, bad.join('; '));
}

// ---------------------------------------------------------------- digging never makes an entrance (50 seeded matches)
{
  const styles = ['meadow', 'forest', 'sandy', 'riverbank'];
  let broke = '';
  for (let seed = 1; seed <= 50 && !broke; seed++) {
    const a = SPECIES[seed % SPECIES.length];
    const b = SPECIES[(seed * 7 + 3) % SPECIES.length];
    const w = createWorld({ seed, style: styles[seed % 4], width: 500, depth: 500, food: 1, colonies: [{ species: a, player: true, ai: true, startWorkers: 8 }, { species: b, player: false, ai: true, startWorkers: 8 }], settings: { creatures: 0 } } as never, new EventBus());
    const flowers = w.s.colonies.map((c) => w.nest(c.id)!.flowers[0].join());
    run(w, 6);
    // the player digs out the soil round its entrance and the nest's edge
    const c = w.colony(0)!;
    const g = w.nest(0)!;
    for (let q = 0; q < g.cols * g.rows; q++)
      if (g.hexDistance(q, g.entrances[0]) <= 3 && g.isHexDiggable(q)) {
        designateDig(w, c, q, true);
        g.completeHex(q);
      }
    run(w, 1.1);
    for (const o of w.s.colonies) {
      const og = w.nest(o.id)!;
      if (o.entrances.length !== 3 || og.entrances.length !== 1 || og.flowers.length !== 1 || og.flowers[0].join() !== flowers[o.id]) broke = `seed ${seed}, colony ${o.id} (${o.species}): ${o.entrances.length} holes, ${og.entrances.length} entrances`;
    }
  }
  check('digging anywhere (the player round its entrance, the AI as it grows; 50 seeded matches) never makes another entrance', !broke, broke);
}
{
  const w = world();
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const cmd = (body: CommandBody) => applyCommand(w, { ...body, tick: w.s.tick, player: 0, seq: 0 } as Command);
  const holes = JSON.stringify(c.entrances);
  check('the Dig tool does nothing at the entrance (its hexes are dug)', cmd({ type: 'dig', q: g.flowers[0][1], on: true }) !== null && !g.hexDesig[g.flowers[0][1]]);
  check('the entrance command is rejected (holes are always open)', cmd({ type: 'entrance', i: 1, close: true }) !== null && cmd({ type: 'entrance', i: 0, close: false }) !== null && JSON.stringify(c.entrances) === holes);
  check('… but still parses on the wire (old replays)', decodeCommandLog(encodeCommandLog([{ type: 'entrance', i: 1, close: true, tick: 3, player: 0, seq: 1 } as Command]))[0].type === 'entrance');
  // (6: the one-entrance rework; later reworks bump it again — 7: nest hexes 1.10 ×, 8: tiles paid when ordered, 9: CHANGE_PLAN §23's callHelp)
  check('the net protocol is bumped (mixed versions cannot join)', Number(BUILD_ID.split('-').pop()) >= 6, BUILD_ID);
}

// ---------------------------------------------------------------- three holes on every map
function holesOk(w: World, c: Colony): string {
  const e = c.entrances;
  if (e.length !== 3) return `${e.length} holes`;
  for (const h of e) {
    if (!w.walkable(SURFACE, h.sx, h.sy) || w.terrain.isWater(h.sx, h.sy)) return `hole (${h.sx.toFixed(0)}, ${h.sy.toFixed(0)}) not on dry ground`;
    const y0 = w.terrain.walkHeight(h.sx, h.sy);
    let relief = 0;
    for (let k = 0; k < 8; k++) relief = Math.max(relief, Math.abs(w.terrain.walkHeight(h.sx + Math.cos(k) * 3, h.sy + Math.sin(k) * 3) - y0));
    if (relief > 2.5) return `hole (${h.sx.toFixed(0)}, ${h.sy.toFixed(0)}) on a slope (${relief.toFixed(1)} mm)`;
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (Math.hypot(e[i].sx - e[j].sx, e[i].sy - e[j].sy) < ENTRANCE.holeGap) return `holes ${i} and ${j} too close`;
  const f = w.surfFlow.field('test:holes', c.id, [{ x: e[0].sx, y: e[0].sy }]);
  if (!e.every((h) => w.surfFlow.distAt(f, h.sx, h.sy) < Infinity)) return 'holes not joined by land';
  return '';
}
{
  const bad: string[] = [];
  for (const id of PLAYABLE_MAPS) {
    const w = createWorld({ seed: 3, map: id, colonies: SPECIES.slice(0, 4).map((species, i) => ({ species, player: i === 0, ai: true })), food: 1 } as never, new EventBus());
    for (const c of w.s.colonies) {
      const why = holesOk(w, c);
      if (why) bad.push(`${id} colony ${c.id}: ${why}`);
      // the other anthills are reachable by land too
      const f = w.surfFlow.field('test:other', c.id + 100, [{ x: c.entrances[0].sx, y: c.entrances[0].sy }]);
      for (const o of w.s.colonies) if (o !== c && !o.entrances.every((h) => w.surfFlow.distAt(f, h.sx, h.sy) < Infinity)) bad.push(`${id}: colony ${o.id}'s holes unreachable from colony ${c.id}`);
    }
  }
  {
    const w = createWorld({ seed: 4, style: 'formicarium', width: 600, depth: 600, food: 1, colonies: [{ species: 'atta', player: true, ai: true }, { species: 'formica', player: false, ai: true }] } as never, new EventBus());
    for (const c of w.s.colonies) if (holesOk(w, c)) bad.push(`formicarium colony ${c.id}: ${holesOk(w, c)}`);
  }
  {
    const L = arenaLayout(ARENA.size, 4);
    const w = createWorld({ seed: 4, style: 'formicarium', width: ARENA.size, depth: ARENA.size, colonies: L.map((p, i) => ({ species: SPECIES[i * 2], player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })), caves: [], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 }, arena: true } as never, new EventBus());
    for (const c of w.s.colonies) if (holesOk(w, c)) bad.push(`arena colony ${c.id}: ${holesOk(w, c)}`);
  }
  check('every anthill has three holes — dry, flat, spaced, joined by land — on the five maps, the formicarium and the arena', !bad.length, bad.slice(0, 4).join('; '));
}

// ---------------------------------------------------------------- leaving and coming home
{
  const w = world('lasius', 7);
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const ctr = anthillCentre(c.entrances, { x: 0, y: 0 });
  const top = entranceTop(g);
  const at = g.hexCenter(top[1]);
  // three ants at the top of the entrance, each bound for a marker out past a different hole
  let right = 0;
  for (let k = 0; k < 3; k++) {
    const e = c.entrances[k];
    const dx = e.sx - ctr.x;
    const dy = e.sy - ctr.y;
    const d = Math.hypot(dx, dy);
    placeMarker(w, c, k, SURFACE, e.sx + (dx / d) * 140, e.sy + (dy / d) * 140);
    const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), at.x, at.y, 0);
    a.marker = k;
    if (tryExit(w, a) && a.space === SURFACE && a.ent === k) right++;
  }
  // … and three after food lying out past each hole
  for (let k = 0; k < 3; k++) {
    const e = c.entrances[k];
    const f = makeFood(w, 'crumb', SURFACE, ctr.x + (e.sx - ctr.x) * 4, ctr.y + (e.sy - ctr.y) * 4, 1, 'fly');
    const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), at.x, at.y, 0);
    a.tgt = f.id;
    a.tk = 1;
    w.s.time += 1; // (credit)
    if (tryExit(w, a) && a.ent === k) right++;
  }
  check('ants leave through the hole facing where they are going (their marker, their food)', right === 6, `${right}/6`);
  // no destination: spread by id
  const by = [0, 0, 0];
  for (let i = 0; i < 30; i++) {
    w.s.time += 0.5;
    const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), at.x, at.y, 0);
    a.marker = -1;
    if (tryExit(w, a)) by[a.ent]++;
  }
  check('… ants going nowhere in particular spread over the three', by.every((n) => n >= 8), by.join(' / '));
  // a crowd at one busy hole spills over to the others when they are not much farther
  const crowd = [0, 0, 0];
  w.s.time += 5;
  for (let i = 0; i < 12; i++) {
    const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), at.x, at.y, 0);
    a.marker = 0;
    if (tryExit(w, a)) crowd[a.ent]++;
  }
  check('… a crowd bound far off spills over to the other holes while its own is busy', crowd[0] >= ENTRANCE.burst && crowd[1] + crowd[2] > 0, crowd.join(' / '));
  // coming home: the nearest hole
  const home: string[] = [];
  for (let k = 0; k < 3; k++) {
    const e = c.entrances[k];
    const a = makeAnt(w, 0, 'lasius_worker', SURFACE, e.sx + (e.sx - ctr.x) * 0.6, e.sy + (e.sy - ctr.y) * 0.6, 0);
    w.s.time += 1;
    let t = 0;
    while (a.space === SURFACE && t++ < 400) goHome(w, a, 0.05);
    home.push(a.space === nestSpace(0) && a.ent === k ? 'ok' : `hole ${a.ent}`);
  }
  check('ants coming home go down the nearest hole', home.every((h) => h === 'ok'), home.join(', '));
  // arriving ants come out spread over the flower's top, not at one point
  const pts: Array<{ x: number; y: number; q: number }> = [];
  for (let i = 0; i < 60; i++) {
    w.s.tick++;
    const a = makeAnt(w, 0, 'lasius_worker', SURFACE, c.entrances[0].sx, c.entrances[0].sy, 0);
    enterArea(w, a, nestSpace(0), i % 3);
    pts.push({ x: a.x, y: a.y, q: g.hexAt(a.x, a.y) });
  }
  const used = new Set(pts.map((p) => p.q));
  const mx = pts.reduce((s, p) => s + p.x / pts.length, 0);
  const my = pts.reduce((s, p) => s + p.y / pts.length, 0);
  const spread = Math.sqrt(pts.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / pts.length);
  const same = pts.some((p, i) => pts.some((o, j) => j > i && Math.hypot(p.x - o.x, p.y - o.y) < 0.05));
  check('arriving ants appear spread over the entrance\'s three top hexes (no single-point popping)', used.size === 3 && [...used].every((q) => top.includes(q)) && spread > g.R * 0.8 && !same, `${used.size} hexes, spread ${spread.toFixed(1)} mm (R ${g.R.toFixed(1)})`);
}

// ---------------------------------------------------------------- throughput: a crowd leaving uses all three holes
function emptyNest(cave: number): { t: number; per: number[] } {
  const w = world('lasius', 11);
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  // (cave > 0: all but one hole fallen in — one hole, as before the rework)
  if (cave) for (const e of c.entrances.slice(1)) e.fall = 1;
  const chamber = c.tiles.find((t) => t.type === 'queen')!;
  const inner = entranceInner(g);
  const ids: number[] = [];
  for (let i = 0; i < 60; i++) {
    const p = g.hexCenter(inner[i % inner.length]);
    const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), p.x + ((i % 5) - 2) * 0.8, p.y + (Math.floor(i / 5) % 3) * 0.8, 0);
    a.tile = chamber.q;
    ids.push(a.id);
  }
  const ctr = anthillCentre(c.entrances, { x: 0, y: 0 });
  placeMarker(w, c, 0, SURFACE, ctr.x + 260, ctr.y + 40);
  assignGroup(w, c, chamber.group, 0);
  w.reindex();
  const n0 = c.entrances.map((e) => e.n ?? 0);
  let t = 0;
  while (t < 60 && ids.some((id) => w.antById.get(id)?.space === nestSpace(0))) {
    run(w, 0.25);
    t += 0.25;
  }
  return { t, per: c.entrances.map((e, i) => (e.n ?? 0) - n0[i]) };
}
{
  const three = emptyNest(0);
  const one = emptyNest(1);
  const out = three.per.reduce((s, n) => s + n, 0);
  check('a crowd of 60 leaving the nest uses all three holes', three.per.every((n) => n >= 8), `${three.per.join(' / ')} through the holes in ${three.t.toFixed(1)} s (${(out / three.t).toFixed(1)} ants/s)`);
  check('… and empties the nest faster than through one hole', three.t < one.t * 0.75, `${three.t.toFixed(1)} s with three holes, ${one.t.toFixed(1)} s through one`);
}

// ---------------------------------------------------------------- invasion and defence
{
  const w = createWorld({ seed: 12, style: 'meadow', width: 700, depth: 700, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } } as never, new EventBus());
  const P = w.colony(0)!;
  const R = w.colony(1)!;
  const rg = w.nest(1)!;
  const rc = anthillCentre(R.entrances, { x: 0, y: 0 });
  // raiders by each of the rival's holes, all sent to a marker dropped on one of them (it goes down into the rival nest)
  const chamber = P.tiles.find((t) => t.type === 'queen')!;
  const raiders: Ant[] = [];
  R.entrances.forEach((e) => {
    for (let k = 0; k < 4; k++) {
      const a = makeAnt(w, 0, 'lasius_soldier', SURFACE, e.sx + (e.sx - rc.x) * 0.5 + k, e.sy + (e.sy - rc.y) * 0.5, 0);
      a.tile = chamber.q;
      raiders.push(a);
    }
  });
  const snap = entranceAt(w, P, R.entrances[2].sx + 1, R.entrances[2].sy);
  check('a marker on any of an anthill\'s holes means "this entrance": it goes down to the flower', !!snap && snap.space === nestSpace(1) && rg.flowers[0].includes(rg.hexAt(snap.x, snap.y)));
  placeMarker(w, P, 0, SURFACE, R.entrances[2].sx, R.entrances[2].sy);
  assignGroup(w, P, chamber.group, 0);
  w.reindex();
  const holeUsed = new Map<number, number>();
  const arrive = new Map<number, number>();
  for (let t = 0; t < 20 * 30 && arrive.size < raiders.length; t++) {
    w.step(0.05);
    w.events.drain();
    for (const a of raiders)
      if (!arrive.has(a.id) && a.space === nestSpace(1)) {
        arrive.set(a.id, rg.hexAt(a.x, a.y));
        holeUsed.set(a.ent, (holeUsed.get(a.ent) ?? 0) + 1);
      }
  }
  const top = entranceTop(rg);
  check('enemies go down whichever hole is nearest them (all three used) …', holeUsed.size === 3 && arrive.size >= raiders.length - 2, `${arrive.size}/${raiders.length} in; holes ${[...holeUsed].map(([k, n]) => `${k}:${n}`).join(' ')}`);
  check('… and arrive on the flower\'s top edge', [...arrive.values()].every((q) => top.includes(q)));
}
{
  // home guards (and termite majors: "they hold the entrance chokes") patrol at its inner edge
  for (const sp of ['lasius', 'nasutitermes'] as SpeciesId[]) {
    const w = world(sp, 13);
    const c = w.colony(0)!;
    const g = w.nest(0)!;
    const caste = sp === 'lasius' ? 'lasius_soldier' : c.castes.find((k) => k.includes('major')) ?? c.castes[1];
    const q = c.tiles.find((t) => t.type === 'queen')!.q;
    const p = g.hexCenter(q);
    const gs: Ant[] = [];
    for (let i = 0; i < 8; i++) {
      const a = makeAnt(w, 0, caste, nestSpace(0), p.x + i * 0.5, p.y, 0);
      a.task = 'guard';
      a.taskT = 999;
      gs.push(a);
    }
    w.reindex();
    const inner = entranceInner(g);
    let atEdge = 0;
    let posts = 0;
    for (let t = 0; t < 20 * 40; t++) {
      for (const a of gs) {
        a.task = 'guard';
        a.taskT = 999;
      }
      w.step(0.05);
      w.events.drain();
      if (t % 20) continue;
      for (const a of gs)
        if (a.state === AS.Guard) {
          posts++;
          if (inner.includes(g.hexAt(a.tx, a.ty))) atEdge++;
        }
    }
    check(`defenders (${sp === 'lasius' ? 'home guards' : 'nasute majors'}) hold the entrance's inner edge`, posts > 0 && atEdge / posts > (sp === 'lasius' ? 0.12 : 0.9), `${atEdge}/${posts} guard posts there`);
  }
}

// ---------------------------------------------------------------- always open; caving in
{
  const w = world('formica', 14);
  const c = w.colony(0)!;
  check('holes cannot be plugged (no plug state, the command is refused)', c.entrances.every((e) => !('shut' in e) && !('work' in e)));
  c.alive = false;
  run(w, 2.1);
  check('a fallen colony\'s three holes start caving in (nobody goes in)', c.entrances.every((e) => (e.fall ?? 0) > 0));
  run(w, ENTRANCE.collapseS);
  check('… and have all fallen in after collapseS; nothing leads out of its nest any more', c.entrances.every((e) => e.fall === 1) && (exitFieldIn(w, nestSpace(0))?.every((d) => d === Infinity) ?? true));
}

// ---------------------------------------------------------------- older saves
function oldSave(): { st: ReturnType<World['serialize']>; tileQ: number; antId: number; extra: number[] } {
  const w = world('lasius', 15, { food: 0 });
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const f = g.flowers[0];
  const spine = g.tunnels[0];
  // an older nest: a 3-hex tunnel (top, middle, bottom), the flower's side hexes dug by the player with a store on one,
  // a dug-out extra entrance over part of the start area, a marked spot, an ant in the extra tunnel
  const side = f.find((q) => !spine.includes(q))!;
  const free = [...reachable(g, c.tiles.find((t) => t.type === 'queen')!.q)].filter((q) => !g.isEntrance(q) && !tileAt(c, q));
  const extra = free.slice(-3);
  const tile = placeTile(w, c, 'food', free[0], undefined, true)!;
  tile.q = side; // (stood there before the rework)
  const ant = makeAnt(w, 0, 'lasius_worker', nestSpace(0), g.hexCenter(extra[1]).x, g.hexCenter(extra[1]).y, 0);
  const st = JSON.parse(JSON.stringify(w.serialize()));
  const nd = st.nests[nestSpace(0)] as Record<string, unknown>;
  nd.entrances = [spine[0], extra[0]];
  nd.tunnels = [spine.slice(), extra.slice()];
  nd.shafts = [free[1]];
  nd.spots = [[free[1], free[2], free[3]]];
  delete nd.flowers;
  const e0 = st.colonies[0].entrances[0];
  st.colonies[0].entrances = [
    { q: spine[0], sx: e0.sx, sy: e0.sy, shut: 0, work: 0, cr: 2, crT: st.time, fall: 0 },
    { q: extra[0], sx: e0.sx + 40, sy: e0.sy, shut: 1, work: 0, cr: 4, crT: st.time, fall: 0 },
  ];
  st.version = 2;
  return { st, tileQ: side, antId: ant.id, extra };
}
{
  const { st, tileQ, antId, extra } = oldSave();
  const logged: string[] = [];
  const info = console.info;
  console.info = (s: string) => logged.push(s);
  const w = new World(JSON.parse(JSON.stringify(st)), new EventBus());
  registerSystems(w);
  console.info = info;
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const f = g.flowers[0] ?? [];
  check('an old save loads with one entrance: the extra one and the spots are gone, their hexes plain dug floor', g.entrances.length === 1 && g.flowers.length === 1 && !('spots' in g) && extra.every((q) => g.isHexDug(q) && !g.isEntrance(q)) && !!canPlaceTile(w, c, 'food', extra[1]) === false, `${g.entrances.length} entrances`);
  check('… its main entrance widened into the 7-hex flower, all dug', f.length === 7 && f.every((q) => g.isHexDug(q)) && w.s.version === 5);
  const t = c.tiles.find((x) => x.type === 'food');
  check('… a tile standing on the widened entrance moved to free floor (and the load log says so)', !!t && t.q !== tileQ && !g.isEntrance(t.q) && g.isHexDug(t.q) && logged.some((s) => s.includes('moved a food tile')), logged.join(' | '));
  check('… its anthill rebuilt with three holes into the flower', c.entrances.length === 3 && c.entrances.every((e) => e.q === f[0] && !('shut' in e)));
  const a = w.antById.get(antId)!;
  const ef = exitFieldIn(w, nestSpace(0))!;
  check('… an ant in the old extra tunnel is on dug floor with a way out', w.walkable(a.space, a.x, a.y) && w.flowOf(nestSpace(0))!.distAt(ef, a.x, a.y) < Infinity);
  // (sent out to a marker)
  const ch = c.tiles.find((x) => x.type === 'queen')!;
  for (const x of w.s.ants) if (x.colony === 0 && x.id !== c.queen) x.tile = ch.q;
  placeMarker(w, c, 0, SURFACE, c.entrances[0].sx + 120, c.entrances[0].sy);
  assignGroup(w, c, ch.group, 0);
  run(w, 20);
  check('… and the game runs on: ants go out through the new holes', c.entrances.reduce((s, e) => s + (e.n ?? 0), 0) >= 3, `${c.entrances.map((e) => e.n ?? 0).join(' / ')}`);
  // loading twice changes nothing (idempotent)
  const h = hashState(w);
  upgradeWorldEntrances(w);
  check('… upgrading again changes nothing', hashState(w) === h);
}
{
  // a binary snapshot (its grids attach after the World is built): upgraded once they are
  const w = world('formica', 16);
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const spine = g.tunnels[0].slice();
  g.clearEntrances();
  g.addEntrance(spine);
  c.entrances = [{ q: spine[0], sx: c.entrances[0].sx, sy: c.entrances[0].sy, cr: 4, crT: w.time, fall: 0 }];
  const w2 = restoreWorld(encodeState(w), new EventBus());
  const g2 = w2.nest(0)!;
  check('an old binary snapshot is upgraded too (one flower, three holes)', g2.flowers[0]?.length === 7 && w2.colony(0)!.entrances.length === 3);
}

// ---------------------------------------------------------------- determinism
{
  const make = () => createWorld({ seed: 21, style: 'meadow', width: 600, depth: 600, food: 1, colonies: [{ species: 'atta', player: true, ai: true, startWorkers: 10 }, { species: 'termant', player: false, ai: true, startWorkers: 10 }] } as never, new EventBus());
  const a = make();
  const b = make();
  run(a, 30);
  run(b, 30);
  check('two runs of the same game agree (holes, flowers, traffic)', hashState(a) === hashState(b) && JSON.stringify(a.s.colonies.map((c) => c.entrances)) === JSON.stringify(b.s.colonies.map((c) => c.entrances)));
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all entrance tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
