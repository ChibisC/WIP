/**
 * Network transports (multiplayer brief, Part D).
 *
 * Every transport is a reliable, ordered message pipe between peers, with
 * the host in the middle (star topology: clients talk only to the host and
 * the host relays). The lockstep and lobby code only see this interface, so
 * a WebSocket relay server later is just another implementation.
 *
 * - `LocalHub` endpoints: in-memory, for headless tests (optionally laggy).
 * - `BroadcastChannelTransport`: up to four tabs on one machine, no network
 *   (`?local=1` rooms): the quickest way to test multiplayer.
 * - `PeerTransport` (peerTransport.ts): WebRTC data channels through PeerJS.
 * - `ManualRtcTransport` (lanTransport.ts): WebRTC data channels on a local network, set up
 *   with connection codes the players exchange by hand (no servers of any kind).
 * - `NetSimTransport`: wraps any transport and adds latency, jitter and loss
 *   (loss on a reliable channel shows up as retransmission delay).
 */

export interface Transport {
  /** this peer's id */
  readonly id: string;
  /** the host's peer id ('' until known) */
  readonly hostId: string;
  readonly isHost: boolean;
  /** peers currently connected (the host sees every client; a client sees the host) */
  peers(): string[];
  send(to: string, data: Uint8Array): void;
  /** to every connected peer */
  broadcast(data: Uint8Array): void;
  onMessage: ((from: string, data: Uint8Array) => void) | null;
  onPeerJoin: ((id: string) => void) | null;
  onPeerLeave: ((id: string) => void) | null;
  /** something went wrong at the connection level (shown to the player) */
  onError: ((message: string) => void) | null;
  close(): void;
  /** LAN: the lobby slot a joining peer's connection code was made for (−1: any) */
  preferredSlot?(peer: string): number;
  /** what a client shows when its link to the host goes (default: the host closed the game) */
  readonly hostLostMessage?: string;
  /** a LAN transport (connection codes: a dropped player comes back with a new code) */
  readonly lan?: boolean;
}

// ---------------------------------------------------------------------------
// In-memory hub (tests)
// ---------------------------------------------------------------------------

/**
 * Connects endpoints in one process. Delivery is asynchronous through a
 * queue that the test pumps (`deliver(now)`), with an optional one-way
 * latency per message, so lockstep can be tested deterministically.
 */
export class LocalHub {
  private endpoints = new Map<string, LocalEndpoint>();
  private queue: Array<{ at: number; seq: number; from: string; to: string; data: Uint8Array }> = [];
  private seq = 0;
  /** one-way latency in ms for each message (default 0) */
  latency: (from: string, to: string) => number = () => 0;
  now = 0;

  connect(id: string, hostId: string): LocalEndpoint {
    const ep = new LocalEndpoint(this, id, hostId);
    this.endpoints.set(id, ep);
    if (id !== hostId) {
      const host = this.endpoints.get(hostId);
      host?.onPeerJoin?.(id);
      ep.onPeerJoin?.(hostId);
    }
    return ep;
  }

  disconnect(id: string): void {
    const ep = this.endpoints.get(id);
    if (!ep) return;
    this.endpoints.delete(id);
    this.queue = this.queue.filter((m) => m.to !== id && m.from !== id);
    for (const other of this.endpoints.values()) if (other.isHost || ep.isHost) other.onPeerLeave?.(id);
  }

  peersOf(id: string): string[] {
    const ep = this.endpoints.get(id);
    if (!ep) return [];
    if (ep.isHost) return [...this.endpoints.keys()].filter((k) => k !== id);
    return this.endpoints.has(ep.hostId) ? [ep.hostId] : [];
  }

  post(from: string, to: string, data: Uint8Array): void {
    if (!this.endpoints.has(to)) return;
    // keep per-link order: never deliver before an earlier message on the same link
    let at = this.now + this.latency(from, to);
    for (const m of this.queue) if (m.from === from && m.to === to && m.at > at) at = m.at;
    this.queue.push({ at, seq: this.seq++, from, to, data: data.slice() });
  }

  /** Deliver every message due by `now` (in order). */
  deliver(now: number): number {
    this.now = now;
    let n = 0;
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.queue.length; i++) {
        const m = this.queue[i];
        if (m.at > now) continue;
        if (best < 0 || m.at < this.queue[best].at || (m.at === this.queue[best].at && m.seq < this.queue[best].seq)) best = i;
      }
      if (best < 0) return n;
      const m = this.queue.splice(best, 1)[0];
      this.endpoints.get(m.to)?.onMessage?.(m.from, m.data);
      n++;
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}

export class LocalEndpoint implements Transport {
  onMessage: ((from: string, data: Uint8Array) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(
    private hub: LocalHub,
    readonly id: string,
    readonly hostId: string,
  ) {}

  get isHost(): boolean {
    return this.id === this.hostId;
  }

  peers(): string[] {
    return this.hub.peersOf(this.id);
  }

  send(to: string, data: Uint8Array): void {
    this.hub.post(this.id, to, data);
  }

  broadcast(data: Uint8Array): void {
    for (const p of this.peers()) this.send(p, data);
  }

  close(): void {
    this.hub.disconnect(this.id);
  }
}

// ---------------------------------------------------------------------------
// BroadcastChannel (several tabs on one machine)
// ---------------------------------------------------------------------------

interface BcEnvelope {
  k: 'hello' | 'welcome' | 'msg' | 'bye' | 'ping';
  from: string;
  to: string;
  data?: Uint8Array;
}

/**
 * Tabs of the same browser share a channel named after the room. The first
 * tab to claim the room is the host; the others announce themselves and the
 * host welcomes them. Messages are addressed, so it behaves like the star
 * topology of the WebRTC transport.
 */
export class BroadcastChannelTransport implements Transport {
  onMessage: ((from: string, data: Uint8Array) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  private ch: BroadcastChannel;
  private known = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;
  private bye = () => this.close();
  hostId: string;

  constructor(
    room: string,
    readonly id: string,
    readonly isHost: boolean,
  ) {
    this.hostId = isHost ? id : '';
    this.ch = new BroadcastChannel(`ud-room-${room}`);
    this.ch.onmessage = (e: MessageEvent<BcEnvelope>) => this.receive(e.data);
    if (!isHost) this.post({ k: 'hello', from: id, to: '*' });
    // A tab that closes says goodbye. There are no time-outs: a tab busy building its world for a
    // while is still there, and dropping it from the channel would lose messages the match relies on
    // (the match itself decides when a silent player is dropped).
    this.timer = setInterval(() => this.post({ k: 'ping', from: this.id, to: '*' }), 1000);
    addEventListener('pagehide', this.bye);
  }

  private post(m: BcEnvelope): void {
    this.ch.postMessage(m);
  }

  private receive(m: BcEnvelope): void {
    if (m.from === this.id) return;
    if (m.to !== '*' && m.to !== this.id) return;
    const relevant = this.isHost || m.from === this.hostId || (!this.hostId && m.k === 'welcome');
    switch (m.k) {
      case 'hello':
        if (this.isHost && !this.known.has(m.from)) {
          this.known.set(m.from, Date.now());
          this.post({ k: 'welcome', from: this.id, to: m.from });
          this.onPeerJoin?.(m.from);
        }
        break;
      case 'welcome':
        if (!this.hostId) {
          this.hostId = m.from;
          this.known.set(m.from, Date.now());
          this.onPeerJoin?.(m.from);
        }
        break;
      case 'ping':
        if (relevant && this.known.has(m.from)) this.known.set(m.from, Date.now());
        break;
      case 'bye':
        if (this.known.delete(m.from)) this.onPeerLeave?.(m.from);
        break;
      case 'msg':
        if (!relevant || !m.data) return;
        this.known.set(m.from, Date.now());
        this.onMessage?.(m.from, m.data);
        break;
    }
  }

  peers(): string[] {
    return [...this.known.keys()];
  }

  send(to: string, data: Uint8Array): void {
    this.post({ k: 'msg', from: this.id, to, data });
  }

  broadcast(data: Uint8Array): void {
    for (const p of this.known.keys()) this.send(p, data);
  }

  private closed = false;

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    removeEventListener('pagehide', this.bye);
    this.post({ k: 'bye', from: this.id, to: '*' });
    this.ch.close();
  }
}

// ---------------------------------------------------------------------------
// Network simulator
// ---------------------------------------------------------------------------

export interface NetSimSettings {
  /** one-way latency (ms) */
  latency: number;
  /** ± random extra delay (ms) */
  jitter: number;
  /** chance a packet is lost and must be resent (0..1); costs one extra round trip */
  loss: number;
}

/**
 * Delays everything this client sends and receives. Order is kept (the
 * channel is reliable and ordered), so jitter and loss show up as bunching
 * and stalls, as they would over a real connection.
 */
export class NetSimTransport implements Transport {
  onMessage: ((from: string, data: Uint8Array) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  private lastOut = 0;
  private lastIn = 0;

  constructor(
    private inner: Transport,
    public settings: NetSimSettings,
    private rand: () => number = Math.random,
    private now: () => number = () => performance.now(),
    private later: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
  ) {
    inner.onMessage = (from, data) => this.delay('in', () => this.onMessage?.(from, data));
    inner.onPeerJoin = (id) => this.onPeerJoin?.(id);
    inner.onPeerLeave = (id) => this.onPeerLeave?.(id);
    inner.onError = (m) => this.onError?.(m);
  }

  get id(): string {
    return this.inner.id;
  }
  get hostId(): string {
    return this.inner.hostId;
  }
  get isHost(): boolean {
    return this.inner.isHost;
  }
  get lan(): boolean | undefined {
    return this.inner.lan;
  }
  get hostLostMessage(): string | undefined {
    return this.inner.hostLostMessage;
  }
  preferredSlot(peer: string): number {
    return this.inner.preferredSlot?.(peer) ?? -1;
  }
  peers(): string[] {
    return this.inner.peers();
  }

  /** Half of the configured latency is applied on each side. */
  private delay(dir: 'in' | 'out', fn: () => void): void {
    const s = this.settings;
    let d = s.latency / 2 + (this.rand() * 2 - 1) * (s.jitter / 2);
    if (this.rand() < s.loss) d += s.latency * 2 + 30; // resend after a timeout
    const t = this.now();
    let at = Math.max(t + Math.max(0, d), dir === 'in' ? this.lastIn : this.lastOut);
    if (dir === 'in') this.lastIn = at;
    else this.lastOut = at;
    at -= t;
    if (at <= 0 && s.latency === 0 && s.jitter === 0) fn();
    else this.later(fn, at);
  }

  send(to: string, data: Uint8Array): void {
    const copy = data.slice();
    this.delay('out', () => this.inner.send(to, copy));
  }

  broadcast(data: Uint8Array): void {
    const copy = data.slice();
    this.delay('out', () => this.inner.broadcast(copy));
  }

  close(): void {
    this.inner.close();
  }
}
