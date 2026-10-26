/**
 * ICE servers for online play (docs/multiplayer.md, "Online play"): a public STUN server finds each
 * device's internet address for a direct connection, and a TURN relay carries the game's messages
 * when a direct connection is impossible (phone data, strict routers, school or work networks, and
 * two devices behind the same router that will not loop traffic back).
 *
 * The relay is the one set at build time (VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS, e.g.
 * from the GitHub repository variables TURN_URL / TURN_USER / TURN_PASS), else the free public
 * Open Relay Project server by Metered, which publishes a shared secret for anyone to use: the
 * time-limited user name and password are made from it here (the "TURN REST API" scheme).
 *
 * This module never loads PeerJS and LAN play never calls it (LAN uses no servers of any kind).
 */

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };

/** The Open Relay Project's public static-auth server and its published shared secret. */
export const OPEN_RELAY = { host: 'staticauth.openrelay.metered.ca', secret: 'openrelayprojectsecret' };

/** how long made-up relay credentials stay valid */
const RELAY_TTL_S = 24 * 3600;

/** Which relay this build uses, for messages. */
export function relayName(): string {
  return env.VITE_TURN_URL ? 'the game’s relay server' : 'the free public relay (Open Relay Project)';
}

async function hmacSha1Base64(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}

/** TURN REST API credentials: user `<expiry>:<name>`, password base64(HMAC-SHA1(secret, user)). */
export async function restCredentials(secret: string, nowS: number, ttlS = RELAY_TTL_S): Promise<{ username: string; credential: string }> {
  const username = `${Math.floor(nowS) + ttlS}:ud`;
  return { username, credential: await hmacSha1Base64(secret, username) };
}

/** The relay as an ICE server (null when this browser cannot make the credentials). */
export async function relayServer(): Promise<RTCIceServer | null> {
  if (env.VITE_TURN_URL) return { urls: env.VITE_TURN_URL.split(',').map((u) => u.trim()), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS };
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const h = OPEN_RELAY.host;
    const c = await restCredentials(OPEN_RELAY.secret, Date.now() / 1000);
    // UDP first (fastest), then TCP and TLS on 443, which pass most firewalls
    return { urls: [`turn:${h}:80`, `turn:${h}:443?transport=tcp`, `turns:${h}:443?transport=tcp`], ...c };
  } catch {
    return null;
  }
}

/** STUN plus the relay. */
export async function onlineIceServers(): Promise<RTCIceServer[]> {
  const relay = await relayServer();
  return relay ? [STUN, relay] : [STUN];
}
