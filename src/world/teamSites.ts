/**
 * Team-aware colony placement (CHANGE_PLAN §22, user spec claude/ai/01-spec-ai-allies-chambers.md §1): allies start as
 * neighbours (a short land route between their entrances), enemies apart, the teams fairly placed against each other.
 *
 * Pure arithmetic on the map file and the team shape — no seed, no random numbers — so every client, the lobby preview
 * and the validator get the same answer. Routes run on the map's hex layout (ground and walkways; water and walls block;
 * a future layer edge is one more blocked hex type).
 */
import { BALANCE } from '../sim/balance';
import { HEX_GROUND, HEX_WALKWAY, HF_FOOD, SurfaceLayout } from './surfaceLayout';

export interface SiteRoutes {
  /** sites on the map */
  n: number;
  /** land route between site entrances (mm), n × n; Infinity when there is none */
  d: Float64Array;
  /** land route from each site to the nearest food zone (mm) */
  food: Float64Array;
  /** land route from each site to the open ground nearest the map's middle (mm) */
  mid: Float64Array;
  /** the map's width (mm): the scale for the limits */
  width: number;
}

const routeCache = new WeakMap<SurfaceLayout, SiteRoutes>(); // det-ok: a pure cache of numbers derived from an immutable layout

/** Hex steps from `from` over open ground, to every hex (−1 where it cannot reach). */
function steps(L: SurfaceLayout, from: number): Int32Array {
  const n = L.type.length;
  const out = new Int32Array(n).fill(-1);
  if (from < 0) return out;
  const open = (q: number) => L.type[q] === HEX_GROUND || L.type[q] === HEX_WALKWAY;
  out[from] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    for (const nb of L.hex.neighbors(q)) {
      if (nb < 0 || out[nb] >= 0 || !open(nb)) continue;
      out[nb] = out[q] + 1;
      queue.push(nb);
    }
  }
  return out;
}

/** The open hex nearest (x, y) (ties by index). */
function openNear(L: SurfaceLayout, x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  for (let q = 0; q < L.type.length; q++) {
    if (L.type[q] !== HEX_GROUND && L.type[q] !== HEX_WALKWAY) continue;
    const dx = L.hex.centerX(q) - x;
    const dy = L.hex.centerY(q) - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** Land routes between the sites, and from each to food and to the middle (cached per layout). */
export function siteRoutes(L: SurfaceLayout): SiteRoutes {
  const hit = routeCache.get(L);
  if (hit) return hit;
  const n = L.sites.length;
  const step = L.hex.H; // centre to centre of neighbouring hexes
  const d = new Float64Array(n * n).fill(Infinity);
  const food = new Float64Array(n).fill(Infinity);
  const mid = new Float64Array(n).fill(Infinity);
  const foodHexes: number[] = [];
  for (let q = 0; q < L.flags.length; q++) if (L.flags[q] & HF_FOOD) foodHexes.push(q);
  const midQ = openNear(L, L.def.width / 2, L.def.depth / 2);
  const start = (i: number) => L.sites[i].entrances[0] ?? L.sites[i].centre;
  for (let i = 0; i < n; i++) {
    const s = steps(L, start(i));
    for (let j = 0; j < n; j++) {
      const k = s[start(j)];
      if (k >= 0) d[i * n + j] = k * step;
    }
    for (const q of foodHexes) if (s[q] >= 0) food[i] = Math.min(food[i], s[q] * step);
    if (midQ >= 0 && s[midQ] >= 0) mid[i] = s[midQ] * step;
  }
  const r: SiteRoutes = { n, d, food, mid, width: L.def.width };
  routeCache.set(L, r);
  return r;
}

/** The colonies grouped by team: groups of 2+ first (biggest first), then singles; each in colony order. */
export function teamGroups(teams: Array<number | undefined>): number[][] {
  const byTeam = new Map<number, number[]>();
  const singles: number[][] = [];
  teams.forEach((t, i) => {
    if (t === undefined) {
      singles.push([i]);
      return;
    }
    const g = byTeam.get(t);
    if (g) g.push(i);
    else byTeam.set(t, [i]);
  });
  const groups = [...byTeam.values(), ...singles];
  return groups.sort((p, q) => q.length - p.length || p[0] - q[0]);
}

/** The team shape's key: group sizes, biggest first, joined by "v" ("2v2", "2v1v1", "3v1"). */
export function shapeKey(groups: number[][]): string {
  return groups.map((g) => g.length).join('v');
}

export interface TeamPlacement {
  /** the site of each colony, in colony order */
  sites: number[];
  /** per colony: the route to its nearest teammate (mm; NaN without one) and to its nearest enemy (mm) */
  ally: number[];
  enemy: number[];
  /** per group (in `teamGroups` order): mean route to food, to the middle and to the nearest enemy (mm) */
  groupFood: number[];
  groupMid: number[];
  groupEnemy: number[];
  /** limit breaks: an ally too far, an enemy too near, an enemy between two allies */
  violations: string[];
  /** where it came from */
  source: 'authored' | 'search';
  score: number;
}

/** Score one assignment (lower is better) and fill a report. */
function evaluate(R: SiteRoutes, groups: number[][], siteOf: number[], report: boolean): { score: number; rep?: TeamPlacement } {
  const S = BALANCE.aiAllies.sites;
  const W = R.width;
  const allyMax = S.allyMaxRoute * W;
  const enemyMin = S.enemyMinRoute * W;
  const n = siteOf.length;
  const teamOf = new Array<number>(n);
  groups.forEach((g, gi) => g.forEach((i) => (teamOf[i] = gi)));
  const dd = (i: number, j: number) => R.d[siteOf[i] * R.n + siteOf[j]];
  let viol = 0;
  const why: string[] = [];
  let sumAlly = 0;
  let minEnemy = Infinity;
  const ally = new Array<number>(n).fill(NaN);
  const enemy = new Array<number>(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    let a = Infinity;
    let e = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const x = dd(i, j);
      if (teamOf[j] === teamOf[i]) a = Math.min(a, x);
      else e = Math.min(e, x);
    }
    if (a < Infinity) {
      ally[i] = a;
      sumAlly += a;
      if (a > allyMax) {
        viol += 1 + (a - allyMax) / allyMax;
        if (report) why.push(`colony ${i}: ally ${Math.round(a)} mm away (limit ${Math.round(allyMax)})`);
      }
    }
    enemy[i] = e;
    if (e < Infinity) {
      minEnemy = Math.min(minEnemy, e);
      if (e < enemyMin) {
        viol += 1 + (enemyMin - e) / enemyMin;
        if (report) why.push(`colony ${i}: enemy ${Math.round(e)} mm away (at least ${Math.round(enemyMin)})`);
      }
    }
  }
  // an enemy between two allies: nearer each of them than they are to each other
  for (const g of groups)
    for (let a = 0; a < g.length; a++)
      for (let b = a + 1; b < g.length; b++) {
        const ab = dd(g[a], g[b]);
        for (let k = 0; k < n; k++) {
          if (teamOf[k] === teamOf[g[a]]) continue;
          if (dd(g[a], k) < ab && dd(g[b], k) < ab) {
            viol += 1;
            if (report) why.push(`colony ${k} sits between allies ${g[a]} and ${g[b]}`);
          }
        }
      }
  // fairness between teams: the spread of each team's mean route to food, the middle and its nearest enemy
  const gf: number[] = [];
  const gm: number[] = [];
  const ge: number[] = [];
  for (const g of groups) {
    let f = 0;
    let m = 0;
    let e = 0;
    for (const i of g) {
      f += R.food[siteOf[i]];
      m += R.mid[siteOf[i]];
      e += enemy[i];
    }
    gf.push(f / g.length);
    gm.push(m / g.length);
    ge.push(e / g.length);
  }
  const spread = (v: number[]) => (v.length < 2 ? 0 : (Math.max(...v) - Math.min(...v)) / W);
  let unfair = spread(gf) + spread(gm) + spread(ge) * 0.5;
  // an uneven match: the smaller side gets the better food (nearer than the biggest side's)
  const big = groups[0].length;
  groups.forEach((g, gi) => {
    if (g.length < big && gf[gi] > gf[0]) unfair += ((gf[gi] - gf[0]) / W) * S.smallSideFood;
  });
  const score = viol * 1e6 + (sumAlly / W) * S.wAlly + unfair * S.wFair - (minEnemy < Infinity ? minEnemy / W : 0) * S.wEnemy;
  if (!report) return { score };
  return { score, rep: { sites: siteOf.slice(), ally, enemy, groupFood: gf, groupMid: gm, groupEnemy: ge, violations: why, source: 'search', score } };
}

const placeCache = new Map<string, TeamPlacement | null>(); // det-ok: a pure cache keyed by map and team shape

/**
 * Sites for a match with teams (`teams[i]`: colony i's team, undefined = a team of its own): the map's authored set
 * for this team shape when it has one, else the best of every assignment of sites to teams. Null when no team has two
 * or more colonies (the balanced sets then apply as before) or the map has too few sites.
 */
export function pickTeamSites(L: SurfaceLayout, teams: Array<number | undefined>): TeamPlacement | null {
  const groups = teamGroups(teams);
  if (!groups.length || groups[0].length < 2 || teams.length > L.sites.length) return null;
  const key = `${L.def.id}|${groups.map((g) => g.join(',')).join('/')}`;
  if (placeCache.has(key)) return placeCache.get(key)!;
  const R = siteRoutes(L);
  const n = teams.length;
  const shape = shapeKey(groups);
  let best: TeamPlacement | null = null;
  // authored: the map's hand-picked sites for this shape, group by group (members take them in colony order)
  const authored = L.def.teamSets?.[shape];
  if (authored && authored.length === groups.length && authored.every((s, gi) => s.length === groups[gi].length) && new Set(authored.flat()).size === n && authored.flat().every((s) => s >= 0 && s < R.n)) {
    const siteOf = new Array<number>(n);
    groups.forEach((g, gi) => g.forEach((i, k) => (siteOf[i] = authored[gi][k])));
    const r = evaluate(R, groups, siteOf, true).rep!;
    best = { ...r, source: 'authored' };
  } else {
    // search: every n-subset of the sites (lexicographic), every split of it into the groups; first best kept
    const siteOf = new Array<number>(n);
    let bestScore = Infinity;
    let bestSites: number[] | null = null;
    const chosen: number[] = [];
    const assign = (pool: number[], gi: number) => {
      if (gi === groups.length) {
        const s = evaluate(R, groups, siteOf, false).score;
        if (s < bestScore) {
          bestScore = s;
          bestSites = siteOf.slice();
        }
        return;
      }
      const g = groups[gi];
      // choose g.length sites from the pool (ascending), members take them in colony order
      const pick: number[] = [];
      const rec = (from: number) => {
        if (pick.length === g.length) {
          g.forEach((i, k) => (siteOf[i] = pick[k]));
          assign(
            pool.filter((s) => !pick.includes(s)),
            gi + 1,
          );
          return;
        }
        for (let k = from; k <= pool.length - (g.length - pick.length); k++) {
          pick.push(pool[k]);
          rec(k + 1);
          pick.pop();
        }
      };
      rec(0);
    };
    const subsets = (from: number) => {
      if (chosen.length === n) {
        assign(chosen.slice(), 0);
        return;
      }
      for (let s = from; s <= R.n - (n - chosen.length); s++) {
        chosen.push(s);
        subsets(s + 1);
        chosen.pop();
      }
    };
    subsets(0);
    if (bestSites) best = evaluate(R, groups, bestSites, true).rep!;
  }
  placeCache.set(key, best);
  return best;
}
