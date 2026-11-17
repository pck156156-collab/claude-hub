import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ENVIRONMENT_CONFIG } from '../config.js';
import { createGrassTexture, createCloudTexture } from './textures.js';
import { mulberry32, smoothstep } from '../utils/math.js';

/**
 * 하늘·구름, 낮 조명(태양 + 하늘광 + 환경 반사), 그림자, 지형, 나무·관목.
 * 트랙 주변은 평지 → 완만한 언덕 → 외곽 산지. 시설물 영역(exclusions)에는 식생을 두지 않는다.
 */
export class Environment {
  constructor(scene, renderer, track, { exclusions = [], config = ENVIRONMENT_CONFIG } = {}) {
    this.scene = scene;
    this.track = track;
    this.config = config;
    this.exclusions = exclusions;
    this.rand = mulberry32(config.seed);
    this.distanceCulled = []; // { mesh, dists(오름차순) } — 품질별 표시 거리 적용용
    this.vegetationMeshes = [];

    this.sunDirection = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - config.sunElevation),
      THREE.MathUtils.degToRad(config.sunAzimuth),
    );

    this.createSky(renderer);
    this.createLights();
    this.createGround();
    this.createVegetation();
    this.createClouds();
  }

  createSky(renderer) {
    const sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u.turbidity.value = 2.5;
    u.rayleigh.value = 2.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(this.sunDirection);

    // 하늘로부터 환경광(반사) 맵 생성 → 차량 도장·유리·금속에 자연스러운 반사
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky);
    this.envTarget = pmrem.fromScene(envScene);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0xbcd2e8, 420, 1800);
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(0xd2e4ff, 0x5b7a3c, 0.5);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.near = 1;
    s.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.setShadowQuality(2048, 70);
  }

  /** 그림자 해상도·범위 변경 (그림자 맵만 다시 만들고 재질은 재컴파일하지 않음) */
  setShadowQuality(mapSize, range) {
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== mapSize) {
      sh.mapSize.set(mapSize, mapSize);
      if (sh.map) {
        sh.map.dispose();
        sh.map = null;
      }
    }
    const cam = sh.camera;
    cam.left = -range;
    cam.right = range;
    cam.top = range;
    cam.bottom = -range;
    cam.updateProjectionMatrix();
  }

  /** 트랙에서 limit(m) 안의 나무·관목만 그린다 — 인스턴스를 거리순으로 정렬해 두었으므로 count 만 조정 */
  setVegetationDistance(limit) {
    for (const { mesh, dists } of this.distanceCulled) {
      let lo = 0;
      let hi = dists.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (dists[mid] <= limit) lo = mid + 1;
        else hi = mid;
      }
      mesh.count = lo;
    }
  }

  setVegetationShadows(on) {
    for (const m of this.vegetationMeshes) m.castShadow = on && m.userData.canCastShadow;
  }

  /** 지형 높이: 트랙 근처 평지 → 완만한 언덕 → 외곽 산 */
  heightAt(x, z, distToTrack) {
    const hills =
      16 * (Math.sin(x * 0.0045) * Math.cos(z * 0.004) + 1) +
      7 * Math.sin(x * 0.013 + 1.3) * Math.sin(z * 0.011 + 0.7);
    const nearMask = smoothstep(55, 260, distToTrack);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const mountains = smoothstep(650, 1200, edge) * (110 + 50 * Math.sin(x * 0.006 + z * 0.004));
    return hills * nearMask + mountains;
  }

  distanceToTrack(x, z) {
    const b = this.track.bounds;
    const dx = Math.max(b.min.x - x, 0, x - b.max.x);
    const dz = Math.max(b.min.z - z, 0, z - b.max.z);
    if (Math.hypot(dx, dz) > 300) return 300; // 충분히 멀면 생략
    return this.track.distanceToCenterline(x, z);
  }

  isExcluded(x, z, margin = 0) {
    for (const e of this.exclusions) {
      const dx = x - e.x;
      const dz = z - e.z;
      const r = e.r + margin;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  createGround() {
    const size = this.config.groundSize;
    const seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = this.distanceToTrack(x, z);
      const h = this.heightAt(x, z, d);
      pos.setY(i, h);
      // 고지대는 마른 풀·바위색, 트랙 주변 잔디는 관리된 듯 약간 진하게
      const t = smoothstep(40, 140, h);
      const kept = 1 - smoothstep(18, 60, d);
      base.setRGB(1 - t * 0.05 - kept * 0.05, 1 - t * 0.12 + kept * 0.02, 1 - t * 0.25 - kept * 0.04)
        .multiplyScalar(0.92 + 0.08 * Math.sin(x * 0.05) * Math.cos(z * 0.04));
      colors.set([base.r, base.g, base.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const grass = createGrassTexture();
    grass.repeat.set(size / 9, size / 9);
    const mat = new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1 });
    // 반복 텍스처 완화: 서로 다른 축척 두 번 샘플링 + 저주파 밝기 변화
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 grassA = texture2D( map, vMapUv );
          vec4 grassB = texture2D( map, vMapUv * 0.137 + vec2( 0.31, 0.67 ) );
          float macro = texture2D( map, vMapUv * 0.021 ).g;
          vec4 sampledDiffuseColor = mix( grassA, grassB, 0.45 ) * ( 0.82 + 0.5 * macro );
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      );
    };
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.name = 'Ground';
    this.scene.add(ground);
  }

  createVegetation() {
    const rand = this.rand;
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const types = [
      { geo: new THREE.ConeGeometry(1.8, 5.5, 7).translate(0, 4.6, 0), weight: 0.45, hue: [0.3, 0.05], light: [0.2, 0.08] }, // 침엽수
      { geo: new THREE.IcosahedronGeometry(2.3, 0).translate(0, 4.0, 0), weight: 0.4, hue: [0.22, 0.08], light: [0.3, 0.1] }, // 활엽수
      { geo: new THREE.IcosahedronGeometry(1, 1).scale(1.1, 3.4, 1.1).translate(0, 5.4, 0), weight: 0.15, hue: [0.26, 0.05], light: [0.24, 0.06] }, // 포플러
    ];
    const max = this.config.treeCount;
    const trunks = [];
    const leaves = types.map(() => []);
    let attempts = 0;
    while (trunks.length < max && attempts < max * 25) {
      attempts++;
      const x = (rand() * 2 - 1) * 950;
      const z = (rand() * 2 - 1) * 950 + 70;
      const d = this.distanceToTrack(x, z);
      if (d < 26 || this.isExcluded(x, z, 4)) continue;
      const cluster = 0.5 + 0.5 * Math.sin(x * 0.02) * Math.cos(z * 0.017);
      if (rand() > 0.25 + cluster * 0.75) continue;
      const scale = 0.6 + rand() * 0.9; // 크기 다양화
      const item = {
        d, x, y: this.heightAt(x, z, d) - 0.1, z, rotY: rand() * Math.PI * 2,
        sx: scale, sy: scale * (0.8 + rand() * 0.5), sz: scale,
      };
      trunks.push(item);
      let pick = rand();
      let ti = 0;
      while (ti < types.length - 1 && pick > types[ti].weight) pick -= types[ti++].weight;
      const ty = types[ti];
      const color = new THREE.Color().setHSL(ty.hue[0] + rand() * ty.hue[1], 0.45, ty.light[0] + rand() * ty.light[1]);
      leaves[ti].push({ ...item, color });
    }
    this.addInstanced(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6).translate(0, 1.2, 0), trunkMat, trunks, true);
    types.forEach((ty, k) => this.addInstanced(ty.geo, leafMat, leaves[k], true));

    // 관목: 방호벽 뒤(트랙 중심선에서 17m 이상) 낮게
    const bushes = [];
    attempts = 0;
    while (bushes.length < this.config.bushCount && attempts < this.config.bushCount * 30) {
      attempts++;
      const x = (rand() * 2 - 1) * 700;
      const z = (rand() * 2 - 1) * 700 + 70;
      const d = this.distanceToTrack(x, z);
      if (d < 17 || d > 160 || this.isExcluded(x, z, 2)) continue;
      if (rand() > 1.2 - d / 160) continue; // 트랙 가까이 더 많이
      const s = 0.6 + rand() * 1.1;
      bushes.push({
        d, x, y: this.heightAt(x, z, d) + 0.2 * s, z, rotY: rand() * 6.28,
        sx: s * (1 + rand() * 0.6), sy: s * 0.6, sz: s,
        color: new THREE.Color().setHSL(0.24 + rand() * 0.07, 0.5, 0.22 + rand() * 0.1),
      });
    }
    this.addInstanced(new THREE.IcosahedronGeometry(1, 0), leafMat, bushes, false);
  }

  addInstanced(geometry, material, items, castShadow) {
    items.sort((a, b) => a.d - b.d); // 트랙에 가까운 것부터 → 표시 거리 = count
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(items.length, 1));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rotY);
      mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz)));
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.count = items.length;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.userData.canCastShadow = castShadow;
    this.scene.add(mesh);
    this.distanceCulled.push({ mesh, dists: Float32Array.from(items, (it) => it.d) });
    this.vegetationMeshes.push(mesh);
    return mesh;
  }

  /** 원경 구름 (스프라이트 몇 장, 안개 영향 없음) */
  createClouds() {
    const tex = createCloudTexture();
    const rand = this.rand;
    for (let k = 0; k < this.config.cloudCount; k++) {
      const a = rand() * Math.PI * 2;
      const dist = 900 + rand() * 900;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55 + rand() * 0.35, depthWrite: false, fog: false });
      const s = new THREE.Sprite(mat);
      const w = 260 + rand() * 320;
      s.scale.set(w, w * (0.32 + rand() * 0.15), 1);
      s.position.set(Math.cos(a) * dist, 260 + rand() * 260, Math.sin(a) * dist + 70);
      s.renderOrder = -1;
      this.scene.add(s);
    }
  }

  /** 그림자 영역을 플레이어 주변으로 이동 */
  update(focus) {
    const snap = 0.5;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDirection, 250);
    this.sun.target.updateMatrixWorld();
  }
}
