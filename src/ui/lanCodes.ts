/**
 * LAN play screens (docs/multiplayer.md, "LAN play"): showing a connection code (QR code, text
 * with Copy, a larger view for scanning across a desk), entering one (paste box, or Scan QR with
 * the camera), the joiner's three steps and the host's per-player dialog.
 *
 * The QR encoder (qrcode-generator) and decoder (jsQR, used where the browser has no
 * BarcodeDetector) are bundled: no CDN or online service. The camera is asked for only when the
 * player taps Scan QR.
 */
import qrcode from 'qrcode-generator';
import { CODE_TTL_S } from '../net/lanCode';
import { LanError, ManualRtcTransport, NETWORK_TIPS } from '../net/lanTransport';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Draw a code as a QR code (dark modules on white, with the quiet zone). */
export function qrCanvas(text: string, px = 4): HTMLCanvasElement {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const c = document.createElement('canvas');
  c.width = c.height = (n + quiet * 2) * px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect((k + quiet) * px, (r + quiet) * px, px, px);
  c.className = 'lan-qr';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', 'QR code of the connection code');
  return c;
}

/** "Step 2 of 3: …" with three dots. */
function stepHead(step: number, of: number, text: string): HTMLElement {
  const h = el('div', 'lan-step');
  h.innerHTML = `<div class="lan-dots">${Array.from({ length: of }, (_, i) => `<i class="${i < step ? 'done' : ''} ${i === step - 1 ? 'now' : ''}"></i>`).join('')}</div><b>Step ${step} of ${of}:</b> ${esc(text)}`;
  return h;
}

/** A code to show: QR, text with Copy, Show larger, and (optionally) its expiry countdown. */
export function codeCard(code: string, expiresAt = 0): { root: HTMLElement; stop: () => void } {
  const root = el('div', 'lan-code');
  const qr = qrCanvas(code, 4);
  const side = el('div', 'lan-code-side');
  const text = el('textarea', 'mp-input lan-text') as HTMLTextAreaElement;
  text.readOnly = true;
  text.value = code;
  text.rows = 4;
  text.dataset.f = 'code-out';
  text.addEventListener('focus', () => text.select());
  const row = el('div', 'opt-row');
  const copy = el('button', 'chip', 'Copy code');
  copy.dataset.a = 'copy-code';
  const big = el('button', 'chip', 'Show larger');
  big.dataset.a = 'qr-large';
  const timer = el('span', 'dim lan-timer');
  row.append(copy, big, timer);
  side.append(text, row);
  root.append(qr, side);
  copy.onclick = () => {
    const done = () => {
      copy.textContent = 'Copied!';
      setTimeout(() => (copy.textContent = 'Copy code'), 1500);
    };
    const fallback = () => {
      text.focus();
      text.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        copy.textContent = 'Select the text and copy it';
      }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done, fallback);
    else fallback();
  };
  big.onclick = () => {
    const ov = el('div', 'lan-big');
    const size = Math.max(4, Math.floor(Math.min(innerWidth, innerHeight) * 0.86 / (qrCanvas(code, 1).width)));
    ov.append(qrCanvas(code, size), el('p', '', 'Tap anywhere to close'));
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
  };
  let iv: ReturnType<typeof setInterval> | null = null;
  if (expiresAt) {
    const tick = () => {
      const s = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      timer.textContent = s > 0 ? `expires in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'expired';
    };
    tick();
    iv = setInterval(tick, 1000);
  }
  return { root, stop: () => iv && clearInterval(iv) };
}

interface Detector {
  detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

/** Scan a QR code with the camera; resolves with the text (or rejects with a message). */
function scanQr(box: HTMLElement): { result: Promise<string>; stop: () => void } {
  let stream: MediaStream | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const video = el('video', 'lan-video') as HTMLVideoElement;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    video.remove();
  };
  const result = (async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new LanError('No camera is available here. Paste the code instead.');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      throw new LanError('The camera could not be opened (permission refused or no camera). Paste the code instead.');
    }
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      throw new LanError('');
    }
    box.appendChild(video);
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
    let detector: Detector | null = null;
    if (BD) {
      try {
        const f = (await BD.getSupportedFormats?.()) ?? ['qr_code'];
        if (f.includes('qr_code')) detector = new BD({ formats: ['qr_code'] });
      } catch {
        detector = null;
      }
    }
    const jsQR = detector ? null : (await import('jsqr')).default;
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    return await new Promise<string>((resolve) => {
      const look = async () => {
        if (stopped) return;
        let text = '';
        try {
          if (video.videoWidth) {
            if (detector) {
              const r = await detector.detect(video);
              text = r.find((x) => /UD\d+[HR]-/.test(x.rawValue))?.rawValue ?? '';
            } else if (jsQR) {
              const s = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
              canvas.width = Math.round(video.videoWidth * s);
              canvas.height = Math.round(video.videoHeight * s);
              g.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = g.getImageData(0, 0, canvas.width, canvas.height);
              const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (r && /UD\d+[HR]-/.test(r.data)) text = r.data;
            }
          }
        } catch {
          text = '';
        }
        if (text) {
          stop();
          resolve(text);
        } else timer = setTimeout(() => void look(), 200);
      };
      void look();
    });
  })();
  result.catch(() => stop());
  return { result, stop };
}

/** A box to paste or scan a code into; `submit` gets the text and returns an error message or ''. */
export function codeEntry(label: string, button: string, submit: (text: string) => Promise<string>): { root: HTMLElement; stop: () => void; focus: () => void } {
  const root = el('div', 'lan-entry');
  const ta = el('textarea', 'mp-input lan-text') as HTMLTextAreaElement;
  ta.rows = 3;
  ta.placeholder = label;
  ta.dataset.f = 'code-in';
  ta.spellcheck = false;
  ta.autocapitalize = 'off';
  const row = el('div', 'opt-row');
  const go = el('button', 'go', esc(button)) as HTMLButtonElement;
  go.dataset.a = 'code-submit';
  const scan = el('button', 'chip', 'Scan QR code');
  scan.dataset.a = 'scan';
  const cam = el('div', 'lan-cam');
  const err = el('p', 'mp-error lan-err');
  err.hidden = true;
  row.append(go, scan);
  root.append(ta, row, cam, err);
  let scanner: ReturnType<typeof scanQr> | null = null;
  const run = async (text: string) => {
    err.hidden = true;
    go.disabled = true;
    const was = go.textContent;
    go.textContent = 'Working…';
    const msg = await submit(text);
    go.disabled = false;
    go.textContent = was;
    if (msg) {
      err.textContent = msg;
      err.hidden = false;
    }
  };
  go.onclick = () => void run(ta.value);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void run(ta.value);
    }
  });
  scan.onclick = () => {
    if (scanner) {
      scanner.stop();
      scanner = null;
      scan.textContent = 'Scan QR code';
      return;
    }
    err.hidden = true;
    scan.textContent = 'Stop camera';
    const s = scanQr(cam);
    scanner = s;
    s.result.then(
      (text) => {
        scanner = null;
        scan.textContent = 'Scan QR code';
        ta.value = text;
        void run(text);
      },
      (e: unknown) => {
        scanner = null;
        scan.textContent = 'Scan QR code';
        const m = e instanceof Error ? e.message : '';
        if (m) {
          err.textContent = m;
          err.hidden = false;
        }
      },
    );
  };
  return { root, stop: () => scanner?.stop(), focus: () => ta.focus() };
}

// ---------------------------------------------------------------------------- joiner

/** Sessions of host codes this tab has already answered (a code works once). */
function usedSessions(): Set<number> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem('ud-lan-used') || '[]') as number[]);
  } catch {
    return new Set();
  }
}
function markUsed(s: number): void {
  try {
    const u = [...usedSessions(), s].slice(-20);
    sessionStorage.setItem('ud-lan-used', JSON.stringify(u));
  } catch {
    // private mode
  }
}

/**
 * The joining player's screen: 1 scan or paste the host's code, 2 show the reply code to the
 * host, 3 wait for the host to enter it. Calls `connected` with the open transport.
 */
export function showLanJoin(parent: HTMLElement, opts: { rejoin?: boolean; message?: string; connected: (t: ManualRtcTransport) => void; back: () => void }): void {
  const root = el('div', 'menu');
  const card = el('div', 'menu-card lan-card');
  root.appendChild(card);
  parent.appendChild(root);
  let transport: ManualRtcTransport | null = null;
  let stopCard: (() => void) | null = null;
  let entry: ReturnType<typeof codeEntry> | null = null;
  let waitTips: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    entry?.stop();
    stopCard?.();
    if (waitTips) clearTimeout(waitTips);
  };
  const cancel = () => {
    cleanup();
    transport?.close();
    root.remove();
    opts.back();
  };
  const head = (sub: string) =>
    `<h1>${opts.rejoin ? 'Rejoin the LAN match' : 'Join a LAN game'}</h1><p class="tag">${esc(sub)}</p>${opts.message ? `<p class="mp-error">${esc(opts.message)}</p>` : ''}`;
  const step1 = () => {
    cleanup();
    card.innerHTML = head(opts.rejoin ? 'Ask the host to tap Players, then Reconnect next to your name: their screen shows a new host code.' : 'Both devices must be on the same Wi-Fi or network. No internet is needed.');
    card.appendChild(stepHead(1, 3, 'scan or paste the host’s code'));
    entry = codeEntry('Paste the host code here (it starts with UD1H-)', 'Continue', async (text) => {
      try {
        transport?.close();
        transport = ManualRtcTransport.joiner();
        const r = await transport.answerHostCode(text, usedSessions());
        step2(r.code, r.opened, text);
        return '';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    card.appendChild(entry.root);
    const row = el('div', 'opt-row lan-foot');
    const back = el('button', 'chip', '← Cancel');
    back.dataset.a = 'cancel';
    back.onclick = cancel;
    row.append(back);
    card.appendChild(row);
    entry.focus();
  };
  const step2 = (code: string, opened: Promise<void>, hostCode: string) => {
    cleanup();
    card.innerHTML = head('Nearly there.');
    card.appendChild(stepHead(2, 3, 'show this reply code to the host (they scan it, or you send them the text)'));
    const c = codeCard(code);
    stopCard = c.stop;
    card.appendChild(c.root);
    const wait = el('div', 'lan-wait');
    wait.append(stepHead(3, 3, 'waiting for the host to enter your reply code…'));
    const spin = el('p', 'dim lan-status', '<span class="lan-spin"></span> Waiting for the host…');
    const tips = el('p', 'dim lan-tips');
    wait.append(spin, tips);
    card.appendChild(wait);
    waitTips = setTimeout(() => (tips.textContent = `Taking a while? Once the host has entered your code, the connection opens in a few seconds. If it does not: ${NETWORK_TIPS}`), 25000);
    const row = el('div', 'opt-row lan-foot');
    const back = el('button', 'chip', '← Cancel');
    back.dataset.a = 'cancel';
    back.onclick = cancel;
    const again = el('button', 'chip', 'Enter a different host code');
    again.onclick = () => {
      transport?.close();
      transport = null;
      step1();
    };
    row.append(back, again);
    card.appendChild(row);
    void hostCode;
    opened.then(
      () => {
        const t = transport!;
        const s = Number.parseInt(t.id.slice(4), 16);
        if (Number.isFinite(s)) markUsed(s);
        cleanup();
        root.remove();
        opts.connected(t);
      },
      (e: unknown) => {
        spin.innerHTML = '';
        const err = el('p', 'mp-error', esc(e instanceof Error ? e.message : String(e)));
        wait.appendChild(err);
      },
    );
  };
  step1();
}

// ---------------------------------------------------------------------------- host

/**
 * The host's dialog for one player: 1 show this host code, 2 the player scans it and gets a
 * reply code, 3 scan or paste the reply. Closes itself when the player is connected.
 */
export function openHostDialog(parent: HTMLElement, transport: ManualRtcTransport, slot: number, opts: { title: string; done?: () => void }): { close: () => void } {
  const ov = el('div', 'lan-dialog');
  const card = el('div', 'menu-card lan-card');
  ov.appendChild(card);
  parent.appendChild(ov);
  let session = 0;
  let stopCard: (() => void) | null = null;
  let entry: ReturnType<typeof codeEntry> | null = null;
  let finished = false;
  const close = () => {
    entry?.stop();
    stopCard?.();
    if (session && !finished) transport.cancel(session);
    ov.remove();
  };
  const make = async () => {
    entry?.stop();
    stopCard?.();
    card.innerHTML = `<h1>${esc(opts.title)}</h1><p class="dim"><span class="lan-spin"></span> Making a host code…</p>`;
    let made: Awaited<ReturnType<ManualRtcTransport['createHostCode']>>;
    try {
      made = await transport.createHostCode(slot);
    } catch (e) {
      card.innerHTML = `<h1>${esc(opts.title)}</h1><p class="mp-error">${esc(e instanceof Error ? e.message : String(e))}</p>`;
      const row = el('div', 'opt-row lan-foot');
      const x = el('button', 'chip', 'Close');
      x.onclick = close;
      row.append(x);
      card.appendChild(row);
      return;
    }
    session = made.session;
    card.innerHTML = `<h1>${esc(opts.title)}</h1><p class="tag">The player opens the game on their device (same Wi-Fi), taps Multiplayer → LAN → Join LAN game, and scans or pastes this code. Codes last ${CODE_TTL_S / 60} minutes and work once.</p>`;
    card.appendChild(stepHead(1, 3, `show host code #${slot + 1} to the player`));
    const c = codeCard(made.code, made.expiresAt);
    stopCard = c.stop;
    card.appendChild(c.root);
    card.appendChild(stepHead(2, 3, 'the player’s device then shows a reply code'));
    card.appendChild(stepHead(3, 3, 'scan or paste the player’s reply code'));
    entry = codeEntry('Paste the reply code here (it starts with UD1R-)', 'Connect', async (text) => {
      try {
        const status = card.querySelector('.lan-status') as HTMLElement | null;
        if (status) status.innerHTML = '<span class="lan-spin"></span> Connecting…';
        await transport.acceptReply(text);
        finished = true;
        close();
        opts.done?.();
        return '';
      } catch (e) {
        const status = card.querySelector('.lan-status') as HTMLElement | null;
        if (status) status.textContent = '';
        return e instanceof Error ? e.message : String(e);
      }
    });
    card.appendChild(entry.root);
    card.appendChild(el('p', 'dim lan-status'));
    const row = el('div', 'opt-row lan-foot');
    const x = el('button', 'chip', 'Cancel');
    x.dataset.a = 'cancel';
    x.onclick = close;
    const again = el('button', 'chip', 'New code');
    again.dataset.a = 'new-code';
    again.onclick = () => {
      if (session) transport.cancel(session);
      session = 0;
      void make();
    };
    row.append(x, again);
    card.appendChild(row);
  };
  transport.onLink = (e) => {
    if (e.kind === 'expired' && e.session === session && ov.isConnected) {
      const status = card.querySelector('.lan-status') as HTMLElement | null;
      if (status) status.innerHTML = '<span class="mp-error">This code expired. Tap New code for a fresh one.</span>';
    }
  };
  void make();
  return { close };
}
