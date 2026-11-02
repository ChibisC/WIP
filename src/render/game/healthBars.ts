import * as THREE from 'three';
import { World } from '../../sim/world';
import { AS, Colony } from '../../sim/types';
import { casteOf } from '../../sim/species';
import { antHeights, creatureHeights } from '../../sim/underpass';
import { creatureKind } from '../../sim/creatures/kinds';
import { arenaOf } from '../../sim/arenaState';
import { TEAM_COLORS } from './teamRings';

/** Bar fills away from the battle arena: yours, an ally's, a foe's, a wild creature's. */
const MINE = new THREE.Color('#5fcf58');
const ALLY = new THREE.Color('#58a0ee');
const FOE = new THREE.Color('#e04a3e');
const WILD = new THREE.Color('#dc9634');
const BACK = new THREE.Color('#0b0907');
/** the health just lost, shown a moment before it drains away */
const TRAIL = new THREE.Color('#f1e4c4');
const GOLD = new THREE.Color('#e9bf55');
const GOLD_EDGE = new THREE.Color('#1c1408');
/**
 * Sizes on screen (px), whatever the zoom (user 2026-11-01, 22:36: "make healthbars more slimmer and professional
 * looking"): the bar `BAR_H` thick in a 1 px dark frame, `BAR_K` × the unit's drawn length long between `BAR_MIN` and
 * `BAR_MAX`, `GAP` above the unit; chevrons `CHEV` wide.
 */
const BAR_H = 3;
const BAR_K = 0.75;
const BAR_MIN = 20;
const BAR_MAX = 56;
const RIM = 1;
const GAP = 5;
const CHEV = 7;
/** the lost-health trail: it waits `TRAIL_WAIT` s, then drains at `TRAIL_RATE` of the bar a second */
const TRAIL_WAIT = 0.35;
const TRAIL_RATE = 0.8;

/**
 * Health bars and level marks over every unit (user 2026-11-01, 21:36: "give health bars to all creatures and level
 * symbols like eotu"; 22:36: slimmer, more professional; render only). A bar shows over an ant, a termite or a creature
 * once it has been hurt, and over the unit being inspected: a slim fill in the side's colour (the arena's team colour;
 * elsewhere green yours, blue an ally's, red a foe's, amber a wild creature's), lighter along its top, in a thin dark
 * frame, sized on screen (not with the zoom), facing the camera, over everything; a hit leaves a pale trail of the
 * health just lost that drains away after a moment. A level II unit has a small gold chevron left of the bar, a level
 * III one two (our own mark, not EotU's art). Units up on a creature, held in jaws, or dead have none, nor titans (the
 * bosses: their bar is across the top of the screen).
 */
export class HealthBars {
  readonly group = new THREE.Group();
  private back: THREE.InstancedMesh;
  private trail: THREE.InstancedMesh;
  private fill: THREE.InstancedMesh;
  private chev: THREE.InstancedMesh;
  private chevBack: THREE.InstancedMesh;
  private cap = 0;
  private chevCap = 0;
  private quad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
  /** the fill: lighter along its top edge, darker below (vertex colours × the instance colour) */
  private quadShaded = shadedQuad();
  private chevGeo = chevronGeometry();
  private matBack = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.82, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  private mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  private matShaded = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private cols = TEAM_COLORS.map((c) => new THREE.Color(c));
  private tmp = new THREE.Color();
  /** per unit (ants by id, creatures by −id): the trail's fraction and how long since the last hit */
  private trails = new Map<number, { f: number; t: number; seen: number }>();
  private frame = 0;

  constructor(name = 'healthBars') {
    this.group.name = name;
    this.back = this.make(null, this.quad, this.matBack, 64, 998);
    this.trail = this.make(null, this.quad, this.mat, 64, 999);
    this.fill = this.make(null, this.quadShaded, this.matShaded, 64, 1000);
    this.chevBack = this.make(null, this.chevGeo, this.mat, 32, 1001);
    this.chev = this.make(null, this.chevGeo, this.matShaded, 32, 1002);
    this.cap = 64;
    this.chevCap = 32;
  }

  private make(old: THREE.InstancedMesh | null, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, order: number): THREE.InstancedMesh {
    if (old) {
      this.group.remove(old);
      old.dispose();
    }
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, BACK);
    m.frustumCulled = false;
    m.renderOrder = order;
    m.name = ['back', 'trail', 'fill', 'chevBack', 'chev'][order - 998];
    m.count = 0;
    this.group.add(m);
    return m;
  }

  /** One quad (x from 0 to 1 along `right`, centred on `up`) at the bar's left end + `x0`, `w` long, `h` high. */
  private quadAt(mesh: THREE.InstancedMesh, k: number, x0: number, y0: number, w: number, h: number, col: THREE.Color): void {
    this.m.makeBasis(this.right, this.up, this.s.crossVectors(this.right, this.up));
    this.m.scale(this.s.set(Math.max(1e-5, w), h, 1));
    this.m.setPosition(this.p.x + this.right.x * x0 + this.up.x * y0, this.p.y + this.right.y * x0 + this.up.y * y0, this.p.z + this.right.z * x0 + this.up.z * y0);
    mesh.setMatrixAt(k, this.m);
    mesh.setColorAt(k, col);
  }

  /**
   * `pos`: the world point of plane coords lifted `lift` mm off the ground; `selected`: the unit being inspected
   * (kind 'ant' or 'creature' and its id); `dt`: real seconds since the last frame (the lost-health trail).
   */
  update(
    w: World,
    space: number,
    alpha: number,
    cam: THREE.PerspectiveCamera,
    viewportH: number,
    pos: (x: number, y: number, lift: number, out: THREE.Vector3) => void,
    player: Colony,
    selected: { kind: 'ant' | 'creature'; id: number } | null,
    dt = 1 / 60,
  ): void {
    this.frame++;
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const pxPerMmAt1 = viewportH / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const A = arenaOf(w);
    const team = new Map<number, number>();
    if (A) A.teams.forEach((t, i) => team.set(t.colony, i));
    const myTeam = w.teamOf(player.id);
    let n = 0;
    let nt = 0;
    let nc = 0;
    const colourOf = (colony: number, wild: boolean): THREE.Color => {
      if (wild) return WILD;
      const t = team.get(colony);
      if (t !== undefined) return this.cols[t % this.cols.length];
      if (colony === player.id) return MINE;
      return w.teamOf(colony) === myTeam ? ALLY : FOE;
    };
    const put = (key: number, x: number, y: number, lift: number, L: number, frac: number, col: THREE.Color, level: number) => {
      pos(x, y, lift, this.p);
      const dist = Math.max(1, cam.position.distanceTo(this.p));
      // mm per pixel here
      const px = dist / pxPerMmAt1;
      const W = Math.max(BAR_MIN, Math.min(BAR_MAX, (L * BAR_K) / px)) * px;
      const H = BAR_H * px;
      const rim = RIM * px;
      // (above the unit's top, a few pixels clear of it)
      this.p.addScaledVector(this.up, GAP * px);
      if (n >= this.cap) {
        this.cap *= 2;
        this.back = this.make(this.back, this.quad, this.matBack, this.cap, 998);
        this.trail = this.make(this.trail, this.quad, this.mat, this.cap, 999);
        this.fill = this.make(this.fill, this.quadShaded, this.matShaded, this.cap, 1000);
      }
      // the lost-health trail: holds a moment after a hit, then drains to the bar
      let tr = this.trails.get(key);
      if (!tr) this.trails.set(key, (tr = { f: frac, t: 0, seen: 0 }));
      tr.seen = this.frame;
      if (frac >= tr.f) {
        tr.f = frac;
        tr.t = 0;
      } else {
        tr.t += dt;
        if (tr.t > TRAIL_WAIT) tr.f = Math.max(frac, tr.f - TRAIL_RATE * dt);
      }
      // frame, trail, fill (the bar's left end at −W/2)
      this.quadAt(this.back, n, -W / 2 - rim, 0, W + rim * 2, H + rim * 2, BACK);
      this.quadAt(this.fill, n, -W / 2, 0, W * frac, H, col);
      if (tr.f > frac + 1e-3) this.quadAt(this.trail, nt++, -W / 2 + W * frac, 0, W * (tr.f - frac), H, TRAIL);
      n++;
      // level marks: small gold chevrons left of the bar (III: two, one above the other)
      for (let k = 0; k < level - 1; k++) {
        if (nc >= this.chevCap) {
          this.chevCap *= 2;
          this.chevBack = this.make(this.chevBack, this.chevGeo, this.mat, this.chevCap, 1001);
          this.chev = this.make(this.chev, this.chevGeo, this.matShaded, this.chevCap, 1002);
        }
        const c = CHEV * px;
        const cx = -W / 2 - rim - 3 * px - c * 0.5;
        const cy = (k - (level - 2) / 2) * c * 0.55;
        this.chevAt(this.chevBack, nc, cx, cy - 0.35 * px, c + 2.2 * px, GOLD_EDGE);
        this.chevAt(this.chev, nc, cx, cy, c, GOLD);
        nc++;
      }
    };
    for (const a of w.s.ants) {
      if (a.space !== space || a.state === AS.Dead) continue;
      // up on a creature or held in jaws: drawn where the sim does not put it
      if (a.state === AS.Climb && (a.ridePh ?? 0) >= 1) continue;
      if (a.heldBy) continue;
      const sel = selected?.kind === 'ant' && selected.id === a.id;
      const lvl = Math.max(1, Math.min(3, a.level || 1));
      if (!(a.hp < a.maxHp - 1e-6) && !sel) continue;
      const cd = casteOf(a.caste);
      const L = cd.length * (1 + 0.12 * (a.sizeVar ?? 0));
      const x = a.px + (a.x - a.px) * alpha;
      const y = a.py + (a.y - a.py) * alpha;
      put(a.id, x, y, L * (antHeights(a.caste).h + 0.12), L, Math.max(0, Math.min(1, a.hp / a.maxHp)), colourOf(a.colony, false), lvl);
    }
    for (const cr of w.s.creatures) {
      if (cr.space !== space || cr.dead) continue;
      // (titans — the bosses — have their bar across the top of the screen already: 22:04)
      if (creatureKind(cr.kind)?.boss) continue;
      const sel = selected?.kind === 'creature' && selected.id === cr.id;
      if (!(cr.hp < cr.maxHp - 1e-6) && !sel) continue;
      const L = cr.scale || creatureKind(cr.kind)?.length || 10;
      const x = cr.px + (cr.x - cr.px) * alpha;
      const y = cr.py + (cr.y - cr.py) * alpha;
      const lvl = Math.max(1, Math.min(3, Number(cr.data.level) || 1));
      put(-cr.id, x, y, L * (creatureHeights(cr.kind).h + 0.05), L * 0.6, Math.max(0, Math.min(1, cr.hp / cr.maxHp)), colourOf(cr.faction, cr.faction < 0), lvl);
    }
    for (const [mesh, k] of [
      [this.back, n],
      [this.trail, nt],
      [this.fill, n],
      [this.chev, nc],
      [this.chevBack, nc],
    ] as const) {
      mesh.count = k;
      if (k > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    if (this.frame % 300 === 0) for (const [k, t] of this.trails) if (this.frame - t.seen > 120) this.trails.delete(k);
  }

  /** A chevron `c` wide centred at (cx, cy) from the bar's middle (in the camera's right and up). */
  private chevAt(mesh: THREE.InstancedMesh, k: number, cx: number, cy: number, c: number, col: THREE.Color): void {
    this.m.makeBasis(this.right, this.up, this.s.crossVectors(this.right, this.up));
    this.m.scale(this.s.set(c, c, 1));
    this.m.setPosition(this.p.x + this.right.x * cx + this.up.x * cy, this.p.y + this.right.y * cx + this.up.y * cy, this.p.z + this.right.z * cx + this.up.z * cy);
    mesh.setMatrixAt(k, this.m);
    mesh.setColorAt(k, col);
  }
}

/** The bar's quad (x 0..1, y −½..½) with vertex colours: full along the top, 0.7 along the bottom. */
function shadedQuad(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
  const pos = g.getAttribute('position');
  const c: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getY(i) > 0 ? 1 : 0.7;
    c.push(k, k, k);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}

/** A rank chevron (^), 1 wide and about 0.8 high, centred: two arms meeting at the top; vertex colours lighter above. */
function chevronGeometry(): THREE.BufferGeometry {
  const pts = [
    // left arm, right arm (outer top edge, inner bottom edge)
    [-0.5, -0.12, 0, 0.38, 0, 0.08, -0.5, -0.42],
    [0, 0.38, 0.5, -0.12, 0.5, -0.42, 0, 0.08],
  ];
  const v: number[] = [];
  for (const q of pts) {
    const [ax, ay, bx, by, cx, cy, dx, dy] = q;
    v.push(ax, ay, 0, bx, by, 0, cx, cy, 0, ax, ay, 0, cx, cy, 0, dx, dy, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  const c: number[] = [];
  for (let i = 1; i < v.length; i += 3) {
    const k = 0.78 + 0.22 * Math.max(0, Math.min(1, (v[i] + 0.42) / 0.8));
    c.push(k, k, k);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}
