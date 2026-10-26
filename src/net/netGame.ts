/**
 * A running multiplayer match (multiplayer brief, Part D): lockstep over a
 * transport, with the host relaying packets (star topology), measuring
 * pings, choosing the input delay, comparing state hashes, dropping and
 * re-admitting players. A multiplayer match never pauses (user rule).
 *
 * It knows nothing about rendering: the session asks `tryTick()` whenever
 * its clock says a tick is due, and reads `status()` for the overlays.
 */
import { Command } from '../sim/commands';
import { Lockstep, MAX_DELAY, MIN_DELAY } from './lockstep';
import { Control, Slot, fromB64, packControl, packTick, toB64, unpack } from './messages';
import { encodeTickPacket, decodeTickPacket } from '../sim/commands';
import type { Transport } from './transport';

/** What the match needs from the simulation (worker or local). */
export interface NetSim {
  /** run one tick with these commands (they are already in canonical order) */
  stepWith(cmds: Command[]): void;
  /** the state hash after every tick sent so far */
  hash(): Promise<{ tick: number; hash: string }>;
  /** the canonical snapshot after every tick sent so far */
  snapshot(): Promise<Uint8Array>;
}

export interface NetStatus {
  tick: number;
  delay: number;
  /** players whose packets this client is waiting for */
  waitingFor: number[];
  /** how long it has been waiting (ms) */
  waitingMs: number;
  desync: { tick: number; hashes: Record<string, string> } | null;
  /** round trip to the host per player (ms) */
  pings: Record<number, number>;
  /** dropped players (their colonies are AI-driven now) */
  dropped: number[];
  lastHash: { tick: number; hash: string } | null;
  /** the host left: the match cannot continue */
  hostLost: boolean;
  /** simulation clock factor (slightly below 1 while waiting for a slower player) */
  speed: number;
}

/** Ticks between hash comparisons. */
export const HASH_EVERY = 100;
/** Seconds of waiting before the "Waiting for…" overlay, and before the host drops the player. */
export const WAIT_SHOW_S = 3;
export const DROP_AFTER_S = 30;

export class NetGame {
  readonly lockstep: Lockstep;
  slots: Slot[];
  private stallSince = 0;
  private lastPing = 0;
  private lastDelaySent = 0;
  /** host: RTT and jitter per peer */
  private rtt = new Map<string, { rtt: number; jitter: number }>();
  private hashes = new Map<number, Map<number, string>>();
  private st: NetStatus;
  onDesync: ((tick: number) => void) | null = null;
  onChat: ((from: string, text: string) => void) | null = null;
  onLog: ((text: string) => void) | null = null;
  /** the host dropped this client (it should rejoin: reload with its token) */
  onSelfDropped: (() => void) | null = null;
  private now: () => number;

  constructor(
    readonly transport: Transport,
    readonly self: number,
    slots: Slot[],
    private sim: NetSim,
    opts: { delay: number; startTick?: number; sendFrom?: number; now?: () => number } = { delay: 3 },
  ) {
    this.slots = slots;
    this.now = opts.now ?? (() => performance.now());
    const humans = slots.map((s, i) => (s.kind === 'human' ? i : -1)).filter((i) => i >= 0);
    const start = opts.startTick ?? 0;
    this.lockstep = new Lockstep(self, humans, start, opts.delay, (tick, cmds) => this.sendOwn(tick, cmds), opts.sendFrom ?? start + 1);
    this.st = {
      tick: start,
      delay: this.lockstep.delay,
      waitingFor: [],
      waitingMs: 0,
      desync: null,
      pings: {},
      dropped: [],
      lastHash: null,
      hostLost: false,
      speed: 1,
    };
    transport.onMessage = (from, data) => this.receive(from, data);
    transport.onPeerLeave = (id) => this.peerLeft(id);
    this.lockstep.flush();
  }

  get isHost(): boolean {
    return this.transport.isHost;
  }

  private playerOfPeer(peer: string): number {
    return this.slots.findIndex((s) => s.kind === 'human' && s.peer === peer);
  }

  // ------------------------------------------------------------------ sending

  private sendOwn(tick: number, cmds: Command[]): void {
    const data = packTick(tick, this.self, cmds);
    if (this.isHost) this.transport.broadcast(data);
    else if (this.transport.hostId) this.transport.send(this.transport.hostId, data);
  }

  /** A command this player issued (LocalCommands.remote). */
  issue(cmd: Command): void {
    this.lockstep.queue(cmd);
  }

  private control(c: Control, to?: string, blob?: Uint8Array): void {
    const data = packControl(c, blob);
    if (to) this.transport.send(to, data);
    else if (this.isHost) this.transport.broadcast(data);
    else if (this.transport.hostId) this.transport.send(this.transport.hostId, data);
  }

  chat(text: string): void {
    const msg: Control = { t: 'chat', from: this.slots[this.self]?.name ?? '?', text: text.slice(0, 200) };
    this.onChat?.(msg.from, msg.text);
    this.control(msg);
  }

  // ------------------------------------------------------------------ receiving

  /** A message from a peer (the transport calls this; the lobby replays what arrived before the match took over). */
  receive(from: string, data: Uint8Array): void {
    const m = unpack(data);
    if (!m) return;
    if (m.kind === 'tick') {
      if (this.isHost) {
        // a client may only send its own packets; relay them to everyone else
        if (this.playerOfPeer(from) !== m.player) return;
        for (const p of this.transport.peers()) if (p !== from) this.transport.send(p, data);
      }
      this.lockstep.addPacket(m.tick, m.player, m.cmds);
      return;
    }
    const c = m.msg;
    switch (c.t) {
      case 'ping':
        this.control({ t: 'pong', at: c.at }, from);
        break;
      case 'pong': {
        // a reply that took seconds means a busy tab, not the network: cap it for the average
        const r = Math.min(1000, this.now() - c.at);
        const prev = this.rtt.get(from);
        this.rtt.set(from, prev ? { rtt: prev.rtt * 0.8 + r * 0.2, jitter: prev.jitter * 0.8 + Math.abs(r - prev.rtt) * 0.2 } : { rtt: r, jitter: r * 0.25 });
        const p = this.playerOfPeer(from);
        if (p >= 0) this.slots[p].ping = Math.round(this.rtt.get(from)!.rtt);
        break;
      }
      case 'delay':
        if (!this.isHost) this.lockstep.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, c.d));
        if (c.pings) this.st.pings = c.pings;
        break;
      case 'hash':
        if (this.isHost) this.noteHash(c.tick, c.player, c.hash);
        break;
      case 'desync':
        this.flagDesync(c.tick, c.hashes);
        break;
      case 'drop':
        if (c.player === this.self) {
          // we were too slow or our connection stalled: the AI runs our colony; come back in through a rejoin
          this.onLog?.('Your connection stalled and the AI took over your colony. Rejoining…');
          this.onSelfDropped?.();
        }
        this.lockstep.drop(c.player, c.fromTick);
        if (!this.st.dropped.includes(c.player)) this.st.dropped.push(c.player);
        this.onLog?.(`${this.slots[c.player]?.name ?? 'A player'} was dropped; the AI runs their colony.`);
        break;
      case 'rejoin':
        this.lockstep.rejoin(c.player, c.fromTick);
        this.st.dropped = this.st.dropped.filter((p) => p !== c.player);
        this.onLog?.(`${this.slots[c.player]?.name ?? 'A player'} is back.`);
        break;
      case 'chat':
        this.onChat?.(c.from, c.text);
        if (this.isHost) for (const p of this.transport.peers()) if (p !== from) this.control(c, p);
        break;
      case 'join':
        if (this.isHost) void this.readmit(from, c.token, c.name);
        break;
      default:
        break;
    }
  }

  private peerLeft(peer: string): void {
    if (!this.isHost && peer === this.transport.hostId) {
      this.st.hostLost = true;
      this.onLog?.('The host left the match.');
      return;
    }
    const p = this.playerOfPeer(peer);
    if (p >= 0) this.onLog?.(`${this.slots[p].name} disconnected. Waiting for them to rejoin…`);
  }

  // ------------------------------------------------------------------ ticking

  /**
   * The clock says a tick is due: run it if every packet is in. Returns
   * false when waiting for a player.
   */
  tryTick(): boolean {
    if (this.st.desync || this.st.hostLost) return false;
    const ls = this.lockstep;
    if (!ls.ready()) {
      if (!this.stallSince) this.stallSince = this.now();
      this.st.waitingFor = ls.missing().filter((p) => p !== this.self);
      this.st.waitingMs = this.now() - this.stallSince;
      return false;
    }
    this.stallSince = 0;
    this.st.waitingFor = [];
    this.st.waitingMs = 0;
    const cmds = ls.take();
    this.sim.stepWith(cmds);
    ls.flush();
    this.st.tick = ls.executed;
    if (ls.executed % HASH_EVERY === 0) {
      const t = ls.executed;
      void this.sim.hash().then((h) => {
        if (h.tick !== t) return; // a later tick ran first (should not happen: requests are ordered)
        this.st.lastHash = h;
        if (this.isHost) this.noteHash(t, this.self, h.hash);
        else this.control({ t: 'hash', tick: t, hash: h.hash, player: this.self });
      });
    }
    return true;
  }

  /** Timers: pings, delay, stalls, auto-drop and the slow-down. Call every frame. */
  update(): void {
    const now = this.now();
    if (this.isHost && now - this.lastPing > 1000) {
      this.lastPing = now;
      for (const p of this.transport.peers()) this.control({ t: 'ping', at: now }, p);
      this.adaptDelay(now);
    }
    // Auto-drop a player the match has waited 30 s for. A player still loading the match (nothing
    // run yet) gets 2 minutes: building the world takes a while on a slow computer.
    if (this.isHost && this.stallSince) {
      const waited = now - this.stallSince;
      for (const p of this.lockstep.missing()) {
        if (p === this.self) continue;
        const limit = (this.lockstep.hasStarted(p) ? DROP_AFTER_S : 120) * 1000;
        if (waited > limit) this.dropPlayer(p);
      }
    }
    // slow down a little while ahead of the slowest player (rather than stalling in bursts)
    const lead = this.lockstep.lead();
    this.st.speed = lead > this.lockstep.delay + 2 ? 0.9 : 1;
    this.st.delay = this.lockstep.delay;
  }

  private adaptDelay(now: number): void {
    // A client's packet reaches another client through the host: the slowest path is the two
    // slowest one-way links added together, plus a margin for jitter.
    const links: number[] = [];
    let jitter = 0;
    for (const [peer, r] of this.rtt)
      if (this.transport.peers().includes(peer)) {
        links.push(r.rtt / 2);
        jitter = Math.max(jitter, r.jitter);
      }
    links.sort((a, b) => b - a);
    const worst = (links[0] ?? 0) + (links[1] ?? 0) + 2 * jitter;
    const d = Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.ceil(worst / 50) + 1));
    const pings: Record<number, number> = {};
    this.slots.forEach((s, i) => {
      if (s.kind === 'human' && i !== this.self) pings[i] = s.ping;
    });
    this.st.pings = pings;
    if (d !== this.lockstep.delay || now - this.lastDelaySent > 2000) {
      this.lockstep.delay = d;
      this.lastDelaySent = now;
      this.control({ t: 'delay', d, pings });
    }
  }

  /** Host: stop waiting for a player; the AI drives their colony from the next packet. */
  dropPlayer(p: number): void {
    if (!this.isHost || !this.lockstep.isActive(p) || p === this.self) return;
    const fromTick = this.lockstep.firstMissing(p);
    this.lockstep.drop(p, fromTick);
    if (!this.st.dropped.includes(p)) this.st.dropped.push(p);
    this.control({ t: 'drop', player: p, fromTick });
    this.lockstep.queue({ type: 'setControl', colony: p, human: false, tick: 0, player: this.self, seq: 0xfff0 + p });
    this.onLog?.(`${this.slots[p]?.name ?? 'A player'} was dropped; the AI runs their colony.`);
  }

  /** Host: a player came back with their token. Send them the state and the packets since. */
  private async readmit(peer: string, token: string, name: string): Promise<void> {
    const p = this.slots.findIndex((s) => s.kind === 'human' && s.token === token);
    if (p < 0) {
      this.control({ t: 'refused', reason: 'The match has already started.' }, peer);
      return;
    }
    this.slots[p].peer = peer;
    this.slots[p].name = name || this.slots[p].name;
    const snap = await this.sim.snapshot();
    const ls = this.lockstep;
    const tick = ls.executed;
    const wasDropped = !ls.isActive(p);
    // A dropped player rejoins from a tick nobody has run yet; one we were still waiting for sends what is missing.
    const fromTick = wasDropped ? ls.lastSent + 1 : ls.firstMissing(p);
    if (wasDropped) {
      ls.rejoin(p, fromTick);
      this.st.dropped = this.st.dropped.filter((x) => x !== p);
      this.control({ t: 'rejoin', player: p, fromTick });
      ls.queue({ type: 'setControl', colony: p, human: true, tick: 0, player: this.self, seq: 0xfff8 + p });
    }
    const packets = ls.packetsAfter(tick).map(([t, pl, cmds]) => [t, pl, toB64(encodeTickPacket(t, pl, cmds))] as [number, number, string]);
    this.control({ t: 'resync', tick, you: p, slots: this.slots, delay: ls.delay, fromTick, packets, players: ls.playerStates() }, peer, snap);
    this.onLog?.(`${this.slots[p].name} rejoined.`);
  }

  /**
   * The rejoining client's side: a match continuing from the host's snapshot
   * (`sim` was restored from it), with the packets the host held and the same
   * view of who is playing.
   */
  static fromResync(transport: Transport, c: Extract<Control, { t: 'resync' }>, sim: NetSim, now?: () => number): NetGame {
    const g = new NetGame(transport, c.you, c.slots, sim, { delay: c.delay, startTick: c.tick, sendFrom: c.fromTick, now });
    g.lockstep.setPlayerStates(c.players);
    for (const [, , b64] of c.packets) {
      const d = decodeTickPacket(fromB64(b64));
      g.lockstep.addPacket(d.tick, d.player, d.cmds);
    }
    return g;
  }

  /** Ticks this client is behind the newest packets it holds (a rejoining client fast-forwards). */
  behind(): number {
    let newest = 0;
    for (const t of this.lockstep.newest.values()) newest = Math.max(newest, t);
    return Math.max(0, newest - this.lockstep.delay - this.lockstep.executed);
  }

  // ------------------------------------------------------------------ hashes and desyncs

  private noteHash(tick: number, player: number, hash: string): void {
    let m = this.hashes.get(tick);
    if (!m) {
      m = new Map();
      this.hashes.set(tick, m);
    }
    m.set(player, hash);
    const active = this.lockstep.activePlayers();
    if (!active.every((p) => m!.has(p))) return;
    this.hashes.delete(tick);
    const vals = new Set(active.map((p) => m!.get(p)));
    if (vals.size > 1) {
      const hashes: Record<string, string> = {};
      for (const p of active) hashes[this.slots[p]?.name || `player ${p}`] = m.get(p)!;
      this.control({ t: 'desync', tick, hashes });
      this.flagDesync(tick, hashes);
    }
    for (const t of this.hashes.keys()) if (t < tick - HASH_EVERY * 5) this.hashes.delete(t);
  }

  private flagDesync(tick: number, hashes: Record<string, string>): void {
    if (this.st.desync) return;
    this.st.desync = { tick, hashes };
    this.onLog?.(`Desync detected at tick ${tick}. The match is stopped; download the desync report.`);
    this.onDesync?.(tick);
  }

  /** Everything needed to investigate a desync, as one JSON file plus the snapshot. */
  async desyncReport(build: string): Promise<{ json: string; snapshot: Uint8Array }> {
    const snapshot = await this.sim.snapshot();
    const json = JSON.stringify(
      {
        build,
        self: this.self,
        slots: this.slots.map((s) => ({ name: s.name, kind: s.kind, species: s.species })),
        status: this.st,
        recentPackets: this.lockstep.recent(),
      },
      null,
      1,
    );
    return { json, snapshot };
  }

  status(): NetStatus {
    return this.st;
  }

  close(): void {
    this.control({ t: 'bye' });
    this.transport.close();
  }
}
