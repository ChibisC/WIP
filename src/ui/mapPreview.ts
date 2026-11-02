import type { MapDef, Shape } from '../maps/types';
import { surfaceLayout } from '../world/surfaceLayout';
import { pickTeamSites, teamGroups } from '../world/teamSites';

/** Map card thumbnails: an authored map's water, walls, crossings, food and colony sites drawn from its data. */

const GROUND: Record<string, string> = { meadow: '#5d7a3a', forest: '#4a4630', riverbank: '#6a7a44', rainforest: '#3e5230', savanna: '#b0965e' };

function trace(ctx: CanvasRenderingContext2D, s: Shape, k: number): void {
  ctx.beginPath();
  if ('poly' in s) {
    s.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
    ctx.closePath();
  } else if ('circle' in s) ctx.arc(s.circle[0] * k, s.circle[1] * k, s.r * k, 0, Math.PI * 2);
  else if ('ellipse' in s) ctx.ellipse(s.ellipse[0] * k, s.ellipse[1] * k, s.rx * k, s.ry * k, s.rot ?? 0, 0, Math.PI * 2);
  else s.path.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
}

function paint(ctx: CanvasRenderingContext2D, s: Shape, k: number, fill: string): void {
  trace(ctx, s, k);
  if ('path' in s) {
    ctx.strokeStyle = fill;
    ctx.lineWidth = Math.max(1, s.width * k);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.stroke();
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

/** Ring colours of the teams in a preview: your team, then the others; a colony on its own team is pale. */
const YOURS = '#7fdc6a';
const OTHERS = ['#e0584a', '#e8b84a', '#a07ae0', '#4ac0b0', '#e07ab8'];
const ALONE = '#f2e6c8';

/**
 * A canvas `size` px on its long side showing the map from above. With `teams` (a team per colony; colony `you` is
 * yours; CHANGE_PLAN §22) and a team of two or more, each colony's site is ringed in its team's colour, allies joined by
 * a line and the sites nobody gets dimmed — the placement the match will use (world/teamSites.ts).
 */
export function mapPreview(def: MapDef, size = 132, teams?: Array<number | undefined>, you = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const k = size / Math.max(def.width, def.depth);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(def.width * k * dpr);
  c.height = Math.round(def.depth * k * dpr);
  c.style.width = `${Math.round(def.width * k)}px`;
  c.style.height = `${Math.round(def.depth * k)}px`;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = GROUND[def.biome] ?? '#5d7a3a';
  ctx.fillRect(0, 0, def.width * k, def.depth * k);
  for (const f of def.floods) paint(ctx, f.shape, k, 'rgba(70,110,150,0.25)');
  for (const z of def.zones) if (z.kind === 'food') paint(ctx, z.shape, k, 'rgba(230,190,90,0.35)');
  for (const wb of def.water) paint(ctx, wb.shape, k, '#3d6e8c');
  for (const wl of def.walls) paint(ctx, wl.shape, k, wl.kind === 'termiteMound' ? '#9a6a40' : wl.kind === 'log' || wl.kind === 'trunk' || wl.kind === 'buttress' ? '#5a4232' : '#8a8478');
  for (const wk of def.walkways) paint(ctx, wk.shape, k, '#c8a878');
  for (const z of def.zones) if (z.kind === 'lair') paint(ctx, z.shape, k, 'rgba(160,50,40,0.55)');
  const placed = teams && teams.length > 1 ? pickTeamSites(surfaceLayout(def), teams) : null;
  const used = new Set(placed?.sites ?? []);
  def.sites.forEach((s, i) => {
    ctx.beginPath();
    ctx.arc(s.at[0] * k, s.at[1] * k, Math.max(2, 3.2), 0, Math.PI * 2);
    ctx.fillStyle = placed && !used.has(i) ? 'rgba(242,230,200,0.35)' : '#f2e6c8';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2a1e12';
    ctx.stroke();
  });
  if (placed && teams) {
    const at = (i: number) => def.sites[placed.sites[i]].at;
    let other = 0;
    for (const g of teamGroups(teams)) {
      const col = g.includes(you) ? YOURS : g.length > 1 ? OTHERS[other++ % OTHERS.length] : ALONE;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      for (let a = 1; a < g.length; a++) {
        ctx.beginPath();
        ctx.moveTo(at(g[a - 1])[0] * k, at(g[a - 1])[1] * k);
        ctx.lineTo(at(g[a])[0] * k, at(g[a])[1] * k);
        ctx.stroke();
      }
      for (const i of g) {
        ctx.beginPath();
        ctx.arc(at(i)[0] * k, at(i)[1] * k, i === you ? 7 : 5.5, 0, Math.PI * 2);
        ctx.lineWidth = i === you ? 2.5 : 2;
        ctx.stroke();
      }
    }
  }
  return c;
}
