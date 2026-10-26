import { audio } from './engine';

/**
 * Voice budgets (Phase 14 audio). Sound requests are collected for a
 * frame, sorted by loudness within their pool, and only the loudest play:
 * the closest and loudest win, and a 400-ant battle never becomes noise
 * or clipping. Combat requests that do not fit add to `overflow`, which
 * drives the battle bed: past the voice limit, a fight thickens into one
 * dense texture instead of hundreds of separate sounds.
 */
export type Pool = 'steps' | 'work' | 'combat' | 'creature';
export const POOL_MAX: Record<Pool, number> = { steps: 8, work: 8, combat: 16, creature: 10 };

export interface Req {
  id: string;
  /** loudness at the listener: the sort key */
  prio: number;
  gain: number;
  pan: number;
  rate: number;
  pool: Pool;
  muffle: boolean;
  wet: number;
}

export class Mixer {
  private queue: Req[] = [];
  private ends: Record<Pool, number[]> = { steps: [], work: [], combat: [], creature: [] };
  /** loudness of combat sounds that found no voice, decaying */
  overflow = 0;
  played = 0;
  dropped = 0;

  push(r: Req): void {
    this.queue.push(r);
  }

  /** Voices of a pool still sounding. */
  active(p: Pool): number {
    const t = audio.now;
    this.ends[p] = this.ends[p].filter((e) => e > t);
    return this.ends[p].length;
  }

  flush(dt: number): void {
    const t = audio.now;
    for (const p of Object.keys(this.ends) as Pool[]) this.ends[p] = this.ends[p].filter((e) => e > t);
    this.queue.sort((a, b) => b.prio - a.prio);
    for (const r of this.queue) {
      const ends = this.ends[r.pool];
      if (ends.length >= POOL_MAX[r.pool]) {
        if (r.pool === 'combat') this.overflow += r.prio;
        this.dropped++;
        continue;
      }
      const v = audio.play(r.id, { gain: r.gain, pan: r.pan, rate: r.rate, muffle: r.muffle, wet: r.wet });
      if (v) {
        ends.push(v.end);
        this.played++;
      } else if (r.pool === 'combat') this.overflow += r.prio * 0.5;
    }
    this.queue.length = 0;
    this.overflow *= Math.exp(-dt / 0.6);
  }
}
