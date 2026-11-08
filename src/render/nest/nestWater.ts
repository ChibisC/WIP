import type { AreaTerrain } from './areaTerrain';
import * as THREE from 'three';
import { NestGrid, SOIL_AIR } from '../../world/nestGrid';
import { NestTerrain } from './nestTerrain';
import { addPatch, globalUniforms, WORLD_POS_PATCH } from '../shaderPatch';
import { textures } from '../textures';
import type { NestFloodState } from '../../sim/types';
import type { FloodCache } from '../../sim/nestFlood';
import { NEST_FLOOD } from '../../sim/balance';

/**
 * River water filling a flooding nest (sim/nestFlood.ts), drawn in the nest view: murky, silty brown water like the
 * surface floods' (render/water.ts — the same absorbed-with-depth murk, drifting ripples, scum at the edges), standing in
 * the flooded hexes. Each hex's water rises from the floor to its full depth (NEST_FLOOD.depthOfWall of the wall
 * height) over NEST_FLOOD.riseS after it goes under, so the surface climbs the wall slopes and the ants on the floor
 * sink into the murk; while the nest fills, a stream pours in at the top of the entrance ramp and runs down the tunnels
 * to the pool (every branch that leads to it), streaked and foaming as it goes.
 *
 * One vertex per raster cell (the soil grid), heights rewritten each frame only while something moves (the levels
 * easing up, the stream changing course); the plane runs on under the soil walls so the walls cut the shore.
 */
export class NestWater {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private material: THREE.MeshPhysicalMaterial;
  private readonly W: number;
  private readonly H: number;
  private floor: Float32Array;
  private floorVer = -1;
  /** per hex: the water depth shown now (mm), and under water this frame */
  private shown: Float32Array;
  private wet: Uint8Array;
  /** per cell scratch: the water level (NaN: dry) and a blur buffer */
  private lv: Float32Array;
  private lv2: Float32Array;
  /** per cell: stream strength 0..1 and its direction (x, y) */
  private flow: Float32Array;
  private fdir: Float32Array;
  private pathKey = '';
  private settled = false;
  /** the cells round the nest's open hexes (the only ones that can hold water), inclusive */
  private bx0 = 0;
  private by0 = 0;
  private bx1 = -1;
  private by1 = -1;

  constructor(
    private grid: NestGrid,
    private terrain: AreaTerrain,
  ) {
    const g = grid;
    this.W = g.w;
    this.H = g.h;
    const n = this.W * this.H;
    this.floor = new Float32Array(n);
    this.shown = new Float32Array(g.cols * g.rows);
    this.wet = new Uint8Array(g.cols * g.rows);
    this.lv = new Float32Array(n);
    this.lv2 = new Float32Array(n);
    this.flow = new Float32Array(n);
    this.fdir = new Float32Array(n * 2);
    const pos = new Float32Array(n * 3);
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const k = y * this.W + x;
        pos[k * 3] = (x + 0.5) * g.cell;
        pos[k * 3 + 2] = (y + 0.5) * g.cell;
      }
    const idx = new Uint32Array((this.W - 1) * (this.H - 1) * 6);
    let m = 0;
    for (let y = 0; y < this.H - 1; y++)
      for (let x = 0; x < this.W - 1; x++) {
        const a = y * this.W + x;
        idx[m++] = a;
        idx[m++] = a + this.W;
        idx[m++] = a + 1;
        idx[m++] = a + 1;
        idx[m++] = a + this.W;
        idx[m++] = a + this.W + 1;
      }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    this.geo.setAttribute('wdepth', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.geo.setAttribute('wflow', new THREE.BufferAttribute(this.flow, 1));
    this.geo.setAttribute('wdir', new THREE.BufferAttribute(this.fdir, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const tex = textures();
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x3f3826,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 1,
      envMapIntensity: 1.4,
      ior: 1.33,
      specularIntensity: 1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
      normalMap: tex.sand.normal,
      normalScale: new THREE.Vector2(0.08, 0.08),
    });
    addPatch(this.material, WORLD_POS_PATCH);
    addPatch(this.material, {
      key: 'nestWater',
      uniforms: { tNoise: { value: tex.noise }, uTime: globalUniforms.uTime },
      vertexHeader: 'attribute float wdepth; attribute float wflow; attribute vec2 wdir; varying float vDepth; varying float vFlow; varying vec2 vDir;',
      vertex: [['#include <begin_vertex>', '#include <begin_vertex>\n vDepth = wdepth; vFlow = wflow; vDir = wdir;']],
      fragmentHeader: 'varying float vDepth; varying float vFlow; varying vec2 vDir; uniform sampler2D tNoise; uniform float uTime;',
      fragment: [
        [
          '#include <color_fragment>',
          `#include <color_fragment>
           float fl = clamp(vFlow, 0.0, 1.0);
           // (the stream's frame: across, and along the way it runs)
           vec2 fd = vDir / max(length(vDir), 1e-4);
           vec2 fs = vec2(dot(vWP.xz, vec2(-fd.y, fd.x)), dot(vWP.xz, fd));
           vec2 wuv = vWP.xz / 22.0;
           // silty river water: light absorbed with depth (blue first), so the floor and the ants on it show through a
           // brown murk that darkens as the water deepens; the surface is there from the first film (a crisp waterline),
           // and never quite opaque (nothing hides a creature)
           float dep = max(vDepth, 0.0);
           vec3 Tr = exp(-vec3(0.1, 0.13, 0.19) * dep);
           float op = 1.0 - dot(Tr, vec3(0.3333));
           diffuseColor.a = clamp(0.38 + op * 0.8, 0.0, 0.84) * smoothstep(0.0, 0.08, dep);
           diffuseColor.rgb *= mix(1.15, 0.72, smoothstep(0.5, 6.0, dep));
           // the waterline: a wet, frothy rim where it meets the floor and walls, broken and drifting
           float fn1 = texture2D(tNoise, vWP.xz / 14.0 + vec2(uTime * 0.004, uTime * 0.003)).r;
           float fn2 = texture2D(tNoise, vWP.xz / 7.0 - vec2(uTime * 0.006, -uTime * 0.005)).b;
           float rim = (1.0 - smoothstep(0.08, 0.7, dep)) * smoothstep(0.0, 0.05, dep) * (1.0 - fl);
           float foam = rim * smoothstep(0.45, 0.75, fn1 * 0.5 + fn2 * 0.6);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.55, 0.46), foam * 0.8);
           diffuseColor.a = max(diffuseColor.a, foam * 0.85);
           // floating grit and bits of plant
           float speck = step(0.984, texture2D(tNoise, vWP.xz / 30.0 + 0.5 + vec2(uTime * 0.002, 0.0)).a) * (1.0 - fl);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.11, 0.07), speck * 0.8);
           diffuseColor.a = max(diffuseColor.a, speck * 0.8 * smoothstep(0.0, 0.3, dep));
           // the stream: a thin running sheet of muddy water, a few threads of froth carried down it
           float s1 = texture2D(tNoise, vec2(fs.x / 2.2, fs.y / 16.0 - uTime * 0.8)).r;
           float s2 = texture2D(tNoise, vec2(fs.x / 1.3 + 0.31, fs.y / 9.0 - uTime * 1.3)).g;
           float streak = smoothstep(0.62, 0.86, s1 * 0.6 + s2 * 0.5) * fl;
           // (dark and glossy like wet earth; the froth pale)
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.12, 0.08), fl * 0.8);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.68, 0.58), streak * 0.7);
           diffuseColor.a = max(diffuseColor.a, fl * (0.78 + 0.2 * streak));
           // light caught on the ripples: a faint drifting net of glints (and quick ones down the stream)
           float c1 = texture2D(tNoise, wuv * 1.2 + vec2(uTime * 0.021, uTime * 0.013)).g;
           float c2 = texture2D(tNoise, wuv * 2.1 - vec2(uTime * 0.017, -uTime * 0.019)).r;
           float patchy = smoothstep(0.55, 0.8, texture2D(tNoise, wuv * 0.45 + vec2(-uTime * 0.006, uTime * 0.004)).b);
           float glint = pow(1.0 - abs(c1 - c2), 40.0) * patchy * (1.0 - fl) * smoothstep(0.3, 1.5, dep);
           float c3 = texture2D(tNoise, vec2(fs.x / 3.0, fs.y / 11.0 - uTime * 1.1)).b;
           glint += pow(c3, 5.0) * fl * 2.2;`,
        ],
        [
          '#include <normal_fragment_maps>',
          `vec3 n1 = texture2D(tNoise, wuv + vec2(uTime*0.012, uTime*0.008)).rgb;
           vec3 n2 = texture2D(tNoise, wuv*1.9 - vec2(uTime*0.010, -uTime*0.014)).rgb;
           // the stream: ripples drawn out along the way it runs, moving down it
           vec3 n3 = texture2D(tNoise, vec2(fs.x / 7.0, fs.y / 24.0 - uTime * 0.5)).rgb;
           float rip = 0.14 + 0.24 * fl;
           vec3 mapN = normalize(vec3((mix(n1.r + n2.g, n3.r * 2.0, fl) - 1.0) * rip, (mix(n1.g + n2.r, n3.g * 2.0, fl) - 1.0) * rip, 1.0));
           normal = normalize( tbn * mapN );`,
        ],
        ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.6, max(foam, max(speck, streak * 0.6)));'],
        ['#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(0.85, 0.72, 0.5) * glint * 0.07;'],
      ],
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.name = 'nestWater';
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * The floor under each vertex round the nest's open hexes (the terrain's height, walls and ramps included), when the
   * dug raster has changed; the rest of the plane lies under the soil for good.
   */
  private floorHeights(fc: FloodCache): void {
    const g = this.grid;
    if (this.floorVer === g.version) return;
    this.floorVer = g.version;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const p = { x: 0, y: 0 };
    for (const q of fc.order) {
      g.hexCenter(q, p);
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const pad = g.R * 1.6;
    this.bx0 = Math.max(0, Math.floor((x0 - pad) / g.cell));
    this.by0 = Math.max(0, Math.floor((y0 - pad) / g.cell));
    this.bx1 = Math.min(this.W - 1, Math.ceil((x1 + pad) / g.cell));
    this.by1 = Math.min(this.H - 1, Math.ceil((y1 + pad) / g.cell));
    const pos = this.geo.attributes.position.array as Float32Array;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const k = y * this.W + x;
        if (x < this.bx0 || x > this.bx1 || y < this.by0 || y > this.by1) {
          this.floor[k] = 0;
          pos[k * 3 + 1] = -1;
        } else this.floor[k] = this.terrain.heightAt((x + 0.5) * g.cell, (y + 0.5) * g.cell);
      }
    this.settled = false;
  }

  /**
   * Follow the colony's flood (`st` its `nestFlood`, `fc` the plan for its grid; none: hidden). `time` the game time,
   * interpolated between ticks: each hex's water rises from when it went under.
   */
  update(st: NestFloodState | undefined, fc: FloodCache | null, time: number): void {
    if (!st || st.phase === 0 || !st.q.length || !fc) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.floorHeights(fc);
    const full = NEST_FLOOD.depthOfWall * this.terrain.wallH;
    const wet = this.wet;
    wet.fill(0);
    let moving = false;
    for (let i = 0; i < st.q.length; i++) {
      const q = st.q[i];
      wet[q] = 1;
      const u = Math.min(1, Math.max(0, (time - st.at[i]) / NEST_FLOOD.riseS));
      // (eased out: quick at first, settling at the top)
      const want = full * (1 - (1 - u) * (1 - u)) + 0.05;
      if (want !== this.shown[q]) moving = true;
      this.shown[q] = want;
    }
    const pathKey = `${st.phase}|${st.q.length}|${fc.ver}`;
    if (pathKey !== this.pathKey) {
      this.pathKey = pathKey;
      this.stream(st, fc);
      moving = true;
    }
    if (!moving && this.settled) return;
    this.settled = !moving;
    this.heights();
  }

  /** The stream: from the top of the entrance down the tunnels to every place the pool begins (while it fills). */
  private stream(st: NestFloodState, fc: FloodCache): void {
    const g = this.grid;
    this.flow.fill(0);
    this.fdir.fill(0);
    if (st.phase === 1) {
      const wet = this.wet;
      const seen = new Uint8Array(g.cols * g.rows);
      const flower = new Set(g.flowers[0] ?? []);
      const spine = g.tunnels[0] ?? [];
      const a = { x: 0, y: 0 };
      const b = { x: 0, y: 0 };
      const inner = { x: 0, y: 0 };
      if (spine.length) g.hexCenter(spine[spine.length - 1], inner);
      // every hex under water whose way up is dry: the stream comes down to it from the entrance (through the ramp, a
      // tunnel at a time, each stretch once)
      for (const f of st.q) {
        let child = f;
        let p = fc.up[f];
        while (p >= 0 && !wet[p] && !seen[p]) {
          seen[p] = 1;
          if (!flower.has(child)) {
            // (out of the ramp: from the foot of its spine)
            if (flower.has(p) && spine.length) ((a.x = inner.x), (a.y = inner.y));
            else g.hexCenter(p, a);
            g.hexCenter(child, b);
            this.paint(a.x, a.y, b.x, b.y, g.R * 0.45, 1);
          }
          child = p;
          p = fc.up[p];
        }
      }
      // the pour: in over the top of the ramp and down its middle as a wide sheet, to the foot of the ramp
      if (spine.length > 1) {
        const top = g.hexCenter(spine[0]);
        const dx = top.x - inner.x;
        const dy = top.y - inner.y;
        const l = Math.hypot(dx, dy) || 1;
        this.paint(top.x + (dx / l) * g.R * 0.9, top.y + (dy / l) * g.R * 0.9, inner.x, inner.y, g.R * 1.05, 1, 0.25);
      }
    }
    const fl = this.geo.attributes.wflow as THREE.BufferAttribute;
    const fdir = this.geo.attributes.wdir as THREE.BufferAttribute;
    fl.needsUpdate = true;
    fdir.needsUpdate = true;
  }

  /** Lay a strip of running water from (ax, ay) down to (bx, by), `w` wide either side (meandering × `wob`), onto the dry floor cells. */
  private paint(ax: number, ay: number, bx: number, by: number, w: number, s: number, wob = 1): void {
    const g = this.grid;
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    const L = Math.sqrt(L2);
    const m = w * 2;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - m) / g.cell));
    const x1 = Math.min(this.W - 1, Math.ceil((Math.max(ax, bx) + m) / g.cell));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - m) / g.cell));
    const y1 = Math.min(this.H - 1, Math.ceil((Math.max(ay, by) + m) / g.cell));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = y * this.W + x;
        if (g.soil[k] !== SOIL_AIR) continue;
        const px = (x + 0.5) * g.cell;
        const py = (y + 0.5) * g.cell;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
        // (a stream wanders: it meanders a little from side to side, and its width breathes along the way; both fade
        // out at the ends so the stretches join)
        const s0 = (t * L) / g.R;
        const ww = w * (0.8 + 0.35 * Math.sin(s0 * 1.1 + ax * 0.3));
        const sway = wob * w * 0.55 * Math.sin(s0 * 0.9 + ay * 0.21) * Math.sin(Math.PI * t);
        // (the distance from the swaying centre line; past the ends, from the end point)
        const sd = ((px - ax) * -dy + (py - ay) * dx) / L;
        const dd = t <= 0 || t >= 1 ? Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) : Math.abs(sd - sway);
        if (dd >= ww) continue;
        const v = s * Math.min(1, (1 - dd / ww) * 2.2);
        if (v <= this.flow[k]) continue;
        this.flow[k] = v;
        this.fdir[k * 2] = dx / L;
        this.fdir[k * 2 + 1] = dy / L;
      }
  }

  /** Vertex heights: the pool's level in flooded hexes (smoothed across them, carried on under the walls), a thin film where the stream runs, under the floor elsewhere. */
  private heights(): void {
    const g = this.grid;
    const W = this.W;
    const lv = this.lv;
    const lv2 = this.lv2;
    const wet = this.wet;
    // (only the cells round the nest's open hexes: no water can stand anywhere else)
    const X0 = this.bx0;
    const X1 = this.bx1;
    const Y0 = this.by0;
    const Y1 = this.by1;
    // the level in each flooded cell (NaN: dry)
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++) {
        const k = y * W + x;
        const q = g.cellHex[k];
        lv[k] = q >= 0 && wet[q] ? this.shown[q] : NaN;
      }
    // smooth across hexes under water (dry cells take no part), twice
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? lv : lv2;
      const dst = pass === 0 ? lv2 : lv;
      for (let y = Y0; y <= Y1; y++)
        for (let x = X0; x <= X1; x++) {
          const k = y * W + x;
          if (src[k] !== src[k]) {
            dst[k] = NaN;
            continue;
          }
          let s = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < Y0 || yy > Y1) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < X0 || xx > X1) continue;
              const v = src[yy * W + xx];
              if (v !== v) continue;
              s += v;
              n++;
            }
          }
          dst[k] = s / n;
        }
    }
    const pos = this.geo.attributes.position.array as Float32Array;
    const dep = this.geo.attributes.wdepth.array as Float32Array;
    const film = 0.32;
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++) {
        const k = y * W + x;
        const fl = this.floor[k];
        let h = lv[k];
        if (h !== h && g.soil[k] !== SOIL_AIR) {
          // soil beside the water: the plane runs on under the wall (the wall cuts the shore)
          for (let r = 1; r <= 2 && h !== h; r++)
            for (let dy = -r; dy <= r; dy++)
              for (let dx = -r; dx <= r; dx++) {
                const xx = x + dx;
                const yy = y + dy;
                if (xx < X0 || yy < Y0 || xx > X1 || yy > Y1) continue;
                const v = lv[yy * W + xx];
                if (v === v && !(h >= v)) h = v;
              }
        }
        if (h === h) {
          pos[k * 3 + 1] = h;
          dep[k] = h - fl;
        } else if (this.flow[k] > 0) {
          // the running film follows the floor (and the ramp up to the opening)
          pos[k * 3 + 1] = fl + film * (0.4 + 0.6 * this.flow[k]);
          dep[k] = film;
        } else {
          pos[k * 3 + 1] = fl - 0.6;
          dep[k] = 0;
        }
      }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.wdepth.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
