// 부천 타임라이드
// 카메라 위치는 곡선 레일을 따라 자동으로 이동한다.
// 길은 8개 구간으로 나뉘고, 구간마다 조명과 자막이 바뀐다.
// 관람객은 위치를 바꿀 수 없고, 시선(고개)만 돌릴 수 있다.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import stops from './stops.json' with { type: 'json' };
import { EnvironmentManager } from './environment/EnvironmentManager.js';

const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
const kiosk = params.get('kiosk') === '1';
if (kiosk) document.body.classList.add('kiosk');

// 구간이 바뀔 때 시선을 정면으로 되돌릴지 여부
const AUTO_RECENTER_ON_STOP_CHANGE = true;

const STOP_COUNT = stops.length;

const startBtn = document.querySelector('#start-btn');
const replayBtn = document.querySelector('#replay-btn');
const subtitleEl = document.querySelector('#subtitle');
const speakerEl = document.querySelector('#speaker');
const cueEl = document.querySelector('#cue');
const debugEl = document.querySelector('#debug');
const hintLeftEl = document.querySelector('#hint-left');
const hintRightEl = document.querySelector('#hint-right');
if (debug) debugEl.hidden = false;

// ----- 장면, 카메라, 조명 (그림자는 쓰지 않는다) -----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  400
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = false;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.touchAction = 'none';
document.body.prepend(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 0.38);
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(50, 90, 30);
sun.castShadow = false;
scene.add(ambient, sun);

scene.background = new THREE.Color(0xcfe0ef);
// 거리 안개는 오브젝트를 흐리게 만들므로 쓰지 않는다.
scene.fog = null;

const UP = new THREE.Vector3(0, 1, 0);

// ----- 레일 -----
// 0~1 값을 부드럽게 잇는 함수. 0 이하면 0, 1 이상이면 1.
function smoothstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// u는 길 전체의 진행도(0~1)다.
// 대부분 완만한 커브이고, 5번 구간(0.625~0.75) 안에서만 방향이 크게 꺾인다.
function headingAt(u) {
  let heading = Math.sin(u * Math.PI * 2) * 0.7;
  heading += Math.sin(u * Math.PI * 6) * 0.28;
  const turn = smoothstep((u - 0.65) / 0.07);
  heading += turn * 2.2;
  return heading;
}

// 6번 구간(0.75~0.875) 끝에서 올라가고, 그 다음 구간은 그 높이를 유지한다.
function heightAt(u) {
  return smoothstep((u - 0.82) / (0.875 - 0.82)) * 24;
}

// 한 걸음의 길이를 같게 맞춰 점을 찍는다.
// 그래서 곡선을 8등분하면 구간 길이가 서로 같다.
function buildCurve() {
  const samples = 250;
  const total = 760;
  const step = total / samples;
  const points = [];
  let x = 0;
  let y = 0;
  let z = 0;

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    points.push(new THREE.Vector3(x, y, z));
    if (i === samples) break;

    const nextY = heightAt(u + 1 / samples);
    const dy = nextY - y;
    const horizontal = Math.sqrt(Math.max(0, step * step - dy * dy));
    const heading = headingAt(u);
    x += Math.sin(heading) * horizontal;
    z += Math.cos(heading) * horizontal;
    y = nextY;
  }

  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}

const curve = buildCurve();
curve.arcLengthDivisions = 800;
curve.updateArcLengths();

// 윈도우에서는 기본 선의 두께가 1픽셀로 고정되어 잘 안 보인다.
// 아주 가는 튜브를 얇은 선처럼 써서 길을 눈에 보이게 한다.
const rail = new THREE.Mesh(
  new THREE.TubeGeometry(curve, 500, 0.055, 5, false),
  new THREE.MeshBasicMaterial({ color: 0xfff6e4 })
);
rail.name = '레일';
rail.castShadow = false;
rail.receiveShadow = false;
scene.add(rail);

const pathPoint = new THREE.Vector3();
const pathTangent = new THREE.Vector3();
const pathSide = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

function samplePath(u) {
  const t = THREE.MathUtils.clamp(u, 0, 0.9999);
  curve.getPointAt(t, pathPoint);
  curve.getTangentAt(t, pathTangent);
  pathSide.crossVectors(UP, pathTangent);
  if (pathSide.lengthSq() < 1e-8) pathSide.set(1, 0, 0);
  pathSide.normalize();
}

// 구간 안 진행도 localT(0~1) 위치로 물체를 옮기고, 길이 향하게 돌린다.
// lateral은 길 좌우로 벗어나는 거리다.
function placeOnPath(object, stopIndex, localT, lateral = 0, lift = 0) {
  const u = (stopIndex + THREE.MathUtils.clamp(localT, 0, 1)) / STOP_COUNT;
  samplePath(u);
  object.position.copy(pathPoint);
  object.position.addScaledVector(pathSide, lateral);
  object.position.y += lift;
  lookTarget.copy(object.position).add(pathTangent);
  object.lookAt(lookTarget);
}

// ----- 속도 -----
// speedCurve는 [구간 진행도 0~1, 상대 속도] 목록이다. 사이는 부드럽게 잇는다.
function speedAt(speedCurve, progress) {
  const first = speedCurve[0];
  const last = speedCurve[speedCurve.length - 1];
  if (progress <= first[0]) return first[1];
  if (progress >= last[0]) return last[1];

  for (let i = 0; i < speedCurve.length - 1; i++) {
    const a = speedCurve[i];
    const b = speedCurve[i + 1];
    if (progress < a[0] || progress > b[0]) continue;
    const span = b[0] - a[0] || 1;
    const t = smoothstep((progress - a[0]) / span);
    return a[1] + (b[1] - a[1]) * t;
  }
  return last[1];
}

// 상대 속도는 "어디가 더 빠른지"만 뜻한다.
// 거리/속도로 걸린 시간을 적분한 뒤 0~1로 나눠,
// 빠른 곳은 짧게, 느린 곳은 길게 지나가도 구간 시간과 딱 맞게 한다.
function buildProgressLUT(speedCurve) {
  const steps = 128;
  const cum = [0];
  let acc = 0;
  let prev = Math.max(0.001, speedAt(speedCurve, 0));

  for (let i = 1; i <= steps; i++) {
    const speed = Math.max(0.001, speedAt(speedCurve, i / steps));
    acc += (1 / steps) * 0.5 * (1 / prev + 1 / speed);
    cum.push(acc);
    prev = speed;
  }

  for (let i = 0; i < cum.length; i++) cum[i] /= acc || 1;
  return cum;
}

// 구간 안에서 흐른 시간 비율(0~1)을 길 위의 진행도로 바꾼다.
function progressAtTime(cum, timeFrac) {
  const target = THREE.MathUtils.clamp(timeFrac, 0, 1);
  const steps = cum.length - 1;
  let lo = 0;
  let hi = steps;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }

  if (lo === 0) return 0;
  const span = cum[lo] - cum[lo - 1];
  const f = span > 0 ? (target - cum[lo - 1]) / span : 0;
  return Math.min(1, (lo - 1 + f) / steps);
}

const progressLUTs = stops.map((stop) => buildProgressLUT(stop.speedCurve));

// ----- 자막 -----
// cues에는 시각이 없다. 공백을 뺀 글자 수 비율로 구간 길이를 나눈다.
// 줄과 줄 사이에는 0.4초를 비운다.
function buildCuePlan(cues, duration) {
  const weights = cues.map((cue) => {
    const count = String(cue.text || '').replace(/\s/g, '').length;
    return Math.max(1, count);
  });
  const totalWeight = weights.reduce((sum, n) => sum + n, 0);
  const gapCount = Math.max(0, cues.length - 1);
  let gap = 0.4;
  let budget = duration - gap * gapCount;

  // 구간이 아주 짧으면 쉼을 줄여 자막이 구간 안에 들어가게 한다.
  if (budget < 0.5) {
    gap = gapCount > 0 ? Math.max(0, (duration * 0.15) / gapCount) : 0;
    budget = Math.max(0.1, duration - gap * gapCount);
  }

  let cursor = 0;
  return cues.map((cue, index) => {
    const length = budget * (weights[index] / totalWeight);
    const plan = {
      speaker: cue.speaker,
      text: cue.text,
      start: cursor,
      end: cursor + length,
    };
    cursor += length + gap;
    return plan;
  });
}

// ----- 나중에 넣을 glb -----
const gltfLoader = new GLTFLoader();
const modelPromises = new Map();
const instanceMatrix = new THREE.Matrix4();
const composedMatrix = new THREE.Matrix4();
const swapPos = new THREE.Vector3();
const swapQuat = new THREE.Quaternion();
const swapScale = new THREE.Vector3();

function loadGltf(url) {
  if (!modelPromises.has(url)) {
    const task = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('모델 없음');
        return res.arrayBuffer();
      })
      .then((buffer) => new Promise((resolve, reject) => {
        gltfLoader.parse(buffer, '', resolve, reject);
      }));
    modelPromises.set(url, task);
  }
  return modelPromises.get(url);
}

// glb를 실제로 넣은 경로만 등록한다. 없는 파일을 fetch하면 404가 콘솔에 쌓인다.
const AVAILABLE_MODELS = new Set([
  // 예: '/models/door.glb',
]);

// 경로에 파일이 있으면 자리 표시 도형 대신 그 모델을 넣는다. 없으면 도형을 그대로 둔다.
function tryLoadModel(placeholder, modelPath) {
  placeholder.userData.modelPath = modelPath || '';
  if (!modelPath || !AVAILABLE_MODELS.has(modelPath)) return;

  loadGltf(modelPath)
    .then((gltf) => {
      const parent = placeholder.parent;
      if (!parent) return;
      placeholder.updateMatrix();

      if (placeholder.isInstancedMesh) {
        for (let i = 0; i < placeholder.count; i++) {
          placeholder.getMatrixAt(i, instanceMatrix);
          composedMatrix.multiplyMatrices(placeholder.matrix, instanceMatrix);
          composedMatrix.decompose(swapPos, swapQuat, swapScale);
          const clone = gltf.scene.clone(true);
          clone.name = placeholder.name;
          clone.userData.hint = !!placeholder.userData.hint;
          clone.userData.modelPath = placeholder.userData.modelPath || '';
          clone.position.copy(swapPos);
          clone.quaternion.copy(swapQuat);
          clone.scale.copy(swapScale);
          parent.add(clone);
        }
      } else {
        const clone = gltf.scene.clone(true);
        clone.name = placeholder.name;
        clone.userData.hint = !!placeholder.userData.hint;
        clone.userData.modelPath = placeholder.userData.modelPath || '';
        clone.position.copy(placeholder.position);
        clone.quaternion.copy(placeholder.quaternion);
        clone.scale.copy(placeholder.scale);
        parent.add(clone);
      }

      placeholder.visible = false;
    })
    .catch(() => {
      // 파일이 없거나 깨져 있어도 자리 표시 도형을 유지한다.
    });
}

function makeMaterial(color) {
  const material = new THREE.MeshLambertMaterial({ color });
  return material;
}

function addMesh(parent, geometry, color, name, modelPath, hint = false) {
  const mesh = new THREE.Mesh(geometry, makeMaterial(color));
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  if (hint) mesh.userData.hint = true;
  parent.add(mesh);
  tryLoadModel(mesh, modelPath);
  return mesh;
}

// ----- 구간별 자리 표시 소품 -----
// 구간 그룹을 껐다 켜서, 지금 구간에 필요한 소품만 그린다.
const stopGroups = stops.map((stop) => {
  const group = new THREE.Group();
  group.name = `${stop.id} ${stop.name}`;
  group.visible = stop.id === 0;
  scene.add(group);
  return group;
});

function buildProps() {
  buildIntro(stopGroups[0]);
  buildPrehistory(stopGroups[1]);
  buildThreeKingdoms(stopGroups[2]);
  buildJoseon(stopGroups[3]);
  buildSchool(stopGroups[4]);
  buildPostwar(stopGroups[5]);
  buildCity(stopGroups[6]);
  buildEpilogue(stopGroups[7]);
}

function buildIntro(group) {
  const door = new THREE.Group();
  door.name = '시간의 문';
  const material = makeMaterial(0xf4f7fb);
  const post = 0.48;
  const width = 6.4;
  const height = 7.6;

  const left = new THREE.Mesh(new THREE.BoxGeometry(post, height, 0.55), material);
  left.position.set(-width / 2, height / 2, 0);
  left.name = '문 기둥 왼쪽';

  const right = new THREE.Mesh(new THREE.BoxGeometry(post, height, 0.55), material);
  right.position.set(width / 2, height / 2, 0);
  right.name = '문 기둥 오른쪽';

  const top = new THREE.Mesh(new THREE.BoxGeometry(width + post, post, 0.55), material);
  top.position.set(0, height, 0);
  top.name = '문 상인방';

  const sill = new THREE.Mesh(new THREE.BoxGeometry(width + post, 0.28, 0.7), material);
  sill.position.set(0, 0.14, 0);
  sill.name = '문 문지방';

  door.add(left, right, top, sill);
  group.add(door);
  placeOnPath(door, 0, 0.1, 0, 0);
  tryLoadModel(door, '/models/door.glb');
}

function buildPrehistory(group) {
  const knife = addMesh(
    group,
    new THREE.BoxGeometry(2.4, 0.12, 0.72),
    0xc47a3a,
    '반달돌칼',
    '/models/halfmoon-knife.glb',
    true
  );
  knife.geometry.rotateZ(0.45);
  knife.geometry.rotateX(0.7);
  placeOnPath(knife, 1, 0.24, -6.2, 1.25);

  const spindle = addMesh(
    group,
    new THREE.CylinderGeometry(0.72, 0.72, 0.16, 24),
    0xd7b07a,
    '가락바퀴',
    '/models/spindle-whorl.glb',
    true
  );
  spindle.geometry.rotateX(0.9);
  placeOnPath(spindle, 1, 0.36, 6.4, 1.15);

  const axe = addMesh(
    group,
    new THREE.CylinderGeometry(1.15, 1.15, 0.16, 28),
    0x8d5a32,
    '바퀴날도끼',
    '/models/wheel-axe.glb',
    true
  );
  axe.geometry.rotateX(Math.PI / 2);
  placeOnPath(axe, 1, 0.5, -7.2, 1.35);

  const houseColors = [0x8a6a45, 0x6e8b62, 0xa68455];
  for (let i = 0; i < 4; i++) {
    const house = addMesh(
      group,
      new THREE.ConeGeometry(2.2, 2.5, 16),
      houseColors[i % houseColors.length],
      `움집 ${i + 1}`,
      '/models/pit-house.glb'
    );
    house.geometry.translate(0, 1.25, 0);
    const side = i % 2 === 0 ? 8.2 : -8.6;
    placeOnPath(house, 1, 0.22 + i * 0.14, side, 0);
  }

  const stone = addMesh(
    group,
    new THREE.SphereGeometry(0.62, 20, 16),
    0x9aa3a0,
    '수석',
    '/models/suseok.glb',
    true
  );
  placeOnPath(stone, 1, 0.64, 5.8, 1.05);
}

function buildThreeKingdoms(group) {
  const bottle = new THREE.Group();
  bottle.name = '인화문토기병';
  bottle.userData.hint = true;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.72, 1.7, 20),
    makeMaterial(0x6f8eae)
  );
  body.position.y = 0.85;
  body.name = '토기 몸통';
  const shoulder = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 20, 16),
    makeMaterial(0x8eacc8)
  );
  shoulder.scale.set(1, 1.15, 1);
  shoulder.position.y = 1.85;
  shoulder.name = '토기 어깨';
  bottle.add(body, shoulder);
  group.add(bottle);
  placeOnPath(bottle, 2, 0.3, -6.4, 0);
  tryLoadModel(bottle, '/models/stamped-pottery.glb');

  const seal = addMesh(
    group,
    new THREE.BoxGeometry(1.45, 1.7, 1.45),
    0xc6a15a,
    '큰 도장',
    '/models/seal.glb',
    true
  );
  seal.geometry.translate(0, 0.85, 0);
  placeOnPath(seal, 2, 0.48, 7.2, 0);

  const stone = addMesh(
    group,
    new THREE.SphereGeometry(0.36, 16, 12),
    0xb7c0c4,
    '수석',
    '/models/suseok-small.glb',
    true
  );
  placeOnPath(stone, 2, 0.62, -5.6, 1.2);
}

function buildJoseon(group) {
  const stoneColors = [0x6e6258, 0x8c7564, 0x4e5854, 0xa08b78, 0x7a624c];
  for (let i = 0; i < 5; i++) {
    const stone = addMesh(
      group,
      new THREE.SphereGeometry(0.5, 14, 10),
      stoneColors[i],
      `수석 ${i + 1}`,
      '/models/suseok-irregular.glb',
      true
    );
    stone.geometry.scale(
      0.75 + (i % 3) * 0.28,
      0.55 + (i % 2) * 0.45,
      0.8 + (i % 4) * 0.2
    );
    stone.geometry.rotateY(i * 0.7);
    // 좌우로 번갈아, 조금 멀리 두어 고개를 돌리게 한다.
    const side = (i % 2 === 0 ? 1 : -1) * (5.2 + i * 0.55);
    placeOnPath(stone, 3, 0.18 + i * 0.08, side, 1.05);
  }

  for (let i = 0; i < 5; i++) {
    const relic = addMesh(
      group,
      new THREE.CylinderGeometry(0.18, 0.22, 0.5, 12),
      i % 2 === 0 ? 0xf3efe6 : 0xe7d7c4,
      `화유옹주 유물 ${i + 1}`,
      '/models/hwayu-relic.glb',
      true
    );
    relic.geometry.translate(0, 0.25, 0);
    const side = (i % 2 === 0 ? -1 : 1) * (4.8 + (i % 3) * 0.45);
    placeOnPath(relic, 3, 0.46 + i * 0.04, side, 1.05);
  }

  const jar = addMesh(
    group,
    new THREE.SphereGeometry(0.58, 18, 14),
    0xc47a45,
    '씨앗단지',
    '/models/seed-jar.glb',
    true
  );
  placeOnPath(jar, 3, 0.58, 6.8, 1.1);

  // 구의 위쪽 절반만 써서 가마 지붕처럼 보이게 한다.
  const kiln = addMesh(
    group,
    new THREE.SphereGeometry(2.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    0x8a4032,
    '옹기 가마',
    '/models/kiln.glb'
  );
  placeOnPath(kiln, 3, 0.74, -8.4, 0);
}

function buildSchool(group) {
  const school = addMesh(
    group,
    new THREE.BoxGeometry(16, 7.2, 8),
    0xb48362,
    '학교 건물',
    '/models/school.glb'
  );
  school.geometry.translate(0, 3.6, 0);
  placeOnPath(school, 4, 0.42, 14, 0);

  const bookColors = [0xf4efe2, 0xd9c7a2, 0xc9b79a, 0xefe6d4];
  for (let i = 0; i < 6; i++) {
    const book = addMesh(
      group,
      new THREE.BoxGeometry(0.95, 0.08, 1.25),
      bookColors[i % bookColors.length],
      `교과서 ${i + 1}`,
      '/models/textbook.glb',
      true
    );
    book.geometry.rotateX(-0.65);
    const side = (i % 2 === 0 ? -1 : 1) * (5.4 + (i % 3) * 0.7);
    placeOnPath(book, 4, 0.22 + i * 0.06, side, 1.2);
  }
}

function buildPostwar(group) {
  const count = 42;
  const books = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.42, 0.1, 0.56),
    makeMaterial(0xffffff),
    count
  );
  books.name = '흩어진 책';
  books.castShadow = false;
  books.receiveShadow = false;
  // 책이 원점에서 멀리 흩어져 있어, 화면 밖 판정으로 통째로 사라지지 않게 한다.
  books.frustumCulled = false;
  group.add(books);
  placeOnPath(books, 5, 0.42, 0, 0);

  const dummy = new THREE.Object3D();
  const palette = [0xc2a36b, 0x8c5a3c, 0xd8d0c0, 0x6e7f8a, 0xb7794b];
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // 길 한가운데는 비워서 카메라가 책에 파묻히지 않게 한다.
    let side = (Math.random() - 0.5) * 16;
    if (Math.abs(side) < 2.4) side = side < 0 ? -2.6 : 2.6;
    dummy.position.set(side, 0.06, (Math.random() - 0.5) * 26);
    dummy.rotation.set(Math.random() * 0.5, Math.random() * Math.PI * 2, Math.random() * 0.5);
    dummy.scale.setScalar(0.8 + Math.random() * 0.7);
    dummy.updateMatrix();
    books.setMatrixAt(i, dummy.matrix);
    color.set(palette[i % palette.length]);
    books.setColorAt(i, color);
  }
  books.instanceMatrix.needsUpdate = true;
  if (books.instanceColor) books.instanceColor.needsUpdate = true;
  tryLoadModel(books, '/models/book.glb');

  const tent = addMesh(
    group,
    new THREE.ConeGeometry(3.2, 2.6, 14),
    0xc8b98a,
    '천막',
    '/models/tent.glb'
  );
  tent.geometry.translate(0, 1.3, 0);
  placeOnPath(tent, 5, 0.64, 8.8, 0);

  const card = addMesh(
    group,
    new THREE.BoxGeometry(0.9, 0.045, 1.15),
    0xfff6d8,
    '성적표',
    '/models/report-card.glb',
    true
  );
  card.geometry.rotateX(-0.8);
  placeOnPath(card, 5, 0.3, -6.6, 1.25);
}

function buildCity(group) {
  const aptColors = [0x9aa4ae, 0xb7c0c8, 0x8d97a2, 0xc5ced6];
  for (let i = 0; i < 5; i++) {
    const height = 13 + (i % 3) * 3.5;
    const apt = addMesh(
      group,
      new THREE.BoxGeometry(3.2, height, 3.2),
      aptColors[i % aptColors.length],
      `아파트 ${i + 1}`,
      '/models/apartment.glb'
    );
    apt.geometry.translate(0, height / 2, 0);
    placeOnPath(apt, 6, 0.16 + i * 0.07, i % 2 === 0 ? 9.2 : -9.8, 0);
  }

  const chimney = addMesh(
    group,
    new THREE.CylinderGeometry(0.7, 0.95, 11, 16),
    0x6d5848,
    '굴뚝',
    '/models/chimney.glb'
  );
  chimney.geometry.translate(0, 5.5, 0);
  placeOnPath(chimney, 6, 0.3, -7.4, 0);

  const tree = new THREE.Group();
  tree.name = '느티나무';
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.75, 4.2, 12),
    makeMaterial(0x6b4428)
  );
  trunk.position.y = 2.1;
  trunk.name = '느티나무 줄기';
  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 18, 14),
    makeMaterial(0x2f6b3c)
  );
  crown.position.y = 5.4;
  crown.name = '느티나무 잎';
  tree.add(trunk, crown);
  group.add(tree);
  // 오르막 끝 오른쪽에 두어, 고개를 돌려야 잘 보이게 한다.
  placeOnPath(tree, 6, 0.9, 7.6, 0);
  tryLoadModel(tree, '/models/zelkova.glb');

  const stone = addMesh(
    group,
    new THREE.SphereGeometry(0.55, 16, 12),
    0x8e8a84,
    '수석',
    '/models/suseok.glb',
    true
  );
  placeOnPath(stone, 6, 0.84, -6.2, 1.05);
}

function buildEpilogue(group) {
  const museum = addMesh(
    group,
    new THREE.BoxGeometry(18, 8, 11),
    0xefe6d4,
    '박물관 건물',
    '/models/museum.glb'
  );
  museum.geometry.translate(0, 4, 0);
  placeOnPath(museum, 7, 0.78, 16, 0);

  const relics = [
    {
      geo: new THREE.SphereGeometry(0.55, 18, 14),
      color: 0xf7f1e6,
      name: '기증 유물 자기',
      path: '/models/relic-porcelain.glb',
      t: 0.56,
      side: -6.2,
    },
    {
      geo: new THREE.SphereGeometry(0.48, 16, 12),
      color: 0xb9b3a6,
      name: '기증 유물 수석',
      path: '/models/relic-stone.glb',
      t: 0.64,
      side: 6.8,
    },
    {
      geo: new THREE.BoxGeometry(0.72, 0.06, 0.96),
      color: 0xe4d3a8,
      name: '기증 유물 자료',
      path: '/models/relic-document.glb',
      t: 0.58,
      side: -5.4,
    },
  ];
  const beamColors = [0xffe3a3, 0xfff4cc, 0xf0d2a0];

  relics.forEach((item, index) => {
    const mesh = addMesh(group, item.geo, item.color, item.name, item.path, true);
    if (index === 2) mesh.geometry.rotateX(-0.5);
    placeOnPath(mesh, 7, item.t, item.side, 1.2);

    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.75, 7.2, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: beamColors[index],
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    beam.name = `내리쬐는 빛 ${index + 1}`;
    beam.renderOrder = 2;
    // 원뿔 꼭지가 아래 유물을 향하게 뒤집는다.
    beam.geometry.rotateX(Math.PI);
    beam.geometry.translate(0, 4.1, 0);
    group.add(beam);
    placeOnPath(beam, 7, item.t, item.side, 0);
  });
}

buildProps();

// ----- 조명 전환 -----
const lightNow = {
  color: new THREE.Color(stops[0].light.color),
  fog: new THREE.Color(stops[0].light.fog),
  bg: new THREE.Color(stops[0].light.bg),
  intensity: stops[0].light.intensity,
};
const lightFrom = {
  color: lightNow.color.clone(),
  fog: lightNow.fog.clone(),
  bg: lightNow.bg.clone(),
  intensity: lightNow.intensity,
};
const lightTo = {
  color: lightNow.color.clone(),
  fog: lightNow.fog.clone(),
  bg: lightNow.bg.clone(),
  intensity: lightNow.intensity,
};
let lightMix = 1;

function applyLight() {
  sun.color.copy(lightNow.color);
  sun.intensity = lightNow.intensity;
  ambient.color.copy(lightNow.color);
  scene.background.copy(lightNow.bg);
}

function transitionTo(light) {
  lightFrom.color.copy(lightNow.color);
  lightFrom.fog.copy(lightNow.fog);
  lightFrom.bg.copy(lightNow.bg);
  lightFrom.intensity = lightNow.intensity;
  lightTo.color.set(light.color);
  lightTo.fog.set(light.fog);
  lightTo.bg.set(light.bg);
  lightTo.intensity = light.intensity;
  lightMix = 0;
}

function updateLight(dt) {
  if (lightMix >= 1) return;
  lightMix = Math.min(1, lightMix + dt / 1.5);
  const k = smoothstep(lightMix);
  lightNow.color.copy(lightFrom.color).lerp(lightTo.color, k);
  lightNow.fog.copy(lightFrom.fog).lerp(lightTo.fog, k);
  lightNow.bg.copy(lightFrom.bg).lerp(lightTo.bg, k);
  lightNow.intensity = lightFrom.intensity + (lightTo.intensity - lightFrom.intensity) * k;
  applyLight();
}

applyLight();

// ----- 시대 배경 (레일 진행도 기반) -----
const envManager = new EnvironmentManager({
  scene,
  curve,
  stopCount: STOP_COUNT,
  ambient,
  sun,
});

// ----- 음성 -----
// 파일이 실제로 있으면 그 길이를 쓰고, 없거나 경로가 비어 있으면 durationSec을 쓴다.
function prepareStopAudio(stop) {
  if (!stop.audio) {
    return Promise.resolve({ duration: stop.durationSec, loaded: false, audio: null });
  }

  const audio = new Audio();
  audio.preload = 'auto';
  audio.playsInline = true;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      if (loaded && Number.isFinite(audio.duration) && audio.duration > 0) {
        resolve({ duration: audio.duration, loaded: true, audio });
        return;
      }
      resolve({ duration: stop.durationSec, loaded: false, audio: null });
    };

    const timer = setTimeout(() => finish(false), 8000);
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      finish(true);
    }, { once: true });
    audio.addEventListener('error', () => {
      clearTimeout(timer);
      finish(false);
    }, { once: true });
    audio.src = stop.audio;
  });
}

let audioInfo = stops.map((stop) => ({
  duration: stop.durationSec,
  loaded: false,
  audio: null,
}));
let audioResolved = false;

const audioReady = Promise.all(stops.map((stop) => prepareStopAudio(stop))).then((list) => {
  audioInfo = list;
  audioResolved = true;
  if (!playing) stopDuration = list[0].duration;
  return list;
});

// ----- 라이드 시계 -----
// 프레임을 더하는 대신 실제 시간을 잰다. 그래서 구간 길이가 밀리지 않는다.
let started = false;
let playing = false;
let paused = false;
let finished = false;
let stopIndex = 0;
let stopElapsed = 0;
let stopDuration = stops[0].durationSec;
let clockOn = false;
let clockAnchor = 0;
let cuePlan = [];
let currentAudio = null;
let lastFrame = performance.now();

const camHere = new THREE.Vector3();
const camAhead = new THREE.Vector3();
const camTangent = new THREE.Vector3();
const camLookTarget = new THREE.Vector3();
const LOCAL_X = new THREE.Vector3(1, 0, 0);

function readElapsed() {
  if (!clockOn) return stopElapsed;
  return stopElapsed + (performance.now() - clockAnchor) / 1000;
}

function freezeClock() {
  if (!clockOn) return;
  stopElapsed += (performance.now() - clockAnchor) / 1000;
  clockOn = false;
}

function runClock() {
  if (clockOn) return;
  clockAnchor = performance.now();
  clockOn = true;
}

function showOnlyStop(index) {
  for (let i = 0; i < stopGroups.length; i++) {
    stopGroups[i].visible = i === index;
  }
}

function stopCurrentAudio() {
  if (!currentAudio) return;
  currentAudio.pause();
  try {
    currentAudio.currentTime = 0;
  } catch (err) {
    // 아직 재생 위치를 옮길 수 없으면 그냥 멈춘다.
  }
  currentAudio = null;
}

function beginStop(index, leftover = 0) {
  const stopChanged = index !== lookStopIndex;
  lookStopIndex = index;
  stopIndex = index;
  finished = false;
  const info = audioInfo[index];
  stopDuration = info.duration;
  // 자막은 이 구간의 음성 길이 안에서만 맞춰진다. 구간 사이 공백에는 나오지 않는다.
  cuePlan = buildCuePlan(stops[index].cues, stopDuration);
  showOnlyStop(index);
  transitionTo(stops[index].light);

  freezeClock();
  stopElapsed = Math.max(0, leftover);
  if (playing && !paused) runClock();

  stopCurrentAudio();
  if (info.loaded && info.audio && playing && !paused) {
    currentAudio = info.audio;
    try {
      currentAudio.currentTime = Math.min(leftover, Math.max(0, info.duration - 0.05));
    } catch (err) {
      // 재생 위치를 못 옮겨도 재생은 시도한다.
    }
    currentAudio.play().catch(() => {
      // 재생이 막혀도 자막과 카메라는 계속 간다.
    });
  }

  // 시선만 되돌린다. 구간 길이·자막·음성에는 영향을 주지 않는다.
  if (AUTO_RECENTER_ON_STOP_CHANGE && stopChanged) {
    requestLookRecenter(0.8);
  }
}

function finishRide() {
  if (finished) return;
  finished = true;
  playing = false;
  freezeClock();
  stopElapsed = stopDuration;
  stopCurrentAudio();
  subtitleEl.classList.remove('show');
  draggingLook = false;
  renderer.domElement.classList.remove('dragging');
  hideLookHints();
  window.dispatchEvent(new CustomEvent('ride-complete'));
  replayBtn.hidden = false;
}


// ----- 시선(고개) 회전 -----
// 레일이 정한 정면 위에 yaw/pitch만 얹는다. 카메라 위치와 구간 시계는 그대로다.
const LOOK_YAW_LIMIT = THREE.MathUtils.degToRad(110);
const LOOK_PITCH_MAX = THREE.MathUtils.degToRad(35);
const LOOK_PITCH_MIN = THREE.MathUtils.degToRad(-45);
const LOOK_DEG_PER_PX = 0.18;
const LOOK_DAMP = 12;
const LOOK_KEY_SPEED = THREE.MathUtils.degToRad(55);
const KIOSK_IDLE_RECENTER_SEC = 20;

let lookYaw = 0;
let lookPitch = 0;
let targetYaw = 0;
let targetPitch = 0;
let lookStopIndex = -1;
let lookRecenter = null;
let draggingLook = false;
let lastPointerX = 0;
let lastPointerY = 0;
let lastLookInputAt = performance.now();
const keysLook = {
  left: false,
  right: false,
  up: false,
  down: false,
};

const railLookMatrix = new THREE.Matrix4();
const railLookQuat = new THREE.Quaternion();
const yawQuat = new THREE.Quaternion();
const pitchQuat = new THREE.Quaternion();
const hintWorld = new THREE.Vector3();
const hintCamRight = new THREE.Vector3();
const hintCamForward = new THREE.Vector3();
const hintToObj = new THREE.Vector3();

function lookEnabled() {
  return started && !finished && startBtn.hidden && replayBtn.hidden;
}

function clampLookTargets() {
  targetYaw = THREE.MathUtils.clamp(targetYaw, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT);
  targetPitch = THREE.MathUtils.clamp(targetPitch, LOOK_PITCH_MIN, LOOK_PITCH_MAX);
}

function noteLookInput() {
  lastLookInputAt = performance.now();
}

function requestLookRecenter(durationSec) {
  lookRecenter = {
    fromYaw: lookYaw,
    fromPitch: lookPitch,
    start: performance.now(),
    duration: Math.max(0.05, durationSec) * 1000,
  };
  targetYaw = 0;
  targetPitch = 0;
}

function cancelLookRecenter() {
  lookRecenter = null;
}

function resetLookAngles() {
  lookYaw = 0;
  lookPitch = 0;
  targetYaw = 0;
  targetPitch = 0;
  lookRecenter = null;
  noteLookInput();
}

function isLookUiTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('button, #subtitle, #debug, #hint-left, #hint-right, .ride-btn')
  );
}

function hideLookHints() {
  hintLeftEl.hidden = true;
  hintRightEl.hidden = true;
}

function applyPointerLookDelta(dx, dy) {
  if (!lookEnabled()) return;
  cancelLookRecenter();
  targetYaw -= THREE.MathUtils.degToRad(dx * LOOK_DEG_PER_PX);
  targetPitch -= THREE.MathUtils.degToRad(dy * LOOK_DEG_PER_PX);
  clampLookTargets();
  noteLookInput();
}

function onPointerDown(event) {
  if (!lookEnabled()) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (isLookUiTarget(event.target)) return;
  draggingLook = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  renderer.domElement.classList.add('dragging');
  event.preventDefault();
  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch (err) {
    // 포인터 캡처를 못 해도 드래그는 계속한다.
  }
  noteLookInput();
}

function onPointerMove(event) {
  if (!draggingLook) return;
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  applyPointerLookDelta(dx, dy);
}

function onPointerUp(event) {
  if (!draggingLook) return;
  draggingLook = false;
  renderer.domElement.classList.remove('dragging');
  try {
    renderer.domElement.releasePointerCapture(event.pointerId);
  } catch (err) {
    // 이미 놓인 포인터면 무시한다.
  }
}

function updateLookAngles(dt) {
  if (!lookEnabled()) {
    keysLook.left = keysLook.right = keysLook.up = keysLook.down = false;
    return;
  }

  if (lookRecenter) {
    const t = (performance.now() - lookRecenter.start) / lookRecenter.duration;
    if (t >= 1) {
      lookYaw = 0;
      lookPitch = 0;
      targetYaw = 0;
      targetPitch = 0;
      lookRecenter = null;
    } else {
      const k = smoothstep(t);
      lookYaw = lookRecenter.fromYaw * (1 - k);
      lookPitch = lookRecenter.fromPitch * (1 - k);
      targetYaw = lookYaw;
      targetPitch = lookPitch;
    }
  } else {
    if (keysLook.left) targetYaw += LOOK_KEY_SPEED * dt;
    if (keysLook.right) targetYaw -= LOOK_KEY_SPEED * dt;
    if (keysLook.up) targetPitch += LOOK_KEY_SPEED * dt;
    if (keysLook.down) targetPitch -= LOOK_KEY_SPEED * dt;
    if (keysLook.left || keysLook.right || keysLook.up || keysLook.down) {
      clampLookTargets();
      noteLookInput();
    }

    const blend = 1 - Math.exp(-LOOK_DAMP * dt);
    lookYaw += (targetYaw - lookYaw) * blend;
    lookPitch += (targetPitch - lookPitch) * blend;
  }

  // 키오스크: 한동안 입력이 없으면 정면으로 되돌린다.
  if (kiosk && !lookRecenter && !draggingLook) {
    const idle = (performance.now() - lastLookInputAt) / 1000;
    if (idle >= KIOSK_IDLE_RECENTER_SEC
      && (Math.abs(lookYaw) > 0.01 || Math.abs(lookPitch) > 0.01)) {
      requestLookRecenter(0.8);
    }
  }
}

function updateLookHints() {
  if (!lookEnabled()) {
    hideLookHints();
    return;
  }

  let needLeft = false;
  let needRight = false;
  hintCamRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  hintCamForward.set(0, 0, -1).applyQuaternion(camera.quaternion);

  stopGroups[stopIndex].traverse((obj) => {
    if (!obj.userData || !obj.userData.hint) return;
    if (obj.visible === false) return;
    obj.getWorldPosition(hintWorld);
    hintToObj.copy(hintWorld).sub(camera.position);
    if (hintToObj.lengthSq() < 0.01) return;

    hintWorld.project(camera);
    const inFront = hintToObj.dot(hintCamForward) > 0;
    const onScreen = inFront
      && hintWorld.x >= -1
      && hintWorld.x <= 1
      && hintWorld.y >= -1
      && hintWorld.y <= 1;
    if (onScreen) return;

    if (hintToObj.dot(hintCamRight) < 0) needLeft = true;
    else needRight = true;
  });

  hintLeftEl.hidden = !needLeft;
  hintRightEl.hidden = !needRight;
}

function rideProgress(elapsed) {
  const timeFrac = stopDuration > 0 ? Math.min(1, elapsed / stopDuration) : 0;
  const progress = progressAtTime(progressLUTs[stopIndex], timeFrac);
  // 8개 구간이 길 전체를 똑같이 가진다.
  // 한 구간의 끝과 다음 구간의 시작이 같은 점이라 위치가 튀지 않는다.
  const u = Math.min(1, (stopIndex + progress) / STOP_COUNT);
  return { timeFrac, progress, u };
}

function updateCamera(elapsed) {
  const { u } = rideProgress(elapsed);
  curve.getPointAt(u, camHere);

  if (u + 0.008 >= 1) {
    curve.getTangentAt(0.9999, camTangent);
    camAhead.copy(camHere).addScaledVector(camTangent, 6);
  } else {
    curve.getPointAt(u + 0.008, camAhead);
  }

  // 위치는 레일만 따르고, 시선만 사용자 yaw/pitch를 얹는다.
  camera.position.set(camHere.x, camHere.y + 1.65, camHere.z);
  camLookTarget.set(camAhead.x, camAhead.y + 1.45, camAhead.z);
  railLookMatrix.lookAt(camera.position, camLookTarget, UP);
  railLookQuat.setFromRotationMatrix(railLookMatrix);
  yawQuat.setFromAxisAngle(UP, lookYaw);
  pitchQuat.setFromAxisAngle(LOCAL_X, lookPitch);
  camera.quaternion.copy(railLookQuat).multiply(yawQuat).multiply(pitchQuat);
  return u;
}

function updateSubtitle(elapsed) {
  if (!playing || finished) {
    subtitleEl.classList.remove('show');
    return;
  }

  let active = null;
  for (let i = 0; i < cuePlan.length; i++) {
    const cue = cuePlan[i];
    if (elapsed >= cue.start && elapsed < cue.end) {
      active = cue;
      break;
    }
  }

  if (!active) {
    subtitleEl.classList.remove('show');
    speakerEl.hidden = true;
    speakerEl.textContent = '';
    cueEl.textContent = '';
    return;
  }

  cueEl.textContent = active.text;
  if (active.speaker && active.speaker !== '해설') {
    speakerEl.hidden = false;
    speakerEl.textContent = active.speaker;
  } else {
    speakerEl.hidden = true;
    speakerEl.textContent = '';
  }
  subtitleEl.classList.add('show');
}

function updateDebug(elapsed, u) {
  if (!debug) return;
  const info = audioInfo[stopIndex];
  const env = envManager.debugInfo(u);
  debugEl.textContent =
    `구간 번호: ${stops[stopIndex].id}\n` +
    `경과: ${elapsed.toFixed(1)}초\n` +
    `길이: ${stopDuration.toFixed(1)}초\n` +
    `오디오: ${info && info.loaded ? '로드됨' : '없음'}\n` +
    `u: ${env.u}\n` +
    `env: ${env.active || '-'}\n` +
    `yaw: ${THREE.MathUtils.radToDeg(lookYaw).toFixed(1)}°\n` +
    `pitch: ${THREE.MathUtils.radToDeg(lookPitch).toFixed(1)}°`;
}

function renderFrame(dt) {
  const elapsed = readElapsed();
  updateLookAngles(dt);
  const u = updateCamera(elapsed);
  updateLookHints();
  updateSubtitle(elapsed);
  if (playing && !paused && !document.hidden) updateLight(dt);

  // 배경은 레일 진행도(u)로 상태를 계산한다. 일시정지 시 dt=0 → 애니 정지.
  envManager.update({
    u,
    dt: playing && !paused && !document.hidden ? dt : 0,
    paused: !playing || paused || document.hidden,
    cameraPos: camera.position,
    baseLight: {
      color: lightNow.color,
      intensity: lightNow.intensity,
      fog: lightNow.fog,
      bg: lightNow.bg,
    },
  });

  updateDebug(elapsed, u);
  renderer.render(scene, camera);
}

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (document.hidden) return;

  if (playing && !paused) {
    const elapsed = readElapsed();
    if (elapsed >= stopDuration) {
      if (stopIndex >= STOP_COUNT - 1) {
        freezeClock();
        stopElapsed = stopDuration;
        renderFrame(dt);
        finishRide();
        return;
      }
      // 구간이 끝나면 바로 다음 시대로 이어진다(중간 공백 없음).
      beginStop(stopIndex + 1, elapsed - stopDuration);
    }
  }

  renderFrame(dt);
}

function togglePause() {
  if (!started || finished || !playing) return;
  paused = !paused;
  if (paused) {
    freezeClock();
    currentAudio?.pause();
  } else {
    runClock();
    if (currentAudio) currentAudio.play().catch(() => {});
  }
}

function jumpToStop(index) {
  if (!started || !audioResolved) return;
  if (index < 0 || index >= STOP_COUNT) return;
  paused = false;
  playing = true;
  finished = false;
  replayBtn.hidden = true;
  beginStop(index, 0);
}

function onLookKeyDown(event) {
  if (!lookEnabled()) return;
  switch (event.code) {
    case 'ArrowLeft':
      keysLook.left = true;
      event.preventDefault();
      break;
    case 'ArrowRight':
      keysLook.right = true;
      event.preventDefault();
      break;
    case 'ArrowUp':
      keysLook.up = true;
      event.preventDefault();
      break;
    case 'ArrowDown':
      keysLook.down = true;
      event.preventDefault();
      break;
    case 'Home':
      requestLookRecenter(0.5);
      noteLookInput();
      event.preventDefault();
      break;
    default:
      break;
  }
}

function onLookKeyUp(event) {
  switch (event.code) {
    case 'ArrowLeft':
      keysLook.left = false;
      break;
    case 'ArrowRight':
      keysLook.right = false;
      break;
    case 'ArrowUp':
      keysLook.up = false;
      break;
    case 'ArrowDown':
      keysLook.down = false;
      break;
    default:
      break;
  }
}

window.addEventListener('keydown', onLookKeyDown);
window.addEventListener('keyup', onLookKeyUp);

// 디버그 주소(?debug=1)일 때만 일시정지·구간 점프를 켠다.
if (debug) {
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      togglePause();
      return;
    }
    const isDigit = event.code.startsWith('Digit') || event.code.startsWith('Numpad');
    if (!isDigit) return;
    const digit = event.code.slice(-1);
    if (digit >= '0' && digit <= '7') jumpToStop(Number(digit));
  });
}

const canvasEl = renderer.domElement;
canvasEl.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    freezeClock();
    currentAudio?.pause();
    return;
  }
  if (playing && !paused) {
    runClock();
    if (currentAudio) currentAudio.play().catch(() => {});
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function startRide() {
  if (started) return;
  started = true;
  startBtn.hidden = true;
  startBtn.blur();

  // 클릭 안에서 한 번 재생해 두어, 이후 음성도 브라우저가 막지 않게 한다.
  const unlock = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
  unlock.play().catch(() => {});

  const go = () => {
    lastFrame = performance.now();
    playing = true;
    paused = false;
    finished = false;
    resetLookAngles();
    beginStop(0, 0);
  };

  if (audioResolved) go();
  else audioReady.then(go);
}

startBtn.addEventListener('click', startRide);

replayBtn.addEventListener('click', () => {
  replayBtn.hidden = true;
  replayBtn.blur();
  finished = false;
  playing = true;
  paused = false;
  resetLookAngles();
  beginStop(0, 0);
});

updateCamera(0);
requestAnimationFrame(tick);
