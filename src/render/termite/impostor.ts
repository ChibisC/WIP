/**
 * Far-zoom impostors: each caste is baked once into a small sprite atlas (yaw frames x elevation rows
 * plus a top-down frame) and drawn as one instanced quad per termite.
 *
 *   const atlas = bakeTermiteImpostor(renderer, buildTermiteGeometry('nasute', 2));
 *   const far = new TermiteImpostors(atlas, 4096);
 *   far.set(i, worldPos, yaw, scale); far.count = n; far.commit();
 *
 * Top-down cameras (elevation > 70 deg) use the top frame laid flat and rotated by the unit's yaw,
 * so the teardrop head + pointed nasus and the striped abdomen stay readable from far away.
 */
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { AnimState, TermiteRig } from './rig';
import { TermiteInstances, termiteTime } from './material';

export interface ImpostorAtlas {
  texture: Texture;
  cols: number; // yaw frames
  rows: number; // elevation rows (side frames) ; the last row holds the top-down frame in column 0
  elevations: number[];
  halfSize: number; // half extent of each frame in model mm
  center: Vector3; // model-space centre the frames are framed around
}

export function bakeTermiteImpostor(renderer: WebGLRenderer, geometry: BufferGeometry, opts: { cols?: number; elevations?: number[]; cell?: number } = {}): ImpostorAtlas {
  const cols = opts.cols ?? 8;
  const elevations = opts.elevations ?? [0.35, 0.8];
  const cell = opts.cell ?? 128;
  const rows = elevations.length + 1;
  const rig = geometry.userData.rig as TermiteRig;
  const b = rig.bounds;
  const center = new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  const halfSize = 0.55 * Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);

  const scene = new Scene();
  scene.add(new HemisphereLight(0xfff6e8, 0x6b5a48, 0.9));
  scene.add(new AmbientLight(0xffffff, 0.25));
  const sun = new DirectionalLight(0xfff1dd, 2.0);
  sun.position.set(2, 5, 3);
  scene.add(sun);
  const herd = new TermiteInstances(geometry, 1, { castShadow: false });
  herd.count = 1;
  herd.setMatrix(0, new Matrix4());
  herd.setState(0, rig.isQueen ? AnimState.QUEEN : AnimState.IDLE, { blend: 0 });
  herd.commit();
  scene.add(herd.group);

  const rt = new WebGLRenderTarget(cols * cell, rows * cell, { format: RGBAFormat, type: UnsignedByteType, magFilter: LinearFilter, minFilter: LinearFilter });
  rt.texture.colorSpace = SRGBColorSpace;
  const cam = new OrthographicCamera(-halfSize, halfSize, halfSize, -halfSize, 0.01, halfSize * 20);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevTime = termiteTime.value;
  termiteTime.value = 0;
  rt.scissorTest = true; // render targets use their own viewport / scissor state
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.autoClear = false; // keep earlier cells
  const draw = (col: number, row: number, dir: Vector3, up: Vector3) => {
    cam.position.copy(center).addScaledVector(dir, halfSize * 8);
    cam.up.copy(up);
    cam.lookAt(center);
    rt.viewport.set(col * cell, row * cell, cell, cell);
    rt.scissor.set(col * cell, row * cell, cell, cell);
    renderer.setRenderTarget(rt); // re-applies the target's viewport + scissor
    renderer.render(scene, cam);
  };
  elevations.forEach((e, row) => {
    for (let k = 0; k < cols; k++) {
      const phi = (2 * Math.PI * k) / cols; // CCW about +Y from +X (model forward)
      draw(k, row, new Vector3(Math.cos(phi) * Math.cos(e), Math.sin(e), -Math.sin(phi) * Math.cos(e)), new Vector3(0, 1, 0));
    }
  });
  // top-down frame: forward (+X) points to the top of the cell
  draw(0, rows - 1, new Vector3(0, 1, 0), new Vector3(1, 0, 0));
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAutoClear;
  termiteTime.value = prevTime;
  herd.dispose();
  return { texture: rt.texture, cols, rows, elevations, halfSize, center };
}

export class TermiteImpostors {
  readonly mesh: Mesh;
  private iPos: InstancedBufferAttribute;
  private iYawScale: InstancedBufferAttribute;
  private geo: InstancedBufferGeometry;

  constructor(readonly atlas: ImpostorAtlas, readonly capacity: number) {
    this.geo = new InstancedBufferGeometry();
    this.geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.iYawScale = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iYawScale', this.iYawScale);
    this.geo.instanceCount = 0;
    const el = atlas.elevations;
    const mat = new ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uGrid: { value: [atlas.cols, atlas.rows] },
        uHalf: { value: atlas.halfSize },
        uCenter: { value: atlas.center },
      },
      transparent: false,
      alphaTest: 0.5,
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec2 iYawScale;
        uniform vec2 uGrid; uniform float uHalf; uniform vec3 uCenter;
        varying vec2 vUv;
        const float ELEV[${el.length}] = float[](${el.map((e) => e.toFixed(4)).join(',')});
        void main() {
          float yaw = iYawScale.x; float s = iYawScale.y;
          vec3 c = iPos + vec3(0.0, uCenter.y * s, 0.0);
          vec3 camW = cameraPosition;
          vec3 v = normalize(camW - c);
          // view direction in the unit's model frame
          float cy = cos(-yaw), sy = sin(-yaw);
          vec3 vl = vec3(cy * v.x + sy * v.z, v.y, -sy * v.x + cy * v.z);
          float elev = asin(clamp(vl.y, -1.0, 1.0));
          vec3 wp;
          vec2 cell;
          if (elev > 1.22) {
            // top-down: quad flat on the ground, rotated with the unit (cell up = model +X)
            vec3 fx = vec3(cos(yaw), 0.0, -sin(yaw));
            vec3 fz = vec3(sin(yaw), 0.0, cos(yaw));
            wp = iPos + vec3(0.0, 0.02 * s, 0.0) + (fz * position.x + fx * position.y) * uHalf * s;
            cell = vec2(0.0, uGrid.y - 1.0);
          } else {
            float phi = atan(-vl.z, vl.x);
            float k = mod(floor(phi / (6.2831853 / uGrid.x) + 0.5), uGrid.x);
            float row = 0.0; float best = 10.0;
            for (int i = 0; i < ${el.length}; i++) { float d = abs(ELEV[i] - elev); if (d < best) { best = d; row = float(i); } }
            vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), v));
            vec3 up = cross(v, right);
            wp = c + (right * position.x + up * position.y) * uHalf * s;
            cell = vec2(k, row);
          }
          vUv = (cell + (position.xy * 0.5 + 0.5)) / uGrid;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uAtlas, vUv);
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  get count() {
    return this.geo.instanceCount;
  }
  set count(n: number) {
    this.geo.instanceCount = n;
  }

  /** world position (ground point under the unit), yaw (rad about +Y), scale = world units per mm */
  set(i: number, pos: Vector3, yaw: number, scale: number) {
    this.iPos.setXYZ(i, pos.x, pos.y, pos.z);
    this.iYawScale.setXY(i, yaw, scale);
  }

  commit() {
    this.iPos.needsUpdate = true;
    this.iYawScale.needsUpdate = true;
  }
}
