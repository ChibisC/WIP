/**
 * The Trees map of every map (and a procedural one): builds the canopy, reports its trunks, climb points, sites, food and
 * walkable hexes, checks that every crown hangs together with its trunk top (sim/trees.ts prunes what does not), that
 * every site and food item is reachable from a trunk top, and that every climb point stands on walkable ground.
 * Trees v2 (CHANGE_PLAN §38): every tree has 2–4 tiers with floor reachable from its trunk top, the sloping branches
 * are no steeper than the ground's ramps, no two neighbouring floor cells differ by more than a walkable step (the
 * drops are rock), and how much of each tier's floor the cliff seams kept.
 *
 *   npx vite-node tools/trees-check.ts [-- seed]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { PLAYABLE_MAPS } from '../src/maps';
import { TREES } from '../src/sim/types';
import { kindsOf, TK_LEAF, TK_WOOD } from '../src/sim/trees';
import { LAYERS, TREES as TB } from '../src/sim/balance';
import { hexCoreCells } from '../src/sim/colony';

const seed = Number(process.argv.slice(2).filter((a) => a !== '--')[0] ?? 3);
let bad = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const ids = [...PLAYABLE_MAPS, 'procedural'];
for (const id of ids) {
  const t0 = performance.now();
  const w = createWorld(
    {
      seed,
      style: 'meadow',
      width: 800,
      depth: 800,
      food: 1,
      trees: true,
      colonies: [
        { species: 'formica', player: true, ai: false },
        { species: 'lasius', player: false, ai: true },
      ],
      settings: { creatures: 0, titanRaids: false },
      ...(id !== 'procedural' ? { map: id } : {}),
    } as never,
    new EventBus(),
  );
  const d = w.s.trees;
  const g = w.nestOf(TREES);
  const ms = (performance.now() - t0).toFixed(0);
  if (!d || !g) {
    check(`${id}: trees built`, ['formicarium', 'arena'].includes(id) || id.startsWith('test'), `no trees (${ms} ms)`);
    continue;
  }
  const kinds = kindsOf(d);
  let walk = 0;
  let leaf = 0;
  for (let q = 0; q < kinds.length; q++) {
    if (kinds[q]) walk++;
    if (kinds[q] === TK_LEAF) leaf++;
  }
  const climbs = d.trunks.reduce((n, t) => n + t.climbs.length, 0);
  const food = w.s.food.filter((f) => f.space === TREES).length;
  console.log(`${id}: ${d.trunks.length} trees, ${climbs} climb points, ${d.sites.length} sites (${d.sites.map((s) => s.kind).join(', ')}), ${walk} walkable hexes (${leaf} leaf), ${food} food, grid ${g.cols}×${g.rows} (${g.w}×${g.h} cells), built in ${ms} ms`);
  check(`${id}: 4–6 sites`, d.sites.length >= 4 && d.sites.length <= 6, String(d.sites.length));
  check(`${id}: all three site kinds`, ['leaf', 'hollow', 'fork'].every((k) => d.sites.some((s) => s.kind === k)));
  // reachability from the trunk tops (the exit field)
  const flow = w.flowOf(TREES)!;
  const f = flow.field('check-exit', () => g.entrances.flatMap((q) => hexCoreCells(g, q, 0.35)), 1);
  let unreachable = 0;
  for (const s of d.sites) if (flow.distAt(f, s.x, s.y) === Infinity) unreachable++;
  check(`${id}: every site reachable from a trunk top`, unreachable === 0, `${unreachable} not`);
  let foodUnreach = 0;
  for (const fd of w.s.food) if (fd.space === TREES && flow.distAt(f, fd.x, fd.y) === Infinity) foodUnreach++;
  check(`${id}: every food item reachable`, foodUnreach === 0, `${foodUnreach} not`);
  let badClimb = 0;
  for (const t of d.trunks) for (const e of t.climbs) if (!w.walkable(0, e.sx, e.sy)) badClimb++;
  check(`${id}: climb points on walkable ground`, badClimb === 0, `${badClimb} blocked`);
  let topsOk = 0;
  for (const t of d.trunks) if (t.top >= 0 && (kinds[t.top] === 3 || kinds[t.top] === TK_WOOD)) topsOk++;
  check(`${id}: every trunk has a walkable top`, topsOk === d.trunks.length, `${topsOk}/${d.trunks.length}`);
  // the trunks block the ground
  let blocked = 0;
  for (const t of d.trunks) if (!w.terrain.passable(t.x, t.y)) blocked++;
  check(`${id}: trunks block the ground`, blocked === d.trunks.length);
  // tiers (trees v2): each tree's tiers on floor its trunk top reaches; slopes within the ramps' limit; no walkable step
  // steeper than stepMax between floor cells
  const td = w.treesData!;
  const lvOf = (z: number) => {
    const l = z / TB.tierStep;
    return Math.abs(l - Math.round(l)) < 1e-3 ? Math.round(l) : -1;
  };
  const tierCells = [0, 0, 0, 0, 0];
  let slopeCells = 0;
  let steep = 0;
  let worst = 0;
  let jump = 0;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const k = y * g.w + x;
      const z = td.h[k];
      if (z < 0) continue;
      const l = lvOf(z);
      if (l >= 0) tierCells[l]++;
      else slopeCells++;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (x + dx >= g.w || y + dy >= g.h) continue;
        const z2 = td.h[k + dy * g.w + dx];
        if (z2 < 0) continue;
        const sl = Math.abs(z2 - z) / g.cell;
        if (Math.abs(z2 - z) > TB.stepMax) jump++;
        else if (sl > worst) worst = sl;
      }
    }
  // the sloping branches (the skeleton's segments): no steeper than the ground's ramps
  for (const sk of td.skels)
    for (const p of [...sk.pieces, ...td.links]) {
      if (!p.walk) continue;
      for (let i = 1; i < p.nodes.length; i++) {
        const a = p.nodes[i - 1];
        const b = p.nodes[i];
        if (Math.abs(b.z - a.z) / Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y)) > LAYERS.rampMaxSlope + 1e-6) steep++;
      }
    }
  console.log(`  floor by tier ${tierCells.join('/')} cells, slopes ${slopeCells}; steepest step between floor cells ${(Math.atan(worst) * 57.3).toFixed(1)}° (walkable up to ${(Math.atan(LAYERS.maxWalkSlope) * 57.3).toFixed(0)}°)`);
  check(`${id}: no step between floor cells over ${TB.stepMax} mm (drops are rock; ${(Math.atan(TB.stepMax / g.cell) * 57.3).toFixed(0)}°)`, jump === 0 && worst <= LAYERS.maxWalkSlope + 0.03, `${jump} steps`);
  check(`${id}: sloping branches within the ramps' limit (${(Math.atan(LAYERS.rampMaxSlope) * 57.3).toFixed(0)}°)`, steep === 0, `${steep} segments steeper`);
  td.skels.forEach((sk, i) => {
    const t = d.trunks[i];
    const seen = new Map<number, number>();
    for (let k = 0; k < td.h.length; k++) {
      // (this tree's own wood and leaves, reached from the trunk tops)
      if (td.h[k] < 0 || td.own[k] !== i + 1 || !td.comp[k]) continue;
      const l = lvOf(td.h[k]);
      if (l >= 0) seen.set(l, (seen.get(l) ?? 0) + 1);
    }
    // (a tier counts with at least a few ants' room on it: 60 cells ≈ 490 mm²)
    for (const [l, c] of [...seen]) if (c < 60) seen.delete(l);
    // (2–4 tiers on its own reachable floor, its crotch's among them; a small tree under a giant's crown keeps fewer of
    // its own: its low boughs pass beneath the giant's higher floor)
    check(`${id}: tree ${i} (${sk.style}, ${sk.tiers} tiers) has 2–4 tiers on reachable floor`, sk.tiers >= 2 && sk.tiers <= 4 && seen.size >= 2 && seen.has(sk.topLv), `tiers ${[...seen.entries()].sort((a, b) => a[0] - b[0]).map(([l, c]) => `${l}: ${c}`).join(', ')} cells; crotch on tier ${sk.topLv}`);
    check(`${id}: tree ${i}'s climb arrives on the crotch's tier`, t.z === sk.topZ && Math.abs(td.h[Math.floor(t.y / g.cell) * g.w + Math.floor(t.x / g.cell)] - sk.topZ) < 1e-6);
  });
  // every tree joined to the others by boughs (user 2026-11-07): one crown
  const comps = new Set<number>();
  for (const t of d.trunks) comps.add(t.comp);
  check(`${id}: all trees joined into one canopy`, comps.size === 1, `${comps.size} separate crowns`);
}
console.log(bad ? `${bad} problems` : 'all trees checks passed');
process.exit(bad ? 1 : 0);
