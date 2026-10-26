/**
 * Creature kinds: stats and info-card text, taken from the reference notes in
 * docs/creatures. Sizes are real body lengths in mm (bosses are scaled up as
 * the notes say). Behaviour lives in creatureAI.ts, keyed by `ai`; the look
 * and gait live in render/creatures.
 */

export type CreatureRelation = 'hostile' | 'prey' | 'ignore';

export type CreatureAI =
  | 'passiveRoller'
  | 'caterpillar'
  | 'hunter'
  | 'stalker'
  | 'centipede'
  | 'rove'
  | 'mantis'
  | 'antlion'
  | 'spiderling'
  | 'stag'
  | 'tarantula'
  | 'scolopendra'
  | 'giantMantis'
  | 'hogna';

export interface CreatureKind {
  id: string;
  name: string;
  sci: string;
  /** what it is in the game, one line */
  role: string;
  /** body length in mm (model and hit size) */
  length: number;
  hp: number;
  /** subtracted from bites (acid mostly ignores it) */
  armor: number;
  /** walking speed mm/s */
  speed: number;
  /** damage per bite/strike */
  bite: number;
  attackInterval: number;
  /** venom it injects with a bite: dps per stack, seconds, max stacks */
  venom?: { dps: number; duration: number; maxStacks: number };
  /** how far ants are noticed (mm) */
  sense: number;
  /** total grip of latched ants needed to stop it (more = harder to hold) */
  strength: number;
  /** how ants treat it: prey (foragers hunt it), hostile (fighters engage, workers avoid) */
  relation: CreatureRelation;
  /** food left by the carcass */
  food: number;
  /** carcass mass for group transport (> 80: ants cut it up where it lies) */
  mass: number;
  /** flees to cover below this fraction of its health (0 = never) */
  fleeAt: number;
  boss?: boolean;
  /**
   * The fastest it can turn (rad/s), whatever it is doing. Long chain bodies (centipedes, caterpillars)
   * turn by curving round, not by spinning on the spot: without a limit they swung round in a few ticks
   * and their drawn bodies looped into knots (user report 2026-10-25: the "dislocated neck").
   */
  maxTurn?: number;
  nocturnal?: boolean;
  /** relative abundance when the ecosystem spawns wild creatures (0 = never spawned wild) */
  wild: number;
  ai: CreatureAI;
  facts: string[];
}

const K = (k: CreatureKind) => k;

export const CREATURES: Record<string, CreatureKind> = {
  // ---------------------------------------------------------------- passive (food)
  pillbug: K({
    id: 'pillbug',
    name: 'Common pill woodlouse',
    sci: 'Armadillidium vulgare',
    role: 'Harmless detritivore. Rolls into an armoured ball when attacked. Food.',
    length: 12,
    hp: 60,
    armor: 3,
    speed: 9,
    bite: 0,
    attackInterval: 1,
    sense: 20,
    strength: 6,
    relation: 'prey',
    food: 22,
    mass: 9,
    fleeAt: 0,
    wild: 5,
    ai: 'passiveRoller',
    facts: ['Woodlice are crustaceans: closer relatives of crabs and shrimp than of insects.', 'They breathe with gill-like structures and need damp places to survive.'],
  }),
  cutworm: K({
    id: 'cutworm',
    name: 'Cutworm (large yellow underwing caterpillar)',
    sci: 'Noctua pronuba (larva)',
    role: 'Slow, soft and full of food. Curls into a C and thrashes when attacked.',
    length: 40,
    hp: 120,
    armor: 0,
    speed: 4.5,
    bite: 0,
    attackInterval: 1.6,
    sense: 18,
    strength: 18,
    relation: 'prey',
    food: 70,
    mass: 40,
    fleeAt: 0,
    nocturnal: true,
    wild: 2,
    maxTurn: 1.2,
    ai: 'caterpillar',
    facts: ['Cutworms are named for chewing through plant stems at ground level at night.', 'Caterpillars have only six true legs; the rest are fleshy prolegs with tiny hooks.'],
  }),
  // ---------------------------------------------------------------- predators
  groundBeetle: K({
    id: 'groundBeetle',
    name: 'Rain beetle (ground beetle)',
    sci: 'Pterostichus melanarius',
    role: 'Fast pursuit predator with hard elytra. Chases ants down; retreats to cover when hurt.',
    length: 16,
    hp: 150,
    armor: 3,
    speed: 30,
    bite: 9,
    attackInterval: 1.1,
    sense: 55,
    strength: 14,
    relation: 'hostile',
    food: 40,
    mass: 16,
    fleeAt: 0.3,
    nocturnal: true,
    wild: 2,
    ai: 'hunter',
    facts: ['Pterostichus melanarius is an important natural predator of slugs and pests in farmland.', 'Ground beetles spray defensive chemicals from glands at the tip of the abdomen.', 'Many carabids have fused elytra and cannot fly at all.'],
  }),
  wolfSpider: K({
    id: 'wolfSpider',
    name: 'Ground wolf spider',
    sci: 'Trochosa terricola',
    role: 'Stalks, freezes, then pounces and eats an ant. Flees when badly hurt.',
    length: 12,
    hp: 140,
    armor: 1,
    speed: 22,
    bite: 16,
    attackInterval: 1.4,
    venom: { dps: 1.5, duration: 5, maxStacks: 3 },
    sense: 75,
    strength: 12,
    relation: 'hostile',
    food: 36,
    mass: 14,
    fleeAt: 0.3,
    wild: 2,
    ai: 'stalker',
    facts: ["Wolf spiders' large eyes have a reflective layer: at night their eyeshine can be seen by torchlight.", 'Wolf spiders hunt by sight and ambush rather than with webs.'],
  }),
  lithobius: K({
    id: 'lithobius',
    name: 'Brown stone centipede',
    sci: 'Lithobius forficatus',
    role: 'Very fast striker with venom claws. Darts between cover; flees into it when hurt.',
    length: 25,
    hp: 110,
    armor: 1,
    speed: 42,
    bite: 7,
    attackInterval: 0.9,
    venom: { dps: 2, duration: 6, maxStacks: 4 },
    sense: 50,
    strength: 12,
    relation: 'hostile',
    food: 30,
    mass: 12,
    fleeAt: 0.35,
    nocturnal: true,
    wild: 1.5,
    maxTurn: 2.5,
    ai: 'centipede',
    facts: ['Lithobius hatch with only 7 pairs of legs and add more at each moult until they reach 15.', "A centipede's venom claws are actually its first pair of legs, modified into fangs."],
  }),
  rove: K({
    id: 'rove',
    name: "Devil's coach horse",
    sci: 'Ocypus olens',
    role: 'Aggressive rove beetle. Raises its tail like a scorpion before a powerful bite.',
    length: 26,
    hp: 180,
    armor: 2,
    speed: 26,
    bite: 20,
    attackInterval: 1.8,
    sense: 50,
    strength: 16,
    relation: 'hostile',
    food: 45,
    mass: 20,
    fleeAt: 0.25,
    nocturnal: true,
    wild: 1,
    ai: 'rove',
    facts: ["The devil's coach horse curls its tail up like a scorpion, though it has no sting.", 'It releases a foul-smelling chemical from glands at the abdomen tip when threatened.'],
  }),
  mantis: K({
    id: 'mantis',
    name: 'European mantis',
    sci: 'Mantis religiosa',
    role: 'Ambush predator. Waits motionless, sways like a leaf, then snatches an ant and eats it.',
    length: 70,
    hp: 260,
    armor: 1,
    speed: 14,
    bite: 30,
    attackInterval: 2.4,
    sense: 45,
    strength: 30,
    relation: 'hostile',
    food: 90,
    mass: 60,
    fleeAt: 0.2,
    wild: 0.7,
    ai: 'mantis',
    facts: ['A mantis can rotate its head almost 180°; few insects can do that.', 'The black eyespot inside its forelegs is a key feature of Mantis religiosa.', 'Mantises sway to judge distance: the motion gives them depth cues.'],
  }),
  antlion: K({
    id: 'antlion',
    name: 'Antlion larva',
    sci: 'Myrmeleon formicarius',
    role: 'Trap: a sand pit that drags ants to the jaws waiting at the bottom. Swarm it to dig it out.',
    length: 14,
    hp: 90,
    armor: 2,
    speed: 0,
    bite: 12,
    attackInterval: 1.2,
    sense: 16,
    strength: 40,
    relation: 'hostile',
    food: 24,
    mass: 10,
    fleeAt: 0,
    wild: 1,
    ai: 'antlion',
    facts: ['An antlion larva has no anus; waste is stored until it pupates.', 'Antlion pits are built at the angle of repose: any extra weight makes the wall collapse.', 'The adult is a delicate winged insect resembling a damselfly.'],
  }),
  spiderling: K({
    id: 'spiderling',
    name: 'Wolf spiderling',
    sci: 'Hogna carolinensis (young)',
    role: 'Young wolf spider dropped from its mother’s back. Small but quick to bite.',
    length: 5,
    hp: 22,
    armor: 0,
    speed: 26,
    bite: 3,
    attackInterval: 0.9,
    sense: 45,
    strength: 3,
    relation: 'hostile',
    food: 5,
    mass: 2,
    fleeAt: 0,
    wild: 0,
    ai: 'spiderling',
    facts: ['Spiderlings ride on their mother’s abdomen for about a week before dispersing.'],
  }),
  // ---------------------------------------------------------------- bosses
  stagBeetle: K({
    id: 'stagBeetle',
    name: 'European stag beetle',
    sci: 'Lucanus cervus',
    role: 'BOSS. Plods on through the swarm, grabs and tosses ants with its antlers, rears and slams when enraged.',
    length: 100,
    hp: 2600,
    armor: 6,
    speed: 9,
    bite: 26,
    attackInterval: 2.2,
    sense: 90,
    strength: 140,
    relation: 'hostile',
    food: 400,
    mass: 300,
    fleeAt: 0,
    boss: true,
    wild: 0,
    ai: 'stag',
    facts: ['Male stag beetles use their antler mandibles to wrestle and throw rivals off branches.', 'Stag beetle larvae spend 3 to 7 years underground feeding on decaying wood.', 'Adult stag beetles live only a few weeks and feed mostly on sap.'],
  }),
  tarantula: K({
    id: 'tarantula',
    name: 'Mexican red-knee tarantula',
    sci: 'Brachypelma hamorii',
    role: 'BOSS. Rears up and strikes down with its fangs, flicks clouds of urticating hairs, then lunges in a frenzy.',
    length: 90,
    hp: 2200,
    armor: 3,
    speed: 12,
    bite: 40,
    attackInterval: 2.6,
    venom: { dps: 3, duration: 8, maxStacks: 3 },
    sense: 80,
    strength: 110,
    relation: 'hostile',
    food: 350,
    mass: 250,
    fleeAt: 0,
    boss: true,
    wild: 0,
    ai: 'tarantula',
    facts: ['New World tarantulas defend themselves by flicking barbed urticating hairs from their abdomen.', 'Female red-knee tarantulas can live 25 to 30 years.', "Tarantulas' fangs strike downward, not pinching sideways like most spiders."],
  }),
  scolopendra: K({
    id: 'scolopendra',
    name: 'Megarian banded centipede',
    sci: 'Scolopendra cingulata',
    role: 'BOSS. Coils and strikes with venom claws, whips its body through the swarm, coils round clusters when enraged.',
    length: 180,
    hp: 2000,
    armor: 3,
    speed: 30,
    bite: 22,
    attackInterval: 1.4,
    venom: { dps: 3, duration: 8, maxStacks: 5 },
    sense: 90,
    strength: 120,
    relation: 'hostile',
    food: 320,
    mass: 200,
    fleeAt: 0,
    boss: true,
    wild: 0,
    maxTurn: 1.8,
    ai: 'scolopendra',
    facts: ['Scolopendra hunt insects, spiders and even small lizards using venom that acts in seconds.', 'The long rear legs can pinch and are held up to look like a second head.'],
  }),
  giantMantis: K({
    id: 'giantMantis',
    name: 'Giant Asian mantis',
    sci: 'Hierodula membranacea',
    role: 'BOSS. Sways almost invisible, then sweeps a long strike cone; flares its wings to stun the swarm.',
    length: 130,
    hp: 2000,
    armor: 2,
    speed: 16,
    bite: 60,
    attackInterval: 3,
    sense: 85,
    strength: 100,
    relation: 'hostile',
    food: 300,
    mass: 220,
    fleeAt: 0,
    boss: true,
    wild: 0,
    ai: 'giantMantis',
    facts: ['Large mantises are known to catch small birds and lizards, though this is rare.', 'Hierodula are called giant Asian mantises and are among the bulkiest mantis species.'],
  }),
  hogna: K({
    id: 'hogna',
    name: 'Carolina wolf spider (mother)',
    sci: 'Hogna carolinensis',
    role: 'BOSS. Stalks and pounces; when hurt, her spiderlings scatter and attack; at the end she sprints in a frenzy.',
    length: 45,
    hp: 1800,
    armor: 2,
    speed: 34,
    bite: 34,
    attackInterval: 1.6,
    venom: { dps: 2.5, duration: 6, maxStacks: 4 },
    sense: 100,
    strength: 80,
    relation: 'hostile',
    food: 260,
    mass: 160,
    fleeAt: 0,
    boss: true,
    wild: 0,
    ai: 'hogna',
    facts: ['Mother wolf spiders carry their spiderlings on their backs for about a week after hatching.', 'Hogna carolinensis is the largest wolf spider in North America.'],
  }),
};

export function creatureKind(id: string): CreatureKind {
  return CREATURES[id];
}

/** Kinds the ecosystem spawns in the wild, with their weights. */
export function wildKinds(): Array<{ id: string; w: number }> {
  return Object.values(CREATURES)
    .filter((k) => k.wild > 0)
    .map((k) => ({ id: k.id, w: k.wild }));
}
