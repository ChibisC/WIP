/**
 * The Trees: a third layer above the ground (claude/trees/01-spec-trees-layer.md; CHANGE_PLAN §33).
 *
 * One canopy map per match, the space `TREES`: a `NestGrid` hex map in the ground's mm frame (a point in the trees is
 * over the same point on the ground), all rock except the branches, twigs and leaves, which are dug "air" — walkable.
 * Everything the grid already gives (flow fields, separation, markers, the ant hashes, combat, saves) works on it. Each
 * tree's trunk is a wall on the ground with climb points at its foot: the climb points are the space's entrances
 * (`Entrance.q` the trunk-top hex), so `goToArea(TREES)` walks an ant to the nearest climb point and up, `goOut` walks
 * it to the nearest trunk top and down, and the entrance credit gives the climb its throughput. Climbing takes time
 * (`Ant.trunkT`). Only a fling knocks an ant off a branch (combat.ts: it lands on the ground below, dazed).
 *
 * The layer exists only when a match has a tree-dwelling colony (`SpeciesDef.habitat === 'trees'`), the sandbox's
 * "Trees on", or the dev URL `?trees=1`; without it nothing here runs and nothing is built.
 */
import { Rng } from '../core/rng';
import { NestGrid, SOIL_AIR, SOIL_LOAM, SOIL_ROCK } from '../world/nestGrid';
import type { Pt, TreeDef } from '../maps/types';
import { LAYERS, TREES as T } from './balance';
import { dcos, dhypot, dsin } from './dmath';
import { CanopyFloor, crownSkeleton, CrownSkel, linkHeadings, linkPieces, paintCanopy, TK_FLOWER, TK_LEAF, TK_WOOD, WoodPiece } from './treeCrowns';
import { makeEntrance } from './entrances';
import { makeFood } from './factory';
import { Colony, Entrance, SURFACE, TREES, TreeSiteDef, TreeSiteKind, TreesDef, TrunkDef } from './types';
import { World } from './world';

export { TK_SKY, TK_WOOD, TK_LEAF, TK_TOP, TK_FLOWER, crownSkeleton, crownTiers, topTier } from './treeCrowns';
export type { BigLeaf, CrownSkel, WoodKind, WoodNode, WoodPiece } from './treeCrowns';

/**
 * What every copy of a match derives from its trees (never saved; `World.treesData`): the crowns' skeletons and the
 * links between them (the render draws them as wood), and the floor per fine cell — its height over the canopy plane,
 * kind, the rounding across its wood and the crown it belongs to (`paintCanopy`).
 */
export interface CanopyData extends CanopyFloor {
  skels: CrownSkel[];
  links: WoodPiece[];
}

/** The trees of a match: the map's authored trees, or on a procedural map a few grown from the seed away from the nests. */
export function treesOf(w: World): TreeDef[] {
  const map = w.terrain.map;
  if (map) return map.trees ?? [];
  const t = w.terrain;
  const rng = new Rng(w.s.seed * 53 + 11);
  const out: TreeDef[] = [];
  const m = T.procCrown * 0.6;
  for (let i = 0; i < T.procTrees * 4 && out.length < T.procTrees; i++) {
    const x = rng.range(m, t.width - m);
    const y = rng.range(m, t.depth - m);
    if (!t.passable(x, y)) continue;
    let ok = true;
    for (const c of w.s.colonies) if (dhypot(c.nx - x, c.ny - y) < 150) ok = false;
    for (const o of out) if (dhypot(o.trunk[0] - x, o.trunk[1] - y) < T.procCrown * 1.1) ok = false;
    if (!ok) continue;
    out.push({ trunk: [x, y], r: T.procTrunkR, style: t.params.style === 'sandy' ? 'acacia' : t.params.style === 'forest' ? 'oak' : 'beech', reach: T.procCrown, seed: w.s.seed * 7 + i * 101 });
  }
  return out;
}

/** The trees grid covering the ground map (its hexes in the ground's mm frame). */
export function treesGrid(w: World): NestGrid {
  const R = T.hexR;
  const C = 1.5 * R;
  const H = Math.sqrt(3) * R;
  const cols = Math.ceil((w.terrain.width - 2 * R) / C) + 1;
  const rows = Math.ceil(w.terrain.depth / H);
  return new NestGrid({ cols, rows, R, seed: 1 });
}

/** The crowns of the match's trees and the floor painted from them, on a grid of the trees' size (pure). */
export function canopyFloorOf(w: World, g: { w: number; h: number; cell: number }): CanopyData | null {
  const defs = treesOf(w);
  if (!defs.length) return null;
  const toward = linkHeadings(defs);
  const skels = defs.map((d, i) => crownSkeleton(d, i, toward[i]));
  return { ...paintCanopy(g, skels, (above, reached) => linkPieces(defs, skels, above, reached)), skels };
}

/**
 * The canopy grid and its hexes from the match's trees: a pure function of the terrain and the trees' definitions, so
 * the worker's replica builds the same grid when the layer appears (game/replica.ts) and a save needs only the def.
 * The floor is per fine cell (`paintCanopy`); a hex is dug — markers, sites, food, the trunk top's entrance — when its
 * centre cell is floor.
 */
export function buildCanopy(w: World): { g: NestGrid; kinds: Uint8Array; comps: Uint8Array; trunks: TrunkDef[]; siteCands: Array<{ kind: TreeSiteKind; x: number; y: number; tree: number }>; defs: TreeDef[]; data: CanopyData } | null {
  const defs = treesOf(w);
  if (!defs.length) return null;
  const g = treesGrid(w);
  const data = canopyFloorOf(w, g)!;
  const nh = g.cols * g.rows;
  const kinds = new Uint8Array(nh);
  const comps = new Uint8Array(nh);
  // all rock, nothing diggable; the floor cells dug (logged like any dig, so the flow fields know them)
  g.hexSoil.fill(SOIL_ROCK);
  g.soil.fill(SOIL_ROCK);
  g.hexTotal.fill(0);
  g.hexWork.fill(0);
  for (let k = 0; k < g.w * g.h; k++)
    if (data.h[k] >= 0) {
      g.soil[k] = SOIL_LOAM;
      const x = k % g.w;
      g.carve(x, (k - x) / g.w);
    }
  const p = { x: 0, y: 0 };
  for (let q = 0; q < nh; q++) {
    g.hexCenter(q, p);
    const k = cellIndex(g, p.x, p.y);
    if (k < 0 || data.h[k] < 0) continue;
    kinds[q] = data.kind[k];
    comps[q] = data.comp[k];
    g.hexSoil[q] = SOIL_AIR;
  }
  for (const sk of data.skels)
    for (const f of sk.flowers) {
      const q = g.hexAt(f[0], f[1]);
      if (q >= 0 && kinds[q]) kinds[q] = TK_FLOWER;
    }
  const trunks: TrunkDef[] = [];
  const siteCands: Array<{ kind: TreeSiteKind; x: number; y: number; tree: number }> = [];
  defs.forEach((def, ti) => {
    const sk = data.skels[ti];
    const top = g.hexAt(def.trunk[0], def.trunk[1]);
    trunks.push({ x: def.trunk[0], y: def.trunk[1], r: def.r, top, climbs: [], tree: ti, comp: top >= 0 ? comps[top] : 0, z: sk.topZ, tiers: sk.tiers });
    for (const s of sk.sites) siteCands.push({ kind: s.kind, x: s.at[0], y: s.at[1], tree: ti });
  });
  // the trunk tops are the grid's entrances
  for (const tr of trunks) if (tr.top >= 0 && kinds[tr.top]) g.addEntrance([tr.top]);
  g.version++;
  g.stateVersion++;
  g.dirtyAll();
  return { g, kinds, comps, trunks, siteCands, defs, data };
}

/** The fine cell of a point of the trees grid (−1 outside). */
function cellIndex(g: { w: number; h: number; cell: number }, x: number, y: number): number {
  const i = Math.floor(x / g.cell);
  const j = Math.floor(y / g.cell);
  return i < 0 || j < 0 || i >= g.w || j >= g.h ? -1 : j * g.w + i;
}

/**
 * Build the Trees map: the grid, the trunks and their climb points, the sites, the food; registers the space.
 * Returns the definition (also kept in `w.s.trees`).
 */
export function createTrees(w: World): TreesDef | null {
  if (w.s.trees) return w.s.trees;
  const built = buildCanopy(w);
  if (!built) return null;
  const rng = new Rng(w.s.seed * 29 + 3);
  const def = treesDefOf(w, built, rng);
  const { g, kinds } = built;
  const nh = g.cols * g.rows;
  const p = { x: 0, y: 0 };
  w.addGrid(TREES, g);
  w.s.trees = def;
  w.treesData = built.data;
  applyTreesToTerrain(w);
  // food on the branches (scaled like the ground's food setting) and the first wild climbers come with the ecology
  const foodN = Math.round(T.food * ((w.s.settings as { food?: number }).food ?? 1));
  const walk: number[] = [];
  for (let q = 0; q < nh; q++) if (kinds[q] === TK_WOOD || kinds[q] === TK_LEAF) walk.push(q);
  for (let i = 0; i < foodN && walk.length; i++) {
    const q = walk[rng.int(0, walk.length - 1)];
    g.hexCenter(q, p);
    if (kinds[q] === TK_LEAF && rng.chance(0.5)) makeFood(w, 'berry', TREES, p.x, p.y, rng.range(0.8, 1.2), rng.chance(0.5) ? 'berry' : 'apple');
    else makeFood(w, 'insect', TREES, p.x, p.y, rng.range(0.8, 1.3), rng.pick(['fly', 'moth', 'beetle']));
  }
  for (let q = 0; q < nh; q++)
    if (kinds[q] === TK_FLOWER) {
      g.hexCenter(q, p);
      makeFood(w, 'berry', TREES, p.x, p.y, 1.1, 'berry');
    }
  return def;
}

/** The trees' definition from a built canopy: the climb points at each trunk's foot and the nest sites. */
function treesDefOf(w: World, built: NonNullable<ReturnType<typeof buildCanopy>>, rng: Rng): TreesDef {
  const { g, kinds, comps, trunks, siteCands, defs } = built;
  const p = { x: 0, y: 0 };
  // the trunk tops are the grid's entrances; the climb points at the foot are the space's entrances
  trunks.forEach((tr, ti) => {
    if (tr.top < 0 || !kinds[tr.top]) return;
    const def = defs[ti];
    const pts: Pt[] = def.climbs ? [...def.climbs] : [];
    if (!pts.length) {
      const a0 = rng.range(0, Math.PI * 2);
      for (let k = 0; k < T.climbPoints; k++) {
        const ang = a0 + (k / T.climbPoints) * Math.PI * 2;
        pts.push([tr.x + dcos(ang) * (tr.r + 10), tr.y + dsin(ang) * (tr.r + 10)]);
      }
    }
    for (const pt of pts) {
      // on walkable ground beside the trunk (a buttress or a rock in the way: the nearest open ground)
      const s = groundNear(w, pt[0], pt[1], tr);
      if (!s) continue;
      const e = makeEntrance(tr.top, s.x, s.y, w.time);
      tr.climbs.push(e);
    }
  });
  // sites: 4–6 over the map, the three kinds in turn, spread over the trees, on walkable hexes
  const sites: TreeSiteDef[] = [];
  const want = Math.min(T.sitesMax, Math.max(T.sitesMin, Math.round(defs.length * 1.5)));
  const byKind: Record<TreeSiteKind, typeof siteCands> = { leaf: [], hollow: [], fork: [] };
  for (const c of siteCands) byKind[c.kind].push(c);
  const order: TreeSiteKind[] = ['leaf', 'hollow', 'fork'];
  let guard = 0;
  while (sites.length < want && guard++ < 60) {
    const kind = order[sites.length % 3];
    const cands = byKind[kind].length ? byKind[kind] : siteCands;
    if (!cands.length) break;
    // the tree with the fewest sites so far
    const counts = trunks.map((_, i) => sites.filter((s) => siteTree(s, trunks) === i).length);
    cands.sort((a, b) => counts[a.tree] - counts[b.tree] || a.x - b.x);
    const c = cands.shift()!;
    const q = nearestWalkHex(g, kinds, c.x, c.y);
    if (q < 0 || sites.some((s) => g.hexDistance(s.q, q) < 6)) continue;
    g.hexCenter(q, p);
    sites.push({ kind, q, x: p.x, y: p.y, nest: -1 });
  }
  return { space: TREES, trunks, sites, kinds: kindsToString(kinds), comps: kindsToString(comps), height: T.height };
}

/**
 * A restored match's trees (after its grids are attached): the derived floor data; a save from before trees v2
 * (version ≤ 5: one flat level of hexes) rebuilds its canopy — grid, trunks, sites — and moves what stood in the trees
 * to the nearest branch (a tree nest's hole to its site's new place).
 */
export function upgradeWorldTrees(w: World): void {
  const d = w.s.trees;
  if (!d) return;
  const g = w.nestOf(TREES);
  if (w.loadedVersion >= 6 && g) {
    w.treesData = canopyFloorOf(w, g);
    return;
  }
  const built = buildCanopy(w);
  if (!built) return;
  const def = treesDefOf(w, built, new Rng(w.s.seed * 29 + 3));
  def.sites.forEach((s, i) => (s.nest = d.sites[i]?.nest ?? -1));
  if (g) w.replaceGrid(TREES, built.g);
  else w.addGrid(TREES, built.g);
  w.s.trees = def;
  w.treesData = built.data;
  applyTreesToTerrain(w);
  for (const c of w.s.colonies) if (c.treeSite !== undefined && c.treeSite >= 0 && def.sites[c.treeSite]) moveNestToTree(w, c, c.treeSite);
  const onBranch = (o: { space: number; x: number; y: number }) => {
    if (o.space !== TREES || w.walkable(TREES, o.x, o.y)) return;
    const p = nearestBranch(w, o.x, o.y, 60);
    if (p) {
      o.x = p.x;
      o.y = p.y;
    }
  };
  for (const a of w.s.ants) onBranch(a);
  for (const f of w.s.food) onBranch(f);
  for (const cr of w.s.creatures) onBranch(cr);
  for (const c of w.s.colonies) for (const m of c.markers) if (m.placed) onBranch(m);
}

/** The nearest walkable ground to a point, outside the trunk's foot (rings of the terrain grid, fixed order). */
function groundNear(w: World, x: number, y: number, tr: { x: number; y: number; r: number }): { x: number; y: number } | null {
  const t = w.terrain;
  const ok = (px: number, py: number) => t.inBounds(px, py, 4) && t.passable(px, py) && dhypot(px - tr.x, py - tr.y) > tr.r + 2;
  // (on the surface fields' lattice, so the climb point's cell is open to them)
  const r = w.surfFlow.cell;
  x = Math.round(x / r) * r;
  y = Math.round(y / r) * r;
  if (ok(x, y)) return { x, y };
  const ci = Math.round(x / r);
  const cj = Math.round(y / r);
  for (let k = 1; k <= Math.ceil(80 / r); k++) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (let dj = -k; dj <= k; dj++)
      for (let di = -k; di <= k; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== k) continue;
        const px = (ci + di) * r;
        const py = (cj + dj) * r;
        if (!ok(px, py)) continue;
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < bd) {
          bd = d;
          best = { x: px, y: py };
        }
      }
    if (best) return best;
  }
  return null;
}

function siteTree(s: TreeSiteDef, trunks: TrunkDef[]): number {
  let best = -1;
  let bd = Infinity;
  for (const t of trunks) {
    const d = dhypot(t.x - s.x, t.y - s.y);
    if (d < bd) {
      bd = d;
      best = t.tree;
    }
  }
  return best;
}

function nearestWalkHex(g: NestGrid, kinds: Uint8Array, x: number, y: number): number {
  const q0 = g.hexAt(x, y);
  if (q0 < 0) return -1;
  if (kinds[q0] === TK_WOOD || kinds[q0] === TK_LEAF) return q0;
  // rings outward (deterministic order)
  const seen = new Set<number>([q0]);
  let ring = [q0];
  for (let k = 0; k < 6; k++) {
    const next: number[] = [];
    for (const q of ring)
      for (const n of g.neighbors(q)) {
        if (n < 0 || seen.has(n)) continue;
        seen.add(n);
        if (kinds[n] === TK_WOOD || kinds[n] === TK_LEAF) return n;
        next.push(n);
      }
    ring = next;
  }
  return -1;
}

export function kindsToString(k: Uint8Array): string {
  let s = '';
  for (let i = 0; i < k.length; i++) s += String.fromCharCode(48 + k[i]);
  return s;
}

export function kindsOf(def: TreesDef): Uint8Array {
  const out = new Uint8Array(def.kinds.length);
  for (let i = 0; i < out.length; i++) out[i] = def.kinds.charCodeAt(i) - 48;
  return out;
}

/** A replica (or a client) whose state says the layer is on but has no canopy grid yet builds it (the same grid, by construction). */
export function attachTreesGrid(w: World): void {
  if (!w.s.trees || w.nestOf(TREES)) return;
  const built = buildCanopy(w);
  if (!built) return;
  w.addGrid(TREES, built.g);
  w.treesData = built.data;
  applyTreesToTerrain(w);
}

/** The trunks block the ground (walls ants walk round); applied at creation and again when a terrain is rebuilt from a save. */
export function applyTreesToTerrain(w: World): void {
  const d = w.s.trees;
  if (!d) return;
  w.terrain.setTrunks(d.trunks.map((t) => ({ x: t.x, y: t.y, r: t.r })));
}

/** Every climb point of every trunk (the trees space's entrances). */
export function treeEntrances(w: World): Entrance[] {
  const d = w.s.trees;
  if (!d) return NO;
  if (d.trunks.length === 1) return d.trunks[0].climbs;
  const out: Entrance[] = [];
  for (const t of d.trunks) for (const e of t.climbs) out.push(e);
  return out;
}
const NO: Entrance[] = [];

/** How far a climb goes up a trunk (mm): the canopy's height and on up to the crotch's tier. */
export function climbHeight(w: World, t: TrunkDef | null | undefined): number {
  return (w.s.trees?.height ?? T.height) + (t?.z ?? 0);
}

/** The seconds a climb of that trunk takes (its height at the climb's speed: `climbSec` for the canopy's height). */
export function climbSeconds(w: World, t?: TrunkDef | null): number {
  return (T.climbSec * climbHeight(w, t)) / T.height;
}

/** Is the layer on in this match? */
export function treesOn(w: World): boolean {
  return !!w.s.trees;
}

/**
 * The hold on the trunk: an ant that has just climbed in (or out) stays on the bark for `climbSeconds`, held — no brain,
 * no moving, no target — and is drawn climbing at its climb point. Called from the ant system before the brain.
 * Returns true while the ant is on the trunk.
 */
export function trunkHold(a: { trunkT?: number; v: number }, dt: number): boolean {
  if (!a.trunkT || a.trunkT <= 0) return false;
  a.trunkT -= dt;
  a.v = 0;
  if (a.trunkT <= 0) a.trunkT = 0;
  return a.trunkT > 0;
}

/** Start a climb: up (`up` true, the ant has just entered the trees at a climb point) or down (it has just come out). */
export function startClimb(w: World, a: { trunkT?: number; trunkUp?: number; trunkX?: number; trunkY?: number; v: number }, e: Entrance, up: boolean): void {
  a.trunkT = climbSeconds(w, trunkOf(w, e));
  a.trunkUp = up ? 1 : 0;
  a.trunkX = e.sx;
  a.trunkY = e.sy;
  a.v = 0;
}

/**
 * Put a colony's nest in the trees (the framework for tree nests; the dev placeholder colony until a species comes): its
 * holes move from the anthill to the site's branch (`Entrance.space` = TREES), the site is taken, and the colony's
 * surface centre is the site (nothing of it is drawn on the ground). The nest grid itself stays a normal nest.
 */
export function moveNestToTree(w: World, c: Colony, siteIdx: number): void {
  const d = w.s.trees;
  const site = d?.sites[siteIdx];
  if (!d || !site) return;
  site.nest = c.id;
  c.treeSite = siteIdx;
  c.nx = site.x;
  c.ny = site.y;
  const q = c.entrances[0]?.q ?? 0;
  const e = makeEntrance(q, site.x, site.y, w.time);
  e.space = TREES;
  c.entrances = [e];
  c.spoil = [0];
}

/**
 * The crown a point of the trees map is in (0: sky or off the layer). Per fine cell (the floor's own crowns): a hex
 * whose centre is not floor may still carry floor at its edge, and an ant standing there is in a crown.
 */
export function crownAt(w: World, x: number, y: number): number {
  const d = w.s.trees;
  const g = w.nestOf(TREES);
  if (!d || !g) return 0;
  const td = w.treesData;
  if (td) {
    const k = cellIndex(g, x, y);
    if (k < 0) return 0;
    if (td.comp[k]) return td.comp[k];
  }
  const q = g.hexAt(x, y);
  return q < 0 ? 0 : d.comps.charCodeAt(q) - 48;
}

/** The climb points that lead into the crown over a goal (every climb point when the goal is in no crown). */
export function climbsToward(w: World, gx: number, gy: number): Entrance[] {
  const d = w.s.trees;
  const comp = crownAt(w, gx, gy);
  if (!d || !comp) return treeEntrances(w);
  const out: Entrance[] = [];
  for (const t of d.trunks) if (t.comp === comp) for (const e of t.climbs) out.push(e);
  return out.length ? out : treeEntrances(w);
}

/** The trunk a climb point belongs to (null: not a climb point). */
export function trunkOf(w: World, e: Entrance): TrunkDef | null {
  const d = w.s.trees;
  if (!d) return null;
  for (const t of d.trunks) if (t.climbs.includes(e)) return t;
  return null;
}

/** The space a hole opens onto (the surface unless the entrance says otherwise: a tree nest's hole on a branch). */
export function holeSpace(e: Entrance): number {
  return e.space ?? SURFACE;
}

/**
 * The nearest floor of the trees grid to (x, y) (markers dropped in the sky move to the nearest branch): rings of fine
 * cells outward, the nearest floor cell's centre; null when none within `maxHex` hexes.
 */
export function nearestBranch(w: World, x: number, y: number, maxHex = 12): { x: number; y: number } | null {
  const g = w.nestOf(TREES);
  if (!g) return null;
  if (g.isAirAt(x, y)) return { x, y };
  const ci = Math.floor(x / g.cell);
  const cj = Math.floor(y / g.cell);
  const K = Math.ceil((maxHex * g.R * 1.5) / g.cell);
  for (let k = 1; k <= K; k++) {
    let best = -1;
    let bd = Infinity;
    for (let dj = -k; dj <= k; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= g.h) continue;
      const edge = dj === -k || dj === k;
      for (let di = -k; di <= k; di += edge ? 1 : 2 * k) {
        const i = ci + di;
        if (i < 0 || i >= g.w || !g.isAir(i, j)) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = j * g.w + i;
        }
      }
    }
    if (best >= 0) return { x: ((best % g.w) + 0.5) * g.cell, y: (Math.floor(best / g.w) + 0.5) * g.cell };
  }
  return null;
}

/** The floor's height in the trees at a point (mm over the canopy plane; 0 off the floor or without the layer). */
export function treesFloorZ(w: World, x: number, y: number): number {
  const d = w.treesData;
  const g = w.nestOf(TREES);
  if (!d || !g) return 0;
  const k = cellIndex(g, x, y);
  return k < 0 ? 0 : Math.max(0, d.h[k]);
}

/** In the trees: the share of its speed an ant keeps walking from (x, y) along (ux, uy) — `LAYERS.upSpeed` up a slope, as on the ground's ramps. */
export function treesSlopeSpeed(w: World, x: number, y: number, ux: number, uy: number): number {
  const d = w.treesData;
  const g = w.nestOf(TREES);
  if (!d || !g) return 1;
  const k0 = cellIndex(g, x, y);
  const k1 = cellIndex(g, x + ux * 3, y + uy * 3);
  if (k0 < 0 || k1 < 0 || d.h[k0] < 0 || d.h[k1] < 0) return 1;
  return d.h[k1] - d.h[k0] > 0.5 ? LAYERS.upSpeed : 1;
}

/** In the trees: are two points on different tiers — one more than `TREES.reachZ` above the other (out of reach)? */
export function treesApart(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  const d = w.treesData;
  const g = w.nestOf(TREES);
  if (!d || !g) return false;
  const ka = cellIndex(g, ax, ay);
  const kb = cellIndex(g, bx, by);
  if (ka < 0 || kb < 0) return false;
  return Math.abs(Math.max(0, d.h[ka]) - Math.max(0, d.h[kb])) > T.reachZ;
}

export { SOIL_AIR };
