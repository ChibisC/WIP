/**
 * The frame profiler (performance pass, claude/performance/01-spec-performance-no-visual-loss.md §1). Client only:
 * nothing here touches the simulation.
 *
 * Every frame it keeps the frame time (from one animation frame to the next), the main thread's own time, the time
 * of named parts (`add`), what the GPU driver was asked to do (shader compiles and links, texture and buffer uploads:
 * counted and timed by wrapping the WebGL context's methods), the renderer's counts (draw calls, triangles, programs,
 * textures, geometries), the JS heap where the browser tells it, and GPU time where `EXT_disjoint_timer_query_webgl2`
 * exists. Frames over 33 ms go into the hitch log with what happened in them. The F3 overlay and the benchmark
 * (`?bench=1`) read it.
 */
import type * as THREE from 'three';

/** A frame over the hitch limit and what happened in it. */
export interface Hitch {
  /** frame number since the profiler started */
  frame: number;
  /** seconds since the profiler started */
  t: number;
  /** frame time (ms, animation frame to animation frame) */
  ms: number;
  /** the main thread's own time in that frame (ms) */
  cpu: number;
  /** what happened: "shader compile ×3 (84 ms)", "texture upload ×2 (4.0 MB, 6 ms)", notes… */
  causes: string[];
}

/** Rolling statistics of one quantity. */
class Stat {
  private buf: Float32Array;
  private n = 0;
  private i = 0;
  ema = 0;
  constructor(size = 600) {
    this.buf = new Float32Array(size);
  }
  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
    this.ema = this.n === 1 ? v : this.ema * 0.95 + v * 0.05;
  }
  get count(): number {
    return this.n;
  }
  /** average, p95 and worst over the window */
  summary(): { avg: number; p95: number; worst: number } {
    if (!this.n) return { avg: 0, p95: 0, worst: 0 };
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    let s = 0;
    for (const v of a) s += v;
    return { avg: s / this.n, p95: a[Math.min(this.n - 1, Math.floor(this.n * 0.95))], worst: a[this.n - 1] };
  }
  reset(): void {
    this.n = 0;
    this.i = 0;
    this.ema = 0;
  }
}

/** GL work in one frame, by kind. */
interface GlWork {
  compiles: number;
  links: number;
  compileMs: number;
  texUploads: number;
  texBytes: number;
  texMs: number;
  bufBytes: number;
  bufMs: number;
}

/** Bytes per pixel of a sized internal format (WebGL 2), 4 when not known. */
function bppOf(gl: WebGL2RenderingContext, f: number): number {
  switch (f) {
    case gl.R8:
      return 1;
    case gl.RG8:
    case gl.R16F:
    case gl.DEPTH_COMPONENT16:
      return 2;
    case gl.RGBA16F:
    case gl.RG32F:
      return 8;
    case gl.RGBA32F:
      return 16;
    case gl.R32F:
    case gl.RG16F:
      return 4;
    default:
      return 4;
  }
}

const blankGl = (): GlWork => ({ compiles: 0, links: 0, compileMs: 0, texUploads: 0, texBytes: 0, texMs: 0, bufBytes: 0, bufMs: 0 });

export const HITCH_MS = 33;
const PARTS = ['sim', 'msg', 'events', 'units', 'creatures', 'nest', 'fx', 'ui', 'render', 'prewarm'] as const;
export type Part = (typeof PARTS)[number];

export class Profiler {
  /** frames since start */
  frame = 0;
  private t0 = performance.now();
  private frameStart = 0;
  /** the real clock at the frame's start (the frame clock can be virtual: the screenshot harness steps it) */
  private cpuStart = 0;
  private lastFrameAt = 0;
  readonly frameMs = new Stat();
  readonly cpuMs = new Stat();
  readonly gpuMs = new Stat(240);
  readonly parts: Record<Part, Stat> = Object.fromEntries(PARTS.map((p) => [p, new Stat(240)])) as Record<Part, Stat>;
  private cur: Record<Part, number> = Object.fromEntries(PARTS.map((p) => [p, 0])) as Record<Part, number>;
  private notes: string[] = [];
  private gl: GlWork = blankGl();
  /** GL work since the start (the hitch log's "shader compiles during play" check) */
  readonly glTotal: GlWork = blankGl();
  /** the last frame's GL work */
  lastGl: GlWork = blankGl();
  readonly hitches: Hitch[] = [];
  /** worker → main: bytes of the last frame message, and a running average */
  msgBytes = 0;
  msgBytesAvg = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private heapLast = 0;
  /** loading is over: from here on a shader compile or a texture upload is worth a line in the log */
  playing = false;
  // GPU timer queries
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private queries: WebGLQuery[] = [];
  private queryOpen: WebGLQuery | null = null;
  gpuSupported = false;
  /** live GPU memory, estimated (bytes): textures, renderbuffers, buffers */
  mem = { tex: 0, rb: 0, buf: 0 };

  /** The GPU memory estimate in MB. */
  gpuMB(): number {
    return (this.mem.tex + this.mem.rb + this.mem.buf) / 1048576;
  }

  /** Watch a renderer's context: GL calls are counted and timed, and GPU time is measured where supported. */
  attach(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    this.renderer = renderer;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const g = gl as unknown as Record<string, unknown>;
    if (g.__udProf) return;
    g.__udProf = true;
    const wrap = (name: string, fn: (ms: number, args: unknown[]) => void) => {
      const orig = g[name] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof orig !== 'function') return;
      g[name] = function (this: unknown, ...args: unknown[]) {
        const t = performance.now();
        const r = orig.apply(gl, args);
        fn(performance.now() - t, args);
        return r;
      };
    };
    const p = this;
    wrap('compileShader', (ms) => {
      p.gl.compiles++;
      p.gl.compileMs += ms;
    });
    wrap('linkProgram', (ms) => {
      p.gl.links++;
      p.gl.compileMs += ms;
    });
    // the first status query after a link waits for the driver to finish compiling
    wrap('getProgramParameter', (ms) => (p.gl.compileMs += ms));
    const tex = (bytesOf: (a: unknown[]) => number) => (ms: number, a: unknown[]) => {
      p.gl.texUploads++;
      p.gl.texBytes += bytesOf(a);
      p.gl.texMs += ms;
    };
    const viewBytes = (a: unknown[]) => {
      for (const x of a) if (ArrayBuffer.isView(x)) return x.byteLength;
      // (images, canvases and video: width × height × 4)
      for (const x of a) {
        const o = x as { width?: number; height?: number };
        if (o && typeof o === 'object' && typeof o.width === 'number' && typeof o.height === 'number') return o.width * o.height * 4;
      }
      return 0;
    };
    for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexSubImage2D', 'texStorage2D', 'texStorage3D']) wrap(n, tex(viewBytes));
    const buf = (ms: number, a: unknown[]) => {
      const x = a[1];
      p.gl.bufBytes += ArrayBuffer.isView(x) ? x.byteLength : typeof x === 'number' ? x : 0;
      p.gl.bufMs += ms;
    };
    wrap('bufferData', buf);
    wrap('bufferSubData', buf);
    // GPU memory, estimated (performance pass, the mobile budget): the size given for each live texture, renderbuffer
    // and buffer, tracked through their binds, uploads and deletes
    const mem = this.mem;
    let unit = 0;
    const boundTex = new Map<number, unknown>();
    const boundBuf = new Map<number, unknown>();
    let boundRb: unknown = null;
    const setSize = (kind: 'tex' | 'rb' | 'buf', map: Map<unknown, number>, o: unknown, bytes: number) => {
      if (!o) return;
      mem[kind] += bytes - (map.get(o) ?? 0);
      map.set(o, bytes);
    };
    const drop = (kind: 'tex' | 'rb' | 'buf', map: Map<unknown, number>) => (_ms: number, a: unknown[]) => {
      const n = map.get(a[0]);
      if (n !== undefined) {
        mem[kind] -= n;
        map.delete(a[0]);
      }
    };
    const texSizes = new Map<unknown, number>();
    const rbSizes = new Map<unknown, number>();
    const bufSizes = new Map<unknown, number>();
    wrap('activeTexture', (_ms, a) => (unit = (a[0] as number) - gl.TEXTURE0));
    wrap('bindTexture', (_ms, a) => boundTex.set(unit * 65536 + (a[0] as number), a[1]));
    wrap('bindBuffer', (_ms, a) => boundBuf.set(a[0] as number, a[1]));
    wrap('bindRenderbuffer', (_ms, a) => (boundRb = a[1]));
    wrap('deleteTexture', drop('tex', texSizes));
    wrap('deleteBuffer', drop('buf', bufSizes));
    wrap('deleteRenderbuffer', drop('rb', rbSizes));
    const texTarget = (t: number) => (t >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && t <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z ? gl.TEXTURE_CUBE_MAP : t);
    const faces = (t: number) => (t === gl.TEXTURE_CUBE_MAP ? 6 : 1);
    wrap('texStorage2D', (_ms, a) => {
      const t = a[0] as number;
      const levels = a[1] as number;
      setSize('tex', texSizes, boundTex.get(unit * 65536 + t), (a[3] as number) * (a[4] as number) * bppOf(gl, a[2] as number) * faces(t) * (levels > 1 ? 4 / 3 : 1));
    });
    wrap('texStorage3D', (_ms, a) => {
      setSize('tex', texSizes, boundTex.get(unit * 65536 + (a[0] as number)), (a[3] as number) * (a[4] as number) * (a[5] as number) * bppOf(gl, a[2] as number) * ((a[1] as number) > 1 ? 4 / 3 : 1));
    });
    wrap('texImage2D', (_ms, a) => {
      if (a[1] !== 0) return; // (mip levels: counted as a third on top of level 0)
      const t = a[0] as number;
      const key = unit * 65536 + texTarget(t);
      let w = 0;
      let h = 0;
      let type = 0;
      if (a.length >= 8) {
        w = a[3] as number;
        h = a[4] as number;
        type = a[7] as number;
      } else {
        const o = a[5] as { width?: number; height?: number } | null;
        w = o?.width ?? 0;
        h = o?.height ?? 0;
        type = a[4] as number;
      }
      const bpp = type === gl.FLOAT ? 16 : type === gl.HALF_FLOAT ? 8 : 4;
      const o = boundTex.get(key);
      const f = texTarget(t) === gl.TEXTURE_CUBE_MAP ? 6 : 1;
      // (a cube map's faces arrive one by one: each sets a sixth)
      setSize('tex', texSizes, o, f === 6 ? Math.max(texSizes.get(o) ?? 0, w * h * bpp * 6) : w * h * bpp);
    });
    wrap('generateMipmap', (_ms, a) => {
      const o = boundTex.get(unit * 65536 + (a[0] as number));
      const n = texSizes.get(o);
      if (o && n !== undefined && !mipped.has(o)) {
        mipped.add(o);
        setSize('tex', texSizes, o, (n * 4) / 3);
      }
    });
    const mipped = new WeakSet<object>();
    wrap('renderbufferStorage', (_ms, a) => setSize('rb', rbSizes, boundRb, (a[2] as number) * (a[3] as number) * bppOf(gl, a[1] as number)));
    wrap('renderbufferStorageMultisample', (_ms, a) => setSize('rb', rbSizes, boundRb, (a[1] as number) * (a[3] as number) * (a[4] as number) * bppOf(gl, a[2] as number)));
    wrap('bufferData', (_ms, a) => {
      const x = a[1];
      setSize('buf', bufSizes, boundBuf.get(a[0] as number), ArrayBuffer.isView(x) ? x.byteLength : typeof x === 'number' ? x : 0);
    });
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (ext) {
      this.ext = ext;
      this.gpuSupported = true;
    }
  }

  /** Start of a frame (the game loop's animation frame). */
  begin(now = performance.now()): void {
    this.frameStart = now;
    this.cpuStart = performance.now();
    for (const p of PARTS) this.cur[p] = 0;
    // worker frames arrive between animation frames: they count toward the next one
    this.cur.msg = this.pendingMsg;
    this.pendingMsg = 0;
    this.notes.length = 0;
    this.gl = blankGl();
  }

  private pendingMsg = 0;

  /** A frame message from the simulation worker was applied (between animation frames). */
  addMsg(ms: number, bytes: number): void {
    this.pendingMsg += ms;
    this.msgBytes = bytes;
    this.msgBytesAvg = this.msgBytesAvg ? this.msgBytesAvg * 0.95 + bytes * 0.05 : bytes;
  }

  /** Time spent in a part this frame. */
  add(part: Part, ms: number): void {
    this.cur[part] += ms;
  }

  /** Something worth knowing about this frame if it turns out slow ("rebuilt nest 3 mesh", "switch: swap"). */
  note(text: string): void {
    if (this.notes.length < 12) this.notes.push(text);
  }

  /** GPU time around the scene render (where the timer query exists). */
  gpuBegin(): void {
    if (!this.ext || this.queryOpen) return;
    const gl = this.renderer!.getContext() as WebGL2RenderingContext;
    const q = gl.createQuery();
    if (!q) return;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.queryOpen = q;
  }

  gpuEnd(): void {
    if (!this.ext || !this.queryOpen) return;
    const gl = this.renderer!.getContext() as WebGL2RenderingContext;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.queryOpen);
    this.queryOpen = null;
    // read the finished ones (a frame or two later)
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!disjoint) this.gpuMs.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
      this.queries.shift();
    }
    if (this.queries.length > 8) {
      for (const q of this.queries) gl.deleteQuery(q);
      this.queries.length = 0;
    }
  }

  /** End of a frame: record it, and log it when it was a hitch. */
  end(): void {
    this.frame++;
    const cpu = performance.now() - this.cpuStart;
    const dt = this.lastFrameAt ? this.frameStart - this.lastFrameAt : 16.7;
    this.lastFrameAt = this.frameStart;
    this.frameMs.push(dt);
    this.cpuMs.push(cpu);
    for (const p of PARTS) this.parts[p].push(this.cur[p]);
    const g = this.gl;
    this.lastGl = g;
    const T = this.glTotal;
    T.compiles += g.compiles;
    T.links += g.links;
    T.compileMs += g.compileMs;
    T.texUploads += g.texUploads;
    T.texBytes += g.texBytes;
    T.texMs += g.texMs;
    T.bufBytes += g.bufBytes;
    T.bufMs += g.bufMs;
    // the JS heap (Chrome): a big drop since the last frame is the garbage collector
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    let gc = 0;
    if (mem) {
      const h = mem.usedJSHeapSize;
      if (this.heapLast && h < this.heapLast - 2 * 1048576) gc = (this.heapLast - h) / 1048576;
      this.heapLast = h;
    }
    // the frame that ends now was measured from the last frame's start: a slow frame shows in this frame's dt when
    // the work happened in the previous frame, so both this frame's work and the time are logged
    if (dt > HITCH_MS || cpu > HITCH_MS) {
      const causes: string[] = [];
      if (g.links || g.compiles) causes.push(`shader compile ×${Math.max(g.links, Math.ceil(g.compiles / 2))} (${g.compileMs.toFixed(0)} ms)`);
      if (g.texUploads) causes.push(`texture upload ×${g.texUploads} (${(g.texBytes / 1048576).toFixed(1)} MB, ${g.texMs.toFixed(0)} ms)`);
      if (g.bufBytes > 262144 || g.bufMs > 4) causes.push(`buffer upload ${(g.bufBytes / 1048576).toFixed(1)} MB (${g.bufMs.toFixed(0)} ms)`);
      if (gc) causes.push(`GC (heap −${gc.toFixed(0)} MB)`);
      if (this.msgBytes > 1048576) causes.push(`big sim message ${(this.msgBytes / 1048576).toFixed(1)} MB`);
      const parts = PARTS.map((p) => [p, this.cur[p]] as const)
        .filter(([, ms]) => ms > 4)
        .sort((a, b) => b[1] - a[1])
        .map(([p, ms]) => `${p} ${ms.toFixed(0)} ms`);
      if (parts.length) causes.push(parts.join(', '));
      causes.push(...this.notes);
      if (!causes.length) causes.push(cpu > 12 ? 'main thread busy (unattributed)' : 'outside this thread (browser, GPU or a background tab)');
      this.hitches.push({ frame: this.frame, t: (this.frameStart - this.t0) / 1000, ms: dt, cpu, causes });
      if (this.hitches.length > 200) this.hitches.shift();
    }
  }

  /** The renderer's counts now. */
  counts(): { calls: number; triangles: number; programs: number; textures: number; geometries: number; heapMB: number } {
    const r = this.renderer;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      calls: r?.info.render.calls ?? 0,
      triangles: r?.info.render.triangles ?? 0,
      programs: r?.info.programs?.length ?? 0,
      textures: r?.info.memory.textures ?? 0,
      geometries: r?.info.memory.geometries ?? 0,
      heapMB: mem ? mem.usedJSHeapSize / 1048576 : 0,
    };
  }

  /** Clear the rolling statistics and the log (the benchmark between its scenes). */
  reset(): void {
    this.frameMs.reset();
    this.cpuMs.reset();
    this.gpuMs.reset();
    for (const p of PARTS) this.parts[p].reset();
    this.hitches.length = 0;
    this.lastFrameAt = 0;
    Object.assign(this.glTotal, blankGl());
  }

  partNames(): readonly Part[] {
    return PARTS;
  }

  glSince(): GlWork {
    return this.glTotal;
  }
}

/** The one profiler of this page. */
export const prof = new Profiler();
