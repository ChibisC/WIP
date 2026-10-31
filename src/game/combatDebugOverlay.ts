import { World } from '../sim/world';
import { Ant, AS } from '../sim/types';
import { casteOf } from '../sim/species';
import { anchored, antHoldPoint, antSlotCount, bodyHook, creatureSlotCount, creatureSlotOff, creatureSlotWorld, frontOff } from '../sim/slots';
import { HitboxOverlay } from './hitboxOverlay';

/**
 * Combat debug view (combat v2.1, CHANGE_PLAN §17; `?combatdebug=1`, the arena panel's "Combat" button): what the
 * fighters are doing, drawn on the ground.
 *  - anchored (holding, firing, recovering, a planned step): a white pin standing on the ant;
 *  - blocked (no closer while closing in: the timer running): a red ring;
 *  - backing off: an orange arrow back from the fight;
 *  - going round: a cyan arrow along the ring, the way it goes;
 *  - the slot it has reserved: a green line to its hold point;
 *  - round every target being fought: its slots — taken amber, free cyan (ants: at the hold radius of a 4 mm worker;
 *    creatures: on the ring round the body).
 */
const PIN = 0xffffff;
const BLOCK = 0xff3b30;
const BACK = 0xff9a3c;
const ROUND = 0x3ce0ff;
const RSV = 0x5cff7a;
const TAKEN = 0xffc23c;
const FREE = 0x3ce0ff;
const tmp = { x: 0, y: 0, n: 0 };

export class CombatDebugOverlay extends HitboxOverlay {
  /** Draw the combat state of everything in `space` within `radius` mm of (cx, cy); hide with `on` false. */
  update(w: World, space: number, on: boolean, heightAt: (x: number, y: number) => number, cx: number, cy: number, radius: number): void {
    this.group.visible = on;
    if (!on) return;
    this.n = 0;
    const r2 = radius * radius;
    const targets = new Map<number, number>(); // id → kind (3 ant, 4 creature)
    const taken = new Map<number, number[]>();
    let count = 0;
    for (const a of w.s.ants) {
      if (a.space !== space || a.state === AS.Dead || (a.x - cx) ** 2 + (a.y - cy) ** 2 > r2) continue;
      if (++count > 1500) break;
      const L = casteOf(a.caste).length;
      const y = heightAt(a.x, a.y) + 0.2;
      if (anchored(a)) {
        this.line(a.x, y, a.y, a.x, y + L * 1.2, a.y, PIN);
        this.circle(a.x, y + L * 1.2, a.y, L * 0.12, PIN);
      }
      if (a.state === AS.Attack && (a.blkT ?? 0) > 0) this.circle(a.x, y, a.y, L * 0.55, BLOCK);
      const t = a.tk === 3 ? w.antById.get(a.tgt) : a.tk === 4 ? w.creatureById.get(a.tgt) : undefined;
      if ((a.repT ?? 0) !== 0 && t) {
        const h = Math.atan2(a.y - t.y, a.x - t.x);
        this.arrow(a.x, y, a.y, h, L, BACK);
      }
      if ((a.garT ?? 0) > 0 && (a.flk ?? 0) !== 0 && t) {
        const h = Math.atan2(a.y - t.y, a.x - t.x) + (a.flk ?? 1) * Math.PI * 0.5;
        this.arrow(a.x, y, a.y, h, L, ROUND);
      }
      if (a.state === AS.Attack && (a.rsv ?? 0) !== 0 && a.rsv === a.tgt && t) {
        this.slotPoint(w, a, a.tk, a.tgt, a.gSlot);
        this.line(a.x, y, a.y, tmp.x, y, tmp.y, RSV);
      }
      // what is being fought, and which of its slots are taken
      const id = a.state === AS.Grapple ? a.gId : a.state === AS.Attack ? a.tgt : 0;
      const kind = a.state === AS.Grapple ? a.gKind : a.tk;
      if (id && (kind === 3 || kind === 4)) {
        targets.set(id, kind);
        if (a.state === AS.Grapple || ((a.rsv ?? 0) === id && a.state === AS.Attack)) {
          let l = taken.get(id);
          if (!l) taken.set(id, (l = []));
          l.push(a.gSlot);
        }
      }
    }
    for (const [id, kind] of targets) {
      const held = taken.get(id) ?? [];
      if (kind === 3) {
        const o = w.antById.get(id);
        if (!o) continue;
        const n = antSlotCount(o, 4, o.id === w.colony(o.colony)?.queen);
        const y = heightAt(o.x, o.y) + 0.25;
        for (let k = 0; k < n; k++) {
          const ang = ((k + 0.5) / n) * Math.PI * 2;
          const sec = (a: number) => Math.min(n - 1, Math.floor(((((a / (Math.PI * 2)) % 1) + 1) % 1) * n));
          const isTaken = held.some((g) => sec(g) === k);
          antHoldPoint(PROBE, o, ang, tmp);
          this.circle(tmp.x, y, tmp.y, 0.3, isTaken ? TAKEN : FREE);
        }
      } else {
        const cr = w.creatureById.get(id);
        if (!cr) continue;
        const y = heightAt(cr.x, cr.y) + 0.25;
        for (const ring of [0, 1]) {
          const n = creatureSlotCount(cr, 4, ring === 1);
          for (let k = 0; k < n; k++) {
            const u = (k + 0.5) / n + ring;
            const isTaken = held.some((g) => (g >= 1 ? 1 : 0) === ring && Math.round(((g % 1) * n - 0.5 + n) % n) % n === k);
            creatureSlotWorld(cr, creatureSlotOff(cr, 4, u), u % 1, tmp);
            this.circle(tmp.x, y, tmp.y, ring ? 0.25 : 0.4, isTaken ? TAKEN : FREE);
          }
        }
        void bodyHook;
      }
    }
    this.flush();
  }

  /** The hold point of slot `slot` on target (`kind`, `id`) for ant `a`, into `tmp`. */
  private slotPoint(w: World, a: Ant, kind: number, id: number, slot: number): void {
    if (kind === 3) {
      const o = w.antById.get(id);
      if (o) antHoldPoint(a, o, slot, tmp);
      return;
    }
    const cr = w.creatureById.get(id);
    if (cr) creatureSlotWorld(cr, creatureSlotOff(cr, casteOf(a.caste).length, slot), slot % 1, tmp);
    else {
      tmp.x = a.x;
      tmp.y = a.y;
    }
    void frontOff;
  }

  private arrow(x: number, y: number, z: number, h: number, L: number, col: number): void {
    const ex = x + Math.cos(h) * L;
    const ez = z + Math.sin(h) * L;
    this.line(x, y, z, ex, y, ez, col);
    for (const s of [-1, 1]) this.line(ex, y, ez, ex - Math.cos(h + s * 0.5) * L * 0.35, y, ez - Math.sin(h + s * 0.5) * L * 0.35, col);
  }
}

/** A 4 mm worker standing in for "an attacker" when the slots round an ant are drawn. */
const PROBE = { caste: 'lasius_worker' } as Ant;
