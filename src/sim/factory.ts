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

export function makeAnt(w: World, colony: number, caste: string, space: number, x: number, y: number, h = 0): Ant {
  const c = casteOf(caste);
  const col = w.colony(colony);
  const hpMul = col?.player ? w.s.settings.statMul : w.s.settings.enemyStatMul;
  const hp = c.hp * hpMul;
  const a: Ant = {
    id: w.nextId(),
    colony,
    team: col?.team ?? colony,
    caste,
    space,
    x,
    y,
    px: x,
    py: y,
    h,
    ph: h,
    v: 0,
    hp,
    maxHp: hp,
    age: 0,
    state: AS.Idle,
    st: 0,
    task: 'idle',
    taskT: 0,
    tx: x,
    ty: y,
    tgt: 0,
    tk: 0,
    carry: Carry.None,
    carryId: 0,
    carryAmt: 0,
    crop: 0,
    scoutH: 0,
    partner: 0,
    contact: 0,
    pause: 0,
    turn: 0,
    alarm: 0,
    gId: 0,
    gKind: 0,
    gSlot: 0,
    venom: 0,
    venomT: 0,
    venomDps: 0,
    cd: 0,
    cd2: 0,
    marker: -1,
    ent: 0,
    fz: 0,
    fvz: 0,
    fvx: 0,
    fvy: 0,
    deadT: 0,
    pose: 0,
    look: 0,
    slowT: 0,
    stun: 0,
    meetCd: w.rng.range(0, 4),
    lost: 0,
    sizeVar: c.role === 'queen' ? 0 : w.rng.range(-1, 1),
    colorVar: w.rng.range(-1, 1),
    pinned: 0,
    ride: 0,
    tile: -1,
    power: 1,
    level: 1,
    jobK: 0,
    jobQ: -1,
    lostT: 0,
  };
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
