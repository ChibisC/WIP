/**
 * WebRTC transport through PeerJS (multiplayer brief, Part D).
 *
 * - The host registers the peer id `ud-<room>` with the signalling server;
 *   guests connect to it. Data then flows between browsers over a reliable,
 *   ordered data channel (star topology: guests ↔ host).
 * - Signalling uses the free public PeerJS server by default. A STUN server
 *   finds a direct route; when a firewall, a phone network or a router blocks
 *   that, a TURN relay carries the data instead (net/relay.ts: the relay set at
 *   build time, else the free public Open Relay Project server).
 * - Everything above this class only sees the `Transport` interface.
 */
import Peer, { DataConnection, PeerOptions } from 'peerjs';
import { relayName } from './relay';
import type { Transport } from './transport';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** how long a guest waits for the channel to the host to open */
const CONNECT_MS = 30000;
/** how long an interrupted connection may take to recover before the player counts as gone */
const RECOVER_MS = 8000;

/** What to try when two devices cannot connect. */
const TRY =
  'A VPN often blocks this: turn it off on both devices and reload. “Check connection” on the Multiplayer screen shows what is blocked; on the same Wi-Fi, LAN mode needs no internet at all.';

/** Signalling server (the free public PeerJS cloud unless VITE_PEER_HOST is set). */
function peerOptions(iceServers: RTCIceServer[]): PeerOptions {
  const o: PeerOptions = { config: { iceServers }, debug: 1 };
  if (env.VITE_PEER_HOST) {
    o.host = env.VITE_PEER_HOST;
    o.port = Number(env.VITE_PEER_PORT || 443);
    o.path = env.VITE_PEER_PATH || '/';
    o.secure = (env.VITE_PEER_SECURE ?? 'true') !== 'false';
  }
  return o;
}

export function hostPeerId(room: string): string {
  return `ud-${room.toLowerCase()}`;
}

/** Human-readable reasons for PeerJS errors. */
function explain(type: string, room: string): string {
  switch (type) {
    case 'peer-unavailable':
      return `No game is open with the code ${room.toUpperCase()}. Check the link, or ask the host to create the game again.`;
    case 'unavailable-id':
      return `The room code ${room.toUpperCase()} is in use. Create the game again for a new code.`;
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Cannot reach the matchmaking server. Check your internet connection (invite links need the deployed site, not a local dev server).';
    case 'browser-incompatible':
      return 'This browser does not support WebRTC data channels.';
    default:
      return `Connection problem (${type}).`;
  }
}

function bytes(d: unknown): Uint8Array | null {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  return null;
}

export class PeerTransport implements Transport {
  onMessage: ((from: string, data: Uint8Array) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  /** resolves once connected (host: registered; guest: channel to the host open) */
  readonly ready: Promise<void>;
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  id = '';
  hostId: string;

  /** `iceServers`: from net/relay.ts `onlineIceServers()` (STUN and the relay). */
  constructor(
    readonly room: string,
    readonly isHost: boolean,
    iceServers: RTCIceServer[],
  ) {
    this.hostId = hostPeerId(room);
    this.peer = isHost ? new Peer(this.hostId, peerOptions(iceServers)) : new Peer(peerOptions(iceServers));
    this.ready = new Promise((resolve, reject) => {
      this.peer.on('open', (id) => {
        this.id = id;
        if (isHost) resolve();
        else this.connectToHost(resolve, reject);
      });
      this.peer.on('error', (err: Error & { type?: string }) => {
        const msg = explain(err.type ?? 'unknown', room);
        this.onError?.(msg);
        reject(new Error(msg));
      });
    });
    this.peer.on('connection', (conn) => {
      if (!isHost) return conn.close(); // guests only talk to the host
      this.attach(conn);
    });
    this.peer.on('disconnected', () => {
      // the signalling link dropped; open data channels keep working, so just try to get it back
      if (!this.peer.destroyed) this.peer.reconnect();
    });
  }

  private connectToHost(resolve: () => void, reject: (e: Error) => void): void {
    const conn = this.peer.connect(this.hostId, { reliable: true, serialization: 'binary' });
    let done = false;
    const fail = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const msg = `Found the game, but could not connect to the host’s device, directly or through ${relayName()}. ${TRY}`;
      this.onError?.(msg);
      reject(new Error(msg));
      conn.close();
    };
    const timer = setTimeout(fail, CONNECT_MS);
    conn.on('iceStateChanged', (s) => {
      if (s === 'failed') fail();
    });
    conn.on('open', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    });
    this.attach(conn);
  }

  private attach(conn: DataConnection): void {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.onPeerJoin?.(conn.peer);
    });
    conn.on('data', (d) => {
      const b = bytes(d);
      if (b) this.onMessage?.(conn.peer, b);
    });
    const gone = () => {
      if (this.conns.get(conn.peer) !== conn) return;
      this.conns.delete(conn.peer);
      this.onPeerLeave?.(conn.peer);
    };
    conn.on('close', gone);
    conn.on('error', gone);
    // 'disconnected' is often a blip (Wi-Fi roaming, a phone switching networks): give it a moment
    let recover: ReturnType<typeof setTimeout> | undefined;
    conn.on('iceStateChanged', (s) => {
      clearTimeout(recover);
      if (s === 'failed') {
        if (this.conns.get(conn.peer) === conn) this.onError?.(`The connection to the other player was lost. ${TRY}`);
        gone();
      } else if (s === 'closed') gone();
      else if (s === 'disconnected') recover = setTimeout(gone, RECOVER_MS);
    });
  }

  peers(): string[] {
    return [...this.conns.keys()];
  }

  send(to: string, data: Uint8Array): void {
    const c = this.conns.get(to);
    if (c?.open) void c.send(data);
  }

  broadcast(data: Uint8Array): void {
    for (const c of this.conns.values()) if (c.open) void c.send(data);
  }

  close(): void {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer.destroy();
  }
}
