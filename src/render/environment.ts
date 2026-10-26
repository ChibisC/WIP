import * as THREE from 'three';

/**
 * Sky dome + environment map generation and the per-space light rigs.
 */
function skyMaterial(top: THREE.Color, horizon: THREE.Color, ground: THREE.Color, sunDir: THREE.Vector3, sunCol: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: top },
      horizon: { value: horizon },
      ground: { value: ground },
      sunDir: { value: sunDir.clone().normalize() },
      sunCol: { value: sunCol },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 top, horizon, ground, sunDir, sunCol;
      void main(){
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.55)) : mix(horizon, ground, pow(-y, 0.4));
        float s = max(dot(vDir, sunDir), 0.0);
        c += sunCol * (pow(s, 600.0)*30.0 + pow(s, 12.0)*0.35);
        // soft canopy blobs (trees silhouettes) near the horizon
        float canopy = smoothstep(0.05, 0.25, y) * (1.0 - smoothstep(0.25, 0.7, y));
        float n = sin(atan(vDir.z, vDir.x)*7.0)*0.5 + sin(atan(vDir.z, vDir.x)*17.0)*0.25;
        c = mix(c, c*vec3(0.55,0.7,0.5), canopy * smoothstep(-0.2, 0.6, n) * 0.6);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export interface SurfaceLights {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  env: THREE.Texture;
  sky: THREE.Mesh;
  sunDir: THREE.Vector3;
}

export function createSurfaceEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, night = false): SurfaceLights {
  const sunDir = new THREE.Vector3(-0.55, 0.78, 0.32).normalize();
  const top = night ? new THREE.Color(0.02, 0.03, 0.07) : new THREE.Color(0.5, 0.62, 0.78);
  const horizon = night ? new THREE.Color(0.06, 0.07, 0.1) : new THREE.Color(0.85, 0.84, 0.76);
  const ground = night ? new THREE.Color(0.02, 0.02, 0.02) : new THREE.Color(0.22, 0.24, 0.12);
  const sunCol = night ? new THREE.Color(0.4, 0.5, 0.8) : new THREE.Color(1.0, 0.86, 0.62);

  // Environment map from the procedural sky.
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial(top, horizon, ground, sunDir, sunCol));
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  scene.environment = env;

  const sky = new THREE.Mesh(new THREE.SphereGeometry(40000, 32, 16), skyMaterial(top, horizon, ground, sunDir, sunCol));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const sun = new THREE.DirectionalLight(sunCol, night ? 0.6 : 3.1);
  sun.position.copy(sunDir).multiplyScalar(600);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -260;
  sc.right = 260;
  sc.top = 260;
  sc.bottom = -260;
  sc.near = 10;
  sc.far = 2400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(night ? 0x223355 : 0xbfd4ff, night ? 0x0a0a08 : 0x5a4a2a, night ? 0.25 : 0.95);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2(horizon.getHex(), night ? 0.0012 : 0.00055);
  return { sun, hemi, env, sky, sunDir };
}

export interface NestLights {
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  points: THREE.PointLight[];
}

export function createNestEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): NestLights {
  scene.background = new THREE.Color(0x060403);
  // Warm, dim env for subtle chitin highlights.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), skyMaterial(new THREE.Color(0.5, 0.36, 0.22), new THREE.Color(0.25, 0.16, 0.09), new THREE.Color(0.05, 0.03, 0.02), new THREE.Vector3(0.3, 0.6, 1), new THREE.Color(1, 0.7, 0.4))));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  // Underground: very little ambient so undug soil sinks into darkness; a warm raking key.
  const ambient = new THREE.AmbientLight(0x4a3828, 0.16);
  const key = new THREE.DirectionalLight(0xffc27a, 1.15);
  key.position.set(-300, 430, -300);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = -200;
  sc.right = 200;
  sc.top = 200;
  sc.bottom = -200;
  sc.near = 10;
  sc.far = 2400;
  key.shadow.bias = -0.0015;
  key.shadow.normalBias = 0.9;
  const fill = new THREE.DirectionalLight(0x6a7890, 0.18);
  fill.position.set(300, 200, 400);
  scene.add(ambient, key, key.target, fill);
  const points: THREE.PointLight[] = [];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.PointLight(0xffd8a0, 0, 60, 1.6);
    p.castShadow = false;
    scene.add(p);
    points.push(p);
  }
  scene.fog = new THREE.FogExp2(0x070504, 0.002);
  return { key, fill, ambient, points };
}
