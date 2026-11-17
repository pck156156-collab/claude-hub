import * as THREE from 'three';
import { TRACK_CONFIG } from '../config.js';
import { createAsphaltTexture, createCurbTexture } from './textures.js';

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

    this.mesh = this.buildMesh();
  }

  /** 위치에서 가장 가까운 중심선 샘플과 횡거리(+ = 진행 방향 오른쪽)를 out 에 기록 */
  getInfo(x, z, out = {}) {
    let best = 0;
    let bestD = Infinity;
    const pts = this.points;
    for (let i = 0; i < this.count; i++) {
      const dx = x - pts[i].x;
      const dz = z - pts[i].z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
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

  /** 가장 긴 직선 구간 앞부분을 출발 위치로 사용 */
  getStartPose() {
    const flat = this.curvatures.map((k) => Math.abs(k) < 0.002);
    let bestStart = 0;
    let bestLen = 0;
    for (let s = 0; s < this.count; s++) {
      if (!flat[s] || flat[(s - 1 + this.count) % this.count]) continue;
      let len = 0;
      while (len < this.count && flat[(s + len) % this.count]) len++;
      if (len > bestLen) {
        bestLen = len;
        bestStart = s;
      }
    }
    const index = (bestStart + Math.floor(bestLen * 0.2)) % this.count;
    const t = this.tangents[index];
    return {
      index,
      position: this.points[index].clone(),
      heading: Math.atan2(t.x, t.z),
    };
  }

  // ───────────────────────────── 메시 생성 ─────────────────────────────

  buildMesh() {
    const group = new THREE.Group();
    group.name = 'Track';
    const all = this.indexRange(0, this.count);

    // 아스팔트 도로 (경계 흰 실선 + 중앙 점선 포함 텍스처)
    const roadMat = new THREE.MeshStandardMaterial({
      map: createAsphaltTexture(), roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const roadVScale = this.length / Math.round(this.length / 16);
    const road = new THREE.Mesh(
      this.buildRibbon(all, -this.halfWidth, this.halfWidth, 0.02, true, roadVScale),
      roadMat,
    );
    road.receiveShadow = true;
    group.add(road);

    // 코너 연석 (빨강/흰색)
    const curbMat = new THREE.MeshStandardMaterial({
      map: createCurbTexture(), roughness: 0.7,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const cw = this.config.curbWidth;
    for (const range of this.findCurbRanges()) {
      for (const [a, b] of [[this.halfWidth, this.halfWidth + cw], [-this.halfWidth - cw, -this.halfWidth]]) {
        const curb = new THREE.Mesh(this.buildRibbon(range, a, b, 0.04, false, 4), curbMat);
        curb.receiveShadow = true;
        group.add(curb);
      }
    }

    // 가드레일: 철제 레일 2단 + 기둥
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xc9ced4, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide,
    });
    for (const side of [1, -1]) {
      for (const [y0, y1] of [[0.5, 0.78], [0.86, 0.94]]) {
        const rail = new THREE.Mesh(this.buildWall(side * (this.railOffset + 0.15), y0, y1), railMat);
        rail.castShadow = true;
        rail.receiveShadow = true;
        group.add(rail);
      }
    }
    const postStep = 2; // 샘플 2개(≈4m)마다 기둥
    const postCount = Math.ceil(this.count / postStep) * 2;
    const posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 1.0, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.5 }),
      postCount,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < this.count; i += postStep) {
      const p = this.points[i];
      const r = this.rights[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(this.tangents[i].x, this.tangents[i].z));
      for (const side of [1, -1]) {
        const off = side * (this.railOffset + 0.32);
        pos.set(p.x + r.x * off, 0.5, p.z + r.z * off);
        posts.setMatrixAt(n++, m.compose(pos, q, s));
      }
    }
    posts.count = n;
    posts.castShadow = true;
    posts.receiveShadow = true;
    group.add(posts);

    return group;
  }

  indexRange(start, length) {
    return Array.from({ length }, (_, k) => (start + k) % this.count);
  }

  /** 곡률이 큰 구간을 찾아 연석을 깔 인덱스 범위 목록 반환 */
  findCurbRanges() {
    const th = this.config.curbCurvatureThreshold;
    const pad = 6;
    const raw = this.curvatures.map((k) => Math.abs(k) > th);
    const flag = raw.map((_, i) => {
      for (let d = -pad; d <= pad; d++) if (raw[(i + d + this.count) % this.count]) return true;
      return false;
    });
    const start = flag.indexOf(false);
    if (start < 0) return [this.indexRange(0, this.count)];
    const ranges = [];
    let cur = null;
    for (let k = 0; k <= this.count; k++) {
      const i = (start + k) % this.count;
      if (flag[i] && k < this.count) {
        if (!cur) cur = [];
        cur.push(i);
      } else if (cur) {
        ranges.push(cur);
        cur = null;
      }
    }
    return ranges;
  }

  /** 중심선을 따라가는 수평 띠. u: offA→offB (0→1), v: 거리/vScale */
  buildRibbon(indices, offA, offB, y, closed, vScale) {
    const list = closed ? [...indices, indices[0]] : indices;
    const positions = [];
    const uvs = [];
    const normals = [];
    const index = [];
    let dist = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (k > 0) dist += this.points[i].distanceTo(this.points[list[k - 1]]);
      const p = this.points[i];
      const r = this.rights[i];
      positions.push(p.x + r.x * offA, y, p.z + r.z * offA, p.x + r.x * offB, y, p.z + r.z * offB);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, dist / vScale, 1, dist / vScale);
      if (k < list.length - 1) {
        const a = k * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    return geo;
  }

  /** 중심선에서 offset 만큼 떨어진 수직 띠 (가드레일) */
  buildWall(offset, y0, y1) {
    const positions = [];
    const index = [];
    for (let k = 0; k <= this.count; k++) {
      const i = k % this.count;
      const p = this.points[i];
      const r = this.rights[i];
      const x = p.x + r.x * offset;
      const z = p.z + r.z * offset;
      positions.push(x, y0, z, x, y1, z);
      if (k < this.count) {
        const a = k * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }
}
