import * as THREE from 'three';

/**
 * 스포츠카 차체 절차적 생성 (로프트 방식).
 *
 * 차체 길이 방향(z)의 여러 단면(station)마다, 바닥 중앙 → 측면 → 숄더 → 창문 → 지붕 중앙으로
 * 이어지는 단면 곡선을 만들고, 이를 길이 방향으로 이어 하나의 매끄러운 곡면을 만든다.
 * 면마다 위치(단면 내 구간, z)에 따라 도장/유리/트림/휠하우스 재질을 나눈다.
 *
 * 좌표: +Z = 앞, +Y = 위, X = 좌우 (대칭). 바퀴 중심 z = +1.38(앞) / -1.32(뒤), y = 0.36
 */

export const BODY_MATERIAL = { PAINT: 0, GLASS: 1, TRIM: 2, WELL: 3 };

export const BODY_LIMITS = { zRear: -2.22, zFront: 2.25 };
export const WHEEL_CENTERS = [1.38, -1.32];
export const WHEEL_Y = 0.36;
export const ARCH_RADIUS = 0.43;
const ARCH_INNER_X = 0.6;

/** 표 [[z, v], ...] 를 부드럽게 보간하는 3차 에르미트 곡선 */
function curve(table) {
  const n = table.length;
  const m = table.map((_, i) => {
    const a = table[Math.max(i - 1, 0)];
    const b = table[Math.min(i + 1, n - 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  });
  return (z) => {
    if (z <= table[0][0]) return table[0][1];
    if (z >= table[n - 1][0]) return table[n - 1][1];
    let i = 1;
    while (z > table[i][0]) i++;
    const [z0, v0] = table[i - 1];
    const [z1, v1] = table[i];
    const h = z1 - z0;
    const t = (z - z0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m[i - 1] +
      (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m[i]
    );
  };
}

// ── 차체 형상 정의 (길이 방향 프로필) ───────────────────────────
export const halfWidth = curve([
  [-2.22, 0.84], [-2.12, 0.92], [-1.85, 0.965], [-1.32, 0.985], [-0.6, 0.955],
  [0.3, 0.95], [1.38, 0.975], [1.85, 0.94], [2.12, 0.86], [2.25, 0.76],
]);
export const bottomY = curve([
  [-2.22, 0.36], [-2.08, 0.25], [-1.8, 0.2], [1.75, 0.2], [2.08, 0.24], [2.25, 0.3],
]);
export const beltY = curve([
  [-2.22, 0.8], [-2.17, 0.88], [-1.9, 0.905], [-1.2, 0.885], [-0.3, 0.845],
  [0.75, 0.8], [1.35, 0.7], [1.85, 0.6], [2.12, 0.535], [2.25, 0.46],
]);
const roofRaw = curve([
  [-2.22, 0], [-1.98, 0.87], [-1.6, 1.0], [-1.0, 1.17], [-0.3, 1.215],
  [0.15, 1.15], [0.55, 0.98], [0.82, 0.8], [1.2, 0], [2.25, 0],
]);
export const roofY = (z) => Math.max(roofRaw(z), beltY(z) + 0.035);
const cabinBaseW = curve([[-2.0, 0.8], [-1.2, 0.79], [0, 0.78], [0.85, 0.82]]);
/** 휠 위 펜더 볼륨: 숄더가 보닛 중앙보다 솟아오르는 조형 */
export const fenderBump = (z) =>
  0.12 * Math.exp(-(((z - WHEEL_CENTERS[0]) / 0.45) ** 2)) + 0.07 * Math.exp(-(((z - WHEEL_CENTERS[1]) / 0.5) ** 2));

/** 단면 제어점 10개 (오른쪽 절반, x ≥ 0) */
function sectionPoints(z) {
  const w = halfWidth(z);
  const yb = bottomY(z);
  const belt = beltY(z);
  const gh = roofY(z) - belt; // 캐빈(그린하우스) 높이. 캐빈 밖에서는 보닛/트렁크의 볼록함
  const s = THREE.MathUtils.clamp(gh / 0.3, 0, 1);
  const base = THREE.MathUtils.lerp(w * 0.86, cabinBaseW(z), s);
  const top = THREE.MathUtils.lerp(w * 0.72, 0.6, s);
  const edge = THREE.MathUtils.lerp(w * 0.45, 0.42, s);
  const f = fenderBump(z) * (1 - s);
  return [
    new THREE.Vector2(0, yb),
    new THREE.Vector2(w * 0.8, yb),
    new THREE.Vector2(w * 0.965, yb + 0.07),
    new THREE.Vector2(w, yb + 0.42 * (belt - yb)),
    new THREE.Vector2(w * 0.985, belt - 0.07 + f),
    new THREE.Vector2(w * 0.925, belt + f),
    new THREE.Vector2(base, belt + gh * 0.08 + f * 0.55),
    new THREE.Vector2(top, belt + gh * 0.82),
    new THREE.Vector2(edge, belt + gh * 0.97),
    new THREE.Vector2(0, belt + gh),
  ];
}

const SECTION_SAMPLES = 48;

/** z 위치 단면을 일정한 매개변수 간격으로 샘플링 → [{x, y, idx}] (idx = 제어점 구간 0~9) */
function sampleSection(z) {
  const spline = new THREE.SplineCurve(sectionPoints(z));
  const out = [];
  for (let j = 0; j < SECTION_SAMPLES; j++) {
    const t = j / (SECTION_SAMPLES - 1);
    const p = spline.getPoint(t);
    out.push({ x: Math.max(p.x, 0), y: p.y, idx: t * 9 });
  }
  return out;
}

/** 휠하우스 깊이 0~1: 바퀴 주변 측면을 둥근 그릇 모양으로 부드럽게 밀어 넣는다 */
function archDepth(z, y) {
  let f = 0;
  for (const wz of WHEEL_CENTERS) {
    const d = Math.hypot(z - wz, y - WHEEL_Y);
    f = Math.max(f, THREE.MathUtils.smoothstep(ARCH_RADIUS + 0.03 - d, 0, 0.07));
  }
  return f;
}

function faceMaterial(z, idx, well, gh) {
  const M = BODY_MATERIAL;
  if (well) return M.WELL;
  if (idx < 1.25) return M.TRIM; // 바닥·사이드 스커트
  if (z > 1.98 && idx < 2.8) return M.TRIM; // 앞 범퍼 하단 흡기구·스플리터
  if (z < -1.98 && idx < 2.5) return M.TRIM; // 뒤 범퍼 하단 디퓨저
  if (gh > 0.18) {
    if (idx > 5.8 && idx < 6.08 && z > -1.75 && z < 0.74) return M.TRIM; // 창틀 실링
    const pillarB = z > -0.66 && z < -0.52;
    const sideWindow = idx >= 6.08 && idx <= 6.9 && z > -1.64 && z < 0.62 && !pillarB;
    const windshield = idx > 7.05 && z > -0.22 && z < 0.76;
    const rearGlass = idx > 7.35 && z > -1.82 && z < -0.98;
    if (sideWindow || windshield || rearGlass) return M.GLASS;
  }
  return M.PAINT;
}

/** 차체 BufferGeometry (재질 그룹: BODY_MATERIAL 순서) */
export function buildBodyGeometry() {
  const { zRear, zFront } = BODY_LIMITS;
  // 단면 위치: 양 끝을 촘촘하게 + 휠하우스 주변은 2.5cm 간격 (매끄러운 아치 경계)
  const cand = [];
  const BASE = 64;
  for (let i = 0; i < BASE; i++) {
    const u = i / (BASE - 1);
    cand.push(zRear + (zFront - zRear) * (0.5 - 0.5 * Math.cos(Math.PI * u)));
  }
  for (const wz of WHEEL_CENTERS) for (let z = wz - 0.55; z <= wz + 0.55; z += 0.025) cand.push(z);
  cand.sort((a, b) => a - b);
  const zs = cand.filter((z, i) => i === 0 || z - cand[i - 1] > 0.012 || i === cand.length - 1);
  const STATIONS = zs.length;

  const K = SECTION_SAMPLES;
  const ring = 2 * K - 2; // 오른쪽 K + 왼쪽 (양 끝 공유 제외) K-2
  const positions = [];
  const colors = []; // 휠하우스 안쪽을 부드럽게 어둡게 (재질 경계 계단 현상 방지)
  const meta = []; // [idx, well]
  for (const z of zs) {
    const sec = sampleSection(z);
    const pts = sec.map((p) => {
      let x = p.x;
      let well = 0;
      if (p.idx > 0.4 && p.idx < 4.7) {
        well = archDepth(z, p.y);
        if (well > 0) x = THREE.MathUtils.lerp(x, Math.min(x, ARCH_INNER_X), well);
      }
      return { x, y: p.y, idx: p.idx, well };
    });
    const shade = (w) => {
      const c = 1 - 0.94 * THREE.MathUtils.smoothstep(w, 0.55, 0.95);
      colors.push(c, c, c);
    };
    for (let j = 0; j < K; j++) {
      positions.push(pts[j].x, pts[j].y, z);
      meta.push([pts[j].idx, pts[j].well]);
      shade(pts[j].well);
    }
    for (let j = K - 2; j >= 1; j--) {
      positions.push(-pts[j].x, pts[j].y, z);
      meta.push([pts[j].idx, pts[j].well]);
      shade(pts[j].well);
    }
  }

  // 앞뒤 마개 (단면 중심으로 부채꼴)
  const capCenter = (stationIdx) => {
    let cy = 0;
    for (let j = 0; j < ring; j++) cy += positions[(stationIdx * ring + j) * 3 + 1];
    return cy / ring;
  };
  const rearCenter = positions.length / 3;
  positions.push(0, capCenter(0), zs[0] - 0.005);
  meta.push([4, 0]);
  colors.push(1, 1, 1);
  const frontCenter = positions.length / 3;
  positions.push(0, capCenter(STATIONS - 1), zs[STATIONS - 1] + 0.005);
  meta.push([4, 0]);
  colors.push(1, 1, 1);

  const groups = [[], [], [], []];
  for (let i = 0; i < STATIONS - 1; i++) {
    const zMid = (zs[i] + zs[i + 1]) / 2;
    const gh = roofY(zMid) - beltY(zMid);
    for (let j = 0; j < ring; j++) {
      const j2 = (j + 1) % ring;
      const a = i * ring + j;
      const b = i * ring + j2;
      const c = (i + 1) * ring + j;
      const d = (i + 1) * ring + j2;
      const idxMid = (meta[a][0] + meta[b][0] + meta[c][0] + meta[d][0]) / 4;
      groups[faceMaterial(zMid, idxMid, false, gh)].push(a, b, c, b, d, c);
    }
  }
  // 뒤 마개: 하단은 디퓨저(트림), 나머지는 도장
  const lastRing = (STATIONS - 1) * ring;
  for (let j = 0; j < ring; j++) {
    const j2 = (j + 1) % ring;
    groups[BODY_MATERIAL.PAINT].push(rearCenter, j2, j);
    groups[BODY_MATERIAL.TRIM].push(frontCenter, lastRing + j, lastRing + j2); // 앞 마개 = 흡기구
  }

  const index = [];
  const geo = new THREE.BufferGeometry();
  groups.forEach((g, m) => {
    geo.addGroup(index.length, g.length, m);
    for (const v of g) index.push(v);
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** (x, z) 위치의 차체 윗면 높이 — 라이트·미러·스포일러 배치용 */
export function surfaceTopY(z, x) {
  const spline = new THREE.SplineCurve(sectionPoints(z));
  let best = null;
  let bestD = Infinity;
  for (let k = 0; k <= 60; k++) {
    const p = spline.getPoint(0.5 + (k / 60) * 0.5);
    const d = Math.abs(p.x - Math.abs(x));
    if (d < bestD) {
      bestD = d;
      best = p.y;
    }
  }
  return best;
}

/** (z, y) 높이에서 차체 측면의 x (오른쪽 기준, 휠하우스 반영 전) — 아치 립·도어 라인 배치용 */
export function surfaceSideX(z, y) {
  const spline = new THREE.SplineCurve(sectionPoints(z));
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k <= 80; k++) {
    const p = spline.getPoint((0.4 + (k / 80) * 5.4) / 9); // 측면 구간 (idx 0.4 ~ 5.8)
    const d = Math.abs(p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p.x;
    }
  }
  return best;
}
