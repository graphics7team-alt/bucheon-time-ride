import * as THREE from 'three';
import { Segment } from './Segment.js';
import {
  createApartment,
  createBushField,
  createChimneyStack,
  createDisplayCase,
  createFieldPatches,
  createHanok,
  createMountainBillboards,
  createMuseumBlock,
  createOnggiJar,
  createPeachTree,
  createSchoolBuilding,
  createTentClassroom,
  createTerrainStrip,
  createTransitionCorridor,
  createTransitionHut,
  createWorkshopShed,
  createZelkova,
} from './primitives.js';
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

class InteriorTransition extends Segment {
  constructor(config) {
    super({
      fade: 0.012,
      environmentType: 'transition',
      transitionType: 'interior',
      ...config,
    });
    this._style = config.corridorStyle || 'hut';
  }

  _build(ctx) {
    const { curve } = ctx;
    const mid = (this.start + this.end) * 0.5;
    this._tunnel = this._style === 'hut'
      ? createTransitionHut(15, 5.2, 4.2)
      : createTransitionCorridor(15, 4.8, 3.8, this._palette || {});
    orientOnRail(this._tunnel, curve, mid, 0, 0);
    this.group.add(this._tunnel);
    this._lamp = new THREE.PointLight(0xffb070, 0.9, 12, 2);
    this._lamp.position.set(0, 1.8, 0);
    this._tunnel.add(this._lamp);
  }

  _update(state) {
    if (!this._lamp) return;
    const span = this.end - this.start || 1;
    const local = smoothstep((state.u - this.start) / span);
    const interior = Math.sin(local * Math.PI);
    this._lamp.intensity = 0.4 + interior * 1.0;
  }

  sampleAtmosphere(u) {
    const base = super.sampleAtmosphere(u);
    if (!base) return null;
    const span = this.end - this.start || 1;
    const local = clamp01((u - this.start) / span);
    const interior = Math.sin(local * Math.PI);
    base.light = {
      ...base.light,
      intensity: THREE.MathUtils.lerp(0.85, 0.35, interior),
    };
    // 배경만 어둡게 — 거리 안개로 흐리게 만들지 않는다
    base.fog = {
      ...base.fog,
      near: 250,
      far: 500,
      bg: interior > 0.35 ? '#1a1410' : base.fog.bg,
    };
    return base;
  }
}

export class ThreeKingdomsWorkshop extends Segment {
  constructor() {
    const r = stopRange(2, 0.4, 0.92);
    super({
      id: 'ThreeKingdoms_Workshop',
      ...r,
      fade: 0.025,
      environmentType: 'workshop',
      leftLayout: 'learning-hall',
      rightLayout: 'pottery-yard',
      ...clearSky('#b9d4ff', '#a9bfdc', 1.15),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    for (let i = 0; i < 4; i++) {
      const hall = createHanok(0.85, { wall: 0xe8e0d0, roof: 0x4a5560, wood: 0x6a5040 });
      const u = THREE.MathUtils.lerp(this.start, this.end, (i + 0.2) / 4);
      orientOnRail(hall, curve, u, -9 - (i % 2), 0);
      this.group.add(hall);
    }
    for (let i = 0; i < 3; i++) {
      this.group.add(createWorkshopShed(
        curve,
        THREE.MathUtils.lerp(this.start, this.end, (i + 0.3) / 3),
        1,
        9 + i
      ));
    }
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3, lateral1: 16,
      heightScale: 1.4, color: 0x6a7a58, seed: 80,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3, lateral1: 15,
      heightScale: 1.2, color: 0x5e7350, seed: 81,
    }));
    this.group.add(createBushField(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 5, lateral1: 12, count: 18, seed: 82,
    }));
  }
}

export class ThreeKingdomsToJoseonGate extends InteriorTransition {
  constructor() {
    super({
      id: 'ThreeKingdoms_Transition_StoneHall',
      start: stopRange(2, 0.88, 1).start,
      end: stopRange(3, 0, 0.1).end,
      lightingProfile: { color: '#8aa0c0', intensity: 0.45 },
      fogProfile: { color: '#1a2030', near: 250, far: 500, bg: '#141820' },
      corridorStyle: 'corridor',
      _palette: { wall: 0x6a7080, dark: 0x1a1e28, roof: 0x3a4050 },
    });
    this._palette = { wall: 0x6a7080, dark: 0x1a1e28, roof: 0x3a4050 };
  }
}

export class JoseonSarangbang extends Segment {
  constructor() {
    const r = stopRange(3, 0.05, 0.4);
    super({
      id: 'Joseon_Sarangbang',
      ...r,
      fade: 0.022,
      environmentType: 'joseon',
      leftLayout: 'sarangbang',
      rightLayout: 'garden-stones',
      ...clearSky('#ffc078', '#f0d0a0', 1.05),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    for (let i = 0; i < 3; i++) {
      const house = createHanok(1.0, { wall: 0xf5ead8, roof: 0x3a3834 });
      orientOnRail(house, curve, THREE.MathUtils.lerp(this.start, this.end, (i + 0.25) / 3), -10, 0);
      this.group.add(house);
    }
    for (let i = 0; i < 6; i++) {
      const stone = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.45 + hash2(i, 1) * 0.4, 0),
        new THREE.MeshLambertMaterial({ color: 0x8c7564, fog: false })
      );
      orientOnRail(
        stone,
        curve,
        THREE.MathUtils.lerp(this.start, this.end, hash2(i, 2)),
        (i % 2 ? 1 : -1) * (6 + hash2(i, 3) * 3),
        0.3
      );
      this.group.add(stone);
    }
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3, lateral1: 15,
      heightScale: 0.8, color: 0x7a8a55, seed: 90,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3, lateral1: 14,
      heightScale: 0.7, color: 0x6f8448, seed: 91,
    }));
  }
}

export class JoseonRoyalAndOnggi extends Segment {
  constructor() {
    const r = stopRange(3, 0.32, 0.9);
    super({
      id: 'Joseon_RoyalRoom_OnggiVillage',
      ...r,
      fade: 0.025,
      environmentType: 'joseon',
      leftLayout: 'royal-hall',
      rightLayout: 'onggi-village',
      ...clearSky('#ffb36b', '#e8c090', 1.0),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    const palace = createHanok(1.35, { wall: 0xf8f0e0, roof: 0x2a2824, wood: 0x8b1a1a });
    orientOnRail(palace, curve, THREE.MathUtils.lerp(this.start, this.end, 0.25), -12, 0);
    this.group.add(palace);

    const school = createHanok(1.1, { wall: 0xf0e6d4, roof: 0x403830 });
    orientOnRail(school, curve, THREE.MathUtils.lerp(this.start, this.end, 0.45), -11, 0);
    this.group.add(school);

    for (let i = 0; i < 5; i++) {
      const hut = createHanok(0.7, { wall: 0xe8d8c0, roof: 0x5a4030 });
      orientOnRail(hut, curve, THREE.MathUtils.lerp(this.start, this.end, 0.5 + i * 0.08), 9 + (i % 2), 0);
      this.group.add(hut);
    }
    for (let i = 0; i < 12; i++) {
      const jar = createOnggiJar(0.7 + hash2(i, 1) * 0.5);
      orientOnRail(
        jar,
        curve,
        THREE.MathUtils.lerp(this.start, this.end, 0.55 + hash2(i, 2) * 0.35),
        7 + hash2(i, 3) * 4,
        0
      );
      this.group.add(jar);
    }
    const kiln = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x8a4032, fog: false })
    );
    orientOnRail(kiln, curve, THREE.MathUtils.lerp(this.start, this.end, 0.78), 11, 0);
    this.group.add(kiln);

    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3.5, lateral1: 16,
      heightScale: 0.9, color: 0x6a7a48, seed: 92,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3.5, lateral1: 16,
      heightScale: 1.0, color: 0x748850, seed: 93,
    }));
  }
}

export class JoseonToSchoolGate extends InteriorTransition {
  constructor() {
    super({
      id: 'Joseon_Transition_BuildingInterior',
      start: stopRange(3, 0.88, 1).start,
      end: stopRange(4, 0, 0.1).end,
      lightingProfile: { color: '#6a4a30', intensity: 0.4 },
      fogProfile: { color: '#1a120c', near: 250, far: 500, bg: '#120c08' },
      corridorStyle: 'corridor',
    });
    this._palette = { wall: 0x6b4423, dark: 0x1a120c, roof: 0x3d2c20 };
  }
}

export class ModernSchoolExterior extends Segment {
  constructor() {
    const r = stopRange(4, 0.05, 0.55);
    super({
      id: 'ModernSchool_Exterior',
      ...r,
      fade: 0.022,
      environmentType: 'school',
      leftLayout: 'classroom-wing',
      rightLayout: 'playground',
      ...clearSky('#ffe3b0', '#d4c8a8', 1.15),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    const school = createSchoolBuilding(1.0);
    orientOnRail(school, curve, THREE.MathUtils.lerp(this.start, this.end, 0.35), -13, 0);
    this.group.add(school);
    const school2 = createSchoolBuilding(0.75);
    orientOnRail(school2, curve, THREE.MathUtils.lerp(this.start, this.end, 0.65), 14, 0);
    this.group.add(school2);

    this.group.add(createFieldPatches(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral: 8, count: 4, color: 0x6a9a4a, seed: 100,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3, lateral1: 16,
      heightScale: 0.5, color: 0x7a8a58, seed: 101,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3, lateral1: 15,
      heightScale: 0.4, color: 0x6f9050, seed: 102,
    }));
    this.group.add(createBushField(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 5, lateral1: 11, count: 16, seed: 103,
    }));
  }
}

export class ColonialClassroom extends Segment {
  constructor() {
    const r = stopRange(4, 0.45, 0.92);
    super({
      id: 'Colonial_Classroom',
      ...r,
      fade: 0.025,
      environmentType: 'colonial',
      leftLayout: 'desks',
      rightLayout: 'yard-gate',
      ...clearSky('#d8c8a0', '#b0a488', 0.85),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    const school = createSchoolBuilding(0.9);
    orientOnRail(school, curve, THREE.MathUtils.lerp(this.start, this.end, 0.4), -12, 0);
    this.group.add(school);

    for (let i = 0; i < 8; i++) {
      const desk = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.55, 0.7),
        new THREE.MeshLambertMaterial({ color: 0x8a6a45, fog: false })
      );
      orientOnRail(
        desk,
        curve,
        THREE.MathUtils.lerp(this.start, this.end, 0.2 + i * 0.08),
        (i % 2 ? -1 : 1) * (6.5 + (i % 3) * 0.4),
        0.3
      );
      this.group.add(desk);
    }
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3, lateral1: 14,
      heightScale: 0.4, color: 0x6a7050, seed: 110,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3, lateral1: 14,
      heightScale: 0.35, color: 0x627048, seed: 111,
    }));
  }
}

export class SchoolToLiberationGate extends InteriorTransition {
  constructor() {
    super({
      id: 'Colonial_Transition_Hallway',
      start: stopRange(4, 0.88, 1).start,
      end: stopRange(5, 0, 0.1).end,
      lightingProfile: { color: '#5a5040', intensity: 0.4 },
      fogProfile: { color: '#1a1810', near: 250, far: 500, bg: '#12100c' },
      corridorStyle: 'corridor',
    });
    this._palette = { wall: 0x8a7060, dark: 0x1a1410, roof: 0x4a4038 };
  }
}

export class LiberationTentSchool extends Segment {
  constructor() {
    const r = stopRange(5, 0.05, 0.92);
    super({
      id: 'Liberation_TentSchool',
      ...r,
      fade: 0.022,
      environmentType: 'liberation',
      leftLayout: 'tent-class',
      rightLayout: 'open-air-class',
      ...clearSky('#fff4d6', '#d9d2bd', 1.25),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    for (let i = 0; i < 5; i++) {
      const tent = createTentClassroom(0.9 + hash2(i, 1) * 0.3);
      orientOnRail(tent, curve, THREE.MathUtils.lerp(this.start, this.end, (i + 0.2) / 5), -8 - (i % 2), 0);
      this.group.add(tent);
    }
    for (let i = 0; i < 4; i++) {
      const tent = createTentClassroom(0.8);
      orientOnRail(tent, curve, THREE.MathUtils.lerp(this.start, this.end, (i + 0.3) / 4), 9 + i * 0.4, 0);
      this.group.add(tent);
    }
    // 학교 간판
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(4.5, 1.2, 0.2),
      new THREE.MeshLambertMaterial({ color: 0xf4efe2, fog: false })
    );
    orientOnRail(sign, curve, THREE.MathUtils.lerp(this.start, this.end, 0.15), -6, 2.2);
    this.group.add(sign);

    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3, lateral1: 15,
      heightScale: 0.55, color: 0x8a8a60, seed: 120,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3, lateral1: 15,
      heightScale: 0.5, color: 0x808858, seed: 121,
    }));
    this.group.add(createBushField(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 5, lateral1: 12, count: 14, seed: 122,
    }));
  }
}

export class LiberationToModernGate extends InteriorTransition {
  constructor() {
    super({
      id: 'Liberation_Transition_TentInterior',
      start: stopRange(5, 0.88, 1).start,
      end: stopRange(6, 0, 0.1).end,
      lightingProfile: { color: '#6a5a40', intensity: 0.4 },
      fogProfile: { color: '#1a1610', near: 250, far: 500, bg: '#12100c' },
      corridorStyle: 'hut',
    });
  }
}

export class ModernCityGrowth extends Segment {
  constructor() {
    const r = stopRange(6, 0.05, 0.55);
    super({
      id: 'Modern_CityGrowth',
      ...r,
      fade: 0.022,
      environmentType: 'modern',
      leftLayout: 'peach-orchard',
      rightLayout: 'factories',
      ...clearSky('#ffd9a0', '#e0c29a', 1.2),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    for (let i = 0; i < 10; i++) {
      const tree = createPeachTree(0.8 + hash2(i, 1) * 0.4);
      orientOnRail(
        tree,
        curve,
        THREE.MathUtils.lerp(this.start, this.end, hash2(i, 2)),
        - (6 + hash2(i, 3) * 6),
        0
      );
      this.group.add(tree);
    }
    for (let i = 0; i < 4; i++) {
      const stack = createChimneyStack(0.9 + i * 0.1);
      orientOnRail(stack, curve, THREE.MathUtils.lerp(this.start, this.end, 0.2 + i * 0.18), 12 + i, 0);
      this.group.add(stack);
    }
    for (let i = 0; i < 3; i++) {
      const apt = createApartment(0.7 + i * 0.15);
      orientOnRail(apt, curve, THREE.MathUtils.lerp(this.start, this.end, 0.35 + i * 0.2), 16 + i * 2, 0);
      this.group.add(apt);
    }
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3, lateral1: 16,
      heightScale: 0.6, color: 0x6a8a48, seed: 130,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3, lateral1: 18,
      heightScale: 0.5, color: 0x7a7a68, seed: 131,
    }));
  }
}

export class ModernParkTree extends Segment {
  constructor() {
    const r = stopRange(6, 0.45, 0.92);
    super({
      id: 'Modern_ParkTree',
      ...r,
      fade: 0.025,
      environmentType: 'park',
      leftLayout: 'prehistoric-park',
      rightLayout: 'zelkova',
      ...clearSky('#ffe0a8', '#e8cfa8', 1.15),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    for (let i = 0; i < 3; i++) {
      const apt = createApartment(0.85);
      orientOnRail(apt, curve, THREE.MathUtils.lerp(this.start, this.end, 0.15 + i * 0.15), -14, 0);
      this.group.add(apt);
    }
    const zelkova = createZelkova(1.4);
    orientOnRail(zelkova, curve, THREE.MathUtils.lerp(this.start, this.end, 0.55), 11, 0);
    this.group.add(zelkova);
    const zelkova2 = createZelkova(1.1);
    orientOnRail(zelkova2, curve, THREE.MathUtils.lerp(this.start, this.end, 0.75), -10, 0);
    this.group.add(zelkova2);

    // 선사유적공원 느낌의 움집 복원
    for (let i = 0; i < 3; i++) {
      const hut = createHanok(0.55, { wall: 0x8a6a45, roof: 0x5c4634, wood: 0x4a3828 });
      orientOnRail(hut, curve, THREE.MathUtils.lerp(this.start, this.end, 0.4 + i * 0.12), -8, 0);
      this.group.add(hut);
    }

    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3, lateral1: 15,
      heightScale: 0.7, color: 0x5f8a4e, seed: 140,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3, lateral1: 15,
      heightScale: 0.65, color: 0x6a9058, seed: 141,
    }));
    this.group.add(createBushField(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 5, lateral1: 12, count: 20, seed: 142,
    }));
    this.group.add(createMountainBillboards(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral: 24, count: 4,
      color: 0x7a8a78, heightMin: 8, heightMax: 14, seed: 143,
    }));
  }
}

export class ModernToEpilogueGate extends InteriorTransition {
  constructor() {
    super({
      id: 'Modern_Transition_MuseumEntry',
      start: stopRange(6, 0.88, 1).start,
      end: stopRange(7, 0, 0.1).end,
      lightingProfile: { color: '#d0d8e8', intensity: 0.55 },
      fogProfile: { color: '#c8d0e0', near: 250, far: 500, bg: '#b8c4d8' },
      corridorStyle: 'corridor',
    });
    this._palette = { wall: 0xd5dde8, dark: 0xc0c8d4, roof: 0xe8eef5 };
  }
}

export class EpilogueMuseumHall extends Segment {
  constructor() {
    const r = stopRange(7, 0.05, 1.0);
    super({
      id: 'Epilogue_MuseumHall',
      ...r,
      fade: 0.02,
      environmentType: 'epilogue',
      leftLayout: 'galleries',
      rightLayout: 'donor-hall',
      ...clearSky('#fff1d0', '#e6dcc4', 1.05),
    });
  }

  _build(ctx) {
    const { curve } = ctx;
    const main = createMuseumBlock(20, 9, 12, 0xd8e0ec);
    orientOnRail(main, curve, THREE.MathUtils.lerp(this.start, this.end, 0.35), -15, 0);
    this.group.add(main);
    const wing = createMuseumBlock(12, 7, 8, 0xc8d2e0);
    orientOnRail(wing, curve, THREE.MathUtils.lerp(this.start, this.end, 0.55), 14, 0);
    this.group.add(wing);

    for (let i = 0; i < 6; i++) {
      const cse = createDisplayCase(1.0);
      orientOnRail(
        cse,
        curve,
        THREE.MathUtils.lerp(this.start, this.end, 0.2 + i * 0.1),
        (i % 2 ? 1 : -1) * (6.5 + (i % 3) * 0.5),
        0
      );
      this.group.add(cse);
    }

    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 3, lateral1: 14,
      heightScale: 0.3, color: 0x8fa070, seed: 150,
    }));
    this.group.add(createTerrainStrip(curve, {
      u0: this.start, u1: this.end, sideSign: 1, lateral0: 3, lateral1: 14,
      heightScale: 0.3, color: 0x8aa068, seed: 151,
    }));
    this.group.add(createBushField(curve, {
      u0: this.start, u1: this.end, sideSign: -1, lateral0: 5, lateral1: 11, count: 12, seed: 152,
    }));
  }
}

export function createRestEraSegments() {
  return [
    new ThreeKingdomsWorkshop(),
    new ThreeKingdomsToJoseonGate(),
    new JoseonSarangbang(),
    new JoseonRoyalAndOnggi(),
    new JoseonToSchoolGate(),
    new ModernSchoolExterior(),
    new ColonialClassroom(),
    new SchoolToLiberationGate(),
    new LiberationTentSchool(),
    new LiberationToModernGate(),
    new ModernCityGrowth(),
    new ModernParkTree(),
    new ModernToEpilogueGate(),
    new EpilogueMuseumHall(),
  ];
}
