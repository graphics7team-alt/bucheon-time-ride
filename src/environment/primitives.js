import * as THREE from 'three';
import {
  fbm2,
  hash2,
  makeLambert,
  orientOnRail,
  sampleRail,
  setInstanceAt,
  worldOnRail,
} from './utils.js';

const shared = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  cone: new THREE.ConeGeometry(1, 1.6, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  plane: new THREE.PlaneGeometry(1, 1, 1, 1),
};

export function getSharedGeometries() {
  return shared;
}

/** 레일 양옆 지형 띠(전경/중경/원경). */
export function createTerrainStrip(curve, options) {
  const {
    u0,
    u1,
    sideSign, // -1 left, +1 right
    lateral0,
    lateral1,
    samplesU = 18,
    samplesL = 5,
    heightScale = 2.2,
    baseY = -0.15,
    color = 0x6f8f55,
    noiseScale = 0.35,
    seed = 1,
  } = options;

  const positions = [];
  const indices = [];
  const cols = samplesL;
  const rows = samplesU;

  for (let iu = 0; iu <= rows; iu++) {
    const tu = iu / rows;
    const u = THREE.MathUtils.lerp(u0, u1, tu);
    sampleRail(curve, u);
    for (let il = 0; il <= cols; il++) {
      const tl = il / cols;
      const lateral = sideSign * THREE.MathUtils.lerp(lateral0, lateral1, tl);
      const px = _railPoint(curve, u, lateral);
      const n = fbm2(px.x * noiseScale + seed, px.z * noiseScale + seed * 1.7, 3);
      const edgeFalloff = Math.sin(tl * Math.PI);
      const h = baseY + n * heightScale * (0.35 + edgeFalloff * 0.65);
      positions.push(px.x, h, px.z);
    }
  }

  for (let iu = 0; iu < rows; iu++) {
    for (let il = 0; il < cols; il++) {
      const a = iu * (cols + 1) + il;
      const b = a + 1;
      const c = a + (cols + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, makeLambert(color));
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.name = 'terrain-strip';
  return mesh;
}

function _railPoint(curve, u, lateral) {
  return worldOnRail(curve, u, lateral, 0, new THREE.Vector3());
}

/** 강 띠 — 반투명 + 단순 흐름 애니메이션용 userData. */
export function createRiverStrip(curve, options) {
  const {
    u0,
    u1,
    sideSign,
    lateral,
    width = 4.5,
    samples = 24,
    color = 0x4a8fb8,
  } = options;

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = THREE.MathUtils.lerp(u0, u1, t);
    const { point, side } = sampleRail(curve, u, {
      point: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      side: new THREE.Vector3(),
    });
    const mid = point.clone().addScaledVector(side, sideSign * lateral);
    const a = mid.clone().addScaledVector(side, -width * 0.5);
    const b = mid.clone().addScaledVector(side, width * 0.5);
    a.y = 0.08;
    b.y = 0.08;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uvs.push(0, t * 4, 1, t * 4);
  }

  for (let i = 0; i < samples; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  });
  mat.userData.baseOpacity = 0.85;
  mat.userData.riverScroll = true;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'river';
  mesh.userData.river = true;
  return mesh;
}

export function createMountainBillboards(curve, options) {
  const {
    u0,
    u1,
    sideSign,
    lateral,
    count = 8,
    color = 0x7a8a78,
    heightMin = 10,
    heightMax = 22,
    seed = 3,
  } = options;

  const group = new THREE.Group();
  group.name = 'mountains';
  const geo = new THREE.ConeGeometry(1, 1, 5);
  geo.translate(0, 0.5, 0);
  const mat = makeLambert(color);
  mat.userData.envFade = true;
  mat.userData.baseOpacity = 1;

  for (let i = 0; i < count; i++) {
    const t = (i + 0.35) / count;
    const u = THREE.MathUtils.lerp(u0, u1, t);
    const h = THREE.MathUtils.lerp(heightMin, heightMax, hash2(i, seed));
    const w = h * (0.55 + hash2(seed, i) * 0.45);
    const mesh = new THREE.Mesh(geo, mat);
    const lat = sideSign * (lateral + hash2(i * 1.3, seed) * 6);
    orientOnRail(mesh, curve, u, lat, 0);
    mesh.scale.set(w, h, w * 0.85);
    mesh.rotation.y += hash2(i, seed + 2) * Math.PI;
    group.add(mesh);
  }
  return group;
}

export function createBushField(curve, options) {
  const {
    u0,
    u1,
    sideSign,
    lateral0,
    lateral1,
    count = 40,
    colors = [0x4f7a3e, 0x6a8f4c, 0x3d6a38],
    seed = 9,
  } = options;

  const geo = shared.sphere;
  const mats = colors.map((c) => {
    const m = makeLambert(c);
    m.userData.envFade = true;
    m.userData.baseOpacity = 1;
    return m;
  });
  const mesh = new THREE.InstancedMesh(geo, mats[0], count);
  mesh.name = 'bushes';
  mesh.castShadow = false;

  let n = 0;
  for (let i = 0; i < count; i++) {
    const t = hash2(i, seed);
    const u = THREE.MathUtils.lerp(u0, u1, t);
    const lat = sideSign * THREE.MathUtils.lerp(
      lateral0,
      lateral1,
      hash2(seed + 1, i)
    );
    const s = 0.35 + hash2(i, seed + 4) * 0.7;
    setInstanceAt(mesh, n, curve, u, lat, s * 0.4, s, hash2(i, 2) * Math.PI);
    n += 1;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  // 여러 색을 쓰려면 메시를 나누는 편이 단순하다 — 단일 재질 유지.
  mesh.material = mats[0];
  return mesh;
}

export function createPitHouse(scale = 1, palette = {}) {
  const group = new THREE.Group();
  group.name = 'pit-house';
  const wall = palette.wall ?? 0x8a6a45;
  const roof = palette.roof ?? 0x6e5340;
  const earth = palette.earth ?? 0x5c4a32;

  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    makeLambert(earth)
  );
  mound.scale.set(1.4 * scale, 0.55 * scale, 1.4 * scale);
  mound.position.y = 0.02;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05 * scale, 1.2 * scale, 1.1 * scale, 10),
    makeLambert(wall)
  );
  body.position.y = 0.55 * scale;

  const roofMesh = new THREE.Mesh(
    new THREE.ConeGeometry(1.55 * scale, 1.5 * scale, 10),
    makeLambert(roof)
  );
  roofMesh.position.y = 1.45 * scale;

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.55 * scale, 0.85 * scale, 0.12 * scale),
    makeLambert(0x2a2218)
  );
  door.position.set(0, 0.45 * scale, 1.15 * scale);

  group.add(mound, body, roofMesh, door);
  group.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material.userData.envFade = true;
      o.material.userData.baseOpacity = 1;
    }
  });
  return group;
}

export function createDolmen(scale = 1) {
  const g = new THREE.Group();
  const stone = makeLambert(0x8e9590);
  stone.userData.envFade = true;
  stone.userData.baseOpacity = 1;
  const legA = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), stone);
  const legB = legA.clone();
  legA.position.set(-0.55, 0.55, 0);
  legB.position.set(0.55, 0.55, 0);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 1.1), stone);
  cap.position.y = 1.2;
  g.add(legA, legB, cap);
  g.scale.setScalar(scale);
  return g;
}

export function createFieldPatches(curve, options) {
  const {
    u0,
    u1,
    sideSign,
    lateral,
    count = 6,
    color = 0xc2a85a,
    seed = 11,
  } = options;
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(3.2, 2.2);
  geo.rotateX(-Math.PI / 2);
  const mat = makeLambert(color);
  mat.userData.envFade = true;
  mat.userData.baseOpacity = 1;

  for (let i = 0; i < count; i++) {
    const t = (i + 0.2) / count;
    const u = THREE.MathUtils.lerp(u0, u1, t);
    const mesh = new THREE.Mesh(geo, mat);
    const lat = sideSign * (lateral + (hash2(i, seed) - 0.5) * 2.5);
    orientOnRail(mesh, curve, u, lat, 0.05);
    mesh.scale.set(0.8 + hash2(seed, i) * 0.6, 1, 0.7 + hash2(i, 4) * 0.5);
    group.add(mesh);
  }
  return group;
}

export function createMuseumBlock(width, height, depth, color) {
  const g = new THREE.Group();
  const mat = makeLambert(color);
  mat.userData.envFade = true;
  mat.userData.baseOpacity = 1;
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  body.position.y = height * 0.5;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.05, 0.35, depth * 1.05),
    makeLambert(0xd8dde4)
  );
  roof.material.userData.envFade = true;
  roof.material.userData.baseOpacity = 1;
  roof.position.y = height + 0.1;
  g.add(body, roof);
  return g;
}

/** 레일 위 통과용 움집/터널 전환 구조물 */
export function createTransitionHut(length = 14, width = 5.2, height = 4.2) {
  const g = new THREE.Group();
  g.name = 'transition-hut';

  const wallMat = makeLambert(0x5a4332);
  const darkMat = makeLambert(0x1a140f);
  const roofMat = makeLambert(0x3f2e22);
  for (const m of [wallMat, darkMat, roofMat]) {
    m.userData.envFade = true;
    m.userData.baseOpacity = 1;
  }

  const halfL = length * 0.5;
  const halfW = width * 0.5;

  // 좌우 벽 — 외부를 가린다
  const left = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, height, length),
    wallMat
  );
  left.position.set(-halfW, height * 0.5, 0);
  const right = left.clone();
  right.position.x = halfW;

  // 천장
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.8, 0.5, length + 0.6),
    roofMat
  );
  roof.position.y = height + 0.1;

  // 바닥
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.2, 0.2, length),
    darkMat
  );
  floor.position.y = 0.05;

  // 입구/출구 프레임 (가운데는 비움)
  const frameMat = makeLambert(0x4a3528);
  frameMat.userData.envFade = true;
  frameMat.userData.baseOpacity = 1;
  function portal(z) {
    const frame = new THREE.Group();
    const postL = new THREE.Mesh(new THREE.BoxGeometry(0.4, height, 0.4), frameMat);
    const postR = postL.clone();
    postL.position.set(-halfW + 0.3, height * 0.5, z);
    postR.position.set(halfW - 0.3, height * 0.5, z);
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.2, 0.4, 0.4),
      frameMat
    );
    lintel.position.set(0, height - 0.1, z);
    frame.add(postL, postR, lintel);
    return frame;
  }

  // 내부 칸막이 — 시야를 더 좁힘
  const baffle = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.55, height * 0.85, 0.35),
    darkMat
  );
  baffle.position.set(width * 0.18, height * 0.42, 0);

  g.add(left, right, roof, floor, portal(-halfL), portal(halfL), baffle);

  // 외피 움집 느낌의 덮개
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(width * 0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    roofMat
  );
  shell.scale.set(1.15, 0.9, length / width * 0.55);
  shell.position.y = height * 0.15;
  g.add(shell);

  g.userData.hutLength = length;
  return g;
}

export function createLobbyHall(curve, u0, u1) {
  const g = new THREE.Group();
  g.name = 'lobby';
  const wallMat = makeLambert(0xe8eef5);
  wallMat.userData.envFade = true;
  wallMat.userData.baseOpacity = 1;
  const floorMat = makeLambert(0xc5d0dc);
  floorMat.userData.envFade = true;
  floorMat.userData.baseOpacity = 1;

  const samples = 10;
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const u = THREE.MathUtils.lerp(u0, u1, t);
    for (const sign of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 5.5, 3.2),
        wallMat
      );
      orientOnRail(wall, curve, u, sign * 5.2, 0);
      wall.position.y += 2.75;
      g.add(wall);
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.15, 3.4), floorMat);
    orientOnRail(floor, curve, u, 0, 0);
    g.add(floor);
  }

  // 기둥 열
  const colMat = makeLambert(0xdde5ee);
  colMat.userData.envFade = true;
  colMat.userData.baseOpacity = 1;
  for (let i = 0; i < 6; i++) {
    const u = THREE.MathUtils.lerp(u0, u1, (i + 0.5) / 6);
    for (const sign of [-1, 1]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.32, 5.2, 8),
        colMat
      );
      orientOnRail(col, curve, u, sign * 3.4, 0);
      col.position.y += 2.6;
      g.add(col);
    }
  }
  return g;
}

export function createTimePortal(curve, u) {
  const g = new THREE.Group();
  g.name = 'time-portal';
  const mat = makeLambert(0xf4f7fb);
  mat.userData.envFade = true;
  mat.userData.baseOpacity = 1;
  const glow = makeLambert(0x9fd0ff);
  glow.emissive = new THREE.Color(0x3a7fff);
  glow.emissiveIntensity = 0.55;
  glow.userData.envFade = true;
  glow.userData.baseOpacity = 1;

  const post = 0.48;
  const width = 6.4;
  const height = 7.6;
  const left = new THREE.Mesh(new THREE.BoxGeometry(post, height, 0.55), mat);
  left.position.set(-width / 2, height / 2, 0);
  const right = left.clone();
  right.position.x = width / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(width + post, post, 0.55), mat);
  top.position.set(0, height, 0);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(width + post, 0.28, 0.7), mat);
  sill.position.set(0, 0.14, 0);
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.4, height - 0.8),
    glow
  );
  veil.position.set(0, height * 0.48, 0.05);
  veil.material.transparent = true;
  veil.material.opacity = 0.45;
  veil.material.userData.baseOpacity = 0.45;
  veil.material.userData.portalPulse = true;

  g.add(left, right, top, sill, veil);
  orientOnRail(g, curve, u, 0, 0);
  return g;
}

export function createParticleField(curve, u0, u1, count = 48) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = THREE.MathUtils.lerp(u0, u1, hash2(i, 1));
    const lat = (hash2(i, 2) - 0.5) * 8;
    const p = worldOnRail(curve, u, lat, 1.2 + hash2(i, 3) * 4);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    phases[i] = hash2(i, 5) * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.PointsMaterial({
    color: 0xb8dcff,
    size: 0.18,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  mat.userData.envFade = true;
  mat.userData.baseOpacity = 0.75;
  const points = new THREE.Points(geo, mat);
  points.name = 'light-particles';
  points.userData.particles = true;
  return points;
}

export function createBurialHill(curve, u, sideSign, lateral) {
  const g = new THREE.Group();
  const hill = new THREE.Mesh(
    new THREE.SphereGeometry(4.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    makeLambert(0x6d7a58)
  );
  hill.material.userData.envFade = true;
  hill.material.userData.baseOpacity = 1;
  hill.scale.set(1.4, 0.7, 1.1);
  hill.position.y = 0.05;

  const tomb = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.7, 1.3),
    makeLambert(0x8a9096)
  );
  tomb.material.userData.envFade = true;
  tomb.material.userData.baseOpacity = 1;
  tomb.position.set(0.4, 1.3, 0.2);

  g.add(hill, tomb);
  orientOnRail(g, curve, u, sideSign * lateral, 0);
  return g;
}

export function createWorkshopShed(curve, u, sideSign, lateral) {
  const g = new THREE.Group();
  const mat = makeLambert(0x9a7a55);
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 3.2), mat);
  body.position.y = 1.2;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 1.4, 4),
    makeLambert(0x6a4e38)
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.9;
  g.add(body, roof);
  orientOnRail(g, curve, u, sideSign * lateral, 0);
  return g;
}

export function createHanok(scale = 1, palette = {}) {
  const g = new THREE.Group();
  const wall = makeLambert(palette.wall ?? 0xf0e6d4);
  const wood = makeLambert(palette.wood ?? 0x6b4423);
  const roof = makeLambert(palette.roof ?? 0x3d3a36);
  const base = new THREE.Mesh(new THREE.BoxGeometry(5.5 * scale, 2.4 * scale, 4.2 * scale), wall);
  base.position.y = 1.2 * scale;
  const posts = [];
  for (const x of [-2.2, 2.2]) {
    for (const z of [-1.6, 1.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25 * scale, 2.6 * scale, 0.25 * scale), wood);
      p.position.set(x * scale, 1.3 * scale, z * scale);
      posts.push(p);
    }
  }
  const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(6.4 * scale, 0.35 * scale, 5 * scale), roof);
  roofMesh.position.y = 2.7 * scale;
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(6.6 * scale, 0.25 * scale, 0.4 * scale), roof);
  ridge.position.y = 3.0 * scale;
  g.add(base, ...posts, roofMesh, ridge);
  return g;
}

export function createSchoolBuilding(scale = 1) {
  const g = new THREE.Group();
  const brick = makeLambert(0xb48362);
  const trim = makeLambert(0xe8dcc8);
  const body = new THREE.Mesh(new THREE.BoxGeometry(14 * scale, 6 * scale, 7 * scale), brick);
  body.position.y = 3 * scale;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(15 * scale, 0.4 * scale, 8 * scale), makeLambert(0x5a5048));
  roof.position.y = 6.2 * scale;
  for (let i = 0; i < 4; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.4 * scale, 1.6 * scale, 0.2 * scale), trim);
    win.position.set((-4.5 + i * 3) * scale, 3.2 * scale, 3.55 * scale);
    g.add(win);
  }
  g.add(body, roof);
  return g;
}

export function createTentClassroom(scale = 1) {
  const g = new THREE.Group();
  const canvas = makeLambert(0xc9b896);
  const pole = makeLambert(0x5a4632);
  const cloth = new THREE.Mesh(new THREE.ConeGeometry(3.2 * scale, 3.4 * scale, 4), canvas);
  cloth.position.y = 2.2 * scale;
  cloth.rotation.y = Math.PI / 4;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * scale, 0.1 * scale, 3.6 * scale, 6), pole);
  mast.position.y = 1.8 * scale;
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.8 * scale, 2.8 * scale, 0.12 * scale, 10), makeLambert(0x8a7a5a));
  floor.position.y = 0.06 * scale;
  g.add(cloth, mast, floor);
  return g;
}

export function createApartment(scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(6 * scale, 14 * scale, 5 * scale),
    makeLambert(0xc4c8ce)
  );
  body.position.y = 7 * scale;
  const accent = makeLambert(0x6a90b8);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.2 * scale, 1.1 * scale, 0.15 * scale), accent);
      w.position.set((-1.6 + col * 1.6) * scale, (2.5 + row * 2.2) * scale, 2.55 * scale);
      g.add(w);
    }
  }
  g.add(body);
  return g;
}

export function createChimneyStack(scale = 1) {
  const g = new THREE.Group();
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7 * scale, 0.95 * scale, 10 * scale, 8),
    makeLambert(0x7a6a5a)
  );
  stack.position.y = 5 * scale;
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95 * scale, 0.7 * scale, 0.6 * scale, 8),
    makeLambert(0x4a4038)
  );
  top.position.y = 10.2 * scale;
  g.add(stack, top);
  return g;
}

export function createPeachTree(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18 * scale, 0.28 * scale, 2.2 * scale, 6),
    makeLambert(0x6b4a2e)
  );
  trunk.position.y = 1.1 * scale;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.4 * scale, 8, 6), makeLambert(0xf2a0b8));
  crown.position.y = 2.8 * scale;
  g.add(trunk, crown);
  return g;
}

export function createZelkova(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45 * scale, 0.7 * scale, 5 * scale, 8),
    makeLambert(0x5a4030)
  );
  trunk.position.y = 2.5 * scale;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(3.2 * scale, 10, 8), makeLambert(0x4f7a3e));
  crown.position.y = 6.2 * scale;
  g.add(trunk, crown);
  return g;
}

export function createOnggiJar(scale = 1) {
  const jar = new THREE.Mesh(
    new THREE.SphereGeometry(0.55 * scale, 10, 8),
    makeLambert(0xc47a45)
  );
  jar.scale.y = 1.25;
  jar.position.y = 0.55 * scale;
  return jar;
}

export function createDisplayCase(scale = 1) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.2 * scale, 0.9 * scale, 1.2 * scale), makeLambert(0xd8c8a8));
  base.position.y = 0.45 * scale;
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(2 * scale, 1.4 * scale, 1 * scale),
    new THREE.MeshLambertMaterial({ color: 0xb8d4e8, transparent: true, opacity: 0.35, fog: false })
  );
  glass.position.y = 1.5 * scale;
  g.add(base, glass);
  return g;
}

/** 레일 위 통과용 실내 복도/문간 전환 */
export function createTransitionCorridor(length = 14, width = 4.8, height = 3.8, palette = {}) {
  const g = new THREE.Group();
  g.name = 'transition-corridor';
  const wallMat = makeLambert(palette.wall ?? 0x5a4332);
  const darkMat = makeLambert(palette.dark ?? 0x1a140f);
  const roofMat = makeLambert(palette.roof ?? 0x3f2e22);
  const halfL = length * 0.5;
  const halfW = width * 0.5;
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.4, height, length), wallMat);
  left.position.set(-halfW, height * 0.5, 0);
  const right = left.clone();
  right.position.x = halfW;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 0.4, length + 0.4), roofMat);
  roof.position.y = height;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.18, length), darkMat);
  floor.position.y = 0.05;
  g.add(left, right, roof, floor);
  g.userData.hutLength = length;
  return g;
}
