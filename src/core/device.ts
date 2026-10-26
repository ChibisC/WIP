/**
 * Touch devices (iPhone, iPad, Android phones and tablets). Detected once at load: a coarse primary pointer, or an
 * iPad that reports itself as a Mac (iPadOS Safari's desktop mode). `?touch=1` forces touch mode on any device (tests,
 * a touchscreen laptop) and `?touch=0` turns it off.
 *
 * Touch mode changes only the interface and the input: gestures on the game view (input.ts), larger, rearranged
 * panels on small screens (GameUI "compact"), long-press tooltips, a cancel button for tools, and a lighter starting
 * graphics preset. The simulation is the same everywhere.
 */
const forced = new URLSearchParams(location.search).get('touch');

function detect(): boolean {
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
  // iPadOS Safari asks for desktop pages and reports "Macintosh"; it still has touch points
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export const TOUCH = detect();

/** A phone-sized touch screen (short side under 600 CSS px): landscape is the way to play. */
export function isPhone(): boolean {
  return TOUCH && Math.min(window.innerWidth, window.innerHeight) < 600;
}

/** The word for a primary press in help and hint text. */
export const CLICK = TOUCH ? 'Tap' : 'Click';
export const click = TOUCH ? 'tap' : 'click';

/**
 * Page-level guards for touch browsers: no pinch-zooming or double-tap zooming the page, no rubber-band scrolling,
 * no text-selection callouts on long presses (CSS does most of it: style.css `.touch`). Shows the "turn your phone
 * sideways" hint in portrait on phones.
 */
export function installTouchGuards(): void {
  const root = document.documentElement;
  root.classList.toggle('touch', TOUCH);
  if (!TOUCH) return;
  // Safari's own pinch gesture events (it ignores user-scalable=no since iOS 10)
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  // double-tap zoom is off through `touch-action: manipulation` (style.css); a two-finger pinch that starts on a panel
  // would still zoom the page, so it is cancelled here (lists inside panels still scroll with one finger)
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
  const hint = document.createElement('div');
  hint.className = 'rotate-hint';
  hint.innerHTML =
    '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><rect x="20" y="8" width="24" height="44" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M50 40 a20 20 0 0 1 -14 16" fill="none" stroke="currentColor" stroke-width="3"/><path d="M33 52 l4 5 l-5 3" fill="none" stroke="currentColor" stroke-width="3"/></svg>' +
    '<div>Turn your phone sideways to play</div>';
  document.body.appendChild(hint);
  const phone = () => root.classList.toggle('phone', isPhone());
  phone();
  window.addEventListener('resize', phone);
}
