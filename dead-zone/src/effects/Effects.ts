import * as THREE from 'three';
import { EFFECTS_CONFIG } from '../config/GameConfig';
import { ParticlePool } from './ParticlePool';

const tmpColor = new THREE.Color();

/**
 * 사격 관련 시각 효과 모음: 총구 화염, 탄피, 불꽃, 먼지, 파편, 파괴 효과.
 * 모든 파티클은 풀(InstancedMesh)로 관리되어 오래 사격해도 개수가 늘지 않는다.
 */
export class Effects {
  readonly sparks: ParticlePool;
  readonly debris: ParticlePool;
  readonly casings: ParticlePool;
  readonly smoke: ParticlePool;
  private readonly flash: THREE.Group;
  private readonly flashLight: THREE.PointLight;
  private flashTimer = 0;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparks = new ParticlePool(
      EFFECTS_CONFIG.sparkPoolSize,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.debris = new ParticlePool(
      EFFECTS_CONFIG.debrisPoolSize,
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      { castShadow: true },
    );
    this.casings = new ParticlePool(
      EFFECTS_CONFIG.casingPoolSize,
      new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.9 }),
    );
    this.smoke = new ParticlePool(160, new THREE.PlaneGeometry(1, 1), smokeMaterial(), { billboard: true });
    for (const p of [this.debris, this.casings, this.smoke, this.sparks]) scene.add(p.mesh);
    this.smoke.mesh.renderOrder = 4;
    this.sparks.mesh.renderOrder = 6;

    this.flash = muzzleFlashMesh();
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb45c, 0, 9, 2);
    scene.add(this.flashLight);
  }

  get particleCount(): number {
    return this.sparks.activeCount + this.debris.activeCount + this.casings.activeCount + this.smoke.activeCount;
  }

  /** 총구 화염 + 섬광 + 연기 + 탄피 배출 */
  muzzleFlash(pos: THREE.Vector3, yaw: number, ejectPos: THREE.Vector3): void {
    this.flash.position.copy(pos);
    this.flash.rotation.set(0, yaw, Math.random() * Math.PI);
    const s = 0.8 + Math.random() * 0.45;
    this.flash.scale.set(s, s, s * (0.9 + Math.random() * 0.5));
    this.flash.visible = true;
    this.flashTimer = EFFECTS_CONFIG.muzzleFlashTime;
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 14;

    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // 총구 연기
    this.smoke.spawn({
      x: pos.x + fx * 0.15, y: pos.y, z: pos.z + fz * 0.15,
      vx: fx * 1.2 + (Math.random() - 0.5) * 0.3, vy: 0.4, vz: fz * 1.2 + (Math.random() - 0.5) * 0.3,
      life: 0.45, size: 0.35, endScale: 2.6, drag: 3, spin: 1, color: tmpColor.setRGB(0.75, 0.73, 0.7),
    });
    // 탄피: 캐릭터 오른쪽(로컬 -x) 위로 튀어 바닥에서 구른다
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const side = 2.2 + Math.random() * 1.2;
    this.casings.spawn({
      x: ejectPos.x, y: ejectPos.y, z: ejectPos.z,
      vx: rx * side - fx * 0.6, vy: 2.4 + Math.random(), vz: rz * side - fz * 0.6,
      life: 1.8, size: 1, endScale: 1, gravity: 16, bounce: 0.35, spin: 22, shape: [0.025, 0.025, 0.07],
      color: tmpColor.setRGB(0.85, 0.62, 0.25),
    });
  }

  /** 장애물 피격: 불꽃 + 먼지 + 작은 파편 */
  impactSurface(point: THREE.Vector3, normal: THREE.Vector3): void {
    for (let i = 0; i < 7; i++) {
      const v = randomHemisphere(normal, 0.8);
      const speed = 5 + Math.random() * 7;
      this.sparks.spawn({
        x: point.x, y: point.y, z: point.z, vx: v.x * speed, vy: v.y * speed + 1, vz: v.z * speed,
        life: 0.12 + Math.random() * 0.18, size: 1, endScale: 0.3, gravity: 9, drag: 2, stretch: 0.02, shape: [0.025, 0.025, 0.05],
        color: tmpColor.setRGB(1.6, 1.05, 0.45),
      });
    }
    for (let i = 0; i < 2; i++) {
      this.smoke.spawn({
        x: point.x + normal.x * 0.1, y: point.y, z: point.z + normal.z * 0.1,
        vx: normal.x * (0.8 + Math.random()), vy: 0.3 + Math.random() * 0.4, vz: normal.z * (0.8 + Math.random()),
        life: 0.6 + Math.random() * 0.3, size: 0.3, endScale: 3.2, drag: 2.5, spin: 0.8, color: tmpColor.setRGB(0.55, 0.53, 0.5),
      });
    }
    for (let i = 0; i < 3; i++) {
      const v = randomHemisphere(normal, 0.9);
      this.debris.spawn({
        x: point.x, y: point.y, z: point.z, vx: v.x * 3, vy: 1.5 + Math.random() * 2, vz: v.z * 3,
        life: 0.9, size: 0.05 + Math.random() * 0.04, endScale: 0.6, gravity: 14, bounce: 0.2, spin: 10,
        color: tmpColor.setRGB(0.4, 0.39, 0.37),
      });
    }
  }

  /**
   * 좀비 피격: 피격 지점의 짙은 색 튐 + 작은 먼지. 잔혹함보다 "맞았다" 는 피드백 위주.
   */
  impactFlesh(point: THREE.Vector3, direction: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      this.debris.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: direction.x * (1.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 2.2,
        vy: 0.8 + Math.random() * 2.2,
        vz: direction.z * (1.5 + Math.random() * 2.5) + (Math.random() - 0.5) * 2.2,
        life: 0.7, size: 0.04 + Math.random() * 0.04, endScale: 0.4, gravity: 14, bounce: 0.1, spin: 8,
        color: tmpColor.setRGB(0.32, 0.05, 0.04),
      });
    }
    this.smoke.spawn({
      x: point.x, y: point.y, z: point.z, vx: direction.x * 0.8, vy: 0.2, vz: direction.z * 0.8,
      life: 0.35, size: 0.25, endScale: 2.2, drag: 3, spin: 1, color: tmpColor.setRGB(0.45, 0.16, 0.13),
    });
    for (let i = 0; i < 3; i++) {
      const v = randomHemisphere(direction.clone().negate(), 0.8);
      this.sparks.spawn({
        x: point.x, y: point.y, z: point.z, vx: v.x * 3, vy: v.y * 3, vz: v.z * 3,
        life: 0.08, size: 1, endScale: 0.2, drag: 4, stretch: 0.02, shape: [0.03, 0.03, 0.05], color: tmpColor.setRGB(1.3, 1.1, 0.9),
      });
    }
  }

  /** 치명타: 노란 불꽃 */
  critSpark(point: THREE.Vector3): void {
    for (let i = 0; i < 10; i++) {
      const v = randomHemisphere(new THREE.Vector3(0, 1, 0), 1);
      const sp = 3 + Math.random() * 4;
      this.sparks.spawn({
        x: point.x, y: point.y + 0.1, z: point.z, vx: v.x * sp, vy: v.y * sp, vz: v.z * sp,
        life: 0.22, size: 1, endScale: 0.2, drag: 3, gravity: 6, stretch: 0.03, shape: [0.04, 0.04, 0.07], color: tmpColor.setRGB(1.8, 1.4, 0.2),
      });
    }
  }

  /** 좀비 사망: 쓰러지는 자리 먼지 */
  zombieDeath(center: THREE.Vector3): void {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn({
        x: center.x + Math.cos(a) * 0.4, y: 0.25, z: center.z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * 0.9, vy: 0.25, vz: Math.sin(a) * 0.9,
        life: 0.9 + Math.random() * 0.4, size: 0.5, endScale: 2.6, drag: 2.2, spin: 0.5, color: tmpColor.setRGB(0.5, 0.47, 0.42),
      });
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const k = Math.max(0, this.flashTimer / EFFECTS_CONFIG.muzzleFlashTime);
      this.flashLight.intensity = 14 * k;
      if (this.flashTimer <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }
    this.sparks.update(dt, camera);
    this.debris.update(dt, camera);
    this.casings.update(dt, camera);
    this.smoke.update(dt, camera);
  }

  clear(): void {
    for (const p of [this.sparks, this.debris, this.casings, this.smoke]) p.clear();
    this.flash.visible = false;
    this.flashLight.intensity = 0;
    this.flashTimer = 0;
  }

  dispose(): void {
    for (const p of [this.sparks, this.debris, this.casings, this.smoke]) p.dispose();
    this.flash.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    this.scene.remove(this.flash, this.flashLight);
    this.flashLight.dispose();
  }
}

const hemi = new THREE.Vector3();
function randomHemisphere(normal: THREE.Vector3, spread: number): THREE.Vector3 {
  hemi.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(spread);
  hemi.add(normal).normalize();
  return hemi;
}

/** 총구 화염: 앞으로 뻗은 별 모양 판 3장 (가산 혼합) */
function muzzleFlashMesh(): THREE.Group {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.25, 'rgba(255,210,120,0.95)');
  g.addColorStop(0.6, 'rgba(255,120,30,0.4)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = i % 2 ? 12 : 32;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const group = new THREE.Group();
  // 앞을 향한 원판 + 길쭉한 가로판 · 세로판
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), mat);
  front.position.z = 0.05;
  const h = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.75).rotateX(-Math.PI / 2), mat);
  h.position.z = 0.3;
  const v = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.4).rotateY(Math.PI / 2), mat);
  v.position.z = 0.3;
  group.add(front, h, v);
  group.renderOrder = 7;
  for (const m of [front, h, v]) m.renderOrder = 7;
  return group;
}

/** 부드러운 원형 연기 (인스턴스별 투명도) */
function smokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      varying float vAlpha;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vAlpha = aAlpha;
        vColor = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.2, d) * vAlpha * 0.55;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
  });
}
