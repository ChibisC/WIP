import type { Difficulty, StoryLevelDef } from '../sim/story/types';
import type { MedalTier, StoryMedals } from '../sim/story/runner';
import { NODES, slotsFor } from '../story/campaign';

/**
 * The campaign save (claude/story/02-spec §7): which levels are open and won, the best medals per level, the stolen
 * castes kept, the slot count, the difficulty and loadout chosen per level, and the field journal. Kept in this
 * browser (like the profile); autosaved when a level is won. It only ever feeds a story level's setup, so story
 * progress never touches skirmish or multiplayer. Storage may be missing or throw: then the campaign runs from
 * memory for this visit.
 *
 * Progress is kept by level id, never by position, so reordering the chapter (2026-11-02: four levels, the nights second
 * and Fire on the Banks third) keeps every save's medals and castes. A level is open when every level before it is won,
 * or when it is won already: an old save that beat Fire on the Banks keeps it open, and the Spider Mother (after it)
 * opens straight away; The Long Nights opens from the garden as for a new player (the friendlier rule, 04-spec §1).
 */

type LevelId = StoryLevelDef['id'];

export interface LevelRecord {
  won: boolean;
  plays: number;
  /**
   * best tier per medal (kept separately: the best time and the fewest losses may come from different plays); `time` is
   * the first medal, food stored on a level of fixed length (The Long Nights)
   */
  time: MedalTier;
  losses: MedalTier;
  bonus: MedalTier;
  /** fastest win (game seconds) and fewest ants lost in a win */
  bestSeconds: number;
  bestLost: number;
  /** the hardest difficulty it was won on */
  hardest?: Difficulty;
}

export interface JournalEntry {
  level: LevelId;
  date: string;
  /** the stolen caste pictured (empty when the level was won without it) */
  caste: string;
  /** an in-game picture of the stolen caste (a data URL; small JPEG) */
  shot?: string;
}

export interface CampaignSave {
  version: 1;
  levels: Partial<Record<LevelId, LevelRecord>>;
  /** stolen castes kept for the campaign */
  castes: string[];
  bosses: number;
  difficulty: Partial<Record<LevelId, Difficulty>>;
  loadout: Partial<Record<LevelId, string[]>>;
  journal: JournalEntry[];
  /** paths already shown revealed on the island map (the reveal animation plays once) */
  revealed: LevelId[];
  /** traits earned from bosses (STORY.traits; story only) */
  traits: string[];
}

const KEY = 'ud-campaign-v1';
let mem: CampaignSave | null = null; // the cached save (this page's copy of browser storage)

function blank(): CampaignSave {
  return { version: 1, levels: {}, castes: [], bosses: 0, difficulty: {}, loadout: {}, journal: [], revealed: [], traits: [] };
}

export function campaign(): CampaignSave {
  if (mem) return mem;
  let s: CampaignSave | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = JSON.parse(raw) as CampaignSave;
  } catch {
    s = null;
  }
  if (!s || s.version !== 1) s = blank();
  // fill anything an older copy lacks
  s = { ...blank(), ...s };
  return (mem = s);
}

export function saveCampaign(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(campaign()));
  } catch {
    // storage full or blocked: the journal pictures are the big part; drop them and try once more
    try {
      const c = campaign();
      localStorage.setItem(KEY, JSON.stringify({ ...c, journal: c.journal.map((j) => ({ ...j, shot: undefined })) }));
    } catch {
      // private mode: memory only
    }
  }
}

/** Start over (the hub's reset). */
export function resetCampaign(): void {
  mem = blank();
  saveCampaign();
}

/** Forget the cached copy (tests). */
export function reloadCampaign(): void {
  mem = null;
}

export function isUnlocked(level: LevelId): boolean {
  const n = NODES.find((x) => x.level === level);
  if (!n) return false;
  const c = campaign();
  return !!c.levels[level]?.won || n.after.every((p) => c.levels[p]?.won);
}

export function slots(): number {
  return slotsFor(campaign().bosses);
}

const RANK: Record<MedalTier, number> = { gold: 3, silver: 2, bronze: 1, none: 0 };
const better = (a: MedalTier, b: MedalTier): MedalTier => (RANK[a] >= RANK[b] ? a : b);
const DIFF_RANK: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2, brutal: 3 };

/** A level was won: medals, the castes kept, the next levels open, a journal page. Returns what is new. */
export function recordWin(
  level: LevelId,
  diff: Difficulty,
  medals: StoryMedals,
  stolen: string[],
  shot: { caste: string; url?: string } | null,
  trait?: string,
): { newCastes: string[]; firstWin: boolean; newTrait: boolean } {
  const c = campaign();
  const old = c.levels[level];
  const firstWin = !old?.won;
  c.levels[level] = {
    won: true,
    plays: (old?.plays ?? 0) + 1,
    time: better(medals.time, old?.time ?? 'none'),
    losses: better(medals.losses, old?.losses ?? 'none'),
    bonus: better(medals.bonus, old?.bonus ?? 'none'),
    bestSeconds: Math.min(medals.seconds, old?.bestSeconds ?? 1e9),
    bestLost: Math.min(medals.lost, old?.bestLost ?? 1e9),
    hardest: !old?.hardest || DIFF_RANK[diff] > DIFF_RANK[old.hardest] ? diff : old.hardest,
  };
  const newCastes = stolen.filter((cs) => !c.castes.includes(cs));
  c.castes.push(...newCastes);
  const newTrait = !!trait && !c.traits.includes(trait);
  if (trait && newTrait) c.traits.push(trait);
  const page = c.journal.find((j) => j.level === level);
  const date = new Date().toISOString().slice(0, 10);
  if (!page) c.journal.push({ level, date, caste: shot?.caste ?? '', shot: shot?.url });
  else if (shot?.url && (!page.shot || newCastes.length)) Object.assign(page, { date, caste: shot.caste, shot: shot.url });
  saveCampaign();
  return { newCastes, firstWin, newTrait };
}

/** A level was played and lost (a play counted). */
export function recordLoss(level: LevelId): void {
  const c = campaign();
  const old = c.levels[level];
  c.levels[level] = old ? { ...old, plays: old.plays + 1 } : { won: false, plays: 1, time: 'none', losses: 'none', bonus: 'none', bestSeconds: 1e9, bestLost: 1e9 };
  saveCampaign();
}
