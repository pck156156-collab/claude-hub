export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** current 를 target 쪽으로 최대 maxDelta 만큼 이동 (넘어가지 않음) */
export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** -π ~ π 범위로 정규화 */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** 최단 경로로 각도 보간 */
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

/** 프레임 속도와 무관한 지수 보간 계수: lerp(x, target, damp(k, dt)) */
export const damp = (sharpness, dt) => 1 - Math.exp(-sharpness * dt);

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 시드 기반 난수 (매 실행마다 같은 나무 배치를 얻기 위함) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
