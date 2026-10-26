import { checkMatchmaking, checkRoutes, RouteCheck } from '../net/netCheck';
import { isWebKitBrowser, NETWORK_TIPS, unlockLanAddresses, WEBKIT_TIP } from '../net/lanTransport';

/**
 * "Check connection" on the multiplayer screen (docs/multiplayer.md, "When players cannot connect"):
 * runs the route check for the selected mode and says in plain words what works from this device.
 * LAN mode checks only this device's own address (LAN play contacts no servers); online mode also
 * checks the matchmaking server, STUN and the relay.
 */

type Line = { ok: boolean | null; text: string };

function render(box: HTMLElement, title: string, lines: Line[], allow = false): void {
  const mark = (ok: boolean | null) => (ok === null ? '<span class="nc-i">•</span>' : ok ? '<span class="nc-ok">✓</span>' : '<span class="nc-no">✗</span>');
  box.innerHTML = `<p class="nc-title">${title}</p><ul class="nc-list">${lines.map((l) => `<li>${mark(l.ok)}<span>${l.text}</span></li>`).join('')}</ul>${
    allow ? '<div class="opt-row"><button class="chip" data-a="nc-allow">Allow and check again</button></div>' : ''
  }`;
}

function localLine(local: RouteCheck['local'], lan: boolean): { line: Line; allow: boolean } {
  if (local === 'ip') return { line: { ok: true, text: 'This device shows its own network address, so devices on the same Wi-Fi can find it.' }, allow: false };
  if (local === 'mdns')
    return {
      line: {
        ok: true,
        text: `This browser gives other devices a private name (ending in “.local”) instead of its address. Most Wi-Fi networks handle that.${
          lan ? ' If LAN games will not connect, press Allow: the browser then uses the real address (it asks for the microphone once; nothing is recorded).' : ''
        }`,
      },
      allow: lan,
    };
  if (isWebKitBrowser()) return { line: { ok: false, text: `This browser hides this device’s address. ${WEBKIT_TIP}` }, allow: true };
  return { line: { ok: false, text: `No network address found on this device. ${NETWORK_TIPS}` }, allow: false };
}

async function runLan(box: HTMLElement): Promise<void> {
  render(box, 'Checking this device’s network…', []);
  const r = await checkRoutes([], 4000);
  const { line, allow } = localLine(r.local, true);
  render(box, r.local === 'none' ? 'LAN games cannot connect from this device yet.' : 'LAN games should connect from this device.', [line], allow);
}

async function runOnline(box: HTMLElement): Promise<void> {
  render(box, 'Checking the matchmaking server, direct routes and the relay (up to 10 seconds)…', []);
  const { onlineIceServers, relayName } = await import('../net/relay');
  const [server, r] = await Promise.all([checkMatchmaking(), onlineIceServers().then((s) => checkRoutes(s))]);
  const lines: Line[] = [];
  if (server !== null)
    lines.push(
      server
        ? { ok: true, text: 'Reached the matchmaking server (it introduces the players to each other).' }
        : { ok: false, text: 'Cannot reach the matchmaking server (0.peerjs.com). This network, a firewall or an ad or content blocker stops it, so online games cannot be created or joined here. Try another network, or LAN mode on the same Wi-Fi.' },
    );
  lines.push(
    r.internet
      ? { ok: true, text: 'Found this device’s internet address, so direct connections work with most other networks.' }
      : { ok: false, text: 'Could not find this device’s internet address (this network blocks the lookup), so connections from here need the relay.' },
  );
  const rn = relayName();
  lines.push(
    r.relay
      ? { ok: true, text: `${rn[0].toUpperCase()}${rn.slice(1)} answered, so games connect through it even where a direct connection cannot be made (phone data, strict routers).` }
      : { ok: false, text: `${rn[0].toUpperCase()}${rn.slice(1)} did not answer from this network. Players on networks that block direct connections cannot join through it; on the same Wi-Fi, use LAN mode.` },
  );
  lines.push({ ...localLine(r.local, false).line, ok: null });
  // a VPN (or its "WebRTC leak protection") is the usual reason the routes are blocked
  if (!r.internet || !r.relay || server === false)
    lines.push({ ok: null, text: 'Using a VPN? Many VPN apps and browser extensions block these connections (look for “WebRTC leak protection”). Turn the VPN off on both devices, reload the page and check again.' });
  const good = server !== false && r.relay;
  const some = server !== false && r.internet;
  render(
    box,
    good ? 'Online games should connect from this device.' : some ? 'Online games connect from here to most networks, but not to the strictest ones.' : 'Online games will not connect from this network.',
    lines,
  );
}

/** Run the check for `mode` into `box` (a `.mp-netcheck` element under the mode's buttons). */
export function runNetCheck(box: HTMLElement, mode: 'online' | 'lan'): void {
  box.hidden = false;
  const go = () => void (mode === 'lan' ? runLan(box) : runOnline(box)).catch((e) => render(box, 'The check could not run.', [{ ok: false, text: e instanceof Error ? e.message : String(e) }]));
  box.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b?.dataset.a !== 'nc-allow') return;
    e.stopPropagation();
    unlockLanAddresses().then(go, (err) => render(box, 'Could not get permission.', [{ ok: false, text: err instanceof Error ? err.message : String(err) }]));
  };
  go();
}
