/**
 * The client's side of the command system (multiplayer brief, Part C).
 *
 * The UI calls `issue()` for every player action. The command is quantized,
 * stamped with the local player id, a sequence number and a target tick
 * (the next tick plus the input delay), and handed to the schedule. The
 * simulation applies it at that tick on every client.
 *
 * - Single-player: delay 0. The command is applied at once, at the boundary
 *   before the next tick, which is exactly where a replay applies it, so
 *   the response is instant and the run stays reproducible.
 * - Multiplayer: commands wait their delay (net/lockstep sends them in tick
 *   packets). Until then the UI shows them as *pending*: a shimmering marker,
 *   ghost rings on hexes, group cards already in their new column, and a
 *   click sound. `pending()` lists them for the renderers.
 */
import { World } from '../sim/world';
import { Command, CommandBody, CommandSchedule, applyCommandsNow, quantize } from '../sim/commands';
import { uiCommand } from '../audio/uiSound';

export class LocalCommands {
  /** input delay in ticks (0 = single-player) */
  delay = 0;
  private seq = 0;
  /** network hook: called for every command this client issues (lockstep sends them) */
  onIssue: ((cmd: Command) => void) | null = null;
  /**
   * When the simulation runs elsewhere (the worker, or lockstep), commands go
   * here instead of being applied in this thread; they count as pending until
   * the simulation reports them applied.
   */
  remote: ((cmd: Command) => void) | null = null;
  private sent: Command[] = [];

  constructor(
    private world: World,
    public player: number,
    readonly schedule = new CommandSchedule(),
  ) {}

  issue(body: CommandBody, opts: { silent?: boolean } = {}): Command {
    const w = this.world;
    const cmd = { ...quantize(body), tick: w.s.tick + 1 + this.delay, player: this.player, seq: this.seq } as Command;
    this.seq = (this.seq + 1) & 0xffff;
    this.onIssue?.(cmd);
    if (this.remote) {
      this.sent.push(cmd);
      this.remote(cmd);
    } else {
      this.schedule.add(cmd);
      if (this.delay === 0) applyCommandsNow(w, this.schedule.take(cmd.tick));
    }
    if (!opts.silent) uiCommand(body);
    return cmd;
  }

  /** The simulation applied (or ignored) one of this player's commands. */
  acknowledge(player: number, seq: number): void {
    if (player !== this.player || !this.sent.length) return;
    const i = this.sent.findIndex((c) => c.seq === seq);
    if (i >= 0) this.sent.splice(i, 1);
  }

  /** This player's commands still waiting for their tick. */
  pending(): Command[] {
    if (this.remote) return this.sent;
    return this.delay === 0 ? NONE : this.schedule.pending().filter((c) => c.player === this.player);
  }
}

const NONE: Command[] = [];
