import * as THREE from 'three';
import { Segment } from './Segment.js';
import {
  createBushField,
  createBurialHill,
  createDolmen,
  createFieldPatches,
  createLobbyHall,
  createMountainBillboards,
  createMuseumBlock,
  createParticleField,
  createPitHouse,
  createRiverStrip,
  createTerrainStrip,
  createTimePortal,
  createTransitionHut,
  createWorkshopShed,
} from './primitives.js';
import { createRestEraSegments } from './eraRest.js';
import { clamp01, hash2, orientOnRail, smoothstep } from './utils.js';

const STOP = 1 / 8;

function stopRange(index, a = 0, b = 1) {
  return {
    start: (index + a) * STOP,
    end: (index + b) * STOP,
  };
}

function clearSky(hex, bg, intensity = 1.15) {
  return {
    lightingProfile: { color: hex, intensity },
    fogProfile: { color: hex, near: 250, far: 500, bg },
  };
}

class IntroMuseumExterior extends Segment {
  constructor() {
    const r = stopRange(0, 0, 0.38);
    super({
      id: 'Intro_Museum_Exterior',
      ...r,
      fade: 0.02,
      environmentType: 'museum',
      leftLayout: 'plaza-garden',
      rightLayout: 'facade-wing',
      ...clearSky('#ffffff', '#cfe0ef', 1.4),
    });
  }

  _build(ctx) {
    const { curve } = ctx;

    const main = createMuseumBlock(18, 8, 10, 0xd5dde8);
    orientOnRail(main, curve, this.start + 0.01, -16, 0);
    this.group.add(main);

    const wing = createMuseumBlock(10, 5.5, 7, 0xc8d2e0);
    orientOnRail(wing, curve, this.start + 0.02, 14, 0);
    this.group.add(wing);

    // 좌: 정원 / 우: 진입 동선
    this.group.add(createBushField(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: -1,
      lateral0: 6,
      lateral1: 14,
      count: 28,
      colors: [0x5f8a4e, 0x7aa05c],
      seed: 21,
    }));
    this.group.add(createBushField(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: 1,
      lateral0: 8,
      lateral1: 16,
      count: 18,
      colors: [0x6a9058],
      seed: 22,
    }));

    const plaza = createTerrainStrip(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: -1,
      lateral0: 3,
      lateral1: 12,
      samplesU: 10,
      samplesL: 4,
      heightScale: 0.4,
      color: 0x8fa070,
      seed: 2,
    });
    this.group.add(plaza);

    const pathSide = createTerrainStrip(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: 1,
      lateral0: 3,
      lateral1: 11,
      samplesU: 10,
      samplesL: 4,
      heightScale: 0.25,
      color: 0xa8b090,
      seed: 3,
    });
    this.group.add(pathSide);
  }
}

class IntroMuseumLobby extends Segment {
  constructor() {
    const r = stopRange(0, 0.28, 0.68);
    super({
      id: 'Intro_Museum_Lobby',
      ...r,
      fade: 0.02,
      environmentType: 'museum-interior',
      leftLayout: 'gallery-wall',
      rightLayout: 'gallery-wall',
      ...clearSky('#f2f6ff', '#c2d4e6', 1.2),
    });
  }

  _build(ctx) {
    this.group.add(createLobbyHall(ctx.curve, this.start, this.end));
  }
}

class IntroTimePortal extends Segment {
  constructor() {
    // 도입 후반 ~ 선사 초입: "출발합니다" 시점의 시간이동 터널
    super({
      id: 'Intro_TimePortal',
      start: stopRange(0, 0.45, 1).start,
      end: stopRange(1, 0, 0.12).end,
      fade: 0.015,
      environmentType: 'portal',
      transitionType: 'interior',
      ...clearSky('#c8e0ff', '#8eb8f0', 1.6),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    const portalU = stopRange(0, 0.62, 0.62).start;
    this.group.add(createTimePortal(curve, portalU));
    this._particles = createParticleField(curve, this.start, this.end, 96);
    this.group.add(this._particles);

    // 시간의 문 안쪽 — 선명한 빛 터널(레일을 따라 통과)
    this._rings = [];
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const u = THREE.MathUtils.lerp(portalU, this.end, t);
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color().setHSL(0.58 - t * 0.15, 0.85, 0.55),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        fog: false,
        emissive: new THREE.Color().setHSL(0.58 - t * 0.15, 0.9, 0.35),
        emissiveIntensity: 0.8,
      });
      mat.userData.portalPulse = true;
      mat.userData.baseOpacity = 0.55;
      mat.userData.ringIndex = i;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.6 - t * 1.2, 0.14, 8, 28),
        mat
      );
      orientOnRail(ring, curve, u, 0, 2.2);
      this.group.add(ring);
      this._rings.push(ring);
    }

    // 터널 벽 — 외부를 가리고 시간이동 느낌을 만든다
    const wallMat = new THREE.MeshLambertMaterial({
      color: 0x1a3058,
      fog: false,
      emissive: new THREE.Color(0x102848),
      emissiveIntensity: 0.35,
    });
    for (let i = 0; i < 10; i++) {
      const u = THREE.MathUtils.lerp(portalU, this.end, (i + 0.5) / 10);
      for (const sign of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.5, 2.4), wallMat);
        orientOnRail(panel, curve, u, sign * 4.2, 0);
        panel.position.y += 2.6;
        this.group.add(panel);
      }
    }

    this._coreLight = new THREE.PointLight(0x66aaff, 2.2, 18, 2);
    orientOnRail(this._coreLight, curve, THREE.MathUtils.lerp(portalU, this.end, 0.5), 0, 2.5);
    this.group.add(this._coreLight);
  }

  _update(state) {
    const span = this.end - this.start || 1;
    const local = clamp01((state.u - this.start) / span);
    // 후반("출발합니다")으로 갈수록 연출 강화
    const boost = smoothstep((local - 0.25) / 0.55);

    if (this._particles) {
      if (!this._particleBase) {
        this._particleBase = Float32Array.from(
          this._particles.geometry.attributes.position.array
        );
      }
      const pos = this._particles.geometry.attributes.position;
      const phase = this._particles.geometry.attributes.phase;
      const base = this._particleBase;
      for (let i = 0; i < pos.count; i++) {
        const p = phase.getX(i);
        const swirl = state.time * (1.8 + boost * 3.5) + p;
        pos.setX(i, base[i * 3] + Math.cos(swirl) * (0.15 + boost * 0.35));
        pos.setY(i, base[i * 3 + 1] + Math.sin(state.time * 2.2 + p) * (0.35 + boost * 0.5));
        pos.setZ(i, base[i * 3 + 2] + Math.sin(swirl) * (0.15 + boost * 0.35));
      }
      pos.needsUpdate = true;
      this._particles.material.opacity = 0.55 + boost * 0.4;
      this._particles.material.size = 0.16 + boost * 0.22;
    }

    if (this._rings) {
      for (const ring of this._rings) {
        const mat = ring.material;
        const base = mat.userData.baseOpacity ?? 0.55;
        mat.opacity = base * (0.7 + 0.3 * Math.sin(state.time * (2.5 + boost * 2) + mat.userData.ringIndex));
        mat.emissiveIntensity = 0.55 + boost * 1.1;
        ring.rotation.z = state.time * (0.4 + boost * 1.2) * (mat.userData.ringIndex % 2 ? 1 : -1);
      }
    }

    if (this._coreLight) {
      this._coreLight.intensity = 1.2 + boost * 2.8 + Math.sin(state.time * 4) * 0.3;
    }
  }

  sampleAtmosphere(u) {
    const base = super.sampleAtmosphere(u);
    if (!base) return null;
    const span = this.end - this.start || 1;
    const local = clamp01((u - this.start) / span);
    const boost = smoothstep((local - 0.2) / 0.6);
    base.light = {
      color: '#a8d0ff',
      intensity: 1.3 + boost * 0.8,
    };
    base.fog = {
      color: '#8eb8f0',
      near: 250,
      far: 500,
      bg: boost > 0.5 ? '#6a9ae0' : '#9ec4f0',
    };
    return base;
  }
}

class PrehistoricRiverMountains extends Segment {
  constructor() {
    const r = stopRange(1, 0, 0.48);
    super({
      id: 'Prehistoric_RiverMountains',
      ...r,
      fade: 0.025,
      environmentType: 'nature',
      leftLayout: 'river-close',
      rightLayout: 'mountains-close',
      ...clearSky('#ffd37a', '#e8c98a', 1.25),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    const u0 = this.start;
    const u1 = this.end + 0.03;

    // 좌: 강이 가깝고 산은 멀다
    this.group.add(createRiverStrip(curve, {
      u0, u1, sideSign: -1, lateral: 7.5, width: 5.5, color: 0x4a8fb8,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0, u1, sideSign: -1, lateral0: 3, lateral1: 18,
      heightScale: 1.6, color: 0x6f8f55, seed: 10,
    }));
    this.group.add(createMountainBillboards(curve, {
      u0, u1, sideSign: -1, lateral: 28, count: 6,
      color: 0x7a8a78, heightMin: 8, heightMax: 16, seed: 4,
    }));
    this.group.add(createBushField(curve, {
      u0, u1, sideSign: -1, lateral0: 4, lateral1: 12, count: 36, seed: 30,
    }));

    // 우: 산이 가깝고 강은 조금 멀다
    this.group.add(createMountainBillboards(curve, {
      u0, u1, sideSign: 1, lateral: 16, count: 9,
      color: 0x6e7d6c, heightMin: 12, heightMax: 24, seed: 5,
    }));
    this.group.add(createRiverStrip(curve, {
      u0, u1, sideSign: 1, lateral: 11, width: 3.8, color: 0x3f7fa8,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0, u1, sideSign: 1, lateral0: 3.5, lateral1: 20,
      heightScale: 2.8, color: 0x62824a, seed: 11,
    }));
    this.group.add(createBushField(curve, {
      u0, u1, sideSign: 1, lateral0: 5, lateral1: 14, count: 24, seed: 31,
    }));
  }

  _update(state) {
    if (state.dt <= 0) return;
    this.group.traverse((obj) => {
      if (!obj.material?.userData?.riverScroll) return;
      const mat = obj.material;
      if (!mat.map) {
        // UV 오프셋 흉내: emissive 미세 변화
        const pulse = 0.92 + 0.08 * Math.sin(state.time * 1.4);
        mat.opacity = (mat.userData.baseOpacity ?? 0.72) * this._weight * pulse;
      }
    });
  }
}

class PrehistoricVillageStart extends Segment {
  constructor() {
    const r = stopRange(1, 0.32, 0.72);
    super({
      id: 'Prehistoric_PitHouseVillage_Start',
      ...r,
      fade: 0.03,
      environmentType: 'village-edge',
      leftLayout: 'dwellings',
      rightLayout: 'fields-rocks',
      ...clearSky('#ffc86a', '#e2c080', 1.2),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    const houses = [
      { t: 0.15, side: -1, lat: 8.5, s: 1.0 },
      { t: 0.4, side: -1, lat: 10.2, s: 0.85 },
      { t: 0.65, side: -1, lat: 7.8, s: 1.1 },
      { t: 0.3, side: 1, lat: 11.5, s: 0.9 },
    ];
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      const hut = createPitHouse(h.s, {
        wall: i % 2 ? 0x8a6a45 : 0x6e8b62,
        roof: 0x5c4634,
      });
      const u = THREE.MathUtils.lerp(this.start, this.end, h.t);
      orientOnRail(hut, curve, u, h.side * h.lat, 0);
      hut.rotation.y += hash2(i, 7) * 0.6;
      this.group.add(hut);
    }

    this.group.add(createFieldPatches(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: 1,
      lateral: 9,
      count: 5,
      color: 0xc2a85a,
      seed: 40,
    }));
    this.group.add(createBushField(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: -1,
      lateral0: 5,
      lateral1: 13,
      count: 20,
      seed: 41,
    }));

    // 바위
    for (let i = 0; i < 8; i++) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.5 + hash2(i, 1) * 0.6, 0),
        new THREE.MeshLambertMaterial({ color: 0x8a8580 })
      );
      rock.material.userData.envFade = true;
      rock.material.userData.baseOpacity = 1;
      const u = THREE.MathUtils.lerp(this.start, this.end, hash2(i, 2));
      const side = i % 2 === 0 ? -1 : 1;
      orientOnRail(rock, curve, u, side * (5 + hash2(i, 3) * 4), 0.2);
      this.group.add(rock);
    }
  }
}

class PrehistoricVillageCore extends Segment {
  constructor() {
    const r = stopRange(1, 0.55, 0.92);
    super({
      id: 'Prehistoric_PitHouseVillage_Core',
      ...r,
      fade: 0.028,
      environmentType: 'village-core',
      leftLayout: 'residential',
      rightLayout: 'ritual-fields',
      ...clearSky('#ffb85a', '#dcb870', 1.15),
    });
  }

  _build(ctx) {
    const { curve } = ctx;

    // 좌: 주거 밀집
    for (let i = 0; i < 7; i++) {
      const hut = createPitHouse(0.85 + hash2(i, 1) * 0.35, {
        wall: 0x8a6a45,
        roof: 0x4f3a2a,
      });
      const u = THREE.MathUtils.lerp(this.start, this.end, (i + 0.2) / 7);
      const lat = 7.5 + (i % 3) * 1.4;
      orientOnRail(hut, curve, u, -lat, 0);
      hut.rotation.y += (i % 2 ? 0.4 : -0.3);
      this.group.add(hut);
    }

    // 우: 제사·밭·고인돌
    for (let i = 0; i < 4; i++) {
      const hut = createPitHouse(0.9, { wall: 0x6e8b62, roof: 0x455538 });
      const u = THREE.MathUtils.lerp(this.start, this.end, (i + 0.3) / 4);
      orientOnRail(hut, curve, u, 9 + i * 0.6, 0);
      this.group.add(hut);
    }

    const dolmen = createDolmen(1.35);
    orientOnRail(dolmen, curve, THREE.MathUtils.lerp(this.start, this.end, 0.55), 12.5, 0);
    this.group.add(dolmen);

    // 제단
    const altar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.8, 0.35, 8),
      new THREE.MeshLambertMaterial({ color: 0x7a7268 })
    );
    altar.material.userData.envFade = true;
    altar.material.userData.baseOpacity = 1;
    orientOnRail(altar, curve, THREE.MathUtils.lerp(this.start, this.end, 0.7), 11, 0.2);
    this.group.add(altar);

    this.group.add(createFieldPatches(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: 1,
      lateral: 14,
      count: 6,
      color: 0xb89a4e,
      seed: 55,
    }));

    this.group.add(createTerrainStrip(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: -1,
      lateral0: 4,
      lateral1: 16,
      heightScale: 0.9,
      color: 0x6a8448,
      seed: 56,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: 1,
      lateral0: 4,
      lateral1: 17,
      heightScale: 1.1,
      color: 0x748c52,
      seed: 57,
    }));
  }
}

class PrehistoricHutTransition extends Segment {
  constructor() {
    // 선사 끝 → 삼국 초에 걸쳐 레일이 움집 내부를 통과
    super({
      id: 'Prehistoric_Transition_HutInterior',
      start: stopRange(1, 0.86, 1).start,
      end: stopRange(2, 0, 0.12).end,
      fade: 0.012,
      environmentType: 'transition',
      transitionType: 'interior',
      leftLayout: 'occluded',
      rightLayout: 'occluded',
      lightingProfile: { color: '#5a3a22', intensity: 0.45 },
      fogProfile: { color: '#1a120c', near: 250, far: 500, bg: '#120c08' },
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    const mid = (this.start + this.end) * 0.5;
    this._hut = createTransitionHut(16, 5.4, 4.4);
    orientOnRail(this._hut, curve, mid, 0, 0);
    this.group.add(this._hut);

    // 입구 안내 움집 형태(외부에서 보이게)
    const deco = createPitHouse(1.6, { wall: 0x6a4e38, roof: 0x3d2c20 });
    orientOnRail(deco, curve, this.start + 0.004, -0.2, 0);
    deco.scale.z *= 0.2;
    deco.visible = true;
    this.group.add(deco);

    // 내부 점광 — 완전한 블랙 컷 대신 음영
    this._ember = new THREE.PointLight(0xff9340, 0.8, 10, 2);
    this._ember.position.set(0, 1.6, 0);
    this._hut.add(this._ember);
  }

  _update(state) {
    if (!this._ember) return;
    // 진행도 기반: 중반에 가장 어둡고, 출구에서 풀린다
    const span = this.end - this.start || 1;
    const local = smoothstep((state.u - this.start) / span);
    const interior = Math.sin(local * Math.PI); // 0→1→0
    this._ember.intensity = 0.35 + interior * 0.9;
    if (state.dt > 0) {
      this._ember.intensity += Math.sin(state.time * 3.5) * 0.05;
    }
  }

  sampleAtmosphere(u) {
    const base = super.sampleAtmosphere(u);
    if (!base) return null;
    const span = this.end - this.start || 1;
    const local = clamp01((u - this.start) / span);
    const interior = Math.sin(local * Math.PI);
    base.transitionBoost = interior;
    base.fog = {
      ...base.fog,
      near: 250,
      far: 500,
      bg: interior > 0.35 ? '#120c08' : base.fog.bg,
    };
    base.light = {
      ...base.light,
      intensity: THREE.MathUtils.lerp(0.85, 0.4, interior),
    };
    return base;
  }
}

class ThreeKingdomsBurialHill extends Segment {
  constructor() {
    const r = stopRange(2, 0.05, 0.55);
    super({
      id: 'ThreeKingdoms_BurialHill',
      ...r,
      fade: 0.025,
      environmentType: 'burial',
      leftLayout: 'stone-tombs',
      rightLayout: 'workshop-hill',
      ...clearSky('#b9d4ff', '#a9bfdc', 1.15),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    this.group.add(createBurialHill(curve, THREE.MathUtils.lerp(this.start, this.end, 0.25), -1, 11));
    this.group.add(createBurialHill(curve, THREE.MathUtils.lerp(this.start, this.end, 0.55), -1, 13));
    this.group.add(createWorkshopShed(curve, THREE.MathUtils.lerp(this.start, this.end, 0.4), 1, 10));
    this.group.add(createWorkshopShed(curve, THREE.MathUtils.lerp(this.start, this.end, 0.7), 1, 12));

    this.group.add(createTerrainStrip(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: -1,
      lateral0: 3.5,
      lateral1: 18,
      heightScale: 2.2,
      color: 0x6a7a58,
      seed: 70,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: 1,
      lateral0: 3.5,
      lateral1: 17,
      heightScale: 1.6,
      color: 0x5e7350,
      seed: 71,
    }));
    this.group.add(createBushField(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: -1,
      lateral0: 5,
      lateral1: 12,
      count: 22,
      colors: [0x4a6a40, 0x5c7a4a],
      seed: 72,
    }));
    this.group.add(createMountainBillboards(curve, {
      u0: this.start,
      u1: this.end,
      sideSign: 1,
      lateral: 26,
      count: 5,
      color: 0x6a7880,
      heightMin: 9,
      heightMax: 16,
      seed: 73,
    }));
  }
}

export function createPhaseOneSegments() {
  return [
    new IntroMuseumExterior(),
    new IntroMuseumLobby(),
    new IntroTimePortal(),
    new PrehistoricRiverMountains(),
    new PrehistoricVillageStart(),
    new PrehistoricVillageCore(),
    new PrehistoricHutTransition(),
    new ThreeKingdomsBurialHill(),
    ...createRestEraSegments(),
  ];
}
