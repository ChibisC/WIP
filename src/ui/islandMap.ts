import { fbm2 } from '../core/rng';
import { ISLAND_NAME, LevelNode, NODES, REGIONS, Region } from '../story/campaign';

/**
 * The campaign's island map (claude/story/02-spec §3): an original, procedurally painted field map of Wayfarer
 * Island in the narrator's journal style — ink coastline and contour ripples on paper, watercolour washes per region,
 * the river, small ink marks for grass, trees, dunes and mounds, the caldera at the heart. Regions without a level are
 * under mist ("Coming soon"). Level nodes sit on it, joined by dashed paths; a path is drawn out (and its region's
 * mist lifts) the first time it opens. Drawn once into an offscreen canvas; the nodes and animations go on top.
 */

export interface NodeView {
  node: LevelNode;
  state: 'locked' | 'open' | 'won';
  /** medals won (gold/silver/bronze/none ×3) */
  medals: string[];
  number: number;
  title: string;
}

const W = 1200;
const H = 820;
const CX = 0.52;
const CY = 0.52;

/** The island's outline radius at an angle (map units, 0..1 of the height), irregular and wider east–west. */
function coastR(a: number): number {
  const n = fbm2(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, 4, 77) - 0.5;
  const bays = Math.sin(a * 3 + 0.7) * 0.025 + Math.sin(a * 7 + 2.1) * 0.012;
  return 0.39 * (1 + n * 0.45 + bays);
}

function inIsland(x: number, y: number): number {
  // signed: > 0 inside (in units of the map height)
  const dx = (x - CX) * (H / W) * 1.45;
  const dy = y - CY;
  const a = Math.atan2(dy, dx);
  return coastR(a) - Math.hypot(dx, dy);
}

function nearestRegion(x: number, y: number): { r: Region; d: number; d2: number } {
  let best = REGIONS[0];
  let bd = Infinity;
  let second = Infinity;
  for (const r of REGIONS) {
    // jittered distances: wavy borders
    const j = (fbm2(x * 7 + r.at[0] * 13, y * 7 + r.at[1] * 13, 4, 31) - 0.5) * 0.16;
    const d = Math.hypot((x - r.at[0]) * (W / H), y - r.at[1]) + j + (r.id === 'heart' ? 0.05 : 0);
    if (d < bd) {
      second = bd;
      bd = d;
      best = r;
    } else if (d < second) second = d;
  }
  return { r: best, d: bd, d2: second };
}

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** The painted base map (paper, sea, island, regions, river, marks, labels). */
function paintBase(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  // paper and sea, per pixel at a quarter resolution, then smoothed up
  const s = 4;
  const lw = W / s;
  const lh = H / s;
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
        // the sea: a wash darker away from the coast, fading to paper at the page edge
        const t = Math.min(1, -inside / 0.12);
        const edge = Math.min(x, y, 1 - x, 1 - y);
        const fade = Math.min(1, edge / 0.06);
        c = paper.map((p, q) => p + (sea[q] - 18 * t - p) * fade * (0.55 + 0.45 * t));
      } else {
        const { r, d, d2 } = nearestRegion(x, y);
        const rc = hex(r.color);
        const border = Math.min(1, (d2 - d) / 0.02);
        const wet = fbm2(x * 14 + 3, y * 14, 3, 21);
        const mix = 0.62 + wet * 0.3;
        c = paper.map((p, q) => p + (rc[q] - p) * mix * (0.75 + 0.25 * border));
        // a darker ink line at region borders (very soft)
        if (border < 1) c = c.map((v) => v - (1 - border) * 18);
        // shore: pale sand rim
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
      const a = (k / 360) * Math.PI * 2;
      const r = coastR(a) + off;
      const px = (CX + (Math.cos(a) * r) / ((H / W) * 1.45)) * W;
      const py = (CY + Math.sin(a) * r) * H;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
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
  g.beginPath();
  const riv = [
    [0.52, 0.53],
    [0.5, 0.6],
    [0.53, 0.68],
    [0.5, 0.74],
    [0.53, 0.81],
    [0.5, 0.9],
  ];
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
  g.ellipse(0.27 * W, 0.74 * H, 30, 18, 0.3, 0, Math.PI * 2);
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
  for (let i = 0; i < 2600; i++) {
    const x = rnd();
    const y = rnd();
    if (inIsland(x, y) < 0.02) continue;
    const { r } = nearestRegion(x, y);
    const px = x * W;
    const py = y * H;
    g.strokeStyle = 'rgba(48, 38, 24, 0.5)';
    g.fillStyle = 'rgba(48, 38, 24, 0.45)';
    g.lineWidth = 1;
    if (r.id === 'meadow' && rnd() < 0.5) {
      // grass ticks
      g.beginPath();
      g.moveTo(px - 3, py);
      g.lineTo(px - 1, py - 5);
      g.moveTo(px, py);
      g.lineTo(px + 1, py - 6);
      g.moveTo(px + 3, py);
      g.lineTo(px + 3.5, py - 4);
      g.stroke();
    } else if (r.id === 'forest' && rnd() < 0.55) {
      // conifers
      g.beginPath();
      g.moveTo(px, py - 9);
      g.lineTo(px - 4.5, py + 2);
      g.lineTo(px + 4.5, py + 2);
      g.closePath();
      g.fillStyle = 'rgba(46, 56, 34, 0.55)';
      g.fill();
    } else if (r.id === 'rainforest' && rnd() < 0.7) {
      // round canopies
      g.beginPath();
      g.arc(px, py, 3.5 + rnd() * 3, 0, Math.PI * 2);
      g.fillStyle = `rgba(${30 + rnd() * 20}, ${60 + rnd() * 30}, 40, 0.5)`;
      g.fill();
    } else if (r.id === 'savanna' && rnd() < 0.35) {
      if (rnd() < 0.15) {
        // termite mounds
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
  // region names (a region with a level node: under the node, clear of its title)
  g.textAlign = 'center';
  for (const r of REGIONS) {
    const n = NODES.find((x) => x.region === r.id);
    g.font = `600 ${r.id === 'heart' ? 15 : 17}px "Marcellus SC", "Palatino Linotype", Georgia, serif`;
    g.fillStyle = 'rgba(40, 30, 18, 0.82)';
    if (n) g.fillText(r.name.toUpperCase(), n.at[0] * W, n.at[1] * H + 56);
    else g.fillText(r.name.toUpperCase(), r.at[0] * W, r.at[1] * H - (r.id === 'heart' ? 46 : 26));
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

/** Mist over a region (locked, "Coming soon"), `a` 0..1 thick. */
function mist(g: CanvasRenderingContext2D, r: Region, a: number, t: number, label: boolean): void {
  if (a <= 0.01) return;
  const cx = r.at[0] * W;
  const cy = r.at[1] * H;
  for (let k = 0; k < 9; k++) {
    const ox = Math.cos(k * 2.3 + t * 0.05) * 50 * (k % 3) + Math.sin(k) * 30;
    const oy = Math.sin(k * 1.7 + t * 0.04) * 30 * (k % 2) + Math.cos(k * 3) * 18;
    const rad = 70 + (k % 4) * 22;
    const gr = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
    gr.addColorStop(0, `rgba(244, 238, 226, ${0.55 * a})`);
    gr.addColorStop(1, 'rgba(244, 238, 226, 0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx + ox, cy + oy, rad, 0, Math.PI * 2);
    g.fill();
  }
  if (label) {
    g.font = 'italic 600 16px "Cormorant Garamond", "Palatino Linotype", Georgia, serif';
    g.textAlign = 'center';
    g.fillStyle = `rgba(70, 56, 40, ${0.85 * a})`;
    g.fillText('Coming soon', cx, cy + 6);
  }
}

const MEDAL: Record<string, string> = { gold: '#e2b53e', silver: '#c6ccd2', bronze: '#c08048', none: 'rgba(80,64,44,0.35)' };

/** The live map: base painting, mist, paths (with their reveal), nodes; click to select a node. */
export class IslandMap {
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

  constructor(private nodes: () => NodeView[], revealed: (level: string) => boolean) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'island-map';
    this.g = this.canvas.getContext('2d')!;
    for (const n of nodes()) if (n.node.path && n.state !== 'locked' && !revealed(n.node.level)) this.reveals.set(n.node.level, 0);
    this.canvas.addEventListener('pointermove', (e) => {
      this.hover = this.nodeAt(e)?.node.level ?? '';
      this.canvas.style.cursor = this.hover ? 'pointer' : 'default';
    });
    this.canvas.addEventListener('click', (e) => {
      const n = this.nodeAt(e);
      if (n) {
        this.selected = n.node.level;
        this.onSelect?.(n.node.level);
      }
    });
    let last = performance.now();
    let drawn = -1;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      if (now - drawn < 50) {
        this.raf = requestAnimationFrame(loop);
        return;
      }
      last = now;
      this.t += dt;
      let moving = false;
      for (const [k, v] of this.reveals) {
        if (v >= 1) continue;
        moving = true;
        const nv = Math.min(1, v + dt / 2.2);
        this.reveals.set(k, nv);
        if (nv >= 1) {
          this.onRevealed?.(k);
          this.mistKey = '';
        }
      }
      // (a gentle pulse on the open node and the path's march: a redraw every 50 ms is plenty)
      if (moving || drawn < 0 || this.dirty || this.pulsing()) {
        this.draw();
        this.dirty = false;
        drawn = now;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.canvas.addEventListener('pointermove', () => (this.dirty = true));
  }

  private dirty = true;
  /** the mist layer, redrawn only when what it shows changes */
  private mistCanvas = document.createElement('canvas');
  private mistKey = '';

  private pulsing(): boolean {
    return this.nodes().some((v) => v.state === 'open') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }

  private nodeAt(e: PointerEvent | MouseEvent): NodeView | null {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    for (const n of this.nodes()) if (Math.hypot(n.node.at[0] * W - x, n.node.at[1] * H - y) < 26) return n;
    return null;
  }

  private draw(): void {
    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.base, 0, 0);
    const views = this.nodes();
    // mist: regions without a level; a level's region until its path is revealed (a cached layer)
    const alphas = REGIONS.map((r) => {
      const n = views.find((v) => v.node.region === r.id);
      let a = r.open ? 0 : 1;
      if (n && n.state === 'locked') a = 0.55;
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
      REGIONS.forEach((r, i) => mist(mg, r, alphas[i], 0, !r.open));
    }
    g.drawImage(this.mistCanvas, 0, 0);
    // paths
    for (const v of views) {
      const P = v.node.path;
      if (!P || v.state === 'locked') continue;
      const prog = this.reveals.get(v.node.level) ?? 1;
      let len = 0;
      for (let i = 1; i < P.length; i++) len += Math.hypot((P[i][0] - P[i - 1][0]) * W, (P[i][1] - P[i - 1][1]) * H);
      g.save();
      g.setLineDash([9, 7]);
      g.lineDashOffset = -this.t * 8;
      g.strokeStyle = 'rgba(122, 44, 28, 0.85)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      let acc = 0;
      g.moveTo(P[0][0] * W, P[0][1] * H);
      for (let i = 1; i < P.length; i++) {
        const sl = Math.hypot((P[i][0] - P[i - 1][0]) * W, (P[i][1] - P[i - 1][1]) * H);
        const rem = prog * len - acc;
        if (rem <= 0) break;
        const u = Math.min(1, rem / sl);
        g.lineTo((P[i - 1][0] + (P[i][0] - P[i - 1][0]) * u) * W, (P[i - 1][1] + (P[i][1] - P[i - 1][1]) * u) * H);
        acc += sl;
      }
      g.stroke();
      g.restore();
    }
    // nodes
    for (const v of views) {
      const x = v.node.at[0] * W;
      const y = v.node.at[1] * H;
      const sel = this.selected === v.node.level;
      const hov = this.hover === v.node.level;
      const pulse = v.state === 'open' ? 0.5 + 0.5 * Math.sin(this.t * 3) : 0;
      if (this.reveals.has(v.node.level) && (this.reveals.get(v.node.level) ?? 1) < 1) continue;
      if (sel || pulse) {
        g.beginPath();
        g.arc(x, y, 24 + pulse * 5, 0, Math.PI * 2);
        g.strokeStyle = `rgba(150, 52, 30, ${sel ? 0.9 : 0.35 + pulse * 0.4})`;
        g.lineWidth = 2.5;
        g.stroke();
      }
      g.beginPath();
      g.arc(x, y, hov ? 19 : 17, 0, Math.PI * 2);
      g.fillStyle = v.state === 'locked' ? 'rgba(120, 108, 92, 0.85)' : v.state === 'won' ? '#6b2e1c' : '#8f3a22';
      g.fill();
      g.strokeStyle = 'rgba(30, 20, 12, 0.9)';
      g.lineWidth = 2;
      g.stroke();
      g.font = '600 17px "Marcellus SC", Georgia, serif';
      g.textAlign = 'center';
      g.fillStyle = v.state === 'locked' ? 'rgba(230, 222, 206, 0.8)' : '#f6ead0';
      g.fillText(v.state === 'locked' ? '·' : String(v.number), x, y + 6);
      // medals under a won node
      if (v.state === 'won')
        v.medals.forEach((m, i) => {
          g.beginPath();
          g.arc(x - 14 + i * 14, y + 27, 5.5, 0, Math.PI * 2);
          g.fillStyle = MEDAL[m] ?? MEDAL.none;
          g.fill();
          g.strokeStyle = 'rgba(30, 20, 12, 0.7)';
          g.lineWidth = 1;
          g.stroke();
        });
      g.font = 'italic 600 15px "Cormorant Garamond", "Palatino Linotype", Georgia, serif';
      g.fillStyle = 'rgba(36, 26, 16, 0.9)';
      g.fillText(v.title, x, y - 28);
    }
  }
}

export const ISLAND_SIZE = { w: W, h: H };
export { NODES };
