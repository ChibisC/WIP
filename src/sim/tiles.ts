import { World } from './world';
import { Ant, AS, Colony, NestGroup, Tile, TileType, nestSpace } from './types';
import { CASTES, SPECIES, casteOf, naniticCaste, tierOf } from './species';
import { tunnelSpeed } from './entrances';
import { BALANCE, NASUTE, TERMANT } from './balance';
import { makeFood } from './factory';
import { dcos, dsin } from './dmath';

/**
 * Hex tile system (Revision 2, EotU rules — see DESIGN.md 3.7). Tiles sit on
 * dug hexes. A placed tile is first *planned*; a worker builds it (and later
 * upgrades or deletes it) as a nest job. Brood tiles raise and keep ants of
 * their caste; adjacent same-type tiles form a chamber = one control group.
 * Upgrades need points from neighbours. Built tiles slow ants; highways
 * speed them up.
 */

export interface TileInfo {
  name: string;
  desc: string;
}

export const TILE_INFO: Record<TileType, TileInfo> = {
  queen: { name: "Queen's Chamber", desc: "One of the seven tiles around the queen: raises one nanitic worker (her small first brood) and stores 10 food. Cannot be built, upgraded or deleted." },
  brood: { name: 'Brood Tile', desc: 'Workers carry an egg here; the larva grows while the colony has food and becomes an ant of this caste, which lives on this tile. A new larva waits half-grown to replace it.' },
  food: { name: 'Food Storage', desc: 'Holds 10 / 40 / 100 food at levels 1 / 2 / 3.' },
  highway: { name: 'Highway', desc: 'Packed, well-trodden earth: ants move 10 / 20 / 25 % faster on it (other tiles slow them by 35 %). Gives upgrade points to every tile beside it.' },
  fungus: { name: 'Fungus Garden', desc: 'Leafcutters grow Leucoagaricus fungus on cut leaves here; it turns leaves into food.' },
  aphid: { name: 'Root-aphid Pasture', desc: 'Black garden ants keep root aphids in the nest; they trickle honeydew.' },
  thatch: { name: 'Thatch Store', desc: 'Red wood ants pack plant material that warms the nest: brood grows faster.' },
  mound: { name: 'Sun-warmed Brood Mound', desc: 'Fire ants heap worked soil over the nest. The sun warms it and workers carry the brood up into it by day: brood grows faster (a quarter as much at night).' },
  carton: { name: 'Carton Wall', desc: 'Termant workers chew dead wood into a papery wall across the tunnel: enemies must chew through it, your own ants pass its doorway. Paid in wood; gives upgrade points to the tiles beside it like a soil wall.' },
};

export const MAX_TILE_LEVEL = BALANCE.maxLevel;
export const QUEEN_TILES = 7;

/** Tiles that raise ants: brood tiles and queen tiles (nanitics). Planned tiles raise nothing yet. */
export function raisesAnts(t: { type: TileType; caste?: string; built?: boolean }): boolean {
  return (t.type === 'brood' || t.type === 'queen') && !!t.caste && t.built !== false;
}

/** Food to build a tile (also the cost of each upgrade). */
export function tileCost(c: Colony, type: TileType, caste?: string): number {
  switch (type) {
    case 'brood':
      // (Termants: a caste stolen from another species costs TERMANT.stolenCostMul × its own species' tile)
      return caste ? casteCosts(caste).build * (c.species === 'termant' && CASTES[caste]?.species !== 'termant' && !CASTES[caste]?.nanitic ? TERMANT.stolenCostMul : 1) : BALANCE.tiers.worker.build;
    case 'food':
      return BALANCE.storageBuild;
    case 'highway':
      return BALANCE.highwayBuild;
    case 'fungus':
      return BALANCE.fungus.build;
    case 'aphid':
      return BALANCE.aphid.build;
    case 'thatch':
      return BALANCE.thatch.build;
    case 'mound':
      return BALANCE.mound.build;
    case 'carton':
      return TERMANT.cartonWall.cost; // (wood, not food)
    default:
      return 0;
  }
}

export function upgradeCost(c: Colony, t: Tile): number {
  return tileCost(c, t.type, t.caste);
}

/** Build / hatch / grow of a caste: its own entry in balance.ts, else its tier's. */
export function casteCosts(caste: string): { build: number; hatch: number; grow: number } {
  const own = BALANCE.castes[caste];
  return own ?? BALANCE.tiers[tierOf(caste)];
}

export function hatchCost(caste: string): number {
  return casteCosts(caste).hatch;
}

export function growTime(caste: string): number {
  return casteCosts(caste).grow;
}

/** How many ants a tile holds at its level. */
export function tileCapacity(t: Tile): number {
  if (!raisesAnts(t)) return 0;
  if (t.type === 'queen') return 1;
  const cap = BALANCE.capacity[t.caste!] ?? BALANCE.capacity.default;
  return cap[Math.min(cap.length, t.level) - 1];
}

/** Living ants bound to a tile. */
export function tileAnts(w: World, t: Tile): Ant[] {
  const out: Ant[] = [];
  for (const id of [t.ant, t.ant2]) {
    if (!id) continue;
    const a = w.antById.get(id);
    if (a && a.state !== AS.Dead) out.push(a);
  }
  return out;
}

/** Tile types a colony can build (brood tiles listed per caste). */
export function buildableTiles(c: Colony): Array<{ type: TileType; caste?: string }> {
  const out: Array<{ type: TileType; caste?: string }> = [];
  for (const cs of c.castes) if (CASTES[cs].role !== 'queen' && !CASTES[cs].nanitic) out.push({ type: 'brood', caste: cs });
  out.push({ type: 'food' }, { type: 'highway' });
  const sp = c.species;
  if (sp === 'atta' || c.castes.includes('atta_media')) out.push({ type: 'fungus' });
  if (sp === 'lasius') out.push({ type: 'aphid' });
  if (sp === 'formica') out.push({ type: 'thatch' });
  if (sp === 'solenopsis') out.push({ type: 'mound' });
  if (sp === 'termant') out.push({ type: 'carton' });
  return out;
}

export function tileAt(c: Colony, q: number): Tile | undefined {
  return c.tiles.find((t) => t.q === q);
}

export function groupById(c: Colony, id: number): NestGroup | undefined {
  return c.groups.find((g) => g.id === id);
}

export function groupTiles(c: Colony, id: number): Tile[] {
  return c.tiles.filter((t) => t.group === id && t.built);
}

/** Brood capacity a tile uses toward the colony's cap (planned tiles count, so the cap can't be exceeded). */
export function tilePop(t: Tile): number {
  if (t.type !== 'brood' && t.type !== 'queen') return 0;
  return t.built ? tileCapacity(t) : 1;
}

export function popUsed(c: Colony): number {
  let p = 0;
  for (const t of c.tiles) p += tilePop(t);
  return p;
}

/** Living / maximum ants of a group, and its average tile level. */
export function groupCounts(w: World, c: Colony, id: number): { living: number; max: number; level: number } {
  let living = 0;
  let max = 0;
  let lv = 0;
  let n = 0;
  for (const t of c.tiles) {
    if (t.group !== id || !raisesAnts(t)) continue;
    max += tileCapacity(t);
    living += tileAnts(w, t).length;
    lv += t.level;
    n++;
  }
  return { living, max, level: n ? Math.round(lv / n) : 1 };
}

/** Why a tile cannot be placed here (null when it can). The food is paid later, when a worker builds it. */
export function canPlaceTile(w: World, c: Colony, type: TileType, q: number, caste?: string): string | null {
  const g = w.nest(c.id);
  if (!g || q < 0) return 'Outside the nest';
  if (!g.isHexDug(q)) return 'Dig this ground out first';
  if (g.isEntrance(q)) return 'Entrance ramps must stay clear';
  if (tileAt(c, q)) return 'There is already a tile here';
  if (type === 'queen') return "The queen's chamber cannot be built: every colony starts with its own seven tiles";
  if (type === 'brood') {
    if (!caste || !c.castes.includes(caste) || CASTES[caste]?.nanitic) return 'This colony cannot raise that caste';
    if (popUsed(c) + 1 > c.popLimit + 1e-6) return `Brood limit reached (${c.popLimit})`;
  }
  if (!buildableTiles(c).some((b) => b.type === type && (type !== 'brood' || b.caste === caste))) return `${SPECIES[c.species].common}s cannot build this`;
  return null;
}

/** The group a tile placed at q would join (largest adjacent same-kind group), or null for a new group. */
export function groupWouldJoin(w: World, c: Colony, type: TileType, q: number, caste?: string): NestGroup | null {
  const g = w.nest(c.id);
  if (!g) return null;
  let best: NestGroup | null = null;
  let bestN = -1;
  for (const n of g.neighbors(q)) {
    if (n < 0) continue;
    const t = tileAt(c, n);
    if (!t || !t.built || t.type !== type || t.caste !== caste) continue;
    const grp = groupById(c, t.group);
    if (!grp) continue;
    const size = c.tiles.filter((x) => x.group === grp.id).length;
    if (size > bestN) {
      bestN = size;
      best = grp;
    }
  }
  return best;
}

/**
 * Place a tile. Normally it is *planned*: a ghost on the floor and a build
 * job; the food is paid when a worker completes it. `instant` builds it at
 * once for free (level setup, tests).
 */
export function placeTile(w: World, c: Colony, type: TileType, q: number, caste?: string, instant = false): Tile | null {
  if (!instant && canPlaceTile(w, c, type, q, caste)) return null;
  const t: Tile = {
    q,
    type,
    caste: type === 'brood' ? caste : type === 'queen' ? naniticCaste(c.species) : undefined,
    level: 1,
    group: 0,
    ant: 0,
    ant2: 0,
    brood: 0,
    wait: 0,
    built: instant,
    pend: 0,
    progress: 0,
  };
  if (instant && type === 'carton') t.hp = TERMANT.cartonWall.hp;
  c.tiles.push(t);
  recomputeGroups(w, c);
  recomputeTileCaps(c);
  return t;
}

/** Finish building a planned tile; pays its food. Returns false (and waits) when the colony can't afford it. */
export function completeBuild(w: World, c: Colony, t: Tile): boolean {
  const cost = tileCost(c, t.type, t.caste);
  if (t.type === 'carton') {
    // a carton wall is paid in wood (Termants' wood store)
    if (!c.infiniteFood && (c.wood ?? 0) < cost) return false;
    if (!c.infiniteFood) c.wood = (c.wood ?? 0) - cost;
    t.hp = TERMANT.cartonWall.hp;
  } else {
    if (!c.infiniteFood && c.food < cost) return false;
    if (!c.infiniteFood) c.food -= cost;
  }
  t.built = true;
  t.progress = 0;
  recomputeGroups(w, c);
  recomputeTileCaps(c);
  w.events.emit({ t: 'tileBuilt', colony: c.id, q: t.q, kind: 'build' });
  return true;
}

// ---------------------------------------------------------------------------
// Upgrade points
// ---------------------------------------------------------------------------

/**
 * Points each neighbour of a tile gives toward its next upgrade (for the
 * hover display): same-type tiles their level, soil/wall hexes 1, highways
 * their level to any tile; a highway gets the level of every adjacent built tile.
 */
export function neighbourPoints(w: World, c: Colony, t: Tile): Array<{ q: number; pts: number }> {
  const g = w.nest(c.id)!;
  const out: Array<{ q: number; pts: number }> = [];
  for (const n of g.neighbors(t.q)) {
    if (n < 0) {
      out.push({ q: n, pts: BALANCE.wallPoints }); // the nest's outer boundary is solid soil
      continue;
    }
    if (!g.isHexDug(n)) {
      out.push({ q: n, pts: BALANCE.wallPoints });
      continue;
    }
    const o = tileAt(c, n);
    if (!o || !o.built) {
      out.push({ q: n, pts: 0 });
      continue;
    }
    if (o.type === 'carton') {
      out.push({ q: n, pts: TERMANT.cartonWall.points }); // a carton wall counts as a wall
      continue;
    }
    const same = o.type === t.type && o.caste === t.caste;
    let pts = 0;
    if (same) pts = o.level;
    else if (o.type === 'highway') pts = o.level;
    else if (t.type === 'highway') pts = o.level;
    out.push({ q: n, pts });
  }
  return out;
}

export function upgradePoints(w: World, c: Colony, t: Tile): number {
  return neighbourPoints(w, c, t).reduce((s, n) => s + n.pts, 0);
}

/** Points needed to reach the next level (Infinity at max level). */
export function upgradeNeed(t: Tile): number {
  return t.level >= MAX_TILE_LEVEL ? Infinity : BALANCE.upgradeNeed[t.level];
}

/** Why a tile can't be upgraded now (null when it can). */
export function canUpgrade(w: World, c: Colony, t: Tile): string | null {
  if (t.type === 'queen') return "The queen's chamber cannot be upgraded";
  if (t.type === 'carton') return 'Carton walls are not upgraded';
  if (!t.built) return 'Build this tile first';
  if (t.level >= MAX_TILE_LEVEL) return 'Already at the highest level';
  if (upgradePoints(w, c, t) < upgradeNeed(t)) return 'The workers have done all they can to prepare this brood chamber.';
  return null;
}

/** Mark an upgrade job (a worker completes it and pays the build cost). */
export function markUpgrade(w: World, c: Colony, q: number): string | null {
  const t = tileAt(c, q);
  if (!t) return 'No tile here';
  if (t.pend === 1) {
    t.pend = 0;
    t.progress = 0;
    return null; // clicking again cancels
  }
  const why = canUpgrade(w, c, t);
  if (why) return why;
  t.pend = 1;
  t.progress = 0;
  return null;
}

/** Mark a delete job: a worker downgrades the tile one level, or removes it at level 1. Planned tiles vanish at once. */
export function markDelete(w: World, c: Colony, q: number): string | null {
  const t = tileAt(c, q);
  if (!t) return 'No tile here';
  if (t.type === 'queen') return "The queen's chamber cannot be removed";
  if (!t.built) {
    c.tiles = c.tiles.filter((x) => x !== t);
    recomputeGroups(w, c);
    recomputeTileCaps(c);
    return null;
  }
  if (t.pend === 2) {
    t.pend = 0;
    t.progress = 0;
    return null;
  }
  t.pend = 2;
  t.progress = 0;
  return null;
}

/** Back-compat helper: mark the tile for deletion (true if a job was set or a planned tile removed). */
export function removeTile(w: World, c: Colony, q: number): boolean {
  return markDelete(w, c, q) === null;
}

/** Back-compat helper used by the UI: mark an upgrade job. */
export function upgradeTile(w: World, c: Colony, q: number): string | null {
  return markUpgrade(w, c, q);
}

/** Finish an upgrade job. Returns a reason when it can't complete (points or food). */
export function completeUpgrade(w: World, c: Colony, t: Tile): string | null {
  const why = canUpgrade(w, c, t);
  if (why) {
    t.pend = 0;
    t.progress = 0;
    return why;
  }
  const cost = upgradeCost(c, t);
  if (!c.infiniteFood && c.food < cost) return `Needs ${cost} food`;
  if (!c.infiniteFood) c.food -= cost;
  t.level++;
  t.pend = 0;
  t.progress = 0;
  for (const a of tileAnts(w, t)) applyLevel(a, t.level);
  c.tileVersion++;
  c.hexSpeed = null;
  recomputeTileCaps(c);
  w.events.emit({ t: 'tileBuilt', colony: c.id, q: t.q, kind: 'upgrade' });
  return null;
}

/**
 * Finish a delete job: above level 1 the tile drops a level (its ant is
 * healed); at level 1 it is removed — its ants die, a growing larva is
 * dropped as food. Either way two-thirds of the build cost lies on the floor
 * as seeds for the workers to carry back to storage.
 */
export function completeDelete(w: World, c: Colony, t: Tile): void {
  const g = w.nest(c.id)!;
  const ctr = g.hexCenter(t.q);
  if (t.type === 'carton') c.wood = Math.min(TERMANT.wood.cap, (c.wood ?? 0) + tileCost(c, t.type) * BALANCE.refund);
  else dropSeeds(w, c, ctr.x, ctr.y, tileCost(c, t.type, t.caste) * BALANCE.refund);
  t.pend = 0;
  t.progress = 0;
  if (t.level > 1) {
    t.level--;
    for (const a of tileAnts(w, t)) applyLevel(a, t.level);
    c.tileVersion++;
    c.hexSpeed = null;
    recomputeTileCaps(c);
    w.events.emit({ t: 'tileBuilt', colony: c.id, q: t.q, kind: 'downgrade' });
    return;
  }
  for (const a of tileAnts(w, t)) {
    a.tile = -1;
    a.hp = 0;
    a.state = AS.Dead;
    a.deadT = 0;
    c.stats.died++;
  }
  if (t.brood) {
    const b = w.broodById.get(t.brood);
    if (b) {
      const f = makeFood(w, 'crumb', nestSpace(c.id), b.x, b.y, 0.9, 'brood');
      f.amount = f.max = Math.max(1, b.fed);
      if (b.carrier) {
        const carrier = w.antById.get(b.carrier);
        if (carrier) {
          carrier.carry = 0;
          carrier.carryId = 0;
        }
      }
      w.removeBroodNow(b.id);
    }
  }
  c.tiles = c.tiles.filter((x) => x !== t);
  recomputeGroups(w, c);
  recomputeTileCaps(c);
  w.events.emit({ t: 'tileBuilt', colony: c.id, q: t.q, kind: 'remove' });
}

/** Scatter seeds (food; wood chips for termites) on the nest floor; workers carry them to storage. */
export function dropSeeds(w: World, c: Colony, x: number, y: number, amount: number): void {
  if (amount <= 0.5) return;
  const n = Math.max(1, Math.round(amount / 3));
  const g = w.nest(c.id)!;
  const wood = SPECIES[c.species].kind === 'termite';
  for (let i = 0; i < n; i++) {
    const a = w.rng.range(0, Math.PI * 2);
    const r = w.rng.range(0, g.R * 0.5);
    const f = makeFood(w, wood ? 'wood' : 'seed', nestSpace(c.id), x + dcos(a) * r, y + dsin(a) * r, 0.9, wood ? 'chip' : '');
    f.amount = f.max = amount / n;
  }
}

/** Ant stats for a tile level: health, damage, speed and job speed; fully healed. */
export function applyLevel(a: Ant, level: number): void {
  const L = Math.max(1, Math.min(3, level));
  // termite females are 10 % tougher (NASUTE.worker.femaleHpBonus)
  const base = casteOf(a.caste).hp * (a.variant === 1 ? 1 + NASUTE.worker.femaleHpBonus : 1);
  a.level = L;
  a.power = BALANCE.levelDamage[L - 1];
  a.maxHp = base * BALANCE.levelHp[L - 1];
  a.hp = a.maxHp;
}

/** Back-compat: damage multiplier of a level. */
export function levelPower(level: number): number {
  return BALANCE.levelDamage[Math.max(0, Math.min(2, level - 1))];
}

// ---------------------------------------------------------------------------
// Groups, capacities and movement
// ---------------------------------------------------------------------------

/**
 * Recompute nest groups as connected components of same-type (same-caste)
 * built tiles. Ids stay stable: each component keeps the id of the old group
 * it overlaps most (largest component wins ties); other components get new
 * ids and inherit the old group's marker assignment, so splitting keeps
 * orders. Brand-new groups start in the home column.
 */
export function recomputeGroups(w: World, c: Colony): void {
  c.tileVersion++;
  const g = w.nest(c.id);
  if (!g) return;
  const byQ = new Map<number, Tile>();
  for (const t of c.tiles) if (t.built) byQ.set(t.q, t);
  const seen = new Set<number>();
  const comps: Tile[][] = [];
  for (const t of c.tiles) {
    if (!t.built) {
      t.group = 0;
      continue;
    }
    if (seen.has(t.q)) continue;
    const comp: Tile[] = [];
    const stack = [t];
    seen.add(t.q);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const n of g.neighbors(x.q)) {
        if (n < 0 || seen.has(n)) continue;
        const y = byQ.get(n);
        if (!y || y.type !== t.type || y.caste !== t.caste) continue;
        seen.add(n);
        stack.push(y);
      }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  const oldGroups = new Map(c.groups.map((gr) => [gr.id, gr]));
  const claimed = new Set<number>();
  const next: NestGroup[] = [];
  for (const comp of comps) {
    const votes = new Map<number, number>();
    for (const t of comp) if (t.group && oldGroups.has(t.group)) votes.set(t.group, (votes.get(t.group) ?? 0) + 1);
    let id = 0;
    let best = 0;
    let inherit: NestGroup | undefined;
    for (const [gid, n] of votes) {
      if (n > best) {
        best = n;
        inherit = oldGroups.get(gid);
        if (!claimed.has(gid)) id = gid;
      }
    }
    if (!id) id = c.nextGroupId++;
    claimed.add(id);
    const t0 = comp[0];
    next.push({ id, type: t0.type, caste: t0.caste, marker: inherit ? inherit.marker : -1 });
    for (const t of comp) t.group = id;
  }
  next.sort((a, b) => a.id - b.id);
  c.groups = next;
  c.hexSpeed = null; // rebuilt lazily
}

/** Food and fungus capacity from tiles and their levels. */
export function recomputeTileCaps(c: Colony): void {
  let food = 0;
  let fungus = 0;
  for (const t of c.tiles) {
    if (!t.built) continue;
    if (t.type === 'queen') food += BALANCE.queenTileFood;
    else if (t.type === 'food') food += BALANCE.storage[t.level - 1];
    else if (t.type === 'fungus') fungus += BALANCE.fungus.cap[t.level - 1];
  }
  c.foodCap = food;
  c.fungusCap = fungus;
  c.food = Math.min(c.food, c.foodCap);
}

/** Movement factor of each nest hex: built tiles slow ants, highways speed them up. */
export function hexSpeedOf(w: World, c: Colony): Float32Array {
  if (c.hexSpeed) return c.hexSpeed;
  const g = w.nest(c.id)!;
  const sp = new Float32Array(g.cols * g.rows).fill(1);
  for (const t of c.tiles) {
    if (!t.built) continue;
    sp[t.q] = t.type === 'highway' ? BALANCE.highwaySpeed[t.level - 1] : BALANCE.tileSpeed;
  }
  tunnelSpeed(g, sp);
  c.hexSpeed = sp;
  return sp;
}
