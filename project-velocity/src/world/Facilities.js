import * as THREE from 'three';
import { createBannerAtlas, bannerV, BANNER_SLOTS, createConcreteTexture } from './textures.js';
import { GeometryBuckets, boardGeometry, instanced } from './geometryUtils.js';
import { mulberry32 } from '../utils/math.js';

/**
 * 서킷 시설물 (시각 전용, 충돌 없음): 관중석·관중, 피트 빌딩·컨트롤 타워·피트 에이프런,
 * 출발 게이트(갠트리), 코너 광고판. 모두 방호벽 바깥(railOffset + 1m 이상)에 배치한다.
 * 같은 재질끼리 병합해 draw call 을 줄이고, 관중은 InstancedMesh 로 그린다.
 * exclusions: 나무·관목이 들어가지 않도록 하는 원형 영역 목록
 */
export function buildFacilities(track) {
  const group = new THREE.Group();
  group.name = 'Facilities';
  const ro = track.railOffset;
  const n = track.count;
  const rand = mulberry32(4242);
  const B = new GeometryBuckets();
  const exclusions = [];
  const crowdBodies = [];
  const crowdHeads = [];

  /** 트랙 샘플 기준 로컬 좌표계: x = 트랙 바깥 방향 거리, y = 위, z = 길이 방향 */
  const frame = (index, side) => {
    const i = ((index % n) + n) % n;
    const p = track.points[i];
    const X = track.rights[i].clone().multiplyScalar(side);
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3().crossVectors(X, Y);
    return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(p.x, 0, p.z);
  };
  const at = (F, x, y, z) => F.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  const box = (key, F, w, h, d, x, y, z) => B.box(key, w, h, d, at(F, x, y, z));
  const local = (F, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(F);
  const exclude = (F, x, z, r) => {
    const p = local(F, x, 0, z);
    exclusions.push({ x: p.x, z: p.z, r });
  };
  const towardTrack = (index, side) => track.rights[((index % n) + n) % n].clone().multiplyScalar(-side);
  const banner = (center, normal, w, h, slot) => {
    const { v0, v1 } = bannerV(slot);
    B.add('banner', boardGeometry(center, normal, w, h, { u0: 0, v0, u1: 1, v1 }));
  };

  const ms = track.mainStraight;
  const fi = track.finishIndex;
  const outward = track.outwardSide(fi);

  // ── 관중석 (메인 직선 바깥쪽, 결승선 중심으로 3동) ─────────────
  const shirts = [0xd62828, 0xf77f00, 0xfcbf49, 0x2a9d8f, 0x1d3557, 0xf1faee, 0x8338ec, 0x3a86ff, 0x111111, 0xe9c46a];
  const skins = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
  const grandstand = (index, side, length, rows, seatKey) => {
    const F = frame(index, side);
    const x0 = ro + 3.2;
    const depth = 1.25;
    const rise = 0.62;
    const top = rise * rows;
    const facing = towardTrack(index, side);
    const yaw = Math.atan2(facing.x, facing.z);
    for (let r = 0; r < rows; r++) {
      box('concrete', F, depth, rise * (r + 1), length, x0 + depth * r + depth / 2, (rise * (r + 1)) / 2, 0);
      box(seatKey, F, 0.45, 0.22, length - 0.8, x0 + depth * r + 0.8, rise * (r + 1) + 0.11, 0);
      for (let z = -length / 2 + 0.6; z < length / 2 - 0.4; z += 0.56) {
        if (rand() > 0.72) continue;
        const pb = local(F, x0 + depth * r + 0.82, rise * (r + 1) + 0.42, z + (rand() - 0.5) * 0.12);
        crowdBodies.push({ x: pb.x, y: pb.y, z: pb.z, rotY: yaw, color: shirts[(rand() * shirts.length) | 0], sy: 0.85 + rand() * 0.3 });
        crowdHeads.push({ x: pb.x, y: pb.y + 0.47, z: pb.z, rotY: yaw, color: skins[(rand() * skins.length) | 0] });
      }
    }
    const back = x0 + depth * rows;
    box('concrete', F, 0.3, top + 3, length, back + 0.15, (top + 3) / 2, 0);
    for (const s of [-1, 1]) box('concrete', F, depth * rows + 0.3, top + 0.8, 0.3, x0 + (depth * rows) / 2, (top + 0.8) / 2, (s * length) / 2);
    box('roof', F, depth * rows + 3, 0.25, length + 1.2, x0 + (depth * rows) / 2 - 1, top + 3.4, 0);
    for (let z = -length / 2; z <= length / 2 + 0.1; z += length / 4) box('steel', F, 0.3, top + 3.3, 0.3, back - 0.2, (top + 3.3) / 2, z);
    box('steel', F, 0.08, 1.0, length, x0 - 0.05, 0.5, 0);
    // 관중석 앞면 광고 띠
    const nrm = facing;
    const count = Math.floor(length / 4.2);
    for (let k = 0; k < count; k++) {
      const z = -length / 2 + 2.1 + k * 4.2 + (length - count * 4.2) / 2;
      const c = local(F, x0 - 0.02, 0.32, z);
      banner(c, nrm, 4, 0.5, (k + index) % BANNER_SLOTS.length);
    }
    for (let z = -length / 2; z <= length / 2; z += 9) exclude(F, x0 + 6, z, 10);
  };
  grandstand(fi, outward, 36, 9, 'seatA');
  grandstand(fi - 21, outward, 34, 8, 'seatB');
  grandstand(fi + 21, outward, 34, 8, 'seatB');

  // 두 번째로 긴 직선에도 작은 관중석
  const second = track.straights[1];
  if (second && second.length > 40) {
    const i2 = second[Math.floor(second.length / 2)];
    grandstand(i2, track.outwardSide(i2), 30, 6, 'seatA');
  }

  // ── 피트 빌딩 + 컨트롤 타워 + 에이프런 (메인 직선 안쪽) ─────────
  {
    const side = -outward;
    const F = frame(fi, side);
    const x0 = ro + 13;
    const L = 100;
    box('white', F, 13, 7, L, x0 + 6.5, 3.5, 0);
    for (let k = 0; k < 12; k++) box('dark', F, 0.2, 4.2, 6.4, x0 - 0.05, 2.1, -45.1 + k * 8.2);
    box('red', F, 0.25, 0.42, L + 0.2, x0 - 0.06, 4.75, 0);
    box('glass', F, 0.2, 1.5, L - 2, x0 - 0.06, 5.95, 0);
    box('steel', F, 14.6, 0.35, L + 2, x0 + 6.2, 7.2, 0);
    // 지붕 간판
    box('steel', F, 0.3, 3.7, 26.6, x0 + 3.35, 9.25, 0);
    banner(local(F, x0 + 3.18, 9.25, 0), towardTrack(fi, side), 26, 3.25, 0);
    // 컨트롤 타워
    box('concrete', F, 9, 15, 9, x0 + 5, 7.5, L / 2 + 6);
    box('glass', F, 9.6, 3.2, 9.6, x0 + 5, 16.6, L / 2 + 6);
    box('steel', F, 10.6, 0.5, 10.6, x0 + 5, 18.45, L / 2 + 6);
    for (let z = -L / 2; z <= L / 2 + 10; z += 10) exclude(F, x0 + 6, z, 13);
    // 피트 에이프런 (콘크리트 바닥)
    const apron = track.buildStrip(
      track.indexRange(fi - 30, 61), false,
      [{ off: side * (ro + 0.72), y: 0.012 }, { off: side * x0, y: 0.012 }],
      { vScale: 4, upNormals: true },
    );
    if (side < 0) apron.index.array.reverse();
    B.add('apron', apron);
  }

  // ── 출발 갠트리 (결승선 위) ─────────────────────────────────
  {
    const span = ro + 1.4;
    for (const s of [1, -1]) box('steel', frame(fi, s), 0.8, 7.6, 0.8, span, 3.8, 0);
    const F = frame(fi, 1);
    box('steel', F, span * 2 + 0.8, 1.1, 0.9, 0, 8.15, 0);
    // 출발 신호등 5개 (진입 방향을 향함 — 카운트다운 기능은 없음)
    for (let k = -2; k <= 2; k++) {
      box('dark', F, 0.5, 0.5, 0.3, k * 0.62, 7.3, 0.55);
      box('lightRed', F, 0.3, 0.3, 0.04, k * 0.62, 7.3, 0.72);
    }
    const t = track.tangents[fi];
    const p = track.points[fi];
    for (const dir of [-1, 1]) {
      const nrm = t.clone().multiplyScalar(dir);
      banner(new THREE.Vector3(p.x + t.x * dir * 0.46, 8.15, p.z + t.z * dir * 0.46), nrm, 8.6, 1.05, 0);
    }
  }

  // ── 코너 광고판 (코너 바깥쪽, 진입 방향을 향해) ─────────────────
  const picks = track.corners.filter((c) => c.minRadius < 120).slice(0, 10);
  picks.forEach((c, k) => {
    const outer = -c.direction;
    const i = c.apex;
    const p = track.pointAt(i, outer * (ro + 9));
    if (track.distanceToCenterline(p.x, p.z) < ro + 7) return;
    const t = track.tangents[i];
    const r = track.rights[i];
    const nrm = new THREE.Vector3(-t.x * 0.5 - r.x * outer * 0.85, 0, -t.z * 0.5 - r.z * outer * 0.85).normalize();
    const w = 10;
    const h = 1.25;
    const cy = 2.6;
    banner(new THREE.Vector3(p.x, cy, p.z), nrm, w, h, 1 + (k % (BANNER_SLOTS.length - 1)));
    const yaw = Math.atan2(nrm.x, nrm.z);
    const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x - nrm.x * 0.1, cy, p.z - nrm.z * 0.1);
    B.box('dark', w + 0.2, h + 0.2, 0.12, M);
    for (const sx of [-0.38, 0.38]) {
      const L = new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x + nrm.z * w * sx - nrm.x * 0.15, (cy - h / 2) / 2, p.z - nrm.x * w * sx - nrm.z * 0.15);
      B.box('steel', 0.18, cy - h / 2, 0.18, L);
    }
    exclusions.push({ x: p.x, z: p.z, r: 8 });
  });

  // ── 재질 + 병합 ─────────────────────────────────────────────
  const concreteTex = createConcreteTexture().clone();
  concreteTex.repeat.set(0.25, 0.25);
  concreteTex.needsUpdate = true;
  const materials = {
    concrete: new THREE.MeshStandardMaterial({ color: 0xcfccc4, roughness: 0.9 }),
    white: new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1d3347, roughness: 0.08, metalness: 0.7, envMapIntensity: 1.2 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8e949b, roughness: 0.4, metalness: 0.7 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xdfe2e6, roughness: 0.5, metalness: 0.3 }),
    seatA: new THREE.MeshStandardMaterial({ color: 0x1f5fd1, roughness: 0.5 }),
    seatB: new THREE.MeshStandardMaterial({ color: 0xcf2a2a, roughness: 0.5 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc4141f, roughness: 0.5 }),
    lightRed: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 0.35 }),
    apron: new THREE.MeshStandardMaterial({
      map: concreteTex, color: 0x9a9b9e, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }),
    banner: new THREE.MeshStandardMaterial({ map: createBannerAtlas(), roughness: 0.55 }),
  };
  group.add(B.build(materials, { name: 'Facilities' }));

  const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  group.add(instanced(new THREE.BoxGeometry(0.42, 0.62, 0.3), crowdMat, crowdBodies, { castShadow: false, name: 'CrowdBodies' }));
  group.add(instanced(new THREE.BoxGeometry(0.2, 0.22, 0.2), crowdMat, crowdHeads, { castShadow: false, name: 'CrowdHeads' }));

  return { group, exclusions, crowdCount: crowdBodies.length };
}
