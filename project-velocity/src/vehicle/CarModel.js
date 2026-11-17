import * as THREE from 'three';

/**
 * 기본 도형을 조합한 스포츠카 3D 모델.
 * 로컬 좌표: +Z = 차량 앞, +Y = 위, +X = 차량 왼쪽.
 *
 * 계층 구조:
 *   root (위치·방향)
 *    ├─ body (가감속·선회 시 기울어짐)  — 차체, 캐빈, 라이트, 스포일러
 *    └─ wheel pivots ×4 (조향) → wheel spin ×4 (회전)
 */
export function createCarModel({ color = 0xd3202c } = {}) {
  const root = new THREE.Group();
  root.name = 'Car';
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x121c26, metalness: 0.3, roughness: 0.05, clearcoat: 1,
  });
  const black = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6, metalness: 0.2 });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 2.2,
  });
  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.9,
  });

  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // ── 차체: 쐐기형 옆면 프로필을 차폭만큼 돌출 ─────────────────
  const BODY_W = 1.74;
  const profile = new THREE.Shape();
  profile.moveTo(-2.15, 0.28);
  profile.lineTo(2.05, 0.28);
  profile.quadraticCurveTo(2.32, 0.3, 2.28, 0.48); // 낮은 노즈
  profile.lineTo(2.12, 0.62);
  profile.quadraticCurveTo(1.25, 0.72, 0.55, 0.84); // 길게 올라가는 보닛
  profile.lineTo(-1.55, 0.9); // 벨트라인
  profile.lineTo(-2.1, 0.93); // 리어 데크
  profile.lineTo(-2.25, 0.76);
  profile.lineTo(-2.2, 0.4);
  profile.closePath();
  add(body, extrudeProfile(profile, BODY_W, 0.07), paint, 0, 0, 0);

  // ── 캐빈 (유리) + 루프 ──────────────────────────────────────
  const cabin = new THREE.Shape();
  cabin.moveTo(0.75, 0.8);
  cabin.quadraticCurveTo(0.25, 1.1, -0.15, 1.19); // 앞유리
  cabin.lineTo(-0.85, 1.19);
  cabin.quadraticCurveTo(-1.35, 1.12, -1.75, 0.88); // 뒷유리
  cabin.lineTo(-1.75, 0.8);
  cabin.closePath();
  add(body, extrudeProfile(cabin, 1.36, 0.04), glass, 0, 0, 0);
  add(body, new THREE.BoxGeometry(1.2, 0.05, 0.78), paint, 0, 1.225, -0.5);
  // A 필러
  for (const s of [1, -1]) {
    const pillar = add(body, new THREE.BoxGeometry(0.06, 0.05, 0.62), paint, s * 0.7, 1.0, 0.33);
    pillar.rotation.x = 0.62;
  }

  // ── 헤드라이트 / 그릴 / 후미등 / 디퓨저 ─────────────────────
  for (const s of [1, -1]) {
    // 경사진 노즈 면에 밀착 (면 법선 방향으로 회전)
    const hl = add(body, new THREE.BoxGeometry(0.46, 0.04, 0.17), headlightMat, s * 0.56, 0.612, 2.258);
    hl.rotation.x = 0.72;
    hl.castShadow = false;
    const tl = add(body, new THREE.BoxGeometry(0.5, 0.1, 0.08), taillightMat, s * 0.58, 0.8, -2.25);
    tl.castShadow = false;
    // 사이드 미러
    add(body, new THREE.BoxGeometry(0.2, 0.09, 0.14), paint, s * 0.86, 0.9, 0.62);
    // 사이드 스커트
    add(body, new THREE.BoxGeometry(0.06, 0.1, 2.0), black, s * 0.93, 0.31, 0.0);
  }
  add(body, new THREE.BoxGeometry(0.95, 0.14, 0.06), black, 0, 0.38, 2.3); // 그릴
  add(body, new THREE.BoxGeometry(1.5, 0.16, 0.1), black, 0, 0.36, -2.24); // 디퓨저
  add(body, new THREE.BoxGeometry(0.9, 0.06, 0.08), taillightMat, 0, 0.8, -2.25).castShadow = false;

  // ── 스포일러 ────────────────────────────────────────────────
  add(body, new THREE.BoxGeometry(1.75, 0.05, 0.34), black, 0, 1.13, -1.98);
  for (const s of [1, -1]) add(body, new THREE.BoxGeometry(0.06, 0.2, 0.18), black, s * 0.55, 1.02, -1.98);

  // ── 레이싱 스트라이프 (진행 방향 표시) ─────────────────────
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 });
  const stripe = add(body, new THREE.BoxGeometry(0.22, 0.02, 1.62), stripeMat, 0, 0.765, 1.33);
  stripe.rotation.x = 0.13;
  add(body, new THREE.BoxGeometry(0.22, 0.02, 0.78), stripeMat, 0, 1.252, -0.5);

  // ── 바퀴 ───────────────────────────────────────────────────
  const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 28).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.235, 0.235, 0.31, 20).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.325, 0.44, 0.06);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.9, roughness: 0.3 });
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.4 });

  const wheels = [];
  const wheelLayout = [
    { x: 0.86, z: 1.38, front: true },
    { x: -0.86, z: 1.38, front: true },
    { x: 0.86, z: -1.32, front: false },
    { x: -0.86, z: -1.32, front: false },
  ];
  for (const w of wheelLayout) {
    const pivot = new THREE.Group();
    pivot.position.set(w.x, 0.36, w.z);
    const spin = new THREE.Group();
    pivot.add(spin);
    add(spin, tireGeo, tireMat, 0, 0, 0);
    add(spin, rimGeo, rimMat, 0, 0, 0);
    for (let k = 0; k < 3; k++) add(spin, spokeGeo, spokeMat, 0, 0, 0).rotation.x = (k * Math.PI) / 3;
    root.add(pivot);
    wheels.push({ pivot, spin, front: w.front });
  }

  return {
    root,
    body,
    /** 앞바퀴 조향각, 앞/뒤 바퀴 회전각 (핸드브레이크 시 뒷바퀴만 멈춤) */
    setWheelState(steerAngle, frontSpin, rearSpin = frontSpin) {
      for (const w of wheels) {
        if (w.front) {
          w.pivot.rotation.y = steerAngle;
          w.spin.rotation.x = frontSpin;
        } else {
          w.spin.rotation.x = rearSpin;
        }
      }
    },
    setBodyTilt(pitch, roll) {
      body.rotation.x = pitch;
      body.rotation.z = roll;
    },
    setBrakeLights(on) {
      taillightMat.emissiveIntensity = on ? 3.5 : 0.9;
    },
  };
}

/** XY 평면의 옆면 프로필(x=차 길이 방향)을 차폭(X축)으로 돌출해 +Z가 앞이 되게 배치 */
function extrudeProfile(shape, width, bevel) {
  const depth = width - bevel * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 3, curveSegments: 10,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2); // shape.x → +Z(앞), extrude 축 → X(차폭)
  geo.computeVertexNormals();
  return geo;
}
