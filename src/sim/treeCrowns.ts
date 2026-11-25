/**
 * Trees v2 (claude/trees/02-spec-trees-look-and-tiers.md; CHANGE_PLAN §38): the crowns as real trees — round wood
 * in branch tiers like the ground's levels, joined by sloping branches that work like its ramps — and the walkable
 * floor painted from them.
 *
 * A crown is a **skeleton** (`crownSkeleton`, deterministic in the tree's seed and style, `TREES.crowns`): the trunk
 * rising to its crotch at the trunk top's tier; **limbs** leaving the crotch round the compass — rising ones (short)
 * climb to the tier above, level ones stay, spreading ones (long) drop a tier per slope toward the outside, so from
 * above the high tier lies toward the middle and the low ones round it; limbs fork into **branches** (on the limb's
 * tier, or one lower outward: crowns droop) and these into **twigs**, which end in **big leaves** (walkable platforms
 * at the twig's height) where the species has them. Every piece is a polyline of nodes (x, y, z, r): z is the top of
 * the wood over the canopy plane — tier l stands at `l × TREES.tierStep` — and r the wood's radius. Slopes rise
 * `TREES.slope` (≤ the ground ramps' limit) over their run; everything else is flat at a tier. The render draws the
 * same skeleton as round 3D wood (render/trees/woodMesh.ts).
 *
 * **The floor** (`paintCanopy`): a fine cell within a piece's walkable band (`r × TREES.walkShare` either side of its
 * axis) is floor at that piece's top; where pieces overlap the highest wins (what is seen from above). The drops then
 * **block like the ground's cliffs**: a floor cell with another within two cells that is higher by more than
 * `TREES.stepMax` mm a cell turns to rock — a lower branch stops short under a higher one (its wood still passes
 * beneath) and no one walks off a tier; only a fling drops an ant. Floor no trunk top reaches is pruned.
 *
 * Plain arithmetic and `dmath` only: every copy of the world builds the same bytes.
 */
import { Rng } from '../core/rng';
import type { CrownStyle, Pt, TreeDef } from '../maps/types';
import { TREES as T } from './balance';
import { dcos, dhypot, dsin, datan2, TAU } from './dmath';
import type { TreeSiteKind } from './types';

/** per-hex and per-cell kinds of the trees grid (`TreesDef.kinds`) */
export const TK_SKY = 0;
export const TK_WOOD = 1;
export const TK_LEAF = 2;
export const TK_TOP = 3;
export const TK_FLOWER = 4;

/** A node of a piece of wood: plan position (mm); z the top of the wood over the canopy plane (the trunk: its axis), r its radius (mm). */
export interface WoodNode {
  x: number;
  y: number;
  z: number;
  r: number;
}

export type WoodKind = 'trunk' | 'limb' | 'branch' | 'twig' | 'link';

export interface WoodPiece {
  nodes: WoodNode[];
  kind: WoodKind;
  /** the piece it grows from (−1: the trunk, a limb (it grows from the trunk's top), a link) */
  parent: number;
  /** the tree (index into the match's trees; −1 a link between two crowns) */
  tree: number;
  /** walkable: painted into the floor (the trunk is not: it is climbed) */
  walk: boolean;
}

/** A big leaf: a walkable platform at its twig's height (an ellipse in mm, `rot` along the blade). */
export interface BigLeaf {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rot: number;
  tree: number;
  /** the twig it grows on (index into the crown's pieces) */
  piece: number;
}

export interface CrownSkel {
  tree: number;
  style: CrownStyle;
  tiers: number;
  /** the crotch — the trunk's top, where every climb arrives: its tier, height (mm) and walkable radius (mm) */
  topLv: number;
  topZ: number;
  topR: number;
  x: number;
  y: number;
  /** pieces[0] is the trunk, from the ground (z = −TREES.height) up to the crotch */
  pieces: WoodPiece[];
  leaves: BigLeaf[];
  flowers: Pt[];
  sites: Array<{ kind: TreeSiteKind; at: Pt }>;
  /** the ends of the wood on tier 0 (the boughs to the other crowns start at one) */
  lowTips: Pt[];
}

/** a stretch of a growing piece: its plan length and its rise over it (mm) */
interface Stretch {
  len: number;
  dz: number;
}

/** plan length of a growing step (mm): nodes this far apart */
const STEP = 16;

/**
 * Grow a piece outward from (x, y, z) heading `h`: on its flats the plan path wanders by up to `wobble` a step but
 * never more than 0.7 rad from where it set out (its slopes run straight); z follows the stretches (flat or rising evenly over a stretch's plan length, so a
 * slope is exactly dz / len); r tapers from r0 to r1.
 */
function grow(rng: Rng, x: number, y: number, z: number, h: number, st: Stretch[], r0: number, r1: number, wobble: number): { nodes: WoodNode[]; h: number } {
  let L = 0;
  for (const a of st) L += a.len;
  const nodes: WoodNode[] = [{ x, y, z, r: r0 }];
  const h0 = h;
  let s = 0;
  // the flats meander: a slow sway (its wavelength and phase the piece's own), a slight arc, a little jitter
  const lam = rng.range(55, 95);
  const ph = rng.range(0, TAU);
  const amp = wobble * 1.8;
  const arc = rng.range(-1, 1) * wobble * 0.004;
  let jit = 0;
  for (const a of st) {
    const n = Math.max(1, Math.round(a.len / STEP));
    const z0 = z;
    const l = a.len / n;
    for (let k = 1; k <= n; k++) {
      // (a slope runs straight, like a ramp: on a bend the nearest point of the axis jumps, and so would the floor)
      if (!a.dz) {
        jit += rng.range(-wobble, wobble) * 0.35;
        jit *= 0.8;
        h = h0 + Math.max(-0.8, Math.min(0.8, amp * dsin(s / lam + ph) - amp * dsin(ph) + arc * s + jit));
      }
      x += dcos(h) * l;
      y += dsin(h) * l;
      s += l;
      z = z0 + (a.dz * k) / n;
      nodes.push({ x, y, z, r: r0 + ((r1 - r0) * s) / L });
    }
  }
  return { nodes, h };
}

/** The heading of a piece at node k (from k to k + 1, or the last step). */
function headingAt(nodes: WoodNode[], k: number): number {
  const a = nodes[Math.min(k, nodes.length - 2)];
  const b = nodes[Math.min(k + 1, nodes.length - 1)];
  return datan2(b.y - a.y, b.x - a.x);
}

/** Nodes k where the piece is flat both ways (forks grow there: a branch leaves the limb on a tier). */
function flatNodes(nodes: WoodNode[]): number[] {
  const out: number[] = [];
  for (let k = 1; k < nodes.length - 1; k++) if (Math.abs(nodes[k].z - nodes[k - 1].z) < 1e-6 && Math.abs(nodes[k + 1].z - nodes[k].z) < 1e-6) out.push(k);
  return out;
}

/** The number of tiers a tree's crown has (its style's, one more for a big reach; 2–4). */
export function crownTiers(def: TreeDef): number {
  const st = T.crowns[def.style] ?? T.crowns.oak;
  return Math.max(2, Math.min(4, st.tiers + (def.reach >= T.bigReach ? 1 : 0)));
}

/** The trunk top's tier (the crotch sits in the middle: 2 tiers → 1, 3 → 1, 4 → 2). */
export function topTier(tiers: number): number {
  return Math.floor(tiers / 2);
}

/**
 * The boughs between crowns join the trees in a spanning tree, shortest first (user 2026-11-07: "all trees are
 * connected to each other with branches reaching out"): the pairs of tree indices.
 */
export function crownLinks(defs: readonly TreeDef[]): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  if (defs.length < 2) return edges;
  const inTree = new Set<number>([0]);
  while (inTree.size < defs.length) {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (const a of inTree)
      defs.forEach((d, b) => {
        if (inTree.has(b)) return;
        const dd = dhypot(d.trunk[0] - defs[a].trunk[0], d.trunk[1] - defs[a].trunk[1]);
        if (dd < bd) {
          bd = dd;
          best = [a, b];
        }
      });
    if (!best) break;
    inTree.add(best[1]);
    edges.push(best);
  }
  return edges;
}

/** The headings from each tree toward the trees its boughs join (its spreading limbs reach out that way). */
export function linkHeadings(defs: readonly TreeDef[]): number[][] {
  const out: number[][] = defs.map(() => []);
  for (const [a, b] of crownLinks(defs)) {
    const A = defs[a].trunk;
    const B = defs[b].trunk;
    out[a].push(datan2(B[1] - A[1], B[0] - A[0]));
    out[b].push(datan2(A[1] - B[1], A[0] - B[0]));
  }
  return out;
}

/**
 * Grow a tree's crown (deterministic in its seed). `toward`: headings of the crowns its boughs join — the limb nearest
 * each spreads out that way and drops to tier 0, so a bough leaves from its tip.
 */
export function crownSkeleton(def: TreeDef, tree: number, toward: readonly number[] = []): CrownSkel {
  const st = T.crowns[def.style] ?? T.crowns.oak;
  const rng = new Rng(def.seed * 131 + 17);
  const tiers = crownTiers(def);
  const topLv = topTier(tiers);
  const step = T.tierStep;
  const topZ = topLv * step;
  const run = step / T.slope;
  const [tx, ty] = def.trunk;
  const topR = Math.max(def.r * 0.85, T.hexR * 2);
  const R = def.reach;
  const sk: CrownSkel = { tree, style: def.style, tiers, topLv, topZ, topR, x: tx, y: ty, pieces: [], leaves: [], flowers: [], sites: [], lowTips: [] };
  // the trunk: its axis from the ground far below up to the crotch (render only — it is climbed, not walked)
  sk.pieces.push({
    kind: 'trunk',
    parent: -1,
    tree,
    walk: false,
    nodes: [
      { x: tx, y: ty, z: -T.height, r: def.r },
      { x: tx, y: ty, z: -T.height * 0.4 + topZ * 0.4, r: def.r * 0.92 },
      { x: tx, y: ty, z: topZ - def.r * 0.3, r: def.r * 0.86 },
    ],
  });
  // limbs round the compass: the rising ones spaced out between the others, then the level ones
  const n = rng.int(st.limbs[0], st.limbs[1]);
  const a0 = rng.range(0, TAU);
  const nRise = topLv + 1 < tiers ? Math.min(st.rise, n - 1) : 0;
  const nLevel = Math.max(0, Math.min(st.level, n - nRise - 1));
  const role: Array<'rise' | 'level' | 'spread'> = new Array(n).fill('spread');
  for (let k = 0; k < nRise; k++) role[Math.floor((k * n) / nRise)] = 'rise';
  let lv = 0;
  for (let k = 0; k < n && lv < nLevel; k++) {
    const i = (Math.floor(n / 2) + k * 2 + 1) % n;
    if (role[i] === 'spread') {
      role[i] = 'level';
      lv++;
    }
  }
  if (lv < nLevel) for (let i = 0; i < n && lv < nLevel; i++) if (role[i] === 'spread') (role[i] = 'level'), lv++;
  // the limbs' headings; the one nearest each linked crown points at it and spreads (it swaps roles with a spreading one)
  const angs: number[] = [];
  for (let i = 0; i < n; i++) angs.push(a0 + (i / n) * TAU + rng.range(-0.22, 0.22));
  for (const t of toward) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(((((angs[i] - t) % TAU) + TAU + Math.PI) % TAU) - Math.PI);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    angs[bi] = t;
    if (role[bi] !== 'spread') {
      const sw = role.findIndex((r, i) => r === 'spread' && !toward.some((u) => Math.abs(((((angs[i] - u) % TAU) + TAU + Math.PI) % TAU) - Math.PI) < 0.3));
      if (sw >= 0) role[sw] = role[bi];
      role[bi] = 'spread';
    }
  }
  const r0 = Math.max(T.limbMin, Math.min(T.limbMax, def.r * st.limbR));
  let hollowDone = false;
  let forkSites = 0;
  for (let i = 0; i < n; i++) {
    const ang = angs[i];
    const j = rng.range(0.92, 1.06);
    // (this limb's own thickness)
    const rl = Math.max(T.limbMin, r0 * rng.range(T.limbVary[0], T.limbVary[1]));
    const sx = tx + dcos(ang) * topR * 0.35;
    const sy = ty + dsin(ang) * topR * 0.35;
    const f0 = topR * 0.65 + Math.max(8, R * 0.06);
    const stretches: Stretch[] = [];
    if (role[i] === 'rise') {
      stretches.push({ len: f0, dz: 0 }, { len: run, dz: step }, { len: Math.max(40, R * 0.72 * j - (topR * 0.35 + f0 + run)), dz: 0 });
    } else if (role[i] === 'level') {
      stretches.push({ len: Math.max(60, R * 0.86 * j - topR * 0.35), dz: 0 });
    } else {
      const total = R * j - topR * 0.35;
      const fa = topR * 0.65 + R * 0.08;
      const fk = Math.max(30, (total - fa - topLv * run) / Math.max(1, topLv));
      stretches.push({ len: fa, dz: 0 });
      for (let k = 0; k < topLv; k++) stretches.push({ len: run, dz: -step }, { len: fk, dz: 0 });
    }
    const r1 = Math.max(T.twigR + 1, rl * st.taper);
    const limb = grow(rng, sx, sy, topZ, ang, stretches, rl, r1, st.wobble);
    const li = sk.pieces.length;
    sk.pieces.push({ kind: 'limb', parent: -1, tree, walk: true, nodes: limb.nodes });
    // a hollow in the thick wood near the crotch (the first level or spreading limb)
    if (!hollowDone && role[i] !== 'rise') {
      const nd = limb.nodes[Math.min(2, limb.nodes.length - 1)];
      sk.sites.push({ kind: 'hollow', at: [nd.x, nd.y] });
      hollowDone = true;
    }
    // forks on the limb's flats, in its outer part; the side alternates
    const flats = flatNodes(limb.nodes).filter((k) => k >= Math.max(2, Math.floor(limb.nodes.length * 0.3)));
    let side = rng.sign();
    for (let f = 0; f < st.forks && flats.length; f++) {
      const k = flats[Math.min(flats.length - 1, Math.floor(((f + 0.5) * flats.length) / st.forks))];
      const nd = limb.nodes[k];
      const bh = headingAt(limb.nodes, k) + side * rng.range(0.5, 0.95);
      side = -side;
      const br = Math.max(T.twigR + 1, nd.r * rng.range(T.branchShare[0], T.branchShare[1]));
      const blen = R * rng.range(0.22, 0.36);
      const drop = role[i] === 'spread' && nd.z > 0.5 && rng.chance(st.droop) && blen >= run + 35;
      const bst: Stretch[] = drop ? [{ len: 14, dz: 0 }, { len: run, dz: -step }, { len: blen - 14 - run, dz: 0 }] : [{ len: blen, dz: 0 }];
      const b = grow(rng, nd.x, nd.y, nd.z, bh, bst, br, Math.max(T.twigR, br * 0.72), st.wobble);
      const bi = sk.pieces.length;
      sk.pieces.push({ kind: 'branch', parent: li, tree, walk: true, nodes: b.nodes });
      if (forkSites < 2) {
        sk.sites.push({ kind: 'fork', at: [nd.x, nd.y] });
        forkSites++;
      }
      // twigs off the branch's end and its middle, ending in leaves
      for (let t = 0; t < st.twigs; t++) {
        const at = t === 0 ? b.nodes.length - 1 : Math.max(1, Math.floor(b.nodes.length * (0.45 + 0.2 * (t - 1))));
        twig(rng, sk, st, bi, b.nodes, at, side * (t % 2 === 0 ? 1 : -1));
      }
    }
    // the limb's own tip: a twig or two and leaves
    twig(rng, sk, st, li, limb.nodes, limb.nodes.length - 1, rng.sign());
    if (st.flowers && rng.chance(st.flowers)) {
      const tip = limb.nodes[limb.nodes.length - 1];
      sk.flowers.push([tip.x, tip.y]);
    }
  }
  // the ends of wood on tier 0: where the boughs to other crowns start
  for (const p of sk.pieces) {
    if (!p.walk) continue;
    const e = p.nodes[p.nodes.length - 1];
    if (Math.abs(e.z) < 1e-6) sk.lowTips.push([e.x, e.y]);
  }
  return sk;
}

/** A twig from node `at` of piece `pi`, at that node's height, with a big leaf at its tip (and a leaf site). */
function twig(rng: Rng, sk: CrownSkel, st: (typeof T.crowns)[string], pi: number, nodes: WoodNode[], at: number, side: number): void {
  const nd = nodes[at];
  const h = headingAt(nodes, at) + side * rng.range(0.35, 0.9);
  const len = rng.range(28, 50);
  const tr = T.twigR * rng.range(T.twigVary[0], T.twigVary[1]);
  const t = grow(rng, nd.x, nd.y, nd.z, h, [{ len, dz: 0 }], tr, Math.max(T.twigR * 0.92, tr * 0.92), st.wobble);
  const ti = sk.pieces.length;
  sk.pieces.push({ kind: 'twig', parent: pi, tree: sk.tree, walk: true, nodes: t.nodes });
  const tip = t.nodes[t.nodes.length - 1];
  if (st.leaf) {
    const rx = st.leaf[0] * rng.range(0.85, 1.15);
    const ry = st.leaf[1] * rng.range(0.85, 1.15);
    const lx = tip.x + dcos(t.h) * rx * 0.8;
    const ly = tip.y + dsin(t.h) * rx * 0.8;
    sk.leaves.push({ x: lx, y: ly, z: tip.z, rx, ry, rot: t.h, tree: sk.tree, piece: ti });
    if (sk.leaves.length % 3 === 1) sk.sites.push({ kind: 'leaf', at: [lx, ly] });
    if (st.flowers > 1 && rng.chance(st.flowers - 1)) sk.flowers.push([lx, ly]);
  } else if (sk.pieces.length % 5 === 0) sk.sites.push({ kind: 'leaf', at: [tip.x, tip.y] });
}

/**
 * The boughs that join the crowns (user 2026-11-07: "all trees are connected to each other with branches reaching
 * out"): the shortest spanning tree over the trunks; each link runs on tier 0 from the low tip of one crown nearest
 * the other to the other's low tip nearest it, with a gentle wobble.
 */
export function linkPieces(defs: readonly TreeDef[], skels: readonly CrownSkel[], above?: (x: number, y: number, z: number) => boolean, reached?: (tree: number, x: number, y: number, z: number) => boolean): WoodPiece[] {
  const out: WoodPiece[] = [];
  if (defs.length < 2) return out;
  const edges = crownLinks(defs);
  // the low tips of each crown nearest the other; of their pairs the bough that passes under no higher floor (it would
  // be cut there), then the shortest
  type P3 = [number, number, number];
  const onFlat = (z: number) => Math.abs(z) < 1e-6 || Math.abs(z - T.tierStep) < 1e-6;
  const nearest = (tree: number, x: number, y: number, fb: Pt): P3[] => {
    // (where a bough may meet the crown: the ends of its wood on tier 0 or 1 its own trunk top reaches, and of each
    // piece its reached node there nearest the other crown — as thicker wood above leaves fewer clear lines; any tier-0
    // tip if none is reached)
    const byDist = (p: P3 | Pt, q: P3 | Pt) => dhypot(p[0] - x, p[1] - y) - dhypot(q[0] - x, q[1] - y) || p[0] - q[0] || p[1] - q[1];
    const ok = (nd: WoodNode) => onFlat(nd.z) && (!reached || reached(tree, nd.x, nd.y, nd.z));
    const tips: P3[] = [];
    const low: P3[] = [];
    for (const p of skels[tree].pieces) {
      if (!p.walk) continue;
      const e = p.nodes[p.nodes.length - 1];
      if (ok(e)) tips.push([e.x, e.y, e.z]);
      let bp: P3 | null = null;
      for (const nd of p.nodes) if (ok(nd) && (!bp || byDist([nd.x, nd.y, nd.z], bp) < 0)) bp = [nd.x, nd.y, nd.z];
      if (bp) low.push(bp);
    }
    const c = [...tips.sort(byDist).slice(0, 8), ...low.sort(byDist).slice(0, 10)];
    if (c.length) return c;
    const all = skels[tree].lowTips;
    return all.length ? [...all].sort(byDist).slice(0, 6).map((p) => [p[0], p[1], 0] as P3) : [[fb[0], fb[1], 0]];
  };
  // (the shapes tried for a bough between two points: a gentle S-wobble either way, or a bow to either side round wood
  // that stands higher in its way)
  const SHAPES: Array<[number, number]> = [[0.05, 0], [-0.05, 0], [0.1, 0], [-0.1, 0], [0, 0.12], [0, -0.12], [0, 0.24], [0, -0.24]];
  // a bough runs on tier 0; from an end on tier 1 it slopes down (and up to one) at the branches' slope
  const bough = (A: P3, B: P3, ph: number, shape: [number, number] = SHAPES[0]): WoodNode[] | null => {
    const len = dhypot(B[0] - A[0], B[1] - A[1]);
    if ((A[2] + B[2]) / T.slope > len * 0.9) return null;
    const n = Math.max(2, Math.round(len / STEP));
    const h0 = datan2(B[1] - A[1], B[0] - A[0]);
    const nodes: WoodNode[] = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      // a sine wobble across the straight line, fading at both ends; or a bow
      const off = dsin(u * Math.PI * 2 + ph) * len * shape[0] * dsin(u * Math.PI) + len * shape[1] * dsin(u * Math.PI);
      const z = Math.max(0, A[2] - T.slope * u * len, B[2] - T.slope * (1 - u) * len);
      nodes.push({ x: A[0] + (B[0] - A[0]) * u + dcos(h0 + Math.PI / 2) * off, y: A[1] + (B[1] - A[1]) * u + dsin(h0 + Math.PI / 2) * off, z, r: T.linkR });
    }
    return nodes;
  };
  const cost = (nodes: WoodNode[]): number => {
    if (!above) return 0;
    let c = 0;
    for (let k = 1; k < nodes.length; k++) {
      const a = nodes[k - 1];
      const b = nodes[k];
      const m = Math.max(1, Math.ceil(dhypot(b.x - a.x, b.y - a.y) / 2));
      for (let t = 0; t < m; t++) {
        const x = a.x + ((b.x - a.x) * t) / m;
        const y = a.y + ((b.y - a.y) * t) / m;
        const z = a.z + ((b.z - a.z) * t) / m;
        const ox = (-(b.y - a.y) / Math.max(1e-6, dhypot(b.x - a.x, b.y - a.y))) * T.linkR * 0.8;
        const oy = ((b.x - a.x) / Math.max(1e-6, dhypot(b.x - a.x, b.y - a.y))) * T.linkR * 0.8;
        if (above(x, y, z) || above(x + ox, y + oy, z) || above(x - ox, y - oy, z)) c++;
      }
    }
    return c;
  };
  const bestBough = (a: number, b: number, seed: number): { nodes: WoodNode[]; cost: number } => {
    const rng = new Rng(defs[a].seed * 7 + defs[b].seed * 13 + seed);
    const ph = rng.range(0, 1);
    let best: WoodNode[] | null = null;
    let bc = Infinity;
    let bl = Infinity;
    for (const A of nearest(a, defs[b].trunk[0], defs[b].trunk[1], defs[a].trunk))
      for (const B of nearest(b, A[0], A[1], defs[b].trunk))
        for (let si = 0; si < SHAPES.length; si++) {
          const nodes = bough(A, B, ph, SHAPES[si]);
          if (!nodes) break;
          const c = cost(nodes);
          // (a bow is a little longer than the straight run, and a slope to tier 1 longer still: the plain wobble on
          // tier 0 wins a tie)
          const l = dhypot(B[0] - A[0], B[1] - A[1]) * (1 + Math.abs(SHAPES[si][1])) * (1 + (0.15 * (A[2] + B[2])) / T.tierStep);
          if (c < bc || (c === bc && l < bl)) {
            bc = c;
            bl = l;
            best = nodes;
          }
          if (c === 0) break;
        }
    return { nodes: best!, cost: bc };
  };
  // the spanning tree's edges first; an edge whose every bough would pass under higher wood (and be cut) gives way to
  // the next nearest pair of crowns that joins the same two parts, if one has a clear bough (Kruskal, nearest first)
  const part = defs.map((_, i) => i);
  const find = (i: number): number => (part[i] === i ? i : (part[i] = find(part[i])));
  const pairs: Array<[number, number, number]> = [];
  for (let a = 0; a < defs.length; a++)
    for (let b = a + 1; b < defs.length; b++) pairs.push([a, b, dhypot(defs[b].trunk[0] - defs[a].trunk[0], defs[b].trunk[1] - defs[a].trunk[1])]);
  pairs.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
  const mst = new Set(edges.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
  const tried = new Map<string, { nodes: WoodNode[]; cost: number }>();
  const tryPair = (a: number, b: number) => {
    const key = `${a}:${b}`;
    let r = tried.get(key);
    if (!r) tried.set(key, (r = bestBough(a, b, tried.size)));
    return r;
  };
  const join = (a: number, b: number, r: { nodes: WoodNode[]; cost: number }) => {
    part[find(a)] = find(b);
    out.push({ kind: 'link', parent: -1, tree: -1, walk: true, nodes: r.nodes });
  };
  // (the spanning tree's own edges where clear, then any clear pair, then the least cut)
  for (const [a, b] of pairs) if (mst.has(`${a}:${b}`) && find(a) !== find(b) && tryPair(a, b).cost === 0) join(a, b, tryPair(a, b));
  for (const [a, b] of pairs) if (find(a) !== find(b) && tryPair(a, b).cost === 0) join(a, b, tryPair(a, b));
  while (out.length < defs.length - 1) {
    let bp: [number, number] | null = null;
    let bc = Infinity;
    for (const [a, b] of pairs)
      if (find(a) !== find(b)) {
        const c = tryPair(a, b).cost;
        if (c < bc) {
          bc = c;
          bp = [a, b];
        }
      }
    if (!bp) break;
    join(bp[0], bp[1], tryPair(bp[0], bp[1]));
  }
  return out;
}

/** The floor painted from the crowns, per fine cell of the trees grid (see the file's comment). */
export interface CanopyFloor {
  /** the floor's height over the canopy plane (mm), −1 where there is none */
  h: Float32Array;
  /** its kind (TK_WOOD, TK_LEAF, TK_TOP) */
  kind: Uint8Array;
  /** how far across its wood the cell lies (0 the axis … 255 the walkable band's edge; leaves 0) — the render rounds the top */
  lat: Uint8Array;
  /** that wood's radius (mm, rounded) */
  rad: Uint8Array;
  /** the crown the cell is reached from (1 + the first trunk whose top reaches it; 0 none) */
  comp: Uint8Array;
  /** whose wood the floor is (1 + the tree; 255 a bough between crowns) */
  own: Uint8Array;
}

interface FloorGrid {
  w: number;
  h: number;
  cell: number;
}

const PRIO = [0, 1, 2, 3, 2];

/**
 * Paint the crowns into the floor, then the links between them (`makeLinks` is told where the crowns' floor stands
 * above tier 0), cut the drops and prune what no trunk top reaches.
 */
export function paintCanopy(g: FloorGrid, skels: readonly CrownSkel[], makeLinks: (above: (x: number, y: number, z: number) => boolean, reached: (tree: number, x: number, y: number, z: number) => boolean) => WoodPiece[]): CanopyFloor & { links: WoodPiece[] } {
  const W = g.w;
  const H = g.h;
  const n = W * H;
  const cs = g.cell;
  const hh = new Float32Array(n).fill(-1);
  const kind = new Uint8Array(n);
  const lat = new Uint8Array(n);
  const rad = new Uint8Array(n);
  const own = new Uint8Array(n);
  let who = 0;
  const write = (k: number, z: number, kd: number, u: number, r: number) => {
    const cur = hh[k];
    const uu = Math.min(255, Math.round(u * 255));
    if (z > cur + 0.01) {
      hh[k] = z;
      kind[k] = kd;
      lat[k] = uu;
      rad[k] = Math.min(255, Math.round(r));
      own[k] = who;
    } else if (z > cur - 0.01) {
      // the same height: one floor — the nearer axis rounds it, the higher kind names it
      if (PRIO[kd] > PRIO[kind[k]]) kind[k] = kd;
      if (uu < lat[k]) {
        lat[k] = uu;
        rad[k] = Math.min(255, Math.round(r));
      }
    }
  };
  const range = (x0: number, x1: number, lim: number) => [Math.max(0, Math.floor(x0 / cs)), Math.min(lim - 1, Math.floor(x1 / cs))];
  // a piece is painted from the nearest point of its axis (the highest of two segments would lift the floor round a
  // joint by the next segment's rounded end); between pieces the highest wins
  const pd = new Float32Array(n).fill(Infinity);
  const pz = new Float32Array(n);
  const pu = new Float32Array(n);
  const pr = new Float32Array(n);
  const touched: number[] = [];
  const paintPiece = (p: WoodPiece) => {
    for (let i = 1; i < p.nodes.length; i++) {
      const a = p.nodes[i - 1];
      const b = p.nodes[i];
      const ha = a.r * T.walkShare;
      const hb = b.r * T.walkShare;
      const m = Math.max(ha, hb) + cs;
      const [i0, i1] = range(Math.min(a.x, b.x) - m, Math.max(a.x, b.x) + m, W);
      const [j0, j1] = range(Math.min(a.y, b.y) - m, Math.max(a.y, b.y) + m, H);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const l2 = vx * vx + vy * vy;
      for (let j = j0; j <= j1; j++)
        for (let ii = i0; ii <= i1; ii++) {
          const cx = (ii + 0.5) * cs;
          const cy = (j + 0.5) * cs;
          let t = l2 > 0 ? ((cx - a.x) * vx + (cy - a.y) * vy) / l2 : 0;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const d = dhypot(cx - (a.x + vx * t), cy - (a.y + vy * t));
          const hw = ha + (hb - ha) * t;
          const k = j * W + ii;
          if (d > hw || d >= pd[k]) continue;
          if (pd[k] === Infinity) touched.push(k);
          pd[k] = d;
          pz[k] = a.z + (b.z - a.z) * t;
          pu[k] = d / hw;
          pr[k] = a.r + (b.r - a.r) * t;
        }
    }
    for (const k of touched) {
      write(k, pz[k], TK_WOOD, pu[k], pr[k]);
      pd[k] = Infinity;
    }
    touched.length = 0;
  };
  for (const sk of skels) {
    who = Math.min(254, sk.tree + 1);
    // the crotch: the trunk's flat top
    {
      const [i0, i1] = range(sk.x - sk.topR, sk.x + sk.topR, W);
      const [j0, j1] = range(sk.y - sk.topR, sk.y + sk.topR, H);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const d = dhypot((i + 0.5) * cs - sk.x, (j + 0.5) * cs - sk.y);
          if (d <= sk.topR) write(j * W + i, sk.topZ, TK_TOP, d / sk.topR, sk.topR / T.walkShare);
        }
    }
    for (const p of sk.pieces) if (p.walk) paintPiece(p);
    for (const l of sk.leaves) {
      const m = Math.max(l.rx, l.ry) + cs;
      const [i0, i1] = range(l.x - m, l.x + m, W);
      const [j0, j1] = range(l.y - m, l.y + m, H);
      const c = dcos(-l.rot);
      const s = dsin(-l.rot);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5) * cs - l.x;
          const dy = (j + 0.5) * cs - l.y;
          const lx = dx * c - dy * s;
          const ly = dx * s + dy * c;
          if ((lx * lx) / (l.rx * l.rx) + (ly * ly) / (l.ry * l.ry) <= 1) write(j * W + i, l.z, TK_LEAF, 0, 0);
        }
    }
  }
  // the boughs between crowns, from tips each crown's own trunk top reaches (the crowns cut and flooded on a copy) and
  // laid where no higher floor of the crowns is in their way
  const pre = hh.slice();
  const preComp = cutAndReach(pre, W, H, cs, skels);
  const links = makeLinks(
    (x, y, z) => {
      const i = Math.floor(x / cs);
      const j = Math.floor(y / cs);
      return i < 1 || j < 1 || i >= W - 1 || j >= H - 1 || hh[j * W + i] > z + 0.5;
    },
    (tree, x, y, z) => {
      const i = Math.floor(x / cs);
      const j = Math.floor(y / cs);
      // (reached, and the floor there is at that height — not higher wood painted over it)
      return i >= 0 && j >= 0 && i < W && j < H && preComp[j * W + i] !== 0 && Math.abs(pre[j * W + i] - z) <= 0.5 && preComp[j * W + i] === preComp[Math.floor(skels[tree].y / cs) * W + Math.floor(skels[tree].x / cs)];
    },
  );
  who = 255;
  for (const p of links) paintPiece(p);
  const comp = cutAndReach(hh, W, H, cs, skels);
  for (let k = 0; k < n; k++) if (!comp[k]) kind[k] = 0;
  return { h: hh, kind, lat, rad, comp, own, links };
}

/**
 * The drops block: a floor cell with a much higher one within two cells turns to rock (judged on the painted heights);
 * then what each trunk top reaches (the flow fields' moves: 8 ways, no corner cut past rock) — the rest is pruned.
 * Works on `hh` in place; returns the crown each floor cell is reached from (1 + the first trunk; 0 none).
 */
function cutAndReach(hh: Float32Array, W: number, H: number, cs: number, skels: readonly CrownSkel[]): Uint8Array {
  const n = W * H;
  const h0 = hh.slice();
  const lim: number[] = [];
  const off: number[] = [];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      off.push(dx, dy);
      lim.push(T.stepMax * dhypot(dx, dy));
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const z = h0[k];
      if (z < 0) continue;
      for (let o = 0; o < lim.length; o++) {
        const xx = x + off[o * 2];
        const yy = y + off[o * 2 + 1];
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const zz = h0[yy * W + xx];
        if (zz >= 0 && zz - z > lim[o]) {
          hh[k] = -1;
          break;
        }
      }
    }
  const comp = new Uint8Array(n);
  const stack: number[] = [];
  const floor = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && hh[y * W + x] >= 0;
  skels.forEach((sk, ti) => {
    const x0 = Math.floor(sk.x / cs);
    const y0 = Math.floor(sk.y / cs);
    if (!floor(x0, y0) || comp[y0 * W + x0]) return;
    const id = Math.min(255, ti + 1);
    comp[y0 * W + x0] = id;
    stack.push(y0 * W + x0);
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % W;
      const y = (k - x) / W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (!floor(xx, yy)) continue;
          if (dx && dy && (!floor(x + dx, y) || !floor(x, y + dy))) continue;
          const kk = yy * W + xx;
          if (comp[kk]) continue;
          comp[kk] = id;
          stack.push(kk);
        }
    }
  });
  for (let k = 0; k < n; k++) if (!comp[k]) hh[k] = -1;
  return comp;
}
