import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  createConcreteTexture, createFenceTexture, createBannerAtlas, bannerV, BANNER_SLOTS, createSignAtlas, signUV, SIGN,
} from './textures.js';
import { boardGeometry, instanced } from './geometryUtils.js';

const RAIL = 0;
const CONCRETE = 1;
const TIRES = 2;

/**
 * 트랙 방호 시설 (시각 요소). 충돌 판정은 Vehicle 이 track.railOffset + 0.05 선으로 처리하며,
 * 여기서 만드는 모든 방호벽의 트랙 쪽 면은 그 선 이상(railOffset + 0.1 ~ 0.15)에 놓인다.
 *  → 그래픽상 벽과 실제 충돌 위치가 어긋나지 않는다.
 *
 *  - 메인 직선: 양쪽 콘크리트 벽(+광고) / 바깥쪽 캐치 펜스
 *  - 반경이 작은 코너 바깥: 타이어 방호벽 + 펜스 + 쉐브론 경고판
 *  - 나머지: 가드레일
 *  - 주요 코너 앞 거리 표지(150/100/50), 코너 번호판
 */
export function buildBarriers(track) {
  const group = new THREE.Group();
  group.name = 'Barriers';
  const n = track.count;
  const ro = track.railOffset;
  const cfg = track.config;

  // ── 구간별 방호벽 종류 결정 ────────────────────────────────
  const type = { 1: new Array(n).fill(RAIL), [-1]: new Array(n).fill(RAIL) };
  const ms = track.mainStraight;
  for (const i of track.indexRange(ms[0] - 10, ms.length + 20)) {
    type[1][i] = CONCRETE;
    type[-1][i] = CONCRETE;
  }
  const tireCorners = track.corners.filter((c) => c.minRadius < cfg.tireWallRadius);
  for (const c of tireCorners) {
    const outer = -c.direction;
    for (const i of track.indexRange(c.start - 4, c.indices.length + 14)) if (type[outer][i] === RAIL) type[outer][i] = TIRES;
  }
  const runsOf = (side, t) => track.findRuns(type[side].map((v) => v === t));
  const extend = (run) => (run.length >= n ? run : track.indexRange(run[0] - 1, run.length + 2));

  // ── 재질 (모든 구간 공유) ───────────────────────────────────
  const railMat = new THREE.MeshStandardMaterial({ color: 0xc8cdd3, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x80868d, metalness: 0.6, roughness: 0.5 });
  const concreteTex = createConcreteTexture();
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9, side: THREE.DoubleSide });
  const bannerMat = new THREE.MeshStandardMaterial({ map: createBannerAtlas(), roughness: 0.55, side: THREE.DoubleSide });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, side: THREE.DoubleSide });
  const fenceTex = createFenceTexture();
  fenceTex.repeat.set(2, 1);
  const fenceMat = new THREE.MeshStandardMaterial({
    map: fenceTex, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5,
  });
  const signMat = new THREE.MeshStandardMaterial({ map: createSignAtlas(), roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7, metalness: 0.3 });

  const railGeos = [];
  const concreteGeos = [];
  const bannerGeos = [];
  const fenceGeos = [];
  const posts = [];
  const fencePosts = [];
  const tires = [];

  for (const s of [1, -1]) {
    // 가드레일 (W형 단면 2단)
    for (const run of runsOf(s, RAIL)) {
      const r = extend(run);
      const o = s * (ro + 0.15);
      railGeos.push(track.buildStrip(r, false, [{ off: o, y: 0.5 }, { off: o - s * 0.04, y: 0.64 }, { off: o, y: 0.78 }]));
      railGeos.push(track.buildStrip(r, false, [{ off: o, y: 0.84 }, { off: o, y: 0.92 }]));
      for (let k = 0; k < r.length; k += 2) {
        const p = track.pointAt(r[k], s * (ro + 0.3));
        posts.push({ x: p.x, y: 0.475, z: p.z, rotY: Math.atan2(track.tangents[r[k]].x, track.tangents[r[k]].z) });
      }
    }

    // 콘크리트 방호벽 (저지 배리어 단면) + 벽면 광고
    for (const run of runsOf(s, CONCRETE)) {
      const r = extend(run);
      const base = ro + 0.1;
      const prof = [[0, 0], [0.04, 0.25], [0.17, 0.55], [0.2, 1.0], [0.6, 1.0], [0.62, 0]].map(([d, y]) => ({ off: s * (base + d), y }));
      concreteGeos.push(track.buildStrip(r, false, prof, { vScale: 2 }));
      // 광고 패널: 6m 길이, 8m 간격
      for (let k = 2; k + 3 < r.length; k += 4) {
        const idx = [r[k], r[k + 1], r[k + 2], r[k + 3]];
        const geo = track.buildStrip(idx, false, [{ off: s * (base + 0.165), y: 0.58 }, { off: s * (base + 0.165), y: 0.96 }], { vScale: 1 });
        const slot = (k / 4 + (s > 0 ? 0 : 3)) % BANNER_SLOTS.length | 0;
        remapBannerUV(geo, slot, s > 0);
        bannerGeos.push(geo);
      }
    }

    // 타이어 방호벽 (3단 적층, 구간마다 상단 색 변화)
    for (const run of runsOf(s, TIRES)) {
      let stack = 0;
      for (const i of run) {
        for (const along of [0, 0.68, 1.36]) {
          const p = track.pointAt(i, s * (ro + 0.1 + 0.34), along);
          const band = Math.floor(stack / 5) % 2 === 0 ? 0xf2f2f2 : 0xc8231d;
          for (let h = 0; h < 3; h++) {
            tires.push({ x: p.x, y: 0.12 + h * 0.24, z: p.z, color: h === 2 ? band : 0x1d1d20 });
          }
          stack++;
        }
      }
      // 뒤쪽 캐치 펜스
      const r = extend(run);
      fenceGeos.push(track.buildStrip(r, false, [{ off: s * (ro + 1.05), y: 0 }, { off: s * (ro + 1.05), y: 3.2 }], { vScale: 1.5 }));
      for (let k = 0; k < r.length; k += 2) {
        const p = track.pointAt(r[k], s * (ro + 1.1));
        fencePosts.push({ x: p.x, y: 1.6, z: p.z, sy: 3.2 });
      }
    }
  }

  // 메인 직선 바깥쪽(관중석 쪽) 캐치 펜스 — 콘크리트 벽 위
  {
    const s = track.outwardSide(ms[Math.floor(ms.length / 2)]);
    const r = track.indexRange(ms[0] - 10, ms.length + 20);
    fenceGeos.push(track.buildStrip(r, false, [{ off: s * (ro + 0.9), y: 1.0 }, { off: s * (ro + 0.9), y: 4.2 }], { vScale: 1.5 }));
    for (let k = 0; k < r.length; k += 2) {
      const p = track.pointAt(r[k], s * (ro + 0.95));
      fencePosts.push({ x: p.x, y: 2.6, z: p.z, sy: 3.2 });
    }
  }

  const addMerged = (geos, mat, { cast = true, name }) => {
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos.map(stripAttrs)), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
  };
  addMerged(railGeos, railMat, { name: 'Guardrails' });
  addMerged(concreteGeos, concreteMat, { name: 'ConcreteWalls' });
  addMerged(bannerGeos, bannerMat, { cast: false, name: 'WallBanners' });
  addMerged(fenceGeos, fenceMat, { cast: false, name: 'CatchFences' });

  group.add(instanced(new THREE.BoxGeometry(0.12, 0.95, 0.12), postMat, posts, { name: 'RailPosts' }));
  group.add(instanced(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), postMat, fencePosts, { castShadow: false, name: 'FencePosts' }));
  // 속이 빈 원통(10각, 뚜껑 없음): 위에서 보면 실제 타이어처럼 구멍이 보이고 삼각형 수도 절반
  group.add(instanced(new THREE.CylinderGeometry(0.34, 0.34, 0.235, 10, 1, true), tireMat, tires, { name: 'TireWalls' }));

  // ── 표지판 ─────────────────────────────────────────────────
  const boards = [];
  const t = new THREE.Vector3();
  const r = new THREE.Vector3();
  const facing = (i, towardTrack, back) => {
    t.copy(track.tangents[i]);
    r.copy(track.rights[i]);
    return new THREE.Vector3().addScaledVector(t, -back).addScaledVector(r, towardTrack).normalize();
  };
  const place = (i, side, offset, y, w, h, slot, normal) => {
    const p = track.pointAt(i, side * offset);
    if (track.distanceToCenterline(p.x, p.z) < ro + 0.9) return; // 다른 트랙 구간과 겹치면 생략
    boards.push({ center: new THREE.Vector3(p.x, y, p.z), normal, w, h, slot });
  };

  // 쉐브론 경고판: 급코너 바깥쪽, 진입하는 차를 향해
  for (const c of tireCorners) {
    const outer = -c.direction;
    const slot = c.direction > 0 ? SIGN.CHEVRON_RIGHT : SIGN.CHEVRON_LEFT;
    for (const d of [-10, -2, 6]) {
      const i = (c.apex + d + n) % n;
      place(i, outer, ro + 1.8, 1.55, 1.7, 0.85, slot, facing(i, -outer * 0.85, 0.55));
    }
  }
  // 거리 표지 150/100/50: 가장 급한 코너 3곳 앞
  const tightest = [...track.corners].sort((a, b) => a.minRadius - b.minRadius).slice(0, 3);
  for (const c of tightest) {
    const outer = -c.direction;
    [[75, SIGN.DIST_150], [50, SIGN.DIST_100], [25, SIGN.DIST_50]].forEach(([back, slot]) => {
      const i = (c.start - back + n) % n;
      place(i, outer, ro + 1.8, 1.25, 1.3, 0.65, slot, facing(i, -outer * 0.4, 0.92));
    });
  }
  // 코너 번호판 (T1~T8): 코너 진입 직전 안쪽
  track.corners.slice(0, 8).forEach((c, k) => {
    const inner = c.direction;
    const i = (c.start - 8 + n) % n;
    place(i, inner, ro + 1.8, 1.5, 1.2, 0.6, SIGN.TURN_1 + k, facing(i, -inner * 0.45, 0.9));
  });

  if (boards.length) {
    const geos = boards.map((b) => boardGeometry(b.center, b.normal, b.w, b.h, signUV(b.slot)));
    const signs = new THREE.Mesh(mergeGeometries(geos.map(stripAttrs)), signMat);
    signs.name = 'TrackSigns';
    signs.castShadow = true;
    signs.receiveShadow = true;
    group.add(signs);
    // 뒷판 + 기둥
    const backs = [];
    const legs = [];
    for (const b of boards) {
      const rotY = Math.atan2(b.normal.x, b.normal.z);
      backs.push({ x: b.center.x - b.normal.x * 0.03, y: b.center.y, z: b.center.z - b.normal.z * 0.03, rotY, sx: b.w + 0.06, sy: b.h + 0.06, sz: 0.04 });
      const bottom = b.center.y - b.h / 2;
      for (const sx of [-0.35, 0.35]) {
        legs.push({ x: b.center.x + b.normal.z * b.w * sx - b.normal.x * 0.06, y: bottom / 2, z: b.center.z - b.normal.x * b.w * sx - b.normal.z * 0.06, rotY, sy: bottom });
      }
    }
    group.add(instanced(new THREE.BoxGeometry(1, 1, 1), darkMat, backs, { name: 'SignBacks' }));
    group.add(instanced(new THREE.BoxGeometry(0.07, 1, 0.07), postMat, legs, { name: 'SignLegs' }));
  }

  return { group, type, signCount: boards.length };
}

/** 병합 전 속성 통일 (position / normal / uv) */
function stripAttrs(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  return g;
}

/** 광고 패널 uv → 배너 아틀라스 슬롯. 보는 사람 기준 글자가 바로 읽히도록 방향 보정 */
function remapBannerUV(geo, slot, flip) {
  const uv = geo.attributes.uv;
  const len = geo.userData.length || 6;
  const { v0, v1 } = bannerV(slot);
  for (let i = 0; i < uv.count; i++) {
    const across = uv.getX(i); // 0 = 아래, 1 = 위
    const f = uv.getY(i) / len; // 진행 방향 0 ~ 1
    uv.setXY(i, flip ? 1 - f : f, v0 + (v1 - v0) * (0.04 + across * 0.92));
  }
  uv.needsUpdate = true;
}
