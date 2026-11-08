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
 */
export function antShape(): Ant {
  return {
    id: undefined,
    colony: undefined,
    team: undefined,
    caste: undefined,
    space: undefined,
    x: undefined,
    y: undefined,
    px: undefined,
    py: undefined,
    h: undefined,
    ph: undefined,
    v: undefined,
    hp: undefined,
    maxHp: undefined,
    age: undefined,
    state: undefined,
    st: undefined,
    task: undefined,
    taskT: undefined,
    tx: undefined,
    ty: undefined,
    tgt: undefined,
    tk: undefined,
    carry: undefined,
    carryId: undefined,
    carryAmt: undefined,
    crop: undefined,
    scoutH: undefined,
    partner: undefined,
    contact: undefined,
    pause: undefined,
    turn: undefined,
    alarm: undefined,
    gId: undefined,
    gKind: undefined,
    gSlot: undefined,
    venom: undefined,
    venomT: undefined,
    venomDps: undefined,
    cd: undefined,
    cd2: undefined,
    marker: undefined,
    ent: undefined,
    fz: undefined,
    fvz: undefined,
    fvx: undefined,
    fvy: undefined,
    deadT: undefined,
    pose: undefined,
    look: undefined,
    slowT: undefined,
    stun: undefined,
    meetCd: undefined,
    lost: undefined,
    sizeVar: undefined,
    colorVar: undefined,
    pinned: undefined,
    ride: undefined,
    tile: undefined,
    power: undefined,
    level: undefined,
    jobK: undefined,
    jobQ: undefined,
    lostT: undefined,
    udr: undefined,
    fhd: undefined,
    gUn: undefined,
    trf: undefined,
    avs: undefined,
    avT: undefined,
    bN: undefined,
    rotT: undefined,
    fsrc: undefined,
    rushH: undefined,
    rushT: undefined,
    waitT: undefined,
    rsv: undefined,
    flk: undefined,
    blkD: undefined,
    blkT: undefined,
    repT: undefined,
    anc: undefined,
    stp: undefined,
    stx: undefined,
    sty: undefined,
    bkS: undefined,
    bkI: undefined,
    garT: undefined,
    rideId: undefined,
    ridePh: undefined,
    rideRail: undefined,
    rideSlot: undefined,
    rideT: undefined,
    climbCd: undefined,
    rideWalk: undefined,
    softLand: undefined,
    dirA: undefined,
    dirW: undefined,
    dirL: undefined,
    dirX: undefined,
    dirY: undefined,
    lastHit: undefined,
    tauntCd: undefined,
    tauntFx: undefined,
    tauntBy: undefined,
    tauntT: undefined,
    rage: undefined,
    rageT: undefined,
    rageFx: undefined,
    rageAura: undefined,
    rageTick: undefined,
    stingN: undefined,
    jobS: undefined,
    entT: undefined,
    rampT: undefined,
    rampN: undefined,
    rampG: undefined,
    fire: undefined,
    root: undefined,
    rootImm: undefined,
    idleT: undefined,
    chT: undefined,
    chCd: undefined,
    glueCd: undefined,
    alCd: undefined,
    alertUntil: undefined,
    alX: undefined,
    alY: undefined,
    variant: undefined,
    snapCd: undefined,
    holdId: undefined,
    holdKind: undefined,
    holdT: undefined,
    heldBy: undefined,
    exec: undefined,
    gripCr: undefined,
    surgeT: undefined,
    surgeCd: undefined,
    ecPh: undefined,
    ecT: undefined,
    ecN: undefined,
    ecY: undefined,
    helpOf: undefined,
    ecE: undefined,
    link: undefined,
    xing: undefined,
    xt: undefined,
    glueT: undefined,
    uw: undefined,
    fl: undefined,
    flB: undefined,
  } as unknown as Ant;
}

/** An ant from a save or a snapshot in the one shape (its fields copied over; any unknown old field kept at the end). */
export function normalizeAnt(o: Ant): Ant {
  const a = antShape() as unknown as Record<string, unknown>;
  for (const k in o) a[k] = (o as unknown as Record<string, unknown>)[k];
  return a as unknown as Ant;
}

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
