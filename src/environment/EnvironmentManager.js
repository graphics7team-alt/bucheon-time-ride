import * as THREE from 'three';
import { createPhaseOneSegments } from './segments.js';
import { clamp01, smoothstep } from './utils.js';

/**
 * 레일 진행도(u) 기준으로 시대 배경 세그먼트를 관리한다.
 * 일시정지 시 dt=0으로 넘겨 바람/입자/물 애니메이션만 멈춘다.
 * 시크/점프 시에도 u만 맞으면 즉시 올바른 가중치로 복원된다.
 */
export class EnvironmentManager {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {THREE.CatmullRomCurve3} options.curve
   * @param {number} options.stopCount
   * @param {THREE.AmbientLight} options.ambient
   * @param {THREE.DirectionalLight} options.sun
   */
  constructor(options) {
    this.scene = options.scene;
    this.curve = options.curve;
    this.stopCount = options.stopCount;
    this.ambient = options.ambient;
    this.sun = options.sun;

    this.root = new THREE.Group();
    this.root.name = 'EnvironmentRoot';
    this.scene.add(this.root);

    this.segments = createPhaseOneSegments();
    this._builtIds = new Set();
    this._time = 0;
    this._lastU = 0;

    this._fogColor = new THREE.Color();
    this._bgColor = new THREE.Color();
    this._lightColor = new THREE.Color();
    this._tmpFog = new THREE.Color();
    this._tmpBg = new THREE.Color();
    this._tmpLight = new THREE.Color();

    // 세그먼트가 없는 후반 구간용 기본 대기
    this._fallback = {
      light: { color: '#ffffff', intensity: 1.1 },
      fog: { color: '#dfe9f2', near: 250, far: 500, bg: '#cfe0ef' },
    };

    this._ctx = {
      scene: this.scene,
      curve: this.curve,
      stopCount: this.stopCount,
      shared: {},
    };

    for (const seg of this.segments) {
      this.root.add(seg.group);
    }

    // 초반 세그먼트는 즉시 빌드
    this._ensureAround(0);
    this.update({ u: 0, dt: 0, paused: true, cameraPos: null });
  }

  /** 전역 레일 진행도 u (0~1) */
  ensureForProgress(u) {
    this._ensureAround(u);
  }

  _ensureAround(u) {
    for (const seg of this.segments) {
      if (this._builtIds.has(seg.id)) continue;
      if (!seg.overlaps(u, 0.08)) continue;
      seg.build(this._ctx);
      this._builtIds.add(seg.id);
    }

    // 지나간 멀리 있는 세그먼트는 업데이트만 건너뛰고 메시는 유지
    // (원하면 여기서 dispose 가능)
  }

  /**
   * @param {object} state
   * @param {number} state.u
   * @param {number} state.dt  일시정지면 0
   * @param {boolean} state.paused
   * @param {THREE.Vector3|null} state.cameraPos
   * @param {object|null} state.baseLight  stops.json 조명(보조 블렌드)
   */
  update(state) {
    const u = clamp01(state.u ?? 0);
    const dt = state.paused ? 0 : Math.max(0, state.dt || 0);
    this._time += dt;
    this._lastU = u;

    this._ensureAround(u);

    // preload: 조금 앞 구간도 준비
    this._ensureAround(Math.min(1, u + 0.06));

    for (const seg of this.segments) {
      if (!this._builtIds.has(seg.id)) continue;
      const w = seg.computeWeight(u);
      seg.setVisibility(w);
      if (w > 0.01) {
        seg.update({
          u,
          dt,
          paused: !!state.paused,
          time: this._time,
          cameraPos: state.cameraPos,
        });
      }
    }

    this._applyAtmosphere(u, state.baseLight || null);
  }

  _applyAtmosphere(u, baseLight) {
    let totalW = 0;
    let intensity = 0;
    this._bgColor.setRGB(0, 0, 0);
    this._lightColor.setRGB(0, 0, 0);

    for (const seg of this.segments) {
      const sample = seg.sampleAtmosphere(u);
      if (!sample) continue;
      const w = sample.weight;
      totalW += w;
      if (sample.fog) {
        this._tmpBg.set(sample.fog.bg || sample.fog.color);
        this._bgColor.r += this._tmpBg.r * w;
        this._bgColor.g += this._tmpBg.g * w;
        this._bgColor.b += this._tmpBg.b * w;
      }
      if (sample.light) {
        this._tmpLight.set(sample.light.color);
        this._lightColor.r += this._tmpLight.r * w;
        this._lightColor.g += this._tmpLight.g * w;
        this._lightColor.b += this._tmpLight.b * w;
        intensity += (sample.light.intensity ?? 1) * w;
      }
    }

    // 세그먼트 영향이 약하면 stops 기본 조명과 섞음
    const envW = clamp01(totalW);
    if (envW < 0.001 && baseLight) {
      this.sun.color.set(baseLight.color);
      this.sun.intensity = baseLight.intensity;
      this.ambient.color.set(baseLight.color);
      this.ambient.intensity = 0.42;
      this.scene.background.set(baseLight.bg);
      return;
    }

    if (totalW > 0) {
      this._bgColor.multiplyScalar(1 / totalW);
      this._lightColor.multiplyScalar(1 / totalW);
      intensity /= totalW;
    } else {
      this._bgColor.set(this._fallback.fog.bg);
      this._lightColor.set(this._fallback.light.color);
      intensity = this._fallback.light.intensity;
    }

    if (baseLight && envW < 0.95) {
      const k = smoothstep(envW);
      this._tmpLight.set(baseLight.color);
      this._lightColor.lerp(this._tmpLight, 1 - k);
      intensity = THREE.MathUtils.lerp(baseLight.intensity, intensity, k);
      this._tmpBg.set(baseLight.bg);
      this._bgColor.lerp(this._tmpBg, 1 - k);
    }

    this.sun.color.copy(this._lightColor);
    this.sun.intensity = intensity;
    this.ambient.color.copy(this._lightColor);
    this.ambient.intensity = 0.4 + intensity * 0.15;

    // 거리 안개는 사용하지 않고 하늘색만 바꾼다(형체 선명 유지).
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(this._bgColor);
    }
  }

  /** 디버그용 */
  debugInfo(u = this._lastU) {
    const active = this.segments
      .filter((s) => s.weight > 0.01)
      .map((s) => `${s.id}:${s.weight.toFixed(2)}`)
      .join(', ');
    return { u: u.toFixed(4), active };
  }
}
