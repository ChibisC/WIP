/**
 * Typed event bus. The simulation pushes events; render, audio and UI drain them
 * once per frame. Events carry only plain data so the sim stays render-agnostic.
 */
export type SimEvent =
  | { t: 'dig'; colony: number; x: number; y: number; space?: number }
  | { t: 'spoil'; colony: number; x: number; y: number; space: number }
  /** `by`: the biter (a caste id, or a creature kind); `on`: what was bitten (sound only: never read by the simulation) */
  | { t: 'bite'; x: number; y: number; space: number; strength: number; by?: string; on?: 'ant' | 'creature' | 'food' | 'seed' | 'leaf' | 'brood' | 'wood'; gold?: boolean; riding?: boolean }
  /** climbing a large creature: starting up a leg, coming down, or dropping off when it dies */
  | { t: 'climb'; x: number; y: number; space: number; phase: 'up' | 'down' | 'drop'; creature: number; by: string }
  | { t: 'acid'; x: number; y: number; tx: number; ty: number; space: number; lob?: boolean; splash?: number }
  | { t: 'acidHit'; x: number; y: number; space: number; splash: number }
  | { t: 'sting'; x: number; y: number; space: number; by?: string }
  /** caste abilities (sim/casteAbilities.ts): a leafcutter major's taunt (its reach), an army-ant soldier's rage stack */
  | { t: 'taunt'; x: number; y: number; space: number; radius: number; by: string }
  | { t: 'rage'; x: number; y: number; space: number; stacks: number; by: string }
  | { t: 'hit'; x: number; y: number; space: number; big: boolean }
  /** `what`: the caste id or creature kind */
  | { t: 'death'; x: number; y: number; space: number; kind: 'ant' | 'creature'; id: number; colony: number; what?: string; cause?: number }
  | { t: 'alarm'; x: number; y: number; space: number; colony: number }
  | { t: 'fling'; x: number; y: number; space: number }
  | { t: 'slam'; x: number; y: number; space: number; radius: number; power: number }
  | { t: 'telegraph'; x: number; y: number; space: number; radius: number; duration: number; creature: number; dir?: number; half?: number }
  | { t: 'bossPhase'; creature: number; phase: number; name: string }
  | { t: 'bossFootstep'; x: number; y: number; power: number }
  /**
   * a titan digging into a nest (sim/creatures/titanDig.ts): the warning, the digging starting, digging at the hole, the
   * breach, going in, a hex breaking, leaving; `prog` the hole's progress (0–1), `eta` the seconds to the breakthrough
   * (warn, start), `story` a story's titan (it always gets in)
   */
  | { t: 'titanDig'; phase: 'warn' | 'start' | 'dig' | 'breach' | 'enter' | 'break' | 'leave'; colony: number; x: number; y: number; space: number; creature: number; kind: string; prog?: number; eta?: number; story?: boolean }
  /** termite soldiers drumming the alarm (a nasute major's alarm call) */
  | { t: 'headbang'; x: number; y: number; space: number }
  /** a termite major's point-blank glue burst (the target is held) */
  | { t: 'glueBurst'; x: number; y: number; space: number; target: number }
  /** a hell ant's vertical mandible snap (and the soldier's impale) */
  | { t: 'snap'; x: number; y: number; space: number; by: string; impale: boolean }
  /** a Sickle-Jaw soldier's grab-and-squirt (sim/sickleJaws.ts): the snap that hooks a victim, a lunge that
   *  closed on nothing, and the end of a hold (only ever by a death) */
  | { t: 'grab'; x: number; y: number; space: number; soldier: number; target: number }
  | { t: 'grabMiss'; x: number; y: number; space: number; soldier: number }
  /** army ants: a Soldier's hook goes in; a victim spread-eagled by a crowd; a living-bridge link joins (eciton.ts) */
  | { t: 'hook'; x: number; y: number; space: number }
  | { t: 'pin'; x: number; y: number; space: number }
  | { t: 'link'; x: number; y: number; space: number }
  | { t: 'grabRelease'; x: number; y: number; space: number; soldier: number; target: number; reason: 'victimDied' | 'holderDied' | 'flung' }
  /** Termants: gene samples taken in (`source`: a species id or `cr:<kind>`), a caste stolen, a soldier's glue burst */
  | { t: 'gene'; colony: number; source: string; amount: number }
  | { t: 'caste'; colony: number; caste: string; source: string; forgotten?: boolean }
  /** a Saiy-Ant flashing into its gold surge */
  | { t: 'surge'; x: number; y: number; space: number; id: number }
  | { t: 'hairs'; x: number; y: number; space: number; radius: number }
  | { t: 'egg'; colony: number }
  | { t: 'hatch'; colony: number; caste: string; x: number; y: number; space: number }
  | { t: 'tileBuilt'; colony: number; q: number; kind: 'build' | 'upgrade' | 'downgrade' | 'remove' }
  | { t: 'starving'; colony: number }
  | { t: 'chamberDone'; colony: number; chamber: number }
  | { t: 'queenHurt'; colony: number }
  /** a flood zone's storm: warning, rising water or draining (sound, sky and minimap only) */
  | { t: 'flood'; zone: number; phase: 'warn' | 'rise' | 'drain'; x: number; y: number }
  /** a colony's nest floods (sim/nestFlood.ts): the water starts pouring in, or the nest is full; x, y its anthill on the surface */
  | { t: 'nestFlood'; colony: number; phase: 'start' | 'full'; x: number; y: number }
  | { t: 'queenDead'; colony: number }
  | { t: 'colonyLost'; colony: number }
  | { t: 'food'; colony: number; amount: number }
  | { t: 'leafCut'; x: number; y: number }
  | { t: 'splash'; x: number; y: number; space: number }
  | { t: 'message'; text: string; kind: 'info' | 'warn' | 'good' | 'narrator' | 'researcher'; /** the colony it is for (shown only to that colony's player); none = everyone */ colony?: number; /** story captions: the narration key (voice lines hook on it) */ key?: string }
  /**
   * Story levels (sim/story): a short in-engine shot to play (camera keys: a story point name, [x, y] or { actor },
   * or 'flight' for the map's opening flight), or a music mood. Client-side only: the simulation never waits on it.
   */
  | { t: 'story'; what: 'shot' | 'music'; shot?: StoryShotData; mood?: string }
  | { t: 'invasion'; colony: number }
  /** tunnel routes (sim/tunnels.ts): a defender warned of digging toward its gate (once), the dig sound from behind the wall, a route opened */
  | { t: 'tunnelWarn'; colony: number; by: number; route: number; space: number; x: number; y: number; q: number }
  | { t: 'tunnelDig'; colony: number; route: number; space: number; x: number; y: number }
  | { t: 'tunnelOpen'; route: number; a: number; b: number; spaces: number[]; x: number[]; y: number[] }
  /** a route's gate joined its nest's dug floor: `by` the colony that dug in (−1: the owner's own digging reached the gate) */
  | { t: 'tunnelBreach'; colony: number; by: number; route: number; space: number; x: number; y: number; open: boolean }
  /** a player command was applied (ok) or ignored (why) — clears the issuer's pending feedback */
  | { t: 'command'; player: number; seq: number; type: string; ok: boolean; why?: string; /** the tick it acts in */ tick?: number }
  | { t: 'wave'; index: number; total: number; label: string };

/** A story shot as data (sim/story/types.ts `Shot`), kept structural here so core does not import the sim. */
export type StoryShotData = 'flight' | { keys: Array<{ at: string | readonly [number, number] | { actor: string }; dist: number; yaw: number; t: number; pitch?: number }> };

export class EventBus {
  private queue: SimEvent[] = [];
  private listeners = new Map<string, Array<(e: SimEvent) => void>>();

  emit(e: SimEvent): void {
    this.queue.push(e);
  }

  on<K extends SimEvent['t']>(type: K, fn: (e: Extract<SimEvent, { t: K }>) => void): () => void {
    let arr = this.listeners.get(type);
    if (!arr) {
      arr = [];
      this.listeners.set(type, arr);
    }
    arr.push(fn as (e: SimEvent) => void);
    return () => {
      const a = this.listeners.get(type);
      if (a) a.splice(a.indexOf(fn as (e: SimEvent) => void), 1);
    };
  }

  /** Deliver all queued events to listeners and clear the queue. */
  drain(): void {
    if (this.queue.length === 0) return;
    const q = this.queue;
    this.queue = [];
    for (const e of q) {
      const arr = this.listeners.get(e.t);
      if (arr) for (const fn of arr) fn(e);
      const any = this.listeners.get('*');
      if (any) for (const fn of any) fn(e);
    }
  }

  onAny(fn: (e: SimEvent) => void): void {
    let arr = this.listeners.get('*');
    if (!arr) {
      arr = [];
      this.listeners.set('*', arr);
    }
    arr.push(fn);
  }

  clear(): void {
    this.queue.length = 0;
  }
}
