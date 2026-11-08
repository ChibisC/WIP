/**
 * The Trees: a third layer above the ground (claude/trees/01-spec-trees-layer.md; CHANGE_PLAN §30).
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
import { shapeDist } from '../world/mapShapes';
import type { CrownStyle, Pt, Shape, TreeDef } from '../maps/types';
import { TREES as T } from './balance';
import { dcos, dhypot, dsin, datan2 } from './dmath';
import { makeEntrance } from './entrances';
import { makeFood } from './factory';
import { Colony, Entrance, SURFACE, TREES, TreeSiteDef, TreeSiteKind, TreesDef, TrunkDef } from './types';
import { World } from './world';

/** per-hex kinds of the trees grid (`TreesDef.kinds`) */
export const TK_SKY = 0;
export const TK_WOOD = 1;
export const TK_LEAF = 2;
export const TK_TOP = 3;
export const TK_FLOWER = 4;

export interface CrownShapes {
  branches: Array<{ path: Pt[]; width: number; main: boolean }>;
  leaves: Array<{ at: Pt; rx: number; ry: number; rot: number }>;
  flowers: Pt[];
  sites: Array<{ kind: TreeSiteKind; at: Pt }>;
}

const STYLE: Record<CrownStyle, { branches: [number, number]; width: number; droop: number; twigs: number; leaf: number; flowers: number; wobble: number }> = {
  oak: { branches: [5, 6], width: 2.6, droop: 0.3, twigs: 2, leaf: 1.0, flowers: 1, wobble: 0.35 },
  beech: { branches: [4, 5], width: 2.2, droop: 0.2, twigs: 2, leaf: 1.1, flowers: 0, wobble: 0.25 },
  tropical: { branches: [5, 7], width: 2.8, droop: 0.15, twigs: 3, leaf: 1.4, flowers: 2, wobble: 0.3 },
  willow: { branches: [6, 8], width: 1.8, droop: 0.6, twigs: 1, leaf: 0.7, flowers: 0, wobble: 0.5 },
  acacia: { branches: [4, 5], width: 2.0, droop: 0.05, twigs: 2, leaf: 0.6, flowers: 1, wobble: 0.2 },
  sapling: { branches: [3, 3], width: 1.6, droop: 0.1, twigs: 1, leaf: 0.8, flowers: 0, wobble: 0.3 },
};

/**
 * Grow a crown: main branches radiating from the trunk top, each a wobbling polyline that narrows outward and
 * splits into twigs, with leaf platforms at the twigs' ends and a few along the way; flowers (food sites) on some
 * leaves; nest-site candidates (a leaf cluster at a branch end, a hollow on a thick branch near the trunk, a sheltered
 * fork at a twig split). Deterministic in the tree's seed. Widths are in hexes (× the grid's hex width).
 */
export function crownShapes(def: TreeDef, hexW: number): CrownShapes {
  const st = STYLE[def.style];
  const rng = new Rng(def.seed * 131 + 17);
  const out: CrownShapes = { branches: [], leaves: [], flowers: [], sites: [] };
  if (def.branches) {
    for (const b of def.branches) out.branches.push({ path: [...b.path], width: b.width, main: true });
    for (const l of def.leaves ?? []) out.leaves.push({ at: l.at, rx: l.rx, ry: l.ry, rot: l.rot ?? 0 });
    out.flowers = [...(def.flowers ?? [])];
    out.sites = (def.sites ?? []).map((s) => ({ kind: s.kind, at: s.at }));
    return out;
  }
  const [tx, ty] = def.trunk;
  const n = rng.int(st.branches[0], st.branches[1]);
  const a0 = rng.range(0, Math.PI * 2);
  const leafR = hexW * 1.6 * st.leaf;
  for (let i = 0; i < n; i++) {
    const ang = a0 + (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const reach = def.reach * rng.range(0.75, 1.05);
    const segs = 4;
    const path: Pt[] = [[tx + dcos(ang) * def.r * 0.5, ty + dsin(ang) * def.r * 0.5]];
    let x = tx + dcos(ang) * def.r;
    let y = ty + dsin(ang) * def.r;
    let h = ang;
    for (let k = 1; k <= segs; k++) {
      h += rng.range(-st.wobble, st.wobble) + (k === 1 ? 0 : st.droop * 0.3 * rng.sign());
      const len = (reach - def.r) / segs;
      x += dcos(h) * len;
      y += dsin(h) * len;
      path.push([x, y]);
    }
    // a main branch: wide at the trunk, narrowing to a twig at its end (three pieces of falling width)
    const w0 = hexW * st.width;
    for (let k = 0; k < segs; k++) {
      const u = k / segs;
      const width = w0 * (1 - 0.62 * u);
      out.branches.push({ path: [path[k], path[k + 1]], width, main: k < 2 });
    }
    // leaves at the end and a cluster near it
    const end = path[segs];
    out.leaves.push({ at: end, rx: leafR * 1.5, ry: leafR, rot: h });
    out.leaves.push({ at: [end[0] + dcos(h + 1.2) * leafR * 1.2, end[1] + dsin(h + 1.2) * leafR * 1.2], rx: leafR, ry: leafR * 0.7, rot: h + 0.6 });
    if (i % 2 === 0) out.sites.push({ kind: 'leaf', at: end });
    if (st.flowers && rng.chance(0.6)) out.flowers.push([end[0] + dcos(h - 1.1) * leafR * 0.6, end[1] + dsin(h - 1.1) * leafR * 0.6]);
    // hollow: on the thick part near the trunk
    if (i === 1) out.sites.push({ kind: 'hollow', at: [path[1][0], path[1][1]] });
    // twigs off the middle of the branch, with a leaf at each end; the split is a sheltered fork
    for (let t = 0; t < st.twigs; t++) {
      const k = 1 + rng.int(0, segs - 3);
      const from = path[k];
      const side = rng.sign();
      const th = datan2(path[k + 1][1] - path[k][1], path[k + 1][0] - path[k][0]) + side * rng.range(0.7, 1.2);
      const tl = def.reach * rng.range(0.25, 0.42);
      const mid: Pt = [from[0] + dcos(th) * tl * 0.5, from[1] + dsin(th) * tl * 0.5];
      const th2 = th + rng.range(-st.wobble, st.wobble);
      const tip: Pt = [mid[0] + dcos(th2) * tl * 0.5, mid[1] + dsin(th2) * tl * 0.5];
      out.branches.push({ path: [from, mid, tip], width: hexW * 1.05, main: false });
      out.leaves.push({ at: tip, rx: leafR * 1.1, ry: leafR * 0.8, rot: th2 });
      if (t === 0 && i % 3 === 2) out.sites.push({ kind: 'fork', at: from });
      if (st.flowers > 1 && rng.chance(0.4)) out.flowers.push(tip);
    }
  }
  return out;
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

/**
 * The canopy grid and its hexes from the match's trees: a pure function of the terrain and the trees' definitions, so
 * the worker's replica builds the same grid when the layer appears (game/replica.ts) and a save needs only the def.
 */
export function buildCanopy(w: World): { g: NestGrid; kinds: Uint8Array; comps: Uint8Array; trunks: TrunkDef[]; siteCands: Array<{ kind: TreeSiteKind; x: number; y: number; tree: number }>; defs: TreeDef[] } | null {
  const defs = treesOf(w);
  if (!defs.length) return null;
  const g = treesGrid(w);
  const hexW = g.R * Math.sqrt(3);
  const nh = g.cols * g.rows;
  const kinds = new Uint8Array(nh);
  // all rock, nothing diggable
  g.hexSoil.fill(SOIL_ROCK);
  g.soil.fill(SOIL_ROCK);
  g.hexTotal.fill(0);
  g.hexWork.fill(0);
  const trunks: TrunkDef[] = [];
  const siteCands: Array<{ kind: TreeSiteKind; x: number; y: number; tree: number }> = [];
  const flowers: Pt[] = [];
  const shapesOf: Array<{ shape: Shape; kind: number }> = [];
  const p = { x: 0, y: 0 };
  defs.forEach((def, ti) => {
    const crown = crownShapes(def, hexW);
    for (const b of crown.branches) shapesOf.push({ shape: { path: b.path, width: b.width }, kind: TK_WOOD });
    for (const l of crown.leaves) shapesOf.push({ shape: { ellipse: l.at, rx: l.rx, ry: l.ry, rot: l.rot }, kind: TK_LEAF });
    shapesOf.push({ shape: { circle: def.trunk, r: Math.max(def.r, hexW * 1.2) }, kind: TK_TOP });
    for (const f of crown.flowers) flowers.push(f);
    for (const s of crown.sites) siteCands.push({ kind: s.kind, x: s.at[0], y: s.at[1], tree: ti });
    const top = g.hexAt(def.trunk[0], def.trunk[1]);
    trunks.push({ x: def.trunk[0], y: def.trunk[1], r: def.r, top, climbs: [], tree: ti, comp: 0 });
  });
  // paint the hexes: wood first, then leaves over it, the trunk tops last
  for (const kind of [TK_WOOD, TK_LEAF, TK_TOP]) {
    for (const s of shapesOf) {
      if (s.kind !== kind) continue;
      // (only the hexes near the shape are tested)
      const bb = boundsOf(s.shape);
      const q0 = g.hexAt(Math.max(0, bb.x0), Math.max(0, bb.y0));
      const q1 = g.hexAt(Math.min(g.widthMm - 1, bb.x1), Math.min(g.depthMm - 1, bb.y1));
      const c0 = Math.max(0, (q0 >= 0 ? g.hexCol(q0) : 0) - 1);
      const r0 = Math.max(0, (q0 >= 0 ? g.hexRow(q0) : 0) - 1);
      const c1 = Math.min(g.cols - 1, (q1 >= 0 ? g.hexCol(q1) : g.cols - 1) + 1);
      const r1 = Math.min(g.rows - 1, (q1 >= 0 ? g.hexRow(q1) : g.rows - 1) + 1);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const q = g.hexIndex(c, r);
          g.hexCenter(q, p);
          if (shapeDist(s.shape, p.x, p.y) < g.R * 0.35) kinds[q] = kind;
        }
    }
  }
  for (const f of flowers) {
    const q = g.hexAt(f[0], f[1]);
    if (q >= 0 && kinds[q]) kinds[q] = TK_FLOWER;
  }
  // each crown must hang together with its trunk top: hexes no trunk top can reach are pruned (sky); crowns that touch
  // are one component (ants walk between them), others are reached by the ground
  const comps = new Uint8Array(nh);
  let nComp = 0;
  for (const tr of trunks) {
    if (tr.top < 0 || !kinds[tr.top]) continue;
    if (comps[tr.top]) {
      tr.comp = comps[tr.top];
      continue;
    }
    tr.comp = ++nComp;
    comps[tr.top] = nComp;
    const stack = [tr.top];
    while (stack.length) {
      const q = stack.pop()!;
      for (const n of g.neighbors(q))
        if (n >= 0 && kinds[n] && !comps[n]) {
          comps[n] = nComp;
          stack.push(n);
        }
    }
  }
  for (let q = 0; q < nh; q++) if (kinds[q] && !comps[q]) kinds[q] = TK_SKY;
  // dig the walkable hexes
  for (let q = 0; q < nh; q++) {
    if (!kinds[q]) continue;
    g.hexSoil[q] = SOIL_LOAM;
    for (const c of g.hexCells[q]) g.soil[c] = SOIL_LOAM;
    g.completeHex(q);
  }
  // the trunk tops are the grid's entrances
  for (const tr of trunks) if (tr.top >= 0 && kinds[tr.top]) g.addEntrance([tr.top]);
  g.version++;
  g.stateVersion++;
  g.dirtyAll();
  return { g, kinds, comps, trunks, siteCands, defs };
}

/**
 * Build the Trees map: the grid, the trunks and their climb points, the sites, the food; registers the space.
 * Returns the definition (also kept in `w.s.trees`).
 */
export function createTrees(w: World): TreesDef | null {
  if (w.s.trees) return w.s.trees;
  const built = buildCanopy(w);
  if (!built) return null;
  const { g, kinds, comps, trunks, siteCands, defs } = built;
  const nh = g.cols * g.rows;
  const p = { x: 0, y: 0 };
  // the trunk tops are the grid's entrances; the climb points at the foot are the space's entrances
  const rng = new Rng(w.s.seed * 29 + 3);
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
  const def: TreesDef = { space: TREES, trunks, sites, kinds: kindsToString(kinds), comps: kindsToString(comps), height: T.height };
  w.addGrid(TREES, g);
  w.s.trees = def;
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

function boundsOf(s: Shape): { x0: number; y0: number; x1: number; y1: number } {
  if ('circle' in s) return { x0: s.circle[0] - s.r, y0: s.circle[1] - s.r, x1: s.circle[0] + s.r, y1: s.circle[1] + s.r };
  if ('ellipse' in s) {
    const m = Math.max(s.rx, s.ry);
    return { x0: s.ellipse[0] - m, y0: s.ellipse[1] - m, x1: s.ellipse[0] + m, y1: s.ellipse[1] + m };
  }
  const pts = 'path' in s ? s.path : s.poly;
  const m = 'path' in s ? s.width : 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x - m);
    y0 = Math.min(y0, y - m);
    x1 = Math.max(x1, x + m);
    y1 = Math.max(y1, y + m);
  }
  return { x0, y0, x1, y1 };
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

/** The seconds a climb takes (the canopy's height at the climb's speed). */
export function climbSeconds(w: World): number {
  return T.climbSec * ((w.s.trees?.height ?? T.height) / T.height);
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
  a.trunkT = climbSeconds(w);
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

/** The crown a point of the trees map is in (0: sky or off the layer). */
export function crownAt(w: World, x: number, y: number): number {
  const d = w.s.trees;
  const g = w.nestOf(TREES);
  if (!d || !g) return 0;
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
 * The nearest walkable point of the trees grid to (x, y) (markers dropped in the sky move to the nearest branch);
 * null when none within `maxHex` hexes.
 */
export function nearestBranch(w: World, x: number, y: number, maxHex = 12): { x: number; y: number } | null {
  const g = w.nestOf(TREES);
  if (!g) return null;
  const q0 = g.hexAt(x, y);
  if (q0 < 0) return null;
  if (g.isHexDug(q0) && g.isAirAt(x, y)) return { x, y };
  const seen = new Set<number>([q0]);
  let ring = [q0];
  const p = { x: 0, y: 0 };
  for (let k = 0; k < maxHex; k++) {
    const next: number[] = [];
    let best = -1;
    let bd = Infinity;
    for (const q of ring)
      for (const n of g.neighbors(q)) {
        if (n < 0 || seen.has(n)) continue;
        seen.add(n);
        if (g.isHexDug(n)) {
          g.hexCenter(n, p);
          const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
          if (d < bd) {
            bd = d;
            best = n;
          }
        } else next.push(n);
      }
    if (best >= 0) {
      g.hexCenter(best, p);
      return { x: p.x, y: p.y };
    }
    ring = next;
  }
  return null;
}

export { SOIL_AIR };
