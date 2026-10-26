/**
 * Deterministic lockstep (multiplayer brief, Part D).
 *
 * Every player sends one packet per tick — the commands they issued, or
 * nothing — for the tick `delay` ticks ahead of the one they are executing.
 * A client executes tick T only when it holds every active player's packet
 * for T, then applies all those commands in (player, seq) order. Since the
 * simulation is deterministic, every client stays in the same state without
 * ever sending state.
 *
 * The delay can change at any time (the host suggests one from measured
 * ping and jitter): a client simply sends its next packets further ahead or
 * waits, so no agreement is needed. Players can be dropped (their packets
 * are no longer awaited from a given tick) and rejoin.
 */
import { Command, sortCommands } from '../sim/commands';

export const MIN_DELAY = 2;
export const MAX_DELAY = 8;

interface PlayerState {
  /** first tick this player's packets are needed for */
  from: number;
  /** packets are no longer needed from this tick on (dropped) */
  until: number;
}

export class Lockstep {
  /** last tick executed here */
  executed: number;
  /** input delay in ticks */
  delay: number;
  private packets = new Map<number, Map<number, Command[]>>();
  private players = new Map<number, PlayerState>();
  /** last tick this client sent its own packet for */
  lastSent: number;
  private outbox: Command[] = [];
  /** the newest tick received from each player (their progress) */
  readonly newest = new Map<number, number>();
  /** recent packets kept for desync dumps and rejoining players */
  private history: Array<{ tick: number; player: number; cmds: Command[] }> = [];
  historyTicks = 600;
  /** the packets every player sends before running anything (start tick + initial delay) */
  readonly firstBatch: number;

  constructor(
    readonly self: number,
    players: number[],
    startTick: number,
    delay: number,
    /** sends this client's packet for a tick (the net layer frames and routes it) */
    private sendPacket: (tick: number, cmds: Command[]) => void,
    /** a spectator or a rejoining client starts sending later */
    sendFrom = startTick + 1,
  ) {
    this.executed = startTick;
    this.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, delay));
    this.firstBatch = startTick + this.delay;
    for (const p of players) this.players.set(p, { from: startTick + 1, until: Infinity });
    this.lastSent = sendFrom - 1;
  }

  /** Send the packets due now (call after start and after each executed tick). */
  flush(): void {
    const upTo = this.executed + this.delay;
    while (this.lastSent < upTo) {
      const t = ++this.lastSent;
      const cmds = this.outbox.splice(0).map((c) => ({ ...c, tick: t, player: this.self }));
      this.addPacket(t, this.self, cmds);
      this.sendPacket(t, cmds);
    }
  }

  /** Queue a command of this player for the next packet. */
  queue(cmd: Command): void {
    this.outbox.push(cmd);
  }

  get queued(): number {
    return this.outbox.length;
  }

  addPacket(tick: number, player: number, cmds: Command[]): void {
    if (tick <= this.executed) return; // late duplicate (a rejoin resend)
    let m = this.packets.get(tick);
    if (!m) {
      m = new Map();
      this.packets.set(tick, m);
    }
    if (m.has(player)) return;
    m.set(player, cmds);
    if ((this.newest.get(player) ?? -1) < tick) this.newest.set(player, tick);
  }

  private needed(player: number, tick: number): boolean {
    const s = this.players.get(player);
    return !!s && tick >= s.from && tick < s.until;
  }

  /** Players whose packet for the next tick is missing. */
  missing(): number[] {
    const t = this.executed + 1;
    const m = this.packets.get(t);
    const out: number[] = [];
    for (const p of this.players.keys()) if (this.needed(p, t) && !m?.has(p)) out.push(p);
    return out;
  }

  ready(): boolean {
    return this.missing().length === 0;
  }

  /** Take the next tick's commands (call only when ready); the caller then runs the tick. */
  take(): Command[] {
    const t = this.executed + 1;
    const m = this.packets.get(t);
    this.packets.delete(t);
    const all: Command[] = [];
    if (m)
      for (const [p, cmds] of m) {
        if (!this.needed(p, t)) continue;
        this.history.push({ tick: t, player: p, cmds });
        for (const c of cmds) all.push({ ...c, tick: t, player: p });
      }
    while (this.history.length && this.history[0].tick <= t - this.historyTicks) this.history.shift();
    this.executed = t;
    return sortCommands(all);
  }

  /** Stop waiting for a player from `fromTick` on (dropped; the AI takes the colony). */
  drop(player: number, fromTick: number): void {
    const s = this.players.get(player);
    if (s) s.until = Math.min(s.until, fromTick);
  }

  /** Wait for a player's packets again from `fromTick` on (rejoined). */
  rejoin(player: number, fromTick: number): void {
    this.players.set(player, { from: fromTick, until: Infinity });
  }

  /** The first tick for which this client lacks a player's packet (where a drop takes effect). */
  firstMissing(player: number): number {
    let t = this.executed + 1;
    while (this.packets.get(t)?.has(player)) t++;
    return t;
  }

  /** Each player's needed range (sent to a rejoining client so it waits for the same packets). */
  playerStates(): Array<[number, number, number]> {
    return [...this.players].map(([p, s]) => [p, s.from, s.until === Infinity ? -1 : s.until]);
  }

  setPlayerStates(states: Array<[number, number, number]>): void {
    for (const [p, from, until] of states) this.players.set(p, { from, until: until < 0 ? Infinity : until });
  }

  /** Has this player run any tick yet (sent more than its first batch of packets)? */
  hasStarted(player: number): boolean {
    return (this.newest.get(player) ?? 0) > this.firstBatch;
  }

  isActive(player: number): boolean {
    const s = this.players.get(player);
    return !!s && s.until === Infinity;
  }

  activePlayers(): number[] {
    return [...this.players.keys()].filter((p) => this.isActive(p));
  }

  /** Packets held for ticks after `tick` (sent to a rejoining player with the snapshot). */
  packetsAfter(tick: number): Array<[number, number, Command[]]> {
    const out: Array<[number, number, Command[]]> = [];
    for (const [t, m] of this.packets) if (t > tick) for (const [p, cmds] of m) out.push([t, p, cmds]);
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  /** Recent executed packets (desync dumps). */
  recent(): Array<{ tick: number; player: number; cmds: Command[] }> {
    return this.history.slice();
  }

  /**
   * How far this client is ahead of the slowest active player (ticks); the
   * net layer slows its clock a little when this grows.
   */
  lead(): number {
    let slowest = Infinity;
    for (const p of this.activePlayers()) {
      if (p === this.self) continue;
      const n = this.newest.get(p);
      if (n === undefined) continue;
      slowest = Math.min(slowest, n - this.delay);
    }
    return slowest === Infinity ? 0 : this.executed - slowest;
  }
}
