import { fbm2 } from '../core/rng';
import { CURRENT_CHAPTER, ISLAND_NAME, LevelNode, NODES, REGIONS, Region, nodePath, nodePos } from '../story/campaign';
import { MAP_H, MAP_W, coastPoint, inIsland, nearestRegion } from '../story/islandGeo';

/**
 * The campaign's island map (claude/story/02-spec §3): an original, procedurally painted field map of Wayfarer
 * Island in the narrator's journal style — ink coastline and contour ripples on paper, watercolour washes per region,
 * the river, small ink marks for grass, trees, dunes and mounds, the caldera at the heart. Regions of later chapters
 * are under mist ("Coming soon"). Level nodes sit on it, joined by dashed paths; a path is drawn out (and its
 * region's mist lifts) the first time it opens.
 *
 * Made for the whole campaign, 30–40 levels (user, 2026-11-02): the map pans and zooms (drag, wheel, pinch, the + / −
 * / fit buttons); nodes keep their size on screen at any zoom; level names show for the selected, hovered and open
 * levels and for all of them once zoomed in, so a full island never turns into a pile of labels. The painting is made
 * once at twice the map's size, so it stays crisp zoomed in; the mist is cached; the canvas redraws only while
 * something moves.
 */

export interface NodeView {
  node: LevelNode;
  state: 'locked' | 'open' | 'won';
  /** medals won (gold/silver/bronze/none ×3) */
  medals: string[];
  number: number;
  title: string;
}

const W = MAP_W;
const H = MAP_H;
/** the painting's resolution over the map's 1× size */
const RES = 2;
const ZOOM_MAX = 3.2;

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** The painted base map (paper, sea, island, regions, river, marks, labels), at RES × the map size. */
function paintBase(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W * RES;
  cv.height = H * RES;
  const g = cv.getContext('2d')!;
  g.scale(RES, RES);
  // paper and sea, per pixel at a quarter of 1×, then smoothed up
  const lw = W / 3;
  const lh = Math.round(H / 3);
  const low = document.createElement('canvas');
  low.width = lw;
  low.height = lh;
  const lg = low.getContext('2d')!;
  const img = lg.createImageData(lw, lh);
  const paper = [233, 220, 192];
  const sea = [150, 178, 170];
  for (let j = 0; j < lh; j++)
    for (let i = 0; i < lw; i++) {
      const x = (i + 0.5) / lw;
      const y = (j + 0.5) / lh;
      const k = (j * lw + i) * 4;
      const grain = (fbm2(x * 40, y * 40, 2, 3) - 0.5) * 18 + (fbm2(x * 6, y * 6, 3, 9) - 0.5) * 14;
      const inside = inIsland(x, y);
      let c: number[];
      if (inside < 0) {
        const t = Math.min(1, -inside / 0.12);
        const edge = Math.min(x, y, 1 - x, 1 - y);
        const fade = Math.min(1, edge / 0.05);
        c = paper.map((p, q) => p + (sea[q] - 18 * t - p) * fade * (0.55 + 0.45 * t));
      } else {
        const { r, d, d2 } = nearestRegion(REGIONS, x, y);
        const rc = hex(r.color);
        const border = Math.min(1, (d2 - d) / 0.02);
        const wet = fbm2(x * 14 + 3, y * 14, 3, 21);
        const mix = 0.62 + wet * 0.3;
        c = paper.map((p, q) => p + (rc[q] - p) * mix * (0.75 + 0.25 * border));
        if (border < 1) c = c.map((v) => v - (1 - border) * 18);
        if (inside < 0.012) c = c.map((v, q) => v + ([214, 196, 150][q] - v) * (1 - inside / 0.012) * 0.7);
      }
      img.data[k] = c[0] + grain;
      img.data[k + 1] = c[1] + grain;
      img.data[k + 2] = c[2] + grain * 0.8;
      img.data[k + 3] = 255;
    }
  lg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(low, 0, 0, W, H);
  // coast ink line and ripples
  const ring = (off: number, alpha: number, width: number, dash: number[] = []) => {
    g.beginPath();
    for (let k = 0; k <= 360; k++) {
      const [px, py] = coastPoint((k / 360) * Math.PI * 2, off);
      if (k === 0) g.moveTo(px * W, py * H);
      else g.lineTo(px * W, py * H);
    }
    g.setLineDash(dash);
    g.strokeStyle = `rgba(52, 40, 28, ${alpha})`;
    g.lineWidth = width;
    g.stroke();
    g.setLineDash([]);
  };
  ring(0, 0.85, 2.2);
  ring(0.018, 0.35, 1);
  ring(0.036, 0.22, 1, [6, 5]);
  ring(0.06, 0.12, 1, [3, 7]);
  // the river: from the heart to the south coast, through the riverbank
  const riv = [
    [0.52, 0.53],
    [0.5, 0.6],
    [0.53, 0.68],
    [0.5, 0.74],
    [0.53, 0.81],
    [0.5, 0.9],
  ];
  g.beginPath();
  g.moveTo(riv[0][0] * W, riv[0][1] * H);
  for (let i = 1; i < riv.length; i++) {
    const [x0, y0] = riv[i - 1];
    const [x1, y1] = riv[i];
    g.quadraticCurveTo(x0 * W + 12, ((y0 + y1) / 2) * H, x1 * W, y1 * H);
  }
  g.strokeStyle = 'rgba(70, 104, 112, 0.9)';
  g.lineWidth = 5;
  g.stroke();
  g.strokeStyle = 'rgba(160, 190, 186, 0.9)';
  g.lineWidth = 2.5;
  g.stroke();
  // the pond in the meadow
  g.beginPath();
  g.ellipse(0.25 * W, 0.75 * H, 26, 16, 0.3, 0, Math.PI * 2);
  g.fillStyle = 'rgba(140, 172, 168, 0.95)';
  g.fill();
  g.strokeStyle = 'rgba(52, 40, 28, 0.7)';
  g.lineWidth = 1.4;
  g.stroke();
  // ink marks per region
  let seed = 1;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  g.lineCap = 'round';
  for (let i = 0; i < 3200; i++) {
    const x = rnd();
    const y = rnd();
    if (inIsland(x, y) < 0.02) continue;
    const { r } = nearestRegion(REGIONS, x, y);
    const px = x * W;
    const py = y * H;
    g.strokeStyle = 'rgba(48, 38, 24, 0.5)';
    g.fillStyle = 'rgba(48, 38, 24, 0.45)';
    g.lineWidth = 0.9;
    if (r.id === 'meadow' && rnd() < 0.5) {
      g.beginPath();
      g.moveTo(px - 3, py);
      g.lineTo(px - 1, py - 5);
      g.moveTo(px, py);
      g.lineTo(px + 1, py - 6);
      g.moveTo(px + 3, py);
      g.lineTo(px + 3.5, py - 4);
      g.stroke();
    } else if (r.id === 'forest' && rnd() < 0.55) {
      g.beginPath();
      g.moveTo(px, py - 9);
      g.lineTo(px - 4.5, py + 2);
      g.lineTo(px + 4.5, py + 2);
      g.closePath();
      g.fillStyle = 'rgba(46, 56, 34, 0.55)';
      g.fill();
    } else if (r.id === 'rainforest' && rnd() < 0.7) {
      g.beginPath();
      g.arc(px, py, 3.5 + rnd() * 3, 0, Math.PI * 2);
      g.fillStyle = `rgba(${30 + rnd() * 20}, ${60 + rnd() * 30}, 40, 0.5)`;
      g.fill();
    } else if (r.id === 'savanna' && rnd() < 0.35) {
      if (rnd() < 0.15) {
        g.beginPath();
        g.moveTo(px - 3, py + 2);
        g.lineTo(px, py - 8);
        g.lineTo(px + 3, py + 2);
        g.fillStyle = 'rgba(120, 76, 44, 0.65)';
        g.fill();
      } else {
        g.beginPath();
        g.arc(px, py, 0.9, 0, Math.PI * 2);
        g.fill();
      }
    } else if (r.id === 'riverbank' && rnd() < 0.4) {
      g.beginPath();
      g.arc(px, py, 0.8, 0, Math.PI * 2);
      g.fill();
    }
  }
  // the caldera at the heart
  g.beginPath();
  g.ellipse(0.52 * W, 0.5 * H, 46, 30, 0, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(52, 40, 28, 0.75)';
  g.lineWidth = 2;
  g.stroke();
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    g.beginPath();
    g.moveTo(0.52 * W + Math.cos(a) * 46, 0.5 * H + Math.sin(a) * 30);
    g.lineTo(0.52 * W + Math.cos(a) * 56, 0.5 * H + Math.sin(a) * 37);
    g.lineWidth = 1;
    g.stroke();
  }
  // title cartouche and compass
  g.font = 'italic 600 30px "Cormorant Garamond", "Palatino Linotype", Georgia, serif';
  g.fillStyle = 'rgba(40, 30, 18, 0.9)';
  g.textAlign = 'left';
  g.fillText(ISLAND_NAME, 40, 58);
  g.font = 'italic 15px "Cormorant Garamond", "Palatino Linotype", Georgia, serif';
  g.fillStyle = 'rgba(60, 46, 30, 0.8)';
  g.fillText('field map — E. Varga', 42, 80);
  compass(g, W - 90, H - 96, 34);
  return cv;
}

function compass(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.save();
  g.translate(x, y);
  g.strokeStyle = 'rgba(52, 40, 28, 0.75)';
  g.fillStyle = 'rgba(52, 40, 28, 0.75)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  for (let k = 0; k < 4; k++) {
    g.rotate(Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -r * 1.15);
    g.lineTo(5, 0);
    g.lineTo(-5, 0);
    g.closePath();
    if (k === 3) g.fill();
    else g.stroke();
  }
  g.restore();
  g.font = '600 14px "Marcellus SC", Georgia, serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(52, 40, 28, 0.85)';
  g.fillText('N', x, y - r - 10);
}

/** Mist over a region (a later chapter's, or a level's region before its path opens), `a` 0..1 thick. */
function mist(g: CanvasRenderingContext2D, r: Region, a: number): void {
  if (a <= 0.01) return;
  const cx = r.at[0] * W;
  const cy = r.at[1] * H;
  for (let k = 0; k < 9; k++) {
    const ox = Math.cos(k * 2.3) * 50 * (k % 3) + Math.sin(k) * 30;
    const oy = Math.sin(k * 1.7) * 30 * (k % 2) + Math.cos(k * 3) * 18;
    const rad = 70 + (k % 4) * 22;
    const gr = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
    gr.addColorStop(0, `rgba(244, 238, 226, ${0.55 * a})`);
    gr.addColorStop(1, 'rgba(244, 238, 226, 0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx + ox, cy + oy, rad, 0, Math.PI * 2);
    g.fill();
  }
}

const MEDAL: Record<string, string> = { gold: '#e2b53e', silver: '#c6ccd2', bronze: '#c08048', none: 'rgba(80,64,44,0.35)' };

/** The live map: the painting under a pan/zoom view, mist, paths (with their reveal), nodes; click to select. */
export class IslandMap {
  readonly root = document.createElement('div');
  readonly canvas = document.createElement('canvas');
  private base = paintBase();
  private g: CanvasRenderingContext2D;
  private t = 0;
  private raf = 0;
  /** paths being drawn out: level → progress 0..1 */
  private reveals = new Map<string, number>();
  selected = '';
  hover = '';
  onSelect: ((level: string) => void) | null = null;
  /** a revealed path finished drawing */
  onRevealed: ((level: string) => void) | null = null;
  /** the view: zoom (1 = the whole map) and the map point (map px at 1×) at the canvas centre */
  private zoom = 1;
  private cx = W / 2;
  private cy = H / 2;
  private goal = { zoom: 1, cx: W / 2, cy: H / 2 };
  private dirty = true;
  private mistCanvas = document.createElement('canvas');
  private mistKey = '';
  private pointers = new Map<number, { x: number; y: number }>();
  private dragged = 0;

  constructor(private nodes: () => NodeView[], revealed: (level: string) => boolean) {
    this.root.className = 'island-wrap';
    this.canvas.className = 'island-map';
    this.root.appendChild(this.canvas);
    const bar = document.createElement('div');
    bar.className = 'island-zoom';
    bar.innerHTML = '<button data-z="in" title="Zoom in">+</button><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="The whole island">⤢</button>';
    bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      if (b.dataset.z === 'in') this.zoomBy(1.5);
      else if (b.dataset.z === 'out') this.zoomBy(1 / 1.5);
      else this.goal = { zoom: 1, cx: W / 2, cy: H / 2 };
      this.dirty = true;
    });
    this.root.appendChild(bar);
    this.g = this.canvas.getContext('2d')!;
    for (const n of nodes()) if (nodePath(n.node) && n.state !== 'locked' && !revealed(n.node.level)) this.reveals.set(n.node.level, 0);
    this.bindInput();
    let last = performance.now();
    let drawn = -1;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (now - drawn < 40) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.t += dt;
      let moving = this.ease(dt);
      for (const [k, v] of this.reveals) {
        if (v >= 1) continue;
        moving = true;
        const nv = Math.min(1, v + dt / 2.2);
        this.reveals.set(k, nv);
        if (nv >= 1) this.onRevealed?.(k);
      }
      if (moving || this.dirty || drawn < 0 || this.pulsing()) {
        this.draw();
        this.dirty = false;
        drawn = now;
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Centre the view on a level's node (zoomed in a little when the whole island is shown). */
  focus(level: string): void {
    const n = this.nodes().find((v) => v.node.level === level);
    if (!n) return;
    const [x, y] = nodePos(n.node);
    this.goal = { zoom: Math.max(this.goal.zoom, 1.6), cx: x * W, cy: y * H };
    this.dirty = true;
  }

  private zoomBy(k: number, ax?: number, ay?: number): void {
    const z = Math.min(ZOOM_MAX, Math.max(1, this.goal.zoom * k));
    // keep the map point under (ax, ay) (canvas px) where it is
    if (ax !== undefined && ay !== undefined) {
      const [mx, my] = this.toMap(ax, ay);
      const s = this.scale(z);
      this.goal.cx = mx - (ax - this.canvas.width / 2) / s;
      this.goal.cy = my - (ay - this.canvas.height / 2) / s;
    }
    this.goal.zoom = z;
  }

  /** Canvas px per map px at a zoom. */
  private scale(z = this.zoom): number {
    return Math.min(this.canvas.width / W, this.canvas.height / H) * z;
  }

  private toMap(px: number, py: number): [number, number] {
    const s = this.scale();
    return [this.cx + (px - this.canvas.width / 2) / s, this.cy + (py - this.canvas.height / 2) / s];
  }

  private toCanvas(mx: number, my: number): [number, number] {
    const s = this.scale();
    return [(mx - this.cx) * s + this.canvas.width / 2, (my - this.cy) * s + this.canvas.height / 2];
  }

  /** Ease the view toward its goal, kept on the map; true while it moves. */
  private ease(dt: number): boolean {
    const G = this.goal;
    // the view may not leave the map
    const s = this.scale(G.zoom);
    const hw = this.canvas.width / 2 / s;
    const hh = this.canvas.height / 2 / s;
    G.cx = Math.min(W - Math.min(hw, W / 2), Math.max(Math.min(hw, W / 2), G.cx));
    G.cy = Math.min(H - Math.min(hh, H / 2), Math.max(Math.min(hh, H / 2), G.cy));
    const k = 1 - Math.exp(-dt * 12);
    const dz = G.zoom - this.zoom;
    const dx = G.cx - this.cx;
    const dy = G.cy - this.cy;
    if (Math.abs(dz) < 1e-3 && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
      this.zoom = G.zoom;
      this.cx = G.cx;
      this.cy = G.cy;
      return false;
    }
    this.zoom += dz * k;
    this.cx += dx * k;
    this.cy += dy * k;
    return true;
  }

  private bindInput(): void {
    const cv = this.canvas;
    const rel = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height];
    };
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = rel(e);
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), x, y);
      this.dirty = true;
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const [x, y] = rel(e);
      this.pointers.set(e.pointerId, { x, y });
      this.dragged = 0;
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = rel(e);
      const p = this.pointers.get(e.pointerId);
      if (p) {
        if (this.pointers.size === 1) {
          // drag pans
          const s = this.scale(this.goal.zoom);
          this.goal.cx -= (x - p.x) / s;
          this.goal.cy -= (y - p.y) / s;
          this.cx = this.goal.cx;
          this.cy = this.goal.cy;
          this.dragged += Math.hypot(x - p.x, y - p.y);
        } else if (this.pointers.size === 2) {
          // pinch zooms about the pair's middle
          const [a, b] = [...this.pointers.entries()];
          const other = a[0] === e.pointerId ? b[1] : a[1];
          const d0 = Math.hypot(p.x - other.x, p.y - other.y);
          const d1 = Math.hypot(x - other.x, y - other.y);
          if (d0 > 4) this.zoomBy(d1 / d0, (x + other.x) / 2, (y + other.y) / 2);
          this.dragged += 10;
        }
        p.x = x;
        p.y = y;
        this.dirty = true;
      } else {
        const h = this.nodeAt(x, y)?.node.level ?? '';
        if (h !== this.hover) {
          this.hover = h;
          this.dirty = true;
        }
        cv.style.cursor = this.hover ? 'pointer' : 'grab';
      }
    });
    const up = (e: PointerEvent) => {
      const [x, y] = rel(e);
      const wasTap = this.pointers.size === 1 && this.dragged < 6;
      this.pointers.delete(e.pointerId);
      if (!wasTap) return;
      const n = this.nodeAt(x, y);
      if (n) {
        this.selected = n.node.level;
        this.onSelect?.(n.node.level);
        this.dirty = true;
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    cv.addEventListener('dblclick', (e) => {
      const [x, y] = rel(e);
      this.zoomBy(1.8, x, y);
      this.dirty = true;
    });
    // the canvas follows its box (crisp on any screen)
    const fit = () => {
      const r = this.root.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(200, Math.round(r.width * dpr));
      const h = Math.max(140, Math.round(Math.min(r.height, r.width * (H / W)) * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        this.dirty = true;
      }
    };
    new ResizeObserver(fit).observe(this.root);
    fit();
  }

  private pulsing(): boolean {
    let reduce = false;
    try {
      reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reduce = false;
    }
    return !reduce && this.nodes().some((v) => v.state === 'open');
  }

  /** The node under a canvas point (nodes keep their size on screen). */
  private nodeAt(px: number, py: number): NodeView | null {
    const k = this.canvas.width / 1000;
    let best: NodeView | null = null;
    let bd = 24 * Math.max(0.8, k);
    for (const n of this.nodes()) {
      const [x, y] = nodePos(n.node);
      const [cx, cy] = this.toCanvas(x * W, y * H);
      const d = Math.hypot(cx - px, cy - py);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  private draw(): void {
    const g = this.g;
    const cv = this.canvas;
    const s = this.scale();
    // UI size on the canvas (nodes and labels keep this size whatever the zoom)
    const u = Math.max(0.75, Math.min(1.6, cv.width / 1100));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#d9c9a8';
    g.fillRect(0, 0, cv.width, cv.height);
    // the map, under the view
    g.setTransform(s, 0, 0, s, cv.width / 2 - this.cx * s, cv.height / 2 - this.cy * s);
    g.drawImage(this.base, 0, 0, W, H);
    const views = this.nodes();
    // mist (a cached layer: later chapters' regions; a level's region before its path opens)
    const alphas = REGIONS.map((r) => {
      const n = views.find((v) => v.node.region === r.id && v.node.chapter <= CURRENT_CHAPTER);
      let a = r.chapter > CURRENT_CHAPTER ? 1 : 0;
      if (n && n.state === 'locked' && !views.some((v) => v.node.region === r.id && v.state !== 'locked')) a = 0.55;
      if (n && this.reveals.has(n.node.level)) a = 0.55 * (1 - (this.reveals.get(n.node.level) ?? 1));
      return Math.round(a * 20) / 20;
    });
    const key = alphas.join(',');
    if (key !== this.mistKey) {
      this.mistKey = key;
      const mc = this.mistCanvas;
      mc.width = W;
      mc.height = H;
      const mg = mc.getContext('2d')!;
      REGIONS.forEach((r, i) => mist(mg, r, alphas[i]));
    }
    g.drawImage(this.mistCanvas, 0, 0, W, H);
    // paths
    for (const v of views) {
      const P = nodePath(v.node);
      if (!P || v.state === 'locked') continue;
      const prog = this.reveals.get(v.node.level) ?? 1;
      let len = 0;
      for (let i = 1; i < P.length; i++) len += Math.hypot((P[i][0] - P[i - 1][0]) * W, (P[i][1] - P[i - 1][1]) * H);
      g.save();
      g.setLineDash([9 / Math.sqrt(this.zoom), 7 / Math.sqrt(this.zoom)]);
      g.lineDashOffset = -this.t * 8;
      g.strokeStyle = 'rgba(122, 44, 28, 0.85)';
      g.lineWidth = 3 / Math.sqrt(this.zoom);
      g.lineCap = 'round';
      g.beginPath();
      let acc = 0;
      g.moveTo(P[0][0] * W, P[0][1] * H);
      for (let i = 1; i < P.length; i++) {
        const sl = Math.hypot((P[i][0] - P[i - 1][0]) * W, (P[i][1] - P[i - 1][1]) * H);
        const rem = prog * len - acc;
        if (rem <= 0) break;
        const t = Math.min(1, rem / sl);
        g.lineTo((P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t) * W, (P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t) * H);
        acc += sl;
      }
      g.stroke();
      g.restore();
    }
    // region names and "Coming soon" (screen-sized text at their map places)
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.textAlign = 'center';
    for (const r of REGIONS) {
      const later = r.chapter > CURRENT_CHAPTER;
      const n = views.find((v) => v.node.region === r.id);
      const [px, py] = this.toCanvas(r.at[0] * W, r.at[1] * H);
      const ty = n ? this.toCanvas(0, nodePos(n.node)[1] * H)[1] + 46 * u : py - (r.id === 'heart' ? 46 : 26) * u;
      const tx = n ? this.toCanvas(nodePos(n.node)[0] * W, 0)[0] : px;
      g.font = `600 ${(r.id === 'heart' ? 14 : 16) * u}px "Marcellus SC", "Palatino Linotype", Georgia, serif`;
      g.fillStyle = later ? 'rgba(70, 56, 40, 0.55)' : 'rgba(40, 30, 18, 0.82)';
      g.fillText(r.name.toUpperCase(), tx, ty);
      if (later) {
        g.font = `italic 600 ${15 * u}px "Cormorant Garamond", "Palatino Linotype", Georgia, serif`;
        g.fillStyle = 'rgba(70, 56, 40, 0.8)';
        g.fillText('Coming soon', px, py + 8 * u);
      }
    }
    // nodes (screen-sized), names when selected, hovered, open, or once zoomed in
    const showAll = this.zoom >= 1.7;
    for (const v of views) {
      if (this.reveals.has(v.node.level) && (this.reveals.get(v.node.level) ?? 1) < 1) continue;
      const [mx, my] = nodePos(v.node);
      const [x, y] = this.toCanvas(mx * W, my * H);
      if (x < -40 || y < -40 || x > cv.width + 40 || y > cv.height + 40) continue;
      const sel = this.selected === v.node.level;
      const hov = this.hover === v.node.level;
      const pulse = v.state === 'open' ? 0.5 + 0.5 * Math.sin(this.t * 3) : 0;
      if (sel || pulse) {
        g.beginPath();
        g.arc(x, y, (22 + pulse * 5) * u, 0, Math.PI * 2);
        g.strokeStyle = `rgba(150, 52, 30, ${sel ? 0.9 : 0.35 + pulse * 0.4})`;
        g.lineWidth = 2.5 * u;
        g.stroke();
      }
      g.beginPath();
      g.arc(x, y, (hov ? 17 : 15) * u, 0, Math.PI * 2);
      g.fillStyle = v.state === 'locked' ? 'rgba(120, 108, 92, 0.85)' : v.state === 'won' ? '#6b2e1c' : '#8f3a22';
      g.fill();
      g.strokeStyle = v.node.boss ? '#d6a548' : 'rgba(30, 20, 12, 0.9)';
      g.lineWidth = (v.node.boss ? 3 : 2) * u;
      g.stroke();
      g.font = `600 ${15 * u}px "Marcellus SC", Georgia, serif`;
      g.fillStyle = v.state === 'locked' ? 'rgba(230, 222, 206, 0.8)' : '#f6ead0';
      g.fillText(v.state === 'locked' ? '·' : String(v.number), x, y + 5 * u);
      if (v.state === 'won')
        v.medals.forEach((m, i) => {
          g.beginPath();
          g.arc(x + (-12 + i * 12) * u, y + 23 * u, 4.8 * u, 0, Math.PI * 2);
          g.fillStyle = MEDAL[m] ?? MEDAL.none;
          g.fill();
          g.strokeStyle = 'rgba(30, 20, 12, 0.7)';
          g.lineWidth = 1;
          g.stroke();
        });
      if (showAll || sel || hov || v.state === 'open') {
        g.font = `italic 600 ${14 * u}px "Cormorant Garamond", "Palatino Linotype", Georgia, serif`;
        const tw = g.measureText(v.title).width;
        g.fillStyle = 'rgba(236, 226, 204, 0.75)';
        g.fillRect(x - tw / 2 - 4 * u, y - 37 * u, tw + 8 * u, 17 * u);
        g.fillStyle = 'rgba(36, 26, 16, 0.92)';
        g.fillText(v.title, x, y - 24 * u);
      }
    }
  }
}
