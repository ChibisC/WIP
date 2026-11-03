import { World } from './world';
import { Ant, AS, Colony, Food, Genome, POSE, SURFACE, Tile, colonyOfSpace, nestSpace } from './types';
import { BALANCE, TERMANT } from './balance';
import { CASTES, SPECIES, SpeciesId, casteOf } from './species';
import { datan2, dcos, dhypot, dsin } from './dmath';
import { steerTo, turnToward } from './movement';
import { completeDelete, placeTile, recomputeGroups, recomputeTileCaps, tileAnts, tileAt } from './tiles';
import { tilePoint } from './colony';
import { kingTick } from './termites';

/**
 * Termants, Chimaeromyrmex termitoides (fictional ant–termite hybrid; claude/termyrms package; numbers in TERMANT,
 * balance.ts). Ants and termites are only distantly related and cannot hybridize or share genes like this.
 *
 *  - Gene stealing. A piece of an enemy corpse (or a whole small corpse) delivered to the store credits gene samples
 *    for its species (by the dead ant's size class; creatures by kind). At a species' threshold its stolen caste is
 *    pushed into `colony.castes` — the same path the Mimic Ant's lobby-borrowed castes take — so its brood tiles,
 *    eggs, hatching, model, behaviour and sounds are that species' own. At most `maxStolen` at once; a fourth waits
 *    until the player forgets one (command `forgetCaste`: its brood tiles are refunded; living ants stay). Creature
 *    genes give a small passive bonus once (beetles armour, spiders speed).
 *  - Soldier glue burst (combat.ts → glueBurst): slows the target and makes formic acid hurt it double.
 *  - Eats everything (user 2026-11-02): workers gather dead wood, leaf litter and leaves as well as ordinary food, and
 *    all of it goes into the one food store (wood and leaves at `TERMANT.wood.toFood` / `leafToFood` food a unit).
 *  - A king beside the queen. Like a termite king he is never targeted, takes no damage, bites weakly and dies the
 *    moment his queen does (user note 2026-10-25). One queen and no replacement (user note, 2026-10-25): when she
 *    dies the colony is lost, as for every species.
 */

export const isTermant = (c: Colony | undefined): boolean => !!c && c.species === 'termant';

/**
 * A stolen caste: the source species' own caste. (User 2026-11-01: stolen castes get no nicknames; they are called by
 * their ant names, the source species' common name and the caste's own name — `stolenName`.)
 */
export interface StolenCaste {
  source: SpeciesId;
  caste: string;
  heavy: boolean;
  /** the caste word when the caste's own name reads badly after the species name ("Nasute Termite Nasute") */
  as?: string;
}

/** Data only: one entry per source species (entries whose caste is not in the game are skipped). */
export const STOLEN_CASTES: StolenCaste[] = [
  { source: 'hell', caste: 'hell_soldier', heavy: true },
  { source: 'nasutitermes', caste: 'nasute_soldier', heavy: false, as: 'Soldier' },
  { source: 'rhynchotermes', caste: 'rhy_soldier', heavy: false, as: 'Soldier' },
  { source: 'solenopsis', caste: 'fire_major', heavy: true },
  { source: 'aurimyrmex', caste: 'aurimyrmex_soldier', heavy: false },
  { source: 'formica', caste: 'formica_rapid', heavy: false },
  { source: 'lasius', caste: 'lasius_soldier', heavy: false },
  { source: 'atta', caste: 'atta_major', heavy: true },
  { source: 'eciton', caste: 'eciton_major', heavy: true },
].filter((e) => !!CASTES[e.caste] && !!SPECIES[e.source as SpeciesId]) as StolenCaste[];

/** A species' common name for one animal ("Nasute Termites" → "Nasute Termite", "Saiy-Ants" → "Saiy-Ant"). */
export function singularName(common: string): string {
  return common.replace(/([^s])s$/, '$1');
}

/**
 * A stolen caste's display name: the source species' common name and the caste's own name, e.g. "Black Garden Ant
 * Soldier", "Tropical Fire Ant Major", "Nasute Termite Soldier" (the full list is in docs/story/DESIGN-STORY.md).
 */
export function stolenName(e: StolenCaste | string): string {
  const s = typeof e === 'string' ? stolenOf(e) : e;
  if (!s) return CASTES[e as string]?.name ?? String(e);
  return `${singularName(SPECIES[s.source].common)} ${s.as ?? CASTES[s.caste].name}`;
}

/** Creature genes: a passive bonus once (by kind name), no caste. */
const CREATURE_BONUS: Array<{ match: RegExp; bonus: 'armor' | 'speed' }> = [
  // det-ok: constant table
  { match: /beetle|stag|pterostichus|carab|rove|ocypus/i, bonus: 'armor' },
  { match: /spider|tarantula|hogna|wolf/i, bonus: 'speed' },
];

export function stolenOf(caste: string): StolenCaste | undefined {
  return STOLEN_CASTES.find((e) => e.caste === caste);
}

export function threshold(e: StolenCaste | null): number {
  return e && e.heavy ? TERMANT.geneThreshold.heavy : TERMANT.geneThreshold.default;
}

export function genomeOf(c: Colony): Genome {
  if (!c.genome) c.genome = { samples: {}, stolen: [], bonuses: [], pending: '', corpsePriority: TERMANT.corpsePriority ? 1 : 0, hatched: [] };
  return c.genome;
}

/** morph → caste (the first caste with that model: the basic worker for a nanitic's shared model) */
const morphCaste = new Map<string, string>(); // det-ok: constant table built from CASTES
for (const cd of Object.values(CASTES)) if (!cd.nanitic && !morphCaste.has(cd.morph)) morphCaste.set(cd.morph, cd.id);

/** Where a corpse came from: the species id, or `cr:<kind>` for a creature; '' when unknown. */
export function corpseSource(from: string): string {
  if (from.startsWith('cr:')) return from;
  const caste = morphCaste.get(from);
  return caste ? CASTES[caste].species : '';
}

/** Gene samples a whole corpse is worth (by the dead ant's size class; creatures flat). */
export function corpseSamples(from: string): number {
  const G = TERMANT.geneSample;
  if (from.startsWith('cr:')) return G.creature;
  const caste = morphCaste.get(from);
  if (!caste) return 0;
  const cd = CASTES[caste];
  if (cd.role === 'major' || cd.length >= 10) return G.heavy;
  if (cd.role === 'soldier') return G.soldier;
  if (cd.role === 'minim' || cd.length < 4) return G.small;
  return G.ant;
}

/** A Termant forager bites a piece off a corpse: the piece carries its share of the corpse's genes. */
export function tagPiece(c: Colony, corpse: Food, piece: Food, amount: number): void {
  if (!isTermant(c) || corpse.kind !== 'corpse') return;
  const src = corpse.gsrc ?? corpse.from;
  piece.gsrc = src;
  piece.gene = (corpseSamples(src) * amount) / Math.max(1e-6, corpse.max);
}

/**
 * Food delivered to a Termant store (antAI.deposit): genes from an enemy corpse (or a piece of one), never from the
 * colony's own dead (those go to the midden, not here) nor from its own species. Wood, leaf litter and leaves are
 * food too, in the same store (user 2026-11-02). Returns the food amount to add.
 */
export function termantDeposit(w: World, c: Colony, item: Food | undefined, amount: number): number {
  if (!isTermant(c) || !item) return amount;
  if (item.kind === 'wood' || item.kind === 'leaf') {
    // (counted for the story's "gather wood" goal)
    if (item.kind === 'wood') c.stats.wood = (c.stats.wood ?? 0) + amount;
    return amount * (item.kind === 'wood' ? TERMANT.wood.toFood : TERMANT.wood.leafToFood);
  }
  const whole = item.kind === 'corpse';
  const src = whole ? item.from : item.gsrc;
  if (!src || (whole && w.teamOf(item.colony) === w.teamOf(c.id))) return amount;
  const source = corpseSource(src);
  if (!source || source === 'termant') return amount;
  const g = whole ? corpseSamples(src) : (item.gene ?? 0);
  if (g <= 0) return amount;
  const G = genomeOf(c);
  G.samples[source] = (G.samples[source] ?? 0) + g;
  w.events.emit({ t: 'gene', colony: c.id, source, amount: g });
  return amount;
}

/** Can this ant gather this wood (Termant workers; termites eat it anyway)? */
export function mayGatherWood(c: Colony, a: Ant): boolean {
  return isTermant(c) && !!casteOf(a.caste).wood;
}

// ---------------------------------------------------------------------------------------------------------------
// Unlocking, forgetting
// ---------------------------------------------------------------------------------------------------------------

function unlock(w: World, c: Colony, e: StolenCaste): void {
  const G = genomeOf(c);
  G.stolen.push(e.caste);
  if (!c.castes.includes(e.caste)) c.castes.push(e.caste);
  c.tileVersion++;
  w.events.emit({ t: 'caste', colony: c.id, caste: e.caste, source: e.source });
  w.events.emit({ t: 'message', text: `${SPECIES.termant.common}: the queen's new brood carries the weapons of its prey — the ${stolenName(e)} can be raised.`, kind: 'good', colony: c.id });
  // the colonies whose dead it came from hear of it
  for (const o of w.s.colonies) if (o.id !== c.id && o.species === e.source && o.alive) w.events.emit({ t: 'message', text: `A ${SPECIES.termant.common} colony now raises ${stolenName(e)}s from the genes of your dead.`, kind: 'warn', colony: o.id });
}

/** Forget a stolen caste (command): its brood tiles are refunded; living ants stay; a waiting caste takes its place. */
export function forgetCaste(w: World, c: Colony, caste: string): string | null {
  if (!isTermant(c)) return 'only Termants steal castes';
  const G = genomeOf(c);
  const i = G.stolen.indexOf(caste);
  if (i < 0) return 'not a stolen caste';
  G.stolen.splice(i, 1);
  const k = c.castes.indexOf(caste);
  if (k >= 0) c.castes.splice(k, 1);
  for (const t of c.tiles.slice()) if (t.type === 'brood' && t.caste === caste) refundTile(w, c, t);
  const e = stolenOf(caste);
  if (e) G.samples[e.source] = Math.min(G.samples[e.source] ?? 0, threshold(e) * TERMANT.forgetKeep);
  c.tileVersion++;
  w.events.emit({ t: 'caste', colony: c.id, caste, source: e?.source ?? '', forgotten: true });
  if (G.pending) {
    const p = stolenOf(G.pending);
    G.pending = '';
    if (p && !c.castes.includes(p.caste)) unlock(w, c, p);
  }
  return null;
}

/** A forgotten caste's brood tile goes at once, every level refunded; its ants live on, unbound (no tile). */
function refundTile(w: World, c: Colony, t: Tile): void {
  for (const a of tileAnts(w, t)) a.tile = -1;
  t.ant = 0;
  t.ant2 = 0;
  for (let k = 0; k < 4 && c.tiles.includes(t); k++) completeDelete(w, c, t);
}

/** Toggle: workers fetch corpses of species whose genes are still short first (command). */
export function setCorpsePriority(c: Colony, on: boolean): void {
  if (isTermant(c)) genomeOf(c).corpsePriority = on ? 1 : 0;
}

/** Is a corpse of this source still worth fetching first (its genes short of the threshold)? */
export function genesWanted(c: Colony, from: string): boolean {
  if (!isTermant(c) || !c.genome || !c.genome.corpsePriority) return false;
  const src = corpseSource(from);
  if (!src || src === 'termant') return false;
  if (src.startsWith('cr:')) return true;
  const e = STOLEN_CASTES.find((s) => s.source === src);
  return !!e && !c.castes.includes(e.caste) && (c.genome.samples[src] ?? 0) < threshold(e);
}

// ---------------------------------------------------------------------------------------------------------------
// The colony pass (every second): unlocks, creature bonuses, digestion
// ---------------------------------------------------------------------------------------------------------------

export function termantSystem(w: World, dt: number): void {
  if (w.s.tick % BALANCE.tickHz !== 0) return;
  for (const c of w.s.colonies) {
    if (!isTermant(c) || !c.alive) continue;
    const G = genomeOf(c);
    for (const e of STOLEN_CASTES) {
      if (c.castes.includes(e.caste) || G.pending === e.caste || (G.samples[e.source] ?? 0) < threshold(e)) continue;
      if (G.stolen.length < TERMANT.maxStolen) unlock(w, c, e);
      else if (!G.pending) {
        G.pending = e.caste;
        w.events.emit({ t: 'message', text: `${SPECIES.termant.common}: the ${stolenName(e)} is ready to be raised — forget a stolen caste to make room (three at most).`, kind: 'info', colony: c.id });
      }
    }
    for (const [src, n] of Object.entries(G.samples)) {
      if (!src.startsWith('cr:') || n < TERMANT.geneThreshold.default) continue;
      const b = CREATURE_BONUS.find((x) => x.match.test(src));
      if (b && !G.bonuses.includes(b.bonus)) {
        G.bonuses.push(b.bonus);
        w.events.emit({ t: 'caste', colony: c.id, caste: '', source: src });
        w.events.emit({ t: 'message', text: `${SPECIES.termant.common}: genes from the ${src.slice(3)} — ${b.bonus === 'armor' ? 'harder shells (5 % less damage)' : 'quicker legs (+5 % speed)'}.`, kind: 'good', colony: c.id });
      }
    }
    // an old save's separate wood store (before the one store, 2026-11-02) turns into food once
    const wood = c.wood ?? 0;
    if (wood > 0) {
      c.wood = 0;
      c.food = Math.min(c.foodCap, c.food + wood * TERMANT.wood.toFood);
    }
  }
  void dt;
}

/** Passive creature-gene bonuses (combat, movement). */
export function termantSpeedMul(c: Colony | undefined): number {
  return c && c.genome && c.genome.bonuses.includes('speed') ? 1.05 : 1;
}
export function termantArmorMul(c: Colony | undefined): number {
  return c && c.genome && c.genome.bonuses.includes('armor') ? 0.95 : 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Glue burst
// ---------------------------------------------------------------------------------------------------------------

/** The glued slow (antSpeed) and the formic-acid bonus on a glued target. */
export function glued(w: World, t: { glueT?: number }): boolean {
  return (t.glueT ?? 0) > w.s.tick;
}
export function acidMulOn(w: World, glueT: number | undefined): number {
  return (glueT ?? 0) > w.s.tick ? TERMANT.glue.acidMul : 1;
}

/**
 * A Termant soldier biting (combat.grappleUpdate): every `glue.cooldown` s a point-blank burst from the frontal pore:
 * `damage`, and the target slowed (to `slowMul`) for `slow` s; formic acid hurts it double meanwhile.
 * Returns the extra damage to deal (the caller deals it, so it goes through the usual damage path).
 */
export function glueBurst(w: World, a: Ant, target: { x: number; y: number; space: number; glueT?: number }): number {
  const g = casteOf(a.caste).glue;
  if (!g || a.cd2 > 0) return 0;
  a.cd2 = g.cooldown;
  target.glueT = w.s.tick + Math.round(g.slow * BALANCE.tickHz);
  w.events.emit({ t: 'glueBurst', x: target.x, y: target.y, space: target.space, target: 0 });
  return g.damage;
}

// ---------------------------------------------------------------------------------------------------------------
// Carton walls
// ---------------------------------------------------------------------------------------------------------------

/**
 * movement.moveForward, in a nest: is (x, y) inside a built carton wall of the Termant colony whose nest this is, for
 * an ant of another team that is not already inside that hex? Then it chews the wall (a bite per attack interval);
 * at 0 hit points the wall is gone. Own and allied ants pass (the wall has a doorway for them). The flow fields are
 * untouched: enemies keep pathing through and get stuck chewing.
 */
export function cartonBlocks(w: World, a: Ant, x: number, y: number): boolean {
  const owner = w.colony(colonyOfSpace(a.space));
  if (!owner || owner.species !== 'termant' || w.teamOf(owner.id) === (a.team ?? w.teamOf(a.colony))) return false;
  const g = w.nestOf(a.space);
  if (!g) return false;
  const q = g.hexAt(x, y);
  if (q < 0 || q === g.hexAt(a.x, a.y)) return false;
  const t = tileAt(owner, q);
  if (!t || t.type !== 'carton' || !t.built || (t.hp ?? 0) <= 0) return false;
  if (a.cd <= 0) {
    const cd = casteOf(a.caste);
    a.cd = cd.attackInterval;
    t.hp = (t.hp ?? 0) - cd.bite;
    w.events.emit({ t: 'bite', x, y, space: a.space, strength: 0.15, by: a.caste, on: 'wood' });
    if ((t.hp ?? 0) <= 0) {
      owner.tiles = owner.tiles.filter((o) => o !== t);
      recomputeGroups(w, owner);
      recomputeTileCaps(owner);
      owner.tileVersion++;
      w.events.emit({ t: 'tileBuilt', colony: owner.id, q: t.q, kind: 'remove' });
      w.events.emit({ t: 'message', text: 'Enemies have chewed through a carton wall!', kind: 'warn', colony: owner.id });
      return false;
    }
  }
  a.pose = POSE.DIG;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The king
// ---------------------------------------------------------------------------------------------------------------

/** Founding: the king beside the queen, a little behind her head. */
export function termantKingSpot(w: World, q: Ant, out: { x: number; y: number; h: number }): void {
  const QL = casteOf(q.caste).length;
  const KL = CASTES.termant_king.length;
  const c0 = dcos(q.h);
  const s0 = dsin(q.h);
  for (const side of [1, -1]) {
    const lat = QL * 0.16 + KL * 0.2 + 1;
    out.x = q.x - c0 * QL * 0.1 - s0 * lat * side;
    out.y = q.y - s0 * QL * 0.1 + c0 * lat * side;
    out.h = q.h;
    if (w.walkable(q.space, out.x, out.y)) return;
  }
}

const kp = { x: 0, y: 0, h: 0 }; // det-ok: scratch

/**
 * The king (user note 2026-11-02): no nest duties; like a termite king he walks round the queen inside her chamber and
 * bites intruders there, never leaving it (sim/termites.ts kingTick).
 */
export function termantKing(w: World, a: Ant, c: Colony, dt: number): boolean {
  return kingTick(w, a, c, dt);
}


// ---------------------------------------------------------------------------------------------------------------
// AI (colonyAI.buildTick, warAI.pickTarget)
// ---------------------------------------------------------------------------------------------------------------

/** A rival species whose genes this Termant colony nearly has: raid it sooner. */
export function genesNear(c: Colony, species: string): boolean {
  if (!isTermant(c) || !c.genome) return false;
  const e = STOLEN_CASTES.find((x) => x.source === species);
  if (!e || c.genome.stolen.includes(e.caste)) return false;
  const have = c.genome.samples[species] ?? 0;
  const need = threshold(e);
  return have >= need * (1 - TERMANT.ai.raidNear) && have < need;
}

/** How much a wood or leaf source is worth to the forage AI (more while the food store is low). */
export function woodWant(c: Colony): number {
  return c.food < c.foodCap * 0.5 ? TERMANT.ai.woodWant : TERMANT.ai.woodSated;
}

/**
 * The Termant AI's own decisions (every build think): forget the stolen caste with the fewest living ants when a
 * fourth is waiting; while intruders are inside, a carton wall beside each entrance (workers build it from wood).
 */
export function termantAI(w: World, c: Colony): void {
  if (!isTermant(c)) return;
  const G = genomeOf(c);
  if (G.pending && G.stolen.length) {
    let pick = G.stolen[0];
    let few = Infinity;
    for (const cs of G.stolen) {
      const n = c.counts[cs] ?? 0;
      if (n < few) {
        few = n;
        pick = cs;
      }
    }
    forgetCaste(w, c, pick);
  }
  if (!(c.intruders?.length ?? 0)) return;
  const g = w.nest(c.id);
  if (!g) return;
  if (c.tiles.some((t) => t.type === 'carton' && !t.built)) return;
  if (c.food < TERMANT.cartonWall.cost) return;
  const N = g.cols * g.rows;
  for (let k = 0; k < N; k++) {
    if (!g.isEntrance(k)) continue;
    let walls = 0;
    let spot = -1;
    for (const n of g.neighbors(k)) {
      if (n < 0 || g.isEntrance(n) || !g.isHexDug(n)) continue;
      const t = tileAt(c, n);
      if (t && t.type === 'carton') walls++;
      else if (!t && spot < 0) spot = n;
    }
    if (walls < TERMANT.ai.wallsPerEntrance && spot >= 0 && placeTile(w, c, 'carton', spot)) return;
  }
}

void SURFACE;
