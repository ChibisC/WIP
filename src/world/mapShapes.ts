import type { Pt, Shape } from '../maps/types';
import { dcos, dhypot, dsin } from '../sim/dmath';

/** Axis-aligned bounds of a shape (mm), grown by a margin. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function shapeBox(s: Shape, margin = 0): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, r: number) => {
    if (x - r < x0) x0 = x - r;
    if (y - r < y0) y0 = y - r;
    if (x + r > x1) x1 = x + r;
    if (y + r > y1) y1 = y + r;
  };
  if ('poly' in s) for (const p of s.poly) add(p[0], p[1], 0);
  else if ('path' in s) for (const p of s.path) add(p[0], p[1], s.width / 2);
  else if ('circle' in s) add(s.circle[0], s.circle[1], s.r);
  else add(s.ellipse[0], s.ellipse[1], Math.max(s.rx, s.ry));
  return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
}

/** Distance from (x, y) to the segment a–b. */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return dhypot(x - (ax + vx * t), y - (ay + vy * t));
}

/** Point in polygon (even–odd crossing rule). */
export function inPoly(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Signed distance (mm) from (x, y) to a shape's edge: negative inside, positive outside.
 * Exact for polygons, paths and circles; for ellipses a close approximation (scaled circle).
 * Deterministic (plain arithmetic and dmath).
 */
export function shapeDist(s: Shape, x: number, y: number): number {
  if ('poly' in s) {
    const p = s.poly;
    let d = Infinity;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const e = segDist(x, y, p[j][0], p[j][1], p[i][0], p[i][1]);
      if (e < d) d = e;
    }
    return inPoly(p, x, y) ? -d : d;
  }
  if ('path' in s) {
    const p = s.path;
    let d = Infinity;
    if (p.length === 1) d = dhypot(x - p[0][0], y - p[0][1]);
    for (let i = 1; i < p.length; i++) {
      const e = segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
      if (e < d) d = e;
    }
    return d - s.width / 2;
  }
  if ('circle' in s) return dhypot(x - s.circle[0], y - s.circle[1]) - s.r;
  const rot = s.rot ?? 0;
  const c = dcos(rot);
  const sn = dsin(rot);
  const dx = x - s.ellipse[0];
  const dy = y - s.ellipse[1];
  const u = (dx * c + dy * sn) / s.rx;
  const v = (-dx * sn + dy * c) / s.ry;
  return (dhypot(u, v) - 1) * Math.min(s.rx, s.ry);
}

/** Is (x, y) inside the shape. */
export function inShape(s: Shape, x: number, y: number): boolean {
  return shapeDist(s, x, y) < 0;
}

/** Smooth 0→1 step. */
export function smooth01(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}
