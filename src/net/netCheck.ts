/**
 * "Check connection" on the multiplayer screen: which routes this device can offer another player.
 * It gathers ICE candidates once and sorts them: a local address (a plain IP, or an mDNS `.local`
 * name that hides it), an internet address found through STUN, and a relayed address from TURN.
 * Online mode also checks that the matchmaking (PeerJS) server answers.
 */

export interface RouteCheck {
  /** this device's own address on its network: a plain IP, a hidden `.local` name, or none */
  local: 'ip' | 'mdns' | 'none';
  /** an internet address was found through STUN (a direct connection across networks may work) */
  internet: boolean;
  /** the relay answered and gave an address (connections work even when direct ones cannot) */
  relay: boolean;
}

/** Sort one `candidate:` line. */
export function candidateKind(line: string): { type: string; mdns: boolean } {
  const parts = line.replace(/^a=/, '').trim().split(/\s+/);
  const ti = parts.indexOf('typ');
  return { type: ti >= 0 ? parts[ti + 1] ?? '' : '', mdns: /\.local$/i.test(parts[4] ?? '') };
}

/** Sort a set of candidate lines into a route check. */
export function sortCandidates(lines: string[]): RouteCheck {
  const r: RouteCheck = { local: 'none', internet: false, relay: false };
  for (const l of lines) {
    const k = candidateKind(l);
    if (k.type === 'host') r.local = k.mdns ? (r.local === 'ip' ? 'ip' : 'mdns') : 'ip';
    else if (k.type === 'srflx' || k.type === 'prflx') r.internet = true;
    else if (k.type === 'relay') r.relay = true;
  }
  return r;
}

/** Gather every candidate a connection with `iceServers` would offer (at most `ms`). */
export async function checkRoutes(iceServers: RTCIceServer[], ms = 9000): Promise<RouteCheck> {
  if (typeof RTCPeerConnection === 'undefined') return { local: 'none', internet: false, relay: false };
  const pc = new RTCPeerConnection({ iceServers });
  const lines: string[] = [];
  try {
    pc.createDataChannel('check');
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate && e.candidate.candidate) lines.push(e.candidate.candidate);
        else if (!e.candidate) {
          clearTimeout(t);
          resolve();
        }
      });
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .catch(() => {
          clearTimeout(t);
          resolve();
        });
    });
  } finally {
    pc.close();
  }
  return sortCandidates(lines);
}

/** Does the PeerJS matchmaking server answer? (null: not checked, a custom server is set) */
export async function checkMatchmaking(ms = 8000): Promise<boolean | null> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  if (env.VITE_PEER_HOST) return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl?.abort(), ms);
  try {
    const r = await fetch(`https://0.peerjs.com/peerjs/id?ts=${Date.now()}`, { signal: ctl?.signal, cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
