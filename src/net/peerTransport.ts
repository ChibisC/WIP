/**
 * WebRTC transport through PeerJS (multiplayer brief, Part D).
 *
 * - The host registers the peer id `ud-<room>` with the signalling server;
 *   guests connect to it. Data then flows directly between browsers over a
 *   reliable, ordered data channel (star topology: guests ↔ host).
 * - Signalling uses the free public PeerJS server by default. STUN servers
 *   find a direct route; when a firewall blocks that, a TURN relay is needed:
 *   set VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS at build time
 *   (README, "Multiplayer and invite links").
 * - Everything above this class only sees the `Transport` interface.
 */
import Peer, { DataConnection, PeerOptions } from 'peerjs';
import type { Transport } from './transport';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** ICE servers: public STUN, plus TURN when configured. */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];
  if (env.VITE_TURN_URL) servers.push({ urls: env.VITE_TURN_URL.split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  return servers;
}

/** Signalling server (the free public PeerJS cloud unless VITE_PEER_HOST is set). */
function peerOptions(): PeerOptions {
  const o: PeerOptions = { config: { iceServers: iceServers() }, debug: 1 };
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

  constructor(
    readonly room: string,
    readonly isHost: boolean,
  ) {
    this.hostId = hostPeerId(room);
    this.peer = isHost ? new Peer(this.hostId, peerOptions()) : new Peer(peerOptions());
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
    const timer = setTimeout(() => {
      const msg = 'Could not open a direct connection to the host (a firewall may block it; a TURN server fixes that).';
      this.onError?.(msg);
      reject(new Error(msg));
    }, 15000);
    conn.on('open', () => {
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
    conn.on('iceStateChanged', (s) => {
      if (s === 'failed') {
        this.onError?.('The direct connection failed (a firewall may block it; configure a TURN server).');
        gone();
      } else if (s === 'disconnected' || s === 'closed') gone();
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
