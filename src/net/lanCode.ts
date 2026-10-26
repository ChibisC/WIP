/**
 * LAN connection codes (docs/multiplayer.md, "LAN play"): a WebRTC session description
 * packed into a short text that players copy, paste or scan as a QR code, so two browsers on
 * the same network connect with no signalling server, STUN or TURN.
 *
 *   UD1H-<base64url>   a host code (an offer, for one slot)
 *   UD1R-<base64url>   a reply code (the joining player's answer)
 *
 * The payload is binary: a mode byte, the session id (ties a reply to its host code), the slot,
 * the time the code was made, the body, and a CRC-16 over the kind and everything before it, so
 * a mistyped or truncated code is caught before it reaches WebRTC.
 *
 * The body is normally the *compact* form: only what a data-channel connection needs (ICE
 * username fragment and password, the DTLS fingerprint and role, the data-channel mid and SCTP
 * port, and each local UDP host candidate as raw bytes: IPv4, IPv6 or an mDNS `<uuid>.local`
 * name); `toSdp` rebuilds a minimal standard SDP from it. That makes a code about 170
 * characters. A session description the compact form cannot represent is sent stripped of
 * unneeded lines and deflated instead (or plain, where the browser cannot compress).
 *
 * Everything decoded is validated and size-limited before use.
 */

export const CODE_VERSION = 1;
/** a code is good for five minutes (host codes also expire once used) */
export const CODE_TTL_S = 300;
/** the joiner's clock may differ from the host's this much before an old code is refused */
export const CLOCK_SKEW_S = 120;

export type CodeKind = 'host' | 'reply';

export interface IceCandidate {
  /** IPv4 / IPv6 address or mDNS host name */
  address: string;
  port: number;
}

/** What a connection needs from a session description. */
export interface CompactSdp {
  ufrag: string;
  pwd: string;
  /** 'sha-256' etc. */
  fpAlg: string;
  /** fingerprint bytes */
  fp: Uint8Array;
  setup: 'actpass' | 'active' | 'passive';
  mid: string;
  sctpPort: number;
  maxMessageSize: number;
  candidates: IceCandidate[];
}

export interface LanCode {
  kind: CodeKind;
  /** u32: a reply carries its host code's session */
  session: number;
  /** the lobby slot a host code was made for (0–3) */
  slot: number;
  /** unix seconds when the code was made (the host's clock for both) */
  created: number;
  /** the session description to hand to setRemoteDescription */
  sdp: string;
}

export type CodeProblem = 'notCode' | 'damaged' | 'version' | 'tooLong';

export class CodeError extends Error {
  constructor(
    readonly problem: CodeProblem,
    message: string,
  ) {
    super(message);
  }
}

const MAX_TEXT = 3000;
const MAX_PAYLOAD = 2200;
const MAX_SDP = 8192;
const MAX_CANDIDATES = 16;
const MODE_COMPACT = 1;
const MODE_DEFLATE = 2;
const MODE_PLAIN = 3;

const FP_ALGS = ['sha-256', 'sha-384', 'sha-512', 'sha-1'] as const;
const FP_LEN: Record<string, number> = { 'sha-256': 32, 'sha-384': 48, 'sha-512': 64, 'sha-1': 20 };
const SETUPS = ['actpass', 'active', 'passive'] as const;
const ICE_CHARS = /^[A-Za-z0-9+/]+$/;
const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
const HOSTNAME = /^[A-Za-z0-9.-]{1,253}$/;

// ---------------------------------------------------------------------------- SDP

/** Pull the compact fields out of a session description; null if it has something they cannot hold. */
export function compactSdp(sdp: string): CompactSdp | null {
  const lines = sdp.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let ufrag = '';
  let pwd = '';
  let fpAlg = '';
  let fpHex = '';
  let setup = '';
  let mid = '';
  let sctpPort = 5000;
  let maxMessageSize = 0;
  let media = 0;
  const candidates: IceCandidate[] = [];
  for (const l of lines) {
    if (l.startsWith('m=')) {
      media++;
      if (!/^m=application \d+ (UDP\/)?DTLS\/SCTP webrtc-datachannel$/.test(l)) return null;
    } else if (l.startsWith('a=ice-ufrag:')) ufrag = l.slice(12);
    else if (l.startsWith('a=ice-pwd:')) pwd = l.slice(10);
    else if (l.startsWith('a=fingerprint:')) {
      if (fpAlg) continue; // keep the first
      const [alg, hex] = l.slice(14).split(' ');
      fpAlg = (alg || '').toLowerCase();
      fpHex = hex || '';
    } else if (l.startsWith('a=setup:')) setup = l.slice(8);
    else if (l.startsWith('a=mid:')) mid = l.slice(6);
    else if (l.startsWith('a=sctp-port:')) sctpPort = Number(l.slice(12));
    else if (l.startsWith('a=max-message-size:')) maxMessageSize = Number(l.slice(19));
    else if (l.startsWith('a=candidate:')) {
      // foundation component transport priority address port typ type …
      const f = l.slice(12).split(' ');
      if (f.length < 8 || f[1] !== '1' || f[6] !== 'typ') continue;
      if (f[2].toLowerCase() !== 'udp' || f[7] !== 'host') continue; // LAN: UDP host candidates only
      const port = Number(f[5]);
      if (!(port > 0 && port < 65536)) continue;
      if (candidates.length < MAX_CANDIDATES && !candidates.some((c) => c.address === f[4] && c.port === port)) candidates.push({ address: f[4], port });
    }
  }
  if (media !== 1) return null;
  if (!ufrag || !pwd || !ICE_CHARS.test(ufrag) || !ICE_CHARS.test(pwd) || ufrag.length > 255 || pwd.length > 255) return null;
  if (!(FP_ALGS as readonly string[]).includes(fpAlg)) return null;
  const fp = hexBytes(fpHex);
  if (!fp || fp.length !== FP_LEN[fpAlg]) return null;
  if (!(SETUPS as readonly string[]).includes(setup)) return null;
  if (!mid || mid.length > 32 || !/^[\x21-\x7e]+$/.test(mid)) return null;
  if (!(sctpPort > 0 && sctpPort < 65536)) return null;
  for (const c of candidates) if (!addressBytes(c.address)) return null;
  return { ufrag, pwd, fpAlg, fp, setup: setup as CompactSdp['setup'], mid, sctpPort, maxMessageSize: Math.max(0, Math.min(0xffffffff, maxMessageSize | 0)), candidates };
}

/** A minimal standard session description for a data channel, from the compact fields. */
export function toSdp(c: CompactSdp, session: number): string {
  const L: string[] = [
    'v=0',
    `o=- ${session >>> 0} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${c.mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];
  c.candidates.forEach((cd, i) => L.push(`a=candidate:${i + 1} 1 udp ${2122260223 - i * 256} ${cd.address} ${cd.port} typ host generation 0`));
  L.push('a=end-of-candidates');
  L.push(`a=ice-ufrag:${c.ufrag}`, `a=ice-pwd:${c.pwd}`, 'a=ice-options:trickle');
  L.push(`a=fingerprint:${c.fpAlg} ${[...c.fp].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')}`);
  L.push(`a=setup:${c.setup}`, `a=mid:${c.mid}`, `a=sctp-port:${c.sctpPort}`);
  if (c.maxMessageSize) L.push(`a=max-message-size:${c.maxMessageSize}`);
  return L.join('\r\n') + '\r\n';
}

/** Lines a data-channel connection does not need (for the deflated fallback). */
export function stripSdp(sdp: string): string {
  const keep = /^(v=|o=|s=|t=|m=|c=|a=(group|ice-ufrag|ice-pwd|ice-options|fingerprint|setup|mid|sctp-port|sctpmap|max-message-size|candidate|end-of-candidates))/;
  return (
    sdp
      .split(/\r?\n/)
      .filter((l) => keep.test(l))
      // TCP and server-derived candidates are useless on a LAN without servers
      .filter((l) => !l.startsWith('a=candidate:') || / udp /i.test(l + ' ') && / typ host/.test(l))
      .join('\r\n') + '\r\n'
  );
}

function hexBytes(hex: string): Uint8Array | null {
  const parts = hex.split(':');
  if (!parts.length || parts.length > 64) return null;
  const out = new Uint8Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    if (!/^[0-9A-Fa-f]{2}$/.test(parts[i])) return null;
    out[i] = parseInt(parts[i], 16);
  }
  return out;
}

/** [type, bytes]: 0 IPv4, 1 IPv6, 2 mDNS uuid name, 3 other host name. */
function addressBytes(a: string): [number, Uint8Array] | null {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((x) => x > 255)) return null;
    return [0, Uint8Array.from(b)];
  }
  const u = UUID_LOCAL.exec(a);
  if (u) return [2, hexBytes(u.slice(1).join('').match(/../g)!.join(':'))!];
  if (a.includes(':')) {
    const v6 = ipv6Bytes(a);
    return v6 ? [1, v6] : null;
  }
  if (HOSTNAME.test(a)) return [3, new TextEncoder().encode(a)];
  return null;
}

function ipv6Bytes(a: string): Uint8Array | null {
  if (a.includes('%') || a.length > 45) return null;
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(':') : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if ((halves.length === 2 && fill < 1) || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(Math.max(0, fill)).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i])) return null;
    const v = parseInt(groups[i], 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 255;
  }
  return out;
}

function bytesAddress(type: number, b: Uint8Array): string {
  if (type === 0) return [...b].join('.');
  if (type === 1) {
    // RFC 5952: the longest run of two or more zero groups becomes '::'
    const g: number[] = [];
    for (let i = 0; i < 16; i += 2) g.push((b[i] << 8) | b[i + 1]);
    let best = -1;
    let bestLen = 1;
    for (let i = 0; i < 8; ) {
      if (g[i] !== 0) {
        i++;
        continue;
      }
      let j = i;
      while (j < 8 && g[j] === 0) j++;
      if (j - i > bestLen) (best = i), (bestLen = j - i);
      i = j;
    }
    const hex = (a: number[]) => a.map((x) => x.toString(16)).join(':');
    return best < 0 ? hex(g) : `${hex(g.slice(0, best))}::${hex(g.slice(best + bestLen))}`;
  }
  if (type === 2) {
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
  }
  return new TextDecoder().decode(b);
}

// ---------------------------------------------------------------------------- bytes

class Writer {
  private b: number[] = [];
  u8(v: number): void {
    this.b.push(v & 255);
  }
  u16(v: number): void {
    this.b.push((v >> 8) & 255, v & 255);
  }
  u32(v: number): void {
    this.b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  }
  bytes(a: Uint8Array): void {
    for (const x of a) this.b.push(x);
  }
  str(s: string): void {
    const e = new TextEncoder().encode(s);
    this.u8(e.length);
    this.bytes(e);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.b);
  }
}

class Reader {
  i = 0;
  constructor(private b: Uint8Array) {}
  private need(n: number): void {
    if (this.i + n > this.b.length) throw new CodeError('damaged', DAMAGED);
  }
  u8(): number {
    this.need(1);
    return this.b[this.i++];
  }
  u16(): number {
    this.need(2);
    const v = (this.b[this.i] << 8) | this.b[this.i + 1];
    this.i += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = ((this.b[this.i] << 24) | (this.b[this.i + 1] << 16) | (this.b[this.i + 2] << 8) | this.b[this.i + 3]) >>> 0;
    this.i += 4;
    return v;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.b.slice(this.i, this.i + n);
    this.i += n;
    return v;
  }
  str(): string {
    const n = this.u8();
    return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes(n));
  }
  get rest(): number {
    return this.b.length - this.i;
  }
}

/** CRC-16/CCITT-FALSE. */
export function crc16(b: Uint8Array): number {
  let c = 0xffff;
  for (const x of b) {
    c ^= x << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

export function toB64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------- deflate

/** Compression for the fallback form: the browser's streams, or none (the code says which). */
export interface Deflater {
  deflate(b: Uint8Array): Promise<Uint8Array | null>;
  inflate(b: Uint8Array, limit: number): Promise<Uint8Array>;
}

async function streamThrough(b: Uint8Array, s: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }, limit: number): Promise<Uint8Array> {
  const w = s.writable.getWriter();
  void w.write(b).then(() => w.close()).catch(() => undefined);
  const r = s.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > limit) {
      void r.cancel();
      throw new CodeError('damaged', DAMAGED);
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
}

export const nativeDeflater: Deflater = {
  async deflate(b) {
    const CS = (globalThis as { CompressionStream?: new (f: string) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).CompressionStream;
    if (!CS) return null;
    try {
      return await streamThrough(b, new CS('deflate-raw'), MAX_PAYLOAD * 8);
    } catch {
      return null;
    }
  },
  async inflate(b, limit) {
    const DS = (globalThis as { DecompressionStream?: new (f: string) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).DecompressionStream;
    if (DS) {
      try {
        return await streamThrough(b, new DS('deflate-raw'), limit);
      } catch {
        throw new CodeError('damaged', DAMAGED);
      }
    }
    // the copy of fflate that ships with three.js (already in the build)
    const { inflateSync } = await import('three/examples/jsm/libs/fflate.module.js');
    try {
      const out = inflateSync(b, { out: new Uint8Array(limit) });
      return out;
    } catch {
      throw new CodeError('damaged', DAMAGED);
    }
  },
};

// ---------------------------------------------------------------------------- codes

const DAMAGED = 'This code is damaged or incomplete. Copy the whole code again, or scan the QR code.';
const NOT_CODE = 'That is not a connection code. Codes start with UD1H- (from the host) or UD1R- (a reply).';

const prefix = (k: CodeKind) => `UD${CODE_VERSION}${k === 'host' ? 'H' : 'R'}-`;

/** Pack a code. `sdp` is the browser's full local description (after ICE gathering). */
export async function encodeCode(code: LanCode, deflater: Deflater = nativeDeflater): Promise<string> {
  const w = new Writer();
  const c = compactSdp(code.sdp);
  let mode = MODE_COMPACT;
  let body: Uint8Array;
  if (c) {
    const b = new Writer();
    b.str(c.ufrag);
    b.str(c.pwd);
    b.u8(FP_ALGS.indexOf(c.fpAlg as (typeof FP_ALGS)[number]));
    b.bytes(c.fp);
    b.u8(SETUPS.indexOf(c.setup));
    b.str(c.mid);
    b.u16(c.sctpPort);
    b.u32(c.maxMessageSize);
    b.u8(c.candidates.length);
    for (const cd of c.candidates) {
      const [t, a] = addressBytes(cd.address)!;
      b.u8(t);
      if (t === 3) b.u8(a.length);
      b.bytes(a);
      b.u16(cd.port);
    }
    body = b.done();
  } else {
    const plain = new TextEncoder().encode(stripSdp(code.sdp));
    const z = await deflater.deflate(plain);
    if (z && z.length < plain.length) {
      mode = MODE_DEFLATE;
      body = z;
    } else {
      mode = MODE_PLAIN;
      body = plain;
    }
  }
  w.u8(mode);
  w.u32(code.session >>> 0);
  w.u8(code.slot);
  w.u32(code.created >>> 0);
  w.bytes(body);
  const payload = w.done();
  const kindByte = code.kind === 'host' ? 0x48 : 0x52;
  const crc = crc16(Uint8Array.from([CODE_VERSION, kindByte, ...payload]));
  const all = new Uint8Array(payload.length + 2);
  all.set(payload);
  all[payload.length] = crc >> 8;
  all[payload.length + 1] = crc & 255;
  return prefix(code.kind) + toB64url(all);
}

/**
 * Find the code in pasted or scanned text. A code wrapped over several lines is joined up; words
 * after it (the rest of a chat message) cannot be told from code characters, so `bodies` lists
 * the code with 0, 1, 2… trailing whitespace-separated pieces dropped, longest first, and the
 * checksum decides.
 */
export function extractCode(text: string): { kind: CodeKind; version: number; body: string; bodies: string[] } | null {
  if (text.length > MAX_TEXT * 2) return null;
  const m = /UD(\d+)([HR])-([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*)/.exec(text);
  if (!m) return null;
  const parts = m[3].split(/\s+/);
  const bodies: string[] = [];
  for (let n = parts.length; n >= 1 && bodies.length < 8; n--) bodies.push(parts.slice(0, n).join(''));
  return { version: Number(m[1]), kind: m[2] === 'H' ? 'host' : 'reply', body: bodies[0], bodies };
}

/** Unpack and check a code. Throws CodeError with a message for the player. */
export async function decodeCode(text: string, deflater: Deflater = nativeDeflater): Promise<LanCode> {
  const x = extractCode(text);
  if (!x) throw new CodeError('notCode', NOT_CODE);
  if (x.version !== CODE_VERSION) throw new CodeError('version', 'This code comes from a different version of the game. Both players should reload the game page so they run the same version.');
  if (x.body.length > MAX_TEXT) throw new CodeError('tooLong', DAMAGED);
  const kindByte = x.kind === 'host' ? 0x48 : 0x52;
  let payload: Uint8Array | null = null;
  for (const body of x.bodies) {
    const all = fromB64url(body);
    if (!all || all.length < 12 || all.length > MAX_PAYLOAD) continue;
    const p = all.subarray(0, all.length - 2);
    const crc = (all[all.length - 2] << 8) | all[all.length - 1];
    if (crc16(Uint8Array.from([CODE_VERSION, kindByte, ...p])) === crc) {
      payload = p;
      break;
    }
  }
  if (!payload) throw new CodeError('damaged', DAMAGED);
  const r = new Reader(payload);
  const mode = r.u8();
  const session = r.u32();
  const slot = r.u8();
  const created = r.u32();
  if (slot > 9) throw new CodeError('damaged', DAMAGED);
  let sdp: string;
  if (mode === MODE_COMPACT) {
    const ufrag = r.str();
    const pwd = r.str();
    const alg = FP_ALGS[r.u8()];
    if (!alg) throw new CodeError('damaged', DAMAGED);
    const fp = r.bytes(FP_LEN[alg]);
    const setup = SETUPS[r.u8()];
    if (!setup) throw new CodeError('damaged', DAMAGED);
    const mid = r.str();
    const sctpPort = r.u16();
    const maxMessageSize = r.u32();
    const n = r.u8();
    if (n > MAX_CANDIDATES) throw new CodeError('damaged', DAMAGED);
    const candidates: IceCandidate[] = [];
    for (let i = 0; i < n; i++) {
      const t = r.u8();
      const len = t === 0 ? 4 : t === 1 || t === 2 ? 16 : t === 3 ? r.u8() : -1;
      if (len < 0) throw new CodeError('damaged', DAMAGED);
      const address = bytesAddress(t, r.bytes(len));
      const port = r.u16();
      candidates.push({ address, port });
    }
    if (r.rest !== 0) throw new CodeError('damaged', DAMAGED);
    const c: CompactSdp = { ufrag, pwd, fpAlg: alg, fp, setup, mid, sctpPort, maxMessageSize, candidates };
    if (!ICE_CHARS.test(ufrag) || !ICE_CHARS.test(pwd) || !/^[\x21-\x7e]+$/.test(mid) || !sctpPort) throw new CodeError('damaged', DAMAGED);
    for (const cd of candidates) if (!addressBytes(cd.address) || !cd.port) throw new CodeError('damaged', DAMAGED);
    sdp = toSdp(c, session);
  } else if (mode === MODE_DEFLATE || mode === MODE_PLAIN) {
    const body = r.bytes(r.rest);
    const raw = mode === MODE_DEFLATE ? await deflater.inflate(body, MAX_SDP) : body;
    if (raw.length > MAX_SDP) throw new CodeError('damaged', DAMAGED);
    try {
      sdp = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new CodeError('damaged', DAMAGED);
    }
    if (!sdp.startsWith('v=0') || /[^\x09\x0a\x0d\x20-\x7e]/.test(sdp)) throw new CodeError('damaged', DAMAGED);
  } else throw new CodeError('damaged', DAMAGED);
  return { kind: x.kind, session, slot, created, sdp };
}

/** Has this code run out (by the host's clock, with some slack for the reader's)? */
export function codeExpired(created: number, nowS: number, skew = CLOCK_SKEW_S): boolean {
  return nowS - created > CODE_TTL_S + skew;
}
