import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_APPEARANCE } from '../config.js';
import { createGlowTexture } from '../world/textures.js';
import {
  buildBodyGeometry, surfaceTopY, surfaceSideX, beltY, halfWidth, BODY_LIMITS, WHEEL_CENTERS, WHEEL_Y, ARCH_RADIUS,
} from './carBody.js';

/**
 * 절차적으로 생성한 고성능 스포츠카 모델 (시각 전용 — 물리 상태와 분리).
 * 로컬 좌표: +Z = 앞, +Y = 위, +X = 차량 왼쪽. 원점 = 지면 위 차량 중심(물리 position).
 *
 * 계층 구조:
 *   root (물리 위치·방향)
 *    ├─ body (가감속·코너링 기울기, 무게중심 높이에서 회전)
 *    │    └─ shell: 차체, 유리, 라이트, 미러, 스포일러, 배기구 …
 *    └─ wheel pivot ×4 (조향) → spin (회전) : 바퀴는 지면 기준이라 차체 기울기와 분리
 */

// 바퀴 형상은 모든 차량이 공유 (재질만 차량별)
let sharedWheelGeo = null;
function wheelGeometries() {
  if (sharedWheelGeo) return sharedWheelGeo;
  const tireProfile = [
    [0.25, -0.15], [0.31, -0.156], [0.345, -0.142], [0.36, -0.105], [0.365, 0],
    [0.36, 0.105], [0.345, 0.142], [0.31, 0.156], [0.25, 0.15],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(tireProfile, 36).rotateZ(Math.PI / 2);
  const barrel = new THREE.CylinderGeometry(0.252, 0.252, 0.27, 28, 1, true).rotateZ(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.025, 28).rotateZ(Math.PI / 2);

  const face = (side) => {
    const parts = [];
    const ox = side * 0.118;
    for (let k = 0; k < 5; k++) {
      for (const off of [-0.11, 0.11]) {
        const spoke = new THREE.BoxGeometry(0.035, 0.2, 0.03);
        spoke.translate(0, 0.135, 0);
        spoke.rotateX((k * Math.PI * 2) / 5 + off);
        spoke.translate(ox, 0, 0);
        parts.push(spoke);
      }
    }
    parts.push(new THREE.CylinderGeometry(0.065, 0.07, 0.045, 18).rotateZ(Math.PI / 2).translate(ox, 0, 0));
    parts.push(new THREE.TorusGeometry(0.248, 0.014, 8, 40).rotateY(Math.PI / 2).translate(ox + side * 0.01, 0, 0));
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
  };
  sharedWheelGeo = { tire, barrel, disc, faceLeft: face(1), faceRight: face(-1) };
  return sharedWheelGeo;
}

export function createCarModel(appearance = CAR_APPEARANCE) {
  const A = appearance;
  const root = new THREE.Group();
  root.name = 'Car';
  // 차체 기울기 회전축을 무게중심 높이(약 0.5m)에 둔다
  const body = new THREE.Group();
  body.position.y = 0.5;
  root.add(body);
  const shell = new THREE.Group();
  shell.position.y = -0.5;
  body.add(shell);

  // ── 재질 ───────────────────────────────────────────────────
  const paint = new THREE.MeshPhysicalMaterial({ color: A.bodyColor, ...A.paint });
  // 차체 셸 전용: 휠하우스 음영(정점 색)을 쓰는 도장 재질
  const shellPaint = paint.clone();
  shellPaint.vertexColors = true;
  const trimShell = new THREE.MeshStandardMaterial({ color: A.trimColor, roughness: 0.55, metalness: 0.25, vertexColors: true });
  const glass = new THREE.MeshPhysicalMaterial({
    color: A.glassColor, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4,
  });
  const trim = new THREE.MeshStandardMaterial({ color: A.trimColor, roughness: 0.55, metalness: 0.25 });
  const well = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.35, metalness: 0.5 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.18, metalness: 1 });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: A.headlightColor, emissiveIntensity: 2.6, roughness: 0.2,
  });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.35, metalness: 0, envMapIntensity: 0.3 });
  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0x3a0000, emissive: 0xff1424, emissiveIntensity: A.taillight.idle, roughness: 0.3,
  });
  const reverseMat = new THREE.MeshStandardMaterial({
    color: 0x8a8a8a, emissive: 0xffffff, emissiveIntensity: A.reverseLight.off, roughness: 0.3,
  });

  const add = (parent, geo, mat, x, y, z, { shadow = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // ── 차체 (로프트 곡면) ─────────────────────────────────────
  const bodyMesh = add(shell, buildBodyGeometry(), [shellPaint, glass, trimShell, well], 0, 0, 0);
  bodyMesh.name = 'BodyShell';

  // 표면 기울기 (z 방향) → rotation.x
  const slopeAt = (z, x) => -Math.atan((surfaceTopY(z + 0.04, x) - surfaceTopY(z - 0.04, x)) / 0.08);

  // ── 헤드라이트: 경사진 노즈 위 어두운 렌즈 하우징 + LED 주간주행등 + 프로젝터 ─
  const glowTex = createGlowTexture();
  const glow = (color, size, opacity) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    s.scale.setScalar(size);
    return s;
  };
  const headZ = 1.96;
  for (const s of [1, -1]) {
    const x = s * 0.6;
    const y = surfaceTopY(headZ, x);
    const housing = new THREE.Group();
    housing.position.set(x, y - 0.012, headZ);
    housing.rotation.set(slopeAt(headZ, x), s * 0.14, 0);
    shell.add(housing);
    add(housing, box(0.4, 0.035, 0.32), lensMat, 0, 0, 0, { shadow: false });
    add(housing, box(0.38, 0.02, 0.035), headlightMat, -s * 0.01, 0.022, 0.155, { shadow: false }); // LED 바
    for (const px of [-0.08, 0.08]) {
      add(housing, new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), headlightMat, px + s * 0.04, 0.022, 0.03, { shadow: false });
    }
    const g = glow(A.headlightColor, 0.4, 0.35);
    g.position.set(x, y + 0.02, headZ + 0.2);
    shell.add(g);
  }

  // ── 전면: 그릴(흡기구 망), 스플리터, 범퍼 측면 흡기구 ─────────
  const zf = BODY_LIMITS.zFront;
  const grille = add(shell, box(1.0, 0.13, 0.03), carbon, 0, 0.33, zf - 0.005, { shadow: false });
  grille.name = 'Grille';
  for (let k = 0; k < 5; k++) add(shell, box(0.98, 0.008, 0.035), chrome, 0, 0.28 + k * 0.025, zf + 0.004, { shadow: false });
  add(shell, box(1.5, 0.025, 0.16), carbon, 0, 0.235, zf - 0.06); // 스플리터
  for (const s of [1, -1]) add(shell, box(0.22, 0.1, 0.05), carbon, s * 0.6, 0.31, zf - 0.07, { shadow: false });

  // ── 후면: 풀폭 LED 테일램프, 후진등, 디퓨저, 쿼드 배기구 ──────
  const zr = BODY_LIMITS.zRear;
  add(shell, box(1.42, 0.035, 0.03), taillightMat, 0, 0.745, zr - 0.006, { shadow: false });
  for (const s of [1, -1]) {
    add(shell, box(0.34, 0.085, 0.035), taillightMat, s * 0.6, 0.72, zr - 0.006, { shadow: false });
    add(shell, box(0.15, 0.05, 0.03), reverseMat, s * 0.34, 0.6, zr - 0.006, { shadow: false });
  }
  const tailGlows = [1, -1].map((s) => {
    const g = glow(0xff2030, 0.5, 0.25);
    g.position.set(s * 0.62, 0.72, zr - 0.08);
    shell.add(g);
    return g;
  });
  const reverseGlows = [1, -1].map((s) => {
    const g = glow(0xffffff, 0.45, 0);
    g.position.set(s * 0.34, 0.6, zr - 0.08);
    shell.add(g);
    return g;
  });
  add(shell, box(1.62, 0.15, 0.04), carbon, 0, 0.43, zr - 0.004, { shadow: false }); // 리어 범퍼 하단
  add(shell, box(1.5, 0.05, 0.36), carbon, 0, 0.215, zr + 0.12); // 디퓨저 판
  for (let k = -3; k <= 3; k++) add(shell, box(0.02, 0.13, 0.34), carbon, k * 0.2, 0.27, zr + 0.11, { shadow: false });
  const exhaustOutlets = [];
  const tipGeo = new THREE.CylinderGeometry(0.048, 0.044, 0.16, 18, 1, true).rotateX(Math.PI / 2);
  const tipInner = new THREE.CircleGeometry(0.04, 16).rotateY(Math.PI);
  for (const x of [-0.52, -0.38, 0.38, 0.52]) {
    const tip = add(shell, tipGeo, chrome, x, 0.3, zr - 0.02, { shadow: false });
    tip.material = chrome;
    add(shell, tipInner, well, x, 0.3, zr - 0.07, { shadow: false });
    exhaustOutlets.push(new THREE.Vector3(x, 0.3, zr - 0.1));
  }

  // ── 리어 윙 ─────────────────────────────────────────────────
  const wingZ = -1.97;
  const deckY = surfaceTopY(wingZ, 0.5);
  const wing = add(shell, box(1.66, 0.035, 0.3), carbon, 0, deckY + 0.24, wingZ);
  wing.rotation.x = -0.09;
  for (const s of [1, -1]) {
    add(shell, box(0.03, 0.2, 0.36), carbon, s * 0.83, deckY + 0.2, wingZ); // 엔드플레이트
    add(shell, box(0.04, 0.24, 0.12), carbon, s * 0.45, deckY + 0.11, wingZ + 0.02); // 지지대
  }

  // ── 사이드: 미러, 도어 라인, 손잡이, 측면 흡기구 ──────────────
  const mirrorZ = 0.46;
  // 휠아치 립: 아치 가장자리를 따라 차체 표면에 붙는 튜브
  const archLip = (wz, side) => {
    const pts = [];
    const r = ARCH_RADIUS + 0.02;
    for (let k = 0; k <= 32; k++) {
      const a = -0.3 + (k / 32) * (Math.PI + 0.6);
      const z = wz - Math.cos(a) * r;
      const y = WHEEL_Y + Math.sin(a) * r;
      pts.push(new THREE.Vector3(side * (surfaceSideX(z, y) - 0.006), y, z));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.022, 6, false);
  };
  for (const s of [1, -1]) {
    const mx = s * (halfWidth(mirrorZ) * 0.93 + 0.06);
    const my = beltY(mirrorZ) + 0.1;
    const pod = add(shell, new THREE.SphereGeometry(1, 14, 10), paint, mx, my - 0.03, mirrorZ);
    pod.scale.set(0.1, 0.055, 0.12);
    add(shell, box(0.12, 0.03, 0.05), carbon, mx - s * 0.08, my - 0.04, mirrorZ + 0.02, { shadow: false });
    add(shell, new THREE.CircleGeometry(0.06, 12).rotateY(Math.PI), glass, mx, my, mirrorZ - 0.1, { shadow: false }).scale.set(1, 0.7, 1);

    for (const dz of [0.6, -0.62]) {
      const y0 = 0.4;
      const y1 = beltY(dz) - 0.06;
      const w = Math.max(surfaceSideX(dz, y0), surfaceSideX(dz, y1));
      add(shell, box(0.006, y1 - y0, 0.012), well, s * (w + 0.002), (y0 + y1) / 2, dz, { shadow: false });
    }
    add(shell, box(0.012, 0.025, 0.16), carbon, s * (halfWidth(-0.32) + 0.002), beltY(-0.32) - 0.1, -0.32, { shadow: false });
    // 도어 뒤 측면 흡기구
    add(shell, box(0.014, 0.09, 0.24), well, s * (halfWidth(-0.74) - 0.002), 0.6, -0.74, { shadow: false });
    // 휠아치 라이너 립 (아치 경계를 깔끔하게 마감)
    for (const wz of WHEEL_CENTERS) add(shell, archLip(wz, s), trim, 0, 0, 0, { shadow: false }).name = 'ArchLip';
  }

  // ── 바퀴 ───────────────────────────────────────────────────
  const G = wheelGeometries();
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: A.rimColor, roughness: 0.28, metalness: 0.9 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x5a5c60, roughness: 0.5, metalness: 0.9 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: A.caliperColor, roughness: 0.4, metalness: 0.2 });

  const wheels = [];
  const wheelLayout = [
    { x: 0.86, z: 1.38, front: true },
    { x: -0.86, z: 1.38, front: true },
    { x: 0.86, z: -1.32, front: false },
    { x: -0.86, z: -1.32, front: false },
  ];
  for (const w of wheelLayout) {
    const side = Math.sign(w.x);
    const pivot = new THREE.Group();
    pivot.position.set(w.x, 0.36, w.z);
    const spin = new THREE.Group();
    pivot.add(spin);
    add(spin, G.tire, tireMat, 0, 0, 0);
    add(spin, G.barrel, barrelMat, 0, 0, 0, { shadow: false });
    add(spin, side > 0 ? G.faceLeft : G.faceRight, rimMat, 0, 0, 0);
    add(spin, G.disc, discMat, -side * 0.02, 0, 0, { shadow: false });
    // 캘리퍼는 회전하지 않음 (조향만 따라감)
    add(pivot, box(0.07, 0.11, 0.17), caliperMat, side * 0.04, 0.1, w.front ? -0.13 : 0.13, { shadow: false });
    root.add(pivot);
    wheels.push({ pivot, spin, front: w.front });
  }

  mergeStaticParts(shell, bodyMesh);

  return {
    root,
    body,
    exhaustOutlets,
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
      taillightMat.emissiveIntensity = on ? A.taillight.brake : A.taillight.idle;
      for (const g of tailGlows) g.material.opacity = on ? 0.95 : 0.25;
    },
    setReverseLights(on) {
      reverseMat.emissiveIntensity = on ? A.reverseLight.on : A.reverseLight.off;
      for (const g of reverseGlows) g.material.opacity = on ? 0.8 : 0;
    },
  };
}

/**
 * 성능: 차체 셸 아래의 작은 부품(라이트·그릴·윙·미러 등)을 재질별로 하나의 메시로 병합한다.
 * 재질 객체는 그대로 공유되므로 브레이크등·후진등 밝기 제어는 유지된다. (draw call 약 40개 감소)
 */
function mergeStaticParts(shell, keep) {
  shell.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(shell.matrixWorld).invert();
  const byMat = new Map();
  const remove = [];
  shell.traverse((o) => {
    if (!o.isMesh || o === keep || Array.isArray(o.material)) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const geo = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!byMat.has(o.material)) byMat.set(o.material, { geos: [], cast: false });
    const entry = byMat.get(o.material);
    entry.geos.push(geo);
    entry.cast ||= o.castShadow;
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  // 비어 버린 하위 그룹(헤드라이트 하우징) 정리
  for (const c of [...shell.children]) if (c.isGroup && c.children.length === 0) shell.remove(c);
  for (const [material, { geos, cast }] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    shell.add(mesh);
  }
}
