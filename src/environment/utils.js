import * as THREE from 'three';

export function smoothstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

export function clamp01(t) {
  return Math.min(1, Math.max(0, t));
}

/** 구간 [start, end] 안에서 부드러운 가중치. fade로 양끝 페이드. */
export function segmentWeight(u, start, end, fade = 0.02) {
  if (u < start - fade || u > end + fade) return 0;
  if (u >= start && u <= end) {
    const inFade = fade > 0 ? smoothstep((u - start) / fade) : 1;
    const outFade = fade > 0 ? smoothstep((end - u) / fade) : 1;
    return Math.min(inFade, outFade, 1);
  }
  if (u < start) return smoothstep((u - (start - fade)) / fade);
  return smoothstep(((end + fade) - u) / fade);
}

export function hash2(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function noise2(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  const ux = smoothstep(fx);
  const uz = smoothstep(fz);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uz
  );
}

export function fbm2(x, z, octaves = 3) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += noise2(x * freq, z * freq) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value;
}

const _pos = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _look = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

export function sampleRail(curve, u, target = {}) {
  const t = THREE.MathUtils.clamp(u, 0, 0.9999);
  const point = target.point || _pos;
  const tangent = target.tangent || _tan;
  const side = target.side || _side;
  curve.getPointAt(t, point);
  curve.getTangentAt(t, tangent);
  side.crossVectors(_up, tangent);
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
  side.normalize();
  return { point, tangent, side };
}

export function worldOnRail(curve, u, lateral = 0, lift = 0, out = new THREE.Vector3()) {
  sampleRail(curve, u);
  out.copy(_pos).addScaledVector(_side, lateral);
  out.y += lift;
  return out;
}

export function orientOnRail(object, curve, u, lateral = 0, lift = 0) {
  sampleRail(curve, u);
  object.position.copy(_pos).addScaledVector(_side, lateral);
  object.position.y += lift;
  _look.copy(object.position).add(_tan);
  object.lookAt(_look);
}

const _forward = new THREE.Vector3();

export function setInstanceAt(mesh, index, curve, u, lateral, lift, scale = 1, yawOffset = 0) {
  sampleRail(curve, u);
  _pos.addScaledVector(_side, lateral);
  _pos.y += lift;
  _forward.copy(_tan).normalize();
  _quat.setFromAxisAngle(_up, Math.atan2(_forward.x, _forward.z) + yawOffset);
  _scale.set(scale, scale, scale);
  _mat.compose(_pos, _quat, _scale);
  mesh.setMatrixAt(index, _mat);
}

export function makeLambert(color, opts = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    fog: false,
    side: opts.side ?? THREE.FrontSide,
  });
}

export function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}
