import { World } from './world';
import { Ant, AS, Brood, Carry, Food, FoodKind, Creature } from './types';
import { casteOf } from './species';
import { NASUTE } from './balance';

/** Deterministic integer hash of an entity id (termite worker sex, etc.). */
export function idHash(id: number): number {
  let x = Math.imul(id + 1, 0x9e3779b1) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}

/**
 * Every field an ant can have, in one order (performance v3): an ant made here, or restored from a save
 * (`normalizeAnt`), has all of them from the start — the optional ones `undefined` — so every ant shares one object
 * shape and the hot loops read their fields at one place each instead of looking them up among a hundred shapes.
 * `undefined` is "absent" everywhere (the snapshot and the frames skip it). tests/performance.ts checks the list
 * against the `Ant` interface: a new field goes here too.
 * A class, not an object literal: V8 keeps a literal of this many fields wholly outside the object (one more load on
 * every field read, and a new hidden class per copy of the literal); a constructor's fields stay inside it.
 * The fields makeAnt always sets start as a number (or '' for the strings), not `undefined`: V8 keeps a number field
 * that has only ever held numbers as a double in place, but one that also held `undefined` stores every new double as
 * a fresh heap number — an allocation on each write of a position or timer (makeAnt overwrites every placeholder).
 */
// (typed as an Ant by antShape; the class only gives the record its fields in the object)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface AntRecord { [k: string]: any }
class AntRecord {
  constructor() {
    this.id = 0;
    this.colony = 0;
    this.team = 0;
    this.caste = '';
    this.space = 0;
    this.x = 0;
    this.y = 0;
    this.px = 0;
    this.py = 0;
    this.h = 0;
    this.ph = 0;
    this.v = 0;
    this.hp = 0;
    this.maxHp = 0;
    this.age = 0;
    this.state = 0;
    this.st = 0;
    this.task = '';
    this.taskT = 0;
    this.tx = 0;
    this.ty = 0;
    this.tgt = 0;
    this.tk = 0;
    this.carry = 0;
    this.carryId = 0;
    this.carryAmt = 0;
    this.crop = 0;
    this.scoutH = 0;
    this.partner = 0;
    this.contact = 0;
    this.pause = 0;
    this.turn = 0;
    this.alarm = 0;
    this.gId = 0;
    this.gKind = 0;
    this.gSlot = 0;
    this.venom = 0;
    this.venomT = 0;
    this.venomDps = 0;
    this.cd = 0;
    this.cd2 = 0;
    this.marker = 0;
    this.ent = 0;
    this.fz = 0;
    this.fvz = 0;
    this.fvx = 0;
    this.fvy = 0;
    this.deadT = 0;
    this.pose = 0;
    this.look = 0;
    this.slowT = 0;
    this.stun = 0;
    this.meetCd = 0;
    this.lost = 0;
    this.sizeVar = 0;
    this.colorVar = 0;
    this.pinned = 0;
    this.ride = 0;
    this.tile = 0;
    this.power = 0;
    this.level = 0;
    this.jobK = 0;
    this.jobQ = 0;
    this.lostT = 0;
    this.udr = 0;
    this.fhd = 0;
    this.gUn = 0;
    this.trf = 0;
    this.avs = 0;
    this.avT = 0;
    this.bN = 0;
    this.rotT = 0;
    this.fsrc = 0;
    this.rushH = undefined;
    this.rushT = undefined;
    this.waitT = undefined;
    this.rsv = undefined;
    this.flk = undefined;
    this.blkD = undefined;
    this.blkT = undefined;
    this.repT = undefined;
    this.anc = undefined;
    this.stp = undefined;
    this.stx = undefined;
    this.sty = undefined;
    this.bkS = undefined;
    this.bkI = undefined;
    this.garT = undefined;
    this.rideId = undefined;
    this.ridePh = undefined;
    this.rideRail = undefined;
    this.rideSlot = undefined;
    this.rideT = undefined;
    this.climbCd = undefined;
    this.rideWalk = undefined;
    this.softLand = undefined;
    this.dirA = undefined;
    this.dirW = undefined;
    this.dirL = undefined;
    this.dirX = undefined;
    this.dirY = undefined;
    this.lastHit = undefined;
    this.tauntCd = undefined;
    this.tauntFx = undefined;
    this.tauntBy = undefined;
    this.tauntT = undefined;
    this.rage = undefined;
    this.rageT = undefined;
    this.rageFx = undefined;
    this.rageAura = undefined;
    this.rageTick = undefined;
    this.stingN = undefined;
    this.jobS = undefined;
    this.entT = undefined;
    this.rampT = undefined;
    this.rampN = undefined;
    this.rampG = undefined;
    this.fire = undefined;
    this.root = undefined;
    this.rootImm = undefined;
    this.idleT = undefined;
    this.chT = undefined;
    this.chCd = undefined;
    this.glueCd = undefined;
    this.alCd = undefined;
    this.alertUntil = undefined;
    this.alX = undefined;
    this.alY = undefined;
    this.variant = undefined;
    this.snapCd = undefined;
    this.holdId = undefined;
    this.holdKind = undefined;
    this.holdT = undefined;
    this.heldBy = undefined;
    this.exec = undefined;
    this.gripCr = undefined;
    this.surgeT = undefined;
    this.surgeCd = undefined;
    this.ecPh = undefined;
    this.ecT = undefined;
    this.ecN = undefined;
    this.ecY = undefined;
    this.helpOf = undefined;
    this.ecE = undefined;
    this.link = undefined;
    this.xing = undefined;
    this.xt = undefined;
    this.glueT = undefined;
    this.uw = undefined;
    this.fl = undefined;
    this.flB = undefined;
    // (the Saiy-Ant Blaster's)
    this.shotN = undefined;
    this.beamT = undefined;
    this.beamH = undefined;
    this.beamL = undefined;
    this.beamD = undefined;
    this.beamP = undefined;
    this.beamCd = undefined;
    // the Trees layer (sim/trees.ts): on a trunk, and the fall off a branch
    this.trunkT = undefined;
    this.trunkUp = undefined;
    this.trunkX = undefined;
    this.trunkY = undefined;
    this.fell = undefined;
  }
}

export function antShape(): Ant {
  return new AntRecord() as unknown as Ant;
}

/** An ant from a save or a snapshot in the one shape (its fields copied over; any unknown old field kept at the end). */
export function normalizeAnt(o: Ant): Ant {
  const a = antShape() as unknown as Record<string, unknown>;
  for (const k in o) a[k] = (o as unknown as Record<string, unknown>)[k];
  // (a field makeAnt always sets but an old save lacks stays absent-alike, as it was)
  for (const k of ALWAYS) if (!(k in o)) a[k] = undefined;
  return a as unknown as Ant;
}

/**
 * (performance v3) Settle the shape's field kinds once, at load: V8 widens a field's kind the first time it holds a new
 * kind of value (an integer, then a fraction; undefined, then a number or an object), and each widening gives every
 * ant a new hidden class that each ant then moves to on its next touch — hundreds of widenings over the first minutes
 * of a game, the ants spread over several classes meanwhile. Widened here on a throwaway ant to what the fields will
 * hold (numbers as fractions; the optional fields anything), every ant is made in the final class.
 */
function settleShape(): void {
  const d = antShape() as unknown as Record<string, unknown>;
  const always = new Set<string>(ALWAYS);
  for (const k of Object.keys(d)) {
    if (k === 'caste' || k === 'task') {
      d[k] = 'a';
      d[k] = 'b';
    } else if (always.has(k)) {
      d[k] = 0.5;
      d[k] = 1;
      d[k] = -0.25;
    } else {
      d[k] = 0.5;
      d[k] = 'x';
      d[k] = {};
      d[k] = [];
      d[k] = undefined;
    }
  }
}

/** The fields makeAnt always sets (antShape gives them typed placeholders; see there). */
const ALWAYS = ['id', 'colony', 'team', 'caste', 'space', 'x', 'y', 'px', 'py', 'h', 'ph', 'v', 'hp', 'maxHp', 'age', 'state', 'st', 'task', 'taskT', 'tx', 'ty', 'tgt', 'tk', 'carry', 'carryId', 'carryAmt', 'crop', 'scoutH', 'partner', 'contact', 'pause', 'turn', 'alarm', 'gId', 'gKind', 'gSlot', 'venom', 'venomT', 'venomDps', 'cd', 'cd2', 'marker', 'ent', 'fz', 'fvz', 'fvx', 'fvy', 'deadT', 'pose', 'look', 'slowT', 'stun', 'meetCd', 'lost', 'sizeVar', 'colorVar', 'pinned', 'ride', 'tile', 'power', 'level', 'jobK', 'jobQ', 'lostT', 'udr', 'fhd', 'gUn', 'trf', 'avs', 'avT', 'bN', 'rotT', 'fsrc'];

export function makeAnt(w: World, colony: number, caste: string, space: number, x: number, y: number, h = 0): Ant {
  const c = casteOf(caste);
  const col = w.colony(colony);
  const hpMul = col?.player ? w.s.settings.statMul : w.s.settings.enemyStatMul;
  const hp = c.hp * hpMul;
  // (the fields in the order they were always set: the random draws for meetCd, sizeVar and colorVar keep theirs)
  const a = antShape();
  a.id = w.nextId();
  a.colony = colony;
  a.team = col?.team ?? colony;
  a.caste = caste;
  a.space = space;
  a.x = x;
  a.y = y;
  a.px = x;
  a.py = y;
  a.h = h;
  a.ph = h;
  a.v = 0;
  a.hp = hp;
  a.maxHp = hp;
  a.age = 0;
  a.state = AS.Idle;
  a.st = 0;
  a.task = 'idle';
  a.taskT = 0;
  a.tx = x;
  a.ty = y;
  a.tgt = 0;
  a.tk = 0;
  a.carry = Carry.None;
  a.carryId = 0;
  a.carryAmt = 0;
  a.crop = 0;
  a.scoutH = 0;
  a.partner = 0;
  a.contact = 0;
  a.pause = 0;
  a.turn = 0;
  a.alarm = 0;
  a.gId = 0;
  a.gKind = 0;
  a.gSlot = 0;
  a.venom = 0;
  a.venomT = 0;
  a.venomDps = 0;
  a.cd = 0;
  a.cd2 = 0;
  a.marker = -1;
  a.ent = 0;
  a.fz = 0;
  a.fvz = 0;
  a.fvx = 0;
  a.fvy = 0;
  a.deadT = 0;
  a.pose = 0;
  a.look = 0;
  a.slowT = 0;
  a.stun = 0;
  a.meetCd = w.rng.range(0, 4);
  a.lost = 0;
  a.sizeVar = c.role === 'queen' ? 0 : w.rng.range(-1, 1);
  a.colorVar = w.rng.range(-1, 1);
  a.pinned = 0;
  a.ride = 0;
  a.tile = -1;
  a.power = 1;
  a.level = 1;
  a.jobK = 0;
  a.jobQ = -1;
  a.lostT = 0;
  // combat v2.2 (the under-pass): set from the start so every ant keeps one object shape (written every other tick)
  a.udr = 0;
  a.fhd = 0;
  a.gUn = 0;
  a.trf = 0;
  a.avs = 0;
  a.avT = 0;
  a.bN = 0;
  a.rotT = 0;
  a.fsrc = 0;
  // Species extras, only on the castes that use them (other species' records stay as they were).
  if (c.termite) {
    if (c.termite === 'nasute') {
      a.rampT = 0;
      a.rampN = 0;
      a.rampG = 0;
      a.fire = 0;
    }
    if (c.termite === 'major') {
      a.chT = 0;
      a.chCd = 0;
      a.glueCd = 0;
      a.alCd = 0;
    }
    if (c.termite === 'sickle') {
      // grab-and-squirt (sim/sickleJaws.ts): hold target in holdId / holdKind, squirt ticks in rampN
      a.rampT = 0;
      a.rampN = 0;
      a.snapCd = 0;
      a.alCd = 0;
    }
    if (c.termite === 'worker' && c.species === 'nasutitermes') {
      // UF/IFAS: large workers are female, small ones male.
      a.variant = idHash(a.id) & 1;
      if (a.variant === 1) {
        a.hp *= 1 + NASUTE.worker.femaleHpBonus;
        a.maxHp = a.hp;
      }
    }
    a.alertUntil = 0;
  }
  if (c.snap) {
    a.snapCd = 0;
    a.holdId = 0;
    a.holdKind = 0;
    a.holdT = 0;
  }
  if (c.surge) {
    a.surgeT = 0;
    a.surgeCd = 0;
  }
  return w.addAnt(a);
}

export function makeBrood(w: World, colony: number, caste: string, x: number, y: number, tile: number): Brood {
  return w.addBrood({ id: w.nextId(), colony, stage: 0, caste, t: 0, fed: 0, hunger: 0, x, y, carrier: 0, tile });
}

const FOOD_PROPS: Record<FoodKind, { size: number; mass: number; amount: number }> = {
  insect: { size: 9, mass: 6, amount: 18 },
  seed: { size: 2.5, mass: 1.5, amount: 4 },
  berry: { size: 8, mass: 8, amount: 30 },
  honeydew: { size: 1.5, mass: 0.2, amount: 1 },
  crumb: { size: 1.4, mass: 0.6, amount: 2 },
  corpse: { size: 4, mass: 1, amount: 4 },
  leaf: { size: 5, mass: 1, amount: 3 },
  fungus: { size: 2, mass: 0.5, amount: 2 },
  // a chewed wood fragment; deadwood sources are sized by spawnWood (mapGen)
  wood: { size: 1.6, mass: 0.6, amount: 1 },
};

export function makeFood(w: World, kind: FoodKind, space: number, x: number, y: number, scale = 1, from = ''): Food {
  const p = FOOD_PROPS[kind];
  const amount = p.amount * scale * scale;
  return w.addFood({
    id: w.nextId(),
    kind,
    space,
    x,
    y,
    px: x,
    py: y,
    h: w.rng.range(0, Math.PI * 2),
    amount,
    max: amount,
    size: p.size * scale,
    mass: p.mass * scale * scale,
    heldBy: 0,
    from,
    colony: -1,
    v: w.rng.int(0, 1 << 20),
    jerk: 0,
    age: 0,
  });
}

export function makeCreature(w: World, kind: string, space: number, x: number, y: number, hp: number, scale: number): Creature {
  return w.addCreature({
    id: w.nextId(),
    kind,
    space,
    x,
    y,
    px: x,
    py: y,
    h: w.rng.range(0, Math.PI * 2),
    ph: 0,
    v: 0,
    hp,
    maxHp: hp,
    state: 0,
    st: 0,
    tgt: 0,
    tk: 0,
    tx: x,
    ty: y,
    homeX: x,
    homeY: y,
    cd: 0,
    cd2: 0,
    latched: 0,
    latchGrip: 0,
    phase: 0,
    wind: 0,
    anim: 0,
    v2: w.rng.next(),
    dead: false,
    deadT: 0,
    scale,
    venom: 0,
    venomT: 0,
    venomDps: 0,
    slowT: 0,
    stun: 0,
    faction: -1,
    data: {},
  });
}

settleShape();
