/**
 * celestial-world.js — the 3D celestial environment.
 * Endless cloud layers, golden sunrise, volumetric god rays, floating marble
 * platform with colonnade, and the 3D chessboard table.
 */
import * as THREE from './three.min.js';

export const WORLD = {};

// ------------------------------------------------------------------ utils
function noiseTexture(size, type) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  // value noise via random blobs, tinted by type
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 40;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function radialSprite(inner, outer) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.45, outer);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------------ sky
function buildSky(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunPos: { value: new THREE.Vector3(-0.35, 0.22, -0.9).normalize() },
      uTop: { value: new THREE.Color('#2b6ba8') },
      uHorizon: { value: new THREE.Color('#ffd79a') },
      uBottom: { value: new THREE.Color('#f7dcb4') },
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop, uHorizon, uBottom, uSunPos;
      uniform float uTime;
      varying vec3 vDir;

      // cheap value noise for the cloud-sea surface
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;

        // ---- above the horizon: deep blue zenith -> champagne skyline ----
        vec3 col = mix(uHorizon, uTop, smoothstep(0.015, 0.34, h));

        // ---- below the horizon: the endless cloud sea, lit by the sunrise ----
        float k = smoothstep(0.0, -0.55, h);              // 0 at horizon, 1 far below
        vec3 seaNear = vec3(1.00, 0.90, 0.74);
        vec3 seaFar  = vec3(0.86, 0.68, 0.48);
        vec3 sea = mix(seaNear, seaFar, k);
        // cloud tops: slow, wide bands that read as a vast deck of clouds
        vec2 uv = d.xz / max(abs(h) + 0.12, 0.12);
        float n = fbm(uv * 1.6 + vec2(uTime * 0.01, 0.0));
        float n2 = fbm(uv * 4.1 - vec2(0.0, uTime * 0.014));
        sea += (n - 0.5) * 0.10 + (n2 - 0.5) * 0.05;
        sea = mix(sea, vec3(1.0, 0.96, 0.88), smoothstep(0.55, 0.95, n) * 0.55);

        col = mix(col, sea, smoothstep(0.01, -0.06, h));

        // ---- sun glow ----
        float sd = max(dot(d, normalize(uSunPos)), 0.0);
        float glow = pow(sd, 6.0) * 0.75 + pow(sd, 60.0) * 1.9;
        col += vec3(1.0, 0.86, 0.62) * glow;
        // warm haze hugging the horizon
        float band = exp(-abs(h) * 14.0);
        col = mix(col, vec3(1.0, 0.90, 0.72), band * 0.20);
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  scene.add(sky);
  WORLD.sky = sky;
  return sky;
}

// ------------------------------------------------------------------ clouds
/**
 * Layered cloud deck built from soft billboard puffs.
 * `quality` scales the number of sprites (perf mode => fewer).
 */
function buildClouds(scene, quality) {
  const group = new THREE.Group();
  const tex = radialSprite('rgba(255,255,255,0.95)', 'rgba(255,248,235,0.55)');
  // `drop` = how far below the platform the deck sits, as a multiple of sprite
  // size, so no puff ever pokes above the horizon and seals off the sky.
  const layerDefs = [
    { drop: 0.70, r: 62, count: 46, size: [26, 52], opacity: 0.95, color: 0xfffaf2 },
    { drop: 0.78, r: 105, count: 70, size: [40, 80], opacity: 0.92, color: 0xfff6ea },
    { drop: 0.85, r: 170, count: 78, size: [65, 125], opacity: 0.88, color: 0xffefdb },
    { drop: 0.92, r: 275, count: 64, size: [110, 210], opacity: 0.8, color: 0xffe6c8 },
    { drop: 1.0, r: 430, count: 40, size: [170, 330], opacity: 0.62, color: 0xffdcb4 }
  ];
  const mul = quality === 'performance' ? 0.35 : quality === 'balanced' ? 0.65 : 1;

  layerDefs.forEach((def, li) => {
    const n = Math.round(def.count * mul);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: def.opacity * (0.75 + Math.random() * 0.25),
        color: new THREE.Color(def.color),
        depthWrite: false,
        blending: THREE.NormalBlending
      });
      const s = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const rad = def.r * (0.45 + Math.random() * 0.8);
      const sc = def.size[0] + Math.random() * (def.size[1] - def.size[0]);
      const flat = 0.34 + Math.random() * 0.2;
      // keep the whole puff below the horizon line
      const y = -def.drop * sc - Math.random() * sc * 0.25;
      s.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      s.scale.set(sc, sc * flat, 1);
      s.userData.drift = 0.06 + Math.random() * 0.16;
      s.userData.spin = (Math.random() - 0.5) * 0.02;
      s.userData.baseY = s.position.y;
      s.userData.phase = Math.random() * Math.PI * 2;
      group.add(s);
    }
  });

  // ------------------------------------------------------------------
  // the horizon deck: a cloud sea that recedes to the skyline. Sizes scale
  // with distance so every puff subtends a similar (small) angle and the
  // sky above the horizon stays open.
  // ------------------------------------------------------------------
  for (let i = 0; i < Math.round(90 * mul); i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true,
      opacity: 0.42 + Math.random() * 0.4,
      color: new THREE.Color(Math.random() < 0.35 ? 0xffd9a8 : 0xfff3e4),
      depthWrite: false
    });
    const s = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const rad = 150 + Math.random() * 430;
    const w = rad * (0.16 + Math.random() * 0.16);
    s.position.set(
      Math.cos(a) * rad,
      -rad * 0.012 - Math.random() * rad * 0.03,
      Math.sin(a) * rad
    );
    s.scale.set(w, w * (0.26 + Math.random() * 0.16), 1);
    s.userData.drift = 0.02 + Math.random() * 0.04;
    s.userData.spin = 0;
    s.userData.baseY = s.position.y;
    s.userData.phase = Math.random() * Math.PI * 2;
    group.add(s);
  }

  // a few small high wisps, far out, for depth against the sky
  for (let i = 0; i < Math.round(14 * mul); i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.20 + Math.random() * 0.12,
      color: new THREE.Color(0xfff4e2), depthWrite: false
    });
    const s = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const rad = 320 + Math.random() * 260;
    s.position.set(Math.cos(a) * rad, 70 + Math.random() * 110, Math.sin(a) * rad);
    const sc = 90 + Math.random() * 120;
    s.scale.set(sc, sc * 0.34, 1);
    s.userData.drift = 0.02 + Math.random() * 0.05;
    s.userData.spin = 0;
    s.userData.baseY = s.position.y;
    s.userData.phase = Math.random() * Math.PI * 2;
    group.add(s);
  }

  // distant cloud mountains: big low-opacity sprites far out
  for (let i = 0; i < Math.round(22 * mul); i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.30,
      color: new THREE.Color(0xffe4c4), depthWrite: false
    });
    const s = new THREE.Sprite(mat);
    const a = (i / 22) * Math.PI * 2 + Math.random() * 0.2;
    const rad = 400 + Math.random() * 180;
    s.position.set(Math.cos(a) * rad, -70 + Math.random() * 30, Math.sin(a) * rad);
    const sc = 220 + Math.random() * 180;
    s.scale.set(sc, sc * 0.5, 1);
    group.add(s);
  }

  scene.add(group);
  WORLD.clouds = group;
  return group;
}

// ------------------------------------------------------------------ god rays
function buildGodRays(scene) {
  const group = new THREE.Group();
  const tex = radialSprite('rgba(255,236,190,0.55)', 'rgba(255,220,150,0.20)');
  // broad shafts angled from the sun direction
  const sunDir = new THREE.Vector3(-0.45, 0.6, -0.75).normalize();
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffe9bd),
      transparent: true,
      opacity: 0.09 + Math.random() * 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const len = 220 + Math.random() * 120;
    const w = 26 + Math.random() * 40;
    const geo = new THREE.PlaneGeometry(w, len);
    const shaft = new THREE.Mesh(geo, mat);
    shaft.position.copy(sunDir.clone().multiplyScalar(-60));
    shaft.position.x += (Math.random() - 0.5) * 150;
    shaft.position.z += (Math.random() - 0.5) * 150;
    shaft.position.y += (Math.random() - 0.5) * 40;
    shaft.rotation.z = (Math.random() - 0.5) * 0.5;
    shaft.rotation.x = -0.35;
    shaft.userData.phase = Math.random() * Math.PI * 2;
    shaft.userData.baseOpacity = mat.opacity;
    group.add(shaft);
  }
  // sun disc glow
  const sunMat = new THREE.SpriteMaterial({
    map: tex, color: 0xfff2d0, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const sun = new THREE.Sprite(sunMat);
  sun.position.copy(sunDir.clone().multiplyScalar(420));
  sun.scale.set(260, 260, 1);
  group.add(sun);
  WORLD.sunSprite = sun;

  scene.add(group);
  WORLD.rays = group;
  return group;
}

// ------------------------------------------------------------------ particles
function buildParticles(scene, quality) {
  const count = quality === 'performance' ? 120 : quality === 'balanced' ? 260 : 420;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = 6 + Math.random() * 60;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 26 - 2;
    pos[i * 3 + 2] = Math.sin(a) * r;
    speed[i] = 0.06 + Math.random() * 0.22;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xfff4d6, size: 0.10, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  });
  const pts = new THREE.Points(geo, mat);
  pts.userData.speed = speed;
  scene.add(pts);
  WORLD.particles = pts;
  return pts;
}

// ------------------------------------------------------------------ platform
function buildArchitecture(scene, quality) {
  const group = new THREE.Group();

  const marble = new THREE.MeshStandardMaterial({
    color: 0xefe7d8, roughness: 0.52, metalness: 0.04, envMapIntensity: 0.8,
    envMapIntensity: 1.5
  });
  const marbleDark = new THREE.MeshStandardMaterial({
    color: 0xdcd2c0, roughness: 0.58, metalness: 0.05, envMapIntensity: 0.75
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd9b45c, roughness: 0.26, metalness: 0.92,
    emissive: new THREE.Color(0x3a2a08), emissiveIntensity: 0.4
  });

  // main circular plaza
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.6, 1.1, 96, 1), marble);
  plaza.position.y = -0.55;
  plaza.receiveShadow = true;
  group.add(plaza);

  // concentric gold inlay rings
  [9.6, 12.4, 14.4].forEach(r => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 120), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    group.add(ring);
  });

  // lower tier (floating base) for depth
  const base = new THREE.Mesh(new THREE.CylinderGeometry(15.6, 12.5, 2.6, 64, 1), marbleDark);
  base.position.y = -2.3;
  group.add(base);
  const under = new THREE.Mesh(new THREE.ConeGeometry(12.5, 7, 48, 1, true), marbleDark);
  under.position.y = -7;
  under.rotation.x = Math.PI;
  group.add(under);

  // colonnade
  const pillarCount = quality === 'performance' ? 8 : 10;
  for (let i = 0; i < pillarCount; i++) {
    const a = (i / pillarCount) * Math.PI * 2 + Math.PI / pillarCount;
    const R = 13.2;
    const px = Math.cos(a) * R, pz = Math.sin(a) * R;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 7.2, 20), marble);
    shaft.position.set(px, 3.6, pz);
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    group.add(shaft);

    const capBase = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.22, 1.35), marbleDark);
    capBase.position.set(px, 0.11, pz); group.add(capBase);
    const capTop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.26, 1.4), gold);
    capTop.position.set(px, 7.25, pz); group.add(capTop);

    // fluting accents
    for (let f = 0; f < 4; f++) {
      const fa = (f / 4) * Math.PI * 2;
      const flute = new THREE.Mesh(new THREE.BoxGeometry(0.07, 7.0, 0.07), marbleDark);
      flute.position.set(px + Math.cos(fa) * 0.42, 3.6, pz + Math.sin(fa) * 0.42);
      group.add(flute);
    }
  }

  // arch ring connecting pillar tops
  const archRing = new THREE.Mesh(new THREE.TorusGeometry(13.2, 0.16, 10, 96), gold);
  archRing.rotation.x = Math.PI / 2;
  archRing.position.y = 7.45;
  group.add(archRing);

  // grand arches (open, elegant) at 4 cardinal points
  [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx, dz]) => {
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.13, 8, 32, Math.PI),
      gold
    );
    arch.position.set(dx * 13.2, 7.2, dz * 13.2);
    arch.rotation.y = Math.atan2(dx, dz);
    group.add(arch);
  });

  // railings between pillars
  for (let i = 0; i < pillarCount; i++) {
    const a0 = (i / pillarCount) * Math.PI * 2 + Math.PI / pillarCount;
    const a1 = ((i + 1) / pillarCount) * Math.PI * 2 + Math.PI / pillarCount;
    const R = 13.2;
    const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0) - 1.2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.09), gold);
    bar.position.set(mx, 1.05, mz);
    bar.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    group.add(bar);
    const bar2 = bar.clone(); bar2.position.y = 0.62; group.add(bar2);
    const posts = quality === 'performance' ? 2 : 4;
    for (let k = 1; k <= posts; k++) {
      const t = k / (posts + 1);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6), gold);
      post.position.set(x0 + (x1 - x0) * t, 0.52, z0 + (z1 - z0) * t);
      group.add(post);
    }
  }

  // distant architectural silhouettes (depth)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.7;
    const R = 120 + Math.random() * 90;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 22 + Math.random() * 16, 10), marbleDark);
    tower.position.set(Math.cos(a) * R, -16 + Math.random() * 6, Math.sin(a) * R);
    tower.material = marbleDark.clone();
    tower.material.transparent = true;
    tower.material.opacity = 0.5;
    group.add(tower);
  }

  scene.add(group);
  WORLD.architecture = group;
  return group;
}

// ------------------------------------------------------------------ chess table
function buildTable(scene) {
  const group = new THREE.Group();
  const marble = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 0.3, metalness: 0.05 });
  const ebony = new THREE.MeshStandardMaterial({ color: 0x1b1712, roughness: 0.28, metalness: 0.12 });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd9b45c, roughness: 0.22, metalness: 0.95,
    emissive: new THREE.Color(0x2b1f05), emissiveIntensity: 0.5
  });

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.6, 1.0, 48), marble);
  pedestal.position.y = 0.5; pedestal.castShadow = true; pedestal.receiveShadow = true;
  group.add(pedestal);

  const trim = new THREE.Mesh(new THREE.TorusGeometry(3.62, 0.08, 8, 64), gold);
  trim.rotation.x = Math.PI / 2; trim.position.y = 1.0; group.add(trim);

  // board slab
  const boardSize = 8;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(boardSize + 0.9, 0.42, boardSize + 0.9), marble);
  slab.position.y = 1.22; slab.castShadow = true; slab.receiveShadow = true;
  group.add(slab);

  const edge = new THREE.Mesh(new THREE.BoxGeometry(boardSize + 1.0, 0.10, boardSize + 1.0), gold);
  edge.position.y = 1.44;
  group.add(edge);

  // 64 squares
  const lightSq = new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.24, metalness: 0.06 });
  const darkSq = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.22, metalness: 0.14 });
  const sqGeo = new THREE.BoxGeometry(1, 0.06, 1);
  const squares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isLight = ((r + c) % 2 === 0);
      const sq = new THREE.Mesh(sqGeo, isLight ? lightSq : darkSq);
      sq.position.set(c - 3.5, 1.47, r - 3.5);
      sq.receiveShadow = true;
      sq.userData.square = r * 8 + c;
      group.add(sq);
      squares.push(sq);
    }
  }
  WORLD.squares = squares;

  scene.add(group);
  WORLD.table = group;
  WORLD.boardTopY = 1.5;
  return group;
}

// ------------------------------------------------------------------ lights
function buildLights(scene) {
  const sun = new THREE.DirectionalLight(0xfff0cf, 2.5);
  sun.position.set(-22, 30, -26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  const d = 22;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  WORLD.sunLight = sun;

  const fill = new THREE.HemisphereLight(0xcfe2f8, 0xf3ddb8, 0.85);
  scene.add(fill);
  WORLD.fill = fill;

  const rim = new THREE.DirectionalLight(0xffc98a, 0.7);
  rim.position.set(18, 12, 20);
  scene.add(rim);
  WORLD.rim = rim;

  // warm bounce from the cloud sea
  const bounce = new THREE.PointLight(0xffeccb, 0.55, 40, 2);
  bounce.position.set(0, -3.5, 0);
  scene.add(bounce);
  WORLD.bounce = bounce;
}

// ------------------------------------------------------------------ build
export function buildWorld(scene, renderer, quality = 'high') {
  buildSky(scene);
  buildClouds(scene, quality);
  buildVoyageBanks(scene, quality);
  buildGodRays(scene);
  buildParticles(scene, quality);
  buildArchitecture(scene, quality);
  buildTable(scene);
  buildLights(scene);

  // environment map from the sky for marble/gold reflections
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const skyClone = WORLD.sky.clone();
    envScene.add(skyClone);
    WORLD.envMap = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = WORLD.envMap;
    pmrem.dispose();
  } catch (e) { /* env optional */ }

  return WORLD;
}

// ------------------------------------------------------------------ animate
export const VOYAGE = { active: false, speed: 0 };

/** banks of cloud that stream toward and past the viewer in voyage mode */
function buildVoyageBanks(scene, quality) {
  const group = new THREE.Group();
  const tex = radialSprite('rgba(255,255,255,0.96)', 'rgba(255,246,232,0.5)');
  const n = quality === 'performance' ? 26 : quality === 'balanced' ? 40 : 56;
  const R = 900;
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true,
      opacity: 0.18 + Math.random() * 0.32,
      color: new THREE.Color(Math.random() < 0.35 ? 0xffd2a0 : 0xfff2e2),
      depthWrite: false
    });
    const s = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const rad = 55 + Math.random() * 210;
    const w = 30 + Math.random() * 110;
    s.scale.set(w, w * (0.32 + Math.random() * 0.28), 1);
    s.position.set(Math.cos(a) * rad, -46 + Math.random() * 40, Math.sin(a) * rad - Math.random() * R);
    s.userData.rad = rad;
    s.userData.ang = a;
    s.userData.w = w;
    s.userData.spin = (Math.random() - 0.5) * 0.004;
    group.add(s);
  }
  group.visible = false;
  scene.add(group);
  WORLD.voyage = group;
  return group;
}

export function setVoyage(on) {
  VOYAGE.active = !!on;
  if (WORLD.voyage) WORLD.voyage.visible = !!on;
}

export function updateWorld(dt, t) {
  if (WORLD.clouds) {
    WORLD.clouds.children.forEach(s => {
      s.position.x += Math.sin(t * 0.05 + s.userData.phase) * 0.02 * (s.userData.drift || 1);
      s.position.z += Math.cos(t * 0.04 + s.userData.phase) * 0.015 * (s.userData.drift || 1);
      if (s.userData.baseY !== undefined) {
        s.position.y = s.userData.baseY + Math.sin(t * 0.25 + s.userData.phase) * 0.35;
      }
    });
  }
  if (WORLD.particles) {
    const p = WORLD.particles.geometry.attributes.position;
    const sp = WORLD.particles.userData.speed;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + sp[i] * dt * 1.6;
      if (y > 26) y = -2;
      p.setY(i, y);
    }
    p.needsUpdate = true;
  }
  if (WORLD.rays) {
    WORLD.rays.children.forEach(s => {
      if (s.material && s.userData.baseOpacity) {
        s.material.opacity = s.userData.baseOpacity * (0.75 + Math.sin(t * 0.6 + s.userData.phase) * 0.25);
      }
    });
  }
  // ---- voyage: fly the never-ending clouds past the viewer ----
  const targetSpeed = VOYAGE.active ? 26 : 0;
  VOYAGE.speed += (targetSpeed - VOYAGE.speed) * Math.min(1, dt * 0.9);
  if (WORLD.voyage && WORLD.voyage.visible) {
    const z0 = 300;
    WORLD.voyage.children.forEach(s => {
      s.position.z += VOYAGE.speed * dt;
      if (s.userData.spin) {
        s.userData.ang += s.userData.spin * dt;
        s.position.x = Math.cos(s.userData.ang) * s.userData.rad;
      }
      if (s.position.z > z0) {
        // recycle the bank far behind the viewer
        s.position.z -= 900 + Math.random() * 200;
        s.userData.rad = 55 + Math.random() * 210;
        s.userData.ang = Math.random() * Math.PI * 2;
        s.position.set(Math.cos(s.userData.ang) * s.userData.rad,
                       -46 + Math.random() * 40,
                       s.position.z);
        const w = 30 + Math.random() * 110;
        s.scale.set(w, w * (0.32 + Math.random() * 0.28), 1);
        s.material.opacity = 0.18 + Math.random() * 0.32;
      }
    });
    // a gentle drift of the whole cloud sea keeps the sense of travel alive
    if (WORLD.clouds) WORLD.clouds.position.z = (WORLD.clouds.position.z + VOYAGE.speed * dt * 0.06) % 400;
  }
  if (WORLD.sky) WORLD.sky.material.uniforms.uTime.value = t;
}
