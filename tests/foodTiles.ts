/**
 * The user's note of 2026-11-02 (12:06): "fix the tile system and food system. if food stores are full, units stop
 * collecting. and building with cost automatically takes food away and just waits for worker to build it. if you dont
 * have enough food you cant build it similar to eotu".
 *
 *   npx vite-node tests/foodTiles.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, Carry, SURFACE, Tile } from '../src/sim/types';
import { makeAnt, makeFood } from '../src/sim/factory';
import { assignGroup, placeMarker } from '../src/sim/markers';
import { applyCommand } from '../src/sim/commands';
import { canPlaceTile, completeBuild, markDelete, markUpgrade, placeTile, tileAt, tileCost, upgradeCost } from '../src/sim/tiles';
import { storesFull, storeFullFor } from '../src/sim/stores';
import { BALANCE } from '../src/sim/balance';
import { SpeciesId } from '../src/sim/species';

const t0 = Date.now();
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function world(species: SpeciesId = 'lasius', seed = 5): World {
  const w = createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 0, colonies: [{ species, player: true, ai: false }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } } as never, new EventBus());
  w.s.creatures.length = 0;
  return w;
}

/** Free dug hexes beside the queen's chamber (dug here for the test). */
function freeHexes(w: World, n: number): number[] {
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const out: number[] = [];
  const seen = new Set<number>();
  const front = c.tiles.filter((t) => t.type === 'queen').map((t) => t.q);
  while (front.length && out.length < n) {
    const q = front.shift()!;
    for (const m of g.neighbors(q)) {
      if (m < 0 || seen.has(m)) continue;
      seen.add(m);
      if (g.isEntrance(m) || tileAt(c, m)) {
        front.push(m);
        continue;
      }
      if (!g.isHexDug(m)) g.completeHex(m);
      out.push(m);
      front.push(m);
      if (out.length >= n) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- building: paid when placed
{
  const w = world();
  const c = w.colony(0)!;
  c.food = 50;
  const [q1, q2, q3] = freeHexes(w, 3);
  const cost = tileCost(c, 'food');
  const before = c.food;
  const why = applyCommand(w, { type: 'buildTile', player: 0, q: q1, tile: 'food', caste: '' } as never);
  const t = tileAt(c, q1);
  check('placing a tile takes its food at once', why === null && !!t && Math.abs(before - c.food - cost) < 1e-6, `food ${before} → ${c.food} (cost ${cost})`);
  check('…and it waits as a plan for a worker', !!t && !t.built && t.paid === true);
  const afterPlace = c.food;
  if (t) {
    t.progress = BALANCE.jobPoints;
    completeBuild(w, c, t);
  }
  check('a worker finishing it takes nothing more', !!t && t.built && Math.abs(c.food - afterPlace) < 1e-6, `food ${afterPlace} → ${c.food}`);

  // not enough food: refused, nothing placed, nothing taken
  c.food = cost - 1;
  const poor = c.food;
  const why2 = applyCommand(w, { type: 'buildTile', player: 0, q: q2, tile: 'food', caste: '' } as never);
  check("you can't place a tile you can't afford", !!why2 && /Not enough/.test(why2) && !tileAt(c, q2) && c.food === poor, `"${why2}"`);
  check('…canPlaceTile says why (the build panel and the ghost show it)', /needs \d+/.test(canPlaceTile(w, c, 'food', q2) ?? ''));

  // cancelling a plan gives the food back in full
  c.food = 40;
  placeTile(w, c, 'food', q3);
  const paid = c.food;
  markDelete(w, c, q3);
  check('cancelling a planned tile gives its food back', !tileAt(c, q3) && Math.abs(c.food - (paid + cost)) < 1e-6, `food ${paid} → ${c.food}`);

  // a refund that will not fit lies as seeds on the tile
  c.food = 40;
  const t4 = placeTile(w, c, 'food', q3)!;
  c.food = c.foodCap;
  const seedsBefore = w.s.food.filter((f) => f.space !== SURFACE).length;
  markDelete(w, c, q3);
  check('…and what no longer fits in the store lies as seeds on the tile', !tileAt(c, q3) && w.s.food.filter((f) => f.space !== SURFACE).length > seedsBefore && !!t4);
}

// ---------------------------------------------------------------- upgrades: paid when ordered
{
  const w = world();
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  // a lone food store dug into solid soil: six soil walls give it the points for level II
  let mid = -1;
  for (let q = 0; q < g.cols * g.rows && mid < 0; q++) {
    if (g.isHexDug(q) || g.isEntrance(q)) continue;
    const nb = g.neighbors(q);
    if (nb.every((m) => m >= 0 && !g.isHexDug(m) && !g.isEntrance(m)) && nb.every((m) => g.neighbors(m).every((k) => k < 0 || !g.isHexDug(k) || k === q))) mid = q;
  }
  g.completeHex(mid);
  const t = placeTile(w, c, 'food', mid, undefined, true) as Tile;
  const cost = upgradeCost(c, t);
  c.food = 50;
  const why = markUpgrade(w, c, mid);
  check('ordering an upgrade takes its food at once', why === null && t.pend === 1 && t.upPaid === true && Math.abs(c.food - (50 - cost)) < 1e-6, `${why ?? 'ok'}; food 50 → ${c.food} (cost ${cost})`);
  markUpgrade(w, c, mid);
  check('calling it off gives the food back', t.pend === 0 && Math.abs(c.food - 50) < 1e-6, `food ${c.food}`);
  c.food = cost - 1;
  const why2 = markUpgrade(w, c, mid);
  check("an upgrade you can't afford can't be ordered", !!why2 && /Not enough/.test(why2) && t.pend === 0, `"${why2}"`);
}

// ---------------------------------------------------------------- old saves: plans pay when built
{
  const w = world();
  const c = w.colony(0)!;
  c.food = 50;
  const [q] = freeHexes(w, 1);
  const t = placeTile(w, c, 'food', q)!;
  delete t.paid; // a plan from a save made before the change
  c.food = 50;
  completeBuild(w, c, t);
  check('a plan from an older save pays when a worker finishes it (save migration)', t.built && Math.abs(c.food - (50 - tileCost(c, 'food'))) < 1e-6, `food ${c.food}`);
}

// ---------------------------------------------------------------- full stores stop the gathering
function gatherScene(seed = 5): { w: World; mx: number; my: number } {
  const w = world('lasius', seed);
  const c = w.colony(0)!;
  const e = c.entrances[0];
  let mx = e.sx + 90;
  let my = e.sy;
  for (let k = 0; k < 24; k++) {
    const ang = (k / 24) * Math.PI * 2;
    const x = e.sx + Math.cos(ang) * 90;
    const y = e.sy + Math.sin(ang) * 90;
    if (x > 90 && y > 90 && x < 610 && y < 610 && w.walkable(SURFACE, x, y)) {
      mx = x;
      my = y;
      break;
    }
  }
  const chamber = c.tiles.find((t) => t.type === 'queen')!;
  for (let i = 0; i < 10; i++) {
    const a = makeAnt(w, 0, 'lasius_worker', SURFACE, mx + Math.cos(i * 2.4) * 8, my + Math.sin(i * 2.4) * 8, 0);
    a.tile = chamber.q;
    a.task = 'marker';
    a.marker = 0;
  }
  for (let i = 0; i < 8; i++) makeFood(w, 'seed', SURFACE, mx + Math.cos(i) * 14, my + Math.sin(i) * 14, 1).from = 'test';
  placeMarker(w, c, 0, SURFACE, mx, my);
  assignGroup(w, c, chamber.group, 0);
  w.reindex();
  return { w, mx, my };
}
{
  const { w } = gatherScene();
  const c = w.colony(0)!;
  c.food = c.foodCap;
  // (the test's own seeds; plants drop more of their own)
  const seedsAt = () => w.s.food.filter((f) => f.from === 'test' && f.space === SURFACE).reduce((s, f) => s + f.amount, 0);
  const start = seedsAt();
  let carried = 0;
  for (let i = 0; i < 20 * 40; i++) {
    c.food = c.foodCap; // (nothing eats it here)
    w.step(0.05);
    w.events.drain();
    for (const a of w.s.ants) if (a.colony === 0 && a.carry === Carry.Food) carried++;
  }
  check('a full store: foragers at a marker collect nothing', storesFull(c) && carried === 0 && Math.abs(seedsAt() - start) < 1e-6, `${carried} carrying-ticks, seeds ${start.toFixed(1)} → ${seedsAt().toFixed(1)}`);
  // room again: they gather
  c.foodCap = 400;
  c.food = 0;
  const gathered0 = c.stats.food;
  for (let i = 0; i < 20 * 90; i++) {
    w.step(0.05);
    w.events.drain();
  }
  check('…with room again they gather', c.stats.food > gathered0 || seedsAt() < start - 0.5, `stored ${(c.stats.food - gathered0).toFixed(1)}, seeds left ${seedsAt().toFixed(1)}`);
}
{
  // the player hears once
  const { w } = gatherScene(6);
  const c = w.colony(0)!;
  c.food = c.foodCap;
  let notes = 0;
  w.events.on('message', (e) => {
    if (/food store is full/.test((e as { text: string }).text)) notes++;
  });
  for (let i = 0; i < 20 * 10; i++) {
    c.food = c.foodCap;
    w.step(0.05);
    w.events.drain();
  }
  check('the player is told once that the store is full', notes === 1, `${notes} messages`);
}
{
  // leafcutters: leaves feed the garden; a full food store stops the garden turning them into food, and a full garden
  // stops the cutting
  const w = world('atta', 7);
  const c = w.colony(0)!;
  c.food = c.foodCap;
  c.fungusCap = Math.max(c.fungusCap, 40);
  c.fungus = 10;
  check('leafcutters: food store full, garden with room — leaves still wanted', !storesFull(c) && !storeFullFor(c, 'leaf') && storeFullFor(c, 'seed'));
  for (let i = 0; i < 20 * 20; i++) {
    c.food = c.foodCap;
    w.step(0.05);
    w.events.drain();
  }
  check('…the garden keeps its leaves while the food store is full', c.fungus >= 9.9, `fungus ${c.fungus.toFixed(1)}`);
  c.fungus = c.fungusCap;
  check('…and a full garden too stops all the gathering', storesFull(c) && storeFullFor(c, 'leaf'));
}

// ---------------------------------------------------------------- AI colonies still grow paying up front
{
  const w = createWorld({ seed: 7, style: 'meadow', width: 900, depth: 900, food: 1, colonies: [{ species: 'lasius', player: true, ai: true }], settings: { creatures: 0 } } as never, new EventBus());
  const c = w.colony(0)!;
  const ants0 = c.living;
  const tiles0 = c.tiles.length;
  let neg = false;
  for (let i = 0; i < 20 * 60 * 8; i++) {
    w.step(0.05);
    w.events.drain();
    if (c.food < -1e-6) neg = true;
  }
  const planned = c.tiles.filter((t) => !t.built);
  check('an AI colony still builds and grows (8 min)', c.living > ants0 + 5 && c.tiles.length > tiles0 + 3, `ants ${ants0} → ${c.living}, tiles ${tiles0} → ${c.tiles.length}`);
  check('…its plans are all paid, and its food never goes below zero', planned.every((t) => t.paid) && !neg, `${planned.length} plans`);
}

// ---------------------------------------------------------------- determinism
{
  const run = () => {
    const w = createWorld({ seed: 9, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'atta', player: true, ai: true }, { species: 'lasius', player: false, ai: true }], settings: { creatures: 0 } } as never, new EventBus());
    for (let i = 0; i < 20 * 120; i++) {
      w.step(0.05);
      w.events.drain();
    }
    return w.s.colonies.map((c) => `${c.food.toFixed(4)}|${c.tiles.length}|${c.living}`).join(';') + '|' + w.s.ants.filter((a) => a.state !== AS.Dead).length;
  };
  const a = run();
  const b = run();
  check('deterministic (two runs, same state)', a === b, a);
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all food and tile tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
