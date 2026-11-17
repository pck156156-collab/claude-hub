import * as THREE from 'three';
import { TRACK_CONFIG } from '../config.js';
import {
  createAsphaltTexture, createAsphaltBumpTexture, createCurbTexture, createCheckerTexture,
} from './textures.js';
import { valueNoise2D } from '../utils/math.js';
import { buildBarriers } from './Barriers.js';

/**
 * 닫힌 곡선 서킷.
 * - 컨트롤 포인트 → Catmull-Rom 곡선 → 2m 간격 샘플(중심선)
 * - 샘플마다 접선(tangent)·오른쪽 벡터(right)·누적 거리·곡률을 보관
 * - getInfo(x, z): 임의 위치의 트랙 기준 정보(가장 가까운 샘플, 중심선으로부터의 횡거리)
 *   → 노면 판정, 가드레일 충돌, 향후 AI 주행 경로·진행도 계산에 재사용
 */
export class Track {
  constructor(config = TRACK_CONFIG) {
    this.config = config;
    this.halfWidth = config.roadWidth / 2;
    this.railOffset = this.halfWidth + config.runoffWidth;

    const pts = config.controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const count = Math.round(this.curve.getLength() / config.sampleSpacing);
    const spaced = this.curve.getSpacedPoints(count);
    spaced.pop(); // 닫힌 곡선: 마지막 점 = 첫 점

    this.points = spaced;
    this.count = spaced.length;
    this.tangents = [];
    this.rights = [];
    this.distances = [];
    this.curvatures = [];

    let dist = 0;
    for (let i = 0; i < this.count; i++) {
      const prev = this.points[(i - 1 + this.count) % this.count];
      const next = this.points[(i + 1) % this.count];
      const t = new THREE.Vector3().subVectors(next, prev).setY(0).normalize();
      this.tangents.push(t);
      this.rights.push(new THREE.Vector3(-t.z, 0, t.x));
      if (i > 0) dist += this.points[i].distanceTo(this.points[i - 1]);
      this.distances.push(dist);
    }
    this.length = dist + this.points[this.count - 1].distanceTo(this.points[0]);

    for (let i = 0; i < this.count; i++) {
      const a = this.tangents[(i - 1 + this.count) % this.count];
      const b = this.tangents[(i + 1) % this.count];
      const cross = a.x * b.z - a.z * b.x;
      const angle = Math.atan2(cross, a.x * b.x + a.z * b.z);
      this.curvatures.push(angle / (2 * config.sampleSpacing));
    }

    // 지형 계산용 경량 샘플
    this.coarse = this.points.filter((_, i) => i % 3 === 0);
    const box = new THREE.Box3().setFromPoints(this.points);
    this.bounds = box;

    this.analyzeLayout();
    this.mesh = this.buildMesh();
  }

  /**
   * 위치에서 가장 가까운 중심선 샘플과 횡거리(+ = 진행 방향 오른쪽)를 out 에 기록.
   * hint(직전 인덱스)를 주면 주변만 탐색하고, 결과가 탐색 범위 끝이면 전체 탐색으로 대체한다.
   */
  getInfo(x, z, out = {}, hint = -1) {
    const pts = this.points;
    const n = this.count;
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      const W = 24;
      let bestK = 0;
      for (let k = -W; k <= W; k++) {
        const i = (hint + k + n) % n;
        const dx = x - pts[i].x;
        const dz = z - pts[i].z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
          bestK = k;
        }
      }
      if (Math.abs(bestK) === W) best = -1;
    }
    if (best < 0) {
      bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = x - pts[i].x;
        const dz = z - pts[i].z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    const p = pts[best];
    const r = this.rights[best];
    out.index = best;
    out.lateral = (x - p.x) * r.x + (z - p.z) * r.z;
    out.rightX = r.x;
    out.rightZ = r.z;
    return out;
  }

  /** 지형 높이 계산용 대략적 중심선 거리 */
  distanceToCenterline(x, z) {
    let bestD = Infinity;
    for (const p of this.coarse) {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) bestD = d;
    }
    return Math.sqrt(bestD);
  }

  // ───────────────────────────── 레이아웃 분석 ─────────────────────────────

  /** 연석·직선·코너·출발선 위치를 계산 (시각 요소와 노면 판정이 같은 데이터를 쓴다) */
  analyzeLayout() {
    const n = this.count;
    const cfg = this.config;

    // 연석 구간과 "도로로 인정되는 폭" (아스팔트 + 연석)
    this.curbRanges = this.findRuns(this.padFlags(this.curvatures.map((k) => Math.abs(k) > cfg.curbCurvatureThreshold), 6));
    this.surfaceHalf = new Float32Array(n).fill(this.halfWidth);
    for (const run of this.curbRanges) for (const i of run) this.surfaceHalf[i] = this.halfWidth + cfg.curbWidth;

    // 직선 구간 (길이순)
    this.straights = this.findRuns(this.curvatures.map((k) => Math.abs(k) < 0.002)).sort((a, b) => b.length - a.length);
    this.mainStraight = this.straights[0];
    this.startIndex = this.mainStraight[Math.floor(this.mainStraight.length * 0.2)];
    this.finishIndex = (this.startIndex + cfg.finishLineOffset) % n;

    // 코너: 방향(+1 우회전 / -1 좌회전), 정점, 최소 반경 — 결승선 이후 순서대로 정렬
    const runs = this.findRuns(this.padFlags(this.curvatures.map((k) => Math.abs(k) > cfg.cornerCurvatureThreshold), 3));
    this.corners = runs.map((indices) => {
      let apex = indices[0];
      let maxK = 0;
      let sumK = 0;
      for (const i of indices) {
        const k = this.curvatures[i];
        sumK += k;
        if (Math.abs(k) > maxK) {
          maxK = Math.abs(k);
          apex = i;
        }
      }
      return { indices, start: indices[0], end: indices[indices.length - 1], apex, direction: Math.sign(sumK), minRadius: 1 / maxK };
    });
    const fromFinish = (i) => (i - this.finishIndex + n) % n;
    this.corners.sort((a, b) => fromFinish(a.start) - fromFinish(b.start));

    // 서킷 중심 (시설물을 바깥/안쪽에 배치할 때 사용)
    this.center = new THREE.Vector3();
    for (const p of this.points) this.center.add(p);
    this.center.divideScalar(n);
  }

  /** 노면 판정용: 해당 샘플에서 도로로 인정되는 반폭 (연석 구간은 연석 포함) */
  surfaceHalfWidth(index) {
    return this.surfaceHalf[index];
  }

  /** 샘플 i 에서 서킷 바깥쪽이 오른쪽(+1)인지 왼쪽(-1)인지 */
  outwardSide(i) {
    const p = this.points[i];
    const r = this.rights[i];
    return (p.x - this.center.x) * r.x + (p.z - this.center.z) * r.z >= 0 ? 1 : -1;
  }

  /** 출발 위치: 가장 긴 직선 구간의 앞부분 */
  getStartPose() {
    const index = this.startIndex;
    const t = this.tangents[index];
    return { index, position: this.points[index].clone(), heading: Math.atan2(t.x, t.z) };
  }

  /** 트랙 위 위치(샘플 index + 전후 along, 횡 offset)의 월드 좌표 */
  pointAt(index, offset = 0, along = 0, target = new THREE.Vector3()) {
    const i = ((index % this.count) + this.count) % this.count;
    const p = this.points[i];
    const r = this.rights[i];
    const t = this.tangents[i];
    return target.set(p.x + r.x * offset + t.x * along, 0, p.z + r.z * offset + t.z * along);
  }

  // ───────────────────────────── 메시 생성 ─────────────────────────────

  buildMesh() {
    const group = new THREE.Group();
    group.name = 'Track';
    const all = this.indexRange(0, this.count);
    const hw = this.halfWidth;

    // 아스팔트: 색상 텍스처(16m 주기) + 범프맵(다른 주기) + 저주파 정점 음영 → 반복감 완화
    const bump = createAsphaltBumpTexture();
    bump.repeat.set(5, 5);
    const roadMat = new THREE.MeshStandardMaterial({
      map: createAsphaltTexture(), bumpMap: bump, bumpScale: 0.9, roughness: 0.9, metalness: 0,
      vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const roadProfile = Array.from({ length: 11 }, (_, j) => ({ off: -hw + (2 * hw * j) / 10, y: 0.02 }));
    const road = new THREE.Mesh(
      this.buildStrip(all, true, roadProfile, {
        vScale: this.length / Math.round(this.length / 16),
        upNormals: true,
        color: (x, z, u) => {
          let c = 0.86 + 0.14 * valueNoise2D(x * 0.025, z * 0.025) + 0.06 * (valueNoise2D(x * 0.13 + 17, z * 0.13 + 3) - 0.5);
          c -= 0.05 * Math.exp(-(((u - 0.5) / 0.22) ** 2)); // 주행 라인 고무 자국
          if (u < 0.06 || u > 0.94) c += 0.03; // 가장자리 먼지
          return c;
        },
      }),
      roadMat,
    );
    road.receiveShadow = true;
    road.name = 'Road';
    group.add(road);

    // 연석: 바깥쪽이 살짝 솟은 빨강/흰색 (판정상 도로로 인정)
    const curbMat = new THREE.MeshStandardMaterial({
      map: createCurbTexture(), roughness: 0.65,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const cw = this.config.curbWidth;
    for (const run of this.curbRanges) {
      for (const side of [1, -1]) {
        const prof = [
          { off: side * hw, y: 0.022 },
          { off: side * (hw + cw * 0.45), y: 0.05 },
          { off: side * (hw + cw), y: 0.03 },
        ];
        if (side < 0) prof.reverse();
        const curb = new THREE.Mesh(this.buildStrip(run, false, prof, { vScale: 4 }), curbMat);
        curb.receiveShadow = true;
        group.add(curb);
      }
    }

    group.add(this.buildStartFinish());
    this.barriers = buildBarriers(this);
    group.add(this.barriers.group);
    return group;
  }

  /** 결승선 체커 + 출발 그리드 박스 */
  buildStartFinish() {
    const g = new THREE.Group();
    g.name = 'StartFinish';
    const hw = this.halfWidth;
    const i = this.finishIndex;
    const p = this.points[i];
    const r = this.rights[i];
    const t = this.tangents[i];
    const corner = (off, along) => [p.x + r.x * off + t.x * along, 0.03, p.z + r.z * off + t.z * along];
    const quad = (pts, uvs) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex([0, 1, 2, 1, 3, 2]);
      return geo;
    };
    const decal = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.6 };
    const checker = new THREE.Mesh(
      quad([corner(-hw, -0.875), corner(hw, -0.875), corner(-hw, 0.875), corner(hw, 0.875)], [0, 0, 1, 0, 0, 1, 1, 1]),
      new THREE.MeshStandardMaterial({ map: createCheckerTexture(), ...decal }),
    );
    checker.receiveShadow = true;
    g.add(checker);

    // 그리드 박스 (흰색 ㄷ 모양): 출발 위치 중앙 + 뒤로 엇갈려 배치 — 장식용 도색
    const paint = new THREE.MeshStandardMaterial({ color: 0xeeeeea, ...decal });
    const pieces = [];
    const slots = [[0, 0], [-3.5, -9], [3.5, -18], [-3.5, -27]];
    for (const [lat, back] of slots) {
      const si = (this.startIndex + Math.round(back / 2) + this.count) % this.count;
      const sp = this.points[si];
      const sr = this.rights[si];
      const st = this.tangents[si];
      const rect = (o0, o1, a0, a1) => {
        const c = (o, a) => [sp.x + sr.x * (lat + o) + st.x * a, 0.03, sp.z + sr.z * (lat + o) + st.z * a];
        pieces.push(quad([c(o0, a0), c(o1, a0), c(o0, a1), c(o1, a1)], [0, 0, 1, 0, 0, 1, 1, 1]));
      };
      rect(-1.4, 1.4, 2.6, 2.85); // 앞쪽 가로선
      rect(-1.4, -1.15, 1.4, 2.85); // 좌측
      rect(1.15, 1.4, 1.4, 2.85); // 우측
    }
    for (const geo of pieces) {
      const m = new THREE.Mesh(geo, paint);
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  indexRange(start, length) {
    return Array.from({ length }, (_, k) => (((start + k) % this.count) + this.count) % this.count);
  }

  /** 불리언 플래그를 앞뒤 pad 샘플만큼 확장 */
  padFlags(flags, pad) {
    const n = this.count;
    return flags.map((_, i) => {
      for (let d = -pad; d <= pad; d++) if (flags[(i + d + n) % n]) return true;
      return false;
    });
  }

  /** 닫힌 루프에서 true 가 연속된 구간들을 인덱스 배열로 반환 */
  findRuns(flags) {
    const n = this.count;
    const start = flags.indexOf(false);
    if (start < 0) return [this.indexRange(0, n)];
    const runs = [];
    let cur = null;
    for (let k = 0; k <= n; k++) {
      const i = (start + k) % n;
      if (flags[i] && k < n) {
        if (!cur) cur = [];
        cur.push(i);
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    }
    return runs;
  }

  /**
   * 중심선을 따라가는 띠 메시. profile = [{off(횡 오프셋), y}, ...] (단면 꼭짓점들)
   * uv: u = 단면 위치(0~1), v = 진행 거리 / vScale
   * color(x, z, u, dist) 를 주면 정점 밝기(회색조)를 기록한다.
   */
  buildStrip(indices, closed, profile, { vScale = 1, color = null, upNormals = false } = {}) {
    const list = closed ? [...indices, indices[0]] : indices;
    const m = profile.length;
    const positions = [];
    const uvs = [];
    const colors = [];
    const index = [];
    let dist = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (k > 0) dist += this.points[i].distanceTo(this.points[list[k - 1]]);
      const p = this.points[i];
      const r = this.rights[i];
      for (let j = 0; j < m; j++) {
        const { off, y } = profile[j];
        const x = p.x + r.x * off;
        const z = p.z + r.z * off;
        positions.push(x, y, z);
        const u = j / (m - 1);
        uvs.push(u, dist / vScale);
        if (color) {
          const c = color(x, z, u, dist);
          colors.push(c, c, c);
        }
      }
      if (k < list.length - 1) {
        for (let j = 0; j < m - 1; j++) {
          const a = k * m + j;
          index.push(a, a + 1, a + m, a + 1, a + m + 1, a + m);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (color) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(index);
    if (upNormals) {
      const normals = new Float32Array(positions.length);
      for (let q = 1; q < normals.length; q += 3) normals[q] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    } else {
      geo.computeVertexNormals();
    }
    geo.userData.length = dist;
    return geo;
  }
}
