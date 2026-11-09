/**
 * The display's refresh rate as this page gets it (performance v5, claude/performance/05-spec §"User decisions"): the
 * browser's animation frames timed for a moment while the page is idle (the menu, the benchmark's start screen).
 * Safari holds pages to 30 frames a second in Low Power Mode (and on battery with some settings), so a game can never
 * show more than 30 there however fast it is: the F3 overlay and the benchmark report say so, and measure frames
 * against that rate.
 */
export const display = {
  /** measured refresh (Hz), 0 until measured */
  hz: 0,
  /** its interval (ms) */
  ms: 0,
  /** held to 30 Hz (Low Power Mode or a battery setting) */
  capped: false,
};

const RATES = [240, 165, 144, 120, 100, 90, 75, 60, 50, 48, 30, 24];

/** Time the animation frames for `ms` of an idle page; resolves with the rate found. */
export function probeDisplay(ms = 1200): Promise<number> {
  return new Promise((resolve) => {
    const iv: number[] = [];
    let last = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      if (last && t - last < 200) iv.push(t - last);
      last = t;
      if (t - t0 < ms || iv.length < 12) {
        if (t - t0 < ms * 4) return void requestAnimationFrame(step);
      }
      if (!iv.length) return resolve(display.hz);
      // the median interval, snapped to a common refresh rate
      iv.sort((a, b) => a - b);
      const med = iv[Math.floor(iv.length / 2)];
      let hz = 1000 / med;
      for (const r of RATES)
        if (Math.abs(1000 / r - med) < (1000 / r) * 0.1) {
          hz = r;
          break;
        }
      display.hz = Math.round(hz);
      display.ms = 1000 / hz;
      display.capped = display.hz <= 31;
      resolve(display.hz);
    };
    requestAnimationFrame(step);
  });
}

/** One line for the overlay and the report. */
export function displayLine(): string {
  if (!display.hz) return 'display rate not measured';
  return `display ${display.hz} Hz${display.capped ? ' — capped at 30 Hz: Low Power Mode or on battery? (plugged in, with Low Power Mode off, Safari draws up to the screen’s rate)' : ''}`;
}
