import { GameSession } from '../game/session';
import { AS, SURFACE, TREES, colonyOfSpace } from '../sim/types';
import { SOIL_AIR, SOIL_GATE, SOIL_ROCK, SOIL_ROUTE, SOIL_STONE } from '../world/nestGrid';
import { halfIn, routesOf } from '../sim/tunnels';
import { edible } from '../sim/diet';
import { MARKER_COLORS, MARKER_NAMES } from '../sim/markers';
import { kindsOf } from '../sim/trees';
import { groupById } from '../sim/tiles';
import { el, esc, shield } from './dom';
import { AreaTabs } from './areaTabs';
import { TOUCH } from '../core/device';
import { ICONS } from './icons';
import { casteFigureColour } from '../render/casteLook';

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
  private surfLbl = el('div', 'mm-lbl', 'Surface');
  private surfBase: HTMLCanvasElement | null = null;
  /** the "TREES" bar (claude/trees/01-spec-trees-layer.md §3): tall and narrow, right of the ground map; only with the layer on */
  private treesBar = el('button', 'pnl mm-trees');
  private treesLbl = el('span', 'mm-trees-lbl', 'TREES');
  private canopyBase: HTMLCanvasElement | null = null;
  private nestImg: ImageData | null = null;
  private nestVer = -1;
  private nestFogKey = -1;
  private nestFor = -1;
  private tick = 0;
  private size = 0;

  constructor(private s: GameSession) {
    this.nestBox.append(this.nestCv, this.nestLbl);
    this.surfBox.append(this.surfCv, this.surfLbl);
    this.treesBar.append(this.treesLbl);
    this.treesBar.dataset.tip = '<b>The trees</b>Up into the canopy: the branches, twigs and leaves over the ground, where ants climb the trunks to forage and fight. Click again (or the ground map) to come back down.';
    this.treesBar.addEventListener('click', (e) => {
      e.stopPropagation();
      s.toggleTrees();
    });
    this.treesBar.hidden = true;
    this.nestBox.dataset.tip = '<b>Area map</b>The underground area you are watching. Tile groups are coloured hexes; arrows mark the ramps up to the surface; dots: food (amber), your ants (pale), allies (blue), enemies (red). Click to look there.';
    this.surfBox.dataset.tip = '<b>Surface map</b>Your ants are bright dots; food is amber. Each underground area’s entrance shows its number and colour (a crown for a nest with its queen). Click to look there.';
    this.tabs = new AreaTabs(s);
    const row = el('div', 'mm-row');
    row.append(this.nestBox, this.surfBox, this.treesBar);
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
      const x = ((e.clientX - r.left) / r.width) * t.width;
      const y = ((e.clientY - r.top) / r.height) * t.depth;
      // in the trees the ground map shows the canopy: a click looks there
      if (s.view.inTrees) s.jumpTo('nest', x, y, TREES);
      else s.jumpTo('surface', x, y);
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
    const inTrees = this.s.view.inTrees;
    this.nestBox.classList.toggle('active', this.s.view.space === 'nest' && !inTrees);
    this.surfBox.classList.toggle('active', this.s.view.space === 'surface' || inTrees);
    this.treesBar.hidden = !this.s.treesOn;
    this.treesBar.classList.toggle('up', inTrees);
    this.treesLbl.textContent = inTrees ? 'GROUND' : 'TREES';
    this.surfLbl.textContent = inTrees ? 'The trees' : 'Surface';
    this.drawNest(S);
    if (inTrees) this.drawCanopy(S);
    else this.drawSurface(S);
  }

  /** The area the area map shows: the one watched, while it is open; else home (the trees are not an area: home). */
  private areaSpace(): number {
    if (this.s.viewedArea === TREES) return this.s.areaTabs()[0].space;
    const t = this.s.areaTab(this.s.viewedArea);
    return t && t.open ? t.space : this.s.areaTabs()[0].space;
  }

  /** The canopy map (shown in the ground map's box while in the trees): the ground dimmed under it, the branches and leaves, the units, sites and markers. */
  private drawCanopy(S: number): void {
    const s = this.s;
    const w = s.world;
    const t = w.terrain;
    const d = w.s.trees;
    const g = w.nestOf(TREES);
    if (!d || !g) return;
    if (!this.surfBase) this.surfBase = this.bakeSurface(S);
    if (!this.canopyBase || this.canopyBase.width !== S) this.canopyBase = this.bakeCanopy(S);
    const ctx = this.surfCv.getContext('2d')!;
    ctx.drawImage(this.surfBase, 0, 0);
    ctx.fillStyle = 'rgba(10,14,18,0.62)';
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(this.canopyBase, 0, 0);
    const kx = S / t.width;
    const kz = S / t.depth;
    for (const f of w.s.food) {
      if (f.space !== TREES || f.kind === 'corpse') continue;
      const mine = edible(s.player, f);
      ctx.fillStyle = mine ? (s.foodView ? '#ffd060' : 'rgba(240,190,80,0.85)') : 'rgba(150,140,125,0.45)';
      const sz = mine && s.foodView ? 3 : 2;
      ctx.fillRect(f.x * kx - sz / 2, f.y * kz - sz / 2, sz, sz);
    }
    const me = s.player;
    for (const a of w.s.ants) {
      if (a.space !== TREES || a.state === AS.Dead) continue;
      ctx.fillStyle = a.colony === me.id ? '#fff2cc' : (a.team ?? a.colony) === me.team ? '#7fb8ff' : '#ff5a44';
      ctx.fillRect(a.x * kx - 0.7, a.y * kz - 0.7, 1.6, 1.6);
    }
    for (const cr of w.s.creatures) {
      if (cr.space !== TREES || cr.dead) continue;
      ctx.fillStyle = '#ff5a3c';
      ctx.beginPath();
      ctx.arc(cr.x * kx, cr.y * kz, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // the sites (empty branches for tree nests) and the trunk tops
    for (const st of d.sites) {
      ctx.strokeStyle = st.kind === 'leaf' ? '#9fe07a' : st.kind === 'hollow' ? '#6b4a2a' : '#f0e4c0';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(st.x * kx, st.y * kz, Math.max(2.5, S / 70), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const tr of d.trunks) {
      ctx.fillStyle = '#5a4634';
      ctx.beginPath();
      ctx.arc(tr.x * kx, tr.y * kz, Math.max(2, tr.r * kx), 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawMarkers(ctx, TREES, kx, kz, S);
    this.drawFrame(ctx, kx, kz);
  }

  /** The branches and leaves painted once (the canopy never changes). */
  private bakeCanopy(S: number): HTMLCanvasElement {
    const w = this.s.world;
    const t = w.terrain;
    const d = w.s.trees!;
    const g = w.nestOf(TREES)!;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    const kinds = kindsOf(d);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const q = g.hexAt((x / S) * t.width, (y / S) * t.depth);
        const k = q < 0 ? 0 : kinds[q];
        if (!k) continue;
        const i = (y * S + x) * 4;
        const col = k === 2 || k === 4 ? [92, 140, 58] : k === 3 ? [120, 92, 64] : [104, 78, 52];
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = 235;
      }
    ctx.putImageData(img, 0, 0);
    return cv;
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
    // floor raster (cached per dig version and the fog's state)
    const fog = s.fog;
    const sealed = fog.sealedOf(space);
    const lv = fog.levelsOf(space);
    const fogKey = (sealed?.size ?? 0) * 1000003 + (lv ? lv.reduce((a, b) => a + b, 0) : 0);
    if (g.version !== this.nestVer || fogKey !== this.nestFogKey) {
      this.nestVer = g.version;
      this.nestFogKey = fogKey;
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
            const cell = cy * g.w + cx;
            const q = g.cellHex[cell];
            let v = g.soil[cell];
            if (sealed && q >= 0 && sealed.has(q)) v = SOIL_ROUTE;
            const f = lv && q >= 0 ? lv[q] : 0;
            if (f === 2) [r, gg, b] = [12, 10, 8];
            else {
              if (v === SOIL_AIR) [r, gg, b] = [176, 132, 74];
              else if (v === SOIL_STONE) [r, gg, b] = [70, 68, 64];
              else if (v === SOIL_ROCK || v === SOIL_ROUTE) [r, gg, b] = [44, 46, 56];
              else if (v === SOIL_GATE) [r, gg, b] = [150, 96, 48];
              else [r, gg, b] = [30, 24, 17];
              if (f === 1) [r, gg, b] = [r * 0.45, gg * 0.45, b * 0.45];
            }
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
      ctx.fillStyle = t.type === 'brood' && t.caste ? casteFigureColour(t.caste) : (TILE_RGB[t.type] ?? '#888');
      hex(p.x * k, p.y * k, g.R * k * 0.92);
      ctx.fill();
      if (gr && gr.marker >= 0 && c!.player) {
        ctx.strokeStyle = MARKER_COLORS[gr.marker];
        ctx.lineWidth = Math.max(1, S / 160);
        ctx.stroke();
      }
    }
    // a flooding nest (sim/nestFlood.ts): the hexes under water in a muddy blue
    if (c?.nestFlood?.q.length) {
      ctx.fillStyle = 'rgba(78,108,132,0.7)';
      for (const q of c.nestFlood.q) {
        g.hexCenter(q, p);
        hex(p.x * k, p.y * k, g.R * k * 1.0);
        ctx.fill();
      }
    }
    // tunnel routes (sim/tunnels.ts): a gate as a brown ring (red when warned), an open route as a line to the rim
    for (const r of routesOf(w, space)) {
      const h = halfIn(r, space)!;
      g.hexCenter(h.gate, p);
      ctx.strokeStyle = h.warned && !r.open ? '#ff5a44' : r.open ? '#d8b070' : '#a06a30';
      ctx.lineWidth = Math.max(1.2, S / 140);
      hex(p.x * k, p.y * k, g.R * k * 1.1);
      ctx.stroke();
      if (r.open || s.player.routeDig === r.id) {
        const last = h.steps[h.steps.length - 1][0];
        const e = g.hexCenter(last);
        ctx.beginPath();
        ctx.moveTo(p.x * k, p.y * k);
        ctx.lineTo(e.x * k, e.y * k);
        ctx.setLineDash(r.open ? [] : [3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // the way up to the surface: one arrow on the entrance (a nest's wide flower, a cave's tunnel; grey once caved in)
    const ents = w.entrancesOf(space);
    g.entrances.forEach((q, i) => {
      g.hexCenter(q, p);
      const wide = (g.flowers[i]?.length ?? 0) > 1;
      this.arrow(ctx, p.x * k, p.y * k, Math.max(4, g.R * k * (wide ? 1.7 : 0.9)), true, ents.some((e) => e.fall) ? '#8a8a8a' : '#e8f0ff');
    });
    // food, then ants: yours pale, allies blue, enemies red; creatures as rings
    // (only food your colony can gather is shown in food colours; the rest is a dim grey)
    const shown = (x: number, y: number) => !fog.hasFog(space) || fog.visible(g, space, x, y);
    for (const f of w.s.food) {
      if (f.space !== space || f.heldBy || f.kind === 'corpse' || !shown(f.x, f.y)) continue;
      ctx.fillStyle = edible(s.player, f) ? (s.foodView ? '#ffd060' : 'rgba(240,190,80,0.9)') : 'rgba(150,140,125,0.45)';
      ctx.fillRect(f.x * k - 0.8, f.y * k - 0.8, 1.8, 1.8);
    }
    const me = s.player;
    for (const a of w.s.ants) {
      if (a.space !== space || a.state === AS.Dead || !shown(a.x, a.y)) continue;
      const team = a.team ?? a.colony;
      ctx.fillStyle = a.colony === me.id ? 'rgba(255,242,212,0.95)' : team === me.team ? '#7fb8ff' : '#ff5a44';
      const r = a.id === w.colony(a.colony)?.queen ? 2.4 : 0.8;
      ctx.fillRect(a.x * k - r, a.y * k - r, r * 2, r * 2);
    }
    for (const cr of w.s.creatures) {
      if (cr.space !== space || cr.dead || !shown(cr.x, cr.y)) continue;
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
        const water = t.isWater(wx, wz);
        // layered ground (world/layers.ts): higher levels lighter, banks a dark line, ramps a pale tan
        let lv = 1;
        let bank = false;
        let ramp = false;
        if (t.layers) {
          const k = cj * t.nx + ci;
          lv = 1 + t.layers.level[k] * 0.11;
          bank = t.layers.cliff[k] === 1;
          ramp = t.onRamp(wx, wz);
        }
        if (bank && !water) {
          const i = (y * S + x) * 4;
          img.data[i] = 52;
          img.data[i + 1] = 38;
          img.data[i + 2] = 26;
          img.data[i + 3] = 255;
          continue;
        }
        if (ramp) {
          r = r * 0.5 + 92;
          gg = gg * 0.5 + 80;
          b = b * 0.5 + 56;
        }
        r *= lv;
        gg *= lv;
        b *= lv;
        // rocks, logs and other walls (authored maps) in grey; stepping stones over water in tan
        const wall = !water && t.isBlocked(wx, wz);
        const walk = !water && !wall && t.map !== null && t.waterAt(wx, wz) > -9999;
        const i = (y * S + x) * 4;
        img.data[i] = water ? 40 : wall ? 118 * sh : walk ? 168 : r * sh;
        img.data[i + 1] = water ? 70 : wall ? 112 * sh : walk ? 146 : gg * sh;
        img.data[i + 2] = water ? 90 : wall ? 104 * sh : walk ? 108 : b * sh;
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
    // every area in its colour: an anthill as its queen's crown at its centre with a small dot on each of its three holes
    // (EotU-style); a cave, or a fallen nest, as an arrow down
    ctx.font = `${Math.round(S / 17)}px "Marcellus SC", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const r = Math.max(3.5, S / 46);
    for (const tab of s.areaTabs()) {
      const col = tab.alive ? tab.color : '#777';
      const nest = tab.owner >= 0 && tab.alive;
      const ents = w.entrancesOf(tab.space);
      if (!ents.length) continue;
      let cx = 0;
      let cy = 0;
      for (const e of ents) {
        cx += (e.sx * kx) / ents.length;
        cy += (e.sy * kz) / ents.length;
      }
      const ec = ents.some((e) => e.fall) ? '#777' : col;
      if (ents.length > 1)
        for (const e of ents) {
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(e.sx * kx, e.sy * kz, Math.max(1.6, r * 0.42), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = ec;
          ctx.beginPath();
          ctx.arc(e.sx * kx, e.sy * kz, Math.max(1.1, r * 0.3), 0, Math.PI * 2);
          ctx.fill();
        }
      if (nest) this.crown(ctx, cx, cy, r, ec);
      else this.arrow(ctx, cx, cy, r, false, ec);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(String(tab.number), cx + r * 1.7, cy - r * 0.9);
      ctx.fillStyle = col;
      ctx.fillText(String(tab.number), cx + r * 1.7, cy - r * 0.9);
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
