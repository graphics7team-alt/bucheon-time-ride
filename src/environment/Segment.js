import * as THREE from 'three';
import { clamp01, segmentWeight, smoothstep } from './utils.js';

/**
 * 레일 진행도(u: 0~1)에 묶인 환경 세그먼트.
 * weight는 매 프레임 progress로 계산한다(일회성 타이머 없음).
 */
export class Segment {
  constructor(config) {
    this.id = config.id;
    this.start = config.start;
    this.end = config.end;
    this.fade = config.fade ?? 0.018;
    this.environmentType = config.environmentType || 'default';
    this.leftLayout = config.leftLayout || 'default';
    this.rightLayout = config.rightLayout || 'default';
    this.lightingProfile = config.lightingProfile || null;
    this.fogProfile = config.fogProfile || null;
    this.transitionType = config.transitionType || 'none';
    this.group = new THREE.Group();
    this.group.name = this.id;
    this.group.visible = false;
    this._built = false;
    this._weight = 0;
    this._active = false;
  }

  get weight() {
    return this._weight;
  }

  /** 세그먼트 본문 + 양옆 페이드를 포함한 활성 범위 */
  overlaps(u, margin = 0.04) {
    return u >= this.start - this.fade - margin && u <= this.end + this.fade + margin;
  }

  computeWeight(u) {
    return segmentWeight(u, this.start, this.end, this.fade);
  }

  build(ctx) {
    if (this._built) return;
    this._build(ctx);
    this._built = true;
  }

  /** @param {object} ctx { scene, curve, stopCount, shared } */
  _build(_ctx) {
    // subclass
  }

  setVisibility(weight) {
    this._weight = clamp01(weight);
    // 가중치로 투명도를 낮추지 않는다 — 처음부터 형체가 선명해야 한다.
    const on = this._weight > 0.08;
    if (on !== this._active) {
      this._active = on;
      this.group.visible = on;
    }
    this._onWeight(this._weight);
  }

  _onWeight(_w) {}

  /**
   * @param {object} state
   * @param {number} state.u 전체 레일 진행도 0~1
   * @param {number} state.dt 일시정지면 0
   * @param {boolean} state.paused
   * @param {THREE.Vector3} state.cameraPos
   */
  update(state) {
    if (!this._built || this._weight <= 0.01) return;
    this._update(state);
  }

  _update(_state) {}

  /** 조명/안개 블렌드용 샘플. weight가 0이면 null. */
  sampleAtmosphere(u) {
    const w = this.computeWeight(u);
    if (w <= 0.001 || (!this.lightingProfile && !this.fogProfile)) return null;
    return {
      weight: w,
      light: this.lightingProfile,
      fog: this.fogProfile,
      transitionBoost: this.transitionType === 'interior'
        ? smoothstep((u - this.start) / Math.max(0.001, this.end - this.start))
        : 0,
    };
  }

  dispose() {
    // 세그먼트는 라이드 동안 유지. 필요 시 확장.
  }
}
