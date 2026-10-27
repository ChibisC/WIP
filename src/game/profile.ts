import { Action, DEFAULT_BINDINGS } from '../core/input';

/**
 * Player settings and profile, kept in this browser (Phase 14).
 *
 * - Settings: graphics quality, interface size, edge scrolling, volumes and
 *   key bindings (only the keys changed from the defaults are stored).
 * - Profile: mission medals.
 *
 * Storage can be missing or throw (a private window, blocked site data), so
 * every read and write is guarded: the game then simply runs on defaults.
 * Nothing here touches the simulation.
 */

export type QualityChoice = 'auto' | 'low' | 'medium' | 'high';

/** One slider per mixer bus (Phase 14 audio). */
export interface Volumes {
  master: number;
  ambience: number;
  creatures: number;
  combat: number;
  ui: number;
  music: number;
  narration: number;
}

export interface Settings {
  quality: QualityChoice;
  uiScale: number;
  edgeScroll: boolean;
  muted: boolean;
  volume: Volumes;
  /** actions bound to a key other than the default */
  bindings: Partial<Record<Action, string>>;
  /** camera shake on big hits and boss footfalls: 0 off, 0.5 reduced, 1 full (animation pass) */
  shake?: number;
}

export type Medal = 'gold' | 'silver' | 'bronze';

export interface MedalRecord {
  medal: Medal;
  /** game time, seconds */
  time: number;
  species: string;
  date: string;
}

export interface Profile {
  medals: Record<string, MedalRecord>;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  uiScale: 1,
  edgeScroll: true,
  muted: false,
  volume: { master: 0.8, ambience: 0.7, creatures: 0.8, combat: 0.8, ui: 0.7, music: 0.5, narration: 0.8 },
  bindings: {},
};

const SETTINGS_KEY = 'ud-settings';
const PROFILE_KEY = 'ud-profile';

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage unavailable: the setting lasts for this visit only
  }
}

const clamp01 = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(1, x)) : d);

/** Merge stored values over the defaults, dropping anything malformed. */
export function sanitizeSettings(p: Partial<Settings> | null): Settings {
  const d = DEFAULT_SETTINGS;
  // an older settings file had one "effects" slider: it becomes creatures, combat and interface
  const v = (p?.volume ?? {}) as Partial<Volumes> & { effects?: number };
  const fx = v.effects;
  const bindings: Partial<Record<Action, string>> = {};
  for (const [a, k] of Object.entries(p?.bindings ?? {})) if (a in DEFAULT_BINDINGS && typeof k === 'string' && k) bindings[a as Action] = k;
  return {
    quality: (['auto', 'low', 'medium', 'high'] as const).includes(p?.quality as QualityChoice) ? (p!.quality as QualityChoice) : d.quality,
    uiScale: typeof p?.uiScale === 'number' && p.uiScale >= 0.5 && p.uiScale <= 1.5 ? p.uiScale : d.uiScale,
    edgeScroll: typeof p?.edgeScroll === 'boolean' ? p.edgeScroll : d.edgeScroll,
    muted: typeof p?.muted === 'boolean' ? p.muted : d.muted,
    volume: {
      master: clamp01(v.master, d.volume.master),
      ambience: clamp01(v.ambience, d.volume.ambience),
      creatures: clamp01(v.creatures ?? fx, d.volume.creatures),
      combat: clamp01(v.combat ?? fx, d.volume.combat),
      ui: clamp01(v.ui ?? fx, d.volume.ui),
      music: clamp01(v.music, d.volume.music),
      narration: clamp01(v.narration, d.volume.narration),
    },
    bindings,
  };
}

let current: Settings | null = null;
const listeners: Array<(s: Settings) => void> = [];

/** The settings (read once from storage). */
export function settings(): Settings {
  return (current ??= sanitizeSettings(read<Settings>(SETTINGS_KEY)));
}

/** Change some settings, store them and tell the listeners (audio, UI). */
export function updateSettings(patch: Partial<Settings>): Settings {
  const s = settings();
  current = sanitizeSettings({ ...s, ...patch, volume: { ...s.volume, ...(patch.volume ?? {}) }, bindings: patch.bindings ?? s.bindings });
  write(SETTINGS_KEY, current);
  for (const f of listeners) f(current);
  return current;
}

export function onSettings(f: (s: Settings) => void): () => void {
  listeners.push(f);
  return () => listeners.splice(listeners.indexOf(f), 1);
}

/** The full binding table: defaults with the player's changes. */
export function bindingsOf(s: Settings): Record<Action, string> {
  return { ...DEFAULT_BINDINGS, ...s.bindings };
}

/**
 * Bind `action` to `code`. An action that had that key takes this action's
 * old key instead, so no key is ever bound twice and no action is left without one.
 */
export function rebind(table: Record<Action, string>, action: Action, code: string): Record<Action, string> {
  const out = { ...table };
  const old = out[action];
  for (const a of Object.keys(out) as Action[]) if (a !== action && out[a] === code) out[a] = old;
  out[action] = code;
  return out;
}

/** Only the actions whose key differs from the default (what is stored). */
export function bindingChanges(table: Record<Action, string>): Partial<Record<Action, string>> {
  const out: Partial<Record<Action, string>> = {};
  for (const a of Object.keys(table) as Action[]) if (table[a] !== DEFAULT_BINDINGS[a]) out[a] = table[a];
  return out;
}

/** A key code as printed on the key: KeyW → W, Digit1 → 1, ArrowUp → ↑, Shift+Digit2 → Shift+2. */
export function keyLabel(code: string): string {
  if (code.startsWith('Shift+')) return 'Shift+' + keyLabel(code.slice(6));
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Equal: '=',
    Minus: '−',
    Escape: 'Esc',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Backquote: '`',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

// ---------------------------------------------------------------- profile

let prof: Profile | null = null;

export function profile(): Profile {
  if (prof) return prof;
  const p = read<Profile>(PROFILE_KEY);
  const medals: Record<string, MedalRecord> = {};
  for (const [id, r] of Object.entries(p?.medals ?? {})) {
    if (r && (r.medal === 'gold' || r.medal === 'silver' || r.medal === 'bronze') && typeof r.time === 'number') medals[id] = r;
  }
  return (prof = { medals });
}

const RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };

/** The medal a mission completed in `time` seconds earns: gold under 25 min, silver under 40. */
export function medalFor(time: number): Medal {
  return time < 25 * 60 ? 'gold' : time < 40 * 60 ? 'silver' : 'bronze';
}

/** Record a completed mission; keeps the better medal (or the faster time for the same medal). Returns the new record. */
export function recordMedal(mission: string, time: number, species: string, date = new Date().toISOString().slice(0, 10)): { record: MedalRecord; best: boolean } {
  const p = profile();
  const r: MedalRecord = { medal: medalFor(time), time, species, date };
  const old = p.medals[mission];
  const best = !old || RANK[r.medal] > RANK[old.medal] || (r.medal === old.medal && time < old.time);
  if (best) {
    p.medals[mission] = r;
    write(PROFILE_KEY, p);
  }
  return { record: best ? r : old!, best };
}

/** Forget the cached copies (tests reload from storage). */
export function resetCache(): void {
  current = null;
  prof = null;
}
