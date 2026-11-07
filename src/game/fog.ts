import { World } from '../sim/world';
import { AS, Colony, SURFACE, colonyOfSpace, nestSpace } from '../sim/types';
import { TUNNELS } from '../sim/balance';
import { dugFromGate, dugFromRim, halfIn, otherHalf, routesOf } from '../sim/tunnels';
import { NestGrid } from '../world/nestGrid';
import type { Sign } from '../render/game/routeSigns';

/**
 * Underground fog for tunnel invasions (claude/underground/01-spec-shared-underground-tunnels.md §3; CHANGE_PLAN §27).
 * Client-side only: the simulation knows everything and stays deterministic; this decides what the viewer's team is
 * shown of each underground area.
 *
 * Per hex of a space, a level: 0 seen, 1 remembered (seen before: drawn dimmed, no units), 2 dark (never seen). And a
 * set of sealed hexes: route hexes the owner's own digging has not reached, and an unjoined breach, drawn as solid rock
 * and hiding whatever stands in them (an enemy digging in is unseen until the warning).
 *
 * Rules for the viewer's team T looking at space S owned by O:
 * - a cave, or T's own or an ally's nest: all seen (except the sealed hexes);
 * - an enemy nest T's units entered by the surface entrance: all seen, as before the shared underground;
 * - an enemy nest reached only by tunnel: seen = the dug hexes within TUNNELS.sight of T's units there (while a route is
 *   closed, only its own hexes); the rest remembered or dark;
 * - a nest T has no units in: all remembered or dark (an enemy nest never seen stays dark).
 */
export const FOG_SEEN = 0;
export const FOG_REMEMBERED = 1;
export const FOG_DARK = 2;

export class Fog {
  /** per space: seen-ever bits per hex */
  private explored = new Map<number, Uint8Array>();
  /** per space, this frame: the levels and the sealed set */
  private levels = new Map<number, Uint8Array>();
  private sealed = new Map<number, Set<number>>();
  private tick = -1;

  /** Recompute for a space (once per sim tick). `reveal`: the sandbox's see-everything setting. */
  update(w: World, viewer: Colony, space: number, reveal = false): void {
    const g = w.nestOf(space);
    if (!g || space === SURFACE) return;
    const n = g.cols * g.rows;
    let lv = this.levels.get(space);
    if (!lv || lv.length !== n) this.levels.set(space, (lv = new Uint8Array(n)));
    let ex = this.explored.get(space);
    if (!ex || ex.length !== n) this.explored.set(space, (ex = new Uint8Array(n)));
    const sealed = this.sealedHexes(w, viewer, space, g);
    this.sealed.set(space, sealed);
    const owner = colonyOfSpace(space);
    const oc = owner >= 0 ? w.colony(owner) : undefined;
    const team = viewer.team;
    const friendly = !oc || w.teamOf(oc.id) === team || reveal;
    if (friendly) {
      lv.fill(FOG_SEEN);
      for (const q of sealed) lv[q] = FOG_DARK;
      return;
    }
    // an enemy nest: entered by the surface (any unit of the team that came in by an entrance): all seen
    let surface = false;
    const units: Array<{ x: number; y: number }> = [];
    for (const a of w.s.ants) {
      if (a.space !== space || a.state === AS.Dead || (a.team ?? a.colony) !== team) continue;
      if (a.ent >= 0 || a.ent === undefined) surface = true;
      units.push(a);
    }
    for (const cr of w.s.creatures) if (cr.space === space && !cr.dead && cr.faction >= 0 && w.teamOf(cr.faction) === team) units.push(cr);
    if (surface) {
      lv.fill(FOG_SEEN);
      for (const q of sealed) lv[q] = FOG_DARK;
      ex.fill(1);
      return;
    }
    // reached only by tunnel: sight round the units
    for (let q = 0; q < n; q++) lv[q] = ex[q] ? FOG_REMEMBERED : FOG_DARK;
    const anyOpen = routesOf(w, space).some((r) => r.open);
    const R = TUNNELS.sight;
    for (const u of units) {
      const q0 = g.hexAt(u.x, u.y);
      if (q0 < 0) continue;
      const rid = g.routeOf(q0);
      for (let q = 0; q < n; q++) {
        if (lv[q] === FOG_SEEN || g.hexDistance(q0, q) > R) continue;
        // while no route is open, only the route's own hexes are seen (the nest beyond stays dark)
        if (!anyOpen && g.routeOf(q) !== rid) continue;
        if (sealed.has(q)) continue;
        lv[q] = FOG_SEEN;
        ex[q] = 1;
      }
    }
  }

  /**
   * The sealed hexes of a space for this viewer: a closed route's steps beyond what the owner's side has dug from its
   * gate (a tunnel being dug in from the far side is hidden; the viewer's own diggers, when it is the one digging, are
   * not hidden from it), and an unjoined breach dug by the enemy.
   */
  private sealedHexes(w: World, viewer: Colony, space: number, g: NestGrid): Set<number> {
    const out = new Set<number>();
    const owner = colonyOfSpace(space);
    for (const r of routesOf(w, space)) {
      if (r.open) continue;
      const h = halfIn(r, space)!;
      const o = otherHalf(r, h);
      // the viewer digs this route (or its ally does): it sees what it has dug
      const digger = w.colony(o.colony);
      const mine = (digger && digger.routeDig === r.id && w.teamOf(digger.id) === viewer.team) || (owner >= 0 && w.teamOf(owner) === viewer.team && viewer.routeDig === r.id);
      if (mine) continue;
      const from = dugFromGate(w, h);
      for (let i = from; i < h.steps.length; i++) for (const q of h.steps[i]) if (q >= 0 && g.isHexDug(q)) out.add(q);
    }
    for (const r of routesOf(w, space)) {
      const h = halfIn(r, space)!;
      if (!h.breach || h.joined) continue;
      const o = otherHalf(r, h);
      // (a passage the nest's owner digs to its own gate is its own work; an enemy's breach is hidden from the owner)
      if (w.teamOf(o.colony) === viewer.team || (owner >= 0 && w.teamOf(owner) === viewer.team && (w.colony(o.colony)?.routeDig !== r.id || !r.open))) continue;
      for (const q of h.breach) if (g.isHexDug(q)) out.add(q);
    }
    return out;
  }

  level(space: number, q: number): number {
    const lv = this.levels.get(space);
    return lv ? lv[q] : FOG_SEEN;
  }

  levelsOf(space: number): Uint8Array | undefined {
    return this.levels.get(space);
  }

  sealedOf(space: number): Set<number> | undefined {
    return this.sealed.get(space);
  }

  /** Is a point in `space` shown to the viewer (seen, not sealed)? */
  visible(g: NestGrid, space: number, x: number, y: number): boolean {
    const q = g.hexAt(x, y);
    if (q < 0) return true;
    if (this.sealed.get(space)?.has(q)) return false;
    return this.level(space, q) === FOG_SEEN;
  }

  /** Does this space have any fog (something hidden) for the viewer? */
  hasFog(space: number): boolean {
    const lv = this.levels.get(space);
    if (lv) for (let i = 0; i < lv.length; i++) if (lv[i] !== FOG_SEEN) return true;
    return (this.sealed.get(space)?.size ?? 0) > 0;
  }

  /** The viewer's own nest is never fogged beyond its sealed hexes: a cheap test for the renderers. */
  static ownNest(viewer: Colony, space: number): boolean {
    return space === nestSpace(viewer.id);
  }

  /**
   * The signs to draw in a space for the viewer (render/game/routeSigns.ts): a red "!" over each gate warned of
   * enemy digging (until the route opens); and, while the viewer's diggers are within TUNNELS.hintRange steps of the far
   * gate of a closed route, hints past their frontier in the far nest: a "!" on enemy ants within hintRange hexes of
   * that gate, a food mark, a brood mark and a creature mark (one each; faint).
   */
  signs(w: World, viewer: Colony, space: number, out: Sign[] = []): Sign[] {
    out.length = 0;
    const g = w.nestOf(space);
    if (!g) return out;
    const owner = colonyOfSpace(space);
    for (const r of routesOf(w, space)) {
      const h = halfIn(r, space)!;
      // the defender's warning sign on its own gate
      if (owner >= 0 && w.teamOf(owner) === viewer.team && h.warned && !r.open) {
        const p = g.hexCenter(h.gate);
        out.push({ kind: 'alert', x: p.x, y: p.y });
      }
      // the attacker's hints: its diggers near the far gate
      if (r.open) continue;
      const o = otherHalf(r, h);
      const digger = w.colony(o.colony);
      if (!digger || digger.routeDig !== r.id || w.teamOf(digger.id) !== viewer.team) continue;
      if (owner < 0 || w.teamOf(owner) === viewer.team) continue;
      const left = h.steps.length - dugFromRim(w, h);
      if (left <= 0 || left > TUNNELS.hintRange) continue;
      const near = (x: number, y: number) => {
        const q = g.hexAt(x, y);
        return q >= 0 && g.hexDistance(q, h.gate) <= TUNNELS.hintRange && g.routeOf(q) < 0;
      };
      let food = false;
      let brood = false;
      let cr = false;
      const a = 0.55;
      for (const an of w.s.ants) {
        if (an.space !== space || an.state === AS.Dead || (an.team ?? an.colony) === viewer.team || !near(an.x, an.y)) continue;
        out.push({ kind: 'alert', x: an.x, y: an.y, a });
      }
      for (const f of w.s.food) if (!food && f.space === space && !f.heldBy && near(f.x, f.y)) {
        food = true;
        out.push({ kind: 'food', x: f.x, y: f.y, a });
      }
      for (const b of w.s.brood) if (!brood && b.colony === owner && near(b.x, b.y)) {
        brood = true;
        out.push({ kind: 'brood', x: b.x, y: b.y, a });
      }
      for (const c of w.s.creatures) if (!cr && c.space === space && !c.dead && near(c.x, c.y)) {
        cr = true;
        out.push({ kind: 'creature', x: c.x, y: c.y, a });
      }
    }
    return out;
  }

  /** Mark that a sim tick passed (the spaces recompute lazily on `update`). */
  advance(tick: number): boolean {
    if (tick === this.tick) return false;
    this.tick = tick;
    return true;
  }
}
