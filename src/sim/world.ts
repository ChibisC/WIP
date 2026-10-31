import { migrateColonyEntrances, normalizeEntrance } from './entrances';
import { Rng } from '../core/rng';
import { EventBus } from '../core/events';
import { Terrain } from '../world/terrain';
import { NestGrid } from '../world/nestGrid';
import { NestFlow, SurfaceFlow } from './flow';
import { Pheromones } from './pheromones';
import { SpatialHash } from './spatial';
import { Ant, AphidCluster, Brood, CaveDef, Colony, Creature, Entrance, Food, LeafPlant, SimState, SURFACE, colonyOfSpace, nestSpace, isCaveSpace, Projectile } from './types';

/**
 * The live simulation: serializable SimState plus runtime acceleration
 * structures (terrain, nest grids, flow fields, pheromones, spatial hashes,
 * id lookups). Systems are plain functions that operate on a World.
 */
export class World {
  s: SimState;
  rng: Rng;
  events: EventBus;
  terrain: Terrain;
  /** every underground map (colony nests and caves), keyed by space id */
  grids = new Map<number, NestGrid>();
  gridFlows = new Map<number, NestFlow>();
  surfFlow: SurfaceFlow;
  phero: Pheromones;
  /** spatial hashes */
  antHashSurface: SpatialHash;
  antHashNest = new Map<number, SpatialHash>();
  foodHash: SpatialHash;
  creatureHash: SpatialHash;
  antById = new Map<number, Ant>();
  /**
   * Scratch caches rebuilt each tick from the state (never saved), per world so
   * two worlds in one process (tests, replays) never share them: attack slots
   * held on each creature (slots.ts), riding slots and room taken (creatures/climb.ts).
   */
  readonly tickCache = {
    /** attack slots held or reserved on each creature (outline fractions) and ant (world angles) this tick (slots.ts) */
    slotHeld: new Map<number, { tick: number; v: number[]; ids: number[] }>(),
    antSlotHeld: new Map<number, { tick: number; v: number[]; ids: number[] }>(),
    /** mount slots taken on each creature, and per colony its riders and ground attackers (creatures/climb.ts) */
    rideTaken: new Map<number, { tick: number; mask: number; cols: number[] }>(),
    /** sickle-jaw lunges this tick: victim key → the lunging soldier (sickleJaws.ts) */
    lunging: { tick: -1, map: new Map<number, number>() },
  };
  foodById = new Map<number, Food>();
  broodById = new Map<number, Brood>();
  creatureById = new Map<number, Creature>();
  colonyById = new Map<number, Colony>();
  /** per-tick removal marks */
  private removeAnts = new Set<number>();
  private removeFood = new Set<number>();
  private removeBrood = new Set<number>();
  private removeCreatures = new Set<number>();
  /** systems registered by modules (called each tick in order) */
  systems: Array<{ name: string; fn: (w: World, dt: number) => void; every?: number }> = [];
  /** game-mode hook called each tick */
  modeTick: ((w: World, dt: number) => void) | null = null;

  constructor(state: SimState, events: EventBus) {
    this.s = state;
    this.events = events;
    this.rng = new Rng(1);
    this.rng.state = state.rng;
    this.terrain = new Terrain(state.terrain);
    if (!state.caves) state.caves = [];
    // A viewer setting older saves kept in the simulation; it is client-side now (GameSession.revealAreas).
    delete (state.settings as { revealAreas?: boolean }).revealAreas;
    // Version 1 saves keyed nest maps by colony id; now they are keyed by space.
    const shift = (state.version ?? 1) < 2 ? 1 : 0;
    const nests: SimState['nests'] = {};
    for (const [key, data] of Object.entries(state.nests)) {
      const space = Number(key) + shift;
      nests[space] = data;
      if (!data) continue;
      const g = NestGrid.deserialize(data);
      this.grids.set(space, g);
      this.gridFlows.set(space, new NestFlow(g));
    }
    state.nests = nests;
    state.version = Math.max(2, state.version ?? 1);
    for (const c of state.colonies) {
      if (c.team === undefined) c.team = c.id;
      c.hexSpeed = null; // a cache (and JSON turns typed arrays into plain objects)
      // entrance tunnels, spots and throughput fields (older saves: sim/entrances.ts)
      const g = this.grids.get(nestSpace(c.id));
      if (g) migrateColonyEntrances(this, c, g);
      else for (const e of c.entrances) normalizeEntrance(e, state.time);
    }
    for (const cv of state.caves) for (const e of cv.entrances) normalizeEntrance(e, state.time);
    this.surfFlow = new SurfaceFlow(this.terrain);
    this.phero = new Pheromones(this.terrain.width, this.terrain.depth, Math.max(1, state.colonies.length));
    this.antHashSurface = new SpatialHash(this.terrain.width, this.terrain.depth, 8, 4096);
    this.foodHash = new SpatialHash(this.terrain.width, this.terrain.depth, 16, 1024);
    this.creatureHash = new SpatialHash(this.terrain.width, this.terrain.depth, 24, 256);
    this.reindex();
  }

  get time(): number {
    return this.s.time;
  }

  nextId(): number {
    return this.s.nextId++;
  }

  /** Register an underground map for a space (colony nest or cave). */
  addGrid(space: number, grid: NestGrid): void {
    this.grids.set(space, grid);
    this.gridFlows.set(space, new NestFlow(grid));
    this.s.nests[space] = null; // serialized lazily
  }

  addNest(colony: number, grid: NestGrid): void {
    this.addGrid(nestSpace(colony), grid);
  }

  /** A colony's home nest map. */
  nest(colony: number): NestGrid | undefined {
    return this.grids.get(nestSpace(colony));
  }

  /** A colony's home nest flow fields. */
  flow(colony: number): NestFlow | undefined {
    return this.gridFlows.get(nestSpace(colony));
  }

  /** Flow fields of any underground space. */
  flowOf(space: number): NestFlow | undefined {
    return this.gridFlows.get(space);
  }

  cave(space: number): CaveDef | undefined {
    return isCaveSpace(space) ? this.s.caves.find((c) => c.space === space) : undefined;
  }

  /** Entrances of an underground area (a colony's nest or a cave). */
  entrancesOf(space: number): Entrance[] {
    if (isCaveSpace(space)) return this.cave(space)?.entrances ?? NO_ENTRANCES;
    return this.colony(colonyOfSpace(space))?.entrances ?? NO_ENTRANCES;
  }

  /** Surface centre of an underground area (its entrances sit around it). */
  areaCentre(space: number, out: { x: number; y: number }): { x: number; y: number } {
    const a = isCaveSpace(space) ? this.cave(space) : this.colony(colonyOfSpace(space));
    out.x = a ? a.nx : this.terrain.width / 2;
    out.y = a ? a.ny : this.terrain.depth / 2;
    return out;
  }

  /** Every underground space in the level: colony nests in colony order, then caves. */
  undergroundSpaces(): number[] {
    const out: number[] = [];
    for (const c of this.s.colonies) if (this.grids.has(nestSpace(c.id))) out.push(nestSpace(c.id));
    for (const cv of this.s.caves) if (this.grids.has(cv.space)) out.push(cv.space);
    return out;
  }

  /** Team of a colony (−1 for none). */
  teamOf(colony: number): number {
    return this.colonyById.get(colony)?.team ?? colony;
  }

  colony(id: number): Colony | undefined {
    return this.colonyById.get(id);
  }

  /** The first human-controlled colony (single-player and tools). In multiplayer several colonies are human; the client knows which one is its own. */
  playerColony(): Colony | undefined {
    return this.s.colonies.find((c) => c.player);
  }

  reindex(): void {
    this.antById.clear();
    for (const a of this.s.ants) this.antById.set(a.id, a);
    this.foodById.clear();
    for (const f of this.s.food) this.foodById.set(f.id, f);
    this.broodById.clear();
    for (const b of this.s.brood) this.broodById.set(b.id, b);
    this.creatureById.clear();
    for (const c of this.s.creatures) this.creatureById.set(c.id, c);
    this.colonyById.clear();
    for (const c of this.s.colonies) this.colonyById.set(c.id, c);
    this.phero.ensureColonies(this.s.colonies.length);
  }

  // ---------- entity creation/removal ----------
  addAnt(a: Ant): Ant {
    this.s.ants.push(a);
    this.antById.set(a.id, a);
    return a;
  }

  addFood(f: Food): Food {
    this.s.food.push(f);
    this.foodById.set(f.id, f);
    return f;
  }

  addBrood(b: Brood): Brood {
    this.s.brood.push(b);
    this.broodById.set(b.id, b);
    return b;
  }

  addCreature(c: Creature): Creature {
    this.s.creatures.push(c);
    this.creatureById.set(c.id, c);
    return c;
  }

  addProjectile(p: Projectile): void {
    this.s.projectiles.push(p);
  }

  killAntNow(id: number): void {
    this.removeAnts.add(id);
  }

  removeFoodNow(id: number): void {
    this.removeFood.add(id);
  }

  removeBroodNow(id: number): void {
    this.removeBrood.add(id);
  }

  removeCreatureNow(id: number): void {
    this.removeCreatures.add(id);
  }

  private compact(): void {
    if (this.removeAnts.size) {
      this.s.ants = this.s.ants.filter((a) => !this.removeAnts.has(a.id));
      for (const id of this.removeAnts) this.antById.delete(id);
      this.removeAnts.clear();
    }
    if (this.removeFood.size) {
      this.s.food = this.s.food.filter((f) => !this.removeFood.has(f.id));
      for (const id of this.removeFood) this.foodById.delete(id);
      this.removeFood.clear();
    }
    if (this.removeBrood.size) {
      this.s.brood = this.s.brood.filter((b) => !this.removeBrood.has(b.id));
      for (const id of this.removeBrood) this.broodById.delete(id);
      this.removeBrood.clear();
    }
    if (this.removeCreatures.size) {
      this.s.creatures = this.s.creatures.filter((c) => !this.removeCreatures.has(c.id));
      for (const id of this.removeCreatures) this.creatureById.delete(id);
      this.removeCreatures.clear();
    }
  }

  /** spatial hashes match the current positions (rebuilt at the start of each tick) */
  private hashesFresh = false;

  /** Positions changed outside a tick (a replica took a new frame): rebuild the spatial hashes before the next query. */
  touch(): void {
    this.hashesFresh = false;
  }

  /** Make spatial queries valid between ticks (commands applied at a tick boundary use them). */
  prepareQueries(): void {
    if (!this.hashesFresh) this.rebuildHashes();
  }

  private rebuildHashes(): void {
    this.hashesFresh = true;
    this.antHashSurface.clear();
    for (const h of this.antHashNest.values()) h.clear();
    const ants = this.s.ants;
    for (let i = 0; i < ants.length; i++) {
      const a = ants[i];
      const team = a.team ?? a.colony;
      if (a.space === SURFACE) this.antHashSurface.insert(i, a.x, a.y, team);
      else {
        let h = this.antHashNest.get(a.space);
        if (!h) {
          const g = this.nestOf(a.space);
          h = new SpatialHash(g ? g.widthMm : 600, g ? g.depthMm : 600, 8, 1024);
          this.antHashNest.set(a.space, h);
        }
        h.insert(i, a.x, a.y, team);
      }
    }
    this.foodHash.clear();
    const food = this.s.food;
    for (let i = 0; i < food.length; i++) if (food[i].space === SURFACE && food[i].heldBy === 0) this.foodHash.insert(i, food[i].x, food[i].y);
    this.creatureHash.clear();
    const cr = this.s.creatures;
    for (let i = 0; i < cr.length; i++) if (cr[i].space === SURFACE && !cr[i].dead) this.creatureHash.insert(i, cr[i].x, cr[i].y);
  }

  /** Ants near a point in a space (callback receives the ant). */
  antsNear(space: number, x: number, y: number, r: number, cb: (a: Ant, d2: number) => boolean | void): void {
    const h = space === SURFACE ? this.antHashSurface : this.antHashNest.get(space);
    if (!h) return;
    const ants = this.s.ants;
    h.query(x, y, r, (i, d2) => {
      const a = ants[i];
      if (!a || a.space !== space) return false;
      return cb(a, d2);
    });
  }

  /** Like `antsNear`, but the callback gets the ant's index in `s.ants` (scratch arrays keyed by index). */
  antIdxNear(space: number, x: number, y: number, r: number, cb: (i: number, d2: number) => boolean | void): void {
    const h = space === SURFACE ? this.antHashSurface : this.antHashNest.get(space);
    if (!h) return;
    const ants = this.s.ants;
    h.query(x, y, r, (i, d2) => {
      const a = ants[i];
      if (!a || a.space !== space) return false;
      return cb(i, d2);
    });
  }

  /** Ants of other teams near a point (friends are skipped inside the hash walk). */
  enemiesNear(space: number, team: number, x: number, y: number, r: number, cb: (a: Ant, d2: number) => boolean | void): void {
    const h = space === SURFACE ? this.antHashSurface : this.antHashNest.get(space);
    if (!h) return;
    const ants = this.s.ants;
    h.queryOthers(x, y, r, team, (i, d2) => {
      const a = ants[i];
      if (!a || a.space !== space) return false;
      return cb(a, d2);
    });
  }

  foodNear(x: number, y: number, r: number, cb: (f: Food, d2: number) => boolean | void): void {
    const food = this.s.food;
    this.foodHash.query(x, y, r, (i, d2) => {
      const f = food[i];
      if (!f) return false;
      return cb(f, d2);
    });
  }

  creaturesNear(x: number, y: number, r: number, cb: (c: Creature, d2: number) => boolean | void): void {
    const cr = this.s.creatures;
    this.creatureHash.query(x, y, r + 40, (i, d2) => {
      const c = cr[i];
      if (!c || c.dead) return false;
      const rr = r + c.scale * 0.5;
      if (d2 > rr * rr) return false;
      return cb(c, d2);
    });
  }

  // ---------- space helpers ----------
  isNest(space: number): boolean {
    return space !== SURFACE;
  }

  nestOf(space: number): NestGrid | undefined {
    return this.grids.get(space);
  }

  /** Is the point walkable in that space? */
  walkable(space: number, x: number, y: number): boolean {
    if (space === SURFACE) return this.terrain.passable(x, y) && this.terrain.inBounds(x, y, 2);
    const g = this.nestOf(space);
    if (!g) return false;
    return g.isAir(Math.floor(x / g.cell), Math.floor(y / g.cell));
  }

  // ---------- main step ----------
  step(dt: number): void {
    const s = this.s;
    s.tick++;
    s.time += dt;
    this.rebuildHashes();
    for (const sys of this.systems) {
      if (sys.every && s.tick % sys.every !== 0) continue;
      sys.fn(this, sys.every ? dt * sys.every : dt);
    }
    this.modeTick?.(this, dt);
    this.compact();
    this.hashesFresh = false;
    s.rng = this.rng.state;
  }

  /** Snapshot for saving (nest grids serialized). */
  serialize(): SimState {
    for (const [space, g] of this.grids) this.s.nests[space] = g.serialize();
    this.s.rng = this.rng.state;
    return JSON.parse(JSON.stringify(this.s));
  }
}

export function emptyState(seed: number, terrainParams: SimState['terrain']): SimState {
  return {
    version: 2,
    tick: 0,
    time: 0,
    seed,
    rng: seed * 9781 + 7,
    nextId: 1,
    terrain: terrainParams,
    nests: {},
    caves: [],
    colonies: [],
    ants: [],
    brood: [],
    food: [],
    creatures: [],
    aphids: [] as AphidCluster[],
    plants: [] as LeafPlant[],
    projectiles: [],
    settings: {
      queenDeathLoses: true,
      fog: false,
      autoWaves: false,
      waveInterval: 120,
      eggRate: 1,
      statMul: 1,
      enemyStatMul: 1,
      aggression: 1,
      foodRespawn: 1,
      // wild creatures (ecology spawner scale): off unless a mode switches them on, so headless tests stay focused
      creatures: 0,
    },
    night: 0,
    mode: {},
  };
}

const NO_ENTRANCES: Entrance[] = [];

export { nestSpace, colonyOfSpace, SURFACE };
