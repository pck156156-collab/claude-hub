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
  private flashDuration = EFFECTS_CONFIG.muzzleFlashTime;

  /** 그래픽 품질: 파티클 양 배율 */
  setDensity(d: number): void {
    for (const p of [this.sparks, this.debris, this.casings, this.smoke]) p.density = d;
  }
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
    this.initArcs();
  }

  get particleCount(): number {
    return this.sparks.activeCount + this.debris.activeCount + this.casings.activeCount + this.smoke.activeCount;
  }

  /** 총구 화염 + 섬광 + 연기 + 탄피 배출 */
  /**
   * @param scale 총기별 화염 크기 (권총 0.7 ~ 샷건 1.6)
   * @param shell 샷건 = 붉은 산탄 탄피
   */
  muzzleFlash(pos: THREE.Vector3, yaw: number, ejectPos: THREE.Vector3, scale = 1, shell = false, flashTime = EFFECTS_CONFIG.muzzleFlashTime): void {
    this.flash.position.copy(pos);
    this.flash.rotation.set(0, yaw, Math.random() * Math.PI);
    const s = (0.8 + Math.random() * 0.45) * scale;
    this.flash.scale.set(s, s, s * (0.9 + Math.random() * 0.5));
    this.flash.visible = true;
    this.flashTimer = this.flashDuration = flashTime;
    this.flashLight.position.copy(pos);
    this.flashLight.color.setHex(0xffb45c);
    this.lightTimer = 0;
    this.flashLight.intensity = 14 * Math.min(1.6, scale);

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
      life: 1.8, size: 1, endScale: 1, gravity: 16, bounce: 0.35, spin: 22, shape: shell ? [0.04, 0.04, 0.1] : [0.025, 0.025, 0.07],
      color: shell ? tmpColor.setRGB(0.6, 0.12, 0.1) : tmpColor.setRGB(0.85, 0.62, 0.25),
    });
  }

  /** 장애물 피격: 불꽃 + 먼지 + 작은 파편 */
  /** @param scale 탄착 효과 크기 (산탄은 작게) */
  impactSurface(point: THREE.Vector3, normal: THREE.Vector3, scale = 1): void {
    const n = Math.max(2, Math.round(7 * scale));
    for (let i = 0; i < n; i++) {
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
  impactFlesh(point: THREE.Vector3, direction: THREE.Vector3, scale = 1): void {
    // 명중 순간 밝은 섬광 (항상 표시 → 피해가 들어가면 반드시 보이는 반응)
    this.sparks.spawn({
      x: point.x - direction.x * 0.05, y: point.y, z: point.z - direction.z * 0.05, vx: 0, vy: 0, vz: 0,
      life: 0.06, size: 1, endScale: 0.3, shape: [0.22 * scale, 0.22 * scale, 0.22 * scale], color: tmpColor.setRGB(1.6, 0.9, 0.7),
    }, true);
    const n = Math.max(2, Math.round(6 * scale));
    for (let i = 0; i < n; i++) {
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

  /** 처치 확인: 몸 높이의 짧은 흰 고리 + 불꽃 (엘리트는 금색 · 크게) */
  killPop(center: THREE.Vector3, scale = 1, elite = false): void {
    this.shockwave(center.x, center.z, 1.2 * scale, elite ? 0xffc23a : 0xfff0e0, 0.25, elite ? 0.9 : 0.5);
    for (let i = 0; i < (elite ? 16 : 6); i++) {
      const v = randomHemisphere(new THREE.Vector3(0, 1, 0), 1);
      const sp = 2 + Math.random() * 3;
      this.sparks.spawn({
        x: center.x, y: 1.0 * scale, z: center.z, vx: v.x * sp, vy: v.y * sp, vz: v.z * sp,
        life: 0.25, size: 1, endScale: 0.2, drag: 3, stretch: 0.02, shape: [0.04, 0.04, 0.08],
        color: elite ? tmpColor.setRGB(1.8, 1.3, 0.3) : tmpColor.setRGB(1.4, 1.3, 1.2),
      });
    }
  }

  /** 치명타: 노란 불꽃 + 작은 노란 고리 */
  critSpark(point: THREE.Vector3): void {
    this.shockwave(point.x, point.z, 0.9, 0xffd23a, 0.18, 0.9);
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

  /**
   * 근접 공격 궤적: 실제 판정 범위(부채꼴 · 사거리)를 그대로 그린다.
   * 메시 3개를 돌려 쓰고, 부채꼴 모양은 각도별로 한 번만 만든다.
   */
  meleeArc(x: number, z: number, yaw: number, range: number, arcDeg: number, color: number, style: string): void {
    const slot = this.arcs[this.arcCursor];
    this.arcCursor = (this.arcCursor + 1) % this.arcs.length;
    let g = this.arcGeometries.get(arcDeg);
    if (!g) {
      const a = THREE.MathUtils.degToRad(arcDeg);
      // XY 평면 링 → 눕히면 각도 -90° 방향이 +Z (정면)
      g = new THREE.RingGeometry(0.3, 1, 28, 1, -Math.PI / 2 - a / 2, a).rotateX(-Math.PI / 2);
      this.arcGeometries.set(arcDeg, g);
    }
    slot.mesh.geometry = g;
    slot.mesh.position.set(x, style === 'chop' ? 0.35 : 1.0, z);
    slot.mesh.rotation.set(0, yaw, 0);
    slot.mesh.scale.set(range, 1, range);
    (slot.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    slot.life = slot.maxLife = 0.18;
    slot.mesh.visible = true;
  }

  /** 근접 명중: 흰 베기 불꽃 + 피격 */
  meleeHit(point: THREE.Vector3, direction: THREE.Vector3, heavy: boolean): void {
    this.impactFlesh(point, direction);
    const n = heavy ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const v = randomHemisphere(direction, 1);
      const sp = 3 + Math.random() * (heavy ? 6 : 3);
      this.sparks.spawn({
        x: point.x, y: point.y, z: point.z, vx: v.x * sp, vy: v.y * sp + 1, vz: v.z * sp,
        life: 0.14, size: 1, endScale: 0.2, drag: 4, stretch: 0.03, shape: [0.03, 0.03, 0.08], color: tmpColor.setRGB(1.5, 1.45, 1.3),
      });
    }
    if (heavy) {
      this.smoke.spawn({
        x: point.x, y: 0.4, z: point.z, vx: direction.x, vy: 0.3, vz: direction.z,
        life: 0.5, size: 0.5, endScale: 2.4, drag: 3, spin: 0.6, color: tmpColor.setRGB(0.55, 0.5, 0.45),
      });
    }
  }

  // ── 6단계: 특수 좀비 · 보스 효과
  private readonly waves: { mesh: THREE.Mesh; life: number; maxLife: number; radius: number; alpha: number }[] = [];
  private waveCursor = 0;
  private waveGeometry: THREE.BufferGeometry | null = null;
  private lightTimer = 0;
  private lightMax = 1;
  private lightPeak = 0;

  /** 바닥을 따라 퍼지는 충격파 고리 (반경 radius 까지) */
  shockwave(x: number, z: number, radius: number, color: number, life = 0.45, alpha = 0.85): void {
    if (!this.waveGeometry) {
      this.waveGeometry = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(this.waveGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
        m.visible = false;
        m.renderOrder = 6;
        m.frustumCulled = false;
        this.scene.add(m);
        this.waves.push({ mesh: m, life: 0, maxLife: 1, radius: 1, alpha: 1 });
      }
    }
    const w = this.waves[this.waveCursor];
    this.waveCursor = (this.waveCursor + 1) % this.waves.length;
    w.mesh.position.set(x, 0.06, z);
    (w.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    w.life = w.maxLife = life;
    w.radius = radius;
    w.alpha = alpha;
    w.mesh.visible = true;
  }

  /** 순간 섬광 (폭발 · 강타) */
  private burstLight(x: number, y: number, z: number, color: number, intensity: number, time: number): void {
    this.flashLight.position.set(x, y, z);
    this.flashLight.color.setHex(color);
    this.flashLight.intensity = this.lightPeak = intensity;
    this.lightTimer = this.lightMax = time;
    this.flashTimer = 0;
  }

  /** 폭발 좀비 폭발: 불꽃 + 연기 + 파편 + 충격파 (반경 = 실제 피해 반경) */
  explosion(center: THREE.Vector3, radius: number): void {
    const y = 0.9;
    for (let i = 0; i < 46; i++) {
      const v = randomHemisphere(new THREE.Vector3(0, 0.6, 0), 1);
      const sp = 4 + Math.random() * 9;
      const hot = Math.random();
      this.sparks.spawn({
        x: center.x, y, z: center.z, vx: v.x * sp, vy: v.y * sp, vz: v.z * sp,
        life: 0.3 + Math.random() * 0.35, size: 1, endScale: 0.2, drag: 3, gravity: 9, stretch: 0.04,
        shape: [0.07, 0.07, 0.14], color: tmpColor.setRGB(1.8, 0.7 + hot * 0.8, 0.15 + hot * 0.2),
      });
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const sp = radius * (0.8 + Math.random() * 0.6);
      this.smoke.spawn({
        x: center.x, y: 0.5 + Math.random() * 0.6, z: center.z, vx: Math.cos(a) * sp, vy: 0.6 + Math.random(), vz: Math.sin(a) * sp,
        life: 1.0 + Math.random() * 0.6, size: 0.9, endScale: 3.2, drag: 2.6, spin: 0.6, color: tmpColor.setRGB(0.32, 0.26, 0.2),
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 5;
      this.debris.spawn({
        x: center.x, y: 0.8, z: center.z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 4, vz: Math.sin(a) * sp,
        life: 1.6, size: 1, endScale: 1, gravity: 18, bounce: 0.3, spin: 10, shape: [0.12, 0.08, 0.1],
        color: tmpColor.setRGB(0.45, 0.2, 0.15),
      });
    }
    this.shockwave(center.x, center.z, radius, 0xff8a30, 0.4);
    this.burstLight(center.x, 1.4, center.z, 0xff9040, 40, 0.25);
  }

  /** 보스 지면 강타: 먼지 고리 + 바위 파편 + 충격파 (반경 = 실제 피해 반경) */
  groundSlam(center: THREE.Vector3, radius: number, color = 0xff5a30): void {
    const n = Math.round(10 + radius * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = radius * (1.0 + Math.random() * 0.5);
      this.smoke.spawn({
        x: center.x + Math.cos(a) * 0.8, y: 0.3, z: center.z + Math.sin(a) * 0.8, vx: Math.cos(a) * sp, vy: 0.4, vz: Math.sin(a) * sp,
        life: 0.9 + Math.random() * 0.5, size: 0.8, endScale: 2.8, drag: 2.8, spin: 0.5, color: tmpColor.setRGB(0.5, 0.45, 0.38),
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.7;
      this.debris.spawn({
        x: center.x + Math.cos(a) * r, y: 0.1, z: center.z + Math.sin(a) * r, vx: Math.cos(a) * 1.5, vy: 4 + Math.random() * 4, vz: Math.sin(a) * 1.5,
        life: 1.4, size: 1, endScale: 1, gravity: 20, bounce: 0.25, spin: 8, shape: [0.16, 0.1, 0.14], color: tmpColor.setRGB(0.35, 0.33, 0.3),
      });
    }
    this.shockwave(center.x, center.z, radius, color, 0.5);
    this.burstLight(center.x, 1, center.z, 0xffa060, 18, 0.18);
  }

  /** 독성 투사체 충돌: 초록 방울 */
  toxicSplash(x: number, y: number, z: number): void {
    for (let i = 0; i < 12; i++) {
      const v = randomHemisphere(new THREE.Vector3(0, 1, 0), 1.2);
      const sp = 1.5 + Math.random() * 3;
      this.sparks.spawn({
        x, y, z, vx: v.x * sp, vy: v.y * sp, vz: v.z * sp,
        life: 0.35, size: 1, endScale: 0.3, drag: 2, gravity: 10, stretch: 0.02, shape: [0.06, 0.06, 0.06], color: tmpColor.setRGB(0.45, 1.5, 0.2),
      });
    }
    this.smoke.spawn({ x, y: Math.max(0.2, y - 0.3), z, vx: 0, vy: 0.3, vz: 0, life: 0.7, size: 0.5, endScale: 2.2, drag: 2, spin: 0.4, color: tmpColor.setRGB(0.35, 0.6, 0.2) });
  }

  /** 보스 등장 · 2페이즈 포효: 붉은 충격파 2겹 */
  bossRoar(center: THREE.Vector3, color: number): void {
    this.shockwave(center.x, center.z, 7, color, 0.6, 0.9);
    this.shockwave(center.x, center.z, 11, color, 0.9, 0.5);
    this.burstLight(center.x, 3, center.z, color, 30, 0.4);
    for (let i = 0; i < 24; i++) {
      const v = randomHemisphere(new THREE.Vector3(0, 1, 0), 1);
      const sp = 3 + Math.random() * 5;
      this.sparks.spawn({
        x: center.x, y: 3, z: center.z, vx: v.x * sp, vy: v.y * sp, vz: v.z * sp,
        life: 0.5, size: 1, endScale: 0.2, drag: 2, stretch: 0.03, shape: [0.06, 0.06, 0.12], color: tmpColor.setHex(color).multiplyScalar(1.6),
      });
    }
  }

  /** 보스가 땅에서 올라올 때 · 돌진이 벽에 부딪힐 때 먼지 */
  dustBurst(center: THREE.Vector3, radius: number): void {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn({
        x: center.x + Math.cos(a) * radius * 0.5, y: 0.3, z: center.z + Math.sin(a) * radius * 0.5,
        vx: Math.cos(a) * 1.4, vy: 0.5, vz: Math.sin(a) * 1.4,
        life: 1.1, size: 0.9, endScale: 2.6, drag: 2.2, spin: 0.5, color: tmpColor.setRGB(0.45, 0.42, 0.36),
      });
    }
  }

  private readonly arcs: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];
  private arcCursor = 0;
  private readonly arcGeometries = new Map<number, THREE.BufferGeometry>();

  private initArcs(): void {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      );
      m.visible = false;
      m.renderOrder = 6;
      m.frustumCulled = false;
      this.scene.add(m);
      this.arcs.push({ mesh: m, life: 0, maxLife: 1 });
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const w of this.waves) {
      if (w.life <= 0) continue;
      w.life -= dt;
      const k = Math.max(0, w.life / w.maxLife);
      const r = w.radius * (0.25 + 0.75 * easeOutCubic(1 - k));
      w.mesh.scale.set(r, 1, r);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = w.alpha * k;
      if (w.life <= 0) w.mesh.visible = false;
    }
    if (this.lightTimer > 0) {
      this.lightTimer -= dt;
      const k = Math.max(0, this.lightTimer / this.lightMax);
      this.flashLight.intensity = this.lightPeak * k * k;
      if (this.lightTimer <= 0) { this.flashLight.intensity = 0; this.flashLight.color.setHex(0xffb45c); }
    }
    for (const a of this.arcs) {
      if (a.life <= 0) continue;
      a.life -= dt;
      const k = Math.max(0, a.life / a.maxLife);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
      if (a.life <= 0) a.mesh.visible = false;
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const k = Math.max(0, this.flashTimer / this.flashDuration);
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
    for (const a of this.arcs) { a.life = 0; a.mesh.visible = false; }
    for (const w of this.waves) { w.life = 0; w.mesh.visible = false; }
    this.lightTimer = 0;
    this.flashLight.color.setHex(0xffb45c);
    for (const p of [this.sparks, this.debris, this.casings, this.smoke]) p.clear();
    this.flash.visible = false;
    this.flashLight.intensity = 0;
    this.flashTimer = 0;
  }

  dispose(): void {
    for (const a of this.arcs) { this.scene.remove(a.mesh); (a.mesh.material as THREE.Material).dispose(); }
    for (const w of this.waves) { this.scene.remove(w.mesh); (w.mesh.material as THREE.Material).dispose(); }
    this.waveGeometry?.dispose();
    for (const g of this.arcGeometries.values()) g.dispose();
    for (const p of [this.sparks, this.debris, this.casings, this.smoke]) p.dispose();
    this.flash.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    this.scene.remove(this.flash, this.flashLight);
    this.flashLight.dispose();
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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
