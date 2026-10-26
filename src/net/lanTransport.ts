/**
 * LAN transport (docs/multiplayer.md, "LAN play"): WebRTC data channels set up by hand with
 * connection codes (net/lanCode.ts), with no signalling server, STUN or TURN: the RTC
 * configuration has no ICE servers, so the browsers offer only their own local addresses
 * (plain IPs or mDNS `.local` names), which is all two devices on one network need.
 *
 * Star topology as with PeerJS: each joiner has one connection, to the host. The host makes one
 * host code per slot (an offer, ICE gathered in full: no trickling), the joiner turns it into a
 * reply code (the answer), the host enters the reply and the channel opens.
 *
 * Messages of any size: frames of at most 16 KiB on one ordered, reliable channel (a snapshot
 * for a rejoining player is megabytes), sent as the channel's buffer drains.
 */
import { CODE_TTL_S, CodeError, codeExpired, decodeCode, encodeCode, LanCode } from './lanCode';
import type { Transport } from './transport';

/** No ICE servers of any kind: LAN play never contacts anything outside the network. */
export const LAN_RTC_CONFIG: RTCConfiguration = Object.freeze({ iceServers: [] }) as RTCConfiguration;
/** how long ICE gathering may take before the code is made from what was found */
export const GATHER_TIMEOUT_MS = 3000;
/** …but with no address found yet, keep waiting up to this long */
export const GATHER_MAX_MS = 10000;
/** how long the channel may take to open once the host has the reply */
export const OPEN_TIMEOUT_MS = 15000;
const CHUNK = 16 * 1024;
const MAX_MESSAGE = 64 * 1024 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;

export const NETWORK_TIPS =
  'Both devices must be on the same Wi-Fi or network. Guest networks and routers with "client isolation" (or "AP isolation") stop devices from seeing each other, and so does a VPN: turn it off on both devices (or allow local network access in its settings) and reload. Otherwise try a phone hotspot that both devices join.';

/** After a failed connection: the network tips, and where to look next. */
const FAIL_TIPS = `${NETWORK_TIPS} “Check connection” on the LAN screen shows what each device offers (and can let the browser use its real address).`;

/** Safari (and every browser on an iPhone or iPad) hides a page's own network addresses until it may use the microphone or camera. */
export const WEBKIT_TIP =
  'Safari (and every browser on an iPhone or iPad) only lets a web page see this device’s Wi-Fi address once the page may use the microphone or camera. Allow it once: nothing is recorded or sent, the game only needs the address to find the other devices.';

export class LanError extends Error {}

/** A WebKit browser: Safari, or any browser on an iPhone or iPad (they all use WebKit). */
export function isWebKitBrowser(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\/|OPR\/|Android/.test(ua);
}

let addressesSeen = false;

/**
 * Does this browser show the page this device's own network addresses? A quick offer with no ICE
 * servers: any candidate at all means yes. Remembered once seen.
 */
export async function lanAddressesVisible(ms = 2500): Promise<boolean> {
  if (addressesSeen) return true;
  if (!PC) return false;
  const pc = new PC(LAN_RTC_CONFIG);
  try {
    pc.createDataChannel('probe');
    await pc.setLocalDescription(await pc.createOffer());
    const seen = await new Promise<boolean>((resolve) => {
      let over = false;
      const fin = (v: boolean) => {
        if (over) return;
        over = true;
        clearTimeout(t);
        resolve(v);
      };
      const any = () => /\na=candidate:/.test(pc.localDescription?.sdp ?? '');
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate && e.candidate.candidate) fin(true);
        else if (!e.candidate) fin(any());
      });
      const t = setTimeout(() => fin(any()), ms);
    });
    if (seen) addressesSeen = true;
    return seen;
  } catch {
    return false;
  } finally {
    try {
      pc.close();
    } catch {
      // closed
    }
  }
}

/** On a WebKit browser that hides the addresses, LAN play needs the one-time microphone permission first. */
export async function lanNeedsPermission(): Promise<boolean> {
  return isWebKitBrowser() && !(await lanAddressesVisible());
}

/**
 * Ask once for the microphone (stopped at once, nothing recorded) so WebKit shows this page the
 * device's addresses for the rest of the visit. Call it from a tap.
 */
export async function unlockLanAddresses(): Promise<void> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) throw new LanError(`This browser cannot ask for the microphone here, so it will not show this device’s Wi-Fi address. ${WEBKIT_TIP}`);
  let stream: MediaStream;
  try {
    stream = await md.getUserMedia({ audio: true });
  } catch {
    try {
      stream = await md.getUserMedia({ video: true });
    } catch {
      throw new LanError('Microphone and camera access were refused, so the browser will not show this device’s Wi-Fi address. Allow one of them for this site (on iPhone and iPad: Settings → Safari → Microphone), reload the page and try again.');
    }
  }
  for (const t of stream.getTracks()) t.stop();
  addressesSeen = await lanAddressesVisible();
}

/** A code made from a description with no address cannot connect: say why instead. */
function noAddress(): LanError {
  return new LanError(`This device’s network address could not be found. ${isWebKitBrowser() ? WEBKIT_TIP : NETWORK_TIPS}`);
}

const nowS = () => Math.floor(Date.now() / 1000);
const randU32 = () => (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
export const peerOfSession = (session: number) => `lan-${(session >>> 0).toString(16).padStart(8, '0')}`;

/** The RTCPeerConnection constructor (tests and the LAN guard may replace it). */
let PC: typeof RTCPeerConnection | undefined = typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : undefined;

/**
 * In LAN mode, report any peer connection made with ICE servers (none should be: this guards
 * against a later change sneaking a STUN server in). Installed once LAN mode starts.
 */
export function installLanGuard(log: (msg: string, cfg: RTCConfiguration | undefined) => void = (m, c) => console.error(m, c)): void {
  const g = globalThis as unknown as { RTCPeerConnection?: typeof RTCPeerConnection; __udLanGuard?: boolean };
  if (!g.RTCPeerConnection || g.__udLanGuard) return;
  const Orig = g.RTCPeerConnection;
  const Guarded = function (this: unknown, cfg?: RTCConfiguration) {
    if (cfg?.iceServers && cfg.iceServers.length) log('[LAN] an RTCPeerConnection was created with ICE servers in LAN mode', cfg);
    return new Orig(cfg);
  } as unknown as typeof RTCPeerConnection;
  Guarded.prototype = Orig.prototype;
  Object.setPrototypeOf(Guarded, Orig);
  g.RTCPeerConnection = Guarded;
  g.__udLanGuard = true;
  PC = Guarded;
}

/**
 * Wait for ICE gathering to finish and return the full local description. After `ms` the code is
 * made from what was found, but never from a description with no address in it while waiting longer
 * (up to `GATHER_MAX_MS`) can still find one: a busy device can be slow to list its interfaces.
 */
function gathered(pc: RTCPeerConnection, ms = GATHER_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(t);
      clearTimeout(t2);
      pc.removeEventListener('icegatheringstatechange', check);
      pc.removeEventListener('icecandidate', onCandidate);
      resolve(pc.localDescription?.sdp ?? '');
    };
    const hasAddress = () => /\na=candidate:/.test(pc.localDescription?.sdp ?? '');
    let late = false;
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const onCandidate = () => {
      if (late && hasAddress()) done();
    };
    const t = setTimeout(() => {
      if (hasAddress()) done();
      else late = true;
    }, ms);
    const t2 = setTimeout(done, GATHER_MAX_MS);
    pc.addEventListener('icegatheringstatechange', check);
    pc.addEventListener('icecandidate', onCandidate);
    check();
  });
}

/** Reassemble framed messages: [0 | whole], [1 | u32 total | part], [2 | part], [3 | last part]. */
class Frames {
  private buf: Uint8Array | null = null;
  private at = 0;
  take(f: Uint8Array): Uint8Array | null {
    const k = f[0];
    if (k === 0) return f.slice(1);
    if (k === 1) {
      if (f.length < 5) throw new Error('bad frame');
      const total = new DataView(f.buffer, f.byteOffset, f.byteLength).getUint32(1);
      if (total > MAX_MESSAGE) throw new Error('message too large');
      this.buf = new Uint8Array(total);
      this.at = 0;
      return this.put(f.subarray(5), false);
    }
    if (k === 2 || k === 3) return this.put(f.subarray(1), k === 3);
    throw new Error('bad frame');
  }
  private put(p: Uint8Array, last: boolean): Uint8Array | null {
    if (!this.buf || this.at + p.length > this.buf.length) throw new Error('bad frame');
    this.buf.set(p, this.at);
    this.at += p.length;
    if (!last) return null;
    if (this.at !== this.buf.length) throw new Error('bad frame');
    const out = this.buf;
    this.buf = null;
    return out;
  }
}

/** Split a message into frames. */
export function frame(data: Uint8Array): Uint8Array[] {
  if (data.length + 1 <= CHUNK) {
    const f = new Uint8Array(data.length + 1);
    f.set(data, 1);
    return [f];
  }
  const out: Uint8Array[] = [];
  const first = new Uint8Array(CHUNK);
  first[0] = 1;
  new DataView(first.buffer).setUint32(1, data.length);
  first.set(data.subarray(0, CHUNK - 5), 5);
  out.push(first);
  for (let at = CHUNK - 5; at < data.length; at += CHUNK - 1) {
    const part = data.subarray(at, Math.min(data.length, at + CHUNK - 1));
    const f = new Uint8Array(part.length + 1);
    f[0] = at + part.length >= data.length ? 3 : 2;
    f.set(part, 1);
    out.push(f);
  }
  return out;
}
export const unframe = () => new Frames();

interface Link {
  peer: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  open: boolean;
  frames: Frames;
  out: Uint8Array[];
  lostTimer: ReturnType<typeof setTimeout> | null;
}

interface Pending {
  session: number;
  slot: number;
  created: number;
  link: Link;
  expire: ReturnType<typeof setTimeout>;
  used: boolean;
}

/** Status of a code exchange, for the dialogs. */
export type LinkEvent = { kind: 'open'; peer: string; slot: number } | { kind: 'failed'; peer: string; slot: number; message: string } | { kind: 'expired'; session: number; slot: number };

export class ManualRtcTransport implements Transport {
  onMessage: ((from: string, data: Uint8Array) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  /** code exchanges finishing or failing (the dialogs listen) */
  onLink: ((e: LinkEvent) => void) | null = null;
  /** the message a joiner shows when the host's connection goes */
  readonly hostLostMessage = 'Lost the connection to the host.';
  readonly lan = true;
  private links = new Map<string, Link>();
  private pending = new Map<number, Pending>();
  private slotOf = new Map<string, number>();
  private closed = false;
  private _id: string;

  private constructor(readonly isHost: boolean) {
    this._id = isHost ? 'host' : '';
  }

  static host(): ManualRtcTransport {
    return new ManualRtcTransport(true);
  }

  static joiner(): ManualRtcTransport {
    return new ManualRtcTransport(false);
  }

  get id(): string {
    return this._id;
  }

  get hostId(): string {
    return 'host';
  }

  /** Host: the slot a joining peer's host code was made for (the lobby seats them there). */
  preferredSlot(peer: string): number {
    return this.slotOf.get(peer) ?? -1;
  }

  private newLink(peer: string): Link {
    if (!PC) throw new LanError('This page has no WebRTC (some embedding pages block it), and LAN play needs it. Open the game on its website, https://chibisc.github.io/WIP/, and play from there.');
    const pc = new PC(LAN_RTC_CONFIG);
    // a pre-agreed channel: both sides open it, nothing extra to signal
    const dc = pc.createDataChannel('ud', { negotiated: true, id: 0, ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = HIGH_WATER / 4;
    const link: Link = { peer, pc, dc, open: false, frames: new Frames(), out: [], lostTimer: null };
    dc.onopen = () => {
      link.open = true;
      this.links.set(link.peer, link);
      this.pump(link);
    };
    dc.onmessage = (e: MessageEvent) => {
      const d = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : ArrayBuffer.isView(e.data) ? new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength) : null;
      if (!d || !d.length) return;
      let msg: Uint8Array | null;
      try {
        msg = link.frames.take(d);
      } catch {
        this.drop(link, 'The connection sent a damaged message.');
        return;
      }
      if (msg) this.onMessage?.(link.peer, msg);
    };
    dc.onbufferedamountlow = () => this.pump(link);
    dc.onclose = () => this.drop(link);
    const watch = () => {
      const s = pc.connectionState ?? pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') this.drop(link);
      else if (s === 'disconnected') {
        // a blip (Wi-Fi roaming) can recover; give it a few seconds
        if (!link.lostTimer) link.lostTimer = setTimeout(() => this.drop(link), 6000);
      } else if (s === 'connected' && link.lostTimer) {
        clearTimeout(link.lostTimer);
        link.lostTimer = null;
      }
    };
    pc.addEventListener('connectionstatechange', watch);
    pc.addEventListener('iceconnectionstatechange', watch);
    return link;
  }

  private pump(link: Link): void {
    if (!link.open || link.dc.readyState !== 'open') return;
    while (link.out.length && link.dc.bufferedAmount < HIGH_WATER) {
      const f = link.out.shift()!;
      try {
        link.dc.send(f as Uint8Array<ArrayBuffer>);
      } catch {
        this.drop(link);
        return;
      }
    }
  }

  private drop(link: Link, why = ''): void {
    if (link.lostTimer) clearTimeout(link.lostTimer);
    link.lostTimer = null;
    const was = this.links.get(link.peer) === link;
    if (was) this.links.delete(link.peer);
    try {
      link.dc.close();
      link.pc.close();
    } catch {
      // already closed
    }
    if (why) this.onError?.(why);
    if (was) this.onPeerLeave?.(link.peer);
  }

  // ---------------------------------------------------------------- host

  /** Host: make a host code for a slot (an offer with every local address in it). */
  async createHostCode(slot: number): Promise<{ code: string; session: number; expiresAt: number }> {
    if (!this.isHost) throw new LanError('Only the host makes host codes.');
    const session = randU32();
    const peer = peerOfSession(session);
    const link = this.newLink(peer);
    const offer = await link.pc.createOffer();
    await link.pc.setLocalDescription(offer);
    const sdp = await gathered(link.pc);
    if (!/\na=candidate:/.test(sdp)) {
      try {
        link.pc.close();
      } catch {
        // closed
      }
      throw noAddress();
    }
    const created = nowS();
    const code = await encodeCode({ kind: 'host', session, slot, created, sdp });
    const p: Pending = {
      session,
      slot,
      created,
      link,
      used: false,
      expire: setTimeout(() => {
        if (p.used) return;
        this.cancel(session);
        this.onLink?.({ kind: 'expired', session, slot });
      }, CODE_TTL_S * 1000),
    };
    this.pending.set(session, p);
    this.slotOf.set(peer, slot);
    return { code, session, expiresAt: (created + CODE_TTL_S) * 1000 };
  }

  /** Host: forget an unused host code. */
  cancel(session: number): void {
    const p = this.pending.get(session);
    if (!p) return;
    clearTimeout(p.expire);
    this.pending.delete(session);
    if (!p.link.open) {
      try {
        p.link.pc.close();
      } catch {
        // closed
      }
    }
  }

  /**
   * Host: the joiner's reply code. Resolves when the channel is open (the peer has joined);
   * rejects with a message for the player.
   */
  async acceptReply(text: string): Promise<{ peer: string; slot: number }> {
    let c: LanCode;
    try {
      c = await decodeCode(text);
    } catch (e) {
      throw new LanError(e instanceof CodeError ? e.message : 'That code could not be read.');
    }
    if (c.kind === 'host') throw new LanError('This is a host code: it goes to the joining player. Here, enter the reply code that player’s device shows (it starts with UD1R-).');
    const p = this.pending.get(c.session);
    if (!p) throw new LanError('This reply belongs to a code that expired, was cancelled or was already used. Make a new host code and start again.');
    if (p.used) throw new LanError('This code was already used. Make a new host code for the next player.');
    if (codeExpired(p.created, nowS(), 0)) {
      this.cancel(c.session);
      throw new LanError('This code expired (codes last 5 minutes). Ask for a new one: make a new host code.');
    }
    p.used = true;
    clearTimeout(p.expire);
    const link = p.link;
    try {
      await link.pc.setRemoteDescription({ type: 'answer', sdp: c.sdp });
    } catch {
      this.pending.delete(c.session);
      throw new LanError('The reply code was not accepted by the browser. Ask the player to scan your code again for a fresh reply.');
    }
    await this.waitOpen(link, p.slot);
    this.pending.delete(c.session);
    this.onPeerJoin?.(link.peer);
    return { peer: link.peer, slot: p.slot };
  }

  private waitOpen(link: Link, slot: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (link.open) return resolve();
      const fail = (message: string) => {
        clearTimeout(t);
        link.dc.removeEventListener('open', ok);
        try {
          link.pc.close();
        } catch {
          // closed
        }
        this.onLink?.({ kind: 'failed', peer: link.peer, slot, message });
        reject(new LanError(message));
      };
      const ok = () => {
        clearTimeout(t);
        this.onLink?.({ kind: 'open', peer: link.peer, slot });
        resolve();
      };
      const t = setTimeout(() => fail(`Could not connect within ${OPEN_TIMEOUT_MS / 1000} seconds. ${FAIL_TIPS}`), OPEN_TIMEOUT_MS);
      link.dc.addEventListener('open', ok);
      link.pc.addEventListener('connectionstatechange', () => {
        if (link.pc.connectionState === 'failed') fail(`The connection failed. ${FAIL_TIPS}`);
      });
    });
  }

  // ---------------------------------------------------------------- joiner

  /**
   * Joiner: turn the host's code into a reply code. `opened` resolves when the host has
   * entered the reply and the channel is open.
   */
  async answerHostCode(text: string, usedSessions: ReadonlySet<number> = new Set()): Promise<{ code: string; slot: number; opened: Promise<void> }> {
    if (this.isHost) throw new LanError('The host enters reply codes, not host codes.');
    let c: LanCode;
    try {
      c = await decodeCode(text);
    } catch (e) {
      throw new LanError(e instanceof CodeError ? e.message : 'That code could not be read.');
    }
    if (c.kind === 'reply') throw new LanError('This is a reply code: it goes to the host. Here, enter the code the host’s screen shows (it starts with UD1H-).');
    if (usedSessions.has(c.session)) throw new LanError('This code was already used. Ask the host for a new one.');
    if (codeExpired(c.created, nowS())) throw new LanError('This code expired (codes last 5 minutes). Ask the host for a new one.');
    for (const l of this.links.values()) this.drop(l);
    this._id = peerOfSession(c.session);
    const link = this.newLink(this._id);
    link.peer = this.hostId;
    try {
      await link.pc.setRemoteDescription({ type: 'offer', sdp: c.sdp });
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
    } catch {
      throw new LanError('The browser could not use this code. Ask the host for a new one.');
    }
    const sdp = await gathered(link.pc);
    if (!/\na=candidate:/.test(sdp)) throw noAddress();
    const code = await encodeCode({ kind: 'reply', session: c.session, slot: c.slot, created: c.created, sdp });
    const opened = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new LanError('The host did not enter the reply code in time (codes last 5 minutes). Ask the host for a new code.')), Math.max(10000, (c.created + CODE_TTL_S + 60) * 1000 - Date.now()));
      link.dc.addEventListener('open', () => {
        clearTimeout(t);
        this.onPeerJoin?.(this.hostId);
        resolve();
      });
      link.pc.addEventListener('connectionstatechange', () => {
        if (link.pc.connectionState === 'failed') {
          clearTimeout(t);
          reject(new LanError(`The connection failed. ${FAIL_TIPS}`));
        }
      });
    });
    opened.catch(() => undefined);
    return { code, slot: c.slot, opened };
  }

  // ---------------------------------------------------------------- Transport

  peers(): string[] {
    return [...this.links.keys()];
  }

  send(to: string, data: Uint8Array): void {
    const l = this.links.get(to);
    if (!l?.open || this.closed) return;
    l.out.push(...frame(data));
    this.pump(l);
  }

  broadcast(data: Uint8Array): void {
    for (const p of this.links.keys()) this.send(p, data);
  }

  /** Test hook: cut the connection to a peer as a network failure would (no goodbye). */
  sever(peer: string = this.isHost ? '' : this.hostId): void {
    const l = this.links.get(peer);
    if (l) this.drop(l);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of [...this.pending.keys()]) this.cancel(p);
    for (const l of [...this.links.values()]) {
      // let queued messages (the goodbye) go out before closing
      const done = () => {
        try {
          l.dc.close();
          l.pc.close();
        } catch {
          // closed
        }
      };
      if (l.dc.bufferedAmount > 0 || l.out.length) setTimeout(done, 300);
      else done();
    }
    this.links.clear();
  }
}
