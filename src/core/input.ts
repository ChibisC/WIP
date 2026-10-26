/**
 * Keyboard/mouse input with rebindable actions. Holds continuous state (keys
 * down, drag deltas, wheel) that cameras read each frame, and dispatches
 * discrete action presses to subscribers.
 *
 * Touch (phones, tablets) maps onto the same state: one finger drags the ground
 * (or paints with the dig and build tools), a tap is a click, a long press is a
 * right-click (cancel the tool, remove a marker); two fingers pan, pinch to zoom
 * and twist to rotate; three fingers dragged up or down tilt the camera.
 */
export type Action =
  | 'panUp'
  | 'panDown'
  | 'panLeft'
  | 'panRight'
  | 'rotateLeft'
  | 'rotateRight'
  | 'zoomIn'
  | 'zoomOut'
  | 'toggleView'
  | 'pause'
  | 'speedUp'
  | 'speedDown'
  | 'recall'
  | 'overlay'
  | 'observe'
  | 'cancel'
  | 'quickSave'
  | 'quickLoad'
  | 'marker1'
  | 'marker2'
  | 'marker3'
  | 'marker4'
  | 'marker5'
  | 'marker6'
  | 'dig'
  | 'build'
  | 'upgradeTool'
  | 'deleteTool'
  | 'jumpMarker'
  | 'resetCam'
  | 'nextArea'
  | 'area1'
  | 'area2'
  | 'area3'
  | 'area4'
  | 'area5'
  | 'area6'
  | 'area7'
  | 'area8'
  | 'photo'
  | 'debug'
  | 'chat';

export const DEFAULT_BINDINGS: Record<Action, string> = {
  panUp: 'KeyW',
  panDown: 'KeyS',
  panLeft: 'KeyA',
  panRight: 'KeyD',
  rotateLeft: 'KeyQ',
  rotateRight: 'KeyE',
  zoomIn: 'KeyZ',
  zoomOut: 'KeyX',
  toggleView: 'Tab',
  pause: 'KeyP',
  speedUp: 'Equal',
  speedDown: 'Minus',
  recall: 'KeyR',
  overlay: 'KeyT',
  observe: 'KeyO',
  cancel: 'Escape',
  quickSave: 'F7',
  quickLoad: 'F8',
  marker1: 'Digit1',
  marker2: 'Digit2',
  marker3: 'Digit3',
  marker4: 'Digit4',
  marker5: 'Digit5',
  marker6: 'Digit6',
  dig: 'KeyG',
  build: 'KeyB',
  upgradeTool: 'KeyU',
  deleteTool: 'Delete',
  jumpMarker: 'Space',
  resetCam: 'KeyC',
  nextArea: 'KeyN',
  // Shift + number: the number keys alone pick markers I–V
  area1: 'Shift+Digit1',
  area2: 'Shift+Digit2',
  area3: 'Shift+Digit3',
  area4: 'Shift+Digit4',
  area5: 'Shift+Digit5',
  area6: 'Shift+Digit6',
  area7: 'Shift+Digit7',
  area8: 'Shift+Digit8',
  photo: 'F9',
  debug: 'F3',
  chat: 'Enter',
};

/** Second keys for continuous actions (arrow keys pan too). */
export const ALT_BINDINGS: Partial<Record<Action, string>> = {
  panUp: 'ArrowUp',
  panDown: 'ArrowDown',
  panLeft: 'ArrowLeft',
  panRight: 'ArrowRight',
};

export const ACTION_LABELS: Record<Action, string> = {
  panUp: 'Pan forward',
  panDown: 'Pan back',
  panLeft: 'Pan left',
  panRight: 'Pan right',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  toggleView: 'Surface ⇄ last underground area',
  pause: 'Pause',
  speedUp: 'Faster',
  speedDown: 'Slower',
  recall: 'Recall all ants',
  overlay: 'Pheromone overlay',
  observe: 'Follow the inspected ant',
  cancel: 'Cancel / menu',
  quickSave: 'Quick save',
  quickLoad: 'Quick load',
  marker1: 'Marker I',
  marker2: 'Marker II',
  marker3: 'Marker III',
  marker4: 'Marker IV',
  marker5: 'Marker V',
  marker6: 'Marker VI (unused)',
  dig: 'Dig tool',
  build: 'Build menu',
  upgradeTool: 'Upgrade tool',
  deleteTool: 'Delete tool',
  jumpMarker: 'Jump to selected marker',
  resetCam: 'Reset camera',
  nextArea: 'Next underground area',
  area1: 'Underground area 1',
  area2: 'Underground area 2',
  area3: 'Underground area 3',
  area4: 'Underground area 4',
  area5: 'Underground area 5',
  area6: 'Underground area 6',
  area7: 'Underground area 7',
  area8: 'Underground area 8',
  photo: 'Photo mode (Shift: free camera)',
  debug: 'Debug overlay (FPS, tick time, network)',
  chat: 'Chat (multiplayer)',
};

export interface PointerInfo {
  x: number;
  y: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
}

export class Input {
  bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };
  private down = new Set<string>();
  private handlers = new Map<Action, Array<() => void>>();
  mouseX = 0;
  mouseY = 0;
  /** Accumulated drag deltas since last consume (pixels). */
  panDX = 0;
  panDY = 0;
  rotDX = 0;
  rotDY = 0;
  wheel = 0;
  buttons = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragging = false;
  private leftDragPans = true;
  /** Set by UI tools that want left-drag (e.g. dig brush) instead of panning. */
  leftDragMode: 'pan' | 'paint' = 'pan';
  onClick: ((p: PointerInfo) => void) | null = null;
  onPaint: ((p: PointerInfo, phase: 'start' | 'move' | 'end') => void) | null = null;
  onRightClick: ((p: PointerInfo) => void) | null = null;
  onMove: ((x: number, y: number) => void) | null = null;
  enabled = true;
  rebindTarget: ((code: string) => void) | null = null;
  /** shift held on the last key press (Shift+F9 = free camera) */
  lastShift = false;
  /** edge scrolling setting */
  edgeScroll = true;
  /** pointer is over the game view (not the UI) and inside the window */
  overView = false;

  /** touch points on the game view, by pointer id (insertion order: the first finger first) */
  private touches = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  /** this touch sequence has had two or more fingers (no tap, no paint, no long press) */
  private touchGesture = false;
  private touchMoved = false;
  private touchPaint = false;
  private longTimer = 0;
  private longFired = false;
  private paintTimer = 0;
  /** two/three-finger baseline: midpoint, spread and angle of the first two fingers */
  private g0 = { mx: 0, my: 0, d: 0, a: 0 };
  /** a long press (ms) is a right-click */
  static LONG_PRESS_MS = 520;
  /** finger travel (CSS px) that turns a touch into a drag */
  static TOUCH_SLOP = 9;
  /** with the dig and build tools, a touch held this long (ms) without a second finger starts painting */
  static PAINT_DELAY_MS = 110;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.overView = false;
    });
    document.addEventListener('pointerleave', () => (this.overView = false));
    document.documentElement.addEventListener('mouseleave', () => (this.overView = false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch') this.touchUp(e, true);
      else this.pointerUp(e);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60 + 0.5);
      },
      { passive: false },
    );
  }

  private keyDown(e: KeyboardEvent): void {
    if (this.rebindTarget) {
      e.preventDefault();
      // a modifier alone is not a key to bind: wait for the key that goes with it (Shift + number = area tabs)
      if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(e.code)) return;
      const f = this.rebindTarget;
      this.rebindTarget = null;
      f(e.shiftKey && e.code.startsWith('Digit') ? `Shift+${e.code}` : e.code);
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Tab' || e.code === 'Space' || /^F([1-9])$/.test(e.code)) e.preventDefault();
    this.lastShift = e.shiftKey;
    if (!this.down.has(e.code)) {
      this.down.add(e.code);
      if (!this.enabled && e.code !== this.bindings.cancel) return;
      // Modified keys never trigger game actions (browser shortcuts stay usable), except Shift + number (area tabs).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const code = e.shiftKey && e.code.startsWith('Digit') ? `Shift+${e.code}` : e.code;
      for (const [action, bound] of Object.entries(this.bindings) as Array<[Action, string]>) {
        if (bound === code) this.handlers.get(action)?.forEach((f) => f());
      }
    }
  }

  isDown(a: Action): boolean {
    if (!this.enabled) return false;
    const alt = ALT_BINDINGS[a];
    return this.down.has(this.bindings[a]) || (!!alt && this.down.has(alt));
  }

  /**
   * Edge scrolling: −1..1 per axis when the pointer rests near the edge of the
   * game view (not over the UI). Zero when disabled or the pointer is away.
   */
  edgePan(): { x: number; y: number } {
    if (!this.enabled || !this.edgeScroll || !this.overView || this.buttons) return { x: 0, y: 0 };
    const m = 6;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const x = this.mouseX <= m ? -1 : this.mouseX >= W - 1 - m ? 1 : 0;
    const y = this.mouseY <= m ? -1 : this.mouseY >= H - 1 - m ? 1 : 0;
    return { x, y };
  }

  on(a: Action, f: () => void): void {
    let arr = this.handlers.get(a);
    if (!arr) this.handlers.set(a, (arr = []));
    arr.push(f);
  }

  private info(e: PointerEvent | MouseEvent): PointerInfo {
    return { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') return this.touchDown(e);
    this.buttons |= 1 << e.button;
    this.dragStartX = this.mouseX = e.clientX;
    this.dragStartY = this.mouseY = e.clientY;
    this.dragging = false;
    if (e.button === 0 && this.leftDragMode === 'paint') this.onPaint?.(this.info(e), 'start');
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  private pointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') return this.touchMove(e);
    this.overView = e.target === this.el;
    const dx = e.clientX - this.mouseX;
    const dy = e.clientY - this.mouseY;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.onMove?.(e.clientX, e.clientY);
    if (!this.enabled || !this.buttons) return;
    if (Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) > 4) this.dragging = true;
    if (this.buttons & 1) {
      if (this.leftDragMode === 'paint') this.onPaint?.(this.info(e), 'move');
      else if (this.dragging && this.leftDragPans) {
        this.panDX += dx;
        this.panDY += dy;
      }
    }
    if (this.buttons & 4) {
      this.panDX += dx;
      this.panDY += dy;
    }
    if (this.buttons & 2) {
      this.rotDX += dx;
      this.rotDY += dy;
    }
  }

  private pointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') return this.touchUp(e, false);
    const wasDown = this.buttons & (1 << e.button);
    this.buttons &= ~(1 << e.button);
    if (!wasDown || !this.enabled) return;
    if (e.button === 0) {
      if (this.leftDragMode === 'paint') this.onPaint?.(this.info(e), 'end');
      else if (!this.dragging) this.onClick?.(this.info(e));
    }
    if (e.button === 2 && !this.dragging) this.onRightClick?.(this.info(e));
    this.dragging = false;
  }

  // ------------------------------------------------------------------------------------------- touch

  private touchInfo(x: number, y: number, button = 0): PointerInfo {
    return { x, y, button, shift: false, ctrl: false };
  }

  private clearTouchTimers(): void {
    window.clearTimeout(this.longTimer);
    window.clearTimeout(this.paintTimer);
    this.longTimer = this.paintTimer = 0;
  }

  /** the first two fingers: midpoint, spread and angle */
  private pair(): { mx: number; my: number; d: number; a: number } {
    const it = this.touches.values();
    const p = it.next().value!;
    const q = it.next().value!;
    return { mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2, d: Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)), a: Math.atan2(q.y - p.y, q.x - p.x) };
  }

  private startPaint(): void {
    if (this.touchPaint || this.touchGesture || this.leftDragMode !== 'paint' || this.touches.size !== 1) return;
    const t = this.touches.values().next().value!;
    this.touchPaint = true;
    this.onPaint?.(this.touchInfo(t.sx, t.sy), 'start');
    if (t.x !== t.sx || t.y !== t.sy) this.onPaint?.(this.touchInfo(t.x, t.y), 'move');
  }

  private touchDown(e: PointerEvent): void {
    // a finger on the game view only (UI panels stop their own pointerdowns)
    this.overView = false;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (this.touches.size === 1) {
      this.touchGesture = false;
      this.touchMoved = false;
      this.touchPaint = false;
      this.longFired = false;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.onMove?.(e.clientX, e.clientY); // hover (tile ghost, placement hint) follows the finger
      this.clearTouchTimers();
      this.longTimer = window.setTimeout(() => {
        if (this.touches.size !== 1 || this.touchGesture || this.touchMoved || this.touchPaint) return;
        this.longFired = true;
        const t = this.touches.values().next().value!;
        this.onRightClick?.(this.touchInfo(t.x, t.y, 2));
      }, Input.LONG_PRESS_MS);
      if (this.leftDragMode === 'paint') this.paintTimer = window.setTimeout(() => this.startPaint(), Input.PAINT_DELAY_MS);
      return;
    }
    // a second (or third) finger: a camera gesture from here on
    this.clearTouchTimers();
    if (this.touchPaint) {
      const t = this.touches.values().next().value!;
      this.onPaint?.(this.touchInfo(t.x, t.y), 'end');
      this.touchPaint = false;
    }
    this.touchGesture = true;
    this.g0 = this.pair();
  }

  private touchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    if (!this.enabled) return;
    if (this.touches.size === 1 && !this.touchGesture) {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.onMove?.(e.clientX, e.clientY);
      if (!this.touchMoved && Math.hypot(t.x - t.sx, t.y - t.sy) > Input.TOUCH_SLOP) {
        this.touchMoved = true;
        window.clearTimeout(this.longTimer);
        if (this.leftDragMode === 'paint') this.startPaint();
        else {
          // the drag starts where the finger first went down (no jump over the slop)
          this.panDX += t.x - t.sx - dx;
          this.panDY += t.y - t.sy - dy;
        }
      }
      if (!this.touchMoved) return;
      if (this.touchPaint) this.onPaint?.(this.touchInfo(t.x, t.y), 'move');
      else if (this.leftDragMode !== 'paint') {
        this.panDX += dx;
        this.panDY += dy;
      }
      return;
    }
    if (this.touches.size < 2) return; // one finger left after a gesture: it does nothing until lifted
    const g = this.pair();
    const g0 = this.g0;
    if (this.touches.size >= 3) {
      // three fingers: up and down tilts
      this.rotDY += g.my - g0.my;
    } else {
      this.panDX += g.mx - g0.mx;
      this.panDY += g.my - g0.my;
      // pinch: the wheel's units (cameras zoom by exp(wheel × 0.14))
      this.wheel += -Math.log(g.d / g0.d) / 0.14;
      // twist: the ground turns with the fingers (cameras turn by −rotDX × 0.006 rad; a clockwise twist on screen
      // raises the yaw)
      let da = g.a - g0.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.rotDX -= da / 0.006;
    }
    this.g0 = g;
  }

  private touchUp(e: PointerEvent, cancelled: boolean): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    if (this.touches.size >= 2) {
      this.g0 = this.pair();
      return;
    }
    if (this.touches.size === 1) {
      // back to one finger after a gesture: it waits to be lifted
      return;
    }
    this.clearTouchTimers();
    if (!this.enabled) return;
    const info = this.touchInfo(t.x, t.y);
    if (this.touchPaint) this.onPaint?.(info, 'end');
    else if (!cancelled && !this.touchGesture && !this.touchMoved && !this.longFired) {
      // a tap: a click (with the dig and build tools, one hex painted)
      if (this.leftDragMode === 'paint') {
        this.onPaint?.(this.touchInfo(t.sx, t.sy), 'start');
        this.onPaint?.(info, 'end');
      } else this.onClick?.(info);
    }
    this.touchPaint = false;
    this.touchGesture = false;
  }

  /** fingers on the game view right now (tests, the UI) */
  get touchCount(): number {
    return this.touches.size;
  }

  consume(): { panDX: number; panDY: number; rotDX: number; rotDY: number; wheel: number } {
    const r = { panDX: this.panDX, panDY: this.panDY, rotDX: this.rotDX, rotDY: this.rotDY, wheel: this.wheel };
    this.panDX = this.panDY = this.rotDX = this.rotDY = this.wheel = 0;
    return r;
  }
}
