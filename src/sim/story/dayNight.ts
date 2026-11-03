import type { DayNight } from './types';

/**
 * A story level's own day and night (claude/story/04-spec §2, "The Long Nights"): pure arithmetic on game time, shared by
 * the simulation (the light `w.s.night` and the flags `dusk:N`, `night:N`, `dawn:N`) and the HUD's clock.
 *
 * Night k (1-based) starts at first + (k − 1)·(night + day) and lasts `night` s (the last `lastNight` s when set); the
 * light fades over `fade` s before it begins and after it ends; the dusk warning comes `dusk` s before it. After the last
 * night it stays day.
 */

export interface DayNightNow {
  /** the night under way or coming next (1-based; nights + 1 once every night is over) */
  n: number;
  /** in that night now */
  night: boolean;
  /** seconds to the next change (dusk → night, night → dawn); Infinity once the nights are over */
  left: number;
  /** the light: 0 day … 1 night (smooth through dusk and dawn) */
  light: number;
}

export function nightStart(D: DayNight, k: number): number {
  return D.first + (k - 1) * (D.night + D.day);
}

/** How long night k lasts (the last may be longer). */
export function nightLen(D: DayNight, k: number): number {
  return k === D.nights && D.lastNight ? D.lastNight : D.night;
}

export function dayNightAt(D: DayNight, t: number): DayNightNow {
  for (let k = 1; k <= D.nights; k++) {
    const s = nightStart(D, k);
    const e = s + nightLen(D, k);
    if (t < s) {
      const light = t > s - D.fade ? (t - (s - D.fade)) / D.fade : k > 1 && t < nightStart(D, k - 1) + D.night + D.fade ? 1 - (t - (nightStart(D, k - 1) + D.night)) / D.fade : 0;
      return { n: k, night: false, left: s - t, light: clamp01(light) };
    }
    if (t < e) return { n: k, night: true, left: e - t, light: 1 };
  }
  const last = nightStart(D, D.nights) + nightLen(D, D.nights);
  return { n: D.nights + 1, night: false, left: Infinity, light: clamp01(1 - (t - last) / D.fade) };
}

/** The flags due by game time `t`, in order (each once: the caller skips those already set). */
export function dayNightFlags(D: DayNight, t: number): string[] {
  const out: string[] = [];
  for (let k = 1; k <= D.nights; k++) {
    const s = nightStart(D, k);
    if (t >= s - D.dusk) out.push(`dusk:${k}`);
    if (t >= s) out.push(`night:${k}`);
    if (t >= s + nightLen(D, k)) out.push(`dawn:${k}`);
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The HUD's clock line ("Day 2 · dusk in 1:40", "Night 2 of 3 · dawn in 0:55"). */
export function dayNightLabel(D: DayNight, t: number): string {
  const d = dayNightAt(D, t);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (d.n > D.nights) return `Dawn · the nights are over`;
  if (d.night) return `Night ${d.n} of ${D.nights} · dawn in ${mmss(d.left)}`;
  if (d.left <= D.dusk) return `Dusk · night ${d.n} in ${mmss(Math.max(0, d.left))}`;
  return `Day ${d.n} · dusk in ${mmss(Math.max(0, d.left - D.dusk))}`;
}
