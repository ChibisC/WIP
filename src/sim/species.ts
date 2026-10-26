import { BALANCE, ECITON, NASUTE, SICKLE, TERMANT, Tier } from './balance';
import { TERMITE_ROYALS } from './termiteRoyalData';
/**
 * Species and caste definitions (pure data, shared by sim and UI).
 * Numbers are game-balance values loosely anchored to real body size and behaviour.
 */
export type SpeciesId = 'lasius' | 'formica' | 'atta' | 'solenopsis' | 'eciton' | 'plagiaria' | 'nasutitermes' | 'rhynchotermes' | 'hell' | 'aurimyrmex' | 'termant';
export type Role = 'worker' | 'soldier' | 'major' | 'queen' | 'minim' | 'king';
/** `pure` ignores armour (the nasute's glue stream) */
export type DamageType = 'bite' | 'acid' | 'sting' | 'pure';

/**
 * In-game display names that may change later live here (one value each).
 * Saiy-Ants: the user's nickname for Aurimyrmex fulgurans; fallback "Gilded Ants".
 */
export const SPECIES_DISPLAY_NAME: Partial<Record<SpeciesId, string>> = {
  aurimyrmex: 'Saiy-Ants',
  /** the user's name for the ant–termite hybrid (the brief said "Termyrms"); fallback "Chimera Ants" */
  termant: 'Termants',
};
export const SAIY_FALLBACK_NAME = 'Gilded Ants';
export const TERMANT_FALLBACK_NAME = 'Chimera Ants';

export interface CasteDef {
  id: string;
  species: SpeciesId;
  name: string;
  role: Role;
  morph: string;
  /** body length mm */
  length: number;
  /** walking speed mm/s */
  speed: number;
  hp: number;
  /** melee damage per bite */
  bite: number;
  /** seconds between attacks */
  attackInterval: number;
  armor: number;
  /** load capacity in food units */
  carry: number;
  /** strength used for grappling / dragging */
  grip: number;
  /** body mass used for knockback/drag */
  mass: number;
  /** venom stacks applied per sting (fire ants, Eciton, Atta workers weakly) */
  sting?: { dps: number; duration: number; maxStacks: number };
  /**
   * Formic acid (formicines). `opener`: a short spray as the ant closes in,
   * then it bites; `lob`: arcing mortar shots from long range (splash at
   * level 3); `rapid`: fast short jets from mid range (slows at level 3).
   * Shooters (lob, rapid) hold their distance instead of closing in.
   */
  acid?: { range: number; damage: number; cooldown: number; kind?: 'opener' | 'lob' | 'rapid' | 'ramp' };
  /** how strongly enemies prefer to attack this ant (tanks draw attacks), 0 = normal */
  threat?: number;
  /**
   * Termite caste (Nasute Termites, sim/termites.ts): workers only bite back,
   * nasutes fire the ramping glue stream (acid kind 'ramp'), majors charge,
   * glue-root and raise the alarm, the king guards the royal chamber. Sickle-Jaw
   * soldiers (`sickle`) grab and squirt (sim/sickleJaws.ts).
   */
  termite?: 'worker' | 'nasute' | 'major' | 'sickle' | 'king' | 'queen';
  /**
   * Hell ant heavy attack (sim/hellAnts.ts): the vertical mandible snap pins
   * small prey against the horn (`pin`, damage over time) or drives it onto
   * the soldier's hardened paddle (`impale`, burst then hold).
   */
  snap?: { kind: 'pin' | 'impale'; windup: number; dps: number; hold: number; cooldown: number; maxPreyMass: number; burst?: number };
  /** Saiy-Ants: can flash into the gold surge (sim/surge.ts) */
  surge?: boolean;
  /** Termants: may gather dead wood (stored apart and digested slowly into food; sim/termants.ts) */
  wood?: boolean;
  /** Termant soldier: the point-blank glue burst from the frontal pore (sim/termants.ts) */
  glue?: { cooldown: number; slow: number; slowMul: number; damage: number; range: number };
  /** army-ant porter (submajor): carries loads slung under the body, prefers big items, leads team carries (sim/eciton.ts) */
  porter?: boolean;
  /** army-ant Soldier (major): its hooked mandibles lock on after a bite (sim/eciton.ts) */
  hook?: { hold: number; softBonus: number; dislodge: number };
  forage: boolean;
  dig: boolean;
  nurse: boolean;
  cutLeaves?: boolean;
  tendAphids?: boolean;
  garden?: boolean;
  /** food cost of raising one */
  cost: number;
  /** development time multiplier (egg+larva+pupa) */
  devTime: number;
  /** population slots used */
  pop: number;
  /** formicines spin cocoons; myrmicines/dorylines have naked pupae */
  cocoon: boolean;
  fact: string;
  /** nanitic: the queen's small first-brood worker (raised only on queen tiles) */
  nanitic?: boolean;
  /** render scale relative to the morph (nanitics are smaller) */
  scale?: number;
}

export interface SpeciesDef {
  id: SpeciesId;
  common: string;
  scientific: string;
  blurb: string;
  queen: string;
  castes: string[];
  /** default caste ratio weights */
  ratio: Record<string, number>;
  startWorkers: number;
  /** seconds between eggs at base rate (unused since 2026-10-25: the queen always has an egg ready, colony.queenLay) */
  eggInterval: number;
  traits: string[];
  /** colour used in UI/minimap */
  color: string;
  /** fictional species flag */
  fictional?: boolean;
  /** extinct species (fossil reconstruction) */
  extinct?: boolean;
  /** not an ant: termites eat wood, have a king, no pupae */
  kind?: 'termite';
  /** the king caste (termites): lives in the royal chamber with the queen */
  king?: string;
  /** what the colony's stores hold (UI wording): default "food"; both termites share one plant-material store */
  resource?: 'wood' | 'plant matter';
}

const C = (c: CasteDef) => c;

export const CASTES: Record<string, CasteDef> = {
  // ---- Lasius niger ----
  lasius_worker: C({
    id: 'lasius_worker', species: 'lasius', name: 'Worker', role: 'worker', morph: 'lasius_worker', length: 4, speed: 16,
    hp: 16, bite: 2.6, attackInterval: 0.9, armor: 0, carry: 3, grip: 1, mass: 1, forage: true, dig: true, nurse: true, tendAphids: true,
    acid: { range: 6, damage: 1.5, cooldown: 5, kind: 'opener' },
    cost: 6, devTime: 1, pop: 1, cocoon: true, fact: 'Lasius niger workers move from nursing to foraging as they age.',
  }),
  lasius_soldier: C({
    id: 'lasius_soldier', species: 'lasius', name: 'Soldier', role: 'soldier', morph: 'lasius_soldier', length: 4.9, speed: 15,
    hp: 44, bite: 5, attackInterval: 0.9, armor: 1, carry: 4, grip: 2, mass: 1.8, forage: true, dig: true, nurse: false, tendAphids: true,
    acid: { range: 7, damage: 2.5, cooldown: 5, kind: 'opener' }, threat: 0.5,
    cost: 14, devTime: 1.2, pop: 1, cocoon: true,
    fact: 'Lasius niger has no true soldier caste, but its workers range from about 3 to 5 mm; the larger ones do more of the fighting.',
  }),
  lasius_queen: C({
    id: 'lasius_queen', species: 'lasius', name: 'Queen', role: 'queen', morph: 'lasius_queen', length: 8.5, speed: 6, hp: 600, bite: 3, attackInterval: 1.5,
    armor: 3, carry: 0, grip: 3, mass: 6, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: true,
    fact: 'A Lasius niger queen has lived over 28 years in captivity.',
  }),
  // ---- Formica rufa ----
  formica_worker: C({
    id: 'formica_worker', species: 'formica', name: 'Worker', role: 'worker', morph: 'formica_worker', length: 7, speed: 26,
    hp: 26, bite: 2.4, attackInterval: 1.0, armor: 1, carry: 5, grip: 2, mass: 2.4, forage: true, tendAphids: true, dig: true, nurse: true,
    acid: { range: 10, damage: 2, cooldown: 6, kind: 'opener' },
    cost: 9, devTime: 1.25, pop: 1, cocoon: true, fact: 'Red wood ants spray formic acid by curling the gaster forward between the legs, often after biting to open a wound.',
  }),
  formica_soldier: C({
    id: 'formica_soldier', species: 'formica', name: 'Soldier', role: 'soldier', morph: 'formica_soldier', length: 8.6, speed: 22,
    hp: 120, bite: 2.2, attackInterval: 1.1, armor: 3, carry: 6, grip: 4, mass: 4.2, forage: true, dig: true, nurse: false,
    threat: 2.5,
    cost: 20, devTime: 1.5, pop: 1, cocoon: true,
    fact: 'Formica rufa workers range from about 4.5 to 9 mm; the biggest, armoured workers wade into fights and soak up the enemy’s bites.',
  }),
  formica_mortar: C({
    id: 'formica_mortar', species: 'formica', name: 'Mortar', role: 'soldier', morph: 'formica_mortar', length: 7.6, speed: 20,
    hp: 20, bite: 1.2, attackInterval: 1.2, armor: 0, carry: 4, grip: 2, mass: 2.6, forage: true, dig: true, nurse: false,
    acid: { range: 56, damage: 12, cooldown: 1.25, kind: 'lob' },
    cost: 22, devTime: 1.5, pop: 1, cocoon: true,
    fact: 'Formica workers can squirt formic acid well beyond their own body length, aiming the jet by bending the gaster.',
  }),
  formica_rapid: C({
    id: 'formica_rapid', species: 'formica', name: 'Rapid Sprayer', role: 'soldier', morph: 'formica_rapid', length: 7.2, speed: 22,
    hp: 20, bite: 1.2, attackInterval: 1.2, armor: 0, carry: 4, grip: 2, mass: 2.4, forage: true, dig: true, nurse: false,
    acid: { range: 32, damage: 3, cooldown: 0.22, kind: 'rapid' },
    cost: 22, devTime: 1.5, pop: 1, cocoon: true,
    fact: 'Formic acid is a nerve and respiratory poison to insects; wood ants also use it as a disinfectant on their nestmates.',
  }),
  formica_queen: C({
    id: 'formica_queen', species: 'formica', name: 'Queen', role: 'queen', morph: 'formica_queen', length: 10.5, speed: 8, hp: 800, bite: 5, attackInterval: 1.4,
    armor: 4, carry: 0, grip: 4, mass: 9, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: true,
    fact: 'Red wood ant nests often have many queens and can hold hundreds of thousands of workers.',
  }),
  // ---- Atta cephalotes ----
  atta_minim: C({
    id: 'atta_minim', species: 'atta', name: 'Minim', role: 'minim', morph: 'atta_minim', length: 2, speed: 11, hp: 6, bite: 0.8, attackInterval: 0.9,
    armor: 0, carry: 0.8, grip: 0.5, mass: 0.3, forage: true, dig: true, nurse: true, garden: true,
    cost: 2, devTime: 0.6, pop: 0.5, cocoon: false, fact: 'Atta minims ride on carried leaves to guard against parasitic phorid flies.',
  }),
  atta_media: C({
    id: 'atta_media', species: 'atta', name: 'Media', role: 'worker', morph: 'atta_media', length: 8, speed: 17, hp: 22, bite: 3, attackInterval: 1,
    armor: 1, carry: 3, grip: 2, mass: 2.2, forage: true, dig: true, nurse: true, cutLeaves: true,
    cost: 8, devTime: 1, pop: 1, cocoon: false, fact: 'Leafcutters cut leaf fragments sized to their body and carry them upright over their heads.',
  }),
  atta_soldier: C({
    id: 'atta_soldier', species: 'atta', name: 'Soldier', role: 'soldier', morph: 'atta_soldier', length: 10.5, speed: 16, hp: 62, bite: 7, attackInterval: 1.0,
    armor: 2, carry: 3, grip: 3, mass: 3, forage: true, dig: true, nurse: false, threat: 0.5,
    cost: 16, devTime: 1.3, pop: 1, cocoon: false,
    fact: 'Atta workers come in a continuous range of sizes; mid-sized workers patrol the foraging trails and attack intruders.',
  }),
  atta_major: C({
    id: 'atta_major', species: 'atta', name: 'Major', role: 'major', morph: 'atta_major', length: 14, speed: 12, hp: 220, bite: 16, attackInterval: 1.4,
    armor: 4, carry: 6, grip: 7, mass: 12, forage: true, dig: false, nurse: false,
    cost: 45, devTime: 2, pop: 3, cocoon: false, fact: 'Atta majors have mandibles sharp enough to slice skin; they guard trails and the nest.',
  }),
  atta_queen: C({
    id: 'atta_queen', species: 'atta', name: 'Queen', role: 'queen', morph: 'atta_queen', length: 21, speed: 5, hp: 1200, bite: 6, attackInterval: 1.6,
    armor: 5, carry: 0, grip: 6, mass: 25, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: false,
    fact: 'An Atta queen can live over 20 years and found a colony of millions.',
  }),
  // ---- Solenopsis geminata (tropical fire ant) ----
  fire_minor: C({
    id: 'fire_minor', species: 'solenopsis', name: 'Worker', role: 'worker', morph: 'fire_minor', length: 2.8, speed: 15, hp: 8, bite: 0.8, attackInterval: 0.8,
    armor: 0, carry: 2.5, grip: 1, mass: 0.6, forage: true, tendAphids: true, dig: true, nurse: true,
    sting: { dps: 1.2, duration: 6, maxStacks: 12 },
    cost: 3, devTime: 0.7, pop: 0.6, cocoon: false, fact: 'Fire ants grip with their mandibles, then pivot and sting repeatedly in a circle.',
  }),
  fire_soldier: C({
    id: 'fire_soldier', species: 'solenopsis', name: 'Soldier', role: 'soldier', morph: 'fire_minor', scale: 4 / 2.8, length: 4, speed: 14, hp: 16, bite: 1.4, attackInterval: 0.8,
    armor: 0.5, carry: 3, grip: 1.5, mass: 1, forage: true, dig: true, nurse: false, threat: 0.4,
    sting: { dps: 1.6, duration: 6, maxStacks: 12 },
    cost: 6, devTime: 0.85, pop: 0.8, cocoon: false, fact: 'Tropical fire ant workers run from about 3 to 8 mm; the mid-sized ones are quick to sting anything that disturbs the mound.',
  }),
  fire_major: C({
    id: 'fire_major', species: 'solenopsis', name: 'Major', role: 'major', morph: 'fire_major', length: 6, speed: 11, hp: 75, bite: 6, attackInterval: 1.2,
    armor: 2, carry: 5, grip: 3, mass: 3, forage: true, dig: true, nurse: false, threat: 0.8,
    sting: { dps: 1.8, duration: 7, maxStacks: 12 },
    cost: 14, devTime: 1.3, pop: 1.5, cocoon: false, fact: 'Solenopsis geminata majors have huge square heads and blunt mandibles built for milling seeds, which the colony stores in granaries.',
  }),
  fire_queen: C({
    id: 'fire_queen', species: 'solenopsis', name: 'Queen', role: 'queen', morph: 'fire_queen', length: 8, speed: 6, hp: 500, bite: 2, attackInterval: 1.4,
    armor: 3, carry: 0, grip: 2, mass: 5, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: false,
    fact: 'Solenopsis geminata is native to the Americas and has spread across the tropics on ships for centuries.',
  }),
  // ---- Eciton burchellii (army ant; claude/army-ants plan Step 1) ----
  eciton_minor: C({
    id: 'eciton_minor', species: 'eciton', name: 'Worker', role: 'worker', morph: 'eciton_minor', length: 4, speed: 30, hp: 14, bite: 2.0, attackInterval: 0.8,
    armor: 0, carry: 2, grip: 2, mass: 1, forage: true, dig: false, nurse: true,
    sting: { dps: 0.8, duration: 4, maxStacks: 6 },
    cost: 5, devTime: 0.9, pop: 1, cocoon: true, fact: 'Eciton workers have eyes reduced to a single facet and find their way by pheromones. They plug potholes in the trail with their own bodies and link up into living bridges.',
  }),
  eciton_submajor: C({
    id: 'eciton_submajor', species: 'eciton', name: 'Porter', role: 'worker', morph: 'eciton_submajor', length: 6.5, speed: 33, hp: 24, bite: 3.2, attackInterval: 0.9,
    armor: 0, carry: 5, grip: 3, mass: 2, forage: true, dig: false, nurse: false, porter: true,
    sting: { dps: 0.96, duration: 4, maxStacks: 6 },
    cost: 9, devTime: 1.1, pop: 1, cocoon: true, fact: 'Porters are only about 3 % of an Eciton colony, but their long legs leave room to carry big prey slung under the body, and they lead the teams that carry the biggest items.',
  }),
  eciton_media: C({
    id: 'eciton_media', species: 'eciton', name: 'Media', role: 'soldier', morph: 'eciton_media', length: 8, speed: 27, hp: 40, bite: 5.5, attackInterval: 1.0,
    armor: 1, carry: 2, grip: 4, mass: 3.2, forage: true, dig: false, nurse: false,
    sting: { dps: 1.2, duration: 5, maxStacks: 4 },
    cost: 14, devTime: 1.25, pop: 1.2, cocoon: true, fact: 'Medias are the mid-sized army-ant workers: they escort the raid columns and help carry large prey in teams.',
  }),
  eciton_major: C({
    id: 'eciton_major', species: 'eciton', name: 'Soldier', role: 'major', morph: 'eciton_major', length: 11, speed: 24, hp: 70, bite: 11, attackInterval: 1.1,
    armor: 2, carry: 0, grip: 6, mass: 7, forage: false, dig: false, nurse: false, hook: ECITON.hook,
    sting: { dps: 1.5, duration: 5, maxStacks: 4 },
    cost: 30, devTime: 1.6, pop: 2, cocoon: true, fact: 'Eciton soldiers serve almost only as defence: they stand along the raid columns with their long hooked mandibles open and never carry food.',
  }),
  eciton_queen: C({
    id: 'eciton_queen', species: 'eciton', name: 'Queen', role: 'queen', morph: 'eciton_queen', length: 22, speed: 8, hp: 1000, bite: 4, attackInterval: 1.5,
    armor: 4, carry: 0, grip: 5, mass: 20, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: true,
    fact: 'The wingless Eciton queen lays a burst of 100 000 to 300 000 eggs every few weeks, her abdomen swollen with them.',
  }),
  // ---- Formica plagiaria (fictional custom colony) ----
  plagiaria_worker: C({
    id: 'plagiaria_worker', species: 'plagiaria', name: 'Worker', role: 'worker', morph: 'plagiaria_worker', length: 6.5, speed: 22,
    hp: 20, bite: 3, attackInterval: 0.9, armor: 1, carry: 3, grip: 2, mass: 2, forage: true, dig: true, nurse: true,
    acid: { range: 10, damage: 2.5, cooldown: 3.5 },
    cost: 9, devTime: 1.1, pop: 1, cocoon: true,
    fact: 'Fictional species modelled on Formica sanguinea, a real ant that raids other nests for brood and raises it as its workforce.',
  }),
  plagiaria_queen: C({
    id: 'plagiaria_queen', species: 'plagiaria', name: 'Queen', role: 'queen', morph: 'plagiaria_queen', length: 10, speed: 8, hp: 750, bite: 4, attackInterval: 1.4,
    armor: 4, carry: 0, grip: 4, mass: 8, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: true,
    fact: 'Slave-making queens often found colonies by invading a host nest and killing its queen.',
  }),
  // ---- Nasutitermes corniger (Nasute Termites; docs/creatures/nasutitermes.md) ----
  // Stats are NASUTE multipliers × the baseline Black Garden Ant worker (hp 16, 16 mm/s, 2.89 bite dps).
  nasute_worker: C({
    id: 'nasute_worker', species: 'nasutitermes', name: 'Worker', role: 'worker', morph: 'termite_worker', termite: 'worker',
    length: 4.2, // model kit v2.2 (was 5.5); drawn male 3.9 / female 4.5 by `variant`
    speed: 12.8, // × 0.8
    hp: 11.2, // × 0.7 (females +10 %)
    bite: 0.87, attackInterval: 1.0, // 0.87 dps = × 0.3, last resort only
    armor: 0, carry: 3, grip: 1, mass: 0.9, forage: true, dig: true, nurse: true,
    cost: 6, devTime: 1, pop: 1, cocoon: false,
    fact: 'Nasutitermes workers are blind, creamy and soft; the dark wood they have eaten shows through the abdomen. Large workers are female, small ones male.',
  }),
  nasute_soldier: C({
    id: 'nasute_soldier', species: 'nasutitermes', name: 'Nasute', role: 'soldier', morph: 'termite_nasute', termite: 'nasute',
    length: 5, speed: 13.6, // × 0.85
    hp: 12.8, // × 0.8
    bite: 0.3, attackInterval: 1.2, armor: 0, carry: 2, grip: 0.6, mass: 0.8, forage: true, dig: false, nurse: false, // gathers like an ant soldier (user note 2026-10-25)
    // the ramping glue stream: range 5 body lengths; damage per tick comes from NASUTE.ramp (sim/termites.ts)
    acid: { range: 5 * NASUTE.ramp.rangeBodyLengths, damage: 0, cooldown: 0, kind: 'ramp' }, threat: 0.3,
    cost: 10, devTime: 1.3, pop: 1, cocoon: false,
    fact: 'A nasute squirts sticky, noxious terpenes from the cone on its head (the nasus). Its mandibles are mere points: it cannot bite, and workers must feed it.',
  }),
  nasute_major: C({
    id: 'nasute_major', species: 'nasutitermes', name: 'Major', role: 'major', morph: 'termite_major', termite: 'major',
    length: 6.5, speed: 12, // × 0.75
    hp: 48, // × 3
    bite: 4.33, attackInterval: 1.0, // 4.33 dps = × 1.5
    armor: 1, carry: 3, grip: 3, mass: 3, forage: true, dig: false, nurse: false, threat: 1.5, // gathers like an ant soldier (user note 2026-10-25)
    cost: 21, devTime: 1.8, pop: 1, cocoon: false,
    fact: 'Gameplay caste borrowed from dimorphic nasutes such as N. longinasus: a bigger, broader, darker head with a short, thick nasus for ramming and point-blank glue.',
  }),
  nasute_king: C({
    id: 'nasute_king', species: 'nasutitermes', name: 'King', role: 'king', morph: 'termite_king', termite: 'king',
    length: TERMITE_ROYALS.king.length, // model kit v2.1: ~1.45 × a worker (8.4 mm)
    speed: 6, hp: 64, // × 4 (he takes no damage: isKing)
    bite: 1.44, attackInterval: 1.0, // × 0.5: kings bite weakly (user note 2026-10-25)
    armor: 2, carry: 0, grip: 3, mass: 3, forage: false, dig: false, nurse: false,
    cost: 0, devTime: 1, pop: 0, cocoon: false,
    fact: 'Termite colonies have a king as well as a queen. He stays in the royal chamber and mates with her for life; while she lives the workers shield him.',
  }),
  nasute_queen: C({
    id: 'nasute_queen', species: 'nasutitermes', name: 'Queen', role: 'queen', morph: 'termite_queen', termite: 'queen',
    length: TERMITE_ROYALS.queen.length, // model kit v2.1: 25 mm, 22 mm of it physogastric abdomen behind her thorax
    speed: 0.5, hp: 600, bite: 3, attackInterval: 1.5, // HP and bite as the Black Garden Ant queen
    armor: 3, carry: 0, grip: 3, mass: 25, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: false,
    fact: 'Her abdomen swells until the dark plates sit far apart on white membrane; she can lay about 3,000 eggs a day and may live 25 years.',
  }),
  // ---- Rhynchotermes perarmatus (Sickle-Jaw Termites; docs/creatures/rhynchotermes-perarmatus.md) ----
  // Stats are SICKLE multipliers × the baseline Black Garden Ant worker (hp 16, 16 mm/s, 2.89 bite dps).
  rhy_worker: C({
    id: 'rhy_worker', species: 'rhynchotermes', name: 'Worker', role: 'worker', morph: 'termite_rhy_worker', termite: 'worker',
    length: 5.8, // larger than the soldier
    speed: 12.8, // × 0.8
    hp: 12, // × 0.75
    bite: 0.87, attackInterval: 1.0, // 0.87 dps = × 0.3, last resort only
    armor: 0, carry: 3, grip: 1, mass: 1, forage: true, dig: true, nurse: true,
    cost: 6, devTime: 1, pop: 1, cocoon: false,
    fact: 'Sickle-jaw workers are stout, blind and soft, with a transparent abdomen full of dark leaf litter and a whitish spot (the fontanelle) on the head.',
  }),
  rhy_soldier: C({
    id: 'rhy_soldier', species: 'rhynchotermes', name: 'Sickle-jaw', role: 'soldier', morph: 'termite_rhy_soldier', termite: 'sickle',
    length: 4.5, speed: 14.4, // × 0.9
    hp: 12.8, // × 0.8
    bite: SICKLE.grab.biteDamage, attackInterval: SICKLE.acid.freeTargetBiteInterval, armor: 0, carry: 2, grip: 3, mass: 0.8,
    forage: true, dig: false, nurse: false, threat: 0.6, // gathers like an ant soldier (user note 2026-10-25)
    cost: 10, devTime: 1.4, pop: 1, cocoon: false,
    fact: 'A sickle-jaw soldier hooks an enemy between its crossed, fishhook mandibles and holds on, then presses the open tip of its long snout against it to smear its secretion. Smaller than the workers it guards.',
  }),
  rhy_king: C({
    id: 'rhy_king', species: 'rhynchotermes', name: 'King', role: 'king', morph: 'termite_rhy_king', termite: 'king',
    length: TERMITE_ROYALS.rhy_king.length, // model kit v2.1: 8.5 mm body, 8.9 with mandibles
    speed: 6, hp: 64, // × 4 (he takes no damage: isKing)
    bite: 1.44, attackInterval: 1.0, // × 0.5: kings bite weakly (user note 2026-10-25)
    armor: 2, carry: 0, grip: 3, mass: 3, forage: false, dig: false, nurse: false,
    cost: 0, devTime: 1, pop: 0, cocoon: false,
    fact: 'He stays in the royal chamber beside the queen for life. His colours are a reconstruction: no description of this species\' reproductives was found.',
  }),
  rhy_queen: C({
    id: 'rhy_queen', species: 'rhynchotermes', name: 'Queen', role: 'queen', morph: 'termite_rhy_queen', termite: 'queen',
    length: TERMITE_ROYALS.rhy_queen.length, // model kit v2.1: 26 mm, 22.5 of it physogastric abdomen
    speed: 0.5, hp: 600, bite: 3, attackInterval: 1.5, // as the other queens
    armor: 3, carry: 0, grip: 3, mass: 25, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: false,
    fact: 'Her abdomen swells into a pale, pleated sausage with the old back plates left as small dark bars; workers pull each egg from its tip.',
  }),
  // ---- Hell ants (Haidomyrmecinae; docs/creatures/hell-ant.md) ----
  hell_worker: C({
    id: 'hell_worker', species: 'hell', name: 'Worker', role: 'worker', morph: 'hell_worker', length: 5, speed: 19, hp: 20, bite: 2.2, attackInterval: 1.0,
    armor: 0, carry: 2.5, grip: 1.5, mass: 1.3, forage: true, dig: true, nurse: true,
    sting: { dps: 1.0, duration: 5, maxStacks: 6 },
    snap: { kind: 'pin', windup: 0.6, dps: 3.5, hold: 4, cooldown: 5, maxPreyMass: 2.2 },
    cost: 8, devTime: 1.2, pop: 1, cocoon: true,
    fact: 'Modelled on Ceratomyrmex ellenbergeri (4.5–5.9 mm, Kachin amber, ~99 Ma). One fossil was caught holding a cockroach-relative nymph between its upswung jaws and horn. Colours are a reconstruction.',
  }),
  hell_soldier: C({
    id: 'hell_soldier', species: 'hell', name: 'Soldier', role: 'soldier', morph: 'hell_soldier', length: 6.5, speed: 17, hp: 58, bite: 4, attackInterval: 1.1,
    armor: 2, carry: 3, grip: 3, mass: 2.8, forage: true, dig: true, nurse: false, threat: 1.2,
    sting: { dps: 1.4, duration: 6, maxStacks: 6 },
    snap: { kind: 'impale', windup: 0.8, burst: 14, dps: 2, hold: 3, cooldown: 7, maxPreyMass: 3.5 },
    cost: 18, devTime: 1.5, pop: 1, cocoon: true,
    fact: 'Gameplay caste modelled on Linguamyrmex: its flattened clypeal paddle had a dense core, probably reinforced with sequestered metals. No real hell ant had a soldier caste, and impaling is the game’s exaggeration of “pin and perhaps puncture”.',
  }),
  hell_queen: C({
    id: 'hell_queen', species: 'hell', name: 'Queen', role: 'queen', morph: 'hell_queen', length: 7.6, speed: 7, hp: 650, bite: 4, attackInterval: 1.4,
    armor: 3, carry: 0, grip: 3, mass: 7, forage: false, dig: false, nurse: false,
    sting: { dps: 1.2, duration: 5, maxStacks: 4 },
    cost: 0, devTime: 1, pop: 0, cocoon: true,
    fact: 'Haidomyrmex cerberus queens (winged and dealate) are known from amber: larger than workers, with smaller eyes, a longer scape and serrated mandibles (Guo et al. 2021).',
  }),
  // ---- Aurimyrmex fulgurans (fictional "Saiy-Ants"; docs/creatures/aurimyrmex-fulgurans.md) ----
  aurimyrmex_worker: C({
    id: 'aurimyrmex_worker', species: 'aurimyrmex', name: 'Worker', role: 'worker', morph: 'saiy_worker', length: 6, speed: 22, hp: 22, bite: 2.4, attackInterval: 1.0,
    armor: 0.5, carry: 4, grip: 2, mass: 1.8, forage: true, dig: true, nurse: true,
    surge: true, // no acid (the user's design): Saiy-Ants fight with bites only
    cost: 8, devTime: 1.15, pop: 1, cocoon: true,
    fact: 'Fictional species. Inspired by the golden tortoise beetle, whose shell can switch between metallic gold and dull red when it is disturbed.',
  }),
  aurimyrmex_soldier: C({
    id: 'aurimyrmex_soldier', species: 'aurimyrmex', name: 'Soldier', role: 'soldier', morph: 'saiy_soldier', length: 9, speed: 19, hp: 85, bite: 6, attackInterval: 1.2,
    armor: 2.5, carry: 5, grip: 4, mass: 4.5, forage: true, dig: true, nurse: false, threat: 2,
    surge: true,
    cost: 20, devTime: 1.5, pop: 1, cocoon: true,
    fact: 'A major worker: the same body plan with a broad, square head full of jaw muscle. Carpenter ant majors crush seeds and enemies alike.',
  }),
  aurimyrmex_queen: C({
    id: 'aurimyrmex_queen', species: 'aurimyrmex', name: 'Queen', role: 'queen', morph: 'saiy_queen', length: 14, speed: 7, hp: 900, bite: 5, attackInterval: 1.4,
    armor: 4, carry: 0, grip: 5, mass: 14, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: true,
    fact: 'The queen keeps her reflective layers dry: she never transforms, and stays in the nest.',
  }),
  // ---- Termants (Chimaeromyrmex termitoides, fictional ant–termite hybrid; claude/termyrms plan Step 1) ----
  termant_worker: C({
    id: 'termant_worker', species: 'termant', name: 'Worker', role: 'worker', morph: 'termant_worker', length: 5, speed: 24, hp: 18, bite: 1.8, attackInterval: 1,
    armor: 1, carry: 4, grip: 2, mass: 1.6, forage: true, dig: true, nurse: true, wood: true,
    acid: { range: 9, damage: 2, cooldown: 6, kind: 'opener' },
    cost: 8, devTime: 1.2, pop: 1, cocoon: false,
    fact: 'Termant workers eat wood like termites and hunt like ants; the dark patch in the abdomen is wood in the gut.',
  }),
  termant_soldier: C({
    id: 'termant_soldier', species: 'termant', name: 'Soldier', role: 'soldier', morph: 'termant_soldier', length: 7, speed: 20, hp: 42, bite: 3.2, attackInterval: 1.1,
    armor: 2, carry: 2, grip: 3, mass: 3.2, forage: true, dig: false, nurse: false, glue: TERMANT.glue,
    cost: 20, devTime: 1.6, pop: 1, cocoon: false,
    fact: "The soldier's frontal pore sprays sticky glue, like a nasute termite's — but it still bites, like an ant.",
  }),
  termant_king: C({
    id: 'termant_king', species: 'termant', name: 'King', role: 'king', morph: 'termant_king', length: 7.5, speed: 7, hp: 160, bite: 1, attackInterval: 1.2, // weak bite; takes no damage (isKing)
    armor: 3, carry: 0, grip: 3, mass: 3.5, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: false,
    fact: 'Termite kings live for years beside the queen; ant males die after mating. A Termant king stays at his queen\'s side all his life.',
  }),
  termant_queen: C({
    id: 'termant_queen', species: 'termant', name: 'Queen', role: 'queen', morph: 'termant_queen', length: 12, speed: 5, hp: 800, bite: 3, attackInterval: 1.4,
    armor: 4, carry: 0, grip: 4, mass: 9, forage: false, dig: false, nurse: false, cost: 0, devTime: 1, pop: 0, cocoon: false,
    fact: 'A termite queen is fed and cleaned by workers all her life while her abdomen swells with eggs; Termants keep her that way, with the king always at her side.',
  }),
};

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  lasius: {
    id: 'lasius', common: 'Black Garden Ant', scientific: 'Lasius niger', queen: 'lasius_queen', castes: ['lasius_worker', 'lasius_soldier'],
    ratio: { lasius_worker: 0.85, lasius_soldier: 0.15 }, startWorkers: 8, eggInterval: 4.5, color: '#3a3330',
    blurb: 'Fast-breeding generalists. Workers tend aphids for bonus honeydew; larger soldiers back them up. They win by numbers.',
    traits: ['Fast breeding', 'Aphid farming (+honeydew)', 'Cheap soldiers'],
  },
  formica: {
    id: 'formica', common: 'Red Wood Ant', scientific: 'Formica rufa', queen: 'formica_queen', castes: ['formica_worker', 'formica_soldier', 'formica_mortar', 'formica_rapid'],
    ratio: { formica_worker: 0.6, formica_soldier: 0.15, formica_mortar: 0.12, formica_rapid: 0.13 }, startWorkers: 6, eggInterval: 7, color: '#a0482a',
    blurb: 'Acid army: tough soldiers hold the line while mortar and rapid sprayers rain formic acid from behind. Thatched mounds.',
    traits: ['Formic acid (armour-piercing)', 'Tank soldiers', 'Mortar and rapid-fire sprayers', 'Slow breeding'],
  },
  atta: {
    id: 'atta', common: 'Leafcutter Ant', scientific: 'Atta cephalotes', queen: 'atta_queen', castes: ['atta_minim', 'atta_media', 'atta_soldier', 'atta_major'],
    ratio: { atta_minim: 0.2, atta_media: 0.55, atta_soldier: 0.15, atta_major: 0.1 }, startWorkers: 8, eggInterval: 5, color: '#9a5524',
    blurb: 'Farmers: medias cut leaves, minims tend a fungus garden that feeds the colony; soldiers guard the trails and huge majors defend.',
    traits: ['Fungus garden economy', 'Widest caste range (4 castes)', 'Huge-headed majors'],
  },
  solenopsis: {
    id: 'solenopsis', common: 'Tropical Fire Ant', scientific: 'Solenopsis geminata', queen: 'fire_queen', castes: ['fire_minor', 'fire_soldier', 'fire_major'],
    ratio: { fire_minor: 0.7, fire_soldier: 0.2, fire_major: 0.1 }, startWorkers: 12, eggInterval: 3, color: '#8a3a1a',
    blurb: 'Tiny, numerous and quick to sting. Venom stacks melt big enemies; square-headed majors crush what the swarm pins down.',
    traits: ['Venom stacks (damage over time)', 'Huge numbers', 'Seed-milling majors'],
  },
  eciton: {
    id: 'eciton', common: 'Army Ant', scientific: 'Eciton burchellii', queen: 'eciton_queen', castes: ['eciton_minor', 'eciton_submajor', 'eciton_media', 'eciton_major'],
    ratio: { eciton_minor: 0.6, eciton_submajor: 0.2, eciton_media: 0.12, eciton_major: 0.08 }, startWorkers: 14, eggInterval: 3.5, color: '#9a6030',
    blurb: 'Nearly blind hunters that sweep the ground in fan-shaped swarm raids and eat only insects. Porters carry prey home under their bodies down the middle of the trail; hook-jawed Soldiers guard the column.',
    traits: ['Swarm raids', 'Fast, high-stepping', 'Living bridges', 'Soldiers guard the trail'],
  },
  plagiaria: {
    id: 'plagiaria', common: 'Gene Thief Ant', scientific: 'Formica plagiaria', queen: 'plagiaria_queen', castes: ['plagiaria_worker'],
    ratio: { plagiaria_worker: 1 }, startWorkers: 8, eggInterval: 5, color: '#7a2a20', fictional: true,
    blurb: 'Custom colony (fictional). Raises the brood of any species — pick the castes you want.',
    traits: ['Borrows any caste', 'Each borrowed caste needs its own chamber', 'Modelled on slave-making Formica sanguinea'],
  },
  nasutitermes: {
    id: 'nasutitermes', common: NASUTE.displayName, scientific: 'Nasutitermes corniger', queen: 'nasute_queen', king: 'nasute_king', kind: 'termite', resource: 'wood',
    castes: ['nasute_worker', 'nasute_soldier', 'nasute_major'],
    ratio: { nasute_worker: 0.8, nasute_soldier: 0.15, nasute_major: 0.05 }, startWorkers: 8, eggInterval: 4.5, color: '#c98a3e',
    blurb: 'Termites, not ants: blind wood-eaters with a king and queen. Nasute soldiers squirt a sticky glue stream that grows stronger the longer they hold a target; majors charge, glue enemies in place and drum the alarm.',
    traits: ['Wood economy (not insect food)', 'Ramping glue stream (pure damage)', 'Majors: charge, glue hold, alarm', 'A king guards the royal chamber'],
  },
  rhynchotermes: {
    id: 'rhynchotermes', common: SICKLE.displayName, scientific: 'Rhynchotermes perarmatus', queen: 'rhy_queen', king: 'rhy_king', kind: 'termite', resource: 'plant matter',
    castes: ['rhy_worker', 'rhy_soldier'],
    ratio: { rhy_worker: 0.82, rhy_soldier: 0.18 }, startWorkers: 8, eggInterval: 4.5, color: '#b8381e',
    blurb: 'Termites of the forest-floor leaf litter, Central America to Ecuador. Red-headed soldiers with long sickle jaws and a snout hook one enemy at a time, hold it fast and squirt it at point-blank range until it dies.',
    traits: ['Leaf litter and wood (plant matter)', 'Grab-and-squirt: the held enemy cannot move or fight', 'Acid ramps 2 → 18 DPS over 6 s', 'Bigger foes: bitten and squirted while free', 'A king guards the royal chamber'],
  },
  hell: {
    id: 'hell', common: 'Hell Ant', scientific: 'Haidomyrmecinae (Ceratomyrmex, Linguamyrmex, Haidomyrmex)', queen: 'hell_queen', extinct: true,
    castes: ['hell_worker', 'hell_soldier'],
    ratio: { hell_worker: 0.8, hell_soldier: 0.2 }, startWorkers: 7, eggInterval: 6, color: '#8a4a26',
    blurb: 'Cretaceous trap-jaw hunters (113–78 million years ago). Scythe mandibles snap upward against a horn to pin small prey; big “soldiers” drive it onto a hardened paddle. Hunters more than gatherers.',
    traits: ['Vertical snap pins small prey', 'Soldiers impale (burst damage)', 'Paralysing sting', 'Slow breeding'],
  },
  aurimyrmex: {
    id: 'aurimyrmex', common: SPECIES_DISPLAY_NAME.aurimyrmex ?? SAIY_FALLBACK_NAME, scientific: 'Aurimyrmex fulgurans', queen: 'aurimyrmex_queen', fictional: true,
    castes: ['aurimyrmex_worker', 'aurimyrmex_soldier'],
    ratio: { aurimyrmex_worker: 0.8, aurimyrmex_soldier: 0.2 }, startWorkers: 7, eggInterval: 5.5, color: '#d9a53a',
    blurb: 'Fictional carpenter-ant relatives whose glossy black cuticle flashes metallic gold for a few seconds when they fight: faster and harder-hitting, then exhausted while they recover.',
    traits: ['Gold surge: +50 % speed, +60 % damage for 4 s', '20 s recovery (dull, drooping antennae)', 'Bites only: no acid, no sting', 'The queen never transforms'],
  },
  termant: {
    id: 'termant', common: SPECIES_DISPLAY_NAME.termant ?? TERMANT_FALLBACK_NAME, scientific: 'Chimaeromyrmex termitoides', queen: 'termant_queen', king: 'termant_king', fictional: true,
    castes: ['termant_worker', 'termant_soldier'],
    ratio: { termant_worker: 0.85, termant_soldier: 0.15 }, startWorkers: 7, eggInterval: 5.5, color: '#b07a42',
    blurb: 'Custom colony (fictional). Half ant, half termite: eats the other species and raises their castes as its own, and digests dead wood. Ants and termites are only distantly related and cannot hybridize or share genes like this.',
    traits: ['Steals castes from eaten enemies (3 at a time)', 'Soldier glue burst; worker formic acid', 'Eats wood as well as prey', 'A king beside the one queen'],
  },
};

/** Termites (and anything else that is not an ant): wood economy, king, no pupae. */
export function isTermiteSpecies(sp: SpeciesId): boolean {
  return SPECIES[sp]?.kind === 'termite';
}

/** What the colony's stores hold, for UI text. */
export function resourceName(sp: SpeciesId): string {
  return SPECIES[sp]?.resource ?? 'food';
}

// ---- Nanitics: every species' queen raises small, weak first workers on her
// chamber tiles. Generated from the basic worker (same model, scaled down).
for (const sp of Object.keys(SPECIES) as SpeciesId[]) {
  const base = CASTES[basicCaste(sp)];
  const k = BALANCE.nanitic;
  CASTES[`${sp}_nanitic`] = {
    ...base,
    id: `${sp}_nanitic`,
    name: 'Nanitic',
    length: base.length * k.length,
    hp: Math.round(base.hp * k.hp),
    bite: +(base.bite * k.bite).toFixed(2),
    speed: base.speed * k.speed,
    carry: +(base.carry * k.carry).toFixed(2),
    nanitic: true,
    scale: k.length,
    fact:
      SPECIES[sp].kind === 'termite'
        ? 'The first workers of a new termite colony are small: the founding king and queen raise them alone from their own reserves.'
        : 'Nanitics are the small first workers a founding queen raises alone, fed only from her own body reserves.',
  };
}

/** The nanitic caste raised on a species' queen tiles. */
export function naniticCaste(species: SpeciesId): string {
  return `${species}_nanitic`;
}

/** Brood tier of a caste: sets its tile costs, hatch cost and grow time (balance.ts). */
export function tierOf(caste: string): Tier {
  const cd = CASTES[caste];
  if (cd?.nanitic) return 'nanitic';
  const t = BALANCE.casteTier[caste];
  if (t) return t;
  return cd && (cd.role === 'soldier' ? 'soldier' : cd.role === 'major' ? 'heavy' : 'worker');
}

/** Fighters (soldier and heavy tiers) count as soldiers in the population readout. */
export function isSoldierCaste(caste: string): boolean {
  const t = tierOf(caste);
  return t === 'soldier' || t === 'heavy';
}

/** Castes that a custom (plagiaria) colony may borrow. */
export const BORROWABLE = Object.values(CASTES)
  // ants cannot raise termites (another insect order: no pupae, wood diet, fed by their own workers)
  .filter((c) => c.role !== 'queen' && c.role !== 'king' && c.species !== 'plagiaria' && c.species !== 'termant' && !c.nanitic && !c.termite)
  .map((c) => c.id);

/** A king (termites, Termants): never targeted, takes no damage, dies with his queen (user note 2026-10-25). */
export const isKing = (caste: string): boolean => casteOf(caste).role === 'king';

/** Old caste ids kept working for saves and URLs (army ants: the old soldier is the Soldier, the major). */
export const CASTE_ALIAS: Record<string, string> = { eciton_soldier: 'eciton_major' };
export const canonCaste = (id: string): string => CASTE_ALIAS[id] ?? id;

export function casteOf(id: string): CasteDef {
  const c = CASTES[id] ?? CASTES[CASTE_ALIAS[id]];
  if (!c) throw new Error('unknown caste ' + id);
  return c;
}

/** The basic caste that needs no development chamber. */
export function basicCaste(species: SpeciesId): string {
  return SPECIES[species].castes[species === 'atta' ? 1 : 0];
}

export function needsChamber(colonySpecies: SpeciesId, caste: string): boolean {
  if (caste === basicCaste(colonySpecies)) return false;
  // Atta minims come from the normal nursery too (they are the smallest workers).
  if (colonySpecies === 'atta' && caste === 'atta_minim') return false;
  return true;
}
