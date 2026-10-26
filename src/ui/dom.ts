/** Small DOM helpers shared by the UI components. */
import { TOUCH } from '../core/device';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** A bronze-framed button with an icon and/or label. */
export function button(cls: string, html: string, tip: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', 'bbtn ' + cls, html);
  b.dataset.tip = tip;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

/** Stop pointer events on a UI element from reaching the game canvas (panning, painting). */
export function shield(e: HTMLElement): void {
  for (const t of ['pointerdown', 'wheel', 'contextmenu'] as const) e.addEventListener(t, (ev) => ev.stopPropagation(), { passive: t === 'wheel' });
}

/**
 * Tooltips for every element with a `data-tip` attribute (delegated). Tip
 * text may contain light HTML (<b>, <span class="k">). Elements can refresh
 * their tip at any time by updating the attribute.
 *
 * Touch screens have no hover: a long press on the element shows its tip
 * (above it, until the finger lifts and a moment after) and that press does
 * not count as a tap.
 */
export class Tips {
  private tip = el('div', 'tip');
  private target: HTMLElement | null = null;
  private timer = 0;
  private press = { t: 0, x: 0, y: 0, shown: false, eat: false };

  constructor(root: HTMLElement) {
    document.body.appendChild(this.tip);
    if (TOUCH) this.touchTips(root);
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const t = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
      if (t === this.target) return;
      this.target = t;
      window.clearTimeout(this.timer);
      this.tip.classList.remove('show');
      if (!t) return;
      this.timer = window.setTimeout(() => this.show(), 320);
    });
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') this.place(e.clientX, e.clientY);
    });
    root.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.hide();
    });
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') this.hide();
    });
  }

  private touchTips(root: HTMLElement): void {
    const P = this.press;
    const end = () => {
      window.clearTimeout(P.t);
      if (P.shown) window.setTimeout(() => this.hide(), 1600);
      P.shown = false;
    };
    root.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch') return;
        this.hide();
        P.eat = false;
        const t = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
        if (!t) return;
        P.x = e.clientX;
        P.y = e.clientY;
        P.t = window.setTimeout(() => {
          this.target = t;
          this.show();
          const r = t.getBoundingClientRect();
          const tr = this.tip.getBoundingClientRect();
          // above the finger's element (below it near the top of the screen), kept on screen
          const x = Math.min(window.innerWidth - tr.width - 6, Math.max(6, r.left + r.width / 2 - tr.width / 2));
          const y = r.top - tr.height - 10 > 6 ? r.top - tr.height - 10 : Math.min(window.innerHeight - tr.height - 6, r.bottom + 10);
          this.tip.style.left = x + 'px';
          this.tip.style.top = y + 'px';
          P.shown = true;
          P.eat = true;
        }, 450);
      },
      true,
    );
    root.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'touch' && !P.shown && Math.hypot(e.clientX - P.x, e.clientY - P.y) > 10) window.clearTimeout(P.t);
      },
      true,
    );
    root.addEventListener('pointerup', end, true);
    root.addEventListener('pointercancel', end, true);
    // the long press was for the tip: its click does nothing
    root.addEventListener(
      'click',
      (e) => {
        if (!P.eat) return;
        P.eat = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true,
    );
  }

  private show(): void {
    if (!this.target || !this.target.isConnected) return;
    const html = this.target.dataset.tip ?? '';
    if (!html) return;
    this.tip.innerHTML = html;
    this.tip.classList.add('show');
  }

  private place(x: number, y: number): void {
    const r = this.tip.getBoundingClientRect();
    let tx = x + 16;
    let ty = y + 18;
    if (tx + r.width > window.innerWidth - 6) tx = x - r.width - 12;
    if (ty + r.height > window.innerHeight - 6) ty = y - r.height - 12;
    this.tip.style.left = Math.max(4, tx) + 'px';
    this.tip.style.top = Math.max(4, ty) + 'px';
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.target = null;
    this.tip.classList.remove('show');
  }
}

/** Message feed (top right). Repeats of the same text are throttled. */
export class Toasts {
  root = el('div', 'toasts');
  private last = new Map<string, number>();

  push(text: string, kind = 'info', key = text): void {
    const now = performance.now();
    if ((this.last.get(key) ?? -1e9) > now - 4000) return;
    this.last.set(key, now);
    const m = el('div', 'toast ' + kind, text);
    this.root.appendChild(m);
    window.setTimeout(() => m.classList.add('fade'), 5000);
    window.setTimeout(() => m.remove(), 5900);
    while (this.root.children.length > 5) this.root.firstChild!.remove();
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * Menus (title, start, multiplayer, lobby) are laid out in CSS pixels for a
 * window of about 1280 × 860; `--mz` zooms their cards to the actual window,
 * so they are neither tiny on a 4K screen nor cut off on a small one.
 */
export function fitMenus(): void {
  const apply = () => {
    const k = Math.min(window.innerWidth / 1280, window.innerHeight / 860);
    document.documentElement.style.setProperty('--mz', Math.max(0.7, Math.min(2.2, k)).toFixed(3));
  };
  apply();
  window.addEventListener('resize', apply);
}
