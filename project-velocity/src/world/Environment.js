import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ENVIRONMENT_CONFIG } from '../config.js';
import { createGrassTexture } from './textures.js';
import { mulberry32, smoothstep } from '../utils/math.js';

/**
 * 하늘, 낮 조명(태양 + 하늘광), 그림자, 지형, 나무.
 * 트랙 주변은 평지, 멀어질수록 완만한 언덕과 외곽 산지로 이어진다.
 */
export class Environment {
  constructor(scene, renderer, track, config = ENVIRONMENT_CONFIG) {
    this.scene = scene;
    this.track = track;
    this.config = config;
    this.rand = mulberry32(config.seed);

    this.sunDirection = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - config.sunElevation),
      THREE.MathUtils.degToRad(config.sunAzimuth),
    );

    this.createSky(renderer);
    this.createLights();
    this.createGround();
    this.createTrees();
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

    // 하늘로부터 환경광(반사) 맵 생성 → 차량 도장·유리에 자연스러운 반사
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky);
    this.scene.environment = pmrem.fromScene(envScene).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0xbcd2e8, 420, 1800);
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5b7a3c, 0.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -70;
    s.right = 70;
    s.top = 70;
    s.bottom = -70;
    s.near = 1;
    s.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  /** 지형 높이: 트랙 근처 평지 → 완만한 언덕 → 외곽 산 */
  heightAt(x, z, distToTrack) {
    const hills =
      16 * (Math.sin(x * 0.0045) * Math.cos(z * 0.004) + 1) +
      7 * Math.sin(x * 0.013 + 1.3) * Math.sin(z * 0.011 + 0.7);
    const nearMask = smoothstep(45, 260, distToTrack);
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
      const h = this.heightAt(x, z, this.distanceToTrack(x, z));
      pos.setY(i, h);
      // 높이에 따라 풀색 → 고지대는 마른 풀/바위색으로
      const t = smoothstep(40, 140, h);
      base.setRGB(1 - t * 0.05, 1 - t * 0.12, 1 - t * 0.25).multiplyScalar(0.92 + 0.08 * Math.sin(x * 0.05) * Math.cos(z * 0.04));
      colors.set([base.r, base.g, base.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const grass = createGrassTexture();
    grass.repeat.set(size / 8, size / 8);
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1 }),
    );
    ground.receiveShadow = true;
    ground.name = 'Ground';
    this.scene.add(ground);
  }

  createTrees() {
    const count = this.config.treeCount;
    const rand = this.rand;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6).translate(0, 1.2, 0);
    const pineGeo = new THREE.ConeGeometry(1.8, 5.5, 7).translate(0, 4.6, 0);
    const roundGeo = new THREE.IcosahedronGeometry(2.3, 0).translate(0, 4.0, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const pines = new THREE.InstancedMesh(pineGeo, leafMat, count);
    const rounds = new THREE.InstancedMesh(roundGeo, leafMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const color = new THREE.Color();
    let t = 0;
    let pi = 0;
    let ri = 0;
    let attempts = 0;
    const range = 950;

    while (t < count && attempts < count * 20) {
      attempts++;
      const x = (rand() * 2 - 1) * range;
      const z = (rand() * 2 - 1) * range + 70;
      const d = this.distanceToTrack(x, z);
      if (d < 24) continue; // 가드레일 바깥 여유 공간 확보
      // 트랙 근처는 듬성듬성, 숲처럼 군집되도록 확률 조절
      const cluster = 0.5 + 0.5 * Math.sin(x * 0.02) * Math.cos(z * 0.017);
      if (rand() > 0.25 + cluster * 0.75) continue;

      const y = this.heightAt(x, z, d);
      const scale = 0.75 + rand() * 0.7;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      p.set(x, y - 0.1, z);
      s.set(scale, scale * (0.85 + rand() * 0.4), scale);
      m.compose(p, q, s);
      trunks.setMatrixAt(t++, m);
      if (rand() < 0.55) {
        color.setHSL(0.3 + rand() * 0.05, 0.45, 0.22 + rand() * 0.08);
        pines.setMatrixAt(pi, m);
        pines.setColorAt(pi++, color);
      } else {
        color.setHSL(0.22 + rand() * 0.08, 0.5, 0.3 + rand() * 0.1);
        rounds.setMatrixAt(ri, m);
        rounds.setColorAt(ri++, color);
      }
    }
    trunks.count = t;
    pines.count = pi;
    rounds.count = ri;
    for (const mesh of [trunks, pines, rounds]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
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
