/**
 * LAN connection codes (net/lanCode.ts) and the LAN transport's framing and configuration
 * (net/lanTransport.ts), without a browser: realistic session descriptions from Chrome,
 * Firefox and Safari go through codes and back; damaged, wrong-kind, oversized and expired
 * codes are refused with a message.
 *
 *   npx vite-node tests/lan.ts
 */
import { inflateSync, deflateSync } from 'three/examples/jsm/libs/fflate.module.js';
import { CodeError, CODE_TTL_S, codeExpired, compactSdp, decodeCode, Deflater, encodeCode, extractCode, stripSdp, toSdp } from '../src/net/lanCode';
import { frame, LAN_RTC_CONFIG, unframe } from '../src/net/lanTransport';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
async function rejects(p: Promise<unknown>, problem: string): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return e instanceof CodeError && e.problem === problem ? e.message : `(${e instanceof CodeError ? e.problem : String(e)})`;
  }
}

const FP = '75:74:5A:A6:A4:E5:52:F4:A7:67:4C:01:C7:EE:91:3F:21:3D:A2:E3:53:7B:6F:30:86:F2:30:AA:65:FB:04:24';
const CHROME_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:3376715066 1 udp 2113937151 1f4712db-ea17-4bcf-a596-105139dfd8bf.local 54400 typ host generation 0 network-cost 999',
  'a=candidate:2210335482 1 udp 2113939711 5d3b9b4e-1c7e-4f8b-9a1e-7f0c2e1d5a77.local 54401 typ host generation 0 network-cost 999',
  'a=candidate:1510613869 1 tcp 1518280447 1f4712db-ea17-4bcf-a596-105139dfd8bf.local 9 typ host tcptype active generation 0 network-cost 999',
  'a=ice-ufrag:4ZcD',
  'a=ice-pwd:2/1muCWoOi3uHTiCoxexByNN',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FP}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');
const FIREFOX_OFFER = [
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-128.0 4936240958148519357 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=sendrecv',
  `a=fingerprint:sha-256 ${FP.split(':').reverse().join(':')}`,
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 61523 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 192.168.1.20',
  'a=candidate:0 1 UDP 2122252543 a1b2c3d4-0000-4000-8000-00000000abcd.local 61523 typ host',
  'a=candidate:1 1 TCP 2105524479 a1b2c3d4-0000-4000-8000-00000000abcd.local 9 typ host tcptype active',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:9d6ec3a4c17e9fb2a4c0d6b5bd1c7c3e',
  'a=ice-ufrag:5a1c3b2e',
  'a=mid:0',
  'a=setup:actpass',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
  '',
].join('\r\n');
// Safari answers with plain IPs when the page has camera access (after scanning a QR code)
const SAFARI_ANSWER = [
  'v=0',
  'o=- 1726515264112935207 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:842163049 1 udp 2122260223 192.168.1.23 50000 typ host generation 0 network-id 1',
  'a=candidate:1234567890 1 udp 2122262783 fe80::1c2:3ff:fe4a:5b6c 50001 typ host generation 0 network-id 2',
  'a=candidate:999 1 udp 2122194687 2001:db8:85a3::8a2e:370:7334 50002 typ host generation 0',
  'a=candidate:77 1 udp 1686052607 203.0.113.9 50003 typ srflx raddr 192.168.1.23 rport 50000 generation 0',
  'a=ice-ufrag:Zy9x',
  'a=ice-pwd:Kq3vB7sR0mLp2Xw8Nc4Hd6Tf',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FP}`,
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

const plainDeflater: Deflater = {
  deflate: async () => null,
  inflate: async (b) => b,
};
const fflateDeflater: Deflater = {
  deflate: async (b) => deflateSync(b),
  inflate: async (b, limit) => {
    const out = inflateSync(b);
    if (out.length > limit) throw new CodeError('damaged', 'too big');
    return out;
  },
};

async function main(): Promise<void> {
  // ---- the compact form keeps what a connection needs
  for (const [name, sdp, kind] of [
    ['Chrome offer (mDNS names)', CHROME_OFFER, 'host'],
    ['Firefox offer (session-level fingerprint, UDP in capitals)', FIREFOX_OFFER, 'host'],
    ['Safari answer (IPv4 and IPv6, a server candidate)', SAFARI_ANSWER, 'reply'],
  ] as const) {
    const c0 = compactSdp(sdp);
    check(`${name}: compact form found`, !!c0);
    if (!c0) continue;
    const text = await encodeCode({ kind, session: 0xdeadbeef, slot: 2, created: 1_790_000_000, sdp });
    const back = await decodeCode(text);
    const c1 = compactSdp(back.sdp);
    check(`${name}: code under 400 characters`, text.length < 400, `${text.length} characters`);
    check(`${name}: kind, session, slot and time come back`, back.kind === kind && back.session === 0xdeadbeef && back.slot === 2 && back.created === 1_790_000_000);
    check(
      `${name}: ICE credentials, fingerprint, role, mid and port come back`,
      !!c1 && c1.ufrag === c0.ufrag && c1.pwd === c0.pwd && c1.fpAlg === c0.fpAlg && c1.fp.join() === c0.fp.join() && c1.setup === c0.setup && c1.mid === c0.mid && c1.sctpPort === c0.sctpPort && c1.maxMessageSize === c0.maxMessageSize,
    );
    check(
      `${name}: only the UDP host candidates, unchanged`,
      !!c1 && JSON.stringify(c1.candidates) === JSON.stringify(c0.candidates) && c0.candidates.length >= 1 && !/tcp|srflx/i.test(back.sdp.split('\r\n').filter((l) => l.startsWith('a=candidate')).join()),
      c1 ? c1.candidates.map((c) => c.address).join(', ') : '',
    );
  }
  const ipv6 = compactSdp(SAFARI_ANSWER)!.candidates.map((c) => c.address);
  const ipv6back = compactSdp((await decodeCode(await encodeCode({ kind: 'reply', session: 1, slot: 0, created: 1, sdp: SAFARI_ANSWER }))).sdp)!.candidates.map((c) => c.address);
  check('IPv6 addresses come back in their usual short form', JSON.stringify(ipv6back) === JSON.stringify(ipv6), ipv6back.join(', '));
  const rebuilt = toSdp(compactSdp(CHROME_OFFER)!, 7);
  check(
    'the rebuilt description is a minimal data-channel SDP',
    /^v=0\r\n/.test(rebuilt) && rebuilt.includes('m=application 9 UDP/DTLS/SCTP webrtc-datachannel') && rebuilt.includes('a=sctp-port:5000') && rebuilt.includes('a=end-of-candidates') && rebuilt.endsWith('\r\n'),
  );

  // ---- text handling
  const code = await encodeCode({ kind: 'host', session: 42, slot: 1, created: 1_790_000_000, sdp: CHROME_OFFER });
  check('host codes start UD1H-, replies UD1R-', code.startsWith('UD1H-') && (await encodeCode({ kind: 'reply', session: 42, slot: 1, created: 1, sdp: SAFARI_ANSWER })).startsWith('UD1R-'));
  check('a code is URL-safe base64 after its tag', /^UD1H-[A-Za-z0-9_-]+$/.test(code));
  const wrapped = `Here is my code:\n  ${code.slice(0, 60)}\n${code.slice(60, 130)}  \n${code.slice(130)}\n thanks`;
  check('a code split over lines inside other text is found', (await decodeCode(wrapped)).session === 42);
  check('extractCode reads the version and kind', (() => { const e = extractCode('xx UD3R-abc'); return !!e && e.version === 3 && e.kind === 'reply' && e.body === 'abc'; })());

  // ---- refusals
  check('random text is not a code', !!(await rejects(decodeCode('hello there'), 'notCode')));
  check('a code from another version is refused as such', !!(await rejects(decodeCode('UD2H-' + code.slice(5)), 'version')));
  const body = code.slice(5);
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  let caught = 0;
  for (let i = 0; i < body.length; i += 7) if (await rejects(decodeCode('UD1H-' + flip(body, i)), 'damaged')) caught++;
  const tried = Math.ceil(body.length / 7);
  check('a mistyped character is caught (CRC-16)', caught === tried, `${caught}/${tried}`);
  check('a truncated code is caught', !!(await rejects(decodeCode(code.slice(0, code.length - 9)), 'damaged')));
  check('a host code relabelled as a reply fails its check', !!(await rejects(decodeCode('UD1R-' + body), 'damaged')));
  check('an oversized code is refused', !!(await rejects(decodeCode('UD1H-' + 'A'.repeat(5000)), 'tooLong')));
  check('bytes that are not base64url are refused', !!(await rejects(decodeCode('UD1H-' + body.slice(0, 20) + '%%' + body.slice(22)), 'notCode')) || !!(await rejects(decodeCode('UD1H-' + body.slice(0, 20) + '%%' + body.slice(22)), 'damaged')));

  // ---- fallback forms (an SDP the compact form cannot hold: audio as well as data)
  const odd = CHROME_OFFER.replace('a=group:BUNDLE 0', 'a=group:BUNDLE 0 1') + 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=mid:1\r\na=rtpmap:111 opus/48000/2\r\n';
  check('an SDP with more than a data channel has no compact form', compactSdp(odd) === null);
  for (const [name, d] of [
    ['native deflate-raw', undefined],
    ['the bundled inflate (fflate)', fflateDeflater],
    ['no compression available', plainDeflater],
  ] as const) {
    const t = await encodeCode({ kind: 'host', session: 9, slot: 0, created: 5, sdp: odd }, d);
    const b = await decodeCode(t, d);
    check(`fallback with ${name}: comes back stripped`, b.sdp === stripSdp(odd) && !b.sdp.includes('rtpmap') && !b.sdp.includes('tcptype'), `${t.length} characters`);
  }
  // a deflate "bomb": small code, huge output
  const bomb = deflateSync(new Uint8Array(200_000).fill(32));
  const bombPayload = new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 1, ...bomb]);
  const { crc16, toB64url } = await import('../src/net/lanCode');
  const crc = crc16(Uint8Array.from([1, 0x48, ...bombPayload]));
  const bombCode = 'UD1H-' + toB64url(Uint8Array.from([...bombPayload, crc >> 8, crc & 255]));
  check('a code that inflates past the size limit is refused', !!(await rejects(decodeCode(bombCode, fflateDeflater), 'damaged')) || !!(await rejects(decodeCode(bombCode), 'damaged')));

  // ---- expiry
  check('a code is good for five minutes', !codeExpired(1000, 1000 + CODE_TTL_S - 1, 0) && codeExpired(1000, 1000 + CODE_TTL_S + 1, 0));
  check('the joiner allows two minutes of clock difference', !codeExpired(1000, 1000 + CODE_TTL_S + 100) && codeExpired(1000, 1000 + CODE_TTL_S + 130));

  // ---- the transport
  check('LAN peer connections have no ICE servers (no STUN, no TURN)', Array.isArray(LAN_RTC_CONFIG.iceServers) && LAN_RTC_CONFIG.iceServers.length === 0 && Object.isFrozen(LAN_RTC_CONFIG));
  for (const n of [0, 1, 100, 16 * 1024 - 1, 16 * 1024, 70_000, 3_000_000]) {
    const msg = new Uint8Array(n);
    for (let i = 0; i < n; i++) msg[i] = (i * 31 + 7) & 255;
    const frames = frame(msg);
    const u = unframe();
    let out: Uint8Array | null = null;
    let early = false;
    frames.forEach((f, i) => {
      const r = u.take(f);
      if (r && i < frames.length - 1) early = true;
      if (r) out = r;
    });
    const got = out as Uint8Array | null;
    check(`a ${n}-byte message survives framing (${frames.length} frame${frames.length > 1 ? 's' : ''} of ≤ 16 KiB)`, !early && !!got && got.length === n && got.every((v, i) => v === msg[i]) && frames.every((f) => f.length <= 16 * 1024));
  }
  let threw = false;
  try {
    const u = unframe();
    const f = new Uint8Array(9);
    f[0] = 1;
    new DataView(f.buffer).setUint32(1, 0x7fffffff);
    u.take(f);
  } catch {
    threw = true;
  }
  check('a frame announcing a huge message is refused', threw);

  console.log(failed ? `\n${failed} LAN test(s) FAILED` : '\nall LAN tests passed');
  if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}

void main();
