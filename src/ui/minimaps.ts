import { GameSession, casteTint } from '../game/session';
import { AS, SURFACE, colonyOfSpace } from '../sim/types';
import { SOIL_AIR, SOIL_STONE } from '../world/nestGrid';
import { edible } from '../sim/diet';
import { MARKER_COLORS, MARKER_NAMES } from '../sim/markers';
import { groupById } from '../sim/tiles';
import { el, esc, shield } from './dom';
import { AreaTabs } from './areaTabs';
import { TOUCH } from '../core/device';
import { ICONS } from './icons';

const TILE_RGB: Record<string, string> = { queen: '#9fb2c8', food: '#7a9a3a', fungus: '#e2dccc', aphid: '#a89870', thatch: '#9a7040', mound: '#c09058', carton: '#b08a58' };

/**
 * Bottom-left minimaps: the selected underground area (dug floor, tile groups
 * as small coloured hexes, entrance arrows, dots for food, your ants, allies
 * and enemies, markers) and the surface (ground cover, water, ants, food,
 * every area's entrance marked with its colour and number — a queen's crown
 * for nests — and markers). The current view is drawn as a frame; clicking
 * either map moves the camera there, switching maps if needed.
 */
export class Minimaps {
  root = el('div', 'mm');
  /** numbered underground-area tabs along the top of the minimaps */
  readonly tabs: AreaTabs;
  private nestBox = el('div', 'pnl mm-box');
  private surfBox = el('div', 'pnl mm-box');
  private nestCv = el('canvas');
  private nestLbl = el('div', 'mm-lbl', 'Area 1');
  private surfCv = el('canvas');
  private surfBase: HTMLCanvasElement | null = null;
  private nestImg: ImageData | null = null;
  private nestVer = -1;
  private nestFor = -1;
  private tick = 0;
  private size = 0;

  constructor(private s: GameSession) {
    this.nestBox.append(this.nestCv, this.nestLbl);
    this.surfBox.append(this.surfCv, el('div', 'mm-lbl', 'Surface'));
    this.nestBox.dataset.tip = '<b>Area map</b>The underground area you are watching. Tile groups are coloured hexes; arrows mark the ramps up to the surface; dots: food (amber), your ants (pale), allies (blue), enemies (red). Click to look there.';
    this.surfBox.dataset.tip = '<b>Surface map</b>Your ants are bright dots; food is amber. Each underground area’s entrance shows its number and colour (a crown for a nest with its queen). Click to look there.';
    this.tabs = new AreaTabs(s);
    const row = el('div', 'mm-row');
    row.append(this.nestBox, this.surfBox);
    this.root.append(this.tabs.root, row);
    if (TOUCH) {
      // compact layout (GameUI): the maps fold away behind this button
      const t = el('button', 'bbtn mm-toggle', ICONS.map);
      t.dataset.tip = '<b>Maps</b>Show or hide the area and surface maps. Tap a map to look there.';
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setOpen(!this.root.classList.contains('open'));
      });
      this.tabs.root.appendChild(t);
    }
    shield(this.root);
    this.nestCv.addEventListener('click', (e) => {
      const space = this.areaSpace();
      const g = s.world.nestOf(space)!;
      const r = this.nestCv.getBoundingClientRect();
      const k = Math.max(g.widthMm, g.depthMm);
      s.jumpTo('nest', ((e.clientX - r.left) / r.width) * k, ((e.clientY - r.top) / r.height) * k, space);
    });
    this.surfCv.addEventListener('click', (e) => {
      const t = s.world.terrain;
      const r = this.surfCv.getBoundingClientRect();
      s.jumpTo('surface', ((e.clientX - r.left) / r.width) * t.width, ((e.clientY - r.top) / r.height) * t.depth);
    });
  }

  /** compact layout: maps shown or folded (the full layout always shows them) */
  setOpen(on: boolean): void {
    this.root.classList.toggle('open', on);
    if (on) this.update(true);
  }

  private fit(): number {
    const px = Math.round(this.nestCv.getBoundingClientRect().width * Math.min(2, window.devicePixelRatio || 1));
    if (px > 0 && px !== this.size) {
      this.size = px;
      for (const cv of [this.nestCv, this.surfCv]) cv.width = cv.height = px;
      this.surfBase = null;
      this.nestVer = -1;
    }
    return this.size;
  }

  update(force = false): void {
    this.tabs.update();
    this.tick++;
    if (!force && this.tick % 6 !== 0) return;
    const S = this.fit();
    if (!S) return;
    this.nestBox.classList.toggle('active', this.s.view.space === 'nest');
    this.surfBox.classList.toggle('active', this.s.view.space === 'surface');
    this.drawNest(S);
    this.drawSurface(S);
  }

  /** The area the area map shows: the one watched, while it is open; else home. */
  private areaSpace(): number {
    const t = this.s.areaTab(this.s.viewedArea);
    return t && t.open ? t.space : this.s.areaTabs()[0].space;
  }

  private drawNest(S: number): void {
    const s = this.s;
    const w = s.world;
    const space = this.areaSpace();
    const tab = s.areaTab(space)!;
    const g = w.nestOf(space)!;
    const c = w.colony(colonyOfSpace(space));
    if (this.nestFor !== space) {
      this.nestFor = space;
      this.nestVer = -1;
    }
    const ctx = this.nestCv.getContext('2d')!;
    const k = S / Math.max(g.widthMm, g.depthMm);
    // floor raster (cached per dig version)
    if (g.version !== this.nestVer) {
      this.nestVer = g.version;
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const cx = Math.floor((x / k) / g.cell);
          const cy = Math.floor((y / k) / g.cell);
          const i = (y * S + x) * 4;
          let r = 10;
          let gg = 8;
          let b = 6;
          if (cx < g.w && cy < g.h) {
            const v = g.soil[cy * g.w + cx];
            if (v === SOIL_AIR) [r, gg, b] = [176, 132, 74];
            else if (v === SOIL_STONE) [r, gg, b] = [70, 68, 64];
            else [r, gg, b] = [30, 24, 17];
          }
          img.data[i] = r;
          img.data[i + 1] = gg;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      this.nestImg = img;
    }
    ctx.putImageData(this.nestImg!, 0, 0);
    // designated hexes and tiles as small hexes
    const hex = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
    };
    const p = { x: 0, y: 0 };
    ctx.strokeStyle = 'rgba(255,170,60,0.9)';
    ctx.lineWidth = Math.max(1, S / 200);
    for (let q = 0; q < g.hexDesig.length; q++) {
      if (!g.hexDesig[q] || g.isHexDug(q)) continue;
      g.hexCenter(q, p);
      hex(p.x * k, p.y * k, g.R * k * 0.85);
      ctx.stroke();
    }
    for (const t of c?.tiles ?? []) {
      g.hexCenter(t.q, p);
      const gr = groupById(c!, t.group);
      ctx.fillStyle = t.type === 'brood' && t.caste ? '#' + casteTint(t.caste).multiplyScalar(1.3).getHexString() : (TILE_RGB[t.type] ?? '#888');
      hex(p.x * k, p.y * k, g.R * k * 0.92);
      ctx.fill();
      if (gr && gr.marker >= 0 && c!.player) {
        ctx.strokeStyle = MARKER_COLORS[gr.marker];
        ctx.lineWidth = Math.max(1, S / 160);
        ctx.stroke();
      }
    }
    // ramps up to the surface: arrows
    for (const q of g.entrances) {
      g.hexCenter(q, p);
      this.arrow(ctx, p.x * k, p.y * k, Math.max(4, g.R * k * 0.9), true, '#e8f0ff');
    }
    // food, then ants: yours pale, allies blue, enemies red; creatures as rings
    // (only food your colony can gather is shown in food colours; the rest is a dim grey)
    for (const f of w.s.food) {
      if (f.space !== space || f.heldBy || f.kind === 'corpse') continue;
      ctx.fillStyle = edible(s.player, f) ? (s.foodView ? '#ffd060' : 'rgba(240,190,80,0.9)') : 'rgba(150,140,125,0.45)';
      ctx.fillRect(f.x * k - 0.8, f.y * k - 0.8, 1.8, 1.8);
    }
    const me = s.player;
    for (const a of w.s.ants) {
      if (a.space !== space || a.state === AS.Dead) continue;
      const team = a.team ?? a.colony;
      ctx.fillStyle = a.colony === me.id ? 'rgba(255,242,212,0.95)' : team === me.team ? '#7fb8ff' : '#ff5a44';
      const r = a.id === w.colony(a.colony)?.queen ? 2.4 : 0.8;
      ctx.fillRect(a.x * k - r, a.y * k - r, r * 2, r * 2);
    }
    for (const cr of w.s.creatures) {
      if (cr.space !== space || cr.dead) continue;
      ctx.strokeStyle = '#ff5a3c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cr.x * k, cr.y * k, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawMarkers(ctx, space, k, k, S);
    if (s.view.space === 'nest' && s.view.activeNest === space) this.drawFrame(ctx, k, k);
    const lbl = `<span style="color:${tab.color}">${tab.number}</span> · ${esc(tab.kind === 'home' ? 'Your nest' : tab.name)}`;
    if (this.nestLbl.innerHTML !== lbl) this.nestLbl.innerHTML = lbl;
    this.nestBox.style.setProperty('--ac', tab.color);
  }

  /** A small arrow (up = a ramp to the surface, down = a way into an area). */
  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, up: boolean, col: string): void {
    const d = up ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y + d * r);
    ctx.lineTo(x - r * 0.75, y - d * r * 0.2);
    ctx.lineTo(x - r * 0.28, y - d * r * 0.2);
    ctx.lineTo(x - r * 0.28, y - d * r);
    ctx.lineTo(x + r * 0.28, y - d * r);
    ctx.lineTo(x + r * 0.28, y - d * r * 0.2);
    ctx.lineTo(x + r * 0.75, y - d * r * 0.2);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  /** A queen's crown in an area colour (nests on the surface map). */
  private crown(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
    ctx.beginPath();
    ctx.moveTo(x - r, y + r * 0.6);
    ctx.lineTo(x - r, y - r * 0.4);
    ctx.lineTo(x - r * 0.5, y + r * 0.05);
    ctx.lineTo(x, y - r * 0.8);
    ctx.lineTo(x + r * 0.5, y + r * 0.05);
    ctx.lineTo(x + r, y - r * 0.4);
    ctx.lineTo(x + r, y + r * 0.6);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  private bakeSurface(S: number): HTMLCanvasElement {
    const t = this.s.world.terrain;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    const cols = [
      [92, 66, 42],
      [70, 96, 44],
      [176, 150, 104],
      [96, 70, 40],
    ];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const wx = (x / S) * t.width;
        const wz = (y / S) * t.depth;
        const ci = Math.min(t.nx - 1, Math.round(wx / t.res));
        const cj = Math.min(t.ny - 1, Math.round(wz / t.res));
        const k4 = (cj * t.nx + ci) * 4;
        let r = 0;
        let gg = 0;
        let b = 0;
        let sum = 0;
        for (let c = 0; c < 4; c++) {
          const wgt = t.coverW[k4 + c];
          r += cols[c][0] * wgt;
          gg += cols[c][1] * wgt;
          b += cols[c][2] * wgt;
          sum += wgt;
        }
        if (sum > 0) {
          r /= sum;
          gg /= sum;
          b /= sum;
        }
        // relief shading
        const h0 = t.heightAt(wx, wz);
        const h1 = t.heightAt(Math.min(t.width, wx + 3), Math.min(t.depth, wz + 3));
        const sh = Math.max(0.6, Math.min(1.3, 1 + (h0 - h1) * 0.08));
        const water = !t.passable(wx, wz);
        const i = (y * S + x) * 4;
        img.data[i] = water ? 40 : r * sh;
        img.data[i + 1] = water ? 70 : gg * sh;
        img.data[i + 2] = water ? 90 : b * sh;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  private drawSurface(S: number): void {
    const s = this.s;
    const w = s.world;
    const t = w.terrain;
    if (!this.surfBase) this.surfBase = this.bakeSurface(S);
    const ctx = this.surfCv.getContext('2d')!;
    ctx.drawImage(this.surfBase, 0, 0);
    const kx = S / t.width;
    const kz = S / t.depth;
    // food
    for (const f of w.s.food) {
      if (f.space !== SURFACE || f.kind === 'corpse') continue;
      const mine = edible(s.player, f);
      ctx.fillStyle = mine ? (s.foodView ? '#ffd060' : 'rgba(240,190,80,0.85)') : 'rgba(150,140,125,0.45)';
      const sz = mine && s.foodView ? 3 : 2;
      ctx.fillRect(f.x * kx - sz / 2, f.y * kz - sz / 2, sz, sz);
    }
    // ants: yours bright, allies blue, enemies red
    const me = s.player;
    for (const a of w.s.ants) {
      if (a.space !== SURFACE || a.state === AS.Dead) continue;
      ctx.fillStyle = a.colony === me.id ? '#fff2cc' : (a.team ?? a.colony) === me.team ? '#7fb8ff' : '#ff5a44';
      ctx.fillRect(a.x * kx - 0.7, a.y * kz - 0.7, 1.6, 1.6);
    }
    for (const cr of w.s.creatures) {
      if (cr.space !== SURFACE || cr.dead) continue;
      ctx.fillStyle = '#ff5a3c';
      ctx.beginPath();
      ctx.arc(cr.x * kx, cr.y * kz, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // every area's entrances in its colour: a crown for a nest with a living queen, an arrow down otherwise
    ctx.font = `${Math.round(S / 17)}px "Marcellus SC", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const r = Math.max(3.5, S / 46);
    for (const tab of s.areaTabs()) {
      const col = tab.alive ? tab.color : '#777';
      const nest = tab.owner >= 0 && tab.alive;
      for (const e of w.entrancesOf(tab.space)) {
        const x = e.sx * kx;
        const y = e.sy * kz;
        if (nest) this.crown(ctx, x, y, r, col);
        else this.arrow(ctx, x, y, r, false, col);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(String(tab.number), x + r * 1.7, y - r * 0.9);
        ctx.fillStyle = col;
        ctx.fillText(String(tab.number), x + r * 1.7, y - r * 0.9);
      }
    }
    this.drawMarkers(ctx, SURFACE, kx, kz, S);
    if (s.view.space === 'surface') this.drawFrame(ctx, kx, kz);
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, space: number, kx: number, kz: number, S: number): void {
    const c = this.s.player;
    ctx.font = `${Math.round(S / 14)}px "Marcellus SC", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    c.markers.forEach((m, i) => {
      if (!m.placed || m.space !== space) return;
      const x = m.x * kx;
      const y = m.y * kz;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(MARKER_NAMES[i], x, y);
      ctx.fillStyle = MARKER_COLORS[i];
      ctx.fillText(MARKER_NAMES[i], x, y);
    });
  }

  private drawFrame(ctx: CanvasRenderingContext2D, kx: number, kz: number): void {
    const fp = this.s.view.viewFootprint(this.s.view.space);
    ctx.strokeStyle = 'rgba(255,240,200,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    fp.forEach((p, i) => (i ? ctx.lineTo(p.x * kx, p.y * kz) : ctx.moveTo(p.x * kx, p.y * kz)));
    ctx.closePath();
    ctx.stroke();
  }
}
